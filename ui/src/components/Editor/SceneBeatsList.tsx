import { useState, useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Wand2, BookOpen, Layers, Edit3, ArrowRight, CheckCircle, RotateCcw, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { useScene } from '../../hooks/useScene'
import { useProjectStore } from '../../stores/projectStore'
import { useEditorStore } from '../../stores/editorStore'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { NovelEditor } from './NovelEditor'
import { InlineSelectionPopup } from './InlineSelectionPopup'
import { API_BASE } from '../../lib/api'

interface MiniDraftEditorProps {
  value: string
  onChange: (value: string) => void
  onBlur: (value: string) => void
  placeholder: string
  contextPath: string
}

function MiniDraftEditor({ value, onChange, onBlur, placeholder, contextPath }: MiniDraftEditorProps) {
  const setEditor = useEditorStore(state => state.setEditor)
  const setContent = useEditorStore(state => state.setContent)
  const setSelectedText = useEditorStore(state => state.setSelectedText)
  const setSelectionRange = useEditorStore(state => state.setSelectionRange)
  const setAnchorPosition = useEditorStore(state => state.setAnchorPosition)
  const setActiveContextPath = useEditorStore(state => state.setActiveContextPath)

  const lastContentRef = useRef('')
  const isProgrammaticUpdateRef = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({
        html: false,
        tightLists: true,
      })
    ],
    content: value || '',
    onUpdate: ({ editor }) => {
      if (isProgrammaticUpdateRef.current) return
      if ((editor.storage as any)?.markdown) {
        const newMarkdown = (editor.storage as any).markdown.getMarkdown()
        lastContentRef.current = newMarkdown
        setContent(newMarkdown)
        onChange(newMarkdown)
      }
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to, empty } = editor.state.selection
      setAnchorPosition(from)
      if (empty) {
        setSelectedText('')
        setSelectionRange(null)
      } else {
        const text = editor.state.doc.textBetween(from, to, ' ')
        setSelectedText(text)
        setSelectionRange({ from, to })
      }
    },
    onFocus: ({ editor }) => {
      setEditor(editor)
      setContent((editor.storage as any)?.markdown?.getMarkdown?.() || value || '')
      setActiveContextPath(contextPath)
    },
    onBlur: ({ editor }) => {
      if ((editor.storage as any)?.markdown) {
        const currentMarkdown = (editor.storage as any).markdown.getMarkdown()
        onBlur(currentMarkdown)
      }
    },
    editorProps: {
      attributes: {
        class: 'prose prose-slate max-w-none focus:outline-none px-4 pt-4 pb-16 text-[13px] text-slate-700 leading-relaxed font-sans flex-1 min-h-0 overflow-y-auto scrollbar-thin w-full',
      },
    },
  })

  // Sync external content changes into the editor
  useEffect(() => {
    if (editor && value !== undefined) {
      if (value !== lastContentRef.current) {
        lastContentRef.current = value
        isProgrammaticUpdateRef.current = true
        editor.commands.setContent(value || '', { contentType: 'markdown' } as any)
        isProgrammaticUpdateRef.current = false
      }
    }
  }, [value, editor])

  useEffect(() => {
    if (editor?.isFocused) {
      setActiveContextPath(contextPath)
      setContent(value || '')
    }
  }, [contextPath, editor, setActiveContextPath, setContent, value])

  return (
    <div className="flex-1 bg-white flex flex-col min-h-0 relative h-full">
      <EditorContent editor={editor} className="flex-1 flex flex-col min-h-0" />
      {editor && editor.isEmpty && (
        <div className="absolute top-4 left-4 text-slate-400 text-xs font-sans pointer-events-none select-none">
          {placeholder}
        </div>
      )}
      <InlineSelectionPopup localEditor={editor} />
    </div>
  )
}

