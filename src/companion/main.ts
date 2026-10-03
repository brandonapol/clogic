#!/usr/bin/env node
import { chat } from '../llm/client.js'
import { keychainKeyStore } from '../llm/keychain.js'
import { defaultAnalysisDeps } from '../tools/analysis.js'
import { startCompanion } from './service.js'
import { readTools } from './tools.js'

const socketPath = process.argv[2] ?? process.env['CLOGIC_SOCKET']

if (socketPath === undefined || socketPath.length === 0) {
  process.stderr.write('Usage: clogic-companion <socket path> (or set CLOGIC_SOCKET)\n')
  process.exit(2)
}

const companion = await startCompanion({
  socketPath,
  keyStore: keychainKeyStore(),
  llmClient: (provider, apiKey) => (request) => chat(fetch, provider, apiKey, request),
  tools: readTools(defaultAnalysisDeps),
})

process.stderr.write(`clogic companion listening on ${companion.path}\n`)

const shutdown = () => {
  companion.close().then(
    () => process.exit(0),
    () => process.exit(1),
  )
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
