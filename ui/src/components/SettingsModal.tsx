import { useState, useEffect } from 'react'
import { X, Plus, Trash2, CheckCircle, Play, RefreshCw } from 'lucide-react'
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
  const [activeTab, setActiveTab] = useState<'general' | 'appearance' | 'editor' | 'context' | 'endpoints'>('general')
  const [availableFiles, setAvailableFiles] = useState<{ name: string; path: string }[]>([])
  const [availableStyles, setAvailableStyles] = useState<{ name: string; description: string }[]>([])

  const refreshStyles = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/workspace/styles`)
      const data = await res.json()
      setAvailableStyles(data)
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    fetch(`${API_BASE}/api/workspace/files`)
      .then(res => res.json())
      .then(data => setAvailableFiles(data))
      .catch(err => console.error(err))

    refreshStyles()
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
            <TabButton active={activeTab === 'editor'} onClick={() => setActiveTab('editor')} label="Editor" />
            <TabButton active={activeTab === 'context'} onClick={() => setActiveTab('context')} label="Context" />
            <TabButton active={activeTab === 'endpoints'} onClick={() => setActiveTab('endpoints')} label="Endpoints" />
          </div>

          {/* Content Area */}
          <div className="flex-1 p-8 overflow-y-auto bg-[var(--bg)] text-[var(--text)]">
            {activeTab === 'general' && <GeneralSettings settings={settings} updateSettings={updateSettings} />}
            {activeTab === 'appearance' && <AppearanceSettings settings={settings} updateSettings={updateSettings} />}
            {activeTab === 'editor' && <EditorSettings settings={settings} updateSettings={updateSettings} />}
            {activeTab === 'context' && <ContextSettings settings={settings} updateSettings={updateSettings} availableFiles={availableFiles} availableStyles={availableStyles} refreshStyles={refreshStyles} />}
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

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Mode</h3>
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
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Theme</h3>
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
  )
}

function EditorSettings({ settings, updateSettings }: { settings: AppSettings, updateSettings: (u: Partial<AppSettings>) => void }) {
  const selectedTextStyle = settings.text_style || 'system'
  const selectedStats = settings.editor_stats || 'both'

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Document Outline</h3>
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">Show an interactive structure outline / ruler on the left side of the editor.</p>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={settings.show_outline !== false}
            onChange={(e) => updateSettings({ show_outline: e.target.checked })}
            className="accent-[var(--accent-brown)]"
          />
          <span className="text-[13px] text-[var(--text-secondary)] font-medium">Show Outline Ruler</span>
        </label>
      </section>

      <section>
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Editor Statistics</h3>
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

      <section>
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Text Style</h3>
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
  )
}

function ContextSettings({
  settings,
  updateSettings,
  availableFiles,
  availableStyles,
  refreshStyles
}: {
  settings: AppSettings,
  updateSettings: (u: Partial<AppSettings>) => void,
  availableFiles: { name: string; path: string }[],
  availableStyles: { name: string; description: string }[],
  refreshStyles: () => Promise<void>
}) {
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await refreshStyles()
    setTimeout(() => setIsRefreshing(false), 500)
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[13px] font-medium text-[var(--text-heading)]">Tone Preset</h3>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="text-[var(--text-secondary)] hover:text-[var(--text-heading)] transition-colors cursor-pointer disabled:opacity-50"
            title="Refresh style guidelines"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">
          Tone used by the writer agent by default. 'Auto' lets the planner choose based on your request. 'None' disables style injection.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => updateSettings({ tone_preset: '' })}
            className={`px-3 py-1.5 rounded-[4px] text-[12px] border transition-colors cursor-pointer capitalize ${(!settings.tone_preset || settings.tone_preset.toLowerCase() === 'none') ? 'bg-[var(--accent-brown)] text-[var(--text-inverse)] border-[var(--accent-brown)] font-medium' : 'bg-[var(--bg)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--text-secondary)] hover:text-[var(--text-heading)]'}`}
            title="Disable style guidelines injection"
          >
            None
          </button>
          <button
            onClick={() => updateSettings({ tone_preset: 'auto' })}
            className={`px-3 py-1.5 rounded-[4px] text-[12px] border transition-colors cursor-pointer capitalize ${(settings.tone_preset?.toLowerCase() === 'auto') ? 'bg-[var(--accent-brown)] text-[var(--text-inverse)] border-[var(--accent-brown)] font-medium' : 'bg-[var(--bg)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--text-secondary)] hover:text-[var(--text-heading)]'}`}
            title="Let the AI Planner dynamically select the best style"
          >
            Auto
          </button>
          {availableStyles.map(style => (
            <button
              key={style.name}
              onClick={() => updateSettings({ tone_preset: style.name })}
              className={`px-3 py-1.5 rounded-[4px] text-[12px] border transition-colors cursor-pointer capitalize ${settings.tone_preset === style.name ? 'bg-[var(--accent-brown)] text-[var(--text-inverse)] border-[var(--accent-brown)] font-medium' : 'bg-[var(--bg)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--text-secondary)] hover:text-[var(--text-heading)]'}`}
              title={style.description}
            >
              {style.name.replace('_', ' ')}
            </button>
          ))}
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
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">Instructions prepended to every AI interaction.</p>
        <textarea
          value={settings.additional_context || ''}
          onChange={(e) => updateSettings({ additional_context: e.target.value })}
          className="w-full h-[120px] border border-[var(--border-subtle)] rounded-[6px] p-3 text-[13px] text-[var(--text)] bg-[var(--bg-input)] outline-none focus:border-[var(--text-secondary)] transition-colors resize-none font-sans leading-relaxed"
          placeholder="E.g., Always use British spelling. Never use passive voice."
        />
      </section>

      <section>
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Reference Files</h3>
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">
          All workspace files are available for the planner to reference. <strong>Pin</strong> a file to always include it in every request. <strong>Cross it out</strong> to prevent the AI from reading it — useful when smaller models struggle with conflicting reference material.
        </p>
        <div className="border border-[var(--border-subtle)] rounded-[6px] max-h-[300px] overflow-y-auto p-2">
          {availableFiles.length === 0 ? (
            <p className="text-[12px] text-[var(--text-secondary)] p-2 text-center">No files in workspace.</p>
          ) : (
            availableFiles.map(file => {
              const isPinned = (settings.pinned_ref_files || []).includes(file.path)
              const isIgnored = (settings.ignored_ref_files || []).includes(file.path)

              const cycleState = () => {
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
                <div key={file.path} className="flex items-center gap-2 p-2 hover:bg-[var(--bg-hover)] rounded-[4px] group">
                  <span className="text-[13px] text-[var(--text-heading)] min-w-0 truncate flex-1">{file.name}</span>
                  <span className="text-[11px] text-[var(--text-muted)] hidden group-hover:inline truncate max-w-[200px]">{file.path}</span>
                  <button
                    onClick={cycleState}
                    className={`p-1 rounded-[4px] transition-all cursor-pointer shrink-0 ${stateColor}`}
                    title={stateTitle}
                  >
                    {isPinned ? (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m3 21 4.63-4.631m.005-.005-2.78-2.78c-.954-.954.006-2.996 1.31-3.078 1.178-.075 3.905.352 4.811-.555l2.49-2.49c.618-.618.226-2 .186-2.762-.058-1.016 1.558-2.271 2.415-1.414l4.647 4.648c.86.858-.4 2.469-1.413 2.415-.762-.04-2.145-.432-2.763.185l-2.49 2.49c-.906.907-.48 3.633-.554 4.811-.082 1.305-2.125 2.265-3.08 1.31l-2.78-2.78Z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                        <circle cx="12" cy="12" r="3" />
                        {isIgnored && <line x1="4" y1="4" x2="20" y2="20" />}
                      </svg>
                    )}
                  </button>
                </div>
              )
            })
          )}
        </div>
      </section>
    </div>
  )
}

function EndpointsSettings({ settings, updateSettings }: { settings: AppSettings, updateSettings: (u: Partial<AppSettings>) => void }) {
  const [newId, setNewId] = useState('')
  const [newUrl, setNewUrl] = useState('http://localhost:1234')
  const [newKey, setNewKey] = useState('')
  const [newModel, setNewModel] = useState('')
  const [testResult, setTestResult] = useState<{ status: 'idle' | 'testing' | 'success' | 'error', msg?: string }>({ status: 'idle' })

  const handleAdd = () => {
    if (!newId || !newUrl) return
    const id = newId.trim().toLowerCase().replace(/\s+/g, '_')
    const updatedEndpoints = { ...settings.endpoints, [id]: { url: newUrl, api_key: newKey, model: newModel } }
    updateSettings({ endpoints: updatedEndpoints })
    setNewId('')
    setNewUrl('http://localhost:1234')
    setNewKey('')
    setNewModel('')
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
          <label className="flex items-center gap-3 p-3 border border-[var(--border-subtle)] rounded-[6px] cursor-pointer hover:bg-[var(--bg-hover)] transition-colors">
            <input
              type="radio"
              name="active_endpoint"
              checked={settings.active_endpoint === null}
              onChange={() => updateSettings({ active_endpoint: null })}
              className="accent-[var(--accent-brown)]"
            />
            <span className="text-[13px] font-medium text-[var(--text-heading)] flex-1">.env Default (Local)</span>
            <div className="flex items-center gap-2" onClick={(e) => e.preventDefault()}>
              <button onClick={() => handleTest("default", "")} className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-heading)] bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[4px] cursor-pointer" title="Test Connection">
                <Play size={14} />
              </button>
            </div>
          </label>

          {Object.entries(settings.endpoints || {}).map(([id, ep]) => (
            <div key={id} className={`flex items-center justify-between p-3 border rounded-[6px] transition-colors ${settings.active_endpoint === id ? 'border-[var(--text-secondary)] bg-[var(--bg-hover)]' : 'border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'}`}>
              <label className="flex items-center gap-3 cursor-pointer flex-1">
                <input
                  type="radio"
                  name="active_endpoint"
                  checked={settings.active_endpoint === id}
                  onChange={() => updateSettings({ active_endpoint: id })}
                  className="accent-[var(--accent-brown)]"
                />
                <div className="flex flex-col">
                  <span className="text-[13px] font-medium text-[var(--text-heading)] capitalize">{id.replace('_', ' ')}</span>
                  <span className="text-[11px] text-[var(--text-secondary)]">{ep.url} {ep.model ? `• ${ep.model}` : ''}</span>
                </div>
              </label>
              <div className="flex items-center gap-2">
                <button onClick={() => handleTest(ep.url, ep.api_key)} className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-heading)] bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[4px] cursor-pointer" title="Test Connection">
                  <Play size={14} />
                </button>
                <button
                  onClick={() => {
                    const newEps = { ...settings.endpoints }
                    delete newEps[id]
                    updateSettings({ endpoints: newEps, active_endpoint: settings.active_endpoint === id ? null : settings.active_endpoint })
                  }}
                  className="p-1.5 text-[var(--text-secondary)] hover:text-red-500 bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[4px] cursor-pointer" title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-[var(--bg-elevated)] p-4 rounded-[8px] border border-[var(--border-subtle)]">
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-3">Add New Endpoint</h3>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <input placeholder="Name (e.g. OpenAI)" value={newId} onChange={e => setNewId(e.target.value)} className="border border-[var(--border-subtle)] rounded-[4px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]" />
          <input placeholder="Base URL" value={newUrl} onChange={e => setNewUrl(e.target.value)} className="border border-[var(--border-subtle)] rounded-[4px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]" />
          <input placeholder="API Key (Optional)" type="password" value={newKey} onChange={e => setNewKey(e.target.value)} className="border border-[var(--border-subtle)] rounded-[4px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]" />
          <input placeholder="Model Name (Optional)" value={newModel} onChange={e => setNewModel(e.target.value)} className="border border-[var(--border-subtle)] rounded-[4px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]" />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={() => handleTest(newUrl, newKey)} disabled={!newUrl || testResult.status === 'testing'} className="px-3 py-1.5 text-[12px] bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[4px] hover:border-[var(--text-secondary)] transition-colors disabled:opacity-50 cursor-pointer text-[var(--text)]">
              {testResult.status === 'testing' ? 'Testing...' : 'Test Connection'}
            </button>
            {testResult.status === 'success' && <span className="text-[11px] text-[var(--text-accent)] flex items-center gap-1"><CheckCircle size={12} /> {testResult.msg}</span>}
            {testResult.status === 'error' && <span className="text-[11px] text-red-500 flex items-center gap-1"><X size={12} /> {testResult.msg}</span>}
          </div>
          <button onClick={handleAdd} disabled={!newId || !newUrl} className="px-3 py-1.5 text-[12px] bg-[var(--accent-brown)] text-[var(--text-inverse)] rounded-[4px] hover:bg-[var(--accent-brown-hover)] transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1">
            <Plus size={14} /> Save Endpoint
          </button>
        </div>
      </section>
    </div>
  )
}
