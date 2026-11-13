import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mergeFileListing, scheduleFileRefresh } from '../refreshFiles'
import { useEditorStore, type FileEntry } from '../../stores/editorStore'

const A = 'chapters/a.md'
const B = 'chapters/b.md'
const entry = (path: string, content: string, originalContent = content): FileEntry => ({
  name: path.split('/').pop() || path,
  path,
  content,
  originalContent,
})

describe('mergeFileListing', () => {
  it('leaves the open file untouched so it does not look dirty mid-run', () => {
    const merged = mergeFileListing([entry(A, 'Pre-run text.')], [{ name: 'a.md', path: A }], A)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ content: 'Pre-run text.', originalContent: 'Pre-run text.' })
  })

  it('carries deleted and tracked flags from the listing onto known files', () => {
    const merged = mergeFileListing(
      [entry(A, 'a'), { ...entry(B, 'b'), tracked: true }],
      [{ name: 'a.md', path: A, deleted: true, tracked: true }, { name: 'b.md', path: B }],
      A
    )
    expect(merged.find((f) => f.path === A)).toMatchObject({ deleted: true, tracked: true, content: 'a' })
    expect(merged.find((f) => f.path === B)).toMatchObject({ deleted: false, tracked: true })
  })

  it('marks other clean files unloaded so opening them re-fetches agent changes', () => {
    const merged = mergeFileListing(
      [entry(A, 'a'), entry(B, 'old b')],
      [{ name: 'a.md', path: A }, { name: 'b.md', path: B }],
      A
    )
    expect(merged.find((f) => f.path === B)).toMatchObject({ content: '', originalContent: '' })
  })

  it('keeps unsaved text in another file', () => {
    const merged = mergeFileListing(
      [entry(A, 'a'), entry(B, 'edited b', 'old b')],
      [{ name: 'a.md', path: A }, { name: 'b.md', path: B }],
      A
    )
    expect(merged.find((f) => f.path === B)).toMatchObject({ content: 'edited b', originalContent: 'old b' })
  })

  it('adds new files, drops deleted ones, and keeps prompts and the open file', () => {
    const merged = mergeFileListing(
      [entry(A, 'a'), entry(B, 'b'), entry('prompts/p.md', 'p')],
      [{ name: 'c.md', path: 'chapters/c.md' }],
      A
    )
    expect(merged.map((f) => f.path).sort()).toEqual([A, 'chapters/c.md', 'prompts/p.md'])
  })
})

describe('scheduleFileRefresh', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.useFakeTimers()
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [{ name: 'a.md', path: A }],
    })) as unknown as typeof fetch
    useEditorStore.setState({
      currentFilePath: A,
      content: 'Pre-run text.',
      openedFiles: [entry(A, 'Pre-run text.')],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = originalFetch
  })

  it('keeps the open file clean after a refresh during a harness run', async () => {
    scheduleFileRefresh(0)
    await vi.runAllTimersAsync()
    const { openedFiles, content } = useEditorStore.getState()
    expect(openedFiles[0].originalContent).toBe(content)
  })
})
