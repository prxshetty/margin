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
from api.services import git_service, file_storage
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
    assert res.status_code >= 500, (
        f"expected status >= 500 on status failure, got {res.status_code} with body {res.text}"
    )


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

    def test_non_git_status_failure_is_not_reported_as_partial_200(self, shadow_workspace, monkeypatch):
        def failing_list(*args, **kwargs):
            raise OSError("simulated disk error during listing")

        monkeypatch.setattr(storage, "list_input_files", failing_list)
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


# ---------------------------------------------------------------------------
# Additional regression coverage: create/rename suffix parity & git rename errors
# ---------------------------------------------------------------------------

class TestCreateAndRenameSuffixHandling:
    def test_create_file_without_md_suffix_auto_appends(self, git_workspace):
        res = client.post("/api/workspace/files", json={"folder": "chapters", "name": "notes", "content": "# Notes\n"})
        assert res.status_code == 200, res.text
        assert res.json()["name"] == "notes.md"
        assert res.json()["path"] == "chapters/notes.md"
        assert (git_workspace / "chapters" / "notes.md").exists()

    def test_create_file_with_uppercase_md_suffix(self, git_workspace):
        res = client.post("/api/workspace/files", json={"folder": "chapters", "name": "outro.MD", "content": "# Outro\n"})
        assert res.status_code == 200, res.text
        assert res.json()["name"] == "outro.MD"
        assert (git_workspace / "chapters" / "outro.MD").exists()

    def test_rename_file_without_md_suffix_auto_appends(self, git_workspace):
        _write_text_lf(git_workspace / "chapters" / "scratch.md", "# Scratch\n")
        res = client.patch("/api/workspace/files/chapters/scratch.md", json={"name": "ideas"})
        assert res.status_code == 200, res.text
        assert res.json()["name"] == "ideas.md"
        assert res.json()["path"] == "chapters/ideas.md"
        assert (git_workspace / "chapters" / "ideas.md").exists()
        assert not (git_workspace / "chapters" / "scratch.md").exists()

    def test_rename_file_with_uppercase_md_suffix(self, git_workspace):
        _write_text_lf(git_workspace / "chapters" / "draft.md", "# Draft\n")
        res = client.patch("/api/workspace/files/chapters/draft.md", json={"name": "final.MD"})
        assert res.status_code == 200, res.text
        assert res.json()["name"] == "final.MD"
        assert (git_workspace / "chapters" / "final.MD").exists()


class TestGitRenameFailureHandling:
    def test_rename_git_file_raises_on_fallback_failure(self, git_workspace, monkeypatch):
        _write_text_lf(git_workspace / "chapters" / "tracked.md", "# Tracked\n")
        _git(git_workspace, "add", "chapters/tracked.md")
        _git(git_workspace, "commit", "-m", "add tracked")

        def failing_git(args, *a, **kw):
            if isinstance(args, (list, tuple)) and "mv" in args:
                return subprocess.CompletedProcess(args, 1, b"", b"fatal: mv failed")
            if isinstance(args, (list, tuple)) and "add" in args and "chapters/dest.md" in args:
                return subprocess.CompletedProcess(args, 1, b"", b"fatal: add failed")
            return _REAL_RUN(args, *a, **kw)

        monkeypatch.setattr(git_service.subprocess, "run", failing_git)
        with pytest.raises(RuntimeError, match="Git add failed"):
            git_service.rename_git_file(git_workspace, "chapters/tracked.md", "chapters/dest.md")

    def test_rename_endpoint_returns_400_on_git_failure(self, git_workspace, monkeypatch):
        _write_text_lf(git_workspace / "chapters" / "tracked2.md", "# Tracked 2\n")
        _git(git_workspace, "add", "chapters/tracked2.md")
        _git(git_workspace, "commit", "-m", "add tracked 2")

        def failing_git(args, *a, **kw):
            if isinstance(args, (list, tuple)) and "mv" in args:
                return subprocess.CompletedProcess(args, 1, b"", b"fatal: mv failed")
            if isinstance(args, (list, tuple)) and "add" in args:
                return subprocess.CompletedProcess(args, 1, b"", b"fatal: simulated git error")
            return _REAL_RUN(args, *a, **kw)

        monkeypatch.setattr(git_service.subprocess, "run", failing_git)
        res = client.patch("/api/workspace/files/chapters/tracked2.md", json={"name": "dest2.md"})
        assert res.status_code == 400


