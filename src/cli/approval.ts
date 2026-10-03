import { err, ok, type Result } from '../llm/result.js'
import type { ChangeRow } from '../tools/types.js'

export const approvalPrompt = (rowCount: number): string =>
  rowCount > 1 ? 'Apply? [y]es / [n]o / row numbers (e.g. 1,3): ' : 'Apply? [y]es / [n]o: '

const yes: ReadonlySet<string> = new Set(['y', 'yes'])
const no: ReadonlySet<string> = new Set(['n', 'no'])

const unique = (values: readonly string[]): readonly string[] => [...new Set(values)]

export const parseApproval = (
  input: string,
  rows: readonly ChangeRow[],
): Result<readonly string[], string> => {
  const answer = input.trim().toLowerCase()
  if (yes.has(answer)) return ok(rows.map((row) => row.id))
  if (no.has(answer)) return ok([])
  const parts = answer.split(/[\s,]+/).filter((part) => part.length > 0)
  if (parts.length === 0 || parts.some((part) => !/^\d+$/.test(part)))
    return err('Answer y, n or a list of row numbers')
  const picked = parts.map((part) => rows[Number(part) - 1])
  if (picked.some((row) => row === undefined))
    return err(`Row numbers must be between 1 and ${rows.length}`)
  return ok(unique(picked.flatMap((row) => (row === undefined ? [] : [row.id]))))
}
