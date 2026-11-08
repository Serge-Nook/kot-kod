import { useEffect, useRef, useState, type ReactNode } from 'react'
import { closeDialog, dismissToast, useStore } from '../store'
import { useT } from '../i18n'

const ICONS: Record<string, string> = {
  changes: 'M3 3h10v2H3zM3 7h10v2H3zM3 11h6v2H3z',
  history: 'M8 1a7 7 0 1 0 7 7h-2a5 5 0 1 1-1.46-3.54L9.5 6.5H15V1l-2.05 2.05A7 7 0 0 0 8 1zm-.75 3v4.4l3.2 1.9.75-1.25-2.45-1.45V4z',
  branch: 'M5 2a2 2 0 0 0-1 3.73v4.54a2 2 0 1 0 2 0V9c0-.55.45-1 1-1h2a3 3 0 0 0 3-3v-.27a2 2 0 1 0-2 0V5a1 1 0 0 1-1 1H7c-.35 0-.69.06-1 .17V5.73A2 2 0 0 0 5 2z',
  stash: 'M2 3h12v3H2zm1 4h10v6H3zm3 2v1h4V9z',
  tag: 'M2 2h6l6 6-6 6-6-6zm3 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  pull: 'M4 2a2 2 0 0 0-1 3.73v4.54a2 2 0 1 0 2 0V5.73A2 2 0 0 0 4 2zm7 1V1L8 4l3 3V5h1v5.27a2 2 0 1 0 2 0V4a1 1 0 0 0-1-1z',
  issue: 'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 2a5 5 0 1 1 0 10A5 5 0 0 1 8 3zm0 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  bell: 'M8 1a4 4 0 0 0-4 4v3l-2 3h12l-2-3V5a4 4 0 0 0-4-4zM6 13a2 2 0 0 0 4 0z',
  repo: 'M3 1h9a1 1 0 0 1 1 1v12H4a1 1 0 0 1-1-1zm2 2v8h6V3zm-1 9v1h7v-1z',
  user: 'M8 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM2 14c0-3 3-5 6-5s6 2 6 5z',
  gear: 'M7 1h2l.4 2 1.6.7 1.7-1.2 1.4 1.4-1.2 1.7.7 1.6 2 .4v2l-2 .4-.7 1.6 1.2 1.7-1.4 1.4-1.7-1.2-1.6.7L9 15H7l-.4-2-1.6-.7-1.7 1.2-1.4-1.4 1.2-1.7L2.4 9 1 9V7l2-.4.7-1.6-1.2-1.7 1.4-1.4 1.7 1.2L7 2.4zm1 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  help: 'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm-.9 10h1.8v1.8H7.1zM8 3.5c1.7 0 3 1.1 3 2.6 0 1.1-.6 1.7-1.4 2.2-.6.4-.7.6-.7 1.2H7.1c0-1.1.4-1.7 1.2-2.2.6-.4.9-.6.9-1.2 0-.6-.5-1-1.2-1s-1.2.5-1.3 1.1H5c.1-1.6 1.4-2.7 3-2.7z',
  info: 'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm-1 6h2v5H7zm0-3h2v2H7z',
  sync: 'M8 2a6 6 0 0 1 5.2 3H11v2h5V2h-2v1.5A8 8 0 0 0 0 8h2a6 6 0 0 1 6-6zm6 6a6 6 0 0 1-11.2 3H5V9H0v5h2v-1.5A8 8 0 0 0 16 8z',
  up: 'M8 2l5 5h-3v7H6V7H3z',
  down: 'M8 14l5-5h-3V2H6v7H3z',
  plus: 'M7 2h2v5h5v2H9v5H7V9H2V7h5z',
  close: 'M3.4 2L8 6.6 12.6 2 14 3.4 9.4 8l4.6 4.6-1.4 1.4L8 9.4 3.4 14 2 12.6 6.6 8 2 3.4z',
  folder: 'M1 3h5l2 2h7v9H1z',
  terminal: 'M1 2h14v12H1zm2 3l3 3-3 3 1 1 4-4-4-4zm4 6v1h5v-1z',
  copy: 'M4 1h8v2H6v9H4zm3 3h8v11H7z',
  lock: 'M5 7V5a3 3 0 0 1 6 0v2h2v8H3V7zm2 0h2V5a1 1 0 0 0-2 0z',
  release: 'M8 1l6 3v8l-6 3-6-3V4zm0 2.2L4.5 5 8 6.8 11.5 5zM3.5 6.2v5l3.75 1.9v-5zm9 0l-3.75 1.9v5l3.75-1.9z',
  external: 'M9 1h6v6l-2.3-2.3L8 9.4 6.6 8l4.7-4.7zM1 3h6v2H3v8h8V9h2v6H1z'
}

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden style={{ flex: 'none' }}>
      <path d={ICONS[name] ?? ICONS.info} fillRule="evenodd" />
    </svg>
  )
}

