import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { FilterQuery } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  PublicInfoRedactionMark,
  PublicInfoRequestEvent,
  PublicInfoResponseDraft,
} from '../../../../data/entities'
import '../../../../commands/requests'
import '../../../../commands/actions'
import { handleRoute, resolveRouteContext, runGuardedCommand, type RouteContext } from '../../../../lib/server/routeContext'
import { loadPoints, loadRequestOr404, loadSettings, REQUEST_ENTITY_ID } from '../../../../lib/server/requests'
import {
  buildLetterContext,
  findSimilarRequests,
  loadCaseDocuments,
  loadDepartmentQueries,
  loadDepartments,
  requestPointsOrSummary,
  suggestRouting,
} from '../../../../lib/server/caseServices'
import { loadUserLabels } from '../../../../lib/server/users'
import { exportDraft, exportDocument } from '../../../../lib/server/exporter'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { daysRemaining, deadlineTone, todayIso } from '../../../../lib/deadlines'
import { exportSchema } from '../../../../data/validators'
import { jsonMethodDoc } from '../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['public_info_requests.view'] },
  POST: { requireAuth: true, requireFeatures: ['public_info_requests.manage'] },
}

type Params = { id: string; action: string }
type RouteParams = { params: Promise<Params> | Params }

const POST_COMMANDS: Record<string, string> = {
  'similar-choice': 'public_info_requests.request.record_similar_choice',
  'routing-accept': 'public_info_requests.routing.accept',
  'notes-mark-sent': 'public_info_requests.department_query.mark_sent',
  'record-reply': 'public_info_requests.department_query.record_reply',
  drafts: 'public_info_requests.draft.generate',
  'draft-update': 'public_info_requests.draft.update',
  'pii-detect': 'public_info_requests.redaction_mark.detect',
  'mark-decide': 'public_info_requests.redaction_mark.decide',
  'mark-add': 'public_info_requests.redaction_mark.add',
  'mark-sent': 'public_info_requests.request.mark_sent',
  extend: 'public_info_requests.request.extend',
  'request-clarification': 'public_info_requests.request.request_clarification',
  'record-clarification-delivery': 'public_info_requests.request.record_clarification_delivery',
  'register-clarification': 'public_info_requests.request.register_clarification',
  'leave-unprocessed': 'public_info_requests.request.leave_unprocessed',
}

async function readParams(ctx: RouteParams): Promise<Params> {
  const params = await ctx.params
  const id = z.string().uuid().parse(params?.id)
  const action = z.string().regex(/^[a-z-]+$/).parse(params?.action)
  return { id, action }
}

