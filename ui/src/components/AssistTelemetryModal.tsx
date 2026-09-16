import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Activity,
  Cpu,
  Database,
  FileCode,
  Check,
  Copy,
  Layers,
  FileText,
  Terminal,
  Brain,
  MessageSquare,
  Wrench,
  Percent,
  Sparkles,
  Bookmark,
  AtSign,
  Clock,
  AlertTriangle,
} from 'lucide-react'

export function formatLocalTimestamp(isoString?: string): string {
  if (!isoString) return ''
  let normalized = isoString
  if (!normalized.endsWith('Z') && !/[+-]\d{2}(:\d{2})?$/.test(normalized)) {
    normalized += 'Z'
  }
  const date = new Date(normalized)
  return isNaN(date.getTime()) ? isoString : date.toLocaleString()
}

export interface AssistLogEntry {
  id: string
  timestamp: string
  mode: 'chat' | 'edit_plan' | 'edit_write' | string
  session_id?: string
  system_prompt: string
  user_prompt: string
  output: string
  instruction?: string
  selected_text?: string
  text_before?: string
  text_after?: string
  target_paragraph?: string
  ref_files?: Array<{ name: string; path: string }>
  injected_files?: string[]
  active_filename?: string
  context_window?: number
  harness_command?: string
  workspace_path?: string
  success?: boolean
  thinking_output?: string
  planner_system_prompt?: string
  planner_user_prompt?: string
  planner_output?: string
  planner_tokens?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  } | null
  planner_model?: string
  planner_thinking_output?: string
  duration_s?: number
  planner_duration_s?: number
  writer_duration_s?: number
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  model_used?: string
  tool_calls?: Array<{ tool: string; detail: string; path?: string }>
}

interface AssistTelemetryModalProps {
  isOpen: boolean
  onClose: () => void
  log: AssistLogEntry | null
}

