"""
clip_scoring.py - language packs and scoring for viral short detection.

Pure functions (no I/O). The transcript is a list of word dicts:
    {"word": str, "start": float, "end": float, "keyword": bool, "confidence": float | None}
"""

import re
from typing import Any, Dict, FrozenSet, List, Optional, Tuple

# ----------------------------------------------------------------------------------------------------------------
# Language packs
# ----------------------------------------------------------------------------------------------------------------

_CYRILLIC = re.compile(r"[а-яёА-ЯЁ]")
_LETTER = re.compile(r"[^\W\d_]", re.UNICODE)


def detect_language(words: List[Any], sample: int = 400) -> str:
    """'ru' if the transcript is mostly Cyrillic, otherwise 'en' (covers English and romanized Urdu/Hindi)."""
    letters = cyr = 0
    for w in words[:sample]:
        text = str(w.get("word", "") if isinstance(w, dict) else getattr(w, "word", ""))
        letters += len(_LETTER.findall(text))
        cyr += len(_CYRILLIC.findall(text))
    return "ru" if letters and cyr / letters >= 0.4 else "en"


def _norm(token: str) -> str:
    return str(token).strip().lower().replace("ё", "е").strip(".,!?:;\"'()[]{}«»—–-…؟।")


def _set(*groups: str) -> FrozenSet[str]:
    return frozenset(_norm(t) for g in groups for t in g.split() if t)


EN_DANGLING = _set("""
and or but so because if when that to with for as than like which while where then my your the a an is are was
were will be have has had such about into through during before after from up down in on off over under why how
whose whom also including although though even since unless i we you they he she it this these those am
aur ke ki ka ko se me mein par laikin lekin magar kyun kyunki kyunke kyunkay agar jab tau toh phir phr jo jis
isliye isley ya yani warna bhi k kay pe tak ne sirf balke halaankay halanke jaisay jaise kahan kaun kya kab
kaisi kaisay kaise mera meri mere tera teri tere uska uski uske unka unki unke apna apni apne iss uss jiss
inhe unhe unhon inhon woh wo yeh ye main hum aap tum
""")

RU_DANGLING = _set("""
и а но или либо да что чтобы чтоб потому поэтому если когда пока как где куда откуда который которая которое
которые которых которому кто чей же ли бы то не ни на в во с со к ко у о об от до по за из для при про над под
без между через перед после этот эта это эти тот та те тех мой моя мое мои твой твоя наш наша ваш ваша его ее
их я мы вы ты он она оно они так тоже также еще уже вот тут там очень просто типа значит например есть был
была было были будет быть либо хотя пускай ведь зато
""")

EN_FILLERS = _set("""
so and or but basically actually like you know well okay alright in this video today we are going to talk about
let's lets look at i mean aur toh tau to phir phr laikin lekin magar aaj hum is iss mein me baat karenge
dosto bhai dekho agar aap yani yaani sirf
""")

RU_FILLERS = _set("""
ну вот короче значит типа в общем так итак и а но да всем привет друзья ребята сегодня давайте смотрите
слушайте кстати вообще конечно допустим например
""")

EN_HOOK = _set("""
secret secrets nobody never truth hidden mistake warning stop why how hack crazy insane million millions money
dollars dollar wealth rich success future rule rules worst best first game-changer supercharge boost results
strategy win power formula magic proof revealed shocking
""")

RU_HOOK = _set("""
секрет секреты никто никогда правда скрытый скрытая ошибка ошибки внимание стоп почему зачем как хак лайфхак
безумие безумный миллион миллионы миллиарды деньги доллар доллары богатый богатство успех будущее правило
правила худший худшая лучший лучшая первый первая формула магия доказательство шок шокирующий невероятный
невероятно бесплатно срочно ответ провал потерял потеряли заработал заработать разоблачение запрещено
опасно опасность главное
""")

EN_QUESTION = _set("why how what did you know is it possible kya kaise kyun")
RU_QUESTION = _set("почему зачем как что какой какая какие сколько кто где когда ли")

EN_POWER = _set("""
insane crazy amazing huge shocking incredible terrible worst best always never must biggest only real free
""")
RU_POWER = _set("""
безумно невероятно ужасно огромный огромная главный самое самый важно никогда всегда обязательно только
реально бесплатно шокирующий потрясающий
""")

# Demonstratives/pronouns at the very start usually refer to something said before the clip -> not self-contained
EN_BACKREF = _set("this that these those it they he she them his her its such")
RU_BACKREF = _set("это этот эта эти тот та те он она оно они его ее их там такой такая такие")

EN_TERMINAL_VERBS = _set("""
hai hain tha thi thay the hoga hogi honge gaya gayi gaye chahiye raha rahi rahe karo karein kare karna hona sakta
sakti sakte diya liya karega karegi karenge chuka chuki chuke milta milti milte dekha socha samjha bana banaya
aaya aayi aaye raho dekho sikho seekho kaho suno jao aao chalo batao samjho sakenge hoon hu
""")

