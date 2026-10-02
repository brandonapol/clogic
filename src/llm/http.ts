export type HttpRequest = {
  readonly method: 'GET' | 'POST'
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body?: string
}

export type HttpResponse = {
  readonly status: number
  readonly bodyText: string
}
