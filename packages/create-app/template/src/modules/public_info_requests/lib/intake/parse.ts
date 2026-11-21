import { normalizePolish } from '../text'

export type RequesterKind = 'person' | 'organisation' | 'media' | 'councillor'
export type DeliveryForm = 'email' | 'post' | 'epuap' | 'inspection'

export type IntakeSuggestion = {
  requesterName: string | null
  requesterKind: RequesterKind
  requesterAddress: string | null
  requesterContact: string | null
  deliveryForm: DeliveryForm
  letterDate: string | null
  caseNumber: string | null
  subjectSummary: string
  points: string[]
}

export type IntakeChannel = 'email' | 'epuap' | 'post' | 'in_person' | 'phone'

export type IntakeHints = {
  channel?: IntakeChannel
  senderEmail?: string | null
}

type BodyLine = { text: string; blankBefore: boolean }

type RequesterGuess = { name: string | null; kind: RequesterKind | null; address: string | null }

const SUBJECT_MAX_LENGTH = 120

const CASE_NUMBER_PATTERN = /BKS\.IV\.1431\.\d+\.\d{4}/

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

const PHONE_PATTERN = /(?:tel\.?\s*:?\s*|telefon\s*:?\s*|kom\.?\s*:?\s*)?(?:\+48[\s-]?)?\b\d{3}[\s-]\d{3}[\s-]\d{3}\b|(?:tel\.?|telefon)\s*:?\s*(?:\+48[\s-]?)?\d{9}\b/i

const OFFICE_EMAIL_DOMAINS = ['um.bydgoszcz.pl', 'bydgoszcz.pl']

const OFFICE_LINE_PATTERNS: RegExp[] = [
  /urzad miasta bydgoszcz/,
  /^biuro komunikacji spolecznej$/,
  /referat\w* komunikacji/,
  /jezuicka 1\b/,
  /^miasto bydgoszcz$/,
  /^bks\b/,
  /^kierownik referatu/,
  /^prezydent miasta bydgoszczy$/,
  /^(od|do|dw|temat|wyslano|wystano|data|sent|from|to|subject|cc|date)\s*:/,
  /prosba o rejestracj/,
  /rejestracj\w* w (sidas|systemie)/,
]

const CLOSING_PATTERNS: RegExp[] = [
  /^(z\s+)?(wyrazami\s+szacunku|powazaniem|szacunkiem)\b/,
  /^(serdecznie\s+|z\s+gory\s+dziekuje\s+i\s+)?pozdrawiam(y)?\b/,
  /^(serdeczne\s+)?pozdrowienia\b/,
  /^lacze\s+(wyrazy|pozdrowienia)/,
  /^(z\s+gory\s+)?dziekuje(my)?(\s+i\s+pozdrawiam)?[\s.,!]*$/,
  /^--\s*$/,
]

const SALUTATION_PATTERN = /^(dzien dobry|witam(y)?|witajcie|szanowni panstwo|szanowny panie|szanowna pani|szanowni|szanowny|szanowna|dobry wieczor)\b[^a-z]*([a-z]+[^a-z]*){0,2}$/

const TITLE_PATTERN = /^(\S+\s+)?o\s+(udostepnienie|udzielenie)\s+informacji(\s+publicznej)?[\s.!]*$/

const REQUEST_PATTERN = /\b(prosze|prosimy|prosba|prosbe|wnosze|wnosimy|wnosi|wnioskuje|wnioskujemy|zwracam sie|zwraca sie|zwracamy sie|pytanie|zapytac|zapytuje|chcialbym|chcialabym|chcielibysmy|chce sie dowiedziec|pragne sie dowiedziec|domagam sie|zadam)\b/

const INTERROGATIVE_START = /^(ile|czy|jaki|jaka|jakie|jakich|jakim|jaka|kiedy|gdzie|kto|komu|kogo|dlaczego|w jakim|w jakiej|na jakim|na jakiej|z kim|od kiedy|do kiedy|co)\b/

const META_PATTERN = /(poczt\w*\s+elektroniczn|na\s+adres|e-?mail|potwierdzeni\w*\s+otrzymani|w\s+formie\s+(skan|elektroniczn|papierow|pdf)|spakowanie|odpowiedz\w*\s+(prosze|w\s+trybie|przeslac)|e-?doreczen|za\s+posrednictwem|na\s+moj\s+adres|w\s+formie\s+skanow)/

const CONDITIONAL_FOLLOW_UP = /^(jezeli|jesli|o ile|w przypadku gdy)\s+(tak|nie)\b/

const ABBREVIATIONS = new Set([
  'tj', 'np', 'ul', 'nr', 'r', 'ust', 'art', 'pkt', 'ok', 'sw', 'ks', 'in', 'ww', 'al', 'pl', 'pn', 'dz',
  'u', 'poz', 'zm', 'jedn', 'tzw', 'im', 'prof', 'dr', 'mgr', 'inz', 'sp', 'o', 'a', 's', 'tel', 'godz',
  'tys', 'zl', 'str', 'lit', 'ds', 'wg', 'tzn', 'itd', 'itp', 'ew', 'zob', 'por', 'dot', 'p',
])

