import { proposeRoutingByKeywords } from '../routing/keywords'
import type { DepartmentLike, RoutingPoint } from '../routing/keywords'
import { DEPARTMENT_SEEDS } from '../seed/departments'
import { normalizePolish, overlapScore, stemPolish, tokenizePolish } from '../text'

const departments: DepartmentLike[] = DEPARTMENT_SEEDS.map((seed) => ({ ...seed, id: seed.symbol }))

function toPoints(texts: string[]): RoutingPoint[] {
  return texts.map((text, index) => ({ position: index + 1, text }))
}

function routedIds(texts: string[]): string[] {
  return proposeRoutingByKeywords(toPoints(texts), departments).proposals.map((proposal) => proposal.departmentId)
}

describe('public_info_requests text helpers', () => {
  it('normalises Polish text and strips diacritics', () => {
    expect(normalizePolish('  Łódź   ŻÓŁTA  gęś ')).toBe('lodz zolta ges')
  })

  it('tokenises without stopwords and short words', () => {
    expect(tokenizePolish('Proszę o liczbę uczniów w szkołach podstawowych')).toEqual(['liczbe', 'uczniow', 'szkolach', 'podstawowych'])
  })

  it('stems to the first six normalised characters', () => {
    expect(stemPolish('Zwierzętami')).toBe('zwierz')
    expect(stemPolish('psy')).toBe('psy')
  })

  it('computes Jaccard overlap on stems', () => {
    expect(overlapScore('liczba uczniów w szkołach', 'liczba uczniów w szkołach podstawowych')).toBeCloseTo(0.75, 2)
    expect(overlapScore('drzewa w parku', 'deklaracje odpadowe')).toBe(0)
    expect(overlapScore('', 'cokolwiek')).toBe(0)
  })
})

describe('public_info_requests keyword routing', () => {
  it('routes a pupil-count request to the education department', () => {
    const result = proposeRoutingByKeywords(
      toPoints([
        'Proszę o zestawienie liczby uczniów w poszczególnych szkołach podstawowych.',
        'Proszę też o liczbę uczniów cudzoziemców w tych szkołach.',
      ]),
      departments,
    )
    expect(result.proposals[0].departmentId).toBe('WE')
    expect(result.proposals[0].pointPositions).toEqual([1, 2])
    expect(result.proposals[0].confidence).toBeGreaterThanOrEqual(0.25)
    expect(result.proposals[0].scopeText.startsWith('Prośba o informację w zakresie:')).toBe(true)
    expect(result.proposals[0].sources.some((source) => source.label.startsWith('Słowa kluczowe:'))).toBe(true)
    expect(result.flags.some((flag) => flag.kind === 'separate_entity')).toBe(false)
  })

  it('routes alcohol sale points and waste declarations to the right departments', () => {
    expect(routedIds(['Ile zezwoleń na sprzedaż alkoholu wydano w 2025 r. i ile jest punktów sprzedaży alkoholu?'])[0]).toBe('WSO')
    expect(routedIds(['Ilu mieszkańców wykazano w deklaracjach o wysokości opłaty za gospodarowanie odpadami dla ulicy Testowej?'])[0]).toBe('WGO')
  })

  it('uses the contract code to route to the municipal unit and flags a separate entity', () => {
    const result = proposeRoutingByKeywords(
      toPoints([
        'Kopię umowy nr 45/TT/2021 wraz z aneksami.',
        'Wszystkie faktury wystawione przez wykonawcę w związku z realizacją umowy.',
        'Protokoły odbioru prac wraz z załącznikami.',
      ]),
      departments,
    )
    const top = result.proposals[0]
    expect(top.departmentId).toBe('ZDMiKP')
    expect(top.pointPositions).toEqual([1, 2, 3])
    expect(top.sources.some((source) => source.label.startsWith('Kod umowy TT'))).toBe(true)
    const flag = result.flags.find((entry) => entry.kind === 'separate_entity')
    expect(flag?.departmentId).toBe('ZDMiKP')
    expect(flag?.message).toContain('jest odrębnym podmiotem zobowiązanym')
    expect(flag?.message).toContain('art. 4 ust. 3 UDIP')
  })

  it('routes a removed sculpture to the external monument conservator', () => {
    const result = proposeRoutingByKeywords(
      toPoints([
        'Gdzie jest przechowywana rzeźba, która została zdemontowana z placu Testowego?',
        'Jakie są plany dotyczące jej przyszłości?',
      ]),
      departments,
    )
    expect(result.proposals[0].departmentId).toBe('WKZ')
    expect(result.proposals[0].pointPositions).toEqual([1, 2])
    expect(result.flags).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'separate_entity', departmentId: 'WKZ' })]),
    )
  })

  it('proposes both the green department and the animal shelter for homeless animal care', () => {
    const ids = routedIds([
      'Z kim gmina miała w 2025 r. umowy na wyłapywanie bezdomnych zwierząt?',
      'Ilu bezdomnym zwierzętom (z podziałem na psy i koty) zapewniono opiekę w 2025 r.?',
      'Jaki był koszt usług weterynaryjnych i dokarmiania?',
    ])
    expect(ids.slice(0, 3)).toEqual(expect.arrayContaining(['WGK', 'SDZ']))
  })

  it('boosts departments that answered similar archive cases', () => {
    const points = toPoints(['Proszę o informację o liczbie zajęć dodatkowych w placówkach.'])
    const withoutHints = proposeRoutingByKeywords(points, departments)
    const withHints = proposeRoutingByKeywords(points, departments, [
      { caseNumber: 'BKS.IV.1431.307.2025', similarity: 0.8, departmentNames: ['Wydział Edukacji i Sportu'] },
    ])
    expect(withoutHints.proposals.some((proposal) => proposal.departmentId === 'WE')).toBe(false)
    expect(withHints.proposals[0].departmentId).toBe('WE')
    expect(withHints.proposals[0].sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'archive', ref: 'BKS.IV.1431.307.2025', label: expect.stringContaining('Podobna sprawa BKS.IV.1431.307.2025') }),
      ]),
    )
  })

  it('flags questions about a named person as personal data', () => {
    const result = proposeRoutingByKeywords(
      toPoints(['Czy Pan Adam Fikcyjny pełnił funkcję kierownika robót wpisanego do dziennika budowy basenu?']),
      departments,
    )
    expect(result.proposals[0].departmentId).toBe('WIM')
    expect(result.flags.some((flag) => flag.kind === 'personal_data')).toBe(true)
  })

  it('splits points between departments and keeps at most three proposals', () => {
    const result = proposeRoutingByKeywords(
      toPoints([
        'Proszę o projekt zagospodarowania terenu i pozwolenie na budowę apartamentowca.',
        'Czy uzgodniono przebudowę bulwarów i nabrzeża w ramach inwestycji miejskiej?',
      ]),
      departments,
    )
    expect(result.proposals.length).toBeLessThanOrEqual(3)
    const byId = new Map(result.proposals.map((proposal) => [proposal.departmentId, proposal]))
    expect(result.proposals[0].departmentId).toBe('WAB')
    expect(byId.get('WAB')?.pointPositions).toContain(1)
    expect(byId.get('WIM')?.pointPositions).toEqual([2])
  })

  it('returns no proposals when nothing matches or there are no departments', () => {
    expect(proposeRoutingByKeywords(toPoints(['Xyz qwe rty']), departments).proposals).toEqual([])
    expect(proposeRoutingByKeywords(toPoints(['Liczba uczniów w szkołach']), []).proposals).toEqual([])
  })
})
