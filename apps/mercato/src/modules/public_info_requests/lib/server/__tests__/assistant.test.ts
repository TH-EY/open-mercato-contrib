import { isAgentStepEnabled, isOcrFallbackConfigured } from '../assistant'

const ENV_KEYS = ['PUBLIC_INFO_AI_AGENTS', 'PUBLIC_INFO_AI_DISABLED', 'PUBLIC_INFO_OCR_FALLBACK', 'PUBLIC_INFO_OCR_PROVIDER', 'ANTHROPIC_API_KEY'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe('isAgentStepEnabled', () => {
  it('enables every step by default', () => {
    expect(isAgentStepEnabled('public_info_requests.drafter')).toBe(true)
    expect(isAgentStepEnabled('public_info_requests.ocr_transcriber')).toBe(true)
  })

  it('limits AI to the listed steps', () => {
    process.env.PUBLIC_INFO_AI_AGENTS = 'ocr'
    expect(isAgentStepEnabled('public_info_requests.ocr_transcriber')).toBe(true)
    expect(isAgentStepEnabled('public_info_requests.drafter')).toBe(false)
    expect(isAgentStepEnabled('public_info_requests.intake_extractor')).toBe(false)
    process.env.PUBLIC_INFO_AI_AGENTS = 'none'
    expect(isAgentStepEnabled('public_info_requests.ocr_transcriber')).toBe(false)
  })
})

describe('isOcrFallbackConfigured', () => {
  it('needs the provider key and an enabled ocr step', () => {
    expect(isOcrFallbackConfigured()).toBe(false)
    process.env.ANTHROPIC_API_KEY = 'test-key'
    expect(isOcrFallbackConfigured()).toBe(true)
    process.env.PUBLIC_INFO_AI_AGENTS = 'drafting'
    expect(isOcrFallbackConfigured()).toBe(false)
    process.env.PUBLIC_INFO_AI_AGENTS = 'ocr'
    expect(isOcrFallbackConfigured()).toBe(true)
  })
})