const ORGANISATION_PREFIX = /^(stowarzyszeni\w*|fundacj\w*|parafi\w*|towarzystw\w*|spoldzielni\w*|zwiazek|zwiazku|klub\w*|instytut\w*|kancelari\w*|redakcj\w*|wspolnot\w*|izb\w*|osp|polski\s+zwiazek|ruch|komitet\w*|rada\s+osiedla|zarzad\s+osiedla|proboszcz\w*|ks\.?\s+proboszcz)\b/

const COMPANY_SUFFIX = /(\bS\.\s?A\.|\bsp\.\s?z\s?o\.\s?o\.|\bSp\.\s?z\s?o\.\s?o\.|\bsp\.\s?j\.|\bsp\.\s?k\.|\bs\.c\.|\bspółka\b)/i

const MEDIA_STRONG = /\b(redakcj\w*|dziennikar\w*|redaktor\w*)\b/
const MEDIA_WEAK = /\b(gazet\w*|portal\w*|tygodnik\w*|dziennik\s+\w+|radio\w*|telewizj\w*|serwis\s+informacyjny)\b/
const COUNCILLOR_STRONG = /\b(radny|radna|posel|poslanka|senator)\b/
const COUNCILLOR_WEAK = /\b(radnego|radnej|radni\s+miasta)\b/

const MONTHS: Record<string, number> = {
  stycznia: 1, styczen: 1, lutego: 2, luty: 2, marca: 3, marzec: 3, kwietnia: 4, kwiecien: 4, maja: 5,
  maj: 5, czerwca: 6, czerwiec: 6, lipca: 7, lipiec: 7, sierpnia: 8, sierpien: 8, wrzesnia: 9,
  wrzesien: 9, pazdziernika: 10, pazdziernik: 10, listopada: 11, listopad: 11, grudnia: 12, grudzien: 12,
}

const SUBJECT_HEAD_NOMINATIVE: Record<string, string> = {
  dokumentacji: 'dokumentacja',
  informacji: 'informacja',
  liczby: 'liczba',
  umowy: 'umowa',
  kopii: 'kopia',
  wykazu: 'wykaz',
  zestawienia: 'zestawienie',
  inwestycji: 'inwestycja',
  pelnej: 'pełna',
  danych: 'dane',
  zwiazanej: 'związana',
  dotyczacej: 'dotycząca',
  aktualnego: 'aktualne',
  aktualnej: 'aktualna',
  edytowalnego: 'edytowalne',
  sposobu: 'sposób',
  skutkow: 'skutki',
  kosztow: 'koszty',
  tresci: 'treść',
  utrzymania: 'utrzymanie',
}

const NON_PERSON_CAPITALISED = new Set([
  'miasto', 'miasta', 'miastem', 'miescie', 'bydgoszcz', 'bydgoszczy', 'bydgoszcza', 'urzad', 'urzedu',
  'urzedzie', 'wydzial', 'wydzialu', 'rondo', 'ronda', 'rondzie', 'plac', 'placu', 'ulica', 'ulicy',
  'sp', 'sa', 'rada', 'rady', 'prezydent', 'prezydenta', 'prezydentem', 'wojewodzki', 'wojewodzkiego',
  'konserwator', 'konserwatora', 'zabytkow', 'biuro', 'biura', 'zarzad', 'zarzadu', 'drog', 'miejskich',
  'komunikacji', 'publicznej', 'schronisko', 'schroniska', 'polska', 'polski', 'rzeczypospolitej',
  'kujawsko', 'pomorski', 'pomorskiego', 'skarb', 'panstwa', 'gmina', 'gminy', 'powiat', 'powiatu',
  'zamawiajacy', 'wykonawca', 'unii', 'europejskiej', 'park', 'parku', 'osiedle', 'osiedla',
  'astoria', 'jezuicka', 'grunwaldzka', 'grunwaldzkiego', 'starego', 'rynku', 'rynek', 'zespol',
  'szkol', 'szkola', 'szkoly', 'liceum', 'gimnazjum', 'przedszkole', 'stowarzyszenie', 'fundacja',
])

const CLOSING_WORDS = new Set(['pozdrawiam', 'dziekuje', 'witam', 'szacunkiem', 'powazaniem'])

const PERSON_TRIGGER_WORDS = /^(przez|pan|pana|panu|panem|pani|pania|panstwa)$/

const SUBJECT_LEAD_INS: RegExp[] = [
  /^[\s\S]{0,220}?\b(?:uprzejmie\s+)?(?:prosz[eę]|prosimy|wnosz[eę]|wnosimy|wnosi|wnioskuj[eę]|wnioskujemy|zwracam\s+si[eę]|zwraca\s+si[eę]|zwracamy\s+si[eę])(?:\s+(?:te[zż]|r[oó]wnie[zż]|uprzejmie|z\s+uprzejm[aą]\s+pro[sś]b[aą]|z\s+pro[sś]b[aą]))*\s+o\s+/i,
  /^[\s\S]{0,120}?\b(?:chc[eę]|chcia[lł]\w*|pragn[eę]|chcemy|pragniemy)\s+(?:(?:Pa[nń]stwa|si[eę])\s+)?(?:zapyta[cć]|dowiedzie[cć]\s+si[eę])(?:\s+o\s+to)?[,:]?\s+/i,
]

