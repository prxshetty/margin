import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import type { Editor } from '@tiptap/core'
import { ITEMS, type SlashItem } from './slashItems'

export interface SlashMenuHandle {
  /** Returns true when the key was consumed by the menu. */
  onKeyDown: (e: KeyboardEvent) => boolean
}

interface SlashMenuProps {
  editor: Editor
  query: string
  range: { from: number; to: number }
}

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

    // Two-tier word-prefix matching (Notion/Raycast-style). Tier 1: every
    // typed word starts the label itself (`/i` → Imagine, not Upload via
    // its second word "image"). Tier 2 (fallback): any label/keyword word
    // (`/pic` → Upload via "picture", `/gen` → Imagine via "generate").
    const words = query
      .split(/\s+/)
      .filter(Boolean)
    const labelWords = (s: string) => s.toLowerCase().split(/[\s_]+/)
    const byLabelStart = ITEMS.filter((item) => {
      const first = labelWords(item.label)[0] ?? ''
      return words.every((w) => first.startsWith(w))
    })
    const byAnywhere = ITEMS.filter((item) => {
      const haystack = [...labelWords(item.label), ...labelWords(item.keywords)]
      return words.every((w) => haystack.some((h) => h.startsWith(w)))
    })
    const filtered = words.length === 0
      ? ITEMS
      : byLabelStart.length > 0 ? byLabelStart : byAnywhere

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
