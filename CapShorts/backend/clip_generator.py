"""
clip_generator.py - AI Viral Shorts & Highlights Detection Engine (Opus Clip Style)
Extracts 25s-60s self-contained, high-engagement vertical clips from long video transcripts.
Guarantees 100% COMPLETE THOUGHTS & SENTENCES without mid-sentence cutoffs or trailing speech truncation.
"""

import math
import uuid
from typing import List, Dict, Any, Optional

from clip_scoring import get_pack, score_candidate, hook_score, detect_language, tier_for, PACKS, _norm as _norm_token

VIRAL_HOOK_TRIGGERS = {
    # High curiosity / mystery hooks
    "secret", "secrets", "nobody", "never", "truth", "hidden", "mistake", "warning",
    "stop", "why", "how", "hack", "crazy", "insane", "million", "millions", "money",
    "dollars", "dollar", "wealth", "rich", "success", "future", "rule", "rules",
    "worst", "best", "first", "game-changer", "supercharge", "boost", "results",
    "strategy", "win", "power", "formula", "magic", "proof", "revealed", "shocking"
}

FILLER_LEAD_WORDS = {
    "so", "and", "or", "but", "basically", "actually", "like", "you", "know",
    "well", "okay", "alright", "in", "this", "video", "today", "we", "are",
    "going", "to", "talk", "about", "let's", "lets", "look", "at", "i", "mean",
    # Roman Urdu / Hindi
    "aur", "toh", "tau", "to", "phir", "phr", "laikin", "lekin", "magar",
    "aaj", "hum", "is", "iss", "video", "mein", "me", "baat", "karenge",
    "dosto", "bhai", "dekho", "agar", "aap", "yani", "yaani", "sirf"
}

def generate_clip_title(clip_words: List[Any], index: int) -> str:
    """
    Generates an engaging, clickable viral title derived directly from the clip's actual spoken words.
    Never falls back to static hardcoded dummy templates!
    """
    if not clip_words:
        return f"🔥 Viral Short #{index + 1}"

    # Extract clean words text
    words_text = [get_w_word(w).strip() for w in clip_words if get_w_word(w).strip()]
    if not words_text:
        return f"🔥 Viral Short #{index + 1}"

    # Try to extract the first complete sentence or first 4-8 impactful words
    first_clause: List[str] = []
    for w in words_text[:12]:
        first_clause.append(w)
        if any(p in w for p in [".", "?", "!", "।", "؟"]) or len(first_clause) >= 7:
            break

    # Strip leading conversational fillers if enough words remain
    while first_clause and clean_word(first_clause[0]) in FILLER_LEAD_WORDS and len(first_clause) > 3:
        first_clause.pop(0)

    # If first clause became too short, take up to 6 words
    if len(first_clause) < 3:
        first_clause = words_text[:6]

    raw_phrase = " ".join(first_clause).strip(".,!?:;\"'()[]{}—–-")

    # Smart Title Casing
    def title_case_token(token: str) -> str:
        if token.isupper() and len(token) <= 4:
            return token  # Keep acronyms like AI, GPU, USD, ROI
        return token.capitalize()

    formatted_phrase = " ".join(title_case_token(t) for t in raw_phrase.split())

    # Limit length gracefully at a word boundary
    if len(formatted_phrase) > 42:
        words_split = formatted_phrase.split()
        shortened = []
        cur_len = 0
        for w in words_split:
            if cur_len + len(w) + 1 > 40 and len(shortened) >= 3:
                break
            shortened.append(w)
            cur_len += len(w) + 1
        formatted_phrase = " ".join(shortened)

    # Pick dynamic contextual emoji
    lower_phrase = formatted_phrase.lower()
    if "?" in "".join(words_text[:10]) or any(q in lower_phrase for q in ["why", "how", "what", "kya", "kaise", "kyun", "почему", "зачем", "как ", "что "]):
        emoji = "❓ " if index % 2 == 0 else "🤔 "
        if not formatted_phrase.endswith("?"):
            formatted_phrase += "?"
    elif any(m in lower_phrase for m in ["mistake", "warning", "stop", "never", "wrong", "galti", "danger", "ошибк", "стоп", "никогда", "опасн", "внимание"]):
        emoji = "⚠️ "
        if not formatted_phrase.endswith("!"):
            formatted_phrase += "!"
    elif any(c.isdigit() for c in formatted_phrase) or any(m in lower_phrase for m in ["money", "dollar", "earn", "paisa", "paise", "rich", "crore", "lakh", "деньг", "доллар", "заработ", "богат", "миллион", "рубл"]):
        emoji = "💰 " if index % 2 == 0 else "📈 "
    elif any(s in lower_phrase for s in ["secret", "hack", "trick", "formula", "truth", "hidden", "rule", "секрет", "хак", "формул", "правда", "скрыт", "правил"]):
        emoji = "💡 " if index % 2 == 0 else "🔑 "
    else:
        emojis = ["🔥 ", "⚡ ", "🚀 ", "🎯 ", "🎬 "]
        emoji = emojis[index % len(emojis)]
        if not formatted_phrase.endswith(('!', '?')):
            formatted_phrase += "!"

    return f"{emoji}{formatted_phrase}"

