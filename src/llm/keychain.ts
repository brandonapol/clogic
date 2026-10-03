import { execFile, type ExecFileException } from 'node:child_process'
import { normalizeApiKey, type KeyStore, type KeyStoreError } from './keystore.js'
import { redactSecrets } from './redact.js'
import { err, ok, type Result } from './result.js'
import type { ProviderId } from './types.js'

export type CommandResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  stdin: string | undefined,
) => Promise<CommandResult>

export const securityPath = '/usr/bin/security'
export const defaultKeychainService = 'clogic.llm-api-key'
export const itemNotFoundExitCode = 44

const safeToken = /^[A-Za-z0-9._-]+$/

const toHex = (text: string): string => Buffer.from(text, 'utf8').toString('hex')

export const findKeyArgs = (service: string, account: string): readonly string[] => [
  'find-generic-password',
  '-s',
  service,
  '-a',
  account,
  '-w',
]

export const deleteKeyArgs = (service: string, account: string): readonly string[] => [
  'delete-generic-password',
  '-s',
  service,
  '-a',
  account,
]

export const interactiveArgs: readonly string[] = ['-i']

export const addKeyScript = (service: string, account: string, apiKey: string): string =>
  `add-generic-password -U -s ${service} -a ${account} -X ${toHex(apiKey)}\n`

const failure = (result: CommandResult, secrets: readonly string[]): KeyStoreError => ({
  kind: 'command_failed',
  message: redactSecrets(
    `security exited with ${result.exitCode}: ${result.stderr.trim()}`,
    secrets,
  ),
})

const isNotFound = (result: CommandResult): boolean =>
  result.exitCode === itemNotFoundExitCode || /could not be found/i.test(result.stderr)

export const nodeCommandRunner: CommandRunner = (command, args, stdin) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      command,
      [...args],
      { encoding: 'utf8' },
      (error: ExecFileException | null, stdout: string, stderr: string) => {
        if (error === null) return resolve({ exitCode: 0, stdout, stderr })
        if (typeof error.code === 'number') return resolve({ exitCode: error.code, stdout, stderr })
        reject(error)
      },
    )
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(stdin ?? '')
  })

const runSafely = async (
  runner: CommandRunner,
  args: readonly string[],
  stdin: string | undefined,
  secrets: readonly string[],
): Promise<Result<CommandResult, KeyStoreError>> => {
  try {
    return ok(await runner(securityPath, args, stdin))
  } catch (cause) {
    return err({
      kind: 'unavailable',
      message: redactSecrets(cause instanceof Error ? cause.message : String(cause), secrets),
    })
  }
}

export const keychainKeyStore = (
  runner: CommandRunner = nodeCommandRunner,
  service: string = defaultKeychainService,
): KeyStore => {
  if (!safeToken.test(service)) throw new Error(`Invalid keychain service name: ${service}`)
  return {
    get: async (provider: ProviderId) => {
      const run = await runSafely(runner, findKeyArgs(service, provider), undefined, [])
      if (!run.ok) return run
      if (isNotFound(run.value)) return ok(undefined)
      if (run.value.exitCode !== 0) return err(failure(run.value, [run.value.stdout.trim()]))
      return ok(run.value.stdout.replace(/\n$/, ''))
    },
    set: async (provider: ProviderId, apiKey: string) => {
      const normalized = normalizeApiKey(apiKey)
      if (!normalized.ok) return normalized
      const secrets = [normalized.value, toHex(normalized.value)]
      const script = addKeyScript(service, provider, normalized.value)
      const run = await runSafely(runner, interactiveArgs, script, secrets)
      if (!run.ok) return run
      return run.value.exitCode === 0 ? ok(undefined) : err(failure(run.value, secrets))
    },
    remove: async (provider: ProviderId) => {
      const run = await runSafely(runner, deleteKeyArgs(service, provider), undefined, [])
      if (!run.ok) return run
      if (run.value.exitCode === 0 || isNotFound(run.value)) return ok(undefined)
      return err(failure(run.value, []))
    },
  }
}
