import { describe, expect, it } from 'vitest'
import {
  budgetEnvVars,
  budgetFromEnv,
  companionSettings,
  defaultBudgetLimits,
} from '../../src/companion/config.js'
import { ok } from '../../src/llm/result.js'
import { companionTools, readTools } from '../../src/companion/tools.js'
import { buildSystemPrompt, promptTools } from '../../src/prompts/system.js'
import { harness, mixerSession } from '../tools/mixer/fixtures.js'
import { toolDeps } from './fixtures.js'

const names = (tools: readonly { readonly definition: { readonly name: string } }[]) =>
  tools.map((tool) => tool.definition.name)

describe('companionTools', () => {
  it('registers the analysis, stems and docs tools without mixer tools by default', () => {
    expect(names(companionTools(toolDeps))).toEqual([
      'get_loudness',
      'analyse_mix',
      'analyse_stems',
      'compare_reference',
      'list_audio_files',
      'search_logic_docs',
    ])
  })

  it('adds the mixer tools when a MIDI-backed mixer is injected', () => {
    const tools = companionTools({ ...toolDeps, mixer: harness(mixerSession()).deps })

    expect(names(tools).slice(-4)).toEqual([
      'list_tracks',
      'set_track_volume',
      'set_track_mute',
      'set_track_solo',
    ])
    expect(names(tools).slice(0, -4)).toEqual(names(readTools(toolDeps)))
  })
})

describe('companionSettings system prompt', () => {
  it('is built from the registered tools for the given provider', () => {
    const tools = readTools(toolDeps)
    const settings = companionSettings(tools)

    expect(settings.system('openai')).toBe(
      buildSystemPrompt({ provider: 'openai', tools: promptTools(tools) }),
    )
    expect(settings.system('openai')).toContain('an OpenAI model')
    expect(settings.system('xai')).toContain('an xAI Grok model')
  })

  it('lists the stems tools and offers no session changes without a mixer', () => {
    const system = companionSettings(companionTools(toolDeps)).system('anthropic')

    expect(system).toContain(
      'Tools available in this conversation: analyse_mix, analyse_stems, compare_reference, get_loudness, list_audio_files, search_logic_docs. No other tools exist.',
    )
    expect(system).toContain(
      'To measure audio, call analyse_mix, analyse_stems, compare_reference, get_loudness, list_audio_files.',
    )
    expect(system).toContain('You cannot change the session.')
    expect(system).not.toContain('set_track_volume')
    expect(system).not.toContain('list_tracks')
  })

  it('names the mixer change tools when a mixer is injected', () => {
    const tools = companionTools({ ...toolDeps, mixer: harness(mixerSession()).deps })
    const system = companionSettings(tools).system('anthropic')

    expect(system).toContain('list_tracks')
    expect(system).toContain(
      'Change the session only through set_track_mute, set_track_solo, set_track_volume.',
    )
    expect(system).not.toContain('You cannot change the session.')
  })

  it('still lets callers override the prompt', () => {
    const settings = companionSettings(readTools(toolDeps), { system: () => 'fixed' })

    expect(settings.system('anthropic')).toBe('fixed')
  })
})

describe('budget settings', () => {
  it('defaults to a $5 session and $50 monthly budget warning at 80%', () => {
    expect(companionSettings([]).budget).toEqual({
      sessionUsd: 5,
      monthlyUsd: 50,
      warnFraction: 0.8,
    })
    expect(defaultBudgetLimits).toEqual(companionSettings([]).budget)
  })

  it('reads limits from the environment', () => {
    expect(
      budgetFromEnv({
        [budgetEnvVars.sessionUsd]: ' 2.5 ',
        [budgetEnvVars.monthlyUsd]: 'off',
      }),
    ).toEqual(ok({ sessionUsd: 2.5, monthlyUsd: null, warnFraction: 0.8 }))
  })

  it('keeps the defaults when nothing is set', () => {
    expect(budgetFromEnv({})).toEqual(ok(defaultBudgetLimits))
  })

  it.each(['0', '-1', 'ten', 'Infinity'])('rejects %s as a limit', (value) => {
    const parsed = budgetFromEnv({ [budgetEnvVars.monthlyUsd]: value })
    expect(parsed.ok).toBe(false)
  })
})
