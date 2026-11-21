import { createHash } from 'node:crypto'
import type { DraftFlag, DraftParagraph, GroundingSource, LetterContext } from './types'

type GroundingContext = Pick<LetterContext, 'points' | 'caseNumber' | 'letterDate' | 'receivedAt' | 'requestDate'>

type TokenMatch = { index: number; raw: string }

const POLISH_MONTH_NUMBERS: Record<string, number> = {
  stycznia: 1,
  lutego: 2,
  marca: 3,
  kwietnia: 4,
  maja: 5,
  czerwca: 6,
  lipca: 7,
  sierpnia: 8,
  września: 9,
  października: 10,
  listopada: 11,
  grudnia: 12,
}

const MONTH_ALTERNATION = Object.keys(POLISH_MONTH_NUMBERS).join('|')

const AD_MARKER_PATTERN = /(?<![\p{L}\d])Ad\.?\s*\d{1,3}(?!\d)[.:)]?/giu
const CASE_NUMBER_PATTERN =
  /(?<![\p{L}\d])(?:\p{Lu}{2,}(?:\.[\p{Lu}\d]+){2,}|[\p{L}\d]+(?:[.-][\p{L}\d]+)*(?:\/[\p{L}\d]+(?:[.-][\p{L}\d]+)*)+)(?![\p{L}\d])/gu
const ISO_DATE_PATTERN = /(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/g
const NUMERIC_DATE_PATTERN = /(?<![\d.])\d{1,2}\.\d{1,2}\.\d{4}(?![\d])/g
const TEXT_DATE_PATTERN = new RegExp(`(?<!\\d)\\d{1,2}\\s+(?:${MONTH_ALTERNATION})\\s+\\d{4}(?!\\d)`, 'giu')
const NUMBER_PATTERN =
  /(?<![\p{L}\d.,])(?:\d{1,3}(?:[   ]\d{3})+(?!\d)|\d{1,3}(?:\.\d{3})+(?![\d.])|\d+)(?:,\d+)?(?:\.\d{1,2}(?![\d.]))?(?:[  ]?(?:zł|PLN)(?!\p{L}))?/gu

const FLAG_ORDER: DraftFlag[] = ['gap', 'unsupported', 'number_mismatch', 'assistant_only']
const SOURCED_KINDS = new Set<DraftParagraph['kind']>(['point', 'note'])
const LEADING_AD_MARKER = /^\s*Ad\.?\s*\d{1,3}(?!\d)[.:)]?\s*/iu

