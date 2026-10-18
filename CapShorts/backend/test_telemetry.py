import json

import pytest

import telemetry as t


@pytest.fixture()
def cfg(tmp_path, monkeypatch):
    monkeypatch.setattr(t, "CONFIG_DIR", str(tmp_path))
    monkeypatch.setattr(t, "CONFIG_PATH", str(tmp_path / "telemetry_config.json"))
    monkeypatch.setattr(t, "DEFAULT_TELEMETRY_URL", "")
    return tmp_path


def test_there_is_no_built_in_server():
    src = open(t.__file__, encoding="utf-8").read()
    assert "workers.dev/api" not in src          # no hard-coded third-party endpoint
    assert "moharkasey" not in src


def test_off_by_default_and_unavailable_without_endpoint(cfg):
    assert t.is_telemetry_available() is False
    assert t.is_telemetry_enabled() is False


def test_opting_in_does_nothing_without_an_endpoint(cfg):
    t.set_telemetry_enabled(True)
    assert json.load(open(cfg / "telemetry_config.json"))["enabled"] is True
    assert t.is_telemetry_enabled() is False      # still off: there is nowhere to send to


def test_enabled_only_with_opt_in_and_own_endpoint(cfg, monkeypatch):
    monkeypatch.setattr(t, "DEFAULT_TELEMETRY_URL", "https://example.workers.dev/ping")
    assert t.is_telemetry_available() is True
    assert t.is_telemetry_enabled() is False      # endpoint alone is not consent
    t.set_telemetry_enabled(True)
    assert t.is_telemetry_enabled() is True
    t.set_telemetry_enabled(False)
    assert t.is_telemetry_enabled() is False


def test_endpoint_from_config_file(cfg):
    (cfg / "telemetry_config.json").write_text(json.dumps({"enabled": True, "endpoint": "https://mine.workers.dev/p"}))
    assert t.get_telemetry_url() == "https://mine.workers.dev/p"
    assert t.is_telemetry_enabled() is True


def test_nothing_is_posted_when_disabled(cfg, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("must not send")
    monkeypatch.setattr(t.requests, "post", boom)
    m = t.TelemetryManager()
    m._send_ping_worker("heartbeat", {})
    m.record_export()
    m.record_transcribe()


def test_settings_endpoint_reports_availability(monkeypatch):
    import os
    os.environ["CAPSHORTS_TESTING"] = "1"
    from fastapi.testclient import TestClient
    import engine
    monkeypatch.setattr(t, "DEFAULT_TELEMETRY_URL", "")
    r = TestClient(engine.app).get("/api/system/telemetry-settings")
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is False and body["enabled"] is False
