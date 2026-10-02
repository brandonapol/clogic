import { execFile } from 'node:child_process'
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { err, ok } from '../../src/llm/result.js'
import { rpcErrorCodes } from '../../src/rpc/jsonrpc.js'
import type { CompanionNotification, PluginNotification } from '../../src/rpc/messages.js'
import {
  connect,
  listen,
  type ProtocolProblem,
  type RequestHandlers,
  type RpcClient,
  type RpcServer,
  type ServerOptions,
} from '../../src/rpc/socket.js'
import {
  instanceId,
  sampleCompanionNotifications,
  sampleParams,
  sampleResults,
} from './fixtures.js'

const handlers: RequestHandlers = {
  'chat.send': async (params, session) => {
    session.notify('chat.delta', {
      instanceId: params.instanceId,
      turnId: 't-1',
      messageId: 'm-1',
      index: 0,
      text: 'Hel',
    })
    session.notify('chat.delta', {
      instanceId: params.instanceId,
      turnId: 't-1',
      messageId: 'm-1',
      index: 1,
      text: 'lo',
    })
    session.notify('chat.done', {
      instanceId: params.instanceId,
      turnId: 't-1',
      stopReason: 'end_turn',
    })
    return ok({ turnId: 't-1' })
  },
  'chat.cancel': async () => ok({ cancelled: false }),
  'change.decide': async (params) =>
    ok({
      proposalId: params.proposalId,
      outcome: params.acceptedRowIds.length > 0 ? 'applying' : 'declined',
    }),
  'keys.set': async (params) => ok({ provider: params.provider, configured: true }),
  'keys.status': async () => ok(sampleResults['keys.status']),
  'provider.select': async () => err({ code: 1001, message: 'No key for xai' }),
}

let dir = ''
let path = ''
let servers: RpcServer[] = []
let clients: RpcClient[] = []

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'clogic-rpc-'))
  path = join(dir, 'c.sock')
})

afterEach(async () => {
  await Promise.all(clients.map((client) => client.close()))
  await Promise.all(servers.map((server) => server.close()))
  clients = []
  servers = []
  await rm(dir, { recursive: true, force: true })
})

const start = async (overrides: Partial<ServerOptions> = {}) => {
  const server = await listen({ path, companion: 'test-companion 0', handlers, ...overrides })
  servers.push(server)
  return server
}

const open = async () => {
  const client = await connect({ path })
  clients.push(client)
  return client
}

const greet = (client: RpcClient) => client.request('session.hello', sampleParams['session.hello'])

const rawExchange = (lines: string, expectedReplies: number): Promise<readonly unknown[]> =>
  new Promise((resolve, reject) => {
    const socket = createConnection(path)
    let buffer = ''
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const replies = buffer.split('\n').filter((line) => line.length > 0)
      if (replies.length >= expectedReplies) {
        socket.destroy()
        resolve(replies.map((line) => JSON.parse(line) as unknown))
      }
    })
    socket.on('error', reject)
    socket.write(lines)
  })

describe('handshake over a UNIX socket', () => {
  it('accepts session.hello and reports it to the server', async () => {
    const hellos: unknown[] = []
    await start({ onHello: (hello) => hellos.push(hello) })
    const client = await open()
    expect(await greet(client)).toEqual({
      ok: true,
      value: { protocolVersion: 1, companion: 'test-companion 0' },
    })
    expect(hellos).toEqual([sampleParams['session.hello']])
  })

  it('refuses other requests before the handshake', async () => {
    await start()
    const client = await open()
    const result = await client.request('keys.status', {})
    expect(result.ok ? undefined : result.error.code).toBe(rpcErrorCodes.handshakeRequired)
  })

  it('rejects an unsupported protocol version and stays unready', async () => {
    await start()
    const client = await open()
    const hello = await client.request('session.hello', {
      ...sampleParams['session.hello'],
      protocolVersion: 42,
    })
    expect(hello.ok ? undefined : hello.error.code).toBe(rpcErrorCodes.unsupportedProtocolVersion)
    const next = await client.request('keys.status', {})
    expect(next.ok ? undefined : next.error.code).toBe(rpcErrorCodes.handshakeRequired)
  })
})

