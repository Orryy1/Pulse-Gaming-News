"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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

async function makeFreshGoalContractPackage(root, storyId = "gta-vi-official-stills") {
  const artifactDir = path.join(root, "output", "goal-contract", "fresh-green-buffer-local-promotion-20260622", "packages", storyId);
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Grand Theft Auto VI",
    canonical_game: "Grand Theft Auto VI",
    selected_title: "GTA 6 Preorders Begin June 25",
    primary_source: "Rockstar Games",
    primary_source_url: "https://www.rockstargames.com/VI/media",
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

test("official still visual repair writes hash-bound local-review stills and fails closed without a publish grant", async () => {
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
  assert.equal(rights.verdict, "warn");
  assert.equal(rights.result, "AMBER");
  assert.equal(rights.can_auto_publish, false);
  assert.equal(rights.not_publishable, true);
  assert.ok(rights.publish_blockers.includes("rights:live_publish_not_allowed"));
  assert.ok(
    rights.publish_blockers.includes("rights:human_legal_review_required_before_publish"),
  );
  assert.equal(rights.records.length, 5);
  assert.ok(rights.records.every((record) => record.source_type === "official_press_kit_stills"));
  assert.ok(rights.records.every((record) => record.asset_type === "visual_still"));
  assert.ok(rights.records.every((record) => record.allowed_platforms.length === 0));
  assert.ok(rights.records.every((record) => record.commercial_use_allowed === false));
  assert.ok(rights.records.every((record) => record.live_publish_allowed === false));
  assert.ok(
    rights.records.every(
      (record) => record.requires_human_legal_review_before_publish === true,
    ),
  );
  assert.ok(
    rights.records.every(
      (record) => record.approval_status === "approved_for_local_materialization_only",
    ),
  );
  assert.ok(rights.records.every((record) => /^[a-f0-9]{64}$/.test(record.evidence_sha256)));
  assert.ok(rights.records.every((record) => fs.existsSync(record.evidence_file)));

  const rows = candidateRows({ rightsLedger: rights });
  assert.equal(rows.length, 5);
  assert.ok(rows.every((row) => row.media_kind === "visual_still"));

  const footage = await fs.readJson(path.join(artifactDir, "footage_inventory.json"));
  assert.equal(footage.visual_asset_inventory.accepted_official_stills.length, 5);
  assert.equal(footage.motion_inventory.official_still_visual_candidates_added_count, 5);
});

test("official still visual repair preserves a publisher-policy live hold", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-official-stills-held-"));
  const { storyId, artifactDir } = await makePackage(root, "xbox-store-stills");
  const report = intakeReport(storyId);
  report.accepted_references = [
    {
      ...report.accepted_references[0],
      source_owner: "Microsoft",
      source_family: "xbox_store_blinx_gameplay",
      reference_page_url: "https://www.xbox.com/en-us/games/store/example/BRG51C5MWFSG",
      licence_basis: "microsoft_game_content_usage_rules_youtube_ad_program",
      allowed_use: "transformative_editorial_short_form",
      allowed_platforms: ["youtube"],
      restricted_platforms: ["tiktok", "instagram", "facebook", "x"],
      commercial_use_allowed: true,
      live_publish_allowed: false,
      requires_human_legal_review_before_publish: true,
      local_materialization_allowed: true,
      approval_status: "approved_for_local_materialization_only",
      rights_status: "conditional_youtube_ad_program_scope",
      risk_score: 0.45,
      required_rules_link: "https://www.xbox.com/en-us/developers/rules",
      durationS: 8,
    },
  ];

  const result = await repairGoalOfficialStillVisuals({
    root,
    intakeReport: report,
    storyIds: [storyId],
    generatedAt: "2026-07-22T22:00:00.000Z",
    minAssets: 1,
    maxDownloadsPerStory: 1,
    fetchImage: async () => ({
      buffer: Buffer.alloc(4096, 21),
      contentType: "image/jpeg",
    }),
  });

  assert.equal(result.summary.repaired_story_count, 1);
  const rights = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  assert.equal(rights.verdict, "warn");
  assert.equal(rights.result, "AMBER");
  assert.equal(rights.can_auto_publish, false);
  assert.ok(rights.publish_blockers.includes("rights:live_publish_not_allowed"));
  assert.ok(
    rights.publish_blockers.includes("rights:human_legal_review_required_before_publish"),
  );
  assert.deepEqual(rights.records[0].allowed_platforms, ["youtube"]);
  assert.equal(rights.records[0].live_publish_allowed, false);
  assert.equal(rights.records[0].requires_human_legal_review_before_publish, true);
  assert.equal(rights.records[0].approval_status, "approved_for_local_materialization_only");
  assert.equal(rights.records[0].rights_status, "conditional_youtube_ad_program_scope");
  assert.equal(rights.records[0].durationS, 8);
  assert.match(rights.records[0].evidence_sha256, /^[a-f0-9]{64}$/);
  assert.equal(fs.existsSync(rights.records[0].evidence_file), true);
});

