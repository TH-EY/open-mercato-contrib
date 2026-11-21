import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { handleRoute, resolveRouteContext } from '../../lib/server/routeContext'
import { listAssignableUsers } from '../../lib/server/users'
import { jsonMethodDoc } from '../openapi'

export const metadata = { GET: { requireAuth: true, requireFeatures: ['public_info_requests.view'] } }

const responseSchema = z.object({
  items: z.array(z.object({ id: z.string().uuid(), name: z.string(), initials: z.string() })),
  currentUserId: z.string().nullable(),
})

export async function GET(req: Request) {
  return handleRoute(async () => {
    const routeContext = await resolveRouteContext(req)
    const items = await listAssignableUsers(routeContext.em, routeContext.container, routeContext)
    return NextResponse.json({ items, currentUserId: routeContext.userId ?? null })
  })
}

export const openApi: OpenApiRouteDoc = {
  methods: { GET: jsonMethodDoc({ summary: 'List people who can be assigned to public-information requests', responseSchema }) },
}
