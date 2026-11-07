import { useMemo, useRef, useState } from 'react'
import hljs from 'highlight.js/lib/common'
import type { DiffFile, DiffHunk, DiffLine } from '@shared/types'
import { useT } from '../i18n'

const EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  cs: 'csharp', rb: 'ruby', php: 'php', sh: 'bash', bash: 'bash', json: 'json', yml: 'yaml', yaml: 'yaml',
  md: 'markdown', html: 'xml', xml: 'xml', css: 'css', scss: 'scss', sql: 'sql', swift: 'swift', lua: 'lua',
  toml: 'ini', ini: 'ini', diff: 'diff', mk: 'makefile', pl: 'perl', r: 'r', dart: 'dart', vue: 'xml'
}

export function languageFor(path: string): string | null {
  const name = path.split('/').pop() ?? ''
  if (/^(Makefile|makefile)$/.test(name)) return 'makefile'
  if (name === 'Dockerfile') return 'dockerfile'
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  const lang = EXT[ext]
  return lang && hljs.getLanguage(lang) ? lang : null
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function highlight(text: string, lang: string | null): string {
  if (!lang || text.length > 2000) return esc(text)
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
  } catch {
    return esc(text)
  }
}

export interface HunkAction {
  label: string
  danger?: boolean
  run: (hunkIndex: number) => void
}

export interface DiffSelection {
  selected: Map<number, Set<number>>
  toggle: (hunk: number, lines: number[]) => void
}

const MAX_LINES = 5000

