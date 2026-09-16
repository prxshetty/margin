import { create } from 'zustand'
import { Editor } from '@tiptap/react'

export interface FileEntry {
  name: string
  path: string
  content: string
  originalContent: string
}

export type FileGitStatus = 'clean' | 'unstaged_modified' | 'staged' | 'staged_modified'

export interface AiPendingEdit {
  filePath?: string
  previousContent: string
  editorContent?: string
  selectionRange?: { from: number; to: number } | null
  highlightFrom?: number
  harness?: string
  aiContent?: string
  aiChangedIdx?: number[]
  originalSelectedText?: string
  replacementText?: string
}

function getStoredCurrentFilePath(): string | null {
  try {
    return localStorage.getItem('margin-current-file-path')
  } catch {
    return null
  }
}

function getStoredAiPendingEdit(): AiPendingEdit | null {
  try {
    const raw = localStorage.getItem('margin-pending-edit')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
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
  isProgrammaticSelection: boolean
  setIsProgrammaticSelection: (isProgrammaticSelection: boolean) => void
  diffBaseContent: string | null
  setDiffBaseContent: (content: string | null) => void
  isGitWorkspace: boolean
  setIsGitWorkspace: (isGit: boolean) => void
  hasDiffChanges: boolean
  setHasDiffChanges: (hasChanges: boolean) => void
  fileStatusMap: Record<string, FileGitStatus>
  setFileStatusMap: (map: Record<string, FileGitStatus>) => void
  documentShowAdditions: boolean
  setDocumentShowAdditions: (show: boolean) => void
  documentShowDeletions: boolean
  setDocumentShowDeletions: (show: boolean) => void
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
  aiPendingEdit: AiPendingEdit | null
  setAiPendingEdit: (edit: AiPendingEdit | null) => void
  activeModel: string | null
  setActiveModel: (model: string | null) => void
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
  isProgrammaticSelection: false,
  setIsProgrammaticSelection: (isProgrammaticSelection) => set({ isProgrammaticSelection }),
  diffBaseContent: null,
  setDiffBaseContent: (diffBaseContent) => set({ diffBaseContent }),
  isGitWorkspace: false,
  setIsGitWorkspace: (isGitWorkspace) => set({ isGitWorkspace }),
  hasDiffChanges: false,
  setHasDiffChanges: (hasDiffChanges) => set({ hasDiffChanges }),
  fileStatusMap: {},
  setFileStatusMap: (fileStatusMap) => set({ fileStatusMap }),
  documentShowAdditions: true,
  setDocumentShowAdditions: (documentShowAdditions) => set({ documentShowAdditions }),
  documentShowDeletions: true,
  setDocumentShowDeletions: (documentShowDeletions) => set({ documentShowDeletions }),
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
  clearFiles: () =>
    set({
      openedFiles: [],
      workspaceDir: null,
    }),
  currentFilePath: getStoredCurrentFilePath(),
  setCurrentFilePath: (currentFilePath) => {
    try {
      if (currentFilePath) {
        localStorage.setItem('margin-current-file-path', currentFilePath)
      } else {
        localStorage.removeItem('margin-current-file-path')
      }
    } catch { /* ignore */ }
    set({ currentFilePath })
  },
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
  aiPendingEdit: getStoredAiPendingEdit(),
  setAiPendingEdit: (aiPendingEdit) => {
    try {
      if (aiPendingEdit) {
        localStorage.setItem('margin-pending-edit', JSON.stringify(aiPendingEdit))
      } else {
        localStorage.removeItem('margin-pending-edit')
      }
    } catch { /* ignore */ }
    set({ aiPendingEdit })
  },
  activeModel: null,
  setActiveModel: (activeModel) => set({ activeModel }),
}))
