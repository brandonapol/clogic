import { err, ok, type Result } from '../llm/result.js'
import { rpcError, rpcErrorCodes, type RpcErrorObject } from './jsonrpc.js'
import type { SessionHelloParams, SessionHelloResult } from './messages.js'

export const protocolVersion = 1

export const supportedProtocolVersions: readonly number[] = [protocolVersion]

export const acceptHello = (
  hello: SessionHelloParams,
  companion: string,
  supported: readonly number[] = supportedProtocolVersions,
): Result<SessionHelloResult, RpcErrorObject> =>
  supported.includes(hello.protocolVersion)
    ? ok({ protocolVersion: hello.protocolVersion, companion })
    : err(
        rpcError(
          rpcErrorCodes.unsupportedProtocolVersion,
          `Unsupported protocol version ${hello.protocolVersion}; supported: ${supported.join(', ')}`,
        ),
      )

export type SessionState =
  | { readonly phase: 'awaiting_hello' }
  | { readonly phase: 'ready'; readonly hello: SessionHelloParams }

export const initialSession: SessionState = { phase: 'awaiting_hello' }

export const admit = (state: SessionState, method: string): Result<void, RpcErrorObject> =>
  state.phase === 'ready'
    ? method === 'session.hello'
      ? err(rpcError(rpcErrorCodes.invalidRequest, 'session.hello was already received'))
      : ok(undefined)
    : method === 'session.hello'
      ? ok(undefined)
      : err(rpcError(rpcErrorCodes.handshakeRequired, 'Send session.hello before other messages'))
