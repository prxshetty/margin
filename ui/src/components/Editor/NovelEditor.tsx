import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { createPortal } from 'react-dom'
import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom'
import StarterKit from '@tiptap/starter-kit'
import { useEditorStore } from '../../stores/editorStore'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Markdown } from 'tiptap-markdown'
import { WritingBubbleMenu } from './WritingBubbleMenu'
import { MarginImage } from './MarginImageExtension'
import { ImageGenerateDialogHost } from './ImageGenerateDialog'
import { SlashMenuView } from './SlashMenu'
import { computeSlash } from './slashQuery'
import type { SlashMenuHandle } from './SlashMenu'
import { AiDiffHighlightExtension } from './AiDiffHighlightExtension'
import { reapplyHarnessHighlight } from '../../lib/applyHarnessResult'
import {
  importImageFromUrl,
  insertStoredImage,
  insertStoredImageAt,
  isBareImageUrl,
  isImageFile,
  uploadImageFile,
} from '../../lib/media'
import { toast } from '../../stores/toastStore'
import { isManifestPath, validateManifestText } from '../../lib/manifestValidator'

interface MarkdownStorage {
  markdown?: {
    getMarkdown: () => string
  }
}

declare global {
  interface Window {
    __marginEditor?: Editor
  }
}

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
      toast.error(`Image upload failed: ${err instanceof Error ? err.message : err}`)
    }
  }
}

// A bare image URL pasted on its own keeps its pasted text while the image
// is downloaded into workspace/assets/ and inserted below. The download is
// async, so the caller passes the pre-paste selection as the anchor —
// `handlePaste` runs before the native paste transaction, so the live
// selection is still the paste point. No position tracking: if the user
// typed meanwhile the image may land slightly off, which is acceptable.
//
// File-switch guard: the originating document is identified by
// `currentFilePath`. If it changed mid-download, the asset is still stored
// but the insert is dropped — never into the wrong document.
async function handleBareImageUrl(
  editor: Editor,
  url: string,
  anchor: number,
): Promise<void> {
  const pastedUrl = url.trim()
  const fileAtPaste = useEditorStore.getState().currentFilePath
  const path = await importImageFromUrl(pastedUrl).catch((err) => {
    // Quiet for users (their pasted text is already in the doc), traceable.
    console.warn(`Margin: image download failed for ${pastedUrl}:`, err)
    return null
  })
  if (path == null) return
  if (editor.isDestroyed) return
  if (useEditorStore.getState().currentFilePath !== fileAtPaste) {
    console.warn('Margin: paste target file changed mid-download — dropping image')
    return
  }
  insertStoredImageAt(editor, anchor, path)
}

