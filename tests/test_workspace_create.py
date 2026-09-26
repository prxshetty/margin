import unittest
import tempfile
import shutil
import os
import subprocess
import sys
from pathlib import Path
from unittest import mock
from fastapi.testclient import TestClient

from api.services.file_storage import FileStorageService, is_git_available, _init_git_repo, storage
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
        name = "my_novel_no_git"
        target = os.path.join(self.temp_dir, name)
        res = self.storage.create_workspace(parent_path=self.temp_dir, name=name, init_git=False)

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
        res = self.storage.create_workspace(parent_path=self.temp_dir, name="my_novel_git", init_git=True)

        self.assertTrue(res["success"])
        target_path = Path(target)
        if git_check["available"]:
            self.assertTrue(res["git"]["initialized"])
            self.assertTrue((target_path / ".git").exists())
            self.assertTrue((target_path / ".gitignore").is_file())
        else:
            self.assertFalse(res["git"]["initialized"])

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
        parent = os.path.join(parent_repo, "subprojects")
        os.makedirs(parent, exist_ok=True)
        nested_target = os.path.join(parent, "novel")
        res = self.storage.create_workspace(parent_path=parent, name="novel", init_git=True)
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
            json={"parent_path": self.temp_dir, "name": "api_workspace", "init_git": False, "set_as_active": False}
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])
        self.assertTrue(os.path.exists(target))
        self.assertTrue(os.path.exists(os.path.join(target, "chapters", "CHAPTERS.md")))

    def test_api_create_workspace_parent_path_rejected(self):
        client = TestClient(app)
        res = client.post(
            "/api/workspace/create",
            json={"parent_path": "   ", "name": "novel", "init_git": False}
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("Parent workspace path is required", res.json()["detail"])

        for rel_path in ["my_novel", "relative/path", "./sub"]:
            res = client.post(
                "/api/workspace/create",
                json={"parent_path": rel_path, "name": "novel", "init_git": False}
            )
            self.assertEqual(res.status_code, 400)
            self.assertIn("Parent workspace path must be absolute", res.json()["detail"])

    def test_create_workspace_in_temp_directory_allowed(self):
        # macOS uses /var/folders/... for temp directories.
        # Ensure create_workspace does not reject temp directories as sensitive.
        temp_parent = tempfile.gettempdir()
        temp_workspace = os.path.join(temp_parent, "margin_test_temp_workspace")
        try:
            res = self.storage.create_workspace(parent_path=temp_parent, name="margin_test_temp_workspace", init_git=False)
            self.assertTrue(res["success"])
            self.assertTrue(Path(temp_workspace).is_dir())
        finally:
            if os.path.exists(temp_workspace):
                shutil.rmtree(temp_workspace, ignore_errors=True)

    def test_create_workspace_dot_directory_rejected(self):
        with self.assertRaises(ValueError) as ctx:
            self.storage.create_workspace(parent_path=self.temp_dir, name=".hidden_novel", init_git=False)
        self.assertIn("single folder name", str(ctx.exception))

    def test_create_workspace_dot_parent_rejected(self):
        dot_parent = os.path.join(self.temp_dir, ".hidden-parent")
        os.makedirs(dot_parent, exist_ok=True)
        with self.assertRaises(ValueError) as ctx:
            self.storage.create_workspace(parent_path=dot_parent, name="novel", init_git=False)
        self.assertIn("not allowed", str(ctx.exception))

    def test_api_create_workspace_dot_directory_rejected(self):
        client = TestClient(app)
        res = client.post(
            "/api/workspace/create",
            json={"parent_path": self.temp_dir, "name": ".hidden_novel_api", "init_git": False}
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("single folder name", res.json()["detail"])

    def test_api_create_workspace_sensitive_path_rejected(self):
        client = TestClient(app)
        sensitive_parent = str(Path.home() / ".ssh")
        res = client.post(
            "/api/workspace/create",
            json={"parent_path": sensitive_parent, "name": "my_project", "init_git": False}
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
            json={"parent_path": self.temp_dir, "name": "non_empty_dir", "init_git": False}
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("not empty", res.json()["detail"])

    def test_api_create_workspace_empty_dir_accepted(self):
        client = TestClient(app)
        empty = os.path.join(self.temp_dir, "empty_dir")
        os.makedirs(empty, exist_ok=True)

        res = client.post(
            "/api/workspace/create",
            json={"parent_path": self.temp_dir, "name": "empty_dir", "init_git": False, "set_as_active": False}
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["success"])
        self.assertTrue(os.path.exists(os.path.join(empty, "chapters", "CHAPTERS.md")))

    def test_api_create_workspace_name_rejected(self):
        client = TestClient(app)
        for bad_name in ["", "   ", ".", "..", "novels/first", "novels\\first", ".hidden"]:
            res = client.post(
                "/api/workspace/create",
                json={"parent_path": self.temp_dir, "name": bad_name, "init_git": False}
            )
            self.assertEqual(res.status_code, 400, bad_name)

    def test_api_create_workspace_missing_parent_rejected(self):
        client = TestClient(app)
        res = client.post(
            "/api/workspace/create",
            json={"parent_path": os.path.join(self.temp_dir, "missing-parent"), "name": "novel", "init_git": False}
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("parent directory", res.json()["detail"])

    def test_create_workspace_file_target_rejected(self):
        target_file = os.path.join(self.temp_dir, "not-a-directory")
        Path(target_file).write_text("hello", encoding="utf-8")
        with self.assertRaises(ValueError) as ctx:
            self.storage.create_workspace(parent_path=self.temp_dir, name="not-a-directory", init_git=False)
        self.assertIn("must be a directory", str(ctx.exception))

    @unittest.skipIf(os.name == "nt", "Symlink creation requires elevated permissions on Windows")
    def test_create_workspace_safe_symlinked_parent_allowed(self):
        real_parent = os.path.join(self.temp_dir, "real-parent")
        linked_parent = os.path.join(self.temp_dir, "linked-parent")
        os.makedirs(real_parent, exist_ok=True)
        os.symlink(real_parent, linked_parent, target_is_directory=True)

        res = self.storage.create_workspace(parent_path=linked_parent, name="novel", init_git=False)

        self.assertTrue(res["success"])
        self.assertEqual(res["path"], str(Path(real_parent, "novel").resolve()))

    @unittest.skipIf(os.name == "nt", "Symlink creation requires elevated permissions on Windows")
    def test_create_workspace_symlink_to_sensitive_path_rejected(self):
        sensitive_target = str(Path.home() / ".ssh")
        linked_name = "linked-sensitive"
        os.symlink(sensitive_target, os.path.join(self.temp_dir, linked_name), target_is_directory=True)

        with self.assertRaises(ValueError) as ctx:
            self.storage.create_workspace(parent_path=self.temp_dir, name=linked_name, init_git=False)
        self.assertIn("not allowed", str(ctx.exception))


class TestInitGitRepo(unittest.TestCase):
    """_init_git_repo helper: distinct outcomes for init / tracked / unavailable."""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _require_git(self):
        if not is_git_available()["available"]:
            self.skipTest("Git not available")

    def test_fresh_directory_initializes_with_gitignore(self):
        self._require_git()
        target = Path(self.temp_dir) / "fresh"
        target.mkdir()

        info = _init_git_repo(target)

        self.assertTrue(info["initialized"])
        self.assertFalse(info["already_tracked"])
        self.assertFalse(info["git_unavailable"])
        self.assertFalse(info["init_failed"])
        self.assertTrue((target / ".git").is_dir())
        self.assertTrue((target / ".gitignore").is_file())

    def test_inside_work_tree_skips_init(self):
        self._require_git()
        repo = Path(self.temp_dir) / "repo"
        repo.mkdir()
        subprocess.run(["git", "init"], cwd=repo, capture_output=True, check=True)
        nested = repo / "sub" / "novel"
        nested.mkdir(parents=True)

        info = _init_git_repo(nested)

        self.assertTrue(info["already_tracked"])
        self.assertFalse(info["initialized"])
        self.assertIsNotNone(info["git_parent"])
        self.assertFalse((nested / ".git").exists())

    def test_git_unavailable_returns_clean_failure(self):
        target = Path(self.temp_dir) / "no-git"
        target.mkdir()

        with mock.patch("api.services.file_storage.is_git_available", return_value={"available": False, "version": None}):
            info = _init_git_repo(target)

        self.assertFalse(info["initialized"])
        self.assertTrue(info["git_unavailable"])
        self.assertIsNotNone(info["error"])
        self.assertFalse((target / ".git").exists())

    def test_missing_identity_keeps_init_non_fatal(self):
        self._require_git()
        target = Path(self.temp_dir) / "no-identity"
        target.mkdir()

        real_run = subprocess.run

        def fake_run(cmd, **kwargs):
            if cmd[:2] == ["git", "commit"] or (len(cmd) > 1 and cmd[1] == "commit"):
                return subprocess.CompletedProcess(
                    args=cmd, returncode=128, stdout="",
                    stderr="Author identity unknown\n*** Please tell me who you are.\n\n"
                           "Run\n\n  git config --global user.email \"you@example.com\"\n",
                )
            return real_run(cmd, **kwargs)

        with mock.patch("api.services.file_storage.subprocess") as mock_subprocess:
            mock_subprocess.run.side_effect = fake_run
            info = _init_git_repo(target)

        self.assertTrue(info["initialized"])
        self.assertFalse(info["committed"])
        self.assertIn("identity", (info["error"] or "").lower())
        self.assertTrue((target / ".git").is_dir())

    def test_init_failure_flagged(self):
        self._require_git()
        target = Path(self.temp_dir) / "init-fail"
        target.mkdir()

        real_run = subprocess.run

        def fake_run(cmd, **kwargs):
            if len(cmd) > 1 and cmd[1] == "init":
                raise subprocess.CalledProcessError(128, cmd)
            return real_run(cmd, **kwargs)

        with mock.patch("api.services.file_storage.subprocess") as mock_subprocess:
            mock_subprocess.run.side_effect = fake_run
            info = _init_git_repo(target)

        self.assertFalse(info["initialized"])
        self.assertTrue(info["init_failed"])
        self.assertIsNotNone(info["error"])


class TestGitInitEndpoint(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_rejects_missing_directory(self):
        client = TestClient(app)
        res = client.post("/api/workspace/git-init", json={"path": os.path.join(self.temp_dir, "ghost")})
        self.assertEqual(res.status_code, 400)

    def test_rejects_relative_path(self):
        client = TestClient(app)
        res = client.post("/api/workspace/git-init", json={"path": "relative/novel"})
        self.assertEqual(res.status_code, 400)

    def test_initializes_existing_directory(self):
        if not is_git_available()["available"]:
            self.skipTest("Git not available")
        target = os.path.join(self.temp_dir, "existing_novel")
        os.makedirs(target, exist_ok=True)
        Path(target, "chapter-1.md").write_text("# Chapter 1\n", encoding="utf-8")

        client = TestClient(app)
        res = client.post("/api/workspace/git-init", json={"path": target})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])
        self.assertTrue(data["git"]["initialized"])
        self.assertTrue(Path(target, ".git").exists())
        # Pre-existing content untouched
        self.assertTrue(Path(target, "chapter-1.md").is_file())

    def test_already_tracked_reported_not_failed(self):
        if not is_git_available()["available"]:
            self.skipTest("Git not available")
        repo = os.path.join(self.temp_dir, "tracked")
        os.makedirs(repo, exist_ok=True)
        subprocess.run(["git", "init"], cwd=repo, capture_output=True, check=True)

        client = TestClient(app)
        res = client.post("/api/workspace/git-init", json={"path": repo})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["git"]["already_tracked"])


class TestWorkspaceProfiles(unittest.TestCase):
    """Remembered workspace profiles: upsert, switch, forget."""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.dir_a = os.path.join(self.temp_dir, "novel_a")
        self.dir_b = os.path.join(self.temp_dir, "novel_b")
        os.makedirs(self.dir_a, exist_ok=True)
        os.makedirs(self.dir_b, exist_ok=True)
        # Isolate global settings so profiles tests never touch the real file.
        self._settings_patcher = mock.patch.object(
            storage, "settings_path", Path(self.temp_dir) / "settings.json"
        )
        self._settings_patcher.start()
        storage.update_settings({"linked_workspace_dir": None, "workspace_profiles": []})

    def tearDown(self):
        storage.update_settings({"linked_workspace_dir": None, "workspace_profiles": []})
        self._settings_patcher.stop()
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_upsert_adds_profile_with_name(self):
        client = TestClient(app)
        res = client.post("/api/workspace/profiles", json={"path": self.dir_a, "name": "My Novel"})
        self.assertEqual(res.status_code, 200)
        profiles = res.json()["profiles"]
        self.assertEqual(len(profiles), 1)
        self.assertEqual(profiles[0]["name"], "My Novel")
        self.assertEqual(profiles[0]["path"], str(Path(self.dir_a).resolve()))
        self.assertTrue(profiles[0]["id"])

    def test_upsert_blank_name_falls_back_to_basename(self):
        client = TestClient(app)
        res = client.post("/api/workspace/profiles", json={"path": self.dir_a, "name": "  "})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["profiles"][0]["name"], "novel_a")

    def test_relink_updates_name_and_moves_to_front_without_duplicate(self):
        client = TestClient(app)
        client.post("/api/workspace/profiles", json={"path": self.dir_a, "name": "First"})
        client.post("/api/workspace/profiles", json={"path": self.dir_b, "name": "Second"})
        res = client.post("/api/workspace/profiles", json={"path": self.dir_a, "name": "Renamed"})
        profiles = res.json()["profiles"]
        self.assertEqual(len(profiles), 2)
        self.assertEqual(profiles[0]["path"], str(Path(self.dir_a).resolve()))
        self.assertEqual(profiles[0]["name"], "Renamed")

    def test_switching_updates_link_without_touching_profiles(self):
        client = TestClient(app)
        client.post("/api/workspace/profiles", json={"path": self.dir_a, "name": "A"})
        client.post("/api/workspace/profiles", json={"path": self.dir_b, "name": "B"})
        before = client.get("/api/settings/").json()["workspace_profiles"]

        res = client.patch("/api/settings/", json={"updates": {"linked_workspace_dir": self.dir_a}})
        self.assertEqual(res.status_code, 200)
        after = client.get("/api/settings/").json()

        self.assertEqual(after["linked_workspace_dir"], self.dir_a)
        # Switching is just switching — no upsert, reorder, or rename.
        self.assertEqual(after["workspace_profiles"], before)

    def test_delete_inactive_keeps_link(self):
        client = TestClient(app)
        client.post("/api/workspace/profiles", json={"path": self.dir_a, "name": "A"})
        b_id = client.post("/api/workspace/profiles", json={"path": self.dir_b, "name": "B"}).json()["profiles"][0]["id"]
        client.patch("/api/settings/", json={"updates": {"linked_workspace_dir": self.dir_a}})

        res = client.delete(f"/api/workspace/profiles/{b_id}")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(len(data["profiles"]), 1)
        self.assertEqual(data["linked_workspace_dir"], self.dir_a)
        # The folder on disk is untouched — forgetting is not deleting.
        self.assertTrue(os.path.isdir(self.dir_b))

    def test_delete_active_falls_back_to_default_and_keeps_dir(self):
        client = TestClient(app)
        a_id = client.post("/api/workspace/profiles", json={"path": self.dir_a, "name": "A"}).json()["profiles"][0]["id"]
        client.patch("/api/settings/", json={"updates": {"linked_workspace_dir": self.dir_a}})

        res = client.delete(f"/api/workspace/profiles/{a_id}")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["profiles"], [])
        self.assertIsNone(data["linked_workspace_dir"])
        self.assertTrue(os.path.isdir(self.dir_a))

    def test_delete_unknown_profile_404(self):
        client = TestClient(app)
        res = client.delete("/api/workspace/profiles/does-not-exist")
        self.assertEqual(res.status_code, 404)

    def test_upsert_rejects_missing_directory(self):
        client = TestClient(app)
        res = client.post("/api/workspace/profiles", json={"path": os.path.join(self.temp_dir, "ghost"), "name": "Ghost"})
        self.assertEqual(res.status_code, 400)

    def test_link_records_profile_atomically(self):
        client = TestClient(app)
        res = client.post("/api/workspace/link", json={"path": self.dir_a, "name": "Linked One", "init_git": False})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["linked_workspace_dir"], str(Path(self.dir_a).resolve()))
        self.assertEqual(len(data["profiles"]), 1)
        self.assertEqual(data["profiles"][0]["name"], "Linked One")
        # Persisted in one write — a refresh sees both link and record.
        stored = client.get("/api/settings/").json()
        self.assertEqual(stored["linked_workspace_dir"], str(Path(self.dir_a).resolve()))
        self.assertEqual(stored["workspace_profiles"], data["profiles"])

    def test_rapid_links_keep_all_records(self):
        client = TestClient(app)
        dir_c = os.path.join(self.temp_dir, "novel_c")
        os.makedirs(dir_c, exist_ok=True)
        for d, name in ((self.dir_a, "A"), (self.dir_b, "B"), (dir_c, "C")):
            res = client.post("/api/workspace/link", json={"path": d, "name": name, "init_git": False})
            self.assertEqual(res.status_code, 200)
        stored = client.get("/api/settings/").json()
        self.assertEqual(stored["linked_workspace_dir"], str(Path(dir_c).resolve()))
        self.assertEqual(len(stored["workspace_profiles"]), 3)

    def test_create_with_name_records_profile(self):
        client = TestClient(app)
        res = client.post(
            "/api/workspace/create",
            json={"parent_path": self.temp_dir, "name": "fresh_novel", "init_git": False, "set_as_active": True},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])
        self.assertEqual(len(data["profiles"]), 1)
        self.assertEqual(data["profiles"][0]["name"], "fresh_novel")
        stored = client.get("/api/settings/").json()
        self.assertEqual(stored["linked_workspace_dir"], data["path"])

    def test_rename_profile(self):
        client = TestClient(app)
        pid = client.post("/api/workspace/profiles", json={"path": self.dir_a, "name": "Old"}).json()["profiles"][0]["id"]
        res = client.patch(f"/api/workspace/profiles/{pid}", json={"name": "New"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["profiles"][0]["name"], "New")

    def test_rename_rejects_blank_and_unknown(self):
        client = TestClient(app)
        pid = client.post("/api/workspace/profiles", json={"path": self.dir_a, "name": "Old"}).json()["profiles"][0]["id"]
        self.assertEqual(client.patch(f"/api/workspace/profiles/{pid}", json={"name": "  "}).status_code, 400)
        self.assertEqual(client.patch("/api/workspace/profiles/nope", json={"name": "X"}).status_code, 404)

    def test_delete_mode_delete_removes_folder_and_falls_back(self):
        client = TestClient(app)
        pid = client.post("/api/workspace/profiles", json={"path": self.dir_a, "name": "Doomed"}).json()["profiles"][0]["id"]
        client.patch("/api/settings/", json={"updates": {"linked_workspace_dir": self.dir_a}})
        res = client.delete(f"/api/workspace/profiles/{pid}?mode=delete")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["dir_removed"])
        self.assertEqual(data["profiles"], [])
        self.assertIsNone(data["linked_workspace_dir"])
        self.assertFalse(os.path.exists(self.dir_a))

    def test_delete_mode_forget_keeps_folder(self):
        client = TestClient(app)
        pid = client.post("/api/workspace/profiles", json={"path": self.dir_b, "name": "Kept"}).json()["profiles"][0]["id"]
        res = client.delete(f"/api/workspace/profiles/{pid}?mode=forget")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()["dir_removed"])
        self.assertTrue(os.path.isdir(self.dir_b))

    def test_delete_rejects_bad_mode_and_sensitive_paths(self):
        client = TestClient(app)
        pid = client.post("/api/workspace/profiles", json={"path": self.dir_a, "name": "A"}).json()["profiles"][0]["id"]
        self.assertEqual(client.delete(f"/api/workspace/profiles/{pid}?mode=vaporize").status_code, 400)
        self.assertTrue(os.path.isdir(self.dir_a))

    def test_link_switch_round_trip_keeps_record(self):
        """Link → recorded → switch to sample → record intact → switch back."""
        client = TestClient(app)
        upsert = client.post("/api/workspace/profiles", json={"path": self.dir_a, "name": "A"})
        self.assertEqual(upsert.status_code, 200)
        client.patch("/api/settings/", json={"updates": {"linked_workspace_dir": self.dir_a}})

        # Switch away to the default workspace.
        client.patch("/api/settings/", json={"updates": {"linked_workspace_dir": None}})
        mid = client.get("/api/settings/").json()
        self.assertIsNone(mid["linked_workspace_dir"])
        self.assertEqual(len(mid["workspace_profiles"]), 1)
        self.assertEqual(mid["workspace_profiles"][0]["path"], str(Path(self.dir_a).resolve()))

        # Switch back — the record is still there and matches.
        client.patch("/api/settings/", json={"updates": {"linked_workspace_dir": self.dir_a}})
        after = client.get("/api/settings/").json()
        self.assertEqual(after["linked_workspace_dir"], self.dir_a)
        self.assertEqual(len(after["workspace_profiles"]), 1)


