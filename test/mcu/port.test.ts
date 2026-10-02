import { describe, expect, it } from 'vitest'
import { memoryMidiPort, sendAll } from '../../src/mcu/index.js'
import type { MidiMessage } from '../../src/mcu/index.js'
import { hex } from './hex.js'

describe('memoryMidiPort', () => {
  it('records sent messages', () => {
    const fake = memoryMidiPort()
    expect(fake.port.send(hex('90 10 7F'))).toEqual({ ok: true, value: undefined })
    expect(fake.sent()).toEqual([hex('90 10 7F')])
  })

  it('delivers received messages to subscribers until they unsubscribe', () => {
    const fake = memoryMidiPort()
    const seen: MidiMessage[] = []
    const unsubscribe = fake.port.subscribe((message) => seen.push(message))
    fake.receive(hex('E0 40 55'))
    unsubscribe()
    fake.receive(hex('E0 00 00'))
    expect(seen).toEqual([hex('E0 40 55')])
  })

  it('refuses to send after close', () => {
    const fake = memoryMidiPort()
    fake.close()
    expect(fake.port.send(hex('90 10 7F'))).toEqual({ ok: false, error: { kind: 'port-closed' } })
    expect(fake.sent()).toEqual([])
  })
})

describe('sendAll', () => {
  it('sends every message in order and counts them', () => {
    const fake = memoryMidiPort()
    expect(sendAll(fake.port, [hex('90 68 7F'), hex('E0 00 40'), hex('90 68 00')])).toEqual({
      ok: true,
      value: 3,
    })
    expect(fake.sent()).toHaveLength(3)
  })

  it('stops at the first failure and reports how many were sent', () => {
    const fake = memoryMidiPort()
    const calls: MidiMessage[] = []
    const port = {
      ...fake.port,
      send: (message: MidiMessage) => {
        calls.push(message)
        return calls.length === 2
          ? { ok: false as const, error: { kind: 'send-failed' as const, message: 'gone' } }
          : fake.port.send(message)
      },
    }
    expect(sendAll(port, [hex('90 68 7F'), hex('E0 00 40'), hex('90 68 00')])).toEqual({
      ok: false,
      error: { kind: 'send-failed', message: 'gone', sent: 1 },
    })
    expect(calls).toHaveLength(2)
  })
})
