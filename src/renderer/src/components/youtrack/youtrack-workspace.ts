import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { LinkedWorkItemSummary } from '@/lib/new-workspace'
import {
  activateAndRevealFolderWorkspace,
  activateAndRevealWorktree
} from '@/lib/worktree-activation'
import { useAppStore } from '@/store'
import { folderWorkspaceToWorktree } from '../../../../shared/folder-workspace-worktree'
import { getLinkedWorkItemWorkspaceName } from '../../../../shared/workspace-name'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import type { Worktree } from '../../../../shared/worktree/types'
import type { YouTrackIssue } from '../../../../shared/youtrack-types'

export function buildYouTrackLinkedWorkItem(issue: YouTrackIssue): LinkedWorkItemSummary {
  return {
    type: 'issue',
    provider: 'youtrack',
    // Why: the linked-item shape is numeric for GitHub/GitLab; string-keyed providers use 0.
    number: 0,
    title: `${issue.idReadable} ${issue.summary}`,
    url: issue.url,
    youtrackIdentifier: issue.idReadable
  }
}

function findInState(
  state: ReturnType<typeof useAppStore.getState>,
  idReadable: string
): Worktree | null {
  const wanted = idReadable.toUpperCase()
  const workspaces = [
    ...state.allWorktrees(),
    ...state.folderWorkspaces.map(folderWorkspaceToWorktree)
  ]
  return (
    workspaces.find(
      (worktree) =>
        !worktree.isArchived &&
        worktree.linkedWorkItem?.provider === 'youtrack' &&
        worktree.linkedWorkItem.youtrackIdentifier?.toUpperCase() === wanted
    ) ?? null
  )
}

export function findYouTrackIssueWorkspace(idReadable: string): Worktree | null {
  return findInState(useAppStore.getState(), idReadable)
}

/** Subscribes so the label flips once worktrees hydrate or a linked one is created. */
export function useHasYouTrackIssueWorkspace(idReadable: string | null): boolean {
  return useAppStore((state) => (idReadable ? findInState(state, idReadable) !== null : false))
}

export function openYouTrackIssueWorkspace(worktree: Worktree): void {
  const scope = parseWorkspaceKey(worktree.id)
  const hostOptions = worktree.hostId ? { executionHostId: worktree.hostId } : {}
  const activation =
    scope?.type === 'folder'
      ? activateAndRevealFolderWorkspace(scope.folderWorkspaceId, {
          navigationIntent: 'user-open',
          ...hostOptions
        })
      : activateAndRevealWorktree(worktree.id, { navigationIntent: 'user-open', ...hostOptions })
  if (activation === false) {
    toast.error(
      translate('youtrack.workspace.openFailed', 'Unable to open the workspace for this issue.')
    )
  }
}

/** Opens the workspace already linked to the issue, otherwise the pre-filled create dialog. */
export function startYouTrackIssueWorkspace(issue: YouTrackIssue): void {
  const existing = findYouTrackIssueWorkspace(issue.idReadable)
  if (existing) {
    openYouTrackIssueWorkspace(existing)
    return
  }
  const linkedWorkItem = buildYouTrackLinkedWorkItem(issue)
  useAppStore.getState().openModal('new-workspace-composer', {
    linkedWorkItem,
    prefilledName: getLinkedWorkItemWorkspaceName(linkedWorkItem)?.seedName ?? '',
    telemetrySource: 'sidebar'
  })
}
