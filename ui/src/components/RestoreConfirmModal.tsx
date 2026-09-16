import React, { useEffect } from 'react'
import { X, RotateCcw, AlertTriangle } from 'lucide-react'

interface RestoreConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  fileName: string
  isGitWorkspace: boolean
  isRestoring?: boolean
}

export const RestoreConfirmModal: React.FC<RestoreConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  fileName,
  isGitWorkspace,
  isRestoring = false,
}) => {
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isRestoring) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, isRestoring])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-[2px] animate-fade-in select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isRestoring) onClose()
      }}
    >
      <div className="bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[12px] shadow-2xl w-full max-w-md overflow-hidden text-[var(--text)] animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-hover)]/30">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-[var(--danger-bg)] text-[var(--danger)] flex items-center justify-center">
              <RotateCcw className="w-3.5 h-3.5" />
            </div>
            <h3 className="text-xs font-semibold text-[var(--text-heading)]">
              {isGitWorkspace ? 'Restore Staged Version' : 'Restore Snapshot'}
            </h3>
          </div>
          <button
            onClick={onClose}
            disabled={isRestoring}
            className="text-[var(--text-muted)] hover:text-[var(--text-heading)] p-1 rounded-[4px] hover:bg-[var(--bg-hover)] transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-[var(--danger)] shrink-0 mt-0.5" />
            <div className="space-y-1.5 text-xs text-[var(--text)]">
              <p>
                Are you sure you want to restore the {isGitWorkspace ? 'staged / committed' : 'snapshot'} baseline for <span className="font-semibold text-[var(--text-heading)]">{fileName}</span>?
              </p>
              <p className="text-[var(--text-secondary)] text-[11px] leading-relaxed">
                All changes made to this document since the last {isGitWorkspace ? 'stage or commit' : 'snapshot'} will be discarded and replaced with the baseline version.
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-hover)]/20">
          <button
            type="button"
            onClick={onClose}
            disabled={isRestoring}
            className="px-3 py-1.5 rounded-[6px] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] border border-transparent hover:border-[var(--border-subtle)] transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isRestoring}
            className="px-3 py-1.5 rounded-[6px] text-xs font-medium bg-[var(--danger)] text-white hover:opacity-90 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isRestoring ? 'animate-spin' : ''}`} />
            <span>{isRestoring ? 'Restoring...' : 'Restore'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
