import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEditorStore } from '../../stores/editorStore'
import { useEffect } from 'react'
import { Markdown } from 'tiptap-markdown'
// We would ideally use `novel` components like EditorRoot, EditorContent from 'novel' here.
// Since Tiptap/Novel setups can be complex and require styles, we'll use a basic Tiptap setup 
// as a placeholder until the exact Novel config is confirmed.

export function NovelEditor() {
  const { content, setContent, setEditor, setSelectedText, setSelectionRange } = useEditorStore()

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({
        html: false, // Don't preserve raw HTML tags, serialize/deserialize as clean Markdown
        tightLists: true,
      })
    ],
    content: content,
    onUpdate: ({ editor }) => {
      // Autosave content as raw Markdown instead of HTML
      setContent(editor.storage.markdown.getMarkdown())
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to, empty } = editor.state.selection
      if (empty) {
        setSelectedText('')
        setSelectionRange(null)
      } else {
        const text = editor.state.doc.textBetween(from, to, ' ')
        setSelectedText(text)
        setSelectionRange({ from, to })
      }
    },
    editorProps: {
      attributes: {
        class: 'prose prose-slate max-w-none focus:outline-none min-h-[500px] px-8 py-6',
      },
    },
  })

  useEffect(() => {
    if (editor) {
      setEditor(editor)
    }
  }, [editor, setEditor])

  // Sync state content to editor if streaming
  useEffect(() => {
    if (editor) {
      const currentMarkdown = editor.storage.markdown.getMarkdown()
      if (currentMarkdown !== content) {
        editor.commands.setContent(content)
      }
    }
  }, [content, editor])

  return (
    <div className="bg-white overflow-hidden">
      <EditorContent editor={editor} />
    </div>
  )
}
