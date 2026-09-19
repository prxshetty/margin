import { useState, useEffect, useRef } from 'react'
import { X, Plus, Trash2, CheckCircle, Play, Edit, Brain, ChevronRight, ChevronDown, Folder, FolderOpen, Pin, EyeOff, Eye, Pencil, RotateCcw } from 'lucide-react'
import { useSettingsStore } from '../stores/settingsStore'
import { toast } from '../stores/toastStore'
import { useEditorStore } from '../stores/editorStore'
import type { AppSettings } from '../stores/settingsStore'
import { API_BASE } from '../lib/api'
import { HarnessIcon } from './HarnessIcon'

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
  const [activeTab, setActiveTab] = useState<'general' | 'appearance' | 'context' | 'endpoints' | 'harnesses' | 'images'>('general')
  const [availableFiles, setAvailableFiles] = useState<{ name: string; path: string }[]>([])

  useEffect(() => {
    fetch(`${API_BASE}/api/workspace/files`)
      .then(res => res.json())
      .then(data => setAvailableFiles(data))
      .catch(err => {
        console.error(err)
        toast.error('Could not list workspace files for context pinning.')
      })
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
            <TabButton active={activeTab === 'images'} onClick={() => setActiveTab('images')} label="Images" />
            <TabButton active={activeTab === 'context'} onClick={() => setActiveTab('context')} label="Context" />
            <TabButton active={activeTab === 'endpoints'} onClick={() => setActiveTab('endpoints')} label="Endpoints" />
            <TabButton active={activeTab === 'harnesses'} onClick={() => setActiveTab('harnesses')} label="Harness" />
          </div>

          {/* Content Area */}
          <div className="flex-1 p-8 overflow-y-auto bg-[var(--bg)] text-[var(--text)]">
            {activeTab === 'general' && <GeneralSettings settings={settings} updateSettings={updateSettings} />}
            {activeTab === 'appearance' && <AppearanceSettings settings={settings} updateSettings={updateSettings} />}
            {activeTab === 'images' && <ImagesSettings settings={settings} updateSettings={updateSettings} />}
            {activeTab === 'context' && <ContextSettings settings={settings} updateSettings={updateSettings} availableFiles={availableFiles} />}
            {activeTab === 'endpoints' && <EndpointsSettings settings={settings} updateSettings={updateSettings} />}
            {activeTab === 'harnesses' && <HarnessesSettings settings={settings} updateSettings={updateSettings} />}
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
      toast.error('Could not open the folder picker.')
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
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">Control the target length of endpoint responses and edits. Endpoints only — harnesses manage their own output length.</p>
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
  const harnessActive = (settings.default_harness || 'none') !== 'none'

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
        <PromptsSettings />
      </section>

      <section className="border-b border-[var(--border-subtle)] pb-6">
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Session Memory</h3>
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">
          How much past history travels with each endpoint request — prior chat turns and recent edits. Harnesses keep their own conversation per session and continue it automatically, so this setting doesn't apply to them.
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
      <p className="text-[11px] text-[var(--text-muted)] leading-relaxed -mt-4">
        Endpoint models only — agent harnesses read your workspace files directly.
      </p>

      <section>
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Include Document Structure</h3>
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">
          Provide a structural outline (paragraph previews) of the active document to the endpoint planner. Helps the AI maintain broader story awareness, but consumes more memory. Keep off when using a smaller local AI for faster, more focused responses.
          {harnessActive && ' Disabled while a harness is the default — harnesses read the workspace directly.'}
        </p>
        <label className={`flex items-center gap-2 select-none ${harnessActive ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
          <input
            type="checkbox"
            checked={!!settings.planner_include_outline}
            disabled={harnessActive}
            onChange={(e) => updateSettings({ planner_include_outline: e.target.checked })}
            className="accent-[var(--accent-brown)]"
          />
          <span className="text-[13px] text-[var(--text-secondary)] font-medium">Send Document Outline to AI</span>
        </label>
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

function HarnessesSettings({ settings, updateSettings }: { settings: AppSettings, updateSettings: (u: Partial<AppSettings>) => void }) {
  const [discovered, setDiscovered] = useState<{ id: string; name: string; installed: boolean; version: string | null }[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetch(`${API_BASE}/api/harnesses`)
      .then(res => res.ok ? res.json() : { harnesses: [] })
      .then(data => setDiscovered(data.harnesses || []))
      .catch(err => console.error(err))
      .finally(() => setIsLoading(false))
  }, [])

  const selected = settings.default_harness || 'none'

  const setExecutable = (id: string, executable: string) => {
    updateSettings({ harnesses: { ...(settings.harnesses || {}), [id]: { ...(settings.harnesses?.[id] || {}), executable } } })
  }

  const setModel = (id: string, model: string) => {
    updateSettings({ harnesses: { ...(settings.harnesses || {}), [id]: { ...(settings.harnesses?.[id] || {}), model } } })
  }

  const setContextWindow = (id: string, context_window: number | undefined) => {
    updateSettings({ harnesses: { ...(settings.harnesses || {}), [id]: { ...(settings.harnesses?.[id] || {}), context_window } } })
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Default Harness</h3>
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">
          External agent runtimes (Claude Code, Codex, ...) run locally with your own subscription.
          Select None to use the configured endpoint instead. Authenticate each CLI in your own terminal.
        </p>

        <div className="flex flex-col gap-2">
          <label className={`flex items-center gap-3 p-3 cursor-pointer border rounded-[6px] transition-colors ${selected === 'none' ? 'border-[var(--text-secondary)] bg-[var(--bg-hover)]' : 'border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'}`}>
            <input
              type="radio"
              name="default_harness"
              checked={selected === 'none'}
              onChange={() => updateSettings({ default_harness: 'none' })}
              className="accent-[var(--accent-brown)]"
            />
            <div className="flex flex-col min-w-0">
              <span className="text-[13px] font-medium text-[var(--text-heading)]">None — use endpoint</span>
              <span className="text-[11px] text-[var(--text-secondary)]">Default. No local agent involved.</span>
            </div>
          </label>

          {isLoading && (
            <p className="text-[12px] text-[var(--text-muted)] p-2">Detecting installed harnesses...</p>
          )}

          {discovered.map(h => (
            <div key={h.id} className={`flex flex-col border rounded-[6px] transition-colors ${selected === h.id ? 'border-[var(--text-secondary)] bg-[var(--bg-hover)]' : 'border-[var(--border-subtle)]'}`}>
              <label className="flex items-center gap-3 p-3 cursor-pointer">
                <input
                  type="radio"
                  name="default_harness"
                  checked={selected === h.id}
                  onChange={() => updateSettings({ default_harness: h.id })}
                  className="accent-[var(--accent-brown)]"
                />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-[13px] font-medium text-[var(--text-heading)] flex items-center gap-2">
                    <HarnessIcon id={h.id} className="w-4 h-4" />
                    {h.name}
                  </span>
                  <span className="text-[11px] text-[var(--text-secondary)]">
                    {h.installed ? '✓ Ready' : '✕ Not installed — install and authenticate its CLI, then reopen Settings'}
                  </span>
                </div>
              </label>
              <div className="px-3 pb-3 flex items-center gap-2">
                <span className="text-[11px] text-[var(--text-muted)] shrink-0">Custom executable:</span>
                <input
                  type="text"
                  placeholder={`e.g. /opt/homebrew/bin/${h.id}`}
                  value={(settings.harnesses?.[h.id]?.executable) || ''}
                  onChange={(e) => setExecutable(h.id, e.target.value)}
                  className="flex-1 min-w-0 border border-[var(--border-subtle)] rounded-[4px] px-2.5 py-1 text-[11px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)] font-mono"
                />
              </div>
              <div className="px-3 pb-3 flex items-center gap-2">
                <span className="text-[11px] text-[var(--text-muted)] shrink-0">Default model:</span>
                <HarnessModelPicker
                  key={`${h.id}:${settings.harnesses?.[h.id]?.executable || ''}`}
                  harnessId={h.id}
                  value={settings.harnesses?.[h.id]?.model || ''}
                  onChange={(model) => setModel(h.id, model)}
                />
                <span className="text-[11px] text-[var(--text-muted)] shrink-0" title="Context window for the usage ring. Empty = hidden.">Ctx:</span>
                <input
                  type="number"
                  placeholder="—"
                  value={settings.harnesses?.[h.id]?.context_window ?? ''}
                  onChange={(e) => setContextWindow(h.id, parseInt(e.target.value) || undefined)}
                  className="w-[76px] border border-[var(--border-subtle)] rounded-[4px] px-2.5 py-1 text-[11px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)] font-mono shrink-0"
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function HarnessModelPicker({ harnessId, value, onChange }: { harnessId: string; value: string; onChange: (model: string) => void }) {
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [manual, setManual] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [customMode, setCustomMode] = useState(false)

  useEffect(() => {
    fetch(`${API_BASE}/api/harnesses/${harnessId}/models`)
      .then(res => res.ok ? res.json() : { models: [], manual: true })
      .then(data => {
        setModels(data.models || [])
        setManual(data.manual !== false || (data.models || []).length === 0)
        if (value && !(data.models || []).some((m: { id: string }) => m.id === value)) {
          setCustomMode(true)
        }
      })
      .catch(err => console.error(err))
      .finally(() => setIsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [harnessId])

  if (isLoading) {
    return <span className="text-[11px] text-[var(--text-muted)]">Loading models...</span>
  }

  if (manual || models.length === 0 || customMode) {
    return (
      <input
        type="text"
        placeholder="e.g. anthropic/claude-sonnet-4-5 (empty = harness default)"
        value={customMode ? value : (manual || models.length === 0 ? value : '')}
        onChange={(e) => { setCustomMode(true); onChange(e.target.value) }}
        className="flex-1 min-w-0 border border-[var(--border-subtle)] rounded-[4px] px-2.5 py-1 text-[11px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)] font-mono"
      />
    )
  }

  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value === '__custom__') {
          setCustomMode(true)
        } else {
          onChange(e.target.value)
        }
      }}
      className="flex-1 min-w-0 border border-[var(--border-subtle)] rounded-[4px] px-2.5 py-1 text-[11px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)] font-mono"
    >
      <option value="">Harness default</option>
      {models.map(m => (
        <option key={m.id} value={m.id} title={m.name}>
          {m.id}{m.name !== m.id ? ` — ${m.name}` : ''}
        </option>
      ))}
      <option value="__custom__">Custom...</option>
    </select>
  )
}

const IMAGE_PROVIDERS = [
  { id: 'openai-compatible', label: 'OpenAI-compatible' },
  { id: 'stability', label: 'Stability' },
  { id: 'fal', label: 'FAL' },
  { id: 'gemini', label: 'Gemini (Google)' },
  { id: 'comfyui', label: 'ComfyUI (local)' },
] as const

interface ComfyCandidate {
  nodeId: string
  classType: string
  input: string
  preview: string
  kind: string
  score: number
}

const IMAGE_BUILTIN_STYLES = ['None', 'Cinematic', 'Illustration']

type ComfySlot = 'text' | 'edit'

function ComfySlotSection({
  slot, settings, updateSettings,
}: {
  slot: ComfySlot
  settings: AppSettings
  updateSettings: (u: Partial<AppSettings>) => void
}) {
  const wfKey = slot === 'text' ? 'image_comfy_text_workflow' : 'image_comfy_edit_workflow'
  const promptKey = slot === 'text' ? 'image_comfy_text_prompt_map' : 'image_comfy_edit_prompt_map'
  const seedKey = slot === 'text' ? 'image_comfy_text_seed_map' : 'image_comfy_edit_seed_map'
  const [candidates, setCandidates] = useState<ComfyCandidate[] | null>(null)
  const [imageCandidates, setImageCandidates] = useState<ComfyCandidate[] | null>(null)
  const [seedCandidates, setSeedCandidates] = useState<ComfyCandidate[] | null>(null)
  const [nodeCount, setNodeCount] = useState<number | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const savedWorkflow = settings[wfKey] as Record<string, { class_type?: string; inputs?: Record<string, unknown> }> | null | undefined
  const savedMap = settings[promptKey]
  const savedImageMap = slot === 'edit' ? settings.image_comfy_edit_image_map : undefined
  const savedSeedMap = settings[seedKey]
  const savedNodeCount = savedWorkflow ? Object.keys(savedWorkflow).length : 0
  const picked = savedMap ? `${savedMap.nodeId}:${savedMap.input}` : ''
  const pickedImage = savedImageMap ? `${savedImageMap.nodeId}:${savedImageMap.input}` : ''
  const pickedSeed = savedSeedMap ? `${savedSeedMap.nodeId}:${savedSeedMap.input}` : ''

  // Non-blocking warning: a LoadImage node in the text slot means plain
  // Imagine will hit ComfyUI validation on the stale default file.
  const hasLoader =
    (candidates || []).some((c) => c.classType === 'LoadImage') ||
    (imageCandidates || []).some((c) => c.classType === 'LoadImage') ||
    (savedWorkflow ? Object.values(savedWorkflow).some((n) => n?.class_type === 'LoadImage') : false)

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setImportError(null)
    try {
      const text = await file.text()
      let workflow: unknown
      try {
        workflow = JSON.parse(text)
      } catch {
        throw new Error('That file is not valid JSON — export your workflow as API format from ComfyUI.')
      }
      const res = await fetch(`${API_BASE}/api/images/comfy/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow }),
      })
      if (!res.ok) {
        let detail = 'Workflow rejected'
        try {
          const data = await res.json()
          if (data?.detail) detail = data.detail
        } catch { /* ignore */ }
        throw new Error(detail)
      }
      const data = await res.json()
      // Import validated: persist workflow, clear this slot's mappings until
      // the user confirms the inputs below.
      updateSettings({
        [wfKey]: workflow,
        [promptKey]: null,
        [seedKey]: null,
        ...(slot === 'edit' ? { image_comfy_edit_image_map: null } : {}),
      } as Partial<AppSettings>)
      setCandidates(data.candidates || [])
      setImageCandidates(data.image_candidates || [])
      setSeedCandidates(data.seed_candidates || [])
      setNodeCount(data.node_count ?? null)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handlePick = (value: string) => {
    if (!value) return
    const cand = (candidates || []).find((c) => `${c.nodeId}:${c.input}` === value)
    if (!cand) return
    updateSettings({ [promptKey]: { nodeId: cand.nodeId, input: cand.input } } as Partial<AppSettings>)
  }

  const handlePickImage = (value: string) => {
    if (!value) return
    const cand = (imageCandidates || []).find((c) => `${c.nodeId}:${c.input}` === value)
    if (!cand) return
    updateSettings({ image_comfy_edit_image_map: { nodeId: cand.nodeId, input: cand.input } })
  }

  const handlePickSeed = (value: string) => {
    if (!value) {
      updateSettings({ [seedKey]: null } as Partial<AppSettings>)
      return
    }
    const cand = (seedCandidates || []).find((c) => `${c.nodeId}:${c.input}` === value)
    if (!cand) return
    updateSettings({ [seedKey]: { nodeId: cand.nodeId, input: cand.input } } as Partial<AppSettings>)
  }

  const handleClear = () => {
    updateSettings({
      [wfKey]: null,
      [promptKey]: null,
      [seedKey]: null,
      ...(slot === 'edit' ? { image_comfy_edit_image_map: null } : {}),
    } as Partial<AppSettings>)
    setCandidates(null)
    setImageCandidates(null)
    setSeedCandidates(null)
    setNodeCount(null)
    setImportError(null)
  }

  // Candidates for the dropdown: freshly analyzed first, otherwise rebuild
  // labels from the saved workflow + mapping (enough to display the pick).
  const options: { value: string; label: string }[] =
    (candidates || []).map((c) => ({
      value: `${c.nodeId}:${c.input}`,
      label: `Node ${c.nodeId} — ${c.classType} — ${c.input}${c.preview ? ` (“${c.preview}”)` : ''}`,
    }))
  if (options.length === 0 && savedMap) {
    options.push({
      value: `${savedMap.nodeId}:${savedMap.input}`,
      label: `Node ${savedMap.nodeId} — ${savedMap.input}`,
    })
  }

  const refOptions: { value: string; label: string }[] =
    (imageCandidates || []).map((c) => ({
      value: `${c.nodeId}:${c.input}`,
      label: `Node ${c.nodeId} — ${c.classType} — ${c.input}${c.preview ? ` (“${c.preview}”)` : ''}`,
    }))
  if (refOptions.length === 0 && savedImageMap) {
    refOptions.push({
      value: `${savedImageMap.nodeId}:${savedImageMap.input}`,
      label: `Node ${savedImageMap.nodeId} — ${savedImageMap.input}`,
    })
  }

  const seedOptions: { value: string; label: string }[] =
    (seedCandidates || []).map((c) => ({
      value: `${c.nodeId}:${c.input}`,
      label: `Node ${c.nodeId} — ${c.classType} — ${c.input}${c.preview ? ` (“${c.preview}”)` : ''}`,
    }))
  if (seedOptions.length === 0 && savedSeedMap) {
    seedOptions.push({
      value: `${savedSeedMap.nodeId}:${savedSeedMap.input}`,
      label: `Node ${savedSeedMap.nodeId} — ${savedSeedMap.input}`,
    })
  }

  const title = slot === 'text' ? 'Text-to-image workflow' : 'Image edit workflow'
  const blurb = slot === 'text'
    ? 'Used by Imagine — Margin fills in the prompt input you map.'
    : 'Used by Imagine again — Margin uploads the existing image and fills in both inputs.'

  return (
    <div className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-medium text-[var(--text-heading)]">{title}</div>
        {savedWorkflow && (
          <span className="text-[10.5px] text-[var(--text-muted)] shrink-0">{savedNodeCount} nodes</span>
        )}
      </div>
      <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
        {blurb} Import as <strong>API format</strong> (not graph format) —
        Margin never edits your workflow and uses the first returned image.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="px-3 py-1.5 text-[12px] bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[6px] hover:border-[var(--text-secondary)] transition-colors disabled:opacity-50 cursor-pointer text-[var(--text)]"
        >
          {busy ? 'Analyzing…' : savedWorkflow ? 'Re-import workflow…' : 'Import workflow.json…'}
        </button>
        {savedWorkflow && (
          <button onClick={handleClear} className="px-2 py-1 text-[11px] text-[var(--text-muted)] hover:text-red-500 transition-colors cursor-pointer">
            Clear
          </button>
        )}
      </div>
      {importError && <p className="text-[11px] text-red-500 mt-2">{importError}</p>}
      {(options.length > 0 || nodeCount != null) && (
        <ComfyMappingField
          label={`Prompt input${nodeCount != null ? ` · ${nodeCount} nodes` : ''}`}
          tag="required"
          value={picked}
          placeholder="Pick the positive-prompt input…"
          options={options}
          hint="Ranked by likelihood — confirm the right one for your workflow."
          onPick={handlePick}
        />
      )}
      {slot === 'text' && hasLoader && (options.length > 0 || nodeCount != null) && (
        <p className="text-[11px] text-amber-600 mt-1">
          This workflow contains an image loader — plain Imagine may fail
          validation on its default file. Prefer a text-only workflow here,
          or use the edit slot below for image inputs.
        </p>
      )}
      {slot === 'edit' && (refOptions.length > 0 || nodeCount != null) && (
        <ComfyMappingField
          label="Reference image input"
          tag="required"
          value={pickedImage}
          placeholder="Pick the LoadImage input…"
          options={refOptions}
          hint="Margin uploads the existing image automatically — nothing to upload by hand."
          onPick={handlePickImage}
        />
      )}
      {(seedOptions.length > 0 || nodeCount != null) && (
        <ComfyMappingField
          label="Seed input"
          tag="optional"
          value={pickedSeed}
          placeholder="No seed mapping (reuse saved value)"
          options={seedOptions}
          hint="Randomized every run — your saved value is never changed."
          onPick={handlePickSeed}
        />
      )}
    </div>
  )
}

