import { useToastStore } from '../stores/toastStore'

const KIND_STYLES: Record<string, string> = {
  success: 'border-[var(--border-subtle)]',
  error: 'border-red-400/50',
  info: 'border-[var(--border-subtle)]',
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-4 right-4 z-[10010] flex flex-col gap-2 items-end">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          title="Dismiss"
          className={`max-w-[320px] text-left px-3.5 py-2.5 text-[12.5px] leading-snug rounded-[8px] border bg-[var(--bg-elevated)] shadow-lg cursor-pointer transition-opacity ${KIND_STYLES[t.kind] ?? KIND_STYLES.info} ${t.kind === 'error' ? 'text-red-500' : 'text-[var(--text-heading)]'}`}
        >
          {t.message}
        </button>
      ))}
    </div>
  )
}
