# slm-writing-engine

A local-first, multi-agent story generation framework designed for SLMs (Small Language Models). Generate professional-grade stories with granular control through styles, per-beat agents, and scene-by-scene feedback loops.

## Features

- **Local-first**: Works with any local LLM via LM Studio (or similar)
- **Style-driven**: Each scene beat is annotated with a style tag. The style file defines which agents run and how they write — narration agent for atmosphere, dialogue agent for conversation, writer agent merges everything
- **Output size control**: Configure token limits via `.env` (floor) or per-style `output_size` (tiers: concise / balanced / expansive)
- **Agent customization**: Add new agents by creating a prompt file + agent class + style section
- **Feedback loops**: Approve or regenerate scenes with natural language feedback
- **Schema-driven**: Customize fields without touching code
- **Debug drafts**: Full per-agent logs saved — input prompts, system prompts, and outputs

## Quick Start

```bash
# 1. Install dependencies
pip install python-dotenv

# 2. Copy and configure .env
cp .env.example .env

# 3. Start LM Studio with your model loaded on localhost:1234

# 4. Run the framework
python main.py

# 5. Follow the prompts: y = approve, n = provide feedback
```

## Configuration

Copy `.env.example` to `.env` and edit:

```env
# LM Studio / Local LLM endpoint
LM_STUDIO_BASE_URL=http://localhost:1234/v1
LM_STUDIO_MODEL=your-model-name-here

# Reasoning model toggle — set to true if using a thinking/reasoning LLM
# (e.g. Gemma Thinking, DeepSeek R1, Qwen-2.5-Coder). Enables a thinking
# preamble that prompts the model to reason step-by-step internally before
# generating JSON outputs.
REASONING_MODEL=false

# Token limits — floor per beat/response
TOKENS_BLUEPRINT=2000
TOKENS_SCENE=600
TOKENS_DIALOGUE=800
TOKENS_NARRATION=800
TOKENS_DECOMPOSER=600
TOKENS_WRITER=500
TOKENS_TRANSITION=400
```

> **Important for thinking / reasoning models:** If your model supports chain-of-thought reasoning (e.g. Gemma Thinking, DeepSeek R1, Qwen-2.5-Coder), set `REASONING_MODEL=true`. This prepends a thinking preamble to every agent's system prompt, telling the model to reason step-by-step before producing its final output. The model's internal reasoning is captured via the API's `reasoning_content` field — no extra terminal output. Leave `REASONING_MODEL=false` (default) for standard instruction-tuned models.

> **Disabling token limits:** To let the model run without any `max_tokens` cap (ignoring both `TOKENS_*` env vars and style `output_size`), set `DISABLE_TOKEN_LIMITS=true`. Useful for powerful models that know when to stop. Per-agent limits remain configurable for users who want them.

## Project Structure

```
slm-writing-engine/
├── agents/                    # AI agents
│   ├── blueprint_agent.py     # Generates act/scene structure from chapter outline
│   ├── scene_agent.py         # Generates setting descriptions
│   ├── narration_agent.py     # Generates narration prose (per-beat, optional)
│   ├── dialogue_agent.py      # Generates character dialogue (per-beat, optional)
│   ├── writer_agent.py        # Merges sub-agent drafts into polished beats
│   └── transition_agent.py    # Generates act bridges
├── schema/                    # Schema definitions (scene.yaml, act.yaml, agents.yaml)
├── prompts/                   # Agent prompt templates
│   ├── blueprint_base.txt
│   ├── scene.txt
│   ├── narration.txt
│   ├── dialogue.txt
│   ├── writer.txt

│   └── transition.txt
├── inputs/
│   ├── characters/            # Character profiles (YAML)
│   ├── chapters/              # Chapter outlines (Markdown)
│   └── styles/                # Style definitions (Markdown with YAML frontmatter)
├── outputs/
│   ├── drafts/                # Debug: per-scene agent inputs/outputs
│   └── results/               # Final approved content
├── .env.example               # Documented configuration template
├── config.py                  # Configuration & prompt building
├── models.py                  # Data classes
├── orchestrator.py            # Agent coordination
├── style_loader.py            # Style parsing and resolution
├── schema_loader.py           # Schema loading
├── state_manager.py           # Character/story state
└── llm.py                     # LM Studio API client
```

