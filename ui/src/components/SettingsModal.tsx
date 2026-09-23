import { useState, useEffect } from 'react'
import { X, Search, SlidersHorizontal, Folder, Palette, Image as ImageIcon, BookOpen, SquareTerminal } from 'lucide-react'
import { useSettingsStore, type SettingsTabId } from '../stores/settingsStore'
import { toast } from '../stores/toastStore'
import { API_BASE } from '../lib/api'
import { EndpointLogo } from './settings/shared'
import { matchesQuery } from './settings/query'
import { GeneralSettings } from './settings/GeneralTab'
import { WorkspacesSettings } from './settings/WorkspacesTab'
import { AppearanceSettings } from './settings/AppearanceTab'
import { ContextSettings } from './settings/ContextTab'
import { EndpointsSettings } from './settings/EndpointsTab'
import { HarnessesSettings } from './settings/HarnessTab'
import { ImagesSettings } from './settings/ImagineTab'
interface SettingsModalProps {
  onClose: () => void
}

const TABS: { id: SettingsTabId; label: string; icon: React.ComponentType<{ size?: number | string; className?: string }>; title: string; keywords: string }[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal, title: 'General', keywords: 'general mode verbosity stats files tokens activity' },
  { id: 'workspaces', label: 'Workspaces', icon: Folder, title: 'Workspaces', keywords: 'workspace workspaces directory folder path link browse create git active saved switch recent' },
  { id: 'appearance', label: 'Appearance', icon: Palette, title: 'Appearance', keywords: 'appearance theme light dark system color font text style stats palette' },
  { id: 'images', label: 'Imagine', icon: ImageIcon, title: 'Imagine', keywords: 'images image imagine provider comfyui comfy styles style model key' },
  { id: 'context', label: 'Context', icon: BookOpen, title: 'Context', keywords: 'context agent prompt prompts memory session files reference outline' },
  { id: 'endpoints', label: 'Endpoints', icon: EndpointLogo, title: 'Endpoints', keywords: 'endpoints endpoint api provider model url key' },
  { id: 'harnesses', label: 'Harness', icon: SquareTerminal, title: 'Harness', keywords: 'harness terminal executable model context agent' },
]

// Forgiving multi-term match: every query token must appear in the haystack.

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { settings, updateSettings, settingsTab, setSettingsTab } = useSettingsStore()
  // Deep-link target from the store (e.g. the panel's "Manage endpoints…"):
  // consumed once as the initial tab, then cleared.
  const [activeTab, setActiveTab] = useState<SettingsTabId>(settingsTab ?? 'general')
  useEffect(() => { setSettingsTab(null) }, [])
  const [availableFiles, setAvailableFiles] = useState<{ name: string; path: string }[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    fetch(`${API_BASE}/api/workspace/files`)
      .then(res => res.json())
      .then(data => setAvailableFiles(data))
      .catch(err => {
        console.error(err)
        toast.error('Could not list workspace files for context pinning.')
      })
  }, [])

  const visibleTabs = TABS.filter((t) => matchesQuery(query, `${t.label} ${t.keywords}`))

  // When searching filters the current tab out, jump to the first match.
  useEffect(() => {
    if (query.trim() && visibleTabs.length > 0 && !visibleTabs.some((t) => t.id === activeTab)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab(visibleTabs[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  if (!settings) return null

  const active = TABS.find((t) => t.id === activeTab) ?? TABS[0]

  return (
    <div className="fixed inset-0 bg-black/15 dark:bg-black/45 backdrop-blur-[2px] z-[100] flex items-center justify-center p-4 font-sans">
      <div className="bg-[var(--bg)] border border-[var(--border-subtle)] w-full max-w-4xl rounded-[16px] shadow-none flex flex-col h-[720px] max-h-[90vh] overflow-hidden transform transition-all animate-scale-in">
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar Tabs */}
          <div className="w-[200px] border-r border-[var(--border-subtle)] p-3 flex flex-col gap-1 shrink-0">
            <div className="relative mb-2">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search settings"
                className="w-full border border-[var(--border-subtle)] rounded-[8px] pl-8 pr-7 py-1.5 text-[12px] bg-[var(--bg-input)] text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--text-secondary)] transition-colors"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-heading)] transition-colors cursor-pointer"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            {visibleTabs.map((t) => (
              <TabButton key={t.id} active={activeTab === t.id} onClick={() => setActiveTab(t.id)} label={t.label} icon={t.icon} />
            ))}
            {query.trim() && visibleTabs.length === 0 && (
              <p className="text-[12px] text-[var(--text-muted)] px-3 py-2">No matching settings.</p>
            )}
          </div>

          {/* Content Area */}
          <div className="flex-1 min-w-0 px-6 py-8 overflow-y-auto bg-[var(--bg)] text-[var(--text)] relative">
            <button
              onClick={onClose}
              className="absolute top-5 right-6 flex items-center justify-center w-8 h-8 text-[var(--text-muted)] hover:text-[var(--text-heading)] transition-colors cursor-pointer"
            >
              <X size={15} />
            </button>
            <div className="mb-5">
              <h2 className="text-[20px] font-medium text-[var(--text-heading)]">{active.title}</h2>
            </div>
            {activeTab === 'general' && <GeneralSettings settings={settings} updateSettings={updateSettings} query={query} />}
            {activeTab === 'workspaces' && <WorkspacesSettings settings={settings} updateSettings={updateSettings} query={query} />}
            {activeTab === 'appearance' && <AppearanceSettings settings={settings} updateSettings={updateSettings} query={query} />}
            {activeTab === 'images' && <ImagesSettings settings={settings} updateSettings={updateSettings} query={query} />}
            {activeTab === 'context' && <ContextSettings settings={settings} updateSettings={updateSettings} availableFiles={availableFiles} query={query} />}
            {activeTab === 'endpoints' && <EndpointsSettings settings={settings} updateSettings={updateSettings} query={query} />}
            {activeTab === 'harnesses' && <HarnessesSettings settings={settings} updateSettings={updateSettings} query={query} />}
          </div>
        </div>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, label, icon: Icon }: { active: boolean, onClick: () => void, label: string, icon: React.ComponentType<{ size?: number | string; className?: string }> }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 text-left px-3 py-2 rounded-[8px] text-[13px] transition-colors cursor-pointer ${active
        ? 'bg-[var(--bg-hover)] text-[var(--text-heading)] font-medium'
        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]/50'
        }`}
    >
      <Icon size={15} className="shrink-0 opacity-80" />
      {label}
    </button>
  )
}
