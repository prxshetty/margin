import { useState, useEffect, useRef, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { useEditorStore } from '../stores/editorStore'
import { API_BASE } from '../lib/api'
import type { FileEntry } from '../stores/editorStore'

interface SimpleLogEntry {
  id: string
  timestamp: string
  mode: 'replace' | 'insert' | 'chat'
  system_prompt: string
  user_prompt: string
  output: string
  instruction?: string
  selected_text?: string
  text_before?: string
  text_after?: string
  ref_files?: Array<{ name: string, path: string }>
  success?: boolean
}

interface MarkdownStorage {
  markdown: { getMarkdown: () => string }
}

function buildMentionContext(files: FileEntry[]): string {
  if (files.length === 0) return ''
  const parts = files.map(
    (f) => `--- ${f.name} ---\n${f.content}`
  )
  return `\n\nReferenced files:\n${parts.join('\n\n')}`
}

function cleanUserPrompt(log: SimpleLogEntry): string {
  if (log.instruction && log.instruction.trim()) {
    return log.instruction.trim()
  }
  return log.mode === 'chat' ? 'AI Assistant Query' : 'Edit text'
}

function getTextBeforeCaret(el: HTMLElement): string {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return ''
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer)) return ''

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let parent = node.parentElement
      while (parent && parent !== el) {
        if (parent.contentEditable === 'false') return NodeFilter.FILTER_REJECT
        parent = parent.parentElement
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  let result = ''
  const endContainer = range.startContainer
  const endOffset = range.startOffset

  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text
    if (textNode === endContainer) {
      result += (textNode.textContent ?? '').slice(0, endOffset)
      break
    }
    result += textNode.textContent ?? ''
  }
  return result
}

function getInputData(el: HTMLElement): { text: string; refPaths: string[] } {
  const refPaths: string[] = []
  el.querySelectorAll<HTMLElement>('[data-path]').forEach((chip) => {
    refPaths.push(chip.dataset.path ?? '')
  })
  const clone = el.cloneNode(true) as HTMLElement
  clone.querySelectorAll<HTMLElement>('.inline-chip').forEach((chip) => chip.remove())
  return { text: clone.textContent?.trim() ?? '', refPaths }
}

