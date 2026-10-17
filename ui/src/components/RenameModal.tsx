import React, { useState, useEffect, useRef } from 'react'
import { Pencil, Loader2 } from 'lucide-react'

interface RenameModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (newName: string) => Promise<void> | void
  currentName: string
  isGitWorkspace: boolean
  isTracked?: boolean
  isRenaming?: boolean
}

export const RenameModal: React.FC<RenameModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  currentName,
  isGitWorkspace,
  isTracked = true,
  isRenaming = false,
}) => {
  const [name, setName] = useState(currentName)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setName(currentName)
      setError(null)
      const timer = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          const dotIdx = currentName.lastIndexOf('.')
          if (dotIdx > 0) {
            inputRef.current.setSelectionRange(0, dotIdx)
          } else {
            inputRef.current.select()
          }
        }
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isOpen, currentName])

  if (!isOpen) return null

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('File name cannot be empty')
      return
    }
    if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.startsWith('.')) {
      setError('Invalid file name (avoid slashes and leading dots)')
      return
    }
    if (trimmed === currentName) {
      onClose()
      return
    }
    onConfirm(trimmed)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px] animate-fade-in">
      <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg shadow-xl max-w-md w-full p-5 space-y-4 text-[var(--text)]">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-purple-500/10 text-purple-400 shrink-0">
            <Pencil className="w-5 h-5" />
          </div>
          <div className="space-y-1 flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text-heading)]">
              Rename Document
            </h3>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              {isGitWorkspace
                ? isTracked
                  ? 'Renaming this file will preserve Git history and stage the rename (R).'
                  : 'Renaming this untracked file will move it on disk and stage it as a new file.'
                : 'Renaming this file will update the document name and folder manifest.'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
              File Name
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (error) setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose()
              }}
              disabled={isRenaming}
              className="w-full px-3 py-1.5 bg-[var(--bg)] border border-[var(--border-subtle)] focus:border-[var(--accent-brown)] rounded-[6px] text-xs text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none transition-colors"
              placeholder="e.g. chapter-1.md"
            />
            {error && (
              <p className="text-[11px] text-red-400 mt-1 font-medium">{error}</p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={onClose}
              disabled={isRenaming}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isRenaming || !name.trim() || name.trim() === currentName}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--accent-brown)] hover:opacity-90 text-white transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRenaming ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Renaming...</span>
                </>
              ) : (
                <>
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Rename</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
