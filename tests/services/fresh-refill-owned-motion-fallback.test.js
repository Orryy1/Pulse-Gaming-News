"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  evaluateFreshRefillOwnedMotionFallbackEvidence,
} = require("../../lib/ops/fresh-refill-owned-motion-fallback");
const {
  materializeOwnedMotionRightsEvidence,
} = require("../../lib/owned-motion-rights-evidence");

const ENABLED_PLATFORMS = [
  "youtube_shorts",
  "instagram_reels",
  "facebook_reels",
];
const ALL_PLATFORMS = [
  ...ENABLED_PLATFORMS,
  "tiktok",
  "x",
  "threads",
  "pinterest",
];

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function writeOwnedProject({
  root,
  artifactDir,
  projectId,
  masterByte,
  visualByte,
  storyId,
}) {
  const clipPath = path.join(root, `${projectId}.mp4`);
  const bytes = Buffer.from(`motion:${projectId}`);
  await fs.writeFile(clipPath, bytes);
  const rights = await materializeOwnedMotionRightsEvidence({
    asset_id: `${storyId}:${projectId}`,
    asset_kind: "procedural_clip",
    asset_path: clipPath,
    evidence_path: `${clipPath}.rights.json`,
    ownership_basis: "wholly_owned_generated_asset",
    licence_basis: "owned_generated_editorial_motion_graphic",
    allowed_use: "finished_editorial_video_only",
    rights_grant: true,
    commercial_use_allowed: true,
    allowed_platforms: ALL_PLATFORMS,
    source_owner: "Pulse Gaming",
    source_type: "internally_generated_procedural_motion",
    source_url: `local://pulse-owned/${projectId}`,
    provenance: {
      origin: "pulse_gaming_internal_generation",
      generator_name: "goal_owned_motion_materializer",
      generator_version: "1",
      generated_at: "2026-07-17T05:00:00.000Z",
      creation_method: "procedural_generation",
      third_party_inputs: false,
      third_party_sources: [],
    },
  });
  return {
    asset: {
      asset_id: `${storyId}:${projectId}`,
      id: `${storyId}:${projectId}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `local://pulse-owned/${projectId}`,
      source_type: "internally_generated_motion_graphic",
      source_kind: "owned_explainer_motion_surface",
      media_kind: "owned_explainer_motion",
      generator_design_role: "primary_procedural_motion",
      generator_project_id: `pulse.motion.${projectId}.v1`,
      generator_master_sha256: masterByte.repeat(64),
      sampled_visual_fingerprint: `sha256:${visualByte.repeat(64)}`,
      generator_design_grammar: `${projectId} independent grammar`,
      materialised_output_sha256: sha256(bytes),
      materialised_output_size_bytes: bytes.length,
      allowed_platforms: ALL_PLATFORMS,
      counts_towards_motion_readiness: true,
    },
    record: rights.record,
  };
}

async function buildFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-fallback-"));
  t.after(() => fs.remove(root));
  const storyId = "fresh-owned-story";
  const artifactDir = path.join(root, "artifact");
  await fs.ensureDir(artifactDir);
  const projects = await Promise.all([
    writeOwnedProject({
      root,
      artifactDir,
      projectId: "kinetic-aperture",
      masterByte: "a",
      visualByte: "1",
      storyId,
    }),
    writeOwnedProject({
      root,
      artifactDir,
      projectId: "signal-lattice",
      masterByte: "b",
      visualByte: "2",
      storyId,
    }),
    writeOwnedProject({
      root,
      artifactDir,
      projectId: "data-ribbons",
      masterByte: "c",
      visualByte: "3",
      storyId,
    }),
  ]);
  const assets = projects.map((project) => project.asset);
  await fs.writeJson(path.join(artifactDir, "owned_motion_manifest.json"), {
    status: "ready",
    assets,
    rejection_reasons: [],
  });
  await fs.writeJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips: assets,
    materialised_clips: assets,
    clip_count: assets.length,
    distinct_motion_family_count: assets.length,
    rejection_reasons: [],
  });
  await fs.writeJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: projects.map((project) => project.record),
  });
  const reportPath = path.join(root, "owned_motion_materialization_report.json");
  await fs.writeJson(reportPath, {
    status: "completed",
    stories: [
      {
        story_id: storyId,
        artifact_dir: artifactDir,
        status: "materialized",
        blockers: [],
        rejection_reasons: [],
      },
    ],
  });
  return { root, storyId, artifactDir, reportPath };
}

test("owned-motion fallback accepts only current files, three distinct projects and strict rights", async (t) => {
  const fixture = await buildFixture(t);
  const result = await evaluateFreshRefillOwnedMotionFallbackEvidence({
    reportPath: fixture.reportPath,
    requiredPlatforms: ENABLED_PLATFORMS,
  });

  assert.equal(result.status, "ready");
  assert.deepEqual(result.ready_story_ids, [fixture.storyId]);
  assert.equal(result.blocked_story_ids.length, 0);
  assert.equal(result.stories[0].diversity.verdict, "GREEN");
  assert.equal(result.stories[0].rights.status, "pass");
  assert.equal(result.stories[0].strict_ready, true);
});

test("owned-motion fallback fails closed when a rights sidecar becomes stale", async (t) => {
  const fixture = await buildFixture(t);
  const rights = await fs.readJson(path.join(fixture.artifactDir, "rights_ledger.json"));
  await fs.appendFile(rights.records[0].evidence_file, " ");

  const result = await evaluateFreshRefillOwnedMotionFallbackEvidence({
    reportPath: fixture.reportPath,
    requiredPlatforms: ENABLED_PLATFORMS,
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.ready_story_ids, []);
  assert.deepEqual(result.blocked_story_ids, [fixture.storyId]);
  assert.ok(result.stories[0].blockers.includes("owned_motion_rights_evidence_invalid"));
});

test("owned-motion fallback rejects three clips that collapse to one generator project", async (t) => {
  const fixture = await buildFixture(t);
  const manifestPath = path.join(fixture.artifactDir, "owned_motion_manifest.json");
  const manifest = await fs.readJson(manifestPath);
  for (const asset of manifest.assets) {
    asset.generator_project_id = "pulse.motion.same-project.v1";
    asset.generator_master_sha256 = "a".repeat(64);
    asset.sampled_visual_fingerprint = `sha256:${"1".repeat(64)}`;
  }
  await fs.writeJson(manifestPath, manifest);

  const result = await evaluateFreshRefillOwnedMotionFallbackEvidence({
    reportPath: fixture.reportPath,
    requiredPlatforms: ENABLED_PLATFORMS,
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.stories[0].blockers.includes("owned_motion_procedural_diversity_invalid"));
  assert.ok(
    result.stories[0].diversity.blockers.includes(
      "owned_procedural_generator_project_minimum_not_met",
    ),
  );
});
