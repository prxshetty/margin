import { create } from 'zustand'
import { Editor } from '@tiptap/react'

export interface FileEntry {
  name: string
  path: string
  content: string
  originalContent: string
}

interface EditorState {
  content: string
  setContent: (content: string) => void
  isStreaming: boolean
  setIsStreaming: (isStreaming: boolean) => void
  isSaving: boolean
  setIsSaving: (saving: boolean) => void
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
  pendingEditSelection: { text: string; from: number; to: number } | null
  setPendingEditSelection: (sel: { text: string; from: number; to: number } | null) => void
  activeContextPath: string | null
  setActiveContextPath: (path: string | null) => void
  reloadDocSignal: number
  triggerReload: () => void
  workspaceDir: string | null
  setWorkspaceDir: (dir: string | null) => void
  openedFiles: FileEntry[]
  addFile: (file: FileEntry) => void
  removeFile: (path: string) => void
  loadFileContent: (path: string, content: string) => void
  clearFiles: () => void
  currentFilePath: string | null
  setCurrentFilePath: (path: string | null) => void
  updateFileContent: (path: string, content: string) => void
  markFileClean: (path: string) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  content: '',
  setContent: (content) => set({ content }),
  isStreaming: false,
  setIsStreaming: (isStreaming) => set({ isStreaming }),
  isSaving: false,
  setIsSaving: (saving) => set({ isSaving: saving }),
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
  pendingEditSelection: null,
  setPendingEditSelection: (pendingEditSelection) => set({ pendingEditSelection }),
  activeContextPath: null,
  setActiveContextPath: (activeContextPath) => set({ activeContextPath }),
  reloadDocSignal: 0,
  triggerReload: () => set((state) => ({ reloadDocSignal: state.reloadDocSignal + 1 })),
  workspaceDir: null,
  setWorkspaceDir: (workspaceDir) => set({ workspaceDir }),
  openedFiles: [],
  addFile: (file) =>
    set((state) => ({
      openedFiles: state.openedFiles.some((f) => f.path === file.path)
        ? state.openedFiles
        : [...state.openedFiles, { ...file, originalContent: file.content }],
    })),
  removeFile: (path) =>
    set((state) => ({
      openedFiles: state.openedFiles.filter((f) => f.path !== path),
    })),
  loadFileContent: (path, content) =>
    set((state) => ({
      openedFiles: state.openedFiles.map((f) =>
        f.path === path ? { ...f, content, originalContent: content } : f
      ),
    })),
  clearFiles: () => set({ openedFiles: [], workspaceDir: null, currentFilePath: null }),
  currentFilePath: null,
  setCurrentFilePath: (currentFilePath) => set({ currentFilePath }),
  updateFileContent: (path, content) =>
    set((state) => ({
      openedFiles: state.openedFiles.map((f) =>
        f.path === path ? { ...f, content } : f
      ),
    })),
  markFileClean: (path) =>
    set((state) => ({
      openedFiles: state.openedFiles.map((f) =>
        f.path === path ? { ...f, originalContent: f.content } : f
      ),
    })),
}))