const SUBJECT_AFTER_LEAD_IN: RegExp[] = [
  /^(?:udost[eę]pnienie|udzielenie|przes[lł]anie|podanie|przekazanie|informacj[eę]|wgl[aą]d)\s+/i,
  /^(?:nast[eę]puj[aą]c(?:ej|ych)\s+)?(?:informacji\s*(?:publicznej)?\s*)?/i,
  /^(?:w\s+zakresie|na\s+temat|dotycz[aą]c(?:ej|ych|e|y)|odno[sś]nie)\s*:?\s*/i,
  /^[:,\s]+/,
  /^Pa[nń]stwa\s+/,
]

function cleanWhitespace(value: string): string {
  return value.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim()
}

function wordCount(value: string): number {
  return value.split(/\s+/).filter((word) => word.length > 0).length
}

function capitalise(value: string): string {
  if (value.length === 0) return value
  return value.charAt(0).toLocaleUpperCase('pl-PL') + value.slice(1)
}

function isOfficeLine(line: string): boolean {
  const normalized = normalizePolish(line)
  if (wordCount(line) > 10) return false
  return OFFICE_LINE_PATTERNS.some((pattern) => pattern.test(normalized))
}

function isClosingLine(line: string): boolean {
  const normalized = normalizePolish(line).replace(/^[-–\s]+$/, '--')
  return CLOSING_PATTERNS.some((pattern) => pattern.test(normalized))
}

function isSalutationLine(line: string): boolean {
  if (wordCount(line) > 5) return false
  return SALUTATION_PATTERN.test(normalizePolish(line))
}

function isTitleLine(line: string): boolean {
  if (wordCount(line) > 7) return false
  const normalized = normalizePolish(line)
  if (/^wniosek[\s.!]*$/.test(normalized)) return true
  return TITLE_PATTERN.test(normalized)
}

function isPersonNameLine(line: string): boolean {
  const trimmed = line.trim().replace(/[,.;]+$/, (match) => (match === '.' && /\b\p{Lu}\.$/u.test(line.trim()) ? match : ''))
  if (trimmed.length === 0 || trimmed.length > 60) return false
  if (/\d|@/.test(trimmed)) return false
  const words = trimmed.split(/\s+/)
  if (words.length > 4) return false
  const nameWord = /^(\p{Lu}\.|\p{Lu}\p{Ll}+\.?(?:-\p{Lu}\p{Ll}+)?)$/u
  if (!words.every((word) => nameWord.test(word))) return false
  if (words.length === 1 && /\.$/.test(words[0])) return false
  const normalizedWords = words.map((word) => normalizePolish(word).replace(/\.$/, ''))
  return !normalizedWords.some((word) => NON_PERSON_CAPITALISED.has(word) || CLOSING_WORDS.has(word))
}

function isOrganisationLine(line: string): boolean {
  const normalized = normalizePolish(line)
  if (wordCount(line) > 14) return false
  return ORGANISATION_PREFIX.test(normalized) || COMPANY_SUFFIX.test(line)
}

function isAddressLine(line: string): boolean {
  return /\b(ul\.|al\.|os\.|pl\.)\s*\p{Lu}/u.test(line) || /\b\d{2}-\d{3}\b/.test(line)
}

function extractEmails(text: string): string[] {
  return Array.from(text.matchAll(EMAIL_PATTERN)).map((match) => match[0].replace(/\.$/, ''))
}

function isOfficeEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? ''
  return OFFICE_EMAIL_DOMAINS.some((officeDomain) => domain === officeDomain || domain.endsWith(`.${officeDomain}`))
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2100) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function parsePolishDate(value: string): string | null {
  const normalized = normalizePolish(value)
  const iso = normalized.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/)
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const numeric = normalized.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/)
  if (numeric) return toIsoDate(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]))
  const verbal = normalized.match(/\b(\d{1,2})\s+([a-z]+)\s+(\d{4})\b/)
  if (verbal) {
    const month = MONTHS[verbal[2]]
    if (month) return toIsoDate(Number(verbal[3]), month, Number(verbal[1]))
  }
  return null
}

const DATE_FRAGMENT = String.raw`(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{1,2}\s+\p{L}+\s+\d{4})`

export function findLetterDate(text: string): string | null {
  const flattened = text.replace(/\s+/g, ' ')
  const placeDate = new RegExp(String.raw`\b\p{Lu}\p{Ll}{2,30},\s*(?:dnia\s+)?(${DATE_FRAGMENT})`, 'u')
  const match = flattened.match(placeDate)
  return (match ? parsePolishDate(match[1]) : null) ?? parsePolishDate(flattened)
}

