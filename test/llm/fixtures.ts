import type { FetchLike } from '../../src/llm/client.js'
import { getLoudnessTool } from '../../src/llm/example-tools.js'
import type { ChatRequest, ProviderId } from '../../src/llm/types.js'

export const fakeKeys: Readonly<Record<ProviderId, string>> = {
  anthropic: 'sk-ant-api03-FAKEFAKEFAKEFAKEFAKE',
  openai: 'sk-proj-FAKEFAKEFAKEFAKEFAKE',
  xai: 'xai-FAKEFAKEFAKEFAKEFAKE',
}

export const loudnessRequest = (model: string): ChatRequest => ({
  model,
  system: 'You are a mixing assistant.',
  messages: [{ role: 'user', text: 'How loud is /tmp/mix.wav?' }],
  tools: [getLoudnessTool],
  toolChoice: 'auto',
  maxOutputTokens: 1024,
})

export const anthropicToolUseResponse = {
  id: 'msg_01',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-5-5',
  stop_reason: 'tool_use',
  content: [
    { type: 'thinking', thinking: 'Need loudness.', signature: 'sig-abc' },
    { type: 'text', text: 'Measuring now.' },
    { type: 'tool_use', id: 'toolu_01', name: 'get_loudness', input: { path: '/tmp/mix.wav' } },
  ],
  usage: { input_tokens: 412, output_tokens: 57 },
}

export const anthropicFinalResponse = {
  id: 'msg_02',
  type: 'message',
  role: 'assistant',
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: 'The mix is -9.8 LUFS integrated.' }],
  usage: { input_tokens: 520, output_tokens: 20 },
}

export const responsesToolCallResponse = {
  id: 'resp_01',
  object: 'response',
  status: 'completed',
  output: [
    { type: 'reasoning', id: 'rs_01', summary: [], encrypted_content: 'enc-xyz' },
    {
      type: 'function_call',
      id: 'fc_01',
      call_id: 'call_01',
      name: 'get_loudness',
      arguments: '{"path":"/tmp/mix.wav"}',
      status: 'completed',
    },
  ],
  usage: { input_tokens: 300, output_tokens: 40, total_tokens: 340 },
}

export const responsesFinalResponse = {
  id: 'resp_02',
  object: 'response',
  status: 'completed',
  output: [
    {
      type: 'message',
      id: 'msg_01',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'The mix is -9.8 LUFS integrated.', annotations: [] }],
    },
  ],
  usage: { input_tokens: 380, output_tokens: 15, total_tokens: 395 },
}

export const toolCallFixture: Readonly<Record<ProviderId, unknown>> = {
  anthropic: anthropicToolUseResponse,
  openai: responsesToolCallResponse,
  xai: responsesToolCallResponse,
}

export const finalFixture: Readonly<Record<ProviderId, unknown>> = {
  anthropic: anthropicFinalResponse,
  openai: responsesFinalResponse,
  xai: responsesFinalResponse,
}

export type RecordedCall = {
  readonly url: string
  readonly method: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: unknown
}

export const scriptedFetch = (
  responses: readonly { readonly status: number; readonly body: string }[],
): { readonly fetch: FetchLike; readonly calls: readonly RecordedCall[] } => {
  const calls: RecordedCall[] = []
  const fetch: FetchLike = async (url, init) => {
    const response = responses[calls.length]
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      body: init.body === undefined ? undefined : (JSON.parse(init.body) as unknown),
    })
    if (response === undefined) throw new Error('Unexpected fetch call')
    return { status: response.status, text: async () => response.body }
  }
  return { fetch, calls }
}

export const jsonResponse = (body: unknown, status = 200) => ({
  status,
  body: JSON.stringify(body),
})