export function SceneBeatsList() {
  const queryClient = useQueryClient()
  const { activeSceneId, currentBeatIndex, setCurrentBeatIndex, setSceneViewMode } = useProjectStore()
  const { content, setContent, editor, triggerReload } = useEditorStore()
  const { sceneData, decomposeScene, isDecomposing } = useScene(activeSceneId)

  const [activeTab, setActiveTab] = useState<'blueprint' | 'drafts'>('blueprint')
  const [drafts, setDrafts] = useState({ narration_draft: '', dialogue_draft: '' })
  const [, setIsLoadingDrafts] = useState(false)
  const [isGeneratingNarration, setIsGeneratingNarration] = useState(false)
  const [isGeneratingDialogue, setIsGeneratingDialogue] = useState(false)
  const [isMergingDrafts, setIsMergingDrafts] = useState(false)
  const [mergeSuccess, setMergeSuccess] = useState(false)
  const [isGeneratingAllDrafts, setIsGeneratingAllDrafts] = useState(false)
  const [generateAllProgress, setGenerateAllProgress] = useState('')
  const [isMergingAllBeats, setIsMergingAllBeats] = useState(false)
  const [mergeAllProgress, setMergeAllProgress] = useState('')
  const [beatListCollapsed, setBeatListCollapsed] = useState(false)

  // Fetch drafts when beat changes
  useEffect(() => {
    if (!activeSceneId || currentBeatIndex === undefined || currentBeatIndex < 0) return
    setIsLoadingDrafts(true)
    setMergeSuccess(false)
    fetch(`${API_BASE}/scenes/${activeSceneId}/beats/${currentBeatIndex + 1}/drafts`)
      .then(res => res.json())
      .then(data => {
        setDrafts({
          narration_draft: data.narration_draft || '',
          dialogue_draft: data.dialogue_draft || '',
        })
      })
      .catch(err => console.error('Error loading drafts:', err))
      .finally(() => setIsLoadingDrafts(false))
  }, [activeSceneId, currentBeatIndex])

  // Save narration/dialogue drafts to sidecars
  const handleUpdateDraft = async (key: 'narration_draft' | 'dialogue_draft', value: string) => {
    setDrafts(prev => ({ ...prev, [key]: value }))
    try {
      await fetch(`${API_BASE}/scenes/${activeSceneId}/beats/${currentBeatIndex + 1}/drafts`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value })
      })
    } catch (err) {
      console.error('Error updating draft:', err)
    }
  }

  // Generate individual drafts (narration or dialogue)
  const handleGenerateDraft = async (type: 'narration' | 'dialogue') => {
    if (type === 'narration') {
      setIsGeneratingNarration(true)
    } else {
      setIsGeneratingDialogue(true)
    }
    setMergeSuccess(false)
    try {
      const res = await fetch(`${API_BASE}/scenes/${activeSceneId}/beats/${currentBeatIndex + 1}/draft/${type}`, {
        method: 'POST'
      })
      if (!res.ok) throw new Error(`Failed to generate ${type} draft`)
      const data = await res.json()
      if (type === 'narration') {
        setDrafts(prev => ({ ...prev, narration_draft: data.narration_draft || '' }))
      } else {
        setDrafts(prev => ({ ...prev, dialogue_draft: data.dialogue_draft || '' }))
      }
    } catch (err) {
      alert(`Error generating ${type} draft: ` + err)
    } finally {
      if (type === 'narration') {
        setIsGeneratingNarration(false)
      } else {
        setIsGeneratingDialogue(false)
      }
    }
  }

  // Merge drafts → save prose to scene prose.md via backend assemble
  const handleMergeDrafts = async () => {
    setIsMergingDrafts(true)
    setMergeSuccess(false)
    try {
      const res = await fetch(`${API_BASE}/scenes/${activeSceneId}/beats/${currentBeatIndex + 1}/merge`, {
        method: 'POST'
      })
      if (!res.ok) throw new Error('Failed to merge drafts')
      // Invalidate scene query so Full Scene tab reads fresh prose.md
      queryClient.invalidateQueries({ queryKey: ['scene', activeSceneId] })
      setMergeSuccess(true)
    } catch (err) {
      alert('Error merging drafts: ' + err)
    } finally {
      setIsMergingDrafts(false)
    }
  }

  // Generate narration + dialogue drafts for ALL beats via SSE
  const handleGenerateAllDrafts = async () => {
    setIsGeneratingAllDrafts(true)
    setGenerateAllProgress('')

    try {
      const response = await fetch(`${API_BASE}/scenes/${activeSceneId}/beats/generate-all-drafts`, {
        method: 'POST',
      })

      if (!response.ok) throw new Error('Failed to start draft generation')
      if (!response.body) throw new Error('No response body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.status) {
                setGenerateAllProgress(data.status)
              }
              if (data.done) {
                setIsGeneratingAllDrafts(false)
                setGenerateAllProgress('')
                setMergeSuccess(false)
                if (activeSceneId && currentBeatIndex !== undefined && currentBeatIndex >= 0) {
                  fetch(`${API_BASE}/scenes/${activeSceneId}/beats/${currentBeatIndex + 1}/drafts`)
                    .then(res => res.json())
                    .then(data => {
                      setDrafts({
                        narration_draft: data.narration_draft || '',
                        dialogue_draft: data.dialogue_draft || '',
                      })
                    })
                    .catch(err => console.error('Error refreshing drafts:', err))
                }
                return
              }
            } catch (e) {
              // skip malformed JSON
            }
          }
        }
      }
    } catch (err) {
      alert('Error generating all drafts: ' + err)
    } finally {
      setIsGeneratingAllDrafts(false)
      setGenerateAllProgress('')
    }
  }

  // Merge ALL beats via SSE — runs WriterAgent for every beat
  const handleMergeAllBeats = async () => {
    setIsMergingAllBeats(true)
    setMergeAllProgress('')

    try {
      const response = await fetch(`${API_BASE}/scenes/${activeSceneId}/beats/merge-all`, {
        method: 'POST',
      })

      if (!response.ok) throw new Error('Failed to start merge')
      if (!response.body) throw new Error('No response body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.status) {
                setMergeAllProgress(data.status)
              }
              if (data.done) {
                setIsMergingAllBeats(false)
                setMergeAllProgress('')
                setMergeSuccess(false)
                queryClient.invalidateQueries({ queryKey: ['scene', activeSceneId] })
                if (activeSceneId && currentBeatIndex !== undefined && currentBeatIndex >= 0) {
                  fetch(`${API_BASE}/scenes/${activeSceneId}/beats/${currentBeatIndex + 1}/drafts`)
                    .then(res => res.json())
                    .then(data => {
                      setDrafts({
                        narration_draft: data.narration_draft || '',
                        dialogue_draft: data.dialogue_draft || '',
                      })
                    })
                    .catch(err => console.error('Error refreshing drafts:', err))
                }
                return
              }
            } catch (e) {
              // skip malformed JSON
            }
          }
        }
      }
    } catch (err) {
      alert('Error merging all beats: ' + err)
    } finally {
      setIsMergingAllBeats(false)
      setMergeAllProgress('')
    }
  }

  // Mutation to persist beat metadata
  const saveBeatsMutation = useMutation({
    mutationFn: async (updatedBeats: any[]) => {
      const res = await fetch(`${API_BASE}/scenes/${activeSceneId}/beats`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beats: updatedBeats })
      })
      if (!res.ok) throw new Error('Failed to save beats')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scene', activeSceneId] })
    }
  })

  const beats = sceneData?.scene_events || []

  const handleAddBeat = () => {
    const newBeat = { beat: 'New beat', style: 'general', expected_exchanges: '2-3', dialogue_density: null }
    const updated = [...beats, newBeat]
    saveBeatsMutation.mutate(updated, {
      onSuccess: () => {
        setCurrentBeatIndex(updated.length - 1)
        setActiveTab('blueprint')
      }
    })
  }

  const handleDeleteBeat = async (index: number) => {
    if (confirm('Are you sure you want to delete this beat?')) {
      const updated = [...beats]
      updated.splice(index, 1)

      let newBeatIndex = currentBeatIndex

      if (index === currentBeatIndex) {
        // Deleting the active beat: clear editor content to prevent switch autosave
        setContent('')
        editor?.commands.setContent('')
        if (updated.length === 0) {
          newBeatIndex = 0
        } else if (index >= updated.length) {
          newBeatIndex = Math.max(0, updated.length - 1)
        }
      } else {
        // Deleting a different beat: save the active beat's unsaved text first
        if (content.trim()) {
          try {
            await fetch(`${API_BASE}/scenes/${activeSceneId}/beats/${currentBeatIndex + 1}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ beat: content })
            })
          } catch (err) {
            console.error('Failed to save active beat before deletion:', err)
          }
        }

        // Shift active index down by 1 if the deleted beat precedes it
        if (index < currentBeatIndex) {
          newBeatIndex = currentBeatIndex - 1
        }
      }

      // Clear local content temporarily to prevent any switch race condition autosaves
      setContent('')
      editor?.commands.setContent('')

      saveBeatsMutation.mutate(updated, {
        onSuccess: () => {
          setCurrentBeatIndex(newBeatIndex)
          // Force active document reloading from server
          triggerReload()
        }
      })
    }
  }

  if (!beats.length) {
    return (
      <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-xl mt-4">
        <h3 className="text-lg font-bold text-slate-700 mb-2">No Beats Yet</h3>
        <p className="text-sm text-slate-500 mb-6 max-w-md mx-auto">This scene has not been decomposed into beats yet. Let AI break down your scene outline into a structured list of narrative beats.</p>
        
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={() => decomposeScene()}
            disabled={isDecomposing}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-bold shadow-sm transition-colors flex items-center justify-center gap-2 w-full max-w-xs cursor-pointer"
          >
            {isDecomposing ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Decomposing...
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                Decompose Scene Outline
              </>
            )}
          </button>
          
          <div className="text-xs text-slate-400 font-medium">or</div>
          
          <button
            onClick={handleAddBeat}
            className="px-4 py-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add manually
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-6 h-[calc(100vh-250px)] mt-4 items-stretch animate-fadeIn">
      {/* Left Sidebar: Master Beat List (collapsible) */}
      {!beatListCollapsed && (
        <div className="w-80 flex flex-col gap-3 shrink-0 bg-slate-50 border border-slate-200 p-3 rounded-xl">
          <div className="flex justify-between items-center px-1 mb-1">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Dramatic Beats</span>
            <div className="flex items-center gap-0.5">
              <button
                onClick={handleAddBeat}
                className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-white border border-transparent hover:border-slate-200 rounded transition-all cursor-pointer"
                title="Add beat"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  if (confirm("Are you sure you want to regenerate all beats? This will overwrite your current outline.")) {
                    decomposeScene()
                  }
                }}
                disabled={isDecomposing}
                className="p-1 text-slate-400 hover:text-blue-600 hover:bg-white border border-transparent hover:border-slate-200 rounded transition-all cursor-pointer disabled:opacity-50"
                title="Regenerate all beats using AI"
              >
                {isDecomposing ? (
                  <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                onClick={handleGenerateAllDrafts}
                disabled={isGeneratingAllDrafts || isDecomposing || isMergingAllBeats}
                className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-white border border-transparent hover:border-slate-200 rounded transition-all cursor-pointer disabled:opacity-50"
                title="Generate all drafts"
              >
                {isGeneratingAllDrafts ? (
                  <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <BookOpen className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                onClick={handleMergeAllBeats}
                disabled={isMergingAllBeats || isGeneratingAllDrafts || isDecomposing}
                className="p-1 text-slate-400 hover:text-emerald-600 hover:bg-white border border-transparent hover:border-slate-200 rounded transition-all cursor-pointer disabled:opacity-50"
                title="Merge all drafts"
              >
                {isMergingAllBeats ? (
                  <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Wand2 className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1 scrollbar-thin">
            {beats.map((beat: any, idx: number) => (
              <div
                key={idx}
                onClick={() => { setCurrentBeatIndex(idx); setMergeSuccess(false) }}
                className={`p-3 border rounded-xl transition-all cursor-pointer relative group ${
                  currentBeatIndex === idx
                    ? 'bg-white border-indigo-500 shadow-sm ring-1 ring-indigo-500/10'
                    : 'bg-white/60 border-slate-200 hover:border-slate-300 hover:bg-white'
                }`}
              >
                <div className="flex justify-between items-center gap-2 mb-1.5">
                  <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded ${
                    currentBeatIndex === idx
                      ? 'text-indigo-600 bg-indigo-50'
                      : 'text-slate-500 bg-slate-100'
                  }`}>
                    Beat {idx + 1}
                  </span>
                  <span className="text-[9px] font-mono text-slate-400 bg-slate-200/50 px-1 py-0.5 rounded uppercase max-w-[120px] truncate">
                    {beat.style || 'general'}
                  </span>
                </div>
                <p className="text-xs text-slate-600 font-medium leading-relaxed line-clamp-2">
                  {beat.beat || 'Describe the beat...'}
                </p>
                
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteBeat(idx)
                  }}
                  className="absolute top-2 right-2 p-1 text-slate-300 hover:text-red-500 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  title="Delete Beat"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Right Detail Pane */}
      <div className="flex-1 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm relative flex flex-col">
        {currentBeatIndex < beats.length ? (
          <>
            {/* Tabs Header */}
            <div className="flex border-b border-slate-200 bg-slate-50/80 px-2 pt-3 shrink-0 select-none">
              <button
                onClick={() => setBeatListCollapsed(!beatListCollapsed)}
                className="px-2 py-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 rounded-md transition-all cursor-pointer flex items-center border-b-2 border-transparent"
                title={beatListCollapsed ? "Show beat list" : "Hide beat list"}
              >
                {beatListCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setActiveTab('blueprint')}
                className={`px-4 py-2 text-[11px] uppercase tracking-wider font-bold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
                  activeTab === 'blueprint'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Step 1: Outline
              </button>
              <button
                onClick={() => setActiveTab('drafts')}
                className={`px-4 py-2 text-[11px] uppercase tracking-wider font-bold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
                  activeTab === 'drafts'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Edit3 className="w-3.5 h-3.5" />
                Step 2: Drafts
              </button>
            </div>

            {/* Tab Content */}
            {activeTab === 'blueprint' && (
              <div className="flex-1 overflow-y-auto">
                <NovelEditor />
              </div>
            )}

            {activeTab === 'drafts' && (
              <div className="flex-1 p-6 flex flex-col gap-5 overflow-y-auto bg-slate-50/30">
                {/* Header row */}
                <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm shrink-0">
                  <div>
                    <h4 className="text-sm font-extrabold text-slate-800">Narration & Dialogue Drafts</h4>
                    <p className="text-xs text-slate-500 mt-1 max-w-xl leading-relaxed">
                      Generate individual drafts using sequential sub-agents. First, generate your narration draft, make manual refinements, and then generate the dialogue draft based on it.
                    </p>
                  </div>
                </div>

                {/* Dual rich-text draft editors */}
                <div className="grid grid-cols-2 gap-5 flex-1 min-h-[280px]">
                  {/* Narration Draft */}
                  <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden">
                    <div className="flex justify-between items-center bg-slate-50 border-b border-slate-200 px-4 py-2 select-none shrink-0 h-11">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">Narration Draft</span>
                        {drafts.narration_draft && (
                          <span className="text-[9px] font-bold text-slate-400 bg-slate-200/50 px-1.5 py-0.5 rounded">
                            {drafts.narration_draft.length} chars
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => handleGenerateDraft('narration')}
                        disabled={isGeneratingNarration || isGeneratingDialogue}
                        className={`text-[10px] font-bold rounded-lg transition-all flex items-center cursor-pointer shadow-sm ${
                          drafts.narration_draft
                            ? 'p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 hover:border-slate-300'
                            : 'px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5'
                        }`}
                        title="Regenerate Narration Draft"
                      >
                        {isGeneratingNarration ? (
                          <>
                            <RotateCcw className="w-3 h-3 animate-spin" />
                            Drafting...
                          </>
                        ) : drafts.narration_draft ? (
                          <RotateCcw className="w-3.5 h-3.5" />
                        ) : (
                          <>
                            <Wand2 className="w-3 h-3" />
                            Generate
                          </>
                        )}
                      </button>
                    </div>
                    <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                      <MiniDraftEditor
                        value={drafts.narration_draft}
                        onChange={(val) => setDrafts(prev => ({ ...prev, narration_draft: val }))}
                        onBlur={(val) => handleUpdateDraft('narration_draft', val)}
                        placeholder="AI will generate the base narrative here with dialogue placeholders like [Dialogue: Character - Action]."
                        contextPath={`scenes/${activeSceneId}/beats/${currentBeatIndex + 1}/narration`}
                      />
                    </div>
                  </div>

                  {/* Dialogue Draft */}
                  <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden">
                    <div className="flex justify-between items-center bg-slate-50 border-b border-slate-200 px-4 py-2 select-none shrink-0 h-11">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">Dialogue Draft</span>
                        {drafts.dialogue_draft && (
                          <span className="text-[9px] font-bold text-slate-400 bg-slate-200/50 px-1.5 py-0.5 rounded">
                            {drafts.dialogue_draft.length} chars
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => handleGenerateDraft('dialogue')}
                        disabled={isGeneratingDialogue || isGeneratingNarration || !drafts.narration_draft}
                        className={`text-[10px] font-bold rounded-lg transition-all flex items-center cursor-pointer shadow-sm disabled:opacity-55 disabled:cursor-not-allowed ${
                          drafts.dialogue_draft
                            ? 'p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 hover:border-slate-300'
                            : 'px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5'
                        }`}
                        title={!drafts.narration_draft ? "Generate Narration first" : "Regenerate Dialogue Draft"}
                      >
                        {isGeneratingDialogue ? (
                          <>
                            <RotateCcw className="w-3 h-3 animate-spin" />
                            Drafting...
                          </>
                        ) : drafts.dialogue_draft ? (
                          <RotateCcw className="w-3.5 h-3.5" />
                        ) : (
                          <>
                            <Wand2 className="w-3 h-3" />
                            Generate
                          </>
                        )}
                      </button>
                    </div>
                    <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                      <MiniDraftEditor
                        value={drafts.dialogue_draft}
                        onChange={(val) => setDrafts(prev => ({ ...prev, dialogue_draft: val }))}
                        onBlur={(val) => handleUpdateDraft('dialogue_draft', val)}
                        placeholder="AI will expand the dialogue placeholders into full character speeches here."
                        contextPath={`scenes/${activeSceneId}/beats/${currentBeatIndex + 1}/dialogue`}
                      />
                    </div>
                  </div>
                </div>

                {/* Merge action row */}
                <div className="shrink-0">
                  {mergeSuccess ? (
                    <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-3.5 animate-fadeIn">
                      <div className="flex items-center gap-3">
                        <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                        <div>
                          <p className="text-sm font-bold text-emerald-800">Beat {currentBeatIndex + 1} prose saved to scene</p>
                          <p className="text-xs text-emerald-600 mt-0.5">Switch to Full Scene to read the compiled draft.</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setSceneViewMode('content')}
                        className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shrink-0"
                      >
                        View Full Scene
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={handleMergeDrafts}
                      disabled={isMergingDrafts || !drafts.narration_draft}
                      className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-xl text-sm font-bold shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {isMergingDrafts ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Merging drafts into scene...
                        </>
                      ) : (
                        <>
                          <Wand2 className="w-4 h-4" />
                          Merge Drafts → Save to Scene
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400">
            <BookOpen className="w-8 h-8 mb-2 opacity-50 animate-pulse" />
            <span className="text-sm font-medium">Select a beat from the sidebar to edit it.</span>
          </div>
        )}
      </div>
    </div>
  )
}
