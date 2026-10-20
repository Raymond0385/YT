"""
timeline_render.py - turns the editor's timeline into FFmpeg instructions for the export.

The editor keeps the source video whole and describes the edit:
  segments   which parts of the source play, in order (cuts such as "Remove dead air" leave gaps)
  speed      playback speed of the whole video
  volume     loudness of the video's own sound
  fade_in / fade_out   from / to black (and silence) at the start / end
  tracks     extra video layers (picture in picture) and extra sounds (music, voice-over) on the timeline

Captions, emoji and B-roll are timed on the timeline, so the output must follow the timeline exactly: this module
maps timeline time to source time and builds the filter pieces. Pure functions, no I/O.
"""

from typing import Any, Dict, List, Optional, Sequence, Tuple

Range = Tuple[float, float]
EPS = 1e-6


# ------------------------------------------------------------------------------------------------- time mapping
def clean_segments(segments: Optional[Sequence[Dict[str, Any]]]) -> List[Range]:
    """Source ranges of the segments in timeline order (invalid and empty ones dropped)."""
    out: List[Range] = []
    for s in segments or []:
        try:
            a, b = float(s.get("sourceStart", s.get("source_start"))), float(s.get("sourceEnd", s.get("source_end")))
        except (TypeError, ValueError):
            continue
        if b - a > 0.02 and a >= 0:
            out.append((a, b))
    return out


def is_trivial(ranges: Sequence[Range], source_duration: Optional[float] = None) -> bool:
    """One segment covering the whole source: nothing is cut."""
    if not ranges:
        return True
    if len(ranges) == 1 and ranges[0][0] <= 0.05:
        return source_duration is None or ranges[0][1] >= source_duration - 0.05
    return False


def timeline_to_source_ranges(ranges: Sequence[Range], start: float, end: float) -> List[Range]:
    """The source ranges that play between timeline times `start` and `end`."""
    out: List[Range] = []
    t = 0.0
    for a, b in ranges:
        length = b - a
        lo, hi = max(start, t), min(end, t + length)
        if hi - lo > EPS:
            out.append((round(a + (lo - t), 3), round(a + (hi - t), 3)))
        t += length
        if t >= end:
            break
    return out


def source_to_output(ranges: Sequence[Range], t_src: float) -> Optional[float]:
    """Output time (seconds from the start of the export) of a source time, or None if that moment is cut."""
    t = 0.0
    for a, b in ranges:
        if a - EPS <= t_src <= b + EPS:
            return t + (t_src - a)
        t += b - a
    return None


def output_duration(ranges: Sequence[Range], speed: float = 1.0) -> float:
    return sum(b - a for a, b in ranges) / max(0.1, speed)


def select_expr(ranges: Sequence[Range], offset: float) -> str:
    """FFmpeg select/aselect expression keeping `ranges` (source times) of an input that starts at `offset`."""
    parts = [f"between(t\\,{max(0.0, a - offset):.3f}\\,{b - offset:.3f})" for a, b in ranges]
    return "+".join(parts)


# ------------------------------------------------------------------------------------------------- main video / audio
def clamp_speed(speed: Any) -> float:
    try:
        v = float(speed)
    except (TypeError, ValueError):
        return 1.0
    return min(2.0, max(0.5, v)) if v > 0 else 1.0


def video_prefix(ranges: Sequence[Range], offset: float, speed: float, cut: bool) -> str:
    """Filters applied to [0:v] before anything else (empty when there is nothing to do)."""
    parts: List[str] = []
    if cut:
        parts.append(f"select='{select_expr(ranges, offset)}',setpts=N/FRAME_RATE/TB")
    if abs(speed - 1.0) > 0.01:
        parts.append(f"setpts=PTS/{speed:.4f}")
    return ",".join(parts)


