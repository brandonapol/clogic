import { dbToPosition } from './calibration.js'
import type { FaderCalibration, LookupError } from './calibration.js'
import { encodeButtonPress, encodeFaderMove } from './encode.js'
import { BUTTON, FADER_MAX, MASTER_FADER, STRIP_COUNT } from './protocol.js'
import type { MidiMessage } from './protocol.js'
import { err, ok } from './result.js'
import type { Result } from './result.js'
import { ledOf } from './state.js'
import type { SurfaceState } from './state.js'

export type Intent =
  | { readonly kind: 'set-fader-db'; readonly fader: number; readonly db: number }
  | { readonly kind: 'set-fader-position'; readonly fader: number; readonly position: number }
  | { readonly kind: 'set-mute'; readonly strip: number; readonly on: boolean }
  | { readonly kind: 'set-solo'; readonly strip: number; readonly on: boolean }
  | { readonly kind: 'read-strip-names' }
  | { readonly kind: 'press-button'; readonly button: number }

export type PlanStep =
  | { readonly kind: 'send'; readonly message: MidiMessage }
  | { readonly kind: 'read'; readonly target: 'strip-names' }

export type Plan = readonly PlanStep[]

export type Allowlist = {
  readonly buttons: ReadonlySet<number>
  readonly faders: boolean
}

export type PlanError =
  | { readonly kind: 'refused'; readonly button: number; readonly reason: string }
  | { readonly kind: 'message-not-allowed'; readonly message: MidiMessage }
  | { readonly kind: 'invalid-strip'; readonly strip: number }
  | { readonly kind: 'invalid-position'; readonly position: number }
  | { readonly kind: 'uncalibrated' }
  | LookupError
  | { readonly kind: 'state-unknown'; readonly strip: number; readonly control: 'mute' | 'solo' }

export type PlanOptions = {
  readonly allowlist?: Allowlist
  readonly calibration?: FaderCalibration
}

const range = (start: number, count: number): readonly number[] =>
  Array.from({ length: count }, (_, index) => start + index)

export const DANGEROUS_BUTTONS: ReadonlyMap<number, string> = new Map([
  [BUTTON.save, 'saves the project'],
  ...range(BUTTON.vSelect, STRIP_COUNT).map(
    (id) => [id, 'V-Pot press can insert or remove a plug-in or reset a parameter'] as const,
  ),
  [BUTTON.assignEq, 'EQ view inserts a Channel EQ if the strip has none'],
  [BUTTON.assignPlugin, 'Plug-in view arms V-Pot presses that insert or remove plug-ins'],
  [BUTTON.assignInstrument, 'Instrument view arms V-Pot presses that insert or remove plug-ins'],
  [BUTTON.shift, 'modifier combinations create tracks or clear states on all channels'],
  [BUTTON.option, 'modifier combinations create tracks or clear states on all channels'],
  [BUTTON.control, 'modifier combinations change button meanings'],
  [BUTTON.cmdAlt, 'modifier combinations change button meanings'],
  [BUTTON.automationWrite, 'automation Write raises a modal dialog'],
  [BUTTON.enter, 'confirms whatever alert is on screen'],
  [BUTTON.cancel, 'dismisses whatever alert is on screen'],
  [BUTTON.undo, 'undo behaviour for surface changes is unverified'],
])

export const DEFAULT_ALLOWLIST: Allowlist = {
  buttons: new Set([
    ...range(BUTTON.solo, STRIP_COUNT),
    ...range(BUTTON.mute, STRIP_COUNT),
    ...range(BUTTON.faderTouch, MASTER_FADER + 1),
    BUTTON.bankLeft,
    BUTTON.bankRight,
    BUTTON.channelLeft,
    BUTTON.channelRight,
  ]),
  faders: true,
}

export const checkMessage = (
  allowlist: Allowlist,
  message: MidiMessage,
): Result<MidiMessage, PlanError> => {
  const [status, data1, data2] = message
  if (status === 0x90 && data1 !== undefined && data2 !== undefined && message.length === 3) {
    return allowlist.buttons.has(data1)
      ? ok(message)
      : err({
          kind: 'refused',
          button: data1,
          reason: DANGEROUS_BUTTONS.get(data1) ?? 'not in the allowlist',
        })
  }
  const isFader =
    status !== undefined &&
    (status & 0xf0) === 0xe0 &&
    (status & 0x0f) <= MASTER_FADER &&
    message.length === 3
  return isFader && allowlist.faders ? ok(message) : err({ kind: 'message-not-allowed', message })
}

const sends = (messages: readonly MidiMessage[]): Plan =>
  messages.map((message) => ({ kind: 'send', message }))

const validFader = (fader: number): boolean =>
  Number.isInteger(fader) && fader >= 0 && fader <= MASTER_FADER

const validStrip = (strip: number): boolean =>
  Number.isInteger(strip) && strip >= 0 && strip < STRIP_COUNT

const planFader = (fader: number, position: number): Result<Plan, PlanError> => {
  if (!validFader(fader)) return err({ kind: 'invalid-strip', strip: fader })
  if (!Number.isInteger(position) || position < 0 || position > FADER_MAX) {
    return err({ kind: 'invalid-position', position })
  }
  return ok(sends(encodeFaderMove(fader, position)))
}

const planToggle = (
  state: SurfaceState,
  control: 'mute' | 'solo',
  strip: number,
  on: boolean,
): Result<Plan, PlanError> => {
  if (!validStrip(strip)) return err({ kind: 'invalid-strip', strip })
  const button = BUTTON[control] + strip
  const current = ledOf(state, button)
  if (current === undefined || current === 'flash') {
    return err({ kind: 'state-unknown', strip, control })
  }
  return (current === 'on') === on ? ok([]) : ok(sends(encodeButtonPress(button)))
}

const draft = (
  intent: Intent,
  state: SurfaceState,
  calibration: FaderCalibration | undefined,
): Result<Plan, PlanError> => {
  switch (intent.kind) {
    case 'set-fader-position':
      return planFader(intent.fader, intent.position)
    case 'set-fader-db': {
      if (!validFader(intent.fader)) return err({ kind: 'invalid-strip', strip: intent.fader })
      if (calibration === undefined) return err({ kind: 'uncalibrated' })
      const position = dbToPosition(calibration, intent.db)
      return position.ok ? planFader(intent.fader, position.value) : position
    }
    case 'set-mute':
      return planToggle(state, 'mute', intent.strip, intent.on)
    case 'set-solo':
      return planToggle(state, 'solo', intent.strip, intent.on)
    case 'read-strip-names':
      return ok([{ kind: 'read', target: 'strip-names' }])
    case 'press-button':
      return ok(sends(encodeButtonPress(intent.button)))
  }
}

export const planIntent = (
  intent: Intent,
  state: SurfaceState,
  options: PlanOptions = {},
): Result<Plan, PlanError> => {
  const allowlist = options.allowlist ?? DEFAULT_ALLOWLIST
  const plan = draft(intent, state, options.calibration)
  if (!plan.ok) return plan
  const refusal = plan.value
    .map((step) => (step.kind === 'send' ? checkMessage(allowlist, step.message) : ok(undefined)))
    .find((result) => !result.ok)
  return refusal === undefined || refusal.ok ? plan : refusal
}
