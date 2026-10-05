/** @jest-environment node */

import { applyLineUnits, fetchUnitsForExtraction, findUnitCode, type ExtractionUnit } from '../unitLookup'

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

describe('applyLineUnits', () => {
  const units: ExtractionUnit[] = [
    { code: 'kg', normalizedCode: 'kg', label: 'Kilogram (weight)' },
    { code: 'bag', normalizedCode: 'bag', label: 'Bag' },
  ]
  const soldInBags = 'product-bags'
  const withoutUnits = 'product-plain'
  const productBaseUnits = new Map<string, string | null>([[soldInBags, 'bag'], [withoutUnits, null]])

  it('stores a recognized unit as its code on product and custom lines alike', () => {
    const lines: Record<string, unknown>[] = [
      { productName: 'Cement', productId: soldInBags, quantity: '10', quantityUnit: ' KG ' },
      { productName: 'Delivery', quantity: '1', quantityUnit: 'Bag' },
    ]
    expect(applyLineUnits(lines, units, productBaseUnits)).toEqual([])
    expect(lines.map((line) => line.quantityUnit)).toEqual(['kg', 'bag'])
  })

  it('blocks an unrecognized unit on a product sold in units and keeps it on the line', () => {
    const lines: Record<string, unknown>[] = [{ productName: 'Cement', productId: soldInBags, quantity: '10', quantityUnit: 't' }]
    expect(applyLineUnits(lines, units, productBaseUnits)).toEqual([{ unit: 't', blocking: true }])
    expect(lines[0].quantityUnit).toBe('t')
  })

  it('drops an unrecognized unit from a custom line with a non-blocking issue', () => {
    const lines: Record<string, unknown>[] = [{ productName: 'Sand', quantity: '2', quantityUnit: 't' }]
    expect(applyLineUnits(lines, units, productBaseUnits)).toEqual([{ unit: 't', blocking: false }])
    expect(lines[0]).not.toHaveProperty('quantityUnit')
  })

  it('drops any unit from a product without a base unit with a non-blocking issue', () => {
    const lines: Record<string, unknown>[] = [
      { productName: 'Shirt', productId: withoutUnits, quantity: '5', quantityUnit: 'kg' },
      { productName: 'Shirt', productId: withoutUnits, quantity: '5', quantityUnit: 'opak.' },
    ]
    expect(applyLineUnits(lines, units, productBaseUnits)).toEqual([
      { unit: 'kg', blocking: false },
      { unit: 'opak.', blocking: false },
    ])
    expect(lines.every((line) => !('quantityUnit' in line))).toBe(true)
  })

  it('drops an over-long unrecognized unit but still blocks it on a product sold in units', () => {
    const longUnit = 'bags of twenty-five kilograms each'
    const lines: Record<string, unknown>[] = [{ productName: 'Cement', productId: soldInBags, quantity: '10', quantityUnit: longUnit }]
    expect(applyLineUnits(lines, units, productBaseUnits)).toEqual([{ unit: longUnit, blocking: true }])
    expect(lines[0]).not.toHaveProperty('quantityUnit')
  })

  it('reports each unit once per severity, ignoring case', () => {
    const lines: Record<string, unknown>[] = [
      { productName: 'Cement', productId: soldInBags, quantity: '1', quantityUnit: 'T' },
      { productName: 'Cement', productId: soldInBags, quantity: '2', quantityUnit: 't' },
      { productName: 'Sand', quantity: '3', quantityUnit: 't' },
    ]
    expect(applyLineUnits(lines, units, productBaseUnits)).toEqual([
      { unit: 'T', blocking: true },
      { unit: 't', blocking: false },
    ])
  })

  it('keeps units as written without issues when the units could not be loaded', () => {
    const lines: Record<string, unknown>[] = [
      { productName: 'Cement', productId: soldInBags, quantity: '10', quantityUnit: ' Bags ' },
      { productName: 'Sand', quantity: '2', quantityUnit: 'x'.repeat(26) },
    ]
    expect(applyLineUnits(lines, null, productBaseUnits)).toEqual([])
    expect(lines[0].quantityUnit).toBe('Bags')
    expect(lines[1]).not.toHaveProperty('quantityUnit')
  })

  it('leaves units off without issues when the tenant has no units of measure', () => {
    const lines: Record<string, unknown>[] = [{ productName: 'Cement', productId: soldInBags, quantity: '10', quantityUnit: 'kg' }]
    expect(applyLineUnits(lines, [], productBaseUnits)).toEqual([])
    expect(lines[0]).not.toHaveProperty('quantityUnit')
  })

  it('removes a blank unit', () => {
    const lines: Record<string, unknown>[] = [{ productName: 'Sand', quantity: '2', quantityUnit: '  ' }]
    expect(applyLineUnits(lines, units, productBaseUnits)).toEqual([])
    expect(lines[0]).not.toHaveProperty('quantityUnit')
  })
})
