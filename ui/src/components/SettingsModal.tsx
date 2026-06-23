import { useState, useEffect } from 'react'
import { X, Plus, Trash2, CheckCircle, Play, Edit, Brain, ChevronRight, ChevronDown, Folder, FolderOpen, Pin, EyeOff, Eye } from 'lucide-react'
import { useSettingsStore } from '../stores/settingsStore'
import { useEditorStore } from '../stores/editorStore'
import type { AppSettings } from '../stores/settingsStore'
import { API_BASE } from '../lib/api'

interface SettingsModalProps {
  onClose: () => void
}

type ThemeFamily = NonNullable<AppSettings['theme_family']>
type ThemeMode = NonNullable<AppSettings['theme']>
type TextStyle = NonNullable<AppSettings['text_style']>

const themeFamilies: { id: ThemeFamily; name: string; description: string; swatches: string[] }[] = [
  {
    id: 'sand',
    name: 'Sand',
    description: 'Warm paper, soft tan, familiar and quiet.',
    swatches: ['#FFFFFF', '#F3EFEA', '#734F2D', '#346538']
  },
  {
    id: 'notion',
    name: 'Notion Mono',
    description: 'Crisp grayscale with a restrained ink accent.',
    swatches: ['#FFFFFF', '#F7F7F5', '#2F3437', '#2563EB']
  },
  {
    id: 'sage',
    name: 'Sage Desk',
    description: 'Gentle green-gray for long writing sessions.',
    swatches: ['#FBFCF8', '#EEF4EA', '#506C4A', '#2F6F59']
  },
  {
    id: 'blue',
    name: 'Blue Note',
    description: 'Pale steel, navy ink, calm focus-mode energy.',
    swatches: ['#FAFCFF', '#EEF4FA', '#243B53', '#2F6F9F']
  },
  {
    id: 'rose',
    name: 'Rose Glass',
    description: 'Soft blush surfaces with a mature plum accent.',
    swatches: ['#FFF9FA', '#F7ECEF', '#6E3B4D', '#8F4E68']
  }
]

const themeModes: { id: ThemeMode; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' }
]

const textStyles: { id: TextStyle; name: string; description: string; sample: string }[] = [
  {
    id: 'system',
    name: 'System',
    description: 'Neutral app-native text for everyday drafting.',
    sample: 'Clean notes'
  },
  {
    id: 'editorial',
    name: 'Editorial',
    description: 'Serif document text with a magazine-like rhythm.',
    sample: 'Longform draft'
  },
  {
    id: 'manuscript',
    name: 'Manuscript',
    description: 'Roomier serif text for chapter work and revision.',
    sample: 'Chapter page'
  },
  {
    id: 'technical',
    name: 'Technical',
    description: 'Sharper spacing and monospace-friendly code blocks.',
    sample: 'Spec notes'
  },
  {
    id: 'warm',
    name: 'Warm Sans',
    description: 'Softer humanist sans text without getting decorative.',
    sample: 'Soft focus'
  }
]

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { settings, updateSettings } = useSettingsStore()
  const [activeTab, setActiveTab] = useState<'general' | 'appearance' | 'context' | 'endpoints'>('general')
  const [availableFiles, setAvailableFiles] = useState<{ name: string; path: string }[]>([])

  useEffect(() => {
    fetch(`${API_BASE}/api/workspace/files`)
      .then(res => res.json())
      .then(data => setAvailableFiles(data))
      .catch(err => console.error(err))
  }, [])

  if (!settings) return null

  return (
    <div className="fixed inset-0 bg-black/15 dark:bg-black/45 backdrop-blur-[2px] z-[100] flex items-center justify-center p-4 font-sans">
      <div className="bg-[var(--bg)] border border-[var(--border-subtle)] w-full max-w-3xl rounded-[8px] shadow-none flex flex-col h-[600px] max-h-[85vh] overflow-hidden transform transition-all animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <h2 className="text-[15px] font-medium text-[var(--text-heading)]">Workspace Settings</h2>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-heading)] transition-colors cursor-pointer">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar Tabs */}
          <div className="w-[180px] border-r border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 flex flex-col gap-1">
            <TabButton active={activeTab === 'general'} onClick={() => setActiveTab('general')} label="General" />
            <TabButton active={activeTab === 'appearance'} onClick={() => setActiveTab('appearance')} label="Appearance" />
            <TabButton active={activeTab === 'context'} onClick={() => setActiveTab('context')} label="Context" />
            <TabButton active={activeTab === 'endpoints'} onClick={() => setActiveTab('endpoints')} label="Endpoints" />
          </div>

          {/* Content Area */}
          <div className="flex-1 p-8 overflow-y-auto bg-[var(--bg)] text-[var(--text)]">
            {activeTab === 'general' && <GeneralSettings settings={settings} updateSettings={updateSettings} />}
            {activeTab === 'appearance' && <AppearanceSettings settings={settings} updateSettings={updateSettings} />}
            {activeTab === 'context' && <ContextSettings settings={settings} updateSettings={updateSettings} availableFiles={availableFiles} />}
            {activeTab === 'endpoints' && <EndpointsSettings settings={settings} updateSettings={updateSettings} />}
          </div>
        </div>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, label }: { active: boolean, onClick: () => void, label: string }) {
  return (
    <button
      onClick={onClick}
      className={`text-left px-3 py-2 rounded-[6px] text-[13px] transition-colors cursor-pointer ${active
        ? 'bg-[var(--bg-hover)] text-[var(--text-heading)] font-medium'
        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]/50'
        }`}
    >
      {label}
    </button>
  )
}

