import { err, ok, type Result } from '../llm/result.js'
import { providerIds, type ProviderId } from '../llm/types.js'

export type CliCommand =
  | { readonly kind: 'help' }
  | {
      readonly kind: 'chat'
      readonly socketPath: string
      readonly instanceId: string
      readonly provider: ProviderId | null
    }
  | {
      readonly kind: 'set-key'
      readonly socketPath: string
      readonly instanceId: string
      readonly provider: ProviderId
    }
  | { readonly kind: 'status'; readonly socketPath: string; readonly instanceId: string }

export const defaultInstanceId = 'clogic-chat'

export const usage = [
  'Usage:',
  '  clogic-chat [--socket <path>] [--instance <id>] [--provider <provider>]',
  '  clogic-chat --set-key <provider> [--socket <path>]',
  '  clogic-chat --status [--socket <path>]',
  '  clogic-chat --help',
  '',
  `Providers: ${providerIds.join(', ')}`,
  'The socket defaults to $CLOGIC_SOCKET.',
  '--set-key reads the API key from a hidden prompt (or the first line of piped stdin).',
  'Chat commands: /quit to exit, Ctrl-C to cancel the running turn.',
].join('\n')

type Flags = {
  readonly socket?: string
  readonly instance?: string
  readonly provider?: string
  readonly setKey?: string
  readonly status?: true
  readonly help?: true
}

const valueFlags = {
  '--socket': 'socket',
  '--instance': 'instance',
  '--provider': 'provider',
  '--set-key': 'setKey',
} as const

const switchFlags = { '--status': 'status', '--help': 'help', '-h': 'help' } as const

const isKey = <T extends object>(table: T, key: string): key is Extract<keyof T, string> =>
  Object.hasOwn(table, key)

const safeToEcho = (arg: string): boolean => /^--?[a-z][a-z-]{0,30}$/.test(arg)

const unexpected = (arg: string, position: number): string =>
  safeToEcho(arg)
    ? `Unknown option ${arg}`
    : `Unexpected argument at position ${position}; API keys are read from a hidden prompt, never from the command line`

const collect = (argv: readonly string[], index: number, flags: Flags): Result<Flags, string> => {
  const arg = argv[index]
  if (arg === undefined) return ok(flags)
  if (isKey(switchFlags, arg))
    return collect(argv, index + 1, { ...flags, [switchFlags[arg]]: true })
  if (!isKey(valueFlags, arg)) return err(unexpected(arg, index + 1))
  const value = argv[index + 1]
  if (value === undefined || value.length === 0 || value.startsWith('--'))
    return err(`${arg} needs a value`)
  return collect(argv, index + 2, { ...flags, [valueFlags[arg]]: value })
}

const isProviderId = (value: string): value is ProviderId =>
  (providerIds as readonly string[]).includes(value)

const parseProvider = (value: string): Result<ProviderId, string> =>
  isProviderId(value)
    ? ok(value)
    : err(
        /^[a-z]{1,16}$/.test(value)
          ? `Unknown provider ${value}; expected one of ${providerIds.join(', ')}`
          : `Unknown provider; expected one of ${providerIds.join(', ')}`,
      )

export const parseArgs = (
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Result<CliCommand, string> => {
  const collected = collect(argv, 0, {})
  if (!collected.ok) return collected
  const flags = collected.value
  if (flags.help === true) return ok({ kind: 'help' })
  if (flags.setKey !== undefined && flags.status === true)
    return err('Use either --set-key or --status, not both')
  const socketPath = flags.socket ?? env['CLOGIC_SOCKET'] ?? ''
  if (socketPath.length === 0)
    return err('No socket path: pass --socket <path> or set CLOGIC_SOCKET')
  const instanceId = flags.instance ?? defaultInstanceId
  if (flags.status === true) return ok({ kind: 'status', socketPath, instanceId })
  if (flags.setKey !== undefined) {
    const provider = parseProvider(flags.setKey)
    return provider.ok
      ? ok({ kind: 'set-key', socketPath, instanceId, provider: provider.value })
      : provider
  }
  if (flags.provider === undefined)
    return ok({ kind: 'chat', socketPath, instanceId, provider: null })
  const provider = parseProvider(flags.provider)
  return provider.ok
    ? ok({ kind: 'chat', socketPath, instanceId, provider: provider.value })
    : provider
}
