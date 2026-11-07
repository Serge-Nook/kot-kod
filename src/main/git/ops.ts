import { promises as fs, existsSync } from 'fs'
import { join, resolve, dirname, isAbsolute } from 'path'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { AppError } from '../errors'
import { git, hooks, run, withRetry, type Credentials } from './runner'
import {
  BRANCH_FORMAT,
  LOG_FORMAT,
  parseBranches,
  parseDiff,
  parseLog,
  parseNameStatus,
  parseStashList,
  parseStatusV2,
  parseTags,
  FIELD
} from '../../shared/parse'
import type {
  Branch,
  Commit,
  CommitFile,
  ConflictVersions,
  DiffFile,
  RebaseTodoItem,
  Remote,
  RepoState,
  RepoStatus,
  RepoSummary,
  StashEntry,
  Tag
} from '../../shared/types'
import type { CommitInput, InitInput, LogQuery } from '../../shared/api'
import { repoNameFromUrl } from '../../shared/remote'

const DIFF_LIMIT = 4 * 1024 * 1024

export async function toplevel(path: string): Promise<string> {
  if (!existsSync(path)) throw new AppError('PATH_NOT_FOUND', path)
  const out = await git(path, ['rev-parse', '--show-toplevel'])
  return out.trim()
}

async function gitDir(repo: string): Promise<string> {
  return (await git(repo, ['rev-parse', '--absolute-git-dir'])).trim()
}

async function repoState(repo: string): Promise<RepoState> {
  const dir = await gitDir(repo)
  if (existsSync(join(dir, 'rebase-merge')) || existsSync(join(dir, 'rebase-apply')))
    return 'rebasing'
  if (existsSync(join(dir, 'MERGE_HEAD'))) return 'merging'
  if (existsSync(join(dir, 'CHERRY_PICK_HEAD'))) return 'cherry-picking'
  if (existsSync(join(dir, 'REVERT_HEAD'))) return 'reverting'
  return 'clean'
}

export async function status(repo: string): Promise<RepoStatus> {
  const out = await git(repo, [
    'status',
    '--porcelain=v2',
    '--branch',
    '-z',
    '--untracked-files=all'
  ])
  const { header, files } = parseStatusV2(out)
  const state = await repoState(repo)
  return { ...header, files, state }
}

export async function summary(path: string): Promise<RepoSummary> {
  if (!existsSync(path)) return { path, exists: false, branch: null, changes: 0, ahead: 0, behind: 0 }
  try {
    const s = await status(path)
    return {
      path,
      exists: true,
      branch: s.branch,
      changes: s.files.length,
      ahead: s.ahead,
      behind: s.behind
    }
  } catch {
    return { path, exists: false, branch: null, changes: 0, ahead: 0, behind: 0 }
  }
}

function firstFile(out: string, truncated: boolean): DiffFile | null {
  const files = parseDiff(out)
  const f = files[0] ?? null
  if (f && truncated) {
    f.tooLarge = true
    f.hunks = []
  }
  return f
}

export async function diff(
  repo: string,
  path: string,
  staged: boolean,
  untracked: boolean,
  oldPath?: string
): Promise<DiffFile | null> {
  if (untracked) {
    const r = await run(['diff', '--no-index', '--no-ext-diff', '--', '/dev/null', path], {
      cwd: repo,
      okCodes: [0, 1],
      maxBuffer: DIFF_LIMIT
    })
    const f = firstFile(r.stdout, r.truncated)
    if (f) {
      f.path = path
      f.isNew = true
      f.oldPath = undefined
    }
    return f
  }
  const args = ['diff', '--no-ext-diff', '-M']
  if (staged) args.push('--cached')
  args.push('--', path)
  if (oldPath) args.push(oldPath)
  const r = await run(args, { cwd: repo, maxBuffer: DIFF_LIMIT })
  return firstFile(r.stdout, r.truncated)
}

