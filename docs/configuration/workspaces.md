# Workspaces

A **workspace** is a folder on your computer holding your project — chapters, character sheets, style guides, world notes, `assets/`, `outputs/`. margin never moves your files; it just remembers which folder is active.

Settings live in **Settings → Workspaces** (previously under General). The gear icon opens Settings; use the search box to jump straight to "workspace".

## Profiles

Every linked folder is remembered as a named **profile** (name + absolute path), newest first.

- **Open existing** — Browse to a folder, confirm the name (defaults to the folder name), optionally tick Git init, and Link it. Re-linking a known folder updates its name and moves it to the front — never a duplicate.
- **Create new** — Pick a parent folder, type a single project-folder name, optionally tick Git init. margin scaffolds the folder only when it is new or empty (chapters, characters, manifest starter) and links it in one atomic step — a Git failure won't leave you pointing at a half-built directory.
- **Rename / delete** — Rename changes the display name only (your folder on disk is untouched). Deleting a profile just forgets it; your files stay on disk.
- **Switch** — Use the workspace switcher in the file sidebar header. The editor reloads from the newly linked folder.

Profiles are stored in your platform config (`workspace_profiles` in `settings.json`) alongside `linked_workspace_dir` — never sent anywhere.

## Sidebar switcher and folder ops

- The **file sidebar header** has a workspace switcher dropdown (active name + path) so you can jump between projects without opening Settings.
- The sidebar file tree supports **folder operations**: new file/folder inline, rename, delete, with branch guides and folder icons. Layout (comfortable/compact) and sort are in the sidebar header dropdown.
- Images you paste, drop, or generate are filed into the active workspace's `assets/` (`assets/generated/` for Imagine) and travel with it — see [Images](./images.md).

## Git versioning (optional)

Both Open and Create offer an **Init Git** toggle (only when Git is installed; default off — local-first).

- On Create, the repo is initialized as part of scaffolding.
- On Open, Git init runs against the existing folder and reports partial success (linked, but Git failed) instead of failing the whole link.
- margin never commits for you; the toggle only runs `git init` (+ initial commit on create when possible).
