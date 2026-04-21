const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// Task 10 coverage: the timing report must not contradict
// lib/scheduler.js. Two specific regressions being pinned:
//   1. DEFAULT_SCHEDULE in optimal_timing.js used "07:00 / 13:00 /
//      19:00" before Task 3 of the cadence session shipped 09/14/19.
//   2. The report's "Active Schedule" section used to render the
//      analytics-derived recommendation; it now reads the
//      canonical scheduler so operators see what ACTUALLY fires.

const { DEFAULT_SCHEDULE } = require("../../optimal_timing");
const { DEFAULT_SCHEDULES } = require("../../lib/scheduler");

test("DEFAULT_SCHEDULE: crons match the canonical 3x publish windows (09/14/19 UTC)", () => {
  assert.deepStrictEqual(DEFAULT_SCHEDULE.crons, [
    "0 9 * * *",
    "0 14 * * *",
    "0 19 * * *",
  ]);
});

test("DEFAULT_SCHEDULE: labels reference the canonical scheduler, not legacy 07/13/19", () => {
  // Any label that still says "07:00 UTC" is the stale legacy
  // timing from before Task 3. Pin the current labels so a
  // future edit doesn't silently regress.
  for (const label of DEFAULT_SCHEDULE.labels) {
    assert.strictEqual(
      label.startsWith("07:00"),
      false,
      `DEFAULT_SCHEDULE label still references legacy 07:00: "${label}"`,
    );
  }
  // And at least one label mentions each of 09/14/19 so they
  // match what lib/scheduler.js actually registers.
  const joined = DEFAULT_SCHEDULE.labels.join(" ");
  assert.match(joined, /09:00/);
  assert.match(joined, /14:00/);
  assert.match(joined, /19:00/);
});

test("DEFAULT_SCHEDULE: matches lib/scheduler.js publish windows exactly", () => {
  const schedulerPublishCrons = DEFAULT_SCHEDULES.filter(
    (s) => s.kind === "publish",
  )
    .map((s) => s.cron_expr)
    .sort();
  const timingCrons = [...DEFAULT_SCHEDULE.crons].sort();
  assert.deepStrictEqual(
    timingCrons,
    schedulerPublishCrons,
    "DEFAULT_SCHEDULE crons must mirror lib/scheduler.js publish windows — drift produces misleading reports",
  );
});

test("optimal_timing.js source: 'Active Schedule' block reads from lib/scheduler", () => {
  // Source-scan pin so a future refactor can't silently fall
  // back to rendering only the analytics recommendation under
  // the "Active Schedule" label — that's what made the report
  // misleading in the first place.
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "optimal_timing.js"),
    "utf8",
  );
  const activeBlock = src.match(
    /\*\*Active Schedule[\s\S]*?lines\.push\(""\);/,
  );
  assert.ok(
    activeBlock,
    "Active Schedule section not found in timing report generator",
  );
  assert.match(
    activeBlock[0],
    /require\(['"]\.\/lib\/scheduler['"]\)/,
    "Active Schedule must read from lib/scheduler (the source of truth)",
  );
  // And it should clearly separate the analytics recommendation
  // as a reference section rather than labelling it active.
  assert.match(
    src,
    /Analytics-recommended schedule.*for reference only/,
    "analytics recommendation must be labelled 'for reference only'",
  );
});

test("optimal_timing.js source: no hard-coded 07:00/13:00 in Active Schedule rendering", () => {
  // Belt-and-braces: the fixed canonical list must not be the
  // old legacy one, and no raw "07:00" / "13:00" literal should
  // appear in the rendered block.
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "optimal_timing.js"),
    "utf8",
  );
  // Find the active-schedule rendering block.
  const activeBlock = src.match(
    /\*\*Active Schedule[\s\S]*?lines\.push\(""\);/,
  );
  assert.ok(activeBlock);
  assert.strictEqual(
    activeBlock[0].includes('"07:00'),
    false,
    "legacy 07:00 string still in Active Schedule block",
  );
  assert.strictEqual(
    activeBlock[0].includes('"13:00'),
    false,
    "legacy 13:00 string still in Active Schedule block",
  );
});
