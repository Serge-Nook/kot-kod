import { useEffect, useState } from 'react'
import type { Language, Settings as S } from '@shared/types'
import { api } from '../lib/api'
import { attempt, openDialog, showError, toast, updateSettings, useStore } from '../store'
import { useT } from '../i18n'

const SHORTCUT_KEYS = ['commit', 'push', 'pull', 'fetch', 'newBranch', 'changes', 'history', 'branches', 'openRepo', 'clone', 'settings', 'help', 'zoomIn', 'zoomOut', 'zoomReset']

export function keyCombo(e: KeyboardEvent | React.KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  let k = e.key
  if (k === ' ') k = 'Space'
  else if (k === '+') k = '='
  else if (k.length === 1) k = k.toUpperCase()
  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(k)) parts.push(k)
  return parts.join('+')
}

export default function Settings() {
  const t = useT()
  const s = useStore((x) => x.settings)
  const info = useStore((x) => x.info)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [recording, setRecording] = useState<string | null>(null)
  const [log, setLog] = useState<string | null>(null)
  useEffect(() => {
    api.git.config('').then((c) => {
      setName(c.name)
      setEmail(c.email)
    }).catch(() => undefined)
  }, [])
  if (!s) return null
  const set = (p: Partial<S>) => updateSettings(p).catch(showError)

  return (
    <div className="page">
      <h2>{t('nav.settings')}</h2>
      <div className="section">
        <h3>{t('settings.appearance')}</h3>
        <div className="grid2">
          <span>{t('settings.language')}</span>
          <select value={s.language} onChange={(e) => set({ language: e.target.value as Language })}>
            <option value="ru">Русский</option>
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
          <span>{t('settings.theme')}</span>
          <select value={s.theme} onChange={(e) => set({ theme: e.target.value as S['theme'] })}>
            <option value="dark">{t('settings.theme.dark')}</option>
            <option value="light">{t('settings.theme.light')}</option>
            <option value="system">{t('settings.theme.system')}</option>
          </select>
          <span>{t('settings.accent')}</span>
          <select value={s.accent} onChange={(e) => set({ accent: e.target.value as S['accent'] })}>
            <option value="forest">{t('settings.accent.forest')}</option>
            <option value="blue">{t('settings.accent.blue')}</option>
          </select>
          <span>{t('settings.zoom')}</span>
          <div className="row">
            <input type="range" min={1} max={2} step={0.1} value={s.zoom} onChange={(e) => set({ zoom: +e.target.value })} className="grow" />
            <span style={{ width: 48 }}>{Math.round(s.zoom * 100)}%</span>
          </div>
          <span>{t('settings.diffMode')}</span>
          <select value={s.diffMode} onChange={(e) => set({ diffMode: e.target.value as S['diffMode'] })}>
            <option value="unified">{t('diff.unified')}</option>
            <option value="split">{t('diff.split')}</option>
          </select>
        </div>
      </div>
      <div className="section">
        <h3>{t('settings.git')}</h3>
        <div className="grid2">
          <span>{t('settings.gitName')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
          <span>{t('settings.gitEmail')}</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} />
          <span />
          <div>
            <button
              onClick={() =>
                attempt(t('busy.save'), () => api.git.setConfig(null, name, email), { refresh: false }).then(() => toast('success', t('settings.saved')))
              }
            >
              {t('common.save')}
            </button>
          </div>
          <span>{t('settings.cloneDir')}</span>
          <div className="row">
            <input className="grow" value={s.cloneDir} onChange={(e) => set({ cloneDir: e.target.value })} />
            <button
              onClick={async () => {
                const d = await api.app.pickDirectory(t('settings.cloneDir'), s.cloneDir)
                if (d) set({ cloneDir: d })
              }}
            >
              …
            </button>
          </div>
          <span>{t('settings.autoFetch')}</span>
          <select value={s.autoFetchMinutes} onChange={(e) => set({ autoFetchMinutes: +e.target.value })}>
            <option value={0}>{t('settings.never')}</option>
            {[5, 10, 15, 30, 60].map((m) => (
              <option key={m} value={m}>
                {t('settings.everyMin', { n: m })}
              </option>
            ))}
          </select>
          <span>{t('settings.githubClientId')}</span>
          <input value={s.githubClientId} onChange={(e) => set({ githubClientId: e.target.value.trim() })} placeholder="Ov23li…" />
        </div>
        <div className="small muted">{t('settings.githubClientIdHint')}</div>
      </div>
      <div className="section">
        <h3>{t('settings.shortcuts')}</h3>
        <div className="grid2">
          {SHORTCUT_KEYS.map((k) => (
            <div key={k} style={{ display: 'contents' }}>
              <span>{t(`shortcut.${k}`)}</span>
              <input
                readOnly
                value={recording === k ? t('settings.pressKeys') : s.shortcuts[k] ?? ''}
                onFocus={() => setRecording(k)}
                onBlur={() => setRecording(null)}
                onKeyDown={(e) => {
                  e.preventDefault()
                  if (e.key === 'Escape') return (e.target as HTMLInputElement).blur()
                  const combo = keyCombo(e)
                  if (!combo || ['Ctrl', 'Shift', 'Alt'].includes(combo)) return
                  set({ shortcuts: { ...s.shortcuts, [k]: combo } })
                  ;(e.target as HTMLInputElement).blur()
                }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="section">
        <h3>{t('settings.updates')}</h3>
        <label className="check">
          <input type="checkbox" checked={s.checkUpdates} onChange={(e) => set({ checkUpdates: e.target.checked })} />
          {t('settings.checkUpdates')}
        </label>
        <div className="row">
          <button onClick={() => openDialog('update')}>{t('settings.checkNow')}</button>
          <button onClick={() => openDialog('about')}>{t('about.title')}</button>
        </div>
      </div>
      <div className="section">
        <h3>{t('settings.diagnostics')}</h3>
        <div className="grid2 small">
          <span>{t('settings.version')}</span>
          <span>{info?.version}</span>
          <span>Git</span>
          <span>{info?.gitVersion ?? t('err.GIT_MISSING')}</span>
          <span>{t('settings.configDir')}</span>
          <span className="mono">{info?.configDir}</span>
          <span>{t('settings.logDir')}</span>
          <span className="mono">{info?.logDir}</span>
        </div>
        <div className="row">
          <button onClick={() => info && api.app.openPath(info.logDir)}>{t('settings.openLogs')}</button>
          <button onClick={() => api.app.readLogTail().then(setLog)}>{t('settings.showLog')}</button>
          <button onClick={() => api.app.reportProblem()}>{t('help.report')}</button>
        </div>
        {log !== null && <pre className="code-box" style={{ maxHeight: 300 }}>{log}</pre>}
      </div>
    </div>
  )
}
