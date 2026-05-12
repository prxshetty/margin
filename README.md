# slm-writing-engine

A local-first, multi-agent story generation framework designed for SLMs (Small Language Models). Generate professional-grade stories with granular control through scene-by-scene iteration and feedback loops.

## Features

- **Local-first**: Works with any local LLM via LM Studio (or similar)
- **Agent customization**: Add/modify agents via YAML schema
- **Feedback loops**: Approve or regenerate scenes with natural language feedback
- **Schema-driven**: Customize fields without touching code
- **Genre-aware**: Set genre and tone guidelines in your chapter file — the writer agent calibrates emotional depth and pacing accordingly
- **Writing Focus**: Mark scenes as high-focus or functional — creative_element signals the writer to go deep or stay efficient, no inference needed
- **Scene-level control**: Each scene's description drives emotional register, so even within a genre individual scenes can deviate
- **Debug drafts**: Full scene context saved per agent — input prompts, system prompts, and outputs all logged per scene

## Quick Start

```bash
# 1. Install dependencies
pip install python-dotenv

# 2. Configure your LLM (see Configuration section below)

# 3. Start LM Studio with your model loaded on localhost:1234

# 4. Run the framework
python main.py

# 5. Create a chapter file in inputs/chapters/ (see template below)
# 6. Follow the prompts: y = approve, n = provide feedback
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env`:
```env
# LM Studio / Local LLM endpoint
LM_STUDIO_BASE_URL=http://localhost:1234/v1

# Model name (shown in LM Studio)
LM_STUDIO_MODEL=your-model-name-here
```

## Project Structure

```
slm-writing-engine/
├── agents/                    # AI agents
│   ├── blueprint_agent.py     # Generates act/scene structure
│   ├── scene_agent.py         # Generates setting descriptions
│   ├── dialogue_agent.py      # Generates character conversations
│   ├── writer_agent.py        # Combines into polished scenes
│   └── transition_agent.py    # Generates act transitions
├── schema/                    # Schema definitions
│   ├── scene.yaml             # Scene field definitions
│   ├── act.yaml               # Act field definitions
│   └── agents.yaml            # Agent field mappings
├── prompts/                   # Agent prompt templates
├── inputs/
│   ├── characters/            # Character profiles (YAML)
│   ├── chapters/              # Chapter outlines (Markdown)
│   └── story_state.yaml       # Dynamic character states
├── outputs/
│   ├── drafts/                # Debug: per-scene agent inputs/outputs
│   └── results/               # Final approved content
└── core/
    ├── config.py              # Configuration & prompt building
    ├── models.py              # Data classes
    ├── orchestrator.py        # Agent coordination
    ├── schema_loader.py        # Schema loading
    ├── state_manager.py        # Character/story state
    └── llm.py                 # LM Studio API client
```

## Input Files

### Chapter Outline (`inputs/chapters/chapter-N.md`)

```markdown
# Chapter Title

## Characters
- Elara
- Kaelen
- Lena

## Background/Setting
(Optional context about setting, time period, etc.)

## Genre
Crime / Thriller

## Tone Guidelines
- Prioritize physical environment over character emotion
- Show detective competence through action, not feeling
- Emotion only when plot-relevant

## Writing Focus
- Crime scene: maximum detail, forensic and sensory — creative_element: the blood spatter pattern on the wall
- Interrogation: character voice priority
- Travel/transition: functional, one paragraph maximum

## Chapter Outline
A detailed description of what happens in this chapter. Include emotional beats, character interactions, and key moments. This drives the entire generation.
```

### Character Profile (`inputs/characters/name.yaml`)

Character YAML files must use a **first-name prefix** of the character name used in the chapter. For example, "Elara Vance" in the chapter file will match `elara.yaml` or `elara_vance.yaml`. Parenthetical roles like `(Protagonist)` are stripped automatically.

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

## Schema Architecture

The `schema/` directory drives the entire system. Edit these files to customize behavior:

### `schema/scene.yaml` - Scene Field Definitions

```yaml
description: "A single scene within an act"
fields:
  scene_number:
    type: int
    required: true
  scene_setting:
    type: str
    required: true
    description: "Short canonical location tag only (e.g. 'kitchen', 'gym', 'police station'). No atmosphere, no detail — the Scene Agent handles that."
  characters:
    type: list[str]
    required: true
  scene_description:
    type: str
    required: true
    description: "What happens - events, emotional arc, key moments"
  creative_element:
    type: str
    required: false
    description: "Key physical action/interaction"
    default: ""
```

### `schema/agents.yaml` - What Each Agent Gets

```yaml
dialogue_agent:
  - scene_description
  - scene_setting
  - characters

writer_agent:
  - scene_description
  - characters
```

## Generation Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. LOAD CHAPTER                                                 │
│    └── reads inputs/chapters/chapter-N.md                       │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. GENERATE BLUEPRINT                                           │
│    └── BlueprintAgent creates act/scene structure               │
│                                                                 │
│    User reviews blueprint                                       │
│    → y = approve, proceed                                       │
│    → n = provide feedback, regenerate                           │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. SCENE WALKTHROUGH                                            │
│    └── Shows all acts/scenes with details                       │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. SCENE-BY-SCENE GENERATION                                    │
│                                                                 │
│    For each scene:                                              │
│    ┌─────────────────────────────────────┐                      │
│    │ a. SceneAgent → setting draft       │                      │
│    │ b. DialogueAgent → dialogue draft  │                      │
│    │ c. WriterAgent → final scene       │                      │
│    └─────────────────────────────────────┘                      │
│                                                                 │
│    User reviews scene                                           │
│    → y = approve, save to drafts/, move to next                 │
│    → n = provide feedback (WriterAgent regenerates)            │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. ACT APPROVAL                                                  │
│    └── All scenes approved? User approves act                   │
│                                                                 │
│    → y = save to results/, update story_state.yaml              │
│    → n = skip (scenes remain in drafts/)                        │
└─────────────────────────────────────────────────────────────────┘
```

## Output Structure

### Drafts (`outputs/drafts/act-N/`)

For debugging. Each scene generates:

| File | Content |
|------|---------|
| `scene-N-scene_agent.json` | `{input, output}` of setting generation |
| `scene-N-dialogue_agent.json` | `{input, output}` of dialogue generation |
| `scene-N-writer_agent.json` | `{input, output}` of final scene writing |
| `scene-N-final.json` | Final approved scene content |

### Results (`outputs/results/`)

Final approved content - one file per act.

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

1. Edit `schema/scene.yaml` or `schema/agents.yaml`
2. Create/edit `prompts/your_agent.txt`
3. Create `agents/your_agent.py`
4. Add to `orchestrator.py`

## Requirements

- Python 3.8+
- LM Studio (or any OpenAI-compatible local server)
- dotenv: `pip install python-dotenv`

## Troubleshooting

**No chapters found**: Create a `.md` file in `inputs/chapters/`

**Character profiles not loading**: Profile YAML filename must be a prefix of the character name in the chapter (e.g., `elara.yaml` matches "Elara Vance"). Parenthetical annotations like `(Protagonist)` are ignored.

**Model not responding**: Check LM Studio is running and model is loaded

**Scenes feel generic**: Improve `scene_description` in chapter outline