async function loadDetail(routeContext: RouteContext, id: string) {
  const { em } = routeContext
  const scope = { tenantId: routeContext.tenantId, organizationId: routeContext.organizationId }
  const request = await loadRequestOr404(em, scope, id)
  const [points, queries, documents, departments, drafts, events, marks] = await Promise.all([
    loadPoints(em, scope, id),
    loadDepartmentQueries(em, scope, id),
    loadCaseDocuments(em, scope, id),
    loadDepartments(em, scope, false),
    em.find(PublicInfoResponseDraft, { requestId: id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }, { orderBy: { version: 'desc' }, limit: 20 }),
    em.find(PublicInfoRequestEvent, { requestId: id, tenantId: scope.tenantId, organizationId: scope.organizationId }, { orderBy: { occurredAt: 'desc' }, limit: 100 }),
    findWithDecryption(em, PublicInfoRedactionMark, { requestId: id, tenantId: scope.tenantId, organizationId: scope.organizationId } as FilterQuery<PublicInfoRedactionMark>, { orderBy: { startOffset: 'asc' } }, scope),
  ])
  const departmentById = new Map(departments.map((department) => [department.id, department]))
  const labels = await loadUserLabels(em, scope, [request.assigneeUserId ?? '', ...events.map((event) => event.actorUserId ?? '')])
  const today = todayIso()
  return {
    request: {
      id: request.id,
      caseNumber: request.caseNumber,
      channel: request.channel,
      receivedAt: request.receivedAt,
      letterDate: request.letterDate ?? null,
      requesterName: request.requesterName,
      requesterKind: request.requesterKind,
      requesterAddress: request.requesterAddress ?? null,
      requesterContact: request.requesterContact ?? null,
      deliveryForm: request.deliveryForm,
      subjectSummary: request.subjectSummary,
      bodyText: request.bodyText ?? null,
      status: request.status,
      assigneeUserId: request.assigneeUserId ?? null,
      assigneeName: request.assigneeUserId ? labels.get(request.assigneeUserId)?.name ?? null : null,
      assigneeInitials: request.assigneeUserId ? labels.get(request.assigneeUserId)?.initials ?? null : null,
      statutoryDueDate: request.statutoryDueDate,
      currentDueDate: request.currentDueDate,
      dueShiftedFrom: request.dueShiftedFrom ?? null,
      maxExtensionDate: request.maxExtensionDate,
      extendedAt: request.extendedAt?.toISOString() ?? null,
      extensionReason: request.extensionReason ?? null,
      pausedAt: request.pausedAt?.toISOString() ?? null,
      clarificationDeliveredAt: request.clarificationDeliveredAt ?? null,
      clarificationDueDate: request.clarificationDueDate ?? null,
      respondedAt: request.respondedAt ?? null,
      responseChannel: request.responseChannel ?? null,
      finalLetterType: request.finalLetterType ?? null,
      similarChoice: request.similarChoice ?? null,
      source: request.source,
      updatedAt: request.updatedAt.toISOString(),
      daysRemaining: daysRemaining(today, request.currentDueDate),
      deadlineTone: deadlineTone(today, { status: request.status, currentDueDate: request.currentDueDate }),
    },
    points: points.map((point) => ({ id: point.id, position: point.position, text: point.text })),
    queries: queries.map((query) => ({
      id: query.id,
      departmentId: query.departmentId,
      departmentName: departmentById.get(query.departmentId)?.name ?? '',
      departmentKind: departmentById.get(query.departmentId)?.kind ?? 'department',
      contactHint: departmentById.get(query.departmentId)?.contactHint ?? null,
      pointPositions: query.pointPositions,
      scopeText: query.scopeText,
      internalDueDate: query.internalDueDate ?? null,
      sentAt: query.sentAt ?? null,
      receivedAt: query.receivedAt ?? null,
      replyKind: query.replyKind ?? null,
      replyDocumentIds: query.replyAttachmentIds ?? [],
      confidence: query.aiConfidence ?? null,
      sources: query.aiSources ?? [],
    })),
    documents: documents.map((document) => ({
      id: document.id,
      attachmentId: document.attachmentId ?? null,
      departmentQueryId: document.departmentQueryId ?? null,
      kind: document.kind,
      fileName: document.fileName,
      mimeType: document.mimeType ?? null,
      textSource: document.textSource,
      ocrConfidence: document.ocrConfidence ?? null,
      extractedText: document.extractedText ?? null,
      createdAt: document.createdAt.toISOString(),
    })),
    drafts: drafts.map((draft) => ({
      id: draft.id,
      version: draft.version,
      letterType: draft.letterType,
      status: draft.status,
      paragraphs: draft.paragraphs,
      attachmentList: draft.attachmentList ?? [],
      letterOptions: draft.letterOptions ?? {},
      generatedBy: draft.generatedBy,
      exportedAt: draft.exportedAt?.toISOString() ?? null,
      updatedAt: draft.updatedAt.toISOString(),
    })),
    marks: marks.map((mark) => ({
      id: mark.id,
      targetKind: mark.targetKind,
      draftId: mark.draftId ?? null,
      paragraphId: mark.paragraphId ?? null,
      documentId: mark.attachmentId ?? null,
      start: mark.startOffset,
      end: mark.endOffset,
      excerpt: mark.textExcerpt,
      category: mark.category,
      detector: mark.detector,
      state: mark.state,
      reason: mark.reason ?? null,
    })),
    events: events.map((event) => ({
      id: event.id,
      kind: event.kind,
      actorName: event.actorUserId ? labels.get(event.actorUserId)?.name ?? null : null,
      payload: event.payload ?? null,
      occurredAt: event.occurredAt.toISOString(),
    })),
  }
}

