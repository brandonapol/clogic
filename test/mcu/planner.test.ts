import { describe, expect, it } from 'vitest'
import {
  BUTTON,
  DANGEROUS_BUTTONS,
  DEFAULT_ALLOWLIST,
  applyMidi,
  checkMessage,
  faderCalibration,
  initialSurfaceState,
  memoryMidiPort,
  planIntent,
  sendAll,
  stripNames,
} from '../../src/mcu/index.js'
import type { FaderCalibration, Plan, SurfaceState } from '../../src/mcu/index.js'
import { hex } from './hex.js'

const stateFrom = (messages: readonly string[]): SurfaceState =>
  messages.map(hex).reduce(applyMidi, initialSurfaceState)

const sentBytes = (plan: Plan): readonly (readonly number[])[] =>
  plan.flatMap((step) => (step.kind === 'send' ? [step.message] : []))

const calibration = (): FaderCalibration => {
  const result = faderCalibration([
    { position: 0, db: -Infinity },
    { position: 8192, db: -10 },
    { position: 12288, db: 0 },
  ])
  if (!result.ok) throw new Error(result.error.kind)
  return result.value
}

describe('planIntent faders', () => {
  it('plans a fader position as touch, pitch bend and release', () => {
    const plan = planIntent(
      { kind: 'set-fader-position', fader: 2, position: 0x2000 },
      initialSurfaceState,
    )
    expect(plan.ok && sentBytes(plan.value)).toEqual([
      hex('90 6A 7F'),
      hex('E2 00 40'),
      hex('90 6A 00'),
    ])
  })

  it('plans the master fader on channel 8', () => {
    const plan = planIntent(
      { kind: 'set-fader-position', fader: 8, position: 0x3fff },
      initialSurfaceState,
    )
    expect(plan.ok && sentBytes(plan.value)).toEqual([
      hex('90 70 7F'),
      hex('E8 7F 7F'),
      hex('90 70 00'),
    ])
  })

  it('refuses invalid faders and positions instead of clamping', () => {
    expect(
      planIntent({ kind: 'set-fader-position', fader: 9, position: 0 }, initialSurfaceState),
    ).toEqual({
      ok: false,
      error: { kind: 'invalid-strip', strip: 9 },
    })
    expect(
      planIntent({ kind: 'set-fader-position', fader: 0, position: 20000 }, initialSurfaceState),
    ).toEqual({ ok: false, error: { kind: 'invalid-position', position: 20000 } })
  })

  it('refuses a dB target without a measured calibration', () => {
    expect(planIntent({ kind: 'set-fader-db', fader: 0, db: -6 }, initialSurfaceState)).toEqual({
      ok: false,
      error: { kind: 'uncalibrated' },
    })
  })

  it('maps a dB target through the calibration', () => {
    const plan = planIntent({ kind: 'set-fader-db', fader: 1, db: 0 }, initialSurfaceState, {
      calibration: calibration(),
    })
    expect(plan.ok && sentBytes(plan.value)[1]).toEqual(hex('E1 00 60'))
  })

  it('refuses a dB target outside the calibration', () => {
    const plan = planIntent({ kind: 'set-fader-db', fader: 1, db: 6 }, initialSurfaceState, {
      calibration: calibration(),
    })
    expect(plan.ok || plan.error.kind).toBe('db-out-of-range')
  })
})

describe('planIntent mute and solo', () => {
  it('presses MUTE once when the LED shows the opposite state', () => {
    const plan = planIntent({ kind: 'set-mute', strip: 0, on: true }, stateFrom(['90 10 00']))
    expect(plan.ok && sentBytes(plan.value)).toEqual([hex('90 10 7F'), hex('90 10 00')])
  })

  it('sends nothing when the strip is already in the requested state', () => {
    expect(planIntent({ kind: 'set-solo', strip: 7, on: true }, stateFrom(['90 0F 7F']))).toEqual({
      ok: true,
      value: [],
    })
  })

  it('refuses to toggle when the LED state is unknown or flashing', () => {
    expect(planIntent({ kind: 'set-mute', strip: 3, on: false }, initialSurfaceState)).toEqual({
      ok: false,
      error: { kind: 'state-unknown', strip: 3, control: 'mute' },
    })
    expect(planIntent({ kind: 'set-solo', strip: 0, on: false }, stateFrom(['90 08 01'])).ok).toBe(
      false,
    )
  })

  it('refuses strips outside the bank', () => {
    expect(planIntent({ kind: 'set-mute', strip: 8, on: true }, initialSurfaceState)).toEqual({
      ok: false,
      error: { kind: 'invalid-strip', strip: 8 },
    })
  })
})

