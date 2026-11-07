import { useEffect, useState } from 'react'
import type { Issue, IssueComment, Label } from '@shared/types'
import { api } from '../lib/api'
import { attempt, openDialog, showError, useStore } from '../store'
import { formatDate, relativeDate, useT } from '../i18n'
import { Empty, Icon, Markdown } from '../components/ui'
import { NeedHosting } from './Pulls'

export default function Issues() {
  const t = useT()
  const ref = useStore((s) => s.hostRef)
  const [state, setState] = useState<'open' | 'closed' | 'all'>('open')
  const [mine, setMine] = useState(false)
  const [list, setList] = useState<Issue[] | null>(null)
  const [sel, setSel] = useState<Issue | null>(null)
  const [comments, setComments] = useState<IssueComment[]>([])
  const [labels, setLabels] = useState<Label[]>([])
  const [comment, setComment] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!ref) return
    setList(null)
    api.hosting.issues(ref, state, mine).then(setList).catch((e) => {
      setList([])
      showError(e)
    })
    api.hosting.labels(ref).then(setLabels).catch(() => setLabels([]))
  }, [ref, state, mine, tick])
  useEffect(() => {
    if (!ref || !sel) return
    api.hosting.issueComments(ref, sel.number).then(setComments).catch(showError)
  }, [ref, sel, tick])

  if (!ref) return <NeedHosting />

  const refreshSel = (patch: Partial<Issue>) => {
    if (sel) setSel({ ...sel, ...patch })
    setTick(tick + 1)
  }
  const setIssueState = async (s: 'open' | 'closed') => {
    if (!sel) return
    const r = await attempt(t('busy.update'), () => api.hosting.setIssueState(ref, sel.number, s).then(() => true), { refresh: false })
    if (r) refreshSel({ state: s })
  }
  const toggleLabel = async (name: string) => {
    if (!sel) return
    const next = sel.labels.includes(name) ? sel.labels.filter((l) => l !== name) : [...sel.labels, name]
    const r = await attempt(t('busy.update'), () => api.hosting.setIssueLabels(ref, sel.number, next).then(() => true), { refresh: false })
    if (r) refreshSel({ labels: next })
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
          <button className="primary" onClick={() => openDialog('createIssue', { onDone: () => setTick((x) => x + 1) })}>
            <Icon name="plus" size={12} />
          </button>
        </div>
        <div className="scroll">
          {list === null && <Empty>{t('common.loading')}</Empty>}
          {list?.length === 0 && <Empty>{t('issues.empty')}</Empty>}
          {list?.map((i) => (
            <div key={i.number} className={`list-item ${sel?.number === i.number ? 'selected' : ''}`} onClick={() => setSel(i)}>
              <Icon name="issue" />
              <span className="grow">
                <b>{i.title}</b>
                <div className="small muted">
                  #{i.number} · {i.author} · {relativeDate(i.createdAt)}
                  {i.comments > 0 && ` · 💬 ${i.comments}`}
                </div>
              </span>
              <span className={`pill ${i.state}`}>{t(`state.issue.${i.state}`)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="pane">
        {!sel ? (
          <Empty>{t('issues.select')}</Empty>
        ) : (
          <>
            <div className="pane-header">
              <span className="title">
                #{sel.number} {sel.title}
              </span>
              <span className={`pill ${sel.state}`}>{t(`state.issue.${sel.state}`)}</span>
              <button className="icon" onClick={() => api.app.openExternal(sel.htmlUrl)} title={t('common.openInBrowser')}>
                <Icon name="external" />
              </button>
            </div>
            <div className="scroll" style={{ padding: 14 }}>
              <div className="col">
                <div className="small muted">
                  {sel.author} · {formatDate(sel.createdAt)}
                </div>
                {labels.length > 0 && (
                  <div className="row wrap">
                    {labels.map((l) => (
                      <button
                        key={l.name}
                        className="pill"
                        style={sel.labels.includes(l.name) ? { borderColor: `#${l.color}`, color: 'var(--fg)', background: `#${l.color}33` } : undefined}
                        onClick={() => toggleLabel(l.name)}
                      >
                        {l.name}
                      </button>
                    ))}
                  </div>
                )}
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
                <div className="row">
                  <button className="primary" onClick={addComment} disabled={!comment.trim()}>
                    {t('pulls.comment')}
                  </button>
                  <span className="grow" />
                  {sel.state === 'open' ? (
                    <button onClick={() => setIssueState('closed')}>{t('issues.close')}</button>
                  ) : (
                    <button onClick={() => setIssueState('open')}>{t('issues.reopen')}</button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
