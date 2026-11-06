"""The Mac's Codex helper: the one call the factory needs from C:\Claude\orchestrator\codex_runner.py.

src/editorial/codex.ts imports this file and calls ask(prompt, kind, schema, timeout, images). The PC's runner also
keeps the allowance and credit books, and those stay with the orchestrator; here a failure of any kind raises, and
the factory then uses Claude for that call. Written for macOS's own Python 3.9, nothing to install. The timeout is
Python's own: macOS has no `timeout` command, and nothing here needs one.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

# kind -> (model role, effort), as on the PC.
KINDS = {"frontier": ("frontier", "ultra"), "bulk": ("workhorse", "high"), "quick": ("fast", "medium")}
FALLBACK = {"frontier": "gpt-6-astra", "workhorse": "gpt-6.1-sol", "fast": "gpt-6-luna"}
EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"]
MODELS = Path(os.environ.get("CODEX_MODELS_FILE", str(Path.home() / "PulseFactory" / "codex-models.json")))


def codex_exe() -> str:
    found = shutil.which("codex")
    if found:
        return found
    if os.path.exists("/opt/homebrew/bin/codex"):
        return "/opt/homebrew/bin/codex"
    raise RuntimeError("codex is not installed on this machine")


def models() -> dict:
    """The catalogue Codex reports, kept for a day; the PC's fallbacks when it cannot be read."""
    try:
        cached = json.loads(MODELS.read_text(encoding="utf-8"))
        if time.time() - cached.get("at", 0) < 86400 and cached.get("workhorse"):
            return cached
    except Exception:
        cached = {}
    try:
        out = subprocess.run([codex_exe(), "debug", "models"], capture_output=True, text=True, timeout=60).stdout
        cat = [x for x in json.loads(out)["models"] if x.get("visibility") == "list"]
        cat.sort(key=lambda x: x.get("priority", 99))

        def first(pat):
            return next((x["slug"] for x in cat if re.search(pat, x.get("description") or "", re.I)), None)

        new = {
            "at": time.time(),
            "frontier": first(r"frontier|most demanding") or FALLBACK["frontier"],
            "workhorse": first(r"latest workhorse|workhorse") or FALLBACK["workhorse"],
            "fast": first(r"fast and affordable|fast") or FALLBACK["fast"],
            "efforts": {x["slug"]: [e["effort"] for e in x.get("supported_reasoning_levels", [])] for x in cat},
        }
        MODELS.parent.mkdir(parents=True, exist_ok=True)
        MODELS.write_text(json.dumps(new), encoding="utf-8")
        return new
    except Exception:
        return cached if cached.get("workhorse") else {**FALLBACK, "at": 0, "efforts": {}}


def pick(kind: str):
    role, effort = KINDS.get(kind, KINDS["bulk"])
    m = models()
    model = m.get(role) or FALLBACK[role]
    ok = m.get("efforts", {}).get(model)
    if ok and effort not in ok:
        known = [e for e in ok if e in EFFORTS and EFFORTS.index(e) <= EFFORTS.index(effort)]
        effort = max(known, key=EFFORTS.index) if known else ok[-1]
    return model, effort


def ask(prompt: str, kind: str = "bulk", cwd=None, schema=None, timeout: float = 1800, images=None, search: bool = False) -> str:
    """Codex in place of a paid API call: read-only, no session kept. Raises when it fails, so the caller falls back."""
    model, effort = pick(kind)
    workdir = tempfile.mkdtemp(prefix="pulse-codex-")
    out = Path(workdir) / "answer.md"
    cmd = [codex_exe(), "exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "-m", model,
           "-c", 'model_reasoning_effort="%s"' % effort, "-c", "notify=[]", "-o", str(out), "-C", str(cwd or workdir)]
    schema_file = None
    if schema:
        # The factory hands the schema itself; Codex wants a file.
        if isinstance(schema, str) and os.path.exists(schema):
            schema_file = schema
        else:
            schema_file = str(Path(workdir) / "schema.json")
            Path(schema_file).write_text(schema if isinstance(schema, str) else json.dumps(schema), encoding="utf-8")
        cmd += ["--output-schema", schema_file]
    for img in images or []:
        cmd += ["-i", str(img)]
    if search:
        cmd += ["-c", 'web_search="live"']
    cmd.append("-")
    try:
        try:
            r = subprocess.run(cmd, input=prompt, capture_output=True, text=True, encoding="utf-8", timeout=timeout)
        except subprocess.TimeoutExpired:
            raise RuntimeError("codex exec timed out after %d s" % timeout)
        answer = out.read_text(encoding="utf-8", errors="replace") if out.exists() else ""
        if r.returncode != 0 or not answer.strip():
            tail = (r.stderr or r.stdout or "").strip().splitlines()[-1:] or [""]
            raise RuntimeError("codex exec failed (exit %d): %s" % (r.returncode, tail[0][:300]))
        return answer
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
