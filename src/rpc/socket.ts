import { lstat, unlink } from 'node:fs/promises'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { err, type Result } from '../llm/result.js'
import {
  decodeFromCompanion,
  decodeFromPlugin,
  decodeResult,
  encodeCompanionNotification,
  encodeFailure,
  encodePluginNotification,
  encodePluginRequest,
  encodeResponse,
} from './codec.js'
import { createFramer, endFramer, pushChunk, type FrameEvent } from './framer.js'
import { acceptHello, admit, initialSession, type SessionState } from './handshake.js'
import { encodeError, rpcError, rpcErrorCodes, type DecodeFailure } from './jsonrpc.js'
import type { RpcErrorObject } from './jsonrpc.js'
import type {
  CompanionNotification,
  CompanionNotificationMethod,
  CompanionNotificationSpec,
  ParamsOf,
  PluginNotification,
  PluginNotificationMethod,
  PluginNotificationSpec,
  PluginRequest,
  RequestMethod,
  RequestOf,
  ResultOf,
  RpcId,
  SessionHelloParams,
} from './messages.js'

export type ProtocolProblem =
  | { readonly kind: 'decode'; readonly failure: DecodeFailure }
  | { readonly kind: 'frame'; readonly event: Exclude<FrameEvent, { kind: 'line' }> }

export type ServerSession = {
  readonly hello: () => SessionHelloParams | null
  readonly notify: <M extends CompanionNotificationMethod>(
    method: M,
    params: CompanionNotificationSpec[M],
  ) => void
  readonly close: () => void
}

type HandledMethod = Exclude<RequestMethod, 'session.hello'>

export type RequestHandlers = {
  readonly [M in HandledMethod]: (
    params: ParamsOf<M>,
    session: ServerSession,
  ) => Promise<Result<ResultOf<M>, RpcErrorObject>>
}

export type ServerOptions = {
  readonly path: string
  readonly companion: string
  readonly handlers: RequestHandlers
  readonly maxLineBytes?: number
  readonly onHello?: (hello: SessionHelloParams, session: ServerSession) => void
  readonly onNotification?: (notification: PluginNotification, session: ServerSession) => void
  readonly onProblem?: (problem: ProtocolProblem) => void
}

export type RpcServer = {
  readonly path: string
  readonly close: () => Promise<void>
}

export type ClientOptions = {
  readonly path: string
  readonly maxLineBytes?: number
}

export type RpcClient = {
  readonly request: <M extends RequestMethod>(
    method: M,
    params: ParamsOf<M>,
  ) => Promise<Result<ResultOf<M>, RpcErrorObject>>
  readonly notify: <M extends PluginNotificationMethod>(
    method: M,
    params: PluginNotificationSpec[M],
  ) => void
  readonly onNotification: (listener: (notification: CompanionNotification) => void) => () => void
  readonly onProblem: (listener: (problem: ProtocolProblem) => void) => () => void
  readonly closed: Promise<void>
  readonly close: () => Promise<void>
}

const readLines = (
  socket: Socket,
  maxLineBytes: number | undefined,
  onEvent: (event: FrameEvent) => void,
): void => {
  let framer = createFramer(maxLineBytes)
  socket.on('data', (chunk: Buffer) => {
    const step = pushChunk(framer, chunk)
    framer = step.state
    step.events.forEach(onEvent)
  })
  socket.on('end', () => endFramer(framer).forEach(onEvent))
}

const writeLine = (socket: Socket, line: string): void => {
  if (socket.writable) socket.write(line)
}

const tooLarge = (bytes: number) =>
  rpcError(rpcErrorCodes.messageTooLarge, `Message of ${bytes} bytes exceeds the line limit`)

const shouldReply = (failure: DecodeFailure): boolean =>
  failure.id !== null ||
  failure.error.code === rpcErrorCodes.parseError ||
  failure.error.code === rpcErrorCodes.invalidRequest

const dispatch = async <M extends HandledMethod>(
  request: RequestOf<M>,
  handlers: RequestHandlers,
  session: ServerSession,
): Promise<string> =>
  encodeResponse(
    request.id,
    request.method,
    await handlers[request.method](request.params, session),
  )

