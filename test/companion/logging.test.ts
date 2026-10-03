import { afterEach, describe, expect, it } from 'vitest'
import type { LlmClientFactory } from '../../src/companion/service.js'
import { secretCache, trackingKeyStore } from '../../src/companion/secrets.js'
import { memoryKeyStore } from '../../src/llm/keystore.js'
import { err, ok } from '../../src/llm/result.js'
import { createLogger, type Logger } from '../../src/log/logger.js'
import { createStderrSink } from '../../src/log/sinks.js'
import { defineReadTool } from '../../src/tools/define.js'
import { stringParam } from '../../src/tools/params.js'
import { call, response } from '../agent/fixtures.js'
import { instanceId, isDone, startHarness, type Harness } from './fixtures.js'

const patternKey = [['s', 'k'].join(''), 'ant', 'api03', 'Lg9'.repeat(14)].join('-')
const opaqueKey = ['Kq', '7x'.repeat(20), 'Wm'].join('')

let harness: Harness | undefined

afterEach(async () => {
  await harness?.stop()
  harness = undefined
})

const leakyTool = defineReadTool({
  name: 'read_session_notes',
  description: 'Reads session notes.',
  surface: 'analysis',
  params: { note: stringParam('Note name') },
  run: async () => {
    throw new Error(`notes service refused credentials ${patternKey} and ${opaqueKey}`)
  },
})

const leakyLlm = (): LlmClientFactory => {
  let calls = 0
  return (provider, apiKey) => async () => {
    calls += 1
    if (calls === 1) throw new Error(`socket hang up while sending ${apiKey}`)
    if (calls === 2)
      return err({ kind: 'auth', provider, status: 401, message: `Key ${apiKey} was rejected` })
    if (calls === 3) return ok(response('', [call('c1', 'read_session_notes', { note: 'a' })]))
    return ok(response(`Done, key ${apiKey} worked.`))
  }
}

const start = async () => {
  const lines: string[] = []
  const cache = secretCache()
  const logger: Logger = createLogger({
    now: () => Date.parse('2026-10-02T12:00:00Z'),
    sinks: [createStderrSink({ write: (line) => lines.push(line) })],
    secrets: cache.list,
    level: 'debug',
  })
  harness = await startHarness({
    llm: leakyLlm(),
    keyStore: trackingKeyStore(memoryKeyStore(), cache),
    tools: [leakyTool],
    logger,
    secrets: cache.list,
  })
  return { h: harness, lines, logger }
}

const turn = async (h: Harness, text: string, turnId: string) => {
  await h.client.request('chat.send', { instanceId, text })
  await h.waitFor((n) => isDone(n) && n.params.turnId === turnId)
}

const exposes = (text: string) => text.includes(patternKey) || text.includes(opaqueKey)

describe('companion logging', () => {
  it('logs requests, LLM errors and tool failures without ever recording a key', async () => {
    const { h, lines, logger } = await start()

    await h.client.request('keys.set', { provider: 'openai', key: opaqueKey })
    await h.client.request('keys.set', { provider: 'anthropic', key: patternKey })
    await h.client.request('provider.select', { provider: 'anthropic' })
    await turn(h, `here is my key ${patternKey} and ${opaqueKey}`, 'turn-1')
    await turn(h, 'try again', 'turn-2')
    await turn(h, 'read my notes', 'turn-3')
    const plain = await h.client.request('diagnostics.export', {})
    const full = await h.client.request('diagnostics.export', { includeContent: true })

    const events = logger.recent().map((record) => record.event)
    expect(events).toEqual(
      expect.arrayContaining(['rpc.request', 'llm.error', 'tool.failed', 'chat.error']),
    )
    expect(
      logger
        .recent()
        .filter((record) => record.event === 'rpc.request')
        .map((record) => record.fields['method']),
    ).toEqual(
      expect.arrayContaining(['session.hello', 'keys.set', 'chat.send', 'diagnostics.export']),
    )
    expect(logger.recent().find((r) => r.event === 'llm.error')?.context).toEqual({
      component: 'llm',
    })

    expect(plain.ok && full.ok).toBe(true)
    if (!plain.ok || !full.ok) return
    expect(plain.value.includesContent).toBe(false)
    expect(full.value.includesContent).toBe(true)
    expect(plain.value.text).toContain(`platform: ${process.platform}`)
    expect(JSON.parse(plain.value.json)).toMatchObject({
      format: 'clogic-diagnostics',
      os: { platform: process.platform },
    })

    expect(lines.length).toBeGreaterThan(0)
    expect(exposes(lines.join(''))).toBe(false)
    expect(exposes(JSON.stringify(logger.recent()))).toBe(false)
    expect(exposes(plain.value.json + plain.value.text)).toBe(false)
    expect(exposes(full.value.json + full.value.text)).toBe(false)
  })

  it('logs a protocol problem without echoing the offending line', async () => {
    const { logger } = await start()
    const { createConnection } = await import('node:net')
    const path = harness?.companion.path ?? ''
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection(path)
      socket.on('data', () => {
        socket.destroy()
        resolve()
      })
      socket.on('error', reject)
      socket.write(`{"broken": "${opaqueKey}"\n`)
    })

    const problem = logger.recent().find((record) => record.event === 'rpc.problem')
    expect(problem?.fields).toMatchObject({ kind: 'decode' })
    expect(exposes(JSON.stringify(logger.recent()))).toBe(false)
  })
})
