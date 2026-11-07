import { appendFileSync, existsSync, renameSync, statSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { logDir } from './paths'

const MAX_FILE = 5 * 1024 * 1024
const MAX_FILES = 9
const secrets = new Set<string>()

export function registerSecret(s: string): void {
  if (s && s.length >= 6) secrets.add(s)
}

export function forgetSecret(s: string): void {
  secrets.delete(s)
}

export function mask(text: string): string {
  let out = text
  for (const s of secrets) out = out.split(s).join('***')
  return out
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '***')
    .replace(/(Bearer|token)\s+[A-Za-z0-9._-]{12,}/gi, '$1 ***')
    .replace(/(https?:\/\/)[^/@\s:]+:[^/@\s]+@/g, '$1***@')
    .replace(/(KOTKOD_ASKPASS_PASS=)\S+/g, '$1***')
}

function file(): string {
  return join(logDir, 'kot-kod.log')
}

function rotate(): void {
  const f = file()
  if (!existsSync(f) || statSync(f).size < MAX_FILE) return
  const last = `${f}.${MAX_FILES}`
  if (existsSync(last)) unlinkSync(last)
  for (let i = MAX_FILES - 1; i >= 1; i--) {
    if (existsSync(`${f}.${i}`)) renameSync(`${f}.${i}`, `${f}.${i + 1}`)
  }
  renameSync(f, `${f}.1`)
}

export function log(level: 'info' | 'warn' | 'error', msg: string): void {
  const line = `${new Date().toISOString()} [${level}] ${mask(msg)}\n`
  try {
    rotate()
    appendFileSync(file(), line)
  } catch {
    /* logging must never crash the app */
  }
  if (process.env.KOTKOD_DEBUG) process.stderr.write(line)
}

export function tail(maxBytes = 8000): string {
  try {
    const t = readFileSync(file(), 'utf8')
    return t.slice(-maxBytes)
  } catch {
    return ''
  }
}
