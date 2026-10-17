import os

import pytest

from youtube_download import validate_youtube_url, build_format, resolve_download_dir, default_download_dir


@pytest.mark.parametrize("url", [
    "https://www.youtube.com/watch?v=jNQXAC9IJRE",
    "http://youtu.be/jNQXAC9IJRE",
    "https://m.youtube.com/watch?v=abc",
    "  https://music.youtube.com/watch?v=abc  ",
])
def test_valid_urls(url):
    assert validate_youtube_url(url) == url.strip()


@pytest.mark.parametrize("url", [
    "", "not a url", "ftp://youtube.com/x", "file:///etc/passwd",
    "https://evil.com/watch?v=abc", "https://youtube.com.evil.com/watch?v=abc",
    "https://localhost:8000/api/health", "javascript:alert(1)",
])
def test_rejected_urls(url):
    with pytest.raises(ValueError):
        validate_youtube_url(url)


def test_build_format_respects_height_and_unknown_quality():
    assert "height<=720" in build_format("720")
    assert "height<=1080" in build_format("garbage")
    assert "height<=4320" in build_format("best")


def test_download_dir_default_and_custom(tmp_path):
    assert resolve_download_dir(None) == default_download_dir()
    assert resolve_download_dir("  ") == default_download_dir()
    target = tmp_path / "videos" / "yt"
    assert resolve_download_dir(str(target)) == os.path.normpath(str(target))
    assert target.is_dir()


@pytest.mark.parametrize("bad", ["relative/folder", "x/../y", "bad" + chr(0) + "path"])
def test_download_dir_rejects_relative_and_nul(bad):
    with pytest.raises(ValueError):
        resolve_download_dir(bad)


def test_download_dir_rejects_file(tmp_path):
    f = tmp_path / "a.txt"
    f.write_text("x")
    with pytest.raises(ValueError):
        resolve_download_dir(str(f))
