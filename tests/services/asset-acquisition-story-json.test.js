"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");

test("asset acquisition CLI can use a local story override JSON", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-asset-story-json-"));
  const storyPath = path.join(dir, "story.json");
  await fs.writeJson(storyPath, {
    id: "story-json-forza",
    title: "Forza Horizon 6 Becomes Highest Rated Game of 2026 on Metacritic",
    hook: "Forza Horizon 6 just grabbed the year's top review-score slot.",
    full_script:
      "Forza Horizon 6 just grabbed the year's top review-score slot. Twisted Voxel reports the Metacritic framing.",
    approved: true,
    auto_approved: true,
    source_type: "rss",
    url: "https://twistedvoxel.com/forza-horizon-6-becomes-highest-rated-game-of-2026-on-metacritic/",
    downloaded_images: [],
    game_images: [],
    video_clips: [],
  });

  const result = spawnSync(process.execPath, ["tools/asset-acquisition-pro.js", "--story-json", storyPath, "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30000,
  });

  assert.equal(result.status, 0, result.stderr);
  const jsonStart = result.stdout.indexOf('{\n  "schema_version"');
  assert.notEqual(jsonStart, -1, result.stdout);
  const report = JSON.parse(result.stdout.slice(jsonStart));
  assert.equal(report.plans.length, 1);
  assert.equal(report.plans[0].story_id, "story-json-forza");
  assert.equal(report.plans[0].entity_map.primary, "Forza Horizon 6");
  assert.ok(report.plans[0].entity_map.games.includes("Forza Horizon 6"));
  assert.equal(report.plans[0].search_queries[0], "Forza Horizon 6");
});
