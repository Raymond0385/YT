import subprocess
import sys
import threading

import parent_watch as pw


def test_reads_the_parent_id_from_the_environment():
    assert pw.parent_pid_from_env({"KADR_PARENT_PID": "1234"}) == 1234
    assert pw.parent_pid_from_env({}) is None
    assert pw.parent_pid_from_env({"KADR_PARENT_PID": "abc"}) is None
    assert pw.parent_pid_from_env({"KADR_PARENT_PID": "0"}) is None


def test_notices_when_the_app_process_exits():
    app = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    try:
        assert pw.is_alive(app.pid)
        gone = threading.Event()
        pw.watch(app.pid, gone.set, poll=0.1)
        assert not gone.wait(0.5)          # still running: nothing happens
        app.kill()
        app.wait()
        assert gone.wait(5)                # killed: noticed right away
        assert not pw.is_alive(app.pid)
    finally:
        if app.poll() is None:
            app.kill()


def test_engine_started_by_hand_is_not_watched():
    assert pw.exit_with_parent({}) is None