async function hasHead(repo: string): Promise<boolean> {
  const r = await run(['rev-parse', '--verify', '-q', 'HEAD'], { cwd: repo, okCodes: [0, 1, 128] })
  return r.code === 0
}

export async function stage(repo: string, paths: string[]): Promise<void> {
  if (!paths.length) return
  await git(repo, ['add', '-A', '--', ...paths])
}

export async function unstage(repo: string, paths: string[]): Promise<void> {
  if (!paths.length) return
  if (await hasHead(repo)) await git(repo, ['reset', '-q', 'HEAD', '--', ...paths])
  else await git(repo, ['rm', '--cached', '-r', '-q', '--ignore-unmatch', '--', ...paths])
}

export async function applyPatch(
  repo: string,
  patch: string,
  mode: 'stage' | 'unstage' | 'discard'
): Promise<void> {
  const args = ['apply', '--recount', '--whitespace=nowarn']
  if (mode === 'stage') args.push('--cached')
  if (mode === 'unstage') args.push('--cached', '-R')
  if (mode === 'discard') args.push('-R')
  args.push('-')
  await git(repo, args, { input: patch })
}

export async function discard(repo: string, paths: string[]): Promise<void> {
  const st = await status(repo)
  const head = st.hasCommits
  for (const p of paths) {
    const f = st.files.find((x) => x.path === p)
    if (!f) continue
    const abs = join(repo, p)
    if (f.untracked) {
      await hooks.trash(abs)
      continue
    }
    if (f.index === 'A' || !head) {
      await git(repo, ['rm', '--cached', '-q', '-f', '--', p])
      if (existsSync(abs)) await hooks.trash(abs)
      continue
    }
    const targets = f.oldPath ? [p, f.oldPath] : [p]
    if (f.oldPath && f.index === 'R') {
      await git(repo, ['reset', '-q', 'HEAD', '--', ...targets])
      if (existsSync(abs)) await hooks.trash(abs)
      await git(repo, ['checkout', 'HEAD', '--', f.oldPath])
      continue
    }
    await git(repo, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...targets])
  }
}

export function buildMessage(input: CommitInput): string {
  let msg = input.summary.trim()
  const desc = input.description.trim()
  if (desc) msg += '\n\n' + desc
  const co = input.coAuthors.map((s) => s.trim()).filter(Boolean)
  if (co.length) msg += '\n\n' + co.map((c) => `Co-authored-by: ${c}`).join('\n')
  return msg + '\n'
}

export async function commit(repo: string, input: CommitInput): Promise<string> {
  if (!input.summary.trim()) throw new AppError('EMPTY_MESSAGE')
  const args = ['commit', '-F', '-', '--cleanup=strip']
  if (input.amend) args.push('--amend')
  await git(repo, args, { input: buildMessage(input) })
  return (await git(repo, ['rev-parse', 'HEAD'])).trim()
}

export async function lastCommitMessage(repo: string): Promise<string> {
  return (await git(repo, ['log', '-1', '--format=%B'])).trim()
}

export async function log(repo: string, q: LogQuery): Promise<Commit[]> {
  if (!(await hasHead(repo)) && !q.all) return []
  const args = ['log', `--format=${LOG_FORMAT}`, '--topo-order', `-n${q.limit}`]
  if (q.skip) args.push(`--skip=${q.skip}`)
  if (q.search) {
    const s = q.search.trim()
    if (/^[0-9a-f]{4,40}$/i.test(s)) {
      const r = await run(['log', `--format=${LOG_FORMAT}`, '-1', s, '--'], {
        cwd: repo,
        okCodes: [0, 128]
      })
      if (r.code === 0) return parseLog(r.stdout)
    }
    args.push(`--grep=${s}`, '-i', '--fixed-strings')
  }
  if (q.author) args.push(`--author=${q.author}`, '-i')
  if (q.all) args.push('--all')
  else args.push(q.ref || 'HEAD')
  args.push('--')
  return parseLog(await git(repo, args))
}

