import { beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'
import * as ops from '../src/main/git/ops'
import { configureGit } from '../src/main/git/runner'
import { buildPartialPatch } from '../src/shared/patch'

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

let root: string
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'kotkod-test-'))
  process.env.GIT_AUTHOR_NAME = 'Тест'
  process.env.GIT_AUTHOR_EMAIL = 't@example.com'
  process.env.GIT_COMMITTER_NAME = 'Тест'
  process.env.GIT_COMMITTER_EMAIL = 't@example.com'
  configureGit({ trash: async (p) => rmSync(p, { recursive: true, force: true }), resourcesDir: join(__dirname, '..', 'resources') })
})

async function newRepo(name: string): Promise<string> {
  return ops.init({ path: join(root, name), defaultBranch: 'main', gitignore: ['Node'], license: 'mit', readme: true, authorName: 'Тест' })
}

describe('git ops', () => {
  it('init creates initial commit with license and gitignore', async () => {
    const r = await newRepo('init')
    expect(readFileSync(join(r, 'LICENSE'), 'utf8')).toContain('Тест')
    expect(existsSync(join(r, '.gitignore'))).toBe(true)
    const log = await ops.log(r, { limit: 10 })
    expect(log).toHaveLength(1)
    const st = await ops.status(r)
    expect(st.branch).toBe('main')
    expect(st.files).toHaveLength(0)
  })

  it('stage, partial stage, commit, amend, history', async () => {
    const r = await newRepo('commit')
    writeFileSync(join(r, 'a.txt'), '1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n')
    await ops.stage(r, ['a.txt'])
    await ops.commit(r, { summary: 'add a', description: '', coAuthors: [], amend: false })
    writeFileSync(join(r, 'a.txt'), 'ONE\n2\n3\n4\n5\n6\n7\n8\n9\nTEN\n')
    const d = await ops.diff(r, 'a.txt', false, false)
    expect(d!.hunks.length).toBe(2)
    const sel = new Map([[0, new Set(d!.hunks[0].lines.map((l, i) => (l.type !== 'ctx' ? i : -1)).filter((i) => i >= 0))]])
    await ops.applyPatch(r, buildPartialPatch(d!, sel, false)!, 'stage')
    const staged = await ops.diff(r, 'a.txt', true, false)
    expect(staged!.hunks).toHaveLength(1)
    expect(staged!.hunks[0].lines.some((l) => l.text === 'ONE')).toBe(true)
    const st = await ops.status(r)
    expect(st.files[0]).toMatchObject({ staged: true, unstaged: true })
    await ops.commit(r, { summary: 'first line', description: 'desc', coAuthors: ['Кот <cat@example.com>'], amend: false })
    expect(await ops.lastCommitMessage(r)).toContain('Co-authored-by: Кот <cat@example.com>')
    await ops.commit(r, { summary: 'first line amended', description: '', coAuthors: [], amend: true })
    const log = await ops.log(r, { limit: 10 })
    expect(log.map((c) => c.subject)).toEqual(['first line amended', 'add a', 'Initial commit'])
    const found = await ops.log(r, { limit: 10, search: 'amended' })
    expect(found).toHaveLength(1)
    const byHash = await ops.log(r, { limit: 10, search: log[1].shortHash })
    expect(byHash[0].subject).toBe('add a')
    const files = await ops.commitFiles(r, log[0].hash)
    expect(files).toEqual([{ path: 'a.txt', status: 'M' }])
  })

  it('partial unstage and discard of a selected line', async () => {
    const r = await newRepo('unstage')
    writeFileSync(join(r, 'b.txt'), 'a\nb\nc\n')
    await ops.stage(r, ['b.txt'])
    await ops.commit(r, { summary: 'b', description: '', coAuthors: [], amend: false })
    writeFileSync(join(r, 'b.txt'), 'a\nX\nb\nY\nc\n')
    await ops.stage(r, ['b.txt'])
    const cached = await ops.diff(r, 'b.txt', true, false)
    const idxY = cached!.hunks[0].lines.findIndex((l) => l.text === 'Y')
    await ops.applyPatch(r, buildPartialPatch(cached!, new Map([[0, new Set([idxY])]]), true)!, 'unstage')
    const after = sh(r, 'show', ':b.txt')
    expect(after).toBe('a\nX\nb\nc\n')
    const work = await ops.diff(r, 'b.txt', false, false)
    const wy = work!.hunks[0].lines.findIndex((l) => l.text === 'Y')
    await ops.applyPatch(r, buildPartialPatch(work!, new Map([[0, new Set([wy])]]), true)!, 'discard')
    expect(readFileSync(join(r, 'b.txt'), 'utf8')).toBe('a\nX\nb\nc\n')
  })

  it('discard untracked and modified files', async () => {
    const r = await newRepo('discard')
    writeFileSync(join(r, 'README.md'), 'changed\n')
    writeFileSync(join(r, 'new.txt'), 'x')
    await ops.discard(r, ['README.md', 'new.txt'])
    expect((await ops.status(r)).files).toHaveLength(0)
  })

  it('branches, merge conflict and resolution', async () => {
    const r = await newRepo('merge')
    await ops.createBranch(r, 'feature', null, true)
    writeFileSync(join(r, 'README.md'), 'feature\n')
    await ops.stage(r, ['README.md'])
    await ops.commit(r, { summary: 'feature change', description: '', coAuthors: [], amend: false })
    await ops.checkout(r, 'main', 'keep')
    writeFileSync(join(r, 'README.md'), 'main\n')
    await ops.stage(r, ['README.md'])
    await ops.commit(r, { summary: 'main change', description: '', coAuthors: [], amend: false })
    expect(await ops.merge(r, 'feature', 'merge')).toBe('conflicts')
    const st = await ops.status(r)
    expect(st.state).toBe('merging')
    expect(st.files.find((f) => f.conflicted)?.path).toBe('README.md')
    const v = await ops.conflict(r, 'README.md')
    expect(v.ours).toBe('main\n')
    expect(v.theirs).toBe('feature\n')
    await ops.resolveConflict(r, 'README.md', 'theirs')
    expect(await ops.continueOp(r)).toBe('ok')
    expect((await ops.status(r)).state).toBe('clean')
    expect(readFileSync(join(r, 'README.md'), 'utf8')).toBe('feature\n')
    await expect(ops.deleteBranch(r, 'main', false, false)).rejects.toMatchObject({ code: 'CURRENT_BRANCH' })
    await ops.deleteBranch(r, 'feature', false, false)
    expect((await ops.branches(r)).map((b) => b.name)).toEqual(['main'])
  })

  it('stash, tags, cherry-pick, revert, reset, interactive rebase', async () => {
    const r = await newRepo('misc')
    writeFileSync(join(r, 'c.txt'), 'c\n')
    await ops.stashPush(r, 'wip', true)
    expect((await ops.stashList(r))[0].message).toContain('wip')
    expect((await ops.stashDiff(r, 'stash@{0}'))[0].path).toBe('c.txt')
    await ops.stashApply(r, 'stash@{0}', true)
    expect(existsSync(join(r, 'c.txt'))).toBe(true)
    await ops.stage(r, ['c.txt'])
    const h1 = await ops.commit(r, { summary: 'c1', description: '', coAuthors: [], amend: false })
    writeFileSync(join(r, 'd.txt'), 'd\n')
    await ops.stage(r, ['d.txt'])
    await ops.commit(r, { summary: 'd1', description: '', coAuthors: [], amend: false })
    await ops.createTag(r, 'v1.0', h1, 'release')
    expect((await ops.tags(r))[0]).toMatchObject({ name: 'v1.0', hash: h1 })
    expect(await ops.revert(r, h1)).toBe('ok')
    expect(existsSync(join(r, 'c.txt'))).toBe(false)
    await ops.reset(r, 'HEAD~1', 'hard')
    const log = await ops.log(r, { limit: 10 })
    expect(log[0].subject).toBe('d1')
    const todo = log
      .slice(0, 2)
      .reverse()
      .map((c, i) => ({ action: i === 0 ? ('reword' as const) : ('squash' as const), hash: c.hash, subject: c.subject, message: 'объединено' }))
    expect(await ops.rebaseInteractive(r, `${log[1].hash}~1`, todo)).toBe('ok')
    const after = await ops.log(r, { limit: 10 })
    expect(after).toHaveLength(2)
    expect(after[0].subject).toBe('объединено')
    await ops.createBranch(r, 'side', 'HEAD~1', false)
    await ops.checkout(r, 'side', 'keep')
    expect(await ops.cherryPick(r, after[0].hash)).toBe('ok')
    expect(existsSync(join(r, 'd.txt'))).toBe(true)
  })

  it('clone, push rejected and pull', async () => {
    const bare = join(root, 'remote.git')
    sh(root, 'init', '--bare', '-b', 'main', bare)
    const a = await newRepo('pusher')
    await ops.stage(a, [])
    sh(a, 'remote', 'add', 'origin', bare)
    await ops.push(a, { force: false, setUpstream: true })
    const b = await ops.clone(bare, join(root, 'clones'), null)
    expect(existsSync(join(b, 'README.md'))).toBe(true)
    writeFileSync(join(a, 'x.txt'), 'x\n')
    await ops.stage(a, ['x.txt'])
    await ops.commit(a, { summary: 'from a', description: '', coAuthors: [], amend: false })
    await ops.push(a, { force: false, setUpstream: false })
    writeFileSync(join(b, 'y.txt'), 'y\n')
    await ops.stage(b, ['y.txt'])
    await ops.commit(b, { summary: 'from b', description: '', coAuthors: [], amend: false })
    await expect(ops.push(b, { force: false, setUpstream: false })).rejects.toMatchObject({ code: 'PUSH_REJECTED' })
    expect(await ops.pull(b, 'rebase')).toBe('ok')
    await ops.push(b, { force: false, setUpstream: false })
    await ops.fetchAll(a)
    expect((await ops.status(a)).behind).toBe(1)
  })
})

describe('release notes', () => {
  it('lists commits since the previous tag', async () => {
    const r = await newRepo('notes')
    sh(r, 'tag', 'v1')
    writeFileSync(join(r, 'a.txt'), '1')
    sh(r, 'add', '.')
    sh(r, 'commit', '-m', 'Первое изменение')
    writeFileSync(join(r, 'b.txt'), '2')
    sh(r, 'add', '.')
    sh(r, 'commit', '-m', 'Второе')
    sh(r, 'tag', 'v2')
    const notes = await ops.releaseNotes(r, 'v2')
    expect(notes.split('\n')).toHaveLength(2)
    expect(notes).toContain('- Первое изменение (')
    expect(await ops.releaseNotes(r, 'v3')).toBe(notes)
    expect(await ops.hasTag(r, 'v1')).toBe(true)
    expect(await ops.hasTag(r, 'v9')).toBe(false)
  })
})
