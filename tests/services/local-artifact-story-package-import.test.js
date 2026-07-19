"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const fs = require("fs-extra");

const {
  importLocalArtifactStoryPackage,
} = require("../../lib/local-artifact-story-package-import");
const {
  parseArgs,
} = require("../../tools/local-artifact-story-package-import");

test("dry-run imports verified artifact evidence as held until downstream authority passes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-local-artifact-import-"));
  const artifactDir = path.join(root, "artifact");
  const outPath = path.join(root, "proof", "story-packages.json");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "black_flag_v48",
    selected_title: "Black Flag Sold Three Million Copies",
  });

  const report = await importLocalArtifactStoryPackage({
    artifactDir,
    storyId: "black_flag_v48",
    outPath,
    inspectEvidence: async () => ({
      verdict: "GREEN",
      can_auto_publish: true,
      blockers: [],
      warnings: [],
      fingerprints: {
        render: {
          path: path.join(artifactDir, "visual_v4_render.mp4"),
          sha256: "a".repeat(64),
          size_bytes: 1_000_000,
        },
      },
    }),
  });

  assert.equal(report.mode, "DRY_RUN");
  assert.equal(report.applied, false);
  assert.equal(await fs.pathExists(outPath), false);
  assert.equal(report.story_packages.length, 1);
  assert.equal(report.story_packages[0].story_id, "black_flag_v48");
  assert.equal(report.story_packages[0].artifact_dir, path.resolve(artifactDir));
  assert.equal(report.story_packages[0].artifact_evidence.verdict, "GREEN");
  assert.equal(report.story_packages[0].verdict, "RED");
  assert.equal(report.story_packages[0].can_auto_publish, false);
  assert.deepEqual(report.story_packages[0].blockers, [
    "platform_native_authority_not_evaluated",
    "control_tower_authority_not_evaluated",
  ]);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);
  assert.equal(report.safety.no_oauth_or_token_change, true);
});

test("apply writes an isolated story-package array without promoting publish authority", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-local-artifact-apply-"));
  const artifactDir = path.join(root, "artifact");
  const outPath = path.join(root, "proof", "story-packages.json");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "black_flag_v48",
    selected_title: "Black Flag Sold Three Million Copies",
  });
  const inspection = {
    verdict: "RED",
    can_auto_publish: false,
    blockers: ["independent_final_av_review_pending"],
    warnings: [],
    fingerprints: {
      render: {
        path: path.join(artifactDir, "visual_v4_render.mp4"),
        sha256: "b".repeat(64),
        size_bytes: 2_000_000,
      },
    },
  };

  const report = await importLocalArtifactStoryPackage({
    artifactDir,
    storyId: "black_flag_v48",
    outPath,
    apply: true,
    inspectEvidence: async () => inspection,
  });

  assert.equal(report.mode, "APPLY");
  assert.equal(report.applied, true);
  const written = await fs.readJson(outPath);
  assert.equal(Array.isArray(written), true);
  assert.equal(written.length, 1);
  assert.equal(written[0].verdict, "RED");
  assert.equal(written[0].can_auto_publish, false);
  assert.ok(written[0].blockers.includes("independent_final_av_review_pending"));
  assert.ok(written[0].blockers.includes("platform_native_authority_not_evaluated"));
  assert.equal(report.safety.output_is_local_proof_only, true);
});

test("operator CLI defaults to no-write dry-run and requires an explicit apply flag", () => {
  const args = parseArgs([
    "--artifact-dir",
    "output/example/artifact",
    "--story-id",
    "example_story",
    "--out",
    "output/example/story-packages.json",
    "--json",
  ]);

  assert.equal(args.apply, false);
  assert.equal(args.artifactDir, "output/example/artifact");
  assert.equal(args.storyId, "example_story");
  assert.equal(args.outPath, "output/example/story-packages.json");
  assert.equal(args.json, true);
});

test("local artifact package import is registered as an operator command", async () => {
  const packageJson = await fs.readJson(path.join(__dirname, "..", "..", "package.json"));
  assert.equal(
    packageJson.scripts["ops:local-artifact-package-import"],
    "node tools/local-artifact-story-package-import.js",
  );
});
