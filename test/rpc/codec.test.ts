import { describe, expect, it } from 'vitest'
import {
  decodeFromCompanion,
  decodeFromPlugin,
  decodeResult,
  encodeCompanionNotification,
  encodeFailure,
  encodePluginNotification,
  encodePluginRequest,
  encodeResponse,
} from '../../src/rpc/codec.js'
import { rpcErrorCodes } from '../../src/rpc/jsonrpc.js'
import {
  companionNotificationDecoders,
  pluginNotificationDecoders,
  requestDecoders,
  type CompanionNotificationMethod,
  type PluginNotificationMethod,
  type RequestMethod,
} from '../../src/rpc/messages.js'
import {
  instanceId,
  sampleCompanionNotifications,
  samplePluginNotifications,
  sampleParams,
  sampleResults,
} from './fixtures.js'

const requestMethods = Object.keys(requestDecoders) as RequestMethod[]
const pluginMethods = Object.keys(pluginNotificationDecoders) as PluginNotificationMethod[]
const companionMethods = Object.keys(companionNotificationDecoders) as CompanionNotificationMethod[]

const failureCode = (line: string, side: 'plugin' | 'companion') => {
  const decoded = side === 'plugin' ? decodeFromPlugin(line) : decodeFromCompanion(line)
  return decoded.ok ? undefined : decoded.error.error.code
}

describe('method names', () => {
  it('match the architecture draft plus the documented additions', () => {
    expect(requestMethods).toEqual([
      'session.hello',
      'chat.send',
      'chat.cancel',
      'change.decide',
      'keys.set',
      'keys.status',
      'provider.select',
      'diagnostics.export',
    ])
    expect(pluginMethods).toEqual(['meter', 'context.changed'])
    expect(companionMethods).toEqual([
      'chat.message',
      'chat.delta',
      'chat.done',
      'tool.started',
      'tool.finished',
      'change.proposed',
      'change.applied',
      'analysis.result',
      'usage',
      'error',
    ])
  })
})

describe('plugin to companion', () => {
  it.each(requestMethods)('round-trips a %s request', (method) => {
    const line = encodePluginRequest(7, method, sampleParams[method])
    expect(decodeFromPlugin(line)).toEqual({
      ok: true,
      value: { kind: 'request', id: 7, method, params: sampleParams[method] },
    })
  })

  it.each(pluginMethods)('round-trips a %s notification', (method) => {
    const line = encodePluginNotification(method, samplePluginNotifications[method])
    expect(decodeFromPlugin(line)).toEqual({
      ok: true,
      value: { kind: 'notification', method, params: samplePluginNotifications[method] },
    })
  })

  it('drops unknown fields so newer plugins stay compatible', () => {
    const line = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'chat.send',
      params: { instanceId, text: 'hi', attachments: [] },
    })
    expect(decodeFromPlugin(line)).toEqual({
      ok: true,
      value: { kind: 'request', id: 1, method: 'chat.send', params: { instanceId, text: 'hi' } },
    })
  })

  it('answers unknown methods with method not found, keeping the id', () => {
    const decoded = decodeFromPlugin('{"jsonrpc":"2.0","id":9,"method":"session.delete"}')
    expect(decoded).toEqual({
      ok: false,
      error: {
        id: 9,
        error: { code: rpcErrorCodes.methodNotFound, message: 'Method not found: session.delete' },
      },
    })
  })

  it('does not treat inherited object keys as methods', () => {
    expect(failureCode('{"jsonrpc":"2.0","id":1,"method":"toString"}', 'plugin')).toBe(
      rpcErrorCodes.methodNotFound,
    )
    expect(failureCode('{"jsonrpc":"2.0","method":"__proto__"}', 'plugin')).toBe(
      rpcErrorCodes.methodNotFound,
    )
  })

  it('names the bad field in invalid params', () => {
    const line = encodePluginRequest(3, 'keys.set', { provider: 'gemini', key: 'k' } as never)
    expect(decodeFromPlugin(line)).toEqual({
      ok: false,
      error: {
        id: 3,
        error: {
          code: rpcErrorCodes.invalidParams,
          message: 'Invalid params: params.provider: expected one of "anthropic", "openai", "xai"',
        },
      },
    })
  })

  it('accepts diagnostics.export without params fields and leaves content off', () => {
    const line = JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'diagnostics.export', params: {} })
    expect(decodeFromPlugin(line)).toEqual({
      ok: true,
      value: { kind: 'request', id: 4, method: 'diagnostics.export', params: {} },
    })
  })

  it('rejects a non-boolean includeContent', () => {
    const line = JSON.stringify({
      jsonrpc: '2.0',
      id: 5,
      method: 'diagnostics.export',
      params: { includeContent: 'yes' },
    })
    expect(failureCode(line, 'plugin')).toBe(rpcErrorCodes.invalidParams)
  })

  it('rejects an empty chat message and an empty instance id', () => {
    expect(
      failureCode(encodePluginRequest(1, 'chat.send', { instanceId, text: '' }), 'plugin'),
    ).toBe(rpcErrorCodes.invalidParams)
    expect(
      failureCode(
        encodePluginNotification('meter', { instanceId: '', momentaryLufs: null, bands: [] }),
        'plugin',
      ),
    ).toBe(rpcErrorCodes.invalidParams)
  })

  it('rejects responses and companion notifications', () => {
    expect(failureCode('{"jsonrpc":"2.0","id":1,"result":{}}', 'plugin')).toBe(
      rpcErrorCodes.invalidRequest,
    )
    const delta = encodeCompanionNotification(
      'chat.delta',
      sampleCompanionNotifications['chat.delta'],
    )
    expect(failureCode(delta, 'plugin')).toBe(rpcErrorCodes.methodNotFound)
  })
})

