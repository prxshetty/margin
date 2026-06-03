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

  const prompt = log.user_prompt || ''

  // 1. Extract from "Feedback: {instruction}"
  const feedbackMatch = prompt.match(/Feedback:\s*([^\n]+)/i)
  if (feedbackMatch && feedbackMatch[1]) {
    return feedbackMatch[1].trim()
  }

  // 2. Extract from "INSTRUCTION: {instruction}"
  const instructionMatch = prompt.match(/INSTRUCTION:\s*([^\n]+)/i)
  if (instructionMatch && instructionMatch[1]) {
    return instructionMatch[1].trim()
  }

  // 3. Extract from chat mode: last "User: {instruction}"
  const chatParts = prompt.split(/User:\s*/i)
  if (chatParts.length > 1) {
    const lastPart = chatParts[chatParts.length - 1].trim()
    if (lastPart) return lastPart
  }

  // Fallback
  return log.mode === 'insert' ? 'Insert text' : log.mode === 'replace' ? 'Rewrite text' : 'AI Assistant Query'
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
  clone.querySelectorAll<HTMLElement>('[data-path]').forEach((chip) => {
    const name = chip.dataset.name ?? 'file'
    chip.replaceWith(document.createTextNode(`@${name}`))
  })
  return { text: clone.textContent?.trim() ?? '', refPaths }
}

