import { z } from 'zod'

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const CASE_NUMBER_PATTERN = /^BKS\.IV\.1431\.(\d+)\.(\d{4})$/

export const channelSchema = z.enum(['email', 'epuap', 'post', 'in_person', 'phone'])
export const requesterKindSchema = z.enum(['person', 'organisation', 'media', 'councillor'])
export const deliveryFormSchema = z.enum(['email', 'post', 'epuap', 'inspection'])
export const requestStatusSchema = z.enum([
  'new',
  'sent_to_departments',
  'extended',
  'awaiting_clarification',
  'in_preparation',
  'prepared',
  'sent',
  'left_unprocessed',
])
export const departmentKindSchema = z.enum(['department', 'office', 'municipal_unit', 'external'])
export const replyKindSchema = z.enum(['answered', 'partial', 'not_held', 'protected'])
export const letterTypeSchema = z.enum([
  'answer',
  'extension_notice',
  'clarification_request',
  'not_held_referral',
  'bip_referral',
  'refusal_decision_draft',
  'left_unprocessed',
  'no_statistics',
])

export const pointInputSchema = z.object({
  position: z.number().int().min(1).max(200),
  text: z.string().trim().min(1).max(4000),
})

export const requestCreateSchema = z.object({
  id: z.string().uuid().optional(),
  caseNumber: z.string().trim().regex(CASE_NUMBER_PATTERN),
  channel: channelSchema,
  receivedAt: isoDateSchema,
  letterDate: isoDateSchema.nullable().optional(),
  requesterName: z.string().trim().min(1).max(300),
  requesterKind: requesterKindSchema.default('person'),
  requesterAddress: z.string().trim().max(500).nullable().optional(),
  requesterContact: z.string().trim().max(300).nullable().optional(),
  deliveryForm: deliveryFormSchema.default('email'),
  subjectSummary: z.string().trim().min(1).max(300),
  bodyText: z.string().max(100000).nullable().optional(),
  assigneeUserId: z.string().uuid().nullable().optional(),
  points: z.array(pointInputSchema).max(200).default([]),
})
export type RequestCreateInput = z.infer<typeof requestCreateSchema>

export const requestUpdateSchema = requestCreateSchema
  .partial()
  .omit({ id: true })
  .extend({ id: z.string().uuid(), expectedUpdatedAt: z.string().min(1).optional() })
export type RequestUpdateInput = z.infer<typeof requestUpdateSchema>

export const departmentInputSchema = z.object({
  name: z.string().trim().min(1).max(300),
  symbol: z.string().trim().min(1).max(30),
  kind: departmentKindSchema.default('department'),
  competenceScope: z.string().max(4000).default(''),
  keywords: z.array(z.string().trim().min(1).max(80)).max(200).default([]),
  contractCodes: z.array(z.string().trim().min(1).max(30)).max(20).default([]),
  contactHint: z.string().max(1000).nullable().optional(),
  isActive: z.boolean().default(true),
})
export const departmentCreateSchema = departmentInputSchema.extend({ id: z.string().uuid().optional() })
export const departmentUpdateSchema = departmentInputSchema.partial().extend({ id: z.string().uuid() })
export type DepartmentCreateInput = z.infer<typeof departmentCreateSchema>
export type DepartmentUpdateInput = z.infer<typeof departmentUpdateSchema>

export const settingsUpdateSchema = z.object({
  deadlineMode: z.enum(['calendar', 'working']).optional(),
  internalDueOffsetWorkingDays: z.number().int().min(0).max(30).optional(),
  clarificationDays: z.number().int().min(1).max(30).optional(),
  similarityThreshold: z.number().min(0).max(1).optional(),
  similarityWindowMonths: z.number().int().min(1).max(240).optional(),
  extraHolidays: z.array(isoDateSchema).max(100).optional(),
  publicOfficials: z.array(z.string().trim().min(1).max(200)).max(500).optional(),
})
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>

export const similarChoiceSchema = z.object({
  matchedRequestId: z.string().uuid().nullable().optional(),
  similarity: z.number().min(0).max(1).nullable().optional(),
  action: z.enum(['reuse_structure', 'start_from_answer', 'bip_referral', 'none']),
})

