import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Save, PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen, FolderOpen } from 'lucide-react'
import { NovelEditor } from '../components/Editor/NovelEditor'
import { SimpleAssist } from '../components/SimpleAssist'
import { FileSidebar } from '../components/FileSidebar'
import { useEditorStore } from '../stores/editorStore'

interface SaveFilePickerOptions {
  suggestedName: string
  types: { description: string; accept: Record<string, string[]> }[]
}

interface FileSystemFileHandle {
  createWritable: () => Promise<FileSystemWritableFileStream>
}

interface FileSystemWritableFileStream extends WritableStream {
  write: (data: Blob) => Promise<void>
  close: () => Promise<void>
}

const PANEL_MIN_WIDTH = 260
const PANEL_MAX_WIDTH = 600
const PANEL_DEFAULT_WIDTH = 320

function getStoredWidth(key: string, fallback: number): number {
  try {
    const stored = localStorage.getItem(key)
    if (stored) {
      const w = parseInt(stored, 10)
      if (w >= PANEL_MIN_WIDTH && w <= PANEL_MAX_WIDTH) return w
    }
  } catch {}
  return fallback
}
export default function SimpleEditor() {
  const navigate = useNavigate()
  const setContent = useEditorStore(state => state.setContent)
  const { addFile, clearFiles, setWorkspaceDir, setCurrentFilePath, markFileClean, currentFilePath } = useEditorStore()
  const [panelOpen, setPanelOpen] = useState(true)
  const [panelWidth, setPanelWidth] = useState(() => getStoredWidth('simple-assist-panel-width', PANEL_DEFAULT_WIDTH))
  const draggingRef = useRef(false)

  const [filesPanelOpen, setFilesPanelOpen] = useState(true)
  const [filesPanelWidth, setFilesPanelWidth] = useState(() => getStoredWidth('simple-files-panel-width', PANEL_DEFAULT_WIDTH))
  const filesDraggingRef = useRef(false)

  const dirHandleRef = useRef<any>(null)

  const openedFiles = useEditorStore((s) => s.openedFiles)
  const editorContent = useEditorStore((s) => s.content)
  const activeFile = openedFiles.find((f) => f.path === currentFilePath)
  const isDirty = !!(activeFile && editorContent !== activeFile.originalContent)

  const handleOpenFolder = async () => {
    if (!('showDirectoryPicker' in window)) return
    try {
      const dirHandle = await (window as any).showDirectoryPicker()
      dirHandleRef.current = dirHandle
      setWorkspaceDir(dirHandle.name)
      clearFiles()
      const entries: { name: string; path: string }[] = []
      await scanDir(dirHandle, '', entries)
      entries.sort((a, b) => a.path.localeCompare(b.path))
      for (const entry of entries) {
        const content = await readFile(dirHandle, entry.path)
        addFile({ name: entry.name, path: entry.path, content, tagged: false, originalContent: content })
      }
      if (entries.length > 0) {
        const first = await readFile(dirHandle, entries[0].path)
        setContent(first)
        setCurrentFilePath(entries[0].path)
      }
    } catch {
      // user cancelled or error
    }
  }

  async function scanDir(
    handle: FileSystemDirectoryHandle,
    basePath: string,
    results: { name: string; path: string }[]
  ) {
    for await (const entry of handle.values()) {
      const path = basePath ? `${basePath}/${entry.name}` : entry.name
      if (entry.kind === 'directory') {
        await scanDir(await handle.getDirectoryHandle(entry.name), path, results)
      } else if (
        entry.name.endsWith('.md') ||
        entry.name.endsWith('.markdown') ||
        entry.name.endsWith('.txt')
      ) {
        results.push({ name: entry.name, path })
      }
    }
  }

  async function readFile(handle: FileSystemDirectoryHandle, filePath: string): Promise<string> {
    const parts = filePath.split('/')
    let h: FileSystemDirectoryHandle | FileSystemFileHandle = handle
    for (let i = 0; i < parts.length - 1; i++) {
      h = await (h as FileSystemDirectoryHandle).getDirectoryHandle(parts[i])
    }
    const f = await (h as FileSystemDirectoryHandle).getFileHandle(parts[parts.length - 1])
    return await (await f.getFile()).text()
  }

  const handleSave = async () => {
    if (!dirHandleRef.current || !currentFilePath) return
    try {
      const fileContent = useEditorStore.getState().content
      const parts = currentFilePath.split('/')
      let h: any = dirHandleRef.current
      for (let i = 0; i < parts.length - 1; i++) {
        h = await h.getDirectoryHandle(parts[i])
      }
      const fileHandle = await h.getFileHandle(parts[parts.length - 1])
      const writable = await fileHandle.createWritable()
      await writable.write(new Blob([fileContent], { type: 'text/markdown' }))
      await writable.close()
      markFileClean(currentFilePath)
    } catch {
      // save failed
    }
  }

  const handleSaveAs = async () => {
    const content = useEditorStore.getState().content
    const blob = new Blob([content], { type: 'text/markdown' })

    if ('showSaveFilePicker' in window) {
      try {
        const w = window as Window & typeof globalThis & { showSaveFilePicker: (opts: SaveFilePickerOptions) => Promise<FileSystemFileHandle> }
        const handle = await w.showSaveFilePicker({
          suggestedName: 'draft.md',
          types: [{
            description: 'Markdown',
            accept: { 'text/markdown': ['.md'] },
          }],
        })
        const writable = await handle.createWritable()
        await writable.write(blob)
        await writable.close()
        return
      } catch {
        // eslint-disable-next-line no-empty
      }
    }

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'draft.md'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Drag-to-resize handlers for right panel
  const widthRef = useRef(panelWidth)

  useEffect(() => {
    widthRef.current = panelWidth
  }, [panelWidth])

  const handleRightMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (draggingRef.current) {
        const newWidth = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, window.innerWidth - e.clientX))
        setPanelWidth(newWidth)
      }
      if (filesDraggingRef.current) {
        const newWidth = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, e.clientX))
        setFilesPanelWidth(newWidth)
      }
    }
    const handleMouseUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false
        localStorage.setItem('simple-assist-panel-width', String(widthRef.current))
      }
      if (filesDraggingRef.current) {
        filesDraggingRef.current = false
        localStorage.setItem('simple-files-panel-width', String(filesPanelWidth))
      }
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [filesPanelWidth])

  const handleLeftMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    filesDraggingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Top Bar */}
      <div className="h-12 border-b border-slate-200 bg-white px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/')}
            className="flex items-center justify-center w-8 h-8 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg border border-transparent hover:border-slate-200 transition-all cursor-pointer"
            title="Home"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </button>
          <button
            onClick={() => setFilesPanelOpen(!filesPanelOpen)}
            className="flex items-center justify-center w-8 h-8 text-slate-400 hover:text-slate-600 bg-white border border-slate-200 hover:border-slate-300 rounded-lg transition-all cursor-pointer"
            title={filesPanelOpen ? 'Hide files panel' : 'Show files panel'}
          >
            {filesPanelOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
          </button>
          <button
            onClick={handleOpenFolder}
            className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-slate-600 hover:text-slate-800 bg-white border border-slate-200 hover:border-slate-300 rounded-lg transition-all cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5" strokeWidth={1.5} />
            Open Folder
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setPanelOpen(!panelOpen)}
            className="flex items-center justify-center w-8 h-8 text-slate-400 hover:text-slate-600 bg-white border border-slate-200 hover:border-slate-300 rounded-lg transition-all cursor-pointer"
            title={panelOpen ? 'Hide AI panel' : 'Show AI panel'}
          >
            {panelOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
          </button>
          {isDirty && (
            <button
              onClick={handleSave}
              className="flex items-center gap-1 h-8 px-3 text-xs font-medium text-white bg-[#346538] hover:bg-[#2a522e] border border-transparent rounded-lg transition-all cursor-pointer"
              title="Save current file"
            >
              <Save className="w-3.5 h-3.5" strokeWidth={2} />
              Save
            </button>
          )}
          <button
            onClick={handleSaveAs}
            className="flex items-center justify-center w-8 h-8 text-slate-400 hover:text-slate-600 bg-transparent border border-slate-200 hover:border-slate-300 rounded-lg transition-all cursor-pointer"
            title="Save As"
          >
            <Save className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main area */}
      <div className="flex flex-1 min-h-0">
        {filesPanelOpen && (
          <div className="flex shrink-0" style={{ width: filesPanelWidth }}>
            <div className="flex-1 border-r border-slate-200 bg-[#FAF9F6] p-4 overflow-y-auto min-w-0">
              <FileSidebar />
            </div>
            <div
              className="w-1.5 shrink-0 cursor-col-resize bg-transparent hover:bg-indigo-200 active:bg-indigo-300 transition-colors flex items-center justify-center group"
              onMouseDown={handleLeftMouseDown}
            >
              <div className="w-0.5 h-8 rounded-full bg-slate-300 group-hover:bg-indigo-400 transition-colors" />
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          <NovelEditor showInlinePopup={false} />
        </div>
        {panelOpen && (
          <div className="flex shrink-0" style={{ width: panelWidth }}>
            <div
              className="w-1.5 shrink-0 cursor-col-resize bg-transparent hover:bg-indigo-200 active:bg-indigo-300 transition-colors flex items-center justify-center group"
              onMouseDown={handleRightMouseDown}
            >
              <div className="w-0.5 h-8 rounded-full bg-slate-300 group-hover:bg-indigo-400 transition-colors" />
            </div>
            <div className="flex-1 border-l border-slate-200 bg-[#FAF9F6] p-4 overflow-y-auto min-w-0">
              <SimpleAssist />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

