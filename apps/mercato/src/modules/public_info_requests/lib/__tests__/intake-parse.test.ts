import { findLetterDate, parsePolishDate, parseRequestText } from '../intake/parse'

const NUMBERED_REQUEST = [
  'Bydgoszcz, 19 listopada 2026 r.',
  '',
  'Wniosek o udostępnienie informacji publicznej',
  '',
  'Szanowni Państwo,',
  '',
  'na podstawie art. 2 ust. 1 ustawy z dnia 6 września 2001 r. o dostępie do informacji publicznej (Dz. U. z 2022 r. poz. 902 ze zm.) wnoszę o udostępnienie informacji dotyczącej utrzymania parku przy ul. Testowej zawartej w umowie z dnia 03.02.2020 r. W szczególności proszę o:',
  '',
  '1. kopię umowy na utrzymanie parku wraz z aneksami,',
  '2. wysokość wynagrodzenia wypłaconego wykonawcy w 2025 r.,',
  '3. informację, ile drzew wycięto w parku w latach 2024–2025',
  '   wraz z podaniem przyczyn wycinki.',
  '',
  'Odpowiedź proszę przesłać na adres e-mail: jan.probny@example.org',
  '',
  'Z poważaniem',
  'Jan Próbny',
].join('\n')

const STREET_LIST_REQUEST = [
  'Szanowni Państwo!',
  'Zwracam się z uprzejmą prośbą o udostępnienie informacji publicznej w zakresie liczby mieszkańców zgłoszonych w deklaracjach o wysokości opłaty za gospodarowanie odpadami dla następujących ulic:',
  'Akacjowa,',
  'Brzozowa,',
  'Cisowa',
  'Dębowa,',
  'Jesionowa od nr 2 do 40,',
  'Klonowa,',
  'Lipowa,',
  'Modrzewiowa,',
  'Z wyrazami szacunku',
  'ks.',
  'Proboszcz Parafii św. Testowego w Przykładowie',
].join('\n')

const SIGNATURE_REQUEST = [
  'Witam,',
  'W trybie dostępu do informacji publicznej proszę o aktualne zestawienie liczby dzieci w przedszkolach miejskich.',
  'Jeżeli to możliwe, proszę też o podanie liczby oddziałów integracyjnych.',
  '-- ',
  'Pozdrawiam | Ewa Testowa',
].join('\n')

describe('public_info_requests intake parser', () => {
  it('splits numbered lists into points and drops legal boilerplate', () => {
    const result = parseRequestText(NUMBERED_REQUEST)
    expect(result.points).toHaveLength(3)
    expect(result.points[0]).toBe('Kopię umowy na utrzymanie parku wraz z aneksami')
    expect(result.points[2]).toContain('wraz z podaniem przyczyn wycinki')
    expect(result.points.join(' ')).not.toMatch(/art\. 2 ust\. 1/)
    expect(result.letterDate).toBe('2026-11-19')
    expect(result.requesterName).toBe('Jan Próbny')
    expect(result.requesterKind).toBe('person')
    expect(result.requesterContact).toBe('jan.probny@example.org')
    expect(result.deliveryForm).toBe('email')
    expect(result.subjectSummary.length).toBeLessThanOrEqual(120)
    expect(result.subjectSummary).toMatch(/^Utrzymanie parku przy ul\. Testowej/)
  })

  it('keeps a street list as one point instead of one point per street', () => {
    const result = parseRequestText(STREET_LIST_REQUEST)
    expect(result.points).toHaveLength(1)
    expect(result.points[0]).toContain('liczby mieszkańców')
    expect(result.points[0]).toContain('Akacjowa, Brzozowa, Cisowa, Dębowa')
    expect(result.points[0]).toContain('Modrzewiowa')
    expect(result.requesterKind).toBe('organisation')
    expect(result.requesterName).toBe('ks. Proboszcz Parafii św. Testowego w Przykładowie')
    expect(result.subjectSummary).toMatch(/^Liczba mieszkańców/)
  })

  it('extracts the requester from a "Pozdrawiam | name" signature and splits request sentences', () => {
    const result = parseRequestText(SIGNATURE_REQUEST, { channel: 'email', senderEmail: 'ewa.testowa@example.org' })
    expect(result.requesterName).toBe('Ewa Testowa')
    expect(result.requesterKind).toBe('person')
    expect(result.points).toEqual([
      'Proszę o aktualne zestawienie liczby dzieci w przedszkolach miejskich.',
      'Jeżeli to możliwe, proszę też o podanie liczby oddziałów integracyjnych.',
    ])
    expect(result.subjectSummary).toBe('Aktualne zestawienie liczby dzieci w przedszkolach miejskich')
    expect(result.deliveryForm).toBe('email')
    expect(result.requesterContact).toBe('ewa.testowa@example.org')
  })

  it('detects an association named in the body as an organisation requester', () => {
    const text = [
      'Wniosek o udostępnienie informacji publicznej',
      'Fundacja Zielone Podwórka, organizacja pożytku publicznego, zwraca się z uprzejmą prośbą o udzielenie informacji publicznej na temat sposobu realizacji programu opieki nad bezdomnymi zwierzętami.',
      'Prosimy o przysłanie odpowiedzi pocztą elektroniczną.',
      '1. ile psów przyjęto do schroniska w 2025 r.?',
      '2. jaki był koszt opieki weterynaryjnej w 2025 r.?',
    ].join('\n')
    const result = parseRequestText(text)
    expect(result.requesterName).toBe('Fundacja Zielone Podwórka')
    expect(result.requesterKind).toBe('organisation')
    expect(result.deliveryForm).toBe('email')
    expect(result.points).toHaveLength(2)
    expect(result.subjectSummary).toMatch(/^Sposób realizacji programu opieki nad bezdomnymi zwierzętami/)
  })

  it('treats a trailing company name as an organisation and keeps personal names out of the subject', () => {
    const text = [
      'Proszę o informację, czy Pan Adam Fikcyjny pełnił funkcję kierownika robót na budowie hali sportowej przy ul. Przykładowej 5.',
      '',
      'Przykładbud Sp. z o.o.',
    ].join('\n')
    const result = parseRequestText(text)
    expect(result.requesterName).toBe('Przykładbud Sp. z o.o.')
    expect(result.requesterKind).toBe('organisation')
    expect(result.points).toHaveLength(1)
    expect(result.subjectSummary).not.toMatch(/Adam|Fikcyjny/)
    expect(result.deliveryForm).toBe('post')
  })

  it('recognises media and councillor requesters', () => {
    const media = parseRequestText('Proszę o liczbę mandatów wystawionych przez straż miejską w 2025 r.\nZ poważaniem\nAnna Przykładowa\nRedakcja Tygodnika Testowego')
    expect(media.requesterKind).toBe('media')
    expect(media.requesterName).toBe('Anna Przykładowa')
    const councillor = parseRequestText('Proszę o wykaz remontowanych chodników.\nZ wyrazami szacunku\nTomasz Testowy\nRadny Miasta')
    expect(councillor.requesterKind).toBe('councillor')
  })

  it('resolves the delivery form from text and channel hints', () => {
    expect(parseRequestText('Proszę o odpowiedź przez platformę ePUAP. Ile ławek ustawiono w parku?').deliveryForm).toBe('epuap')
    expect(parseRequestText('Proszę o umożliwienie wglądu w dokumentację przetargu.').deliveryForm).toBe('inspection')
    expect(parseRequestText('Ile ławek ustawiono w parku?', { channel: 'email' }).deliveryForm).toBe('email')
    expect(parseRequestText('Ile ławek ustawiono w parku?', { channel: 'post' }).deliveryForm).toBe('post')
    expect(parseRequestText('Ile ławek ustawiono w parku?\nKontakt: tel. 600 100 200').requesterContact).toBe('600 100 200')
  })

  it('parses letter dates and case numbers without picking up contract dates', () => {
    expect(parsePolishDate('09.01.2026')).toBe('2026-01-09')
    expect(parsePolishDate('2026-01-09')).toBe('2026-01-09')
    expect(parsePolishDate('Bydgoszcz, 3 marca 2026 r.')).toBe('2026-03-03')
    expect(parsePolishDate('31.02.2026')).toBeNull()
    expect(parseRequestText('09.01.2026\nProszę o kopię umowy z dnia 12.05.2019 r.').letterDate).toBe('2026-01-09')
    expect(parseRequestText('Proszę o kopię umowy z dnia 12.05.2019 r.').letterDate).toBeNull()
    const withCase = parseRequestText('Dotyczy sprawy BKS.IV.1431.42.2026\nProszę o uzupełnienie odpowiedzi.')
    expect(withCase.caseNumber).toBe('BKS.IV.1431.42.2026')
  })

  it('falls back to the whole body as a single point when there is no explicit request', () => {
    const result = parseRequestText('Informacja o stanie technicznym mostu na ulicy Testowej')
    expect(result.points).toEqual(['Informacja o stanie technicznym mostu na ulicy Testowej'])
  })
})

