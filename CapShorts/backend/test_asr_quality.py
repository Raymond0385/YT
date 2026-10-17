from asr_quality import (
    logprob_to_confidence, is_weak_segment, merge_ranges, limit_retry_ranges, replace_range,
)


def W(word, s, e, conf=None):
    return {"word": word, "start": s, "end": e, "keyword": False, "confidence": conf}


def test_logprob_to_confidence_bounds():
    assert logprob_to_confidence(None) is None
    assert logprob_to_confidence(0.0) == 1.0
    assert 0.3 < logprob_to_confidence(-1.0) < 0.4
    assert logprob_to_confidence(-50.0) == 0.0


def test_weak_segment_by_logprob_ratio_and_gibberish():
    good = [W("hello", 0, 1, 0.9), W("world", 1, 2, 0.95)]
    assert not is_weak_segment(-0.2, 1.2, 0.01, good)
    assert is_weak_segment(-1.4, 1.2, 0.01, good)
    assert is_weak_segment(-0.2, 3.1, 0.01, good)
    junk = [W("acabou" + chr(0x5F88) + chr(0x591A), 0, 1), W("fine", 1, 2), W("ok", 2, 3)]
    assert is_weak_segment(-0.2, 1.0, 0.0, junk)


def test_weak_segment_by_low_word_confidence():
    low = [W("a", 0, 1, 0.1), W("b", 1, 2, 0.2), W("c", 2, 3, 0.9)]
    assert is_weak_segment(-0.3, 1.0, 0.0, low)


def test_merge_ranges_pads_and_joins_close_ones():
    out = merge_ranges([(5.0, 7.0), (7.4, 9.0), (30.0, 31.0)], gap=0.6, pad=0.3, total=40.0)
    assert out == [(4.7, 9.3), (29.7, 31.3)]
    assert merge_ranges([], total=10) == []
    assert merge_ranges([(0.0, 1.0)], pad=0.5, total=1.2) == [(0.0, 1.2)]


def test_limit_retry_ranges_respects_budget_and_keeps_order():
    ranges = [(0.0, 10.0), (20.0, 22.0), (40.0, 49.0)]
    out = limit_retry_ranges(ranges, total=60.0, max_fraction=0.35)  # budget 21s
    assert out == [(0.0, 10.0), (40.0, 49.0)] or sum(e - s for s, e in out) <= 21.0
    assert sum(e - s for s, e in out) <= 21.0
    assert out == sorted(out)
    assert limit_retry_ranges(ranges, total=10.0, max_fraction=0.1) == []


def test_replace_range_swaps_only_words_inside():
    words = [W("a", 0, 1), W("bad1", 4, 5), W("bad2", 5, 6), W("z", 10, 11)]
    new = [W("good", 4.1, 5.9, 0.9)]
    out = replace_range(words, 3.8, 6.2, new)
    assert [w["word"] for w in out] == ["a", "good", "z"]
