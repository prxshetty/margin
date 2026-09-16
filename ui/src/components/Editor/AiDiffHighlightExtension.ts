import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { useEditorStore } from '../../stores/editorStore'
import { resolveHarnessReview } from '../../lib/applyHarnessResult'
import { getBaseBlocks, extractTextBlocks, diffBlockSequences, isBlockEqual } from './ChangeHighlightExtension'

export interface AiDiffHighlightOptions {
  class: string
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    aiDiffHighlight: {
      setAiHighlight: (from: number, to: number, deletedText?: string) => ReturnType
      clearAiHighlight: () => ReturnType
    }
  }
}

export const aiDiffHighlightPluginKey = new PluginKey('aiDiffHighlight')

function createDeletedSpan(text: string): HTMLElement {
  const span = document.createElement('span')
  span.className = 'diff-deletion'
  span.textContent = text
  span.style.pointerEvents = 'none'
  span.style.userSelect = 'none'
  return span
}

function createDeletedBlock(text: string): HTMLElement {
  const div = document.createElement('div')
  div.className = 'diff-deletion-block'
  div.textContent = text
  div.style.pointerEvents = 'none'
  div.style.userSelect = 'none'
  return div
}

function buildAiDecorations(
  doc: any,
  aiPendingEdit: {
    originalSelectedText?: string
    highlightFrom?: number
    selectionRange?: { from: number; to: number } | null
    replacementText?: string
    previousContent?: string
    harness?: string
  }
): DecorationSet {
  const decorations: Decoration[] = []
  const { originalSelectedText, highlightFrom, selectionRange, replacementText, previousContent, harness } = aiPendingEdit

  const createWidget = () => {
    const widget = document.createElement('div')
    widget.style.display = 'flex'
    widget.style.flexDirection = 'row'
    widget.style.alignItems = 'center'
    widget.style.gap = '2px'
    widget.style.padding = '2px'
    widget.style.marginBottom = '4px'
    widget.style.width = 'fit-content'
    widget.style.marginLeft = 'auto'
    widget.className =
      'bg-[var(--bg-elevated)] border border-[var(--border)] rounded-[8px] shadow-[0_4px_12px_rgba(0,0,0,0.06)] select-none animate-fade-in'

    widget.innerHTML = `
      <button class="accept-btn flex items-center justify-center w-6 h-6 rounded-[4px] text-[var(--text-accent)] hover:bg-[var(--bg-hover)] cursor-pointer transition-all active:scale-[0.9]" title="Accept changes (✓)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5"><path d="M20 6 9 17l-5-5"></path></svg>
      </button>
      <div class="w-[1px] h-4 bg-[var(--border-subtle)]"></div>
      <button class="reject-btn flex items-center justify-center w-6 h-6 rounded-[4px] text-[var(--danger)] hover:bg-[var(--danger-bg)] cursor-pointer transition-all active:scale-[0.9]" title="Reject changes (✕)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
      </button>
    `

    widget.querySelector('.accept-btn')?.addEventListener('click', (e) => {
      e.preventDefault()
      const state = useEditorStore.getState()
      if (state.aiPendingEdit?.harness) {
        resolveHarnessReview(true).catch((err) =>
          console.error('Failed to accept harness changes:', err)
        )
        return
      }
      state.editor?.commands.clearAiHighlight()
      state.setAiPendingEdit(null)
    })

    widget.querySelector('.reject-btn')?.addEventListener('click', (e) => {
      e.preventDefault()
      const state = useEditorStore.getState()
      if (state.aiPendingEdit?.harness) {
        resolveHarnessReview(false).catch((err) =>
          console.error('Failed to reject harness changes:', err)
        )
        return
      }
      const previous = state.aiPendingEdit?.previousContent
      state.editor?.commands.clearAiHighlight()
      if (previous !== undefined) {
        state.editor?.commands.setContent(previous)
        state.setContent(previous)
        if (state.currentFilePath) {
          state.updateFileContent(state.currentFilePath, previous)
        }
      }
      state.setAiPendingEdit(null)
    })

    return widget
  }

  // 1. Harness document-level diff review
  if (harness && previousContent !== undefined) {
    const editor = useEditorStore.getState().editor
    const currBlocks = extractTextBlocks(doc)
    const baseBlocks = getBaseBlocks(editor, previousContent)
    const ops = diffBlockSequences(baseBlocks, currBlocks.map((b) => b.text))

    let firstChangePos = 0
    let hasChanges = false

    for (const op of ops) {
      if (op.tag === 'equal') continue

      if (op.tag === 'insert') {
        for (let j = op.j1; j < op.j2; j++) {
          const block = currBlocks[j]
          if (block && block.nodeSize > 2) {
            hasChanges = true
            if (block.pos < firstChangePos || firstChangePos === 0) firstChangePos = block.pos
            decorations.push(
              Decoration.inline(block.pos + 1, block.pos + block.nodeSize - 1, { class: 'diff-addition' })
            )
          }
        }
      } else if (op.tag === 'delete') {
        const delText = baseBlocks.slice(op.i1, op.i2).join('\n\n')
        const pos = currBlocks[op.j1]?.pos ?? doc.content.size
        hasChanges = true
        if (pos < firstChangePos || firstChangePos === 0) firstChangePos = pos
        decorations.push(Decoration.widget(pos, () => createDeletedBlock(delText), { side: -1 }))
      } else if (op.tag === 'replace') {
        const delText = baseBlocks.slice(op.i1, op.i2).join('\n\n')
        const insText = currBlocks.slice(op.j1, op.j2).map((b) => b.text).join('\n\n')
        if (isBlockEqual(delText, insText)) {
          continue
        }
        const firstBlock = currBlocks[op.j1]
        if (firstBlock) {
          hasChanges = true
          if (firstBlock.pos < firstChangePos || firstChangePos === 0) firstChangePos = firstBlock.pos
          decorations.push(Decoration.widget(firstBlock.pos, () => createDeletedBlock(delText), { side: -1 }))
          for (let j = op.j1; j < op.j2; j++) {
            const block = currBlocks[j]
            if (block && block.nodeSize > 2) {
              decorations.push(
                Decoration.inline(block.pos + 1, block.pos + block.nodeSize - 1, { class: 'diff-addition' })
              )
            }
          }
        }
      }
    }

    if (hasChanges) {
      decorations.push(Decoration.widget(firstChangePos, createWidget, { side: -1 }))
    }
    return DecorationSet.create(doc, decorations)
  }

  // 2. Localized endpoint edit review
  const from = highlightFrom ?? selectionRange?.from ?? 0
  const to = selectionRange?.to ?? (from + (replacementText?.length ?? 0))
  const safeFrom = Math.max(0, Math.min(from, doc.content.size))
  const safeTo = Math.max(safeFrom, Math.min(to, doc.content.size))

  if (originalSelectedText && originalSelectedText.trim().length > 0) {
    if (originalSelectedText.includes('\n')) {
      decorations.push(
        Decoration.widget(safeFrom, () => createDeletedBlock(originalSelectedText), { side: -1 })
      )
    } else {
      decorations.push(
        Decoration.widget(safeFrom, () => createDeletedSpan(originalSelectedText), { side: -1 })
      )
    }
  }

  if (safeTo > safeFrom) {
    // Underline the newly added / replacement text cleanly within textblock bounds
    doc.nodesBetween(safeFrom, safeTo, (node: any, pos: number) => {
      if (node.isTextblock && node.nodeSize > 2) {
        const start = Math.max(safeFrom, pos + 1)
        const end = Math.min(safeTo, pos + node.nodeSize - 1)
        if (end > start) {
          decorations.push(Decoration.inline(start, end, { class: 'diff-addition' }))
        }
      }
    })
  }

  decorations.push(Decoration.widget(safeFrom, createWidget, { side: -1 }))
  return DecorationSet.create(doc, decorations)
}

