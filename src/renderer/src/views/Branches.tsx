import { useState } from 'react'
import { api } from '../lib/api'
import { attempt, openDialog, toast, useStore } from '../store'
import { relativeDate, useT } from '../i18n'
import { Empty, Icon, showMenu } from '../components/ui'
import { confirmDialog, promptDialog } from '../components/dialogs/common'

export default function Branches() {
  const t = useT()
  const repo = useStore((s) => s.repo)!
  const branches = useStore((s) => s.branches)
  const status = useStore((s) => s.status)
  const [filter, setFilter] = useState('')
  const f = filter.toLowerCase()
  const local = branches.filter((b) => !b.remote && b.name.toLowerCase().includes(f))
  const remote = branches.filter((b) => b.remote && !b.name.endsWith('/HEAD') && b.name.toLowerCase().includes(f))
  const current = status?.branch

  const checkout = async (name: string) => {
    const dirty = (status?.files.length ?? 0) > 0
    let carry: 'keep' | 'stash' = 'keep'
    if (dirty) {
      const choice = await confirmDialog({
        title: t('branches.switchTitle'),
        text: t('branches.switchDirty', { name }),
        ok: t('branches.stashAndSwitch'),
        alt: t('branches.carryChanges')
      })
      if (!choice) return
      carry = choice === 'ok' ? 'stash' : 'keep'
    }
    await attempt(t('busy.checkout'), () => api.git.checkout(repo, name, carry))
  }

  const merge = async (name: string, mode: 'merge' | 'squash' | 'no-ff') => {
    if (!(await confirmDialog({ title: t('branches.mergeTitle'), text: t('branches.mergeConfirm', { from: name, into: current ?? 'HEAD' }), ok: t('branches.merge') }))) return
    const out = await attempt(t('busy.merge'), () => api.git.merge(repo, name, mode))
    if (out !== undefined) toast('success', t('branches.merged', { name }))
  }

  const rebase = async (name: string) => {
    if (!(await confirmDialog({ title: t('branches.rebaseTitle'), text: t('branches.rebaseConfirm', { branch: current ?? 'HEAD', onto: name }), ok: t('branches.rebase') }))) return
    const out = await attempt(t('busy.rebase'), () => api.git.rebase(repo, name))
    if (out !== undefined) toast('success', t('branches.rebased'))
  }

  const rename = async (name: string) => {
    const nn = await promptDialog({ title: t('branches.renameTitle'), label: t('branches.newName'), value: name })
    if (nn && nn !== name) await attempt(t('busy.rename'), () => api.git.renameBranch(repo, name, nn))
  }

  const del = async (name: string, hasUpstream: boolean) => {
    const choice = await confirmDialog({
      title: t('branches.deleteTitle'),
      text: t('branches.deleteConfirm', { name }),
      ok: t('common.delete'),
      danger: true,
      check: hasUpstream ? t('branches.deleteRemoteToo') : undefined
    })
    if (!choice) return
    const remoteToo = choice === 'ok+check'
    try {
      await attempt(t('busy.delete'), () => api.git.deleteBranch(repo, name, false, remoteToo))
    } catch {
      /* shown */
    }
  }

  const menu = (e: React.MouseEvent, name: string, isRemote: boolean, hasUpstream: boolean) =>
    showMenu(e, [
      { label: t('branches.checkout'), onClick: () => checkout(isRemote ? name.replace(/^[^/]+\//, '') : name), disabled: name === current },
      { sep: true },
      { label: t('branches.mergeInto', { into: current ?? 'HEAD' }), onClick: () => merge(name, 'merge'), disabled: name === current },
      { label: t('branches.mergeNoFf'), onClick: () => merge(name, 'no-ff'), disabled: name === current },
      { label: t('branches.squashInto'), onClick: () => merge(name, 'squash'), disabled: name === current },
      { label: t('branches.rebaseOnto', { onto: name }), onClick: () => rebase(name), disabled: name === current },
      { label: t('branches.interactiveRebase'), onClick: () => openDialog('rebase', { base: name }), disabled: name === current },
      { sep: true },
      { label: t('branches.newFrom'), onClick: () => openDialog('newBranch', { start: name }) },
      ...(isRemote
        ? []
        : [
            { label: t('branches.rename'), onClick: () => rename(name) },
            { label: t('common.delete'), danger: true, disabled: name === current, onClick: () => del(name, hasUpstream) }
          ])
    ])

  return (
    <div className="pane" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="pane-header">
        <span className="title">{t('nav.branches')}</span>
        <input placeholder={t('branches.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 240 }} />
        <button className="primary" onClick={() => openDialog('newBranch')}>
          <Icon name="plus" size={12} /> {t('branches.new')}
        </button>
      </div>
      <div className="scroll">
        <div className="pane-header muted small">{t('branches.local')}</div>
        {!local.length && <Empty>{t('branches.none')}</Empty>}
        {local.map((b) => (
          <div
            key={b.ref}
            className={`list-item ${b.current ? 'selected' : ''}`}
            onDoubleClick={() => !b.current && checkout(b.name)}
            onContextMenu={(e) => menu(e, b.name, false, !!b.upstream)}
          >
            <Icon name="branch" />
            <span className="grow">
              <b>{b.name}</b> {b.current && <span className="ref-badge">{t('branches.current')}</span>}
              {b.gone && <span className="ref-badge remote">{t('branches.gone')}</span>}
              <div className="small muted">
                {b.subject} · {relativeDate(b.date)}
              </div>
            </span>
            {b.upstream && (
              <span className="small muted" title={b.upstream}>
                ↑{b.ahead} ↓{b.behind}
              </span>
            )}
            <button className="icon" onClick={(e) => menu(e, b.name, false, !!b.upstream)}>
              ⋯
            </button>
          </div>
        ))}
        <div className="pane-header muted small">{t('branches.remote')}</div>
        {remote.map((b) => (
          <div key={b.ref} className="list-item" onDoubleClick={() => checkout(b.name.replace(/^[^/]+\//, ''))} onContextMenu={(e) => menu(e, b.name, true, false)}>
            <Icon name="branch" />
            <span className="grow">
              <span className="ref-badge remote">{b.name}</span>
              <div className="small muted">
                {b.subject} · {relativeDate(b.date)}
              </div>
            </span>
            <button className="icon" onClick={(e) => menu(e, b.name, true, false)}>
              ⋯
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