class TestWorkspaceStats(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.storage = FileStorageService(base_dir=self.temp_dir)
        # load_settings() reads the global settings file — isolate it so a
        # developer's real linked workspace can never leak into these tests.
        self._settings_patcher = mock.patch.object(
            self.storage, "settings_path", Path(self.temp_dir) / "settings.json"
        )
        self._settings_patcher.start()
        self.storage.load_settings()

    def tearDown(self):
        self._settings_patcher.stop()
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_empty_workspace_zeros(self):
        stats = self.storage.get_workspace_stats()
        self.assertEqual(stats, {"markdown_files": 0, "chat_sessions": 0, "prompt_tokens": 0, "completion_tokens": 0})

    def test_counts_exclude_styles(self):
        self.storage.create_input_file("chapters", "ch1.md", "# Ch 1")
        self.storage.create_input_file("characters", "hero.md", "# Hero")
        self.storage.create_input_file("styles", "noir.md", "## Style")
        stats = self.storage.get_workspace_stats()
        self.assertEqual(stats["markdown_files"], 2)

    def test_token_totals_count_each_entry_once(self):
        self.storage.save_simple_ai_log({
            "session_id": "s1", "mode": "chat",
            "prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150,
        })
        self.storage.save_simple_ai_log({
            "session_id": "s1", "mode": "edit_plan",
            "prompt_tokens": 200, "completion_tokens": 75, "total_tokens": 275,
        })
        self.storage.save_simple_ai_log({
            "session_id": "s2", "mode": "chat",
            "prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15,
        })
        stats = self.storage.get_workspace_stats()
        # Parts only — total_tokens never mixed in, each entry counted once.
        self.assertEqual(stats["prompt_tokens"], 310)
        self.assertEqual(stats["completion_tokens"], 130)
        # One session file == one chat session (s1 + s2 above).
        self.assertEqual(stats["chat_sessions"], 2)

    def test_stats_endpoint(self):
        self.storage.create_input_file("chapters", "ch1.md", "# Ch 1")
        with mock.patch.object(workspace_router, "storage", self.storage):
            client = TestClient(app)
            res = client.get("/api/workspace/stats")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["stats"]["markdown_files"], 1)


