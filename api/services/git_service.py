from pathlib import Path
from typing import Dict, Any, Optional, Set, List, Tuple
import os
import shutil
import stat
import subprocess
import sys
import tempfile


import re


def _normalize_markdown_content(text: str) -> str:
    """Normalize markdown content for comparison across editors and platforms.

    Normalizes:
    - Line endings (\r\n -> \n)
    - Heading spacing (ensures blank line between heading and following content block)
    - Consecutive empty lines
    - Trailing whitespace on lines and trailing newlines at EOF
    """
    if not text:
        return ""
    text = text.replace("\r\n", "\n")
    # Normalize heading followed immediately by content (ensure blank line between blocks)
    text = re.sub(r"(^|\n)(#{1,6}\s+[^\n]+)\n([^\n])", r"\1\2\n\n\3", text)
    # Collapse 3+ newlines to 2
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Strip trailing whitespace on each line and strip overall trailing newlines
    lines = [line.rstrip() for line in text.split("\n")]
    return "\n".join(lines).strip()


def _posix_rel(target: Path, base: Path) -> str:
    """Safely compute a POSIX relative path, case-insensitively on Windows/macOS."""
    try:
        return target.resolve().relative_to(base.resolve()).as_posix()
    except ValueError:
        t_parts = target.resolve().parts
        b_parts = base.resolve().parts
        if len(t_parts) >= len(b_parts) and [p.lower() for p in t_parts[:len(b_parts)]] == [p.lower() for p in b_parts]:
            return "/".join(t_parts[len(b_parts):])
        raise


