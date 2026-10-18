import os

import pytest

import reframe as rf
from reframe import Face, Sample


def face(cx, w=200, h=240, score=0.9):
    return Face(cx=cx, cy=300, w=w, h=h, score=score)


def samples_for(xs_by_time, src_w=1920):
    return [Sample(t, [] if cx is None else [face(cx)]) for t, cx in xs_by_time]


def test_crop_geometry():
    assert rf.crop_geometry(1920, 1080) == (608, 1080)
    assert rf.crop_geometry(1280, 720) == (404, 720)      # 405 rounded down to an even width
    w, h = rf.crop_geometry(1921, 1081)
    assert w % 2 == 0 and h % 2 == 0
    assert rf.crop_geometry(300, 1080)[0] <= 300          # never wider than the source


def test_pick_subject_prefers_the_biggest_face():
    small, big = face(300, 100, 120), face(1200, 260, 300)
    assert rf.pick_subject([small, big], None, 1920) is big
    assert rf.pick_subject([], None, 1920) is None


def test_pick_subject_does_not_jump_between_similar_faces():
    a, b = face(500, 200, 240, 0.9), face(1300, 210, 250, 0.9)      # b is slightly bigger
    assert rf.pick_subject([a, b], None, 1920) is b
    assert rf.pick_subject([a, b], 520, 1920) is a                   # but we were following a


def test_track_and_coverage():
    s = [Sample(0, [face(500)]), Sample(1, []), Sample(2, [face(520)]), Sample(3, [])]
    track = rf.subject_track(s, 1920)
    assert [cx for _, cx in track] == [500, None, 520, None]
    assert rf.coverage(track) == 0.5
    assert rf.coverage([]) == 0.0


def test_should_follow_thresholds():
    many_none = [(i, None) for i in range(20)]
    assert not rf.should_follow(many_none)
    assert not rf.should_follow([(0, 500.0), (1, 500.0)])                     # too few samples to decide
    sparse = [(i, 500.0 if i < 3 else None) for i in range(20)]               # 15 %
    assert not rf.should_follow(sparse)
    enough = [(i, 500.0 if i < 8 else None) for i in range(20)]               # 40 %
    assert rf.should_follow(enough)


CROP_W = 608
SRC_W = 1920


def path(track, seconds=10.0):
    return rf.build_path(track, 0.0, seconds, SRC_W, CROP_W)


def test_a_still_speaker_keeps_the_camera_still():
    track = [(i * 0.25, 960.0) for i in range(41)]
    xs = path(track)
    assert len(xs) == 101
    assert max(xs) - min(xs) <= 2
    assert abs((xs[0] + CROP_W / 2) - 960) <= 2                # window centered on the speaker


def test_small_movements_inside_the_dead_zone_do_not_move_the_camera():
    wobble = [(i * 0.25, 960.0 + (30 if i % 2 else -30)) for i in range(41)]     # +-30 px, dead zone is ~49 px
    xs = path(wobble)
    assert max(xs) - min(xs) <= 2


def test_the_camera_follows_a_walking_speaker_smoothly():
    track = [(i * 0.25, 500.0 + i * 0.25 * 120.0) for i in range(41)]            # 120 px/s to the right
    xs = path(track)
    assert xs[-1] > xs[0] + 800
    steps = [b - a for a, b in zip(xs, xs[1:])]
    assert min(steps) >= 0                                     # never goes backwards
    assert max(steps) <= rf.MAX_SPEED * CROP_W / rf.PATH_RATE + 2   # speed limit respected
    # it stays close to the face (the face is never far from the window center)
    for i in range(10, 101, 10):
        face_x = 500.0 + (i / 10.0) * 120.0
        assert abs((xs[i] + CROP_W / 2) - face_x) < CROP_W * 0.35


def test_a_jump_to_another_place_is_a_glide_not_a_cut():
    track = [(i * 0.25, 400.0) for i in range(12)] + [(i * 0.25, 1500.0) for i in range(12, 41)]
    xs = path(track)
    steps = [abs(b - a) for a, b in zip(xs, xs[1:])]
    assert max(steps) <= rf.MAX_SPEED * CROP_W / rf.PATH_RATE + 2
    # it settles within the dead zone around the face (8 % of the window width), it does not chase every pixel
    assert abs((xs[-1] + CROP_W / 2) - 1500) <= rf.DEAD_ZONE * CROP_W + 2


