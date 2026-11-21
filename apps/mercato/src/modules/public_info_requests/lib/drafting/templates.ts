import { contentHash } from './grounding'
import type { DraftFlag, DraftParagraph, DraftParagraphKind, DraftSource, LetterContext, LetterType, Salutation } from './types'

export const OFFICE_NAME_NOMINATIVE = 'Urząd Miasta Bydgoszczy'
export const OFFICE_NAME_GENITIVE = 'Urzędu Miasta Bydgoszczy'
export const CLOSING_PHRASE = 'Łączę wyrazy szacunku,'
export const PROJECT_MARKER = 'PROJEKT — wymaga podpisu osoby upoważnionej'
export const CLARIFICATION_TITLE = 'WEZWANIE DO DOPRECYZOWANIA ZAKRESU OTRZYMANEGO WNIOSKU'
export const REFUSAL_TITLE = 'DECYZJA'
export const ACCESS_ACT_REFERENCE =
  'ustawy z dnia 6 września 2001 r. o dostępie do informacji publicznej (t.j. Dz. U. z 2022 r. poz. 902)'
export const DEFAULT_CLARIFICATION_DAYS = 7

const POLISH_MONTHS_GENITIVE = [
  'stycznia',
  'lutego',
  'marca',
  'kwietnia',
  'maja',
  'czerwca',
  'lipca',
  'sierpnia',
  'września',
  'października',
  'listopada',
  'grudnia',
]

const INTERNAL_UNIT_PATTERN = /^(Wydział|Biuro|Referat|Zespół|Kancelaria|Pełnomocnik|Miejski Rzecznik|Urząd Stanu Cywilnego)/u

export function polishDateLong(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) throw new Error(`[internal] Invalid ISO date: ${iso}`)
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) throw new Error(`[internal] Invalid ISO date: ${iso}`)
  return `${day} ${POLISH_MONTHS_GENITIVE[month - 1]} ${match[1]} r.`
}

export function salutationLine(salutation: Salutation): string {
  if (salutation === 'pani') return 'Szanowna Pani,'
  if (salutation === 'panstwo') return 'Szanowni Państwo,'
  return 'Szanowny Panie,'
}

export function pronounForm(salutation: Salutation): { genitive: string; accusative: string } {
  if (salutation === 'pani') return { genitive: 'Pani', accusative: 'Panią' }
  if (salutation === 'panstwo') return { genitive: 'Państwa', accusative: 'Państwa' }
  return { genitive: 'Pana', accusative: 'Pana' }
}

export function letterTitle(type: LetterType): string | null {
  if (type === 'clarification_request') return CLARIFICATION_TITLE
  return null
}

export function joinPolishList(items: string[]): string {
  const filtered = items.map((item) => item.trim()).filter(Boolean)
  if (filtered.length <= 1) return filtered.join('')
  return `${filtered.slice(0, -1).join(', ')} oraz ${filtered[filtered.length - 1]}`
}

export function departmentPhrase(departments: string[]): string {
  const unique = Array.from(new Set(departments.map((name) => name.trim()).filter(Boolean)))
  if (unique.length === 0) return `komórkę merytoryczną ${OFFICE_NAME_GENITIVE}`
  const internal = unique.filter((name) => INTERNAL_UNIT_PATTERN.test(name) && !/Urzęd|Urząd/u.test(name))
  const external = unique.filter((name) => !internal.includes(name))
  const parts: string[] = []
  if (internal.length > 0) parts.push(`${joinPolishList(internal)} ${OFFICE_NAME_GENITIVE}`)
  parts.push(...external)
  const listed = joinPolishList(parts)
  if (unique.length === 1) {
    return external.length === 1 && internal.length === 0 && !/Urzęd|Urząd/u.test(listed)
      ? `jednostkę merytoryczną, tj. ${listed}`
      : `komórkę merytoryczną, tj. ${listed}`
  }
  return external.length > 0 ? `jednostki merytoryczne, tj. ${listed}` : `komórki merytoryczne, tj. ${listed}`
}

