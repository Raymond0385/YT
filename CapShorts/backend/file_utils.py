"""
file_utils.py - small, side-effect-light helpers for exports and temp-file housekeeping.
"""

import os
import re
import shutil
import time
from typing import Iterable, List, Optional


def contained_path(base_dir: str, name: str) -> Optional[str]:
    """
    Returns base_dir/<basename of name> if it stays inside base_dir, else None.

    Containment is checked on the *directory* (resolved the same way for both sides) and the
    file itself must not be a symlink. Comparing realpath(base) with realpath(file) breaks on
    sandboxed / virtualized profiles (MSIX), where a file resolves into a different tree than its folder.
    """
    if not name or not isinstance(name, str):
        return None
    raw = name.strip()
    if chr(0) in raw or ".." in raw or raw.startswith(("/", chr(92))) or (len(raw) > 1 and raw[1] == ":"):
        return None
    clean = os.path.basename(raw.replace(chr(92), "/"))
    if not clean or clean in (".", ".."):
        return None
    target = os.path.join(base_dir, clean)
    if os.path.realpath(os.path.dirname(target)) != os.path.realpath(base_dir):
        return None
    if os.path.islink(target):
        return None
    return target


def unique_path(directory: str, filename: str) -> str:
    """directory/filename, or 'name (2).ext', 'name (3).ext'... if it already exists."""
    stem, ext = os.path.splitext(filename)
    candidate = os.path.join(directory, filename)
    n = 2
    while os.path.exists(candidate):
        candidate = os.path.join(directory, f"{stem} ({n}){ext}")
        n += 1
    return candidate


def clean_filename(name: str, default: str = "capshorts_export.mp4") -> str:
    """Strips path parts and characters Windows does not allow; keeps it ending in .mp4."""
    base = (name or "").strip().replace(chr(92), "/").split("/")[-1]
    base = re.sub(r'[<>:"|?*' + chr(0) + r']+', "_", base).strip(" .")
    if not base:
        base = default
    if not base.lower().endswith(".mp4"):
        base += ".mp4"
    return base


def cleanup_old_files(directory: str, prefixes: Iterable[str], max_age_seconds: float,
                      now: Optional[float] = None) -> List[str]:
    """
    Deletes regular files in `directory` (non-recursive) whose name starts with one of `prefixes`
    and whose modification time is older than max_age_seconds. Returns the deleted names.
    """
    now = time.time() if now is None else now
    removed: List[str] = []
    try:
        names = os.listdir(directory)
    except OSError:
        return removed
    prefixes = tuple(prefixes)
    for name in names:
        if not name.startswith(prefixes):
            continue
        path = os.path.join(directory, name)
        try:
            if os.path.isfile(path) and not os.path.islink(path) and now - os.path.getmtime(path) > max_age_seconds:
                os.remove(path)
                removed.append(name)
        except OSError:
            continue
    return removed


def copy_to_folder(src: str, directory: str, filename: str) -> str:
    """Copies src into directory under a unique name and returns the final path."""
    os.makedirs(directory, exist_ok=True)
    dest = unique_path(directory, filename)
    shutil.copy2(src, dest)
    return dest
