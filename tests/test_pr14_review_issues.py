"""Reproduction tests for the blocking issues raised in the PR #14 review
(https://github.com/prxshetty/margin/pull/14#issuecomment-6254067572).

Every test asserts the *post-fix* contract, so on the unfixed branch each one
fails and demonstrates the reported bug. Test classes are numbered to match the
review items:

  1. Unknown restore mode falls through to `committed`; caps not enforced
  2. Partial status map returned as a 200 success
  3. Rename restore is non-atomic / middle-step return codes unchecked
  4. Renaming an untracked file always fails
  5. `.margin-shadow/` (and `.git/`) leak into the git status map
  6. Staged-rename manifest handling undoes itself
  7. Link-time git init runs `git add .` + auto-commit on user directories

All workspaces are hermetic temp directories; the real user settings file is
never touched (`/api/workspace/link` is deliberately not called because it
persists `linked_workspace_dir`; `/git-init` shares the same `_init_git_repo`).
"""
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.services import git_service
from api.services.file_storage import storage, _write_text_lf

client = TestClient(app)

# Captured before any test monkeypatches subprocess.run.
_REAL_RUN = subprocess.run

CH1 = "chapters/chapter-1.md"
CH1_RENAMED = "chapters/chapter-one.md"
CH2 = "chapters/chapter-2.md"
MANIFEST = "chapters/CHAPTERS.md"

CH1_HEAD = "# Chapter 1\n\nInitial committed text.\n"
CH2_HEAD = "# Chapter 2\n\nSecond chapter text.\n"
MANIFEST_HEAD = (
    "- chapter-1.md — First chapter\n"
    "- chapter-2.md — Second chapter\n"
)



# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _git(ws: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return _REAL_RUN(
        ["git", *args],
        cwd=str(ws),
        check=check,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=15,
    )


def _rmtree(path: str) -> None:
    """rmtree that copes with read-only git object files on Windows."""
    def _on_error(func, p, _exc):
        try:
            os.chmod(p, stat.S_IWRITE)
            func(p)
        except OSError:
            pass

    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=_on_error)
    else:
        shutil.rmtree(path, onerror=_on_error)


def _read(ws: Path, rel: str):
    p = ws / rel
    return p.read_text(encoding="utf-8") if p.exists() else None


def _index_blob(ws: Path, rel: str):
    res = _git(ws, "show", f":{rel}", check=False)
    return res.stdout if res.returncode == 0 else None


def _in_index(ws: Path, rel: str) -> bool:
    return bool(_git(ws, "ls-files", "--", rel).stdout.strip())


def _is_git_rm(args) -> bool:
    return isinstance(args, (list, tuple)) and len(args) >= 2 and Path(str(args[0])).stem == "git" and args[1] == "rm"


def _make_git_workspace() -> Path:
    td = tempfile.mkdtemp(prefix="margin-pr14-")
    ws = Path(td).resolve()
    _git(ws, "init")
    _git(ws, "config", "user.name", "Test Author")
    _git(ws, "config", "user.email", "author@test.com")
    _git(ws, "config", "core.autocrlf", "false")
    (ws / "chapters").mkdir()
    _write_text_lf(ws / CH1, CH1_HEAD)
    _write_text_lf(ws / CH2, CH2_HEAD)
    _write_text_lf(ws / MANIFEST, MANIFEST_HEAD)
    _git(ws, "add", "-A")
    _git(ws, "commit", "-m", "Initial commit")
    return ws


@pytest.fixture
def git_workspace():
    ws = _make_git_workspace()
    prev = storage.workspace_dir
    storage.workspace_dir = ws
    try:
        yield ws
    finally:
        storage.workspace_dir = prev
        _rmtree(str(ws))


@pytest.fixture
def shadow_workspace():
    """Non-git workspace with a shadow baseline for chapter-1."""
    ws = Path(tempfile.mkdtemp(prefix="margin-pr14-shadow-")).resolve()
    (ws / "chapters").mkdir()
    _write_text_lf(ws / CH1, CH1_HEAD + "Unsaved idea.\n")
    _write_text_lf(ws / ".margin-shadow" / CH1, CH1_HEAD)
    prev = storage.workspace_dir
    storage.workspace_dir = ws
    try:
        yield ws
    finally:
        storage.workspace_dir = prev
        _rmtree(str(ws))


