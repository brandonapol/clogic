import { isRecord, stringField } from './json.js'
import { err, ok, type Result } from './result.js'

export const parseModelIds = (body: unknown): Result<readonly string[], string> => {
  if (!isRecord(body) || !Array.isArray(body['data'])) return err('Model list has no data array')
  return ok(
    body['data'].filter(isRecord).flatMap((model) => {
      const id = stringField(model, 'id')
      return id === undefined ? [] : [id]
    }),
  )
}
