import { NextResponse } from 'next/server'
import type { FilterQuery } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { PublicInfoDocument } from '../../data/entities'
import { intakeExtractorOutputSchema } from '../../data/ai-schemas'
import { intakeExtractSchema } from '../../data/validators'
import { handleRoute, parseBody, resolveRouteContext } from '../../lib/server/routeContext'
import { parseRequestText, type IntakeSuggestion } from '../../lib/intake/parse'
import { runAssistantObject } from '../../lib/server/assistant'
import { detectPiiByRules } from '../../lib/pii/rules'
import { jsonMethodDoc } from '../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['public_info_requests.manage'] },
}

const LOW_OCR_CONFIDENCE = 0.6

export async function POST(req: Request) {
  return handleRoute(async () => {
    const routeContext = await resolveRouteContext(req)
    const input = await parseBody(req, intakeExtractSchema)
    let text = input.text ?? ''
    let textSource = 'manual'
    let ocrConfidence: number | null = null
    const documentIds = Array.from(new Set([...(input.attachmentIds ?? []), ...(input.attachmentId ? [input.attachmentId] : [])]))
    const documents = documentIds.length > 0
      ? await findWithDecryption(
          routeContext.em,
          PublicInfoDocument,
          { id: { $in: documentIds }, tenantId: routeContext.tenantId, organizationId: routeContext.organizationId, deletedAt: null } as FilterQuery<PublicInfoDocument>,
          { orderBy: { createdAt: 'asc' } },
          routeContext,
        )
      : []
    const isLowConfidence = (document: PublicInfoDocument) =>
      !document.extractedText?.trim() || ((document.textSource === 'ocr_tesseract' || document.textSource === 'ocr_llm') && document.ocrConfidence != null && document.ocrConfidence < LOW_OCR_CONFIDENCE)
    if (documents.length > 0) {
      text = text || documents.map((document) => document.extractedText?.trim() ?? '').filter(Boolean).join('\n\n')
      const scanned = documents.filter((document) => document.textSource === 'ocr_tesseract')
      textSource = scanned.length > 0 ? 'ocr_tesseract' : documents[0].textSource
      ocrConfidence = scanned.length > 0 ? Math.min(...scanned.map((document) => document.ocrConfidence ?? 0)) : documents[0].ocrConfidence ?? null
    }
    const unreadable = !text.trim() || (documents.length > 0 && documents.every(isLowConfidence))
    const heuristic: IntakeSuggestion = parseRequestText(text, { channel: input.channel })
    let suggestions = heuristic
    let generatedBy: 'ai' | 'heuristic' = 'heuristic'
    if (text.trim() && !unreadable) {
      const aiResult = await runAssistantObject({
        agentId: 'public_info_requests.intake_extractor',
        schemaName: 'UdipIntakeSuggestion',
        schema: intakeExtractorOutputSchema,
        container: routeContext.container,
        scope: routeContext,
        prompt: text.slice(0, 20000),
      })
      if (aiResult) {
        suggestions = { ...heuristic, ...aiResult, caseNumber: heuristic.caseNumber }
        generatedBy = 'ai'
      }
    }
    const lowConfidenceSpans = detectPiiByRules(text)
      .filter((span) => span.category === 'private_phone' || span.category === 'private_email')
      .map((span) => ({ start: span.start, end: span.end }))
    return NextResponse.json({
      suggestions,
      generatedBy,
      text,
      textSource,
      ocrConfidence,
      unreadable,
      reviewSpans: textSource === 'ocr_tesseract' ? lowConfidenceSpans : [],
    })
  })
}

export const openApi: OpenApiRouteDoc = {
  methods: {
    POST: jsonMethodDoc({ summary: 'Suggest request fields and points from an uploaded document or pasted text', requestSchema: intakeExtractSchema }),
  },
}
