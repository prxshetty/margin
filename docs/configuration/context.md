# Context Settings

Context settings control what information the AI receives about your project. This is the most important section -- getting context right is the key to useful AI assistance.

> Most settings here apply to both endpoints and harnesses. The exceptions are noted per section — see [Harnesses](./harnesses.md).

## Agent Prompts

Edit the instructions each agent runs on (Writer, Planner, Chat, Harness Edit). Changes apply to the next request — see [Prompts](./prompts.md).

## Session Memory

margin remembers your recent conversation turns (questions and AI responses) to keep the discussion coherent.

- **Max History Depth**: Set between 1 and 10 turns. A higher number gives the AI more context but uses more tokens. The default of 5 works well for most conversations. Applies to endpoint chat turns and planner history only — harnesses keep their own conversation per session and continue it automatically (see [Harnesses](./harnesses.md)).

## Reference Files

The **Reference Files** panel lets you control which files in your workspace the AI can read. Each file has three states:

| State | Icon | Behavior |
|-------|------|----------|
| **Available** (default) | <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg> | The Planner can read this file if it decides the content is relevant. |
| **Pinned** | <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg> | This file is always included in every AI request. Good for style guides or world-building rules. |
| **Blocked** | <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg> | The AI is prevented from reading this file. Useful when smaller models struggle with too much context. |

Click a file's icon to cycle through the states.

You can also block an entire folder -- all files within it become inaccessible to the AI. Blocked folders are shown with a red strikethrough in the panel.

## Include Document Structure

When enabled, the endpoint planner receives a structural outline (paragraph previews) of your active document. This helps the Planner understand the broader story flow, but consumes more tokens.

Endpoint planner only — harnesses read the workspace directly, so the checkbox disables while a harness is the default. For persistent style rules, edit the agent prompts above instead.

::: warning Consider turning this off if you're using a smaller local model. The outline can consume a significant portion of your context window.
:::
