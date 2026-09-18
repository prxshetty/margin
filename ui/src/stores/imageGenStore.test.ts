import { describe, expect, it } from 'vitest'
import { useImageGenStore } from './imageGenStore'

describe('imageGenStore', () => {
  it('opens and closes the generation dialog', () => {
    const { openDialog, closeDialog } = useImageGenStore.getState()
    expect(useImageGenStore.getState().dialog).toBeNull()
    openDialog({ initialPrompt: '', anchorPos: 5 })
    expect(useImageGenStore.getState().dialog).toMatchObject({
      initialPrompt: '',
      anchorPos: 5,
    })
    closeDialog()
    expect(useImageGenStore.getState().dialog).toBeNull()
  })
})
