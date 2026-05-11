"""
Main CLI entry point — orchestrates scene-by-scene story generation with approval steps.
"""

from state_manager import StateManager, find_latest_chapter, parse_chapter_file
from orchestrator import StoryOrchestrator
from agents.blueprint_agent import BlueprintAgent
from pathlib import Path
import json


def _save_scene_drafts(scene, agent_logs, act_number):
    output_dir = Path("outputs")
    output_dir.mkdir(exist_ok=True)
    drafts_dir = output_dir / "drafts"
    drafts_dir.mkdir(exist_ok=True)

    act_dir = drafts_dir / f"act-{act_number}"
    act_dir.mkdir(exist_ok=True)

    for agent_name, log in agent_logs.items():
        agent_file = act_dir / f"scene-{scene.scene_number}-{agent_name}.json"
        with open(agent_file, "w") as f:
            json.dump(log, f, indent=2)
        print(f"  {agent_name} log saved to: {agent_file}")

    final_file = act_dir / f"scene-{scene.scene_number}-final.json"
    final_data = {
        "scene_number": scene.scene_number,
        "arc": scene.arc,
        "full_content": scene.full_content,
        "characters_present": scene.characters_present,
        "setting": scene.setting,
        "dialogue": scene.dialogue,
    }
    with open(final_file, "w") as f:
        json.dump(final_data, f, indent=2)
    print(f"  final scene saved to: {final_file}")


