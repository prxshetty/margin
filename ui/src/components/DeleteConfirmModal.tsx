import React, { useRef, useEffect } from 'react'
import { Trash2, AlertTriangle, Loader2 } from 'lucide-react'

interface DeleteConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  fileName: string
  isGitWorkspace: boolean
  isTracked?: boolean
  isModified?: boolean
  isStagedRename?: boolean
  isDeleting?: boolean
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  fileName,
  isGitWorkspace,
  isTracked,
  isModified = false,
  isStagedRename = false,
  isDeleting = false,
}) => {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => confirmRef.current?.focus(), 50)
    }
  }, [isOpen])

  if (!isOpen) return null

  // In a Git workspace, only tracked files are staged for deletion (git rm).
  // Untracked files are immediately deleted from disk (unlink).
  const isStagedDeletion = isGitWorkspace && isTracked !== false

  const getWarningText = () => {
    if (isStagedDeletion) {
      if (isStagedRename) {
        if (isModified) {
          return 'This file is staged for a rename with uncommitted modifications. Deleting it will undo the staged rename and discard current modifications, but you can still restore the committed baseline version from the repository.'
        }
        return 'This file is staged for a rename. Deleting it will undo the staged rename and stage the file for deletion (D). You can still restore the committed version from the repository until changes are committed.'
      }
      if (isModified) {
        return 'This will stage this file for deletion (D). Uncommitted modifications will be lost, but you can still restore the committed baseline version from the repository.'
      }
      return 'This will stage this file for deletion (D). You can still restore it from the repository until changes are committed.'
    }
    if (isGitWorkspace) {
      return 'This is an untracked new file. Deleting it will remove the file permanently.'
    }
    if (isTracked !== false) {
      if (isModified) {
        return 'This will remove the file from your workspace. Current modifications will be lost, but you can still restore the baseline version from the snapshot.'
      }
      return 'This will remove the file from your workspace. You can still restore it from the snapshot baseline.'
    }
    return 'This is a new file with no snapshot baseline. Deleting it will remove the file permanently.'
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isDeleting) onConfirm()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px] animate-fade-in"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
    >
      <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg shadow-xl max-w-md w-full p-5 space-y-4 text-[var(--text)]">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-red-500/10 text-red-500 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-[var(--text-heading)]">
              Delete {fileName}?
            </h3>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              {getWarningText()}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={onClose}
              disabled={isDeleting}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              ref={confirmRef}
              type="submit"
              disabled={isDeleting}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-600 hover:bg-red-700 text-white transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Deleting...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete File</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
