import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { Where, WhereValue } from '@open-mercato/shared/lib/query/types'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { PublicInfoDepartment } from '../../data/entities'
import { departmentCreateSchema, departmentUpdateSchema } from '../../data/validators'
import { departmentCrudEvents } from '../../commands/departments'
import { DEPARTMENT_ENTITY_ID } from '../../lib/server/requests'
import { buildPublicInfoCrudOpenApi, createPagedListSchema, createdSchema, okSchema } from '../openapi'

const querySchema = z
  .object({
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(100),
    sortField: z.string().optional().default('name'),
    sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
    q: z.string().optional(),
    kind: z.string().optional(),
    activeOnly: z.string().optional(),
  })
  .passthrough()

type Query = z.infer<typeof querySchema>
type Row = Record<string, unknown>

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' ? value : null
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry))
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(value) as unknown
      return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : []
    } catch {
      return []
    }
  }
  return []
}

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['public_info_requests.view'] },
    POST: { requireAuth: true, requireFeatures: ['public_info_requests.knowledge.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['public_info_requests.knowledge.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['public_info_requests.knowledge.manage'] },
  },
  orm: {
    entity: PublicInfoDepartment,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  events: departmentCrudEvents,
  indexer: { entityType: DEPARTMENT_ENTITY_ID },
  list: {
    schema: querySchema,
    entityId: DEPARTMENT_ENTITY_ID,
    fields: ['id', 'name', 'symbol', 'kind', 'competence_scope', 'keywords', 'contract_codes', 'contact_hint', 'is_active', 'tenant_id', 'organization_id', 'updated_at'],
    sortFieldMap: { name: 'name', symbol: 'symbol', kind: 'kind', updatedAt: 'updated_at' },
    buildFilters: async (query: Query): Promise<Where<Row>> => {
      const filters: Where<Row> = {}
      const target = filters as Record<string, WhereValue>
      if (query.ids) target.id = { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) }
      if (query.id) target.id = query.id
      if (query.kind) target.kind = query.kind
      if (query.activeOnly === 'true') target.is_active = true
      if (query.q) target.name = { $ilike: `%${escapeLikePattern(query.q)}%` }
      return filters
    },
    transformItem: (item: Row) => ({
      id: String(item.id),
      name: String(item.name ?? ''),
      symbol: String(item.symbol ?? ''),
      kind: String(item.kind ?? 'department'),
      competenceScope: String(item.competence_scope ?? ''),
      keywords: toStringList(item.keywords),
      contractCodes: toStringList(item.contract_codes),
      contactHint: (item.contact_hint as string | null) ?? null,
      isActive: item.is_active !== false,
      updatedAt: toIso(item.updated_at),
    }),
  },
  actions: {
    create: {
      commandId: 'public_info_requests.department.create',
      schema: departmentCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'public_info_requests.department.update',
      schema: departmentUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'public_info_requests.department.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = buildPublicInfoCrudOpenApi({
  resourceName: 'UDIP department',
  pluralName: 'UDIP departments',
  querySchema,
  listResponseSchema: createPagedListSchema(z.object({ id: z.string(), name: z.string() }).passthrough()),
  create: { schema: departmentCreateSchema, description: 'Creates a department used by routing.', responseSchema: createdSchema },
  update: { schema: departmentUpdateSchema, description: 'Updates a department.', responseSchema: okSchema },
  del: { schema: z.object({ id: z.string().uuid() }), description: 'Soft-deletes a department.', responseSchema: okSchema },
})