const serveConnection = (socket: Socket, options: ServerOptions): void => {
  let state: SessionState = initialSession
  const report = (problem: ProtocolProblem) => options.onProblem?.(problem)
  const session: ServerSession = {
    hello: () => (state.phase === 'ready' ? state.hello : null),
    notify: (method, params) => writeLine(socket, encodeCompanionNotification(method, params)),
    close: () => socket.end(),
  }

  const handleRequest = (request: PluginRequest): void => {
    const admitted = admit(state, request.method)
    if (!admitted.ok) return writeLine(socket, encodeError(request.id, admitted.error))
    if (request.method === 'session.hello') {
      const accepted = acceptHello(request.params, options.companion)
      writeLine(socket, encodeResponse(request.id, request.method, accepted))
      if (accepted.ok) {
        state = { phase: 'ready', hello: request.params }
        options.onHello?.(request.params, session)
      }
      return
    }
    dispatch(request, options.handlers, session).then(
      (line) => writeLine(socket, line),
      () =>
        writeLine(
          socket,
          encodeError(request.id, rpcError(rpcErrorCodes.internalError, 'Internal error')),
        ),
    )
  }

  const handleLine = (line: string): void => {
    const decoded = decodeFromPlugin(line)
    if (!decoded.ok) {
      report({ kind: 'decode', failure: decoded.error })
      if (shouldReply(decoded.error)) writeLine(socket, encodeFailure(decoded.error))
      return
    }
    const message = decoded.value
    if (message.kind === 'request') return handleRequest(message)
    if (state.phase === 'ready') options.onNotification?.(message, session)
  }

  readLines(socket, options.maxLineBytes, (event) => {
    if (event.kind === 'line') return handleLine(event.line)
    report({ kind: 'frame', event })
    if (event.kind === 'oversized') writeLine(socket, encodeError(null, tooLarge(event.bytes)))
    if (event.kind === 'invalid_utf8')
      writeLine(
        socket,
        encodeError(null, rpcError(rpcErrorCodes.parseError, 'Parse error: invalid UTF-8')),
      )
  })
  socket.on('error', () => socket.destroy())
}

const listenOn = (server: Server, path: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(path, () => {
      server.off('error', onError)
      resolve()
    })
  })

const isLive = (path: string): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = createConnection(path)
    probe.once('connect', () => {
      probe.destroy()
      resolve(true)
    })
    probe.once('error', () => resolve(false))
  })

const isStaleSocket = async (path: string): Promise<boolean> =>
  (await lstat(path)).isSocket() && !(await isLive(path))

const errorCode = (error: unknown): string | undefined =>
  error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined

export const listen = async (options: ServerOptions): Promise<RpcServer> => {
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    serveConnection(socket, options)
  })
  try {
    await listenOn(server, options.path)
  } catch (error) {
    if (errorCode(error) !== 'EADDRINUSE' || !(await isStaleSocket(options.path))) throw error
    await unlink(options.path)
    await listenOn(server, options.path)
  }
  return {
    path: options.path,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)))
        sockets.forEach((socket) => socket.destroy())
      }),
  }
}

const connectTo = (path: string): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const socket = createConnection(path)
    socket.once('connect', () => {
      socket.off('error', reject)
      resolve(socket)
    })
    socket.once('error', reject)
  })

type Pending = (outcome: Result<unknown, RpcErrorObject>) => void

export const connect = async (options: ClientOptions): Promise<RpcClient> => {
  const socket = await connectTo(options.path)
  const pending = new Map<RpcId, Pending>()
  const notificationListeners = new Set<(notification: CompanionNotification) => void>()
  const problemListeners = new Set<(problem: ProtocolProblem) => void>()
  const report = (problem: ProtocolProblem) => problemListeners.forEach((l) => l(problem))
  let nextId = 1

  const closed = new Promise<void>((resolve) => {
    socket.on('close', () => {
      const closedError = err(rpcError(rpcErrorCodes.connectionClosed, 'Connection closed'))
      pending.forEach((settle) => settle(closedError))
      pending.clear()
      resolve()
    })
  })
  socket.on('error', () => socket.destroy())

  readLines(socket, options.maxLineBytes, (event) => {
    if (event.kind !== 'line') return report({ kind: 'frame', event })
    const decoded = decodeFromCompanion(event.line)
    if (!decoded.ok) return report({ kind: 'decode', failure: decoded.error })
    const message = decoded.value
    if (message.kind === 'notification')
      return notificationListeners.forEach((listener) => listener(message))
    const settle = message.id === null ? undefined : pending.get(message.id)
    if (settle === undefined || message.id === null)
      return report({
        kind: 'decode',
        failure: {
          id: message.id,
          error: message.outcome.ok
            ? rpcError(rpcErrorCodes.invalidRequest, 'Response to unknown request id')
            : message.outcome.error,
        },
      })
    pending.delete(message.id)
    settle(message.outcome)
  })

  const subscribe =
    <T>(listeners: Set<T>) =>
    (listener: T) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }

  return {
    request: (method, params) =>
      new Promise((resolve) => {
        if (!socket.writable)
          return resolve(err(rpcError(rpcErrorCodes.connectionClosed, 'Connection closed')))
        const id = nextId++
        pending.set(id, (outcome) => resolve(decodeResult(method, outcome)))
        socket.write(encodePluginRequest(id, method, params))
      }),
    notify: (method, params) => writeLine(socket, encodePluginNotification(method, params)),
    onNotification: subscribe(notificationListeners),
    onProblem: subscribe(problemListeners),
    closed,
    close: () => {
      socket.end()
      return closed
    },
  }
}
