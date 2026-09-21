import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { FolderPlus, FileText, Loader, Check, Plus, Trash2, Pencil, FolderSync } from 'lucide-react'
import { useEditorStore, type FileEntry } from '../stores/editorStore'
import { useSettingsStore } from '../stores/settingsStore'
import { toast } from '../stores/toastStore'
import { API_BASE } from '../lib/api'

interface FolderNode {
  type: 'folder'
  name: string
  path: string
  children: TreeNode[]
}

interface FileNode {
  type: 'file'
  name: string
  path: string
  file: FileEntry
}

type TreeNode = FolderNode | FileNode

function buildTree(files: FileEntry[]): TreeNode[] {
  const rootNodes: TreeNode[] = []

  const getOrCreateFolder = (nodes: TreeNode[], name: string, path: string): FolderNode => {
    let folder = nodes.find((n) => n.type === 'folder' && n.name === name) as FolderNode
    if (!folder) {
      folder = {
        type: 'folder',
        name,
        path,
        children: [],
      }
      nodes.push(folder)
    }
    return folder
  }

  files.forEach((file) => {
    if (file.path.startsWith('prompts/') || file.path.startsWith('.')) {
      return
    }

    const parts = file.path.split('/')
    if (parts.length === 1) {
      return // see rootFiles, we render separately outside the tree.
    }

    let currentLevel = rootNodes
    let currentPath = ''

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      currentPath = currentPath ? `${currentPath}/${part}` : part

      const folder = getOrCreateFolder(currentLevel, part, currentPath)
      currentLevel = folder.children
    }

    const fileName = parts[parts.length - 1]
    currentLevel.push({
      type: 'file',
      name: fileName,
      path: file.path,
      file,
    })
  })

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
    nodes.forEach((node) => {
      if (node.type === 'folder') {
        sortNodes(node.children)
      }
    })
  }

  sortNodes(rootNodes)
  return rootNodes
}

function FileIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 2.5A1.5 1.5 0 0 1 4.5 1h5.086a1 1 0 0 1 .707.293l2.914 2.914A1 1 0 0 1 13.5 5v8A1.5 1.5 0 0 1 12 14.5H4.5A1.5 1.5 0 0 1 3 13V2.5Z" fill="currentColor" fillOpacity=".15" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      <path d="M9.5 1v3a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  )
}

function FolderClosedIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2Z" />
    </svg>
  )
}

function FolderOpenIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="m3.882 18.043l4.041-5.623a4 4 0 0 1 3.249-1.665h8.752M3.882 18.043a3.65 3.65 0 0 0 2.777 1.277h8.343a4 4 0 0 0 3.405-1.9l2.918-4.734a1.287 1.287 0 0 0-1.115-1.931h-.286M3.882 18.043A3.65 3.65 0 0 1 3 15.661V7.424A2.744 2.744 0 0 1 5.744 4.68h2.653c.607 0 1.189.24 1.618.67l.911.91a1.83 1.83 0 0 0 1.294.537l4.044-.001a3.66 3.66 0 0 1 3.66 3.66v.299" />
    </svg>
  )
}

// Tree guides: curved elbow per row (top → mid with a rounded corner,
// then a horizontal stub into the icon). Strict-ancestor verticals run
// full height; the elbow's below-mid segment is omitted for last children
// so the line terminates instead of dangling.
function TreeGuides({ depth, guides, isLast }: { depth: number; guides: boolean[]; isLast: boolean }) {
  if (depth === 0) return null
  const elbowX = (depth - 1) * 12 + 27
  return (
    <>
      {guides.slice(0, depth - 1).map((on, i) =>
        on ? (
          <span key={i} aria-hidden="true" className="absolute top-0 bottom-0 w-px bg-[var(--border-subtle)]/70" style={{ left: `${i * 12 + 27}px` }} />
        ) : null
      )}
      <span aria-hidden="true" className="absolute top-0 h-1/2 w-[5px] border-l border-b border-[var(--border-subtle)]/70 rounded-bl-[5px]" style={{ left: `${elbowX}px` }} />
      {!isLast && (
        <span aria-hidden="true" className="absolute top-1/2 bottom-0 w-px bg-[var(--border-subtle)]/70" style={{ left: `${elbowX}px` }} />
      )}
    </>
  )
}

