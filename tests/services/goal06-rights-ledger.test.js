"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGoal06RightsLedger,
  writeGoal06RightsLedger,
} = require("../../lib/goal06-rights-ledger");

async function makePackage(root, storyId, rightsLedger) {
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
    canonical_subject: "Forza Horizon 6",
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), rightsLedger);
  return {
    story_id: storyId,
    artifact_dir: artifactDir,
    artefacts: ["canonical_story_manifest.json", "rights_ledger.json"],
  };
}

function readyLedger(storyId) {
  return {
    verdict: "pass",
    assets: [
      {
        asset_id: `${storyId}_visual`,
        kind: "visual",
        path: `output/images/${storyId}.jpg`,
        source_url: "https://store.steampowered.com/app/forza",
        source_type: "official_storefront",
      },
      {
        asset_id: `${storyId}_audio`,
        kind: "audio",
        path: `output/audio/${storyId}.mp3`,
        source_type: "local_tts_voice",
      },
    ],
    rights_ledger: [
      {
        asset_id: `${storyId}_visual`,
        kind: "visual",
        path: `output/images/${storyId}.jpg`,
        source_url: "https://store.steampowered.com/app/forza",
        source_type: "official_storefront",
        licence_basis: "official_storefront_transformative_editorial_use",
        allowed_platforms: ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"],
        commercial_use_allowed: true,
        risk_score: 0.24,
        evidence_file: "rights/forza-storefront.json",
      },
      {
        asset_id: `${storyId}_audio`,
        kind: "audio",
        path: `output/audio/${storyId}.mp3`,
        source_type: "local_tts_voice",
        licence_basis: "owned_local_voice_model",
        allowed_platforms: ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"],
        commercial_use_allowed: true,
        risk_score: 0.05,
        evidence_file: "rights/local-tts.json",
      },
    ],
    missing_assets: [],
    metrics: {
      asset_count: 2,
      rights_record_count: 2,
      missing_asset_count: 0,
    },
  };
}

test("Goal 06 rights ledger passes only when every asset has explicit commercial, platform and evidence scope", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal06-ready-"));
  const storyPackage = await makePackage(root, "story-ready", readyLedger("story-ready"));

  const report = await buildGoal06RightsLedger({
    workspaceRoot: root,
    outputDir: path.join(root, "goal-06"),
    storyPackages: [storyPackage],
    generatedAt: "2026-05-25T21:00:00.000Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.summary.ready_story_count, 1);
  assert.equal(report.summary.blocked_story_count, 0);
  assert.equal(report.stories[0].status, "ready");
  assert.deepEqual(report.stories[0].blockers, []);
});

// goal-test:missing_rights_record_rejection
test("Goal 06 rights ledger blocks stale pass ledgers that still contain missing assets", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal06-stale-"));
  const storyPackage = await makePackage(root, "story-stale", {
    verdict: "pass",
    assets: [
      {
        asset_id: "story-stale-clip",
        kind: "video",
        path: "output/video/story-stale.mp4",
        source_type: "official_trailer",
      },
    ],
    records: [],
    missing_assets: [
      {
        asset_id: "story-stale-clip",
        kind: "video",
        path: "output/video/story-stale.mp4",
        source_type: "official_trailer",
      },
    ],
    metrics: {
      asset_count: 1,
      rights_record_count: 0,
      missing_asset_count: 1,
    },
  });

  const report = await buildGoal06RightsLedger({
    workspaceRoot: root,
    outputDir: path.join(root, "goal-06"),
    storyPackages: [storyPackage],
    generatedAt: "2026-05-25T21:01:00.000Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.stories[0].blockers.includes("rights:stale_pass_with_missing_assets"));
  assert.ok(report.stories[0].blockers.includes("rights:no_rights_record"));
  assert.equal(report.asset_rejection_reasons.rejected_assets[0].story_id, "story-stale");
});

test("Goal 06 rights ledger rejects unclear commercial use, narrow platform scope and high risk sources", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal06-risk-"));
  const storyPackage = await makePackage(root, "story-risk", {
    verdict: "pass",
    assets: [
      {
        asset_id: "risky-clip",
        kind: "video",
        path: "output/video/risky.mp4",
        source_url: "https://www.youtube.com/watch?v=random",
        source_type: "random_youtube_reupload",
      },
    ],
    rights_ledger: [
      {
        asset_id: "risky-clip",
        kind: "video",
        path: "output/video/risky.mp4",
        source_url: "https://www.youtube.com/watch?v=random",
        source_type: "random_youtube_reupload",
        licence_basis: "unclear_reference",
        allowed_platforms: ["youtube"],
        risk_score: 0.82,
      },
    ],
  });

  const report = await buildGoal06RightsLedger({
    workspaceRoot: root,
    outputDir: path.join(root, "goal-06"),
    storyPackages: [storyPackage],
    generatedAt: "2026-05-25T21:02:00.000Z",
  });

  const blockers = report.stories[0].blockers;
  assert.equal(report.verdict, "BLOCKED");
  assert.ok(blockers.includes("rights:commercial_use_unclear"));
  assert.ok(blockers.includes("rights:platform_not_allowed"));
  assert.ok(blockers.includes("rights:risk_score_high"));
  assert.ok(blockers.includes("rights:unverified_or_prohibited_source"));
  assert.ok(blockers.includes("rights:evidence_missing"));
});

test("Goal 06 rights ledger writes readiness, risk and rejection artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal06-write-"));
  const storyPackage = await makePackage(root, "story-write", readyLedger("story-write"));
  const report = await buildGoal06RightsLedger({
    workspaceRoot: root,
    outputDir: path.join(root, "goal-06"),
    storyPackages: [storyPackage],
    generatedAt: "2026-05-25T21:03:00.000Z",
  });

  const written = await writeGoal06RightsLedger(report, {
    outputDir: path.join(root, "goal-06"),
  });

  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.rightsLedger), true);
  assert.equal(await fs.pathExists(written.rightsRiskReport), true);
  assert.equal(await fs.pathExists(written.assetRejectionReasons), true);
  const markdown = await fs.readFile(written.readinessMarkdown, "utf8");
  assert.match(markdown, /Goal 06 Rights Ledger/);
  assert.match(markdown, /story-write: ready/);
});
