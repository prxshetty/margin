import { useBlueprint } from '../../hooks/useBlueprint'
import { useProjectStore } from '../../stores/projectStore'

export default function Breadcrumb({ chapterId }: { chapterId: string | null }) {
  const { activeDoc, activeSceneId, sceneViewMode, setActiveDoc, setSceneViewMode } = useProjectStore()
  const { blueprintData } = useBlueprint(chapterId)

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

  const items: { label: string; onClick?: () => void }[] = [
    { label: 'Blueprint Overview', onClick: () => setActiveDoc(null) }
  ]

  if (activeDoc.type === 'scene') {
    if (activeActMeta) items.push({ label: `Act ${activeActMeta.act_number}` })
    if (sceneViewMode === 'beats') {
      items.push({ label: `Scene ${activeSceneMeta?.scene_number || ''}`, onClick: () => setSceneViewMode('content') })
    } else {
      items.push({ label: `Scene ${activeSceneMeta?.scene_number || ''}` })
    }
  } else if (activeDoc.type === 'character') {
    items.push({ label: 'Characters' }, { label: activeDoc.name })
  } else if (activeDoc.type === 'style') {
    items.push({ label: 'Styles' }, { label: activeDoc.name })
  } else if (activeDoc.type === 'chapter') {
    items.push({ label: 'result' }, { label: 'chapter.md' })
  } else if (activeDoc.type === 'blueprint') {
    items.push({ label: 'outputs' }, { label: 'blueprint.md' })
  } else if (activeDoc.type === 'outline') {
    items.push({ label: 'inputs' }, { label: 'outline.md' })
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-400 flex-wrap">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span>&rsaquo;</span>}
          {item.onClick ? (
            <button onClick={item.onClick}
              className="hover:text-slate-900 transition-colors font-medium hover:underline text-indigo-600"
            >
              {item.label}
            </button>
          ) : (
            <span className={`font-semibold ${i === items.length - 1 ? 'text-slate-600' : 'text-slate-400'}`}>
              {item.label}
            </span>
          )}
        </span>
      ))}
    </div>
  )
}
