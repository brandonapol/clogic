import { adapters } from '../llm/providers.js'
import type { ProviderId } from '../llm/types.js'
import type { Tool } from '../tools/types.js'
import type { CompanionSettings } from './types.js'

export const companionName = 'clogic-companion 0.0.0'

export const defaultSystemPrompt = [
  'You are clogic, an assistant for mixing, mastering and Logic Pro questions.',
  'Use the available tools to analyse audio and to find Logic Pro documentation links.',
  'Tools that change the Logic session only propose changes; the user approves or declines each',
  'change in the plugin window, and you cannot approve changes yourself.',
  'Say when you are unsure, and do not claim Logic Pro features you cannot cite.',
].join(' ')

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
  system: defaultSystemPrompt,
  maxOutputTokens: 4096,
  maxIterations: 8,
  proposalTtlMs: 5 * 60_000,
  models: defaultModels,
  ...overrides,
  tools: tools.map((tool) => ({ definition: tool.definition, kind: tool.kind })),
})