export function DiffView({
  file,
  mode,
  selection,
  hunkActions
}: {
  file: DiffFile
  mode: 'split' | 'unified'
  selection?: DiffSelection
  hunkActions?: HunkAction[]
}) {
  const t = useT()
  const lang = useMemo(() => languageFor(file.path), [file.path])
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [showAll, setShowAll] = useState(false)
  const refs = useRef<(HTMLDivElement | null)[]>([])
  const [cursor, setCursor] = useState(0)
  if (file.binary) return <div className="empty-state">{t('diff.binary')}</div>
  if (file.tooLarge) return <div className="empty-state">{t('diff.tooLarge')}</div>
  if (!file.hunks.length) return <div className="empty-state">{t('diff.noChanges')}</div>
  const total = file.hunks.reduce((n, h) => n + h.lines.length, 0)
  let budget = showAll ? Infinity : MAX_LINES
  const jump = (d: number) => {
    const n = Math.max(0, Math.min(file.hunks.length - 1, cursor + d))
    setCursor(n)
    refs.current[n]?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  return (
    <div className="diff">
      {file.hunks.length > 1 && (
        <div className="hunk-head" style={{ position: 'sticky', top: 0, zIndex: 2 }}>
          <span className="grow">{t('diff.hunks', { n: file.hunks.length })}</span>
          <button onClick={() => jump(-1)}>↑ {t('diff.prevHunk')}</button>
          <button onClick={() => jump(1)}>↓ {t('diff.nextHunk')}</button>
        </div>
      )}
      {file.hunks.map((h, hi) => {
        if (budget <= 0) return null
        budget -= h.lines.length
        const isCollapsed = collapsed.has(hi)
        return (
          <div key={hi} ref={(el) => (refs.current[hi] = el)}>
            <div className="hunk-head">
              <button
                className="icon"
                onClick={() => {
                  const n = new Set(collapsed)
                  if (n.has(hi)) n.delete(hi)
                  else n.add(hi)
                  setCollapsed(n)
                }}
                title={isCollapsed ? t('diff.expand') : t('diff.collapse')}
              >
                {isCollapsed ? '▸' : '▾'}
              </button>
              <span className="grow mono small">{h.header}</span>
              {selection && (
                <button
                  onClick={() =>
                    selection.toggle(
                      hi,
                      h.lines.map((l, i) => (l.type === 'add' || l.type === 'del' ? i : -1)).filter((i) => i >= 0)
                    )
                  }
                >
                  {t('diff.selectHunk')}
                </button>
              )}
              {hunkActions?.map((a) => (
                <button key={a.label} className={a.danger ? 'danger' : ''} onClick={() => a.run(hi)}>
                  {a.label}
                </button>
              ))}
            </div>
            {!isCollapsed &&
              (mode === 'unified' ? (
                <Unified hunk={h} hi={hi} lang={lang} selection={selection} />
              ) : (
                <Split hunk={h} hi={hi} lang={lang} selection={selection} />
              ))}
          </div>
        )
      })}
      {!showAll && total > MAX_LINES && (
        <div className="hunk-head">
          <button onClick={() => setShowAll(true)}>{t('diff.showAll', { n: total })}</button>
        </div>
      )}
    </div>
  )
}

function pickClass(sel: DiffSelection | undefined, hi: number, li: number, l: DiffLine): string {
  if (!sel || (l.type !== 'add' && l.type !== 'del')) return ''
  return sel.selected.get(hi)?.has(li) ? 'picked' : 'unpicked'
}

function Unified({ hunk, hi, lang, selection }: { hunk: DiffHunk; hi: number; lang: string | null; selection?: DiffSelection }) {
  return (
    <table>
      <tbody>
        {hunk.lines.map((l, li) => {
          const sign = l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '
          const changeable = l.type === 'add' || l.type === 'del'
          return (
            <tr key={li} className={`${l.type} ${pickClass(selection, hi, li, l)}`}>
              <td className="ln" onClick={() => changeable && selection?.toggle(hi, [li])}>
                {l.oldNo ?? ''}
              </td>
              <td className="ln" onClick={() => changeable && selection?.toggle(hi, [li])}>
                {l.newNo ?? ''}
              </td>
              {l.type === 'nonl' ? (
                <td className="code muted">{l.text}</td>
              ) : (
                <td className="code" dangerouslySetInnerHTML={{ __html: sign + highlight(l.text, lang) }} />
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

interface SplitRow {
  left?: { line: DiffLine; li: number }
  right?: { line: DiffLine; li: number }
}

function toSplitRows(h: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = []
  let dels: { line: DiffLine; li: number }[] = []
  let adds: { line: DiffLine; li: number }[] = []
  const flush = () => {
    const n = Math.max(dels.length, adds.length)
    for (let i = 0; i < n; i++) rows.push({ left: dels[i], right: adds[i] })
    dels = []
    adds = []
  }
  h.lines.forEach((line, li) => {
    if (line.type === 'del') dels.push({ line, li })
    else if (line.type === 'add') adds.push({ line, li })
    else if (line.type === 'ctx') {
      flush()
      rows.push({ left: { line, li }, right: { line, li } })
    }
  })
  flush()
  return rows
}

function Split({ hunk, hi, lang, selection }: { hunk: DiffHunk; hi: number; lang: string | null; selection?: DiffSelection }) {
  const rows = useMemo(() => toSplitRows(hunk), [hunk])
  const cell = (side: { line: DiffLine; li: number } | undefined, which: 'old' | 'new') => {
    if (!side) return [<td key="n" className="ln" />, <td key="c" className="code empty" />]
    const l = side.line
    const cls = l.type === 'ctx' ? '' : l.type
    const picked = pickClass(selection, hi, side.li, l)
    return [
      <td
        key="n"
        className={`ln ${cls}`}
        style={picked === 'picked' ? { boxShadow: 'inset 4px 0 0 var(--accent)' } : undefined}
        onClick={() => l.type !== 'ctx' && selection?.toggle(hi, [side.li])}
      >
        {which === 'old' ? l.oldNo : l.newNo}
      </td>,
      <td
        key="c"
        className={`code ${cls}`}
        style={picked === 'unpicked' ? { opacity: 0.55 } : undefined}
        dangerouslySetInnerHTML={{ __html: highlight(l.text, lang) }}
      />
    ]
  }
  return (
    <table style={{ tableLayout: 'fixed' }}>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {cell(r.left, 'old')}
            {cell(r.right, 'new')}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function patchToDiffFile(path: string, patch: string | undefined): DiffFile | null {
  if (!patch) return null
  // lazy import keeps parse.ts out of the critical path
  return { path, binary: false, isNew: false, isDeleted: false, headerLines: [], hunks: parseHunks(patch) }
}

function parseHunks(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let cur: DiffHunk | null = null
  let o = 0
  let n = 0
  for (const line of patch.split('\n')) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line)
    if (m) {
      cur = { header: line, oldStart: +m[1], oldLines: +(m[2] ?? 1), newStart: +m[3], newLines: +(m[4] ?? 1), section: m[5] ?? '', lines: [] }
      o = cur.oldStart
      n = cur.newStart
      hunks.push(cur)
      continue
    }
    if (!cur) continue
    if (line.startsWith('+')) cur.lines.push({ type: 'add', text: line.slice(1), newNo: n++ })
    else if (line.startsWith('-')) cur.lines.push({ type: 'del', text: line.slice(1), oldNo: o++ })
    else if (line.startsWith('\\')) cur.lines.push({ type: 'nonl', text: line })
    else cur.lines.push({ type: 'ctx', text: line.slice(1), oldNo: o++, newNo: n++ })
  }
  return hunks
}
