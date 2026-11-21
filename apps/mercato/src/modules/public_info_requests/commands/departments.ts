import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { PublicInfoDepartment, PublicInfoSettings } from '../data/entities'
import { departmentCreateSchema, departmentUpdateSchema, settingsUpdateSchema } from '../data/validators'
import { DEPARTMENT_ENTITY_ID, loadSettings } from '../lib/server/requests'
import { auditLabel, ensureScope, snapshotRow } from './shared'

export const departmentCrudEvents: CrudEventsConfig<PublicInfoDepartment> = {
  module: 'public_info_requests',
  entity: 'department',
  persistent: false,
  buildPayload: (emitCtx) => ({
    id: emitCtx.identifiers.id,
    tenantId: emitCtx.identifiers.tenantId,
    organizationId: emitCtx.identifiers.organizationId,
  }),
}

export const departmentCrudIndexer: CrudIndexerConfig<PublicInfoDepartment> = {
  entityType: DEPARTMENT_ENTITY_ID,
  buildUpsertPayload: (emitCtx) => ({
    entityType: DEPARTMENT_ENTITY_ID,
    recordId: emitCtx.identifiers.id,
    tenantId: emitCtx.identifiers.tenantId,
    organizationId: emitCtx.identifiers.organizationId,
  }),
  buildDeletePayload: (emitCtx) => ({
    entityType: DEPARTMENT_ENTITY_ID,
    recordId: emitCtx.identifiers.id,
    tenantId: emitCtx.identifiers.tenantId,
    organizationId: emitCtx.identifiers.organizationId,
  }),
}

type DepartmentSnapshot = Record<string, unknown> & { id: string; tenantId: string; organizationId: string }

async function emitDepartment(
  ctx: CommandRuntimeContext,
  department: PublicInfoDepartment,
  action: 'created' | 'updated' | 'deleted',
  undo = false,
): Promise<void> {
  const payload = {
    dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
    action,
    entity: department,
    identifiers: { id: department.id, tenantId: department.tenantId, organizationId: department.organizationId },
    events: departmentCrudEvents,
    indexer: departmentCrudIndexer,
  }
  if (undo) await emitCrudUndoSideEffects(payload)
  else await emitCrudSideEffects(payload)
}

async function loadDepartment(em: EntityManager, scope: { tenantId: string; organizationId: string }, id: string) {
  const department = await em.findOne(PublicInfoDepartment, {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (!department) throw new CrudHttpError(404, { error: 'Department not found' })
  return department
}

const createDepartment: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'public_info_requests.department.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const input = departmentCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const department = em.create(PublicInfoDepartment, {
      id: input.id ?? randomUUID(),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      name: input.name,
      symbol: input.symbol,
      kind: input.kind,
      competenceScope: input.competenceScope,
      keywords: input.keywords,
      contractCodes: input.contractCodes,
      contactHint: input.contactHint ?? null,
      isActive: input.isActive,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await em.persist(department).flush()
    await emitDepartment(ctx, department, 'created')
    return { id: department.id }
  },
  buildLog: async ({ result, ctx }) => {
    const scope = ensureScope(ctx)
    return {
      actionLabel: await auditLabel('public_info_requests.department.create', 'Create UDIP department'),
      resourceKind: 'public_info_requests.department',
      resourceId: result.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
  async undo({ logEntry, ctx }) {
    const scope = ensureScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const department = await loadDepartment(em, scope, String(logEntry.resourceId))
    department.deletedAt = new Date()
    await em.flush()
    await emitDepartment(ctx, department, 'deleted', true)
  },
}

const updateDepartment: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'public_info_requests.department.update',
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const input = departmentUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return { before: snapshotRow(await loadDepartment(em, scope, input.id)) }
  },
  async execute(rawInput, ctx) {
    const input = departmentUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const department = await loadDepartment(em, scope, input.id)
    if (input.name !== undefined) department.name = input.name
    if (input.symbol !== undefined) department.symbol = input.symbol
    if (input.kind !== undefined) department.kind = input.kind
    if (input.competenceScope !== undefined) department.competenceScope = input.competenceScope
    if (input.keywords !== undefined) department.keywords = input.keywords
    if (input.contractCodes !== undefined) department.contractCodes = input.contractCodes
    if (input.contactHint !== undefined) department.contactHint = input.contactHint
    if (input.isActive !== undefined) department.isActive = input.isActive
    department.updatedAt = new Date()
    await em.flush()
    await emitDepartment(ctx, department, 'updated')
    return { id: department.id }
  },
  buildLog: async ({ result, snapshots }) => {
    const before = snapshots.before as DepartmentSnapshot | undefined
    return {
      actionLabel: await auditLabel('public_info_requests.department.update', 'Update UDIP department'),
      resourceKind: 'public_info_requests.department',
      resourceId: result.id,
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      snapshotBefore: before ?? null,
    }
  },
  async undo({ logEntry, ctx }) {
    const before = logEntry.snapshotBefore as DepartmentSnapshot | undefined
    if (!before?.id) throw new Error('[internal] Missing department snapshot')
    const scope = ensureScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const department = await loadDepartment(em, scope, before.id)
    department.name = String(before.name)
    department.symbol = String(before.symbol)
    department.kind = before.kind as PublicInfoDepartment['kind']
    department.competenceScope = String(before.competenceScope ?? '')
    department.keywords = (before.keywords as string[] | null) ?? []
    department.contractCodes = (before.contractCodes as string[] | null) ?? []
    department.contactHint = (before.contactHint as string | null) ?? null
    department.isActive = Boolean(before.isActive)
    await em.flush()
    await emitDepartment(ctx, department, 'updated', true)
  },
}