describe('requests and notifications', () => {
  it('streams notifications before the request resolves', async () => {
    await start()
    const client = await open()
    const received: CompanionNotification[] = []
    client.onNotification((notification) => received.push(notification))
    await greet(client)
    expect(await client.request('chat.send', sampleParams['chat.send'])).toEqual({
      ok: true,
      value: { turnId: 't-1' },
    })
    expect(received.map((n) => n.method)).toEqual(['chat.delta', 'chat.delta', 'chat.done'])
    expect(
      received.flatMap((n) => (n.method === 'chat.delta' ? [n.params.text] : [])).join(''),
    ).toBe('Hello')
  })

  it('correlates concurrent requests by id', async () => {
    await start()
    const client = await open()
    await greet(client)
    const [status, set, decide] = await Promise.all([
      client.request('keys.status', {}),
      client.request('keys.set', { provider: 'xai', key: 'xai-test' }),
      client.request('change.decide', { instanceId, proposalId: 'p-9', acceptedRowIds: [] }),
    ])
    expect(status).toEqual({ ok: true, value: sampleResults['keys.status'] })
    expect(set).toEqual({ ok: true, value: { provider: 'xai', configured: true } })
    expect(decide).toEqual({ ok: true, value: { proposalId: 'p-9', outcome: 'declined' } })
  })

  it('returns handler errors as error responses', async () => {
    await start()
    const client = await open()
    await greet(client)
    expect(await client.request('provider.select', { provider: 'xai' })).toEqual({
      ok: false,
      error: { code: 1001, message: 'No key for xai' },
    })
  })

  it('turns a throwing handler into an internal error', async () => {
    await start({
      handlers: {
        ...handlers,
        'chat.cancel': async () => {
          throw new Error('boom')
        },
      },
    })
    const client = await open()
    await greet(client)
    const result = await client.request('chat.cancel', sampleParams['chat.cancel'])
    expect(result).toEqual({
      ok: false,
      error: { code: rpcErrorCodes.internalError, message: 'Internal error' },
    })
  })

  it('delivers plugin notifications after the handshake only', async () => {
    const received: PluginNotification[] = []
    let ready: () => void = () => undefined
    const arrived = new Promise<void>((resolve) => {
      ready = resolve
    })
    await start({
      onNotification: (notification) => {
        received.push(notification)
        ready()
      },
    })
    const client = await open()
    client.notify('meter', { instanceId, momentaryLufs: -20, bands: [] })
    await greet(client)
    client.notify('context.changed', { instanceId, contextName: 'Bass' })
    await arrived
    expect(received).toEqual([
      {
        kind: 'notification',
        method: 'context.changed',
        params: { instanceId, contextName: 'Bass' },
      },
    ])
  })

  it('pushes every companion notification type to the client', async () => {
    const methods = Object.keys(
      sampleCompanionNotifications,
    ) as (keyof typeof sampleCompanionNotifications)[]
    await start({
      onHello: (_hello, session) =>
        methods.forEach((method) =>
          session.notify(method, sampleCompanionNotifications[method] as never),
        ),
    })
    const client = await open()
    const received: CompanionNotification[] = []
    const all = new Promise<void>((resolve) =>
      client.onNotification((notification) => {
        received.push(notification)
        if (received.length === methods.length) resolve()
      }),
    )
    await greet(client)
    await all
    expect(received.map((n) => n.method)).toEqual(methods)
  })
})

describe('protocol errors', () => {
  it('answers malformed lines and keeps the connection open', async () => {
    const problems: ProtocolProblem[] = []
    await start({ onProblem: (problem) => problems.push(problem) })
    const replies = await rawExchange(
      [
        'not json',
        '{"jsonrpc":"2.0","id":1,"method":"nope"}',
        '{"jsonrpc":"2.0","method":"nope"}',
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'session.hello',
          params: sampleParams['session.hello'],
        }),
        '',
      ].join('\n'),
      3,
    )
    expect(replies).toEqual([
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: rpcErrorCodes.parseError, message: 'Parse error: invalid JSON' },
      },
      {
        jsonrpc: '2.0',
        id: 1,
        error: { code: rpcErrorCodes.methodNotFound, message: 'Method not found: nope' },
      },
      { jsonrpc: '2.0', id: 2, result: { protocolVersion: 1, companion: 'test-companion 0' } },
    ])
    expect(problems).toHaveLength(3)
  })

  it('rejects an oversized line and processes the next one', async () => {
    await start({ maxLineBytes: 1024 })
    const big = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'chat.send',
      params: { instanceId, text: 'x'.repeat(4096) },
    })
    const hello = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'session.hello',
      params: sampleParams['session.hello'],
    })
    const replies = await rawExchange(`${big}\n${hello}\n`, 2)
    expect(replies[0]).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: rpcErrorCodes.messageTooLarge,
        message: `Message of ${big.length} bytes exceeds the line limit`,
      },
    })
    expect(replies[1]).toMatchObject({ id: 2, result: { protocolVersion: 1 } })
  })
})

describe('connection lifecycle', () => {
  it('fails pending requests when the server goes away', async () => {
    const server = await start({
      handlers: { ...handlers, 'keys.status': () => new Promise(() => undefined) },
    })
    const client = await open()
    await greet(client)
    const pending = client.request('keys.status', {})
    await server.close()
    servers = []
    expect(await pending).toEqual({
      ok: false,
      error: { code: rpcErrorCodes.connectionClosed, message: 'Connection closed' },
    })
    await client.closed
    const after = await client.request('keys.status', {})
    expect(after.ok ? undefined : after.error.code).toBe(rpcErrorCodes.connectionClosed)
  })

  it('replaces a stale socket left by a crashed companion', async () => {
    const script = `require('node:net').createServer().listen(${JSON.stringify(path)}, () => process.kill(process.pid, 'SIGKILL'))`
    await new Promise<void>((resolve) =>
      execFile(process.execPath, ['-e', script], () => resolve()),
    )
    expect((await lstat(path)).isSocket()).toBe(true)
    await start()
    const client = await open()
    expect((await greet(client)).ok).toBe(true)
  })

  it('never deletes a regular file at the socket path', async () => {
    await writeFile(path, 'keep me')
    await expect(start()).rejects.toMatchObject({ code: 'EADDRINUSE' })
    expect(await readFile(path, 'utf8')).toBe('keep me')
  })

  it('refuses to take over a socket another process is listening on', async () => {
    const other = createServer()
    await new Promise<void>((resolve) => other.listen(path, resolve))
    await expect(start()).rejects.toMatchObject({ code: 'EADDRINUSE' })
    await new Promise<void>((resolve) => other.close(() => resolve()))
  })

  it('rejects connect when nothing is listening', async () => {
    await expect(connect({ path })).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