def _write_text_lf(path: Path, content: str) -> None:
    """Write text file with explicit LF (\n) line endings and trailing EOF newline across all platforms."""
    path.parent.mkdir(parents=True, exist_ok=True)
    text = (content or "").replace("\r\n", "\n")
    if text and not text.endswith("\n"):
        text += "\n"
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def is_git_available() -> Dict[str, Any]:
    """Check if git is installed and discoverable on PATH."""
    git_bin = shutil.which("git")
    if not git_bin:
        return {"available": False, "version": None, "path": None}

    try:
        res = subprocess.run(
            [git_bin, "--version"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if res.returncode == 0:
            version_str = res.stdout.strip()
            return {"available": True, "version": version_str, "path": git_bin}
        return {"available": False, "version": None, "path": git_bin}
    except Exception:
        return {"available": False, "version": None, "path": git_bin}


DEFAULT_GITIGNORE_ENTRIES: List[str] = [
    "outputs/\n",
    ".margin-shadow/\n",
    ".DS_Store\n",
    "Thumbs.db\n",
    "*.tmp\n",
    "*.log\n",
    ".env\n",
    ".env.*\n",
]


def _ensure_gitignore(path_obj: Path) -> None:
    """Ensure .gitignore exists without clobbering existing entries."""
    gitignore_file = path_obj / ".gitignore"
    if gitignore_file.exists():
        try:
            existing_content = gitignore_file.read_text(encoding="utf-8", errors="replace")
            existing_lines = set(line.strip() for line in existing_content.splitlines())
            missing = [entry for entry in DEFAULT_GITIGNORE_ENTRIES if entry.strip() not in existing_lines]
            if missing:
                new_content = existing_content
                if not new_content.endswith("\n"):
                    new_content += "\n"
                new_content += "".join(missing)
                _write_text_lf(gitignore_file, new_content)
        except OSError:
            pass
    else:
        _write_text_lf(
            gitignore_file,
            "".join(DEFAULT_GITIGNORE_ENTRIES),
        )


def _ensure_git_author_config(subp, git_bin: str, path_obj: Path) -> None:
    """Configure local fallback author identity if not already set globally or locally."""
    try:
        chk_name = subp.run(
            [git_bin, "config", "user.name"],
            cwd=str(path_obj),
            capture_output=True,
            text=True,
            timeout=5,
        )
        if chk_name.returncode != 0 or not chk_name.stdout.strip():
            subp.run(
                [git_bin, "config", "user.name", "Margin"],
                cwd=str(path_obj),
                capture_output=True,
                text=True,
                timeout=5,
            )
        chk_email = subp.run(
            [git_bin, "config", "user.email"],
            cwd=str(path_obj),
            capture_output=True,
            text=True,
            timeout=5,
        )
        if chk_email.returncode != 0 or not chk_email.stdout.strip():
            subp.run(
                [git_bin, "config", "user.email", "margin@local"],
                cwd=str(path_obj),
                capture_output=True,
                text=True,
                timeout=5,
            )
    except (subprocess.SubprocessError, OSError):
        pass


def _run_git_init_command(subp, git_bin: str, path_obj: Path) -> bool:
    """Run git init, attempting with -b main first."""
    try:
        subp.run(
            [git_bin, "init", "-b", "main"],
            cwd=str(path_obj),
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        )
        return True
    except (subprocess.SubprocessError, OSError):
        try:
            subp.run(
                [git_bin, "init"],
                cwd=str(path_obj),
                capture_output=True,
                text=True,
                timeout=10,
                check=True,
            )
            return True
        except (subprocess.SubprocessError, OSError):
            return False


def _stage_and_commit_initial(subp, git_bin: str, path_obj: Path, git_info: Dict[str, Any]) -> None:
    """Stage all files and create the initial commit."""
    try:
        subp.run(
            [git_bin, "add", "--", "."],
            cwd=str(path_obj),
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        )
        git_info["staged"] = True
    except (subprocess.SubprocessError, OSError):
        git_info["error"] = "git add failed."
        return

    try:
        res_commit = subp.run(
            [git_bin, "commit", "-m", "Initial workspace scaffold"],
            cwd=str(path_obj),
            capture_output=True,
            text=True,
            timeout=10,
        )
        if res_commit.returncode == 0:
            git_info["committed"] = True
            git_info["staged"] = False
            try:
                subp.run(
                    [git_bin, "branch", "-M", "main"],
                    cwd=str(path_obj),
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
            except (subprocess.SubprocessError, OSError):
                pass
        else:
            git_info["committed"] = False
            git_info["staged"] = True
            stderr = res_commit.stderr.strip()
            git_info["error"] = (
                "Initial commit failed — Git user identity not configured. "
                "Run: git config --global user.name / user.email"
            ) if "user" in stderr.lower() else "Initial commit failed."
    except (subprocess.SubprocessError, OSError):
        git_info["committed"] = False
        git_info["staged"] = False
        git_info["error"] = "git add/commit failed."


def _init_git_repo(path_obj: Path, auto_commit: bool = True) -> Dict[str, Any]:
    """Initialize a git repository in path_obj, commit initial files.

    Returns a dict describing what was done:
    {
        "initialized": bool,
        "committed": bool,
        "staged": bool,
        "already_tracked": bool,
        "git_parent": str | None,
        "git_unavailable": bool,
        "init_failed": bool,
        "error": str | None
    }
    """
    file_storage = sys.modules.get("api.services.file_storage")
    if file_storage and hasattr(file_storage, "is_git_available"):
        git_check = file_storage.is_git_available()
    else:
        git_check = is_git_available()

    git_info: Dict[str, Any] = {
        "initialized": False,
        "committed": False,
        "staged": False,
        "already_tracked": False,
        "git_parent": None,
        "git_unavailable": False,
        "init_failed": False,
        "error": None,
    }

    if not git_check["available"]:
        git_info["git_unavailable"] = True
        git_info["error"] = "Git is not installed or not in PATH."
        return git_info

    git_bin = shutil.which("git") or "git"
    subp = getattr(file_storage, "subprocess", subprocess) if file_storage else subprocess

    # Check if path_obj is already inside a git work tree
    try:
        res = subp.run(
            [git_bin, "rev-parse", "--show-toplevel"],
            cwd=str(path_obj),
            capture_output=True,
            text=True,
            timeout=5,
        )
        if res.returncode == 0:
            top_level = res.stdout.strip()
            if (path_obj / ".git").is_dir() or top_level:
                _ensure_gitignore(path_obj)
                git_info["already_tracked"] = True
                git_info["git_parent"] = top_level
                return git_info
    except (subprocess.SubprocessError, OSError):
        pass

    _ensure_gitignore(path_obj)

    if not _run_git_init_command(subp, git_bin, path_obj):
        git_info["init_failed"] = True
        git_info["error"] = "git init failed."
        return git_info
    git_info["initialized"] = True

    _ensure_git_author_config(subp, git_bin, path_obj)

    if auto_commit:
        _stage_and_commit_initial(subp, git_bin, path_obj, git_info)

    return git_info


def is_git_repo(workspace_dir: Path) -> bool:
    """Check if the given workspace directory is inside a git work tree."""
    if not workspace_dir.exists() or not workspace_dir.is_dir():
        return False
    if (workspace_dir / ".git").exists():
        return True
    try:
        res = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=str(workspace_dir.resolve()),
            capture_output=True,
            text=True,
            timeout=5,
        )
        return res.returncode == 0 and res.stdout.strip() == "true"
    except (subprocess.SubprocessError, OSError):
        return False


def is_git_tracked(workspace_dir: Path, rel_path: str) -> bool:
    """Check if a specific workspace-relative file is tracked in git."""
    try:
        res = subprocess.run(
            ["git", "ls-files", "--error-unmatch", "--", rel_path],
            cwd=str(workspace_dir.resolve()),
            capture_output=True,
            timeout=5,
        )
        return res.returncode == 0
    except (subprocess.SubprocessError, OSError):
        return False


def _resolve_git_root(workspace_root: Path) -> Path:
    """Resolve the git repository root for workspace_root, falling back to workspace_root."""
    if (workspace_root / ".git").exists():
        return workspace_root
    try:
        res = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=str(workspace_root),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
        )
        if res.returncode == 0 and res.stdout.strip():
            return Path(res.stdout.strip()).resolve()
    except (subprocess.SubprocessError, OSError, ValueError):
        pass
    return workspace_root


def get_git_tracked_files(workspace_dir: Path) -> Set[str]:
    """Return the set of workspace-relative paths tracked in git."""
    tracked_files: Set[str] = set()
    if not is_git_repo(workspace_dir):
        return tracked_files

    workspace_root = workspace_dir.resolve()
    git_root = _resolve_git_root(workspace_root)

    res_ls = subprocess.run(
        ["git", "ls-files", "-z", "--full-name"],
        cwd=str(workspace_root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=10,
    )
    if res_ls.returncode != 0:
        raise RuntimeError(f"git ls-files failed: {res_ls.stderr or res_ls.stdout}")

    for p_str in res_ls.stdout.split("\x00"):
        if p_str:
            try:
                full_tracked_path = (git_root / Path(p_str)).resolve()
                rel = _posix_rel(full_tracked_path, workspace_root)
                tracked_files.add(rel)
            except (ValueError, OSError):
                pass

    return tracked_files


def get_git_deleted_files(workspace_dir: Path) -> List[str]:
    """Return markdown files that were tracked in git but are currently deleted."""
    deleted_files: List[str] = []
    if not is_git_repo(workspace_dir):
        return deleted_files

    workspace_root = workspace_dir.resolve()
    git_root = _resolve_git_root(workspace_root)

    res = subprocess.run(
        ["git", "status", "--porcelain=v1", "-z", "--", "."],
        cwd=str(workspace_root),
        capture_output=True,
        timeout=5,
    )
    if res.returncode != 0:
        raise RuntimeError("Git status failed")

    raw = res.stdout
    idx = 0
    n = len(raw)
    while idx < n:
        if idx + 3 > n:
            break
        x = chr(raw[idx])
        y = chr(raw[idx + 1])
        end = raw.find(b"\x00", idx + 3)
        if end == -1:
            path_bytes = raw[idx + 3:]
            idx = n
        else:
            path_bytes = raw[idx + 3:end]
            idx = end + 1

        if x in ("R", "C"):
            second_end = raw.find(b"\x00", idx)
            if second_end != -1:
                idx = second_end + 1
            else:
                idx = n

        p = path_bytes.decode("utf-8", errors="replace").replace("\\", "/")
        if (x == "D" or y == "D") and p.lower().endswith(".md"):
            try:
                full_p = (git_root / Path(p)).resolve()
                w_rel = _posix_rel(full_p, workspace_root)
                if not is_ignored_or_hidden_status_path(w_rel) and not full_p.exists():
                    deleted_files.append(w_rel)
            except (ValueError, OSError):
                pass

    return deleted_files


def get_git_rename_source(workspace_root: Path, rel_path: str) -> Optional[str]:
    """Check if rel_path was the target of a staged rename (R in git status)."""
    git_root = _resolve_git_root(workspace_root)

    try:
        res_status = subprocess.run(
            ["git", "status", "--porcelain=v1", "-z", "--", "."],
            cwd=str(workspace_root),
            capture_output=True,
            timeout=5,
        )
        if res_status.returncode != 0:
            return None

        raw = res_status.stdout
        i = 0
        n = len(raw)
        while i < n:
            if i + 3 > n:
                break
            x = chr(raw[i])
            path_end = raw.find(b"\0", i + 3)
            if path_end == -1:
                path_bytes = raw[i + 3:]
                i = n
            else:
                path_bytes = raw[i + 3:path_end]
                i = path_end + 1

            git_rel = path_bytes.decode("utf-8", errors="replace").replace("\\", "/")
            if x in ("R", "C"):
                second_end = raw.find(b"\0", i)
                if second_end != -1:
                    orig_path_bytes = raw[i:second_end]
                    i = second_end + 1
                    orig_git_rel = orig_path_bytes.decode("utf-8", errors="replace").replace("\\", "/")
                    try:
                        full_new = (git_root / Path(git_rel)).resolve()
                        w_new = _posix_rel(full_new, workspace_root)
                    except ValueError:
                        w_new = None
                    if w_new is not None and w_new == rel_path:
                        try:
                            if workspace_root.resolve() == git_root.resolve():
                                orig_candidate = orig_git_rel
                            else:
                                ws_rel = _posix_rel(workspace_root, git_root)
                                if orig_git_rel == ws_rel:
                                    orig_candidate = ""
                                elif orig_git_rel.startswith(ws_rel + "/"):
                                    orig_candidate = orig_git_rel[len(ws_rel) + 1:]
                                else:
                                    full_orig = (git_root / Path(orig_git_rel)).resolve()
                                    orig_candidate = _posix_rel(full_orig, workspace_root)
                            if (
                                not orig_candidate
                                or is_ignored_or_hidden_status_path(orig_candidate)
                                or not orig_candidate.lower().endswith(".md")
                            ):
                                return None
                            return orig_candidate
                        except ValueError:
                            return None
                else:
                    i = n
    except (subprocess.SubprocessError, OSError):
        return None

    return None


def stage_git_file(workspace_root: Path, rel_path: str, content: Optional[str] = None) -> Dict[str, Any]:
    """Stage a document in git."""
    full_path = workspace_root / Path(rel_path)
    if content is not None:
        _write_text_lf(full_path, content)
    else:
        if not full_path.exists():
            raise FileNotFoundError(f"File not found: {rel_path}")
        content = full_path.read_text(encoding="utf-8")

    res = subprocess.run(
        ["git", "add", "--", f"./{rel_path}"],
        cwd=str(workspace_root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=10,
    )
    if res.returncode != 0:
        res = subprocess.run(
            ["git", "add", "--", rel_path],
            cwd=str(workspace_root),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
    if res.returncode != 0:
        raise RuntimeError(f"Git stage failed: {res.stderr or res.stdout}")

    staged_content = content
    for spec in [f":./{rel_path}", f":{rel_path}"]:
        res_show = subprocess.run(
            ["git", "show", spec],
            cwd=str(workspace_root),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
        )
        if res_show.returncode == 0:
            staged_content = res_show.stdout
            break

    check_head_path = get_git_rename_source(workspace_root, rel_path) or rel_path
    has_committed_version = _check_has_committed_version(workspace_root, check_head_path)

    return {
        "success": True,
        "is_git": True,
        "base_content": staged_content,
        "has_committed_version": has_committed_version,
    }


def delete_git_file(workspace_root: Path, rel_path: str) -> bool:
    """Stage deletion of a tracked file in git."""
    res = subprocess.run(
        ["git", "rm", "-f", "--", rel_path],
        cwd=str(workspace_root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=5,
    )
    if res.returncode != 0:
        raise RuntimeError(f"Git rm failed: {res.stderr or res.stdout}")
    return True


def rename_git_file(workspace_root: Path, old_rel: str, new_rel: str) -> bool:
    """Stage rename of a tracked file in git."""
    res = subprocess.run(
        ["git", "mv", "-f", "--", old_rel, new_rel],
        cwd=str(workspace_root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=5,
    )
    if res.returncode == 0:
        return True

    # Fallback: rename on disk and git add + rm cached
    old_path = workspace_root / Path(old_rel)
    new_path = workspace_root / Path(new_rel)
    if old_path.exists():
        new_path.parent.mkdir(parents=True, exist_ok=True)
        old_path.rename(new_path)

    res_add = subprocess.run(
        ["git", "add", "--", new_rel],
        cwd=str(workspace_root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=5,
    )
    if res_add.returncode != 0:
        raise RuntimeError(f"Git add failed during rename fallback: {res_add.stderr or res_add.stdout}")

    res_rm = subprocess.run(
        ["git", "rm", "--cached", "-f", "--", old_rel],
        cwd=str(workspace_root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=5,
    )
    if res_rm.returncode != 0:
        raise RuntimeError(f"Git rm --cached failed during rename fallback: {res_rm.stderr or res_rm.stdout}")

    return True


def get_git_diff_base(workspace_root: Path, rel_path: str) -> Dict[str, Any]:
    """Resolve diff base content for a document from Git index or HEAD."""
    check_head_path = get_git_rename_source(workspace_root, rel_path) or rel_path
    has_committed_version = _check_has_committed_version(workspace_root, check_head_path)

    for spec in [f":0:{rel_path}", f":{rel_path}", f":./{rel_path}"]:
        try:
            res = subprocess.run(
                ["git", "show", spec],
                cwd=str(workspace_root),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=5,
            )
            if res.returncode == 0:
                return {
                    "is_git": True,
                    "base_content": res.stdout,
                    "has_base": True,
                    "is_new": False,
                    "tracked": True,
                    "has_committed_version": has_committed_version,
                }
        except (subprocess.SubprocessError, OSError):
            pass

    for spec in [f"HEAD:./{rel_path}", f"HEAD:{rel_path}"]:
        try:
            res = subprocess.run(
                ["git", "show", spec],
                cwd=str(workspace_root),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=5,
            )
            if res.returncode == 0:
                return {
                    "is_git": True,
                    "base_content": res.stdout,
                    "has_base": True,
                    "is_new": False,
                    "tracked": True,
                    "has_committed_version": has_committed_version,
                }
        except (subprocess.SubprocessError, OSError):
            pass

    return {
        "is_git": True,
        "base_content": None,
        "has_base": False,
        "is_new": True,
        "tracked": False,
        "has_committed_version": has_committed_version,
    }


def _check_has_committed_version(workspace_root: Path, path: str) -> bool:
    """Check if path exists in git HEAD."""
    try:
        res = subprocess.run(
            ["git", "cat-file", "-e", f"HEAD:./{path}"],
            cwd=str(workspace_root),
            capture_output=True,
            timeout=5,
        )
        return res.returncode == 0
    except (subprocess.SubprocessError, OSError):
        return False


def _check_file_staged_unstaged(
    workspace_root: Path, full_path: Path, rel_path: str, is_renamed: bool
) -> Tuple[bool, bool, bool, bool]:
    """Return (has_staged_changes, has_unstaged_changes, is_deleted, is_staged_deleted)."""
    x, y = " ", " "
    try:
        res_st = subprocess.run(
            ["git", "status", "--porcelain=v1", "-z", "--", f"./{rel_path}"],
            cwd=str(workspace_root),
            capture_output=True,
            timeout=5,
        )
        if res_st.returncode == 0 and len(res_st.stdout) >= 2:
            x, y = chr(res_st.stdout[0]), chr(res_st.stdout[1])
    except (subprocess.SubprocessError, OSError):
        pass

    has_staged = is_renamed or (x in ("A", "M", "D", "R", "C"))
    if not has_staged and not is_renamed:
        try:
            res_diff = subprocess.run(
                ["git", "diff", "--cached", "--quiet", "--", f"./{rel_path}"],
                cwd=str(workspace_root),
                capture_output=True,
                timeout=5,
            )
            has_staged = (res_diff.returncode == 1)
        except (subprocess.SubprocessError, OSError):
            pass

    has_unstaged = not full_path.exists() or (y in ("M", "D", "?"))
    if not has_unstaged:
        try:
            res_wt = subprocess.run(
                ["git", "diff", "--quiet", "--", f"./{rel_path}"],
                cwd=str(workspace_root),
                capture_output=True,
                timeout=5,
            )
            has_unstaged = (res_wt.returncode == 1)
        except (subprocess.SubprocessError, OSError):
            pass

    if has_unstaged and full_path.exists() and full_path.suffix.lower() == ".md" and (y == "M" or y == " "):
        try:
            base_content = _get_git_blob_content(workspace_root, rel_path)
            if base_content is not None:
                curr_text = full_path.read_text(encoding="utf-8")
                if _normalize_markdown_content(curr_text) == _normalize_markdown_content(base_content):
                    has_unstaged = False
        except (subprocess.SubprocessError, OSError, ValueError):
            pass

    is_staged_deleted = (x == "D")
    has_staged_blob = has_staged and not is_staged_deleted
    is_deleted = is_staged_deleted or (y == "D") or (not full_path.exists())
    return has_staged, has_unstaged, is_deleted, is_staged_deleted


def get_git_restore_info(workspace_root: Path, rel_path: str) -> Dict[str, Any]:
    """Get restore capabilities, options validity, and git rename context for a file."""
    full_path = workspace_root / Path(rel_path)
    renamed_from = get_git_rename_source(workspace_root, rel_path)
    is_renamed = renamed_from is not None

    check_head_path = renamed_from if is_renamed else rel_path
    has_committed_version = _check_has_committed_version(workspace_root, check_head_path)
    has_staged_changes, has_unstaged_changes, is_deleted, is_staged_deleted = _check_file_staged_unstaged(
        workspace_root, full_path, rel_path, is_renamed
    )

    has_staged_blob = has_staged_changes and not is_staged_deleted

    can_restore_worktree_only = has_staged_blob and has_unstaged_changes
    can_restore_staged_and_unstage = (
        (has_staged_blob and (has_unstaged_changes or not has_committed_version or is_renamed))
        or is_staged_deleted
    )
    can_restore_committed = has_committed_version

    return {
        "is_git": True,
        "path": rel_path,
        "fileName": full_path.name,
        "is_renamed": is_renamed,
        "renamed_from": renamed_from,
        "is_deleted": is_deleted,
        "has_committed_version": has_committed_version,
        "has_staged_changes": has_staged_changes,
        "has_unstaged_changes": has_unstaged_changes,
        "can_restore_worktree_only": can_restore_worktree_only,
        "can_restore_staged_and_unstage": can_restore_staged_and_unstage,
        "can_restore_committed": can_restore_committed,
    }


def _get_git_blob_content(workspace_root: Path, rel_path: str) -> Optional[str]:
    """Fast-path read index blob (:./path), falling back to HEAD:./path."""
    res_index = subprocess.run(
        ["git", "show", f":./{rel_path}"],
        cwd=str(workspace_root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=5,
    )
    if res_index.returncode == 0:
        return res_index.stdout

    res_head = subprocess.run(
        ["git", "show", f"HEAD:./{rel_path}"],
        cwd=str(workspace_root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=5,
    )
    if res_head.returncode == 0:
        return res_head.stdout
    return None


def resolve_git_file_status(
    w_rel: str,
    full_path: Path,
    workspace_root: Path,
    x: str,
    y: str,
) -> str:
    """Resolve canonical status code from git status X and Y characters."""
    renamed_from: Optional[str] = None
    if x == "R":
        renamed_from = get_git_rename_source(workspace_root, w_rel)
        if renamed_from:
            st = "staged_renamed_modified" if (y == "M" or y == "D") else "staged_renamed"
        else:
            st = "staged_modified" if (y == "M" or y == "D") else "staged"
    elif x == "D":
        st = "staged_deleted"
    elif y == "D":
        st = "unstaged_deleted"
    elif x in ("M", "A", "C") and y == "M":
        st = "staged_modified"
    elif x in ("M", "A", "C") and y == " ":
        st = "staged"
    elif x == " " and y == "M":
        st = "unstaged_modified"
    elif x == "?" and y == "?":
        st = "untracked"
    else:
        st = "unstaged_modified" if (y != " " or x != " ") else "clean"

    if full_path.suffix.lower() == ".md" and full_path.exists() and y == "M":
        try:
            base_content = _get_git_blob_content(workspace_root, w_rel)
            if base_content is not None:
                curr_text = full_path.read_text(encoding="utf-8")
                if _normalize_markdown_content(curr_text) == _normalize_markdown_content(base_content):
                    if x == "R":
                        st = "staged_renamed" if renamed_from else "staged"
                    elif x in ("M", "A", "C"):
                        st = "staged"
                    else:
                        st = "clean"
        except (subprocess.SubprocessError, OSError, ValueError):
            pass

    return st


def is_ignored_or_hidden_status_path(rel_path: str) -> bool:
    """True if rel_path is in outputs or contains any dot-prefixed path component."""
    norm = (rel_path or "").replace("\\", "/").lower()
    if norm == "outputs" or norm.startswith("outputs/"):
        return True
    parts = norm.split("/")
    return any(part.startswith(".") for part in parts if part)


def _parse_git_status_porcelain(raw: bytes, git_root: Path, workspace_root: Path) -> Dict[str, str]:
    """Parse git status --porcelain=v1 -z output into workspace statuses."""
    statuses: Dict[str, str] = {}
    i = 0
    n = len(raw)
    while i < n:
        if i + 3 > n:
            break
        x = chr(raw[i])
        y = chr(raw[i + 1])
        path_end = raw.find(b"\0", i + 3)
        if path_end == -1:
            path_bytes = raw[i + 3:]
            i = n
        else:
            path_bytes = raw[i + 3:path_end]
            i = path_end + 1

        git_rel_path = path_bytes.decode("utf-8", errors="replace").replace("\\", "/")
        if x in ("R", "C"):
            second_end = raw.find(b"\0", i)
            if second_end != -1:
                i = second_end + 1
            else:
                i = n

        full_path = (git_root / Path(git_rel_path)).resolve()
        try:
            w_rel = _posix_rel(full_path, workspace_root)
            if is_ignored_or_hidden_status_path(w_rel):
                continue
            statuses[w_rel] = resolve_git_file_status(
                w_rel, full_path, workspace_root, x, y
            )
        except ValueError:
            pass
    return statuses


def _populate_clean_markdown_statuses(workspace_root: Path, statuses: Dict[str, str], tracked_files: Set[str]) -> None:
    """Scan workspace for markdown files not in statuses and mark them clean if tracked."""
    for root, dirs, files in os.walk(workspace_root):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d.lower() != "outputs"]
        root_path = Path(root)
        for f_name in files:
            if f_name.lower().endswith(".md") and not f_name.startswith("."):
                f = root_path / f_name
                try:
                    rel = _posix_rel(f, workspace_root)
                    if rel not in statuses and rel in tracked_files:
                        statuses[rel] = "clean"
                except ValueError:
                    pass


def get_git_workspace_status(workspace_root: Path) -> Dict[str, str]:
    """Inspect git repository status and return dict of path -> status code."""
    git_root = _resolve_git_root(workspace_root)
    res = subprocess.run(
        ["git", "status", "--porcelain=v1", "-uall", "-z", "--", "."],
        cwd=str(workspace_root),
        capture_output=True,
        timeout=5,
    )
    if res.returncode != 0:
        raise RuntimeError("Git status failed")

    statuses = _parse_git_status_porcelain(res.stdout, git_root, workspace_root)
    tracked_files = get_git_tracked_files(workspace_root)
    _populate_clean_markdown_statuses(workspace_root, statuses, tracked_files)
    return statuses


VALID_RESTORE_MODES = ("worktree_only", "staged_and_unstage", "committed")


def _atomic_write_file_lf(target_path: Path, content: str) -> None:
    """Safely write content to target_path using an atomic temp file in the same directory."""
    target_path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{target_path.name}.", suffix=".tmp", dir=str(target_path.parent))
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            text = (content or "").replace("\r\n", "\n")
            if text and not text.endswith("\n"):
                text += "\n"
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, target_path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)


def _sync_manifest_for_rename(
    workspace_root: Path,
    renamed_from: str,
    rel_path: str,
    manifest_restore_fn=None,
    manifest_remove_fn=None,
    manifest_update_fn=None,
) -> None:
    """Synchronize manifest file when restoring a renamed file."""
    old_folder = renamed_from.split("/")[0] if "/" in renamed_from else None
    new_folder = rel_path.split("/")[0] if "/" in rel_path else None
    old_name = Path(renamed_from).name
    new_name = Path(rel_path).name

    if new_folder and new_folder != old_folder and manifest_remove_fn:
        new_manifest_rel = f"{new_folder}/{new_folder.upper()}.md"
        new_manifest_path = workspace_root / Path(new_manifest_rel)
        if new_manifest_path.exists():
            baseline_new = ""
            for spec in (f"HEAD:./{new_manifest_rel}", f":./{new_manifest_rel}"):
                try:
                    res_show = subprocess.run(
                        ["git", "show", spec],
                        cwd=str(workspace_root),
                        capture_output=True,
                        text=True,
                        encoding="utf-8",
                        errors="replace",
                        timeout=5,
                    )
                    if res_show.returncode == 0 and res_show.stdout:
                        baseline_new = res_show.stdout
                        break
                except (subprocess.SubprocessError, OSError):
                    pass
            if manifest_remove_fn(new_manifest_path, new_name, baseline_content=baseline_new):
                try:
                    res_rm_add = subprocess.run(
                        ["git", "add", "--", new_manifest_rel],
                        cwd=str(workspace_root),
                        capture_output=True,
                        text=True,
                        encoding="utf-8",
                        errors="replace",
                        timeout=5,
                    )
                    if res_rm_add.returncode != 0:
                        raise RuntimeError("Failed to update manifest in git")
                except subprocess.TimeoutExpired:
                    raise RuntimeError("Git add operation timed out")
                except (subprocess.SubprocessError, OSError):
                    pass

    if not old_folder:
        return
    manifest_rel = f"{old_folder}/{old_folder.upper()}.md"
    manifest_path = workspace_root / Path(manifest_rel)
    if not manifest_path.exists():
        return

    baseline_manifest = ""
    for spec in (f"HEAD:./{manifest_rel}", f":./{manifest_rel}"):
        try:
            res_show = subprocess.run(
                ["git", "show", spec],
                cwd=str(workspace_root),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=5,
            )
            if res_show.returncode == 0 and res_show.stdout:
                baseline_manifest = res_show.stdout
                break
        except (subprocess.SubprocessError, OSError):
            pass

    updated = False
    if old_folder == new_folder:
        if baseline_manifest and manifest_restore_fn:
            updated = manifest_restore_fn(manifest_path, old_name, baseline_manifest)
            if updated and manifest_remove_fn and old_name.lower() != new_name.lower():
                manifest_remove_fn(manifest_path, new_name, baseline_content=baseline_manifest)
        if not updated and manifest_update_fn:
            updated = manifest_update_fn(manifest_path, new_name, old_name, baseline_content=baseline_manifest)
        if not updated and manifest_remove_fn and old_name.lower() != new_name.lower():
            updated = manifest_remove_fn(manifest_path, new_name, baseline_content=baseline_manifest)
    else:
        if baseline_manifest and manifest_restore_fn:
            updated = manifest_restore_fn(manifest_path, old_name, baseline_manifest)

    if updated:
        try:
            res_add = subprocess.run(
                ["git", "add", "--", manifest_rel],
                cwd=str(workspace_root),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=5,
            )
            if res_add.returncode != 0:
                raise RuntimeError("Failed to update manifest in git")
        except subprocess.TimeoutExpired:
            raise RuntimeError("Git add operation timed out")
        except (subprocess.SubprocessError, OSError):
            pass


def _sync_manifest_for_file_restore(
    workspace_root: Path,
    rel_path: str,
    file_name: str,
    manifest_restore_fn=None,
    stage_manifest: bool = True,
) -> None:
    """Synchronize manifest entry for a standard restored file."""
    if "/" not in rel_path or not manifest_restore_fn:
        return
    folder = rel_path.split("/")[0]
    if file_name.upper() == f"{folder.upper()}.MD":
        return
    manifest_rel = f"{folder}/{folder.upper()}.md"
    manifest_path = workspace_root / Path(manifest_rel)

    baseline_manifest = ""
    specs = (
        (f":./{manifest_rel}", f"HEAD:./{manifest_rel}")
        if not stage_manifest
        else (f"HEAD:./{manifest_rel}", f":./{manifest_rel}")
    )
    for spec in specs:
        try:
            res_show = subprocess.run(
                ["git", "show", spec],
                cwd=str(workspace_root),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=5,
            )
            if res_show.returncode == 0 and res_show.stdout:
                baseline_manifest = res_show.stdout
                break
        except (subprocess.SubprocessError, OSError):
            continue

    if baseline_manifest and manifest_restore_fn(manifest_path, file_name, baseline_manifest) and stage_manifest:
        try:
            res_add = subprocess.run(
                ["git", "add", "--", manifest_rel],
                cwd=str(workspace_root),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=5,
            )
            if res_add.returncode != 0:
                raise RuntimeError("Failed to update manifest in git")
        except subprocess.TimeoutExpired:
            raise RuntimeError("Git add operation timed out")
        except (subprocess.SubprocessError, OSError):
            pass


def _restore_git_worktree_only(
    workspace_root: Path,
    rel_path: str,
    full_path: Path,
    manifest_restore_fn=None,
) -> Dict[str, Any]:
    """Restore staged version to worktree only."""
    was_deleted = not full_path.exists()
    res = subprocess.run(
        ["git", "restore", "--", f"./{rel_path}"],
        cwd=str(workspace_root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=10,
    )
    if res.returncode != 0:
        res = subprocess.run(
            ["git", "checkout", "--", f"./{rel_path}"],
            cwd=str(workspace_root),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
    if res.returncode != 0:
        raise RuntimeError(f"Git restore failed: {res.stderr or res.stdout}")

    restored_content = full_path.read_text(encoding="utf-8") if full_path.exists() else ""
    if was_deleted:
        _sync_manifest_for_file_restore(workspace_root, rel_path, full_path.name, manifest_restore_fn, stage_manifest=False)
    base_info = get_git_diff_base(workspace_root, rel_path)
    base_content = base_info.get("base_content", restored_content)
    return {
        "success": True,
        "is_git": True,
        "mode": "worktree_only",
        "restored_path": rel_path,
        "restored_content": restored_content,
        "base_content": base_content,
    }


def _checkout_orig_head_if_exists(workspace_root: Path, renamed_from: str) -> None:
    """If original path exists in HEAD, check it out."""
    res_in_head = subprocess.run(
        ["git", "cat-file", "-e", f"HEAD:./{renamed_from}"],
        cwd=str(workspace_root),
        capture_output=True,
        timeout=5,
    )
    if res_in_head.returncode == 0:
        res_checkout = subprocess.run(
            ["git", "checkout", "HEAD", "--", f"./{renamed_from}"],
            cwd=str(workspace_root),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
        if res_checkout.returncode != 0:
            raise RuntimeError(f"Git checkout of original file failed: {res_checkout.stderr or res_checkout.stdout}")


def _remove_staged_new_path(
    workspace_root: Path,
    rel_path: str,
    full_path: Path,
    orig_full_path: Optional[Path] = None,
) -> None:
    """Remove the staged new path from git and working tree."""
    is_case_only = False
    if orig_full_path is not None:
        try:
            if full_path.exists() and orig_full_path.exists():
                is_case_only = full_path.resolve() == orig_full_path.resolve()
            else:
                is_case_only = (
                    full_path.name.lower() == orig_full_path.name.lower()
                    and full_path.parent.resolve() == orig_full_path.parent.resolve()
                )
        except OSError:
            is_case_only = False

    rm_cmd = (
        ["git", "rm", "--cached", "-f", "--", f"./{rel_path}"]
        if is_case_only
        else ["git", "rm", "-f", "--", f"./{rel_path}"]
    )
    res_rm = subprocess.run(
        rm_cmd,
        cwd=str(workspace_root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=5,
    )
    if res_rm.returncode != 0:
        raise RuntimeError(f"Git rm failed: {res_rm.stderr or res_rm.stdout}")
    if full_path.exists() and not is_case_only:
        full_path.unlink(missing_ok=True)


def _restore_git_staged_rename(
    workspace_root: Path,
    rel_path: str,
    full_path: Path,
    renamed_from: str,
    manifest_restore_fn=None,
    manifest_remove_fn=None,
    manifest_update_fn=None,
) -> Dict[str, Any]:
    """Restore a staged rename: keep staged content, return to original filename, remove new name."""
    res_restore = subprocess.run(
        ["git", "restore", "--", f"./{rel_path}"],
        cwd=str(workspace_root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=10,
    )
    if res_restore.returncode != 0:
        res_checkout = subprocess.run(
            ["git", "checkout", "--", f"./{rel_path}"],
            cwd=str(workspace_root),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
        if res_checkout.returncode != 0:
            raise RuntimeError(f"Git restore failed: {res_checkout.stderr or res_restore.stderr}")
    if full_path.exists():
        staged_content = full_path.read_text(encoding="utf-8")
    else:
        staged_content = _get_git_blob_content(workspace_root, rel_path) or ""

    orig_full_path = workspace_root / Path(renamed_from)
    is_case_only = False
    try:
        is_case_only = (
            full_path.name.lower() == orig_full_path.name.lower()
            and full_path.parent.resolve() == orig_full_path.parent.resolve()
        )
    except OSError:
        is_case_only = False

    if not is_case_only:
        _checkout_orig_head_if_exists(workspace_root, renamed_from)
        _atomic_write_file_lf(orig_full_path, staged_content)
        _remove_staged_new_path(workspace_root, rel_path, full_path, orig_full_path)
    else:
        _remove_staged_new_path(workspace_root, rel_path, full_path, orig_full_path)
        _checkout_orig_head_if_exists(workspace_root, renamed_from)
        _atomic_write_file_lf(orig_full_path, staged_content)
    _sync_manifest_for_rename(workspace_root, renamed_from, rel_path, manifest_restore_fn, manifest_remove_fn, manifest_update_fn)

    base_content = _get_git_blob_content(workspace_root, renamed_from)

    return {
        "success": True,
        "is_git": True,
        "mode": "staged_and_unstage",
        "restored_path": renamed_from,
        "restored_content": staged_content,
        "base_content": base_content,
    }


def _unstage_git_path(workspace_root: Path, rel_path: str) -> None:
    """Unstage a file from git index."""
    res_in_head = subprocess.run(
        ["git", "cat-file", "-e", f"HEAD:./{rel_path}"],
        cwd=str(workspace_root),
        capture_output=True,
        timeout=5,
    )
    cmd_unstage = (
        ["git", "restore", "--staged", "--", f"./{rel_path}"]
        if res_in_head.returncode == 0
        else ["git", "rm", "--cached", "-f", "--", f"./{rel_path}"]
    )
    res_unstage = subprocess.run(
        cmd_unstage,
        cwd=str(workspace_root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=10,
    )
    if res_unstage.returncode != 0 and res_in_head.returncode == 0:
        res_unstage = subprocess.run(
            ["git", "reset", "HEAD", "--", f"./{rel_path}"],
            cwd=str(workspace_root),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
    if res_unstage.returncode != 0:
        raise RuntimeError(f"Git unstage failed: {res_unstage.stderr or res_unstage.stdout}")


def _restore_git_staged_standard(
    workspace_root: Path,
    rel_path: str,
    full_path: Path,
    manifest_restore_fn=None,
) -> Dict[str, Any]:
    """Restore staged version and unstage it for standard (non-rename) files."""
    was_deleted = not full_path.exists()
    res = subprocess.run(
        ["git", "restore", "--", f"./{rel_path}"],
        cwd=str(workspace_root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=10,
    )
    if res.returncode != 0:
        res = subprocess.run(
            ["git", "checkout", "--", f"./{rel_path}"],
            cwd=str(workspace_root),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
    if res.returncode != 0:
        res = subprocess.run(
            ["git", "checkout", "HEAD", "--", f"./{rel_path}"],
            cwd=str(workspace_root),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
    if res.returncode != 0:
        raise RuntimeError(f"Git restore failed: {res.stderr or res.stdout}")

    if was_deleted:
        _sync_manifest_for_file_restore(workspace_root, rel_path, full_path.name, manifest_restore_fn)
    _unstage_git_path(workspace_root, rel_path)

    restored_content = full_path.read_text(encoding="utf-8") if full_path.exists() else ""
    base_content = None
    res_show = subprocess.run(
        ["git", "show", f"HEAD:./{rel_path}"],
        cwd=str(workspace_root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=5,
    )
    if res_show.returncode == 0:
        base_content = res_show.stdout

    return {
        "success": True,
        "is_git": True,
        "mode": "staged_and_unstage",
        "restored_path": rel_path,
        "restored_content": restored_content,
        "base_content": base_content,
    }


def _restore_git_committed_rename(
    workspace_root: Path,
    rel_path: str,
    full_path: Path,
    renamed_from: str,
    manifest_restore_fn=None,
    manifest_remove_fn=None,
    manifest_update_fn=None,
) -> Dict[str, Any]:
    """Restore committed version of a renamed file (checkout HEAD of original name, delete renamed file)."""
    orig_full_path = workspace_root / Path(renamed_from)
    res = subprocess.run(
        ["git", "checkout", "HEAD", "--", f"./{renamed_from}"],
        cwd=str(workspace_root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=10,
    )
    if res.returncode != 0:
        raise RuntimeError(f"Git checkout of original file failed: {res.stderr or res.stdout}")

    _remove_staged_new_path(workspace_root, rel_path, full_path, orig_full_path)
    if not orig_full_path.exists():
        _checkout_orig_head_if_exists(workspace_root, renamed_from)
    _sync_manifest_for_rename(workspace_root, renamed_from, rel_path, manifest_restore_fn, manifest_remove_fn, manifest_update_fn)

    restored_content = orig_full_path.read_text(encoding="utf-8") if orig_full_path.exists() else ""
    return {
        "success": True,
        "is_git": True,
        "mode": "committed",
        "restored_path": renamed_from,
        "restored_content": restored_content,
        "base_content": restored_content,
    }


def _restore_git_committed_standard(
    workspace_root: Path,
    rel_path: str,
    full_path: Path,
    manifest_restore_fn=None,
) -> Dict[str, Any]:
    """Restore standard file to committed HEAD version."""
    was_deleted = not full_path.exists()
    res = subprocess.run(
        ["git", "checkout", "HEAD", "--", f"./{rel_path}"],
        cwd=str(workspace_root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=10,
    )
    if res.returncode != 0:
        res = subprocess.run(
            ["git", "restore", "--source=HEAD", "--staged", "--worktree", "--", f"./{rel_path}"],
            cwd=str(workspace_root),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
    if res.returncode != 0:
        raise RuntimeError(f"Git restore committed failed: {res.stderr or res.stdout}")

    restored_content = full_path.read_text(encoding="utf-8") if full_path.exists() else ""
    if was_deleted:
        _sync_manifest_for_file_restore(workspace_root, rel_path, full_path.name, manifest_restore_fn)

    return {
        "success": True,
        "is_git": True,
        "mode": "committed",
        "restored_path": rel_path,
        "restored_content": restored_content,
        "base_content": restored_content,
    }


def restore_git_file(
    workspace_root: Path,
    rel_path: str,
    mode: str = "committed",
    manifest_restore_fn=None,
    manifest_remove_fn=None,
    manifest_update_fn=None,
) -> Dict[str, Any]:
    """Restore a file in git according to selected mode:
    - 'worktree_only': restore staged version to worktree only
    - 'staged_and_unstage': restore staged version and unstage it
    - 'committed': restore to committed version from HEAD
    """
    full_path = workspace_root / Path(rel_path)
    if not isinstance(mode, str) or mode.strip().lower() not in VALID_RESTORE_MODES:
        raise ValueError(f"Invalid restore mode: {mode}")
    mode = mode.strip().lower()

    # Enforce capabilities server-side before mutating repository
    info = get_git_restore_info(workspace_root, rel_path)
    if mode == "worktree_only" and not info.get("can_restore_worktree_only"):
        raise ValueError(f"Restore mode 'worktree_only' is not available for '{rel_path}'")
    if mode == "staged_and_unstage" and not info.get("can_restore_staged_and_unstage"):
        raise ValueError(f"Restore mode 'staged_and_unstage' is not available for '{rel_path}'")
    if mode == "committed" and not info.get("can_restore_committed"):
        raise ValueError(f"Restore mode 'committed' is not available for '{rel_path}'")

    renamed_from = info.get("renamed_from")

    if mode == "worktree_only":
        return _restore_git_worktree_only(workspace_root, rel_path, full_path, manifest_restore_fn)
    if mode == "staged_and_unstage":
        if renamed_from:
            return _restore_git_staged_rename(
                workspace_root,
                rel_path,
                full_path,
                renamed_from,
                manifest_restore_fn,
                manifest_remove_fn,
                manifest_update_fn,
            )
        return _restore_git_staged_standard(workspace_root, rel_path, full_path, manifest_restore_fn)

    # mode == "committed"
    if renamed_from:
        return _restore_git_committed_rename(
            workspace_root,
            rel_path,
            full_path,
            renamed_from,
            manifest_restore_fn,
            manifest_remove_fn,
            manifest_update_fn,
        )
    return _restore_git_committed_standard(workspace_root, rel_path, full_path, manifest_restore_fn)


def _handle_remove_readonly(func, target_path, exc_info):
    """Clear the read-only bit and retry."""
    try:
        os.chmod(target_path, stat.S_IWRITE | stat.S_IREAD)
        func(target_path)
    except (subprocess.SubprocessError, OSError):
        pass


def remove_git_repo(path: Path) -> None:
    """Delete path/.git directory if it exists, handling read-only files on Windows."""
    git_dir = path / ".git"
    if git_dir.is_dir():
        if sys.version_info >= (3, 12):
            shutil.rmtree(git_dir, onexc=lambda func, p, exc: _handle_remove_readonly(func, p, None))
        else:
            shutil.rmtree(git_dir, onerror=_handle_remove_readonly)
        if git_dir.exists():
            raise RuntimeError("Failed to completely remove .git directory.")
