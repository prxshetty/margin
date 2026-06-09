import { useMemo, useState, useEffect, useRef } from 'react'
import { useEditorStore } from '../../stores/editorStore'

export function SimpleAssistSelectionPopup() {
  const { editor, selectionRange, selectedText, setPendingEditSelection } = useEditorStore()
  const [isMouseDown, setIsMouseDown] = useState(false)
  const popupRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      try {
        if (editor?.view?.dom?.contains(e.target as Node)) {
          setIsMouseDown(true)
        }
      } catch {
        //
      }
    }
    const handleMouseUp = () => setIsMouseDown(false)
    window.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [editor])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!selectionRange || !popupRef.current) return
      if (editor?.view?.dom?.contains(e.target as Node)) return
      if (popupRef.current.contains(e.target as Node)) return
      editor?.commands.setTextSelection(editor.state.selection.from)
    }
    window.addEventListener('mousedown', handleClickOutside)
    return () => window.removeEventListener('mousedown', handleClickOutside)
  }, [selectionRange, editor])

  const coords = useMemo(() => {
    if (!editor || !selectionRange) return null
    try {
      return (editor.view as any).coordsAtPos(selectionRange.to)
    } catch {
      return null
    }
  }, [editor, selectionRange])

  if (isMouseDown || !selectedText || !selectionRange || !coords) return null

  const wrapper = editor?.view?.dom?.parentElement
  const wrapperRect = wrapper?.getBoundingClientRect()
  const top = (coords.bottom - (wrapperRect?.top || 0)) + 8
  const wrapperWidth = wrapperRect?.width || window.innerWidth
  const popupWidth = 200
  const maxLeft = Math.max(10, wrapperWidth - popupWidth - 16)
  let left = coords.left - (wrapperRect?.left || 0) - 40
  left = Math.max(10, Math.min(left, maxLeft))

  const handleAdd = () => {
    if (!selectionRange) return
    setPendingEditSelection({
      text: selectedText,
      from: selectionRange.from,
      to: selectionRange.to
    })
    editor?.commands.setTextSelection(selectionRange.from)
  }

  return (
    <div
      ref={popupRef}
      onMouseDown={(e) => e.preventDefault()}
      style={{ top, left }}
      className="absolute z-[9999] flex items-center gap-1.5 px-1.5 py-1.5 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[10px] shadow-[0_4px_12px_rgba(0,0,0,0.06)] animate-fade-in select-none"
    >
      <button
        onClick={handleAdd}
        className="text-[12.5px] font-medium font-sans text-[var(--accent-brown)] hover:text-[var(--accent-brown-hover)] transition-colors duration-150 cursor-pointer px-1.5 py-0.5 rounded-[4px] hover:bg-[var(--bg-hover)] leading-none"
      >
        + Add to Assist
      </button>
    </div>
  )
}
