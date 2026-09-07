import { API_BASE } from './api'
import { useEditorStore } from '../stores/editorStore'
import type { Editor } from '@tiptap/core'

// ─── Paragraph three-way merge ───────────────────────────────────────────────
// v1 scope: paragraph-oriented (blank-line separated), exact-match identity.
// Maps cleanly onto the existing single-range AiDiffHighlight.

type Tag = 'equal' | 'replace' | 'delete' | 'insert'
interface Opcode { tag: Tag; i1: number; i2: number; j1: number; j2: number }

export function splitParas(text: string): string[] {
  return text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0)
}

// LCS-based opcodes, difflib-style. Docs are small; O(n*m) is fine.
export function opcodes(a: string[], b: string[]): Opcode[] {
  const n = a.length, m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops: Opcode[] = []
  let i = 0, j = 0
  const push = (tag: Tag, i1: number, i2: number, j1: number, j2: number) => {
    const last = ops[ops.length - 1]
    if (last && last.tag === tag && last.i2 === i1 && last.j2 === j1) {
      last.i2 = i2; last.j2 = j2
    } else {
      ops.push({ tag, i1, i2, j1, j2 })
    }
  }
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      const i1 = i, j1 = j
      while (i < n && j < m && a[i] === b[j]) { i++; j++ }
      push('equal', i1, i, j1, j)
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('delete', i, i + 1, j, j); i++
    } else {
      push('insert', i, i, j, j + 1); j++
    }
  }
  if (i < n) push('delete', i, n, j, j)
  if (j < m) push('insert', i, i, j, m)
  // Merge adjacent delete+insert pairs into replace
  const merged: Opcode[] = []
  for (const op of ops) {
    const last = merged[merged.length - 1]
    if (last && ((last.tag === 'delete' && op.tag === 'insert') || (last.tag === 'insert' && op.tag === 'delete')) && last.i2 === op.i1) {
      last.tag = 'replace'
      last.i2 = Math.max(last.i2, op.i2); last.j2 = Math.max(last.j2, op.j2)
    } else merged.push({ ...op })
  }
  return merged
}

export interface MergeResult {
  merged: string[]
  conflicts: number
  aiChangedIdx: Set<number> // merged indices owned by AI-only changes
}

// Three-way merge: base + ai-side + user-side → merged.
// Groups overlapping non-equal base ranges; within a group:
// AI-only → take AI, user-only → take user, both → keep user + conflict.
// Pure inserts at the same position from both sides are all kept (no conflict).
export function threeWayMerge(base: string[], ai: string[], current: string[]): MergeResult {
  const opsA = opcodes(base, ai).filter(o => o.tag !== 'equal')
  const opsB = opcodes(base, current).filter(o => o.tag !== 'equal')
  const merged: string[] = []
  const aiChangedIdx = new Set<number>()
  let conflicts = 0

  interface Group { s: number; e: number; a: Opcode[]; b: Opcode[] }
  const groups: Group[] = []
  const all = [
    ...opsA.map(o => ({ o, side: 'a' as const })),
    ...opsB.map(o => ({ o, side: 'b' as const })),
  ].sort((x, y) => x.o.i1 - y.o.i1 || x.o.i2 - y.o.i2)
  for (const { o, side } of all) {
    const last = groups[groups.length - 1]
    // Strict overlap only: adjacent ranges (e.g. B→B2 by AI, C→C2 by user)
    // are disjoint paragraphs, not conflicts. Same-position pure inserts
    // still work as separate groups (stable sort emits AI side first).
    if (last && o.i1 < last.e) {
      last.e = Math.max(last.e, o.i2)
      if (side === 'a') last.a.push(o); else last.b.push(o)
    } else {
      groups.push({ s: o.i1, e: o.i2, a: side === 'a' ? [o] : [], b: side === 'b' ? [o] : [] })
    }
  }

  const pushAi = (paras: string[]) => {
    for (const p of paras) { aiChangedIdx.add(merged.length); merged.push(p) }
  }

  let pos = 0
  for (const g of groups) {
    for (let k = pos; k < g.s && k < base.length; k++) merged.push(base[k])
    const aInsertsOnly = g.a.length > 0 && g.a.every(o => o.i1 === o.i2)
    const bInsertsOnly = g.b.length > 0 && g.b.every(o => o.i1 === o.i2)
    if (g.a.length > 0 && g.b.length === 0) {
      for (const o of g.a) pushAi(ai.slice(o.j1, Math.min(o.j2, ai.length)))
    } else if (g.b.length > 0 && g.a.length === 0) {
      for (const o of g.b) merged.push(...current.slice(o.j1, Math.min(o.j2, current.length)))
    } else if (aInsertsOnly && bInsertsOnly) {
      for (const o of g.a) pushAi(ai.slice(o.j1, Math.min(o.j2, ai.length)))
      for (const o of g.b) merged.push(...current.slice(o.j1, Math.min(o.j2, current.length)))
    } else {
      // Both sides touched overlapping ranges → keep user's, count conflict
      conflicts++
      // Emit the user side covering the group span
      const j1 = Math.min(...g.b.map(o => o.j1))
      const j2 = Math.max(...g.b.map(o => o.j2))
      merged.push(...current.slice(j1, Math.min(j2, current.length)))
    }
    pos = g.e
  }
  for (let k = pos; k < base.length; k++) merged.push(base[k])

  return { merged, conflicts, aiChangedIdx }
}

