import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Activity, Cpu, Database, FileCode, Check, Copy, Clock } from 'lucide-react'

export interface TelemetryData {
  model?: string
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  } | null
  duration_s?: number
  system_prompt?: string
  user_prompt?: string
  raw_output?: string
}

interface TelemetryViewerModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  telemetry: TelemetryData | null
}

export const TelemetryViewerModal: React.FC<TelemetryViewerModalProps> = ({
  isOpen,
  onClose,
  title,
  telemetry,
}) => {
  const [activeTab, setActiveTab] = useState<'system' | 'user' | 'output'>('system')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setActiveTab('system')
      setCopied(false)
    }
  }, [isOpen])

  if (!isOpen || !telemetry) return null

  const usage = telemetry.usage
  const promptTokens = usage?.prompt_tokens ?? 0
  const completionTokens = usage?.completion_tokens ?? 0
  const totalTokens = usage?.total_tokens ?? (promptTokens + completionTokens)
  const durationS = telemetry.duration_s

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const currentText =
    activeTab === 'output'
      ? telemetry.raw_output || '(No raw output)'
      : activeTab === 'system'
      ? telemetry.system_prompt || '(No system prompt)'
      : telemetry.user_prompt || '(No user prompt)'

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/55 backdrop-blur-[2px] animate-fade-in select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[12px] shadow-2xl w-[680px] max-w-[90vw] h-[560px] max-h-[85vh] overflow-hidden text-[var(--text)] animate-scale-in flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-hover)]/40">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-[var(--accent-brown)]/15 text-[var(--accent-brown)] flex items-center justify-center">
              <Activity className="w-3.5 h-3.5" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-[var(--text-heading)]">
                Telemetry — {title}
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-heading)] p-1 rounded-[4px] hover:bg-[var(--bg-hover)] transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Metrics Bar */}
        <div className="px-4 py-2.5 bg-[var(--bg-hover)]/20 border-b border-[var(--border-subtle)] flex flex-wrap items-center gap-4 text-[11px]">
          <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
            <Cpu className="w-3.5 h-3.5 text-[var(--accent-brown)]" />
            <span className="font-medium text-[var(--text-heading)]">Model:</span>
            <span className="font-mono bg-[var(--bg-input)] px-1.5 py-0.5 rounded border border-[var(--border-subtle)]">
              {telemetry.model || 'Unknown / Default'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
            <Database className="w-3.5 h-3.5 text-[var(--accent-green)]" />
            <span className="font-medium text-[var(--text-heading)]">Tokens:</span>
            <div className="flex items-center gap-1 font-mono text-[10px]">
              <span className="bg-[var(--bg-input)] px-1.5 py-0.5 rounded border border-[var(--border-subtle)]" title="Prompt tokens">
                Prompt: {promptTokens}
              </span>
              <span className="text-[var(--text-muted)]">+</span>
              <span className="bg-[var(--bg-input)] px-1.5 py-0.5 rounded border border-[var(--border-subtle)]" title="Completion tokens">
                Output: {completionTokens}
              </span>
              <span className="text-[var(--text-muted)]">=</span>
              <span className="bg-[var(--accent-brown)]/15 text-[var(--accent-brown)] font-bold px-1.5 py-0.5 rounded border border-[var(--accent-brown)]/30" title="Total tokens">
                Total: {totalTokens}
              </span>
            </div>
          </div>

          {durationS !== undefined && (
            <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
              <Clock className="w-3.5 h-3.5 text-[var(--accent-brown)]" />
              <span className="font-medium text-[var(--text-heading)]">Elapsed:</span>
              <span className="font-mono bg-[var(--bg-input)] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] font-bold text-[var(--text-heading)]">
                {durationS < 1 ? `${(durationS * 1000).toFixed(0)}ms` : `${durationS.toFixed(2)}s`}
              </span>
            </div>
          )}
        </div>

        {/* Prompt / Output Navigation Tabs */}
        <div className="flex items-center justify-between px-4 pt-3 pb-1 border-b border-[var(--border-subtle)] bg-[var(--bg)]">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('system')}
              className={`px-3 py-1 rounded-t-[6px] text-xs font-medium transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
                activeTab === 'system'
                  ? 'border-[var(--accent-brown)] text-[var(--text-heading)] bg-[var(--bg-hover)]/50'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)]/30'
              }`}
            >
              <span>System Prompt</span>
            </button>
            <button
              onClick={() => setActiveTab('user')}
              className={`px-3 py-1 rounded-t-[6px] text-xs font-medium transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
                activeTab === 'user'
                  ? 'border-[var(--accent-brown)] text-[var(--text-heading)] bg-[var(--bg-hover)]/50'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)]/30'
              }`}
            >
              <span>User Prompt</span>
            </button>
            <button
              onClick={() => setActiveTab('output')}
              className={`px-3 py-1 rounded-t-[6px] text-xs font-medium transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
                activeTab === 'output'
                  ? 'border-[var(--accent-brown)] text-[var(--text-heading)] bg-[var(--bg-hover)]/50'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)]/30'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Raw AI Output</span>
            </button>
          </div>

          <button
            onClick={() => handleCopy(currentText)}
            className="px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] rounded-[4px] border border-[var(--border-subtle)] flex items-center gap-1 transition-all cursor-pointer"
          >
            {copied ? <Check className="w-3 h-3 text-[var(--accent-green)]" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>

        {/* Content Viewer */}
        <div className="flex-1 min-h-0 p-4 overflow-y-auto bg-[var(--bg-editor)] font-mono text-[11px] leading-relaxed select-text whitespace-pre-wrap text-[var(--text)] break-words">
          {currentText}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-[var(--border-subtle)] bg-[var(--bg-hover)]/20 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1 rounded-[6px] text-xs font-medium bg-[var(--bg-hover)] text-[var(--text)] hover:bg-[var(--border-subtle)] transition-all cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
