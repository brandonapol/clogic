import { err, ok, type Result } from '../../llm/result.js'
import {
  DEFAULT_ALLOWLIST,
  faderPosition,
  planIntent,
  sendAll,
  type FaderCalibration,
  type Intent,
  type MidiMessage,
  type MidiPort,
  type Plan,
  type SurfaceState,
} from '../../mcu/index.js'
import { defineChangeTool, defineReadTool } from '../define.js'
import { booleanParam, numberParam, stringParam } from '../params.js'
import type {
  ApplyReport,
  ChangeRow,
  ChangeTool,
  FailedRow,
  ReadTool,
  Tool,
  ToolError,
} from '../types.js'
import {
  describePlanError,
  faderDb,
  formatDb,
  resolveStrip,
  toggleState,
  uncalibrated,
  visibleStrips,
  type Strip,
  type Toggle,
} from './strips.js'

export type MixerDeps = {
  readonly port: MidiPort
  readonly state: () => SurfaceState
  readonly calibration: () => FaderCalibration | undefined
}

type Control = 'volume' | Toggle

type RowPlan = {
  readonly strip: Strip
  readonly before: string
  readonly intent: Intent
}

const trackParam = stringParam(
  'Track name as shown on the Mackie Control strip display, for example "Kick" or "Lead Vox".',
)

const roundDb = (db: number): number => Math.round(db * 10) / 10

const toggleLabel = (on: boolean): string => (on ? 'on' : 'off')

const plannedMessages = (plan: Plan): readonly MidiMessage[] =>
  plan.flatMap((step) => (step.kind === 'send' ? [step.message] : []))

const planMessages = (
  intent: Intent,
  state: SurfaceState,
  calibration: FaderCalibration | undefined,
): Result<readonly MidiMessage[], ToolError> => {
  const plan = planIntent(intent, state, {
    allowlist: DEFAULT_ALLOWLIST,
    ...(calibration === undefined ? {} : { calibration }),
  })
  return plan.ok ? ok(plannedMessages(plan.value)) : err(describePlanError(plan.error))
}

const volumeRow = (
  state: SurfaceState,
  calibration: FaderCalibration | undefined,
  track: string,
  db: number,
): Result<RowPlan, ToolError> => {
  if (calibration === undefined) return err(uncalibrated)
  const strip = resolveStrip(state, track)
  if (!strip.ok) return strip
  return ok({
    strip: strip.value,
    before: formatDb(faderDb(state, calibration, strip.value.strip)),
    intent: { kind: 'set-fader-db', fader: strip.value.strip, db: roundDb(db) },
  })
}

const toggleRow = (
  control: Toggle,
  state: SurfaceState,
  track: string,
  on: boolean,
): Result<RowPlan, ToolError> => {
  const strip = resolveStrip(state, track)
  if (!strip.ok) return strip
  return ok({
    strip: strip.value,
    before: toggleState(state, control, strip.value.strip),
    intent: { kind: control === 'mute' ? 'set-mute' : 'set-solo', strip: strip.value.strip, on },
  })
}

const afterLabel = (intent: Intent): string => {
  switch (intent.kind) {
    case 'set-fader-db':
      return formatDb(intent.db)
    case 'set-mute':
    case 'set-solo':
      return toggleLabel(intent.on)
    default:
      return ''
  }
}

const toChangeRows = (
  control: Control,
  row: RowPlan,
  state: SurfaceState,
  calibration: FaderCalibration | undefined,
): Result<readonly ChangeRow[], ToolError> => {
  const messages = planMessages(row.intent, state, calibration)
  if (!messages.ok) return messages
  if (messages.value.length === 0) return ok([])
  return ok([
    {
      id: `${control}:${String(row.strip.strip)}`,
      control,
      location: row.strip.name,
      before: row.before,
      after: afterLabel(row.intent),
    },
  ])
}

const parseDb = (label: string): number | undefined => {
  const match = /^(-?\d+(?:\.\d+)?) dB$/.exec(label)
  return match?.[1] === undefined ? undefined : Number(match[1])
}

const parseToggle = (label: string): boolean | undefined =>
  label === 'on' ? true : label === 'off' ? false : undefined

const rowPlan = (
  control: Control,
  row: ChangeRow,
  state: SurfaceState,
  calibration: FaderCalibration | undefined,
): Result<RowPlan, string> => {
  if (row.control !== control) return err(`Row is not a ${control} change`)
  if (typeof row.after !== 'string') return err('Row has no target value')
  if (control === 'volume') {
    const db = parseDb(row.after)
    if (db === undefined) return err(`Unreadable volume target ${row.after}`)
    const planned = volumeRow(state, calibration, row.location, db)
    return planned.ok ? planned : err(planned.error.message)
  }
  const on = parseToggle(row.after)
  if (on === undefined) return err(`Unreadable ${control} target ${row.after}`)
  const planned = toggleRow(control, state, row.location, on)
  return planned.ok ? planned : err(planned.error.message)
}

