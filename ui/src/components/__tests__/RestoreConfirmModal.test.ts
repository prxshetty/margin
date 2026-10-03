import { describe, it, expect } from 'vitest'
import { getDynamicDescription, deriveRestoreOptions, type RestoreInfo } from '../RestoreConfirmModal'

describe('RestoreConfirmModal - deriveRestoreOptions', () => {
  it('defaults to worktree_only for new file staged and modified with in-editor changes (before restoreInfo loads)', () => {
    const opts = deriveRestoreOptions({
      isGitWorkspace: true,
      restoreInfo: null,
      fileStatus: 'staged',
      hasUnstagedChanges: true,
      isDeleted: false,
    })
    expect(opts.canWorktreeOnly).toBe(true)
    expect(opts.canStagedAndUnstage).toBe(true)
    expect(opts.canCommitted).toBe(false)
    expect(opts.defaultMode).toBe('worktree_only')
  })

  it('defaults to worktree_only for new file staged and modified with server restoreInfo', () => {
    const mockRestoreInfo: RestoreInfo = {
      is_git: true,
      path: 'chapters/new-file.md',
      fileName: 'new-file.md',
      is_renamed: false,
      renamed_from: null,
      is_deleted: false,
      has_staged_changes: true,
      has_unstaged_changes: true,
      has_committed_version: false,
      can_restore_worktree_only: true,
      can_restore_staged_and_unstage: true,
      can_restore_committed: false,
    }
    const opts = deriveRestoreOptions({
      isGitWorkspace: true,
      restoreInfo: mockRestoreInfo,
      fileStatus: 'staged_modified',
      hasUnstagedChanges: true,
      isDeleted: false,
    })
    expect(opts.canWorktreeOnly).toBe(true)
    expect(opts.canStagedAndUnstage).toBe(true)
    expect(opts.canCommitted).toBe(false)
    expect(opts.defaultMode).toBe('worktree_only')
  })

  it('defaults to worktree_only even if server has_unstaged_changes is false when hasUnstagedChanges is true in editor', () => {
    const mockRestoreInfo: RestoreInfo = {
      is_git: true,
      path: 'chapters/new-file.md',
      fileName: 'new-file.md',
      is_renamed: false,
      renamed_from: null,
      is_deleted: false,
      has_staged_changes: true,
      has_unstaged_changes: false, // in-memory edit not yet flushed to disk
      has_committed_version: false,
      can_restore_worktree_only: false,
      can_restore_staged_and_unstage: true,
      can_restore_committed: false,
    }
    const opts = deriveRestoreOptions({
      isGitWorkspace: true,
      restoreInfo: mockRestoreInfo,
      fileStatus: 'staged',
      hasUnstagedChanges: true,
      isDeleted: false,
    })
    expect(opts.canWorktreeOnly).toBe(true)
    expect(opts.canStagedAndUnstage).toBe(true)
    expect(opts.defaultMode).toBe('worktree_only')
  })

  it('defaults to staged_and_unstage for clean staged new file (no working copy changes)', () => {
    const mockRestoreInfo: RestoreInfo = {
      is_git: true,
      path: 'chapters/new-file.md',
      fileName: 'new-file.md',
      is_renamed: false,
      renamed_from: null,
      is_deleted: false,
      has_staged_changes: true,
      has_unstaged_changes: false,
      has_committed_version: false,
      can_restore_worktree_only: false,
      can_restore_staged_and_unstage: true,
      can_restore_committed: false,
    }
    const opts = deriveRestoreOptions({
      isGitWorkspace: true,
      restoreInfo: mockRestoreInfo,
      fileStatus: 'staged',
      hasUnstagedChanges: false,
      isDeleted: false,
    })
    expect(opts.canWorktreeOnly).toBe(false)
    expect(opts.canStagedAndUnstage).toBe(true)
    expect(opts.canCommitted).toBe(false)
    expect(opts.defaultMode).toBe('staged_and_unstage')
  })

  it('defaults to committed and disables other options for clean staged previously committed file', () => {
    const mockRestoreInfo: RestoreInfo = {
      is_git: true,
      path: 'chapters/chapter-1.md',
      fileName: 'chapter-1.md',
      is_renamed: false,
      renamed_from: null,
      is_deleted: false,
      has_staged_changes: true,
      has_unstaged_changes: false,
      has_committed_version: true,
      can_restore_worktree_only: false,
      can_restore_staged_and_unstage: false,
      can_restore_committed: true,
    }
    const opts = deriveRestoreOptions({
      isGitWorkspace: true,
      restoreInfo: mockRestoreInfo,
      fileStatus: 'staged',
      hasUnstagedChanges: false,
      isDeleted: false,
    })
    expect(opts.canWorktreeOnly).toBe(false)
    expect(opts.canStagedAndUnstage).toBe(false)
    expect(opts.canCommitted).toBe(true)
    expect(opts.defaultMode).toBe('committed')
  })

  it('defaults to committed for deleted file in git workspace (before restoreInfo loads)', () => {
    const opts = deriveRestoreOptions({
      isGitWorkspace: true,
      restoreInfo: null,
      fileStatus: 'staged_deleted',
      hasUnstagedChanges: false,
      isDeleted: true,
    })
    expect(opts.canWorktreeOnly).toBe(false)
    expect(opts.canStagedAndUnstage).toBe(false)
    expect(opts.canCommitted).toBe(true)
    expect(opts.defaultMode).toBe('committed')
  })

  it('defaults to committed for deleted file in git workspace with server restoreInfo', () => {
    const mockRestoreInfo: RestoreInfo = {
      is_git: true,
      path: 'characters/protagonist.md',
      fileName: 'protagonist.md',
      is_renamed: false,
      renamed_from: null,
      is_deleted: true,
      has_staged_changes: true,
      has_unstaged_changes: false,
      has_committed_version: true,
      can_restore_worktree_only: false,
      can_restore_staged_and_unstage: false,
      can_restore_committed: true,
    }
    const opts = deriveRestoreOptions({
      isGitWorkspace: true,
      restoreInfo: mockRestoreInfo,
      fileStatus: 'staged_deleted',
      hasUnstagedChanges: false,
      isDeleted: true,
    })
    expect(opts.canWorktreeOnly).toBe(false)
    expect(opts.canStagedAndUnstage).toBe(false)
    expect(opts.canCommitted).toBe(true)
    expect(opts.defaultMode).toBe('committed')
  })

  it('defaults to committed in non-git workspace', () => {
    const opts = deriveRestoreOptions({
      isGitWorkspace: false,
      restoreInfo: null,
      fileStatus: 'unstaged_modified',
      hasUnstagedChanges: true,
      isDeleted: false,
    })
    expect(opts.defaultMode).toBe('committed')
  })
})

