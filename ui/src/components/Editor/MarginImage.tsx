import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import Image from '@tiptap/extension-image'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/core'
import { AlignCenter, AlignLeft, AlignRight, RotateCcw } from 'lucide-react'
import { toDisplaySrc } from '../../lib/media'
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
  const [captionDraft, setCaptionDraft] = useState(storedCaption)
  const sourceText = serializeImageMarkdown(
    alt ?? '', src, storedCaption || null, width, height, align,
  )
  const [sourceDraft, setSourceDraft] = useState(sourceText)
  // A src that fails to load is a broken path, not an image: hide the img
  // (no broken logo) and caption, and keep the source visible as an
  // editable, hyperlink-styled path so the user can fix it.
  const [broken, setBroken] = useState(false)

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
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startW: (width ?? img.clientWidth) || img.naturalWidth || maxW,
      startH: (height ?? img.clientHeight) || img.naturalHeight || maxW,
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
    w = Math.round(Math.min(Math.max(w, MIN_SIZE), d.maxW))
    h = Math.round(Math.min(Math.max(h, MIN_SIZE), d.maxW))
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
              <div className="margin-image__controls" onMouseDown={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  title="Reset to natural size"
                  aria-label="Reset image to natural size"
                  className="margin-image__btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => updateAttributes({ width: null, height: null })}
                >
                  <RotateCcw className="margin-image__btn-icon" />
                </button>
                <span className="margin-image__divider" />
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
              </div>
            )}
          </div>
          {(storedCaption || selected) && (
            <input
              value={captionDraft}
              onChange={(e) => setCaptionDraft(e.target.value)}
              onBlur={commitCaption}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  exitToNewLine(e.target as HTMLInputElement)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setCaptionDraft(storedCaption)
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
