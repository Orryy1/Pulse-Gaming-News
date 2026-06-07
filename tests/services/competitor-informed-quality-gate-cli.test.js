"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { parseArgs, usage } = require("../../tools/competitor-informed-quality-gate");

test("competitor-informed quality gate CLI parses local proof inputs", () => {
  const args = parseArgs([
    "--story-packages", "output/goal-contract/story-packages.json",
    "--rulebook", "output/competitor-forensics-lab/pulse_upgrade_rulebook.json",
    "--out-dir", "output/competitor-quality-gate",
    "--generated-at", "2026-06-07T12:00:00.000Z",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.rulebookPath, "output/competitor-forensics-lab/pulse_upgrade_rulebook.json");
  assert.equal(args.outDir, "output/competitor-quality-gate");
  assert.equal(args.generatedAt, "2026-06-07T12:00:00.000Z");
  assert.equal(args.json, true);
});

test("competitor-informed quality gate usage documents no publish side effects", () => {
  assert.match(usage(), /does not publish/i);
  assert.match(usage(), /does not weaken gates/i);
});
