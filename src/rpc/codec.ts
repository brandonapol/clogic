import { err, ok, type Result } from '../llm/result.js'
import {
  decodeEnvelope,
  encodeError,
  encodeNotification,
  encodeRequest,
  encodeResult,
  rpcError,
  rpcErrorCodes,
  type DecodeFailure,
  type RpcErrorObject,
} from './jsonrpc.js'
import {
  companionNotificationDecoders,
  isCompanionNotificationMethod,
  isPluginNotificationMethod,
  isRequestMethod,
  pluginNotificationDecoders,
  requestDecoders,
  type CompanionNotification,
  type CompanionNotificationMethod,
  type CompanionNotificationSpec,
  type ParamsOf,
  type PluginNotification,
  type PluginNotificationMethod,
  type PluginNotificationSpec,
  type PluginRequest,
  type RequestMethod,
  type RequestOf,
  type ResultOf,
  type RpcId,
} from './messages.js'

export type FromPlugin = PluginRequest | PluginNotification

export type ResponseMessage = {
  readonly kind: 'response'
  readonly id: RpcId | null
  readonly outcome: Result<unknown, RpcErrorObject>
}

export type FromCompanion = CompanionNotification | ResponseMessage

type NotificationOf<Spec, M extends keyof Spec> = {
  readonly kind: 'notification'
  readonly method: M
  readonly params: Spec[M]
}

const requestBuilder =
  <M extends RequestMethod>(method: M) =>
  (id: RpcId, params: unknown): Result<RequestOf<M>, string> => {
    const decoded = requestDecoders[method].params(params, 'params')
    return decoded.ok ? ok({ kind: 'request', id, method, params: decoded.value }) : decoded
  }

const pluginNotificationBuilder =
  <M extends PluginNotificationMethod>(method: M) =>
  (params: unknown): Result<NotificationOf<PluginNotificationSpec, M>, string> => {
    const decoded = pluginNotificationDecoders[method](params, 'params')
    return decoded.ok ? ok({ kind: 'notification', method, params: decoded.value }) : decoded
  }

const companionNotificationBuilder =
  <M extends CompanionNotificationMethod>(method: M) =>
  (params: unknown): Result<NotificationOf<CompanionNotificationSpec, M>, string> => {
    const decoded = companionNotificationDecoders[method](params, 'params')
    return decoded.ok ? ok({ kind: 'notification', method, params: decoded.value }) : decoded
  }

const requestBuilders: {
  readonly [M in RequestMethod]: (id: RpcId, params: unknown) => Result<RequestOf<M>, string>
} = {
  'session.hello': requestBuilder('session.hello'),
  'chat.send': requestBuilder('chat.send'),
  'chat.cancel': requestBuilder('chat.cancel'),
  'change.decide': requestBuilder('change.decide'),
  'keys.set': requestBuilder('keys.set'),
  'keys.status': requestBuilder('keys.status'),
  'provider.select': requestBuilder('provider.select'),
  'diagnostics.export': requestBuilder('diagnostics.export'),
}

const pluginNotificationBuilders: {
  readonly [M in PluginNotificationMethod]: (
    params: unknown,
  ) => Result<NotificationOf<PluginNotificationSpec, M>, string>
} = {
  meter: pluginNotificationBuilder('meter'),
  'context.changed': pluginNotificationBuilder('context.changed'),
}

const companionNotificationBuilders: {
  readonly [M in CompanionNotificationMethod]: (
    params: unknown,
  ) => Result<NotificationOf<CompanionNotificationSpec, M>, string>
} = {
  'chat.message': companionNotificationBuilder('chat.message'),
  'chat.delta': companionNotificationBuilder('chat.delta'),
  'chat.done': companionNotificationBuilder('chat.done'),
  'tool.started': companionNotificationBuilder('tool.started'),
  'tool.finished': companionNotificationBuilder('tool.finished'),
  'change.proposed': companionNotificationBuilder('change.proposed'),
  'change.applied': companionNotificationBuilder('change.applied'),
  'analysis.result': companionNotificationBuilder('analysis.result'),
  usage: companionNotificationBuilder('usage'),
  error: companionNotificationBuilder('error'),
}

const invalidParams = (id: RpcId | null, message: string): Result<never, DecodeFailure> =>
  err({ id, error: rpcError(rpcErrorCodes.invalidParams, `Invalid params: ${message}`) })

const methodNotFound = (id: RpcId | null, method: string): Result<never, DecodeFailure> =>
  err({ id, error: rpcError(rpcErrorCodes.methodNotFound, `Method not found: ${method}`) })

export const decodeFromPlugin = (line: string): Result<FromPlugin, DecodeFailure> => {
  const envelope = decodeEnvelope(line)
  if (!envelope.ok) return envelope
  const message = envelope.value
  if (message.kind === 'response')
    return err({
      id: null,
      error: rpcError(rpcErrorCodes.invalidRequest, 'The companion does not accept responses'),
    })
  if (message.kind === 'request') {
    if (!isRequestMethod(message.method)) return methodNotFound(message.id, message.method)
    const decoded = requestBuilders[message.method](message.id, message.params)
    return decoded.ok ? decoded : invalidParams(message.id, decoded.error)
  }
  if (!isPluginNotificationMethod(message.method)) return methodNotFound(null, message.method)
  const decoded = pluginNotificationBuilders[message.method](message.params)
  return decoded.ok ? decoded : invalidParams(null, decoded.error)
}

export const decodeFromCompanion = (line: string): Result<FromCompanion, DecodeFailure> => {
  const envelope = decodeEnvelope(line)
  if (!envelope.ok) return envelope
  const message = envelope.value
  if (message.kind === 'response') return ok(message)
  if (message.kind === 'request')
    return err({
      id: message.id,
      error: rpcError(rpcErrorCodes.methodNotFound, 'The plugin does not accept requests'),
    })
  if (!isCompanionNotificationMethod(message.method)) return methodNotFound(null, message.method)
  const decoded = companionNotificationBuilders[message.method](message.params)
  return decoded.ok ? decoded : invalidParams(null, decoded.error)
}

export const decodeResult = <M extends RequestMethod>(
  method: M,
  outcome: Result<unknown, RpcErrorObject>,
): Result<ResultOf<M>, RpcErrorObject> => {
  if (!outcome.ok) return outcome
  const decoded = requestDecoders[method].result(outcome.value, 'result')
  return decoded.ok
    ? decoded
    : err(rpcError(rpcErrorCodes.invalidParams, `Invalid ${method} result: ${decoded.error}`))
}

export const encodePluginRequest = <M extends RequestMethod>(
  id: RpcId,
  method: M,
  params: ParamsOf<M>,
): string => encodeRequest(id, method, params)

export const encodePluginNotification = <M extends PluginNotificationMethod>(
  method: M,
  params: PluginNotificationSpec[M],
): string => encodeNotification(method, params)

export const encodeCompanionNotification = <M extends CompanionNotificationMethod>(
  method: M,
  params: CompanionNotificationSpec[M],
): string => encodeNotification(method, params)

export const encodeResponse = <M extends RequestMethod>(
  id: RpcId,
  _method: M,
  outcome: Result<ResultOf<M>, RpcErrorObject>,
): string => (outcome.ok ? encodeResult(id, outcome.value) : encodeError(id, outcome.error))

export const encodeFailure = (failure: DecodeFailure): string =>
  encodeError(failure.id, failure.error)
