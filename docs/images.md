# Image Assets

Images are plain Markdown backed by workspace files. There is no separate image database — the Markdown is the source of truth and the editor renders it for usability.

## Storage

Image bytes live under your workspace's `assets/` directory:

```
workspace/
├── chapters/
│   └── ...
└── assets/
    ├── image-1.png
    └── image-2.jpg
```

Assets travel with the workspace: they are Git-friendly, work offline, and don't depend on any remote server staying up.

## Markdown representation

```markdown
![Alt text](assets/image.png "Caption")
```

| Part               | Meaning                       |
| ------------------ | ----------------------------- |
| `![...]`           | image description / alt text  |
| `assets/image.png` | workspace-relative asset path |
| `"Caption"`        | optional visible caption      |

For example:

```markdown
![A cat](assets/cat.png "A cute cat")
```

means alt text `A cat`, asset `assets/cat.png`, caption `A cute cat`. You can edit this Markdown directly — in Margin or any other editor — and Margin will render it.

### Dimensions (optional)

An Obsidian-style suffix on the alt text fixes the rendered size:

```markdown
![A cat|800](assets/cat.png "A cute cat")
![A cat|800x600](assets/cat.png "A cute cat")
```

`800` sets the width; `800x600` sets width and height. Images without a suffix render at natural size (bounded by the editor width). A `|` that isn't followed by digits is treated as literal alt text, not dimensions.

## Resizing in the editor

Select an image to reveal five drag handles: the left/right sides adjust width, the bottom adjusts height, and the corners adjust both together. Width and height are independent — dragging a side never touches the other axis, and nothing prevents deliberate distortion. The result is written back into the `|WxH` suffix, so resizing is just a visual way to edit the Markdown.

Guards: sizes bottom out at 32px and width never exceeds the editor; for pixel-exact values, edit the source line. Leaving the height unset keeps the file's natural aspect ratio.

## Alignment and reset

When an image is selected, a small control offers left / center / right alignment plus a reset button that clears explicit dimensions back to natural size. Alignment persists as a trailer:

```markdown
![A cat|800](assets/cat.png){align=right}
```

No trailer means the default centered layout. Clicking the active alignment again returns it to default.

## Import behavior

- **Upload / paste / drag-and-drop** an image file and Margin copies it into `assets/` and inserts `![...](assets/...)` at the cursor.
- **Paste an image URL**: your pasted URL stays in the document as ordinary text, and Margin downloads a copy into `assets/` and inserts a local `![...](assets/...)` image below it. The image never depends on the remote host afterwards.
- **Existing remote images** (e.g. `![cat](https://example.com/cat.png)` typed by hand) are left alone. Opening a document never rewrites it; automatic migration of remote images is a separate, explicit action.

## Editing

Click an image to select it: the underlying `![alt](src "caption")` source becomes editable, along with the caption. What you write is what gets saved — Margin won't silently rewrite it.

## Broken assets

If the referenced file is missing (renamed, moved, deleted), Margin shows a minimal placeholder identifying the path instead of the image. The Markdown reference is preserved untouched, so fixing the path restores the image.

## Size limits

Margin currently does not impose a user-facing image size limit.

## AI / harness access

AI tooling discovers images the same way you do: through the Markdown reference and the workspace `assets/` directory. When visual information is relevant to a task, the agent can inspect the referenced asset file directly.
