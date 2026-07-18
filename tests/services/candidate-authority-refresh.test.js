"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const fs = require("fs-extra");

const {
  refreshCandidateAuthority,
} = require("../../lib/candidate-authority-refresh");
const {
  parseArgs,
  usage,
} = require("../../tools/candidate-authority-refresh");

const STORY_ID = "authority_refresh_story";

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function writeJson(filePath, value) {
  await fs.outputJson(filePath, value, { spaces: 2 });
}

async function createVerifiedFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-authority-refresh-"));
  const artifactDir = path.join(root, "artifact");
  const renderPath = path.join(artifactDir, "visual_v4_render.mp4");
  const audioPath = path.join(artifactDir, "flagship", "final_audio.mp3");
  const timestampPath = path.join(artifactDir, "flagship", "word_timestamps.json");
  const rightsPath = path.join(artifactDir, "rights_ledger.json");
  const assetPath = path.join(artifactDir, "motion", "clip.mp4");
  await fs.outputFile(renderPath, Buffer.from("decodable-render-evidence"));
  await fs.outputFile(audioPath, Buffer.from("narration-audio-evidence"));
  await fs.outputFile(timestampPath, JSON.stringify([{ word: "Pulse", start: 0, end: 0.3 }]));
  await fs.outputFile(assetPath, Buffer.from("rights-covered-motion"));

  const fingerprints = {
    render: sha256(await fs.readFile(renderPath)),
    audio: sha256(await fs.readFile(audioPath)),
    timestamps: sha256(await fs.readFile(timestampPath)),
  };
  const assetFingerprint = sha256(await fs.readFile(assetPath));

  await writeJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: STORY_ID,
    final_publish_render: true,
    quality_gate_status: "post_render_forensics_passed",
    output_path: renderPath,
    input_fingerprint: {
      audio_sha256: fingerprints.audio,
      word_timestamps_sha256: fingerprints.timestamps,
    },
  });
  await writeJson(path.join(artifactDir, "audio_manifest.json"), {
    story_id: STORY_ID,
    resolved_narration_audio_path: audioPath,
    resolved_word_timestamps_path: timestampPath,
    narration_audio_sha256: fingerprints.audio,
    word_timestamps_sha256: fingerprints.timestamps,
  });
  await writeJson(path.join(artifactDir, "narration_manifest.json"), {
    story_id: STORY_ID,
    verdict: "GREEN",
    status: "ready",
    audio_sha256: fingerprints.audio,
    blockers: [],
  });
  await writeJson(path.join(artifactDir, "caption_manifest.json"), {
    story_id: STORY_ID,
    verdict: "GREEN",
    status: "ready",
    word_timestamps_sha256: fingerprints.timestamps,
    blockers: [],
  });
  await writeJson(path.join(artifactDir, "decoded_forensic_report.json"), {
    story_id: STORY_ID,
    verdict: "GREEN",
    status: "GREEN",
    decoded: true,
    full_duration_decoded: true,
    publish_ready: true,
    can_auto_publish: true,
    final_media: {
      path: renderPath,
      sha256: `sha256:${fingerprints.render}`,
    },
    blockers: [],
  });
  const temporalQaPath = path.join(artifactDir, "temporal_video_qa_report.json");
  await writeJson(temporalQaPath, {
    schema_version: 1,
    story_id: STORY_ID,
    verdict: "GREEN",
    can_publish: true,
    blockers: [],
    warnings: [],
    final_media: {
      path: renderPath,
      sha256: fingerprints.render,
      size_bytes: (await fs.stat(renderPath)).size,
    },
    evidence: {
      decode: {
        complete: true,
        video_stream: true,
        audio_stream: true,
        },
        temporal: {
          analysis_scope: "full_frame",
          scan_complete: true,
          coverage_ratio: 1,
          sampled_frame_count: 300,
          repeated_motion_sequences: [],
          repeated_motion_seconds: 0,
          cadence: { choppy: false },
          supplemental_center_crop: {
            analysis_scope: "center_crop",
            scan_complete: true,
            coverage_ratio: 1,
            sampled_frame_count: 300,
            repeated_motion_sequences: [],
            repeated_motion_seconds: 0,
            cadence: { choppy: false },
          },
        },
      },
    source_result: {
      result: "pass",
      failures: [],
      warnings: [],
    },
  });
  await writeJson(path.join(artifactDir, "final_av_review.json"), {
    story_id: STORY_ID,
    verdict: "GREEN",
    final_verdict: "GREEN",
    status: "GREEN",
    publish_ready: true,
    can_auto_publish: true,
    reviewer: { id: "independent-reviewer", independent: true },
    signoff: "approved",
    reviewed_at: "2026-07-17T10:00:00.000Z",
    signed_at: "2026-07-17T10:05:00.000Z",
    reviewed_artefact_fingerprints: {
      final_mp4: `sha256:${fingerprints.render}`,
    },
    attestations: {
      full_watch: true,
      full_listen: true,
      av_sync: true,
      caption_readability: true,
      subject_match: true,
    },
    defects: [],
    blockers: [],
  });
  await writeJson(rightsPath, {
    story_id: STORY_ID,
    verdict: "GREEN",
    used_assets: [{
      asset_id: "clip",
      kind: "video",
      path: assetPath,
      asset_sha256: assetFingerprint,
      asset_size_bytes: (await fs.stat(assetPath)).size,
    }],
    records: [{
      asset_id: "clip",
      kind: "video",
      path: assetPath,
      asset_sha256: assetFingerprint,
      asset_size_bytes: (await fs.stat(assetPath)).size,
      source_url: "https://example.invalid/official/clip",
      source_type: "official_publisher_video",
      source_owner: "Example Studio",
      licence_basis: "official_promotional_editorial_use",
      allowed_use: "transformative_editorial_short_form",
      allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
      commercial_use_allowed: true,
      credit_required: false,
      approval_status: "approved_for_transformative_editorial_use",
      evidence_file: path.join(artifactDir, "render_manifest.json"),
    }],
    blockers: [],
  });

  const stale = {
    story_id: STORY_ID,
    verdict: "RED",
    can_auto_publish: false,
    blockers: ["render:final_publish_render_missing"],
    reason_codes: ["render:final_publish_render_missing"],
  };
  await writeJson(path.join(artifactDir, "goal_package_summary.json"), stale);
  await writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    ...stale,
    publish_status: "RED",
    outputs: { youtube_shorts: { title: "Keep this output" } },
  });
  await writeJson(path.join(artifactDir, "publish_verdict.json"), {
    ...stale,
    package_quality_gate: {
      verdict: "viral_ready",
      blockers: ["render:final_publish_render_missing"],
      warnings: ["stale_package_warning"],
    },
  });

  return {
    artifactDir,
    authorityPaths: [
      path.join(artifactDir, "goal_package_summary.json"),
      path.join(artifactDir, "platform_publish_manifest.json"),
      path.join(artifactDir, "publish_verdict.json"),
    ],
    criticalPaths: {
      renderPath,
      audioPath,
      timestampPath,
      rightsPath,
      temporalQaPath,
    },
  };
}

