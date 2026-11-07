import { describe, expect, it } from 'vitest'
import { parseStatusV2, parseLog, parseDiff, parseBranches, parseNameStatus, FIELD, RECORD } from '../src/shared/parse'
import { parseRemoteUrl, providerForHost, repoNameFromUrl } from '../src/shared/remote'
import { layoutGraph } from '../src/shared/graph'
import type { Commit } from '../src/shared/types'

describe('parseStatusV2', () => {
  it('parses header, changes, renames, conflicts and untracked', () => {
    const out = [
      '# branch.oid 1234567890abcdef',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 aaa bbb src/a b.ts',
      '2 R. N... 100644 100644 100644 aaa bbb R100 new.txt',
      'old.txt',
      'u UU N... 100644 100644 100644 100644 a b c conflict.txt',
      '? новый.txt',
      ''
    ].join('\0')
    const { header, files } = parseStatusV2(out)
    expect(header).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1, hasCommits: true })
    expect(files).toHaveLength(4)
    expect(files[0]).toMatchObject({ path: 'src/a b.ts', unstaged: true, staged: false })
    expect(files[1]).toMatchObject({ path: 'new.txt', oldPath: 'old.txt', index: 'R', staged: true })
    expect(files[2]).toMatchObject({ path: 'conflict.txt', conflicted: true })
    expect(files[3]).toMatchObject({ path: 'новый.txt', untracked: true })
  })

  it('detects initial repo and detached head', () => {
    const { header } = parseStatusV2('# branch.oid (initial)\0# branch.head (detached)\0')
    expect(header.hasCommits).toBe(false)
    expect(header.detached).toBe(true)
  })
})

describe('parseLog', () => {
  it('parses records with bodies', () => {
    const rec = (h: string, p: string, s: string, b: string) =>
      [h, p, 'Иван', 'i@x.ru', '2026-01-01T00:00:00+03:00', 'HEAD -> main, tag: v1', s, b].join(FIELD) + RECORD
    const out = rec('a'.repeat(40), 'b'.repeat(40), 'Первый', 'тело\nстрока') + '\n' + rec('b'.repeat(40), '', 'root', '')
    const c = parseLog(out)
    expect(c).toHaveLength(2)
    expect(c[0]).toMatchObject({ subject: 'Первый', body: 'тело\nстрока', refs: ['HEAD -> main', 'tag: v1'], shortHash: 'aaaaaaa' })
    expect(c[1].parents).toEqual([])
  })
})

describe('parseDiff', () => {
  it('parses hunks with line numbers', () => {
    const out = `diff --git a/f.txt b/f.txt
index 1..2 100644
--- a/f.txt
+++ b/f.txt
@@ -1,3 +1,3 @@ func
 a
-b
+B
 c
\\ No newline at end of file
`
    const [f] = parseDiff(out)
    expect(f.path).toBe('f.txt')
    expect(f.hunks).toHaveLength(1)
    const h = f.hunks[0]
    expect(h.section).toBe('func')
    expect(h.lines.map((l) => l.type)).toEqual(['ctx', 'del', 'add', 'ctx', 'nonl'])
    expect(h.lines[2].newNo).toBe(2)
    expect(h.lines[1].oldNo).toBe(2)
  })

  it('detects new, binary and renamed files', () => {
    const out = `diff --git a/x.png b/x.png
new file mode 100644
index 0000000..1111111
Binary files /dev/null and b/x.png differ
diff --git a/old name.txt b/new name.txt
similarity index 100%
rename from old name.txt
rename to new name.txt
`
    const files = parseDiff(out)
    expect(files[0]).toMatchObject({ isNew: true, binary: true })
    expect(files[1]).toMatchObject({ path: 'new name.txt', oldPath: 'old name.txt' })
  })
})

describe('parseBranches / parseNameStatus', () => {
  it('parses branch tracking info', () => {
    const line = ['refs/heads/main', 'main', '*', 'origin/main', '[ahead 1, behind 2]', 'abc', '2026-01-01', 'msg'].join(FIELD)
    const remote = ['refs/remotes/origin/HEAD', 'origin', ' ', '', '', 'abc', '', ''].join(FIELD)
    const b = parseBranches(line + '\n' + remote + '\n')
    expect(b).toHaveLength(1)
    expect(b[0]).toMatchObject({ current: true, ahead: 1, behind: 2, remote: false })
  })
  it('parses name-status -z with renames', () => {
    const files = parseNameStatus('M\0a.txt\0R100\0old.txt\0new.txt\0')
    expect(files).toEqual([
      { path: 'a.txt', status: 'M' },
      { path: 'new.txt', oldPath: 'old.txt', status: 'R' }
    ])
  })
})

describe('remote urls', () => {
  it('parses https and ssh', () => {
    expect(parseRemoteUrl('https://github.com/Serge-Nook/kot-kod.git')).toEqual({ host: 'github.com', owner: 'Serge-Nook', repo: 'kot-kod' })
    expect(parseRemoteUrl('git@gitverse.ru:user/repo.git')).toEqual({ host: 'gitverse.ru', owner: 'user', repo: 'repo' })
    expect(parseRemoteUrl('ssh://git@github.com:22/a/b')).toEqual({ host: 'github.com', owner: 'a', repo: 'b' })
    expect(parseRemoteUrl('https://user:tok@gitverse.ru/a/b.git')?.host).toBe('gitverse.ru')
    expect(providerForHost('gitverse.ru')).toBe('gitverse')
    expect(providerForHost('example.com')).toBeNull()
    expect(repoNameFromUrl('/tmp/bare.git')).toBe('bare')
  })
})

describe('layoutGraph', () => {
  const c = (hash: string, parents: string[]): Commit => ({
    hash, parents, shortHash: hash, authorName: '', authorEmail: '', date: '', subject: hash, body: '', refs: []
  })
  it('lays out a merge', () => {
    // M merges A (main) and B (feature); both have parent R
    const rows = layoutGraph([c('M', ['A', 'B']), c('B', ['R']), c('A', ['R']), c('R', [])])
    expect(rows[0].lane).toBe(0)
    expect(rows[1].lane).toBe(1)
    expect(rows[2].lane).toBe(0)
    expect(rows[3].lane).toBe(0)
    expect(rows[2].bottom.some((e) => e.from === 1 && e.to === 0)).toBe(true)
    expect(Math.max(...rows.map((r) => r.width))).toBe(2)
  })
  it('keeps a linear history in one lane', () => {
    const rows = layoutGraph([c('3', ['2']), c('2', ['1']), c('1', [])])
    expect(rows.every((r) => r.lane === 0 && r.width === 1)).toBe(true)
  })
})
