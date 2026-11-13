import { useEditorStore } from '../stores/editorStore'
import { toast } from '../stores/toastStore'
import { refuseWhileAiBusy } from './aiRunGuard'

// The backend resolves file paths against the active workspace. Once it switches,
// the open file's relative path points into the new workspace, so a save in that
// window writes (or creates) a same-named file there.

/** Run before asking the backend to change the active workspace. False = do not switch. */
export async function prepareWorkspaceSwitch(): Promise<boolean> {
  if (refuseWhileAiBusy()) return false
  const save = useEditorStore.getState().saveActiveFile
  if (save && !(await save())) {
    toast.error('Could not save the open file, so the workspace was not switched.')
    return false
  }
  return true
}

/** Run as soon as the backend has switched: no save may target the old file path now. */
export function detachOpenFile(): void {
  const store = useEditorStore.getState()
  store.editor?.commands.clearAiHighlight()
  store.setAiPendingEdit(null)
  store.setCurrentFilePath(null)
  store.setContent('')
}
