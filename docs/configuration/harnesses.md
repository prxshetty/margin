# Agent Harnesses

If you already pay for an AI coding helper, Margin can use it instead of an API endpoint. The helper runs on your computer, edits your files, and Margin shows you what changed.

| Helper | Notes |
|--------|-------|
| **OpenCode** | Model list comes straight from the helper. |
| **Claude Code** | Built-in model list[^1] — or type any model name by hand. |
| **Codex** | Built-in model list[^1] — or type any model name by hand. |
| **Antigravity** | Model list comes straight from the helper. |

## Before you start

Install the helper and sign in using its own instructions, in your own terminal. Margin only starts the helper's program — it never sees or stores your sign-in. If a run fails with a sign-in error, the helper's own message is shown; sign in again in your terminal and retry.

## Finding your helpers

**Settings > Harnesses** lists each supported helper:

- `✓ Ready · <version>` — good to go.
- `✕ Not installed` — install and sign in to its program, then reopen Settings and it should appear.

If Margin can't find a helper you installed, enter its location by hand in the "Custom program" box for that helper.

## Configuration

- **Default Harness**: `None — use endpoint` (the normal setting — nothing changes) or one of your helpers. You can also pick a helper per message from the dropdown in the Assist panel; the inline bubble always follows the default.
- **Default model**: which model the helper should use. OpenCode and Antigravity show the list straight from the helper itself. Codex and Claude Code don't offer a list command, so Margin ships a built-in list for them[^1] — or just type any model name by hand.
- **Custom program**: the helper's location on your computer, for installs Margin can't find on its own.
- **Ctx**: the helper model's context window, used only for the usage ring next to the input. Leave empty to hide the ring — the token count still shows.
- **Harness Edit prompt**: the standing edit instructions (including the rule that changes land in files, not in the reply) are editable in **Settings > Context** — see [Prompts](./prompts.md).

[^1]: The built-in lists for Codex and Claude Code are updated with Margin releases. If a brand-new model is missing, type its name by hand.

## Token counts

The input bar always shows session token totals. All four helpers report real usage; if a run reports none, Margin estimates from text length (`len/4`) — treated as approximate. The `%` ring appears only when a context window is known (the Ctx field above).

## While it works

- You can keep writing — the editor never locks.
- The helper's progress appears in the panel as it works: text and reasoning as it streams, plus one line per file read, edited, or created.
- When it finishes, its changes are highlighted in your document. Conflicts (you edited the same paragraph) keep your version and are flagged.
- **Accept** keeps the merged result; **Reject** removes the helper's changes but preserves yours.

## Sessions

One Margin session maps to one helper conversation. The first request starts it; every follow-up in the same session continues it — the helper remembers prior turns, file reads, and tool results, so "try again" retries the real previous attempt and files aren't re-read from cold.

- **New Chat** starts a fresh helper conversation.
- Deleting a session also drops the link to its helper conversation.
- If a run fails, the next attempt starts fresh rather than resuming the broken conversation.
- Switching between an endpoint and a helper mid-session doesn't transfer history — each side only remembers its own turns. Session Memory settings don't apply to helpers.

## If something goes wrong

| What you see | What to do |
|---|---|
| `<Name> not found` | Install the helper's program, or enter its location in Settings > Harnesses. |
| Sign-in / login errors | Sign in to the helper in your terminal and retry. |
| The helper changed other files | Only the open file is merged and highlighted. Other files appear in the sidebar as the helper saves them — live for all four helpers. |
