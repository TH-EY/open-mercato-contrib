import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

export type PublicInfoRequestStatus =
  | 'new'
  | 'sent_to_departments'
  | 'extended'
  | 'awaiting_clarification'
  | 'in_preparation'
  | 'prepared'
  | 'sent'
  | 'left_unprocessed'

export type PublicInfoChannel = 'email' | 'epuap' | 'post' | 'in_person' | 'phone'
export type PublicInfoRequesterKind = 'person' | 'organisation' | 'media' | 'councillor'
export type PublicInfoDeliveryForm = 'email' | 'post' | 'epuap' | 'inspection'
export type PublicInfoRequestSource = 'manual' | 'import'
export type PublicInfoDepartmentKind = 'department' | 'office' | 'municipal_unit' | 'external'
export type PublicInfoReplyKind = 'answered' | 'partial' | 'not_held' | 'protected'
export type PublicInfoDraftStatus = 'draft' | 'ready' | 'exported'
export type PublicInfoRedactionState = 'suggested' | 'accepted' | 'rejected' | 'kept'
export type PublicInfoRedactionTarget = 'draft' | 'attachment'

export type SimilarChoice = {
  matchedRequestId: string | null
  similarity: number | null
  action: 'reuse_structure' | 'start_from_answer' | 'bip_referral' | 'none'
}

@Entity({ tableName: 'public_info_requests' })
@Unique({ name: 'public_info_requests_case_number_unique', properties: ['organizationId', 'caseNumber'] })
@Index({ name: 'public_info_requests_calendar_idx', properties: ['organizationId', 'tenantId', 'caseYear', 'currentDueDate'] })
@Index({ name: 'public_info_requests_status_idx', properties: ['organizationId', 'tenantId', 'status'] })
export class PublicInfoRequest {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'case_number', type: 'text' })
  caseNumber!: string

  @Property({ name: 'case_seq', type: 'int' })
  caseSeq!: number

  @Property({ name: 'case_year', type: 'int' })
  caseYear!: number

  @Property({ type: 'text' })
  channel!: PublicInfoChannel

  @Property({ name: 'received_at', type: 'date' })
  receivedAt!: string

  @Property({ name: 'letter_date', type: 'date', nullable: true })
  letterDate?: string | null

  @Property({ name: 'requester_name', type: 'text' })
  requesterName!: string

  @Property({ name: 'requester_kind', type: 'text', default: 'person' })
  requesterKind: PublicInfoRequesterKind = 'person'

  @Property({ name: 'requester_address', type: 'text', nullable: true })
  requesterAddress?: string | null

  @Property({ name: 'requester_contact', type: 'text', nullable: true })
  requesterContact?: string | null

  @Property({ name: 'delivery_form', type: 'text', default: 'email' })
  deliveryForm: PublicInfoDeliveryForm = 'email'

  @Property({ name: 'subject_summary', type: 'text' })
  subjectSummary!: string

  @Property({ name: 'body_text', type: 'text', nullable: true })
  bodyText?: string | null

  @Property({ type: 'text', default: 'new' })
  status: PublicInfoRequestStatus = 'new'

  @Property({ name: 'assignee_user_id', type: 'uuid', nullable: true })
  assigneeUserId?: string | null

  @Property({ name: 'statutory_due_date', type: 'date' })
  statutoryDueDate!: string

  @Property({ name: 'current_due_date', type: 'date' })
  currentDueDate!: string

  @Property({ name: 'due_shifted_from', type: 'date', nullable: true })
  dueShiftedFrom?: string | null

  @Property({ name: 'max_extension_date', type: 'date' })
  maxExtensionDate!: string

  @Property({ name: 'extended_at', type: Date, nullable: true })
  extendedAt?: Date | null

  @Property({ name: 'extension_reason', type: 'text', nullable: true })
  extensionReason?: string | null

  @Property({ name: 'paused_at', type: Date, nullable: true })
  pausedAt?: Date | null

  @Property({ name: 'clarification_delivered_at', type: 'date', nullable: true })
  clarificationDeliveredAt?: string | null

  @Property({ name: 'clarification_due_date', type: 'date', nullable: true })
  clarificationDueDate?: string | null

  @Property({ name: 'responded_at', type: 'date', nullable: true })
  respondedAt?: string | null

  @Property({ name: 'response_channel', type: 'text', nullable: true })
  responseChannel?: string | null

  @Property({ name: 'final_letter_type', type: 'text', nullable: true })
  finalLetterType?: string | null

  @Property({ name: 'similar_choice', type: 'json', nullable: true })
  similarChoice?: SimilarChoice | null

  @Property({ name: 'archive_text', type: 'text', nullable: true })
  archiveText?: string | null

  @Property({ type: 'text', default: 'manual' })
  source: PublicInfoRequestSource = 'manual'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'public_info_request_points' })