export function createParagraph(input: {
  kind: DraftParagraphKind
  index: number
  text: string
  pointPosition?: number
  sources?: DraftSource[]
  flags?: DraftFlag[]
}): DraftParagraph {
  const paragraph: DraftParagraph = {
    id: `${input.kind}-${input.index}`,
    kind: input.kind,
    text: input.text,
    contentHash: contentHash(input.text),
    sources: input.sources ?? [],
    flags: input.flags ?? [],
  }
  if (typeof input.pointPosition === 'number') paragraph.pointPosition = input.pointPosition
  return paragraph
}

export function pointMarker(position: number): string {
  return `Ad ${position}`
}

type ParagraphSpec = { kind: DraftParagraphKind; text: string; pointPosition?: number; flags?: DraftFlag[] }

export function endSentence(text: string): string {
  const trimmed = text.trimEnd()
  return /[.?!:]$/u.test(trimmed) ? trimmed : `${trimmed}.`
}

function lowercaseLead(text: string): string {
  return /^\p{Lu}\p{Ll}/u.test(text) ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text
}

function subject(ctx: LetterContext): string {
  return ctx.subjectSummary.trim().replace(/[.,;:\s]+$/u, '')
}

function requestDateLabel(ctx: LetterContext): string {
  const value = ctx.requestDate ?? ctx.receivedAt
  return polishDateLong(value)
}

export function answerIntroText(ctx: LetterContext): string {
  const pronoun = pronounForm(ctx.salutation)
  const ending = ctx.points.length > 0 ? 'informuję, co następuje.' : 'przekazuję w załączeniu odpowiedź.'
  return `w odpowiedzi na wystosowany przez ${pronoun.accusative} wniosek o udostępnienie informacji publicznej dotyczący ${subject(ctx)}, na podstawie materiału przygotowanego przez ${departmentPhrase(ctx.departments)} ${ending}`
}

function answerSpecs(ctx: LetterContext): ParagraphSpec[] {
  const points = [...ctx.points].sort((left, right) => left.position - right.position)
  return [
    { kind: 'intro', text: answerIntroText(ctx) },
    ...points.map<ParagraphSpec>((point) => ({ kind: 'point', text: '', pointPosition: point.position, flags: ['gap'] })),
  ]
}

function extensionSpecs(ctx: LetterContext): ParagraphSpec[] {
  const pronoun = pronounForm(ctx.salutation)
  const reason = ctx.extension?.reason?.trim() || 'konieczność przeprowadzenia całościowej kwerendy w zakresie wnioskowanych danych'
  const deadline = ctx.extension?.newDueDate
    ? ` – orientacyjny termin udzielenia odpowiedzi: ${polishDateLong(ctx.extension.newDueDate)}`
    : ', nie dłuższym jednak niż 2 miesiące od dnia złożenia wniosku'
  return [
    {
      kind: 'intro',
      text: endSentence(
        `w odpowiedzi na wystosowany przez ${pronoun.accusative} wniosek o udostępnienie informacji publicznej dotyczący ${subject(ctx)}, ze względu na ${reason.replace(/[.\s]+$/u, '')} powiadamiam, że ostateczna odpowiedź nastąpi w terminie późniejszym wskazanym w art. 13 ust. 2 ${ACCESS_ACT_REFERENCE}${deadline}`,
      ),
    },
  ]
}

function quotedPoints(ctx: LetterContext): string {
  const points = [...ctx.points].sort((left, right) => left.position - right.position)
  if (points.length === 1) return `„${points[0].text.trim()}”`
  return points.map((point) => `${point.position}. „${point.text.trim()}”`).join('\n')
}

