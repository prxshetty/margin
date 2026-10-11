import { useState, useCallback, useEffect, useRef } from 'react'
import { RotateCcw } from 'lucide-react'
import { NovelEditor } from '../components/Editor/NovelEditor'
import { SimpleAssist } from '../components/SimpleAssist'
import { FileSidebar } from '../components/FileSidebar'
import { useEditorStore, type ApiFileItem } from '../stores/editorStore'
import { useSettingsStore } from '../stores/settingsStore'
import { toast } from '../stores/toastStore'
import { SettingsModal } from '../components/SettingsModal'
import { RestoreConfirmModal, type RestoreMode } from '../components/RestoreConfirmModal'
import { API_BASE } from '../lib/api'
import {
  initWorkspaceStatusSync,
  refreshWorkspaceStatus,
  refreshDiffBase,
  normalizeMarkdownText,
  syncManifestFile,
} from '../lib/workspaceStatus'


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
  const {
    markFileClean,
    currentFilePath,
    setCurrentFilePath,
    content,
    setContent,
    diffBaseContent,
    setDiffBaseContent,
    hasCommittedVersion,
    fileStatusMap,
    isGitWorkspace,
    openedFiles,
  } = useEditorStore()
  const { showSettings, setShowSettings, settings } = useSettingsStore()

  const [showRestoreModal, setShowRestoreModal] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [isStaging, setIsStaging] = useState(false)

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0
  const charCount = content.length

  const normalizedContent = normalizeMarkdownText(content || '')
  const normalizedDiffBase = normalizeMarkdownText(diffBaseContent || '')

  const currentFile = openedFiles.find((f) => f.path === currentFilePath)
  const normalizedOriginal = normalizeMarkdownText(currentFile?.originalContent || '')
  const isDirty = currentFile ? normalizedContent !== normalizedOriginal : false

  const isDirtyRef = useRef(false)
  const activeFilePathRef = useRef<string | null>(null)

  useEffect(() => {
    isDirtyRef.current = isDirty
    activeFilePathRef.current = currentFilePath
  }, [isDirty, currentFilePath])

  useEffect(() => {
    const handlePageHide = (_e: PageTransitionEvent) => {
      if (!isDirtyRef.current || !activeFilePathRef.current) return

      const store = useEditorStore.getState()
      const fileContent = store.aiPendingEdit ? store.aiPendingEdit.previousContent : store.content

      let url = `${API_BASE}/api/workspace/files/${encodeURIComponent(activeFilePathRef.current)}`
      if (activeFilePathRef.current.startsWith('prompts/')) {
        const filename = activeFilePathRef.current.replace('prompts/', '')
        url = `${API_BASE}/api/assist/prompts/${encodeURIComponent(filename)}`
      }

      navigator.sendBeacon(
        url,
        new Blob([JSON.stringify({ content: fileContent })], { type: 'application/json' })
      )
    }
    window.addEventListener('pagehide', handlePageHide)
    return () => window.removeEventListener('pagehide', handlePageHide)
  }, [])

  const currentStatus = currentFilePath ? fileStatusMap[currentFilePath] : undefined
  const isDeleted = Boolean(currentFile?.deleted) || currentStatus === 'staged_deleted' || currentStatus === 'unstaged_deleted'
  const isStaged =
    currentStatus === 'staged' ||
    currentStatus === 'staged_renamed' ||
    currentStatus === 'staged_modified' ||
    currentStatus === 'staged_renamed_modified' ||
    currentStatus === 'staged_deleted'
  const hasDiffChanges =
    diffBaseContent !== null
      ? normalizedContent !== normalizedDiffBase ||
        currentStatus === 'unstaged_modified' ||
        currentStatus === 'staged_modified' ||
        currentStatus === 'staged_renamed_modified' ||
        isDeleted
      : normalizedContent.length > 0
  const isRenamed =
    currentStatus === 'staged_renamed' ||
    currentStatus === 'staged_renamed_modified'
  const canRestore =
    !isRestoring &&
    (isDeleted ||
      isRenamed ||
      (isStaged && hasCommittedVersion) ||
      (diffBaseContent !== null && normalizedContent !== normalizedDiffBase))

  // Initialize event-driven status sync on focus/visibility change
  useEffect(() => {
    const cleanup = initWorkspaceStatusSync()
    return cleanup
  }, [])

  // Fetch diff base whenever currentFilePath or workspace settings change
  useEffect(() => {
    if (!currentFilePath) {
      setDiffBaseContent(null)
      return
    }
    refreshDiffBase(currentFilePath)
  }, [currentFilePath, settings?.linked_workspace_dir, setDiffBaseContent])

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

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!currentFilePath) return true

    const store = useEditorStore.getState()
    const currentStatus = store.fileStatusMap[currentFilePath]
    if (currentStatus === 'staged_deleted' || currentStatus === 'unstaged_deleted') {
      return true
    }

    const currentFile = store.openedFiles.find((f) => f.path === currentFilePath)
    if (currentFile) {
      const normContent = normalizeMarkdownText(store.content || '')
      const normOriginal = normalizeMarkdownText(currentFile.originalContent || '')
      if (normContent === normOriginal) {
        return true
      }
    }

    if (currentFilePath.startsWith('prompts/')) {
      try {
        const store = useEditorStore.getState()
        const fileContent = store.aiPendingEdit ? store.aiPendingEdit.previousContent : store.content
        const filename = currentFilePath.replace('prompts/', '')
        const res = await fetch(`${API_BASE}/api/assist/prompts/${encodeURIComponent(filename)}`, {
          method: `POST`,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: fileContent }),
          signal: AbortSignal.timeout(10000),
        })
        if (res.ok) {
          markFileClean(currentFilePath)
          return true
        }
        return false
      } catch (err) {
        console.error("Failed to save prompt file:", err)
        toast.error("Could not save prompt file — your changes are still in the editor.")
        return false
      }
    }

    try {
      const store = useEditorStore.getState()
      const fileContent = store.aiPendingEdit ? store.aiPendingEdit.previousContent : store.content
      const res = await fetch(`${API_BASE}/api/workspace/files/${encodeURIComponent(currentFilePath)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: fileContent }),
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) {
        markFileClean(currentFilePath)
        refreshWorkspaceStatus(true)
        return true
      }
      return false
    } catch (err) {
      console.error("Failed to save file:", err)
      toast.error("Could not save file — your changes are still in the editor.")
      return false
    }
  }, [currentFilePath, markFileClean])

  const handleStageOrSnapshot = async () => {
    if (!currentFilePath) return
    setIsStaging(true)
    try {
      const saveOk = await handleSave()
      if (!saveOk) {
        console.error("Staging aborted because save operation failed.")
        return
      }
      const res = await fetch(`${API_BASE}/api/workspace/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentFilePath, content }),
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) {
        const data = await res.json()
        setDiffBaseContent(data.base_content ?? content)
        if (data.has_committed_version !== undefined) {
          useEditorStore.getState().setHasCommittedVersion(Boolean(data.has_committed_version))
        }
        markFileClean(currentFilePath)
        refreshWorkspaceStatus(true)
      }
    } catch (err) {
      console.error('Failed to stage/snapshot file:', err)
    } finally {
      setIsStaging(false)
    }
  }

  const handleRestoreConfirm = async (mode: RestoreMode = 'committed') => {
    if (!currentFilePath) return
    setIsRestoring(true)
    try {
      const res = await fetch(`${API_BASE}/api/workspace/restore-diff-base`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentFilePath, mode }),
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) {
        const data = await res.json()
        const restored = data.restored_content ?? ''
        const targetPath = (data.restored_path as string) || currentFilePath
        const isPathChanged = targetPath !== currentFilePath

        const editorInstance = useEditorStore.getState().editor
        if (editorInstance) {
          editorInstance.commands.setContent(restored)
        }
        setContent(restored)
        setDiffBaseContent(data.base_content ?? restored)
        markFileClean(currentFilePath)
        if (isPathChanged) {
          markFileClean(targetPath)
          setCurrentFilePath(targetPath)
        }
        if (isDeleted || isPathChanged) {
          try {
            const filesRes = await fetch(`${API_BASE}/api/workspace/files`, {
              signal: AbortSignal.timeout(10000),
            })
            if (filesRes.ok) {
              const files: ApiFileItem[] = await filesRes.json()
              const { setOpenedFiles } = useEditorStore.getState()
              const existingFiles = useEditorStore.getState().openedFiles
              setOpenedFiles(
                files.map((f: ApiFileItem) => {
                  const existing = existingFiles.find((ef) => ef.path === f.path)
                  return {
                    name: f.name,
                    path: f.path,
                    content: f.path === targetPath ? restored : (existing ? existing.content : ''),
                    originalContent: f.path === targetPath ? restored : (existing ? existing.originalContent : ''),
                    deleted: Boolean(f.deleted),
                    tracked: f.tracked !== undefined ? Boolean(f.tracked) : true,
                  }
                })
              )
            }
          } catch {
            // ignore
          }
        }
        const folder = targetPath.includes('/') ? targetPath.split('/')[0] : ''
        if (folder) {
          await syncManifestFile(folder)
        }
        setShowRestoreModal(false)
        refreshWorkspaceStatus(true)
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

  const handleOpenRestore = async () => {
    if (isDirty) {
      await handleSave()
    }
    setShowRestoreModal(true)
  }

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

        {/* Deleted File Warning Banner */}
        {isDeleted && (
          <div className="bg-red-500/10 border-b border-red-500/20 px-6 py-2.5 flex items-center gap-2 text-xs text-red-400 select-none shrink-0">
            <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse shrink-0" />
            <span>
              {isGitWorkspace
                ? `This file was deleted in Git (${currentStatus === 'staged_deleted' ? 'staged' : 'unstaged'}). Viewing in read-only mode.`
                : 'This file was deleted. Viewing snapshot in read-only mode.'}
            </span>
          </div>
        )}

        {/* Scrolling Editor area */}
        <div ref={editorContainerRef} className="editor-scroll-container flex-1 p-8 overflow-y-auto min-w-0 relative">
          <NovelEditor showInlinePopup={true} onSave={handleSave} isDirty={isDirty} />
        </div>

        {/* Bottom Toolbar / Status Bar - only rendered when a document is selected */}
        {Boolean(currentFilePath) && (
          <div className="editor-bottom-bar shrink-0 px-4 py-2 flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] bg-[var(--bg)]/90 backdrop-blur-[2px] z-10 select-none">
            {/* Left: State Actions (Stage / Snapshot -> Restore) */}
            <div className="flex items-center gap-1.5 shrink-0 animate-fade-in">
              {/* Stage / Snapshot */}
              <button
                onClick={handleStageOrSnapshot}
                disabled={!hasDiffChanges || isStaging || isDeleted}
                className={`px-2.5 py-1 rounded-[6px] text-[10px] font-medium shadow-sm transition-all flex items-center gap-1.5 ${
                  hasDiffChanges && !isStaging && !isDeleted
                    ? 'bg-[var(--bg)]/80 backdrop-blur-[2px] border border-[var(--border-subtle)] hover:border-[var(--text-secondary)] text-[var(--text)] hover:text-[var(--text-heading)] cursor-pointer active:scale-[0.98]'
                    : 'bg-[var(--bg-disabled)]/40 border border-transparent text-[var(--text-disabled)] cursor-not-allowed opacity-60'
                }`}
                title={
                  isDeleted
                    ? isGitWorkspace
                      ? 'Cannot stage a deleted file'
                      : 'Cannot snapshot a deleted file'
                    : !hasDiffChanges
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
                    hasDiffChanges && !isDeleted ? 'bg-[var(--accent-brown)]' : 'bg-[var(--text-disabled)]'
                  }`}
                />
                {settings?.show_file_action_labels && <span>{isGitWorkspace ? 'Stage' : 'Snapshot'}</span>}
              </button>

              {/* Restore (Undo / Revert to staged or snapshot version) */}
              <button
                onClick={handleOpenRestore}
                disabled={!canRestore}
                className={`px-2.5 py-1 rounded-[6px] text-[10px] font-medium shadow-sm transition-all flex items-center gap-1.5 ${
                  canRestore
                    ? 'bg-[var(--bg)]/80 backdrop-blur-[2px] border border-[var(--border-subtle)] hover:border-[var(--danger)] text-[var(--text)] hover:text-[var(--danger)] cursor-pointer active:scale-[0.98]'
                    : 'bg-[var(--bg-disabled)]/40 border border-transparent text-[var(--text-disabled)] cursor-not-allowed opacity-60'
                }`}
                title={
                  isDeleted
                    ? isGitWorkspace
                      ? 'Restore deleted file from repository'
                      : 'Restore deleted file from snapshot baseline'
                    : !canRestore
                    ? 'No changes to restore'
                    : isGitWorkspace
                    ? isStaged
                      ? 'Restore committed baseline version (unstage & revert)'
                      : 'Restore staged/baseline version'
                    : 'Restore snapshot baseline'
                }
              >
                <RotateCcw className="w-3 h-3" />
                {settings?.show_file_action_labels && <span>Restore</span>}
              </button>
            </div>

            {/* Right: Stats Pill */}
            {settings?.editor_stats && settings.editor_stats !== 'none' && (
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
          filePath={currentFilePath}
          isGitWorkspace={Boolean(isGitWorkspace)}
          isDeleted={isDeleted}
          isRestoring={isRestoring}
          fileStatus={currentStatus}
          hasCommittedVersion={hasCommittedVersion}
          hasUnstagedChanges={Boolean(
            (diffBaseContent !== null && normalizedContent !== normalizedDiffBase) || isDirty
          )}
        />
      )}
    </div>
  )
}
