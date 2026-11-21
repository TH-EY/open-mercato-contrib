import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import type { Where, WhereValue } from '@open-mercato/shared/lib/query/types'
import { PublicInfoRequest } from '../../data/entities'
import { requestCreateSchema, requestUpdateSchema } from '../../data/validators'
import { requestCrudEvents } from '../../commands/shared'
import '../../commands/requests'
import { REQUEST_ENTITY_ID, OPEN_STATUSES } from '../../lib/server/requests'
import { loadUserLabels } from '../../lib/server/users'
import { addCalendarDays, daysRemaining, deadlineTone, todayIso } from '../../lib/deadlines'
import { buildPublicInfoCrudOpenApi, createPagedListSchema, createdSchema, okSchema } from '../openapi'

const querySchema = z
  .object({
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    sortField: z.string().optional().default('currentDueDate'),
    sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    status: z.string().optional(),
    assigneeUserId: z.string().uuid().optional(),
    mine: z.string().optional(),
    unassigned: z.string().optional(),
    dueWithinDays: z.coerce.number().int().min(0).max(365).optional(),
    hideClosed: z.string().optional(),
    source: z.enum(['manual', 'import']).optional(),
    q: z.string().optional(),
    today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .passthrough()

type Query = z.infer<typeof querySchema>

const gridFields = [
  'id',
  'tenant_id',
  'organization_id',
  'case_number',
  'case_seq',
  'case_year',
  'channel',
  'received_at',
  'letter_date',
  'requester_name',
  'requester_kind',
  'delivery_form',
  'subject_summary',
  'status',
  'assignee_user_id',
  'statutory_due_date',
  'current_due_date',
  'due_shifted_from',
  'max_extension_date',
  'extended_at',
  'clarification_due_date',
  'responded_at',
  'final_letter_type',
  'source',
  'created_at',
  'updated_at',
]

const detailFields = [
  ...gridFields,
  'requester_address',
  'requester_contact',
  'body_text',
  'extension_reason',
  'paused_at',
  'clarification_delivered_at',
  'response_channel',
  'similar_choice',
  'archive_text',
]

const sortFieldMap: Record<string, string> = {
  currentDueDate: 'current_due_date',
  receivedAt: 'received_at',
  caseSeq: 'case_seq',
  caseNumber: 'case_seq',
  status: 'status',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
}

type RequestRow = Record<string, unknown>

function toIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' && value.length > 0) return value
  return null
}

function toDateOnly(value: unknown): string | null {
  const iso = toIso(value)
  return iso ? iso.slice(0, 10) : null
}

function isSingleRecord(query: Query): boolean {
  return Boolean(query.id) || Boolean(query.ids && query.ids.trim().length > 0)
}

const requestTodayByCtx = new WeakMap<CrudCtx, string>()

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['public_info_requests.view'] },
    POST: { requireAuth: true, requireFeatures: ['public_info_requests.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['public_info_requests.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['public_info_requests.manage'] },
  },
  orm: {
    entity: PublicInfoRequest,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  events: requestCrudEvents,
  indexer: { entityType: REQUEST_ENTITY_ID },
  list: {
    schema: querySchema,
    entityId: REQUEST_ENTITY_ID,
    fields: (query: Query) => (isSingleRecord(query) ? detailFields : gridFields),
    sortFieldMap,
    buildFilters: async (query: Query, ctx: CrudCtx): Promise<Where<RequestRow>> => {
      const filters: Where<RequestRow> = {}
      const target = filters as Record<string, WhereValue>
      const today = query.today ?? todayIso()
      requestTodayByCtx.set(ctx, today)
      if (query.ids) {
        const ids = query.ids.split(',').map((value) => value.trim()).filter((value) => value.length > 0)
        if (ids.length > 0) target.id = { $in: ids }
      }
      if (query.id) target.id = query.id
      if (query.year) target.case_year = query.year
      if (query.source) target.source = query.source
      const statuses = query.status ? query.status.split(',').map((value) => value.trim()).filter(Boolean) : []
      if (statuses.length > 0) target.status = { $in: statuses }
      else if (query.hideClosed === 'true' && !isSingleRecord(query)) target.status = { $in: OPEN_STATUSES }
      else if (!isSingleRecord(query)) target.status = { $ne: 'archived' }
      if (query.assigneeUserId) target.assignee_user_id = query.assigneeUserId
      if (parseBooleanToken(query.mine ?? null) === true && ctx.auth?.sub) target.assignee_user_id = String(ctx.auth.sub)
      else if (parseBooleanToken(query.unassigned ?? null) === true) target.assignee_user_id = { $exists: false }
      if (query.dueWithinDays !== undefined) {
        target.current_due_date = { $lte: addCalendarDays(today, query.dueWithinDays) }
      }
      if (query.q && query.q.trim().length > 0) {
        const pattern = `%${escapeLikePattern(query.q.trim())}%`
        target.$or = [{ case_number: { $ilike: pattern } }, { subject_summary: { $ilike: pattern } }] as unknown as WhereValue
      }
      return filters
    },
    transformItem: (item: RequestRow) => {
      const status = String(item.status ?? 'new')
      const currentDueDate = toDateOnly(item.current_due_date)
      return {
        id: String(item.id),
        caseNumber: String(item.case_number ?? ''),
        caseSeq: Number(item.case_seq ?? 0),
        caseYear: Number(item.case_year ?? 0),
        channel: item.channel ?? null,
        receivedAt: toDateOnly(item.received_at),
        letterDate: toDateOnly(item.letter_date),
        requesterName: item.requester_name ?? null,
        requesterKind: item.requester_kind ?? null,
        requesterAddress: item.requester_address ?? null,
        requesterContact: item.requester_contact ?? null,
        deliveryForm: item.delivery_form ?? null,
        subjectSummary: item.subject_summary ?? '',
        bodyText: item.body_text ?? null,
        status,
        assigneeUserId: item.assignee_user_id ?? null,
        statutoryDueDate: toDateOnly(item.statutory_due_date),
        currentDueDate,
        dueShiftedFrom: toDateOnly(item.due_shifted_from),
        maxExtensionDate: toDateOnly(item.max_extension_date),
        extendedAt: toIso(item.extended_at),
        extensionReason: item.extension_reason ?? null,
        pausedAt: toIso(item.paused_at),
        clarificationDeliveredAt: toDateOnly(item.clarification_delivered_at),
        clarificationDueDate: toDateOnly(item.clarification_due_date),
        respondedAt: toDateOnly(item.responded_at),
        responseChannel: item.response_channel ?? null,
        finalLetterType: item.final_letter_type ?? null,
        similarChoice: item.similar_choice ?? null,
        archiveText: item.archive_text ?? null,
        source: item.source ?? 'manual',
        createdAt: toIso(item.created_at),
        updatedAt: toIso(item.updated_at),
        daysRemaining: null as number | null,
        deadlineTone: 'normal' as string,
        assigneeInitials: null as string | null,
        assigneeName: null as string | null,
      }
    },
  },
  hooks: {
    afterList: async (response: { items?: Array<Record<string, unknown>> }, ctx) => {
      const items = Array.isArray(response?.items) ? response.items : []
      const today = requestTodayByCtx.get(ctx) ?? todayIso()
      const tenantId = ctx.auth?.tenantId ?? null
      const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
      let labels = new Map<string, { initials: string; name: string }>()
      if (tenantId && organizationId) {
        const em = ctx.container.resolve('em') as EntityManager
        labels = await loadUserLabels(
          em,
          { tenantId, organizationId },
          items.map((item) => String(item.assigneeUserId ?? '')),
        )
      }
      for (const item of items) {
        const due = typeof item.currentDueDate === 'string' ? item.currentDueDate : null
        const status = String(item.status ?? 'new')
        item.daysRemaining = due ? daysRemaining(today, due) : null
        item.deadlineTone = deadlineTone(today, { status, currentDueDate: due })
        const label = item.assigneeUserId ? labels.get(String(item.assigneeUserId)) : undefined
        item.assigneeInitials = label?.initials ?? null
        item.assigneeName = label?.name ?? null
      }
    },
  },
  actions: {
    create: {
      commandId: 'public_info_requests.request.create',
      schema: requestCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'public_info_requests.request.update',
      schema: requestUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'public_info_requests.request.delete',
      response: () => ({ ok: true }),
    },
  },
})

const listItemSchema = z
  .object({
    id: z.string(),
    caseNumber: z.string(),
    subjectSummary: z.string(),
    status: z.string(),
    receivedAt: z.string().nullable(),
    currentDueDate: z.string().nullable(),
    daysRemaining: z.number().nullable(),
    deadlineTone: z.string(),
    updatedAt: z.string().nullable(),
  })
  .passthrough()

export const openApi = buildPublicInfoCrudOpenApi({
  resourceName: 'Public-information request',
  pluralName: 'Public-information requests',
  querySchema,
  listResponseSchema: createPagedListSchema(listItemSchema),
  create: { schema: requestCreateSchema, description: 'Registers a request; deadlines are computed server-side.', responseSchema: createdSchema },
  update: { schema: requestUpdateSchema, description: 'Updates a request and optionally replaces its points.', responseSchema: okSchema },
  del: { schema: z.object({ id: z.string().uuid() }), description: 'Soft-deletes a request.', responseSchema: okSchema },
})

