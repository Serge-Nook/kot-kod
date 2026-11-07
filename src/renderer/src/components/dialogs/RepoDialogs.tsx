import { useEffect, useMemo, useState } from 'react'
import type { RebaseTodoItem, RemoteRepo } from '@shared/types'
import { api } from '../../lib/api'
import { attempt, closeDialog, openRepo, reloadAccounts, showError, toast, useStore } from '../../store'
import { useT } from '../../i18n'
import { Dialog, Empty, Field } from '../ui'

export function CloneDialog({ url: initialUrl }: { url?: string }) {
  const t = useT()
  const accounts = useStore((s) => s.accounts)
  const settings = useStore((s) => s.settings)!
  const [tab, setTab] = useState<string>(accounts[0]?.id ?? 'url')
  const [url, setUrl] = useState(initialUrl ?? '')
  const [dir, setDir] = useState(settings.cloneDir)
  const [repos, setRepos] = useState<RemoteRepo[] | null>(null)
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState<RemoteRepo | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (tab === 'url') return
    setRepos(null)
    setPicked(null)
    api.hosting.repos(tab).then(setRepos).catch((e) => {
      setRepos([])
      showError(e)
    })
  }, [tab])

  const target = tab === 'url' ? url.trim() : picked?.cloneUrl ?? ''
  const go = async () => {
    if (!target) return
    setBusy(true)
    try {
      const path = await attempt(t('busy.clone'), () => api.repos.clone(target, dir, tab === 'url' ? undefined : tab), { refresh: false })
      if (path) {
        closeDialog()
        await openRepo(path)
        toast('success', t('clone.done', { path }))
      }
    } finally {
      setBusy(false)
    }
  }
  const f = filter.toLowerCase()
  return (
    <Dialog
      title={t('clone.title')}
      wide
      footer={
        <>
          <button onClick={closeDialog}>{t('common.cancel')}</button>
          <button className="primary" disabled={!target || !dir || busy} onClick={go}>
            {busy ? t('busy.clone') : t('clone.btn')}
          </button>
        </>
      }
    >
      <div className="tabs">
        {accounts.map((a) => (
          <button key={a.id} className={tab === a.id ? 'active' : ''} onClick={() => setTab(a.id)}>
            {a.provider === 'github' ? 'GitHub' : 'GitVerse'} · {a.login}
          </button>
        ))}
        <button className={tab === 'url' ? 'active' : ''} onClick={() => setTab('url')}>
          {t('clone.byUrl')}
        </button>
      </div>
      {tab === 'url' ? (
        <Field label={t('clone.url')}>
          <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo.git, git@gitverse.ru:owner/repo.git" />
        </Field>
      ) : (
        <>
          <input autoFocus placeholder={t('common.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="scroll section" style={{ height: 300, padding: 0, gap: 0, flex: 'none' }}>
            {repos === null && <Empty>{t('common.loading')}</Empty>}
            {repos?.length === 0 && <Empty>{t('clone.noRepos')}</Empty>}
            {repos
              ?.filter((r) => r.fullName.toLowerCase().includes(f))
              .map((r) => (
                <div key={r.id} className={`list-item ${picked?.id === r.id ? 'selected' : ''}`} onClick={() => setPicked(r)} onDoubleClick={go}>
                  <span className="grow">
                    <b>{r.fullName}</b> {r.private && <span className="pill">{t('repo.private')}</span>} {r.fork && <span className="pill">{t('repo.forkLabel')}</span>}
                    {r.description && <div className="small muted">{r.description}</div>}
                  </span>
                </div>
              ))}
          </div>
        </>
      )}
      <Field label={t('clone.dir')}>
        <div className="row">
          <input className="grow" value={dir} onChange={(e) => setDir(e.target.value)} />
          <button
            onClick={async () => {
              const d = await api.app.pickDirectory(t('clone.dir'), dir)
              if (d) setDir(d)
            }}
          >
            …
          </button>
        </div>
      </Field>
      {target && <div className="small muted">{t('clone.willCloneTo', { url: target })}</div>}
    </Dialog>
  )
}

export function CreateDialog() {
  const t = useT()
  const settings = useStore((s) => s.settings)!
  const accounts = useStore((s) => s.accounts)
  const [name, setName] = useState('')
  const [parent, setParent] = useState(settings.cloneDir)
  const [branch, setBranch] = useState('main')
  const [templates, setTemplates] = useState<string[]>([])
  const [licenses, setLicenses] = useState<string[]>([])
  const [gi, setGi] = useState('')
  const [license, setLicense] = useState('')
  const [readme, setReadme] = useState(true)
  const [author, setAuthor] = useState(accounts[0]?.name ?? '')
  useEffect(() => {
    api.settings.gitignoreTemplates().then(setTemplates).catch(() => undefined)
    api.settings.licenses().then(setLicenses).catch(() => undefined)
    api.git.config('').then((c) => c.name && setAuthor(c.name)).catch(() => undefined)
  }, [])
  const valid = /^[\w.-]+$/.test(name)
  const go = async () => {
    const path = await attempt(
      t('busy.create'),
      () => api.repos.init({ path: `${parent.replace(/\/$/, '')}/${name}`, defaultBranch: branch, gitignore: gi ? [gi] : [], license, readme, authorName: author }),
      { refresh: false }
    )
    if (path) {
      closeDialog()
      await openRepo(path)
    }
  }
  return (
    <Dialog
      title={t('create.title')}
      footer={
        <>
          <button onClick={closeDialog}>{t('common.cancel')}</button>
          <button className="primary" disabled={!valid} onClick={go}>
            {t('create.btn')}
          </button>
        </>
      }
    >
      <Field label={t('create.name')}>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="my-project" />
      </Field>
      {name && !valid && <div className="small" style={{ color: 'var(--danger)' }}>{t('create.invalidName')}</div>}
      <Field label={t('create.parent')}>
        <div className="row">
          <input className="grow" value={parent} onChange={(e) => setParent(e.target.value)} />
          <button
            onClick={async () => {
              const d = await api.app.pickDirectory(t('create.parent'), parent)
              if (d) setParent(d)
            }}
          >
            …
          </button>
        </div>
      </Field>
      <Field label={t('create.branch')}>
        <input value={branch} onChange={(e) => setBranch(e.target.value)} />
      </Field>
      <Field label=".gitignore">
        <select value={gi} onChange={(e) => setGi(e.target.value)}>
          <option value="">{t('common.none')}</option>
          {templates.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </Field>
      <Field label={t('create.license')}>
        <select value={license} onChange={(e) => setLicense(e.target.value)}>
          <option value="">{t('common.none')}</option>
          {licenses.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </Field>
      {license && (
        <Field label={t('create.author')}>
          <input value={author} onChange={(e) => setAuthor(e.target.value)} />
        </Field>
      )}
      <label className="check">
        <input type="checkbox" checked={readme} onChange={(e) => setReadme(e.target.checked)} />
        {t('create.readme')}
      </label>
    </Dialog>
  )
}

export function PublishDialog() {
  const t = useT()
  const repo = useStore((s) => s.repo)!
  const accounts = useStore((s) => s.accounts)
  const [acc, setAcc] = useState(accounts[0]?.id ?? '')
  const [name, setName] = useState(repo.split('/').pop() ?? '')
  const [desc, setDesc] = useState('')
  const [priv, setPriv] = useState(true)
  if (!accounts.length)
    return (
      <Dialog title={t('publish.title')}>
        <div>{t('hosting.noAccount')}</div>
      </Dialog>
    )
  const go = async () => {
    const r = await attempt(t('busy.publish'), () => api.hosting.publish(repo, acc, { name, description: desc, private: priv }))
    if (r) {
      closeDialog()
      await reloadAccounts()
      toast('success', t('publish.done', { name: r.fullName }), undefined, { label: t('common.openInBrowser'), run: () => api.app.openExternal(r.htmlUrl) })
    }
  }
  return (
    <Dialog
      title={t('publish.title')}
      footer={
        <>
          <button onClick={closeDialog}>{t('common.cancel')}</button>
          <button className="primary" disabled={!name || !acc} onClick={go}>
            {t('publish.btn')}
          </button>
        </>
      }
    >
      <Field label={t('publish.account')}>
        <select value={acc} onChange={(e) => setAcc(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.provider === 'github' ? 'GitHub' : 'GitVerse'} · {a.login}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('create.name')}>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t('publish.description')}>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} />
        {t('publish.private')}
      </label>
    </Dialog>
  )
}

export function NewBranchDialog({ start }: { start?: string }) {
  const t = useT()
  const repo = useStore((s) => s.repo)!
  const branches = useStore((s) => s.branches)
  const status = useStore((s) => s.status)
  const [name, setName] = useState('')
  const [from, setFrom] = useState(start ?? status?.branch ?? 'HEAD')
  const [checkout, setCheckout] = useState(true)
  const invalid = !name || /[\s~^:?*[\\]|\.\.|@\{|^[-/.]|[/.]$|\.lock$/.test(name)
  const exists = branches.some((b) => !b.remote && b.name === name)
  const go = async () => {
    if (invalid || exists) return
    const ok = await attempt(t('busy.branch'), () => api.git.createBranch(repo, name, from === 'HEAD' ? null : from, checkout).then(() => true))
    if (ok) closeDialog()
  }
  return (
    <Dialog
      title={t('branches.new')}
      footer={
        <>
          <button onClick={closeDialog}>{t('common.cancel')}</button>
          <button className="primary" disabled={invalid || exists} onClick={go}>
            {t('branches.create')}
          </button>
        </>
      }
    >
      <Field label={t('branches.name')}>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value.replace(/ /g, '-'))} onKeyDown={(e) => e.key === 'Enter' && go()} />
      </Field>
      {name && invalid && <div className="small" style={{ color: 'var(--danger)' }}>{t('branches.invalidName')}</div>}
      {exists && <div className="small" style={{ color: 'var(--danger)' }}>{t('branches.exists')}</div>}
      <Field label={t('branches.from')}>
        <select value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="HEAD">HEAD{status?.branch ? ` (${status.branch})` : ''}</option>
          {start && !branches.some((b) => b.name === start) && <option value={start}>{start.slice(0, 10)}</option>}
          {branches
            .filter((b) => !b.name.endsWith('/HEAD'))
            .map((b) => (
              <option key={b.ref} value={b.name}>
                {b.name}
              </option>
            ))}
        </select>
      </Field>
      <label className="check">
        <input type="checkbox" checked={checkout} onChange={(e) => setCheckout(e.target.checked)} />
        {t('branches.checkoutAfter')}
      </label>
    </Dialog>
  )
}

export function TagDialog({ hash }: { hash: string }) {
  const t = useT()
  const repo = useStore((s) => s.repo)!
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')
  const [push, setPush] = useState(false)
  const go = async () => {
    const ok = await attempt(t('busy.tag'), async () => {
      await api.git.createTag(repo, name, hash, msg)
      if (push) await api.git.pushTag(repo, name)
      return true
    })
    if (ok) closeDialog()
  }
  return (
    <Dialog
      title={t('tags.new')}
      footer={
        <>
          <button onClick={closeDialog}>{t('common.cancel')}</button>
          <button className="primary" disabled={!/^[\w./-]+$/.test(name)} onClick={go}>
            {t('tags.create')}
          </button>
        </>
      }
    >
      <div className="small muted">{t('tags.at', { hash: hash.slice(0, 10) })}</div>
      <Field label={t('tags.name')}>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="v1.0.0" />
      </Field>
      <Field label={t('tags.message')}>
        <textarea rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} />
        {t('tags.pushAfter')}
      </label>
    </Dialog>
  )
}

