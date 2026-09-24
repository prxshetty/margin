import { useState, useEffect, useRef } from 'react'
import { Pencil, Trash2, X, FolderOpen, Plus } from 'lucide-react'
import type { AppSettings } from '../../stores/settingsStore'
import { toast } from '../../stores/toastStore'
import { API_BASE } from '../../lib/api'
import { FilterSection, SectionCard, SectionLabel, Toggle } from './shared'

type Profile = { id: string; name: string; path: string }

function WorkspaceEditDialog({ profile, gitAvailable, onSaveName, onClose }: {
  profile: Profile
  gitAvailable: boolean | null
  onSaveName: (name: string) => Promise<boolean>
  onClose: () => void
}) {
  const [name, setName] = useState(profile.name)
  const [gitBusy, setGitBusy] = useState(false)
  const [gitOn, setGitOn] = useState(false)
  const [gitNote, setGitNote] = useState<string | null>(null)

  // Learn the real state on open so the toggle never lies (it starts off —
  // without this a tracked folder would show OFF until first touched).
  useEffect(() => {
    fetch(`${API_BASE}/api/workspace/git-tracked?path=${encodeURIComponent(profile.path)}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (data && data.tracked) setGitOn(true) })
      .catch(() => { /* toggle simply stays off */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.path])

  const handleSave = async () => {
    if (await onSaveName(name.trim())) onClose()
  }

  // Toggle on initializes; toggle off (after confirm) removes .git —
  // history deleted, files kept. The backend only ever removes the
  // folder's own `.git` directory, never a parent repo.
  const handleGitToggle = async (next: boolean) => {
    if (next === gitOn) return
    if (next) {
      setGitBusy(true)
      setGitNote(null)
      try {
        const res = await fetch(`${API_BASE}/api/workspace/git-init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: profile.path }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.success) {
          throw new Error(data.detail || 'Git init failed.')
        }
        const git = data.git || {}
        if (git.already_tracked) {
          const parent = git.git_parent ? ` (${String(git.git_parent).split(/[\\/]/).pop()})` : ''
          setGitOn(true)
          toast.info(`Already inside a Git repository${parent} — nothing to do.`)
        } else if (git.initialized) {
          let msg = 'Git repository initialized.'
          if (git.error) msg += ` Note: ${git.error}`
          setGitOn(true)
          toast.success(msg)
        } else {
          setGitNote(git.error || 'Git could not be initialized.')
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Git init failed.'
        setGitNote(msg)
        toast.error(msg)
      } finally {
        setGitBusy(false)
      }
      return
    }
    const confirmed = window.confirm(
      `Remove the Git repository for "${profile.name}"?\n\nIts history will be deleted. Your files stay on disk.`
    )
    if (!confirmed) return
    setGitBusy(true)
    setGitNote(null)
    try {
      const res = await fetch(`${API_BASE}/api/workspace/git?path=${encodeURIComponent(profile.path)}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        throw new Error(data.detail || 'Could not remove the Git repository.')
      }
      setGitOn(false)
      toast.success('Git repository removed — files kept.')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not remove the Git repository.'
      setGitNote(msg)
      toast.error(msg)
    } finally {
      setGitBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/15 dark:bg-black/45 backdrop-blur-[2px] z-[200] flex items-center justify-center p-4 animate-scale-in">
      <div className="bg-[var(--bg)] border border-[var(--border-subtle)] w-full max-w-lg rounded-[16px] shadow-none p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-medium text-[var(--text-heading)]">Edit Workspace</h3>
          <button onClick={onClose} className="flex items-center justify-center w-8 h-8 text-[var(--text-muted)] hover:text-[var(--text-heading)] transition-colors cursor-pointer">
            <X size={15} />
          </button>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[12px] font-medium text-[var(--text-secondary)]">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-[var(--border-subtle)] rounded-[4px] px-3 py-2 text-[12px] bg-[var(--bg-input)] text-[var(--text)] outline-none focus:border-[var(--text-secondary)]"
          />
          <p className="text-[11px] text-[var(--text-muted)] font-mono truncate" title={profile.path}>{profile.path}</p>
        </div>
        <div className="flex flex-col gap-2 border-t border-[var(--border-subtle)]/50 pt-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col">
              <span className="text-[12px] font-medium text-[var(--text-heading)]">Git repository</span>
              <span className="text-[10.5px] text-[var(--text-secondary)]">
                {gitAvailable === false ? 'Git not found in PATH.' : 'Initialize a repository in this workspace folder.'}
              </span>
            </div>
            <Toggle
              checked={gitOn}
              onChange={(next) => void handleGitToggle(next)}
              disabled={gitBusy || gitAvailable === false}
              label="Git repository"
            />
          </div>
          {gitNote && <p className="text-[11px] text-[var(--text-secondary)]">{gitNote}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)]/50 pt-3">
          <button
            onClick={() => void handleSave()}
            disabled={!name.trim() || name.trim() === profile.name}
            className="px-3 py-1.5 text-[12px] bg-[var(--accent-brown)] text-[var(--text-inverse)] rounded-[8px] hover:bg-[var(--accent-brown-hover)] transition-colors disabled:opacity-50 cursor-pointer"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

const basenameOf = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p

export function WorkspacesSettings({ settings, updateSettings, query }: { settings: AppSettings, updateSettings: (u: Partial<AppSettings>) => void, query: string }) {
  const [pickedPath, setPickedPath] = useState<string | null>(null)
  const [profileName, setProfileName] = useState('')
  const [createName, setCreateName] = useState('')
  const [isPicking, setIsPicking] = useState(false)
  // Synchronous re-entrancy guard: `busy` only disables the buttons after a
  // re-render, so a fast double-click would fire two picker requests and
  // stack two native dialogs (cancelling the first reveals the second).
  // Refs update synchronously, closing that window.
  const pickingRef = useRef(false)
  const [initGitOpen, setInitGitOpen] = useState(false)
  const [initGitCreate, setInitGitCreate] = useState(false)  // default false — local-first
  const [gitAvailable, setGitAvailable] = useState<boolean | null>(null)
  const [isWorking, setIsWorking] = useState(false)
  const [mode, setMode] = useState<'open' | 'create' | null>(null)
  const [editProfile, setEditProfile] = useState<Profile | null>(null)

  const profiles: Profile[] = settings.workspace_profiles || []
  // Resolve the edit target from live settings so the dialog never holds a
  // stale copy (e.g. deleted elsewhere while open → dialog closes).
  const liveEditProfile = editProfile
    ? profiles.find((p) => p.id === editProfile.id) ?? null
    : null

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
    if (pickingRef.current) return false
    pickingRef.current = true
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
      pickingRef.current = false
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

  // Rename runs from the edit dialog (validated there); returns success.
  const handleRenameSave = async (p: Profile, raw: string): Promise<boolean> => {
    const name = raw.trim()
    if (!name || name === p.name) return false
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
        return true
      } else {
        toast.error(data.detail || 'Failed to rename workspace.')
        return false
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error connecting to server.')
      return false
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

  // Quiet text actions — same treatment as other tabs' "Add …" buttons.
  const quietActionBtn = "flex items-center gap-1 px-2 py-1 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-heading)] transition-colors cursor-pointer disabled:opacity-50"
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

  // Manage-only rows: name + path + rename/delete actions. No selection —
  // switching lives in the sidebar switcher.
  const profileRow = (
    key: string,
    name: string,
    detail: string,
    onRename?: () => void,
    onDelete?: () => void,
  ) => (
    <div
      key={key}
      className="group flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--bg-hover)]/40 transition-colors"
    >
      <span className="flex items-center gap-2.5 flex-1 min-w-0">
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] text-[var(--text-heading)] truncate">{name}</span>
          <span className="block font-mono text-[11px] text-[var(--text-muted)] truncate">{detail}</span>
        </span>
      </span>
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
              aria-label={`Edit ${name}`}
              title={`Edit ${name}`}
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
      <FilterSection query={query} keywords="workspace directory folder path link browse create git rename delete profiles">
        <section>
          <SectionLabel>Workspace</SectionLabel>
          <SectionCard>
            {profiles.length === 0 && (
              <p className="text-[12px] text-[var(--text-secondary)] px-4 py-3 text-center">No workspaces yet — open or create one below.</p>
            )}
            {profiles.map((p) => profileRow(
              p.id, p.name, p.path,
              () => setEditProfile(p),
              () => handleDeleteWorkspace(p),
            ))}
          </SectionCard>

          {/* Open / Create live below the card like other tabs' actions —
              the inline form follows its trigger so the two never split. */}
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" onClick={handleOpenExisting} disabled={busy} className={quietActionBtn}>
              <FolderOpen size={13} /> Open existing
            </button>
            <button type="button" onClick={handleCreateNew} disabled={busy} className={quietActionBtn}>
              <Plus size={13} /> Create new
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
        </section>
      </FilterSection>

      {liveEditProfile && (
        <WorkspaceEditDialog
          key={liveEditProfile.id}
          profile={liveEditProfile}
          gitAvailable={gitAvailable}
          onSaveName={(name) => handleRenameSave(liveEditProfile, name)}
          onClose={() => setEditProfile(null)}
        />
      )}
    </div>
  )
}
