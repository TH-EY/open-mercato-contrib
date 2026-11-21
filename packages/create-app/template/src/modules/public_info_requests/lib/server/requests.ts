import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  PublicInfoRequest,
  PublicInfoRequestEvent,
  PublicInfoRequestPoint,
  PublicInfoSettings,
  type PublicInfoRequestStatus,
} from '../../data/entities'
import { CASE_NUMBER_PATTERN } from '../../data/validators'
import {
  maxExtensionDate,
  statutoryDueDate,
  type DeadlineMode,
  type IsoDate,
} from '../deadlines'

export type Scope = { tenantId: string; organizationId: string }

export const REQUEST_ENTITY_ID = 'public_info_requests:public_info_request'
export const POINT_ENTITY_ID = 'public_info_requests:public_info_request_point'
export const DEPARTMENT_ENTITY_ID = 'public_info_requests:public_info_department'
export const REDACTION_ENTITY_ID = 'public_info_requests:public_info_redaction_mark'

export const OPEN_STATUSES: PublicInfoRequestStatus[] = [
  'new',
  'sent_to_departments',
  'extended',
  'awaiting_clarification',
  'in_preparation',
  'prepared',
]

export type DeadlineSnapshot = {
  statutoryDueDate: IsoDate
  currentDueDate: IsoDate
  dueShiftedFrom: IsoDate | null
  maxExtensionDate: IsoDate
  explanation: string
}

export async function loadSettings(em: EntityManager, scope: Scope): Promise<PublicInfoSettings> {
  const existing = await em.findOne(PublicInfoSettings, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (existing) return existing
  const writer = em.fork()
  const created = writer.create(PublicInfoSettings, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deadlineMode: 'calendar',
    internalDueOffsetWorkingDays: 5,
    clarificationDays: 7,
    similarityThreshold: 0.2,
    similarityWindowMonths: 24,
    extraHolidays: [],
    publicOfficials: [],
    letterhead: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  try {
    await writer.persist(created).flush()
  } catch (error) {
    const raced = await em.fork().findOne(PublicInfoSettings, { tenantId: scope.tenantId, organizationId: scope.organizationId })
    if (!raced) throw error
  }
  return (await em.findOne(PublicInfoSettings, { tenantId: scope.tenantId, organizationId: scope.organizationId })) ?? created
}

export function computeDeadlines(
  receivedAt: IsoDate,
  mode: DeadlineMode,
  extraHolidays: IsoDate[] = [],
): DeadlineSnapshot {
  const statutory = statutoryDueDate(receivedAt, mode, extraHolidays)
  const maxExtension = maxExtensionDate(receivedAt, extraHolidays)
  return {
    statutoryDueDate: statutory.due,
    currentDueDate: statutory.due,
    dueShiftedFrom: statutory.shiftedFrom,
    maxExtensionDate: maxExtension.due,
    explanation: statutory.explanation,
  }
}

export function parseCaseNumber(caseNumber: string): { seq: number; year: number } | null {
  const match = CASE_NUMBER_PATTERN.exec(caseNumber.trim())
  if (!match) return null
  return { seq: Number(match[1]), year: Number(match[2]) }
}

export function formatCaseNumber(seq: number, year: number): string {
  return `BKS.IV.1431.${seq}.${year}`
}

export async function nextCaseNumber(em: EntityManager, scope: Scope, year: number): Promise<{ caseNumber: string; seq: number }> {
  const rows = await em.find(
    PublicInfoRequest,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, caseYear: year },
    { fields: ['caseSeq'], orderBy: { caseSeq: 'desc' }, limit: 1 },
  )
  const seq = (rows[0]?.caseSeq ?? 0) + 1
  return { caseNumber: formatCaseNumber(seq, year), seq }
}

export async function assertCaseNumberFree(em: EntityManager, scope: Scope, caseNumber: string, exceptId?: string): Promise<void> {
  const clash = await em.findOne(PublicInfoRequest, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    caseNumber,
  })
  if (clash && clash.id !== exceptId) {
    throw new CrudHttpError(422, {
      error: 'Case number already used',
      fieldErrors: { caseNumber: 'public_info_requests.errors.caseNumberTaken' },
    })
  }
}

export async function loadRequestOr404(em: EntityManager, scope: Scope, id: string): Promise<PublicInfoRequest> {
  const request = await findOneWithDecryption(
    em,
    PublicInfoRequest,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<PublicInfoRequest>,
    undefined,
    scope,
  )
  if (!request) throw new CrudHttpError(404, { error: 'Request not found' })
  return request
}

export async function loadPoints(em: EntityManager, scope: Scope, requestId: string): Promise<PublicInfoRequestPoint[]> {
  const points = await findWithDecryption(
    em,
    PublicInfoRequestPoint,
    { requestId, tenantId: scope.tenantId, organizationId: scope.organizationId } as FilterQuery<PublicInfoRequestPoint>,
    { orderBy: { position: 'asc' } },
    scope,
  )
  return points
}