class TestFolderOps(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.storage = FileStorageService(base_dir=self.temp_dir)
        self._settings_patcher = mock.patch.object(
            self.storage, "settings_path", Path(self.temp_dir) / "settings.json"
        )
        self._settings_patcher.start()
        self.storage.load_settings()

    def tearDown(self):
        self._settings_patcher.stop()
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_rename_folder_moves_contents(self):
        self.storage.create_input_file("lore", "LORE.md", "# Lore")
        self.storage.create_input_file("lore", "dragons.md", "# Dragons")
        res = self.storage.rename_folder("lore", "world")
        self.assertEqual(res["path"], "world")
        ws = Path(self.temp_dir) / "sample-workspace"
        self.assertTrue((ws / "world" / "dragons.md").is_file())
        self.assertFalse((ws / "lore").exists())

    def test_rename_folder_same_name_noop(self):
        self.storage.create_input_file("lore", "LORE.md", "# Lore")
        res = self.storage.rename_folder("lore", "lore")
        self.assertEqual(res["path"], "lore")

    def test_rename_folder_rejects_bad_names(self):
        self.storage.create_input_file("lore", "LORE.md", "# Lore")
        for bad in ("", "a/b", "..", ".hidden", "has space!"):
            with self.assertRaises(ValueError, msg=bad):
                self.storage.rename_folder("lore", bad)

    def test_rename_folder_conflict(self):
        self.storage.create_input_file("aaa", "AAA.md", "# A")
        self.storage.create_input_file("bbb", "BBB.md", "# B")
        with self.assertRaises(FileExistsError):
            self.storage.rename_folder("aaa", "bbb")

    def test_rename_folder_missing(self):
        with self.assertRaises(FileNotFoundError):
            self.storage.rename_folder("ghost", "spooky")

    def test_rename_folder_blocks_outputs(self):
        with self.assertRaises(ValueError):
            self.storage.rename_folder("outputs", "out2")

    def test_delete_folder_recursive(self):
        self.storage.create_input_file("lore", "LORE.md", "# Lore")
        self.assertTrue(self.storage.delete_folder("lore"))
        ws = Path(self.temp_dir) / "sample-workspace"
        self.assertFalse((ws / "lore").exists())

    def test_delete_folder_missing(self):
        with self.assertRaises(FileNotFoundError):
            self.storage.delete_folder("ghost")

    def test_folder_endpoints(self):
        self.storage.create_input_file("lore", "LORE.md", "# Lore")
        with mock.patch.object(workspace_router, "storage", self.storage):
            client = TestClient(app)
            res = client.patch("/api/workspace/folders/lore", json={"name": "world"})
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json()["path"], "world")
            res = client.delete("/api/workspace/folders/world")
            self.assertEqual(res.status_code, 200)
            self.assertTrue(res.json()["success"])
            ws = Path(self.temp_dir) / "sample-workspace"
            self.assertFalse((ws / "world").exists())

    def test_file_rename_endpoint(self):
        # Guards the old self-recursive handler (RecursionError → 400).
        self.storage.create_input_file("chapters", "draft.md", "# Draft")
        with mock.patch.object(workspace_router, "storage", self.storage):
            client = TestClient(app)
            res = client.patch("/api/workspace/files/chapters/draft.md", json={"name": "final.md"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["path"], "chapters/final.md")

    def test_create_file_at_workspace_root(self):
        res = self.storage.create_input_file("", "notes.md", "# Notes")
        self.assertEqual(res["path"], "notes.md")
        ws = Path(self.temp_dir) / "sample-workspace"
        self.assertTrue((ws / "notes.md").is_file())

    def test_list_includes_root_files(self):
        self.storage.create_input_file("", "notes.md", "# Notes")
        self.storage.create_input_file("chapters", "ch1.md", "# Ch 1")
        paths = [f["path"] for f in self.storage.list_input_files()]
        self.assertIn("notes.md", paths)
        self.assertIn("chapters/ch1.md", paths)

    def test_stats_counts_root_files(self):
        self.storage.create_input_file("", "notes.md", "# Notes")
        stats = self.storage.get_workspace_stats()
        self.assertEqual(stats["markdown_files"], 1)


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

    def test_windows_native_cancel_does_not_invoke_tk_fallback(self):
        calls = []

        def fake_run(cmd, **kwargs):
            calls.append(cmd)
            # Dialog shown, user pressed Cancel: exit 0, no path printed.
            return self._completed(returncode=0, stdout="")

        with mock.patch.object(workspace_router.sys, "platform", "win32"), \
             mock.patch.object(workspace_router.subprocess, "run", side_effect=fake_run):
            result = workspace_router._open_folder_picker()

        self.assertIsNone(result)
        self.assertEqual(len(calls), 1, "Tk fallback opened a second dialog after Cancel")

    def test_macos_cancel_does_not_invoke_tk_fallback(self):
        calls = []

        def fake_run(cmd, **kwargs):
            calls.append(cmd)
            # osascript "User canceled": non-zero exit, empty stdout.
            return subprocess.CompletedProcess(
                args=cmd, returncode=1, stdout="", stderr="0:0: execution error: User canceled. (-128)"
            )

        with mock.patch.object(workspace_router.sys, "platform", "darwin"), \
             mock.patch.object(workspace_router.subprocess, "run", side_effect=fake_run):
            result = workspace_router._open_folder_picker()

        self.assertIsNone(result)
        self.assertEqual(len(calls), 1, "Tk fallback opened a second dialog after Cancel")

    def test_macos_success_returns_path_without_tk(self):
        calls = []

        def fake_run(cmd, **kwargs):
            calls.append(cmd)
            return self._completed(returncode=0, stdout="/Users/writer/my-novel\n")

        with mock.patch.object(workspace_router.sys, "platform", "darwin"), \
             mock.patch.object(workspace_router.subprocess, "run", side_effect=fake_run):
            result = workspace_router._open_folder_picker()

        self.assertEqual(result, "/Users/writer/my-novel")
        self.assertEqual(len(calls), 1)

    def test_macos_missing_osascript_invokes_tk_fallback(self):
        tk_path = "/tmp/tk-picked-no-osascript"
        calls = []

        def fake_run(cmd, **kwargs):
            calls.append(cmd)
            if len(calls) == 1:
                raise FileNotFoundError("osascript")
            return self._completed(returncode=0, stdout=tk_path + "\n")

        with mock.patch.object(workspace_router.sys, "platform", "darwin"), \
             mock.patch.object(workspace_router.subprocess, "run", side_effect=fake_run):
            result = workspace_router._open_folder_picker()

        self.assertEqual(result, tk_path)
        self.assertEqual(len(calls), 2, "Tk fallback was not attempted when osascript is missing")

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

