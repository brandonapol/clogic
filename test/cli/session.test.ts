import { afterEach, describe, expect, it } from 'vitest'
import {
  runChat,
  runSetKey,
  runStatus,
  sayHello,
  selectProvider,
  type Terminal,
} from '../../src/cli/session.js'
import { memoryKeyStore } from '../../src/llm/keystore.js'
import { connect, type RpcClient } from '../../src/rpc/socket.js'
import { call, response } from '../agent/fixtures.js'
import {
  scriptedLlm,
  startHarness,
  type Harness,
  type HarnessOptions,
} from '../companion/fixtures.js'

const instanceId = 'clogic-chat'
const fakeKey = 'test-key-openai'

type Scripted = {
  readonly terminal: Terminal
  readonly output: () => string
  readonly prompts: string[]
}

const scriptedTerminal = (
  answers: readonly (string | null)[],
  secret: string | null = null,
): Scripted => {
  const written: string[] = []
  const prompts: string[] = []
  const remaining = [...answers]
  return {
    terminal: {
      write: (text) => written.push(text),
      ask: async (prompt) => {
        prompts.push(prompt)
        return remaining.shift() ?? null
      },
      askSecret: async (prompt) => {
        prompts.push(prompt)
        return secret
      },
      onInterrupt: () => undefined,
    },
    output: () => written.join(''),
    prompts,
  }
}

let harness: Harness | undefined
let client: RpcClient | undefined

afterEach(async () => {
  await client?.close()
  await harness?.stop()
  client = undefined
  harness = undefined
})

const open = async (options: HarnessOptions, terminal: Terminal) => {
  harness = await startHarness(options)
  client = await connect({ path: harness.companion.path })
  expect(await sayHello(client, instanceId, terminal)).toBe(true)
  return { harness, client }
}

const proposeFader = () =>
  scriptedLlm([
    response('I will pull the vocal down.', [call('c1', 'set_fader_db', { track: 'Vox', db: -6 })]),
    response('Done.'),
  ])

describe('runChat', () => {
  it('streams a turn with a tool call and exits on /quit', async () => {
    const llm = scriptedLlm([
      response('Measuring the mix.', [call('c1', 'get_loudness', { path: '/tmp/mix.wav' })]),
      response('The mix is at -9.8 LUFS integrated.'),
    ])
    const script = scriptedTerminal(['How loud is my mix?', '/quit'])
    const { client } = await open({ llm: llm.factory, provider: 'anthropic' }, script.terminal)

    await runChat(client, script.terminal, instanceId)

    const output = script.output()
    expect(output).toContain('Measuring the mix.\n  [usage] 1000 in / 100 out tokens\n')
    expect(output).toContain('  [tool] get_loudness {"path":"/tmp/mix.wav"}\n')
    expect(output).toContain('  [tool] get_loudness ok: ')
    expect(output).toContain('The mix is at -9.8 LUFS integrated.\n')
    expect(script.prompts).toEqual(['> ', '> '])
    expect(llm.calls[0]?.request.messages[0]).toMatchObject({
      role: 'user',
      text: 'How loud is my mix?',
    })
  })

  it('previews a proposal and sends only the approved rows', async () => {
    const llm = proposeFader()
    const script = scriptedTerminal(['Turn the vocal down', 'maybe', '1', null])
    const { harness, client } = await open(
      { llm: llm.factory, provider: 'anthropic' },
      script.terminal,
    )

    await runChat(client, script.terminal, instanceId)

    expect(harness.applied).toEqual([
      [{ id: 'Vox-fader', control: 'fader', location: 'Vox', before: -10, after: -6 }],
    ])
    const output = script.output()
    expect(output).toContain(
      [
        'Proposed change proposal-c1: I will pull the vocal down.',
        '  1. Vox fader: -10 -> -6',
        '  2. Vox mute: true -> false',
      ].join('\n'),
    )
    expect(output).toContain('  Answer y, n or a list of row numbers\n')
    expect(output).toContain('  [change] proposal-c1 applied: 1 applied, 1 declined, 0 failed\n')
    expect(output).toContain('Done.\n')
    expect(script.prompts.filter((prompt) => prompt.startsWith('Apply?'))).toHaveLength(2)
  })

  it('declines every row when the user answers no', async () => {
    const llm = proposeFader()
    const script = scriptedTerminal(['Turn the vocal down', 'n', '/quit'])
    const { harness, client } = await open(
      { llm: llm.factory, provider: 'anthropic' },
      script.terminal,
    )

    await runChat(client, script.terminal, instanceId)

    expect(harness.applied).toEqual([])
    expect(script.output()).toContain(
      '  [change] proposal-c1 declined: 0 applied, 2 declined, 0 failed\n',
    )
  })

  it('reports a rejected chat.send and keeps the session open', async () => {
    const script = scriptedTerminal(['Hello', '/quit'])
    const { client } = await open({ llm: scriptedLlm([]).factory }, script.terminal)

    await runChat(client, script.terminal, instanceId)

    expect(script.output()).toContain('[error] chat.send failed')
    expect(script.prompts).toEqual(['> ', '> '])
  })

  it('selects a provider before chatting', async () => {
    const script = scriptedTerminal([])
    const { client } = await open({ llm: scriptedLlm([]).factory }, script.terminal)

    expect(await selectProvider(client, script.terminal, 'anthropic')).toBe(true)
    expect(await selectProvider(client, script.terminal, 'xai')).toBe(false)
    expect(script.output()).toContain('Using Anthropic.\n')
  })
})

