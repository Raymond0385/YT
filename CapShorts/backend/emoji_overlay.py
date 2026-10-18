"""
emoji_overlay.py - draws the editor's animated-looking emoji into the exported video.

libass cannot draw color emoji, so each emoji is an image (Noto Emoji, Apache-2.0, see emoji/README.txt)
laid over the video with FFmpeg's overlay filter, centered above the subtitle text for the time its block is on screen.
Pure functions: they return FFmpeg arguments / filter text and never run anything.
"""

import math
import os
from typing import Any, Dict, List, Optional, Sequence, Tuple

MAX_EVENTS = 120
LINE_HEIGHT = 1.2          # text line height as a multiple of the font size
CHAR_WIDTH = 0.6           # average glyph width as a multiple of the font size (bold, often uppercase)
EMOJI_SCALE = 1.4          # emoji size as a multiple of the font size (same as the editor preview)
GAP = 0.18                 # gap between emoji and text as a multiple of the font size


def emoji_filename(emoji: str) -> str:
    """'⚠️' -> '26a0.png': code points in lowercase hex joined by '-', without the variation selector FE0F."""
    cps = [f"{ord(c):x}" for c in str(emoji) if ord(c) != 0xFE0F]
    return "-".join(cps) + ".png"


def find_emoji_dir(candidates: Sequence[str]) -> Optional[str]:
    for d in candidates:
        if d and os.path.isdir(d):
            return d
    return None


def shift_events(events: Optional[List[Dict[str, Any]]], clip_start: Optional[float],
                 clip_end: Optional[float]) -> List[Dict[str, Any]]:
    """
    Keeps the events that fall (even partly) inside the exported clip and moves them so the clip starts at 0.
    Without a clip range the events are returned as they are.
    """
    out: List[Dict[str, Any]] = []
    for ev in events or []:
        try:
            s, e, emoji = float(ev["start"]), float(ev["end"]), str(ev["emoji"])
        except (KeyError, TypeError, ValueError):
            continue
        if not emoji or e <= s:
            continue
        if clip_start is not None and clip_end is not None:
            if e <= clip_start or s >= clip_end:
                continue
            s, e = max(s, clip_start) - clip_start, min(e, clip_end) - clip_start
        out.append({"start": round(s, 3), "end": round(e, 3), "emoji": emoji})
    out.sort(key=lambda x: x["start"])
    return out


def block_text_length(words: Sequence[Dict[str, Any]], start: float, end: float) -> int:
    """Characters (with spaces) of the words that belong to a block shown from start to end."""
    parts = [str(w.get("word", "")).strip() for w in words if start - 0.02 <= float(w.get("start", 0)) <= end + 0.02]
    parts = [p for p in parts if p]
    return len(" ".join(parts))


def estimate_lines(chars: int, font_size: float, canvas_width: float) -> int:
    available = max(1.0, canvas_width - 80.0)         # ASS side margins are 40 px
    width = max(1, chars) * font_size * CHAR_WIDTH
    return max(1, min(3, int(math.ceil(width / available))))


def emoji_geometry(font_size: float, margin_v: float, alignment: int, lines: int,
                   canvas_height: float) -> Tuple[int, int]:
    """Size and top y of the emoji, so it sits just above the subtitle text block."""
    size = max(32, int(round(font_size * EMOJI_SCALE)))
    text_h = lines * font_size * LINE_HEIGHT
    gap = font_size * GAP
    if alignment == 8:                                 # top: text starts at margin_v
        top = margin_v
    elif alignment == 5:                               # middle: text block centered
        top = canvas_height / 2.0 - text_h / 2.0
    else:                                              # bottom: text ends margin_v above the bottom edge
        top = canvas_height - margin_v - text_h
    y = int(round(top - gap - size))
    return size, max(8, min(y, int(canvas_height - size - 8)))


def build_overlay_graph(events: List[Dict[str, Any]], emoji_dir: Optional[str], words: Sequence[Dict[str, Any]],
                        canvas_w: int, canvas_h: int, layout: Dict[str, Any], first_input_index: int,
                        in_label: str = "vsub", out_label: str = "vfinal",
                        max_events: int = MAX_EVENTS) -> Tuple[List[str], Optional[str]]:
    """
    Returns (ffmpeg input args, filter graph text). The graph reads `[in_label]` and writes `[out_label]`.
    (args, None) -> nothing to draw (no events, no assets): the caller keeps its own graph untouched.
    """
    if not events or not emoji_dir:
        return [], None

    usable: List[Dict[str, Any]] = []
    for ev in events:
        path = os.path.join(emoji_dir, emoji_filename(ev["emoji"]))
        if os.path.isfile(path):
            usable.append({**ev, "path": path})
    usable = usable[:max_events]
    if not usable:
        return [], None

    # one image input per distinct emoji; split it when it is used several times
    order: List[str] = []
    for ev in usable:
        if ev["path"] not in order:
            order.append(ev["path"])
    uses = {p: sum(1 for ev in usable if ev["path"] == p) for p in order}

    input_args: List[str] = []
    for p in order:
        input_args += ["-loop", "1", "-framerate", "30", "-i", p]

    size, _ = emoji_geometry(layout["font_size"], layout["margin_v"], layout["alignment"], 1, canvas_h)
    parts: List[str] = []
    labels: Dict[str, List[str]] = {}
    for idx, p in enumerate(order):
        n = uses[p]
        src = f"[{first_input_index + idx}:v]format=rgba,scale={size}:{size}"
        names = [f"em{idx}_{j}" for j in range(n)]
        labels[p] = names
        parts.append(src + (f",split={n}" + "".join(f"[{nm}]" for nm in names) if n > 1 else f"[{names[0]}]"))

    taken = {p: 0 for p in order}
    prev = in_label
    for k, ev in enumerate(usable):
        lines = estimate_lines(block_text_length(words, ev["start"], ev["end"]), layout["font_size"], canvas_w)
        _, y = emoji_geometry(layout["font_size"], layout["margin_v"], layout["alignment"], lines, canvas_h)
        label = labels[ev["path"]][taken[ev["path"]]]
        taken[ev["path"]] += 1
        nxt = out_label if k == len(usable) - 1 else f"ov{k}"
        parts.append(
            f"[{prev}][{label}]overlay=x=(W-w)/2:y={y}:"
            f"enable='between(t,{ev['start']:.3f},{ev['end']:.3f})':shortest=1[{nxt}]"
        )
        prev = nxt
    return input_args, ";".join(parts)


def attach_to_filters(filter_args: List[str], graph: str) -> List[str]:
    """
    Adds the emoji graph to the export's filter arguments.
    - "-filter_complex <graph ending in [vfinal]>": the subtitle result is renamed [vsub] and the emoji graph appended.
    - "-vf ass=...": converted into a filter_complex with the same mapping the other variants use.
    """
    args = list(filter_args)
    if "-filter_complex" in args:
        i = args.index("-filter_complex") + 1
        text = args[i]
        cut = text.rfind("[vfinal]")
        if cut == -1:
            return args
        args[i] = text[:cut] + "[vsub]" + ";" + graph
        return args
    if "-vf" in args:
        i = args.index("-vf") + 1
        chain = args[i]
        new = ["-filter_complex", f"[0:v]{chain}[vsub];{graph}", "-map", "[vfinal]", "-map", "0:a?"]
        return args[:i - 1] + new + args[i + 1:]
    return args
