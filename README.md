# margin

*Minimalist, Local-First, AI-Assisted Manuscript Editor*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python: 3.8+](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://www.python.org/)
[![Node: 18+](https://img.shields.io/badge/Node-18+-green.svg)](https://nodejs.org/)

---

**margin** is a locally installed user interface that acts as your collaborative AI writing assistant. It combines a distraction-free, beautifully themed markdown editor with a powerful, context-aware AI pipeline. Because it operates purely on standard text files (no databases required), you maintain complete privacy and full ownership of your creative work.

---

## What is margin?

Unlike heavy SaaS applications or complex command-line interfaces, `margin` is a lightweight, single-page writing environment. It turns your folders of raw notes, outlines, character sheets, and style guides into dynamic context that guides the AI during the writing process. 

---

## Why margin?

1. **Complete Data Privacy**: Your manuscripts, outlines, and notes never leave your machine. No user telemetry is tracked, and no hosted servers are used.
2. **SLM friendly**: Use any model you want, local or otherwise. Tested with as low as 3B parameter models. You do you and have fun writing around with them.
3.  **Writer-First Utility**: Provide intuitive prompt customization and context management. Let the software adapt to your style and layout, not the other way around.
4.  **Aesthetic Focus**: A workspace designed to match your theme and mood, letting you focus entirely on the craft of writing.

---

## Requirements

To run `margin`, you only need:
*   A computer (Windows, MacOS, or Linux) running Python 3.8+ and Node.js 18+.
*   Access to **any coherent or sensible Large Language Model**—either hosted locally (e.g. via LM Studio, KoboldAI, Ollama) or through an OpenAI-compatible API endpoint (e.g. OpenAI, Claude, OpenRouter).

---

## How the AI Assist Works (The Dual-Agent System)

`margin` splits every AI assist action into a two-agent architecture:

```
                  ┌───────────────────────┐
                  │ 1. User Instruction   │
                  └───────────────────────┘
                              │
                              ▼
                  ┌───────────────────────┐
                  │      2. PLANNER       │ ◄─── Reads manifests (WORLD.md, CHARACTERS.md)
                  │ (Context Classifier)  │
                  └───────────────────────┘
                              │ Resolves required context files
                              ▼
                  ┌───────────────────────┐
                  │       3. WRITER       │ ◄─── Recieves instructions + context guidelines
                  │    (Prose Stream)     │      (Has no direct access to workspace files)
                  └───────────────────────┘
```

1.  **The Planner**: The planner is a pure context classifier. It scans your instructions and the list of available reference documents (like characters, styles, or world details) to dynamically resolve which files are required as context. The writer agent itself has no direct knowledge or context of the workspace files; it relies entirely on the planner to fetch them.
2.  **The Writer**: The writer takes the resolved context guidelines, the specific target paragraph, its surrounding lines (before/after context), and your user instructions to generate the updated prose.

### Text Splicing & Editing Gestures
The AI assist records your editor actions to determine how the generated text should be placed:
*   **Highlight & Edit (Selection)**: When you select a specific word, phrase, or sentence in the manuscript, the AI editor acts on that selected region, replacing or augmenting the selection.
*   **Insert at Cursor (Cursor Placement)**: When you place your cursor inside a paragraph without selecting any text, the editor records the paragraph index and streams the AI's output as new paragraphs directly after your cursor block.

---

## Core Features

*   **Dynamic Context Management**: Create arbitrary folders inside your workspace (e.g., `lore/`, `world_building/`, `characters/`). `margin` dynamically indexes these directories, auto-generates Markdown manifests (e.g., `LORE.md`) describing the files, and uses them to supply context to the AI.
*   **Interactive Edit Approval (Diff Mode)**: AI-generated modifications are rendered directly inside the manuscript card as high-contrast diff highlights. Review changes block-by-block and Accept or Reject them based on how well they align with your vision.
*   **Markdown Native Editor**: A rich WYSIWYG canvas built on Tiptap (Novel) that loads and saves raw markdown natively.
*   **Universal Model Compatibility**: Switch between local servers (LM Studio) and cloud APIs dynamically. Check endpoints and verify compatibility directly in the UI.
*   **Aesthetic Themes**: Something I like. :)


---

## Installation

### 1. Run the Backend (FastAPI)

1.  Navigate to the repository root directory.
2.  Install the Python requirements:
    ```bash
    pip install -r requirements.txt
    ```
3.  Set up your environment variables:
    ```bash
    cp .env.example .env
    ```
    *(Edit `.env` to configure your default API keys, local base URLs, and token ceilings).*
4.  Start the FastAPI backend:
    ```bash
    uvicorn api.main:app --reload
    ```
    The API runs at `http://localhost:8000`. API documentation is available at `http://localhost:8000/docs`.

### 2. Run the Frontend (React + Vite)

1.  Navigate to the `ui/` directory:
    ```bash
    cd ui
    ```
2.  Install Node dependencies:
    ```bash
    npm install
    ```
3.  Start the development server:
    ```bash
    npm run dev
    ```
    Open `http://localhost:5173` in your browser to start writing.

---

## Workspace Structure

The application operates on a directory (defaults to `./sample-workspace` or your linked folder):

```
workspace/
├── chapters/          # Manuscript chapters (e.g., chapter-1.md)
├── characters/        # Character profiles (e.g., elara_vance.md)
├── styles/            # Writing style guidelines (e.g., heroic.md)
├── lore/              # Custom directory (e.g., geography.md)
├── LORE.md            # Auto-generated manifest index
└── outputs/           # Logs
```

*Create custom folders (like `lore/` or `world/`) inside the workspace to expand your lorebook. The engine automatically indexes them and generates the matching manifest files.*

---

## Contributing

`margin` is continuously developed and shaped by the community. We welcome contributions, issue reports, and feature requests!

1.  Fork the repository and create your branch.
2.  Submit feature suggestions or bug fixes.
3.  Review pull requests and documentation changes.

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
