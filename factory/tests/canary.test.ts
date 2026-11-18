import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countErrorLines,
  errorsPerMinuteBefore,
  judgeCanary,
  rollbackMessage,
  type CanarySample,
} from "../src/canary.ts";

const deployed = new Date("2026-11-14T12:00:00Z");
const base = { errorsPerMinute: 0.05, errorLinesAtDeploy: 10, tickMinutes: 10 };
const at = (m: number) =>
  new Date(deployed.getTime() + m * 60_000).toISOString();
const healthy = (m: number, errors = 10, tick = true): CanarySample => ({
  at: at(m),
  health: {
    ok: true,
    lastTick: tick ? at(Math.max(1, m - 1)) : "2026-11-14T11:55:00Z",
  },
  errorLines: errors,
  release: "new",
});

test("a healthy deploy stays healthy, and is only called healthy once the watch is over", () => {
  const s = [1, 2, 3, 26].map((m) => healthy(m));
  assert.equal(
    judgeCanary(base, s, deployed, "new", false).verdict,
    "watching",
  );
  assert.equal(judgeCanary(base, s, deployed, "new", true).verdict, "healthy");
});

test("a regression is any of: /health gone, errors jumping, ticks stopped, or the Mac already back on old code", () => {
  const down = [
    healthy(1),
    ...[2, 3, 4, 5].map((m) => ({ at: at(m), errorLines: 10, release: "new" })),
  ];
  assert.match(
    judgeCanary(base, down, deployed, "new", false).reasons.join(),
    /has not answered/,
  );
  const errors = [healthy(1, 12), healthy(5, 30)];
  assert.match(
    judgeCanary(base, errors, deployed, "new", false).reasons.join(),
    /20 errors in 5 minutes/,
  );
  const stuck = [healthy(5, 10, false), healthy(26, 10, false)];
  assert.match(
    judgeCanary(base, stuck, deployed, "new", false).reasons.join(),
    /no tick has completed/,
  );
  const back = [{ ...healthy(2), release: "old" }];
  assert.match(
    judgeCanary(base, back, deployed, "new", false).reasons.join(),
    /rolled itself back/,
  );
  // A couple of errors after a restart is normal.
  assert.equal(
    judgeCanary(base, [healthy(3, 12)], deployed, "new", false).verdict,
    "watching",
  );
});

test("error counting and the baseline rate read the factory's own log lines", () => {
  const log = [
    `{"t":"2026-11-14T11:10:00.000Z","level":"error","msg":"a"}`,
    `{"t":"2026-11-14T11:40:00.000Z","level":"info","msg":"b"}`,
    `{"t":"2026-11-14T11:50:00.000Z","level":"error","msg":"c"}`,
    `{"t":"2026-11-14T12:10:00.000Z","level":"error","msg":"d"}`,
  ].join("\n");
  assert.equal(countErrorLines(log), 3);
  assert.equal(errorsPerMinuteBefore(log, deployed), 2 / 60);
  assert.match(
    rollbackMessage("abcdef1234", "1234abcdef", ["x"], true),
    /put the previous version \(1234abcde\) back/,
  );
});
