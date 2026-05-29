import { useState, useEffect } from 'react'
import { ChevronDown, ChevronRight, RefreshCw, PenLine, Plus } from 'lucide-react'
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
  const [systemPrompt, setSystemPrompt] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_PROMPT
  })
  const [promptOpen, setPromptOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, systemPrompt)
  }, [systemPrompt])

  const hasSelection = selectedText.length > 0
  const hasCursor = (editor?.isFocused || anchorPosition > 0) && !hasSelection

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
    <div className="flex flex-col gap-4 w-full h-full overflow-y-auto">
      {/* Selection info */}
      {hasSelection && (
        <div className="px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-lg text-xs text-indigo-900 leading-relaxed break-words">
          <span className="font-bold text-[10px] uppercase tracking-wider text-indigo-500 block mb-1">
            Selected Text
          </span>
          <span className="italic">
            "{selectedText.length > 150 ? selectedText.slice(0, 150) + '...' : selectedText}"
          </span>
        </div>
      )}

      {!hasSelection && hasCursor && (
        <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500">
          Cursor placed — you can insert new text at this position.
        </div>
      )}

      {!hasSelection && !hasCursor && (
        <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500">
          Select text in the editor to rewrite, or place your cursor to insert new content.
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
        rows={3}
      />

      {/* Action buttons */}
      <div className="flex gap-2">
        {hasSelection && (
          <button
            onClick={handleReplace}
            disabled={!instruction.trim() || isWorking}
            className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-semibold rounded-lg text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            {isWorking ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <PenLine className="w-3.5 h-3.5" />}
            Replace Selection
          </button>
        )}
        {!hasSelection && (
          <button
            onClick={handleInsert}
            disabled={!instruction.trim() || isWorking}
            className="flex-1 py-2 bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 text-white font-semibold rounded-lg text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            {isWorking ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Insert After Cursor
          </button>
        )}
      </div>

      {/* Last output */}
      {lastOutput && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 max-h-40 overflow-y-auto">
          <span className="font-bold text-[10px] uppercase tracking-wider text-slate-400 block mb-1">
            Last Response
          </span>
          <pre className="whitespace-pre-wrap font-sans leading-relaxed">{lastOutput}</pre>
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
            rows={5}
          />
        )}
      </div>
    </div>
  )
}
