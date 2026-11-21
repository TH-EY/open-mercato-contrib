import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { seedDemoCalendar, seedModuleDefaults } from './lib/server/seeding'

const logger = createLogger('public_info_requests').child({ component: 'setup' })

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['public_info_requests.*'],
    admin: ['public_info_requests.*'],
  },

  async seedDefaults({ container, tenantId, organizationId }) {
    if (!tenantId || !organizationId) return
    const em = (container.resolve('em') as EntityManager).fork()
    try {
      await seedModuleDefaults(em, { tenantId, organizationId })
    } catch (error) {
      logger.warn('public_info_requests default seeding failed', { error })
    }
  },

  async seedExamples({ container, tenantId, organizationId }) {
    if (!tenantId || !organizationId) return
    const em = (container.resolve('em') as EntityManager).fork()
    await seedModuleDefaults(em, { tenantId, organizationId })
    await seedDemoCalendar(em, { tenantId, organizationId })
  },
}

export default setup
