from clip_generator import detect_viral_clips, is_thought_ender, score_hook
from clip_scoring import detect_language, get_pack, score_candidate, hook_score, PACKS

RU_SENTENCES = [
    "Почему большинство людей так и не начинают свой проект?",
    "Я потратил три года, чтобы понять одну простую вещь.",
    "Секрет не в деньгах и не в удаче.",
    "Главная ошибка новичка состоит в том, что он ждёт идеального момента.",
    "Но идеального момента не существует, и это нужно принять.",
    "Начните с маленького шага уже сегодня.",
    "Через месяц вы удивитесь, сколько всего успели сделать.",
    "Вот правило, которое изменило мою жизнь: делайте, а не откладывайте.",
    "Сначала будет трудно, но потом появится привычка.",
    "Никогда не сравнивайте свой первый шаг с чужим десятым.",
]

EN_SENTENCES = [
    "Why do most people never start their project?",
    "I spent three years learning one simple thing.",
    "The secret is not money and it is not luck.",
    "The biggest mistake beginners make is waiting for the perfect moment.",
    "But the perfect moment does not exist, so accept that.",
    "Start with one small step today.",
    "In a month you will be surprised how much you did.",
    "Here is the rule that changed my life: act, do not postpone.",
    "At first it will be hard, but then a habit appears.",
    "Never compare your first step with someone else's tenth.",
]


def build(sentences, repeat=3, word_len=0.32, gap=0.08, sentence_pause=0.8, conf=None):
    words, t = [], 0.0
    for _ in range(repeat):
        for sent in sentences:
            for tok in sent.split():
                w = {"word": tok, "start": round(t, 2), "end": round(t + word_len, 2), "keyword": False}
                if conf is not None:
                    w["confidence"] = conf
                words.append(w)
                t += word_len + gap
            t += sentence_pause
    return words


def test_detect_language():
    assert detect_language(build(RU_SENTENCES, 1)) == "ru"
    assert detect_language(build(EN_SENTENCES, 1)) == "en"
    assert detect_language([]) == "en"
    mixed = build(EN_SENTENCES, 1) + [{"word": "привет", "start": 99, "end": 100}]
    assert detect_language(mixed) == "en"


def test_russian_connectors_never_end_a_thought():
    ru = PACKS["ru"]
    nxt = {"word": "Он", "start": 5.0, "end": 5.3}
    for conn in ("и", "что", "чтобы", "потому", "но", "если"):
        w = {"word": conn, "start": 1.0, "end": 1.3}
        assert not is_thought_ender(w, nxt, ru), conn
    assert is_thought_ender({"word": "сегодня.", "start": 1.0, "end": 1.3}, nxt, ru)
    assert is_thought_ender({"word": "дело", "start": 1.0, "end": 1.3}, nxt, ru)  # 3.7s pause
    assert not is_thought_ender({"word": "дело,", "start": 1.0, "end": 1.3}, nxt, ru)


def test_russian_transcript_produces_clean_clips():
    words = build(RU_SENTENCES, repeat=4)
    total = words[-1]["end"]
    clips = detect_viral_clips(words, total)
    assert 1 <= len(clips) <= 5
    ru = PACKS["ru"]
    for c in clips:
        assert 25.0 <= c["duration"] <= 61.0
        assert c["language"] == "ru"
        first, last = c["words"][0], c["words"][-1]
        assert first["word"].strip().lower().strip(".,!?") not in ru["dangling"]
        idx = words.index(last)
        nxt = words[idx + 1] if idx + 1 < len(words) else None
        assert is_thought_ender(last, nxt, ru)
        assert "score_breakdown" in c and c["score_breakdown"]
    # clips are chronological and barely overlap
    for a, b in zip(clips, clips[1:]):
        assert a["start"] <= b["start"]
        assert a["end"] - b["start"] <= 8.5


def test_english_still_works():
    words = build(EN_SENTENCES, repeat=4)
    clips = detect_viral_clips(words, words[-1]["end"])
    assert 1 <= len(clips) <= 5
    assert all(c["language"] == "en" for c in clips)
    assert all(25.0 <= c["duration"] <= 61.0 for c in clips)


def test_russian_hook_scores_higher_with_question_and_trigger_words():
    ru = PACKS["ru"]
    flat = build(["Сегодня мы поговорим о погоде за окном."], 1)
    hooky = build(["Почему никто не рассказывает этот секрет про деньги?"], 1)
    assert hook_score(hooky, ru) > hook_score(flat, ru) + 20
    assert score_hook(hooky, ru) == hook_score(hooky, ru)
    assert hook_score([], ru) == 25.0          # a hook with nothing in it is weak


