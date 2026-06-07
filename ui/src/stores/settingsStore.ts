import { create } from 'zustand'
import { API_BASE } from '../lib/api'

export interface AppSettings {
  additional_context: string
  tone_preset: string
  default_mode: string
  default_verbosity: string
  show_thinking_by_default: boolean
  pinned_ref_files: string[]
  endpoints: Record<string, { url: string; api_key: string; model: string }>
  active_endpoint: string | null
  theme?: 'light' | 'dark' | 'system'
  theme_family?: 'sand' | 'notion' | 'sage' | 'blue' | 'rose'
  text_style?: 'system' | 'editorial' | 'manuscript' | 'technical' | 'warm'
}

interface SettingsState {
  settings: AppSettings | null
  isLoading: boolean
  fetchSettings: () => Promise<void>
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>
  showSettings: boolean
  setShowSettings: (show: boolean) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  isLoading: true,
  showSettings: false,
  setShowSettings: (showSettings) => set({ showSettings }),
  fetchSettings: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/settings/`)
      const data = await res.json()
      set({ settings: data, isLoading: false })
    } catch (e) {
      console.error('Failed to load settings', e)
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
    }
  }
}))
