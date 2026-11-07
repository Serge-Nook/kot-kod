import { api } from '../lib/api'
import { attempt, openDialog, reloadAccounts, toast, useStore } from '../store'
import { formatDate, useT } from '../i18n'
import { Avatar, Empty, Icon } from '../components/ui'
import { confirmDialog } from '../components/dialogs/common'

export default function Accounts() {
  const t = useT()
  const accounts = useStore((s) => s.accounts)
  const providers = useStore((s) => s.providers)
  const active = useStore((s) => s.settings?.activeAccountId)
  const info = useStore((s) => s.info)

  const remove = async (id: string, login: string) => {
    const r = await confirmDialog({ title: t('accounts.logout'), text: t('accounts.logoutConfirm', { login }), ok: t('accounts.logout'), danger: true, check: t('accounts.revoke') })
    if (!r) return
    await attempt(t('busy.logout'), () => api.accounts.remove(id, r === 'ok+check'), { refresh: false })
    await reloadAccounts()
    toast('info', t('accounts.loggedOut', { login }))
  }

  return (
    <div className="page">
      <h2>{t('nav.accounts')}</h2>
      <div className="section">
        <div className="row">
          <span className="grow muted">{t('accounts.hint')}</span>
          <button className="primary" onClick={() => openDialog('addAccount')}>
            <Icon name="plus" size={12} /> {t('accounts.add')}
          </button>
        </div>
        <div className="small muted">
          <Icon name="lock" size={12} /> {t(`accounts.backend.${info?.secretsBackend ?? 'keyring'}`)}
        </div>
      </div>
      {!accounts.length && <Empty>{t('accounts.none')}</Empty>}
      {accounts.map((a) => {
        const p = providers.find((x) => x.id === a.provider)
        return (
          <div key={a.id} className="section">
            <div className="row">
              <Avatar url={a.avatarUrl} />
              <span className="grow">
                <b>{a.name || a.login}</b> <span className="muted">@{a.login}</span>
                <div className="small muted">
                  {p?.title ?? a.provider} · {t(`accounts.method.${a.authMethod}`)} · {formatDate(a.addedAt)}
                  {a.email && ` · ${a.email}`}
                </div>
              </span>
              {active === a.id ? (
                <span className="pill open">{t('accounts.active')}</span>
              ) : (
                <button onClick={() => api.accounts.setActive(a.id).then(reloadAccounts)}>{t('accounts.makeActive')}</button>
              )}
              {p && <button onClick={() => api.app.openExternal(`${p.webUrl}/${a.login}`)}>{t('accounts.profile')}</button>}
              <button className="danger" onClick={() => remove(a.id, a.login)}>
                {t('accounts.logout')}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
