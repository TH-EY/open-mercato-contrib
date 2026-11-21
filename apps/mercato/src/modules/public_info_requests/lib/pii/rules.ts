export type PiiCategory =
  | 'private_person_name'
  | 'pesel'
  | 'id_document'
  | 'private_nip'
  | 'birth_data'
  | 'private_address'
  | 'private_phone'
  | 'private_email'
  | 'bank_account'
  | 'signature'
  | 'health'
  | 'property_register_number'
  | 'land_parcel'
  | 'vehicle_registration'
  | 'business_secret'
  | 'other'

export const PII_CATEGORIES: readonly PiiCategory[] = [
  'private_person_name',
  'pesel',
  'id_document',
  'private_nip',
  'birth_data',
  'private_address',
  'private_phone',
  'private_email',
  'bank_account',
  'signature',
  'health',
  'property_register_number',
  'land_parcel',
  'vehicle_registration',
  'business_secret',
  'other',
] as const

export type PiiDetector = 'rule' | 'ai' | 'manual'

export type PiiSpan = {
  start: number
  end: number
  category: PiiCategory
  detector: PiiDetector
  confidence: number
  text: string
}

export type PiiRuleOptions = {
  officeEmailDomains?: string[]
  officePhonePrefixes?: string[]
  publicOfficials?: string[]
  keepNames?: string[]
}

export const DEFAULT_OFFICE_EMAIL_DOMAINS: readonly string[] = ['um.bydgoszcz.pl', 'bydgoszcz.pl']
export const DEFAULT_OFFICE_PHONE_PREFIXES: readonly string[] = ['5258', '52 58', '(52) 58', '52-58']

export const UPPER_LETTERS = 'A-ZĄĆĘŁŃÓŚŹŻ'
export const LOWER_LETTERS = 'a-ząćęłńóśźż'
export const ALL_LETTERS = `${UPPER_LETTERS}${LOWER_LETTERS}`

const CAP_WORD = `[${UPPER_LETTERS}][${LOWER_LETTERS}]+(?:-[${UPPER_LETTERS}][${LOWER_LETTERS}]+)?`
const INLINE_SPACE = '[ \\t\\u00A0]'
const NAME_SEQUENCE = `${CAP_WORD}(?:${INLINE_SPACE}+${CAP_WORD}){0,2}`
const INITIAL_NAME = `[${UPPER_LETTERS}]\\.${INLINE_SPACE}?${CAP_WORD}`
const NAME_ONLY_LINE = new RegExp(`^(?:${INITIAL_NAME}|${NAME_SEQUENCE})${INLINE_SPACE}*[,.]?$`)
const HEADER_NAME_LINE = new RegExp(`^${CAP_WORD}(?:${INLINE_SPACE}+${CAP_WORD}){1,2}$`)
const CITY = `${CAP_WORD}(?:[ -]${CAP_WORD})?`
const POSTAL_CITY = `\\d{2}-\\d{3}${INLINE_SPACE}+${CITY}`
const POSTAL_LINE = new RegExp(`^${POSTAL_CITY}${INLINE_SPACE}*[,.]?$`)
const STREET_MARKER = '(?:[Uu]l\\.|[Uu]lic[ay]|[Aa]l\\.|[Aa]leja|[Aa]lei|[Oo]s\\.|[Oo]siedle|[Pp]l\\.)'
const STREET_CHARS = `[${ALL_LETTERS}0-9.'’-]`
const STREET_TOKEN = `${STREET_CHARS}+`
const HOUSE_NUMBER = `\\d+[a-zA-Z]?(?:${INLINE_SPACE}?\\/${INLINE_SPACE}?\\d+[a-zA-Z]?)?`
const STREET_ADDRESS = `(?<![${ALL_LETTERS}])${STREET_MARKER}${INLINE_SPACE}*[${UPPER_LETTERS}0-9]${STREET_CHARS}*(?:${INLINE_SPACE}+${STREET_TOKEN}){0,4}?${INLINE_SPACE}+${HOUSE_NUMBER}(?![0-9${ALL_LETTERS}])(?:,?${INLINE_SPACE}*${POSTAL_CITY})?`
const ADDRESS_LIKE_LINE = new RegExp(`^(?:${STREET_MARKER}|\\d{2}-\\d{3}${INLINE_SPACE})`)