test("official still rerun refreshes an equivalent sidecar binding without replacing materialised motion", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-official-stills-rebind-"));
  const { storyId, artifactDir } = await makePackage(root, "xbox-store-still-rebind");
  const report = intakeReport(storyId);
  report.accepted_references = [{
    ...report.accepted_references[0],
    source_owner: "Microsoft",
    source_family: "xbox_store_blinx_gameplay",
    source_url: "https://store-images.s-microsoft.com/image/apps/blinx.jpg",
    reference_page_url: "https://www.xbox.com/en-us/games/store/example/BRG51C5MWFSG",
    licence_basis: "microsoft_game_content_usage_rules_youtube_ad_program",
    allowed_use: "transformative_editorial_short_form",
    allowed_platforms: ["youtube"],
    restricted_platforms: ["tiktok", "instagram", "facebook", "x"],
    commercial_use_allowed: true,
    live_publish_allowed: false,
    requires_human_legal_review_before_publish: true,
    local_materialization_allowed: true,
    approval_status: "approved_for_local_materialization_only",
    rights_status: "conditional_youtube_ad_program_scope",
    risk_score: 0.45,
    required_rules_link: "https://www.xbox.com/en-us/developers/rules",
    durationS: 8,
  }];
  const fetchImage = async () => ({
    buffer: Buffer.alloc(4096, 61),
    contentType: "image/jpeg",
  });

  await repairGoalOfficialStillVisuals({
    root,
    intakeReport: report,
    storyIds: [storyId],
    generatedAt: "2026-07-23T01:00:00.000Z",
    minAssets: 1,
    maxDownloadsPerStory: 1,
    fetchImage,
  });
  const rightsPath = path.join(artifactDir, "rights_ledger.json");
  const firstRights = await fs.readJson(rightsPath);
  const firstEvidenceSha256 = firstRights.records[0].evidence_sha256;
  const motionPath = path.join(root, "output", "video_cache", `${storyId}-blinx.mp4`);
  const motionBytes = Buffer.alloc(8192, 62);
  const motionSha256 = crypto.createHash("sha256").update(motionBytes).digest("hex");
  await fs.outputFile(motionPath, motionBytes);
  const materialisedRecord = {
    ...firstRights.records[0],
    asset_type: "screenshot_derived_motion_clip",
    kind: "video",
    path: motionPath,
    asset_sha256: motionSha256,
    asset_size_bytes: motionBytes.length,
    materialized_file_evidence: {
      sha256: motionSha256,
      size_bytes: motionBytes.length,
      duration_seconds: 8,
      video_codec: "h264",
      width: 1080,
      height: 1920,
    },
  };
  await fs.writeJson(rightsPath, {
    ...firstRights,
    records: [materialisedRecord],
    rights_ledger: [materialisedRecord],
  }, { spaces: 2 });

  await repairGoalOfficialStillVisuals({
    root,
    intakeReport: report,
    storyIds: [storyId],
    generatedAt: "2026-07-23T02:00:00.000Z",
    minAssets: 1,
    maxDownloadsPerStory: 1,
    fetchImage,
  });

  const refreshedRights = await fs.readJson(rightsPath);
  const refreshedRecord = refreshedRights.records[0];
  const currentEvidenceBytes = await fs.readFile(refreshedRecord.evidence_file);
  const currentEvidenceSha256 = crypto
    .createHash("sha256")
    .update(currentEvidenceBytes)
    .digest("hex");
  assert.notEqual(currentEvidenceSha256, firstEvidenceSha256);
  assert.equal(refreshedRecord.evidence_sha256, currentEvidenceSha256);
  assert.equal(refreshedRecord.rights_evidence_sha256, currentEvidenceSha256);
  assert.equal(refreshedRecord.path, motionPath);
  assert.equal(refreshedRecord.asset_sha256, motionSha256);
  assert.equal(refreshedRecord.asset_size_bytes, motionBytes.length);
});

test("official still visual repair materialises one asset once when intake report sections repeat it", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-official-stills-deduped-"));
  const { storyId, artifactDir } = await makePackage(root, "deduped-official-still");
  const base = intakeReport(storyId).accepted_references[0];
  const intake = {
    accepted_references: [base],
    accepted_entries: [{
      ...base,
      official_source_url: base.source_url,
    }],
    provenance_ledger: [{ ...base }],
    entries: [{ ...base }],
  };
  let fetchCalls = 0;

  const result = await repairGoalOfficialStillVisuals({
    root,
    intakeReport: intake,
    storyIds: [storyId],
    generatedAt: "2026-07-23T01:00:00.000Z",
    minAssets: 1,
    maxDownloadsPerStory: 6,
    fetchImage: async () => {
      fetchCalls += 1;
      return {
        buffer: Buffer.alloc(4096, 31),
        contentType: "image/jpeg",
      };
    },
  });

  assert.equal(fetchCalls, 1);
  assert.equal(result.summary.applied_visual_asset_count, 1);
  const rights = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  assert.equal(rights.records.length, 1);
});

