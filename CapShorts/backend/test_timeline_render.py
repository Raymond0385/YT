import timeline_render as tr

SEGS = [{"sourceStart": 0, "sourceEnd": 10}, {"sourceStart": 15, "sourceEnd": 25}, {"sourceStart": 30, "sourceEnd": 40}]


def test_cuts_map_timeline_time_to_source_ranges():
    r = tr.clean_segments(SEGS + [{"sourceStart": 5, "sourceEnd": 5}, {"bad": 1}])
    assert r == [(0, 10), (15, 25), (30, 40)]
    assert not tr.is_trivial(r) and tr.is_trivial([(0, 60)], 60) and not tr.is_trivial([(0, 50)], 60)
    # timeline 5..18 = source 5..10 then 15..23
    assert tr.timeline_to_source_ranges(r, 5, 18) == [(5, 10), (15, 23)]
    assert tr.timeline_to_source_ranges(r, 0, 30) == [(0, 10), (15, 25), (30, 40)]
    assert tr.source_to_output(r, 16) == 11 and tr.source_to_output(r, 12) is None
    assert tr.output_duration(r) == 30 and tr.output_duration(r, 2.0) == 15


def test_select_expression_is_relative_to_where_the_input_starts():
    assert tr.select_expr([(5, 10), (15, 23)], 5) == r"between(t\,0.000\,5.000)+between(t\,10.000\,18.000)"


def test_main_video_and_sound_filters():
    assert tr.video_prefix([(0, 10)], 0, 1.0, cut=False) == ""
    v = tr.video_prefix([(0, 10), (15, 25)], 0, 1.5, cut=True)
    assert v.startswith("select='between") and "setpts=N/FRAME_RATE/TB" in v and v.endswith("setpts=PTS/1.5000")
    a = tr.audio_chain([(0, 10)], 0, 1.0, False, 0.5, 1.0, 2.0, 30)
    assert a == "volume=0.500,afade=t=in:st=0:d=1.00,afade=t=out:st=28.000:d=2.00"
    assert tr.audio_chain([(0, 10)], 0, 1.0, False, 1.0, 0, 0, 30) == "anull"
    assert tr.video_fades(0.5, 1, 20) == "fade=t=in:st=0:d=0.50,fade=t=out:st=19.000:d=1.00"
    assert tr.clamp_speed(5) == 2.0 and tr.clamp_speed("x") == 1.0 and tr.clamp_speed(0.75) == 0.75


def test_speed_scales_timed_items():
    words = [{"word": "a", "start": 2.0, "end": 3.0}]
    assert tr.scale_times(words, 2.0) == [{"word": "a", "start": 1.0, "end": 1.5}]
    assert tr.scale_times(words, 1.0) == words


def test_camera_path_follows_the_cut_output():
    # path every 0.1 s from source 0: x = 10 * source second
    xs = [int(i) for i in range(0, 400)]            # x == index == source time * 10
    out = tr.remap_camera_path(xs, 10.0, 0.0, [(0, 2), (30, 32)], 1.0, 4.0)
    assert out[5] == 5                              # output 0.5 s = source 0.5 s
    assert out[25] == 305                           # output 2.5 s = source 30.5 s
    fast = tr.remap_camera_path(xs, 10.0, 0.0, [(0, 4)], 2.0, 2.0)
    assert fast[10] == 20                           # output 1 s at 2x = source 2 s


def test_track_items_inside_the_export_window():
    tracks = [
        {"kind": "video", "items": [{"id": "v", "path": "a.mp4", "start": 8, "duration": 6, "sourceStart": 1, "x": 0.8, "y": 0.2, "scale": 0.3}]},
        {"kind": "audio", "volume": 0.5, "items": [{"id": "m", "path": "m.mp3", "start": 0, "duration": 100, "volume": 0.4, "fadeOut": 2}]},
        {"kind": "audio", "muted": True, "items": [{"id": "x", "start": 0, "duration": 5}]},
        {"kind": "video", "items": [{"id": "far", "start": 50, "duration": 5}]},
    ]
    got = tr.clip_items(tracks, 10, 20, 1.0)
    v, = got["video"]
    assert (v["out_start"], v["out_end"], v["src_start"], v["src_dur"]) == (0, 4, 3, 4)
    a, = got["audio"]
    assert (a["out_start"], a["out_end"], a["src_start"], a["track_volume"]) == (0, 10, 10, 0.5)
    assert tr.item_inputs([v], lambda it: it["path"]) == ["-ss", "3.000", "-t", "4.000", "-i", "a.mp4"]


def test_overlay_and_mix_graphs():
    item = {"out_start": 1.0, "out_end": 4.0, "x": 0.75, "y": 0.25, "scale": 0.4, "opacity": 0.5, "fadeIn": 0.5}
    g = tr.overlay_graph([item], 3, 1080, 1920, "vin", "vout")
    assert "[3:v]scale=432:-2" in g and "colorchannelmixer=aa=0.500" in g and "fade=t=in:st=0:d=0.50:alpha=1" in g
    assert "setpts=PTS-STARTPTS+1.000/TB[ov0]" in g and "[vin][ov0]overlay=x='0.7500*W-w/2'" in g and g.endswith("[vout]")
    assert tr.overlay_graph([], 3, 1080, 1920, "vin", "vout") == "[vin]null[vout]"
    m = tr.audio_mix_graph([{"out_start": 2.5, "out_end": 10, "volume": 0.5, "track_volume": 1.0}], 4, "amain", "aout")
    assert "[4:a]asetpts=PTS-STARTPTS,volume=0.500,adelay=2500|2500[ax0]" in m
    assert m.endswith("[amain][ax0]amix=inputs=2:duration=first:normalize=0:dropout_transition=0[aout]")
    alone = tr.audio_mix_graph([{"out_start": 0, "out_end": 5}], 2, None, "aout")
    assert alone.endswith("[ax0]anull[aout]")
