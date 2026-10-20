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
from typing import List, Dict, Any, Optional, Tuple

MIN_WORD_DURATION = 0.08
_PUNCT = ".,!?:;\"'()[]{}—–-…"


def _norm(token: str) -> str:
    return token.strip().strip(_PUNCT).lower()


def levenshtein(a: str, b: str, limit: Optional[int] = None) -> int:
    """
    Classic Wagner-Fischer edit distance, O(len(a)*len(b)) time, O(min) memory.
    With `limit` it stops as soon as the distance is sure to exceed it and returns limit + 1
    (most comparisons are between clearly different words, so this skips nearly all the work).
    """
    if a == b:
        return 0
    if len(a) < len(b):
        a, b = b, a
    if not b:
        return len(a)
    if limit is not None:
        return _bounded_levenshtein(a, b, limit)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def _bounded_levenshtein(a: str, b: str, limit: int) -> int:
    """
    Edit distance if it is <= limit, else limit + 1 (len(a) >= len(b)). Only the cells within `limit` of the
    diagonal can stay under the limit, so only those are computed, and it stops once a whole row is over it.
    """
    big = limit + 1
    la, lb = len(a), len(b)
    if la - lb > limit:
        return big
    prev = [j if j <= limit else big for j in range(lb + 1)]
    for i in range(1, la + 1):
        cur = [big] * (lb + 1)
        cur[0] = i if i <= limit else big
        row_min = cur[0]
        ca = a[i - 1]
        for j in range(max(1, i - limit), min(lb, i + limit) + 1):
            v = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != b[j - 1]))
            if v > big:
                v = big
            cur[j] = v
            if v < row_min:
                row_min = v
        if row_min > limit:
            return big                # the row minimum never decreases further down
        prev = cur
    return min(prev[lb], big)


def normalized_distance(a: str, b: str) -> float:
    """Edit distance divided by the longer string length: 0.0 identical .. 1.0 unrelated."""
    longest = max(len(a), len(b))
    return levenshtein(a, b) / longest if longest else 0.0


def close_distance(a: str, b: str, threshold: float) -> Optional[float]:
    """normalized_distance(a, b) if it is <= threshold, else None. Much faster than computing it in full."""
    longest = max(len(a), len(b))
    if not longest:
        return 0.0
    limit = int(threshold * longest + 1e-9)
    d = levenshtein(a, b, limit)
    return d / longest if d <= limit else None


_DIAG, _UP, _LEFT = 0, 1, 2


