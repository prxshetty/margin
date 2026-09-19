import { create } from 'zustand'

export interface ImageGenDialogState {
  /** Initial prompt (empty for the slash entry). */
  initialPrompt: string
  /** Document position anchor for the insert (cursor). */
  anchorPos: number | null
}

interface ImageGenStore {
  dialog: ImageGenDialogState | null
  openDialog: (dialog: ImageGenDialogState) => void
  closeDialog: () => void
}

export const useImageGenStore = create<ImageGenStore>((set) => ({
  dialog: null,
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
}))
