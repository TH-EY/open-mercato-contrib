import { draftFromReplies } from '../deterministic'
import { checkGrounding, contentHash, extractFactTokens, normalizeFactToken } from '../grounding'
import { renderLetterHtml, renderLetterText } from '../render'
import { buildTemplateParagraphs, polishDateLong, pronounForm, salutationLine } from '../templates'
import { LETTER_TYPES } from '../types'
import type { DraftParagraph, GroundingSource, LetterContext, LetterType, ReplyText } from '../types'

const BASE_CONTEXT: LetterContext = {
  caseNumber: 'BKS.IV.1431.901.2026',
  letterDate: '2026-11-21',
  requesterName: 'Anna Przykładowa',
  requesterAddressLines: ['ul. Testowa 1', '00-001 Miastowo'],
  salutation: 'pani',
  requestDate: '2026-11-03',
  receivedAt: '2026-11-04',
  subjectSummary: 'programu wymiany pieców w latach 2025–2026',
  points: [
    { position: 1, text: 'Ile zezwoleń wydano w 2025 r.?' },
    { position: 2, text: 'Jaki był łączny koszt programu?' },
    { position: 3, text: 'Ilu uczniów uczęszczało do szkół?' },
  ],
  departments: ['Wydział Gospodarki Komunalnej', 'Wydział Edukacji i Sportu'],
  extension: { newDueDate: '2026-12-30', reason: 'konieczność przeprowadzenia całościowej kwerendy w zakresie wnioskowanych danych' },
  referral: {
    entityName: 'Zarządu Fikcyjnych Dróg w Miastowie',
    contactBlock: 'Zarząd Fikcyjnych Dróg w Miastowie\nul. Przykładowa 10\n00-002 Miastowo\ne-mail: kontakt@example.org',
  },
  bipUrl: 'https://bip.example.org/informacje',
  clarification: { departmentName: 'Wydział Administracji Budowlanej', question: 'O jakie dokładnie akta sprawy chodzi?', days: 7, newDueDate: '2026-12-18' },
  refusal: { legalBasis: 'art. 5 ust. 2', reason: 'Wnioskowane dane stanowią tajemnicę przedsiębiorcy.' },
}

const REPLY_COMMUNAL: ReplyText = {
  attachmentId: 'att-communal',
  departmentName: 'Wydział Gospodarki Komunalnej',
  pointPositions: [1, 2],
  text: [
    'WYDZIAŁ GOSPODARKI KOMUNALNEJ',
    'Bydgoszcz, dnia 10 listopada 2026 r.',
    'WGK.0012.44.2026',
    '',
    'W odpowiedzi na pismo z dnia 5.11.2026 r. przekazuję poniższe informacje.',
    'Ad 1',
    'W 2025 r. wydano 412 zezwoleń.',
    'Ad 2',
    'Łączny koszt programu wyniósł 1132500,00 zł.',
    '',
    'Z poważaniem',
    'Jan Testowy',
    'Dyrektor Wydziału',
  ].join('\n'),
}

const REPLY_EDUCATION: ReplyText = {
  attachmentId: 'att-education',
  departmentName: 'Wydział Edukacji i Sportu',
  pointPositions: [3],
  text: [
    'Bydgoszcz, 12.11.2026',
    'Szanowni Państwo,',
    'w odpowiedzi na prośbę uprzejmie informuję, że w roku szkolnym 2025/2026 do szkół uczęszczało 5697 uczniów. Wydział zaprasza do kontaktu.',
    'Z wyrazami szacunku',
    'Ewa Fikcyjna',
  ].join('\n'),
}

const SOURCES: GroundingSource[] = [
  { attachmentId: REPLY_COMMUNAL.attachmentId, text: REPLY_COMMUNAL.text },
  { attachmentId: REPLY_EDUCATION.attachmentId, text: REPLY_EDUCATION.text },
]

function pointParagraph(paragraphs: DraftParagraph[], position: number): DraftParagraph {
  const found = paragraphs.find((paragraph) => paragraph.kind === 'point' && paragraph.pointPosition === position)
  if (!found) throw new Error(`missing point ${position}`)
  return found
}

