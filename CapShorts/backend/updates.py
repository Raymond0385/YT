"""
updates.py - "what's new" after an update, the list of releases for rolling back, and reading CHANGELOG.md.

State kept in DATA_DIR/update_state.json:
  last_seen_version  the version whose "what's new" the user has already seen (or the first version installed)
  pending            {"from": "1.4.1", "to": "1.4.2", "at": <time>} while an update or rollback is being installed
Pure functions except load_state/save_state.
"""

import json
import os
import re
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

STATE_FILE = "update_state.json"
_SECTION_RE = re.compile(r"^## \[(?P<version>[^\]]+)\](?:\s*-\s*(?P<date>\S+))?\s*$", re.MULTILINE)


def semver(v: str) -> Tuple[int, int, int]:
    parts = [int(p) for p in re.findall(r"\d+", (v or "").lstrip("v"))[:3]]
    return tuple(parts + [0] * (3 - len(parts)))  # type: ignore[return-value]


# ------------------------------------------------------------------------------------------------- changelog
def parse_changelog(text: str) -> List[Dict[str, str]]:
    """Sections of a Keep-a-Changelog file, newest first: [{"version", "date", "body"}]. "Unreleased" is skipped."""
    matches = list(_SECTION_RE.finditer(text or ""))
    out: List[Dict[str, str]] = []
    for i, m in enumerate(matches):
        version = m.group("version").strip()
        if not re.match(r"^\d+\.\d+", version):
            continue
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        out.append({"version": version, "date": m.group("date") or "", "body": text[m.end():end].strip()})
    return out


def changes_between(sections: Sequence[Dict[str, str]], after: Optional[str], upto: str) -> List[Dict[str, str]]:
    """Sections newer than `after` (exclusive) up to `upto` (inclusive), newest first."""
    lo = semver(after) if after else (-1, -1, -1)
    hi = semver(upto)
    return [s for s in sections if lo < semver(s["version"]) <= hi]


def find_changelog(dirs: Sequence[str]) -> Optional[str]:
    for d in dirs:
        p = os.path.join(d, "CHANGELOG.md")
        if d and os.path.isfile(p):
            return p
    return None


# ------------------------------------------------------------------------------------------------- state
def load_state(data_dir: str) -> Dict[str, Any]:
    try:
        with open(os.path.join(data_dir, STATE_FILE), "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_state(data_dir: str, state: Dict[str, Any]) -> None:
    path = os.path.join(data_dir, STATE_FILE)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def whats_new(state: Dict[str, Any], current: str, sections: Sequence[Dict[str, str]]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    What to show on start, and the new state to save.
    A first install shows nothing (it only remembers the version); after an update it lists what changed
    since the version seen last. A rollback (older version than seen) shows nothing.
    """
    new_state = dict(state)
    pending = state.get("pending") if isinstance(state.get("pending"), dict) else None
    if pending and semver(pending.get("to", "")) == semver(current):
        new_state.pop("pending", None)                 # the update or rollback we started has arrived
    seen = state.get("last_seen_version")
    if not seen:
        new_state["last_seen_version"] = current
        return {"show": False, "to": current}, new_state
    if semver(current) <= semver(seen):
        if semver(current) < semver(seen):
            new_state["last_seen_version"] = current   # rolled back: the next update shows its changes again
        return {"show": False, "to": current}, new_state
    changes = changes_between(sections, seen, current)
    return {"show": True, "from": seen, "to": current, "sections": changes}, new_state


def mark_seen(state: Dict[str, Any], current: str) -> Dict[str, Any]:
    new_state = dict(state)
    new_state["last_seen_version"] = current
    return new_state


def mark_pending(state: Dict[str, Any], current: str, target: str, now: Optional[float] = None) -> Dict[str, Any]:
    new_state = dict(state)
    new_state["pending"] = {"from": current, "to": target, "at": now if now is not None else time.time()}
    return new_state


# ------------------------------------------------------------------------------------------------- releases
def setup_asset(assets: Sequence[Dict[str, Any]], os_name: str) -> Optional[Dict[str, Any]]:
    """The installer of a release for this platform."""
    def named(pred):
        return next((a for a in assets if pred(a.get("name", "").lower())), None)
    if os_name == "windows":
        return named(lambda n: n.endswith("-setup.exe")) or named(lambda n: n.endswith(".exe") and "backend-engine" not in n) \
            or named(lambda n: n.endswith(".msi"))
    if os_name == "darwin":
        return named(lambda n: n.endswith(".dmg"))
    return None


def release_list(releases: Sequence[Dict[str, Any]], os_name: str, current: str, limit: int = 8) -> List[Dict[str, Any]]:
    """Published releases with an installer for this platform, newest first."""
    out: List[Dict[str, Any]] = []
    for r in releases:
        if r.get("draft") or r.get("prerelease"):
            continue
        tag = r.get("tag_name", "")
        asset = setup_asset(r.get("assets", []) or [], os_name)
        if not tag or not asset:
            continue
        version = tag.lstrip("v")
        out.append({
            "version": version,
            "tag": tag,
            "date": (r.get("published_at") or "")[:10],
            "asset_name": asset.get("name", ""),
            "download_url": asset.get("browser_download_url", ""),
            "size_mb": round((asset.get("size") or 0) / (1024 * 1024), 1),
            "current": semver(version) == semver(current),
            "older": semver(version) < semver(current),
        })
    out.sort(key=lambda x: semver(x["version"]), reverse=True)
    return out[:limit]
