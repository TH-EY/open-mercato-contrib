import type { ZodType } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { CrudEmitContext, CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { assertOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import {
  PublicInfoDepartmentQuery,
  PublicInfoRedactionMark,
  PublicInfoRequest,
  PublicInfoRequestEvent,
  PublicInfoRequestPoint,
  PublicInfoResponseDraft,
} from '../data/entities'
import {
  REQUEST_ENTITY_ID,
  loadRequestOr404,
  restoreRequestFields,
  snapshotRequest,
  type RequestSnapshot,
  type Scope,
} from '../lib/server/requests'

export type CreatedRow = { kind: 'point' | 'query' | 'draft' | 'mark' | 'event'; id: string }

export type ChildRowSnapshot = { kind: 'point' | 'query' | 'draft' | 'mark'; row: Record<string, unknown> }

export type RequestCommandOutcome<TResult> = {
  result: TResult
  created?: CreatedRow[]
  changedChildren?: ChildRowSnapshot[]
  removedChildren?: ChildRowSnapshot[]
}

export type RequestCommandArgs<TInput> = {
  em: EntityManager
  scope: Scope
  request: PublicInfoRequest
  input: TInput
  actorUserId: string | null
  ctx: CommandRuntimeContext
}

type StoredOutcome = {
  request: RequestSnapshot
  created: CreatedRow[]
  changedChildren: ChildRowSnapshot[]
  removedChildren: ChildRowSnapshot[]
  result: unknown
}

export const requestCrudEvents: CrudEventsConfig<PublicInfoRequest> = {
  module: 'public_info_requests',
  entity: 'request',
  persistent: true,
  buildPayload: (emitCtx: CrudEmitContext<PublicInfoRequest>) => ({
    id: emitCtx.identifiers.id,
    tenantId: emitCtx.identifiers.tenantId,
    organizationId: emitCtx.identifiers.organizationId,
    status: emitCtx.entity?.status ?? null,
  }),
}

export const requestCrudIndexer: CrudIndexerConfig<PublicInfoRequest> = {
  entityType: REQUEST_ENTITY_ID,
  buildUpsertPayload: (emitCtx) => ({
    entityType: REQUEST_ENTITY_ID,
    recordId: emitCtx.identifiers.id,
    tenantId: emitCtx.identifiers.tenantId,
    organizationId: emitCtx.identifiers.organizationId,
  }),
  buildDeletePayload: (emitCtx) => ({
    entityType: REQUEST_ENTITY_ID,
    recordId: emitCtx.identifiers.id,
    tenantId: emitCtx.identifiers.tenantId,
    organizationId: emitCtx.identifiers.organizationId,
  }),
}

export function ensureScope(ctx: CommandRuntimeContext): Scope {
  const tenantId = ctx.auth?.tenantId ?? null
  if (!tenantId) throw new CrudHttpError(400, { error: 'Tenant context is required' })
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!organizationId) throw new CrudHttpError(400, { error: 'Organization context is required' })
  return { tenantId, organizationId }
}

export function actorOf(ctx: CommandRuntimeContext): string | null {
  const subject = ctx.auth?.sub
  return typeof subject === 'string' && subject.length > 0 ? subject : null
}

export async function emitRequestSideEffects(
  ctx: CommandRuntimeContext,
  request: PublicInfoRequest,
  action: 'created' | 'updated' | 'deleted',
  undo = false,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  const payload = {
    dataEngine,
    action,
    entity: request,
    identifiers: { id: request.id, tenantId: request.tenantId, organizationId: request.organizationId },
    syncOrigin: ctx.syncOrigin,
    events: requestCrudEvents,
    indexer: requestCrudIndexer,
  }
  if (undo) await emitCrudUndoSideEffects(payload)
  else await emitCrudSideEffects(payload)
}

type ChildEntityClass = new () => object

function childEntityClass(kind: CreatedRow['kind']): ChildEntityClass {
  if (kind === 'point') return PublicInfoRequestPoint
  if (kind === 'query') return PublicInfoDepartmentQuery
  if (kind === 'draft') return PublicInfoResponseDraft
  if (kind === 'mark') return PublicInfoRedactionMark
  return PublicInfoRequestEvent
}

export function snapshotRow(entity: object): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(entity)) {
    if (value instanceof Date) row[key] = value.toISOString()
    else if (value === undefined) continue
    else row[key] = value
  }
  return row
}

const DATE_KEYS = new Set(['createdAt', 'updatedAt', 'deletedAt', 'exportedAt', 'decidedAt', 'occurredAt'])

