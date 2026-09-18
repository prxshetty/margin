import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { ChevronDown, Check, TextIcon, Heading1, Heading2, Heading3, Link as LinkIcon, Ellipsis, ChevronsUpDown } from 'lucide-react'
import { useEditorStore } from '../../stores/editorStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { toast } from '../../stores/toastStore'
import { API_BASE } from '../../lib/api'
import { streamSSE } from '../../lib/stream-sse'
import { applyHarnessResult } from '../../lib/applyHarnessResult'
import { generateImage, insertStoredImageAt } from '../../lib/media'
import { imageStyleOptions } from './ImageGenerateDialog'
import { CueIcon, RewriteIcon, ImagineIcon } from './brandIcons'

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
                className="flex items-center h-6 gap-1 px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] rounded-[5px] transition-colors cursor-pointer"
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
// Primary row: bold / italic / underline only. Strikethrough and code live in
// the overflow menu so the bar stays minimal.
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
]

const OVERFLOW_ITEMS = [
    {
        name: 'strike',
        label: 'Strikethrough',
        command: (e: Editor) => e.chain().focus().toggleStrike().run(),
        isActive: (e: Editor) => e.isActive('strike'),
        title: 'Strikethrough',
    },
    {
        name: 'code',
        label: 'Code',
        command: (e: Editor) => e.chain().focus().toggleCode().run(),
        isActive: (e: Editor) => e.isActive('code'),
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
                    className={`flex items-center justify-center h-6 px-2 py-1 text-[11.5px] rounded-[5px] cursor-pointer transition-colors ${item.isActive(editor)
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

function OverflowMenu({ editor }: { editor: Editor }) {
    const [open, setOpen] = useState(false)
    const wrapperRef = useRef<HTMLDivElement>(null)

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
            <button
                title="More formatting"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setOpen((v) => !v)}
                className="flex items-center justify-center w-6 h-6 text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] rounded-[5px] transition-colors cursor-pointer"
            >
                <Ellipsis className="w-3.5 h-3.5" />
            </button>
            {open && (
                <div className="absolute top-full left-0 mt-1 w-36 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[8px] shadow-lg z-[10000] p-1">
                    {OVERFLOW_ITEMS.map((item) => (
                        <button
                            key={item.name}
                            title={item.title}
                            onMouseDown={(e) => {
                                e.preventDefault()
                                item.command(editor)
                                setOpen(false)
                            }}
                            className={`flex items-center justify-between w-full px-2 py-1.5 text-[11.5px] rounded-[5px] cursor-pointer transition-colors ${item.isActive(editor)
                                ? 'text-[var(--accent-brown)] bg-[var(--bg-hover)]'
                                : 'text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)]'
                                }`}
                        >
                            <span>{item.label}</span>
                            {item.isActive(editor) && <Check className="w-3 h-3 text-[var(--accent-brown)]" />}
                        </button>
                    ))}
                </div>
            )}
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
const PILL_CLASS = `flex items-center gap-0.5 px-1.5 py-1 ${SURFACE_CLASS}`
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
            className="flex items-center justify-center w-6 h-6 text-[var(--accent-brown)] hover:text-[var(--accent-brown-hover)] hover:bg-[var(--bg-hover)] rounded-[5px] transition-colors cursor-pointer shrink-0 disabled:opacity-40"
        >
            <svg xmlns="http://www.w3.org/2000/svg" className={`w-3.5 h-3.5 ${dimmed ? 'opacity-30' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
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
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            title="Style"
            aria-label="Image style"
            onMouseDown={(e) => e.stopPropagation()}
            className="shrink-0 max-w-[120px] truncate px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-heading)] bg-transparent hover:bg-[var(--bg-hover)] rounded-full outline-none cursor-pointer disabled:opacity-60"
        >
            {options.map((n) => (
                <option key={n} value={n}>{n}</option>
            ))}
        </select>
    )
}

// ─── Main bubble ──────────────────────────────────────────────────────────────
// Editor-first, two conceptual groups:
//   Formatting: Paragraph ▾  B  I  U  link  •••
//   AI:         Cue  Rewrite  Imagine
export function WritingBubbleMenu() {
    const { editor, selectedText, selectionRange, setPendingEditSelection, content } =
        useEditorStore()
    const harness = useSettingsStore((s) => s.settings?.default_harness) || 'none'

    const [mode, setMode] = useState<'default' | 'rewrite' | 'link' | 'imagine'>('default')
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
        sessionRangeRef.current = { ...selectionRange }
        setTimeout(() => inputRef.current?.focus(), 30)
    }, [selectedText, selectionRange, imagineOptions, imageDefaultStyle])

    // ── Cancel input mode ─────────────────────────────────────────────────────
    const handleCancel = useCallback(() => {
        setMode('default')
        setInstruction('')
        setLinkUrl('')
        setImaginePrompt('')
        setImagineAnchor(null)
        setExpanded(false)
        sessionRangeRef.current = null
    }, [])

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

    if (!editor) return null

    return (
        <BubbleMenu
            editor={editor}
            // updateDelay=0 makes the bubble appear instantly on selection,
            // eliminating the "drag from left" positioning artifact
            updateDelay={0}
            // Image nodes have their own selected-state chrome (caption +
            // source line in MarginImage) — the text/AI bubble is meaningless
            // on a NodeSelection and would cover the image.
            shouldShow={({ state }) => {
                if (state.selection instanceof NodeSelection) return false
                return !state.selection.empty
            }}
            className="relative flex items-start gap-2 overflow-visible"
        >
            {(isStreaming || imagineBusy) && (
                <div className="absolute inset-0 rounded-[10px] z-50 pointer-events-none">
                    <div className="absolute inset-0 rounded-[10px] animate-spin-border" />
                </div>
            )}

            {mode === 'default' ? (
                // ── Default state: two pills, space-separated ────────────────
                // Formatting bubble │ AI bubble (Cue Rewrite Imagine)
                <>
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

                        <OverflowMenu editor={editor} />
                    </div>

                    <div className={PILL_CLASS}>
                        {/* Cue — hand the selection to the AI */}
                        <button
                            onMouseDown={(e) => { e.preventDefault(); handleCue() }}
                            className="flex items-center gap-1.5 h-6 px-2 py-1 text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--accent-brown)] hover:bg-[var(--bg-hover)] rounded-[5px] transition-colors cursor-pointer leading-none whitespace-nowrap"
                        >
                            <span className="flex items-center justify-center w-4 h-4 shrink-0"><CueIcon /></span>
                            <span>Cue</span>
                        </button>

                        <div className="w-px h-4 bg-[var(--border-subtle)] shrink-0" />

                        {/* Rewrite */}
                        <button
                            onMouseDown={(e) => { e.preventDefault(); handleRewriteClick() }}
                            className="flex items-center gap-1.5 h-6 px-2 py-1 text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--accent-brown)] hover:bg-[var(--bg-hover)] rounded-[5px] transition-colors cursor-pointer leading-none whitespace-nowrap"
                        >
                            <span className="flex items-center justify-center w-4 h-4 shrink-0"><RewriteIcon /></span>
                            <span>Rewrite</span>
                        </button>

                        <div className="w-px h-4 bg-[var(--border-subtle)] shrink-0" />

                        {/* Imagine — selection becomes the starting material */}
                        <button
                            onMouseDown={(e) => { e.preventDefault(); handleImagineClick() }}
                            className="flex items-center gap-1.5 h-6 px-2 py-1 text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--accent-brown)] hover:bg-[var(--bg-hover)] rounded-[5px] transition-colors cursor-pointer leading-none whitespace-nowrap"
                        >
                            <span className="flex items-center justify-center w-4 h-4 shrink-0"><ImagineIcon /></span>
                            <span>Imagine</span>
                        </button>
                    </div>
                </>
            ) : mode === 'rewrite' ? (
                // ── Rewrite input state ────────────────────────────────────────
                // Collapsed: single row. Expanded: prompt stacks on top with
                // a quiet footer (hint left, expand + send right).
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
                        <div className="flex items-center justify-between">
                            <span className="px-1 text-[10.5px] text-[var(--text-muted)]">⌘↵ to send · esc to cancel</span>
                            <div className="flex items-center gap-0.5">
                                <ExpandToggle expanded={expanded} onToggle={handleExpandToggle} />
                                <SendArrow title="Apply rewrite" disabled={isStreaming} dimmed={isStreaming} onSend={() => void handleRewriteSubmit()} />
                            </div>
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
                // Same stacked structure as Rewrite. The style pill lives in
                // the expanded footer only — collapsed is a bare prompt + send.
                // Submit is disabled while empty; busy shows the shimmer.
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
                        <div className="flex items-center justify-between">
                            <StylePill value={imagineStyle} onChange={setImagineStyle} disabled={imagineBusy} options={imagineOptions} />
                            <div className="flex items-center gap-0.5">
                                <ExpandToggle expanded={expanded} onToggle={handleExpandToggle} />
                                <SendArrow title="Imagine ✦" disabled={imagineBusy || !imaginePrompt.trim()} dimmed={imagineBusy} onSend={() => void handleImagineSubmit()} />
                            </div>
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
        </BubbleMenu>
    )
}