describe('runSetKey', () => {
  it('sends the hidden key with keys.set and never writes it out', async () => {
    const keyStore = memoryKeyStore()
    const script = scriptedTerminal([], fakeKey)
    const { client } = await open({ llm: scriptedLlm([]).factory, keyStore }, script.terminal)

    expect(await runSetKey(client, script.terminal, 'openai')).toBe(true)

    expect(await keyStore.get('openai')).toEqual({ ok: true, value: fakeKey })
    expect(script.prompts).toEqual(['OpenAI API key (input hidden): '])
    expect(script.output()).toBe('OpenAI API key saved.\n')
    expect(script.output()).not.toContain(fakeKey)
  })

  it('reports a rejected key without echoing it', async () => {
    const keyStore = memoryKeyStore()
    const script = scriptedTerminal([], 'test key openai')
    const { client } = await open({ llm: scriptedLlm([]).factory, keyStore }, script.terminal)

    expect(await runSetKey(client, script.terminal, 'openai')).toBe(false)

    expect(await keyStore.get('openai')).toEqual({ ok: true, value: undefined })
    expect(script.output()).toContain('[error] keys.set failed')
    expect(script.output()).not.toContain('test key openai')
  })

  it('saves nothing when the prompt is cancelled or empty', async () => {
    const keyStore = memoryKeyStore()
    const cancelled = scriptedTerminal([], null)
    const { client } = await open({ llm: scriptedLlm([]).factory, keyStore }, cancelled.terminal)

    expect(await runSetKey(client, cancelled.terminal, 'openai')).toBe(false)
    expect(await runSetKey(client, scriptedTerminal([], '  ').terminal, 'openai')).toBe(false)
    expect(cancelled.output()).toBe('No key entered; nothing saved.\n')
    expect(await keyStore.get('openai')).toEqual({ ok: true, value: undefined })
  })
})

describe('runStatus', () => {
  it('prints which providers have keys and the active provider', async () => {
    const script = scriptedTerminal([])
    const { client } = await open(
      { llm: scriptedLlm([]).factory, provider: 'anthropic' },
      script.terminal,
    )

    expect(await runStatus(client, script.terminal)).toBe(true)

    expect(script.output()).toBe(
      'Active provider: Anthropic\n  Anthropic  key saved\n  OpenAI     no key\n  xAI        no key\n',
    )
  })
})
