import { z, type ZodTypeAny } from 'zod'
import type { OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  createPagedListResponseSchema as createSharedPagedListResponseSchema,
} from '@open-mercato/shared/lib/openapi/crud'

export const publicInfoTag = 'Public information requests'

export const okSchema = z.object({ ok: z.literal(true) })
export const createdSchema = z.object({ id: z.string().uuid() })
export const errorSchema = z.object({ error: z.string() }).passthrough()
export const anyObjectSchema = z.object({}).passthrough()

export function createPagedListSchema(itemSchema: ZodTypeAny) {
  return createSharedPagedListResponseSchema(itemSchema, { paginationMetaOptional: true })
}

export const buildPublicInfoCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: publicInfoTag,
  defaultCreateResponseSchema: createdSchema,
  defaultOkResponseSchema: okSchema,
})

export function jsonMethodDoc(options: {
  summary: string
  description?: string
  requestSchema?: ZodTypeAny
  querySchema?: ZodTypeAny
  responseSchema?: ZodTypeAny
}): OpenApiMethodDoc {
  return {
    summary: options.summary,
    description: options.description,
    tags: [publicInfoTag],
    ...(options.querySchema ? { query: options.querySchema } : {}),
    ...(options.requestSchema ? { requestBody: { contentType: 'application/json', schema: options.requestSchema } } : {}),
    responses: [{ status: 200, description: 'Success', schema: options.responseSchema ?? anyObjectSchema }],
    errors: [
      { status: 400, description: 'Invalid payload', schema: errorSchema },
      { status: 404, description: 'Not found', schema: errorSchema },
      { status: 422, description: 'Business rule violated', schema: errorSchema },
    ],
  }
}
