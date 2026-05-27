"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  main,
  parseArgs,
} = require("../../tools/bridge-live-rights-repair");

test("bridge live rights repair CLI parses dry-run and apply arguments", () => {
  const args = parseArgs([
    "--out-dir",
    "out",
    "--generated-at",
    "2026-05-22T08:50:00.000Z",
    "--story-id",
    "story-a",
    "--limit",
    "4",
    "--apply",
    "--operator-confirmed",
    "--json",
  ]);

  assert.equal(args.outDir, "out");
  assert.equal(args.generatedAt, "2026-05-22T08:50:00.000Z");
  assert.equal(args.storyId, "story-a");
  assert.equal(args.limit, 4);
  assert.equal(args.apply, true);
  assert.equal(args.operatorConfirmed, true);
  assert.equal(args.json, true);
});

test("bridge live rights repair CLI writes a dry-run report with injected stories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-bridge-rights-cli-"));
  const result = await main([
    "--out-dir",
    path.join(root, "out"),
    "--generated-at",
    "2026-05-22T08:51:00.000Z",
    "--json",
  ], {
    stories: [],
    db: {
      DB_PATH: path.join(root, "pulse.db"),
      getStories: async () => [],
      upsertStory: async () => {},
    },
    stdout: { write() {} },
  });

  assert.equal(result.plan.summary.candidates_seen, 0);
  assert.equal(await fs.pathExists(path.join(root, "out", "bridge_live_rights_repair_plan.json")), true);
});
