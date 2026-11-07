import { useEffect, useState } from 'react'
import type { DiffFile, StashEntry } from '@shared/types'
import { api } from '../lib/api'
import { attempt, showError, useStore } from '../store'
import { relativeDate, useT } from '../i18n'
import { DiffView } from '../components/DiffView'
import { Empty } from '../components/ui'
import { confirmDialog, promptDialog } from '../components/dialogs/common'

export default function Stash() {
  const t = useT()
  const repo = useStore((s) => s.repo)!
  const revision = useStore((s) => s.revision)
  const mode = useStore((s) => s.settings?.diffMode ?? 'unified')
  const [list, setList] = useState<StashEntry[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [files, setFiles] = useState<DiffFile[]>([])
  const [file, setFile] = useState(0)

  useEffect(() => {
    api.git.stashList(repo).then(setList).catch(showError)
  }, [repo, revision])
  useEffect(() => {
    if (!sel) return setFiles([])
    api.git
      .stashDiff(repo, sel)
      .then((f) => {
        setFiles(f)
        setFile(0)
      })
      .catch(showError)
  }, [repo, sel])

  const push = async () => {
    const msg = await promptDialog({ title: t('stash.saveTitle'), label: t('stash.message'), value: '', check: t('stash.includeUntracked'), checked: true })
    if (msg === null) return
    await attempt(t('busy.stash'), () => api.git.stashPush(repo, typeof msg === 'string' ? msg : msg.value, typeof msg === 'string' ? true : msg.checked))
  }
  const apply = (ref: string, pop: boolean) => attempt(t('busy.stash'), () => api.git.stashApply(repo, ref, pop)).then(() => pop && setSel(null))
  const drop = async (ref: string) => {
    if (!(await confirmDialog({ title: t('stash.dropTitle'), text: t('stash.dropConfirm'), ok: t('common.delete'), danger: true }))) return
    await attempt(t('busy.stash'), () => api.git.stashDrop(repo, ref))
    setSel(null)
  }

  return (
    <div className="split">
      <div className="pane left">
        <div className="pane-header">
          <span className="title">{t('nav.stash')}</span>
          <button className="primary" onClick={push}>
            {t('stash.save')}
          </button>
        </div>
        <div className="scroll">
          {!list.length && <Empty>{t('stash.empty')}</Empty>}
          {list.map((s) => (
            <div key={s.ref} className={`list-item ${sel === s.ref ? 'selected' : ''}`} onClick={() => setSel(s.ref)}>
              <span className="grow">
                {s.message}
                <div className="small muted">
                  {s.ref} · {relativeDate(s.date)}
                </div>
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="pane">
        {sel ? (
          <>
            <div className="pane-header">
              <select value={file} onChange={(e) => setFile(+e.target.value)} className="grow">
                {files.map((f, i) => (
                  <option key={f.path} value={i}>
                    {f.path}
                  </option>
                ))}
              </select>
              <button className="primary" onClick={() => apply(sel, true)}>
                {t('stash.pop')}
              </button>
              <button onClick={() => apply(sel, false)}>{t('stash.apply')}</button>
              <button className="danger" onClick={() => drop(sel)}>
                {t('common.delete')}
              </button>
            </div>
            <div className="scroll">{files[file] && <DiffView file={files[file]} mode={mode} />}</div>
          </>
        ) : (
          <Empty>{t('stash.select')}</Empty>
        )}
      </div>
    </div>
  )
}
