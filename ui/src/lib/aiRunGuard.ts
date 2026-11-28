import { useEditorStore } from '../stores/editorStore'
import { toast } from '../stores/toastStore'

// An AI edit run snapshots the open file's text when it starts and applies its
// result to the editor when it ends. If the open file changes in between, the
// result and the snapshot belong to a different file than the one on screen,
// and the next save writes one chapter's text into another. These helpers tie a
// run to the file it started on.

export interface AiRunHandle {
  path: string | null
}

/** Mark a run as started on the open file. Pair with endAiRun in a finally block. */
export function beginAiRun(): AiRunHandle {
  const handle = { path: useEditorStore.getState().currentFilePath }
  useEditorStore.getState().setAiRun(handle)
  return handle
}

/** Clear the run, unless a newer run has replaced it. */
export function endAiRun(handle: AiRunHandle): void {
  if (useEditorStore.getState().aiRun === handle) useEditorStore.getState().setAiRun(null)
}

/** True while the editor still shows the file the run started on. */
export function isOnRunFile(handle: AiRunHandle): boolean {
  return useEditorStore.getState().currentFilePath === handle.path
}

/**
 * Refuse to change the open file (or workspace) while an AI edit runs or a harness
 * review awaits Accept/Reject. Returns true, and tells the user, when it must not happen.
 *
 * A pending harness review blocks too: the agent's version is already on disk and the
 * editor holds the merge. Leaving would need the review's own reject (which keeps the
 * user's in-run edits); reverting to the pre-run snapshot instead loses them, and caching
 * that snapshot later overwrites the agent's version.
 */
export function refuseWhileAiBusy(): boolean {
  const { aiRun, aiPendingEdit, currentFilePath } = useEditorStore.getState()
  if (aiRun) {
    toast.info('Wait for the AI edit to finish, or stop it, before switching files.')
    return true
  }
  if (aiPendingEdit?.harness && aiPendingEdit.filePath === currentFilePath) {
    toast.info('Accept or reject the AI changes before leaving this file.')
    return true
  }
  return false
}

/**
 * Text to save for `path`, or null when nothing may be saved right now.
 *
 * - Endpoint preview for this file: its pre-AI text (the disk still holds it).
 * - Harness review for this file: null. The agent already wrote its version to disk;
 *   saving the pre-run snapshot would silently undo it. Accept/Reject decide what is saved.
 * - Otherwise (including a preview that belongs to another file): the editor text.
 */
export function savableContent(path: string): string | null {
  const { aiPendingEdit, content } = useEditorStore.getState()
  if (!aiPendingEdit || aiPendingEdit.filePath !== path) return content
  return aiPendingEdit.harness ? null : aiPendingEdit.previousContent
}