describe('RestoreConfirmModal - getDynamicDescription', () => {
  describe('Non-git workspace', () => {
    it('returns non-git snapshot baseline message for normal files', () => {
      const desc = getDynamicDescription('committed', 'chapter-1.md', false, null, false, false)
      expect(desc).toBe('This will discard all changes made since the last snapshot baseline was created for this file.')
    })

    it('returns deleted snapshot baseline message for deleted files', () => {
      const desc = getDynamicDescription('committed', 'chapter-1.md', false, null, true, false)
      expect(desc).toContain('This file was deleted. Restoring will recover the file from the last snapshot baseline.')
    })
  })

  describe('Git workspace - Normal (not renamed) files', () => {
    it('returns correct impact for worktree_only mode', () => {
      const desc = getDynamicDescription('worktree_only', 'chapter-1.md', false, null, false, true)
      expect(desc).toContain('discard uncommitted modifications in your working copy and restore the file to the staged version')
      expect(desc).toContain('Staged changes will remain staged in Git.')
    })

    it('returns correct impact for staged_and_unstage mode', () => {
      const desc = getDynamicDescription('staged_and_unstage', 'chapter-1.md', false, null, false, true)
      expect(desc).toContain('restore the content of the staged version to the working tree and unstage it')
      expect(desc).toContain('kept in your working copy as uncommitted modifications')
    })

    it('returns correct impact for committed mode', () => {
      const desc = getDynamicDescription('committed', 'chapter-1.md', false, null, false, true)
      expect(desc).toContain('discard all uncommitted modifications and staged changes in this file')
      expect(desc).toContain('restore it to the committed baseline version from repository HEAD')
    })

    it('returns correct impact for deleted file in git', () => {
      const desc = getDynamicDescription('committed', 'chapter-1.md', false, null, true, true)
      expect(desc).toContain('This file was deleted in Git. Restoring will recover the committed version from the repository (HEAD).')
    })

    it('returns correct impact for staged_deleted file in git when staged_and_unstage is selected', () => {
      const desc = getDynamicDescription('staged_and_unstage', 'chapter-1.md', false, null, true, true)
      expect(desc).toContain('This file was staged for deletion. Restoring and unstaging will undo the staged deletion in Git.')
    })
  })

  describe('Git workspace - Renamed files', () => {
    const fileName = 'chapter-one.md'
    const origPath = 'chapters/chapter-1.md'
    const origName = 'chapter-1.md'

    it('returns correct impact for worktree_only on renamed file', () => {
      const desc = getDynamicDescription('worktree_only', fileName, true, origPath, false, true)
      expect(desc).toContain(`This file was renamed from ${origName}`)
      expect(desc).toContain(`reverting the file to its staged version`)
      expect(desc).toContain(`The file will remain renamed as ${fileName} and remain staged in Git.`)
    })

    it('returns correct impact for staged_and_unstage on renamed file', () => {
      const desc = getDynamicDescription('staged_and_unstage', fileName, true, origPath, false, true)
      expect(desc).toContain(`This file was renamed from ${origName}`)
      expect(desc).toContain(`undo the staged rename`)
      expect(desc).toContain(`restore ${origName} with the staged content`)
      expect(desc).toContain(`changes are preserved in your working copy as uncommitted modifications`)
    })

    it('returns correct impact for committed mode on renamed file', () => {
      const desc = getDynamicDescription('committed', fileName, true, origPath, false, true)
      expect(desc).toContain(`This file was renamed from ${origName}`)
      expect(desc).toContain(`undo the rename`)
      expect(desc).toContain(`remove ${fileName}`)
      expect(desc).toContain(`restore ${origName} to its committed baseline version from repository HEAD`)
    })
  })
})
