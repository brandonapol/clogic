export type MidiMessage = readonly number[]

export const MACKIE_ID = [0x00, 0x00, 0x66] as const

export const MODEL = {
  logicControl: 0x10,
  logicControlXt: 0x11,
  mackieControl: 0x14,
  mackieControlXt: 0x15,
} as const

export const LCD_WIDTH = 56
export const LCD_SIZE = LCD_WIDTH * 2
export const LCD_CELL_WIDTH = 7
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
  automationWrite: 0x4b,
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

export type SegmentChar = { readonly char: string; readonly dot: boolean }

export type MeterLevel =
  | { readonly kind: 'level'; readonly value: number }
  | { readonly kind: 'set-overload' }
  | { readonly kind: 'clear-overload' }

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
  | { readonly kind: 'unknown'; readonly bytes: MidiMessage }
