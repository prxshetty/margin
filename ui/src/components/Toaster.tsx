import { Check, X } from 'lucide-react'
import { useToastStore, type Toast } from '../stores/toastStore'

// Minimalist treatment: one flat surface for every kind, color reserved
// for the glyph only. No tinted backgrounds, no heavy shadows.
const GLYPH_STYLES: Record<Toast['kind'], string> = {
  success: 'text-[var(--accent-green)]',
  error: 'text-red-400',
  info: 'text-[var(--text-muted)]',
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  if (toasts.length === 0) return null
  return (
    <div className="fixed top-4 right-4 z-[10010] flex flex-col gap-2 items-end">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className="animate-scale-in flex items-center gap-2 max-w-[320px] text-left px-3 py-2.5 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] cursor-pointer"
        >
          <span className="flex items-center justify-center w-6 h-6 rounded-[6px] bg-[var(--bg-hover)] shrink-0">
            {t.kind === 'error'
              ? <X size={13} className={GLYPH_STYLES[t.kind]} />
              : <Check size={13} className={GLYPH_STYLES[t.kind]} />}
          </span>
          <span className={`text-[12.5px] leading-snug ${t.kind === 'error' ? 'text-red-500' : 'text-[var(--text-heading)]'}`}>
            {t.message}
          </span>
        </button>
      ))}
    </div>
  )
}
