import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { extractAttachmentContent } from '@open-mercato/core/modules/attachments/lib/textExtraction'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { PublicInfoTextSource } from '../../data/entities'

const logger = createLogger('public_info_requests').child({ component: 'text-extraction' })
const run = promisify(execFile)

const MIN_TEXT_LAYER_CHARS = 40
const MAX_OCR_PAGES = 10
const EXEC_TIMEOUT_MS = 120_000

export type ExtractedText = {
  text: string | null
  source: PublicInfoTextSource
  ocrConfidence: number | null
}

type OcrToolchain = { tesseract: string; pdftoppm: string | null; tessdataDir: string | null; language: string }

let cachedToolchain: OcrToolchain | null | undefined

function binary(name: string, envName: string): string {
  const configured = process.env[envName]
  return configured && configured.trim().length > 0 ? configured.trim() : name
}

async function canRun(command: string, args: string[]): Promise<string | null> {
  try {
    const { stdout, stderr } = await run(command, args, { timeout: 10_000 })
    return `${stdout}\n${stderr}`
  } catch {
    return null
  }
}

export async function resolveOcrToolchain(): Promise<OcrToolchain | null> {
  if (cachedToolchain !== undefined) return cachedToolchain
  if (process.env.PUBLIC_INFO_LOCAL_OCR === 'false') {
    cachedToolchain = null
    return null
  }
  const tesseract = binary('tesseract', 'PUBLIC_INFO_TESSERACT_BIN')
  const tessdataDir = process.env.PUBLIC_INFO_TESSDATA_DIR?.trim() || null
  const listArgs = tessdataDir ? ['--tessdata-dir', tessdataDir, '--list-langs'] : ['--list-langs']
  const languages = await canRun(tesseract, listArgs)
  if (languages === null) {
    cachedToolchain = null
    return null
  }
  const pdftoppm = binary('pdftoppm', 'PUBLIC_INFO_PDFTOPPM_BIN')
  const hasPdftoppm = (await canRun(pdftoppm, ['-v'])) !== null
  const hasPolish = /^pol$/m.test(languages)
  cachedToolchain = {
    tesseract,
    pdftoppm: hasPdftoppm ? pdftoppm : null,
    tessdataDir,
    language: hasPolish ? 'pol' : 'eng',
  }
  return cachedToolchain
}

export async function isLocalOcrAvailable(): Promise<boolean> {
  return (await resolveOcrToolchain()) !== null
}

function extensionOf(fileName: string): string {
  return path.extname(fileName).toLowerCase()
}

function isImage(fileName: string, mimeType: string | null): boolean {
  return (mimeType ?? '').startsWith('image/') || ['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp'].includes(extensionOf(fileName))
}

function isPdf(fileName: string, mimeType: string | null): boolean {
  return mimeType === 'application/pdf' || extensionOf(fileName) === '.pdf'
}

