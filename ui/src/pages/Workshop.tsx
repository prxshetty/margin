import { useEffect, useRef, useState, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  ArrowLeft, CheckCircle2, Sparkles, CheckCircle,
  Play, RefreshCw, Square
} from 'lucide-react'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { useBlueprint } from '../hooks/useBlueprint'
import { useScene } from '../hooks/useScene'
import { useStream } from '../hooks/useStream'
import { Sidebar } from '../components/Sidebar'
import { NovelEditor } from '../components/Editor/NovelEditor'
import { SceneBeatsList } from '../components/Editor/SceneBeatsList'
import { Inspector } from '../components/Inspector'
import type { ActiveDoc } from '../stores/projectStore'
import { useProjectStore } from '../stores/projectStore'
import { useEditorStore } from '../stores/editorStore'
import { API_BASE } from '../lib/api'
import Breadcrumb from '../components/Breadcrumb'
import EditorHeader from '../components/Editor/EditorHeader'
import { getSaveEndpoint } from '../lib/save'
import WorkshopLanding from '../components/WorkshopLanding'
 
export default function Workshop() {
  const [searchParams] = useSearchParams()
  const chapterId = searchParams.get('chapter')
  const queryClient = useQueryClient()

  const { setActiveChapter, activeSceneId, activeDoc, setActiveDoc, currentBeatIndex, sceneViewMode, setSceneViewMode } = useProjectStore()
  const { content, setContent, isStreaming, reloadDocSignal } = useEditorStore()
  const { generateScene, stopGeneration } = useStream()

  const { blueprintData, generateBlueprint, isGenerating, confirmBlueprint, isConfirming } = useBlueprint(chapterId)
  const { sceneData } = useScene(activeDoc?.type === 'scene' ? activeDoc.sceneId : null)
  const isConfirmed = !!blueprintData?.blueprint?.confirmed

  const docChangeRef = useRef<number>(0)
  const [isExporting, setIsExporting] = useState(false)
  const [exportedChapterDoc, setExportedChapterDoc] = useState(false)

  const lastViewedSceneRef = useRef<string | null>(null)

  // Track previous document and live content for exit/unload saving
  const prevDocInfoRef = useRef<{doc: ActiveDoc, mode?: string, beatIndex?: number} | null>(null)
  const contentRef = useRef<string>('')
  const lastDocKeyRef = useRef<string>('')
  const hasLoadedRef = useRef<boolean>(false)

  // Force-reload the document from disk when the Toolbar's AI assist succeeds
  useEffect(() => {
    if (reloadDocSignal === 0) return
    hasLoadedRef.current = false
    // The content-loading effect will pick this up on next render since deps include activeDoc
  }, [reloadDocSignal])

  // Auto-save callback
  const saveContent = useCallback(async (docInfo: {doc: ActiveDoc, mode?: string, beatIndex?: number}, text: string) => {
    if (!docInfo?.doc || !text.trim()) return
    useEditorStore.getState().setIsSaving(true)
    try {
      const target = getSaveEndpoint(docInfo.doc, chapterId, docInfo.mode, docInfo.beatIndex)
      if (!target) return
      const { bodyKey } = target
      const res = await fetch(target.url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [bodyKey]: text })
      })
      if (!res.ok) throw new Error('Save failed')
      if (docInfo.doc.type === 'scene') {
        queryClient.invalidateQueries({ queryKey: ['scene', docInfo.doc.sceneId] })
      } else if (docInfo.doc.type === 'blueprint') {
        queryClient.invalidateQueries({ queryKey: ['blueprint', chapterId] })
      }
    } catch (err) {
      console.error('Auto-save failed:', err)
    } finally {
      useEditorStore.getState().setIsSaving(false)
    }
  }, [chapterId, queryClient])

  const { data: chapterData } = useQuery({
    queryKey: ['chapter', chapterId],
    queryFn: async () => {
      if (!chapterId) return null
      const res = await fetch(`${API_BASE}/chapters/${chapterId}`)
      if (!res.ok) throw new Error('Failed to fetch chapter')
      return res.json()
    },
    enabled: !!chapterId
  })

  useEffect(() => {
    setActiveChapter(chapterId)
  }, [chapterId, setActiveChapter])

  // Auto-initialize outline doc if blueprint does not exist yet and no active doc is set
  useEffect(() => {
    if (chapterId && blueprintData !== undefined && !blueprintData && !activeDoc) {
      setActiveDoc({ type: 'outline', id: 'outline', name: 'Original Outline' })
    }
  }, [chapterId, blueprintData, activeDoc, setActiveDoc])

  // Reset scene view mode when scene changes
  useEffect(() => {
    if (activeDoc?.type === 'scene' && activeSceneId && sceneData && activeSceneId !== lastViewedSceneRef.current) {
      const hasContent = !!sceneData.generated_content
      setSceneViewMode(hasContent ? 'content' : 'beats')
      lastViewedSceneRef.current = activeSceneId
    }
  }, [activeSceneId, sceneData, activeDoc])

  // Keep live content ref up-to-date
  useEffect(() => {
    contentRef.current = content
  }, [content])

  // Load content into editor when activeDoc changes, and save the previous doc on switch
  useEffect(() => {
    const currentDocInfo = activeDoc ? {
      doc: activeDoc,
      mode: activeDoc.type === 'scene' ? sceneViewMode : undefined,
      beatIndex: activeDoc.type === 'scene' && sceneViewMode === 'beats' ? currentBeatIndex : undefined
    } : null

    const docId = activeDoc
      ? activeDoc.type === 'scene'
        ? activeDoc.sceneId
        : activeDoc.type === 'character'
          ? activeDoc.slug
          : activeDoc.id
      : ''

    const docKey = activeDoc 
      ? activeDoc.type === 'scene'
        ? `${activeDoc.type}-${activeDoc.sceneId}-${sceneViewMode}-${sceneViewMode === 'beats' ? currentBeatIndex : ''}`
        : `${activeDoc.type}-${docId}`
      : 'none'

    const isSameDoc = docKey === lastDocKeyRef.current

    if (!isSameDoc) {
      // We are switching documents! Save the previous one if it has unsaved content.
      const prevDocInfo = prevDocInfoRef.current
      const prevContent = contentRef.current

      if (prevDocInfo && prevContent.trim()) {
        saveContent(prevDocInfo, prevContent)
      }

      // Track the new doc and reset loaded flag
      prevDocInfoRef.current = currentDocInfo
      lastDocKeyRef.current = docKey
      hasLoadedRef.current = false

      if (!activeDoc) {
        setContent('')
        return
      }
      docChangeRef.current = Date.now()
    }

    // If we have already loaded the content for this active document, do not overwrite it!
    if (hasLoadedRef.current) {
      return
    }

    if (!activeDoc) return

    if (activeDoc.type === 'scene') {
      if (sceneViewMode === 'content' && activeSceneId) {
        // Always fetch fresh from server so newly compiled beat prose is reflected immediately
        hasLoadedRef.current = true
        fetch(`${API_BASE}/scenes/${activeSceneId}`)
          .then(res => res.json())
          .then(data => { setContent(data.generated_content || '') })
          .catch(() => { setContent('') })
      } else if (sceneViewMode === 'beats' && activeSceneId) {
        hasLoadedRef.current = true
        fetch(`${API_BASE}/scenes/${activeSceneId}/beats/${currentBeatIndex + 1}`)
          .then(res => res.json())
          .then(data => { setContent(data.beat || '') })
          .catch(() => { setContent('') })
      }
      return
    }

    if (activeDoc.type === 'outline') {
      if (chapterData) {
        setContent(chapterData.raw_outline || '')
        hasLoadedRef.current = true
      } else {
        hasLoadedRef.current = true
        fetch(`${API_BASE}/chapters/${chapterId}`)
          .then(res => res.json())
          .then(data => { setContent(data.raw_outline || '') })
          .catch(() => { setContent('') })
      }
      return
    }

    if (activeDoc.type === 'character') {
      hasLoadedRef.current = true
      fetch(`${API_BASE}/characters/${activeDoc.slug}/content`)
        .then(res => res.json())
        .then(data => { setContent(data.content || '') })
        .catch(() => { setContent('') })
      return
    }

    if (activeDoc.type === 'style') {
      hasLoadedRef.current = true
      fetch(`${API_BASE}/styles/${activeDoc.id}/content`)
        .then(res => res.json())
        .then(data => { setContent(data.content || '') })
        .catch(() => { setContent('') })
      return
    }


    if (activeDoc.type === 'chapter') {
      hasLoadedRef.current = true
      fetch(`${API_BASE}/chapters/${chapterId}/export`)
        .then(res => res.json())
        .then(data => { setContent(data.content || '') })
        .catch(() => { setContent('') })
      return
    }

    if (activeDoc.type === 'blueprint') {
      hasLoadedRef.current = true
      fetch(`${API_BASE}/chapters/${chapterId}/blueprint/markdown`)
        .then(res => res.json())
        .then(data => { setContent(data.content || '') })
        .catch(() => { setContent('') })
      return
    }
  }, [activeDoc, sceneData, chapterData, setContent, saveContent, chapterId, sceneViewMode, currentBeatIndex, reloadDocSignal])



  // Safety net: Save content on browser close, tab close, or reload
  useEffect(() => {
    const handleBeforeUnload = () => {
      const prevDocInfo = prevDocInfoRef.current
      if (!prevDocInfo?.doc || !contentRef.current.trim()) return
      const target = getSaveEndpoint(prevDocInfo.doc, chapterId, prevDocInfo.mode, prevDocInfo.beatIndex)
      if (!target) return
      const { bodyKey } = target
      fetch(target.url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [bodyKey]: contentRef.current }),
        keepalive: true
      })
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [chapterId])

  // Approve scene
  const [isApproving, setIsApproving] = useState(false)
  const approveScene = async () => {
    if (!activeSceneId) return
    setIsApproving(true)
    try {
      // Always save active editor content before approving to persist any final manual changes
      if (activeDoc && contentRef.current.trim()) {
        const docInfo = {
          doc: activeDoc,
          mode: activeDoc.type === 'scene' ? sceneViewMode : undefined,
          beatIndex: activeDoc.type === 'scene' && sceneViewMode === 'beats' ? currentBeatIndex : undefined
        }
        await saveContent(docInfo, contentRef.current)
      }
      const res = await fetch(`${API_BASE}/scenes/${activeSceneId}/approve`, { method: 'POST' })
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ['scene', activeSceneId] })
        queryClient.invalidateQueries({ queryKey: ['blueprint', chapterId] })
      }
    } finally {
      setIsApproving(false)
    }
  }

  // Export / compile chapter
  const exportChapter = async () => {
    if (!chapterId) return
    setIsExporting(true)
    try {
      const res = await fetch(`${API_BASE}/chapters/${chapterId}/export`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setExportedChapterDoc(true)
        // Open the compiled chapter in the editor
        setActiveDoc({ type: 'chapter', id: 'chapter', name: blueprintData?.blueprint?.chapter_title || 'Chapter' })
        setContent(data.content || '')
      } else {
        const err = await res.json()
        alert(err.detail || 'Export failed')
      }
    } catch (e) {
      alert('Export failed')
    } finally {
      setIsExporting(false)
    }
  }

  if (!chapterId) {
    return <WorkshopLanding />
  }

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden text-slate-900">
      {/* Sidebar */}
      <Sidebar
        blueprintData={blueprintData}
        onExport={exportChapter}
        isExporting={isExporting}
        exportedChapterDoc={exportedChapterDoc}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top Nav */}
        <header className="h-14 border-b border-slate-200 bg-white flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-2">
            <Link to="/" className="text-slate-500 hover:text-slate-900 p-1 rounded-md hover:bg-slate-100">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <Breadcrumb chapterId={chapterId} />
          </div>

          <div className="flex items-center gap-2">
            {activeDoc?.type === 'scene' && sceneData && (
              <>
                {sceneData.scene_events && sceneData.scene_events.length > 0 && sceneViewMode === 'content' && (
                  <div className="flex items-center gap-1.5 mr-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (!activeSceneId) return
                        generateScene(activeSceneId)
                      }}
                      disabled={isStreaming}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold shadow-sm transition-all border shrink-0 cursor-pointer disabled:opacity-50 ${
                        isStreaming
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white border-transparent'
                      }`}
                      title="Regenerate Full Scene"
                    >
                      {isStreaming ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Drafting Scene...
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-current" />
                          Regenerate Scene
                        </>
                      )}
                    </button>

                    {isStreaming && (
                      <button
                        type="button"
                        onClick={stopGeneration}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg text-xs font-semibold cursor-pointer shadow-sm animate-pulse"
                        title="Stop Generation"
                      >
                        <Square className="w-3.5 h-3.5 fill-red-700 text-red-700 border-transparent" />
                        Stop
                      </button>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={approveScene}
                  disabled={isApproving}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all border shrink-0 mr-2 cursor-pointer ${
                    sceneData.approved
                      ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                  title={sceneData.approved ? "Mark scene as in-progress" : "Mark scene as approved/done"}
                >
                  <CheckCircle2 className={`w-4 h-4 ${sceneData.approved ? 'text-green-500 fill-green-200' : 'text-slate-400'}`} />
                  {sceneData.approved ? 'Approved' : 'Approve Scene'}
                </button>
              </>
            )}
            {(activeDoc === null || activeDoc.type === 'outline' || activeDoc.type === 'blueprint') && (
              <div className="flex items-center gap-2 mr-2">
                <button
                  type="button"
                  onClick={() => generateBlueprint(true)}
                  disabled={isGenerating}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-all border shrink-0 cursor-pointer disabled:opacity-50 ${
                    !blueprintData
                      ? 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white border-transparent'
                      : 'bg-gradient-to-r from-violet-50 to-indigo-50 text-indigo-700 border-indigo-200 hover:from-violet-100 hover:to-indigo-100'
                  }`}
                  title={blueprintData ? "Regenerate Chapter Blueprint structure using AI" : "Generate Chapter Blueprint structure using AI"}
                >
                  <Sparkles className={`w-3.5 h-3.5 ${!blueprintData ? 'text-white' : 'text-indigo-500'} ${isGenerating ? 'animate-spin' : ''}`} />
                  {isGenerating ? 'Planning...' : blueprintData ? 'Replan Blueprint' : 'Generate Blueprint'}
                </button>

                {blueprintData && (
                  isConfirmed ? (
                    <span className="flex items-center gap-1 px-3 py-1.5 bg-green-50 border border-green-200 text-green-700 rounded-lg text-xs font-extrabold shadow-sm shrink-0 select-none">
                      <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                      Confirmed
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => confirmBlueprint()}
                      disabled={isConfirming}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:from-amber-400 disabled:to-orange-400 text-white border-transparent rounded-lg text-xs font-extrabold shadow-sm transition-all shrink-0 cursor-pointer"
                      title="Lock this blueprint structure to generate scenes"
                    >
                      {isConfirming ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Confirming...
                        </>
                      ) : (
                        <>
                          <CheckCircle className="w-3.5 h-3.5" />
                          Confirm Blueprint
                        </>
                      )}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        </header>

        {/* Editor Area or Blueprint Overview */}
        <div className="flex-1 overflow-y-auto">
          {activeDoc ? (
            <div className={`${activeDoc.type === 'scene' && sceneViewMode === 'beats' ? 'max-w-6xl' : 'max-w-3xl'} mx-auto py-10 px-6 flex flex-col gap-0`}>
              <EditorHeader chapterId={chapterId} blueprintData={blueprintData} totalBeats={sceneData?.scene_events?.length || 0} />
              {activeDoc.type === 'scene' && sceneViewMode === 'beats' ? (
                <SceneBeatsList />
              ) : (
                <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
                  <NovelEditor />
                </div>
              )}
            </div>
          ) : !blueprintData ? (
            <div className="max-w-4xl mx-auto flex flex-col gap-6 py-20 px-6 animate-fadeIn items-center text-center">
              <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 shadow-inner mb-2">
                <Sparkles className="w-8 h-8 animate-pulse" />
              </div>
              <h2 className="text-xl font-extrabold text-slate-800">Outline Ready for Structuring</h2>
              <p className="text-slate-500 text-sm max-w-md leading-relaxed">
                Click the <strong className="text-indigo-600">Generate Blueprint</strong> button in the top navigation bar to analyze your outline and plan sequential acts, scenes, and beat timelines.
              </p>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto flex flex-col gap-6 py-10 px-6">
              <div className="border-b border-slate-200 pb-5 flex flex-wrap items-center justify-between gap-4">
                <div className="flex-1 min-w-[280px]">
                  <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
                    {blueprintData?.blueprint?.data?.chapter_title || blueprintData?.blueprint?.chapter_title || "Chapter Blueprint Skeleton"}
                    {isConfirmed ? (
                      <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1 shadow-sm">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        Confirmed
                      </span>
                    ) : (
                      <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1 shadow-sm">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                        Drafting
                      </span>
                    )}
                  </h1>
                  <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
                    Review and analyze your structured acts and scenes. Select a scene below or from the sidebar to decompose it into beats and stream generated drafts.
                  </p>
                </div>
              </div>

              {!isConfirmed && (
                <div className="bg-gradient-to-r from-indigo-50/60 to-blue-50/60 border border-slate-200 rounded-2xl p-8 text-center flex flex-col items-center gap-4 max-w-2xl mx-auto shadow-sm my-6">
                  <div className="w-12 h-12 bg-gradient-to-tr from-indigo-500 to-blue-500 text-white rounded-full flex items-center justify-center text-lg shadow-md font-extrabold animate-pulse">
                    ✨
                  </div>
                  <h3 className="text-base font-extrabold text-slate-800 tracking-tight">
                    Draft Blueprint Ready for Review!
                  </h3>
                  <p className="text-xs text-slate-600 max-w-md leading-relaxed font-medium">
                    Review and refine the draft chapter blueprint in <strong className="text-indigo-600">blueprint.md</strong> via the sidebar. When you are happy with the layout, click <strong className="text-amber-600">Confirm Blueprint</strong> in the header to initialize scene documents and start writing!
                  </p>
                </div>
              )}

              {chapterData?.raw_outline && (
                <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col gap-2.5">
                  <h3 className="text-xs font-extrabold text-indigo-600 uppercase tracking-wider">
                    Original Chapter Outline
                  </h3>
                  <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap font-medium">
                    {chapterData.raw_outline}
                  </p>
                </div>
              )}

              {isConfirmed && (
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
                            onClick={() => setActiveDoc({ type: 'scene', sceneId: scene.id })}
                            className="p-4 border border-slate-200 bg-slate-50/50 hover:bg-blue-50/30 hover:border-blue-300 rounded-lg transition-all flex flex-col justify-between gap-3 group cursor-pointer"
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
              )}
            </div>
          )}
        </div>
      </div>

      <Inspector 
        blueprintData={blueprintData}
        chapterId={chapterId}
      />
    </div>
  )
}
