import { useState, useEffect, useRef } from 'react'
import { RefreshCw, Plus, Sparkles, X, PenLine, Copy, Check } from 'lucide-react'
import { useEditorStore } from '../../stores/editorStore'
import { useProjectStore } from '../../stores/projectStore'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { getDocInfo, getDocPath } from '../../lib/docInfo'
import { API_BASE } from '../../lib/api'

export function Toolbar() {
  const {
    content,
    setContent,
    editor,
    anchorPosition,
    aiAssistPreload,
    setAIAssistPreload,
    activeContextPath,
    triggerReload
  } = useEditorStore()
  const { activeSceneId, activeDoc, activeChapterId, currentBeatIndex, sceneViewMode } = useProjectStore()
  const queryClient = useQueryClient()

  const { docType, docId } = getDocInfo(activeDoc, activeSceneId)

  const { data: aiEditorLogs, isLoading: isLoadingLogs } = useQuery({
    queryKey: ['aiEditorLogs', activeDoc?.type, docId],
    queryFn: async () => {
      const isScene = activeDoc?.type === 'scene'
      if (isScene && !activeSceneId) return []
      if (!isScene && !activeChapterId) return []

      const url = isScene
        ? `${API_BASE}/scenes/${activeSceneId}/ai_editor_logs`
        : `${API_BASE}/chapters/${activeChapterId}/ai_editor_logs?doc_type=${docType}&doc_id=${docId}`

      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch AI editor logs')
      return res.json()
    },
    enabled: activeDoc?.type === 'scene' ? !!activeSceneId : !!activeChapterId
  })

  const [feedback, setFeedback] = useState('')
  const [isWorking, setIsWorking] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [virtualMessages, setVirtualMessages] = useState<any[]>([])
  const fallbackContextPath = activeDoc?.type === 'scene'
    ? sceneViewMode === 'content'
      ? `scenes/${activeSceneId || activeDoc.sceneId}/prose`
      : `scenes/${activeSceneId || activeDoc.sceneId}/beats/${currentBeatIndex + 1}`
    : getDocPath(activeDoc, activeSceneId, activeChapterId)
  const expectedContextPrefix = activeDoc?.type === 'scene'
    ? sceneViewMode === 'content'
      ? fallbackContextPath
      : `scenes/${activeSceneId || activeDoc.sceneId}/beats`
    : fallbackContextPath
  const resolvedContextPath = activeContextPath && (!expectedContextPrefix || activeContextPath.startsWith(expectedContextPrefix))
    ? activeContextPath
    : fallbackContextPath
  const contextLabel = resolvedContextPath ? resolvedContextPath.split('/').slice(-3).join('/') : 'No editor focus'

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
      if (!resolvedContextPath) throw new Error('No active edit context')

      const response = await fetch(`${API_BASE}/api/assist/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context_path: resolvedContextPath,
          content,
          message: feedback,
          history: [],
          selection: {
            text: aiAssistPreload.text,
            from: aiAssistPreload.range.from,
            to: aiAssistPreload.range.to
          },
          current_beat_index: currentBeatIndex,
          chapter_id: activeChapterId
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
        if ((editor.storage as any)?.markdown) {
          setContent((editor.storage as any).markdown.getMarkdown())
        }
        setFeedback('')
        setAIAssistPreload(null)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsWorking(false)
      queryClient.invalidateQueries({ queryKey: ['aiEditorLogs'] })
    }
  }

  const handleDocumentAssist = async (customMessage?: string) => {
    const textToSend = customMessage || feedback.trim()
    if (!textToSend) return

    setIsWorking(true)
    
    // Build clean user/assistant history from current state
    const history = [
      ...(aiEditorLogs || []).flatMap((log: any) => [
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
      if (!resolvedContextPath) throw new Error('No active edit context')

      const response = await fetch(`${API_BASE}/api/assist/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context_path: resolvedContextPath,
          content,
          message: textToSend,
          history,
          current_beat_index: currentBeatIndex,
          chapter_id: activeChapterId
        })
      })
      if (!response.ok) throw new Error('Failed to run assist')
      const res = await response.json()

      if (res.type === 'applied') {
        if (typeof res.content === 'string') {
          setContent(res.content)
          editor?.commands.setContent(res.content || '', { contentType: 'markdown' } as any)
        }
        setVirtualMessages(prev => [
          ...prev,
          {
            id: 'temp-ai-' + Date.now(),
            operation: 'applied',
            feedback: null,
            output: res.message || 'Edit applied.',
            timestamp: new Date().toISOString(),
            isVirtual: true,
            isAI: true
          }
        ])
        if (activeSceneId) queryClient.invalidateQueries({ queryKey: ['scene', activeSceneId] })
        if (activeChapterId) {
          queryClient.invalidateQueries({ queryKey: ['blueprint', activeChapterId] })
          queryClient.invalidateQueries({ queryKey: ['blueprintMarkdown', activeChapterId] })
        }
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

      if (!resolvedContextPath) throw new Error('No active edit context')

      const response = await fetch(`${API_BASE}/api/assist/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context_path: resolvedContextPath,
          content,
          message: feedback,
          history: [],
          text_before: textBefore,
          text_after: textAfter,
          block_type: blockType,
          current_beat_index: currentBeatIndex,
          chapter_id: activeChapterId
        })
      })

      if (!response.ok) throw new Error('Insert failed')
      const data = await response.json()
      if (typeof data.content === 'string') {
        setContent(data.content)
        editor.commands.setContent(data.content || '', { contentType: 'markdown' } as any)
        setFeedback('')
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

            {[...(aiEditorLogs || []), ...virtualMessages].map((log: any) => {
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

                        {log.context_path && (
                          <div className="text-[9px] text-indigo-100/75 font-mono bg-indigo-800/25 px-2 py-1 rounded truncate select-text">
                            {log.context_path}
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

                        {log.input_preview && (
                          <details className="mt-2 pt-2 border-t border-current/10">
                            <summary className="cursor-pointer select-none text-[10px] uppercase tracking-wider font-semibold opacity-70">
                              Input Preview
                            </summary>
                            <div className="mt-1 font-mono text-[10px] leading-relaxed max-h-32 overflow-y-auto whitespace-pre-wrap opacity-80">
                              {log.input_preview}
                            </div>
                          </details>
                        )}

                        {log.raw_operation && (
                          <details className="mt-2 pt-2 border-t border-current/10">
                            <summary className="cursor-pointer select-none text-[10px] uppercase tracking-wider font-semibold opacity-70">
                              Structured Operation
                            </summary>
                            <pre className="mt-1 font-mono text-[10px] leading-relaxed max-h-32 overflow-y-auto whitespace-pre-wrap opacity-80">
                              {JSON.stringify(log.raw_operation, null, 2)}
                            </pre>
                          </details>
                        )}

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
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500 px-1 min-w-0">
          <span className="font-bold uppercase tracking-wider text-slate-400 shrink-0">Editing</span>
          <span className="font-mono truncate" title={resolvedContextPath || ''}>{contextLabel}</span>
        </div>

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
