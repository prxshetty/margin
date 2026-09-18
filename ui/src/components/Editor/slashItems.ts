import type { Editor } from '@tiptap/core'
import { ImagePlus, Sparkles, type LucideIcon } from 'lucide-react'
import { insertStoredImage, uploadImageFile } from '../../lib/media'
import { useEditorStore } from '../../stores/editorStore'
import { useImageGenStore } from '../../stores/imageGenStore'

export interface SlashCtx {
  editor: Editor
  range: { from: number; to: number }
}

export interface SlashItem {
  id: string
  label: string
  hint: string
  icon: LucideIcon
  keywords: string
  run: (ctx: SlashCtx) => void
}

function pickAndUpload(editor: Editor) {
  const fileAtPick = useEditorStore.getState().currentFilePath
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/png,image/jpeg,image/webp,image/gif'
  input.multiple = true
  input.onchange = async () => {
    const files = Array.from(input.files ?? [])
    for (const file of files) {
      try {
        const path = await uploadImageFile(file)
        // Same invariant as paste-URL imports: never insert into a
        // document the user has since switched away from.
        if (editor.isDestroyed) return
        if (useEditorStore.getState().currentFilePath !== fileAtPick) {
          console.warn('Margin: upload target file changed mid-upload — dropping image')
          return
        }
        insertStoredImage(editor, path, file.name.replace(/\.[^.]+$/, ''))
      } catch (err) {
        window.alert(`Image upload failed: ${err instanceof Error ? err.message : err}`)
      }
    }
  }
  input.click()
}

// Extensible item registry: add future entries here (each with label,
// hint, icon, keywords, run) and they appear in the menu with no further
// wiring. Image upload is currently the only entry — pasted image URLs
// already import via the paste path, so no URL mode is needed.
export const ITEMS: SlashItem[] = [
  {
    id: 'upload', label: 'Upload image', hint: 'Save to workspace assets', icon: ImagePlus, keywords: 'upload image picture photo asset file',
    run: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      pickAndUpload(editor)
    },
  },
  {
    id: 'generate', label: 'Generate image', hint: 'AI create from prompt', icon: Sparkles, keywords: 'generate imagine create picture ai art',
    run: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      const anchor = editor.state.selection.to
      useImageGenStore.getState().openDialog({
        initialPrompt: '',
        referenceSrc: null,
        anchorPos: anchor,
        regenNodePos: null,
      })
    },
  },
]
