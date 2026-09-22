import { useState, useEffect } from 'react'
import { Check, Folder, Pencil, Trash2 } from 'lucide-react'
import type { AppSettings } from '../../stores/settingsStore'
import { toast } from '../../stores/toastStore'
import { API_BASE } from '../../lib/api'
import { FilterSection, SectionCard, SectionLabel, Toggle } from './shared'

type Profile = { id: string; name: string; path: string }

const basenameOf = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p

export function WorkspacesSettings({ settings, updateSettings, query }: { settings: AppSettings, updateSettings: (u: Partial<AppSettings>) => void, query: string }) {
  const [pickedPath, setPickedPath] = useState<string | null>(null)
  const [profileName, setProfileName] = useState('')
  const [createName, setCreateName] = useState('')
  const [isPicking, setIsPicking] = useState(false)
  const [initGitOpen, setInitGitOpen] = useState(false)
  const [initGitCreate, setInitGitCreate] = useState(false)  // default false — local-first
  const [gitAvailable, setGitAvailable] = useState<boolean | null>(null)
  const [isWorking, setIsWorking] = useState(false)
  const [mode, setMode] = useState<'open' | 'create' | null>(null)

  const profiles: Profile[] = settings.workspace_profiles || []
  const activeProfile = settings.linked_workspace_dir
    ? profiles.find((p) => p.path === settings.linked_workspace_dir)
    : undefined

  useEffect(() => {
    fetch(`${API_BASE}/api/workspace/git-status`)
      .then(res => res.json())
      .then(data => {
        const avail = Boolean(data.available)
        setGitAvailable(avail)
        if (!avail) {
          setInitGitOpen(false)
          setInitGitCreate(false)
        }
      })
      .catch(() => {
        setGitAvailable(false)
        setInitGitOpen(false)
        setInitGitCreate(false)
      })
  }, [])

  const cancel = () => {
    setMode(null)
    setPickedPath(null)
    setProfileName('')
    setCreateName('')
  }

  /** Shared folder-picker: opens the native dialog. Resolves true when a path was chosen. */
  const browsePicker = async (onPicked: (path: string) => void) => {
    setIsPicking(true)
    try {
      const res = await fetch(`${API_BASE}/api/workspace/pick-folder`)
      if (res.ok) {
        const data = await res.json()
        if (data.path) {
          onPicked(data.path)
          return true
        }
      }
      return false
    } catch (err) {
      console.error('Failed to pick folder', err)
      toast.error('Failed to open folder picker dialog.')
      return false
    } finally {
      setIsPicking(false)
    }
  }

  const handleOpenExisting = async () => {
    setMode('open')
    const chose = await browsePicker((path) => {
      setPickedPath(path)
      setProfileName(basenameOf(path))
    })
    // Picker dismissed with no selection — back to rest.
    if (!chose) {
      setPickedPath(null)
      setProfileName('')
      setMode(null)
    }
  }

  const handleCreateNew = async () => {
    setMode('create')
    const chose = await browsePicker((path) => setPickedPath(path))
    if (!chose) {
      setPickedPath(null)
      setMode(null)
    }
  }

  const gitNote = (git: any): string | null => {
    if (!git) return null
    if (git.already_tracked) {
      const parent = git.git_parent ? ` (${String(git.git_parent).split(/[\\/]/).pop()})` : ''
      return `Already inside a Git repository${parent} — git init skipped.`
    }
    if (git.initialized) {
      let msg = 'Git repository initialized.'
      if (git.error) msg += ` Note: ${git.error}`
      return msg
    }
    if (git.error) return git.error
    return 'Git could not be initialized.'
  }

  const handleLink = async () => {
    if (!pickedPath) return
    setIsWorking(true)
    try {
      // One atomic call: link + profile record (+ git) persist together,
      // so rapid Links can never clobber each other's records.
      const res = await fetch(`${API_BASE}/api/workspace/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: pickedPath,
          name: profileName,
          init_git: initGitOpen && gitAvailable === true,
        }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        updateSettings({
          linked_workspace_dir: data.linked_workspace_dir,
          workspace_profiles: data.profiles,
        })
        if (data.git_requested) {
          const note = gitNote(data.git)
          if (data.git?.initialized || data.git?.already_tracked) {
            if (data.git?.already_tracked) toast.info(`Workspace linked. ${note}`)
            else toast.success(`Workspace linked. ${note}`)
          } else {
            // Linked, but Git failed — partial success, no rollback.
            toast.error(`Workspace linked, but Git could not be initialized. ${note}`)
          }
        } else {
          toast.success('Workspace linked.')
        }
        cancel()
      } else {
        toast.error(data.detail || 'Failed to link workspace.')
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error connecting to server.')
    } finally {
      setIsWorking(false)
    }
  }

  const createPath = () => {
    const loc = (pickedPath || '').replace(/[\\/]+$/, '')
    const name = createName.trim().replace(/[\\/]+$/, '')
    if (!loc || !name) return ''
    return `${loc}/${name}`
  }

  const handleCreateWorkspace = async () => {
    const path = createPath()
    if (!path) {
      toast.error('Enter a name for the new workspace.')
      return
    }

    setIsWorking(true)
    try {
      const res = await fetch(`${API_BASE}/api/workspace/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path,
          init_git: initGitCreate && gitAvailable === true,
          set_as_active: true,
          force: false,
          name: createName.trim(),
        })
      })
      const data = await res.json()
      if (res.ok && data.success) {
        updateSettings({
          linked_workspace_dir: data.path,
          workspace_profiles: data.profiles || settings.workspace_profiles || [],
        })
        if (data.git?.already_tracked) {
          const parent = data.git.git_parent ? ` (${data.git.git_parent.split(/[\\/]/).pop()})` : ''
          toast.info(`Workspace created. Already inside a Git repository${parent} — git init skipped.`)
        } else {
          let msg = `Workspace created and linked.`
          if (data.git?.initialized) msg += ' Git repository initialized.'
          if (data.git?.error) msg += ` Note: ${data.git.error}`
          toast.success(msg)
        }
        cancel()
      } else {
        toast.error(data.detail || 'Failed to create workspace.')
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error connecting to server.')
    } finally {
      setIsWorking(false)
    }
  }

  const handleSwitch = (path: string | null) => {
    // Switching only — never creates or reorders a profile.
    updateSettings({ linked_workspace_dir: path })
    toast.success(path ? 'Workspace switched.' : 'Reset to default fallback workspace.')
  }

  const handleRenameProfile = async (p: Profile) => {
    const raw = window.prompt('Rename workspace:', p.name)
    if (!raw) return
    const name = raw.trim()
    if (!name || name === p.name) return
    try {
      const res = await fetch(`${API_BASE}/api/workspace/profiles/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        updateSettings({ workspace_profiles: data.profiles })
        toast.success('Workspace renamed.')
      } else {
        toast.error(data.detail || 'Failed to rename workspace.')
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error connecting to server.')
    }
  }

  const handleDeleteWorkspace = async (p: Profile) => {
    const isActive = settings.linked_workspace_dir === p.path
    const confirmed = window.confirm(
      `Delete "${p.name}"?\n\nThis permanently deletes the folder:\n${p.path}\n\n` +
      `The workspace will be removed from your list${isActive ? ' and you will be switched back to the default workspace' : ''}. ` +
      `This cannot be undone.`
    )
    if (!confirmed) return
    try {
      const res = await fetch(`${API_BASE}/api/workspace/profiles/${p.id}?mode=delete`, { method: 'DELETE' })
      const data = await res.json()
      if (res.ok && data.success) {
        updateSettings({
          workspace_profiles: data.profiles,
          linked_workspace_dir: data.linked_workspace_dir ?? null,
        })
        toast.success(
          data.linked_workspace_dir
            ? 'Workspace deleted — folder removed from disk.'
            : 'Workspace deleted — folder removed from disk. Reset to default fallback workspace.'
        )
      } else {
        toast.error(data.detail || 'Failed to delete workspace.')
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error connecting to server.')
    }
  }

  const secondaryBtn = "shrink-0 px-3 py-1.5 rounded-[8px] text-[12px] border border-[var(--border-subtle)] text-[var(--text-heading)] hover:bg-[var(--bg-hover)] transition-colors font-medium cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
  const primaryBtn = "shrink-0 px-3 py-1.5 rounded-[8px] text-[12px] bg-[var(--accent-brown)] text-[var(--text-inverse)] hover:bg-[var(--accent-brown)]/90 transition-colors font-medium cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
  const quietBtn = "shrink-0 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-heading)] transition-colors cursor-pointer"

  const gitToggleRow = (
    label: string,
    checked: boolean,
    onChange: (v: boolean) => void,
  ) => (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[12px] text-[var(--text-secondary)]">
        {label}{gitAvailable === false ? ' (Git not found in PATH)' : ''}
      </span>
      <Toggle
        checked={checked && gitAvailable === true}
        onChange={onChange}
        disabled={gitAvailable === false}
        label={label}
      />
    </div>
  )

  const busy = isPicking || isWorking
  const isDefault = !settings.linked_workspace_dir

  const profileRow = (
    key: string,
    name: string,
    detail: string,
    isActive: boolean,
    onSelect: () => void,
    onRename?: () => void,
    onDelete?: () => void,
  ) => (
    <div
      key={key}
      className="group flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--bg-hover)]/40 transition-colors"
    >
      <button
        type="button"
        onClick={onSelect}
        disabled={isActive}
        className="flex items-center gap-2.5 flex-1 min-w-0 text-left cursor-pointer disabled:cursor-default"
      >
        <span className="w-4 shrink-0 flex items-center justify-center">
          {isActive && <Check size={15} className="text-[var(--accent-brown)]" />}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] text-[var(--text-heading)] truncate">{name}</span>
          <span className="block font-mono text-[11px] text-[var(--text-muted)] truncate">{detail}</span>
        </span>
      </button>
      {(onRename || onDelete) && (
        <span className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-all">
          {onRename && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                // window.prompt returns focus here on dismiss — blur so the
                // hover actions don't get stuck visible via focus-within.
                e.currentTarget.blur()
                onRename()
              }}
              aria-label={`Rename ${name}`}
              title={`Rename ${name}`}
              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-heading)] transition-colors cursor-pointer"
            >
              <Pencil size={13} />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                // window.confirm returns focus here on dismiss — blur so the
                // hover actions don't get stuck visible via focus-within.
                e.currentTarget.blur()
                onDelete()
              }}
              aria-label={`Delete ${name}`}
              title={`Delete ${name} — removes the folder from disk and forgets it`}
              className="p-1 rounded text-red-500 hover:text-red-600 hover:bg-red-500/10 transition-colors cursor-pointer"
            >
              <Trash2 size={13} />
            </button>
          )}
        </span>
      )}
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      <FilterSection query={query} keywords="workspace directory folder path link browse create git active saved switch recent rename delete">
        <section>
          <SectionLabel>Workspace</SectionLabel>
          <SectionCard>
            <div className="flex items-center gap-2 px-4 py-3 min-w-0">
              <Folder size={15} className="text-[var(--text-secondary)] shrink-0" />
              <span className="text-[var(--text-heading)] font-mono text-[12px] truncate">
                {activeProfile ? activeProfile.name : (settings.linked_workspace_dir || 'sample-workspace')}
              </span>
              <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
                · {settings.linked_workspace_dir ? 'Active' : 'Default'}
              </span>
            </div>

            <div className="px-4 py-3">
              <div className="flex gap-2">
                <button type="button" onClick={handleOpenExisting} disabled={busy} className={secondaryBtn}>
                  <span>Open existing</span>
                </button>
                <button type="button" onClick={handleCreateNew} disabled={busy} className={secondaryBtn}>
                  <span>Create new</span>
                </button>
              </div>

              {mode === 'open' && pickedPath && (
                <div className="mt-3 flex flex-col gap-2">
                  <input
                    type="text"
                    aria-label="Workspace name"
                    placeholder="Name"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    className="border border-[var(--border-subtle)] rounded-[8px] px-3 py-1.5 text-[13px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)] transition-colors min-w-0"
                  />
                  {gitToggleRow('Initialize as Git repository', initGitOpen, setInitGitOpen)}
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={handleLink} disabled={isWorking} className={primaryBtn}>
                      <span>Link</span>
                    </button>
                    <button type="button" onClick={cancel} className={quietBtn}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {mode === 'create' && pickedPath && (
                <div className="mt-3 flex flex-col gap-2">
                  <input
                    type="text"
                    placeholder="Name — e.g. my-new-novel"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    className="border border-[var(--border-subtle)] rounded-[8px] px-3 py-1.5 text-[13px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)] transition-colors min-w-0"
                  />
                  {gitToggleRow('Initialize as Git repository', initGitCreate, setInitGitCreate)}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleCreateWorkspace}
                      disabled={isWorking || !createPath()}
                      className={primaryBtn}
                    >
                      <span>Create</span>
                    </button>
                    <button type="button" onClick={cancel} className={quietBtn}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {profileRow('default', 'sample-workspace', 'Default', isDefault, () => handleSwitch(null))}
            {profiles.map((p) => {
              const isActive = settings.linked_workspace_dir === p.path
              return profileRow(
                p.id, p.name, p.path, isActive,
                () => handleSwitch(p.path),
                () => handleRenameProfile(p),
                () => handleDeleteWorkspace(p),
              )
            })}
          </SectionCard>
        </section>
      </FilterSection>
    </div>
  )
}
