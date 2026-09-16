import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { X, GitCommit, Sparkles, Loader2, Activity, AlertTriangle, FileText } from 'lucide-react'
import { API_BASE } from '../lib/api'
import { TelemetryViewerModal, type TelemetryData } from './TelemetryViewerModal'
import { useEditorStore } from '../stores/editorStore'

interface CommitDialogProps {
  isOpen: boolean
  onClose: () => void
  onCommit: (title: string, comment: string) => Promise<void>
  filePath: string
  baseContent: string | null
  currentContent: string
  isCommitting?: boolean
}

export const CommitDialog: React.FC<CommitDialogProps> = ({
  isOpen,
  onClose,
  onCommit,
  filePath,
  baseContent,
  currentContent,
  isCommitting = false,
}) => {
  const [title, setTitle] = useState('')
  const [comment, setComment] = useState('')
  const [isAiGenerating, setIsAiGenerating] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null)
  const [showTelemetry, setShowTelemetry] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const hasUserEditedRef = useRef(false)

  const fileStatusMap = useEditorStore((s) => s.fileStatusMap)
  const openedFiles = useEditorStore((s) => s.openedFiles)

  const stagedFiles = useMemo(() => {
    const list: Array<{
      path: string
      name: string
      status: 'staged' | 'staged_modified' | 'auto_stage'
    }> = []

    for (const [path, status] of Object.entries(fileStatusMap)) {
      if (status === 'staged' || status === 'staged_modified') {
        const fileEntry = openedFiles.find((f) => f.path === path)
        const isDirtyInMemory = Boolean(
          fileEntry &&
          fileEntry.content &&
          fileEntry.originalContent &&
          fileEntry.content !== fileEntry.originalContent
        )
        const effectiveStatus = status === 'staged' && isDirtyInMemory ? 'staged_modified' : status
        list.push({
          path,
          name: path.split('/').pop() || path,
          status: effectiveStatus,
        })
      }
    }

    if (filePath && !list.some((f) => f.path === filePath)) {
      list.push({
        path: filePath,
        name: filePath.split('/').pop() || filePath,
        status: 'auto_stage',
      })
    }

    return list
  }, [fileStatusMap, openedFiles, filePath])

  const modifiedStagedFiles = useMemo(() => {
    return stagedFiles.filter((f) => f.status === 'staged_modified')
  }, [stagedFiles])

  const fileName = filePath.split('/').pop() || filePath

  const generateCommitMessage = useCallback(async (force = false) => {
    if (!filePath) return
    setIsAiGenerating(true)
    setAiError(null)

    try {
      const res = await fetch(`${API_BASE}/api/workspace/generate-commit-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: filePath,
          base_content: baseContent,
          current_content: currentContent,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        let parsedTitle = (data.title || '').trim()
        let parsedComment = (data.comment || '').trim()

        if (data.telemetry) {
          setTelemetry(data.telemetry)
        }

        // Fallback safety if title contains raw JSON or JSON keys
        if (
          parsedTitle.startsWith('{') ||
          parsedTitle.includes('"title":') ||
          parsedTitle.includes('"comment":')
        ) {
          try {
            const parsed = JSON.parse(parsedTitle)
            parsedTitle = String(parsed.title || parsed.commit_title || parsed.subject || parsedTitle).trim()
            if (!parsedComment && (parsed.comment || parsed.description || parsed.body)) {
              parsedComment = String(parsed.comment || parsed.description || parsed.body).trim()
            }
          } catch {
            const tMatch = parsedTitle.match(/["'](?:title|commit_title|subject)["']\s*:\s*["']([\s\S]*?)["']/)
            const cMatch = parsedTitle.match(/["'](?:comment|description|body)["']\s*:\s*["']([\s\S]*?)["']/)
            if (tMatch) parsedTitle = tMatch[1].trim()
            if (cMatch && !parsedComment) parsedComment = cMatch[1].trim()
          }
        }

        // Clean any residual braces or quotes from title
        parsedTitle = parsedTitle.replace(/^[{\["']+|[}\]\,"']+$/g, '').trim()
        parsedTitle = parsedTitle.replace(/^["']?title["']?\s*:\s*["']?/i, '').trim()
        parsedTitle = parsedTitle.replace(/["']\s*,\s*["']?(?:comment|description)["']?\s*:.*$/i, '').trim()
        parsedTitle = parsedTitle.replace(/^["'{}]+|["'{}]+$/g, '').trim()

        if (parsedTitle && (!hasUserEditedRef.current || force)) {
          setTitle(parsedTitle)
          setComment(parsedComment)
        }
      } else {
        const errData = await res.json().catch(() => null)
        setAiError(errData?.detail || 'Failed to generate commit message')
      }
    } catch (err) {
      console.error('Failed to generate commit message:', err)
      setAiError('Network error while generating commit message')
    } finally {
      setIsAiGenerating(false)
    }
  }, [filePath, baseContent, currentContent])

  useEffect(() => {
    if (isOpen) {
      hasUserEditedRef.current = false
      setTitle('')
      setComment('')
      setTelemetry(null)
      setShowTelemetry(false)
      generateCommitMessage(false)
      setTimeout(() => {
        titleInputRef.current?.focus()
      }, 100)
    }
  }, [isOpen, generateCommitMessage])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isCommitting) {
        onClose()
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (title.trim() && !isCommitting) {
          onCommit(title.trim(), comment.trim())
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, onCommit, title, comment, isCommitting])

  if (!isOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || isCommitting) return
    onCommit(title.trim(), comment.trim())
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-[2px] animate-fade-in select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isCommitting) onClose()
      }}
    >
      <div className="bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[12px] shadow-2xl w-full max-w-lg overflow-hidden text-[var(--text)] animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-hover)]/30">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-[var(--accent-green-bg)] text-[var(--accent-green)] flex items-center justify-center">
              <GitCommit className="w-3.5 h-3.5" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-[var(--text-heading)]">Commit Changes</h3>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-hover)] px-2 py-0.5 rounded-[4px] border border-[var(--border-subtle)]">
              {fileName}
            </span>
            <button
              onClick={onClose}
              disabled={isCommitting}
              className="text-[var(--text-muted)] hover:text-[var(--text-heading)] p-1 rounded-[4px] hover:bg-[var(--bg-hover)] transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit}>
          <div className="p-4 space-y-3.5">
            {/* AI Generation Status / Prompt Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                {isAiGenerating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 text-[var(--accent-brown)] animate-spin" />
                    <span>AI is drafting commit message...</span>
                  </>
                ) : aiError ? (
                  <span className="text-[var(--danger)] text-[10px]">{aiError}</span>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5 text-[var(--accent-brown)]" />
                    <span className="text-[10px] text-[var(--text-muted)]">Pre-populated by AI from document diff</span>
                  </>
                )}
              </div>
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

                <button
                  type="button"
                  onClick={() => generateCommitMessage(true)}
                  disabled={isAiGenerating || isCommitting}
                  className="text-[10px] text-[var(--accent-brown)] hover:text-[var(--accent-brown-hover)] font-medium flex items-center gap-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:underline"
                >
                  <Sparkles className="w-2.5 h-2.5" />
                  <span>Regenerate</span>
                </button>
              </div>
            </div>

            {/* Commit Title Input */}
            <div className="space-y-1">
              <label htmlFor="commit-title" className="block text-[11px] font-medium text-[var(--text-heading)]">
                Commit Title <span className="text-[var(--danger)]">*</span>
              </label>
              <div className="relative">
                <input
                  ref={titleInputRef}
                  id="commit-title"
                  type="text"
                  value={title}
                  onChange={(e) => {
                    hasUserEditedRef.current = true
                    setTitle(e.target.value)
                  }}
                  placeholder={isAiGenerating ? 'Drafting title...' : 'e.g. feat(ch01): introduce backstory...'}
                  disabled={isCommitting}
                  maxLength={120}
                  className="w-full px-3 py-1.5 bg-[var(--bg-editor)] border border-[var(--border-subtle)] focus:border-[var(--assist-focus-ring)] rounded-[6px] text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none transition-all shadow-inner"
                />
              </div>
            </div>

            {/* Commit Description / Comment Textarea */}
            <div className="space-y-1">
              <label htmlFor="commit-comment" className="block text-[11px] font-medium text-[var(--text-heading)]">
                Commit Description <span className="text-[10px] text-[var(--text-muted)] font-normal">(Optional)</span>
              </label>
              <textarea
                id="commit-comment"
                value={comment}
                onChange={(e) => {
                  hasUserEditedRef.current = true
                  setComment(e.target.value)
                }}
                placeholder={isAiGenerating ? 'Drafting description...' : 'Add additional notes, chapter context, or details...'}
                disabled={isCommitting}
                rows={3}
                className="w-full px-3 py-2 bg-[var(--bg-editor)] border border-[var(--border-subtle)] focus:border-[var(--assist-focus-ring)] rounded-[6px] text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none transition-all resize-none shadow-inner leading-relaxed"
              />
            </div>

            {/* Staged Files List Section */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-[11px] font-medium text-[var(--text-heading)]">
                <span>Staged Files to Commit ({stagedFiles.length})</span>
                {modifiedStagedFiles.length > 0 && (
                  <span className="text-[10px] text-amber-700 dark:text-amber-400 font-normal flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span>{modifiedStagedFiles.length} file{modifiedStagedFiles.length > 1 ? 's have' : ' has'} unstaged edits</span>
                  </span>
                )}
              </div>

              <div className="max-h-28 overflow-y-auto rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-editor)] p-1.5 space-y-1">
                {stagedFiles.map((file) => (
                  <div
                    key={file.path}
                    className="flex items-center justify-between px-2 py-1 rounded bg-[var(--bg)] border border-[var(--border-subtle)]/60 text-xs"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileText className="w-3.5 h-3.5 shrink-0 text-[var(--text-muted)]" />
                      <span className="truncate font-mono text-[11px] text-[var(--text)]" title={file.path}>
                        {file.path}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {file.status === 'staged_modified' ? (
                        <span
                          className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded leading-none bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/25 flex items-center gap-0.5 select-none"
                          title="Staged & Modified (unstaged changes present)"
                        >
                          <span className="text-emerald-700 dark:text-emerald-300 font-bold">S</span>
                          <span className="text-[8px] opacity-60">/</span>
                          <span>M</span>
                        </span>
                      ) : file.status === 'auto_stage' ? (
                        <span
                          className="text-[9px] font-mono font-medium px-1.5 py-0.5 rounded leading-none bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/25 select-none"
                          title="Will be staged and committed"
                        >
                          Auto-Stage &amp; Commit
                        </span>
                      ) : (
                        <span
                          className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded leading-none bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/25 select-none"
                          title="Staged"
                        >
                          S
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Warning Alert if any staged files have unstaged edits */}
              {modifiedStagedFiles.length > 0 && (
                <div className="p-2 rounded-[6px] bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-[11px] flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="leading-tight">
                    <span className="font-semibold">Notice:</span> Unstaged modifications in{' '}
                    <span className="font-mono text-[10px] underline">{modifiedStagedFiles.map((f) => f.name).join(', ')}</span>{' '}
                    will <span className="font-semibold">not</span> be included in this commit. Click <span className="font-medium">Stage</span> on the document if you want to include latest changes.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-hover)]/20">
            <span className="text-[10px] text-[var(--text-muted)]">
              Press <kbd className="px-1 py-0.5 rounded bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[9px]">⌘+Enter</kbd> to commit
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isCommitting}
                className="px-3 py-1.5 rounded-[6px] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] border border-transparent hover:border-[var(--border-subtle)] transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!title.trim() || isCommitting}
                className="px-3 py-1.5 rounded-[6px] text-xs font-medium bg-[var(--accent-brown)] text-white hover:bg-[var(--accent-brown-hover)] transition-all flex items-center gap-1.5 shadow-sm cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <GitCommit className={`w-3.5 h-3.5 ${isCommitting ? 'animate-spin' : ''}`} />
                <span>{isCommitting ? 'Committing...' : 'Commit Changes'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Telemetry Viewer Modal */}
      <TelemetryViewerModal
        isOpen={showTelemetry}
        onClose={() => setShowTelemetry(false)}
        title={`Git Commit (${fileName})`}
        telemetry={telemetry}
      />
    </div>
  )
}
