import Image from '@tiptap/extension-image'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { MarginImageView } from './MarginImage'
import { serializeImageMarkdown, splitAltDims } from '../../lib/imageMarkdown'
import { numOrNull } from './imageAttributes'

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
