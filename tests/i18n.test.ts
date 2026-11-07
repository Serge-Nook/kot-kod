import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..', 'src')
const dict = (l: string): Record<string, string> => JSON.parse(readFileSync(join(root, 'renderer/src/i18n', `${l}.json`), 'utf8'))

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : []
  })
}

describe('i18n', () => {
  const ru = dict('ru')
  const en = dict('en')
  const zh = dict('zh')

  it('has every static key used by the renderer in Russian', () => {
    const missing = new Set<string>()
    for (const f of files(join(root, 'renderer/src'))) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/\bt\(['"]([a-zA-Z0-9_.-]+)['"]/g)) if (!(m[1] in ru)) missing.add(m[1])
      for (const m of src.matchAll(/key: '([a-z]+\.[a-zA-Z]+)'/g)) if (!(m[1] in ru)) missing.add(m[1])
    }
    expect([...missing]).toEqual([])
  })

  it('translates every error code raised by the main process', () => {
    const missing = new Set<string>()
    for (const f of files(join(root, 'main'))) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/AppError\('([A-Z_]+)'/g)) if (!(`err.${m[1]}` in ru)) missing.add(m[1])
    }
    const runner = readFileSync(join(root, 'main/git/runner.ts'), 'utf8')
    for (const m of runner.matchAll(/return '([A-Z_]+)'/g)) if (!(`err.${m[1]}` in ru)) missing.add(m[1])
    expect([...missing]).toEqual([])
  })

  it('English covers all Russian keys', () => {
    expect(Object.keys(ru).filter((k) => !(k in en))).toEqual([])
  })

  it('Chinese has no unknown keys', () => {
    expect(Object.keys(zh).filter((k) => !(k in ru))).toEqual([])
  })

  it('keeps placeholders consistent across languages', () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
    for (const [k, v] of Object.entries(ru)) {
      if (en[k] !== undefined) expect(ph(en[k]), k).toBe(ph(v))
      if (zh[k] !== undefined) expect(ph(zh[k]), k).toBe(ph(v))
    }
  })
})
