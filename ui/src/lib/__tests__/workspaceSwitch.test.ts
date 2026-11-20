import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prepareWorkspaceSwitch, detachOpenFile } from '../workspaceSwitch'
import { syncManifestFile } from '../workspaceStatus'
import { useEditorStore } from '../../stores/editorStore'

const MANIFEST = 'chapters/CHAPTERS.md'

beforeEach(() => {
  useEditorStore.setState({
    currentFilePath: 'chapters/a.md',
    content: 'A text.',
    aiRun: null,
    aiPendingEdit: null,
    editor: null,
    saveActiveFile: null,
    openedFiles: [{ name: 'a.md', path: 'chapters/a.md', content: 'A text.', originalContent: 'A text.' }],
  })
})

afterEach(() => vi.restoreAllMocks())

describe('prepareWorkspaceSwitch', () => {
  it('saves the open file before the backend switches workspace', async () => {
    const save = vi.fn().mockResolvedValue(true)
    useEditorStore.setState({ saveActiveFile: save })
    expect(await prepareWorkspaceSwitch()).toBe(true)
    expect(save).toHaveBeenCalledOnce()
  })

  it('does not switch when the save fails', async () => {
    useEditorStore.setState({ saveActiveFile: vi.fn().mockResolvedValue(false) })
    expect(await prepareWorkspaceSwitch()).toBe(false)
  })

  it('does not switch while an AI edit runs', async () => {
    const save = vi.fn().mockResolvedValue(true)
    useEditorStore.setState({ saveActiveFile: save, aiRun: { path: 'chapters/a.md' } })
    expect(await prepareWorkspaceSwitch()).toBe(false)
    expect(save).not.toHaveBeenCalled()
  })
})

describe('detachOpenFile', () => {
  it('drops the open path so no save can target the new workspace', () => {
    detachOpenFile()
    const s = useEditorStore.getState()
    expect(s.currentFilePath).toBeNull()
    expect(s.content).toBe('')
  })
})

describe('syncManifestFile', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ content: '| updated on disk |' }) })) as unknown as typeof fetch
  })

  it('keeps unsaved edits in an open manifest', async () => {
    useEditorStore.setState({
      currentFilePath: MANIFEST,
      content: '| my unsaved row |',
      openedFiles: [{ name: 'CHAPTERS.md', path: MANIFEST, content: '| my unsaved row |', originalContent: '| old |' }],
    })
    await syncManifestFile('chapters')
    expect(useEditorStore.getState().content).toBe('| my unsaved row |')
  })

  it('keeps unsaved edits cached for a manifest that is not open', async () => {
    useEditorStore.setState({
      currentFilePath: 'chapters/a.md',
      content: 'A text.',
      openedFiles: [
        { name: 'a.md', path: 'chapters/a.md', content: 'A text.', originalContent: 'A text.' },
        { name: 'CHAPTERS.md', path: MANIFEST, content: '| unsaved after a failed save |', originalContent: '| old |' },
      ],
    })
    await syncManifestFile('chapters')
    const manifest = useEditorStore.getState().openedFiles.find((f) => f.path === MANIFEST)
    expect(manifest?.content).toBe('| unsaved after a failed save |')
  })

  it('reloads an open manifest with no unsaved edits', async () => {
    useEditorStore.setState({
      currentFilePath: MANIFEST,
      content: '| old |',
      openedFiles: [{ name: 'CHAPTERS.md', path: MANIFEST, content: '| old |', originalContent: '| old |' }],
    })
    await syncManifestFile('chapters')
    expect(useEditorStore.getState().content).toBe('| updated on disk |')
  })
})
