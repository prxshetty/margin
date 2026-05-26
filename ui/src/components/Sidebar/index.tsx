import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useProjectStore } from '../../stores/projectStore'
import { API_BASE } from '../../lib/api'

// ── tiny inline SVGs ──────────────────────────────────────────────────────────
function FolderOpen({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3.086a1 1 0 0 1 .707.293L7.5 4H13a1 1 0 0 1 1 1v1H2l-.5-2.5Z" fill="currentColor" fillOpacity=".25" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
      <path d="M1.5 6h13l-1.5 7h-10L1.5 6Z" fill="currentColor" fillOpacity=".15" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
    </svg>
  )
}

function FolderClosed({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3.086a1 1 0 0 1 .707.293L7.5 4H13a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V3.5Z" fill="currentColor" fillOpacity=".2" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
    </svg>
  )
}

function FileIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 2.5A1.5 1.5 0 0 1 4.5 1h5.086a1 1 0 0 1 .707.293l2.914 2.914A1 1 0 0 1 13.5 5v8A1.5 1.5 0 0 1 12 14.5H4.5A1.5 1.5 0 0 1 3 13V2.5Z" fill="currentColor" fillOpacity=".15" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
      <path d="M9.5 1v3a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
    </svg>
  )
}

// ── collapsible section label ─────────────────────────────────────────────────
function SectionLabel({
  label, open, onToggle, color = 'text-slate-400', action
}: { label: string; open: boolean; onToggle: () => void; color?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between w-full mb-1 group/section">
      <button
        onClick={onToggle}
        className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest hover:text-slate-600 transition-colors ${color}`}
      >
        {open ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        {open
          ? <FolderOpen className="w-3.5 h-3.5 shrink-0" />
          : <FolderClosed className="w-3.5 h-3.5 shrink-0" />}
        <span>{label}</span>
      </button>
      {action && (
        <div className="flex items-center">
          {action}
        </div>
      )}
    </div>
  )
}

// ── main sidebar ──────────────────────────────────────────────────────────────
export function Sidebar({
  blueprintData,
  onExport,
  isExporting,
  exportedChapterDoc,
}: {
  blueprintData: any
  onExport: () => void
  isExporting: boolean
  exportedChapterDoc: boolean
}) {
  const { activeSceneId, activeDoc, setActiveDoc } = useProjectStore()
  const isConfirmed = !!blueprintData?.blueprint?.confirmed

  const [showCharacters, setShowCharacters] = useState(true)
  const [showStyles, setShowStyles]         = useState(true)
  const [collapsedActs, setCollapsedActs]   = useState<Record<string, boolean>>({})
  const [showOutputs, setShowOutputs]       = useState(true)
  const [showResult, setShowResult]         = useState(true)

  const toggleAct = (actId: string) =>
    setCollapsedActs(prev => ({ ...prev, [actId]: !prev[actId] }))

  const { data: characters } = useQuery({
    queryKey: ['characters'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/characters/`)
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json()
    }
  })

  const { data: styles } = useQuery({
    queryKey: ['styles'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/styles/`)
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json()
    }
  })

  const isDocActive = (type: string, id: string) => {
    if (!activeDoc) return false
    if (type === 'character' && activeDoc.type === 'character') return activeDoc.slug === id
    if (type === 'style'     && activeDoc.type === 'style')     return activeDoc.id   === id
    if (type === 'chapter'   && activeDoc.type === 'chapter')   return true
    if (type === 'blueprint' && activeDoc.type === 'blueprint') return true
    return false
  }

  return (
    <div className="w-64 border-r border-slate-200 bg-slate-50 h-screen overflow-y-auto flex flex-col">
      {/* Chapter title */}
      <div className="px-4 pt-4 pb-3 border-b border-slate-200">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Chapter</p>
        <h2 className="font-semibold text-slate-900 text-sm truncate leading-snug" title={blueprintData?.blueprint?.chapter_title || 'Unstructured Outline'}>
          {blueprintData?.blueprint?.chapter_title || 'Unstructured Outline'}
        </h2>
      </div>

      <div className="flex-1 px-3 py-3 flex flex-col gap-4 overflow-y-auto">

        {/* ── INPUTS ────────────────────────────────────────────── */}
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-300 mb-2 px-1">inputs/</p>

          {/* outline.md */}
          <div className="flex flex-col gap-0.5 mb-3">
            <button
              onClick={() => setActiveDoc({ type: 'outline', id: 'outline', name: 'Original Outline' })}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-xs text-left transition-colors w-full ${
                activeDoc?.type === 'outline' ? 'bg-indigo-100 text-indigo-900 font-medium' : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <FileIcon className="w-3 h-3 shrink-0 text-indigo-400" />
              outline.md
            </button>
          </div>

          {/* characters/ */}
          <div className="flex flex-col gap-0.5 mb-3">
            <SectionLabel label="characters" open={showCharacters} onToggle={() => setShowCharacters(v => !v)} color="text-indigo-400" />
            {showCharacters && (
              <div className="flex flex-col gap-0.5 ml-4">
                {!characters?.length && <span className="text-[11px] text-slate-400 italic px-2 py-1">No characters yet</span>}
                {characters?.map((char: any) => {
                  const active = isDocActive('character', char.slug)
                  return (
                    <button
                      key={char.id}
                      onClick={() => setActiveDoc({ type: 'character', slug: char.slug, name: char.name })}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left transition-colors ${
                        active ? 'bg-indigo-100 text-indigo-900 font-medium' : 'text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      <FileIcon className="w-3 h-3 shrink-0 text-indigo-300" />
                      <span className="truncate">{char.name}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* styles/ */}
          <div className="flex flex-col gap-0.5">
            <SectionLabel label="styles" open={showStyles} onToggle={() => setShowStyles(v => !v)} color="text-amber-400" />
            {showStyles && (
              <div className="flex flex-col gap-0.5 ml-4">
                {!styles?.length && <span className="text-[11px] text-slate-400 italic px-2 py-1">No styles yet</span>}
                {styles?.map((style: any) => {
                  const active = isDocActive('style', style.id)
                  return (
                    <button
                      key={style.id}
                      onClick={() => setActiveDoc({ type: 'style', id: style.id, name: style.name })}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left transition-colors ${
                        active ? 'bg-amber-100 text-amber-900 font-medium' : 'text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      <FileIcon className="w-3 h-3 shrink-0 text-amber-300" />
                      <span className="truncate">{style.name}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="h-px bg-slate-200" />

        {/* ── OUTPUTS ───────────────────────────────────────────── */}
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-300 mb-2 px-1">outputs/</p>
          <SectionLabel label="acts & scenes" open={showOutputs} onToggle={() => setShowOutputs(v => !v)} color="text-blue-400" />

          {showOutputs && (
            <div className="flex flex-col gap-3 mt-1">
              {blueprintData?.blueprint && (
                <div className="flex flex-col gap-0.5 pb-2">
                  <button
                    onClick={() => setActiveDoc({ type: 'blueprint', id: 'blueprint', name: blueprintData?.blueprint?.chapter_title || 'Blueprint Outline' })}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-xs text-left transition-colors w-full ${
                      isDocActive('blueprint', 'blueprint') ? 'bg-blue-100 text-blue-900 font-medium' : 'text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    <FileIcon className="w-3 h-3 shrink-0 text-blue-400" />
                    blueprint.md
                  </button>
                </div>
              )}

              {isConfirmed && blueprintData?.acts ? (
                blueprintData.acts.map((act: any) => {
                  const isCollapsed = collapsedActs[act.id] ?? false
                  return (
                    <div key={act.id} className="flex flex-col gap-0.5">
                      {/* act-N/ */}
                      <button
                        onClick={() => toggleAct(act.id)}
                        className="flex items-center gap-1.5 text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-0.5 hover:text-blue-600 transition-colors text-left"
                      >
                        {!isCollapsed ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
                        {!isCollapsed
                          ? <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                          : <FolderClosed className="w-3.5 h-3.5 shrink-0" />}
                        act-{act.act_number}
                      </button>

                      {!isCollapsed && (
                        <div className="flex flex-col gap-1 ml-4">
                          {act.scenes.map((scene: any) => {
                            const isActive = scene.id === activeSceneId
                            return (
                              <button
                                key={scene.id}
                                onClick={() => setActiveDoc({ type: 'scene', sceneId: scene.id })}
                                className={`flex items-center justify-between gap-1.5 px-2 py-1.5 rounded text-xs text-left transition-colors w-full ${
                                  isActive
                                    ? 'bg-blue-100 text-blue-900 font-medium'
                                    : 'text-slate-600 hover:bg-slate-200'
                                }`}
                              >
                                <span className="flex items-center gap-1.5 truncate">
                                  <FileIcon className="w-3 h-3 shrink-0 text-blue-300" />
                                  scene-{scene.scene_number}
                                </span>
                                {scene.approved ? (
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" title="Approved" />
                                ) : scene.generated_content ? (
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" title="Draft" />
                                ) : null}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })
              ) : !blueprintData?.blueprint ? (
                <div className="px-2 py-3 bg-slate-100 border border-slate-200/60 rounded-xl text-center">
                  <p className="text-[11px] text-slate-400 italic">Blueprint not generated</p>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="h-px bg-slate-200" />

        {/* ── RESULT ────────────────────────────────────────────── */}
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-300 mb-2 px-1">result/</p>
          <SectionLabel label="chapter" open={showResult} onToggle={() => setShowResult(v => !v)} color="text-rose-400" />

          {showResult && (
            <div className="ml-4 flex flex-col gap-1">
              {/* Compile button */}
              <button
                onClick={onExport}
                disabled={isExporting}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium text-rose-600 hover:bg-rose-50 border border-rose-200 hover:border-rose-300 transition-colors disabled:opacity-50 w-full"
                title="Compile all scenes into a single chapter file"
              >
                {isExporting ? (
                  <svg className="w-3 h-3 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeOpacity=".2"/>
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
                  </svg>
                ) : (
                  <svg className="w-3 h-3 shrink-0" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6.5 3.5L12 8l-5.5 4.5V3.5Z"/>
                  </svg>
                )}
                {isExporting ? 'Compiling...' : 'Compile chapter'}
              </button>

              {/* Compiled chapter entry — clickable if it exists */}
              {exportedChapterDoc && (
                <button
                  onClick={() => setActiveDoc({ type: 'chapter', id: 'chapter', name: blueprintData.blueprint.chapter_title })}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left transition-colors ${
                    isDocActive('chapter', 'chapter') ? 'bg-rose-100 text-rose-900 font-medium' : 'text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <FileIcon className="w-3 h-3 shrink-0 text-rose-300" />
                  chapter.md
                </button>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
