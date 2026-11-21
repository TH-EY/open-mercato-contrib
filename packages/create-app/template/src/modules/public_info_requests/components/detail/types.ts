export type DraftParagraph = {
  id: string
  kind: 'intro' | 'point' | 'closing' | 'note'
  pointPosition?: number
  text: string
  contentHash: string
  sources: Array<{ attachmentId: string; page?: number; quote: string }>
  flags: Array<'unsupported' | 'number_mismatch' | 'gap' | 'assistant_only'>
  mismatchTokens?: string[]
  confirmedBy?: string | null
}

export type CaseDetail = {
  request: {
    id: string
    caseNumber: string
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
    assigneeName: string | null
    assigneeInitials: string | null
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
    similarChoice: { matchedRequestId: string | null; similarity: number | null; action: string } | null
    source: string
    updatedAt: string
    daysRemaining: number
    deadlineTone: 'overdue' | 'today' | 'tomorrow' | 'paused' | 'normal' | 'done'
  }
  points: Array<{ id: string; position: number; text: string }>
  queries: Array<{
    id: string
    departmentId: string
    departmentName: string
    departmentKind: string
    contactHint: string | null
    pointPositions: number[]
    scopeText: string
    internalDueDate: string | null
    sentAt: string | null
    receivedAt: string | null
    replyKind: string | null
    replyDocumentIds: string[]
    confidence: number | null
    sources: Array<{ kind: string; ref: string; label: string }>
  }>
  documents: Array<{
    id: string
    attachmentId: string | null
    departmentQueryId: string | null
    kind: string
    fileName: string
    mimeType: string | null
    textSource: string
    ocrConfidence: number | null
    extractedText: string | null
    createdAt: string
  }>
  drafts: Array<{
    id: string
    version: number
    letterType: string
    status: string
    paragraphs: DraftParagraph[]
    attachmentList: string[]
    letterOptions: Record<string, unknown>
    generatedBy: string
    exportedAt: string | null
    updatedAt: string
  }>
  marks: Array<{
    id: string
    targetKind: 'draft' | 'attachment'
    draftId: string | null
    paragraphId: string | null
    documentId: string | null
    start: number
    end: number
    excerpt: string
    category: string
    detector: string
    state: 'suggested' | 'accepted' | 'rejected' | 'kept'
    reason: string | null
  }>
  events: Array<{ id: string; kind: string; actorName: string | null; payload: Record<string, unknown> | null; occurredAt: string }>
}
