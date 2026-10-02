import { runSearchLogicDocs, searchLogicDocsTool } from '../docs/tool.js'
import { err, ok } from '../llm/result.js'
import { analysisTools, type AnalysisDeps } from '../tools/analysis.js'
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

export const readTools = (deps: AnalysisDeps): readonly Tool[] => [
  ...analysisTools(deps),
  searchLogicDocs,
]
