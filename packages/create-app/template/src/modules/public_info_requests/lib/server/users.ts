import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import type { Scope } from './requests'

export type UserLabel = { id: string; name: string; initials: string }

export function initialsOf(label: string): string {
  const source = label.includes('@') ? label.split('@')[0].replace(/[._-]+/g, ' ') : label
  const parts = source.trim().split(/\s+/).filter((part) => part.length > 0)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

export async function loadUserLabels(em: EntityManager, scope: Scope, ids: string[]): Promise<Map<string, UserLabel>> {
  const unique = Array.from(new Set(ids.filter((value) => typeof value === 'string' && value.length > 0)))
  const labels = new Map<string, UserLabel>()
  if (unique.length === 0) return labels
  const users = await findWithDecryption(
    em,
    User,
    { id: { $in: unique }, tenantId: scope.tenantId, deletedAt: null } as FilterQuery<User>,
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  for (const user of users) {
    const name = user.name && user.name.trim().length > 0 ? user.name : user.email
    labels.set(user.id, { id: user.id, name, initials: initialsOf(name) })
  }
  return labels
}
