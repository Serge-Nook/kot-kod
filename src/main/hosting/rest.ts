import { AppError } from '../errors'
import type {
  HostNotification,
  Issue,
  IssueComment,
  Label,
  ProviderInfo,
  PullFile,
  PullRequest,
  RemoteRepo
} from '../../shared/types'
import type {
  CreateIssueInput,
  CreatePullInput,
  CreateRemoteRepoInput,
  MergeMethod,
  ReviewEvent
} from '../../shared/api'
import type { HostUser, IHostingProvider } from './provider'

/* eslint-disable @typescript-eslint/no-explicit-any */
type J = any

export let httpLog: (msg: string) => void = () => undefined
export function setHttpLog(fn: (msg: string) => void): void {
  httpLog = fn
}

function nextLink(link: string | null): string | null {
  if (!link) return null
  const m = /<([^>]+)>;\s*rel="next"/.exec(link)
  return m ? m[1] : null
}

/** REST client for GitHub-compatible APIs (GitHub v3 and GitVerse public API). */
export abstract class RestProvider implements IHostingProvider {
  abstract readonly info: ProviderInfo
  abstract apiBase: string
  protected abstract accept: string
  protected perPage = 100

  protected headers(token: string): Record<string, string> {
    return {
      Accept: this.accept,
      Authorization: `Bearer ${token}`,
      'User-Agent': 'kot-kod'
    }
  }

