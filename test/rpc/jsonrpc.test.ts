import { describe, expect, it } from 'vitest'
import {
  decodeEnvelope,
  encodeError,
  encodeNotification,
  encodeRequest,
  encodeResult,
  rpcErrorCodes,
} from '../../src/rpc/jsonrpc.js'

const failureOf = (line: string) => {
  const decoded = decodeEnvelope(line)
  return decoded.ok ? undefined : decoded.error
}

describe('decodeEnvelope', () => {
  it('classifies requests, notifications and responses', () => {
    expect(
      decodeEnvelope('{"jsonrpc":"2.0","id":1,"method":"chat.send","params":{"a":1}}'),
    ).toEqual({
      ok: true,
      value: { kind: 'request', id: 1, method: 'chat.send', params: { a: 1 } },
    })
    expect(decodeEnvelope('{"jsonrpc":"2.0","method":"meter","params":{}}')).toEqual({
      ok: true,
      value: { kind: 'notification', method: 'meter', params: {} },
    })
    expect(decodeEnvelope('{"jsonrpc":"2.0","id":"a","result":{"x":true}}')).toEqual({
      ok: true,
      value: { kind: 'response', id: 'a', outcome: { ok: true, value: { x: true } } },
    })
    expect(
      decodeEnvelope('{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"bad"}}'),
    ).toEqual({
      ok: true,
      value: {
        kind: 'response',
        id: null,
        outcome: { ok: false, error: { code: -32700, message: 'bad' } },
      },
    })
  })

  it('treats missing params as an empty object', () => {
    expect(decodeEnvelope('{"jsonrpc":"2.0","id":2,"method":"keys.status"}')).toEqual({
      ok: true,
      value: { kind: 'request', id: 2, method: 'keys.status', params: {} },
    })
  })

  it('returns a parse error with a null id for invalid JSON', () => {
    expect(failureOf('{"jsonrpc":')).toEqual({
      id: null,
      error: { code: rpcErrorCodes.parseError, message: 'Parse error: invalid JSON' },
    })
  })

  it('rejects batches, non-objects and the wrong version', () => {
    expect(failureOf('[]')?.error.code).toBe(rpcErrorCodes.invalidRequest)
    expect(failureOf('"hi"')?.error.code).toBe(rpcErrorCodes.invalidRequest)
    expect(failureOf('{"jsonrpc":"1.0","id":3,"method":"x"}')).toEqual({
      id: 3,
      error: { code: rpcErrorCodes.invalidRequest, message: 'jsonrpc must be "2.0"' },
    })
  })

  it('rejects positional params and bad ids', () => {
    expect(failureOf('{"jsonrpc":"2.0","id":4,"method":"x","params":[1]}')).toEqual({
      id: 4,
      error: { code: rpcErrorCodes.invalidParams, message: 'params must be an object' },
    })
    expect(failureOf('{"jsonrpc":"2.0","id":null,"method":"x"}')?.error.code).toBe(
      rpcErrorCodes.invalidRequest,
    )
    expect(failureOf('{"jsonrpc":"2.0","id":1.5,"method":"x"}')?.error.code).toBe(
      rpcErrorCodes.invalidRequest,
    )
    expect(failureOf('{"jsonrpc":"2.0","id":1,"method":""}')?.error.code).toBe(
      rpcErrorCodes.invalidRequest,
    )
  })

  it('rejects responses with both, neither or a malformed error', () => {
    expect(failureOf('{"jsonrpc":"2.0","id":1}')?.error.code).toBe(rpcErrorCodes.invalidRequest)
    expect(
      failureOf('{"jsonrpc":"2.0","id":1,"result":1,"error":{"code":1,"message":"m"}}')?.error.code,
    ).toBe(rpcErrorCodes.invalidRequest)
    expect(failureOf('{"jsonrpc":"2.0","id":1,"error":{"code":"x"}}')?.error.code).toBe(
      rpcErrorCodes.invalidRequest,
    )
  })
})

describe('encoders', () => {
  it('write one newline-terminated JSON-RPC 2.0 line', () => {
    expect(encodeRequest(1, 'chat.send', { text: 'a\nb' })).toBe(
      '{"jsonrpc":"2.0","id":1,"method":"chat.send","params":{"text":"a\\nb"}}\n',
    )
    expect(encodeNotification('meter', {})).toBe('{"jsonrpc":"2.0","method":"meter","params":{}}\n')
    expect(encodeResult('x', { ok: 1 })).toBe('{"jsonrpc":"2.0","id":"x","result":{"ok":1}}\n')
    expect(encodeError(null, { code: -32700, message: 'bad' })).toBe(
      '{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"bad"}}\n',
    )
  })

  it('round-trips through decodeEnvelope', () => {
    const line = encodeRequest('r-1', 'keys.status', {})
    expect(line.indexOf('\n')).toBe(line.length - 1)
    expect(decodeEnvelope(line.trimEnd())).toEqual({
      ok: true,
      value: { kind: 'request', id: 'r-1', method: 'keys.status', params: {} },
    })
  })
})
