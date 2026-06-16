import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface AiDiffHighlightOptions {
  class: string
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    aiDiffHighlight: {
      setAiHighlight: (from: number, to: number) => ReturnType
      clearAiHighlight: () => ReturnType
    }
  }
}

export const aiDiffHighlightPluginKey = new PluginKey('aiDiffHighlight')

export const AiDiffHighlightExtension = Extension.create<AiDiffHighlightOptions>({
  name: 'aiDiffHighlight',

  addOptions() {
    return {
      class: 'ai-diff-block',
    }
  },

  addCommands() {
    return {
      setAiHighlight: (from, to) => ({ tr, dispatch }) => {
        if (dispatch) {
          tr.setMeta(aiDiffHighlightPluginKey, { action: 'set', from, to })
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
          init() {
            return DecorationSet.empty
          },
          apply: (tr, oldState) => {
            let newState = oldState.map(tr.mapping, tr.doc)
            const meta = tr.getMeta(aiDiffHighlightPluginKey)

            if (meta) {
              if (meta.action === 'clear') {
                return DecorationSet.empty
              }
              if (meta.action === 'set') {
                const { from, to } = meta
                const decorations: Decoration[] = []

                tr.doc.nodesBetween(from, to, (node, pos) => {
                  if (node.isBlock && node.type.name !== 'doc') {
                    decorations.push(Decoration.node(pos, pos + node.nodeSize, {
                      class: this.options.class
                    }))
                    // Return false so we don't decorate children of this block,
                    // keeping the highlight at the top-level block within the range.
                    return false
                  }
                  return true
                })

                // Inline widget — sits in normal document flow before the first
                // highlighted block. Do NOT use position:absolute — ProseMirror
                // would resolve it against the whole editor container, not the
                // paragraph, causing the widget to float to the editor's top-right.
                const widget = document.createElement('div')
                widget.style.display = 'flex'
                widget.style.flexDirection = 'row'
                widget.style.alignItems = 'center'
                widget.style.gap = '2px'
                widget.style.padding = '2px'
                widget.style.marginBottom = '4px'
                widget.style.width = 'fit-content'
                widget.style.marginLeft = 'auto'
                widget.className = 'bg-[var(--bg-elevated)] border border-[var(--border)] rounded-[8px] shadow-[0_4px_12px_rgba(0,0,0,0.06)] select-none animate-fade-in'

                widget.innerHTML = `
                  <button class="accept-btn flex items-center justify-center w-6 h-6 rounded-[4px] text-[var(--text-accent)] hover:bg-[var(--bg-hover)] cursor-pointer transition-all active:scale-[0.9]" title="Accept changes (✓)">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5"><path d="M20 6 9 17l-5-5"></path></svg>
                  </button>
                  <div class="w-[1px] h-4 bg-[var(--border-subtle)]"></div>
                  <button class="reject-btn flex items-center justify-center w-6 h-6 rounded-[4px] text-[var(--danger)] hover:bg-[var(--danger-bg)] cursor-pointer transition-all active:scale-[0.9]" title="Reject changes (✕)">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
                  </button>
                `

                // Dynamic import avoids circular dependency issues during plugin eval
                import('../../stores/editorStore').then(({ useEditorStore }) => {
                  widget.querySelector('.accept-btn')?.addEventListener('click', (e) => {
                    e.preventDefault()
                    const state = useEditorStore.getState()
                    state.editor?.commands.clearAiHighlight()
                    state.setAiPendingEdit(null)
                  })

                  widget.querySelector('.reject-btn')?.addEventListener('click', (e) => {
                    e.preventDefault()
                    const state = useEditorStore.getState()
                    const previous = state.aiPendingEdit?.previousContent
                    if (previous) {
                      state.editor?.commands.clearAiHighlight()
                      state.editor?.commands.setContent(previous)
                      state.setContent(previous)
                      if (state.currentFilePath) {
                        state.updateFileContent(state.currentFilePath, previous)
                      }
                    }
                    state.setAiPendingEdit(null)
                  })
                })

                // side: -1 inserts the widget BEFORE the character at `from`,
                // placing it above the first highlighted block in the text flow
                decorations.push(Decoration.widget(from, widget, { side: -1 }))

                return DecorationSet.create(tr.doc, decorations)
              }
            }

            return newState
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