  protected async request(
    token: string,
    method: string,
    path: string,
    body?: unknown,
    raw = false
  ): Promise<{ data: J; link: string | null }> {
    const url = path.startsWith('http') ? path : this.apiBase + path
    if (!url.startsWith('https://') && !process.env.KOTKOD_ALLOW_HTTP)
      throw new AppError('HTTPS_ONLY', url)
    let attempt = 0
    for (;;) {
      attempt++
      let res: Response
      try {
        res = await fetch(url, {
          method,
          headers: {
            ...this.headers(token),
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(30_000)
        })
      } catch (e) {
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 800 * attempt))
          continue
        }
        throw new AppError('NETWORK', String((e as Error).message ?? e))
      }
      httpLog(`${method} ${url} -> ${res.status}`)
      if (res.status >= 500 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 800 * attempt))
        continue
      }
      if (!res.ok) {
        let text = ''
        try {
          text = await res.text()
        } catch {
          /* ignore */
        }
        let message = text
        try {
          const j = JSON.parse(text)
          message = j?.message ?? j?.error?.message ?? text
          if (j?.errors?.length)
            message += ': ' + j.errors.map((x: J) => x.message ?? x.code ?? JSON.stringify(x)).join('; ')
        } catch {
          /* not json */
        }
        const remaining = res.headers.get('x-ratelimit-remaining')
        if (res.status === 429 || (res.status === 403 && remaining === '0')) {
          const reset = res.headers.get('x-ratelimit-reset')
          throw new AppError(
            'RATE_LIMIT',
            message,
            reset ? new Date(Number(reset) * 1000).toISOString() : undefined
          )
        }
        if (res.status === 401) throw new AppError('AUTH_FAILED', message)
        if (res.status === 404) throw new AppError('NOT_FOUND', message)
        if (res.status === 403) throw new AppError('FORBIDDEN', message)
        if (res.status === 405 || res.status === 501) throw new AppError('NOT_SUPPORTED', message)
        if (res.status === 409) throw new AppError('API_CONFLICT', message)
        if (res.status === 422) throw new AppError('VALIDATION', message)
        throw new AppError('API_ERROR', `${res.status} ${message}`)
      }
      if (res.status === 204 || raw) return { data: null, link: res.headers.get('link') }
      const text = await res.text()
      return { data: text ? JSON.parse(text) : null, link: res.headers.get('link') }
    }
  }

  protected async get(token: string, path: string): Promise<J> {
    return (await this.request(token, 'GET', path)).data
  }

  protected async paged(token: string, path: string, max = 1000): Promise<J[]> {
    const sep = path.includes('?') ? '&' : '?'
    let url: string | null = `${path}${sep}per_page=${this.perPage}`
    const all: J[] = []
    while (url && all.length < max) {
      const { data, link } = await this.request(token, 'GET', url)
      const items = Array.isArray(data) ? data.flat() : (data?.items ?? [])
      all.push(...items)
      if (!items.length) break
      url = nextLink(link)
    }
    return all
  }

  protected mapRepo(r: J): RemoteRepo {
    return {
      id: String(r.id),
      name: r.name,
      fullName: r.full_name,
      owner: r.owner?.login ?? String(r.full_name).split('/')[0],
      description: r.description ?? undefined,
      private: !!r.private,
      fork: !!r.fork,
      cloneUrl: r.clone_url,
      sshUrl: r.ssh_url,
      htmlUrl: r.html_url,
      defaultBranch: r.default_branch || 'main',
      updatedAt: r.pushed_at ?? r.updated_at,
      parentFullName: r.parent?.full_name,
      parentCloneUrl: r.parent?.clone_url
    }
  }

  protected mapPull(p: J, repoFullName: string): PullRequest {
    return {
      number: p.number,
      title: p.title ?? '',
      body: p.body ?? '',
      state: p.merged_at || p.merged ? 'merged' : p.state === 'closed' ? 'closed' : 'open',
      draft: !!p.draft,
      author: p.user?.login ?? '',
      head: p.head?.label ?? p.head?.ref ?? '',
      base: p.base?.ref ?? '',
      htmlUrl: p.html_url,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      repoFullName: p.base?.repo?.full_name ?? repoFullName,
      labels: (p.labels ?? []).map((l: J) => l.name),
      mergeable: p.mergeable
    }
  }

  protected mapIssue(i: J, repoFullName: string): Issue {
    return {
      number: i.number,
      title: i.title ?? '',
      body: i.body ?? '',
      state: i.state === 'closed' ? 'closed' : 'open',
      author: i.user?.login ?? '',
      labels: (i.labels ?? []).map((l: J) => (typeof l === 'string' ? l : l.name)),
      comments: i.comments ?? 0,
      htmlUrl: i.html_url,
      createdAt: i.created_at,
      repoFullName: i.repository?.full_name ?? repoFullName
    }
  }

  async user(token: string): Promise<HostUser> {
    const u = await this.get(token, '/user')
    return { login: u.login, name: u.name ?? undefined, email: u.email ?? undefined, avatarUrl: u.avatar_url }
  }

  async repos(token: string): Promise<RemoteRepo[]> {
    const list = await this.paged(token, '/user/repos?sort=updated', 2000)
    return list.map((r) => this.mapRepo(r))
  }

  async repo(token: string, owner: string, repo: string): Promise<RemoteRepo> {
    return this.mapRepo(await this.get(token, `/repos/${owner}/${repo}`))
  }

  async createRepo(token: string, input: CreateRemoteRepoInput): Promise<RemoteRepo> {
    const { data } = await this.request(token, 'POST', '/user/repos', {
      name: input.name,
      description: input.description,
      private: input.private,
      auto_init: false
    })
    return this.mapRepo(data)
  }

  async deleteRepo(token: string, owner: string, repo: string): Promise<void> {
    await this.request(token, 'DELETE', `/repos/${owner}/${repo}`)
  }

  async fork(token: string, owner: string, repo: string): Promise<RemoteRepo> {
    const { data } = await this.request(token, 'POST', `/repos/${owner}/${repo}/forks`, {})
    return this.mapRepo(data)
  }

  async pulls(token: string, owner: string, repo: string, state: string): Promise<PullRequest[]> {
    const list = await this.paged(token, `/repos/${owner}/${repo}/pulls?state=${state}`, 300)
    return list.map((p) => this.mapPull(p, `${owner}/${repo}`))
  }

  async searchMyPulls(_token: string, _login: string, _state: 'open' | 'closed'): Promise<PullRequest[]> {
    throw new AppError('NOT_SUPPORTED')
  }

  async pull(token: string, owner: string, repo: string, n: number): Promise<PullRequest> {
    return this.mapPull(await this.get(token, `/repos/${owner}/${repo}/pulls/${n}`), `${owner}/${repo}`)
  }

  async pullFiles(token: string, owner: string, repo: string, n: number): Promise<PullFile[]> {
    const list = await this.paged(token, `/repos/${owner}/${repo}/pulls/${n}/files`, 3000)
    return list.map((f) => ({
      path: f.filename,
      status: f.status,
      additions: f.additions ?? 0,
      deletions: f.deletions ?? 0,
      patch: f.patch
    }))
  }

  async createPull(token: string, owner: string, repo: string, input: CreatePullInput): Promise<PullRequest> {
    const { data } = await this.request(token, 'POST', `/repos/${owner}/${repo}/pulls`, {
      title: input.title,
      body: input.body,
      head: input.head,
      base: input.base,
      draft: input.draft
    })
    const pr = this.mapPull(data, `${owner}/${repo}`)
    if (input.reviewers.length) {
      try {
        await this.request(token, 'POST', `/repos/${owner}/${repo}/pulls/${pr.number}/requested_reviewers`, {
          reviewers: input.reviewers
        })
      } catch (e) {
        httpLog(`reviewers failed: ${String(e)}`)
      }
    }
    if (input.labels.length) {
      try {
        await this.updateIssue(token, owner, repo, pr.number, { labels: input.labels })
      } catch (e) {
        httpLog(`labels failed: ${String(e)}`)
      }
    }
    return pr
  }

  async mergePull(token: string, owner: string, repo: string, n: number, method: MergeMethod): Promise<void> {
    await this.request(token, 'PUT', `/repos/${owner}/${repo}/pulls/${n}/merge`, { merge_method: method })
  }

  async reviewPull(
    token: string,
    owner: string,
    repo: string,
    n: number,
    event: ReviewEvent,
    body: string
  ): Promise<void> {
    await this.request(token, 'POST', `/repos/${owner}/${repo}/pulls/${n}/reviews`, { event, body })
  }

  async issues(token: string, owner: string, repo: string, state: string, creator?: string): Promise<Issue[]> {
    let path = `/repos/${owner}/${repo}/issues?state=${state}`
    if (creator) path += `&creator=${encodeURIComponent(creator)}`
    const list = await this.paged(token, path, 500)
    return list.filter((i) => !i.pull_request).map((i) => this.mapIssue(i, `${owner}/${repo}`))
  }

  async createIssue(token: string, owner: string, repo: string, input: CreateIssueInput): Promise<Issue> {
    const { data } = await this.request(token, 'POST', `/repos/${owner}/${repo}/issues`, {
      title: input.title,
      body: input.body,
      ...(input.labels.length ? { labels: input.labels } : {})
    })
    return this.mapIssue(data, `${owner}/${repo}`)
  }

  async updateIssue(
    token: string,
    owner: string,
    repo: string,
    n: number,
    patch: { state?: string; labels?: string[] }
  ): Promise<void> {
    await this.request(token, 'PATCH', `/repos/${owner}/${repo}/issues/${n}`, patch)
  }

  async comments(token: string, owner: string, repo: string, n: number): Promise<IssueComment[]> {
    const list = await this.paged(token, `/repos/${owner}/${repo}/issues/${n}/comments`, 500)
    return list.map((c) => ({
      id: String(c.id),
      author: c.user?.login ?? '',
      body: c.body ?? '',
      createdAt: c.created_at
    }))
  }

  async addComment(token: string, owner: string, repo: string, n: number, body: string): Promise<void> {
    await this.request(token, 'POST', `/repos/${owner}/${repo}/issues/${n}/comments`, { body })
  }

  async labels(token: string, owner: string, repo: string): Promise<Label[]> {
    const list = await this.paged(token, `/repos/${owner}/${repo}/labels`, 300)
    return list.map((l) => ({ name: l.name, color: l.color ?? '888888' }))
  }

  async notifications(_token: string): Promise<HostNotification[]> {
    throw new AppError('NOT_SUPPORTED')
  }

  async markNotificationRead(_token: string, _id: string): Promise<void> {
    throw new AppError('NOT_SUPPORTED')
  }
}

