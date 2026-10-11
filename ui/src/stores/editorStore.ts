import { create } from 'zustand'
import { Editor } from '@tiptap/react'
import {
  type ManifestValidationResult,
  isManifestPath,
  validateManifestText,
} from '../lib/manifestValidator'

export type FileStatus =
  | 'clean'
  | 'staged'
  | 'unstaged_modified'
  | 'staged_modified'
  | 'untracked'
  | 'staged_renamed'
  | 'staged_renamed_modified'
  | 'staged_deleted'
  | 'unstaged_deleted'

export interface ApiFileItem {
  name: string
  path: string
  description?: string
  content?: string
  originalContent?: string
  deleted?: boolean
  tracked?: boolean
  manifest_issues?: {
    is_valid: boolean
    invalid_lines: number[]
    total_count: number
    has_more: boolean
  }
}

export interface FileEntry {
  name: string
  path: string
  content: string
  originalContent: string
  deleted?: boolean
  tracked?: boolean
  manifest_issues?: {
    is_valid: boolean
    invalid_lines: number[]
    total_count: number
    has_more: boolean
  }
}

interface EditorState {
  content: string
  setContent: (content: string) => void
  manifestIssuesMap: Record<string, ManifestValidationResult>
  setManifestIssues: (path: string, issues: ManifestValidationResult | null) => void
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
  setOpenedFiles: (files: FileEntry[]) => void
  addFile: (file: FileEntry) => void
  removeFile: (path: string) => void
  loadFileContent: (path: string, content: string) => void
  clearFiles: () => void
  switchWorkspace: (dir: string | null) => void
  currentFilePath: string | null
  setCurrentFilePath: (path: string | null) => void
  updateFileContent: (path: string, content: string) => void
  markFileClean: (path: string) => void
  fileStatusMap: Record<string, FileStatus>
  setFileStatusMap: (map: Record<string, FileStatus>) => void
  updateFileStatus: (path: string, status: FileStatus) => void
  setFileStatus: (path: string, status: FileStatus) => void
  isGitWorkspace: boolean
  setIsGitWorkspace: (isGitWorkspace: boolean) => void
  diffBaseContent: string | null
  setDiffBaseContent: (diffBaseContent: string | null) => void
  hasCommittedVersion: boolean
  setHasCommittedVersion: (hasCommittedVersion: boolean) => void
  aiPendingEdit: { previousContent: string; selectionRange?: { from: number; to: number } | null; highlightFrom?: number; harness?: string; aiContent?: string; aiChangedIdx?: number[] } | null
  setAiPendingEdit: (edit: { previousContent: string; selectionRange?: { from: number; to: number } | null; highlightFrom?: number; harness?: string; aiContent?: string; aiChangedIdx?: number[] } | null) => void
  activeModel: string | null
  setActiveModel: (model: string | null) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  content: '',
  setContent: (content) => set({ content }),
  manifestIssuesMap: {},
  setManifestIssues: (path, issues) =>
    set((state) => {
      const next = { ...state.manifestIssuesMap }
      if (!issues || issues.isValid) {
        delete next[path]
      } else {
        next[path] = issues
      }
      return { manifestIssuesMap: next }
    }),
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
  setOpenedFiles: (openedFiles) =>
    set((state) => {
      const nextMap = { ...state.manifestIssuesMap }
      for (const file of openedFiles) {
        if (isManifestPath(file.path)) {
          if (file.manifest_issues) {
            if (file.manifest_issues.is_valid) {
              delete nextMap[file.path]
            } else {
              nextMap[file.path] = {
                isValid: file.manifest_issues.is_valid,
                invalidLines: file.manifest_issues.invalid_lines,
                totalCount: file.manifest_issues.total_count,
                hasMore: file.manifest_issues.has_more,
              }
            }
          } else if (file.content) {
            const issues = validateManifestText(file.content)
            if (issues.isValid) {
              delete nextMap[file.path]
            } else {
              nextMap[file.path] = issues
            }
          }
        }
      }
      return { openedFiles, manifestIssuesMap: nextMap }
    }),
  addFile: (file) =>
    set((state) => {
      const nextMap = { ...state.manifestIssuesMap }
      if (isManifestPath(file.path)) {
        if (file.manifest_issues) {
          if (file.manifest_issues.is_valid) {
            delete nextMap[file.path]
          } else {
            nextMap[file.path] = {
              isValid: file.manifest_issues.is_valid,
              invalidLines: file.manifest_issues.invalid_lines,
              totalCount: file.manifest_issues.total_count,
              hasMore: file.manifest_issues.has_more,
            }
          }
        } else if (file.content) {
          const issues = validateManifestText(file.content)
          if (issues.isValid) {
            delete nextMap[file.path]
          } else {
            nextMap[file.path] = issues
          }
        }
      }
      return {
        manifestIssuesMap: nextMap,
        openedFiles: state.openedFiles.some((f) => f.path === file.path)
          ? state.openedFiles.map((f) =>
              f.path === file.path
                ? {
                    ...f,
                    ...(file.tracked !== undefined ? { tracked: file.tracked } : {}),
                    ...(file.deleted !== undefined ? { deleted: file.deleted } : {}),
                  }
                : f
            )
          : [...state.openedFiles, { ...file, originalContent: file.content }],
      }
    }),
  removeFile: (path) =>
    set((state) => {
      const nextMap = { ...state.manifestIssuesMap }
      delete nextMap[path]
      return {
        manifestIssuesMap: nextMap,
        openedFiles: state.openedFiles.filter((f) => f.path !== path),
      }
    }),
  loadFileContent: (path, content) =>
    set((state) => {
      const nextMap = { ...state.manifestIssuesMap }
      if (isManifestPath(path)) {
        const issues = validateManifestText(content)
        if (issues.isValid) {
          delete nextMap[path]
        } else {
          nextMap[path] = issues
        }
      }
      return {
        manifestIssuesMap: nextMap,
        openedFiles: state.openedFiles.map((f) =>
          f.path === path ? { ...f, content, originalContent: content } : f
        ),
      }
    }),
  clearFiles: () =>
    set({
      openedFiles: [],
      workspaceDir: null,
      currentFilePath: null,
      content: '',
      selectedText: '',
      selectionRange: null,
      anchorPosition: 0,
      aiAssistPreload: null,
      pendingEditSelection: null,
      aiPendingEdit: null,
      fileStatusMap: {},
      manifestIssuesMap: {},
      diffBaseContent: null,
      hasCommittedVersion: false,
      isGitWorkspace: false,
    }),
  switchWorkspace: (workspaceDir) =>
    set({
      openedFiles: [],
      workspaceDir,
      fileStatusMap: {},
      manifestIssuesMap: {},
      diffBaseContent: null,
      hasCommittedVersion: false,
      isGitWorkspace: false,
    }),
  currentFilePath: null,
  setCurrentFilePath: (currentFilePath) =>
    set({
      currentFilePath,
      diffBaseContent: null,
      hasCommittedVersion: false,
    }),
  updateFileContent: (path, content) =>
    set((state) => {
      const nextMap = { ...state.manifestIssuesMap }
      if (isManifestPath(path)) {
        const issues = validateManifestText(content)
        if (issues.isValid) {
          delete nextMap[path]
        } else {
          nextMap[path] = issues
        }
      }
      return {
        manifestIssuesMap: nextMap,
        openedFiles: state.openedFiles.map((f) =>
          f.path === path ? { ...f, content } : f
        ),
      }
    }),
  markFileClean: (path) =>
    set((state) => ({
      openedFiles: state.openedFiles.map((f) => {
        if (f.path !== path) return f
        const activeContent = state.currentFilePath === path ? state.content : f.content
        return { ...f, content: activeContent, originalContent: activeContent }
      }),
    })),
  fileStatusMap: {},
  setFileStatusMap: (fileStatusMap) => set({ fileStatusMap }),
  updateFileStatus: (path, status) =>
    set((state) => ({
      fileStatusMap: { ...state.fileStatusMap, [path]: status },
    })),
  setFileStatus: (path, status) =>
    set((state) => ({
      fileStatusMap: { ...state.fileStatusMap, [path]: status },
    })),
  isGitWorkspace: false,
  setIsGitWorkspace: (isGitWorkspace) => set({ isGitWorkspace }),
  diffBaseContent: null,
  setDiffBaseContent: (diffBaseContent) => set({ diffBaseContent }),
  hasCommittedVersion: false,
  setHasCommittedVersion: (hasCommittedVersion) => set({ hasCommittedVersion }),
  aiPendingEdit: null,
  setAiPendingEdit: (aiPendingEdit) => set({ aiPendingEdit }),
  activeModel: null,
  setActiveModel: (activeModel) => set({ activeModel }),
}))
