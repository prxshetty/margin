import { afterEach, describe, expect, it } from 'vitest'
import type { Editor as EditorType } from '@tiptap/core'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { MarginImage } from './MarginImage'
import { ITEMS } from './slashItems'
import { closeHistory } from '@tiptap/pm/history'

if (typeof window !== 'undefined' && !window.requestAnimationFrame) {
  window.requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(cb, 0)
}

const editors: EditorType[] = []
afterEach(() => {
  while (editors.length) editors.pop()?.destroy()
})

function createEditor(): EditorType {
  const editor = new Editor({
    extensions: [
      StarterKit,
      MarginImage,
      Markdown.configure({ html: false, tightLists: true }),
    ],
    content: '',
  })
  editors.push(editor)
  return editor
}

function getMarkdown(editor: EditorType): string {
  const storage = editor.storage as unknown as { markdown: { getMarkdown: () => string } }
  return storage.markdown.getMarkdown().trim()
}

function imageAttrs(editor: EditorType): Record<string, unknown> {
  let found: Record<string, unknown> = {}
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'image') {
      found = { ...node.attrs }
      return false
    }
    return true
  })
  return found
}

function imagePos(editor: EditorType): number {
  let pos = -1
  editor.state.doc.descendants((node, p) => {
    if (node.type.name === 'image') {
      pos = p
      return false
    }
    return true
  })
  if (pos < 0) throw new Error('no image node found')
  return pos
}

describe('slash menu image entries', () => {
  it('exposes Upload + Generate image', () => {
    const ids = ITEMS.map((i) => i.id)
    expect(ids).toContain('upload')
    expect(ids).toContain('generate')
    const gen = ITEMS.find((i) => i.id === 'generate')!
    expect(gen.label).toMatch(/Generate image/)
    expect(`${gen.label} ${gen.keywords}`.toLowerCase()).toContain('imagine')
  })
})

describe('regeneration src-only swap', () => {
  it('changes only src, preserving width/height/align/caption', () => {
    const editor = createEditor()
    editor.commands.setContent('![Cabin|640](assets/generated/a.png "cap"){align=right}')
    editor.chain().setNodeSelection(imagePos(editor)).updateAttributes('image', {
      height: 480,
    }).run()
    const before = imageAttrs(editor)
    expect(before).toMatchObject({ width: 640, height: 480, align: 'right' })

    // The dialog's success path for regen: updateAttributes({ src }) only.
    // closeHistory separates the swap into its own undo event — in the app,
    // regen runs seconds after prior edits so ProseMirror groups it alone.
    editor.view.dispatch(closeHistory(editor.state.tr))
    editor.chain().setNodeSelection(imagePos(editor)).updateAttributes('image', {
      src: 'assets/generated/b.png',
    }).run()

    expect(imageAttrs(editor)).toMatchObject({
      alt: 'Cabin',
      src: 'assets/generated/b.png',
      title: 'cap',
      width: 640,
      height: 480,
      align: 'right',
    })
    expect(getMarkdown(editor)).toBe('![Cabin|640x480](assets/generated/b.png "cap"){align=right}')

    // Native history then restores the old src — old asset, no GC needed.
    editor.commands.undo()
    expect(imageAttrs(editor)).toMatchObject({ src: 'assets/generated/a.png' })
  })

  it('round-trips generated-asset paths byte-identically', () => {
    const editor = createEditor()
    editor.commands.setContent('![a prompt](assets/generated/7f0d4c6e.png)')
    expect(getMarkdown(editor)).toBe('![a prompt](assets/generated/7f0d4c6e.png)')
  })
})
