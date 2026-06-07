"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { parseArgs, usage } = require("../../tools/competitor-upgrade-bakeoff");

test("competitor upgrade bakeoff CLI parses local proof inputs", () => {
  const args = parseArgs([
    "--candidates", "output/goal-contract/story-packages.json",
    "--rulebook", "output/competitor-forensics-lab/pulse_upgrade_rulebook.json",
    "--out-dir", "output/competitor-upgrade-bakeoff",
    "--generated-at", "2026-06-07T12:00:00.000Z",
    "--json",
  ]);

  assert.equal(args.candidatesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.rulebookPath, "output/competitor-forensics-lab/pulse_upgrade_rulebook.json");
  assert.equal(args.outDir, "output/competitor-upgrade-bakeoff");
  assert.equal(args.generatedAt, "2026-06-07T12:00:00.000Z");
  assert.equal(args.json, true);
});

test("competitor upgrade bakeoff usage documents no live publishing", () => {
  assert.match(usage(), /Do not live-publish/i);
  assert.match(usage(), /does not mutate DB/i);
});
