import { providerNames } from '../llm/errors.js'
import { redactSecrets } from '../llm/redact.js'
import type { ProviderId } from '../llm/types.js'
import { protocolVersion } from '../rpc/handshake.js'
import type { ChangeProposedParams, CompanionNotification } from '../rpc/messages.js'
import type { RpcClient } from '../rpc/socket.js'
import { approvalPrompt, parseApproval } from './approval.js'
import { initialRenderState, renderNotification, renderRpcError, renderStatus } from './render.js'

export type Terminal = {
  readonly write: (text: string) => void
  readonly ask: (prompt: string) => Promise<string | null>
  readonly askSecret: (prompt: string) => Promise<string | null>
  readonly onInterrupt: (listener: () => boolean) => void
}

export const clientName = 'clogic-chat'

export const sayHello = async (client: RpcClient, instanceId: string, terminal: Terminal) => {
  const hello = await client.request('session.hello', {
    instanceId,
    contextName: null,
    sampleRate: null,
    protocolVersion,
    client: clientName,
  })
  if (!hello.ok) terminal.write(renderRpcError('session.hello', hello.error))
  return hello.ok
}

export const runStatus = async (client: RpcClient, terminal: Terminal): Promise<boolean> => {
  const status = await client.request('keys.status', {})
  terminal.write(
    status.ok ? renderStatus(status.value) : renderRpcError('keys.status', status.error),
  )
  return status.ok
}

export const runSetKey = async (
  client: RpcClient,
  terminal: Terminal,
  provider: ProviderId,
): Promise<boolean> => {
  const key = await terminal.askSecret(`${providerNames[provider]} API key (input hidden): `)
  if (key === null || key.trim().length === 0) {
    terminal.write('No key entered; nothing saved.\n')
    return false
  }
  const stored = await client.request('keys.set', { provider, key })
  if (!stored.ok) {
    const message = redactSecrets(stored.error.message, [key, key.trim()])
    terminal.write(renderRpcError('keys.set', { code: stored.error.code, message }))
    return false
  }
  terminal.write(`${providerNames[provider]} API key saved.\n`)
  return true
}

type Signal =
  | { readonly kind: 'proposal'; readonly params: ChangeProposedParams }
  | { readonly kind: 'done'; readonly turnId: string }
  | { readonly kind: 'closed' }

const signalQueue = () => {
  const items: Signal[] = []
  let wake: (() => void) | undefined
  return {
    push: (signal: Signal) => {
      items.push(signal)
      wake?.()
      wake = undefined
    },
    drain: (): readonly Signal[] => items.splice(0, items.length),
    next: async (): Promise<Signal> => {
      for (;;) {
        const first = items.shift()
        if (first !== undefined) return first
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    },
  }
}

const isFor = (instanceId: string, notification: CompanionNotification): boolean =>
  notification.params.instanceId === null || notification.params.instanceId === instanceId

const decide = async (
  client: RpcClient,
  terminal: Terminal,
  instanceId: string,
  proposal: ChangeProposedParams,
): Promise<void> => {
  const ask = async (): Promise<readonly string[]> => {
    const answer = await terminal.ask(approvalPrompt(proposal.rows.length))
    if (answer === null) return []
    const parsed = parseApproval(answer, proposal.rows)
    if (parsed.ok) return parsed.value
    terminal.write(`  ${parsed.error}\n`)
    return ask()
  }
  const acceptedRowIds = await ask()
  const decided = await client.request('change.decide', {
    instanceId,
    proposalId: proposal.proposalId,
    acceptedRowIds,
  })
  if (!decided.ok) terminal.write(renderRpcError('change.decide', decided.error))
}

export const selectProvider = async (
  client: RpcClient,
  terminal: Terminal,
  provider: ProviderId,
): Promise<boolean> => {
  const selected = await client.request('provider.select', { provider })
  terminal.write(
    selected.ok
      ? `Using ${providerNames[selected.value.activeProvider]}.\n`
      : renderRpcError('provider.select', selected.error),
  )
  return selected.ok
}

export const runChat = async (
  client: RpcClient,
  terminal: Terminal,
  instanceId: string,
): Promise<void> => {
  const signals = signalQueue()
  let render = initialRenderState
  let activeTurn: string | null = null

  client.onNotification((notification) => {
    if (!isFor(instanceId, notification)) return
    const rendered = renderNotification(render, notification)
    render = rendered.state
    terminal.write(rendered.output)
    if (notification.method === 'change.proposed')
      signals.push({ kind: 'proposal', params: notification.params })
    if (notification.method === 'chat.done')
      signals.push({ kind: 'done', turnId: notification.params.turnId })
  })
  void client.closed.then(() => signals.push({ kind: 'closed' }))

  terminal.onInterrupt(() => {
    if (activeTurn === null) return false
    void client.request('chat.cancel', { instanceId, turnId: activeTurn })
    return true
  })

  const awaitTurn = async (turnId: string): Promise<boolean> => {
    for (;;) {
      const signal = await signals.next()
      if (signal.kind === 'closed') return false
      if (signal.kind === 'proposal') await decide(client, terminal, instanceId, signal.params)
      if (signal.kind === 'done' && signal.turnId === turnId) return true
    }
  }

  for (;;) {
    for (const signal of signals.drain()) {
      if (signal.kind === 'closed') return
      if (signal.kind === 'proposal') await decide(client, terminal, instanceId, signal.params)
    }
    const line = await terminal.ask('> ')
    if (line === null || line.trim() === '/quit') return
    const text = line.trim()
    if (text.length === 0) continue
    const sent = await client.request('chat.send', { instanceId, text })
    if (!sent.ok) {
      terminal.write(renderRpcError('chat.send', sent.error))
      continue
    }
    activeTurn = sent.value.turnId
    const open = await awaitTurn(sent.value.turnId)
    activeTurn = null
    if (!open) {
      terminal.write('Connection to the companion closed.\n')
      return
    }
  }
}
