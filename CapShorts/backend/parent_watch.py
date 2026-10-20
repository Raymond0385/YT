"""
parent_watch.py - the engine exits when the app that started it is gone.

The desktop app starts the engine and passes its own process id in KADR_PARENT_PID. If the app closes in any
way (normal exit, crash, killed, restarted by the updater) the engine follows within a moment, so it never
keeps running in the background, holding its files (which blocked uninstalling and updating) and the port.
"""

import os
import sys
import threading
import time
from typing import Callable, Optional

ENV_NAME = "KADR_PARENT_PID"


def parent_pid_from_env(env=os.environ) -> Optional[int]:
    try:
        pid = int(env.get(ENV_NAME, ""))
    except ValueError:
        return None
    return pid if pid > 0 else None


def _wait_windows(pid: int) -> bool:
    """Blocks until the process exits. False if it cannot be watched (then polling is used)."""
    import ctypes
    from ctypes import wintypes

    SYNCHRONIZE = 0x00100000
    INFINITE = 0xFFFFFFFF
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    handle = kernel32.OpenProcess(SYNCHRONIZE, False, pid)
    if not handle:
        return False
    kernel32.WaitForSingleObject(handle, INFINITE)
    kernel32.CloseHandle(handle)
    return True


def is_alive(pid: int) -> bool:
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        STILL_ACTIVE = 259
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            return False
        code = wintypes.DWORD()
        ok = kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
        kernel32.CloseHandle(handle)
        return bool(ok) and code.value == STILL_ACTIVE
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def watch(pid: int, on_gone: Callable[[], None], poll: float = 1.0) -> threading.Thread:
    """Calls on_gone() (in a background thread) once process `pid` has exited."""

    def run():
        if sys.platform == "win32" and _wait_windows(pid):
            on_gone()
            return
        while is_alive(pid):
            time.sleep(poll)
        on_gone()

    t = threading.Thread(target=run, name="parent-watch", daemon=True)
    t.start()
    return t


def exit_with_parent(env=os.environ) -> Optional[int]:
    """Starts watching the app's process if the app told us its id. Returns that id (None when run by hand)."""
    pid = parent_pid_from_env(env)
    if pid is not None:
        def gone():
            print(f"[engine] the app (pid {pid}) is gone, stopping")
            os._exit(0)
        watch(pid, gone)
    return pid
