import { useState, useEffect } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useScene } from '../../hooks/useScene'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Wand2, Activity, RotateCcw, Terminal } from 'lucide-react'

import { Trash2, Plus } from 'lucide-react'

export function Inspector({
  sceneViewMode,
  currentBeatIndex,
  setCurrentBeatIndex
}: {
  sceneViewMode?: 'content' | 'beats'
  currentBeatIndex?: number
  setCurrentBeatIndex?: (updater: any) => void
}) {
  const queryClient = useQueryClient()
  const { activeSceneId, activeDoc, setActiveDoc } = useProjectStore()
  const { sceneData, isLoading, decomposeScene, isDecomposing } = useScene(activeSceneId)

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

  // Mutation to persist beat updates back to file
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
    }
  })

  // Beat metadata from the current doc
  const beatMetadata = activeDoc?.type === 'scene' && sceneViewMode === 'beats' && sceneData?.scene_events
    ? sceneData.scene_events[currentBeatIndex ?? 0] || null
    : null

  const handleAddBeat = () => {
    if (!activeSceneId || !sceneData) return
    const currentBeats = sceneData.scene_events || []
    const newBeatNum = currentBeats.length + 1
    const newBeat = {
      beat: `New Beat ${newBeatNum}`,
      style: "general",
      expected_exchanges: "1",
      conversation_flow: ["New action event here"]
    }
    const updated = [...currentBeats, newBeat]
    saveBeatsMutation.mutate(updated, {
      onSuccess: () => {
        if (setCurrentBeatIndex) {
          setCurrentBeatIndex(currentBeats.length)
        }
      }
    })
  }

  const handleDeleteBeat = (e: React.MouseEvent, beatNum: number) => {
    e.stopPropagation()
    if (!activeSceneId || !sceneData) return
    
    const currentBeats = sceneData.scene_events || []
    const idx = beatNum - 1
    const updated = currentBeats.filter((_, i) => i !== idx)
    
    saveBeatsMutation.mutate(updated, {
      onSuccess: () => {
        if (setCurrentBeatIndex && currentBeatIndex !== undefined) {
          // Clamp index
          if (currentBeatIndex >= updated.length) {
            setCurrentBeatIndex(Math.max(0, updated.length - 1))
          }
        }
      }
    })
  }

  if (!activeDoc) {
    return (
      <div className="w-80 border-l border-slate-200 bg-white h-screen overflow-y-auto p-4 hidden lg:block">
        <h3 className="font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-100">Inspector</h3>
        <p className="text-sm text-slate-500 italic">Select a scene to view beats and agents.</p>
      </div>
    )
  }

  // Non-scene doc type — show metadata in sidebar
  if (activeDoc.type !== 'scene') {
    return (
      <div className="w-80 border-l border-slate-200 bg-white h-screen overflow-y-auto p-4 hidden lg:flex lg:flex-col gap-6">
        <div>
          <h3 className="font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-100">
            {activeDoc.type === 'character' && 'Character'}
            {activeDoc.type === 'style' && 'Style'}
          </h3>

          {activeDoc.type === 'character' && (
            <CharacterMetadataPanel key={activeDoc.slug} slug={activeDoc.slug} name={activeDoc.name} />
          )}

          {activeDoc.type === 'style' && <StyleMetadataPanel key={activeDoc.id} styleId={activeDoc.id} styleName={activeDoc.name} />}
        </div>
      </div>
    )
  }

  // Scene type — existing behavior below
  if (isLoading) {
    return (
      <div className="w-80 border-l border-slate-200 bg-white h-screen overflow-y-auto p-4 hidden lg:flex lg:flex-col items-center justify-center text-slate-400">
        <Activity className="w-6 h-6 animate-pulse mb-2 text-blue-500" />
        <p className="text-xs">Loading scene metadata...</p>
      </div>
    )
  }

  const beats = sceneData?.scene_events || []

  return (
    <div className="w-80 border-l border-slate-200 bg-white h-screen overflow-y-auto p-4 hidden lg:flex lg:flex-col gap-6">
      {sceneViewMode === 'beats' ? (
        <div>
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <h3 className="font-semibold text-slate-900">Beat Metadata</h3>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleAddBeat}
                title="Add new beat"
                className="p-1 hover:bg-emerald-50 text-emerald-500 hover:text-emerald-600 rounded transition-all"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={(e) => handleDeleteBeat(e, (currentBeatIndex ?? 0) + 1)}
                title="Delete this beat"
                className="p-1 hover:bg-red-50 text-red-400 hover:text-red-500 rounded transition-all"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
          {beatMetadata && (
            <BeatMetadataPanel
              key={`${activeSceneId}-${currentBeatIndex}`}
              beatIndex={currentBeatIndex ?? 0}
              beat={beatMetadata}
              styles={styles || []}
              saveBeatsMutation={saveBeatsMutation}
            />
          )}
        </div>
      ) : (
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
      )}

      {sceneViewMode === 'content' && (
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
              const beatStyle = beat.style || "general"
              const beatDesc = beat.beat || (typeof beat === 'string' ? beat : "")

              return (
                <div
                  key={index}
                  onClick={() => setCurrentBeatIndex?.(index)}
                  className={`p-3 bg-slate-50 border border-slate-200 rounded-lg hover:border-blue-300 hover:bg-blue-50/30 transition-colors cursor-pointer ${
                    currentBeatIndex === index ? 'border-blue-400 bg-blue-50/20' : ''
                  }`}
                >
                  <div className="font-medium text-slate-900 leading-relaxed truncate">
                    {index + 1}. <span className="text-blue-600 font-mono text-xs px-1.5 py-0.5 bg-blue-50 rounded">[{beatStyle}]</span> {beatDesc}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      )}

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
            {agentLogs
              .filter((log: any) => sceneViewMode === 'content' || log.beat_number === ((currentBeatIndex ?? 0) + 1) || log.beat_number === 0)
              .map((log: any) => (
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

function CharacterMetadataPanel({ slug, name }: { slug: string; name: string }) {
  const { setActiveDoc } = useProjectStore()
  const queryClient = useQueryClient()
  const [charName, setCharName] = useState(name)

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`http://127.0.0.1:8000/characters/${slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: charName })
      })
      if (!res.ok) throw new Error('Failed to save character')
      return res.json()
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['characters'] })
      setActiveDoc({ type: 'character', slug: data.slug, name: data.name })
    }
  })

  return (
    <div className="flex flex-col gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
      <div>
        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Name</label>
        <input
          type="text"
          value={charName}
          onChange={(e) => setCharName(e.target.value)}
          className="w-full text-sm p-2 border border-slate-200 rounded outline-none font-medium"
        />
      </div>

      <button
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
        className="w-full py-1.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg transition-colors"
      >
        {saveMutation.isPending ? 'Saving...' : 'Save Character'}
      </button>
    </div>
  )
}

function BeatMetadataPanel({ beatIndex, beat, styles, saveBeatsMutation }: {
  beatIndex: number
  beat: any
  styles: any[]
  saveBeatsMutation: any
}) {
  const { activeSceneId } = useProjectStore()
  const { sceneData } = useScene(activeSceneId)

  const [beatStyle, setBeatStyle] = useState(beat.style || 'general')
  const [exchanges, setExchanges] = useState(beat.expected_exchanges ?? 0)

  const save = () => {
    const updatedBeats = [...(sceneData?.scene_events || [])]
    updatedBeats[beatIndex] = {
      ...updatedBeats[beatIndex],
      style: beatStyle,
      expected_exchanges: exchanges
    }
    saveBeatsMutation.mutate(updatedBeats)
  }

  return (
    <div className="flex flex-col gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
      <div>
        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Style</label>
        <select
          value={beatStyle}
          onChange={(e) => setBeatStyle(e.target.value)}
          className="w-full text-xs p-1.5 border border-slate-200 rounded bg-white font-mono outline-none"
        >
          <option value="general">general</option>
          {styles?.map((s: any) => (
            s.name !== 'general' && <option key={s.id} value={s.name}>{s.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Exchanges</label>
        <input
          type="number"
          min={0}
          value={exchanges}
          onChange={(e) => setExchanges(parseInt(e.target.value) || 0)}
          className="w-full text-xs p-1.5 border border-slate-200 rounded bg-white font-mono outline-none"
        />
      </div>

      <button
        onClick={save}
        disabled={saveBeatsMutation.isPending}
        className="w-full py-1.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg transition-colors mt-2"
      >
        {saveBeatsMutation.isPending ? 'Saving...' : 'Save Metadata'}
      </button>
    </div>
  )
}

function StyleMetadataPanel({ styleId, styleName }: { styleId: string; styleName: string }) {
  const { setActiveDoc } = useProjectStore()
  const queryClient = useQueryClient()

  const { data: styleData, isLoading } = useQuery({
    queryKey: ['styleMetadata', styleId],
    queryFn: async () => {
      const res = await fetch(`http://127.0.0.1:8000/styles/${styleId}/content`)
      if (!res.ok) throw new Error('Failed to fetch style metadata')
      return res.json()
    }
  })

  const [name, setName] = useState(styleName)
  const [description, setDescription] = useState('')
  const [outputSize, setOutputSize] = useState('balanced')
  const [minDialogues, setMinDialogues] = useState(2)

  useEffect(() => {
    if (styleData) {
      setName(styleData.name || styleName)
      setDescription(styleData.description || '')
      setOutputSize(styleData.output_size || 'balanced')
      setMinDialogues(styleData.min_dialogues ?? 2)
    }
  }, [styleData, styleName])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`http://127.0.0.1:8000/styles/${styleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          output_size: outputSize,
          min_dialogues: minDialogues,
          agent_sections: {}
        })
      })
      if (!res.ok) throw new Error('Failed to save style metadata')
      return res.json()
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['styleMetadata', data.id || styleId] })
      setActiveDoc({ type: 'style', id: data.id, name })
    }
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-slate-400">
        <Activity className="w-3 h-3 animate-spin text-blue-500" />
        <span>Loading...</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
      <div>
        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full text-sm p-2 border border-slate-200 rounded outline-none font-medium"
        />
      </div>

      <div>
        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full text-xs p-2 border border-slate-200 rounded outline-none resize-none font-medium leading-relaxed"
          rows={3}
        />
      </div>

      <div>
        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Output Size</label>
        <select
          value={outputSize}
          onChange={(e) => setOutputSize(e.target.value)}
          className="w-full text-xs p-2 border border-slate-200 rounded bg-white outline-none"
        >
          <option value="concise">Concise</option>
          <option value="balanced">Balanced</option>
          <option value="expansive">Expansive</option>
        </select>
      </div>

      <div>
        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Min Dialogues</label>
        <input
          type="number"
          min={1}
          value={minDialogues}
          onChange={(e) => setMinDialogues(parseInt(e.target.value) || 2)}
          className="w-full text-xs p-2 border border-slate-200 rounded outline-none font-mono"
        />
      </div>

      <button
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
        className="w-full py-1.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg transition-colors"
      >
        {saveMutation.isPending ? 'Saving...' : 'Save Metadata'}
      </button>
    </div>
  )
}
