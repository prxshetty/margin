import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { ChevronDown, Check, TextIcon, Heading1, Heading2, Heading3, ChevronsUpDown } from 'lucide-react'
import { useEditorStore } from '../../stores/editorStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { toast } from '../../stores/toastStore'
import { API_BASE } from '../../lib/api'
import { streamSSE } from '../../lib/stream-sse'
import { applyHarnessResult } from '../../lib/applyHarnessResult'
import { generateImage, insertStoredImageAt } from '../../lib/media'
import { imageStyleOptions } from './ImageGenerateDialog'
import { CueIcon, RewriteIcon, ImagineIcon, LinkIcon } from '../icons/BrandIcons'

// ─── Node selector (paragraph / heading) ─────────────────────────────────────
const NODE_ITEMS = [
    {
        name: 'Text',
        icon: TextIcon,
        command: (editor: Editor) =>
            editor.chain().focus().toggleNode('paragraph', 'paragraph').run(),
        isActive: (editor: Editor) =>
            editor.isActive('paragraph') &&
            !editor.isActive('bulletList') &&
            !editor.isActive('orderedList'),
    },
    {
        name: 'Heading 1',
        icon: Heading1,
        command: (editor: Editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
        isActive: (editor: Editor) => editor.isActive('heading', { level: 1 }),
    },
    {
        name: 'Heading 2',
        icon: Heading2,
        command: (editor: Editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        isActive: (editor: Editor) => editor.isActive('heading', { level: 2 }),
    },
    {
        name: 'Heading 3',
        icon: Heading3,
        command: (editor: Editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
        isActive: (editor: Editor) => editor.isActive('heading', { level: 3 }),
    },
]

function NodeSelector({ editor }: { editor: Editor }) {
    const [open, setOpen] = useState(false)
    const wrapperRef = useRef<HTMLDivElement>(null)

    const activeItem =
        NODE_ITEMS.filter((item) => item.isActive(editor)).pop() ?? { name: 'Text' }

    // Close on click-outside (but only outside our own wrapper)
    useEffect(() => {
        if (!open) return
        const handler = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [open])

    return (
        <div ref={wrapperRef} className="relative">
            {/* Trigger — prevent default so the editor selection isn't dropped */}
            <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setOpen((v) => !v)}
                className="flex items-center h-6 gap-1 px-2 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] rounded-[5px] transition-colors cursor-pointer"
            >
                <span className="whitespace-nowrap">{activeItem.name}</span>
                <ChevronDown className={`w-3 h-3 opacity-60 transition-transform duration-100 ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
                <div className="absolute top-full left-0 mt-1 w-36 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[8px] shadow-lg z-[10000] p-1">
                    {NODE_ITEMS.map((item) => (
                        <button
                            key={item.name}
                            // preventDefault keeps the editor selection alive while we act
                            onMouseDown={(e) => {
                                e.preventDefault()
                                item.command(editor)
                                setOpen(false)
                            }}
                            className="flex items-center justify-between w-full px-2 py-1.5 text-[11.5px] text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] rounded-[5px] cursor-pointer transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <item.icon className="w-3.5 h-3.5" />
                                <span>{item.name}</span>
                            </div>
                            {item.isActive(editor) && <Check className="w-3 h-3 text-[var(--accent-brown)]" />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

// ─── Formatting buttons ───────────────────────────────────────────────────────
// Full primary row: bold / italic / underline / strikethrough / code.
const FORMAT_ITEMS = [
    {
        name: 'bold',
        label: 'B',
        command: (e: Editor) => e.chain().focus().toggleBold().run(),
        isActive: (e: Editor) => e.isActive('bold'),
        className: 'font-bold',
        title: 'Bold',
    },
    {
        name: 'italic',
        label: 'I',
        command: (e: Editor) => e.chain().focus().toggleItalic().run(),
        isActive: (e: Editor) => e.isActive('italic'),
        className: 'italic',
        title: 'Italic',
    },
    {
        name: 'underline',
        label: 'U',
        command: (e: Editor) => e.chain().focus().toggleUnderline().run(),
        isActive: (e: Editor) => e.isActive('underline'),
        className: 'underline underline-offset-2',
        title: 'Underline',
    },
    {
        name: 'strike',
        label: 'S',
        command: (e: Editor) => e.chain().focus().toggleStrike().run(),
        isActive: (e: Editor) => e.isActive('strike'),
        className: 'line-through',
        title: 'Strikethrough',
    },
    {
        name: 'code',
        label: '<>',
        command: (e: Editor) => e.chain().focus().toggleCode().run(),
        isActive: (e: Editor) => e.isActive('code'),
        className: 'font-mono text-[10.5px]',
        title: 'Inline code',
    },
]

function FormatButtons({ editor }: { editor: Editor }) {
    return (
        <div className="flex items-center gap-0.5">
            {FORMAT_ITEMS.map((item) => (
                <button
                    key={item.name}
                    title={item.title}
                    onMouseDown={(e) => { e.preventDefault(); item.command(editor) }}
                    className={`flex items-center justify-center h-6 px-2 text-[11.5px] rounded-[5px] cursor-pointer transition-colors ${item.isActive(editor)
                        ? 'text-[var(--accent-brown)] bg-[var(--bg-hover)]'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)]'
                        } ${item.className}`}
                >
                    {item.label}
                </button>
            ))}
        </div>
    )
}

// ─── Shared surfaces ──────────────────────────────────────────────────────────
// Both bubbles (formatting + AI) use identical chrome so they read as one
// system separated by space, not as buttons inside a single bar.
// Expanded morphs stack vertically — prompt on top, quiet footer below —
// instead of cramming everything into one row.
const SURFACE_CLASS = `
    bg-[var(--bg-elevated)] border border-[var(--border-subtle)]
    rounded-[8px] shadow-[0_2px_8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)]
`
const PILL_CLASS = `flex items-center gap-0.5 px-1 py-1 ${SURFACE_CLASS}`
// All pills share the same 4px outer padding on every side, so the right
// edge sits exactly as tight as top/bottom. (The AI pill's wide icon+label
// buttons would otherwise read visibly inset.)
const AI_PILL_CLASS = PILL_CLASS
const EXPANDED_CLASS = `flex flex-col items-stretch gap-1.5 w-[320px] p-2 ${SURFACE_CLASS}`
const FIELD_TEXT_CLASS = `
    bg-transparent text-[11.5px] leading-relaxed text-[var(--text-heading)]
    placeholder:text-[var(--text-muted)] outline-none px-1 min-w-0 disabled:opacity-60
`

// ─── Morph micro-controls ─────────────────────────────────────────────────────
function ExpandToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
    return (
        <button
            onMouseDown={(e) => { e.preventDefault(); onToggle() }}
            title={expanded ? 'Single line' : 'Expand'}
            className="flex items-center justify-center w-6 h-6 text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] rounded-[5px] transition-colors cursor-pointer shrink-0"
        >
            <ChevronsUpDown className="w-3.5 h-3.5" />
        </button>
    )
}

// Filled submit — SimpleAssist's send treatment (solid accent idle, muted
// disabled) in the bubble's 5px inner radius so it sits flush with its
// square siblings. (Also serves link apply.)
function SendArrow({ title, disabled, dimmed, onSend }: {
    title: string
    disabled?: boolean
    dimmed?: boolean
    onSend: () => void
}) {
    return (
        <button
            onMouseDown={(e) => { e.preventDefault(); onSend() }}
            disabled={disabled}
            title={title}
            className="flex items-center justify-center w-6 h-6 rounded-[5px] border border-transparent cursor-pointer select-none shrink-0 transition-[background-color,transform,opacity] duration-150 active:scale-[0.9] bg-[var(--accent-brown)] hover:bg-[var(--accent-brown-hover)] text-[var(--text-inverse)] disabled:bg-[var(--bg-disabled)] disabled:text-[var(--text-disabled)] disabled:border-transparent"
        >
            <svg xmlns="http://www.w3.org/2000/svg" className={`w-3.5 h-3.5 ${dimmed ? 'opacity-30' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
            </svg>
        </button>
    )
}

function StylePill({ value, onChange, disabled, options }: {
    value: string
    onChange: (v: string) => void
    disabled?: boolean
    options: string[]
}) {
    // appearance-none hides the native arrow (which sizes to the longest
    // option and leaves a dead gap after short names) — the pinned chevron
    // keeps a tight, consistent text→chevron spacing instead.
    return (
        <span className="relative flex items-center shrink-0">
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                title="Style"
                aria-label="Image style"
                onMouseDown={(e) => e.stopPropagation()}
                className="h-6 shrink-0 max-w-[120px] truncate pl-1.5 pr-5 py-0 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-heading)] bg-transparent hover:bg-[var(--bg-hover)] rounded-[5px] outline-none cursor-pointer disabled:opacity-60 appearance-none"
            >
                {options.map((n) => (
                    <option key={n} value={n}>{n}</option>
                ))}
            </select>
            <ChevronDown className="absolute right-1 w-3 h-3 opacity-60 pointer-events-none" />
        </span>
    )
}

// ─── Bubble positioning ───────────────────────────────────────────────────────
// Horizontal, centered on the selection. shift/flip clamp it inside the
// editor/card bounds (edge/first-line selections) without hard-aligning to
// the paragraph margin. Stable reference so the plugin isn't reconfigured
// on every render.
const BUBBLE_OPTIONS = {
    placement: 'top',
    offset: 8,
    flip: { padding: 16 },
    shift: { padding: 16, crossAxis: true },
    inline: {},
} as const

// ─── Main bubble ──────────────────────────────────────────────────────────────
// Editor-first, two conceptual groups:
//   Formatting: Paragraph ▾  B  I  U  S  code  link
//   AI:         Cue  Rewrite  Imagine
export function WritingBubbleMenu() {
    const { editor, selectedText, selectionRange, setPendingEditSelection, content } =
        useEditorStore()
    const harness = useSettingsStore((s) => s.settings?.default_harness) || 'none'

    const [mode, setMode] = useState<'default' | 'rewrite' | 'link' | 'imagine'>('default')
    // Which AI entry opened the input — drives the expressive morph origin
    // (Rewrite sits mid-pill, Imagine rightmost) so the input feels like it
    // grows out of the clicked button.
    const [origin, setOrigin] = useState<'rewrite' | 'imagine' | 'link' | null>(null)
    // Morph plays on mode switches ONLY, never on show/hide. TipTap detaches
    // the menu element on hide and re-attaches on show, which restarts CSS
    // animations — leaving the class on would fade the bubble in on every
    // selection. So the class is applied when mode changes and cleared when
    // the animation ends; showing stays instant.
    const [morphAnim, setMorphAnim] = useState('')
    const isFirstMode = useRef(true)
    // Layout effect so the class lands before paint — no one-frame flash of
    // the un-animated input.
    useLayoutEffect(() => {
        if (isFirstMode.current) { isFirstMode.current = false; return }
        setMorphAnim(
            `bubble-morph-in ${origin === 'imagine'
                ? 'bubble-morph-origin-imagine'
                : origin === 'rewrite'
                    ? 'bubble-morph-origin-rewrite'
                    : origin === 'link'
                        ? 'bubble-morph-origin-link'
                        : ''
            }`,
        )
    }, [mode, origin])
    const [instruction, setInstruction] = useState('')
    const [linkUrl, setLinkUrl] = useState('')
    const [isStreaming, setIsStreaming] = useState(false)
    // Imagine morph state — inline bar, no dialog. Anchor is captured at
    // open so the image lands where the selection was even if it moves.
    const [imaginePrompt, setImaginePrompt] = useState('')
    const [imagineStyle, setImagineStyle] = useState('None')
    const [imagineBusy, setImagineBusy] = useState(false)
    const [imagineAnchor, setImagineAnchor] = useState<number | null>(null)
    // Expanded morphs a single-line input into a 3-row vertical view.
    const [expanded, setExpanded] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)
    const areaRef = useRef<HTMLTextAreaElement>(null)
    const imageCustomStyles = useSettingsStore((s) => s.settings?.image_custom_styles)
    const imageDeletedStyles = useSettingsStore((s) => s.settings?.image_deleted_styles)
    const imageDefaultStyle = useSettingsStore((s) => s.settings?.image_default_style)
    const imagineOptions = useMemo(
        () => imageStyleOptions(imageCustomStyles, imageDeletedStyles),
        [imageCustomStyles, imageDeletedStyles],
    )
    // Range the rewrite/link input was opened for. The bubble never unmounts
    // (TipTap only hides it), so without this a dismissed session
    // would still be showing on the next selection.
    const sessionRangeRef = useRef<{ from: number; to: number } | null>(null)

    // ── Cue (hand the selection to the AI as a cue) ─────────────────────────
    const handleCue = useCallback(() => {
        if (!selectionRange || !selectedText) return
        setPendingEditSelection({
            text: selectedText,
            from: selectionRange.from,
            to: selectionRange.to,
        })
        editor?.commands.setTextSelection(selectionRange.from)
    }, [selectionRange, selectedText, setPendingEditSelection, editor])

    // ── Enter rewrite mode ────────────────────────────────────────────────────
    const handleRewriteClick = useCallback(() => {
        setMode('rewrite')
        setOrigin('rewrite')
        setInstruction('')
        setExpanded(false)
        sessionRangeRef.current = selectionRange ? { ...selectionRange } : null
        setTimeout(() => inputRef.current?.focus(), 30)
    }, [selectionRange])

    // ── Enter link mode ───────────────────────────────────────────────────────
    const handleLinkClick = useCallback(() => {
        if (!editor) return
        const prev = editor.getAttributes('link').href as string | undefined
        setMode('link')
        setOrigin('link')
        setLinkUrl(prev ?? '')
        sessionRangeRef.current = selectionRange ? { ...selectionRange } : null
        setTimeout(() => inputRef.current?.focus(), 30)
    }, [editor, selectionRange])

    // ── Enter imagine mode (inline morph, replaces the dialog) ─────────────
    // Selection becomes the starting prompt — never deleted. Submit
    // generates and inserts after the captured anchor via insertStoredImageAt.
    const handleImagineClick = useCallback(() => {
        if (!selectedText || !selectionRange) return
        const def = imageDefaultStyle ?? 'None'
        setImaginePrompt(selectedText.slice(0, 2000))
        setImagineStyle(
            imagineOptions.find((o) => o.toLowerCase() === String(def).toLowerCase()) ?? 'None',
        )
        setImagineAnchor(selectionRange.to)
        setExpanded(false)
        setMode('imagine')
        setOrigin('imagine')
        sessionRangeRef.current = { ...selectionRange }
        setTimeout(() => inputRef.current?.focus(), 30)
    }, [selectedText, selectionRange, imagineOptions, imageDefaultStyle])

    // ── Cancel input mode ─────────────────────────────────────────────────────
    const handleCancel = useCallback(() => {
        setMode('default')
        setOrigin(null)
        setInstruction('')
        setLinkUrl('')
        setImaginePrompt('')
        setImagineAnchor(null)
        setExpanded(false)
        sessionRangeRef.current = null
    }, [])

    // Second-slot morph recenters: the BubbleMenu plugin positions on editor
    // updates, not on its own size changes, so nudge it on the next frame —
    // inside the fade, so the correction is invisible. Expanded height
    // changes stay anchored (as before) to avoid a delayed jump.
    useEffect(() => {
        const raf = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
        return () => cancelAnimationFrame(raf)
    }, [mode])

    // An input session belongs to the selection it was opened for. If the
    // selection is cleared or moves elsewhere (user clicked away and
    // reselected), drop back to the default bubble instead of showing a
    // stale input. Never fires mid-stream.
    useEffect(() => {
        if (mode === 'default' || isStreaming || imagineBusy) return
        const active = sessionRangeRef.current
        const cur = selectionRange
        if (!cur || !active || cur.from !== active.from || cur.to !== active.to) {
            setMode('default')
            setOrigin(null)
            setInstruction('')
            setLinkUrl('')
            setImaginePrompt('')
            setImagineAnchor(null)
            setExpanded(false)
            sessionRangeRef.current = null
        }
    }, [mode, isStreaming, imagineBusy, selectionRange])

    // ── Fire rewrite ──────────────────────────────────────────────────────────
    const handleRewriteSubmit = useCallback(async () => {
        if (!selectedText || !selectionRange || isStreaming || !editor) return

        const finalInstruction =
            instruction.trim() ||
            'Rewrite this passage. Match the surrounding tone, style, and tense exactly. Do not change the meaning.'

        setIsStreaming(true)
        const { from, to } = selectionRange
        editor.setEditable(false)

        try {
            let outputText = ''
            let streamError: string | null = null
            let harnessDone = false
            let harnessPromise: Promise<{ conflicts: number; deleted: boolean }> | null = null
            const baseContent = useEditorStore.getState().content
            await streamSSE(
                `${API_BASE}/api/assist/simple`,
                {
                    content,
                    message: finalInstruction,
                    mode: 'edit',
                    harness,
                    selected_text: selectedText,
                    skip_planner: true,
                },
                (status, data) => {
                    if (status === 'chunk' && harness === 'none') outputText += data.chunk as string
                    else if (status === 'applied' && data.output) outputText = data.output as string
                    else if (status === 'harness_done') {
                        harnessDone = true
                        harnessPromise = applyHarnessResult(baseContent, harness)
                    }
                    else if (status === 'error') streamError = (data.detail as string) || 'Server error during rewrite'
                }
            )

            if (harnessPromise) await harnessPromise
            if (streamError) throw new Error(streamError)

            if (outputText && editor && !harnessDone) {
                editor.chain().focus().deleteRange({ from, to }).insertContentAt(from, outputText).run()
            }
        } catch (err) {
            console.error('Rewrite failed:', err)
            toast.error(`Rewrite failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
        } finally {
            editor.setEditable(true)
            setIsStreaming(false)
            setMode('default')
            setOrigin(null)
            setInstruction('')
            setExpanded(false)
            sessionRangeRef.current = null
        }
    }, [selectedText, selectionRange, isStreaming, instruction, content, editor, harness])

    // ── Fire imagine (inline, no dialog) ──────────────────────────────────────
    const handleImagineSubmit = useCallback(async () => {
        const prompt = imaginePrompt.trim()
        if (!prompt || imagineBusy || !editor || imagineAnchor == null) return

        setImagineBusy(true)
        const fileAtStart = useEditorStore.getState().currentFilePath
        try {
            const { path } = await generateImage({
                prompt,
                styleName: imagineStyle === 'None' ? null : imagineStyle,
                referencePath: null,
            })
            if (editor.isDestroyed) return
            if (useEditorStore.getState().currentFilePath !== fileAtStart) {
                console.warn('Margin: image target file changed mid-generation — dropping image')
                return
            }
            // Fixed alt: deriving it from the prompt sliced raw text (mid-word
            // cuts, newlines, Markdown-significant chars) into the image markup.
            insertStoredImageAt(editor, imagineAnchor, path, 'generated image')
            setMode('default')
            setOrigin(null)
            setImaginePrompt('')
            setImagineAnchor(null)
            setExpanded(false)
            sessionRangeRef.current = null
        } catch (err) {
            console.error('Imagine failed:', err)
            toast.error(`Imagine failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
        } finally {
            setImagineBusy(false)
        }
    }, [imaginePrompt, imagineBusy, imagineStyle, imagineAnchor, editor])

    // ── Expand toggle (single-line ⇄ vertical view) ───────────────────────────
    const handleExpandToggle = useCallback(() => {
        const next = !expanded
        setExpanded(next)
        setTimeout(() => (next ? areaRef.current : inputRef.current)?.focus(), 30)
    }, [expanded])

    // ── Apply link ────────────────────────────────────────────────────────────
    const handleLinkSubmit = useCallback(() => {
        if (!editor) return
        const url = linkUrl.trim()
        if (url) {
            editor.chain().focus().setLink({ href: url }).run()
        } else {
            editor.chain().focus().unsetLink().run()
        }
        setMode('default')
        setOrigin(null)
        setLinkUrl('')
        sessionRangeRef.current = null
    }, [editor, linkUrl])

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (e.key === 'Escape') { handleCancel(); return }
        if (e.key === 'Enter') {
            // Expanded (vertical) view: Enter is a newline, ⌘/Ctrl+Enter submits.
            if (expanded && !e.metaKey && !e.ctrlKey) return
            e.preventDefault()
            if (mode === 'rewrite') void handleRewriteSubmit()
            else if (mode === 'link') handleLinkSubmit()
            else if (mode === 'imagine') void handleImagineSubmit()
        }
    }

    // Stable identity matters: the BubbleMenu wrapper re-dispatches
    // updateOptions (a ProseMirror transaction) whenever this reference
    // changes, so an inline arrow would spam a transaction on every render
    // — including every selection tick.
    const shouldShowBubble = useCallback(({ state }: { state: EditorState }) => {
        if (state.selection instanceof NodeSelection) return false
        return !state.selection.empty
    }, [])

    if (!editor) return null

    return (
        <BubbleMenu
            editor={editor}
            // updateDelay=0 makes the bubble appear instantly on selection,
            // eliminating the "drag from left" positioning artifact
            updateDelay={0}
            // Selection-relative, boundary-aware: centered horizontally,
            // clamped inside the editor/card (shift), flipped below when
            // there is no headroom. Layout itself stays horizontal.
            options={BUBBLE_OPTIONS}
            // Image nodes have their own selected-state chrome (caption +
            // source line in MarginImage) — the text/AI bubble is meaningless
            // on a NodeSelection and would cover the image.
            shouldShow={shouldShowBubble}
            className="relative flex items-start gap-2 overflow-visible"
        >
            {/* Formatting bubble shows in default mode only — hidden while a
                prompt is open so users don't split attention between the two.
                The second slot morphs: AI actions by default, prompt input in
                rewrite / imagine / link modes. Key remounts per mode; the
                morph class itself is mode-switch-only (see morphAnim). */}
            <div className="flex items-start gap-2">
                {mode === 'default' && (
                    <div className={PILL_CLASS}>
                        <NodeSelector editor={editor} />
                        <FormatButtons editor={editor} />

                        {/* Link */}
                        <button
                            onMouseDown={(e) => { e.preventDefault(); handleLinkClick() }}
                            title="Add link"
                            className={`flex items-center justify-center w-6 h-6 rounded-[5px] cursor-pointer transition-colors ${editor.isActive('link')
                                ? 'text-[var(--accent-brown)] bg-[var(--bg-hover)]'
                                : 'text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)]'
                                }`}
                        >
                            <LinkIcon className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}

                <div
                    key={mode}
                    onAnimationEnd={() => setMorphAnim('')}
                    className={`relative flex items-start ${morphAnim}`}
                >
                {(isStreaming || imagineBusy) && (
                    <div className="absolute inset-0 rounded-[8px] z-50 pointer-events-none">
                        <div className="absolute inset-0 rounded-[8px] animate-spin-border" />
                    </div>
                )}
                {mode === 'default' ? (
                    // ── Second bubble: AI actions (Cue Rewrite Imagine) ──────
                    <div className={AI_PILL_CLASS}>
                        {/* Cue — hand the selection to the AI */}
                        <button
                            onMouseDown={(e) => { e.preventDefault(); handleCue() }}
                            className="flex items-center gap-1.5 h-6 px-1.5 text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--accent-brown)] hover:bg-[var(--bg-hover)] rounded-[5px] transition-colors cursor-pointer leading-none whitespace-nowrap"
                        >
                            <span className="flex items-center justify-center w-4 h-4 shrink-0"><CueIcon className="w-3.5 h-3.5" /></span>
                            <span>Cue</span>
                        </button>

                        <div className="w-px h-4 bg-[var(--border-subtle)] shrink-0" />

                        {/* Rewrite */}
                        <button
                            onMouseDown={(e) => { e.preventDefault(); handleRewriteClick() }}
                            className="flex items-center gap-1.5 h-6 px-1.5 text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--accent-brown)] hover:bg-[var(--bg-hover)] rounded-[5px] transition-colors cursor-pointer leading-none whitespace-nowrap"
                        >
                            <span className="flex items-center justify-center w-4 h-4 shrink-0"><RewriteIcon className="w-3 h-3" /></span>
                            <span>Rewrite</span>
                        </button>

                        <div className="w-px h-4 bg-[var(--border-subtle)] shrink-0" />

                        {/* Imagine — selection becomes the starting material */}
                        <button
                            onMouseDown={(e) => { e.preventDefault(); handleImagineClick() }}
                            className="flex items-center gap-1.5 h-6 px-1.5 text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--accent-brown)] hover:bg-[var(--bg-hover)] rounded-[5px] transition-colors cursor-pointer leading-none whitespace-nowrap"
                        >
                            <span className="flex items-center justify-center w-4 h-4 shrink-0"><ImagineIcon className="w-3.5 h-3.5" /></span>
                            <span>Imagine</span>
                        </button>
                    </div>
                ) : mode === 'rewrite' ? (
                // ── Rewrite input state ────────────────────────────────────────
                // Collapsed: single row. Expanded: prompt stacks on top with
                // a quiet right-aligned footer (expand + send).
                expanded ? (
                    <div className={EXPANDED_CLASS}>
                        <textarea
                            ref={areaRef}
                            rows={4}
                            value={instruction}
                            onChange={(e) => setInstruction(e.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={isStreaming}
                            placeholder={isStreaming ? 'Rewriting…' : 'Describe changes'}
                            className={`${FIELD_TEXT_CLASS} w-full resize-none`}
                        />
                        <div className="flex items-center justify-end gap-0.5">
                            <ExpandToggle expanded={expanded} onToggle={handleExpandToggle} />
                            <SendArrow title="Apply rewrite" disabled={isStreaming} dimmed={isStreaming} onSend={() => void handleRewriteSubmit()} />
                        </div>
                    </div>
                ) : (
                    <div className={`${PILL_CLASS} w-[320px]`}>
                        <input
                            ref={inputRef}
                            type="text"
                            value={instruction}
                            onChange={(e) => setInstruction(e.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={isStreaming}
                            placeholder={isStreaming ? 'Rewriting…' : 'Describe changes'}
                            className={`${FIELD_TEXT_CLASS} flex-1`}
                        />
                        <ExpandToggle expanded={expanded} onToggle={handleExpandToggle} />
                        <SendArrow title="Apply rewrite" disabled={isStreaming} dimmed={isStreaming} onSend={() => void handleRewriteSubmit()} />
                    </div>
                )
            ) : mode === 'imagine' ? (
                // ── Imagine input state ────────────────────────────────────────
                // Same stacked structure as Rewrite: prompt on top, quiet
                // right-aligned footer below (style + expand + send).
                // Collapsed is a bare prompt + send. Submit is disabled while
                // empty; busy shows the shimmer.
                expanded ? (
                    <div className={EXPANDED_CLASS}>
                        <textarea
                            ref={areaRef}
                            rows={4}
                            value={imaginePrompt}
                            onChange={(e) => setImaginePrompt(e.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={imagineBusy}
                            placeholder={imagineBusy ? 'Imagining…' : 'Describe the image'}
                            spellCheck={false}
                            className={`${FIELD_TEXT_CLASS} w-full resize-none`}
                        />
                        <div className="flex items-center justify-end gap-0.5">
                            <StylePill value={imagineStyle} onChange={setImagineStyle} disabled={imagineBusy} options={imagineOptions} />
                            <ExpandToggle expanded={expanded} onToggle={handleExpandToggle} />
                            <SendArrow title="Imagine ✦" disabled={imagineBusy || !imaginePrompt.trim()} dimmed={imagineBusy} onSend={() => void handleImagineSubmit()} />
                        </div>
                    </div>
                ) : (
                    <div className={`${PILL_CLASS} w-[320px]`}>
                        <input
                            ref={inputRef}
                            type="text"
                            value={imaginePrompt}
                            onChange={(e) => setImaginePrompt(e.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={imagineBusy}
                            placeholder={imagineBusy ? 'Imagining…' : 'Describe the image'}
                            spellCheck={false}
                            className={`${FIELD_TEXT_CLASS} flex-1`}
                        />
                        <ExpandToggle expanded={expanded} onToggle={handleExpandToggle} />
                        <SendArrow title="Imagine ✦" disabled={imagineBusy || !imaginePrompt.trim()} dimmed={imagineBusy} onSend={() => void handleImagineSubmit()} />
                    </div>
                )
            ) : (
                // ── Link input state (morphed, single pill, fixed width) ─────────
                <div className={`${PILL_CLASS} w-[320px]`}>
                    <input
                        ref={inputRef}
                        type="text"
                        value={linkUrl}
                        onChange={(e) => setLinkUrl(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Paste a link"
                        spellCheck={false}
                        className={`${FIELD_TEXT_CLASS} flex-1`}
                    />
                    <SendArrow title="Apply link" onSend={handleLinkSubmit} />
                </div>
            )}
                </div>
            </div>
        </BubbleMenu>
    )
}