export function SimpleAssist() {
  const {
    content, setContent, editor,
    anchorPosition,
    pendingEditSelection, setPendingEditSelection,
  } = useEditorStore()

  const openedFiles = useEditorStore((s) => s.openedFiles)
  const currentFilePath = useEditorStore((s) => s.currentFilePath)
  const updateFileContent = useEditorStore((s) => s.updateFileContent)
  const [isWorking, setIsWorking] = useState(false)
  const [instructionText, setInstructionText] = useState('')
  const [historyLogs, setHistoryLogs] = useState<SimpleLogEntry[]>([])
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({})
  const [activeInstruction, setActiveInstruction] = useState('')
  const [activeRefFiles, setActiveRefFiles] = useState<FileEntry[]>([])
  const [activeSelectedLength, setActiveSelectedLength] = useState<number | undefined>()
  const [errorText, setErrorText] = useState('')
  const [mode, setMode] = useState<'chat' | 'edit'>('edit')
  const hasSelection = !!pendingEditSelection

  const [showFileDropdown, setShowFileDropdown] = useState(false)
  const [fileQuery, setFileQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const inputRef = useRef<HTMLDivElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const containerRef = useRef<HTMLDivElement>(null)

  const fetchLogs = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/assist/simple/logs`)
      if (res.ok) {
        const data = await res.json()
        setHistoryLogs(data)
      }
    } catch (err) {
      console.error('Failed to fetch simple logs:', err)
    }
  }

  useEffect(() => {
    fetchLogs()
  }, [])

  useEffect(() => {
    if (historyLogs.length > 0 || isWorking || errorText) {
      outputRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [historyLogs.length, isWorking, errorText])

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowFileDropdown(false)
      }
    }
    if (showFileDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showFileDropdown])



  const filteredFiles = openedFiles.filter((f) =>
    fileQuery === '' || f.name.toLowerCase().startsWith(fileQuery.toLowerCase())
  ).slice(0, 5)


  const handleInput = () => {
    const el = inputRef.current
    if (!el) return

    const textBefore = getTextBeforeCaret(el)
    const { text } = getInputData(el)
    setInstructionText(text)

    const atIndex = textBefore.lastIndexOf('@')
    if (atIndex === -1 || (atIndex > 0 && textBefore[atIndex - 1] !== ' ' && textBefore[atIndex - 1] !== '\n')) {
      setShowFileDropdown(false)
      return
    }

    const afterAt = textBefore.slice(atIndex + 1)
    const spaceIndex = afterAt.search(/[\s\n]/)
    const query = spaceIndex === -1 ? afterAt : afterAt.slice(0, spaceIndex)

    setFileQuery(query)
    setHighlightedIndex(0)
    setShowFileDropdown(true)
  }

  const handleSelectFile = useCallback((file: FileEntry) => {
    const div = inputRef.current
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount || !div) return

    const range = sel.getRangeAt(0)
    const textNode = range.startContainer
    if (textNode.nodeType !== Node.TEXT_NODE || !div.contains(textNode)) return

    const text = textNode.textContent ?? ''
    const caretOffset = range.startOffset
    const textBeforeCaret = text.slice(0, caretOffset)
    const atIndex = textBeforeCaret.lastIndexOf('@')
    if (atIndex === -1) return

    const afterAt = text.slice(atIndex + 1)
    const spaceIndex = afterAt.search(/[\s\n]/)
    const mentionEnd = spaceIndex === -1 ? text.length : atIndex + 1 + spaceIndex

    range.setStart(textNode, atIndex)
    range.setEnd(textNode, mentionEnd)
    range.deleteContents()

    const chip = document.createElement('span')
    chip.contentEditable = 'false'
    chip.className = 'inline-chip'
    chip.dataset.path = file.path
    chip.dataset.name = file.name
    chip.innerHTML = `@${file.name} <button class="chip-remove" data-path="${file.path}">&times;</button>`

    const zwsp = document.createTextNode('\u200B')
    const fragment = document.createDocumentFragment()
    fragment.appendChild(chip)
    fragment.appendChild(zwsp)
    range.insertNode(fragment)
    setShowFileDropdown(false)

    setTimeout(() => {
      const currentSel = window.getSelection()
      if (currentSel) {
        const rangeAfter = document.createRange()
        rangeAfter.setStartAfter(zwsp)
        rangeAfter.collapse(true)
        currentSel.removeAllRanges()
        currentSel.addRange(rangeAfter)
      }
      div.focus()
    }, 0)
  }, [inputRef, setShowFileDropdown])

  const handleEdit = async () => {
    if (!editor) return
    const inputEl = inputRef.current!
    const { text: currentInstruction, refPaths } = getInputData(inputEl)
    if (!currentInstruction) return

    const selectionInfo = pendingEditSelection
    const localHasSelection = !!selectionInfo
    const selectionText = selectionInfo ? selectionInfo.text : ''

    setIsWorking(true)
    setActiveInstruction(currentInstruction)
    const currentRefFiles = openedFiles.filter((f) => refPaths.includes(f.path))
    setActiveRefFiles(currentRefFiles)
    setActiveSelectedLength(localHasSelection ? selectionText.length : undefined)
    setErrorText('')

    if (inputRef.current) {
      inputRef.current.textContent = ''
      setInstructionText('')
    }

    try {
      const mentionContext = buildMentionContext(currentRefFiles)
      const fullContent = [content, mentionContext].filter(Boolean).join('\n\n')

      const body: Record<string, unknown> = {
        content: fullContent,
        message: currentInstruction,
        mode: 'edit',
        ref_files: currentRefFiles.map(f => ({ name: f.name, path: f.path })),
      }

      if (localHasSelection) {
        body.selected_text = selectionText
      }

      const pos = anchorPosition
      const docSize = editor.state.doc.content.size
      body.text_before = editor.state.doc.textBetween(0, pos, '\n')
      body.text_after = editor.state.doc.textBetween(pos, docSize, '\n')

      const res = await fetch(`${API_BASE}/api/assist/simple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.detail || 'Edit failed')
      }
      const data = await res.json()
      const output = data.output

      if (data.edit_mode === 'replace' && selectionInfo) {
        const from = selectionInfo.from
        const to = selectionInfo.to
        if (from !== to) {
          editor.chain().deleteRange({ from, to }).insertContentAt(from, output).run()
        }
      } else {
        editor.commands.insertContentAt(anchorPosition, output)
      }

      const storage = editor.storage as unknown as MarkdownStorage
      if (storage.markdown) {
        const md = storage.markdown.getMarkdown()
        setContent(md)
        if (currentFilePath) updateFileContent(currentFilePath, md)
      }
      setPendingEditSelection(null)
      await fetchLogs()
    } catch (err) {
      console.error(err)
      setErrorText('Error: ' + (err as Error).message)
    } finally {
      setIsWorking(false)
      setActiveInstruction('')
      setActiveRefFiles([])
      setActiveSelectedLength(undefined)
    }
  }

  const handleChat = async () => {
    if (!editor) return
    const inputEl = inputRef.current!
    const { text: currentInstruction, refPaths } = getInputData(inputEl)
    if (!currentInstruction) return

    const selectionInfo = pendingEditSelection
    const localHasSelection = !!selectionInfo
    const selectionText = selectionInfo ? selectionInfo.text : ''

    setIsWorking(true)
    setActiveInstruction(currentInstruction)
    const currentRefFiles = openedFiles.filter((f) => refPaths.includes(f.path))
    setActiveRefFiles(currentRefFiles)
    setErrorText('')

    if (inputRef.current) {
      inputRef.current.textContent = ''
      setInstructionText('')
    }

    try {
      const mentionContext = buildMentionContext(currentRefFiles)
      const fullContent = [content, mentionContext].filter(Boolean).join('\n\n')

      const body: Record<string, unknown> = {
        content: fullContent,
        message: currentInstruction,
        mode: 'chat',
        ref_files: currentRefFiles.map(f => ({ name: f.name, path: f.path })),
      }

      if (localHasSelection) {
        body.selected_text = selectionText
      }

      const res = await fetch(`${API_BASE}/api/assist/simple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.detail || 'Chat failed')
      }
      await fetchLogs()
    } catch (err) {
      console.error(err)
      setErrorText('Error: ' + (err as Error).message)
    } finally {
      setIsWorking(false)
      setActiveInstruction('')
      setActiveRefFiles([])
      setActiveSelectedLength(undefined)
    }
  }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Backspace' && !inputRef.current?.textContent?.trim() && pendingEditSelection) {
      e.preventDefault()
      setPendingEditSelection(null)
      return
    }
    if (showFileDropdown && filteredFiles.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightedIndex((i) => Math.min(i + 1, filteredFiles.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightedIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSelectFile(filteredFiles[highlightedIndex])
        return
      }
    }
    if (e.key === 'Escape' && showFileDropdown) {
      e.preventDefault()
      setShowFileDropdown(false)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      document.execCommand('insertText', false, '\n')
    }
  }
  
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
  }

  const handleContentMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.classList.contains('chip-remove')) {
      e.preventDefault()
      const chip = target.closest('.inline-chip') as HTMLElement
      if (chip) {
        chip.remove()
        handleInput()
      }
    }
  }

  const hasHistory = historyLogs.length > 0 || isWorking || !!errorText

  const renderInputCard = () => (
    <div className="bg-[var(--bg)] border border-[var(--border)] focus-within:border-[var(--text-secondary)] shadow-[0_4px_12px_rgba(0,0,0,0.01)] focus-within:shadow-[0_4px_16px_rgba(0,0,0,0.02)] transition-[border-color,box-shadow] duration-200 rounded-[20px] p-3 flex flex-col relative animate-scale-in">
      {pendingEditSelection && (
        <div className="flex items-center gap-1 mb-1.5 select-none">
          <span className="inline-chip bg-[var(--bg-hover)] px-2 py-0.5 rounded-[4px] text-[10px] text-[var(--text-secondary)] border border-[var(--border-subtle)] flex items-center gap-1 font-sans">
            {pendingEditSelection.text.length} Ch
            <button className="chip-remove text-[var(--text-muted)] hover:text-[var(--text)] font-sans ml-0.5 cursor-pointer animate-fade-in" onClick={() => setPendingEditSelection(null)}>&times;</button>
          </span>
        </div>
      )}
      <div className="flex items-start gap-1.5 w-full">
        <div
          ref={inputRef}
          contentEditable
          role="textbox"
          aria-multiline="true"
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onMouseDown={handleContentMouseDown}
          data-placeholder={mode === 'chat' ? 'Ask a question...' : 'Describe changes...'}
          className="flex-1 min-w-0 bg-transparent border-0 p-0 text-xs focus:ring-0 focus:outline-none resize-none text-[var(--text)] min-h-[44px] font-sans leading-relaxed whitespace-pre-wrap empty:before:content-[attr(data-placeholder)] empty:before:text-[var(--text-muted)]"
        />
      </div>

      {showFileDropdown && (
        <div
          ref={dropdownRef}
          className="absolute left-2.5 right-2.5 bottom-full mb-1 z-50 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[12px] overflow-hidden shadow-[0_4px_16px_rgba(0,0,0,0.03)]"
        >
          {filteredFiles.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-[var(--text-secondary)] font-sans text-center">
              No matching files
            </div>
          ) : (
            <div className="max-h-[200px] overflow-y-auto">
              {filteredFiles.map((file, index) => (
                <button
                  key={file.path}
                  onClick={() => handleSelectFile(file)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors cursor-pointer ${
                    index === highlightedIndex
                      ? 'bg-[var(--bg-hover)]'
                      : 'hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <span className="text-xs text-[var(--text)] font-medium font-sans truncate">
                    {file.name}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)] font-sans truncate">
                    {file.path}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Input Action Bar */}
      <div className="flex items-center justify-between select-none">
        {/* Mode Toggle */}
        <div className="flex items-center gap-0.5 bg-[var(--bg-hover)] rounded-full p-0.5 border border-[var(--border-subtle)]">
          <button
            onClick={() => setMode('edit')}
            className={`flex items-center justify-center w-7 h-7 rounded-full transition-colors cursor-pointer ${
              mode === 'edit' ? 'bg-[var(--accent-brown)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-heading)]'
            }`}
            title="Edit mode"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
          </button>
          <button
            onClick={() => setMode('chat')}
            className={`flex items-center justify-center w-7 h-7 rounded-full transition-colors cursor-pointer ${
              mode === 'chat' ? 'bg-[var(--accent-brown)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-heading)]'
            }`}
            title="Chat mode"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 3h4a8 8 0 1 1 0 16v3.5c-5-2-12-5-12-11.5a8 8 0 0 1 8-8Zm2 14h2a6 6 0 0 0 0-12h-4a6 6 0 0 0-6 6c0 3.61 2.462 5.966 8 8.48V17Z" />
            </svg>
          </button>
        </div>

        {/* Action Button: Solid circular button with up arrow */}
        <button
          onClick={mode === 'chat' ? handleChat : handleEdit}
          disabled={!instructionText || isWorking}
          className="
            flex items-center justify-center transition-[background-color,transform,opacity] duration-150 cursor-pointer select-none border rounded-full w-7 h-7 active:scale-[0.9] bg-[var(--accent-brown)] hover:bg-[var(--accent-brown-hover)] text-white disabled:bg-[var(--bg-disabled)] disabled:text-[var(--text-disabled)] disabled:border-transparent border-transparent
          "
          title={mode === 'chat' ? 'Send Message' : hasSelection ? 'Replace Selection' : 'Insert Content'}
        >
          {isWorking ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )

  return (
    <div ref={containerRef} className="flex flex-col gap-4 w-full h-full select-none animate-fade-in">
      {/* Header: new chat button only */}
      <div className="flex items-center justify-end gap-1.5 pb-3.5 border-b border-[var(--border-sidebar)] select-none shrink-0 w-full animate-fade-in">
        <button
          onClick={async () => {
            try {
              const res = await fetch(`${API_BASE}/api/assist/simple/logs`, { method: 'DELETE' })
              if (!res.ok) console.warn('DELETE logs returned', res.status)
            } catch (e) {
              console.error('Failed to clear logs:', e)
            }
            setHistoryLogs([])
          }}
          className="flex items-center justify-center w-7 h-7 text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--border-sidebar)]/60 bg-[var(--bg-icon)]/20 rounded-[6px] transition-all cursor-pointer active:scale-[0.95]"
          title="New Chat"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
            <path d="M10 3v14M3 10h14" />
          </svg>
        </button>
      </div>

      {/* History area (scrollable) */}
      {hasHistory && (
        <>
          <div className="flex-1 overflow-y-auto flex flex-col gap-4 pr-1 min-h-0 select-text">
            {historyLogs.map((log) => {
              const isExpanded = !!expandedIds[log.id]
              return (
                <div key={log.id} className="flex flex-col gap-3">
                  {/* User Speech Capsule Bubble */}
                  <div className="self-end max-w-[85%] bg-[var(--bg-bubble)] border border-[var(--border)] rounded-[16px] rounded-tr-[4px] px-3.5 py-2.5 font-sans text-xs text-[var(--text)] shadow-none leading-relaxed select-text flex flex-wrap items-center gap-1 animate-scale-in">
                    {log.mode !== 'chat' && log.selected_text && (
                      <span className="inline-chip" data-role="char-count">{log.selected_text.length} Ch</span>
                    )}
                    {log.ref_files?.map((file) => (
                      <span key={file.path} className="inline-chip" data-path={file.path} data-name={file.name}>@{file.name}</span>
                    ))}
                    <span>{cleanUserPrompt(log)}</span>
                  </div>

                  {/* AI Assistant Plain Text Response */}
                  <div className="flex flex-col gap-1.5 self-start w-full select-text max-w-[90%] py-1 animate-scale-in">
                    <div className="flex items-center gap-2.5 select-none text-[var(--text-muted)]">
                      <button
                        onClick={() => setExpandedIds(prev => ({ ...prev, [log.id]: !prev[log.id] }))}
                        className="flex items-center gap-0.5 text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-heading)] transition-colors cursor-pointer"
                        title="Toggle prompt details"
                      >
                        <span>Telemetry</span>
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`w-2.5 h-2.5 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                      </button>

                    </div>
                    <div className="text-xs font-sans text-[var(--text)] leading-relaxed whitespace-pre-wrap select-text">
                      {log.output}
                    </div>
                    {isExpanded && (
                      <div className="text-[10px] font-mono text-[var(--text-secondary)] leading-normal select-text whitespace-pre-wrap mt-1 p-2 bg-[var(--bg-expanded)]/50 border border-[var(--border)] rounded-[6px] animate-fade-in w-full">
                        <strong>System Prompt:</strong> {log.system_prompt}<br /><br />
                        <strong>Full User Prompt:</strong> {log.user_prompt}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {isWorking && activeInstruction && (
              <div className="flex flex-col gap-3 animate-fade-in">
                {/* User Prompt */}
                <div className="self-end max-w-[85%] bg-[var(--bg-bubble)] border border-[var(--border)] rounded-[16px] rounded-tr-[4px] px-3.5 py-2.5 font-sans text-xs text-[var(--text)] shadow-none leading-relaxed select-text flex flex-wrap items-center gap-1 opacity-70">
                  {activeSelectedLength != null && (
                    <span className="inline-chip" data-role="char-count">{activeSelectedLength} Ch</span>
                  )}
                  {activeRefFiles.map((file) => (
                    <span key={file.path} className="inline-chip" data-path={file.path} data-name={file.name}>@{file.name}</span>
                  ))}
                  <span>{activeInstruction}</span>
                </div>

                {/* Thinking Status */}
                <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] font-serif italic py-1 select-none animate-pulse">
                  <svg className="w-3.5 h-3.5 animate-spin text-[var(--accent-brown)]" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="12" r="10" stroke="var(--border)" strokeWidth="3" />
                    <path d="M12 2C6.47715 2 2 6.47715 2 12C2 13.5796 2.36592 15.071 3.01662 16.4024" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  <span>Thinking about the edit...</span>
                </div>

                {/* Step Progress Indicator (from the image) */}
                <div className="flex flex-col gap-2 py-2 select-none" ref={outputRef}>
                  <div className="text-[10px] text-[var(--text-secondary)] font-sans flex items-center justify-between">
                    <span>Drafting manuscript changes</span>
                    <span className="font-semibold text-[var(--text-heading)]">Step 1 of 4</span>
                  </div>
                  <div className="flex gap-1.5">
                    <div className="h-1 bg-[var(--accent-brown)] rounded-full flex-1 animate-pulse" />
                    <div className="h-1 bg-[var(--border)] rounded-full flex-1" />
                    <div className="h-1 bg-[var(--border)] rounded-full flex-1" />
                    <div className="h-1 bg-[var(--border)] rounded-full flex-1" />
                  </div>
                </div>
              </div>
            )}

            {errorText && (
              <div className="flex items-center gap-1.5 text-xs text-red-600 font-sans py-1 self-start select-none animate-fade-in" ref={outputRef}>
                <span>{errorText}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* Input Card always anchored cleanly at the bottom */}
      <div className="shrink-0 mt-auto pt-2">
        {renderInputCard()}
      </div>
    </div>
  )
}
