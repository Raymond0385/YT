import os

import pytest

import groq_chunks as gc


def W(word, s, e):
    return {"word": word, "start": s, "end": e, "keyword": False}


SILENCE_LOG = """
[silencedetect @ 000001] silence_start: 12.5
[silencedetect @ 000001] silence_end: 13.9 | silence_duration: 1.4
[silencedetect @ 000001] silence_start: 300.25
[silencedetect @ 000001] silence_end: 300.75 | silence_duration: 0.5
[silencedetect @ 000001] silence_start: 999
frame=  0 junk
"""


def test_parse_silences():
    assert gc.parse_silences(SILENCE_LOG) == [(12.5, 13.9), (300.25, 300.75)]   # an unfinished pause is dropped
    assert gc.parse_silences("") == []
    assert gc.parse_silences("silence_start: -0.004\nsilence_end: 0.7") == [(0.0, 0.7)]


def test_language_codes():
    assert gc.language_code("Russian") == "ru"
    assert gc.language_code("english") == "en"
    assert gc.language_code("ru") == "ru"
    assert gc.language_code("Klingon") is None
    assert gc.language_code(None) is None
    assert gc.language_code("") is None


def test_needs_chunking():
    assert not gc.needs_chunking(600, 3 * 1024 * 1024)
    assert gc.needs_chunking(gc.CHUNK_AFTER_SECONDS + 1, 1024)
    assert gc.needs_chunking(60, gc.CHUNK_AFTER_BYTES + 1)


def test_short_recording_is_one_chunk():
    assert gc.plan_chunks(0, []) == []
    assert gc.plan_chunks(600, []) == [(0.0, 600.0)]
    assert gc.plan_chunks(900, []) == [(0.0, 900.0)]


def assert_valid_plan(chunks, duration, max_len=gc.MAX_CHUNK):
    assert chunks[0][0] == 0.0 and chunks[-1][1] == pytest.approx(duration, abs=0.01)
    for (a, b), (c, d) in zip(chunks, chunks[1:]):
        assert b == c                                  # no gaps, no overlap
    assert all(0 < b - a <= max_len + 1e-6 for a, b in chunks)


def test_cuts_land_in_the_longest_pause_near_the_target():
    silences = [(590.0, 590.4), (604.0, 606.0), (640.0, 640.5)]    # the 2 s pause around 605 s is the best cut
    chunks = gc.plan_chunks(1500, silences)
    assert chunks[0] == (0.0, 605.0)
    assert_valid_plan(chunks, 1500)


def test_without_pauses_it_cuts_at_the_target_and_respects_the_maximum():
    chunks = gc.plan_chunks(3600, [])
    assert_valid_plan(chunks, 3600)
    assert len(chunks) == 6 and chunks[0] == (0.0, 600.0)


def test_pauses_outside_the_window_are_ignored():
    chunks = gc.plan_chunks(1500, [(200.0, 205.0), (880.0, 890.0)])
    assert chunks[0][1] == 600.0
    assert_valid_plan(chunks, 1500)


def test_a_tiny_tail_is_merged_into_the_previous_chunk():
    chunks = gc.plan_chunks(1230, [])      # 600 + 600 + 30 -> the 30 s tail joins the second chunk
    assert chunks == [(0.0, 600.0), (600.0, 1230.0)]
    assert_valid_plan(chunks, 1230)


def test_a_very_long_recording_is_planned_fast_and_valid():
    chunks = gc.plan_chunks(8 * 3600, [(i * 97.0, i * 97.0 + 0.6) for i in range(300)])
    assert_valid_plan(chunks, 8 * 3600)
    assert len(chunks) >= 32


def test_merge_words_applies_offsets_and_sorts():
    parts = [(0.0, [W("a", 0.0, 0.4), W("b", 0.5, 0.9)]), (600.0, [W("c", 0.1, 0.5), W("d", 0.6, 1.0)])]
    out = gc.merge_words(parts)
    assert [w["word"] for w in out] == ["a", "b", "c", "d"]
    assert out[2]["start"] == 600.1 and out[3]["end"] == 601.0
    assert parts[1][1][0]["start"] == 0.1              # the input is not modified


def test_merge_words_trims_a_tiny_overlap_at_a_chunk_edge():
    parts = [(0.0, [W("a", 598.0, 600.2)]), (600.0, [W("b", 0.1, 0.5)])]
    out = gc.merge_words(parts)
    assert out[0]["end"] <= out[1]["start"]


def test_run_chunked_stitches_chunks_and_keeps_one_language(monkeypatch, tmp_path):
    import groq_transcribe as gt
    calls = []
    cuts = []

    def fake_extract(ffmpeg, audio, start, end, out):
        cuts.append((start, end))
        open(out, "wb").write(b"x")

    def fake_groq(path, keys, language, prompt=None):
        calls.append((os.path.basename(path), language, prompt))
        i = len(calls)
        return [W(f"w{i}", 1.0, 1.5)], 600.0, "Russian"

    monkeypatch.setattr(gc, "extract_chunk", fake_extract)
    monkeypatch.setattr(gt, "transcribe_with_groq_pool", fake_groq)
    progress = []
    words, dur, lang = gc.run_chunked("a.mp3", 1500.0, "ffmpeg", ["key"], "auto", "ChatGPT", str(tmp_path), "job1",
                                      progress=lambda i, n: progress.append((i, n)), silences=[(604.0, 606.0)])
    assert cuts[0] == (0.0, 605.0) and len(cuts) == len(calls) >= 2
    assert [c[1] for c in calls] == ["auto", "ru", "ru"][:len(calls)]       # detected once, then fixed
    assert all(c[2] == "ChatGPT" for c in calls)
    assert [w["word"] for w in words] == [f"w{i + 1}" for i in range(len(calls))]
    assert words[1]["start"] == pytest.approx(605.0 + 1.0)                  # offset of the second chunk
    assert lang == "Russian" and dur == 1500.0
    assert progress[0] == (0, len(calls)) and progress[-1] == (len(calls), len(calls))
    assert os.listdir(tmp_path) == []                                       # chunk files are removed


def test_run_chunked_cleans_up_and_propagates_a_failure(monkeypatch, tmp_path):
    import groq_transcribe as gt

    def fake_extract(ffmpeg, audio, start, end, out):
        open(out, "wb").write(b"x")

    def boom(*a, **k):
        raise RuntimeError("All Groq keys failed")

    monkeypatch.setattr(gc, "extract_chunk", fake_extract)
    monkeypatch.setattr(gt, "transcribe_with_groq_pool", boom)
    with pytest.raises(RuntimeError):
        gc.run_chunked("a.mp3", 1500.0, "ffmpeg", ["k"], None, None, str(tmp_path), "j", silences=[])
    assert os.listdir(tmp_path) == []
