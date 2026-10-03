import { adapters } from '../llm/providers.js'
import type { ProviderId } from '../llm/types.js'
import { buildSystemPrompt, promptTools } from '../prompts/system.js'
import type { Tool } from '../tools/types.js'
import type { CompanionSettings } from './types.js'

export const companionName = 'clogic-companion 0.0.0'

export const systemPromptFor =
  (tools: readonly Tool[]) =>
  (provider: ProviderId): string =>
    buildSystemPrompt({ provider, tools: promptTools(tools) })

export const defaultModels: Readonly<Record<ProviderId, string>> = {
  anthropic: adapters.anthropic.defaultModel,
  openai: adapters.openai.defaultModel,
  xai: adapters.xai.defaultModel,
}

export type SettingsOverrides = Partial<Omit<CompanionSettings, 'tools'>>

export const companionSettings = (
  tools: readonly Tool[],
  overrides: SettingsOverrides = {},
): CompanionSettings => ({
  system: systemPromptFor(tools),
  maxOutputTokens: 4096,
  maxIterations: 8,
  proposalTtlMs: 5 * 60_000,
  models: defaultModels,
  ...overrides,
  tools: tools.map((tool) => ({ definition: tool.definition, kind: tool.kind })),
})