async function readBuffers(paths) {
  return Promise.all(paths.map((filePath) => fs.readFile(filePath)));
}

test("dry-run replaces stale blockers from independently verified GREEN evidence without changing files", async () => {
  const fixture = await createVerifiedFixture();
  const beforeAuthority = await readBuffers(fixture.authorityPaths);
  const report = await refreshCandidateAuthority({
    artifactDir: fixture.artifactDir,
    storyId: STORY_ID,
    probeMedia: async () => ({ decodable: true }),
  });
  const afterAuthority = await readBuffers(fixture.authorityPaths);

  assert.equal(report.mode, "DRY_RUN");
  assert.equal(report.applied, false);
  assert.equal(report.verdict, "GREEN");
  assert.equal(report.can_auto_publish, true);
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.frozen_hashes.before, report.frozen_hashes.after);
  assert.equal(report.proposed.goal_package_summary.verdict, "GREEN");
  assert.deepEqual(report.proposed.goal_package_summary.blockers, []);
  assert.equal(report.proposed.platform_publish_manifest.publish_status, "GREEN");
  assert.deepEqual(report.proposed.platform_publish_manifest.blockers, []);
  assert.equal(report.proposed.publish_verdict.verdict, "GREEN");
  assert.deepEqual(report.proposed.publish_verdict.reason_codes, []);
  assert.deepEqual(report.proposed.publish_verdict.package_quality_gate.blockers, []);
  assert.deepEqual(report.proposed.publish_verdict.package_quality_gate.warnings, []);
  assert.deepEqual(afterAuthority, beforeAuthority);
});

