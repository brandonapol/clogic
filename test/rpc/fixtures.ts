import type {
  CompanionNotificationSpec,
  ParamsOf,
  PluginNotificationSpec,
  RequestMethod,
  ResultOf,
} from '../../src/rpc/messages.js'

export const instanceId = '4b8f6c1e-2a0d-4c51-9d1b-7f3a2e9c0b11'

export const sampleParams: { readonly [M in RequestMethod]: ParamsOf<M> } = {
  'session.hello': {
    instanceId,
    contextName: 'Vox',
    sampleRate: 48000,
    protocolVersion: 1,
    client: 'clogic.appex 0.1.0',
  },
  'chat.send': { instanceId, text: 'How loud is my mix?' },
  'chat.cancel': { instanceId, turnId: 'turn-1' },
  'change.decide': { instanceId, proposalId: 'p-1', acceptedRowIds: ['r-1'] },
  'keys.set': { provider: 'anthropic', key: 'sk-ant-test' },
  'keys.status': {},
  'provider.select': { provider: 'openai' },
}

export const sampleResults: { readonly [M in RequestMethod]: ResultOf<M> } = {
  'session.hello': { protocolVersion: 1, companion: 'clogic-companion 0.1.0' },
  'chat.send': { turnId: 'turn-1' },
  'chat.cancel': { cancelled: true },
  'change.decide': { proposalId: 'p-1', outcome: 'applying' },
  'keys.set': { provider: 'anthropic', configured: true },
  'keys.status': {
    providers: [
      { provider: 'anthropic', configured: true },
      { provider: 'openai', configured: false },
    ],
    activeProvider: 'anthropic',
  },
  'provider.select': { activeProvider: 'openai' },
}

export const samplePluginNotifications: {
  readonly [M in keyof PluginNotificationSpec]: PluginNotificationSpec[M]
} = {
  meter: { instanceId, momentaryLufs: -14.2, bands: [-20, -18.5, -30] },
  'context.changed': { instanceId, contextName: 'Lead Vox' },
}

export const sampleCompanionNotifications: {
  readonly [M in keyof CompanionNotificationSpec]: CompanionNotificationSpec[M]
} = {
  'chat.message': {
    instanceId,
    turnId: 'turn-1',
    messageId: 'm-1',
    text: 'Your mix is at -9 LUFS.',
  },
  'chat.delta': { instanceId, turnId: 'turn-1', messageId: 'm-1', index: 0, text: 'Your ' },
  'chat.done': { instanceId, turnId: 'turn-1', stopReason: 'end_turn' },
  'tool.started': {
    instanceId,
    turnId: 'turn-1',
    callId: 'c-1',
    name: 'get_loudness',
    kind: 'read',
    input: { path: '/tmp/mix.wav' },
  },
  'tool.finished': {
    instanceId,
    turnId: 'turn-1',
    callId: 'c-1',
    name: 'get_loudness',
    status: 'ok',
    summary: '-9.1 LUFS integrated',
  },
  'change.proposed': {
    instanceId,
    proposalId: 'p-1',
    reason: 'Vocal is masked by the guitars',
    rows: [
      { id: 'r-1', control: 'fader', location: 'Vox', before: -3, after: -6 },
      { id: 'r-2', control: 'pan', location: 'Gtr', before: 'unknown', after: { pan: -20 } },
    ],
    expiresAt: '2026-10-02T12:05:00.000Z',
  },
  'change.applied': {
    instanceId,
    proposalId: 'p-1',
    applied: ['r-1'],
    declined: ['r-2'],
    failed: [],
  },
  'analysis.result': {
    instanceId,
    turnId: 'turn-1',
    callId: 'c-1',
    analysis: 'loudness',
    summary: '-9.1 LUFS integrated, -0.3 dBTP',
    data: { integratedLufs: -9.1, truePeakDbtp: -0.3, bands: [1, 2, 3], notes: null },
  },
  usage: { instanceId, turnId: 'turn-1', inputTokens: 1200, outputTokens: 340 },
  error: { instanceId: null, turnId: null, code: 'provider_unavailable', message: 'No API key' },
}