const applyRow = (control: Control, deps: MixerDeps, row: ChangeRow): Result<string, FailedRow> => {
  const fail = (message: string): Result<string, FailedRow> => err({ id: row.id, message })
  const state = deps.state()
  const calibration = deps.calibration()
  const planned = rowPlan(control, row, state, calibration)
  if (!planned.ok) return fail(planned.error)
  if (`${control}:${String(planned.value.strip.strip)}` !== row.id)
    return fail(`${row.location} has moved to a different strip since the preview`)
  if (planned.value.before !== row.before)
    return fail(
      `${row.location} ${control} changed since the preview: it is now ${planned.value.before}`,
    )
  const messages = planMessages(planned.value.intent, state, calibration)
  if (!messages.ok) return fail(messages.error.message)
  const sent = sendAll(deps.port, messages.value)
  if (!sent.ok)
    return fail(
      sent.error.kind === 'port-closed'
        ? 'The MIDI port is closed'
        : `Sending to Logic failed: ${sent.error.message}`,
    )
  return ok(row.id)
}

const applyRows = (control: Control, deps: MixerDeps, rows: readonly ChangeRow[]): ApplyReport =>
  rows.reduce<ApplyReport>(
    (report, row) => {
      const result = applyRow(control, deps, row)
      return result.ok
        ? { ...report, applied: [...report.applied, result.value] }
        : { ...report, failed: [...report.failed, result.error] }
    },
    { applied: [], failed: [] },
  )

export const listTracks = (deps: MixerDeps): ReadTool =>
  defineReadTool({
    name: 'list_tracks',
    description:
      'Lists the tracks currently visible on the Mackie Control surface (up to eight strips) with ' +
      'their fader volume, mute and solo state as last reported by Logic. Volume is in dB only ' +
      'when a fader calibration is available. It reads state only and never changes anything.',
    surface: 'control_surface',
    params: {},
    run: async () => {
      const state = deps.state()
      const calibration = deps.calibration()
      const strips = visibleStrips(state)
      if (!strips.ok) return strips
      return ok({
        tracks: strips.value.map(({ strip, name }) => ({
          strip: strip + 1,
          name,
          faderPosition: faderPosition(state, strip) ?? null,
          volume: formatDb(faderDb(state, calibration, strip)),
          mute: toggleState(state, 'mute', strip),
          solo: toggleState(state, 'solo', strip),
        })),
      })
    },
  })

export const setTrackVolume = (deps: MixerDeps): ChangeTool =>
  defineChangeTool({
    name: 'set_track_volume',
    description:
      'Proposes moving a visible track fader to a volume in dB, rounded to 0.1 dB. The user ' +
      'sees a before and after preview and must confirm before the fader moves. Fails when the ' +
      'fader dB calibration has not been measured.',
    surface: 'control_surface',
    params: { track: trackParam, db: numberParam('Target volume in dB, for example -6.') },
    plan: async ({ track, db }) => {
      const state = deps.state()
      const calibration = deps.calibration()
      const row = volumeRow(state, calibration, track, db)
      return row.ok ? toChangeRows('volume', row.value, state, calibration) : row
    },
    apply: async (rows) => applyRows('volume', deps, rows),
  })

const toggleTool = (control: Toggle, name: string, description: string) => (deps: MixerDeps) =>
  defineChangeTool({
    name,
    description,
    surface: 'control_surface',
    params: { track: trackParam, on: booleanParam(`true to turn ${control} on, false for off.`) },
    plan: async ({ track, on }) => {
      const state = deps.state()
      const row = toggleRow(control, state, track, on)
      return row.ok ? toChangeRows(control, row.value, state, deps.calibration()) : row
    },
    apply: async (rows) => applyRows(control, deps, rows),
  })

export const setTrackMute: (deps: MixerDeps) => ChangeTool = toggleTool(
  'mute',
  'set_track_mute',
  'Proposes muting or unmuting a visible track. The user sees a before and after preview and ' +
    'must confirm before anything changes. Proposes nothing when the track is already in that state.',
)

export const setTrackSolo: (deps: MixerDeps) => ChangeTool = toggleTool(
  'solo',
  'set_track_solo',
  'Proposes soloing or unsoloing a visible track. The user sees a before and after preview and ' +
    'must confirm before anything changes. Proposes nothing when the track is already in that state.',
)

export const mixerTools = (deps: MixerDeps): readonly Tool[] => [
  listTracks(deps),
  setTrackVolume(deps),
  setTrackMute(deps),
  setTrackSolo(deps),
]
