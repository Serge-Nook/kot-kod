import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { configDir } from './paths'
import { AppError } from './errors'
import { providers } from './hosting/rest'
import type { IHostingProvider } from './hosting/provider'
import { deleteSecret, getSecret, setSecret } from './secrets'
import * as settings from './settings'
import { parseRemoteUrl, providerForHost } from '../shared/remote'
import type { Account, DeviceCodeInfo, ProviderId } from '../shared/types'
import type { Credentials } from './git/runner'

const file = (): string => join(configDir, 'accounts.json')
let cache: Account[] | null = null

export function list(): Account[] {
  if (cache) return cache
  try {
    cache = existsSync(file()) ? (JSON.parse(readFileSync(file(), 'utf8')) as Account[]) : []
  } catch {
    cache = []
  }
  return cache
}

function persist(next: Account[]): void {
  cache = next
  writeFileSync(file(), JSON.stringify(next, null, 2))
}

export function provider(id: ProviderId): IHostingProvider {
  return providers[id]
}

export function get(id: string): Account {
  const a = list().find((x) => x.id === id)
  if (!a) throw new AppError('ACCOUNT_NOT_FOUND', id)
  return a
}

export function token(id: string): string {
  const t = getSecret(id)
  if (!t) throw new AppError('TOKEN_MISSING', id)
  return t
}

export async function addToken(p: ProviderId, tok: string, method: 'token' | 'oauth' = 'token'): Promise<Account> {
  const clean = tok.trim()
  if (!clean) throw new AppError('TOKEN_EMPTY')
  const user = await provider(p).user(clean)
  const existing = list().find((a) => a.provider === p && a.login === user.login)
  const acc: Account = {
    id: existing?.id ?? randomUUID(),
    provider: p,
    login: user.login,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    authMethod: method,
    addedAt: existing?.addedAt ?? new Date().toISOString()
  }
  setSecret(acc.id, clean)
  persist([...list().filter((a) => a.id !== acc.id), acc])
  if (!settings.load().activeAccountId) settings.save({ activeAccountId: acc.id })
  return acc
}

export function remove(id: string): void {
  deleteSecret(id)
  persist(list().filter((a) => a.id !== id))
  const s = settings.load()
  if (s.activeAccountId === id) settings.save({ activeAccountId: list()[0]?.id })
}

function clientId(): string {
  const id = settings.load().githubClientId || process.env.KOTKOD_GITHUB_CLIENT_ID || ''
  if (!id) throw new AppError('OAUTH_NOT_CONFIGURED')
  return id
}

export async function startDeviceFlow(p: ProviderId): Promise<DeviceCodeInfo> {
  if (p !== 'github') throw new AppError('NOT_SUPPORTED')
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId(), scope: 'repo read:org notifications workflow delete_repo' })
  })
  const j = (await res.json()) as Record<string, string | number>
  if (!res.ok || j.error) throw new AppError('OAUTH_FAILED', String(j.error_description ?? j.error ?? res.status))
  return {
    deviceCode: String(j.device_code),
    userCode: String(j.user_code),
    verificationUri: String(j.verification_uri),
    expiresIn: Number(j.expires_in),
    interval: Number(j.interval) || 5
  }
}

export async function finishDeviceFlow(p: ProviderId, info: DeviceCodeInfo): Promise<Account> {
  const deadline = Date.now() + info.expiresIn * 1000
  let interval = info.interval
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval * 1000))
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId(),
        device_code: info.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })
    })
    const j = (await res.json()) as Record<string, string | number>
    if (j.access_token) return addToken(p, String(j.access_token), 'oauth')
    if (j.error === 'authorization_pending') continue
    if (j.error === 'slow_down') {
      interval += 5
      continue
    }
    throw new AppError('OAUTH_FAILED', String(j.error_description ?? j.error))
  }
  throw new AppError('OAUTH_EXPIRED')
}

export function accountForProvider(p: ProviderId, owner?: string): Account | null {
  const accs = list().filter((a) => a.provider === p)
  if (!accs.length) return null
  if (owner) {
    const byOwner = accs.find((a) => a.login.toLowerCase() === owner.toLowerCase())
    if (byOwner) return byOwner
  }
  const active = settings.load().activeAccountId
  return accs.find((a) => a.id === active) ?? accs[0]
}

export function authFor(url: string): Credentials | null {
  if (!/^https:\/\//i.test(url)) return null
  const parsed = parseRemoteUrl(url)
  if (!parsed) return null
  const p = providerForHost(parsed.host)
  if (!p) return null
  const acc = accountForProvider(p, parsed.owner)
  if (!acc) return null
  try {
    const t = getSecret(acc.id)
    return t ? { username: acc.login, password: t } : null
  } catch {
    return null
  }
}
