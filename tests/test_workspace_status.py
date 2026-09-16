import unittest
from pathlib import Path
import tempfile
import shutil
import subprocess

from api.services.file_storage import FileStorageService

class TestWorkspaceStatus(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.workspace_path = Path(self.temp_dir) / "workspace"
        self.workspace_path.mkdir(parents=True)
        self.storage = FileStorageService()
        self.storage.workspace_dir = self.workspace_path

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_non_git_workspace_clean_and_modified(self):
        # Create a sample folder and file
        folder = self.workspace_path / "chapters"
        folder.mkdir(parents=True)
        ch1 = folder / "ch1.md"
        ch1.write_text("Chapter 1 initial content", encoding="utf-8")

        # Without shadow baseline, it is unstaged_modified (new)
        status = self.storage.get_workspace_status()
        self.assertFalse(status["is_git"])
        self.assertEqual(status["statuses"].get("chapters/ch1.md"), "unstaged_modified")

        # Stage/Snapshot it (creates .margin-shadow copy)
        self.storage.stage_file("chapters/ch1.md", "Chapter 1 initial content")

        # Now it matches shadow copy -> clean
        status = self.storage.get_workspace_status()
        self.assertEqual(status["statuses"].get("chapters/ch1.md"), "clean")

        # Modify file on disk -> unstaged_modified
        ch1.write_text("Chapter 1 edited content", encoding="utf-8")
        status = self.storage.get_workspace_status()
        self.assertEqual(status["statuses"].get("chapters/ch1.md"), "unstaged_modified")

    def test_git_workspace_statuses(self):
        # Initialize a git repo in workspace
        subprocess.run(["git", "init"], cwd=str(self.workspace_path), capture_output=True)
        subprocess.run(["git", "config", "user.name", "Test"], cwd=str(self.workspace_path), capture_output=True)
        subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=str(self.workspace_path), capture_output=True)

        folder = self.workspace_path / "chapters"
        folder.mkdir(parents=True)
        ch1 = folder / "ch1.md"
        ch1.write_text("Initial text", encoding="utf-8")

        # 1. Untracked file -> unstaged_modified
        status = self.storage.get_workspace_status()
        self.assertTrue(status["is_git"])
        self.assertEqual(status["statuses"].get("chapters/ch1.md"), "unstaged_modified")

        # 2. Stage file (git add) -> staged
        subprocess.run(["git", "add", "."], cwd=str(self.workspace_path), capture_output=True)
        status = self.storage.get_workspace_status()
        self.assertEqual(status["statuses"].get("chapters/ch1.md"), "staged")

        # 3. Commit file -> clean
        subprocess.run(["git", "commit", "-m", "initial commit"], cwd=str(self.workspace_path), capture_output=True)
        status = self.storage.get_workspace_status()
        self.assertEqual(status["statuses"].get("chapters/ch1.md", "clean"), "clean")

        # 4. Modify committed file -> unstaged_modified
        ch1.write_text("Modified text", encoding="utf-8")
        status = self.storage.get_workspace_status()
        self.assertEqual(status["statuses"].get("chapters/ch1.md"), "unstaged_modified")

        # 5. Stage modified file -> staged
        subprocess.run(["git", "add", "."], cwd=str(self.workspace_path), capture_output=True)
        status = self.storage.get_workspace_status()
        self.assertEqual(status["statuses"].get("chapters/ch1.md"), "staged")

        # 6. Modify staged file again -> staged_modified
        ch1.write_text("Modified again", encoding="utf-8")
        status = self.storage.get_workspace_status()
        self.assertEqual(status["statuses"].get("chapters/ch1.md"), "staged_modified")

if __name__ == "__main__":
    unittest.main()
