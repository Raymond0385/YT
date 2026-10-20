"""
subtitle_gen.py - Advanced SubStation Alpha (.ass), SRT, and VTT Generator for Kadr
Supports 100+ dynamic styles, karaoke tags, animations, outlines, shadows, and word highlighting.
Dynamically scales font size, margins, and positioning across 9:16 Shorts, 16:9 Landscape, and 1:1 Square.
"""

import math
import re
from typing import List, Dict, Any, Optional, Tuple

from animation_specs import animation_tags

_CSS_RGB = re.compile(
    r"^\s*rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*([0-9.]+%?)\s*)?\)\s*$", re.I)


def _parse_css_rgb(value):
    """'rgba(0,0,0,0.9)' -> (0, 0, 0, 0.9); None if it is not a css rgb()/rgba() color."""
    m = _CSS_RGB.match(str(value))
    if not m:
        return None
    r_v, g_v, b_v = (max(0, min(255, int(m.group(i)))) for i in (1, 2, 3))
    a_raw = m.group(4)
    if a_raw is None:
        opacity = 1.0
    elif a_raw.endswith("%"):
        opacity = float(a_raw[:-1]) / 100.0
    else:
        opacity = float(a_raw)
    return r_v, g_v, b_v, opacity


def hex_to_ass_color(hex_str: str, alpha: int = 0) -> str:
    """
    Converts #RRGGBB or #RRGGBBAA to ASS &HAABBGGRR& format.
    ASS alpha: 00 = opaque, FF = fully transparent.
    """
    if not hex_str:
        return "&H00FFFFFF&"
    
    css = _parse_css_rgb(hex_str)
    if css is not None:
        r_v, g_v, b_v, opacity = css
        # rgba() carries its own opacity, exactly like the editor preview uses it
        ass_alpha = 255 - int(round(max(0.0, min(1.0, opacity)) * 255))
        return f"&H{ass_alpha:02X}{b_v:02X}{g_v:02X}{r_v:02X}&"

    clean_hex = hex_str.strip().lstrip("#")
    
    if len(clean_hex) == 8:
        # RRGGBBAA
        r = clean_hex[0:2]
        g = clean_hex[2:4]
        b = clean_hex[4:6]
        a = clean_hex[6:8]
        # Invert alpha for ASS (00 is opaque)
        alpha_val = 255 - int(a, 16)
        return f"&H{alpha_val:02X}{b}{g}{r}&"
    elif len(clean_hex) == 6:
        # RRGGBB
        r = clean_hex[0:2]
        g = clean_hex[2:4]
        b = clean_hex[4:6]
        return f"&H{alpha:02X}{b}{g}{r}&"
    elif len(clean_hex) == 3:
        # RGB shorthand
        r = clean_hex[0] * 2
        g = clean_hex[1] * 2
        b = clean_hex[2] * 2
        return f"&H{alpha:02X}{b}{g}{r}&"
    
    return "&H00FFFFFF&"

def sanitize_ass_text(text: str) -> str:
    """Strips ASS override tag delimiters and dangerous control characters to prevent tag injection."""
    if not text:
        return ""
    sanitized = text.replace("{", "").replace("}", "").replace("\\", "")
    sanitized = sanitized.replace("\r", " ").replace("\n", " ")
    return sanitized

def format_ass_time(seconds: float) -> str:
    """Converts seconds into ASS timestamp format H:MM:SS.cs with proper carry-over arithmetic."""
    if seconds < 0:
        seconds = 0.0
    total_cs = int(round(seconds * 100))
    cs = total_cs % 100
    total_secs = total_cs // 100
    secs = total_secs % 60
    total_mins = total_secs // 60
    mins = total_mins % 60
    hrs = total_mins // 60
    return f"{hrs}:{mins:02d}:{secs:02d}.{cs:02d}"

def apply_casing(text: str, casing: str) -> str:
    """Applies uppercase, title case, lowercase or default casing."""
    casing_lower = (casing or "default").lower()
    if "upper" in casing_lower:
        return text.upper()
    elif "title" in casing_lower:
        return text.title()
    elif "lower" in casing_lower:
        return text.lower()
    return text

