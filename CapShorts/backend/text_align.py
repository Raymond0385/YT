"""
text_align.py - Levenshtein-based post-processing for Whisper transcripts.

Pure functions, no I/O:
  - levenshtein / normalized_distance: edit distance on strings.
  - align_words: token-level alignment of an edited text onto timed words (keeps timings).
  - apply_glossary: fuzzy replacement of misheard names/terms with user glossary entries.
  - collapse_repeats: removes Whisper hallucination loops (same phrase repeated).
  - sanitize_words: drops gibberish tokens and fixes zero-length timings.
"""

import re
from typing import List, Dict, Any, Optional

MIN_WORD_DURATION = 0.08
_PUNCT = ".,!?:;\"'()[]{}—–-…"


def _norm(token: str) -> str:
    return token.strip().strip(_PUNCT).lower()


def levenshtein(a: str, b: str) -> int:
    """Classic Wagner-Fischer edit distance, O(len(a)*len(b)) time, O(min) memory."""
    if a == b:
        return 0
    if len(a) < len(b):
        a, b = b, a
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def normalized_distance(a: str, b: str) -> float:
    """Edit distance divided by the longer string length: 0.0 identical .. 1.0 unrelated."""
    longest = max(len(a), len(b))
    return levenshtein(a, b) / longest if longest else 0.0


def _tokens_cost(a: str, b: str) -> float:
    return normalized_distance(_norm(a), _norm(b))


def align_words(old_words: List[Dict[str, Any]], new_text: str, match_threshold: float = 0.5) -> List[Dict[str, Any]]:
    """
    Re-times `new_text` using the timings of `old_words`.

    Token-level Needleman-Wunsch where substituting similar words is cheap
    (cost = normalized Levenshtein, capped by `match_threshold`) and insert/delete cost 1.
      - matched / substituted token -> inherits the old word's start/end (and keyword flag)
      - inserted token              -> time is split evenly in the gap between neighbours
      - deleted old token           -> dropped
    """
    new_tokens = new_text.split()
    if not new_tokens:
        return []
    if not old_words:
        return [{"start": 0.0, "end": 0.0, "word": t, "keyword": False} for t in new_tokens]

    n, m = len(old_words), len(new_tokens)

    def sub_cost(i: int, j: int) -> float:
        # Similar words are cheap; dissimilar ones still pair up (cost 1.0 < insert+delete = 2.0)
        # so a rewritten sentence keeps the speech's rough timing instead of collapsing.
        c = _tokens_cost(old_words[i]["word"], new_tokens[j])
        return c if c <= match_threshold else 1.0

    dp = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        dp[i][0] = float(i)
    for j in range(1, m + 1):
        dp[0][j] = float(j)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            dp[i][j] = min(dp[i - 1][j - 1] + sub_cost(i - 1, j - 1), dp[i - 1][j] + 1.0, dp[i][j - 1] + 1.0)

    # Backtrack: pair[j] = index of old word matched to new token j, else None
    pair: List[Optional[int]] = [None] * m
    i, j = n, m
    while i > 0 and j > 0:
        if dp[i][j] == dp[i - 1][j - 1] + sub_cost(i - 1, j - 1):
            pair[j - 1] = i - 1
            i, j = i - 1, j - 1
        elif dp[i][j] == dp[i - 1][j] + 1.0:
            i -= 1
        else:
            j -= 1

    out: List[Dict[str, Any]] = []
    for j, tok in enumerate(new_tokens):
        if pair[j] is not None:
            ow = old_words[pair[j]]
            out.append({"start": ow["start"], "end": ow["end"], "word": tok, "keyword": ow.get("keyword", False)})
        else:
            out.append({"start": None, "end": None, "word": tok, "keyword": False})

    # Fill inserted runs by splitting the gap between the nearest timed neighbours
    j = 0
    while j < m:
        if out[j]["start"] is not None:
            j += 1
            continue
        k = j
        while k < m and out[k]["start"] is None:
            k += 1
        # Edges of the transcript fall back to the span of the original speech
        gap_start = out[j - 1]["end"] if j > 0 else old_words[0]["start"]
        gap_end = out[k]["start"] if k < m else old_words[-1]["end"]
        gap_end = max(gap_end, gap_start)
        step = (gap_end - gap_start) / (k - j)
        for idx in range(j, k):
            s = gap_start + (idx - j) * step
            out[idx]["start"], out[idx]["end"] = round(s, 2), round(s + step, 2)
        j = k
    return out


