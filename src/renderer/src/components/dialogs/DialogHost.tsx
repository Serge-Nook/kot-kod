import { useStore } from '../../store'
import { CloneDialog, CreateDialog, NewBranchDialog, PublishDialog, PushRejectedDialog, RebaseDialog, TagDialog } from './RepoDialogs'
import type { Release } from '@shared/types'
import { CopyReleaseDialog, ReleaseDialog } from './ReleaseDialogs'
import { AboutDialog, AddAccountDialog, CreateIssueDialog, CreatePullDialog, UnlockDialog, UpdateDialog } from './HostDialogs'

export function DialogHost() {
  const d = useStore((s) => s.dialog)
  if (!d) return null
  const p = (d.props ?? {}) as Record<string, never>
  switch (d.name) {
    case 'clone':
      return <CloneDialog {...p} />
    case 'create':
      return <CreateDialog />
    case 'publish':
      return <PublishDialog />
    case 'newBranch':
      return <NewBranchDialog {...p} />
    case 'tag':
      return <TagDialog hash={(d.props?.hash as string) ?? 'HEAD'} />
    case 'rebase':
      return <RebaseDialog base={d.props?.base as string} />
    case 'pushRejected':
      return <PushRejectedDialog />
    case 'createPull':
      return <CreatePullDialog />
    case 'createIssue':
      return <CreateIssueDialog {...p} />
    case 'addAccount':
      return <AddAccountDialog />
    case 'unlock':
      return <UnlockDialog />
    case 'update':
      return <UpdateDialog />
    case 'release':
      return <ReleaseDialog {...p} />
    case 'copyRelease':
      return <CopyReleaseDialog release={d.props?.release as Release} />
    case 'about':
      return <AboutDialog />
    default:
      return null
  }
}
