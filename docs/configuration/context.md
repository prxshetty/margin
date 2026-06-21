# Context Settings

Context settings control what information the AI receives about your project. This is the most important section -- getting context right is the key to useful AI assistance.

## Session Memory

margin remembers your recent conversation turns (questions and AI responses) to keep the discussion coherent.

- **Max History Depth**: Set between 1 and 10 turns. A higher number gives the AI more context but uses more tokens. The default of 5 works well for most conversations.

## Include Document Structure

When enabled, the AI receives a structural outline (paragraph previews) of your active document. This helps the Planner understand the broader story flow, but consumes more tokens.

::: warning Consider turning this off if you're using a smaller local model. The outline can consume a significant portion of your context window.
:::

## Additional Context

Write any extra instructions that should be prepended to every AI request. This is useful for persistent preferences:

```
Always use British spelling.
Avoid passive voice.
Keep paragraphs under 4 sentences.
```

These instructions are added automatically to the Writer and Chat agents. The Planner intentionally does not receive them.

## Reference Files

The **Reference Files** panel lets you control which files in your workspace the AI can read. Each file has three states:

| State | Icon | Behavior |
|-------|------|----------|
| **Available** (default) | <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg> | The Planner can read this file if it decides the content is relevant. |
| **Pinned** | <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c0 0-7-5.5-7-12a7 7 0 0 1 14 0c0 6.5-7 12-7 12z"/><circle cx="12" cy="10" r="3"/></svg> | This file is always included in every AI request. Good for style guides or world-building rules. |
| **Blocked** | <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><line x1="3" x2="21" y1="3" y2="21"/></svg> | The AI is prevented from reading this file. Useful when smaller models struggle with too much context. |

Click a file's icon to cycle through the states.

You can also block an entire folder -- all files within it become inaccessible to the AI. Blocked folders are shown with a red strikethrough in the panel.
