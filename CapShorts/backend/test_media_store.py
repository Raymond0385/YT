import os

os.environ["CAPSHORTS_TESTING"] = "1"

import time

from fastapi.testclient import TestClient

import engine
import media_store as ms

client = TestClient(engine.app)


def make(path, data=b"x" * 5000):
    with open(path, "wb") as f:
        f.write(data)
    return str(path)


def test_same_video_is_stored_once_and_returned_by_id(tmp_path):
    src = make(tmp_path / "input_a.mp4", b"video-bytes" * 1000)
    media = str(tmp_path / "media")
    a = ms.keep(media, src)
    b = ms.keep(media, src)
    assert a == b and ms.ID_RE.match(a)
    assert len(os.listdir(media)) == 1
    assert open(ms.find(media, a), "rb").read() == open(src, "rb").read()


def test_survives_removal_of_the_temp_file(tmp_path):
    src = make(tmp_path / "input_a.mp4")
    mid = ms.keep(str(tmp_path / "media"), src)
    os.remove(src)
    assert os.path.getsize(ms.find(str(tmp_path / "media"), mid)) == 5000


def test_different_videos_get_different_ids(tmp_path):
    a = ms.media_id(make(tmp_path / "a.mp4", b"a" * 5_000_000))
    b = ms.media_id(make(tmp_path / "b.mp4", b"a" * 5_000_000 + b"b"))
    assert a != b


def test_bad_ids_are_not_found(tmp_path):
    assert ms.find(str(tmp_path), "../../etc/passwd") is None
    assert ms.find(str(tmp_path), "0" * 24) is None


def test_prune_removes_only_old_kept_videos(tmp_path):
    media = str(tmp_path / "media")
    old = ms.keep(media, make(tmp_path / "old.mp4", b"o" * 3000))
    new = ms.keep(media, make(tmp_path / "new.mp4", b"n" * 3000))
    p = ms.find(media, old)
    long_ago = time.time() - 200 * 86400
    os.utime(p, (long_ago, long_ago))
    open(os.path.join(media, "notes.txt"), "w").write("not ours")
    assert ms.prune(media) == 1
    assert ms.find(media, old) is None and ms.find(media, new)
    assert os.path.exists(os.path.join(media, "notes.txt"))


def test_api_keep_then_fetch(monkeypatch, tmp_path):
    monkeypatch.setattr(engine, "TEMP_DIR", str(tmp_path / "temp"))
    monkeypatch.setattr(engine, "MEDIA_DIR", str(tmp_path / "media"))
    os.makedirs(tmp_path / "temp")
    make(tmp_path / "temp" / "input_zz.mp4", b"hello video" * 100)
    r = client.post("/api/media/keep", json={"video_path": "input_zz.mp4"})
    assert r.status_code == 200
    mid = r.json()["media_id"]
    got = client.get(f"/api/media/{mid}")
    assert got.status_code == 200 and got.content == b"hello video" * 100


def test_api_rejects_missing_traversal_and_foreign_sites(monkeypatch, tmp_path):
    monkeypatch.setattr(engine, "TEMP_DIR", str(tmp_path / "temp"))
    monkeypatch.setattr(engine, "MEDIA_DIR", str(tmp_path / "media"))
    os.makedirs(tmp_path / "temp")
    assert client.post("/api/media/keep", json={"video_path": "nope.mp4"}).status_code == 404
    assert client.post("/api/media/keep", json={"video_path": "../secret.mp4"}).status_code == 404
    assert client.get("/api/media/" + "0" * 24).status_code == 404
    assert client.get("/api/media/" + "0" * 24, headers={"Origin": "https://evil.example"}).status_code == 403
