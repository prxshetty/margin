import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEditorStore } from '../../stores/editorStore'
import { useEffect } from 'react'
// We would ideally use `novel` components like EditorRoot, EditorContent from 'novel' here.
// Since Tiptap/Novel setups can be complex and require styles, we'll use a basic Tiptap setup 
// as a placeholder until the exact Novel config is confirmed.

export function NovelEditor() {
  const { content, setContent } = useEditorStore()

  const editor = useEditor({
    extensions: [StarterKit],
    content: content,
    onUpdate: ({ editor }) => {
      // Autosave content here eventually
      setContent(editor.getHTML())
    },
    editorProps: {
      attributes: {
        class: 'prose prose-slate max-w-none focus:outline-none min-h-[500px] px-8 py-6',
      },
    },
  })

  // Sync state content to editor if streaming
  useEffect(() => {
    if (editor && editor.getHTML() !== content) {
      editor.commands.setContent(content)
    }
  }, [content, editor])

  return (
    <div className="bg-white overflow-hidden">
      <EditorContent editor={editor} />
    </div>
  )
}
