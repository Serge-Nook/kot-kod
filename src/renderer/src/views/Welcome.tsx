import { useEffect, useState } from 'react'
import type { RepoSummary } from '@shared/types'
import { api } from '../lib/api'
import { openDialog, openRepo, useStore } from '../store'
import { relativeDate, useT } from '../i18n'
import { Icon, showMenu } from '../components/ui'

export default function Welcome() {
  const t = useT()
  const recent = useStore((s) => s.settings?.recentRepos ?? [])
  const info = useStore((s) => s.info)
  const accounts = useStore((s) => s.accounts)
  const [sums, setSums] = useState<Record<string, RepoSummary>>({})
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (!recent.length) return
    api.repos
      .summaries(recent.map((r) => r.path))
      .then((l) => setSums(Object.fromEntries(l.map((s) => [s.path, s]))))
      .catch(() => undefined)
  }, [recent])

  const addExisting = async () => {
    const d = await api.app.pickDirectory(t('welcome.add'))
    if (d) openRepo(d)
  }
  const f = filter.toLowerCase()

  return (
    <div className="welcome">
      <h1 style={{ marginBottom: 4 }}>{t('welcome.title')}</h1>
      <div className="muted">{t('welcome.subtitle')}</div>
      {info && !info.gitOk && <div className="banner error" style={{ marginTop: 12 }}>{t('err.GIT_MISSING')}</div>}
      {!accounts.length && (
        <div className="banner info" style={{ marginTop: 12 }}>
          <span className="grow">{t('welcome.signInHint')}</span>
          <button className="primary" onClick={() => openDialog('addAccount')}>
            {t('accounts.add')}
          </button>
        </div>
      )}
      <div className="cards">
        <button className="card" onClick={() => openDialog('clone')}>
          <Icon name="down" size={22} />
          <h3>{t('welcome.clone')}</h3>
          <div className="muted small">{t('welcome.cloneHint')}</div>
        </button>
        <button className="card" onClick={() => openDialog('create')}>
          <Icon name="plus" size={22} />
          <h3>{t('welcome.create')}</h3>
          <div className="muted small">{t('welcome.createHint')}</div>
        </button>
        <button className="card" onClick={addExisting}>
          <Icon name="folder" size={22} />
          <h3>{t('welcome.add')}</h3>
          <div className="muted small">{t('welcome.addHint')}</div>
        </button>
      </div>
      {recent.length > 0 && (
        <>
          <div className="row">
            <h3 className="grow">{t('welcome.recent')}</h3>
            <input placeholder={t('common.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div className="section" style={{ padding: 0, gap: 0 }}>
            {recent
              .filter((r) => r.name.toLowerCase().includes(f) || r.path.toLowerCase().includes(f))
              .map((r) => {
                const s = sums[r.path]
                return (
                  <div
                    key={r.path}
                    className="list-item"
                    onClick={() => openRepo(r.path)}
                    style={{ opacity: s && !s.exists ? 0.5 : 1 }}
                    onContextMenu={(e) =>
                      showMenu(e, [
                        { label: t('welcome.open'), onClick: () => openRepo(r.path) },
                        { label: t('repo.openFolder'), onClick: () => api.app.openPath(r.path) },
                        { label: t('welcome.forget'), onClick: () => api.repos.remove(r.path).then(async () => useStore.setState({ settings: await api.settings.get() })) }
                      ])
                    }
                  >
                    <Icon name="repo" />
                    <span className="grow">
                      <b>{r.name}</b>
                      <div className="small muted mono">{r.path}</div>
                    </span>
                    {s && !s.exists && <span className="pill closed">{t('welcome.missing')}</span>}
                    {s?.exists && (
                      <span className="small muted">
                        {s.branch} {s.changes > 0 && `· ${t('welcome.changes', { n: s.changes })}`} {s.ahead > 0 && `↑${s.ahead}`} {s.behind > 0 && `↓${s.behind}`}
                      </span>
                    )}
                    <span className="small muted" style={{ width: 100, textAlign: 'right' }}>
                      {relativeDate(r.lastOpened)}
                    </span>
                  </div>
                )
              })}
          </div>
        </>
      )}
    </div>
  )
}
