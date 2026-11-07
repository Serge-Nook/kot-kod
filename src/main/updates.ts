import { app, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import { log } from './logger'
import type { UpdateInfo } from '../shared/types'

export const UPDATE_OWNER = 'Serge-Nook'
export const UPDATE_REPO = 'kot-kod'
const { autoUpdater } = electronUpdater

function cmp(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => Number(x) || 0)
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => Number(x) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}

export async function check(): Promise<UpdateInfo> {
  const current = app.getVersion()
  const res = await fetch(`https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'kot-kod' }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const j = (await res.json()) as { tag_name: string; html_url: string; assets?: { name: string; browser_download_url: string }[] }
  const latest = j.tag_name.replace(/^v/, '')
  const deb = j.assets?.find((a) => a.name.endsWith('.deb'))
  return {
    current,
    latest,
    available: cmp(latest, current) > 0,
    url: j.html_url,
    appImage: !!process.env.APPIMAGE,
    aptCommand: deb
      ? `wget -O /tmp/${deb.name} ${deb.browser_download_url} && sudo apt install /tmp/${deb.name}`
      : undefined
  }
}

export async function downloadAppImage(win: BrowserWindow | null): Promise<void> {
  if (!process.env.APPIMAGE) throw new Error('not an AppImage')
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = { info: (m: unknown) => log('info', String(m)), warn: (m: unknown) => log('warn', String(m)), error: (m: unknown) => log('error', String(m)), debug: () => undefined }
  autoUpdater.on('download-progress', (p) => win?.webContents.send('api-event', { type: 'update-progress', percent: p.percent }))
  autoUpdater.once('update-downloaded', () => {
    win?.webContents.send('api-event', { type: 'update-downloaded' })
    setTimeout(() => autoUpdater.quitAndInstall(), 1500)
  })
  await autoUpdater.checkForUpdates()
  await autoUpdater.downloadUpdate()
}
