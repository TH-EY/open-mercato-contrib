import {
  PII_CATEGORIES,
  detectPiiByRules,
  isValidNip,
  isValidPesel,
  isValidPolishIban,
  mergeSpans,
  type PiiCategory,
  type PiiSpan,
} from '../rules'

function hits(text: string, category: PiiCategory, options?: Parameters<typeof detectPiiByRules>[1]): string[] {
  return detectPiiByRules(text, options)
    .filter((span) => span.category === category)
    .map((span) => span.text)
}

describe('PII validators', () => {
  it('accepts a valid PESEL and rejects a broken checksum', () => {
    expect(isValidPesel('44051401359')).toBe(true)
    expect(isValidPesel('44051401358')).toBe(false)
    expect(isValidPesel('4405140135')).toBe(false)
    expect(isValidPesel('00000000000')).toBe(false)
  })

  it('accepts a valid NIP with or without dashes and rejects a broken checksum', () => {
    expect(isValidNip('5260250274')).toBe(true)
    expect(isValidNip('526-025-02-74')).toBe(true)
    expect(isValidNip('5260250275')).toBe(false)
  })

  it('validates Polish IBAN check digits', () => {
    expect(isValidPolishIban('PL61 1090 1014 0000 0712 1981 2874')).toBe(true)
    expect(isValidPolishIban('62109010140000071219812874')).toBe(false)
  })

  it('exposes the category list', () => {
    expect(PII_CATEGORIES).toContain('private_person_name')
    expect(PII_CATEGORIES).toHaveLength(16)
  })
})