function extractLetterDate(lines: string[]): string | null {
  const placeDate = new RegExp(String.raw`^\p{Lu}[\p{L}\s-]{1,40},\s*(?:dnia\s+)?(${DATE_FRAGMENT})\s*(?:r\.?|roku)?\s*$`, 'u')
  const headerDate = new RegExp(String.raw`^(?:data|wys[lł]ano|sent|date)\s*:\s*.*?(${DATE_FRAGMENT})`, 'iu')
  const bareDate = new RegExp(String.raw`^(?:dnia\s+)?(${DATE_FRAGMENT})\s*(?:r\.?|roku)?\s*$`, 'u')
  for (const pattern of [placeDate, headerDate, bareDate]) {
    for (const line of lines) {
      const match = line.match(pattern)
      if (!match) continue
      const parsed = parsePolishDate(match[1])
      if (parsed) return parsed
    }
  }
  return null
}

function stripBoilerplate(text: string): string {
  return text
    .replace(/(?:zgodnie\s+z\s+|na\s+podstawie\s+)art\.?\s*\d+[\s\S]{0,260}?(?:informacji\s+publicznej|ze\s+zm\.\)?)(?:\s*\([^)]{0,120}\))?\s*,?/gi, ' ')
    .replace(/(?:zgodnie\s+z\s+ustaw[aą]|w\s+trybie\s+ustawy)\s+(?:z\s+dnia\s+[^,]{0,40}?\s+)?o\s+dost[eę]pie\s+do\s+informacji\s+publicznej(?:\s*\([^)]{0,120}\))?\s*,?/gi, ' ')
    .replace(/(?:r[oó]wnie[zż]\s+)?w\s+trybie\s+(?:dost[eę]pu\s+do\s+)?informacji\s+publicznej\s*,?/gi, ' ')
    .replace(/dzia[lł]aj[aą]c\s+(?:we\s+w[lł]asnym\s+imieniu|w\s+imieniu\s+w[lł]asnym)\s*,?/gi, ' ')
    .replace(/\bniniejszym\s+/gi, '')
}

function splitSentences(text: string): string[] {
  const sentences: string[] = []
  const boundary = /([.?!]+)(\s+)(?=[\p{Lu}„"(])/gu
  let start = 0
  for (const match of text.matchAll(boundary)) {
    const index = match.index ?? 0
    const before = text.slice(start, index)
    const lastWord = before.split(/\s+/).pop() ?? ''
    const normalizedLast = normalizePolish(lastWord).replace(/^[^a-z0-9]+/, '')
    const isAbbreviation = match[1] === '.' && (ABBREVIATIONS.has(normalizedLast) || /^\p{Lu}$/u.test(lastWord) || /^\d+$/.test(lastWord))
    if (isAbbreviation) continue
    const end = index + match[1].length
    sentences.push(text.slice(start, end).trim())
    start = end + match[2].length
  }
  const rest = text.slice(start).trim()
  if (rest.length > 0) sentences.push(rest)
  return sentences.filter((sentence) => sentence.length > 0)
}

function isRequestSentence(sentence: string): boolean {
  const normalized = normalizePolish(sentence)
  if (REQUEST_PATTERN.test(normalized)) return true
  if (/\?\s*$/.test(sentence.trim())) return true
  return INTERROGATIVE_START.test(normalized) && /\?/.test(sentence)
}

function isMetaSentence(sentence: string): boolean {
  const normalized = normalizePolish(sentence)
  if (!META_PATTERN.test(normalized)) return /^odpowiedz\w*\s+w\s+trybie/.test(normalized)
  return !/\?/.test(sentence) && !INTERROGATIVE_START.test(normalized)
}

const NUMBERED_ITEM = /^(\d{1,2})[.)]\s+(\S.*)$/
const LETTER_ITEM = /^([a-z])\)\s+(\S.*)$/
const BULLET_ITEM = /^[-–•*]\s+(\S.*)$/

type ListItem = { text: string; marker: 'number' | 'letter' | 'bullet' }

function matchListItem(line: string): ListItem | null {
  const numbered = line.match(NUMBERED_ITEM)
  if (numbered && !/^\d{1,2}\.\d/.test(line)) return { text: numbered[2], marker: 'number' }
  const letter = line.match(LETTER_ITEM)
  if (letter) return { text: letter[2], marker: 'letter' }
  const bullet = line.match(BULLET_ITEM)
  if (bullet) return { text: bullet[1], marker: 'bullet' }
  return null
}

function stripTrailingSeparators(value: string): string {
  return value.replace(/\s*-{2,}\s*$/, '').replace(/[,;]\s*$/, '').trim()
}

function isShortListFragment(value: string): boolean {
  return wordCount(value) <= 3 && !/[?]/.test(value)
}

function appendFragment(point: string, fragment: string, asListItem: boolean): string {
  const cleanedFragment = stripTrailingSeparators(fragment)
  if (cleanedFragment.length === 0) return point
  if (point.length === 0) return cleanedFragment
  if (asListItem) {
    const separator = /[:]\s*$/.test(point) ? ' ' : ', '
    return `${point.replace(/[,;]\s*$/, '')}${separator}${cleanedFragment}`
  }
  return `${point} ${cleanedFragment}`
}

type BodyStructure = { points: string[]; intro: string; hasList: boolean }

