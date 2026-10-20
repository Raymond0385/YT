import updates as up

CHANGELOG = """# Changelog

## [Unreleased]
### Added
- not released yet

## [1.4.2] - 2026-10-20
### Added
- Shorts track

## [1.4.1] - 2026-10-18
### Fixed
- presets

## [1.4.0] - 2026-10-18
- reframe
"""


def test_parses_sections_and_skips_unreleased():
    s = up.parse_changelog(CHANGELOG)
    assert [x["version"] for x in s] == ["1.4.2", "1.4.1", "1.4.0"]
    assert s[0]["date"] == "2026-10-20" and "Shorts track" in s[0]["body"]
    assert [x["version"] for x in up.changes_between(s, "1.4.0", "1.4.2")] == ["1.4.2", "1.4.1"]


def test_first_install_shows_nothing_and_remembers_the_version():
    shown, state = up.whats_new({}, "1.4.2", up.parse_changelog(CHANGELOG))
    assert shown["show"] is False and state["last_seen_version"] == "1.4.2"


def test_after_an_update_lists_everything_since_the_version_seen():
    state = up.mark_pending({"last_seen_version": "1.4.0"}, "1.4.0", "1.4.2", now=1)
    shown, state = up.whats_new(state, "1.4.2", up.parse_changelog(CHANGELOG))
    assert shown["show"] and shown["from"] == "1.4.0"
    assert [x["version"] for x in shown["sections"]] == ["1.4.2", "1.4.1"]
    assert "pending" not in state                     # the update arrived
    assert up.mark_seen(state, "1.4.2")["last_seen_version"] == "1.4.2"


def test_rollback_shows_nothing_and_the_next_update_shows_its_changes():
    shown, state = up.whats_new({"last_seen_version": "1.4.2"}, "1.4.1", up.parse_changelog(CHANGELOG))
    assert shown["show"] is False and state["last_seen_version"] == "1.4.1"
    shown, _ = up.whats_new(state, "1.4.2", up.parse_changelog(CHANGELOG))
    assert [x["version"] for x in shown["sections"]] == ["1.4.2"]


def test_state_round_trip(tmp_path):
    assert up.load_state(str(tmp_path)) == {}
    up.save_state(str(tmp_path), {"last_seen_version": "1.4.2"})
    assert up.load_state(str(tmp_path)) == {"last_seen_version": "1.4.2"}
    (tmp_path / up.STATE_FILE).write_text("{broken", encoding="utf-8")
    assert up.load_state(str(tmp_path)) == {}


def test_release_list_picks_the_installer_and_marks_older_versions():
    releases = [
        {"tag_name": "v1.4.2", "published_at": "2026-10-20T10:00:00Z",
         "assets": [{"name": "Kadr_1.4.2_x64_en-US.msi", "browser_download_url": "m"},
                    {"name": "Kadr_1.4.2_x64-setup.exe", "browser_download_url": "e", "size": 256 * 1024 * 1024}]},
        {"tag_name": "v1.4.1", "assets": [{"name": "Kadr_1.4.1_x64-setup.exe", "browser_download_url": "e1"}]},
        {"tag_name": "v1.5.0-beta", "prerelease": True, "assets": [{"name": "Kadr_x64-setup.exe"}]},
        {"tag_name": "v1.0.0", "assets": [{"name": "notes.txt"}]},
    ]
    out = up.release_list(releases, "windows", "1.4.2")
    assert [r["version"] for r in out] == ["1.4.2", "1.4.1"]
    assert out[0] == {"version": "1.4.2", "tag": "v1.4.2", "date": "2026-10-20", "asset_name": "Kadr_1.4.2_x64-setup.exe",
                      "download_url": "e", "size_mb": 256.0, "current": True, "older": False}
    assert out[1]["older"] is True
    assert up.release_list(releases, "darwin", "1.4.2") == []


def test_finds_the_changelog(tmp_path):
    assert up.find_changelog([str(tmp_path)]) is None
    (tmp_path / "CHANGELOG.md").write_text("x", encoding="utf-8")
    assert up.find_changelog(["", str(tmp_path / "nope"), str(tmp_path)]) == str(tmp_path / "CHANGELOG.md")


def test_engine_endpoints(monkeypatch, tmp_path):
    import os
    os.environ["CAPSHORTS_TESTING"] = "1"
    from fastapi.testclient import TestClient
    import engine
    client = TestClient(engine.app)
    monkeypatch.setattr(engine, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(engine, "local_changelog_sections", lambda: up.parse_changelog(CHANGELOG))
    monkeypatch.setattr(engine, "CURRENT_ENGINE_VERSION", "1.4.2")
    # first start: nothing to show
    assert client.get("/api/system/whats-new").json()["show"] is False
    # an update from 1.4.0 was installed
    up.save_state(str(tmp_path), {"last_seen_version": "1.4.0"})
    data = client.get("/api/system/whats-new").json()
    assert data["show"] and [s["version"] for s in data["sections"]] == ["1.4.2", "1.4.1"]
    assert client.post("/api/system/whats-new/seen").status_code == 200
    assert client.get("/api/system/whats-new").json()["show"] is False
    assert client.post("/api/system/whats-new/seen", headers={"Origin": "https://evil.example"}).status_code == 403

    releases = [{"tag_name": "v1.4.1", "assets": [{"name": "Kadr_1.4.1_x64-setup.exe", "browser_download_url": "https://github.com/x/y/1.exe"}]}]
    monkeypatch.setattr(engine, "fetch_releases", lambda: releases)
    monkeypatch.setattr(engine.platform, "system", lambda: "Windows")
    started = []
    monkeypatch.setattr(engine, "start_download_update", lambda payload: started.append(payload) or {"success": True})
    assert client.get("/api/system/releases").json()["releases"][0]["older"] is True
    assert client.post("/api/system/install-version", json={"version": "1.4.1"}).status_code == 200
    assert started[0]["version"] == "1.4.1" and started[0]["file_name"] == "Kadr_1.4.1_x64-setup.exe"
    assert client.post("/api/system/install-version", json={"version": "0.0.1"}).status_code == 404
