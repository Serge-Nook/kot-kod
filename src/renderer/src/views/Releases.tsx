import { useEffect, useState } from 'react'
import type { Release, ReleaseAsset } from '@shared/types'
import { api } from '../lib/api'
import { attempt, openDialog, showError, toast, useStore } from '../store'
import { formatDate, relativeDate, useT } from '../i18n'
import { Empty, Icon, Markdown, copyText, showMenu } from '../components/ui'
import { confirmDialog } from '../components/dialogs/common'
import { NeedHosting } from './Pulls'

export function formatSize(n: number, t: ReturnType<typeof useT>): string {
  if (n < 1024) return t('size.b', { n })
  const units = ['size.kb', 'size.mb', 'size.gb']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return t(units[i], { n: v.toFixed(v < 10 ? 1 : 0) })
}

function ReleasePills({ r, latest }: { r: Release; latest: boolean }) {
  const t = useT()
  return (
    <>
      {r.draft && <span className="pill">{t('releases.draft')}</span>}
      {r.prerelease && <span className="pill merged">{t('releases.prerelease')}</span>}
      {latest && <span className="pill open">{t('releases.latest')}</span>}
    </>
  )
}

export default function Releases() {
  const t = useT()
  const ref = useStore((s) => s.hostRef)
  const providers = useStore((s) => s.providers)
  const accounts = useStore((s) => s.accounts)
  const [list, setList] = useState<Release[] | null>(null)
  const [selId, setSelId] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = () => setTick((x) => x + 1)

  useEffect(() => {
    if (!ref) return
    setList(null)
    api.hosting
      .releases(ref)
      .then((l) => {
        setList(l)
        setSelId((id) => (id && l.some((r) => r.id === id) ? id : (l[0]?.id ?? null)))
      })
      .catch((e) => {
        setList([])
        showError(e)
      })
  }, [ref, tick])

  if (!ref) return <NeedHosting />
  const provider = providers.find((p) => p.id === accounts.find((a) => a.id === ref.accountId)?.provider)
  if (provider && !provider.capabilities.releases) return <Empty>{t('releases.notSupported')}</Empty>

  const sel = list?.find((r) => r.id === selId) ?? null
  const latestId = list?.find((r) => !r.draft && !r.prerelease)?.id
  const replace = (r: Release) => setList((l) => l?.map((x) => (x.id === r.id ? r : x)) ?? l)

  const copyLink = (url: string) => {
    copyText(url)
    toast('info', t('releases.linkCopied'))
  }
  const download = async (assets: ReleaseAsset[]) => {
    if (!assets.length) return
    const dir = await api.app.pickDirectory(t('releases.pickDir'))
    if (!dir) return
    const paths = await attempt(t('busy.download'), () => api.hosting.downloadAssets(ref, assets, dir), { refresh: false })
    if (paths?.length)
      toast('success', t('releases.downloaded', { n: paths.length }), undefined, {
        label: t('releases.showInFolder'),
        run: () => void api.app.showInFolder(paths[0])
      })
  }
  const upload = async (r: Release) => {
    const files = await api.app.pickFiles(t('releases.pickFiles'))
    if (!files.length) return
    const res = await attempt(t('busy.upload'), () => api.hosting.uploadAssets(ref, r.id, files), { refresh: false })
    if (res) {
      replace(res)
      toast('success', t('releases.uploaded', { n: files.length }))
    }
  }
  const deleteAsset = async (r: Release, a: ReleaseAsset) => {
    const ok = await confirmDialog({ title: t('releases.deleteAssetTitle'), text: t('releases.deleteAssetConfirm', { name: a.name }), ok: t('common.delete'), danger: true })
    if (!ok) return
    const done = await attempt(t('busy.delete'), () => api.hosting.deleteAsset(ref, r.id, a.id).then(() => true), { refresh: false })
    if (done) replace({ ...r, assets: r.assets.filter((x) => x.id !== a.id) })
  }
  const deleteRelease = async (r: Release) => {
    const ok = await confirmDialog({ title: t('releases.deleteTitle'), text: t('releases.deleteConfirm', { name: r.name }), ok: t('common.delete'), danger: true })
    if (!ok) return
    const done = await attempt(t('busy.delete'), () => api.hosting.deleteRelease(ref, r.id).then(() => true), { refresh: false })
    if (done) {
      toast('success', t('releases.deleted'))
      reload()
    }
  }
  const publish = async (r: Release) => {
    const res = await attempt(t('busy.release'), () => api.hosting.updateRelease(ref, r.id, { draft: false }), { refresh: false })
    if (res) {
      replace(res)
      toast('success', t('releases.published', { name: res.name }))
    }
  }
  const edit = (r: Release) => openDialog('release', { release: r, onDone: replace })
  const copyTo = (r: Release) => openDialog('copyRelease', { release: r })
  const menu = (r: Release) => [
    { label: t('releases.edit'), onClick: () => edit(r) },
    { label: t('releases.upload'), onClick: () => upload(r) },
    { label: t('releases.downloadAll'), onClick: () => download(r.assets) },
    { label: t('releases.copyTo'), onClick: () => copyTo(r) },
    { label: t('releases.copyLink'), onClick: () => copyLink(r.htmlUrl) },
    { label: t('common.openInBrowser'), onClick: () => api.app.openExternal(r.htmlUrl) },
    { label: t('common.delete'), danger: true, onClick: () => deleteRelease(r) }
  ]

  return (
    <div className="split" style={{ gridTemplateColumns: 'minmax(280px, 360px) 1fr' }}>
      <div className="pane left">
        <div className="pane-header">
          <span className="title grow">{t('nav.releases')}</span>
          <button className="icon" onClick={reload} title={t('common.refresh')}>
            <Icon name="sync" />
          </button>
          <button
            className="primary"
            title={t('releases.new')}
            onClick={() => openDialog('release', { onDone: (r: Release) => (reload(), setSelId(r.id)) })}
          >
            <Icon name="plus" size={12} /> {t('releases.new')}
          </button>
        </div>
        <div className="scroll">
          {list === null && <Empty>{t('common.loading')}</Empty>}
          {list?.length === 0 && <Empty>{t('releases.empty')}</Empty>}
          {list?.map((r) => (
            <div
              key={r.id}
              className={`list-item ${sel?.id === r.id ? 'selected' : ''}`}
              onClick={() => setSelId(r.id)}
              onContextMenu={(e) => showMenu(e, menu(r))}
            >
              <Icon name="release" />
              <span className="grow">
                <b>{r.name}</b>
                <div className="small muted">
                  {r.tag} · {relativeDate(r.publishedAt ?? r.createdAt)} · {t('releases.assetsCount', { n: r.assets.length })}
                </div>
              </span>
              <ReleasePills r={r} latest={r.id === latestId} />
            </div>
          ))}
        </div>
      </div>
      <div className="pane">
        {!sel ? (
          <Empty>{list?.length ? t('releases.select') : t('releases.emptyHint')}</Empty>
        ) : (
          <>
            <div className="pane-header">
              <span className="title grow">
                {sel.name} <span className="mono small muted">{sel.tag}</span>
              </span>
              <ReleasePills r={sel} latest={sel.id === latestId} />
              {sel.draft && (
                <button className="primary" onClick={() => publish(sel)}>
                  {t('releases.publish')}
                </button>
              )}
              <button onClick={() => upload(sel)} title={t('releases.upload')}>
                <Icon name="up" size={12} /> {t('releases.upload')}
              </button>
              <button onClick={() => copyTo(sel)} title={t('releases.copyTo')}>
                <Icon name="copy" size={12} /> {t('releases.copy')}
              </button>
              <button className="icon" onClick={() => api.app.openExternal(sel.htmlUrl)} title={t('common.openInBrowser')}>
                <Icon name="external" />
              </button>
              <button className="icon" onClick={(e) => showMenu(e, menu(sel))} title={t('top.more')}>
                ⋯
              </button>
            </div>
            <div className="scroll" style={{ padding: 14 }}>
              <div className="col">
                <div className="small muted">
                  {t('releases.by', { author: sel.author || '—', date: formatDate(sel.publishedAt ?? sel.createdAt) })}
                  {sel.target && ` · ${sel.target}`}
                </div>
                <div className="section">
                  {sel.body ? <Markdown text={sel.body} /> : <span className="muted">{t('common.noDescription')}</span>}
                </div>
                <div className="row">
                  <b className="grow">
                    {t('releases.assets')} ({sel.assets.length})
                  </b>
                  {sel.assets.length > 0 && (
                    <button onClick={() => download(sel.assets)}>
                      <Icon name="down" size={12} /> {t('releases.downloadAll')}
                    </button>
                  )}
                </div>
                {!sel.assets.length && <div className="muted small">{t('releases.noAssets')}</div>}
                {sel.assets.map((a) => (
                  <div key={a.id} className="list-item">
                    <Icon name="release" />
                    <span className="grow">
                      <b>{a.name}</b>
                      <div className="small muted">
                        {formatSize(a.size, t)} · {t('releases.downloads', { n: a.downloadCount })}
                      </div>
                    </span>
                    <button className="icon" onClick={() => download([a])} title={t('releases.download')}>
                      <Icon name="down" />
                    </button>
                    <button className="icon" onClick={() => copyLink(a.downloadUrl)} title={t('releases.copyLink')}>
                      <Icon name="copy" />
                    </button>
                    <button className="icon" onClick={() => deleteAsset(sel, a)} title={t('common.delete')}>
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                ))}
                {(sel.zipballUrl || sel.tarballUrl) && !sel.draft && (
                  <div className="row small">
                    <span className="muted">{t('releases.source')}:</span>
                    {sel.zipballUrl && (
                      <a href="#" onClick={(e) => (e.preventDefault(), api.app.openExternal(sel.zipballUrl!))}>
                        zip
                      </a>
                    )}
                    {sel.tarballUrl && (
                      <a href="#" onClick={(e) => (e.preventDefault(), api.app.openExternal(sel.tarballUrl!))}>
                        tar.gz
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
