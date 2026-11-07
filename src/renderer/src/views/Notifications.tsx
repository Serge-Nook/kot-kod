import { useEffect, useState } from 'react'
import type { HostNotification } from '@shared/types'
import { api } from '../lib/api'
import { showError, useStore } from '../store'
import { relativeDate, useT } from '../i18n'
import { Empty, Icon } from '../components/ui'

export default function Notifications() {
  const t = useT()
  const accounts = useStore((s) => s.accounts)
  const providers = useStore((s) => s.providers)
  const supported = accounts.filter((a) => providers.find((p) => p.id === a.provider)?.capabilities.notifications)
  const [items, setItems] = useState<(HostNotification & { accountId: string })[] | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    setItems(null)
    Promise.all(supported.map((a) => api.hosting.notifications(a.id).then((l) => l.map((n) => ({ ...n, accountId: a.id }))).catch((e) => (showError(e), []))))
      .then((all) => {
        const flat = all.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        setItems(flat)
        useStore.setState({ unread: flat.filter((n) => n.unread).length })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, tick])

  const open = async (n: HostNotification & { accountId: string }) => {
    if (n.url) api.app.openExternal(n.url)
    if (n.unread) {
      await api.hosting.markNotificationRead(n.accountId, n.id).catch(showError)
      setTick(tick + 1)
    }
  }
  const unsupported = accounts.filter((a) => !supported.includes(a))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="pane-header">
        <span className="title">{t('nav.notifications')}</span>
        <button className="icon" onClick={() => setTick(tick + 1)} title={t('common.refresh')}>
          <Icon name="sync" />
        </button>
      </div>
      {unsupported.length > 0 && (
        <div className="banner info">{t('notifications.unsupported', { list: unsupported.map((a) => `${a.login} (${a.provider})`).join(', ') })}</div>
      )}
      <div className="scroll">
        {!accounts.length && <Empty>{t('hosting.noAccount')}</Empty>}
        {items === null && accounts.length > 0 && <Empty>{t('common.loading')}</Empty>}
        {items?.length === 0 && <Empty>{t('notifications.empty')}</Empty>}
        {items?.map((n) => (
          <div key={`${n.accountId}:${n.id}`} className="list-item" onClick={() => open(n)} style={{ opacity: n.unread ? 1 : 0.6 }}>
            <Icon name={n.type === 'PullRequest' ? 'pull' : n.type === 'Issue' ? 'issue' : 'bell'} />
            <span className="grow">
              {n.unread ? <b>{n.title}</b> : n.title}
              <div className="small muted">
                {n.repoFullName} · {t(`notifications.reason.${n.reason}`) !== `notifications.reason.${n.reason}` ? t(`notifications.reason.${n.reason}`) : n.reason} · {relativeDate(n.updatedAt)}
              </div>
            </span>
            {n.unread && <span className="badge">•</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
