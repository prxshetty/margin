import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Layout, FolderOpen, AlertCircle, Cpu, Brain,
  CheckCircle, BookPlus, Trash2, Link2, Link2Off
} from 'lucide-react'
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query'
import { API_BASE } from '../lib/api'

interface Chapter {
  id: string
  title: string
  created_at: string
}

export default function WorkshopLanding() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [inputPath, setInputPath] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [deleteConfirmChapter, setDeleteConfirmChapter] = useState<{ id: string, title: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<'input' | 'output' | 'both'>('both')

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
        dialogue_density: number
      }>
    }
  })

  const updateLlmSettingsMutation = useMutation({
    mutationFn: async (updated: { reasoning_model?: boolean; prepend_thinking_preamble?: boolean; dialogue_density?: number }) => {
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
                  <div className="bg-slate-50/50 border border-slate-100 rounded-xl p-4 shadow-sm md:col-span-2">
                    <div className="flex items-center justify-between gap-4 mb-3">
                      <div>
                        <span className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                          <BookPlus className="w-4 h-4 text-indigo-500" />
                          Dialogue / Narration Balance
                        </span>
                        <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                          Global writing preference used during beat decomposition and final prose merge.
                        </p>
                      </div>
                      <span className="text-[11px] font-bold text-indigo-700 bg-white border border-indigo-100 rounded-lg px-2 py-1 shrink-0">
                        {Math.round((llmSettings.dialogue_density ?? 0.5) * 100)}% dialogue
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Narration</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        value={Math.round((llmSettings.dialogue_density ?? 0.5) * 100)}
                        onChange={(e) => updateLlmSettingsMutation.mutate({ dialogue_density: Number(e.target.value) / 100 })}
                        className="w-full accent-indigo-600 cursor-pointer"
                      />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Dialogue</span>
                    </div>
                  </div>

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
