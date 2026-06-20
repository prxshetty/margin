import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { AtSign, Code2, MousePointer2, RefreshCw, Settings, Trash2 } from 'lucide-react'
import { useEditorStore } from '../stores/editorStore'
import { useSettingsStore } from '../stores/settingsStore'
import { API_BASE } from '../lib/api'
import type { FileEntry } from '../stores/editorStore'

interface SimpleLogEntry {
  id: string
  timestamp: string
  mode: 'chat' | 'edit_plan' | 'edit_write'
  session_id?: string
  system_prompt: string
  user_prompt: string
  output: string
  instruction?: string
  selected_text?: string
  text_before?: string
  text_after?: string
  ref_files?: Array<{ name: string, path: string }>
  success?: boolean
  thinking_output?: string
  planner_system_prompt?: string
  planner_user_prompt?: string
  planner_output?: string
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
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
  let text = ''
  if (log.instruction && log.instruction.trim()) {
    text = log.instruction.trim()
  } else {
    text = log.mode === 'chat' ? 'AI Assistant Query' : 'Edit text'
  }

  const hasAt = text.includes('@')
  if (!hasAt) {
    // Prepend ref files + selection before the text so chips lead the bubble
    let prefix = ''
    if (log.ref_files && log.ref_files.length > 0) {
      prefix += log.ref_files.map(f => `@${f.name}`).join(' ') + ' '
    }
    if (log.mode !== 'chat' && log.selected_text) {
      prefix += `@selection(${formatCharacterCount(log.selected_text.length)}) `
    }
    text = prefix + text
  }
  return text
}

function renderUserPrompt(text: string) {
  const regex = /@([\w.-]+(?:\([^)]+\))?)/g
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const name = match[1]
    const isSelection = name.startsWith('selection(')
    const label = isSelection ? name.replace(/^selection\((.*)\)$/, '$1') : name

    // File tags get the neutral pill style; only cursor-selection gets the green accent
    parts.push(
      <span key={match.index} className={`inline-chip${isSelection ? ' inline-chip-selection' : ''} align-middle mx-0.5`}>
        <span className="chip-glyph flex items-center">
          {isSelection ? (
            <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m4 4 7.07 16.97 2.51-7.39 7.39-2.51L4 4Z" />
              <path d="m13 13 6 6" />
            </svg>
          ) : (
            <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11.688 3.063a3.5 3.5 0 0 1 1.027.712l5.968 5.97c.3.3.54.647.711 1.026m-7.706-7.708a3.5 3.5 0 0 0-1.448-.313H7.792a3.5 3.5 0 0 0-3.5 3.5v11.5a3.5 3.5 0 0 0 3.5 3.5h8.416a3.5 3.5 0 0 0 3.5-3.5v-5.53c0-.505-.109-.999-.314-1.45m-7.706-7.707V8.77a2 2 0 0 0 2 2h5.706" />
            </svg>
          )}
        </span>
        <span className="chip-divider" />
        <span className="chip-label">{label}</span>
      </span>
    )
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
}

function formatCharacterCount(length: number): string {
  return `${length.toLocaleString()} ch`
}

function appendChipText(chip: HTMLElement, label: string, removeDataset: Record<string, string>) {
  const glyphEl = document.createElement('span')
  glyphEl.className = 'chip-glyph flex items-center'
  glyphEl.innerHTML = `<svg class="w-2.5 h-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M11.688 3.063a3.5 3.5 0 0 1 1.027.712l5.968 5.97c.3.3.54.647.711 1.026m-7.706-7.708a3.5 3.5 0 0 0-1.448-.313H7.792a3.5 3.5 0 0 0-3.5 3.5v11.5a3.5 3.5 0 0 0 3.5 3.5h8.416a3.5 3.5 0 0 0 3.5-3.5v-5.53c0-.505-.109-.999-.314-1.45m-7.706-7.707V8.77a2 2 0 0 0 2 2h5.706"/>
  </svg>`

  const divider = document.createElement('span')
  divider.className = 'chip-divider'

  const labelEl = document.createElement('span')
  labelEl.className = 'chip-label'
  labelEl.textContent = label

  const removeButton = document.createElement('button')
  removeButton.className = 'chip-remove'
  removeButton.type = 'button'
  removeButton.textContent = '×'
  Object.entries(removeDataset).forEach(([key, value]) => {
    removeButton.dataset[key] = value
  })

  chip.appendChild(glyphEl)
  chip.appendChild(divider)
  chip.appendChild(labelEl)
  chip.appendChild(removeButton)
}

function appendSelectionChipText(chip: HTMLElement, length: number) {
  const glyphEl = document.createElement('span')
  glyphEl.className = 'chip-glyph flex items-center'
  glyphEl.innerHTML = `<svg class="w-2.5 h-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m4 4 7.07 16.97 2.51-7.39 7.39-2.51L4 4Z" />
    <path d="m13 13 6 6" />
  </svg>`

  const divider = document.createElement('span')
  divider.className = 'chip-divider'

  const labelEl = document.createElement('span')
  labelEl.className = 'chip-label'
  labelEl.textContent = formatCharacterCount(length)

  const removeButton = document.createElement('button')
  removeButton.className = 'chip-remove'
  removeButton.type = 'button'
  removeButton.dataset.role = 'selection-remove'
  removeButton.textContent = '×'

  chip.appendChild(glyphEl)
  chip.appendChild(divider)
  chip.appendChild(labelEl)
  chip.appendChild(removeButton)
}

function PlanModeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path fill="currentColor" d="M2 2h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm4.655 8.595a.75.75 0 0 1 0 1.06L4.03 14.28a.75.75 0 0 1-1.06 0l-1.5-1.5a.749.749 0 0 1 .326-1.275a.749.749 0 0 1 .734.215l.97.97l2.095-2.095a.75.75 0 0 1 1.06 0ZM9.75 2.5h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1 0-1.5Zm0 5h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1 0-1.5Zm0 5h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1 0-1.5Zm-7.25-9v3h3v-3Z" />
    </svg>
  )
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

