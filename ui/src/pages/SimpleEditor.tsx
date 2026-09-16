import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { RotateCcw, GitCommit, FileText } from 'lucide-react'
import { NovelEditor } from '../components/Editor/NovelEditor'
import { SimpleAssist } from '../components/SimpleAssist'
import { FileSidebar } from '../components/FileSidebar'
import { useEditorStore, type FileGitStatus } from '../stores/editorStore'
import { useSettingsStore } from '../stores/settingsStore'
import { SettingsModal } from '../components/SettingsModal'
import { RestoreConfirmModal } from '../components/RestoreConfirmModal'
import { CommitDialog } from '../components/CommitDialog'
import { ManifestSummaryDialog } from '../components/ManifestSummaryDialog'
import { API_BASE } from '../lib/api'
import { saveCurrentFile } from '../lib/saveFile'
import { refreshWorkspaceStatus, useWorkspaceStatusSync } from '../lib/workspaceStatus'


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
function getStoredScrollPositions(): Record<string, number> {
  try {
    const raw = localStorage.getItem('margin-scroll-positions')
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function getStoredScrollPosition(path: string): number | null {
  const map = getStoredScrollPositions()
  return typeof map[path] === 'number' ? map[path] : null
}

function setStoredScrollPosition(path: string, pos: number): void {
  try {
    const map = getStoredScrollPositions()
    map[path] = pos
    localStorage.setItem('margin-scroll-positions', JSON.stringify(map))
  } catch { /* ignore */ }
}

export default function SimpleEditor() {
  useWorkspaceStatusSync()

  const {
    markFileClean,
    currentFilePath,
    content,
    setContent,
    diffBaseContent,
    workspaceDir,
    setDiffBaseContent,
    isGitWorkspace,
    setIsGitWorkspace,
    documentShowAdditions,
    setDocumentShowAdditions,
    documentShowDeletions,
    setDocumentShowDeletions,
    hasDiffChanges,
    aiPendingEdit,
    fileStatusMap,
    openedFiles,
  } = useEditorStore()
  const { showSettings, setShowSettings, settings } = useSettingsStore()

  const currentFileStatus = currentFilePath ? (fileStatusMap[currentFilePath] || 'clean') : 'clean'
  let effectiveCurrentStatus: FileGitStatus = currentFileStatus
  if (currentFilePath && diffBaseContent !== null) {
    if (!hasDiffChanges) {
      effectiveCurrentStatus = (!isGitWorkspace || currentFileStatus === 'unstaged_modified') ? 'clean' : (currentFileStatus === 'staged_modified' ? 'staged' : currentFileStatus)
    } else {
      effectiveCurrentStatus = !isGitWorkspace ? 'unstaged_modified' : (currentFileStatus === 'staged' || currentFileStatus === 'staged_modified' ? 'staged_modified' : 'unstaged_modified')
    }
  }
  const isCurrentFileStaged = effectiveCurrentStatus === 'staged' || effectiveCurrentStatus === 'staged_modified'

  const otherUnstagedFiles = useMemo(() => {
    const list: string[] = []
    for (const [path, status] of Object.entries(fileStatusMap)) {
      if (path !== currentFilePath && (status === 'unstaged_modified' || status === 'staged_modified')) {
        list.push(path)
      }
    }
    for (const f of openedFiles) {
      if (f.path !== currentFilePath && f.content && f.originalContent && f.content !== f.originalContent) {
        if (!list.includes(f.path)) list.push(f.path)
      }
    }
    return list
  }, [fileStatusMap, openedFiles, currentFilePath])

  const currentFileHasChanges = effectiveCurrentStatus === 'unstaged_modified' || effectiveCurrentStatus === 'staged_modified'
  const isOnlyUnstagedFile = currentFileHasChanges && otherUnstagedFiles.length === 0
  const canCommit = isGitWorkspace && !aiPendingEdit && (isCurrentFileStaged || isOnlyUnstagedFile)

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0
  const charCount = content.length

  const currentFilePathRef = useRef<string | null>(currentFilePath)
  useEffect(() => {
    currentFilePathRef.current = currentFilePath
  }, [currentFilePath])

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

  // Scroll event listener: track scroll status class and persist scroll position
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

      if (currentFilePathRef.current) {
        setStoredScrollPosition(currentFilePathRef.current, el.scrollTop)
      }
    }

    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', handleScroll)
      clearTimeout(timeoutId)
    }
  }, [])

  // Restore scroll position when active document changes or loads
  useEffect(() => {
    if (!currentFilePath) return
    const el = editorContainerRef.current
    if (!el) return

    const savedPos = getStoredScrollPosition(currentFilePath)
    const targetPos = savedPos !== null ? savedPos : 0

    if (savedPos === null) {
      setStoredScrollPosition(currentFilePath, 0)
    }

    // Schedule scroll setting after DOM render
    const frameId1 = requestAnimationFrame(() => {
      const frameId2 = requestAnimationFrame(() => {
        if (el) {
          el.scrollTop = targetPos
        }
      })
      return () => cancelAnimationFrame(frameId2)
    })

    return () => cancelAnimationFrame(frameId1)
  }, [currentFilePath, content])

  const handleSave = useCallback(async () => {
    await saveCurrentFile({ force: true })
  }, [])

  // 1. Keyboard Shortcut (Mod + S / Ctrl+S / Cmd+S)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        e.stopPropagation()
        saveCurrentFile({ force: true })
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, { capture: true })
  }, [])

  // 3. Window Blur & Visibility Change, 5. Page Unload Safety Net (beforeunload / pagehide)
  useEffect(() => {
    const saveCurrentScroll = () => {
      if (editorContainerRef.current && currentFilePathRef.current) {
        setStoredScrollPosition(currentFilePathRef.current, editorContainerRef.current.scrollTop)
      }
    }
    const handleWindowBlur = () => {
      saveCurrentScroll()
      saveCurrentFile()
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveCurrentScroll()
        saveCurrentFile()
      }
    }
    const handleUnload = () => {
      saveCurrentScroll()
      saveCurrentFile({ keepalive: true })
    }

    window.addEventListener('blur', handleWindowBlur)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', handleUnload)
    window.addEventListener('pagehide', handleUnload)

    return () => {
      window.removeEventListener('blur', handleWindowBlur)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleUnload)
      window.removeEventListener('pagehide', handleUnload)
    }
  }, [])

  // Fetch diff base whenever currentFilePath or workspaceDir changes
  useEffect(() => {
    if (!currentFilePath) {
      setDiffBaseContent(null)
      return
    }
    let cancelled = false
    fetch(`${API_BASE}/api/workspace/diff-base?path=${encodeURIComponent(currentFilePath)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setIsGitWorkspace(data.is_git)
          setDiffBaseContent(data.base_content)
        }
      })
      .catch((err) => console.error('Failed to fetch diff base:', err))

    return () => {
      cancelled = true
    }
  }, [currentFilePath, workspaceDir, setDiffBaseContent, setIsGitWorkspace])

  const handleStageOrSnapshot = async () => {
    if (!currentFilePath) return
    try {
      await handleSave()
      const res = await fetch(`${API_BASE}/api/workspace/stage-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentFilePath, content }),
      })
      if (res.ok) {
        const data = await res.json()
        setDiffBaseContent(data.base_content)
        markFileClean(currentFilePath)
        refreshWorkspaceStatus()
      }
    } catch (err) {
      console.error('Failed to stage/snapshot file:', err)
    }
  }

  const [showRestoreModal, setShowRestoreModal] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [showCommitDialog, setShowCommitDialog] = useState(false)
  const [isCommitting, setIsCommitting] = useState(false)
  const [manifestInfo, setManifestInfo] = useState<{
    manifest_exists: boolean
    manifest_path: string
    current_summary: string
    filename: string
  } | null>(null)
  const [showManifestDialog, setShowManifestDialog] = useState(false)

  // Fetch manifest info whenever currentFilePath or workspaceDir changes
  useEffect(() => {
    if (!currentFilePath) {
      setManifestInfo(null)
      return
    }
    let cancelled = false
    fetch(`${API_BASE}/api/workspace/manifest-summary?path=${encodeURIComponent(currentFilePath)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setManifestInfo(data)
        }
      })
      .catch((err) => console.error('Failed to fetch manifest summary info:', err))

    return () => {
      cancelled = true
    }
  }, [currentFilePath, workspaceDir])

  const paragraphCount = useMemo(() => {
    if (!content) return 0
    const rawBlocks = content.split(/\n\s*\n/)
    const validParagraphs = rawBlocks
      .map((b) => b.trim())
      .filter((b) => b.length > 0 && !b.startsWith('#'))
    return validParagraphs.length
  }, [content])

  const handleRestoreConfirm = async () => {
    if (!currentFilePath) return
    setIsRestoring(true)
    try {
      const res = await fetch(`${API_BASE}/api/workspace/restore-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentFilePath }),
      })
      if (res.ok) {
        const data = await res.json()
        const restored = data.restored_content ?? ''
        const editorInstance = useEditorStore.getState().editor
        if (editorInstance) {
          editorInstance.commands.setContent(restored)
        }
        setContent(restored)
        setDiffBaseContent(data.base_content ?? restored)
        markFileClean(currentFilePath)
        setShowRestoreModal(false)
        refreshWorkspaceStatus()
      } else {
        const err = await res.json().catch(() => null)
        window.alert(`Failed to restore: ${err?.detail || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('Failed to restore file:', err)
      window.alert('Network error while restoring file')
    } finally {
      setIsRestoring(false)
    }
  }

  const handleCommitConfirm = async (title: string, comment: string) => {
    if (!currentFilePath) return
    setIsCommitting(true)
    try {
      if (!isCurrentFileStaged) {
        await handleSave()
        const stageRes = await fetch(`${API_BASE}/api/workspace/stage-file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: currentFilePath, content }),
        })
        if (!stageRes.ok) {
          const err = await stageRes.json().catch(() => null)
          window.alert(`Failed to stage file before commit: ${err?.detail || 'Unknown error'}`)
          setIsCommitting(false)
          return
        }
      } else {
        await handleSave()
      }
      const res = await fetch(`${API_BASE}/api/workspace/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: currentFilePath,
          title,
          comment,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.base_content !== undefined) {
          setDiffBaseContent(data.base_content)
        }
        markFileClean(currentFilePath)
        setShowCommitDialog(false)
        refreshWorkspaceStatus()
      } else {
        const err = await res.json().catch(() => null)
        window.alert(`Git commit failed: ${err?.detail || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('Failed to commit:', err)
      window.alert('Network error while committing changes')
    } finally {
      setIsCommitting(false)
    }
  }

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
      <div className="editor-card flex-1 bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[14px] shadow-[0_2px_8px_rgba(0,0,0,0.03),0_16px_48px_rgba(0,0,0,0.06)] flex flex-col overflow-hidden min-w-0 select-text animate-scale-in relative">
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

        {/* Scrolling Editor area */}
        <div ref={editorContainerRef} className="editor-scroll-container flex-1 p-8 overflow-y-auto min-w-0 relative">
          <NovelEditor showInlinePopup={true} />
        </div>

        {/* Bottom Toolbar / Status Bar */}
        {(currentFilePath || (settings?.editor_stats && settings.editor_stats !== 'none')) && (
          <div className="editor-bottom-bar shrink-0 px-4 py-2 flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] bg-[var(--bg)]/90 backdrop-blur-[2px] z-10 select-none">
            {/* Left: State Actions (Stage / Snapshot -> Commit -> Restore) */}
            <div className="flex items-center gap-1.5 shrink-0 animate-fade-in">
              {currentFilePath && (
                <>
                  {/* Stage / Snapshot */}
                  <button
                    onClick={handleStageOrSnapshot}
                    disabled={!hasDiffChanges || !!aiPendingEdit}
                    className={`px-2.5 py-1 rounded-[6px] text-[10px] font-medium shadow-sm transition-all flex items-center gap-1.5 ${
                      hasDiffChanges && !aiPendingEdit
                        ? 'bg-[var(--bg)]/80 backdrop-blur-[2px] border border-[var(--border-subtle)] hover:border-[var(--text-secondary)] text-[var(--text)] hover:text-[var(--text-heading)] cursor-pointer active:scale-[0.98]'
                        : 'bg-[var(--bg-disabled)]/40 border border-transparent text-[var(--text-disabled)] cursor-not-allowed opacity-60'
                    }`}
                    title={
                      !hasDiffChanges || !!aiPendingEdit
                        ? isGitWorkspace
                          ? 'No changes to stage'
                          : 'No changes to snapshot'
                        : isGitWorkspace
                        ? 'Stage current changes'
                        : 'Snapshot current baseline'
                    }
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        hasDiffChanges && !aiPendingEdit ? 'bg-[var(--accent-brown)]' : 'bg-[var(--text-disabled)]'
                      }`}
                    />
                    <span>{isGitWorkspace ? 'Stage' : 'Snapshot'}</span>
                  </button>

                  {/* Commit (Git only) - enabled if staged OR if current file is the only file with unstaged changes */}
                  {isGitWorkspace && (
                    <button
                      onClick={() => setShowCommitDialog(true)}
                      disabled={!canCommit}
                      className={`px-2.5 py-1 rounded-[6px] text-[10px] font-medium shadow-sm transition-all flex items-center gap-1.5 ${
                        canCommit
                          ? 'bg-[var(--bg)]/80 backdrop-blur-[2px] border border-[var(--border-subtle)] hover:border-[var(--accent-green)] text-[var(--text)] hover:text-[var(--text-heading)] cursor-pointer active:scale-[0.98]'
                          : 'bg-[var(--bg-disabled)]/40 border border-transparent text-[var(--text-disabled)] cursor-not-allowed opacity-60'
                      }`}
                      title={
                        aiPendingEdit
                          ? 'Resolve pending AI edit preview before committing'
                          : isCurrentFileStaged
                          ? 'Commit staged changes to Git'
                          : isOnlyUnstagedFile
                          ? 'Current document will be staged and committed to Git'
                          : otherUnstagedFiles.length > 0
                          ? 'Stage document before committing (multiple files have unstaged changes)'
                          : 'No changes to commit'
                      }
                    >
                      <GitCommit className="w-3 h-3 text-[var(--accent-green)]" />
                      <span>Commit</span>
                    </button>
                  )}

                  {/* Restore (Undo / Revert to staged or snapshot version) */}
                  <button
                    onClick={() => setShowRestoreModal(true)}
                    disabled={!hasDiffChanges || !!aiPendingEdit || diffBaseContent === null}
                    className={`px-2.5 py-1 rounded-[6px] text-[10px] font-medium shadow-sm transition-all flex items-center gap-1.5 ${
                      hasDiffChanges && !aiPendingEdit && diffBaseContent !== null
                        ? 'bg-[var(--bg)]/80 backdrop-blur-[2px] border border-[var(--border-subtle)] hover:border-[var(--danger)] text-[var(--text)] hover:text-[var(--danger)] cursor-pointer active:scale-[0.98]'
                        : 'bg-[var(--bg-disabled)]/40 border border-transparent text-[var(--text-disabled)] cursor-not-allowed opacity-60'
                    }`}
                    title={
                      !hasDiffChanges || !!aiPendingEdit || diffBaseContent === null
                        ? 'No changes to restore'
                        : isGitWorkspace
                        ? 'Restore staged/baseline version'
                        : 'Restore snapshot baseline'
                    }
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Restore</span>
                  </button>

                  {/* Summarize (Update manifest summary - hidden if manifest does not exist, disabled if < 2 paragraphs or preview active) */}
                  {manifestInfo?.manifest_exists && (
                    <button
                      onClick={() => setShowManifestDialog(true)}
                      disabled={paragraphCount < 2 || !!aiPendingEdit}
                      className={`px-2.5 py-1 rounded-[6px] text-[10px] font-medium shadow-sm transition-all flex items-center gap-1.5 ${
                        paragraphCount >= 2 && !aiPendingEdit
                          ? 'bg-[var(--bg)]/80 backdrop-blur-[2px] border border-[var(--border-subtle)] hover:border-[var(--accent-brown)] text-[var(--text)] hover:text-[var(--text-heading)] cursor-pointer active:scale-[0.98]'
                          : 'bg-[var(--bg-disabled)]/40 border border-transparent text-[var(--text-disabled)] cursor-not-allowed opacity-60'
                      }`}
                      title={
                        aiPendingEdit
                          ? 'Resolve pending AI edit preview before updating summary'
                          : paragraphCount < 2
                          ? 'Document must contain at least 2 paragraphs to update summary'
                          : `Update summary in ${manifestInfo.manifest_path.split('/').pop() || 'manifest'}`
                      }
                    >
                      <FileText className="w-3 h-3 text-[var(--accent-brown)]" />
                      <span>Summarize</span>
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Center: Additions & Deletions Quick Toggles (Centered between actions and stats, right-aligned if stats disabled) */}
            <div
              className={`flex-1 flex items-center ${
                settings?.editor_stats && settings.editor_stats !== 'none' && currentFilePath
                  ? 'justify-center'
                  : 'justify-end'
              }`}
            >
              {currentFilePath && (settings?.show_additions !== false || settings?.show_deletions !== false) && (
                <div className="flex items-center gap-1.5 animate-fade-in">
                  {settings?.show_additions !== false && (
                    <button
                      onClick={() => setDocumentShowAdditions(!documentShowAdditions)}
                      className={`w-6 h-6 rounded-[6px] border transition-all cursor-pointer flex items-center justify-center shadow-sm active:scale-[0.95] ${
                        documentShowAdditions
                          ? 'bg-[var(--bg)]/80 backdrop-blur-[2px] border-[var(--border-subtle)] text-[var(--text-heading)]'
                          : 'bg-[var(--bg-disabled)]/60 border-transparent text-[var(--text-disabled)] opacity-60 hover:opacity-100'
                      }`}
                      title={documentShowAdditions ? 'Additions: Shown (click to hide)' : 'Additions: Hidden (click to show)'}
                    >
                      <span className="underline text-[var(--diff-addition-text)] font-bold text-[13px] leading-none select-none">+</span>
                    </button>
                  )}

                  {settings?.show_deletions !== false && (
                    <button
                      onClick={() => setDocumentShowDeletions(!documentShowDeletions)}
                      className={`w-6 h-6 rounded-[6px] border transition-all cursor-pointer flex items-center justify-center shadow-sm active:scale-[0.95] ${
                        documentShowDeletions
                          ? 'bg-[var(--bg)]/80 backdrop-blur-[2px] border-[var(--border-subtle)] text-[var(--text-heading)]'
                          : 'bg-[var(--bg-disabled)]/60 border-transparent text-[var(--text-disabled)] opacity-60 hover:opacity-100'
                      }`}
                      title={documentShowDeletions ? 'Deletions: Shown (click to hide)' : 'Deletions: Hidden (click to show)'}
                    >
                      <span className="line-through text-[var(--diff-deletion-text)] font-bold text-[13px] leading-none select-none">−</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Right: Stats Pill */}
            {settings?.editor_stats && settings.editor_stats !== 'none' && currentFilePath && (
              <div className="shrink-0 flex items-center justify-end animate-fade-in">
                <div className="px-2.5 py-1 bg-[var(--bg)]/80 backdrop-blur-[2px] border border-[var(--border-subtle)] rounded-[6px] text-[10px] text-[var(--text-secondary)] font-medium shadow-sm select-none">
                  {settings.editor_stats === 'words' && `${wordCount} words`}
                  {settings.editor_stats === 'characters' && `${charCount} characters`}
                  {settings.editor_stats === 'both' && `${wordCount} words · ${charCount} chars`}
                </div>
              </div>
            )}
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

      {showRestoreModal && currentFilePath && (
        <RestoreConfirmModal
          isOpen={showRestoreModal}
          onClose={() => setShowRestoreModal(false)}
          onConfirm={handleRestoreConfirm}
          fileName={currentFilePath.split('/').pop() || currentFilePath}
          isGitWorkspace={Boolean(isGitWorkspace)}
          isRestoring={isRestoring}
        />
      )}

      {showCommitDialog && currentFilePath && isGitWorkspace && (
        <CommitDialog
          isOpen={showCommitDialog}
          onClose={() => setShowCommitDialog(false)}
          onCommit={handleCommitConfirm}
          filePath={currentFilePath}
          baseContent={diffBaseContent}
          currentContent={content}
          isCommitting={isCommitting}
        />
      )}

      {/* Manifest Summary Dialog */}
      {showManifestDialog && manifestInfo?.manifest_exists && currentFilePath && (
        <ManifestSummaryDialog
          isOpen={showManifestDialog}
          onClose={() => setShowManifestDialog(false)}
          filePath={currentFilePath}
          manifestPath={manifestInfo.manifest_path}
          currentSummary={manifestInfo.current_summary}
          documentContent={content}
          onSummaryUpdated={(newSummary) => {
            setManifestInfo((prev) => (prev ? { ...prev, current_summary: newSummary } : null))
          }}
        />
      )}
    </div>
  )
}
