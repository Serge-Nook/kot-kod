import { create } from 'zustand'
import { api, ApiCallError } from './lib/api'
import type { RepoRef } from '@shared/api'
import type {
  Account,
  AppInfo,
  Branch,
  GitProgress,
  ProviderInfo,
  RepoStatus,
  Settings
} from '@shared/types'

export type View =
  | 'changes'
  | 'history'
  | 'branches'
  | 'stash'
  | 'tags'
  | 'pulls'
  | 'issues'
  | 'notifications'
  | 'repo'
  | 'accounts'
  | 'settings'
  | 'help'

export interface Toast {
  id: number
  kind: 'info' | 'error' | 'success'
  text: string
  details?: string
  action?: { label: string; run: () => void }
}

export type DialogName =
  | 'clone'
  | 'create'
  | 'publish'
  | 'newBranch'
  | 'pushRejected'
  | 'about'
  | 'createPull'
  | 'createIssue'
  | 'rebase'
  | 'tag'
  | 'addAccount'
  | 'unlock'
  | 'confirm'
  | 'prompt'
  | 'update'

export interface DialogState {
  name: DialogName
  props?: Record<string, unknown>
}

interface State {
  settings: Settings | null
  info: AppInfo | null
  accounts: Account[]
  providers: ProviderInfo[]
  repo: string | null
  status: RepoStatus | null
  branches: Branch[]
  hostRef: RepoRef | null
  view: View
  toasts: Toast[]
  progress: GitProgress | null
  busy: string | null
  dialog: DialogState | null
  online: boolean
  unread: number
  revision: number
}

let toastId = 1

export const useStore = create<State>(() => ({
  settings: null,
  info: null,
  accounts: [],
  providers: [],
  repo: null,
  status: null,
  branches: [],
  hostRef: null,
  view: 'changes',
  toasts: [],
  progress: null,
  busy: null,
  dialog: null,
  online: navigator.onLine,
  unread: 0,
  revision: 0
}))

const set = useStore.setState
const get = useStore.getState

export function toast(kind: Toast['kind'], text: string, details?: string, action?: Toast['action']): void {
  const id = toastId++
  set({ toasts: [...get().toasts, { id, kind, text, details, action }] })
  setTimeout(() => dismissToast(id), kind === 'error' ? 12000 : 5000)
}

export function dismissToast(id: number): void {
  set({ toasts: get().toasts.filter((t) => t.id !== id) })
}

export function openDialog(name: DialogName, props?: Record<string, unknown>): void {
  set({ dialog: { name, props } })
}

export function closeDialog(): void {
  set({ dialog: null })
}

export function setView(view: View): void {
  set({ view })
}

export async function loadAll(): Promise<void> {
  const [settings, info, accounts, providers] = await Promise.all([
    api.settings.get(),
    api.app.info(),
    api.accounts.list(),
    api.accounts.providers()
  ])
  set({ settings, info, accounts, providers })
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const s = await api.settings.set(patch)
  set({ settings: s })
}

export async function reloadAccounts(): Promise<void> {
  set({ accounts: await api.accounts.list(), settings: await api.settings.get() })
  const repo = get().repo
  if (repo) set({ hostRef: await api.hosting.repoForPath(repo).catch(() => null) })
}

export async function openRepo(path: string): Promise<void> {
  try {
    const top = await api.repos.add(path)
    set({ repo: top, status: null, branches: [], hostRef: null, view: 'changes' })
    set({ settings: await api.settings.get() })
    await refresh()
    api.hosting
      .repoForPath(top)
      .then((hostRef) => set({ hostRef }))
      .catch(() => set({ hostRef: null }))
  } catch (e) {
    showError(e)
  }
}

export function closeRepo(): void {
  set({ repo: null, status: null, branches: [], hostRef: null })
}

let refreshing = false
export async function refresh(): Promise<void> {
  const repo = get().repo
  if (!repo || refreshing) return
  refreshing = true
  try {
    const [status, branches] = await Promise.all([api.git.status(repo), api.git.branches(repo)])
    if (get().repo === repo) set({ status, branches, revision: get().revision + 1 })
  } catch (e) {
    if (e instanceof ApiCallError && (e.code === 'NOT_A_REPO' || e.code === 'PATH_NOT_FOUND')) {
      closeRepo()
    }
    showError(e)
  } finally {
    refreshing = false
  }
}

export function errorText(e: unknown): { text: string; details?: string } {
  // lazy import to avoid a cycle
  const { t, hasKey } = i18nRef
  if (e instanceof ApiCallError) {
    const key = `err.${e.code}`
    const text = hasKey(key) ? t(key) : e.message || e.code
    const details = e.details ?? (hasKey(key) ? e.message : undefined)
    return { text, details }
  }
  return { text: String((e as Error)?.message ?? e) }
}

export const i18nRef: { t: (k: string, p?: Record<string, string | number>) => string; hasKey: (k: string) => boolean } = {
  t: (k) => k,
  hasKey: () => false
}

export function showError(e: unknown): void {
  const { text, details } = errorText(e)
  toast('error', text, details)
}

/** Runs an operation with a busy indicator; refreshes repo state afterwards. */
export async function run<T>(label: string, fn: () => Promise<T>, opts: { quiet?: boolean; refresh?: boolean } = {}): Promise<T | undefined> {
  set({ busy: label })
  try {
    const r = await fn()
    return r
  } catch (e) {
    if (!opts.quiet) showError(e)
    throw e
  } finally {
    set({ busy: null, progress: null })
    if (opts.refresh !== false) await refresh()
  }
}

/** Same as run() but swallows the error after showing it. */
export async function attempt<T>(label: string, fn: () => Promise<T>, opts: { refresh?: boolean } = {}): Promise<T | undefined> {
  try {
    return await run(label, fn, opts)
  } catch {
    return undefined
  }
}
