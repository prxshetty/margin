import { API_BASE } from './api'
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

export async function syncManifestFile(folder: string): Promise<void> {
  if (!folder) return
  const manifestRel = `${folder}/${folder.toUpperCase()}.md`
  try {
    const res = await fetch(`${API_BASE}/api/workspace/files/${encodeURIComponent(manifestRel)}`, {
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      const data = await res.json()
      const store = useEditorStore.getState()
      store.loadFileContent(manifestRel, data.content)
      if (store.currentFilePath?.toLowerCase() === manifestRel.toLowerCase()) {
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
      store.setFileStatusMap(data.statuses || {})
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
