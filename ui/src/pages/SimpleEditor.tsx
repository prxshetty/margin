import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Save, ArrowLeft, Sparkles } from 'lucide-react'
import { NovelEditor } from '../components/Editor/NovelEditor'
import { SimpleAssist } from '../components/SimpleAssist'
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

export default function SimpleEditor() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const setContent = useEditorStore(state => state.setContent)

  const handleOpenFile = () => {
    fileInputRef.current?.click()
  }

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result
      if (typeof text === 'string') {
        setContent(text)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
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
        // User cancelled or API unavailable — fall through to download
      }
    }

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'draft.md'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Top Bar */}
      <div className="h-12 border-b border-slate-200 bg-white px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
            title="Back to landing"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            onClick={handleOpenFile}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" />
            Open File
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.txt"
            onChange={handleFileSelected}
            className="hidden"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
            <Sparkles className="w-3 h-3" />
            Quick Write
          </span>
        </div>

        <button
          onClick={handleSaveAs}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-sm cursor-pointer"
        >
          <Save className="w-3.5 h-3.5" />
          Save As
        </button>
      </div>

      {/* Main area */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto">
          <NovelEditor showInlinePopup={false} />
        </div>
        <div className="w-80 border-l border-slate-200 bg-white p-4 overflow-y-auto shrink-0">
          <SimpleAssist />
        </div>
      </div>
    </div>
  )
}
