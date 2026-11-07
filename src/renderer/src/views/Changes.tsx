import { useEffect, useMemo, useRef, useState } from 'react'
import type { ConflictVersions, DiffFile, FileChange } from '@shared/types'
import { buildPartialPatch, allLinesSelection } from '@shared/patch'
import { api } from '../lib/api'
import { attempt, openDialog, showError, toast, updateSettings, useStore } from '../store'
import { useT } from '../i18n'
import { DiffView, type DiffSelection } from '../components/DiffView'
import { Empty, copyText, showMenu } from '../components/ui'
import { confirmDialog } from '../components/dialogs/common'

function statusLetter(f: FileChange): string {
  if (f.conflicted) return 'U'
  if (f.untracked) return '?'
  const c = f.worktree !== '.' ? f.worktree : f.index
  return c === 'T' ? 'M' : c
}

export default function Changes() {
  const t = useT()
  const repo = useStore((s) => s.repo)!
  const status = useStore((s) => s.status)
  const files = useMemo(() => status?.files ?? [], [status])
  const [selPath, setSelPath] = useState<string | null>(null)
  const sel = files.find((f) => f.path === selPath) ?? null

  useEffect(() => {
    if (!sel && files.length) setSelPath(files[0].path)
  }, [files, sel])

  const allStaged = files.length > 0 && files.every((f) => f.staged && !f.unstaged && !f.untracked)
  const someStaged = files.some((f) => f.staged)
  const toggleAll = () =>
    attempt(t('busy.stage'), () =>
      allStaged ? api.git.unstage(repo, files.map((f) => f.path)) : api.git.stage(repo, files.filter((f) => !f.conflicted).map((f) => f.path))
    )
  const toggle = (f: FileChange) =>
    attempt(t('busy.stage'), () => (f.staged && !f.unstaged && !f.untracked ? api.git.unstage(repo, [f.path]) : api.git.stage(repo, [f.path])))

  const discard = async (paths: string[]) => {
    const ok = await confirmDialog({
      title: t('changes.discardTitle'),
      text: paths.length === 1 ? t('changes.discardOne', { path: paths[0] }) : t('changes.discardMany', { n: paths.length }),
      ok: t('changes.discard'),
      danger: true
    })
    if (ok) await attempt(t('busy.discard'), () => api.git.discard(repo, paths))
  }

  const ignore = async (pattern: string) => {
    await attempt(t('busy.ignore'), () => api.git.ignorePath(repo, pattern))
    toast('success', t('changes.ignored', { pattern }))
  }

  const menu = (e: React.MouseEvent, f: FileChange) => {
    const ext = f.path.includes('.') ? f.path.split('.').pop() : null
    showMenu(e, [
      { label: t('changes.discard'), danger: true, onClick: () => discard([f.path]) },
      { label: t('changes.discardAll'), danger: true, onClick: () => discard(files.map((x) => x.path)) },
      { sep: true },
      { label: t('changes.ignoreFile'), onClick: () => ignore(f.path) },
      ...(ext ? [{ label: t('changes.ignoreExt', { ext }), onClick: () => ignore(`*.${ext}`) }] : []),
      { sep: true },
      { label: t('changes.copyPath'), onClick: () => copyText(f.path) },
      { label: t('changes.showInFolder'), onClick: () => api.app.showInFolder(`${repo}/${f.path}`) },
      { label: t('changes.openFile'), onClick: () => api.app.openPath(`${repo}/${f.path}`) }
    ])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <StateBanner />
      <div className="split" style={{ flex: 1 }}>
        <div className="pane left">
          <div className="pane-header">
            <input
              type="checkbox"
              checked={allStaged}
              ref={(el) => el && (el.indeterminate = someStaged && !allStaged)}
              onChange={toggleAll}
              disabled={!files.length}
              title={t('changes.stageAll')}
            />
            <span className="title">{t('changes.count', { n: files.length })}</span>
          </div>
          <div className="scroll">
            {!files.length && <Empty>{t('changes.none')}</Empty>}
            {files.map((f) => (
              <div
                key={f.path}
                className={`list-item ${selPath === f.path ? 'selected' : ''}`}
                onClick={() => setSelPath(f.path)}
                onContextMenu={(e) => menu(e, f)}
              >
                <input
                  type="checkbox"
                  checked={f.staged && !f.unstaged && !f.untracked}
                  ref={(el) => el && (el.indeterminate = f.staged && (f.unstaged || f.untracked))}
                  disabled={f.conflicted}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggle(f)}
                />
                <span className="path" title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}>
                  {f.path}
                </span>
                <span className={`st st-${statusLetter(f)}`}>{statusLetter(f)}</span>
              </div>
            ))}
          </div>
          <CommitBox />
        </div>
        <div className="pane">
          {sel ? sel.conflicted ? <ConflictPane key={sel.path} file={sel} /> : <FileDiff key={sel.path} file={sel} /> : <NoChanges />}
        </div>
      </div>
    </div>
  )
}

