import { describe, expect, it } from 'vitest'
import {
  BUTTON,
  MODEL,
  applyLcd,
  applyMessage,
  challengeResponse,
  decodeMessage,
  encodeButton,
  encodeFader,
  encodeFaderMove,
  encodeHostConnectionQuery,
  encodeVPotTurn,
  findStrip,
  initialSurfaceState,
  lcdRows,
  splitMessages,
  stripCells,
} from '../../src/mcu/index.js'
import { hex } from './hex.js'

describe('spec examples from Logic 7 Dedicated Control Surface Support, Appendix B', () => {
  it('decodes the LCD example that writes Hello at the top left', () => {
    expect(decodeMessage(hex('F0 00 00 66 10 12 00 48 65 6C 6C 6F F7'))).toEqual({
      kind: 'lcd',
      model: MODEL.logicControl,
      offset: 0,
      text: 'Hello',
    })
  })

  it('decodes the fader example E0 40 55 as (0x55 << 7) + 0x40', () => {
    expect(decodeMessage(hex('E0 40 55'))).toEqual({
      kind: 'fader',
      fader: 0,
      value: (0x55 << 7) + 0x40,
    })
  })

  it('encodes a fader position as low then high seven bits', () => {
    expect(encodeFader(0, (0x55 << 7) + 0x40)).toEqual(hex('E0 40 55'))
    expect(encodeFader(8, 0x3fff)).toEqual(hex('E8 7F 7F'))
  })

  it('clamps fader index and value', () => {
    expect(encodeFader(12, 99999)).toEqual(hex('E8 7F 7F'))
    expect(encodeFader(-1, -5)).toEqual(hex('E0 00 00'))
  })

  it('encodes SOLO Ch. 8 press and release', () => {
    expect(encodeButton(BUTTON.solo + 7, true)).toEqual(hex('90 0F 7F'))
    expect(encodeButton(BUTTON.solo + 7, false)).toEqual(hex('90 0F 00'))
  })

  it('decodes LED on, off and flashing', () => {
    expect(decodeMessage(hex('90 08 7F'))).toEqual({ kind: 'led', id: 0x08, state: 'on' })
    expect(decodeMessage(hex('90 08 00'))).toEqual({ kind: 'led', id: 0x08, state: 'off' })
    expect(decodeMessage(hex('90 08 01'))).toEqual({ kind: 'led', id: 0x08, state: 'flash' })
    expect(decodeMessage(hex('80 08 40'))).toEqual({ kind: 'led', id: 0x08, state: 'off' })
  })

  it('encodes V-Pot turns as direction bit plus tick count', () => {
    expect(encodeVPotTurn(0, 1)).toEqual(hex('B0 10 01'))
    expect(encodeVPotTurn(7, -7)).toEqual(hex('B0 17 47'))
    expect(encodeVPotTurn(0, 500)).toEqual(hex('B0 10 3F'))
  })

  it('decodes the V-Pot ring example B0 31 06', () => {
    expect(decodeMessage(hex('B0 31 06'))).toEqual({
      kind: 'vpot-ring',
      strip: 1,
      center: false,
      mode: 'dot',
      position: 6,
    })
    expect(decodeMessage(hex('B0 30 56'))).toEqual({
      kind: 'vpot-ring',
      strip: 0,
      center: true,
      mode: 'boost-cut',
      position: 6,
    })
  })

  it('decodes the time code example right to left as 109.02.01.126', () => {
    const message = decodeMessage(hex('F0 00 00 66 10 10 36 32 31 71 30 72 30 79 30 31 F7'))
    if (message.kind !== 'timecode') throw new Error(`expected timecode, got ${message.kind}`)
    const text = [...message.digits]
      .reverse()
      .map(({ char, dot }) => (dot ? `${char}.` : char))
      .join('')
    expect(text).toBe('109.02.01.126')
  })

  it('decodes single assignment digits from B0 4B 10 and B0 4A 4E', () => {
    expect(decodeMessage(hex('B0 4B 10'))).toEqual({
      kind: 'segment',
      digit: 0x0b,
      char: { char: 'P', dot: false },
    })
    expect(decodeMessage(hex('B0 4A 4E'))).toEqual({
      kind: 'segment',
      digit: 0x0a,
      char: { char: 'N', dot: true },
    })
  })

  it('decodes meter levels and overload flags', () => {
    expect(decodeMessage(hex('D0 3C'))).toEqual({
      kind: 'meter',
      strip: 3,
      level: { kind: 'level', value: 12 },
    })
    expect(decodeMessage(hex('D0 7E'))).toEqual({
      kind: 'meter',
      strip: 7,
      level: { kind: 'set-overload' },
    })
    expect(decodeMessage(hex('D0 0F'))).toEqual({
      kind: 'meter',
      strip: 0,
      level: { kind: 'clear-overload' },
    })
  })
})

