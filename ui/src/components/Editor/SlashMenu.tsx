import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import type { Editor } from '@tiptap/core'
import {
  ImagePlus,
  type LucideIcon,
} from 'lucide-react'
import { insertStoredImage, uploadImageFile } from '../../lib/media'
import { useEditorStore } from '../../stores/editorStore'

export interface SlashMenuHandle {
  /** Returns true when the key was consumed by the menu. */
  onKeyDown: (e: KeyboardEvent) => boolean
}

interface SlashMenuProps {
  editor: Editor
  query: string
  range: { from: number; to: number }
}

interface SlashCtx {
  editor: Editor
  range: { from: number; to: number }
}

interface SlashItem {
  id: string
  label: string
  hint: string
  icon: LucideIcon
  keywords: string
  run: (ctx: SlashCtx) => void
}

function pickAndUpload(editor: Editor) {
  const fileAtPick = useEditorStore.getState().currentFilePath
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/png,image/jpeg,image/webp,image/gif'
  input.multiple = true
  input.onchange = async () => {
    const files = Array.from(input.files ?? [])
    for (const file of files) {
      try {
        const path = await uploadImageFile(file)
        // Same invariant as paste-URL imports: never insert into a
        // document the user has since switched away from.
        if (editor.isDestroyed) return
        if (useEditorStore.getState().currentFilePath !== fileAtPick) {
          console.warn('Margin: upload target file changed mid-upload — dropping image')
          return
        }
        insertStoredImage(editor, path, file.name.replace(/\.[^.]+$/, ''))
      } catch (err) {
        window.alert(`Image upload failed: ${err instanceof Error ? err.message : err}`)
      }
    }
  }
  input.click()
}

// Extensible item registry: add future entries here (each with label,
// hint, icon, keywords, run) and they appear in the menu with no further
// wiring. Image upload is currently the only entry — pasted image URLs
// already import via the paste path, so no URL mode is needed.
const ITEMS: SlashItem[] = [
  {
    id: 'upload', label: 'Upload image', hint: 'Save to workspace assets', icon: ImagePlus, keywords: 'upload image picture photo asset file',
    run: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      pickAndUpload(editor)
    },
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
    const [active, setActive] = useState(0)
    const listRef = useRef<HTMLDivElement>(null)

    const filtered = ITEMS.filter((item) =>
      query
        .split(/\s+/)
        .filter(Boolean)
        .every((w) => `${item.label} ${item.keywords}`.toLowerCase().includes(w)),
    )

    useEffect(() => {
      setActive(0)
    }, [query, range.from, range.to])

    const runItem = (item: SlashItem) => {
      item.run({ editor, range })
    }

    useImperativeHandle(ref, () => ({
      onKeyDown: (e: KeyboardEvent) => {
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
              <span className="slash-menu__text">
                <span className="slash-menu__label">{item.label}</span>
                <span className="slash-menu__hint">{item.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    )
  },
)