# Fonts the editor preview falls back to when they are not installed (see index.css @font-face local()).
FONT_ALIASES = {
    "the bold font": "Impact",
    "komika axis": "Impact",
}


def resolve_font_family(raw: Any) -> str:
    name = str(raw or "Montserrat").split(",")[0].strip().strip("'\"") or "Montserrat"
    return FONT_ALIASES.get(name.lower(), name)


def compute_layout(style: Dict[str, Any], video_width: int, video_height: int) -> Dict[str, Any]:
    """
    Font size, outline, shadow and margins for the target canvas (ASS units = canvas pixels).
    The editor preview uses the same numbers expressed relative to the canvas height.
    """
    base_font_size = float(style.get("fontSize", 48))
    outline_width = float(style.get("outlineWidth", 4.0))
    shadow_depth = float(style.get("shadowDepth", 2.0))
    position = str(style.get("position", "bottom-center")).lower()

    is_vertical_short = (video_height > video_width)
    if is_vertical_short:
        scale_ratio = video_height / 1920.0
        font_size = max(44, int(base_font_size * 1.15 * scale_ratio))
        outline = max(3.0, outline_width * scale_ratio) if outline_width > 0 else 0.0
        shadow = max(2.0, shadow_depth * scale_ratio) if shadow_depth > 0 else 0.0
        default_bottom_pct = 0.20
    else:
        scale_ratio = video_height / 720.0
        font_size = max(34, int(38.0 * scale_ratio))
        outline = max(2.5, outline_width * 0.75 * scale_ratio) if outline_width > 0 else 0.0
        shadow = max(1.5, shadow_depth * 0.75 * scale_ratio) if shadow_depth > 0 else 0.0
        default_bottom_pct = 0.13

    if "top" in position:
        alignment, margin_v = 8, int(video_height * 0.12)
    elif "middle" in position or ("center" in position and "bottom" not in position):
        alignment, margin_v = 5, 0
    else:
        alignment, margin_v = 2, int(video_height * default_bottom_pct)

    return {
        "font_size": font_size, "outline": outline, "shadow": shadow,
        "alignment": alignment, "margin_v": margin_v,
    }


# Hook title shown over the first seconds of a short. Sizes are fractions of the canvas height, the same
# numbers the editor preview uses (frontend/src/utils/titleOverlay.ts).
TITLE_FONT_REL = 0.05
TITLE_TOP_REL = 0.12
TITLE_SIDE_REL = 0.07
TITLE_PAD_REL = 0.012
TITLE_MAX_CHARS = 120
TITLE_STYLES = {
    # name: (text colour, box/outline colour, ASS border style)
    "box": ("#111111", "#FACC15", 3),
    "dark": ("#FFFFFF", "#111111", 3),
    "outline": ("#FFFFFF", "#000000", 1),
}


def title_overlay_ass(overlay: Optional[Dict[str, Any]], video_width: int, video_height: int,
                      font_family: str) -> Tuple[Optional[str], Optional[str]]:
    """(Style line, Dialogue line) for the hook title, or (None, None) when there is none."""
    if not overlay:
        return None, None
    text = sanitize_ass_text(str(overlay.get("text", "")).strip())[:TITLE_MAX_CHARS]
    if not text:
        return None, None
    duration = max(0.5, min(15.0, float(overlay.get("duration", 3.0) or 3.0)))
    fg, bg, border = TITLE_STYLES.get(str(overlay.get("style", "box")), TITLE_STYLES["box"])
    size = max(18, round(video_height * TITLE_FONT_REL))
    side = round(video_width * TITLE_SIDE_REL)
    top = round(video_height * TITLE_TOP_REL)
    pad = max(2.0, video_height * TITLE_PAD_REL) if border == 3 else max(2.0, size * 0.08)
    style = (f"Style: Title,{font_family},{size},{hex_to_ass_color(fg)},{hex_to_ass_color(fg)},{hex_to_ass_color(bg)},"
             f"{hex_to_ass_color(bg)},-1,0,0,0,100,100,0,0,{border},{pad:.1f},0,8,{side},{side},{top},1")
    event = f"Dialogue: 2,{format_ass_time(0)},{format_ass_time(duration)},Title,,0,0,0,,{{\\fad(150,250)}}{text}"
    return style, event


