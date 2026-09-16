import { useEffect, useState } from 'react'
import Image from '@tiptap/extension-image'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/core'
import { toDisplaySrc } from '../../lib/media'

/**
 * Margin's image node. Keeps Tiptap's `image` node name (and its
 * src/alt/title attrs) so the tiptap-markdown pipeline round-trips it as
 * `![alt](assets/foo.png "caption")` with zero custom serialization.
 * (Raw-text storage is not an option: the markdown serializer escapes `[`
 * and `]` in text nodes, so a literal `![...]` line would save as
 * backslash soup and break AI context stripping. The node is what keeps
 * the file clean.)
 *
 * Layout mirrors the source: the markdown line on top (plain body text,
 * no chrome), the rendered image below it — like bold markers, the source
 * is visible exactly when the cursor is there. Clearing the line removes
 * the image. Caption lives in `title` and is included in the endpoint
 * text representation (`[image: alt — caption]`).
 */
function serializeImageMarkdown(alt: string, src: string, title: string | null): string {
  const t = title ? ` "${title.replace(/"/g, '\\"')}"` : ''
  return `![${alt}](${src}${t})`
}

function parseImageMarkdown(text: string): { alt: string; src: string; title: string | null } | null {
  const m = /^!\[([^\]]*)\]\((\S+?)(?:\s+"((?:[^"\\]|\\.)*)")?\)$/.exec(text.trim())
  if (!m) return null
  return { alt: m[1], src: m[2], title: m[3] ? m[3].replace(/\\"/g, '"') : null }
}

function MarginImageView({ editor, node, selected, updateAttributes, deleteNode, getPos }: NodeViewProps) {
  const { src, alt } = node.attrs
  const storedCaption: string = node.attrs.title ?? ''
  const [captionDraft, setCaptionDraft] = useState(storedCaption)
  const sourceText = serializeImageMarkdown(alt ?? '', src, storedCaption || null)
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
    updateAttributes({ alt: parsed.alt, src: parsed.src, title: parsed.title })
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

  return (
    <NodeViewWrapper className="margin-image" data-drag-handle>
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
        <img
          src={toDisplaySrc(src)}
          alt={alt || ''}
          draggable={false}
          onError={() => setBroken(true)}
          className="margin-image__img"
        />
      )}
      {!broken && (storedCaption || selected) && (
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
    </NodeViewWrapper>
  )
}

export const MarginImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MarginImageView)
  },
})
