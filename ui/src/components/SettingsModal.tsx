import { useState, useEffect } from 'react'
import { X, Plus, Trash2, CheckCircle, Play, Sun, Moon, Monitor, Check } from 'lucide-react'
import { useSettingsStore } from '../stores/settingsStore'
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

const themeModes: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor }
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
  const [availableFiles, setAvailableFiles] = useState<{name: string; path: string}[]>([])
  const [availableStyles, setAvailableStyles] = useState<{name: string; description: string}[]>([])

  useEffect(() => {
    fetch(`${API_BASE}/api/workspace/inputs/files`)
      .then(res => res.json())
      .then(data => setAvailableFiles(data))
      .catch(err => console.error(err))

    fetch(`${API_BASE}/api/workspace/styles`)
      .then(res => res.json())
      .then(data => setAvailableStyles(data))
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
            {activeTab === 'context' && <ContextSettings settings={settings} updateSettings={updateSettings} availableFiles={availableFiles} availableStyles={availableStyles} />}
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
      className={`text-left px-3 py-2 rounded-[6px] text-[13px] transition-colors cursor-pointer ${
        active 
          ? 'bg-[var(--bg-hover)] text-[var(--text-heading)] font-medium' 
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]/50'
      }`}
    >
      {label}
    </button>
  )
}

function GeneralSettings({ settings, updateSettings }: { settings: AppSettings, updateSettings: (u: Partial<AppSettings>) => void }) {
  return (
    <div className="flex flex-col gap-8">
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

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Theme</h3>
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">Choose a palette and how it follows your device.</p>
        <div className="grid grid-cols-2 gap-3">
          {themeFamilies.map((themeFamily) => {
            const active = selectedFamily === themeFamily.id
            return (
              <button
                key={themeFamily.id}
                onClick={() => updateSettings({ theme_family: themeFamily.id })}
                className={`relative text-left rounded-[8px] border p-2.5 transition-colors cursor-pointer ${
                  active
                    ? 'border-[var(--accent-brown)] bg-[var(--bg-hover)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg)] hover:border-[var(--text-secondary)]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium text-[var(--text-heading)]">{themeFamily.name}</span>
                      {active && <Check size={13} className="text-[var(--accent-brown)] shrink-0" />}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-secondary)]">{themeFamily.description}</div>
                  </div>
                </div>
                <div className="mt-2.5 flex gap-1.5">
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
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Mode</h3>
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">Use a fixed mode or follow your system appearance.</p>
        <div className="inline-flex rounded-[7px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1">
          {themeModes.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => updateSettings({ theme: id })}
              className={`flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-[12px] transition-colors cursor-pointer ${
                selectedMode === id
                  ? 'bg-[var(--accent-brown)] text-[var(--text-inverse)] font-medium'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-heading)]'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Text Style</h3>
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">Tune the writing surface without changing the whole app chrome.</p>
        <div className="grid grid-cols-2 gap-3">
          {textStyles.map(({ id, name, description }) => {
            const active = selectedTextStyle === id
            return (
              <button
                key={id}
                onClick={() => updateSettings({ text_style: id })}
                className={`text-left rounded-[8px] border p-2.5 transition-colors cursor-pointer ${
                  active
                    ? 'border-[var(--accent-brown)] bg-[var(--bg-hover)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg)] hover:border-[var(--text-secondary)]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={`min-w-0 theme-font-preview-${id}`}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium text-[var(--text-heading)]">{name}</span>
                      {active && <Check size={13} className="text-[var(--accent-brown)] shrink-0" />}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-secondary)]">{description}</div>
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
  availableStyles 
}: { 
  settings: AppSettings, 
  updateSettings: (u: Partial<AppSettings>) => void, 
  availableFiles: {name: string; path: string}[],
  availableStyles: {name: string; description: string}[]
}) {
  return (
    <div className="flex flex-col gap-8">
      <section>
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Tone Preset</h3>
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">Quickly load specific behavioral instructions.</p>
        <div className="flex flex-wrap gap-2">
          <button 
            onClick={() => updateSettings({ tone_preset: '' })}
            className={`px-3 py-1.5 rounded-[4px] text-[12px] border transition-colors cursor-pointer capitalize ${(!settings.tone_preset || settings.tone_preset.toLowerCase() === 'none') ? 'bg-[var(--accent-brown)] text-[var(--text-inverse)] border-[var(--accent-brown)] font-medium' : 'bg-[var(--bg)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--text-secondary)] hover:text-[var(--text-heading)]'}`}
            title="Disable style guidelines injection"
          >
            None
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
        <h3 className="text-[13px] font-medium text-[var(--text-heading)] mb-1">Pinned Reference Files</h3>
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">These workspace files will be silently injected into every request context.</p>
        <div className="border border-[var(--border-subtle)] rounded-[6px] max-h-[200px] overflow-y-auto p-2">
          {availableFiles.length === 0 ? (
            <p className="text-[12px] text-[var(--text-secondary)] p-2 text-center">No files in workspace.</p>
          ) : (
            availableFiles.map(file => {
              const isPinned = (settings.pinned_ref_files || []).includes(file.path)
              return (
                <label key={file.path} className="flex items-center gap-2 p-2 hover:bg-[var(--bg-hover)] rounded-[4px] cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={isPinned}
                    className="accent-[var(--accent-brown)]"
                    onChange={(e) => {
                      const newPinned = e.target.checked 
                        ? [...(settings.pinned_ref_files || []), file.path]
                        : (settings.pinned_ref_files || []).filter(p => p !== file.path)
                      updateSettings({ pinned_ref_files: newPinned })
                    }}
                  />
                  <span className="text-[13px] text-[var(--text-heading)]">{file.name}</span>
                  <span className="text-[11px] text-[var(--text-secondary)] ml-auto">{file.path}</span>
                </label>
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
  const [testResult, setTestResult] = useState<{status: 'idle'|'testing'|'success'|'error', msg?: string}>({status: 'idle'})

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
    setTestResult({status: 'testing'})
    try {
      const res = await fetch(`${API_BASE}/api/settings/test-endpoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, api_key: key })
      })
      if (!res.ok) throw new Error('Connection failed')
      const data = await res.json()
      setTestResult({status: 'success', msg: `Found ${data.models?.data?.length || 0} models.`})
    } catch (e) {
      setTestResult({status: 'error', msg: (e as Error).message})
    }
    setTimeout(() => setTestResult({status: 'idle'}), 4000)
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
            <span className="text-[13px] font-medium text-[var(--text-heading)]">.env Default (Local)</span>
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
            {testResult.status === 'success' && <span className="text-[11px] text-[var(--text-accent)] flex items-center gap-1"><CheckCircle size={12}/> {testResult.msg}</span>}
            {testResult.status === 'error' && <span className="text-[11px] text-red-500 flex items-center gap-1"><X size={12}/> {testResult.msg}</span>}
          </div>
          <button onClick={handleAdd} disabled={!newId || !newUrl} className="px-3 py-1.5 text-[12px] bg-[var(--accent-brown)] text-[var(--text-inverse)] rounded-[4px] hover:bg-[var(--accent-brown-hover)] transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1">
            <Plus size={14}/> Save Endpoint
          </button>
        </div>
      </section>
    </div>
  )
}
