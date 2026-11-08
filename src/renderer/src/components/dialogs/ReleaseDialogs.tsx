import { useEffect, useState } from 'react'
import type { Release, RemoteRepo } from '@shared/types'
import { api } from '../../lib/api'
import { attempt, closeDialog, showError, toast, useStore } from '../../store'
import { useT } from '../../i18n'
import { Dialog, Field, Icon } from '../ui'

const baseName = (p: string) => p.split('/').pop() ?? p

export function ReleaseDialog({ release, tag, onDone }: { release?: Release; tag?: string; onDone?: (r: Release) => void }) {
  const t = useT()
  const ref = useStore((s) => s.hostRef)
  const repo = useStore((s) => s.repo)
  const providers = useStore((s) => s.providers)
  const accounts = useStore((s) => s.accounts)
  const [tags, setTags] = useState<string[] | null>(null)
  const [tagName, setTagName] = useState(release?.tag ?? tag ?? '')
  const [target, setTarget] = useState('')
  const [name, setName] = useState(release?.name ?? '')
  const [body, setBody] = useState(release?.body ?? '')
  const [draft, setDraft] = useState(release?.draft ?? false)
  const [pre, setPre] = useState(release?.prerelease ?? false)
  const [files, setFiles] = useState<string[]>([])
  useEffect(() => {
    if (repo) api.git.tags(repo).then((l) => setTags(l.map((x) => x.name))).catch(() => setTags([]))
  }, [repo])
  if (!ref) return null
  const providerId = accounts.find((a) => a.id === ref.accountId)?.provider
  const providerTitle = providers.find((p) => p.id === providerId)?.title ?? ''
  const validTag = /^[^\s~^:?*[\\]+$/.test(tagName) && !tagName.endsWith('.lock')
  const newTag = !release && tags !== null && !!tagName && !tags.includes(tagName)

  const generate = async () => {
    if (!repo) return
    const notes = await attempt(t('common.loading'), () => api.git.releaseNotes(repo, tagName), { refresh: false })
    if (notes === undefined) return
    if (!notes) return toast('info', t('releases.noNotes'))
    setBody((b) => (b.trim() ? `${b.trimEnd()}\n\n${notes}` : notes))
  }
  const addFiles = async () => {
    const picked = await api.app.pickFiles(t('releases.pickFiles'))
    setFiles((f) => [...f, ...picked.filter((p) => !f.includes(p))])
  }
  const go = async () => {
    const input = { tag: tagName, name: name.trim() || tagName, body, target: target.trim() || undefined, draft, prerelease: pre }
    const r = await attempt(
      t(files.length ? 'busy.upload' : 'busy.release'),
      async () => {
        if (!release) return api.hosting.createRelease(ref, input, files, repo ?? undefined)
        const updated = await api.hosting.updateRelease(ref, release.id, input)
        return files.length ? api.hosting.uploadAssets(ref, release.id, files) : updated
      },
      { refresh: false }
    )
    if (!r) return
    closeDialog()
    onDone?.(r)
    toast('success', release ? t('releases.saved') : t(r.draft ? 'releases.created' : 'releases.published', { name: r.name }), undefined, {
      label: t('common.openInBrowser'),
      run: () => void api.app.openExternal(r.htmlUrl)
    })
  }

  return (
    <Dialog
      wide
      title={release ? t('releases.editTitle') : t('releases.new')}
      footer={
        <>
          <button onClick={closeDialog}>{t('common.cancel')}</button>
          <button className="primary" disabled={!validTag} onClick={go}>
            {release ? t('releases.saveBtn') : draft ? t('releases.saveDraft') : t('releases.createBtn')}
          </button>
        </>
      }
    >
      <div className="row">
        <Field label={t('releases.tag')}>
          <input autoFocus={!tagName} list="kk-release-tags" value={tagName} onChange={(e) => setTagName(e.target.value.trim())} placeholder="v1.0.0" />
          <datalist id="kk-release-tags">{tags?.map((x) => <option key={x} value={x} />)}</datalist>
        </Field>
        {newTag && (
          <Field label={t('releases.target')}>
            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder={t('releases.targetHint')} />
          </Field>
        )}
      </div>
      {newTag && <div className="small muted">{t('releases.newTag', { tag: tagName })}</div>}
      {!release && !newTag && repo && tagName && <div className="small muted">{t('releases.localTag')}</div>}
      <Field label={t('releases.title')}>
        <input autoFocus={!!tagName} value={name} onChange={(e) => setName(e.target.value)} placeholder={tagName} />
      </Field>
      <Field label={t('releases.body')}>
        <textarea rows={9} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      {repo && (
        <div className="row">
          <button onClick={generate} disabled={!tagName}>
            {t('releases.generate')}
          </button>
        </div>
      )}
      <div className="row">
        <b className="grow">{t('releases.files')}</b>
        <button onClick={addFiles}>
          <Icon name="plus" size={12} /> {t('releases.addFiles')}
        </button>
      </div>
      {files.map((f) => (
        <div key={f} className="row small">
          <span className="grow mono" title={f}>
            {baseName(f)}
          </span>
          <button className="icon" onClick={() => setFiles(files.filter((x) => x !== f))} title={t('common.delete')}>
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
      {files.length > 0 && providerId === 'gitverse' && <div className="small muted">{t('releases.gitverseNames')}</div>}
      <label className="check">
        <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
        {t('releases.markDraft')}
      </label>
      <label className="check">
        <input type="checkbox" checked={pre} onChange={(e) => setPre(e.target.checked)} />
        {t('releases.markPre')}
      </label>
      <div className="small muted">{t('releases.publishTo', { repo: `${ref.owner}/${ref.repo}`, provider: providerTitle })}</div>
    </Dialog>
  )
}

export function CopyReleaseDialog({ release }: { release: Release }) {
  const t = useT()
  const ref = useStore((s) => s.hostRef)
  const repo = useStore((s) => s.repo)
  const accounts = useStore((s) => s.accounts)
  const providers = useStore((s) => s.providers)
  const [accountId, setAccountId] = useState(() => accounts.find((a) => a.id !== ref?.accountId)?.id ?? ref?.accountId ?? '')
  const [repos, setRepos] = useState<RemoteRepo[] | null>(null)
  const [target, setTarget] = useState('')
  const [withAssets, setWithAssets] = useState(true)
  const [draft, setDraft] = useState(false)
  useEffect(() => {
    if (!accountId) return
    setRepos(null)
    api.hosting
      .repos(accountId)
      .then(setRepos)
      .catch((e) => {
        setRepos([])
        showError(e)
      })
  }, [accountId])
  if (!ref) return null
  const title = (id: string) => {
    const a = accounts.find((x) => x.id === id)
    return a ? `${providers.find((p) => p.id === a.provider)?.title ?? a.provider} — ${a.login}` : id
  }
  const isSource = (r: RemoteRepo) => accountId === ref.accountId && r.owner === ref.owner && r.name === ref.repo
  const choices = (repos ?? []).filter((r) => !isSource(r))
  const chosen = choices.find((r) => r.fullName === target)

  const go = async () => {
    if (!chosen) return
    const to = { accountId, owner: chosen.owner, repo: chosen.name }
    const r = await attempt(
      t('busy.copyRelease'),
      () => api.hosting.copyRelease(ref, release.id, to, { assets: withAssets, draft, repoPath: repo ?? undefined }),
      { refresh: false }
    )
    if (!r) return
    closeDialog()
    toast('success', t('releases.copied', { repo: chosen.fullName }), undefined, {
      label: t('common.openInBrowser'),
      run: () => void api.app.openExternal(r.htmlUrl)
    })
  }

  return (
    <Dialog
      title={t('releases.copyTitle', { name: release.name })}
      footer={
        <>
          <button onClick={closeDialog}>{t('common.cancel')}</button>
          <button className="primary" disabled={!chosen} onClick={go}>
            {t('releases.copyBtn')}
          </button>
        </>
      }
    >
      <Field label={t('releases.account')}>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {title(a.id)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('releases.targetRepo')}>
        <input
          list="kk-copy-repos"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder={repos === null ? t('common.loading') : 'owner/repo'}
        />
        <datalist id="kk-copy-repos">{choices.map((r) => <option key={r.id} value={r.fullName} />)}</datalist>
      </Field>
      <label className="check">
        <input type="checkbox" checked={withAssets} disabled={!release.assets.length} onChange={(e) => setWithAssets(e.target.checked)} />
        {t('releases.copyAssets', { n: release.assets.length })}
      </label>
      <label className="check">
        <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
        {t('releases.copyDraft')}
      </label>
      <div className="small muted">{t('releases.copyHint', { tag: release.tag })}</div>
    </Dialog>
  )
}
