# AI Assist

The AI Assist panel is your main interface for writing with AI. You can toggle between **Edit** and **Chat** modes at any time during a session.

## Agent Harnesses

If you have a subscription to an agentic coding tool, you can run it directly from Margin instead of using an API endpoint. Supported harnesses: **OpenCode**, **Claude Code**, **Codex**, and **Antigravity**.

- **Setup**: install and authenticate each CLI in your own terminal first — Margin never handles harness credentials. Pick a default in **Settings > Harnesses**, or override per request with the harness dropdown in the Assist panel (the inline bubble always follows the default).
- **How it works**: your instruction (plus any selected text) is sent to the agent, which runs in your workspace and edits files itself. Its output streams live in the panel as progress — it is never inserted into the document directly. Harness runs skip the endpoint Planner: the agent receives your instruction, any selected or cursor-anchored text, past conversation and recent edits (bounded by Session Memory), and pointers to the workspace index manifests, and works out everything else — including which files to change or create — by itself. The harnesses' standing edit instructions (including the rule that changes land in files, not in the reply) are editable in **Settings > Context** under *Agent Prompts*.
- **No locking**: the editor stays editable while the agent works. Your current content is snapshotted when the run starts; when it finishes, agent changes are three-way merged (paragraph-level) with any edits you made meanwhile. Your newer work is never silently overwritten — if you both touched the same paragraph, your version is kept and you're told about the conflict.

> See [Harnesses](./configuration/harnesses.md) for detection, custom executable paths, and troubleshooting.

## Edit Mode

Use Edit mode when you want the AI to modify or add content. The behavior depends on whether you have text selected or just a cursor placed.

### Replace (with text selected)

1. **Highlight** the text you want to change.
2. A **Writing Bubble Menu** appears with formatting options, a node selector (paragraph/heading levels), and action buttons.
3. Click **Rewrite** to open an inline instruction input (press Escape to cancel).
4. Type your instruction (e.g., "Make this more dramatic", "Shorten to two sentences") and press Enter.
5. The AI rewrites only the selected portion -- surrounding text stays untouched. The inline bubble always follows your default harness from Settings.

**How replacement works:**

The backend finds which paragraph contains your selection and extracts context:

- **Full paragraph selection**: If you select an entire paragraph, the backend sends the paragraph above, your target, and the paragraph below as a three-paragraph window.
- **Sub-paragraph selection**: If you select a sentence or phrase within a paragraph, the backend extracts the surrounding text *within that same paragraph* as before/after context. This allows the Writer to match rhythm and tone of the surrounding sentences.

The Writer agent receives this context plus your instruction and generates new text. The generated text then replaces your selected content directly -- the frontend deletes the selection and inserts the AI output in its place.

The Writer is instructed to return either a short snippet (if you asked to tweak a specific phrase) or a full rewrite (if you asked to rewrite the entire paragraph). Either way, only your selection is replaced -- nothing else in the document is touched.

### Insert (with cursor only)

1. **Place your cursor** where you want new content to appear.
2. Open the AI Assist panel and switch to **Edit Document**.
3. Type your instruction (e.g., "Write a paragraph about the castle's architecture").
4. Press Enter.
5. The AI generates new content and inserts it at your cursor position.

**How insertion works:**

The backend identifies the paragraph containing your cursor and sends the same three-paragraph window (above, target, below) as context. The AI generates fresh content that gets inserted at the cursor -- nothing is replaced, no text is deleted.

## Chat Mode

Use Chat mode for brainstorming, asking questions, or discussing your content with the AI.

- The AI has access to your full **conversation history** within the session.
- If you have text selected when you send a message, the AI can see what you've highlighted. If no text is selected, the AI sees the paragraph your cursor is on.
- Prior **edit history** (RECENT_EDITS) is carried into chat context, so the AI is aware of what's been previously planned or edited.
- The AI also receives the full **active document** as context.
- Chat mode **does not modify your document** -- it only responds conversationally.
- You can switch between Edit and Chat modes freely without losing session context.

## Context Window

In Edit mode, the AI receives surrounding context to help it match tone and style:

- **Full paragraph selection**: A three-paragraph window (paragraph above, target paragraph, paragraph below).
- **Sub-paragraph selection**: The text before and after your selection *within the same paragraph*, plus the full paragraphs above and below if available.

This keeps token usage low and focused, which is especially important for smaller local models. The Writer agent is instructed to never echo or reproduce the surrounding paragraphs -- only to produce new text for the target.

## How Context Works

The AI Assist panel uses different context strategies depending on the mode:

### Input Bar Context

The `@filename` chips and selection tag in the input area serve as a user reference visible in history logs. File content is resolved independently by each agent.

### Edit Mode (Planner + Writer)

The **Planner** scans available workspace manifests and document structure to determine which context files are relevant. It receives the document outline (optional), selected or cursor-anchored text, and prior edit history.

The **Writer** is stateless -- each edit request is processed independently. It receives only the three-paragraph window around your cursor plus the files resolved by the Planner.

### Bubble Menu Rewrite (skip Planner)

The Writing Bubble Menu's **Rewrite** button provides a faster path for direct rewrites. It bypasses the Planner entirely and sends your instruction directly to the Writer with only the paragraph context. Use this for quick, focused edits when you don't need workspace context (character files, style guides, etc.).

Both panel edits and inline Rewrite use the same Writer template (`prompts/simple-writer.md`) — there is no separate inline prompt to maintain. Edit that file to change rewrite behavior everywhere at once.

### Chat Mode

The **Chat** agent receives the full active document, any selected text or cursor-anchored paragraph, and prior edit history (RECENT_EDITS) from the session. It maintains its own conversation history using only chat-mode logs.

### User Preferences

For persistent style rules (spelling, voice, paragraph length), edit the agent prompts in **Settings > Context** — see [Prompts](./configuration/prompts.md). The Planner intentionally receives instruction-neutral context, keeping its file selection unbiased.

## Reasoning & Thinking

Some AI models produce internal reasoning (or "thinking") before generating their final response. When this happens, the reasoning text appears in a collapsible **Thought Process** dropdown above the response.

### During Streaming

While the model is generating, the reasoning text streams in live and the dropdown opens automatically. You can close it to focus on the final output as it arrives.

### In History

Past AI responses that included reasoning show a collapsed **Thought Process** button. Click it to review the model's reasoning after the fact.

### How to Control It

You can configure the thinking behavior per endpoint in **Settings > Endpoints**:

- **Thinking Model toggle**: Turn reasoning on or off for a specific endpoint. When off, the model's output passes through unmodified.
- **Custom Thinking Tags**: Some models use non-standard reasoning tags. You can add custom `(open, close)` tag pairs so the system can strip them from the output you see.
- **Show thinking by default**: Set whether the Thought Process dropdown opens automatically for new responses.

> See [Endpoints > Reasoning Settings](./configuration/endpoints.md#reasoning-settings) for full configuration details.

## Debugging & Telemetry

Each AI request and response is logged locally. Click the **telemetry / book icon** in the AI Assist panel to open the inspector, which shows:

- The last API request (your full input)
- The complete system prompt sent to the AI
- The AI's raw output response
- Session context and remaining context window
- Total conversation history for the session

Use this to understand why the AI responded a certain way, debug quality issues, or inspect what prompts were used.

> See [Debugging](./debugging.md) for more details on logs, prompt templates, and local telemetry.
