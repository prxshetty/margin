import { API_BASE } from './api'
import { useEditorStore } from '../stores/editorStore'
import { refreshWorkspaceStatus } from './workspaceStatus'

export interface SaveOptions {
  keepalive?: boolean
  force?: boolean
}

/**
 * Saves the current active document to disk.
 * Returns true if saved or already clean, false if an error occurred.
 */
export async function saveCurrentFile(options?: SaveOptions): Promise<boolean> {
  const store = useEditorStore.getState()
  const path = store.currentFilePath
  if (!path) return true

  // Get current content (or previousContent if there is an active unaccepted AI preview)
  const currentContent = store.content
  const fileContent = store.aiPendingEdit ? store.aiPendingEdit.previousContent : currentContent

  const file = store.openedFiles.find((f) => f.path === path)
  const isDirty = !file || file.originalContent !== fileContent

  // If not dirty and not forced / keepalive, return early
  if (!isDirty && !options?.force && !options?.keepalive) {
    return true
  }

  try {
    store.setIsSaving(true)

    if (path.startsWith('prompts/')) {
      const filename = path.replace('prompts/', '')
      const res = await fetch(`${API_BASE}/api/assist/prompts/${encodeURIComponent(filename)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: fileContent }),
        keepalive: options?.keepalive ?? false,
      })
      if (res.ok) {
        store.markFileClean(path)
        return true
      }
      return false
    }

    const res = await fetch(`${API_BASE}/api/workspace/files/${encodeURIComponent(path)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: fileContent }),
      keepalive: options?.keepalive ?? false,
    })

    if (res.ok) {
      store.markFileClean(path)
      refreshWorkspaceStatus()
      return true
    }
    return false
  } catch (err) {
    console.error('Failed to save file:', err)
    return false
  } finally {
    store.setIsSaving(false)
  }
}
