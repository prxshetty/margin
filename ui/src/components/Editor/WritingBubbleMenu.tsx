import { useState, useRef, useCallback, useEffect } from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/core'
import { ChevronDown, Check, TextIcon, Heading1, Heading2, Heading3 } from 'lucide-react'
import { useEditorStore } from '../../stores/editorStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { API_BASE } from '../../lib/api'
import { streamSSE } from '../../lib/stream-sse'
import { applyHarnessResult } from '../../lib/applyHarnessResult'

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
                className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] rounded-[5px] transition-colors cursor-pointer"
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
// StarterKit ships Bold, Italic, Strike, and Code — all safe to use here.
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
                    className={`px-2 py-1 text-[11.5px] rounded-[5px] cursor-pointer transition-colors ${item.isActive(editor)
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

// ─── Divider ──────────────────────────────────────────────────────────────────
function Divider() {
    return <div className="w-px h-4 bg-[var(--border-subtle)] mx-0.5 shrink-0" />
}

// ─── Main bubble ──────────────────────────────────────────────────────────────
export function WritingBubbleMenu() {
    const { editor, selectedText, selectionRange, setPendingEditSelection, content } =
        useEditorStore()
    const harness = useSettingsStore((s) => s.settings?.default_harness) || 'none'

    const [mode, setMode] = useState<'default' | 'rewrite'>('default')
    const [instruction, setInstruction] = useState('')
    const [isStreaming, setIsStreaming] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    // ── Add to Margin ─────────────────────────────────────────────────────────
    const handleAddToMargin = useCallback(() => {
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
        setTimeout(() => inputRef.current?.focus(), 30)
    }, [])

    // ── Cancel rewrite mode ───────────────────────────────────────────────────
    const handleCancel = useCallback(() => {
        setMode('default')
        setInstruction('')
    }, [])

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
            window.alert(`Rewrite failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
        } finally {
            editor.setEditable(true)
            setIsStreaming(false)
            setMode('default')
            setInstruction('')
        }
    }, [selectedText, selectionRange, isStreaming, instruction, content, editor, harness])

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') { e.preventDefault(); handleRewriteSubmit() }
        if (e.key === 'Escape') { handleCancel() }
    }

    if (!editor) return null

    return (
        <BubbleMenu
            editor={editor}
            // updateDelay=0 makes the bubble appear instantly on selection,
            // eliminating the "drag from left" positioning artifact
            updateDelay={0}
            className={`
                relative
                flex items-center gap-0.5 px-1.5 py-1
                bg-[var(--bg-elevated)] border border-[var(--border-subtle)]
                rounded-[8px] shadow-[0_2px_8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)]
                overflow-visible
                ${mode === 'rewrite' ? 'min-w-[260px]' : ''}
            `}
        >
            {isStreaming && (
                <div className="absolute inset-0 rounded-[8px] z-50 pointer-events-none">
                    <div className="absolute inset-0 rounded-[8px] animate-spin-border" />
                </div>
            )}

            {mode === 'default' ? (
                // ── Default state ──────────────────────────────────────────────
                <>
                    <NodeSelector editor={editor} />
                    <Divider />
                    <FormatButtons editor={editor} />
                    <Divider />

                    {/* Add to Margin — same visual weight as other buttons */}
                    <button
                        onMouseDown={(e) => { e.preventDefault(); handleAddToMargin() }}
                        title="Add selection to margin note"
                        className="px-2 py-1 text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--accent-brown)] hover:bg-[var(--bg-hover)] rounded-[5px] transition-colors cursor-pointer leading-none whitespace-nowrap"
                    >
                        + Margin
                    </button>

                    <Divider />

                    {/* Rewrite */}
                    <button
                        onMouseDown={(e) => { e.preventDefault(); handleRewriteClick() }}
                        className="px-2 py-1 text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-hover)] rounded-[5px] transition-colors cursor-pointer leading-none whitespace-nowrap"
                    >
                        Rewrite
                    </button>
                </>
            ) : (
                // ── Rewrite input state (morphed) ──────────────────────────────
                <>
                    {/* Instruction input */}
                    <input
                        ref={inputRef}
                        type="text"
                        value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={isStreaming}
                        placeholder={isStreaming ? 'Rewriting…' : 'Describe changes'}
                        className="flex-1 bg-transparent text-[11.5px] text-[var(--text-heading)] placeholder:text-[var(--text-muted)] outline-none px-1 min-w-0 disabled:opacity-60"
                    />

                    {/* Send */}
                    <button
                        onMouseDown={(e) => { e.preventDefault(); handleRewriteSubmit() }}
                        disabled={isStreaming}
                        title="Apply rewrite"
                        className="flex items-center justify-center w-6 h-6 text-[var(--accent-brown)] hover:text-[var(--accent-brown-hover)] hover:bg-[var(--bg-hover)] rounded-[5px] transition-colors cursor-pointer shrink-0 disabled:opacity-40"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className={`w-3.5 h-3.5 ${isStreaming ? 'opacity-30' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12h14M12 5l7 7-7 7" />
                        </svg>
                    </button>
                </>
            )}
        </BubbleMenu>
    )
}