def audio_chain(ranges: Sequence[Range], offset: float, speed: float, cut: bool, volume: float,
                fade_in: float, fade_out: float, duration: float) -> str:
    """Filters for the video's own sound (always returns at least a pass-through)."""
    parts: List[str] = []
    if cut:
        parts.append(f"aselect='{select_expr(ranges, offset)}',asetpts=N/SR/TB")
    if abs(speed - 1.0) > 0.01:
        parts.append(f"atempo={speed:.4f}")
    if abs(volume - 1.0) > 0.01:
        parts.append(f"volume={max(0.0, min(3.0, volume)):.3f}")
    if fade_in > 0:
        parts.append(f"afade=t=in:st=0:d={fade_in:.2f}")
    if fade_out > 0 and duration > fade_out:
        parts.append(f"afade=t=out:st={duration - fade_out:.3f}:d={fade_out:.2f}")
    return ",".join(parts) or "anull"


def video_fades(fade_in: float, fade_out: float, duration: float) -> str:
    parts: List[str] = []
    if fade_in > 0:
        parts.append(f"fade=t=in:st=0:d={fade_in:.2f}")
    if fade_out > 0 and duration > fade_out:
        parts.append(f"fade=t=out:st={duration - fade_out:.3f}:d={fade_out:.2f}")
    return ",".join(parts)


def scale_times(items: Sequence[Dict[str, Any]], speed: float, keys=("start", "end")) -> List[Dict[str, Any]]:
    """Copies of timed items (words, emoji, B-roll) with their times sped up."""
    if abs(speed - 1.0) <= 0.01:
        return [dict(i) for i in items]
    out = []
    for i in items:
        j = dict(i)
        for k in keys:
            if isinstance(j.get(k), (int, float)):
                j[k] = round(j[k] / speed, 3)
        out.append(j)
    return out


def remap_camera_path(xs: Sequence[int], rate: float, span_from: float, ranges: Sequence[Range], speed: float,
                      out_duration: float) -> List[int]:
    """
    The face-following path is computed on the source (from `span_from`); the output skips cut parts and may be
    sped up. Returns the path in output time.
    """
    if not xs:
        return []
    n = max(1, int(out_duration * rate) + 1)
    total = 0.0
    bounds = []
    for a, b in ranges:
        bounds.append((total, a, b))
        total += b - a
    out: List[int] = []
    for k in range(n):
        t_tl = (k / rate) * speed                      # timeline time inside the export
        src = None
        for t0, a, b in bounds:
            if t_tl <= t0 + (b - a) + EPS:
                src = a + (t_tl - t0)
                break
        if src is None:
            src = ranges[-1][1] if ranges else span_from
        i = int(round((src - span_from) * rate))
        out.append(xs[max(0, min(len(xs) - 1, i))])
    return out


# ------------------------------------------------------------------------------------------------- extra tracks
def clip_items(tracks: Optional[Sequence[Dict[str, Any]]], window_start: float, window_end: float, speed: float) -> Dict[str, List[Dict[str, Any]]]:
    """
    The track items that play inside [window_start, window_end] (timeline time) with their times in the output:
    {"video": [...], "audio": [...]}, each item {path_key, out_start, out_end, src_start, ...}.
    """
    res: Dict[str, List[Dict[str, Any]]] = {"video": [], "audio": []}
    for track in tracks or []:
        kind = track.get("kind")
        if kind not in res or track.get("muted") or track.get("hidden"):
            continue
        for it in track.get("items") or []:
            try:
                start, dur = float(it["start"]), float(it["duration"])
                src_start = float(it.get("sourceStart", 0.0))
            except (KeyError, TypeError, ValueError):
                continue
            end = start + dur
            lo, hi = max(start, window_start), min(end, window_end)
            if hi - lo <= 0.05:
                continue
            res[kind].append({
                **it,
                "kind": kind,
                "out_start": round((lo - window_start) / speed, 3),
                "out_end": round((hi - window_start) / speed, 3),
                "src_start": round(src_start + (lo - start), 3),
                "src_dur": round(hi - lo, 3),
                "track_volume": float(track.get("volume", 1.0) or 0.0),
            })
    return res