const RESIDENCE_MARKER = /(zam\.|zamieszka[łl][a-ząćęłńóśźż]*|adres\s+zamieszkania|adres:)/i
const NIP_MARKER = /NIP/i
const ID_DOCUMENT_MARKER = /(dow[oó]d|paszport|seri[aiąę])/i
const VEHICLE_MARKER = /(rej|pojazd)/i
const AMOUNT_SUFFIX = /^[ \t ]*(zł|pln|złotych|eur|usd|tys|mln|mld|m2|m²|szt|os\.|osób)/i
const CLOSING_PHRASE = '(?:[Zz]\\s+wyrazami\\s+szacunku|[Zz]\\s+poważaniem|[Łł]ączę\\s+wyrazy\\s+szacunku|[Ss]erdecznie\\s+pozdrawiam|[Zz]\\s+pozdrowieniami|[Pp]ozdrawiam(?:\\s+serdecznie)?)'
const CLOSING_LINE = new RegExp(`^${CLOSING_PHRASE}[ \\t]*[,.!]?[ \\t]*$`)
const CLOSING_INLINE = new RegExp(`${CLOSING_PHRASE}[ \\t]*[,.!]?[ \\t]*[|,][ \\t]*(${INITIAL_NAME}|${NAME_SEQUENCE})[ \\t\\r]*$`, 'gm')
const PRECEDING_FUNCTION_MARKER = /(insp\.|inspektor|dyrektor|kierownik\s+wydziału|prezydent|zastępca\s+prezydenta|sekretarz|skarbnik|radn[ya])/i
const FOLLOWING_FUNCTION_MARKER = /^[\s,–—-]*(insp\.|inspektor|dyrektor|kierownik|prezydent|zastępca|sekretarz|skarbnik|radn[ya])/i

const FUNCTION_WORD_STEMS: readonly string[] = [
  'prezydent', 'wiceprezydent', 'dyrektor', 'prezes', 'kierownik', 'inspektor', 'radn', 'sekretarz',
  'skarbnik', 'minister', 'wojewod', 'marszał', 'starost', 'burmistrz', 'wójt', 'naczelnik',
  'komendant', 'rzecznik', 'przewodnicząc', 'poseł', 'posł', 'senator', 'doktor', 'profesor',
  'mecenas', 'redaktor', 'sędzi', 'prokurator', 'zastęp', 'członk', 'kanclerz', 'komisarz',
  'specjalist', 'referent', 'pełnomocni', 'koordynator', 'premier',
]

const INSTITUTIONAL_WORDS: ReadonlySet<string> = new Set([
  'urząd', 'urzędu', 'urzędzie', 'miasta', 'miasto', 'wydział', 'wydziału', 'biuro', 'biura',
  'stowarzyszenie', 'stowarzyszenia', 'fundacja', 'fundacji', 'spółka', 'spółki', 'sp', 's.a',
  'bydgoszcz', 'bydgoszczy', 'komunikacji', 'społecznej', 'prezes', 'zarządu', 'gmina', 'gminy',
  'szanowni', 'szanowny', 'szanowna', 'państwo', 'dział', 'referat', 'zespół', 'rada', 'rady',
  'województwa', 'kujawsko-pomorskie', 'polska', 'rzeczpospolita',
])

const PESEL_WEIGHTS = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]
const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7]

type LineInfo = { start: number; end: number; text: string }

type ResolvedOptions = {
  officeEmailDomains: string[]
  officePhonePrefixes: string[]
  excludedNames: string[][]
}

