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
  currentBeatIndex: number
  sceneViewMode: 'beats' | 'content'
  setActiveChapter: (id: string | null) => void
  setActiveAct: (id: string | null) => void
  setActiveScene: (id: string | null) => void
  setActiveDoc: (doc: ActiveDoc) => void
  setCurrentBeatIndex: (index: number) => void
  setSceneViewMode: (mode: 'beats' | 'content') => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  activeChapterId: null,
  activeActId: null,
  activeSceneId: null,
  activeDoc: null,
  currentBeatIndex: 0,
  sceneViewMode: 'beats',
  setActiveChapter: (id) => set({ activeChapterId: id }),
  setActiveAct: (id) => set({ activeActId: id }),
  setActiveScene: (id) => set({ activeSceneId: id, activeDoc: id ? { type: 'scene', sceneId: id } : null, currentBeatIndex: 0 }),
  setActiveDoc: (doc) => {
    if (doc?.type === 'scene') {
      set({ activeDoc: doc, activeSceneId: doc.sceneId, currentBeatIndex: 0 })
    } else {
      set({ activeDoc: doc, activeSceneId: null, currentBeatIndex: 0 })
    }
  },
  setCurrentBeatIndex: (index) => set({ currentBeatIndex: index }),
  setSceneViewMode: (mode) => set({ sceneViewMode: mode }),
}))