test("refresh removes stale blocker, warning and verdict aliases instead of merging them", async () => {
  const fixture = await createVerifiedFixture();
  for (const authorityPath of fixture.authorityPaths) {
    const document = await fs.readJson(authorityPath);
    await writeJson(authorityPath, {
      ...document,
      status: "RED",
      final_verdict: "RED",
      hard_blockers: ["legacy_stale_authority_signal"],
      failures: ["legacy_stale_authority_signal"],
      errors: ["legacy_stale_authority_signal"],
      rejection_reasons: ["legacy_stale_authority_signal"],
      advisories: ["legacy_stale_authority_signal"],
      ...(document.package_quality_gate
        ? {
            package_quality_gate: {
              ...document.package_quality_gate,
              status: "RED",
              hard_blockers: ["legacy_stale_authority_signal"],
              errors: ["legacy_stale_authority_signal"],
              advisories: ["legacy_stale_authority_signal"],
            },
          }
        : {}),
    });
  }

  const report = await refreshCandidateAuthority({
    artifactDir: fixture.artifactDir,
    storyId: STORY_ID,
    probeMedia: async () => ({ decodable: true }),
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(JSON.stringify(report.proposed).includes("legacy_stale_authority_signal"), false);
  for (const document of Object.values(report.proposed)) {
    assert.equal(document.status, "GREEN");
    assert.equal(document.final_verdict, "GREEN");
    assert.deepEqual(document.hard_blockers, []);
    assert.deepEqual(document.failures, []);
    assert.deepEqual(document.errors, []);
    assert.deepEqual(document.rejection_reasons, []);
    assert.deepEqual(document.advisories, []);
  }
  assert.equal(report.proposed.publish_verdict.package_quality_gate.status, "GREEN");
  assert.deepEqual(report.proposed.publish_verdict.package_quality_gate.hard_blockers, []);
  assert.deepEqual(report.proposed.publish_verdict.package_quality_gate.errors, []);
  assert.deepEqual(report.proposed.publish_verdict.package_quality_gate.advisories, []);
});

test("apply atomically replaces all three authority files, creates backups and preserves frozen hashes", async () => {
  const fixture = await createVerifiedFixture();
  const beforeAuthority = await readBuffers(fixture.authorityPaths);
  const report = await refreshCandidateAuthority({
    artifactDir: fixture.artifactDir,
    storyId: STORY_ID,
    apply: true,
    generatedAt: "2026-07-17T11:00:00.000Z",
    probeMedia: async () => ({ decodable: true }),
  });

  assert.equal(report.mode, "APPLY");
  assert.equal(report.applied, true);
  assert.equal(report.verdict, "GREEN");
  assert.equal(report.can_auto_publish, true);
  assert.equal(report.changed_files.length, 3);
  assert.equal(report.backups.length, 3);
  assert.deepEqual(report.frozen_hashes.before, report.frozen_hashes.after);
  assert.equal(report.frozen_hashes.preserved, true);

  for (const [index, authorityPath] of fixture.authorityPaths.entries()) {
    const document = await fs.readJson(authorityPath);
    assert.equal(document.verdict, "GREEN");
    assert.equal(document.can_auto_publish, true);
    assert.deepEqual(document.blockers, []);
    assert.deepEqual(document.reason_codes, []);
    assert.deepEqual(await fs.readFile(report.backups[index].backup_path), beforeAuthority[index]);
  }
  const directoryEntries = await fs.readdir(fixture.artifactDir);
  assert.equal(directoryEntries.some((entry) => entry.endsWith(".tmp")), false);
});

test("apply atomically refreshes an explicitly bound story-package aggregate", async () => {
  const fixture = await createVerifiedFixture();
  const aggregatePath = path.join(path.dirname(fixture.artifactDir), "story-packages.json");
  const untouchedRow = {
    story_id: "untouched_story",
    verdict: "AMBER",
    can_auto_publish: false,
  };
  await writeJson(aggregatePath, [
    {
      story_id: STORY_ID,
      artifact_dir: fixture.artifactDir,
      verdict: "RED",
      can_auto_publish: false,
      blockers: ["stale_aggregate_blocker"],
      publish_verdict: {
        verdict: "RED",
        can_auto_publish: false,
        blockers: ["stale_aggregate_blocker"],
      },
    },
    untouchedRow,
  ]);
  const aggregateBefore = await fs.readFile(aggregatePath);

  const dryRun = await refreshCandidateAuthority({
    artifactDir: fixture.artifactDir,
    storyId: STORY_ID,
    aggregatePaths: [aggregatePath],
    probeMedia: async () => ({ decodable: true }),
  });

  assert.equal(dryRun.verdict, "GREEN");
  assert.equal(dryRun.aggregate_updates.length, 1);
  assert.equal(dryRun.aggregate_updates[0].matched_count, 1);
  assert.equal(dryRun.aggregate_updates[0].proposed_story.verdict, "GREEN");
  assert.equal(dryRun.aggregate_updates[0].proposed_story.can_auto_publish, true);
  assert.deepEqual(
    dryRun.aggregate_updates[0].proposed_story.publish_verdict.blockers,
    [],
  );
  assert.deepEqual(await fs.readFile(aggregatePath), aggregateBefore);

  const report = await refreshCandidateAuthority({
    artifactDir: fixture.artifactDir,
    storyId: STORY_ID,
    aggregatePaths: [aggregatePath],
    apply: true,
    generatedAt: "2026-07-17T11:15:00.000Z",
    probeMedia: async () => ({ decodable: true }),
  });

  assert.equal(report.applied, true);
  assert.equal(report.changed_files.length, 4);
  assert.equal(report.backups.length, 4);
  const aggregate = await fs.readJson(aggregatePath);
  assert.equal(aggregate[0].verdict, "GREEN");
  assert.equal(aggregate[0].can_auto_publish, true);
  assert.deepEqual(aggregate[0].blockers, []);
  assert.equal(aggregate[0].publish_verdict.verdict, "GREEN");
  assert.equal(aggregate[0].publish_verdict.can_auto_publish, true);
  assert.deepEqual(aggregate[1], untouchedRow);
  const aggregateBackup = report.backups.find((entry) => entry.path === aggregatePath);
  assert.ok(aggregateBackup);
  assert.deepEqual(await fs.readFile(aggregateBackup.backup_path), aggregateBefore);
});

test("aggregate refresh propagates AMBER evidence and cannot leave stale GREEN publish authority", async () => {
  const fixture = await createVerifiedFixture();
  const aggregatePath = path.join(path.dirname(fixture.artifactDir), "story-packages.json");
  const narrationPath = path.join(fixture.artifactDir, "narration_manifest.json");
  const narration = await fs.readJson(narrationPath);
  await writeJson(narrationPath, {
    ...narration,
    warnings: ["voice_cadence_requires_review"],
  });
  await writeJson(aggregatePath, [{
    story_id: STORY_ID,
    artifact_dir: fixture.artifactDir,
    verdict: "GREEN",
    can_auto_publish: true,
    blockers: [],
    warnings: [],
    publish_verdict: {
      verdict: "GREEN",
      can_auto_publish: true,
      blockers: [],
      warnings: [],
    },
  }]);

  const report = await refreshCandidateAuthority({
    artifactDir: fixture.artifactDir,
    storyId: STORY_ID,
    aggregatePaths: [aggregatePath],
    apply: true,
    generatedAt: "2026-07-17T11:20:00.000Z",
    probeMedia: async () => ({ decodable: true }),
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.can_auto_publish, false);
  const aggregate = await fs.readJson(aggregatePath);
  assert.equal(aggregate[0].verdict, "AMBER");
  assert.equal(aggregate[0].can_auto_publish, false);
  assert.deepEqual(aggregate[0].warnings, ["narration:voice_cadence_requires_review"]);
  assert.equal(aggregate[0].publish_verdict.verdict, "AMBER");
  assert.equal(aggregate[0].publish_verdict.can_auto_publish, false);
});

test("apply rejects an ambiguous aggregate before changing any authority surface", async () => {
  const fixture = await createVerifiedFixture();
  const aggregatePath = path.join(path.dirname(fixture.artifactDir), "story-packages.json");
  await writeJson(aggregatePath, [
    { story_id: STORY_ID, verdict: "RED", can_auto_publish: false },
    { story_id: STORY_ID, verdict: "GREEN", can_auto_publish: true },
  ]);
  const authorityBefore = await readBuffers(fixture.authorityPaths);
  const aggregateBefore = await fs.readFile(aggregatePath);

  await assert.rejects(
    refreshCandidateAuthority({
      artifactDir: fixture.artifactDir,
      storyId: STORY_ID,
      aggregatePaths: [aggregatePath],
      apply: true,
      generatedAt: "2026-07-17T11:25:00.000Z",
      probeMedia: async () => ({ decodable: true }),
    }),
    (error) => {
      assert.equal(error.code, "AUTHORITY_AGGREGATE_INVALID");
      assert.match(error.message, /authority_aggregate_story_duplicate/);
      return true;
    },
  );

  assert.deepEqual(await readBuffers(fixture.authorityPaths), authorityBefore);
  assert.deepEqual(await fs.readFile(aggregatePath), aggregateBefore);
});

test("apply atomically creates a missing authority surface and backs up the existing surfaces", async () => {
  const fixture = await createVerifiedFixture();
  const missingPath = fixture.authorityPaths[0];
  const existingPaths = fixture.authorityPaths.slice(1);
  const existingBefore = await readBuffers(existingPaths);
  await fs.remove(missingPath);

  const report = await refreshCandidateAuthority({
    artifactDir: fixture.artifactDir,
    storyId: STORY_ID,
    apply: true,
    generatedAt: "2026-07-17T11:30:00.000Z",
    probeMedia: async () => ({ decodable: true }),
  });

  assert.equal(report.applied, true);
  assert.equal(report.verdict, "GREEN");
  assert.equal(report.changed_files.length, 3);
  assert.equal(report.backups.length, 2);
  assert.deepEqual(report.frozen_hashes.before, report.frozen_hashes.after);
  assert.equal(report.frozen_hashes.preserved, true);

  const created = await fs.readJson(missingPath);
  assert.equal(created.verdict, "GREEN");
  assert.equal(created.can_auto_publish, true);
  assert.equal(report.backups.some((entry) => entry.path === missingPath), false);
  for (const [index, existingPath] of existingPaths.entries()) {
    const backup = report.backups.find((entry) => entry.path === existingPath);
    assert.ok(backup);
    assert.deepEqual(await fs.readFile(backup.backup_path), existingBefore[index]);
  }
  const directoryEntries = await fs.readdir(fixture.artifactDir);
  assert.equal(directoryEntries.some((entry) => entry.endsWith(".tmp")), false);
});

test("a critical warning caps every authority surface at AMBER and disables auto-publish", async () => {
  const fixture = await createVerifiedFixture();
  const narrationPath = path.join(fixture.artifactDir, "narration_manifest.json");
  const narration = await fs.readJson(narrationPath);
  await writeJson(narrationPath, {
    ...narration,
    warnings: ["voice_cadence_requires_review"],
  });

  const report = await refreshCandidateAuthority({
    artifactDir: fixture.artifactDir,
    storyId: STORY_ID,
    probeMedia: async () => ({ decodable: true }),
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.can_auto_publish, false);
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.warnings, ["narration:voice_cadence_requires_review"]);
  for (const document of Object.values(report.proposed)) {
    const verdict = document.publish_status || document.verdict;
    assert.equal(verdict, "AMBER");
    assert.equal(document.can_auto_publish, false);
    assert.deepEqual(document.blockers, []);
    assert.deepEqual(document.reason_codes, ["narration:voice_cadence_requires_review"]);
  }
});

test("a critical AMBER verdict without warning text cannot be promoted to GREEN", async () => {
  const fixture = await createVerifiedFixture();
  const forensicPath = path.join(fixture.artifactDir, "decoded_forensic_report.json");
  const forensic = await fs.readJson(forensicPath);
  await writeJson(forensicPath, {
    ...forensic,
    verdict: "AMBER",
    status: "AMBER",
    warnings: [],
  });

  const report = await refreshCandidateAuthority({
    artifactDir: fixture.artifactDir,
    storyId: STORY_ID,
    probeMedia: async () => ({ decodable: true }),
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.can_auto_publish, false);
  assert.deepEqual(report.blockers, []);
  assert.ok(report.warnings.includes("decoded_forensic:critical_status_amber"));
  for (const document of Object.values(report.proposed)) {
    const verdict = document.publish_status || document.verdict;
    assert.equal(verdict, "AMBER");
    assert.equal(document.can_auto_publish, false);
  }
});

test("a bare rights PASS is RED and cannot satisfy any authority surface", async () => {
  const fixture = await createVerifiedFixture();
  await writeJson(fixture.criticalPaths.rightsPath, {
    story_id: STORY_ID,
    verdict: "PASS",
    blockers: [],
  });

  const report = await refreshCandidateAuthority({
    artifactDir: fixture.artifactDir,
    storyId: STORY_ID,
    probeMedia: async () => ({ decodable: true }),
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.can_auto_publish, false);
  assert.ok(report.blockers.includes("rights_used_asset_inventory_empty"));
  assert.ok(report.blockers.includes("rights_records_empty"));
  for (const document of Object.values(report.proposed)) {
    const verdict = document.publish_status || document.verdict;
    assert.equal(verdict, "RED");
    assert.equal(document.can_auto_publish, false);
    assert.deepEqual(document.blockers, report.blockers);
    assert.equal(document.blockers.includes("render:final_publish_render_missing"), false);
  }
});

test("a complete rights row with a non-approved verdict is RED", async () => {
  const fixture = await createVerifiedFixture();
  const rights = await fs.readJson(fixture.criticalPaths.rightsPath);
  rights.records[0].approval_status = "NOT_APPROVED";
  await writeJson(fixture.criticalPaths.rightsPath, rights);

  const report = await refreshCandidateAuthority({
    artifactDir: fixture.artifactDir,
    storyId: STORY_ID,
    probeMedia: async () => ({ decodable: true }),
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.can_auto_publish, false);
  assert.ok(report.blockers.includes("rights_record_approval_not_affirmative:clip"));
  for (const document of Object.values(report.proposed)) {
    assert.equal(document.can_auto_publish, false);
  }
});

test("a rights row with a missing evidence file is RED", async () => {
  const fixture = await createVerifiedFixture();
  const rights = await fs.readJson(fixture.criticalPaths.rightsPath);
  rights.records[0].evidence_file = path.join(fixture.artifactDir, "missing-rights-evidence.json");
  await writeJson(fixture.criticalPaths.rightsPath, rights);

  const report = await refreshCandidateAuthority({
    artifactDir: fixture.artifactDir,
    storyId: STORY_ID,
    probeMedia: async () => ({ decodable: true }),
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.can_auto_publish, false);
  assert.ok(report.blockers.includes("rights_record_evidence_unreadable:clip"));
});

test("an otherwise complete AMBER rights ledger caps authority at AMBER", async () => {
  const fixture = await createVerifiedFixture();
  const rights = await fs.readJson(fixture.criticalPaths.rightsPath);
  await writeJson(fixture.criticalPaths.rightsPath, {
    ...rights,
    verdict: "AMBER",
    warnings: [],
  });

  const report = await refreshCandidateAuthority({
    artifactDir: fixture.artifactDir,
    storyId: STORY_ID,
    probeMedia: async () => ({ decodable: true }),
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.can_auto_publish, false);
  assert.deepEqual(report.blockers, []);
  assert.ok(report.warnings.includes("rights:critical_status_amber"));
  assert.equal(report.rights.verdict, "AMBER");
  for (const document of Object.values(report.proposed)) {
    assert.equal(document.can_auto_publish, false);
  }
});

test("stale critical fingerprints force RED and replace unrelated legacy blockers", async () => {
  const fixture = await createVerifiedFixture();
  const audioManifestPath = path.join(fixture.artifactDir, "audio_manifest.json");
  const audioManifest = await fs.readJson(audioManifestPath);
  await writeJson(audioManifestPath, {
    ...audioManifest,
    narration_audio_sha256: "0".repeat(64),
  });

  const report = await refreshCandidateAuthority({
    artifactDir: fixture.artifactDir,
    storyId: STORY_ID,
    probeMedia: async () => ({ decodable: true }),
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.can_auto_publish, false);
  assert.ok(report.blockers.includes("audio_manifest_audio_hash_mismatch"));
  assert.equal(report.blockers.includes("render:final_publish_render_missing"), false);
  assert.deepEqual(
    report.proposed.publish_verdict.reason_codes,
    report.blockers,
  );
});

test("stale caption timestamp evidence forces RED", async () => {
  const fixture = await createVerifiedFixture();
  const captionPath = path.join(fixture.artifactDir, "caption_manifest.json");
  const caption = await fs.readJson(captionPath);
  await writeJson(captionPath, {
    ...caption,
    word_timestamps_sha256: "0".repeat(64),
  });

  const report = await refreshCandidateAuthority({
    artifactDir: fixture.artifactDir,
    storyId: STORY_ID,
    probeMedia: async () => ({ decodable: true }),
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.can_auto_publish, false);
  assert.ok(report.blockers.includes("caption_timestamps_hash_mismatch"));
});

test("missing temporal video QA evidence forces every authority surface RED", async () => {
  const fixture = await createVerifiedFixture();
  await fs.remove(fixture.criticalPaths.temporalQaPath);

  const report = await refreshCandidateAuthority({
    artifactDir: fixture.artifactDir,
    storyId: STORY_ID,
    probeMedia: async () => ({ decodable: true }),
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.can_auto_publish, false);
  assert.ok(report.blockers.includes("temporal_video_qa_report_missing"));
  assert.equal(report.proposed.publish_verdict.verdict, "RED");
  assert.equal(report.proposed.platform_publish_manifest.can_auto_publish, false);
});

test("temporal video QA bound to a stale render hash forces authority RED", async () => {
  const fixture = await createVerifiedFixture();
  const temporal = await fs.readJson(fixture.criticalPaths.temporalQaPath);
  await writeJson(fixture.criticalPaths.temporalQaPath, {
    ...temporal,
    final_media: {
      ...temporal.final_media,
      sha256: "f".repeat(64),
    },
  });

  const report = await refreshCandidateAuthority({
    artifactDir: fixture.artifactDir,
    storyId: STORY_ID,
    probeMedia: async () => ({ decodable: true }),
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.can_auto_publish, false);
  assert.ok(report.blockers.includes("temporal_video_qa_render_hash_mismatch"));
});

test("post-render captions verify the frozen timestamp file named by the caption manifest", async () => {
  const fixture = await createVerifiedFixture();
  const frozenTimestampPath = path.join(
    fixture.artifactDir,
    "flagship",
    "generation_word_timestamps.json",
  );
  await writeJson(frozenTimestampPath, {
    words: [{ word: "Pulse", start: 0, end: 0.3 }],
    generation_run_id: "flagship-run",
  });
  const frozenTimestampSha256 = sha256(await fs.readFile(frozenTimestampPath));
  const captionPath = path.join(fixture.artifactDir, "caption_manifest.json");
  const caption = await fs.readJson(captionPath);
  delete caption.word_timestamps_sha256;
  await writeJson(captionPath, {
    ...caption,
    schema_version: 2,
    producer_id: "pulse-gaming-post-render-narration-qa",
    word_timestamps_path: "flagship/generation_word_timestamps.json",
    lineage: {
      source_word_timestamps_sha256: sha256(
        await fs.readFile(fixture.criticalPaths.timestampPath),
      ),
      frozen_word_timestamps_sha256: frozenTimestampSha256,
    },
  });

  const report = await refreshCandidateAuthority({
    artifactDir: fixture.artifactDir,
    storyId: STORY_ID,
    probeMedia: async () => ({ decodable: true }),
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.can_auto_publish, true);
  assert.deepEqual(report.blockers, []);
  assert.equal(
    report.frozen_hashes.before.caption_timestamps.sha256,
    frozenTimestampSha256,
  );
  assert.equal(
    report.critical_paths.caption_timestamps,
    frozenTimestampPath,
  );
});

test("critical evidence changing during dry-run forces every proposed authority surface RED", async () => {
  const fixture = await createVerifiedFixture();
  let changed = false;

  const report = await refreshCandidateAuthority({
    artifactDir: fixture.artifactDir,
    storyId: STORY_ID,
    probeMedia: async (_filePath, options = {}) => {
      if (!changed && options.kind === "render") {
        changed = true;
        await fs.appendFile(fixture.criticalPaths.audioPath, "-changed-during-refresh");
      }
      return { decodable: true };
    },
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.can_auto_publish, false);
  assert.equal(report.frozen_hashes.preserved, false);
  assert.ok(report.blockers.includes("critical_evidence_changed_during_refresh"));
  for (const document of Object.values(report.proposed)) {
    const verdict = document.publish_status || document.verdict;
    assert.equal(verdict, "RED");
    assert.equal(document.can_auto_publish, false);
    assert.ok(document.blockers.includes("critical_evidence_changed_during_refresh"));
  }
});

test("candidate authority refresh CLI defaults to dry-run and requires explicit apply", () => {
  const dryRun = parseArgs([
    "--artifact-dir", "output/story",
    "--story-id", "story",
    "--aggregate", "output/goal-contract/story-packages.json",
    "--aggregate=output/goal-contract/secondary-story-packages.json",
    "--json",
  ]);
  assert.equal(dryRun.apply, false);
  assert.equal(dryRun.json, true);
  assert.deepEqual(dryRun.aggregatePaths, [
    "output/goal-contract/story-packages.json",
    "output/goal-contract/secondary-story-packages.json",
  ]);

  const apply = parseArgs([
    "--artifact-dir=output/story",
    "--story-id=story",
    "--apply",
  ]);
  assert.equal(apply.apply, true);
  assert.match(usage(), /default.*dry-run/i);
  assert.match(usage(), /never publishes/i);
  assert.match(usage(), /never mutates the database/i);
  assert.match(usage(), /OAuth/i);
  assert.throws(() => parseArgs(["--unknown"]), /unknown argument/i);
});

test("hash-matching but undecodable audio and malformed timestamps remain RED", async () => {
  const fixture = await createVerifiedFixture();
  await fs.writeFile(fixture.criticalPaths.audioPath, Buffer.from("not-audio"));
  await fs.writeFile(fixture.criticalPaths.timestampPath, "{not-json");
  const audioSha = sha256(await fs.readFile(fixture.criticalPaths.audioPath));
  const timestampSha = sha256(await fs.readFile(fixture.criticalPaths.timestampPath));

  const audioManifestPath = path.join(fixture.artifactDir, "audio_manifest.json");
  const audioManifest = await fs.readJson(audioManifestPath);
  await writeJson(audioManifestPath, {
    ...audioManifest,
    narration_audio_sha256: audioSha,
    word_timestamps_sha256: timestampSha,
  });
  const narrationPath = path.join(fixture.artifactDir, "narration_manifest.json");
  const narration = await fs.readJson(narrationPath);
  await writeJson(narrationPath, { ...narration, audio_sha256: audioSha });
  const renderManifestPath = path.join(fixture.artifactDir, "render_manifest.json");
  const renderManifest = await fs.readJson(renderManifestPath);
  await writeJson(renderManifestPath, {
    ...renderManifest,
    input_fingerprint: {
      ...renderManifest.input_fingerprint,
      audio_sha256: audioSha,
      word_timestamps_sha256: timestampSha,
    },
  });

  const report = await refreshCandidateAuthority({
    artifactDir: fixture.artifactDir,
    storyId: STORY_ID,
    probeMedia: async (_filePath, options = {}) => ({
      decodable: options.kind !== "audio",
    }),
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.can_auto_publish, false);
  assert.ok(report.blockers.includes("audio_file_not_decodable"));
  assert.ok(report.blockers.includes("timestamps_file_unreadable"));
});

test("semantically unreadable critical evidence returns RED instead of crashing", async () => {
  const fixture = await createVerifiedFixture();
  await writeJson(path.join(fixture.artifactDir, "render_manifest.json"), null);

  const report = await refreshCandidateAuthority({
    artifactDir: fixture.artifactDir,
    storyId: STORY_ID,
    probeMedia: async () => ({ decodable: true }),
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.can_auto_publish, false);
  assert.ok(report.blockers.includes("render_manifest_unreadable"));
  for (const document of Object.values(report.proposed)) {
    assert.equal(document.verdict, "RED");
    assert.equal(document.can_auto_publish, false);
  }
});