export function isValidPesel(value: string): boolean {
  const digits = value.trim()
  if (!/^\d{11}$/.test(digits)) return false
  if (/^(\d)\1{10}$/.test(digits)) return false
  const sum = PESEL_WEIGHTS.reduce((total, weight, index) => total + weight * Number(digits[index]), 0)
  const control = (10 - (sum % 10)) % 10
  if (control !== Number(digits[10])) return false
  const month = Number(digits.slice(2, 4)) % 20
  const day = Number(digits.slice(4, 6))
  return month >= 1 && month <= 12 && day >= 1 && day <= 31
}

export function isValidNip(value: string): boolean {
  const digits = value.replace(/[\s-]/g, '')
  if (!/^\d{10}$/.test(digits)) return false
  if (/^(\d)\1{9}$/.test(digits)) return false
  const sum = NIP_WEIGHTS.reduce((total, weight, index) => total + weight * Number(digits[index]), 0)
  const control = sum % 11
  return control !== 10 && control === Number(digits[9])
}

export function isValidPolishIban(value: string): boolean {
  const compact = value.replace(/\s/g, '').toUpperCase().replace(/^PL/, '')
  if (!/^\d{26}$/.test(compact)) return false
  const rearranged = `${compact.slice(2)}2521${compact.slice(0, 2)}`
  let remainder = 0
  for (const char of rearranged) {
    remainder = (remainder * 10 + Number(char)) % 97
  }
  return remainder === 1
}

function splitLines(text: string): LineInfo[] {
  const lines: LineInfo[] = []
  let offset = 0
  for (const rawLine of text.split('\n')) {
    const lineText = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    lines.push({ start: offset, end: offset + lineText.length, text: lineText })
    offset += rawLine.length + 1
  }
  return lines
}

function trimLine(line: LineInfo): LineInfo {
  const leading = line.text.length - line.text.trimStart().length
  const trimmed = line.text.trim()
  return { start: line.start + leading, end: line.start + leading + trimmed.length, text: trimmed }
}

function makeSpan(text: string, start: number, end: number, category: PiiCategory, confidence: number): PiiSpan {
  return { start, end, category, detector: 'rule', confidence, text: text.slice(start, end) }
}

function precedingText(text: string, start: number, length: number): string {
  return text.slice(Math.max(0, start - length), start)
}

function normalizeNameTokens(value: string): string[] {
  return value
    .toLocaleLowerCase('pl')
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0)
}

function tokenMatches(candidate: string, reference: string): boolean {
  if (candidate === reference) return true
  if (candidate.length === 1) return reference.startsWith(candidate)
  if (reference.length === 1) return candidate.startsWith(reference)
  return false
}

function tokensCovered(subset: string[], superset: string[]): boolean {
  return subset.length > 0 && subset.every((token) => superset.some((reference) => tokenMatches(token, reference)))
}

function isListedName(name: string, options: ResolvedOptions): boolean {
  const nameTokens = normalizeNameTokens(name)
  return options.excludedNames.some(
    (entryTokens) => tokensCovered(nameTokens, entryTokens) || tokensCovered(entryTokens, nameTokens),
  )
}

function isFunctionWord(word: string): boolean {
  const lower = word.toLocaleLowerCase('pl')
  return FUNCTION_WORD_STEMS.some((stem) => lower.startsWith(stem))
}

function isInstitutionalWord(word: string): boolean {
  return INSTITUTIONAL_WORDS.has(word.toLocaleLowerCase('pl').replace(/\.$/, ''))
}

function containsInstitutionalOrFunctionWord(name: string): boolean {
  return name
    .split(/[\s ]+/)
    .filter((word) => word.length > 0)
    .some((word) => isInstitutionalWord(word) || isFunctionWord(word))
}

function hasFunctionContext(text: string, start: number, end: number): boolean {
  if (PRECEDING_FUNCTION_MARKER.test(precedingText(text, start, 25))) return true
  return FOLLOWING_FUNCTION_MARKER.test(text.slice(end, end + 25))
}

