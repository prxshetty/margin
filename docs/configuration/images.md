# Images

Images live in your workspace's `assets/` folder and travel with it — upload once, reference as plain Markdown (`![alt](assets/...)`) forever. Full workflow (upload, resize, align, captions) is in the [Writing Guide](../writing-guide.md#images); [Debugging](../debugging.md#image-issues) covers broken references and failed generations.

## Settings → Images

Providers, looks, and ComfyUI workflows are configured in **Settings → Images**:

- **Providers** — OpenAI-compatible endpoints, Stability, FAL, Google Gemini, or local ComfyUI. The editor never cares which one produced the image. Configure credentials, then **Test provider** before generating.
- **ComfyUI Workflows** — Import your own API-format workflows into two slots: a **text-to-image workflow** for Imagine and an **image edit workflow** (with a `LoadImage` input) for Imagine again. Each slot accepts an optional **seed mapping** so every run gets a fresh random seed; without one, the workflow's saved seed is reused verbatim. Your workflows are never modified — margin overlays prompt, reference, and seed onto a per-run copy.
- **Looks** — Look suffixes appended to your prompt. Shipped looks (`Cinematic`, `Illustration`) can be edited, hidden (Restore brings them back), or reset; add your own below the list. `None` is never deletable and means no suffix.

## Generation history

Every run is recorded under **History → Images** in the assistant sidebar (newest first, refetched on open): thumbnail, prompt, timestamp, seed, provider. Click an entry for full details — input/output images, submitted prompt, paths — plus Copy prompt and Open-folder actions. Delete individual entries with the hover × button; asset files are kept on disk.

Logs live in your workspace at `outputs/image_logs/images.json` (prompt, submitted text, seed, asset path) — separate from chat `ai_logs/`.
