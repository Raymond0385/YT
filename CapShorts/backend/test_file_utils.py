import os
import time

import pytest

from file_utils import contained_path, unique_path, clean_filename, cleanup_old_files, copy_to_folder


def test_contained_path_accepts_plain_names_and_basenames(tmp_path):
    base = str(tmp_path)
    assert contained_path(base, "a.mp4") == os.path.join(base, "a.mp4")
    assert contained_path(base, "  b.mp4 ") == os.path.join(base, "b.mp4")
    assert contained_path(base, "sub/c.mp4") == os.path.join(base, "c.mp4")


@pytest.mark.parametrize("bad", ["", "..", "../x.mp4", "a/../../x", "/etc/passwd", "C:/x.mp4", "C:" + chr(92) + "x", chr(92) + "x", "a" + chr(0) + "b"])
def test_contained_path_rejects_traversal(tmp_path, bad):
    assert contained_path(str(tmp_path), bad) is None


def test_contained_path_rejects_symlink(tmp_path):
    outside = tmp_path / "outside.txt"
    outside.write_text("x")
    base = tmp_path / "base"
    base.mkdir()
    link = base / "evil.mp4"
    try:
        os.symlink(outside, link)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks not permitted on this system")
    assert contained_path(str(base), "evil.mp4") is None


def test_unique_path_adds_counter(tmp_path):
    d = str(tmp_path)
    first = unique_path(d, "v.mp4")
    assert first == os.path.join(d, "v.mp4")
    open(first, "w").close()
    second = unique_path(d, "v.mp4")
    assert second == os.path.join(d, "v (2).mp4")
    open(second, "w").close()
    assert unique_path(d, "v.mp4") == os.path.join(d, "v (3).mp4")


def test_clean_filename():
    assert clean_filename("my clip.mp4") == "my clip.mp4"
    assert clean_filename("a:b*c?.mp4") == "a_b_c_.mp4"
    assert clean_filename("") == "capshorts_export.mp4"
    assert clean_filename("../../evil") == "evil.mp4"
    assert clean_filename("x.MP4") == "x.MP4"


def test_cleanup_old_files_only_touches_matching_old_files(tmp_path):
    d = str(tmp_path)
    old_time = time.time() - 10 * 86400
    for name in ("input_1.mp4", "export_1.mp4", "keep.txt", "input_new.mp4"):
        (tmp_path / name).write_text("x")
    for name in ("input_1.mp4", "export_1.mp4", "keep.txt"):
        os.utime(os.path.join(d, name), (old_time, old_time))
    removed = cleanup_old_files(d, ("input_", "export_"), 86400)
    assert sorted(removed) == ["export_1.mp4", "input_1.mp4"]
    assert sorted(os.listdir(d)) == ["input_new.mp4", "keep.txt"]
    assert cleanup_old_files(str(tmp_path / "missing"), ("x",), 1) == []


def test_copy_to_folder_creates_folder_and_never_overwrites(tmp_path):
    src = tmp_path / "src.mp4"
    src.write_text("data")
    dest_dir = str(tmp_path / "out" / "videos")
    a = copy_to_folder(str(src), dest_dir, "clip.mp4")
    b = copy_to_folder(str(src), dest_dir, "clip.mp4")
    assert os.path.basename(a) == "clip.mp4"
    assert os.path.basename(b) == "clip (2).mp4"
