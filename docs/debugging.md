# Debugging

margin logs every AI request and response locally so you can inspect what's happening under the hood.

## AI Logs

Every time you send a request to the AI (in edit mode or chat mode), margin saves a log entry that includes:

- Your input prompt / instruction
- The complete context sent to the writer agent (characters, styles, additional context, etc.)
- The full AI response
- Token usage information
- Session ID and timestamp

These logs are stored as JSON files in the `outputs/ai_logs/` folder inside your workspace.

### Viewing Logs

You can view logs directly in the app through the **AI Assist panel** -- look for the log/book icon that opens the request inspector. This shows the last API request, the input and output context, the total session context, and remaining context window.

### Editing or Clearing Logs

- Logs are plain JSON files -- you can open, edit, or delete them with any text editor.
- To clear all logs for a session, use the delete option in the log viewer.

::: tip Logs are purely local. They never leave your machine.
:::

## Inspecting Prompts

The prompt templates used by the Planner and Writer agents are stored as markdown files in the `prompts/` folder at the project root:

| File | Purpose |
|------|---------|
| `prompts/simple-planner.md` | Instructions for the Planner agent |
| `prompts/simple-writer.md` | Instructions for the Writer agent |
| `prompts/simple-chat.md` | Instructions for Chat mode |

You can read these files to understand exactly what instructions are being sent to the AI. Edits take effect immediately -- no restart needed.

::: warning Editing prompts changes how the AI behaves. If something breaks, you can restore the original from the project's git history.
:::

## Telemetry

margin has **no external telemetry**. There are no analytics, no tracking scripts, and no data sent to external servers (except the AI provider you explicitly configure).

The only "telemetry" is local:

- **AI logs** stored in `outputs/ai_logs/` for debugging your own requests
- **Settings** saved in your platform's config directory — `~/.config/slm-writing-engine/settings.json` on Linux, `~/Library/Application Support/slm-writing-engine/settings.json` on macOS, `%APPDATA%\slm-writing-engine\settings.json` on Windows
- **No crash reports, no usage stats, no pings home**

Everything stays on your machine.

## Image Issues

Images are plain Markdown references (`![alt](assets/foo.png)`), so most problems come down to a mismatch between the text and the file. Your Markdown is never auto-deleted or rewritten — fix the underlying cause and the image comes back.

### Broken image placeholder

The referenced asset file is missing — it was renamed, moved, or deleted. Check that the file exists under your workspace's `assets/` folder and that the path in the Markdown matches exactly (including case). Editing the source line to the correct path restores the image.

### Pasted image doesn't appear

- If an upload alert appeared, the file wasn't a supported image (PNG, JPG, WebP, GIF) — the pasted text itself is untouched.
- If a pasted image URL produced no image, the download failed (bad link, offline host, or a non-image response). Your pasted URL text stays in the document; try the URL in a browser to check it.

### Wrong size after editing dimensions

Only positive integers count: `![alt|0](x.png)` or `![alt|-5](x.png)` fall back to natural size. A `|` followed by non-digits (e.g. `![a|b](x.png)`) is treated as literal alt text, not a size. An `{align=...}` value other than `left`, `center`, or `right` is left as visible text — correct the spelling to apply it.

### Remote image never becomes local

Only explicitly pasted/imported image URLs are downloaded into `assets/`. An image URL you typed by hand into Markdown stays remote by design — paste the URL as document content if you want margin to import a local copy.

### Image looks too large after import

New images render at natural size bounded by the editor width. Select the image and drag a handle (or reset) to persist a smaller width.
