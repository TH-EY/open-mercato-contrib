/** @jest-environment node */

import { fetchUnitsForExtraction, findUnitCode, type ExtractionUnit } from '../unitLookup'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

const mockReportError = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

const mockEm = {} as any
const MockDictionary = class {} as any
const MockDictionaryEntry = class {} as any
const deps = { dictionaryClass: MockDictionary, dictionaryEntryClass: MockDictionaryEntry }
const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const dictionary = { id: 'dict-1', key: 'unit', tenantId: 'tenant-1', organizationId: 'org-1' }

describe('fetchUnitsForExtraction', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns null when the dictionary entities are not available', async () => {
    expect(await fetchUnitsForExtraction(mockEm, scope)).toBeNull()
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })

  it('looks up the active unit dictionary of the tenant and organization', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(dictionary)
    mockFindWithDecryption.mockResolvedValueOnce([])

    await fetchUnitsForExtraction(mockEm, scope, deps)

    const [, entityClass, where, , decryptionScope] = mockFindOneWithDecryption.mock.calls[0]
    expect(entityClass).toBe(MockDictionary)
    expect(where).toEqual({
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      key: { $in: ['unit', 'units', 'measurement_units'] },
      deletedAt: null,
      isActive: true,
    })
    expect(decryptionScope).toEqual(scope)
    const [, entryClass, entryWhere] = mockFindWithDecryption.mock.calls[0]
    expect(entryClass).toBe(MockDictionaryEntry)
    expect(entryWhere).toEqual({ dictionary: 'dict-1', organizationId: 'org-1', tenantId: 'tenant-1' })
  })

  it('returns an empty list when the tenant has no unit dictionary', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(null)

    expect(await fetchUnitsForExtraction(mockEm, scope, deps)).toEqual([])
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('maps entries to codes and labels in position and code order, skipping blank and duplicate entries', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(dictionary)
    mockFindWithDecryption.mockResolvedValueOnce([
      { value: 'kg', normalizedValue: 'kg', label: 'Kilogram (weight)', position: 0 },
      { value: 'M2', normalizedValue: 'm2', label: '', position: 0 },
      { value: '  ', normalizedValue: '', label: 'Blank', position: 0 },
      { value: 'KG', normalizedValue: 'kg', label: 'Duplicate kilogram', position: 1 },
      { value: 'box', normalizedValue: 'box', label: 'Box (piece)', position: -1 },
    ])

    expect(await fetchUnitsForExtraction(mockEm, scope, deps)).toEqual([
      { code: 'box', normalizedCode: 'box', label: 'Box (piece)' },
      { code: 'kg', normalizedCode: 'kg', label: 'Kilogram (weight)' },
      { code: 'M2', normalizedCode: 'm2', label: 'M2' },
    ])
  })

  it('returns null and reports the error when the lookup fails', async () => {
    const failure = new Error('db down')
    mockFindOneWithDecryption.mockRejectedValueOnce(failure)

    expect(await fetchUnitsForExtraction(mockEm, scope, deps)).toBeNull()
    expect(mockReportError).toHaveBeenCalledWith(failure, { module: 'inbox_ops', code: 'inbox_ops.unit_lookup_failed' })
  })
})

describe('findUnitCode', () => {
  const units: ExtractionUnit[] = [
    { code: 'pc', normalizedCode: 'pc', label: 'Piece (piece)' },
    { code: 'M2', normalizedCode: 'm2', label: 'Square Meter (area)' },
  ]

  it('returns the canonical code of a known unit regardless of case and whitespace', () => {
    expect(findUnitCode(' m2 ', units)).toBe('m2')
    expect(findUnitCode('PC', units)).toBe('pc')
  })

  it('applies the legacy unit aliases the sales commands apply', () => {
    expect(findUnitCode('qty', units)).toBe('pc')
  })

  it('returns null for a unit the tenant does not have', () => {
    expect(findUnitCode('t', units)).toBeNull()
  })

  it('returns null for blank and non-string values', () => {
    expect(findUnitCode('  ', units)).toBeNull()
    expect(findUnitCode(5, units)).toBeNull()
    expect(findUnitCode(undefined, units)).toBeNull()
  })
})