function clarificationSpecs(ctx: LetterContext): ParagraphSpec[] {
  const pronoun = pronounForm(ctx.salutation)
  const clarification = ctx.clarification
  const departmentName = clarification?.departmentName?.trim() || ctx.departments[0] || ''
  const days = clarification?.days && clarification.days > 0 ? clarification.days : DEFAULT_CLARIFICATION_DAYS
  const scope = ctx.points.length > 0 ? `:\n${quotedPoints(ctx)}` : '.'
  const question = clarification?.question?.trim()
  const unit = departmentName ? departmentPhrase([departmentName]) : `komórkę merytoryczną ${OFFICE_NAME_GENITIVE}`
  const unitNominative = unit.replace(/^komórkę merytoryczną/u, 'komórka merytoryczna').replace(/^jednostkę merytoryczną/u, 'jednostka merytoryczna')
  const specs: ParagraphSpec[] = [
    {
      kind: 'intro',
      text: `w związku z wystosowanym przez ${pronoun.accusative} wnioskiem o udostępnienie informacji publicznej dotyczącym ${subject(ctx)}${scope}`,
    },
    {
      kind: 'intro',
      text: question
        ? `${unitNominative} wnosi o doprecyzowanie wniosku w następującym zakresie: ${endSentence(lowercaseLead(question))}`
        : `${unitNominative} wnosi o doprecyzowanie wniosku.`,
    },
    {
      kind: 'intro',
      text: `Proszę o przesłanie doprecyzowania w terminie ${days} dni od otrzymania niniejszego pisma. Po upływie tego terminu wniosek zostanie pozostawiony bez rozpoznania, o czym Wnioskodawca zostanie powiadomiony odrębnym pismem.`,
    },
  ]
  if (clarification?.newDueDate) {
    specs.push({
      kind: 'intro',
      text: `Jednocześnie stosownie do treści art. 13 ust. 2 ${ACCESS_ACT_REFERENCE} powiadamiam, że wyznaczam nowy termin na rozpatrzenie wniosku, wskazując dzień ${polishDateLong(clarification.newDueDate)}`,
    })
  }
  return specs
}

function notHeldReferralSpecs(ctx: LetterContext): ParagraphSpec[] {
  const pronoun = pronounForm(ctx.salutation)
  const entityName = ctx.referral?.entityName?.trim() || 'właściwego podmiotu'
  const contactBlock = ctx.referral?.contactBlock?.trim()
  const specs: ParagraphSpec[] = [
    {
      kind: 'intro',
      text: `w odpowiedzi na wystosowany przez ${pronoun.accusative} wniosek o udostępnienie informacji publicznej dotyczący ${subject(ctx)}, uprzejmie informuję iż ${OFFICE_NAME_NOMINATIVE} nie jest dysponentem wnioskowanych danych.`,
    },
    {
      kind: 'intro',
      text: `Jednocześnie wskazuję, iż zgodnie z zasadą dostępu do informacji publicznej, wyrażoną w art. 4 ust. 3 ${ACCESS_ACT_REFERENCE} obowiązane do udostępnienia informacji publicznej są podmioty publiczne będące w posiadaniu tych informacji.`,
    },
    {
      kind: 'intro',
      text: `W związku z powyższym ${OFFICE_NAME_NOMINATIVE} uprzejmie informuje, iż Wnioskodawca w zakresie informacji dotyczących ${subject(ctx)} winien się zwrócić do ${entityName} jako właściwego dysponenta danych.${contactBlock ? ' Poniżej zamieszczam dane do kontaktu:' : ''}`,
    },
  ]
  if (contactBlock) specs.push({ kind: 'intro', text: contactBlock })
  return specs
}

function bipReferralSpecs(ctx: LetterContext): ParagraphSpec[] {
  const pronoun = pronounForm(ctx.salutation)
  const url = ctx.bipUrl?.trim() || 'https://bip.um.bydgoszcz.pl'
  return [
    {
      kind: 'intro',
      text: `w odpowiedzi na wystosowany przez ${pronoun.accusative} wniosek o udostępnienie informacji publicznej dotyczący ${subject(ctx)}, uprzejmie informuję, że wnioskowane informacje zostały udostępnione w Biuletynie Informacji Publicznej ${OFFICE_NAME_GENITIVE} pod adresem: ${url}`,
    },
    {
      kind: 'intro',
      text: `Zgodnie z art. 10 ust. 1 ${ACCESS_ACT_REFERENCE} na wniosek udostępniana jest informacja publiczna, która nie została udostępniona w Biuletynie Informacji Publicznej lub centralnym repozytorium.`,
    },
  ]
}

