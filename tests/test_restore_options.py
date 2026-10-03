import tempfile
import subprocess
import shutil
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.services.file_storage import storage, _write_text_lf


@pytest.fixture
def git_workspace():
    """Create a temporary git workspace with a committed chapter file."""
    td = tempfile.mkdtemp(prefix="margin-restore-test-")
    ws_path = Path(td).resolve()

    subprocess.run(["git", "init"], cwd=str(ws_path), check=True, capture_output=True)
    subprocess.run(["git", "config", "user.name", "Test Author"], cwd=str(ws_path), check=True)
    subprocess.run(["git", "config", "user.email", "author@test.com"], cwd=str(ws_path), check=True)

    chapters_dir = ws_path / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    chap1 = chapters_dir / "chapter-1.md"
    _write_text_lf(chap1, "# Chapter 1\n\nInitial committed text.\n")

    manifest = chapters_dir / "CHAPTERS.md"
    _write_text_lf(manifest, "| File | Summary |\n|---|---|\n| chapter-1.md | First chapter |\n")

    subprocess.run(["git", "add", "-A"], cwd=str(ws_path), check=True)
    subprocess.run(["git", "commit", "-m", "Initial commit"], cwd=str(ws_path), check=True)

    prev_dir = storage.workspace_dir
    storage.workspace_dir = ws_path

    yield ws_path

    storage.workspace_dir = prev_dir
    try:
        shutil.rmtree(td, ignore_errors=True)
    except Exception:
        pass


def test_get_restore_info_unstaged_modified(git_workspace):
    chap1 = git_workspace / "chapters" / "chapter-1.md"
    _write_text_lf(chap1, "# Chapter 1\n\nInitial committed text.\nUnstaged edit.\n")

    info = storage.get_restore_info("chapters/chapter-1.md")
    assert info["is_git"] is True
    assert info["has_committed_version"] is True
    assert info["has_staged_changes"] is False
    assert info["has_unstaged_changes"] is True
    assert info["can_restore_worktree_only"] is False
    assert info["can_restore_staged_and_unstage"] is False
    assert info["can_restore_committed"] is True


def test_get_restore_info_staged_and_staged_modified(git_workspace):
    chap1 = git_workspace / "chapters" / "chapter-1.md"
    _write_text_lf(chap1, "# Chapter 1\n\nStaged text.\n")
    subprocess.run(["git", "add", "-A"], cwd=str(git_workspace), check=True)

    # 1. Staged only (worktree matches staged)
    info_staged = storage.get_restore_info("chapters/chapter-1.md")
    assert info_staged["has_staged_changes"] is True
    assert info_staged["has_unstaged_changes"] is False
    assert info_staged["can_restore_worktree_only"] is False
    assert info_staged["can_restore_staged_and_unstage"] is False
    assert info_staged["can_restore_committed"] is True

    # 2. Staged modified (working edits on top)
    _write_text_lf(chap1, "# Chapter 1\n\nStaged text.\nUnstaged additional edit.\n")
    info_staged_mod = storage.get_restore_info("chapters/chapter-1.md")
    assert info_staged_mod["has_staged_changes"] is True
    assert info_staged_mod["has_unstaged_changes"] is True
    assert info_staged_mod["can_restore_worktree_only"] is True
    assert info_staged_mod["can_restore_staged_and_unstage"] is True
    assert info_staged_mod["can_restore_committed"] is True


def test_get_restore_info_renamed(git_workspace):
    storage.rename_input_file("chapters/chapter-1.md", "chapter-one.md")

    info_renamed = storage.get_restore_info("chapters/chapter-one.md")
    assert info_renamed["is_renamed"] is True
    assert info_renamed["renamed_from"] == "chapters/chapter-1.md"
    assert info_renamed["can_restore_worktree_only"] is False
    assert info_renamed["can_restore_staged_and_unstage"] is True
    assert info_renamed["can_restore_committed"] is True

    # Add worktree modifications after rename
    chap_new = git_workspace / "chapters" / "chapter-one.md"
    _write_text_lf(chap_new, "# Chapter One\n\nEdits after rename.\n")

    info_renamed_mod = storage.get_restore_info("chapters/chapter-one.md")
    assert info_renamed_mod["is_renamed"] is True
    assert info_renamed_mod["renamed_from"] == "chapters/chapter-1.md"
    assert info_renamed_mod["can_restore_worktree_only"] is True
    assert info_renamed_mod["can_restore_staged_and_unstage"] is True
    assert info_renamed_mod["can_restore_committed"] is True