function isExcludedName(text: string, start: number, end: number, options: ResolvedOptions): boolean {
  const name = text.slice(start, end)
  if (containsInstitutionalOrFunctionWord(name)) return true
  if (isListedName(name, options)) return true
  return hasFunctionContext(text, start, end)
}

function resolveOptions(options?: PiiRuleOptions): ResolvedOptions {
  const listed = [...(options?.publicOfficials ?? []), ...(options?.keepNames ?? [])]
  return {
    officeEmailDomains: (options?.officeEmailDomains ?? [...DEFAULT_OFFICE_EMAIL_DOMAINS]).map((domain) =>
      domain.trim().toLowerCase().replace(/^@/, ''),
    ),
    officePhonePrefixes: (options?.officePhonePrefixes ?? [...DEFAULT_OFFICE_PHONE_PREFIXES])
      .map((prefix) => prefix.replace(/\D/g, ''))
      .filter((prefix) => prefix.length > 0),
    excludedNames: listed.map(normalizeNameTokens).filter((tokens) => tokens.length > 0),
  }
}

function detectPesel(text: string): PiiSpan[] {
  const spans: PiiSpan[] = []
  for (const match of text.matchAll(/(?<!\d)\d{11}(?!\d)/g)) {
    const labelled = /pesel\W{0,6}$/i.test(text.slice(Math.max(0, match.index - 15), match.index))
    if (isValidPesel(match[0])) spans.push(makeSpan(text, match.index, match.index + match[0].length, 'pesel', 0.95))
    else if (labelled) spans.push(makeSpan(text, match.index, match.index + match[0].length, 'pesel', 0.7))
  }
  return spans
}

function detectNip(text: string): PiiSpan[] {
  const spans: PiiSpan[] = []
  const pattern = /(?<![\d-])(?:\d{3}-?\d{3}-?\d{2}-?\d{2}|\d{3}-\d{2}-\d{2}-\d{3})(?![\d-])/g
  for (const match of text.matchAll(pattern)) {
    if (!isValidNip(match[0])) continue
    if (!NIP_MARKER.test(precedingText(text, match.index, 30))) continue
    spans.push(makeSpan(text, match.index, match.index + match[0].length, 'private_nip', 0.6))
  }
  return spans
}

function detectIdDocuments(text: string): PiiSpan[] {
  const spans: PiiSpan[] = []
  for (const match of text.matchAll(/(?<![A-Z0-9])[A-Z]{3}[ \t]?\d{6}(?!\d)/g)) {
    const hasContext = ID_DOCUMENT_MARKER.test(precedingText(text, match.index, 40))
    spans.push(makeSpan(text, match.index, match.index + match[0].length, 'id_document', hasContext ? 0.8 : 0.5))
  }
  for (const match of text.matchAll(/(?<![A-Z0-9])[A-Z]{2}[ \t]?\d{7}(?!\d)/g)) {
    if (!ID_DOCUMENT_MARKER.test(precedingText(text, match.index, 40))) continue
    spans.push(makeSpan(text, match.index, match.index + match[0].length, 'id_document', 0.8))
  }
  return spans
}

function detectBankAccounts(text: string): PiiSpan[] {
  const spans: PiiSpan[] = []
  const pattern = /(?<![\dA-Z])(?:PL[ ]?)?\d{2}(?:[ ]?\d{4}){6}(?![\d])/g
  for (const match of text.matchAll(pattern)) {
    const confidence = isValidPolishIban(match[0]) ? 0.95 : 0.6
    spans.push(makeSpan(text, match.index, match.index + match[0].length, 'bank_account', confidence))
  }
  return spans
}

function isOfficePhone(digits: string, options: ResolvedOptions): boolean {
  const national = digits.length === 11 && digits.startsWith('48') ? digits.slice(2) : digits
  return options.officePhonePrefixes.some((prefix) => national.startsWith(prefix))
}

