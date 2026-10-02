import { describe, expect, it } from 'vitest'
import {
  addKeyScript,
  keychainKeyStore,
  nodeCommandRunner,
  securityPath,
  type CommandResult,
  type CommandRunner,
} from '../../src/llm/keychain.js'

type Invocation = {
  readonly command: string
  readonly args: readonly string[]
  readonly stdin: string | undefined
}

const fakeRunner = (results: readonly CommandResult[]) => {
  const invocations: Invocation[] = []
  const runner: CommandRunner = async (command, args, stdin) => {
    const result = results[invocations.length]
    invocations.push({ command, args, stdin })
    if (result === undefined) throw new Error('unexpected command')
    return result
  }
  return { runner, invocations }
}

const success = (stdout = ''): CommandResult => ({ exitCode: 0, stdout, stderr: '' })
const key = 'sk-ant-api03-SECRETSECRETSECRET'
const keyHex = Buffer.from(key, 'utf8').toString('hex')

describe('keychainKeyStore.set', () => {
  it('passes the key through stdin as hex, never on the command line', async () => {
    const { runner, invocations } = fakeRunner([success()])
    const result = await keychainKeyStore(runner).set('anthropic', `${key}\n`)
    expect(result).toEqual({ ok: true, value: undefined })
    expect(invocations).toEqual([
      {
        command: securityPath,
        args: ['-i'],
        stdin: `add-generic-password -U -s clogic.llm-api-key -a anthropic -X ${keyHex}\n`,
      },
    ])
    expect(invocations[0]?.args.join(' ')).not.toContain(key)
  })

  it('produces a script line the security -i tokenizer reads as plain tokens', () => {
    const script = addKeyScript('svc', 'openai', 'sk-"quoted" \\ key')
    expect(script).toMatch(/^add-generic-password -U -s svc -a openai -X [0-9a-f]+\n$/)
  })

  it('redacts the key and its hex form from failure messages', async () => {
    const { runner } = fakeRunner([
      { exitCode: 1, stdout: '', stderr: `bad input ${key} / ${keyHex}` },
    ])
    const result = await keychainKeyStore(runner).set('anthropic', key)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.kind).toBe('command_failed')
    expect(result.error.message).not.toContain(key)
    expect(result.error.message).not.toContain(keyHex)
  })

  it('rejects an invalid key without running security', async () => {
    const { runner, invocations } = fakeRunner([])
    const result = await keychainKeyStore(runner).set('openai', '')
    expect(result.ok).toBe(false)
    expect(invocations).toHaveLength(0)
  })
})

describe('keychainKeyStore.get', () => {
  it('reads the password with find-generic-password -w and strips the newline', async () => {
    const { runner, invocations } = fakeRunner([success(`${key}\n`)])
    expect(await keychainKeyStore(runner).get('xai')).toEqual({ ok: true, value: key })
    expect(invocations[0]?.args).toEqual([
      'find-generic-password',
      '-s',
      'clogic.llm-api-key',
      '-a',
      'xai',
      '-w',
    ])
  })

  it('treats exit code 44 (errSecItemNotFound) as no key', async () => {
    const { runner } = fakeRunner([
      {
        exitCode: 44,
        stdout: '',
        stderr:
          'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.',
      },
    ])
    expect(await keychainKeyStore(runner).get('openai')).toEqual({ ok: true, value: undefined })
  })

  it('reports other failures as values', async () => {
    const { runner } = fakeRunner([
      { exitCode: 51, stdout: '', stderr: 'User interaction is not allowed.' },
    ])
    const result = await keychainKeyStore(runner).get('openai')
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'command_failed',
        message: 'security exited with 51: User interaction is not allowed.',
      },
    })
  })

  it('reports a missing security binary as unavailable', async () => {
    const runner: CommandRunner = async () => {
      throw new Error('spawn /usr/bin/security ENOENT')
    }
    const result = await keychainKeyStore(runner).get('openai')
    expect(result.ok || result.error.kind).toBe('unavailable')
  })
})

describe('keychainKeyStore.remove', () => {
  it('deletes the item and treats a missing item as success', async () => {
    const { runner, invocations } = fakeRunner([
      success(),
      { exitCode: 44, stdout: '', stderr: 'could not be found' },
    ])
    const store = keychainKeyStore(runner)
    expect((await store.remove('anthropic')).ok).toBe(true)
    expect((await store.remove('anthropic')).ok).toBe(true)
    expect(invocations[0]?.args).toEqual([
      'delete-generic-password',
      '-s',
      'clogic.llm-api-key',
      '-a',
      'anthropic',
    ])
  })
})

describe('keychainKeyStore construction', () => {
  it('refuses a service name that would need quoting in security -i', () => {
    expect(() => keychainKeyStore(fakeRunner([]).runner, 'bad name')).toThrow()
  })
})

describe('nodeCommandRunner', () => {
  it('rejects when the command cannot be spawned, so callers report unavailable', async () => {
    await expect(
      nodeCommandRunner('/nonexistent/clogic-security', ['-h'], undefined),
    ).rejects.toThrow(/ENOENT/)
  })

  it('returns the exit code, stdout and stdin round trip of a real command', async () => {
    expect(await nodeCommandRunner('/bin/sh', ['-c', 'cat; exit 3'], 'hello')).toEqual({
      exitCode: 3,
      stdout: 'hello',
      stderr: '',
    })
  })
})
