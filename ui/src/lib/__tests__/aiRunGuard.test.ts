import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { beginAiRun, endAiRun, isOnRunFile, refuseWhileAiBusy, savableContent } from '../aiRunGuard'
import { applyHarnessResult, resolveHarnessReview } from '../applyHarnessResult'
import { useEditorStore, type FileEntry } from '../../stores/editorStore'

const A = 'chapters/a.md'
const B = 'chapters/b.md'
const entry = (path: string, content: string): FileEntry => ({ name: path, path, content, originalContent: content })

let puts: { url: string; body: string }[] = []
const originalFetch = globalThis.fetch

function installFetch(diskByPath: Record<string, string>) {
  puts = []
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'PUT') puts.push({ url, body: String(init.body) })
    const path = Object.keys(diskByPath).find((p) => url.includes(encodeURIComponent(p)))
    return { ok: true, status: 200, json: async () => ({ content: path ? diskByPath[path] : '' }) } as Response
  }) as typeof fetch
}

beforeEach(() => {
  useEditorStore.setState({
    currentFilePath: A,
    content: 'A original.',
    aiPendingEdit: null,
    aiRun: null,
    editor: null,
    openedFiles: [entry(A, 'A original.'), entry(B, 'B text.')],
  })
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('AI run lifecycle', () => {
  it('refuses file switches while a run is active, and allows them after', () => {
    const run = beginAiRun()
    expect(run.path).toBe(A)
    expect(refuseWhileAiBusy()).toBe(true)
    endAiRun(run)
    expect(refuseWhileAiBusy()).toBe(false)
  })

  it('refuses leaving a file whose harness review is still pending', () => {
    useEditorStore.setState({ aiPendingEdit: { filePath: A, previousContent: 'A original.', harness: 'claude' } })
    expect(refuseWhileAiBusy()).toBe(true)
  })

  it('does not let an older run clear a newer one', () => {
    const first = beginAiRun()
    const second = beginAiRun()
    endAiRun(first)
    expect(useEditorStore.getState().aiRun).toBe(second)
  })

  it('reports when the open file is no longer the run file', () => {
    const run = beginAiRun()
    useEditorStore.setState({ currentFilePath: B })
    expect(isOnRunFile(run)).toBe(false)
  })
})

describe('savableContent', () => {
  it("saves the pre-AI text only for the preview's own file", () => {
    useEditorStore.setState({
      currentFilePath: B,
      content: 'B text.',
      aiPendingEdit: { filePath: A, previousContent: 'A original.' },
    })
    expect(savableContent(B)).toBe('B text.')
    expect(savableContent(A)).toBe('A original.')
  })

  it('saves nothing while a harness review is pending (disk holds the agent version)', () => {
    useEditorStore.setState({
      currentFilePath: A,
      content: 'Merged text.',
      aiPendingEdit: { filePath: A, previousContent: 'A original.', harness: 'claude' },
    })
    expect(savableContent(A)).toBeNull()
  })
})

describe('applyHarnessResult when the user switched files mid-run', () => {
  it('leaves the editor and the other file alone', async () => {
    installFetch({ [A]: 'A edited by AI.', [B]: 'B text.' })
    useEditorStore.setState({ currentFilePath: B, content: 'B text.' })

    const result = await applyHarnessResult('A original.', 'claude', A)

    expect(result.skipped).toBe(true)
    const state = useEditorStore.getState()
    expect(state.content).toBe('B text.')
    expect(state.aiPendingEdit).toBeNull()
    expect(puts).toHaveLength(0)
    // A's cache is dropped so reopening it shows the AI's changes from disk
    expect(state.openedFiles.find((f) => f.path === A)).toMatchObject({ content: '', originalContent: '' })
  })

  it('records the run file on the preview when the run file is still open', async () => {
    installFetch({ [A]: 'A edited by AI.' })
    const result = await applyHarnessResult('A original.', 'claude', A)
    expect(result.skipped).toBe(false)
    expect(useEditorStore.getState().aiPendingEdit?.filePath).toBe(A)
  })

  it('merges text typed while the reload was in flight', async () => {
    let resolveFetch: (r: Response) => void = () => {}
    globalThis.fetch = vi.fn(() => new Promise<Response>((r) => { resolveFetch = r })) as unknown as typeof fetch
    useEditorStore.setState({ content: 'A original.\n\nSecond paragraph.' })

    const pending = applyHarnessResult('A original.\n\nSecond paragraph.', 'claude', A)
    useEditorStore.setState({ content: 'A original.\n\nSecond paragraph, typed during reload.' })
    resolveFetch({ ok: true, status: 200, json: async () => ({ content: 'A edited by AI.\n\nSecond paragraph.' }) } as Response)
    await pending

    const text = useEditorStore.getState().content
    expect(text).toContain('A edited by AI.')
    expect(text).toContain('typed during reload')
  })

  it('opens no review when the agent left the open file unchanged', async () => {
    installFetch({ [A]: 'A original.' })
    await applyHarnessResult('A original.', 'claude', A)
    expect(useEditorStore.getState().aiPendingEdit).toBeNull()
  })

  it('keeps a review for paragraphs the agent deleted', async () => {
    installFetch({ [A]: 'Keep me.' })
    useEditorStore.setState({ content: 'Keep me.\n\nDelete me.' })
    await applyHarnessResult('Keep me.\n\nDelete me.', 'claude', A)
    expect(useEditorStore.getState().aiPendingEdit?.filePath).toBe(A)
    expect(useEditorStore.getState().content).not.toContain('Delete me.')
  })

  it("never writes a preview's text into another open file on reject", async () => {
    installFetch({})
    useEditorStore.setState({
      currentFilePath: B,
      content: 'B text.',
      aiPendingEdit: { filePath: A, previousContent: 'A original.', harness: 'claude', aiChangedIdx: [0] },
    })
    expect(await resolveHarnessReview(false)).toBe(true)
    expect(puts).toHaveLength(0)
    expect(useEditorStore.getState().aiPendingEdit).toBeNull()
  })
})
