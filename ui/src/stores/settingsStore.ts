import { create } from 'zustand'
import { API_BASE } from '../lib/api'
import { toast } from './toastStore'

export interface AppSettings {
  default_mode: string
  default_verbosity: string
  show_thinking_by_default: boolean
  pinned_ref_files: string[]
  ignored_ref_files?: string[]
  endpoints: Record<string, {
    url: string
    api_key: string
    model: string
    context_window?: number
    is_thinking?: boolean
    supports_vision?: boolean
    custom_thinking_tags?: Array<{ open: string; close: string }>
  }>
  default_context_window?: number
  active_endpoint: string | null
  default_harness?: string
  harnesses?: Record<string, { executable?: string; model?: string; context_window?: number }>
  is_thinking?: boolean
  theme?: 'light' | 'dark' | 'system'
  theme_family?: 'sand' | 'notion' | 'sage' | 'blue' | 'rose'
  text_style?: 'system' | 'editorial' | 'manuscript' | 'technical' | 'warm'
  editor_stats?: 'words' | 'characters' | 'both' | 'none'
  planner_include_outline?: boolean
  linked_workspace_dir?: string | null
  workspace_profiles?: { id: string; name: string; path: string }[]
  history_turns?: number
  image_endpoints: Record<string, {
    provider: string
    base_url: string
    api_key: string
    model: string
  }>
  active_image_endpoint: string | null
  image_default_style?: string | null
  image_custom_styles?: { name: string; prompt: string }[]
  /** Built-in style names the user hid (None can never be hidden). */
  image_deleted_styles?: string[]
  image_style_overrides?: Record<string, string>
  image_comfy_text_workflow?: Record<string, { class_type: string; inputs: Record<string, unknown> }> | null
  image_comfy_text_prompt_map?: { nodeId: string; input: string } | null
  image_comfy_text_seed_map?: { nodeId: string; input: string } | null
  image_comfy_edit_workflow?: Record<string, { class_type: string; inputs: Record<string, unknown> }> | null
  image_comfy_edit_prompt_map?: { nodeId: string; input: string } | null
  image_comfy_edit_image_map?: { nodeId: string; input: string } | null
  image_comfy_edit_seed_map?: { nodeId: string; input: string } | null
  /** Reserved for a future reference-image mapping; v1 ignores it. */
  image_comfy_negative_map?: { nodeId: string; input: string } | null
}

interface SettingsState {
  settings: AppSettings | null
  isLoading: boolean
  fetchSettings: () => Promise<void>
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>
  showSettings: boolean
  setShowSettings: (show: boolean) => void
  /** Deep-link target for the Settings modal (e.g. 'endpoints'). Consumed as
      the initial tab on open, then cleared — null means 'general'. */
  settingsTab: SettingsTabId | null
  setSettingsTab: (tab: SettingsTabId | null) => void
}

export type SettingsTabId = 'general' | 'workspaces' | 'appearance' | 'context' | 'endpoints' | 'harnesses' | 'images'

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  isLoading: true,
  showSettings: false,
  setShowSettings: (showSettings) => set({ showSettings }),
  settingsTab: null,
  setSettingsTab: (settingsTab) => set({ settingsTab }),
  fetchSettings: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/settings/`)
      const data = await res.json()
      set({ settings: data, isLoading: false })
    } catch (e) {
      console.error('Failed to load settings', e)
      toast.error('Could not load settings — defaults are in effect.')
      set({ isLoading: false })
    }
  },
  updateSettings: async (updates) => {
    try {
      set((state) => ({ settings: state.settings ? { ...state.settings, ...updates } : null }))
      await fetch(`${API_BASE}/api/settings/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates })
      })
    } catch (e) {
      console.error('Failed to update settings', e)
      toast.error('Could not save that setting — it may revert on reload.')
    }
  }
}))
