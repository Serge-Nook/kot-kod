import type { ProviderId } from './types'

export interface ParsedRemote {
  host: string
  owner: string
  repo: string
}

export function parseRemoteUrl(url: string): ParsedRemote | null {
  const trimmed = url.trim()
  let m = /^(?:ssh:\/\/)?[^@/\s]+@([^:/\s]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/.exec(trimmed)
  if (!m) m = /^(?:https?|git|ssh):\/\/(?:[^@/\s]+@)?([^:/\s]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(trimmed)
  if (!m) return null
  const host = m[1].toLowerCase()
  const parts = m[2].split('/').filter(Boolean)
  if (parts.length < 2) return null
  const repo = parts[parts.length - 1]
  const owner = parts.slice(0, -1).join('/')
  return { host, owner, repo }
}

export function providerForHost(host: string): ProviderId | null {
  const h = host.toLowerCase()
  if (h === 'github.com' || h === 'www.github.com') return 'github'
  if (h === 'gitverse.ru' || h.endsWith('.gitverse.ru')) return 'gitverse'
  return null
}

export function repoNameFromUrl(url: string): string {
  const parsed = parseRemoteUrl(url)
  if (parsed) return parsed.repo
  const base = url.replace(/\/+$/, '').split(/[/:]/).pop() ?? 'repo'
  return base.replace(/\.git$/, '') || 'repo'
}
