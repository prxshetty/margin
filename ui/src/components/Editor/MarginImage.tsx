import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import Image from '@tiptap/extension-image'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/core'
import { AlignCenter, AlignLeft, AlignRight, Pencil, ChevronsUpDown } from 'lucide-react'
import { generateImage, toDisplaySrc } from '../../lib/media'
import { Dropdown } from '../Dropdown'
import { useSettingsStore } from '../../stores/settingsStore'
import { imageStyleOptions } from './ImageGenerateDialog'
import { toast } from '../../stores/toastStore'
import { parseImageMarkdown, serializeImageMarkdown, splitAltDims } from '../../lib/imageMarkdown'
import type { ImageAlign } from '../../lib/imageMarkdown'

/**
 * Margin's image node. Keeps Tiptap's `image` node name (and its
 * src/alt/title attrs) so plain images round-trip as
 * `![alt](assets/foo.png "caption")` exactly as before.
 * (Raw-text storage is not an option: the markdown serializer escapes `[`
 * and `]` in text nodes, so a literal `![...]` line would save as
 * backslash soup and break AI context stripping. The node is what keeps
 * the file clean.)
 *
 * Dimensions (Obsidian-style `![alt|800](src)` / `![alt|800x600](src)`)
 * and alignment (`![alt](src){align=right}`): neither Tiptap's built-in
 * image Markdown serializer nor tiptap-markdown 0.9.0 preserves custom
 * attributes — 0.9.0 serializes via prosemirror-markdown's default `image()`
 * (alt/src/title only) and parses stock markdown-it image syntax into
 * `<img>`, ignoring the v3 `parseMarkdown`/`renderMarkdown` hooks entirely.
 * So this extension adds the smallest wiring that survives that pipeline:
 * `width`/`height` parsed from the alt suffix in the DOM, `align` recovered
 * from the `{align=…}` trailer by an `updateDOM` hook, plus a
 * `storage.markdown.serialize` override (merged over 0.9.0's default spec)
 * that writes both back. Dragging a handle is just a visual way to edit
 * the persisted Markdown width/height — there is no separate layout state.
 *
 * Layout mirrors the source: the markdown line on top (plain body text,
 * no chrome), the rendered image below it — like bold markers, the source
 * is visible exactly when the cursor is there. Clearing the line removes
 * the image. Caption lives in `title` and is included in the endpoint
 * text representation (`[image: alt — caption]`).
 */

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' ? v : null
}

const MIN_SIZE = 32

// Filled submit — SimpleAssist's send treatment (solid accent idle, muted
// disabled) in the 5px inner radius shared with the bubble's SendArrow.
const SEND_PILL_CLASS = 'flex items-center justify-center w-6 h-6 rounded-[5px] border border-transparent cursor-pointer select-none shrink-0 transition-[background-color,transform,opacity] duration-150 active:scale-[0.9] bg-[var(--accent-brown)] hover:bg-[var(--accent-brown-hover)] text-[var(--text-inverse)] disabled:bg-[var(--bg-disabled)] disabled:text-[var(--text-disabled)] disabled:border-transparent'

/**
 * Maximum drag width: the editor's content width, not the image frame's.
 * The frame shrink-wraps the image, so measuring it would freeze the clamp
 * at whatever size the last resize committed — shrinking would work once
 * and growing back never would.
 */
function measureMaxWidth(img: HTMLImageElement): number {
  const editorEl = img.closest('.ProseMirror')
  if (editorEl) {
    const cs = window.getComputedStyle(editorEl)
    const w = editorEl.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0')
    if (Number.isFinite(w) && w >= MIN_SIZE) return Math.floor(w)
  }
  return Math.max(MIN_SIZE, img.parentElement?.clientWidth || MIN_SIZE)
}

type ResizeMode = 'e' | 'w' | 's' | 'se' | 'sw'

interface ResizeDrag {
  mode: ResizeMode
  startX: number
  startY: number
  startW: number
  startH: number
  ratio: number
  maxW: number
  w: number | null
  h: number | null
}

