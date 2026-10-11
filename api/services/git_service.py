from pathlib import Path
from typing import Dict, Any, Optional, Set, List
import os
import shutil
import subprocess
import sys


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


def _init_git_repo(path_obj: Path) -> Dict[str, Any]:
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
            # If path_obj itself is the repo root and already has a .git
            if (path_obj / ".git").is_dir():
                git_info["already_tracked"] = True
                git_info["git_parent"] = top_level
                return git_info
            if top_level:
                git_info["already_tracked"] = True
                git_info["git_parent"] = top_level
                return git_info
    except Exception:
        pass

    # Always write/overwrite .gitignore before init
    gitignore_file = path_obj / ".gitignore"
    _write_text_lf(
        gitignore_file,
        "outputs/\n"
        ".margin-shadow/\n"
        ".DS_Store\n"
        "Thumbs.db\n"
        "*.tmp\n"
        "*.log\n",
    )

    try:
        subp.run(
            [git_bin, "init", "-b", "main"],
            cwd=str(path_obj),
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        )
        git_info["initialized"] = True
    except Exception:
        try:
            subp.run(
                [git_bin, "init"],
                cwd=str(path_obj),
                capture_output=True,
                text=True,
                timeout=10,
                check=True,
            )
            git_info["initialized"] = True
        except Exception:
            git_info["init_failed"] = True
            git_info["error"] = "git init failed."
            return git_info

    # Configure local fallback author identity if not already set globally or locally
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
    except Exception:
        pass

    # Stage initial files
    try:
        subp.run(
            [git_bin, "add", "."],
            cwd=str(path_obj),
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        )
        git_info["staged"] = True
    except Exception:
        git_info["error"] = "git add failed."
        return git_info

    # Initial commit (commit message matching tests)
    try:
        res_commit = subp.run(
            [
                git_bin,
                "commit",
                "-m", "Initial workspace scaffold",
            ],
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
            except Exception:
                pass
        else:
            git_info["committed"] = False
            git_info["staged"] = True
            stderr = res_commit.stderr.strip()
            git_info["error"] = (
                "Initial commit failed — Git user identity not configured. "
                "Run: git config --global user.name / user.email"
            ) if "user" in stderr.lower() else "Initial commit failed."
    except Exception:
        git_info["committed"] = False
        git_info["staged"] = False
        git_info["error"] = "git add/commit failed."

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


def get_git_tracked_files(workspace_dir: Path) -> Set[str]:
    """Return the set of workspace-relative paths tracked in git."""
    tracked_files: Set[str] = set()
    if not is_git_repo(workspace_dir):
        return tracked_files

    workspace_root = workspace_dir.resolve()
    git_root = workspace_root
    if not (workspace_root / ".git").exists():
        try:
            res_top = subprocess.run(
                ["git", "rev-parse", "--show-toplevel"],
                cwd=str(workspace_root),
                capture_output=True,
                text=True,
                timeout=5,
            )
            if res_top.returncode == 0:
                git_root = Path(res_top.stdout.strip()).resolve()
        except (subprocess.SubprocessError, OSError):
            git_root = workspace_root

    try:
        res_ls = subprocess.run(
            ["git", "ls-files", "-z"],
            cwd=str(workspace_root),
            capture_output=True,
            timeout=10,
        )
        if res_ls.returncode == 0:
            for raw_path in res_ls.stdout.split(b"\x00"):
                if raw_path:
                    try:
                        p_str = raw_path.decode("utf-8", errors="replace")
                        full_tracked_path = (git_root / Path(p_str)).resolve()
                        rel = _posix_rel(full_tracked_path, workspace_root)
                        tracked_files.add(rel)
                    except (ValueError, OSError):
                        pass
    except (subprocess.SubprocessError, OSError):
        pass

    return tracked_files


def get_git_deleted_files(workspace_dir: Path) -> List[str]:
    """Return markdown files that were tracked in git but are currently deleted."""
    deleted_files: List[str] = []
    if not is_git_repo(workspace_dir):
        return deleted_files

    workspace_root = workspace_dir.resolve()
    try:
        res = subprocess.run(
            ["git", "status", "--porcelain=v1", "-z"],
            cwd=str(workspace_root),
            capture_output=True,
            timeout=5,
        )
        if res.returncode == 0:
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

                if x == "R":
                    second_end = raw.find(b"\x00", idx)
                    if second_end != -1:
                        idx = second_end + 1

                p = path_bytes.decode("utf-8", errors="replace").replace("\\", "/")
                if (x == "D" or y == "D") and p.lower().endswith(".md") and not Path(p).name.startswith("."):
                    full_p = workspace_root / Path(p)
                    if not full_p.exists():
                        deleted_files.append(p)
    except (subprocess.SubprocessError, OSError):
        pass

    return deleted_files


def get_git_rename_source(workspace_root: Path, rel_path: str) -> Optional[str]:
    """Check if rel_path was the target of a staged rename (R in git status)."""
    if (workspace_root / ".git").exists():
        git_root = workspace_root
    else:
        try:
            res_top = subprocess.run(
                ["git", "rev-parse", "--show-toplevel"],
                cwd=str(workspace_root),
                capture_output=True,
                text=True,
                timeout=5,
            )
            git_root = Path(res_top.stdout.strip()).resolve() if res_top.returncode == 0 else workspace_root
        except (subprocess.SubprocessError, OSError):
            git_root = workspace_root

    try:
        res_status = subprocess.run(
            ["git", "status", "--porcelain=v1", "-z"],
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
            if x == "R":
                second_end = raw.find(b"\0", i)
                if second_end != -1:
                    orig_path_bytes = raw[i:second_end]
                    i = second_end + 1
                    orig_git_rel = orig_path_bytes.decode("utf-8", errors="replace").replace("\\", "/")
                    try:
                        full_new = (git_root / Path(git_rel)).resolve()
                        full_orig = (git_root / Path(orig_git_rel)).resolve()
                        w_new = _posix_rel(full_new, workspace_root)
                        w_orig = _posix_rel(full_orig, workspace_root)
                        if w_new == rel_path or git_rel.strip("/") == rel_path.strip("/"):
                            return w_orig
                    except ValueError:
                        if git_rel.strip("/") == rel_path.strip("/"):
                            return orig_git_rel.strip("/")
    except (subprocess.SubprocessError, OSError):
        return None

    return None


def stage_git_file(workspace_root: Path, rel_path: str, content: Optional[str] = None) -> Dict[str, Any]:
    """Stage a document in git."""
    full_path = workspace_root / Path(rel_path)
    if content is not None:
        _write_text_lf(full_path, content)
    else:
        content = full_path.read_text(encoding="utf-8") if full_path.exists() else ""

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

    has_committed_version = False
    try:
        res_head = subprocess.run(
            ["git", "cat-file", "-e", f"HEAD:./{rel_path}"],
            cwd=str(workspace_root),
            capture_output=True,
            timeout=5,
        )
        has_committed_version = (res_head.returncode == 0)
    except (subprocess.SubprocessError, OSError):
        has_committed_version = False

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
        timeout=5,
    )
    if res.returncode != 0:
        # Fallback: rename on disk and git add
        old_path = workspace_root / Path(old_rel)
        new_path = workspace_root / Path(new_rel)
        if old_path.exists():
            old_path.rename(new_path)
        subprocess.run(["git", "add", "--", new_rel], cwd=str(workspace_root), capture_output=True, timeout=5)
        subprocess.run(["git", "rm", "--cached", "-f", "--", old_rel], cwd=str(workspace_root), capture_output=True, timeout=5)
    return True


def get_git_diff_base(workspace_root: Path, rel_path: str) -> Dict[str, Any]:
    """Resolve diff base content for a document from Git index or HEAD."""
    has_committed_version = False
    try:
        res_head = subprocess.run(
            ["git", "cat-file", "-e", f"HEAD:./{rel_path}"],
            cwd=str(workspace_root),
            capture_output=True,
            timeout=5,
        )
        has_committed_version = (res_head.returncode == 0)
    except (subprocess.SubprocessError, OSError):
        has_committed_version = False

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


def get_git_restore_info(workspace_root: Path, rel_path: str) -> Dict[str, Any]:
    """Get restore capabilities, options validity, and git rename context for a file."""
    full_path = workspace_root / Path(rel_path)
    renamed_from = get_git_rename_source(workspace_root, rel_path)
    is_renamed = renamed_from is not None

    has_committed_version = False
    check_head_path = renamed_from if is_renamed else rel_path
    try:
        res_head = subprocess.run(
            ["git", "cat-file", "-e", f"HEAD:./{check_head_path}"],
            cwd=str(workspace_root),
            capture_output=True,
            timeout=5,
        )
        has_committed_version = (res_head.returncode == 0)
    except (subprocess.SubprocessError, OSError):
        has_committed_version = False

    has_staged_changes = False
    if is_renamed:
        has_staged_changes = True
    else:
        try:
            res_diff_cached = subprocess.run(
                ["git", "diff", "--cached", "--quiet", "--", f"./{rel_path}"],
                cwd=str(workspace_root),
                capture_output=True,
                timeout=5,
            )
            if res_diff_cached.returncode == 1:
                has_staged_changes = True
            else:
                res_status = subprocess.run(
                    ["git", "status", "--porcelain=v1", "-z", "--", f"./{rel_path}"],
                    cwd=str(workspace_root),
                    capture_output=True,
                    timeout=5,
                )
                if res_status.returncode == 0 and len(res_status.stdout) >= 2:
                    x = chr(res_status.stdout[0])
                    if x in ("A", "D", "R", "C"):
                        has_staged_changes = True
        except (subprocess.SubprocessError, OSError):
            has_staged_changes = False

    has_unstaged_changes = False
    try:
        if not full_path.exists():
            has_unstaged_changes = True
        else:
            res_diff_wt = subprocess.run(
                ["git", "diff", "--quiet", "--", f"./{rel_path}"],
                cwd=str(workspace_root),
                capture_output=True,
                timeout=5,
            )
            if res_diff_wt.returncode == 1:
                has_unstaged_changes = True
            elif not has_staged_changes:
                res_st = subprocess.run(
                    ["git", "status", "--porcelain=v1", "-z", "--", f"./{rel_path}"],
                    cwd=str(workspace_root),
                    capture_output=True,
                    timeout=5,
                )
                if res_st.returncode == 0 and len(res_st.stdout) >= 2:
                    y = chr(res_st.stdout[1])
                    if y in ("M", "D", "?"):
                        has_unstaged_changes = True
    except (subprocess.SubprocessError, OSError):
        has_unstaged_changes = False

    is_deleted = False
    try:
        res_del = subprocess.run(
            ["git", "status", "--porcelain=v1", "-z", "--", f"./{rel_path}"],
            cwd=str(workspace_root),
            capture_output=True,
            timeout=5,
        )
        if res_del.returncode == 0 and len(res_del.stdout) >= 2:
            x = chr(res_del.stdout[0])
            y = chr(res_del.stdout[1])
            if x == "D" or y == "D":
                is_deleted = True
    except (subprocess.SubprocessError, OSError):
        is_deleted = False

    can_restore_worktree_only = has_staged_changes and has_unstaged_changes and not is_deleted
    can_restore_staged_and_unstage = (
        has_staged_changes
        and (has_unstaged_changes or not has_committed_version or is_renamed)
        and not is_deleted
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


def resolve_git_file_status(
    w_rel: str,
    full_path: Path,
    workspace_root: Path,
    x: str,
    y: str,
) -> str:
    """Resolve canonical status code from git status X and Y characters."""
    if x == "R":
        st = "staged_renamed_modified" if (y == "M" or y == "D") else "staged_renamed"
    elif x == "D":
        st = "staged_deleted"
    elif y == "D":
        st = "unstaged_deleted"
    elif x in ("M", "A", "C") and y in ("M", "D"):
        st = "staged_modified"
    elif x in ("M", "A", "C") and y == " ":
        st = "staged"
    elif (x == " " and y in ("M", "D")) or (x == "?" and y == "?"):
        if (x == "?" and y == "?") and full_path.exists() and (full_path.stat().st_size == 0 or not full_path.read_text(encoding="utf-8", errors="replace").strip()):
            st = "clean"
        else:
            st = "unstaged_modified"
    else:
        st = "unstaged_modified" if (y != " " or x != " ") else "clean"

    if full_path.suffix.lower() == ".md" and full_path.exists():
        if y == "M":
            try:
                base_info = get_git_diff_base(workspace_root, w_rel)
                if base_info.get("has_base") and base_info.get("base_content") is not None:
                    curr_text = full_path.read_text(encoding="utf-8")
                    if _normalize_markdown_content(curr_text) == _normalize_markdown_content(base_info["base_content"]):
                        if x == "R":
                            st = "staged_renamed"
                        elif x in ("M", "A", "C"):
                            st = "staged"
                        else:
                            st = "clean"
            except (subprocess.SubprocessError, OSError, ValueError):
                pass

    return st


def get_git_workspace_status(workspace_root: Path) -> Dict[str, str]:
    """Inspect git repository status and return dict of path -> status code."""
    statuses: Dict[str, str] = {}
    try:
        if (workspace_root / ".git").exists():
            git_root = workspace_root
        else:
            res_top = subprocess.run(
                ["git", "rev-parse", "--show-toplevel"],
                cwd=str(workspace_root),
                capture_output=True,
                text=True,
                timeout=5,
            )
            git_root = Path(res_top.stdout.strip()).resolve() if res_top.returncode == 0 else workspace_root

        res = subprocess.run(
            ["git", "status", "--porcelain=v1", "-uall", "-z", "--", "."],
            cwd=str(workspace_root),
            capture_output=True,
            timeout=5,
        )
        if res.returncode != 0:
            raise RuntimeError("Git status failed")

        raw = res.stdout
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
            if x == "R":
                second_end = raw.find(b"\0", i)
                if second_end != -1:
                    i = second_end + 1

            full_path = (git_root / Path(git_rel_path)).resolve()
            try:
                w_rel = _posix_rel(full_path, workspace_root)
                if (w_rel.startswith(".") and not w_rel.startswith(".margin")) or "/." in w_rel or w_rel.startswith("outputs/") or w_rel == "outputs":
                    continue
                statuses[w_rel] = resolve_git_file_status(
                    w_rel, full_path, workspace_root, x, y
                )
            except ValueError:
                pass

        for f in workspace_root.rglob("*.md"):
            if f.is_file() and not f.name.startswith("."):
                try:
                    rel = _posix_rel(f, workspace_root)
                    if rel.startswith("outputs/") or rel == "outputs":
                        continue
                    if rel not in statuses:
                        statuses[rel] = "clean"
                except ValueError:
                    pass

    except Exception:
        pass

    return statuses


def restore_git_file(
    workspace_root: Path,
    rel_path: str,
    mode: str = "committed",
    manifest_restore_fn=None,
    manifest_remove_fn=None,
) -> Dict[str, Any]:
    """Restore a file in git according to selected mode:
    - 'worktree_only': restore staged version to worktree only
    - 'staged_and_unstage': restore staged version and unstage it
    - 'committed': restore to committed version from HEAD
    """
    full_path = workspace_root / Path(rel_path)
    mode = (mode or "committed").strip().lower()
    if mode not in ("worktree_only", "staged_and_unstage", "committed"):
        mode = "committed"

    renamed_from = get_git_rename_source(workspace_root, rel_path)

    if mode == "worktree_only":
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

    elif mode == "staged_and_unstage":
        if renamed_from:
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
                subprocess.run(
                    ["git", "checkout", "--", f"./{rel_path}"],
                    cwd=str(workspace_root),
                    capture_output=True,
                    timeout=10,
                )
            staged_content = full_path.read_text(encoding="utf-8") if full_path.exists() else ""

            orig_full_path = workspace_root / Path(renamed_from)
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

            subprocess.run(
                ["git", "rm", "-f", "--", f"./{rel_path}"],
                cwd=str(workspace_root),
                capture_output=True,
                timeout=5,
            )
            if full_path.exists():
                full_path.unlink(missing_ok=True)

            _write_text_lf(orig_full_path, staged_content)

            if "/" in renamed_from and manifest_remove_fn and manifest_restore_fn:
                folder = renamed_from.split("/")[0]
                manifest_rel = f"{folder}/{folder.upper()}.md"
                manifest_path = workspace_root / Path(manifest_rel)
                res_show = subprocess.run(
                    ["git", "show", f"HEAD:{manifest_rel}"],
                    cwd=str(workspace_root),
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=5,
                )
                if res_show.returncode == 0 and res_show.stdout:
                    manifest_remove_fn(manifest_path, full_path.name)
                    manifest_restore_fn(manifest_path, res_show.stdout, orig_full_path.name)
                    try:
                        subprocess.run(
                            ["git", "checkout", "HEAD", "--", manifest_rel],
                            cwd=str(workspace_root),
                            capture_output=True,
                            timeout=5,
                        )
                    except Exception:
                        pass

            base_content = None
            res_base = subprocess.run(
                ["git", "show", f"HEAD:./{renamed_from}"],
                cwd=str(workspace_root),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=5,
            )
            if res_base.returncode == 0:
                base_content = res_base.stdout

            return {
                "success": True,
                "is_git": True,
                "mode": "staged_and_unstage",
                "restored_path": renamed_from,
                "restored_content": staged_content,
                "base_content": base_content,
            }

        else:
            if not full_path.exists():
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
                    raise RuntimeError(f"Git checkout failed: {res.stderr or res.stdout}")

                if "/" in rel_path and manifest_restore_fn:
                    folder = rel_path.split("/")[0]
                    manifest_rel = f"{folder}/{folder.upper()}.md"
                    manifest_path = workspace_root / Path(manifest_rel)
                    if full_path.name.upper() != f"{folder.upper()}.MD":
                        res_show = subprocess.run(
                            ["git", "show", f"HEAD:{manifest_rel}"],
                            cwd=str(workspace_root),
                            capture_output=True,
                            text=True,
                            encoding="utf-8",
                            errors="replace",
                            timeout=5,
                        )
                        if res_show.returncode == 0 and res_show.stdout:
                            if manifest_restore_fn(manifest_path, res_show.stdout, full_path.name):
                                try:
                                    subprocess.run(
                                        ["git", "add", "--", manifest_rel],
                                        cwd=str(workspace_root),
                                        capture_output=True,
                                        timeout=5,
                                    )
                                except Exception:
                                    pass
            else:
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
                    subprocess.run(
                        ["git", "checkout", "--", f"./{rel_path}"],
                        cwd=str(workspace_root),
                        capture_output=True,
                        timeout=10,
                    )

                res_in_head = subprocess.run(
                    ["git", "cat-file", "-e", f"HEAD:./{rel_path}"],
                    cwd=str(workspace_root),
                    capture_output=True,
                    timeout=5,
                )
                if res_in_head.returncode == 0:
                    res_unstage = subprocess.run(
                        ["git", "restore", "--staged", "--", f"./{rel_path}"],
                        cwd=str(workspace_root),
                        capture_output=True,
                        text=True,
                        encoding="utf-8",
                        errors="replace",
                        timeout=10,
                    )
                    if res_unstage.returncode != 0:
                        res_unstage = subprocess.run(
                            ["git", "reset", "HEAD", "--", f"./{rel_path}"],
                            cwd=str(workspace_root),
                            capture_output=True,
                            timeout=10,
                        )
                else:
                    res_unstage = subprocess.run(
                        ["git", "rm", "--cached", "--", f"./{rel_path}"],
                        cwd=str(workspace_root),
                        capture_output=True,
                        timeout=10,
                    )
                if res_unstage.returncode != 0:
                    raise RuntimeError(f"Git unstage failed: {res_unstage.stderr or res_unstage.stdout}")

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

    else:
        # mode == "committed"
        if renamed_from:
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

            subprocess.run(
                ["git", "rm", "-f", "--", f"./{rel_path}"],
                cwd=str(workspace_root),
                capture_output=True,
                timeout=5,
            )
            if full_path.exists():
                full_path.unlink(missing_ok=True)

            if "/" in renamed_from and manifest_remove_fn and manifest_restore_fn:
                folder = renamed_from.split("/")[0]
                manifest_rel = f"{folder}/{folder.upper()}.md"
                manifest_path = workspace_root / Path(manifest_rel)
                res_show = subprocess.run(
                    ["git", "show", f"HEAD:{manifest_rel}"],
                    cwd=str(workspace_root),
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=5,
                )
                if res_show.returncode == 0 and res_show.stdout:
                    manifest_remove_fn(manifest_path, full_path.name)
                    manifest_restore_fn(manifest_path, res_show.stdout, orig_full_path.name)
                    try:
                        res_add = subprocess.run(
                            ["git", "add", "--", manifest_rel],
                            cwd=str(workspace_root),
                            capture_output=True,
                            timeout=5,
                        )
                        if res_add.returncode != 0:
                            raise RuntimeError("Failed to update manifest in git")
                    except subprocess.TimeoutExpired:
                        raise RuntimeError("Git add operation timed out")
                    except Exception as e:
                        if isinstance(e, RuntimeError):
                            raise
                        raise RuntimeError("Git add operation failed")

            restored_content = orig_full_path.read_text(encoding="utf-8") if orig_full_path.exists() else ""
            return {
                "success": True,
                "is_git": True,
                "mode": "committed",
                "restored_path": renamed_from,
                "restored_content": restored_content,
                "base_content": restored_content,
            }

        # Standard checkout for non-rename files
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
                ["git", "restore", "--source=HEAD", "--staged", "--worktree", "--", f"./{rel_path}"],
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

        if "/" in rel_path and manifest_restore_fn:
            folder = rel_path.split("/")[0]
            manifest_rel = f"{folder}/{folder.upper()}.md"
            manifest_path = workspace_root / Path(manifest_rel)
            if full_path.name.upper() != f"{folder.upper()}.MD":
                baseline_manifest = ""
                for spec in [f"HEAD:{manifest_rel}", f":{manifest_rel}"]:
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
                        baseline_manifest = res_show.stdout
                        break
                if baseline_manifest:
                    if manifest_restore_fn(manifest_path, baseline_manifest, full_path.name):
                        try:
                            res_add = subprocess.run(
                                ["git", "add", "--", manifest_rel],
                                cwd=str(workspace_root),
                                capture_output=True,
                                timeout=5,
                            )
                            if res_add.returncode != 0:
                                raise RuntimeError("Failed to update manifest in git")
                        except subprocess.TimeoutExpired:
                            raise RuntimeError("Git add operation timed out")
                        except Exception as e:
                            if isinstance(e, RuntimeError):
                                raise
                            raise RuntimeError("Git add operation failed")

        return {
            "success": True,
            "is_git": True,
            "mode": "committed",
            "restored_path": rel_path,
            "restored_content": restored_content,
            "base_content": restored_content,
        }


def remove_git_repo(path: Path) -> None:
    """Delete path/.git directory if it exists."""
    git_dir = path / ".git"
    if git_dir.is_dir():
        shutil.rmtree(git_dir)
