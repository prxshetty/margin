import { useState, useEffect, useRef } from 'react'
import { RefreshCw, Plus, Sparkles, X, PenLine, Copy, Check } from 'lucide-react'
import { useScene } from '../../hooks/useScene'
import { useBlueprint } from '../../hooks/useBlueprint'
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
  const { content, editor, anchorPosition, aiAssistPreload, setAIAssistPreload, triggerReload } = useEditorStore()
  const { activeSceneId, activeDoc, activeChapterId, currentBeatIndex } = useProjectStore()
  const { sceneAssist } = useScene(activeSceneId)
  const { blueprintAssist } = useBlueprint(activeChapterId)
  const queryClient = useQueryClient()

  const [feedback, setFeedback] = useState('')
  const [isWorking, setIsWorking] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [virtualMessages, setVirtualMessages] = useState<any[]>([])

  // Clear feedback when a new selection is preloaded
  useEffect(() => {
    if (aiAssistPreload) {
      setFeedback('')
    }
  }, [aiAssistPreload])

  // Clear virtual conversation when active doc changes
  useEffect(() => {
    setVirtualMessages([])
  }, [activeDoc, activeSceneId, activeChapterId])

  // Scroll to bottom when logs load or update
  useEffect(() => {
    const totalMsgs = (aiEditorLogs?.length || 0) + (virtualMessages?.length || 0)
    if (totalMsgs > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [aiEditorLogs, virtualMessages, isWorking])

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

      const docId = activeDoc
        ? activeDoc.type === 'scene'
          ? activeSceneId
          : activeDoc.type === 'character'
            ? activeDoc.slug
            : activeDoc.id
        : ''

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selected_text: aiAssistPreload.text,
          feedback: feedback,
          context: content,
          doc_type: activeDoc?.type,
          doc_id: docId
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

  const handleDocumentAssist = async (customMessage?: string) => {
    const textToSend = customMessage || feedback.trim()
    if (!textToSend) return

    setIsWorking(true)
    
    // Build clean user/assistant history from current state
    const history = [
      ...aiEditorLogs.flatMap(log => [
        { role: 'user', content: log.feedback || '' },
        { role: 'assistant', content: log.output || '' }
      ]),
      ...virtualMessages.map(msg => ({
        role: msg.isAI ? 'assistant' : 'user',
        content: msg.feedback || msg.output || ''
      }))
    ].filter(h => h.content)

    // Add user message virtually
    setVirtualMessages(prev => [
      ...prev,
      {
        id: 'temp-user-' + Date.now(),
        operation: 'assist',
        feedback: textToSend,
        output: null,
        timestamp: new Date().toISOString(),
        isVirtual: true
      }
    ])
    setFeedback('')

    try {
      if (activeDoc?.type === 'blueprint') {
        const res = await blueprintAssist({ message: textToSend, history })
        if (res.type === 'applied') {
          // Show success bubble then trigger a reload of blueprint.md in the editor
          setVirtualMessages(prev => [
            ...prev,
            {
              id: 'temp-ai-' + Date.now(),
              operation: 'applied',
              feedback: null,
              output: res.message || 'Blueprint updated successfully.',
              timestamp: new Date().toISOString(),
              isVirtual: true,
              isAI: true
            }
          ])
          queryClient.invalidateQueries({ queryKey: ['blueprint', activeChapterId] })
          // Force Workshop to re-fetch blueprint.md from disk
          triggerReload()
        } else if (res.type === 'clarification_needed') {
          setVirtualMessages(prev => [
            ...prev,
            {
              id: 'temp-ai-' + Date.now(),
              operation: 'clarify',
              feedback: null,
              output: res.question,
              options: res.options || [],
              timestamp: new Date().toISOString(),
              isVirtual: true,
              isAI: true
            }
          ])
        }
      } else if (activeDoc?.type === 'scene') {
        const res = await sceneAssist({
          message: textToSend,
          history,
          currentBeatIndex,
          documentContent: content
        })
        if (res.type === 'applied') {
          setVirtualMessages(prev => [
            ...prev,
            {
              id: 'temp-ai-' + Date.now(),
              operation: 'applied',
              feedback: null,
              output: res.message || 'Scene beats updated successfully.',
              timestamp: new Date().toISOString(),
              isVirtual: true,
              isAI: true
            }
          ])
          queryClient.invalidateQueries({ queryKey: ['scene', activeSceneId] })
          // Force Workshop to re-fetch scene plan from disk
          triggerReload()
        } else if (res.type === 'clarification_needed') {
          setVirtualMessages(prev => [
            ...prev,
            {
              id: 'temp-ai-' + Date.now(),
              operation: 'clarify',
              feedback: null,
              output: res.question,
              options: res.options || [],
              timestamp: new Date().toISOString(),
              isVirtual: true,
              isAI: true
            }
          ])
        }
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsWorking(false)
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

      const docId = activeDoc
        ? activeDoc.type === 'scene'
          ? activeSceneId
          : activeDoc.type === 'character'
            ? activeDoc.slug
            : activeDoc.id
        : ''

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text_before: textBefore,
          text_after: textAfter,
          block_type: blockType,
          feedback,
          context: content,
          doc_type: activeDoc?.type,
          doc_id: docId
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

  const activeSelectionText = aiAssistPreload?.text || null

  return (
    <div className="flex flex-col gap-4 w-full h-full">
      {/* Chatbot History Thread */}
      <div className="flex flex-col gap-3 border border-slate-100 rounded-xl bg-slate-50/40 p-3 max-h-[350px] overflow-y-auto relative min-h-[220px] scrollbar-thin">
        {isLoadingLogs ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2 w-full h-full">
            <RefreshCw className="w-5 h-5 animate-spin text-indigo-500" />
            <span className="text-xs">Loading assistant chat...</span>
          </div>
        ) : (aiEditorLogs && aiEditorLogs.length > 0) || (virtualMessages && virtualMessages.length > 0) ? (
          <div className="flex flex-col gap-4">
            {/* Standard Welcome message first */}
            <div className="flex gap-2 items-start max-w-[90%] text-xs animate-in fade-in duration-300">
              <div className="w-6 h-6 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                <Sparkles className="w-3 h-3 text-indigo-600" />
              </div>
              <div className="px-3.5 py-2.5 bg-white border border-slate-200/80 rounded-2xl rounded-tl-none text-slate-700 leading-relaxed shadow-sm">
                <p className="font-semibold text-slate-800 mb-1">AI Assistant ✍️</p>
                {activeDoc?.type === 'blueprint' || activeDoc?.type === 'scene'
                  ? "Hello! I am your AI Blueprint & Scene Editor. You can ask me to add acts, scenes, or dramatic beats, modify them, or delete them. What structural change would you like to make?"
                  : "Hello! I am your AI Writing Assistant. Highlight any text on the writing canvas to rewrite it, or place your cursor anywhere to stream new paragraphs. How can I help you refine your draft today?"}
              </div>
            </div>

            {[...aiEditorLogs, ...virtualMessages].map((log: any) => {
              const dateStr = log.timestamp ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
              const isRewrite = log.operation === 'rewrite'
              const isAI = log.isAI || log.output !== null

              return (
                <div key={log.id} className="flex flex-col gap-3 animate-in fade-in duration-200">
                  {/* User instruction bubble on the right */}
                  {!log.isAI && log.feedback && (
                    <div className="flex flex-col items-end w-full">
                      <div className="px-3.5 py-2.5 bg-gradient-to-br from-indigo-600 to-violet-700 text-white rounded-2xl rounded-tr-none shadow-sm max-w-[90%] text-xs flex flex-col gap-1.5 relative group">
                        <div className="flex items-center gap-1.5 justify-end">
                          <span className="bg-indigo-500/40 text-indigo-100 px-1.5 py-0.5 rounded font-bold text-[8px] uppercase tracking-wider select-none">
                            {isRewrite ? 'Selection Rewrite' : log.operation === 'expand' ? 'Expand' : 'AI Edit Assist'}
                          </span>
                        </div>
                        
                        {isRewrite && log.selected_text_preview && (
                          <div className="text-[10px] text-indigo-100/85 bg-indigo-800/30 px-2 py-1 rounded border-l-2 border-indigo-300 italic font-sans leading-relaxed line-clamp-2 select-none">
                            "{log.selected_text_preview}"
                          </div>
                        )}
                        
                        <div className="leading-relaxed whitespace-pre-wrap select-text break-words">
                          {log.feedback}
                        </div>
                      </div>
                      {dateStr && (
                        <span className="text-[9px] text-slate-400 font-mono mt-1 mr-1">{dateStr}</span>
                      )}
                    </div>
                  )}

                  {/* AI Response bubble on the left */}
                  {isAI && log.output && (
                    <div className="flex gap-2 items-start max-w-[90%] text-xs w-full">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 shadow-sm mt-0.5 ${
                        log.operation === 'applied' 
                          ? 'bg-emerald-50 border border-emerald-200'
                          : 'bg-indigo-50 border border-indigo-100'
                      }`}>
                        <Sparkles className={`w-3 h-3 ${log.operation === 'applied' ? 'text-emerald-600' : 'text-indigo-600'}`} />
                      </div>
                      <div className={`px-3.5 py-2.5 rounded-2xl rounded-tl-none leading-relaxed shadow-sm w-full relative group ${
                        log.operation === 'applied'
                          ? 'bg-emerald-50 border border-emerald-200/80 text-emerald-800'
                          : 'bg-white border border-slate-200/80 text-slate-700'
                      }`}>
                        <div className="flex items-center justify-between border-b border-current/10 pb-1 mb-1.5 select-none">
                          <span className="font-semibold text-[10px] uppercase tracking-wider">
                            {log.operation === 'applied' ? '✓ Edit Applied' : log.operation === 'clarify' ? 'Clarification Needed' : 'Generated Output'}
                          </span>
                          
                          {log.operation !== 'clarify' && log.operation !== 'applied' && (
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
                          )}
                        </div>

                        <div className="font-sans leading-relaxed max-h-36 overflow-y-auto whitespace-pre-wrap pr-1 select-text scrollbar-thin">
                          {log.output}
                        </div>

                        {/* Clarification Options */}
                        {log.operation === 'clarify' && log.options && log.options.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-3 pt-2 border-t border-slate-100">
                            {log.options.map((opt: string, i: number) => (
                              <button
                                key={i}
                                onClick={() => handleDocumentAssist(opt)}
                                disabled={isWorking}
                                className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 active:bg-indigo-200 text-indigo-700 border border-indigo-200/60 rounded-full text-[10px] font-medium transition-all duration-200 cursor-pointer shadow-sm hover:scale-[1.02] disabled:opacity-50"
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            
            {/* Thinking Bubble */}
            {isWorking && (
              <div className="flex gap-2 items-start max-w-[90%] text-xs w-full animate-pulse">
                <div className="w-6 h-6 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                  <Sparkles className="w-3 h-3 text-indigo-600 animate-spin" />
                </div>
                <div className="px-3.5 py-2.5 bg-white border border-slate-200/80 rounded-2xl rounded-tl-none text-slate-500 leading-relaxed shadow-sm w-full">
                  Thinking...
                </div>
              </div>
            )}

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
              {activeDoc?.type === 'blueprint' || activeDoc?.type === 'scene'
                ? "Hello! I am your AI Blueprint & Scene Editor. You can ask me to add acts, scenes, or dramatic beats, modify them, or delete them. What structural change would you like to make?"
                : "Hello! I am your AI Writing Assistant. Highlight any text on the writing canvas to rewrite it, or place your cursor anywhere to stream new paragraphs. How can I help you refine your draft today?"}
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
            placeholder={
              activeSelectionText 
                ? "Instructions (e.g. 'Make it more dramatic')" 
                : activeDoc?.type === 'blueprint' 
                ? "Instructions (e.g. 'Add a new scene to Act 1 where kaelen goes to the balcony')" 
                : activeDoc?.type === 'scene'
                ? "Instructions (e.g. 'Add a beat where kaelen gets nervous and starts typing')"
                : "Instructions (e.g. 'Add a beat where she hesitates')"
            }
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
            ) : activeDoc?.type === 'blueprint' || activeDoc?.type === 'scene' ? (
              <button
                onClick={() => handleDocumentAssist()}
                disabled={!feedback.trim() || isWorking}
                className="w-full py-2 bg-gradient-to-br from-indigo-600 to-violet-700 hover:from-indigo-700 hover:to-violet-850 disabled:from-indigo-300 disabled:to-indigo-300 text-white font-semibold rounded-lg shadow-sm transition-all duration-200 text-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {isWorking ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Send Message
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