# ---------------------------------------------------------------------------
# 1. Unknown mode falls through to committed + no server-side enforcement
# ---------------------------------------------------------------------------

STAGED = "# Chapter 1\n\nStaged text.\n"
WORKTREE = "# Chapter 1\n\nStaged text.\nUnstaged edit.\n"


def _stage_then_edit(ws: Path) -> None:
    _write_text_lf(ws / CH1, STAGED)
    _git(ws, "add", "--", CH1)
    _write_text_lf(ws / CH1, WORKTREE)


class TestIssue1RestoreModeValidation:
    @pytest.mark.parametrize("bad_mode", ["commited", "reset-hard", "worktree"])
    def test_unknown_mode_returns_400_and_changes_nothing(self, git_workspace, bad_mode):
        _stage_then_edit(git_workspace)

        res = client.post("/api/workspace/restore-diff-base", json={"path": CH1, "mode": bad_mode})

        assert res.status_code == 400, f"mode={bad_mode!r} must be rejected, got {res.status_code}"
        assert _read(git_workspace, CH1) == WORKTREE, "worktree edits were wiped"
        assert _index_blob(git_workspace, CH1) == STAGED, "staged changes were wiped"

    def test_service_raises_value_error_for_unknown_mode(self, git_workspace):
        _stage_then_edit(git_workspace)
        with pytest.raises(ValueError):
            git_service.restore_git_file(git_workspace, CH1, mode="commited")
        assert _read(git_workspace, CH1) == WORKTREE

    def test_worktree_only_rejected_when_capability_false(self, git_workspace):
        # Unstaged-only edit: get_git_restore_info reports can_restore_worktree_only=False.
        _write_text_lf(git_workspace / CH1, CH1_HEAD + "Unstaged only.\n")
        info = storage.get_restore_info(CH1)
        assert info["can_restore_worktree_only"] is False  # precondition

        res = client.post("/api/workspace/restore-diff-base", json={"path": CH1, "mode": "worktree_only"})

        assert res.status_code in (400, 409), "server must enforce restore caps, not trust UI gating"
        assert _read(git_workspace, CH1) == CH1_HEAD + "Unstaged only.\n"

    def test_staged_and_unstage_rejected_when_capability_false(self, git_workspace):
        # Staged-only change (worktree == index): can_restore_staged_and_unstage=False.
        _write_text_lf(git_workspace / CH1, STAGED)
        _git(git_workspace, "add", "--", CH1)
        info = storage.get_restore_info(CH1)
        assert info["can_restore_staged_and_unstage"] is False  # precondition

        res = client.post("/api/workspace/restore-diff-base", json={"path": CH1, "mode": "staged_and_unstage"})

        assert res.status_code in (400, 409)
        assert _index_blob(git_workspace, CH1) == STAGED, "staged change was silently unstaged"

    def test_unknown_mode_rejected_in_shadow_workspace(self, shadow_workspace):
        res = client.post("/api/workspace/restore-diff-base", json={"path": CH1, "mode": "commited"})
        assert res.status_code == 400
        assert _read(shadow_workspace, CH1) == CH1_HEAD + "Unsaved idea.\n"


# ---------------------------------------------------------------------------
# 2. Partial status returned as 200 success
# ---------------------------------------------------------------------------

def _assert_not_silently_partial(res) -> None:
    if res.status_code == 200:
        assert res.json().get("stale") is True, (
            "a status map built from a failed/partial walk was returned as a complete 200 response"
        )
    else:
        assert res.status_code >= 500


