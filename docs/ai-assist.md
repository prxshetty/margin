# AI Assist

The AI Assist panel is your main interface for writing with AI. You can toggle between **Edit** and **Chat** modes at any time during a session.

## Edit Mode

Use Edit mode when you want the AI to modify or add content. The behavior depends on whether you have text selected or just a cursor placed.

### Replace (with text selected)

1. **Highlight** the text you want to change.
2. Click the floating **+ Add to Assist** button that appears above the selection.
3. Type your instruction (e.g., "Make this more dramatic", "Shorten to two sentences").
4. Press Enter or click submit.
5. The AI rewrites only the selected portion -- surrounding text stays untouched.

**How replacement works:**

The backend finds which paragraph contains your selection and extracts a three-paragraph window:
- Paragraph above (context)
- Target paragraph (contains your selection)
- Paragraph below (context)

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
- If you have text selected when you send a message, the AI can see what you've highlighted.
- Chat mode **does not modify your document** -- it only responds conversationally.
- You can switch between Edit and Chat modes freely without losing session context.

## Context Window

In Edit mode, the AI always receives exactly three paragraphs of surrounding context:

```
[Paragraph above]
[Your target -- either selected text or the paragraph containing cursor]
[Paragraph below]
```

This keeps token usage low and focused, which is especially important for smaller local models. The Writer agent is instructed to never echo or reproduce the surrounding paragraphs -- only to produce new text for the target.

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

> See [Debugging](./configuration/debugging.md) for more details on logs, prompt templates, and local telemetry.
