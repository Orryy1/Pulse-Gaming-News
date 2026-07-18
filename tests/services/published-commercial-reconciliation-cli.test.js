"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../../package.json");
const {
  main,
  parseArgs,
} = require("../../tools/published-commercial-reconciliation");

test("published commercial reconciliation CLI writes isolated proof from a snapshot", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-published-commercial-cli-"));
  const snapshotPath = path.join(root, "snapshot.json");
  const outputDir = path.join(root, "proof");
  await fs.writeJson(snapshotPath, {
    stories: [
      {
        id: "new-published-story",
        title: "A New Published Story",
        full_script: "A new game update gives players a concrete reason to pay attention.",
      },
    ],
    platform_posts: [
      {
        story_id: "new-published-story",
        platform: "youtube",
        status: "published",
        external_id: "yt-new",
        external_url: "https://youtube.com/shorts/yt-new",
        published_at: "2026-07-18 18:00:00",
      },
    ],
  });

  const args = parseArgs([
    "--snapshot",
    snapshotPath,
    "--out-dir",
    outputDir,
    "--generated-at",
    "2026-07-18T18:59:29.153Z",
    "--json",
  ]);
  assert.equal(args.snapshotPath, snapshotPath);
  assert.equal(args.outputDir, outputDir);
  assert.equal(args.json, true);

  const result = await main([
    "--snapshot",
    snapshotPath,
    "--out-dir",
    outputDir,
    "--generated-at",
    "2026-07-18T18:59:29.153Z",
  ]);

  assert.equal(result.report.verdict, "GREEN");
  assert.equal(result.report.totals.traced_stories, 1);
  assert.equal(
    await fs.pathExists(path.join(outputDir, "published_commercial_reconciliation.json")),
    true,
  );
  assert.equal(packageJson.scripts["ops:published-commercial-reconcile"], "node tools/published-commercial-reconciliation.js");
});