const deleteDepartment: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { id: string }> = {
  id: 'public_info_requests.department.delete',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const id = String(rawInput.body?.id ?? rawInput.query?.id ?? '')
    const scope = ensureScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const department = await loadDepartment(em, scope, id)
    department.deletedAt = new Date()
    await em.flush()
    await emitDepartment(ctx, department, 'deleted')
    return { id }
  },
  buildLog: async ({ result, ctx }) => {
    const scope = ensureScope(ctx)
    return {
      actionLabel: await auditLabel('public_info_requests.department.delete', 'Delete UDIP department'),
      resourceKind: 'public_info_requests.department',
      resourceId: result.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
  async undo({ logEntry, ctx }) {
    const scope = ensureScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const department = await em.findOne(PublicInfoDepartment, {
      id: String(logEntry.resourceId),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    if (!department) return
    department.deletedAt = null
    await em.flush()
    await emitDepartment(ctx, department, 'updated', true)
  },
}

type SettingsSnapshot = Record<string, unknown>

const updateSettings: CommandHandler<Record<string, unknown>, { ok: true }> = {
  id: 'public_info_requests.settings.update',
  isUndoable: true,
  async prepare(_rawInput, ctx) {
    const scope = ensureScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return { before: snapshotRow(await loadSettings(em, scope)) }
  },
  async execute(rawInput, ctx) {
    const input = settingsUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const settings = await loadSettings(em, scope)
    em.assign(settings, { ...input, updatedAt: new Date() })
    await em.flush()
    return { ok: true }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const scope = ensureScope(ctx)
    return {
      actionLabel: await auditLabel('public_info_requests.settings.update', 'Update UDIP settings'),
      resourceKind: 'public_info_requests.settings',
      resourceId: scope.organizationId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      snapshotBefore: (snapshots.before as SettingsSnapshot | undefined) ?? null,
    }
  },
  async undo({ logEntry, ctx }) {
    const before = logEntry.snapshotBefore as SettingsSnapshot | undefined
    if (!before) return
    const scope = ensureScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const settings = await em.findOne(PublicInfoSettings, { tenantId: scope.tenantId, organizationId: scope.organizationId })
    if (!settings) return
    settings.deadlineMode = before.deadlineMode === 'working' ? 'working' : 'calendar'
    settings.internalDueOffsetWorkingDays = Number(before.internalDueOffsetWorkingDays ?? 5)
    settings.clarificationDays = Number(before.clarificationDays ?? 7)
    settings.similarityThreshold = Number(before.similarityThreshold ?? 0.2)
    settings.similarityWindowMonths = Number(before.similarityWindowMonths ?? 24)
    settings.extraHolidays = Array.isArray(before.extraHolidays) ? (before.extraHolidays as string[]) : []
    settings.publicOfficials = Array.isArray(before.publicOfficials) ? (before.publicOfficials as string[]) : []
    await em.flush()
  },
}

registerCommand(createDepartment)
registerCommand(updateDepartment)
registerCommand(deleteDepartment)
registerCommand(updateSettings)
