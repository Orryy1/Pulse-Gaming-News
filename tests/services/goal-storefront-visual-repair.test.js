"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  repairGoalStorefrontVisuals,
  storefrontGameTarget,
} = require("../../lib/goal-storefront-visual-repair");
const { parseArgs } = require("../../tools/goal-storefront-visual-repair");
const { candidateRows } = require("../../lib/goal-real-motion-materializer");

async function makeBlockedPackage(root, storyId = "hades-storefront") {
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Hades II",
    canonical_game: "Hades II",
    selected_title: "Hades II Finally Hits PlayStation",
    thumbnail_headline: "HADES II ON PLAYSTATION",
    first_spoken_line: "Hades II finally gave PlayStation players the date.",
    narration_script:
      "Hades II finally gave PlayStation players the date. Xbox showed the latest trailer and the sharper point is simple: watch the footage, then wait for the launch details.",
    primary_source: "Xbox",
    primary_source_url: "https://www.youtube.com/watch?v=ppEKFy83w-o",
    source_confidence_score: 0.84,
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "rights_ledger.json"), {
    story_id: storyId,
    verdict: "fail",
    failures: ["rights:no_rights_record"],
    records: [],
    assets: [],
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
      production_motion_clips: [],
    },
  }, { spaces: 2 });
  return {
    story_id: storyId,
    title: "Hades II Finally Hits PlayStation",
    artifact_dir: artifactDir,
    status: "blocked_on_render_inputs",
    blockers: [
      "materialised_motion_clips_missing",
      "real_visual_motion_clips_missing",
    ],
    actions: [{ action_id: "materialise_validated_real_motion_clips" }],
  };
}

function fakeSteamHttp() {
  return {
    async get(url) {
      if (url.includes("/api/storesearch/")) {
        return {
          data: {
            items: [{ id: 1145350, name: "Hades II" }],
          },
        };
      }
      if (url.includes("/api/appdetails")) {
        return {
          data: {
            1145350: {
              data: {
                name: "Hades II",
                screenshots: Array.from({ length: 5 }, (_, index) => ({
                  path_full: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1145350/ss_${index + 1}.jpg`,
                  width: 1920,
                  height: 1080,
                })),
              },
            },
          },
        };
      }
      throw new Error(`unexpected url ${url}`);
    },
  };
}

test("storefront visual repair adds rights-recorded Steam stills for real-motion materialisation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-storefront-visuals-"));
  const job = await makeBlockedPackage(root);

  const report = await repairGoalStorefrontVisuals({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-05-23T10:00:00.000Z",
    storeSearchHttp: fakeSteamHttp(),
    storeDetailsHttp: fakeSteamHttp(),
    fetchImage: async () => ({
      buffer: Buffer.alloc(4096, 9),
      contentType: "image/jpeg",
    }),
  });

  assert.equal(report.summary.candidate_count, 1);
  assert.equal(report.summary.repaired_story_count, 1);
  assert.ok(report.summary.applied_visual_asset_count >= 5);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);
  assert.equal(report.safety.no_oauth_or_token_change, true);

  const rights = await fs.readJson(path.join(job.artifact_dir, "rights_ledger.json"));
  assert.equal(rights.verdict, "pass");
  assert.ok(rights.records.length >= 5);
  assert.ok(rights.records.filter((record) => record.source_type === "steam_screenshot").length >= 5);
  assert.ok(rights.records.every((record) => record.allowed_platforms.includes("youtube")));
  assert.ok(rights.records.every((record) => record.approval_status === "approved_for_transformative_editorial_use"));

  const rows = candidateRows({ rightsLedger: rights });
  assert.ok(rows.length >= 5);
  assert.ok(rows.every((row) => row.media_kind === "visual_still"));
  assert.ok(new Set(rows.map((row) => row.source_family)).size >= 5);

  const footage = await fs.readJson(path.join(job.artifact_dir, "footage_inventory.json"));
  assert.ok(footage.visual_asset_inventory.accepted_storefront_stills.length >= 5);
  assert.ok(footage.motion_inventory.storefront_visual_candidates_added_count >= 5);
});

test("storefront visual repair CLI exposes gameplay still cap for stricter motion budgets", () => {
  const args = parseArgs([
    "--work-order",
    "work-order.json",
    "--max-gameplay-stills-per-entity",
    "8",
    "--max-store-assets-per-entity",
    "9",
  ]);

  assert.equal(args.workOrderPath, "work-order.json");
  assert.equal(args.maxGameplayStillsPerEntity, 8);
  assert.equal(args.maxStoreAssetsPerEntity, 9);
});

test("storefront visual repair blocks packages without a real game target instead of fabricating media", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-storefront-visuals-block-"));
  const job = await makeBlockedPackage(root, "xbox-policy-story");
  const canonicalPath = path.join(job.artifact_dir, "canonical_story_manifest.json");
  const canonical = await fs.readJson(canonicalPath);
  canonical.canonical_game = "Xbox";
  canonical.canonical_subject = "Xbox";
  await fs.writeJson(canonicalPath, canonical, { spaces: 2 });

  const report = await repairGoalStorefrontVisuals({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-05-23T10:05:00.000Z",
    storeSearchHttp: fakeSteamHttp(),
    fetchImage: async () => ({ buffer: Buffer.alloc(1024), contentType: "image/jpeg" }),
  });

  assert.equal(report.summary.repaired_story_count, 0);
  assert.equal(report.jobs[0].status, "blocked");
  assert.ok(report.jobs[0].blockers.includes("storefront_game_target_missing"));
});

test("storefront visual repair searches the distinctive subtitle for long franchise names", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-storefront-visuals-subtitle-"));
  const job = await makeBlockedPackage(root, "dawn-of-war-story");
  const canonicalPath = path.join(job.artifact_dir, "canonical_story_manifest.json");
  const canonical = await fs.readJson(canonicalPath);
  canonical.canonical_game = "Warhammer 40,000: Dawn of War 4";
  canonical.canonical_subject = "Warhammer 40,000: Dawn of War 4";
  canonical.selected_title = "Dawn Of War 4 Already Has A Roadmap";
  await fs.writeJson(canonicalPath, canonical, { spaces: 2 });

  const searched = [];
  const report = await repairGoalStorefrontVisuals({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-05-23T10:20:00.000Z",
    storeSearchHttp: {
      async get(url) {
        searched.push(url);
        if (url.includes("/api/storesearch/")) {
          return { data: { items: [] } };
        }
        throw new Error(`unexpected url ${url}`);
      },
    },
    fetchImage: async () => ({ buffer: Buffer.alloc(1024), contentType: "image/jpeg" }),
  });

  assert.equal(report.jobs[0].status, "blocked");
  assert.ok(report.jobs[0].blockers.includes("storefront_visual_asset_minimum_not_met"));
  assert.equal(report.jobs[0].target, "Dawn of War 4");
  assert.ok(searched.some((url) => /Dawn\+of\+War\+4|Dawn%20of%20War%204/i.test(url)));
});

test("storefront target prefers the clean headline subject over inflated event wording", () => {
  const target = storefrontGameTarget({
    canonical_game: "STRANGER THAN HEAVEN Five Eras",
    canonical_subject: "STRANGER THAN HEAVEN Five Eras",
    selected_title: "Stranger Than Heaven Shows Five Eras",
  });

  assert.equal(target, "Stranger Than Heaven");
});
