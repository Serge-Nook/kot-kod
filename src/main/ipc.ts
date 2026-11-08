import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'child_process'
import { createWriteStream, existsSync, promises as fs } from 'fs'
import { basename, extname, join } from 'path'
import { once } from 'events'
import { homedir } from 'os'
import { AppError } from './errors'
import { log, mask, tail } from './logger'
import * as settings from './settings'
import * as accounts from './accounts'
import * as secrets from './secrets'
import * as ops from './git/ops'
import { git, gitVersion, versionAtLeast } from './git/runner'
import * as updates from './updates'
import { configDir, logDir, resourcesDir } from './paths'
import { parseRemoteUrl, providerForHost } from '../shared/remote'
import { providers } from './hosting/rest'
import type { Api, ApiEvent, ApiResult, RepoRef } from '../shared/api'
import type { Release, Settings } from '../shared/types'

let mainWindow: BrowserWindow | null = null
export function setMainWindow(w: BrowserWindow): void {
  mainWindow = w
}

function tok(ref: { accountId: string }): string {
  return accounts.token(ref.accountId)
}
function prov(ref: { accountId: string }) {
  return accounts.provider(accounts.get(ref.accountId).provider)
}

function emit(e: ApiEvent): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('api-event', e)
}

const MIME: Record<string, string> = {
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tgz': 'application/gzip',
  '.xz': 'application/x-xz',
  '.7z': 'application/x-7z-compressed',
  '.deb': 'application/vnd.debian.binary-package',
  '.rpm': 'application/x-rpm',
  '.appimage': 'application/x-executable',
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.msi': 'application/x-msi',
  '.dmg': 'application/x-apple-diskimage',
  '.apk': 'application/vnd.android.package-archive',
  '.json': 'application/json',
  '.yml': 'text/yaml',
  '.yaml': 'text/yaml',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
}
export function mimeFor(name: string): string {
  return MIME[extname(name).toLowerCase()] ?? 'application/octet-stream'
}

async function uploadFiles(ref: RepoRef, release: Release, files: string[]): Promise<void> {
  const p = prov(ref)
  for (let i = 0; i < files.length; i++) {
    const name = basename(files[i])
    emit({ type: 'transfer', label: `${i + 1}/${files.length} ${name}`, percent: Math.round((i / files.length) * 100) })
    const data = await fs.readFile(files[i])
    await p.uploadAsset(tok(ref), ref.owner, ref.repo, release, name, data, mimeFor(name))
  }
  emit({ type: 'transfer', label: '', percent: 100 })
}

async function uniquePath(dir: string, name: string): Promise<string> {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let path = join(dir, name)
  for (let i = 1; existsSync(path); i++) path = join(dir, `${stem} (${i})${ext}`)
  return path
}

async function saveResponse(res: Response, file: string, label: string): Promise<void> {
  const total = Number(res.headers.get('content-length')) || 0
  const tmp = `${file}.part`
  const out = createWriteStream(tmp)
  let done = 0
  let last = 0
  try {
    if (!res.body) throw new AppError('NETWORK', 'empty body')
    const reader = res.body.getReader()
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      done += chunk.value.length
      if (!out.write(chunk.value)) await once(out, 'drain')
      const now = Date.now()
      if (now - last > 200) {
        last = now
        emit({ type: 'transfer', label, percent: total ? Math.round((done / total) * 100) : null })
      }
    }
    out.end()
    await once(out, 'finish')
    await fs.rename(tmp, file)
  } catch (e) {
    out.destroy()
    await fs.rm(tmp, { force: true })
    throw e
  }
}

/** Makes sure the tag exists in the target repository, pushing it from the local clone if needed. */
async function ensureRemoteTag(to: RepoRef, tag: string, repoPath?: string): Promise<void> {
  const target = await prov(to).repo(tok(to), to.owner, to.repo)
  const a = accounts.get(to.accountId)
  const auth = { username: a.login, password: tok(to) }
  const out = await git(repoPath ?? homedir(), ['ls-remote', '--tags', target.cloneUrl, `refs/tags/${tag}`], { auth })
  if (out.trim()) return
  if (repoPath && (await ops.hasTag(repoPath, tag))) {
    await git(repoPath, ['push', target.cloneUrl, `refs/tags/${tag}`], { auth })
    return
  }
  throw new AppError('TAG_MISSING', tag)
}

