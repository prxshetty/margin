import { useState, useEffect } from 'react'
import { Check, Pencil, Loader, X, List } from 'lucide-react'
import type { AppSettings } from '../../stores/settingsStore'
import { API_BASE } from '../../lib/api'
import { HarnessIcon } from '../HarnessIcon'
import { Dropdown } from '../Dropdown'
import { FilterSection, SectionLabel } from './shared'

function HarnessConfigDialog({
  harness,
  initial,
  onSave,
  onClose,
}: {
  harness: { id: string; name: string; installed: boolean }
  initial: { executable: string; model: string; context_window?: number }
  onSave: (config: { executable: string; model: string; context_window?: number }) => void
  onClose: () => void
}) {
  const [executable, setExecutable] = useState(initial.executable)
  const [model, setModel] = useState(initial.model)
  const [context, setContext] = useState(initial.context_window ? String(initial.context_window) : '')

  const handleSave = () => {
    onSave({ executable, model, context_window: parseInt(context) || undefined })
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/15 dark:bg-black/45 backdrop-blur-[2px] z-[200] flex items-center justify-center p-4 animate-scale-in">
      <div className="bg-[var(--bg)] border border-[var(--border-subtle)] w-full max-w-lg rounded-[16px] shadow-none p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-medium text-[var(--text-heading)] flex items-center gap-2">
            <HarnessIcon id={harness.id} className="w-4 h-4" />
            {harness.name}
          </h3>
          <button onClick={onClose} className="flex items-center justify-center w-8 h-8 text-[var(--text-muted)] hover:text-[var(--text-heading)] transition-colors cursor-pointer">
            <X size={15} />
          </button>
        </div>
        <p className="text-[11px] text-[var(--text-secondary)] -mt-2">
          {harness.installed ? 'Authenticate its CLI in your own terminal.' : '✕ Not installed — install and authenticate its CLI, then reopen Settings.'}
        </p>
        <div className="flex flex-col gap-3">
          <input
            type="text"
            placeholder={`Executable (e.g. /opt/homebrew/bin/${harness.id})`}
            value={executable}
            onChange={(e) => setExecutable(e.target.value)}
            className="w-full h-9 border border-[var(--border-subtle)] rounded-[4px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)] font-mono"
          />
          <div className="flex gap-2 min-w-0">
            <HarnessModelPicker
              key={`${harness.id}:${executable}`}
              harnessId={harness.id}
              value={model}
              onChange={setModel}
            />
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Context"
              value={context}
              onChange={(e) => setContext(e.target.value.replace(/[^0-9]/g, ''))}
              className="w-[110px] h-9 border border-[var(--border-subtle)] rounded-[4px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)] font-mono shrink-0"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)]/50 pt-3">
          <button
            onClick={handleSave}
            className="px-3 py-1.5 text-[12px] bg-[var(--accent-brown)] text-[var(--text-inverse)] rounded-[8px] hover:bg-[var(--accent-brown-hover)] transition-colors cursor-pointer"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

