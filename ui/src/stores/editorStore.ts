import { create } from 'zustand'

interface EditorState {
  content: string
  setContent: (content: string) => void
  isStreaming: boolean
  setIsStreaming: (isStreaming: boolean) => void
  isApproved: boolean
  setIsApproved: (isApproved: boolean) => void
  eventSource: EventSource | null
  setEventSource: (eventSource: EventSource | null) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  content: '',
  setContent: (content) => set({ content }),
  isStreaming: false,
  setIsStreaming: (isStreaming) => set({ isStreaming }),
  isApproved: false,
  setIsApproved: (isApproved) => set({ isApproved }),
  eventSource: null,
  setEventSource: (eventSource) => set({ eventSource }),
}))
