import os
import shutil
import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient

from api.main import app


class TestWorkspaceGitUndo(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.client = TestClient(app)

    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _make_repo(self):
        git_dir = Path(self.temp_dir) / ".git"
        git_dir.mkdir()
        (git_dir / "HEAD").write_text("ref: refs/heads/main\n")
        (Path(self.temp_dir) / "chapter-1.md").write_text("# Hi\n")
        return git_dir

    def test_tracked_false_for_plain_folder(self):
        res = self.client.get("/api/workspace/git-tracked", params={"path": self.temp_dir})
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()["tracked"])

    def test_tracked_true_for_own_git_dir(self):
        self._make_repo()
        res = self.client.get("/api/workspace/git-tracked", params={"path": self.temp_dir})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["tracked"])

    def test_tracked_rejects_bad_path(self):
        res = self.client.get("/api/workspace/git-tracked", params={"path": "relative/nope"})
        self.assertEqual(res.status_code, 400)
        res = self.client.get("/api/workspace/git-tracked",
                              params={"path": os.path.join(self.temp_dir, "missing")})
        self.assertEqual(res.status_code, 400)

    def test_remove_deletes_git_dir_keeps_files(self):
        self._make_repo()
        res = self.client.delete("/api/workspace/git", params={"path": self.temp_dir})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["success"])
        self.assertFalse((Path(self.temp_dir) / ".git").exists())
        self.assertTrue((Path(self.temp_dir) / "chapter-1.md").is_file())

    def test_remove_without_repo_fails_clearly(self):
        res = self.client.delete("/api/workspace/git", params={"path": self.temp_dir})
        self.assertEqual(res.status_code, 400)
        self.assertIn("No Git repository", res.json()["detail"])

    def test_remove_refuses_gitlink_file(self):
        # Submodule-style gitlink: a file, not a directory — never removed.
        (Path(self.temp_dir) / ".git").write_text("gitdir: ../elsewhere\n")
        res = self.client.delete("/api/workspace/git", params={"path": self.temp_dir})
        self.assertEqual(res.status_code, 400)
        self.assertTrue((Path(self.temp_dir) / ".git").is_file())

    def test_remove_rejects_bad_path(self):
        res = self.client.delete("/api/workspace/git", params={"path": "relative/nope"})
        self.assertEqual(res.status_code, 400)


if __name__ == "__main__":
    unittest.main()
