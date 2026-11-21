import { NextResponse } from 'next/server'
import { ZodError, type ZodType } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards, type RouteMutationGuardOperation } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('public_info_requests').child({ component: 'route' })

export type RouteScope = {
  tenantId: string
  organizationId: string
  userId: string
}

export type RouteContext = RouteScope & {
  container: AwilixContainer
  em: EntityManager
  ctx: CommandRuntimeContext
}

export async function resolveRouteContext(req: Request): Promise<RouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId || !auth.sub) {
    throw new CrudHttpError(401, { error: 'Unauthorized' })
  }
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = resolveSingleOrganizationIdOrDeny(scope, auth) ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: 'Organization context is required' })
  }
  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? [organizationId],
    request: req,
  }
  return {
    container,
    em: container.resolve('em') as EntityManager,
    ctx,
    tenantId: auth.tenantId,
    organizationId,
    userId: String(auth.sub),
  }
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const body = await readJsonSafe<Record<string, unknown>>(req, {})
  return schema.parse(body)
}

export async function runGuardedCommand<TResult>(
  req: Request,
  routeContext: RouteContext,
  options: {
    commandId: string
    input: Record<string, unknown>
    resourceKind: string
    resourceId?: string | null
    operation?: RouteMutationGuardOperation
  },
): Promise<TResult> {
  const guard = await runRouteMutationGuards({
    container: routeContext.container,
    req,
    auth: { userId: routeContext.userId, tenantId: routeContext.tenantId, organizationId: routeContext.organizationId },
    input: {
      resourceKind: options.resourceKind,
      resourceId: options.resourceId ?? null,
      operation: options.operation ?? 'custom',
      mutationPayload: options.input,
    },
  })
  if (!guard.ok) {
    throw new CrudHttpError(guard.errorStatus, guard.errorBody)
  }
  const input = guard.modifiedPayload ? { ...options.input, ...guard.modifiedPayload } : options.input
  const commandBus = routeContext.container.resolve('commandBus') as CommandBus
  const { result } = await commandBus.execute<Record<string, unknown>, TResult>(options.commandId, {
    input,
    ctx: routeContext.ctx,
  })
  try {
    await guard.runAfterSuccess()
  } catch (error) {
    logger.warn('mutation guard after-success callback failed', { error })
  }
  return result
}

export function errorResponse(error: unknown): NextResponse {
  if (isCrudHttpError(error)) {
    return NextResponse.json(error.body, { status: error.status })
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: 'Invalid payload', issues: error.issues }, { status: 400 })
  }
  const rejection = getCommandInterceptorHttpRejection(error)
  if (rejection) {
    return NextResponse.json(rejection.body, { status: rejection.status })
  }
  logger.error('public_info_requests route failed', { error })
  getTelemetryRuntime()?.reportError(error, { module: 'public_info_requests', code: 'public_info_requests.route_failed' })
  return NextResponse.json({ error: 'Request failed' }, { status: 500 })
}

export async function handleRoute(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler()
  } catch (error) {
    return errorResponse(error)
  }
}
