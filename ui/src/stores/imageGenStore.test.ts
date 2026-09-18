import { describe, expect, it } from 'vitest'
import { useImageGenStore } from './imageGenStore'

describe('imageGenStore', () => {
  it('opens and closes the generation dialog', () => {
    const { openDialog, closeDialog } = useImageGenStore.getState()
    expect(useImageGenStore.getState().dialog).toBeNull()
    openDialog({ initialPrompt: 'a cabin', referenceSrc: null, anchorPos: 5, regenNodePos: null })
    expect(useImageGenStore.getState().dialog).toMatchObject({
      initialPrompt: 'a cabin',
      referenceSrc: null,
      anchorPos: 5,
    })
    closeDialog()
    expect(useImageGenStore.getState().dialog).toBeNull()
  })

  it('carries the reference src for regeneration', () => {
    const { openDialog, closeDialog } = useImageGenStore.getState()
    openDialog({ initialPrompt: '', referenceSrc: 'assets/generated/a.png', anchorPos: null, regenNodePos: 3 })
    expect(useImageGenStore.getState().dialog?.referenceSrc).toBe('assets/generated/a.png')
    closeDialog()
  })
})
