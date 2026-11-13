import { API_BASE } from './api'
import { useEditorStore, type FileEntry } from '../stores/editorStore'
import { normalizeMarkdownText } from './workspaceStatus'

// Full sync of the sidebar file list after harness file activity: fetches
// the workspace listing, adds anything new and removes anything deleted on
// disk (the agent deletes via shell, so deletions never arrive as structured
// path events). Debounced so a burst of agent writes triggers one fetch.
//
// The open file's entry is never touched: its originalContent is what the
// skip-if-clean save guard compares against, so blanking it makes the pre-run
// editor text look dirty and the next blur save writes it over the agent's
// changes. Its result is merged by applyHarnessResult at harness_done.
// Other files the agent may have changed are marked unloaded (when they hold
// no unsaved text) so opening one re-fetches it from disk.
let timer: ReturnType<typeof setTimeout> | null = null

interface ListedFile {
  name: string
  path: string
  deleted?: boolean
  tracked?: boolean
}

function isClean(f: FileEntry): boolean {
  return normalizeMarkdownText(f.content || '') === normalizeMarkdownText(f.originalContent || '')
}

/** Pure merge of a workspace listing into the cached file entries. */
export function mergeFileListing(
  openedFiles: FileEntry[],
  listing: ListedFile[],
  activePath: string | null
): FileEntry[] {
  const listed = new Map(listing.map((f) => [f.path, f]))
  const known = new Set(openedFiles.map((f) => f.path))

  const kept = openedFiles
    // prompts/ entries are not part of the workspace listing
    .filter((f) => listed.has(f.path) || f.path === activePath || f.path.startsWith('prompts/'))
    .map((f) => {
      const l = listed.get(f.path)
      if (!l) return f
      // Deletions in a git workspace stay listed as tombstones; carry the flags across.
      const flags = {
        deleted: Boolean(l.deleted),
        tracked: l.tracked !== undefined ? Boolean(l.tracked) : f.tracked,
      }
      if (f.path === activePath || !isClean(f)) return { ...f, ...flags }
      return { ...f, ...flags, content: '', originalContent: '' }
    })
  const added = listing
    .filter((f) => !known.has(f.path))
    .map((f) => ({
      name: f.name,
      path: f.path,
      content: '',
      originalContent: '',
      deleted: Boolean(f.deleted),
      tracked: f.tracked !== undefined ? Boolean(f.tracked) : true,
    }))
  return [...kept, ...added]
}

export function scheduleFileRefresh(delayMs = 500) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    timer = null
    try {
      const res = await fetch(`${API_BASE}/api/workspace/files`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) return
      const listing: ListedFile[] = await res.json()
      const { openedFiles, currentFilePath, setOpenedFiles, removeFile } = useEditorStore.getState()
      const merged = mergeFileListing(openedFiles, listing, currentFilePath)
      const remaining = new Set(merged.map((f) => f.path))
      setOpenedFiles(merged)
      // removeFile also drops the manifest-issue entry of a deleted file
      for (const f of openedFiles) if (!remaining.has(f.path)) removeFile(f.path)
    } catch (err) {
      // Next tool event or harness_done retries.
      console.warn('Sidebar refresh after harness activity failed:', err)
    }
  }, delayMs)
}
