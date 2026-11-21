import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { handleRoute, resolveRouteContext } from '../../lib/server/routeContext'
import { loadSettings } from '../../lib/server/requests'
import { findSimilarRequests, listArchivedRequests } from '../../lib/server/caseServices'
import { jsonMethodDoc } from '../openapi'

export const metadata = { GET: { requireAuth: true, requireFeatures: ['public_info_requests.view'] } }

const querySchema = z.object({ text: z.string().trim().max(2000).optional(), limit: z.coerce.number().int().min(1).max(100).default(20) })

export async function GET(req: Request) {
  return handleRoute(async () => {
    const routeContext = await resolveRouteContext(req)
    const query = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams))
    if (!query.text || query.text.length < 2) {
      return NextResponse.json(await listArchivedRequests(routeContext.em, routeContext, query.limit))
    }
    const settings = await loadSettings(routeContext.em, routeContext)
    const relaxed = Object.assign(Object.create(Object.getPrototypeOf(settings)), settings, {
      similarityThreshold: Math.min(settings.similarityThreshold, 0.05),
      similarityWindowMonths: Math.max(settings.similarityWindowMonths, 120),
    })
    const result = await findSimilarRequests(routeContext.em, routeContext, { text: query.text, points: [], limit: query.limit }, relaxed)
    return NextResponse.json(result)
  })
}

export const openApi: OpenApiRouteDoc = {
  methods: { GET: jsonMethodDoc({ summary: 'Free-text search over the anonymised archive of answered requests; without text, lists the most recent archived cases', querySchema }) },
}
