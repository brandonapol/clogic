import { BUTTON, FADER_MAX, MACKIE_ID, MASTER_FADER, STRIP_COUNT } from './protocol.js'
import type { MidiMessage } from './protocol.js'

export type Challenge = readonly [number, number, number, number]

export const header = (model: number): MidiMessage => [0xf0, ...MACKIE_ID, model]

const withModel = (model: number, body: readonly number[]): MidiMessage => [
  ...header(model),
  ...body,
  0xf7,
]

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const toDataBytes = (bytes: readonly number[]): readonly number[] =>
  bytes.map((byte) => byte & 0x7f)

export const encodeHostConnectionQuery = (
  model: number,
  serial: readonly number[],
  challenge: readonly number[],
): MidiMessage => withModel(model, [0x01, ...toDataBytes(serial), ...toDataBytes(challenge)])

export const encodeHostConnectionConfirmation = (
  model: number,
  serial: readonly number[],
): MidiMessage => withModel(model, [0x03, ...toDataBytes(serial)])

export const encodeHostConnectionError = (model: number, serial: readonly number[]): MidiMessage =>
  withModel(model, [0x04, ...toDataBytes(serial)])

export const challengeResponse = (challenge: Challenge): Challenge => {
  const [l1, l2, l3, l4] = challenge
  return [
    0x7f & (l1 + (l2 ^ 0xa) - l4),
    0x7f & ((l3 >> 4) ^ (l1 + l4)),
    0x7f & ((l4 - (l3 << 2)) ^ (l1 | l2)),
    0x7f & (l2 - l3 + (0xf0 ^ (l4 << 4))),
  ]
}

export const encodeFader = (fader: number, value: number): MidiMessage => {
  const position = Math.round(clamp(value, 0, FADER_MAX))
  return [0xe0 | clamp(fader, 0, MASTER_FADER), position & 0x7f, (position >> 7) & 0x7f]
}

export const encodeButton = (id: number, pressed: boolean): MidiMessage => [
  0x90,
  id & 0x7f,
  pressed ? 0x7f : 0x00,
]

export const encodeButtonPress = (id: number): readonly MidiMessage[] => [
  encodeButton(id, true),
  encodeButton(id, false),
]

export const encodeFaderMove = (fader: number, value: number): readonly MidiMessage[] => [
  encodeButton(BUTTON.faderTouch + fader, true),
  encodeFader(fader, value),
  encodeButton(BUTTON.faderTouch + fader, false),
]

export const encodeVPotTurn = (strip: number, ticks: number): MidiMessage => {
  const magnitude = clamp(Math.abs(Math.trunc(ticks)), 0, 0x3f)
  return [0xb0, 0x10 + clamp(strip, 0, STRIP_COUNT - 1), (ticks < 0 ? 0x40 : 0x00) | magnitude]
}
