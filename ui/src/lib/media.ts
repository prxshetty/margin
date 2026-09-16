import type { Editor } from '@tiptap/core'
import { API_BASE } from './api'

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)(\?.*)?$/i

export function isBareImageUrl(text: string): boolean {
  const t = (text || '').trim()
  if (!t || /\s/.test(t)) return false
  if (!/^https?:\/\//i.test(t)) return false
  return IMAGE_EXT_RE.test(t)
}

export function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return IMAGE_EXT_RE.test(file.name)
}

/** Local `assets/...` refs render via the backend; remote/absolute srcs as-is. */
export function toDisplaySrc(src: string): string {
  if (!src) return src
  if (/^(https?:|blob:|data:)/i.test(src)) return src
  if (src.startsWith('/api/')) return src
  const cleaned = src.replace(/^\.\//, '').replace(/^\/+/, '')
  return `${API_BASE}/api/workspace/media/${cleaned}`
}

async function handleMediaResponse(res: Response): Promise<string> {
  if (!res.ok) {
    let detail = 'Image upload failed'
    try {
      const data = await res.json()
      if (data?.detail) detail = data.detail
    } catch { /* ignore */ }
    throw new Error(detail)
  }
  const data = await res.json()
  if (!data?.path) throw new Error('Image upload failed')
  return data.path as string
}

export async function uploadImageFile(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file, file.name)
  const res = await fetch(`${API_BASE}/api/workspace/media`, {
    method: 'POST',
    body: form,
    // Backend streams with no app-level cap; this only bounds a hung socket.
    signal: AbortSignal.timeout(30000),
  })
  return handleMediaResponse(res)
}

export async function importImageFromUrl(url: string, name = ''): Promise<string> {
  const res = await fetch(`${API_BASE}/api/workspace/media/from-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, name }),
    // Backend urlopen already times out at 20s; this bounds a hung socket.
    signal: AbortSignal.timeout(30000),
  })
  return handleMediaResponse(res)
}

/** Insert a stored `assets/...` image at the current selection. */
export function insertStoredImage(editor: Editor, path: string, alt = ''): void {
  editor
    .chain()
    .focus()
    .setImage({ src: path, alt })
    .run()
}

/**
 * Insert a stored image at an explicit document position: split the block,
 * drop the image on its own paragraph, open a fresh paragraph below.
 * Single chained transaction, no focus stealing — ProseMirror leaves the
 * selection below the image so the user keeps writing there.
 * Callers must have already verified this is still the right document
 * (see the file guard in `NovelEditor.handleBareImageUrl`).
 */
export function insertStoredImageAt(editor: Editor, pos: number, path: string, alt = ''): void {
  const size = editor.state.doc.content.size
  const at = Math.max(0, Math.min(pos, size))
  editor
    .chain()
    .setTextSelection(at)
    .splitBlock()
    .setImage({ src: path, alt })
    .splitBlock()
    .run()
}