def generate_ass_subtitles(
    transcript: List[Dict[str, Any]],
    preset: Dict[str, Any],
    video_width: int = 1080,
    video_height: int = 1920,
    custom_overrides: Optional[Dict[str, Any]] = None,
    title_overlay: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Generates a full ASS subtitle file string from word timestamps and a preset style.
    Dynamically scales font size, margins, and layout to match the target video canvas.
    """
    style = dict(preset)
    if custom_overrides:
        style.update(custom_overrides)
    
    font_family = resolve_font_family(style.get("fontFamily"))
    
    base_font_size = float(style.get("fontSize", 48))
    font_weight = int(style.get("fontWeight", 900))
    is_bold = -1 if font_weight >= 600 else 0
    
    primary_color_ass = hex_to_ass_color(style.get("primaryColor", "#FFFFFF"))
    highlight_color_ass = hex_to_ass_color(style.get("highlightColor", "#FACC15"))
    outline_color_ass = hex_to_ass_color(style.get("outlineColor", "#000000"))
    shadow_color_ass = hex_to_ass_color(style.get("shadowColor", "#000000"), alpha=80)
    
    outline_width = float(style.get("outlineWidth", 4.0))
    shadow_depth = float(style.get("shadowDepth", 2.0))
    
    text_casing = style.get("textCasing", "UPPERCASE")
    max_words_per_block = max(1, int(style.get("maxWordsPerBlock", 2)))
    animation = style.get("animationTrigger", "pop").lower()
    position = style.get("position", "bottom-center").lower()
    karaoke_sweep = style.get("karaokeSweep", False)
    
    layout = compute_layout(style, video_width, video_height)
    scaled_font_size = layout["font_size"]
    scaled_outline = layout["outline"]
    scaled_shadow = layout["shadow"]
    alignment = layout["alignment"]
    margin_v = layout["margin_v"]

    # Border style: 1 = outline + drop shadow, 3 = opaque box
    border_style = 3 if style.get("bgBox", False) else 1
    back_colour = hex_to_ass_color(style.get("bgBoxColor", "#000000")) if border_style == 3 else shadow_color_ass
    if border_style == 3:
        # In box mode libass draws the box with the outline colour and sizes it by the outline width,
        # so both must describe the box (an outline of 0 used to make the box disappear).
        outline_color_ass = back_colour
        scaled_outline = max(scaled_outline, scaled_font_size * 0.16)
        scaled_shadow = 0.0

    header = f"""[Script Info]
Title: Kadr Export
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: {video_width}
PlayResY: {video_height}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font_family},{scaled_font_size},{primary_color_ass},{highlight_color_ass},{outline_color_ass},{back_colour},{is_bold},0,0,0,100,100,0,0,{border_style},{scaled_outline:.1f},{scaled_shadow:.1f},{alignment},40,40,{margin_v},1
Style: Highlight,{font_family},{scaled_font_size},{highlight_color_ass},{primary_color_ass},{outline_color_ass},{back_colour},{is_bold},0,0,0,100,100,0,0,{border_style},{scaled_outline:.1f},{scaled_shadow:.1f},{alignment},40,40,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    # The title always uses Montserrat: bold, readable, with Cyrillic (some preset fonts have only Latin)
    title_style, title_event = title_overlay_ass(title_overlay, video_width, video_height, resolve_font_family("Montserrat"))
    if title_style:
        header = header.replace("\n\n[Events]", f"\n{title_style}\n\n[Events]", 1)
        header += title_event + "\n"

    if not transcript:
        return header

    # Filter and sort words by start timestamp to ensure clean monotonic playback
    sorted_words = sorted(transcript, key=lambda x: x.get("start", 0.0))

    # Chunk words into groups of max_words_per_block
    events = []
    i = 0
    total_words = len(sorted_words)
    
    while i < total_words:
        block = sorted_words[i : i + max_words_per_block]
        block_start = block[0].get("start", 0.0)
        block_end = block[-1].get("end", block_start + 1.0)
        
        # Ensure minimum visible duration
        if block_end - block_start < 0.25:
            block_end = block_start + 0.25
        
        # Next block boundary check
        if i + max_words_per_block < total_words:
            next_start = sorted_words[i + max_words_per_block].get("start", block_end)
            if block_end > next_start:
                block_end = max(block_start + 0.1, next_start)

        # Build karaoke or word-by-word animation inside the block
        if karaoke_sweep:
            # Karaoke mode using \k tags
            text_parts = []
            for w in block:
                w_start = w.get("start", block_start)
                w_end = w.get("end", w_start + 0.3)
                duration_cs = max(5, int((w_end - w_start) * 100))
                word_text = apply_casing(sanitize_ass_text(w.get("word", "")), text_casing)
                text_parts.append(f"{{\\k{duration_cs}}}{word_text} ")
            
            line_text = "".join(text_parts).strip()
            start_str = format_ass_time(block_start)
            end_str = format_ass_time(block_end)
            events.append(f"Dialogue: 0,{start_str},{end_str},Default,,0,0,0,,{line_text}")
        
        elif animation in ["pop", "bounce", "fade"]:
            # Active word highlight + animation for each word in block
            for active_idx, target_word in enumerate(block):
                w_start = target_word.get("start", block_start)
                w_end = target_word.get("end", w_start + 0.3)
                
                # Active window timing
                sub_start = w_start
                if active_idx < len(block) - 1:
                    sub_end = block[active_idx + 1].get("start", w_end)
                else:
                    sub_end = block_end
                
                if sub_end <= sub_start:
                    sub_end = sub_start + 0.2
                
                start_str = format_ass_time(sub_start)
                end_str = format_ass_time(sub_end)
                
                # Same motion as the editor preview: one spec shared by both (animation_specs.py)
                anim_tag = animation_tags(animation)

                # Format all words in the block, highlighting the active target_word
                line_parts = []
                for w_idx, w in enumerate(block):
                    cased_w = apply_casing(sanitize_ass_text(w.get("word", "")), text_casing)
                    is_active = (w_idx == active_idx)
                    is_kw = bool(w.get("keyword", False))
                    
                    if is_active:
                        # \r resets the style after the word, so the animation does not carry over to the words after it
                        line_parts.append(f"{{\\c{highlight_color_ass}}}{anim_tag}{cased_w}{{\\r}}")
                    elif is_kw:
                        line_parts.append(f"{{\\c{highlight_color_ass}}}{cased_w}{{\\c{primary_color_ass}}}")
                    else:
                        line_parts.append(cased_w)
                
                line_text = " ".join(line_parts).strip()
                events.append(f"Dialogue: 0,{start_str},{end_str},Default,,0,0,0,,{line_text}")
        
        else:
            # Static display of the word block
            line_parts = []
            for w in block:
                cased_w = apply_casing(sanitize_ass_text(w.get("word", "")), text_casing)
                if w.get("keyword", False):
                    line_parts.append(f"{{\\c{highlight_color_ass}}}{cased_w}{{\\c{primary_color_ass}}}")
                else:
                    line_parts.append(cased_w)
            
            line_text = " ".join(line_parts).strip()
            start_str = format_ass_time(block_start)
            end_str = format_ass_time(block_end)
            events.append(f"Dialogue: 0,{start_str},{end_str},Default,,0,0,0,,{line_text}")
        
        i += max_words_per_block

    return header + "\n".join(events) + "\n"