function detectPhones(text: string, options: ResolvedOptions): PiiSpan[] {
  const spans: PiiSpan[] = []
  const separator = '[ -]?'
  const forms = [
    `\\d{3}${separator}\\d{3}${separator}\\d{3}`,
    `\\(?\\d{2}\\)?${separator}\\d{3}${separator}\\d{2}${separator}\\d{2}`,
    `\\(?\\d{2}\\)?${separator}\\d{2}${separator}\\d{2}${separator}\\d{3}`,
  ]
  const pattern = new RegExp(`(?<![\\d+(])(?<!\\d[ -])(?:\\+48[ -]?)?(?:${forms.join('|')})(?![ -]?\\d)`, 'g')
  for (const match of text.matchAll(pattern)) {
    const digits = match[0].replace(/\D/g, '')
    const national = match[0].startsWith('+48') ? digits.slice(2) : digits
    if (national.length !== 9 || national.startsWith('0')) continue
    if (isOfficePhone(digits, options)) continue
    const end = match.index + match[0].length
    if (AMOUNT_SUFFIX.test(text.slice(end, end + 12))) continue
    spans.push(makeSpan(text, match.index, end, 'private_phone', 0.85))
  }
  return spans
}

function detectEmails(text: string, options: ResolvedOptions): PiiSpan[] {
  const spans: PiiSpan[] = []
  const pattern = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g
  for (const match of text.matchAll(pattern)) {
    const domain = match[1].toLowerCase()
    const isOffice = options.officeEmailDomains.some((office) => domain === office || domain.endsWith(`.${office}`))
    if (isOffice) continue
    spans.push(makeSpan(text, match.index, match.index + match[0].length, 'private_email', 0.9))
  }
  return spans
}

function detectPropertyRegisterNumbers(text: string): PiiSpan[] {
  const spans: PiiSpan[] = []
  for (const match of text.matchAll(/(?<![A-Z0-9])[A-Z]{2}\d[A-Z]\/\d{8}\/\d(?!\d)/g)) {
    spans.push(makeSpan(text, match.index, match.index + match[0].length, 'property_register_number', 0.95))
  }
  return spans
}

function detectVehicleRegistrations(text: string): PiiSpan[] {
  const spans: PiiSpan[] = []
  for (const match of text.matchAll(/(?<![A-Z0-9])C[A-Z]{1,2}[ ]?[0-9A-Z]{4,5}(?![0-9A-Z])/g)) {
    const suffix = match[0].replace(/^C[A-Z]{1,2}[ ]?/, '')
    if (!/\d/.test(suffix)) continue
    if (!VEHICLE_MARKER.test(precedingText(text, match.index, 40))) continue
    spans.push(makeSpan(text, match.index, match.index + match[0].length, 'vehicle_registration', 0.8))
  }
  return spans
}

