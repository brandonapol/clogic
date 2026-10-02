import { err, ok, type Result } from '../llm/result.js'
import { isRecord } from './decode.js'
import type { RpcId } from './messages.js'

export const rpcErrorCodes = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  unsupportedProtocolVersion: -32000,
  handshakeRequired: -32001,
  messageTooLarge: -32002,
  connectionClosed: -32003,
} as const

export type RpcErrorObject = {
  readonly code: number
  readonly message: string
}

export type Envelope =
  | {
      readonly kind: 'request'
      readonly id: RpcId
      readonly method: string
      readonly params: unknown
    }
  | { readonly kind: 'notification'; readonly method: string; readonly params: unknown }
  | {
      readonly kind: 'response'
      readonly id: RpcId | null
      readonly outcome: Result<unknown, RpcErrorObject>
    }

export type DecodeFailure = {
  readonly id: RpcId | null
  readonly error: RpcErrorObject
}

export const rpcError = (code: number, message: string): RpcErrorObject => ({ code, message })

const failure = (id: RpcId | null, code: number, message: string): Result<never, DecodeFailure> =>
  err({ id, error: rpcError(code, message) })

const isRpcId = (value: unknown): value is RpcId =>
  typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value))

const parse = (line: string): Result<unknown, string> => {
  try {
    return ok(JSON.parse(line) as unknown)
  } catch {
    return err('invalid JSON')
  }
}

const decodeErrorObject = (value: unknown): RpcErrorObject | undefined =>
  isRecord(value) && Number.isSafeInteger(value['code']) && typeof value['message'] === 'string'
    ? rpcError(Number(value['code']), value['message'])
    : undefined

export const decodeEnvelope = (line: string): Result<Envelope, DecodeFailure> => {
  const parsed = parse(line)
  if (!parsed.ok) return failure(null, rpcErrorCodes.parseError, 'Parse error: invalid JSON')
  const value = parsed.value
  if (Array.isArray(value))
    return failure(null, rpcErrorCodes.invalidRequest, 'Batch requests are not supported')
  if (!isRecord(value))
    return failure(null, rpcErrorCodes.invalidRequest, 'Message must be a JSON object')
  const rawId = value['id']
  const id = isRpcId(rawId) ? rawId : null
  if (value['jsonrpc'] !== '2.0')
    return failure(id, rpcErrorCodes.invalidRequest, 'jsonrpc must be "2.0"')

  const method = value['method']
  if (method !== undefined) {
    if (typeof method !== 'string' || method.length === 0)
      return failure(id, rpcErrorCodes.invalidRequest, 'method must be a non-empty string')
    const params = value['params'] === undefined ? {} : value['params']
    if (!isRecord(params))
      return failure(id, rpcErrorCodes.invalidParams, 'params must be an object')
    if (!('id' in value)) return ok({ kind: 'notification', method, params })
    if (!isRpcId(rawId))
      return failure(null, rpcErrorCodes.invalidRequest, 'id must be a string or integer')
    return ok({ kind: 'request', id: rawId, method, params })
  }

  if (rawId !== null && !isRpcId(rawId))
    return failure(null, rpcErrorCodes.invalidRequest, 'id must be a string, integer or null')
  const hasResult = 'result' in value
  const error = decodeErrorObject(value['error'])
  if (hasResult === (error !== undefined) || ('error' in value && error === undefined))
    return failure(
      id,
      rpcErrorCodes.invalidRequest,
      'Response needs exactly one of result or error',
    )
  return ok({
    kind: 'response',
    id,
    outcome: error === undefined ? ok(value['result']) : err(error),
  })
}

const line = (message: Readonly<Record<string, unknown>>): string =>
  `${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`

export const encodeRequest = (id: RpcId, method: string, params: unknown): string =>
  line({ id, method, params })

export const encodeNotification = (method: string, params: unknown): string =>
  line({ method, params })

export const encodeResult = (id: RpcId, result: unknown): string => line({ id, result })

export const encodeError = (id: RpcId | null, error: RpcErrorObject): string => line({ id, error })
