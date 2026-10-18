"""
media_store.py - keeps the video of a saved project so the project can open it again by itself.

A project file only holds a reference to its video. On save the engine keeps a copy (a hard link when the disk
allows it, so it takes no extra space) in DATA_DIR/media, and the project remembers that copy's id. Opening the
project asks the engine for the id and gets the video back; nothing is asked of the user.
"""

import hashlib
import os
import re
import shutil
import time
from typing import Optional

ID_RE = re.compile(r"^[0-9a-f]{24}$")
VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}
CHUNK = 1024 * 1024


def media_id(path: str) -> str:
    """A cheap fingerprint: size + the first and last megabyte + the extension (no need to read gigabytes)."""
    size = os.path.getsize(path)
    h = hashlib.sha1()
    h.update(str(size).encode())
    h.update(os.path.splitext(path)[1].lower().encode())
    with open(path, "rb") as f:
        h.update(f.read(CHUNK))
        if size > 2 * CHUNK:
            f.seek(size - CHUNK)
            h.update(f.read(CHUNK))
    return h.hexdigest()[:24]


def _entry(media_dir: str, mid: str) -> Optional[str]:
    if not ID_RE.match(mid or ""):
        return None
    try:
        for name in os.listdir(media_dir):
            if name.startswith(mid + "."):
                return os.path.join(media_dir, name)
    except FileNotFoundError:
        pass
    return None


def keep(media_dir: str, src_path: str) -> str:
    """Stores the video and returns its id. Keeping the same video twice stores it once."""
    ext = os.path.splitext(src_path)[1].lower()
    if ext not in VIDEO_EXTENSIONS:
        ext = ".mp4"
    os.makedirs(media_dir, exist_ok=True)
    mid = media_id(src_path)
    existing = _entry(media_dir, mid)
    if existing:
        os.utime(existing, None)           # used again: it is not stale
        return mid
    target = os.path.join(media_dir, mid + ext)
    partial = target + ".part"
    try:
        os.link(src_path, target)          # same volume: no extra disk space
    except OSError:
        try:
            shutil.copyfile(src_path, partial)
            os.replace(partial, target)
        finally:
            if os.path.exists(partial):
                os.remove(partial)
    return mid


def find(media_dir: str, mid: str) -> Optional[str]:
    """Path of a kept video (marks it as used), or None."""
    path = _entry(media_dir, mid)
    if path:
        try:
            os.utime(path, None)
        except OSError:
            pass
    return path


def prune(media_dir: str, max_age_days: float = 90.0, now: Optional[float] = None) -> int:
    """Deletes kept videos nobody has opened or saved for a long time. Returns how many were removed."""
    removed = 0
    cutoff = (now if now is not None else time.time()) - max_age_days * 86400
    try:
        names = os.listdir(media_dir)
    except FileNotFoundError:
        return 0
    for name in names:
        if not (ID_RE.match(name.split(".")[0]) or name.endswith(".part")):
            continue
        p = os.path.join(media_dir, name)
        try:
            if os.path.isfile(p) and os.path.getmtime(p) < cutoff:
                os.remove(p)
                removed += 1
        except OSError:
            pass
    return removed