function withText(paragraph: DraftParagraph, text: string): DraftParagraph {
  return { ...paragraph, text }
}

describe('polishDateLong', () => {
  it('formats ISO dates with the Polish genitive month name', () => {
    expect(polishDateLong('2026-11-21')).toBe('21 listopada 2026 r.')
    expect(polishDateLong('2026-01-05')).toBe('5 stycznia 2026 r.')
    expect(polishDateLong('2025-09-30T10:00:00Z')).toBe('30 września 2025 r.')
  })

  it('rejects malformed input', () => {
    expect(() => polishDateLong('21.11.2026')).toThrow('[internal]')
  })
})

describe('salutations', () => {
  it('maps salutation kinds to lines and pronoun forms', () => {
    expect(salutationLine('pan')).toBe('Szanowny Panie,')
    expect(salutationLine('pani')).toBe('Szanowna Pani,')
    expect(salutationLine('panstwo')).toBe('Szanowni Państwo,')
    expect(pronounForm('pan').genitive).toBe('Pana')
    expect(pronounForm('pani').genitive).toBe('Pani')
    expect(pronounForm('panstwo').genitive).toBe('Państwa')
  })
})

describe('buildTemplateParagraphs', () => {
  const keyPhrases: Record<LetterType, string> = {
    answer: 'w odpowiedzi na wystosowany przez Panią wniosek o udostępnienie informacji publicznej dotyczący programu wymiany pieców',
    extension_notice: 'orientacyjny termin udzielenia odpowiedzi: 30 grudnia 2026 r.',
    clarification_request: 'Proszę o przesłanie doprecyzowania w terminie 7 dni od otrzymania niniejszego pisma. Po upływie tego terminu wniosek zostanie pozostawiony bez rozpoznania',
    not_held_referral: 'winien się zwrócić do Zarządu Fikcyjnych Dróg w Miastowie jako właściwego dysponenta danych. Poniżej zamieszczam dane do kontaktu:',
    bip_referral: 'https://bip.example.org/informacje',
    refusal_decision_draft: 'PROJEKT — wymaga podpisu osoby upoważnionej',
    left_unprocessed: 'wniosek pozostaje bez rozpoznania',
    no_statistics: 'Urząd Miasta Bydgoszczy nie prowadzi statystyk, które umożliwiłyby udzielenie odpowiedzi',
  }

  it.each(LETTER_TYPES.map((type) => [type]))('renders the key phrase for %s', (type) => {
    const paragraphs = buildTemplateParagraphs(type, BASE_CONTEXT)
    const text = renderLetterText(paragraphs, BASE_CONTEXT, { letterType: type })
    expect(text).toContain(keyPhrases[type])
    expect(text).toContain('URZĄD MIASTA BYDGOSZCZY')
    expect(text).toContain('Bydgoszcz, dnia 21 listopada 2026 r.')
    expect(text).toContain('BKS.IV.1431.901.2026')
    paragraphs.forEach((paragraph, index) => {
      expect(paragraph.id).toBe(`${paragraph.kind}-${index}`)
      expect(paragraph.contentHash).toBe(contentHash(paragraph.text))
    })
  })

  it('emits empty gap point paragraphs for answer letters', () => {
    const paragraphs = buildTemplateParagraphs('answer', BASE_CONTEXT)
    const points = paragraphs.filter((paragraph) => paragraph.kind === 'point')
    expect(points.map((paragraph) => paragraph.pointPosition)).toEqual([1, 2, 3])
    points.forEach((paragraph) => {
      expect(paragraph.text).toBe('')
      expect(paragraph.flags).toEqual(['gap'])
    })
    expect(paragraphs[0].text).toContain(
      'komórki merytoryczne, tj. Wydział Gospodarki Komunalnej oraz Wydział Edukacji i Sportu Urzędu Miasta Bydgoszczy',
    )
  })

  it('cites art. 4 ust. 3 in not-held referrals and the title in clarification requests', () => {
    const referral = renderLetterText(buildTemplateParagraphs('not_held_referral', BASE_CONTEXT), BASE_CONTEXT)
    expect(referral).toContain(
      'art. 4 ust. 3 ustawy z dnia 6 września 2001 r. o dostępie do informacji publicznej (t.j. Dz. U. z 2022 r. poz. 902)',
    )
    const clarification = renderLetterText(buildTemplateParagraphs('clarification_request', BASE_CONTEXT), BASE_CONTEXT, {
      letterType: 'clarification_request',
    })
    expect(clarification).toContain('WEZWANIE DO DOPRECYZOWANIA ZAKRESU OTRZYMANEGO WNIOSKU')
    expect(clarification).toContain('1. „Ile zezwoleń wydano w 2025 r.?”')
  })
})

