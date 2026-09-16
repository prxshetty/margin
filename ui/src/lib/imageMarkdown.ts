/**
 * Pure Markdown helpers for image nodes — no DOM, no editor imports.
 *
 * Dimensions ride in an Obsidian-style suffix on the alt text so stock
 * markdown-it (used by tiptap-markdown 0.9.0) passes them through untouched:
 *
 *   ![alt|800](assets/a.png)          → width 800
 *   ![alt|800x600](assets/a.png "cap") → width 800, height 600
 *
 * Alignment rides in a trailing `{align=…}` block (same line):
 *
 *   ![alt](assets/a.png){align=right}
 *
 * A trailing `|...` is only treated as dimensions when it strictly matches
 * positive digits — `![a|b](s.png)` keeps the literal alt `a|b`, and
 * `![a|0](s.png)` falls back to a plain image (dims stripped, never a
 * zero-size render). Unknown `{...}` suffixes are left alone for the caller
 * to reject as invalid.
 */

export type ImageAlign = 'left' | 'center' | 'right'

export interface ParsedImageMarkdown {
  alt: string
  src: string
  title: string | null
  width: number | null
  height: number | null
  align: ImageAlign | null
}

const IMAGE_MD_RE = /^!\[([^\]]*)\]\((\S+?)(?:\s+"((?:[^"\\]|\\.)*)")?\)$/
const DIMS_SUFFIX_RE = /^(.*)\|(?:(\d+)x(\d+)|(\d+)|x(\d+))$/
const ALIGN_SUFFIX_RE = /\{align=(left|center|right)\}$/

/** Split an Obsidian-style `alt|WxH` suffix: clean alt plus dimensions. */
export function splitAltDims(alt: string): { alt: string; width: number | null; height: number | null } {
  const m = DIMS_SUFFIX_RE.exec(alt)
  if (!m) return { alt, width: null, height: null }
  const width = m[2] != null ? parseInt(m[2], 10) : m[4] != null ? parseInt(m[4], 10) : null
  const height = m[3] != null ? parseInt(m[3], 10) : m[5] != null ? parseInt(m[5], 10) : null
  // Zero/negative sizes are invalid — fall back to a plain image rather
  // than rendering something invisible or corrupt.
  if ((width != null && width <= 0) || (height != null && height <= 0)) {
    return { alt: m[1], width: null, height: null }
  }
  return { alt: m[1], width, height }
}

export function parseImageMarkdown(text: string): ParsedImageMarkdown | null {
  const trimmed = text.trim()
  const alignMatch = ALIGN_SUFFIX_RE.exec(trimmed)
  const align = (alignMatch?.[1] as ImageAlign | undefined) ?? null
  const core = alignMatch ? trimmed.slice(0, -alignMatch[0].length).trimEnd() : trimmed
  const m = IMAGE_MD_RE.exec(core)
  if (!m) return null
  const { alt, width, height } = splitAltDims(m[1])
  return {
    alt,
    src: m[2],
    title: m[3] ? m[3].replace(/\\"/g, '"') : null,
    width,
    height,
    align,
  }
}

export function serializeImageMarkdown(
  alt: string,
  src: string,
  title: string | null,
  width: number | null = null,
  height: number | null = null,
  align: ImageAlign | null = null,
): string {
  const t = title ? ` "${title.replace(/"/g, '\\"')}"` : ''
  const dims = width != null && height != null ? `|${width}x${height}`
    : width != null ? `|${width}`
    : height != null ? `|x${height}`
    : ''
  const a = align ? `{align=${align}}` : ''
  return `![${alt}${dims}](${src}${t})${a}`
}
