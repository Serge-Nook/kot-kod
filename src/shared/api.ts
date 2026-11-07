import type {
  Account,
  AppInfo,
  Branch,
  Commit,
  CommitFile,
  ConflictVersions,
  DeviceCodeInfo,
  DiffFile,
  HostNotification,
  Issue,
  IssueComment,
  Label,
  ProviderId,
  ProviderInfo,
  PullFile,
  PullRequest,
  RebaseTodoItem,
  Remote,
  RemoteRepo,
  RepoStatus,
  RepoSummary,
  Settings,
  StashEntry,
  Tag,
  UpdateInfo
} from './types'

export interface LogQuery {
  limit: number
  skip?: number
  all?: boolean
  search?: string
  author?: string
  ref?: string
}

export interface CommitInput {
  summary: string
  description: string
  coAuthors: string[]
  amend: boolean
}

export interface InitInput {
  path: string
  defaultBranch: string
  gitignore: string[]
  license: string
  readme: boolean
  authorName: string
}

export interface CreateRemoteRepoInput {
  name: string
  description: string
  private: boolean
}

export interface CreatePullInput {
  title: string
  body: string
  head: string
  base: string
  draft: boolean
  reviewers: string[]
  labels: string[]
}

export interface CreateIssueInput {
  title: string
  body: string
  labels: string[]
}

export type MergeMethod = 'merge' | 'squash' | 'rebase'
export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'

export interface RepoRef {
  accountId: string
  owner: string
  repo: string
  /** owner of the `origin` remote when it differs from `owner` (fork workflow) */
  originOwner?: string
}

