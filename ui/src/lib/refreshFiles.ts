import { API_BASE } from './api'
import { useEditorStore } from '../stores/editorStore'

// Full sync of the sidebar file list after harness file activity: fetches
// the workspace listing, addFile()s anything new and removeFile()s anything
// deleted on disk (the agent deletes via shell, so deletions never arrive as
// structured path events). The store dedupes by path, and open-tab content is
// never touched here — a deleted open file is resolved by
// applyHarnessResult at harness_done. Debounced so a burst of agent writes
// triggers one fetch.
let timer: ReturnType<typeof setTimeout> | null = null

export function scheduleFileRefresh(delayMs = 500) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    timer = null
    try {
      const res = await fetch(`${API_BASE}/api/workspace/files`)
      if (!res.ok) return
      const files = await res.json()
      const { addFile, removeFile, openedFiles } = useEditorStore.getState()
      const seen = new Set<string>(files.map((f: { path: string }) => f.path))
      for (const file of files) addFile({ name: file.name, path: file.path, content: '', originalContent: '' })
      for (const open of openedFiles) {
        if (!seen.has(open.path)) removeFile(open.path)
      }
    } catch {
      // Next tool event or harness_done retries.
    }
  }, delayMs)
}
