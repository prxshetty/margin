import { useState, useEffect, useRef } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { useEditorStore } from '../stores/editorStore'
import { API_BASE } from '../lib/api'
import type { FileEntry } from '../stores/editorStore'

const STORAGE_KEY = 'simple-assist-system-prompt'
const DEFAULT_PROMPT = `You are a writing assistant. Help the user improve their writing.
When asked to rewrite or generate text, output ONLY the new text without explanations or commentary.`

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

function buildTaggedContext(files: FileEntry[]): string {
  const tagged = files.filter((f) => f.tagged)
  if (tagged.length === 0) return ''
  const parts = tagged.map(
    (f) => `--- ${f.name} ---\n${f.content}`
  )
  return `\n\nReference files:\n${parts.join('\n\n')}`
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

export function SimpleAssist() {
  const {
    content, setContent, editor,
    selectedText, anchorPosition,
  } = useEditorStore()

  const openedFiles = useEditorStore((s) => s.openedFiles)
  const currentFilePath = useEditorStore((s) => s.currentFilePath)
  const updateFileContent = useEditorStore((s) => s.updateFileContent)
  const toggleFileTag = useEditorStore((s) => s.toggleFileTag)
  const taggedContext = buildTaggedContext(openedFiles)

  const [systemPrompt, setSystemPrompt] = useState(() => localStorage.getItem(STORAGE_KEY) || DEFAULT_PROMPT)
  const [instruction, setInstruction] = useState('')
  const [isWorking, setIsWorking] = useState(false)
  const [historyLogs, setHistoryLogs] = useState<SimpleLogEntry[]>([])
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({})
  const [activeInstruction, setActiveInstruction] = useState('')
  const [activeRefFiles, setActiveRefFiles] = useState<FileEntry[]>([])
  const [errorText, setErrorText] = useState('')

  const [showPromptModal, setShowPromptModal] = useState(false)
  const [tempPrompt, setTempPrompt] = useState(systemPrompt)

  const [showFileDropdown, setShowFileDropdown] = useState(false)
  const [fileQuery, setFileQuery] = useState('')
  const [selectedRefFiles, setSelectedRefFiles] = useState<FileEntry[]>([])

  const outputRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setWidth(entry.contentRect.width)
      }
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const isWide = width >= 220

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, systemPrompt)
  }, [systemPrompt])

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

  const filteredFiles = openedFiles.filter((f) =>
    fileQuery === '' || f.name.toLowerCase().startsWith(fileQuery.toLowerCase())
  ).slice(0, 5)

  const handleOpenSettings = () => {
    setTempPrompt(systemPrompt)
    setShowPromptModal(true)
  }

  const handleInstructionChange = (value: string) => {
    setInstruction(value)

    const atIndex = value.lastIndexOf('@')
    if (atIndex === -1 || (atIndex > 0 && value[atIndex - 1] !== ' ' && value[atIndex - 1] !== '\n')) {
      setShowFileDropdown(false)
      return
    }

    const afterAt = value.slice(atIndex + 1)
    const spaceIndex = afterAt.search(/[\s\n]/)
    const query = spaceIndex === -1 ? afterAt : afterAt.slice(0, spaceIndex)

    setFileQuery(query)
    setShowFileDropdown(true)
  }

  const handleSelectFile = (file: FileEntry) => {
    if (selectedRefFiles.some((f) => f.path === file.path)) return
    setSelectedRefFiles((prev) => [...prev, file])

    const atIndex = instruction.lastIndexOf('@')
    if (atIndex !== -1) {
      const afterAt = instruction.slice(atIndex + 1)
      const spaceIndex = afterAt.search(/[\s\n]/)
      const queryLen = spaceIndex === -1 ? afterAt.length : spaceIndex
      setInstruction(instruction.slice(0, atIndex) + instruction.slice(atIndex + 1 + queryLen))
    }
    setShowFileDropdown(false)
  }

  const handleRemoveFile = (path: string) => {
    setSelectedRefFiles((prev) => prev.filter((f) => f.path !== path))
  }

  const handleReplace = async () => {
    if (!selectedText || !instruction.trim() || !editor) return
    setIsWorking(true)
    setActiveInstruction(instruction)
    setActiveRefFiles(selectedRefFiles)
    setErrorText('')

    const currentInstruction = instruction
    const currentRefFiles = selectedRefFiles
    setInstruction('')
    setSelectedRefFiles([])

    try {
      const mentionContext = buildMentionContext(currentRefFiles)
      const fullContent = [content, taggedContext, mentionContext].filter(Boolean).join('\n\n')

      const res = await fetch(`${API_BASE}/api/assist/simple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: fullContent,
          message: currentInstruction,
          system_prompt: systemPrompt === DEFAULT_PROMPT ? null : systemPrompt,
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
    if (!instruction.trim() || !editor) return
    setIsWorking(true)
    setActiveInstruction(instruction)
    setActiveRefFiles(selectedRefFiles)
    setErrorText('')

    const currentInstruction = instruction
    const currentRefFiles = selectedRefFiles
    setInstruction('')
    setSelectedRefFiles([])

    try {
      const pos = anchorPosition
      const docSize = editor.state.doc.content.size
      const textBefore = editor.state.doc.textBetween(0, pos, '\n')
      const textAfter = editor.state.doc.textBetween(pos, docSize, '\n')

      const mentionContext = buildMentionContext(currentRefFiles)
      const fullContent = [content, taggedContext, mentionContext].filter(Boolean).join('\n\n')

      const res = await fetch(`${API_BASE}/api/assist/simple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: fullContent,
          message: currentInstruction,
          system_prompt: systemPrompt === DEFAULT_PROMPT ? null : systemPrompt,
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Backspace' && instruction === '' && hasSelection && editor) {
      e.preventDefault()
      editor.commands.setTextSelection(editor.state.selection.to)
      return
    }
    if (e.key === 'Escape' && showFileDropdown) {
      e.preventDefault()
      setShowFileDropdown(false)
    }
  }

  const hasHistory = historyLogs.length > 0 || isWorking || !!errorText

  const renderInputCard = () => (
    <div className="bg-[#FFFFFF] border border-[#E5E2DA] focus-within:border-slate-400 transition-all rounded-lg p-2.5 flex flex-col gap-2 shadow-none relative">
      <div className="flex items-start gap-1.5 w-full">
        {hasSelection && (
          <div className="flex items-center justify-center bg-[#EAEAEA] text-[#111111] rounded-[3px] px-1.5 h-4 text-[10px] font-mono select-none shrink-0 animate-fade-in">
            {selectedText.length} Ch
          </div>
        )}
        {selectedRefFiles.map((file) => (
          <div
            key={file.path}
            className="flex items-center gap-0.5 bg-[#EDF3EC] text-[#346538] rounded-[3px] px-1.5 h-4 text-[10px] font-mono select-none shrink-0 animate-fade-in"
          >
            <span>{file.name}</span>
            <button
              onClick={() => handleRemoveFile(file.path)}
              className="text-[#346538]/60 hover:text-[#346538] cursor-pointer"
            >
              <X className="w-2.5 h-2.5" strokeWidth={2.5} />
            </button>
          </div>
        ))}
        {openedFiles.filter((f) => f.tagged).map((file) => (
          <div
            key={`tagged-${file.path}`}
            className="flex items-center gap-0.5 bg-[#F1F0EC] text-[#787774] rounded-[3px] px-1.5 h-4 text-[10px] font-mono select-none shrink-0 animate-fade-in"
          >
            <span>{file.name}</span>
            <button
              onClick={() => toggleFileTag(file.path)}
              className="text-[#A0A09D]/60 hover:text-[#787774] cursor-pointer"
              title="Remove from AI context"
            >
              <X className="w-2.5 h-2.5" strokeWidth={2.5} />
            </button>
          </div>
        ))}
        <textarea
          value={instruction}
          onChange={(e) => handleInstructionChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder='Ask anything, @ to mention files'
          className="flex-1 min-w-0 bg-transparent border-0 p-0 text-xs focus:ring-0 focus:outline-none resize-none placeholder:text-slate-400 text-[#2F3437] min-h-[36px] font-sans"
          rows={2}
        />
      </div>

      {showFileDropdown && (
        <div
          ref={dropdownRef}
          className="absolute left-2.5 right-2.5 bottom-full mb-1 z-50 bg-white border border-[#E5E2DA] rounded-lg overflow-hidden"
        >
          {filteredFiles.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-[#787774] font-sans text-center">
              No matching results
            </div>
          ) : (
            <div className="max-h-[200px] overflow-y-auto">
              {filteredFiles.map((file) => (
                <button
                  key={file.path}
                  onClick={() => handleSelectFile(file)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[#F5F4F0] transition-colors cursor-pointer"
                >
                  <span className="text-xs text-[#2F3437] font-medium font-sans truncate">
                    {file.name}
                  </span>
                  <span className="text-[10px] text-[#A0A09D] font-sans truncate">
                    {file.path}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-0.5">
        <button
          onClick={handleOpenSettings}
          className="p-1.5 text-[#787774] hover:text-[#111111] rounded-[6px] hover:bg-[#F1F0EC]/80 transition-colors cursor-pointer border border-transparent active:scale-[0.96] transition-transform flex items-center justify-center"
          title="System Prompt Settings"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
            <line x1="4" y1="21" x2="4" y2="14" />
            <line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" />
            <line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" />
            <line x1="9" y1="8" x2="15" y2="8" />
            <line x1="17" y1="16" x2="23" y2="16" />
          </svg>
        </button>
        <button
          onClick={hasSelection ? handleReplace : handleInsert}
          disabled={!instruction.trim() || isWorking}
          className={`
            flex items-center justify-center gap-1 transition-all cursor-pointer select-none font-semibold text-xs border rounded-[6px] active:scale-[0.97] transition-transform
            bg-[#734f2d] hover:bg-[#5a3d22] text-white disabled:bg-[#F9F9F8] disabled:text-slate-400 border-transparent
            ${isWide ? 'px-3 py-1.5' : 'w-8 h-8'}
          `}
          title={hasSelection ? 'Replace Selection' : 'Insert Content'}
        >
          {isWorking ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            isWide ? (hasSelection ? 'Replace' : 'Insert') : '→'
          )}
        </button>
      </div>
    </div>
  )

  return (
    <div ref={containerRef} className={`flex flex-col gap-4 w-full h-full select-none ${hasHistory ? 'justify-between' : 'justify-center'}`}>
      <div className="flex flex-col items-center mb-1 select-none text-center shrink-0">
        <h2 className="font-serif italic text-base text-[#111111] tracking-tight">
          AI Assist
        </h2>
        <p className="text-[10px] text-[#787774] font-serif italic mt-0.5 max-w-[200px] leading-relaxed">
          Select text to rewrite, place cursor to insert.
        </p>
      </div>

      {hasHistory ? (
        <>
          <div className="flex-1 overflow-y-auto flex flex-col gap-4 pr-1 min-h-0 select-text">
            {historyLogs.map((log) => {
              const isExpanded = !!expandedIds[log.id]
              return (
                <div key={log.id} className="flex flex-col gap-3">
                  <div className="self-end max-w-[85%] bg-[#F1F0EC] border border-[#E5E2DA] rounded-2xl rounded-tr-[4px] px-3.5 py-2.5 font-sans text-xs text-[#2F3437] shadow-none leading-relaxed select-text flex flex-col gap-1.5">
                    {log.ref_files && log.ref_files.length > 0 && (
                      <div className="flex flex-wrap gap-1 select-none">
                        {log.ref_files.map((file) => (
                          <span
                            key={file.path}
                            className="bg-[#EDF3EC] text-[#346538] border border-[#D5E6D3] rounded-[3px] px-1.5 py-0.5 text-[9px] font-mono font-semibold"
                          >
                            @{file.name}
                          </span>
                        ))}
                      </div>
                    )}
                    <div>{cleanUserPrompt(log)}</div>
                  </div>

                  <div className="flex flex-col gap-2 select-text">
                    <div className="flex flex-col gap-1 w-full self-start py-1 transition-all select-none">
                      <button
                        onClick={() => setExpandedIds(prev => ({ ...prev, [log.id]: !prev[log.id] }))}
                        className="flex items-center gap-1 text-xs text-[#787774] font-sans transition-colors cursor-pointer text-left hover:text-[#111111] w-fit"
                      >
                        <span>Thinking</span>
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`w-3 h-3 transition-transform duration-200 text-[#787774]/70 ${isExpanded ? 'rotate-90' : ''}`}>
                          <path d="m9 18 6-6-6-6"/>
                        </svg>
                      </button>

                      {isExpanded && (
                        <div className="text-xs font-sans text-[#2F3437] leading-relaxed select-text whitespace-pre-wrap mt-1.5 pl-2.5 border-l border-[#EAEAEA] pr-1 animate-fade-in">
                          {log.output}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 text-xs text-[#2F3437] font-sans py-0.5 self-start select-none">
                      <span>✓ {log.mode === 'insert' ? 'Insertion' : 'Edit'} applied successfully</span>
                    </div>
                  </div>
                </div>
              )
            })}

            {isWorking && activeInstruction && (
              <div className="flex flex-col gap-3 animate-fade-in">
                <div className="self-end max-w-[85%] bg-[#F1F0EC] border border-[#E5E2DA] rounded-2xl rounded-tr-[4px] px-3.5 py-2.5 font-sans text-xs text-[#2F3437] shadow-none leading-relaxed select-text flex flex-col gap-1.5 opacity-70">
                  {activeRefFiles && activeRefFiles.length > 0 && (
                    <div className="flex flex-wrap gap-1 select-none">
                      {activeRefFiles.map((file) => (
                        <span
                          key={file.path}
                          className="bg-[#EDF3EC] text-[#346538] border border-[#D5E6D3] rounded-[3px] px-1.5 py-0.5 text-[9px] font-mono font-semibold"
                        >
                          @{file.name}
                        </span>
                      ))}
                    </div>
                  )}
                  <div>{activeInstruction}</div>
                </div>

                <div className="flex flex-col gap-1.5 w-full animate-pulse self-start py-1 select-none" ref={outputRef}>
                  <div className="flex items-center gap-1.5 text-xs text-[#787774] font-sans">
                    <RefreshCw className="w-3 h-3 animate-spin text-[#734f2d]" />
                    <span>Thinking...</span>
                  </div>
                  <div className="flex flex-col gap-1.5 w-40 mt-1 pl-2.5">
                    <div className="h-1.5 bg-[#F1F0EC] rounded-full w-full" />
                    <div className="h-1.5 bg-[#F1F0EC] rounded-full w-5/6" />
                    <div className="h-1.5 bg-[#F1F0EC] rounded-full w-2/3" />
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

          <div className="shrink-0">
            {renderInputCard()}
          </div>
        </>
      ) : (
        renderInputCard()
      )}

      {showPromptModal && (
        <div className="fixed inset-0 bg-[#111111]/20 backdrop-blur-[2px] flex items-center justify-center p-4 z-[99999] animate-fade-in select-none">
          <div className="bg-[#FFFFFF] rounded-lg border border-[#EAEAEA] w-full max-w-sm overflow-hidden flex flex-col shadow-[0_4px_16px_rgba(0,0,0,0.03)] animate-scale-in">
            <div className="flex items-center justify-between px-4 py-3 bg-[#F9F9F8] border-b border-[#EAEAEA]">
              <span className="text-xs font-bold text-[#111111] uppercase tracking-wider flex items-center gap-1.5 font-sans">
                System Prompt
              </span>
              <button
                onClick={() => setShowPromptModal(false)}
                className="text-[#787774] hover:text-[#111111] font-normal text-lg leading-none cursor-pointer transition-colors active:scale-[0.95]"
              >
                &times;
              </button>
            </div>
            <div className="p-5 flex flex-col gap-3">
              <textarea
                value={tempPrompt}
                onChange={(e) => setTempPrompt(e.target.value)}
                className="w-full px-3 py-2 border border-[#EAEAEA] rounded-[6px] text-xs font-mono text-[#2F3437] outline-none focus:border-slate-400 focus:ring-0 resize-none bg-[#F9F9F8] min-h-[140px]"
                rows={6}
                placeholder="Enter custom instructions..."
              />
              <div className="flex items-center justify-between gap-2 mt-2 font-sans">
                <button
                  onClick={() => setTempPrompt(DEFAULT_PROMPT)}
                  className="text-[11px] text-[#787774] hover:text-[#111111] bg-transparent transition-colors cursor-pointer"
                >
                  Reset
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowPromptModal(false)}
                    className="px-3 py-1.5 text-xs text-[#787774] hover:text-[#111111] bg-transparent hover:bg-[#F9F9F8] border border-[#EAEAEA] rounded-[6px] transition-colors cursor-pointer active:scale-[0.97]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setSystemPrompt(tempPrompt)
                      setShowPromptModal(false)
                    }}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-[#734f2d] hover:bg-[#5a3d22] border border-transparent rounded-[6px] transition-all cursor-pointer active:scale-[0.97]"
                    title="Save Settings"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
