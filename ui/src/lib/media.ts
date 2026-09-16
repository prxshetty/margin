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
 * Capture the selection end of the *next* dispatched transaction.
 * Used for paste: `handlePaste` runs before the native paste transaction is
 * dispatched, so the live selection is still pre-paste. Resolves null on
 * timeout (caller should no-op — inserting blindly is worse than dropping).
 */
export function captureAnchorAfterDispatch(editor: Editor, timeoutMs = 5000): Promise<number | null> {
  return new Promise((resolve) => {
    let done = false
    const timer = window.setTimeout(() => {
      if (done) return
      done = true
      editor.off('transaction', handler)
      resolve(null)
    }, timeoutMs)
    const handler = () => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      editor.off('transaction', handler)
      // Tiptap updates view state before emitting 'transaction', so this is
      // already the post-dispatch (post-paste) selection.
      resolve(editor.state.selection.to)
    }
    editor.on('transaction', handler)
  })
}

export interface PositionTracker {
  /** Mapped anchor, or null once stopped. */
  get: () => number | null
  stop: () => void
}

/**
 * Track a document position forward through every subsequent transaction.
 * Each paste gets its own tracker (closure state), so concurrent pastes keep
 * distinct anchors and ProseMirror mapping preserves their relative order.
 * Callers must `stop()` on settle — see the registry in `NovelEditor`.
 */
export function createPositionTracker(editor: Editor, start: number): PositionTracker {
  let pos: number | null = start
  const handler = ({ transaction }: { transaction: { mapping: { map: (p: number) => number } } }) => {
    if (pos == null) return
    pos = transaction.mapping.map(pos)
  }
  editor.on('transaction', handler)
  return {
    get: () => pos,
    stop: () => {
      pos = null
      editor.off('transaction', handler)
    },
  }
}

/**
 * Insert a stored image at an explicit document position: split the block,
 * drop the image on its own paragraph, open a fresh paragraph below.
 * Runs as one chained call (single transaction) with no `.focus()` — the
 * caller's selection is restored via ProseMirror's own mapping rather than
 * hand-rolled size math:
 * - selection fully outside the inserted span → restored (mapped),
 * - selection inside the span → left below the image (natural continuation).
 */
export function insertStoredImageAt(editor: Editor, pos: number, path: string, alt = ''): void {
  const size = editor.state.doc.content.size
  const at = Math.max(0, Math.min(pos, size))
  const prevFrom = editor.state.selection.from
  const prevTo = editor.state.selection.to

  // Box (not a closure-narrowed `let`): TS keeps `null` narrowing on lets
  // assigned only inside callbacks, which would make `captured` `never`.
  const box: { tr: { mapping: { map: (p: number) => number } } | null } = { tr: null }
  const handler = ({ transaction }: { transaction: { mapping: { map: (p: number) => number } } }) => {
    box.tr = transaction
  }
  editor.on('transaction', handler)
  try {
    editor
      .chain()
      .setTextSelection(at)
      .splitBlock()
      .setImage({ src: path, alt })
      .splitBlock()
      .run()
  } finally {
    editor.off('transaction', handler)
  }
  const captured = box.tr
  if (!captured) return

  const spanEnd = at + (editor.state.doc.content.size - size)
  const mappedFrom = captured.mapping.map(prevFrom)
  const mappedTo = captured.mapping.map(prevTo)
  const disturbed = mappedFrom < spanEnd && mappedTo > at
  if (!disturbed) {
    editor.commands.setTextSelection({ from: mappedFrom, to: mappedTo })
  }
}
