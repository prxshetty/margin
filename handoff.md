# Handoff: SLM Writing Engine Architecture

This handoff file documents our active architecture shifts and next steps.

## Active Architecture Shifts
We have successfully implemented two major architectural updates to optimize the writing engine for Small Language Models (SLMs):

1. **Sequential Narration-First Flow (Phase 1):**
   * Pre-generates narration with placeholder brackets (e.g., `[Dialogue: Character - subtext]`).
   * The Dialogue Agent subsequently reads the prose and replaces the placeholders inline, ensuring zero formatting leakage and perfect pacing.
   * Completed and tested successfully on the experimental branch: `experiment/sequential-narration-flow`.

2. **Unified Posture Model & Scene-by-Scene Updates (Phase 2):**
   * Replaced static abstract character goals inside prompt contexts with a dynamic **Unified Posture Model** in `inputs/story_state.yaml`.
   * Characters have an internal directed posture (`self`) and external postures toward physically present scene partners, combining an `emotional` state and a rolling queue of `recent_events` (max 3).
   * **Scene-by-Scene Extraction:** Character postures are now dynamically updated by `StateManager.update_after_scene_approval()` immediately after the user approves each scene in the CLI. This completely solves context propagation latency, feeding real-time emotional tension directly into the next scene's generation.
   * Completely verified and validated in an isolated test environment.

## Current Branch & State
* **Branch:** `experiment/sequential-narration-flow`
* All tests are passing cleanly and the CLI (`python3 main.py`) compiles and runs seamlessly.
