import { useEffect, useState } from 'react'
import { api, ApiCallError, onEvent } from './lib/api'
import {
  attempt,
  closeRepo,
  i18nRef,
  loadAll,
  openDialog,
  openRepo,
  refresh,
  run,
  setView,
  showError,
  toast,
  updateSettings,
  useStore,
  type View
} from './store'
import { hasKey, setLanguage, t, useT } from './i18n'
import { Icon, MenuHost, Progress, Toasts, showMenu } from './components/ui'
import { ModalHost } from './components/dialogs/common'
import { DialogHost } from './components/dialogs/DialogHost'
import { keyCombo } from './views/Settings'
import Welcome from './views/Welcome'
import Changes from './views/Changes'
import History from './views/History'
import Branches from './views/Branches'
import Stash from './views/Stash'
import Tags from './views/Tags'
import Pulls from './views/Pulls'
import Issues from './views/Issues'
import Notifications from './views/Notifications'
import RepoSettings from './views/RepoSettings'
import Accounts from './views/Accounts'
import SettingsView from './views/Settings'
import Help from './views/Help'

i18nRef.t = t
i18nRef.hasKey = hasKey

const REPO_VIEWS: { id: View; icon: string; key: string }[] = [
  { id: 'changes', icon: 'changes', key: 'nav.changes' },
  { id: 'history', icon: 'history', key: 'nav.history' },
  { id: 'branches', icon: 'branch', key: 'nav.branches' },
  { id: 'stash', icon: 'stash', key: 'nav.stash' },
  { id: 'tags', icon: 'tag', key: 'nav.tags' },
  { id: 'pulls', icon: 'pull', key: 'nav.pulls' },
  { id: 'issues', icon: 'issue', key: 'nav.issues' },
  { id: 'repo', icon: 'repo', key: 'nav.repo' }
]
const GLOBAL_VIEWS: { id: View; icon: string; key: string }[] = [
  { id: 'notifications', icon: 'bell', key: 'nav.notifications' },
  { id: 'accounts', icon: 'user', key: 'nav.accounts' },
  { id: 'settings', icon: 'gear', key: 'nav.settings' },
  { id: 'help', icon: 'help', key: 'nav.help' }
]

export async function doPush(): Promise<void> {
  const { repo, status } = useStore.getState()
  if (!repo || !status) return
  try {
    await run(t('busy.push'), () => api.git.push(repo, { force: false, setUpstream: !status.upstream }), { quiet: true })
    toast('success', t('push.done'))
  } catch (e) {
    if (e instanceof ApiCallError && e.code === 'PUSH_REJECTED') openDialog('pushRejected')
    else if (e instanceof ApiCallError && e.code === 'NO_REMOTE') openDialog('publish')
    else showError(e)
  }
}

export async function doPull(): Promise<void> {
  const repo = useStore.getState().repo
  if (!repo) return
  const r = await attempt(t('busy.pull'), () => api.git.pull(repo, 'merge'))
  if (r !== undefined) toast('success', t('pull.done'))
}

export async function doFetch(quiet = false): Promise<void> {
  const repo = useStore.getState().repo
  if (!repo) return
  if (quiet) {
    await api.git.fetch(repo).catch(() => undefined)
    await refresh()
    return
  }
  await attempt(t('busy.fetch'), () => api.git.fetch(repo))
}

function applyTheme(theme: string, accent: string): void {
  const root = document.documentElement
  const dark = theme === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches : theme === 'dark'
  root.classList.toggle('light', !dark)
  root.classList.toggle('accent-forest', accent === 'forest')
}