def _align_pairs(old: List[str], new: List[str], threshold: float) -> List[Optional[int]]:
    """
    Optimal token alignment (see align_words); returns pair[j] = index of the old token matched to new token j.

    Only a band of cells around the diagonal is computed (Ukkonen): a path that leaves the band already costs more
    than the band's limit, so when the best path found inside costs no more than that limit it is the global best,
    with the same tie-breaking as the full table. Otherwise the band doubles. A few edits in an hour of speech
    therefore cost a thin band instead of a words x words table.
    """
    n, m = len(old), len(new)
    diff = m - n
    cache: Dict[Tuple[str, str], float] = {}

    def cost(a: str, b: str) -> float:
        # Similar words are cheap; dissimilar ones still pair up (cost 1.0 < insert+delete = 2.0)
        # so a rewritten sentence keeps the speech's rough timing instead of collapsing.
        if a == b:
            return 0.0
        c = cache.get((a, b))
        if c is None:
            d = close_distance(a, b, threshold)
            c = cache[(a, b)] = d if d is not None else 1.0
        return c

    inf = float("inf")
    limit = abs(diff) + 16
    while True:
        extra = (limit - abs(diff)) // 2
        tmin, tmax = min(0, diff) - extra, max(0, diff) + extra      # allowed j - i
        full = tmin <= -n and tmax >= m
        los: List[int] = []
        vals: List[List[float]] = []
        backs: List[bytearray] = []
        for i in range(n + 1):
            lo, hi = max(0, i + tmin), min(m, i + tmax)
            row = [inf] * (hi - lo + 1)
            back = bytearray(hi - lo + 1)
            if i == 0:
                for j in range(lo, hi + 1):
                    row[j - lo], back[j - lo] = float(j), _LEFT
            else:
                plo, prow = los[-1], vals[-1]
                phi = plo + len(prow) - 1
                a = old[i - 1]
                for j in range(lo, hi + 1):
                    if j == 0:
                        row[0], back[0] = float(i), _UP
                        continue
                    diag = prow[j - 1 - plo] + cost(a, new[j - 1]) if plo <= j - 1 <= phi else inf
                    up = prow[j - plo] + 1.0 if plo <= j <= phi else inf
                    left = row[j - 1 - lo] + 1.0 if j - 1 >= lo else inf
                    # ties prefer the diagonal, then dropping an old word
                    if diag <= up and diag <= left:
                        row[j - lo], back[j - lo] = diag, _DIAG
                    elif up <= left:
                        row[j - lo], back[j - lo] = up, _UP
                    else:
                        row[j - lo], back[j - lo] = left, _LEFT
            los.append(lo)
            vals.append(row)
            backs.append(back)
        if full or vals[n][m - los[n]] <= limit:
            break
        limit *= 2

    pair: List[Optional[int]] = [None] * m
    i, j = n, m
    while i > 0 and j > 0:
        step = backs[i][j - los[i]]
        if step == _DIAG:
            pair[j - 1] = i - 1
            i, j = i - 1, j - 1
        elif step == _UP:
            i -= 1
        else:
            j -= 1
    return pair


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
    old_norm = [_norm(w["word"]) for w in old_words]
    new_norm = [_norm(t) for t in new_tokens]
    pair = _align_pairs(old_norm, new_norm, match_threshold)

    out: List[Dict[str, Any]] = []
    for j, tok in enumerate(new_tokens):
        if pair[j] is not None:
            ow = old_words[pair[j]]
            # An unchanged word keeps its recognition confidence; a rewritten one counts as user-verified
            same = _norm(ow["word"]) == _norm(tok)
            out.append({"start": ow["start"], "end": ow["end"], "word": tok, "keyword": ow.get("keyword", False),
                        "confidence": ow.get("confidence") if same else None})
        else:
            out.append({"start": None, "end": None, "word": tok, "keyword": False, "confidence": None})

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

    keyed = [(term, _norm(term).replace(" ", "")) for term in terms]
    keyed = [(term, key) for term, key in keyed if len(key) >= 3]
    norms = [_norm(w["word"]) for w in words]

    out: List[Dict[str, Any]] = []
    i = 0
    while i < len(words):
        best = None  # (distance, run_length, term)
        for term, tkey in keyed:
            glued = ""
            for run in range(1, min(6, len(words) - i) + 1):
                glued += norms[i + run - 1]
                if len(glued) > len(tkey) * 2:
                    break
                if abs(len(glued) - len(tkey)) > threshold * max(len(glued), len(tkey)) + 1e-9:
                    continue
                d = close_distance(glued, tkey, threshold)
                if d is not None and (best is None or d < best[0] or (d == best[0] and run > best[1])):
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
            "confidence": None,
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
    norms = [_norm(w["word"]) for w in result]
    starts: List[int] = []

    def index_lengths():
        starts[:] = [0]
        for t in norms:
            starts.append(starts[-1] + len(t))

    def joined_len(i: int, size: int) -> int:
        k = min(i + size, len(norms))
        return starts[k] - starts[i] + max(0, k - i - 1)          # words plus the spaces between them

    def maybe_similar(i: int, j: int, size: int) -> bool:
        la, lb = joined_len(i, size), joined_len(j, size)
        return abs(la - lb) <= threshold * max(la, lb) + 1e-9

    def similar(x: str, y: str) -> bool:
        return x == y or close_distance(x, y, threshold) is not None

    index_lengths()

    changed = True
    while changed:
        changed = False
        for size in range(max_phrase, 0, -1):
            i = 0
            while i + 2 * size <= len(result):
                if not maybe_similar(i, i + size, size):
                    i += 1
                    continue
                a = " ".join(norms[i:i + size])
                if a and similar(a, " ".join(norms[i + size:i + 2 * size])):
                    if size >= 3:
                        drop = True
                    else:
                        c = " ".join(norms[i + 2 * size:i + 3 * size])
                        drop = bool(c) and similar(a, c)
                    if drop:
                        del result[i + size:i + 2 * size]
                        del norms[i + size:i + 2 * size]
                        index_lengths()
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
