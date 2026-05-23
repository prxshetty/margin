import { CheckCircle2, Circle, Clock } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'

export function Sidebar({ blueprintData }: { blueprintData: any }) {
  const { activeSceneId, setActiveScene } = useProjectStore()

  if (!blueprintData) return <div className="p-4 text-slate-500">Loading structure...</div>

  return (
    <div className="w-64 border-r border-slate-200 bg-slate-50 h-screen overflow-y-auto p-4 flex flex-col gap-4">
      <h2 className="font-bold text-slate-900 truncate" title={blueprintData.blueprint.chapter_title}>
        {blueprintData.blueprint.chapter_title || "Untitled Chapter"}
      </h2>
      
      <div className="flex flex-col gap-6">
        {blueprintData.acts.map((act: any) => (
          <div key={act.id}>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              Act {act.act_number}
            </h3>
            <div className="flex flex-col gap-1">
              {act.scenes.map((scene: any) => {
                const isActive = scene.id === activeSceneId
                
                // Status mapping: approved -> ✓, generated_content -> ●, else -> ○
                let StatusIcon = Circle
                let statusColor = "text-slate-300"
                if (scene.approved) {
                  StatusIcon = CheckCircle2
                  statusColor = "text-green-500"
                } else if (scene.generated_content) {
                  StatusIcon = Clock
                  statusColor = "text-blue-500"
                }

                return (
                  <button
                    key={scene.id}
                    onClick={() => setActiveScene(scene.id)}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors ${isActive ? 'bg-blue-100 text-blue-900 font-medium' : 'text-slate-600 hover:bg-slate-200'}`}
                  >
                    <StatusIcon className={`w-4 h-4 shrink-0 ${statusColor}`} />
                    <span className="truncate" title={scene.scene_description}>
                      S{scene.scene_number}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
