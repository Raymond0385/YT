import os

os.environ["CAPSHORTS_TESTING"] = "1"

from fastapi.testclient import TestClient

import engine

client = TestClient(engine.app)


def test_opens_only_the_configured_export_folder(monkeypatch, tmp_path):
    opened = []
    monkeypatch.setattr(engine, "current_export_dir", lambda: str(tmp_path / "exports"))
    monkeypatch.setattr(engine, "open_in_file_manager", lambda p: opened.append(p))
    r = client.post("/api/export/open-folder", json={"path": "C:/Windows"})     # a path in the request is ignored
    assert r.status_code == 200
    assert opened == [str(tmp_path / "exports")]
    assert (tmp_path / "exports").is_dir()
    assert r.json()["opened"] == str(tmp_path / "exports")


def test_foreign_websites_cannot_trigger_it(monkeypatch, tmp_path):
    monkeypatch.setattr(engine, "open_in_file_manager", lambda p: (_ for _ in ()).throw(AssertionError("must not open")))
    r = client.post("/api/export/open-folder", headers={"Origin": "https://evil.example"})
    assert r.status_code == 403


def test_failure_is_reported_without_details(monkeypatch, tmp_path):
    monkeypatch.setattr(engine, "current_export_dir", lambda: str(tmp_path))

    def boom(path):
        raise OSError("secret path details")
    monkeypatch.setattr(engine, "open_in_file_manager", boom)
    r = client.post("/api/export/open-folder")
    assert r.status_code == 500
    assert "secret" not in r.text
