import type { Api, ApiError, ApiEvent } from '@shared/api'

export class ApiCallError extends Error {
  code: string
  details?: string
  constructor(e: ApiError) {
    super(e.message)
    this.code = e.code
    this.details = e.details
  }
}

function ns(name: string): unknown {
  return new Proxy(
    {},
    {
      get: (_t, method) => async (...args: unknown[]) => {
        const r = await window.kotkod.call(`${name}.${String(method)}`, args)
        if (!r.ok) throw new ApiCallError(r.error)
        return r.value
      }
    }
  )
}

export const api = {
  app: ns('app'),
  settings: ns('settings'),
  repos: ns('repos'),
  git: ns('git'),
  accounts: ns('accounts'),
  hosting: ns('hosting')
} as Api

export function onEvent(cb: (e: ApiEvent) => void): () => void {
  return window.kotkod.on(cb)
}
