import { app } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import { mkdirSync } from 'fs'

export const APP_ID = 'kot-kod'
const home = homedir()
export const configDir = join(process.env.XDG_CONFIG_HOME || join(home, '.config'), APP_ID)
export const stateDir = join(process.env.XDG_STATE_HOME || join(home, '.local', 'state'), APP_ID)
export const logDir = join(stateDir, 'logs')
export const crashDir = join(stateDir, 'crashes')

export function ensureDirs(): void {
  for (const d of [configDir, logDir, crashDir]) mkdirSync(d, { recursive: true })
  app.setPath('userData', configDir)
  app.setPath('logs', logDir)
  app.setPath('crashDumps', crashDir)
}

export function resourcesDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked', 'resources') : join(app.getAppPath(), 'resources')
}
