import { create } from 'zustand'
import { Editor } from '@tiptap/react'

interface EditorState {
  content: string
  setContent: (content: string) => void
  isStreaming: boolean
  setIsStreaming: (isStreaming: boolean) => void
  isApproved: boolean
  setIsApproved: (isApproved: boolean) => void
  eventSource: EventSource | null
  setEventSource: (eventSource: EventSource | null) => void
  editor: Editor | null
  setEditor: (editor: Editor | null) => void
  selectedText: string
  setSelectedText: (text: string) => void
  selectionRange: { from: number; to: number } | null
  setSelectionRange: (range: { from: number; to: number } | null) => void
  anchorPosition: number
  setAnchorPosition: (pos: number) => void
  aiAssistPreload: { text: string; range: { from: number; to: number } } | null
  setAIAssistPreload: (preload: { text: string; range: { from: number; to: number } } | null) => void
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
  editor: null,
  setEditor: (editor) => set({ editor }),
  selectedText: '',
  setSelectedText: (selectedText) => set({ selectedText }),
  selectionRange: null,
  setSelectionRange: (selectionRange) => set({ selectionRange }),
  anchorPosition: 0,
  setAnchorPosition: (anchorPosition) => set({ anchorPosition }),
  aiAssistPreload: null,
  setAIAssistPreload: (aiAssistPreload) => set({ aiAssistPreload }),
}))
