"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("fs-extra");

const {
  parseArgs,
  resolveAutoRetentionIntelligencePath,
} = require("../../tools/studio-v3-still-deck");

test("studio v3 wrapper auto-discovers story-specific retention intelligence", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-v3-retention-"));
  try {
    const target = path.join(dir, "story1.json");
    fs.writeJsonSync(target, {
      story_id: "story1",
      visual_v3_adjustments: { timeline_events: [] },
    });

    assert.equal(
      resolveAutoRetentionIntelligencePath("story1", {
        env: { PULSE_RETENTION_INTELLIGENCE_DIR: dir },
      }),
      target,
    );

    const args = parseArgs(["--story", "story1", "--no-acquire", "--no-motion-refresh"], {
      env: { PULSE_RETENTION_INTELLIGENCE_DIR: dir },
    });

    const idx = args.passThrough.indexOf("--retention-intelligence");
    assert.ok(idx >= 0);
    assert.equal(args.passThrough[idx + 1], target);
  } finally {
    fs.removeSync(dir);
  }
});

test("studio v3 wrapper does not apply retention intelligence for another story", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-v3-retention-"));
  try {
    fs.writeJsonSync(path.join(dir, "story1.json"), {
      story_id: "different-story",
      visual_v3_adjustments: { timeline_events: [] },
    });

    assert.equal(
      resolveAutoRetentionIntelligencePath("story1", {
        env: { PULSE_RETENTION_INTELLIGENCE_DIR: dir },
      }),
      null,
    );
  } finally {
    fs.removeSync(dir);
  }
});

test("studio v3 wrapper respects an explicit retention-intelligence argument", () => {
  const args = parseArgs(
    [
      "--story",
      "story1",
      "--retention-intelligence",
      "manual.json",
      "--no-acquire",
      "--no-motion-refresh",
    ],
    { env: { PULSE_RETENTION_INTELLIGENCE_DIR: "X:\\missing" } },
  );

  assert.equal(
    args.passThrough.filter((arg) => arg === "--retention-intelligence").length,
    1,
  );
  assert.ok(args.passThrough.includes("manual.json"));
});

test("studio v3 wrapper passes story override JSON through to the renderer", () => {
  const args = parseArgs(
    [
      "--story",
      "1tftq7f",
      "--story-json",
      "test/output/forza-corrected/story.json",
      "--no-acquire",
      "--no-motion-refresh",
    ],
    { env: {} },
  );

  const idx = args.passThrough.indexOf("--story-json");
  assert.ok(idx >= 0);
  assert.equal(args.passThrough[idx + 1], "test/output/forza-corrected/story.json");
  assert.equal(args.storyJsonPath, "test/output/forza-corrected/story.json");
  assert.ok(args.passThrough.includes("--story"));
  assert.ok(args.passThrough.includes("1tftq7f"));
});

test("studio v3 wrapper enables Visual V4 director readiness by default", () => {
  const args = parseArgs(["--story", "story1", "--no-acquire", "--no-motion-refresh"], {
    env: {},
  });

  assert.ok(args.passThrough.includes("--visual-v4"));
});
