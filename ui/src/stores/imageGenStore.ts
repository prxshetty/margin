import { create } from 'zustand'

export interface ImageGenDialogState {
  /** Initial prompt (selection / alt / empty). */
  initialPrompt: string
  /** Existing asset path when regenerating; null for fresh generates. */
  referenceSrc: string | null
  /** Document position anchor for fresh inserts (selection end / cursor). */
  anchorPos: number | null
  /** Node position for src-only regen swaps. */
  regenNodePos: number | null
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
