import { useState } from 'react'
import { X } from 'lucide-react'
import { API_BASE } from '../lib/api'
import { toast } from '../stores/toastStore'

export interface ImageLogEntry {
  id?: string
  timestamp?: string
  prompt?: string
  final_prompt?: string
  style?: string | null
  provider?: string
  reference_path?: string | null
  seed?: number | null
  path?: string
}

function MetaRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] w-16 shrink-0 pt-0.5">{label}</span>
      <span className={`text-[11px] text-[var(--text-secondary)] break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

export function ImageDetailPopup({ log, onClose }: { log: ImageLogEntry; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const [revealMsg, setRevealMsg] = useState<string | null>(null)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(log.final_prompt || log.prompt || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy image prompt:', err)
      toast.error('Could not copy to clipboard.')
    }
  }

  const handleReveal = async () => {
    setRevealMsg(null)
    try {
      const res = await fetch(`${API_BASE}/api/images/reveal`, { method: 'POST' })
      if (!res.ok) {
        let detail = 'Could not open folder'
        try {
          const data = await res.json()
          if (data?.detail) detail = data.detail
        } catch { /* ignore */ }
        throw new Error(detail)
      }
    } catch (err) {
      setRevealMsg(err instanceof Error ? err.message : 'Could not open folder')
      setTimeout(() => setRevealMsg(null), 4000)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/25 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 shadow-xl font-sans">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[14px] font-medium text-[var(--text-heading)] truncate">
              {(log.prompt || log.final_prompt || 'Generated image').slice(0, 80)}
            </h3>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              {log.timestamp ? new Date(log.timestamp).toLocaleString() : ''}
              {log.provider ? ` · ${log.provider}` : ''}
              {log.reference_path ? ' · imagined again' : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-heading)] transition-colors cursor-pointer shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-3 flex gap-3">
          {log.reference_path && (
            <div className="flex-1 min-w-0">
              <div className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Input</div>
              <img
                src={`${API_BASE}/api/workspace/media/${log.reference_path}`}
                alt="Reference"
                className="w-full rounded-[6px] border border-[var(--border-subtle)] object-cover"
              />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Output</div>
            {log.path ? (
              <img
                src={`${API_BASE}/api/workspace/media/${log.path}`}
                alt=""
                className="w-full rounded-[6px] border border-[var(--border-subtle)] object-cover"
              />
            ) : (
              <div className="w-full h-24 rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-hover)]" />
            )}
          </div>
        </div>

        <div className="mt-3">
          <div className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Submitted prompt</div>
          <div className="text-[12px] text-[var(--text)] leading-relaxed whitespace-pre-wrap break-words max-h-[140px] overflow-y-auto">
            {log.final_prompt || log.prompt || '—'}
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-1.5">
          {log.seed != null && <MetaRow label="Seed" value={String(log.seed)} mono />}
          {log.style ? <MetaRow label="Style" value={log.style} /> : null}
          {log.path ? <MetaRow label="Output" value={log.path} mono /> : null}
          {log.reference_path ? <MetaRow label="Input" value={log.reference_path} mono /> : null}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 text-[12px] bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[6px] hover:border-[var(--text-secondary)] transition-colors cursor-pointer text-[var(--text)]"
          >
            {copied ? 'Copied' : 'Copy prompt'}
          </button>
          <button
            onClick={handleReveal}
            className="px-3 py-1.5 text-[12px] bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[6px] hover:border-[var(--text-secondary)] transition-colors cursor-pointer text-[var(--text)]"
          >
            Open folder
          </button>
          {revealMsg && <span className="text-[11px] text-red-500">{revealMsg}</span>}
        </div>
      </div>
    </div>
  )
}