async function waitForRepo(accountId: string, owner: string, repo: string): Promise<void> {
  const p = prov({ accountId })
  for (let i = 0; i < 30; i++) {
    try {
      await p.repo(tok({ accountId }), owner, repo)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
}

function openTerminal(path: string): void {
  const candidates: [string, string[]][] = [
    ['konsole', ['--workdir', path]],
    ['gnome-terminal', ['--working-directory=' + path]],
    ['xfce4-terminal', ['--working-directory=' + path]],
    ['x-terminal-emulator', []],
    ['kitty', ['--directory', path]],
    ['alacritty', ['--working-directory', path]],
    ['xterm', []]
  ]
  const tryNext = (i: number): void => {
    if (i >= candidates.length) return
    const [cmd, args] = candidates[i]
    const child = spawn(cmd, args, { cwd: path, detached: true, stdio: 'ignore' })
    child.on('error', () => tryNext(i + 1))
    child.unref()
  }
  tryNext(0)
}

const impl: Api = {
  app: {
    async info() {
      const v = await gitVersion()
      return {
        version: app.getVersion(),
        gitVersion: v,
        gitOk: !!v && versionAtLeast(v, '2.35'),
        platform: `${process.platform} ${process.arch}`,
        appImage: !!process.env.APPIMAGE,
        configDir,
        logDir,
        secretsBackend: secrets.backendState(),
        electron: process.versions.electron
      }
    },
    async openExternal(url) {
      if (!/^https?:\/\//.test(url)) throw new AppError('BAD_URL', url)
      await shell.openExternal(url)
    },
    async openPath(path) {
      await shell.openPath(path)
    },
    async showInFolder(path) {
      shell.showItemInFolder(path)
    },
    async openTerminal(path) {
      openTerminal(path)
    },
    async pickFiles(title) {
      const r = await dialog.showOpenDialog(mainWindow!, { title, properties: ['openFile', 'multiSelections'] })
      return r.canceled ? [] : r.filePaths
    },
    async pickDirectory(title, defaultPath) {
      const r = await dialog.showOpenDialog(mainWindow!, {
        title,
        defaultPath,
        properties: ['openDirectory', 'createDirectory']
      })
      return r.canceled ? null : (r.filePaths[0] ?? null)
    },
    checkUpdate: () => updates.check(),
    async downloadUpdate() {
      await updates.downloadAppImage(mainWindow)
    },
    async readLogTail() {
      return tail()
    },
    async reportProblem() {
      const body = mask(
        `**Версия:** ${app.getVersion()}\n**Платформа:** ${process.platform} ${process.arch}\n**Git:** ${await gitVersion()}\n\n**Описание проблемы:**\n\n\n**Журнал:**\n\`\`\`\n${tail(5000)}\n\`\`\`\n`
      )
      const url = `https://github.com/${updates.UPDATE_OWNER}/${updates.UPDATE_REPO}/issues/new?title=${encodeURIComponent('Отчёт об ошибке')}&body=${encodeURIComponent(body)}`
      await shell.openExternal(url.slice(0, 8000))
    },
    async setZoom(zoom) {
      mainWindow?.webContents.setZoomFactor(Math.min(2, Math.max(1, zoom)))
    },
    async unlockSecrets(password) {
      return secrets.unlock(password)
    },
    async readHelp(lang) {
      const dir = join(resourcesDir(), 'help')
      const f = join(dir, `${lang}.md`)
      return fs.readFile(existsSync(f) ? f : join(dir, 'ru.md'), 'utf8')
    }
  },
  settings: {
    async get() {
      return settings.load()
    },
    async set(patch: Partial<Settings>) {
      const s = settings.save(patch)
      if (patch.zoom) mainWindow?.webContents.setZoomFactor(s.zoom)
      return s
    },
    async saveDraft(repoPath, draft) {
      const drafts = { ...settings.load().commitDrafts }
      if (draft && (draft.summary || draft.description || draft.coAuthors)) drafts[repoPath] = draft
      else delete drafts[repoPath]
      settings.save({ commitDrafts: drafts })
    },
    gitignoreTemplates: () => ops.gitignoreTemplateNames(),
    gitignoreTemplate: (n) => ops.gitignoreTemplate(n),
    licenses: () => ops.licenseNames()
  },
  repos: {
    async add(path) {
      const top = await ops.toplevel(path)
      settings.addRecent(top)
      return top
    },
    async remove(path) {
      const s = settings.load()
      settings.save({ recentRepos: s.recentRepos.filter((r) => r.path !== path) })
    },
    async summaries(paths) {
      return Promise.all(paths.map((p) => ops.summary(p)))
    },
    async init(input) {
      const p = await ops.init(input)
      settings.addRecent(p)
      return p
    },
    async clone(url, dir, accountId) {
      let auth = accounts.authFor(url)
      if (accountId && /^https:/.test(url)) {
        const a = accounts.get(accountId)
        auth = { username: a.login, password: accounts.token(accountId) }
      }
      const p = await ops.clone(url, dir, auth)
      settings.addRecent(p)
      return p
    },
    async deleteLocal(path) {
      await shell.trashItem(path)
      const s = settings.load()
      settings.save({ recentRepos: s.recentRepos.filter((r) => r.path !== path) })
    }
  },
  git: {
    status: (r) => ops.status(r),
    diff: async (r, p, staged, untracked) => {
      const st = await ops.status(r)
      const f = st.files.find((x) => x.path === p)
      return ops.diff(r, p, staged, untracked, staged ? f?.oldPath : undefined)
    },
    stage: (r, p) => ops.stage(r, p),
    unstage: (r, p) => ops.unstage(r, p),
    applyPatch: (r, p, m) => ops.applyPatch(r, p, m),
    discard: (r, p) => ops.discard(r, p),
    async commit(r, input) {
      const hash = await ops.commit(r, input)
      const s = settings.load()
      const msg = input.summary.trim()
      settings.save({ commitHistory: [msg, ...s.commitHistory.filter((m) => m !== msg)].slice(0, 50) })
      await impl.settings.saveDraft(r, null)
      return hash
    },
    lastCommitMessage: (r) => ops.lastCommitMessage(r),
    log: (r, q) => ops.log(r, q),
    commitFiles: (r, h) => ops.commitFiles(r, h),
    commitDiff: (r, h, p) => ops.commitDiff(r, h, p),
    branches: (r) => ops.branches(r),
    createBranch: (r, n, s, c) => ops.createBranch(r, n, s, c),
    renameBranch: (r, o, n) => ops.renameBranch(r, o, n),
    deleteBranch: (r, n, f, rt) =>
      ops.deleteBranch(r, n, f, rt, async (remote) => {
        const url = await ops.remoteUrl(r, remote)
        return url ? accounts.authFor(url) : null
      }),
    checkout: (r, b, c) => ops.checkout(r, b, c),
    checkoutCommit: (r, h) => ops.checkoutCommit(r, h),
    merge: (r, b, m) => ops.merge(r, b, m),
    rebase: (r, o) => ops.rebase(r, o),
    rebaseInteractive: (r, b, t) => ops.rebaseInteractive(r, b, t),
    continueOp: (r) => ops.continueOp(r),
    abortOp: (r) => ops.abortOp(r),
    skipOp: (r) => ops.skipOp(r),
    cherryPick: (r, h) => ops.cherryPick(r, h),
    revert: (r, h) => ops.revert(r, h),
    reset: (r, h, m) => ops.reset(r, h, m),
    stashList: (r) => ops.stashList(r),
    stashPush: (r, m, u) => ops.stashPush(r, m, u),
    stashApply: (r, ref, pop) => ops.stashApply(r, ref, pop),
    stashDrop: (r, ref) => ops.stashDrop(r, ref),
    stashDiff: (r, ref) => ops.stashDiff(r, ref),
    tags: (r) => ops.tags(r),
    createTag: (r, n, h, m) => ops.createTag(r, n, h, m),
    deleteTag: (r, n, rt) => ops.deleteTag(r, n, rt),
    pushTag: (r, n) => ops.pushTag(r, n),
    remotes: (r) => ops.remotes(r),
    addRemote: async (r, n, u) => void (await git(r, ['remote', 'add', n, u])),
    removeRemote: async (r, n) => void (await git(r, ['remote', 'remove', n])),
    setRemoteUrl: async (r, n, u) => void (await git(r, ['remote', 'set-url', n, u])),
    fetch: (r) => ops.fetchAll(r),
    pull: (r, m) => ops.pull(r, m),
    async push(r, o) {
      try {
        await ops.push(r, o)
        const s = settings.load()
        if (s.pendingPush.includes(r)) settings.save({ pendingPush: s.pendingPush.filter((x) => x !== r) })
      } catch (e) {
        if (e instanceof AppError && e.code === 'NETWORK') {
          const s = settings.load()
          if (!s.pendingPush.includes(r)) settings.save({ pendingPush: [...s.pendingPush, r] })
        }
        throw e
      }
    },
    conflict: (r, p) => ops.conflict(r, p),
    resolve: (r, p, h, c) => ops.resolveConflict(r, p, h, c),
    readGitignore: (r) => ops.readGitignore(r),
    writeGitignore: (r, c) => ops.writeGitignore(r, c),
    ignorePath: (r, p) => ops.ignorePath(r, p),
    config: (r) => ops.getConfig(r || homedir()),
    releaseNotes: (r, tag) => ops.releaseNotes(r, tag),
    setConfig: (r, n, e) => ops.setConfig(r, n, e)
  },
  accounts: {
    async list() {
      return accounts.list()
    },
    async providers() {
      return Object.values(providers).map((p) => p.info)
    },
    addToken: (p, t) => accounts.addToken(p, t),
    startDeviceFlow: (p) => accounts.startDeviceFlow(p),
    finishDeviceFlow: (p, i) => accounts.finishDeviceFlow(p, i),
    async remove(id, revoke) {
      const a = accounts.get(id)
      accounts.remove(id)
      if (revoke) {
        const info = providers[a.provider].info
        const url =
          a.provider === 'github'
            ? a.authMethod === 'oauth'
              ? 'https://github.com/settings/applications'
              : 'https://github.com/settings/tokens'
            : info.tokenUrl
        await shell.openExternal(url)
      }
    },
    async setActive(id) {
      accounts.get(id)
      settings.save({ activeAccountId: id })
    }
  },
  hosting: {
    async releases(ref) {
      return prov(ref).releases(tok(ref), ref.owner, ref.repo)
    },
    async createRelease(ref, input, files, repoPath) {
      if (repoPath && !ref.originOwner && !input.draft && (await ops.hasTag(repoPath, input.tag)))
        await ops.pushTag(repoPath, input.tag)
      const p = prov(ref)
      const r = await p.createRelease(tok(ref), ref.owner, ref.repo, input)
      if (!files.length) return r
      await uploadFiles(ref, r, files)
      return p.release(tok(ref), ref.owner, ref.repo, r.id)
    },
    async updateRelease(ref, id, patch) {
      return prov(ref).updateRelease(tok(ref), ref.owner, ref.repo, id, patch)
    },
    async deleteRelease(ref, id) {
      await prov(ref).deleteRelease(tok(ref), ref.owner, ref.repo, id)
    },
    async uploadAssets(ref, releaseId, files) {
      const p = prov(ref)
      const r = await p.release(tok(ref), ref.owner, ref.repo, releaseId)
      await uploadFiles(ref, r, files)
      return p.release(tok(ref), ref.owner, ref.repo, releaseId)
    },
    async deleteAsset(ref, releaseId, assetId) {
      await prov(ref).deleteAsset(tok(ref), ref.owner, ref.repo, releaseId, assetId)
    },
    async downloadAssets(ref, assets, dir) {
      const p = prov(ref)
      const paths: string[] = []
      for (let i = 0; i < assets.length; i++) {
        const label = `${i + 1}/${assets.length} ${assets[i].name}`
        emit({ type: 'transfer', label, percent: 0 })
        const res = await p.download(tok(ref), assets[i])
        const path = await uniquePath(dir, basename(assets[i].name))
        await saveResponse(res, path, label)
        paths.push(path)
      }
      return paths
    },
    async copyRelease(from, releaseId, to, opts) {
      const src = prov(from)
      const dst = prov(to)
      const same =
        accounts.get(from.accountId).provider === accounts.get(to.accountId).provider &&
        from.owner.toLowerCase() === to.owner.toLowerCase() &&
        from.repo.toLowerCase() === to.repo.toLowerCase()
      if (same) throw new AppError('SAME_REPO', `${to.owner}/${to.repo}`)
      const rel = await src.release(tok(from), from.owner, from.repo, releaseId)
      await ensureRemoteTag(to, rel.tag, opts.repoPath)
      const created = await dst.createRelease(tok(to), to.owner, to.repo, {
        tag: rel.tag,
        name: rel.name,
        body: rel.body,
        draft: opts.draft || rel.draft,
        prerelease: rel.prerelease
      })
      if (opts.assets) {
        const n = rel.assets.length
        for (let i = 0; i < n; i++) {
          const a = rel.assets[i]
          emit({ type: 'transfer', label: `${i + 1}/${n} ${a.name}`, percent: Math.round((i / n) * 100) })
          const res = await src.download(tok(from), a)
          const data = new Uint8Array(await res.arrayBuffer())
          await dst.uploadAsset(tok(to), to.owner, to.repo, created, a.name, data, a.contentType ?? mimeFor(a.name))
        }
      }
      return dst.release(tok(to), to.owner, to.repo, created.id)
    },
    async repos(accountId) {
      return prov({ accountId }).repos(tok({ accountId }))
    },
    async repoForPath(repoPath) {
      const rs = await ops.remotes(repoPath)
      const origin = rs.find((r) => r.name === 'origin') ?? rs[0]
      if (!origin) return null
      const o = parseRemoteUrl(origin.fetchUrl)
      if (!o) return null
      const p = providerForHost(o.host)
      if (!p) return null
      const up = rs.find((r) => r.name === 'upstream')
      const u = up ? parseRemoteUrl(up.fetchUrl) : null
      const target = u && providerForHost(u.host) === p ? u : o
      const acc = accounts.accountForProvider(p, o.owner)
      if (!acc) return null
      const ref: RepoRef = { accountId: acc.id, owner: target.owner, repo: target.repo }
      if (target !== o) ref.originOwner = o.owner
      return ref
    },
    async createRepo(accountId, input) {
      return prov({ accountId }).createRepo(tok({ accountId }), input)
    },
    async publish(repoPath, accountId, input) {
      const rs = await ops.remotes(repoPath)
      if (rs.some((r) => r.name === 'origin')) throw new AppError('REMOTE_EXISTS', 'origin')
      const repo = await prov({ accountId }).createRepo(tok({ accountId }), input)
      await git(repoPath, ['remote', 'add', 'origin', repo.cloneUrl])
      const st = await ops.status(repoPath)
      if (st.hasCommits) await ops.push(repoPath, { force: false, setUpstream: true })
      return repo
    },
    async deleteRepo(ref) {
      await prov(ref).deleteRepo(tok(ref), ref.owner, ref.repo)
    },
    async fork(ref) {
      return prov(ref).fork(tok(ref), ref.owner, ref.repo)
    },
    async forkAndClone(ref, dir) {
      const p = prov(ref)
      const original = await p.repo(tok(ref), ref.owner, ref.repo)
      const fork = await p.fork(tok(ref), ref.owner, ref.repo)
      await waitForRepo(ref.accountId, fork.owner, fork.name)
      const path = await impl.repos.clone(fork.cloneUrl, dir, ref.accountId)
      await git(path, ['remote', 'add', 'upstream', original.cloneUrl])
      try {
        await ops.fetchAll(path)
      } catch (e) {
        log('warn', `fetch upstream failed: ${String(e)}`)
      }
      return path
    },
    async forkCurrent(repoPath, ref) {
      const p = prov(ref)
      const fork = await p.fork(tok(ref), ref.owner, ref.repo)
      await waitForRepo(ref.accountId, fork.owner, fork.name)
      const rs = await ops.remotes(repoPath)
      if (rs.some((r) => r.name === 'origin')) {
        if (!rs.some((r) => r.name === 'upstream')) await git(repoPath, ['remote', 'rename', 'origin', 'upstream'])
        else await git(repoPath, ['remote', 'remove', 'origin'])
      }
      await git(repoPath, ['remote', 'add', 'origin', fork.cloneUrl])
      await ops.fetchAll(repoPath)
    },
    async pulls(ref, state, mine) {
      const list = await prov(ref).pulls(tok(ref), ref.owner, ref.repo, state)
      if (!mine) return list
      const login = accounts.get(ref.accountId).login
      return list.filter((p) => p.author === login)
    },
    async myPulls(accountId, state) {
      return prov({ accountId }).searchMyPulls(tok({ accountId }), accounts.get(accountId).login, state)
    },
    pull: async (ref, n) => prov(ref).pull(tok(ref), ref.owner, ref.repo, n),
    pullFiles: async (ref, n) => prov(ref).pullFiles(tok(ref), ref.owner, ref.repo, n),
    pullComments: async (ref, n) => prov(ref).comments(tok(ref), ref.owner, ref.repo, n),
    createPull: async (ref, input) => prov(ref).createPull(tok(ref), ref.owner, ref.repo, input),
    mergePull: async (ref, n, m) => prov(ref).mergePull(tok(ref), ref.owner, ref.repo, n, m),
    reviewPull: async (ref, n, e, b) => prov(ref).reviewPull(tok(ref), ref.owner, ref.repo, n, e, b),
    async issues(ref, state, mine) {
      const creator = mine ? accounts.get(ref.accountId).login : undefined
      return prov(ref).issues(tok(ref), ref.owner, ref.repo, state, creator)
    },
    createIssue: async (ref, input) => prov(ref).createIssue(tok(ref), ref.owner, ref.repo, input),
    setIssueState: async (ref, n, state) => prov(ref).updateIssue(tok(ref), ref.owner, ref.repo, n, { state }),
    setIssueLabels: async (ref, n, labels) => prov(ref).updateIssue(tok(ref), ref.owner, ref.repo, n, { labels }),
    issueComments: async (ref, n) => prov(ref).comments(tok(ref), ref.owner, ref.repo, n),
    addComment: async (ref, n, body) => prov(ref).addComment(tok(ref), ref.owner, ref.repo, n, body),
    labels: async (ref) => prov(ref).labels(tok(ref), ref.owner, ref.repo),
    notifications: async (accountId) => prov({ accountId }).notifications(tok({ accountId })),
    markNotificationRead: async (accountId, id) => prov({ accountId }).markNotificationRead(tok({ accountId }), id)
  }
}

export function registerIpc(): void {
  ipcMain.handle('api', async (_e, method: string, args: unknown[]): Promise<ApiResult<unknown>> => {
    const [ns, fn] = method.split('.')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const target = (impl as any)[ns]?.[fn]
    if (typeof target !== 'function')
      return { ok: false, error: { code: 'NO_METHOD', message: method } }
    try {
      const value = await target(...args)
      return { ok: true, value }
    } catch (e) {
      const err = e as AppError
      const code = err instanceof AppError ? err.code : 'INTERNAL'
      log(code === 'INTERNAL' ? 'error' : 'warn', `${method}: ${code} ${err.message} ${err.details ?? ''}`)
      return {
        ok: false,
        error: { code, message: mask(String(err.message ?? e)), details: err.details ? mask(err.details) : undefined }
      }
    }
  })
}
