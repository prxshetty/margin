import { useState, useEffect, useRef } from 'react'
import { X, Plus, Trash2, Check, Pencil, RotateCcw, Upload, Loader2 } from 'lucide-react'
import openaiLogoRaw from '../../../../assets/imagine/openai.svg?raw'
import stabilityLogoRaw from '../../../../assets/imagine/stability-ai.svg?raw'
import falLogoRaw from '../../../../assets/imagine/fal-ai.svg?raw'
import googleLogoRaw from '../../../../assets/imagine/google.svg?raw'
import comfyuiLogoRaw from '../../../../assets/imagine/comfyui.svg?raw'
import type { AppSettings } from '../../stores/settingsStore'
import { API_BASE } from '../../lib/api'
import { toast } from '../../stores/toastStore'
import { Dropdown } from '../Dropdown'
import { FilterSection, SectionLabel } from './shared'
const IMAGE_PROVIDERS = [
  { id: 'openai-compatible', label: 'OpenAI-compatible' },
  { id: 'stability', label: 'Stability' },
  { id: 'fal', label: 'FAL' },
  { id: 'gemini', label: 'Google' },
  { id: 'comfyui', label: 'ComfyUI' },
] as const

// Inlined so every mark renders monochrome in the theme text color —
// the fill rule below overrides brand/traced fills (CSS beats presentation
// attributes). Uniform 16px box; each SVG scales via its own viewBox.
// No tile, no border — minimal.

// Inlined so every mark renders monochrome in the theme text color —
// the fill rule below overrides brand/traced fills (CSS beats presentation
// attributes). Uniform 16px box; each SVG scales via its own viewBox.
// No tile, no border — minimal.
const IMAGE_PROVIDER_LOGOS: Record<string, string> = {
  'openai-compatible': openaiLogoRaw,
  stability: stabilityLogoRaw,
  fal: falLogoRaw,
  gemini: googleLogoRaw,
  comfyui: comfyuiLogoRaw,
}

