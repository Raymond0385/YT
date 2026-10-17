import os

import pytest

from youtube_download import validate_youtube_url, build_format, resolve_download_dir, default_download_dir, find_js_runtimes, explain_error


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


def test_find_js_runtimes_prefers_bundled_quickjs(tmp_path):
    exe = tmp_path / ("qjs.exe" if os.name == "nt" else "qjs")
    exe.write_text("x")
    if os.name != "nt":
        exe.chmod(0o755)
    found = find_js_runtimes([str(tmp_path)])
    assert found["quickjs"]["path"].lower().startswith(str(tmp_path).lower())


def test_find_js_runtimes_handles_missing_dirs(tmp_path):
    assert isinstance(find_js_runtimes([str(tmp_path / "nope"), ""]), dict)
    assert isinstance(find_js_runtimes(None), dict)


def test_explain_error_messages():
    assert "private" in explain_error(Exception("Video is private")).lower()
    assert "internet" in explain_error(Exception("<urlopen error getaddrinfo failed>")).lower()
    assert explain_error(Exception("something odd")).startswith("Could not read")
