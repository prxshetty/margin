import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Loader, Check, ChevronDown, FilePlus, FolderPlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
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

// Uniform context-menu item: icon + label, optional danger + tooltip.
function CtxItem({ icon, label, title, danger, onClick }: {
  icon: React.ReactNode
  label: string
  title?: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] text-[11px] transition-colors cursor-pointer ${danger ? 'text-red-500 hover:bg-red-500/10' : 'text-[var(--text)] hover:bg-[var(--border-sidebar)]/40'}`}
    >
      <span className={`shrink-0 flex items-center ${danger ? '' : 'text-[var(--text-secondary)]'}`}>{icon}</span>
      <span className="font-sans font-medium truncate flex-1 text-left">{label}</span>
    </button>
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

  const { settings, setShowSettings, setSettingsTab, updateSettings } = useSettingsStore()

  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const initialLoadDone = useRef(false)

  const [showLayoutDropdown, setShowLayoutDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const [showSwitcher, setShowSwitcher] = useState(false)
  const [switcherPos, setSwitcherPos] = useState<{ left: number; top: number; minWidth: number } | null>(null)
  const switcherRef = useRef<HTMLDivElement>(null)
  const switcherMenuRef = useRef<HTMLDivElement>(null)

  const toggleSwitcher = useCallback(() => {
    setShowSwitcher((open) => {
      if (!open && switcherRef.current) {
        const rect = switcherRef.current.getBoundingClientRect()
        setSwitcherPos({
          left: Math.min(rect.left, window.innerWidth - 230),
          top: rect.bottom + 6,
          minWidth: Math.max(rect.width, 160),
        })
      }
      return !open
    })
  }, [])

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; folder: string | null; file: string | null } | null>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)

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

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowLayoutDropdown(false)
      }
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        if (!switcherMenuRef.current || !switcherMenuRef.current.contains(e.target as Node)) {
          setShowSwitcher(false)
        }
      }
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowLayoutDropdown(false)
        setShowSwitcher(false)
        setCtxMenu(null)
      }
    }
    // Portaled menus are position snapshots — dismiss on scroll/resize.
    const handleViewportChange = () => {
      setShowSwitcher(false)
      setCtxMenu(null)
    }
    if (showLayoutDropdown || showSwitcher || ctxMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
      document.addEventListener('scroll', handleViewportChange, true)
      window.addEventListener('resize', handleViewportChange)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('scroll', handleViewportChange, true)
      window.removeEventListener('resize', handleViewportChange)
    }
  }, [showLayoutDropdown, showSwitcher, ctxMenu])

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
    const raw = window.prompt(
      folder ? `New file name (will be saved to ${folder}/):` : 'New file name (will be saved to workspace root):',
      'new-file.md'
    )
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

  const handleCreateFolder = useCallback(async (parent?: string | null) => {
    const raw = window.prompt(parent ? `New folder inside '${parent}':` : "New folder name (e.g. 'world_building'):")
    if (!raw) return
    const slug = raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
    if (!slug) return
    const folder = parent ? `${parent}/${slug}` : slug

    const defaultManifestName = `${slug.toUpperCase()}.md`
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

  const handleRenameFolder = useCallback(async (folder: string) => {
    const oldName = folder.split('/').pop() ?? folder
    const raw = window.prompt(`Rename "${oldName}" to:`, oldName)
    if (!raw) return
    const trimmed = raw.trim()
    if (!trimmed) return

    try {
      const res = await fetch(`${API_BASE}/api/workspace/folders/${encodeURIComponent(folder)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(`Failed to rename: ${err.detail || res.statusText}`)
        return
      }
      const data = await res.json()
      const newPrefix: string = data.path
      const store = useEditorStore.getState()
      const affected = store.openedFiles.filter(
        (f) => f.path === folder || f.path.startsWith(`${folder}/`)
      )
      for (const f of affected) {
        removeFile(f.path)
        addFile({ ...f, path: `${newPrefix}${f.path.slice(folder.length)}` })
      }
      if (store.currentFilePath && (
        store.currentFilePath === folder ||
        store.currentFilePath.startsWith(`${folder}/`)
      )) {
        setCurrentFilePath(`${newPrefix}${store.currentFilePath.slice(folder.length)}`)
      }
      setExpandedFolders((prev) => {
        const next = new Set(prev)
        if (next.has(folder)) {
          next.delete(folder)
          next.add(newPrefix)
        }
        return next
      })
    } catch (err) {
      toast.error(`Failed to rename: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }, [removeFile, addFile, setCurrentFilePath])

  const handleDeleteFolder = useCallback(async (folder: string) => {
    const store = useEditorStore.getState()
    const inside = store.openedFiles.filter(
      (f) => f.path === folder || f.path.startsWith(`${folder}/`)
    )
    const confirmed = window.confirm(
      `Delete "${folder}"${inside.length > 0 ? ` and ${inside.length} file${inside.length > 1 ? 's' : ''} inside it` : ''}? This cannot be undone.`
    )
    if (!confirmed) return

    try {
      const res = await fetch(`${API_BASE}/api/workspace/folders/${encodeURIComponent(folder)}`, {
        method: 'DELETE'
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(`Failed to delete folder: ${err.detail || res.statusText}`)
        return
      }
      for (const f of inside) {
        removeFile(f.path)
      }
      const current = useEditorStore.getState().currentFilePath
      if (current && (current === folder || current.startsWith(`${folder}/`))) {
        setContent('')
        setCurrentFilePath(null)
      }
    } catch (err) {
      toast.error(`Failed to delete folder: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }, [removeFile, setContent, setCurrentFilePath])

  const rootFiles = openedFiles.filter((f) => !f.path.includes('/'))

  const profiles = settings?.workspace_profiles || []
  const activeName = (() => {
    const linked = settings?.linked_workspace_dir
    if (!linked) return 'sample-workspace'
    const match = profiles.find((p) => p.path === linked)
    if (match) return match.name
    const base = linked.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
    return base || linked
  })()

  const handleSwitchWorkspace = useCallback(async (path: string | null) => {
    setShowSwitcher(false)
    try {
      await updateSettings({ linked_workspace_dir: path })
      toast.success(path ? 'Workspace switched.' : 'Reset to default fallback workspace.')
    } catch (err) {
      toast.error('Could not switch workspace.')
    }
  }, [updateSettings])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const folderEl = target.closest?.('[data-folderpath]')
    const fileEl = target.closest?.('[data-filepath]')
    const file = fileEl ? (fileEl as HTMLElement).dataset.filepath || null : null
    const folder = folderEl ? (folderEl as HTMLElement).dataset.folderpath || null : null
    // Blank space has no contextual actions — root creation lives in the
    // header. Let the native menu show rather than a redundant popup.
    if (!file && !folder) return
    e.preventDefault()
    // Select first so the active highlight marks the menu's target —
    // same save-then-load path as left-click, no divergent behavior.
    if (file) void handleFileClick(file)
    setCtxMenu({
      x: Math.min(e.clientX, window.innerWidth - 180),
      y: Math.min(e.clientY, window.innerHeight - 140),
      folder,
      file,
    })
  }, [handleFileClick])

  // Open the same context menu from a row's hover "…" button,
  // anchored to the button instead of the cursor.
  const openRowMenu = useCallback((e: React.MouseEvent, target: { folder: string } | { file: string }) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const file = 'file' in target ? target.file : null
    if (file) void handleFileClick(file)
    setCtxMenu({
      x: Math.min(rect.left, window.innerWidth - 180),
      y: Math.min(rect.bottom + 4, window.innerHeight - 160),
      folder: 'folder' in target ? target.folder : null,
      file,
    })
  }, [handleFileClick])

  return (
    <div
      ref={containerRef}
      onContextMenu={handleContextMenu}
      className="flex flex-col gap-3 w-full h-full overflow-y-auto select-none"
    >
      {/* Workspace switcher + layout row */}
      <div className="flex items-center gap-1.5 pb-2.5 border-b border-[var(--border-sidebar)] shrink-0 select-none animate-fade-in">
        <div className="relative flex-1 min-w-0" ref={switcherRef}>
          <button
            onClick={toggleSwitcher}
            className={`flex items-center gap-1.5 min-w-0 max-w-full px-1.5 py-1 rounded-[6px] text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--border-sidebar)]/60 transition-all cursor-pointer active:scale-[0.98] ${showSwitcher ? 'bg-[var(--border-sidebar)]/60 text-[var(--text-heading)]' : ''}`}
            title="Switch workspace"
          >
            <span className="truncate font-sans font-medium text-[12px]">{activeName}</span>
            <ChevronDown className="w-3 h-3 shrink-0" strokeWidth={2} />
          </button>
          {showSwitcher && switcherPos && createPortal(
            <div
              ref={switcherMenuRef}
              style={{ left: `${switcherPos.left}px`, top: `${switcherPos.top}px`, minWidth: `${switcherPos.minWidth}px` }}
              className="fixed z-50 w-52 bg-[var(--bg-elevated)] border border-[var(--border-sidebar)]/70 rounded-[12px] p-1 animate-scale-in flex flex-col gap-0.5 max-h-64 overflow-y-auto">
              <button
                onClick={() => handleSwitchWorkspace(null)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] hover:bg-[var(--border-sidebar)]/40 transition-colors cursor-pointer"
              >
                <span className="flex-1 min-w-0 text-left font-sans font-medium text-[11px] text-[var(--text)] truncate">sample-workspace</span>
                {!settings?.linked_workspace_dir && <Check size={13} className="shrink-0 text-[var(--accent-brown)]" />}
              </button>
              {profiles.map((p) => {
                const isActive = settings?.linked_workspace_dir === p.path
                return (
                  <button
                    key={p.id}
                    onClick={() => isActive || handleSwitchWorkspace(p.path)}
                    title={p.path}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] hover:bg-[var(--border-sidebar)]/40 transition-colors cursor-pointer"
                  >
                    <span className="flex-1 min-w-0 text-left font-sans font-medium text-[11px] text-[var(--text)] truncate">{p.name}</span>
                    {isActive && <Check size={13} className="shrink-0 text-[var(--accent-brown)]" />}
                  </button>
                )
              })}
              <div className="h-px bg-[var(--border-sidebar)]/60 my-0.5" />
              <button
                onClick={() => {
                  setShowSwitcher(false)
                  setSettingsTab('workspaces')
                  setShowSettings(true)
                }}
                className="w-full flex items-center px-2.5 py-1.5 rounded-[8px] text-[11px] text-[var(--text-secondary)] hover:bg-[var(--border-sidebar)]/40 transition-colors cursor-pointer"
              >
                <span className="font-sans font-medium">Manage workspaces</span>
              </button>
            </div>,
            document.body
          )}
        </div>
        {workspaceDir && (
          <>
            <button
              onClick={() => handleCreateFile('')}
              className="flex items-center justify-center w-7 h-7 shrink-0 text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--border-sidebar)]/60 rounded-[6px] transition-all cursor-pointer active:scale-[0.95]"
              title="New file in workspace root"
            >
              <FilePlus className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
            <button
              onClick={() => handleCreateFolder(null)}
              className="flex items-center justify-center w-7 h-7 shrink-0 text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--border-sidebar)]/60 rounded-[6px] transition-all cursor-pointer active:scale-[0.95]"
              title="New folder"
            >
              <FolderPlus className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
          </>
        )}
        <div className="relative shrink-0" ref={dropdownRef}>
          <button
            onClick={() => setShowLayoutDropdown(!showLayoutDropdown)}
            className={`flex items-center justify-center w-7 h-7 text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--border-sidebar)]/60 rounded-[6px] transition-all cursor-pointer active:scale-[0.95] ${showLayoutDropdown ? 'bg-[var(--border-sidebar)]/60 text-[var(--text-heading)]' : ''
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
                {filesPanelOpen && <Check size={14} className="shrink-0 text-[var(--accent-brown)]" />}
              </button>
              <button
                onClick={() => {
                  if (setAiPanelOpen) setAiPanelOpen(!aiPanelOpen)
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[8px] text-[11px] text-[var(--text)] hover:bg-[var(--border-sidebar)]/40 transition-colors cursor-pointer"
              >
                <span className="font-sans font-medium">AI Assist</span>
                {aiPanelOpen && <Check size={14} className="shrink-0 text-[var(--accent-brown)]" />}
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
                <FileRow key={file.path} file={file} depth={0} onSelect={handleFileClick} onRowMenu={(e) => openRowMenu(e, { file: file.path })} />
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
              handleFileClick={handleFileClick}
              onRowMenu={openRowMenu}
              guides={[]}
              isLast={i === treeNodes.length - 1}
            />
          ))}



          {openedFiles.length === 0 && (
            <p className="text-[10px] text-[var(--text-muted)] px-2 pt-1 select-none">
              Empty workspace — use the buttons above to create your first file or folder.
            </p>
          )}
        </div>
      )}

      {/* Right-click menu: creation and file actions live here now */}
      {ctxMenu && createPortal(
        <div
          ref={ctxMenuRef}
          style={{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }}
          className="fixed z-50 w-40 bg-[var(--bg-elevated)] border border-[var(--border-sidebar)]/70 rounded-[12px] p-1 animate-scale-in flex flex-col gap-0.5"
        >
          {ctxMenu.file ? (
            <>
              <CtxItem
                icon={<Pencil className="w-3.5 h-3.5" strokeWidth={2} />}
                label="Rename"
                onClick={() => {
                  setCtxMenu(null)
                  handleRenameFile(ctxMenu.file as string)
                }}
              />
              <CtxItem
                icon={<Trash2 className="w-3.5 h-3.5" strokeWidth={2} />}
                label="Delete"
                danger
                onClick={() => {
                  setCtxMenu(null)
                  handleDeleteFile(ctxMenu.file as string)
                }}
              />
            </>
          ) : (
            <>
              <CtxItem
                icon={<FilePlus className="w-3.5 h-3.5" strokeWidth={2} />}
                label="New file"
                title={ctxMenu.folder ? `New file in ${ctxMenu.folder}` : undefined}
                onClick={() => {
                  setCtxMenu(null)
                  handleCreateFile(ctxMenu.folder as string)
                }}
              />
              <CtxItem
                icon={<FolderPlus className="w-3.5 h-3.5" strokeWidth={2} />}
                label="New folder"
                title={ctxMenu.folder ? `New folder inside ${ctxMenu.folder}` : undefined}
                onClick={() => {
                  setCtxMenu(null)
                  handleCreateFolder(ctxMenu.folder)
                }}
              />
              <CtxItem
                icon={<Pencil className="w-3.5 h-3.5" strokeWidth={2} />}
                label="Rename"
                title={ctxMenu.folder ? `Rename ${ctxMenu.folder}` : undefined}
                onClick={() => {
                  setCtxMenu(null)
                  handleRenameFolder(ctxMenu.folder as string)
                }}
              />
              <CtxItem
                icon={<Trash2 className="w-3.5 h-3.5" strokeWidth={2} />}
                label="Delete"
                title={ctxMenu.folder ? `Delete ${ctxMenu.folder} and everything inside it` : undefined}
                danger
                onClick={() => {
                  setCtxMenu(null)
                  handleDeleteFolder(ctxMenu.folder as string)
                }}
              />
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}

function FolderRow({
  name,
  path,
  depth,
  isExpanded,
  onToggle,
  onRowMenu,
  guides = [],
  isLast = true,
}: {
  name: string
  path: string
  depth: number
  isExpanded: boolean
  onToggle: () => void
  onRowMenu: (e: React.MouseEvent) => void
  guides?: boolean[]
  isLast?: boolean
}) {
  return (
    <div
      onClick={onToggle}
      data-folderpath={path}
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
        onClick={onRowMenu}
        title="Folder actions"
        className="flex items-center justify-center w-4 h-4 text-[var(--text-secondary)]/60 hover:text-[var(--text-heading)] hover:bg-[var(--border-sidebar)]/60 rounded-[4px] transition-all cursor-pointer active:scale-[0.9] opacity-0 group-hover:opacity-100"
      >
        <MoreHorizontal className="w-3 h-3" strokeWidth={2.25} />
      </button>
    </div>
  )
}

function TreeNodeComponent({
  node,
  depth,
  expandedFolders,
  toggleFolder,
  handleFileClick,
  onRowMenu,
  guides = [],
  isLast = true,
}: {
  node: TreeNode
  depth: number
  expandedFolders: Set<string>
  toggleFolder: (path: string) => void
  handleFileClick: (path: string) => void
  onRowMenu: (e: React.MouseEvent, target: { folder: string } | { file: string }) => void
  guides?: boolean[]
  isLast?: boolean
}) {
  if (node.type === 'file') {
    return (
      <FileRow
        file={node.file}
        depth={depth}
        onSelect={handleFileClick}
        onRowMenu={(e) => onRowMenu(e, { file: node.file.path })}
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
        path={node.path}
        depth={depth}
        isExpanded={isExpanded}
        onToggle={() => toggleFolder(node.path)}
        onRowMenu={(e) => onRowMenu(e, { folder: node.path })}
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
              handleFileClick={handleFileClick}
              onRowMenu={onRowMenu}
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
  onRowMenu,
  guides = [],
  isLast = true,
}: {
  file: FileEntry
  depth?: number
  onSelect: (path: string) => void
  onRowMenu: (e: React.MouseEvent) => void
  guides?: boolean[]
  isLast?: boolean
}) {
  const isActive = useEditorStore((s) => s.currentFilePath === file.path)

  return (
    <div
      onClick={() => onSelect(file.path)}
      data-filepath={file.path}
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
      <button
        onClick={onRowMenu}
        title="File actions"
        className="flex items-center justify-center w-4 h-4 text-[var(--text-secondary)]/60 hover:text-[var(--text-heading)] hover:bg-[var(--border-sidebar)]/60 rounded-[4px] transition-all cursor-pointer active:scale-[0.9] opacity-0 group-hover:opacity-100"
      >
        <MoreHorizontal className="w-3 h-3" strokeWidth={2.25} />
      </button>
    </div>
  )
}