export class GitHubProvider extends RestProvider {
  apiBase = process.env.KOTKOD_GITHUB_API || 'https://api.github.com'
  protected accept = 'application/vnd.github+json'
  readonly info: ProviderInfo = {
    id: 'github',
    title: 'GitHub',
    host: 'github.com',
    webUrl: 'https://github.com',
    tokenUrl: 'https://github.com/settings/tokens/new?scopes=repo,read:org,notifications,workflow,delete_repo&description=Kot-kod',
    capabilities: {
      oauth: true,
      notifications: true,
      prMerge: true,
      prReviews: true,
      draftPull: true,
      deleteRepo: true,
      fork: true
    }
  }

  protected headers(token: string): Record<string, string> {
    return { ...super.headers(token), 'X-GitHub-Api-Version': '2022-11-28' }
  }

  async searchMyPulls(token: string, login: string, state: 'open' | 'closed'): Promise<PullRequest[]> {
    const q = encodeURIComponent(`is:pr author:${login} state:${state}`)
    const { data } = await this.request(token, 'GET', `/search/issues?q=${q}&per_page=100&sort=updated`)
    return (data?.items ?? []).map((i: J) => {
      const full = String(i.repository_url ?? '').split('/repos/')[1] ?? ''
      return {
        number: i.number,
        title: i.title,
        body: i.body ?? '',
        state: i.pull_request?.merged_at ? 'merged' : i.state,
        draft: !!i.draft,
        author: i.user?.login ?? '',
        head: '',
        base: '',
        htmlUrl: i.html_url,
        createdAt: i.created_at,
        updatedAt: i.updated_at,
        repoFullName: full,
        labels: (i.labels ?? []).map((l: J) => l.name)
      } as PullRequest
    })
  }

