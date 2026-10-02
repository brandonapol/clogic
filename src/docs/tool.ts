import type { JsonObject, ToolDefinition } from '../llm/types.js'
import { err, ok, type Result } from './result.js'
import { searchTopics } from './search.js'
import { guideVersion } from './topics.js'
import type { DocLink } from './types.js'

export const maxLimit = 10

export const searchLogicDocsTool: ToolDefinition = {
  name: 'search_logic_docs',
  description:
    'Finds pages in the official Apple Logic Pro User Guide that match a question, from a small ' +
    `hand-curated topic map (${guideVersion}). Returns links only: page title, URL, a one-line ` +
    'summary written by clogic, and a match score. It does not fetch or quote Apple pages. Use it ' +
    'to cite where a Logic Pro feature is documented, and tell the user your answer is unverified ' +
    'and that they should check the linked page. An empty result means no topic matched.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The question or feature name, for example "sidechain a compressor".',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: maxLimit,
        description: 'Maximum number of links to return. Defaults to 3.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
}

export type SearchLogicDocsError =
  { readonly kind: 'invalid_query' } | { readonly kind: 'invalid_limit' }

export type SearchLogicDocsOutput = {
  readonly guideVersion: string
  readonly links: readonly DocLink[]
}

export const runSearchLogicDocs = (
  input: JsonObject,
): Result<SearchLogicDocsOutput, SearchLogicDocsError> => {
  const { query, limit } = input
  if (typeof query !== 'string') return err({ kind: 'invalid_query' })
  if (limit === undefined) return ok({ guideVersion, links: searchTopics(query) })
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > maxLimit)
    return err({ kind: 'invalid_limit' })
  return ok({ guideVersion, links: searchTopics(query, limit) })
}