describe('draftFromReplies', () => {
  it('fills Ad 1..3 from two department replies with sources', () => {
    const paragraphs = draftFromReplies('answer', BASE_CONTEXT, [REPLY_COMMUNAL, REPLY_EDUCATION])
    expect(paragraphs.map((paragraph) => paragraph.id)).toEqual(['intro-0', 'point-1', 'point-2', 'point-3', 'closing-4'])
    expect(pointParagraph(paragraphs, 1).text).toBe('Ad 1\nW 2025 r. wydano 412 zezwoleń.')
    expect(pointParagraph(paragraphs, 2).text).toBe('Ad 2\nŁączny koszt programu wyniósł 1132500,00 zł.')
    expect(pointParagraph(paragraphs, 3).text).toBe('Ad 3\nW roku szkolnym 2025/2026 do szkół uczęszczało 5697 uczniów.')
    expect(pointParagraph(paragraphs, 1).sources).toEqual([{ attachmentId: 'att-communal', quote: 'W 2025 r. wydano 412 zezwoleń.' }])
    expect(pointParagraph(paragraphs, 3).sources[0].attachmentId).toBe('att-education')
    paragraphs.forEach((paragraph) => expect(paragraph.flags).toEqual([]))
    const grounded = checkGrounding(paragraphs, BASE_CONTEXT, SOURCES)
    grounded.forEach((paragraph) => expect(paragraph.flags).toEqual([]))
  })

  it('flags a point without any reply as a gap', () => {
    const paragraphs = draftFromReplies('answer', BASE_CONTEXT, [REPLY_COMMUNAL])
    const third = pointParagraph(paragraphs, 3)
    expect(third.text).toBe('')
    expect(third.flags).toEqual(['gap'])
    expect(paragraphs[0].text).toContain('komórkę merytoryczną, tj. Wydział Gospodarki Komunalnej Urzędu Miasta Bydgoszczy')
    const grounded = checkGrounding(paragraphs, BASE_CONTEXT, SOURCES)
    expect(pointParagraph(grounded, 3).flags).toEqual(['gap'])
  })

  it('keeps a "nie prowadzi statystyk" sentence from a reply', () => {
    const reply: ReplyText = {
      attachmentId: 'att-stats',
      departmentName: 'Wydział Spraw Obywatelskich',
      pointPositions: [1],
      text: 'Szanowni Państwo,\nWydział nie prowadzi statystyk w tym zakresie. Prosimy o kontakt.\nZ poważaniem',
    }
    const ctx: LetterContext = { ...BASE_CONTEXT, points: [{ position: 1, text: 'Ile punktów przybyło?' }] }
    const paragraphs = draftFromReplies('answer', ctx, [reply])
    expect(pointParagraph(paragraphs, 1).text).toBe('Ad 1\nWydział nie prowadzi statystyk w tym zakresie.')
  })
})

