/**
 * Editor-level round-trips through the real tiptap-markdown 0.9.0 pipeline:
 * markdown string → doc attrs → markdown string. This is the wiring that
 * cannot be verified from the pure syntax module alone (custom
 * `storage.markdown.serialize`, per-attribute `parseHTML`, `updateDOM`).
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Editor as EditorType } from '@tiptap/core'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { MarginImage } from './MarginImage'

// jsdom has no rAF; ProseMirror schedules through it.
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

describe('MarginImage markdown round-trip', () => {
  it('round-trips a plain image byte-identically', () => {
    const editor = createEditor()
    editor.commands.setContent('![Cat](assets/cat.png "Cute cat")')
    expect(imageAttrs(editor)).toMatchObject({ alt: 'Cat', src: 'assets/cat.png', title: 'Cute cat' })
    expect(getMarkdown(editor)).toBe('![Cat](assets/cat.png "Cute cat")')
  })

  it('preserves width through save/reload', () => {
    const editor = createEditor()
    editor.commands.setContent('![Cat|600](assets/cat.png "Cute cat")')
    expect(imageAttrs(editor)).toMatchObject({ alt: 'Cat', width: 600, height: null })
    expect(getMarkdown(editor)).toBe('![Cat|600](assets/cat.png "Cute cat")')
  })

  it('preserves width, height, and alignment together', () => {
    const editor = createEditor()
    editor.commands.setContent('![Cat|600x450](assets/cat.png){align=right}')
    expect(imageAttrs(editor)).toMatchObject({ width: 600, height: 450, align: 'right' })
    expect(getMarkdown(editor)).toBe('![Cat|600x450](assets/cat.png){align=right}')
  })

  it('normalizes invalid dimensions to a natural-size image', () => {
    const editor = createEditor()
    editor.commands.setContent('![a|0](assets/x.png)')
    expect(imageAttrs(editor)).toMatchObject({ alt: 'a', width: null, height: null })
    expect(getMarkdown(editor)).toBe('![a](assets/x.png)')
  })

  it('keeps literal pipes in alt text', () => {
    const editor = createEditor()
    editor.commands.setContent('![a|b](assets/x.png)')
    expect(imageAttrs(editor)).toMatchObject({ alt: 'a|b', width: null })
    expect(getMarkdown(editor)).toBe('![a|b](assets/x.png)')
  })

  it('persists a resize commit (attr update) into Markdown, and reset clears it', () => {
    const editor = createEditor()
    editor.commands.setContent('![Cat](assets/cat.png)')
    editor.chain().setNodeSelection(imagePos(editor)).updateAttributes('image', { width: 640 }).run()
    expect(getMarkdown(editor)).toBe('![Cat|640](assets/cat.png)')
    editor.chain().setNodeSelection(imagePos(editor)).updateAttributes('image', { width: null, height: null }).run()
    expect(getMarkdown(editor)).toBe('![Cat](assets/cat.png)')
  })

  it('persists alignment changes, and toggling back to default drops the suffix', () => {
    const editor = createEditor()
    editor.commands.setContent('![Cat](assets/cat.png)')
    editor.chain().setNodeSelection(imagePos(editor)).updateAttributes('image', { align: 'left' }).run()
    expect(getMarkdown(editor)).toBe('![Cat](assets/cat.png){align=left}')
    editor.chain().setNodeSelection(imagePos(editor)).updateAttributes('image', { align: null }).run()
    expect(getMarkdown(editor)).toBe('![Cat](assets/cat.png)')
  })

  it('never destroys the Markdown of a missing asset', () => {
    const editor = createEditor()
    editor.commands.setContent('![Cat](assets/does-not-exist.png "gone")')
    expect(getMarkdown(editor)).toBe('![Cat](assets/does-not-exist.png "gone")')
  })
})
