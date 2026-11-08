import { createServer, type IncomingMessage, type Server } from 'http'
import type { AddressInfo } from 'net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

process.env.KOTKOD_ALLOW_HTTP = '1'

interface Hit {
  method: string
  url: string
  headers: IncomingMessage['headers']
  body: Buffer
}

let server: Server
let base = ''
const hits: Hit[] = []
const routes: Record<string, (h: Hit) => [number, unknown, Record<string, string>?]> = {}

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const hit: Hit = { method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks) }
      hits.push(hit)
      const key = `${req.method} ${req.url!.split('?')[0]}`
      const route = routes[key]
      if (!route) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ message: 'Not Found' }))
        return
      }
      const [status, body, headers] = route(hit)
      if (Buffer.isBuffer(body)) {
        res.writeHead(status, { 'Content-Length': String(body.length), ...headers })
        res.end(body)
      } else {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
        res.end(body === undefined ? '' : JSON.stringify(body))
      }
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.KOTKOD_GITHUB_API = base
  process.env.KOTKOD_GITVERSE_API = `${base}/gv`
})

afterAll(() => new Promise<void>((r) => server.close(() => r())))

async function load() {
  return import('../src/main/hosting/rest')
}

describe('GitHub releases', () => {
  it('lists, creates, uploads and downloads', async () => {
    const { GitHubProvider } = await load()
    const gh = new GitHubProvider()
    const release = {
      id: 7,
      tag_name: 'v1.0.0',
      name: 'Первый',
      body: 'notes',
      draft: false,
      prerelease: true,
      html_url: 'https://github.com/o/r/releases/tag/v1.0.0',
      upload_url: `${base}/upload/o/r/releases/7/assets{?name,label}`,
      author: { login: 'me' },
      assets: [{ id: 3, name: 'a.zip', size: 4, download_count: 2, browser_download_url: 'x', url: `${base}/repos/o/r/releases/assets/3` }]
    }
    routes['GET /repos/o/r/releases'] = () => [200, [release]]
    routes['POST /repos/o/r/releases'] = () => [201, release]
    routes['POST /upload/o/r/releases/7/assets'] = (h) => [201, { id: 9, name: new URL(h.url, base).searchParams.get('name'), size: h.body.length }]
    routes['GET /repos/o/r/releases/assets/3'] = (h) =>
      h.headers.accept === 'application/octet-stream' ? [200, Buffer.from('DATA')] : [415, { message: 'bad accept' }]

    const list = await gh.releases('tok', 'o', 'r')
    expect(list[0]).toMatchObject({ id: '7', tag: 'v1.0.0', prerelease: true, author: 'me', uploadUrl: `${base}/upload/o/r/releases/7/assets` })
    expect(list[0].assets[0]).toMatchObject({ id: '3', name: 'a.zip', size: 4, downloadCount: 2 })

    const created = await gh.createRelease('tok', 'o', 'r', { tag: 'v1.0.0', name: 'Первый', body: 'notes', draft: false, prerelease: true })
    const post = hits.find((h) => h.method === 'POST' && h.url === '/repos/o/r/releases')!
    expect(JSON.parse(post.body.toString())).toEqual({ tag_name: 'v1.0.0', name: 'Первый', body: 'notes', draft: false, prerelease: true })

    const asset = await gh.uploadAsset('tok', 'o', 'r', created, 'файл 1.deb', new Uint8Array([1, 2, 3]), 'application/vnd.debian.binary-package')
    expect(asset).toMatchObject({ id: '9', name: 'файл 1.deb', size: 3 })
    const up = hits.find((h) => h.url.startsWith('/upload/'))!
    expect(up.headers['content-type']).toBe('application/vnd.debian.binary-package')
    expect(up.headers.authorization).toBe('Bearer tok')

    const res = await gh.download('tok', list[0].assets[0])
    expect(await res.text()).toBe('DATA')
  })

  it('maps API errors', async () => {
    const { GitHubProvider } = await load()
    routes['DELETE /repos/o/r/releases/assets/5'] = () => [422, { message: 'Validation Failed', errors: [{ code: 'already_exists' }] }]
    await expect(new GitHubProvider().deleteAsset('tok', 'o', 'r', '7', '5')).rejects.toMatchObject({ code: 'VALIDATION' })
  })
})

describe('GitVerse releases', () => {
  it('uploads assets as multipart with a sanitized name', async () => {
    const { GitVerseProvider } = await load()
    const gv = new GitVerseProvider()
    routes['POST /gv/repos/o/r/releases/11/assets'] = (h) => [201, { id: 1, name: new URL(h.url, base).searchParams.get('name'), size: h.body.length }]
    const rel = { id: '11', tag: 'v2', name: 'v2', body: '', draft: false, prerelease: false, author: '', createdAt: '', htmlUrl: '', assets: [] }
    const a = await gv.uploadAsset('tok', 'o', 'r', rel, 'Кот код 1.0.AppImage', new Uint8Array([5, 6]), 'application/x-executable')
    expect(a.name).toBe('Kot_kod_1.0.AppImage')
    const hit = hits.find((h) => h.url.startsWith('/gv/repos/o/r/releases/11/assets'))!
    expect(hit.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    expect(hit.headers.accept).toBe('application/vnd.gitverse.object+json;version=1')
    const body = hit.body.toString('latin1')
    expect(body).toContain('name="attachment"; filename="Kot_kod_1.0.AppImage"')
  })

  it('builds web links and fetches assets separately when missing', async () => {
    const { GitVerseProvider } = await load()
    routes['GET /gv/repos/o/r/releases/12'] = () => [200, { id: 12, tag_name: 'v3', html_url: 'https://api.gitverse.ru/o/r/releases/tag/v3' }]
    routes['GET /gv/repos/o/r/releases/12/assets'] = () => [200, [{ id: 4, name: 'b.zip', size: 1, browser_download_url: `${base}/gv/dl/4` }]]
    routes['GET /gv/dl/4'] = () => [200, Buffer.from('Z')]
    const gv = new GitVerseProvider()
    const r = await gv.release('tok', 'o', 'r', '12')
    expect(r.htmlUrl).toBe('https://gitverse.ru/o/r/releases/tag/v3')
    expect(r.assets.map((x) => x.name)).toEqual(['b.zip'])
    const listHit = hits.find((h) => h.url.startsWith('/gv/repos/o/r/releases/12/assets'))!
    expect(listHit.url).toContain('per_page=50')
    expect(await (await gv.download('tok', r.assets[0])).text()).toBe('Z')
  })

  it('deletes assets by release path', async () => {
    const { GitVerseProvider } = await load()
    routes['DELETE /gv/repos/o/r/releases/12/assets/4'] = () => [204, undefined]
    await new GitVerseProvider().deleteAsset('tok', 'o', 'r', '12', '4')
    expect(hits.some((h) => h.method === 'DELETE' && h.url === '/gv/repos/o/r/releases/12/assets/4')).toBe(true)
  })
})