test("official still visual repair discovers current goal-contract package layout", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-official-stills-fresh-"));
  const { storyId, artifactDir } = await makeFreshGoalContractPackage(root);

  const report = await repairGoalOfficialStillVisuals({
    root,
    intakeReport: intakeReport(storyId),
    storyIds: [storyId],
    generatedAt: "2026-06-22T15:35:00.000Z",
    fetchImage: async () => ({
      buffer: Buffer.alloc(4096, 22),
      contentType: "image/jpeg",
    }),
  });

  assert.equal(report.summary.repaired_story_count, 1);
  assert.equal(report.jobs[0].artifact_dir, artifactDir);
  const rights = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  assert.equal(rights.records.length, 5);
});

test("official still visual repair targets an explicit isolated artifact directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-official-stills-explicit-"));
  const { storyId, artifactDir: standardArtifactDir } = await makePackage(root);
  const artifactDir = path.join(root, "test", "output", "cadence-recovery", storyId, "artifact");
  await fs.copy(standardArtifactDir, artifactDir);

  const report = await repairGoalOfficialStillVisuals({
    root,
    artifactDir,
    intakeReport: intakeReport(storyId),
    storyIds: [storyId],
    generatedAt: "2026-07-22T09:25:00.000Z",
    fetchImage: async () => ({
      buffer: Buffer.alloc(4096, 33),
      contentType: "image/jpeg",
    }),
  });

  assert.equal(report.summary.repaired_story_count, 1);
  assert.equal(report.jobs[0].artifact_dir, artifactDir);
  const rights = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  assert.equal(rights.records.length, 5);
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

test("official still visual repair rejects a stale expected source hash", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-official-stills-stale-"));
  const { storyId } = await makePackage(root, "stale-official-still");
  const report = intakeReport(storyId);
  report.accepted_references = [{
    ...report.accepted_references[0],
    source_asset_sha256: "0".repeat(64),
    source_asset_size_bytes: 4096,
  }];

  const result = await repairGoalOfficialStillVisuals({
    root,
    intakeReport: report,
    storyIds: [storyId],
    generatedAt: "2026-07-22T22:05:00.000Z",
    minAssets: 1,
    maxDownloadsPerStory: 1,
    fetchImage: async () => ({
      buffer: Buffer.alloc(4096, 99),
      contentType: "image/jpeg",
    }),
  });

  assert.equal(result.summary.repaired_story_count, 0);
  assert.equal(result.jobs[0].status, "blocked");
  assert.equal(result.jobs[0].rejected[0].reason, "official_still_source_hash_mismatch");
});

test("official still visual repair materialises a hash-bound local source capture without refetching mutable CDN bytes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-official-stills-local-evidence-"));
  const { storyId, artifactDir } = await makePackage(root, "xbox-local-source-capture");
  const sourcePath = path.join(root, "output", "cadence-recovery", "source", "blinx-gameplay-01.jpg");
  const sourceBytes = Buffer.alloc(4096, 42);
  await fs.ensureDir(path.dirname(sourcePath));
  await fs.writeFile(sourcePath, sourceBytes);

  const report = intakeReport(storyId);
  report.accepted_references = [{
    ...report.accepted_references[0],
    source_url: "https://store-images.s-microsoft.com/image/apps/blinx.jpg",
    local_source_path: path.relative(root, sourcePath),
    source_asset_sha256: crypto.createHash("sha256").update(sourceBytes).digest("hex"),
    source_asset_size_bytes: sourceBytes.length,
  }];

  let fetchCalls = 0;
  const result = await repairGoalOfficialStillVisuals({
    root,
    intakeReport: report,
    storyIds: [storyId],
    generatedAt: "2026-07-22T22:15:00.000Z",
    minAssets: 1,
    maxDownloadsPerStory: 1,
    fetchImage: async () => {
      fetchCalls += 1;
      return { buffer: Buffer.alloc(4096, 99), contentType: "image/jpeg" };
    },
  });

  assert.equal(fetchCalls, 0);
  assert.equal(result.summary.repaired_story_count, 1);
  const rights = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  assert.equal(rights.records[0].source_url, report.accepted_references[0].source_url);
  assert.equal(rights.records[0].source_evidence_path, sourcePath);
  assert.equal(
    crypto.createHash("sha256").update(await fs.readFile(rights.records[0].path)).digest("hex"),
    report.accepted_references[0].source_asset_sha256,
  );
});

test("official still visual repair CLI accepts intake report and story filters", () => {
  const args = parseArgs([
    "--intake-report",
    "official_source_intake_report.json",
    "--story-id",
    "story-a",
    "--story",
    "story-b",
    "--artifact-dir",
    "test/output/cadence-recovery/story-a/artifact",
    "--min-assets",
    "4",
    "--max-downloads-per-story",
    "6",
    "--json",
  ]);

  assert.equal(args.intakeReportPath, "official_source_intake_report.json");
  assert.deepEqual(args.storyIds, ["story-a", "story-b"]);
  assert.equal(args.artifactDir, "test/output/cadence-recovery/story-a/artifact");
  assert.equal(args.minAssets, 4);
  assert.equal(args.maxDownloadsPerStory, 6);
  assert.equal(args.json, true);
});