export function Dialog({
  title,
  children,
  footer,
  wide,
  onClose
}: {
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  onClose?: () => void
}) {
  const close = onClose ?? closeDialog
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [close])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog">
        <header>
          <span className="grow">{title}</span>
          <button className="icon" onClick={close} aria-label="close">
            <Icon name="close" />
          </button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  )
}

export interface MenuItem {
  label?: string
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
  sep?: boolean
}

let openMenuFn: ((x: number, y: number, items: MenuItem[]) => void) | null = null
export function showMenu(e: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuItem[]): void {
  e.preventDefault()
  openMenuFn?.(e.clientX, e.clientY, items)
}

export function MenuHost() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    openMenuFn = (x, y, items) => setMenu({ x, y, items })
    const close = () => setMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [])
  if (!menu) return null
  const x = Math.min(menu.x, window.innerWidth - 230)
  const y = Math.min(menu.y, window.innerHeight - menu.items.length * 30 - 10)
  return (
    <div className="menu" style={{ left: x, top: Math.max(4, y) }} ref={ref} onMouseDown={(e) => e.stopPropagation()}>
      {menu.items.map((it, i) =>
        it.sep ? (
          <div key={i} className="sep" />
        ) : (
          <button
            key={i}
            disabled={it.disabled}
            style={it.danger ? { color: 'var(--danger)' } : undefined}
            onClick={() => {
              setMenu(null)
              it.onClick?.()
            }}
          >
            {it.label}
          </button>
        )
      )}
    </div>
  )
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const [open, setOpen] = useState<number | null>(null)
  const t = useT()
  return (
    <div className="toasts">
      {toasts.map((x) => (
        <div key={x.id} className={`toast ${x.kind}`}>
          <div className="row">
            <span className="grow" style={{ whiteSpace: 'pre-wrap' }}>
              {x.text}
            </span>
            <button className="icon" onClick={() => dismissToast(x.id)}>
              <Icon name="close" size={12} />
            </button>
          </div>
          <div className="row" style={{ marginTop: 4 }}>
            {x.details && (
              <button className="link small" onClick={() => setOpen(open === x.id ? null : x.id)}>
                {t('common.details')}
              </button>
            )}
            {x.action && (
              <button
                className="link small"
                onClick={() => {
                  dismissToast(x.id)
                  x.action!.run()
                }}
              >
                {x.action.label}
              </button>
            )}
          </div>
          {open === x.id && x.details && <pre>{x.details}</pre>}
        </div>
      ))}
    </div>
  )
}

export function Progress() {
  const busy = useStore((s) => s.busy)
  const progress = useStore((s) => s.progress)
  if (!busy) return <div className="progress" />
  const pct = progress?.percent
  return (
    <div className={`progress ${pct == null ? 'indeterminate' : ''}`} title={progress?.line ?? busy}>
      <div style={pct != null ? { width: `${pct}%` } : undefined} />
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>
}

export function Avatar({ url }: { url?: string }) {
  if (!url) return <span className="avatar" />
  return <img className="avatar" src={url} alt="" />
}

/** Minimal Markdown renderer (headings, lists, code, bold, links). */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.split('\n')
  let i = 0
  const inline = (s: string, key: number): ReactNode => {
    const parts: ReactNode[] = []
    const re = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g
    let last = 0
    let m: RegExpExecArray | null
    let k = 0
    while ((m = re.exec(s))) {
      if (m.index > last) parts.push(s.slice(last, m.index))
      const tok = m[0]
      if (tok.startsWith('`')) parts.push(<code key={k++}>{tok.slice(1, -1)}</code>)
      else if (tok.startsWith('**')) parts.push(<b key={k++}>{tok.slice(2, -2)}</b>)
      else {
        const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!
        parts.push(
          <a key={k++} href={mm[2]} target="_blank" rel="noreferrer">
            {mm[1]}
          </a>
        )
      }
      last = m.index + tok.length
    }
    if (last < s.length) parts.push(s.slice(last))
    return <span key={key}>{parts}</span>
  }
  while (i < lines.length) {
    const l = lines[i]
    if (l.startsWith('```')) {
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++])
      i++
      blocks.push(<pre key={i}>{buf.join('\n')}</pre>)
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(l)
    if (h) {
      const level = h[1].length
      const content = inline(h[2], 0)
      blocks.push(
        level === 1 ? <h1 key={i}>{content}</h1> : level === 2 ? <h2 key={i}>{content}</h2> : <h3 key={i}>{content}</h3>
      )
      i++
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l)
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(<li key={i}>{inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''), i)}</li>)
        i++
      }
      blocks.push(ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>)
      continue
    }
    if (!l.trim()) {
      i++
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#|```|\s*([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++])
    blocks.push(<p key={i}>{inline(para.join(' '), i)}</p>)
  }
  return <div className="markdown">{blocks}</div>
}

export function copyText(s: string): void {
  navigator.clipboard.writeText(s).catch(() => undefined)
}