export function contentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function isoFromParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`
}

function normalizeNumber(token: string): string {
  let value = token.replace(/(zł|PLN)$/iu, '').replace(/[\s  ]+/g, '')
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(value)) value = value.replace(/\./g, '')
  if (/^\d+\.\d{1,2}$/.test(value)) value = value.replace('.', ',')
  value = value.replace(/,0+$/, '')
  return value
}

export function normalizeFactToken(token: string): string {
  const trimmed = token.trim().replace(/\s+r\.?$/u, '')
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (isoMatch) return isoFromParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))
  const numericDate = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(trimmed)
  if (numericDate) return isoFromParts(Number(numericDate[3]), Number(numericDate[2]), Number(numericDate[1]))
  const textDate = new RegExp(`^(\\d{1,2})\\s+(${MONTH_ALTERNATION})\\s+(\\d{4})$`, 'iu').exec(trimmed)
  if (textDate) {
    const month = POLISH_MONTH_NUMBERS[textDate[2].toLowerCase()]
    return isoFromParts(Number(textDate[3]), month, Number(textDate[1]))
  }
  if (/^\d[\d\s  .,]*(?:\s?(?:zł|PLN))?$/iu.test(trimmed)) return normalizeNumber(trimmed)
  if (/\d/.test(trimmed) && /[\p{L}/]/u.test(trimmed)) return trimmed.replace(/\s+/g, '').toUpperCase()
  return trimmed.replace(/\s+/g, ' ').toLowerCase()
}

function collectMatches(text: string, pattern: RegExp, accept?: (raw: string) => boolean): { matches: TokenMatch[]; masked: string } {
  const matches: TokenMatch[] = []
  const masked = text.replace(new RegExp(pattern.source, pattern.flags), (raw: string, ...rest: unknown[]) => {
    const offset = rest.find((entry) => typeof entry === 'number')
    if (accept && !accept(raw)) return raw
    matches.push({ index: typeof offset === 'number' ? offset : 0, raw })
    return ' '.repeat(raw.length)
  })
  return { matches, masked }
}

export function extractFactTokens(text: string): string[] {
  let working = text.replace(new RegExp(AD_MARKER_PATTERN.source, AD_MARKER_PATTERN.flags), (raw) => ' '.repeat(raw.length))
  const found: TokenMatch[] = []
  const steps: { pattern: RegExp; accept?: (raw: string) => boolean }[] = [
    { pattern: CASE_NUMBER_PATTERN, accept: (raw) => /\d/.test(raw) },
    { pattern: ISO_DATE_PATTERN },
    { pattern: NUMERIC_DATE_PATTERN },
    { pattern: TEXT_DATE_PATTERN },
    { pattern: NUMBER_PATTERN },
  ]
  for (const step of steps) {
    const result = collectMatches(working, step.pattern, step.accept)
    found.push(...result.matches)
    working = result.masked
  }
  const seen = new Set<string>()
  return found
    .sort((left, right) => left.index - right.index)
    .map((match) => match.raw.trim())
    .filter((raw) => {
      if (!raw || seen.has(raw)) return false
      seen.add(raw)
      return true
    })
}

function sourceTokenSet(text: string): Set<string> {
  const tokens = new Set<string>(extractFactTokens(text).map(normalizeFactToken))
  for (const digits of text.match(/\d+/g) ?? []) tokens.add(digits)
  for (const digits of text.match(/\d+(?:,\d+)?/g) ?? []) tokens.add(normalizeNumber(digits))
  return tokens
}

function dateExclusions(value: string | null | undefined): string[] {
  if (!value) return []
  const iso = value.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return []
  return [iso, iso.slice(0, 4)]
}

function buildExclusions(ctx: GroundingContext): Set<string> {
  const exclusions = new Set<string>()
  if (ctx.caseNumber) {
    exclusions.add(normalizeFactToken(ctx.caseNumber))
    const years = ctx.caseNumber.match(/(?<!\d)\d{4}(?!\d)/g)
    if (years) exclusions.add(years[years.length - 1])
  }
  for (const value of [ctx.letterDate, ctx.receivedAt, ctx.requestDate]) {
    for (const entry of dateExclusions(value)) exclusions.add(entry)
  }
  return exclusions
}

function orderFlags(flags: Set<DraftFlag>): DraftFlag[] {
  return FLAG_ORDER.filter((flag) => flags.has(flag))
}

function finalizeParagraph(paragraph: DraftParagraph, flags: Set<DraftFlag>, mismatchTokens: string[]): DraftParagraph {
  const hash = contentHash(paragraph.text)
  const result: DraftParagraph = { ...paragraph, contentHash: hash, flags: orderFlags(flags) }
  if (mismatchTokens.length > 0) result.mismatchTokens = mismatchTokens
  else delete result.mismatchTokens
  if (paragraph.confirmedBy && paragraph.contentHash !== hash) result.confirmedBy = null
  return result
}

function bodyWithoutMarker(paragraph: DraftParagraph): string {
  return paragraph.kind === 'point' ? paragraph.text.replace(LEADING_AD_MARKER, '') : paragraph.text
}

function checkParagraph(
  paragraph: DraftParagraph,
  exclusions: Set<string>,
  sourceTexts: Map<string, string>,
  sourceTokenCache: Map<string, Set<string>>,
): DraftParagraph {
  const flags = new Set<DraftFlag>()
  if (paragraph.flags.includes('assistant_only')) flags.add('assistant_only')
  if (!SOURCED_KINDS.has(paragraph.kind)) return finalizeParagraph(paragraph, flags, [])
  const body = bodyWithoutMarker(paragraph).trim()
  if (!body) {
    if (paragraph.kind === 'point') flags.add('gap')
    return finalizeParagraph(paragraph, flags, [])
  }
  const citedIds = Array.from(new Set(paragraph.sources.map((source) => source.attachmentId))).filter((id) => sourceTexts.has(id))
  if (citedIds.length === 0) {
    flags.add('unsupported')
    return finalizeParagraph(paragraph, flags, [])
  }
  const citedTokenSets = citedIds.map((id) => {
    const cached = sourceTokenCache.get(id)
    if (cached) return cached
    const computed = sourceTokenSet(sourceTexts.get(id) ?? '')
    sourceTokenCache.set(id, computed)
    return computed
  })
  const mismatchTokens = extractFactTokens(body).filter((raw) => {
    const normalized = normalizeFactToken(raw)
    if (exclusions.has(normalized)) return false
    return !citedTokenSets.some((tokens) => tokens.has(normalized))
  })
  if (mismatchTokens.length > 0) flags.add('number_mismatch')
  return finalizeParagraph(paragraph, flags, mismatchTokens)
}

function insertMissingPoints(paragraphs: DraftParagraph[], points: GroundingContext['points']): DraftParagraph[] {
  const covered = new Set(
    paragraphs.filter((paragraph) => paragraph.kind === 'point' && typeof paragraph.pointPosition === 'number').map((paragraph) => paragraph.pointPosition),
  )
  const missing = [...points].sort((left, right) => left.position - right.position).filter((point) => !covered.has(point.position))
  if (missing.length === 0) return paragraphs
  const placeholders: DraftParagraph[] = missing.map((point) => ({
    id: `point-${point.position}-gap`,
    kind: 'point',
    pointPosition: point.position,
    text: '',
    contentHash: contentHash(''),
    sources: [],
    flags: ['gap'],
  }))
  const firstClosing = paragraphs.findIndex((paragraph) => paragraph.kind === 'closing')
  const insertAt = firstClosing === -1 ? paragraphs.length : firstClosing
  return [...paragraphs.slice(0, insertAt), ...placeholders, ...paragraphs.slice(insertAt)]
}

export function checkGrounding(paragraphs: DraftParagraph[], ctx: GroundingContext, sources: GroundingSource[]): DraftParagraph[] {
  const sourceTexts = new Map<string, string>()
  for (const source of sources) {
    const previous = sourceTexts.get(source.attachmentId)
    sourceTexts.set(source.attachmentId, previous ? `${previous}\n${source.text}` : source.text)
  }
  const exclusions = buildExclusions(ctx)
  const sourceTokenCache = new Map<string, Set<string>>()
  const checked = paragraphs.map((paragraph) => checkParagraph(paragraph, exclusions, sourceTexts, sourceTokenCache))
  return insertMissingPoints(checked, ctx.points)
}
