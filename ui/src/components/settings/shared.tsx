import { matchesQuery } from './query'

// Hides a section when a search query is active and doesn't match.
export function FilterSection({ keywords, query, children }: { keywords: string; query: string; children: React.ReactNode }) {
  if (!matchesQuery(query, keywords)) return null
  return <>{children}</>
}

export function SectionCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  // No overflow-hidden here: it would clip floating Dropdown menus. Rounded
  // corners are preserved by rounding the first/last child instead.
  return (
    <div className={`rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 divide-y divide-[var(--border-subtle)]/60 [&>*:first-child]:rounded-t-[11px] [&>*:last-child]:rounded-b-[11px] ${className}`}>
      {children}
    </div>
  )
}

export function SectionLabel({ children, description }: { children: React.ReactNode; description?: React.ReactNode }) {
  return (
    <div className="mb-2">
      <h4 className="text-[15px] font-medium text-[var(--text-heading)]">{children}</h4>
      {description && <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">{description}</p>}
    </div>
  )
}

export function Row({ label, description, control }: { label: string; description?: string; control: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-[var(--text-heading)]">{label}</div>
        {description && <div className="text-[12px] text-[var(--text-secondary)] mt-0.5">{description}</div>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${checked ? 'bg-[var(--accent-brown)]' : 'bg-[var(--border-subtle)]'}`}
    >
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}

export function EndpointLogo({ size = 15, className = '' }: { size?: number | string; className?: string }) {
  return (
    <svg width={size} height={size} className={`${className} shrink-0`} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M5.5 13L7 11.5l5.5 5.5l-1.5 1.5c-.75.75-3.5 2-5.5 0s-.75-4.75 0-5.5ZM3 21l2.5-2.5m13-7.5L17 12.5L11.5 7L13 5.5c.75-.75 3.5-2 5.5 0s.75 4.75 0 5.5Zm-6-3l-2 2M21 3l-2.5 2.5m-2.5 6l-2 2" />
    </svg>
  )
}