PACKS: Dict[str, Dict[str, Any]] = {
    "en": {
        "lang": "en", "dangling": EN_DANGLING, "fillers": EN_FILLERS, "hook": EN_HOOK, "question": EN_QUESTION,
        "power": EN_POWER, "backref": EN_BACKREF, "terminal_verbs": EN_TERMINAL_VERBS,
        "wpm_ok": (120, 190), "wpm_ideal": 150,
        "question_substrings": ("why", "how", "what", "did you know", "is it possible", "kya", "kaise", "kyun"),
    },
    "ru": {
        "lang": "ru", "dangling": RU_DANGLING, "fillers": RU_FILLERS, "hook": RU_HOOK, "question": RU_QUESTION,
        "power": RU_POWER, "backref": RU_BACKREF, "terminal_verbs": frozenset(),
        # Russian words are longer, so fewer words per minute is normal
        "wpm_ok": (100, 165), "wpm_ideal": 130,
        "question_substrings": ("почему", "зачем", "как ", "что ", "сколько", "а вы знали", "знаете ли"),
    },
}


def get_pack(words: List[Any]) -> Dict[str, Any]:
    return PACKS[detect_language(words)]


# ----------------------------------------------------------------------------------------------------------------
# Scoring
# ----------------------------------------------------------------------------------------------------------------

def _word(w: Any) -> str:
    return str(w.get("word", "") if isinstance(w, dict) else getattr(w, "word", "") or "")


def _num(w: Any, key: str, default: float = 0.0) -> float:
    v = w.get(key) if isinstance(w, dict) else getattr(w, key, None)
    return float(v) if v is not None else default


def hook_score(hook_words: List[Any], pack: Dict[str, Any]) -> float:
    """Curiosity score (0..100) for the opening words."""
    if not hook_words:
        return 50.0
    score = 50.0
    cleaned = [_norm(_word(w)) for w in hook_words]
    text = " ".join(cleaned) + " "

    if any(q in text for q in pack["question_substrings"]) or cleaned[0] in pack["question"]:
        score += 20.0
    if any("?" in _word(w) for w in hook_words):
        score += 15.0
    score += 10.0 * sum(1 for c in cleaned if c in pack["hook"])
    if any(any(ch.isdigit() for ch in _word(w)) for w in hook_words):
        score += 10.0
    return min(100.0, score)


def score_candidate(c_words: List[Any], start: float, end: float, end_gap: float,
                    ends_with_punct: bool, ends_with_terminal_verb: bool,
                    pack: Dict[str, Any]) -> Tuple[int, Dict[str, float]]:
    """
    Virality score 1..99 and a breakdown of what contributed.
      hook (0-42) + keywords (0-20) + pacing (0-15) + ending (0-16) + length (0-8) + power words (0-6)
      - dead air (0-12) - weak start (0-7) - uncertain recognition (0-10)
    """
    duration = max(0.1, end - start)
    n = max(1, len(c_words))
    parts: Dict[str, float] = {}

    parts["hook"] = hook_score(c_words[:10], pack) * 0.42

    kw = sum(1 for w in c_words if (w.get("keyword") if isinstance(w, dict) else getattr(w, "keyword", False)))
    parts["keywords"] = min(20.0, (kw / n) * 100.0)

    wpm = n / duration * 60.0
    lo, hi = pack["wpm_ok"]
    if lo <= wpm <= hi:
        parts["pacing"] = 15.0
    else:
        miss = (lo - wpm) if wpm < lo else (wpm - hi)
        parts["pacing"] = max(3.0, 15.0 - miss / 6.0)

    ending = 12.0 if ends_with_punct else (8.0 if ends_with_terminal_verb else 4.0)
    if end_gap >= 0.5:               # speaker really stops here: clean cut
        ending += 4.0
    parts["ending"] = ending

    if 28.0 <= duration <= 48.0:     # sweet spot for Shorts retention
        parts["length"] = 8.0
    else:
        parts["length"] = max(0.0, 8.0 - abs(duration - 38.0) / 4.0)

    cleaned = [_norm(_word(w)) for w in c_words]
    parts["power"] = min(6.0, 2.0 * sum(1 for c in cleaned if c in pack["power"]))

    # Dead air inside the clip makes it drag
    dead = 0
    for a, b in zip(c_words, c_words[1:]):
        if _num(b, "start") - _num(a, "end") > 1.5:
            dead += 1
    parts["dead_air"] = -min(12.0, 4.0 * dead)

    # A clip that opens on filler or on "this/it/he" without context is a weak start
    weak = 0.0
    if cleaned and cleaned[0] in pack["fillers"]:
        weak += 4.0
    if cleaned and cleaned[0] in pack["backref"]:
        weak += 3.0
    parts["weak_start"] = -weak

    confs = [_num(w, "confidence", -1.0) for w in c_words]
    confs = [c for c in confs if c >= 0]
    if confs:
        avg = sum(confs) / len(confs)
        parts["recognition"] = -min(10.0, max(0.0, (0.65 - avg)) * 40.0)
    else:
        parts["recognition"] = 0.0

    total = sum(parts.values()) + 10.0
    return min(99, max(1, int(round(total)))), {k: round(v, 1) for k, v in parts.items()}
