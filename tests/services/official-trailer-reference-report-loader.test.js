"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildStillsAssetMapFromReports,
} = require("../../lib/official-trailer-reference-report-loader");

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
