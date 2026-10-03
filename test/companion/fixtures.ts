import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  startCompanion,
  type Companion,
  type LlmClientFactory,
} from '../../src/companion/service.js'
import type { SettingsOverrides } from '../../src/companion/config.js'
import type { Logger } from '../../src/log/logger.js'
import { readTools, type ReadToolDeps } from '../../src/companion/tools.js'
import { memoryKeyStore, type KeyStore } from '../../src/llm/keystore.js'
import { ok } from '../../src/llm/result.js'
import type { ChatRequest, ChatResponse, ProviderId } from '../../src/llm/types.js'
import type { CompanionNotification } from '../../src/rpc/messages.js'
import { connect, type RpcClient } from '../../src/rpc/socket.js'
import type { ChangeRow, Tool } from '../../src/tools/types.js'
import { analysisDeps, faderTool } from '../agent/fixtures.js'
import { fakeDeps } from '../tools/stems/fixtures.js'

export const instanceId = 'instance-1'

export const toolDeps: ReadToolDeps = { analysis: analysisDeps, stems: fakeDeps({}).deps }

export const anthropicKey = 'sk-ant-test-FAKEFAKEFAKEFAKE'
export const openaiKey = 'sk-proj-test-FAKEFAKEFAKEFAKE'

export type LlmCall = {
  readonly provider: ProviderId
  readonly apiKey: string
  readonly request: ChatRequest
}

export type Gate = {
  readonly wait: Promise<void>
  readonly open: () => void
}

export const gate = (): Gate => {
  let open: () => void = () => undefined
  const wait = new Promise<void>((resolve) => {
    open = resolve
  })
  return { wait, open }
}

export const scriptedLlm = (
  script: readonly ChatResponse[],
  gates: readonly (Gate | undefined)[] = [],
) => {
  const calls: LlmCall[] = []
  const factory: LlmClientFactory = (provider, apiKey) => async (request) => {
    const index = calls.length
    calls.push({ provider, apiKey, request })
    await gates[index]?.wait
    const next = script[index]
    if (next === undefined) throw new Error(`No scripted response for call ${index + 1}`)
    return ok(next)
  }
  return { calls, factory }
}

export type Harness = {
  readonly companion: Companion
  readonly client: RpcClient
  readonly notifications: CompanionNotification[]
  readonly raw: () => string
  readonly applied: ChangeRow[][]
  readonly waitFor: (
    predicate: (notification: CompanionNotification) => boolean,
  ) => Promise<CompanionNotification>
  readonly stop: () => Promise<void>
}

export type HarnessOptions = {
  readonly llm: LlmClientFactory
  readonly keyStore?: KeyStore
  readonly provider?: ProviderId
  readonly tools?: readonly Tool[]
  readonly now?: () => number
  readonly settings?: SettingsOverrides
  readonly logger?: Logger
}

export const startHarness = async (options: HarnessOptions): Promise<Harness> => {
  const dir = await mkdtemp(join(tmpdir(), 'clogic-companion-'))
  const applied: ChangeRow[][] = []
  const companion = await startCompanion({
    socketPath: join(dir, 'c.sock'),
    keyStore: options.keyStore ?? memoryKeyStore({ anthropic: anthropicKey }),
    llmClient: options.llm,
    tools: options.tools ?? [...readTools(toolDeps), faderTool(applied)],
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    now: options.now ?? (() => Date.parse('2026-10-02T12:00:00Z')),
    ...(options.settings === undefined ? {} : { settings: options.settings }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  })
  const client = await connect({ path: companion.path })
  const notifications: CompanionNotification[] = []
  const waiters: {
    readonly predicate: (notification: CompanionNotification) => boolean
    readonly resolve: (notification: CompanionNotification) => void
  }[] = []
  client.onNotification((notification) => {
    notifications.push(notification)
    waiters
      .filter((waiter) => waiter.predicate(notification))
      .forEach((waiter) => {
        waiters.splice(waiters.indexOf(waiter), 1)
        waiter.resolve(notification)
      })
  })
  const hello = await client.request('session.hello', {
    instanceId,
    contextName: 'Vox',
    sampleRate: 48000,
    protocolVersion: 1,
    client: 'test-plugin',
  })
  if (!hello.ok) throw new Error(hello.error.message)
  return {
    companion,
    client,
    notifications,
    raw: () => JSON.stringify(notifications),
    applied,
    waitFor: (predicate) => {
      const seen = notifications.find(predicate)
      if (seen !== undefined) return Promise.resolve(seen)
      return new Promise((resolve) => {
        waiters.push({ predicate, resolve })
      })
    },
    stop: async () => {
      await client.close()
      await companion.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

export const methods = (notifications: readonly CompanionNotification[]) =>
  notifications.map((notification) => notification.method)

export const isDone = (notification: CompanionNotification) => notification.method === 'chat.done'
