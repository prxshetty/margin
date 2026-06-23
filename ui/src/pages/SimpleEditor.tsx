import { useState, useCallback, useEffect, useRef } from 'react'
import { NovelEditor } from '../components/Editor/NovelEditor'
import { SimpleAssist } from '../components/SimpleAssist'
import { FileSidebar } from '../components/FileSidebar'
import { useEditorStore } from '../stores/editorStore'
import { useSettingsStore } from '../stores/settingsStore'
import { SettingsModal } from '../components/SettingsModal'
import { API_BASE } from '../lib/api'


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
  const { markFileClean, currentFilePath, content } = useEditorStore()
  const { showSettings, setShowSettings, settings } = useSettingsStore()

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0
  const charCount = content.length

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
  const filesPanelWidthRef = useRef(filesPanelWidth)
  const panelWidthRef = useRef(panelWidth)

  useEffect(() => {
    filesPanelWidthRef.current = filesPanelWidth
  }, [filesPanelWidth])

  useEffect(() => {
    panelWidthRef.current = panelWidth
  }, [panelWidth])

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

  const handleSave = useCallback(async () => {
    if (!currentFilePath) return

    if (currentFilePath.startsWith('prompts/')) {
      try {
        const store = useEditorStore.getState()
        const fileContent = store.aiPendingEdit ? store.aiPendingEdit.previousContent : store.content
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

    try {
      const store = useEditorStore.getState()
      const fileContent = store.aiPendingEdit ? store.aiPendingEdit.previousContent : store.content
      const res = await fetch(`${API_BASE}/api/workspace/files/${encodeURIComponent(currentFilePath)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: fileContent })
      })
      if (res.ok) {
        markFileClean(currentFilePath)
      }
    } catch (err) {
      console.error("Failed to save file:", err)
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
        localStorage.setItem('simple-files-panel-width', String(filesPanelWidthRef.current))
      }
      if (aiDraggingRef.current) {
        aiDraggingRef.current = false
        localStorage.setItem('simple-ai-panel-width', String(panelWidthRef.current))
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
  }, [])

  return (
    <div className="h-screen flex bg-[var(--bg-editor)] p-2 overflow-hidden select-none">
      {/* Left Sidebar (FileSidebar) with Slide/Fade Transition */}
      <div
        className="shrink-0 overflow-hidden flex"
        style={{
          width: filesPanelOpen ? filesPanelWidth + 8 : 0,
          opacity: filesPanelOpen ? 1 : 0,
          transform: filesPanelOpen ? 'translateX(0)' : 'translateX(-16px)',
          transition: isResizing ? 'none' : 'width 350ms cubic-bezier(0.16, 1, 0.3, 1), transform 350ms cubic-bezier(0.16, 1, 0.3, 1), opacity 350ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div style={{ width: filesPanelWidth }} className="h-full bg-transparent overflow-y-auto min-w-0">
          <FileSidebar
            onSaveCurrentFile={handleSave}
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
          <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-[4px] h-8 rounded-full bg-[var(--border)] opacity-0 group-hover:opacity-100 group-hover:bg-[var(--text-muted)] transition-all duration-200" />
        </div>
      </div>

      {/* Floating Manuscript Editor Card */}
      <div className="editor-card flex-1 bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[14px] shadow-[0_2px_8px_rgba(0,0,0,0.03),0_16px_48px_rgba(0,0,0,0.06)] flex overflow-hidden min-w-0 select-text animate-scale-in relative">
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

        {/* Right: Scrolling Editor area */}
        <div ref={editorContainerRef} className="editor-scroll-container flex-1 p-8 overflow-y-auto min-w-0 relative">
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
          transition: isResizing ? 'none' : 'width 350ms cubic-bezier(0.16, 1, 0.3, 1), transform 350ms cubic-bezier(0.16, 1, 0.3, 1), opacity 350ms cubic-bezier(0.16, 1, 0.3, 1)',
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
          <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-[4px] h-8 rounded-full bg-[var(--border)] opacity-0 group-hover:opacity-100 group-hover:bg-[var(--text-muted)] transition-all duration-200" />
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
