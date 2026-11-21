import {
  DEFAULT_REDACTION_REPLACEMENT,
  anonymizeForArchive,
  applyRedactions,
  sha256,
} from '../redact'

describe('applyRedactions', () => {
  it('replaces ranges and merges overlaps', () => {
    const text = 'Jan Testowy mieszka tutaj'
    expect(applyRedactions(text, [{ start: 4, end: 11 }, { start: 0, end: 6 }], '[X]')).toBe('[X] mieszka tutaj')
  })

  it('uses the default replacement and ignores invalid ranges', () => {
    const text = 'abc def'
    expect(applyRedactions(text, [{ start: 4, end: 7 }, { start: 5, end: 2 }])).toBe(
      `abc ${DEFAULT_REDACTION_REPLACEMENT}`,
    )
  })

  it('keeps separate ranges independent and clamps out-of-bound offsets', () => {
    expect(applyRedactions('aa bb cc', [{ start: 6, end: 99 }, { start: 0, end: 2 }], '#')).toBe('# bb #')
  })
})

describe('sha256', () => {
  it('returns a stable hex digest', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('anonymizeForArchive', () => {
  it('removes requester name variants and phone numbers', () => {
    const text = [
      'Ewa Testowa zwraca się z wnioskiem.',
      'Wniosek pani Testowej dotyczy drogi.',
      'Kontakt: 600 100 200.',
      'Pozdrawiam | E. Testowa',
      'Pani EWA TESTOWA ponownie.',
    ].join('\n')
    const result = anonymizeForArchive(text, { name: 'Ewa Testowa', contact: '600100200' })
    expect(result).not.toMatch(/Testow/i)
    expect(result).not.toMatch(/Ewa/i)
    expect(result).not.toContain('E.')
    expect(result).not.toContain('600 100 200')
    expect(result).toContain(DEFAULT_REDACTION_REPLACEMENT)
    expect(result.split('\n')[0]).toBe(`${DEFAULT_REDACTION_REPLACEMENT} zwraca się z wnioskiem.`)
  })

  it('removes the requester address and contact email', () => {
    const text = 'Adres: ul. Pod lasem 4, 85-001 Bydgoszcz. E-mail: ewa@example.org. Urząd w Bydgoszczy.'
    const result = anonymizeForArchive(text, {
      name: 'Ewa Testowa',
      address: 'ul. Pod lasem 4\n85-001 Bydgoszcz',
      contact: 'ewa@example.org',
    })
    expect(result).not.toContain('Pod lasem')
    expect(result).not.toContain('85-001')
    expect(result).not.toContain('ewa@example.org')
    expect(result).toContain('Urząd w Bydgoszczy.')
  })

  it('returns text unchanged when nothing is detected', () => {
    expect(anonymizeForArchive('Prosimy o informację o budżecie.')).toBe(
      'Prosimy o informację o budżecie.',
    )
  })
})