function decodeQuotedPrintable(input: string): string {
  const joined = input.replace(/=\r?\n/g, '')
  const bytes: number[] = []
  for (let index = 0; index < joined.length; index += 1) {
    const char = joined[index]
    const hex = joined.slice(index + 1, index + 3)
    if (char === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16))
      index += 2
    } else {
      bytes.push(...Buffer.from(char, 'utf8'))
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

export function extractEmailText(raw: string): string {
  const separator = raw.search(/\r?\n\r?\n/)
  const headerBlock = separator >= 0 ? raw.slice(0, separator) : ''
  let body = separator >= 0 ? raw.slice(separator).trim() : raw
  const headers: string[] = []
  for (const name of ['From', 'Date', 'Subject']) {
    const match = new RegExp(`^${name}:\\s*(.+)$`, 'mi').exec(headerBlock)
    if (match) headers.push(`${name}: ${match[1].trim()}`)
  }
  const plainPart = /Content-Type:\s*text\/plain[^\n]*\n([\s\S]*?)(?:\n--|$)/i.exec(body)
  if (plainPart) body = plainPart[1]
  if (/quoted-printable/i.test(raw)) body = decodeQuotedPrintable(body)
  body = body.replace(/^Content-[^\n]*\n/gim, '').trim()
  return [...headers, '', body].join('\n').trim()
}

async function ocrImages(toolchain: OcrToolchain, imagePaths: string[]): Promise<{ text: string; confidence: number | null }> {
  const pages: string[] = []
  const confidences: number[] = []
  for (const imagePath of imagePaths.slice(0, MAX_OCR_PAGES)) {
    const args = [imagePath, 'stdout', '-l', toolchain.language, '--psm', '3', '-c', 'tessedit_create_tsv=1']
    if (toolchain.tessdataDir) args.unshift('--tessdata-dir', toolchain.tessdataDir)
    const { stdout } = await run(toolchain.tesseract, args, { timeout: EXEC_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 })
    const lines = new Map<string, string[]>()
    for (const row of stdout.split('\n').slice(1)) {
      const columns = row.split('\t')
      if (columns.length < 12) continue
      const word = columns[11]?.trim()
      const confidence = Number(columns[10])
      if (!word) continue
      if (Number.isFinite(confidence) && confidence >= 0) confidences.push(confidence)
      const key = `${columns[2]}-${columns[3]}-${columns[4]}`
      const existing = lines.get(key) ?? []
      existing.push(word)
      lines.set(key, existing)
    }
    pages.push(Array.from(lines.values()).map((words) => words.join(' ')).join('\n'))
  }
  const confidence = confidences.length > 0 ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length / 100 : null
  return { text: pages.join('\n\n').trim(), confidence }
}

async function ocrFile(toolchain: OcrToolchain, workDir: string, filePath: string, pdf: boolean) {
  if (!pdf) return ocrImages(toolchain, [filePath])
  if (!toolchain.pdftoppm) return { text: '', confidence: null }
  const prefix = path.join(workDir, 'page')
  await run(toolchain.pdftoppm, ['-r', '300', '-l', String(MAX_OCR_PAGES), '-png', filePath, prefix], { timeout: EXEC_TIMEOUT_MS })
  const images = (await readdir(workDir))
    .filter((name) => name.startsWith('page') && name.endsWith('.png'))
    .sort()
    .map((name) => path.join(workDir, name))
  return ocrImages(toolchain, images)
}

export async function extractDocumentText(input: { buffer: Buffer; fileName: string; mimeType: string | null }): Promise<ExtractedText> {
  const extension = extensionOf(input.fileName)
  if (extension === '.eml' || input.mimeType === 'message/rfc822') {
    return { text: extractEmailText(input.buffer.toString('utf8')), source: 'email', ocrConfidence: null }
  }
  if (extension === '.txt' || extension === '.md' || (input.mimeType ?? '').startsWith('text/')) {
    return { text: input.buffer.toString('utf8').trim() || null, source: 'text', ocrConfidence: null }
  }
  const workDir = await mkdtemp(path.join(tmpdir(), 'udip-'))
  try {
    const filePath = path.join(workDir, `source${extension || '.bin'}`)
    await writeFile(filePath, input.buffer)
    const pdf = isPdf(input.fileName, input.mimeType)
    const image = isImage(input.fileName, input.mimeType)
    if (!image) {
      let extracted: string | null = null
      try {
        extracted = await extractAttachmentContent({ filePath, mimeType: input.mimeType ?? '' })
      } catch (error) {
        logger.warn('text layer extraction failed', { error })
      }
      if (extracted && extracted.replace(/\s+/g, '').length >= MIN_TEXT_LAYER_CHARS) {
        return { text: extracted, source: pdf ? 'pdf' : 'docx', ocrConfidence: null }
      }
      if (!pdf) return { text: extracted, source: extracted ? 'docx' : 'none', ocrConfidence: null }
    }
    const toolchain = await resolveOcrToolchain()
    if (!toolchain) return { text: null, source: 'none', ocrConfidence: null }
    const result = await ocrFile(toolchain, workDir, filePath, pdf)
    if (!result.text) return { text: null, source: 'none', ocrConfidence: result.confidence }
    return { text: result.text, source: 'ocr_tesseract', ocrConfidence: result.confidence }
  } catch (error) {
    logger.warn('document text extraction failed', { error })
    return { text: null, source: 'none', ocrConfidence: null }
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}
