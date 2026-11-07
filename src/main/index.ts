import { app, BrowserWindow, crashReporter, dialog, shell } from 'electron'
import { join } from 'path'
import { existsSync, writeFileSync, chmodSync, readFileSync, unlinkSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { ensureDirs, configDir, crashDir, resourcesDir } from './paths'
import { log } from './logger'
import { registerIpc, setMainWindow } from './ipc'
import { configureGit } from './git/runner'
import * as accounts from './accounts'
import * as settings from './settings'
import { setHttpLog } from './hosting/rest'

ensureDirs()
crashReporter.start({ uploadToServer: false, compress: true })

const crashMarker = join(crashDir, 'last-crash.txt')
const runningMarker = join(configDir, '.running')

function recordCrash(kind: string, detail: string): void {
  log('error', `${kind}: ${detail}`)
  try {
    writeFileSync(crashMarker, `${new Date().toISOString()} ${kind}\n${detail}\n`)
  } catch {
    /* ignore */
  }
}

process.on('uncaughtException', (e) => recordCrash('uncaughtException', e.stack ?? String(e)))
process.on('unhandledRejection', (e) => log('error', `unhandledRejection: ${String(e)}`))

function askpassScript(): string {
  const p = join(configDir, 'askpass.sh')
  const body = `#!/bin/sh\ncase "$1" in\n  Username*|username*) printf '%s\\n' "$KOTKOD_ASKPASS_USER" ;;\n  *) printf '%s\\n' "$KOTKOD_ASKPASS_PASS" ;;\nesac\n`
  if (!existsSync(p) || readFileSync(p, 'utf8') !== body) writeFileSync(p, body)
  chmodSync(p, 0o700)
  return p
}

function createWindow(): BrowserWindow {
  const s = settings.load()
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Кот-код',
    icon: join(resourcesDir(), 'icon.png'),
    backgroundColor: s.theme === 'light' ? '#f6f8fa' : '#0d1117',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  setMainWindow(win)
  win.setMenuBarVisibility(false)
  win.on('ready-to-show', () => {
    win.webContents.setZoomFactor(s.zoom || 1)
    win.show()
  })
  win.webContents.setWindowOpenHandler((d) => {
    if (/^https?:\/\//.test(d.url)) shell.openExternal(d.url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:') && !url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? '\0')) {
      e.preventDefault()
      if (/^https?:\/\//.test(url)) shell.openExternal(url)
    }
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    recordCrash('render-process-gone', JSON.stringify(details))
    if (details.reason !== 'clean-exit') win.reload()
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

app.whenReady().then(() => {
  electronApp.setAppUserModelId('ru.nookbat.kotkod')
  app.on('browser-window-created', (_, w) => optimizer.watchWindowShortcuts(w))
  configureGit({
    authFor: accounts.authFor,
    askpassPath: askpassScript(),
    trash: (p) => shell.trashItem(p),
    resourcesDir: resourcesDir(),
    log: (m) => log('info', m),
    progress: (repo, p) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('api-event', { type: 'progress', repo, progress: p })
    }
  })
  setHttpLog((m) => log('info', m))
  registerIpc()
  const uncleanExit = existsSync(runningMarker)
  writeFileSync(runningMarker, String(process.pid))
  log('info', `start v${app.getVersion()} electron ${process.versions.electron}`)
  const win = createWindow()
  app.on('second-instance', () => {
    if (win.isMinimized()) win.restore()
    win.focus()
  })
  win.webContents.once('did-finish-load', () => {
    if (existsSync(crashMarker) || uncleanExit) {
      const report = existsSync(crashMarker) ? readFileSync(crashMarker, 'utf8') : 'unclean exit'
      try {
        if (existsSync(crashMarker)) unlinkSync(crashMarker)
      } catch {
        /* ignore */
      }
      win.webContents.send('api-event', { type: 'crash-recovered', report })
    }
  })
})

app.on('window-all-closed', () => {
  try {
    unlinkSync(runningMarker)
  } catch {
    /* ignore */
  }
  app.quit()
})

export { dialog }