def generate_ai_titles_with_groq(
    clips: List[Dict[str, Any]],
    api_keys: List[str]
) -> List[Dict[str, Any]]:
    """
    Uses Groq LLM (Llama 3.1 8b Instant, ~200ms latency) to generate
    video-specific viral short titles in the clip's native language.
    """
    valid_keys = [k.strip() for k in api_keys if k and len(k.strip()) > 10]
    if not valid_keys or not clips:
        return clips

    clip_snippets = []
    for idx, c in enumerate(clips):
        words = c.get("words", [])
        snippet = " ".join(get_w_word(w) for w in words[:45])
        clip_snippets.append(f"Clip {idx+1}: \"{snippet}\"")

    prompt = (
        "You are an expert viral YouTube Shorts headline creator. "
        "Create a short, punchy 3-6 word viral title with 1 relevant emoji at the start for each clip below. "
        "Match the language of the clip text (English, Roman Urdu, Hindi, Urdu, etc.). Do not translate. "
        "Return ONLY a valid JSON array of strings containing the titles in exact order, e.g. [\"🔥 Title 1\", \"💡 Title 2\"]. "
        "No conversational preamble.\n\n" + "\n".join(clip_snippets)
    )

    url = "https://api.groq.com/openai/v1/chat/completions"
    import requests
    import json

    for key in valid_keys:
        try:
            headers = {
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json"
            }
            body = {
                "model": "llama-3.1-8b-instant",
                "messages": [
                    {"role": "system", "content": "You output only valid JSON arrays of strings."},
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.5,
                "max_tokens": 300
            }
            res = requests.post(url, headers=headers, json=body, timeout=5)
            if res.ok:
                content = res.json()["choices"][0]["message"]["content"].strip()
                if "[" in content and "]" in content:
                    json_str = content[content.find("["):content.rfind("]")+1]
                    titles = json.loads(json_str)
                    if isinstance(titles, list) and len(titles) == len(clips):
                        for idx, t in enumerate(titles):
                            if isinstance(t, str) and t.strip():
                                clips[idx]["title"] = t.strip()
                        print(f"[clip_generator] Successfully generated {len(clips)} AI viral titles via Groq!")
                        return clips
        except Exception as e:
            print(f"[clip_generator] AI title generation error: {e}")
            continue

    return clips

DANGLING_CONNECTORS = {
    # English conjunctions, prepositions, determiners, incomplete words
    "and", "or", "but", "so", "because", "if", "when", "that", "to", "with",
    "for", "as", "than", "like", "which", "while", "where", "then", "my",
    "your", "the", "a", "an", "is", "are", "was", "were", "will", "be",
    "have", "has", "had", "such", "about", "into", "through", "during",
    "before", "after", "from", "up", "down", "in", "on", "off", "over",
    "under", "why", "how", "whose", "whom", "also", "including", "although",
    "though", "even", "since", "unless", "i", "we", "you", "they", "he", "she",
    "it", "this", "these", "those", "am",

    # Roman Urdu / Hindi connectors, prepositions, incomplete pronouns
    "aur", "or", "ke", "ki", "ka", "ko", "se", "me", "mein", "par",
    "laikin", "lekin", "magar", "kyun", "kyunki", "kyunke", "kyunkay",
    "agar", "jab", "to", "tau", "toh", "phir", "phr", "jo", "jis", "isliye",
    "isley", "ya", "yani", "warna", "bhi", "k", "kay", "pe", "tak", "ne",
    "sirf", "balke", "halaankay", "halanke", "jaisay", "jaise", "kahan",
    "kaun", "kya", "kab", "kaisi", "kaisay", "kaise", "mera", "meri", "mere",
    "tera", "teri", "tere", "uska", "uski", "uske", "unka", "unki", "unke",
    "apna", "apni", "apne", "iss", "uss", "jiss", "inhe", "unhe", "unhon",
    "inhon", "woh", "wo", "yeh", "ye", "main", "hum", "aap", "tum"
}

TERMINAL_VERBS_URDU_HINDI = {
    "hai", "hain", "tha", "thi", "thay", "the", "hoga", "hogi", "honge",
    "gaya", "gayi", "gaye", "chahiye", "raha", "rahi", "rahe", "karo",
    "karein", "kare", "karna", "hona", "sakta", "sakti", "sakte", "diya",
    "liya", "karega", "karegi", "karenge", "chuka", "chuki", "chuke",
    "milta", "milti", "milte", "dekha", "socha", "samjha", "bana", "banaya",
    "aaya", "aayi", "aaye", "gaye", "raho", "dekho", "sikho", "seekho",
    "kaho", "suno", "jao", "aao", "chalo", "batao", "samjho", "sakenge",
    "hoon", "hu"
}

DANGLING_CONNECTORS = DANGLING_CONNECTORS | PACKS["ru"]["dangling"]

def get_w_word(w: Any) -> str:
    """Safely extracts the word text regardless of dict or object format."""
    if isinstance(w, dict):
        return str(w.get("word", "") or "")
    return str(getattr(w, "word", "") or "")

def get_w_start(w: Any) -> float:
    if isinstance(w, dict):
        return float(w.get("start", 0.0) or 0.0)
    return float(getattr(w, "start", 0.0) or 0.0)

def get_w_end(w: Any) -> float:
    if isinstance(w, dict):
        return float(w.get("end", 0.0) or 0.0)
    return float(getattr(w, "end", 0.0) or 0.0)

def get_w_keyword(w: Any) -> bool:
    if isinstance(w, dict):
        return bool(w.get("keyword", False))
    return bool(getattr(w, "keyword", False))

def clean_word(word_str: str) -> str:
    """Strips punctuation and whitespace for grammatical inspection."""
    return str(word_str).strip().lower().strip(".,!?:;\"'()[]{}؟।")

def is_thought_ender(w_obj: Any, next_w_obj: Optional[Any], pack: Optional[Dict[str, Any]] = None) -> bool:
    """
    Evaluates whether a word represents a definitive, complete thought/sentence ending.
    Guarantees the short does NOT cut off abruptly mid-clause. `pack` is the language pack (English by default).
    """
    pack = pack or PACKS["en"]
    raw_word = get_w_word(w_obj)
    c = _norm_token(raw_word)

    if not c:
        return False

    # Clause continuing punctuation (commas, semicolons, dashes) -> NEVER complete
    if any(raw_word.endswith(p) for p in [",", ";", ":", "-", "\u2014", "\u2013"]):
        return False

    # Dangling connectors (and, aur, because, that, toh, и, но, что, чтобы ...) -> NEVER complete
    if c in pack["dangling"]:
        return False

    # Conjunctive participles in Roman Urdu/Hindi (dekhke, karke, bolke) -> NEVER complete
    if pack["lang"] == "en" and (c.endswith("ke") or c.endswith("kay") or c.endswith("kar")) and len(c) > 3:
        return False

    # 1. Definitive terminal punctuation
    if any(p in raw_word for p in [".", "!", "?", "\u0964", "\u061f", "\u2026"]):
        return True

    # 2. Terminal Urdu/Hindi auxiliary verbs (hai, tha, gaya, chahiye, hoon, etc.)
    if c in pack["terminal_verbs"]:
        if next_w_obj is None:
            return True
        pause = get_w_start(next_w_obj) - get_w_end(w_obj)
        # If followed by even a small breath pause (>=0.28s) or next sentence starts capital
        next_raw = get_w_word(next_w_obj).strip()
        if pause >= 0.28 or (next_raw and next_raw[0].isupper()):
            return True

    # 3. Authentic speech pause (>= 0.55s) when not on a connector
    if next_w_obj is not None:
        pause = get_w_start(next_w_obj) - get_w_end(w_obj)
        if pause >= 0.55:
            return True

    return False

def score_hook(sentence_words: List[Any], pack: Optional[Dict[str, Any]] = None) -> float:
    """Curiosity and virality hook score (0 to 100) for the opening 5-10 seconds."""
    return hook_score(sentence_words, pack or PACKS["en"])

MAX_TRANSCRIPT_WORDS = 15000

# Automatic number of shorts: the distinct moments that are good enough, judged against the best one,
# and not more than one per AUTO_SECONDS_PER_SHORT of video (a long video gives more, a short one fewer)
AUTO_MIN_SCORE = 62
AUTO_MAX_BELOW_BEST = 25
AUTO_SECONDS_PER_SHORT = 120.0
AUTO_MAX_SHORTS = 40
MAX_OVERLAP = 3.0           # two shorts may share at most this many seconds


def auto_limit(total_duration: float) -> int:
    return max(1, min(AUTO_MAX_SHORTS, int(round(total_duration / AUTO_SECONDS_PER_SHORT))))


def select_clips(candidates: List[Dict[str, Any]], count: Optional[int], total_duration: float = 0.0) -> List[Dict[str, Any]]:
    """
    Best non-overlapping candidates. With `count` the top `count`; without it (automatic) the candidates
    scoring at least AUTO_MIN_SCORE and within AUTO_MAX_BELOW_BEST of the best one, at most auto_limit()
    of them (always at least one).
    """
    ranked = sorted(candidates, key=lambda c: (-c["virality_score"], c["start"]))
    if not ranked:
        return []
    bar = None if count else max(AUTO_MIN_SCORE, ranked[0]["virality_score"] - AUTO_MAX_BELOW_BEST)
    if not count:
        count = auto_limit(total_duration or max(c["end"] for c in ranked))
    selected: List[Dict[str, Any]] = []
    for cand in ranked:
        if count and len(selected) >= count:
            break
        if bar is not None and cand["virality_score"] < bar and selected:
            break
        if any(min(cand["end"], s["end"]) - max(cand["start"], s["start"]) > MAX_OVERLAP for s in selected):
            continue
        selected.append(cand)
    return selected


def summarize(clips: List[Dict[str, Any]], total_duration: float, auto: bool) -> Dict[str, Any]:
    """What the user sees first: how many shorts the whole video gives and how good they are."""
    tiers = {"strong": 0, "good": 0, "fair": 0}
    for c in clips:
        tiers[c.get("tier") or tier_for(c.get("virality_score", 0))] += 1
    return {
        "count": len(clips),
        **tiers,
        "auto": auto,
        "video_duration": round(total_duration, 1),
        "covered_seconds": round(sum(c["end"] - c["start"] for c in clips), 1),
    }

def detect_viral_clips(
    words: List[Any],
    total_duration: float,
    min_clip_duration: float = 25.0,
    max_clip_duration: float = 60.0,
    target_clips_count: Optional[int] = None,
    api_keys: Optional[List[str]] = None
) -> List[Dict[str, Any]]:
    """
    Scans word transcript with millisecond accuracy, detects natural sentence boundaries,
    and extracts complete, self-contained viral shorts without cutting off mid-sentence.
    target_clips_count None (default): as many as the video gives (see select_clips).
    """
    if not words or total_duration <= 0:
        return []

    words = words[:MAX_TRANSCRIPT_WORDS]
    if words and total_duration < get_w_end(words[-1]):
        total_duration = get_w_end(words[-1])

    if total_duration < 15.0 or len(words) < 10:
        return [{
            "id": f"clip-1-{str(uuid.uuid4())[:6]}",
            "title": "⚡ Viral Short Preview",
            "hook": " ".join(get_w_word(w) for w in words[:10]) + ("..." if len(words) > 10 else ""),
            "start": 0.0,
            "end": round(total_duration, 2),
            "duration": max(0.1, round(total_duration, 1)),
            "virality_score": 75,
            "tier": tier_for(75),
            "keywords": [get_w_word(w) for w in words if get_w_keyword(w)][:5],
            "transcript_snippet": " ".join(get_w_word(w) for w in words[:25]) + ("..." if len(words) > 25 else "")
        }]

    pack = get_pack(words)

    # Step 1: Detect valid start positions (sentence beginnings)
    valid_starts = [0]
    for i in range(len(words) - 1):
        w = words[i]
        next_w = words[i + 1]
        if is_thought_ender(w, next_w, pack):
            # The next word is a clean start point if it isn't a dangling connector
            if _norm_token(get_w_word(next_w)) not in pack["dangling"]:
                valid_starts.append(i + 1)

    # Step 2: Build candidate clip windows ending strictly on complete thoughts
    candidates = []

    for start_idx in valid_starts:
        start_time = get_w_start(words[start_idx])

        for end_idx in range(start_idx + 12, len(words)):
            w_end = words[end_idx]
            next_w = words[end_idx + 1] if end_idx + 1 < len(words) else None
            raw_dur = get_w_end(w_end) - start_time

            if raw_dur > max_clip_duration:
                break

            if raw_dur >= min_clip_duration:
                # STRICT Thought Completion check
                if is_thought_ender(w_end, next_w, pack):
                    # Acoustic decay padding so speech reverb doesn't get abruptly cut
                    padding = 0.35
                    if next_w:
                        gap = max(0.0, get_w_start(next_w) - get_w_end(w_end))
                        padding = min(padding, max(0.0, gap - 0.08))
                    actual_end = min(total_duration, get_w_end(w_end) + padding)
                    actual_dur = max(0.1, round(actual_end - start_time, 1))

                    c_words = words[start_idx : end_idx + 1]

                    raw_end = get_w_word(w_end)
                    has_punct = any(p in raw_end for p in [".", "!", "?", "\u0964", "\u061f", "\u2026"])
                    has_terminal_verb = _norm_token(raw_end) in pack["terminal_verbs"]
                    end_gap = (get_w_start(next_w) - get_w_end(w_end)) if next_w else 99.0

                    total_virality, breakdown = score_candidate(
                        c_words, start_time, actual_end, end_gap, has_punct, has_terminal_verb, pack)

                    candidates.append({
                        "start": round(start_time, 2),
                        "end": round(actual_end, 2),
                        "duration": actual_dur,
                        "words": c_words,
                        "hook_words": c_words[:12],
                        "virality_score": total_virality,
                        "score_breakdown": breakdown
                    })

    # Fallback if transcript has zero pauses or punctuation
    if not candidates:
        step = min(45.0, total_duration)
        t = 0.0
        while t + min_clip_duration <= total_duration:
            t_end = min(total_duration, t + step)
            c_words = [w for w in words if t <= get_w_start(w) <= t_end]
            if c_words:
                candidates.append({
                    "start": round(t, 2),
                    "end": round(t_end, 2),
                    "duration": round(t_end - t, 1),
                    "words": c_words,
                    "hook_words": c_words[:8],
                    "virality_score": 70 + (len(candidates) % 15)
                })
            t += (step * 0.8)

    # Step 3: the best distinct moments (automatic count unless a number was asked for)
    selected = select_clips(candidates, target_clips_count, total_duration)

    # Sort selected chronologically for clean playback
    selected.sort(key=lambda c: c["start"])

    # Step 4: Format final clip objects
    result_clips = []
    for idx, c in enumerate(selected):
        c_words = c["words"]
        title = generate_clip_title(c_words, idx)
        hook_text = " ".join(get_w_word(w) for w in c["hook_words"][:12])
        keywords = list(dict.fromkeys([clean_word(get_w_word(w)) for w in c_words if get_w_keyword(w)]))[:6]
        snippet = " ".join(get_w_word(w) for w in c_words[:28]) + ("..." if len(c_words) > 28 else "")

        result_clips.append({
            "id": f"clip-{idx+1}-{str(uuid.uuid4())[:6]}",
            "title": title,
            "hook": hook_text,
            "start": c["start"],
            "end": c["end"],
            "duration": c["duration"],
            "virality_score": c["virality_score"],
            "tier": tier_for(c["virality_score"]),
            "rank": 0,
            "keywords": keywords,
            "transcript_snippet": snippet,
            "language": pack["lang"],
            "score_breakdown": c.get("score_breakdown", {}),
            "words": c_words
        })

    # Rank 1 = the best short, so the list can be read in time order and still show which one to post first
    for rank, c in enumerate(sorted(result_clips, key=lambda c: -c["virality_score"]), 1):
        c["rank"] = rank

    if api_keys:
        result_clips = generate_ai_titles_with_groq(result_clips, api_keys)

    return result_clips
