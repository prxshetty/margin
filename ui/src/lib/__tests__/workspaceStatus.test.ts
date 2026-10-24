import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { refreshWorkspaceStatus } from '../workspaceStatus'
import { useEditorStore } from '../../stores/editorStore'

describe('workspaceStatus - PR #14 review regressions', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    useEditorStore.setState({
      isGitWorkspace: true,
      currentFilePath: null,
      fileStatusMap: {
        'chapters/chapter-1.md': 'unstaged_modified',
        'chapters/chapter-2.md': 'staged',
      },
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('Issue 2: does not overwrite fileStatusMap when /api/workspace/status returns stale: true', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        is_git: true,
        stale: true,
        statuses: {
          'chapters/chapter-1.md': 'unstaged_modified',
          // chapters/chapter-2.md missing due to mid-walk failure
        },
      }),
    } as unknown as Response)

    await refreshWorkspaceStatus(true)

    const map = useEditorStore.getState().fileStatusMap
    expect(map['chapters/chapter-2.md']).toBe('staged')
  })

  it('Issue 5: filters out any .margin-shadow/ or dot-prefixed paths from fileStatusMap', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        is_git: true,
        statuses: {
          'chapters/chapter-1.md': 'clean',
          '.margin-shadow/chapters/chapter-1.md': 'clean',
          '.git/info/notes.md': 'untracked',
        },
      }),
    } as unknown as Response)

    await refreshWorkspaceStatus(true)

    const map = useEditorStore.getState().fileStatusMap
    expect(map['chapters/chapter-1.md']).toBe('clean')
    expect(map['.margin-shadow/chapters/chapter-1.md']).toBeUndefined()
    expect(map['.git/info/notes.md']).toBeUndefined()
  })
})
