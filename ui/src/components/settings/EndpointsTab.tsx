import { useState, useEffect } from 'react'
import { X, Plus, Trash2, Pencil, Download, Eye, Brain } from 'lucide-react'
import type { AppSettings } from '../../stores/settingsStore'
import { API_BASE } from '../../lib/api'
import { toast } from '../../stores/toastStore'
import { FilterSection, SectionLabel, Toggle } from './shared'
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

function EndpointDialogForSave({
  mode,
  prefilledFromEnv,
  editingId,
  settings,
  onSave,
  onCancel,
  onTest,
  testResult,
}: {
  mode: 'add' | 'edit'
  prefilledFromEnv: boolean
  editingId: string | null
  settings: AppSettings
  onSave: (data: { id: string; url: string; api_key: string; model: string; context_window?: number; is_thinking: boolean; supports_vision: boolean; custom_thinking_tags: Array<{ open: string; close: string }> }) => void
  onCancel: () => void
  onTest: (url: string, key: string, model?: string, opts?: { silent?: boolean }) => Promise<boolean>
  testResult: { status: 'idle' | 'testing' | 'success' | 'error', msg?: string }
}) {
  const [id, setId] = useState(editingId?.replace('_', ' ') ?? '')
  const [url, setUrl] = useState('http://localhost:1234')
  const [key, setKey] = useState('')
  const [model, setModel] = useState('')
  const [context, setContext] = useState('')
  const [isThinking, setIsThinking] = useState(true)
  const [supportsVision, setSupportsVision] = useState(false)
  const [customTags, setCustomTags] = useState<{ open: string; close: string }[]>([])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (editingId && settings.endpoints?.[editingId]) {
      const ep = settings.endpoints[editingId]
      setId(editingId.replace('_', ' '))
      setUrl(ep.url)
      setKey(ep.api_key || '')
      setModel(ep.model || '')
      setContext(ep.context_window ? String(ep.context_window) : '')
      setIsThinking(ep.is_thinking !== false)
      setSupportsVision(ep.supports_vision === true)
      setCustomTags(ep.custom_thinking_tags || [])
    } else if (prefilledFromEnv) {
      const fetchEnv = async () => {
        try {
          const res = await fetch(`${API_BASE}/api/settings/env-default`)
          const data = res.ok ? await res.json() : {}
          if (data.base_url) setUrl(data.base_url)
          if (data.model) setModel(data.model)
          setIsThinking(settings.is_thinking !== false)
        } catch { /* silent */ }
      }
      fetchEnv()
    }
  }, [editingId, prefilledFromEnv, settings])

  const handleSave = () => {
    onSave({
      id: id.trim().toLowerCase().replace(/\s+/g, '_'),
      url,
      api_key: key,
      model,
      context_window: parseInt(context) || undefined,
      is_thinking: isThinking,
      supports_vision: supportsVision,
      custom_thinking_tags: customTags,
    })
    onCancel()
  }

  // Save tests first: reachable → save; unreachable → inline error with a
  // "Save anyway" escape hatch (the endpoint may just be offline right now).
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // A failed pre-save test goes stale the moment the user edits the fields.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { setSaveError(null) }, [id, url, key, model])

  const handleSaveClick = async () => {
    setSaveError(null)
    setSaving(true)
    try {
      const ok = await onTest(url, key, model, { silent: true })
      if (ok) {
        handleSave()
      } else {
        setSaveError('Endpoint not reachable — fix the URL/key, or save anyway.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/15 dark:bg-black/45 backdrop-blur-[2px] z-[200] flex items-center justify-center p-4 animate-scale-in">
      <div className="bg-[var(--bg)] border border-[var(--border-subtle)] w-full max-w-lg rounded-[16px] shadow-none p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-medium text-[var(--text-heading)]">{mode === 'add' ? 'Add Endpoint' : 'Edit Endpoint'}</h3>
          <button onClick={onCancel} className="flex items-center justify-center w-8 h-8 text-[var(--text-muted)] hover:text-[var(--text-heading)] transition-colors cursor-pointer">
            <X size={15} />
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <input
            placeholder="Base URL"
            value={url}
            onChange={e => setUrl(e.target.value)}
            className="w-full border border-[var(--border-subtle)] rounded-[4px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]"
          />
          <input
            placeholder="API Key"
            type="password"
            value={key}
            onChange={e => setKey(e.target.value)}
            className="w-full border border-[var(--border-subtle)] rounded-[4px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]"
          />
          <input
            placeholder="Name (e.g. OpenAI)"
            value={id}
            onChange={e => setId(e.target.value)}
            className="w-full border border-[var(--border-subtle)] rounded-[4px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]"
          />
          <div className="flex gap-2 min-w-0">
            <input
              placeholder="Model"
              value={model}
              onChange={e => setModel(e.target.value)}
              className="flex-1 min-w-0 border border-[var(--border-subtle)] rounded-[4px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]"
            />
            <input
              placeholder="Context"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={context}
              onChange={e => setContext(e.target.value.replace(/[^0-9]/g, ''))}
              className="w-[140px] border border-[var(--border-subtle)] rounded-[4px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)] shrink-0"
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-[12px] font-medium text-[var(--text-heading)]">Vision input</span>
            <span className="text-[10.5px] text-[var(--text-secondary)]">Mark this endpoint when its model accepts images.</span>
          </div>
          <Toggle
            checked={supportsVision}
            onChange={(next) => setSupportsVision(next)}
            label="Vision input"
          />
        </div>
        <div className="flex flex-col gap-4 border-t border-[var(--border-subtle)]/50 pt-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col">
              <span className="text-[12px] font-medium text-[var(--text-heading)]">Thinking Model</span>
              <span className="text-[10.5px] text-[var(--text-secondary)]">Enable dynamic filtering of thinking/reasoning blocks.</span>
            </div>
            <Toggle
              checked={isThinking}
              onChange={(next) => setIsThinking(next)}
              label="Thinking model"
            />
          </div>
          {isThinking && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col">
                <span className="text-[12px] font-medium text-[var(--text-heading)]">Custom Thinking Tags</span>
                <span className="text-[10.5px] text-[var(--text-secondary)]">Add tag pairs to filter out. Default tags are supported automatically.</span>
              </div>
              {customTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {customTags.map((tag, idx) => (
                    <span key={idx} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[4px] text-[var(--text-heading)] font-mono">
                      <span>{tag.open}</span>
                      <span className="text-[var(--text-muted)]">➔</span>
                      <span>{tag.close}</span>
                      <button
                        type="button"
                        onClick={() => setCustomTags(customTags.filter((_, i) => i !== idx))}
                        className="text-[var(--text-muted)] hover:text-red-500 transition-colors ml-1 font-sans font-bold cursor-pointer"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <AddCustomTagForm
                onAdd={(open, close) => { setCustomTags([...customTags, { open, close }]) }}
              />
            </div>
          )}
        </div>
        {saveError && (
          <p className="text-[12px] leading-relaxed text-red-500">{saveError}</p>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)]/50 pt-3">
          <button onClick={() => { void onTest(url, key, model) }} disabled={!url || testResult.status === 'testing' || saving} className="px-3 py-1.5 text-[12px] bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[8px] hover:border-[var(--text-secondary)] transition-colors disabled:opacity-50 cursor-pointer text-[var(--text)]">
            {testResult.status === 'testing' ? 'Testing...' : 'Test Connection'}
          </button>
          {saveError && (
            <button onClick={handleSave} disabled={!id || !url} className="px-3 py-1.5 text-[12px] bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[8px] hover:border-[var(--text-secondary)] transition-colors disabled:opacity-50 cursor-pointer text-[var(--text)]">
              Save anyway
            </button>
          )}
          <button onClick={() => void handleSaveClick()} disabled={!id || !url || saving} className="px-3 py-1.5 text-[12px] bg-[var(--accent-brown)] text-[var(--text-inverse)] rounded-[8px] hover:bg-[var(--accent-brown-hover)] transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1">
            {saving ? 'Testing…' : mode === 'edit' ? 'Update Endpoint' : 'Save Endpoint'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Token counts are decimal in AI land ("128K context", "1M context") —
// never binary. parseFloat trims the trailing ".0" (1M, 8.2K).
function formatCtx(cw: number): string {
  if (cw >= 1_000_000) return `${parseFloat((cw / 1_000_000).toFixed(1))}M`
  if (cw >= 1000) return `${parseFloat((cw / 1000).toFixed(1))}K`
  return `${cw}`
}

export function EndpointsSettings({ settings, updateSettings, query }: { settings: AppSettings, updateSettings: (u: Partial<AppSettings>) => void, query: string }) {  const [editingId, setEditingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ status: 'idle' | 'testing' | 'success' | 'error', msg?: string }>({ status: 'idle' })
  const [prefilledFromEnv, setPrefilledFromEnv] = useState(false)
  const [envDefault, setEnvDefault] = useState<{ base_url: string; model: string; from_env: { base_url: boolean; model: boolean } } | null>(null)
  const [showEndpointDialog, setShowEndpointDialog] = useState(false)
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add')

  useEffect(() => {
    fetch(`${API_BASE}/api/settings/env-default`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setEnvDefault(data) })
      .catch(() => { /* import button simply stays hidden */ })
  }, [])

  const openAddDialog = () => {
    setDialogMode('add')
    setEditingId(null)
    setPrefilledFromEnv(false)
    setShowEndpointDialog(true)
  }

  const openEditDialog = (id: string) => {
    setDialogMode('edit')
    setEditingId(id)
    setPrefilledFromEnv(false)
    setShowEndpointDialog(true)
  }

  const openEnvAsNewDialog = async () => {
    try {
      await fetch(`${API_BASE}/api/settings/env-default`)
      setDialogMode('add')
      setEditingId(null)
      setPrefilledFromEnv(true)
      setShowEndpointDialog(true)
    } catch {
      toast.error('Could not load .env defaults.')
    }
  }

  const closeDialog = () => {
    setShowEndpointDialog(false)
    setEditingId(null)
    setPrefilledFromEnv(false)
  }

  const handleSave = (data: { id: string; url: string; api_key: string; model: string; context_window?: number; is_thinking: boolean; supports_vision: boolean; custom_thinking_tags: Array<{ open: string; close: string }> }) => {
    const epId = data.id.trim().toLowerCase().replace(/\s+/g, '_')
    if (prefilledFromEnv && !editingId && settings.endpoints?.[epId]) {
      toast.error(`“${epId}” already exists — pick a different name for the .env copy.`)
      return
    }
    const updatedEndpoints = {
      ...settings.endpoints,
      [epId]: {
        url: data.url,
        api_key: data.api_key,
        model: data.model,
        context_window: data.context_window,
        is_thinking: data.is_thinking,
        supports_vision: data.supports_vision,
        custom_thinking_tags: data.custom_thinking_tags,
      },
    }
    if (editingId && editingId !== epId) {
      delete updatedEndpoints[editingId]
    }
    updateSettings({
      endpoints: updatedEndpoints,
      active_endpoint: prefilledFromEnv && !editingId ? epId : (settings.active_endpoint === editingId ? epId : settings.active_endpoint),
    })
  }

  // Returns reachability (endpoint/auth works). Model/probe warnings never
  // block — the probe can reject models that are actually valid. `silent`
  // skips toasts for the pre-save check, which reports inline instead.
  const handleTest = async (url: string, key: string, model?: string, opts?: { silent?: boolean }): Promise<boolean> => {
    const notify = opts?.silent
      ? { success: () => {}, error: () => {} }
      : toast
    setTestResult({ status: 'testing' })
    try {
      const res = await fetch(`${API_BASE}/api/settings/test-endpoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, api_key: key, model: model?.trim() || undefined })
      })
      if (!res.ok) {
        let detail = 'Endpoint not reachable'
        try {
          const err = await res.json()
          if (err?.detail) detail = `Not reachable — ${err.detail}`
        } catch { /* keep default */ }
        throw new Error(detail)
      }
      const data = await res.json()
      setTestResult({ status: 'idle' })
      const count = data.model_count ?? data.models?.data?.length ?? 0
      notify.success(`Reachable — endpoint/auth works (${count} models).`)
      const wanted = (model || '').trim()
      if (wanted) {
        if (data.model_found === false) {
          notify.error(`Model not found — "${wanted}" not in /models. Probe skipped.`)
        } else if (data.model_found === true) {
          if (data.probe?.ok) {
            notify.success(`Probe passed — "${wanted}" accepted a completion.`)
          } else if (data.probe) {
            notify.error(`Probe failed — model listed but completion rejected (${data.probe.status ?? 'error'}). It may still be valid.`)
          }
        }
      }
      return true
    } catch (e) {
      setTestResult({ status: 'idle' })
      notify.error((e as Error).message)
      return false
    }
  }

  const endpointCount = Object.keys(settings.endpoints || {}).length

  return (
    <div className="flex flex-col gap-4">
      <FilterSection query={query} keywords="endpoint url model key test">
        <section>
          <SectionLabel description="Manage the LLM routing endpoints. Pick the active one from the assistant panel.">Endpoints</SectionLabel>
          <p className="text-[11px] text-[var(--text-muted)] mb-2">{endpointCount} endpoint{endpointCount !== 1 ? 's' : ''}</p>
          <div className="border border-[var(--border-subtle)] rounded-[12px] overflow-hidden">
            <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,1fr)_52px_56px] gap-0 bg-[var(--bg-elevated)]/60 border-b border-[var(--border-subtle)]">
              <div className="px-3 py-2 text-[10.5px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Name</div>
              <div className="px-3 py-2 text-[10.5px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Host</div>
              <div className="px-3 py-2 text-[10.5px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Model</div>
              <div className="px-2 py-2 text-[10.5px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Ctx</div>
              <div className="px-2 py-2" />
            </div>
            {Object.entries(settings.endpoints || {}).length === 0 && (
              <p className="text-[12px] text-[var(--text-secondary)] px-3 py-3 text-center">No endpoints yet — add one below.</p>
            )}
            {Object.entries(settings.endpoints || {}).map(([id, ep]) => (
              <div
                key={id}
                className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,1fr)_52px_56px] gap-0 items-center border-b border-[var(--border-subtle)]/60 last:border-b-0 transition-colors hover:bg-[var(--bg-hover)]/40 group"
              >
                <div className="px-3 py-2.5 min-w-0">
                  <span className="flex items-center gap-1.5 min-w-0 text-[13px] font-medium text-[var(--text-heading)] capitalize">
                    <span className="truncate" title={id.replace('_', ' ')}>{id.replace('_', ' ')}</span>
                    {ep.supports_vision && (
                      <span title="Supports image input" className="flex shrink-0 text-[var(--text-secondary)]">
                        <Eye size={13} />
                      </span>
                    )}
                    {ep.is_thinking !== false ? (
                      <span title="Thinking enabled" className="flex shrink-0 text-[var(--text-secondary)]">
                        <Brain size={13} />
                      </span>
                    ) : (
                      <span title="Thinking disabled" className="flex shrink-0 text-[var(--text-muted)] opacity-50">
                        <Brain size={13} />
                      </span>
                    )}
                  </span>
                </div>
                <div className="px-3 py-2.5 min-w-0"><span className="block text-[12px] text-[var(--text-secondary)] truncate" title={ep.url}>{ep.url}</span></div>
                <div className="px-3 py-2.5 min-w-0"><span className="block text-[12px] text-[var(--text-secondary)] truncate" title={ep.model || '—'}>{ep.model || '—'}</span></div>
                <div className="px-2 py-2.5"><span className="text-[12px] text-[var(--text-secondary)] whitespace-nowrap" title={ep.context_window ? `${ep.context_window.toLocaleString()} tokens` : undefined}>{ep.context_window ? formatCtx(ep.context_window) : '—'}</span></div>
                <div className="px-2 py-2.5">
                  <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => openEditDialog(id)}
                      title={`Edit ${id}`}
                      className="flex items-center justify-center w-6 h-6 text-[var(--text-secondary)]/60 hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] rounded-[4px] transition-all cursor-pointer"
                    >
                      <Pencil className="w-3 h-3" strokeWidth={2} />
                    </button>
                    <button
                      onClick={() => {
                        const newEps = { ...settings.endpoints }
                        delete newEps[id]
                        updateSettings({ endpoints: newEps, active_endpoint: settings.active_endpoint === id ? null : settings.active_endpoint })
                      }}
                      title={`Delete ${id}`}
                      className="flex items-center justify-center w-6 h-6 text-[var(--text-secondary)]/60 hover:text-red-500 hover:bg-[var(--bg-hover)] rounded-[4px] transition-all cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" strokeWidth={2} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end mt-1 gap-1">
            {(envDefault?.from_env.base_url || envDefault?.from_env.model) && (
              <button
                onClick={() => void openEnvAsNewDialog()}
                title="Import .env values as a new endpoint"
                className="flex items-center gap-1 px-2 py-1 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-heading)] transition-colors cursor-pointer"
              >
                <Download size={13} /> Import from .env
              </button>
            )}
            <button
              onClick={openAddDialog}
              className="flex items-center gap-1 px-2 py-1 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-heading)] transition-colors cursor-pointer"
            >
              <Plus size={13} /> Add endpoint
            </button>
          </div>
        </section>
      </FilterSection>

      {showEndpointDialog && (
        <EndpointDialogForSave
          mode={dialogMode}
          prefilledFromEnv={prefilledFromEnv}
          editingId={editingId}
          settings={settings}
          onSave={handleSave}
          onCancel={closeDialog}
          onTest={handleTest}
          testResult={testResult}
        />
      )}
    </div>
  )
}
