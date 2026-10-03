import { runSearchLogicDocs, searchLogicDocsTool } from '../docs/tool.js'
import { err, ok } from '../llm/result.js'
import { analysisTools, type AnalysisDeps } from '../tools/analysis.js'
import { mixerTools, type MixerDeps } from '../tools/mixer/index.js'
import { stemsTools, type StemsDeps } from '../tools/stems/index.js'
import type { ReadTool, Tool } from '../tools/types.js'

export const searchLogicDocs: ReadTool = {
  kind: 'read',
  surface: 'docs',
  definition: searchLogicDocsTool,
  run: async (input) => {
    const result = runSearchLogicDocs(input)
    if (result.ok) return ok(result.value)
    return err({
      kind: 'invalid_input',
      message:
        result.error.kind === 'invalid_query'
          ? 'query must be a string'
          : 'limit must be an integer from 1 to 10',
    })
  },
}

export type ReadToolDeps = {
  readonly analysis: AnalysisDeps
  readonly stems: StemsDeps
}

export type CompanionToolDeps = ReadToolDeps & {
  readonly mixer?: MixerDeps
}

export const readTools = (deps: ReadToolDeps): readonly Tool[] => [
  ...analysisTools(deps.analysis),
  ...stemsTools(deps.stems),
  searchLogicDocs,
]

export const companionTools = (deps: CompanionToolDeps): readonly Tool[] => [
  ...readTools(deps),
  ...(deps.mixer === undefined ? [] : mixerTools(deps.mixer)),
]
