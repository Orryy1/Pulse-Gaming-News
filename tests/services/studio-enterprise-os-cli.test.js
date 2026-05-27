"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { main, parseArgs } = require("../../tools/studio-enterprise-os");

test("Studio Enterprise OS CLI parses operator inputs", () => {
  const parsed = parseArgs([
    "--stories",
    "stories.json",
    "--retention-baseline",
    "retention.json",
    "--revenue-paths",
    "revenue.json",
    "--out-dir",
    "out",
    "--generated-at",
    "2026-05-20T13:00:00.000Z",
    "--json",
  ]);

  assert.equal(path.basename(parsed.storiesPath), "stories.json");
  assert.equal(path.basename(parsed.retentionBaselinePath), "retention.json");
  assert.equal(path.basename(parsed.revenuePathsPath), "revenue.json");
  assert.equal(path.basename(parsed.outDir), "out");
  assert.equal(parsed.generatedAt, "2026-05-20T13:00:00.000Z");
  assert.equal(parsed.json, true);
});

test("Studio Enterprise OS CLI writes a full operator artefact pack", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-enterprise-cli-"));
  const storiesPath = path.join(tmp, "stories.json");
  const retentionPath = path.join(tmp, "retention.json");
  const revenuePath = path.join(tmp, "revenue.json");
  const commentsPath = path.join(tmp, "comments.json");
  const outputDir = path.join(tmp, "out");

  await fs.writeJson(storiesPath, [
    {
      id: "mixtape",
      title: "Mixtape Just Avoided Gaming's Delisting Trap",
      full_script:
        "Mixtape just dodged one of gaming's worst preservation problems because its developer paid extra for lasting music rights.",
      breaking_score: 75,
      downloaded_images: [{ path: "mixtape.jpg" }],
    },
  ]);
  await fs.writeJson(retentionPath, {
    stayed_to_watch: 48,
    avg_watch_seconds_estimate: 16,
    audience_core: "male_25_44_uk_us_mobile",
  });
  await fs.writeJson(revenuePath, {
    totals: { paths: 1, pass: 1, review: 0, blocked_for_compliance: 0 },
    top_paths: [
      {
        story_id: "mixtape",
        title: "Mixtape Just Avoided Gaming's Delisting Trap",
        route: "/p/mixtape-music-rights",
        revenue_path_score: 70,
        verdict: "pass",
      },
    ],
  });
  await fs.writeJson(commentsPath, {
    newCommentCount: 1,
    categoryCounts: { correction: 1 },
    decisionCounts: { needs_review: 1 },
  });

  const result = await main([
    "--stories",
    storiesPath,
    "--retention-baseline",
    retentionPath,
    "--revenue-paths",
    revenuePath,
    "--comments",
    commentsPath,
    "--out-dir",
    outputDir,
    "--generated-at",
    "2026-05-20T13:00:00.000Z",
  ]);

  assert.equal(result.pack.engine, "studio_enterprise_os_v1");
  assert.equal(await fs.pathExists(path.join(outputDir, "studio_enterprise_os.json")), true);
  assert.equal(await fs.pathExists(path.join(outputDir, "studio_enterprise_os.md")), true);
  assert.equal(await fs.pathExists(path.join(outputDir, "multi_platform_format_plan.json")), true);
  assert.match(await fs.readFile(path.join(outputDir, "studio_enterprise_os.md"), "utf8"), /Studio Enterprise OS v1/);
});
