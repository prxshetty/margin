import { useState, useEffect, useRef } from 'react'
import { RefreshCw, Wand2, Plus, Sparkles, X, PenLine, Copy, Check } from 'lucide-react'
import { useScene } from '../../hooks/useScene'
import { useEditorStore } from '../../stores/editorStore'
import { useProjectStore } from '../../stores/projectStore'
import { useQueryClient } from '@tanstack/react-query'

export function Toolbar({
  aiEditorLogs = [],
  isLoadingLogs = false
}: {
  aiEditorLogs?: any[]
  isLoadingLogs?: boolean
}) {
  const { content, editor, anchorPosition, aiAssistPreload, setAIAssistPreload } = useEditorStore()
  const { activeSceneId, activeDoc, activeChapterId } = useProjectStore()
  const { sceneData, decomposeScene, isDecomposing } = useScene(activeSceneId)
  const queryClient = useQueryClient()

  const [feedback, setFeedback] = useState('')
  const [isWorking, setIsWorking] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Clear feedback when a new selection is preloaded
  useEffect(() => {
    if (aiAssistPreload) {
      setFeedback('')
    }
  }, [aiAssistPreload])

  // Scroll to bottom when logs load or update
  useEffect(() => {
    if (aiEditorLogs && aiEditorLogs.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [aiEditorLogs])

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleDirectedRewrite = async () => {
    if (!aiAssistPreload || !feedback.trim() || !editor) return

    setIsWorking(true)
    try {
      const url = activeDoc?.type === 'scene'
        ? `http://localhost:8000/scenes/${activeSceneId}/rewrite_selection`
        : `http://localhost:8000/chapters/${activeChapterId}/rewrite_selection`

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selected_text: aiAssistPreload.text,
          feedback: feedback,
          context: content
        }),
      })

      if (!response.ok) throw new Error('Rewrite failed')

      const data = await response.json()
      if (data.rewritten_text) {
        editor.chain()
          .deleteRange({ from: aiAssistPreload.range.from, to: aiAssistPreload.range.to })
          .insertContentAt(aiAssistPreload.range.from, data.rewritten_text, {
            parseOptions: { preserveWhitespace: 'full' },
            updateSelection: false,
          })
          .run()
        setFeedback('')
        setAIAssistPreload(null)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsWorking(false)
      if (activeSceneId) {
        queryClient.invalidateQueries({ queryKey: ['aiEditorLogs', activeSceneId] })
      }
    }
  }

  const handleInsert = async () => {
    if (!feedback.trim() || !editor) return
    const isScene = activeDoc?.type === 'scene'
    if (isScene && !activeSceneId) return
    if (!isScene && !activeChapterId) return

    setIsWorking(true)
    try {
      const pos = anchorPosition
      const docSize = editor.state.doc.content.size
      const textBefore = editor.state.doc.textBetween(0, pos, '\n')
      const textAfter = editor.state.doc.textBetween(pos, docSize, '\n')
      const resolvedPos = editor.state.doc.resolve(pos)
      const blockType = resolvedPos.parent.type.name

      const url = isScene
        ? `http://localhost:8000/scenes/${activeSceneId}/insert_after`
        : `http://localhost:8000/chapters/${activeChapterId}/insert_after`

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text_before: textBefore,
          text_after: textAfter,
          block_type: blockType,
          feedback,
          context: content
        })
      })

      if (!response.ok) throw new Error('Insert failed')

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
                .insertContentAt(pos, '\n\n' + data.generated_text, {
                  parseOptions: { preserveWhitespace: 'full' },
                  updateSelection: false,
                })
                .run()
              setFeedback('')
            }
          }
        }
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsWorking(false)
      if (isScene) {
        queryClient.invalidateQueries({ queryKey: ['aiEditorLogs', activeSceneId] })
      } else {
        queryClient.invalidateQueries({ queryKey: ['aiEditorLogs', activeChapterId] })
      }
    }
  }

  const isSceneActive = activeDoc?.type === 'scene'
  const isDecomposed = sceneData?.scene_events && sceneData.scene_events.length > 0

  const activeSelectionText = aiAssistPreload?.text || null

  return (
    <div className="flex flex-col gap-4 w-full h-full">
      {isSceneActive && activeSceneId && !isDecomposed && (
        <div className="flex flex-col gap-2 w-full shrink-0">
          <button
            onClick={() => decomposeScene()}
            disabled={isDecomposing}
            className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold rounded-lg shadow-sm transition-colors text-xs cursor-pointer"
          >
            {isDecomposing ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Decomposing...
              </>
            ) : (
              <>
                <Wand2 className="w-3.5 h-3.5" />
                Decompose Scene Outline
              </>
            )}
          </button>
        </div>
      )}

      {/* Chatbot History Thread */}
      <div className="flex flex-col gap-3 border border-slate-100 rounded-xl bg-slate-50/40 p-3 max-h-[350px] overflow-y-auto relative min-h-[220px] scrollbar-thin">
        {isLoadingLogs ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2 w-full h-full">
            <RefreshCw className="w-5 h-5 animate-spin text-indigo-500" />
            <span className="text-xs">Loading assistant chat...</span>
          </div>
        ) : aiEditorLogs && aiEditorLogs.length > 0 ? (
          <div className="flex flex-col gap-4">
            {/* Standard Welcome message first */}
            <div className="flex gap-2 items-start max-w-[90%] text-xs animate-in fade-in duration-300">
              <div className="w-6 h-6 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                <Sparkles className="w-3 h-3 text-indigo-600" />
              </div>
              <div className="px-3.5 py-2.5 bg-white border border-slate-200/80 rounded-2xl rounded-tl-none text-slate-700 leading-relaxed shadow-sm">
                <p className="font-semibold text-slate-800 mb-1">AI Assistant ✍️</p>
                Hello! I am your AI Writing Assistant. Highlight any text on the writing canvas to rewrite it, or place your cursor anywhere to stream new paragraphs. How can I help you refine your draft today?
              </div>
            </div>

            {aiEditorLogs.map((log: any) => {
              const dateStr = log.timestamp ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
              const isRewrite = log.operation === 'rewrite'

              return (
                <div key={log.id} className="flex flex-col gap-3">
                  {/* User instruction bubble on the right */}
                  <div className="flex flex-col items-end w-full">
                    <div className="px-3.5 py-2.5 bg-gradient-to-br from-indigo-600 to-violet-700 text-white rounded-2xl rounded-tr-none shadow-sm max-w-[90%] text-xs flex flex-col gap-1.5 relative group">
                      <div className="flex items-center gap-1.5 justify-end">
                        <span className="bg-indigo-500/40 text-indigo-100 px-1.5 py-0.5 rounded font-bold text-[8px] uppercase tracking-wider select-none">
                          {isRewrite ? 'Selection Rewrite' : log.operation === 'expand' ? 'Expand' : 'Cursor Insertion'}
                        </span>
                      </div>
                      
                      {isRewrite && log.selected_text_preview && (
                        <div className="text-[10px] text-indigo-100/85 bg-indigo-800/30 px-2 py-1 rounded border-l-2 border-indigo-300 italic font-sans leading-relaxed line-clamp-2 select-none">
                          "{log.selected_text_preview}"
                        </div>
                      )}
                      
                      <div className="leading-relaxed whitespace-pre-wrap select-text break-words">
                        {log.feedback || (isRewrite ? "(one-click rewrite)" : "(one-click expand)")}
                      </div>
                    </div>
                    {dateStr && (
                      <span className="text-[9px] text-slate-400 font-mono mt-1 mr-1">{dateStr}</span>
                    )}
                  </div>

                  {/* AI Response bubble on the left */}
                  <div className="flex gap-2 items-start max-w-[90%] text-xs w-full">
                    <div className="w-6 h-6 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                      <Sparkles className="w-3 h-3 text-indigo-600" />
                    </div>
                    <div className="px-3.5 py-2.5 bg-white border border-slate-200/80 rounded-2xl rounded-tl-none text-slate-700 leading-relaxed shadow-sm w-full relative group">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-1 mb-1.5 select-none">
                        <span className="font-semibold text-slate-800 text-[10px] uppercase tracking-wider">Generated Output</span>
                        
                        <button
                          onClick={() => handleCopy(log.id, log.output)}
                          className="text-slate-400 hover:text-slate-600 p-0.5 rounded hover:bg-slate-50 transition-colors"
                          title="Copy to clipboard"
                        >
                          {copiedId === log.id ? (
                            <Check className="w-3 h-3 text-emerald-500 animate-in zoom-in duration-200" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>

                      <div className="font-sans leading-relaxed text-slate-600 max-h-36 overflow-y-auto whitespace-pre-wrap pr-1 select-text scrollbar-thin">
                        {log.output}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>
        ) : (
          /* Empty State / Welcome Message */
          <div className="flex gap-2 items-start max-w-[90%] text-xs">
            <div className="w-6 h-6 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 shadow-sm mt-0.5">
              <Sparkles className="w-3 h-3 text-indigo-600" />
            </div>
            <div className="px-3.5 py-2.5 bg-white border border-slate-200/80 rounded-2xl rounded-tl-none text-slate-700 leading-relaxed shadow-sm">
              <p className="font-semibold text-slate-800 mb-1">AI Assistant ✍️</p>
              Hello! I am your AI Writing Assistant. Highlight any text on the writing canvas to rewrite it, or place your cursor anywhere to stream new paragraphs. How can I help you refine your draft today?
            </div>
          </div>
        )}
      </div>

      {/* AI Assist Input Section */}
      <div className="flex flex-col gap-2 mt-1 shrink-0">
        {activeSelectionText && (
          <div className="px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-lg flex items-start gap-2 text-[11px] text-indigo-900 leading-relaxed relative group animate-in slide-in-from-top-1">
            <Sparkles className="w-3.5 h-3.5 text-indigo-500 mt-0.5 shrink-0" />
            <div className="flex-1 break-words italic pt-0.5">
              "{activeSelectionText.length > 120 ? `${activeSelectionText.substring(0, 120)}...` : activeSelectionText}"
            </div>
            {aiAssistPreload && (
              <button 
                onClick={() => setAIAssistPreload(null)}
                className="p-1 -mt-1 -mr-1 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-100 rounded transition-colors"
                title="Clear selection"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={activeSelectionText ? "Instructions (e.g. 'Make it more dramatic')" : "Instructions (e.g. 'Add a beat where she hesitates')"}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-xs resize-none placeholder:text-slate-400 bg-white"
            rows={3}
          />
          
          <div className="flex gap-2">
            {activeSelectionText ? (
              <button
                onClick={handleDirectedRewrite}
                disabled={!feedback.trim() || isWorking || !aiAssistPreload}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-semibold rounded-lg shadow-sm transition-colors text-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {isWorking ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <PenLine className="w-3.5 h-3.5" />}
                Apply to Selection
              </button>
            ) : (
              <button
                onClick={handleInsert}
                disabled={!feedback.trim() || isWorking || (!activeSceneId && !activeChapterId)}
                className="w-full py-2 bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 text-white font-semibold rounded-lg shadow-sm transition-colors text-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {isWorking ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Insert After Cursor
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