function NoChanges() {
  const t = useT()
  const status = useStore((s) => s.status)
  const hostRef = useStore((s) => s.hostRef)
  return (
    <Empty>
      <h3 style={{ margin: 0 }}>{t('changes.noneTitle')}</h3>
      <div>{t('changes.noneHint')}</div>
      {status && status.ahead > 0 && <div>{t('changes.aheadHint', { n: status.ahead })}</div>}
      {hostRef && status?.branch && (
        <button onClick={() => openDialog('createPull')}>{t('pulls.create')}</button>
      )}
    </Empty>
  )
}

function FileDiff({ file }: { file: FileChange }) {
  const t = useT()
  const repo = useStore((s) => s.repo)!
  const revision = useStore((s) => s.revision)
  const mode = useStore((s) => s.settings?.diffMode ?? 'unified')
  const both = file.staged && (file.unstaged || file.untracked)
  const [which, setWhich] = useState<'unstaged' | 'staged'>(file.unstaged || file.untracked ? 'unstaged' : 'staged')
  const staged = which === 'staged' && file.staged ? true : !(file.unstaged || file.untracked)
  const [diff, setDiff] = useState<DiffFile | null>(null)
  const [selected, setSelected] = useState<Map<number, Set<number>>>(new Map())

  useEffect(() => {
    let alive = true
    api.git
      .diff(repo, file.path, staged, file.untracked && !staged)
      .then((d) => {
        if (!alive) return
        setDiff(d)
        setSelected(new Map())
      })
      .catch(showError)
    return () => {
      alive = false
    }
  }, [repo, file.path, staged, file.untracked, revision])

  const selection: DiffSelection = {
    selected,
    toggle: (h, lines) => {
      const n = new Map(selected)
      const s = new Set(n.get(h) ?? [])
      const allOn = lines.every((l) => s.has(l))
      lines.forEach((l) => (allOn ? s.delete(l) : s.add(l)))
      n.set(h, s)
      setSelected(n)
    }
  }
  const count = [...selected.values()].reduce((a, s) => a + s.size, 0)

  const applySel = async (sel: Map<number, Set<number>>, action: 'stage' | 'unstage' | 'discard') => {
    if (!diff) return
    if (action === 'discard' && !(await confirmDialog({ title: t('changes.discardTitle'), text: t('changes.discardLines'), ok: t('changes.discard'), danger: true }))) return
    const patch = buildPartialPatch(diff, sel, action !== 'stage')
    if (!patch) return
    await attempt(t(`busy.${action}`), () => api.git.applyPatch(repo, patch, action))
  }
  const hunkSel = (hi: number) => {
    const all = allLinesSelection(diff!)
    return new Map([[hi, all.get(hi) ?? new Set<number>()]])
  }
  const canLineOps = diff && !diff.binary && !(file.untracked && !staged && false)

  return (
    <>
      <div className="pane-header">
        <span className="title mono">{file.path}</span>
        {both && (
          <div className="tabs" style={{ border: 'none' }}>
            <button className={which === 'unstaged' ? 'active' : ''} onClick={() => setWhich('unstaged')}>
              {t('changes.unstagedTab')}
            </button>
            <button className={which === 'staged' ? 'active' : ''} onClick={() => setWhich('staged')}>
              {t('changes.stagedTab')}
            </button>
          </div>
        )}
        {count > 0 &&
          (staged ? (
            <button className="primary" onClick={() => applySel(selected, 'unstage')}>
              {t('changes.unstageLines', { n: count })}
            </button>
          ) : (
            <>
              <button className="primary" onClick={() => applySel(selected, 'stage')}>
                {t('changes.stageLines', { n: count })}
              </button>
              {!file.untracked && (
                <button className="danger" onClick={() => applySel(selected, 'discard')}>
                  {t('changes.discardLinesBtn', { n: count })}
                </button>
              )}
            </>
          ))}
        <select value={mode} onChange={(e) => updateSettings({ diffMode: e.target.value as 'split' | 'unified' })} style={{ width: 'auto' }}>
          <option value="unified">{t('diff.unified')}</option>
          <option value="split">{t('diff.split')}</option>
        </select>
      </div>
      <div className="scroll">
        {diff ? (
          <DiffView
            file={diff}
            mode={mode}
            selection={canLineOps ? selection : undefined}
            hunkActions={
              staged
                ? [{ label: t('changes.unstageHunk'), run: (hi) => applySel(hunkSel(hi), 'unstage') }]
                : [
                    { label: t('changes.stageHunk'), run: (hi) => applySel(hunkSel(hi), 'stage') },
                    ...(file.untracked ? [] : [{ label: t('changes.discardHunk'), danger: true, run: (hi: number) => applySel(hunkSel(hi), 'discard') }])
                  ]
            }
          />
        ) : (
          <Empty>{t('common.loading')}</Empty>
        )}
      </div>
    </>
  )
}