function TopBar() {
  const t = useT()
  const repo = useStore((s) => s.repo)
  const status = useStore((s) => s.status)
  const branches = useStore((s) => s.branches)
  const recent = useStore((s) => s.settings?.recentRepos ?? [])
  const busy = useStore((s) => s.busy)
  const online = useStore((s) => s.online)
  const unread = useStore((s) => s.unread)
  const [pop, setPop] = useState<'repo' | 'branch' | null>(null)
  const [filter, setFilter] = useState('')
  useEffect(() => setFilter(''), [pop])

  const sync = () => {
    if (!status) return
    if (!status.upstream) return doPush()
    if (status.behind > 0) return doPull()
    if (status.ahead > 0) return doPush()
    return doFetch()
  }
  let syncLabel = t('sync.fetch')
  let syncIcon = 'sync'
  if (status && !status.upstream) {
    syncLabel = t('sync.publishBranch')
    syncIcon = 'up'
  } else if (status && status.behind > 0) {
    syncLabel = t('sync.pull', { n: status.behind })
    syncIcon = 'down'
  } else if (status && status.ahead > 0) {
    syncLabel = t('sync.push', { n: status.ahead })
    syncIcon = 'up'
  }
  const f = filter.toLowerCase()
  const checkout = (name: string) => {
    setPop(null)
    attempt(t('busy.checkout'), () => api.git.checkout(repo!, name, 'keep'))
  }

  return (
    <div className="topbar" style={{ position: 'relative' }}>
      <button className="tb-item" onClick={() => setPop(pop === 'repo' ? null : 'repo')}>
        <span className="lbl">{t('top.repo')}</span>
        <span className="val">{repo ? repo.split('/').pop() : t('top.noRepo')} ▾</span>
      </button>
      {repo && (
        <button className="tb-item" onClick={() => setPop(pop === 'branch' ? null : 'branch')}>
          <span className="lbl">{status?.detached ? t('top.detached') : t('top.branch')}</span>
          <span className="val">{status?.detached ? status.headOid?.slice(0, 8) : status?.branch ?? '…'} ▾</span>
        </button>
      )}
      {repo && (
        <button className="tb-item" onClick={sync} disabled={!!busy} title={status?.upstream ?? ''}>
          <span className="lbl">{busy ?? (online ? t('top.sync') : t('top.offline'))}</span>
          <span className="val row">
            <Icon name={syncIcon} size={14} /> {syncLabel}
          </span>
        </button>
      )}
      <span className="tb-spacer" />
      <div className="tb-right">
        {repo && (
          <>
            <button className="icon" title={t('top.terminal')} onClick={() => api.app.openTerminal(repo)}>
              <Icon name="terminal" />
            </button>
            <button className="icon" title={t('repo.openFolder')} onClick={() => api.app.openPath(repo)}>
              <Icon name="folder" />
            </button>
            <button
              className="icon"
              title={t('top.more')}
              onClick={(e) =>
                showMenu(e, [
                  { label: t('sync.fetch'), onClick: () => doFetch() },
                  { label: t('top.pull'), onClick: () => doPull() },
                  { label: t('top.pullRebase'), onClick: () => attempt(t('busy.pull'), () => api.git.pull(repo, 'rebase')) },
                  { label: t('top.push'), onClick: () => doPush() },
                  { sep: true },
                  { label: t('stash.save'), onClick: () => attempt(t('busy.stash'), () => api.git.stashPush(repo, '', true)) },
                  { label: t('pulls.create'), onClick: () => openDialog('createPull') },
                  { label: t('publish.title'), onClick: () => openDialog('publish') },
                  { sep: true },
                  { label: t('top.closeRepo'), onClick: closeRepo }
                ])
              }
            >
              ⋯
            </button>
          </>
        )}
        <button className="icon" title={t('nav.notifications')} onClick={() => setView('notifications')}>
          <Icon name="bell" /> {unread > 0 && <span className="badge">{unread}</span>}
        </button>
      </div>
      {pop && <div style={{ position: 'fixed', inset: 0, zIndex: 39 }} onClick={() => setPop(null)} />}
      {pop === 'repo' && (
        <div className="popover" style={{ left: 0 }}>
          <div className="pane-header">
            <input autoFocus className="grow" placeholder={t('common.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div className="scroll">
            {recent
              .filter((r) => r.name.toLowerCase().includes(f))
              .map((r) => (
                <div
                  key={r.path}
                  className={`list-item ${r.path === repo ? 'selected' : ''}`}
                  onClick={() => {
                    setPop(null)
                    openRepo(r.path)
                  }}
                >
                  <Icon name="repo" />
                  <span className="grow">
                    {r.name}
                    <div className="small muted mono">{r.path}</div>
                  </span>
                </div>
              ))}
          </div>
          <div className="pane-header">
            <button onClick={() => (setPop(null), openDialog('clone'))}>{t('welcome.clone')}</button>
            <button onClick={() => (setPop(null), openDialog('create'))}>{t('welcome.create')}</button>
            <button
              onClick={async () => {
                setPop(null)
                const d = await api.app.pickDirectory(t('welcome.add'))
                if (d) openRepo(d)
              }}
            >
              {t('welcome.add')}
            </button>
          </div>
        </div>
      )}
      {pop === 'branch' && (
        <div className="popover" style={{ left: 170 }}>
          <div className="pane-header">
            <input autoFocus className="grow" placeholder={t('branches.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button className="primary" onClick={() => (setPop(null), openDialog('newBranch'))}>
              {t('branches.new')}
            </button>
          </div>
          <div className="scroll">
            {branches
              .filter((b) => !b.name.endsWith('/HEAD') && b.name.toLowerCase().includes(f))
              .filter((b) => !b.remote || !branches.some((l) => !l.remote && l.upstream === b.name))
              .map((b) => (
                <div key={b.ref} className={`list-item ${b.current ? 'selected' : ''}`} onClick={() => !b.current && checkout(b.remote ? b.name.replace(/^[^/]+\//, '') : b.name)}>
                  <Icon name="branch" />
                  <span className="grow">{b.remote ? <span className="ref-badge remote">{b.name}</span> : b.name}</span>
                  {!b.remote && b.upstream && (
                    <span className="small muted">
                      ↑{b.ahead} ↓{b.behind}
                    </span>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Nav() {
  const t = useT()
  const view = useStore((s) => s.view)
  const repo = useStore((s) => s.repo)
  const status = useStore((s) => s.status)
  const unread = useStore((s) => s.unread)
  const item = (v: { id: View; icon: string; key: string }) => (
    <button key={v.id} className={view === v.id ? 'active' : ''} onClick={() => setView(v.id)} title={t(v.key)}>
      <Icon name={v.icon} />
      <span className="grow">{t(v.key)}</span>
      {v.id === 'changes' && !!status?.files.length && <span className="badge muted">{status.files.length}</span>}
      {v.id === 'notifications' && unread > 0 && <span className="badge">{unread}</span>}
    </button>
  )
  return (
    <nav className="nav">
      {repo && REPO_VIEWS.map(item)}
      {repo && <div className="sep" />}
      {GLOBAL_VIEWS.map(item)}
    </nav>
  )
}

function Content() {
  const view = useStore((s) => s.view)
  const repo = useStore((s) => s.repo)
  switch (view) {
    case 'notifications':
      return <Notifications />
    case 'accounts':
      return <Accounts />
    case 'settings':
      return <SettingsView />
    case 'help':
      return <Help />
  }
  if (!repo) return <Welcome />
  switch (view) {
    case 'history':
      return <History />
    case 'branches':
      return <Branches />
    case 'stash':
      return <Stash />
    case 'tags':
      return <Tags />
    case 'pulls':
      return <Pulls />
    case 'issues':
      return <Issues />
    case 'repo':
      return <RepoSettings />
    default:
      return <Changes />
  }
}

export default function App() {
  const settings = useStore((s) => s.settings)
  const repo = useStore((s) => s.repo)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    loadAll()
      .then(async () => {
        const s = useStore.getState().settings!
        setLanguage(s.language)
        const info = useStore.getState().info
        if (info?.secretsBackend === 'locked') openDialog('unlock')
        if (s.lastRepo) await openRepo(s.lastRepo)
        if (s.checkUpdates)
          api.app
            .checkUpdate()
            .then((u) => u.available && toast('info', t('update.available', { v: u.latest }), undefined, { label: t('update.details'), run: () => openDialog('update') }))
            .catch(() => undefined)
      })
      .catch(showError)
      .finally(() => setReady(true))
    const off = onEvent((e) => {
      if (e.type === 'progress' && e.repo === useStore.getState().repo) useStore.setState({ progress: e.progress })
      if (e.type === 'repo-changed' && e.repo === useStore.getState().repo) refresh()
      if (e.type === 'crash-recovered') toast('error', t('crash.recovered'), e.report, { label: t('help.report'), run: () => api.app.reportProblem() })
      if (e.type === 'update-downloaded') toast('success', t('update.downloaded'))
    })
    const online = () => {
      const on = navigator.onLine
      useStore.setState({ online: on })
      if (on) {
        const pending = useStore.getState().settings?.pendingPush ?? []
        if (pending.length) toast('info', t('offline.pending', { n: pending.length }), undefined, { label: t('top.push'), run: () => doPush() })
      }
    }
    window.addEventListener('online', online)
    window.addEventListener('offline', online)
    const focus = () => refresh()
    window.addEventListener('focus', focus)
    return () => {
      off()
      window.removeEventListener('online', online)
      window.removeEventListener('offline', online)
      window.removeEventListener('focus', focus)
    }
  }, [])

  useEffect(() => {
    if (!settings) return
    setLanguage(settings.language)
    applyTheme(settings.theme, settings.accent)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const h = () => applyTheme(settings.theme, settings.accent)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.language, settings?.theme, settings?.accent])

  useEffect(() => {
    const mins = settings?.autoFetchMinutes ?? 0
    if (!repo || !mins) return
    const id = setInterval(() => navigator.onLine && doFetch(true), mins * 60_000)
    return () => clearInterval(id)
  }, [repo, settings?.autoFetchMinutes])

  useEffect(() => {
    if (!settings) return
    const map = Object.fromEntries(Object.entries(settings.shortcuts).map(([k, v]) => [v, k]))
    const h = (e: KeyboardEvent) => {
      const action = map[keyCombo(e)]
      if (!action) return
      const tag = (e.target as HTMLElement)?.tagName
      if ((tag === 'INPUT' || tag === 'TEXTAREA') && !['commit', 'help', 'settings'].includes(action) && !e.ctrlKey) return
      e.preventDefault()
      const s = useStore.getState()
      const z = s.settings?.zoom ?? 1
      switch (action) {
        case 'commit':
          window.dispatchEvent(new Event('kotkod:commit'))
          break
        case 'push':
          doPush()
          break
        case 'pull':
          doPull()
          break
        case 'fetch':
          doFetch()
          break
        case 'newBranch':
          if (s.repo) openDialog('newBranch')
          break
        case 'changes':
        case 'history':
        case 'branches':
          if (s.repo) setView(action)
          break
        case 'openRepo':
          api.app.pickDirectory(t('welcome.add')).then((d) => void (d && openRepo(d)))
          break
        case 'clone':
          openDialog('clone')
          break
        case 'settings':
          setView('settings')
          break
        case 'help':
          setView('help')
          break
        case 'zoomIn':
          updateSettings({ zoom: Math.min(2, Math.round((z + 0.1) * 10) / 10) })
          break
        case 'zoomOut':
          updateSettings({ zoom: Math.max(1, Math.round((z - 0.1) * 10) / 10) })
          break
        case 'zoomReset':
          updateSettings({ zoom: 1 })
          break
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.shortcuts])

  if (!ready) return null
  return (
    <div className="app">
      <TopBar />
      <Progress />
      <div className="main">
        <Nav />
        <main className="content">
          <Content />
        </main>
      </div>
      <DialogHost />
      <ModalHost />
      <MenuHost />
      <Toasts />
    </div>
  )
}
