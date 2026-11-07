import type {
  Branch,
  Commit,
  CommitFile,
  DiffFile,
  DiffHunk,
  FileChange,
  StashEntry,
  StatusCode,
  Tag
} from './types'

export const FIELD = '\x1f'
export const RECORD = '\x1e'

export interface StatusHeader {
  branch: string | null
  detached: boolean
  headOid?: string
  upstream?: string
  ahead: number
  behind: number
  hasCommits: boolean
}

const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

function code(c: string): StatusCode {
  return (c || '.') as StatusCode
}

export function parseStatusV2(out: string): { header: StatusHeader; files: FileChange[] } {
  const header: StatusHeader = {
    branch: null,
    detached: false,
    ahead: 0,
    behind: 0,
    hasCommits: true
  }
  const files: FileChange[] = []
  const tokens = out.split('\0')
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (!tok) continue
    if (tok.startsWith('# ')) {
      const [, key, ...rest] = tok.split(' ')
      const val = rest.join(' ')
      if (key === 'branch.oid') {
        if (val === '(initial)') header.hasCommits = false
        else header.headOid = val
      } else if (key === 'branch.head') {
        if (val === '(detached)') header.detached = true
        else header.branch = val
      } else if (key === 'branch.upstream') header.upstream = val
      else if (key === 'branch.ab') {
        const m = /\+(\d+) -(\d+)/.exec(val)
        if (m) {
          header.ahead = Number(m[1])
          header.behind = Number(m[2])
        }
      }
      continue
    }
    const kind = tok[0]
    if (kind === '1') {
      const parts = tok.split(' ')
      const xy = parts[1]
      const path = parts.slice(8).join(' ')
      files.push(makeChange(path, undefined, xy))
    } else if (kind === '2') {
      const parts = tok.split(' ')
      const xy = parts[1]
      const path = parts.slice(9).join(' ')
      const oldPath = tokens[++i]
      files.push(makeChange(path, oldPath, xy))
    } else if (kind === 'u') {
      const parts = tok.split(' ')
      const xy = parts[1]
      const path = parts.slice(10).join(' ')
      files.push({
        path,
        index: code(xy[0]),
        worktree: code(xy[1]),
        staged: false,
        unstaged: true,
        untracked: false,
        conflicted: true
      })
    } else if (kind === '?') {
      files.push({
        path: tok.slice(2),
        index: '?',
        worktree: '?',
        staged: false,
        unstaged: true,
        untracked: true,
        conflicted: false
      })
    }
  }
  return { header, files }
}

function makeChange(path: string, oldPath: string | undefined, xy: string): FileChange {
  return {
    path,
    oldPath,
    index: code(xy[0]),
    worktree: code(xy[1]),
    staged: xy[0] !== '.',
    unstaged: xy[1] !== '.',
    untracked: false,
    conflicted: CONFLICT_CODES.has(xy)
  }
}

export const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%aI', '%D', '%s', '%b'].join('%x1f') + '%x1e'

export function parseLog(out: string): Commit[] {
  const commits: Commit[] = []
  for (const rec of out.split(RECORD)) {
    const r = rec.replace(/^\s+/, '')
    if (!r) continue
    const f = r.split(FIELD)
    if (f.length < 8) continue
    const hash = f[0]
    commits.push({
      hash,
      shortHash: hash.slice(0, 7),
      parents: f[1] ? f[1].split(' ').filter(Boolean) : [],
      authorName: f[2],
      authorEmail: f[3],
      date: f[4],
      refs: f[5]
        ? f[5]
            .split(', ')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      subject: f[6],
      body: f.slice(7).join(FIELD).trim()
    })
  }
  return commits
}

export const BRANCH_FORMAT = [
  '%(refname)',
  '%(refname:short)',
  '%(HEAD)',
  '%(upstream:short)',
  '%(upstream:track)',
  '%(objectname)',
  '%(committerdate:iso-strict)',
  '%(contents:subject)'
].join('%1f')

export function parseBranches(out: string): Branch[] {
  const res: Branch[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const f = line.split(FIELD)
    const ref = f[0]
    if (ref.endsWith('/HEAD')) continue
    const remote = ref.startsWith('refs/remotes/')
    const track = f[4] || ''
    const ahead = /ahead (\d+)/.exec(track)
    const behind = /behind (\d+)/.exec(track)
    res.push({
      ref,
      name: f[1],
      current: f[2] === '*',
      upstream: f[3] || undefined,
      ahead: ahead ? Number(ahead[1]) : 0,
      behind: behind ? Number(behind[1]) : 0,
      gone: track.includes('gone'),
      remote,
      hash: f[5],
      date: f[6],
      subject: f[7] ?? ''
    })
  }
  return res
}

