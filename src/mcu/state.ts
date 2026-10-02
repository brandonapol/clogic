import { decodeMessage } from './decode.js'
import { LCD_CELL_WIDTH, LCD_SIZE, LCD_WIDTH, MASTER_FADER, STRIP_COUNT } from './protocol.js'
import type { HostMessage, LedState, MidiMessage } from './protocol.js'
import { err, ok } from './result.js'
import type { Result } from './result.js'

export type SurfaceState = {
  readonly lcd: string
  readonly lcdSeen: boolean
  readonly faders: readonly (number | undefined)[]
  readonly leds: ReadonlyMap<number, LedState>
}

export const initialSurfaceState: SurfaceState = {
  lcd: ' '.repeat(LCD_SIZE),
  lcdSeen: false,
  faders: Array.from({ length: MASTER_FADER + 1 }, () => undefined),
  leds: new Map(),
}

export const applyLcd = (lcd: string, offset: number, text: string): string => {
  const clipped = text.slice(0, Math.max(0, LCD_SIZE - offset))
  return lcd.slice(0, offset) + clipped + lcd.slice(offset + clipped.length)
}

export const applyMessage = (state: SurfaceState, message: HostMessage): SurfaceState => {
  switch (message.kind) {
    case 'lcd':
      return { ...state, lcd: applyLcd(state.lcd, message.offset, message.text), lcdSeen: true }
    case 'fader':
      return message.fader > MASTER_FADER
        ? state
        : {
            ...state,
            faders: state.faders.map((value, index) =>
              index === message.fader ? message.value : value,
            ),
          }
    case 'led':
      return { ...state, leds: new Map([...state.leds, [message.id, message.state]]) }
    default:
      return state
  }
}

export const applyMidi = (state: SurfaceState, bytes: MidiMessage): SurfaceState =>
  applyMessage(state, decodeMessage(bytes))

export const lcdRows = (lcd: string): readonly [string, string] => [
  lcd.slice(0, LCD_WIDTH),
  lcd.slice(LCD_WIDTH, LCD_SIZE),
]

export const stripCells = (row: string): readonly string[] =>
  Array.from({ length: STRIP_COUNT }, (_, strip) =>
    row.slice(strip * LCD_CELL_WIDTH, (strip + 1) * LCD_CELL_WIDTH).trim(),
  )

export type NoLcdData = { readonly kind: 'no-lcd-data' }

export const stripNames = (state: SurfaceState): Result<readonly string[], NoLcdData> =>
  state.lcdSeen ? ok(stripCells(lcdRows(state.lcd)[0])) : err({ kind: 'no-lcd-data' })

export const faderPosition = (state: SurfaceState, fader: number): number | undefined =>
  state.faders[fader]

export const ledOf = (state: SurfaceState, id: number): LedState | undefined => state.leds.get(id)

export type StripMatch =
  | { readonly kind: 'found'; readonly strip: number }
  | { readonly kind: 'not-visible' }
  | { readonly kind: 'ambiguous'; readonly strips: readonly number[] }

export const findStrip = (upperRow: string, label: string): StripMatch => {
  const wanted = label.trim()
  const strips = stripCells(upperRow).flatMap((cell, strip) => (cell === wanted ? [strip] : []))
  const [first] = strips
  if (first === undefined) return { kind: 'not-visible' }
  return strips.length === 1 ? { kind: 'found', strip: first } : { kind: 'ambiguous', strips }
}
