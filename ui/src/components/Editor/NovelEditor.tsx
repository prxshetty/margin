import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { createPortal } from 'react-dom'
import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { useEditorStore } from '../../stores/editorStore'
import { useEffect, useRef, useState } from 'react'
import { Markdown } from 'tiptap-markdown'
import { WritingBubbleMenu } from './WritingBubbleMenu'
import { MarginImage } from './MarginImage'
import { SlashMenuView, computeSlash } from './SlashMenu'
import type { SlashMenuHandle } from './SlashMenu'
import { AiDiffHighlightExtension } from './AiDiffHighlightExtension'
import { reapplyHarnessHighlight } from '../../lib/applyHarnessResult'
import {
  captureAnchorAfterDispatch,
  createPositionTracker,
  importImageFromUrl,
  insertStoredImage,
  insertStoredImageAt,
  isBareImageUrl,
  isImageFile,
  uploadImageFile,
} from '../../lib/media'
import type { PositionTracker } from '../../lib/media'
import { EditorState } from '@tiptap/pm/state'

interface SlashState {
  query: string
  range: { from: number; to: number }
}

// Upload pasted/dropped image files, inserting each stored asset in turn.
async function handleImageFiles(editor: Editor, files: File[]): Promise<void> {
  for (const file of files) {
    try {
      const path = await uploadImageFile(file)
      insertStoredImage(editor, path, file.name.replace(/\.[^.]+$/, ''))
    } catch (err) {
      window.alert(`Image upload failed: ${err instanceof Error ? err.message : err}`)
    }
  }
}

