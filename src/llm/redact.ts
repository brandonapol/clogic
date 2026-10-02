export const redactedMarker = '[REDACTED]'

const keyLikePattern = /\b(?:sk-ant-|sk-proj-|sk-|xai-)[A-Za-z0-9_-]{8,}/g

export const redactSecrets = (text: string, secrets: readonly string[]): string => {
  const withKnownSecrets = secrets
    .filter((secret) => secret.length > 0)
    .reduce((acc, secret) => acc.split(secret).join(redactedMarker), text)
  return withKnownSecrets.replace(keyLikePattern, redactedMarker)
}

const sensitiveHeaders: ReadonlySet<string> = new Set(['authorization', 'x-api-key'])

export const redactHeaders = (
  headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      sensitiveHeaders.has(name.toLowerCase()) ? redactedMarker : value,
    ]),
  )
