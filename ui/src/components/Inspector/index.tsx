import { useState } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useScene } from '../../hooks/useScene'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Wand2, Activity, RotateCcw, Pencil, Check, X, Terminal } from 'lucide-react'

export function Inspector() {
  const queryClient = useQueryClient()
  const { activeSceneId } = useProjectStore()
  const { sceneData, isLoading, decomposeScene, isDecomposing } = useScene(activeSceneId)

  // Local state for inline beat editing
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editBeatText, setEditBeatText] = useState('')
  const [editBeatStyle, setEditBeatStyle] = useState('general')

  // Fetch styles dynamically for the dropdown
  const { data: styles } = useQuery({
    queryKey: ['styles'],
    queryFn: async () => {
      const res = await fetch('http://127.0.0.1:8000/styles/')
      if (!res.ok) throw new Error('Failed to fetch styles')
      return res.json()
    }
  })

  // Fetch agent logs dynamically
  const { data: agentLogs, isLoading: isLogsLoading } = useQuery({
    queryKey: ['sceneLogs', activeSceneId],
    queryFn: async () => {
      if (!activeSceneId) return []
      const res = await fetch(`http://127.0.0.1:8000/scenes/${activeSceneId}/logs`)
      if (!res.ok) throw new Error('Failed to fetch logs')
      return res.json()
    },
    enabled: !!activeSceneId
  })

  // Mutation to persist beat updates back to SQLite
  const saveBeatsMutation = useMutation({
    mutationFn: async (updatedBeats: any[]) => {
      const res = await fetch(`http://127.0.0.1:8000/scenes/${activeSceneId}/beats`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beats: updatedBeats })
      })
      if (!res.ok) throw new Error('Failed to update beats')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scene', activeSceneId] })
      setEditingIndex(null)
    }
  })

  if (!activeSceneId) {
    return (
      <div className="w-80 border-l border-slate-200 bg-white h-screen overflow-y-auto p-4 hidden lg:block">
        <h3 className="font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-100">Inspector</h3>
        <p className="text-sm text-slate-500 italic">Select a scene to view beats and agents.</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="w-80 border-l border-slate-200 bg-white h-screen overflow-y-auto p-4 hidden lg:flex lg:flex-col items-center justify-center text-slate-400">
        <Activity className="w-6 h-6 animate-pulse mb-2 text-blue-500" />
        <p className="text-xs">Loading scene metadata...</p>
      </div>
    )
  }

  const beats = sceneData?.scene_events || []

  const startEditing = (index: number, beat: any) => {
    setEditingIndex(index)
    setEditBeatText(beat.beat || (typeof beat === 'string' ? beat : ""))
    setEditBeatStyle(beat.style || "general")
  }

  const cancelEditing = () => {
    setEditingIndex(null)
  }

  const saveEdit = (index: number) => {
    const updatedBeats = [...beats]
    const updatedBeat = { ...updatedBeats[index] }
    updatedBeat.beat = editBeatText
    updatedBeat.style = editBeatStyle
    updatedBeats[index] = updatedBeat
    saveBeatsMutation.mutate(updatedBeats)
  }

  return (
    <div className="w-80 border-l border-slate-200 bg-white h-screen overflow-y-auto p-4 hidden lg:flex lg:flex-col gap-6">
      <div>
        <h3 className="font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-100">Scene Metadata</h3>
        <div className="flex flex-col gap-3 mb-6 bg-slate-50 p-3 rounded-lg border border-slate-200">
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Setting</div>
            <div className="text-xs text-slate-900 font-mono bg-white border border-slate-100 px-2 py-1 rounded">{sceneData?.scene_setting || "Unknown Setting"}</div>
          </div>
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Characters</div>
            <div className="flex flex-wrap gap-1">
              {sceneData?.characters?.map((char: string) => (
                <span key={char} className="text-[10px] bg-white border border-slate-200 text-slate-700 px-1.5 py-0.5 rounded-full font-semibold">
                  {char}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
          <h3 className="font-semibold text-slate-900">Beat Events</h3>
          {beats.length > 0 && (
            <button
              type="button"
              onClick={() => decomposeScene()}
              disabled={isDecomposing}
              title="Re-run decomposer"
              className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-40"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isDecomposing ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
        
        {beats.length === 0 ? (
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-center flex flex-col items-center gap-3">
            <Wand2 className="w-8 h-8 text-slate-400" />
            <div className="text-xs text-slate-600 leading-relaxed">
              This scene's outline has not been broken down into dramatic beats yet.
            </div>
            <button
              type="button"
              onClick={() => decomposeScene()}
              disabled={isDecomposing}
              className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
            >
              {isDecomposing ? (
                <>
                  <Activity className="w-3.5 h-3.5 animate-spin" />
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
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            {beats.map((beat: any, index: number) => {
              const isEditing = editingIndex === index
              const beatStyle = beat.style || "general"
              const beatDesc = beat.beat || (typeof beat === 'string' ? beat : "")
              const flow = beat.conversation_flow || []
              
              if (isEditing) {
                return (
                  <div key={index} className="p-3 bg-white border-2 border-blue-500 rounded-lg flex flex-col gap-2 shadow-sm">
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Beat Style</label>
                      <select
                        value={editBeatStyle}
                        onChange={(e) => setEditBeatStyle(e.target.value)}
                        className="w-full text-xs p-1.5 border border-slate-200 rounded bg-slate-50 font-mono outline-none"
                      >
                        <option value="general">general</option>
                        {styles?.map((s: any) => (
                          s.name !== 'general' && <option key={s.id} value={s.name}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Beat Event Outline</label>
                      <textarea
                        value={editBeatText}
                        onChange={(e) => setEditBeatText(e.target.value)}
                        className="w-full text-xs p-1.5 border border-slate-200 rounded outline-none resize-none font-medium leading-relaxed"
                        rows={3}
                      />
                    </div>
                    <div className="flex justify-end gap-1.5 pt-1.5 border-t border-slate-100">
                      <button
                        onClick={cancelEditing}
                        className="p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 rounded transition-colors"
                        title="Cancel"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => saveEdit(index)}
                        disabled={saveBeatsMutation.isPending}
                        className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        title="Save changes"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )
              }

              return (
                <div key={index} className="p-3 bg-slate-50 border border-slate-200 rounded-lg group relative hover:border-slate-300 transition-colors">
                  <div className="font-medium text-slate-900 mb-1 leading-relaxed pr-6">
                    {index + 1}. <span className="text-blue-600 font-mono text-xs px-1.5 py-0.5 bg-blue-50 rounded">[{beatStyle}]</span> {beatDesc}
                  </div>
                  {flow.length > 0 && (
                    <div className="pl-4 text-slate-500 text-xs flex flex-col gap-1 mt-2 border-l-2 border-slate-200">
                      {flow.map((step: string, sIdx: number) => (
                        <span key={sIdx}>• {step}</span>
                      ))}
                    </div>
                  )}
                  <div className="pl-4 text-slate-400 text-[10px] mt-1.5 flex gap-3">
                    {beat.expected_exchanges && (
                      <span><span className="font-medium text-slate-500">Exchanges:</span> {beat.expected_exchanges}</span>
                    )}
                  </div>
                  <button
                    onClick={() => startEditing(index, beat)}
                    className="opacity-0 group-hover:opacity-100 absolute top-2 right-2 p-1 text-slate-400 hover:text-slate-900 hover:bg-slate-200 rounded transition-opacity"
                    title="Edit beat details"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div>
        <h3 className="font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-100 flex items-center gap-1.5">
          <Terminal className="w-4 h-4 text-slate-500" />
          Agent Logs
        </h3>
        
        {isLogsLoading ? (
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Activity className="w-3 h-3 animate-spin text-blue-500" />
            <span>Loading telemetry...</span>
          </div>
        ) : agentLogs && agentLogs.length > 0 ? (
          <div className="flex flex-col gap-2">
            {agentLogs.map((log: any) => (
              <details key={log.id} className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 group text-xs">
                <summary className="font-semibold text-slate-700 cursor-pointer list-none flex items-center justify-between hover:text-slate-900 outline-none">
                  <div className="flex items-center gap-1.5">
                    <span className="bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-mono text-[9px]">
                      {log.beat_number === 0 ? "Decomposer" : `Beat ${log.beat_number}`}
                    </span>
                    <span className="font-mono text-slate-600">{log.agent_name}</span>
                  </div>
                  <span className="text-[9px] text-slate-400 font-mono transition-transform group-open:rotate-180">▼</span>
                </summary>
                <div className="mt-2.5 pt-2.5 border-t border-slate-200 flex flex-col gap-2.5 text-[10px] font-mono leading-relaxed max-h-60 overflow-y-auto">
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">System Prompt</span>
                    <pre className="bg-white p-2 rounded border border-slate-100 overflow-x-auto whitespace-pre-wrap mt-1 text-slate-600">{log.system_prompt}</pre>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">User Input</span>
                    <pre className="bg-white p-2 rounded border border-slate-100 overflow-x-auto whitespace-pre-wrap mt-1 text-slate-600">{log.user_prompt}</pre>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">Agent Response</span>
                    <pre className="bg-blue-50/50 p-2 rounded border border-blue-100 overflow-x-auto whitespace-pre-wrap mt-1 text-blue-950 font-medium">{log.output}</pre>
                  </div>
                </div>
              </details>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500 italic">No agent logs generated yet.</p>
        )}
      </div>
    </div>
  )
}