export async function GET(req: Request, ctx: RouteParams) {
  return handleRoute(async () => {
    const { id, action } = await readParams(ctx)
    const routeContext = await resolveRouteContext(req)
    const scope = { tenantId: routeContext.tenantId, organizationId: routeContext.organizationId }
    if (action === 'detail') return NextResponse.json(await loadDetail(routeContext, id))
    if (action === 'similar') {
      const request = await loadRequestOr404(routeContext.em, scope, id)
      const points = await loadPoints(routeContext.em, scope, id)
      const settings = await loadSettings(routeContext.em, scope)
      const result = await findSimilarRequests(
        routeContext.em,
        scope,
        {
          requestId: id,
          text: [request.subjectSummary, request.bodyText ?? '', ...points.map((point) => point.text)].join('\n'),
          points: points.map((point) => ({ position: point.position, text: point.text })),
        },
        settings,
      )
      return NextResponse.json(result)
    }
    if (action === 'routing-suggest') {
      const request = await loadRequestOr404(routeContext.em, scope, id)
      const points = await requestPointsOrSummary(routeContext.em, scope, request)
      const settings = await loadSettings(routeContext.em, scope)
      return NextResponse.json(
        await suggestRouting({ em: routeContext.em, container: routeContext.container, scope: { ...scope, userId: routeContext.userId }, request, points, settings }),
      )
    }
    if (action === 'routing-notes') {
      const request = await loadRequestOr404(routeContext.em, scope, id)
      const queries = await loadDepartmentQueries(routeContext.em, scope, id)
      const departments = await loadDepartments(routeContext.em, scope, false)
      const byId = new Map(departments.map((department) => [department.id, department]))
      return NextResponse.json({
        notes: queries.map((query) => {
          const department = byId.get(query.departmentId)
          const due = query.internalDueDate ? query.internalDueDate.split('-').reverse().join('.') : null
          return {
            queryId: query.id,
            departmentId: query.departmentId,
            departmentName: department?.name ?? '',
            contactHint: department?.contactHint ?? null,
            sentAt: query.sentAt ?? null,
            subject: `UDIP ${request.caseNumber} — prośba o informację${due ? ` do ${due}` : ''}`,
            bodyText: [
              'Szanowni Państwo,',
              '',
              `w związku z wnioskiem o udostępnienie informacji publicznej (${request.caseNumber}, data wpływu ${request.receivedAt.split('-').reverse().join('.')}) uprzejmie proszę o przygotowanie, zgodnie z § 11 zarządzenia nr 535/2024, projektu odpowiedzi w zakresie:`,
              query.scopeText,
              '',
              `Proszę o przesłanie materiału na adres bip@um.bydgoszcz.pl${due ? ` w terminie do ${due} r.` : ''}, po dokonaniu niezbędnej anonimizacji. W razie braku możliwości dotrzymania terminu proszę o informację o przyczynie (§ 11 ust. 5).`,
            ].join('\n'),
          }
        }),
      })
    }
    if (action === 'export') {
      const url = new URL(req.url)
      const format = exportSchema.shape.format.parse(url.searchParams.get('format') ?? 'docx')
      const documentId = url.searchParams.get('documentId')
      if (documentId) return exportDocument(routeContext, id, z.string().uuid().parse(documentId), format)
      const draftId = z.string().uuid().parse(url.searchParams.get('draftId'))
      return exportDraft(routeContext, id, draftId, format)
    }
    if (action === 'letter-context') {
      const request = await loadRequestOr404(routeContext.em, scope, id)
      const points = await requestPointsOrSummary(routeContext.em, scope, request)
      const settings = await loadSettings(routeContext.em, scope)
      const context = await buildLetterContext({ em: routeContext.em, scope, request, points, departmentNames: [], options: {}, settings })
      return NextResponse.json({ context })
    }
    throw new CrudHttpError(404, { error: 'Unknown action' })
  })
}

export async function POST(req: Request, ctx: RouteParams) {
  return handleRoute(async () => {
    const { id, action } = await readParams(ctx)
    const commandId = POST_COMMANDS[action]
    if (!commandId) throw new CrudHttpError(404, { error: 'Unknown action' })
    const routeContext = await resolveRouteContext(req)
    const body = await readJsonSafe<Record<string, unknown>>(req, {})
    const result = await runGuardedCommand<Record<string, unknown>>(req, routeContext, {
      commandId,
      input: { ...body, id },
      resourceKind: REQUEST_ENTITY_ID,
      resourceId: id,
      operation: 'custom',
    })
    const { __outcome: _outcome, ...publicResult } = (result ?? {}) as Record<string, unknown>
    return NextResponse.json({ ok: true, ...publicResult })
  })
}

const pathParams = z.object({ id: z.string().uuid(), action: z.string() })

export const openApi: OpenApiRouteDoc = {
  pathParams,
  methods: {
    GET: jsonMethodDoc({
      summary: 'Case read actions',
      description: 'action = detail | similar | routing-suggest | routing-notes | export (?format=docx|pdf|txt&draftId=|documentId=) | letter-context',
    }),
    POST: jsonMethodDoc({
      summary: 'Case write actions (commands with undo)',
      description: `action = ${Object.keys(POST_COMMANDS).join(' | ')}`,
    }),
  },
}