export function NovelEditor({
  showInlinePopup = true,
  onSave,
  isDirty = false,
}: {
  showInlinePopup?: boolean
  onSave?: () => Promise<boolean>
  isDirty?: boolean
}) {
  const content = useEditorStore(state => state.content)
  const setContent = useEditorStore(state => state.setContent)
  const setEditor = useEditorStore(state => state.setEditor)
  const setSelectedText = useEditorStore(state => state.setSelectedText)
  const setSelectionRange = useEditorStore(state => state.setSelectionRange)
  const setAnchorPosition = useEditorStore(state => state.setAnchorPosition)
  const aiPendingEdit = useEditorStore(state => state.aiPendingEdit)
  const setAiPendingEdit = useEditorStore(state => state.setAiPendingEdit)
  const currentFilePath = useEditorStore(state => state.currentFilePath)
  const fileStatusMap = useEditorStore(state => state.fileStatusMap)
  const currentStatus = currentFilePath ? fileStatusMap[currentFilePath] : undefined
  const isDeleted = currentStatus === 'staged_deleted' || currentStatus === 'unstaged_deleted'
  const lastContentRef = useRef('')
  const lastPathRef = useRef<string | null>(currentFilePath)
  // Flag: true while we are programmatically calling setContent or setEditable so onUpdate
  // doesn't echo the change back into Zustand and cause an infinite loop or overwrite content.
  const isProgrammaticUpdateRef = useRef(false)
  const editorRef = useRef<Editor | null>(null)
  const slashRef = useRef<SlashMenuHandle>(null)
  const [slash, setSlash] = useState<SlashState | null>(null)
  const slashElRef = useRef<HTMLDivElement | null>(null)

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushSave = useCallback(() => {
    if (onSave && isDirty) {
      onSave()
    }
  }, [onSave, isDirty])

  const scheduleDebouncedSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      flushSave()
      saveTimerRef.current = null
    }, 2000)
  }, [flushSave])

  const flushTimerPathRef = useRef(currentFilePath)
  useEffect(() => {
    if (currentFilePath !== flushTimerPathRef.current) {
      if (saveTimerRef.current) {
        flushSave()
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      flushTimerPathRef.current = currentFilePath
    }
  }, [currentFilePath, flushSave])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        flushSave()
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [flushSave])

  const refreshSlash = (editor: Editor) => {
    if (isDeleted) {
      setSlash(null)
      return
    }
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
    editable: !isDeleted,
    extensions: [
      StarterKit.configure({
        // Plain clicks open the link in a new tab (never a redirect away
        // from the editor). The click handler lives in the Link extension —
        // no editor-level override.
        link: {
          openOnClick: true,
          HTMLAttributes: {
            target: '_blank',
            rel: 'noopener noreferrer',
          },
        },
      }),
      MarginImage,
      Markdown.configure({ html: false, tightLists: true }),
      AiDiffHighlightExtension,
    ],
    // Feed raw markdown — the Markdown extension parses it natively
    content: content || '',
    onBlur: ({ editor }) => {
      if (isDirty) {
        flushSave()
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current)
          saveTimerRef.current = null
        }
      }
      const curPath = useEditorStore.getState().currentFilePath
      if (curPath && isManifestPath(curPath)) {
        const markdownStorage = (editor.storage as unknown as MarkdownStorage).markdown
        const text = markdownStorage ? markdownStorage.getMarkdown() : useEditorStore.getState().content
        const issues = validateManifestText(text)
        useEditorStore.getState().setManifestIssues(curPath, issues)
      }
    },
    onUpdate: ({ editor }) => {
      if (isDeleted || !editor.isEditable) return
      // Only propagate changes that come from the USER typing, not from us.
      if (isProgrammaticUpdateRef.current) return
      if (currentFilePath !== lastPathRef.current) return

      // Auto-accept AI edits if the user types
      if (aiPendingEdit) {
        setAiPendingEdit(null)
        isProgrammaticUpdateRef.current = true
        editor.commands.clearAiHighlight()
        isProgrammaticUpdateRef.current = false
      }
      const markdownStorage = (editor.storage as unknown as MarkdownStorage).markdown
      if (markdownStorage) {
        const newMarkdown = markdownStorage.getMarkdown()
        lastContentRef.current = newMarkdown
        setContent(newMarkdown)
      }
      if (!isProgrammaticUpdateRef.current) {
        scheduleDebouncedSave()
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
        if (isDeleted || !editorRef.current?.isEditable) return false
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          if (isDirty) {
            flushSave()
            if (saveTimerRef.current) {
              clearTimeout(saveTimerRef.current)
              saveTimerRef.current = null
            }
          }
          return true
        }
        if (slashRef.current?.onKeyDown(event)) return true
        return false
      },
      handlePaste: (_view, event) => {
        const editor = editorRef.current
        if (!editor || isDeleted || !editor.isEditable) return false
        const files = Array.from(event.clipboardData?.files ?? []).filter(isImageFile)
        if (files.length > 0) {
          event.preventDefault()
          void handleImageFiles(editor, files)
          return true
        }
        const text = event.clipboardData?.getData('text/plain') ?? ''
        if (isBareImageUrl(text)) {
          // Let the native paste land the URL text; the image follows below
          // once downloaded. Anchor is the pre-paste selection (this handler
          // runs before the native paste transaction is dispatched).
          void handleBareImageUrl(editor, text, editor.state.selection.to)
          return false
        }
        return false
      },
      handleDrop: (_view, event) => {
        const editor = editorRef.current
        if (!editor || isDeleted || !editor.isEditable) return false
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
      if (typeof window !== 'undefined') {
        window.__marginEditor = editor
      }
    }
  }, [editor, setEditor])

  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      isProgrammaticUpdateRef.current = true
      editor.setEditable(!isDeleted)
      isProgrammaticUpdateRef.current = false
    }
  }, [editor, isDeleted])

  // Sync external content changes (e.g. doc switch, streaming) into the editor.
  // Pass raw markdown — tiptap-markdown parses it, no html intermediary needed.
  useEffect(() => {
    if (editor && content !== undefined) {
      const isPathChange = currentFilePath !== lastPathRef.current
      if (isPathChange || content !== lastContentRef.current) {
        lastPathRef.current = currentFilePath
        lastContentRef.current = content
        isProgrammaticUpdateRef.current = true
        editor.commands.setContent(content || '', { emitUpdate: false })
        reapplyHarnessHighlight(editor)
        isProgrammaticUpdateRef.current = false
      }
    }
  }, [content, currentFilePath, editor])

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
    <div className={`bg-[var(--bg)] relative ${isDeleted ? 'editor-deleted-content' : ''}`}>
      <EditorContent editor={editor} />
      {!isDeleted && showInlinePopup && <WritingBubbleMenu />}
      <ImageGenerateDialogHost />
      {editor && !isDeleted && slash && createPortal(
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