export const AssistTelemetryModal: React.FC<AssistTelemetryModalProps> = ({
  isOpen,
  onClose,
  log,
}) => {
  const isDualAgent = Boolean(log?.planner_system_prompt || log?.planner_output)
  const isHarness = Boolean(log?.tool_calls && log.tool_calls.length > 0) || Boolean(log?.harness_command) || (log?.model_used?.includes(':') ?? false)

  // Sub-step interaction switcher for multi-step interactions
  type TabType = 'overview' | 'system' | 'user' | 'thinking' | 'output' | 'tools'
  type StepType = 'overview' | 'planner' | 'generator'

  const [activeStep, setActiveStep] = useState<StepType>('overview')
  const [activeTab, setActiveTab] = useState<TabType>('overview')
  const [stepTabs, setStepTabs] = useState<Record<StepType, TabType>>({
    overview: 'overview',
    planner: 'system',
    generator: 'system',
  })
  const [copied, setCopied] = useState(false)
  const [copiedAll, setCopiedAll] = useState(false)

  // Reset tab when log changes
  React.useEffect(() => {
    if (log) {
      setActiveStep('overview')
      setActiveTab('overview')
      setStepTabs({
        overview: 'overview',
        planner: 'system',
        generator: 'system',
      })
    }
  }, [log?.id])

  if (!isOpen || !log) return null

  const promptTokens = log.prompt_tokens ?? 0
  const completionTokens = log.completion_tokens ?? 0
  const totalTokens = log.total_tokens ?? (promptTokens + completionTokens)

  const plannerPromptTokens = log.planner_tokens?.prompt_tokens ?? 0
  const plannerCompletionTokens = log.planner_tokens?.completion_tokens ?? 0
  const plannerTotalTokens = log.planner_tokens?.total_tokens ?? (plannerPromptTokens + plannerCompletionTokens)

  const combinedTokens = isDualAgent ? (totalTokens + plannerTotalTokens) : totalTokens

  const contextWindow = log.context_window || (isHarness ? 200000 : 8192)
  const percentUsed = Math.min(100, (promptTokens / contextWindow) * 100)

  // Parse planner context files
  const plannerContextFiles: string[] = (() => {
    if (!log.planner_output) return []
    try {
      const start = log.planner_output.indexOf('{')
      const end = log.planner_output.lastIndexOf('}') + 1
      if (start !== -1 && end > start) {
        const data = JSON.parse(log.planner_output.slice(start, end))
        if (Array.isArray(data.context_needed)) {
          return data.context_needed
        }
      }
    } catch {
      // ignore
    }
    return []
  })()

  // Parse planner refined query
  const plannerRefinedQuery: string = (() => {
    if (!log.planner_output) return ''
    try {
      const start = log.planner_output.indexOf('{')
      const end = log.planner_output.lastIndexOf('}') + 1
      if (start !== -1 && end > start) {
        const data = JSON.parse(log.planner_output.slice(start, end))
        return data.refined_query || ''
      }
    } catch {
      // ignore
    }
    return ''
  })()

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleCopyAll = () => {
    navigator.clipboard.writeText(JSON.stringify(log, null, 2))
    setCopiedAll(true)
    setTimeout(() => setCopiedAll(false), 1500)
  }

  const handleStepChange = (step: StepType) => {
    setActiveStep(step)
    let targetTab = stepTabs[step] || (step === 'overview' ? 'overview' : 'system')
    if (step === 'overview') {
      targetTab = 'overview'
    } else if (step === 'planner') {
      const plannerThinking = log?.planner_thinking_output || (log?.mode === 'edit_plan' ? log?.thinking_output : '')
      const hasThinking = Boolean(plannerThinking)
      const hasTools = Boolean(log?.tool_calls && log.tool_calls.length > 0)
      if (targetTab === 'thinking' && !hasThinking) targetTab = 'system'
      if (targetTab === 'tools' && !hasTools) targetTab = 'system'
      if (targetTab === 'overview') targetTab = 'system'
    } else if (step === 'generator') {
      const generatorThinking = log?.thinking_output || ''
      const hasThinking = Boolean(generatorThinking)
      const hasTools = Boolean(log?.tool_calls && log.tool_calls.length > 0)
      if (targetTab === 'thinking' && !hasThinking) targetTab = 'system'
      if (targetTab === 'tools' && !hasTools) targetTab = 'system'
      if (targetTab === 'overview') targetTab = 'system'
    }
    setActiveTab(targetTab)
  }

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    setStepTabs(prev => ({
      ...prev,
      [activeStep]: tab,
    }))
  }

  // Active step prompt, thinking, & output values
  const currentModel =
    activeStep === 'planner'
      ? log.planner_model || log.model_used || 'Planner'
      : activeStep === 'generator'
      ? log.model_used || 'Default / Active Endpoint'
      : isDualAgent
      ? `${log.planner_model || 'Planner'} → ${log.model_used || 'Writer'}`
      : log.model_used || 'Default'

  const currentStepPromptTokens =
    activeStep === 'planner'
      ? plannerPromptTokens
      : activeStep === 'generator'
      ? promptTokens
      : (plannerPromptTokens + promptTokens)

  const currentStepCompletionTokens =
    activeStep === 'planner'
      ? plannerCompletionTokens
      : activeStep === 'generator'
      ? completionTokens
      : (plannerCompletionTokens + completionTokens)

  const currentStepTotalTokens =
    activeStep === 'planner'
      ? plannerTotalTokens
      : activeStep === 'generator'
      ? totalTokens
      : combinedTokens

  const currentStepDuration =
    activeStep === 'planner'
      ? log.planner_duration_s
      : activeStep === 'generator'
      ? (log.writer_duration_s ?? log.duration_s)
      : log.duration_s

  const currentSystemPrompt =
    activeStep === 'planner'
      ? log.planner_system_prompt || '(No planner system prompt)'
      : log.system_prompt || '(No system prompt)'

  const currentUserPrompt =
    activeStep === 'planner'
      ? log.planner_user_prompt || '(No planner user prompt)'
      : log.user_prompt || '(No user prompt)'

  const currentThinking =
    activeStep === 'planner'
      ? log.planner_thinking_output || (log.mode === 'edit_plan' ? log.thinking_output : '')
      : log.thinking_output || ''

  const currentRawOutput =
    activeStep === 'planner'
      ? log.planner_output || '(No planner output)'
      : log.output || '(No output)'

  const currentTextForCopy =
    activeTab === 'overview'
      ? `=== USER PROMPT ===\n${log.instruction || log.user_prompt || ''}\n\n=== RAW GENERATOR OUTPUT ===\n${log.output || ''}`
      : activeTab === 'system'
      ? currentSystemPrompt
      : activeTab === 'user'
      ? currentUserPrompt
      : activeTab === 'thinking'
      ? currentThinking || ''
      : activeTab === 'tools'
      ? JSON.stringify(log.tool_calls || [], null, 2)
      : currentRawOutput

  // Distinct categorization of injected files
  const userTaggedFiles = log.ref_files || []
  const plannerSelectedSet = new Set(plannerContextFiles.map(f => f.toLowerCase()))
  const allInjectedPaths = log.injected_files || []

  // Planner discovered files that were injected into the prompt
  const plannerInjectedFiles = plannerContextFiles

  // Pinned/System files injected by backend that weren't part of plannerContextFiles
  const pinnedInjectedFiles = allInjectedPaths.filter(p => {
    const norm = p.toLowerCase()
    return !plannerSelectedSet.has(norm) && !plannerContextFiles.some(f => norm.endsWith(f.toLowerCase()))
  })

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6 bg-black/60 backdrop-blur-[2px] animate-fade-in select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[14px] shadow-2xl w-full max-w-4xl h-[85vh] overflow-hidden text-[var(--text)] animate-scale-in flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-hover)]/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-full bg-[var(--accent-brown)]/15 text-[var(--accent-brown)] flex items-center justify-center shadow-xs">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold text-[var(--text-heading)]">
                  Assist Telemetry & Context Inspector
                </h3>
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)]"
                  title="Execution architecture mode: dual-agent endpoint planner & writer, conversational chat, or autonomous CLI harness"
                >
                  {isHarness
                    ? `Harness: ${log.model_used?.split(':')[0] || 'CLI'}`
                    : isDualAgent
                    ? 'Endpoint: Dual-Agent Edit'
                    : log.mode === 'chat'
                    ? 'Endpoint: Chat'
                    : 'Endpoint: Edit'}
                </span>
              </div>
              <p className="text-[10.5px] text-[var(--text-muted)] font-sans truncate max-w-[500px]">
                {log.instruction || log.user_prompt?.slice(0, 80) || 'AI Interaction'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyAll}
              className="px-2.5 py-1 text-[10.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] rounded-[6px] border border-[var(--border-subtle)] flex items-center gap-1.5 transition-all cursor-pointer"
              title="Copy complete JSON telemetry payload including all prompts, token stats, and model output"
            >
              {copiedAll ? <Check className="w-3 h-3 text-[var(--accent-green)]" /> : <Copy className="w-3 h-3" />}
              <span>{copiedAll ? 'JSON Copied' : 'Copy JSON'}</span>
            </button>
            <button
              onClick={onClose}
              className="text-[var(--text-muted)] hover:text-[var(--text-heading)] p-1.5 rounded-[6px] hover:bg-[var(--bg-hover)] transition-all cursor-pointer"
              title="Close telemetry dialog (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Interaction Stepper Bar */}
        <div className="px-5 py-2 bg-[var(--bg-elevated)]/60 border-b border-[var(--border-subtle)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10.5px] font-medium text-[var(--text-secondary)] mr-1" title="Select which agent interaction stage to inspect">
              Interactions:
            </span>
            <button
              onClick={() => handleStepChange('overview')}
              className={`px-2.5 py-1 rounded-[6px] text-[11px] font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                activeStep === 'overview'
                  ? 'bg-[var(--accent-brown)] text-[var(--text-inverse)] shadow-xs'
                  : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-heading)]'
              }`}
              title="View how document anchors, reference profiles, and planner directives were synthesized into context"
            >
              <Layers className="w-3 h-3" />
              <span>Context Architecture</span>
            </button>

            {isDualAgent && (
              <button
                onClick={() => handleStepChange('planner')}
                className={`px-2.5 py-1 rounded-[6px] text-[11px] font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                  activeStep === 'planner'
                    ? 'bg-[var(--accent-brown)] text-[var(--text-inverse)] shadow-xs'
                    : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-heading)]'
                }`}
                title="Step 1: Planner Agent scans workspace manifests, identifies relevant context files, and refines the edit directive"
              >
                <Brain className="w-3 h-3" />
                <span>① Planner</span>
                <span className="text-[9.5px] opacity-85 font-mono px-1 rounded bg-black/15">
                  {log.planner_duration_s !== undefined ? `${log.planner_duration_s.toFixed(1)}s · ` : ''}{plannerTotalTokens} toks
                </span>
              </button>
            )}

            <button
              onClick={() => handleStepChange('generator')}
              className={`px-2.5 py-1 rounded-[6px] text-[11px] font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                activeStep === 'generator'
                  ? 'bg-[var(--accent-brown)] text-[var(--text-inverse)] shadow-xs'
                  : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-heading)]'
              }`}
              title="Step 2: Generator/Writer synthesizes the target document anchor with injected reference context to produce the final draft"
            >
              <FileCode className="w-3 h-3" />
              <span>{isDualAgent ? '② Generator / Writer' : 'Generator / Writer'}</span>
              <span className="text-[9.5px] opacity-85 font-mono px-1 rounded bg-black/15">
                {log.writer_duration_s !== undefined ? `${log.writer_duration_s.toFixed(1)}s · ` : log.duration_s !== undefined ? `${log.duration_s.toFixed(1)}s · ` : ''}{totalTokens} toks
              </span>
            </button>
          </div>

          <div className="text-[10.5px] font-mono text-[var(--text-secondary)] flex items-center gap-1.5" title="Total tokens and elapsed execution time consumed across all steps">
            <span>Cumulative:</span>
            <span className="font-bold text-[var(--text-heading)]">
              {log.duration_s !== undefined ? `${log.duration_s.toFixed(2)}s · ` : ''}{combinedTokens} tokens
            </span>
          </div>
        </div>

        {/* Metrics Bar */}
        <div className="px-5 py-2.5 bg-[var(--bg-hover)]/25 border-b border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-4 text-[11px] shrink-0">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5 text-[var(--text-secondary)]" title="The AI model used for this specific interaction stage">
              <Cpu className="w-3.5 h-3.5 text-[var(--accent-brown)]" />
              <span className="font-medium text-[var(--text-heading)]">Model:</span>
              <span className="font-mono bg-[var(--bg-input)] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] text-[10px]">
                {currentModel}
              </span>
            </div>

            <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
              <Database className="w-3.5 h-3.5 text-[var(--accent-green)]" />
              <span className="font-medium text-[var(--text-heading)]">Tokens:</span>
              <div className="flex items-center gap-1 font-mono text-[10px]">
                <span className="bg-[var(--bg-input)] px-1.5 py-0.5 rounded border border-[var(--border-subtle)]" title="Input prompt tokens (system directives + document context + instructions)">
                  In: {currentStepPromptTokens}
                </span>
                <span className="text-[var(--text-muted)]">+</span>
                <span className="bg-[var(--bg-input)] px-1.5 py-0.5 rounded border border-[var(--border-subtle)]" title="Output completion tokens generated by the model">
                  Out: {currentStepCompletionTokens}
                </span>
                <span className="text-[var(--text-muted)]">=</span>
                <span className="bg-[var(--accent-brown)]/15 text-[var(--accent-brown)] font-bold px-1.5 py-0.5 rounded border border-[var(--accent-brown)]/30" title="Total tokens consumed for this interaction step">
                  {currentStepTotalTokens}
                </span>
              </div>
            </div>

            {currentStepDuration !== undefined && (
              <div
                className="flex items-center gap-1.5 text-[var(--text-secondary)]"
                title="Elapsed execution time / latency for this interaction step"
              >
                <Clock className="w-3.5 h-3.5 text-[var(--accent-brown)]" />
                <span className="font-medium text-[var(--text-heading)]">Elapsed:</span>
                <span className="font-mono bg-[var(--bg-input)] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] text-[10px] font-semibold text-[var(--text-heading)]">
                  {currentStepDuration < 1 ? `${(currentStepDuration * 1000).toFixed(0)}ms` : `${currentStepDuration.toFixed(2)}s`}
                </span>
              </div>
            )}
          </div>

          {/* Context Window Capacity Gauge */}
          <div
            className="flex items-center gap-2"
            title={`Active context window capacity: ${promptTokens.toLocaleString()} input tokens out of ${contextWindow.toLocaleString()} limit (${percentUsed.toFixed(1)}% utilized)`}
          >
            <Percent className="w-3 h-3 text-[var(--text-muted)]" />
            <span className="text-[10.5px] text-[var(--text-secondary)]">Context Window:</span>
            <div className="flex items-center gap-1.5">
              <div className="w-20 h-1.5 bg-[var(--border-subtle)] rounded-full overflow-hidden">
                <div
                  className="h-full transition-all duration-300 rounded-full"
                  style={{
                    width: `${Math.max(3, percentUsed)}%`,
                    backgroundColor:
                      percentUsed >= 90 ? '#ef4444' : percentUsed >= 70 ? '#d97706' : 'var(--accent-brown)',
                  }}
                />
              </div>
              <span className="text-[10px] font-mono text-[var(--text-heading)] font-medium">
                {percentUsed.toFixed(1)}% ({promptTokens} / {contextWindow})
              </span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center justify-between px-5 pt-3 pb-1 border-b border-[var(--border-subtle)] bg-[var(--bg)] shrink-0">
          <div className="flex items-center gap-1 flex-wrap">
            {activeStep === 'overview' ? (
              <button
                onClick={() => handleTabChange('overview')}
                className="px-3 py-1 rounded-t-[6px] text-xs font-medium transition-all cursor-pointer border-b-2 flex items-center gap-1.5 border-[var(--accent-brown)] text-[var(--text-heading)] bg-[var(--bg-hover)]/50"
                title="Visual architecture: context sizes, execution times, user prompt, raw generator output, anchors, and reference files"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Context Breakdown</span>
              </button>
            ) : (
              <>
                <button
                  onClick={() => handleTabChange('system')}
                  className={`px-3 py-1 rounded-t-[6px] text-xs font-medium transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
                    activeTab === 'system'
                      ? 'border-[var(--accent-brown)] text-[var(--text-heading)] bg-[var(--bg-hover)]/50'
                      : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)]/30'
                  }`}
                  title="View system prompt instructions, guidelines, and injected reference files for this step"
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>System Prompt</span>
                </button>

                <button
                  onClick={() => handleTabChange('user')}
                  className={`px-3 py-1 rounded-t-[6px] text-xs font-medium transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
                    activeTab === 'user'
                      ? 'border-[var(--accent-brown)] text-[var(--text-heading)] bg-[var(--bg-hover)]/50'
                      : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)]/30'
                  }`}
                  title="View the complete prompt payload and document context sent to the model for this step"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>User Prompt</span>
                </button>

                {Boolean(currentThinking) && (
                  <button
                    onClick={() => handleTabChange('thinking')}
                    className={`px-3 py-1 rounded-t-[6px] text-xs font-medium transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
                      activeTab === 'thinking'
                        ? 'border-[var(--accent-brown)] text-[var(--text-heading)] bg-[var(--bg-hover)]/50'
                        : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)]/30'
                    }`}
                    title="Inspect the internal chain-of-thought reasoning stream generated by the model for this step"
                  >
                    <Brain className="w-3.5 h-3.5 text-[var(--accent-brown)]" />
                    <span>Thinking / Reasoning</span>
                  </button>
                )}

                <button
                  onClick={() => handleTabChange('output')}
                  className={`px-3 py-1 rounded-t-[6px] text-xs font-medium transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
                    activeTab === 'output'
                      ? 'border-[var(--accent-brown)] text-[var(--text-heading)] bg-[var(--bg-hover)]/50'
                      : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)]/30'
                  }`}
                  title="Inspect the unformatted raw completion string returned by the model for this step"
                >
                  <FileCode className="w-3.5 h-3.5" />
                  <span>Raw Output</span>
                </button>

                {log.tool_calls && log.tool_calls.length > 0 && (
                  <button
                    onClick={() => handleTabChange('tools')}
                    className={`px-3 py-1 rounded-t-[6px] text-xs font-medium transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
                      activeTab === 'tools'
                        ? 'border-[var(--accent-brown)] text-[var(--text-heading)] bg-[var(--bg-hover)]/50'
                        : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)]/30'
                    }`}
                    title="Inspect tool calls, file edits, and commands executed during this turn"
                  >
                    <Wrench className="w-3.5 h-3.5" />
                    <span>Tool Calls ({log.tool_calls.length})</span>
                  </button>
                )}
              </>
            )}
          </div>

          <button
            onClick={() => handleCopy(currentTextForCopy)}
            className="px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] rounded-[6px] border border-[var(--border-subtle)] flex items-center gap-1.5 transition-all cursor-pointer"
            title="Copy text content of the active tab to clipboard"
          >
            {copied ? <Check className="w-3 h-3 text-[var(--accent-green)]" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied Tab' : 'Copy Tab'}</span>
          </button>
        </div>

        {/* Content Body (Flex-1 scrollable inside fixed modal container) */}
        <div className="flex-1 p-5 overflow-y-auto bg-[var(--bg-editor)] text-[11px] leading-relaxed select-text">
          {activeTab === 'overview' ? (
            <div className="flex flex-col gap-4">
              {/* 1. Context Size and Latency Comparison Card for Planner and Generator/Writer */}
              <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[10px] p-4 flex flex-col gap-3 shadow-2xs">
                <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2" title="Context size and execution timing for all pipeline stages">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-[var(--accent-brown)]" />
                    <span className="font-semibold text-xs text-[var(--text-heading)]">
                      Context Size & Execution Timing Breakdown
                    </span>
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)] font-mono">
                    Total: {log.duration_s !== undefined ? `${log.duration_s.toFixed(2)}s · ` : ''}{combinedTokens} tokens
                  </span>
                </div>

                <div className={`grid grid-cols-1 ${isDualAgent ? 'md:grid-cols-2' : 'md:grid-cols-1'} gap-3 text-[11px]`}>
                  {isDualAgent && (
                    <div className="p-3 bg-[var(--bg-input)] rounded border border-[var(--border-subtle)] flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-[var(--text-heading)] font-semibold">
                          <Brain className="w-3.5 h-3.5 text-[var(--accent-brown)]" />
                          <span>Step 1: Planner Agent</span>
                        </div>
                        <span className="text-[10px] font-mono bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] text-[var(--text-secondary)]">
                          {log.planner_model || log.model_used || 'Planner'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[10.5px]">
                        <div>
                          <span className="text-[var(--text-muted)]">Input Tokens: </span>
                          <span className="font-mono font-medium text-[var(--text)]">{plannerPromptTokens}</span>
                        </div>
                        <div>
                          <span className="text-[var(--text-muted)]">Output Tokens: </span>
                          <span className="font-mono font-medium text-[var(--text)]">{plannerCompletionTokens}</span>
                        </div>
                        <div>
                          <span className="text-[var(--text-muted)]">Total Tokens: </span>
                          <span className="font-mono font-semibold text-[var(--accent-brown)]">{plannerTotalTokens}</span>
                        </div>
                        <div>
                          <span className="text-[var(--text-muted)]">Elapsed Time: </span>
                          <span className="font-mono font-semibold text-[var(--text-heading)]">
                            {log.planner_duration_s !== undefined
                              ? log.planner_duration_s < 1
                                ? `${(log.planner_duration_s * 1000).toFixed(0)}ms`
                                : `${log.planner_duration_s.toFixed(2)}s`
                              : 'N/A'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="p-3 bg-[var(--bg-input)] rounded border border-[var(--border-subtle)] flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-[var(--text-heading)] font-semibold">
                        <FileCode className="w-3.5 h-3.5 text-[var(--accent-green)]" />
                        <span>{isDualAgent ? 'Step 2: Generator / Writer' : 'Generator / Writer'}</span>
                      </div>
                      <span className="text-[10px] font-mono bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] text-[var(--text-secondary)]">
                        {log.model_used || 'Default'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10.5px]">
                      <div>
                        <span className="text-[var(--text-muted)]">Input Tokens: </span>
                        <span className="font-mono font-medium text-[var(--text)]">{promptTokens}</span>
                      </div>
                      <div>
                        <span className="text-[var(--text-muted)]">Output Tokens: </span>
                        <span className="font-mono font-medium text-[var(--text)]">{completionTokens}</span>
                      </div>
                      <div>
                        <span className="text-[var(--text-muted)]">Total Tokens: </span>
                        <span className="font-mono font-semibold text-[var(--accent-green)]">{totalTokens}</span>
                      </div>
                      <div>
                        <span className="text-[var(--text-muted)]">Elapsed Time: </span>
                        <span className="font-mono font-semibold text-[var(--text-heading)]">
                          {(() => {
                            const dur = log.writer_duration_s ?? log.duration_s
                            if (dur === undefined) return 'N/A'
                            return dur < 1 ? `${(dur * 1000).toFixed(0)}ms` : `${dur.toFixed(2)}s`
                          })()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. User Prompt and Raw Output Overview Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* User Prompt */}
                <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[10px] p-3.5 flex flex-col gap-2 shadow-2xs">
                  <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2" title="The user's original instruction and prompt input">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-[var(--accent-brown)]" />
                      <span className="font-semibold text-xs text-[var(--text-heading)]">User Prompt</span>
                    </div>
                    <button
                      onClick={() => handleCopy(log.instruction || log.user_prompt)}
                      className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-secondary)] hover:text-[var(--text-heading)] transition-all cursor-pointer"
                      title="Copy user prompt"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="p-2.5 bg-[var(--bg-input)] rounded border border-[var(--border-subtle)] font-mono text-[10.5px] max-h-44 overflow-y-auto whitespace-pre-wrap leading-relaxed text-[var(--text)]">
                    {log.instruction || log.user_prompt || '(No user prompt recorded)'}
                  </div>
                </div>

                {/* Generator / Writer Raw Output */}
                <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[10px] p-3.5 flex flex-col gap-2 shadow-2xs">
                  <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2" title="Raw output text returned by the generator/writer">
                    <div className="flex items-center gap-2">
                      <FileCode className="w-4 h-4 text-[var(--accent-green)]" />
                      <span className="font-semibold text-xs text-[var(--text-heading)]">Generator / Writer Raw Output</span>
                    </div>
                    <button
                      onClick={() => handleCopy(log.output)}
                      className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-secondary)] hover:text-[var(--text-heading)] transition-all cursor-pointer"
                      title="Copy raw generator output"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="p-2.5 bg-[var(--bg-input)] rounded border border-[var(--border-subtle)] font-mono text-[10.5px] max-h-44 overflow-y-auto whitespace-pre-wrap leading-relaxed text-[var(--text)]">
                    {log.output || '(No generator output recorded)'}
                  </div>
                </div>
              </div>

              {/* 3. Dual-Agent Coordination Pipeline (Placed above anchor/context cards) */}
              {isDualAgent && (
                <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[10px] p-4 flex flex-col gap-3 shadow-2xs">
                  <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2">
                    <div className="flex items-center gap-2" title="How the Planner analyzes user intent and synthesizes refined directives for the Writer">
                      <Brain className="w-4 h-4 text-[var(--accent-brown)]" />
                      <span className="font-semibold text-xs text-[var(--text-heading)]">
                        Dual-Agent Coordination Pipeline
                      </span>
                    </div>
                    <span className="text-[10px] text-[var(--text-muted)] font-mono">
                      Planner {log.planner_duration_s !== undefined ? `(${log.planner_duration_s.toFixed(1)}s)` : ''} → Writer {log.writer_duration_s !== undefined ? `(${log.writer_duration_s.toFixed(1)}s)` : ''}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                    <div className="flex flex-col gap-1 p-3 bg-[var(--bg-input)] rounded border border-[var(--border-subtle)]">
                      <div className="flex items-center gap-1.5 text-[var(--text-secondary)] font-medium">
                        <MessageSquare className="w-3 h-3 text-[var(--accent-brown)]" />
                        <span>1. Raw User Instruction:</span>
                      </div>
                      <p className="font-mono text-[10.5px] text-[var(--text)] whitespace-pre-wrap mt-0.5">
                        {log.instruction || log.user_prompt}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1 p-3 bg-[var(--bg-input)] rounded border border-[var(--border-subtle)]">
                      <div className="flex items-center gap-1.5 text-[var(--text-secondary)] font-medium">
                        <Sparkles className="w-3 h-3 text-[var(--accent-green)]" />
                        <span>2. Planner Refined Directive:</span>
                      </div>
                      <p className="font-mono text-[10.5px] text-[var(--text)] whitespace-pre-wrap mt-0.5">
                        {plannerRefinedQuery || '(Instruction passed directly to writer)'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* 4. Target Document & Anchor + Context Injected (2-column grid) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Target File & Anchor Card */}
                <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[10px] p-3.5 flex flex-col gap-2 shadow-2xs">
                  <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-2" title="Active document and targeted text span for replacement or insertion">
                    <FileText className="w-4 h-4 text-[var(--accent-brown)]" />
                    <span className="font-semibold text-xs text-[var(--text-heading)]">Target Document & Anchor</span>
                  </div>
                  <div className="flex flex-col gap-2 text-[11px]">
                    <div className="flex justify-between items-center">
                      <span className="text-[var(--text-secondary)]">Active File:</span>
                      <span className="font-mono font-medium text-[var(--text)] truncate max-w-[220px]" title={log.active_filename || 'Current Document'}>
                        {log.active_filename || 'Current Document'}
                      </span>
                    </div>

                    {log.selected_text ? (
                      <div className="flex flex-col gap-1 mt-1">
                        <div className="flex justify-between items-center">
                          <span className="text-[var(--text-secondary)]">Editor Selection (Target):</span>
                          <span className="font-mono text-[var(--accent-green)] font-medium" title="Length of highlighted text replacing this span">
                            {log.selected_text.length.toLocaleString()} characters
                          </span>
                        </div>
                        <div className="p-2.5 bg-[var(--bg-input)] rounded border border-[var(--border-subtle)] font-mono text-[10px] max-h-24 overflow-y-auto whitespace-pre-wrap leading-relaxed text-[var(--text)]">
                          {log.selected_text}
                        </div>
                      </div>
                    ) : log.target_paragraph ? (
                      <div className="flex flex-col gap-1 mt-1">
                        <span className="text-[var(--text-secondary)]">Cursor Anchor Paragraph:</span>
                        <div className="p-2.5 bg-[var(--bg-input)] rounded border border-[var(--border-subtle)] font-mono text-[10px] max-h-24 overflow-y-auto whitespace-pre-wrap leading-relaxed text-[var(--text)]">
                          {log.target_paragraph}
                        </div>
                      </div>
                    ) : (
                      <div className="text-[var(--text-muted)] italic text-[10.5px]">
                        Full document context provided without localized anchor.
                      </div>
                    )}
                  </div>
                </div>

                {/* Injected Context Files & Manifests Card */}
                <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[10px] p-3.5 flex flex-col gap-2 shadow-2xs">
                  <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-2" title="Reference files, character profiles, and style guidelines injected into the generation context">
                    <Layers className="w-4 h-4 text-[var(--accent-green)]" />
                    <span className="font-semibold text-xs text-[var(--text-heading)]">Context Injected</span>
                  </div>

                  <div className="flex flex-col gap-2.5 text-[11px]">
                    {/* User-tagged ref files */}
                    {userTaggedFiles.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold" title="Files tagged directly in the user prompt using @filename">
                          <AtSign className="w-3 h-3 text-[var(--accent-brown)]" />
                          <span>User @file Tags:</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {userTaggedFiles.map((f) => (
                            <span
                              key={f.path}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-mono text-[10px] bg-[var(--accent-brown)]/10 text-[var(--accent-brown)] border border-[var(--accent-brown)]/25"
                              title={`User tagged: ${f.path}`}
                            >
                              @{f.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Planner-discovered & Injected Files */}
                    {plannerInjectedFiles.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold" title="Files discovered by Planner from workspace manifests and loaded into the Writer prompt">
                          <Brain className="w-3 h-3 text-[var(--accent-green)]" />
                          <span>Planner Discovered & Injected:</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {plannerInjectedFiles.map((f) => (
                            <span
                              key={f}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-mono text-[10px] bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/25"
                              title={`Manifest resolved and injected into system prompt: ${f}`}
                            >
                              <Check className="w-2.5 h-2.5" />
                              <span>{f}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Pinned Reference Files */}
                    {pinnedInjectedFiles.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold" title="Reference styles and lore pinned in Settings > Context">
                          <Bookmark className="w-3 h-3 text-[var(--text-muted)]" />
                          <span>Pinned Reference Files (Settings):</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {pinnedInjectedFiles.map((f) => (
                            <span
                              key={f}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-mono text-[10px] bg-[var(--bg-input)] text-[var(--text-secondary)] border border-[var(--border-subtle)]"
                              title={`Pinned context injected: ${f}`}
                            >
                              {f}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {userTaggedFiles.length === 0 &&
                      plannerInjectedFiles.length === 0 &&
                      pinnedInjectedFiles.length === 0 && (
                        <div className="text-[var(--text-muted)] italic text-[11px] py-1">
                          No external reference files required for this turn.
                        </div>
                      )}
                  </div>
                </div>
              </div>

              {/* 5. Tool Calls Summary for Harness */}
              {log.tool_calls && log.tool_calls.length > 0 && (
                <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[10px] p-4 flex flex-col gap-2.5 shadow-2xs">
                  <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2" title="CLI file operations and bash executions performed autonomously by the agent">
                    <div className="flex items-center gap-2">
                      <Wrench className="w-4 h-4 text-[var(--accent-brown)]" />
                      <span className="font-semibold text-xs text-[var(--text-heading)]">
                        Agent Tool Invocations ({log.tool_calls.length})
                      </span>
                    </div>
                    <span className="text-[10px] text-[var(--text-muted)] font-mono">
                      Autonomous Actions
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {log.tool_calls.map((t, idx) => {
                      const isRetry = t.tool.toLowerCase().includes('retry') || t.tool.toLowerCase().includes('warning')
                      return (
                        <div
                          key={idx}
                          className={`flex items-center justify-between p-2 rounded border text-[10.5px] font-mono ${
                            isRetry
                              ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                              : 'bg-[var(--bg-input)] border-[var(--border-subtle)]'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 font-semibold">
                            {isRetry ? (
                              <>
                                <AlertTriangle className="w-3 h-3 text-amber-500" />
                                <span>Server Retry Notice</span>
                              </>
                            ) : (
                              <span className="text-[var(--accent-brown)]">{t.tool}</span>
                            )}
                          </div>
                          <span className={`truncate max-w-[400px] ${isRetry ? 'text-amber-700 dark:text-amber-300 font-medium' : 'text-[var(--text-secondary)]'}`} title={t.detail || t.path || ''}>
                            {t.detail || t.path || ''}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === 'tools' ? (
            <div className="flex flex-col gap-2 font-mono text-[11px]">
              {log.tool_calls && log.tool_calls.length > 0 ? (
                log.tool_calls.map((t, idx) => {
                  const isRetry = t.tool.toLowerCase().includes('retry') || t.tool.toLowerCase().includes('warning')
                  return (
                    <div
                      key={idx}
                      className={`p-3 rounded-[8px] flex flex-col gap-1 shadow-2xs ${
                        isRetry
                          ? 'bg-amber-500/10 border border-amber-500/30'
                          : 'bg-[var(--bg-elevated)] border border-[var(--border-subtle)]'
                      }`}
                    >
                      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-1">
                        <div className="flex items-center gap-1.5">
                          {isRetry && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
                          <span className={`font-bold ${isRetry ? 'text-amber-500' : 'text-[var(--accent-brown)]'}`}>
                            {isRetry ? 'Server Retry Notice' : t.tool}
                          </span>
                        </div>
                        {t.path && <span className="text-[10px] text-[var(--text-muted)]">{t.path}</span>}
                      </div>
                      {t.detail && (
                        <div className={`mt-1 whitespace-pre-wrap ${isRetry ? 'text-amber-700 dark:text-amber-300 font-medium' : 'text-[var(--text)]'}`}>
                          {t.detail}
                        </div>
                      )}
                    </div>
                  )
                })
              ) : (
                <div className="text-[var(--text-muted)] italic">No tool calls recorded for this interaction.</div>
              )}
            </div>
          ) : (
            <div className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[var(--text)]">
              {currentTextForCopy}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-hover)]/20 flex items-center justify-between shrink-0">
          <div className="text-[10.5px] text-[var(--text-muted)] font-mono">
            {formatLocalTimestamp(log.timestamp)}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-[6px] text-xs font-medium bg-[var(--bg-hover)] text-[var(--text)] hover:bg-[var(--border-subtle)] transition-all cursor-pointer"
            title="Close telemetry dialog (Esc)"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