export const routingAcceptSchema = z.object({
  queries: z
    .array(
      z.object({
        departmentId: z.string().uuid(),
        pointPositions: z.array(z.number().int().min(1)).max(200),
        scopeText: z.string().trim().min(1).max(8000),
        internalDueDate: isoDateSchema.nullable().optional(),
        confidence: z.number().min(0).max(1).nullable().optional(),
        sources: z.array(z.object({ kind: z.string(), ref: z.string(), label: z.string() })).max(20).optional(),
      }),
    )
    .min(1)
    .max(20),
})
export type RoutingAcceptInput = z.infer<typeof routingAcceptSchema>

export const queriesMarkSentSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
  sentAt: isoDateSchema,
})

export const queryReplySchema = z.object({
  id: z.string().uuid(),
  replyKind: replyKindSchema,
  receivedAt: isoDateSchema,
  replyAttachmentIds: z.array(z.string().uuid()).max(20).default([]),
  pointPositions: z.array(z.number().int().min(1)).max(200).optional(),
})

export const draftGenerateSchema = z.object({
  letterType: letterTypeSchema,
  baseOn: z.enum(['department_replies', 'archive_answer']).optional(),
  options: z
    .object({
      salutation: z.enum(['pan', 'pani', 'panstwo']).optional(),
      referralDepartmentId: z.string().uuid().optional(),
      bipUrl: z.string().url().optional(),
      extensionDueDate: isoDateSchema.optional(),
      extensionReason: z.string().max(1000).optional(),
      clarificationQuestion: z.string().max(4000).optional(),
      clarificationDepartmentName: z.string().max(300).optional(),
    })
    .optional(),
})
export type DraftGenerateInput = z.infer<typeof draftGenerateSchema>

export const draftParagraphSchema = z.object({
  id: z.string().min(1).max(60),
  kind: z.enum(['intro', 'point', 'closing', 'note']),
  pointPosition: z.number().int().min(1).optional(),
  text: z.string().max(20000),
  contentHash: z.string().optional(),
  sources: z
    .array(z.object({ attachmentId: z.string().min(1), page: z.number().int().optional(), quote: z.string().max(2000) }))
    .max(20)
    .default([]),
  flags: z.array(z.enum(['unsupported', 'number_mismatch', 'gap', 'assistant_only'])).default([]),
  mismatchTokens: z.array(z.string()).optional(),
  confirmedBy: z.string().nullable().optional(),
})

export const draftUpdateSchema = z.object({
  paragraphs: z.array(draftParagraphSchema).max(200).optional(),
  attachmentList: z.array(z.string().max(300)).max(50).optional(),
  status: z.enum(['draft', 'ready']).optional(),
  confirmParagraphIds: z.array(z.string()).max(200).optional(),
  expectedUpdatedAt: z.string().optional(),
})
export type DraftUpdateInput = z.infer<typeof draftUpdateSchema>

export const redactionDecisionSchema = z.object({
  id: z.string().uuid(),
  state: z.enum(['suggested', 'accepted', 'rejected', 'kept']),
  reason: z.string().max(1000).nullable().optional(),
})

export const redactionManualSchema = z.object({
  targetKind: z.enum(['draft', 'attachment']),
  draftId: z.string().uuid().optional(),
  paragraphId: z.string().optional(),
  attachmentId: z.string().uuid().optional(),
  start: z.number().int().min(0),
  end: z.number().int().min(1),
  category: z.string().min(1).max(60).default('other'),
})

export const piiDetectSchema = z.object({ includeAttachments: z.boolean().default(true) })

export const exportSchema = z.object({
  format: z.enum(['docx', 'pdf', 'txt']),
  target: z.union([z.literal('letter'), z.object({ attachmentId: z.string().uuid() })]).default('letter'),
})

export const markSentSchema = z.object({
  respondedAt: isoDateSchema,
  channel: z.string().trim().min(1).max(60),
  addToArchive: z.boolean().default(true),
})

export const extendSchema = z.object({
  newDueDate: isoDateSchema,
  reason: z.string().trim().min(1).max(1000),
})

export const requestClarificationSchema = z.object({
  sentAt: isoDateSchema,
  deliveredAt: isoDateSchema.nullable().optional(),
})

export const clarificationDeliverySchema = z.object({ deliveredAt: isoDateSchema })

export const registerClarificationSchema = z.object({
  receivedAt: isoDateSchema,
  overrideDueDate: isoDateSchema.nullable().optional(),
})

export const intakeExtractSchema = z.object({
  attachmentId: z.string().uuid().optional(),
  text: z.string().max(100000).optional(),
  channel: channelSchema.optional(),
})