function getInputData(el: HTMLElement): {
  text: string
  refPaths: string[]
  selection: { text: string; from: number; to: number } | null
} {
  const refPaths: string[] = []
  el.querySelectorAll<HTMLElement>('[data-path]').forEach((chip) => {
    refPaths.push(chip.dataset.path ?? '')
  })

  let selection: { text: string; from: number; to: number } | null = null
  const selectionChip = el.querySelector<HTMLElement>('[data-role="selection"]')
  if (selectionChip) {
    selection = {
      text: selectionChip.dataset.text ?? '',
      from: Number(selectionChip.dataset.from ?? '0'),
      to: Number(selectionChip.dataset.to ?? '0'),
    }
  }

  const clone = el.cloneNode(true) as HTMLElement
  clone.querySelectorAll<HTMLElement>('.inline-chip').forEach((chip) => {
    if (chip.dataset.role === 'selection') {
      const len = selection?.text.length || 0
      const textNode = document.createTextNode(`@selection(${formatCharacterCount(len)})`)
      chip.replaceWith(textNode)
    } else if (chip.dataset.name) {
      const textNode = document.createTextNode(`@${chip.dataset.name}`)
      chip.replaceWith(textNode)
    } else {
      chip.remove()
    }
  })
  return { text: clone.textContent?.trim() ?? '', refPaths, selection }
}

