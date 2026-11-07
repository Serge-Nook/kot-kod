import { useState } from 'react'
import { create } from 'zustand'
import { Dialog } from '../ui'
import { t } from '../../i18n'

export type ConfirmResult = 'ok' | 'ok+check' | 'alt' | null

interface ConfirmOpts {
  title: string
  text: string
  ok: string
  alt?: string
  danger?: boolean
  check?: string
}

interface PromptOpts {
  title: string
  label: string
  value: string
  check?: string
  checked?: boolean
  multiline?: boolean
}

type Pending =
  | { kind: 'confirm'; opts: ConfirmOpts; resolve: (r: ConfirmResult) => void }
  | { kind: 'prompt'; opts: PromptOpts; resolve: (r: string | { value: string; checked: boolean } | null) => void }

const usePending = create<{ p: Pending | null }>(() => ({ p: null }))

export function confirmDialog(opts: ConfirmOpts): Promise<ConfirmResult> {
  return new Promise((resolve) => usePending.setState({ p: { kind: 'confirm', opts, resolve } }))
}

/** Returns the string, or {value, checked} when `check` is given, or null if cancelled. */
export function promptDialog(opts: PromptOpts & { check: string }): Promise<{ value: string; checked: boolean } | null>
export function promptDialog(opts: PromptOpts): Promise<string | null>
export function promptDialog(opts: PromptOpts): Promise<unknown> {
  return new Promise((resolve) => usePending.setState({ p: { kind: 'prompt', opts, resolve } }))
}

export function ModalHost() {
  const p = usePending((s) => s.p)
  if (!p) return null
  const done = () => usePending.setState({ p: null })
  return p.kind === 'confirm' ? (
    <Confirm
      opts={p.opts}
      onDone={(r) => {
        done()
        p.resolve(r)
      }}
    />
  ) : (
    <Prompt
      opts={p.opts}
      onDone={(r) => {
        done()
        p.resolve(r)
      }}
    />
  )
}

function Confirm({ opts, onDone }: { opts: ConfirmOpts; onDone: (r: ConfirmResult) => void }) {
  const [checked, setChecked] = useState(false)
  return (
    <Dialog
      title={opts.title}
      onClose={() => onDone(null)}
      footer={
        <>
          <button onClick={() => onDone(null)}>{t('common.cancel')}</button>
          {opts.alt && <button onClick={() => onDone('alt')}>{opts.alt}</button>}
          <button autoFocus className={opts.danger ? 'danger' : 'primary'} onClick={() => onDone(checked ? 'ok+check' : 'ok')}>
            {opts.ok}
          </button>
        </>
      }
    >
      <div style={{ whiteSpace: 'pre-wrap' }}>{opts.text}</div>
      {opts.check && (
        <label className="check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          {opts.check}
        </label>
      )}
    </Dialog>
  )
}

function Prompt({ opts, onDone }: { opts: PromptOpts; onDone: (r: string | { value: string; checked: boolean } | null) => void }) {
  const [value, setValue] = useState(opts.value)
  const [checked, setChecked] = useState(!!opts.checked)
  const submit = () => onDone(opts.check ? { value, checked } : value)
  return (
    <Dialog
      title={opts.title}
      onClose={() => onDone(null)}
      footer={
        <>
          <button onClick={() => onDone(null)}>{t('common.cancel')}</button>
          <button className="primary" onClick={submit}>
            {t('common.ok')}
          </button>
        </>
      }
    >
      <label className="field">
        <span>{opts.label}</span>
        {opts.multiline ? (
          <textarea autoFocus rows={6} value={value} onChange={(e) => setValue(e.target.value)} />
        ) : (
          <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        )}
      </label>
      {opts.check && (
        <label className="check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          {opts.check}
        </label>
      )}
    </Dialog>
  )
}
