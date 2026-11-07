import { useEffect, useState } from 'react'
import type { IssueComment, PullFile, PullRequest } from '@shared/types'
import type { MergeMethod, ReviewEvent } from '@shared/api'
import { api } from '../lib/api'
import { attempt, openDialog, showError, toast, useStore } from '../store'
import { formatDate, relativeDate, useT } from '../i18n'
import { DiffView, patchToDiffFile } from '../components/DiffView'
import { Empty, Icon, Markdown } from '../components/ui'
import { confirmDialog } from '../components/dialogs/common'

export function NeedHosting() {
  const t = useT()
  const accounts = useStore((s) => s.accounts)
  return (
    <Empty>
      <div>{accounts.length ? t('hosting.noRemote') : t('hosting.noAccount')}</div>
      {!accounts.length ? (
        <button className="primary" onClick={() => openDialog('addAccount')}>
          {t('accounts.add')}
        </button>
      ) : (
        <button className="primary" onClick={() => openDialog('publish')}>
          {t('publish.title')}
        </button>
      )}
    </Empty>
  )
}

export default function Pulls() {
  const t = useT()
  const ref = useStore((s) => s.hostRef)
  const providers = useStore((s) => s.providers)
  const accounts = useStore((s) => s.accounts)
  const mode = useStore((s) => s.settings?.diffMode ?? 'unified')
  const [state, setState] = useState<'open' | 'closed' | 'all'>('open')
  const [mine, setMine] = useState(false)
  const [list, setList] = useState<PullRequest[] | null>(null)
  const [sel, setSel] = useState<PullRequest | null>(null)
  const [tab, setTab] = useState<'info' | 'files'>('info')
  const [files, setFiles] = useState<PullFile[]>([])
  const [comments, setComments] = useState<IssueComment[]>([])
  const [comment, setComment] = useState('')
  const [method, setMethod] = useState<MergeMethod>('merge')
  const [tick, setTick] = useState(0)
  const caps = providers.find((p) => p.id === accounts.find((a) => a.id === ref?.accountId)?.provider)?.capabilities

  useEffect(() => {
    if (!ref) return
    setList(null)
    api.hosting.pulls(ref, state, mine).then(setList).catch((e) => {
      setList([])
      showError(e)
    })
  }, [ref, state, mine, tick])

  useEffect(() => {
    if (!ref || !sel) return
    Promise.all([api.hosting.pull(ref, sel.number), api.hosting.pullFiles(ref, sel.number), api.hosting.pullComments(ref, sel.number)])
      .then(([p, f, c]) => {
        setSel(p)
        setFiles(f)
        setComments(c)
      })
      .catch(showError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, sel?.number, tick])

  if (!ref) return <NeedHosting />

  const merge = async () => {
    if (!sel) return
    if (!(await confirmDialog({ title: t('pulls.merge'), text: t('pulls.mergeConfirm', { n: sel.number, base: sel.base }), ok: t('pulls.merge') }))) return
    const r = await attempt(t('busy.merge'), () => api.hosting.mergePull(ref, sel.number, method).then(() => true), { refresh: false })
    if (r) {
      toast('success', t('pulls.merged', { n: sel.number }))
      setTick(tick + 1)
    }
  }
  const review = async (ev: ReviewEvent) => {
    if (!sel) return
    const r = await attempt(t('busy.review'), () => api.hosting.reviewPull(ref, sel.number, ev, comment).then(() => true), { refresh: false })
    if (r) {
      toast('success', t(`pulls.review.${ev}`))
      setComment('')
      setTick(tick + 1)
    }
  }
  const addComment = async () => {
    if (!sel || !comment.trim()) return
    const r = await attempt(t('busy.comment'), () => api.hosting.addComment(ref, sel.number, comment).then(() => true), { refresh: false })
    if (r) {
      setComment('')
      setTick(tick + 1)
    }
  }

  return (
    <div className="split" style={{ gridTemplateColumns: 'minmax(300px, 380px) 1fr' }}>
      <div className="pane left">
        <div className="pane-header">
          <select value={state} onChange={(e) => setState(e.target.value as typeof state)} style={{ width: 'auto' }}>
            <option value="open">{t('filter.open')}</option>
            <option value="closed">{t('filter.closed')}</option>
            <option value="all">{t('filter.all')}</option>
          </select>
          <label className="check small grow">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            {t('filter.mine')}
          </label>
          <button className="icon" onClick={() => setTick(tick + 1)} title={t('common.refresh')}>
            <Icon name="sync" />
          </button>
          <button className="primary" onClick={() => openDialog('createPull')}>
            <Icon name="plus" size={12} />
          </button>
        </div>
        <div className="scroll">
          {list === null && <Empty>{t('common.loading')}</Empty>}
          {list?.length === 0 && <Empty>{t('pulls.empty')}</Empty>}
          {list?.map((p) => (
            <div key={p.number} className={`list-item ${sel?.number === p.number ? 'selected' : ''}`} onClick={() => { setSel(p); setTab('info') }}>
              <Icon name="pull" />
              <span className="grow">
                <b>{p.title}</b>
                <div className="small muted">
                  #{p.number} · {p.author} · {p.head} → {p.base} · {relativeDate(p.updatedAt)}
                </div>
              </span>
              <span className={`pill ${p.state}`}>{p.draft ? t('pulls.draft') : t(`state.pr.${p.state}`)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="pane">
        {!sel ? (
          <Empty>{t('pulls.select')}</Empty>
        ) : (
          <>
            <div className="pane-header">
              <span className="title">
                #{sel.number} {sel.title}
              </span>
              <span className={`pill ${sel.state}`}>{t(`state.pr.${sel.state}`)}</span>
              <button className="icon" onClick={() => api.app.openExternal(sel.htmlUrl)} title={t('common.openInBrowser')}>
                <Icon name="external" />
              </button>
            </div>
            <div className="tabs">
              <button className={tab === 'info' ? 'active' : ''} onClick={() => setTab('info')}>
                {t('pulls.conversation')} ({comments.length})
              </button>
              <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>
                {t('pulls.files')} ({files.length})
              </button>
            </div>
            <div className="scroll" style={{ padding: tab === 'info' ? 14 : 0 }}>
              {tab === 'files' ? (
                files.map((f) => {
                  const d = patchToDiffFile(f.path, f.patch)
                  return (
                    <div key={f.path}>
                      <div className="pane-header mono small">
                        <span className="grow">{f.path}</span>
                        <span style={{ color: 'var(--ok)' }}>+{f.additions}</span>
                        <span style={{ color: 'var(--danger)' }}>−{f.deletions}</span>
                      </div>
                      {d ? <DiffView file={d} mode={mode} /> : <div className="muted small" style={{ padding: 8 }}>{t('diff.binary')}</div>}
                    </div>
                  )
                })
              ) : (
                <div className="col">
                  <div className="small muted">
                    {sel.author} · {sel.head} → {sel.base} · {formatDate(sel.createdAt)}
                    {sel.labels.length > 0 && ` · ${sel.labels.join(', ')}`}
                  </div>
                  <div className="section">{sel.body ? <Markdown text={sel.body} /> : <span className="muted">{t('common.noDescription')}</span>}</div>
                  {comments.map((c) => (
                    <div key={c.id} className="section">
                      <div className="small muted">
                        <b>{c.author}</b> · {relativeDate(c.createdAt)}
                      </div>
                      <Markdown text={c.body} />
                    </div>
                  ))}
                  <textarea rows={4} placeholder={t('pulls.commentPlaceholder')} value={comment} onChange={(e) => setComment(e.target.value)} />
                  <div className="row wrap">
                    <button onClick={addComment} disabled={!comment.trim()}>
                      {t('pulls.comment')}
                    </button>
                    {caps?.prReviews && sel.state === 'open' && (
                      <>
                        <button onClick={() => review('APPROVE')}>{t('pulls.approve')}</button>
                        <button onClick={() => review('REQUEST_CHANGES')} disabled={!comment.trim()}>
                          {t('pulls.requestChanges')}
                        </button>
                      </>
                    )}
                    <span className="grow" />
                    {sel.state === 'open' && caps?.prMerge && (
                      <>
                        <select value={method} onChange={(e) => setMethod(e.target.value as MergeMethod)} style={{ width: 'auto' }}>
                          <option value="merge">{t('pulls.method.merge')}</option>
                          <option value="squash">{t('pulls.method.squash')}</option>
                          <option value="rebase">{t('pulls.method.rebase')}</option>
                        </select>
                        <button className="primary" onClick={merge} disabled={sel.mergeable === false}>
                          {t('pulls.merge')}
                        </button>
                      </>
                    )}
                    {sel.state === 'open' && !caps?.prMerge && (
                      <button onClick={() => api.app.openExternal(sel.htmlUrl)}>{t('pulls.mergeOnWeb')}</button>
                    )}
                  </div>
                  {sel.mergeable === false && <div className="banner error">{t('pulls.notMergeable')}</div>}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
