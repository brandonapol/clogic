import { createInterface, type Interface } from 'node:readline'
import { emptySecret, typeSecret, type SecretInput } from './secret.js'
import type { Terminal } from './session.js'

export type NodeTerminal = Terminal & { readonly close: () => void }

const readHidden = (
  input: NodeJS.ReadStream,
  output: NodeJS.WriteStream,
  prompt: string,
): Promise<string | null> =>
  new Promise((resolve) => {
    output.write(prompt)
    const wasRaw = input.isRaw
    input.setRawMode(true)
    input.setEncoding('utf8')
    input.resume()
    let state: SecretInput = emptySecret
    const onData = (chunk: string) => {
      state = typeSecret(state, chunk)
      if (state.kind === 'typing') return
      input.off('data', onData)
      input.setRawMode(wasRaw)
      input.pause()
      output.write('\n')
      resolve(state.kind === 'submitted' ? state.value : null)
    }
    input.on('data', onData)
  })

const readFirstLine = (input: NodeJS.ReadStream): Promise<string | null> =>
  new Promise((resolve) => {
    const lines = createInterface({ input, terminal: false })
    let answer: string | null = null
    lines.once('line', (line) => {
      answer = line
      lines.close()
    })
    lines.once('close', () => resolve(answer))
  })

export const nodeTerminal = (
  input: NodeJS.ReadStream,
  output: NodeJS.WriteStream,
): NodeTerminal => {
  let lines: Interface | undefined
  let closed = false
  const buffered: string[] = []
  let pending: ((answer: string | null) => void) | undefined
  let interrupt: () => boolean = () => false

  const settle = (answer: string | null) => {
    const resolve = pending
    pending = undefined
    resolve?.(answer)
  }

  const open = (): Interface => {
    if (lines !== undefined) return lines
    const created = createInterface({ input, output, terminal: input.isTTY })
    created.on('line', (line) => (pending === undefined ? buffered.push(line) : settle(line)))
    created.on('close', () => {
      closed = true
      settle(null)
    })
    created.on('SIGINT', () => {
      if (!interrupt()) created.close()
    })
    lines = created
    return created
  }

  return {
    write: (text) => {
      if (text.length > 0) output.write(text)
    },
    ask: (prompt) => {
      const rl = open()
      const next = buffered.shift()
      if (next !== undefined) {
        output.write(`${prompt}${next}\n`)
        return Promise.resolve(next)
      }
      if (closed) return Promise.resolve(null)
      return new Promise((resolve) => {
        pending = resolve
        rl.setPrompt(prompt)
        rl.prompt()
      })
    },
    askSecret: (prompt) => (input.isTTY ? readHidden(input, output, prompt) : readFirstLine(input)),
    onInterrupt: (listener) => {
      interrupt = listener
    },
    close: () => lines?.close(),
  }
}
