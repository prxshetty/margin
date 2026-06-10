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

                const widget = document.createElement('div')
                widget.style.position = 'absolute'
                widget.style.right = '1rem' // Placed inside the padding so it doesn't get cut off
                widget.style.zIndex = '40'
                widget.className = 'flex flex-row items-center p-1 gap-1 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-[8px] shadow-[0_4px_12px_rgba(0,0,0,0.06)] animate-fade-in select-none'

                widget.innerHTML = `
                  <button class="accept-btn flex items-center justify-center w-6 h-6 rounded-[4px] text-[var(--text-accent)] hover:bg-[var(--bg-hover)] cursor-pointer transition-all active:scale-[0.9]" title="Accept changes (✓)">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5"><path d="M20 6 9 17l-5-5"></path></svg>
                  </button>
                  <div class="w-[1px] h-4 bg-[var(--border-subtle)]"></div>
                  <button class="reject-btn flex items-center justify-center w-6 h-6 rounded-[4px] text-[var(--danger)] hover:bg-[var(--danger-bg)] cursor-pointer transition-all active:scale-[0.9]" title="Reject changes (✕)">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
                  </button>
                `

                // We use dynamic imports to prevent circular dependency issues during plugin eval
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