function GeneralSettings({ settings, updateSettings }: { settings: AppSettings, updateSettings: (u: Partial<AppSettings>) => void }) {
  const [workspacePath, setWorkspacePath] = useState(settings.linked_workspace_dir || '')
  const [isPicking, setIsPicking] = useState(false)

  const handleLink = () => {
    updateSettings({ linked_workspace_dir: workspacePath.trim() || null })
  }

  const handleBrowse = async () => {
    setIsPicking(true)
    try {
      const res = await fetch(`${API_BASE}/api/workspace/pick-folder`)
      if (res.ok) {
        const data = await res.json()
        if (data.path) {
          setWorkspacePath(data.path)
          updateSettings({ linked_workspace_dir: data.path })
        }
      }
    } catch (err) {
      console.error('Failed to pick folder', err)
    } finally {
      setIsPicking(false)
    }
  }

  const handleClear = () => {
    setWorkspacePath('')
    updateSettings({ linked_workspace_dir: null })
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Workspace Directory</h3>
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">Link an absolute directory path on your system containing your novel project.</p>
        <div className="flex flex-col gap-2 max-w-xl">
          <div className="flex gap-2 w-full">
            <input
              type="text"
              placeholder="e.g. /Users/username/my-novel"
              value={workspacePath}
              onChange={(e) => setWorkspacePath(e.target.value)}
              className="flex-1 border border-[var(--border-subtle)] rounded-[6px] px-3 py-1.5 text-[13px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)] transition-colors min-w-0"
            />
            <button
              onClick={handleBrowse}
              disabled={isPicking}
              className="shrink-0 px-3 py-1.5 rounded-[6px] text-[12px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-heading)] hover:bg-[var(--bg-hover)] transition-colors font-medium cursor-pointer disabled:opacity-50"
            >
              {isPicking ? 'Browsing...' : 'Browse...'}
            </button>
            <button
              onClick={handleLink}
              className="shrink-0 px-3 py-1.5 rounded-[6px] text-[12px] bg-[var(--accent-brown)] text-[var(--text-inverse)] hover:bg-[var(--accent-brown)]/90 transition-colors font-medium cursor-pointer"
            >
              Link Path
            </button>
          </div>
          {settings.linked_workspace_dir && (
            <button
              onClick={handleClear}
              className="self-start text-[11px] text-[var(--text-secondary)] hover:text-red-500 transition-colors cursor-pointer"
            >
              Reset to default fallback workspace
            </button>
          )}
        </div>
        <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
          {settings.linked_workspace_dir 
            ? `Active Workspace: ${settings.linked_workspace_dir}` 
            : 'Using default sample workspace in the repository.'}
        </p>
      </section>

      <section>
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Default Mode</h3>
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">Choose the default interface mode for new sessions.</p>
        <div className="flex gap-2">
          {[
            { value: 'edit', label: 'Edit Document' },
            { value: 'chat', label: 'Conversational Chat' }
          ].map(modeOpt => (
            <button
              key={modeOpt.value}
              onClick={() => updateSettings({ default_mode: modeOpt.value })}
              className={`px-3 py-1.5 rounded-[4px] text-[12px] border transition-colors cursor-pointer ${settings.default_mode === modeOpt.value ? 'bg-[var(--accent-brown)] text-[var(--text-inverse)] border-[var(--accent-brown)] font-medium' : 'bg-[var(--bg)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--text-secondary)] hover:text-[var(--text-heading)]'}`}
            >
              {modeOpt.label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Default Verbosity</h3>
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">Control the target length of AI responses and edits.</p>
        <select
          value={settings.default_verbosity || 'balanced'}
          onChange={(e) => updateSettings({ default_verbosity: e.target.value })}
          className="border border-[var(--border-subtle)] rounded-[6px] px-3 py-2 text-[13px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)] transition-colors w-[200px]"
        >
          <option value="none">No Limit</option>
          <option value="concise">Concise (250 tokens)</option>
          <option value="balanced">Balanced (500 tokens)</option>
          <option value="expansive">Expansive (1000 tokens)</option>
        </select>
      </section>
    </div>
  )
}

function AppearanceSettings({ settings, updateSettings }: { settings: AppSettings, updateSettings: (u: Partial<AppSettings>) => void }) {
  const selectedFamily = settings.theme_family || 'sand'
  const selectedMode = settings.theme || 'light'
  const selectedTextStyle = settings.text_style || 'system'
  const selectedStats = settings.editor_stats || 'both'

  return (
    <div className="flex flex-col gap-8">
      {/* Category 1: Theme & Color Palette */}
      <div>
        <h3 className="text-[14px] font-medium text-[var(--text-heading)] tracking-tight border-b border-[var(--border-subtle)] pb-2 mb-4">Theme & Color Palette</h3>
        <div className="flex flex-col gap-6">
          <section>
            <h4 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Mode</h4>
            <p className="text-[12px] text-[var(--text-secondary)] mb-3">Choose the interface color mode.</p>
            <div className="inline-flex rounded-[7px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1">
              {themeModes.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => updateSettings({ theme: id })}
                  className={`flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-[12px] transition-colors cursor-pointer ${selectedMode === id
                    ? 'bg-[var(--accent-brown)] text-[var(--text-inverse)] font-medium'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-heading)]'
                    }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h4 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Theme</h4>
            <p className="text-[12px] text-[var(--text-secondary)] mb-3">Select a color palette for your workspace.</p>
            <div className="grid grid-cols-2 gap-3">
              {themeFamilies.map((themeFamily) => {
                const active = selectedFamily === themeFamily.id
                return (
                  <button
                    key={themeFamily.id}
                    onClick={() => updateSettings({ theme_family: themeFamily.id })}
                    className={`relative text-left rounded-[8px] border p-2.5 transition-colors cursor-pointer flex flex-col justify-between h-full ${active
                      ? 'border-[var(--accent-brown)] bg-[var(--bg-hover)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg)] hover:border-[var(--text-secondary)]'
                      }`}
                  >
                    <div className="flex items-start justify-between gap-3 w-full">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] font-medium text-[var(--text-heading)]">{themeFamily.name}</span>
                        </div>
                        <div className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-secondary)] min-h-[32px]">{themeFamily.description}</div>
                      </div>
                    </div>
                    <div className="mt-2.5 flex gap-1.5 w-full">
                      {themeFamily.swatches.map((swatch) => (
                        <span
                          key={swatch}
                          className="h-4 flex-1 rounded-[3px] border border-black/10"
                          style={{ backgroundColor: swatch }}
                        />
                      ))}
                    </div>
                  </button>
                )
              })}
            </div>
          </section>
        </div>
      </div>

      {/* Category 2: Typography */}
      <div>
        <h3 className="text-[14px] font-medium text-[var(--text-heading)] tracking-tight border-b border-[var(--border-subtle)] pb-2 mb-4">Typography</h3>
        <section>
          <h4 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Text Style</h4>
          <p className="text-[12px] text-[var(--text-secondary)] mb-3">Change the typography and spacing of the writing surface.</p>
          <div className="grid grid-cols-2 gap-3">
            {textStyles.map(({ id, name, description }) => {
              const active = selectedTextStyle === id
              return (
                <button
                  key={id}
                  onClick={() => updateSettings({ text_style: id })}
                  className={`text-left rounded-[8px] border p-2.5 transition-colors cursor-pointer flex flex-col justify-between h-full ${active
                    ? 'border-[var(--accent-brown)] bg-[var(--bg-hover)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg)] hover:border-[var(--text-secondary)]'
                    }`}
                >
                  <div className="flex items-start justify-between gap-3 w-full">
                    <div className={`min-w-0 theme-font-preview-${id}`}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-medium text-[var(--text-heading)]">{name}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-secondary)] min-h-[32px]">{description}</div>
                    </div>
                    <span className={`text-[15px] font-medium text-[var(--text-heading)] opacity-60 mt-0.5 shrink-0 theme-font-preview-${id}`}>
                      Aa
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      </div>

      {/* Category 3: Layout & Details */}
      <div>
        <h3 className="text-[14px] font-medium text-[var(--text-heading)] tracking-tight border-b border-[var(--border-subtle)] pb-2 mb-4">Layout & Details</h3>
        <div className="flex flex-col gap-6">
          <section>
            <h4 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Editor Statistics</h4>
            <p className="text-[12px] text-[var(--text-secondary)] mb-3">Display word and/or character counts in the editor.</p>
            <select
              value={selectedStats}
              onChange={(e) => updateSettings({ editor_stats: e.target.value as any })}
              className="border border-[var(--border-subtle)] rounded-[6px] px-3 py-2 text-[13px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)] transition-colors w-[200px]"
            >
              <option value="both">Words & Characters</option>
              <option value="words">Words Only</option>
              <option value="characters">Characters Only</option>
              <option value="none">None</option>
            </select>
          </section>
        </div>
      </div>
    </div>
  )
}

function ContextSettings({
  settings,
  updateSettings,
  availableFiles
}: {
  settings: AppSettings,
  updateSettings: (u: Partial<AppSettings>) => void,
  availableFiles: { name: string; path: string }[]
}) {
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({})

  // Group files by folder
  const groups: Record<string, typeof availableFiles> = {}
  availableFiles.forEach(file => {
    const parts = file.path.split('/')
    const folder = parts.length > 1 ? parts[0] : ''
    if (!groups[folder]) {
      groups[folder] = []
    }
    groups[folder].push(file)
  })

  // Sort folders alphabetically, with empty (root files) group last
  const sortedFolders = Object.keys(groups).sort((a, b) => {
    if (a === '') return 1
    if (b === '') return -1
    return a.localeCompare(b)
  })

  const toggleFolder = (folder: string) => {
    setCollapsedFolders(prev => ({
      ...prev,
      [folder]: !prev[folder]
    }))
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="border-b border-[var(--border-subtle)] pb-6">
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Session Memory</h3>
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">
          Configure how previous conversation history and edits are carried forward.
        </p>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[var(--text-secondary)] min-w-[130px]">Max History Depth:</span>
            <input
              type="number"
              min="1"
              max="10"
              value={settings.history_turns ?? 5}
              onChange={(e) => updateSettings({ history_turns: Math.max(1, Math.min(10, parseInt(e.target.value) || 1)) })}
              className="w-16 border border-[var(--border-subtle)] rounded-[6px] px-2 py-1 text-[13px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]"
            />
            <span className="text-[11px] text-[var(--text-muted)]">
              The maximum number of recent conversation turns to retain.
            </span>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Include Document Structure</h3>
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">
          Provide a structural outline (paragraph previews) of the active document to the AI planner. Helps the AI maintain broader story awareness, but consumes more memory. Keep off when using a smaller local AI for faster, more focused responses.
        </p>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!!settings.planner_include_outline}
            onChange={(e) => updateSettings({ planner_include_outline: e.target.checked })}
            className="accent-[var(--accent-brown)]"
          />
          <span className="text-[13px] text-[var(--text-secondary)] font-medium">Send Document Outline to AI</span>
        </label>
      </section>

      <section>
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Additional Context</h3>
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">Instructions prepended to the Chat and Writer agents.</p>
        <textarea
          value={settings.additional_context || ''}
          onChange={(e) => updateSettings({ additional_context: e.target.value })}
          className="w-full h-[120px] border border-[var(--border-subtle)] rounded-[6px] p-3 text-[13px] text-[var(--text)] bg-[var(--bg-input)] outline-none focus:border-[var(--text-secondary)] transition-colors resize-none font-sans leading-relaxed"
          placeholder="E.g., Always use British spelling. Never use passive voice."
        />
      </section>

      <section>
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Context & Reference Files</h3>
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">
          All workspace files are available for the planner to reference. <strong>Pin</strong> a file to always include it. <strong>Cross out</strong> a folder or file to prevent the AI from reading it.
        </p>
        <div className="border border-[var(--border-subtle)] rounded-[6px] max-h-[300px] overflow-y-auto p-2 flex flex-col gap-1.5">
          {availableFiles.length === 0 ? (
            <p className="text-[12px] text-[var(--text-secondary)] p-2 text-center">No files in workspace.</p>
          ) : (
            sortedFolders.map(folder => {
              const files = groups[folder]
              const isCollapsed = !!collapsedFolders[folder]
              const displayTitle = folder === '' ? 'Workspace Root' : `${folder}/`
              const manifestPath = folder ? `${folder}/${folder.toUpperCase()}.md` : ''
              const isBlocked = folder !== '' && (settings.ignored_ref_files || []).includes(manifestPath)

              const toggleBlock = (e: React.MouseEvent) => {
                e.stopPropagation()
                const current = settings.ignored_ref_files || []
                if (isBlocked) {
                  updateSettings({ ignored_ref_files: current.filter(p => p !== manifestPath) })
                } else {
                  updateSettings({ ignored_ref_files: [...current, manifestPath] })
                }
              }

              return (
                <div key={`group-${folder}`} className="flex flex-col gap-1">
                  {/* Collapsible Folder Row */}
                  <div
                    onClick={() => !isBlocked && toggleFolder(folder)}
                    className={`flex items-center gap-2 p-1.5 rounded-[4px] select-none transition-colors ${isBlocked ? 'opacity-60 cursor-default' : 'hover:bg-[var(--bg-hover)]/60 cursor-pointer'}`}
                  >
                    {isBlocked ? (
                      <ChevronRight size={14} className="text-[var(--text-muted)]" />
                    ) : isCollapsed ? (
                      <ChevronRight size={14} className="text-[var(--text-secondary)]" />
                    ) : (
                      <ChevronDown size={14} className="text-[var(--text-secondary)]" />
                    )}
                    {isBlocked ? (
                      <Folder size={14} className="text-red-400 shrink-0" />
                    ) : isCollapsed ? (
                      <Folder size={14} className="text-[var(--text-secondary)] shrink-0" />
                    ) : (
                      <FolderOpen size={14} className="text-[var(--text-secondary)] shrink-0" />
                    )}
                    <span className={`text-[11px] font-semibold uppercase tracking-wider ${isBlocked ? 'text-red-400 line-through' : 'text-[var(--text-heading)]'}`}>
                      {displayTitle}
                    </span>
                    {isBlocked ? (
                      <span className="text-[10px] text-red-400 font-normal ml-auto">Blocked</span>
                    ) : (
                      <span className="text-[10px] text-[var(--text-muted)] font-normal ml-auto bg-[var(--bg-hover)] px-1.5 py-0.5 rounded-[4px]">
                        {files.length} {files.length === 1 ? 'file' : 'files'}
                      </span>
                    )}
                    {folder !== '' && (
                      <button
                        onClick={toggleBlock}
                        className="p-1 rounded-[4px] transition-colors cursor-pointer shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                        title={isBlocked ? 'Unblock folder' : 'Block folder'}
                      >
                        {isBlocked ? <EyeOff size={13} className="text-red-400" /> : <Eye size={13} />}
                      </button>
                    )}
                  </div>

                  {/* Indented Files List */}
                  {!isCollapsed && !isBlocked && (
                    <div className="pl-4 border-l border-[var(--border-subtle)]/40 ml-3.5 my-0.5 flex flex-col gap-1">
                      {files.filter(file => file.name !== `${folder.toUpperCase()}.md`).map(file => {
                        const isPinned = (settings.pinned_ref_files || []).includes(file.path)
                        const isIgnored = (settings.ignored_ref_files || []).includes(file.path)

                        const cycleState = (e: React.MouseEvent) => {
                          e.stopPropagation()
                          if (!isPinned && !isIgnored) {
                            updateSettings({
                              pinned_ref_files: [...(settings.pinned_ref_files || []), file.path],
                              ignored_ref_files: (settings.ignored_ref_files || []).filter(p => p !== file.path),
                            })
                          } else if (isPinned) {
                            updateSettings({
                              pinned_ref_files: (settings.pinned_ref_files || []).filter(p => p !== file.path),
                              ignored_ref_files: [...(settings.ignored_ref_files || []), file.path],
                            })
                          } else {
                            updateSettings({
                              ignored_ref_files: (settings.ignored_ref_files || []).filter(p => p !== file.path),
                            })
                          }
                        }

                        const stateColor = isPinned
                          ? 'text-[var(--accent-brown)]'
                          : isIgnored
                            ? 'text-red-400'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'

                        const stateTitle = isPinned
                          ? 'Always included in context (click to block)'
                          : isIgnored
                            ? 'Blocked from AI (click to restore default)'
                            : 'Available to planner (click to pin)'

                        return (
                          <div
                            key={file.path}
                            className="flex items-center gap-2 p-1 px-2 hover:bg-[var(--bg-hover)]/40 rounded-[4px] group"
                          >
                            <span
                              className={`text-[12.5px] min-w-0 truncate flex-1 ${
                                isPinned
                                  ? 'text-[var(--accent-brown)] font-semibold'
                                  : isIgnored
                                    ? 'line-through text-[var(--text-muted)] opacity-50'
                                    : 'text-[var(--text)]'
                              }`}
                            >
                              {file.name}
                            </span>
                            {folder !== '' && file.path !== `${folder}/${file.name}` && (
                              <span className="text-[10px] text-[var(--text-muted)] hidden group-hover:inline truncate max-w-[200px] font-mono">
                                {file.path}
                              </span>
                            )}
                            <button
                              onClick={cycleState}
                              className={`p-1 rounded-[4px] transition-all cursor-pointer shrink-0 ${stateColor}`}
                              title={stateTitle}
                            >
                              {isPinned ? (
                                <Pin size={13} />
                              ) : isIgnored ? (
                                <EyeOff size={13} />
                              ) : (
                                <Eye size={13} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                              )}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </section>
    </div>
  )
}

function AddCustomTagForm({ onAdd }: { onAdd: (open: string, close: string) => void }) {
  const [openTag, setOpenTag] = useState('')
  const [closeTag, setCloseTag] = useState('')

  const handleAddTag = () => {
    const o = openTag.trim()
    const c = closeTag.trim()
    if (o && c) {
      onAdd(o, c)
      setOpenTag('')
      setCloseTag('')
    }
  }

  return (
    <div className="flex gap-2 items-center mt-1 w-full">
      <input
        placeholder="<think>"
        value={openTag}
        onChange={(e) => setOpenTag(e.target.value)}
        className="flex-1 min-w-0 border border-[var(--border-subtle)] rounded-[4px] px-2.5 py-1 text-[11px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)] font-mono"
      />
      <input
        placeholder="</think>"
        value={closeTag}
        onChange={(e) => setCloseTag(e.target.value)}
        className="flex-1 min-w-0 border border-[var(--border-subtle)] rounded-[4px] px-2.5 py-1 text-[11px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)] font-mono"
      />
      <button
        type="button"
        onClick={handleAddTag}
        disabled={!openTag.trim() || !closeTag.trim()}
        className="px-2.5 py-1 text-[11px] bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[4px] hover:border-[var(--text-secondary)] text-[var(--text-heading)] font-medium transition-colors disabled:opacity-50 cursor-pointer shrink-0"
      >
        Add
      </button>
    </div>
  )
}

function EndpointsSettings({ settings, updateSettings }: { settings: AppSettings, updateSettings: (u: Partial<AppSettings>) => void }) {
  const [newId, setNewId] = useState('')
  const [newUrl, setNewUrl] = useState('http://localhost:1234')
  const [newKey, setNewKey] = useState('')
  const [newModel, setNewModel] = useState('')
  const [newContext, setNewContext] = useState('8192')
  const [newIsThinking, setNewIsThinking] = useState(true)
  const [newCustomTags, setNewCustomTags] = useState<{ open: string; close: string }[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ status: 'idle' | 'testing' | 'success' | 'error', msg?: string }>({ status: 'idle' })

  const handleAdd = () => {
    if (!newId || !newUrl) return
    const id = newId.trim().toLowerCase().replace(/\s+/g, '_')
    let updatedEndpoints = {
      ...settings.endpoints,
      [id]: {
        url: newUrl,
        api_key: newKey,
        model: newModel,
        context_window: parseInt(newContext) || undefined,
        is_thinking: newIsThinking,
        custom_thinking_tags: newCustomTags
      }
    }
    if (editingId && editingId !== id) {
      delete updatedEndpoints[editingId]
    }
    updateSettings({
      endpoints: updatedEndpoints,
      active_endpoint: settings.active_endpoint === editingId ? id : settings.active_endpoint
    })
    setEditingId(null)
    setNewId('')
    setNewUrl('http://localhost:1234')
    setNewKey('')
    setNewModel('')
    setNewContext('8192')
    setNewIsThinking(true)
    setNewCustomTags([])
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setNewId('')
    setNewUrl('http://localhost:1234')
    setNewKey('')
    setNewModel('')
    setNewContext('8192')
    setNewIsThinking(true)
    setNewCustomTags([])
  }

  const handleTest = async (url: string, key: string) => {
    setTestResult({ status: 'testing' })
    try {
      const res = await fetch(`${API_BASE}/api/settings/test-endpoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, api_key: key })
      })
      if (!res.ok) throw new Error('Connection failed')
      const data = await res.json()
      setTestResult({ status: 'success', msg: `Found ${data.models?.data?.length || 0} models.` })
      
      if (data.models?.data?.length > 0) {
        const firstModel = data.models.data[0].id
        setNewModel(firstModel)
        useEditorStore.getState().setActiveModel(firstModel)
      }
    } catch (e) {
      setTestResult({ status: 'error', msg: (e as Error).message })
    }
    setTimeout(() => setTestResult({ status: 'idle' }), 4000)
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Active Endpoint</h3>
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">Select the LLM routing endpoint. If none, falls back to .env defaults.</p>

        <div className="flex flex-col gap-2">
          <div className={`flex flex-col border border-[var(--border-subtle)] rounded-[6px] transition-colors ${settings.active_endpoint === null ? 'border-[var(--text-secondary)] bg-[var(--bg-hover)]' : ''}`}>
            <label className="flex items-center gap-3 p-3 cursor-pointer hover:bg-[var(--bg-hover)]/30 transition-colors">
              <input
                type="radio"
                name="active_endpoint"
                checked={settings.active_endpoint === null}
                onChange={() => updateSettings({ active_endpoint: null })}
                className="accent-[var(--accent-brown)]"
              />
              <div className="flex-1 flex flex-col min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-[var(--text-heading)]">.env Default (Local)</span>
                  {settings.is_thinking !== false && (
                    <span title="Thinking Filter Enabled">
                      <Brain size={14} className="text-[var(--text-secondary)] shrink-0" />
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-[var(--text-secondary)] truncate">Fallback configuration</span>
              </div>
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => handleTest("default", "")} className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-heading)] bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[4px] cursor-pointer" title="Test Connection">
                  <Play size={14} />
                </button>
              </div>
            </label>
            <div className="px-3 pb-3 pt-1.5 border-t border-[var(--border-subtle)]/30 flex items-center justify-between gap-4">
              <div className="flex flex-col">
                <span className="text-[12px] font-medium text-[var(--text-secondary)]">Thinking Model</span>
                <span className="text-[10px] text-[var(--text-muted)]">Filters reasoning/thinking blocks dynamically.</span>
              </div>
              <input
                type="checkbox"
                checked={settings.is_thinking !== false}
                onChange={(e) => updateSettings({ is_thinking: e.target.checked })}
                className="accent-[var(--accent-brown)] cursor-pointer w-4 h-4"
              />
            </div>
          </div>

          {Object.entries(settings.endpoints || {}).map(([id, ep]) => (
            <div key={id} className={`flex flex-col border rounded-[6px] transition-colors ${settings.active_endpoint === id ? 'border-[var(--text-secondary)] bg-[var(--bg-hover)]' : 'border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'}`}>
              <div className="flex items-center justify-between p-3">
                <label className="flex items-center gap-3 cursor-pointer flex-1">
                  <input
                    type="radio"
                    name="active_endpoint"
                    checked={settings.active_endpoint === id}
                    onChange={() => updateSettings({ active_endpoint: id })}
                    className="accent-[var(--accent-brown)]"
                  />
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-[var(--text-heading)] capitalize truncate">{id.replace('_', ' ')}</span>
                      {ep.is_thinking !== false && (
                        <span title="Thinking Filter Enabled">
                          <Brain size={14} className="text-[var(--text-secondary)] shrink-0" />
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-[var(--text-secondary)] truncate">
                      {ep.url} {ep.model ? `• ${ep.model}` : ''} {ep.context_window ? `• ${ep.context_window.toLocaleString()} ctx` : ''}
                      {ep.custom_thinking_tags && ep.custom_thinking_tags.length > 0 && ` • +${ep.custom_thinking_tags.length} custom`}
                    </span>
                  </div>
                </label>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleTest(ep.url, ep.api_key)} className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-heading)] bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[4px] cursor-pointer" title="Test Connection">
                    <Play size={14} />
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(id)
                      setNewId(id)
                      setNewUrl(ep.url)
                      setNewKey(ep.api_key || '')
                      setNewModel(ep.model || '')
                      setNewContext(ep.context_window ? String(ep.context_window) : '8192')
                      setNewIsThinking(ep.is_thinking !== false)
                      setNewCustomTags(ep.custom_thinking_tags || [])
                    }}
                    className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-heading)] bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[4px] cursor-pointer" title="Edit Endpoint"
                  >
                    <Edit size={14} />
                  </button>
                  <button
                    onClick={() => {
                      const newEps = { ...settings.endpoints }
                      delete newEps[id]
                      updateSettings({ endpoints: newEps, active_endpoint: settings.active_endpoint === id ? null : settings.active_endpoint })
                      if (editingId === id) handleCancelEdit()
                    }}
                    className="p-1.5 text-[var(--text-secondary)] hover:text-red-500 bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[4px] cursor-pointer" title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-[var(--bg-elevated)] p-4 rounded-[8px] border border-[var(--border-subtle)]">
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-3">
          {editingId ? `Edit Endpoint: ${editingId.replace('_', ' ')}` : 'Add New Endpoint'}
        </h3>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <input placeholder="Name (e.g. OpenAI)" value={newId} onChange={e => setNewId(e.target.value)} className="border border-[var(--border-subtle)] rounded-[4px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]" />
          <input placeholder="Base URL" value={newUrl} onChange={e => setNewUrl(e.target.value)} className="border border-[var(--border-subtle)] rounded-[4px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]" />
          <input placeholder="API Key (Optional)" type="password" value={newKey} onChange={e => setNewKey(e.target.value)} className="border border-[var(--border-subtle)] rounded-[4px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]" />
          <div className="flex gap-2 min-w-0">
            <input placeholder="Model Name (Optional)" value={newModel} onChange={e => setNewModel(e.target.value)} className="flex-1 min-w-0 border border-[var(--border-subtle)] rounded-[4px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]" />
            <input placeholder="Ctx (e.g. 8192)" type="number" value={newContext} onChange={e => setNewContext(e.target.value)} className="w-[90px] border border-[var(--border-subtle)] rounded-[4px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)] shrink-0" />
          </div>
        </div>

        <div className="flex flex-col gap-4 border-t border-[var(--border-subtle)]/50 pt-3 mt-3 mb-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col">
              <span className="text-[12px] font-medium text-[var(--text-heading)]">Thinking Model</span>
              <span className="text-[10.5px] text-[var(--text-secondary)]">Enable dynamic filtering of thinking/reasoning blocks.</span>
            </div>
            <input
              type="checkbox"
              checked={newIsThinking}
              onChange={(e) => setNewIsThinking(e.target.checked)}
              className="accent-[var(--accent-brown)] cursor-pointer w-4 h-4"
            />
          </div>

          {newIsThinking && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col">
                <span className="text-[12px] font-medium text-[var(--text-heading)]">Custom Thinking Tags</span>
                <span className="text-[10.5px] text-[var(--text-secondary)]">Add tag pairs to filter out. Default tags are supported automatically.</span>
              </div>
              
              {newCustomTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {newCustomTags.map((tag, idx) => (
                    <span key={idx} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[4px] text-[var(--text-heading)] font-mono">
                      <span>{tag.open}</span>
                      <span className="text-[var(--text-muted)]">➔</span>
                      <span>{tag.close}</span>
                      <button
                        type="button"
                        onClick={() => setNewCustomTags(newCustomTags.filter((_, i) => i !== idx))}
                        className="text-[var(--text-muted)] hover:text-red-500 transition-colors ml-1 font-sans font-bold cursor-pointer"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <AddCustomTagForm
                onAdd={(open, close) => {
                  setNewCustomTags([...newCustomTags, { open, close }])
                }}
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border-subtle)]/50 pt-3">
          <div className="flex items-center gap-2">
            <button onClick={() => handleTest(newUrl, newKey)} disabled={!newUrl || testResult.status === 'testing'} className="px-3 py-1.5 text-[12px] bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[4px] hover:border-[var(--text-secondary)] transition-colors disabled:opacity-50 cursor-pointer text-[var(--text)]">
              {testResult.status === 'testing' ? 'Testing...' : 'Test Connection'}
            </button>
            {testResult.status === 'success' && <span className="text-[11px] text-[var(--text-accent)] flex items-center gap-1"><CheckCircle size={12} /> {testResult.msg}</span>}
            {testResult.status === 'error' && <span className="text-[11px] text-red-500 flex items-center gap-1"><X size={12} /> {testResult.msg}</span>}
          </div>
          <div className="flex gap-2">
            {editingId && (
              <button onClick={handleCancelEdit} className="px-3 py-1.5 text-[12px] bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[4px] hover:border-[var(--text-secondary)] transition-colors cursor-pointer text-[var(--text)]">
                Cancel
              </button>
            )}
            <button onClick={handleAdd} disabled={!newId || !newUrl} className="px-3 py-1.5 text-[12px] bg-[var(--accent-brown)] text-[var(--text-inverse)] rounded-[4px] hover:bg-[var(--accent-brown-hover)] transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1">
              {editingId ? 'Update Endpoint' : <><Plus size={14} /> Save Endpoint</>}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
