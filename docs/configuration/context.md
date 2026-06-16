# Context Settings

Context settings control what information the AI receives about your project. This is the most important section -- getting context right is the key to useful AI assistance.

## Session Memory

margin remembers your recent conversation turns (questions and AI responses) to keep the discussion coherent.

- **Max History Depth**: Set between 1 and 10 turns. A higher number gives the AI more context but uses more tokens. The default of 5 works well for most conversations.

## Tone Preset

A **tone preset** tells the writer agent what style to use when generating text. These presets are defined as markdown files in your workspace's `styles/` folder.

- **None**: No style injected. The AI writes in its default voice.
- **Auto**: The Planner agent decides which tone fits best based on your request and available styles.
- **Specific preset**: Choose from your workspace's available styles (e.g., "Cinematic", "General", "Superman").

The sample workspace comes with a few presets to get you started.

::: tip You can create your own tone presets. See the [Writing Guide](../writing-guide.md#style-presets-tone-presets) for how to define them.
:::

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

These instructions are added automatically to every interaction with the writer agent.

## Reference Files

The **Reference Files** panel lets you control which files in your workspace the AI can read. Each file has three states:

| State | Icon | Behavior |
|-------|------|----------|
| **Available** (default) | Eye icon | The Planner can read this file if it decides the content is relevant. |
| **Pinned** | Pin icon | This file is always included in every AI request. Good for style guides or world-building rules. |
| **Blocked** | Eye + strikethrough | The AI is prevented from reading this file. Useful when smaller models struggle with too much context. |

Click a file's icon to cycle through the states.
