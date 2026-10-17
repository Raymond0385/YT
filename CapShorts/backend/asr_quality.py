"""
asr_quality.py - confidence scoring and "weak segment" detection for speech recognition output.
Pure functions, no I/O.

confidence: 0.0 .. 1.0 per word (None = unknown / verified by the user).
"""

import math
from typing import Any, Dict, List, Optional, Tuple

from text_align import _is_gibberish

LOW_CONFIDENCE = 0.5          # words below this are highlighted in the editor
WEAK_AVG_LOGPROB = -1.0       # faster-whisper's own "failed" threshold
WEAK_COMPRESSION_RATIO = 2.4  # repetitive / looping text
WEAK_NO_SPEECH = 0.6
WEAK_MIN_WORD_PROB = 0.35
MAX_RETRY_FRACTION = 0.35     # never re-run more than this share of the audio with the big model


def logprob_to_confidence(avg_logprob: Optional[float]) -> Optional[float]:
    """Segment-level avg_logprob (<= 0) -> probability-like score."""
    if avg_logprob is None:
        return None
    return round(max(0.0, min(1.0, math.exp(avg_logprob))), 2)


def is_weak_segment(avg_logprob: Optional[float], compression_ratio: Optional[float],
                    no_speech_prob: Optional[float], words: List[Dict[str, Any]]) -> bool:
    """True if a segment is probably misrecognized and worth a second pass."""
    if avg_logprob is not None and avg_logprob < WEAK_AVG_LOGPROB:
        return True
    if compression_ratio is not None and compression_ratio > WEAK_COMPRESSION_RATIO:
        return True
    if no_speech_prob is not None and no_speech_prob > WEAK_NO_SPEECH and avg_logprob is not None and avg_logprob < -0.6:
        return True
    if words:
        gibberish = sum(1 for w in words if _is_gibberish(str(w.get("word", ""))))
        if gibberish / len(words) >= 0.2:
            return True
        confs = [w["confidence"] for w in words if w.get("confidence") is not None]
        if confs and sum(1 for c in confs if c < WEAK_MIN_WORD_PROB) / len(confs) >= 0.4:
            return True
    return False


def merge_ranges(ranges: List[Tuple[float, float]], gap: float = 0.6, pad: float = 0.3,
                 total: Optional[float] = None) -> List[Tuple[float, float]]:
    """Pads and merges nearby time ranges so each retry is one contiguous chunk."""
    padded = sorted((max(0.0, s - pad), (min(total, e + pad) if total else e + pad)) for s, e in ranges)
    merged: List[List[float]] = []
    for s, e in padded:
        if merged and s - merged[-1][1] <= gap:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    return [(round(s, 2), round(e, 2)) for s, e in merged]


def limit_retry_ranges(ranges: List[Tuple[float, float]], total: float,
                       max_fraction: float = MAX_RETRY_FRACTION) -> List[Tuple[float, float]]:
    """Keeps the longest ranges that fit into max_fraction of the audio (heaviest problems first)."""
    budget = total * max_fraction
    chosen: List[Tuple[float, float]] = []
    used = 0.0
    for r in sorted(ranges, key=lambda r: r[1] - r[0], reverse=True):
        length = r[1] - r[0]
        if used + length <= budget:
            chosen.append(r)
            used += length
    return sorted(chosen)


def replace_range(words: List[Dict[str, Any]], start: float, end: float,
                  new_words: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Replaces words whose midpoint lies inside [start, end] with new_words (already in absolute time)."""
    kept_before = [w for w in words if (w["start"] + w["end"]) / 2 < start]
    kept_after = [w for w in words if (w["start"] + w["end"]) / 2 > end]
    return kept_before + new_words + kept_after
