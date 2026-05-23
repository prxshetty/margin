import { useState } from 'react'
import { Play, RefreshCw, Wand2, Square } from 'lucide-react'
import { useStream } from '../../hooks/useStream'
import { useScene } from '../../hooks/useScene'
import { useEditorStore } from '../../stores/editorStore'
import { useProjectStore } from '../../stores/projectStore'

export function Toolbar() {
  const { isStreaming, content, selectedText, selectionRange, editor } = useEditorStore()
  const { activeSceneId } = useProjectStore()
  const { generateScene, stopGeneration } = useStream()
  const { sceneData, decomposeScene, isDecomposing } = useScene(activeSceneId)

  const [feedback, setFeedback] = useState('')
  const [isRewriting, setIsRewriting] = useState(false)

  if (!activeSceneId) return null

  const handleRewrite = async () => {
    if (!selectedText || !feedback.trim() || !selectionRange || !editor) return

    setIsRewriting(true)
    try {
      const response = await fetch(`http://localhost:8000/scenes/${activeSceneId}/rewrite_selection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selected_text: selectedText,
          feedback: feedback,
          context: content
        }),
      })

      if (!response.ok) throw new Error('Rewrite failed')
      
      const data = await response.json()
      if (data.rewritten_text) {
        editor.commands.insertContentAt({ from: selectionRange.from, to: selectionRange.to }, data.rewritten_text)
        setFeedback('')
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsRewriting(false)
    }
  }

  const isDecomposed = sceneData?.scene_events && sceneData.scene_events.length > 0

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        {!isDecomposed ? (
          <button
            onClick={() => decomposeScene()}
            disabled={isDecomposing}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium rounded-lg shadow-sm transition-colors text-sm"
          >
            {isDecomposing
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Decomposing...</>
              : <><Wand2 className="w-4 h-4" /> Decompose Scene Outline</>}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => generateScene(activeSceneId)}
              disabled={isStreaming}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium rounded-lg shadow-sm transition-colors text-sm"
            >
              {isStreaming
                ? <><RefreshCw className="w-4 h-4 animate-spin" /> Generating...</>
                : <><Play className="w-4 h-4" /> Generate Scene</>}
            </button>
            
            {isStreaming && (
              <button
                onClick={stopGeneration}
                className="flex items-center gap-2 px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 font-medium rounded-lg shadow-sm transition-colors text-sm border border-red-200"
                title="Cancel generation"
              >
                <Square className="w-4 h-4 fill-red-700" />
                Stop
              </button>
            )}
          </div>
        )}
      </div>

      {/* Feedback section — visible once content exists */}
      {content && (
        <div className="flex flex-col gap-2 mt-4 pt-4 border-t border-slate-200">
          {selectedText && (
            <div className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
              <span className="font-semibold">Selected:</span> {selectedText.length > 50 ? `${selectedText.substring(0, 50)}...` : selectedText}
            </div>
          )}
          <div className="flex items-start gap-2">
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder={selectedText ? "Feedback to rewrite selection (e.g. 'Make it more dramatic')" : "Feedback to regenerate (e.g. 'More tension in the opening beat')"}
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm resize-none"
              rows={2}
            />
            <button
              onClick={selectedText ? handleRewrite : () => { /* Add regenerate logic later if needed */ }}
              disabled={!feedback.trim() || isStreaming || isRewriting}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 text-white font-medium rounded-lg shadow-sm transition-colors text-sm whitespace-nowrap"
            >
              {isRewriting ? <><RefreshCw className="w-4 h-4 animate-spin inline mr-1" /> Rewriting...</> : (selectedText ? 'Rewrite Selection' : 'Regenerate')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