export async function commitFiles(repo: string, hash: string): Promise<CommitFile[]> {
  const out = await git(repo, [
    'show',
    '--format=',
    '--name-status',
    '-z',
    '-M',
    '--diff-merges=first-parent',
    hash
  ])
  return parseNameStatus(out)
}

export async function commitDiff(repo: string, hash: string, path: string): Promise<DiffFile | null> {
  const files = await commitFiles(repo, hash)
  const f = files.find((x) => x.path === path)
  const args = ['show', '--format=', '--no-ext-diff', '-M', '--diff-merges=first-parent', hash, '--', path]
  if (f?.oldPath) args.push(f.oldPath)
  const r = await run(args, { cwd: repo, maxBuffer: DIFF_LIMIT })
  return firstFile(r.stdout, r.truncated)
}

export async function branches(repo: string): Promise<Branch[]> {
  const out = await git(repo, [
    'for-each-ref',
    `--format=${BRANCH_FORMAT}`,
    '--sort=-committerdate',
    'refs/heads',
    'refs/remotes'
  ])
  return parseBranches(out)
}

export function validBranchName(name: string): boolean {
  return (
    !!name &&
    !/[\s~^:?*[\\]|\.\.|@\{|\/\/|^\/|\/$|\.lock$|^-|^\.|\/\.|\.$/.test(name) &&
    name !== '@'
  )
}

export async function createBranch(
  repo: string,
  name: string,
  start: string | null,
  checkout: boolean
): Promise<void> {
  if (!validBranchName(name)) throw new AppError('INVALID_BRANCH_NAME', name)
  if (checkout) await git(repo, ['switch', '-c', name, ...(start ? [start] : [])])
  else await git(repo, ['branch', name, ...(start ? [start] : [])])
}

export async function renameBranch(repo: string, oldName: string, newName: string): Promise<void> {
  if (!validBranchName(newName)) throw new AppError('INVALID_BRANCH_NAME', newName)
  await git(repo, ['branch', '-m', oldName, newName])
}

export async function deleteBranch(
  repo: string,
  name: string,
  force: boolean,
  remoteToo: boolean,
  auth?: (remote: string) => Promise<Credentials | null>
): Promise<void> {
  const st = await status(repo)
  if (st.branch === name) throw new AppError('CURRENT_BRANCH', name)
  const list = await branches(repo)
  const b = list.find((x) => !x.remote && x.name === name)
  if (b) await git(repo, ['branch', force ? '-D' : '-d', name])
  if (remoteToo) {
    const up = b?.upstream ?? list.find((x) => x.remote && x.name.endsWith('/' + name))?.name
    if (up) {
      const idx = up.indexOf('/')
      const remote = up.slice(0, idx)
      const rbranch = up.slice(idx + 1)
      await git(repo, ['push', remote, '--delete', rbranch], { auth: await auth?.(remote) })
    }
  }
}

export async function checkout(repo: string, branch: string, carry: 'keep' | 'stash'): Promise<void> {
  const list = await branches(repo)
  const local = list.find((b) => !b.remote && b.name === branch)
  if (carry === 'stash') {
    const st = await status(repo)
    if (st.files.length)
      await git(repo, ['stash', 'push', '-u', '-m', `kot-kod: auto-stash (${st.branch ?? 'HEAD'})`])
  }
  if (local) {
    await git(repo, ['switch', branch])
    return
  }
  const remote = list.find((b) => b.remote && b.name === branch)
  if (remote) {
    const localName = branch.slice(branch.indexOf('/') + 1)
    if (list.some((b) => !b.remote && b.name === localName)) await git(repo, ['switch', localName])
    else await git(repo, ['switch', '-c', localName, '--track', branch])
    return
  }
  await git(repo, ['switch', branch])
}

export async function checkoutCommit(repo: string, hash: string): Promise<void> {
  await git(repo, ['switch', '--detach', hash])
}

type OpResult = 'ok' | 'conflicts'

async function conflictAware(fn: () => Promise<unknown>): Promise<OpResult> {
  try {
    await fn()
    return 'ok'
  } catch (e) {
    if (e instanceof AppError && (e.code === 'CONFLICT' || /CONFLICT/.test(e.details ?? '')))
      return 'conflicts'
    throw e
  }
}

const NO_EDITOR = { GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true' }

export async function merge(repo: string, branch: string, mode: 'merge' | 'squash' | 'no-ff'): Promise<string> {
  const args = ['merge']
  if (mode === 'squash') args.push('--squash')
  else args.push('--no-edit')
  if (mode === 'no-ff') args.push('--no-ff')
  args.push(branch)
  return conflictAware(() => git(repo, args, { env: NO_EDITOR }))
}

export async function rebase(repo: string, onto: string): Promise<string> {
  return conflictAware(() => git(repo, ['rebase', onto], { env: NO_EDITOR }))
}

export async function rebaseInteractive(
  repo: string,
  base: string,
  todo: RebaseTodoItem[]
): Promise<string> {
  if (!todo.length) throw new AppError('EMPTY_TODO')
  const dir = await mkdtemp(join(tmpdir(), 'kotkod-rebase-'))
  const lines: string[] = []
  for (let i = 0; i < todo.length; i++) {
    const t = todo[i]
    if (t.action === 'reword') {
      const msgFile = join(dir, `msg-${i}.txt`)
      await fs.writeFile(msgFile, (t.message ?? t.subject) + '\n')
      lines.push(`pick ${t.hash} ${t.subject}`)
      lines.push(`exec git commit --amend --no-verify -F '${msgFile}'`)
    } else {
      lines.push(`${t.action} ${t.hash} ${t.subject}`)
    }
  }
  const todoFile = join(dir, 'todo.txt')
  await fs.writeFile(todoFile, lines.join('\n') + '\n')
  const args = ['rebase', '-i', '--autostash']
  if (base === '--root') args.push('--root')
  else args.push(base)
  try {
    return await conflictAware(() =>
      git(repo, args, {
        env: { GIT_SEQUENCE_EDITOR: `cp '${todoFile}'`, GIT_EDITOR: 'true' }
      })
    )
  } finally {
    setTimeout(() => fs.rm(dir, { recursive: true, force: true }).catch(() => undefined), 60_000)
  }
}

export async function continueOp(repo: string): Promise<string> {
  const st = await status(repo)
  if (st.files.some((f) => f.conflicted)) throw new AppError('UNRESOLVED_CONFLICTS')
  switch (st.state) {
    case 'merging':
      return conflictAware(() => git(repo, ['commit', '--no-edit'], { env: NO_EDITOR }))
    case 'rebasing':
      return conflictAware(() => git(repo, ['rebase', '--continue'], { env: NO_EDITOR }))
    case 'cherry-picking':
      return conflictAware(() => git(repo, ['cherry-pick', '--continue'], { env: NO_EDITOR }))
    case 'reverting':
      return conflictAware(() => git(repo, ['revert', '--continue'], { env: NO_EDITOR }))
    default:
      return 'ok'
  }
}

export async function abortOp(repo: string): Promise<void> {
  const st = await status(repo)
  const map: Record<string, string[]> = {
    merging: ['merge', '--abort'],
    rebasing: ['rebase', '--abort'],
    'cherry-picking': ['cherry-pick', '--abort'],
    reverting: ['revert', '--abort']
  }
  const args = map[st.state]
  if (args) await git(repo, args)
}

export async function skipOp(repo: string): Promise<string> {
  const st = await status(repo)
  if (st.state === 'rebasing')
    return conflictAware(() => git(repo, ['rebase', '--skip'], { env: NO_EDITOR }))
  if (st.state === 'cherry-picking')
    return conflictAware(() => git(repo, ['cherry-pick', '--skip'], { env: NO_EDITOR }))
  if (st.state === 'reverting')
    return conflictAware(() => git(repo, ['revert', '--skip'], { env: NO_EDITOR }))
  return 'ok'
}

async function parentCount(repo: string, hash: string): Promise<number> {
  const out = await git(repo, ['rev-list', '--parents', '-n', '1', hash])
  return out.trim().split(' ').length - 1
}

export async function cherryPick(repo: string, hash: string): Promise<string> {
  const args = ['cherry-pick']
  if ((await parentCount(repo, hash)) > 1) args.push('-m', '1')
  args.push(hash)
  return conflictAware(() => git(repo, args, { env: NO_EDITOR }))
}

export async function revert(repo: string, hash: string): Promise<string> {
  const args = ['revert', '--no-edit']
  if ((await parentCount(repo, hash)) > 1) args.push('-m', '1')
  args.push(hash)
  return conflictAware(() => git(repo, args, { env: NO_EDITOR }))
}

export async function reset(repo: string, hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
  await git(repo, ['reset', `--${mode}`, hash])
}

export async function stashList(repo: string): Promise<StashEntry[]> {
  const out = await git(repo, ['stash', 'list', '--format=%gd%x1f%s%x1f%cI'])
  return parseStashList(out)
}

export async function stashPush(repo: string, message: string, untracked: boolean): Promise<void> {
  const args = ['stash', 'push']
  if (untracked) args.push('-u')
  if (message.trim()) args.push('-m', message.trim())
  await git(repo, args)
}

export async function stashApply(repo: string, ref: string, pop: boolean): Promise<void> {
  await git(repo, ['stash', pop ? 'pop' : 'apply', ref])
}

export async function stashDrop(repo: string, ref: string): Promise<void> {
  await git(repo, ['stash', 'drop', ref])
}

export async function stashDiff(repo: string, ref: string): Promise<DiffFile[]> {
  const r = await run(['stash', 'show', '-p', '--no-ext-diff', '--include-untracked', ref], {
    cwd: repo,
    maxBuffer: DIFF_LIMIT
  })
  return parseDiff(r.stdout)
}

export async function tags(repo: string): Promise<Tag[]> {
  const out = await git(repo, [
    'for-each-ref',
    '--sort=-creatordate',
    `--format=%(refname:short)${FIELD}%(objectname)${FIELD}%(*objectname)${FIELD}%(creatordate:iso-strict)${FIELD}%(contents:subject)`,
    'refs/tags'
  ])
  return parseTags(out)
}

export async function createTag(repo: string, name: string, hash: string, message: string): Promise<void> {
  if (!validBranchName(name)) throw new AppError('INVALID_TAG_NAME', name)
  if (message.trim()) await git(repo, ['tag', '-a', name, '-m', message.trim(), hash])
  else await git(repo, ['tag', name, hash])
}

export async function remotes(repo: string): Promise<Remote[]> {
  const out = await git(repo, ['remote', '-v'])
  const map = new Map<string, Remote>()
  for (const line of out.split('\n')) {
    const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim())
    if (!m) continue
    const r = map.get(m[1]) ?? { name: m[1], fetchUrl: '', pushUrl: '' }
    if (m[3] === 'fetch') r.fetchUrl = m[2]
    else r.pushUrl = m[2]
    map.set(m[1], r)
  }
  return [...map.values()]
}

export async function remoteUrl(repo: string, name: string): Promise<string | null> {
  const r = await run(['remote', 'get-url', name], { cwd: repo, okCodes: [0, 2, 128] })
  return r.code === 0 ? r.stdout.trim() : null
}

async function authForRemote(repo: string, remote: string): Promise<Credentials | null> {
  const url = await remoteUrl(repo, remote)
  return url ? hooks.authFor(url) : null
}

export async function fetchAll(repo: string): Promise<void> {
  const list = await remotes(repo)
  for (const r of list) {
    await withRetry(() =>
      git(repo, ['fetch', '--prune', '--progress', '--tags', r.name], {
        auth: hooks.authFor(r.fetchUrl),
        progressOp: 'fetch'
      })
    )
  }
}

async function upstreamRemote(repo: string): Promise<{ remote: string; branch: string | null; upstream?: string }> {
  const st = await status(repo)
  const list = await remotes(repo)
  let remote = list.find((r) => r.name === 'origin')?.name ?? list[0]?.name
  if (st.upstream) remote = st.upstream.slice(0, st.upstream.indexOf('/'))
  if (!remote) throw new AppError('NO_REMOTE')
  return { remote, branch: st.branch, upstream: st.upstream }
}

export async function pull(repo: string, mode: 'merge' | 'rebase' | 'ff-only'): Promise<string> {
  const { remote, upstream } = await upstreamRemote(repo)
  if (!upstream) throw new AppError('NO_UPSTREAM')
  const args = ['pull', '--progress', '--no-edit']
  if (mode === 'rebase') args.push('--rebase')
  else if (mode === 'ff-only') args.push('--ff-only')
  else args.push('--no-rebase')
  const auth = await authForRemote(repo, remote)
  return conflictAware(() =>
    withRetry(() => git(repo, args, { auth, progressOp: 'pull', env: NO_EDITOR }))
  )
}

export async function push(
  repo: string,
  opts: { force: boolean; setUpstream: boolean; tags?: boolean }
): Promise<void> {
  const { remote, branch, upstream } = await upstreamRemote(repo)
  if (!branch) throw new AppError('DETACHED_HEAD')
  const args = ['push', '--progress']
  if (opts.force) args.push('--force-with-lease')
  if (opts.tags) args.push('--follow-tags')
  if (!upstream || opts.setUpstream) args.push('-u', remote, `HEAD:refs/heads/${branch}`)
  else {
    const ubranch = upstream.slice(upstream.indexOf('/') + 1)
    args.push(remote, `HEAD:refs/heads/${ubranch}`)
  }
  const auth = await authForRemote(repo, remote)
  await withRetry(() => git(repo, args, { auth, progressOp: 'push' }))
}

export async function pushTag(repo: string, name: string): Promise<void> {
  const { remote } = await upstreamRemote(repo)
  await git(repo, ['push', remote, `refs/tags/${name}`], { auth: await authForRemote(repo, remote) })
}

export async function deleteTag(repo: string, name: string, remoteToo: boolean): Promise<void> {
  await git(repo, ['tag', '-d', name])
  if (remoteToo) {
    const { remote } = await upstreamRemote(repo)
    await git(repo, ['push', remote, `:refs/tags/${name}`], {
      auth: await authForRemote(repo, remote)
    })
  }
}

async function showStage(repo: string, n: number, path: string): Promise<string | null> {
  const r = await run(['show', `:${n}:${path}`], { cwd: repo, okCodes: [0, 128] })
  return r.code === 0 ? r.stdout : null
}

export async function conflict(repo: string, path: string): Promise<ConflictVersions> {
  const abs = join(repo, path)
  const working = existsSync(abs) ? await fs.readFile(abs, 'utf8') : ''
  return {
    path,
    base: await showStage(repo, 1, path),
    ours: await showStage(repo, 2, path),
    theirs: await showStage(repo, 3, path),
    working
  }
}

export async function resolveConflict(
  repo: string,
  path: string,
  how: 'ours' | 'theirs' | 'content',
  content?: string
): Promise<void> {
  const abs = join(repo, path)
  if (how === 'content') {
    await fs.writeFile(abs, content ?? '')
    await git(repo, ['add', '--', path])
    return
  }
  const n = how === 'ours' ? 2 : 3
  const version = await showStage(repo, n, path)
  if (version === null) {
    await git(repo, ['rm', '-q', '--ignore-unmatch', '--', path])
    return
  }
  await git(repo, ['checkout', `--${how}`, '--', path])
  await git(repo, ['add', '--', path])
}

export async function readGitignore(repo: string): Promise<string> {
  const p = join(repo, '.gitignore')
  return existsSync(p) ? fs.readFile(p, 'utf8') : ''
}

export async function writeGitignore(repo: string, content: string): Promise<void> {
  await fs.writeFile(join(repo, '.gitignore'), content.endsWith('\n') || !content ? content : content + '\n')
}

export async function ignorePath(repo: string, pattern: string): Promise<void> {
  const cur = await readGitignore(repo)
  const lines = cur.split('\n')
  if (lines.includes(pattern)) return
  const next = (cur && !cur.endsWith('\n') ? cur + '\n' : cur) + pattern + '\n'
  await fs.writeFile(join(repo, '.gitignore'), next)
}

export async function getConfig(repo: string): Promise<{ name: string; email: string }> {
  const read = async (key: string) => {
    const r = await run(['config', '--get', key], { cwd: repo, okCodes: [0, 1] })
    return r.stdout.trim()
  }
  return { name: await read('user.name'), email: await read('user.email') }
}

export async function setConfig(repo: string | null, name: string, email: string): Promise<void> {
  const cwd = repo ?? process.cwd()
  const scope = repo ? [] : ['--global']
  if (name) await git(cwd, ['config', ...scope, 'user.name', name])
  if (email) await git(cwd, ['config', ...scope, 'user.email', email])
}

export function gitignoreTemplateNames(): Promise<string[]> {
  return fs
    .readdir(join(hooks.resourcesDir, 'gitignore'))
    .then((l) => l.filter((f) => f.endsWith('.gitignore')).map((f) => f.replace(/\.gitignore$/, '')).sort())
}

export async function gitignoreTemplate(name: string): Promise<string> {
  if (!/^[\w.+-]+$/.test(name)) throw new AppError('INVALID_INPUT', name)
  return fs.readFile(join(hooks.resourcesDir, 'gitignore', `${name}.gitignore`), 'utf8')
}

export function licenseNames(): Promise<string[]> {
  return fs
    .readdir(join(hooks.resourcesDir, 'licenses'))
    .then((l) => l.filter((f) => f.endsWith('.txt')).map((f) => f.replace(/\.txt$/, '')).sort())
}

export async function init(input: InitInput): Promise<string> {
  const path = resolve(input.path)
  await fs.mkdir(path, { recursive: true })
  await git(path, ['init', '-b', input.defaultBranch || 'main'])
  const name = path.split(/[\\/]/).pop() || 'repo'
  if (input.gitignore.length) {
    const parts: string[] = []
    for (const t of input.gitignore) {
      const f = join(hooks.resourcesDir, 'gitignore', `${t}.gitignore`)
      if (existsSync(f)) parts.push(`# ${t}\n` + (await fs.readFile(f, 'utf8')).trim())
    }
    await fs.writeFile(join(path, '.gitignore'), parts.join('\n\n') + '\n')
  }
  if (input.license) {
    const f = join(hooks.resourcesDir, 'licenses', `${input.license}.txt`)
    if (existsSync(f)) {
      const text = (await fs.readFile(f, 'utf8'))
        .replace(/\[year\]|<year>/g, String(new Date().getFullYear()))
        .replace(/\[fullname\]|<name of author>/g, input.authorName || name)
      await fs.writeFile(join(path, 'LICENSE'), text)
    }
  }
  if (input.readme) await fs.writeFile(join(path, 'README.md'), `# ${name}\n`)
  const st = await status(path)
  if (st.files.length) {
    await git(path, ['add', '-A'])
    try {
      await git(path, ['commit', '-m', 'Initial commit'])
    } catch (e) {
      hooks.log(`initial commit skipped: ${String(e)}`)
    }
  }
  return path
}

export async function clone(url: string, parentDir: string, auth: Credentials | null): Promise<string> {
  const name = repoNameFromUrl(url)
  const target = isAbsolute(parentDir) ? join(parentDir, name) : resolve(parentDir, name)
  if (existsSync(target) && (await fs.readdir(target)).length)
    throw new AppError('TARGET_EXISTS', target)
  await fs.mkdir(dirname(target), { recursive: true })
  await withRetry(
    () => git(dirname(target), ['clone', '--progress', url, target], { auth, progressOp: 'clone' }),
    3,
    () => fs.rm(target, { recursive: true, force: true })
  )
  return target
}
