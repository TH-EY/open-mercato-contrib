import { normalizePolish, stemPolish, tokenizePolish } from '../text'

export type DepartmentKind = 'department' | 'office' | 'municipal_unit' | 'external'

export type DepartmentLike = {
  id: string
  name: string
  symbol?: string | null
  kind: DepartmentKind
  competenceScope: string
  keywords: string[]
  contractCodes?: string[]
}

export type RoutingSource = { kind: 'department_scope' | 'archive' | 'law'; ref: string; label: string }

export type RoutingProposal = {
  departmentId: string
  pointPositions: number[]
  scopeText: string
  confidence: number
  sources: RoutingSource[]
}

export type RoutingFlagKind = 'separate_entity' | 'published_in_bip' | 'personal_data' | 'processed_information'

export type RoutingFlag = { kind: RoutingFlagKind; message: string; departmentId?: string }

export type ArchiveHint = {
  caseNumber: string
  similarity: number
  departmentNames: string[]
  finalLetterType?: string | null
}

export type RoutingPoint = { position: number; text: string }

export type RoutingResult = { proposals: RoutingProposal[]; flags: RoutingFlag[] }

type KeywordMatcher = { label: string; stems: string[]; weight: number }

type PointEvaluation = { keywordScore: number; scopeScore: number; matchedKeywords: string[]; matchedScope: string[] }

type DepartmentEvaluation = {
  department: DepartmentLike
  points: Map<number, PointEvaluation>
  contractBonus: number
  contractMatches: string[]
  archiveBonus: number
  archiveSources: RoutingSource[]
  total: number
}

const SINGLE_KEYWORD_WEIGHT = 1
const PHRASE_KEYWORD_WEIGHT = 1.6
const SCOPE_STEM_WEIGHT = 0.15
const SCOPE_SCORE_CAP = 0.6
const CONTRACT_BONUS = 3
const ARCHIVE_WEIGHT = 2.5
const ARCHIVE_BONUS_CAP = 3
const CONFIDENCE_HALF_POINT = 2.5
const MIN_CONFIDENCE = 0.25
const MAX_PROPOSALS = 3
const POINT_SHARE_THRESHOLD = 0.5
const RELATIVE_TOTAL_THRESHOLD = 0.3
const FUZZY_STEM_MIN_LENGTH = 5
const MAX_KEYWORD_LABELS = 6

const SCOPE_IGNORED_STEMS = new Set([
  'realiz', 'umowy', 'umowa', 'umow', 'umowam', 'zadani', 'zadanie', 'sprawy', 'spraw', 'prowad', 'miejsk', 'miejsc',
  'obslug', 'zakres', 'jednos', 'publiczn', 'public', 'oraz', 'zwiaza', 'decyzj', 'organ', 'utrzym', 'koszty',
  'kosztu', 'koszt', 'ewiden', 'odbior', 'wykona', 'nadzor', 'admini',
])

