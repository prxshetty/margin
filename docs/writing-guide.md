# Writing Guide

## AI Assist Overview

margin uses a **dual-agent architecture** to generate context-aware writing assistance:

```
  Your Request
       │
       ▼
  ┌─────────────────────┐
  │   PLANNER AGENT     │  <-- Reads manifests and reference files
  │  (Context Classifier)│      Decides what context is needed
  └─────────────────────┘
       │ Resolves relevant files
       ▼
  ┌─────────────────────┐
  │   WRITER AGENT      │  <-- Receives instruction + context
  │  (Prose Generator)  │      Produces the final output
  └─────────────────────┘
       │
       ▼
    Your Document
```

1. **The Planner Agent** looks at your workspace -- it reads manifest files (folder indexes), checks which characters, styles, and lore are relevant to your request, and assembles the right context.

2. **The Writer Agent** receives only the instruction, your selected text (if any), and the context prepared by the Planner. It streams the result directly into the editor.

This separation means the AI doesn't need to read every file in your workspace for every request -- the Planner filters and prioritizes context efficiently.

> For a detailed walkthrough of using Edit and Chat modes, see [AI Assist](./ai-assist.md).

## Workspace File Structure

The code auto-discovers folders and files in your workspace. Any top-level subfolder is treated as a content category. The AI reads files from these folders to ground its responses.

### Expected Structure

```
workspace/
├── chapters/          Your manuscript content files
│   ├── CHAPTERS.md    Manifest: lists all chapter files
│   ├── chapter-1.md
│   └── chapter-2.md
├── characters/        Character profile files
│   ├── CHARACTERS.md  Manifest: lists all character files
│   ├── elara.md
│   └── kaelen.md
├── styles/            Tone/style preset files
│   ├── STYLES.md      Manifest: lists all style files
│   ├── cinematic.md
│   └── general.md
└── lore/              World-building notes (indexed automatically)
    ├── world-map.md
    └── factions.md
```

Any subfolder you add at the top level is automatically picked up. The name you give the folder becomes the category the Planner uses when deciding what context is relevant.

## Manifest Files

**Manifest files** are markdown files with **ALL-CAPS names** that serve as indexes for folders. They tell the Planner what's available at a glance.

```
workspace/characters/
├── CHARACTERS.md      <-- Manifest
├── elara_vance.md
└── kaelen_rhys.md
```

Each manifest is a markdown file that lists the files in its folder with a brief description. For example, `CHARACTERS.md`:

```markdown
- elara_vance.md -- Protagonist, volatile artist
- kaelen_rhys.md -- Frenemy, sarcastic and grounded
- lena_hayes.md -- Dr. Lena Hayes, calm scientist
```

::: tip Manifests are maintained by hand -- when you add or remove files, update the manifest to keep it in sync with the folder contents.
:::

### How the Planner Uses Manifests

When you send a request, the Planner reads all manifest files in your workspace to understand the available context. If your request mentions a character, it checks the characters manifest, finds the relevant profile, and includes it in the context sent to the Writer.

This means you don't need to manually specify which files to include -- the Planner handles it automatically based on your content.

## Character Profiles

Create markdown files inside a `characters/` folder in your workspace. Each file describes a character — the entire file content is sent to the AI when the profile is referenced, so structure it however makes the information clearest for both you and the model:

```markdown
# Elara Vance
- **Archetype**: Determined scholar, quiet, cautious.
- **Dialogue**: Terse, direct, uses academic terms under stress.
- **Physical**: Silver hair, gray robes, carries a leather-bound logbook.
```

When you mention a character name in your request, the Planner automatically finds and includes their profile as context for the Writer.

## Style Presets (Tone Presets)

Define writing styles as markdown files inside a `styles/` folder. Each file is plain markdown with section headings for guidelines:

```markdown
## Writer Guidelines
- Show, don't tell. Use sensory details.
- Keep descriptions heavy and atmospheric.
- Dialogue should feel natural, not expository.
```

The **description** shown in the Tone Preset selector comes from the `STYLES.md` manifest file in the same folder. Each entry maps a style filename to a short summary:

```markdown
- cinematic -- Full cinematic scene -- narration sets the atmosphere, dialogue drives the conflict
```

Available styles appear automatically in Settings under **Context > Tone Preset**. Select **Auto** to let the Planner choose, or pick a specific style.

## World Building (Lore)

Create a `lore/` folder (or any custom folder) with world-building notes. These files are automatically indexed by the Planner and included when relevant.

Examples: maps, history timelines, magic systems, faction overviews, setting descriptions.

Lore files don't need manifests -- the Planner auto-indexes any folder contents.

## Chapters

Your actual writing goes in the `chapters/` folder (or whatever you name it). Each chapter is a standard markdown file. The manifest (`CHAPTERS.md`) keeps them organized.

## Custom Prompts (Advanced)

The AI prompt templates are stored as plain markdown files in the `prompts/` folder:

- `simple-planner.md` -- Instructions for the Planner agent
- `simple-writer.md` -- Instructions for the Writer agent
- `simple-chat.md` -- Instructions for Chat mode

Advanced users can edit these files to fine-tune how the AI behaves. Changes take effect immediately -- no restart needed.

::: warning Editing prompts changes how the AI behaves. If something breaks, restore the original from git history.
:::
