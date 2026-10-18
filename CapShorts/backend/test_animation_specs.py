import json
import os

import pytest

import animation_specs as an
from subtitle_gen import generate_ass_subtitles

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC_FILE = os.path.join(HERE, "..", "frontend", "src", "data", "animations.json")


@pytest.fixture(scope="module")
def specs():
    return an.load_specs(SPEC_FILE)


def test_spec_file_is_found_and_complete(specs):
    assert {"pop", "bounce", "fade"} <= set(specs)
    for name, spec in specs.items():
        kfs = spec["keyframes"]
        assert spec["durationMs"] > 0
        assert kfs[0]["at"] == 0 and kfs[-1]["at"] == 1, name
        assert [k["at"] for k in kfs] == sorted(k["at"] for k in kfs), name
        assert all(0 <= k["opacity"] <= 1 and k["scaleX"] > 0 and k["scaleY"] > 0 for k in kfs), name


def test_default_lookup_finds_the_same_file():
    assert set(an.load_specs(refresh=True)) >= {"pop", "bounce", "fade"}


def test_missing_file_gives_no_animation():
    assert an.load_specs(os.path.join(HERE, "nope.json")) == {}
    assert an.animation_tags("pop", {}) == ""


def test_pop_override_text(specs):
    assert an.ass_override(specs["pop"]) == (
        r"{\fscx90\fscy90\alpha&H26&\t(0,90,\fscx115\fscy115\alpha&H00&)\t(90,180,\fscx100\fscy100\alpha&H00&)}"
    )


def test_unknown_names_have_no_tags(specs):
    for name in ("none", "glow", "", "POP2"):
        assert an.animation_tags(name, specs) == ""
    assert an.animation_tags("POP", specs) != ""              # case does not matter


@pytest.mark.parametrize("name", ["pop", "bounce", "fade"])
def test_ass_tags_play_the_same_curve_as_the_spec(specs, name):
    """What libass computes from the tags equals the spec the preview CSS is generated from."""
    spec = specs[name]
    tags = an.ass_override(spec)
    for t in range(0, int(spec["durationMs"]) + 60, 10):
        want = an.evaluate(spec, t)
        got = an.evaluate_tags(tags, t)
        assert got == pytest.approx(want, abs=0.012), (name, t, want, got)


def test_values_at_the_key_moments(specs):
    assert an.evaluate(specs["pop"], 0) == pytest.approx((0.9, 0.9, 0.85))
    assert an.evaluate(specs["pop"], 90) == pytest.approx((1.15, 1.15, 1.0))
    assert an.evaluate(specs["pop"], 500) == pytest.approx((1.0, 1.0, 1.0))      # settled after the animation
    assert an.evaluate(specs["bounce"], 110)[1] == pytest.approx(1.25)
    assert an.evaluate(specs["fade"], 100)[2] == pytest.approx(0.5)


STYLE = {"fontFamily": "Montserrat", "fontSize": 48, "fontWeight": 900, "outlineWidth": 4, "shadowDepth": 2,
         "position": "bottom-center", "maxWordsPerBlock": 2, "animationTrigger": "pop", "textCasing": "Default"}
WORDS = [
    {"word": "first", "start": 1.0, "end": 1.4, "keyword": False},
    {"word": "second", "start": 1.5, "end": 1.9, "keyword": False},
]


def dialogues(style):
    ass = generate_ass_subtitles(WORDS, style, 1080, 1920)
    return [l for l in ass.splitlines() if l.startswith("Dialogue:")]


def test_only_the_active_word_is_animated_and_the_style_resets_after_it():
    lines = dialogues(STYLE)
    assert len(lines) == 2                               # one event per active word
    first, second = (l.split(",,", 1)[1] for l in lines)
    for text in (first, second):
        assert text.count(r"\t(") == 2                   # exactly one animated word per event
        assert r"{\r}" in text                           # reset right after it
    # the animated word is followed by the reset before the next word starts
    assert first.index(r"{\r}") < first.index("second")
    assert second.index("first") < second.index(r"\t(")  # in the 2nd event the first word is plain


@pytest.mark.parametrize("name", ["none", "glow"])
def test_no_animation_means_no_transforms(name):
    ass = "\n".join(dialogues({**STYLE, "animationTrigger": name}))
    assert r"\t(" not in ass


def test_spec_json_is_valid_utf8_json():
    with open(SPEC_FILE, encoding="utf-8") as f:
        assert isinstance(json.load(f), dict)
