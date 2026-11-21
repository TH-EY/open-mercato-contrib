import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { PublicInfoRequest } from '../../data/entities'
import { handleRoute, resolveRouteContext } from '../../lib/server/routeContext'
import { loadUserLabels } from '../../lib/server/users'
import { deadlineTone, listPolishPublicHolidays, todayIso } from '../../lib/deadlines'
import { isoDateSchema } from '../../data/validators'
import { jsonMethodDoc } from '../openapi'

export const metadata = { GET: { requireAuth: true, requireFeatures: ['public_info_requests.view'] } }

const querySchema = z.object({ from: isoDateSchema, to: isoDateSchema, today: isoDateSchema.optional() })

export async function GET(req: Request) {
  return handleRoute(async () => {
    const routeContext = await resolveRouteContext(req)
    const query = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams))
    const rows = await routeContext.em.find(
      PublicInfoRequest,
      {
        tenantId: routeContext.tenantId,
        organizationId: routeContext.organizationId,
        deletedAt: null,
        source: 'manual',
        currentDueDate: { $gte: query.from, $lte: query.to },
      },
      { fields: ['id', 'caseNumber', 'caseSeq', 'subjectSummary', 'currentDueDate', 'status', 'assigneeUserId', 'dueShiftedFrom'], orderBy: { currentDueDate: 'asc' }, limit: 500 },
    )
    const labels = await loadUserLabels(routeContext.em, routeContext, rows.map((row) => row.assigneeUserId ?? ''))
    const today = query.today ?? todayIso()
    const years = Array.from(new Set([query.from.slice(0, 4), query.to.slice(0, 4)].map(Number)))
    return NextResponse.json({
      items: rows.map((row) => ({
        id: row.id,
        caseNumber: row.caseNumber,
        caseSeq: row.caseSeq,
        subjectSummary: row.subjectSummary,
        currentDueDate: row.currentDueDate,
        dueShiftedFrom: row.dueShiftedFrom ?? null,
        status: row.status,
        deadlineTone: deadlineTone(today, { status: row.status, currentDueDate: row.currentDueDate }),
        assigneeInitials: row.assigneeUserId ? labels.get(row.assigneeUserId)?.initials ?? null : null,
      })),
      holidays: years.flatMap((year) => listPolishPublicHolidays(year)),
    })
  })
}

export const openApi: OpenApiRouteDoc = {
  methods: { GET: jsonMethodDoc({ summary: 'Deadline calendar feed (requests by current deadline) with Polish holidays', querySchema }) },
}
