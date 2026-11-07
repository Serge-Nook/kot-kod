import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Commit, CommitFile, DiffFile } from '@shared/types'
import { layoutGraph, type GraphRow } from '@shared/graph'
import { api } from '../lib/api'
import { attempt, openDialog, showError, toast, useStore } from '../store'
import { formatDate, relativeDate, useT } from '../i18n'
import { DiffView } from '../components/DiffView'
import { Empty, copyText, showMenu } from '../components/ui'
import { confirmDialog } from '../components/dialogs/common'

const PAGE = 200
const ROW_H = 30
const LANE_W = 14
const COLORS = ['#2f81f7', '#3fb950', '#d29922', '#f85149', '#a371f7', '#db61a2', '#39c5cf', '#ffa657']

function GraphCell({ row, max }: { row: GraphRow; max: number }) {
  const w = Math.max(1, Math.min(max, row.width)) * LANE_W + 6
  const x = (l: number) => l * LANE_W + LANE_W / 2 + 3
  const mid = ROW_H / 2
  return (
    <svg width={w} height={ROW_H} style={{ flex: 'none' }}>
      {row.top.map((e, i) => (
        <path key={`t${i}`} d={`M${x(e.from)} 0 C${x(e.from)} ${mid / 2} ${x(e.to)} ${mid / 2} ${x(e.to)} ${mid}`} stroke={COLORS[e.color % COLORS.length]} strokeWidth={2} fill="none" />
      ))}
      {row.bottom.map((e, i) => (
        <path key={`b${i}`} d={`M${x(e.from)} ${mid} C${x(e.from)} ${mid * 1.5} ${x(e.to)} ${mid * 1.5} ${x(e.to)} ${ROW_H}`} stroke={COLORS[e.color % COLORS.length]} strokeWidth={2} fill="none" />
      ))}
      <circle cx={x(row.lane)} cy={mid} r={4.5} fill={COLORS[row.color % COLORS.length]} stroke="var(--bg)" strokeWidth={1.5} />
    </svg>
  )
}

