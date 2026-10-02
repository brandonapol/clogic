import { text } from 'node:stream/consumers'
import {
  adapters,
  chat,
  describeError,
  getLoudnessTool,
  keychainKeyStore,
  providerIds,
  toAssistantMessage,
  validateKey,
  type ChatRequest,
  type ProviderId,
} from '../../dist/llm/index.js'

const store = keychainKeyStore()

const isProvider = (value: string | undefined): value is ProviderId =>
  providerIds.some((id) => id === value)

const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}

const fakeLoudness = (input: unknown) =>
  JSON.stringify({ input, integratedLufs: -9.8, loudnessRangeLu: 5.1, truePeakDbtp: -0.9 })

const save = async (provider: ProviderId) => {
  const pasted = await text(process.stdin)
  const validation = await validateKey(fetch, provider, pasted.trim())
  if (!validation.ok) fail(describeError(validation.error))
  const saved = await store.set(provider, pasted)
  if (!saved.ok) fail(saved.error.message)
  console.log(`${provider}: key valid and saved to the login keychain`)
}

const run = async (provider: ProviderId) => {
  const stored = await store.get(provider)
  if (!stored.ok) return fail(`${provider}: ${stored.error.message}`)
  const key = stored.value ?? fail(`${provider}: no key in keychain, run "save ${provider}" first`)
  const validation = await validateKey(fetch, provider, key)
  if (!validation.ok) return fail(describeError(validation.error))
  console.log(`${provider}: key valid, ${validation.value.length} models listed`)

  const model = process.env['MODEL'] ?? adapters[provider].defaultModel
  const first: ChatRequest = {
    model,
    system: 'You are a mixing assistant. Use tools to measure audio before answering.',
    messages: [{ role: 'user', text: 'How loud is /tmp/mix.wav? Use the get_loudness tool.' }],
    tools: [getLoudnessTool],
    toolChoice: 'auto',
    maxOutputTokens: 2048,
  }
  const turn1 = await chat(fetch, provider, key, first)
  if (!turn1.ok) return fail(describeError(turn1.error))
  console.log(
    `${provider} turn 1:`,
    turn1.value.stopReason,
    turn1.value.toolCalls,
    turn1.value.usage,
  )
  const results = turn1.value.toolCalls.map((call) => ({
    callId: call.id,
    content: fakeLoudness(call.input),
    isError: false,
  }))
  if (results.length === 0) return fail(`${provider}: model did not call get_loudness`)
  const turn2 = await chat(fetch, provider, key, {
    ...first,
    messages: [...first.messages, toAssistantMessage(turn1.value), { role: 'tool', results }],
  })
  if (!turn2.ok) return fail(describeError(turn2.error))
  console.log(`${provider} turn 2:`, turn2.value.stopReason, turn2.value.usage)
  console.log(turn2.value.text)
}

const [command, ...args] = process.argv.slice(2)
const providers = args.length === 0 ? providerIds : args.filter(isProvider)

if (command === 'save' && isProvider(args[0])) await save(args[0])
else if (command === 'remove' && isProvider(args[0])) console.log(await store.remove(args[0]))
else if (command === 'run') for (const provider of providers) await run(provider)
else fail('usage: e2e.ts save <provider> | run [provider...] | remove <provider>')
