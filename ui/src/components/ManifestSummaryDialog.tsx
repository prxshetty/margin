import React, { useState, useEffect, useCallback, useRef } from 'react'
import { X, FileText, Sparkles, Loader2, Save, Activity } from 'lucide-react'
import { API_BASE } from '../lib/api'
import { TelemetryViewerModal, type TelemetryData } from './TelemetryViewerModal'
import { useEditorStore } from '../stores/editorStore'
import { refreshWorkspaceStatus } from '../lib/workspaceStatus'

interface ManifestSummaryDialogProps {
  isOpen: boolean
  onClose: () => void
  filePath: string
  manifestPath: string
  currentSummary: string
  documentContent: string
  onSummaryUpdated?: (newSummary: string) => void
}

export const ManifestSummaryDialog: React.FC<ManifestSummaryDialogProps> = ({
  isOpen,
  onClose,
  filePath,
  manifestPath,
  currentSummary,
  documentContent,
  onSummaryUpdated,
}) => {
  const isGitWorkspace = useEditorStore((s) => s.isGitWorkspace)
  const [summary, setSummary] = useState('')
  const [autoStageManifest, setAutoStageManifest] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null)
  const [showTelemetry, setShowTelemetry] = useState(false)
  const hasUserEditedRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const fileName = filePath.split('/').pop() || filePath
  const manifestFileName = manifestPath.split('/').pop() || manifestPath

  const generateSummary = useCallback(async (force = false) => {
    if (!filePath) return
    setIsGenerating(true)
    setError(null)

    try {
      const res = await fetch(`${API_BASE}/api/workspace/generate-manifest-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: filePath,
          content: documentContent,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        if (data.summary && (!hasUserEditedRef.current || force)) {
          setSummary(data.summary)
        }
        if (data.telemetry) {
          setTelemetry(data.telemetry)
        }
      } else {
        const errData = await res.json().catch(() => null)
        setError(errData?.detail || 'Failed to generate summary')
      }
    } catch (err) {
      console.error('Failed to generate manifest summary:', err)
      setError('Network error while generating summary')
    } finally {
      setIsGenerating(false)
    }
  }, [filePath, documentContent])

  useEffect(() => {
    if (isOpen) {
      hasUserEditedRef.current = false
      setSummary('')
      setError(null)
      setTelemetry(null)
      setShowTelemetry(false)
      generateSummary(false)
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 100)
    }
  }, [isOpen, generateSummary])

  const handleSave = async () => {
    if (!summary.trim() || isSaving) return
    setIsSaving(true)
    setError(null)

    try {
      const res = await fetch(`${API_BASE}/api/workspace/update-manifest-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: filePath,
          summary: summary.trim(),
          stage: Boolean(autoStageManifest && isGitWorkspace),
        }),
      })

      if (res.ok) {
        onSummaryUpdated?.(summary.trim())
        await refreshWorkspaceStatus()
        onClose()
      } else {
        const errData = await res.json().catch(() => null)
        setError(errData?.detail || 'Failed to update manifest')
      }
    } catch (err) {
      console.error('Failed to update manifest summary:', err)
      setError('Network error while updating manifest')
    } finally {
      setIsSaving(false)
    }
  }

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSaving) {
        onClose()
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (summary.trim() && !isSaving) {
          handleSave()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, summary, isSaving])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-[2px] animate-fade-in select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) onClose()
      }}
    >
      <div className="bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[12px] shadow-2xl w-full max-w-lg overflow-hidden text-[var(--text)] animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-hover)]/30">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-[var(--accent-brown)]/15 text-[var(--accent-brown)] flex items-center justify-center">
              <FileText className="w-3.5 h-3.5" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-[var(--text-heading)]">Update Manifest Summary</h3>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--text-secondary)] font-medium bg-[var(--bg-hover)] px-2 py-0.5 rounded-[4px] border border-[var(--border-subtle)]">
              {manifestFileName}
            </span>
            <span className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-hover)] px-2 py-0.5 rounded-[4px] border border-[var(--border-subtle)]">
              {fileName}
            </span>
            <button
              onClick={onClose}
              disabled={isSaving}
              className="text-[var(--text-muted)] hover:text-[var(--text-heading)] p-1 rounded-[4px] hover:bg-[var(--bg-hover)] transition-all cursor-pointer ml-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-4 space-y-3.5">
          {/* Current Manifest Summary (Read-Only) */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-medium text-[var(--text-secondary)]">
              Current Summary in <span className="font-semibold text-[var(--text-heading)]">{manifestFileName}</span>
            </label>
            <div className="p-2.5 bg-[var(--bg-hover)]/40 border border-[var(--border-subtle)] rounded-[6px] text-xs text-[var(--text-secondary)] leading-relaxed max-h-24 overflow-y-auto select-text">
              {currentSummary ? (
                <span>{currentSummary}</span>
              ) : (
                <span className="italic text-[var(--text-muted)] text-[11px]">
                  No existing summary recorded for this document in {manifestFileName}.
                </span>
              )}
            </div>
          </div>

          {/* AI Summary Header & Controls */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="manifest-summary-input" className="block text-[11px] font-medium text-[var(--text-heading)]">
                New Summary <span className="text-[var(--danger)]">*</span>
              </label>
              <div className="flex items-center gap-2">
                {telemetry && (
                  <button
                    type="button"
                    onClick={() => setShowTelemetry(true)}
                    className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-heading)] bg-[var(--bg-hover)] hover:bg-[var(--border-subtle)]/40 px-2 py-0.5 rounded-[4px] border border-[var(--border-subtle)] flex items-center gap-1 transition-all cursor-pointer"
                    title="View LLM prompts, raw output & token telemetry"
                  >
                    <Activity className="w-3 h-3 text-[var(--accent-brown)]" />
                    <span>Telemetry</span>
                    {telemetry.usage?.total_tokens ? (
                      <span className="text-[9px] text-[var(--text-muted)] font-mono">
                        ({telemetry.usage.total_tokens}t)
                      </span>
                    ) : null}
                  </button>
                )}

                {isGenerating ? (
                  <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-secondary)]">
                    <Loader2 className="w-3 h-3 text-[var(--accent-brown)] animate-spin" />
                    <span>AI is drafting summary...</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => generateSummary(true)}
                    disabled={isGenerating || isSaving}
                    className="text-[10px] text-[var(--accent-brown)] hover:text-[var(--accent-brown-hover)] font-medium flex items-center gap-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:underline"
                  >
                    <Sparkles className="w-2.5 h-2.5" />
                    <span>Regenerate</span>
                  </button>
                )}
              </div>
            </div>

            {/* Editable Textarea */}
            <div className="relative">
              <textarea
                ref={textareaRef}
                id="manifest-summary-input"
                value={summary}
                onChange={(e) => {
                  hasUserEditedRef.current = true
                  setSummary(e.target.value)
                }}
                placeholder={isGenerating ? 'Generating single-paragraph summary...' : 'Enter a single-paragraph summary of this document...'}
                disabled={isSaving}
                rows={4}
                className="w-full px-3 py-2 bg-[var(--bg-editor)] border border-[var(--border-subtle)] focus:border-[var(--assist-focus-ring)] rounded-[6px] text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none transition-all resize-none shadow-inner leading-relaxed select-text"
              />
            </div>

            {/* Auto-stage Manifest Checkbox (hidden if git not available) */}
            {isGitWorkspace && (
              <label className="flex items-center gap-2 text-xs text-[var(--text)] cursor-pointer select-none pt-0.5">
                <input
                  type="checkbox"
                  checked={autoStageManifest}
                  onChange={(e) => setAutoStageManifest(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-[var(--border-subtle)] text-[var(--accent-brown)] focus:ring-[var(--accent-brown)] cursor-pointer accent-[var(--accent-brown)]"
                />
                <span className="text-[11px] text-[var(--text-secondary)]">Stage manifest change immediately</span>
              </label>
            )}

            {error && (
              <p className="text-[10px] text-[var(--danger)]">{error}</p>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-hover)]/20">
          <span className="text-[10px] text-[var(--text-muted)]">
            Press <kbd className="px-1 py-0.5 rounded bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[9px]">⌘+Enter</kbd> to save
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-3 py-1.5 rounded-[6px] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] border border-transparent hover:border-[var(--border-subtle)] transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!summary.trim() || isSaving}
              className="px-3 py-1.5 rounded-[6px] text-xs font-medium bg-[var(--accent-brown)] text-white hover:bg-[var(--accent-brown-hover)] transition-all flex items-center gap-1.5 shadow-sm cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>{isSaving ? 'Updating...' : 'Update Manifest'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Telemetry Viewer Modal */}
      <TelemetryViewerModal
        isOpen={showTelemetry}
        onClose={() => setShowTelemetry(false)}
        title={`Manifest Summary (${manifestFileName})`}
        telemetry={telemetry}
      />
    </div>
  )
}