  async notifications(token: string): Promise<HostNotification[]> {
    const list = await this.paged(token, '/notifications?all=false', 300)
    return list.map((n) => ({
      id: String(n.id),
      title: n.subject?.title ?? '',
      type: n.subject?.type ?? '',
      reason: n.reason ?? '',
      repoFullName: n.repository?.full_name ?? '',
      unread: !!n.unread,
      updatedAt: n.updated_at,
      url: apiToHtml(n.subject?.url, n.repository?.html_url)
    }))
  }

  async markNotificationRead(token: string, id: string): Promise<void> {
    await this.request(token, 'PATCH', `/notifications/threads/${id}`)
  }
}

function apiToHtml(api: string | undefined, repoHtml: string | undefined): string | undefined {
  if (!api) return repoHtml
  const m = /\/repos\/([^/]+\/[^/]+)\/(pulls|issues|commits)\/(\w+)/.exec(api)
  if (!m) return repoHtml
  const kind = m[2] === 'pulls' ? 'pull' : m[2] === 'commits' ? 'commit' : 'issues'
  return `https://github.com/${m[1]}/${kind}/${m[3]}`
}

export class GitVerseProvider extends RestProvider {
  apiBase = process.env.KOTKOD_GITVERSE_API || 'https://api.gitverse.ru'
  protected accept = 'application/vnd.gitverse.object+json;version=1'
  protected perPage = 50
  readonly info: ProviderInfo = {
    id: 'gitverse',
    title: 'GitVerse',
    host: 'gitverse.ru',
    webUrl: 'https://gitverse.ru',
    tokenUrl: 'https://gitverse.ru/settings/tokens',
    capabilities: {
      oauth: false,
      notifications: false,
      prMerge: false,
      prReviews: true,
      draftPull: false,
      deleteRepo: true,
      fork: true
    }
  }

  async createPull(token: string, owner: string, repo: string, input: CreatePullInput): Promise<PullRequest> {
    return super.createPull(token, owner, repo, { ...input, draft: false })
  }

  async reviewPull(
    token: string,
    owner: string,
    repo: string,
    n: number,
    event: ReviewEvent,
    body: string
  ): Promise<void> {
    const map: Record<ReviewEvent, string> = {
      APPROVE: 'APPROVED',
      REQUEST_CHANGES: 'REQUEST_CHANGES',
      COMMENT: 'COMMENT'
    }
    await this.request(token, 'POST', `/repos/${owner}/${repo}/pulls/${n}/reviews`, {
      event: map[event],
      body
    })
  }
}

export const providers = {
  github: new GitHubProvider(),
  gitverse: new GitVerseProvider()
}
