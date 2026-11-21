import type { AwilixContainer } from 'awilix'
import type { ZodType } from 'zod'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('public_info_requests').child({ component: 'assistant' })

const LOCAL_PROVIDERS = new Set(['ollama', 'lm-studio', 'litellm'])

export type AssistantStatus = {
  configured: boolean
  provider: string | null
  model: string | null
  offline: boolean
  ocr: 'tesseract' | 'llm' | 'none'
}

function hasValue(name: string): boolean {
  const value = process.env[name]
  return typeof value === 'string' && value.trim().length > 0
}

export function isAssistantConfigured(): boolean {
  if (process.env.PUBLIC_INFO_AI_DISABLED === 'true') return false
  return (
    hasValue('OPENAI_API_KEY') ||
    hasValue('ANTHROPIC_API_KEY') ||
    hasValue('GOOGLE_GENERATIVE_AI_API_KEY') ||
    hasValue('OLLAMA_BASE_URL') ||
    hasValue('LM_STUDIO_BASE_URL') ||
    hasValue('LITELLM_BASE_URL')
  )
}

export function describeAssistantStatus(ocrAvailable = false): AssistantStatus {
  const provider = process.env.OM_AI_PROVIDER?.trim() || null
  const configured = isAssistantConfigured()
  return {
    configured,
    provider: configured ? provider : null,
    model: configured ? process.env.PUBLIC_INFO_AI_MODEL?.trim() || process.env.OM_AI_MODEL?.trim() || null : null,
    offline: !configured || (provider !== null && LOCAL_PROVIDERS.has(provider)),
    ocr: ocrAvailable ? 'tesseract' : hasValue('OPENAI_API_KEY') ? 'llm' : 'none',
  }
}

type AgentRuntimeModule = {
  runAiAgentObject?: (input: Record<string, unknown>) => Promise<{ mode: string; object: unknown }>
}

type AgentRegistryModule = {
  loadAgentRegistry?: () => Promise<unknown>
}

type RbacServiceLike = {
  getGrantedFeatures: (userId: string, scope: { tenantId: string | null; organizationId: string | null }) => Promise<string[]>
}

export type AssistantCallInput<T> = {
  agentId: string
  prompt: string
  schemaName: string
  schema: ZodType<T>
  container: AwilixContainer
  scope: { tenantId: string; organizationId: string; userId: string }
  attachmentIds?: string[]
}

export async function runAssistantObject<T>(input: AssistantCallInput<T>): Promise<T | null> {
  if (!isAssistantConfigured()) return null
  let runtime: AgentRuntimeModule
  let registry: AgentRegistryModule
  try {
    runtime = (await import('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-runtime')) as unknown as AgentRuntimeModule
    registry = (await import('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry')) as unknown as AgentRegistryModule
  } catch (error) {
    logger.debug('AI assistant runtime not installed', { error })
    return null
  }
  if (typeof runtime.runAiAgentObject !== 'function') return null
  try {
    if (typeof registry.loadAgentRegistry === 'function') await registry.loadAgentRegistry()
    let features: string[] = []
    try {
      const rbac = input.container.resolve('rbacService') as RbacServiceLike
      features = await rbac.getGrantedFeatures(input.scope.userId, {
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId,
      })
    } catch {
      features = []
    }
    const result = await runtime.runAiAgentObject({
      agentId: input.agentId,
      input: input.prompt,
      authContext: {
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId,
        userId: input.scope.userId,
        features,
        isSuperAdmin: false,
      },
      container: input.container,
      ...(input.attachmentIds && input.attachmentIds.length > 0 ? { attachmentIds: input.attachmentIds } : {}),
      ...(process.env.PUBLIC_INFO_AI_MODEL ? { modelOverride: process.env.PUBLIC_INFO_AI_MODEL } : {}),
      output: { schemaName: input.schemaName, schema: input.schema, mode: 'generate' },
    })
    const parsed = input.schema.safeParse(result.object)
    return parsed.success ? parsed.data : null
  } catch (error) {
    logger.warn('assistant call failed, falling back to deterministic mode', { agentId: input.agentId, error })
    return null
  }
}
