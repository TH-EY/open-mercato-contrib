import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { handleRoute, parseBody, resolveRouteContext } from '../../lib/server/routeContext'
import { computeDeadlines, loadSettings } from '../../lib/server/requests'
import { internalDueDate } from '../../lib/deadlines'
import { isoDateSchema } from '../../data/validators'
import { jsonMethodDoc } from '../openapi'

export const metadata = { POST: { requireAuth: true, requireFeatures: ['public_info_requests.view'] } }

const bodySchema = z.object({ receivedAt: isoDateSchema })

export async function POST(req: Request) {
  return handleRoute(async () => {
    const routeContext = await resolveRouteContext(req)
    const body = await parseBody(req, bodySchema)
    const settings = await loadSettings(routeContext.em, routeContext)
    const deadlines = computeDeadlines(body.receivedAt, settings.deadlineMode, settings.extraHolidays ?? [])
    return NextResponse.json({
      statutoryDueDate: deadlines.statutoryDueDate,
      shiftedFrom: deadlines.dueShiftedFrom,
      explanation: deadlines.explanation,
      maxExtensionDate: deadlines.maxExtensionDate,
      internalDueDate: internalDueDate(deadlines.statutoryDueDate, settings.internalDueOffsetWorkingDays, settings.extraHolidays ?? []),
      deadlineMode: settings.deadlineMode,
    })
  })
}

export const openApi: OpenApiRouteDoc = {
  methods: { POST: jsonMethodDoc({ summary: 'Compute statutory deadline, extension limit and internal department deadline', requestSchema: bodySchema }) },
}