export function HarnessesSettings({ settings, updateSettings, query }: { settings: AppSettings, updateSettings: (u: Partial<AppSettings>) => void, query: string }) {
  const [discovered, setDiscovered] = useState<{ id: string; name: string; installed: boolean; version: string | null }[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [configDialog, setConfigDialog] = useState<{ id: string; name: string; installed: boolean } | null>(null)

  useEffect(() => {
    fetch(`${API_BASE}/api/harnesses`)
      .then(res => res.ok ? res.json() : { harnesses: [] })
      .then(data => setDiscovered(data.harnesses || []))
      .catch(err => console.error(err))
      .finally(() => setIsLoading(false))
  }, [])

  const selected = settings.default_harness || 'none'

  const handleSaveConfig = (id: string, config: { executable: string; model: string; context_window?: number }) => {
    updateSettings({ harnesses: { ...(settings.harnesses || {}), [id]: { ...(settings.harnesses?.[id] || {}), ...config } } })
  }

  return (
    <div className="flex flex-col gap-6">
      <FilterSection query={query} keywords="harness default none agent terminal executable model context">
        <section>
          <SectionLabel description="External agent runtimes (Claude Code, Codex, ...) run locally with your own subscription. Select None to use the configured endpoint instead. Authenticate each CLI in your own terminal.">Agent harness</SectionLabel>

          <div className="flex flex-col gap-2">
          <div
            onClick={() => updateSettings({ default_harness: 'none' })}
            className={`relative flex items-center gap-3 p-3 cursor-pointer border rounded-[12px] transition-colors ${selected === 'none' ? 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40' : 'border-[var(--border-subtle)] hover:border-[var(--text-secondary)]'}`}
          >
            {selected === 'none' && (
              <span className="absolute top-2.5 right-2.5 text-[var(--accent-brown)]"><Check size={14} /></span>
            )}
            <div className="flex flex-col min-w-0 pr-6">
              <span className="text-[13px] font-medium text-[var(--text-heading)]">None — use endpoint</span>
              <span className="text-[11px] text-[var(--text-secondary)]">Default. No local agent involved.</span>
            </div>
          </div>

          {isLoading && (
            <p className="flex items-center justify-center gap-2 text-[12px] text-[var(--text-muted)] p-2">
              <Loader size={14} className="animate-spin" />
              Detecting installed harnesses...
            </p>
          )}

          {discovered.map(h => (
            <div key={h.id} className={`relative border rounded-[12px] transition-colors group ${selected === h.id ? 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40' : 'border-[var(--border-subtle)] hover:border-[var(--text-secondary)]'}`}>
              {selected === h.id && (
                <span className="absolute top-2.5 right-2.5 text-[var(--accent-brown)]"><Check size={14} /></span>
              )}
              <div onClick={() => updateSettings({ default_harness: h.id })} className="flex items-center gap-3 p-3 cursor-pointer">
                <div className="flex flex-col min-w-0 flex-1 pr-6">
                  <span className="text-[13px] font-medium text-[var(--text-heading)] flex items-center gap-2">
                    <HarnessIcon id={h.id} className="w-4 h-4" />
                    {h.name}
                  </span>
                  {/* pl-6 = icon (w-4/16px) + gap-2 (8px): status starts
                      exactly below the first letter of the harness name. */}
                  <span className="text-[11px] text-[var(--text-secondary)] pl-6">
                    {h.installed ? 'Ready' : '✕ Not installed — install and authenticate its CLI, then reopen Settings'}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setConfigDialog({ id: h.id, name: h.name, installed: h.installed })}
                title={`Configure ${h.name}`}
                className="absolute bottom-2.5 right-2.5 flex items-center justify-center w-6 h-6 text-[var(--text-secondary)]/60 hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] rounded-[4px] transition-all cursor-pointer opacity-0 group-hover:opacity-100"
              >
                <Pencil className="w-3 h-3" strokeWidth={2} />
              </button>
            </div>
          ))}
          </div>
        </section>
      </FilterSection>
      {configDialog && (
        <HarnessConfigDialog
          harness={configDialog}
          initial={{
            executable: settings.harnesses?.[configDialog.id]?.executable || '',
            model: settings.harnesses?.[configDialog.id]?.model || '',
            context_window: settings.harnesses?.[configDialog.id]?.context_window,
          }}
          onSave={(config) => handleSaveConfig(configDialog.id, config)}
          onClose={() => setConfigDialog(null)}
        />
      )}
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
    return <span className="flex-1 min-w-0 h-[26px] rounded-[4px] bg-[var(--bg-hover)] animate-pulse" aria-label="Loading models..." />
  }

  if (manual || models.length === 0 || customMode) {
    if (!manual && models.length > 0 && customMode) {
      return (
        <div className="flex-1 min-w-0 flex items-center gap-0.5">
          <input
            type="text"
            placeholder="e.g. anthropic/claude-sonnet-4-5 (empty = harness default)"
            value={value}
            onChange={(e) => { setCustomMode(true); onChange(e.target.value) }}
            className="flex-1 min-w-0 h-9 border border-[var(--border-subtle)] rounded-[4px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)] font-mono"
          />
          <button
            type="button"
            onClick={() => setCustomMode(false)}
            title="Choose from list"
            className="flex items-center justify-center w-6 h-6 text-[var(--text-secondary)]/60 hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] rounded-[4px] transition-all cursor-pointer shrink-0"
          >
            <List size={13} />
          </button>
        </div>
      )
    }
    return (
      <input
        type="text"
        placeholder="e.g. anthropic/claude-sonnet-4-5 (empty = harness default)"
        value={value}
        onChange={(e) => { setCustomMode(true); onChange(e.target.value) }}
        className="flex-1 min-w-0 border border-[var(--border-subtle)] rounded-[4px] px-2.5 py-1 text-[11px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)] font-mono"
      />
    )
  }

  return (
    <Dropdown
      value={value}
      onChange={(v) => {
        if (v === '__custom__') {
          setCustomMode(true)
        } else {
          onChange(v)
        }
      }}
      options={[
        { value: '', label: 'Harness default' },
        ...models.map(m => ({
          value: m.id,
          label: m.id,
        })),
        { value: '__custom__', label: 'Custom...' },
      ]}
      rootClassName="flex-1 min-w-0 font-mono [&>button]:h-9"
      portal
      searchable
      searchPlaceholder="Search models..."
    />
  )
}
