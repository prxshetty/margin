import { useState, useEffect, useRef, useCallback } from 'react'
import { FolderOpen, FileText, Loader, Check, Plus, Trash2, Pencil } from 'lucide-react'
import { useEditorStore, type FileEntry } from '../stores/editorStore'
import { API_BASE } from '../lib/api'

function FileIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 2.5A1.5 1.5 0 0 1 4.5 1h5.086a1 1 0 0 1 .707.293l2.914 2.914A1 1 0 0 1 13.5 5v8A1.5 1.5 0 0 1 12 14.5H4.5A1.5 1.5 0 0 1 3 13V2.5Z" fill="currentColor" fillOpacity=".15" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      <path d="M9.5 1v3a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  )
}

export function FileSidebar({
  onSaveCurrentFile,
  onOpenFolder,
  filesPanelOpen,
  setFilesPanelOpen,
  aiPanelOpen,
  setAiPanelOpen,
}: {
  onSaveCurrentFile?: () => Promise<void>
  onOpenFolder?: () => void
  filesPanelOpen?: boolean
  setFilesPanelOpen?: (open: boolean) => void
  aiPanelOpen?: boolean
  setAiPanelOpen?: (open: boolean) => void
}) {
  const {
    workspaceDir, setWorkspaceDir,
    openedFiles, addFile,
    setContent,
  } = useEditorStore()

  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const initialLoadDone = useRef(false)

  const [showLayoutDropdown, setShowLayoutDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('simple-dark-mode') === 'true')

  const setCurrentFilePath = useEditorStore((s) => s.setCurrentFilePath)
  const updateFileContent = useEditorStore((s) => s.updateFileContent)
  const removeFile = useEditorStore((s) => s.removeFile)
  const currentFilePath = useEditorStore((s) => s.currentFilePath)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    localStorage.setItem('simple-dark-mode', String(darkMode))
  }, [darkMode])

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowLayoutDropdown(false)
      }
    }
    if (showLayoutDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showLayoutDropdown])

  // Auto-fetch from backend only on first mount if no files are already in store
  useEffect(() => {
    if (initialLoadDone.current) return
    if (openedFiles.length > 0 || workspaceDir) {
      setLoading(false)
      initialLoadDone.current = true
      return
    }
    initialLoadDone.current = true
    setLoading(true)

    const fetchWorkspaceFiles = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/workspace/inputs/files`)
        if (!res.ok) throw new Error()
        const files = await res.json()
        setWorkspaceDir('inputs')
        for (const file of files) {
          try {
            const fileRes = await fetch(`${API_BASE}/api/workspace/inputs/files/${encodeURIComponent(file.path)}`)
            if (!fileRes.ok) continue
            const data = await fileRes.json()
            addFile({ name: file.name, path: file.path, content: data.content, originalContent: data.content })
          } catch {
            // skip
          }
        }
      } catch {
        // skip
      }
    }

    const fetchPrompts = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/assist/prompts`)
        if (!res.ok) throw new Error()
        const prompts = await res.json()
        for (const p of prompts) {
          try {
            const promptRes = await fetch(`${API_BASE}/api/assist/prompts/${encodeURIComponent(p.path)}`)
            if (!promptRes.ok) continue
            const data = await promptRes.json()
            addFile({
              name: p.name,
              path: `prompts/${p.path}`,
              content: data.content,
              originalContent: data.content
            })
          } catch {
            // skip
          }
        }
      } catch {
        // skip
      }
    }

    Promise.all([fetchWorkspaceFiles(), fetchPrompts()])
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileClick = useCallback(async (path: string) => {
    if (onSaveCurrentFile) {
      await onSaveCurrentFile()
    }
    const store = useEditorStore.getState()
    const { currentFilePath, content } = store
    if (currentFilePath) {
      updateFileContent(currentFilePath, content)
    }
    const file = openedFiles.find((f) => f.path === path)
    if (file) {
      setContent(file.content)
      setCurrentFilePath(path)
    }
  }, [openedFiles, setContent, setCurrentFilePath, updateFileContent, onSaveCurrentFile])

  const handleCreateFile = useCallback(async (folder: string) => {
    const defaultName = folder === 'chapters' ? 'new-chapter.md' : folder === 'characters' ? 'new-character.md' : 'new-style.md'
    const raw = window.prompt(`New ${folder.slice(0, -1)} file name (will be saved to ${folder}/):`, defaultName)
    if (!raw) return
    const trimmed = raw.trim()
    if (!trimmed) return

    try {
      const res = await fetch(`${API_BASE}/api/workspace/inputs/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder, name: trimmed, content: '' })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        window.alert(`Failed to create file: ${err.detail || res.statusText}`)
        return
      }
      const data = await res.json()
      addFile({ name: data.name, path: data.path, content: data.content, originalContent: data.content })
      setContent(data.content)
      setCurrentFilePath(data.path)
    } catch (err) {
      window.alert(`Failed to create file: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }, [addFile, setContent, setCurrentFilePath])

  const handleDeleteFile = useCallback(async (path: string) => {
    const isActive = currentFilePath === path
    const confirmed = window.confirm(`Delete "${path}"? This cannot be undone.`)
    if (!confirmed) return

    try {
      const res = await fetch(`${API_BASE}/api/workspace/inputs/files/${encodeURIComponent(path)}`, {
        method: 'DELETE'
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        window.alert(`Failed to delete file: ${err.detail || res.statusText}`)
        return
      }
      removeFile(path)
      if (isActive) {
        setContent('')
        setCurrentFilePath(null)
      }
    } catch (err) {
      window.alert(`Failed to delete file: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }, [currentFilePath, removeFile, setContent, setCurrentFilePath])

  const handleRenameFile = useCallback(async (path: string) => {
    const oldName = path.split('/').pop() ?? path
    const raw = window.prompt(`Rename "${oldName}" to:`, oldName)
    if (!raw) return
    const newName = raw.trim()
    if (!newName || newName === oldName) return

    try {
      const res = await fetch(`${API_BASE}/api/workspace/inputs/files/${encodeURIComponent(path)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        window.alert(`Failed to rename: ${err.detail || res.statusText}`)
        return
      }
      const data = await res.json()
      const store = useEditorStore.getState()
      const existing = store.openedFiles.find((f) => f.path === path)
      if (existing) {
        removeFile(path)
        addFile({ ...existing, name: data.name, path: data.path })
        if (store.currentFilePath === path) {
          setCurrentFilePath(data.path)
        }
      }
    } catch (err) {
      window.alert(`Failed to rename: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }, [removeFile, addFile, setCurrentFilePath])

  const rootFiles = openedFiles.filter((f) => !f.path.includes('/'))
  const charFiles = openedFiles.filter((f) => f.path.startsWith('characters/'))
  const styleFiles = openedFiles.filter((f) => f.path.startsWith('styles/'))
  const chapterFiles = openedFiles.filter((f) => f.path.startsWith('chapters/'))
  const promptFiles = openedFiles.filter((f) => f.path.startsWith('prompts/'))

  return (
    <div ref={containerRef} className="flex flex-col gap-3 w-full h-full overflow-y-auto select-none">
      {/* Low-profile action row inside FileSidebar */}
      <div className="flex items-center gap-1.5 pb-2.5 border-b border-[var(--border-sidebar)] shrink-0 select-none animate-fade-in">
        {onOpenFolder && (
          <button
            onClick={onOpenFolder}
            className="flex items-center justify-center w-7 h-7 text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--border-sidebar)]/60 bg-[var(--bg-icon)]/20 rounded-[6px] transition-all cursor-pointer active:scale-[0.95]"
            title="Open Folder"
          >
            <FolderOpen className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={() => setDarkMode(!darkMode)}
          className="flex items-center justify-center w-7 h-7 text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--border-sidebar)]/60 bg-[var(--bg-icon)]/20 rounded-[6px] transition-all cursor-pointer active:scale-[0.95]"
          title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {darkMode ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="5.64" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
        <div className="relative shrink-0" ref={dropdownRef}>
          <button
            onClick={() => setShowLayoutDropdown(!showLayoutDropdown)}
            className={`flex items-center justify-center w-7 h-7 text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--border-sidebar)]/60 bg-[var(--bg-icon)]/20 rounded-[6px] transition-all cursor-pointer active:scale-[0.95] ${showLayoutDropdown ? 'bg-[var(--border-sidebar)]/60 text-[var(--text-heading)]' : ''
              }`}
            title="Layout Options"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" />
            </svg>
          </button>
          {showLayoutDropdown && (
            <div className="absolute right-0 top-full mt-1.5 z-50 w-36 bg-[var(--bg-elevated)] border border-[var(--border-sidebar)]/70 rounded-[12px] p-1 animate-scale-in flex flex-col gap-0.5">
              <button
                onClick={() => {
                  if (setFilesPanelOpen) setFilesPanelOpen(!filesPanelOpen)
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[8px] text-[11px] text-[var(--text)] hover:bg-[var(--border-sidebar)]/40 transition-colors cursor-pointer"
              >
                <span className="font-sans font-medium">Files Panel</span>
                {filesPanelOpen && <Check className="w-3.5 h-3.5 text-[var(--text-secondary)]" strokeWidth={2.5} />}
              </button>
              <button
                onClick={() => {
                  if (setAiPanelOpen) setAiPanelOpen(!aiPanelOpen)
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[8px] text-[11px] text-[var(--text)] hover:bg-[var(--border-sidebar)]/40 transition-colors cursor-pointer"
              >
                <span className="font-sans font-medium">AI Assist</span>
                {aiPanelOpen && <Check className="w-3.5 h-3.5 text-[var(--text-secondary)]" strokeWidth={2.5} />}
              </button>
            </div>
          )}
        </div>
      </div>


      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-[var(--text-secondary)]">
          <Loader className="w-4 h-4 animate-spin" strokeWidth={2} />
          <span>Loading files...</span>
        </div>
      )}

      {/* Empty state — only when there's truly no workspace at all */}
      {!loading && !workspaceDir && (
        <div className="flex flex-col items-center justify-center py-8 text-center select-none flex-1">
          <FileText className="w-8 h-8 text-[var(--text-muted)] mb-3" strokeWidth={1} />
          <p className="text-[11px] text-[var(--text-secondary)] font-medium">No folder opened</p>
          <p className="text-[10px] text-[var(--text-muted)] mt-1 max-w-[180px]">
            Open a folder to browse and tag reference files
          </p>
        </div>
      )}

      {/* File list — always show section headers once a workspace is linked */}
      {!loading && workspaceDir && (
        <div className="flex flex-col gap-3.5 px-1">
          {rootFiles.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {rootFiles.map((file) => (
                <FileRow key={file.path} file={file} onSelect={handleFileClick} onDelete={handleDeleteFile} onRename={handleRenameFile} />
              ))}
            </div>
          )}

          <div className="flex flex-col gap-0.5 animate-fade-in">
            <SectionHeader label="chapters/" onAdd={() => handleCreateFile('chapters')} />
            {chapterFiles.map((file) => (
              <FileRow key={file.path} file={file} onSelect={handleFileClick} onDelete={handleDeleteFile} onRename={handleRenameFile} />
            ))}
          </div>

          <div className="flex flex-col gap-0.5 animate-fade-in">
            <SectionHeader label="characters/" onAdd={() => handleCreateFile('characters')} />
            {charFiles.map((file) => (
              <FileRow key={file.path} file={file} onSelect={handleFileClick} onDelete={handleDeleteFile} onRename={handleRenameFile} />
            ))}
          </div>

          <div className="flex flex-col gap-0.5 animate-fade-in">
            <SectionHeader label="styles/" onAdd={() => handleCreateFile('styles')} />
            {styleFiles.map((file) => (
              <FileRow key={file.path} file={file} onSelect={handleFileClick} onDelete={handleDeleteFile} onRename={handleRenameFile} />
            ))}
          </div>

          {promptFiles.length > 0 && (
            <div className="flex flex-col gap-0.5 animate-fade-in">
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]/70 mb-1.5 px-2 select-none">prompts/</p>
              {promptFiles.map((file) => (
                <FileRow key={file.path} file={file} onSelect={handleFileClick} onDelete={handleDeleteFile} onRename={handleRenameFile} />
              ))}
            </div>
          )}

          {openedFiles.length === 0 && (
            <p className="text-[10px] text-[var(--text-muted)] px-2 pt-1 select-none">
              Empty workspace — click <span className="font-semibold">+</span> on a section to create your first file.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function SectionHeader({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <div className="group flex items-center justify-between mb-1.5 px-2 select-none">
      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]/70">{label}</p>
      <button
        onClick={onAdd}
        title={`New ${label.replace('/', '')} file`}
        className="flex items-center justify-center w-4 h-4 text-[var(--text-secondary)]/60 hover:text-[var(--text-heading)] hover:bg-[var(--border-sidebar)]/60 rounded-[4px] transition-all cursor-pointer active:scale-[0.9]"
      >
        <Plus className="w-3 h-3" strokeWidth={2.25} />
      </button>
    </div>
  )
}

function FileRow({
  file,
  onSelect,
  onDelete,
  onRename,
}: {
  file: FileEntry
  onSelect: (path: string) => void
  onDelete?: (path: string) => void
  onRename?: (path: string) => void
}) {
  const isActive = useEditorStore((s) => s.currentFilePath === file.path)

  return (
    <div
      className={`group flex items-center gap-1 px-2.5 py-1 rounded-[6px] text-xs transition-colors duration-150 ${isActive
        ? 'bg-[var(--border-sidebar)]/40 text-[var(--text)]'
        : 'text-[var(--text-secondary)] hover:bg-[var(--border-sidebar)]/30 hover:text-[var(--text)]'
        }`}
    >
      <button
        onClick={() => onSelect(file.path)}
        className="flex items-center gap-1.5 flex-1 min-w-0 text-left cursor-pointer"
        title={file.path}
      >
        <FileIcon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[var(--text)]' : 'text-[var(--text-secondary)]/60'}`} />
        <span className="truncate font-sans font-medium">{file.name}</span>
      </button>
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete(file.path)
          }}
          title={`Delete ${file.name}`}
          className="flex items-center justify-center w-5 h-5 text-[var(--text-secondary)]/60 hover:text-red-500 hover:bg-[var(--border-sidebar)]/60 rounded-[4px] transition-all cursor-pointer active:scale-[0.9] opacity-0 group-hover:opacity-100"
        >
          <Trash2 className="w-3 h-3" strokeWidth={2} />
        </button>
      )}
      {onRename && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRename(file.path)
          }}
          title={`Rename ${file.name}`}
          className="flex items-center justify-center w-5 h-5 text-[var(--text-secondary)]/60 hover:text-[var(--text-heading)] hover:bg-[var(--border-sidebar)]/60 rounded-[4px] transition-all cursor-pointer active:scale-[0.9] opacity-0 group-hover:opacity-100"
        >
          <Pencil className="w-3 h-3" strokeWidth={2} />
        </button>
      )}
    </div>
  )
}