def apply_glossary(words: List[Dict[str, Any]], glossary: List[str], threshold: float = 0.25) -> List[Dict[str, Any]]:
    """
    Replaces words that are close (normalized Levenshtein <= threshold) to a glossary term.
    Multi-word terms ("Chat GPT") also match a run of consecutive words glued together,
    e.g. "chat" + "g" + "p" + "t" -> one word "ChatGPT" spanning the run's timing.
    Punctuation attached to the original word is preserved.
    """
    terms = [t.strip() for t in glossary if t and t.strip()]
    if not terms or not words:
        return [dict(w) for w in words]

    out: List[Dict[str, Any]] = []
    i = 0
    while i < len(words):
        best = None  # (distance, run_length, term)
        for term in terms:
            tkey = _norm(term).replace(" ", "")
            if len(tkey) < 3:
                continue
            glued = ""
            for run in range(1, min(6, len(words) - i) + 1):
                glued += _norm(words[i + run - 1]["word"])
                if len(glued) > len(tkey) * 2:
                    break
                d = normalized_distance(glued, tkey)
                if d <= threshold and (best is None or d < best[0] or (d == best[0] and run > best[1])):
                    best = (d, run, term)
        if best is None:
            out.append(dict(words[i]))
            i += 1
            continue
        _, run, term = best
        first, last = words[i], words[i + run - 1]
        lead = re.match(r"^[" + re.escape(_PUNCT) + r"]*", first["word"]).group(0)
        tail = re.search(r"[" + re.escape(_PUNCT) + r"]*$", last["word"]).group(0)
        out.append({
            **first,
            "word": f"{lead}{term.replace(' ', '') if run > 1 else term}{tail}",
            "end": last["end"],
            "keyword": any(w.get("keyword", False) for w in words[i:i + run]),
        })
        i += run
    return out


def collapse_repeats(words: List[Dict[str, Any]], max_phrase: int = 6, threshold: float = 0.15) -> List[Dict[str, Any]]:
    """
    Removes immediately repeated phrases (Whisper loops such as "in the chat. in the chat.").
    A phrase of 1..max_phrase words is dropped if the next block of words is (almost) identical
    and the repeat is at least 3 words long, or 1-2 words repeated 3+ times (so legit "very very" stays).
    """
    result = [dict(w) for w in words]
    changed = True
    while changed:
        changed = False
        for size in range(max_phrase, 0, -1):
            i = 0
            while i + 2 * size <= len(result):
                a = " ".join(_norm(w["word"]) for w in result[i:i + size])
                b = " ".join(_norm(w["word"]) for w in result[i + size:i + 2 * size])
                if a and normalized_distance(a, b) <= threshold:
                    if size >= 3:
                        drop = True
                    else:
                        c = " ".join(_norm(w["word"]) for w in result[i + 2 * size:i + 3 * size])
                        drop = bool(c) and normalized_distance(a, c) <= threshold
                    if drop:
                        del result[i + size:i + 2 * size]
                        changed = True
                        continue
                i += 1
    return result


def _is_gibberish(token: str) -> bool:
    t = token.strip()
    if not t:
        return True
    # Mixed Latin + CJK glued together, or absurdly long single "word" -> hallucinated junk
    has_cjk = bool(re.search(r"[぀-ヿ㐀-鿿가-힯]", t))
    has_latin = bool(re.search(r"[A-Za-z]", t))
    if has_cjk and has_latin:
        return True
    return len(t) > 24


def fix_durations(words: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Gives zero-length words a minimal duration without overlapping the next word."""
    fixed = [dict(w) for w in words]
    for idx, w in enumerate(fixed):
        if w["end"] - w["start"] < MIN_WORD_DURATION:
            limit = fixed[idx + 1]["start"] if idx + 1 < len(fixed) else w["start"] + MIN_WORD_DURATION
            w["end"] = round(max(w["end"], min(w["start"] + MIN_WORD_DURATION, max(limit, w["start"] + 0.01))), 2)
    return fixed


def sanitize_words(words: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Drops gibberish tokens and fixes zero-length timings."""
    return fix_durations([w for w in words if not _is_gibberish(str(w.get("word", "")))])