describe('draftFromReplies with a reply that restates the request', () => {
  const reply: ReplyText = {
    attachmentId: 'att-restated',
    departmentName: 'Wydział Inwestycji Miasta',
    pointPositions: [1],
    text: [
      'URZĄD MIASTA BYDGOSZCZY',
      'Biuro Komunikacji Społecznej',
      'Bydgoszcz, 10 października 2026 r.',
      'Szanowni Państwo,',
      'w odpowiedzi na wniosek o udostępnienie informacji publicznej dotyczącej inwestycji pn. „Budowa hali sportowej',
      'przy ul. Testowej 5” w następującym zakresie:',
      'Proszę o informację czy Pan Jan Testowy pełnił funkcję kierownika robót, na podstawie danych komórki merytorycznej informuję, że Pan Jan Testowy wprowadzony do umowy aneksem nr 3 w trakcie budowy hali przy',
      'ul. Testowej 5 w Bydgoszczy pełnił funkcję kierownika robót elektrycznych w okresie 01.03.2021 r. do dnia 30.09.2021',
      'r. (odbiór końcowy robót).',
      'Łączę wyrazy szacunku,',
      'Biuro Komunikacji Społecznej',
      '85-102 Bydgoszcz, ul. Jezuicka 1',
    ].join('\n'),
  }
  const ctx: LetterContext = { ...BASE_CONTEXT, points: [{ position: 1, text: 'Czy Pan Jan Testowy pełnił funkcję kierownika robót?' }] }

  it('keeps only the answer, so the person named in the question appears once', () => {
    const text = pointParagraph(draftFromReplies('answer', ctx, [reply]), 1).text
    expect(text.match(/Jan Testowy/g)).toHaveLength(1)
    expect(text).not.toContain('Proszę o informację')
    expect(text).toContain('ul. Testowej 5 w Bydgoszczy pełnił funkcję kierownika robót elektrycznych w okresie 01.03.2021 r. do dnia 30.09.2021 r.')
  })
})

describe('checkGrounding', () => {
  const drafted = draftFromReplies('answer', BASE_CONTEXT, [REPLY_COMMUNAL, REPLY_EDUCATION])

  it('flags an edited number as number_mismatch and lists the token', () => {
    const edited = drafted.map((paragraph) =>
      paragraph.pointPosition === 1 ? withText(paragraph, 'Ad 1\nW 2025 r. wydano 421 zezwoleń.') : paragraph,
    )
    const grounded = checkGrounding(edited, BASE_CONTEXT, SOURCES)
    const first = pointParagraph(grounded, 1)
    expect(first.flags).toEqual(['number_mismatch'])
    expect(first.mismatchTokens).toEqual(['421'])
    expect(first.contentHash).toBe(contentHash('Ad 1\nW 2025 r. wydano 421 zezwoleń.'))
  })

  it('treats space-grouped and plain amounts as equal', () => {
    expect(normalizeFactToken('1 132 500,00 zł')).toBe(normalizeFactToken('1132500,00 zł'))
    expect(normalizeFactToken('3.143.761,14 zł')).toBe('3143761,14')
    expect(normalizeFactToken('30 kwietnia 2027')).toBe(normalizeFactToken('30.04.2027'))
    const edited = drafted.map((paragraph) =>
      paragraph.pointPosition === 2 ? withText(paragraph, 'Ad 2\nŁączny koszt programu wyniósł 1 132 500,00 zł.') : paragraph,
    )
    expect(pointParagraph(checkGrounding(edited, BASE_CONTEXT, SOURCES), 2).flags).toEqual([])
    const wrong = drafted.map((paragraph) =>
      paragraph.pointPosition === 2 ? withText(paragraph, 'Ad 2\nŁączny koszt programu wyniósł 1 232 500,00 zł.') : paragraph,
    )
    expect(pointParagraph(checkGrounding(wrong, BASE_CONTEXT, SOURCES), 2).mismatchTokens).toEqual(['1 232 500,00 zł'])
  })

  it('extracts amounts, dates and case numbers while ignoring Ad markers', () => {
    const tokens = extractFactTokens(
      'Ad 4 Umowa 18/WGK/2026 (znak BKS.IV.1431.307.2025) z dnia 30.12.2019 r. na kwotę 3.143.761,14 zł obowiązuje do 30 kwietnia 2027 r.; zadeklarowano 5697 osób.',
    )
    expect(tokens).toEqual(['18/WGK/2026', 'BKS.IV.1431.307.2025', '30.12.2019', '3.143.761,14 zł', '30 kwietnia 2027', '5697'])
  })

  it('marks paragraphs citing unknown attachments as unsupported and inserts missing points', () => {
    const paragraphs = drafted
      .filter((paragraph) => paragraph.pointPosition !== 3)
      .map((paragraph) =>
        paragraph.pointPosition === 1 ? { ...paragraph, sources: [{ attachmentId: 'att-unknown', quote: 'x' }] } : paragraph,
      )
    const grounded = checkGrounding(paragraphs, BASE_CONTEXT, SOURCES)
    expect(pointParagraph(grounded, 1).flags).toEqual(['unsupported'])
    expect(pointParagraph(grounded, 3).flags).toEqual(['gap'])
    expect(grounded[grounded.length - 1].kind).toBe('closing')
  })

  it('keeps assistant_only, ignores case number and letter dates, and resets stale confirmations', () => {
    const note: DraftParagraph = {
      id: 'note-9',
      kind: 'note',
      text: 'Sprawa BKS.IV.1431.901.2026 z 21.11.2026 dotyczy 412 zezwoleń.',
      contentHash: 'stale',
      sources: [{ attachmentId: 'att-communal', quote: 'Ad 1' }],
      flags: ['assistant_only'],
      confirmedBy: 'officer-1',
    }
    const [checked] = checkGrounding([note], { ...BASE_CONTEXT, points: [] }, SOURCES)
    expect(checked.flags).toEqual(['assistant_only'])
    expect(checked.confirmedBy).toBeNull()
  })
})

