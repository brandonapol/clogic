import { err, type Result } from '../llm/result.js'
import type { ChatRequest, ChatResponse } from '../llm/types.js'
import type { ToolExecutor } from '../tools/registry.js'
import type { ToolError } from '../tools/types.js'
import { step } from './step.js'
import type {
  AgentEffect,
  AgentEvent,
  AgentLlmError,
  AgentNotification,
  AgentState,
} from './types.js'

export type AgentDeps = {
  readonly chat: (request: ChatRequest) => Promise<Result<ChatResponse, AgentLlmError>>
  readonly tools: ToolExecutor
  readonly notify: (notification: AgentNotification) => void
  readonly now: () => number
}

type WorkEffect = Exclude<AgentEffect, { readonly type: 'notify' }>

const isWork = (effect: AgentEffect): effect is WorkEffect => effect.type !== 'notify'

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

const toolFailure = (cause: unknown): ToolError => ({ kind: 'failed', message: messageOf(cause) })

const guard = async <T, E>(
  task: () => Promise<Result<T, E>>,
  onThrow: (cause: unknown) => E,
): Promise<Result<T, E>> => {
  try {
    return await task()
  } catch (cause) {
    return err(onThrow(cause))
  }
}

const perform = async (deps: AgentDeps, effect: WorkEffect): Promise<AgentEvent> => {
  switch (effect.type) {
    case 'call_llm':
      return {
        type: 'llm_response',
        requestId: effect.requestId,
        result: await guard(
          () => deps.chat(effect.request),
          (cause): AgentLlmError => ({ kind: 'exception', message: messageOf(cause) }),
        ),
      }
    case 'run_tool':
      return {
        type: 'tool_result',
        callId: effect.call.id,
        result: await guard(() => deps.tools.run(effect.call.name, effect.call.input), toolFailure),
      }
    case 'plan_change': {
      const result = await guard(
        () => deps.tools.plan(effect.call.name, effect.call.input),
        toolFailure,
      )
      return { type: 'change_planned', callId: effect.call.id, at: deps.now(), result }
    }
    case 'apply_change': {
      const report = await deps.tools
        .apply(effect.toolName, effect.rows)
        .catch((cause: unknown) => ({
          applied: [],
          failed: effect.rows.map((row) => ({ id: row.id, message: messageOf(cause) })),
        }))
      return { type: 'change_applied', proposalId: effect.proposalId, report }
    }
  }
}

export const drive = async (
  deps: AgentDeps,
  state: AgentState,
  event: AgentEvent,
): Promise<AgentState> => {
  const next = step(state, event)
  next.effects.forEach((effect) => {
    if (effect.type === 'notify') deps.notify(effect.notification)
  })
  const work = next.effects.find(isWork)
  return work === undefined ? next.state : drive(deps, next.state, await perform(deps, work))
}
