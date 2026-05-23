import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, Users, Settings, Map } from 'lucide-react'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { useBlueprint } from '../hooks/useBlueprint'
import { useScene } from '../hooks/useScene'
import { Sidebar } from '../components/Sidebar'
import { NovelEditor } from '../components/Editor/NovelEditor'
import { Toolbar } from '../components/Toolbar'
import { Inspector } from '../components/Inspector'
import { useProjectStore } from '../stores/projectStore'
import { useEditorStore } from '../stores/editorStore'

export default function Workshop() {
  const [searchParams] = useSearchParams()
  const chapterId = searchParams.get('chapter')
  const queryClient = useQueryClient()
  const [showOutline, setShowOutline] = useState(true)
  
  const { setActiveChapter, activeSceneId, setActiveScene } = useProjectStore()
  const { setContent } = useEditorStore()
  
  const { blueprintData, isLoading, generateBlueprint, isGenerating } = useBlueprint(chapterId)
  const { sceneData } = useScene(activeSceneId)

  // Fetch active chapter metadata for the original raw outline
  const { data: chapterData } = useQuery({
    queryKey: ['chapter', chapterId],
    queryFn: async () => {
      if (!chapterId) return null
      const res = await fetch(`http://127.0.0.1:8000/chapters/${chapterId}`)
      if (!res.ok) throw new Error('Failed to fetch chapter')
      return res.json()
    },
    enabled: !!chapterId
  })

  // Sync scene switching — clear editor content to prevent instance leaking
  useEffect(() => {
    setActiveChapter(chapterId)
  }, [chapterId, setActiveChapter])

  useEffect(() => {
    if (sceneData) {
      setContent(sceneData.generated_content || '')
    } else {
      setContent('')
    }
  }, [activeSceneId, sceneData, setContent])

  // Look up the active scene's metadata from blueprint data
  let activeSceneMeta: any = null
  let activeActMeta: any = null
  if (activeSceneId && blueprintData) {
    for (const act of blueprintData.acts) {
      const found = act.scenes?.find((s: any) => s.id === activeSceneId)
      if (found) {
        activeSceneMeta = found
        activeActMeta = act
        break
      }
    }
  }

  if (!chapterId) {
    return <div className="p-8">No chapter specified. <Link to="/" className="text-blue-600">Go back</Link></div>
  }

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden text-slate-900">
      {/* Sidebar */}
      {blueprintData ? (
        <Sidebar blueprintData={blueprintData} />
      ) : (
        <div className="w-64 border-r border-slate-200 bg-slate-50 p-4 flex flex-col items-center justify-center">
          {isLoading ? (
            <p className="text-slate-500 text-sm">Loading...</p>
          ) : (
            <button
              onClick={() => generateBlueprint()}
              disabled={isGenerating}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg shadow-sm text-sm font-medium disabled:opacity-50"
            >
              {isGenerating ? 'Generating...' : 'Generate Blueprint'}
            </button>
          )}
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top Nav */}
        <header className="h-14 border-b border-slate-200 bg-white flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-2">
            <Link to="/" className="text-slate-500 hover:text-slate-900 p-1 rounded-md hover:bg-slate-100">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            {!activeSceneId && blueprintData && (
              <span className="text-sm font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
                Blueprint Overview
              </span>
            )}
            {activeSceneId && activeActMeta && (
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <button 
                  onClick={() => setActiveScene(null)}
                  className="hover:text-slate-900 transition-colors font-medium hover:underline text-indigo-600"
                >
                  Blueprint Overview
                </button>
                <span>&rsaquo;</span>
                <span>Act {activeActMeta.act_number}</span>
                <span>&rsaquo;</span>
                <span className="font-semibold text-slate-600">Scene {activeSceneMeta?.scene_number}</span>
              </div>
            )}
          </div>
          
          <div className="flex gap-2">
            {chapterData?.raw_outline && (
              <button 
                onClick={() => setShowOutline(!showOutline)}
                className={`p-2 rounded-md transition-all ${showOutline ? 'bg-indigo-50 border border-indigo-200 text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'}`}
                title="Toggle Original Chapter Outline"
              >
                <Map className="w-5 h-5" />
              </button>
            )}
            <Link to="/characters" className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md" title="Characters">
              <Users className="w-5 h-5" />
            </Link>
            <button className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md" title="Settings">
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Editor Area or Blueprint Overview */}
        <div className="flex-1 overflow-y-auto">
          {activeSceneId ? (
            <div className="max-w-3xl mx-auto py-10 px-6 flex flex-col gap-0">

              {/* ── Scene header — part of the document ── */}
              <div className="mb-6 flex flex-col gap-1.5">
                {/* Setting badge + characters inline */}
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
                    {activeSceneMeta?.scene_setting || '—'}
                  </span>
                  {activeSceneMeta?.characters?.map((char: string) => (
                    <span key={char} className="text-[10px] font-semibold bg-indigo-50 border border-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full">
                      {char}
                    </span>
                  ))}
                </div>

                {/* Editable scene outline — no box, no header, just plain text area like a doc title/description */}
                <textarea
                  key={activeSceneId}
                  className="w-full text-slate-700 text-base leading-relaxed outline-none bg-transparent resize-none placeholder:text-slate-300"
                  defaultValue={activeSceneMeta?.scene_description || ''}
                  placeholder="Describe what happens in this scene…"
                  rows={3}
                  onInput={(e) => {
                    const t = e.currentTarget
                    t.style.height = 'auto'
                    t.style.height = t.scrollHeight + 'px'
                  }}
                  onBlur={async (e) => {
                    const newDesc = e.target.value
                    if (newDesc === activeSceneMeta?.scene_description) return
                    
                    const res = await fetch(`http://127.0.0.1:8000/scenes/${activeSceneId}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ scene_description: newDesc })
                    })
                    if (res.ok) {
                      queryClient.invalidateQueries({ queryKey: ['scene', activeSceneId] })
                      queryClient.invalidateQueries({ queryKey: ['blueprint', chapterId] })
                    }
                  }}
                />

                <div className="h-px bg-slate-200 mt-2" />
              </div>

              {/* ── Tiptap editor body ── */}
              <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
                <NovelEditor />
              </div>

              {/* ── Toolbar below editor ── */}
              <div className="mt-4">
                <Toolbar />
              </div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto flex flex-col gap-6 py-10 px-6">
              <div className="border-b border-slate-200 pb-5">
                <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
                  {blueprintData?.blueprint?.data?.chapter_title || blueprintData?.blueprint?.chapter_title || "Chapter Blueprint Skeleton"}
                </h1>
                <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
                  Review and analyze your structured acts and scenes. Select a scene below or from the sidebar to decompose it into beats and stream generated drafts.
                </p>
              </div>

              {showOutline && chapterData?.raw_outline && (
                <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col gap-2.5">
                  <h3 className="text-xs font-extrabold text-indigo-600 uppercase tracking-wider">
                    Original Chapter Outline
                  </h3>
                  <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap font-medium">
                    {chapterData.raw_outline}
                  </p>
                </div>
              )}
              
              <div className="flex flex-col gap-6">
                {blueprintData?.acts?.map((act: any) => (
                  <div key={act.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col gap-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                      <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                        <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs">Act {act.act_number}</span>
                        {act.act_theme}
                      </h2>
                      {act.act_transition_hint && (
                        <span className="text-xs text-slate-400 italic">Transition: {act.act_transition_hint}</span>
                      )}
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {act.scenes?.map((scene: any) => (
                        <div 
                          key={scene.id} 
                          onClick={() => setActiveScene(scene.id)}
                          className="p-4 border border-slate-200 rounded-lg bg-slate-50/50 hover:bg-blue-50/30 hover:border-blue-300 transition-all cursor-pointer flex flex-col justify-between gap-3 group"
                        >
                          <div>
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                                Scene {scene.scene_number}
                              </span>
                              <span className="text-xs font-mono text-slate-600 bg-slate-200/50 px-2 py-0.5 rounded">
                                {scene.scene_setting}
                              </span>
                            </div>
                            <p className="text-sm text-slate-700 mt-2 leading-relaxed group-hover:text-blue-900 transition-colors">
                              {scene.scene_description}
                            </p>
                          </div>
                          
                          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
                            <div className="flex flex-wrap gap-1">
                              {scene.characters?.map((char: string) => (
                                <span key={char} className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded-full font-semibold">
                                  {char}
                                </span>
                              ))}
                            </div>
                            <span className="text-xs text-blue-600 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                              Write Scene →
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <Inspector />
    </div>
  )
}