def test_restore_file_modes(git_workspace):
    chap1 = git_workspace / "chapters" / "chapter-1.md"
    _write_text_lf(chap1, "# Chapter 1\n\nStaged content.\n")
    subprocess.run(["git", "add", "-A"], cwd=str(git_workspace), check=True)

    _write_text_lf(chap1, "# Chapter 1\n\nStaged content.\nWorking edits.\n")

    # Mode 1: worktree_only
    res1 = storage.restore_file("chapters/chapter-1.md", mode="worktree_only")
    assert res1["success"] is True
    assert res1["mode"] == "worktree_only"
    assert "Working edits" not in res1["restored_content"]
    assert "Staged content" in res1["restored_content"]
    status1 = storage.get_workspace_status()["statuses"]["chapters/chapter-1.md"]
    assert status1 == "staged"

    # Add working edits again
    _write_text_lf(chap1, "# Chapter 1\n\nStaged content.\nWorking edits 2.\n")

    # Mode 2: staged_and_unstage
    res2 = storage.restore_file("chapters/chapter-1.md", mode="staged_and_unstage")
    assert res2["success"] is True
    assert res2["mode"] == "staged_and_unstage"
    assert "Working edits 2" not in res2["restored_content"]
    assert "Staged content" in res2["restored_content"]
    status2 = storage.get_workspace_status()["statuses"]["chapters/chapter-1.md"]
    assert status2 == "unstaged_modified"

    # Mode 3: committed
    res3 = storage.restore_file("chapters/chapter-1.md", mode="committed")
    assert res3["success"] is True
    assert res3["mode"] == "committed"
    assert res3["restored_content"] == "# Chapter 1\n\nInitial committed text.\n"
    status3 = storage.get_workspace_status()["statuses"]["chapters/chapter-1.md"]
    assert status3 == "clean"


def test_restore_file_rename_modes(git_workspace):
    storage.rename_input_file("chapters/chapter-1.md", "chapter-two.md")
    chap2 = git_workspace / "chapters" / "chapter-two.md"
    _write_text_lf(chap2, "# Chapter Two\n\nWorking edit in renamed file.\n")

    # Mode 1 on rename: worktree_only
    res1 = storage.restore_file("chapters/chapter-two.md", mode="worktree_only")
    assert res1["success"] is True
    assert res1["restored_path"] == "chapters/chapter-two.md"
    assert "Working edit" not in res1["restored_content"]
    assert storage.get_workspace_status()["statuses"]["chapters/chapter-two.md"] == "staged_renamed"

    # Mode 2 on rename: staged_and_unstage (reverts rename, preserves staged content in chapter-1.md)
    res2 = storage.restore_file("chapters/chapter-two.md", mode="staged_and_unstage")
    assert res2["success"] is True
    assert res2["restored_path"] == "chapters/chapter-1.md"
    assert not chap2.exists()
    assert (git_workspace / "chapters" / "chapter-1.md").exists()

    # Re-rename to test Mode 3
    storage.rename_input_file("chapters/chapter-1.md", "chapter-three.md")
    res3 = storage.restore_file("chapters/chapter-three.md", mode="committed")
    assert res3["success"] is True
    assert res3["restored_path"] == "chapters/chapter-1.md"
    assert not (git_workspace / "chapters" / "chapter-three.md").exists()
    assert (git_workspace / "chapters" / "chapter-1.md").exists()
    assert storage.get_workspace_status()["statuses"]["chapters/chapter-1.md"] == "clean"


def test_restore_api_endpoints(git_workspace):
    client = TestClient(app)

    # 1. Modify and stage
    chap1 = git_workspace / "chapters" / "chapter-1.md"
    _write_text_lf(chap1, "# Chapter 1\n\nStaged via API test.\n")
    subprocess.run(["git", "add", "-A"], cwd=str(git_workspace), check=True)
    _write_text_lf(chap1, "# Chapter 1\n\nStaged via API test.\nUnstaged mod.\n")

    # GET /api/workspace/restore-info
    res_info = client.get("/api/workspace/restore-info?path=chapters/chapter-1.md")
    assert res_info.status_code == 200
    data = res_info.json()
    assert data["is_git"] is True
    assert data["can_restore_worktree_only"] is True
    assert data["can_restore_staged_and_unstage"] is True
    assert data["can_restore_committed"] is True

    # POST /api/workspace/restore-diff-base with mode=worktree_only
    res_restore = client.post(
        "/api/workspace/restore-diff-base",
        json={"path": "chapters/chapter-1.md", "mode": "worktree_only"}
    )
    assert res_restore.status_code == 200
    res_data = res_restore.json()
    assert res_data["success"] is True
    assert "Unstaged mod" not in res_data["restored_content"]


def test_get_restore_info_new_file_staged_and_modified(git_workspace):
    """A new file that has not been committed, staged, and modified should allow worktree_only and staged_and_unstage, but not committed."""
    new_chap = git_workspace / "chapters" / "chapter-2.md"
    _write_text_lf(new_chap, "# Chapter 2\n\nStaged initial content.\n")
    subprocess.run(["git", "add", "--", "./chapters/chapter-2.md"], cwd=str(git_workspace), check=True)

    # Modify working tree
    _write_text_lf(new_chap, "# Chapter 2\n\nStaged initial content.\nWorking copy modification.\n")

    info = storage.get_restore_info("chapters/chapter-2.md")
    assert info["is_git"] is True
    assert info["has_committed_version"] is False
    assert info["has_staged_changes"] is True
    assert info["has_unstaged_changes"] is True
    assert info["can_restore_worktree_only"] is True
    assert info["can_restore_staged_and_unstage"] is True
    assert info["can_restore_committed"] is False