class TestIssue2PartialStatus:
    def test_mid_walk_failure_is_not_reported_as_complete(self, git_workspace, monkeypatch):
        _write_text_lf(git_workspace / CH1, CH1_HEAD + "edit\n")
        _write_text_lf(git_workspace / CH2, CH2_HEAD + "edit\n")

        real_resolve = git_service.resolve_git_file_status
        calls = {"n": 0}

        def flaky(*args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 2:
                raise OSError("simulated per-file race")
            return real_resolve(*args, **kwargs)

        monkeypatch.setattr(git_service, "resolve_git_file_status", flaky)

        _assert_not_silently_partial(client.get("/api/workspace/status"))

    def test_git_status_failure_is_not_reported_as_clean(self, git_workspace, monkeypatch):
        _write_text_lf(git_workspace / CH1, CH1_HEAD + "edit\n")

        def failing_status(args, *a, **kw):
            if isinstance(args, (list, tuple)) and "status" in args and "--porcelain=v1" in args:
                return subprocess.CompletedProcess(args, 128, b"", b"fatal: simulated")
            return _REAL_RUN(args, *a, **kw)

        monkeypatch.setattr(git_service.subprocess, "run", failing_status)

        _assert_not_silently_partial(client.get("/api/workspace/status"))


# ---------------------------------------------------------------------------
# 3. Rename restore is non-atomic; middle-step return codes unchecked
# ---------------------------------------------------------------------------

BASE_LONG = CH1_HEAD + ("Shared baseline line for rename similarity.\n" * 6)
STAGED_RENAME = BASE_LONG + "Staged paragraph added after rename.\n"
RENAME_WORKTREE = STAGED_RENAME + "Unstaged edit after rename.\n"


class SimulatedCrash(Exception):
    """Stands in for the process dying mid-operation."""


def _setup_staged_rename(ws: Path) -> None:
    _write_text_lf(ws / CH1, BASE_LONG)
    _git(ws, "add", "--", CH1)
    _git(ws, "commit", "-m", "Expand chapter-1 for rename similarity")

    storage.rename_input_file(CH1, "chapter-one.md")
    _write_text_lf(ws / CH1_RENAMED, STAGED_RENAME)
    _git(ws, "add", "--", CH1_RENAMED)
    _write_text_lf(ws / CH1_RENAMED, RENAME_WORKTREE)
    assert git_service.get_git_rename_source(ws, CH1_RENAMED) == CH1  # precondition


class TestIssue3NonAtomicRenameRestore:
    def test_crash_after_removing_new_path_does_not_lose_staged_content(self, git_workspace, monkeypatch):
        ws = git_workspace
        _setup_staged_rename(ws)
        armed = {"on": True}

        def crash_once():
            if armed["on"]:
                armed["on"] = False
                raise SimulatedCrash("process died right after the renamed file was removed")

        def crashing_run(args, *a, **kw):
            res = _REAL_RUN(args, *a, **kw)
            if _is_git_rm(args) and any(str(x).endswith(CH1_RENAMED) for x in args):
                crash_once()
            return res

        real_unlink = Path.unlink

        def crashing_unlink(self, *a, **kw):
            real_unlink(self, *a, **kw)
            if self.as_posix().endswith(CH1_RENAMED):
                crash_once()

        monkeypatch.setattr(git_service.subprocess, "run", crashing_run)
        monkeypatch.setattr(Path, "unlink", crashing_unlink)
        try:
            storage.restore_file(CH1_RENAMED, mode="staged_and_unstage")
        except SimulatedCrash:
            pass
        monkeypatch.undo()

        survivors = {_read(ws, CH1), _read(ws, CH1_RENAMED), _index_blob(ws, CH1), _index_blob(ws, CH1_RENAMED)}
        assert STAGED_RENAME in survivors, "the only copy of the staged content was lost mid-restore"

        # Retrying after the crash must converge on the intended end state.
        for candidate in (CH1_RENAMED, CH1):
            if (ws / candidate).exists() and git_service.get_git_rename_source(ws, candidate):
                storage.restore_file(candidate, mode="staged_and_unstage")
        assert _read(ws, CH1) == STAGED_RENAME
        assert not (ws / CH1_RENAMED).exists()

    @pytest.mark.parametrize("mode", ["staged_and_unstage", "committed"])
    def test_failed_git_rm_is_not_reported_as_success(self, git_workspace, monkeypatch, mode):
        ws = git_workspace
        _setup_staged_rename(ws)

        def failing_rm(args, *a, **kw):
            if _is_git_rm(args):
                return subprocess.CompletedProcess(args, 1, b"", b"fatal: simulated rm failure")
            return _REAL_RUN(args, *a, **kw)

        monkeypatch.setattr(git_service.subprocess, "run", failing_rm)
        try:
            result = storage.restore_file(CH1_RENAMED, mode=mode)
        except RuntimeError:
            return  # failure surfaced -> acceptable
        finally:
            monkeypatch.undo()

        assert result.get("success") is True
        assert not _in_index(ws, CH1_RENAMED), (
            "restore reported success while the renamed path is still staged in the index"
        )


# ---------------------------------------------------------------------------
# 4. Untracked rename always fails
# ---------------------------------------------------------------------------

class TestIssue4UntrackedRename:
    def _add_untracked_notes(self, ws: Path) -> None:
        _write_text_lf(ws / "chapters" / "notes.md", "# Notes\n\nNever committed.\n")
        _write_text_lf(ws / MANIFEST, MANIFEST_HEAD + "- notes.md — Loose notes\n")

    def test_rename_untracked_file_service(self, git_workspace):
        self._add_untracked_notes(git_workspace)

        result = storage.rename_input_file("chapters/notes.md", "ideas.md")

        assert result["path"] == "chapters/ideas.md"
        assert (git_workspace / "chapters" / "ideas.md").exists()
        assert not (git_workspace / "chapters" / "notes.md").exists()
        manifest = _read(git_workspace, MANIFEST)
        assert "ideas.md" in manifest and "notes.md" not in manifest


    def test_rename_untracked_file_api(self, git_workspace):
        self._add_untracked_notes(git_workspace)

        res = client.patch("/api/workspace/files/chapters/notes.md", json={"name": "ideas.md"})

        assert res.status_code == 200, res.text
        assert res.json()["path"] == "chapters/ideas.md"


# ---------------------------------------------------------------------------
# 5. .margin-shadow/ leaks into the git status map
# ---------------------------------------------------------------------------

def _hidden_keys(statuses: dict) -> list:
    return [k for k in statuses if any(part.startswith(".") for part in k.split("/"))]


class TestIssue5ShadowLeak:
    def _add_shadow_and_git_internals(self, ws: Path) -> None:
        _write_text_lf(ws / ".margin-shadow" / CH1, CH1_HEAD + "older baseline\n")
        _write_text_lf(ws / ".margin-shadow" / MANIFEST, MANIFEST_HEAD)
        _write_text_lf(ws / ".git" / "info" / "notes.md", "# not a manuscript file\n")

    def test_gitignored_shadow_not_in_status(self, git_workspace):
        # Margin-initialised repos ignore .margin-shadow/ -> leak comes from the rglob fill.
        _write_text_lf(git_workspace / ".gitignore", ".margin-shadow/\n")
        _git(git_workspace, "add", "--", ".gitignore")
        _git(git_workspace, "commit", "-m", "ignore shadow")
        self._add_shadow_and_git_internals(git_workspace)

        statuses = client.get("/api/workspace/status").json()["statuses"]

        assert CH1 in statuses
        assert _hidden_keys(statuses) == []

    def test_unignored_shadow_not_in_status(self, git_workspace):
        # Pre-existing repos may not ignore .margin-shadow/ -> leak via porcelain '??' rows.
        self._add_shadow_and_git_internals(git_workspace)

        statuses = client.get("/api/workspace/status").json()["statuses"]

        assert CH1 in statuses
        assert _hidden_keys(statuses) == []


# ---------------------------------------------------------------------------
# 6. Staged-rename manifest handling undoes itself
# ---------------------------------------------------------------------------

REVISED_SUMMARY = "Second chapter, revised"


def _rename_then_restore(ws: Path, mode: str) -> None:
    # Unrelated, legitimate manifest edit made by the author before the rename.
    _write_text_lf(ws / MANIFEST, MANIFEST_HEAD.replace("Second chapter", REVISED_SUMMARY))
    storage.rename_input_file(CH1, "chapter-one.md")
    storage.restore_file(CH1_RENAMED, mode=mode)


class TestIssue6RenameRestoreManifest:
    @pytest.mark.parametrize("mode", ["staged_and_unstage", "committed"])
    def test_manifest_tracks_worktree_after_rename_restore(self, git_workspace, mode):
        ws = git_workspace
        _rename_then_restore(ws, mode)

        manifest = _read(ws, MANIFEST)
        assert (ws / CH1).exists() and not (ws / CH1_RENAMED).exists()
        assert "chapter-1.md" in manifest
        assert "chapter-one.md" not in manifest
        assert REVISED_SUMMARY in manifest, f"{mode}: unrelated manifest edit was discarded"


    def test_both_modes_leave_manifest_in_same_git_state(self):
        states = {}
        prev = storage.workspace_dir
        for mode in ("staged_and_unstage", "committed"):
            ws = _make_git_workspace()
            storage.workspace_dir = ws
            try:
                _rename_then_restore(ws, mode)
                states[mode] = (
                    _read(ws, MANIFEST),
                    _git(ws, "status", "--porcelain=v1", "--", MANIFEST).stdout,
                )
            finally:
                storage.workspace_dir = prev
                _rmtree(str(ws))

        assert states["staged_and_unstage"][0] == states["committed"][0]
        assert states["staged_and_unstage"][1] == states["committed"][1]

    @pytest.mark.parametrize("mode", ["staged_and_unstage", "committed"])
    def test_manifest_preserves_custom_notes_and_comments_after_rename_restore(self, git_workspace, mode):
        ws = git_workspace
        # Single-file manifest with custom non-entry note
        single_manifest = f"- {Path(CH1).name} — Chapter 1: Introduction. Opening scene.\n"
        _write_text_lf(ws / MANIFEST, single_manifest)
        _git(ws, "add", "--", MANIFEST)
        _git(ws, "commit", "-m", "single chapter manifest")

        # Author appends a note / comment to the manifest
        working_note = "| bonus-note.md | Author working note |"
        _write_text_lf(ws / MANIFEST, single_manifest.strip() + f"\n{working_note}\n")

        storage.rename_input_file(CH1, "chapter-one.md")
        storage.restore_file(CH1_RENAMED, mode=mode)

        manifest = _read(ws, MANIFEST)
        assert (ws / CH1).exists() and not (ws / CH1_RENAMED).exists()
        assert "chapter-1.md" in manifest
        assert "chapter-one.md" not in manifest
        assert working_note in manifest, f"{mode}: non-entry author note was discarded"


# ---------------------------------------------------------------------------
# 7. Link/init `git add .` + auto-commit on existing user directories
# ---------------------------------------------------------------------------

@pytest.fixture
def existing_user_dir():
    ws = Path(tempfile.mkdtemp(prefix="margin-pr14-link-")).resolve()
    _write_text_lf(ws / ".env", "OPENAI_API_KEY=sk-do-not-commit\n")
    _write_text_lf(ws / "private-notes.txt", "Things nobody should see.\n")
    (ws / "chapters").mkdir()
    _write_text_lf(ws / CH1, CH1_HEAD)
    try:
        yield ws
    finally:
        _rmtree(str(ws))


class TestIssue7LinkAutoCommit:
    def test_git_init_on_existing_dir_does_not_auto_commit(self, existing_user_dir):
        res = client.post("/api/workspace/git-init", json={"path": str(existing_user_dir)})
        assert res.status_code == 200
        assert res.json()["git"]["initialized"] is True

        head = _git(existing_user_dir, "rev-parse", "--verify", "HEAD", check=False)
        assert head.returncode != 0, "linking an existing folder must not auto-commit its contents"

    def test_git_init_on_existing_dir_does_not_track_private_files(self, existing_user_dir):
        client.post("/api/workspace/git-init", json={"path": str(existing_user_dir)})

        tracked = _git(existing_user_dir, "ls-files").stdout.splitlines()
        assert ".env" not in tracked
        assert "private-notes.txt" not in tracked

    def test_related_finding_existing_gitignore_is_preserved(self, existing_user_dir):
        # Not in the review: _init_git_repo unconditionally overwrites .gitignore.
        _write_text_lf(existing_user_dir / ".gitignore", "secrets/\n")

        client.post("/api/workspace/git-init", json={"path": str(existing_user_dir)})

        assert "secrets/" in _read(existing_user_dir, ".gitignore")

    def test_link_endpoint_with_init_git_does_not_auto_commit_or_track_private_files(
        self, existing_user_dir, monkeypatch, tmp_path
    ):
        prev_ws = storage.workspace_dir
        monkeypatch.setattr(storage, "settings_path", tmp_path / "settings.json")
        try:
            res = client.post(
                "/api/workspace/link",
                json={"path": str(existing_user_dir), "name": "My Novel", "init_git": True},
            )
            assert res.status_code == 200
            assert res.json()["git"]["initialized"] is True

            head = _git(existing_user_dir, "rev-parse", "--verify", "HEAD", check=False)
            assert head.returncode != 0, "/api/workspace/link with init_git=True must not auto-commit existing files"
            tracked = _git(existing_user_dir, "ls-files").stdout.splitlines()
            assert ".env" not in tracked
            assert "private-notes.txt" not in tracked
        finally:
            storage.workspace_dir = prev_ws

