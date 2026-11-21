import { existsSync } from 'node:fs'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { parseModuleCliOptions } from '@open-mercato/shared/lib/cli/parseModuleCliOptions'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { importArchive, seedDemoCalendar, seedModuleDefaults } from './lib/server/seeding'

type Options = Record<string, string | boolean | undefined>

function requireString(options: Options, key: string): string {
  const value = options[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`[internal] Missing --${key}`)
  }
  return value.trim()
}

async function resolveScope(options: Options) {
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const tenantId = requireString(options, 'tenant')
  const organizationId = requireString(options, 'org')
  return { em, scope: { tenantId, organizationId } }
}

function listOption(value: string | boolean | undefined): string[] | undefined {
  if (typeof value !== 'string') return undefined
  return value.split(',').map((entry) => entry.trim()).filter(Boolean)
}

const seedDefaults: ModuleCli = {
  command: 'seed-defaults',
  async run(rest) {
    const options = parseModuleCliOptions(rest) as Options
    const { em, scope } = await resolveScope(options)
    await seedModuleDefaults(em, scope)
    console.log('UDIP settings, departments and attachment partition are ready.')
  },
}

const seedCalendar: ModuleCli = {
  command: 'seed-demo-calendar',
  async run(rest) {
    const options = parseModuleCliOptions(rest) as Options
    const { em, scope } = await resolveScope(options)
    await seedModuleDefaults(em, scope)
    const today = typeof options.today === 'string' ? options.today : undefined
    const assigneeUserId = typeof options.assignee === 'string' ? options.assignee : null
    const created = await seedDemoCalendar(em, scope, { today, assigneeUserId })
    console.log(created > 0 ? `Seeded ${created} demo requests.` : 'Demo requests already present.')
  },
}

const importArchiveCommand: ModuleCli = {
  command: 'import-archive',
  async run(rest) {
    const options = parseModuleCliOptions(rest) as Options
    const { em, scope } = await resolveScope(options)
    await seedModuleDefaults(em, scope)
    const rawDirectory = typeof options.dir === 'string' ? options.dir : requireString(options, 'dir')
    const directory = existsSync(rawDirectory) ? rawDirectory : existsSync(`${rawDirectory} `) ? `${rawDirectory} ` : rawDirectory
    const reports = await importArchive(em, scope, directory, { only: listOption(options.only), skip: listOption(options.skip) })
    for (const report of reports) {
      console.log(`${report.caseNumber}\t${report.status}${report.reason ? `\t${report.reason}` : ''}${report.textSource ? `\t${report.textSource}` : ''}`)
    }
  },
}

export default [seedDefaults, seedCalendar, importArchiveCommand]