describe('render', () => {
  const paragraphs = draftFromReplies('answer', BASE_CONTEXT, [REPLY_COMMUNAL, REPLY_EDUCATION])

  it('escapes HTML and applies the redact callback', () => {
    const malicious = paragraphs.map((paragraph) =>
      paragraph.pointPosition === 1 ? withText(paragraph, 'Ad 1\n<script>alert("x")</script> Jan Kowalski') : paragraph,
    )
    const html = renderLetterHtml(malicious, { ...BASE_CONTEXT, requesterName: '<b>Anna</b>' }, {
      attachments: ['Informacja_901.pdf', 'Umowa <1>.pdf'],
      redact: (paragraph) => paragraph.text.replace('Jan Kowalski', '[zanonimizowano]'),
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
    expect(html).toContain('[zanonimizowano]')
    expect(html).not.toContain('Jan Kowalski')
    expect(html).toContain('&lt;b&gt;Anna&lt;/b&gt;')
    expect(html).toContain('Załączniki:')
    expect(html).toContain('<li>Umowa &lt;1&gt;.pdf</li>')
    expect(html).toContain('Szanowna Pani,')
    expect(html).toContain('Łączę wyrazy szacunku,')
  })

  it('renders plain text with the closing block', () => {
    const text = renderLetterText(paragraphs, BASE_CONTEXT, { attachments: ['Informacja_901.pdf'] })
    expect(text).toContain('Szanowna Pani,\nw odpowiedzi na wystosowany przez Panią wniosek')
    expect(text).toContain('Ad 2\nŁączny koszt programu wyniósł 1132500,00 zł.')
    expect(text).toContain('Załącznik: Informacja_901.pdf')
    expect(text).toContain('Łączę wyrazy szacunku,\nBiuro Komunikacji Społecznej\nUrząd Miasta Bydgoszczy\ne-mail: bip@um.bydgoszcz.pl')
    expect(text).toContain('85-102 Bydgoszcz, ul. Jezuicka 1')
  })
})

describe('internal notes', () => {
  it('keeps assistant notes for the officer out of the rendered letter', () => {
    const paragraphs: DraftParagraph[] = [
      ...buildTemplateParagraphs('answer', BASE_CONTEXT),
      { id: 'note-1', kind: 'note', text: 'Uwaga dla urzędnika: pominięto dane osobowe.', contentHash: '', sources: [], flags: [] },
    ]
    const text = renderLetterText(paragraphs, BASE_CONTEXT, { letterType: 'answer' })
    const html = renderLetterHtml(paragraphs, BASE_CONTEXT, { letterType: 'answer' })
    expect(text).not.toContain('Uwaga dla urzędnika')
    expect(html).not.toContain('Uwaga dla urzędnika')
  })
})

