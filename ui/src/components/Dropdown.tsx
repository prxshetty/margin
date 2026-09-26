import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { computeDropdownOpenUp } from '../lib/dropdownPlacement'

export interface DropdownOption {
  value: string
  label: string
  icon?: React.ReactNode
}

// Shared dropdown: bordered input-style trigger by default, transparent
// minimal trigger for tight surfaces (editor bubble). Menu, checkmarks,
// flip-up, Escape and click-outside are identical in both variants.
//
// portal: render the menu fixed-positioned into document.body so it escapes
// clipping by scrollable ancestors (modal dialogs with overflow-y-auto).
// Use for dropdowns inside dialogs; page and bubble menus keep the default
// absolute menu.
//
// searchable: pin a filter input at the top of the menu so long lists
// (harness models, Comfy node mappings, styles) don't require scrolling.
// Not for freezeSelection (bubble) use — the input needs focus.
export function Dropdown({ value, onChange, options, rootClassName = '', variant = 'default', disabled = false, freezeSelection = false, menuContentWidth = false, portal = false, searchable = false, searchPlaceholder = 'Search...' }: {
  value: string
  onChange: (value: string) => void
  options: DropdownOption[]
  rootClassName?: string
  variant?: 'default' | 'minimal'
  disabled?: boolean
  freezeSelection?: boolean
  menuContentWidth?: boolean
  portal?: boolean
  searchable?: boolean
  searchPlaceholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [openUp, setOpenUp] = useState(false)
  const [menuQuery, setMenuQuery] = useState('')
  const [anchor, setAnchor] = useState<{ left: number; right: number; top: number; bottom: number; width: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const minimal = variant === 'minimal'

  // Measure the trigger and decide flip direction. Portal menus only care
  // about the viewport (nothing clips them); inline menus also respect the
  // nearest scroll container via the shared helper.
  const measure = useCallback(() => {
    const el = buttonRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setAnchor({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width })
    if (portal) {
      const menuH = Math.min(options.length * 36 + 8, minimal ? 160 : 220)
      const below = window.innerHeight - rect.bottom
      setOpenUp(below < menuH && rect.top > below)
    } else {
      setOpenUp(computeDropdownOpenUp(el, options.length, minimal))
    }
  }, [portal, options.length, minimal])

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current && !ref.current.contains(target) && !(menuRef.current && menuRef.current.contains(target))) {
        setOpen(false)
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // Recompute placement on scroll/resize while open — centralized helper,
    // single listener pair per open dropdown.
    const recompute = () => measure()
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKey)
    window.addEventListener('resize', recompute)
    document.addEventListener('scroll', recompute, true)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKey)
      window.removeEventListener('resize', recompute)
      document.removeEventListener('scroll', recompute, true)
    }
  }, [open, measure])

  const handleToggle = useCallback(() => {
    if (disabled) return
    if (!open) {
      // Flip upward when the menu wouldn't fit below — an absolutely
      // positioned menu still grows the scroll container, so opening
      // downward near the bottom pops a scrollbar (layout shift).
      measure()
      setMenuQuery('')
    }
    setOpen((o) => !o)
  }, [disabled, open, measure])

  const selected = options.find((o) => o.value === value)

  const q = menuQuery.trim().toLowerCase()
  const visibleOptions = !searchable || !q
    ? options
    : options.filter((o) => o.label.toLowerCase().includes(q))

  const selectAndClose = (v: string) => { onChange(v); setOpen(false); setMenuQuery('') }

  const menuMaxH = minimal ? 'max-h-[160px]' : 'max-h-[220px]'
  const menuClass = portal
    ? `fixed z-[300] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[12px] p-1 shadow-none overflow-y-auto animate-scale-in ${menuMaxH} ${menuContentWidth ? 'w-max' : ''}`
    : `absolute z-50 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[12px] p-1 shadow-none overflow-y-auto animate-scale-in ${menuMaxH} ${menuContentWidth ? 'left-auto right-0 w-max max-w-[240px]' : 'left-0 right-0'} ${openUp ? 'bottom-full mb-1' : 'top-full mt-1'}`

  const portalStyle: React.CSSProperties | undefined = portal && anchor ? {
    ...(menuContentWidth
      ? { right: Math.max(8, window.innerWidth - anchor.right), maxWidth: 'min(240px, calc(100vw - 1rem))' }
      : { left: anchor.left, width: anchor.width }),
    ...(openUp ? { bottom: window.innerHeight - anchor.top + 4 } : { top: anchor.bottom + 4 }),
  } : undefined

  const menu = open && (
    <div ref={menuRef} className={menuClass} style={portalStyle}>
      {searchable && (
        <div className="sticky top-0 z-10 -mx-1 px-3 pb-2 bg-[var(--bg-elevated)]">
          <input
            type="text"
            value={menuQuery}
            onChange={(e) => setMenuQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && visibleOptions.length > 0) {
                e.preventDefault()
                selectAndClose(visibleOptions[0].value)
              }
              e.stopPropagation()
            }}
            placeholder={searchPlaceholder}
            autoFocus={!freezeSelection}
            aria-label="Filter options"
            className="block w-full px-0 py-1.5 text-[12px] bg-transparent border-0 border-b border-[var(--border-subtle)] rounded-none text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--text-secondary)]"
          />
        </div>
      )}
      {visibleOptions.length === 0 && (
        <p className="px-2.5 py-2 text-[12px] text-[var(--text-muted)]">No matches</p>
      )}
      {visibleOptions.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value || '__placeholder__'}
            type="button"
            onClick={() => selectAndClose(o.value)}
            className={`w-full flex items-center justify-between gap-2 text-left rounded-[8px] transition-colors cursor-pointer ${minimal ? 'px-2 py-1.5 text-[11px]' : 'px-2.5 py-2 text-[12px]'} ${active ? 'text-[var(--text-heading)] font-medium' : 'text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)]'}`}
          >
            <span className="flex items-center gap-2 min-w-0 flex-1">
              {o.icon}
              <span className="truncate">{o.label}</span>
            </span>
            {active && <Check size={14} className="shrink-0 text-[var(--accent-brown)]" />}
          </button>
        )
      })}
    </div>
  )

  return (
    <div
      ref={ref}
      className={`relative ${rootClassName}`}
      // Bubble use: keep editor focus + selection intact while picking.
      onMouseDown={freezeSelection ? (e) => e.preventDefault() : undefined}
    >
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={handleToggle}
        className={minimal
          ? 'flex items-center gap-1 h-6 pl-1.5 pr-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] rounded-[5px] bg-transparent border-0 outline-none cursor-pointer disabled:opacity-60 w-full'
          : 'flex items-center justify-between gap-2 w-full border border-[var(--border-subtle)] rounded-[8px] px-3 py-1.5 text-[12px] bg-transparent text-[var(--text)] outline-none transition-colors cursor-pointer hover:border-[var(--text-secondary)] disabled:opacity-60'}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          {selected?.icon}
          <span className="truncate">{selected?.label ?? value}</span>
        </span>
        <ChevronDown size={14} className={`shrink-0 transition-transform duration-150 ${minimal ? 'w-3 h-3 opacity-60' : 'text-[var(--text-muted)]'} ${open ? 'rotate-180' : ''}`} />
      </button>
      {portal ? (menu && createPortal(menu, document.body)) : menu}
    </div>
  )
}
