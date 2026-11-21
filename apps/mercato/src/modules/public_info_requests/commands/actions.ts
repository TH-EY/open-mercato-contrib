import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  PublicInfoDepartmentQuery,
  PublicInfoRequest,
  PublicInfoRequestEvent,
  PublicInfoRedactionMark,
  PublicInfoResponseDraft,
  type PublicInfoRequestStatus,
  type StoredDraftParagraph,
} from '../data/entities'
import {
  clarificationDeliverySchema,
  draftGenerateSchema,
  draftUpdateSchema,
  extendSchema,
  markSentSchema,
  piiDetectSchema,
  queriesMarkSentSchema,
  queryReplySchema,
  redactionDecisionSchema,
  redactionManualSchema,
  registerClarificationSchema,
  requestClarificationSchema,
  routingAcceptSchema,
  similarChoiceSchema,
} from '../data/validators'
import { recordEvent, transitionStatus, loadSettings, loadPoints, computeDeadlines } from '../lib/server/requests'
import {
  buildLetterContext,
  detectPii,
  generateDraftParagraphs,
  loadCaseDocuments,
  loadReplyTexts,
  requestPointsOrSummary,
  toStoredParagraphs,
} from '../lib/server/caseServices'
import { assertDraftExportable, attachmentTextHash, readPiiChecked, redactParagraphs, type PiiChecked } from '../lib/server/redaction'
import { checkGrounding, contentHash } from '../lib/drafting/grounding'
import { renderLetterText } from '../lib/drafting/render'
import { anonymizeForArchive } from '../lib/pii/redact'
import { clarificationDueDate, maxExtensionDate, todayIso } from '../lib/deadlines'
import type { LetterType } from '../lib/drafting/types'
import { assertAssignable } from '../lib/server/users'
import { defineRequestCommand, snapshotRow, type ChildRowSnapshot, type CreatedRow } from './shared'

const OPEN_STATUSES: PublicInfoRequestStatus[] = ['new', 'sent_to_departments', 'extended', 'in_preparation', 'prepared']
const ARCHIVABLE_STATUSES: PublicInfoRequestStatus[] = ['new', 'sent_to_departments', 'extended', 'awaiting_clarification', 'in_preparation', 'prepared']
const EXTENDABLE_STATUSES: PublicInfoRequestStatus[] = ['new', 'sent_to_departments', 'in_preparation', 'prepared']

async function loadDraftMarks(em: EntityManager, scope: { tenantId: string; organizationId: string }, draftId: string): Promise<PublicInfoRedactionMark[]> {
  return findWithDecryption(
    em,
    PublicInfoRedactionMark,
    { draftId, tenantId: scope.tenantId, organizationId: scope.organizationId } as FilterQuery<PublicInfoRedactionMark>,
    undefined,
    scope,
  )
}

const withId = <T extends z.ZodRawShape>(shape: T) => z.object({ id: z.string().uuid(), expectedUpdatedAt: z.string().optional(), ...shape })

defineRequestCommand({
  id: 'public_info_requests.request.record_similar_choice',
  label: 'Record similar-request decision',
  schema: withId(similarChoiceSchema.shape),
  async run({ em, scope, request, input, actorUserId }) {
    request.similarChoice = {
      matchedRequestId: input.matchedRequestId ?? null,
      similarity: input.similarity ?? null,
      action: input.action,
    }
    recordEvent(em, scope, request.id, 'similar_choice', actorUserId, {
      matchedRequestId: input.matchedRequestId ?? null,
      similarity: input.similarity ?? null,
      action: input.action,
    })
    return { result: { ok: true } }
  },
})

