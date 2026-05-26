import { useMemo, useState, useEffect } from 'react'
import { Sparkles, PenLine, Plus, X, Loader2 } from 'lucide-react'
import { useEditorStore } from '../../stores/editorStore'
import { useProjectStore } from '../../stores/projectStore'
import { useQueryClient } from '@tanstack/react-query'
import { API_BASE } from '../../lib/api'

export function InlineSelectionPopup({ localEditor }: { localEditor?: any }) {
  const { editor, selectionRange, selectedText, setAIAssistPreload } = useEditorStore()
  const { activeSceneId, activeDoc, activeChapterId } = useProjectStore()
  const queryClient = useQueryClient()
  const [isLoading, setIsLoading] = useState<'expand' | 'rewrite' | null>(null)
  const [dismissedRange, setDismissedRange] = useState<{from: number, to: number} | null>(null)
  const [isMouseDown, setIsMouseDown] = useState(false)

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      try {
        if (editor?.view?.dom?.contains(e.target as Node)) {
          setIsMouseDown(true)
        }
      } catch {
        // editor view not yet mounted
      }
    }
    const handleMouseUp = () => {
      setIsMouseDown(false)
    }

    window.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  // Position calculation
  const coords = useMemo(() => {
    if (!editor || !selectionRange) return null
    try {
      return (editor.view as any).coordsAtPos(selectionRange.to)
    } catch (e) {
      return null
    }
  }, [editor, selectionRange])

  // Only render the popup that belongs to the currently active focused editor
  if (localEditor && editor !== localEditor) return null

  // Don't show if mouse is still held (dragging), no selection, not in a document, or dismissed
  if (isMouseDown || !selectedText || !selectionRange || !activeDoc || !coords) return null
  
  // If the user dismissed the popup for this exact selection, hide it
  if (dismissedRange && dismissedRange.from === selectionRange.from && dismissedRange.to === selectionRange.to) {
    return null
  }

  const isScene = activeDoc?.type === 'scene'
  const docId = activeDoc
    ? activeDoc.type === 'scene'
      ? activeSceneId
      : activeDoc.type === 'character'
        ? activeDoc.slug
        : activeDoc.id
    : ''

  const handleExpand = async () => {
    if (!selectionRange || !editor || (isScene ? !activeSceneId : !activeChapterId)) return
    setIsLoading('expand')
    try {
      const docSize = editor.state.doc.content.size
      const textBefore = editor.state.doc.textBetween(0, selectionRange.to, '\n')
      const textAfter = editor.state.doc.textBetween(selectionRange.to, docSize, '\n')
      const resolvedPos = editor.state.doc.resolve(selectionRange.to)
      const blockType = resolvedPos.parent.type.name

      const url = isScene
        ? `${API_BASE}/scenes/${activeSceneId}/insert_after`
        : `${API_BASE}/chapters/${activeChapterId}/insert_after`

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text_before: textBefore,
          text_after: textAfter,
          block_type: blockType,
          feedback: '',
          context: editor.state.doc.textBetween(0, docSize, '\n'),
          doc_type: activeDoc?.type,
          doc_id: docId
        })
      })

      if (!response.ok) throw new Error('Expand failed')

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6))
            if (data.generated_text) {
              editor.chain()
                .insertContentAt(selectionRange.to, '\n\n' + data.generated_text, {
                  parseOptions: { preserveWhitespace: 'full' },
                  updateSelection: false,
                })
                .run()
            }
          }
        }
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoading(null)
      queryClient.invalidateQueries({ queryKey: ['aiEditorLogs', activeDoc?.type, docId || activeChapterId] })
      setDismissedRange(selectionRange)
    }
  }

  const handleRewrite = async () => {
    if (!selectionRange || !selectedText || !editor || (isScene ? !activeSceneId : !activeChapterId)) return
    setIsLoading('rewrite')
    try {
      const docSize = editor.state.doc.content.size
      const url = isScene
        ? `${API_BASE}/scenes/${activeSceneId}/rewrite_selection`
        : `${API_BASE}/chapters/${activeChapterId}/rewrite_selection`

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selected_text: selectedText,
          feedback: '',
          context: editor.state.doc.textBetween(0, docSize, '\n'),
          doc_type: activeDoc?.type,
          doc_id: docId
        })
      })

      if (!response.ok) throw new Error('Rewrite failed')

      const data = await response.json()
      if (data.rewritten_text) {
        editor.chain()
          .deleteRange({ from: selectionRange.from, to: selectionRange.to })
          .insertContentAt(selectionRange.from, data.rewritten_text, {
            parseOptions: { preserveWhitespace: 'full' },
            updateSelection: false,
          })
          .run()
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoading(null)
      queryClient.invalidateQueries({ queryKey: ['aiEditorLogs', activeDoc?.type, docId || activeChapterId] })
      setDismissedRange(selectionRange)
    }
  }

  const handleAIAssist = () => {
    if (!selectionRange) return
    setAIAssistPreload({
      text: selectedText,
      range: { from: selectionRange.from, to: selectionRange.to }
    })
    setDismissedRange(selectionRange)
  }

  // Calculate position relative to the editor container
  // coords gives us viewport coordinates. To make it absolute to the wrapper:
  // Since we render inside the relative wrapper, we just need offsetTop/offsetLeft.
  // Actually, standard tiptap way is to use a tiptap extension (BubbleMenu).
  // But doing it this way: get bounding client rect of the wrapper.
  const wrapper = editor?.view?.dom?.parentElement
  const wrapperRect = wrapper?.getBoundingClientRect()
  
  const top = coords.bottom - (wrapperRect?.top || 0) + 10
  const left = Math.max(0, coords.left - (wrapperRect?.left || 0) - 100)

  return (
    <div 
      onMouseDown={(e) => e.preventDefault()}  // prevent editor losing selection when clicking popup
      style={{ top, left }}
      className="absolute z-50 flex items-center gap-1 p-1 bg-slate-900 rounded-lg shadow-xl border border-slate-700 animate-in fade-in zoom-in-95 duration-200"
    >
      <button
        onClick={handleExpand}
        disabled={!!isLoading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 rounded-md transition-colors disabled:opacity-50"
      >
        {isLoading === 'expand' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
        Expand
      </button>
      <div className="w-px h-4 bg-slate-700 mx-0.5" />
      <button
        onClick={handleRewrite}
        disabled={!!isLoading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 rounded-md transition-colors disabled:opacity-50"
      >
        {isLoading === 'rewrite' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PenLine className="w-3.5 h-3.5" />}
        Rewrite
      </button>
      <div className="w-px h-4 bg-slate-700 mx-0.5" />
      <button
        onClick={handleAIAssist}
        disabled={!!isLoading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-300 hover:text-indigo-200 hover:bg-slate-800 rounded-md transition-colors disabled:opacity-50"
      >
        <Sparkles className="w-3.5 h-3.5" />
        AI Assist
      </button>
      <button
        onClick={() => setDismissedRange(selectionRange)}
        className="p-1 ml-1 text-slate-400 hover:text-slate-300 hover:bg-slate-800 rounded-md transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
