import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { AtSign, Code2, MousePointer2, RefreshCw, Settings, Trash2 } from 'lucide-react'
import { useEditorStore } from '../stores/editorStore'
import { useSettingsStore } from '../stores/settingsStore'
import { API_BASE } from '../lib/api'
import type { FileEntry } from '../stores/editorStore'

interface SimpleLogEntry {
  id: string
  timestamp: string
  mode: 'replace' | 'insert' | 'chat'
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
  planner_system_prompt?: string
  planner_user_prompt?: string
  planner_output?: string
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
    if (log.mode !== 'chat' && log.selected_text) {
      text = `@selection(${formatCharacterCount(log.selected_text.length)}) ` + text
    }
    if (log.ref_files && log.ref_files.length > 0) {
      text += ' ' + log.ref_files.map(f => `@${f.name}`).join(' ')
    }
  }
  return text
}

function renderUserPrompt(text: string) {
  const regex = /@([\w.-]+(?:\([^)]+\))?)/g
  const parts = []
  let lastIndex = 0
  let match

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const name = match[1]
    const isSelection = name.startsWith('selection(')
    const label = isSelection ? name.replace(/^selection\((.*)\)$/, '$1') : name

    parts.push(
      <span key={match.index} className="inline-chip inline-chip-selection align-middle mx-0.5">
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

function EditModeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 19.25h5.25" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
      <path d="M6.25 15.5 15.9 5.85a2.2 2.2 0 0 1 3.1 0l.15.15a2.2 2.2 0 0 1 0 3.1L9.5 18.75 5 19l.25-4.5Z" stroke="currentColor" strokeWidth="1.85" strokeLinejoin="round" />
      <path d="m14.5 7.25 2.25 2.25" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" />
      <path d="M6.75 4.75h.01M9.75 3h.01M4 8h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

function ChatModeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6.75 16.75 3.5 20.25V7.75A4.25 4.25 0 0 1 7.75 3.5h8.5a4.25 4.25 0 0 1 4.25 4.25v4.75a4.25 4.25 0 0 1-4.25 4.25h-9.5Z" stroke="currentColor" strokeWidth="1.85" strokeLinejoin="round" />
      <path d="M8 9.25h8M8 12.25h4.75" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" />
      <path d="M17.75 5.75c.45.3.78.7 1 1.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity=".65" />
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
    chip.className = 'inline-chip inline-chip-selection'
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
    setActiveInstruction(currentInstruction)
    const currentRefFiles = refPaths
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

      const body: Record<string, unknown> = {
        content: fullContent,
        message: currentInstruction,
        mode: 'edit',
        session_id: currentSessionId,
        ref_files: currentRefFiles.map(f => ({ name: f.name, path: f.path })),
        available_files: openedFiles.map(f => ({ name: f.name, path: f.path })),
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
            } else if (data.status === 'applied') {
              const output = data.output

              const liveEditor = useEditorStore.getState().editor || activeEditor
              if (liveEditor && liveEditor.view && liveEditor.state && !liveEditor.isDestroyed) {
                if (localHasSelection && selectionInfo) {
                  liveEditor.chain()
                    .deleteRange({ from: selectionInfo.from, to: selectionInfo.to })
                    .insertContentAt(selectionInfo.from, output)
                    .run()
                } else {
                  liveEditor.chain()
                    .insertContentAt(anchorPosition, output)
                    .run()
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
    setIsPlanning(false)
    setIsGenerating(true)
    setPlannerContextFiles([])
    setActiveInstruction(currentInstruction)
    const currentRefFiles = refPaths
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

      const body: Record<string, unknown> = {
        content: fullContent,
        message: currentInstruction,
        mode: 'chat',
        session_id: currentSessionId,
        ref_files: currentRefFiles.map(f => ({ name: f.name, path: f.path })),
        available_files: openedFiles.map(f => ({ name: f.name, path: f.path })),
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
            if (data.status === 'generating') {
              setIsPlanning(false)
              setIsGenerating(true)
            } else if (data.status === 'chat') {
              // Done generating
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
    <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] focus-within:border-[var(--text-muted)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] duration-200 rounded-[14px] p-3 flex flex-col relative animate-scale-in">
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
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 bg-[var(--bg-hover)] rounded-full p-0.5 border border-[var(--border-subtle)] shadow-inner">
            <button
              onClick={() => setMode('edit')}
              className={`flex items-center justify-center w-6 h-6 rounded-full transition-colors cursor-pointer ${mode === 'edit' ? 'bg-[var(--accent-brown)] text-[var(--text-inverse)] shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-heading)]'
                }`}
              title="Edit mode"
            >
              <EditModeIcon />
            </button>
            <button
              onClick={() => setMode('chat')}
              className={`flex items-center justify-center w-6 h-6 rounded-full transition-colors cursor-pointer ${mode === 'chat' ? 'bg-[var(--accent-brown)] text-[var(--text-inverse)] shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-heading)]'
                }`}
              title="Chat mode"
            >
              <ChatModeIcon />
            </button>
          </div>
        </div>

        {/* Action Button: Solid circular button with up arrow */}
        <button
          onClick={mode === 'chat' ? handleChat : handleEdit}
          disabled={!instructionText || isWorking}
          className="
            flex items-center justify-center transition-[background-color,transform,opacity] duration-150 cursor-pointer select-none border rounded-full w-6 h-6 active:scale-[0.9] bg-[var(--accent-brown)] hover:bg-[var(--accent-brown-hover)] text-[var(--text-inverse)] disabled:bg-[var(--bg-disabled)] disabled:text-[var(--text-disabled)] disabled:border-transparent border-transparent
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
  )

  return (
    <div ref={containerRef} className="flex flex-col w-full h-full select-none animate-fade-in">
      {/* Header: actions on right */}
      <div className="flex items-center justify-end gap-1.5 pb-1.5 border-b border-[var(--border-sidebar)] select-none shrink-0 w-full animate-fade-in">
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
                          className="flex items-center justify-center w-5 h-5 text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-bg)] rounded-[4px] transition-all cursor-pointer active:scale-[0.9] opacity-0 group-hover:opacity-100"
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

      {/* History area (scrollable) */}
      {hasHistory && (
        <>
          <div className="flex-1 overflow-y-auto flex flex-col gap-4 pr-1 min-h-0 select-text">
            {filteredLogs.map((log) => {
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
                    <div className={`text-xs font-sans leading-relaxed whitespace-pre-wrap select-text ${log.success === false ? 'text-[var(--danger)] font-medium' : 'text-[var(--text)]'}`}>
                      {log.output}
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

                {/* Thinking Status */}
                <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] font-serif italic py-1 select-none animate-pulse" ref={outputRef}>
                  <svg className="w-3.5 h-3.5 animate-spin text-[var(--accent-brown)]" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="12" r="10" stroke="var(--border)" strokeWidth="3" />
                    <path d="M12 2C6.47715 2 2 6.47715 2 12C2 13.5796 2.36592 15.071 3.01662 16.4024" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  <span>
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
