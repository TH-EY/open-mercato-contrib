import { existsSync } from 'node:fs'
import type { FilterQuery } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { PublicInfoRedactionMark, PublicInfoResponseDraft } from '../../data/entities'
import { loadRequestOr404, loadSettings } from './requests'
import { buildLetterContext, loadCaseDocuments, requestPointsOrSummary, type LetterOptions } from './caseServices'
import { assertDraftExportable, assertMarksDecided, assertMarksFresh, attachmentTextHash, readPiiChecked, redactDocumentText, redactParagraphs } from './redaction'
import { escapeHtml, renderLetterHtml, renderLetterText } from '../drafting/render'
import type { DraftParagraph, LetterType } from '../drafting/types'
import type { RouteContext } from './routeContext'

export type ExportFormat = 'docx' | 'pdf' | 'txt'

const CHROMIUM_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

export function resolveChromiumPath(): string | null {
  const configured = process.env.DOCUMENTS_PDF_CHROMIUM_PATH?.trim() || process.env.PUPPETEER_EXECUTABLE_PATH?.trim()
  if (configured) return configured
  return CHROMIUM_PATHS.find((candidate) => existsSync(candidate)) ?? null
}

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_')
}

function wrapPdfHtml(body: string): string {
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><style>body{font-family:'Times New Roman',serif;font-size:12pt;line-height:1.5;margin:2.2cm}p{margin:0 0 0.6em;white-space:pre-wrap}</style></head><body>${body}</body></html>`
}

async function toDocx(html: string): Promise<Uint8Array> {
  const renderer = (await import('@open-mercato/documents/modules/documents/lib/docxRenderer')) as unknown as {
    renderDocxWithCapacity: (input: string) => Promise<Uint8Array>
  }
  return renderer.renderDocxWithCapacity(html)
}

async function toPdf(html: string): Promise<Uint8Array> {
  const executablePath = resolveChromiumPath()
  if (!executablePath) throw new CrudHttpError(501, { error: 'PDF export requires a Chromium executable', code: 'pdf_unavailable' })
  const renderer = (await import('@open-mercato/documents/modules/documents/lib/pdfRenderer')) as unknown as {
    renderPdfWithChromium: (input: { html: string; executablePath: string; isAllowedRequest: (request: { url: string }) => boolean }) => Promise<Uint8Array>
  }
  return renderer.renderPdfWithChromium({ html: wrapPdfHtml(html), executablePath, isAllowedRequest: () => false })
}

function fileResponse(bytes: Uint8Array | string, fileName: string, contentType: string): Response {
  const body = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
  const buffer = new ArrayBuffer(body.byteLength)
  new Uint8Array(buffer).set(body)
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  })
}

async function renderAs(format: ExportFormat, html: string, text: string, baseName: string): Promise<Response> {
  if (format === 'txt') return fileResponse(text, `${baseName}.txt`, 'text/plain; charset=utf-8')
  if (format === 'pdf') return fileResponse(await toPdf(html), `${baseName}.pdf`, 'application/pdf')
  return fileResponse(await toDocx(html), `${baseName}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
}

export async function exportDraft(routeContext: RouteContext, requestId: string, draftId: string, format: ExportFormat): Promise<Response> {
  const scope = { tenantId: routeContext.tenantId, organizationId: routeContext.organizationId }
  const { em } = routeContext
  const request = await loadRequestOr404(em, scope, requestId)
  const draft = await em.findOne(PublicInfoResponseDraft, { id: draftId, requestId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null })
  if (!draft) throw new CrudHttpError(404, { error: 'Draft not found' })
  const marks = await findWithDecryption(
    em,
    PublicInfoRedactionMark,
    { draftId, tenantId: scope.tenantId, organizationId: scope.organizationId } as FilterQuery<PublicInfoRedactionMark>,
    undefined,
    scope,
  )
  assertDraftExportable(draft, marks)
  const settings = await loadSettings(em, scope)
  const points = await requestPointsOrSummary(em, scope, request)
  const options = (draft.letterOptions ?? {}) as LetterOptions & { departmentNames?: string[]; letterDate?: string }
  const context = await buildLetterContext({
    em,
    scope,
    request,
    points,
    departmentNames: options.departmentNames ?? [],
    options,
    settings,
    letterDate: options.letterDate,
  })
  const paragraphs = redactParagraphs(draft.paragraphs, marks) as DraftParagraph[]
  const renderOptions = { attachments: draft.attachmentList ?? [], letterType: draft.letterType as LetterType }
  const html = renderLetterHtml(paragraphs, context, renderOptions)
  const text = renderLetterText(paragraphs, context, renderOptions)
  return renderAs(format, html, text, safeFileName(`Odpowiedz_${request.caseNumber}_v${draft.version}`))
}

export async function exportDocument(routeContext: RouteContext, requestId: string, documentId: string, format: ExportFormat): Promise<Response> {
  const scope = { tenantId: routeContext.tenantId, organizationId: routeContext.organizationId }
  const { em } = routeContext
  const request = await loadRequestOr404(em, scope, requestId)
  const documents = await loadCaseDocuments(em, scope, requestId)
  const document = documents.find((candidate) => candidate.id === documentId)
  if (!document || document.kind !== 'reply') throw new CrudHttpError(404, { error: 'Document not found' })
  const text = document.extractedText ?? ''
  const drafts = await em.find(PublicInfoResponseDraft, { requestId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null })
  const checkedHash = attachmentTextHash(text)
  if (!drafts.some((draft) => readPiiChecked(draft.letterOptions).documents?.[documentId] === checkedHash)) {
    throw new CrudHttpError(409, { error: 'Personal data check has not been run on this document', code: 'pii_not_checked' })
  }
  const marks = await findWithDecryption(
    em,
    PublicInfoRedactionMark,
    { requestId, attachmentId: documentId, tenantId: scope.tenantId, organizationId: scope.organizationId } as FilterQuery<PublicInfoRedactionMark>,
    undefined,
    scope,
  )
  assertMarksDecided(marks)
  assertMarksFresh(marks, [], new Map([[documentId, text]]))
  const redacted = redactDocumentText(text, documentId, marks)
  const html = `<p><strong>${escapeHtml(document.fileName)}</strong> — wersja zanonimizowana (${escapeHtml(request.caseNumber)})</p>${redacted
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block)}</p>`)
    .join('')}`
  return renderAs(format, html, redacted, safeFileName(`${document.fileName.replace(/\.[^.]+$/, '')}_zanonimizowany`))
}
