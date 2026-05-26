import { useQueryClient } from '@tanstack/react-query'
import { useProjectStore } from '../../stores/projectStore'
import { useEditorStore } from '../../stores/editorStore'
import { API_BASE } from '../../lib/api'
import { List, BookOpen } from 'lucide-react'

export default function EditorHeader({ chapterId, blueprintData }: { chapterId: string | null, blueprintData: any }) {
  const { activeDoc, activeSceneId, sceneViewMode, setSceneViewMode, setActiveDoc } = useProjectStore()
  const { isSaving } = useEditorStore()
  const queryClient = useQueryClient()

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

  let activeSceneMeta: any = null
  if (activeSceneId && blueprintData) {
    for (const act of blueprintData.acts) {
      const found = act.scenes?.find((s: any) => s.id === activeSceneId)
      if (found) { activeSceneMeta = found; break }
    }
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