## Styles

Styles are the system's primary mechanism for controlling voice, pacing, and agent selection. Each style is a `.md` file in `inputs/styles/` with YAML frontmatter and `## <Agent> Guidelines` sections.

### How styles work

1. The blueprint agent tags each scene beat with a style name (e.g., `superman`, `general`)
2. The orchestrator loads the matching style file
3. Each `##` section in the style file triggers a sub-agent:
   - `## Narration Guidelines` → narration agent runs
   - `## Dialogue Guidelines` → dialogue agent runs
   - `## Writer Guidelines` → writer agent runs (always required)
4. All sub-agent outputs are collected into a `drafts` dict
5. The writer agent merges them into a single polished beat

### Built-in styles

| Style | Agents triggered | Use case |
|---|---|---|
| `general` | Writer only | Default balanced prose |
| `superman` | Writer + Dialogue | Heroic, inspirational scenes |
| `cinematic` | Narration + Dialogue + Writer | Full cinematic scene with atmosphere, dialogue, and blend |

### Creating a custom style

Create a new `.md` file in `inputs/styles/`:

```markdown
---
description: "Brief description of what this style does"
output_size: expansive  # optional: concise (250), balanced (500), expansive (1000)
---

## Narration Guidelines
- How to describe the environment
- Sensory focus, camera movement, pacing

## Dialogue Guidelines
- Character voice rules
- Subtext, interruptions, power dynamics

## Writer Guidelines
- How to blend narration and dialogue
- Paragraph pacing, sentence rhythm
```

Rules:
- `## Writer Guidelines` is required — the writer always runs
- Every other `##` section is optional — only present sections trigger agents
- Section names are case-insensitive (`## Narration Guidelines` = `## narration guidelines`)
- Add the style name to `inputs/styles/STYLES.md` to register it

## Output Size Control

Two layers:

### 1. `.env` — floor per agent

```env
TOKENS_WRITER=500    # default per-beat token budget
TOKENS_NARRATION=800
TOKENS_DIALOGUE=800
```

### 2. Style `output_size` — overrides upward per style

```yaml
---
output_size: expansive  # concise=250, balanced=500, expansive=1000
---
```

Style override + `.env` floor = the writer gets the larger of the two. This keeps the `.env` as a baseline for your hardware while style files control narrative pacing.

## Minimum Dialogue Control

Each style can define a `min_dialogues` frontmatter field to set the minimum number of dialogue exchanges expected for dialogue-heavy beats tagged with that style.

```yaml
---
description: "Full cinematic scene"
output_size: expansive
min_dialogues: 4   # dialogue beats should have 4+ exchanges
---
```

The decomposer agent uses per-style minima to generate beats with appropriate `expected_exchanges` values, displayed during scene review as `[style] [#+]`.

### Resolution order