const CONTRACT_CODE_PATTERN = /\b(?:nr|numer)?\s*\d{1,5}\s*\/\s*([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{1,8})\s*\/\s*(?:\d{2}\/)?\d{4}\b/g

const PERSONAL_DATA_PATTERNS: RegExp[] = [
  /\bczy\s+(pan|pani)\b/,
  /\bpelnil[a]?\s+funkcj/,
  /\b(wynagrodzeni\w*|zatrudnieni\w*|zarobk\w*)\s+(pana|pani|osoby)\b/,
  /\bimie\s+i\s+nazwisko\s+(osoby|kierownika|pracownika)/,
]

const NAMED_PERSON_PATTERN = /\b(Pana|Pani|Panią|Panem|Panu)\s+\p{Lu}\p{Ll}+/u

const PROCESSED_INFORMATION_PATTERN = /\b(analiz\w*|opracowani\w*|statystyk\w*|porownani\w*|przetworz\w*|zestawieni\w+\s+za\s+lata)/

const PUBLISHED_IN_BIP_PATTERN = /\b(uchwal\w*|zarzadzeni\w*\s+prezydenta|budzet\w*\s+miasta|sprawozdani\w*\s+z\s+wykonania|protokol\w*\s+z\s+sesji|rejestr\w*\s+umow)/

function stemsMatch(first: string, second: string): boolean {
  if (first === second) return true
  const shorter = first.length <= second.length ? first : second
  const longer = shorter === first ? second : first
  return shorter.length >= FUZZY_STEM_MIN_LENGTH && longer.startsWith(shorter)
}

function containsStem(stems: string[], stem: string): boolean {
  return stems.some((candidate) => stemsMatch(candidate, stem))
}

function buildMatchers(department: DepartmentLike): KeywordMatcher[] {
  const seen = new Set<string>()
  const matchers: KeywordMatcher[] = []
  for (const keyword of department.keywords) {
    const stems = Array.from(new Set(tokenizePolish(keyword).map((word) => stemPolish(word))))
    if (stems.length === 0) continue
    const signature = [...stems].sort().join('|')
    if (seen.has(signature)) continue
    seen.add(signature)
    matchers.push({ label: keyword, stems, weight: stems.length > 1 ? PHRASE_KEYWORD_WEIGHT : SINGLE_KEYWORD_WEIGHT })
  }
  return matchers
}

function evaluatePoint(pointStems: string[], matchers: KeywordMatcher[], scopeStems: string[]): PointEvaluation {
  let keywordScore = 0
  const matchedKeywords: string[] = []
  const coveredStems = new Set<string>()
  for (const matcher of matchers) {
    if (!matcher.stems.every((stem) => containsStem(pointStems, stem))) continue
    keywordScore += matcher.weight
    matchedKeywords.push(matcher.label)
    matcher.stems.forEach((stem) => coveredStems.add(stem))
  }
  const matchedScope = scopeStems.filter((stem) => !coveredStems.has(stem) && containsStem(pointStems, stem))
  const scopeScore = Math.min(SCOPE_SCORE_CAP, matchedScope.length * SCOPE_STEM_WEIGHT)
  return { keywordScore, scopeScore, matchedKeywords, matchedScope }
}

function extractContractCodes(points: RoutingPoint[]): { code: string; reference: string }[] {
  const found: { code: string; reference: string }[] = []
  for (const point of points) {
    for (const match of point.text.matchAll(CONTRACT_CODE_PATTERN)) {
      const code = normalizePolish(match[1]).toUpperCase()
      if (!found.some((entry) => entry.code === code)) found.push({ code, reference: match[0].trim() })
    }
  }
  return found
}

function departmentMatchesName(department: DepartmentLike, name: string): boolean {
  const normalizedName = normalizePolish(name)
  if (normalizedName.length === 0) return false
  const normalizedDepartment = normalizePolish(department.name)
  if (normalizedDepartment === normalizedName) return true
  if (department.symbol && normalizePolish(department.symbol) === normalizedName) return true
  return normalizedName.length >= 8 && (normalizedDepartment.includes(normalizedName) || normalizedName.includes(normalizedDepartment))
}

function confidenceFromTotal(total: number): number {
  if (total <= 0) return 0
  return Math.round((total / (total + CONFIDENCE_HALF_POINT)) * 100) / 100
}

function pointScore(evaluation: DepartmentEvaluation, position: number): number {
  const point = evaluation.points.get(position)
  const local = point ? point.keywordScore + point.scopeScore : 0
  return local + evaluation.contractBonus + evaluation.archiveBonus
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1).trimEnd()}…`
}

function buildScopeText(points: RoutingPoint[]): string {
  if (points.length === 1) return `Prośba o informację w zakresie: ${points[0].text}`
  const listed = points.map((point) => `pkt ${point.position}) ${point.text}`).join('; ')
  return `Prośba o informację w zakresie: ${listed}`
}

function buildSources(evaluation: DepartmentEvaluation, positions: number[]): RoutingSource[] {
  const sources: RoutingSource[] = []
  const keywords = new Set<string>()
  const scopeStems = new Set<string>()
  for (const position of positions) {
    const point = evaluation.points.get(position)
    if (!point) continue
    point.matchedKeywords.forEach((keyword) => keywords.add(keyword))
    point.matchedScope.forEach((stem) => scopeStems.add(stem))
  }
  for (const contract of evaluation.contractMatches) {
    sources.push({ kind: 'department_scope', ref: evaluation.department.id, label: contract })
  }
  if (keywords.size > 0) {
    sources.push({
      kind: 'department_scope',
      ref: evaluation.department.id,
      label: `Słowa kluczowe: ${Array.from(keywords).slice(0, MAX_KEYWORD_LABELS).join(', ')}`,
    })
  } else if (scopeStems.size > 0) {
    sources.push({
      kind: 'department_scope',
      ref: evaluation.department.id,
      label: `Zakres kompetencji: ${truncate(evaluation.department.competenceScope, 160)}`,
    })
  }
  sources.push(...evaluation.archiveSources)
  if (evaluation.department.kind === 'municipal_unit' || evaluation.department.kind === 'external') {
    sources.push({ kind: 'law', ref: 'art. 4 ust. 3 UDIP', label: 'Odrębny podmiot zobowiązany do udostępnienia informacji publicznej' })
  }
  return sources
}

function detectPointFlags(points: RoutingPoint[]): RoutingFlag[] {
  const flags: RoutingFlag[] = []
  const personalPositions: number[] = []
  const processedPositions: number[] = []
  const bipPositions: number[] = []
  for (const point of points) {
    const normalized = normalizePolish(point.text)
    const asksAboutPerson = PERSONAL_DATA_PATTERNS.some((pattern) => pattern.test(normalized)) || NAMED_PERSON_PATTERN.test(point.text)
    if (asksAboutPerson) personalPositions.push(point.position)
    if (PROCESSED_INFORMATION_PATTERN.test(normalized)) processedPositions.push(point.position)
    if (PUBLISHED_IN_BIP_PATTERN.test(normalized)) bipPositions.push(point.position)
  }
  const describe = (positions: number[]) => positions.map((position) => `pkt ${position}`).join(', ')
  if (personalPositions.length > 0) {
    flags.push({
      kind: 'personal_data',
      message: `Wniosek dotyczy konkretnej osoby (${describe(personalPositions)}) — sprawdź ochronę prywatności osoby fizycznej (art. 5 ust. 2 UDIP) i zakres informacji o osobie pełniącej funkcję publiczną.`,
    })
  }
  if (processedPositions.length > 0) {
    flags.push({
      kind: 'processed_information',
      message: `Odpowiedź może wymagać wytworzenia informacji przetworzonej (${describe(processedPositions)}) — oceń przesłankę szczególnej istotności dla interesu publicznego (art. 3 ust. 1 pkt 1 UDIP).`,
    })
  }
  if (bipPositions.length > 0) {
    flags.push({
      kind: 'published_in_bip',
      message: `Informacja może być opublikowana w Biuletynie Informacji Publicznej (${describe(bipPositions)}) — rozważ wskazanie adresu publikacji (art. 10 ust. 1 UDIP).`,
    })
  }
  return flags
}

export function proposeRoutingByKeywords(
  points: RoutingPoint[],
  departments: DepartmentLike[],
  archiveHints: ArchiveHint[] = [],
): RoutingResult {
  const usablePoints = points.filter((point) => point.text.trim().length > 0)
  const flags = detectPointFlags(usablePoints)
  if (usablePoints.length === 0 || departments.length === 0) return { proposals: [], flags }

  const pointStems = new Map<number, string[]>()
  for (const point of usablePoints) {
    pointStems.set(point.position, Array.from(new Set(tokenizePolish(point.text).map((word) => stemPolish(word)))))
  }
  const contractCodes = extractContractCodes(usablePoints)

  const evaluations: DepartmentEvaluation[] = departments.map((department) => {
    const matchers = buildMatchers(department)
    const scopeStems = Array.from(new Set(tokenizePolish(department.competenceScope).map((word) => stemPolish(word))))
      .filter((stem) => !SCOPE_IGNORED_STEMS.has(stem))
    const pointEvaluations = new Map<number, PointEvaluation>()
    let localTotal = 0
    for (const point of usablePoints) {
      const evaluation = evaluatePoint(pointStems.get(point.position) ?? [], matchers, scopeStems)
      pointEvaluations.set(point.position, evaluation)
      localTotal += evaluation.keywordScore + evaluation.scopeScore
    }
    const departmentCodes = (department.contractCodes ?? []).map((code) => normalizePolish(code).toUpperCase())
    const contractMatches = contractCodes
      .filter((entry) => departmentCodes.includes(entry.code))
      .map((entry) => `Kod umowy ${entry.code} (${entry.reference})`)
    const contractBonus = contractMatches.length > 0 ? CONTRACT_BONUS : 0
    let archiveBonus = 0
    const archiveSources: RoutingSource[] = []
    for (const hint of archiveHints) {
      const similarity = Math.max(0, Math.min(1, hint.similarity))
      if (similarity <= 0) continue
      if (!hint.departmentNames.some((name) => departmentMatchesName(department, name))) continue
      archiveBonus += similarity * ARCHIVE_WEIGHT
      archiveSources.push({
        kind: 'archive',
        ref: hint.caseNumber,
        label: `Podobna sprawa ${hint.caseNumber} (podobieństwo ${Math.round(similarity * 100)}%)`,
      })
    }
    archiveBonus = Math.min(ARCHIVE_BONUS_CAP, archiveBonus)
    return {
      department,
      points: pointEvaluations,
      contractBonus,
      contractMatches,
      archiveBonus,
      archiveSources,
      total: localTotal / Math.sqrt(usablePoints.length) + contractBonus + archiveBonus,
    }
  })

  const ranked = evaluations.filter((evaluation) => evaluation.total > 0).sort((first, second) => second.total - first.total)
  if (ranked.length === 0) return { proposals: [], flags }

  const bestTotal = ranked[0].total
  const pointWinners = new Set<string>()
  for (const point of usablePoints) {
    let winner: DepartmentEvaluation | null = null
    let winnerScore = 0
    for (const evaluation of ranked) {
      const score = pointScore(evaluation, point.position)
      if (score > winnerScore) {
        winner = evaluation
        winnerScore = score
      }
    }
    if (winner) pointWinners.add(winner.department.id)
  }
  let selected = ranked
    .filter((evaluation) => {
      if (confidenceFromTotal(evaluation.total) < MIN_CONFIDENCE) return false
      return evaluation.total >= bestTotal * RELATIVE_TOTAL_THRESHOLD || pointWinners.has(evaluation.department.id)
    })
    .slice(0, MAX_PROPOSALS)
  if (selected.length === 0) selected = [ranked[0]]

  const assignments = new Map<string, number[]>()
  selected.forEach((evaluation) => assignments.set(evaluation.department.id, []))
  for (const point of usablePoints) {
    const scores = selected.map((evaluation) => ({ evaluation, score: pointScore(evaluation, point.position) }))
    const best = Math.max(...scores.map((entry) => entry.score))
    if (best <= 0) {
      assignments.get(selected[0].department.id)?.push(point.position)
      continue
    }
    for (const entry of scores) {
      if (entry.score > 0 && entry.score >= best * POINT_SHARE_THRESHOLD) {
        assignments.get(entry.evaluation.department.id)?.push(point.position)
      }
    }
  }
  for (const evaluation of selected) {
    const assigned = assignments.get(evaluation.department.id) ?? []
    if (assigned.length > 0) continue
    const fallback = usablePoints.filter((point) => pointScore(evaluation, point.position) > 0).map((point) => point.position)
    assignments.set(evaluation.department.id, fallback.length > 0 ? fallback : usablePoints.map((point) => point.position))
  }

  const proposals: RoutingProposal[] = selected.map((evaluation) => {
    const positions = (assignments.get(evaluation.department.id) ?? []).sort((first, second) => first - second)
    const assignedPoints = usablePoints.filter((point) => positions.includes(point.position))
    return {
      departmentId: evaluation.department.id,
      pointPositions: positions,
      scopeText: buildScopeText(assignedPoints),
      confidence: confidenceFromTotal(evaluation.total),
      sources: buildSources(evaluation, positions),
    }
  })

  for (const evaluation of selected) {
    const kind = evaluation.department.kind
    if (kind !== 'municipal_unit' && kind !== 'external') continue
    flags.unshift({
      kind: 'separate_entity',
      departmentId: evaluation.department.id,
      message: `${evaluation.department.name} jest odrębnym podmiotem zobowiązanym — rozważ wskazanie właściwego dysponenta (art. 4 ust. 3 UDIP)`,
    })
  }

  return { proposals, flags }
}
