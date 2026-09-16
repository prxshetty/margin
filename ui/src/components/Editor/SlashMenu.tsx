import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import type { Editor } from '@tiptap/core'
import {
  TextIcon,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  TextQuote,
  Code,
  Minus,
  ImagePlus,
  Link2,
  Table,
  type LucideIcon,
} from 'lucide-react'
import { importImageFromUrl, insertStoredImage, uploadImageFile } from '../../lib/media'
import { normalizeHref } from '../../lib/link'

export interface SlashMenuHandle {
  /** Returns true when the key was consumed by the menu. */
  onKeyDown: (e: KeyboardEvent) => boolean
}

interface SlashMenuProps {
  editor: Editor
  query: string
  range: { from: number; to: number }
}

type MenuMode = 'list' | 'image-url' | 'link-url'

interface SlashItem {
  id: string
  label: string
  hint: string
  icon: LucideIcon
  keywords: string
  run: (ctx: SlashCtx) => void
}

interface SlashCtx {
  editor: Editor
  range: { from: number; to: number }
  enterMode: (mode: MenuMode) => void
}

function pickAndUpload(editor: Editor) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/png,image/jpeg,image/webp,image/gif'
  input.multiple = true
  input.onchange = async () => {
    const files = Array.from(input.files ?? [])
    for (const file of files) {
      try {
        const path = await uploadImageFile(file)
        insertStoredImage(editor, path, file.name.replace(/\.[^.]+$/, ''))
      } catch (err) {
        window.alert(`Image upload failed: ${err instanceof Error ? err.message : err}`)
      }
    }
  }
  input.click()
}

const ITEMS: SlashItem[] = [
  {
    id: 'text', label: 'Text', hint: 'Plain paragraph', icon: TextIcon, keywords: 'text paragraph plain',
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    id: 'h1', label: 'Heading 1', hint: 'Large section heading', icon: Heading1, keywords: 'h1 heading title',
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    id: 'h2', label: 'Heading 2', hint: 'Medium section heading', icon: Heading2, keywords: 'h2 heading subtitle',
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    id: 'h3', label: 'Heading 3', hint: 'Small section heading', icon: Heading3, keywords: 'h3 heading',
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
  },
  {
    id: 'bullet', label: 'Bullet list', hint: 'Unordered list', icon: List, keywords: 'bullet unordered list ul',
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: 'ordered', label: 'Numbered list', hint: 'Ordered list', icon: ListOrdered, keywords: 'numbered ordered list ol',
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: 'quote', label: 'Quote', hint: 'Block quote', icon: TextQuote, keywords: 'quote blockquote cite',
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: 'code', label: 'Code block', hint: 'Monospace block', icon: Code, keywords: 'code block pre monospace',
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    id: 'divider', label: 'Divider', hint: 'Horizontal rule', icon: Minus, keywords: 'divider hr rule separator',
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    id: 'upload', label: 'Upload image', hint: 'Save to workspace assets', icon: ImagePlus, keywords: 'upload image picture photo asset file',
    run: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      pickAndUpload(editor)
    },
  },
  {
    id: 'image-url', label: 'Image from URL', hint: 'Download into assets', icon: ImagePlus, keywords: 'image url link web download',
    run: ({ enterMode }) => enterMode('image-url'),
  },
  {
    id: 'link', label: 'Link', hint: 'Insert a hyperlink', icon: Link2, keywords: 'link url hyperlink anchor',
    run: ({ enterMode }) => enterMode('link-url'),
  },
  {
    id: 'table', label: 'Table', hint: '3×3 grid', icon: Table, keywords: 'table grid rows columns',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
]

/** Block-start `/query` state, Notion-style: only inside empty-ish paragraphs. */
export function computeSlash(editor: Editor): { query: string; range: { from: number; to: number } } | null {
  const { empty, from } = editor.state.selection
  if (!empty) return null
  const $from = editor.state.selection.$from
  if ($from.parent.type.name !== 'paragraph') return null
  const blockStart = $from.start()
  const line = editor.state.doc.textBetween(blockStart, from, ' ')
  const m = /^\/([\w\- ]*)$/.exec(line)
  if (!m) return null
  return { query: m[1].toLowerCase(), range: { from: blockStart, to: from } }
}

