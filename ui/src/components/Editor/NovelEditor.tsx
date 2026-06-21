import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEditorStore } from '../../stores/editorStore'
import { useEffect, useRef } from 'react'
import { Markdown } from 'tiptap-markdown'
import { SimpleAssistSelectionPopup } from './SimpleAssistSelectionPopup'
import { AiDiffHighlightExtension } from './AiDiffHighlightExtension'
import { EditorState } from '@tiptap/pm/state'

export function NovelEditor({ showInlinePopup = true }: { showInlinePopup?: boolean }) {
  const content = useEditorStore(state => state.content)
  const setContent = useEditorStore(state => state.setContent)
  const setEditor = useEditorStore(state => state.setEditor)
  const setSelectedText = useEditorStore(state => state.setSelectedText)
  const setSelectionRange = useEditorStore(state => state.setSelectionRange)
  const setAnchorPosition = useEditorStore(state => state.setAnchorPosition)
  const aiPendingEdit = useEditorStore(state => state.aiPendingEdit)
  const setAiPendingEdit = useEditorStore(state => state.setAiPendingEdit)
  const lastContentRef = useRef('')
  // Flag: true while we are programmatically calling setContent so onUpdate
  // doesn't echo the change back into Zustand and cause an infinite loop.
  const isProgrammaticUpdateRef = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({ html: false, tightLists: true }),
      AiDiffHighlightExtension,
    ],
    // Feed raw markdown — the Markdown extension parses it natively
    content: content || '',
    onUpdate: ({ editor }) => {
      // Only propagate changes that come from the USER typing, not from us.
      if (isProgrammaticUpdateRef.current) return

      // Auto-accept AI edits if the user types
      if (aiPendingEdit) {
        setAiPendingEdit(null)
        isProgrammaticUpdateRef.current = true
        editor.commands.clearAiHighlight()
        isProgrammaticUpdateRef.current = false
      }

      if ((editor.storage as any)?.markdown) {
        const newMarkdown = (editor.storage as any).markdown.getMarkdown()
        lastContentRef.current = newMarkdown
        setContent(newMarkdown)
      }
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to, empty } = editor.state.selection
      setAnchorPosition(from)
      if (empty) {
        setSelectedText('')
        setSelectionRange(null)
      } else {
        const text = editor.state.doc.textBetween(from, to, ' ')
        setSelectedText(text)
        setSelectionRange({ from, to })
      }
    },
    onFocus: ({ editor }) => {
      setEditor(editor)
    },
    editorProps: {
      attributes: {
        class: 'prose prose-slate relative max-w-none focus:outline-none min-h-[500px] px-8 py-6',
      },
    },
  })

  useEffect(() => {
    if (editor) {
      setEditor(editor)
    }
  }, [editor, setEditor])

  // Sync external content changes (e.g. doc switch, streaming) into the editor.
  // Pass raw markdown — tiptap-markdown parses it, no html intermediary needed.
  useEffect(() => {
    if (editor && content !== undefined) {
      if (content !== lastContentRef.current) {
        lastContentRef.current = content
        isProgrammaticUpdateRef.current = true
        editor.commands.setContent(content || '')
        // prosemirror-history does not export clearHistory.
        // Rebuild a fresh EditorState with the same doc + plugins so every
        // plugin's state (including history) is reset to its initial value,
        // preventing Cmd+Z from time-travelling into prior file content.
        editor.view.updateState(
          EditorState.create({
            doc: editor.state.doc,
            schema: editor.state.schema,
            plugins: editor.state.plugins,
          })
        )
        isProgrammaticUpdateRef.current = false
      }
    }
  }, [content, editor])

  return (
    <div className="bg-[var(--bg)] relative">
      <EditorContent editor={editor} />
      {showInlinePopup && <SimpleAssistSelectionPopup />}
    </div>
  )
}