function ConflictPane({ file }: { file: FileChange }) {
  const t = useT()
  const repo = useStore((s) => s.repo)!
  const [v, setV] = useState<ConflictVersions | null>(null)
  const [content, setContent] = useState('')
  useEffect(() => {
    api.git
      .conflict(repo, file.path)
      .then((x) => {
        setV(x)
        setContent(x.working)
      })
      .catch(showError)
  }, [repo, file.path])
  const resolve = (how: 'ours' | 'theirs' | 'content') => attempt(t('busy.resolve'), () => api.git.resolve(repo, file.path, how, how === 'content' ? content : undefined))
  const markers = (content.match(/^<<<<<<< /gm) ?? []).length
  if (!v) return <Empty>{t('common.loading')}</Empty>
  return (
    <>
      <div className="pane-header">
        <span className="title mono">{file.path}</span>
        <span className="pill closed">{t('conflict.label')}</span>
      </div>
      <div className="scroll" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="conflict-grid">
          <div className="col">
            <div className="row">
              <b className="grow">{t('conflict.ours')}</b>
              <button onClick={() => resolve('ours')} disabled={v.ours === null}>
                {t('conflict.useOurs')}
              </button>
            </div>
            <div className="code-box">{v.ours ?? t('conflict.deleted')}</div>
          </div>
          <div className="col">
            <div className="row">
              <b className="grow">{t('conflict.theirs')}</b>
              <button onClick={() => resolve('theirs')} disabled={v.theirs === null}>
                {t('conflict.useTheirs')}
              </button>
            </div>
            <div className="code-box">{v.theirs ?? t('conflict.deleted')}</div>
          </div>
        </div>
        <div className="row">
          <b className="grow">{t('conflict.result')}</b>
          <span className={markers ? 'pill closed' : 'pill open'}>{markers ? t('conflict.markersLeft', { n: markers }) : t('conflict.noMarkers')}</span>
          <button onClick={() => api.app.openPath(`${repo}/${file.path}`)}>{t('conflict.openEditor')}</button>
          <button className="primary" onClick={() => resolve('content')}>
            {t('conflict.markResolved')}
          </button>
        </div>
        <textarea className="mono" style={{ minHeight: 280, fontSize: 12 }} value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} />
      </div>
    </>
  )
}

