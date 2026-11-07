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

export interface HostUser {
  login: string
  name?: string
  email?: string
  avatarUrl?: string
}

export interface IHostingProvider {
  readonly info: ProviderInfo
  apiBase: string
  user(token: string): Promise<HostUser>
  repos(token: string): Promise<RemoteRepo[]>
  repo(token: string, owner: string, repo: string): Promise<RemoteRepo>
  createRepo(token: string, input: CreateRemoteRepoInput): Promise<RemoteRepo>
  deleteRepo(token: string, owner: string, repo: string): Promise<void>
  fork(token: string, owner: string, repo: string): Promise<RemoteRepo>
  pulls(token: string, owner: string, repo: string, state: string): Promise<PullRequest[]>
  searchMyPulls(token: string, login: string, state: 'open' | 'closed'): Promise<PullRequest[]>
  pull(token: string, owner: string, repo: string, n: number): Promise<PullRequest>
  pullFiles(token: string, owner: string, repo: string, n: number): Promise<PullFile[]>
  createPull(token: string, owner: string, repo: string, input: CreatePullInput): Promise<PullRequest>
  mergePull(token: string, owner: string, repo: string, n: number, method: MergeMethod): Promise<void>
  reviewPull(token: string, owner: string, repo: string, n: number, event: ReviewEvent, body: string): Promise<void>
  issues(token: string, owner: string, repo: string, state: string, creator?: string): Promise<Issue[]>
  createIssue(token: string, owner: string, repo: string, input: CreateIssueInput): Promise<Issue>
  updateIssue(token: string, owner: string, repo: string, n: number, patch: { state?: string; labels?: string[] }): Promise<void>
  comments(token: string, owner: string, repo: string, n: number): Promise<IssueComment[]>
  addComment(token: string, owner: string, repo: string, n: number, body: string): Promise<void>
  labels(token: string, owner: string, repo: string): Promise<Label[]>
  notifications(token: string): Promise<HostNotification[]>
  markNotificationRead(token: string, id: string): Promise<void>
}
