"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  repairGoalOfficialStillVisuals,
} = require("../../lib/goal-official-still-visual-repair");
const { candidateRows } = require("../../lib/goal-real-motion-materializer");
const { parseArgs } = require("../../tools/goal-official-still-visual-repair");

async function makePackage(root, storyId = "pokemon-go-official-stills") {
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Pokémon GO",
    canonical_game: "Pokémon GO",
    selected_title: "Mega Mewtwo Is Finally Coming To Pokémon Go",
    primary_source: "Pokémon GO",
    primary_source_url: "https://pokemongo.com/news/mega-mewtwo-gofest-2026",
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
  return { storyId, artifactDir };
}

function intakeReport(storyId) {
  return {
    schema_version: 1,
    execution_mode: "official_source_intake",
    accepted_references: Array.from({ length: 5 }, (_, index) => ({
      story_id: storyId,
      entity: "Pokémon GO",
      source_type: "official_press_kit_stills",
      source_owner: "Pokémon GO official site",
      source_family: `pokemon_go_mega_mewtwo_official_still_${index + 1}`,
      source_url: `https://lh3.googleusercontent.com/pokemon-official-${index + 1}.jpg`,
      reference_page_url: "https://pokemongo.com/gofest/global?hl=en",
      allowed_render_use: "reference_only_by_default",
      rights_risk_class: "official_reference_only",
      provenance: {
        source: "operator_official_source_intake",
        evidence_of_officialness: "Image is linked from the official Pokémon GO Fest Global page.",
      },
    })),
  };
}

test("official still visual repair writes rights-backed visual stills for real-motion materialisation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-official-stills-"));
  const { storyId, artifactDir } = await makePackage(root);

  const report = await repairGoalOfficialStillVisuals({
    root,
    intakeReport: intakeReport(storyId),
    storyIds: [storyId],
    generatedAt: "2026-05-27T16:20:00.000Z",
    fetchImage: async () => ({
      buffer: Buffer.alloc(4096, 11),
      contentType: "image/jpeg",
    }),
  });

  assert.equal(report.summary.candidate_count, 1);
  assert.equal(report.summary.repaired_story_count, 1);
  assert.equal(report.summary.applied_visual_asset_count, 5);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);
  assert.equal(report.safety.no_oauth_or_token_change, true);

  const rights = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  assert.equal(rights.verdict, "pass");
  assert.equal(rights.records.length, 5);
  assert.ok(rights.records.every((record) => record.source_type === "official_press_kit_stills"));
  assert.ok(rights.records.every((record) => record.asset_type === "visual_still"));
  assert.ok(rights.records.every((record) => record.allowed_platforms.includes("youtube")));
  assert.ok(rights.records.every((record) => record.approval_status === "approved_for_transformative_editorial_use"));

  const rows = candidateRows({ rightsLedger: rights });
  assert.equal(rows.length, 5);
  assert.ok(rows.every((row) => row.media_kind === "visual_still"));

  const footage = await fs.readJson(path.join(artifactDir, "footage_inventory.json"));
  assert.equal(footage.visual_asset_inventory.accepted_official_stills.length, 5);
  assert.equal(footage.motion_inventory.official_still_visual_candidates_added_count, 5);
});

test("official still visual repair rejects unsafe still URLs before fetch", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-official-stills-unsafe-"));
  const { storyId } = await makePackage(root);
  const report = intakeReport(storyId);
  report.accepted_references = report.accepted_references.map((reference, index) => ({
    ...reference,
    source_url: index % 2 === 0 ? "http://localhost/private.jpg" : "http://127.0.0.1/private.jpg",
  }));

  let fetchCalls = 0;
  const result = await repairGoalOfficialStillVisuals({
    root,
    intakeReport: report,
    storyIds: [storyId],
    generatedAt: "2026-05-27T16:45:00.000Z",
    minAssets: 1,
    fetchImage: async () => {
      fetchCalls += 1;
      return {
        buffer: Buffer.alloc(4096, 11),
        contentType: "image/jpeg",
      };
    },
  });

  assert.equal(fetchCalls, 0);
  assert.equal(result.summary.repaired_story_count, 0);
  assert.equal(result.summary.blocked_story_count, 1);
  assert.deepEqual(result.jobs[0].blockers, ["official_still_download_minimum_not_met"]);
  assert.ok(result.jobs[0].rejected.every((item) => item.reason === "invalid_official_still_url"));
});

test("official still visual repair CLI accepts intake report and story filters", () => {
  const args = parseArgs([
    "--intake-report",
    "official_source_intake_report.json",
    "--story-id",
    "story-a",
    "--story",
    "story-b",
    "--min-assets",
    "4",
    "--max-downloads-per-story",
    "6",
    "--json",
  ]);

  assert.equal(args.intakeReportPath, "official_source_intake_report.json");
  assert.deepEqual(args.storyIds, ["story-a", "story-b"]);
  assert.equal(args.minAssets, 4);
  assert.equal(args.maxDownloadsPerStory, 6);
  assert.equal(args.json, true);
});
