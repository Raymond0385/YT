from subtitle_gen import compute_layout, resolve_font_family, generate_ass_subtitles, hex_to_ass_color


def preset(**kw):
    base = {"fontFamily": "Montserrat", "fontSize": 48, "fontWeight": 900, "outlineWidth": 4,
            "shadowDepth": 2, "position": "bottom-center", "maxWordsPerBlock": 2}
    base.update(kw)
    return base


def test_vertical_layout_numbers():
    lay = compute_layout(preset(), 1080, 1920)
    assert lay["font_size"] == int(48 * 1.15)
    assert lay["outline"] == 4.0
    assert lay["shadow"] == 2.0
    assert lay["alignment"] == 2
    assert lay["margin_v"] == int(1920 * 0.20)


def test_landscape_layout_scales_with_height():
    lay720 = compute_layout(preset(), 1280, 720)
    lay1080 = compute_layout(preset(), 1920, 1080)
    assert lay720["font_size"] == 38
    assert lay1080["font_size"] == 57
    # relative to canvas height the size is identical, which is what the editor preview relies on
    assert abs(lay720["font_size"] / 720 - lay1080["font_size"] / 1080) < 1e-9
    assert lay720["margin_v"] == int(720 * 0.13)


def test_positions():
    assert compute_layout(preset(position="top-center"), 1080, 1920)["alignment"] == 8
    assert compute_layout(preset(position="top-center"), 1080, 1920)["margin_v"] == int(1920 * 0.12)
    mid = compute_layout(preset(position="middle-center"), 1080, 1920)
    assert mid["alignment"] == 5 and mid["margin_v"] == 0


def test_small_fonts_are_floored():
    assert compute_layout(preset(fontSize=10), 1080, 1920)["font_size"] == 44


def test_font_aliases_match_preview_fallback():
    assert resolve_font_family("The Bold Font") == "Impact"
    assert resolve_font_family("Komika Axis, sans-serif") == "Impact"
    assert resolve_font_family("Montserrat") == "Montserrat"
    assert resolve_font_family("'Poppins', Arial") == "Poppins"
    assert resolve_font_family(None) == "Montserrat"


def test_ass_uses_resolved_font_and_layout():
    words = [{"word": "hi", "start": 0.0, "end": 1.0, "keyword": False}]
    ass = generate_ass_subtitles(words, preset(fontFamily="The Bold Font"), 1080, 1920)
    assert "Style: Default,Impact,55," in ass


def test_css_rgba_colors_are_parsed_not_white():
    # presets use rgba() for the shadow; it used to fall through to opaque white (looked like an outline)
    assert hex_to_ass_color("rgba(0,0,0,0.9)") == "&H19000000&"
    assert hex_to_ass_color("rgba(0, 0, 0, 1)") == "&H00000000&"
    assert hex_to_ass_color("rgb(255,0,0)") == "&H000000FF&"
    assert hex_to_ass_color("rgba(10,20,30,50%)") == "&H7F1E140A&"
    assert hex_to_ass_color("#112233") == "&H00332211&"
    assert hex_to_ass_color("#112233", alpha=80) == "&H50332211&"


def test_shadow_and_box_colors_in_generated_ass_are_dark():
    words = [{"word": "hi", "start": 0.0, "end": 1.0, "keyword": False}]
    ass = generate_ass_subtitles(words, preset(shadowColor="rgba(0,0,0,0.9)"), 1080, 1920)
    style = [l for l in ass.splitlines() if l.startswith("Style: Default,")][0].split(",")
    assert style[6] == "&H19000000&"          # BackColour is the shadow
    boxed = generate_ass_subtitles(words, preset(bgBox=True, bgBoxColor="rgba(0,0,0,0.6)"), 1080, 1920)
    style = [l for l in boxed.splitlines() if l.startswith("Style: Default,")][0].split(",")
    assert style[6] != "&H00FFFFFF&"


def test_zero_outline_and_shadow_mean_none():
    lay = compute_layout(preset(outlineWidth=0, shadowDepth=0), 1080, 1920)
    assert lay["outline"] == 0.0 and lay["shadow"] == 0.0
    lay = compute_layout(preset(outlineWidth=0, shadowDepth=0), 1280, 720)
    assert lay["outline"] == 0.0 and lay["shadow"] == 0.0
