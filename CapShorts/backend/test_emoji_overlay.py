import os

import pytest

from emoji_overlay import (
    attach_to_filters, block_text_length, build_overlay_graph, emoji_filename, emoji_geometry,
    estimate_lines, find_emoji_dir, shift_events,
)
from subtitle_gen import compute_layout

HERE = os.path.dirname(os.path.abspath(__file__))
EMOJI_DIR = os.path.join(HERE, "emoji")

STYLE = {"fontSize": 48, "outlineWidth": 4, "shadowDepth": 2, "position": "bottom-center"}


def test_emoji_filename_drops_variation_selector():
    assert emoji_filename("\U0001F525") == "1f525.png"                  # fire
    assert emoji_filename("⚠️") == "26a0.png"                 # warning sign with FE0F
    assert emoji_filename("❤️") == "2764.png"
    assert emoji_filename("\U0001F3F7️") == "1f3f7.png"


def test_every_emoji_the_editor_can_show_has_an_image():
    import re
    src = open(os.path.join(HERE, "..", "frontend", "src", "utils", "emojiHelper.ts"), encoding="utf-8").read()
    emojis = set(re.findall(r":\s*'([^']+)'", src))
    assert len(emojis) >= 50
    missing = [e for e in emojis if not os.path.isfile(os.path.join(EMOJI_DIR, emoji_filename(e)))]
    assert missing == []


def test_find_emoji_dir(tmp_path):
    assert find_emoji_dir(["", str(tmp_path / "nope"), str(tmp_path)]) == str(tmp_path)
    assert find_emoji_dir([]) is None


def test_shift_events_for_a_clip():
    events = [
        {"start": 1.0, "end": 2.0, "emoji": "a"},      # before the clip
        {"start": 9.0, "end": 12.0, "emoji": "b"},     # straddles the start
        {"start": 15.0, "end": 16.0, "emoji": "c"},    # inside
        {"start": 19.5, "end": 25.0, "emoji": "d"},    # straddles the end
        {"start": 30.0, "end": 31.0, "emoji": "e"},    # after
        {"start": 16.0, "end": 16.0, "emoji": "f"},    # empty
        {"start": "x", "end": 1, "emoji": "g"},        # broken
    ]
    out = shift_events(events, 10.0, 20.0)
    assert [(e["emoji"], e["start"], e["end"]) for e in out] == [("b", 0.0, 2.0), ("c", 5.0, 6.0), ("d", 9.5, 10.0)]
    assert [e["emoji"] for e in shift_events(events, None, None)] == ["a", "b", "c", "d", "e"]
    assert shift_events(None, 0, 1) == []


def test_text_length_and_line_estimate():
    words = [{"word": "STOP", "start": 1.0, "end": 1.3}, {"word": "making", "start": 1.35, "end": 1.7}, {"word": "later", "start": 5.0, "end": 5.3}]
    assert block_text_length(words, 1.0, 1.7) == len("STOP making")
    assert block_text_length(words, 9, 10) == 0
    assert estimate_lines(11, 55, 1080) == 1
    assert estimate_lines(60, 55, 1080) == 2
    assert estimate_lines(100, 55, 1080) == 3   # capped at three lines
    assert estimate_lines(0, 55, 1080) == 1


def test_emoji_sits_above_the_text_and_inside_the_frame():
    lay = compute_layout(STYLE, 1080, 1920)
    size1, y1 = emoji_geometry(lay["font_size"], lay["margin_v"], lay["alignment"], 1, 1920)
    size2, y2 = emoji_geometry(lay["font_size"], lay["margin_v"], lay["alignment"], 2, 1920)
    assert size1 == size2 == round(lay["font_size"] * 1.4)
    assert y2 < y1                               # more text lines push the emoji higher
    assert y1 + size1 < 1920 - lay["margin_v"]   # and it ends above the text block
    top = compute_layout({**STYLE, "position": "top-center"}, 1080, 1920)
    _, ytop = emoji_geometry(top["font_size"], top["margin_v"], top["alignment"], 1, 1920)
    assert 0 <= ytop < 1920
    mid = compute_layout({**STYLE, "position": "middle-center"}, 1080, 1920)
    _, ymid = emoji_geometry(mid["font_size"], mid["margin_v"], mid["alignment"], 1, 1920)
    assert 0 < ymid < 960