export const SlashMenuView = forwardRef<SlashMenuHandle, SlashMenuProps>(
  function SlashMenuView({ editor, query, range }, ref) {
    const [mode, setMode] = useState<MenuMode>('list')
    const [active, setActive] = useState(0)
    const [url, setUrl] = useState('')
    const [linkText, setLinkText] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const urlInputRef = useRef<HTMLInputElement>(null)
    const listRef = useRef<HTMLDivElement>(null)

    // Reset transient state whenever the query text changes.
    useEffect(() => {
      setMode('list')
      setActive(0)
      setUrl('')
      setLinkText('')
      setError('')
    }, [query, range.from, range.to])

    useEffect(() => {
      if (mode !== 'list') setTimeout(() => urlInputRef.current?.focus(), 20)
    }, [mode])

    const filtered = ITEMS.filter((item) =>
      query
        .split(/\s+/)
        .filter(Boolean)
        .every((w) => `${item.label} ${item.keywords}`.toLowerCase().includes(w)),
    )

    useEffect(() => {
      setActive(0)
    }, [filtered.length])

    const runItem = (item: SlashItem) => {
      setError('')
      item.run({ editor, range, enterMode: setMode })
    }

    const submitUrl = async () => {
      const value = url.trim()
      if (!value || busy) return
      if (mode === 'image-url' && !/^https?:\/\//i.test(value)) {
        setError('URL must start with http(s)://')
        return
      }
      setBusy(true)
      setError('')
      try {
        // Remove the `/...` query first so the insert lands cleanly.
        editor.chain().focus().deleteRange(range).run()
        if (mode === 'image-url') {
          const path = await importImageFromUrl(value)
          insertStoredImage(editor, path)
        } else {
          // Link: visible text and destination are separate fields. Empty
          // text falls back to the URL itself (previous behavior).
          const href = normalizeHref(value)
          if (!href) {
            setError('Enter a URL')
            setBusy(false)
            return
          }
          const text = linkText.trim() || value
          editor
            .chain()
            .focus()
            .insertContent({
              type: 'text',
              text,
              marks: [{ type: 'link', attrs: { href } }],
            })
            // Clear the stored link mark so typing after the insert
            // continues as plain text instead of extending the link.
            .unsetLink()
            .run()
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add URL')
      } finally {
        setBusy(false)
      }
    }

    useImperativeHandle(ref, () => ({
      onKeyDown: (e: KeyboardEvent) => {
        if (mode !== 'list') {
          if (e.key === 'Escape') {
            e.preventDefault()
            setMode('list')
            return true
          }
          return false
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          setActive((a) => {
            const n = filtered.length
            if (n === 0) return 0
            return e.key === 'ArrowDown' ? (a + 1) % n : (a - 1 + n) % n
          })
          return true
        }
        if (e.key === 'Enter') {
          const item = filtered[active]
          if (item) {
            e.preventDefault()
            runItem(item)
            return true
          }
          return false
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          // Collapse the query: leave plain text, close the menu.
          editor.commands.setTextSelection(range.to)
          return true
        }
        return false
      },
    }))

    // Keep the active row visible while arrowing.
    useEffect(() => {
      listRef.current
        ?.querySelector(`[data-index="${active}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    }, [active])

    return (
      <div className="slash-menu">
        {mode === 'list' ? (
          <div ref={listRef} className="slash-menu__list">
            {filtered.length === 0 && (
              <div className="slash-menu__empty">No matches</div>
            )}
            {filtered.map((item, i) => (
              <button
                key={item.id}
                data-index={i}
                onMouseDown={(e) => {
                  e.preventDefault()
                  runItem(item)
                }}
                onMouseEnter={() => setActive(i)}
                className={`slash-menu__item ${i === active ? 'slash-menu__item--active' : ''}`}
              >
                <item.icon className="slash-menu__icon" />
                <span className="slash-menu__label">{item.label}</span>
                <span className="slash-menu__hint">{item.hint}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="slash-menu__url">
            <div className="slash-menu__url-title">
              {mode === 'image-url' ? 'Image from URL — saved to assets/' : 'Insert link'}
            </div>
            {mode === 'link-url' && (
              <input
                value={linkText}
                onChange={(e) => setLinkText(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    submitUrl()
                  }
                }}
                onMouseDown={(e) => e.stopPropagation()}
                placeholder="Link text (defaults to the URL)"
                spellCheck={false}
                className="slash-menu__input"
              />
            )}
            <input
              ref={urlInputRef}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitUrl()
                }
              }}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder={mode === 'image-url' ? 'https://…' : 'https://example.com'}
              spellCheck={false}
              className="slash-menu__input"
            />
            {error && <div className="slash-menu__error">{error}</div>}
            <div className="slash-menu__url-actions">
              <button
                onMouseDown={(e) => {
                  e.preventDefault()
                  setMode('list')
                }}
                className="slash-menu__btn"
              >
                Back
              </button>
              <button
                onMouseDown={(e) => {
                  e.preventDefault()
                  submitUrl()
                }}
                disabled={busy || !url.trim()}
                className="slash-menu__btn slash-menu__btn--primary"
              >
                {busy ? 'Adding…' : 'Add'}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  },
)
