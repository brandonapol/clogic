import { err, ok, type Result } from '../../llm/result.js'
import {
  BUTTON,
  faderPosition,
  ledOf,
  positionToDb,
  stripNames,
  type FaderCalibration,
  type PlanError,
  type SurfaceState,
} from '../../mcu/index.js'
import type { ToolError } from '../types.js'

export type Toggle = 'mute' | 'solo'

export type ToggleState = 'on' | 'off' | 'flashing' | 'unknown'

export type Strip = {
  readonly strip: number
  readonly name: string
}

const TRUNCATED_CELL_LENGTH = 6

const unavailable = (message: string): ToolError => ({ kind: 'unavailable', message })

const invalidInput = (message: string): ToolError => ({ kind: 'invalid_input', message })

export const visibleStrips = (state: SurfaceState): Result<readonly Strip[], ToolError> => {
  const names = stripNames(state)
  if (!names.ok)
    return err(
      unavailable(
        'No track names have been received from Logic yet. Check that the Mackie Control ' +
          'surface is set up and connected.',
      ),
    )
  return ok(names.value.flatMap((name, strip) => (name === '' ? [] : [{ strip, name }])))
}

const matching = (strips: readonly Strip[], matches: (cell: string) => boolean): readonly Strip[] =>
  strips.filter((strip) => matches(strip.name))

export const resolveStrip = (state: SurfaceState, track: string): Result<Strip, ToolError> => {
  const visible = visibleStrips(state)
  if (!visible.ok) return visible
  const wanted = track.trim()
  const lower = wanted.toLowerCase()
  const candidates = [
    matching(visible.value, (cell) => cell === wanted),
    matching(visible.value, (cell) => cell.toLowerCase() === lower),
    matching(
      visible.value,
      (cell) => cell.length >= TRUNCATED_CELL_LENGTH && lower.startsWith(cell.toLowerCase()),
    ),
  ].find((found) => found.length > 0)
  const names = visible.value.map((strip) => strip.name)
  if (candidates === undefined)
    return err(
      invalidInput(
        `No visible track named "${wanted}". Visible tracks: ` +
          (names.length === 0 ? 'none' : names.join(', ')),
      ),
    )
  const [first, ...rest] = candidates
  if (first === undefined || rest.length > 0)
    return err(
      invalidInput(
        `"${wanted}" matches more than one visible track (strips ` +
          candidates.map((strip) => String(strip.strip + 1)).join(', ') +
          '). Rename the tracks so their names are unique.',
      ),
    )
  return ok(first)
}

export const toggleState = (state: SurfaceState, control: Toggle, strip: number): ToggleState => {
  const led = ledOf(state, BUTTON[control] + strip)
  return led === undefined ? 'unknown' : led === 'flash' ? 'flashing' : led
}

export const faderDb = (
  state: SurfaceState,
  calibration: FaderCalibration | undefined,
  strip: number,
): number | null => {
  const position = faderPosition(state, strip)
  if (position === undefined || calibration === undefined) return null
  const db = positionToDb(calibration, position)
  return db.ok ? db.value : null
}

export const formatDb = (db: number | null): string =>
  db === null ? 'unknown' : db === -Infinity ? '-inf dB' : `${db.toFixed(1)} dB`

export const uncalibrated: ToolError = unavailable(
  'Fader volume cannot be set yet: the fader position to dB calibration has not been measured ' +
    'for this Logic setup, so an exact dB value cannot be written.',
)

export const describePlanError = (error: PlanError): ToolError => {
  switch (error.kind) {
    case 'uncalibrated':
      return uncalibrated
    case 'db-out-of-range':
      return invalidInput(
        `${String(error.db)} dB is outside the calibrated range ` +
          `${formatDb(error.min)} to ${formatDb(error.max)}`,
      )
    case 'position-out-of-range':
      return invalidInput(`Fader position ${String(error.position)} is out of range`)
    case 'invalid-position':
      return invalidInput(`Fader position ${String(error.position)} is out of range`)
    case 'invalid-strip':
      return invalidInput(`Strip ${String(error.strip + 1)} is not on the surface`)
    case 'state-unknown':
      return unavailable(
        `The ${error.control} state of strip ${String(error.strip + 1)} is not known yet, ` +
          'so it cannot be changed safely',
      )
    case 'refused':
      return { kind: 'failed', message: `Refused to press a control that ${error.reason}` }
    case 'message-not-allowed':
      return { kind: 'failed', message: 'Refused to send a message outside the allowlist' }
  }
}