function ComfyMappingField({ label, tag, value, placeholder, options, hint, onPick }: {
  label: string
  tag?: 'required' | 'optional'
  value: string
  placeholder: string
  options: { value: string; label: string }[]
  hint?: string
  onPick: (value: string) => void
}) {
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <label className="text-[12px] font-medium text-[var(--text-secondary)]">{label}</label>
        {tag && (
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] shrink-0">{tag}</span>
        )}
      </div>
      <select
        value={value}
        onChange={(e) => onPick(e.target.value)}
        className="w-full border border-[var(--border-subtle)] rounded-[6px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {hint && (
        <p className="text-[10.5px] text-[var(--text-muted)] mt-1">{hint}</p>
      )}
    </div>
  )
}

function ImagesSettings({ settings, updateSettings }: { settings: AppSettings, updateSettings: (u: Partial<AppSettings>) => void }) {  const [testResult, setTestResult] = useState<{ status: 'idle' | 'testing' | 'success' | 'error', msg?: string }>({ status: 'idle' })
  const [newName, setNewName] = useState('')
  const [newPrompt, setNewPrompt] = useState('')
  const [builtinPrompts, setBuiltinPrompts] = useState<Record<string, string | null> | null>(null)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editingPrompt, setEditingPrompt] = useState('')
  const customs = settings.image_custom_styles || []
  const defaultStyle = settings.image_default_style ?? 'None'
  const deletedStyles = settings.image_deleted_styles || []
  const isComfy = (settings.image_provider || 'openai-compatible') === 'comfyui'

  const handleDeleteStyle = (name: string, builtin: boolean) => {
    const updates: Partial<AppSettings> = {}
    if (builtin) {
      // None can never be deleted; built-ins hide (restorable below) and
      // drop any override so a restore returns the shipped text.
      if (name === 'None' || deletedStyles.some((n) => n.toLowerCase() === name.toLowerCase())) return
      updates.image_deleted_styles = [...deletedStyles, name]
      if (settings.image_style_overrides?.[name] !== undefined) {
        const next = { ...settings.image_style_overrides }
        delete next[name]
        updates.image_style_overrides = next
      }
    } else {
      updates.image_custom_styles = customs.filter((x) => x.name !== name)
    }
    if (defaultStyle === name) updates.image_default_style = null
    updateSettings(updates)
  }

  // Shipped prompt text for built-ins (customized overrides come from settings).
  useEffect(() => {
    fetch(`${API_BASE}/api/images/styles`)
      .then((res) => (res.ok ? res.json() : { styles: [] }))
      .then((data) => {
        const map: Record<string, string | null> = {}
        for (const s of data.styles || []) {
          if (s?.builtin) map[s.name] = s.default_prompt ?? s.prompt ?? null
        }
        setBuiltinPrompts(map)
      })
      .catch(() => setBuiltinPrompts({}))
  }, [])
  const isGemini = (settings.image_provider || 'openai-compatible') === 'gemini'

  const handleTest = async () => {
    setTestResult({ status: 'testing' })
    try {
      const res = await fetch(`${API_BASE}/api/settings/test-image-provider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        let detail = 'Test failed'
        try {
          const data = await res.json()
          if (data?.detail) detail = data.detail
        } catch { /* ignore */ }
        throw new Error(detail)
      }
      setTestResult({ status: 'success', msg: 'Provider reachable.' })
    } catch (e) {
      setTestResult({ status: 'error', msg: (e as Error).message })
    }
    setTimeout(() => setTestResult({ status: 'idle' }), 5000)
  }

  const allStyleNames = [
    ...IMAGE_BUILTIN_STYLES.filter((n) => !deletedStyles.some((d) => d.toLowerCase() === n.toLowerCase())),
    ...customs.map((c) => c.name),
  ]
  const deletedBuiltins = IMAGE_BUILTIN_STYLES.filter(
    (n) => n !== 'None' && deletedStyles.some((d) => d.toLowerCase() === n.toLowerCase()),
  )

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Image Generation</h3>
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">
          Default provider for Imagine and Imagine again.
        </p>
        <label className="block text-[12px] font-medium text-[var(--text-secondary)] mb-1">Default provider</label>
        <select
          value={settings.image_provider || 'openai-compatible'}
          onChange={(e) => updateSettings({
            image_provider: e.target.value,
            // A base URL is never valid across providers (OpenAI endpoint vs
            // ComfyUI instance vs Gemini override), so drop the stale value
            // instead of sending the new provider to the old address.
            image_base_url: '',
          })}
          className="border border-[var(--border-subtle)] rounded-[6px] px-3 py-2 text-[13px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)] transition-colors w-[240px]"
        >
          {IMAGE_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <div className="grid grid-cols-1 gap-3 mt-3">
          {/* Gemini always uses Google's default endpoint — no URL to configure. */}
          {!isGemini && (
            <input
              placeholder={isComfy ? 'ComfyUI URL (e.g. http://127.0.0.1:8188)' : 'Base URL (e.g. https://api.openai.com)'}
              value={settings.image_base_url || ''}
              onChange={(e) => updateSettings({ image_base_url: e.target.value })}
              className="border border-[var(--border-subtle)] rounded-[6px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]"
            />
          )}
          {!isComfy && (
            <>
              <input
                placeholder="API key"
                type="password"
                value={settings.image_api_key || ''}
                onChange={(e) => updateSettings({ image_api_key: e.target.value })}
                className="border border-[var(--border-subtle)] rounded-[6px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]"
              />
              <input
                placeholder={isGemini ? 'Model (e.g. gemini-3.1-flash-lite-image)' : 'Model (e.g. gpt-image-1)'}
                value={settings.image_model || ''}
                onChange={(e) => updateSettings({ image_model: e.target.value })}
                className="border border-[var(--border-subtle)] rounded-[6px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]"
              />
            </>
          )}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button onClick={handleTest} disabled={testResult.status === 'testing'} className="px-3 py-1.5 text-[12px] bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[6px] hover:border-[var(--text-secondary)] transition-colors disabled:opacity-50 cursor-pointer text-[var(--text)]">
            {testResult.status === 'testing' ? 'Testing...' : 'Test provider'}
          </button>
          {testResult.status === 'success' && <span className="text-[11px] text-[var(--text-accent)]">{testResult.msg}</span>}
          {testResult.status === 'error' && <span className="text-[11px] text-red-500">{testResult.msg}</span>}
        </div>
      </section>

      {isComfy && (
        <section>
          <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">ComfyUI Workflows</h3>
          <p className="text-[12px] text-[var(--text-secondary)] mb-3">
            Your own workflows running on your local instance — one that dreams
            up new images, one that reworks an existing image.
          </p>
          <div className="flex flex-col gap-3">
            <ComfySlotSection slot="text" settings={settings} updateSettings={updateSettings} />
            <ComfySlotSection slot="edit" settings={settings} updateSettings={updateSettings} />
          </div>
        </section>
      )}

      <section>
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Styles</h3>
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">
          Extra direction appended to the image prompt for the style you pick.
        </p>
        <div className="border border-[var(--border-subtle)] rounded-[8px] divide-y divide-[var(--border-subtle)] mb-3">
          {allStyleNames.map((name) => {
            const custom = customs.find((c) => c.name === name)
            const isBuiltin = !custom
            const overridden = isBuiltin && name !== 'None'
              && (settings.image_style_overrides || {})[name] !== undefined
            const prompt = isBuiltin
              ? (name === 'None'
                ? null
                : (settings.image_style_overrides || {})[name]
                  ?? builtinPrompts?.[name] ?? null)
              : (custom?.prompt ?? '')
            const isEditing = editingName === name
            const isDefault = (defaultStyle ?? 'None') === name
            return (
              <div key={name} className="px-2.5 py-2 group">
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="image_default_style"
                    checked={isDefault}
                    onChange={() => updateSettings({ image_default_style: name === 'None' ? null : name })}
                    className="accent-[var(--accent-brown)] shrink-0"
                    title="Use as default style"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-medium text-[var(--text-heading)] truncate">
                      {name}
                      {isDefault ? (
                        <span className="ml-1.5 text-[10px] font-normal text-[var(--text-muted)]">
                          · default
                        </span>
                      ) : overridden ? (
                        <span className="ml-1.5 text-[10px] font-normal text-[var(--text-muted)]">
                          · customized
                        </span>
                      ) : null}
                    </div>
                    {!isEditing && (
                      <div
                        className="text-[11px] text-[var(--text-muted)] truncate"
                        title={name === 'None' ? 'No style suffix — nothing is appended.' : (prompt || undefined)}
                      >
                        {name === 'None' ? 'No style suffix — nothing is appended.' : (prompt || '—')}
                      </div>
                    )}
                  </div>
                  {!isEditing && (
                    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      {name !== 'None' && (
                        <button
                          onClick={() => { setEditingName(name); setEditingPrompt(prompt ?? '') }}
                          title={`Edit ${name}`}
                          className="flex items-center justify-center w-6 h-6 text-[var(--text-secondary)]/60 hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] rounded-[4px] transition-all cursor-pointer"
                        >
                          <Pencil className="w-3 h-3" strokeWidth={2} />
                        </button>
                      )}
                      {overridden && (
                        <button
                          onClick={() => {
                            const next = { ...(settings.image_style_overrides || {}) }
                            delete next[name]
                            updateSettings({ image_style_overrides: next })
                          }}
                          title="Restore shipped text"
                          className="flex items-center justify-center w-6 h-6 text-[var(--text-secondary)]/60 hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] rounded-[4px] transition-all cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" strokeWidth={2} />
                        </button>
                      )}
                      {name !== 'None' && (
                        <button
                          onClick={() => handleDeleteStyle(name, isBuiltin)}
                          title={`Delete ${name}`}
                          className="flex items-center justify-center w-6 h-6 text-[var(--text-secondary)]/60 hover:text-red-500 hover:bg-[var(--bg-hover)] rounded-[4px] transition-all cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" strokeWidth={2} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {isEditing && (
                  <div className="flex flex-col gap-2 mt-2">
                    <textarea
                      value={editingPrompt}
                      onChange={(e) => setEditingPrompt(e.target.value)}
                      rows={2}
                      className="w-full border border-[var(--border-subtle)] rounded-[6px] px-2.5 py-1.5 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)] resize-y"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          if (isBuiltin) {
                            updateSettings({
                              image_style_overrides: {
                                ...(settings.image_style_overrides || {}),
                                [name]: editingPrompt.trim(),
                              },
                            })
                          } else {
                            updateSettings({
                              image_custom_styles: customs.map((x) =>
                                x.name === name ? { ...x, prompt: editingPrompt.trim() } : x),
                            })
                          }
                          setEditingName(null)
                        }}
                        disabled={!editingPrompt.trim()}
                        className="px-3 py-1 text-[11px] bg-[var(--accent-brown)] text-[var(--text-inverse)] rounded-[6px] hover:bg-[var(--accent-brown-hover)] transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingName(null)}
                        className="px-3 py-1 text-[11px] bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[6px] hover:border-[var(--text-secondary)] transition-colors cursor-pointer text-[var(--text)]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {deletedBuiltins.length > 0 && (
          <p className="text-[11px] text-[var(--text-muted)] mb-2">
            {deletedBuiltins.map((n, i) => (
              <span key={n}>
                {i > 0 && ' · '}
                <button
                  onClick={() => updateSettings({ image_deleted_styles: deletedStyles.filter((d) => d.toLowerCase() !== n.toLowerCase()) })}
                  className="hover:text-[var(--text-heading)] underline underline-offset-2 cursor-pointer transition-colors"
                >
                  Restore {n}
                </button>
              </span>
            ))}
          </p>
        )}
        {customs.length === 0 && (
          <p className="text-[12px] text-[var(--text-muted)] mb-2">No custom styles yet.</p>
        )}
        <div className="flex flex-col gap-2 rounded-[8px] border border-[var(--border-subtle)] p-3">
          <input
            placeholder="Name (e.g. Fantasy)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="border border-[var(--border-subtle)] rounded-[6px] px-3 py-1.5 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]"
          />
          <input
            placeholder="Style prompt (appended to the generation prompt)"
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newName.trim() && newPrompt.trim()) {
                const name = newName.trim()
                if (allStyleNames.some((n) => n.toLowerCase() === name.toLowerCase())) return
                updateSettings({ image_custom_styles: [...customs, { name, prompt: newPrompt.trim() }] })
                setNewName('')
                setNewPrompt('')
              }
            }}
            className="border border-[var(--border-subtle)] rounded-[6px] px-3 py-1.5 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]"
          />
          <button
            onClick={() => {
              const name = newName.trim()
              if (!name || !newPrompt.trim()) return
              if (allStyleNames.some((n) => n.toLowerCase() === name.toLowerCase())) return
              updateSettings({ image_custom_styles: [...customs, { name, prompt: newPrompt.trim() }] })
              setNewName('')
              setNewPrompt('')
            }}
            disabled={!newName.trim() || !newPrompt.trim()}
            className="self-start px-3 py-1.5 text-[12px] bg-[var(--accent-brown)] text-[var(--text-inverse)] rounded-[6px] hover:bg-[var(--accent-brown-hover)] transition-colors disabled:opacity-50 cursor-pointer"
          >
            Add style
          </button>
        </div>
      </section>
    </div>
  )
}

const PROMPT_ENTRIES = [
  { id: 'writer', file: 'simple-writer.md', label: 'Writer', description: 'Writes the replacement text for panel edits and inline Rewrite — endpoint path only.' },
  { id: 'planner', file: 'simple-planner.md', label: 'Planner', description: 'Picks context files and refines the instruction for the Writer — endpoint path only.' },
  { id: 'chat', file: 'simple-chat.md', label: 'Chat', description: 'Converses and answers — makes no edits, for endpoints and harnesses.' },
  { id: 'harness-edit', file: 'harness-edit.md', label: 'Harness Edit', description: 'Standing instructions for agent harnesses in Edit mode (OpenCode, Claude Code, Codex, Antigravity) — including the rule that changes land in files, not in the reply.' },
]

function PromptsSettings() {
  const [selectedId, setSelectedId] = useState('writer')
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  const entry = PROMPT_ENTRIES.find(e => e.id === selectedId)!

  useEffect(() => {
    // Reset + fetch on prompt switch; matches the data-fetch pattern used elsewhere here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true)
    setError('')
    fetch(`${API_BASE}/api/assist/prompts/${encodeURIComponent(entry.file)}`)
      .then(res => {
        if (!res.ok) throw new Error(`Could not load ${entry.file}`)
        return res.json()
      })
      .then(data => {
        setContent(data.content || '')
        setSavedContent(data.content || '')
      })
      .catch(err => setError((err as Error).message))
      .finally(() => setIsLoading(false))
  }, [entry.file])

  const dirty = content !== savedContent

  const handleSave = async () => {
    setIsSaving(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/api/assist/prompts/${encodeURIComponent(entry.file)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) throw new Error('Save failed')
      setSavedContent(content)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Agent Prompts</h3>
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">Edit the instructions each agent runs on. Changes apply to the next request.</p>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="border border-[var(--border-subtle)] rounded-[6px] px-3 py-2 text-[13px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)] transition-colors w-[280px] mb-1"
        >
          {PROMPT_ENTRIES.map(e => (
            <option key={e.id} value={e.id}>{e.label} — {e.file}</option>
          ))}
        </select>
        <p className="text-[11px] text-[var(--text-muted)] mb-3">{entry.description}</p>
        {isLoading ? (
          <p className="text-[12px] text-[var(--text-muted)]">Loading {entry.file}...</p>
        ) : (
          <>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              className="w-full h-[300px] border border-[var(--border-subtle)] rounded-[6px] p-3 text-[12px] text-[var(--text)] bg-[var(--bg-input)] outline-none focus:border-[var(--text-secondary)] transition-colors resize-y font-mono leading-relaxed"
            />
            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={handleSave}
                disabled={!dirty || isSaving}
                className="px-3 py-1.5 text-[12px] bg-[var(--accent-brown)] text-[var(--text-inverse)] rounded-[4px] hover:bg-[var(--accent-brown-hover)] transition-colors disabled:opacity-50 cursor-pointer font-medium"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
              {dirty
                ? <span className="text-[11px] text-[var(--text-muted)]">Unsaved changes</span>
                : <span className="text-[11px] text-[var(--text-accent)]">Saved</span>}
              {error && <span className="text-[11px] text-red-500">{error}</span>}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