async function putFileContent(path: string, content: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/workspace/files/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error(`Failed to save ${path}: ${res.status}`)
  useEditorStore.getState().markFileClean(path)
}

function setEditorContent(content: string) {
  const s = useEditorStore.getState()
  s.setContent(content)
  if (s.currentFilePath) s.loadFileContent(s.currentFilePath, content)
  s.editor?.commands.setContent(content)
}

// (Re)apply the diff highlight for a pending harness review. Runs after the
// merge AND after NovelEditor's content-sync rebuild: that rebuild replaces
// EditorState (to reset undo history), which re-initializes plugin state and
// wipes the decorations set moments earlier.
export function reapplyHarnessHighlight(editor: Editor): void {
  const pending = useEditorStore.getState().aiPendingEdit
  if (!pending?.harness || !pending.aiChangedIdx?.length) return
  const blocks: { from: number; to: number }[] = []
  editor.state.doc.forEach((node, offset) => {
    if (node.isBlock) blocks.push({ from: offset, to: offset + node.nodeSize })
  })
  const idx = pending.aiChangedIdx.filter(k => k < blocks.length)
  if (idx.length > 0) {
    editor.commands.setAiHighlight(blocks[Math.min(...idx)].from, blocks[Math.max(...idx)].to)
  }
}

// Called on `harness_done`. Never overwrites the user's newer edits:
// merges AI disk changes with current editor content (3-way, base = snapshot).
export async function applyHarnessResult(baseContent: string, harness: string): Promise<{ conflicts: number; deleted: boolean }> {
  const s = useEditorStore.getState()
  if (!s.currentFilePath) return { conflicts: 0, deleted: false }
  const deletedPath = s.currentFilePath
  const res = await fetch(`${API_BASE}/api/workspace/files/${encodeURIComponent(deletedPath)}`)
  if (res.status === 404) {
    // The agent deleted the open file: drop it from the sidebar, blank the
    // editor, and report back instead of erroring — there is nothing to merge.
    const st = useEditorStore.getState()
    st.removeFile(deletedPath)
    st.setCurrentFilePath(null)
    st.setContent('')
    st.setAiPendingEdit(null)
    st.editor?.commands.setContent('')
    st.editor?.commands.clearAiHighlight()
    return { conflicts: 0, deleted: true }
  }
  if (!res.ok) throw new Error(`Failed to reload ${deletedPath}: ${res.status}`)
  const { content: aiContent } = await res.json()

  const base = splitParas(baseContent)
  const ai = splitParas(aiContent)
  const current = splitParas(s.content)
  const { merged, conflicts, aiChangedIdx } = threeWayMerge(base, ai, current)

  setEditorContent(merged.join('\n\n'))
  useEditorStore.getState().setAiPendingEdit({
    previousContent: baseContent,
    aiContent,
    harness,
    // Merged indices owned by AI-only changes. Reject drops exactly these.
    // (Attribution can't be recomputed later: once AI text is in `current`,
    // diffing base→current makes it look user-made.)
    aiChangedIdx: [...aiChangedIdx],
  })

  // Highlight AI-owned ranges (single span min→max; limitation documented)
  const editor = useEditorStore.getState().editor
  if (editor) reapplyHarnessHighlight(editor)
  return { conflicts, deleted: false }
}

// Accept / Reject for harness runs. Returns true if handled (harness pending
// edit present), false to fall back to the legacy API-mode path.
export async function resolveHarnessReview(accept: boolean): Promise<boolean> {
  const s = useEditorStore.getState()
  const pending = s.aiPendingEdit
  if (!pending?.harness || !s.currentFilePath) return false

  if (accept) {
    // Merged doc (AI + preserved user edits) is already in the editor;
    // persist it since disk still holds the AI-only version.
    await putFileContent(s.currentFilePath, s.content)
  } else {
    // Reject = remove AI changes, keep user changes.
    // Drop the merged indices recorded as AI-owned at apply time.
    const dropped = new Set(pending.aiChangedIdx || [])
    const current = splitParas(s.content)
    const rejected = current.filter((_, i) => !dropped.has(i)).join('\n\n')
    setEditorContent(rejected)
    await putFileContent(s.currentFilePath, rejected)
  }
  s.editor?.commands.clearAiHighlight()
  s.setAiPendingEdit(null)
  return true
}