describe('detectPiiByRules', () => {
  it('flags a valid PESEL but not an invalid one or a longer digit run', () => {
    expect(hits('PESEL: 44051401359.', 'pesel')).toEqual(['44051401359'])
    expect(hits('PESEL: 44051401358.', 'pesel')).toEqual([])
    expect(hits('Nr 1440514013591 zamówienia', 'pesel')).toEqual([])
  })

  it('flags a NIP only after the NIP marker', () => {
    const spans = detectPiiByRules('Wnioskodawca, NIP: 5260250274, prosi o informację.')
    const nip = spans.find((span) => span.category === 'private_nip')
    expect(nip?.text).toBe('5260250274')
    expect(nip?.confidence).toBe(0.6)
    expect(hits('Numer 5260250274 w rejestrze.', 'private_nip')).toEqual([])
  })

  it('flags ID documents with context-dependent confidence', () => {
    const withContext = detectPiiByRules('legitymujący się dowodem osobistym ABC 123456')
    expect(withContext.find((span) => span.category === 'id_document')).toMatchObject({ text: 'ABC 123456', confidence: 0.8 })
    const bare = detectPiiByRules('kod ABC123456')
    expect(bare.find((span) => span.category === 'id_document')).toMatchObject({ text: 'ABC123456', confidence: 0.5 })
    expect(hits('paszport nr AB1234567', 'id_document')).toEqual(['AB1234567'])
    expect(hits('zamówienie AB1234567', 'id_document')).toEqual([])
  })

  it('flags bank accounts in grouped and IBAN form', () => {
    expect(hits('Konto: PL61 1090 1014 0000 0712 1981 2874.', 'bank_account')).toEqual([
      'PL61 1090 1014 0000 0712 1981 2874',
    ])
    expect(hits('Konto 61109010140000071219812874', 'bank_account')).toEqual(['61109010140000071219812874'])
  })

  it('flags a private phone but not the office number or amounts', () => {
    expect(hits('Proszę dzwonić: 600 100 200.', 'private_phone')).toEqual(['600 100 200'])
    expect(hits('tel. +48 600-100-200', 'private_phone')).toEqual(['+48 600-100-200'])
    expect(hits('tel. (52) 123 45 67', 'private_phone')).toEqual(['(52) 123 45 67'])
    expect(hits('Kontakt z urzędem: (52) 58 58 365.', 'private_phone')).toEqual([])
    expect(hits('Kontakt z urzędem: 52 58 58 365.', 'private_phone')).toEqual([])
    expect(hits('Budżet wynosi 100 000 000 zł.', 'private_phone')).toEqual([])
  })

  it('flags private emails but not office domains', () => {
    expect(hits('Odpowiedź na jan.kowalski@example.com proszę.', 'private_email')).toEqual(['jan.kowalski@example.com'])
    expect(hits('Kontakt: bip@um.bydgoszcz.pl', 'private_email')).toEqual([])
    expect(hits('Kontakt: sekretariat@zdmikp.bydgoszcz.pl', 'private_email')).toEqual([])
  })

  it('flags a land-register number', () => {
    expect(hits('księga wieczysta nr BY1B/00012345/6 prowadzona', 'property_register_number')).toEqual([
      'BY1B/00012345/6',
    ])
  })

  it('flags vehicle registrations only with a vehicle marker', () => {
    expect(hits('pojazd o numerze rejestracyjnym CB 12345 został', 'vehicle_registration')).toEqual(['CB 12345'])
    expect(hits('symbol CB12345 w katalogu', 'vehicle_registration')).toEqual([])
  })

  it('flags signature tokens', () => {
    expect(hits('Z poważaniem\n/podpis/', 'signature')).toEqual(['/podpis/'])
    expect(hits('(podpis) oraz podpis nieczytelny', 'signature')).toEqual(['(podpis)', 'podpis nieczytelny'])
  })

  it('flags an address after a residence marker', () => {
    const text = 'Jan Testowy, zam. ul. Gdańska 14/3, 85-001 Bydgoszcz, wnosi o udostępnienie.'
    expect(hits(text, 'private_address')).toEqual(['ul. Gdańska 14/3, 85-001 Bydgoszcz'])
  })

  it('does not flag an office address without a residence marker', () => {
    expect(hits('Urząd Miasta Bydgoszczy, ul. Jezuicka 1, 85-102 Bydgoszcz', 'private_address')).toEqual([])
  })

  it('flags a bare postal line following a residence address line', () => {
    const text = 'adres zamieszkania: ul. Pod lasem 4\n85-001 Bydgoszcz\nTreść'
    expect(hits(text, 'private_address')).toEqual(['ul. Pod lasem 4', '85-001 Bydgoszcz'])
  })

  it('flags the name and address in a letter header block', () => {
    const text = 'Jerzy Testowy\nul. Pod lasem 4\n85-001 Bydgoszcz\n\nSzanowni Państwo'
    expect(hits(text, 'private_person_name')).toEqual(['Jerzy Testowy'])
    expect(hits(text, 'private_address')).toEqual(['ul. Pod lasem 4', '85-001 Bydgoszcz'])
  })

  it('skips the header block when the name is in keepNames', () => {
    const text = 'Jerzy Testowy\nul. Pod lasem 4\n85-001 Bydgoszcz\n\nSzanowni Państwo'
    expect(detectPiiByRules(text, { keepNames: ['Jerzy Testowy'] })).toEqual([])
  })

  it('flags a signature name after a pipe', () => {
    expect(hits('Dziękuję za pomoc.\nPozdrawiam | Ewa Testowa', 'private_person_name')).toEqual(['Ewa Testowa'])
  })

  it('flags an initial-form signature after a closing phrase', () => {
    expect(hits('Treść pisma.\n-- \nZ wyrazami szacunku\nE. Testowa', 'private_person_name')).toEqual(['E. Testowa'])
  })

  it('does not flag an official preceded by a function marker', () => {
    expect(hits('Z poważaniem\ninsp. Joanna Kwiatkowska', 'private_person_name')).toEqual([])
    expect(hits('Sprawę prowadzi insp. Joanna Kwiatkowska.', 'private_person_name')).toEqual([])
  })

  it('does not flag honorifics followed by a function word', () => {
    expect(hits('Pan Prezydent podpisał zarządzenie.', 'private_person_name')).toEqual([])
    expect(hits('Pismo do Pana Prezydenta Miasta.', 'private_person_name')).toEqual([])
    expect(hits('Pani Dyrektor odpowiedziała.', 'private_person_name')).toEqual([])
  })

  it('flags a private person after an honorific', () => {
    expect(hits('Pan Marek Olszewski pełnił funkcję społecznie.', 'private_person_name')).toEqual(['Marek Olszewski'])
  })

  it('does not flag listed public officials', () => {
    const text = 'Pan Marek Olszewski pełnił funkcję.'
    expect(hits(text, 'private_person_name', { publicOfficials: ['Marek Olszewski'] })).toEqual([])
  })

  it('returns spans whose text matches the source offsets', () => {
    const text = 'Pan Marek Olszewski, tel. 600 100 200, e-mail marek@example.com, PESEL 44051401359'
    for (const span of detectPiiByRules(text)) {
      expect(text.slice(span.start, span.end)).toBe(span.text)
      expect(span.detector).toBe('rule')
    }
  })
})

describe('mergeSpans', () => {
  const base = (overrides: Partial<PiiSpan>): PiiSpan => ({
    start: 0,
    end: 1,
    category: 'other',
    detector: 'ai',
    confidence: 0.5,
    text: '',
    ...overrides,
  })

  it('unions overlapping spans, prefers rule categories and keeps the max confidence', () => {
    const text = 'abcdefghij'
    const merged = mergeSpans(
      [
        base({ start: 5, end: 8, category: 'private_person_name', detector: 'ai', confidence: 0.9 }),
        base({ start: 2, end: 6, category: 'private_phone', detector: 'rule', confidence: 0.6 }),
        base({ start: 9, end: 10, category: 'other', detector: 'manual' }),
      ],
      text,
    )
    expect(merged).toEqual([
      { start: 2, end: 8, category: 'private_phone', detector: 'rule', confidence: 0.9, text: 'cdefgh' },
      { start: 9, end: 10, category: 'other', detector: 'manual', confidence: 0.5, text: 'j' },
    ])
  })

  it('drops invalid spans', () => {
    expect(mergeSpans([base({ start: 4, end: 2 }), base({ start: 0, end: 50 })], 'short')).toEqual([])
  })
})
