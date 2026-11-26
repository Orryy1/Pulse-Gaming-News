import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 26 Nov 2026: a PC launcher calling the orchestrator without --kind lands in the shared pulse:gpu kind, whose learned
// p50 (Pulse's short picture checks, 2.6 min) replaces a long job's --est; the watch then reported a normal 90-minute
// stream index as stuck. Every orchestrator run in windows/*.ps1 and *.cmd names its own kind.
test("every orchestrator run in windows/*.ps1 and *.cmd passes its own --kind", () => {
  const dir = path.join(import.meta.dirname, "..", "windows");
  const runs: string[] = [];
  for (const f of fs.readdirSync(dir).filter((n) => /\.(ps1|cmd)$/.test(n))) {
    for (const line of fs
      .readFileSync(path.join(dir, f), "utf8")
      .split(/\r?\n/)) {
      if (/^\s*(#|rem\b|::)/i.test(line)) continue;
      if (/(\$Orch|orch\.cmd)["']?\s+run\b/.test(line))
        runs.push(`${f}: ${line.trim()}`);
    }
  }
  assert.ok(runs.length > 0, "found the orchestrator runs");
  for (const r of runs) assert.match(r, /--kind\s+pulse:[\w-]+/, r);
});
