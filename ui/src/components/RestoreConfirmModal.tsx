import React, { useRef, useEffect, useState, useMemo } from 'react'
import { RotateCcw, AlertTriangle, Loader2 } from 'lucide-react'
import { API_BASE } from '../lib/api'
import type { FileStatus } from '../stores/editorStore'
import {
  type RestoreMode,
  type RestoreInfo,
  deriveRestoreOptions,
  getDynamicDescription,
  buildRestoreOptions,
} from '../lib/restoreOptions'

export type { RestoreMode, RestoreInfo }

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

  const [selectedMode, setSelectedMode] = useState<RestoreMode>(defaultMode)

  // Fetch precise restore capabilities from the server
  useEffect(() => {
    userSelectedRef.current = false
    if (!isOpen || !isGitWorkspace || !filePath) {
      setRestoreInfo(null)
      return
    }

    let active = true
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    fetch(`${API_BASE}/api/workspace/restore-info?path=${encodeURIComponent(filePath)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (res.ok) return res.json()
        return null
      })
      .then((data: RestoreInfo | null) => {
        if (active && data) {
          setRestoreInfo(data)
        }
      })
      .catch(() => {
        // Fallback to local heuristic
      })
      .finally(() => {
        clearTimeout(timeoutId)
      })

    return () => {
      active = false
      clearTimeout(timeoutId)
      controller.abort()
    }
  }, [isOpen, isGitWorkspace, filePath])

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
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isRestoring) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isRestoring, onClose])

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => confirmRef.current?.focus(), 50)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  const options = useMemo(
    () =>
      buildRestoreOptions({
        canWorktreeOnly,
        canStagedAndUnstage,
        canCommitted,
        hasStaged,
        hasUnstaged,
        isDeleted,
      }),
    [canWorktreeOnly, canStagedAndUnstage, canCommitted, hasStaged, hasUnstaged, isDeleted]
  )

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px] animate-fade-in">
      <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg shadow-xl max-w-lg w-full p-5 space-y-4 text-[var(--text)]">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-[var(--accent-brown)]/10 text-[var(--accent-brown)] shrink-0 mt-0.5">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-[var(--text-heading)]">
                Restore {fileName}?
              </h3>
              {isRenamed && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--accent-brown)]/15 text-[var(--accent-brown)] border border-[var(--accent-brown)]/20">
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

        <form onSubmit={handleSubmit} className="space-y-4">
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
                        ? 'border-[var(--accent-brown)]/70 bg-[var(--accent-brown)]/10 cursor-pointer shadow-xs'
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
                      className="mt-0.5 accent-[var(--accent-brown)]"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 flex-wrap">
                        <span className={`font-medium ${selectedMode === opt.mode && !opt.disabled ? 'text-[var(--accent-brown)]' : 'text-[var(--text)]'}`}>
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
              <div className="p-1 rounded bg-[var(--accent-brown)]/10 text-[var(--accent-brown)] shrink-0 mt-0.5">
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
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--accent-brown)] hover:opacity-90 text-[var(--text-inverse)] transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
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
