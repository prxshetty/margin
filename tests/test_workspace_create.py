import unittest
import tempfile
import shutil
import os
from pathlib import Path
from fastapi.testclient import TestClient

from api.services.file_storage import FileStorageService, is_git_available, storage
from api.main import app


class TestWorkspaceCreate(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.storage = FileStorageService(base_dir=".")

    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_git_availability(self):
        res = is_git_available()
        self.assertIsInstance(res, dict)
        self.assertIn("available", res)
        self.assertIn("version", res)

    def test_create_workspace_structure_no_git(self):
        target = os.path.join(self.temp_dir, "my_novel_no_git")
        res = self.storage.create_workspace(target_path=target, init_git=False, set_as_active=False)

        self.assertTrue(res["success"])
        self.assertEqual(res["path"], str(Path(target).resolve()))
        self.assertFalse(res["git"]["initialized"])

        target_path = Path(target)
        # Check folders
        self.assertTrue((target_path / "chapters").is_dir())
        self.assertTrue((target_path / "characters").is_dir())
        self.assertTrue((target_path / "styles").is_dir())
        self.assertTrue((target_path / "prompts").is_dir())
        self.assertTrue((target_path / "outputs").is_dir())

        # Check essential files
        self.assertTrue((target_path / "chapters" / "CHAPTERS.md").is_file())
        self.assertTrue((target_path / "chapters" / "chapter-1.md").is_file())
        self.assertTrue((target_path / "characters" / "CHARACTERS.md").is_file())
        self.assertTrue((target_path / "characters" / "protagonist.md").is_file())
        self.assertTrue((target_path / "styles" / "STYLES.md").is_file())
        self.assertTrue((target_path / "styles" / "general.md").is_file())
        self.assertTrue((target_path / "styles" / "cinematic.md").is_file())
        self.assertTrue((target_path / "styles" / "superman.md").is_file())
        self.assertTrue((target_path / "story_state.yaml").is_file())

        # Check git was NOT initialized
        self.assertFalse((target_path / ".git").exists())

        # Check shadow snapshots populated for non-git workspace
        shadow_dir = target_path / ".margin-shadow"
        self.assertTrue(shadow_dir.is_dir())
        self.assertTrue((shadow_dir / "chapters" / "CHAPTERS.md").is_file())
        self.assertTrue((shadow_dir / "chapters" / "chapter-1.md").is_file())

        # Verify workspace status reports clean for non-git auto-created files
        self.storage.workspace_dir = target_path
        status_info = self.storage.get_workspace_status()
        self.assertFalse(status_info["is_git"])
        for file_path, status in status_info["statuses"].items():
            self.assertEqual(status, "clean", f"Expected {file_path} to be clean in non-git workspace")

    def test_create_workspace_with_git(self):
        git_check = is_git_available()
        target = os.path.join(self.temp_dir, "my_novel_git")
        res = self.storage.create_workspace(target_path=target, init_git=True, set_as_active=False)

        self.assertTrue(res["success"])
        target_path = Path(target)
        if git_check["available"]:
            self.assertTrue(res["git"]["initialized"])
            self.assertTrue((target_path / ".git").exists())
            self.assertTrue((target_path / ".gitignore").is_file())

            # Verify files appear as unstaged_modified in git repo (not committed/staged)
            self.storage.workspace_dir = target_path
            status_info = self.storage.get_workspace_status()
            self.assertTrue(status_info["is_git"])
            self.assertIn("chapters/chapter-1.md", status_info["statuses"])
            self.assertEqual(status_info["statuses"]["chapters/chapter-1.md"], "unstaged_modified")
        else:
            self.assertFalse(res["git"]["initialized"])

    def test_api_git_status(self):
        client = TestClient(app)
        res = client.get("/api/workspace/git-status")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("available", data)

    def test_api_create_workspace(self):
        client = TestClient(app)
        target = os.path.join(self.temp_dir, "api_workspace")
        res = client.post(
            "/api/workspace/create",
            json={"path": target, "init_git": False, "set_as_active": False}
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])
        self.assertTrue(os.path.exists(target))
        self.assertTrue(os.path.exists(os.path.join(target, "chapters", "CHAPTERS.md")))


if __name__ == "__main__":
    unittest.main()
