import type { EntityManager } from '@mikro-orm/postgresql'
import { AttachmentPartition } from '@open-mercato/core/modules/attachments/data/entities'

export const PUBLIC_INFO_PARTITION_CODE = 'publicInfoRequests'

export async function ensurePublicInfoPartition(em: EntityManager): Promise<void> {
  const existing = await em.findOne(AttachmentPartition, { code: PUBLIC_INFO_PARTITION_CODE })
  if (existing) return
  const partition = em.create(AttachmentPartition, {
    code: PUBLIC_INFO_PARTITION_CODE,
    title: 'Public-information requests',
    description: 'Scans, requests and department replies for UDIP cases (private).',
    storageDriver: 'local',
    isPublic: false,
    requiresOcr: false,
  } as never)
  await em.persist(partition).flush()
}
