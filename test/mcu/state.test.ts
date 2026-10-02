import { describe, expect, it } from 'vitest'
import {
  BUTTON,
  applyMidi,
  faderPosition,
  initialSurfaceState,
  lcdRows,
  ledOf,
  stripNames,
} from '../../src/mcu/index.js'
import type { SurfaceState } from '../../src/mcu/index.js'
import { hex } from './hex.js'

const fold = (messages: readonly string[]): SurfaceState =>
  messages.map(hex).reduce(applyMidi, initialSurfaceState)

const lcdWrite = (offset: number, text: string): string =>
  [
    'F0 00 00 66 14 12',
    offset.toString(16),
    ...[...text].map((c) => c.charCodeAt(0).toString(16)),
    'F7',
  ].join(' ')

describe('surface state tracking', () => {
  it('reports no strip names until Logic has written the LCD', () => {
    expect(stripNames(initialSurfaceState)).toEqual({ ok: false, error: { kind: 'no-lcd-data' } })
  })

  it('reads strip names from LCD writes split across messages', () => {
    const state = fold([
      lcdWrite(0, 'Kick   Snare  '),
      lcdWrite(14, 'OH     Bass'),
      lcdWrite(49, 'Master'),
    ])
    expect(stripNames(state)).toEqual({
      ok: true,
      value: ['Kick', 'Snare', 'OH', 'Bass', '', '', '', 'Master'],
    })
  })

  it('keeps names when the lower row is rewritten', () => {
    const state = fold([lcdWrite(0, 'Kick'), lcdWrite(56, '-6.0dB')])
    const names = stripNames(state)
    expect(names.ok && names.value[0]).toBe('Kick')
    expect(lcdRows(state.lcd)[1].startsWith('-6.0dB')).toBe(true)
  })

  it('tracks echoed fader positions and leaves unseen faders unknown', () => {
    const state = fold(['E0 40 55', 'E8 7F 7F', 'E0 00 20'])
    expect(faderPosition(state, 0)).toBe(0x20 << 7)
    expect(faderPosition(state, 8)).toBe(0x3fff)
    expect(faderPosition(state, 3)).toBeUndefined()
  })

  it('ignores pitch bend on channels above the master fader', () => {
    expect(fold(['EA 7F 7F']).faders).toEqual(initialSurfaceState.faders)
  })

  it('tracks mute and solo LEDs per strip', () => {
    const state = fold(['90 10 7F', '90 0A 01', '90 10 00'])
    expect(ledOf(state, BUTTON.mute)).toBe('off')
    expect(ledOf(state, BUTTON.solo + 2)).toBe('flash')
    expect(ledOf(state, BUTTON.mute + 1)).toBeUndefined()
  })

  it('does not mutate the previous state', () => {
    const before = fold(['E0 00 00'])
    fold(['E0 00 00', 'E0 7F 7F', '90 10 7F'])
    applyMidi(before, hex('E0 7F 7F'))
    expect(faderPosition(before, 0)).toBe(0)
    expect(before.leds.size).toBe(0)
  })
})
