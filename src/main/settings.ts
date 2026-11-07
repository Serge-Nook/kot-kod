import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { configDir } from './paths'
import type { Settings } from '../shared/types'

export const DEFAULT_SHORTCUTS: Record<string, string> = {
  commit: 'Ctrl+Enter',
  push: 'Ctrl+Shift+P',
  pull: 'Ctrl+Shift+L',
  fetch: 'F5',
  newBranch: 'Ctrl+T',
  changes: 'Ctrl+1',
  history: 'Ctrl+2',
  branches: 'Ctrl+3',
  openRepo: 'Ctrl+O',
  clone: 'Ctrl+Shift+O',
  settings: 'Ctrl+,',
  help: 'F1',
  zoomIn: 'Ctrl+=',
  zoomOut: 'Ctrl+-',
  zoomReset: 'Ctrl+0'
}

export function defaults(): Settings {
  return {
    language: 'ru',
    theme: 'dark',
    accent: 'forest',
    zoom: 1,
    diffMode: 'unified',
    recentRepos: [],
    cloneDir: join(homedir(), 'Projects'),
    shortcuts: { ...DEFAULT_SHORTCUTS },
    githubClientId: '',
    commitDrafts: {},
    commitHistory: [],
    checkUpdates: true,
    autoFetchMinutes: 10,
    pendingPush: []
  }
}

const file = (): string => join(configDir, 'settings.json')
let cache: Settings | null = null

export function load(): Settings {
  if (cache) return cache
  const d = defaults()
  try {
    if (existsSync(file())) {
      const raw = JSON.parse(readFileSync(file(), 'utf8'))
      cache = { ...d, ...raw, shortcuts: { ...d.shortcuts, ...(raw.shortcuts ?? {}) } }
      return cache!
    }
  } catch {
    /* corrupted settings: fall back to defaults */
  }
  cache = d
  return d
}

export function save(patch: Partial<Settings>): Settings {
  const next = { ...load(), ...patch }
  cache = next
  const tmp = file() + '.tmp'
  writeFileSync(tmp, JSON.stringify(next, null, 2))
  renameSync(tmp, file())
  return next
}

export function addRecent(path: string): Settings {
  const s = load()
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path
  const list = [{ path, name, lastOpened: new Date().toISOString() }, ...s.recentRepos.filter((r) => r.path !== path)].slice(0, 30)
  return save({ recentRepos: list, lastRepo: path })
}
