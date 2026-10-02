export const MACKIE_ID = [0x00, 0x00, 0x66] as const

export const MODEL = {
  logicControl: 0x10,
  logicControlXt: 0x11,
  mackieControl: 0x14,
  mackieControlXt: 0x15,
} as const

export const LCD_WIDTH = 56
export const LCD_SIZE = LCD_WIDTH * 2
export const STRIP_COUNT = 8
export const MASTER_FADER = 8
export const FADER_MAX = 0x3fff

export const BUTTON = {
  recArm: 0x00,
  solo: 0x08,
  mute: 0x10,
  select: 0x18,
  vSelect: 0x20,
  assignTrack: 0x28,
  assignSend: 0x29,
  assignPan: 0x2a,
  assignPlugin: 0x2b,
  assignEq: 0x2c,
  assignInstrument: 0x2d,
  bankLeft: 0x2e,
  bankRight: 0x2f,
  channelLeft: 0x30,
  channelRight: 0x31,
  flip: 0x32,
  globalView: 0x33,
  nameValue: 0x34,
  smpteBeats: 0x35,
  shift: 0x46,
  option: 0x47,
  control: 0x48,
  cmdAlt: 0x49,
  save: 0x50,
  undo: 0x51,
  cancel: 0x52,
  enter: 0x53,
  stop: 0x5d,
  play: 0x5e,
  record: 0x5f,
  cursorUp: 0x60,
  cursorDown: 0x61,
  cursorLeft: 0x62,
  cursorRight: 0x63,
  faderTouch: 0x68,
} as const

export type LedState = 'off' | 'on' | 'flash'

export type VPotMode = 'dot' | 'boost-cut' | 'wrap' | 'spread'

export type HostMessage =
  | { readonly kind: 'device-query'; readonly model: number }
  | {
      readonly kind: 'host-connection-reply'
      readonly model: number
      readonly serial: readonly number[]
      readonly response: readonly number[]
    }
  | { readonly kind: 'go-offline'; readonly model: number }
  | { readonly kind: 'version-request'; readonly model: number }
  | { readonly kind: 'lcd'; readonly model: number; readonly offset: number; readonly text: string }
  | { readonly kind: 'timecode'; readonly model: number; readonly digits: readonly SegmentChar[] }
  | { readonly kind: 'assignment'; readonly model: number; readonly digits: readonly SegmentChar[] }
  | { readonly kind: 'fader'; readonly fader: number; readonly value: number }
  | { readonly kind: 'led'; readonly id: number; readonly state: LedState }
  | {
      readonly kind: 'vpot-ring'
      readonly strip: number
      readonly center: boolean
      readonly mode: VPotMode
      readonly position: number
    }
  | { readonly kind: 'segment'; readonly digit: number; readonly char: SegmentChar }
  | { readonly kind: 'meter'; readonly strip: number; readonly level: MeterLevel }
  | { readonly kind: 'unknown'; readonly bytes: readonly number[] }

export type SegmentChar = { readonly char: string; readonly dot: boolean }

export type MeterLevel =
  | { readonly kind: 'level'; readonly value: number }
  | { readonly kind: 'set-overload' }
  | { readonly kind: 'clear-overload' }

export const header = (model: number): readonly number[] => [0xf0, ...MACKIE_ID, model]

const withModel = (model: number, body: readonly number[]): readonly number[] => [
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
): readonly number[] => withModel(model, [0x01, ...toDataBytes(serial), ...toDataBytes(challenge)])

export const encodeHostConnectionConfirmation = (
  model: number,
  serial: readonly number[],
): readonly number[] => withModel(model, [0x03, ...toDataBytes(serial)])

export const encodeHostConnectionError = (
  model: number,
  serial: readonly number[],
): readonly number[] => withModel(model, [0x04, ...toDataBytes(serial)])

export const challengeResponse = (
  challenge: readonly [number, number, number, number],
): readonly [number, number, number, number] => {
  const [l1, l2, l3, l4] = challenge
  return [
    0x7f & (l1 + (l2 ^ 0xa) - l4),
    0x7f & ((l3 >> 4) ^ (l1 + l4)),
    0x7f & ((l4 - (l3 << 2)) ^ (l1 | l2)),
    0x7f & (l2 - l3 + (0xf0 ^ (l4 << 4))),
  ]
}

export const encodeFader = (fader: number, value: number): readonly number[] => {
  const position = Math.round(clamp(value, 0, FADER_MAX))
  return [0xe0 | clamp(fader, 0, MASTER_FADER), position & 0x7f, (position >> 7) & 0x7f]
}

export const encodeButton = (id: number, pressed: boolean): readonly number[] => [
  0x90,
  id & 0x7f,
  pressed ? 0x7f : 0x00,
]

export const encodeFaderMove = (fader: number, value: number): readonly (readonly number[])[] => [
  encodeButton(BUTTON.faderTouch + fader, true),
  encodeFader(fader, value),
  encodeButton(BUTTON.faderTouch + fader, false),
]

export const encodeVPotTurn = (strip: number, ticks: number): readonly number[] => {
  const magnitude = clamp(Math.abs(Math.trunc(ticks)), 0, 0x3f)
  return [0xb0, 0x10 + clamp(strip, 0, STRIP_COUNT - 1), (ticks < 0 ? 0x40 : 0x00) | magnitude]
}

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

const isMackieSysEx = (bytes: readonly number[]): boolean =>
  bytes.length >= 7 &&
  bytes[0] === 0xf0 &&
  bytes[1] === MACKIE_ID[0] &&
  bytes[2] === MACKIE_ID[1] &&
  bytes[3] === MACKIE_ID[2] &&
  bytes[bytes.length - 1] === 0xf7

const decodeSysEx = (bytes: readonly number[]): HostMessage => {
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

export const decodeMessage = (bytes: readonly number[]): HostMessage => {
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
  readonly messages: readonly (readonly number[])[]
  readonly current: readonly number[]
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

export const splitMessages = (bytes: readonly number[]): readonly (readonly number[])[] =>
  bytes.reduce(step, { messages: [], current: [], running: undefined }).messages

export type SurfaceState = {
  readonly lcd: string
  readonly faders: readonly number[]
  readonly leds: ReadonlyMap<number, LedState>
}

export const initialSurfaceState: SurfaceState = {
  lcd: ' '.repeat(LCD_SIZE),
  faders: Array.from({ length: MASTER_FADER + 1 }, () => 0),
  leds: new Map(),
}

export const applyLcd = (lcd: string, offset: number, text: string): string => {
  const clipped = text.slice(0, Math.max(0, LCD_SIZE - offset))
  return lcd.slice(0, offset) + clipped + lcd.slice(offset + clipped.length)
}

export const applyMessage = (state: SurfaceState, message: HostMessage): SurfaceState => {
  switch (message.kind) {
    case 'lcd':
      return { ...state, lcd: applyLcd(state.lcd, message.offset, message.text) }
    case 'fader':
      return {
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

export const lcdRows = (lcd: string): readonly [string, string] => [
  lcd.slice(0, LCD_WIDTH),
  lcd.slice(LCD_WIDTH, LCD_SIZE),
]

export const stripCells = (row: string): readonly string[] =>
  Array.from({ length: STRIP_COUNT }, (_, strip) => row.slice(strip * 7, strip * 7 + 7).trim())

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