export function parseStashList(out: string): StashEntry[] {
  const res: StashEntry[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [ref, message, date] = line.split(FIELD)
    const m = /\{(\d+)\}/.exec(ref)
    res.push({ ref, index: m ? Number(m[1]) : res.length, message: message ?? '', date: date ?? '' })
  }
  return res
}

export function parseTags(out: string): Tag[] {
  const res: Tag[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [name, hash, peeled, date, subject] = line.split(FIELD)
    res.push({ name, hash: peeled || hash, date: date ?? '', subject: subject ?? '' })
  }
  return res
}

export function parseNameStatus(out: string): CommitFile[] {
  const tokens = out.split('\0').filter((t) => t !== '')
  const res: CommitFile[] = []
  for (let i = 0; i < tokens.length; i++) {
    const st = tokens[i].trim()
    if (!st) continue
    const letter = st[0] as StatusCode
    if (letter === 'R' || letter === 'C') {
      const oldPath = tokens[++i]
      const path = tokens[++i]
      res.push({ path, oldPath, status: letter })
    } else {
      res.push({ path: tokens[++i], status: letter })
    }
  }
  return res
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/

function unquote(p: string): string {
  if (p.startsWith('"') && p.endsWith('"')) {
    const inner = p.slice(1, -1)
    const bytes: number[] = []
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i]
      if (c === '\\' && i + 1 < inner.length) {
        const n = inner[i + 1]
        if (/[0-7]/.test(n)) {
          bytes.push(parseInt(inner.slice(i + 1, i + 4), 8))
          i += 3
          continue
        }
        const map: Record<string, number> = { n: 10, t: 9, '"': 34, '\\': 92, r: 13 }
        bytes.push(map[n] ?? n.charCodeAt(0))
        i++
        continue
      }
      for (const b of new TextEncoder().encode(c)) bytes.push(b)
    }
    return new TextDecoder().decode(new Uint8Array(bytes))
  }
  return p
}

function stripPrefix(p: string): string {
  const u = unquote(p)
  if (u === '/dev/null') return u
  return u.replace(/^[ab]\//, '')
}

export function parseDiff(out: string): DiffFile[] {
  const files: DiffFile[] = []
  let cur: DiffFile | null = null
  let hunk: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0
  const lines = out.split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  for (const line of lines) {
    if (line.startsWith('diff --git ') || line.startsWith('diff --cc ')) {
      const m = /^diff --git (?:"?a\/)(.+?)"? (?:"?b\/)(.+?)"?$/.exec(line)
      cur = {
        path: m ? unquote(m[2].startsWith('"') ? m[2] : m[2]) : line.slice(11),
        binary: false,
        isNew: false,
        isDeleted: false,
        headerLines: [line],
        hunks: []
      }
      files.push(cur)
      hunk = null
      continue
    }
    if (!cur) continue
    if (!hunk) {
      if (line.startsWith('--- ')) {
        const p = stripPrefix(line.slice(4))
        if (p === '/dev/null') cur.isNew = true
        else cur.oldPath = p
        cur.headerLines.push(line)
        continue
      }
      if (line.startsWith('+++ ')) {
        const p = stripPrefix(line.slice(4))
        if (p === '/dev/null') cur.isDeleted = true
        else cur.path = p
        cur.headerLines.push(line)
        continue
      }
      if (line.startsWith('new file mode')) cur.isNew = true
      if (line.startsWith('deleted file mode')) cur.isDeleted = true
      if (line.startsWith('rename from ')) cur.oldPath = unquote(line.slice(12))
      if (line.startsWith('rename to ')) cur.path = unquote(line.slice(10))
      if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) cur.binary = true
    }
    const hm = HUNK_RE.exec(line)
    if (hm) {
      hunk = {
        header: line,
        oldStart: Number(hm[1]),
        oldLines: hm[2] === undefined ? 1 : Number(hm[2]),
        newStart: Number(hm[3]),
        newLines: hm[4] === undefined ? 1 : Number(hm[4]),
        section: hm[5] ?? '',
        lines: []
      }
      oldNo = hunk.oldStart
      newNo = hunk.newStart
      cur.hunks.push(hunk)
      continue
    }
    if (!hunk) {
      cur.headerLines.push(line)
      continue
    }
    const c = line[0]
    const text = line.slice(1)
    if (c === '+') hunk.lines.push({ type: 'add', text, newNo: newNo++ })
    else if (c === '-') hunk.lines.push({ type: 'del', text, oldNo: oldNo++ })
    else if (c === '\\') hunk.lines.push({ type: 'nonl', text: line })
    else hunk.lines.push({ type: 'ctx', text, oldNo: oldNo++, newNo: newNo++ })
  }
  for (const f of files) {
    if (f.oldPath === f.path) f.oldPath = undefined
  }
  return files
}
