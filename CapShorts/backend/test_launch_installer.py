import os

os.environ["CAPSHORTS_TESTING"] = "1"

import engine


def test_installer_is_started_outside_the_app_job(monkeypatch):
    calls = []
    monkeypatch.setattr(engine.subprocess, "Popen", lambda cmd, **kw: calls.append((cmd, kw.get("creationflags", 0))))
    assert engine.launch_detached_windows(["C:/tmp/Kadr_setup.exe"]) == "breakaway"
    cmd, flags = calls[0]
    assert cmd == ["C:/tmp/Kadr_setup.exe"]
    assert flags & 0x01000000          # CREATE_BREAKAWAY_FROM_JOB


def test_falls_back_to_explorer_when_leaving_the_job_is_refused(monkeypatch):
    calls = []

    def popen(cmd, **kw):
        calls.append(cmd)
        if len(calls) == 1:
            raise OSError("access denied")
    monkeypatch.setattr(engine.subprocess, "Popen", popen)
    assert engine.launch_detached_windows(["msiexec", "/i", "C:/tmp/Kadr.msi"]) == "explorer"
    assert calls[1][0].lower().endswith("explorer.exe") and calls[1][1] == "C:/tmp/Kadr.msi"
