import { useState, useEffect } from 'react'
import type { AppSettings } from '../../stores/settingsStore'
import { API_BASE } from '../../lib/api'
import { Dropdown } from '../Dropdown'
import { FilterSection, SectionCard, SectionLabel, Row } from './shared'

interface ActivityDay {
  date: string
  chats: number
  images: number
}

interface WorkspaceStats {
  markdown_files: number
  chat_sessions: number
  images_generated: number
  last_activity: string | null
  activity: ActivityDay[]
}

const formatCount = (n: number) => n.toLocaleString()

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatLastActive(iso: string | null): string {
  if (!iso) return 'No activity yet'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const days = Math.floor((Date.now() - t) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

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

function ActivityChart({ activity }: { activity: ActivityDay[] }) {
  const max = Math.max(1, ...activity.map((d) => d.chats + d.images))
  const total = activity.reduce((sum, d) => sum + d.chats + d.images, 0)
  return (
    <div className="rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 px-4 py-3">
      <div className="text-[11px] text-[var(--text-secondary)]">Last 14 days</div>
      <div
        className="mt-2 flex h-24 items-stretch gap-1"
        role="img"
        aria-label={total === 0 ? 'No activity in the last 14 days' : `${total} assist actions in the last 14 days`}
      >
        {activity.map((d) => {
          const dayTotal = d.chats + d.images
          return (
            <div
              key={d.date}
              title={`${d.date} · ${d.chats} chats · ${d.images} images`}
              className="flex min-w-0 flex-1 flex-col"
            >
              <div className="flex min-h-0 flex-1 flex-col justify-end rounded-[2px] bg-[var(--bg-hover)]">
                {dayTotal > 0 && (
                  <div
                    style={{ height: `${Math.max(12, (dayTotal / max) * 100)}%` }}
                    className="rounded-[2px] bg-[var(--accent-brown)]/70"
                  />
                )}
              </div>
              <div className="mt-1 text-center text-[9px] leading-none text-[var(--text-muted)]">
                {WEEKDAYS[new Date(`${d.date}T00:00:00Z`).getUTCDay()]}
              </div>
            </div>
          )
        })}
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
      <FilterSection query={query} keywords="stats files chats images activity last active workspace current">
        <section>
          <SectionLabel description="Activity in the current workspace.">Workspace activity</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Markdown files" value={stats ? formatCount(stats.markdown_files) : '—'} />
            <StatCard label="Chats" value={stats ? formatCount(stats.chat_sessions) : '—'} />
            <StatCard label="Images" value={stats ? formatCount(stats.images_generated) : '—'} />
            <StatCard label="Last active" value={stats ? formatLastActive(stats.last_activity) : '—'} />
          </div>
          <div className="mt-3">
            {stats ? <ActivityChart activity={stats.activity} /> : (
              <div className="rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 px-4 py-3 text-[11px] text-[var(--text-secondary)]">
                Loading activity…
              </div>
            )}
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