function MarginImageView({ editor, node, selected, updateAttributes, deleteNode, getPos }: NodeViewProps) {
  const { src, alt } = node.attrs
  const width = numOrNull(node.attrs.width)
  const height = numOrNull(node.attrs.height)
  const align = (node.attrs.align ?? null) as ImageAlign | null
  const storedCaption: string = node.attrs.title ?? ''
  const liveSettings = useSettingsStore((s) => s.settings)
  const [captionDraft, setCaptionDraft] = useState(storedCaption)
  // The caption field only renders when a caption exists or the user
  // explicitly asked for one via the affordance below. Auto-showing it on
  // every selection trapped clicks just below the image inside the input,
  // so clicking out couldn't deselect the node.
  const [captionEditing, setCaptionEditing] = useState(false)
  const captionRef = useRef<HTMLInputElement>(null)
  const sourceText = serializeImageMarkdown(
    alt ?? '', src, storedCaption || null, width, height, align,
  )
  const [sourceDraft, setSourceDraft] = useState(sourceText)
  // A src that fails to load is a broken path, not an image: hide the img
  // (no broken logo) and caption, and keep the source visible as an
  // editable, hyperlink-styled path so the user can fix it.
  const [broken, setBroken] = useState(false)
  // "Imagine again" request in flight — pill shows the Rewrite-style
  // shimmer and controls are disabled until the swap lands or fails.
  const [regenerating, setRegenerating] = useState(false)
  // Pencil morphs the pill into a Rewrite-style input bar: the user
  // describes the change they want, and empty never submits.
  // The style pill only appears in the expanded (vertical) view.
  const [editing, setEditing] = useState(false)
  const [editPrompt, setEditPrompt] = useState('')
  const [editStyle, setEditStyle] = useState('None')
  const [editExpanded, setEditExpanded] = useState(false)
  const editInputRef = useRef<HTMLInputElement>(null)
  const editAreaRef = useRef<HTMLTextAreaElement>(null)

  // External updates (doc switch, AI edits) flow back into the drafts.
  useEffect(() => {
    setCaptionDraft(storedCaption)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedCaption])
  useEffect(() => {
    setSourceDraft(sourceText)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceText])
  // A new src gets a fresh chance: retry the load instead of staying broken.
  useEffect(() => {
    setBroken(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])
  // Deselecting with no caption collapses the field again so the space
  // below the image stays a plain click-out target next time.
  useEffect(() => {
    if (!selected && !storedCaption) setCaptionEditing(false)
  }, [selected, storedCaption])
  // Deselecting closes the Imagine-again bar (never mid-flight).
  useEffect(() => {
    if (!selected && !regenerating) {
      setEditing(false)
      setEditExpanded(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])
  // Opening the field via the affordance focuses it for immediate typing.
  useEffect(() => {
    if (captionEditing) captionRef.current?.focus()
  }, [captionEditing])

  const commitCaption = () => {
    const next = captionDraft.trim()
    if (next !== storedCaption) updateAttributes({ title: next || null })
  }

  const commitSource = () => {
    const text = sourceDraft.trim()
    if (!text) {
      deleteNode()
      return
    }
    const parsed = parseImageMarkdown(text)
    if (!parsed) {
      // Not valid image markdown — revert instead of corrupting attrs.
      setSourceDraft(sourceText)
      return
    }
    updateAttributes({
      alt: parsed.alt,
      src: parsed.src,
      title: parsed.title,
      width: parsed.width,
      height: parsed.height,
      align: parsed.align,
    })
  }

  // ── Imagine again (Rewrite-style input, required prompt) ──────────
  // Pencil morphs the pill into an input bar that starts empty — the
  // user describes the change they want, and empty never submits.
  // The old image stays in place if generation fails.
  const openImagineAgain = () => {
    if (regenerating) return
    const settings = useSettingsStore.getState().settings
    setEditPrompt('')
    const options = imageStyleOptions(settings?.image_custom_styles, settings?.image_deleted_styles)
    const def = settings?.image_default_style ?? 'None'
    setEditStyle(
      options.find((o) => o.toLowerCase() === String(def).toLowerCase()) ?? 'None',
    )
    setEditing(true)
    setEditExpanded(false)
    setTimeout(() => editInputRef.current?.focus(), 30)
  }

  const cancelImagineAgain = () => {
    if (regenerating) return
    setEditing(false)
    setEditExpanded(false)
  }

  const submitImagineAgain = async () => {
    const prompt = editPrompt.trim()
    if (regenerating || !prompt) return
    setRegenerating(true)
    try {
      const { path } = await generateImage({
        prompt,
        styleName: editStyle === 'None' ? null : editStyle,
        referencePath: src,
      })
      if (editor.isDestroyed) return
      const targetSrc = src
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
      setEditing(false)
    } catch (err) {
      console.error('Imagine again failed:', err)
      toast.error(`Could not imagine another version: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setRegenerating(false)
    }
  }

  // ── Drag-to-resize ──────────────────────────────────────────────
  // The drag only paints inline styles; the node (and therefore the
  // Markdown) is updated once on release, keeping history to one step.
  const imgRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<ResizeDrag | null>(null)

  const beginResize = (mode: ResizeMode) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const img = imgRef.current
    if (!img) return
    const maxW = measureMaxWidth(img)
    const startW = (width ?? img.clientWidth) || img.naturalWidth || maxW
    const startH = (height ?? img.clientHeight) || img.naturalHeight || maxW
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startW,
      startH,
      ratio: startH > 0 ? startW / startH : 1,
      maxW,
      w: null,
      h: null,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const moveResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    const img = imgRef.current
    if (!d || !img) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    // Centered images resize symmetrically so the grabbed edge tracks the
    // cursor 1:1 (a ×1 width change would re-center the frame and leave the
    // dot lagging at half distance). Aligned images anchor one edge, so
    // only the free edge gets a handle (see below) and ×1 is exact there.
    // Vertical is always top-anchored by block flow, so ×1 everywhere.
    const fx = align == null || align === 'center' ? 2 : 1
    let w = d.startW
    let h = d.startH
    if (d.mode === 'e' || d.mode === 'se') w = d.startW + dx * fx
    if (d.mode === 'w' || d.mode === 'sw') w = d.startW - dx * fx
    if (d.mode === 's' || d.mode === 'se' || d.mode === 'sw') h = d.startH + dy
    // Shift-drag on a corner locks the starting aspect ratio. The dominant
    // axis (larger proportional change) drives so both rightward and
    // downward drags feel exact, and toggling Shift mid-drag just works.
    // Height is intentionally NOT capped at the editor width here: for
    // portrait ratios h grows faster than w, and pulling h back to maxW
    // (plus recomputing w from it) is what caused the visible snap.
    const locked = e.shiftKey && (d.mode === 'se' || d.mode === 'sw') && d.ratio > 0
    if (locked) {
      const scaleW = d.startW > 0 ? w / d.startW : 1
      const scaleH = d.startH > 0 ? h / d.startH : 1
      if (Math.abs(scaleW - 1) >= Math.abs(scaleH - 1)) {
        h = w / d.ratio
      } else {
        w = h * d.ratio
      }
      // Re-clamp while preserving the ratio: fit w to the editor width,
      // then only floor h (growing w with it) — never cap h at maxW.
      w = Math.min(Math.max(w, MIN_SIZE), d.maxW)
      h = w / d.ratio
      if (h < MIN_SIZE) {
        h = MIN_SIZE
        w = h * d.ratio
      }
    }
    w = Math.round(Math.min(Math.max(w, MIN_SIZE), d.maxW))
    h = locked ? Math.round(Math.max(h, MIN_SIZE)) : Math.round(Math.min(Math.max(h, MIN_SIZE), d.maxW))
    img.style.width = `${w}px`
    img.style.height = `${h}px`
    d.w = w
    d.h = h
  }

  const endResize = () => {
    const d = dragRef.current
    dragRef.current = null
    if (!d || d.w == null || d.h == null) return
    // Width-only handles leave height untouched (and vice versa), so an
    // aspect-preserving resize stays width-only in the Markdown.
    updateAttributes({
      ...(d.mode !== 's' ? { width: d.w } : {}),
      ...(d.mode !== 'e' && d.mode !== 'w' ? { height: d.h } : {}),
    })
  }

  // Enter in the caption: commit, then continue writing on a fresh line
  // below the image — the same flow as pressing Enter after any block.
  const exitToNewLine = (input: HTMLInputElement) => {
    commitCaption()
    input.blur()
    const pos = typeof getPos === 'function' ? getPos() : null
    if (pos == null) return
    const end = pos + node.nodeSize
    editor.chain().insertContentAt(end, { type: 'paragraph' }).focus(end + 1).run()
  }

  // The source text hides only when an image actually rendered and the
  // cursor is elsewhere. Broken paths stay visible so they can be fixed.
  const showSource = selected || broken
  const showChrome = selected && !broken

  const handleModes: ResizeMode[] =
    // Aligned images anchor one edge, so the anchored side gets no handle —
    // a width-only commit can't keep a grabbed anchored edge under the
    // cursor, and a slipping dot feels broken. Centered images keep all five.
    align === 'left' ? ['e', 's', 'se']
    : align === 'right' ? ['w', 's', 'sw']
    : ['w', 'e', 's', 'sw', 'se']

  const handleClass: Record<ResizeMode, string> = {
    w: 'margin-image__handle--w',
    e: 'margin-image__handle--e',
    s: 'margin-image__handle--s',
    sw: 'margin-image__handle--sw',
    se: 'margin-image__handle--se',
  }

  const resizeLabel = (mode: ResizeMode): string =>
    `Resize image ${mode === 'e' || mode === 'w' ? 'width' : mode === 's' ? 'height' : 'size'}`

  const alignButtons: { value: ImageAlign; title: string; Icon: typeof AlignLeft }[] = [
    { value: 'left', title: 'Align left', Icon: AlignLeft },
    { value: 'center', title: 'Align center', Icon: AlignCenter },
    { value: 'right', title: 'Align right', Icon: AlignRight },
  ]

  return (
    <NodeViewWrapper
      className="margin-image"
      data-drag-handle
      data-align={align ?? undefined}
    >
      {showSource && (
        <input
          value={sourceDraft}
          onChange={(e) => setSourceDraft(e.target.value)}
          onBlur={commitSource}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitSource()
              exitToNewLine(e.target as HTMLInputElement)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setSourceDraft(sourceText)
              ;(e.target as HTMLInputElement).blur()
            }
            e.stopPropagation()
          }}
          onMouseDown={(e) => e.stopPropagation()}
          spellCheck={false}
          aria-label={broken ? 'Broken image path — edit to fix' : 'Image markdown source'}
          title={broken ? 'Image not found — edit the path to fix' : undefined}
          className={`margin-image__source${broken ? ' margin-image__source--broken' : ''}`}
        />
      )}
      {!broken && (
        <div className="margin-image__body">
          <div className="margin-image__frame">
            <img
              ref={imgRef}
              src={toDisplaySrc(src)}
              alt={alt || ''}
              draggable={false}
              onError={() => setBroken(true)}
              className="margin-image__img"
              style={
                width != null || height != null
                  ? {
                      width: width != null ? `${width}px` : undefined,
                      height: height != null ? `${height}px` : 'auto',
                    }
                  : undefined
              }
            />
            {showChrome && handleModes.map((mode) => (
              <div
                key={mode}
                aria-label={resizeLabel(mode)}
                className={`margin-image__handle ${handleClass[mode]}`}
                onPointerDown={beginResize(mode)}
                onPointerMove={moveResize}
                onPointerUp={endResize}
                onPointerCancel={endResize}
                onMouseDown={(e) => e.stopPropagation()}
              />
            ))}
            {showChrome && (
              <div
                className={`margin-image__controls${editing && editExpanded ? ' margin-image__controls--expanded' : ''}`}
                style={editing && !editExpanded ? { minWidth: 264 } : undefined}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {regenerating && (
                  <div className="absolute inset-0 rounded-[8px] z-50 pointer-events-none">
                    <div className="absolute inset-0 rounded-[8px] animate-spin-border" />
                  </div>
                )}
                {editing ? (
                  // ── Imagine-again input bar (Rewrite-style) ────────────
                  // Collapsed: bare prompt + expand + send. Expanded stacks
                  // the prompt on top with style + actions in the footer.
                  editExpanded ? (
                    <>
                      <textarea
                        ref={editAreaRef}
                        rows={4}
                        value={editPrompt}
                        onChange={(e) => setEditPrompt(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            cancelImagineAgain()
                          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault()
                            void submitImagineAgain()
                          }
                          e.stopPropagation()
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        disabled={regenerating}
                        placeholder="Describe changes"
                        spellCheck={false}
                        aria-label="Describe image changes"
                        className="w-full bg-transparent text-[11.5px] leading-relaxed text-[var(--text-heading)] placeholder:text-[var(--text-muted)] outline-none px-1 resize-none disabled:opacity-60"
                      />
                      <div className="margin-image__controls-actions" style={{ alignSelf: 'flex-end' }}>
                          <Dropdown
                            value={editStyle}
                            onChange={setEditStyle}
                            disabled={regenerating}
                            variant="minimal"
                            freezeSelection
                            menuContentWidth
                            options={imageStyleOptions(liveSettings?.image_custom_styles, liveSettings?.image_deleted_styles).map((n) => ({ value: n, label: n }))}
                            rootClassName="shrink-0 max-w-[120px]"
                          />
                          <button
                            type="button"
                            title="Single line"
                            aria-label="Collapse image prompt"
                            className="margin-image__btn"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setEditExpanded(false)
                              setTimeout(() => editInputRef.current?.focus(), 30)
                            }}
                          >
                            <ChevronsUpDown className="margin-image__btn-icon" />
                          </button>
                          <button
                            type="button"
                            title="Imagine again"
                            aria-label="Imagine again"
                            disabled={regenerating || !editPrompt.trim()}
                            className={SEND_PILL_CLASS}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => void submitImagineAgain()}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className={`w-3.5 h-3.5 ${regenerating ? 'opacity-30' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="12" y1="19" x2="12" y2="5" />
                              <polyline points="5 12 12 5 19 12" />
                            </svg>
                          </button>
                        </div>
                    </>
                  ) : (
                    <>
                      <input
                        ref={editInputRef}
                        value={editPrompt}
                        onChange={(e) => setEditPrompt(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void submitImagineAgain()
                          } else if (e.key === 'Escape') {
                            e.preventDefault()
                            cancelImagineAgain()
                          }
                          e.stopPropagation()
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        disabled={regenerating}
                        placeholder="Describe changes"
                        spellCheck={false}
                        aria-label="Describe image changes"
                        className="flex-1 bg-transparent text-[11.5px] text-[var(--text-heading)] placeholder:text-[var(--text-muted)] outline-none px-1 min-w-0 disabled:opacity-60"
                      />
                      <button
                        type="button"
                        title="Expand"
                        aria-label="Expand image prompt"
                        className="margin-image__btn"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setEditExpanded(true)
                          setTimeout(() => editAreaRef.current?.focus(), 30)
                        }}
                      >
                        <ChevronsUpDown className="margin-image__btn-icon" />
                      </button>
                      <button
                        type="button"
                        title="Imagine again"
                        aria-label="Imagine again"
                        disabled={regenerating || !editPrompt.trim()}
                        className={SEND_PILL_CLASS}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => void submitImagineAgain()}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className={`w-3.5 h-3.5 ${regenerating ? 'opacity-30' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="19" x2="12" y2="5" />
                          <polyline points="5 12 12 5 19 12" />
                        </svg>
                      </button>
                    </>
                  )
                ) : (
                  <>
                    {alignButtons.map(({ value, title, Icon }) => (
                      <button
                        key={value}
                        type="button"
                        title={title}
                        aria-label={title}
                        aria-pressed={align === value}
                        className={`margin-image__btn${align === value ? ' margin-image__btn--active' : ''}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => updateAttributes({ align: align === value ? null : value })}
                      >
                        <Icon className="margin-image__btn-icon" />
                      </button>
                    ))}
                    <span className="margin-image__divider" />
                    <button
                      type="button"
                      title="Imagine again"
                      aria-label="Imagine again"
                      disabled={regenerating}
                      className="margin-image__btn disabled:opacity-40"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={openImagineAgain}
                    >
                      <Pencil className={`margin-image__btn-icon${regenerating ? ' opacity-30' : ''}`} />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          {(storedCaption || captionEditing) ? (
            <input
              ref={captionRef}
              value={captionDraft}
              onChange={(e) => setCaptionDraft(e.target.value)}
              onBlur={() => {
                commitCaption()
                if (!captionDraft.trim() && !storedCaption) setCaptionEditing(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  exitToNewLine(e.target as HTMLInputElement)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setCaptionDraft(storedCaption)
                  if (!storedCaption) setCaptionEditing(false)
                  ;(e.target as HTMLInputElement).blur()
                  editor.commands.focus()
                }
                e.stopPropagation()
              }}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder="Add a caption…"
              aria-label="Image caption"
              className="margin-image__caption"
            />
          ) : (
            // Explicit affordance, not an input: a real <input> here would
            // trap clicks just below the image and prevent deselecting.
            // This button is only mounted while selected, so empty space
            // around it still drops the selection.
            selected && !broken && (
              <button
                type="button"
                aria-label="Add image caption"
                className="margin-image__caption-placeholder"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => setCaptionEditing(true)}
              >
                Add a caption…
              </button>
            )
          )}
        </div>
      )}
    </NodeViewWrapper>
  )
}