function collectListPoints(lines: BodyLine[]): BodyStructure | null {
  const firstItemIndex = lines.findIndex((line) => {
    const item = matchListItem(line.text)
    return item !== null && item.marker === 'number'
  })
  const anyItemIndex = firstItemIndex >= 0 ? firstItemIndex : lines.findIndex((line) => matchListItem(line.text) !== null)
  if (anyItemIndex < 0) return null
  const primaryMarker = firstItemIndex >= 0 ? 'number' : matchListItem(lines[anyItemIndex].text)?.marker
  const itemCount = lines.filter((line) => matchListItem(line.text)?.marker === primaryMarker).length
  if (primaryMarker !== 'number' && itemCount < 2) return null
  const intro = lines.slice(0, anyItemIndex).map((line) => line.text).join(' ')
  const items: string[] = []
  let current: string | null = null
  for (let index = anyItemIndex; index < lines.length; index += 1) {
    const line = lines[index]
    const item = matchListItem(line.text)
    if (item && item.marker === primaryMarker) {
      if (current !== null) items.push(current)
      current = item.text
      continue
    }
    if (current === null) continue
    if (item) {
      current = appendFragment(current, item.text, true)
      continue
    }
    const startsLowercase = /^[\p{Ll}(\[„"0-9-]/u.test(line.text)
    if (line.blankBefore && !startsLowercase) break
    if (!startsLowercase && isRequestSentence(line.text) && /[.?!:]\s*$/.test(current)) break
    current = appendFragment(current, line.text, false)
  }
  if (current !== null) items.push(current)
  const points: string[] = []
  for (const item of items) {
    const cleaned = stripTrailingSeparators(item)
    if (cleaned.length === 0) continue
    if (isShortListFragment(cleaned) && points.length > 0) {
      points[points.length - 1] = appendFragment(points[points.length - 1], cleaned, true)
      continue
    }
    points.push(cleaned)
  }
  if (points.length > 0 && points.every((point) => isShortListFragment(point))) {
    const lead = pickMainSentence(intro) ?? ''
    const merged = points.reduce((accumulator, point) => appendFragment(accumulator, point, true), lead)
    return { points: [merged], intro, hasList: true }
  }
  return { points, intro, hasList: true }
}

function joinWrappedLines(lines: BodyLine[]): BodyLine[] {
  const units: BodyLine[] = []
  for (const line of lines) {
    const previous = units[units.length - 1]
    const continuesPrevious = previous !== undefined
      && !line.blankBefore
      && !/[.?!:;,]\s*$/.test(previous.text)
      && /^[\p{Ll}(„"]/u.test(line.text)
      && wordCount(previous.text) > 6
    if (continuesPrevious && previous) {
      previous.text = `${previous.text} ${line.text}`
      continue
    }
    units.push({ ...line })
  }
  return units
}

function collectSentencePoints(lines: BodyLine[]): BodyStructure {
  const units = joinWrappedLines(lines)
  const points: string[] = []
  let current: string | null = null
  let preamble = ''
  for (const unit of units) {
    const unitText = stripTrailingSeparators(unit.text)
    if (unitText.length === 0) continue
    const isListFragment = wordCount(unitText) <= 10 && !/[.?!]\s*$/.test(unitText) && !isRequestSentence(unitText)
    if (isListFragment) {
      if (current !== null) current = appendFragment(current, unitText, true)
      else preamble = appendFragment(preamble, unitText, false)
      continue
    }
    for (const sentence of splitSentences(unitText)) {
      const cleanedSentence = stripTrailingSeparators(sentence)
      if (cleanedSentence.length === 0) continue
      if (isMetaSentence(cleanedSentence)) continue
      const normalized = normalizePolish(cleanedSentence)
      if (current !== null && CONDITIONAL_FOLLOW_UP.test(normalized)) {
        current = appendFragment(current, cleanedSentence, false)
        continue
      }
      if (isRequestSentence(cleanedSentence)) {
        if (current !== null) points.push(current)
        current = cleanedSentence
        continue
      }
      if (current !== null) current = appendFragment(current, cleanedSentence, false)
      else preamble = appendFragment(preamble, cleanedSentence, false)
    }
  }
  if (current !== null) points.push(current)
  if (points.length === 0) {
    const whole = units.map((unit) => unit.text).join(' ').trim()
    return { points: whole.length > 0 ? [whole] : [], intro: '', hasList: false }
  }
  return { points, intro: preamble, hasList: false }
}

function pickMainSentence(text: string): string | null {
  const candidates = splitSentences(text)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0 && isRequestSentence(sentence))
  if (candidates.length === 0) return null
  const scored = candidates.map((sentence, index) => {
    const normalized = normalizePolish(sentence)
    let score = 0
    if (/(w zakresie|na temat|dotyczac|nastepujacej informacji|o udostepnienie|o udzielenie|o przeslanie|o podanie)/.test(normalized)) score += 2
    if (/w szczegolnosci/.test(normalized)) score -= 2
    if (isMetaSentence(sentence)) score -= 3
    score -= index * 0.1
    return { sentence, score }
  })
  scored.sort((first, second) => second.score - first.score)
  return scored[0]?.sentence ?? null
}

function scrubPersonalNames(value: string, personName: string | null): string {
  let result = value
  if (personName) {
    const nameParts = personName
      .split(/\s+/)
      .map((word) => word.replace(/[^\p{L}-]/gu, ''))
      .filter((word) => word.length > 2 && !NON_PERSON_CAPITALISED.has(normalizePolish(word)))
    for (const part of nameParts) {
      result = result.split(part).join('')
    }
  }
  const tokens = result.split(/(\s+)/)
  const output: string[] = []
  const isCapitalisedWord = (token: string) => /^[„"(]?\p{Lu}\p{Ll}+[,.;:)"”]?$/u.test(token)
  const coreWord = (token: string) => normalizePolish(token.replace(/[^\p{L}]/gu, ''))
  let index = 0
  let wordPosition = 0
  while (index < tokens.length) {
    const token = tokens[index]
    if (/^\s+$/.test(token) || token.length === 0) {
      output.push(token)
      index += 1
      continue
    }
    const previousWord = output.filter((item) => !/^\s*$/.test(item)).pop() ?? ''
    const previousNormalized = normalizePolish(previousWord)
    const afterLocationMarker = /^(ul\.|al\.|pl\.|pn\.|sw\.|im\.|os\.|rondo|ronda|„)$/.test(previousNormalized) || /[„"]$/.test(previousWord)
    if (wordPosition > 0 && isCapitalisedWord(token) && !afterLocationMarker && !NON_PERSON_CAPITALISED.has(coreWord(token))) {
      const run: number[] = [index]
      let cursor = index + 2
      while (cursor < tokens.length && isCapitalisedWord(tokens[cursor]) && !NON_PERSON_CAPITALISED.has(coreWord(tokens[cursor]))) {
        run.push(cursor)
        if (/[,.;:)]$/.test(tokens[cursor])) break
        cursor += 2
      }
      const triggered = PERSON_TRIGGER_WORDS.test(previousNormalized)
      const lastRunToken = tokens[run[run.length - 1]]
      const runIsName = run.length >= 2 && !/[,.;:)]$/.test(tokens[run[0]])
      if (runIsName || triggered) {
        if (triggered && /^(przez|pan|pana|panu|panem|pani|pania)$/.test(previousNormalized)) {
          while (output.length > 0 && /^\s*$/.test(output[output.length - 1])) output.pop()
          output.pop()
        }
        const trailingPunctuation = lastRunToken.match(/[,.;:)]+$/)?.[0] ?? ''
        if (trailingPunctuation.length > 0) output.push(trailingPunctuation)
        index = run[run.length - 1] + 1
        wordPosition += run.length
        continue
      }
    }
    output.push(token)
    wordPosition += 1
    index += 1
  }
  return output.join('').replace(/\s+([,.;:)])/g, '$1').replace(/\s{2,}/g, ' ').trim()
}

function buildSubjectSummary(source: string, personName: string | null): string {
  let subject = cleanWhitespace(stripBoilerplate(source))
  for (const leadIn of SUBJECT_LEAD_INS) {
    if (leadIn.test(subject)) {
      subject = subject.replace(leadIn, '')
      break
    }
  }
  for (const pattern of SUBJECT_AFTER_LEAD_IN) subject = subject.replace(pattern, '')
  subject = scrubPersonalNames(subject, personName)
  const words = subject.split(' ')
  for (let position = 0; position < Math.min(4, words.length); position += 1) {
    const normalizedWord = normalizePolish(words[position])
    if (position > 0 && (normalizedWord === 'i' || normalizedWord === 'oraz')) continue
    const replacement = SUBJECT_HEAD_NOMINATIVE[normalizedWord]
    if (!replacement) break
    words[position] = replacement
  }
  subject = words.join(' ')
  const colonIndex = subject.indexOf(':')
  if (colonIndex >= 30) subject = subject.slice(0, colonIndex)
  subject = capitalise(subject.replace(/[\s:;,.?!-]+$/, '').trim())
  if (subject.length <= SUBJECT_MAX_LENGTH) return subject
  const cut = subject.slice(0, SUBJECT_MAX_LENGTH - 1)
  const lastSpace = cut.lastIndexOf(' ')
  const trimmed = (lastSpace > 60 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:(–-]+$/, '')
  return `${trimmed}…`
}

function guessFromSignature(signatureLines: string[]): RequesterGuess {
  let name: string | null = null
  let kind: RequesterKind | null = null
  let address: string | null = null
  let pendingPrefix = ''
  for (const rawLine of signatureLines) {
    const line = cleanWhitespace(rawLine)
    if (line.length === 0) continue
    if (/^ks\.?$/i.test(line)) {
      pendingPrefix = 'ks. '
      continue
    }
    if (!address && isAddressLine(line) && !/@/.test(line)) {
      address = line
      continue
    }
    if (name) continue
    if (/@|\d{3}[\s-]\d{3}/.test(line)) continue
    if (isOrganisationLine(line)) {
      name = `${pendingPrefix}${line}`.trim()
      kind = 'organisation'
      continue
    }
    if (isPersonNameLine(line)) {
      name = `${pendingPrefix}${line}`.trim()
      kind = 'person'
    }
  }
  return { name, kind, address }
}

function guessFromHeader(lines: string[]): RequesterGuess {
  const head = lines.slice(0, 6)
  for (let index = 0; index < head.length - 1; index += 1) {
    const line = head[index]
    const following = head.slice(index + 1, index + 3)
    const addressLine = following.find((candidate) => isAddressLine(candidate))
    if (!addressLine) continue
    if (isOrganisationLine(line)) return { name: line, kind: 'organisation', address: addressLine }
    if (isPersonNameLine(line)) return { name: line, kind: 'person', address: addressLine }
  }
  return { name: null, kind: null, address: null }
}

const COMPANY_WITH_LEGAL_FORM = /((?:[„"]?[\p{Lu}][\p{L}\d&'’.\-]*[”"]?\s+){1,5}?)(S\.\s?A\.|[Ss]p\.\s?z\s?o\.\s?o\.|[Ss]p\.\s?j\.|[Ss]p\.\s?k\.|s\.\s?c\.)/gu
const COMPANY_LEADING_NOISE = /^(?:(?:W|Z|Do|Od|Dla|Przez|Firma|Spółka|Szanowni|Szanowny|Państwo|Pan|Pani)\s+)+/u

function companyNamedIn(body: string): string | null {
  const flattened = body.replace(/\s+/g, ' ')
  const matches = Array.from(flattened.matchAll(COMPANY_WITH_LEGAL_FORM))
  for (const match of matches.reverse()) {
    const name = cleanWhitespace(`${match[1].replace(COMPANY_LEADING_NOISE, '')}${match[2]}`)
    if (wordCount(name) >= 2 && !/^(?:Dz|U)\b/.test(name)) return name
  }
  return null
}

function guessFromBody(body: string): RequesterGuess {
  const company = companyNamedIn(body)
  if (company) return { name: company, kind: 'organisation', address: null }
  const organisation = body.match(/(?:^|[.!?]\s+|\n)((?:Stowarzyszenie|Fundacja|Parafia|Towarzystwo|Spółdzielnia|Związek|Klub|Instytut|Kancelaria|Redakcja|Wspólnota|Komitet|Rada Osiedla)\b[^,.;:\n]{0,80}?)(?=,|\s+(?:zwraca|zwracaj|wnosi|prosi|uprzejmie|działając))/u)
  if (organisation) {
    const candidate = cleanWhitespace(organisation[1])
    return { name: wordCount(candidate) >= 2 ? candidate : null, kind: 'organisation', address: null }
  }
  return { name: null, kind: null, address: null }
}

function detectRequesterKind(baseKind: RequesterKind | null, fullText: string, signatureText: string): RequesterKind {
  const normalizedFull = normalizePolish(fullText)
  const normalizedSignature = normalizePolish(signatureText)
  if (COUNCILLOR_STRONG.test(normalizedSignature) || COUNCILLOR_WEAK.test(normalizedSignature) || /\bjako\s+(radny|radna|posel|poslanka)\b/.test(normalizedFull)) return 'councillor'
  if (MEDIA_STRONG.test(normalizedFull) || MEDIA_WEAK.test(normalizedSignature) || /\bjako\s+dziennikar/.test(normalizedFull)) return 'media'
  if (COUNCILLOR_STRONG.test(normalizedFull)) return 'councillor'
  return baseKind ?? 'person'
}

function detectDeliveryForm(text: string, hints: IntakeHints | undefined, hasRequesterEmail: boolean): DeliveryForm {
  const normalized = normalizePolish(text)
  const asksEmail = /(poczt\w*\s+elektroniczn|e-?mail|drog\w*\s+elektroniczn|mailowo|na\s+adres\s+elektroniczn|adres\w*\s+elektroniczn|e-?doreczen|w\s+formie\s+elektronicznej)/.test(normalized) || hasRequesterEmail
  if (asksEmail) return 'email'
  if (/e-?puap/.test(normalized)) return 'epuap'
  if (/\bwglad\w*/.test(normalized)) return 'inspection'
  if (hints?.channel === 'email' || (hints?.senderEmail ?? '').length > 0) return 'email'
  if (hints?.channel === 'epuap') return 'epuap'
  return 'post'
}

function detectContact(text: string, hints: IntakeHints | undefined): string | null {
  const email = extractEmails(text).find((candidate) => !isOfficeEmail(candidate))
  if (email) return email
  const senderEmail = hints?.senderEmail?.trim()
  if (senderEmail && !isOfficeEmail(senderEmail)) return senderEmail
  const phone = text.match(PHONE_PATTERN)
  if (phone) return cleanWhitespace(phone[0].replace(/^(tel\.?|telefon|kom\.?)\s*:?\s*/i, ''))
  return null
}

export function parseRequestText(text: string, hints?: IntakeHints): IntakeSuggestion {
  const rawLines = text.replace(/\r\n?/g, '\n').split('\n').map((line) => cleanWhitespace(line))
  const caseNumber = text.match(CASE_NUMBER_PATTERN)?.[0] ?? null
  const letterDate = extractLetterDate(rawLines)

  const meaningful: BodyLine[] = []
  let blankPending = false
  for (const line of rawLines) {
    if (line.length === 0) {
      blankPending = true
      continue
    }
    meaningful.push({ text: line, blankBefore: blankPending })
    blankPending = false
  }

  const keptLines: BodyLine[] = []
  let lastClosingIndex = -1
  for (const line of meaningful) {
    let lineText = line.text
    if (isOfficeLine(lineText)) continue
    if (/\S\s*-{2,}\s*$/.test(lineText)) {
      lineText = lineText.replace(/\s*-{2,}\s*$/, '')
      keptLines.push({ text: lineText, blankBefore: line.blankBefore })
      keptLines.push({ text: '--', blankBefore: false })
      continue
    }
    keptLines.push({ text: lineText, blankBefore: line.blankBefore })
  }
  keptLines.forEach((line, index) => {
    if (isClosingLine(line.text) || (/^\p{L}+\s*\|/u.test(line.text) && isClosingLine(line.text.split('|')[0]))) lastClosingIndex = index
  })
  const signatureStart = lastClosingIndex >= 0 && keptLines.length - lastClosingIndex <= 8 ? lastClosingIndex : -1

  const signatureLines: string[] = []
  let bodyLines: BodyLine[] = keptLines
  if (signatureStart >= 0) {
    const closingLine = keptLines[signatureStart].text
    const inline = closingLine.match(/^[^|,]+[|,]\s*(.+)$/)
    if (inline && isClosingLine(closingLine.split(/[|,]/)[0])) signatureLines.push(inline[1])
    for (const line of keptLines.slice(signatureStart + 1)) {
      if (!isClosingLine(line.text)) signatureLines.push(line.text.replace(/^[^|]*\|\s*/, (prefix) => (isClosingLine(prefix.replace('|', '')) ? '' : prefix)))
    }
    bodyLines = keptLines.slice(0, signatureStart)
  }

  bodyLines = bodyLines.filter((line) => !isClosingLine(line.text) && !isSalutationLine(line.text) && !isTitleLine(line.text))

  if (signatureLines.length === 0 && bodyLines.length > 1) {
    const lastLine = bodyLines[bodyLines.length - 1].text
    if ((isPersonNameLine(lastLine) || (isOrganisationLine(lastLine) && wordCount(lastLine) <= 6)) && !isRequestSentence(lastLine)) {
      signatureLines.push(lastLine)
      bodyLines = bodyLines.slice(0, -1)
    }
  }

  bodyLines = bodyLines.filter((line) => !/^(tel\.?|telefon|e-?mail|adres)\s*:/i.test(line.text) && !(isAddressLine(line.text) && wordCount(line.text) <= 6))
  const headerGuess = guessFromHeader(bodyLines.map((line) => line.text))
  if (headerGuess.name) {
    bodyLines = bodyLines.filter((line) => line.text !== headerGuess.name && line.text !== headerGuess.address)
  }

  const cleanedBody = stripBoilerplate(bodyLines.map((line) => `${line.blankBefore ? '\n' : ''}${line.text}`).join('\n'))
  const cleanedLines: BodyLine[] = []
  let cleanedBlank = false
  for (const line of cleanedBody.split('\n')) {
    const trimmed = cleanWhitespace(line)
    if (trimmed.length === 0 || /^[,.;:]+$/.test(trimmed)) {
      cleanedBlank = true
      continue
    }
    cleanedLines.push({ text: trimmed.replace(/^[,;]\s*/, ''), blankBefore: cleanedBlank })
    cleanedBlank = false
  }

  const structure = collectListPoints(cleanedLines) ?? collectSentencePoints(cleanedLines)
  const points = structure.points
    .map((point) => capitalise(cleanWhitespace(point)))
    .filter((point) => point.length > 0)

  const signatureGuess = guessFromSignature(signatureLines)
  const bodyGuess = guessFromBody(bodyLines.map((line) => line.text).join('\n'))
  const nameGuess = signatureGuess.name ? signatureGuess : headerGuess.name ? headerGuess : bodyGuess
  const requesterName = nameGuess.name
  const baseKind = nameGuess.kind ?? bodyGuess.kind ?? signatureGuess.kind
  const signatureText = [...signatureLines, ...(headerGuess.name ? [headerGuess.name] : [])].join('\n')
  const requesterKind = detectRequesterKind(baseKind, text, signatureText)
  const requesterAddress = signatureGuess.address ?? headerGuess.address ?? null
  const requesterContact = detectContact(text, hints)
  const hasRequesterEmail = extractEmails(text).some((email) => !isOfficeEmail(email))
  const deliveryForm = detectDeliveryForm(text, hints, hasRequesterEmail)

  const mainSource = (structure.hasList ? pickMainSentence(structure.intro) : null)
    ?? splitSentences(points[0] ?? '')[0]
    ?? ''
  const subjectSummary = buildSubjectSummary(mainSource, requesterKind === 'person' ? requesterName : null)

  return {
    requesterName,
    requesterKind,
    requesterAddress,
    requesterContact,
    deliveryForm,
    letterDate,
    caseNumber,
    subjectSummary,
    points,
  }
}
