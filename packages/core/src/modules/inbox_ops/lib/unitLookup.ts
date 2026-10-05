import type { EntityManager } from '@mikro-orm/postgresql'
import type { EntityClass } from '@mikro-orm/core'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { canonicalizeUnitCode } from '@open-mercato/shared/lib/units/unitCodes'
import { LINE_UNIT_MAX_LENGTH } from '../data/validators'

const logger = createLogger('inbox_ops').child({ component: 'unit-lookup' })

export interface ExtractionUnit {
  code: string
  normalizedCode: string
  label: string
}

export interface LineUnitIssue {
  unit: string
  blocking: boolean
}

interface UnitDictionaryLike {
  id: string
  organizationId: string
  tenantId: string
  key?: string
  isActive?: boolean
  deletedAt?: Date | null
  createdAt?: Date
}

interface UnitDictionaryEntryLike {
  value: string
  normalizedValue?: string | null
  label?: string | null
  dictionary?: unknown
  organizationId?: string
  tenantId?: string
  position?: number
}

interface UnitLookupDeps {
  dictionaryClass: EntityClass<UnitDictionaryLike>
  dictionaryEntryClass: EntityClass<UnitDictionaryEntryLike>
}

const UNIT_DICTIONARY_KEYS = ['unit', 'units', 'measurement_units']

/**
 * Reads the tenant's unit-of-measure dictionary — the same dictionary the sales
 * commands validate line units against. Returns `null` when the lookup cannot run,
 * and an empty list when the tenant has no unit dictionary.
 */
export async function fetchUnitsForExtraction(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  deps?: UnitLookupDeps,
): Promise<ExtractionUnit[] | null> {
  if (!deps?.dictionaryClass || !deps?.dictionaryEntryClass) return null

  try {
    const dictionary = await findOneWithDecryption(
      em,
      deps.dictionaryClass,
      {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        key: { $in: UNIT_DICTIONARY_KEYS },
        deletedAt: null,
        isActive: true,
      },
      { orderBy: { createdAt: 'ASC' } },
      scope,
    )
    if (!dictionary) return []

    const entries = await findWithDecryption(
      em,
      deps.dictionaryEntryClass,
      {
        dictionary: dictionary.id,
        organizationId: dictionary.organizationId,
        tenantId: dictionary.tenantId,
      },
      undefined,
      scope,
    )

    const sortedEntries = [...entries].sort((left, right) =>
      (left.position ?? 0) - (right.position ?? 0) || String(left.value).localeCompare(String(right.value)),
    )
    const units: ExtractionUnit[] = []
    const seen = new Set<string>()
    for (const entry of sortedEntries) {
      const code = typeof entry.value === 'string' ? entry.value.trim() : ''
      if (!code) continue
      const normalizedCode = typeof entry.normalizedValue === 'string' && entry.normalizedValue.trim()
        ? entry.normalizedValue.trim()
        : code.toLowerCase()
      if (seen.has(normalizedCode)) continue
      seen.add(normalizedCode)
      const label = typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : code
      units.push({ code, normalizedCode, label })
    }
    return units
  } catch (err) {
    logger.error('Failed to fetch units of measure', { err })
    getTelemetryRuntime()?.reportError(err, { module: 'inbox_ops', code: 'inbox_ops.unit_lookup_failed' })
    return null
  }
}

/**
 * Matches a unit the way the sales line commands do: the canonical form of the
 * value must equal an entry's normalized value or its value. Returns the canonical
 * code to store on the line, or `null` when the tenant has no such unit.
 */
export function findUnitCode(value: unknown, units: ExtractionUnit[]): string | null {
  const canonical = canonicalizeUnitCode(value)
  if (!canonical) return null
  const known = units.some((unit) => unit.normalizedCode === canonical || unit.code === canonical)
  return known ? canonical : null
}

/**
 * Settles each line's stated unit against the tenant units and the line's product.
 * The unit blocks acceptance only where it changes the quantity: an unrecognized
 * unit on a product sold in units. A unit that cannot be applied anywhere else is
 * left off the line with a non-blocking issue — today's outcome, made visible.
 * `productBaseUnits` maps catalog product ids to their base unit, or `null` when the
 * product has none.
 */
export function applyLineUnits(
  lineItems: Record<string, unknown>[],
  units: ExtractionUnit[] | null,
  productBaseUnits: Map<string, string | null>,
): LineUnitIssue[] {
  const issues = new Map<string, LineUnitIssue>()
  const report = (unit: string, blocking: boolean) => {
    const key = `${blocking ? 'block' : 'warn'}:${unit.toLowerCase()}`
    if (!issues.has(key)) issues.set(key, { unit, blocking })
  }

  for (const item of lineItems) {
    const statedUnit = typeof item.quantityUnit === 'string' ? item.quantityUnit.trim() : ''
    const fitsLine = statedUnit.length <= LINE_UNIT_MAX_LENGTH
    if (!statedUnit || (units !== null && units.length === 0)) {
      delete item.quantityUnit
      continue
    }
    if (units === null) {
      if (fitsLine) item.quantityUnit = statedUnit
      else delete item.quantityUnit
      continue
    }

    const productId = typeof item.productId === 'string' ? item.productId : null
    const productBaseUnit = productId ? productBaseUnits.get(productId) : undefined
    if (productBaseUnit === null) {
      delete item.quantityUnit
      report(statedUnit, false)
      continue
    }

    const unitCode = findUnitCode(statedUnit, units)
    if (unitCode) {
      item.quantityUnit = unitCode
    } else if (productBaseUnit) {
      if (fitsLine) item.quantityUnit = statedUnit
      else delete item.quantityUnit
      report(statedUnit, true)
    } else {
      delete item.quantityUnit
      report(statedUnit, false)
    }
  }
  return Array.from(issues.values())
}