export const MarginImage = Image.extend({
  addAttributes() {
    // NOTE: extend() replaces (not merges) the parent's addAttributes, so
    // src/title must be re-declared here alongside the custom attrs.
    // Unadorned attrs parse from same-name DOM attributes by default.
    // Alt additionally strips the `|WxH` dims suffix so the doc stores
    // clean alt text; width/height recover the suffix.
    return {
      src: {
        default: null,
      },
      title: {
        default: null,
      },
      alt: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('alt')
          return raw == null ? null : splitAltDims(raw).alt
        },
      },
      width: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          splitAltDims(element.getAttribute('alt') ?? '').width,
      },
      height: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          splitAltDims(element.getAttribute('alt') ?? '').height,
      },
      align: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const v = element.getAttribute('data-align')
          return v === 'left' || v === 'center' || v === 'right' ? v : null
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          const v = attributes.align
          return v === 'left' || v === 'center' || v === 'right' ? { 'data-align': v } : {}
        },
      },
    }
  },

  addStorage() {
    return {
      markdown: {
        // Overrides tiptap-markdown 0.9.0's default image serializer (which
        // drops width/height/align). Parse needs no serializer-side override:
        // stock markdown-it carries the `|WxH` suffix through in the alt
        // attribute (recovered by parseHTML above) and leaves the
        // `{align=…}` trailer as a text sibling (recovered by updateDOM).
        serialize: (
          state: { write: (text: string) => void },
          node: { attrs: Record<string, unknown> },
        ) => {
          const { alt, src, title, width, height, align } = node.attrs
          state.write(serializeImageMarkdown(
            typeof alt === 'string' ? alt : '',
            typeof src === 'string' ? src : '',
            typeof title === 'string' && title ? title : null,
            numOrNull(width),
            numOrNull(height),
            align === 'left' || align === 'center' || align === 'right' ? align : null,
          ))
        },
        parse: {
          updateDOM: (element: HTMLElement) => {
            element.querySelectorAll('img').forEach((img) => {
              const next = img.nextSibling
              if (!next || next.nodeType !== Node.TEXT_NODE) return
              const m = /^\s*\{align=(left|center|right)\}/.exec(next.textContent ?? '')
              if (!m) return
              img.setAttribute('data-align', m[1])
              const rest = (next.textContent ?? '').slice(m[0].length)
              if (rest.trim() === '') next.parentNode?.removeChild(next)
              else next.textContent = rest
            })
          },
        },
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(MarginImageView)
  },
})
