"""
groq_chunks.py - cloud transcription of long recordings.

Groq's speech endpoint accepts files only up to a size limit (25 MB on the free tier), so a long recording is cut
into chunks that are transcribed one by one and joined with the right time offsets. Cuts are made inside pauses
(found with FFmpeg's silencedetect), so a word is almost never split between two chunks.

The planning and merging are pure functions; run_chunked() does the FFmpeg and network work.
"""

import os
import re
import subprocess
import sys
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

# A recording longer than this (seconds) or bigger than this (bytes) goes through the chunked path.
CHUNK_AFTER_SECONDS = 20 * 60
CHUNK_AFTER_BYTES = 18 * 1024 * 1024

TARGET_CHUNK = 600.0     # aim for ten minutes per chunk (~2.4 MB at 32 kbit/s)
MAX_CHUNK = 900.0        # never longer than this
MIN_CHUNK = 60.0         # a shorter tail is merged into the previous chunk
CUT_WINDOW = 60.0        # look this far around the target for a pause

# Groq reports the detected language by name; its "language" parameter wants the ISO code.
LANGUAGE_CODES = {
    "english": "en", "russian": "ru", "ukrainian": "uk", "belarusian": "be", "polish": "pl", "czech": "cs",
    "german": "de", "french": "fr", "spanish": "es", "italian": "it", "portuguese": "pt", "dutch": "nl",
    "turkish": "tr", "arabic": "ar", "hebrew": "he", "persian": "fa", "hindi": "hi", "urdu": "ur",
    "bengali": "bn", "chinese": "zh", "japanese": "ja", "korean": "ko", "vietnamese": "vi", "thai": "th",
    "indonesian": "id", "swedish": "sv", "norwegian": "no", "danish": "da", "finnish": "fi", "greek": "el",
    "romanian": "ro", "hungarian": "hu", "bulgarian": "bg", "serbian": "sr", "croatian": "hr",
}


def language_code(name: Optional[str]) -> Optional[str]:
    """'Russian' / 'russian' / 'ru' -> 'ru'. None when unknown (then the next chunk is detected again)."""
    if not name:
        return None
    key = str(name).strip().lower()
    if key in LANGUAGE_CODES:
        return LANGUAGE_CODES[key]
    return key if re.fullmatch(r"[a-z]{2,3}", key) else None


def needs_chunking(duration: float, size_bytes: int) -> bool:
    return duration > CHUNK_AFTER_SECONDS or size_bytes > CHUNK_AFTER_BYTES


def parse_silences(ffmpeg_stderr: str) -> List[Tuple[float, float]]:
    """Reads (start, end) pauses from the output of ffmpeg -af silencedetect."""
    silences: List[Tuple[float, float]] = []
    start: Optional[float] = None
    for line in ffmpeg_stderr.splitlines():
        m = re.search(r"silence_start:\s*(-?[0-9.]+)", line)
        if m:
            start = max(0.0, float(m.group(1)))
            continue
        m = re.search(r"silence_end:\s*([0-9.]+)", line)
        if m and start is not None:
            end = float(m.group(1))
            if end > start:
                silences.append((start, end))
            start = None
    return silences


def plan_chunks(duration: float, silences: Sequence[Tuple[float, float]], target: float = TARGET_CHUNK,
                max_len: float = MAX_CHUNK, min_len: float = MIN_CHUNK,
                window: float = CUT_WINDOW) -> List[Tuple[float, float]]:
    """
    Splits [0, duration] into consecutive (start, end) chunks no longer than max_len.
    Each cut goes to the middle of the longest pause near the target length; with no pause there, to the target.
    """
    if duration <= 0:
        return []
    if duration <= max_len:
        return [(0.0, round(duration, 3))]

    cuts: List[float] = []
    pos = 0.0
    while duration - pos > max_len:
        aim = pos + target
        lo, hi = max(pos + min_len, aim - window), min(pos + max_len, aim + window)
        best: Optional[Tuple[float, float]] = None   # (pause length, cut position)
        for s, e in silences:
            mid = (s + e) / 2.0
            if lo <= mid <= hi:
                cand = (e - s, mid)
                if best is None or cand[0] > best[0] or (cand[0] == best[0] and abs(mid - aim) < abs(best[1] - aim)):
                    best = cand
        cut = best[1] if best else min(aim, pos + max_len)
        cuts.append(round(cut, 3))
        pos = cut

    edges = [0.0] + cuts + [round(duration, 3)]
    chunks = [(edges[i], edges[i + 1]) for i in range(len(edges) - 1)]
    if len(chunks) > 1 and chunks[-1][1] - chunks[-1][0] < min_len:
        last = chunks.pop()
        prev = chunks.pop()
        chunks.append((prev[0], last[1]))            # a very short tail rides along with the previous chunk
    return chunks


