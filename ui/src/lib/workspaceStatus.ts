import { API_BASE } from './api'
import { toast } from '../stores/toastStore'
import { useEditorStore, type FileStatus } from '../stores/editorStore'

export interface WorkspaceStatusResponse {
  is_git: boolean
  statuses: Record<string, FileStatus>
}

let lastFetchTime = 0
let isInFlight = false
let pendingForcedRefresh = false

export async function fetchWorkspaceStatus(): Promise<WorkspaceStatusResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/api/workspace/status`, {
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      const data: WorkspaceStatusResponse = await res.json()
      return data
    }
  } catch (err) {
    console.error('Failed to fetch workspace status:', err)
  }
  return null
}

export async function refreshDiffBase(path?: string): Promise<void> {
  const targetPath = path || useEditorStore.getState().currentFilePath
  if (!targetPath) return

  try {
    const res = await fetch(`${API_BASE}/api/workspace/diff-base?path=${encodeURIComponent(targetPath)}`, {
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      const data = await res.json()
      const store = useEditorStore.getState()
      if (store.currentFilePath === targetPath) {
        store.setIsGitWorkspace(Boolean(data.is_git))
        store.setDiffBaseContent(data.has_base ? data.base_content : null)
        store.setHasCommittedVersion(Boolean(data.has_committed_version))
      }
    }
  } catch (err) {
    console.error('Failed to refresh diff base:', err)
  }
}

/**
 * Whether `path` holds text not yet on disk. The open file's text lives in the editor
 * (`content`); any other file's lives in its cached entry (left there by a failed save).
 */
function hasUnsavedText(path: string): boolean {
  const { content, openedFiles, currentFilePath } = useEditorStore.getState()
  const file = openedFiles.find((f) => f.path === path)
  if (!file) return false
  const text = path === currentFilePath ? content : file.content
  return normalizeMarkdownText(text || '') !== normalizeMarkdownText(file.originalContent || '')
}

export async function syncManifestFile(folder: string): Promise<void> {
  if (!folder) return
  const folderName = folder.split('/').pop() || folder
  const manifestRel = `${folder}/${folderName.toUpperCase()}.md`
  try {
    const res = await fetch(`${API_BASE}/api/workspace/files/${encodeURIComponent(manifestRel)}`, {
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      const data = await res.json()
      const store = useEditorStore.getState()
      const isOpen = store.currentFilePath?.toLowerCase() === manifestRel.toLowerCase()
      const cachedPath = isOpen && store.currentFilePath ? store.currentFilePath : manifestRel
      if (hasUnsavedText(cachedPath)) {
        // Reloading would silently drop edits held in the editor or in the cache.
        toast.info(
          `${manifestRel.split('/').pop()} was updated on disk while you had unsaved edits in it. ` +
          'Your edits are kept; saving will replace the updated version.'
        )
        return
      }
      store.loadFileContent(manifestRel, data.content)
      if (isOpen) {
        store.setContent(data.content)
      }
    }
  } catch {
    // ignore
  }
}

export async function refreshWorkspaceStatus(force = false): Promise<void> {
  const now = Date.now()
  if (isInFlight) {
    if (force) {
      pendingForcedRefresh = true
    }
    return
  }
  if (!force && now - lastFetchTime < 1000) {
    return
  }

  isInFlight = true
  lastFetchTime = now

  try {
    const data = await fetchWorkspaceStatus()
    if (data) {
      const store = useEditorStore.getState()
      store.setIsGitWorkspace(Boolean(data.is_git))
      const cleanStatuses: Record<string, FileStatus> = {}
      for (const [k, v] of Object.entries(data.statuses || {})) {
        if (!k.split('/').some((part) => part.startsWith('.'))) {
          cleanStatuses[k] = v
        }
      }
      store.setFileStatusMap(cleanStatuses)
    }
    await refreshDiffBase()
  } finally {

    isInFlight = false
    if (pendingForcedRefresh) {
      pendingForcedRefresh = false
      refreshWorkspaceStatus(true)
    }
  }
}

/**
 * Pure event-driven sync on window focus and visibility changes.
 * Zero polling intervals or continuous background timers.
 */
export function initWorkspaceStatusSync(): () => void {
  const handleFocus = () => {
    refreshWorkspaceStatus(true)
  }

  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      refreshWorkspaceStatus(true)
    }
  }

  window.addEventListener('focus', handleFocus)
  document.addEventListener('visibilitychange', handleVisibility)

  // Initial sync
  refreshWorkspaceStatus(true)

  return () => {
    window.removeEventListener('focus', handleFocus)
    document.removeEventListener('visibilitychange', handleVisibility)
  }
}

/**
 * Normalizes markdown text across editors, serializers, and platforms:
 * - Line endings (\r\n -> \n)
 * - Block separation between headings and following text
 * - Multiple consecutive empty lines
 * - Line-trailing whitespace and overall document trailing newlines
 */
export function normalizeMarkdownText(text: string): string {
  if (!text) return ''
  return text
    .replace(/\r\n/g, '\n')
    .replace(/(^|\n)(#{1,6}\s+[^\n]+)\n([^\n])/g, '$1$2\n\n$3')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim()
}