def format_srt_time(seconds: float) -> str:
    """Converts seconds into SRT timestamp format HH:MM:SS,mmm with proper carry-over arithmetic."""
    if seconds < 0:
        seconds = 0.0
    total_ms = int(round(seconds * 1000))
    ms = total_ms % 1000
    total_secs = total_ms // 1000
    secs = total_secs % 60
    total_mins = total_secs // 60
    mins = total_mins % 60
    hrs = total_mins // 60
    return f"{hrs:02d}:{mins:02d}:{secs:02d},{ms:03d}"


def format_vtt_time(seconds: float) -> str:
    """Converts seconds into WebVTT timestamp format HH:MM:SS.mmm with proper carry-over arithmetic."""
    if seconds < 0:
        seconds = 0.0
    total_ms = int(round(seconds * 1000))
    ms = total_ms % 1000
    total_secs = total_ms // 1000
    secs = total_secs % 60
    total_mins = total_secs // 60
    mins = total_mins % 60
    hrs = total_mins // 60
    return f"{hrs:02d}:{mins:02d}:{secs:02d}.{ms:03d}"


def _chunk_transcript_into_sentences(
    transcript: List[Dict[str, Any]],
    max_words_per_block: int = 6,
    max_chars_per_block: int = 36
) -> List[Dict[str, Any]]:
    """Groups word-level tokens into readable subtitle lines based on natural pauses and lengths."""
    if not transcript:
        return []

    sorted_words = sorted(transcript, key=lambda x: x.get("start", 0.0))
    blocks = []
    current_block: List[Dict[str, Any]] = []

    for word_obj in sorted_words:
        word_text = str(word_obj.get("word", "")).strip()
        if not word_text:
            continue

        current_block.append(word_obj)
        current_len = sum(len(str(w.get("word", ""))) for w in current_block) + len(current_block) - 1

        # Check pause gap to next or natural sentence ending
        is_sentence_end = word_text.endswith((".", "!", "?"))
        pause_gap = False
        if len(current_block) > 1:
            prev_end = current_block[-2].get("end", 0.0)
            curr_start = word_obj.get("start", 0.0)
            if curr_start - prev_end > 0.8:
                pause_gap = True

        if len(current_block) >= max_words_per_block or current_len >= max_chars_per_block or is_sentence_end or pause_gap:
            block_start = current_block[0].get("start", 0.0)
            block_end = max(current_block[-1].get("end", block_start + 1.0), block_start + 0.4)
            line_text = " ".join(str(w.get("word", "")).strip() for w in current_block)
            blocks.append({
                "start": block_start,
                "end": block_end,
                "text": line_text
            })
            current_block = []

    if current_block:
        block_start = current_block[0].get("start", 0.0)
        block_end = max(current_block[-1].get("end", block_start + 1.0), block_start + 0.4)
        line_text = " ".join(str(w.get("word", "")).strip() for w in current_block)
        blocks.append({
            "start": block_start,
            "end": block_end,
            "text": line_text
        })

    return blocks


def generate_srt_subtitles(
    transcript: List[Dict[str, Any]],
    max_words_per_line: int = 6
) -> str:
    """Generates standard SubRip (.srt) subtitle text."""
    blocks = _chunk_transcript_into_sentences(transcript, max_words_per_block=max_words_per_line)
    lines = []
    for idx, block in enumerate(blocks, start=1):
        start_str = format_srt_time(block["start"])
        end_str = format_srt_time(block["end"])
        lines.append(f"{idx}\n{start_str} --> {end_str}\n{block['text']}\n")
    return "\n".join(lines).strip() + "\n"


def generate_vtt_subtitles(
    transcript: List[Dict[str, Any]],
    max_words_per_line: int = 6
) -> str:
    """Generates standard WebVTT (.vtt) subtitle text."""
    blocks = _chunk_transcript_into_sentences(transcript, max_words_per_block=max_words_per_line)
    lines = ["WEBVTT\n"]
    for idx, block in enumerate(blocks, start=1):
        start_str = format_vtt_time(block["start"])
        end_str = format_vtt_time(block["end"])
        lines.append(f"{idx}\n{start_str} --> {end_str}\n{block['text']}\n")
    return "\n".join(lines).strip() + "\n"

