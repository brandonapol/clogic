import {
  applyMidi,
  faderCalibration,
  initialSurfaceState,
  memoryMidiPort,
  type FaderCalibration,
  type MemoryMidiPort,
  type MidiMessage,
  type SurfaceState,
} from '../../../src/mcu/index.js'
import type { MixerDeps } from '../../../src/tools/mixer/index.js'

export const hex = (text: string): readonly number[] =>
  text
    .trim()
    .split(/[\s,]+/)
    .map((pair) => parseInt(pair, 16))

export const lcdNames = (names: readonly string[]): MidiMessage => [
  0xf0,
  0x00,
  0x00,
  0x66,
  0x14,
  0x12,
  0x00,
  ...[...names.map((name) => name.slice(0, 6).padEnd(7)).join('')].map((char) =>
    char.charCodeAt(0),
  ),
  0xf7,
]

export const calibration = (): FaderCalibration => {
  const result = faderCalibration([
    { position: 0, db: -Infinity },
    { position: 8192, db: -10 },
    { position: 12288, db: 0 },
    { position: 16383, db: 6 },
  ])
  if (!result.ok) throw new Error(result.error.kind)
  return result.value
}

export type Harness = {
  readonly fake: MemoryMidiPort
  readonly deps: MixerDeps
}

export const harness = (
  messages: readonly MidiMessage[],
  options: { readonly calibrated?: boolean } = {},
): Harness => {
  const fake = memoryMidiPort()
  let state: SurfaceState = initialSurfaceState
  fake.port.subscribe((message) => {
    state = applyMidi(state, message)
  })
  messages.forEach(fake.receive)
  const measured = options.calibrated === false ? undefined : calibration()
  return {
    fake,
    deps: { port: fake.port, state: () => state, calibration: () => measured },
  }
}

export const mixerSession = (): readonly MidiMessage[] => [
  lcdNames(['Kick', 'Snare', 'LeadVocals', 'Bass', 'Pad', 'pad', '', '']),
  hex('E0 00 40'),
  hex('E1 00 60'),
  hex('90 10 00'),
  hex('90 11 7F'),
  hex('90 08 00'),
  hex('90 09 00'),
  hex('90 0B 01'),
]
