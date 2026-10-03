import { describe, expect, it } from 'vitest'
import { defaultInstanceId, parseArgs } from '../../src/cli/args.js'

const env = { CLOGIC_SOCKET: '/tmp/clogic.sock' }

describe('parseArgs', () => {
  it('defaults to chat on the socket from CLOGIC_SOCKET', () => {
    expect(parseArgs([], env)).toEqual({
      ok: true,
      value: {
        kind: 'chat',
        socketPath: '/tmp/clogic.sock',
        instanceId: defaultInstanceId,
        provider: null,
      },
    })
  })

  it('prefers --socket over the environment and accepts instance and provider', () => {
    expect(
      parseArgs(
        ['--socket', '/tmp/other.sock', '--instance', 'dev-1', '--provider', 'openai'],
        env,
      ),
    ).toEqual({
      ok: true,
      value: {
        kind: 'chat',
        socketPath: '/tmp/other.sock',
        instanceId: 'dev-1',
        provider: 'openai',
      },
    })
  })

  it('parses --set-key with a provider', () => {
    expect(parseArgs(['--set-key', 'xai'], env)).toMatchObject({
      ok: true,
      value: { kind: 'set-key', provider: 'xai' },
    })
  })

  it('parses --status and --help', () => {
    expect(parseArgs(['--status'], env)).toMatchObject({ ok: true, value: { kind: 'status' } })
    expect(parseArgs(['--help'], {})).toEqual({ ok: true, value: { kind: 'help' } })
    expect(parseArgs(['-h', '--status'], {})).toEqual({ ok: true, value: { kind: 'help' } })
  })

  it('requires a socket path', () => {
    expect(parseArgs([], {})).toMatchObject({ ok: false })
    expect(parseArgs([], { CLOGIC_SOCKET: '' })).toMatchObject({ ok: false })
  })

  it('rejects unknown providers, missing values and conflicting modes', () => {
    expect(parseArgs(['--set-key', 'gemini'], env)).toEqual({
      ok: false,
      error: 'Unknown provider gemini; expected one of anthropic, openai, xai',
    })
    expect(parseArgs(['--set-key'], env)).toEqual({ ok: false, error: '--set-key needs a value' })
    expect(parseArgs(['--socket', '--status'], env)).toMatchObject({ ok: false })
    expect(parseArgs(['--set-key', 'openai', '--status'], env)).toMatchObject({ ok: false })
    expect(parseArgs(['--verbose'], env)).toEqual({ ok: false, error: 'Unknown option --verbose' })
  })

  it('never echoes a key passed on the command line', () => {
    const parsed = parseArgs(['--set-key', 'openai', 'test-key-openai'], env)

    expect(parsed.ok).toBe(false)
    expect(JSON.stringify(parsed)).not.toContain('test-key-openai')
    expect(parsed).toMatchObject({ error: expect.stringContaining('hidden prompt') })
  })

  it('never echoes a key passed in place of the provider', () => {
    const parsed = parseArgs(['--set-key', 'test-key-openai'], env)

    expect(parsed.ok).toBe(false)
    expect(JSON.stringify(parsed)).not.toContain('test-key-openai')
  })
})
