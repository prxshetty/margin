import type { FileStatus } from '../stores/editorStore'

export type RestoreMode = 'worktree_only' | 'staged_and_unstage' | 'committed'

export interface RestoreInfo {
  is_git: boolean
  path: string
  fileName: string
  is_renamed: boolean
  renamed_from: string | null
  is_deleted: boolean
  has_staged_changes: boolean
  has_unstaged_changes: boolean
  has_committed_version: boolean
  can_restore_worktree_only: boolean
  can_restore_staged_and_unstage: boolean
  can_restore_committed: boolean
}

export interface OptionState {
  canWorktreeOnly: boolean
  canStagedAndUnstage: boolean
  canCommitted: boolean
  hasStaged: boolean
  hasUnstaged: boolean
  isDeleted: boolean
}

export interface RestoreOptionItem {
  mode: RestoreMode
  label: string
  commandHint: string
  disabled: boolean
  disabledReason?: string
}

export function resolveDefaultRestoreMode(
  isGitWorkspace: boolean,
  canWorktreeOnly: boolean,
  canStagedAndUnstage: boolean,
  isDeleted = false,
  canCommitted = true
): RestoreMode {
  if (!isGitWorkspace) return 'committed'
  if (isDeleted && canCommitted) return 'committed'
  if (canWorktreeOnly) return 'worktree_only'
  if (canStagedAndUnstage) return 'staged_and_unstage'
  return 'committed'
}

export function deriveRestoreOptions({
  isGitWorkspace,
  restoreInfo,
  fileStatus,
  hasUnstagedChanges = false,
  isDeleted = false,
  hasCommittedVersion = true,
}: {
  isGitWorkspace: boolean
  restoreInfo: RestoreInfo | null
  fileStatus?: FileStatus
  hasUnstagedChanges?: boolean
  isDeleted?: boolean
  hasCommittedVersion?: boolean
}) {
  const isRenamed = restoreInfo
    ? restoreInfo.is_renamed
    : fileStatus === 'staged_renamed' || fileStatus === 'staged_renamed_modified'
  const renamedFrom = restoreInfo?.renamed_from ?? null

  const hasStaged = restoreInfo
    ? restoreInfo.has_staged_changes
    : fileStatus === 'staged' ||
      fileStatus === 'staged_modified' ||
      isRenamed ||
      fileStatus === 'staged_deleted'

  const isWorkingModified =
    Boolean(hasUnstagedChanges) ||
    fileStatus === 'unstaged_modified' ||
    fileStatus === 'staged_modified' ||
    fileStatus === 'staged_renamed_modified'

  const hasUnstaged = restoreInfo
    ? restoreInfo.has_unstaged_changes || Boolean(hasUnstagedChanges)
    : isWorkingModified || isDeleted

  const canWorktreeOnly = restoreInfo
    ? restoreInfo.can_restore_worktree_only || (hasStaged && Boolean(hasUnstagedChanges) && !isDeleted)
    : hasStaged && hasUnstaged && !isDeleted

  const effectiveHasCommitted = restoreInfo
    ? restoreInfo.has_committed_version
    : hasCommittedVersion ?? true

  const canStagedAndUnstage = restoreInfo
    ? restoreInfo.can_restore_staged_and_unstage
    : ((hasStaged && (hasUnstaged || !effectiveHasCommitted || isRenamed) && !isDeleted) ||
       (fileStatus === 'staged_deleted' && !effectiveHasCommitted))

  const canCommitted = restoreInfo
    ? restoreInfo.can_restore_committed
    : !isGitWorkspace || Boolean(effectiveHasCommitted)

  const defaultMode = resolveDefaultRestoreMode(
    isGitWorkspace,
    canWorktreeOnly,
    canStagedAndUnstage,
    isDeleted,
    canCommitted
  )

  return {
    isRenamed,
    renamedFrom,
    hasStaged,
    hasUnstaged,
    canWorktreeOnly,
    canStagedAndUnstage,
    canCommitted,
    defaultMode,
  }
}

export function getDynamicDescription(
  mode: RestoreMode,
  fileName: string,
  isRenamed: boolean,
  renamedFrom: string | null,
  isDeleted: boolean,
  isGitWorkspace: boolean
): string {
  if (!isGitWorkspace) {
    return isDeleted
      ? 'This file was deleted. Restoring will recover the file from the last snapshot baseline. Any modifications made prior to deletion have been lost.'
      : 'This will discard all changes made since the last snapshot baseline was created for this file.'
  }

  const origName = renamedFrom ? (renamedFrom.split('/').pop() || renamedFrom) : fileName

  if (isRenamed) {
    if (mode === 'worktree_only') {
      return `This file was renamed from ${origName}. Restoring to the worktree only will discard uncommitted modifications in the editor, reverting the file to its staged version. The file will remain renamed as ${fileName} and remain staged in Git.`
    }
    if (mode === 'staged_and_unstage') {
      return `This file was renamed from ${origName}. Restoring the staged version and unstaging will undo the staged rename, restore ${origName} with the staged content, and unstage it so changes are preserved in your working copy as uncommitted modifications.`
    }
    // committed
    return `This file was renamed from ${origName}. Restoring to the committed version will undo the rename, remove ${fileName}, and restore ${origName} to its committed baseline version from repository HEAD (all changes will be lost).`
  }

  if (isDeleted) {
    if (mode === 'staged_and_unstage') {
      return 'This file was staged for deletion. Restoring and unstaging will undo the staged deletion in Git.'
    }
    return 'This file was deleted in Git. Restoring will recover the committed version from the repository (HEAD). Any uncommitted modifications made prior to deletion have been lost.'
  }

  if (mode === 'worktree_only') {
    return 'This will discard uncommitted modifications in your working copy and restore the file to the staged version. Staged changes will remain staged in Git.'
  }

  if (mode === 'staged_and_unstage') {
    return 'This will restore the content of the staged version to the working tree and unstage it. Your staged changes will be kept in your working copy as uncommitted modifications.'
  }

  // committed
  return 'This will discard all uncommitted modifications and staged changes in this file and restore it to the committed baseline version from repository HEAD.'
}

export function buildRestoreOptions(state: OptionState): RestoreOptionItem[] {
  const { canWorktreeOnly, canStagedAndUnstage, canCommitted, hasStaged, hasUnstaged, isDeleted } = state
  return [
    {
      mode: 'worktree_only' as RestoreMode,
      label: 'Restore staged version to worktree only',
      commandHint: 'git restore',
      disabled: !canWorktreeOnly,
      disabledReason: isDeleted
        ? '(File is deleted)'
        : !hasStaged
        ? '(Document has not been staged since commit)'
        : !hasUnstaged
        ? '(Working copy already matches staged version)'
        : undefined,
    },
    {
      mode: 'staged_and_unstage' as RestoreMode,
      label: 'Restore staged version and unstage',
      commandHint: 'git restore + git restore --staged',
      disabled: !canStagedAndUnstage,
      disabledReason: isDeleted
        ? '(File is deleted)'
        : !hasStaged
        ? '(Document has not been staged since commit)'
        : !hasUnstaged
        ? '(Working copy already matches staged version)'
        : undefined,
    },
    {
      mode: 'committed' as RestoreMode,
      label: 'Restore to committed version and unstage',
      commandHint: 'git restore --staged --worktree',
      disabled: !canCommitted,
      disabledReason: !canCommitted
        ? '(No committed version in repository)'
        : undefined,
    },
  ]
}
