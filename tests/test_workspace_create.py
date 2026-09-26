import unittest
import tempfile
import shutil
import os
import subprocess
import sys
from pathlib import Path
from unittest import mock
from fastapi.testclient import TestClient

from api.services.file_storage import FileStorageService, is_git_available, storage
from api.main import app
from api.routers import workspace as workspace_router


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
        res = self.storage.create_workspace(target_path=target, init_git=False)

        self.assertTrue(res["success"])
        self.assertEqual(res["path"], str(Path(target).resolve()))
        self.assertFalse(res["git"]["initialized"])

        target_path = Path(target)
        # Check folders
        self.assertTrue((target_path / "assets").is_dir())
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

    def test_create_workspace_with_git(self):
        git_check = is_git_available()
        target = os.path.join(self.temp_dir, "my_novel_git")
        res = self.storage.create_workspace(target_path=target, init_git=True)

        self.assertTrue(res["success"])
        target_path = Path(target)
        if git_check["available"]:
            self.assertTrue(res["git"]["initialized"])
            self.assertTrue((target_path / ".git").exists())
            self.assertTrue((target_path / ".gitignore").is_file())
        else:
            self.assertFalse(res["git"]["initialized"])

    def test_create_workspace_already_tracked_root(self):
        git_check = is_git_available()
        if not git_check["available"]:
            self.skipTest("Git not available")

        # Initialize a git repo first
        import subprocess
        repo_dir = os.path.join(self.temp_dir, "existing_repo")
        os.makedirs(repo_dir, exist_ok=True)
        subprocess.run(["git", "init"], cwd=repo_dir, capture_output=True, check=True)

        # Scaffolding with init_git=True inside existing repo should detect already_tracked
        res = self.storage.create_workspace(target_path=repo_dir, init_git=True)
        self.assertTrue(res["success"])
        self.assertTrue(res["git"]["already_tracked"])
        self.assertFalse(res["git"]["initialized"])
        self.assertIsNotNone(res["git"]["git_parent"])

    def test_create_workspace_already_tracked_nested_subdir(self):
        git_check = is_git_available()
        if not git_check["available"]:
            self.skipTest("Git not available")

        # Initialize a parent git repo
        import subprocess
        parent_repo = os.path.join(self.temp_dir, "parent_repo")
        os.makedirs(parent_repo, exist_ok=True)
        subprocess.run(["git", "init"], cwd=parent_repo, capture_output=True, check=True)

        # Target is a nested subfolder
        nested_target = os.path.join(parent_repo, "subprojects", "novel")
        res = self.storage.create_workspace(target_path=nested_target, init_git=True)
        self.assertTrue(res["success"])
        self.assertTrue(res["git"]["already_tracked"])
        self.assertFalse(res["git"]["initialized"])
        self.assertIsNotNone(res["git"]["git_parent"])
        self.assertFalse((Path(nested_target) / ".git").exists())

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

    def test_api_create_workspace_relative_path_rejected(self):
        client = TestClient(app)
        res = client.post(
            "/api/workspace/create",
            json={"path": "   ", "init_git": False}
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("Workspace path is required", res.json()["detail"])

        for rel_path in ["my_novel", "relative/path", "./sub"]:
            res = client.post(
                "/api/workspace/create",
                json={"path": rel_path, "init_git": False}
            )
            self.assertEqual(res.status_code, 400)
            self.assertIn("Workspace path must be absolute", res.json()["detail"])

    def test_create_workspace_in_temp_directory_allowed(self):
        # macOS uses /var/folders/... for temp directories.
        # Ensure create_workspace does not reject temp directories as sensitive.
        temp_workspace = os.path.join(tempfile.gettempdir(), "margin_test_temp_workspace")
        try:
            res = self.storage.create_workspace(target_path=temp_workspace, init_git=False)
            self.assertTrue(res["success"])
            self.assertTrue(Path(temp_workspace).is_dir())
        finally:
            if os.path.exists(temp_workspace):
                shutil.rmtree(temp_workspace, ignore_errors=True)

    def test_create_workspace_dot_directory_rejected(self):
        dot_target = os.path.join(self.temp_dir, ".hidden_novel")
        with self.assertRaises(ValueError) as ctx:
            self.storage.create_workspace(target_path=dot_target, init_git=False)
        self.assertIn("not allowed", str(ctx.exception))

    def test_api_create_workspace_dot_directory_rejected(self):
        client = TestClient(app)
        dot_target = os.path.join(self.temp_dir, ".hidden_novel_api")
        res = client.post(
            "/api/workspace/create",
            json={"path": dot_target, "init_git": False}
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("not allowed", res.json()["detail"])

    def test_api_create_workspace_sensitive_path_rejected(self):
        client = TestClient(app)
        sensitive = str(Path.home() / ".ssh" / "my_project")
        res = client.post(
            "/api/workspace/create",
            json={"path": sensitive, "init_git": False}
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("not allowed", res.json()["detail"])

    def test_api_create_workspace_non_empty_dir_rejected(self):
        client = TestClient(app)
        non_empty = os.path.join(self.temp_dir, "non_empty_dir")
        os.makedirs(non_empty, exist_ok=True)
        Path(non_empty, "existing.txt").write_text("hello", encoding="utf-8")

        res = client.post(
            "/api/workspace/create",
            json={"path": non_empty, "init_git": False}
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("not empty", res.json()["detail"])

    def test_create_workspace_symlink_rejected(self):
        real_dir = os.path.join(self.temp_dir, "real_dir")
        os.makedirs(real_dir, exist_ok=True)
        symlink_target = os.path.join(self.temp_dir, "symlink_dir")
        try:
            os.symlink(real_dir, symlink_target)
        except OSError:
            self.skipTest("Symlinks not supported / privileges not held on this system")

        with self.assertRaises(ValueError) as ctx:
            self.storage.create_workspace(target_path=symlink_target, init_git=False)
        self.assertIn("Symlink paths are not allowed", str(ctx.exception))

    def test_api_create_workspace_symlink_rejected(self):
        real_dir = os.path.join(self.temp_dir, "real_dir_api")
        os.makedirs(real_dir, exist_ok=True)
        symlink_target = os.path.join(self.temp_dir, "symlink_dir_api")
        try:
            os.symlink(real_dir, symlink_target)
        except OSError:
            self.skipTest("Symlinks not supported / privileges not held on this system")

        client = TestClient(app)
        res = client.post(
            "/api/workspace/create",
            json={"path": symlink_target, "init_git": False}
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("Symlink paths are not allowed", res.json()["detail"])

    def test_api_create_workspace_root_directory_rejected(self):
        client = TestClient(app)
        # Test home root
        res = client.post(
            "/api/workspace/create",
            json={"path": str(Path.home()), "init_git": False}
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("Root directories and home directory root cannot be used", res.json()["detail"])

        # Test filesystem root
        root_path = Path(self.temp_dir).anchor
        res = client.post(
            "/api/workspace/create",
            json={"path": root_path, "init_git": False}
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("Root directories and home directory root cannot be used", res.json()["detail"])

    def test_create_workspace_allows_dir_with_existing_git_or_ds_store(self):
        target = os.path.join(self.temp_dir, "workspace_with_ds_store")
        os.makedirs(target, exist_ok=True)
        Path(target, ".DS_Store").write_bytes(b"")

        res = self.storage.create_workspace(target_path=target, init_git=False)
        self.assertTrue(res["success"])
        self.assertTrue((Path(target) / "chapters" / "CHAPTERS.md").is_file())

        client = TestClient(app)
        api_target = os.path.join(self.temp_dir, "workspace_api_ds_store")
        os.makedirs(api_target, exist_ok=True)
        Path(api_target, ".DS_Store").write_bytes(b"")

        api_res = client.post(
            "/api/workspace/create",
            json={"path": api_target, "init_git": False, "set_as_active": False}
        )
        self.assertEqual(api_res.status_code, 200)
        self.assertTrue(api_res.json()["success"])

    def test_git_commit_failure_records_error(self):
        git_check = is_git_available()
        if not git_check["available"]:
            self.skipTest("Git not available")

        target = os.path.join(self.temp_dir, "commit_failure_repo")
        real_run = subprocess.run

        def fake_run(cmd, *args, **kwargs):
            if isinstance(cmd, list) and "commit" in cmd:
                return subprocess.CompletedProcess(
                    args=cmd,
                    returncode=1,
                    stdout="",
                    stderr="Author identity unknown\n",
                )
            return real_run(cmd, *args, **kwargs)

        with mock.patch("api.services.file_storage.subprocess.run", side_effect=fake_run):
            res = self.storage.create_workspace(target_path=target, init_git=True)

        self.assertTrue(res["success"])
        self.assertTrue(res["git"]["initialized"])
        self.assertFalse(res["git"]["committed"])
        self.assertIsNotNone(res["git"]["error"])
        self.assertIn("Author identity unknown", res["git"]["error"])


class TestFolderPickerFallback(unittest.TestCase):
    """Windows native failure/timeout must degrade to Tk, not return None."""

    def _completed(self, returncode=0, stdout=""):
        return subprocess.CompletedProcess(args=["picker"], returncode=returncode, stdout=stdout, stderr="")

    def test_windows_native_failure_invokes_tk_fallback(self):
        tk_path = "C:\\Users\\writer\\novel" if sys.platform == "win32" else "/tmp/tk-picked"
        calls = []

        def fake_run(cmd, **kwargs):
            calls.append(cmd)
            if len(calls) == 1:
                # Windows IFileOpenDialog fails (user cancelled / non-zero exit).
                return self._completed(returncode=1, stdout="")
            # Tk fallback succeeds.
            return self._completed(returncode=0, stdout=tk_path + "\n")

        with mock.patch.object(workspace_router.sys, "platform", "win32"), \
             mock.patch.object(workspace_router.subprocess, "run", side_effect=fake_run):
            result = workspace_router._open_folder_picker()

        self.assertEqual(result, tk_path)
        # Prove BOTH halves: native was attempted and Tk was actually attempted.
        self.assertEqual(len(calls), 2, "Tk fallback was not attempted after native failure")
        self.assertIn("filedialog.askdirectory", calls[1][2])

    def test_windows_native_timeout_invokes_tk_fallback(self):
        tk_path = "/tmp/tk-picked-after-timeout"
        calls = []

        def fake_run(cmd, **kwargs):
            calls.append(cmd)
            if len(calls) == 1:
                raise subprocess.TimeoutExpired(cmd=cmd, timeout=1)
            return self._completed(returncode=0, stdout=tk_path + "\n")

        with mock.patch.object(workspace_router.sys, "platform", "win32"), \
             mock.patch.object(workspace_router.subprocess, "run", side_effect=fake_run):
            result = workspace_router._open_folder_picker()

        self.assertEqual(result, tk_path)
        self.assertEqual(len(calls), 2, "Tk fallback was not attempted after native timeout")
        self.assertIn("filedialog.askdirectory", calls[1][2])


if __name__ == "__main__":
    unittest.main()

