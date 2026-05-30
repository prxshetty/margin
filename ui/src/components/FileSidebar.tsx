import { useState, useEffect, useRef, useCallback } from 'react'
import { FolderOpen, FileText, Check, X, Loader } from 'lucide-react'
import { useEditorStore, type FileEntry } from '../stores/editorStore'
import { API_BASE } from '../lib/api'

function FileIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 2.5A1.5 1.5 0 0 1 4.5 1h5.086a1 1 0 0 1 .707.293l2.914 2.914A1 1 0 0 1 13.5 5v8A1.5 1.5 0 0 1 12 14.5H4.5A1.5 1.5 0 0 1 3 13V2.5Z" fill="currentColor" fillOpacity=".15" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
      <path d="M9.5 1v3a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
    </svg>
  )
}

export function FileSidebar() {
  const {
    workspaceDir, setWorkspaceDir,
    openedFiles, addFile, removeFile, toggleFileTag,
    setContent,
  } = useEditorStore()

  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const initialLoadDone = useRef(false)

  // Auto-fetch from backend only on first mount if no files are already in store
  useEffect(() => {
    if (initialLoadDone.current) return
    if (openedFiles.length > 0 || workspaceDir) {
      setLoading(false)
      initialLoadDone.current = true
      return
    }
    initialLoadDone.current = true
    setLoading(true)
    fetch(`${API_BASE}/api/workspace/inputs/files`)
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then(async (files: { name: string; path: string }[]) => {
        if (files.length === 0) return
        setWorkspaceDir('inputs')
        for (const file of files) {
          try {
            const res = await fetch(`${API_BASE}/api/workspace/inputs/files/${encodeURIComponent(file.path)}`)
            if (!res.ok) continue
            const data = await res.json()
            addFile({ name: file.name, path: file.path, content: data.content, tagged: false, originalContent: data.content })
          } catch {
            // skip
          }
        }
      })
      .catch(() => {
        // backend unreachable — stay in empty state
      })
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const setCurrentFilePath = useEditorStore((s) => s.setCurrentFilePath)
  const updateFileContent = useEditorStore((s) => s.updateFileContent)

  const handleFileClick = useCallback((path: string) => {
    const store = useEditorStore.getState()
    const { currentFilePath, content } = store
    if (currentFilePath) {
      updateFileContent(currentFilePath, content)
    }
    const file = openedFiles.find((f) => f.path === path)
    if (file) {
      setContent(file.content)
      setCurrentFilePath(path)
    }
  }, [openedFiles, setContent, setCurrentFilePath, updateFileContent])

  const rootFiles = openedFiles.filter((f) => !f.path.includes('/'))
  const charFiles = openedFiles.filter((f) => f.path.startsWith('characters/'))
  const styleFiles = openedFiles.filter((f) => f.path.startsWith('styles/'))
  const chapterFiles = openedFiles.filter((f) => f.path.startsWith('chapters/'))

  return (
    <div ref={containerRef} className="flex flex-col gap-3 w-full h-full overflow-y-auto select-none">
      {/* Workspace header */}
      {workspaceDir && !loading && (
        <div className="flex items-center gap-1.5 text-[11px] text-[#787774] font-medium truncate font-sans px-1">
          <FolderOpen className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
          <span className="truncate">{workspaceDir}</span>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-[#787774]">
          <Loader className="w-4 h-4 animate-spin" strokeWidth={2} />
          <span>Loading files...</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && !workspaceDir && openedFiles.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-center select-none flex-1">
          <FileText className="w-8 h-8 text-[#D0D0CD] mb-3" strokeWidth={1} />
          <p className="text-[11px] text-[#787774] font-medium">No folder opened</p>
          <p className="text-[10px] text-[#A0A09D] mt-1 max-w-[180px]">
            Open a folder to browse and tag reference files
          </p>
        </div>
      )}

      {/* No files found */}
      {!loading && workspaceDir && openedFiles.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-center select-none flex-1">
          <p className="text-[11px] text-[#787774] font-medium">No markdown files found</p>
          <p className="text-[10px] text-[#A0A09D] mt-1 max-w-[200px]">
            The workspace contains no .md files
          </p>
        </div>
      )}

      {/* File list */}
      {!loading && (
        <div className="flex flex-col gap-3">
          {rootFiles.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {rootFiles.map((file) => (
                <FileRow key={file.path} file={file} onSelect={handleFileClick} onToggleTag={toggleFileTag} onRemove={removeFile} />
              ))}
            </div>
          )}

          {chapterFiles.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#787774] mb-1 px-1 select-none">chapters/</p>
              {chapterFiles.map((file) => (
                <FileRow key={file.path} file={file} onSelect={handleFileClick} onToggleTag={toggleFileTag} onRemove={removeFile} />
              ))}
            </div>
          )}

          {charFiles.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#787774] mb-1 px-1 select-none">characters/</p>
              {charFiles.map((file) => (
                <FileRow key={file.path} file={file} onSelect={handleFileClick} onToggleTag={toggleFileTag} onRemove={removeFile} />
              ))}
            </div>
          )}

          {styleFiles.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#787774] mb-1 px-1 select-none">styles/</p>
              {styleFiles.map((file) => (
                <FileRow key={file.path} file={file} onSelect={handleFileClick} onToggleTag={toggleFileTag} onRemove={removeFile} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FileRow({
  file,
  onSelect,
  onToggleTag,
  onRemove,
}: {
  file: FileEntry
  onSelect: (path: string) => void
  onToggleTag: (path: string) => void
  onRemove: (path: string) => void
}) {
  const activePath = useEditorStore((s) => {
    const f = s.openedFiles.find((f) => f.content === s.content)
    return f?.path
  })
  const isActive = activePath === file.path

  return (
    <div
      className={`group flex items-center gap-1 px-2 py-1.5 rounded-[6px] text-xs transition-colors ${
        isActive
          ? 'bg-[#EDF3EC] text-[#2F3437]'
          : 'text-[#787774] hover:bg-[#F5F4F0]'
      }`}
    >
      <button
        onClick={() => onSelect(file.path)}
        className="flex items-center gap-1.5 flex-1 min-w-0 text-left cursor-pointer"
        title={file.path}
      >
        <FileIcon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[#346538]' : 'text-[#A0A09D]'}`} />
        <span className="truncate">{file.name}</span>
      </button>

      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleTag(file.path)
          }}
          className={`p-1 rounded-[4px] transition-colors cursor-pointer ${
            file.tagged
              ? 'text-[#346538] bg-[#EDF3EC]'
              : 'text-[#A0A09D] hover:text-[#787774] hover:bg-[#F1F0EC]'
          }`}
          title={file.tagged ? 'Remove from AI context' : 'Add to AI context'}
        >
          {file.tagged ? (
            <Check className="w-3 h-3" strokeWidth={2.5} />
          ) : (
            <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.5"/>
            </svg>
          )}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove(file.path)
          }}
          className="p-1 rounded-[4px] text-[#A0A09D] hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
          title="Remove file"
        >
          <X className="w-3 h-3" strokeWidth={2} />
        </button>
      </div>

      <div className="flex items-center gap-0.5 shrink-0 group-hover:hidden">
        {file.tagged && (
          <span className="w-1.5 h-1.5 rounded-full bg-[#346538]" title="Tagged as context" />
        )}
      </div>
    </div>
  )
}
