import { useState, useEffect } from 'react'
import { ChevronRight, ChevronDown, Folder, FolderOpen, Pin, EyeOff, Eye, Loader2 } from 'lucide-react'
import type { AppSettings } from '../../stores/settingsStore'
import { API_BASE } from '../../lib/api'
import { toast } from '../../stores/toastStore'
import { Dropdown } from '../Dropdown'
import { FilterSection, SectionCard, SectionLabel, Row, Toggle } from './shared'
export function ContextSettings({
  settings,
  updateSettings,
  availableFiles,
  query
}: {
  settings: AppSettings,
  updateSettings: (u: Partial<AppSettings>) => void,
  availableFiles: { name: string; path: string }[]
  query: string
}) {
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({})
  const harnessActive = (settings.default_harness || 'none') !== 'none'

  // Group files by folder
  const groups: Record<string, typeof availableFiles> = {}
  availableFiles.forEach(file => {
    const parts = file.path.split('/')
    const folder = parts.length > 1 ? parts[0] : ''
    if (!groups[folder]) {
      groups[folder] = []
    }
    groups[folder].push(file)
  })

  // Sort folders alphabetically, with empty (root files) group last
  const sortedFolders = Object.keys(groups).sort((a, b) => {
    if (a === '') return 1
    if (b === '') return -1
    return a.localeCompare(b)
  })

  const toggleFolder = (folder: string) => {
    setCollapsedFolders(prev => ({
      ...prev,
      [folder]: !prev[folder]
    }))
  }

  return (
    <div className="flex flex-col gap-6">
      <FilterSection query={query} keywords="agent prompt prompts writer planner chat harness">
        <section>
          <SectionLabel description="Edit the instructions each agent runs on. Changes apply to the next request.">Agent prompts</SectionLabel>
          <SectionCard className="p-4">
            <PromptsSettings />
          </SectionCard>
        </section>
      </FilterSection>

      <FilterSection query={query} keywords="memory session history turns">
        <section>
          <SectionLabel description="How much past history travels with each endpoint request.">Session memory</SectionLabel>
          <SectionCard>
            <Row
              label="Max history depth"
              description="Past turns traveling with each endpoint request. Harness sessions keep their own conversation."
              control={
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={settings.history_turns ?? 5}
                  onChange={(e) => updateSettings({ history_turns: Math.max(1, Math.min(10, parseInt(e.target.value) || 1)) })}
                  className="w-16 border border-[var(--border-subtle)] rounded-[8px] px-2 py-1.5 text-[13px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]"
                />
              }
            />
          </SectionCard>
        </section>
      </FilterSection>

      <FilterSection query={query} keywords="context reference files pin block">
        <section>
          <SectionLabel description={<>All workspace files are available for the planner to reference. <strong>Pin</strong> a file to always include it. <strong>Cross out</strong> a folder or file to prevent the AI from reading it.</>}>Reference files</SectionLabel>
          <div className="border border-[var(--border-subtle)] rounded-[12px] bg-[var(--bg-elevated)]/40 max-h-[300px] overflow-y-auto p-2 flex flex-col gap-1.5">
          {availableFiles.length === 0 ? (
            <p className="text-[12px] text-[var(--text-secondary)] p-2 text-center">No files in workspace.</p>
          ) : (
            sortedFolders.map(folder => {
              const files = groups[folder]
              const isCollapsed = !!collapsedFolders[folder]
              const displayTitle = folder === '' ? 'Workspace Root' : `${folder}/`
              const manifestPath = folder ? `${folder}/${folder.toUpperCase()}.md` : ''
              const isBlocked = folder !== '' && (settings.ignored_ref_files || []).includes(manifestPath)

              const toggleBlock = (e: React.MouseEvent) => {
                e.stopPropagation()
                const current = settings.ignored_ref_files || []
                if (isBlocked) {
                  updateSettings({ ignored_ref_files: current.filter(p => p !== manifestPath) })
                } else {
                  updateSettings({ ignored_ref_files: [...current, manifestPath] })
                }
              }

              return (
                <div key={`group-${folder}`} className="flex flex-col gap-1">
                  {/* Collapsible Folder Row */}
                  <div
                    onClick={() => !isBlocked && toggleFolder(folder)}
                    className={`flex items-center gap-2 p-1.5 rounded-[4px] select-none transition-colors ${isBlocked ? 'opacity-60 cursor-default' : 'hover:bg-[var(--bg-hover)]/60 cursor-pointer'}`}
                  >
                    {isBlocked ? (
                      <ChevronRight size={14} className="text-[var(--text-muted)]" />
                    ) : isCollapsed ? (
                      <ChevronRight size={14} className="text-[var(--text-secondary)]" />
                    ) : (
                      <ChevronDown size={14} className="text-[var(--text-secondary)]" />
                    )}
                    {isBlocked ? (
                      <Folder size={14} className="text-red-400 shrink-0" />
                    ) : isCollapsed ? (
                      <Folder size={14} className="text-[var(--text-secondary)] shrink-0" />
                    ) : (
                      <FolderOpen size={14} className="text-[var(--text-secondary)] shrink-0" />
                    )}
                    <span className={`text-[11px] font-semibold uppercase tracking-wider ${isBlocked ? 'text-red-400 line-through' : 'text-[var(--text-heading)]'}`}>
                      {displayTitle}
                    </span>
                    {isBlocked ? (
                      <span className="text-[10px] text-red-400 font-normal ml-auto">Blocked</span>
                    ) : (
                      <span className="text-[10px] text-[var(--text-muted)] font-normal ml-auto bg-[var(--bg-hover)] px-1.5 py-0.5 rounded-[4px]">
                        {files.length} {files.length === 1 ? 'file' : 'files'}
                      </span>
                    )}
                    {folder !== '' && (
                      <button
                        onClick={toggleBlock}
                        className="p-1 rounded-[4px] transition-colors cursor-pointer shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                      >
                        {isBlocked ? <EyeOff size={13} className="text-red-400" /> : <Eye size={13} />}
                      </button>
                    )}
                  </div>

                  {/* Indented Files List */}
                  {!isCollapsed && !isBlocked && (
                    <div className="pl-4 border-l border-[var(--border-subtle)]/40 ml-3.5 my-0.5 flex flex-col gap-1">
                      {files.filter(file => file.name !== `${folder.toUpperCase()}.md`).map(file => {
                        const isPinned = (settings.pinned_ref_files || []).includes(file.path)
                        const isIgnored = (settings.ignored_ref_files || []).includes(file.path)

                        const cycleState = (e: React.MouseEvent) => {
                          e.stopPropagation()
                          if (!isPinned && !isIgnored) {
                            updateSettings({
                              pinned_ref_files: [...(settings.pinned_ref_files || []), file.path],
                              ignored_ref_files: (settings.ignored_ref_files || []).filter(p => p !== file.path),
                            })
                          } else if (isPinned) {
                            updateSettings({
                              pinned_ref_files: (settings.pinned_ref_files || []).filter(p => p !== file.path),
                              ignored_ref_files: [...(settings.ignored_ref_files || []), file.path],
                            })
                          } else {
                            updateSettings({
                              ignored_ref_files: (settings.ignored_ref_files || []).filter(p => p !== file.path),
                            })
                          }
                        }

                        const stateColor = isPinned
                          ? 'text-[var(--accent-brown)]'
                          : isIgnored
                            ? 'text-red-400'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'

                        return (
                          <div
                            key={file.path}
                            className="flex items-center gap-2 p-1 px-2 hover:bg-[var(--bg-hover)]/40 rounded-[4px] group"
                          >
                            <span
                              className={`text-[12.5px] min-w-0 truncate flex-1 ${
                                isPinned
                                  ? 'text-[var(--accent-brown)] font-semibold'
                                  : isIgnored
                                    ? 'line-through text-[var(--text-muted)] opacity-50'
                                    : 'text-[var(--text)]'
                              }`}
                            >
                              {file.name}
                            </span>
                            {folder !== '' && file.path !== `${folder}/${file.name}` && (
                              <span className="text-[10px] text-[var(--text-muted)] hidden group-hover:inline truncate max-w-[200px] font-mono">
                                {file.path}
                              </span>
                            )}
                            <button
                              onClick={cycleState}
                              className={`p-1 rounded-[4px] transition-all cursor-pointer shrink-0 ${stateColor}`}
                            >
                              {isPinned ? (
                                <Pin size={13} />
                              ) : isIgnored ? (
                                <EyeOff size={13} />
                              ) : (
                                <Eye size={13} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                              )}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </section>
      </FilterSection>
      <p className="text-[11px] text-[var(--text-muted)] leading-relaxed -mt-4">
        Endpoint models only — agent harnesses read your workspace files directly.
      </p>

      <FilterSection query={query} keywords="outline document structure planner">
        <section>
          <SectionLabel description={<>Provide a structural outline (paragraph previews) of the active document to the endpoint planner. Broader story awareness at the cost of memory.{harnessActive ? ' Disabled while a harness is the default.' : ''}</>}>Document outline</SectionLabel>
          <SectionCard>
            <Row
              label="Send document outline to AI"
              control={
                <Toggle
                  checked={!!settings.planner_include_outline}
                  disabled={harnessActive}
                  label="Send document outline to AI"
                  onChange={(next) => updateSettings({ planner_include_outline: next })}
                />
              }
            />
          </SectionCard>
        </section>
      </FilterSection>
    </div>
  )
}

const PROMPT_ENTRIES = [
  { id: 'writer', file: 'simple-writer.md', label: 'Writer', description: 'Writes the replacement text for panel edits and inline Rewrite — endpoint path only.' },
  { id: 'planner', file: 'simple-planner.md', label: 'Planner', description: 'Picks context files and refines the instruction for the Writer — endpoint path only.' },
  { id: 'chat', file: 'simple-chat.md', label: 'Chat', description: 'Converses and answers — makes no edits, for endpoints and harnesses.' },
  { id: 'harness-edit', file: 'harness-edit.md', label: 'Harness Edit', description: 'Standing instructions for agent harnesses in Edit mode (OpenCode, Claude Code, Codex, Antigravity) — including the rule that changes land in files, not in the reply.' },
]

function PromptsSettings() {
  const [selectedId, setSelectedId] = useState('writer')
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  const entry = PROMPT_ENTRIES.find(e => e.id === selectedId)!

  useEffect(() => {
    // Reset + fetch on prompt switch; matches the data-fetch pattern used elsewhere here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true)
    fetch(`${API_BASE}/api/assist/prompts/${encodeURIComponent(entry.file)}`)
      .then(res => {
        if (!res.ok) throw new Error(`Could not load ${entry.file}`)
        return res.json()
      })
      .then(data => {
        setContent(data.content || '')
        setSavedContent(data.content || '')
      })
      .catch(err => toast.error((err as Error).message))
      .finally(() => setIsLoading(false))
  }, [entry.file])

  const dirty = content !== savedContent

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const res = await fetch(`${API_BASE}/api/assist/prompts/${encodeURIComponent(entry.file)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) throw new Error('Save failed')
      setSavedContent(content)
      toast.success('Prompt saved.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
        <Dropdown
          value={selectedId}
          onChange={setSelectedId}
          options={PROMPT_ENTRIES.map(e => ({ value: e.id, label: e.label }))}
          rootClassName="w-[280px] mb-1"
        />
        <p className="text-[11px] text-[var(--text-muted)] mb-3">{entry.description}</p>
        {isLoading ? (
          <p className="text-[12px] text-[var(--text-muted)]">Loading {entry.file}...</p>
        ) : (
          <>
            <div className="relative">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
                className="w-full h-[300px] border border-[var(--border-subtle)] rounded-[6px] p-3 text-[12px] text-[var(--text)] bg-transparent outline-none focus:border-[var(--text-secondary)] transition-colors resize-y font-mono leading-relaxed"
              />
              <span className="absolute bottom-2 right-6 text-[10px] text-[var(--text-muted)] pointer-events-none">
                {content.length}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 mt-2">
              {isSaving ? (
                <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                  <Loader2 size={12} className="animate-spin" />
                  Saving…
                </span>
              ) : dirty ? (
                <span className="text-[11px] text-[var(--text-muted)]">Unsaved changes</span>
              ) : <span />}
              <button
                onClick={handleSave}
                disabled={!dirty || isSaving}
                className="px-3 py-1.5 text-[12px] bg-[var(--accent-brown)] text-[var(--text-inverse)] rounded-[8px] hover:bg-[var(--accent-brown-hover)] transition-colors disabled:opacity-50 cursor-pointer font-medium"
              >
                Save
              </button>
            </div>
          </>
        )}
    </div>
  )
}