export interface Api {
  app: {
    info(): Promise<AppInfo>
    openExternal(url: string): Promise<void>
    openPath(path: string): Promise<void>
    showInFolder(path: string): Promise<void>
    openTerminal(path: string): Promise<void>
    pickDirectory(title: string, defaultPath?: string): Promise<string | null>
    checkUpdate(): Promise<UpdateInfo>
    downloadUpdate(): Promise<void>
    readLogTail(): Promise<string>
    reportProblem(): Promise<void>
    setZoom(zoom: number): Promise<void>
    unlockSecrets(password: string): Promise<boolean>
    readHelp(lang: string): Promise<string>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
    saveDraft(repoPath: string, draft: Settings['commitDrafts'][string] | null): Promise<void>
    gitignoreTemplates(): Promise<string[]>
    gitignoreTemplate(name: string): Promise<string>
    licenses(): Promise<string[]>
  }
  repos: {
    add(path: string): Promise<string>
    remove(path: string): Promise<void>
    summaries(paths: string[]): Promise<RepoSummary[]>
    init(input: InitInput): Promise<string>
    clone(url: string, dir: string, accountId?: string): Promise<string>
    deleteLocal(path: string): Promise<void>
  }
  git: {
    status(repo: string): Promise<RepoStatus>
    diff(repo: string, path: string, staged: boolean, untracked: boolean): Promise<DiffFile | null>
    stage(repo: string, paths: string[]): Promise<void>
    unstage(repo: string, paths: string[]): Promise<void>
    applyPatch(repo: string, patch: string, mode: 'stage' | 'unstage' | 'discard'): Promise<void>
    discard(repo: string, paths: string[]): Promise<void>
    commit(repo: string, input: CommitInput): Promise<string>
    lastCommitMessage(repo: string): Promise<string>
    log(repo: string, q: LogQuery): Promise<Commit[]>
    commitFiles(repo: string, hash: string): Promise<CommitFile[]>
    commitDiff(repo: string, hash: string, path: string): Promise<DiffFile | null>
    branches(repo: string): Promise<Branch[]>
    createBranch(repo: string, name: string, start: string | null, checkout: boolean): Promise<void>
    renameBranch(repo: string, oldName: string, newName: string): Promise<void>
    deleteBranch(repo: string, name: string, force: boolean, remoteToo: boolean): Promise<void>
    checkout(repo: string, branch: string, carry: 'keep' | 'stash'): Promise<void>
    checkoutCommit(repo: string, hash: string): Promise<void>
    merge(repo: string, branch: string, mode: 'merge' | 'squash' | 'no-ff'): Promise<string>
    rebase(repo: string, onto: string): Promise<string>
    rebaseInteractive(repo: string, base: string, todo: RebaseTodoItem[]): Promise<string>
    continueOp(repo: string): Promise<string>
    abortOp(repo: string): Promise<void>
    skipOp(repo: string): Promise<string>
    cherryPick(repo: string, hash: string): Promise<string>
    revert(repo: string, hash: string): Promise<string>
    reset(repo: string, hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void>
    stashList(repo: string): Promise<StashEntry[]>
    stashPush(repo: string, message: string, untracked: boolean): Promise<void>
    stashApply(repo: string, ref: string, pop: boolean): Promise<void>
    stashDrop(repo: string, ref: string): Promise<void>
    stashDiff(repo: string, ref: string): Promise<DiffFile[]>
    tags(repo: string): Promise<Tag[]>
    createTag(repo: string, name: string, hash: string, message: string): Promise<void>
    deleteTag(repo: string, name: string, remoteToo: boolean): Promise<void>
    pushTag(repo: string, name: string): Promise<void>
    remotes(repo: string): Promise<Remote[]>
    addRemote(repo: string, name: string, url: string): Promise<void>
    removeRemote(repo: string, name: string): Promise<void>
    setRemoteUrl(repo: string, name: string, url: string): Promise<void>
    fetch(repo: string): Promise<void>
    pull(repo: string, mode: 'merge' | 'rebase' | 'ff-only'): Promise<string>
    push(repo: string, opts: { force: boolean; setUpstream: boolean; tags?: boolean }): Promise<void>
    conflict(repo: string, path: string): Promise<ConflictVersions>
    resolve(repo: string, path: string, how: 'ours' | 'theirs' | 'content', content?: string): Promise<void>
    readGitignore(repo: string): Promise<string>
    writeGitignore(repo: string, content: string): Promise<void>
    ignorePath(repo: string, pattern: string): Promise<void>
    config(repo: string): Promise<{ name: string; email: string }>
    setConfig(repo: string | null, name: string, email: string): Promise<void>
  }
  accounts: {
    list(): Promise<Account[]>
    providers(): Promise<ProviderInfo[]>
    addToken(provider: ProviderId, token: string): Promise<Account>
    startDeviceFlow(provider: ProviderId): Promise<DeviceCodeInfo>
    finishDeviceFlow(provider: ProviderId, info: DeviceCodeInfo): Promise<Account>
    remove(id: string, revoke: boolean): Promise<void>
    setActive(id: string): Promise<void>
  }
  hosting: {
    repos(accountId: string): Promise<RemoteRepo[]>
    repoForPath(repoPath: string): Promise<RepoRef | null>
    createRepo(accountId: string, input: CreateRemoteRepoInput): Promise<RemoteRepo>
    publish(repoPath: string, accountId: string, input: CreateRemoteRepoInput): Promise<RemoteRepo>
    deleteRepo(ref: RepoRef): Promise<void>
    fork(ref: RepoRef): Promise<RemoteRepo>
    forkAndClone(ref: RepoRef, dir: string): Promise<string>
    forkCurrent(repoPath: string, ref: RepoRef): Promise<void>
    pulls(ref: RepoRef, state: 'open' | 'closed' | 'all', mine: boolean): Promise<PullRequest[]>
    myPulls(accountId: string, state: 'open' | 'closed'): Promise<PullRequest[]>
    pull(ref: RepoRef, n: number): Promise<PullRequest>
    pullFiles(ref: RepoRef, n: number): Promise<PullFile[]>
    pullComments(ref: RepoRef, n: number): Promise<IssueComment[]>
    createPull(ref: RepoRef, input: CreatePullInput): Promise<PullRequest>
    mergePull(ref: RepoRef, n: number, method: MergeMethod): Promise<void>
    reviewPull(ref: RepoRef, n: number, event: ReviewEvent, body: string): Promise<void>
    issues(ref: RepoRef, state: 'open' | 'closed' | 'all', mine: boolean): Promise<Issue[]>
    createIssue(ref: RepoRef, input: CreateIssueInput): Promise<Issue>
    setIssueState(ref: RepoRef, n: number, state: 'open' | 'closed'): Promise<void>
    setIssueLabels(ref: RepoRef, n: number, labels: string[]): Promise<void>
    issueComments(ref: RepoRef, n: number): Promise<IssueComment[]>
    addComment(ref: RepoRef, n: number, body: string): Promise<void>
    labels(ref: RepoRef): Promise<Label[]>
    notifications(accountId: string): Promise<HostNotification[]>
    markNotificationRead(accountId: string, id: string): Promise<void>
  }
}

export type ApiEvent =
  | { type: 'progress'; repo: string; progress: import('./types').GitProgress }
  | { type: 'repo-changed'; repo: string }
  | { type: 'update-downloaded' }
  | { type: 'update-progress'; percent: number }
  | { type: 'crash-recovered'; report: string }

export interface ApiError {
  code: string
  message: string
  details?: string
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiError }
