import { Check } from 'lucide-react'
import type { AppSettings } from '../../stores/settingsStore'
import { Dropdown } from '../Dropdown'
import { FilterSection, SectionCard, SectionLabel, Row } from './shared'
type ThemeFamily = NonNullable<AppSettings['theme_family']>

type ThemeMode = NonNullable<AppSettings['theme']>

type TextStyle = NonNullable<AppSettings['text_style']>

type EditorStats = NonNullable<AppSettings['editor_stats']>

const themeFamilies: { id: ThemeFamily; name: string; description: string; swatches: string[] }[] = [
  {
    id: 'sand',
    name: 'Sand',
    description: 'Warm paper, soft tan, familiar and quiet.',
    swatches: ['#FFFFFF', '#F3EFEA', '#734F2D', '#346538']
  },
  {
    id: 'notion',
    name: 'Notion Mono',
    description: 'Crisp grayscale with a restrained ink accent.',
    swatches: ['#FFFFFF', '#F7F7F5', '#2F3437', '#2563EB']
  },
  {
    id: 'sage',
    name: 'Sage Desk',
    description: 'Gentle green-gray for long writing sessions.',
    swatches: ['#FBFCF8', '#EEF4EA', '#506C4A', '#2F6F59']
  },
  {
    id: 'blue',
    name: 'Blue Note',
    description: 'Pale steel, navy ink, calm focus-mode energy.',
    swatches: ['#FAFCFF', '#EEF4FA', '#243B53', '#2F6F9F']
  },
  {
    id: 'rose',
    name: 'Rose Glass',
    description: 'Soft blush surfaces with a mature plum accent.',
    swatches: ['#FFF9FA', '#F7ECEF', '#6E3B4D', '#8F4E68']
  }
]

const themeModes: { id: ThemeMode; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' }
]

const textStyles: { id: TextStyle; name: string; description: string; sample: string }[] = [
  {
    id: 'system',
    name: 'System',
    description: 'Neutral app-native text for everyday drafting.',
    sample: 'Clean notes'
  },
  {
    id: 'editorial',
    name: 'Editorial',
    description: 'Serif document text with a magazine-like rhythm.',
    sample: 'Longform draft'
  },
  {
    id: 'manuscript',
    name: 'Manuscript',
    description: 'Roomier serif text for chapter work and revision.',
    sample: 'Chapter page'
  },
  {
    id: 'technical',
    name: 'Technical',
    description: 'Sharper spacing and monospace-friendly code blocks.',
    sample: 'Spec notes'
  },
  {
    id: 'warm',
    name: 'Warm Sans',
    description: 'Softer humanist sans text without getting decorative.',
    sample: 'Soft focus'
  }
]

export function AppearanceSettings({ settings, updateSettings, query }: { settings: AppSettings, updateSettings: (u: Partial<AppSettings>) => void, query: string }) {
  const selectedFamily = settings.theme_family || 'sand'
  const selectedMode = settings.theme || 'light'
  const selectedTextStyle = settings.text_style || 'system'
  const selectedStats = settings.editor_stats || 'both'

  const modePreview: Record<ThemeMode, { bg: string; bar: string; dot: string }> = {
    light: { bg: '#FFFFFF', bar: '#E7E2DA', dot: '#734F2D' },
    dark: { bg: '#1C1917', bar: '#44403C', dot: '#D6CDBF' },
    system: { bg: 'linear-gradient(to right, #FFFFFF 50%, #1C1917 50%)', bar: '#A8A29E', dot: '#734F2D' },
  }

  return (
    <div className="flex flex-col gap-6">
      <FilterSection query={query} keywords="mode light dark system color appearance theme">
        <section>
          <SectionLabel description="Choose the interface color mode.">Color mode</SectionLabel>
          <SectionCard>
            <div className="p-4">
              <div className="grid grid-cols-3 gap-3">
              {themeModes.map(({ id, label }) => {
                const active = selectedMode === id
                const preview = modePreview[id]
                return (
                  <button
                    key={id}
                    onClick={() => updateSettings({ theme: id })}
                    className="flex flex-col items-center gap-1.5 cursor-pointer group"
                  >
                    <span
                      className={`w-full h-20 rounded-[10px] border transition-colors relative overflow-hidden ${active ? 'border-[var(--accent-brown)]' : 'border-[var(--border-subtle)] group-hover:border-[var(--text-secondary)]'}`}
                      style={{ background: preview.bg }}
                    >
                      <span className="absolute left-2.5 right-2.5 top-2.5 h-1.5 rounded-full" style={{ background: preview.bar }} />
                      <span className="absolute left-2.5 right-2.5 top-6 h-1.5 rounded-full w-2/3" style={{ background: preview.bar }} />
                      <span className="absolute right-2.5 bottom-2.5 w-3 h-3 rounded-full" style={{ background: preview.dot }} />
                    </span>
                    <span className={`flex items-center gap-1 text-[12px] ${active ? 'text-[var(--text-heading)] font-medium' : 'text-[var(--text-secondary)]'}`}>
                      {active && <Check size={12} className="text-[var(--accent-brown)]" />}
                      {label}
                    </span>
                  </button>
                )
              })}
              </div>
            </div>
          </SectionCard>
        </section>
      </FilterSection>

      <FilterSection query={query} keywords="theme palette color sand notion sage blue rose">
        <section>
          <SectionLabel description="Select a color palette for your workspace.">Palette</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            {themeFamilies.map((themeFamily) => {
              const active = selectedFamily === themeFamily.id
              return (
                <button
                  key={themeFamily.id}
                  onClick={() => updateSettings({ theme_family: themeFamily.id })}
                  className={`relative text-left rounded-[12px] border p-3 transition-colors cursor-pointer flex flex-col justify-between h-full ${active
                    ? 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40'
                    : 'border-[var(--border-subtle)] hover:border-[var(--text-secondary)]'
                    }`}
                >
                  {active && (
                    <span className="absolute top-2.5 right-2.5 text-[var(--accent-brown)]"><Check size={14} /></span>
                  )}
                  <div className="pr-6">
                    <span className="text-[13px] font-medium text-[var(--text-heading)]">{themeFamily.name}</span>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-secondary)] min-h-[32px]">{themeFamily.description}</div>
                  </div>
                  <div className="mt-2.5 flex gap-1.5 w-full">
                    {themeFamily.swatches.map((swatch) => (
                      <span
                        key={swatch}
                        className="h-4 flex-1 rounded-[3px] border border-black/10"
                        style={{ backgroundColor: swatch }}
                      />
                    ))}
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      </FilterSection>

      <FilterSection query={query} keywords="text font typography serif sans style">
        <section>
          <SectionLabel description="Change the typography and spacing of the writing surface.">Text style</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            {textStyles.map(({ id, name, description }) => {
              const active = selectedTextStyle === id
              return (
                <button
                  key={id}
                  onClick={() => updateSettings({ text_style: id })}
                  className={`relative text-left rounded-[12px] border p-3 transition-colors cursor-pointer ${active
                    ? 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40'
                    : 'border-[var(--border-subtle)] hover:border-[var(--text-secondary)]'
                    }`}
                >
                  {active && (
                    <span className="absolute top-2.5 right-2.5 text-[var(--accent-brown)]"><Check size={14} /></span>
                  )}
                  <div className={`min-w-0 pr-6 theme-font-preview-${id}`}>
                    <span className="text-[13px] font-medium text-[var(--text-heading)]">{name}</span>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-secondary)] min-h-[32px]">{description}</div>
                  </div>
                  <span className={`block mt-1 text-[22px] leading-none text-[var(--text-heading)] opacity-70 theme-font-preview-${id}`}>
                    Aa
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      </FilterSection>

      <FilterSection query={query} keywords="stats word character count editor">
        <section>
          <SectionLabel description="Display word and/or character counts in the editor.">Editor</SectionLabel>
          <SectionCard>
            <Row
              label="Editor statistics"
              control={
                <Dropdown
                  value={selectedStats}
                  onChange={(v) => updateSettings({ editor_stats: v as EditorStats })}
                  options={[
                    { value: 'both', label: 'Words & Characters' },
                    { value: 'words', label: 'Words Only' },
                    { value: 'characters', label: 'Characters Only' },
                    { value: 'none', label: 'None' },
                  ]}
                  rootClassName="w-[190px]"
                />
              }
            />
          </SectionCard>
        </section>
      </FilterSection>
    </div>
  )
}
