import { useEffect, useState } from 'react'
import type { Remote } from '@shared/types'
import { api } from '../lib/api'
import { attempt, closeRepo, openDialog, reloadAccounts, showError, toast, useStore } from '../store'
import { useT } from '../i18n'
import { confirmDialog, promptDialog } from '../components/dialogs/common'

export default function RepoSettings() {
  const t = useT()
  const repo = useStore((s) => s.repo)!
  const hostRef = useStore((s) => s.hostRef)
  const accounts = useStore((s) => s.accounts)
  const providers = useStore((s) => s.providers)
  const [remotes, setRemotes] = useState<Remote[]>([])
  const [gitignore, setGitignore] = useState('')
  const [templates, setTemplates] = useState<string[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    api.git.remotes(repo).then(setRemotes).catch(showError)
    api.git.readGitignore(repo).then(setGitignore).catch(() => setGitignore(''))
    api.git.config(repo).then((c) => {
      setName(c.name)
      setEmail(c.email)
    }).catch(() => undefined)
    api.settings.gitignoreTemplates().then(setTemplates).catch(() => undefined)
  }, [repo, tick])

  const addRemote = async () => {
    const n = await promptDialog({ title: t('repo.addRemote'), label: t('repo.remoteName'), value: remotes.length ? 'upstream' : 'origin' })
    if (!n) return
    const url = await promptDialog({ title: t('repo.addRemote'), label: t('repo.remoteUrl'), value: '' })
    if (!url) return
    await attempt(t('busy.save'), () => api.git.addRemote(repo, n, url))
    setTick(tick + 1)
    reloadAccounts()
  }
  const editRemote = async (r: Remote) => {
    const url = await promptDialog({ title: t('repo.editRemote', { name: r.name }), label: t('repo.remoteUrl'), value: r.fetchUrl })
    if (!url || url === r.fetchUrl) return
    await attempt(t('busy.save'), () => api.git.setRemoteUrl(repo, r.name, url))
    setTick(tick + 1)
    reloadAccounts()
  }
  const removeRemote = async (r: Remote) => {
    if (!(await confirmDialog({ title: t('repo.removeRemote'), text: t('repo.removeRemoteConfirm', { name: r.name }), ok: t('common.delete'), danger: true }))) return
    await attempt(t('busy.save'), () => api.git.removeRemote(repo, r.name))
    setTick(tick + 1)
    reloadAccounts()
  }
  const removeLocal = async () => {
    const r = await confirmDialog({ title: t('repo.remove'), text: t('repo.removeConfirm', { path: repo }), ok: t('repo.remove'), danger: true, check: t('repo.deleteFiles') })
    if (!r) return
    if (r === 'ok+check') await attempt(t('busy.delete'), () => api.repos.deleteLocal(repo), { refresh: false })
    else await api.repos.remove(repo)
    closeRepo()
  }
  const deleteRemote = async () => {
    if (!hostRef) return
    const full = `${hostRef.owner}/${hostRef.repo}`
    const typed = await promptDialog({ title: t('repo.deleteRemote'), label: t('repo.deleteRemoteConfirm', { name: full }), value: '' })
    if (typed !== full) {
      if (typed !== null) toast('error', t('repo.nameMismatch'))
      return
    }
    const ok = await attempt(t('busy.delete'), () => api.hosting.deleteRepo(hostRef).then(() => true), { refresh: false })
    if (ok) toast('success', t('repo.remoteDeleted', { name: full }))
  }
  const fork = async () => {
    if (!hostRef) return
    const ok = await attempt(t('busy.fork'), () => api.hosting.forkCurrent(repo, hostRef).then(() => true))
    if (ok) {
      toast('success', t('repo.forked'))
      setTick(tick + 1)
      reloadAccounts()
    }
  }
  const acc = accounts.find((a) => a.id === hostRef?.accountId)
  const caps = providers.find((p) => p.id === acc?.provider)?.capabilities

  return (
    <div className="page">
      <h2>{t('nav.repo')}</h2>
      <div className="section">
        <h3>{t('repo.remotes')}</h3>
        {!remotes.length && (
          <div className="row">
            <span className="muted grow">{t('repo.noRemotes')}</span>
            <button className="primary" onClick={() => openDialog('publish')}>
              {t('publish.title')}
            </button>
          </div>
        )}
        {remotes.map((r) => (
          <div key={r.name} className="row">
            <b style={{ width: 90 }}>{r.name}</b>
            <span className="mono small grow">{r.fetchUrl}</span>
            <button onClick={() => editRemote(r)}>{t('common.edit')}</button>
            <button onClick={() => removeRemote(r)}>{t('common.delete')}</button>
          </div>
        ))}
        <div className="row">
          <button onClick={addRemote}>{t('repo.addRemote')}</button>
          {hostRef && caps?.fork && acc && hostRef.owner !== acc.login && !remotes.some((r) => r.name === 'upstream') && (
            <button onClick={fork}>{t('repo.fork')}</button>
          )}
        </div>
        {hostRef && (
          <div className="small muted">
            {t('repo.linked', { name: `${hostRef.owner}/${hostRef.repo}`, account: acc ? `${acc.login} (${acc.provider})` : '—' })}
          </div>
        )}
      </div>
      <div className="section">
        <h3>{t('repo.identity')}</h3>
        <div className="small muted">{t('repo.identityHint')}</div>
        <div className="grid2">
          <span>{t('settings.gitName')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
          <span>{t('settings.gitEmail')}</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <button onClick={() => attempt(t('busy.save'), () => api.git.setConfig(repo, name, email), { refresh: false }).then(() => toast('success', t('settings.saved')))}>
            {t('common.save')}
          </button>
        </div>
      </div>
      <div className="section">
        <h3>.gitignore</h3>
        <div className="row">
          <select
            className="grow"
            value=""
            onChange={async (e) => {
              const name = e.target.value
              if (!name) return
              const text = await api.settings.gitignoreTemplate(name).catch(() => '')
              setGitignore((g) => `${g}${g && !g.endsWith('\n') ? '\n' : ''}\n# ${name}\n${text}`)
            }}
          >
            <option value="">{t('repo.addTemplate')}</option>
            {templates.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
          <button className="primary" onClick={() => attempt(t('busy.save'), () => api.git.writeGitignore(repo, gitignore)).then(() => toast('success', t('settings.saved')))}>
            {t('common.save')}
          </button>
        </div>
        <textarea className="mono" rows={12} value={gitignore} onChange={(e) => setGitignore(e.target.value)} spellCheck={false} />
      </div>
      <div className="section">
        <h3>{t('repo.danger')}</h3>
        <div className="row wrap">
          <button onClick={() => api.app.openTerminal(repo)}>{t('repo.openTerminal')}</button>
          <button onClick={() => api.app.openPath(repo)}>{t('repo.openFolder')}</button>
          <button className="danger" onClick={removeLocal}>
            {t('repo.remove')}
          </button>
          {hostRef && caps?.deleteRepo && (
            <button className="danger" onClick={deleteRemote}>
              {t('repo.deleteRemote')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
