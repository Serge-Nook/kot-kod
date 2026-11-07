import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import { join } from 'path'
import { configDir } from './paths'
import { AppError } from './errors'
import { log, registerSecret, forgetSecret } from './logger'

interface Store {
  backend: 'keyring' | 'password'
  salt?: string
  check?: string
  data: Record<string, string>
}

const file = (): string => join(configDir, 'secrets.json')
let store: Store | null = null
let key: Buffer | null = null
const plain = new Map<string, string>()

export function keyringAvailable(): boolean {
  if (process.env.KOTKOD_NO_KEYRING) return false
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    const backend = (safeStorage as unknown as { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend?.()
    return backend !== 'basic_text'
  } catch {
    return false
  }
}

function read(): Store {
  if (store) return store
  if (existsSync(file())) {
    try {
      store = JSON.parse(readFileSync(file(), 'utf8')) as Store
      return store
    } catch (e) {
      log('error', `secrets file unreadable: ${String(e)}`)
    }
  }
  store = { backend: keyringAvailable() ? 'keyring' : 'password', data: {} }
  return store
}

function write(): void {
  const tmp = file() + '.tmp'
  writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 })
  renameSync(tmp, file())
}

function aesEncrypt(k: Buffer, text: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', k, iv)
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64')
}

function aesDecrypt(k: Buffer, b64: string): string {
  const buf = Buffer.from(b64, 'base64')
  const d = createDecipheriv('aes-256-gcm', k, buf.subarray(0, 12))
  d.setAuthTag(buf.subarray(12, 28))
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8')
}

export function backendState(): 'keyring' | 'password' | 'locked' {
  const s = read()
  if (s.backend === 'keyring') return 'keyring'
  return key ? 'password' : 'locked'
}

/** Unlocks (or initialises) the password-protected store. */
export function unlock(password: string): boolean {
  const s = read()
  if (s.backend !== 'password') return true
  if (!s.salt) {
    s.salt = randomBytes(16).toString('hex')
    key = scryptSync(password, Buffer.from(s.salt, 'hex'), 32)
    s.check = aesEncrypt(key, 'kot-kod')
    write()
    return true
  }
  const k = scryptSync(password, Buffer.from(s.salt, 'hex'), 32)
  try {
    if (aesDecrypt(k, s.check ?? '') !== 'kot-kod') return false
  } catch {
    return false
  }
  key = k
  return true
}

export function setSecret(id: string, value: string): void {
  const s = read()
  if (s.backend === 'keyring') s.data[id] = safeStorage.encryptString(value).toString('base64')
  else {
    if (!key) throw new AppError('SECRETS_LOCKED')
    s.data[id] = aesEncrypt(key, value)
  }
  plain.set(id, value)
  registerSecret(value)
  write()
}

export function getSecret(id: string): string | null {
  const cached = plain.get(id)
  if (cached) return cached
  const s = read()
  const enc = s.data[id]
  if (!enc) return null
  try {
    let v: string
    if (s.backend === 'keyring') v = safeStorage.decryptString(Buffer.from(enc, 'base64'))
    else {
      if (!key) throw new AppError('SECRETS_LOCKED')
      v = aesDecrypt(key, enc)
    }
    plain.set(id, v)
    registerSecret(v)
    return v
  } catch (e) {
    if (e instanceof AppError) throw e
    log('error', `cannot decrypt secret ${id}: ${String(e)}`)
    return null
  }
}

export function deleteSecret(id: string): void {
  const s = read()
  const v = plain.get(id)
  if (v) forgetSecret(v)
  plain.delete(id)
  delete s.data[id]
  write()
}

export function hasSecrets(): boolean {
  return Object.keys(read().data).length > 0
}
