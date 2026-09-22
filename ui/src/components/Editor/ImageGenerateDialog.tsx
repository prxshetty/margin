import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditorStore } from '../../stores/editorStore'
import { useImageGenStore } from '../../stores/imageGenStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { toast } from '../../stores/toastStore'
import { generateImage, insertStoredImageAt } from '../../lib/media'
import { Dropdown } from '../Dropdown'

const BUILTIN_STYLE_NAMES = ['None', 'Cinematic', 'Illustration']

export function imageStyleOptions(
  customs: { name: string; prompt: string }[] | undefined,
  deleted?: string[] | undefined,
): string[] {
  const hidden = (deleted ?? []).map((d) => d.toLowerCase())
  const names = BUILTIN_STYLE_NAMES.filter((n) => !hidden.includes(n.toLowerCase()))
  for (const c of customs ?? []) {
    const n = (c?.name || '').trim()
    if (n && !names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n)
  }
  return names
}

export function ImageGenerateDialogHost() {
  const dialog = useImageGenStore((s) => s.dialog)
  if (!dialog) return null
  return <ImageGenerateDialog key={dialog.anchorPos ?? 0} />
}

// Slash-entry dialog for fresh images only (empty start, required prompt).
// Imagine from a text selection uses the bubble's inline morph instead,
// and Imagine again uses the image pill's input bar — both require typed
// content, so this dialog never deals with references.
function ImageGenerateDialog() {
  const dialog = useImageGenStore((s) => s.dialog)
  const closeDialog = useImageGenStore((s) => s.closeDialog)
  const settings = useSettingsStore((s) => s.settings)
  const setShowSettings = useSettingsStore((s) => s.setShowSettings)

  const [prompt, setPrompt] = useState(dialog?.initialPrompt ?? '')
  const options = useMemo(
    () => imageStyleOptions(settings?.image_custom_styles, settings?.image_deleted_styles),
    [settings?.image_custom_styles, settings?.image_deleted_styles],
  )
  const defaultStyle = settings?.image_default_style ?? 'None'
  const [styleName, setStyleName] = useState(
    defaultStyle && options.some((o) => o.toLowerCase() === String(defaultStyle).toLowerCase())
      ? options.find((o) => o.toLowerCase() === String(defaultStyle).toLowerCase())!
      : 'None',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const cancelledRef = useRef(false)
  // Captured once per mount (the host remounts per dialog via `key`) so a
  // mid-generation file switch drops the insert instead of landing the
  // image in the wrong document.
  const fileAtStartRef = useRef<string | null>(useEditorStore.getState().currentFilePath)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  if (!dialog) return null
  const canSubmit = !busy && prompt.trim().length > 0

  const handleCancel = () => {
    if (busy) {
      cancelledRef.current = true
      abortRef.current?.abort()
    }
    closeDialog()
  }

  const handleGenerate = async () => {
    const editor = useEditorStore.getState().editor
    if (!editor || editor.isDestroyed || busy) return
    // Empty never submits — the button is disabled, so this is a guard.
    if (!prompt.trim()) return
    setBusy(true)
    setError(null)
    cancelledRef.current = false
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const { path } = await generateImage({
        prompt: prompt.trim(),
        styleName: styleName === 'None' ? null : styleName,
        referencePath: null,
        signal: ctrl.signal,
      })
      if (cancelledRef.current || ctrl.signal.aborted) return
      if (editor.isDestroyed) return
      if (useEditorStore.getState().currentFilePath !== fileAtStartRef.current) {
        console.warn('Margin: image target file changed mid-generation — dropping image')
        return
      }
      const anchor = dialog.anchorPos ?? editor.state.selection.to
      // Fixed alt: deriving it from the prompt sliced raw text (mid-word
      // cuts, newlines, Markdown-significant chars) into the image markup.
      insertStoredImageAt(editor, anchor, path, 'generated image')
      // Runs are recorded server-side (prompt, seed, asset) and viewable in
      // Settings → Images → Recent generations — the dialog stays minimal.
      closeDialog()
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      const msg = err instanceof Error ? err.message : 'Image generation failed'
      setError(msg)
      toast.error(msg)
    } finally {
      if (!cancelledRef.current) setBusy(false)
      abortRef.current = null
    }
  }

  return (
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/25 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) closeDialog()
      }}
    >
      <div className="w-full max-w-md rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 shadow-xl">
        <h3 className="text-[14px] font-medium text-[var(--text-heading)]">
          Imagine
        </h3>
        <label className="mt-4 block text-[12px] font-medium text-[var(--text-secondary)]">
          Describe the image you want
        </label>
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void handleGenerate()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              handleCancel()
            }
            e.stopPropagation()
          }}
          rows={4}
          placeholder="A cozy cabin in a snowy forest…"
          disabled={busy}
          className="mt-1.5 w-full resize-y rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text-secondary)] disabled:opacity-60"
        />
        <label className="mt-3 block text-[12px] font-medium text-[var(--text-secondary)]">Style</label>
        <Dropdown
          value={styleName}
          onChange={setStyleName}
          disabled={busy}
          options={options.map((n) => ({ value: n, label: n }))}
          rootClassName="mt-1.5"
          portal
          searchable
          searchPlaceholder="Search styles..."
        />
        <button
          type="button"
          onClick={() => {
            if (!busy) closeDialog()
            setShowSettings(true)
          }}
          className="mt-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline underline-offset-2 cursor-pointer"
        >
          Manage styles in Settings
        </button>
        {error && (
          <p className="mt-3 text-[12px] leading-relaxed text-red-500">{error}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-[6px] border border-[var(--border-subtle)] px-3.5 py-1.5 text-[12.5px] text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:border-[var(--text-secondary)] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={!canSubmit}
            className="rounded-[6px] bg-[var(--accent-brown)] px-4 py-1.5 text-[12.5px] font-medium text-[var(--text-inverse)] hover:bg-[var(--accent-brown-hover)] transition-colors disabled:opacity-50 cursor-pointer"
          >
            {busy ? 'Imagining…' : 'Imagine ✦'}
          </button>
        </div>
      </div>
    </div>
  )
}
