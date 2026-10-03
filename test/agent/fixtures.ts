import type { AgentDeps } from '../../src/agent/run.js'
import type { AgentConfig, AgentNotification } from '../../src/agent/types.js'
import { ok } from '../../src/llm/result.js'
import type { ChatRequest, ChatResponse, StopReason, ToolCall } from '../../src/llm/types.js'
import { analysisTools, type AnalysisDeps } from '../../src/tools/analysis.js'
import { defineChangeTool } from '../../src/tools/define.js'
import { numberParam, stringParam } from '../../src/tools/params.js'
import {
  createRegistry,
  registryExecutor,
  toolDefinitions,
  type Registry,
} from '../../src/tools/registry.js'
import type { ChangeRow, Tool } from '../../src/tools/types.js'
import { loudness, mixReport } from '../tools/fixtures.js'

export const response = (
  text: string,
  toolCalls: readonly ToolCall[] = [],
  stopReason: StopReason = toolCalls.length > 0 ? 'tool_use' : 'end_turn',
): ChatResponse => ({
  text,
  toolCalls,
  stopReason,
  usage: { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100 },
  replay: { provider: 'anthropic', items: [] },
})

export const call = (id: string, name: string, input: ToolCall['input']): ToolCall => ({
  id,
  name,
  input,
})

export const scriptedChat = (script: readonly ChatResponse[]) => {
  const requests: ChatRequest[] = []
  const chat = async (request: ChatRequest) => {
    requests.push(request)
    const next = script[requests.length - 1]
    if (next === undefined) throw new Error(`No scripted response for request ${requests.length}`)
    return ok(next)
  }
  return { chat, requests }
}

export const analysisDeps: AnalysisDeps = {
  analyseFile: async () => ok(mixReport),
  measureLoudness: async () => ok(loudness),
}

export const faderTool = (applied: ChangeRow[][]) =>
  defineChangeTool({
    name: 'set_fader_db',
    description: 'Sets a track fader level in dB.',
    surface: 'control_surface',
    params: {
      track: stringParam('Track name'),
      db: numberParam('Fader level in dB', { minimum: -96, maximum: 12 }),
    },
    plan: async ({ track, db }) =>
      ok([
        { id: `${track}-fader`, control: 'fader', location: track, before: -10, after: db },
        { id: `${track}-mute`, control: 'mute', location: track, before: true, after: false },
      ]),
    apply: async (rows) => {
      applied.push([...rows])
      return { applied: rows.map((row) => row.id), failed: [] }
    },
  })

export const testRegistry = (tools: readonly Tool[]): Registry => {
  const registry = createRegistry(tools)
  if (!registry.ok) throw new Error(registry.error)
  return registry.value
}

export const configFor = (
  registry: Registry,
  overrides: Partial<AgentConfig> = {},
): AgentConfig => ({
  model: 'claude-sonnet-5-5',
  system: 'You are a mixing assistant.',
  maxOutputTokens: 1024,
  maxIterations: 5,
  proposalTtlMs: 60_000,
  tools: registry.tools.map((tool) => ({ definition: tool.definition, kind: tool.kind })),
  pricing: { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
  ...overrides,
})

export const harness = (script: readonly ChatResponse[], extraTools: readonly Tool[] = []) => {
  const applied: ChangeRow[][] = []
  const registry = testRegistry([...analysisTools(analysisDeps), faderTool(applied), ...extraTools])
  const { chat, requests } = scriptedChat(script)
  const notifications: AgentNotification[] = []
  const deps: AgentDeps = {
    chat,
    tools: registryExecutor(registry, { instanceId: 'instance-1' }),
    notify: (notification) => notifications.push(notification),
    now: () => 1_000,
  }
  return {
    deps,
    registry,
    requests,
    notifications,
    applied,
    definitions: toolDefinitions(registry.tools),
  }
}
