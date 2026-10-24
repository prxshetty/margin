import React, { useState, useEffect, useRef } from 'react'
import { FilePlus, FolderPlus, Loader2 } from 'lucide-react'

interface CreateFileModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (name: string) => Promise<void> | void
  /** The target folder the file will be placed in, shown in the subtitle */
  folder: string
  /** When true renders the folder-creation variant */
  isFolder?: boolean
  isCreating?: boolean
}

export const CreateFileModal: React.FC<CreateFileModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  folder,
  isFolder = false,
  isCreating = false,
}) => {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setName(isFolder ? '' : 'new-file.md')
      setError(null)
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          const val = inputRef.current.value
          const dotIdx = val.lastIndexOf('.')
          if (dotIdx > 0) {
            inputRef.current.setSelectionRange(0, dotIdx)
          } else {
            inputRef.current.select()
          }
        }
      }, 50)
    }
  }, [isOpen, isFolder])

  if (!isOpen) return null

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError(`${isFolder ? 'Folder' : 'File'} name cannot be empty`)
      return
    }
    if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.startsWith('.')) {
      setError('Invalid name (avoid slashes and leading dots)')
      return
    }
    onConfirm(trimmed)
  }

  const Icon = isFolder ? FolderPlus : FilePlus

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px] animate-fade-in">
      <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg shadow-xl max-w-md w-full p-5 space-y-4 text-[var(--text)]">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-[var(--accent-brown)]/10 text-[var(--accent-brown)] shrink-0">
            <Icon className="w-5 h-5" />
          </div>
          <div className="space-y-1 flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text-heading)]">
              {isFolder ? 'New Folder' : 'New File'}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              {isFolder
                ? 'Enter a folder name. A default manifest file will be created inside it.'
                : `New file will be saved to ${folder}/.`}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
              {isFolder ? 'Folder Name' : 'File Name'}
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
              disabled={isCreating}
              className="w-full px-3 py-1.5 bg-[var(--bg)] border border-[var(--border-subtle)] focus:border-[var(--accent-brown)] rounded-[6px] text-xs text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none transition-colors"
              placeholder={isFolder ? "e.g. world_building" : "e.g. chapter-2.md"}
            />
            {error && (
              <p className="text-[11px] text-red-400 mt-1 font-medium">{error}</p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={onClose}
              disabled={isCreating}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isCreating || !name.trim()}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--accent-brown)] hover:opacity-90 text-white transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCreating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Creating...</span>
                </>
              ) : (
                <>
                  <Icon className="w-3.5 h-3.5" />
                  <span>{isFolder ? 'Create Folder' : 'Create File'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