// A bare image URL pasted on its own keeps its link text (linkOnPaste
// linkifies the native paste) while the image is downloaded into
// workspace/assets/ and inserted on its own paragraph below. The download is
// async, so the insert anchors to the paste point — tracked forward through
// every intervening transaction — never to the live cursor.
async function handleBareImageUrl(
  editor: Editor,
  url: string,
  trackers: Set<PositionTracker>,
): Promise<void> {
  const pastedUrl = url.trim()
  const fileAtPaste = useEditorStore.getState().currentFilePath
  // Start both immediately: the anchor resolves on the paste transaction,
  // the download whenever the backend finishes.
  const anchorPromise = captureAnchorAfterDispatch(editor)
  const download = importImageFromUrl(pastedUrl).catch((err) => {
    // Quiet for users (their link text already pasted fine), traceable for us.
    console.warn(`Margin: image download failed for ${pastedUrl}:`, err)
    return null
  })
  const [anchor, path] = await Promise.all([anchorPromise, download])
  if (anchor == null || path == null) return

  const tracker = createPositionTracker(editor, anchor)
  trackers.add(tracker)
  try {
    // Doc swapped under us (file switch rebuilds EditorState from scratch,
    // invalidating every position) → drop rather than insert into the
    // wrong document.
    if (useEditorStore.getState().currentFilePath !== fileAtPaste) {
      console.warn('Margin: paste target file changed mid-download — dropping image')
      return
    }
    const tracked = tracker.get()
    if (tracked == null) return
    // Guard: the pasted link must still be near the anchor. Known accepted
    // edge — pasting the *same* URL twice makes this presence check pass
    // even if one instance was deleted; worst case the image lands next to
    // its twin, so not worth distinguishing.
    const contextStart = Math.max(0, tracked - 200)
    const contextEnd = Math.min(tracked, editor.state.doc.content.size)
    if (!editor.state.doc.textBetween(contextStart, contextEnd, ' ').includes(pastedUrl)) {
      console.warn('Margin: pasted link no longer at anchor — dropping image')
      return
    }
    insertStoredImageAt(editor, tracked, path)
  } finally {
    tracker.stop()
    trackers.delete(tracker)
  }
}

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
  const editorRef = useRef<Editor | null>(null)
  const slashRef = useRef<SlashMenuHandle>(null)
  const [slash, setSlash] = useState<SlashState | null>(null)
  const slashElRef = useRef<HTMLDivElement | null>(null)
  // Live async-insert trackers (paste-URL downloads in flight). Drained on
  // unmount so no `transaction` listener outlives the editor.
  const trackersRef = useRef<Set<PositionTracker>>(new Set())

  useEffect(() => {
    const live = trackersRef.current
    return () => {
      live.forEach((t) => t.stop())
      live.clear()
    }
  }, [])

  const refreshSlash = (editor: Editor) => {
    const found = computeSlash(editor)
    if (!found) {
      setSlash((prev) => (prev === null ? prev : null))
      return
    }
    setSlash((prev) => {
      if (
        prev &&
        prev.query === found.query &&
        prev.range.from === found.range.from &&
        prev.range.to === found.range.to
      ) {
        return prev
      }
      return found
    })
  }

  const editor = useEditor({
    extensions: [
      StarterKit,
      MarginImage,
      Link.configure({
        openOnClick: false,
        // Select the whole link on plain click AND mark the event handled so
        // ProseMirror preventDefaults — otherwise the browser natively
        // follows the href (the plugin returns false when both this and
        // openOnClick are off). Bonus: the bubble opens with the URL
        // prefilled, ready to edit. Cmd/Ctrl+click still opens via our
        // handleClick below (editorProps run before plugin handlers).
        enableClickSelection: true,
        autolink: true,
        defaultProtocol: 'https',
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
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
      const markdownStorage = (editor.storage as any).markdown as { getMarkdown: () => string }
      if (markdownStorage) {
        const newMarkdown = markdownStorage.getMarkdown()
        lastContentRef.current = newMarkdown
        setContent(newMarkdown)
      }
      refreshSlash(editor)
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
      refreshSlash(editor)
    },
    editorProps: {
      attributes: {
        class: 'prose prose-slate relative max-w-none focus:outline-none min-h-[500px] px-8 py-6',
      },
      handleKeyDown: (_view, event) => {
        if (slashRef.current?.onKeyDown(event)) return true
        return false
      },
      // Writing-app convention (Notion/Obsidian/VS Code): plain clicks only
      // move the cursor — following a link requires Cmd (macOS) / Ctrl.
      // Direct opens would yank focus and fight autosave mid-draft.
      handleClick: (view, pos, event) => {
        if (!event.metaKey && !event.ctrlKey) return false
        const $pos = view.state.doc.resolve(Math.min(pos, view.state.doc.content.size))
        const link = $pos.marks().find((m) => m.type.name === 'link')
        const href = link?.attrs.href as string | undefined
        if (!href || !/^(https?:|mailto:)/i.test(href)) return false
        event.preventDefault()
        window.open(href, '_blank', 'noopener,noreferrer')
        return true
      },
      handlePaste: (_view, event) => {
        const editor = editorRef.current
        if (!editor) return false
        const files = Array.from(event.clipboardData?.files ?? []).filter(isImageFile)
        if (files.length > 0) {
          event.preventDefault()
          void handleImageFiles(editor, files)
          return true
        }
        const text = event.clipboardData?.getData('text/plain') ?? ''
        if (isBareImageUrl(text)) {
          // Let the native paste land the link text (linkOnPaste linkifies
          // it); the image follows below once downloaded. Returning false
          // keeps the default paste behavior intact.
          void handleBareImageUrl(editor, text, trackersRef.current)
          return false
        }
        return false
      },
      handleDrop: (_view, event) => {
        const editor = editorRef.current
        if (!editor) return false
        const files = Array.from(event.dataTransfer?.files ?? []).filter(isImageFile)
        if (files.length === 0) return false
        event.preventDefault()
        void handleImageFiles(editor, files)
        return true
      },
    },
  })

  useEffect(() => {
    if (editor) {
      setEditor(editor)
      editorRef.current = editor
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

  // Floating-UI positioning for the slash menu: flips above the cursor near
  // the viewport bottom, shifts inside horizontal edges, constrains height
  // to available space, and repositions on scroll/resize via autoUpdate.
  // Coordinates are re-read from the live cursor on every update (not cached
  // in state) so the menu tracks while the query is typed.
  useEffect(() => {
    if (!editor || !slash) return
    const el = slashElRef.current
    if (!el) return
    const anchor = {
      getBoundingClientRect: () => {
        try {
          const c = editor.view.coordsAtPos(slash.range.to)
          return {
            x: c.left, y: c.bottom, width: 0, height: 0,
            top: c.bottom, left: c.left, bottom: c.bottom, right: c.left,
            toJSON: () => ({}),
          } as DOMRect
        } catch {
          return new DOMRect(-9999, -9999, 0, 0)
        }
      },
    }
    const update = () => {
      void computePosition(anchor, el, {
        placement: 'bottom-start',
        middleware: [
          offset(6),
          flip({ padding: 8 }),
          shift({ padding: 8 }),
          size({
            padding: 8,
            apply({ availableHeight, elements }) {
              elements.floating.style.maxHeight = `${Math.max(160, Math.min(320, availableHeight))}px`
            },
          }),
        ],
      }).then(({ x, y }) => {
        el.style.left = `${x}px`
        el.style.top = `${y}px`
      })
    }
    update()
    return autoUpdate(anchor, el, update)
  }, [editor, slash])

  return (
    <div className="bg-[var(--bg)] relative">
      <EditorContent editor={editor} />
      {showInlinePopup && <WritingBubbleMenu />}
      {editor && slash && createPortal(
        <div
          ref={slashElRef}
          className="fixed left-0 top-0 z-[10001]"
        >
          <SlashMenuView
            ref={slashRef}
            editor={editor}
            query={slash.query}
            range={slash.range}
          />
        </div>,
        document.body,
      )}
    </div>
  )
}
