import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { handleRoute, resolveRouteContext } from '../../lib/server/routeContext'
import { nextCaseNumber } from '../../lib/server/requests'
import { jsonMethodDoc } from '../openapi'

export const metadata = { GET: { requireAuth: true, requireFeatures: ['public_info_requests.manage'] } }

const querySchema = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() })

export async function GET(req: Request) {
  return handleRoute(async () => {
    const routeContext = await resolveRouteContext(req)
    const query = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams))
    const year = query.year ?? new Date().getUTCFullYear()
    return NextResponse.json(await nextCaseNumber(routeContext.em, routeContext, year))
  })
}

export const openApi: OpenApiRouteDoc = {
  methods: { GET: jsonMethodDoc({ summary: 'Suggest the next free case number for a year', querySchema }) },
}