def test_build_graph_uses_one_input_per_emoji_and_splits_repeats():
    lay = compute_layout(STYLE, 1080, 1920)
    fire, money = "\U0001F525", "\U0001F4B8"
    events = [
        {"start": 1.0, "end": 2.0, "emoji": fire},
        {"start": 3.0, "end": 4.0, "emoji": money},
        {"start": 5.0, "end": 6.0, "emoji": fire},
    ]
    words = [{"word": "fire", "start": 1.0, "end": 1.5}]
    args, graph = build_overlay_graph(events, EMOJI_DIR, words, 1080, 1920, lay, first_input_index=1)
    assert args.count("-i") == 2 and args.count("-loop") == 2
    assert graph is not None
    assert "[1:v]format=rgba" in graph and "split=2" in graph       # fire is used twice
    assert "[2:v]format=rgba" in graph and "split" not in graph.split("[2:v]")[1].split(";")[0]
    assert graph.startswith("[1:v]")
    assert "[vsub][em0_0]overlay" in graph
    assert graph.endswith("[vfinal]")
    assert graph.count("overlay=") == 3
    assert "enable='between(t,1.000,2.000)'" in graph and "shortest=1" in graph


def test_build_graph_skips_events_without_assets_or_input(tmp_path):
    lay = compute_layout(STYLE, 1080, 1920)
    ev = [{"start": 0, "end": 1, "emoji": "\U0001F525"}]
    assert build_overlay_graph([], EMOJI_DIR, [], 1080, 1920, lay, 1) == ([], None)
    assert build_overlay_graph(ev, None, [], 1080, 1920, lay, 1) == ([], None)
    assert build_overlay_graph(ev, str(tmp_path), [], 1080, 1920, lay, 1) == ([], None)   # empty asset dir


def test_build_graph_caps_the_number_of_events():
    lay = compute_layout(STYLE, 1080, 1920)
    events = [{"start": i, "end": i + 0.5, "emoji": "\U0001F525"} for i in range(500)]
    args, graph = build_overlay_graph(events, EMOJI_DIR, [], 1080, 1920, lay, 1, max_events=10)
    assert graph.count("overlay=") == 10 and args.count("-i") == 1


def test_attach_to_filter_complex_renames_the_subtitle_output():
    base = ["-filter_complex", "[0:v]split=2[fg][bg];[vcomp]ass='s.ass'[vfinal]", "-map", "[vfinal]", "-map", "0:a?"]
    out = attach_to_filters(base, "[vsub][e]overlay[vfinal]")
    assert out[0] == "-filter_complex"
    assert out[1] == "[0:v]split=2[fg][bg];[vcomp]ass='s.ass'[vsub];[vsub][e]overlay[vfinal]"
    assert out[2:] == ["-map", "[vfinal]", "-map", "0:a?"]
    assert base[1].endswith("[vfinal]")          # input list untouched


def test_attach_converts_a_plain_vf():
    out = attach_to_filters(["-vf", "ass='s.ass'"], "[vsub][e]overlay[vfinal]")
    assert out == ["-filter_complex", "[0:v]ass='s.ass'[vsub];[vsub][e]overlay[vfinal]", "-map", "[vfinal]", "-map", "0:a?"]


def test_attach_leaves_unknown_arguments_alone():
    assert attach_to_filters([], "x") == []
    assert attach_to_filters(["-filter_complex", "no final label"], "x") == ["-filter_complex", "no final label"]