export function FileSidebar({
  onSaveCurrentFile,
  filesPanelOpen,
  setFilesPanelOpen,
  aiPanelOpen,
  setAiPanelOpen,
}: {
  onSaveCurrentFile?: () => Promise<void>
  filesPanelOpen?: boolean
  setFilesPanelOpen?: (open: boolean) => void
  aiPanelOpen?: boolean
  setAiPanelOpen?: (open: boolean) => void
}) {
  const {
    workspaceDir, setWorkspaceDir,
    openedFiles, addFile,
    setContent, clearFiles,
  } = useEditorStore()

  const { settings, setShowSettings } = useSettingsStore()

  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const initialLoadDone = useRef(false)

  const [showLayoutDropdown, setShowLayoutDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const setCurrentFilePath = useEditorStore((s) => s.setCurrentFilePath)
  const updateFileContent = useEditorStore((s) => s.updateFileContent)
  const removeFile = useEditorStore((s) => s.removeFile)
  const currentFilePath = useEditorStore((s) => s.currentFilePath)

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set()
  )

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const hasAutoExpanded = useRef(false)

  // Auto-expand top-level folders once on initial load
  useEffect(() => {
    if (openedFiles.length === 0 || hasAutoExpanded.current) return
    hasAutoExpanded.current = true
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      openedFiles.forEach((file) => {
        const parts = file.path.split('/')
        if (parts.length > 1) {
          const topLevel = parts[0]
          if (topLevel !== 'prompts' && !topLevel.startsWith('.')) {
            next.add(topLevel)
          }
        }
      })
      return next
    })
  }, [openedFiles])

  const treeNodes = useMemo(() => {
    return buildTree(openedFiles)
  }, [openedFiles])

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

  // Auto-fetch from backend whenever linked workspace directory changes
  useEffect(() => {
    let active = true
    setLoading(true)
    clearFiles()
    initialLoadDone.current = true
    hasAutoExpanded.current = false

    const fetchWorkspaceFiles = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/workspace/files`)
        if (!res.ok) throw new Error()
        const files = await res.json()
        if (!active) return
        setWorkspaceDir(settings?.linked_workspace_dir ? 'custom' : 'sample')
        for (const file of files) {
          addFile({ name: file.name, path: file.path, content: '', originalContent: '' })
        }
      } catch {
        // skip
      }
    }

    fetchWorkspaceFiles()
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [settings?.linked_workspace_dir, clearFiles, addFile, setWorkspaceDir])

  const handleFileClick = useCallback(async (path: string) => {
    const store = useEditorStore.getState()
    if (store.aiPendingEdit && store.currentFilePath) {
      const previous = store.aiPendingEdit.previousContent
      store.editor?.commands.clearAiHighlight()
      store.setContent(previous)
      store.setAiPendingEdit(null)
    }

    if (onSaveCurrentFile) {
      await onSaveCurrentFile()
    }
    const updatedStore = useEditorStore.getState()
    const { currentFilePath, content } = updatedStore
    if (currentFilePath) {
      updateFileContent(currentFilePath, content)
    }
    
    let file = openedFiles.find((f) => f.path === path)
    if (file) {
      // Lazy load content if it hasn't been fetched yet
      if (!file.content && !file.originalContent) {
        try {
          const res = await fetch(`${API_BASE}/api/workspace/files/${encodeURIComponent(path)}`)
          if (res.ok) {
            const data = await res.json()
            useEditorStore.getState().loadFileContent(path, data.content)
            file = { ...file, content: data.content, originalContent: data.content }
          }
        } catch (err) {
          console.error("Failed to fetch file content", err)
          toast.error(`Could not open "${path}" — showing last known content.`)
        }
      }

      setContent(file.content || '')
      setCurrentFilePath(path)
    }
  }, [openedFiles, setContent, setCurrentFilePath, updateFileContent, onSaveCurrentFile])

  const handleCreateFile = useCallback(async (folder: string) => {
    const raw = window.prompt(`New file name (will be saved to ${folder}/):`, 'new-file.md')
    if (!raw) return
    const trimmed = raw.trim()
    if (!trimmed) return

    try {
      const res = await fetch(`${API_BASE}/api/workspace/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder, name: trimmed, content: '' })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(`Failed to create file: ${err.detail || res.statusText}`)
        return
      }
      const data = await res.json()
      addFile({ name: data.name, path: data.path, content: data.content, originalContent: data.content })
      setContent(data.content)
      setCurrentFilePath(data.path)
    } catch (err) {
      toast.error(`Failed to create file: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }, [addFile, setContent, setCurrentFilePath])

  const handleCreateFolder = useCallback(async () => {
    const raw = window.prompt("New folder name (e.g. 'world_building'):")
    if (!raw) return
    const folder = raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
    if (!folder) return

    const defaultManifestName = `${folder.toUpperCase()}.md`
    try {
      const res = await fetch(`${API_BASE}/api/workspace/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder, name: defaultManifestName, content: `# Available ${raw.trim()}\n\n` })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(`Failed to create folder: ${err.detail || res.statusText}`)
        return
      }
      const data = await res.json()
      addFile({ name: data.name, path: data.path, content: data.content, originalContent: data.content })
    } catch (err) {
      toast.error(`Failed to create folder: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }, [addFile])

  const handleDeleteFile = useCallback(async (path: string) => {
    const isActive = currentFilePath === path
    const confirmed = window.confirm(`Delete "${path}"? This cannot be undone.`)
    if (!confirmed) return

    try {
      const res = await fetch(`${API_BASE}/api/workspace/files/${encodeURIComponent(path)}`, {
        method: 'DELETE'
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(`Failed to delete file: ${err.detail || res.statusText}`)
        return
      }
      removeFile(path)
      if (isActive) {
        setContent('')
        setCurrentFilePath(null)
      }
    } catch (err) {
      toast.error(`Failed to delete file: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }, [currentFilePath, removeFile, setContent, setCurrentFilePath])

  const handleRenameFile = useCallback(async (path: string) => {
    const oldName = path.split('/').pop() ?? path
    const raw = window.prompt(`Rename "${oldName}" to:`, oldName)
    if (!raw) return
    const newName = raw.trim()
    if (!newName || newName === oldName) return

    try {
      const res = await fetch(`${API_BASE}/api/workspace/files/${encodeURIComponent(path)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(`Failed to rename: ${err.detail || res.statusText}`)
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
      toast.error(`Failed to rename: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }, [removeFile, addFile, setCurrentFilePath])

  const rootFiles = openedFiles.filter((f) => !f.path.includes('/'))


  return (
    <div ref={containerRef} className="flex flex-col gap-3 w-full h-full overflow-y-auto select-none">
      {/* Low-profile action row inside FileSidebar */}
      <div className="flex items-center gap-1.5 pb-2.5 border-b border-[var(--border-sidebar)] shrink-0 select-none animate-fade-in">
        {workspaceDir && (
          <>
            <button
              onClick={handleCreateFolder}
              className="flex items-center justify-center w-7 h-7 text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--border-sidebar)]/60 bg-[var(--bg-icon)]/20 rounded-[6px] transition-all cursor-pointer active:scale-[0.95]"
              title="New Folder"
            >
              <FolderPlus className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center justify-center w-7 h-7 text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--border-sidebar)]/60 bg-[var(--bg-icon)]/20 rounded-[6px] transition-all cursor-pointer active:scale-[0.95]"
              title="Switch Workspace / Workspace Settings"
            >
              <FolderSync className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
          </>
        )}
        <div className="flex-1" />
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
        <div className="flex flex-col gap-0 px-1">
          {rootFiles.length > 0 && (
            <div className="flex flex-col gap-0">
              {rootFiles.map((file) => (
                <FileRow key={file.path} file={file} depth={0} onSelect={handleFileClick} onDelete={handleDeleteFile} onRename={handleRenameFile} />
              ))}
            </div>
          )}

          {treeNodes.map((node, i) => (
            <TreeNodeComponent
              key={node.path}
              node={node}
              depth={0}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
              handleCreateFile={handleCreateFile}
              handleFileClick={handleFileClick}
              handleDeleteFile={handleDeleteFile}
              handleRenameFile={handleRenameFile}
              guides={[]}
              isLast={i === treeNodes.length - 1}
            />
          ))}



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

function FolderRow({
  name,
  depth,
  isExpanded,
  onToggle,
  onAddFile,
  guides = [],
  isLast = true,
}: {
  name: string
  depth: number
  isExpanded: boolean
  onToggle: () => void
  onAddFile: () => void
  guides?: boolean[]
  isLast?: boolean
}) {
  return (
    <div
      onClick={onToggle}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
      className={`group relative flex items-center gap-1 pr-2.5 py-2 rounded-[6px] text-xs transition-colors duration-150 cursor-pointer select-none ${isExpanded
        ? 'text-[var(--text)] hover:bg-[var(--border-sidebar)]/30'
        : 'text-[var(--text-secondary)] hover:bg-[var(--border-sidebar)]/30 hover:text-[var(--text)]'
        }`}
      title={isExpanded ? 'Collapse folder' : 'Expand folder'}
    >
      <TreeGuides depth={depth} guides={guides} isLast={isLast} />
      <div className="flex items-center gap-1.5 flex-1 min-w-0 text-left">
        {isExpanded
          ? <FolderOpenIcon className="w-4 h-4 shrink-0 text-[var(--text-secondary)]" />
          : <FolderClosedIcon className="w-4 h-4 shrink-0 text-[var(--text-secondary)]/60" />}
        <span className="truncate font-sans font-medium">{name}</span>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onAddFile()
        }}
        title={`New file in ${name}`}
        className="flex items-center justify-center w-4 h-4 text-[var(--text-secondary)]/60 hover:text-[var(--text-heading)] hover:bg-[var(--border-sidebar)]/60 rounded-[4px] transition-all cursor-pointer active:scale-[0.9] opacity-0 group-hover:opacity-100"
      >
        <Plus className="w-3 h-3" strokeWidth={2.25} />
      </button>
    </div>
  )
}

