import { z } from 'zod'

export const ocrTranscriberOutputSchema = z.object({
  text: z.string(),
  confidence: z.number().min(0).max(1),
  legible: z.boolean(),
})

export const intakeExtractorOutputSchema = z.object({
  requesterName: z.string().nullable(),
  requesterKind: z.enum(['person', 'organisation', 'media', 'councillor']),
  requesterAddress: z.string().nullable(),
  requesterContact: z.string().nullable(),
  deliveryForm: z.enum(['email', 'post', 'epuap', 'inspection']),
  letterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  subjectSummary: z.string().min(1).max(300),
  points: z.array(z.string().min(1)).min(1).max(50),
})

export const routerOutputSchema = z.object({
  proposals: z.array(
    z.object({
      departmentId: z.string(),
      pointPositions: z.array(z.number().int()),
      scopeText: z.string(),
      confidence: z.number().min(0).max(1),
      sources: z.array(z.object({ kind: z.enum(['department_scope', 'archive', 'law']), ref: z.string(), label: z.string() })).default([]),
    }),
  ),
  flags: z
    .array(
      z.object({
        kind: z.enum(['separate_entity', 'published_in_bip', 'personal_data', 'processed_information']),
        message: z.string(),
        departmentId: z.string().optional(),
      }),
    )
    .default([]),
})

export const drafterOutputSchema = z.object({
  paragraphs: z.array(
    z.object({
      kind: z.enum(['intro', 'point', 'closing', 'note']),
      pointPosition: z.number().int().optional(),
      text: z.string(),
      sources: z.array(z.object({ attachmentId: z.string(), page: z.number().int().optional(), quote: z.string() })).default([]),
    }),
  ),
})

export const piiDetectorOutputSchema = z.object({
  spans: z.array(z.object({ start: z.number().int().min(0), end: z.number().int().min(1), category: z.string(), confidence: z.number().min(0).max(1) })),
})
