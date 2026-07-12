#!/usr/bin/env python3
"""Durably supervise every Pulse non-publish content worker lane."""

import pathlib
import subprocess
import threading
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
WORKER = ROOT / "tools" / "local-sqlite-content-worker.js"
NODE = pathlib.Path("C:/Program Files/nodejs/node.exe")
LANES = {
    "local-content-runway": "candidate_supply_monitor,fresh_production_refill",
    "local-content-repair": "fresh_review_script_repair,safe_auto_repair_runner,local_tts_doctor,local_tts_retry_recovery",
    "local-content-ops": "hunt,produce,analytics,scoring_digest,engage,engage_first_hour,blog_rebuild,db_backup,instagram_pending_verify,overnight_produce_sweep,overnight_analytics_backfill,overnight_claude_analyst,overnight_morning_digest",
    "local-content-learning": "live_performance_analyst,studio_analytics_loop,commercial_learning_loop,competitor_forensics_lab,competitor_quality_gate,autonomous_feedback_monitor,continuous_learning_loop",
}


def supervise(worker_id: str, kinds: str) -> None:
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    while True:
        child = subprocess.Popen(
            [str(NODE), str(WORKER), "--worker-id", worker_id, "--kinds", kinds],
            cwd=ROOT, creationflags=flags, stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        child.wait()
        time.sleep(5)


def main() -> int:
    for worker_id, kinds in LANES.items():
        threading.Thread(target=supervise, args=(worker_id, kinds), daemon=False).start()
    while True:
        time.sleep(60)


if __name__ == "__main__":
    raise SystemExit(main())