function detectSignatures(text: string): PiiSpan[] {
  const spans: PiiSpan[] = []
  for (const match of text.matchAll(/\/podpis\/|\(podpis\)|podpis\s+nieczytelny|\/-\//gi)) {
    spans.push(makeSpan(text, match.index, match.index + match[0].length, 'signature', 0.9))
  }
  return spans
}

function detectHonorificNames(text: string, options: ResolvedOptions): PiiSpan[] {
  const spans: PiiSpan[] = []
  const pattern = new RegExp(
    `(?<![${ALL_LETTERS}])(?:[Pp]an(?:i|u|ią|a|em)?|p\\.)${INLINE_SPACE}+(${NAME_SEQUENCE})`,
    'g',
  )
  for (const match of text.matchAll(pattern)) {
    const captured = match[1]
    const capturedStart = match.index + match[0].length - captured.length
    const words: { word: string; start: number }[] = []
    for (const wordMatch of captured.matchAll(/\S+/g)) {
      words.push({ word: wordMatch[0], start: capturedStart + wordMatch.index })
    }
    const kept: { word: string; start: number }[] = []
    for (const entry of words) {
      if (isFunctionWord(entry.word) || isInstitutionalWord(entry.word)) break
      kept.push(entry)
    }
    if (kept.length === 0) continue
    const last = kept[kept.length - 1]
    const start = kept[0].start
    const end = last.start + last.word.length
    if (isExcludedName(text, start, end, options)) continue
    spans.push(makeSpan(text, start, end, 'private_person_name', 0.7))
  }
  return spans
}

function nameOnlyLineSpan(text: string, line: LineInfo, options: ResolvedOptions): PiiSpan | null {
  const trimmed = trimLine(line)
  if (trimmed.text.length === 0 || trimmed.text.length > 60) return null
  if (!NAME_ONLY_LINE.test(trimmed.text)) return null
  const nameText = trimmed.text.replace(/[ \t ]*[,.]$/, '')
  const end = trimmed.start + nameText.length
  if (isExcludedName(text, trimmed.start, end, options)) return null
  return makeSpan(text, trimmed.start, end, 'private_person_name', 0.7)
}

function detectSignatureBlockNames(text: string, lines: LineInfo[], options: ResolvedOptions): PiiSpan[] {
  const spans: PiiSpan[] = []
  for (const match of text.matchAll(CLOSING_INLINE)) {
    const captured = match[1]
    const start = match.index + match[0].trimEnd().length - captured.length
    const end = start + captured.length
    if (isExcludedName(text, start, end, options)) continue
    spans.push(makeSpan(text, start, end, 'private_person_name', 0.7))
  }
  lines.forEach((line, index) => {
    if (!CLOSING_LINE.test(line.text.trim())) return
    let inspected = 0
    for (let cursor = index + 1; cursor < lines.length && inspected < 3; cursor += 1) {
      const candidate = lines[cursor]
      if (candidate.text.trim().length === 0) continue
      inspected += 1
      const span = nameOnlyLineSpan(text, candidate, options)
      if (span) {
        spans.push(span)
        break
      }
    }
  })
  return spans
}

function nextNonEmptyIndex(lines: LineInfo[], from: number): number {
  for (let cursor = from; cursor < lines.length; cursor += 1) {
    if (lines[cursor].text.trim().length > 0) return cursor
  }
  return -1
}

function detectHeaderBlock(text: string, lines: LineInfo[], options: ResolvedOptions): PiiSpan[] {
  const spans: PiiSpan[] = []
  const streetPattern = new RegExp(STREET_ADDRESS)
  let inspected = 0
  for (let index = 0; index < lines.length && inspected < 6; index += 1) {
    const trimmed = trimLine(lines[index])
    if (trimmed.text.length === 0) continue
    inspected += 1
    if (!HEADER_NAME_LINE.test(trimmed.text)) continue
    const nextIndex = index + 1 < lines.length ? index + 1 : -1
    if (nextIndex < 0 || !ADDRESS_LIKE_LINE.test(lines[nextIndex].text.trim())) continue
    if (containsInstitutionalOrFunctionWord(trimmed.text)) continue
    if (isListedName(trimmed.text, options) || hasFunctionContext(text, trimmed.start, trimmed.end)) return spans
    spans.push(makeSpan(text, trimmed.start, trimmed.end, 'private_person_name', 0.7))
    for (let cursor = nextIndex; cursor < lines.length && cursor < nextIndex + 3; cursor += 1) {
      const addressLine = trimLine(lines[cursor])
      if (addressLine.text.length === 0) break
      const streetMatch = streetPattern.exec(addressLine.text)
      if (streetMatch) {
        const start = addressLine.start + streetMatch.index
        spans.push(makeSpan(text, start, start + streetMatch[0].length, 'private_address', 0.8))
        continue
      }
      if (POSTAL_LINE.test(addressLine.text)) {
        spans.push(makeSpan(text, addressLine.start, addressLine.end, 'private_address', 0.8))
        continue
      }
      break
    }
    return spans
  }
  return spans
}

function detectResidenceAddresses(text: string, lines: LineInfo[]): PiiSpan[] {
  const spans: PiiSpan[] = []
  const streetPattern = new RegExp(STREET_ADDRESS, 'g')
  for (const match of text.matchAll(streetPattern)) {
    if (!RESIDENCE_MARKER.test(precedingText(text, match.index, 60))) continue
    spans.push(makeSpan(text, match.index, match.index + match[0].length, 'private_address', 0.8))
  }
  const postalPattern = new RegExp(`(?<![\\d-])${POSTAL_CITY}`, 'g')
  for (const match of text.matchAll(postalPattern)) {
    if (!RESIDENCE_MARKER.test(precedingText(text, match.index, 60))) continue
    spans.push(makeSpan(text, match.index, match.index + match[0].length, 'private_address', 0.8))
  }
  const followUps: PiiSpan[] = []
  for (const span of spans) {
    const lineIndex = lines.findIndex((line) => span.end >= line.start && span.end <= line.end)
    if (lineIndex < 0) continue
    const remainder = text.slice(span.end, lines[lineIndex].end)
    if (!/^[\s,.;]*$/.test(remainder)) continue
    const nextIndex = nextNonEmptyIndex(lines, lineIndex + 1)
    if (nextIndex !== lineIndex + 1) continue
    const nextLine = trimLine(lines[nextIndex])
    if (POSTAL_LINE.test(nextLine.text)) {
      followUps.push(makeSpan(text, nextLine.start, nextLine.end, 'private_address', 0.8))
    }
  }
  return [...spans, ...followUps]
}

function pickCategoryOwner(current: PiiSpan, incoming: PiiSpan): PiiSpan {
  const currentIsRule = current.detector === 'rule'
  const incomingIsRule = incoming.detector === 'rule'
  if (currentIsRule !== incomingIsRule) return currentIsRule ? current : incoming
  if (incoming.confidence !== current.confidence) return incoming.confidence > current.confidence ? incoming : current
  return incoming.end - incoming.start > current.end - current.start ? incoming : current
}

export function mergeSpans(spans: PiiSpan[], text?: string): PiiSpan[] {
  const valid = spans.filter(
    (span) =>
      Number.isInteger(span.start) &&
      Number.isInteger(span.end) &&
      span.start >= 0 &&
      span.end > span.start &&
      (text === undefined || span.end <= text.length),
  )
  const sorted = [...valid].sort((left, right) => left.start - right.start || right.end - left.end)
  const merged: PiiSpan[] = []
  for (const span of sorted) {
    const last = merged[merged.length - 1]
    if (!last || span.start >= last.end) {
      merged.push({ ...span })
      continue
    }
    const owner = pickCategoryOwner(last, span)
    const widest = span.end - span.start > last.end - last.start ? span : last
    merged[merged.length - 1] = {
      start: last.start,
      end: Math.max(last.end, span.end),
      category: owner.category,
      detector: owner.detector,
      confidence: Math.max(last.confidence, span.confidence),
      text: widest.text,
    }
  }
  if (text === undefined) return merged
  return merged.map((span) => ({ ...span, text: text.slice(span.start, span.end) }))
}

export function detectPiiByRules(text: string, options?: PiiRuleOptions): PiiSpan[] {
  if (!text) return []
  const resolved = resolveOptions(options)
  const lines = splitLines(text)
  const spans: PiiSpan[] = [
    ...detectPesel(text),
    ...detectNip(text),
    ...detectIdDocuments(text),
    ...detectBankAccounts(text),
    ...detectPhones(text, resolved),
    ...detectEmails(text, resolved),
    ...detectPropertyRegisterNumbers(text),
    ...detectVehicleRegistrations(text),
    ...detectSignatures(text),
    ...detectHeaderBlock(text, lines, resolved),
    ...detectResidenceAddresses(text, lines),
    ...detectHonorificNames(text, resolved),
    ...detectSignatureBlockNames(text, lines, resolved),
  ]
  return mergeSpans(spans, text)
}
