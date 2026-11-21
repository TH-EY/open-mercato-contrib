import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { AttachmentService } from '@open-mercato/core/modules/attachments'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { PublicInfoDocument, type PublicInfoDocumentKind } from '../../data/entities'
import { handleRoute, resolveRouteContext } from '../../lib/server/routeContext'
import { REQUEST_ENTITY_ID } from '../../lib/server/requests'
import { ensurePublicInfoPartition, PUBLIC_INFO_PARTITION_CODE } from '../../lib/server/partition'
import { extractDocumentText, type ScanTranscriber } from '../../lib/server/textExtraction'
import { isOcrFallbackConfigured, ocrFallbackProvider, runAssistantObject } from '../../lib/server/assistant'
import { ocrTranscriberOutputSchema } from '../../data/ai-schemas'
import { OCR_DEFAULT_MODEL, OCR_DEFAULT_PROVIDER } from '../../ai-agents'
import { jsonMethodDoc } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['public_info_requests.view'] },
  POST: { requireAuth: true, requireFeatures: ['public_info_requests.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['public_info_requests.manage'] },
}

const listQuerySchema = z.object({ requestId: z.string().uuid(), kind: z.string().optional() })
const kindSchema = z.enum(['request', 'reply', 'clarification', 'other'])
const deleteQuerySchema = z.object({ id: z.string().uuid() })

export type DocumentDto = {
  id: string
  requestId: string
  attachmentId: string | null
  departmentQueryId: string | null
  kind: string
  fileName: string
  mimeType: string | null
  textSource: string
  ocrConfidence: number | null
  extractedText: string | null
  createdAt: string
}

export function toDocumentDto(document: PublicInfoDocument): DocumentDto {
  return {
    id: document.id,
    requestId: document.requestId,
    attachmentId: document.attachmentId ?? null,
    departmentQueryId: document.departmentQueryId ?? null,
    kind: document.kind,
    fileName: document.fileName,
    mimeType: document.mimeType ?? null,
    textSource: document.textSource,
    ocrConfidence: document.ocrConfidence ?? null,
    extractedText: document.extractedText ?? null,
    createdAt: document.createdAt.toISOString(),
  }
}

export async function GET(req: Request) {
  return handleRoute(async () => {
    const routeContext = await resolveRouteContext(req)
    const query = listQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams))
    const where: Record<string, unknown> = {
      requestId: query.requestId,
      tenantId: routeContext.tenantId,
      organizationId: routeContext.organizationId,
      deletedAt: null,
    }
    if (query.kind) where.kind = query.kind
    const documents = await findWithDecryption(
      routeContext.em,
      PublicInfoDocument,
      where as FilterQuery<PublicInfoDocument>,
      { orderBy: { createdAt: 'asc' } },
      routeContext,
    )
    return NextResponse.json({ items: documents.map(toDocumentDto) })
  })
}

