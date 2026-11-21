import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  PublicInfoDepartmentQuery,
  PublicInfoRedactionMark,
  PublicInfoResponseDraft,
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
import { attachmentTextHash, redactParagraphs } from '../lib/server/redaction'
import { checkGrounding, contentHash } from '../lib/drafting/grounding'
import { renderLetterText } from '../lib/drafting/render'
import { anonymizeForArchive } from '../lib/pii/redact'
import { clarificationDueDate, maxExtensionDate, todayIso } from '../lib/deadlines'
import type { LetterType } from '../lib/drafting/types'
import { defineRequestCommand, snapshotRow, type ChildRowSnapshot, type CreatedRow } from './shared'

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

defineRequestCommand({
  id: 'public_info_requests.draft.generate',
  label: 'Generate response draft',
  schema: withId(draftGenerateSchema.shape),
  async run({ em, scope, request, input, actorUserId, ctx }) {
    const settings = await loadSettings(em, scope)
    const points = await requestPointsOrSummary(em, scope, request)
    const { replies, departmentNames } = await loadReplyTexts(em, scope, request.id)
    let archiveAnswer: { documentId: string; text: string } | null = null
    if (input.baseOn === 'archive_answer' && request.similarChoice?.matchedRequestId) {
      const matchedId = request.similarChoice.matchedRequestId
      const matchedDocuments = await loadCaseDocuments(em, scope, matchedId)
      const answerText = matchedDocuments
        .filter((document) => document.kind === 'other' || document.kind === 'reply')
        .map((document) => document.extractedText ?? '')
        .filter(Boolean)
        .join('\n\n')
      const matched = answerText ? null : await em.findOne(PublicInfoResponseDraft, { requestId: matchedId, tenantId: scope.tenantId, organizationId: scope.organizationId }, { orderBy: { version: 'desc' } })
      const fallbackText = matched?.paragraphs?.map((paragraph) => paragraph.text).join('\n\n') ?? ''
      const text = answerText || fallbackText
      const sourceDocument = matchedDocuments.find((document) => document.kind === 'other' || document.kind === 'reply')
      if (text) archiveAnswer = { documentId: sourceDocument?.id ?? `archive:${matchedId}`, text }
    }
    const options = input.options ?? {}
    const context = await buildLetterContext({ em, scope, request, points, departmentNames, options, settings })
    const { paragraphs, generatedBy } = await generateDraftParagraphs({
      container: ctx.container,
      scope: { ...scope, userId: actorUserId ?? '' },
      letterType: input.letterType as LetterType,
      context,
      replies,
      archiveAnswer,
    })
    const latest = await em.findOne(PublicInfoResponseDraft, { requestId: request.id, tenantId: scope.tenantId, organizationId: scope.organizationId }, { orderBy: { version: 'desc' } })
    const id = randomUUID()
    const attachmentList = input.letterType === 'answer' ? replies.map((reply) => reply.departmentName ? `Odpowiedź — ${reply.departmentName}` : 'Załącznik').slice(0, 0) : []
    em.persist(
      em.create(PublicInfoResponseDraft, {
        id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        requestId: request.id,
        version: (latest?.version ?? 0) + 1,
        letterType: input.letterType,
        status: 'draft',
        paragraphs: toStoredParagraphs(paragraphs),
        attachmentList,
        letterOptions: { ...options, departmentNames, letterDate: context.letterDate },
        generatedBy,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
    if (['new', 'sent_to_departments', 'extended'].includes(request.status) && input.letterType === 'answer') {
      transitionStatus(em, scope, request, 'in_preparation', actorUserId)
    }
    recordEvent(em, scope, request.id, generatedBy === 'ai' ? 'ai_suggestion' : 'draft_generated', actorUserId, {
      draftId: id,
      letterType: input.letterType,
      generatedBy,
      gaps: paragraphs.filter((paragraph) => paragraph.flags.includes('gap')).length,
      unsupported: paragraphs.filter((paragraph) => paragraph.flags.includes('unsupported') || paragraph.flags.includes('number_mismatch')).length,
    })
    return { result: { draftId: id }, created: [{ kind: 'draft', id }] }
  },
})

defineRequestCommand({
  id: 'public_info_requests.draft.update',
  label: 'Edit response draft',
  schema: withId({ draftId: z.string().uuid(), ...draftUpdateSchema.omit({ expectedUpdatedAt: true }).shape }),
  async run({ em, scope, request, input, actorUserId }) {
    const draft = await em.findOne(PublicInfoResponseDraft, { id: input.draftId, requestId: request.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null })
    if (!draft) throw new CrudHttpError(404, { error: 'Draft not found' })
    const changedChildren: ChildRowSnapshot[] = [{ kind: 'draft', row: snapshotRow(draft) }]
    const removedChildren: ChildRowSnapshot[] = []
    let paragraphs: StoredDraftParagraph[] = draft.paragraphs
    if (input.paragraphs) {
      paragraphs = input.paragraphs.map((paragraph) => ({
        ...paragraph,
        contentHash: contentHash(paragraph.text),
        mismatchTokens: paragraph.mismatchTokens,
        confirmedBy: paragraph.confirmedBy ?? null,
      }))
    }
    if (input.confirmParagraphIds && input.confirmParagraphIds.length > 0) {
      const confirm = new Set(input.confirmParagraphIds)
      paragraphs = paragraphs.map((paragraph) => (confirm.has(paragraph.id) ? { ...paragraph, confirmedBy: actorUserId ?? 'officer' } : paragraph))
    }
    const documents = await loadCaseDocuments(em, scope, request.id, 'reply')
    const points = await loadPoints(em, scope, request.id)
    const grounded = checkGrounding(
      paragraphs.map((paragraph) => ({ ...paragraph, flags: paragraph.flags.filter((flag) => flag === 'assistant_only') })),
      {
        points: points.map((point) => ({ position: point.position, text: point.text })),
        caseNumber: request.caseNumber,
        letterDate: String((draft.letterOptions as Record<string, unknown> | null)?.letterDate ?? todayIso()),
        receivedAt: request.receivedAt,
        requestDate: request.letterDate ?? null,
      },
      documents.map((document) => ({ attachmentId: document.id, text: document.extractedText ?? '' })),
    )
    const stored = toStoredParagraphs(grounded).map((paragraph) => {
      const previous = paragraphs.find((candidate) => candidate.id === paragraph.id)
      return previous?.confirmedBy && previous.contentHash === paragraph.contentHash ? { ...paragraph, confirmedBy: previous.confirmedBy } : paragraph
    })
    const hashById = new Map(stored.map((paragraph) => [paragraph.id, paragraph.contentHash]))
    const marks = await em.find(PublicInfoRedactionMark, { draftId: draft.id, tenantId: scope.tenantId, organizationId: scope.organizationId })
    const reacceptExcerpts = new Map<string, string[]>()
    for (const mark of marks) {
      if (!mark.paragraphId) continue
      if (hashById.get(mark.paragraphId) === mark.sourceHash) continue
      removedChildren.push({ kind: 'mark', row: snapshotRow(mark) })
      if (mark.state === 'accepted') {
        const list = reacceptExcerpts.get(mark.paragraphId) ?? []
        list.push(mark.textExcerpt)
        reacceptExcerpts.set(mark.paragraphId, list)
      }
      em.remove(mark)
    }
    const created: CreatedRow[] = []
    for (const [paragraphId, excerpts] of reacceptExcerpts) {
      const paragraph = stored.find((candidate) => candidate.id === paragraphId)
      if (!paragraph) continue
      for (const excerpt of excerpts) {
        const start = paragraph.text.indexOf(excerpt)
        if (start < 0) continue
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
            startOffset: start,
            endOffset: start + excerpt.length,
            sourceHash: paragraph.contentHash,
            textExcerpt: excerpt,
            category: 'other',
            detector: 'manual',
            state: 'accepted',
            decidedByUserId: actorUserId,
            decidedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        )
        created.push({ kind: 'mark', id })
      }
    }
    draft.paragraphs = stored
    if (input.attachmentList) draft.attachmentList = input.attachmentList
    if (input.status) {
      if (input.status === 'ready') {
        const blocking = stored.filter((paragraph) => paragraph.flags.some((flag) => flag !== 'assistant_only') && !paragraph.confirmedBy)
        const assistantOnly = stored.filter((paragraph) => paragraph.flags.includes('assistant_only') && !paragraph.confirmedBy)
        if (blocking.length > 0 || assistantOnly.length > 0) {
          throw new CrudHttpError(409, { error: 'Draft has unresolved flags', code: 'draft_not_ready', paragraphIds: [...blocking, ...assistantOnly].map((paragraph) => paragraph.id) })
        }
        draft.status = 'ready'
        if (['new', 'sent_to_departments', 'extended', 'in_preparation'].includes(request.status)) transitionStatus(em, scope, request, 'prepared', actorUserId)
      } else {
        draft.status = 'draft'
        if (request.status === 'prepared') transitionStatus(em, scope, request, 'in_preparation', actorUserId)
      }
    }
    draft.updatedAt = new Date()
    recordEvent(em, scope, request.id, 'draft_updated', actorUserId, { draftId: draft.id, status: draft.status })
    return { result: { ok: true }, changedChildren, removedChildren, created }
  },
})

defineRequestCommand({
  id: 'public_info_requests.redaction_mark.detect',
  label: 'Detect personal data',
  schema: withId({ draftId: z.string().uuid().optional(), ...piiDetectSchema.shape }),
  async run({ em, scope, request, input, actorUserId, ctx }) {
    const settings = await loadSettings(em, scope)
    const existing = await em.find(PublicInfoRedactionMark, { requestId: request.id, tenantId: scope.tenantId, organizationId: scope.organizationId })
    const created: CreatedRow[] = []
    const removedChildren: ChildRowSnapshot[] = []
    const publicOfficials = settings.publicOfficials ?? []
    const keepKey = new Set(existing.filter((mark) => mark.state !== 'suggested').map((mark) => `${mark.targetKind}:${mark.paragraphId ?? mark.attachmentId}:${mark.startOffset}:${mark.endOffset}:${mark.sourceHash}`))
    for (const mark of existing) {
      if (mark.state === 'suggested') {
        removedChildren.push({ kind: 'mark', row: snapshotRow(mark) })
        em.remove(mark)
      }
    }
    const addMark = (values: Omit<ConstructorParameters<typeof Object>[0], never> & Record<string, unknown>) => {
      const key = `${values.targetKind}:${values.paragraphId ?? values.attachmentId}:${values.startOffset}:${values.endOffset}:${values.sourceHash}`
      if (keepKey.has(key)) return
      keepKey.add(key)
      const id = randomUUID()
      em.persist(em.create(PublicInfoRedactionMark, { id, tenantId: scope.tenantId, organizationId: scope.organizationId, requestId: request.id, state: 'suggested', createdAt: new Date(), updatedAt: new Date(), ...values } as never))
      created.push({ kind: 'mark', id })
    }
    const actorScope = { ...scope, userId: actorUserId ?? '' }
    if (input.draftId) {
      const draft = await em.findOne(PublicInfoResponseDraft, { id: input.draftId, requestId: request.id, tenantId: scope.tenantId, organizationId: scope.organizationId })
      if (!draft) throw new CrudHttpError(404, { error: 'Draft not found' })
      for (const paragraph of draft.paragraphs) {
        if (!paragraph.text.trim()) continue
        const spans = await detectPii({ container: ctx.container, scope: actorScope, text: paragraph.text, publicOfficials, keepNames: [request.requesterName] })
        for (const span of spans) {
          addMark({
            targetKind: 'draft',
            draftId: draft.id,
            paragraphId: paragraph.id,
            startOffset: span.start,
            endOffset: span.end,
            sourceHash: paragraph.contentHash || contentHash(paragraph.text),
            textExcerpt: paragraph.text.slice(span.start, span.end),
            category: span.category,
            detector: span.detector,
          })
        }
      }
    }
    if (input.includeAttachments) {
      const documents = await loadCaseDocuments(em, scope, request.id, 'reply')
      for (const document of documents) {
        const text = document.extractedText ?? ''
        if (!text.trim()) continue
        const spans = await detectPii({ container: ctx.container, scope: actorScope, text, publicOfficials, keepNames: [] })
        for (const span of spans) {
          addMark({
            targetKind: 'attachment',
            attachmentId: document.id,
            startOffset: span.start,
            endOffset: span.end,
            sourceHash: attachmentTextHash(text),
            textExcerpt: text.slice(span.start, span.end),
            category: span.category,
            detector: span.detector,
          })
        }
      }
    }
    recordEvent(em, scope, request.id, 'ai_suggestion', actorUserId, { kind: 'pii_detected', count: created.length })
    return { result: { created: created.length }, created, removedChildren }
  },
})

defineRequestCommand({
  id: 'public_info_requests.redaction_mark.decide',
  label: 'Decide anonymisation suggestion',
  schema: withId({ markId: z.string().uuid(), ...redactionDecisionSchema.omit({ id: true }).shape }),
  async run({ em, scope, request, input, actorUserId }) {
    const mark = await em.findOne(PublicInfoRedactionMark, { id: input.markId, requestId: request.id, tenantId: scope.tenantId, organizationId: scope.organizationId })
    if (!mark) throw new CrudHttpError(404, { error: 'Mark not found' })
    if (input.state === 'kept' && !input.reason?.trim()) throw new CrudHttpError(422, { error: 'Reason required', fieldErrors: { reason: 'required' } })
    const changedChildren: ChildRowSnapshot[] = [{ kind: 'mark', row: snapshotRow(mark) }]
    mark.state = input.state
    mark.reason = input.reason ?? null
    mark.decidedByUserId = actorUserId
    mark.decidedAt = new Date()
    return { result: { ok: true }, changedChildren }
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
    const changedChildren: ChildRowSnapshot[] = draft ? [{ kind: 'draft', row: snapshotRow(draft) }] : []
    request.respondedAt = input.respondedAt
    request.responseChannel = input.channel
    request.finalLetterType = draft?.letterType ?? request.finalLetterType ?? 'answer'
    if (draft) {
      draft.status = 'exported'
      draft.exportedAt = draft.exportedAt ?? new Date()
    }
    if (input.addToArchive) {
      const points = await loadPoints(em, scope, request.id)
      const marks = draft ? await em.find(PublicInfoRedactionMark, { draftId: draft.id, tenantId: scope.tenantId, organizationId: scope.organizationId }) : []
      const letterText = draft
        ? redactParagraphs(draft.paragraphs, marks)
            .filter((paragraph) => paragraph.kind !== 'closing')
            .map((paragraph) => paragraph.text)
            .join('\n\n')
        : ''
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
  id: 'public_info_requests.request.extend',
  label: 'Extend response deadline',
  schema: withId(extendSchema.shape),
  async run({ em, scope, request, input, actorUserId }) {
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
