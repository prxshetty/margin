import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface ActiveSelectionOptions {
  class: string
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    activeSelection: {
      setPromptSelectionHighlight: (from: number, to: number) => ReturnType
      clearPromptSelectionHighlight: () => ReturnType
    }
  }
}

export const activeSelectionPluginKey = new PluginKey('activeSelection')

export const ActiveSelectionExtension = Extension.create<ActiveSelectionOptions>({
  name: 'activeSelection',

  addOptions() {
    return {
      class: 'editor-active-selection',
    }
  },

  addCommands() {
    return {
      setPromptSelectionHighlight: (from: number, to: number) => ({ tr, dispatch }) => {
        if (dispatch) {
          tr.setMeta(activeSelectionPluginKey, { action: 'set', from, to })
        }
        return true
      },
      clearPromptSelectionHighlight: () => ({ tr, dispatch }) => {
        if (dispatch) {
          tr.setMeta(activeSelectionPluginKey, { action: 'clear' })
        }
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: activeSelectionPluginKey,
        state: {
          init() {
            return DecorationSet.empty
          },
          apply: (tr, oldState) => {
            let newState = oldState.map(tr.mapping, tr.doc)
            const meta = tr.getMeta(activeSelectionPluginKey)

            if (meta) {
              if (meta.action === 'clear') {
                return DecorationSet.empty
              }
              if (meta.action === 'set') {
                const { from, to } = meta
                if (from >= to || from < 0 || to > tr.doc.content.size) {
                  return DecorationSet.empty
                }
                const decoration = Decoration.inline(from, to, {
                  class: this.options.class,
                })
                return DecorationSet.create(tr.doc, [decoration])
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
