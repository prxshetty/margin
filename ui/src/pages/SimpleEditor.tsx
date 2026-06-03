import { useState, useCallback, useEffect, useRef } from 'react'
import { NovelEditor } from '../components/Editor/NovelEditor'
import { SimpleAssist } from '../components/SimpleAssist'
import { FileSidebar } from '../components/FileSidebar'
import { useEditorStore } from '../stores/editorStore'
import { API_BASE } from '../lib/api'

interface FileSystemFileHandle {
  createWritable: () => Promise<FileSystemWritableFileStream>
}

interface FileSystemWritableFileStream extends WritableStream {
  write: (data: Blob) => Promise<void>
  close: () => Promise<void>
}

const PANEL_MIN_WIDTH = 260
const PANEL_MAX_WIDTH = 600
const PANEL_DEFAULT_WIDTH = 320

function getStoredWidth(key: string, fallback: number): number {
  try {
    const stored = localStorage.getItem(key)
    if (stored) {
      const w = parseInt(stored, 10)
      if (w >= PANEL_MIN_WIDTH && w <= PANEL_MAX_WIDTH) return w
    }
  } catch { /* ignore */ }
  return fallback
}
export default function SimpleEditor() {
  const setContent = useEditorStore(state => state.setContent)
  const { addFile, clearFiles, setWorkspaceDir, setCurrentFilePath, markFileClean, currentFilePath } = useEditorStore()
  const [panelOpen, setPanelOpen] = useState(true)
  const [panelWidth, setPanelWidth] = useState(() => getStoredWidth('simple-ai-panel-width', PANEL_DEFAULT_WIDTH))
  const aiDraggingRef = useRef(false)

  const [filesPanelOpen, setFilesPanelOpen] = useState(true)
  const [filesPanelWidth, setFilesPanelWidth] = useState(() => getStoredWidth('simple-files-panel-width', PANEL_DEFAULT_WIDTH))
  const filesDraggingRef = useRef(false)
  const [isResizing, setIsResizing] = useState(false)

  const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null)

  const handleOpenFolder = async () => {
    if (!('showDirectoryPicker' in window)) return
    try {
      const dirHandle = await (window as Window & typeof globalThis & { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker()
      dirHandleRef.current = dirHandle
      setWorkspaceDir(dirHandle.name)
      clearFiles()
      const entries: { name: string; path: string }[] = []
      await scanDir(dirHandle, '', entries)
      entries.sort((a, b) => a.path.localeCompare(b.path))
      for (const entry of entries) {
        const content = await readFile(dirHandle, entry.path)
        addFile({ name: entry.name, path: entry.path, content, originalContent: content })
      }
      if (entries.length > 0) {
        const first = await readFile(dirHandle, entries[0].path)
        setContent(first)
        setCurrentFilePath(entries[0].path)
      }
    } catch {
      // user cancelled or error
    }
  }

  async function scanDir(
    handle: FileSystemDirectoryHandle,
    basePath: string,
    results: { name: string; path: string }[]
  ) {
    for await (const entry of handle.values()) {
      const path = basePath ? `${basePath}/${entry.name}` : entry.name
      if (entry.kind === 'directory') {
        await scanDir(await handle.getDirectoryHandle(entry.name), path, results)
      } else if (
        entry.name.endsWith('.md') ||
        entry.name.endsWith('.markdown') ||
        entry.name.endsWith('.txt')
      ) {
        results.push({ name: entry.name, path })
      }
    }
  }

  async function readFile(handle: FileSystemDirectoryHandle, filePath: string): Promise<string> {
    const parts = filePath.split('/')
    let h: FileSystemDirectoryHandle | FileSystemFileHandle = handle
    for (let i = 0; i < parts.length - 1; i++) {
      h = await (h as FileSystemDirectoryHandle).getDirectoryHandle(parts[i])
    }
    const f = await (h as FileSystemDirectoryHandle).getFileHandle(parts[parts.length - 1])
    return await (await f.getFile()).text()
  }

  const handleSave = useCallback(async () => {
    if (!currentFilePath) return

    if (currentFilePath.startsWith('prompts/')) {
      try {
        const fileContent = useEditorStore.getState().content
        const filename = currentFilePath.replace('prompts/', '')
        const res = await fetch(`${API_BASE}/api/assist/prompts/${encodeURIComponent(filename)}`, {
          method: `POST`,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: fileContent })
        })
        if (res.ok) {
          markFileClean(currentFilePath)
        }
      } catch (err) {
        console.error("Failed to save prompt file:", err)
      }
      return
    }

    if (!dirHandleRef.current || !currentFilePath) return
    try {
      const fileContent = useEditorStore.getState().content
      const parts = currentFilePath.split('/')
      let h = dirHandleRef.current!
      for (let i = 0; i < parts.length - 1; i++) {
        h = await h.getDirectoryHandle(parts[i])
      }
      const fileHandle = await h.getFileHandle(parts[parts.length - 1])
      const writable = await fileHandle.createWritable()
      await writable.write(new Blob([fileContent], { type: 'text/markdown' }))
      await writable.close()
      markFileClean(currentFilePath)
    } catch {
      // save failed
    }
  }, [currentFilePath, markFileClean])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handleSave()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [handleSave])

  // Drag-to-resize handler for sidebar panels
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (filesDraggingRef.current) {
        const newWidth = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, e.clientX))
        setFilesPanelWidth(newWidth)
      } else if (aiDraggingRef.current) {
        const newWidth = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, window.innerWidth - e.clientX))
        setPanelWidth(newWidth)
      }
    }
    const handleMouseUp = () => {
      if (filesDraggingRef.current) {
        filesDraggingRef.current = false
        localStorage.setItem('simple-files-panel-width', String(filesPanelWidth))
      }
      if (aiDraggingRef.current) {
        aiDraggingRef.current = false
        localStorage.setItem('simple-ai-panel-width', String(panelWidth))
      }
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [filesPanelWidth, panelWidth])

  return (
    <div className="h-screen flex bg-[var(--bg-editor)] p-2 overflow-hidden select-none">
      {/* Left Sidebar (FileSidebar) with Slide/Fade Transition */}
      <div
        className="shrink-0 overflow-hidden flex"
        style={{
          width: filesPanelOpen ? filesPanelWidth + 8 : 0,
          opacity: filesPanelOpen ? 1 : 0,
          transform: filesPanelOpen ? 'translateX(0)' : 'translateX(-16px)',
          marginRight: filesPanelOpen ? '8px' : '0px',
          transition: isResizing ? 'none' : 'width 350ms cubic-bezier(0.16, 1, 0.3, 1), transform 350ms cubic-bezier(0.16, 1, 0.3, 1), opacity 350ms cubic-bezier(0.16, 1, 0.3, 1), margin-right 350ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div style={{ width: filesPanelWidth }} className="h-full bg-transparent py-0 overflow-y-auto min-w-0">
          <FileSidebar
            onSaveCurrentFile={handleSave}
            onOpenFolder={handleOpenFolder}
            filesPanelOpen={filesPanelOpen}
            setFilesPanelOpen={setFilesPanelOpen}
            aiPanelOpen={panelOpen}
            setAiPanelOpen={setPanelOpen}
          />
        </div>
        <div
          onMouseDown={(e) => {
            e.preventDefault()
            filesDraggingRef.current = true
            setIsResizing(true)
            document.body.style.cursor = 'col-resize'
            document.body.style.userSelect = 'none'
          }}
          className="w-2 cursor-col-resize flex-shrink-0 relative group transition-all"
        >
          <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-[4px] h-8 rounded-full bg-[var(--border)] group-hover:bg-[var(--text-muted)] transition-all duration-200" />
        </div>
      </div>

      {/* Floating Manuscript Editor Card */}
      <div className="flex-1 bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.03),0_16px_48px_rgba(0,0,0,0.06)] p-8 overflow-y-auto min-w-0 select-text animate-scale-in relative">
        {/* Floating Sidebar Restore Controls inside the Editor Card */}
        {!filesPanelOpen && (
          <button
            onClick={() => setFilesPanelOpen(true)}
            className="absolute top-4 left-4 z-10 flex items-center justify-center w-7 h-7 text-[var(--text-muted)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-icon)]/40 bg-transparent rounded-[6px] transition-all cursor-pointer active:scale-[0.9]"
            title="Show files panel"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" />
            </svg>
          </button>
        )}


        <NovelEditor showInlinePopup={false} />
      </div>

      {/* Right Sidebar (SimpleAssist) with Slide/Fade Transition */}
      <div
        className="shrink-0 overflow-hidden flex"
        style={{
          width: panelOpen ? panelWidth + 8 : 0,
          opacity: panelOpen ? 1 : 0,
          transform: panelOpen ? 'translateX(0)' : 'translateX(16px)',
          marginLeft: panelOpen ? '8px' : '0px',
          transition: isResizing ? 'none' : 'width 350ms cubic-bezier(0.16, 1, 0.3, 1), transform 350ms cubic-bezier(0.16, 1, 0.3, 1), opacity 350ms cubic-bezier(0.16, 1, 0.3, 1), marginLeft 350ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div
          onMouseDown={(e) => {
            e.preventDefault()
            aiDraggingRef.current = true
            setIsResizing(true)
            document.body.style.cursor = 'col-resize'
            document.body.style.userSelect = 'none'
          }}
          className="w-2 cursor-col-resize flex-shrink-0 relative group transition-all"
        >
          <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-[4px] h-8 rounded-full bg-[var(--border)] group-hover:bg-[var(--text-muted)] transition-all duration-200" />
        </div>
        <div style={{ width: panelWidth }} className="h-full bg-transparent py-0 overflow-y-auto min-w-0">
          <SimpleAssist />
        </div>
      </div>
    </div>
  )
}

