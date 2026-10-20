from text_align import (
    levenshtein, normalized_distance, align_words, apply_glossary,
    collapse_repeats, sanitize_words,
)


def W(word, start, end, kw=False):
    return {"word": word, "start": start, "end": end, "keyword": kw}


def test_levenshtein_basics():
    assert levenshtein("kitten", "sitting") == 3
    assert levenshtein("", "abc") == 3
    assert levenshtein("same", "same") == 0
    assert normalized_distance("", "") == 0.0
    assert 0.0 < normalized_distance("gpt", "gtp") < 1.0


def test_align_keeps_timings_on_substitution():
    old = [W("I", 0, 0.2), W("was", 0.2, 0.5), W("going", 0.5, 1.0), W("online", 1.0, 1.5)]
    new = align_words(old, "I was going online")
    assert [w["start"] for w in new] == [0, 0.2, 0.5, 1.0]

    fixed = align_words(old, "I was growing online")
    assert fixed[2]["word"] == "growing" and (fixed[2]["start"], fixed[2]["end"]) == (0.5, 1.0)


def test_align_insertion_and_deletion():
    old = [W("hello", 0, 1), W("big", 1, 2), W("world", 2, 3)]
    out = align_words(old, "hello world")
    assert [w["word"] for w in out] == ["hello", "world"]
    assert out[1]["start"] == 2

    out = align_words(old, "hello very nice big world")
    assert [w["word"] for w in out] == ["hello", "very", "nice", "big", "world"]
    assert out[1]["start"] >= 1.0
    starts = [w["start"] for w in out]
    assert starts == sorted(starts)


def test_align_without_old_words_or_text():
    assert align_words([], "") == []
    assert [w["word"] for w in align_words([], "a b")] == ["a", "b"]


def test_glossary_single_and_glued_run():
    words = [W("an", 0, 0.2), W("English", 0.2, 0.6), W("at", 0.6, 0.8), W("GPT", 0.8, 1.2, True),
             W("and", 1.2, 1.4), W("Kubernetes.", 1.4, 2.0)]
    out = apply_glossary(words, ["Kubernetes", "ChatGPT"])
    assert out[-1]["word"] == "Kubernetes."

    words = [W("use", 0, 0.3), W("chat", 0.3, 0.6), W("g", 0.6, 0.7), W("p", 0.7, 0.8), W("t.", 0.8, 1.0)]
    out = apply_glossary(words, ["ChatGPT"])
    assert [w["word"] for w in out] == ["use", "ChatGPT."]
    assert (out[1]["start"], out[1]["end"]) == (0.3, 1.0)


def test_glossary_does_not_touch_unrelated_words():
    words = [W("hello", 0, 1), W("world", 1, 2)]
    assert apply_glossary(words, ["Kubernetes"]) == words
    assert apply_glossary(words, []) == words


def test_collapse_repeats_loop_but_keeps_emphasis():
    loop = [W(t, i, i + 1) for i, t in enumerate("you can get it in the chat in the chat in the chat end".split())]
    out = " ".join(w["word"] for w in collapse_repeats(loop))
    assert out == "you can get it in the chat end"

    emph = [W("very", 0, 1), W("very", 1, 2), W("good", 2, 3)]
    assert len(collapse_repeats(emph)) == 3


def test_sanitize_drops_gibberish_and_fixes_zero_length():
    words = [W("hello", 0.0, 0.98), W("going", 0.98, 0.98), W("acabou很多", 1.0, 1.5), W("to", 1.5, 1.9)]
    out = sanitize_words(words)
    assert [w["word"] for w in out] == ["hello", "going", "to"]
    assert out[1]["end"] > out[1]["start"]
    assert out[1]["end"] <= out[2]["start"]


def test_align_totally_different_text_keeps_speech_span():
    old = [W("abrditels", 0.0, 1.0), W("jus", 1.0, 2.0), W("zatruts", 2.0, 3.0), W("sen", 3.0, 4.0)]
    out = align_words(old, "nobody tells you the secret")
    assert [w["word"] for w in out] == ["nobody", "tells", "you", "the", "secret"]
    starts = [w["start"] for w in out]
    assert starts == sorted(starts)
    assert out[0]["start"] >= 0.0 and out[-1]["end"] <= 4.0
    assert all(w["end"] >= w["start"] for w in out)
    assert any(w["end"] > w["start"] for w in out)


def test_align_more_new_words_than_old_spreads_in_span():
    old = [W("a", 0.0, 2.0)]
    out = align_words(old, "one two three four")
    assert out[0]["start"] >= 0.0 and out[-1]["end"] <= 2.0
    assert [w["start"] for w in out] == sorted(w["start"] for w in out)


def test_bounded_distance_matches_the_full_one():
    import random
    from text_align import levenshtein, close_distance, normalized_distance
    r = random.Random(5)
    for _ in range(2000):
        a = "".join(r.choice("abcде ") for _ in range(r.randint(0, 12)))
        b = "".join(r.choice("abcде ") for _ in range(r.randint(0, 12)))
        full = levenshtein(a, b)
        for limit in range(0, 6):
            got = levenshtein(a, b, limit)
            assert got == full if full <= limit else got > limit
        for th in (0.15, 0.25, 0.5):
            d = close_distance(a, b, th)
            nd = normalized_distance(a, b)
            assert (d is not None) == (nd <= th)


def test_long_transcripts_are_fast():
    import time
    words = [{"word": w, "start": i * 0.4, "end": i * 0.4 + 0.3, "keyword": False}
             for i, w in enumerate(("so the money is really important and you need to know this " * 300).split())]
    text = " ".join(w["word"] for w in words).replace("money", "monney")
    t0 = time.perf_counter()
    out = align_words(words, text)
    collapse_repeats(words)
    apply_glossary(words, ["Hormozi", "ChatGPT", "Kadr"])
    assert time.perf_counter() - t0 < 5.0          # was over a minute before the bounded alignment
    assert len(out) == len(words) and out[2]["start"] == words[2]["start"]