def merge_words(parts: Sequence[Tuple[float, List[Dict[str, Any]]]]) -> List[Dict[str, Any]]:
    """Joins per-chunk words, shifting each chunk by its start offset; the result is in time order."""
    merged: List[Dict[str, Any]] = []
    for offset, words in parts:
        for w in words:
            item = dict(w)
            item["start"] = round(float(w["start"]) + offset, 2)
            item["end"] = round(float(w["end"]) + offset, 2)
            merged.append(item)
    merged.sort(key=lambda w: (w["start"], w["end"]))
    # a chunk edge can make the first word of the next chunk start a hair before the previous word ends
    for i in range(1, len(merged)):
        if merged[i]["start"] < merged[i - 1]["end"] and merged[i]["start"] >= merged[i - 1]["start"]:
            merged[i - 1]["end"] = merged[i]["start"] if merged[i]["start"] > merged[i - 1]["start"] else merged[i - 1]["end"]
    return merged


def _run(cmd: List[str], timeout: int) -> subprocess.CompletedProcess:
    kwargs: Dict[str, Any] = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
    return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, **kwargs)


def detect_silences(ffmpeg_bin: str, audio_path: str, noise_db: int = -35, min_pause: float = 0.4) -> List[Tuple[float, float]]:
    proc = _run([ffmpeg_bin, "-hide_banner", "-nostats", "-i", audio_path,
                 "-af", f"silencedetect=noise={noise_db}dB:d={min_pause}", "-f", "null", "-"], timeout=600)
    return parse_silences(proc.stderr.decode("utf-8", errors="ignore"))


def extract_chunk(ffmpeg_bin: str, audio_path: str, start: float, end: float, out_path: str) -> None:
    proc = _run([ffmpeg_bin, "-y", "-ss", f"{start:.3f}", "-t", f"{end - start:.3f}", "-i", audio_path,
                 "-vn", "-ar", "16000", "-ac", "1", "-b:a", "32k", out_path], timeout=300)
    if proc.returncode != 0 or not os.path.exists(out_path):
        raise RuntimeError("Could not cut an audio chunk for cloud transcription.")


def run_chunked(audio_path: str, duration: float, ffmpeg_bin: str, api_keys: List[str], language: Optional[str],
                prompt: Optional[str], work_dir: str, name: str,
                progress: Optional[Callable[[int, int], None]] = None,
                silences: Optional[Sequence[Tuple[float, float]]] = None
                ) -> Tuple[List[Dict[str, Any]], float, Optional[str]]:
    """
    Transcribes a long recording through Groq in chunks. Returns (words, duration, detected language).
    `silences` can be passed in (tests); otherwise they are detected with FFmpeg.
    """
    import groq_transcribe as gt     # looked up at call time so tests can replace gt.transcribe_with_groq_pool

    found = list(silences) if silences is not None else detect_silences(ffmpeg_bin, audio_path)
    chunks = plan_chunks(duration, found)

    parts: List[Tuple[float, List[Dict[str, Any]]]] = []
    detected: Optional[str] = None
    lang = language
    for i, (start, end) in enumerate(chunks):
        if progress:
            progress(i, len(chunks))
        path = os.path.join(work_dir, f"{name}_chunk{i}.mp3")
        try:
            extract_chunk(ffmpeg_bin, audio_path, start, end, path)
            words, _dur, chunk_lang = gt.transcribe_with_groq_pool(path, api_keys, lang, prompt=prompt)
        finally:
            if os.path.exists(path):
                try:
                    os.remove(path)
                except OSError:
                    pass
        parts.append((start, words))
        if detected is None and chunk_lang:
            detected = chunk_lang
            # keep one language for the whole recording instead of re-detecting (and maybe flipping) per chunk
            if not lang or lang == "auto":
                lang = language_code(chunk_lang) or lang
    if progress:
        progress(len(chunks), len(chunks))
    return merge_words(parts), duration, detected