export function SimpleAssist() {
  const {
    content, setContent, editor,
    selectedText, anchorPosition,
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
  const [errorText, setErrorText] = useState('')

  const [showFileDropdown, setShowFileDropdown] = useState(false)
  const [fileQuery, setFileQuery] = useState('')

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

  const hasSelection = selectedText.length > 0

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const existing = el.querySelector('[data-role="char-count"]')
    if (!hasSelection) {
      if (existing) {
        const sibling = existing.nextSibling
        if (sibling?.nodeType === Node.TEXT_NODE && (sibling.textContent === '\u00A0' || sibling.textContent === '\u200B')) {
          sibling.remove()
        }
        existing.remove()
      }
      return
    }
    if (existing) {
      if (existing.firstChild) {
        existing.firstChild.textContent = `${selectedText.length} Ch `
      }
      return
    }
    const chip = document.createElement('span')
    chip.contentEditable = 'false'
    chip.className = 'inline-chip'
    chip.dataset.role = 'char-count'
    chip.innerHTML = `${selectedText.length} Ch <button class="chip-remove" data-role="char-count">&times;</button>`

    const zwsp = document.createTextNode('\u200B')
    el.insertBefore(zwsp, el.firstChild)
    el.insertBefore(chip, el.firstChild)
  }, [selectedText, hasSelection])

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

  const handleReplace = async () => {
    if (!selectedText || !editor) return
    const { text: currentInstruction, refPaths } = getInputData(inputRef.current!)
    if (!currentInstruction) return
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

      const res = await fetch(`${API_BASE}/api/assist/simple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: fullContent,
          message: currentInstruction,
          mode: 'replace',
          selected_text: selectedText,
          ref_files: currentRefFiles.map(f => ({ name: f.name, path: f.path })),
        }),
      })
      if (!res.ok) throw new Error('Replace failed')
      const data = await res.json()
      const rewritten = data.output

      const range = useEditorStore.getState().selectionRange
      const from = range?.from ?? 0
      const to = range?.to ?? 0
      if (from !== to) {
        editor.chain().deleteRange({ from, to }).insertContentAt(from, rewritten).run()
        const storage = editor.storage as unknown as MarkdownStorage
        if (storage.markdown) {
          const md = storage.markdown.getMarkdown()
          setContent(md)
          if (currentFilePath) updateFileContent(currentFilePath, md)
        }
      }
      await fetchLogs()
    } catch (err) {
      console.error(err)
      setErrorText('Error: ' + (err as Error).message)
    } finally {
      setIsWorking(false)
      setActiveInstruction('')
      setActiveRefFiles([])
    }
  }

  const handleInsert = async () => {
    if (!editor) return
    const { text: currentInstruction, refPaths } = getInputData(inputRef.current!)
    if (!currentInstruction) return
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
      const pos = anchorPosition
      const docSize = editor.state.doc.content.size
      const textBefore = editor.state.doc.textBetween(0, pos, '\n')
      const textAfter = editor.state.doc.textBetween(pos, docSize, '\n')

      const mentionContext = buildMentionContext(currentRefFiles)
      const fullContent = [content, mentionContext].filter(Boolean).join('\n\n')

      const res = await fetch(`${API_BASE}/api/assist/simple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: fullContent,
          message: currentInstruction,
          mode: 'insert',
          text_before: textBefore,
          text_after: textAfter,
          ref_files: currentRefFiles.map(f => ({ name: f.name, path: f.path })),
        }),
      })
      if (!res.ok) throw new Error('Insert failed')
      const data = await res.json()
      const inserted = data.output

      editor.commands.insertContentAt(pos, inserted)
      const storage = editor.storage as unknown as MarkdownStorage
      if (storage.markdown) {
        const md = storage.markdown.getMarkdown()
        setContent(md)
        if (currentFilePath) updateFileContent(currentFilePath, md)
      }
      await fetchLogs()
    } catch (err) {
      console.error(err)
      setErrorText('Error: ' + (err as Error).message)
    } finally {
      setIsWorking(false)
      setActiveInstruction('')
      setActiveRefFiles([])
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Backspace' && !inputRef.current?.textContent?.trim() && hasSelection && editor) {
      e.preventDefault()
      editor.commands.setTextSelection(editor.state.selection.to)
      return
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
        if (chip.dataset.role === 'char-count' && editor) {
          editor.commands.setTextSelection(editor.state.selection.to)
        } else {
          chip.remove()
        }
      }
    }
  }

  const handleFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const chip = el.querySelector('[data-role="char-count"]')
    if (chip) {
      const sibling = chip.nextSibling
      if (sibling) {
        setTimeout(() => {
          const sel = window.getSelection()
          if (sel) {
            const range = document.createRange()
            range.setStartAfter(sibling)
            range.collapse(true)
            sel.removeAllRanges()
            sel.addRange(range)
          }
        }, 0)
      }
    }
  }

  const hasHistory = historyLogs.length > 0 || isWorking || !!errorText

  const renderInputCard = () => (
    <div className="bg-[var(--bg)] border border-[var(--border)] focus-within:border-[var(--text-secondary)] shadow-[0_4px_12px_rgba(0,0,0,0.01)] focus-within:shadow-[0_4px_16px_rgba(0,0,0,0.02)] transition-[border-color,box-shadow] duration-200 rounded-[20px] p-3 flex flex-col relative animate-scale-in">
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
          onFocus={handleFocus}
          data-placeholder="How can I help you?"
          className="flex-1 min-w-0 bg-transparent border-0 p-0 text-xs focus:ring-0 focus:outline-none resize-none text-[var(--text)] min-h-[44px] font-sans leading-relaxed whitespace-pre-wrap empty:before:content-[attr(data-placeholder)] empty:before:text-[var(--text-muted)] [&_.inline-chip]:inline-flex [&_.inline-chip]:items-center [&_.inline-chip]:gap-0.5 [&_.inline-chip]:bg-[var(--bg-chip)] [&_.inline-chip]:text-[var(--text-accent)] [&_.inline-chip]:border [&_.inline-chip]:border-[var(--border-chip)]/30 [&_.inline-chip]:rounded-[6px] [&_.inline-chip]:px-1.5 [&_.inline-chip]:h-4 [&_.inline-chip]:text-[10px] [&_.inline-chip]:font-mono [&_.inline-chip]:select-none [&_.inline-chip_.chip-remove]:text-[var(--text-accent)]/60 [&_.inline-chip_.chip-remove]:hover:text-[var(--text-accent)] [&_.inline-chip_.chip-remove]:cursor-pointer [&_.inline-chip_.chip-remove]:bg-none [&_.inline-chip_.chip-remove]:border-none [&_.inline-chip_.chip-remove]:p-0 [&_.inline-chip_.chip-remove]:text-[10px] [&_.inline-chip_.chip-remove]:leading-none"
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
              {filteredFiles.map((file) => (
                <button
                  key={file.path}
                  onClick={() => handleSelectFile(file)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
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
        {/* Paperclip attach icon in bottom-left */}
        <button
          className="flex items-center justify-center transition-[color,background-color,transform] duration-150 cursor-pointer select-none border rounded-full w-8 h-8 active:scale-[0.9] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] border-transparent"
          title="Attach files (type @ in text box)"
          onClick={() => {
            const el = inputRef.current
            if (el) {
              el.focus()
              document.execCommand('insertText', false, '@')
              handleInput()
            }
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>

        {/* Action Button: Solid circular button with up arrow */}
        <button
          onClick={hasSelection ? handleReplace : handleInsert}
          disabled={!instructionText || isWorking}
          className="
            flex items-center justify-center transition-[background-color,transform,opacity] duration-150 cursor-pointer select-none border rounded-full w-8 h-8 active:scale-[0.9] bg-[var(--accent-brown)] hover:bg-[var(--accent-brown-hover)] text-white disabled:bg-[var(--bg-disabled)] disabled:text-[var(--text-disabled)] disabled:border-transparent border-transparent
          "
          title={hasSelection ? 'Replace Selection' : 'Insert Content'}
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
                  <div className="self-end max-w-[85%] bg-[var(--bg-bubble)] border border-[var(--border)] rounded-[16px] rounded-tr-[4px] px-3.5 py-2.5 font-sans text-xs text-[var(--text)] shadow-none leading-relaxed select-text flex flex-col gap-1.5 animate-scale-in">
                    {log.ref_files && log.ref_files.length > 0 && (
                      <div className="flex flex-wrap gap-1 select-none">
                        {log.ref_files.map((file) => (
                          <span
                            key={file.path}
                            className="bg-[var(--bg-chip)] text-[var(--text-accent)] border border-[var(--border-chip)]/30 rounded-[3px] px-1.5 py-0.5 text-[9px] font-mono font-semibold"
                          >
                            @{file.name}
                          </span>
                        ))}
                      </div>
                    )}
                    <div>{cleanUserPrompt(log)}</div>
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
                      <span className="text-[10px] text-[var(--text-accent)] font-semibold select-none flex items-center gap-0.5 ml-auto">
                        {log.mode === 'chat' ? '✓ Replied' : '✓ Applied'}
                      </span>
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
                <div className="self-end max-w-[85%] bg-[var(--bg-bubble)] border border-[var(--border)] rounded-[16px] rounded-tr-[4px] px-3.5 py-2.5 font-sans text-xs text-[var(--text)] shadow-none leading-relaxed select-text flex flex-col gap-1.5 opacity-70">
                  {activeRefFiles && activeRefFiles.length > 0 && (
                    <div className="flex flex-wrap gap-1 select-none">
                      {activeRefFiles.map((file) => (
                        <span
                          key={file.path}
                          className="bg-[var(--bg-chip)] text-[var(--text-accent)] border border-[var(--border-chip-active)] rounded-[3px] px-1.5 py-0.5 text-[9px] font-mono font-semibold"
                        >
                          @{file.name}
                        </span>
                      ))}
                    </div>
                  )}
                  <div>{activeInstruction}</div>
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

      {!hasHistory && (
        <div className="flex-1 flex flex-col items-center justify-center text-center select-none animate-fade-in gap-3">
          <svg width="24" height="24" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className="text-[var(--text-secondary)]" stroke="currentColor" strokeWidth="1.5"><g fill="none" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M23.204 6.103a1.5 1.5 0 0 1-2.122 0L17.9 2.921A1.5 1.5 0 0 1 17.9.8m-.175 10.676c-1.405 1.405-6.47 1.166-6.47 1.166s-.24-5.064 1.167-6.47a3.677 3.677 0 0 1 5.2.106a3.68 3.68 0 0 1 .103 5.198" /><path d="M14.995 9.332a.375.375 0 0 1 0-.75m0 .75a.375.375 0 0 0 0-.75" /><path strokeLinecap="round" strokeLinejoin="round" d="M8.5 14.25H6a2.25 2.25 0 0 0 0 4.5h14.5a2.25 2.25 0 0 1 0 4.5H.75" /></g></svg>
          <span className="text-[11px] font-semibold text-[var(--text-secondary)] font-sans">AI Assist</span>
          <div className="flex flex-col gap-1.5 text-[10px] text-[var(--text-muted)] font-sans leading-relaxed">
            <span>Select text to rewrite, or place cursor to insert</span>
            <span>Edit prompts in sidebar to customize</span>
            <span>@ to add context from your files</span>
          </div>
        </div>
      )}

      {/* Input Card always anchored cleanly at the bottom */}
      <div className="shrink-0 mt-auto pt-2">
        {renderInputCard()}
      </div>
    </div>
  )
}
