import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEditorStore } from '../../stores/editorStore'
import { useEffect, useRef } from 'react'
import { Markdown } from 'tiptap-markdown'
import { WritingBubbleMenu } from './WritingBubbleMenu'
import { AiDiffHighlightExtension } from './AiDiffHighlightExtension'
import { ActiveSelectionExtension } from './ActiveSelectionExtension'
import { ChangeHighlightExtension } from './ChangeHighlightExtension'
import { reapplyHarnessHighlight } from '../../lib/applyHarnessResult'
import { EditorState } from '@tiptap/pm/state'
import { useSettingsStore } from '../../stores/settingsStore'
import { saveCurrentFile } from '../../lib/saveFile'

export function NovelEditor({ showInlinePopup = true }: { showInlinePopup?: boolean }) {
  const content = useEditorStore(state => state.content)
  const setContent = useEditorStore(state => state.setContent)
  const setEditor = useEditorStore(state => state.setEditor)
  const setSelectedText = useEditorStore(state => state.setSelectedText)
  const setSelectionRange = useEditorStore(state => state.setSelectionRange)
  const setAnchorPosition = useEditorStore(state => state.setAnchorPosition)
  const aiPendingEdit = useEditorStore(state => state.aiPendingEdit)
  const setAiPendingEdit = useEditorStore(state => state.setAiPendingEdit)
  const diffBaseContent = useEditorStore(state => state.diffBaseContent)
  const documentShowAdditions = useEditorStore(state => state.documentShowAdditions)
  const documentShowDeletions = useEditorStore(state => state.documentShowDeletions)
  const showAdditions = useSettingsStore(state => state.settings?.show_additions)
  const showDeletions = useSettingsStore(state => state.settings?.show_deletions)
  const lastContentRef = useRef('')
  const autoSaveTimerRef = useRef<number | null>(null)
  // Flag: true while we are programmatically calling setContent so onUpdate
  // doesn't echo the change back into Zustand and cause an infinite loop.
  const isProgrammaticUpdateRef = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({ html: false, tightLists: true }),
      AiDiffHighlightExtension,
      ActiveSelectionExtension,
      ChangeHighlightExtension,
    ],
    // Feed raw markdown — the Markdown extension parses it natively
    content: content || '',
    onFocus: ({ editor }) => {
      if (useEditorStore.getState().isProgrammaticSelection) return
      editor.commands.clearPromptSelectionHighlight()
      const s = useEditorStore.getState()
      if (s.pendingEditSelection) {
        s.setPendingEditSelection(null)
      }
    },
    onBlur: () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
      saveCurrentFile()
    },
    onUpdate: ({ editor }) => {
      // Only propagate changes that come from the USER typing, not from us.
      if (isProgrammaticUpdateRef.current) return
      if (!editor.isFocused) return

      // Auto-accept AI edits only if the user actively types in the editor
      if (aiPendingEdit) {
        setAiPendingEdit(null)
        isProgrammaticUpdateRef.current = true
        editor.commands.clearAiHighlight()
        isProgrammaticUpdateRef.current = false
      }
      if (!useEditorStore.getState().isProgrammaticSelection && editor.isFocused) {
        editor.commands.clearPromptSelectionHighlight()
        const s = useEditorStore.getState()
        if (s.pendingEditSelection) {
          s.setPendingEditSelection(null)
        }
      }
      const markdownStorage = (editor.storage as any).markdown as { getMarkdown: () => string }
      if (markdownStorage) {
        const newMarkdown = markdownStorage.getMarkdown()
        lastContentRef.current = newMarkdown
        setContent(newMarkdown)
        const currentPath = useEditorStore.getState().currentFilePath
        if (currentPath) {
          useEditorStore.getState().updateFileContent(currentPath, newMarkdown)
        }

        // Debounced Idle Auto-Save (2000ms pause in typing)
        if (autoSaveTimerRef.current) {
          window.clearTimeout(autoSaveTimerRef.current)
        }
        autoSaveTimerRef.current = window.setTimeout(() => {
          saveCurrentFile()
        }, 2000)
      }
    },
    onSelectionUpdate: ({ editor }) => {
      if (!useEditorStore.getState().isProgrammaticSelection && editor.isFocused) {
        editor.commands.clearPromptSelectionHighlight()
        const s = useEditorStore.getState()
        if (s.pendingEditSelection) {
          s.setPendingEditSelection(null)
        }
      }
      const { from, to, empty } = editor.state.selection
      setAnchorPosition(from)
      const s = useEditorStore.getState()
      if (empty) {
        if (s.selectedText !== '') setSelectedText('')
        if (s.selectionRange !== null) setSelectionRange(null)
      } else {
        const text = editor.state.doc.textBetween(from, to, ' ')
        if (s.selectedText !== text) setSelectedText(text)
        if (!s.selectionRange || s.selectionRange.from !== from || s.selectionRange.to !== to) {
          setSelectionRange({ from, to })
        }
      }
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
        // The rebuild resets every plugin's state — a pending harness diff
        // highlight set just before this is wiped with it. Doc is unchanged,
        // so the same block positions re-apply cleanly.
        reapplyHarnessHighlight(editor)
        isProgrammaticUpdateRef.current = false
      }
    }
  }, [content, editor])

  // Refresh diff decorations when diffBaseContent, visibility toggles, or aiPendingEdit change
  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.view) {
      reapplyHarnessHighlight(editor)
      editor.view.dispatch(editor.state.tr)
    }
  }, [diffBaseContent, documentShowAdditions, documentShowDeletions, showAdditions, showDeletions, aiPendingEdit, editor])

  // Clean up autoSave timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current)
      }
    }
  }, [])

  return (
    <div className="bg-[var(--bg)] relative">
      <EditorContent editor={editor} />
      {showInlinePopup && <WritingBubbleMenu />}
    </div>
  )
}
