import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { PublicInfoRequest, PublicInfoRequestPoint } from '../data/entities'
import { requestCreateSchema, requestUpdateSchema, type RequestUpdateInput } from '../data/validators'
import { assertAssignable } from '../lib/server/users'
import {
  assertCaseNumberFree,
  computeDeadlines,
  loadPoints,
  loadRequestOr404,
  loadSettings,
  parseCaseNumber,
  recordEvent,
  snapshotRequest,
  type RequestSnapshot,
} from '../lib/server/requests'
import {
  actorOf,
  auditLabel,
  defineRequestCommand,
  emitRequestSideEffects,
  ensureScope,
  snapshotRow,
  type ChildRowSnapshot,
  type CreatedRow,
} from './shared'

function writePoints(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  requestId: string,
  points: Array<{ position: number; text: string }>,
): CreatedRow[] {
  const created: CreatedRow[] = []
  const ordered = [...points].sort((left, right) => left.position - right.position)
  ordered.forEach((point, index) => {
    const id = randomUUID()
    em.persist(
      em.create(PublicInfoRequestPoint, {
        id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        requestId,
        position: index + 1,
        text: point.text,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
    created.push({ kind: 'point', id })
  })
  return created
}

const createRequestCommand: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'public_info_requests.request.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const input = requestCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const parsedNumber = parseCaseNumber(input.caseNumber)
    if (!parsedNumber) throw new CrudHttpError(422, { error: 'Invalid case number' })
    const baseEm = ctx.container.resolve('em') as EntityManager
    const assigneeUserId = input.assigneeUserId === undefined ? actorOf(ctx) : input.assigneeUserId
    if (assigneeUserId && assigneeUserId !== actorOf(ctx)) await assertAssignable(baseEm.fork(), ctx.container, scope, assigneeUserId)
    const request = await baseEm.fork().transactional(async (em) => {
      await assertCaseNumberFree(em, scope, input.caseNumber)
      const settings = await loadSettings(em, scope)
      const deadlines = computeDeadlines(input.receivedAt, settings.deadlineMode, settings.extraHolidays ?? [])
      const id = input.id ?? randomUUID()
      const entity = em.create(PublicInfoRequest, {
        id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        caseNumber: input.caseNumber,
        caseSeq: parsedNumber.seq,
        caseYear: parsedNumber.year,
        channel: input.channel,
        receivedAt: input.receivedAt,
        letterDate: input.letterDate ?? null,
        requesterName: input.requesterName,
        requesterKind: input.requesterKind,
        requesterAddress: input.requesterAddress ?? null,
        requesterContact: input.requesterContact ?? null,
        deliveryForm: input.deliveryForm,
        subjectSummary: input.subjectSummary,
        bodyText: input.bodyText ?? null,
        status: 'new',
        assigneeUserId,
        statutoryDueDate: deadlines.statutoryDueDate,
        currentDueDate: deadlines.currentDueDate,
        dueShiftedFrom: deadlines.dueShiftedFrom,
        maxExtensionDate: deadlines.maxExtensionDate,
        source: 'manual',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(entity)
      writePoints(em, scope, id, input.points)
      recordEvent(em, scope, id, 'registered', actorOf(ctx), {
        caseNumber: input.caseNumber,
        channel: input.channel,
        currentDueDate: deadlines.currentDueDate,
      })
      await em.flush()
      return entity
    })
    await emitRequestSideEffects(ctx, request, 'created')
    return { id: request.id }
  },
  buildLog: async ({ result, ctx }) => {
    const scope = ensureScope(ctx)
    return {
      actionLabel: await auditLabel('public_info_requests.request.create', 'Register public-information request'),
      resourceKind: 'public_info_requests.request',
      resourceId: result.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      snapshotAfter: { id: result.id },
    }
  },
  async undo({ logEntry, ctx }) {
    const id = logEntry.resourceId
    if (!id) throw new Error('[internal] Missing request id for undo')
    const scope = ensureScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const request = await loadRequestOr404(em, scope, id)
    request.deletedAt = new Date()
    await em.flush()
    await emitRequestSideEffects(ctx, request, 'deleted', true)
  },
}

defineRequestCommand<RequestUpdateInput, { id: string }>({
  id: 'public_info_requests.request.update',
  label: 'Update public-information request',
  schema: requestUpdateSchema,
  async run({ em, scope, request, input, actorUserId }) {
    const previousPoints = input.points ? await loadPoints(em, scope, request.id) : []
    if (input.caseNumber && input.caseNumber !== request.caseNumber) {
      await assertCaseNumberFree(em, scope, input.caseNumber, request.id)
      const parsedNumber = parseCaseNumber(input.caseNumber)
      if (!parsedNumber) throw new CrudHttpError(422, { error: 'Invalid case number' })
      request.caseNumber = input.caseNumber
      request.caseSeq = parsedNumber.seq
      request.caseYear = parsedNumber.year
    }
    const settings = input.receivedAt && input.receivedAt !== request.receivedAt ? await loadSettings(em, scope) : null
    if (input.channel) request.channel = input.channel
    if (input.letterDate !== undefined) request.letterDate = input.letterDate
    if (input.requesterName) request.requesterName = input.requesterName
    if (input.requesterKind) request.requesterKind = input.requesterKind
    if (input.requesterAddress !== undefined) request.requesterAddress = input.requesterAddress
    if (input.requesterContact !== undefined) request.requesterContact = input.requesterContact
    if (input.deliveryForm) request.deliveryForm = input.deliveryForm
    if (input.subjectSummary) request.subjectSummary = input.subjectSummary
    if (input.bodyText !== undefined) request.bodyText = input.bodyText
    if (input.assigneeUserId !== undefined) request.assigneeUserId = input.assigneeUserId
    if (settings && input.receivedAt) {
      const deadlines = computeDeadlines(input.receivedAt, settings.deadlineMode, settings.extraHolidays ?? [])
      const wasExtended = request.currentDueDate !== request.statutoryDueDate
      request.receivedAt = input.receivedAt
      request.statutoryDueDate = deadlines.statutoryDueDate
      request.dueShiftedFrom = deadlines.dueShiftedFrom
      request.maxExtensionDate = deadlines.maxExtensionDate
      if (!wasExtended) request.currentDueDate = deadlines.currentDueDate
    }
    const created: CreatedRow[] = []
    const removedChildren: ChildRowSnapshot[] = []
    if (input.points) {
      for (const point of previousPoints) {
        removedChildren.push({ kind: 'point', row: snapshotRow(point) })
        em.remove(point)
      }
      created.push(...writePoints(em, scope, request.id, input.points))
    }
    recordEvent(em, scope, request.id, 'updated', actorUserId, null)
    return { result: { id: request.id }, created, removedChildren }
  },
})

const deleteRequestCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { id: string }> = {
  id: 'public_info_requests.request.delete',
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const id = String(rawInput.body?.id ?? rawInput.query?.id ?? '')
    const scope = ensureScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const request = await loadRequestOr404(em, scope, id)
    return { before: snapshotRequest(request) }
  },
  async execute(rawInput, ctx) {
    const id = String(rawInput.body?.id ?? rawInput.query?.id ?? '')
    if (!id) throw new CrudHttpError(400, { error: 'Request id required' })
    const scope = ensureScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const request = await loadRequestOr404(em, scope, id)
    request.deletedAt = new Date()
    recordEvent(em, scope, id, 'deleted', actorOf(ctx), null)
    await em.flush()
    await emitRequestSideEffects(ctx, request, 'deleted')
    return { id }
  },
  buildLog: async ({ snapshots, result }) => {
    const before = snapshots.before as RequestSnapshot | undefined
    return {
      actionLabel: await auditLabel('public_info_requests.request.delete', 'Delete public-information request'),
      resourceKind: 'public_info_requests.request',
      resourceId: result.id,
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      snapshotBefore: before ?? null,
    }
  },
  async undo({ logEntry, ctx }) {
    const before = logEntry.snapshotBefore as RequestSnapshot | undefined
    if (!before?.id) throw new Error('[internal] Missing snapshot for undo')
    const scope = ensureScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const request = await em.findOne(PublicInfoRequest, {
      id: before.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    if (!request) return
    request.deletedAt = null
    await em.flush()
    await emitRequestSideEffects(ctx, request, 'updated', true)
  },
}

registerCommand(createRequestCommand)
registerCommand(deleteRequestCommand)