defineRequestCommand({
  id: 'public_info_requests.routing.accept',
  label: 'Accept routing proposal',
  schema: withId(routingAcceptSchema.shape),
  async run({ em, scope, request, input, actorUserId }) {
    const created: CreatedRow[] = []
    for (const query of input.queries) {
      const id = randomUUID()
      em.persist(
        em.create(PublicInfoDepartmentQuery, {
          id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          requestId: request.id,
          departmentId: query.departmentId,
          pointPositions: query.pointPositions,
          scopeText: query.scopeText,
          internalDueDate: query.internalDueDate ?? null,
          aiConfidence: query.confidence ?? null,
          aiSources: query.sources ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      )
      created.push({ kind: 'query', id })
    }
    recordEvent(em, scope, request.id, 'routing_accepted', actorUserId, {
      departments: input.queries.map((query) => query.departmentId),
    })
    return { result: { queryIds: created.map((row) => row.id) }, created }
  },
})

defineRequestCommand({
  id: 'public_info_requests.department_query.mark_sent',
  label: 'Mark department notes as sent',
  schema: withId(queriesMarkSentSchema.shape),
  async run({ em, scope, request, input, actorUserId }) {
    const queries = await em.find(PublicInfoDepartmentQuery, {
      id: { $in: input.ids },
      requestId: request.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    const changedChildren: ChildRowSnapshot[] = queries.map((query) => ({ kind: 'query', row: snapshotRow(query) }))
    for (const query of queries) query.sentAt = input.sentAt
    if (['new', 'in_preparation'].includes(request.status)) transitionStatus(em, scope, request, 'sent_to_departments', actorUserId)
    recordEvent(em, scope, request.id, 'notes_sent', actorUserId, { count: queries.length, sentAt: input.sentAt })
    return { result: { ok: true }, changedChildren }
  },
})

defineRequestCommand({
  id: 'public_info_requests.department_query.record_reply',
  label: 'Record department reply',
  schema: withId({ queryId: z.string().uuid(), ...queryReplySchema.omit({ id: true }).shape }),
  async run({ em, scope, request, input, actorUserId }) {
    const query = await em.findOne(PublicInfoDepartmentQuery, {
      id: input.queryId,
      requestId: request.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    if (!query) throw new CrudHttpError(404, { error: 'Department query not found' })
    const changedChildren: ChildRowSnapshot[] = [{ kind: 'query', row: snapshotRow(query) }]
    query.replyKind = input.replyKind
    query.receivedAt = input.receivedAt
    query.replyAttachmentIds = input.replyAttachmentIds
    if (input.pointPositions) query.pointPositions = input.pointPositions
    if (['new', 'sent_to_departments', 'extended'].includes(request.status)) transitionStatus(em, scope, request, 'in_preparation', actorUserId)
    recordEvent(em, scope, request.id, 'reply_recorded', actorUserId, { queryId: query.id, replyKind: input.replyKind })
    return { result: { ok: true }, changedChildren }
  },
})

type DetectedSpan = { start: number; end: number; category: string; detector: 'rule' | 'ai' | 'manual' }

async function detectParagraphSpans(
  container: Parameters<typeof detectPii>[0]['container'],
  scope: Parameters<typeof detectPii>[0]['scope'],
  paragraphs: StoredDraftParagraph[],
  publicOfficials: string[],
  keepNames: string[],
): Promise<Record<string, DetectedSpan[]>> {
  const result: Record<string, DetectedSpan[]> = {}
  for (const paragraph of paragraphs) {
    if (!paragraph.text.trim() || paragraph.kind === 'closing') continue
    const spans = await detectPii({ container, scope, text: paragraph.text, publicOfficials, keepNames })
    result[paragraph.id] = spans.map((span) => ({ start: span.start, end: span.end, category: span.category, detector: span.detector }))
  }
  return result
}

function archiveAnswerText(archiveText: string | null | undefined): string {
  if (!archiveText) return ''
  const marker = archiveText.indexOf('ODPOWIEDŹ')
  return (marker >= 0 ? archiveText.slice(marker + 'ODPOWIEDŹ'.length) : archiveText).trim()
}

function archiveDepartmentName(answer: string): string | null {
  const normalized = answer.replace(/\s+/g, ' ')
  const match = /tj\. ((?:Wydział|Biuro|Zarząd|Miejsk)[^,.;]*?) (?:Urzędu Miasta|UMB\b)/u.exec(normalized)
  return match ? match[1].trim() : null
}

type GeneratedDraft = Awaited<ReturnType<typeof generateDraftParagraphs>> & {
  letterOptions: Record<string, unknown>
  attachmentList: string[]
}

defineRequestCommand<z.infer<ReturnType<typeof draftGenerateInput>>, { draftId: string }, GeneratedDraft>({
  id: 'public_info_requests.draft.generate',
  label: 'Generate response draft',
  schema: draftGenerateInput(),
  async precompute({ em, scope, request, input, actorUserId, ctx }) {
    const settings = await loadSettings(em, scope)
    const points = await requestPointsOrSummary(em, scope, request)
    const { replies, departmentNames } = await loadReplyTexts(em, scope, request.id)
    let archiveAnswer: { documentId: string; text: string; caseNumber?: string; departmentName?: string | null } | null = null
    if (input.baseOn === 'archive_answer' && request.similarChoice?.matchedRequestId) {
      const matched = await em.findOne(PublicInfoRequest, {
        id: request.similarChoice.matchedRequestId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
      const text = archiveAnswerText(matched?.archiveText)
      if (matched && text) archiveAnswer = { documentId: `archive:${matched.id}`, text, caseNumber: matched.caseNumber, departmentName: archiveDepartmentName(text) }
    }
    const options = input.options ?? {}
    const letterDepartments = departmentNames.length === 0 && archiveAnswer?.departmentName ? [archiveAnswer.departmentName] : departmentNames
    const context = await buildLetterContext({ em, scope, request, points, departmentNames: letterDepartments, options, settings })
    const generated = await generateDraftParagraphs({
      container: ctx.container,
      scope: { ...scope, userId: actorUserId ?? '' },
      letterType: input.letterType as LetterType,
      context,
      replies,
      archiveAnswer,
    })
    return { ...generated, letterOptions: { ...options, departmentNames: letterDepartments, letterDate: context.letterDate }, attachmentList: [] }
  },
  async run({ em, scope, request, input, actorUserId, pre }) {
    const latest = await em.findOne(PublicInfoResponseDraft, { requestId: request.id, tenantId: scope.tenantId, organizationId: scope.organizationId }, { orderBy: { version: 'desc' } })
    const id = randomUUID()
    em.persist(
      em.create(PublicInfoResponseDraft, {
        id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        requestId: request.id,
        version: (latest?.version ?? 0) + 1,
        letterType: input.letterType,
        status: 'draft',
        paragraphs: toStoredParagraphs(pre.paragraphs),
        attachmentList: pre.attachmentList,
        letterOptions: pre.letterOptions,
        generatedBy: pre.generatedBy,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
    if (['new', 'sent_to_departments', 'extended'].includes(request.status) && input.letterType === 'answer') {
      transitionStatus(em, scope, request, 'in_preparation', actorUserId)
    }
    recordEvent(em, scope, request.id, pre.generatedBy === 'ai' ? 'ai_suggestion' : 'draft_generated', actorUserId, {
      draftId: id,
      letterType: input.letterType,
      generatedBy: pre.generatedBy,
      gaps: pre.paragraphs.filter((paragraph) => paragraph.flags.includes('gap')).length,
      unsupported: pre.paragraphs.filter((paragraph) => paragraph.flags.includes('unsupported') || paragraph.flags.includes('number_mismatch')).length,
    })
    return { result: { draftId: id }, created: [{ kind: 'draft', id }] }
  },
})

function draftGenerateInput() {
  return withId(draftGenerateSchema.shape)
}

function draftUpdateInput() {
  return withId({ draftId: z.string().uuid(), ...draftUpdateSchema.omit({ expectedUpdatedAt: true }).shape })
}

type DraftUpdatePre = { stored: StoredDraftParagraph[]; changedSpans: Record<string, DetectedSpan[]> }

defineRequestCommand<z.infer<ReturnType<typeof draftUpdateInput>>, { ok: true }, DraftUpdatePre>({
  id: 'public_info_requests.draft.update',
  label: 'Edit response draft',
  schema: draftUpdateInput(),
  async precompute({ em, scope, request, input, actorUserId, ctx }) {
    const draft = await em.findOne(PublicInfoResponseDraft, { id: input.draftId, requestId: request.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null })
    if (!draft) throw new CrudHttpError(404, { error: 'Draft not found' })
    const previousById = new Map(draft.paragraphs.map((paragraph) => [paragraph.id, paragraph]))
    const incoming = input.paragraphs
      ? input.paragraphs.map((paragraph) => ({ ...paragraph, contentHash: contentHash(paragraph.text), confirmedBy: null as string | null }))
      : draft.paragraphs.map((paragraph) => ({ ...paragraph }))
    const documents = await loadCaseDocuments(em, scope, request.id, 'reply')
    const points = await loadPoints(em, scope, request.id)
    const grounded = checkGrounding(
      incoming.map((paragraph) => ({ ...paragraph, flags: paragraph.flags.filter((flag) => flag === 'assistant_only') })),
      {
        points: points.map((point) => ({ position: point.position, text: point.text })),
        caseNumber: request.caseNumber,
        letterDate: String((draft.letterOptions as Record<string, unknown> | null)?.letterDate ?? todayIso()),
        receivedAt: request.receivedAt,
        requestDate: request.letterDate ?? null,
      },
      documents.map((document) => ({ attachmentId: document.id, text: document.extractedText ?? '' })),
    )
    const confirm = new Set(input.confirmParagraphIds ?? [])
    const stored = toStoredParagraphs(grounded).map((paragraph) => {
      const previous = previousById.get(paragraph.id)
      const keptConfirmation = previous?.confirmedBy && previous.contentHash === paragraph.contentHash ? previous.confirmedBy : null
      return { ...paragraph, confirmedBy: confirm.has(paragraph.id) ? actorUserId ?? 'officer' : keptConfirmation }
    })
    const changed = stored.filter((paragraph) => previousById.get(paragraph.id)?.contentHash !== paragraph.contentHash)
    const settings = await loadSettings(em, scope)
    const changedSpans = await detectParagraphSpans(ctx.container, { ...scope, userId: actorUserId ?? '' }, changed, settings.publicOfficials ?? [], [request.requesterName])
    return { stored, changedSpans }
  },
  async run({ em, scope, request, input, actorUserId, pre }) {
    const draft = await em.findOne(PublicInfoResponseDraft, { id: input.draftId, requestId: request.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null })
    if (!draft) throw new CrudHttpError(404, { error: 'Draft not found' })
    const changedChildren: ChildRowSnapshot[] = [{ kind: 'draft', row: snapshotRow(draft) }]
    const removedChildren: ChildRowSnapshot[] = []
    const created: CreatedRow[] = []
    const stored = pre.stored
    const hashById = new Map(stored.map((paragraph) => [paragraph.id, paragraph.contentHash]))
    const marks = await loadDraftMarks(em, scope, draft.id)
    const priorDecisions = new Map<string, PublicInfoRedactionMark[]>()
    for (const mark of marks) {
      if (!mark.paragraphId || hashById.get(mark.paragraphId) === mark.sourceHash) continue
      removedChildren.push({ kind: 'mark', row: snapshotRow(mark) })
      if (mark.state !== 'suggested') {
        const list = priorDecisions.get(mark.paragraphId) ?? []
        list.push(mark)
        priorDecisions.set(mark.paragraphId, list)
      }
      em.remove(mark)
    }
    for (const [paragraphId, spans] of Object.entries(pre.changedSpans)) {
      const paragraph = stored.find((candidate) => candidate.id === paragraphId)
      if (!paragraph) continue
      const decisions = priorDecisions.get(paragraphId) ?? []
      const seen = new Set<string>()
      const addMark = (values: { start: number; end: number; category: string; detector: 'rule' | 'ai' | 'manual'; state: 'suggested' | 'accepted' | 'rejected' | 'kept'; reason?: string | null }) => {
        const key = `${values.start}:${values.end}`
        if (seen.has(key)) return
        seen.add(key)
        const id = randomUUID()
        em.persist(
          em.create(PublicInfoRedactionMark, {
            id,
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            requestId: request.id,
            targetKind: 'draft',
            draftId: draft.id,
            paragraphId,
            startOffset: values.start,
            endOffset: values.end,
            sourceHash: paragraph.contentHash,
            textExcerpt: paragraph.text.slice(values.start, values.end),
            category: values.category,
            detector: values.detector,
            state: values.state,
            reason: values.reason ?? null,
            decidedByUserId: values.state === 'suggested' ? null : actorUserId,
            decidedAt: values.state === 'suggested' ? null : new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        )
        created.push({ kind: 'mark', id })
      }
      for (const span of spans) {
        const excerpt = paragraph.text.slice(span.start, span.end)
        const prior = decisions.find((decision) => decision.textExcerpt === excerpt)
        addMark({ ...span, state: prior ? prior.state : 'suggested', reason: prior?.reason ?? null })
      }
      for (const decision of decisions) {
        if (decision.state !== 'accepted') continue
        const start = paragraph.text.indexOf(decision.textExcerpt)
        if (start < 0) continue
        addMark({ start, end: start + decision.textExcerpt.length, category: decision.category, detector: decision.detector, state: 'accepted' })
      }
    }
    draft.paragraphs = stored
    if (input.attachmentList) draft.attachmentList = input.attachmentList
    const piiChecked: PiiChecked = { ...readPiiChecked(draft.letterOptions) }
    piiChecked.paragraphs = { ...(piiChecked.paragraphs ?? {}) }
    for (const paragraphId of Object.keys(pre.changedSpans)) piiChecked.paragraphs[paragraphId] = hashById.get(paragraphId) ?? ''
    draft.letterOptions = { ...(draft.letterOptions ?? {}), piiChecked }
    if (input.status) {
      if (input.status === 'ready') {
        const unresolved = stored.filter((paragraph) => paragraph.flags.length > 0 && !paragraph.confirmedBy)
        if (unresolved.length > 0) {
          throw new CrudHttpError(409, { error: 'Draft has unresolved flags', code: 'draft_not_ready', paragraphIds: unresolved.map((paragraph) => paragraph.id) })
        }
        draft.status = 'ready'
        if (['new', 'sent_to_departments', 'extended', 'in_preparation'].includes(request.status)) transitionStatus(em, scope, request, 'prepared', actorUserId)
      } else {
        draft.status = 'draft'
        if (request.status === 'prepared') transitionStatus(em, scope, request, 'in_preparation', actorUserId)
      }
    } else if (draft.status === 'ready' && Object.keys(pre.changedSpans).length > 0) {
      draft.status = 'draft'
      if (request.status === 'prepared') transitionStatus(em, scope, request, 'in_preparation', actorUserId)
    }
    draft.updatedAt = new Date()
    recordEvent(em, scope, request.id, 'draft_updated', actorUserId, { draftId: draft.id, status: draft.status })
    return { result: { ok: true }, changedChildren, removedChildren, created }
  },
})

type DetectPre = { draftSpans: Record<string, DetectedSpan[]>; documentSpans: Record<string, { hash: string; text: string; spans: DetectedSpan[] }>; draftHashes: Record<string, { hash: string; text: string }> }

function detectInput() {
  return withId({ draftId: z.string().uuid().optional(), ...piiDetectSchema.shape })
}

defineRequestCommand<z.infer<ReturnType<typeof detectInput>>, { created: number }, DetectPre>({
  id: 'public_info_requests.redaction_mark.detect',
  label: 'Detect personal data',
  schema: detectInput(),
  async precompute({ em, scope, request, input, actorUserId, ctx }) {
    const settings = await loadSettings(em, scope)
    const publicOfficials = settings.publicOfficials ?? []
    const actorScope = { ...scope, userId: actorUserId ?? '' }
    const draftSpans: DetectPre['draftSpans'] = {}
    const draftHashes: DetectPre['draftHashes'] = {}
    if (input.draftId) {
      const draft = await em.findOne(PublicInfoResponseDraft, { id: input.draftId, requestId: request.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null })
      if (!draft) throw new CrudHttpError(404, { error: 'Draft not found' })
      Object.assign(draftSpans, await detectParagraphSpans(ctx.container, actorScope, draft.paragraphs, publicOfficials, [request.requesterName]))
      for (const paragraph of draft.paragraphs) draftHashes[paragraph.id] = { hash: paragraph.contentHash || contentHash(paragraph.text), text: paragraph.text }
    }
    const documentSpans: DetectPre['documentSpans'] = {}
    if (input.includeAttachments) {
      const documents = await loadCaseDocuments(em, scope, request.id, 'reply')
      for (const document of documents) {
        const text = document.extractedText ?? ''
        if (!text.trim()) continue
        const spans = await detectPii({ container: ctx.container, scope: actorScope, text, publicOfficials, keepNames: [] })
        documentSpans[document.id] = { hash: attachmentTextHash(text), text, spans: spans.map((span) => ({ start: span.start, end: span.end, category: span.category, detector: span.detector })) }
      }
    }
    return { draftSpans, documentSpans, draftHashes }
  },
  async run({ em, scope, request, input, actorUserId, pre }) {
    const documentIds = Object.keys(pre.documentSpans)
    const existing = await em.find(PublicInfoRedactionMark, { requestId: request.id, tenantId: scope.tenantId, organizationId: scope.organizationId })
    const relevant = existing.filter((mark) => (mark.targetKind === 'draft' ? mark.draftId === input.draftId : mark.attachmentId !== null && documentIds.includes(mark.attachmentId ?? '')))
    const created: CreatedRow[] = []
    const removedChildren: ChildRowSnapshot[] = []
    const keyOf = (values: { targetKind: string; draftId?: string | null; paragraphId?: string | null; attachmentId?: string | null; startOffset: number; endOffset: number; sourceHash: string }) =>
      `${values.targetKind}:${values.draftId ?? ''}:${values.paragraphId ?? values.attachmentId ?? ''}:${values.startOffset}:${values.endOffset}:${values.sourceHash}`
    const keep = new Set(relevant.filter((mark) => mark.state !== 'suggested').map((mark) => keyOf(mark)))
    for (const mark of relevant) {
      if (mark.state === 'suggested') {
        removedChildren.push({ kind: 'mark', row: snapshotRow(mark) })
        em.remove(mark)
      }
    }
    const addMark = (values: { targetKind: 'draft' | 'attachment'; draftId?: string | null; paragraphId?: string | null; attachmentId?: string | null; startOffset: number; endOffset: number; sourceHash: string; textExcerpt: string; category: string; detector: 'rule' | 'ai' | 'manual' }) => {
      const key = keyOf(values)
      if (keep.has(key)) return
      keep.add(key)
      const id = randomUUID()
      em.persist(em.create(PublicInfoRedactionMark, { id, tenantId: scope.tenantId, organizationId: scope.organizationId, requestId: request.id, state: 'suggested', createdAt: new Date(), updatedAt: new Date(), ...values }))
      created.push({ kind: 'mark', id })
    }
    const piiCheckedPatch: PiiChecked = { paragraphs: {}, documents: {} }
    for (const [paragraphId, spans] of Object.entries(pre.draftSpans)) {
      const info = pre.draftHashes[paragraphId]
      if (!info) continue
      piiCheckedPatch.paragraphs![paragraphId] = info.hash
      for (const span of spans) {
        addMark({ targetKind: 'draft', draftId: input.draftId ?? null, paragraphId, startOffset: span.start, endOffset: span.end, sourceHash: info.hash, textExcerpt: info.text.slice(span.start, span.end), category: span.category, detector: span.detector })
      }
    }
    for (const [paragraphId, info] of Object.entries(pre.draftHashes)) {
      if (!piiCheckedPatch.paragraphs![paragraphId]) piiCheckedPatch.paragraphs![paragraphId] = info.hash
    }
    for (const [documentId, info] of Object.entries(pre.documentSpans)) {
      piiCheckedPatch.documents![documentId] = info.hash
      for (const span of info.spans) {
        addMark({ targetKind: 'attachment', attachmentId: documentId, startOffset: span.start, endOffset: span.end, sourceHash: info.hash, textExcerpt: info.text.slice(span.start, span.end), category: span.category, detector: span.detector })
      }
    }
    const changedChildren: ChildRowSnapshot[] = []
    const draft = input.draftId
      ? await em.findOne(PublicInfoResponseDraft, { id: input.draftId, requestId: request.id, tenantId: scope.tenantId, organizationId: scope.organizationId })
      : await em.findOne(PublicInfoResponseDraft, { requestId: request.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }, { orderBy: { version: 'desc' } })
    if (draft) {
      changedChildren.push({ kind: 'draft', row: snapshotRow(draft) })
      const current = readPiiChecked(draft.letterOptions)
      draft.letterOptions = {
        ...(draft.letterOptions ?? {}),
        piiChecked: {
          paragraphs: { ...(current.paragraphs ?? {}), ...piiCheckedPatch.paragraphs },
          documents: { ...(current.documents ?? {}), ...piiCheckedPatch.documents },
        },
      }
    }
    recordEvent(em, scope, request.id, 'ai_suggestion', actorUserId, { kind: 'pii_detected', count: created.length })
    return { result: { created: created.length }, created, removedChildren, changedChildren }
  },
})

defineRequestCommand({
  id: 'public_info_requests.redaction_mark.decide',
  label: 'Decide anonymisation suggestion',
  schema: withId({ markId: z.string().uuid().optional(), markIds: z.array(z.string().uuid()).max(500).optional(), ...redactionDecisionSchema.omit({ id: true }).shape }),
  async run({ em, scope, request, input, actorUserId }) {
    const ids = [...(input.markIds ?? []), ...(input.markId ? [input.markId] : [])]
    if (ids.length === 0) throw new CrudHttpError(400, { error: 'markId or markIds required' })
    if (input.state === 'kept' && !input.reason?.trim()) throw new CrudHttpError(422, { error: 'Reason required', fieldErrors: { reason: 'required' } })
    const marks = await em.find(PublicInfoRedactionMark, { id: { $in: ids }, requestId: request.id, tenantId: scope.tenantId, organizationId: scope.organizationId })
    if (marks.length === 0) throw new CrudHttpError(404, { error: 'Mark not found' })
    const changedChildren: ChildRowSnapshot[] = marks.map((mark) => ({ kind: 'mark', row: snapshotRow(mark) }))
    for (const mark of marks) {
      mark.state = input.state
      mark.reason = input.reason ?? null
      mark.decidedByUserId = actorUserId
      mark.decidedAt = new Date()
    }
    return { result: { ok: true, count: marks.length }, changedChildren }
  },
})

defineRequestCommand({
  id: 'public_info_requests.redaction_mark.add',
  label: 'Add manual anonymisation mark',
  schema: withId(redactionManualSchema.shape),
  async run({ em, scope, request, input, actorUserId }) {
    let sourceText = ''
    let sourceHash = ''
    if (input.targetKind === 'draft') {
      const draft = input.draftId ? await em.findOne(PublicInfoResponseDraft, { id: input.draftId, requestId: request.id, tenantId: scope.tenantId, organizationId: scope.organizationId }) : null
      const paragraph = draft?.paragraphs.find((candidate) => candidate.id === input.paragraphId)
      if (!paragraph) throw new CrudHttpError(404, { error: 'Paragraph not found' })
      sourceText = paragraph.text
      sourceHash = paragraph.contentHash || contentHash(paragraph.text)
    } else {
      const documents = await loadCaseDocuments(em, scope, request.id)
      const document = documents.find((candidate) => candidate.id === input.attachmentId)
      if (!document) throw new CrudHttpError(404, { error: 'Document not found' })
      sourceText = document.extractedText ?? ''
      sourceHash = attachmentTextHash(sourceText)
    }
    if (input.end > sourceText.length || input.start >= input.end) throw new CrudHttpError(422, { error: 'Invalid range' })
    const id = randomUUID()
    em.persist(
      em.create(PublicInfoRedactionMark, {
        id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        requestId: request.id,
        targetKind: input.targetKind,
        draftId: input.draftId ?? null,
        paragraphId: input.paragraphId ?? null,
        attachmentId: input.attachmentId ?? null,
        startOffset: input.start,
        endOffset: input.end,
        sourceHash,
        textExcerpt: sourceText.slice(input.start, input.end),
        category: input.category,
        detector: 'manual',
        state: 'accepted',
        decidedByUserId: actorUserId,
        decidedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
    return { result: { id }, created: [{ kind: 'mark', id }] }
  },
})

defineRequestCommand({
  id: 'public_info_requests.request.mark_sent',
  label: 'Record answer sent',
  schema: withId({ draftId: z.string().uuid().optional(), ...markSentSchema.shape }),
  async run({ em, scope, request, input, actorUserId }) {
    const draft = input.draftId
      ? await em.findOne(PublicInfoResponseDraft, { id: input.draftId, requestId: request.id, tenantId: scope.tenantId, organizationId: scope.organizationId })
      : await em.findOne(PublicInfoResponseDraft, { requestId: request.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }, { orderBy: { version: 'desc' } })
    if (request.status === 'sent' || request.status === 'left_unprocessed' || request.status === 'archived') {
      throw new CrudHttpError(409, { error: 'Request is already closed', code: 'request_closed' })
    }
    if (!draft) throw new CrudHttpError(409, { error: 'No prepared draft', code: 'draft_not_ready' })
    const marks = await loadDraftMarks(em, scope, draft.id)
    assertDraftExportable(draft, marks)
    const changedChildren: ChildRowSnapshot[] = [{ kind: 'draft', row: snapshotRow(draft) }]
    request.respondedAt = input.respondedAt
    request.responseChannel = input.channel
    request.finalLetterType = draft.letterType
    draft.status = 'exported'
    draft.exportedAt = draft.exportedAt ?? new Date()
    if (input.addToArchive) {
      const points = await loadPoints(em, scope, request.id)
      const letterText = redactParagraphs(draft.paragraphs, marks)
        .filter((paragraph) => paragraph.kind !== 'closing')
        .map((paragraph) => paragraph.text)
        .join('\n\n')
      const requestText = [request.subjectSummary, ...points.map((point) => `${point.position}. ${point.text}`)].join('\n')
      const requester = { name: request.requesterName, address: request.requesterAddress ?? null, contact: request.requesterContact ?? null }
      request.archiveText = anonymizeForArchive(`WNIOSEK\n${requestText}\n\nODPOWIEDŹ\n${letterText}`, requester)
    }
    transitionStatus(em, scope, request, 'sent', actorUserId)
    recordEvent(em, scope, request.id, 'marked_sent', actorUserId, { respondedAt: input.respondedAt, channel: input.channel, archived: input.addToArchive })
    return { result: { ok: true }, changedChildren }
  },
})

defineRequestCommand({
  id: 'public_info_requests.request.archive',
  label: 'Archive request',
  schema: withId({ reason: z.string().trim().min(1).max(1000) }),
  async run({ em, scope, request, input, actorUserId }) {
    if (!ARCHIVABLE_STATUSES.includes(request.status) || request.source === 'import') {
      throw new CrudHttpError(409, { error: 'Only unfinished requests can be archived', code: 'invalid_status', status: request.status })
    }
    const previousStatus = request.status
    transitionStatus(em, scope, request, 'archived', actorUserId)
    recordEvent(em, scope, request.id, 'archived', actorUserId, { reason: input.reason, previousStatus })
    return { result: { ok: true } }
  },
})

defineRequestCommand({
  id: 'public_info_requests.request.restore',
  label: 'Restore archived request',
  schema: withId({}),
  async run({ em, scope, request, actorUserId }) {
    if (request.status !== 'archived') throw new CrudHttpError(409, { error: 'Request is not archived', code: 'invalid_status', status: request.status })
    const archivedEvent = await em.findOne(
      PublicInfoRequestEvent,
      { requestId: request.id, kind: 'archived', tenantId: scope.tenantId, organizationId: scope.organizationId },
      { orderBy: { occurredAt: 'desc' } },
    )
    const stored = archivedEvent?.payload?.previousStatus
    const previousStatus = typeof stored === 'string' && (ARCHIVABLE_STATUSES as string[]).includes(stored) ? (stored as PublicInfoRequestStatus) : 'new'
    transitionStatus(em, scope, request, previousStatus, actorUserId)
    recordEvent(em, scope, request.id, 'restored', actorUserId, { status: previousStatus })
    return { result: { ok: true, status: previousStatus } }
  },
})

defineRequestCommand({
  id: 'public_info_requests.request.assign',
  label: 'Assign request',
  schema: withId({ assigneeUserId: z.string().uuid().nullable() }),
  async precompute({ em, scope, input, ctx }) {
    if (input.assigneeUserId) await assertAssignable(em, ctx.container, scope, input.assigneeUserId)
    return undefined
  },
  async run({ em, scope, request, input, actorUserId }) {
    if (request.status === 'archived') throw new CrudHttpError(409, { error: 'Request is archived', code: 'request_archived' })
    const previous = request.assigneeUserId ?? null
    request.assigneeUserId = input.assigneeUserId
    recordEvent(em, scope, request.id, 'assigned', actorUserId, { assigneeUserId: input.assigneeUserId, previousAssigneeUserId: previous })
    return { result: { ok: true } }
  },
})

defineRequestCommand({
  id: 'public_info_requests.request.claim',
  label: 'Claim request',
  schema: withId({}),
  async precompute({ em, scope, ctx, actorUserId }) {
    if (!actorUserId) throw new CrudHttpError(401, { error: 'Unauthorized' })
    await assertAssignable(em, ctx.container, scope, actorUserId)
    return undefined
  },
  async run({ em, scope, request, actorUserId }) {
    if (request.status === 'archived') throw new CrudHttpError(409, { error: 'Request is archived', code: 'request_archived' })
    if (request.assigneeUserId && request.assigneeUserId !== actorUserId) {
      throw new CrudHttpError(409, { error: 'Request is already assigned to someone else', code: 'already_assigned' })
    }
    request.assigneeUserId = actorUserId
    recordEvent(em, scope, request.id, 'claimed', actorUserId, { assigneeUserId: actorUserId })
    return { result: { ok: true } }
  },
})

defineRequestCommand({
  id: 'public_info_requests.request.extend',
  label: 'Extend response deadline',
  schema: withId(extendSchema.shape),
  async run({ em, scope, request, input, actorUserId }) {
    if (!EXTENDABLE_STATUSES.includes(request.status)) {
      throw new CrudHttpError(409, { error: 'Deadline cannot be extended in this status', code: 'invalid_status', status: request.status })
    }
    const settings = await loadSettings(em, scope)
    const limit = maxExtensionDate(request.receivedAt, settings.extraHolidays ?? []).due
    if (input.newDueDate > limit) {
      throw new CrudHttpError(422, { error: 'Extension exceeds two months from receipt', code: 'extension_too_long', maxExtensionDate: limit })
    }
    const today = todayIso()
    if (request.currentDueDate < today) {
      throw new CrudHttpError(422, { error: 'Deadline already passed; extension notice must precede it', code: 'extension_after_deadline' })
    }
    if (input.newDueDate <= request.currentDueDate) {
      throw new CrudHttpError(422, { error: 'New deadline must be later than the current one', code: 'extension_not_later' })
    }
    request.currentDueDate = input.newDueDate
    request.extendedAt = new Date()
    request.extensionReason = input.reason
    transitionStatus(em, scope, request, 'extended', actorUserId)
    recordEvent(em, scope, request.id, 'extended', actorUserId, { newDueDate: input.newDueDate })
    return { result: { ok: true } }
  },
})

defineRequestCommand({
  id: 'public_info_requests.request.request_clarification',
  label: 'Request clarification',
  schema: withId(requestClarificationSchema.shape),
  async run({ em, scope, request, input, actorUserId }) {
    if (!OPEN_STATUSES.includes(request.status)) {
      throw new CrudHttpError(409, { error: 'Clarification cannot be requested in this status', code: 'invalid_status', status: request.status })
    }
    const settings = await loadSettings(em, scope)
    request.pausedAt = new Date(`${input.sentAt}T12:00:00.000Z`)
    request.clarificationDeliveredAt = input.deliveredAt ?? null
    request.clarificationDueDate = input.deliveredAt
      ? clarificationDueDate(input.deliveredAt, settings.clarificationDays, settings.extraHolidays ?? []).due
      : null
    transitionStatus(em, scope, request, 'awaiting_clarification', actorUserId)
    recordEvent(em, scope, request.id, 'clarification_requested', actorUserId, { sentAt: input.sentAt, deliveredAt: input.deliveredAt ?? null })
    return { result: { ok: true } }
  },
})

defineRequestCommand({
  id: 'public_info_requests.request.record_clarification_delivery',
  label: 'Record clarification delivery',
  schema: withId(clarificationDeliverySchema.shape),
  async run({ em, scope, request, input, actorUserId }) {
    if (request.status !== 'awaiting_clarification') throw new CrudHttpError(422, { error: 'Request is not awaiting clarification' })
    const settings = await loadSettings(em, scope)
    request.clarificationDeliveredAt = input.deliveredAt
    request.clarificationDueDate = clarificationDueDate(input.deliveredAt, settings.clarificationDays, settings.extraHolidays ?? []).due
    recordEvent(em, scope, request.id, 'clarification_delivered', actorUserId, { deliveredAt: input.deliveredAt })
    return { result: { ok: true } }
  },
})

defineRequestCommand({
  id: 'public_info_requests.request.register_clarification',
  label: 'Register clarification reply',
  schema: withId(registerClarificationSchema.shape),
  async run({ em, scope, request, input, actorUserId }) {
    if (request.status !== 'awaiting_clarification') throw new CrudHttpError(422, { error: 'Request is not awaiting clarification' })
    const settings = await loadSettings(em, scope)
    const deadlines = computeDeadlines(input.receivedAt, settings.deadlineMode, settings.extraHolidays ?? [])
    request.currentDueDate = input.overrideDueDate ?? deadlines.currentDueDate
    request.pausedAt = null
    transitionStatus(em, scope, request, 'in_preparation', actorUserId)
    recordEvent(em, scope, request.id, 'clarification_received', actorUserId, { receivedAt: input.receivedAt, currentDueDate: request.currentDueDate })
    return { result: { ok: true } }
  },
})

defineRequestCommand({
  id: 'public_info_requests.request.leave_unprocessed',
  label: 'Leave request unprocessed',
  schema: withId({}),
  async run({ em, scope, request, actorUserId }) {
    if (request.status !== 'awaiting_clarification') throw new CrudHttpError(422, { error: 'Request is not awaiting clarification' })
    if (!request.clarificationDueDate || todayIso() <= request.clarificationDueDate) {
      throw new CrudHttpError(422, { error: 'Clarification window has not ended', code: 'clarification_window_open' })
    }
    request.finalLetterType = 'left_unprocessed'
    transitionStatus(em, scope, request, 'left_unprocessed', actorUserId)
    recordEvent(em, scope, request.id, 'left_unprocessed', actorUserId, null)
    return { result: { ok: true } }
  },
})

export function renderPlainLetter(paragraphs: StoredDraftParagraph[], context: Parameters<typeof renderLetterText>[1]): string {
  return renderLetterText(paragraphs, context)
}
