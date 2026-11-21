import { answerIntroText, buildTemplateParagraphs, closingSpec, paragraphsFromSpecs, pointMarker } from './templates'
import type { DraftFlag, DraftParagraph, DraftParagraphKind, DraftSource, LetterContext, LetterType, ReplyText } from './types'

type Marker = { position: number; start: number; end: number }
type ExtractedSpan = { text: string; quote: string }
type ParagraphSpecWithSources = {
  kind: DraftParagraphKind
  text: string
  pointPosition?: number
  flags?: DraftFlag[]
  sources?: DraftSource[]
}

const QUOTE_LENGTH = 160

const MARKER_FAMILIES: RegExp[] = [
  /(?<![\p{L}\d])Ad\.?[ \t]*(\d{1,3})(?!\d)[.:)]?/giu,
  /^[ \t]*pkt\.?[ \t]*(\d{1,3})(?!\d)[.:)]?/gimu,
  /^[ \t]*(\d{1,3})(?:\.(?!\d)|\))/gmu,
]

const CLOSING_PATTERN = /(?:Z\s+poważaniem|Z\s+wyrazami\s+szacunku|Łączę\s+wyrazy\s+szacunku|Łączę\s+pozdrowienia|Pozdrawiam\b)/iu
const INTRO_SENTENCE_PATTERN = /^(?:W\s+odpowiedzi|Odpowiadając|W\s+nawiązaniu|W\s+związku\s+z)/iu
const INTRO_CLAUSE_PATTERN = /(?:w\s+odpowiedzi\s+na|odpowiadając\s+na|w\s+nawiązaniu\s+do)/iu
const HEADER_BODY_MIN_WORDS = 6
const INFORM_PATTERN = /informuj(?:ę|emy|e)[,]?\s*(?:że|iż)?[,]?\s*/iu
const FACT_PATTERN = /\d|nie\s+(?:posiada|prowadzi|dysponuje|gromadzi|przetwarza)/iu
const NO_STATISTICS_PATTERN = /nie\s+prowadzi\s+(?:\p{L}+\s+)?statystyk/iu
const LIST_ITEM_PATTERN = /^(?:\d{1,2}[.)]|[-•–])\s/u
const ABBREVIATIONS = new Set([
  'ul', 'al', 'pl', 'tj', 'np', 'nr', 'ok', 'tel', 'im', 'św', 'ks', 'dr', 'prof', 'mgr', 'inż', 'pkt', 'ust', 'art',
  'poz', 'godz', 'ww', 'jw', 'tzw', 'm.in', 'szt', 'tys', 'mln', 'mld', 'woj', 'pow', 'dz', 'u', 'lit', 'zob', 'por',
])

const BOILERPLATE_LINE_PATTERNS: RegExp[] = [
  /^[\p{Lu}\s.,\-–„”"]+$/u,
  /^\p{Lu}{2,}[.\-/][\p{Lu}\d.\-/]*\d[\p{Lu}\d.\-/]*$/u,
  /^[\p{L} ]+,\s*(?:dnia\s+)?\d{1,2}(?:\.\d{1,2}\.\d{4}|\s+\p{L}+\s+\d{4})/u,
  /^(?:dnia\s+)?\d{1,2}[.\-]\d{1,2}[.\-]\d{4}(?:\s*r\.?)?$/u,
  /^(?:ul\.|tel\.|fax|e-mail|email|www\.|\d{2}-\d{3}\s)/iu,
  /^(?:Znak\s+sprawy|Nasz\s+znak|Wasz\s+znak|Dotyczy|Sprawa|Do:)/iu,
]

function freshPattern(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags)
}

function findMarkers(text: string, pattern: RegExp): Marker[] {
  return Array.from(text.matchAll(freshPattern(pattern))).map((match) => ({
    position: Number(match[1]),
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }))
}

function cutAtClosing(text: string): string {
  const match = CLOSING_PATTERN.exec(text)
  return match ? text.slice(0, match.index) : text
}

function joinLines(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const merged: string[] = []
  for (const line of lines) {
    const previous = merged[merged.length - 1]
    if (previous === undefined || LIST_ITEM_PATTERN.test(line)) {
      merged.push(line)
    } else if (/\p{L}-$/u.test(previous) && /^\p{Ll}/u.test(line)) {
      merged[merged.length - 1] = `${previous.slice(0, -1)}${line}`
    } else {
      merged[merged.length - 1] = `${previous} ${line}`
    }
  }
  return merged.join('\n').trim()
}

function capitalize(text: string): string {
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text
}

function quoteOf(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, QUOTE_LENGTH)
}

function extractMarkedSpan(text: string, position: number): string | null {
  for (const family of MARKER_FAMILIES) {
    const markers = findMarkers(text, family)
    if (markers.length === 0) continue
    const marker = markers.find((entry) => entry.position === position)
    if (!marker) return null
    const next = markers.find((entry) => entry.start > marker.start)
    const span = joinLines(cutAtClosing(text.slice(marker.end, next ? next.start : text.length)))
    return span || null
  }
  return null
}

function isBoilerplateLine(line: string): boolean {
  return BOILERPLATE_LINE_PATTERNS.some((pattern) => pattern.test(line))
}