function refusalSpecs(ctx: LetterContext): ParagraphSpec[] {
  const legalBasis = ctx.refusal?.legalBasis?.trim()
  const reason = ctx.refusal?.reason?.trim() ?? ''
  const basis = legalBasis ? `art. 16 ust. 1 w związku z ${legalBasis}` : 'art. 16 ust. 1'
  return [
    { kind: 'intro', text: PROJECT_MARKER },
    { kind: 'intro', text: REFUSAL_TITLE },
    {
      kind: 'intro',
      text: `Na podstawie ${basis} ${ACCESS_ACT_REFERENCE} oraz art. 104 ustawy z dnia 14 czerwca 1960 r. – Kodeks postępowania administracyjnego, po rozpatrzeniu wniosku z dnia ${requestDateLabel(ctx)} o udostępnienie informacji publicznej dotyczącego ${subject(ctx)}`,
    },
    { kind: 'intro', text: 'odmawiam udostępnienia informacji publicznej w zakresie wskazanym we wniosku.' },
    { kind: 'intro', text: 'UZASADNIENIE' },
    { kind: 'intro', text: reason },
    {
      kind: 'intro',
      text: 'POUCZENIE: Od niniejszej decyzji przysługuje odwołanie do Samorządowego Kolegium Odwoławczego w Bydgoszczy za pośrednictwem Prezydenta Miasta Bydgoszczy w terminie 14 dni od dnia jej doręczenia (art. 16 ust. 2 pkt 1 ustawy o dostępie do informacji publicznej).',
    },
  ]
}

function leftUnprocessedSpecs(ctx: LetterContext): ParagraphSpec[] {
  const pronoun = pronounForm(ctx.salutation)
  const days = ctx.clarification?.days && ctx.clarification.days > 0 ? ctx.clarification.days : DEFAULT_CLARIFICATION_DAYS
  return [
    {
      kind: 'intro',
      text: `w związku z wystosowanym przez ${pronoun.accusative} wnioskiem o udostępnienie informacji publicznej dotyczącym ${subject(ctx)} informuję, że ${OFFICE_NAME_NOMINATIVE} wezwał ${pronoun.accusative} do doprecyzowania zakresu wniosku w terminie ${days} dni od otrzymania wezwania.`,
    },
    {
      kind: 'intro',
      text: 'Wobec nieprzesłania doprecyzowania w wyznaczonym terminie informuję, że wniosek pozostaje bez rozpoznania.',
    },
  ]
}

function noStatisticsSpecs(ctx: LetterContext): ParagraphSpec[] {
  const pronoun = pronounForm(ctx.salutation)
  return [
    {
      kind: 'intro',
      text: `w związku z wystosowanym przez ${pronoun.accusative} wnioskiem o udostępnienie informacji publicznej dotyczącym ${subject(ctx)}, na podstawie informacji przygotowanych przez ${departmentPhrase(ctx.departments)} informuję, że ${OFFICE_NAME_NOMINATIVE} nie prowadzi statystyk, które umożliwiłyby udzielenie odpowiedzi.`,
    },
  ]
}

function specsFor(type: LetterType, ctx: LetterContext): ParagraphSpec[] {
  switch (type) {
    case 'answer':
      return answerSpecs(ctx)
    case 'extension_notice':
      return extensionSpecs(ctx)
    case 'clarification_request':
      return clarificationSpecs(ctx)
    case 'not_held_referral':
      return notHeldReferralSpecs(ctx)
    case 'bip_referral':
      return bipReferralSpecs(ctx)
    case 'refusal_decision_draft':
      return refusalSpecs(ctx)
    case 'left_unprocessed':
      return leftUnprocessedSpecs(ctx)
    case 'no_statistics':
      return noStatisticsSpecs(ctx)
  }
}

export function closingSpec(type: LetterType): ParagraphSpec | null {
  if (type === 'refusal_decision_draft') return null
  return { kind: 'closing', text: CLOSING_PHRASE }
}

export function paragraphsFromSpecs(specs: (ParagraphSpec & { sources?: DraftSource[] })[]): DraftParagraph[] {
  return specs.map((spec, index) =>
    createParagraph({
      kind: spec.kind,
      index,
      text: spec.text,
      pointPosition: spec.pointPosition,
      flags: spec.flags,
      sources: spec.sources,
    }),
  )
}

export function buildTemplateParagraphs(type: LetterType, ctx: LetterContext): DraftParagraph[] {
  const specs = specsFor(type, ctx)
  const closing = closingSpec(type)
  return paragraphsFromSpecs(closing ? [...specs, closing] : specs)
}