describe('planIntent strip names', () => {
  it('plans a read with no outgoing messages', () => {
    expect(planIntent({ kind: 'read-strip-names' }, initialSurfaceState)).toEqual({
      ok: true,
      value: [{ kind: 'read', target: 'strip-names' }],
    })
  })
})

describe('dangerous controls', () => {
  it.each([
    ['SAVE', BUTTON.save],
    ['V-Pot press', BUTTON.vSelect],
    ['V-Pot press strip 8', BUTTON.vSelect + 7],
    ['EQ view', BUTTON.assignEq],
    ['Plug-in view', BUTTON.assignPlugin],
    ['Instrument view', BUTTON.assignInstrument],
    ['SHIFT', BUTTON.shift],
    ['OPTION', BUTTON.option],
    ['automation Write', BUTTON.automationWrite],
    ['ENTER', BUTTON.enter],
    ['CANCEL', BUTTON.cancel],
    ['UNDO', BUTTON.undo],
  ])('refuses %s by default', (_, button) => {
    const plan = planIntent({ kind: 'press-button', button }, initialSurfaceState)
    expect(plan).toEqual({
      ok: false,
      error: { kind: 'refused', button, reason: DANGEROUS_BUTTONS.get(button) },
    })
  })

  it('refuses buttons that are neither dangerous nor allowed', () => {
    expect(planIntent({ kind: 'press-button', button: BUTTON.play }, initialSurfaceState)).toEqual({
      ok: false,
      error: { kind: 'refused', button: BUTTON.play, reason: 'not in the allowlist' },
    })
  })

  it('never allows a dangerous button in the default allowlist', () => {
    const overlap = [...DANGEROUS_BUTTONS.keys()].filter((id) => DEFAULT_ALLOWLIST.buttons.has(id))
    expect(overlap).toEqual([])
  })

  it('allows bank navigation by default', () => {
    const plan = planIntent({ kind: 'press-button', button: BUTTON.bankRight }, initialSurfaceState)
    expect(plan.ok && sentBytes(plan.value)).toEqual([hex('90 2F 7F'), hex('90 2F 00')])
  })

  it('permits a button only when the caller explicitly allows it', () => {
    const allowlist = { ...DEFAULT_ALLOWLIST, buttons: new Set([BUTTON.play]) }
    expect(
      planIntent({ kind: 'press-button', button: BUTTON.play }, initialSurfaceState, { allowlist })
        .ok,
    ).toBe(true)
    expect(
      planIntent({ kind: 'set-mute', strip: 0, on: true }, stateFrom(['90 10 00']), { allowlist }),
    ).toEqual({
      ok: false,
      error: { kind: 'refused', button: BUTTON.mute, reason: 'not in the allowlist' },
    })
  })

  it('refuses fader writes when faders are not allowed', () => {
    const allowlist = { ...DEFAULT_ALLOWLIST, faders: false }
    const plan = planIntent(
      { kind: 'set-fader-position', fader: 0, position: 0 },
      initialSurfaceState,
      {
        allowlist,
      },
    )
    expect(plan).toEqual({
      ok: false,
      error: { kind: 'message-not-allowed', message: hex('E0 00 00') },
    })
  })

  it('refuses V-Pot turns, sysex and note-off messages', () => {
    expect(checkMessage(DEFAULT_ALLOWLIST, hex('B0 10 01')).ok).toBe(false)
    expect(checkMessage(DEFAULT_ALLOWLIST, hex('F0 00 00 66 14 0F 7F F7')).ok).toBe(false)
    expect(checkMessage(DEFAULT_ALLOWLIST, hex('80 10 00')).ok).toBe(false)
  })
})

describe('planner with the in-memory port', () => {
  it('reads names from feedback and sends a planned mute', () => {
    const fake = memoryMidiPort()
    const received: (readonly number[])[] = []
    fake.port.subscribe((message) => received.push(message))
    fake.receive(hex('F0 00 00 66 14 12 00 4B 69 63 6B F7'))
    fake.receive(hex('90 10 00'))
    const state = received.reduce(applyMidi, initialSurfaceState)
    expect(stripNames(state).ok && stripNames(state)).toEqual({
      ok: true,
      value: ['Kick', '', '', '', '', '', '', ''],
    })
    const plan = planIntent({ kind: 'set-mute', strip: 0, on: true }, state)
    if (!plan.ok) throw new Error(plan.error.kind)
    expect(sendAll(fake.port, sentBytes(plan.value))).toEqual({ ok: true, value: 2 })
    expect(fake.sent()).toEqual([hex('90 10 7F'), hex('90 10 00')])
  })
})