class TestManifestInjectionAndRestoreHardening:
    def test_create_file_with_newline_or_carriage_return_rejected(self, git_workspace):
        res1 = client.post("/api/workspace/files", json={"folder": "chapters", "name": "bad\nname.md", "content": "# Bad\n"})
        assert res1.status_code == 400

        res2 = client.post("/api/workspace/files", json={"folder": "chapters", "name": "bad\rname.md", "content": "# Bad\n"})
        assert res2.status_code == 400

    def test_rename_file_with_newline_or_carriage_return_rejected(self, git_workspace):
        _write_text_lf(git_workspace / "chapters" / "valid.md", "# Valid\n")
        res1 = client.patch("/api/workspace/files/chapters/valid.md", json={"name": "bad\nname.md"})
        assert res1.status_code == 400

        res2 = client.patch("/api/workspace/files/chapters/valid.md", json={"name": "bad\rname.md"})
        assert res2.status_code == 400

    def test_git_status_porcelain_copy_parsing(self, git_workspace, monkeypatch):
        # Simulate porcelain output containing a copy record C  dest.md\0src.md\0 followed by M  other.md\0
        fake_stdout = b"C  chapters/copy.md\x00chapters/orig.md\x00M  chapters/other.md\x00"
        statuses = git_service._parse_git_status_porcelain(fake_stdout, git_workspace, git_workspace)
        assert "chapters/copy.md" in statuses
        assert "chapters/other.md" in statuses
        assert "chapters/orig.md" not in statuses

    def test_restore_rename_updates_manifest_without_committed_baseline(self, git_workspace):
        manifest_path = git_workspace / "chapters" / "CHAPTERS.md"
        assert "chapter-1.md" in manifest_path.read_text(encoding="utf-8")

        res_rename = client.patch(
            "/api/workspace/files/chapters/chapter-1.md",
            json={"name": "renamed.md"}
        )
        assert res_rename.status_code == 200
        assert "renamed.md" in manifest_path.read_text(encoding="utf-8")
        assert "chapter-1.md" not in manifest_path.read_text(encoding="utf-8")

        # Now restore staged_and_unstage - should revert manifest to chapter-1.md
        res_restore = client.post(
            "/api/workspace/restore-diff-base",
            json={"path": "chapters/renamed.md", "mode": "staged_and_unstage"}
        )
        assert res_restore.status_code == 200
        assert "chapter-1.md" in manifest_path.read_text(encoding="utf-8")
        assert "renamed.md" not in manifest_path.read_text(encoding="utf-8")

    def test_restore_staged_and_unstage_for_deleted_uncommitted_file(self, git_workspace):
        # Create new uncommitted file and stage it
        chap_path = git_workspace / "chapters" / "uncommitted.md"
        _write_text_lf(chap_path, "# Uncommitted\nStaged body\n")
        res_stage = client.post(
            "/api/workspace/stage",
            json={"path": "chapters/uncommitted.md", "content": "# Uncommitted\nStaged body\n"}
        )
        assert res_stage.status_code == 200

        # Delete from disk
        chap_path.unlink()
        assert not chap_path.exists()

        # Restore staged and unstage
        res_restore = client.post(
            "/api/workspace/restore-diff-base",
            json={"path": "chapters/uncommitted.md", "mode": "staged_and_unstage"}
        )
        assert res_restore.status_code == 200
        assert res_restore.json()["success"] is True
        assert chap_path.exists()
        assert "Staged body" in chap_path.read_text(encoding="utf-8")

    def test_shadow_manifest_loading_in_non_git_workspace(self, shadow_workspace):
        shadow_dir = shadow_workspace / ".margin-shadow" / "chapters"
        shadow_dir.mkdir(parents=True, exist_ok=True)
        shadow_manifest = shadow_dir / "CHAPTERS.md"
        _write_text_lf(shadow_manifest, "- chap-shadow.md — Summary from shadow\n")

        # Manifest does not exist in workspace root, should fall back to shadow
        loaded = storage._load_manifest("chapters/CHAPTERS.md")
        assert loaded.get("chap-shadow.md") == "Summary from shadow"

    def test_create_and_update_file_normalizes_to_lf_on_disk(self, git_workspace):
        res_create = client.post(
            "/api/workspace/files",
            json={"folder": "chapters", "name": "crlf_test.md", "content": "line1\r\nline2\r\n"}
        )
        assert res_create.status_code == 200
        target = git_workspace / "chapters" / "crlf_test.md"
        raw_bytes = target.read_bytes()
        assert b"\r\n" not in raw_bytes
        assert b"line1\nline2\n" == raw_bytes

        # Also test update_input_file
        storage.update_input_file("chapters/crlf_test.md", "updated1\r\nupdated2\r\n")
        raw_bytes_updated = target.read_bytes()
        assert b"\r\n" not in raw_bytes_updated
        assert b"updated1\nupdated2\n" == raw_bytes_updated

    def test_rename_untracked_file_does_not_auto_stage(self, git_workspace):
        res_create = client.post(
            "/api/workspace/files",
            json={"folder": "chapters", "name": "untracked_orig.md", "content": "# Untracked\n"}
        )
        assert res_create.status_code == 200
        res_rename = client.patch(
            "/api/workspace/files/chapters/untracked_orig.md",
            json={"name": "untracked_new.md"}
        )
        assert res_rename.status_code == 200
        assert res_rename.json()["tracked"] is False

        status_data = storage.get_workspace_status()
        assert status_data["statuses"]["chapters/untracked_new.md"] == "untracked"

    def test_restore_modified_file_does_not_overwrite_manifest_edits(self, git_workspace):
        manifest_path = git_workspace / "chapters" / "CHAPTERS.md"
        _write_text_lf(
            manifest_path,
            "- chapter-1.md — Custom user edited summary\n- chapter-2.md — Second chapter\n"
        )
        chap1 = git_workspace / "chapters" / "chapter-1.md"
        _write_text_lf(chap1, "# Chapter 1\n\nModified body.\n")

        res_restore = client.post(
            "/api/workspace/restore-diff-base",
            json={"path": "chapters/chapter-1.md", "mode": "committed"}
        )
        assert res_restore.status_code == 200
        assert "Custom user edited summary" in manifest_path.read_text(encoding="utf-8")

    def test_deleted_file_in_deleted_subfolder_appears_in_list(self, git_workspace):
        lore_dir = git_workspace / "lore"
        lore_dir.mkdir(parents=True, exist_ok=True)
        lore_file = lore_dir / "history.md"
        _write_text_lf(lore_file, "# History\n")
        _git(git_workspace, "add", "lore/history.md")
        _git(git_workspace, "commit", "-m", "Add lore")

        # Delete the file and its directory completely from disk
        shutil.rmtree(lore_dir)
        assert not lore_dir.exists()

        files = storage.list_input_files()
        deleted_lore = next((f for f in files if f["path"] == "lore/history.md"), None)
        assert deleted_lore is not None
        assert deleted_lore["deleted"] is True

    def test_delete_nonexistent_file_returns_404(self, git_workspace):
        res = client.delete("/api/workspace/files/chapters/does_not_exist.md")
        assert res.status_code == 404

    def test_non_git_restore_info_and_restore_schema_parity(self, shadow_workspace):
        # In shadow_workspace fixture, chapter-1.md starts with an unstaged edit relative to shadow baseline
        info = storage.get_restore_info("chapters/chapter-1.md")
        assert info["is_git"] is False
        assert info["has_committed_version"] is True
        assert info["has_staged_changes"] is False
        assert info["has_unstaged_changes"] is True

        res = storage.restore_file("chapters/chapter-1.md", mode="committed")
        assert res["restored_path"] == "chapters/chapter-1.md"

        info_after = storage.get_restore_info("chapters/chapter-1.md")
        assert info_after["has_unstaged_changes"] is False

    def test_scaffold_shadow_baselines_includes_root_md_and_custom_folders(self, tmp_path):
        ws = tmp_path / "custom_non_git_ws"
        ws.mkdir()
        (ws / "README.md").write_text("# Root Readme\n", encoding="utf-8")
        lore_dir = ws / "lore"
        lore_dir.mkdir()
        (lore_dir / "world.md").write_text("# World Lore\n", encoding="utf-8")

        storage._scaffold_shadow_baselines(ws)
        assert (ws / ".margin-shadow" / "README.md").exists()
        assert (ws / ".margin-shadow" / "lore" / "world.md").exists()

    def test_restore_worktree_only_restores_manifest_when_worktree_deleted(self, git_workspace):
        # Stage an edit to chapter-1.md
        chap1 = git_workspace / "chapters" / "chapter-1.md"
        _write_text_lf(chap1, "# Chapter 1\n\nStaged content.\n")
        _git(git_workspace, "add", "chapters/chapter-1.md")

        # Simulate deleting chapter-1.md in worktree and removing its manifest row
        chap1.unlink()
        manifest_path = git_workspace / "chapters" / "CHAPTERS.md"
        _write_text_lf(manifest_path, "# Chapters Manifest\n\n- chapter-2.md — Second chapter\n")

        res = client.post(
            "/api/workspace/restore-diff-base",
            json={"path": "chapters/chapter-1.md", "mode": "worktree_only"},
        )
        assert res.status_code == 200
        assert chap1.exists()
        assert "Staged content." in chap1.read_text(encoding="utf-8")
        assert "chapter-1.md" in manifest_path.read_text(encoding="utf-8")

    def test_delete_untracked_file_does_not_stage_manifest(self, git_workspace):
        client.post("/api/workspace/files", json={"folder": "chapters", "name": "untracked-del.md", "content": "# Untracked\n"})
        res = client.delete("/api/workspace/files/chapters/untracked-del.md")
        assert res.status_code == 200

        statuses = storage.get_workspace_status()["statuses"]
        assert statuses.get("chapters/CHAPTERS.md") != "staged"
        assert statuses.get("chapters/CHAPTERS.md") != "staged_modified"

    def test_get_git_rename_source_ignores_out_of_workspace_origin_in_subdir_workspace(self, tmp_path, monkeypatch):
        repo_root = tmp_path / "repo"
        repo_root.mkdir()
        _git(repo_root, "init")
        _git(repo_root, "config", "user.email", "test@example.com")
        _git(repo_root, "config", "user.name", "Test User")

        outside_file = repo_root / "outside.md"
        _write_text_lf(outside_file, "# Outside file\n")
        sub_ws = repo_root / "sub_ws"
        (sub_ws / "chapters").mkdir(parents=True)
        _git(repo_root, "add", ".")
        _git(repo_root, "commit", "-m", "Init")

        _git(repo_root, "mv", "outside.md", "sub_ws/chapters/inside.md")
        assert git_service.get_git_rename_source(sub_ws, "chapters/inside.md") is None

    def test_uppercase_md_deleted_file_included_in_list_input_files(self, git_workspace):
        upper_file = git_workspace / "chapters" / "UPPER.MD"
        _write_text_lf(upper_file, "# Upper\n")
        _git(git_workspace, "add", "chapters/UPPER.MD")
        _git(git_workspace, "commit", "-m", "Add upper")
        upper_file.unlink()

        files = storage.list_input_files()
        deleted_upper = next((f for f in files if f["path"] == "chapters/UPPER.MD"), None)
        assert deleted_upper is not None
        assert deleted_upper["deleted"] is True

    def test_diff_base_and_stage_report_committed_version_for_renamed_file(self, git_workspace):
        _setup_staged_rename(git_workspace)
        diff_info = storage.get_diff_base(CH1_RENAMED)
        assert diff_info["has_committed_version"] is True

        stage_res = storage.stage_file(CH1_RENAMED, content=STAGED_RENAME + "More similar text.\n")
        assert stage_res["has_committed_version"] is True

    def test_non_git_stage_file_missing_on_disk_raises_404_instead_of_clobbering_shadow(self, shadow_workspace):
        chap1 = shadow_workspace / "chapters" / "chapter-1.md"
        shadow_chap1 = shadow_workspace / ".margin-shadow" / "chapters" / "chapter-1.md"
        orig_shadow = shadow_chap1.read_text(encoding="utf-8")
        chap1.unlink()

        res = client.post("/api/workspace/stage", json={"path": "chapters/chapter-1.md"})
        assert res.status_code == 404
        assert shadow_chap1.read_text(encoding="utf-8") == orig_shadow

    def test_manifest_validation_and_parsing_supports_single_char_unicode_and_parens(self):
        content = (
            "- 1 — Chapter one\n"
            "- a — Simple style\n"
            "- élise.md — French protagonist\n"
            "- 第1章.md — Japanese chapter\n"
            "- chapter 1.md — Spaced chapter\n"
            "- chapter_1_(draft).md — Draft chapter\n"
        )
        val = file_storage.validate_manifest_content(content)
        assert val["is_valid"] is True
        assert val["invalid_lines"] == []
        assert val["total_count"] == 0

        parsed = file_storage._parse_manifest_entries(content)
        assert "1" in parsed
        assert "a" in parsed
        assert "élise" in parsed
        assert "第1章" in parsed
        assert "chapter 1" in parsed
        assert "chapter_1_(draft)" in parsed

    def test_git_restore_info_normalizes_crlf_markdown_content(self, git_workspace):
        chap1 = git_workspace / "chapters" / "chapter-1.md"
        # Write CRLF version of identical text
        crlf_text = chap1.read_text(encoding="utf-8").replace("\n", "\r\n")
        chap1.write_bytes(crlf_text.encode("utf-8"))

        restore_info = git_service.get_git_restore_info(git_workspace, "chapters/chapter-1.md")
        assert restore_info["has_unstaged_changes"] is False
        assert restore_info["can_restore_worktree_only"] is False

    def test_worktree_only_restore_manifest_prioritizes_staged_index(self, git_workspace):
        chap1 = git_workspace / "chapters" / "chapter-1.md"
        manifest = git_workspace / "chapters" / "CHAPTERS.md"
        # Stage modified content in chap1 and staged summary in manifest
        _write_text_lf(chap1, "# Staged content for chapter 1\n")
        _git(git_workspace, "add", "chapters/chapter-1.md")

        new_manifest_text = "- chapter-1.md — Updated staged summary.\n"
        _write_text_lf(manifest, new_manifest_text)
        _git(git_workspace, "add", "chapters/CHAPTERS.md")

        # Delete chap1 in worktree only
        chap1.unlink()

        # Restore worktree only
        storage.restore_file("chapters/chapter-1.md", mode="worktree_only")
        assert chap1.exists()
        assert "Staged content for chapter 1" in chap1.read_text(encoding="utf-8")
        # Manifest in worktree should retain the staged summary, not revert to HEAD
        assert "Updated staged summary" in manifest.read_text(encoding="utf-8")

    def test_link_workspace_init_git_false_includes_staged_in_git_info(self, tmp_path, monkeypatch):
        prev_ws = storage.workspace_dir
        monkeypatch.setattr(storage, "settings_path", tmp_path / "settings.json")
        try:
            ws = tmp_path / "new_ws"
            ws.mkdir()
            res = client.post("/api/workspace/link", json={"path": str(ws), "init_git": False})
            assert res.status_code == 200
            git_info = res.json().get("git")
            assert git_info is not None
            assert git_info.get("staged") is False
        finally:
            storage.workspace_dir = prev_ws

    def test_read_missing_non_markdown_file_raises_file_not_found(self, git_workspace):
        with pytest.raises(FileNotFoundError):
            storage.read_input_file("config.yaml")

    def test_noop_rename_untracked_file_returns_tracked_false(self, git_workspace):
        # Create an untracked file
        untracked = git_workspace / "chapters" / "untracked.md"
        _write_text_lf(untracked, "# Untracked\n")
        res = storage.rename_input_file("chapters/untracked.md", "untracked.md")
        assert res["tracked"] is False

    def test_is_ignored_or_hidden_status_path_case_insensitive_outputs(self):
        assert git_service.is_ignored_or_hidden_status_path("Outputs/render.png") is True
        assert git_service.is_ignored_or_hidden_status_path("OUTPUTS/render.png") is True
        assert git_service.is_ignored_or_hidden_status_path("outputs") is True
        assert git_service.is_ignored_or_hidden_status_path("chapters/chapter-1.md") is False

    def test_rename_source_rejects_dotfiles_and_non_markdown(self, git_workspace):
        env_file = git_workspace / ".env"
        _write_text_lf(env_file, "SECRET_KEY=super_secret_token\n")
        _git(git_workspace, "add", "-f", ".env")
        _git(git_workspace, "commit", "-m", "Add dotfile")
        _git(git_workspace, "mv", ".env", "chapters/leaked.md")

        assert git_service.get_git_rename_source(git_workspace, "chapters/leaked.md") is None
        info = git_service.get_git_restore_info(git_workspace, "chapters/leaked.md")
        assert info["is_renamed"] is False
        assert info["renamed_from"] is None

    def test_load_manifest_supports_unicode_spaces_and_parens(self, shadow_workspace):
        manifest = shadow_workspace / "chapters" / "CHAPTERS.md"
        _write_text_lf(
            manifest,
            "- élise.md — French protagonist\n"
            "* chapter 1.md — Spaced chapter\n"
            "- chapter_1_(draft).md — Draft chapter\n",
        )
        mapping = storage._load_manifest("chapters/CHAPTERS.md")
        assert mapping.get("élise.md") == "French protagonist"
        assert mapping.get("chapter 1.md") == "Spaced chapter"
        assert mapping.get("chapter_1_(draft).md") == "Draft chapter"

    def test_manifest_entry_regex_rejects_leading_hyphen_and_horizontal_rules(self):
        val = file_storage.validate_manifest_content("- - - -\n- - item: desc\n")
        assert val["is_valid"] is False
        assert val["total_count"] == 2

    def test_rename_input_file_shadow_workspace_returns_tracked_true(self, shadow_workspace):
        res = storage.rename_input_file("chapters/chapter-1.md", "ch1-renamed.md")
        assert res["tracked"] is True

    def test_resolve_git_file_status_renamed_non_markdown_origin_falls_back_to_staged(self, git_workspace):
        env_file = git_workspace / ".env"
        _write_text_lf(env_file, "SECRET=abc\n")
        _git(git_workspace, "add", "-f", ".env")
        _git(git_workspace, "commit", "-m", "add env")
        _git(git_workspace, "mv", ".env", "chapters/secret.md")

        status_map = git_service.get_git_workspace_status(git_workspace)
        assert status_map.get("chapters/secret.md") == "staged"

    def test_resolve_git_file_status_renamed_excluded_origin_with_normalized_markdown_falls_back_to_staged(self, git_workspace):
        env_file = git_workspace / ".env"
        _write_text_lf(env_file, "# Secret\n\nContent.\n")
        _git(git_workspace, "add", "-f", ".env")
        _git(git_workspace, "commit", "-m", "add env")
        _git(git_workspace, "mv", ".env", "chapters/secret.md")
        target = git_workspace / "chapters" / "secret.md"
        target.write_bytes(b"# Secret\r\n\r\nContent.\r\n")

        status_map = git_service.get_git_workspace_status(git_workspace)
        assert status_map.get("chapters/secret.md") == "staged"