def test_missing_detections_hold_and_long_gaps_wait_for_the_face():
    track = [(0.0, 700.0), (0.25, 700.0), (0.5, None), (1.0, None), (9.0, None), (9.25, 1100.0)]
    xs = path(track)
    held = xs[10]                                              # t = 1 s: no face, still where it was
    assert abs((held + CROP_W / 2) - 700) <= 3
    assert abs((xs[85] + CROP_W / 2) - 700) <= 3              # t = 8.5 s: a long gap does not make it wander
    assert xs[-1] > held                                       # it moves once the face is back


def test_window_stays_inside_the_frame():
    left = path([(i * 0.25, 20.0) for i in range(41)])
    right = path([(i * 0.25, 1900.0) for i in range(41)])
    assert min(left) >= 0 and max(left) == 0
    assert max(right) <= SRC_W - CROP_W and max(right) == SRC_W - CROP_W
    assert all(x % 2 == 0 for x in left + right)


def test_no_face_at_all_centers_the_window():
    xs = path([(i * 0.25, None) for i in range(41)])
    assert set(xs) == {int(round((SRC_W - CROP_W) / 2)) // 2 * 2}


def test_sendcmd_script_lists_only_changes():
    text = rf.sendcmd_text([10, 10, 10, 14, 14, 20], rate=10.0)
    assert text == "0.000 crop@rf x 10;\n0.300 crop@rf x 14;\n0.500 crop@rf x 20;\n"
    assert rf.sendcmd_text([]) == "\n"


def test_follow_filter_escapes_the_windows_path_and_names_the_output():
    f = rf.follow_filter(r"C:\Users\me\temp\cmds.txt", 608, 1080, 100)
    assert "sendcmd=f='C\\:/Users/me/temp/cmds.txt'" in f
    assert "crop@rf=w=608:h=1080:x=100:y=0" in f
    assert f.startswith("[0:v]") and f.endswith("[vcomp]")
    assert "scale=1080:1920" in f


def test_plan_follow_with_a_fake_detector():
    def fake(video, model, start, end):
        return [Sample(i * 0.25, [face(500 + i * 10)]) for i in range(41)], 1920, 1080
    plan = rf.plan_reframe("v.mp4", 0.0, 10.0, 1920, 1080, model_path="m.onnx", detect=fake)
    assert plan["mode"] == "follow"
    assert plan["crop_w"] == 608 and plan["crop_h"] == 1080
    assert len(plan["xs"]) == 101 and plan["coverage"] == 1.0


def test_plan_falls_back_to_blur_when_there_is_nothing_to_follow():
    none = lambda *a: ([Sample(i * 0.25, []) for i in range(40)], 1920, 1080)
    p = rf.plan_reframe("v.mp4", 0.0, 10.0, 1920, 1080, model_path="m.onnx", detect=none)
    assert p["mode"] == "blur" and "no face" in p["reason"]

    def boom(*a):
        raise RuntimeError("decoder missing")
    p = rf.plan_reframe("v.mp4", 0.0, 10.0, 1920, 1080, model_path="m.onnx", detect=boom)
    assert p["mode"] == "blur" and "decoder missing" in p["reason"]

    narrow = lambda *a: ([Sample(0, [face(100)])] * 10, 500, 1080)           # source narrower than 9:16
    p = rf.plan_reframe("v.mp4", 0.0, 10.0, 500, 1080, model_path="m.onnx", detect=narrow)
    assert p["mode"] == "blur"


def test_plan_without_a_model_falls_back(monkeypatch):
    monkeypatch.setattr(rf, "find_model", lambda extra_dirs=(): None)
    assert rf.plan_reframe("v.mp4", 0, 10, 1920, 1080)["mode"] == "blur"


def test_the_bundled_model_is_found():
    path = rf.find_model()
    assert path and os.path.basename(path) == rf.MODEL_NAME and os.path.getsize(path) > 100_000
