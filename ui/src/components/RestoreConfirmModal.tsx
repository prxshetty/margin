import React, { useRef, useEffect, useState, useMemo } from 'react'
import { RotateCcw, AlertTriangle, Loader2 } from 'lucide-react'
import { API_BASE } from '../lib/api'
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

interface RestoreConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (mode: RestoreMode) => void
  fileName: string
  filePath?: string
  isGitWorkspace: boolean
  isDeleted?: boolean
  isRestoring?: boolean
  fileStatus?: FileStatus
  hasUnstagedChanges?: boolean
  hasCommittedVersion?: boolean
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
    ? (restoreInfo.can_restore_worktree_only || (hasStaged && Boolean(hasUnstagedChanges))) && !isDeleted
    : hasStaged && hasUnstaged && !isDeleted

  const effectiveHasCommitted = restoreInfo
    ? restoreInfo.has_committed_version
    : hasCommittedVersion

  const canStagedAndUnstage = restoreInfo
    ? restoreInfo.can_restore_staged_and_unstage && !isDeleted
    : hasStaged && (hasUnstaged || !effectiveHasCommitted || isRenamed) && !isDeleted

  const canCommitted = restoreInfo
    ? restoreInfo.can_restore_committed
    : Boolean(isDeleted || (effectiveHasCommitted && (!hasStaged || !hasUnstagedChanges)))

  let defaultMode: RestoreMode = 'committed'
  if (!isGitWorkspace) {
    defaultMode = 'committed'
  } else if (canWorktreeOnly) {
    defaultMode = 'worktree_only'
  } else if (canStagedAndUnstage) {
    defaultMode = 'staged_and_unstage'
  } else {
    defaultMode = 'committed'
  }

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

