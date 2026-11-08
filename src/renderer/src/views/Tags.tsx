import { useEffect, useState } from 'react'
import type { Tag } from '@shared/types'
import { api } from '../lib/api'
import { attempt, openDialog, showError, toast, useStore } from '../store'
import { formatDate, useT } from '../i18n'
import { Empty, Icon, showMenu } from '../components/ui'
import { confirmDialog } from '../components/dialogs/common'

export default function Tags() {
  const t = useT()
  const repo = useStore((s) => s.repo)!
  const revision = useStore((s) => s.revision)
  const hostRef = useStore((s) => s.hostRef)
  const [tags, setTags] = useState<Tag[]>([])
  useEffect(() => {
    api.git.tags(repo).then(setTags).catch(showError)
  }, [repo, revision])

  const del = async (name: string) => {
    const r = await confirmDialog({ title: t('tags.deleteTitle'), text: t('tags.deleteConfirm', { name }), ok: t('common.delete'), danger: true, check: t('tags.deleteRemoteToo') })
    if (r) await attempt(t('busy.delete'), () => api.git.deleteTag(repo, name, r === 'ok+check'))
  }
  const push = async (name: string) => {
    const r = await attempt(t('busy.push'), () => api.git.pushTag(repo, name).then(() => true))
    if (r) toast('success', t('tags.pushed', { name }))
  }

  const release = (tag: string) => {
    useStore.setState({ view: 'releases' })
    openDialog('release', { tag })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="pane-header">
        <span className="title">{t('nav.tags')}</span>
        <button className="primary" onClick={() => openDialog('tag', { hash: 'HEAD' })}>
          <Icon name="plus" size={12} /> {t('tags.new')}
        </button>
      </div>
      <div className="scroll">
        {!tags.length && <Empty>{t('tags.empty')}</Empty>}
        {tags.map((tg) => (
          <div
            key={tg.name}
            className="list-item"
            onContextMenu={(e) =>
              showMenu(e, [
                { label: t('tags.push'), onClick: () => push(tg.name) },
                ...(hostRef ? [{ label: t('releases.fromTag'), onClick: () => release(tg.name) }] : []),
                { label: t('common.delete'), danger: true, onClick: () => del(tg.name) }
              ])
            }
          >
            <Icon name="tag" />
            <span className="grow">
              <b>{tg.name}</b> <span className="mono small muted">{tg.hash.slice(0, 8)}</span>
              <div className="small muted">
                {tg.subject} · {formatDate(tg.date)}
              </div>
            </span>
            <button onClick={() => push(tg.name)}>{t('tags.push')}</button>
            {hostRef && <button onClick={() => release(tg.name)}>{t('releases.fromTag')}</button>}
            <button className="icon" onClick={() => del(tg.name)} title={t('common.delete')}>
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
