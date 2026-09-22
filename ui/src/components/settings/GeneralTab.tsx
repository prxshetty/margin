import { useState, useEffect } from 'react'
import type { AppSettings } from '../../stores/settingsStore'
import { API_BASE } from '../../lib/api'
import { Dropdown } from '../Dropdown'
import { FilterSection, SectionCard, SectionLabel, Row } from './shared'

interface WorkspaceStats {
  markdown_files: number
  chat_sessions: number
  prompt_tokens: number
  completion_tokens: number
}

const formatCount = (n: number) => n.toLocaleString()

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 px-4 py-3 min-w-0">
      <div className="text-[11px] text-[var(--text-secondary)] truncate">{label}</div>
      <div className="mt-1 text-[22px] leading-none font-medium text-[var(--text-heading)] tabular-nums truncate">
        {value}
      </div>
    </div>
  )
}

export function GeneralSettings({ settings, updateSettings, query }: { settings: AppSettings, updateSettings: (u: Partial<AppSettings>) => void, query: string }) {
  const [stats, setStats] = useState<WorkspaceStats | null>(null)

  useEffect(() => {
    let active = true
    fetch(`${API_BASE}/api/workspace/stats`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (active && data?.stats) setStats(data.stats)
      })
      .catch(() => { /* stats simply stay hidden */ })
    return () => {
      active = false
    }
  }, [settings.linked_workspace_dir])

  return (
    <div className="flex flex-col gap-6">
      <FilterSection query={query} keywords="stats files chats tokens usage workspace current activity">
        <section>
          <SectionLabel description="Activity in the current workspace.">Workspace activity</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Markdown files" value={stats ? formatCount(stats.markdown_files) : '—'} />
            <StatCard label="Chats" value={stats ? formatCount(stats.chat_sessions) : '—'} />
            <StatCard label="Prompt tokens" value={stats ? formatCount(stats.prompt_tokens) : '—'} />
            <StatCard label="Completion tokens" value={stats ? formatCount(stats.completion_tokens) : '—'} />
          </div>
        </section>
      </FilterSection>

      <FilterSection query={query} keywords="mode edit chat default interface">
        <section>
          <SectionLabel description="Default mode and response length for new sessions.">Interface</SectionLabel>
          <SectionCard>
            <Row
              label="Default mode"
              description="The default interface mode for new sessions."
              control={
                <Dropdown
                  value={settings.default_mode || 'edit'}
                  onChange={(v) => updateSettings({ default_mode: v })}
                  options={[
                    { value: 'edit', label: 'Edit' },
                    { value: 'chat', label: 'Chat' },
                  ]}
                  rootClassName="w-[190px]"
                />
              }
            />
            <Row
              label="Default verbosity"
              description="Target length of endpoint responses and edits. Endpoints only."
              control={
                <Dropdown
                  value={settings.default_verbosity || 'balanced'}
                  onChange={(v) => updateSettings({ default_verbosity: v })}
                  options={[
                    { value: 'none', label: 'No Limit' },
                    { value: 'concise', label: 'Concise (250 tokens)' },
                    { value: 'balanced', label: 'Balanced (500 tokens)' },
                    { value: 'expansive', label: 'Expansive (1000 tokens)' },
                  ]}
                  rootClassName="w-[190px]"
                />
              }
            />
          </SectionCard>
        </section>
      </FilterSection>
    </div>
  )
}