function ProviderLogo({ provider }: { provider: string }) {
  const svg = IMAGE_PROVIDER_LOGOS[provider]
  if (!svg) return null
  return (
    <span
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
      className="shrink-0 flex items-center text-[var(--text-secondary)] [&>svg]:w-4 [&>svg]:h-4 [&>svg_*]:fill-current"
    />
  )
}

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

  return (
    <div className="rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-medium text-[var(--text-heading)]">{title}</div>
        <div className="flex items-center gap-0.5 shrink-0">
          {savedWorkflow && (
            <button
              onClick={handleClear}
              title="Clear workflow"
              className="flex items-center justify-center w-6 h-6 text-[var(--text-secondary)]/60 hover:text-red-500 hover:bg-[var(--bg-hover)] rounded-[4px] transition-all cursor-pointer"
            >
              <Trash2 className="w-3 h-3" strokeWidth={2} />
            </button>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            title={savedWorkflow ? 'Re-import workflow' : 'Import workflow'}
            className="flex items-center justify-center w-6 h-6 text-[var(--text-secondary)]/60 hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] rounded-[4px] transition-all cursor-pointer disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload className="w-3 h-3" strokeWidth={2} />}
          </button>
        </div>
      </div>
      {!savedWorkflow && !busy && (
        <p className="text-[11px] text-[var(--text-muted)] mt-1">API format JSON (ComfyUI export).</p>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      {importError && <p className="text-[11px] text-red-500 mt-2">{importError}</p>}
      {(options.length > 0 || nodeCount != null) && (
        <ComfyMappingField
          label="Prompt input"
          tag="required"
          value={picked}
          placeholder="Pick the positive-prompt input…"
          options={options}
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
          onPick={handlePickSeed}
        />
      )}
    </div>
  )
}

function ComfyMappingField({ label, tag, value, placeholder, options, onPick }: {
  label: string
  tag?: 'required' | 'optional'
  value: string
  placeholder: string
  options: { value: string; label: string }[]
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
      <Dropdown
        value={value}
        onChange={onPick}
        options={[{ value: '', label: placeholder }, ...options]}
        portal
        searchable
        searchPlaceholder="Search inputs..."
      />
    </div>
  )
}

function StyleDialogForSave({
  mode,
  initialName,
  initialPrompt,
  nameLocked,
  onSave,
  onCancel,
}: {
  mode: 'add' | 'edit'
  initialName: string
  initialPrompt: string
  nameLocked: boolean
  onSave: (name: string, prompt: string) => boolean
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName)
  const [prompt, setPrompt] = useState(initialPrompt)

  const handleSave = () => {
    if (onSave(name.trim(), prompt.trim())) onCancel()
  }

  return (
    <div className="fixed inset-0 bg-black/15 dark:bg-black/45 backdrop-blur-[2px] z-[200] flex items-center justify-center p-4 animate-scale-in">
      <div className="bg-[var(--bg)] border border-[var(--border-subtle)] w-full max-w-lg rounded-[16px] shadow-none p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-medium text-[var(--text-heading)]">{mode === 'add' ? 'Add Style' : 'Edit Style'}</h3>
          <button onClick={onCancel} className="flex items-center justify-center w-8 h-8 text-[var(--text-muted)] hover:text-[var(--text-heading)] transition-colors cursor-pointer">
            <X size={15} />
          </button>
        </div>
        {nameLocked ? (
          <div className="text-[13px] font-medium text-[var(--text-heading)]">
            {initialName}
            <span className="ml-1.5 text-[10px] font-normal text-[var(--text-muted)]">· built-in</span>
          </div>
        ) : (
          <input
            placeholder="Name (e.g. Fantasy)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-[var(--border-subtle)] rounded-[4px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]"
          />
        )}
        <div className="relative">
          <textarea
            placeholder="Style prompt (appended to the generation prompt)"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            className="w-full border border-[var(--border-subtle)] rounded-[4px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)] resize-y leading-relaxed"
          />
          <span className="absolute bottom-2 right-6 text-[10px] text-[var(--text-muted)] pointer-events-none">
            {prompt.length}
          </span>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)]/50 pt-3">
          <button
            onClick={handleSave}
            disabled={!prompt.trim() || (!nameLocked && !name.trim())}
            className="px-3 py-1.5 text-[12px] bg-[var(--accent-brown)] text-[var(--text-inverse)] rounded-[8px] hover:bg-[var(--accent-brown-hover)] transition-colors disabled:opacity-50 cursor-pointer"
          >
            {mode === 'add' ? 'Add style' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ImageEndpointDialog({
  mode,
  initial,
  settings,
  updateSettings,
  onSave,
  onCancel,
  onTest,
  testResult,
}: {
  mode: 'add' | 'edit'
  initial: { name: string; provider: string; base_url: string; api_key: string; model: string }
  settings: AppSettings
  updateSettings: (u: Partial<AppSettings>) => void
  onSave: (data: { id: string; provider: string; base_url: string; api_key: string; model: string }) => boolean
  onCancel: () => void
  onTest: (provider: string, base_url: string, api_key: string, model: string) => void
  testResult: { status: 'idle' | 'testing' | 'success' | 'error', msg?: string }
}) {
  const [name, setName] = useState(initial.name)
  const [provider, setProvider] = useState(initial.provider)
  const [baseUrl, setBaseUrl] = useState(initial.base_url)
  const [apiKey, setApiKey] = useState(initial.api_key)
  const [model, setModel] = useState(initial.model)
  const isComfy = provider === 'comfyui'
  const isGemini = provider === 'gemini'

  const handleSave = () => {
    if (onSave({
      id: name.trim().toLowerCase().replace(/\s+/g, '_'),
      provider,
      base_url: baseUrl.trim(),
      api_key: apiKey,
      model: model.trim(),
    })) onCancel()
  }

  return (
    <div className="fixed inset-0 bg-black/15 dark:bg-black/45 backdrop-blur-[2px] z-[200] flex items-center justify-center p-4 animate-scale-in">
      <div className="bg-[var(--bg)] border border-[var(--border-subtle)] w-full max-w-lg rounded-[16px] shadow-none p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-medium text-[var(--text-heading)]">{mode === 'add' ? 'Add Provider' : 'Edit Provider'}</h3>
          <button onClick={onCancel} className="flex items-center justify-center w-8 h-8 text-[var(--text-muted)] hover:text-[var(--text-heading)] transition-colors cursor-pointer">
            <X size={15} />
          </button>
        </div>
        <div className="flex flex-col gap-3">
          {mode === 'add' ? (
            <Dropdown
              value={provider}
              onChange={(v) => {
                if (v === provider) return
                setProvider(v)
                // A base URL is never valid across providers — drop the stale
                // value instead of sending the new provider to the old address.
                setBaseUrl('')
                setApiKey('')
                setModel('')
              }}
              options={IMAGE_PROVIDERS.map((p) => ({ value: p.id, label: p.label, icon: <ProviderLogo provider={p.id} /> }))}
              portal
            />
          ) : (
            <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--text-heading)]">
              <ProviderLogo provider={provider} />
              {IMAGE_PROVIDERS.find((p) => p.id === provider)?.label ?? provider}
            </div>
          )}
          <input
            placeholder="Name (e.g. Google)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-[var(--border-subtle)] rounded-[4px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]"
          />
          {/* Empty = provider default (shown as placeholder) — set only to
              point at a proxy, mock, or local instance. */}
          <input
            placeholder={isComfy ? 'ComfyUI URL (e.g. http://127.0.0.1:8188)' : isGemini ? 'Default: https://generativelanguage.googleapis.com/v1beta' : 'Base URL (e.g. https://api.openai.com)'}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="w-full border border-[var(--border-subtle)] rounded-[4px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]"
          />
          {!isComfy && (
            <>
              <input
                placeholder="API key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full border border-[var(--border-subtle)] rounded-[4px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]"
              />
              <input
                placeholder={isGemini ? 'Model (e.g. gemini-3.1-flash-lite-image)' : 'Model (e.g. gpt-image-1)'}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full border border-[var(--border-subtle)] rounded-[4px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]"
              />
            </>
          )}
        </div>
        {isComfy && (
          <div className="flex flex-col gap-3 border-t border-[var(--border-subtle)]/50 pt-3">
            <ComfySlotSection slot="text" settings={settings} updateSettings={updateSettings} />
            <ComfySlotSection slot="edit" settings={settings} updateSettings={updateSettings} />
          </div>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)]/50 pt-3">
          <button onClick={() => onTest(provider, baseUrl, apiKey, model)} disabled={testResult.status === 'testing'} className="px-3 py-1.5 text-[12px] bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[8px] hover:border-[var(--text-secondary)] transition-colors disabled:opacity-50 cursor-pointer text-[var(--text)]">
            {testResult.status === 'testing' ? 'Testing...' : 'Test provider'}
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || (!baseUrl.trim() && !apiKey && !model.trim())}
            className="px-3 py-1.5 text-[12px] bg-[var(--accent-brown)] text-[var(--text-inverse)] rounded-[8px] hover:bg-[var(--accent-brown-hover)] transition-colors disabled:opacity-50 cursor-pointer"
          >
            {mode === 'add' ? 'Save Provider' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ImagesSettings({ settings, updateSettings, query }: { settings: AppSettings, updateSettings: (u: Partial<AppSettings>) => void, query: string }) {
  const [builtinPrompts, setBuiltinPrompts] = useState<Record<string, string | null> | null>(null)
  const [styleDialog, setStyleDialog] = useState<{ mode: 'add' | 'edit'; name: string } | null>(null)
  const [imageDialog, setImageDialog] = useState<{ mode: 'add' | 'edit'; id: string } | null>(null)
  const [providerTest, setProviderTest] = useState<{ status: 'idle' | 'testing' | 'success' | 'error', msg?: string }>({ status: 'idle' })
  const customs = settings.image_custom_styles || []
  const defaultStyle = settings.image_default_style ?? 'None'
  const deletedStyles = settings.image_deleted_styles || []

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
  const imageEntries = settings.image_endpoints || {}
  const activeImageId = settings.active_image_endpoint ?? null
  const imageProviderLabel = (id: string) => IMAGE_PROVIDERS.find((p) => p.id === id)?.label ?? id

  const handleProviderTest = async (provider: string, base_url: string, api_key: string, model: string) => {
    setProviderTest({ status: 'testing' })
    try {
      const res = await fetch(`${API_BASE}/api/settings/test-image-provider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, base_url, api_key, model }),
      })
      if (!res.ok) {
        let detail = 'Test failed'
        try {
          const data = await res.json()
          if (data?.detail) detail = data.detail
        } catch { /* ignore */ }
        throw new Error(detail)
      }
      setProviderTest({ status: 'idle' })
      toast.success('Image provider reachable.')
    } catch (e) {
      setProviderTest({ status: 'idle' })
      toast.error(e instanceof Error ? e.message : 'Image provider test failed.')
    }
  }

  const handleSaveImageEntry = (data: { id: string; provider: string; base_url: string; api_key: string; model: string }): boolean => {
    const editingId = imageDialog?.mode === 'edit' ? imageDialog.id : null
    if (!data.id) {
      toast.error('Give the provider a name.')
      return false
    }
    if (data.id !== editingId && imageEntries[data.id]) {
      toast.error(`“${data.id}” already exists.`)
      return false
    }
    const next = {
      ...imageEntries,
      [data.id]: { provider: data.provider, base_url: data.base_url, api_key: data.api_key, model: data.model },
    }
    if (editingId && editingId !== data.id) delete next[editingId]
    updateSettings({
      image_endpoints: next,
      active_image_endpoint: activeImageId === editingId ? data.id : (activeImageId ?? data.id),
    })
    return true
  }

  const promptFor = (name: string): string => {
    const custom = customs.find((c) => c.name === name)
    if (custom) return custom.prompt ?? ''
    if (name === 'None') return ''
    return (settings.image_style_overrides || {})[name] ?? builtinPrompts?.[name] ?? ''
  }

  const handleSaveStyle = (name: string, prompt: string): boolean => {
    if (!styleDialog) return false
    if (styleDialog.mode === 'add') {
      if (allStyleNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
        toast.error(`“${name}” already exists.`)
        return false
      }
      updateSettings({ image_custom_styles: [...customs, { name, prompt }] })
      return true
    }
    if (customs.some((c) => c.name === styleDialog.name)) {
      updateSettings({
        image_custom_styles: customs.map((x) =>
          x.name === styleDialog.name ? { ...x, prompt } : x),
      })
    } else {
      updateSettings({
        image_style_overrides: {
          ...(settings.image_style_overrides || {}),
          [styleDialog.name]: prompt,
        },
      })
    }
    return true
  }

  const allStyleNames = [
    ...IMAGE_BUILTIN_STYLES.filter((n) => !deletedStyles.some((d) => d.toLowerCase() === n.toLowerCase())),
    ...customs.map((c) => c.name),
  ]
  const deletedBuiltins = IMAGE_BUILTIN_STYLES.filter(
    (n) => n !== 'None' && deletedStyles.some((d) => d.toLowerCase() === n.toLowerCase()),
  )

  return (
    <div className="flex flex-col gap-6">
      <FilterSection query={query} keywords="image provider base url key model">
        <section>
          <SectionLabel description="Providers for Imagine and Imagine again. Click a row to select it.">Providers</SectionLabel>
          <p className="text-[11px] text-[var(--text-muted)] mb-2">
            {Object.keys(imageEntries).length} provider{Object.keys(imageEntries).length !== 1 ? 's' : ''}
          </p>
          <div className="border border-[var(--border-subtle)] rounded-[12px] overflow-hidden">
            <div className="grid grid-cols-[28px_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)_56px] gap-0 bg-[var(--bg-elevated)]/60 border-b border-[var(--border-subtle)]">
              <div className="px-2 py-2" />
              <div className="px-3 py-2 text-[10.5px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Name</div>
              <div className="px-3 py-2 text-[10.5px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Provider</div>
              <div className="px-3 py-2 text-[10.5px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Model</div>
              <div className="px-2 py-2" />
            </div>
            {Object.entries(imageEntries).length === 0 && (
              <p className="text-[12px] text-[var(--text-secondary)] px-3 py-3 text-center">No providers yet — add one below.</p>
            )}
            {Object.entries(imageEntries).map(([id, entry]) => (
              <div
                key={id}
                onClick={() => updateSettings({ active_image_endpoint: id })}
                className={`grid grid-cols-[28px_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)_56px] gap-0 items-center border-b border-[var(--border-subtle)]/60 last:border-b-0 cursor-pointer transition-colors ${activeImageId === id ? 'bg-[var(--bg-elevated)]/40' : 'hover:bg-[var(--bg-hover)]/40'} group`}
              >
                <div className="px-2 py-2.5">
                  {activeImageId === id && <Check size={15} className="text-[var(--accent-brown)]" />}
                </div>
                <div className="px-3 py-2.5 min-w-0">
                  <span className="block text-[13px] font-medium text-[var(--text-heading)] truncate" title={id}>{id}</span>
                </div>
                <div className="px-3 py-2.5 min-w-0">
                  <span className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)] truncate" title={imageProviderLabel(entry.provider)}>
                    <ProviderLogo provider={entry.provider} />
                    <span className="truncate">{imageProviderLabel(entry.provider)}</span>
                  </span>
                </div>
                <div className="px-3 py-2.5 min-w-0">
                  <span className="block text-[12px] text-[var(--text-secondary)] truncate" title={entry.model || '—'}>{entry.model || '—'}</span>
                </div>
                <div className="px-2 py-2.5">
                  <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setImageDialog({ mode: 'edit', id })}
                      title={`Edit ${id}`}
                      className="flex items-center justify-center w-6 h-6 text-[var(--text-secondary)]/60 hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] rounded-[4px] transition-all cursor-pointer"
                    >
                      <Pencil className="w-3 h-3" strokeWidth={2} />
                    </button>
                    <button
                      onClick={() => {
                        const next = { ...imageEntries }
                        delete next[id]
                        updateSettings({ image_endpoints: next, active_image_endpoint: activeImageId === id ? null : activeImageId })
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
          <div className="flex justify-end mt-1">
            <button
              onClick={() => setImageDialog({ mode: 'add', id: '' })}
              className="flex items-center gap-1 px-2 py-1 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-heading)] transition-colors cursor-pointer"
            >
              <Plus size={13} /> Add provider
            </button>
          </div>
          {imageDialog && (
            <ImageEndpointDialog
              mode={imageDialog.mode}
              initial={imageDialog.mode === 'edit' && imageEntries[imageDialog.id]
                ? { name: imageDialog.id, ...imageEntries[imageDialog.id] }
                : { name: '', provider: 'openai-compatible', base_url: '', api_key: '', model: '' }}
              settings={settings}
              updateSettings={updateSettings}
              onSave={handleSaveImageEntry}
              onCancel={() => setImageDialog(null)}
              onTest={handleProviderTest}
              testResult={providerTest}
            />
          )}
        </section>
      </FilterSection>

      <FilterSection query={query} keywords="styles style custom default prompt">
        <section>
          <SectionLabel description="Extra direction appended to the image prompt for the style you pick.">Styles</SectionLabel>
          <div className="border border-[var(--border-subtle)] rounded-[12px] divide-y divide-[var(--border-subtle)]/60 mb-3 overflow-hidden">
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
            const isDefault = (defaultStyle ?? 'None') === name
            return (
              <div key={name} className="px-2.5 py-2 group">
                <div className="flex items-center gap-2">
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => updateSettings({ image_default_style: name === 'None' ? null : name })}
                  >
                    <div className="text-[12.5px] font-medium text-[var(--text-heading)] truncate">
                      {name}
                      {overridden ? (
                        <span className="ml-1.5 text-[10px] font-normal text-[var(--text-muted)]">
                          · customized
                        </span>
                      ) : null}
                    </div>
                    <div
                      className="text-[11px] text-[var(--text-muted)] truncate"
                    >
                      {name === 'None' ? 'No style suffix — nothing is appended.' : (prompt || '—')}
                    </div>
                  </div>
                  {isDefault && <Check size={13} className="shrink-0 text-[var(--accent-brown)]" />}
                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    {name !== 'None' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setStyleDialog({ mode: 'edit', name }) }}
                        title={`Edit ${name}`}
                        className="flex items-center justify-center w-6 h-6 text-[var(--text-secondary)]/60 hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] rounded-[4px] transition-all cursor-pointer"
                      >
                        <Pencil className="w-3 h-3" strokeWidth={2} />
                      </button>
                    )}
                    {overridden && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          const next = { ...(settings.image_style_overrides || {}) }
                          delete next[name]
                          updateSettings({ image_style_overrides: next })
                        }}
                        title={`Reset ${name} to default`}
                        className="flex items-center justify-center w-6 h-6 text-[var(--text-secondary)]/60 hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] rounded-[4px] transition-all cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" strokeWidth={2} />
                      </button>
                    )}
                    {name !== 'None' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteStyle(name, isBuiltin) }}
                        title={`Delete ${name}`}
                        className="flex items-center justify-center w-6 h-6 text-[var(--text-secondary)]/60 hover:text-red-500 hover:bg-[var(--bg-hover)] rounded-[4px] transition-all cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" strokeWidth={2} />
                      </button>
                    )}
                  </div>
                </div>
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
        <div className="flex justify-end mt-1">
          <button
            onClick={() => setStyleDialog({ mode: 'add', name: '' })}
            className="flex items-center gap-1 px-2 py-1 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-heading)] transition-colors cursor-pointer"
          >
            <Plus size={13} /> Add style
          </button>
        </div>
        {styleDialog && (
          <StyleDialogForSave
            mode={styleDialog.mode}
            initialName={styleDialog.mode === 'add' ? '' : styleDialog.name}
            initialPrompt={styleDialog.mode === 'add' ? '' : promptFor(styleDialog.name)}
            nameLocked={styleDialog.mode === 'edit'}
            onSave={handleSaveStyle}
            onCancel={() => setStyleDialog(null)}
          />
        )}
        </section>
      </FilterSection>
    </div>
  )
}