export type RequestSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  caseNumber: string
  caseSeq: number
  caseYear: number
  channel: string
  receivedAt: string
  letterDate: string | null
  requesterName: string
  requesterKind: string
  requesterAddress: string | null
  requesterContact: string | null
  deliveryForm: string
  subjectSummary: string
  bodyText: string | null
  status: string
  assigneeUserId: string | null
  statutoryDueDate: string
  currentDueDate: string
  dueShiftedFrom: string | null
  maxExtensionDate: string
  extendedAt: string | null
  extensionReason: string | null
  pausedAt: string | null
  clarificationDeliveredAt: string | null
  clarificationDueDate: string | null
  respondedAt: string | null
  responseChannel: string | null
  finalLetterType: string | null
  similarChoice: PublicInfoRequest['similarChoice']
  archiveText: string | null
  source: string
  points?: Array<{ position: number; text: string }>
}

function isoOrNull(value: Date | null | undefined): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null
}

function dateOrNull(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null
}

export function snapshotRequest(request: PublicInfoRequest, points?: PublicInfoRequestPoint[]): RequestSnapshot {
  return {
    id: request.id,
    tenantId: request.tenantId,
    organizationId: request.organizationId,
    caseNumber: request.caseNumber,
    caseSeq: request.caseSeq,
    caseYear: request.caseYear,
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
    statutoryDueDate: request.statutoryDueDate,
    currentDueDate: request.currentDueDate,
    dueShiftedFrom: request.dueShiftedFrom ?? null,
    maxExtensionDate: request.maxExtensionDate,
    extendedAt: isoOrNull(request.extendedAt),
    extensionReason: request.extensionReason ?? null,
    pausedAt: isoOrNull(request.pausedAt),
    clarificationDeliveredAt: request.clarificationDeliveredAt ?? null,
    clarificationDueDate: request.clarificationDueDate ?? null,
    respondedAt: request.respondedAt ?? null,
    responseChannel: request.responseChannel ?? null,
    finalLetterType: request.finalLetterType ?? null,
    similarChoice: request.similarChoice ?? null,
    archiveText: request.archiveText ?? null,
    source: request.source,
    ...(points ? { points: points.map((point) => ({ position: point.position, text: point.text })) } : {}),
  }
}

export function restoreRequestFields(request: PublicInfoRequest, snapshot: RequestSnapshot): void {
  request.caseNumber = snapshot.caseNumber
  request.caseSeq = snapshot.caseSeq
  request.caseYear = snapshot.caseYear
  request.channel = snapshot.channel as PublicInfoRequest['channel']
  request.receivedAt = snapshot.receivedAt
  request.letterDate = snapshot.letterDate
  request.requesterName = snapshot.requesterName
  request.requesterKind = snapshot.requesterKind as PublicInfoRequest['requesterKind']
  request.requesterAddress = snapshot.requesterAddress
  request.requesterContact = snapshot.requesterContact
  request.deliveryForm = snapshot.deliveryForm as PublicInfoRequest['deliveryForm']
  request.subjectSummary = snapshot.subjectSummary
  request.bodyText = snapshot.bodyText
  request.status = snapshot.status as PublicInfoRequestStatus
  request.assigneeUserId = snapshot.assigneeUserId
  request.statutoryDueDate = snapshot.statutoryDueDate
  request.currentDueDate = snapshot.currentDueDate
  request.dueShiftedFrom = snapshot.dueShiftedFrom
  request.maxExtensionDate = snapshot.maxExtensionDate
  request.extendedAt = dateOrNull(snapshot.extendedAt)
  request.extensionReason = snapshot.extensionReason
  request.pausedAt = dateOrNull(snapshot.pausedAt)
  request.clarificationDeliveredAt = snapshot.clarificationDeliveredAt
  request.clarificationDueDate = snapshot.clarificationDueDate
  request.respondedAt = snapshot.respondedAt
  request.responseChannel = snapshot.responseChannel
  request.finalLetterType = snapshot.finalLetterType
  request.similarChoice = snapshot.similarChoice
  request.archiveText = snapshot.archiveText
  request.source = snapshot.source as PublicInfoRequest['source']
}

export function recordEvent(
  em: EntityManager,
  scope: Scope,
  requestId: string,
  kind: string,
  actorUserId: string | null,
  payload: Record<string, unknown> | null = null,
): PublicInfoRequestEvent {
  const event = em.create(PublicInfoRequestEvent, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    requestId,
    kind,
    actorUserId,
    payload,
    occurredAt: new Date(),
  })
  em.persist(event)
  return event
}

export function transitionStatus(
  em: EntityManager,
  scope: Scope,
  request: PublicInfoRequest,
  next: PublicInfoRequestStatus,
  actorUserId: string | null,
): boolean {
  if (request.status === next) return false
  const previous = request.status
  request.status = next
  recordEvent(em, scope, request.id, 'status_changed', actorUserId, { from: previous, to: next })
  return true
}
