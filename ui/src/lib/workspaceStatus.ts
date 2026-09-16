import { useEffect } from 'react'
import { API_BASE } from './api'
import { useEditorStore } from '../stores/editorStore'

function shallowMapsEqual(
  a: Record<string, string> | undefined | null,
  b: Record<string, string> | undefined | null
): boolean {
  if (!a || !b) return a === b
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  for (const k of keysA) {
    if (a[k] !== b[k]) return false
  }
  return true
}

let isInFlight = false
let lastFetchTime = 0

export async function refreshDiffBase(path?: string): Promise<void> {
  const store = useEditorStore.getState()
  const targetPath = path || store.currentFilePath
  if (!targetPath) return

  try {
    const res = await fetch(`${API_BASE}/api/workspace/diff-base?path=${encodeURIComponent(targetPath)}`)
    if (res.ok) {
      const data = await res.json()
      if (typeof data.is_git === 'boolean' && data.is_git !== store.isGitWorkspace) {
        store.setIsGitWorkspace(data.is_git)
      }
      if (data.base_content !== undefined && data.base_content !== store.diffBaseContent) {
        store.setDiffBaseContent(data.base_content)
      }
    }
  } catch (err) {
    console.error('Failed to refresh diff base:', err)
  }
}

export async function refreshWorkspaceStatus(force = false): Promise<void> {
  const now = Date.now()
  if (!force && (isInFlight || now - lastFetchTime < 1000)) {
    return
  }

  isInFlight = true
  lastFetchTime = now

  try {
    const res = await fetch(`${API_BASE}/api/workspace/status`)
    if (res.ok) {
      const data = await res.json()
      const store = useEditorStore.getState()

      if (typeof data.is_git === 'boolean' && data.is_git !== store.isGitWorkspace) {
        store.setIsGitWorkspace(data.is_git)
      }

      if (data.statuses) {
        const oldMap = store.fileStatusMap
        const newMap = data.statuses
        const hasChanged = !shallowMapsEqual(oldMap, newMap)

        if (hasChanged) {
          store.setFileStatusMap(newMap)

          // If git status of active file changed externally (e.g. staged/committed outside), sync diff base
          if (store.currentFilePath) {
            const oldStatus = oldMap[store.currentFilePath]
            const newStatus = newMap[store.currentFilePath]
            if (oldStatus !== newStatus) {
              refreshDiffBase(store.currentFilePath)
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('Failed to refresh workspace status:', err)
  } finally {
    isInFlight = false
  }
}

/**
 * Pure event-driven React hook for keeping workspace Git state in sync with external tools.
 * 
 * Features:
 * - 0% idle polling / zero background timer overhead.
 * - Instant update on window focus (e.g., switching back from GitKraken, terminal, or external IDE).
 * - Instant update on tab visibility change (document becoming visible).
 * - In-flight deduplication and shallow diff check to avoid unnecessary React re-renders.
 */
export function useWorkspaceStatusSync() {
  useEffect(() => {
    // 1. Initial sync on mount
    refreshWorkspaceStatus(true)
    refreshDiffBase()

    // 2. Window focus listener (switching back from GitKraken, terminal, etc.)
    const handleFocus = () => {
      refreshWorkspaceStatus(true)
      refreshDiffBase()
    }

    // 3. Tab visibility listener (switching browser tabs)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshWorkspaceStatus(true)
        refreshDiffBase()
      }
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])
}