@Unique({ name: 'public_info_request_points_position_unique', properties: ['requestId', 'position'] })
export class PublicInfoRequestPoint {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'request_id', type: 'uuid' })
  requestId!: string

  @Property({ type: 'int' })
  position!: number

  @Property({ type: 'text' })
  text!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'public_info_departments' })
@Index({ name: 'public_info_departments_scope_idx', properties: ['organizationId', 'tenantId'] })
export class PublicInfoDepartment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text' })
  symbol!: string

  @Property({ type: 'text', default: 'department' })
  kind: PublicInfoDepartmentKind = 'department'

  @Property({ name: 'competence_scope', type: 'text', default: '' })
  competenceScope: string = ''

  @Property({ type: 'json', nullable: true })
  keywords?: string[] | null

  @Property({ name: 'contract_codes', type: 'json', nullable: true })
  contractCodes?: string[] | null

  @Property({ name: 'contact_hint', type: 'text', nullable: true })
  contactHint?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'public_info_department_queries' })
@Index({ name: 'public_info_department_queries_request_idx', properties: ['requestId'] })
export class PublicInfoDepartmentQuery {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'request_id', type: 'uuid' })
  requestId!: string

  @Property({ name: 'department_id', type: 'uuid' })
  departmentId!: string

  @Property({ name: 'point_positions', type: 'json' })
  pointPositions: number[] = []

  @Property({ name: 'scope_text', type: 'text' })
  scopeText!: string

  @Property({ name: 'internal_due_date', type: 'date', nullable: true })
  internalDueDate?: string | null

  @Property({ name: 'sent_at', type: 'date', nullable: true })
  sentAt?: string | null

  @Property({ name: 'received_at', type: 'date', nullable: true })
  receivedAt?: string | null

  @Property({ name: 'reply_kind', type: 'text', nullable: true })
  replyKind?: PublicInfoReplyKind | null

  @Property({ name: 'reply_attachment_ids', type: 'json', nullable: true })
  replyAttachmentIds?: string[] | null

  @Property({ name: 'ai_confidence', type: 'float', nullable: true })
  aiConfidence?: number | null

  @Property({ name: 'ai_sources', type: 'json', nullable: true })
  aiSources?: Array<{ kind: string; ref: string; label: string }> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

export type StoredDraftParagraph = {
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

@Entity({ tableName: 'public_info_response_drafts' })
@Unique({ name: 'public_info_response_drafts_version_unique', properties: ['requestId', 'version'] })
export class PublicInfoResponseDraft {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'request_id', type: 'uuid' })
  requestId!: string

  @Property({ type: 'int' })
  version!: number

  @Property({ name: 'letter_type', type: 'text' })
  letterType!: string

  @Property({ type: 'text', default: 'draft' })
  status: PublicInfoDraftStatus = 'draft'

  @Property({ type: 'json' })
  paragraphs: StoredDraftParagraph[] = []

  @Property({ name: 'attachment_list', type: 'json', nullable: true })
  attachmentList?: string[] | null

  @Property({ name: 'letter_options', type: 'json', nullable: true })
  letterOptions?: Record<string, unknown> | null

  @Property({ name: 'generated_by', type: 'text', default: 'template' })
  generatedBy: 'ai' | 'template' = 'template'

  @Property({ name: 'exported_at', type: Date, nullable: true })
  exportedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'public_info_redaction_marks' })