export default function History() {
  const t = useT()
  const repo = useStore((s) => s.repo)!
  const revision = useStore((s) => s.revision)
  const status = useStore((s) => s.status)
  const mode = useStore((s) => s.settings?.diffMode ?? 'unified')
  const [commits, setCommits] = useState<Commit[]>([])
  const [search, setSearch] = useState('')
  const [all, setAll] = useState(true)
  const [more, setMore] = useState(true)
  const [sel, setSel] = useState<Commit | null>(null)
  const [files, setFiles] = useState<CommitFile[]>([])
  const [file, setFile] = useState<string | null>(null)
  const [diff, setDiff] = useState<DiffFile | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)

  const load = useCallback(
    async (skip: number) => {
      try {
        const q = search.trim()
        const isHash = /^[0-9a-f]{6,40}$/i.test(q)
        const list = await api.git.log(repo, { limit: PAGE, skip, all, search: q && !isHash ? q : undefined, ref: isHash ? q : undefined })
        setCommits((c) => (skip ? [...c, ...list] : list))
        setMore(list.length === PAGE)
      } catch (e) {
        if (skip === 0) setCommits([])
        if (status?.hasCommits !== false) showError(e)
      }
    },
    [repo, search, all, status?.hasCommits]
  )

  useEffect(() => {
    const id = setTimeout(() => load(0), 250)
    return () => clearTimeout(id)
  }, [load, revision])

  useEffect(() => {
    if (!sel) return
    api.git
      .commitFiles(repo, sel.hash)
      .then((f) => {
        setFiles(f)
        setFile(f[0]?.path ?? null)
      })
      .catch(showError)
  }, [repo, sel])
  useEffect(() => {
    if (!sel || !file) return setDiff(null)
    api.git.commitDiff(repo, sel.hash, file).then(setDiff).catch(showError)
  }, [repo, sel, file])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const rows = useMemo(() => (search ? null : layoutGraph(commits)), [commits, search])
  const maxLanes = 8
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 10)
  const last = Math.min(commits.length, Math.ceil((scrollTop + height) / ROW_H) + 10)

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    setScrollTop(el.scrollTop)
    if (more && el.scrollTop + el.clientHeight > el.scrollHeight - ROW_H * 20) {
      setMore(false)
      load(commits.length)
    }
  }

  const op = async (label: string, confirmText: string, fn: () => Promise<unknown>, danger = false) => {
    if (!(await confirmDialog({ title: label, text: confirmText, ok: label, danger }))) return
    const r = await attempt(label, async () => (await fn()) ?? true)
    if (r !== undefined) toast('success', t('history.done', { op: label }))
  }

  const menu = (e: React.MouseEvent, c: Commit) =>
    showMenu(e, [
      { label: t('history.copyHash'), onClick: () => copyText(c.hash) },
      { label: t('history.copySubject'), onClick: () => copyText(c.subject) },
      { sep: true },
      { label: t('history.newBranch'), onClick: () => openDialog('newBranch', { start: c.hash }) },
      { label: t('history.newTag'), onClick: () => openDialog('tag', { hash: c.hash }) },
      { label: t('history.checkout'), onClick: () => op(t('history.checkout'), t('history.checkoutConfirm', { hash: c.shortHash }), () => api.git.checkoutCommit(repo, c.hash)) },
      { sep: true },
      { label: t('history.cherryPick'), onClick: () => op(t('history.cherryPick'), t('history.cherryPickConfirm', { hash: c.shortHash, branch: status?.branch ?? 'HEAD' }), () => api.git.cherryPick(repo, c.hash)) },
      { label: t('history.revert'), onClick: () => op(t('history.revert'), t('history.revertConfirm', { hash: c.shortHash }), () => api.git.revert(repo, c.hash)) },
      { label: t('history.rebaseFrom'), onClick: () => openDialog('rebase', { base: c.hash }) },
      { sep: true },
      { label: t('history.resetSoft'), onClick: () => op(t('history.resetSoft'), t('history.resetSoftConfirm', { hash: c.shortHash }), () => api.git.reset(repo, c.hash, 'soft')) },
      { label: t('history.resetMixed'), onClick: () => op(t('history.resetMixed'), t('history.resetMixedConfirm', { hash: c.shortHash }), () => api.git.reset(repo, c.hash, 'mixed')) },
      { label: t('history.resetHard'), danger: true, onClick: () => op(t('history.resetHard'), t('history.resetHardConfirm', { hash: c.shortHash }), () => api.git.reset(repo, c.hash, 'hard'), true) }
    ])

  return (
    <div className="split" style={{ gridTemplateColumns: 'minmax(380px, 46%) 1fr' }}>
      <div className="pane left">
        <div className="pane-header">
          <input className="grow" placeholder={t('history.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
          <label className="check small">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            {t('history.allBranches')}
          </label>
        </div>
        <div className="scroll" ref={scroller} onScroll={onScroll}>
          {!commits.length && <Empty>{status?.hasCommits === false ? t('history.noCommits') : t('history.nothingFound')}</Empty>}
          <div style={{ height: commits.length * ROW_H, position: 'relative' }}>
            {commits.slice(first, last).map((c, i) => {
              const idx = first + i
              return (
                <div
                  key={c.hash}
                  className={`history-row ${sel?.hash === c.hash ? 'selected' : ''}`}
                  style={{ position: 'absolute', top: idx * ROW_H, left: 0, right: 0 }}
                  onClick={() => setSel(c)}
                  onContextMenu={(e) => menu(e, c)}
                  title={`${c.hash}\n${c.authorName} <${c.authorEmail}>\n${formatDate(c.date)}`}
                >
                  {rows ? <GraphCell row={rows[idx]} max={maxLanes} /> : <span style={{ width: 10 }} />}
                  <span className="subject">
                    {c.refs.map((r) => (
                      <span key={r} className={`ref-badge ${r.startsWith('tag: ') ? 'tag' : r.includes('/') ? 'remote' : ''}`}>
                        {r.replace(/^tag: /, '').replace(/^HEAD -> /, '')}
                      </span>
                    ))}
                    {c.subject}
                  </span>
                  <span className="small muted" style={{ width: 110, textAlign: 'right', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {c.authorName}
                  </span>
                  <span className="small muted" style={{ width: 90, textAlign: 'right' }}>
                    {relativeDate(c.date)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="pane">
        {sel ? (
          <>
            <div className="pane-header" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="row">
                <b className="grow">{sel.subject}</b>
                <button className="link mono small" onClick={() => copyText(sel.hash)} title={t('history.copyHash')}>
                  {sel.shortHash}
                </button>
              </div>
              {sel.body && <div className="small" style={{ whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>{sel.body}</div>}
              <div className="small muted">
                {sel.authorName} &lt;{sel.authorEmail}&gt; · {formatDate(sel.date)}
                {sel.parents.length > 1 && ` · ${t('history.mergeCommit')}`}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateRows: 'minmax(60px, 30%) 1fr', minHeight: 0, flex: 1 }}>
              <div className="scroll" style={{ borderBottom: '1px solid var(--border)' }}>
                {files.map((f) => (
                  <div key={f.path} className={`list-item ${file === f.path ? 'selected' : ''}`} onClick={() => setFile(f.path)}>
                    <span className={`st st-${f.status}`}>{f.status}</span>
                    <span className="path" title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}>
                      {f.path}
                    </span>
                  </div>
                ))}
              </div>
              <div className="scroll">{diff ? <DiffView file={diff} mode={mode} /> : <Empty>{t('history.selectFile')}</Empty>}</div>
            </div>
          </>
        ) : (
          <Empty>{t('history.selectCommit')}</Empty>
        )}
      </div>
    </div>
  )
}