describe('handshake', () => {
  it('decodes a device query for the Mackie Control model', () => {
    expect(decodeMessage(hex('F0 00 00 66 14 00 F7'))).toEqual({
      kind: 'device-query',
      model: MODEL.mackieControl,
    })
  })

  it('encodes a host connection query with serial and challenge', () => {
    const serial = [...'CLOGIC1'].map((c) => c.charCodeAt(0))
    expect(encodeHostConnectionQuery(MODEL.mackieControl, serial, [1, 2, 3, 4])).toEqual([
      0xf0,
      0x00,
      0x00,
      0x66,
      0x14,
      0x01,
      ...serial,
      1,
      2,
      3,
      4,
      0xf7,
    ])
  })

  it('decodes a host connection reply', () => {
    const message = decodeMessage(hex('F0 00 00 66 14 02 43 4C 4F 47 49 43 31 05 05 7B 2F F7'))
    expect(message).toEqual({
      kind: 'host-connection-reply',
      model: MODEL.mackieControl,
      serial: hex('43 4C 4F 47 49 43 31'),
      response: [5, 5, 0x7b, 0x2f],
    })
  })

  it('computes the published challenge response with C integer semantics', () => {
    expect(challengeResponse([1, 2, 3, 4])).toEqual([5, 5, 0x7b, 0x2f])
  })

  it('always returns seven bit response bytes', () => {
    const challenges: readonly (readonly [number, number, number, number])[] = [
      [0, 0, 0, 0],
      [0x7f, 0x7f, 0x7f, 0x7f],
      [0x12, 0x34, 0x56, 0x78],
      [0x7f, 0x00, 0x7f, 0x00],
    ]
    for (const challenge of challenges) {
      for (const byte of challengeResponse(challenge)) {
        expect(byte).toBeGreaterThanOrEqual(0)
        expect(byte).toBeLessThanOrEqual(0x7f)
      }
    }
  })

  it('decodes go offline', () => {
    expect(decodeMessage(hex('F0 00 00 66 14 0F 7F F7'))).toEqual({
      kind: 'go-offline',
      model: MODEL.mackieControl,
    })
  })

  it('reports foreign sysex as unknown', () => {
    expect(decodeMessage(hex('F0 7E 7F 06 01 F7')).kind).toBe('unknown')
  })
})

describe('splitMessages', () => {
  it('splits running status, sysex and realtime bytes', () => {
    const stream = hex('E0 00 40 01 40 F8 F0 00 00 66 14 12 00 41 F7 90 18 7F 19 00 D0 3C 1C')
    expect(splitMessages(stream)).toEqual([
      hex('E0 00 40'),
      hex('E0 01 40'),
      hex('F0 00 00 66 14 12 00 41 F7'),
      hex('90 18 7F'),
      hex('90 19 00'),
      hex('D0 3C'),
      hex('D0 1C'),
    ])
  })

  it('drops a sysex message interrupted by a status byte', () => {
    expect(splitMessages(hex('F0 00 00 66 90 18 7F'))).toEqual([])
  })
})

describe('fader moves', () => {
  it('wraps a fader write in touch and release', () => {
    expect(encodeFaderMove(2, 0x2000)).toEqual([hex('90 6A 7F'), hex('E2 00 40'), hex('90 6A 00')])
  })
})

describe('LCD state ported from the prototype', () => {
  it('writes text at an offset and wraps into the lower row', () => {
    const lcd = applyLcd(initialSurfaceState.lcd, 54, 'abcd')
    const [upper, lower] = lcdRows(lcd)
    expect(upper.endsWith('ab')).toBe(true)
    expect(lower.startsWith('cd')).toBe(true)
    expect(lcd).toHaveLength(112)
  })

  it('ignores text past the end of the display', () => {
    expect(applyLcd(initialSurfaceState.lcd, 110, 'xyz')).toHaveLength(112)
  })

  it('reads eight strip names from seven character cells', () => {
    const row = 'Kick   Snare  OH     Bass   Gtr L  Gtr R  Vox    Master '
    expect(stripCells(row)).toEqual([
      'Kick',
      'Snare',
      'OH',
      'Bass',
      'Gtr L',
      'Gtr R',
      'Vox',
      'Master',
    ])
  })

  it('finds a strip by its visible name and refuses ambiguous truncations', () => {
    const row = 'Kick   DelCls DelCls Bass                               '
    expect(findStrip(row, 'Bass')).toEqual({ kind: 'found', strip: 3 })
    expect(findStrip(row, 'Vox')).toEqual({ kind: 'not-visible' })
    expect(findStrip(row, 'DelCls')).toEqual({ kind: 'ambiguous', strips: [1, 2] })
  })

  it('folds decoded host messages into surface state', () => {
    const state = [hex('F0 00 00 66 14 12 00 4B 69 63 6B F7'), hex('E3 7F 7F'), hex('90 10 7F')]
      .map(decodeMessage)
      .reduce(applyMessage, initialSurfaceState)
    expect(stripCells(lcdRows(state.lcd)[0])[0]).toBe('Kick')
    expect(state.faders[3]).toBe(0x3fff)
    expect(state.leds.get(BUTTON.mute)).toBe('on')
  })
})
