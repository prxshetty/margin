import { create } from 'zustand'

interface ProjectState {
  activeChapterId: string | null
  activeActId: string | null
  activeSceneId: string | null
  setActiveChapter: (id: string | null) => void
  setActiveAct: (id: string | null) => void
  setActiveScene: (id: string | null) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  activeChapterId: null,
  activeActId: null,
  activeSceneId: null,
  setActiveChapter: (id) => set({ activeChapterId: id }),
  setActiveAct: (id) => set({ activeActId: id }),
  setActiveScene: (id) => set({ activeSceneId: id }),
}))
