import { useState, useEffect, useRef } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export interface DropdownOption {
  value: string
  label: string
  title?: string
  icon?: React.ReactNode
}

// Shared dropdown: bordered input-style trigger by default, transparent
// minimal trigger for tight surfaces (editor bubble). Menu, checkmarks,
// flip-up, Escape and click-outside are identical in both variants.
export function Dropdown({ value, onChange, options, rootClassName = '', variant = 'default', disabled = false, freezeSelection = false, title, menuContentWidth = false }: {
  value: string
  onChange: (value: string) => void
  options: DropdownOption[]
  rootClassName?: string
  variant?: 'default' | 'minimal'
  disabled?: boolean
  freezeSelection?: boolean
  title?: string
  menuContentWidth?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [openUp, setOpenUp] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const handleToggle = () => {
    if (disabled) return
    if (!open && buttonRef.current) {
      // Flip upward when the menu wouldn't fit below — an absolutely
      // positioned menu still grows the scroll container, so opening
      // downward near the bottom pops a scrollbar (layout shift).
      const rect = buttonRef.current.getBoundingClientRect()
      const menuH = Math.min(options.length * 36 + 8, 220)
      const below = window.innerHeight - rect.bottom
      setOpenUp(below < menuH && rect.top > below)
    }
    setOpen((o) => !o)
  }

  const selected = options.find((o) => o.value === value)
  const minimal = variant === 'minimal'

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
        title={title}
        onClick={handleToggle}
        className={minimal
          ? 'flex items-center gap-1 h-6 pl-1.5 pr-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] rounded-[5px] bg-transparent border-0 outline-none cursor-pointer disabled:opacity-60 w-full'
          : 'flex items-center justify-between gap-2 w-full border border-[var(--border-subtle)] rounded-[8px] px-3 py-1.5 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none transition-colors cursor-pointer hover:border-[var(--text-secondary)] disabled:opacity-60'}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          {selected?.icon}
          <span className="truncate">{selected?.label ?? value}</span>
        </span>
        <ChevronDown size={14} className={`shrink-0 transition-transform duration-150 ${minimal ? 'w-3 h-3 opacity-60' : 'text-[var(--text-muted)]'} ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className={`absolute z-50 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[12px] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)] overflow-y-auto animate-scale-in ${minimal ? 'max-h-[160px]' : 'max-h-[220px]'} ${menuContentWidth ? 'left-auto right-0 w-max max-w-[240px]' : 'left-0 right-0'} ${openUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
          {options.map((o) => {
            const active = o.value === value
            return (
              <button
                key={o.value || '__placeholder__'}
                type="button"
                title={o.title ?? o.label}
                onClick={() => { onChange(o.value); setOpen(false) }}
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
      )}
    </div>
  )
}
