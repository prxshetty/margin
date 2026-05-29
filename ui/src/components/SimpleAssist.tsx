import { useState, useEffect, useRef } from 'react'
import { ChevronDown, ChevronRight, RefreshCw, PenLine, Plus, Sparkles, Copy, Check } from 'lucide-react'
import { useEditorStore } from '../stores/editorStore'
import { API_BASE } from '../lib/api'

const STORAGE_KEY = 'simple-assist-system-prompt'
const DEFAULT_PROMPT = `You are a writing assistant. Help the user improve their writing.
When asked to rewrite or generate text, output ONLY the new text without explanations or commentary.`

interface MarkdownStorage {
  markdown: { getMarkdown: () => string }
}

export function SimpleAssist() {
  const {
    content, setContent, editor,
    selectedText, anchorPosition,
  } = useEditorStore()

  const [instruction, setInstruction] = useState('')
  const [isWorking, setIsWorking] = useState(false)
  const [lastOutput, setLastOutput] = useState('')
  const [copied, setCopied] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_PROMPT
  })
  const [promptOpen, setPromptOpen] = useState(false)
  const outputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, systemPrompt)
  }, [systemPrompt])

  useEffect(() => {
    if (lastOutput) {
      outputRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [lastOutput])

  const hasSelection = selectedText.length > 0
  const hasCursor = (editor?.isFocused || anchorPosition > 0) && !hasSelection

  const handleCopy = () => {
    if (!lastOutput) return
    navigator.clipboard.writeText(lastOutput)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleReplace = async () => {
    if (!selectedText || !instruction.trim() || !editor) return
    setIsWorking(true)
    try {
      const res = await fetch(`${API_BASE}/api/assist/simple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          message: instruction,
          system_prompt: systemPrompt === DEFAULT_PROMPT ? null : systemPrompt,
          selected_text: selectedText,
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
        const storage = editor.storage as MarkdownStorage
        if (storage.markdown) setContent(storage.markdown.getMarkdown())
      }
      setLastOutput(rewritten)
      setInstruction('')
    } catch (err) {
      console.error(err)
      setLastOutput('Error: ' + (err as Error).message)
    } finally {
      setIsWorking(false)
    }
  }

  const handleInsert = async () => {
    if (!instruction.trim() || !editor) return
    setIsWorking(true)
    try {
      const pos = anchorPosition
      const docSize = editor.state.doc.content.size
      const textBefore = editor.state.doc.textBetween(0, pos, '\n')
      const textAfter = editor.state.doc.textBetween(pos, docSize, '\n')

      const res = await fetch(`${API_BASE}/api/assist/simple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          message: instruction,
          system_prompt: systemPrompt === DEFAULT_PROMPT ? null : systemPrompt,
          text_before: textBefore,
          text_after: textAfter,
        }),
      })
      if (!res.ok) throw new Error('Insert failed')
      const data = await res.json()
      const inserted = data.output

      editor.commands.insertContentAt(pos, inserted)
      const storage = editor.storage as MarkdownStorage
      if (storage.markdown) setContent(storage.markdown.getMarkdown())
      setLastOutput(inserted)
      setInstruction('')
    } catch (err) {
      console.error(err)
      setLastOutput('Error: ' + (err as Error).message)
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 w-full h-full overflow-y-auto">
      {/* Selection info */}
      {hasSelection && (
        <div className="px-3 py-2 bg-indigo-50/60 border border-indigo-200 rounded-lg text-xs text-indigo-900 leading-relaxed break-words">
          <span className="font-bold text-[10px] uppercase tracking-wider text-indigo-500 block mb-0.5">
            Selected
          </span>
          <span className="italic text-[11px]">
            "{selectedText.length > 120 ? selectedText.slice(0, 120) + '...' : selectedText}"
          </span>
        </div>
      )}

      {!hasSelection && hasCursor && (
        <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-500">
          Cursor placed — insert new text at this position.
        </div>
      )}

      {!hasSelection && !hasCursor && (
        <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-400 text-center">
          Select text or place cursor in the editor
        </div>
      )}

      {/* Instruction input */}
      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder={
          hasSelection
            ? "Instructions (e.g. 'Make it more dramatic')"
            : "Instructions (e.g. 'Continue the scene')"
        }
        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-xs resize-none placeholder:text-slate-400 bg-white"
        rows={2}
      />

      {/* Action buttons */}
      <div className="flex gap-2">
        {hasSelection ? (
          <button
            onClick={handleReplace}
            disabled={!instruction.trim() || isWorking}
            className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-semibold rounded-lg text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer border border-indigo-700"
          >
            {isWorking ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <PenLine className="w-3.5 h-3.5" />}
            Replace
          </button>
        ) : (
          <button
            onClick={handleInsert}
            disabled={!instruction.trim() || isWorking}
            className="flex-1 py-2 bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 text-white font-semibold rounded-lg text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer border border-slate-900"
          >
            {isWorking ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Insert
          </button>
        )}
      </div>

      {/* AI Response bubble */}
      {(lastOutput || isWorking) && (
        <div className="flex gap-2 items-start" ref={outputRef}>
          <div className="w-6 h-6 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 mt-0.5">
            <Sparkles className="w-3 h-3 text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            {isWorking && !lastOutput ? (
              <div className="px-3 py-2.5 bg-white border border-slate-200 rounded-2xl rounded-tl-none shadow-sm">
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <RefreshCw className="w-3 h-3 animate-spin text-indigo-500" />
                  Thinking...
                </div>
              </div>
            ) : lastOutput ? (
              <div className="px-3 py-2.5 bg-white border border-slate-200 rounded-2xl rounded-tl-none shadow-sm">
                <div className="flex items-center justify-between mb-1.5 pb-1.5 border-b border-slate-100">
                  <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">
                    Response
                  </span>
                  <button
                    onClick={handleCopy}
                    className="text-slate-400 hover:text-slate-600 p-0.5 rounded hover:bg-slate-50 transition-colors"
                    title="Copy"
                  >
                    {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
                <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700 leading-relaxed max-h-48 overflow-y-auto">
                  {lastOutput}
                </pre>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* System Prompt (collapsible) */}
      <div className="border-t border-slate-100 pt-3 mt-auto">
        <button
          onClick={() => setPromptOpen(!promptOpen)}
          className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-600 w-full text-left transition-colors cursor-pointer"
        >
          {promptOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          System Prompt
        </button>
        {promptOpen && (
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            className="w-full mt-2 px-2 py-1.5 border border-slate-200 rounded text-[10px] font-mono text-slate-600 outline-none focus:ring-1 focus:ring-indigo-400 resize-none bg-white"
            rows={4}
          />
        )}
      </div>
    </div>
  )
}
