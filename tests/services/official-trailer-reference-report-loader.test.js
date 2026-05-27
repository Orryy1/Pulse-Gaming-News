"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  buildStillsAssetMapFromReports,
  loadStillsAssetMapFromFiles,
} = require("../../lib/official-trailer-reference-report-loader");
const {
  writeOfficialTrailerReferenceReportFiles,
} = require("../../lib/official-trailer-reference-report-files");

function reportWithPlan(storyId, assets) {
  return {
    plans: [
      {
        story_id: storyId,
        would_fetch: assets,
        would_reject: [],
        provenance: [],
        applied_assets: [],
      },
    ],
  };
}

function steamAsset(storyId, appId) {
  return {
    source_url: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
    source_type: "steam_header",
    entity: storyId,
    store_asset_source: "steam",
    store_app_id: appId,
    store_app_title: `${storyId} Steam`,
    store_match_verified: true,
  };
}

test("stills report loader keeps later story-specific reports when the first report is stale", () => {
  const stale = reportWithPlan("old_story", [steamAsset("old_story", "111")]);
  const fresh = reportWithPlan("target_story", [steamAsset("target_story", "222")]);

  const result = buildStillsAssetMapFromReports([
    { filePath: "stale.json", report: stale },
    { filePath: "fresh.json", report: fresh },
  ]);

  assert.equal(result.map.has("old_story"), true);
  assert.equal(result.map.has("target_story"), true);
  assert.equal(result.map.get("target_story")[0].store_app_id, "222");
  assert.deepEqual(result.sources, ["stale.json", "fresh.json"]);
});

test("stills report loader dedupes assets within a story while preserving first richer record", () => {
  const first = {
    ...steamAsset("target_story", "222"),
    local_path: "C:\\output\\target.jpg",
  };
  const duplicate = {
    ...steamAsset("target_story", "222"),
    local_path: null,
  };

  const result = buildStillsAssetMapFromReports([
    { filePath: "a.json", report: reportWithPlan("target_story", [first, duplicate]) },
  ]);

  assert.equal(result.map.get("target_story").length, 1);
  assert.equal(result.map.get("target_story")[0].local_path, "C:\\output\\target.jpg");
});

test("stills report loader can read story-specific trailer reference report outputs", async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-trailer-loader-"));
  const firstReport = reportWithPlan("flash_a", [steamAsset("flash_a", "111")]);
  const secondReport = reportWithPlan("flash_b", [steamAsset("flash_b", "222")]);

  const firstWritten = await writeOfficialTrailerReferenceReportFiles(firstReport, "# first\n", {
    outputDir,
  });
  const secondWritten = await writeOfficialTrailerReferenceReportFiles(secondReport, "# second\n", {
    outputDir,
  });

  const result = await loadStillsAssetMapFromFiles([
    firstWritten.storyJson,
    secondWritten.storyJson,
  ]);

  assert.equal(result.map.get("flash_a")[0].store_app_id, "111");
  assert.equal(result.map.get("flash_b")[0].store_app_id, "222");
  assert.deepEqual(result.sources, [firstWritten.storyJson, secondWritten.storyJson]);
});