export const RestoreConfirmModal: React.FC<RestoreConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  fileName,
  filePath = '',
  isGitWorkspace,
  isDeleted = false,
  isRestoring = false,
  fileStatus,
  hasUnstagedChanges = false,
  hasCommittedVersion = true,
}) => {
  const confirmRef = useRef<HTMLButtonElement>(null)
  const userSelectedRef = useRef(false)
  const [restoreInfo, setRestoreInfo] = useState<RestoreInfo | null>(null)
  const [selectedMode, setSelectedMode] = useState<RestoreMode>('worktree_only')

  // Fetch precise restore capabilities from the server
  useEffect(() => {
    if (!isOpen || !isGitWorkspace || !filePath) {
      setRestoreInfo(null)
      return
    }

    const controller = new AbortController()
    fetch(`${API_BASE}/api/workspace/restore-info?path=${encodeURIComponent(filePath)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (res.ok) return res.json()
        return null
      })
      .then((data: RestoreInfo | null) => {
        if (data) {
          setRestoreInfo(data)
        }
      })
      .catch(() => {
        // Fallback to local heuristic
      })

    return () => controller.abort()
  }, [isOpen, isGitWorkspace, filePath])

  // Derive option states using pure helper
  const {
    isRenamed,
    renamedFrom,
    hasStaged,
    hasUnstaged,
    canWorktreeOnly,
    canStagedAndUnstage,
    canCommitted,
    defaultMode,
  } = useMemo(
    () =>
      deriveRestoreOptions({
        isGitWorkspace,
        restoreInfo,
        fileStatus,
        hasUnstagedChanges,
        isDeleted,
        hasCommittedVersion,
      }),
    [isGitWorkspace, restoreInfo, fileStatus, hasUnstagedChanges, isDeleted, hasCommittedVersion]
  )

  const origName = renamedFrom ? (renamedFrom.split('/').pop() || renamedFrom) : fileName

  // Automatically select the least destructive enabled option upon open or capability refresh
  useEffect(() => {
    if (!isOpen) {
      userSelectedRef.current = false
      return
    }

    if (!userSelectedRef.current) {
      setSelectedMode(defaultMode)
    } else {
      // If user selected an option that became disabled, fall back to defaultMode
      const isSelectedValid =
        (selectedMode === 'worktree_only' && canWorktreeOnly) ||
        (selectedMode === 'staged_and_unstage' && canStagedAndUnstage) ||
        (selectedMode === 'committed' && canCommitted)
      if (!isSelectedValid) {
        setSelectedMode(defaultMode)
      }
    }
  }, [isOpen, defaultMode, selectedMode, canWorktreeOnly, canStagedAndUnstage, canCommitted])

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => confirmRef.current?.focus(), 50)
    }
  }, [isOpen])

  const options = useMemo(() => {
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
  }, [canWorktreeOnly, canStagedAndUnstage, canCommitted, hasStaged, hasUnstaged, isDeleted])

  if (!isOpen) return null

  const isCurrentModeValid = isGitWorkspace
    ? (selectedMode === 'worktree_only' && canWorktreeOnly) ||
      (selectedMode === 'staged_and_unstage' && canStagedAndUnstage) ||
      (selectedMode === 'committed' && canCommitted)
    : true

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isRestoring && isCurrentModeValid) {
      onConfirm(selectedMode)
    }
  }

  const dynamicDescription = getDynamicDescription(
    selectedMode,
    fileName,
    isRenamed,
    renamedFrom,
    isDeleted,
    isGitWorkspace
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px] animate-fade-in"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
    >
      <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg shadow-xl max-w-lg w-full p-5 space-y-4 text-[var(--text)]">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-amber-500/10 text-amber-500 shrink-0 mt-0.5">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-[var(--text-heading)]">
                Restore {fileName}?
              </h3>
              {isRenamed && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-500 border border-amber-500/20">
                  Renamed from {origName}
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              {isGitWorkspace
                ? 'Select how you want to restore this document from the Git repository:'
                : isDeleted
                ? 'This file was deleted. Restoring will recover the file from the last snapshot baseline.'
                : 'This will discard all changes made since the last snapshot baseline was created for this file.'}
            </p>
          </div>
        </div>

        {isGitWorkspace && (
          <div className="space-y-2 pt-1">
            <label className="text-xs font-medium text-[var(--text-heading)] block">
              Restore Option
            </label>
            <div className="space-y-1.5" role="radiogroup" aria-label="Restore options">
              {options.map((opt) => (
                <label
                  key={opt.mode}
                  className={`flex items-start gap-2.5 p-2.5 rounded-md border transition-all text-xs select-none ${
                    opt.disabled
                      ? 'opacity-40 cursor-not-allowed bg-[var(--bg-disabled)]/30 border-[var(--border-subtle)]'
                      : selectedMode === opt.mode
                      ? 'border-amber-500/70 bg-amber-500/10 cursor-pointer shadow-xs'
                      : 'border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] cursor-pointer'
                  }`}
                >
                  <input
                    type="radio"
                    name="restore-mode"
                    value={opt.mode}
                    checked={selectedMode === opt.mode}
                    disabled={opt.disabled}
                    onChange={() => {
                      if (!opt.disabled) {
                        userSelectedRef.current = true
                        setSelectedMode(opt.mode)
                      }
                    }}
                    className="mt-0.5 accent-amber-600"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 flex-wrap">
                      <span className={`font-medium ${selectedMode === opt.mode && !opt.disabled ? 'text-amber-500' : 'text-[var(--text)]'}`}>
                        {opt.label}
                      </span>
                      <code className="text-[10px] text-[var(--text-muted)] font-mono shrink-0">
                        {opt.commandHint}
                      </code>
                    </div>
                    {opt.disabled && opt.disabledReason && (
                      <p className="text-[10px] text-[var(--text-muted)] italic mt-0.5">
                        {opt.disabledReason}
                      </p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Dynamic description box (Git workspace restore modes) */}
        {isGitWorkspace && (
          <div className="p-3 rounded-md bg-[var(--bg-input)] border border-[var(--border-subtle)] flex items-start gap-2.5">
            <div className="p-1 rounded bg-amber-500/10 text-amber-500 shrink-0 mt-0.5">
              <RotateCcw className="w-3.5 h-3.5" />
            </div>
            <div className="space-y-1 min-w-0 flex-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] block">
                Impact of Selected Option
              </span>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                {dynamicDescription}
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={onClose}
              disabled={isRestoring}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              ref={confirmRef}
              type="submit"
              disabled={isRestoring || (isGitWorkspace && !isCurrentModeValid)}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-amber-600 hover:bg-amber-700 text-white transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRestoring ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Restoring...</span>
                </>
              ) : (
                <>
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restore File</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
