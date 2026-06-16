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
- **Settings** saved in `settings.json` at the project root
- **No crash reports, no usage stats, no pings home**

Everything stays on your machine.