@Index({ name: 'public_info_redaction_marks_request_idx', properties: ['requestId'] })
export class PublicInfoRedactionMark {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'request_id', type: 'uuid' })
  requestId!: string

  @Property({ name: 'target_kind', type: 'text' })
  targetKind!: PublicInfoRedactionTarget

  @Property({ name: 'draft_id', type: 'uuid', nullable: true })
  draftId?: string | null

  @Property({ name: 'paragraph_id', type: 'text', nullable: true })
  paragraphId?: string | null

  @Property({ name: 'attachment_id', type: 'uuid', nullable: true })
  attachmentId?: string | null

  @Property({ name: 'start_offset', type: 'int' })
  startOffset!: number

  @Property({ name: 'end_offset', type: 'int' })
  endOffset!: number

  @Property({ name: 'source_hash', type: 'text' })
  sourceHash!: string

  @Property({ name: 'text_excerpt', type: 'text' })
  textExcerpt!: string

  @Property({ type: 'text' })
  category!: string

  @Property({ type: 'text', default: 'rule' })
  detector: 'rule' | 'ai' | 'manual' = 'rule'

  @Property({ type: 'text', default: 'suggested' })
  state: PublicInfoRedactionState = 'suggested'

  @Property({ type: 'text', nullable: true })
  reason?: string | null

  @Property({ name: 'decided_by_user_id', type: 'uuid', nullable: true })
  decidedByUserId?: string | null

  @Property({ name: 'decided_at', type: Date, nullable: true })
  decidedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'public_info_settings' })
@Unique({ name: 'public_info_settings_scope_unique', properties: ['organizationId', 'tenantId'] })
export class PublicInfoSettings {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'deadline_mode', type: 'text', default: 'calendar' })
  deadlineMode: 'calendar' | 'working' = 'calendar'

  @Property({ name: 'internal_due_offset_working_days', type: 'int', default: 5 })
  internalDueOffsetWorkingDays: number = 5

  @Property({ name: 'clarification_days', type: 'int', default: 7 })
  clarificationDays: number = 7

  @Property({ name: 'similarity_threshold', type: 'float', default: 0.2 })
  similarityThreshold: number = 0.2

  @Property({ name: 'similarity_window_months', type: 'int', default: 24 })
  similarityWindowMonths: number = 24

  @Property({ name: 'extra_holidays', type: 'json', nullable: true })
  extraHolidays?: string[] | null

  @Property({ name: 'public_officials', type: 'json', nullable: true })
  publicOfficials?: string[] | null

  @Property({ type: 'json', nullable: true })
  letterhead?: Record<string, string> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'public_info_request_events' })
@Index({ name: 'public_info_request_events_request_idx', properties: ['requestId', 'occurredAt'] })
export class PublicInfoRequestEvent {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'request_id', type: 'uuid' })
  requestId!: string

  @Property({ type: 'text' })
  kind!: string

  @Property({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId?: string | null

  @Property({ type: 'json', nullable: true })
  payload?: Record<string, unknown> | null

  @Property({ name: 'occurred_at', type: Date, onCreate: () => new Date() })
  occurredAt: Date = new Date()
}

export type PublicInfoDocumentKind = 'request' | 'reply' | 'clarification' | 'other'
export type PublicInfoTextSource = 'docx' | 'pdf' | 'text' | 'email' | 'ocr_tesseract' | 'ocr_llm' | 'manual' | 'none'

@Entity({ tableName: 'public_info_documents' })
@Index({ name: 'public_info_documents_request_idx', properties: ['requestId'] })
export class PublicInfoDocument {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'request_id', type: 'uuid' })
  requestId!: string

  @Property({ name: 'attachment_id', type: 'uuid', nullable: true })
  attachmentId?: string | null

  @Property({ name: 'department_query_id', type: 'uuid', nullable: true })
  departmentQueryId?: string | null

  @Property({ type: 'text', default: 'request' })
  kind: PublicInfoDocumentKind = 'request'

  @Property({ name: 'file_name', type: 'text' })
  fileName!: string

  @Property({ name: 'mime_type', type: 'text', nullable: true })
  mimeType?: string | null

  @Property({ name: 'extracted_text', type: 'text', nullable: true })
  extractedText?: string | null

  @Property({ name: 'text_source', type: 'text', default: 'none' })
  textSource: PublicInfoTextSource = 'none'

  @Property({ name: 'ocr_confidence', type: 'float', nullable: true })
  ocrConfidence?: number | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
