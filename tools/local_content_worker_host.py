#!/usr/bin/env python3
"""Windowless durable host for one Pulse non-publish content worker lane."""

import argparse
import pathlib
import subprocess
import time


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--worker-id", required=True)
    parser.add_argument("--kinds", required=True)
    args = parser.parse_args()
    root = pathlib.Path(args.repo_root).resolve()
    worker = root / "tools" / "local-sqlite-content-worker.js"
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    while True:
        child = subprocess.Popen(
            ["node.exe", str(worker), "--worker-id", args.worker_id, "--kinds", args.kinds],
            cwd=root,
            creationflags=flags,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        child.wait()
        time.sleep(5)


if __name__ == "__main__":
    raise SystemExit(main())