export const AiDiffHighlightExtension = Extension.create<AiDiffHighlightOptions>({
  name: 'aiDiffHighlight',

  addOptions() {
    return {
      class: 'ai-diff-block',
    }
  },

  addCommands() {
    return {
      setAiHighlight: (from, to, deletedText) => ({ tr, dispatch }) => {
        if (dispatch) {
          tr.setMeta(aiDiffHighlightPluginKey, { action: 'set', from, to, deletedText })
        }
        return true
      },
      clearAiHighlight: () => ({ tr, dispatch }) => {
        if (dispatch) {
          tr.setMeta(aiDiffHighlightPluginKey, { action: 'clear' })
        }
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: aiDiffHighlightPluginKey,
        state: {
          init(_, instance) {
            const aiPendingEdit = useEditorStore.getState().aiPendingEdit
            if (aiPendingEdit) {
              return buildAiDecorations(instance.doc, aiPendingEdit)
            }
            return DecorationSet.empty
          },
          apply: (tr, oldState) => {
            const meta = tr.getMeta(aiDiffHighlightPluginKey)
            if (meta?.action === 'clear') {
              return DecorationSet.empty
            }

            const aiPendingEdit = useEditorStore.getState().aiPendingEdit

            if (meta?.action === 'set') {
              const { from, to, deletedText } = meta
              return buildAiDecorations(tr.doc, {
                originalSelectedText: deletedText ?? aiPendingEdit?.originalSelectedText,
                highlightFrom: from,
                selectionRange: { from, to },
                replacementText: aiPendingEdit?.replacementText,
              })
            }

            if (aiPendingEdit) {
              if (oldState === DecorationSet.empty || tr.docChanged || meta?.action === 'refresh') {
                return buildAiDecorations(tr.doc, aiPendingEdit)
              }
              return oldState.map(tr.mapping, tr.doc)
            }

            return DecorationSet.empty
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)
          },
        },
      }),
    ]
  },
})