describe('findLetterDate', () => {
  it('prefers the place-and-date line over dates cited in the body', () => {
    const answer = 'URZĄD MIASTA BYDGOSZCZY Biuro Komunikacji Społecznej Dz.U. z 20.12.2019 r. poz. 1 Bydgoszcz, 25 września 2026 r. BKS.IV.1431.590.2026'
    expect(findLetterDate(answer)).toBe('2026-09-25')
  })

  it('handles the "dnia" form and falls back to the first date', () => {
    expect(findLetterDate('ustawy z dnia 6 września 2001 r. Bydgoszcz, dnia 10 sierpnia 2026 r.')).toBe('2026-08-10')
    expect(findLetterDate('pismo z 03.02.2026 r.')).toBe('2026-02-03')
  })
})

describe('requester recognition', () => {
  const flattened590 = 'WNIOSEK O UDOSTĘPNIENIE INFORMACJI PUBLICZNEJ Na podstawie art. 2 ust. 1 i art. 10 ust. 1 ustawy z dnia 6 września 2001 r. o dostępie do informacji publicznej (Dz. U. z 2016 r. poz. 1764 ze zm.) proszę o udostępnienie informacji dotyczącej Państwa inwestycji pn. „Budowa kompleksu Astoria” w następującym zakresie: 1. Proszę o informację czy Pan Adam Wiśniewski pełnił funkcję Kierownika robót teletechnicznych ze wskazaniem terminu pełnienia funkcji. Budowlanka S.A.'

  it('finds a company with its legal form in text without line breaks', () => {
    const result = parseRequestText(flattened590, { channel: 'email' })
    expect(result.requesterName).toBe('Budowlanka S.A.')
    expect(result.requesterKind).toBe('organisation')
  })

  it('does not take the person asked about for the requester', () => {
    const result = parseRequestText(flattened590, { channel: 'email' })
    expect(result.requesterName).not.toContain('Wiśniewski')
  })

  it('keeps multi-word company names and limited-liability forms', () => {
    const result = parseRequestText('Proszę o udostępnienie umowy nr 41/2025 zawartej z miastem. Z poważaniem, Przedsiębiorstwo Usług Komunalnych Eko sp. z o.o.', { channel: 'email' })
    expect(result.requesterName).toBe('Przedsiębiorstwo Usług Komunalnych Eko sp. z o.o.')
    expect(result.requesterKind).toBe('organisation')
  })
})

