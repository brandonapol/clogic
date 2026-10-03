#!/usr/bin/env node
import { connect, type RpcClient } from '../rpc/socket.js'
import { parseArgs, usage } from './args.js'
import { runChat, runSetKey, runStatus, sayHello, selectProvider } from './session.js'
import { nodeTerminal } from './terminal.js'

const parsed = parseArgs(process.argv.slice(2), process.env)

if (!parsed.ok) {
  process.stderr.write(`${parsed.error}\n\n${usage}\n`)
  process.exit(2)
}

const command = parsed.value

if (command.kind === 'help') {
  process.stdout.write(`${usage}\n`)
  process.exit(0)
}

const errorCode = (error: unknown): string =>
  error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'unknown error'

const client: RpcClient = await connect({ path: command.socketPath }).catch((error: unknown) => {
  process.stderr.write(
    `Could not connect to the companion at ${command.socketPath} (${errorCode(error)}). Is clogic-companion running?\n`,
  )
  return process.exit(1)
})

const terminal = nodeTerminal(process.stdin, process.stdout)
void client.closed.then(() => terminal.close())

const run = async (): Promise<boolean> => {
  if (!(await sayHello(client, command.instanceId, terminal))) return false
  switch (command.kind) {
    case 'status':
      return runStatus(client, terminal)
    case 'set-key':
      return runSetKey(client, terminal, command.provider)
    case 'chat':
      if (command.provider !== null && !(await selectProvider(client, terminal, command.provider)))
        return false
      await runChat(client, terminal, command.instanceId)
      return true
  }
}

const succeeded = await run()
terminal.close()
await client.close()
process.exit(succeeded ? 0 : 1)