function renderMarkdown(text: string): React.ReactNode[] {
  if (!text) return []
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      nodes.push(
        <pre key={i} className="bg-[var(--bg-hover)] rounded-[6px] px-3 py-2 my-1.5 overflow-x-auto">
          <code className="text-[11px] font-mono text-[var(--text)]">
            {lang && <span className="text-[var(--text-muted)] text-[9px] uppercase tracking-widest block mb-1">{lang}</span>}
            {codeLines.join('\n')}
          </code>
        </pre>
      )
      i++ // skip closing ```
      continue
    }

    // Headings
    const h6 = line.match(/^###### (.+)/)
    const h5 = line.match(/^##### (.+)/)
    const h4 = line.match(/^#### (.+)/)
    const h3 = line.match(/^### (.+)/)
    const h2 = line.match(/^## (.+)/)
    const h1 = line.match(/^# (.+)/)
    if (h1) { nodes.push(<p key={i} className="font-semibold text-[var(--text-heading)] mt-2 mb-0.5">{inlineMarkdown(h1[1])}</p>); i++; continue }
    if (h2) { nodes.push(<p key={i} className="font-semibold text-[var(--text-heading)] mt-1.5 mb-0.5 text-[11px]">{inlineMarkdown(h2[1])}</p>); i++; continue }
    if (h3) { nodes.push(<p key={i} className="font-medium text-[var(--text-secondary)] mt-1 mb-0.5 text-[10px] uppercase tracking-wide">{inlineMarkdown(h3[1])}</p>); i++; continue }
    if (h4) { nodes.push(<p key={i} className="font-medium text-[var(--text-secondary)] mt-0.5 mb-0.5 text-[10px] uppercase tracking-wide">{inlineMarkdown(h4[1])}</p>); i++; continue }
    if (h5) { nodes.push(<p key={i} className="font-medium text-[var(--text-muted)] mt-0.5 mb-0.5 text-[9px] uppercase tracking-wide">{inlineMarkdown(h5[1])}</p>); i++; continue }
    if (h6) { nodes.push(<p key={i} className="font-medium text-[var(--text-muted)] mt-0.5 mb-0.5 text-[9px] uppercase tracking-wide">{inlineMarkdown(h6[1])}</p>); i++; continue }

    // Blockquote
    if (line.startsWith('> ')) {
      nodes.push(
        <div key={i} className="border-l-2 border-[var(--border)] pl-2.5 my-1 text-[var(--text-secondary)] italic">
          {inlineMarkdown(line.slice(2))}
        </div>
      )
      i++; continue
    }

    // Horizontal rule
    if (/^[-*]{3,}$/.test(line.trim())) {
      nodes.push(<hr key={i} className="border-[var(--border)] my-2" />)
      i++; continue
    }

    // Bullet list
    if (/^[-*+] /.test(line)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && /^[-*+] /.test(lines[i])) {
        items.push(<li key={i}>{inlineMarkdown(lines[i].slice(2))}</li>)
        i++
      }
      nodes.push(<ul key={`ul-${i}`} className="list-disc list-inside my-1 space-y-0.5">{items}</ul>)
      continue
    }

    // Numbered list
    if (/^\d+\. /.test(line)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(<li key={i}>{inlineMarkdown(lines[i].replace(/^\d+\. /, ''))}</li>)
        i++
      }
      nodes.push(<ol key={`ol-${i}`} className="list-decimal list-inside my-1 space-y-0.5">{items}</ol>)
      continue
    }

    // Empty line → spacing
    if (line.trim() === '') {
      nodes.push(<div key={i} className="h-1.5" />)
      i++; continue
    }

    // Normal paragraph
    nodes.push(<p key={i} className="my-0.5 leading-relaxed">{inlineMarkdown(line)}</p>)
    i++
  }

  return nodes
}

function inlineMarkdown(text: string): React.ReactNode[] {
  // Handle bold, italic, inline code in sequence
  const parts: React.ReactNode[] = []
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|_[^_]+_)/g
  let last = 0
  let m: RegExpExecArray | null
  let idx = 0
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const raw = m[0]
    if (raw.startsWith('`')) {
      parts.push(<code key={idx++} className="bg-[var(--bg-hover)] px-1 py-0.5 rounded text-[10.5px] font-mono">{raw.slice(1, -1)}</code>)
    } else if (raw.startsWith('**') || raw.startsWith('__')) {
      parts.push(<strong key={idx++} className="font-semibold text-[var(--text-heading)]">{raw.slice(2, -2)}</strong>)
    } else {
      parts.push(<em key={idx++} className="italic text-[var(--text-secondary)]">{raw.slice(1, -1)}</em>)
    }
    last = m.index + raw.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function ThinkingDropdown({ text, defaultOpen = false }: { text: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (defaultOpen) setOpen(true)
  }, [defaultOpen])

  return (
    <div className="flex flex-col gap-0 self-start w-full mb-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] font-sans hover:text-[var(--text-secondary)] transition-colors select-none py-0.5 w-fit"
      >
        <svg
          className={`w-2.5 h-2.5 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        {text && !open ? 'Thought Process' : open ? 'Thought Process' : 'Thinking'}
      </button>
      {open && (
        <div className="font-mono text-[10px] text-[var(--text-muted)] leading-relaxed max-h-[120px] overflow-y-auto whitespace-pre-wrap pl-4 border-l border-[var(--border-subtle)] mt-1">
          {text}
        </div>
      )}
    </div>
  )
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
  const [isPlanning, setIsPlanning] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [plannerContextFiles, setPlannerContextFiles] = useState<string[]>([])
  const [streamingThinkingText, setStreamingThinkingText] = useState('')
  const [streamingChatText, setStreamingChatText] = useState('')
  const [instructionText, setInstructionText] = useState('')
  const [historyLogs, setHistoryLogs] = useState<SimpleLogEntry[]>([])
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const handleCopyPrompt = async (log: SimpleLogEntry) => {
    const textToCopy = log.instruction || log.user_prompt || cleanUserPrompt(log)
    try {
      await navigator.clipboard.writeText(textToCopy)
      setCopiedId(log.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (err) {
      console.error('Failed to copy prompt text:', err)
    }
  }

  const [activeInstruction, setActiveInstruction] = useState('')
  const [activeRefFiles, setActiveRefFiles] = useState<FileEntry[]>([])
  const [errorText, setErrorText] = useState('')
  const [currentSessionId, setCurrentSessionId] = useState(() => Date.now().toString(36))
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [showHistoryDropdown, setShowHistoryDropdown] = useState(false)
  const [sessionLoadCount, setSessionLoadCount] = useState(3)
  const [mode, setMode] = useState<'chat' | 'edit'>('edit')
  const hasSelection = !!pendingEditSelection
  const { settings, fetchSettings, setShowSettings } = useSettingsStore()



  useEffect(() => {
    fetchSettings()
  }, [])

  useEffect(() => {
    if (settings?.default_mode) {
      setMode(settings.default_mode as 'chat' | 'edit')
    }
  }, [settings?.default_mode])

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

  const sessions = useMemo(() => {
    const map = new Map<string, { name: string; logCount: number; timestamp: string }>()
    const sessionLogs = new Map<string, SimpleLogEntry[]>()
    for (const log of historyLogs) {
      const sid = log.session_id || ''
      if (!sid) continue
      if (!sessionLogs.has(sid)) sessionLogs.set(sid, [])
      sessionLogs.get(sid)!.push(log)
    }
    for (const [sid, logs] of sessionLogs) {
      const first = logs.reduce((a, b) => a.timestamp < b.timestamp ? a : b)
      const raw = first.instruction || ''
      const name = raw.slice(0, 35) + (raw.length > 35 ? '...' : '') || 'Assist'
      const latest = logs.reduce((a, b) => a.timestamp > b.timestamp ? a : b)
      map.set(sid, { name, logCount: logs.length, timestamp: latest.timestamp })
    }
    return Array.from(map.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  }, [historyLogs])

  const filteredLogs = activeSessionId
    ? historyLogs.filter(l => l.session_id === activeSessionId)
    : historyLogs

  const displayLogs = useMemo(() =>
    filteredLogs.filter(l => l.mode !== 'edit_plan'),
    [filteredLogs]
  )


  const activeContextWindow = useMemo(() => {
    if (!settings) return 8192
    if (settings.active_endpoint && settings.endpoints[settings.active_endpoint]) {
      return settings.endpoints[settings.active_endpoint].context_window || 8192
    }
    return settings.default_context_window || 8192
  }, [settings])

  const latestInputTokens = useMemo(() => {
    if (filteredLogs.length === 0) return 0
    const lastLog = filteredLogs[filteredLogs.length - 1]
    return lastLog.prompt_tokens || 0
  }, [filteredLogs])

  const latestOutputTokens = useMemo(() => {
    if (filteredLogs.length === 0) return 0
    const lastLog = filteredLogs[filteredLogs.length - 1]
    return lastLog.completion_tokens || 0
  }, [filteredLogs])

  const percentUsed = useMemo(() => {
    if (!activeContextWindow) return 0
    const total = latestInputTokens + latestOutputTokens
    return (total / activeContextWindow) * 100
  }, [latestInputTokens, latestOutputTokens, activeContextWindow])

  const percentLeft = useMemo(() => {
    return Math.max(0, 100 - percentUsed)
  }, [percentUsed])

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
    const { text, selection: domSelection } = getInputData(el)
    setInstructionText(text)

    if (!domSelection && pendingEditSelection) {
      setPendingEditSelection(null)
    }

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
    appendChipText(chip, file.name, { path: file.path })

    const isEditorContent = file.name === 'editorcontent.ts'
    const zwsp = document.createTextNode(isEditorContent ? '\u200B ' : '\u200B')
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
    const activeEditor = useEditorStore.getState().editor || editor
    if (!activeEditor || activeEditor.isDestroyed || !activeEditor.view || !activeEditor.state) return
    const inputEl = inputRef.current!
    const { text: currentInstruction, refPaths, selection: domSelection } = getInputData(inputEl)
    if (!currentInstruction) return

    const selectionInfo = domSelection
    const localHasSelection = !!selectionInfo
    const selectionText = selectionInfo ? selectionInfo.text : ''
    setIsWorking(true)
    setIsPlanning(true)
    setIsGenerating(false)
    setPlannerContextFiles([])
    setStreamingThinkingText('')
    setStreamingChatText('')
    setActiveInstruction(currentInstruction)
    const currentRefFiles = Array.from(new Set(refPaths))
      .map(path => openedFiles.find(f => f.path === path))
      .filter((f): f is FileEntry => !!f)
    setActiveRefFiles(currentRefFiles)
    setErrorText('')

    if (inputRef.current) {
      inputRef.current.textContent = ''
      setInstructionText('')
    }

    try {
      const mentionContext = buildMentionContext(currentRefFiles)
      const fullContent = [content, mentionContext].filter(Boolean).join('\n\n')

      const cleanMessage = currentInstruction
        .replace(/\s*@selection\([^)]*\)\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

      const activeFilename = currentFilePath ? currentFilePath.split('/').pop() : undefined

      const body: Record<string, unknown> = {
        content: fullContent,
        message: cleanMessage,
        mode: 'edit',
        session_id: currentSessionId,
        ref_files: currentRefFiles.map(f => ({ name: f.name, path: f.path })),
        available_files: openedFiles.map(f => ({ name: f.name, path: f.path })),
        active_filename: activeFilename,
      }

      if (localHasSelection) {
        body.selected_text = selectionText
      } else {
        const doc = activeEditor.state.doc
        let cursorParagraphText = ''
        doc.forEach((node, offset) => {
          if (node.type.name === 'paragraph' || node.type.name === 'heading') {
            const from = offset
            const to = offset + node.nodeSize
            if (anchorPosition >= from && anchorPosition < to) {
              cursorParagraphText = node.textContent
            }
          }
        })
        if (cursorParagraphText) {
          body.cursor_paragraph_text = cursorParagraphText
        }
      }

      const res = await fetch(`${API_BASE}/api/assist/simple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        throw new Error('Edit failed')
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let accumulatedOutput = ''
      let isStreaming = false
      const startPos = localHasSelection && selectionInfo ? selectionInfo.from : anchorPosition
      let currentEndPos = localHasSelection && selectionInfo ? selectionInfo.to : anchorPosition
      const previousContent = useEditorStore.getState().content

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const cleanLine = line.trim()
          if (!cleanLine.startsWith('data: ')) continue
          const rawData = cleanLine.slice(6)
          try {
            const data = JSON.parse(rawData)
            if (data.status === 'planning') {
              setIsPlanning(true)
              setIsGenerating(false)
            } else if (data.status === 'context_resolved') {
              if (Array.isArray(data.context_needed)) {
                setPlannerContextFiles(data.context_needed)
              }
            } else if (data.status === 'generating') {
              setIsPlanning(false)
              setIsGenerating(true)
            } else if (data.status === 'thinking_chunk') {
              setStreamingThinkingText(prev => prev + (data.chunk as string))
            } else if (data.status === 'chunk') {
              setIsPlanning(false)
              setIsGenerating(true)
              const chunk = data.chunk as string
              accumulatedOutput += chunk
              const liveEditor = useEditorStore.getState().editor || activeEditor
              if (liveEditor && liveEditor.view && liveEditor.state && !liveEditor.isDestroyed) {
                let tr
                if (!isStreaming) {
                  tr = liveEditor.state.tr.insertText(chunk, startPos, currentEndPos)
                  isStreaming = true
                } else {
                  tr = liveEditor.state.tr.insertText(chunk, currentEndPos)
                }
                liveEditor.view.dispatch(tr)
                currentEndPos = tr.mapping.map(currentEndPos)
                liveEditor.commands.setAiHighlight(startPos, currentEndPos)
                liveEditor.commands.setTextSelection(currentEndPos)
              }
            } else if (data.status === 'applied') {
              if (data.model_used) {
                useEditorStore.getState().setActiveModel(data.model_used)
              }
              const output = data.output

              const liveEditor = useEditorStore.getState().editor || activeEditor
              if (liveEditor && liveEditor.view && liveEditor.state && !liveEditor.isDestroyed) {
                const setAiPendingEdit = useEditorStore.getState().setAiPendingEdit
                const beforeSize = liveEditor.state.doc.content.size

                setAiPendingEdit({
                  previousContent,
                  selectionRange: localHasSelection && selectionInfo ? { from: selectionInfo.from, to: selectionInfo.to } : null,
                  highlightFrom: startPos
                })

                let chain = liveEditor.chain()
                chain = chain.deleteRange({ from: startPos, to: currentEndPos })
                chain = chain.insertContentAt(startPos, output)
                chain.run()

                const afterSize = liveEditor.state.doc.content.size
                const endPos = currentEndPos + (afterSize - beforeSize)

                if (endPos > startPos) {
                  liveEditor.commands.setAiHighlight(startPos, endPos)
                  liveEditor.commands.setTextSelection(endPos)
                }

                const storage = liveEditor.storage as unknown as MarkdownStorage
                if (storage.markdown) {
                  const md = storage.markdown.getMarkdown()
                  setContent(md)
                  if (currentFilePath) updateFileContent(currentFilePath, md)
                }
              }
              setPendingEditSelection(null)
            } else if (data.status === 'error') {
              throw new Error(data.detail || 'Edit failed')
            }
          } catch (e) {
            console.error('Error parsing stream chunk:', e)
          }
        }
      }
      await fetchLogs()
    } catch (err) {
      console.error(err)
      setErrorText('Error: ' + (err as Error).message)
    } finally {
      setIsWorking(false)
      setIsPlanning(false)
      setIsGenerating(false)
      setPlannerContextFiles([])
      setStreamingThinkingText('')
      setStreamingChatText('')
      setActiveInstruction('')
      setActiveRefFiles([])
    }
  }

  const handleChat = async () => {
    if (!editor) return
    const inputEl = inputRef.current!
    const { text: currentInstruction, refPaths, selection: domSelection } = getInputData(inputEl)
    if (!currentInstruction) return

    const selectionInfo = domSelection
    const localHasSelection = !!selectionInfo
    const selectionText = selectionInfo ? selectionInfo.text : ''

    setIsWorking(true)
    setIsPlanning(true)
    setIsGenerating(false)
    setPlannerContextFiles([])
    setStreamingThinkingText('')
    setStreamingChatText('')
    setActiveInstruction(currentInstruction)
    const currentRefFiles = Array.from(new Set(refPaths))
      .map(path => openedFiles.find(f => f.path === path))
      .filter((f): f is FileEntry => !!f)
    setActiveRefFiles(currentRefFiles)
    setErrorText('')

    if (inputRef.current) {
      inputRef.current.textContent = ''
      setInstructionText('')
    }

    try {
      const currentRefFilesToInject = currentRefFiles.filter(f => f.path !== currentFilePath)
      const mentionContext = buildMentionContext(currentRefFilesToInject)
      const fullContent = [content, mentionContext].filter(Boolean).join('\n\n')

      const cleanMessage = currentInstruction
        .replace(/\s*@selection\([^)]*\)\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

      const activeFilename = currentFilePath ? currentFilePath.split('/').pop() : undefined

      const body: Record<string, unknown> = {
        content: fullContent,
        message: cleanMessage,
        mode: 'chat',
        session_id: currentSessionId,
        ref_files: currentRefFiles.map(f => ({ name: f.name, path: f.path })),
        available_files: openedFiles.map(f => ({ name: f.name, path: f.path })),
        active_filename: activeFilename,
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
        throw new Error('Chat failed')
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const cleanLine = line.trim()
          if (!cleanLine.startsWith('data: ')) continue
          const rawData = cleanLine.slice(6)
          try {
            const data = JSON.parse(rawData)
            if (data.status === 'planning') {
              setIsPlanning(true)
              setIsGenerating(false)
            } else if (data.status === 'context_resolved') {
              if (Array.isArray(data.context_needed)) {
                setPlannerContextFiles(data.context_needed)
              }
            } else if (data.status === 'generating') {
              setIsPlanning(false)
              setIsGenerating(true)
            } else if (data.status === 'thinking_chunk') {
              setStreamingThinkingText(prev => prev + (data.chunk as string))
            } else if (data.status === 'chunk') {
              setIsPlanning(false)
              setIsGenerating(true)
              setStreamingChatText(prev => prev + (data.chunk as string))
            } else if (data.status === 'chat') {
              if (data.model_used) {
                useEditorStore.getState().setActiveModel(data.model_used)
              }
            } else if (data.status === 'error') {
              throw new Error(data.detail || 'Chat failed')
            }
          } catch (e) {
            console.error('Error parsing stream chunk:', e)
          }
        }
      }
      await fetchLogs()
    } catch (err) {
      console.error(err)
      setErrorText('Error: ' + (err as Error).message)
    } finally {
      setIsWorking(false)
      setIsPlanning(false)
      setIsGenerating(false)
      setPlannerContextFiles([])
      setStreamingThinkingText('')
      setStreamingChatText('')
      setActiveInstruction('')
      setActiveRefFiles([])
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
      if (e.shiftKey) {
        document.execCommand('insertText', false, '\n')
      } else {
        if (instructionText && !isWorking) {
          if (mode === 'chat') {
            handleChat()
          } else {
            handleEdit()
          }
        }
      }
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
        const isSelection = chip.dataset.role === 'selection'
        chip.remove()
        if (isSelection) {
          setPendingEditSelection(null)
        }
        handleInput()
      }
    }
  }

  // Handle sync of pendingEditSelection into inline tag chips and autofocus
  useEffect(() => {
    const div = inputRef.current
    if (!div) return

    if (pendingEditSelection) {
      // Find and remove any existing selection chip first to avoid duplicates
      const existingSelectionChip = div.querySelector('[data-role="selection"]')
      if (existingSelectionChip) {
        existingSelectionChip.remove()
      }

      // Create the new selection tag/chip
      const chip = document.createElement('span')
      chip.contentEditable = 'false'
      chip.className = 'inline-chip inline-chip-selection'
      chip.dataset.role = 'selection'
      chip.dataset.from = String(pendingEditSelection.from)
      chip.dataset.to = String(pendingEditSelection.to)
      chip.dataset.text = pendingEditSelection.text

      const len = pendingEditSelection.text.length
      appendSelectionChipText(chip, len)

      // Insert it at current selection/caret of input, or at the end if not inside
      const sel = window.getSelection()
      let range: Range | null = null
      if (sel && sel.rangeCount > 0) {
        const potentialRange = sel.getRangeAt(0)
        if (div.contains(potentialRange.startContainer)) {
          range = potentialRange
        }
      }

      if (!range) {
        range = document.createRange()
        range.selectNodeContents(div)
        range.collapse(false)
      }

      // Add a space after the selection tag.
      const zwsp = document.createTextNode('\u200B ')
      const fragment = document.createDocumentFragment()
      fragment.appendChild(chip)
      fragment.appendChild(zwsp)
      range.insertNode(fragment)

      // Focus and move caret after the space
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
        handleInput()
      }, 0)
    } else {
      // When pendingEditSelection is null, clean up the selection chip if it exists in DOM
      const existingSelectionChip = div.querySelector('[data-role="selection"]')
      if (existingSelectionChip) {
        existingSelectionChip.remove()
        handleInput()
      }
    }
  }, [pendingEditSelection])

  const hasHistory = filteredLogs.length > 0 || isWorking || !!errorText

  const renderInputCard = () => (
    <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] focus-within:border-[var(--text-muted)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] duration-200 rounded-[14px] pt-3 px-3 pb-2 flex flex-col relative animate-scale-in">
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
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors cursor-pointer ${index === highlightedIndex
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
        <div className="flex items-center">
          <button
            onClick={() => setMode(mode === 'edit' ? 'chat' : 'edit')}
            className={`flex items-center justify-center w-6 h-6 rounded-full transition-all duration-200 cursor-pointer -ml-1.5 ${mode === 'edit'
              ? 'text-[var(--accent-brown)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)]'
              }`}
            title={mode === 'edit' ? 'Switch to Chat mode' : 'Switch to Plan mode'}
          >
            <PlanModeIcon />
          </button>
        </div>

        {/* Context Ring and Action Button Group */}
        <div className="flex items-center gap-2 -mr-1.5">
          {/* Circular Context Ring */}
          <div
            className={`group relative flex items-center gap-1.5 ${percentUsed === 0 ? 'opacity-45' : 'opacity-100'} transition-opacity duration-200`}
          >
            <span className="text-[10px] font-mono text-[var(--text-secondary)]">{Math.round(percentUsed)}%</span>
            <div className={`relative w-6 h-6 ${percentUsed >= 90 ? 'animate-pulse' : ''}`}>
              <svg viewBox="0 0 24 24" className="w-full h-full -rotate-90">
                <circle
                  cx="12" cy="12" r="9" strokeWidth="2"
                  className="fill-none stroke-[var(--border-subtle)]"
                />
                <circle
                  cx="12" cy="12" r="9" strokeWidth="2"
                  className="fill-none"
                  style={{
                    strokeDasharray: '56.55',
                    strokeDashoffset: `${56.55 * (1 - Math.min(100, percentUsed) / 100)}`,
                    stroke: percentUsed >= 90 ? '#ef4444' : percentUsed >= 70 ? '#d97706' : 'var(--accent-brown)',
                    transition: 'stroke-dashoffset 0.4s ease, stroke 0.4s ease'
                  }}
                  strokeLinecap="round"
                />
              </svg>
            </div>

            {/* Custom Tooltip */}
            <div className="pointer-events-none absolute bottom-[calc(100%+8px)] right-0 opacity-0 group-hover:opacity-100 transition-opacity bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[0_4px_16px_rgba(0,0,0,0.06)] rounded-[8px] p-2.5 z-50 whitespace-nowrap text-[10.5px] font-mono text-[var(--text-secondary)] leading-relaxed flex flex-col gap-0.5 animate-fade-in origin-bottom-right">
              <div className="flex justify-between gap-4">
                <span>Input tokens:</span>
                <span className="text-[var(--text)]">{latestInputTokens.toLocaleString()}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Output tokens:</span>
                <span className="text-[var(--text)]">{latestOutputTokens.toLocaleString()}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Context window:</span>
                <span className="text-[var(--text)]">{activeContextWindow.toLocaleString()}</span>
              </div>
              <div className="border-t border-[var(--border)] my-1"></div>
              <div className="flex justify-between gap-4">
                <span className="text-[var(--text)] font-medium">{percentUsed.toFixed(1)}% used</span>
                <span>({percentLeft.toFixed(1)}% left)</span>
              </div>
            </div>
          </div>

          {/* Action Button: Solid circular button with up arrow */}
          <button
            onClick={mode === 'chat' ? handleChat : handleEdit}
            disabled={!instructionText || isWorking}
            className="
              flex items-center justify-center transition-[background-color,transform,opacity] duration-150 cursor-pointer select-none border rounded-full w-6 h-6 shrink-0 active:scale-[0.9] bg-[var(--accent-brown)] hover:bg-[var(--accent-brown-hover)] text-[var(--text-inverse)] disabled:bg-[var(--bg-disabled)] disabled:text-[var(--text-disabled)] disabled:border-transparent border-transparent
            "
            title={mode === 'chat' ? 'Send Message' : hasSelection ? 'Replace Selection' : 'Insert Content'}
          >
            {isWorking ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div ref={containerRef} className="flex flex-col w-full h-full select-none animate-fade-in">
      {/* Header: tokens on left, actions on right */}
      <div className="flex items-center justify-between gap-1.5 pb-1.5 border-b border-[var(--border-sidebar)] select-none shrink-0 w-full animate-fade-in">
        {/* Header Title */}
        <div className="text-[12px] font-medium text-[var(--text-heading)] font-serif pl-1">
        </div>
        {/* Action Buttons Group */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              const newId = Date.now().toString(36)
              setCurrentSessionId(newId)
              setActiveSessionId(newId)
            }}
            className="flex items-center justify-center w-7 h-7 text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--border-sidebar)]/60 bg-[var(--bg-icon)]/20 rounded-[6px] transition-all cursor-pointer active:scale-[0.95]"
            title="New Chat"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <path d="M10 3v14M3 10h14" />
            </svg>
          </button>

          <div className="relative">
            <button
              onClick={() => setShowHistoryDropdown(!showHistoryDropdown)}
              className="flex items-center justify-center w-7 h-7 text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--border-sidebar)]/60 bg-[var(--bg-icon)]/20 rounded-[6px] transition-all cursor-pointer active:scale-[0.95]"
              title="History"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="var(--text-secondary)"><g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"><path d="M11.25 7.75v5h3" /><path d="M4.855 7.875a8.25 8.25 0 1 1-.824 6.26m-.176-5.26v-4.75m0 4.75h4.75" /></g></svg>
            </button>

            {showHistoryDropdown && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowHistoryDropdown(false)} />
                <div className="absolute right-0 top-full mt-1.5 z-50 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[10px] overflow-hidden shadow-[0_4px_16px_rgba(0,0,0,0.06)] w-[220px] py-1 animate-scale-in">
                  {sessions.length === 0 ? (
                    <div className="px-3 py-2 text-center text-[11px] text-[var(--text-muted)] font-sans">
                      No logs
                    </div>
                  ) : (
                    <>
                      {sessions.slice(0, sessionLoadCount).map(session => (
                        <div key={session.id} className="group flex items-center gap-1 px-2 py-1 rounded-[4px] mx-1 hover:bg-[var(--bg-hover)] transition-colors">
                          <button
                            onClick={() => { setActiveSessionId(session.id); setShowHistoryDropdown(false) }}
                            className={`flex-1 min-w-0 text-left text-[11px] cursor-pointer ${activeSessionId === session.id ? 'text-[var(--text-heading)]' : 'text-[var(--text-secondary)]'}`}
                          >
                            <span className="truncate block pr-1">{session.name}</span>
                          </button>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation()
                              try {
                                const res = await fetch(`${API_BASE}/api/assist/simple/session/${session.id}`, { method: 'DELETE' })
                                if (!res.ok) console.warn('DELETE session returned', res.status)
                              } catch (e) {
                                console.error('Failed to delete session:', e)
                              }
                              if (activeSessionId === session.id) setActiveSessionId(null)
                              await fetchLogs()
                            }}
                            className="flex items-center justify-center w-5 h-5 text-[var(--text-secondary)]/60 hover:text-red-500 hover:bg-[var(--border-sidebar)]/60 rounded-[4px] transition-all cursor-pointer active:scale-[0.9] opacity-0 group-hover:opacity-100"
                            title="Delete session"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      {sessions.length > sessionLoadCount && (
                        <button
                          onClick={() => setSessionLoadCount(c => c + 5)}
                          className="w-full px-3 py-2 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-heading)] text-center transition-colors hover:bg-[var(--bg-hover)] cursor-pointer"
                        >
                          Show {sessions.length - sessionLoadCount} more...
                        </button>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Settings Button */}
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center justify-center w-7 h-7 text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--border-sidebar)]/60 bg-[var(--bg-icon)]/20 rounded-[6px] transition-all cursor-pointer active:scale-[0.95]"
            title="Settings"
          >
            <Settings size={14} />
          </button>
        </div>
      </div>

      {/* History area (scrollable) */}
      {hasHistory && (
        <>
          <div className="flex-1 overflow-y-auto flex flex-col gap-4 pr-1 pt-2 min-h-0 select-text">
            {displayLogs.map((log) => {
              const isExpanded = !!expandedIds[log.id]

              const plannerContextFiles: string[] = (() => {
                if (!log.planner_output) return []
                try {
                  const start = log.planner_output.indexOf('{')
                  const end = log.planner_output.lastIndexOf('}') + 1
                  if (start !== -1 && end > start) {
                    const data = JSON.parse(log.planner_output.slice(start, end))
                    if (Array.isArray(data.context_needed)) {
                      return data.context_needed
                    }
                  }
                } catch (e) {
                  // ignore
                }
                return []
              })()

              return (
                <div key={log.id} className="flex flex-col gap-3">
                  {/* User Speech Capsule Bubble */}
                  <div className="self-end max-w-[85%] bg-[var(--bg-bubble)] border border-[var(--border)] rounded-[16px] rounded-tr-[4px] px-3.5 py-2.5 font-sans text-xs text-[var(--text)] shadow-none leading-relaxed select-text flex flex-wrap items-center gap-1 animate-scale-in relative group pr-8">
                    <span>{renderUserPrompt(cleanUserPrompt(log))}</span>
                    <button
                      onClick={() => handleCopyPrompt(log)}
                      className="absolute bottom-1.5 right-1.5 p-1 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer opacity-0 group-hover:opacity-100 duration-200"
                      title="Copy prompt"
                    >
                      {copiedId === log.id ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-600 dark:text-green-400">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                        </svg>
                      )}
                    </button>
                  </div>

                  {/* AI Assistant Plain Text Response */}
                  <div className="flex flex-col gap-1.5 self-start w-full select-text max-w-full py-1 animate-scale-in">
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
                    {isExpanded && (
                      <div className="text-[10px] font-mono text-[var(--text-secondary)] leading-normal select-text whitespace-pre-wrap mt-1 p-2 bg-[var(--bg-expanded)]/50 border border-[var(--border)] rounded-[6px] animate-fade-in w-full flex flex-col gap-3">
                        {((log.ref_files && log.ref_files.length > 0) || log.selected_text || plannerContextFiles.length > 0) && (
                          <div className="flex flex-col gap-1 border-b border-[var(--border)] pb-2 mb-1 select-none">
                            {log.ref_files?.map((file) => (
                              <div key={file.path} className="flex items-center gap-1.5 text-[10.5px] text-[var(--text-secondary)] font-sans">
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z" />
                                  <circle cx="12" cy="12" r="3" />
                                </svg>
                                <span>Read {file.name}</span>
                              </div>
                            ))}
                            {plannerContextFiles.map((filepath) => {
                              return (
                                <div key={filepath} className="flex items-center gap-1.5 text-[10.5px] text-[var(--text-secondary)] font-sans">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z" />
                                    <circle cx="12" cy="12" r="3" />
                                  </svg>
                                  <span>{filepath}</span>
                                </div>
                              )
                            })}
                            {log.selected_text && (
                              <div className="flex items-center gap-1.5 text-[10.5px] text-[var(--text-secondary)] font-sans">
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z" />
                                  <circle cx="12" cy="12" r="3" />
                                </svg>
                                <span>Read editor selection ({log.selected_text.length} Ch)</span>
                              </div>
                            )}
                          </div>
                        )}
                        {log.planner_system_prompt && (
                          <div className="flex flex-col gap-1">
                            <span className="text-[9px] uppercase tracking-widest font-sans text-[var(--text-muted)] font-semibold">① Planner</span>
                            <div><strong>System:</strong> {log.planner_system_prompt}</div>
                            <div className="mt-1"><strong>User:</strong> {log.planner_user_prompt}</div>
                            <div className="mt-1"><strong>Output:</strong> {log.planner_output}</div>
                          </div>
                        )}
                        {log.planner_system_prompt && (
                          <div className="border-t border-[var(--border)] pt-2 mt-1" />
                        )}
                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] uppercase tracking-widest font-sans text-[var(--text-muted)] font-semibold">{log.planner_system_prompt ? '② Generator' : 'Prompt'}</span>
                          <div><strong>System:</strong> {log.system_prompt}</div>
                          <div className="mt-1"><strong>User:</strong> {log.user_prompt}</div>
                        </div>
                      </div>
                    )}
                    {/* Thinking dropdown — visible when thinking output exists */}
                    {log.thinking_output && (
                      <div className="mt-0.5">
                        <ThinkingDropdown text={log.thinking_output} defaultOpen={false} />
                      </div>
                    )}

                    {/* Always-visible context rows — ref files + planner context + selection */}
                    {((log.ref_files && log.ref_files.length > 0) || log.selected_text || plannerContextFiles.length > 0) && (() => {
                      const uniqueFiles = new Map<string, string>()
                      log.ref_files?.forEach(f => uniqueFiles.set(f.path, f.name))
                      plannerContextFiles.forEach(f => uniqueFiles.set(f, f))

                      return (
                        <div className="flex flex-col gap-1 mt-1 select-none">
                          {Array.from(uniqueFiles.values()).map((name, i) => (
                            <div key={i} className="flex items-center gap-1.5 text-[10.5px] text-[var(--text-muted)] font-sans">
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                              <span>Read {name}</span>
                            </div>
                          ))}
                          {log.selected_text && (
                            <div className="flex items-center gap-1.5 text-[10.5px] text-[var(--text-muted)] font-sans">
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                              <span>Read editor selection ({log.selected_text.length} ch)</span>
                            </div>
                          )}
                        </div>
                      )
                    })()}

                    <div className={`text-xs font-sans leading-relaxed select-text mt-1 ${log.success === false ? 'text-[var(--danger)] font-medium whitespace-pre-wrap' : 'text-[var(--text)]'}`}>
                      {log.success === false ? log.output : renderMarkdown(log.output)}
                    </div>
                  </div>
                </div>
              )
            })}

            {isWorking && activeInstruction && (
              <div className="flex flex-col gap-2.5 animate-fade-in">
                {/* User Prompt */}
                <div className="self-end max-w-[85%] bg-[var(--bg-bubble)] border border-[var(--border)] rounded-[16px] rounded-tr-[4px] px-3.5 py-2.5 font-sans text-xs text-[var(--text)] shadow-none leading-relaxed select-text flex flex-wrap items-center gap-1 opacity-70">
                  <span>{renderUserPrompt(activeInstruction)}</span>
                </div>
                {/* Context Readings Logs */}
                {activeRefFiles.map((file) => (
                  <div key={file.path} className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] font-sans select-none ml-1">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    <span>Reading {file.name}</span>
                  </div>
                ))}
                {plannerContextFiles.map((filepath) => {
                  const name = filepath.split('/').pop() || filepath
                  return (
                    <div key={filepath} className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] font-sans select-none ml-1">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      <span>Reading {name}</span>
                    </div>
                  )
                })}

                {streamingThinkingText && (
                  <div className="self-start w-full">
                    <ThinkingDropdown text={streamingThinkingText} defaultOpen={true} />
                  </div>
                )}

                {/* Live chat stream render */}
                {mode === 'chat' && streamingChatText && (
                  <div className="flex flex-col gap-1.5 self-start w-full select-text max-w-full py-1 animate-scale-in">
                    <div className="text-xs font-sans leading-relaxed select-text text-[var(--text)]">
                      {renderMarkdown(streamingChatText)}
                    </div>
                  </div>
                )}

                {/* Phase-aware status indicator */}
                <div className="flex items-center gap-2 text-xs font-serif italic py-1 select-none" ref={outputRef}>
                  <div className={`status-indicator-square ${isPlanning ? 'animate-planning' : isGenerating ? 'animate-generating-pulse' : ''}`}>
                    <div className={`status-indicator-inner ${isGenerating ? 'animate-orbit' : ''}`} />
                  </div>
                  <span className="animate-shimmer">
                    {isPlanning ? 'Planning...' : isGenerating ? 'Generating...' : 'Thinking about the edit...'}
                  </span>
                </div>
              </div>
            )}

            {errorText && (
              <div className="flex items-center gap-1.5 text-xs text-[var(--danger)] bg-[var(--danger-bg)] border border-[var(--danger-muted)] rounded-[8px] px-2.5 py-2 font-sans self-start select-none animate-fade-in" ref={outputRef}>
                <span>{errorText}</span>
              </div>
            )}
          </div>
        </>
      )}

      {!hasHistory && (
        <div className="flex-1 flex flex-col justify-center px-5 py-10 animate-fade-in max-w-[300px] mx-auto select-none font-sans text-left">
          <div className="text-center mb-6">
            <div className="mt-3 text-[18px] font-medium text-[var(--text-heading)] font-serif">
              M<em>a</em>rg<em>i</em>n
            </div>
            <p className="mt-1 text-[10.5px] leading-relaxed text-[var(--text-muted)] font-sans">
              Edit, ask, and pull context into the draft.
            </p>
          </div>

          <div className="flex flex-col gap-2.5 text-[11px] text-[var(--text-secondary)]">
            <div className="flex gap-2.5 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
              <AtSign size={14} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
              <p className="leading-normal text-[var(--text)]">Type <code className="font-mono text-[9.5px] bg-[var(--bg-hover)] px-1 py-0.5 rounded border border-[var(--border-subtle)] text-[var(--text)]">@</code> to add markdown files.</p>
            </div>

            <div className="flex gap-2.5 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
              <Code2 size={14} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
              <p className="leading-normal text-[var(--text)]"><strong className="font-medium">Edit</strong> changes text, <strong className="font-medium">Chat</strong> answers questions.</p>
            </div>

            <div className="flex gap-2.5 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
              <MousePointer2 size={14} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
              <p className="leading-normal text-[var(--text)]">Place the cursor or highlight text to guide the edit.</p>
            </div>
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