import { describe, expect, it } from 'vitest'
import { acceptHello, admit, initialSession, protocolVersion } from '../../src/rpc/handshake.js'
import { rpcErrorCodes } from '../../src/rpc/jsonrpc.js'
import { sampleParams } from './fixtures.js'

const hello = sampleParams['session.hello']

describe('acceptHello', () => {
  it('accepts the current protocol version and names the companion', () => {
    expect(acceptHello(hello, 'companion 1')).toEqual({
      ok: true,
      value: { protocolVersion, companion: 'companion 1' },
    })
  })

  it('rejects an unsupported version with the supported list', () => {
    expect(acceptHello({ ...hello, protocolVersion: 99 }, 'c')).toEqual({
      ok: false,
      error: {
        code: rpcErrorCodes.unsupportedProtocolVersion,
        message: 'Unsupported protocol version 99; supported: 1',
      },
    })
  })

  it('echoes the client version when several are supported', () => {
    expect(acceptHello({ ...hello, protocolVersion: 2 }, 'c', [1, 2])).toEqual({
      ok: true,
      value: { protocolVersion: 2, companion: 'c' },
    })
  })
})

describe('admit', () => {
  it('only allows session.hello before the handshake', () => {
    expect(admit(initialSession, 'session.hello').ok).toBe(true)
    const blocked = admit(initialSession, 'chat.send')
    expect(blocked.ok ? undefined : blocked.error.code).toBe(rpcErrorCodes.handshakeRequired)
  })

  it('allows other methods after the handshake but not a second hello', () => {
    const ready = { phase: 'ready', hello } as const
    expect(admit(ready, 'chat.send').ok).toBe(true)
    const again = admit(ready, 'session.hello')
    expect(again.ok ? undefined : again.error.code).toBe(rpcErrorCodes.invalidRequest)
  })
})