function reviveRow(row: Record<string, unknown>): Record<string, unknown> {
  const revived: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    revived[key] = DATE_KEYS.has(key) && typeof value === 'string' ? new Date(value) : value
  }
  return revived
}

async function restoreChildren(em: EntityManager, scope: Scope, children: ChildRowSnapshot[]): Promise<void> {
  for (const child of children) {
    const entityClass = childEntityClass(child.kind)
    const id = String(child.row.id)
    const where = { id, tenantId: scope.tenantId, organizationId: scope.organizationId } as never
    const existing = await em.findOne(entityClass as never, where)
    const values = reviveRow(child.row)
    if (existing) em.assign(existing as never, values as never)
    else em.persist(em.create(entityClass as never, values as never))
  }
}

export function defineRequestCommand<TInput extends { id: string; expectedUpdatedAt?: string }, TResult>(options: {
  id: string
  label: string
  schema: ZodType<TInput>
  run: (args: RequestCommandArgs<TInput>) => Promise<RequestCommandOutcome<TResult>>
}): CommandHandler<Record<string, unknown>, TResult> {
  const handler: CommandHandler<Record<string, unknown>, TResult> = {
    id: options.id,
    isUndoable: true,
    async prepare(rawInput, ctx) {
      const input = options.schema.parse(rawInput)
      const scope = ensureScope(ctx)
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const request = await loadRequestOr404(em, scope, input.id)
      assertOptimisticLock({
        resourceKind: REQUEST_ENTITY_ID,
        resourceId: input.id,
        expected: input.expectedUpdatedAt,
        current: request.updatedAt,
      })
      return { before: snapshotRequest(request) }
    },
    async execute(rawInput, ctx) {
      const input = options.schema.parse(rawInput)
      const scope = ensureScope(ctx)
      const baseEm = ctx.container.resolve('em') as EntityManager
      const stored = await baseEm.fork().transactional(async (em) => {
        const request = await loadRequestOr404(em, scope, input.id)
        const outcome = await options.run({ em, scope, request, input, actorUserId: actorOf(ctx), ctx })
        request.updatedAt = new Date()
        await em.flush()
        const storedOutcome: StoredOutcome = {
          request: snapshotRequest(request),
          created: outcome.created ?? [],
          changedChildren: outcome.changedChildren ?? [],
          removedChildren: outcome.removedChildren ?? [],
          result: outcome.result,
        }
        return { storedOutcome, request }
      })
      await emitRequestSideEffects(ctx, stored.request, 'updated')
      return { ...(stored.storedOutcome.result as object), __outcome: stored.storedOutcome } as TResult
    },
    buildLog: async ({ result, snapshots, input }) => {
      const before = snapshots.before as RequestSnapshot | undefined
      const outcome = (result as { __outcome?: StoredOutcome }).__outcome
      return {
        actionLabel: options.label,
        resourceKind: 'public_info_requests.request',
        resourceId: String((input as { id?: string }).id ?? before?.id ?? ''),
        tenantId: before?.tenantId ?? null,
        organizationId: before?.organizationId ?? null,
        snapshotBefore: before ?? null,
        snapshotAfter: outcome ?? null,
      }
    },
    async undo({ logEntry, ctx }) {
      const before = logEntry.snapshotBefore as RequestSnapshot | undefined
      const outcome = logEntry.snapshotAfter as StoredOutcome | undefined
      if (!before?.id) throw new Error('[internal] Missing request snapshot for undo')
      const scope = ensureScope(ctx)
      if (before.tenantId !== scope.tenantId) throw new CrudHttpError(403, { error: 'Undo scope mismatch' })
      const baseEm = ctx.container.resolve('em') as EntityManager
      const request = await baseEm.fork().transactional(async (em) => {
        const target = await loadRequestOr404(em, scope, before.id)
        for (const created of outcome?.created ?? []) {
          await em.nativeDelete(childEntityClass(created.kind) as never, {
            id: created.id,
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
          } as never)
        }
        await restoreChildren(em, scope, [...(outcome?.changedChildren ?? []), ...(outcome?.removedChildren ?? [])])
        restoreRequestFields(target, before)
        target.updatedAt = new Date()
        await em.flush()
        return target
      })
      await emitRequestSideEffects(ctx, request, 'updated', true)
    },
  }
  registerCommand(handler)
  return handler
}

export function stripOutcome<TResult>(result: TResult): Omit<TResult, '__outcome'> {
  if (result && typeof result === 'object' && '__outcome' in result) {
    const copy = { ...(result as Record<string, unknown>) }
    delete copy.__outcome
    return copy as Omit<TResult, '__outcome'>
  }
  return result as Omit<TResult, '__outcome'>
}