describe('companion to plugin', () => {
  it.each(companionMethods)('round-trips a %s notification', (method) => {
    const line = encodeCompanionNotification(method, sampleCompanionNotifications[method])
    expect(decodeFromCompanion(line)).toEqual({
      ok: true,
      value: { kind: 'notification', method, params: sampleCompanionNotifications[method] },
    })
  })

  it.each(requestMethods)('round-trips a %s result', (method) => {
    const line = encodeResponse(5, method, { ok: true, value: sampleResults[method] })
    const decoded = decodeFromCompanion(line)
    expect(decoded.ok && decoded.value.kind === 'response').toBe(true)
    if (!decoded.ok || decoded.value.kind !== 'response') return
    expect(decoded.value.id).toBe(5)
    expect(decodeResult(method, decoded.value.outcome)).toEqual({
      ok: true,
      value: sampleResults[method],
    })
  })

  it('passes error responses through decodeResult', () => {
    const error = { code: rpcErrorCodes.handshakeRequired, message: 'hello first' }
    const decoded = decodeFromCompanion(encodeResponse(1, 'chat.send', { ok: false, error }))
    expect(decoded.ok && decoded.value.kind === 'response' && decoded.value.outcome).toEqual({
      ok: false,
      error,
    })
  })

  it('turns a malformed result into an error', () => {
    expect(decodeResult('chat.send', { ok: true, value: { turn: 1 } })).toEqual({
      ok: false,
      error: {
        code: rpcErrorCodes.invalidParams,
        message:
          'Invalid chat.send result: result.turnId: expected non-empty string, got undefined',
      },
    })
  })

  it('rejects a change proposal row without an id', () => {
    const params = {
      ...sampleCompanionNotifications['change.proposed'],
      rows: [{ control: 'fader', location: 'Vox', before: 0, after: -6 }],
    }
    const line = JSON.stringify({ jsonrpc: '2.0', method: 'change.proposed', params })
    expect(failureCode(line, 'companion')).toBe(rpcErrorCodes.invalidParams)
  })

  it('rejects requests and plugin notifications', () => {
    expect(failureCode(encodePluginRequest(1, 'keys.status', {}), 'companion')).toBe(
      rpcErrorCodes.methodNotFound,
    )
    const meter = encodePluginNotification('meter', samplePluginNotifications.meter)
    expect(failureCode(meter, 'companion')).toBe(rpcErrorCodes.methodNotFound)
  })
})

describe('encodeFailure', () => {
  it('encodes a decode failure as an error response', () => {
    const decoded = decodeFromPlugin('not json')
    expect(decoded.ok).toBe(false)
    if (decoded.ok) return
    expect(encodeFailure(decoded.error)).toBe(
      '{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error: invalid JSON"}}\n',
    )
  })
})
