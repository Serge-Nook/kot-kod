export type ProviderId = 'github' | 'gitverse'

export interface Account {
  id: string
  provider: ProviderId
  login: string
  name?: string
  email?: string
  avatarUrl?: string
  authMethod: 'token' | 'oauth'
  addedAt: string
}

export interface ProviderCapabilities {
  oauth: boolean
  notifications: boolean
  prMerge: boolean
  prReviews: boolean
  draftPull: boolean
  deleteRepo: boolean
  fork: boolean
}

export interface ProviderInfo {
  id: ProviderId
  title: string
  host: string
  webUrl: string
  tokenUrl: string
  capabilities: ProviderCapabilities
}

export interface RemoteRepo {
  id: string
  name: string
  fullName: string
  owner: string
  description?: string
  private: boolean
  fork: boolean
  cloneUrl: string
  sshUrl?: string
  htmlUrl: string
  defaultBranch: string
  updatedAt?: string
  parentFullName?: string
  parentCloneUrl?: string
}

export type StatusCode = '.' | 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?' | 'T' | '!'

export interface FileChange {
  path: string
  oldPath?: string
  index: StatusCode
  worktree: StatusCode
  staged: boolean
  unstaged: boolean
  untracked: boolean
  conflicted: boolean
}

export type RepoState = 'clean' | 'merging' | 'rebasing' | 'cherry-picking' | 'reverting'

export interface RepoStatus {
  branch: string | null
  detached: boolean
  headOid?: string
  upstream?: string
  ahead: number
  behind: number
  files: FileChange[]
  state: RepoState
  hasCommits: boolean
}

export interface Commit {
  hash: string
  shortHash: string
  parents: string[]
  authorName: string
  authorEmail: string
  date: string
  subject: string
  body: string
  refs: string[]
}

export interface CommitFile {
  path: string
  oldPath?: string
  status: StatusCode
}

export interface Branch {
  name: string
  ref: string
  remote: boolean
  current: boolean
  upstream?: string
  ahead: number
  behind: number
  gone: boolean
  hash: string
  date: string
  subject: string
}

export interface StashEntry {
  index: number
  ref: string
  message: string
  date: string
}

export interface Tag {
  name: string
  hash: string
  date: string
  subject: string
}

export interface Remote {
  name: string
  fetchUrl: string
  pushUrl: string
}

export type DiffLineType = 'ctx' | 'add' | 'del' | 'nonl'

export interface DiffLine {
  type: DiffLineType
  text: string
  oldNo?: number
  newNo?: number
}

export interface DiffHunk {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  section: string
  lines: DiffLine[]
}

export interface DiffFile {
  path: string
  oldPath?: string
  binary: boolean
  isNew: boolean
  isDeleted: boolean
  headerLines: string[]
  hunks: DiffHunk[]
  tooLarge?: boolean
}

export interface ConflictVersions {
  path: string
  base: string | null
  ours: string | null
  theirs: string | null
  working: string
}

export interface RebaseTodoItem {
  action: 'pick' | 'reword' | 'squash' | 'fixup' | 'drop'
  hash: string
  subject: string
  message?: string
}

export interface PullRequest {
  number: number
  title: string
  body: string
  state: 'open' | 'closed' | 'merged'
  draft: boolean
  author: string
  head: string
  base: string
  htmlUrl: string
  createdAt: string
  updatedAt: string
  repoFullName: string
  labels: string[]
  mergeable?: boolean | null
}

export interface PullFile {
  path: string
  status: string
  additions: number
  deletions: number
  patch?: string
}

export interface Issue {
  number: number
  title: string
  body: string
  state: 'open' | 'closed'
  author: string
  labels: string[]
  comments: number
  htmlUrl: string
  createdAt: string
  repoFullName: string
}

export interface IssueComment {
  id: string
  author: string
  body: string
  createdAt: string
}

export interface Label {
  name: string
  color: string
}

export interface HostNotification {
  id: string
  title: string
  type: string
  reason: string
  repoFullName: string
  unread: boolean
  updatedAt: string
  url?: string
}

export interface RecentRepo {
  path: string
  name: string
  lastOpened: string
}

export interface RepoSummary {
  path: string
  exists: boolean
  branch: string | null
  changes: number
  ahead: number
  behind: number
}

export type ThemeMode = 'dark' | 'light' | 'system'
export type Language = 'ru' | 'en' | 'zh'

export interface CommitDraft {
  summary: string
  description: string
  coAuthors: string
}

export interface Settings {
  language: Language
  theme: ThemeMode
  accent: 'blue' | 'forest'
  zoom: number
  diffMode: 'split' | 'unified'
  recentRepos: RecentRepo[]
  lastRepo?: string
  cloneDir: string
  shortcuts: Record<string, string>
  githubClientId: string
  commitDrafts: Record<string, CommitDraft>
  commitHistory: string[]
  activeAccountId?: string
  checkUpdates: boolean
  autoFetchMinutes: number
  pendingPush: string[]
}

export interface GitProgress {
  op: string
  phase: string
  percent: number | null
  line: string
}

export interface UpdateInfo {
  current: string
  latest: string
  available: boolean
  url: string
  appImage: boolean
  aptCommand?: string
}

export interface DeviceCodeInfo {
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
  deviceCode: string
}

export interface AppInfo {
  version: string
  gitVersion: string | null
  gitOk: boolean
  platform: string
  appImage: boolean
  configDir: string
  logDir: string
  secretsBackend: 'keyring' | 'password' | 'locked'
  electron: string
}
