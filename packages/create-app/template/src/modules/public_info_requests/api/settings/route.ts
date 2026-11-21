import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { settingsUpdateSchema } from '../../data/validators'
import '../../commands/departments'
import { loadSettings } from '../../lib/server/requests'
import { handleRoute, parseBody, resolveRouteContext, runGuardedCommand } from '../../lib/server/routeContext'
import { listPolishPublicHolidays } from '../../lib/deadlines'
import { describeAssistantStatus } from '../../lib/server/assistant'
import { jsonMethodDoc } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['public_info_requests.view'] },
  PUT: { requireAuth: true, requireFeatures: ['public_info_requests.knowledge.manage'] },
}

export async function GET(req: Request) {
  return handleRoute(async () => {
    const routeContext = await resolveRouteContext(req)
    const settings = await loadSettings(routeContext.em, routeContext)
    const year = new Date().getUTCFullYear()
    return NextResponse.json({
      deadlineMode: settings.deadlineMode,
      internalDueOffsetWorkingDays: settings.internalDueOffsetWorkingDays,
      clarificationDays: settings.clarificationDays,
      similarityThreshold: settings.similarityThreshold,
      similarityWindowMonths: settings.similarityWindowMonths,
      extraHolidays: settings.extraHolidays ?? [],
      publicOfficials: settings.publicOfficials ?? [],
      holidays: [...listPolishPublicHolidays(year), ...listPolishPublicHolidays(year + 1)],
      assistant: describeAssistantStatus(),
      updatedAt: settings.updatedAt?.toISOString() ?? null,
    })
  })
}

export async function PUT(req: Request) {
  return handleRoute(async () => {
    const routeContext = await resolveRouteContext(req)
    const input = await parseBody(req, settingsUpdateSchema)
    await runGuardedCommand(req, routeContext, {
      commandId: 'public_info_requests.settings.update',
      input,
      resourceKind: 'public_info_requests.settings',
      resourceId: routeContext.organizationId,
      operation: 'update',
    })
    return NextResponse.json({ ok: true })
  })
}

export const openApi: OpenApiRouteDoc = {
  methods: {
    GET: jsonMethodDoc({ summary: 'Read UDIP settings, holiday calendar and assistant status' }),
    PUT: jsonMethodDoc({ summary: 'Update UDIP settings', requestSchema: settingsUpdateSchema }),
  },
}