export async function POST(req: Request) {
  return handleRoute(async () => {
    const routeContext = await resolveRouteContext(req)
    const attachmentService = routeContext.container.resolve('attachmentService') as AttachmentService
    const form = attachmentService.readUploadForm ? await attachmentService.readUploadForm(req) : await req.formData()
    const file = form.get('file')
    const requestId = z.string().uuid().parse(form.get('requestId'))
    const kind = kindSchema.parse(form.get('kind') ?? 'request') as PublicInfoDocumentKind
    const departmentQueryIdRaw = form.get('departmentQueryId')
    const departmentQueryId = typeof departmentQueryIdRaw === 'string' && departmentQueryIdRaw.length > 0
      ? z.string().uuid().parse(departmentQueryIdRaw)
      : null
    if (!(file instanceof File)) throw new CrudHttpError(400, { error: 'File is required' })
    attachmentService.validateUpload({ fileName: file.name, fileSize: file.size })

    const guard = await runRouteMutationGuards({
      container: routeContext.container,
      req,
      auth: { userId: routeContext.userId, tenantId: routeContext.tenantId, organizationId: routeContext.organizationId },
      input: { resourceKind: 'public_info_requests.document', resourceId: requestId, operation: 'create', mutationPayload: { requestId, kind } },
    })
    if (!guard.ok) return guard.response

    const buffer = Buffer.from(await file.arrayBuffer())
    const mimeType = file.type || null
    const transcribe: ScanTranscriber | undefined = isOcrFallbackConfigured()
      ? async (images) => {
          const provider = ocrFallbackProvider()
          const model = process.env.PUBLIC_INFO_OCR_MODEL?.trim() || (provider === OCR_DEFAULT_PROVIDER ? OCR_DEFAULT_MODEL : undefined)
          const result = await runAssistantObject({
            agentId: 'public_info_requests.ocr_transcriber',
            prompt: `Przepisz treść załączonego skanu pisma (${images.length} ${images.length === 1 ? 'strona' : 'strony'}).`,
            messageParts: images.map((image, index) => ({
              type: 'file' as const,
              mediaType: image.mediaType,
              url: `data:${image.mediaType};base64,${image.data.toString('base64')}`,
              filename: `strona-${index + 1}`,
            })),
            providerOverride: provider,
            ...(model ? { modelOverride: model } : {}),
            schemaName: 'UdipScanTranscription',
            schema: ocrTranscriberOutputSchema,
            container: routeContext.container,
            scope: { tenantId: routeContext.tenantId, organizationId: routeContext.organizationId, userId: routeContext.userId },
          })
          if (!result || !result.legible) return null
          return { text: result.text, confidence: result.confidence }
        }
      : undefined
    const extracted = await extractDocumentText({ buffer, fileName: file.name, mimeType, transcribe })
    const em = routeContext.container.resolve('em') as EntityManager
    await ensurePublicInfoPartition(em.fork())
    const documentId = randomUUID()
    const created = await attachmentService.createScoped({
      entityId: REQUEST_ENTITY_ID,
      recordId: requestId,
      tenantId: routeContext.tenantId,
      organizationId: routeContext.organizationId,
      partitionCode: PUBLIC_INFO_PARTITION_CODE,
      fileName: file.name,
      declaredMimeType: mimeType,
      buffer,
    })
    const writeEm = em.fork()
    const document = writeEm.create(PublicInfoDocument, {
      id: documentId,
      tenantId: routeContext.tenantId,
      organizationId: routeContext.organizationId,
      requestId,
      attachmentId: created.id,
      departmentQueryId,
      kind,
      fileName: file.name,
      mimeType,
      extractedText: extracted.text,
      textSource: extracted.source,
      ocrConfidence: extracted.ocrConfidence,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await writeEm.persist(document).flush()
    try {
      await guard.runAfterSuccess()
    } catch {
      // committed upload must still succeed
    }
    return NextResponse.json({ ...toDocumentDto(document), extractedText: extracted.text }, { status: 201 })
  })
}

export async function DELETE(req: Request) {
  return handleRoute(async () => {
    const routeContext = await resolveRouteContext(req)
    const query = deleteQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams))
    const em = routeContext.container.resolve('em') as EntityManager
    const writeEm = em.fork()
    const document = await findOneWithDecryption(
      writeEm,
      PublicInfoDocument,
      { id: query.id, tenantId: routeContext.tenantId, organizationId: routeContext.organizationId, deletedAt: null } as FilterQuery<PublicInfoDocument>,
      undefined,
      routeContext,
    )
    if (!document) throw new CrudHttpError(404, { error: 'Document not found' })
    if (document.kind !== 'request') {
      throw new CrudHttpError(409, { error: 'Only request documents can be removed', code: 'document_not_removable' })
    }
    const guard = await runRouteMutationGuards({
      container: routeContext.container,
      req,
      auth: { userId: routeContext.userId, tenantId: routeContext.tenantId, organizationId: routeContext.organizationId },
      input: { resourceKind: 'public_info_requests.document', resourceId: document.requestId, operation: 'delete', mutationPayload: { documentId: document.id } },
    })
    if (!guard.ok) return guard.response
    const attachmentService = routeContext.container.resolve('attachmentService') as AttachmentService
    if (document.attachmentId && attachmentService.releaseScoped) {
      try {
        await attachmentService.releaseScoped({
          attachmentId: document.attachmentId,
          tenantId: routeContext.tenantId,
          organizationId: routeContext.organizationId,
          expectedOwner: { entityId: REQUEST_ENTITY_ID, recordId: document.requestId },
          expectedAssignment: { type: REQUEST_ENTITY_ID, id: document.requestId },
          expectedPartitionCode: PUBLIC_INFO_PARTITION_CODE,
        })
      } catch (error) {
        if (!isCrudHttpError(error) || (error.status !== 404 && error.status !== 409)) throw error
      }
    }
    document.deletedAt = new Date()
    document.updatedAt = new Date()
    await writeEm.flush()
    try {
      await guard.runAfterSuccess()
    } catch {
      // committed removal must still succeed
    }
    return NextResponse.json({ ok: true })
  })
}

export const openApi: OpenApiRouteDoc = {
  methods: {
    GET: jsonMethodDoc({ summary: 'List documents (request scans, department replies) of a case', querySchema: listQuerySchema }),
    POST: {
      summary: 'Upload a document, extract its text (text layer or local OCR) and store it on the case',
      tags: ['Public information requests'],
      requestBody: { contentType: 'multipart/form-data', schema: z.object({ file: z.any(), requestId: z.string().uuid(), kind: kindSchema.optional(), departmentQueryId: z.string().uuid().optional() }) },
      responses: [{ status: 201, description: 'Stored document with extracted text', schema: z.object({ id: z.string() }).passthrough() }],
    },
  },
}