export function RebaseDialog({ base }: { base: string }) {
  const t = useT()
  const repo = useStore((s) => s.repo)!
  const [items, setItems] = useState<RebaseTodoItem[] | null>(null)
  useEffect(() => {
    api.git
      .log(repo, { limit: 200, ref: `${base}..HEAD` })
      .then((l) => setItems(l.reverse().map((c) => ({ action: 'pick', hash: c.hash, subject: c.subject }))))
      .catch((e) => {
        showError(e)
        setItems([])
      })
  }, [repo, base])
  const move = (i: number, d: number) => {
    if (!items) return
    const n = [...items]
    const j = i + d
    if (j < 0 || j >= n.length) return
    ;[n[i], n[j]] = [n[j], n[i]]
    setItems(n)
  }
  const setAt = (i: number, patch: Partial<RebaseTodoItem>) => setItems(items!.map((x, k) => (k === i ? { ...x, ...patch } : x)))
  const invalid = useMemo(() => !!items && items.length > 0 && (items[0].action === 'squash' || items[0].action === 'fixup'), [items])
  const go = async () => {
    if (!items) return
    const r = await attempt(t('busy.rebase'), () => api.git.rebaseInteractive(repo, base, items))
    if (r !== undefined) {
      closeDialog()
      toast('success', t('branches.rebased'))
    }
  }
  return (
    <Dialog
      title={t('rebase.title', { base: base.slice(0, 12) })}
      wide
      footer={
        <>
          <button onClick={closeDialog}>{t('common.cancel')}</button>
          <button className="primary" disabled={!items?.length || invalid} onClick={go}>
            {t('rebase.start')}
          </button>
        </>
      }
    >
      <div className="small muted">{t('rebase.hint')}</div>
      {invalid && <div className="banner error">{t('rebase.firstSquash')}</div>}
      {items === null && <Empty>{t('common.loading')}</Empty>}
      {items?.length === 0 && <Empty>{t('rebase.nothing')}</Empty>}
      {items?.map((it, i) => (
        <div key={it.hash} className="row">
          <select value={it.action} onChange={(e) => setAt(i, { action: e.target.value as RebaseTodoItem['action'] })} style={{ width: 150 }}>
            {(['pick', 'reword', 'squash', 'fixup', 'drop'] as const).map((a) => (
              <option key={a} value={a}>
                {t(`rebase.${a}`)}
              </option>
            ))}
          </select>
          <span className="mono small muted">{it.hash.slice(0, 7)}</span>
          {it.action === 'reword' ? (
            <input className="grow" value={it.message ?? it.subject} onChange={(e) => setAt(i, { message: e.target.value })} />
          ) : (
            <span className="grow" style={{ textDecoration: it.action === 'drop' ? 'line-through' : undefined }}>
              {it.subject}
            </span>
          )}
          <button className="icon" onClick={() => move(i, -1)} disabled={i === 0}>
            ↑
          </button>
          <button className="icon" onClick={() => move(i, 1)} disabled={i === items.length - 1}>
            ↓
          </button>
        </div>
      ))}
    </Dialog>
  )
}

