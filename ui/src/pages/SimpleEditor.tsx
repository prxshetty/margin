import { useState, useCallback, useEffect, useRef } from 'react'
import { NovelEditor } from '../components/Editor/NovelEditor'
import { SimpleAssist } from '../components/SimpleAssist'
import { FileSidebar } from '../components/FileSidebar'
import { useEditorStore } from '../stores/editorStore'
import { useSettingsStore } from '../stores/settingsStore'
import { SettingsModal } from '../components/SettingsModal'
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
  const { addFile, clearFiles, setWorkspaceDir, setCurrentFilePath, markFileClean, currentFilePath, content, editor } = useEditorStore()
  const { showSettings, setShowSettings, settings } = useSettingsStore()
  const showOutline = settings?.show_outline !== false

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0
  const charCount = content.length

  const headings = (() => {
    if (!content) return []
    const lines = content.split('\n')
    const list: { level: number; text: string; index: number }[] = []
    let headingIndex = 0
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const match = line.match(/^(#{1,6})\s+(.+)$/)
      if (match) {
        const text = match[2].replace(/\s+#+$/, '').trim()
        list.push({
          level: match[1].length,
          text,
          index: headingIndex++
        })
      }
    }
    return list
  })()

  const scrollToHeading = (index: number) => {
    if (!editor) return
    const headingElements = editor.view.dom.querySelectorAll('h1, h2, h3, h4, h5, h6')
    if (headingElements[index]) {
      headingElements[index].scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  useEffect(() => {
    if (!settings?.theme) return

    const root = document.documentElement
    const themeMode = settings.theme
    const themeFamily = settings.theme_family || 'sand'
    const textStyle = settings.text_style || 'system'
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      const isDark = themeMode === 'dark' || (themeMode === 'system' && media.matches)
      root.classList.toggle('dark', isDark)
      root.dataset.themeFamily = themeFamily
      root.dataset.textStyle = textStyle
      localStorage.setItem('simple-dark-mode', String(isDark))
      localStorage.setItem('simple-theme-mode', themeMode)
      localStorage.setItem('simple-theme-family', themeFamily)
      localStorage.setItem('simple-text-style', textStyle)
    }

    applyTheme()
    if (themeMode !== 'system') return

    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [settings?.theme, settings?.theme_family, settings?.text_style])
  const [panelOpen, setPanelOpen] = useState(true)
  const [panelWidth, setPanelWidth] = useState(() => getStoredWidth('simple-ai-panel-width', PANEL_DEFAULT_WIDTH))
  const aiDraggingRef = useRef(false)

  const [filesPanelOpen, setFilesPanelOpen] = useState(true)
  const [filesPanelWidth, setFilesPanelWidth] = useState(() => getStoredWidth('simple-files-panel-width', PANEL_DEFAULT_WIDTH))
  const filesDraggingRef = useRef(false)
  const [isResizing, setIsResizing] = useState(false)

  const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null)
  const editorContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = editorContainerRef.current
    if (!el) return

    let timeoutId: number
    const handleScroll = () => {
      el.classList.add('is-scrolling')
      clearTimeout(timeoutId)
      timeoutId = window.setTimeout(() => {
        el.classList.remove('is-scrolling')
      }, 1000)
    }

    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', handleScroll)
      clearTimeout(timeoutId)
    }
  }, [])

  const handleOpenFolder = async () => {
    if (!('showDirectoryPicker' in window)) return
    try {
      const dirHandle = await (window as Window & typeof globalThis & { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker()
      dirHandleRef.current = dirHandle
      clearFiles()
      setWorkspaceDir(dirHandle.name)
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
      const fullPath = basePath ? `${basePath}/${entry.name}` : entry.name
      if (entry.kind === 'directory') {
        await scanDir(await handle.getDirectoryHandle(entry.name), fullPath, results)
      } else if (
        entry.name.endsWith('.md') ||
        entry.name.endsWith('.markdown') ||
        entry.name.endsWith('.txt')
      ) {
        // Normalize path so it matches FileSidebar's hardcoded prefixes
        let normalizedPath = fullPath;
        const knownFolders = ['chapters/', 'characters/', 'styles/', 'prompts/'];
        for (const folder of knownFolders) {
          const idx = normalizedPath.indexOf(folder);
          if (idx !== -1) {
            normalizedPath = normalizedPath.substring(idx);
            break;
          }
        }
        results.push({ name: entry.name, path: normalizedPath })
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
          marginRight: filesPanelOpen ? '0px' : '0px',
          transition: isResizing ? 'none' : 'width 350ms cubic-bezier(0.16, 1, 0.3, 1), transform 350ms cubic-bezier(0.16, 1, 0.3, 1), opacity 350ms cubic-bezier(0.16, 1, 0.3, 1), margin-right 350ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div style={{ width: filesPanelWidth }} className="h-full bg-transparent overflow-y-auto min-w-0">
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
      <div className="editor-card flex-1 bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.03),0_16px_48px_rgba(0,0,0,0.06)] flex overflow-hidden min-w-0 select-text animate-scale-in relative">
        {/* Floating Sidebar Restore Controls inside the Editor Card */}
        <div className="absolute top-4 left-4 z-10 flex items-center gap-1.5">
          {!filesPanelOpen && (
            <button
              onClick={() => setFilesPanelOpen(true)}
              className="flex items-center justify-center w-7 h-7 text-[var(--text-muted)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-icon)]/40 bg-transparent rounded-[6px] transition-all cursor-pointer active:scale-[0.9]"
              title="Show files panel"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
          )}
        </div>

        {/* Left: Outline Ruler Panel */}
        <div
          className="border-r border-[var(--border-subtle)]/40 bg-[var(--bg-elevated)]/30 overflow-y-auto flex flex-col pt-16 pb-6 select-none shrink-0"
          style={{
            width: showOutline && headings.length > 0 ? '180px' : '0px',
            opacity: showOutline && headings.length > 0 ? 1 : 0,
            borderRightWidth: showOutline && headings.length > 0 ? '1px' : '0px',
            transition: 'width 250ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease, border-width 250ms cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        >
          <div className="w-[180px] px-4 flex flex-col gap-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]/70 mb-1">Outline</p>
            <div className="flex flex-col gap-1">
              {headings.map((h) => (
                <button
                  key={h.index}
                  onClick={() => scrollToHeading(h.index)}
                  className="text-left text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)]/40 px-2 py-1.5 rounded-[4px] transition-colors truncate cursor-pointer font-sans"
                  style={{
                    paddingLeft: `${Math.max(8, h.level * 8)}px`
                  }}
                  title={h.text}
                >
                  {h.text}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Scrolling Editor area */}
        <div ref={editorContainerRef} className="flex-1 p-8 overflow-y-auto min-w-0 relative">
          <NovelEditor showInlinePopup={true} />
        </div>

        {/* Floating Stats Pill */}
        {settings?.editor_stats && settings.editor_stats !== 'none' && currentFilePath && (
          <div className="absolute bottom-4 right-4 z-10 px-2.5 py-1 bg-[var(--bg)]/80 backdrop-blur-[2px] border border-[var(--border-subtle)] rounded-[6px] text-[10px] text-[var(--text-secondary)] font-medium shadow-sm select-none">
            {settings.editor_stats === 'words' && `${wordCount} words`}
            {settings.editor_stats === 'characters' && `${charCount} characters`}
            {settings.editor_stats === 'both' && `${wordCount} words · ${charCount} chars`}
          </div>
        )}
      </div>

      {/* Right Sidebar (SimpleAssist) with Slide/Fade Transition */}
      <div
        className="shrink-0 overflow-hidden flex"
        style={{
          width: panelOpen ? panelWidth + 8 : 0,
          opacity: panelOpen ? 1 : 0,
          transform: panelOpen ? 'translateX(0)' : 'translateX(16px)',
          marginLeft: panelOpen ? '0px' : '0px',
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
        <div style={{ width: panelWidth }} className="h-full bg-transparent overflow-y-auto min-w-0">
          <SimpleAssist />
        </div>
      </div>

      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  )
}