function lastWord(text: string): string {
  const match = /(\S+)$/u.exec(text)
  return match ? match[1].replace(/^[(„"]+/u, '').toLowerCase() : ''
}

export function splitSentences(text: string): string[] {
  const sentences: string[] = []
  const boundary = /([.!?…])\s+(?=[\p{Lu}„"])/gu
  let cursor = 0
  for (const match of text.matchAll(boundary)) {
    const end = (match.index ?? 0) + match[1].length
    const candidate = text.slice(cursor, end)
    const word = lastWord(candidate.slice(0, -1))
    if (match[1] === '.' && (ABBREVIATIONS.has(word) || /^\p{L}$/u.test(word))) continue
    sentences.push(candidate.trim())
    cursor = end
  }
  const rest = text.slice(cursor).trim()
  if (rest) sentences.push(rest)
  return sentences.filter(Boolean)
}

function stripSalutation(line: string): string {
  return line.replace(/^Szanown\p{L}*\s+(?:Pan\p{L}*|Państwo)\s*,?\s*/iu, '')
}

function wordCount(line: string): number {
  return line.split(/\s+/).filter(Boolean).length
}

function dropHeaderLines(lines: string[]): string[] {
  const firstBodyLine = lines.findIndex((line) => wordCount(line) >= HEADER_BODY_MIN_WORDS)
  if (firstBodyLine <= 0) return lines
  return lines.filter((line, index) => index >= firstBodyLine || (/\d/.test(line) && wordCount(line) > 2))
}

function stripIntroClause(sentence: string): string {
  const informMatch = INFORM_PATTERN.exec(sentence)
  const introMatch = INTRO_CLAUSE_PATTERN.exec(sentence)
  const startsWithIntro = INTRO_SENTENCE_PATTERN.test(sentence)
  if (!startsWithIntro && !(introMatch && informMatch && introMatch.index < informMatch.index)) return sentence
  if (!informMatch) return ''
  return capitalize(sentence.slice(informMatch.index + informMatch[0].length).trim())
}

function substantiveBody(text: string): string | null {
  const cleaned = cutAtClosing(text)
    .split(/\r?\n/)
    .map((line) => stripSalutation(line.replace(/\s+/g, ' ').trim()))
    .filter((line) => line && !isBoilerplateLine(line))
  const lines = dropHeaderLines(cleaned)
  const joined = joinLines(lines.join('\n')).replace(/\n/g, ' ')
  const sentences = splitSentences(joined)
    .map(stripIntroClause)
    .filter((sentence) => sentence.length > 0)
  const facts = sentences.filter((sentence) => FACT_PATTERN.test(sentence) || NO_STATISTICS_PATTERN.test(sentence))
  const chosen = facts.length > 0 ? facts : sentences
  const body = chosen.join(' ').trim()
  return body || null
}

function coversPosition(reply: ReplyText, position: number): boolean {
  return reply.pointPositions.length === 0 || reply.pointPositions.includes(position)
}

function extractForPoint(reply: ReplyText, position: number, totalPoints: number): ExtractedSpan | null {
  const marked = extractMarkedSpan(reply.text, position)
  if (marked) return { text: capitalize(marked), quote: quoteOf(marked) }
  const coversOnlyThis = reply.pointPositions.length === 1 && reply.pointPositions[0] === position
  if (!coversOnlyThis && totalPoints !== 1) return null
  const body = substantiveBody(reply.text)
  if (!body) return null
  return { text: body, quote: quoteOf(body) }
}

function repliedDepartments(replies: ReplyText[], fallback: string[]): string[] {
  const names = Array.from(new Set(replies.map((reply) => reply.departmentName.trim()).filter(Boolean)))
  return names.length > 0 ? names : fallback
}

function pointSpec(position: number, replies: ReplyText[], totalPoints: number): ParagraphSpecWithSources {
  const texts: string[] = []
  const sources: DraftSource[] = []
  for (const reply of replies) {
    if (!coversPosition(reply, position)) continue
    const extracted = extractForPoint(reply, position, totalPoints)
    if (!extracted) continue
    texts.push(extracted.text)
    sources.push({ attachmentId: reply.attachmentId, quote: extracted.quote })
  }
  if (texts.length === 0) return { kind: 'point', pointPosition: position, text: '', flags: ['gap'] }
  return { kind: 'point', pointPosition: position, text: `${pointMarker(position)}\n${texts.join('\n')}`, sources }
}

export function draftFromReplies(type: LetterType, ctx: LetterContext, replies: ReplyText[]): DraftParagraph[] {
  if (type !== 'answer') return buildTemplateParagraphs(type, ctx)
  const draftCtx: LetterContext = { ...ctx, departments: repliedDepartments(replies, ctx.departments) }
  const points = [...ctx.points].sort((left, right) => left.position - right.position)
  const specs: ParagraphSpecWithSources[] = [
    { kind: 'intro', text: answerIntroText(draftCtx) },
    ...points.map((point) => pointSpec(point.position, replies, points.length)),
  ]
  const closing = closingSpec(type)
  return paragraphsFromSpecs(closing ? [...specs, closing] : specs)
}