def _score(words, start=0.0, end=None, **kw):
    end = end if end is not None else words[-1]["end"]
    defaults = dict(end_gap=0.8, ends_with_punct=True, ends_with_terminal_verb=False)
    defaults.update(kw)
    return score_candidate(words, start, end, defaults["end_gap"], defaults["ends_with_punct"],
                           defaults["ends_with_terminal_verb"], get_pack(words))


def test_dead_air_inside_clip_is_penalized():
    base = build(RU_SENTENCES[:4], 1, sentence_pause=0.3)
    gappy = [dict(w) for w in base]
    for w in gappy[10:]:
        w["start"] += 3.0
        w["end"] += 3.0
    s_base, b_base = _score(base)
    s_gappy, b_gappy = _score(gappy)
    assert b_base["dead_air"] == 0.0
    assert b_gappy["dead_air"] < 0
    assert s_gappy < s_base or b_gappy["pacing"] < b_base["pacing"]


def test_uncertain_recognition_is_penalized():
    sure = build(RU_SENTENCES[:4], 1, conf=0.95)
    shaky = build(RU_SENTENCES[:4], 1, conf=0.2)
    s_sure, b_sure = _score(sure)
    s_shaky, b_shaky = _score(shaky)
    assert b_sure["recognition"] == 0.0
    assert b_shaky["recognition"] < -5
    assert s_shaky < s_sure


def test_filler_or_backreference_start_is_a_weak_start():
    ok = build(["Секрет успеха в маленьких шагах каждый день."], 1)
    filler = build(["Ну короче секрет успеха в маленьких шагах каждый день."], 1)
    backref = build(["Это секрет успеха в маленьких шагах каждый день."], 1)
    assert _score(ok)[1]["weak_start"] == 0.0
    assert _score(filler)[1]["weak_start"] < 0
    assert _score(backref)[1]["weak_start"] < 0


def test_clean_cut_and_length_sweet_spot_help():
    words = build(RU_SENTENCES, 2)
    cut = _score(words, end=words[-1]["end"], end_gap=1.0)[1]
    no_cut = _score(words, end=words[-1]["end"], end_gap=0.0)[1]
    assert cut["ending"] > no_cut["ending"]
    assert _score(words, start=0.0, end=36.0)[1]["length"] == 8.0
    assert _score(words, start=0.0, end=75.0)[1]["length"] < 8.0


def test_scores_stay_in_range():
    for sents in (RU_SENTENCES, EN_SENTENCES):
        words = build(sents, 3)
        for end in (20.0, 40.0, 60.0):
            score, _ = _score(words, end=end)
            assert 1 <= score <= 99


def _talk(sentences, minutes, seed):
    import random
    r = random.Random(seed)
    words, t = [], 0.0
    while t < minutes * 60:
        for tok in r.choice(sentences).split():
            words.append({"word": tok, "start": round(t, 2), "end": round(t + 0.32, 2), "keyword": False})
            t += 0.40
        t += r.choice([0.3, 0.7, 1.0])
    return words, t


BORING_RU = ["Ну вот значит мы тут сидим и разговариваем.", "В общем это так, в целом нормально.",
             "Короче там было всё как обычно и ничего особенного.", "Значит так, вот, ну да, примерно так оно и было."]


def test_automatic_count_grows_with_the_video_and_follows_its_quality():
    from clip_generator import summarize
    short_w, short_d = _talk(RU_SENTENCES, 3, 1)
    long_w, long_d = _talk(RU_SENTENCES, 30, 2)
    boring_w, boring_d = _talk(BORING_RU, 30, 3)
    short, long_, boring = (detect_viral_clips(w, d) for w, d in ((short_w, short_d), (long_w, long_d), (boring_w, boring_d)))
    assert 1 <= len(short) <= 3
    assert len(long_) >= 10 and len(long_) > len(short)
    assert len(boring) < len(long_) / 2                       # rambling gives far fewer shorts...
    assert all(c["tier"] != "strong" for c in boring)         # ...and none of them strong
    s = summarize(long_, long_d, auto=True)
    assert s["count"] == len(long_) and s["strong"] + s["good"] + s["fair"] == s["count"]
    assert sorted(c["rank"] for c in long_) == list(range(1, len(long_) + 1))
    for a, b in zip(long_, long_[1:]):                       # in time order, overlapping by 3 s at most
        assert b["start"] >= a["start"] and a["end"] - b["start"] <= 3.0


def test_a_number_asked_for_is_respected():
    w, d = _talk(RU_SENTENCES, 30, 4)
    assert len(detect_viral_clips(w, d, target_clips_count=3)) == 3
