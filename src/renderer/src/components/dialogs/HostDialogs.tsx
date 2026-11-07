import { useEffect, useRef, useState } from 'react'
import type { DeviceCodeInfo, Label, ProviderId, UpdateInfo } from '@shared/types'
import { api, ApiCallError } from '../../lib/api'
import { attempt, closeDialog, errorText, loadAll, reloadAccounts, toast, useStore } from '../../store'
import { useT } from '../../i18n'
import { Dialog, Field, copyText } from '../ui'

export function CreatePullDialog() {
  const t = useT()
  const ref = useStore((s) => s.hostRef)
  const status = useStore((s) => s.status)
  const branches = useStore((s) => s.branches)
  const repo = useStore((s) => s.repo)!
  const accounts = useStore((s) => s.accounts)
  const providers = useStore((s) => s.providers)
  const caps = providers.find((p) => p.id === accounts.find((a) => a.id === ref?.accountId)?.provider)?.capabilities
  const remoteBranches = branches.filter((b) => b.remote && !b.name.endsWith('/HEAD')).map((b) => b.name.replace(/^[^/]+\//, ''))
  const defaultBase = remoteBranches.includes('main') ? 'main' : remoteBranches.includes('master') ? 'master' : remoteBranches[0] ?? 'main'
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [base, setBase] = useState(defaultBase)
  const [draft, setDraft] = useState(false)
  const [reviewers, setReviewers] = useState('')
  const [labels, setLabels] = useState<Label[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const head = status?.branch ?? ''
  useEffect(() => {
    if (!ref) return
    api.hosting.labels(ref).then(setLabels).catch(() => undefined)
    api.git
      .log(repo, { limit: 1 })
      .then((c) => c[0] && setTitle((x) => x || c[0].subject))
      .catch(() => undefined)
  }, [ref, repo])
  if (!ref)
    return (
      <Dialog title={t('pulls.create')}>
        <div>{t('hosting.noRemote')}</div>
      </Dialog>
    )
  const go = async () => {
    const r = await attempt(
      t('busy.pr'),
      async () => {
        if (!status?.upstream || status.ahead > 0) await api.git.push(repo, { force: false, setUpstream: !status?.upstream })
        return api.hosting.createPull(ref, {
          title,
          body,
          head,
          base,
          draft,
          reviewers: reviewers.split(/[\s,]+/).filter(Boolean),
          labels: picked
        })
      }
    )
    if (r) {
      closeDialog()
      toast('success', t('pulls.created', { n: r.number }), undefined, { label: t('common.openInBrowser'), run: () => api.app.openExternal(r.htmlUrl) })
    }
  }
  return (
    <Dialog
      title={t('pulls.create')}
      footer={
        <>
          <button onClick={closeDialog}>{t('common.cancel')}</button>
          <button className="primary" disabled={!title || !head || head === base} onClick={go}>
            {t('pulls.createBtn')}
          </button>
        </>
      }
    >
      <div className="row">
        <Field label={t('pulls.head')}>
          <input value={head} readOnly />
        </Field>
        <span style={{ paddingTop: 18 }}>→</span>
        <Field label={t('pulls.base')}>
          <select value={base} onChange={(e) => setBase(e.target.value)}>
            {[...new Set([defaultBase, ...remoteBranches])].map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </Field>
      </div>
      {ref.originOwner && ref.originOwner !== ref.owner && <div className="small muted">{t('pulls.fromFork', { fork: ref.originOwner, upstream: ref.owner })}</div>}
      {head === base && <div className="small" style={{ color: 'var(--danger)' }}>{t('pulls.sameBranch')}</div>}
      <Field label={t('pulls.titleField')}>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={t('pulls.body')}>
        <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <Field label={t('pulls.reviewers')}>
        <input value={reviewers} onChange={(e) => setReviewers(e.target.value)} placeholder="login1, login2" />
      </Field>
      {labels.length > 0 && (
        <div className="row wrap">
          {labels.map((l) => (
            <button
              key={l.name}
              className="pill"
              style={picked.includes(l.name) ? { borderColor: `#${l.color}`, background: `#${l.color}33`, color: 'var(--fg)' } : undefined}
              onClick={() => setPicked(picked.includes(l.name) ? picked.filter((x) => x !== l.name) : [...picked, l.name])}
            >
              {l.name}
            </button>
          ))}
        </div>
      )}
      {caps?.draftPull && (
        <label className="check">
          <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
          {t('pulls.asDraft')}
        </label>
      )}
    </Dialog>
  )
}

export function CreateIssueDialog({ onDone }: { onDone?: () => void }) {
  const t = useT()
  const ref = useStore((s) => s.hostRef)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  if (!ref) return null
  const go = async () => {
    const r = await attempt(t('busy.issue'), () => api.hosting.createIssue(ref, { title, body, labels: [] }), { refresh: false })
    if (r) {
      closeDialog()
      onDone?.()
      toast('success', t('issues.created', { n: r.number }))
    }
  }
  return (
    <Dialog
      title={t('issues.create')}
      footer={
        <>
          <button onClick={closeDialog}>{t('common.cancel')}</button>
          <button className="primary" disabled={!title} onClick={go}>
            {t('issues.createBtn')}
          </button>
        </>
      }
    >
      <Field label={t('pulls.titleField')}>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={t('pulls.body')}>
        <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
    </Dialog>
  )
}

export function AddAccountDialog() {
  const t = useT()
  const providers = useStore((s) => s.providers)
  const clientId = useStore((s) => s.settings?.githubClientId)
  const [provider, setProvider] = useState<ProviderId>('github')
  const [token, setToken] = useState('')
  const [device, setDevice] = useState<DeviceCodeInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const cancelled = useRef(false)
  const info = providers.find((p) => p.id === provider)
  useEffect(() => () => void (cancelled.current = true), [])

  const done = async (login: string) => {
    await reloadAccounts()
    closeDialog()
    toast('success', t('accounts.added', { login }))
  }
  const addToken = async () => {
    setBusy(true)
    setError(null)
    try {
      const a = await api.accounts.addToken(provider, token)
      await done(a.login)
    } catch (e) {
      setError(errorText(e).text)
    } finally {
      setBusy(false)
    }
  }
  const startOAuth = async () => {
    setError(null)
    try {
      const d = await api.accounts.startDeviceFlow(provider)
      setDevice(d)
      copyText(d.userCode)
      api.app.openExternal(d.verificationUri)
      const a = await api.accounts.finishDeviceFlow(provider, d)
      if (!cancelled.current) await done(a.login)
    } catch (e) {
      if (!cancelled.current) {
        setDevice(null)
        setError(errorText(e).text)
      }
    }
  }
  return (
    <Dialog title={t('accounts.add')} footer={<button onClick={closeDialog}>{t('common.cancel')}</button>}>
      <div className="tabs">
        {providers.map((p) => (
          <button key={p.id} className={provider === p.id ? 'active' : ''} onClick={() => (setProvider(p.id), setDevice(null), setError(null))}>
            {p.title}
          </button>
        ))}
      </div>
      {info?.capabilities.oauth && (
        <div className="section">
          <b>{t('accounts.oauthTitle')}</b>
          {device ? (
            <>
              <div>{t('accounts.deviceHint', { url: device.verificationUri })}</div>
              <div className="row">
                <span className="mono" style={{ fontSize: 22, letterSpacing: 3 }}>
                  {device.userCode}
                </span>
                <button onClick={() => copyText(device.userCode)}>{t('common.copy')}</button>
                <button onClick={() => api.app.openExternal(device.verificationUri)}>{t('common.openInBrowser')}</button>
              </div>
              <div className="small muted">{t('accounts.waiting')}</div>
            </>
          ) : clientId ? (
            <button className="primary" onClick={startOAuth}>
              {t('accounts.oauthBtn')}
            </button>
          ) : (
            <div className="small muted">{t('accounts.oauthNoClient')}</div>
          )}
        </div>
      )}
      <div className="section">
        <b>{t('accounts.tokenTitle')}</b>
        <div className="small muted">{t(`accounts.tokenHint.${provider}`)}</div>
        <div>
          <button className="link" onClick={() => info && api.app.openExternal(info.tokenUrl)}>
            {t('accounts.createToken', { host: info?.title ?? '' })}
          </button>
        </div>
        <Field label={t('accounts.token')}>
          <input type="password" autoFocus value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && token && addToken()} />
        </Field>
        <div>
          <button className="primary" disabled={!token.trim() || busy} onClick={addToken}>
            {busy ? t('common.checking') : t('accounts.signIn')}
          </button>
        </div>
      </div>
      {error && <div className="banner error">{error}</div>}
    </Dialog>
  )
}

export function UnlockDialog() {
  const t = useT()
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(false)
  const go = async () => {
    const ok = await api.app.unlockSecrets(pw).catch(() => false)
    if (!ok) return setErr(true)
    await loadAll()
    closeDialog()
  }
  return (
    <Dialog
      title={t('unlock.title')}
      footer={
        <>
          <button onClick={closeDialog}>{t('unlock.later')}</button>
          <button className="primary" disabled={!pw} onClick={go}>
            {t('unlock.btn')}
          </button>
        </>
      }
    >
      <div>{t('unlock.text')}</div>
      <Field label={t('unlock.password')}>
        <input type="password" autoFocus value={pw} onChange={(e) => (setPw(e.target.value), setErr(false))} onKeyDown={(e) => e.key === 'Enter' && go()} />
      </Field>
      {err && <div className="banner error">{t('unlock.wrong')}</div>}
    </Dialog>
  )
}

export function UpdateDialog() {
  const t = useT()
  const [u, setU] = useState<UpdateInfo | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [dl, setDl] = useState(false)
  useEffect(() => {
    api.app.checkUpdate().then(setU).catch((e) => setErr(e instanceof ApiCallError ? errorText(e).text : String(e)))
  }, [])
  return (
    <Dialog title={t('update.title')} footer={<button onClick={closeDialog}>{t('common.close')}</button>}>
      {err && <div className="banner error">{err}</div>}
      {!u && !err && <div>{t('common.checking')}</div>}
      {u && !u.available && <div>{t('update.latest', { v: u.current })}</div>}
      {u?.available && (
        <>
          <div>{t('update.available', { v: u.latest })}</div>
          <div className="small muted">{t('update.current', { v: u.current })}</div>
          {u.appImage ? (
            <button
              className="primary"
              disabled={dl}
              onClick={() => {
                setDl(true)
                api.app.downloadUpdate().catch((e) => setErr(errorText(e).text))
              }}
            >
              {dl ? t('update.downloading') : t('update.download')}
            </button>
          ) : (
            <>
              <div>{t('update.debHint')}</div>
              {u.aptCommand && <pre className="code-box">{u.aptCommand}</pre>}
            </>
          )}
          <button onClick={() => api.app.openExternal(u.url)}>{t('update.releaseNotes')}</button>
        </>
      )}
    </Dialog>
  )
}

export function AboutDialog() {
  const t = useT()
  const info = useStore((s) => s.info)
  return (
    <Dialog title={t('about.title')} footer={<button onClick={closeDialog}>{t('common.close')}</button>}>
      <div className="col" style={{ alignItems: 'center', textAlign: 'center' }}>
        <h2 style={{ margin: 0 }}>Кот-код</h2>
        <div className="muted">{t('about.tagline')}</div>
        <div>
          {t('settings.version')} {info?.version}
        </div>
        <div>
          {t('about.author')}: Горшков Сергей Владимирович
        </div>
        <button className="link" onClick={() => api.app.openExternal('https://nookbat.ru')}>
          nookbat.ru
        </button>
        <div className="small muted">
          Git {info?.gitVersion ?? '—'} · Electron {info?.electron} · {info?.platform}
          {info?.appImage ? ' · AppImage' : ''}
        </div>
        <div className="small muted">{t('about.license')}</div>
      </div>
    </Dialog>
  )
}