def overlay_graph(items: Sequence[Dict[str, Any]], first_input: int, canvas_w: int, canvas_h: int,
                  in_label: str, out_label: str) -> str:
    """Picture-in-picture layers over the video: one extra input per item, in the same order as `items`."""
    if not items:
        return f"[{in_label}]null[{out_label}]"
    chains: List[str] = []
    prev = in_label
    for n, it in enumerate(items):
        idx = first_input + n
        scale = min(1.0, max(0.05, float(it.get("scale", 0.35))))
        w = int(round(canvas_w * scale / 2)) * 2
        opacity = min(1.0, max(0.0, float(it.get("opacity", 1.0))))
        fi, fo = max(0.0, float(it.get("fadeIn", 0.0))), max(0.0, float(it.get("fadeOut", 0.0)))
        dur = it["out_end"] - it["out_start"]
        layer = f"[{idx}:v]scale={w}:-2,format=yuva420p"
        if opacity < 0.999:
            layer += f",colorchannelmixer=aa={opacity:.3f}"
        if fi > 0:
            layer += f",fade=t=in:st=0:d={min(fi, dur):.2f}:alpha=1"
        if fo > 0 and dur > fo:
            layer += f",fade=t=out:st={dur - fo:.3f}:d={fo:.2f}:alpha=1"
        layer += f",setpts=PTS-STARTPTS+{it['out_start']:.3f}/TB[ov{n}]"
        chains.append(layer)
        # x, y: centre of the layer as fractions of the canvas
        cx, cy = float(it.get("x", 0.5)), float(it.get("y", 0.5))
        nxt = out_label if n == len(items) - 1 else f"vo{n}"
        chains.append(
            f"[{prev}][ov{n}]overlay=x='{cx:.4f}*W-w/2':y='{cy:.4f}*H-h/2':eof_action=pass:"
            f"enable='between(t\\,{it['out_start']:.3f}\\,{it['out_end']:.3f})'[{nxt}]"
        )
        prev = nxt
    return ";".join(chains)


def audio_mix_graph(items: Sequence[Dict[str, Any]], first_input: int, main_label: Optional[str], out_label: str) -> str:
    """Extra sounds (one extra input per item, in the same order as `items`) mixed with the video's own sound."""
    labels: List[str] = []
    chains: List[str] = []
    for n, it in enumerate(items):
        idx = first_input + n
        vol = max(0.0, min(3.0, float(it.get("volume", 1.0)) * float(it.get("track_volume", 1.0))))
        fi, fo = max(0.0, float(it.get("fadeIn", 0.0))), max(0.0, float(it.get("fadeOut", 0.0)))
        dur = it["out_end"] - it["out_start"]
        delay = int(round(it["out_start"] * 1000))
        chain = f"[{idx}:a]asetpts=PTS-STARTPTS,volume={vol:.3f}"
        if fi > 0:
            chain += f",afade=t=in:st=0:d={min(fi, dur):.2f}"
        if fo > 0 and dur > fo:
            chain += f",afade=t=out:st={dur - fo:.3f}:d={fo:.2f}"
        chain += f",adelay={delay}|{delay}[ax{n}]"
        chains.append(chain)
        labels.append(f"[ax{n}]")
    if main_label:
        labels.insert(0, f"[{main_label}]")
    if len(labels) == 1:
        chains.append(f"{labels[0]}anull[{out_label}]")
    else:
        # with the video's own sound first, the mix lasts as long as the video; without it, as long as the
        # longest sound (the export then stops at the end of the picture with -shortest)
        length = "first" if main_label else "longest"
        chains.append(f"{''.join(labels)}amix=inputs={len(labels)}:duration={length}:normalize=0:dropout_transition=0[{out_label}]")
    return ";".join(chains)


def item_inputs(items: Sequence[Dict[str, Any]], resolve) -> List[str]:
    """FFmpeg input arguments for track items: each starts at its in-point and lasts as long as it plays."""
    args: List[str] = []
    for it in items:
        args += ["-ss", f"{it['src_start']:.3f}", "-t", f"{it['src_dur']:.3f}", "-i", resolve(it)]
    return args
