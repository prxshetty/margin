import type { Editor } from '@tiptap/core'

/** Block-start `/query` state, Notion-style: only inside empty-ish paragraphs. */
export function computeSlash(editor: Editor): { query: string; range: { from: number; to: number } } | null {
  const { empty, from } = editor.state.selection
  if (!empty) return null
  const $from = editor.state.selection.$from
  if ($from.parent.type.name !== 'paragraph') return null
  const blockStart = $from.start()
  const line = editor.state.doc.textBetween(blockStart, from, ' ')
  const m = /^\/([\w\- ]*)$/.exec(line)
  if (!m) return null
  return { query: m[1].toLowerCase(), range: { from: blockStart, to: from } }
}
