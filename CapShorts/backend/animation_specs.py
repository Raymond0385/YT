"""
animation_specs.py - the word animations (pop / bounce / fade) as ASS override tags.

The motion is described once, in frontend/src/data/animations.json. The editor preview builds its CSS keyframes
from the same file (tailwind.config.js), and this module turns it into libass `\\t` transforms, so the exported
video plays the same scale / opacity curve as the preview.
"""

import json
import os
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

_cache: Optional[Dict[str, Dict[str, Any]]] = None


def _candidates() -> List[str]:
    here = os.path.dirname(os.path.abspath(__file__))
    paths = []
    if getattr(sys, "frozen", False):
        paths.append(os.path.join(os.path.dirname(sys.executable), "animations.json"))
        paths.append(os.path.join(getattr(sys, "_MEIPASS", ""), "animations.json"))
    paths.append(os.path.join(here, "animations.json"))
    paths.append(os.path.join(here, "..", "frontend", "src", "data", "animations.json"))
    return [os.path.normpath(p) for p in paths if p]


def load_specs(path: Optional[str] = None, refresh: bool = False) -> Dict[str, Dict[str, Any]]:
    """Animation specs by name ({} if the file cannot be found: subtitles then simply have no animation)."""
    global _cache
    if _cache is not None and not refresh and path is None:
        return _cache
    for p in ([path] if path else _candidates()):
        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
            specs = {k: v for k, v in data.items() if isinstance(v, dict) and "keyframes" in v}
            if path is None:
                _cache = specs
            return specs
        except (OSError, ValueError):
            continue
    if path is None:
        _cache = {}
    return {}


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def evaluate(spec: Dict[str, Any], t_ms: float) -> Tuple[float, float, float]:
    """(scaleX, scaleY, opacity) of the animation t_ms after it starts (linear between keyframes)."""
    kfs = spec["keyframes"]
    dur = float(spec["durationMs"])
    frac = 0.0 if dur <= 0 else max(0.0, min(1.0, t_ms / dur))
    if frac <= kfs[0]["at"]:
        k = kfs[0]
        return float(k["scaleX"]), float(k["scaleY"]), float(k["opacity"])
    for a, b in zip(kfs, kfs[1:]):
        if frac <= b["at"]:
            span = b["at"] - a["at"]
            u = 0.0 if span <= 0 else (frac - a["at"]) / span
            return (_lerp(a["scaleX"], b["scaleX"], u), _lerp(a["scaleY"], b["scaleY"], u), _lerp(a["opacity"], b["opacity"], u))
    k = kfs[-1]
    return float(k["scaleX"]), float(k["scaleY"]), float(k["opacity"])


def _state(k: Dict[str, Any]) -> str:
    alpha = int(round((1.0 - float(k["opacity"])) * 255))
    return f"\\fscx{int(round(float(k['scaleX']) * 100))}\\fscy{int(round(float(k['scaleY']) * 100))}\\alpha&H{alpha:02X}&"


def ass_override(spec: Dict[str, Any]) -> str:
    """'{\\fscx90...\\t(0,90,...)\\t(90,180,...)}': the start state and one linear transform per keyframe segment."""
    kfs = spec["keyframes"]
    dur = float(spec["durationMs"])
    out = _state(kfs[0])
    for a, b in zip(kfs, kfs[1:]):
        out += f"\\t({int(round(a['at'] * dur))},{int(round(b['at'] * dur))},{_state(b)})"
    return "{" + out + "}"


def animation_tags(name: str, specs: Optional[Dict[str, Dict[str, Any]]] = None) -> str:
    """Override block for the animation `name` ('' for unknown names such as 'none')."""
    specs = load_specs() if specs is None else specs
    spec = specs.get(str(name).lower())
    return ass_override(spec) if spec else ""


# ---- reading the tags back (used by the parity tests) -------------------------------------------------------
_STATE = re.compile(r"\\fscx(\d+)\\fscy(\d+)\\alpha&H([0-9A-F]{2})&")
_TRANS = re.compile(r"\\t\((\d+),(\d+),((?:\\[a-z]+[^\\)]*)+)\)")


def evaluate_tags(tags: str, t_ms: float) -> Tuple[float, float, float]:
    """Value of (scaleX, scaleY, opacity) at t_ms as libass computes it from the override block."""
    def parse(frag: str) -> Tuple[float, float, float]:
        m = _STATE.search(frag)
        if not m:
            raise ValueError(f"unreadable state: {frag}")
        return int(m.group(1)) / 100.0, int(m.group(2)) / 100.0, 1.0 - int(m.group(3), 16) / 255.0

    first = _STATE.search(tags.split("\\t(")[0])
    cur = parse(first.group(0))
    for m in _TRANS.finditer(tags):
        t1, t2, target = int(m.group(1)), int(m.group(2)), parse(m.group(3))
        if t_ms >= t2:
            cur = target
        elif t_ms > t1:
            u = (t_ms - t1) / (t2 - t1)
            return tuple(_lerp(a, b, u) for a, b in zip(cur, target))  # type: ignore[return-value]
        else:
            break
    return cur