function TreeNodeComponent({
  node,
  depth,
  expandedFolders,
  toggleFolder,
  handleCreateFile,
  handleFileClick,
  handleDeleteFile,
  handleRenameFile,
  guides = [],
  isLast = true,
}: {
  node: TreeNode
  depth: number
  expandedFolders: Set<string>
  toggleFolder: (path: string) => void
  handleCreateFile: (folder: string) => void
  handleFileClick: (path: string) => void
  handleDeleteFile: (path: string) => void
  handleRenameFile: (path: string) => void
  guides?: boolean[]
  isLast?: boolean
}) {
  if (node.type === 'file') {
    return (
      <FileRow
        file={node.file}
        depth={depth}
        onSelect={handleFileClick}
        onDelete={handleDeleteFile}
        onRename={handleRenameFile}
        guides={guides}
        isLast={isLast}
      />
    )
  }

  const isExpanded = expandedFolders.has(node.path)

  return (
    <div>
      <FolderRow
        name={node.name}
        depth={depth}
        isExpanded={isExpanded}
        onToggle={() => toggleFolder(node.path)}
        onAddFile={() => handleCreateFile(node.path)}
        guides={guides}
        isLast={isLast}
      />
      {isExpanded && (
        <div className="flex flex-col gap-0">
          {node.children.map((child, i) => (
            <TreeNodeComponent
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
              handleCreateFile={handleCreateFile}
              handleFileClick={handleFileClick}
              handleDeleteFile={handleDeleteFile}
              handleRenameFile={handleRenameFile}
              guides={[...guides, i < node.children.length - 1]}
              isLast={i === node.children.length - 1}
            />
          ))}
        </div>
      )}
      {isExpanded && node.children.length === 0 && (
        <div
          style={{ paddingLeft: `${(depth + 1) * 12 + 20}px` }}
          className="text-[10px] text-[var(--text-muted)] py-1 select-none italic"
        >
          Empty folder
        </div>
      )}
    </div>
  )
}

function FileRow({
  file,
  depth = 0,
  onSelect,
  onDelete,
  onRename,
  guides = [],
  isLast = true,
}: {
  file: FileEntry
  depth?: number
  onSelect: (path: string) => void
  onDelete?: (path: string) => void
  onRename?: (path: string) => void
  guides?: boolean[]
  isLast?: boolean
}) {
  const isActive = useEditorStore((s) => s.currentFilePath === file.path)

  return (
    <div
      onClick={() => onSelect(file.path)}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
      className={`group relative flex items-center gap-1 pr-2.5 py-2 rounded-[6px] text-xs transition-colors duration-150 cursor-pointer ${isActive
        ? 'text-[var(--text)]'
        : 'text-[var(--text-secondary)] hover:bg-[var(--border-sidebar)]/30 hover:text-[var(--text)]'
        }`}
    >
      <TreeGuides depth={depth} guides={guides} isLast={isLast} />
      <div
        className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
        title={file.path}
      >
        <FileIcon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[var(--text)]' : 'text-[var(--text-secondary)]/60'}`} />
        <span className="truncate font-sans font-medium">{file.name}</span>
      </div>
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
    </div>
  )
}
