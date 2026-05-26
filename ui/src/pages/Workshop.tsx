import { useEffect, useRef, useState, useCallback } from 'react'
import { useSearchParams, Link, useNavigate } from 'react-router-dom'
import { 
  ArrowLeft, CheckCircle2, Sparkles, Brain, Cpu,
  BookPlus, Trash2, FolderOpen, Link2, Link2Off, AlertCircle, CheckCircle, Layout,
  Play, RefreshCw, Square, BookOpen, List
} from 'lucide-react'
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query'
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
import { getSaveEndpoint } from '../lib/save'
 
export default function Workshop() {
  const [searchParams] = useSearchParams()
  const chapterId = searchParams.get('chapter')
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [inputPath, setInputPath] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  interface Chapter {
    id: string
    title: string
    created_at: string
  }

  const { data: chapters, isLoading: isChaptersLoading } = useQuery({
    queryKey: ['chapters'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/chapters/`)
      if (!res.ok) throw new Error('Failed to fetch chapters')
      return res.json() as Promise<Chapter[]>
    }
  })

  const { data: settingsStatus, refetch: refetchSettings } = useQuery({
    queryKey: ['settingsStatus'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/settings/status`)
      if (!res.ok) throw new Error('Failed to fetch settings status')
      return res.json() as Promise<{
        is_linked: boolean
        inputs_dir: string
        outputs_dir: string
        default_inputs_dir: string
        default_outputs_dir: string
        warning?: string | null
        stats?: {
          chapters: number
          characters: number
          styles: number
          blueprints: number
        }
      }>
    }
  })

  const { data: llmSettings, refetch: refetchLlmSettings } = useQuery({
    queryKey: ['llmSettings'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/settings`)
      if (!res.ok) throw new Error('Failed to fetch LLM settings')
      return res.json() as Promise<{
        reasoning_model: boolean
        prepend_thinking_preamble: boolean
      }>
    }
  })

  const updateLlmSettingsMutation = useMutation({
    mutationFn: async (updated: { reasoning_model: boolean; prepend_thinking_preamble: boolean }) => {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      })
      if (!res.ok) throw new Error('Failed to update LLM settings')
      return res.json()
    },
    onSuccess: () => {
      refetchLlmSettings()
    }
  })

  const deleteMutation = useMutation({
    mutationFn: async ({ id, target }: { id: string, target: 'input' | 'output' | 'both' }) => {
      const res = await fetch(`${API_BASE}/chapters/${id}?target=${target}`, {
        method: 'DELETE'
      })
      if (!res.ok) throw new Error('Failed to delete chapter')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chapters'] })
      refetchSettings()
    }
  })

  const linkMutation = useMutation({
    mutationFn: async (path: string) => {
      setErrorMsg('')
      setSuccessMsg('')
      const res = await fetch(`${API_BASE}/settings/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs_path: path })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Failed to link directory')
      }
      return res.json()
    },
    onSuccess: async () => {
      refetchSettings()
      const chaptersResult = await queryClient.fetchQuery({
        queryKey: ['chapters'],
        queryFn: async () => {
          const res = await fetch(`${API_BASE}/chapters/`)
          if (!res.ok) throw new Error('Failed to fetch chapters')
          return res.json() as Promise<Chapter[]>
        }
      })
      
      setSuccessMsg('Directory linked successfully!')
      setInputPath('')
      
      if (chaptersResult && chaptersResult.length > 0) {
        navigate(`/workshop?chapter=${chaptersResult[0].id}`)
      } else {
        navigate('/workshop')
      }
    },
    onError: (err: any) => {
      setErrorMsg(err.message)
    }
  })

  const unlinkMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg('')
      setSuccessMsg('')
      const res = await fetch(`${API_BASE}/settings/unlink`, {
        method: 'POST'
      })
      if (!res.ok) throw new Error('Failed to restore default workspace')
      return res.json()
    },
    onSuccess: () => {
      refetchSettings()
      queryClient.invalidateQueries({ queryKey: ['chapters'] })
      setSuccessMsg('Restored default workspace directories!')
    },
    onError: (err: any) => {
      setErrorMsg(err.message)
    }
  })

  const { setActiveChapter, activeSceneId, activeDoc, setActiveDoc, currentBeatIndex, sceneViewMode, setSceneViewMode } = useProjectStore()
  const { content, setContent, isStreaming, reloadDocSignal } = useEditorStore()
  const { generateScene, stopGeneration } = useStream()

  const { blueprintData, generateBlueprint, isGenerating, confirmBlueprint, isConfirming } = useBlueprint(chapterId)
  const { sceneData } = useScene(activeDoc?.type === 'scene' ? activeDoc.sceneId : null)
  const isConfirmed = !!blueprintData?.blueprint?.confirmed

  const [isSaving, setIsSaving] = useState(false)
  const docChangeRef = useRef<number>(0)
  const [isExporting, setIsExporting] = useState(false)
  const [exportedChapterDoc, setExportedChapterDoc] = useState(false)

  const [deleteConfirmChapter, setDeleteConfirmChapter] = useState<{ id: string, title: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<'input' | 'output' | 'both'>('both')
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
    setIsSaving(true)
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
      setIsSaving(false)
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

  // Build breadcrumb based on active doc type
  const renderBreadcrumb = () => {
    if (!activeDoc) {
      return blueprintData ? (
        <span className="text-sm font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
          Blueprint Overview
        </span>
      ) : null
    }

    if (!blueprintData) {
      return (
        <span className="text-sm font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
          Original Chapter Outline
        </span>
      )
    }

    const items: { label: string; onClick?: () => void }[] = [{ label: 'Blueprint Overview', onClick: () => setActiveDoc(null) }]

    if (activeDoc.type === 'scene') {
      if (activeActMeta) {
        items.push({ label: `Act ${activeActMeta.act_number}` })
      }
      if (sceneViewMode === 'beats') {
        items.push({ label: `Scene ${activeSceneMeta?.scene_number || ''}`, onClick: () => setSceneViewMode('content') })
        if (sceneData?.scene_events?.length) {

        } else {
          items.push({ label: `No Beats` })
        }
      } else {
        items.push({ label: `Scene ${activeSceneMeta?.scene_number || ''}` })
      }
    } else if (activeDoc.type === 'character') {
      items.push({ label: 'Characters' })
      items.push({ label: activeDoc.name })
    } else if (activeDoc.type === 'style') {
      items.push({ label: 'Styles' })
      items.push({ label: activeDoc.name })
    } else if (activeDoc.type === 'chapter') {
      items.push({ label: 'result' })
      items.push({ label: 'chapter.md' })
    } else if (activeDoc.type === 'blueprint') {
      items.push({ label: 'outputs' })
      items.push({ label: 'blueprint.md' })
    } else if (activeDoc.type === 'outline') {
      items.push({ label: 'inputs' })
      items.push({ label: 'outline.md' })
    }

    return (
      <div className="flex items-center gap-1.5 text-xs text-slate-400 flex-wrap">
        {items.map((item, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span>&rsaquo;</span>}
            {item.onClick ? (
              <button onClick={item.onClick} className="hover:text-slate-900 transition-colors font-medium hover:underline text-indigo-600">
                {item.label}
              </button>
            ) : (
              <span className={`font-semibold ${i === items.length - 1 ? 'text-slate-600' : 'text-slate-400'}`}>{item.label}</span>
            )}
          </span>
        ))}
      </div>
    )
  }

  const renderEditorHeader = () => {
    if (!activeDoc) return null
    if (activeDoc.type !== 'scene') {
      return (
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {activeDoc.type === 'character' && 'Character Profile'}
              {activeDoc.type === 'style' && 'Style Guidelines'}
              {activeDoc.type === 'outline' && (
                <span className="flex items-center gap-1.5">
                  <span className="text-indigo-600">outline.md</span>
                  <span className="text-slate-300">— chapter source</span>
                </span>
              )}
              {activeDoc.type === 'blueprint' && (
                <span className="flex items-center gap-1.5">
                  <span className="text-blue-500">blueprint.md</span>
                  <span className="text-slate-300">— compiled structure</span>
                </span>
              )}
              {activeDoc.type === 'chapter' && (
                <span className="flex items-center gap-1.5">
                  <span className="text-rose-500">chapter.md</span>
                  <span className="text-slate-300">— compiled output</span>
                </span>
              )}
            </span>
          </div>
          {activeDoc.type !== 'chapter' && activeDoc.type !== 'blueprint' && (
            <span className={`text-[10px] font-mono ${isSaving ? 'text-amber-500' : 'text-slate-400'}`}>
              {isSaving ? 'Saving...' : 'Auto-saved'}
            </span>
          )}
        </div>
      )
    }

    return (
      <div className="mb-6 flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between mb-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
              {activeSceneMeta?.scene_setting || '—'}
            </span>
            {activeSceneMeta?.characters?.map((char: string) => (
              <button
                key={char}
                onClick={() => {
                  const slug = char.toLowerCase().replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, '').replace(/\s+/g, '_')
                  setActiveDoc({ type: 'character', slug, name: char })
                }}
                className="text-[10px] font-semibold bg-indigo-50 border border-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full hover:bg-indigo-100 hover:border-indigo-200 transition-colors"
              >
                {char}
              </button>
            ))}
          </div>
          
          <div className="flex items-center gap-3">
            {/* View Mode Toggle */}
            <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 shadow-sm shrink-0">
              <button
                type="button"
                onClick={() => setSceneViewMode('beats')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                  sceneViewMode === 'beats'
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50/50'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                Beats Editor
              </button>
              <button
                type="button"
                onClick={() => setSceneViewMode('content')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                  sceneViewMode === 'content'
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50/50'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                Full Scene
              </button>
            </div>



            <span className={`text-[10px] font-mono shrink-0 select-none ${isSaving ? 'text-amber-500 font-bold animate-pulse' : 'text-slate-400'}`}>
              {isSaving ? 'Saving...' : 'Auto-saved'}
            </span>
          </div>
        </div>

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
            const res = await fetch(`${API_BASE}/scenes/${activeSceneId}`, {
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
        <div className="h-px bg-slate-200 mt-2 animate-fadeIn" />

      </div>
    )
  }

  if (!chapterId) {
    return (
      <div className="min-h-screen bg-slate-50 overflow-y-auto text-slate-900">
        <div className="max-w-4xl mx-auto p-8 animate-fadeIn">
          <header className="flex justify-between items-center mb-12">
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 flex items-center gap-3">
              <Layout className="w-8 h-8 text-blue-600 animate-pulse" />
              SLM Writing Engine
            </h1>
          </header>

          {/* Workspace Directory Link Section */}
          <div className="bg-white border border-slate-200/80 rounded-2xl p-6 mb-8 shadow-sm transition-all hover:border-slate-300">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                  <FolderOpen className="w-5 h-5 text-blue-600" />
                  Workspace Data Directory
                </h3>
                <p className="text-slate-500 text-sm mt-1">
                  Link an external directory to read outlines, characters, and styles directly from your custom book folder.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {settingsStatus?.is_linked ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60 shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    Linked External
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                    <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                    Default Local Workspace
                  </span>
                )}
              </div>
            </div>
            {settingsStatus?.warning && (
              <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm mb-4 animate-shake shadow-sm">
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="font-bold text-amber-900 block">System Access Safeguard</span>
                  <p className="text-amber-700 text-xs leading-relaxed">{settingsStatus.warning}</p>
                </div>
              </div>
            )}
            {settingsStatus && (
              <div className="space-y-4 mb-4">
                <div className="space-y-3 bg-slate-50/50 rounded-xl p-4 border border-slate-100 shadow-sm text-sm text-slate-600">
                  <div className="flex items-start gap-2">
                    <span className="font-semibold text-slate-500 min-w-[100px]">Inputs Dir:</span>
                    <code className="text-xs bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-slate-700 break-all select-all flex-1">
                      {settingsStatus.inputs_dir}
                    </code>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="font-semibold text-slate-500 min-w-[100px]">Outputs Dir:</span>
                    <code className="text-xs bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-slate-700 break-all select-all flex-1">
                      {settingsStatus.outputs_dir}
                    </code>
                  </div>
                </div>

                {settingsStatus.stats && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 shadow-sm text-center transition-all hover:scale-[1.02] hover:border-slate-300">
                      <span className="block text-2xl font-extrabold text-slate-800">{settingsStatus.stats.chapters}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Chapters</span>
                    </div>
                    <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 shadow-sm text-center transition-all hover:scale-[1.02] hover:border-slate-300">
                      <span className="block text-2xl font-extrabold text-slate-800">{settingsStatus.stats.characters}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Characters</span>
                    </div>
                    <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 shadow-sm text-center transition-all hover:scale-[1.02] hover:border-slate-300">
                      <span className="block text-2xl font-extrabold text-slate-800">{settingsStatus.stats.styles}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Styles</span>
                    </div>
                    <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 shadow-sm text-center transition-all hover:scale-[1.02] hover:border-slate-300">
                      <span className="block text-2xl font-extrabold text-slate-800">{settingsStatus.stats.blueprints}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Blueprints</span>
                    </div>
                  </div>
                )}

                {llmSettings && (
                  <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-slate-50/50 border border-slate-100 rounded-xl p-4 flex items-center justify-between shadow-sm">
                      <div className="pr-4">
                        <span className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                          <Cpu className="w-4 h-4 text-indigo-500" />
                          AI Reasoning Model
                        </span>
                        <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                          Enable internal thinking filters for reasoning models (e.g. DeepSeek R1, Qwen Distill).
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateLlmSettingsMutation.mutate({
                          reasoning_model: !llmSettings.reasoning_model,
                          prepend_thinking_preamble: llmSettings.prepend_thinking_preamble
                        })}
                        className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors shadow-inner shrink-0 ${
                          llmSettings.reasoning_model ? 'bg-indigo-600' : 'bg-slate-300'
                        }`}
                      >
                        <div
                          className={`bg-white w-4 h-4 rounded-full shadow-md transform duration-200 ease-in-out ${
                            llmSettings.reasoning_model ? 'translate-x-6' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="bg-slate-50/50 border border-slate-100 rounded-xl p-4 flex items-center justify-between shadow-sm">
                      <div className="pr-4">
                        <span className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                          <Brain className="w-4 h-4 text-indigo-500" />
                          Prepend Thinking Preamble
                        </span>
                        <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                          Force thoughts inside tags. Turn this **OFF** for native reasoning models (like DeepSeek) to prevent list/thought leaks.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateLlmSettingsMutation.mutate({
                          reasoning_model: llmSettings.reasoning_model,
                          prepend_thinking_preamble: !llmSettings.prepend_thinking_preamble
                        })}
                        className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors shadow-inner shrink-0 ${
                          llmSettings.prepend_thinking_preamble ? 'bg-indigo-600' : 'bg-slate-300'
                        }`}
                      >
                        <div
                          className={`bg-white w-4 h-4 rounded-full shadow-md transform duration-200 ease-in-out ${
                            llmSettings.prepend_thinking_preamble ? 'translate-x-6' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <form 
              onSubmit={(e) => {
                e.preventDefault()
                if (inputPath.trim()) {
                  linkMutation.mutate(inputPath.trim())
                }
              }}
              className="flex flex-col sm:flex-row gap-3"
            >
              <div className="flex-1 relative">
                <input
                  type="text"
                  placeholder="Paste absolute path to inputs/ folder (e.g. /Users/name/book/inputs)"
                  value={inputPath}
                  onChange={(e) => setInputPath(e.target.value)}
                  className="w-full pl-4 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-inner"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={linkMutation.isPending || !inputPath.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors shadow-sm disabled:opacity-50 flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <Link2 className="w-4 h-4" />
                  Link Folder
                </button>
                {settingsStatus?.is_linked && (
                  <button
                    type="button"
                    onClick={() => unlinkMutation.mutate()}
                    disabled={unlinkMutation.isPending}
                    className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-800 border border-slate-200 rounded-xl text-sm font-medium transition-colors shadow-sm flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <Link2Off className="w-4 h-4 text-slate-400" />
                    Restore Default
                  </button>
                )}
              </div>
            </form>

            {errorMsg && (
              <div className="mt-3 text-xs text-red-600 bg-red-50 border border-red-100 p-2.5 rounded-lg flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {successMsg && (
              <div className="mt-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 p-2.5 rounded-lg flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Link 
              to="/new"
              className="border-2 border-dashed border-slate-300 rounded-2xl p-8 flex flex-col items-center justify-center text-slate-500 hover:border-blue-500 hover:text-blue-600 transition-colors h-48 bg-white hover:bg-blue-50/20 shadow-sm"
            >
              <BookPlus className="w-12 h-12 mb-4 text-slate-400" />
              <span className="font-semibold text-lg">Create New Chapter</span>
            </Link>

            {isChaptersLoading ? (
              <div className="border border-slate-200 rounded-2xl p-8 flex items-center justify-center h-48 bg-white shadow-sm">
                <span className="text-slate-400">Loading chapters...</span>
              </div>
            ) : (
              chapters?.map(chapter => (
                <div
                  key={chapter.id}
                  className="border border-slate-200 rounded-2xl p-8 flex flex-col justify-between bg-white shadow-sm hover:shadow-md transition-all hover:border-blue-300 h-48 group relative cursor-pointer"
                  onClick={() => navigate(`/workshop?chapter=${chapter.id}`)}
                >
                  <div className="flex-1">
                    <h2 className="text-xl font-semibold text-slate-900 group-hover:text-blue-600 mb-2 transition-colors">
                      {chapter.title}
                    </h2>
                    <p className="text-slate-400 text-xs mt-1">
                      Created {new Date(chapter.created_at).toLocaleDateString()}
                    </p>
                  </div>

                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setDeleteConfirmChapter({ id: chapter.id, title: chapter.title })
                      setDeleteTarget('both')
                    }}
                    className="absolute top-4 right-4 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors opacity-0 group-hover:opacity-100 z-10 cursor-pointer"
                    title="Delete chapter"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Delete Options Modal Overlay */}
        {deleteConfirmChapter && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-sm animate-fadeIn">
              <h3 className="text-xl font-bold text-slate-900 mb-2">
                Delete Chapter "{deleteConfirmChapter.title}"
              </h3>
              <p className="text-sm text-slate-500 mb-5 leading-relaxed">
                Select which parts of the chapter you would like to permanently delete. This action is irreversible.
              </p>

              <div className="space-y-3 mb-6">
                {[
                  {
                    value: 'input',
                    label: 'Input Outline Only',
                    desc: 'Keep all generated scenes, blueprints, and narrative beats, but delete the raw outline (.md) file.',
                  },
                  {
                    value: 'output',
                    label: 'Generated Outputs Only',
                    desc: 'Keep the source outline (.md), but delete all generated scenes, compiled drafts, blueprints, and dramatic beats.',
                  },
                  {
                    value: 'both',
                    label: 'Both (Full Clean)',
                    desc: 'Permanently delete the input outline and all generated scenes, blueprints, and dramatic beats.',
                  },
                ].map((choice) => (
                  <button
                    key={choice.value}
                    type="button"
                    onClick={() => setDeleteTarget(choice.value as 'input' | 'output' | 'both')}
                    className={`w-full text-left p-3.5 rounded-xl border text-sm transition-all flex flex-col gap-1 cursor-pointer ${
                      deleteTarget === choice.value
                        ? 'bg-slate-50 border-slate-800 ring-1 ring-slate-800'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <span className="font-semibold text-slate-900">{choice.label}</span>
                    <span className="text-xs text-slate-500 leading-relaxed">{choice.desc}</span>
                  </button>
                ))}
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmChapter(null)}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleteMutation.isPending}
                  onClick={async () => {
                    if (deleteConfirmChapter) {
                      await deleteMutation.mutateAsync({ id: deleteConfirmChapter.id, target: deleteTarget })
                      setDeleteConfirmChapter(null)
                    }
                  }}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-medium transition-colors shadow-sm disabled:opacity-50 flex items-center gap-1.5 cursor-pointer font-semibold"
                >
                  {deleteMutation.isPending ? 'Deleting...' : 'Delete Permanently'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
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
            {renderBreadcrumb()}
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
              {renderEditorHeader()}

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
