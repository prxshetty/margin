import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEditorStore } from '../../stores/editorStore'
import { useProjectStore } from '../../stores/projectStore'
import { useEffect, useRef } from 'react'
import { Markdown } from 'tiptap-markdown'
import { InlineSelectionPopup } from './InlineSelectionPopup'
import { getDocPath } from '../../lib/docInfo'

export function NovelEditor({ showInlinePopup = true }: { showInlinePopup?: boolean }) {
  const content = useEditorStore(state => state.content)
  const setContent = useEditorStore(state => state.setContent)
  const setEditor = useEditorStore(state => state.setEditor)
  const setSelectedText = useEditorStore(state => state.setSelectedText)
  const setSelectionRange = useEditorStore(state => state.setSelectionRange)
  const setAnchorPosition = useEditorStore(state => state.setAnchorPosition)
  const setActiveContextPath = useEditorStore(state => state.setActiveContextPath)
  const { activeDoc, activeSceneId, activeChapterId, sceneViewMode, currentBeatIndex } = useProjectStore()
  const lastContentRef = useRef('')
  // Flag: true while we are programmatically calling setContent so onUpdate
  // doesn't echo the change back into Zustand and cause an infinite loop.
  const isProgrammaticUpdateRef = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({
        html: false,
        tightLists: true,
      })
    ],
    // Feed raw markdown — the Markdown extension parses it natively
    content: content || '',
    onUpdate: ({ editor }) => {
      // Only propagate changes that come from the USER typing, not from us.
      if (isProgrammaticUpdateRef.current) return
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
      setActiveContextPath(resolveContextPath())
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
      setActiveContextPath(resolveContextPath())
    }
  }, [editor, setEditor, activeDoc, activeSceneId, activeChapterId, sceneViewMode, currentBeatIndex])

  const resolveContextPath = () => {
    if (activeDoc?.type === 'scene') {
      if (sceneViewMode === 'content') return `scenes/${activeSceneId || activeDoc.sceneId}/prose`
      return `scenes/${activeSceneId || activeDoc.sceneId}/beats/${currentBeatIndex + 1}`
    }
    return getDocPath(activeDoc, activeSceneId, activeChapterId) || null
  }

  // Sync external content changes (e.g. doc switch, streaming) into the editor.
  // Pass raw markdown — tiptap-markdown parses it, no html intermediary needed.
  useEffect(() => {
    if (editor && content !== undefined) {
      if (content !== lastContentRef.current) {
        lastContentRef.current = content
        isProgrammaticUpdateRef.current = true
        editor.commands.setContent(content || '', { contentType: 'markdown' } as any)
        // ProseMirror dispatches synchronously so we reset immediately.
        isProgrammaticUpdateRef.current = false
      }
    }
  }, [content, editor])

  return (
    <div className="bg-[var(--bg)] relative">
      <EditorContent editor={editor} />
      {showInlinePopup && <InlineSelectionPopup localEditor={editor} />}
    </div>
  )
}
