import { LCD_SIZE, MACKIE_ID } from './protocol.js'
import type {
  HostMessage,
  LedState,
  MeterLevel,
  MidiMessage,
  SegmentChar,
  VPotMode,
} from './protocol.js'

const VPOT_MODES: readonly VPotMode[] = ['dot', 'boost-cut', 'wrap', 'spread']

const ledState = (velocity: number): LedState =>
  velocity === 0x7f ? 'on' : velocity === 0x01 ? 'flash' : 'off'

export const decodeSegment = (byte: number): SegmentChar => {
  const code = byte & 0x3f
  return {
    char: String.fromCharCode(code < 0x20 ? code + 0x40 : code),
    dot: (byte & 0x40) !== 0,
  }
}

const decodeMeter = (byte: number): HostMessage => {
  const strip = (byte >> 4) & 0x07
  const value = byte & 0x0f
  const level: MeterLevel =
    value === 0x0e
      ? { kind: 'set-overload' }
      : value === 0x0f
        ? { kind: 'clear-overload' }
        : { kind: 'level', value: Math.min(value, 0x0c) }
  return { kind: 'meter', strip, level }
}

const isMackieSysEx = (bytes: MidiMessage): boolean =>
  bytes.length >= 7 &&
  bytes[0] === 0xf0 &&
  bytes[1] === MACKIE_ID[0] &&
  bytes[2] === MACKIE_ID[1] &&
  bytes[3] === MACKIE_ID[2] &&
  bytes[bytes.length - 1] === 0xf7

const decodeSysEx = (bytes: MidiMessage): HostMessage => {
  if (!isMackieSysEx(bytes)) return { kind: 'unknown', bytes }
  const model = bytes[4] ?? 0
  const command = bytes[5]
  const body = bytes.slice(6, -1)
  switch (command) {
    case 0x00:
      return { kind: 'device-query', model }
    case 0x02:
      return body.length === 11
        ? {
            kind: 'host-connection-reply',
            model,
            serial: body.slice(0, 7),
            response: body.slice(7),
          }
        : { kind: 'unknown', bytes }
    case 0x0f:
      return body[0] === 0x7f ? { kind: 'go-offline', model } : { kind: 'unknown', bytes }
    case 0x10:
      return { kind: 'timecode', model, digits: body.map(decodeSegment) }
    case 0x11:
      return { kind: 'assignment', model, digits: body.map(decodeSegment) }
    case 0x12: {
      const [offset, ...chars] = body
      return offset === undefined || offset >= LCD_SIZE
        ? { kind: 'unknown', bytes }
        : { kind: 'lcd', model, offset, text: String.fromCharCode(...chars) }
    }
    case 0x13:
      return { kind: 'version-request', model }
    default:
      return { kind: 'unknown', bytes }
  }
}

export const decodeMessage = (bytes: MidiMessage): HostMessage => {
  const [status, data1, data2] = bytes
  if (status === undefined) return { kind: 'unknown', bytes }
  if (status === 0xf0) return decodeSysEx(bytes)
  const type = status & 0xf0
  const channel = status & 0x0f
  if (type === 0xe0 && data1 !== undefined && data2 !== undefined) {
    return { kind: 'fader', fader: channel, value: (data2 << 7) | data1 }
  }
  if ((type === 0x90 || type === 0x80) && data1 !== undefined && data2 !== undefined) {
    return { kind: 'led', id: data1, state: type === 0x80 ? 'off' : ledState(data2) }
  }
  if (type === 0xb0 && data1 !== undefined && data2 !== undefined) {
    if (data1 >= 0x30 && data1 <= 0x37) {
      return {
        kind: 'vpot-ring',
        strip: data1 - 0x30,
        center: (data2 & 0x40) !== 0,
        mode: VPOT_MODES[(data2 >> 4) & 0x03] ?? 'dot',
        position: data2 & 0x0f,
      }
    }
    if (data1 >= 0x40 && data1 <= 0x4b) {
      return { kind: 'segment', digit: data1 - 0x40, char: decodeSegment(data2) }
    }
  }
  if (type === 0xd0 && data1 !== undefined) return decodeMeter(data1)
  return { kind: 'unknown', bytes }
}

const dataLength = (status: number): number => {
  const type = status & 0xf0
  return type === 0xc0 || type === 0xd0 ? 1 : 2
}

type SplitState = {
  readonly messages: readonly MidiMessage[]
  readonly current: MidiMessage
  readonly running: number | undefined
}

const step = (state: SplitState, byte: number): SplitState => {
  const { messages, current, running } = state
  if (byte >= 0xf8) return state
  if (current[0] === 0xf0) {
    if (byte === 0xf7) return { messages: [...messages, [...current, byte]], current: [], running }
    if (byte >= 0x80) return { messages, current: byte === 0xf0 ? [byte] : [], running }
    return { messages, current: [...current, byte], running }
  }
  if (byte === 0xf0) return { messages, current: [byte], running: undefined }
  if (byte >= 0x80) return { messages, current: [byte], running: byte < 0xf0 ? byte : undefined }
  const base = current.length === 0 && running !== undefined ? [running] : current
  const [status] = base
  if (status === undefined) return state
  const next = [...base, byte]
  return next.length === dataLength(status) + 1
    ? { messages: [...messages, next], current: [], running }
    : { messages, current: next, running }
}

export const splitMessages = (bytes: readonly number[]): readonly MidiMessage[] =>
  bytes.reduce(step, { messages: [], current: [], running: undefined }).messages