function StateBanner() {
  const t = useT()
  const repo = useStore((s) => s.repo)!
  const status = useStore((s) => s.status)
  if (!status || status.state === 'clean') return null
  const conflicts = status.files.filter((f) => f.conflicted).length
  const cont = async () => {
    const r = await attempt(t('busy.continue'), () => api.git.continueOp(repo))
    if (r !== undefined) toast('success', t('state.continued'))
  }
  return (
    <div className="banner warn">
      <b>{t(`state.${status.state}`)}</b>
      <span className="grow">{conflicts ? t('state.conflicts', { n: conflicts }) : t('state.resolved')}</span>
      <button className="primary" disabled={conflicts > 0} onClick={cont}>
        {t('state.continue')}
      </button>
      {status.state === 'rebasing' && <button onClick={() => attempt(t('busy.continue'), () => api.git.skipOp(repo))}>{t('state.skip')}</button>}
      <button
        className="danger"
        onClick={async () => {
          if (await confirmDialog({ title: t('state.abort'), text: t('state.abortConfirm'), ok: t('state.abort'), danger: true }))
            await attempt(t('busy.abort'), () => api.git.abortOp(repo))
        }}
      >
        {t('state.abort')}
      </button>
    </div>
  )
}

function CommitBox() {
  const t = useT()
  const repo = useStore((s) => s.repo)!
  const status = useStore((s) => s.status)
  const settings = useStore((s) => s.settings)
  const draft = settings?.commitDrafts[repo]
  const [summary, setSummary] = useState(draft?.summary ?? '')
  const [description, setDescription] = useState(draft?.description ?? '')
  const [coAuthors, setCoAuthors] = useState(draft?.coAuthors ?? '')
  const [showCo, setShowCo] = useState(!!draft?.coAuthors)
  const [amend, setAmend] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const empty = !summary && !description && !coAuthors
      api.settings.saveDraft(repo, empty ? null : { summary, description, coAuthors }).catch(() => undefined)
    }, 600)
    return () => clearTimeout(saveTimer.current)
  }, [repo, summary, description, coAuthors])

  useEffect(() => {
    if (!amend) return
    api.git
      .lastCommitMessage(repo)
      .then((m) => {
        const [s, ...rest] = m.split('\n')
        setSummary(s)
        setDescription(rest.join('\n').trim())
      })
      .catch(showError)
  }, [amend, repo])

  const staged = status?.files.filter((f) => f.staged).length ?? 0
  const conflicted = status?.files.some((f) => f.conflicted)
  const can = summary.trim() && (staged > 0 || amend) && !conflicted
  const commit = async () => {
    if (!can) return
    const r = await attempt(t('busy.commit'), () =>
      api.git.commit(repo, { summary: summary.trim(), description, coAuthors: coAuthors.split('\n').map((s) => s.trim()).filter(Boolean), amend })
    )
    if (r !== undefined) {
      setSummary('')
      setDescription('')
      setCoAuthors('')
      setAmend(false)
      toast('success', t('commit.done', { hash: r.slice(0, 8) }))
    }
  }
  useEffect(() => {
    const h = () => commit()
    window.addEventListener('kotkod:commit', h)
    return () => window.removeEventListener('kotkod:commit', h)
  })

  return (
    <div className="commit-box">
      <input list="commit-history" placeholder={t('commit.summary')} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={200} />
      <datalist id="commit-history">
        {settings?.commitHistory.map((m) => <option key={m} value={m} />)}
      </datalist>
      <textarea placeholder={t('commit.description')} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
      {showCo && (
        <textarea placeholder={t('commit.coAuthorsHint')} value={coAuthors} onChange={(e) => setCoAuthors(e.target.value)} rows={2} />
      )}
      <div className="row small">
        <label className="check">
          <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} disabled={!status?.hasCommits} />
          {t('commit.amend')}
        </label>
        <span className="grow" />
        <button className="link small" onClick={() => setShowCo(!showCo)}>
          {t('commit.coAuthors')}
        </button>
        {summary.length > 72 && <span style={{ color: 'var(--warn)' }}>{summary.length}/72</span>}
      </div>
      <button className="primary" disabled={!can} onClick={commit} title={settings?.shortcuts.commit}>
        {amend ? t('commit.amendBtn') : t('commit.btn', { branch: status?.branch ?? 'HEAD' })}
        {!amend && staged > 0 && ` (${staged})`}
      </button>
    </div>
  )
}
