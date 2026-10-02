import type { MidiMessage } from './protocol.js'
import { err, ok } from './result.js'
import type { Result } from './result.js'

export type PortError =
  { readonly kind: 'port-closed' } | { readonly kind: 'send-failed'; readonly message: string }

export type MidiListener = (message: MidiMessage) => void

export type Unsubscribe = () => void

export type MidiPort = {
  readonly send: (message: MidiMessage) => Result<void, PortError>
  readonly subscribe: (listener: MidiListener) => Unsubscribe
}

export const sendAll = (
  port: MidiPort,
  messages: readonly MidiMessage[],
): Result<number, PortError & { readonly sent: number }> => {
  const outcome = messages.reduce<{ readonly sent: number; readonly error: PortError | undefined }>(
    (state, message) => {
      if (state.error !== undefined) return state
      const result = port.send(message)
      return result.ok
        ? { sent: state.sent + 1, error: undefined }
        : { ...state, error: result.error }
    },
    { sent: 0, error: undefined },
  )
  return outcome.error === undefined
    ? ok(outcome.sent)
    : err({ ...outcome.error, sent: outcome.sent })
}

export type MemoryMidiPort = {
  readonly port: MidiPort
  readonly sent: () => readonly MidiMessage[]
  readonly receive: (message: MidiMessage) => void
  readonly close: () => void
}

export const memoryMidiPort = (): MemoryMidiPort => {
  const sent: MidiMessage[] = []
  const listeners = new Set<MidiListener>()
  let open = true
  return {
    port: {
      send: (message) => {
        if (!open) return err({ kind: 'port-closed' })
        sent.push([...message])
        return ok(undefined)
      },
      subscribe: (listener) => {
        const wrapped: MidiListener = (message) => listener(message)
        listeners.add(wrapped)
        return () => {
          listeners.delete(wrapped)
        }
      },
    },
    sent: () => [...sent],
    receive: (message) => {
      if (!open) return
      ;[...listeners].forEach((listener) => listener([...message]))
    },
    close: () => {
      open = false
      listeners.clear()
    },
  }
}
