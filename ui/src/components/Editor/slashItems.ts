import type { ComponentType } from 'react'
import type { Editor } from '@tiptap/core'
import { insertStoredImage, uploadImageFile } from '../../lib/media'
import { useEditorStore } from '../../stores/editorStore'
import { useImageGenStore } from '../../stores/imageGenStore'
import { toast } from '../../stores/toastStore'
import { ImagineIcon, UploadIcon } from '../icons/BrandIcons'

export interface SlashCtx {
  editor: Editor
  range: { from: number; to: number }
}

export interface SlashItem {
  id: string
  label: string
  hint: string
  icon: ComponentType<{ className?: string }>
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
        toast.error(`Image upload failed: ${err instanceof Error ? err.message : err}`)
      }
    }
  }
  input.click()
}

// Extensible item registry: add future entries here (each with label,
// hint, icon, keywords, run) and they appear in the menu with no further
// wiring. Pasted image URLs already import via the paste path, so no URL
// mode is needed.
export const ITEMS: SlashItem[] = [
  {
    id: 'upload', label: 'Upload image', hint: 'PNG · JPG · GIF · WebP', icon: UploadIcon, keywords: 'upload image picture photo asset file png jpg gif webp',
    run: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      pickAndUpload(editor)
    },
  },
  {
    id: 'generate', label: 'Imagine', hint: 'Image from words', icon: ImagineIcon, keywords: 'generate imagine create picture ai art',
    run: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      const anchor = editor.state.selection.to
      useImageGenStore.getState().openDialog({
        initialPrompt: '',
        anchorPos: anchor,
      })
    },
  },
]
