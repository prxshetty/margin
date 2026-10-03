import unittest
import tempfile
import shutil
import os
import subprocess
from pathlib import Path

from api.services.file_storage import FileStorageService, is_git_available


class TestWorkspaceStatus(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.storage = FileStorageService(base_dir=self.temp_dir)
        # Create a non-git novel workspace
        self.non_git_workspace = Path(self.temp_dir) / "non_git_novel"
        self.storage.create_workspace(parent_path=self.temp_dir, name="non_git_novel", init_git=False)

        # Create a git novel workspace if git is available
        self.git_check = is_git_available()
        self.git_workspace = Path(self.temp_dir) / "git_novel"
        if self.git_check["available"]:
            self.storage.create_workspace(parent_path=self.temp_dir, name="git_novel", init_git=True)

    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_get_workspace_status_non_git(self):
        self.storage.workspace_dir = self.non_git_workspace
        # Initially all scaffolded files should be clean (shadow exists)
        status = self.storage.get_workspace_status()
        self.assertFalse(status["is_git"])
        self.assertEqual(status["statuses"].get("chapters/chapter-1.md"), "clean")

        # Modify chapter-1.md
        chapter_1 = self.non_git_workspace / "chapters" / "chapter-1.md"
        chapter_1.write_text("Modified text", encoding="utf-8")

        status_mod = self.storage.get_workspace_status()
        self.assertEqual(status_mod["statuses"].get("chapters/chapter-1.md"), "unstaged_modified")

        # Revert with different line endings (CRLF vs LF) - should be clean
        shadow_file = self.non_git_workspace / ".margin-shadow" / "chapters" / "chapter-1.md"
        shadow_content = shadow_file.read_text(encoding="utf-8").replace("\r\n", "\n")
        # Write CRLF version
        chapter_1.write_bytes(shadow_content.replace("\n", "\r\n").encode("utf-8"))
        status_reverted = self.storage.get_workspace_status()
        self.assertEqual(status_reverted["statuses"].get("chapters/chapter-1.md"), "clean")

    def test_get_workspace_status_git(self):
        if not self.git_check["available"]:
            self.skipTest("Git not available")

        self.storage.workspace_dir = self.git_workspace
        status = self.storage.get_workspace_status()
        self.assertTrue(status["is_git"])
        # Newly scaffolded workspace files start clean (initial commit created with fallback author)
        self.assertEqual(status["statuses"].get("chapters/chapter-1.md"), "clean")

        # Modify chapter-1.md
        chapter_1 = self.git_workspace / "chapters" / "chapter-1.md"
        orig_text = chapter_1.read_text(encoding="utf-8")
        chapter_1.write_text("Modified text in git", encoding="utf-8")

        status_mod = self.storage.get_workspace_status()
        self.assertEqual(status_mod["statuses"].get("chapters/chapter-1.md"), "unstaged_modified")

        # Revert text with differing trailing newline / CRLF - modification flag should clear back to clean
        chapter_1.write_text(orig_text.strip(), encoding="utf-8")
        status_reverted = self.storage.get_workspace_status()
        self.assertEqual(status_reverted["statuses"].get("chapters/chapter-1.md"), "clean")

    def test_git_rename_file(self):
        if not self.git_check["available"]:
            self.skipTest("Git not available")

        self.storage.workspace_dir = self.git_workspace
        res = self.storage.rename_input_file("chapters/chapter-1.md", "prologue.md")
        self.assertEqual(res["path"], "chapters/prologue.md")

        status = self.storage.get_workspace_status()
        self.assertEqual(status["statuses"].get("chapters/prologue.md"), "staged_renamed")

    def test_git_delete_and_restore_file(self):
        if not self.git_check["available"]:
            self.skipTest("Git not available")

        self.storage.workspace_dir = self.git_workspace
        protagonist = self.git_workspace / "characters" / "protagonist.md"
        self.assertTrue(protagonist.exists())

        # Delete file via delete_input_file (uses git rm)
        self.storage.delete_input_file("characters/protagonist.md")
        self.assertFalse(protagonist.exists())

        # Status should report staged_deleted
        status = self.storage.get_workspace_status()
        self.assertEqual(status["statuses"].get("characters/protagonist.md"), "staged_deleted")

        # list_input_files should include the deleted file marked with deleted=True
        files = self.storage.list_input_files()
        deleted_entry = next((f for f in files if f["path"] == "characters/protagonist.md"), None)
        self.assertIsNotNone(deleted_entry)
        self.assertTrue(deleted_entry.get("deleted"))

        # read_input_file should return baseline content even when deleted on disk
        content = self.storage.read_input_file("characters/protagonist.md")
        self.assertIn("Protagonist", content)

        # restore_file should recover the file from HEAD
        restore_res = self.storage.restore_file("characters/protagonist.md")
        self.assertTrue(restore_res["success"])
        self.assertTrue(protagonist.exists())

        # Status should return to clean
        status_after = self.storage.get_workspace_status()
        self.assertEqual(status_after["statuses"].get("characters/protagonist.md"), "clean")

    def test_non_git_delete_and_restore_file(self):
        self.storage.workspace_dir = self.non_git_workspace
        protagonist = self.non_git_workspace / "characters" / "protagonist.md"
        self.assertTrue(protagonist.exists())

        # Delete file via delete_input_file
        self.storage.delete_input_file("characters/protagonist.md")
        self.assertFalse(protagonist.exists())

        # Status should report unstaged_deleted
        status = self.storage.get_workspace_status()
        self.assertEqual(status["statuses"].get("characters/protagonist.md"), "unstaged_deleted")

        # list_input_files should include the deleted file marked with deleted=True
        files = self.storage.list_input_files()
        deleted_entry = next((f for f in files if f["path"] == "characters/protagonist.md"), None)
        self.assertIsNotNone(deleted_entry)
        self.assertTrue(deleted_entry.get("deleted"))

        # read_input_file should return shadow content even when deleted on disk
        content = self.storage.read_input_file("characters/protagonist.md")
        self.assertIn("Protagonist", content)

        # restore_file should recover the file from .margin-shadow
        restore_res = self.storage.restore_file("characters/protagonist.md")
        self.assertTrue(restore_res["success"])
        self.assertTrue(protagonist.exists())

        # Status should return to clean
        status_after = self.storage.get_workspace_status()
        self.assertEqual(status_after["statuses"].get("characters/protagonist.md"), "clean")

    def test_get_diff_base_non_git(self):
        self.storage.workspace_dir = self.non_git_workspace
        chapter_1 = self.non_git_workspace / "chapters" / "chapter-1.md"
        orig_text = chapter_1.read_text(encoding="utf-8")

        # Modify on disk
        chapter_1.write_text("Changed text", encoding="utf-8")

        diff_base = self.storage.get_diff_base("chapters/chapter-1.md")
        self.assertFalse(diff_base["is_git"])
        self.assertTrue(diff_base["has_base"])
        self.assertEqual(diff_base["base_content"], orig_text)

    def test_get_diff_base_git(self):
        if not self.git_check["available"]:
            self.skipTest("Git not available")

        self.storage.workspace_dir = self.git_workspace
        chapter_1 = self.git_workspace / "chapters" / "chapter-1.md"
        orig_text = chapter_1.read_text(encoding="utf-8")

        chapter_1.write_text("Changed text", encoding="utf-8")

        diff_base = self.storage.get_diff_base("chapters/chapter-1.md")
        self.assertTrue(diff_base["is_git"])
        self.assertTrue(diff_base["has_base"])
        self.assertEqual(diff_base["base_content"], orig_text)

    def test_stage_file_non_git(self):
        self.storage.workspace_dir = self.non_git_workspace
        chapter_1 = self.non_git_workspace / "chapters" / "chapter-1.md"
        new_text = "New snapshot content"
        chapter_1.write_text(new_text, encoding="utf-8")

        res = self.storage.stage_file("chapters/chapter-1.md")
        self.assertTrue(res["success"])
        self.assertFalse(res["is_git"])
        self.assertEqual(res["base_content"], new_text)

        # Now status should be clean again
        status = self.storage.get_workspace_status()
        self.assertEqual(status["statuses"].get("chapters/chapter-1.md"), "clean")

    def test_stage_file_git(self):
        if not self.git_check["available"]:
            self.skipTest("Git not available")

        self.storage.workspace_dir = self.git_workspace
        chapter_1 = self.git_workspace / "chapters" / "chapter-1.md"
        new_text = "New staged content in git"
        chapter_1.write_text(new_text, encoding="utf-8")

        res = self.storage.stage_file("chapters/chapter-1.md")
        self.assertTrue(res["success"])
        self.assertTrue(res["is_git"])
        self.assertEqual(res["base_content"], new_text)

        status = self.storage.get_workspace_status()
        self.assertEqual(status["statuses"].get("chapters/chapter-1.md"), "staged")

    def test_restore_file_non_git(self):
        self.storage.workspace_dir = self.non_git_workspace
        chapter_1 = self.non_git_workspace / "chapters" / "chapter-1.md"
        orig_text = chapter_1.read_text(encoding="utf-8")

        chapter_1.write_text("Discard this edit", encoding="utf-8")
        res = self.storage.restore_file("chapters/chapter-1.md")
        self.assertTrue(res["success"])
        self.assertEqual(res["restored_content"], orig_text)
        self.assertEqual(chapter_1.read_text(encoding="utf-8"), orig_text)

    def test_restore_file_git(self):
        if not self.git_check["available"]:
            self.skipTest("Git not available")

        self.storage.workspace_dir = self.git_workspace
        chapter_1 = self.git_workspace / "chapters" / "chapter-1.md"
        orig_text = chapter_1.read_text(encoding="utf-8")

        chapter_1.write_text("Discard this git edit", encoding="utf-8")
        res = self.storage.restore_file("chapters/chapter-1.md")
        self.assertTrue(res["success"])
        self.assertEqual(res["restored_content"], orig_text)
        self.assertEqual(chapter_1.read_text(encoding="utf-8"), orig_text)

    def test_stage_and_restore_file_git(self):
        if not self.git_check["available"]:
            self.skipTest("Git not available")

        self.storage.workspace_dir = self.git_workspace
        chapter_1 = self.git_workspace / "chapters" / "chapter-1.md"
        orig_text = chapter_1.read_text(encoding="utf-8")

        # Stage a modification
        self.storage.stage_file("chapters/chapter-1.md", "Staged changes in git")
        status_after_stage = self.storage.get_workspace_status()
        self.assertEqual(status_after_stage["statuses"].get("chapters/chapter-1.md"), "staged")

        # Restore file to HEAD
        res = self.storage.restore_file("chapters/chapter-1.md")
        self.assertTrue(res["success"])
        self.assertEqual(res["restored_content"], orig_text)
        self.assertEqual(chapter_1.read_text(encoding="utf-8"), orig_text)

        status_after_restore = self.storage.get_workspace_status()
        self.assertEqual(status_after_restore["statuses"].get("chapters/chapter-1.md"), "clean")

    def test_git_rename_and_restore_file(self):
        if not self.git_check["available"]:
            self.skipTest("Git not available")

        self.storage.workspace_dir = self.git_workspace
        orig_protagonist = self.git_workspace / "characters" / "protagonist.md"
        orig_text = orig_protagonist.read_text(encoding="utf-8")

        # 1. Rename characters/protagonist.md -> hero.md
        self.storage.rename_input_file("characters/protagonist.md", "hero.md")
        hero_file = self.git_workspace / "characters" / "hero.md"
        self.assertTrue(hero_file.exists())
        self.assertFalse(orig_protagonist.exists())

        # 2. Modify hero.md
        hero_file.write_text("Modified hero content", encoding="utf-8")
        status = self.storage.get_workspace_status()
        self.assertEqual(status["statuses"].get("characters/hero.md"), "staged_renamed_modified")

        # 3. Restore characters/hero.md
        res = self.storage.restore_file("characters/hero.md")
        self.assertTrue(res["success"])
        self.assertEqual(res["restored_path"], "characters/protagonist.md")
        self.assertEqual(res["restored_content"], orig_text)

        # 4. Verify original file is back, new file is gone, manifest has original entry
        self.assertTrue(orig_protagonist.exists())
        self.assertEqual(orig_protagonist.read_text(encoding="utf-8"), orig_text)
        self.assertFalse(hero_file.exists())

        manifest = self.git_workspace / "characters" / "CHARACTERS.md"
        manifest_text = manifest.read_text(encoding="utf-8")
        self.assertIn("protagonist.md", manifest_text)
        self.assertNotIn("hero.md", manifest_text)

        # 5. Verify workspace status is clean
        status_after = self.storage.get_workspace_status()
        self.assertEqual(status_after["statuses"].get("characters/protagonist.md"), "clean")
        self.assertNotIn("characters/hero.md", status_after["statuses"])

    def test_manifest_rename_non_git(self):
        self.storage.workspace_dir = self.non_git_workspace
        self.storage.rename_input_file("characters/protagonist.md", "hero.md")
        manifest = self.non_git_workspace / "characters" / "CHARACTERS.md"
        manifest_text = manifest.read_text(encoding="utf-8")
        self.assertIn("hero.md", manifest_text)
        self.assertNotIn("protagonist.md", manifest_text)

    def test_manifest_rename_git(self):
        if not self.git_check["available"]:
            self.skipTest("Git not available")

        self.storage.workspace_dir = self.git_workspace
        self.storage.rename_input_file("characters/protagonist.md", "hero.md")
        manifest = self.git_workspace / "characters" / "CHARACTERS.md"
        manifest_text = manifest.read_text(encoding="utf-8")
        self.assertIn("hero.md", manifest_text)
        self.assertNotIn("protagonist.md", manifest_text)

    def test_manifest_delete_non_git(self):
        self.storage.workspace_dir = self.non_git_workspace
        self.storage.delete_input_file("characters/protagonist.md")
        manifest = self.non_git_workspace / "characters" / "CHARACTERS.md"
        manifest_text = manifest.read_text(encoding="utf-8")
        self.assertNotIn("protagonist.md", manifest_text)

    def test_manifest_delete_git(self):
        if not self.git_check["available"]:
            self.skipTest("Git not available")

        self.storage.workspace_dir = self.git_workspace
        self.storage.delete_input_file("characters/protagonist.md")
        manifest = self.git_workspace / "characters" / "CHARACTERS.md"
        manifest_text = manifest.read_text(encoding="utf-8")
        self.assertNotIn("protagonist.md", manifest_text)

    def test_manifest_selective_restore_git(self):
        if not self.git_check["available"]:
            self.skipTest("Git not available")

        self.storage.workspace_dir = self.git_workspace
        # Add a second character and commit it
        antagonist = self.git_workspace / "characters" / "antagonist.md"
        antagonist.write_text("# Antagonist", encoding="utf-8")
        manifest = self.git_workspace / "characters" / "CHARACTERS.md"
        manifest_orig = (
            "- protagonist.md — Protagonist: Main character overview and motivations.\n"
            "- antagonist.md — Antagonist: Primary rival.\n"
        )
        manifest.write_text(manifest_orig, encoding="utf-8")
        subprocess.run(["git", "add", "-A"], cwd=str(self.git_workspace), capture_output=True)
        subprocess.run(["git", "commit", "-m", "Add antagonist"], cwd=str(self.git_workspace), capture_output=True)

        # Rename protagonist -> hero.md (updates manifest to hero.md)
        self.storage.rename_input_file("characters/protagonist.md", "hero.md")
        # Delete antagonist.md (removes antagonist.md from manifest)
        self.storage.delete_input_file("characters/antagonist.md")

        manifest_curr = manifest.read_text(encoding="utf-8")
        self.assertIn("hero.md", manifest_curr)
        self.assertNotIn("antagonist.md", manifest_curr)

        # Restore antagonist.md
        self.storage.restore_file("characters/antagonist.md")

        # Verify antagonist.md is back, and hero.md's rename in manifest is NOT overwritten!
        manifest_after = manifest.read_text(encoding="utf-8")
        self.assertIn("antagonist.md", manifest_after)
        self.assertIn("hero.md", manifest_after)
        self.assertNotIn("protagonist.md", manifest_after)

    def test_manifest_selective_restore_non_git(self):
        self.storage.workspace_dir = self.non_git_workspace
        # Add a second character and snapshot it
        self.storage.create_input_file("characters", "antagonist.md", "# Antagonist")
        manifest = self.non_git_workspace / "characters" / "CHARACTERS.md"
        manifest_orig = (
            "- protagonist.md — Protagonist: Main character overview and motivations.\n"
            "- antagonist.md — Antagonist: Primary rival.\n"
        )
        manifest.write_text(manifest_orig, encoding="utf-8")
        self.storage.stage_file("characters/CHARACTERS.md", manifest_orig)
        self.storage.stage_file("characters/antagonist.md", "# Antagonist")

        # Rename protagonist -> hero.md
        self.storage.rename_input_file("characters/protagonist.md", "hero.md")
        # Delete antagonist.md
        self.storage.delete_input_file("characters/antagonist.md")

        manifest_curr = manifest.read_text(encoding="utf-8")
        self.assertIn("hero.md", manifest_curr)
        self.assertNotIn("antagonist.md", manifest_curr)

        # Restore antagonist.md
        self.storage.restore_file("characters/antagonist.md")

        # Verify antagonist.md is back, and hero.md is NOT overwritten!
        manifest_after = manifest.read_text(encoding="utf-8")
        self.assertIn("antagonist.md", manifest_after)
        self.assertIn("hero.md", manifest_after)
        self.assertNotIn("protagonist.md", manifest_after)

    def test_delete_renamed_staged_file_manifest_git(self):
        if not self.git_check["available"]:
            self.skipTest("Git not available")

        self.storage.workspace_dir = self.git_workspace
        # Rename protagonist.md -> hero.md
        self.storage.rename_input_file("characters/protagonist.md", "hero.md")
        manifest = self.git_workspace / "characters" / "CHARACTERS.md"
        self.assertIn("hero.md", manifest.read_text(encoding="utf-8"))

        # Delete the renamed file hero.md
        self.storage.delete_input_file("characters/hero.md")
        manifest_after = manifest.read_text(encoding="utf-8")
        self.assertNotIn("hero.md", manifest_after)
        self.assertNotIn("protagonist.md", manifest_after)

    def test_missing_manifest_entry_lifecycle_git(self):
        if not self.git_check["available"]:
            self.skipTest("Git not available")

        self.storage.workspace_dir = self.git_workspace
        # Create a manual file that is NOT added to CHARACTERS.md
        manual_file = self.git_workspace / "characters" / "manual_hero.md"
        manual_file.write_text("# Manual Hero", encoding="utf-8")
        subprocess.run(["git", "add", "-A"], cwd=str(self.git_workspace), check=True)
        subprocess.run(["git", "commit", "-m", "add manual hero"], cwd=str(self.git_workspace), check=True)

        manifest = self.git_workspace / "characters" / "CHARACTERS.md"
        manifest_orig = manifest.read_text(encoding="utf-8")
        self.assertNotIn("manual_hero", manifest_orig)

        # 1. Listing should work cleanly and return empty description
        files = self.storage.list_input_files()
        f_entry = next((f for f in files if f["path"] == "characters/manual_hero.md"), None)
        self.assertIsNotNone(f_entry)
        self.assertEqual(f_entry["description"], "")

        # 2. Renaming should succeed and leave manifest untouched
        renamed = self.storage.rename_input_file("characters/manual_hero.md", "renamed_hero.md")
        self.assertEqual(renamed["path"], "characters/renamed_hero.md")
        self.assertEqual(manifest.read_text(encoding="utf-8"), manifest_orig)

        # Rename back
        self.storage.rename_input_file("characters/renamed_hero.md", "manual_hero.md")
        self.assertEqual(manifest.read_text(encoding="utf-8"), manifest_orig)

        # 3. Deleting should succeed and leave manifest untouched
        self.storage.delete_input_file("characters/manual_hero.md")
        self.assertFalse((self.git_workspace / "characters" / "manual_hero.md").exists())
        self.assertEqual(manifest.read_text(encoding="utf-8"), manifest_orig)

        # 4. Restoring should succeed and recover file without breaking manifest
        restored = self.storage.restore_file("characters/manual_hero.md")
        self.assertTrue(restored["success"])
        self.assertTrue((self.git_workspace / "characters" / "manual_hero.md").exists())
        self.assertEqual(manifest.read_text(encoding="utf-8"), manifest_orig)

    def test_missing_manifest_entry_lifecycle_non_git(self):
        self.storage.workspace_dir = self.non_git_workspace
        # Create a manual file with snapshot but NOT in CHARACTERS.md
        manual_file = self.non_git_workspace / "characters" / "manual_hero.md"
        manual_file.write_text("# Manual Hero Non-Git", encoding="utf-8")
        self.storage.stage_file("characters/manual_hero.md")

        manifest = self.non_git_workspace / "characters" / "CHARACTERS.md"
        manifest_orig = manifest.read_text(encoding="utf-8")
        self.assertNotIn("manual_hero", manifest_orig)

        # 1. Listing should work cleanly and return empty description
        files = self.storage.list_input_files()
        f_entry = next((f for f in files if f["path"] == "characters/manual_hero.md"), None)
        self.assertIsNotNone(f_entry)
        self.assertEqual(f_entry["description"], "")

        # 2. Renaming should succeed and leave manifest untouched
        renamed = self.storage.rename_input_file("characters/manual_hero.md", "renamed_hero.md")
        self.assertEqual(renamed["path"], "characters/renamed_hero.md")
        self.assertEqual(manifest.read_text(encoding="utf-8"), manifest_orig)

        # 3. Deleting should succeed and leave manifest untouched
        self.storage.delete_input_file("characters/renamed_hero.md")
        self.assertFalse((self.non_git_workspace / "characters" / "renamed_hero.md").exists())
        self.assertEqual(manifest.read_text(encoding="utf-8"), manifest_orig)

        # 4. Restoring should succeed and recover file without breaking manifest
        restored = self.storage.restore_file("characters/renamed_hero.md")
        self.assertTrue(restored["success"])
        self.assertTrue((self.non_git_workspace / "characters" / "renamed_hero.md").exists())
        self.assertEqual(manifest.read_text(encoding="utf-8"), manifest_orig)

    def test_finalize_deletions_non_git(self):
        self.storage.workspace_dir = self.non_git_workspace
        # 1. Delete protagonist.md in non-git workspace
        self.storage.delete_input_file("characters/protagonist.md")
        self.assertFalse((self.non_git_workspace / "characters" / "protagonist.md").exists())

        # Shadow file still exists before finalize
        shadow_file = self.non_git_workspace / ".margin-shadow" / "characters" / "protagonist.md"
        self.assertTrue(shadow_file.exists())

        # File is listed as deleted=True
        files_before = self.storage.list_input_files()
        self.assertTrue(any(f["path"] == "characters/protagonist.md" and f.get("deleted") for f in files_before))

        # 2. Finalize deletions
        res = self.storage.finalize_deletions()
        self.assertTrue(res["success"])
        self.assertFalse(res["is_git"])
        self.assertIn("characters/protagonist.md", res["finalized_files"])
        self.assertFalse(shadow_file.exists())

        # 3. File is now completely gone from list_input_files
        files_after = self.storage.list_input_files()
        self.assertFalse(any(f["path"] == "characters/protagonist.md" for f in files_after))

    def test_finalize_deletions_with_renamed_file_clears_manifest_m_flag_non_git(self):
        self.storage.workspace_dir = self.non_git_workspace
        # Add a second character and snapshot it
        self.storage.create_input_file("characters", "antagonist.md", "# Antagonist")
        manifest = self.non_git_workspace / "characters" / "CHARACTERS.md"
        manifest_orig = (
            "- protagonist.md — Protagonist: Main character overview.\n"
            "- antagonist.md — Antagonist: Primary rival.\n"
        )
        manifest.write_text(manifest_orig, encoding="utf-8")
        self.storage.stage_file("characters/CHARACTERS.md", manifest_orig)
        self.storage.stage_file("characters/antagonist.md", "# Antagonist")

        # 1. Rename protagonist.md -> hero.md
        self.storage.rename_input_file("characters/protagonist.md", "hero.md")
        # Manifest immediately reflects renamed file and should be clean because shadow manifest was also updated
        status1 = self.storage.get_workspace_status()
        self.assertEqual(status1["statuses"].get("characters/CHARACTERS.md"), "clean")

        # 2. Delete antagonist.md
        self.storage.delete_input_file("characters/antagonist.md")
        # Manifest is now modified (antagonist removed from working manifest, but in shadow manifest for restore)
        status2 = self.storage.get_workspace_status()
        self.assertEqual(status2["statuses"].get("characters/CHARACTERS.md"), "unstaged_modified")

        # 3. Finalize deletions
        res = self.storage.finalize_deletions()
        self.assertTrue(res["success"])
        self.assertIn("characters/antagonist.md", res["finalized_files"])

        # 4. Manifest M flag should now be cleared back to clean!
        status3 = self.storage.get_workspace_status()
        self.assertEqual(status3["statuses"].get("characters/CHARACTERS.md"), "clean")

    def test_modify_characters_manifest_shows_modified_indicator_non_git(self):
        self.storage.workspace_dir = self.non_git_workspace
        # Initial status is clean
        status_init = self.storage.get_workspace_status()
        self.assertEqual(status_init["statuses"].get("characters/CHARACTERS.md"), "clean")

        # Directly modify characters/CHARACTERS.md (e.g. edit notes, descriptions, or add content)
        manifest = self.non_git_workspace / "characters" / "CHARACTERS.md"
        manifest.write_text(
            "- protagonist.md — Protagonist: Main character overview and motivations.\n"
            "## Extra character notes\n"
            "- mentor.md — The wise mentor\n",
            encoding="utf-8"
        )

        status_mod = self.storage.get_workspace_status()
        self.assertEqual(status_mod["statuses"].get("characters/CHARACTERS.md"), "unstaged_modified")

        # Snapshot / stage the manifest file
        self.storage.stage_file("characters/CHARACTERS.md")
        status_staged = self.storage.get_workspace_status()
        self.assertEqual(status_staged["statuses"].get("characters/CHARACTERS.md"), "clean")

    def test_modify_characters_manifest_shows_modified_indicator_git(self):
        if not self.git_check["available"]:
            self.skipTest("Git not available")

        self.storage.workspace_dir = self.git_workspace
        status_init = self.storage.get_workspace_status()
        self.assertEqual(status_init["statuses"].get("characters/CHARACTERS.md"), "clean")

        manifest = self.git_workspace / "characters" / "CHARACTERS.md"
        manifest.write_text(
            "- protagonist.md — Protagonist: Main character overview and motivations.\n"
            "## Extra character notes\n"
            "- mentor.md — The wise mentor\n",
            encoding="utf-8"
        )

        status_mod = self.storage.get_workspace_status()
        self.assertEqual(status_mod["statuses"].get("characters/CHARACTERS.md"), "unstaged_modified")

        self.storage.stage_file("characters/CHARACTERS.md")
        status_staged = self.storage.get_workspace_status()
        self.assertEqual(status_staged["statuses"].get("characters/CHARACTERS.md"), "staged")


if __name__ == "__main__":
    unittest.main()

