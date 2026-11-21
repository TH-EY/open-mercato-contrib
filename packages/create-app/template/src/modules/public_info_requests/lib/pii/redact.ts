import { createHash } from 'node:crypto'
import { ALL_LETTERS, detectPiiByRules, type PiiRuleOptions } from './rules'

export type RedactionRange = { start: number; end: number }

export type ArchiveRequester = {
  name?: string | null
  address?: string | null
  contact?: string | null
}

export const DEFAULT_REDACTION_REPLACEMENT = '[dane zanonimizowane]'

function normalizeRanges(textLength: number, ranges: RedactionRange[]): RedactionRange[] {
  const clamped = ranges
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end))
    .map((range) => ({
      start: Math.max(0, Math.min(textLength, Math.floor(range.start))),
      end: Math.max(0, Math.min(textLength, Math.floor(range.end))),
    }))
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: RedactionRange[] = []
  for (const range of clamped) {
    const last = merged[merged.length - 1]
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end)
      continue
    }
    merged.push({ ...range })
  }
  return merged
}

export function applyRedactions(
  text: string,
  ranges: RedactionRange[],
  replacement: string = DEFAULT_REDACTION_REPLACEMENT,
): string {
  const merged = normalizeRanges(text.length, ranges)
  let result = text
  for (let index = merged.length - 1; index >= 0; index -= 1) {
    const range = merged[index]
    result = `${result.slice(0, range.start)}${replacement}${result.slice(range.end)}`
  }
  return result
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function inflectedPattern(word: string): string {
  const lower = word.toLocaleLowerCase('pl')
  if (lower.length >= 4 && lower.endsWith('a')) {
    return `${escapeRegExp(word.slice(0, -1))}(?:a|ej|ą|o|y|ie|e)`
  }
  if (lower.length >= 4 && lower.endsWith('i')) {
    return `${escapeRegExp(word.slice(0, -1))}(?:i|iego|iemu|im|ich)`
  }
  if (lower.length >= 4 && lower.endsWith('y')) {
    return `${escapeRegExp(word.slice(0, -1))}(?:y|ego|emu|ym|ych)`
  }
  if (lower.length >= 3) {
    return `${escapeRegExp(word)}(?:a|owi|em|ie|u|y|ego|emu|ym)?`
  }
  return escapeRegExp(word)
}

function withLetterBoundaries(pattern: string): string {
  return `(?<![${ALL_LETTERS}])(?:${pattern})(?![${ALL_LETTERS}])`
}

function collectMatches(text: string, pattern: string): RedactionRange[] {
  const ranges: RedactionRange[] = []
  for (const match of text.matchAll(new RegExp(pattern, 'giu'))) {
    ranges.push({ start: match.index, end: match.index + match[0].length })
  }
  return ranges
}

function requesterNamePatterns(name: string): string[] {
  const tokens = name
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token.replace(/\./g, '').length > 0)
  if (tokens.length === 0) return []
  const patterns: string[] = [tokens.map(escapeRegExp).join('\\s+')]
  if (tokens.length === 1) {
    if (tokens[0].length >= 3) patterns.push(inflectedPattern(tokens[0]))
    return patterns
  }
  const firstName = tokens[0]
  const surname = tokens[tokens.length - 1]
  const firstPattern = inflectedPattern(firstName)
  const surnamePattern = inflectedPattern(surname)
  patterns.push(`${firstPattern}\\s+${surnamePattern}`)
  patterns.push(`${surnamePattern}\\s+${firstPattern}`)
  patterns.push(`${escapeRegExp(firstName.charAt(0))}\\.\\s?${surnamePattern}`)
  if (surname.replace(/\./g, '').length >= 3) patterns.push(surnamePattern)
  return patterns
}

function requesterAddressPatterns(address: string): string[] {
  const whole = address.trim()
  if (whole.length === 0) return []
  const toPattern = (value: string) =>
    value
      .split(/[\s,]+/)
      .filter((token) => token.length > 0)
      .map(escapeRegExp)
      .join('[\\s,]+')
  const parts = whole
    .split(/[\n,;]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4 && /\d/.test(part))
  return [toPattern(whole), ...parts.map(toPattern)].filter((pattern) => pattern.length > 0)
}

function requesterContactPatterns(contact: string): string[] {
  return contact
    .split(/[\n,;]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .flatMap((part) => {
      if (part.includes('@')) return [escapeRegExp(part)]
      const digits = part.replace(/\D/g, '')
      if (digits.length >= 9) {
        const national = digits.length === 11 && digits.startsWith('48') ? digits.slice(2) : digits
        const digitPattern = national.split('').join('[\\s-]?')
        return [`(?<!\\d)(?:\\+?48[\\s-]?)?${digitPattern}(?!\\d)`]
      }
      return part.length >= 4 ? [escapeRegExp(part)] : []
    })
}

export function anonymizeForArchive(
  text: string,
  requester?: ArchiveRequester,
  options?: PiiRuleOptions,
): string {
  if (!text) return text
  const ruleRanges: RedactionRange[] = detectPiiByRules(text, { ...options, keepNames: [] }).map((span) => ({
    start: span.start,
    end: span.end,
  }))
  const requesterRanges: RedactionRange[] = []
  if (requester?.name) {
    for (const pattern of requesterNamePatterns(requester.name)) {
      requesterRanges.push(...collectMatches(text, withLetterBoundaries(pattern)))
    }
  }
  if (requester?.address) {
    for (const pattern of requesterAddressPatterns(requester.address)) {
      requesterRanges.push(...collectMatches(text, pattern))
    }
  }
  if (requester?.contact) {
    for (const pattern of requesterContactPatterns(requester.contact)) {
      requesterRanges.push(...collectMatches(text, pattern))
    }
  }
  return applyRedactions(text, [...ruleRanges, ...requesterRanges], DEFAULT_REDACTION_REPLACEMENT)
}
