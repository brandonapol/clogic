#!/usr/bin/env node
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chat } from '../llm/client.js'
import { keychainKeyStore } from '../llm/keychain.js'
import { createLogger } from '../log/logger.js'
import { createFileSink, createStderrSink } from '../log/sinks.js'
import type { Sink } from '../log/types.js'
import { defaultAnalysisDeps } from '../tools/analysis.js'
import { defaultStemsDeps } from '../tools/stems/index.js'
import { budgetFromEnv, defaultBudgetLimits } from './config.js'
import { secretCache, trackingKeyStore } from './secrets.js'
import { startCompanion } from './service.js'
import { companionTools } from './tools.js'

const secrets = secretCache()
const stderrSink = createStderrSink()

const fileSinks = (): readonly Sink[] => {
  if (process.platform !== 'darwin') return []
  const sink = createFileSink({
    dir: join(homedir(), 'Library', 'Logs', 'clogic'),
    onError: (message) => void process.stderr.write(`clogic log file error: ${message}\n`),
  })
  return sink.ok ? [sink.value] : []
}

const logger = createLogger({
  now: Date.now,
  sinks: [stderrSink, ...fileSinks()],
  secrets: secrets.list,
})
const log = logger.child({ component: 'main' })

const socketPath = process.argv[2] ?? process.env['CLOGIC_SOCKET']

if (socketPath === undefined || socketPath.length === 0) {
  log.error('companion.usage', {
    detail: 'Usage: clogic-companion <socket path> (or set CLOGIC_SOCKET)',
  })
  process.exit(2)
}

const budget = budgetFromEnv(process.env)
if (!budget.ok) log.warn('budget.invalid_setting', { detail: budget.error })

const companion = await startCompanion({
  socketPath,
  keyStore: trackingKeyStore(keychainKeyStore(), secrets),
  llmClient: (provider, apiKey) => (request) => chat(fetch, provider, apiKey, request),
  tools: companionTools({ analysis: defaultAnalysisDeps, stems: defaultStemsDeps }),
  settings: { budget: budget.ok ? budget.value : defaultBudgetLimits },
  logger: logger.child({ component: 'companion' }),
  secrets: secrets.list,
})

log.info('companion.listening', { socketPath: companion.path })

const shutdown = () => {
  log.info('companion.stopping')
  companion.close().then(
    () => process.exit(0),
    () => process.exit(1),
  )
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
