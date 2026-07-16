#!/usr/bin/env python3
"""Windowless Task Scheduler host for the Pulse live watchdog."""

from __future__ import annotations

import argparse
import atexit
import ctypes
import datetime as dt
import os
import pathlib
import subprocess
import time
from ctypes import wintypes


ERROR_ALREADY_EXISTS = 183
HOST_MUTEX_NAME = "Local\\PulseGamingLiveWatchdogHost"


def append_log(path: pathlib.Path, message: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    with path.open("a", encoding="utf-8") as handle:
        handle.write(f"{stamp} {message}\n")


def acquire_host_mutex() -> bool:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateMutexW.argtypes = [wintypes.LPVOID, wintypes.BOOL, wintypes.LPCWSTR]
    kernel32.CreateMutexW.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    ctypes.set_last_error(0)
    handle = kernel32.CreateMutexW(None, True, HOST_MUTEX_NAME)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    if ctypes.get_last_error() == ERROR_ALREADY_EXISTS:
        kernel32.CloseHandle(handle)
        return False
    atexit.register(kernel32.CloseHandle, handle)
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--port", type=int, default=3001)
    args = parser.parse_args()

    repo_root = pathlib.Path(args.repo_root).resolve()
    watchdog = repo_root / "tools" / "local-live-watchdog.ps1"
    host_log = repo_root / "output" / "runtime" / "pulse-live-watchdog-host.log"
    powershell = pathlib.Path(os.environ.get("SystemRoot", "C:\\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
    if not acquire_host_mutex():
        append_log(host_log, "host_duplicate_exit")
        return 0
    if not watchdog.is_file():
        append_log(host_log, f"watchdog_missing path={watchdog}")
        return 2
    if not powershell.is_file():
        append_log(host_log, f"powershell_missing path={powershell}")
        return 3

    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    command = [
        str(powershell), "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(watchdog),
        "-RepoRoot", str(repo_root), "-Port", str(args.port),
    ]
    append_log(host_log, f"host_start repo={repo_root} port={args.port}")
    while True:
        try:
            child = subprocess.Popen(
                command,
                cwd=repo_root,
                creationflags=creation_flags,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            append_log(host_log, f"watchdog_started pid={child.pid}")
            exit_code = child.wait()
            append_log(host_log, f"watchdog_exit code={exit_code}; restart_in=10s")
        except Exception as error:
            append_log(host_log, f"watchdog_host_error type={type(error).__name__} message={error}; retry_in=10s")
        time.sleep(10)


if __name__ == "__main__":
    raise SystemExit(main())