def main():
    print("=" * 60)
    print("    MULTI-AGENTIC STORY GENERATION FRAMEWORK")
    print("=" * 60)
    print()

    print("Step 1: Loading Chapter")
    print("-" * 40)

    latest_chapter = find_latest_chapter()
    if not latest_chapter:
        print("Error: No chapter files found in inputs/chapters/")
        print("Please create a chapter markdown file (e.g., inputs/chapters/chapter-1.md)")
        return

    chapter_info = parse_chapter_file(latest_chapter)
    print(f"Loaded: {chapter_info['title']}")
    print(f"Characters: {', '.join(chapter_info['characters']) or 'None'}")
    print(f"File: {chapter_info['file_path']}")

    chapter_title = chapter_info["title"] or "Untitled Chapter"
    characters = chapter_info["characters"]
    background = chapter_info["background"]
    user_outline = chapter_info["outline"]

    if not user_outline.strip():
        print("Error: Chapter outline cannot be empty.")
        return

    print("\n" + "=" * 60)
    print("Step 2: Generating Blueprint")
    print("=" * 60)

    blueprint_agent = BlueprintAgent()
    state_manager = StateManager()

    try:
        blueprint = blueprint_agent.generate(
            chapter_title=chapter_title,
            user_outline=user_outline.strip(),
            characters=characters,
            background=background,
        )
    except Exception as e:
        print(f"\nError generating blueprint: {e}")
        return

    blueprint_agent.print_blueprint(blueprint)

    print("\nApprove blueprint structure? (y/n) ", end="")
    approval = input().strip().lower()

    if approval == "n":
        print("\nEnter feedback to revise the blueprint:")
        feedback = input("Feedback: ").strip()
        if feedback:
            try:
                blueprint = blueprint_agent.regenerate(blueprint, feedback, characters)
                blueprint_agent.print_blueprint(blueprint)
                print("\nApprove revised blueprint? (y/n) ", end="")
                if input().strip().lower() != "y":
                    print("Blueprint rejected. Exiting.")
                    return
            except Exception as e:
                print(f"Error regenerating blueprint: {e}")
                return
        else:
            print("No feedback provided. Exiting.")
            return
    elif approval != "y":
        print("Invalid input. Exiting.")
        return

    print("\n" + "=" * 60)
    print("Step 3: Scene Walkthrough")
    print("=" * 60)

    print(blueprint_agent.print_scene_walkthrough(blueprint))
    print("\nProceed to scene-by-scene generation? (y) ", end="")
    if input().strip().lower() != "y":
        print("Exiting.")
        return

    print("\n" + "=" * 60)
    print("Step 4: Scene-by-Scene Generation")
    print("=" * 60)

    orchestrator = StoryOrchestrator(state_manager=state_manager)
    story_state = state_manager.read_story_state()
    previous_summary = ""

    for act_index, act_blueprint in enumerate(blueprint.acts):
        print(f"\n{'='*60}")
        print(f"ACT {act_blueprint.act_number}: {act_blueprint.act_theme}")
        print(f"Scenes: {len(act_blueprint.scenes)}")
        print(f"{'='*60}")

        act_scenes = []

        for scene_index, scene_blueprint in enumerate(act_blueprint.scenes):
            print(f"\n{'─'*40}")
            print(f"Generating Scene {scene_blueprint.scene_number} of {act_blueprint.act_theme}...")
            print(f"Arc: {scene_blueprint.arc}")
            print(f"Tone: {scene_blueprint.tone}")

            try:
                scene, agent_logs = orchestrator.generate_scene_with_writing(
                    scene_blueprint=scene_blueprint,
                    act_number=act_blueprint.act_number,
                    characters=characters,
                    previous_summary=previous_summary,
                    story_state=story_state,
                )
            except Exception as e:
                print(f"Error generating scene: {e}")
                continue

            print(f"\n{'─'*40}")
            print(f"SCENE {scene.scene_number}")
            print(f"{'─'*40}")
            print(scene.full_content)

            print("\n" + "-" * 40)
            print("Approve scene? (y/n) ", end="")
            scene_approval = input().strip().lower()

            while scene_approval == "n":
                print("\nEnter feedback to regenerate scene:")
                feedback = input("Feedback: ").strip()

                if not feedback:
                    print("No feedback provided. Keeping current scene.")
                    break

                try:
                    scene, agent_logs = orchestrator.regenerate_scene_with_feedback(
                        scene_blueprint=scene_blueprint,
                        act_number=act_blueprint.act_number,
                        characters=characters,
                        previous_summary=previous_summary,
                        feedback=feedback,
                        story_state=story_state,
                        setting_draft=scene.setting,
                        dialogue_draft=scene.dialogue,
                    )
                except Exception as e:
                    print(f"Error regenerating scene: {e}")
                    break

                print(f"\n{'─'*40}")
                print(f"SCENE {scene.scene_number} (Regenerated)")
                print(f"{'─'*40}")
                print(scene.full_content)

                print("\n" + "-" * 40)
                print("Approve scene? (y/n) ", end="")
                scene_approval = input().strip().lower()

            if scene_approval == "y":
                act_scenes.append(scene)
                previous_summary = scene.full_content[:200] if scene.full_content else previous_summary
                _save_scene_drafts(scene, agent_logs, act_blueprint.act_number)
                print(f"Scene {scene.scene_number} approved.")
            else:
                print(f"Scene {scene.scene_number} skipped.")
                if act_scenes:
                    previous_summary = act_scenes[-1].full_content[:200] if act_scenes[-1].full_content else previous_summary

        if len(act_blueprint.scenes) > 1 and len(act_scenes) > 1:
            act_transition = orchestrator.transition_agent.generate_act_transition(
                current_act_summary=act_scenes[-1].full_content[:200] if act_scenes[-1].full_content else "",
                next_act_arc="continuation",
                is_cliffhanger=True,
            )
        else:
            act_transition = None

        from models import Act
        act = Act(id=str(uuid.uuid4()) if 'uuid' in dir() else str(hash(str(act_index))), act_number=act_blueprint.act_number)
        act.scenes = act_scenes
        act.act_transition = act_transition

        print(f"\n{'='*60}")
        print(f"ACT {act.act_number} COMPLETE")
        print(f"Scenes approved: {len(act_scenes)}/{len(act_blueprint.scenes)}")
        print(f"{'='*60}")

        if act_scenes:
            print("\nApprove Act and save? (y/n) ", end="")
            act_approval = input().strip().lower()

            if act_approval == "y":
                chars_in_act = []
                for scene in act.scenes:
                    for char in scene.characters_present:
                        if char not in chars_in_act:
                            chars_in_act.append(char)

                try:
                    state_manager.update_after_act_approval(
                        act_number=act.act_number,
                        scenes=act.scenes,
                        generated_content=act.full_content,
                        characters_in_act=chars_in_act,
                    )
                except Exception as e:
                    print(f"Warning: Could not update state: {e}")

                results_file = state_manager.append_to_results(
                    chapter_title=chapter_title,
                    act_number=act.act_number,
                    act_content=act.full_content,
                )

                story_state = state_manager.read_story_state()
                print(f"Act {act.act_number} saved to: {results_file}")
            else:
                print("Act skipped.")

    print("\n" + "=" * 60)
    print("STORY GENERATION COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    import uuid
    main()