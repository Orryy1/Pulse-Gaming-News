// DEPLOY_WAIT_LONG (27 Nov 2026): a deploy or restart waits while the long lane builds a video. On the night of
// 26-27 Nov the deploys at 02:50, 05:17 and 05:30 restarted the factory in the middle of the Cyberpunk documentary's
// build each time, because only a running render or upload counted as busy.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { LONG_LEASE_TTL_S, longBusyForDeploy } from "../src/longlane.ts";
import { deployWindow } from "../src/handsoff/mergegate.ts";

const now = new Date("2026-11-27T05:17:00Z");
const takenAgo = (min: number) =>
  new Date(now.getTime() + LONG_LEASE_TTL_S * 1000 - min * 60_000);

test("a long tick holding its lease is busy, with the minutes it has run", () => {
  // The documentary's tick took the lease at 02:50; the 05:17 deploy came 147 minutes later.
  const r = longBusyForDeploy({
    expiresAt: takenAgo(147),
    now,
    maxMinutes: 240,
    enabled: true,
  });
  assert.deepEqual(r, { busy: true, minutes: 147 });
});

test("no lease, an expired lease or a released one is not busy", () => {
  for (const expiresAt of [
    undefined,
    null,
    new Date(now.getTime() - 1000),
    now,
  ])
    assert.equal(
      longBusyForDeploy({ expiresAt, now, maxMinutes: 240, enabled: true })
        .busy,
      false,
    );
  // Postgres hands the time back as a string.
  assert.equal(
    longBusyForDeploy({
      expiresAt: takenAgo(10).toISOString(),
      now,
      maxMinutes: 240,
      enabled: true,
    }).busy,
    true,
  );
});

test("a tick held past the cap counts as stuck, and the setting switches it off", () => {
  assert.equal(
    longBusyForDeploy({
      expiresAt: takenAgo(241),
      now,
      maxMinutes: 240,
      enabled: true,
    }).busy,
    false,
  );
  const off = longBusyForDeploy({
    expiresAt: takenAgo(20),
    now,
    maxMinutes: 240,
    enabled: false,
  });
  assert.deepEqual(off, { busy: false, minutes: 20 });
});

test("the merge gate's deploy window waits for a long video and says why", () => {
  const base = {
    now: new Date("2026-11-27T05:17:00Z"),
    slots: [],
    rendering: false,
    uploadsActive: 0,
    holdRestart: false,
  };
  assert.equal(deployWindow(base).ok, true);
  assert.equal(deployWindow({ ...base, longRunning: false }).ok, true);
  const w = deployWindow({ ...base, longRunning: true, longMinutes: 147 });
  assert.equal(w.ok, false);
  assert.match(w.why, /long video is being built.*147 min/);
});

// The shell side, run for real with a stand-in curl and pgrep.
const bashOk = spawnSync("bash", ["-c", "true"]).status === 0;

function stubDir(health: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "longdeploy-"));
  fs.writeFileSync(path.join(dir, "health.json"), health);
  fs.writeFileSync(
    path.join(dir, "curl"),
    `#!/bin/bash\ncat "${dir.replace(/\\/g, "/")}/health.json"\n`,
  );
  fs.writeFileSync(path.join(dir, "pgrep"), "#!/bin/bash\nexit 1\n");
  fs.chmodSync(path.join(dir, "curl"), 0o755);
  fs.chmodSync(path.join(dir, "pgrep"), 0o755);
  return dir;
}

function fnText(file: string, name: string): string {
  const src = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const start = src.indexOf(`${name}() {`);
  assert.ok(start >= 0, `${name} in ${file}`);
  const end = src.indexOf("\n}\n", start);
  return src.slice(start, end + 3);
}

function runBash(
  script: string,
  dir: string,
  env: Record<string, string> = {},
) {
  const bin = spawnSync(
    "bash",
    [
      "-c",
      `cygpath -u '${dir}' 2>/dev/null || echo '${dir.replace(/\\/g, "/")}'`,
    ],
    {
      encoding: "utf8",
    },
  ).stdout.trim();
  return spawnSync("bash", ["-c", `export PATH="${bin}:$PATH"\n${script}`], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

const busyHealth =
  '{"ok":true,"uploads_active":0,"long_running":true,"long_minutes":147}';
const quietHealth =
  '{"ok":true,"uploads_active":0,"long_running":false,"long_minutes":0}';

test(
  "mac/deploy.sh waits for a long video and DEPLOY_IGNORE_LONG=1 skips only that",
  { skip: !bashOk },
  () => {
    const fn = fnText(path.join("mac", "deploy.sh"), "why_busy");
    const script = `set -euo pipefail\non_mac() { bash -c "$1"; }\n${fn}\nwhy=$(why_busy)\necho "[$why]"`;
    assert.equal(
      runBash(script, stubDir(busyHealth)).stdout.trim(),
      "[a long video being built]",
    );
    assert.equal(runBash(script, stubDir(quietHealth)).stdout.trim(), "[]");
    assert.equal(
      runBash(script, stubDir(busyHealth), {
        DEPLOY_IGNORE_LONG: "1",
      }).stdout.trim(),
      "[]",
    );
    const both = '{"ok":true,"uploads_active":2,"long_running":true}';
    assert.equal(
      runBash(script, stubDir(both), { DEPLOY_IGNORE_LONG: "1" }).stdout.trim(),
      "[an upload]",
    );
  },
);

test("mac/deploy.sh stops when the Mac does not answer, never reads that as quiet", { skip: !bashOk }, () => {
  const fn = fnText(path.join("mac", "deploy.sh"), "why_busy");
  const script = `set -euo pipefail
on_mac() { return 255; }
${fn}
why=$(why_busy)
echo "[$why]"`;
  const r = runBash(script, stubDir(quietHealth));
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout.trim(), "");
});
