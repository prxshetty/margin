# General Settings

The General settings tab controls your workspace, default editor mode, and AI response length.

## Workspace Directory

A **workspace** is a folder on your computer that contains your content project. It can hold chapters, character sheets, style guides, world-building notes -- whatever your project needs.

margin comes with a `sample-workspace` that has example files to help you get started. To use your own:

1. **Type** the absolute path to your folder (e.g., `/Users/name/my-project` on macOS, `C:\Users\name\my-project` on Windows), or
2. Click **Browse...** to pick a folder using your system's file picker, then
3. Click **Link Path**.

To reset to the default sample workspace, click **Reset to default fallback workspace**.

::: tip Your workspace path is stored in your platform's config directory (`~/.config/slm-writing-engine/settings.json` on Linux, `~/Library/Application Support/slm-writing-engine/settings.json` on macOS, `%APPDATA%\slm-writing-engine\settings.json` on Windows) and never sent anywhere.
:::

## Default Mode

Choose which AI assist mode opens by default:

- **Edit Document**: Highlight text in the editor, describe the change you want, and the AI rewrites it inline.
- **Conversational Chat**: Ask questions, brainstorm ideas, or have back-and-forth conversations about your content. The AI can see your cursor position and any selected text.

You can switch between modes at any time while using the AI assistant.

## Default Verbosity

Controls how much text the AI generates per response:

- **No Limit**: Let the AI decide.
- **Concise**: Short responses (~250 tokens).
- **Balanced**: Moderate responses (~500 tokens).
- **Expansive**: Detailed responses (~1000 tokens).

The default is **Balanced**, which works well for most situations.

::: warning Higher verbosity settings consume more tokens. If you're using a smaller local model or have a limited context window, stick with **Concise** or **Balanced**.
:::
