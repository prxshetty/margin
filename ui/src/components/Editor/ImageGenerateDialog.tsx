import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditorStore } from '../../stores/editorStore'
import { useImageGenStore } from '../../stores/imageGenStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { generateImage, insertStoredImageAt, toDisplaySrc } from '../../lib/media'

const BUILTIN_STYLE_NAMES = ['None', 'Cinematic', 'Illustration']

function styleOptions(customs: { name: string; prompt: string }[] | undefined): string[] {
  const names = [...BUILTIN_STYLE_NAMES]
  for (const c of customs ?? []) {
    const n = (c?.name || '').trim()
    if (n && !names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n)
  }
  return names
}

export function ImageGenerateDialogHost() {
  const dialog = useImageGenStore((s) => s.dialog)
  if (!dialog) return null
  return <ImageGenerateDialog key={`${dialog.referenceSrc ?? 'new'}-${dialog.anchorPos ?? 0}`} />
}

function ImageGenerateDialog() {
  const dialog = useImageGenStore((s) => s.dialog)
  const closeDialog = useImageGenStore((s) => s.closeDialog)
  const settings = useSettingsStore((s) => s.settings)
  const setShowSettings = useSettingsStore((s) => s.setShowSettings)

  const [prompt, setPrompt] = useState(dialog?.initialPrompt ?? '')
  const options = useMemo(
    () => styleOptions(settings?.image_custom_styles),
    [settings?.image_custom_styles],
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
  const isRegen = dialog.referenceSrc != null
  const canSubmit = !busy && (prompt.trim().length > 0 || isRegen)

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
    if (!prompt.trim() && !isRegen) {
      setError('Describe the image you want.')
      return
    }
    setBusy(true)
    setError(null)
    cancelledRef.current = false
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const { path } = await generateImage({
        prompt: prompt.trim(),
        styleName: styleName === 'None' ? null : styleName,
        referencePath: dialog.referenceSrc,
        signal: ctrl.signal,
      })
      if (cancelledRef.current || ctrl.signal.aborted) return
      if (editor.isDestroyed) return
      if (useEditorStore.getState().currentFilePath !== fileAtStartRef.current) {
        console.warn('Margin: image target file changed mid-generation — dropping image')
        return
      }
      if (isRegen && dialog.referenceSrc) {
        // Src-only swap: find the node still carrying the old src (positions
        // may have shifted while generation ran) and update just `src`.
        const targetSrc = dialog.referenceSrc
        let foundPos: number | null = null
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'image' && node.attrs.src === targetSrc) {
            foundPos = pos
            return false
          }
          return true
        })
        if (foundPos == null) {
          console.warn('Margin: reference image no longer in doc — dropping regeneration')
          return
        }
        editor.chain().focus().setNodeSelection(foundPos).updateAttributes('image', { src: path }).run()
      } else {
        const anchor = dialog.anchorPos ?? editor.state.selection.to
        // Fixed alt: deriving it from the prompt sliced raw text (mid-word
        // cuts, newlines, Markdown-significant chars) into the image markup.
        insertStoredImageAt(editor, anchor, path, 'generated image')
      }
      // Runs are recorded server-side (prompt, seed, asset) and viewable in
      // Settings → Images → Recent generations — the dialog stays minimal.
      closeDialog()
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Image generation failed')
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
          {isRegen ? 'Regenerate image' : 'Generate image'}
        </h3>
        {isRegen && dialog.referenceSrc && (
          <div className="mt-3 flex items-center gap-3">
            <img
              src={toDisplaySrc(dialog.referenceSrc)}
              alt="Reference"
              className="h-16 w-16 rounded-[6px] border border-[var(--border-subtle)] object-cover"
            />
            <p className="text-[11.5px] leading-relaxed text-[var(--text-secondary)]">
              The current image is the reference. Empty prompt makes another version;
              describe changes to edit it.
            </p>
          </div>
        )}
        <label className="mt-4 block text-[12px] font-medium text-[var(--text-secondary)]">
          {isRegen ? 'Prompt (optional)' : 'Describe the image you want'}
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
          placeholder={isRegen ? 'Make the sky darker and add mountains…' : 'A cozy cabin in a snowy forest…'}
          disabled={busy}
          className="mt-1.5 w-full resize-y rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text-secondary)] disabled:opacity-60"
        />
        <label className="mt-3 block text-[12px] font-medium text-[var(--text-secondary)]">Style</label>
        <select
          value={styleName}
          onChange={(e) => setStyleName(e.target.value)}
          disabled={busy}
          className="mt-1.5 w-full rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text-secondary)] disabled:opacity-60"
        >
          {options.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
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
            {busy ? 'Cancel' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={!canSubmit}
            className="rounded-[6px] bg-[var(--accent-brown)] px-4 py-1.5 text-[12.5px] font-medium text-[var(--text-inverse)] hover:bg-[var(--accent-brown-hover)] transition-colors disabled:opacity-50 cursor-pointer"
          >
            {busy ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  )
}
