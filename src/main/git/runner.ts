import { spawn } from 'child_process'
import { AppError } from '../errors'
import type { GitProgress } from '../../shared/types'

export interface Credentials {
  username: string
  password: string
}

export interface GitHooks {
  authFor: (url: string) => Credentials | null
  askpassPath: string | null
  trash: (absPath: string) => Promise<void>
  resourcesDir: string
  log: (msg: string) => void
  progress: (repo: string, p: GitProgress) => void
}

export const hooks: GitHooks = {
  authFor: () => null,
  askpassPath: null,
  trash: async () => undefined,
  resourcesDir: '',
  log: () => undefined,
  progress: () => undefined
}

export function configureGit(h: Partial<GitHooks>): void {
  Object.assign(hooks, h)
}

export function gitBinary(): string {
  return process.env.KOTKOD_GIT || 'git'
}

export interface RunOptions {
  cwd: string
  input?: string
  env?: Record<string, string>
  okCodes?: number[]
  auth?: Credentials | null
  progressOp?: string
  maxBuffer?: number
}

export interface RunResult {
  stdout: string
  stderr: string
  code: number
  truncated: boolean
}

const PROGRESS_RE = /^(?:remote: )?([A-Za-z][A-Za-z ]+):\s+(\d+)%/

export function classifyGitError(stderr: string): string {
  const s = stderr
  if (/not a git repository/i.test(s)) return 'NOT_A_REPO'
  if (/\[rejected\]|non-fast-forward|fetch first|failed to push some refs/i.test(s))
    return 'PUSH_REJECTED'
  if (
    /Authentication failed|could not read Username|could not read Password|Invalid username or password|Permission denied \(publickey|terminal prompts disabled|returned error: 40[13]|HTTP Basic: Access denied/i.test(
      s
    )
  )
    return 'AUTH_FAILED'
  if (
    /Could not resolve host|Failed to connect|Connection timed out|Network is unreachable|early EOF|RPC failed|Connection reset|Operation timed out|Temporary failure in name resolution|unable to access/i.test(
      s
    )
  )
    return 'NETWORK'
  if (/would be overwritten by (checkout|merge)|Please commit your changes or stash them/i.test(s))
    return 'DIRTY_WORKTREE'
  if (/CONFLICT|could not apply|Resolve all conflicts|fix conflicts/i.test(s)) return 'CONFLICT'
  if (/nothing to commit|no changes added to commit/i.test(s)) return 'NOTHING_TO_COMMIT'
  if (/has no upstream branch|no tracking information/i.test(s)) return 'NO_UPSTREAM'
  if (/not fully merged/i.test(s)) return 'BRANCH_NOT_MERGED'
  if (/already exists/i.test(s)) return 'ALREADY_EXISTS'
  if (/Please tell me who you are|unable to auto-detect email address/i.test(s))
    return 'IDENTITY_MISSING'
  if (/patch does not apply|corrupt patch/i.test(s)) return 'PATCH_FAILED'
  return 'GIT_FAILED'
}

export function run(args: string[], opts: RunOptions): Promise<RunResult> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    GIT_TERMINAL_PROMPT: '0',
    LANGUAGE: 'C',
    LC_MESSAGES: 'C',
    GIT_OPTIONAL_LOCKS: '0',
    ...(opts.env ?? {})
  }
  const pre = ['-c', 'core.quotepath=false', '-c', 'color.ui=false']
  if (opts.auth && hooks.askpassPath) {
    env.GIT_ASKPASS = hooks.askpassPath
    env.SSH_ASKPASS = hooks.askpassPath
    env.KOTKOD_ASKPASS_USER = opts.auth.username
    env.KOTKOD_ASKPASS_PASS = opts.auth.password
    pre.push('-c', 'credential.helper=')
  }
  const max = opts.maxBuffer ?? 64 * 1024 * 1024
  const full = [...pre, ...args]
  hooks.log(`git ${args.join(' ')} (cwd=${opts.cwd})`)
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(gitBinary(), full, { cwd: opts.cwd, env, windowsHide: true })
    } catch (e) {
      reject(new AppError('GIT_MISSING', String(e)))
      return
    }
    const out: Buffer[] = []
    let outLen = 0
    let truncated = false
    let err = ''
    child.stdout.on('data', (d: Buffer) => {
      if (outLen > max) {
        truncated = true
        return
      }
      out.push(d)
      outLen += d.length
    })
    let partial = ''
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString('utf8')
      if (err.length < 1024 * 1024) err += s
      if (opts.progressOp) {
        partial += s
        const pieces = partial.split(/[\r\n]/)
        partial = pieces.pop() ?? ''
        for (const line of pieces) {
          const t = line.trim()
          if (!t) continue
          const m = PROGRESS_RE.exec(t)
          hooks.progress(opts.cwd, {
            op: opts.progressOp,
            phase: m ? m[1].trim() : t,
            percent: m ? Number(m[2]) : null,
            line: t
          })
        }
      }
    })
    child.on('error', (e: NodeJS.ErrnoException) => {
      reject(new AppError(e.code === 'ENOENT' ? 'GIT_MISSING' : 'GIT_FAILED', e.message))
    })
    child.on('close', (code) => {
      const stdout = Buffer.concat(out).toString('utf8')
      const res = { stdout, stderr: err, code: code ?? -1, truncated }
      const ok = opts.okCodes ?? [0]
      if (ok.includes(res.code)) resolve(res)
      else {
        const msg = (err || stdout).trim()
        hooks.log(`git failed (${res.code}): ${msg.slice(0, 2000)}`)
        reject(new AppError(classifyGitError(err + '\n' + stdout), msg.split('\n')[0], msg))
      }
    })
    if (opts.input !== undefined) child.stdin.end(opts.input)
    else child.stdin.end()
  })
}

export async function git(cwd: string, args: string[], extra: Partial<RunOptions> = {}): Promise<string> {
  const r = await run(args, { cwd, ...extra })
  return r.stdout
}

export async function gitVersion(): Promise<string | null> {
  try {
    const out = await git(process.cwd(), ['--version'])
    const m = /(\d+\.\d+(?:\.\d+)?)/.exec(out)
    return m ? m[1] : out.trim()
  } catch {
    return null
  }
}

export function versionAtLeast(v: string, min: string): boolean {
  const a = v.split('.').map(Number)
  const b = min.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return true
}

export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, before?: () => Promise<void>): Promise<T> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      if (i > 0 && before) await before()
      return await fn()
    } catch (e) {
      last = e
      if (!(e instanceof AppError) || e.code !== 'NETWORK' || i === attempts - 1) throw e
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(3, i)))
    }
  }
  throw last
}