export function PushRejectedDialog() {
  const t = useT()
  const repo = useStore((s) => s.repo)!
  const pull = async (mode: 'merge' | 'rebase') => {
    closeDialog()
    const r = await attempt(t('busy.pull'), () => api.git.pull(repo, mode))
    if (r === undefined) return
    const st = useStore.getState().status
    if (st?.state !== 'clean') return
    await attempt(t('busy.push'), () => api.git.push(repo, { force: false, setUpstream: false }))
    toast('success', t('push.done'))
  }
  const force = async () => {
    closeDialog()
    await attempt(t('busy.push'), () => api.git.push(repo, { force: true, setUpstream: false }))
    toast('success', t('push.done'))
  }
  return (
    <Dialog title={t('push.rejectedTitle')} footer={<button onClick={closeDialog}>{t('common.cancel')}</button>}>
      <div>{t('push.rejectedText')}</div>
      <div className="col">
        <button className="primary" onClick={() => pull('merge')}>
          {t('push.pullMerge')}
        </button>
        <button onClick={() => pull('rebase')}>{t('push.pullRebase')}</button>
        <button className="danger" onClick={force}>
          {t('push.force')}
        </button>
      </div>
      <div className="small muted">{t('push.forceHint')}</div>
    </Dialog>
  )
}