1. **Per-style `min_dialogues`** (in the style's `.md` frontmatter) — highest priority
2. **`Minimum Dialogues: X`** line in `STYLES.md` — global fallback for all styles
3. **Code default of `2`** — used if neither is set

## Input Files

### Chapter File (`inputs/chapters/chapter-N.md`)

No enforced structure. Write whatever you want — raw thoughts, scene descriptions, character notes. The blueprint agent infers structure from your text.

```markdown
# Chapter 1: The Weight of the Canvas

Elara Vance sits before a vast, blank canvas in her cluttered studio late at
night, paralyzed by the pressure of expectation. The air is thick with
turpentine and aged canvas. Moonlight cuts through the dusty window.

Kaelen Rhys visits, challenging her self-doubt head-on. After his confrontation,
Elara has a quiet turning point — she rises, faces the canvas, and declares
she'll paint not what's expected, but what demands to be born.

Dr. Lena Hayes arrives later. Kaelen suggests dinner outside to clear the air.
Lena is skeptical but agrees. The chapter ends with the three of them leaving.
```

Characters are detected by matching names against YAML files in `inputs/characters/`.
If the blueprint gets anything wrong, the feedback loop at approval time lets you correct it.

### Character Profile (`inputs/characters/name.yaml`)

Character YAML filenames must be a prefix of the character name used in the chapter.

```yaml
name: Elara
description: A determined woman with sharp features
traits:
  - Brave
  - Intelligent
  - Secretive
goals:
  - Uncover the truth
  - Protect her sister
flaws:
  - Trust issues
  - Impulsive
current_state: ""
```

## Generation Workflow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. LOAD CHAPTER                                             │
│    └── reads inputs/chapters/chapter-N.md                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. GENERATE BLUEPRINT                                       │
│    └── BlueprintAgent creates act/scene structure            │
│        with style-tagged scene_events                        │
│                                                             │
│    User reviews blueprint                                    │
│    → y = approve, proceed                                   │
│    → n = provide feedback, regenerate                       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. SCENE WALKTHROUGH                                        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. PER-BEAT GENERATION (for each scene)                     │
│                                                             │
│  SceneAgent → setting draft                                 │
│                                                             │
│  For each beat (scene_event):                               │
│  ┌─────────────────────────────────────────────────┐        │
│  │ Style file determines which agents run:          │        │
│  │ ├── ## Narration → NarrationAgent → draft       │        │
│  │ ├── ## Dialogue  → DialogueAgent → draft        │        │
│  │ └── WriterAgent merges all drafts → beat text   │        │
│  └─────────────────────────────────────────────────┘        │
│                                                             │
│  User reviews scene                                         │
│  → y = approve, save to drafts/, move to next               │
│  → n = provide feedback (scene regenerates)                 │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. ACT APPROVAL                                              │
│    └── All scenes approved → save to results/               │
└─────────────────────────────────────────────────────────────┘
```

## Output Structure

### Drafts (`outputs/drafts/act-N/`)

For debugging. Each scene generates:

| File | Content |
|------|---------|
| `scene-N-context.json` | Scene context + scene agent setting input/output |
| `scene-N-beat-M.json` | Full per-beat log — style, mode, and every agent's system prompt + user prompt + output for that beat |
| `scene-N-final.json` | Final approved scene content |

### Results (`outputs/results/`)

Final approved content — one file per act.

## CLI Interaction

| Prompt | Response | Action |
|--------|----------|--------|
| `Approve blueprint? (y/n)` | `y` | Continue to scene generation |
| | `n` | Enter feedback, blueprint regenerates |
| `Proceed to scene-by-scene generation? (y)` | `y` | Start generating scenes |
| `Approve scene? (y/n)` | `y` | Save draft, move to next scene |
| | `n` | Enter feedback, scene regenerates |
| `Approve Act and save? (y/n)` | `y` | Save to results/, update state |
| | `n` | Skip act |

## Customizing Agents

1. Create `prompts/your_agent.txt` with structural instructions
2. Create `agents/your_agent.py` following the `DialogueAgent` / `NarrationAgent` pattern
3. Add your agent to `orchestrator.py` (`__init__` and per-beat routing)
4. Add `## Your Agent Guidelines` to any style file to trigger it per-beat
5. Add config + token limit in `config.py` and `.env.example`

## Requirements

- Python 3.8+
- LM Studio (or any OpenAI-compatible local server)
- dotenv: `pip install python-dotenv`

## Troubleshooting

**No chapters found**: Create a `.md` file in `inputs/chapters/`

**Character profiles not loading**: Filename must be a prefix of the character name in the chapter (e.g., `elara.yaml` matches "Elara Vance")

**Model not responding**: Check LM Studio is running and model is loaded

**Scenes feel generic**: Improve `scene_description` in chapter outline or adjust style `## Writer Guidelines`

**Style not found**: Add the style name to `inputs/styles/STYLES.md`
