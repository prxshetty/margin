import { create } from 'zustand'

export type ActiveDoc =
  | { type: 'scene'; sceneId: string }
  | { type: 'character'; slug: string; name: string }
  | { type: 'style'; id: string; name: string }
  | { type: 'chapter'; id: string; name: string }
  | { type: 'outline'; id: string; name: string }
  | { type: 'blueprint'; id: string; name: string }
  | null

interface ProjectState {
  activeChapterId: string | null
  activeActId: string | null
  activeSceneId: string | null
  activeDoc: ActiveDoc
  setActiveChapter: (id: string | null) => void
  setActiveAct: (id: string | null) => void
  setActiveScene: (id: string | null) => void
  setActiveDoc: (doc: ActiveDoc) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  activeChapterId: null,
  activeActId: null,
  activeSceneId: null,
  activeDoc: null,
  setActiveChapter: (id) => set({ activeChapterId: id }),
  setActiveAct: (id) => set({ activeActId: id }),
  setActiveScene: (id) => set({ activeSceneId: id, activeDoc: id ? { type: 'scene', sceneId: id } : null }),
  setActiveDoc: (doc) => {
    if (doc?.type === 'scene') {
      set({ activeDoc: doc, activeSceneId: doc.sceneId })
    } else {
      set({ activeDoc: doc, activeSceneId: null })
    }
  },
}))
