"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const fs = require("fs-extra");

const {
  reconcileCandidateEvidence,
} = require("../../lib/candidate-evidence-reconciliation");

const TARGET_PLATFORMS = ["youtube_shorts", "instagram_reels", "facebook_reels"];

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalSnapshot(canonical = {}) {
  return {
    story_id: canonical.story_id || "",
    selected_title: canonical.selected_title || canonical.short_title || "",
    thumbnail_headline: canonical.thumbnail_headline || canonical.thumbnail_text || "",
    first_spoken_line: canonical.first_spoken_line || canonical.narration_hook || "",
    narration_script: canonical.narration_script || "",
    canonical_subject: canonical.canonical_subject || canonical.canonical_game || "",
    canonical_angle: canonical.canonical_angle || "",
    primary_source: canonical.primary_source || canonical.source_card_label || "",
    public_copy_repaired_at: canonical.public_copy_repaired_at || "",
    duration_variant_repaired_at: canonical.duration_variant_repaired_at || "",
  };
}

function renderInputFingerprint({ canonical, audio, timestamps, overrides = {} }) {
  const snapshot = canonicalSnapshot(canonical);
  const source = {
    canonical_snapshot: snapshot,
    audio_sha256: sha256(audio),
    word_timestamps_sha256: sha256(timestamps),
    audio_size_bytes: audio.length,
    word_timestamps_size_bytes: timestamps.length,
  };
  return {
    algorithm: "sha256",
    signature: sha256(Buffer.from(stableJson(source), "utf8")),
    canonical_public_copy_hash: sha256(Buffer.from(stableJson(snapshot), "utf8")),
    ...source,
    ...overrides,
  };
}

function completeRights(overrides = {}) {
  return {
    asset_id: "asset",
    path: "asset.mp4",
    source_url: "https://publisher.example/trailer",
    source_type: "official_publisher_trailer_segment",
    source_family: "publisher_trailer",
    source_owner: "Fixture Rights Owner",
    licence_basis: "transformative_editorial_short_form",
    commercial_use_allowed: true,
    allowed_platforms: [
      { platform_key: "youtube_short" },
      { name: "instagram_reel" },
      { platform: "facebook_reels" },
    ],
    evidence_file: "materialised_motion_clips.json",
    approval_status: "approved_for_transformative_editorial_use",
    rights_risk_class: "official_promotional_video_transformative_editorial_use",
    ...overrides,
  };
}

async function makeArtifactDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function makeFingerprintFixture({ prefix, storyId, canonicalStoryId = storyId, fingerprintOverrides = {} }) {
  const artifactDir = await makeArtifactDir(prefix);
  const audioPath = path.join(artifactDir, "audio", "narration.mp3");
  const timestampsPath = path.join(artifactDir, "audio", "word_timestamps.json");
  const finalVideoPath = path.join(artifactDir, "visual_v4_render.mp4");
  const bridgePath = path.join(artifactDir, "scheduler_bridge_candidates.json");
  const audio = Buffer.from(`governed narration for ${storyId}`);
  const timestamps = Buffer.from(JSON.stringify([{ word: "Governed", start: 0, end: 0.2 }]));
  const canonical = {
    story_id: canonicalStoryId,
    selected_title: "A Governed Candidate Title",
    thumbnail_headline: "GOVERNED CANDIDATE",
    first_spoken_line: "This is the governed opening line.",
    narration_script: "This is the governed opening line with current canonical copy.",
    canonical_subject: "Governed Game",
    canonical_angle: "confirmed_update",
    primary_source: "Official Publisher",
  };
  await fs.outputFile(audioPath, audio);
  await fs.outputFile(timestampsPath, timestamps);
  await fs.outputFile(finalVideoPath, "decodable media fixture");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), canonical);
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    story_id: storyId,
    resolved_narration_audio_path: audioPath,
    resolved_word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    output_path: finalVideoPath,
    input_fingerprint: renderInputFingerprint({
      canonical,
      audio,
      timestamps,
      overrides: fingerprintOverrides,
    }),
  });
  await fs.outputJson(path.join(artifactDir, "goal_package_summary.json"), {
    story_id: storyId,
    verdict: "GREEN",
    blockers: [],
  });
  await fs.outputJson(path.join(artifactDir, "publish_verdict.json"), {
    verdict: "GREEN",
    can_auto_publish: true,
    reason_codes: [],
  });
  const originalBridge = {
    scheduler_bridge_candidates: [{
      story_id: storyId,
      governance_publish_status: "GREEN",
      publish_verdict: { verdict: "GREEN", can_auto_publish: true },
      render_manifest: { input_fingerprint: { signature: "stale-bridge-signature" } },
    }],
  };
  await fs.outputJson(bridgePath, originalBridge);
  return { artifactDir, bridgePath, originalBridge };
}

async function addNarrationRightsFixture(fixture, storyId) {
  const audioManifest = await fs.readJson(path.join(fixture.artifactDir, "audio_manifest.json"));
  const audioPath = audioManifest.resolved_narration_audio_path;
  const rightsPath = path.join(fixture.artifactDir, "rights_ledger.json");
  await fs.outputJson(path.join(fixture.artifactDir, "narration_manifest.json"), {
    story_id: storyId,
    provider: "elevenlabs",
    resolved_audio_path: audioPath,
    status: "ready",
  });
  await fs.outputJson(path.join(fixture.artifactDir, "sfx_manifest.json"), {
    source_plan: { selected_assets: [] },
  });
  await fs.outputJson(rightsPath, [completeRights({
    asset_id: `${storyId}_narration`,
    path: audioPath,
    source_url: `elevenlabs://pulse-gaming/${storyId}`,
    source_type: "elevenlabs_generated_narration",
    licence_basis: "operator_licensed_elevenlabs_commercial_generation",
    evidence_file: "narration_manifest.json",
  })]);
  return { audioPath, rightsPath };
}

async function addFlagshipNarrationSidecarFixture(fixture, storyId) {
  const audioManifest = await fs.readJson(path.join(fixture.artifactDir, "audio_manifest.json"));
  const audioPath = audioManifest.resolved_narration_audio_path;
  const audioBytes = await fs.readFile(audioPath);
  const rightsPath = path.join(fixture.artifactDir, "rights_ledger.json");
  const evidenceRelativePath = "flagship/rights/narration.json";
  const evidencePath = path.join(fixture.artifactDir, evidenceRelativePath);
  const assetId = `${storyId}_audio_path`;
  const sourceUrl = `elevenlabs://pulse-gaming/${storyId}`;
  const creator = "Pulse Gaming via ElevenLabs";
  const licenceBasis = "elevenlabs_commercial_tts_generation";
  const initialRecord = completeRights({
    asset_id: assetId,
    path: audioPath,
    source_url: sourceUrl,
    source_type: "elevenlabs_generated_narration",
    source_owner: "Pulse Gaming",
    licence_basis: licenceBasis,
    allowed_platforms: TARGET_PLATFORMS,
    rights_verdict: "GREEN",
    evidence_file: "narration_manifest.json",
  });
  await fs.outputJson(path.join(fixture.artifactDir, "narration_manifest.json"), {
    story_id: storyId,
    provider: "elevenlabs",
    resolved_audio_path: audioPath,
    status: "ready",
  });
  await fs.outputJson(path.join(fixture.artifactDir, "sfx_manifest.json"), {
    source_plan: { selected_assets: [] },
  });
  await fs.outputJson(rightsPath, {
    schema_version: 1,
    verdict: "PASS",
    blockers: [],
    records: [initialRecord],
  });
  const initialLedgerBytes = await fs.readFile(rightsPath);
  const storedInitialLedger = await fs.readJson(rightsPath);
  await fs.outputJson(evidencePath, {
    schema_version: 1,
    asset_id: assetId,
    asset_sha256: sha256(audioBytes),
    source_url: sourceUrl,
    creator,
    licence_basis: licenceBasis,
    commercial_use_allowed: true,
    rights_verdict: "GREEN",
    allowed_platforms: TARGET_PLATFORMS,
    source_ledger_path: "rights_ledger.json",
    source_ledger_sha256: sha256(initialLedgerBytes),
    source_record_sha256: sha256(Buffer.from(stableJson(storedInitialLedger.records), "utf8")),
  });
  await fs.outputJson(path.join(fixture.artifactDir, "flagship", "inventory.json"), {
    schema_version: 1,
    story_id: storyId,
    used_assets: [{
      asset_id: assetId,
      kind: "narration",
      path: path.relative(fixture.artifactDir, audioPath),
      source_url: sourceUrl,
      creator,
      licence_basis: licenceBasis,
      commercial_use_allowed: true,
      rights_verdict: "GREEN",
      allowed_platforms: TARGET_PLATFORMS,
      evidence_file: evidenceRelativePath,
    }],
  });
  return {
    assetId,
    audioPath,
    evidencePath,
    initialLedgerBytes,
    rightsPath,
  };
}

async function captureFiles(paths) {
  return Promise.all(paths.map((filePath) => fs.readFile(filePath)));
}

function failNextRenameTo(t, targetPath) {
  const realRename = fs.rename.bind(fs);
  let failed = false;
  t.mock.method(fs, "rename", async (sourcePath, destinationPath, ...args) => {
    if (!failed && path.resolve(destinationPath) === path.resolve(targetPath)) {
      failed = true;
      const error = new Error(`Injected write failure for ${targetPath}`);
      error.code = "EIO";
      throw error;
    }
    return realRename(sourcePath, destinationPath, ...args);
  });
}

test("candidate evidence reconciliation rebuilds Black Flag rights from current used assets without duplicate or incomplete rows", async () => {
  const artifactDir = await makeArtifactDir("pulse-black-flag-rights-");
  const clipOne = path.join(artifactDir, "clip-01.mp4");
  const clipTwo = path.join(artifactDir, "clip-02.mp4");
  const sourceMasterOne = path.join(artifactDir, "official-master-01.mp4");
  const sourceCard = path.join(artifactDir, "hf_source_card_black_flag.mp4");
  const contextCard = path.join(artifactDir, "hf_context_card_black_flag.mp4");
  const contextCardSidecar = contextCard.replace(/\.mp4$/i, ".shell.json");
  const audioPath = path.join(artifactDir, "audio", "narration.mp3");
  const timestampsPath = path.join(artifactDir, "audio", "word_timestamps.json");
  const finalVideoPath = path.join(artifactDir, "visual_v4_render.mp4");
  const instagramVariantPath = path.join(artifactDir, "platform", "instagram-reels.mp4");
  const facebookVariantPath = path.join(artifactDir, "platform", "facebook-reels.mp4");
  const bridgePath = path.join(artifactDir, "scheduler_bridge_candidates.json");
  await fs.outputFile(clipOne, Buffer.from("official clip one"));
  await fs.outputFile(clipTwo, Buffer.from("official clip two"));
  await fs.outputFile(sourceMasterOne, Buffer.from("official source master one"));
  await fs.outputFile(sourceCard, Buffer.from("owned source card"));
  await fs.outputFile(contextCard, Buffer.from("owned context card"));
  await fs.outputJson(contextCardSidecar, {
    story_id: "official_black_flag_resynced_launch_20260710",
    card_kind: "context",
    output_path: contextCard,
    hyperframes_premium_shell: {
      status: "pass",
      checks: {
        lint: { status: "pass" },
        validate: { status: "pass" },
        inspect: { status: "pass" },
        render: { status: "pass" },
      },
      blockers: [],
    },
  });
  await fs.outputFile(audioPath, Buffer.from("current narration"));
  await fs.outputJson(timestampsPath, [{ word: "Black", start: 0, end: 0.2 }]);
  await fs.outputFile(finalVideoPath, Buffer.from("decodable final media fixture"));
  await fs.outputFile(instagramVariantPath, Buffer.from("instagram native variant"));
  await fs.outputFile(facebookVariantPath, Buffer.from("facebook native variant"));
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    clips: [
      {
        asset_id: "black_flag_clip_01",
        path: clipOne,
        source_url: sourceMasterOne,
        canonical_source_url: "https://www.youtube.com/watch?v=official-master-01",
        youtube_video_id: "official-master-01",
        source_master_sha256: sha256(Buffer.from("official source master one")),
        motion_source_identity: {
          status: "resolved",
          strict_pass: true,
          canonical_source_url: "https://www.youtube.com/watch?v=official-master-01",
          youtube_video_id: "official-master-01",
          source_master_sha256: sha256(Buffer.from("official source master one")),
        },
        source_type: "official_publisher_trailer_segment",
        source_family: "publisher_trailer",
        mediaStartS: 8,
      },
      {
        asset_id: "black_flag_clip_02",
        path: clipTwo,
        source_url: "https://publisher.example/trailer",
        source_type: "official_publisher_trailer_segment",
        source_family: "publisher_trailer",
        mediaStartS: 32,
      },
    ],
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "official_black_flag_resynced_launch_20260710",
    output_path: finalVideoPath,
    clip_scene_plan: {
      scenes: [
        { path: clipOne, sourceRootKey: "youtube:publisher" },
        { path: clipTwo, sourceRootKey: "youtube:publisher" },
        {
          path: sourceCard,
          sourceRootKey: "hyperframes/official_black_flag_resynced_launch_20260710/source",
          readableCardKind: "source",
          premiumCardV5: true,
        },
        {
          path: contextCard,
          sourceRootKey: "hyperframes/official_black_flag_resynced_launch_20260710/context",
          readableCardKind: "context",
          premiumCardV5: true,
        },
      ],
    },
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    provider: "elevenlabs",
    voice_provider: "existing",
    resolved_narration_audio_path: audioPath,
    resolved_word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "narration_manifest.json"), {
    story_id: "official_black_flag_resynced_launch_20260710",
    provider: "elevenlabs",
    resolved_audio_path: audioPath,
    resolved_word_timestamps_path: timestampsPath,
    status: "ready",
  });
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    source_plan: { selected_assets: [] },
  });
  const platformManifestPath = path.join(artifactDir, "platform_publish_manifest.json");
  await fs.outputJson(platformManifestPath, {
    publish_status: "GREEN",
    can_auto_publish: true,
    enabled_platforms: TARGET_PLATFORMS,
    outputs: {
      youtube_shorts: { title: "Black Flag Resynced Has A Day-One DLC Problem" },
      instagram_reels: {
        variant_video_path: instagramVariantPath,
        transformation_provenance: { encoder: "ffmpeg", profile: "instagram_reels" },
      },
      facebook_reels: {
        variant_video_path: facebookVariantPath,
        transformation_provenance: { encoder: "ffmpeg", profile: "facebook_reels" },
      },
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), [
    completeRights({
      asset_id: "black_flag_clip_01",
      id: "black_flag_clip_02",
      path: clipOne,
      local_materialized_path: clipTwo,
      mediaStartS: 32,
    }),
    completeRights({ asset_id: "black_flag_clip_01", path: clipOne }),
    completeRights({
      asset_id: "hyperframes_premium_shell_source_1",
      path: path.join(artifactDir, "stale", "hf_source_card_black_flag.mp4"),
      source_url: "local://hyperframes/official_black_flag_resynced_launch_20260710/source",
      source_type: "internally_generated_motion_graphic",
      source_family: "hyperframes_source_card",
      licence_basis: "owned_generated_editorial_motion_graphic",
      allowed_use: "owned_editorial_motion_graphic",
      approval_status: "approved_for_owned_editorial_use",
    }),
    {
      asset_id: "black_flag_clip_02",
      path: clipTwo,
      source_url: "https://publisher.example/trailer",
      source_type: "official_publisher_trailer_segment",
      source_family: "publisher_trailer",
    },
    completeRights({
      asset_id: "official_black_flag_resynced_launch_20260710_elevenlabs_narration",
      path: path.join(artifactDir, "stale", "narration.mp3"),
      source_url: "elevenlabs://pulse-gaming/official_black_flag_resynced_launch_20260710",
      source_type: "elevenlabs_generated_narration",
      licence_basis: "operator_licensed_elevenlabs_commercial_generation",
      evidence_file: "narration_manifest.json",
      approval_status: "approved",
    }),
    completeRights({
      asset_id: "platform-native-instagram_reels",
      kind: "platform_native",
      path: instagramVariantPath,
      source_url: "",
      source_type: "platform_native_render",
      source_family: "platform_native_instagram_reels",
      licence_basis: "derived_platform_variant_of_fully_rights_covered_final_render",
      evidence_file: platformManifestPath,
      approval_status: undefined,
    }),
  ]);
  await fs.outputJson(bridgePath, {
    scheduler_bridge_candidates: [{
      story_id: "official_black_flag_resynced_launch_20260710",
      status: "AMBER",
      publish_verdict: { verdict: "AMBER", can_auto_publish: false },
      rights_ledger: [{ asset_id: "stale_duplicate" }, { asset_id: "stale_duplicate" }],
    }],
  });

  const report = await reconcileCandidateEvidence({
    artifactDir,
    bridgePath,
    storyId: "official_black_flag_resynced_launch_20260710",
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: true,
    generatedAt: "2026-07-14T21:00:00.000Z",
    probeMedia: async () => ({ decodable: true, duration_seconds: 53.6 }),
    targetPlatforms: TARGET_PLATFORMS,
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.rights.verdict, "PASS");
  assert.equal(report.rights.used_asset_count, 7);
  assert.equal(report.rights.reconciled_record_count, 7);
  assert.equal(report.rights.duplicate_record_count_after, 0);
  assert.deepEqual(report.rights.blockers, []);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);

  const ledger = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  assert.equal(ledger.verdict, "pass");
  assert.equal(ledger.records.length, 7);
  assert.equal(ledger.used_assets.length, 7);
  assert.equal(new Set(ledger.used_assets.map((asset) => asset.asset_id)).size, 7);
  assert.equal(new Set(ledger.records.map((record) => record.asset_id)).size, 7);
  assert.equal(Object.hasOwn(ledger, "rights_ledger"), false);
  assert.equal(Object.hasOwn(ledger, "rights_records"), false);
  assert.equal(Object.hasOwn(ledger, "matched_assets"), false);
  assert.deepEqual(ledger.metrics, {
    used_asset_count: 7,
    rights_record_count: 7,
    missing_asset_count: 0,
    duplicate_record_count: 0,
  });
  assert.ok(ledger.records.every((record) => record.commercial_use_allowed === true));
  assert.ok(ledger.records.every((record) => TARGET_PLATFORMS.every((platform) => record.allowed_platforms.includes(platform))));
  assert.ok(ledger.records.every((record) => /^[a-f0-9]{64}$/.test(record.asset_sha256)));
  assert.ok(ledger.records.every((record) => record.asset_size_bytes > 0));
  assert.equal(
    ledger.records.find((record) => record.asset_id === "black_flag_clip_02").licence_basis,
    "transformative_editorial_short_form",
  );
  const clipOneRecord = ledger.records.find((record) => record.asset_id === "black_flag_clip_01");
  assert.equal(clipOneRecord.mediaStartS, 8);
  assert.equal(clipOneRecord.local_materialized_path, clipOne);
  assert.equal(clipOneRecord.source_url, "https://www.youtube.com/watch?v=official-master-01");
  assert.equal(clipOneRecord.local_source_master_path, sourceMasterOne);
  assert.equal(clipOneRecord.source_master_sha256, sha256(Buffer.from("official source master one")));
  assert.equal(clipOneRecord.youtube_video_id, "official-master-01");
  assert.equal(clipOneRecord.asset_sha256, sha256(Buffer.from("official clip one")));
  const narration = ledger.records.find((record) => record.kind === "narration");
  assert.equal(narration.path, audioPath);
  assert.equal(narration.asset_sha256, sha256(Buffer.from("current narration")));
  assert.equal(narration.evidence_file, path.join(artifactDir, "narration_manifest.json"));
  assert.equal(narration.source_owner, "Pulse Gaming");
  assert.equal(narration.provider_id, "elevenlabs");
  assert.equal(narration.source_type, "elevenlabs_tts_voice");
  assert.equal(narration.licence_basis, "elevenlabs_commercial_tts_generation");
  assert.equal(narration.source_url, "elevenlabs://pulse-gaming/official_black_flag_resynced_launch_20260710");
  assert.equal(narration.approval_status, "approved");
  assert.equal(narration.commercial_use_allowed, true);
  const generatedCard = ledger.records.find((record) => record.path === sourceCard);
  assert.equal(generatedCard.kind, "video");
  assert.equal(generatedCard.licence_basis, "owned_generated_editorial_motion_graphic");
  assert.equal(generatedCard.reconciliation_basis, "same_source_current_asset_record");
  assert.equal(generatedCard.source_owner, "Pulse Gaming");
  assert.equal(generatedCard.provider_id, "pulse_hyperframes");
  const generatedContextCard = ledger.records.find((record) => record.path === contextCard);
  assert.equal(generatedContextCard.kind, "video");
  assert.equal(generatedContextCard.licence_basis, "owned_generated_editorial_motion_graphic");
  assert.equal(generatedContextCard.reconciliation_basis, "current_owned_generated_card_sidecar");
  assert.equal(generatedContextCard.evidence_file, contextCardSidecar);
  assert.equal(generatedContextCard.source_owner, "Pulse Gaming");
  assert.equal(generatedContextCard.provider_id, "pulse_hyperframes");
  for (const [platform, variantPath] of [
    ["instagram_reels", instagramVariantPath],
    ["facebook_reels", facebookVariantPath],
  ]) {
    const variant = ledger.records.find((record) => record.asset_id === `platform-native-${platform}`);
    assert.equal(variant.path, variantPath);
    assert.equal(variant.kind, "platform_native");
    assert.equal(variant.derived_from, finalVideoPath);
    assert.equal(
      variant.source_url,
      `local://pulse-gaming/official_black_flag_resynced_launch_20260710/platform-native/${platform}`,
    );
    assert.equal(variant.source_owner, "Pulse Gaming");
    assert.equal(variant.provider_id, "pulse_gaming");
    assert.equal(variant.approval_status, "approved_for_platform_native_transcode");
    assert.deepEqual(variant.transformation_provenance, {
      encoder: "ffmpeg",
      profile: platform,
    });
    assert.equal(variant.evidence_file, platformManifestPath);
    assert.equal(variant.asset_sha256, sha256(await fs.readFile(variantPath)));
    assert.equal(variant.evidence_sha256, sha256(await fs.readFile(platformManifestPath)));
  }
  assert.match(report.rights.backup_path, /rights_ledger\.json\.pre_candidate_evidence_reconciliation/);
  assert.equal(await fs.pathExists(report.rights.backup_path), true);
  assert.equal(report.rights.bridge_rights_synced, true);
  assert.equal(await fs.pathExists(report.rights.bridge_backup_path), true);
  assert.match(
    report.rights.render_manifest_backup_path,
    /render_manifest\.json\.pre_candidate_evidence_reconciliation/,
  );
  assert.equal(await fs.pathExists(report.rights.render_manifest_backup_path), true);
  const appliedLedgerBuffer = await fs.readFile(path.join(artifactDir, "rights_ledger.json"));
  const reconciledRenderManifest = await fs.readJson(path.join(artifactDir, "render_manifest.json"));
  assert.deepEqual(reconciledRenderManifest.rights_reconciliation, {
    verdict: "PASS",
    status: "GREEN",
    rights_ledger_path: path.join(artifactDir, "rights_ledger.json"),
    bridge_rights_synced: true,
    applied: true,
    used_asset_count: 7,
    reconciled_record_count: 7,
    duplicate_record_count_after: 0,
    blockers: [],
    applied_ledger_verdict: "GREEN",
    applied_ledger_record_count: 7,
    applied_ledger_sha256: sha256(appliedLedgerBuffer),
    applied_ledger_size_bytes: appliedLedgerBuffer.length,
    can_auto_publish: true,
    generated_at: "2026-07-14T21:00:00.000Z",
    final_state_verified: true,
    final_state_verification_basis: "stored_rights_ledger_after_candidate_evidence_reconciliation",
  });
  const bridge = await fs.readJson(bridgePath);
  const bridgeCandidate = bridge.scheduler_bridge_candidates[0];
  assert.equal(bridgeCandidate.status, "AMBER");
  assert.deepEqual(bridgeCandidate.publish_verdict, { verdict: "AMBER", can_auto_publish: false });
  assert.equal(bridgeCandidate.rights_ledger.records.length, 7);
  assert.deepEqual(
    bridgeCandidate.render_manifest.rights_reconciliation,
    reconciledRenderManifest.rights_reconciliation,
  );
});

test("candidate evidence reconciliation recognises a verified HyperFrames timeline card as owned media", async () => {
  const storyId = "owned_timeline_card";
  const artifactDir = await makeArtifactDir("pulse-owned-timeline-card-");
  const timelineCard = path.join(artifactDir, `hf_timeline_card_${storyId}.mp4`);
  const timelineSidecar = timelineCard.replace(/\.mp4$/i, ".shell.json");
  const audioPath = path.join(artifactDir, "audio", "narration.mp3");
  const timestampsPath = path.join(artifactDir, "audio", "word_timestamps.json");
  const finalVideoPath = path.join(artifactDir, "visual_v4_render.mp4");
  const bridgePath = path.join(artifactDir, "scheduler_bridge_candidates.json");
  await fs.outputFile(timelineCard, Buffer.from("owned timeline card"));
  await fs.outputJson(timelineSidecar, {
    story_id: storyId,
    card_kind: "timeline",
    output_path: timelineCard,
    hyperframes_premium_shell: {
      status: "pass",
      checks: {
        lint: { status: "pass" },
        validate: { status: "pass" },
        inspect: { status: "pass" },
        render: { status: "pass" },
      },
      blockers: [],
    },
  });
  await fs.outputFile(audioPath, Buffer.from("current local narration"));
  await fs.outputJson(timestampsPath, [{ word: "Current", start: 0, end: 0.2 }]);
  await fs.outputFile(finalVideoPath, Buffer.from("decodable final media fixture"));
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    output_path: finalVideoPath,
    clip_scene_plan: {
      scenes: [{
        path: timelineCard,
        sourceRootKey: `hyperframes/${storyId}/timeline`,
        readableCardKind: "timeline",
        premiumCardV5: true,
      }],
    },
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    provider: "local_tts",
    resolved_narration_audio_path: audioPath,
    resolved_word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "narration_manifest.json"), {
    story_id: storyId,
    provider: "local_tts",
    resolved_audio_path: audioPath,
    resolved_word_timestamps_path: timestampsPath,
    status: "ready",
  });
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    source_plan: { selected_assets: [] },
  });
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    clips: [],
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), []);
  await fs.outputJson(bridgePath, {
    scheduler_bridge_candidates: [{
      story_id: storyId,
      status: "AMBER",
      publish_verdict: { verdict: "AMBER", can_auto_publish: false },
    }],
  });

  const report = await reconcileCandidateEvidence({
    artifactDir,
    bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    probeMedia: async () => ({ decodable: true, duration_seconds: 6.4 }),
    targetPlatforms: TARGET_PLATFORMS,
  });

  assert.equal(report.rights.verdict, "PASS");
  assert.deepEqual(report.rights.blockers, []);
  const timelineRecord = report.rights.proposed_ledger.records.find(
    (record) => record.path === timelineCard,
  );
  assert.equal(timelineRecord.reconciliation_basis, "current_owned_generated_card_sidecar");
  assert.equal(timelineRecord.evidence_file, timelineSidecar);
  assert.equal(timelineRecord.source_owner, "Pulse Gaming");
  assert.equal(timelineRecord.provider_id, "pulse_hyperframes");
  assert.equal(timelineRecord.licence_basis, "owned_generated_editorial_motion_graphic");
});

test("candidate evidence reconciliation recognises the current combined HyperFrames check contract", async () => {
  const storyId = "owned_modern_hyperframes_card";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-owned-modern-hyperframes-card-",
    storyId,
  });
  await addNarrationRightsFixture(fixture, storyId);
  const sourceCard = path.join(fixture.artifactDir, `hf_source_card_${storyId}.mp4`);
  const sidecarPath = sourceCard.replace(/\.mp4$/i, ".shell.json");
  await fs.outputFile(sourceCard, Buffer.from("owned modern HyperFrames source card"));
  await fs.outputJson(sidecarPath, {
    schema_version: 1,
    story_id: storyId,
    card_kind: "source",
    output_path: sourceCard,
    hyperframes_premium_shell: {
      status: "pass",
      story_id: storyId,
      card_kind: "source",
      output_path: sourceCard,
      checks: {
        check: { status: "pass" },
        render: { status: "pass" },
      },
      visual_identity: { status: "pass", blockers: [] },
      animation_contract: { status: "pass", blockers: [] },
      readability_contract: { status: "pass", blockers: [] },
      creative_identity_contract: { status: "pass", blockers: [] },
      blockers: [],
    },
  });
  const renderManifestPath = path.join(fixture.artifactDir, "render_manifest.json");
  const renderManifest = await fs.readJson(renderManifestPath);
  renderManifest.clip_scene_plan = {
    scenes: [{
      path: sourceCard,
      sourceRootKey: `hyperframes/${storyId}/source`,
      readableCardKind: "source",
      premiumCardV5: true,
    }],
  };
  await fs.writeJson(renderManifestPath, renderManifest, { spaces: 2 });

  const report = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: fixture.bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    probeMedia: async () => ({ decodable: true, duration_seconds: 6.4 }),
    targetPlatforms: TARGET_PLATFORMS,
  });

  assert.equal(report.rights.verdict, "PASS", JSON.stringify(report.rights, null, 2));
  const sourceRecord = report.rights.proposed_ledger.records.find(
    (record) => record.path === sourceCard,
  );
  assert.equal(sourceRecord.reconciliation_basis, "current_owned_generated_card_sidecar");
  assert.equal(sourceRecord.evidence_file, sidecarPath);
  assert.equal(sourceRecord.source_owner, "Pulse Gaming");
  assert.equal(sourceRecord.provider_id, "pulse_hyperframes");
});

test("candidate evidence reconciliation refuses to rebind an overwritten visual asset without a render-bound fingerprint", async () => {
  const storyId = "overwritten_hyperframes_card";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-overwritten-hyperframes-card-",
    storyId,
  });
  const { rightsPath } = await addNarrationRightsFixture(fixture, storyId);
  const sourceCard = path.join(fixture.artifactDir, `hf_source_card_${storyId}.mp4`);
  const sidecarPath = sourceCard.replace(/\.mp4$/i, ".shell.json");
  const originalBytes = Buffer.from("original HyperFrames source card used by the render");
  await fs.outputFile(sourceCard, originalBytes);
  await fs.outputJson(sidecarPath, {
    schema_version: 1,
    story_id: storyId,
    card_kind: "source",
    output_path: sourceCard,
    hyperframes_premium_shell: {
      status: "pass",
      story_id: storyId,
      card_kind: "source",
      output_path: sourceCard,
      checks: {
        check: { status: "pass" },
        render: { status: "pass" },
      },
      visual_identity: { status: "pass", blockers: [] },
      animation_contract: { status: "pass", blockers: [] },
      readability_contract: { status: "pass", blockers: [] },
      creative_identity_contract: { status: "pass", blockers: [] },
      blockers: [],
    },
  });
  const renderManifestPath = path.join(fixture.artifactDir, "render_manifest.json");
  const renderManifest = await fs.readJson(renderManifestPath);
  renderManifest.clip_scene_plan = {
    scenes: [{
      path: sourceCard,
      sourceRootKey: `hyperframes/${storyId}/source`,
      readableCardKind: "source",
      premiumCardV5: true,
    }],
  };
  await fs.writeJson(renderManifestPath, renderManifest, { spaces: 2 });
  const rights = await fs.readJson(rightsPath);
  rights.push(completeRights({
    asset_id: "hyperframes_premium_shell_source_1",
    path: sourceCard,
    source_url: `local://pulse-hyperframes/${storyId}/source`,
    source_type: "internally_generated_motion_graphic",
    source_family: "hyperframes_source_card",
    source_owner: "Pulse Gaming",
    provider_id: "pulse_hyperframes",
    licence_basis: "owned_generated_editorial_motion_graphic",
    allowed_use: "owned_editorial_motion_graphic",
    approval_status: "approved_for_owned_editorial_use",
    evidence_file: sidecarPath,
    asset_sha256: sha256(originalBytes),
    asset_size_bytes: originalBytes.length,
  }));
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  await fs.writeFile(sourceCard, Buffer.from("overwritten card bytes from a later render"));

  const report = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: fixture.bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
    targetPlatforms: TARGET_PLATFORMS,
  });

  assert.equal(report.verdict, "FAIL");
  assert.equal(report.rights.verdict, "FAIL");
  assert.equal(report.current_evidence.same_run_verified, false);
  assert.ok(
    report.rights.blockers.includes(
      "render_selected_asset_fingerprint_missing_or_mismatch:hyperframes_premium_shell_source_1",
    ),
  );
  assert.equal(
    report.rights.proposed_ledger.records.some(
      (record) => record.asset_id === "hyperframes_premium_shell_source_1",
    ),
    false,
  );

  const currentBytes = await fs.readFile(sourceCard);
  renderManifest.selected_input_assets = {
    schema_version: 1,
    authoritative: true,
    producer_id: "pulse-gaming-studio-v4-renderer",
    assets: [{
      asset_id: "hyperframes_premium_shell_source_1",
      kind: "video",
      path: sourceCard,
      asset_sha256: sha256(currentBytes),
      asset_size_bytes: currentBytes.length,
    }],
  };
  await fs.writeJson(renderManifestPath, renderManifest, { spaces: 2 });

  const renderBoundReport = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: fixture.bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
    targetPlatforms: TARGET_PLATFORMS,
  });

  assert.equal(
    renderBoundReport.rights.verdict,
    "PASS",
    JSON.stringify(renderBoundReport.rights, null, 2),
  );
  assert.equal(renderBoundReport.current_evidence.same_run_verified, true);
  const rebound = renderBoundReport.rights.proposed_ledger.records.find(
    (record) => record.asset_id === "hyperframes_premium_shell_source_1",
  );
  assert.equal(rebound.asset_sha256, sha256(currentBytes));
  assert.equal(rebound.asset_size_bytes, currentBytes.length);
});

test("candidate evidence reconciliation uses the authoritative renderer asset identity instead of a legacy scene id", async () => {
  const storyId = "authoritative_renderer_card_identity";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-authoritative-renderer-card-identity-",
    storyId,
  });
  const { rightsPath } = await addNarrationRightsFixture(fixture, storyId);
  const sourceCard = path.join(fixture.artifactDir, `hf_source_card_${storyId}.mp4`);
  const sidecarPath = sourceCard.replace(/\.mp4$/i, ".shell.json");
  const cardBytes = Buffer.from("current renderer-selected HyperFrames source card");
  await fs.outputFile(sourceCard, cardBytes);
  await fs.outputJson(sidecarPath, {
    schema_version: 1,
    story_id: storyId,
    card_kind: "source",
    output_path: sourceCard,
    hyperframes_premium_shell: {
      status: "pass",
      story_id: storyId,
      card_kind: "source",
      output_path: sourceCard,
      checks: {
        check: { status: "pass" },
        render: { status: "pass" },
      },
      visual_identity: { status: "pass", blockers: [] },
      animation_contract: { status: "pass", blockers: [] },
      readability_contract: { status: "pass", blockers: [] },
      creative_identity_contract: { status: "pass", blockers: [] },
      blockers: [],
    },
  });
  const renderManifestPath = path.join(fixture.artifactDir, "render_manifest.json");
  const renderManifest = await fs.readJson(renderManifestPath);
  renderManifest.clip_scene_plan = {
    scenes: [{
      path: sourceCard,
      sourceRootKey: `hyperframes/${storyId}/source`,
      readableCardKind: "source",
      premiumCardV5: true,
    }],
  };
  renderManifest.selected_input_assets = {
    schema_version: 2,
    authoritative: true,
    producer_id: "pulse-gaming-studio-v4-renderer",
    assets: [{
      asset_id: "hyperframes_premium_shell_source_1",
      kind: "generated_card",
      path: sourceCard,
      source_url: `local://hyperframes/${storyId}/source`,
      asset_sha256: sha256(cardBytes),
      asset_size_bytes: cardBytes.length,
    }],
  };
  await fs.writeJson(renderManifestPath, renderManifest, { spaces: 2 });
  const rights = await fs.readJson(rightsPath);
  rights.push(completeRights({
    asset_id: `${storyId}_video_04`,
    path: sourceCard,
    source_url: `local://pulse-hyperframes/${storyId}/source`,
    source_type: "internally_generated_motion_graphic",
    source_family: "hyperframes_source_card",
    source_owner: "Pulse Gaming",
    provider_id: "pulse_hyperframes",
    licence_basis: "owned_generated_editorial_motion_graphic",
    allowed_use: "owned_editorial_motion_graphic",
    approval_status: "approved_for_owned_editorial_use",
    evidence_file: sidecarPath,
    asset_sha256: sha256(cardBytes),
    asset_size_bytes: cardBytes.length,
  }));
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const report = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: fixture.bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
    targetPlatforms: TARGET_PLATFORMS,
  });

  assert.equal(report.rights.verdict, "PASS", JSON.stringify(report.rights, null, 2));
  assert.equal(
    report.rights.proposed_ledger.records.some(
      (record) => record.asset_id === `${storyId}_video_04`,
    ),
    false,
  );
  const card = report.rights.proposed_ledger.records.find(
    (record) => record.asset_id === "hyperframes_premium_shell_source_1",
  );
  assert.ok(card);
  assert.equal(card.path, sourceCard);
  assert.equal(card.asset_sha256, sha256(cardBytes));
});

test("candidate evidence reconciliation derives a missing creator from strict official-channel identity", async () => {
  const storyId = "strict_official_channel_creator";
  const artifactDir = await makeArtifactDir("pulse-strict-official-channel-creator-");
  const clipPath = path.join(artifactDir, "official-clip.mp4");
  const masterPath = path.join(artifactDir, "official-master.mp4");
  const finalVideoPath = path.join(artifactDir, "visual_v4_render.mp4");
  const bridgePath = path.join(artifactDir, "scheduler_bridge_candidates.json");
  await fs.outputFile(clipPath, Buffer.from("official clip"));
  await fs.outputFile(masterPath, Buffer.from("official master"));
  await fs.outputFile(finalVideoPath, Buffer.from("decodable final"));
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    output_path: finalVideoPath,
    clip_scene_plan: { scenes: [{ path: clipPath }] },
  });
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    clips: [{
      id: "official-clip",
      path: clipPath,
      source_url: "https://www.youtube.com/watch?v=official123",
      source_type: "official_trailer",
      source_family: "official_trailer_window",
      local_source_master_path: masterPath,
      source_master_sha256: sha256(await fs.readFile(masterPath)),
      motion_source_identity: {
        status: "resolved",
        strict_pass: true,
        canonical_source_url: "https://www.youtube.com/watch?v=official123",
        youtube_video_id: "official123",
        source_master_sha256: sha256(await fs.readFile(masterPath)),
        source_identity_provenance: {
          status: "resolved",
          channel_identity: {
            author_name: "Official Publisher",
            author_url: "https://www.youtube.com/@officialpublisher",
          },
        },
      },
    }],
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {});
  await fs.outputJson(path.join(artifactDir, "narration_manifest.json"), {});
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), { source_plan: { selected_assets: [] } });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), { outputs: {} });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), [completeRights({
    asset_id: "official-clip",
    path: clipPath,
    source_owner: "",
    creator: "",
  })]);
  await fs.outputJson(bridgePath, {
    scheduler_bridge_candidates: [{ story_id: storyId }],
  });

  const report = await reconcileCandidateEvidence({
    artifactDir,
    bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    generatedAt: "2026-07-15T14:05:00.000Z",
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
    targetPlatforms: TARGET_PLATFORMS,
  });

  assert.equal(report.rights.verdict, "PASS", JSON.stringify(report.rights, null, 2));
  assert.equal(report.rights.proposed_ledger.records[0].source_owner, "Official Publisher");
});

test("candidate evidence reconciliation rejects a material asset with no creator evidence", async () => {
  const storyId = "missing_material_asset_creator";
  const artifactDir = await makeArtifactDir("pulse-missing-material-creator-");
  const clipPath = path.join(artifactDir, "unverified-clip.mp4");
  const finalVideoPath = path.join(artifactDir, "visual_v4_render.mp4");
  const bridgePath = path.join(artifactDir, "scheduler_bridge_candidates.json");
  await fs.outputFile(clipPath, Buffer.from("unverified clip"));
  await fs.outputFile(finalVideoPath, Buffer.from("decodable final"));
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    output_path: finalVideoPath,
    clip_scene_plan: { scenes: [{ path: clipPath }] },
  });
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    clips: [{
      id: "unverified-clip",
      path: clipPath,
      source_url: "https://publisher.example/unverified",
      source_type: "official_trailer",
      source_family: "unverified_window",
    }],
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {});
  await fs.outputJson(path.join(artifactDir, "narration_manifest.json"), {});
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), { source_plan: { selected_assets: [] } });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), { outputs: {} });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), [completeRights({
    asset_id: "unverified-clip",
    path: clipPath,
    source_owner: "",
    creator: "",
  })]);
  await fs.outputJson(bridgePath, {
    scheduler_bridge_candidates: [{ story_id: storyId }],
  });

  const report = await reconcileCandidateEvidence({
    artifactDir,
    bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    generatedAt: "2026-07-15T14:06:00.000Z",
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
    targetPlatforms: TARGET_PLATFORMS,
  });

  assert.equal(report.rights.verdict, "FAIL");
  assert.ok(report.rights.blockers.includes("reconciled_rights_record_incomplete:unverified-clip"));
});

test("candidate evidence reconciliation treats existing as acquisition mode when a concrete audio provider corroborates provenance", async () => {
  const storyId = "existing_audio_with_elevenlabs_provenance";
  const artifactDir = await makeArtifactDir("pulse-existing-audio-provider-");
  const audioPath = path.join(artifactDir, "audio", "narration.mp3");
  const timestampsPath = path.join(artifactDir, "audio", "word_timestamps.json");
  const finalVideoPath = path.join(artifactDir, "visual_v4_render.mp4");
  const bridgePath = path.join(artifactDir, "scheduler_bridge_candidates.json");
  await fs.outputFile(audioPath, Buffer.from("governed ElevenLabs narration"));
  await fs.outputJson(timestampsPath, [{ word: "Governed", start: 0, end: 0.3 }]);
  await fs.outputFile(finalVideoPath, Buffer.from("decodable final"));
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    output_path: finalVideoPath,
    clip_scene_plan: { scenes: [] },
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    provider: "elevenlabs",
    voice_provider: "existing",
    resolved_narration_audio_path: audioPath,
    resolved_word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "narration_manifest.json"), {
    story_id: storyId,
    provider: "existing",
    voice_provider: "existing",
    resolved_audio_path: audioPath,
    resolved_word_timestamps_path: timestampsPath,
    status: "ready",
  });
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    source_plan: { selected_assets: [] },
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), { outputs: {} });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), []);
  await fs.outputJson(bridgePath, { scheduler_bridge_candidates: [{ story_id: storyId }] });

  const report = await reconcileCandidateEvidence({
    artifactDir,
    bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    generatedAt: "2026-07-15T14:15:00.000Z",
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
    targetPlatforms: TARGET_PLATFORMS,
  });

  assert.equal(report.rights.verdict, "PASS", JSON.stringify(report.rights, null, 2));
  assert.deepEqual(report.rights.blockers, []);
  const narration = report.rights.proposed_ledger.records.find((record) => record.kind === "narration");
  assert.equal(narration.provider_id, "elevenlabs");
  assert.equal(narration.source_type, "elevenlabs_tts_voice");
  assert.equal(narration.licence_basis, "elevenlabs_commercial_tts_generation");
});

test("candidate evidence reconciliation accepts a narration manifest mirror only when current bytes match", async () => {
  const storyId = "hash_identical_narration_mirror";
  const artifactDir = await makeArtifactDir("pulse-narration-mirror-");
  const audioPath = path.join(artifactDir, "audio", "narration.mp3");
  const mirrorPath = path.join(artifactDir, "flagship", "final_audio.mp3");
  const finalVideoPath = path.join(artifactDir, "visual_v4_render.mp4");
  const bridgePath = path.join(artifactDir, "scheduler_bridge_candidates.json");
  const audio = Buffer.from("same governed narration bytes");
  await fs.outputFile(audioPath, audio);
  await fs.outputFile(mirrorPath, audio);
  await fs.outputFile(finalVideoPath, Buffer.from("decodable final"));
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    output_path: finalVideoPath,
    clip_scene_plan: { scenes: [] },
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    story_id: storyId,
    provider: "elevenlabs",
    resolved_narration_audio_path: audioPath,
  });
  await fs.outputJson(path.join(artifactDir, "narration_manifest.json"), {
    story_id: storyId,
    provider: "elevenlabs",
    resolved_audio_path: mirrorPath,
    audio_sha256: sha256(audio),
    audio_size_bytes: audio.length,
    status: "ready",
  });
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), { source_plan: { selected_assets: [] } });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), { outputs: {} });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), []);
  await fs.outputJson(bridgePath, { scheduler_bridge_candidates: [{ story_id: storyId }] });

  const report = await reconcileCandidateEvidence({
    artifactDir,
    bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
    targetPlatforms: TARGET_PLATFORMS,
  });

  assert.equal(report.rights.verdict, "PASS", JSON.stringify(report.rights, null, 2));
  assert.deepEqual(report.rights.blockers, []);
  const narration = report.rights.proposed_ledger.records.find((record) => record.kind === "narration");
  assert.equal(narration.path, audioPath);
  assert.equal(narration.asset_sha256, sha256(audio));
  assert.equal(narration.narration_manifest_audio_mirror_path, mirrorPath);
  assert.equal(narration.narration_manifest_audio_mirror_verified, true);
});

test("candidate evidence reconciliation prefers an authoritative same-run flagship narration over stale package audio", async () => {
  const storyId = "authoritative_same_run_narration";
  const artifactDir = await makeArtifactDir("pulse-authoritative-narration-");
  const staleAudioPath = path.join(artifactDir, "audio", "narration.mp3");
  const flagshipAudioPath = path.join(artifactDir, "flagship", "final_audio.mp3");
  const finalVideoPath = path.join(artifactDir, "visual_v4_render.mp4");
  const bridgePath = path.join(artifactDir, "scheduler_bridge_candidates.json");
  const runId = `production-render:${storyId}:2026-07-15T14:20:00.000Z`;
  const flagshipAudio = Buffer.from("authoritative same-run narration");
  await fs.outputFile(staleAudioPath, Buffer.from("stale package narration"));
  await fs.outputFile(flagshipAudioPath, flagshipAudio);
  await fs.outputFile(finalVideoPath, Buffer.from("decodable final"));
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    output_path: finalVideoPath,
    input_fingerprint: {
      audio_sha256: sha256(flagshipAudio),
    },
    flagship_generation_evidence: {
      complete: true,
      verdict: "GREEN",
      run_id: runId,
    },
    clip_scene_plan: { scenes: [] },
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    story_id: storyId,
    provider: "elevenlabs",
    resolved_narration_audio_path: staleAudioPath,
    narration_audio_size_bytes: Buffer.byteLength("stale package narration"),
  });
  await fs.outputJson(path.join(artifactDir, "narration_manifest.json"), {
    story_id: storyId,
    producer_id: "pulse-gaming-post-render-narration-qa",
    provider: "elevenlabs",
    authoritative: true,
    verdict: "PASS",
    status: "ready",
    run_id: runId,
    resolved_audio_path: flagshipAudioPath,
    audio_sha256: sha256(flagshipAudio),
    lineage: {
      final_audio_sha256: sha256(flagshipAudio),
    },
  });
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    source_plan: { selected_assets: [] },
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), { outputs: {} });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), []);
  await fs.outputJson(path.join(artifactDir, "flagship", "inventory.json"), {
    story_id: storyId,
    used_assets: [],
  });
  await fs.outputJson(bridgePath, {
    scheduler_bridge_candidates: [{ story_id: storyId }],
  });

  const report = await reconcileCandidateEvidence({
    artifactDir,
    bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    generatedAt: "2026-07-15T14:21:00.000Z",
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
    targetPlatforms: TARGET_PLATFORMS,
  });

  assert.equal(report.rights.verdict, "PASS", JSON.stringify(report.rights, null, 2));
  assert.deepEqual(report.rights.blockers, []);
  const narration = report.rights.proposed_ledger.records.find((record) => record.kind === "narration");
  assert.equal(narration.path, flagshipAudioPath);
  assert.equal(narration.asset_sha256, sha256(flagshipAudio));
  assert.equal(narration.asset_size_bytes, flagshipAudio.length);
});

test("candidate evidence reconciliation rejects a narration mirror with different bytes", async () => {
  const storyId = "different_narration_mirror";
  const artifactDir = await makeArtifactDir("pulse-different-narration-mirror-");
  const audioPath = path.join(artifactDir, "audio", "narration.mp3");
  const mirrorPath = path.join(artifactDir, "flagship", "final_audio.mp3");
  const finalVideoPath = path.join(artifactDir, "visual_v4_render.mp4");
  const bridgePath = path.join(artifactDir, "scheduler_bridge_candidates.json");
  await fs.outputFile(audioPath, Buffer.from("current narration"));
  await fs.outputFile(mirrorPath, Buffer.from("stale narration"));
  await fs.outputFile(finalVideoPath, Buffer.from("decodable final"));
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    output_path: finalVideoPath,
    clip_scene_plan: { scenes: [] },
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    story_id: storyId,
    provider: "elevenlabs",
    resolved_narration_audio_path: audioPath,
  });
  await fs.outputJson(path.join(artifactDir, "narration_manifest.json"), {
    story_id: storyId,
    provider: "elevenlabs",
    resolved_audio_path: mirrorPath,
    status: "ready",
  });
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), { source_plan: { selected_assets: [] } });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), { outputs: {} });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), []);
  await fs.outputJson(bridgePath, { scheduler_bridge_candidates: [{ story_id: storyId }] });

  const report = await reconcileCandidateEvidence({
    artifactDir,
    bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
    targetPlatforms: TARGET_PLATFORMS,
  });

  assert.equal(report.rights.verdict, "FAIL");
  assert.ok(report.rights.blockers.includes("narration_manifest_audio_path_mismatch"));
});

test("candidate evidence reconciliation builds a current rights row only for a validated official materialised clip", async () => {
  const storyId = "validated_official_materialised_clip";
  const artifactDir = await makeArtifactDir("pulse-validated-official-motion-");
  const clipPath = path.join(artifactDir, "tokon-official.mp4");
  const finalVideoPath = path.join(artifactDir, "visual_v4_render.mp4");
  const clipUrl = "https://gmedia.playstation.com/is/content/SIEPDC/tokon-official.mp4";
  await fs.outputFile(clipPath, Buffer.from("current official Tokon motion"));
  await fs.outputFile(finalVideoPath, Buffer.from("decodable final"));
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "MARVEL Tokon",
    primary_source: "PlayStation Blog",
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    output_path: finalVideoPath,
    clip_scene_plan: { scenes: [{ path: clipPath }] },
  });
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    clips: [{
      id: "segment_direct_motion_1",
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: clipUrl,
      source_type: "official_game_site_news_page",
      source_family: "playstation_tokon_window_0_5",
      base_source_family: `url:${clipUrl.toLowerCase()}`,
      mediaStartS: 0,
      durationS: 5,
      rights_basis: "official_direct_media",
      materialized: true,
      validated: true,
      segmentValidationPassed: true,
      provenance: {
        source: "official_trailer_segment_validation",
        segment_validated: true,
        validation_reason: "official_storefront_cinematic_motion_samples_passed",
      },
    }],
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {});
  await fs.outputJson(path.join(artifactDir, "narration_manifest.json"), {});
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), { source_plan: { selected_assets: [] } });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), { outputs: {} });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), []);

  const report = await reconcileCandidateEvidence({
    artifactDir,
    bridgePath: "",
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
    targetPlatforms: TARGET_PLATFORMS,
  });

  assert.equal(report.rights.verdict, "PASS", JSON.stringify(report.rights, null, 2));
  assert.deepEqual(report.rights.blockers, []);
  const clip = report.rights.proposed_ledger.records[0];
  assert.equal(clip.asset_id, "segment_direct_motion_1");
  assert.equal(clip.source_owner, "PlayStation Blog");
  assert.equal(clip.source_url, clipUrl);
  assert.equal(clip.licence_basis, "official_direct_media");
  assert.equal(clip.approval_status, "approved_for_transformative_editorial_use");
  assert.equal(clip.reconciliation_basis, "current_validated_official_materialised_clip");
  assert.equal(clip.evidence_file, path.join(artifactDir, "materialised_motion_clips.json"));
});

test("candidate evidence reconciliation replaces only a provisional renderer row for hash-bound official YouTube motion with bundled identity evidence", async () => {
  const storyId = "verified_official_youtube_motion";
  const artifactDir = await makeArtifactDir("pulse-verified-official-youtube-motion-");
  const clipPath = path.join(artifactDir, "official-youtube-window.mp4");
  const sourceMasterPath = path.join(artifactDir, "official-youtube-master.mp4");
  const finalVideoPath = path.join(artifactDir, "visual_v4_render.mp4");
  const sourceUrl = "https://www.youtube.com/watch?v=OfficialVideo1";
  const sourceMasterBytes = Buffer.from("hash-bound official youtube master");
  await fs.outputFile(clipPath, Buffer.from("verified official youtube window"));
  await fs.outputFile(sourceMasterPath, sourceMasterBytes);
  await fs.outputFile(finalVideoPath, Buffer.from("decodable final"));
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Verified Game",
    primary_source: "Official Publisher",
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    output_path: finalVideoPath,
    clip_scene_plan: { scenes: [{ path: clipPath }] },
  });
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    clips: [{
      id: "official-youtube-window",
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: sourceUrl,
      source_type: "official_youtube_channel",
      source_owner: "Official Publisher",
      source_family: "official_youtube_window_12_4",
      rights_basis: "official_publisher_promotional_editorial_use",
      materialized: true,
      validated: true,
      segmentValidationPassed: true,
      provenance: {
        source: "flagship_motion_plan_materializer",
        segment_validated: true,
        validation_reason: "hash_bound_official_source_and_decoded_visual_qa_passed",
      },
      source_master_path: sourceMasterPath,
      source_master_sha256: sha256(sourceMasterBytes),
      motion_source_identity: {
        status: "resolved",
        strict_pass: true,
        canonical_source_url: sourceUrl,
        youtube_video_id: "OfficialVideo1",
        source_master_sha256: sha256(sourceMasterBytes),
        source_identity_provenance: {
          schema_version: 1,
          kind: "source_identity_evidence_bundle",
          status: "resolved",
          sources: [{
            schema_version: 1,
            kind: "pulse_source_identity_sidecar",
            status: "resolved",
            canonical_source_url: sourceUrl,
            youtube_video_id: "OfficialVideo1",
            source_master_sha256: sha256(sourceMasterBytes),
            channel_identity: {
              author_name: "Official Publisher",
              author_url: "https://www.youtube.com/@officialpublisher",
            },
          }],
        },
        blockers: [],
      },
    }],
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {});
  await fs.outputJson(path.join(artifactDir, "narration_manifest.json"), {});
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), { source_plan: { selected_assets: [] } });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), { outputs: {} });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "RED",
    records: [{
      asset_id: "official-youtube-window",
      path: clipPath,
      source_url: sourceUrl,
      source_type: "official_youtube_channel",
      licence_basis: "official_publisher_promotional_editorial_use",
      commercial_use_allowed: false,
      allowed_platforms: [],
      approval_status: "operator_legal_review_required",
      rights_status: "operator_legal_review_required",
      usage_scope: "declared_licensed_scope",
      rights_verdict: "RED",
      status: "RED",
      rights_grant: false,
      risk_score: 1,
      evidence_file: "final_clip_scene_plan",
      rights_decision_basis:
        "provisional_renderer_local_proof_pending_policy_reconciliation",
    }],
  });

  const report = await reconcileCandidateEvidence({
    artifactDir,
    bridgePath: "",
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
    targetPlatforms: TARGET_PLATFORMS,
  });

  assert.equal(report.rights.verdict, "PASS", JSON.stringify(report.rights, null, 2));
  assert.deepEqual(report.rights.blockers, []);
  const clip = report.rights.proposed_ledger.records[0];
  assert.equal(clip.asset_id, "official-youtube-window");
  assert.equal(clip.source_url, sourceUrl);
  assert.equal(clip.youtube_video_id, "OfficialVideo1");
  assert.equal(clip.source_master_sha256, sha256(sourceMasterBytes));
  assert.equal(clip.approval_status, "approved_for_transformative_editorial_use");
  assert.equal(clip.commercial_use_allowed, true);
  assert.equal(clip.rights_verdict, "GREEN");
  assert.notEqual(String(clip.status || "").toUpperCase(), "RED");
  assert.equal(clip.reconciliation_basis, "current_validated_official_materialised_clip");
  assert.equal(
    clip.rights_decision_basis,
    "validated_official_direct_media_editorial_policy",
  );
});

test("candidate evidence reconciliation accepts a hash-bound official publisher clip backed by a captured video policy", async () => {
  const storyId = "publisher_policy_official_youtube_motion";
  const artifactDir = await makeArtifactDir("pulse-publisher-policy-youtube-motion-");
  const clipPath = path.join(artifactDir, "publisher-gameplay-window.mp4");
  const sourceMasterPath = path.join(artifactDir, "publisher-gameplay-master.mp4");
  const identityPath = path.join(artifactDir, "publisher-gameplay.source-identity.json");
  const policyPath = path.join(artifactDir, "publisher-video-policy.html");
  const finalVideoPath = path.join(artifactDir, "visual_v4_render.mp4");
  const sourceUrl = "https://www.youtube.com/watch?v=PublisherGameplay1";
  const sourceMasterBytes = Buffer.from("hash-bound publisher gameplay master");
  const clipBytes = Buffer.from("validated publisher gameplay window");
  await fs.outputFile(clipPath, clipBytes);
  await fs.outputFile(sourceMasterPath, sourceMasterBytes);
  await fs.outputFile(policyPath, "<html>Commercial editorial video policy snapshot</html>");
  await fs.outputFile(finalVideoPath, Buffer.from("decodable final"));
  const identity = {
    schema: "pulse_motion_source_identity_sidecar_v1",
    schema_version: 1,
    producer: "pulse_source_identity_oembed_verifier_v1",
    canonical_source_url: sourceUrl,
    youtube_video_id: "PublisherGameplay1",
    source_master_sha256: sha256(sourceMasterBytes),
    channel_identity: {
      author_name: "Official Game Channel",
      author_url: "https://www.youtube.com/@officialgamechannel",
    },
    identity_scope: "source_identity_only",
    rights_grant: false,
  };
  await fs.outputJson(identityPath, identity);
  const identityBytes = await fs.readFile(identityPath);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Publisher Game",
    primary_source: "Official Publisher",
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    output_path: finalVideoPath,
    clip_scene_plan: { scenes: [{ path: clipPath }] },
    selected_input_assets: {
      schema_version: 2,
      authoritative: true,
      producer_id: "pulse-gaming-studio-v4-renderer",
      assets: [{
        asset_id: "publisher-gameplay-window",
        kind: "video",
        path: clipPath,
        source_url: sourceMasterPath,
        asset_sha256: sha256(clipBytes),
        asset_size_bytes: clipBytes.length,
      }],
    },
  });
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    clips: [{
      id: "publisher-gameplay-window",
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: sourceMasterPath,
      canonical_source_url: sourceUrl,
      youtube_video_id: "PublisherGameplay1",
      source_type: "official_publisher_gameplay_clip",
      source_owner: "Official Publisher",
      source_family: "publisher_gameplay_window_0_6",
      rights_basis: "publisher_video_policy_transformative_editorial_use",
      licence_basis: "publisher_video_policy_transformative_editorial_use",
      allowed_use: "transformative_editorial_short_form",
      allowed_platforms: ["youtube", "instagram", "facebook"],
      commercial_use_allowed: true,
      credit_required: true,
      evidence_reference: policyPath,
      risk_score: 0.18,
      materialized: true,
      validated: true,
      segmentValidationPassed: true,
      provenance: {
        source: "official_trailer_segment_validation",
        segment_validated: true,
        validation_reason: "hash_bound_official_source_and_policy_evidence_passed",
      },
      source_master_path: sourceMasterPath,
      source_master_sha256: sha256(sourceMasterBytes),
      motion_source_identity: {
        status: "resolved",
        strict_pass: true,
        canonical_source_url: sourceUrl,
        youtube_video_id: "PublisherGameplay1",
        source_master_sha256: sha256(sourceMasterBytes),
        source_identity_provenance: {
          schema_version: 1,
          kind: "pulse_source_identity_sidecar",
          status: "resolved",
          sidecar_path: identityPath,
          sidecar_sha256: sha256(identityBytes),
          canonical_source_url: sourceUrl,
          youtube_video_id: "PublisherGameplay1",
          source_master_sha256: sha256(sourceMasterBytes),
          identity_scope: "source_identity_only",
          rights_grant: false,
        },
        blockers: [],
      },
    }],
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {});
  await fs.outputJson(path.join(artifactDir, "narration_manifest.json"), {});
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    source_plan: { selected_assets: [] },
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    outputs: {},
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "RED",
    records: [{
      asset_id: "publisher-gameplay-window",
      path: clipPath,
      source_url: sourceMasterPath,
      source_type: "official_publisher_gameplay_clip",
      licence_basis: "publisher_video_policy_transformative_editorial_use",
      commercial_use_allowed: false,
      allowed_platforms: [],
      approval_status: "operator_legal_review_required",
      rights_status: "operator_legal_review_required",
      usage_scope: "local_proof_only",
      rights_verdict: "RED",
      status: "RED",
      rights_grant: false,
      risk_score: 1,
      evidence_file: "materialised_motion_clips.json",
      rights_decision_basis:
        "provisional_renderer_local_proof_pending_policy_reconciliation",
    }],
  });

  const report = await reconcileCandidateEvidence({
    artifactDir,
    bridgePath: "",
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
    targetPlatforms: TARGET_PLATFORMS,
  });

  assert.equal(report.rights.verdict, "PASS", JSON.stringify(report.rights, null, 2));
  assert.deepEqual(report.rights.blockers, []);
  const clip = report.rights.proposed_ledger.records[0];
  assert.equal(clip.asset_id, "publisher-gameplay-window");
  assert.equal(clip.source_url, sourceUrl);
  assert.equal(clip.source_owner, "Official Game Channel");
  assert.equal(clip.rights_verdict, "GREEN");
  assert.equal(clip.commercial_use_allowed, true);
  assert.equal(
    clip.reconciliation_basis,
    "current_validated_official_materialised_clip",
  );
});

test("candidate evidence reconciliation replaces only a provisional renderer row for hash-bound official Steam motion", async () => {
  const storyId = "verified_official_steam_motion";
  const artifactDir = await makeArtifactDir("pulse-verified-official-steam-motion-");
  const clipPath = path.join(artifactDir, "official-steam-window.mp4");
  const sourceMasterPath = path.join(artifactDir, "official-steam-master.webm");
  const finalVideoPath = path.join(artifactDir, "visual_v4_render.mp4");
  const sourceUrl =
    "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/123/extras/official.webm?t=1";
  const sourceMasterBytes = Buffer.from("hash-bound official steam master");
  await fs.outputFile(clipPath, Buffer.from("verified official steam window"));
  await fs.outputFile(sourceMasterPath, sourceMasterBytes);
  await fs.outputFile(finalVideoPath, Buffer.from("decodable final"));
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Verified Game",
    primary_source: "Official Publisher",
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    output_path: finalVideoPath,
    clip_scene_plan: { scenes: [{ path: clipPath }] },
  });
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    clips: [{
      id: "official-steam-window",
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: sourceUrl,
      source_type: "official_platform_product_page",
      source_owner: "Official Publisher",
      source_family: "official_steam_window_4_5",
      rights_basis: "official_storefront_promotional_editorial",
      materialized: true,
      validated: true,
      segmentValidationPassed: true,
      provenance: {
        source: "flagship_motion_plan_materializer",
        segment_validated: true,
        validation_reason: "hash_bound_official_source_and_decoded_visual_qa_passed",
      },
      source_master_path: sourceMasterPath,
      source_master_sha256: sha256(sourceMasterBytes),
      motion_source_identity: {
        status: "resolved",
        strict_pass: true,
        canonical_source_url: sourceUrl,
        youtube_video_id: null,
        source_master_sha256: sha256(sourceMasterBytes),
        source_identity_provenance: {
          status: "resolved",
          channel_identity: {
            author_name: "Official Publisher",
            author_url: "https://store.steampowered.com/app/123/Verified_Game/",
          },
        },
        blockers: [],
      },
    }],
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {});
  await fs.outputJson(path.join(artifactDir, "narration_manifest.json"), {});
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), { source_plan: { selected_assets: [] } });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), { outputs: {} });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "RED",
    records: [{
      asset_id: "official-steam-window",
      path: clipPath,
      source_url: sourceUrl,
      source_type: "official_platform_product_page",
      licence_basis: "official_storefront_promotional_editorial",
      commercial_use_allowed: false,
      allowed_platforms: [],
      approval_status: "operator_legal_review_required",
      rights_status: "operator_legal_review_required",
      usage_scope: "local_proof_only",
      rights_grant: false,
      risk_score: 1,
      evidence_file: "output/operations/verified-official-steam-recovery-seed.json",
      rights_decision_basis:
        "provisional_renderer_local_proof_pending_policy_reconciliation",
    }],
  });

  const report = await reconcileCandidateEvidence({
    artifactDir,
    bridgePath: "",
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
    targetPlatforms: TARGET_PLATFORMS,
  });

  assert.equal(report.rights.verdict, "PASS", JSON.stringify(report.rights, null, 2));
  assert.deepEqual(report.rights.blockers, []);
  const clip = report.rights.proposed_ledger.records[0];
  assert.equal(clip.asset_id, "official-steam-window");
  assert.equal(clip.source_url, sourceUrl);
  assert.equal(clip.source_master_sha256, sha256(sourceMasterBytes));
  assert.equal(clip.approval_status, "approved_for_transformative_editorial_use");
  assert.equal(clip.commercial_use_allowed, true);
  assert.equal(clip.reconciliation_basis, "current_validated_official_materialised_clip");
  assert.equal(
    clip.rights_decision_basis,
    "validated_official_direct_media_editorial_policy",
  );
});

test("candidate evidence reconciliation does not invent rights for an unvalidated official-looking clip", async () => {
  const storyId = "unvalidated_official_looking_clip";
  const artifactDir = await makeArtifactDir("pulse-unvalidated-official-motion-");
  const clipPath = path.join(artifactDir, "unvalidated.mp4");
  const finalVideoPath = path.join(artifactDir, "visual_v4_render.mp4");
  await fs.outputFile(clipPath, Buffer.from("unvalidated motion"));
  await fs.outputFile(finalVideoPath, Buffer.from("decodable final"));
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Unverified Game",
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    output_path: finalVideoPath,
    clip_scene_plan: { scenes: [{ path: clipPath }] },
  });
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    clips: [{
      id: "unvalidated_clip",
      path: clipPath,
      source_url: "https://gmedia.playstation.com/is/content/SIEPDC/unvalidated.mp4",
      source_type: "official_game_site_news_page",
      rights_basis: "official_direct_media",
      materialized: true,
      validated: false,
      segmentValidationPassed: false,
    }],
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {});
  await fs.outputJson(path.join(artifactDir, "narration_manifest.json"), {});
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), { source_plan: { selected_assets: [] } });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), { outputs: {} });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), []);

  const report = await reconcileCandidateEvidence({
    artifactDir,
    bridgePath: "",
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
    targetPlatforms: TARGET_PLATFORMS,
  });

  assert.equal(report.rights.verdict, "FAIL");
  assert.ok(report.rights.blockers.includes("complete_rights_record_missing:unvalidated_clip"));
});

test("candidate evidence reconciliation never replaces restrictive platform-variant rights with derived permission", async () => {
  const storyId = "restrictive_platform_variant";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-restrictive-platform-variant-",
    storyId,
  });
  const { rightsPath } = await addNarrationRightsFixture(fixture, storyId);
  const instagramVariantPath = path.join(fixture.artifactDir, "platform", "instagram-reels.mp4");
  await fs.outputFile(instagramVariantPath, Buffer.from("restricted instagram variant"));
  await fs.outputJson(path.join(fixture.artifactDir, "platform_publish_manifest.json"), {
    publish_status: "GREEN",
    can_auto_publish: true,
    enabled_platforms: TARGET_PLATFORMS,
    outputs: {
      instagram_reels: { variant_video_path: instagramVariantPath },
    },
  });
  const rights = await fs.readJson(rightsPath);
  rights.push(completeRights({
    asset_id: "platform-native-instagram_reels",
    kind: "platform_native",
    path: instagramVariantPath,
    licence_basis: "operator_restricted_variant",
    commercial_use_allowed: false,
    evidence_file: "platform_publish_manifest.json",
  }));
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const report = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: fixture.bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
    targetPlatforms: TARGET_PLATFORMS,
  });

  assert.equal(report.verdict, "FAIL");
  assert.ok(report.rights.blockers.includes("restrictive_rights_record:platform-native-instagram_reels"));
  assert.equal(
    report.rights.proposed_ledger.records.some(
      (record) => record.asset_id === "platform-native-instagram_reels",
    ),
    false,
  );
});

test("candidate evidence reconciliation rejects a same-source rights donor with a negative decision", async () => {
  const storyId = "rejected_same_source_rights_donor";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-rejected-rights-donor-",
    storyId,
  });
  const audioManifest = await fs.readJson(path.join(fixture.artifactDir, "audio_manifest.json"));
  await fs.outputJson(path.join(fixture.artifactDir, "narration_manifest.json"), {
    story_id: storyId,
    provider: "elevenlabs",
    resolved_audio_path: audioManifest.resolved_narration_audio_path,
    status: "ready",
  });
  await fs.outputJson(path.join(fixture.artifactDir, "sfx_manifest.json"), {
    source_plan: { selected_assets: [] },
  });
  await fs.outputJson(path.join(fixture.artifactDir, "rights_ledger.json"), [completeRights({
    asset_id: `${storyId}_stale_narration`,
    path: path.join(fixture.artifactDir, "stale", "narration.mp3"),
    source_url: `elevenlabs://pulse-gaming/${storyId}`,
    source_type: "elevenlabs_generated_narration",
    licence_basis: "operator_licensed_elevenlabs_commercial_generation",
    evidence_file: "narration_manifest.json",
    approval_status: "REJECTED",
    verdict: "RED",
  })]);

  const report = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: fixture.bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
    targetPlatforms: TARGET_PLATFORMS,
  });

  assert.equal(report.verdict, "FAIL");
  assert.equal(report.rights.verdict, "FAIL");
  assert.ok(report.rights.blockers.includes(`restrictive_rights_record:${storyId}_audio_path`));
  assert.equal(report.rights.proposed_ledger.records.length, 0);
});

test("candidate evidence reconciliation rejects narration rights when the authoritative audio hash is stale", async () => {
  const storyId = "stale_narration_rights_hash";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-stale-narration-rights-hash-",
    storyId,
  });
  const { audioPath } = await addNarrationRightsFixture(fixture, storyId);
  const audioManifestPath = path.join(fixture.artifactDir, "audio_manifest.json");
  const audioManifest = await fs.readJson(audioManifestPath);
  await fs.writeJson(audioManifestPath, { ...audioManifest, provider: "elevenlabs" }, { spaces: 2 });
  await fs.writeJson(path.join(fixture.artifactDir, "narration_manifest.json"), {
    story_id: storyId,
    provider: "elevenlabs",
    resolved_audio_path: audioPath,
    audio_sha256: "0".repeat(64),
    status: "ready",
  }, { spaces: 2 });

  const report = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: fixture.bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
    targetPlatforms: TARGET_PLATFORMS,
  });

  assert.equal(report.verdict, "FAIL");
  assert.equal(report.rights.verdict, "FAIL");
  assert.ok(report.rights.blockers.includes(`narration_manifest_audio_hash_mismatch:${storyId}_audio_path`));
  assert.equal(report.rights.proposed_ledger.records.length, 0);
});

test("candidate evidence reconciliation repairs stale Digimon bridge fingerprints without promoting authoritative RED", async () => {
  const artifactDir = await makeArtifactDir("pulse-digimon-fingerprints-");
  const audioPath = path.join(artifactDir, "audio", "narration.mp3");
  const timestampsPath = path.join(artifactDir, "audio", "word_timestamps.json");
  const finalVideoPath = path.join(artifactDir, "visual_v4_render.mp4");
  const bridgePath = path.join(artifactDir, "scheduler_bridge_candidates.json");
  const staleAudioPath = path.join(artifactDir, "stale", "narration.mp3");
  const staleTimestampsPath = path.join(artifactDir, "stale", "word_timestamps.json");
  const audio = Buffer.from("current Digimon narration");
  const timestamps = Buffer.from(JSON.stringify([{ word: "Digimon", start: 0, end: 0.3 }]));
  const canonical = {
    story_id: "official_digimon_switch2_launch_20260710",
    selected_title: "Digimon Story Time Stranger Reaches Switch 2",
    thumbnail_headline: "DIGIMON SWITCH 2",
    first_spoken_line: "Digimon has reached Switch 2.",
    narration_script: "Digimon has reached Switch 2 with two governed performance modes.",
    canonical_subject: "Digimon Story Time Stranger",
    canonical_angle: "Confirmed Drop",
    primary_source: "Bandai Namco",
  };
  await fs.outputFile(audioPath, audio);
  await fs.outputFile(timestampsPath, timestamps);
  await fs.outputFile(finalVideoPath, Buffer.from("decodable Digimon final media fixture"));
  await fs.outputFile(staleAudioPath, "stale narration");
  await fs.outputFile(staleTimestampsPath, "stale timestamps");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), canonical);
  const authoritativeFingerprint = renderInputFingerprint({ canonical, audio, timestamps });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "official_digimon_switch2_launch_20260710",
    output_path: finalVideoPath,
    input_fingerprint: authoritativeFingerprint,
    input_evidence: {
      resolved_narration_audio_path: staleAudioPath,
      resolved_word_timestamps_path: staleTimestampsPath,
    },
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    resolved_narration_audio_path: audioPath,
    resolved_word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(bridgePath, {
    scheduler_bridge_candidates: [
      {
        story_id: "official_digimon_switch2_launch_20260710",
        status: "RED",
        governance_publish_status: "held",
        publish_verdict: { verdict: "RED", can_auto_publish: false, blockers: ["operator_hold"] },
        render_manifest: {
          input_evidence: {
            resolved_narration_audio_path: staleAudioPath,
            resolved_word_timestamps_path: staleTimestampsPath,
          },
          input_fingerprint: {
            algorithm: "sha256",
            signature: "stale-signature",
            audio_sha256: "a".repeat(64),
            word_timestamps_sha256: "b".repeat(64),
            audio_size_bytes: 1,
            word_timestamps_size_bytes: 2,
          },
        },
      },
    ],
  });

  const report = await reconcileCandidateEvidence({
    artifactDir,
    bridgePath,
    storyId: "official_digimon_switch2_launch_20260710",
    repairRights: false,
    repairBridgeFingerprints: true,
    apply: true,
    generatedAt: "2026-07-14T21:15:00.000Z",
    probeMedia: async () => ({ decodable: true, duration_seconds: 57.625 }),
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.bridge_fingerprints.verdict, "PASS");
  assert.equal(report.bridge_fingerprints.applied, true);
  assert.equal(report.bridge_fingerprints.same_run_verified, true);
  assert.equal(report.bridge_fingerprints.changed, true);
  assert.deepEqual(report.bridge_fingerprints.blockers, []);
  const bridge = await fs.readJson(bridgePath);
  const candidate = bridge.scheduler_bridge_candidates[0];
  assert.deepEqual(candidate.render_manifest.input_fingerprint, authoritativeFingerprint);
  assert.equal(candidate.render_manifest.input_evidence.resolved_narration_audio_path, audioPath);
  assert.equal(candidate.render_manifest.input_evidence.resolved_word_timestamps_path, timestampsPath);
  assert.equal(candidate.status, "RED");
  assert.equal(candidate.governance_publish_status, "held");
  assert.deepEqual(candidate.publish_verdict, {
    verdict: "RED",
    can_auto_publish: false,
    blockers: ["operator_hold"],
  });
  assert.match(report.bridge_fingerprints.backup_path, /scheduler_bridge_candidates\.json\.pre_candidate_evidence_reconciliation/);
  assert.equal(await fs.pathExists(report.bridge_fingerprints.backup_path), true);
  assert.equal(await fs.pathExists(report.bridge_fingerprints.render_manifest_backup_path), true);
  const repairedRenderManifest = await fs.readJson(path.join(artifactDir, "render_manifest.json"));
  assert.equal(repairedRenderManifest.input_evidence.resolved_narration_audio_path, audioPath);
  assert.equal(repairedRenderManifest.input_evidence.resolved_word_timestamps_path, timestampsPath);
});

test("candidate evidence reconciliation refuses bridge repair when the artifact render fingerprint is not same-run", async () => {
  const artifactDir = await makeArtifactDir("pulse-stale-artifact-fingerprint-");
  const audioPath = path.join(artifactDir, "audio", "narration.mp3");
  const timestampsPath = path.join(artifactDir, "audio", "word_timestamps.json");
  const finalVideoPath = path.join(artifactDir, "visual_v4_render.mp4");
  const bridgePath = path.join(artifactDir, "scheduler_bridge_candidates.json");
  const audio = Buffer.from("new audio after render");
  const timestamps = Buffer.from("new timestamps after render");
  const canonical = {
    story_id: "stale_same_run_candidate",
    selected_title: "Current Same Run Candidate",
    thumbnail_headline: "CURRENT CANDIDATE",
    first_spoken_line: "This is current copy.",
    narration_script: "This is current copy with governed evidence.",
    canonical_subject: "Current Game",
    canonical_angle: "confirmed_update",
    primary_source: "Official Publisher",
  };
  await fs.outputFile(audioPath, audio);
  await fs.outputFile(timestampsPath, timestamps);
  await fs.outputFile(finalVideoPath, "decodable media fixture");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), canonical);
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    resolved_narration_audio_path: audioPath,
    resolved_word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    output_path: finalVideoPath,
    input_fingerprint: renderInputFingerprint({
      canonical,
      audio,
      timestamps,
      overrides: {
        audio_sha256: "a".repeat(64),
        word_timestamps_sha256: "b".repeat(64),
        audio_size_bytes: 1,
        word_timestamps_size_bytes: 2,
      },
    }),
  });
  const originalBridge = {
    scheduler_bridge_candidates: [{
      story_id: "stale_same_run_candidate",
      publish_verdict: { verdict: "RED", can_auto_publish: false },
      render_manifest: { input_fingerprint: { audio_sha256: "c".repeat(64) } },
    }],
  };
  await fs.outputJson(bridgePath, originalBridge);

  const report = await reconcileCandidateEvidence({
    artifactDir,
    bridgePath,
    storyId: "stale_same_run_candidate",
    repairRights: false,
    repairBridgeFingerprints: true,
    apply: true,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
  });

  assert.equal(report.verdict, "FAIL");
  assert.equal(report.bridge_fingerprints.applied, false);
  assert.equal(report.bridge_fingerprints.same_run_verified, false);
  assert.ok(report.bridge_fingerprints.blockers.includes("authoritative_render_fingerprint_not_same_run"));
  assert.ok(report.bridge_fingerprints.blockers.includes("final_render_audio_fingerprint_mismatch"));
  assert.ok(report.bridge_fingerprints.blockers.includes("final_render_word_timestamps_fingerprint_mismatch"));
  assert.deepEqual(await fs.readJson(bridgePath), originalBridge);
});

test("candidate evidence reconciliation cannot let a GREEN bridge override authoritative package and control RED", async () => {
  const artifactDir = await makeArtifactDir("pulse-authoritative-red-reconciliation-");
  const audioPath = path.join(artifactDir, "audio", "narration.mp3");
  const timestampsPath = path.join(artifactDir, "audio", "word_timestamps.json");
  const finalVideoPath = path.join(artifactDir, "visual_v4_render.mp4");
  const bridgePath = path.join(artifactDir, "scheduler_bridge_candidates.json");
  const audio = Buffer.from("current governed narration");
  const timestamps = Buffer.from(JSON.stringify([{ word: "Current", start: 0, end: 0.2 }]));
  await fs.outputFile(audioPath, audio);
  await fs.outputFile(timestampsPath, timestamps);
  await fs.outputFile(finalVideoPath, "decodable media fixture");
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    resolved_narration_audio_path: audioPath,
    resolved_word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    output_path: finalVideoPath,
    input_fingerprint: {
      signature: "same-run-signature",
      audio_sha256: sha256(audio),
      word_timestamps_sha256: sha256(timestamps),
      audio_size_bytes: audio.length,
      word_timestamps_size_bytes: timestamps.length,
    },
  });
  await fs.outputJson(path.join(artifactDir, "goal_package_summary.json"), {
    story_id: "authoritative_red_candidate",
    verdict: "RED",
    blockers: ["render:final_publish_render_missing"],
  });
  await fs.outputJson(path.join(artifactDir, "publish_verdict.json"), {
    verdict: "RED",
    can_auto_publish: false,
    reason_codes: ["operator_hold"],
  });
  const originalBridge = {
    scheduler_bridge_candidates: [{
      story_id: "authoritative_red_candidate",
      governance_publish_status: "GREEN",
      publish_verdict: { verdict: "GREEN", can_auto_publish: true },
      render_manifest: { input_fingerprint: { signature: "stale-bridge-signature" } },
    }],
  };
  await fs.outputJson(bridgePath, originalBridge);

  const report = await reconcileCandidateEvidence({
    artifactDir,
    bridgePath,
    storyId: "authoritative_red_candidate",
    repairRights: false,
    repairBridgeFingerprints: true,
    apply: true,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
  });

  assert.equal(report.verdict, "FAIL");
  assert.equal(report.authority.verdict, "FAIL");
  assert.equal(report.authority.publish_readiness, "RED");
  assert.ok(report.authority.blockers.includes("authoritative_goal_package_summary_red"));
  assert.ok(report.authority.blockers.includes("authoritative_publish_verdict_red"));
  assert.equal(report.bridge_fingerprints.applied, false);
  assert.deepEqual(await fs.readJson(bridgePath), originalBridge);
});

test("candidate evidence reconciliation can repair rights under RED without promoting publish authority", async () => {
  const storyId = "authoritative_red_rights_repair";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-authoritative-red-rights-repair-",
    storyId,
  });
  await addNarrationRightsFixture(fixture, storyId);
  await fs.outputJson(path.join(fixture.artifactDir, "goal_package_summary.json"), {
    story_id: storyId,
    verdict: "RED",
    blockers: ["operator_review_required"],
  });
  await fs.outputJson(path.join(fixture.artifactDir, "publish_verdict.json"), {
    verdict: "RED",
    can_auto_publish: false,
    reason_codes: ["operator_review_required"],
  });
  const beforeBridge = await fs.readJson(fixture.bridgePath);

  const report = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: fixture.bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: true,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
    targetPlatforms: TARGET_PLATFORMS,
  });

  assert.equal(report.verdict, "FAIL");
  assert.equal(report.authority.verdict, "FAIL");
  assert.equal(report.publish_readiness, "RED");
  assert.equal(report.rights.verdict, "PASS");
  assert.equal(report.rights.applied, true);
  assert.equal(report.transaction.committed, true);
  assert.equal(report.safety.no_authoritative_verdict_promotion, true);
  const afterBridge = await fs.readJson(fixture.bridgePath);
  assert.equal(
    afterBridge.scheduler_bridge_candidates[0].governance_publish_status,
    beforeBridge.scheduler_bridge_candidates[0].governance_publish_status,
  );
  assert.deepEqual(
    afterBridge.scheduler_bridge_candidates[0].publish_verdict,
    beforeBridge.scheduler_bridge_candidates[0].publish_verdict,
  );
  assert.equal(afterBridge.scheduler_bridge_candidates[0].rights_ledger.verdict, "pass");
});

test("candidate evidence reconciliation identifies same-run current evidence while stale authority and pending AV review remain RED", async () => {
  const storyId = "ascend_same_run_current_evidence";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-ascend-same-run-evidence-",
    storyId,
  });
  await addNarrationRightsFixture(fixture, storyId);
  await fs.outputJson(path.join(fixture.artifactDir, "goal_package_summary.json"), {
    story_id: storyId,
    verdict: "RED",
    blockers: [
      "render:final_publish_render_missing",
      "audio:narration_audio_missing",
      "captions:word_timestamps_missing",
    ],
  });
  await fs.outputJson(path.join(fixture.artifactDir, "publish_verdict.json"), {
    verdict: "RED",
    can_auto_publish: false,
    reason_codes: ["render:final_publish_render_missing"],
  });
  await fs.outputJson(path.join(fixture.artifactDir, "final_av_review.json"), {
    story_id: storyId,
    status: "PENDING",
    verdict: "PENDING",
    publish_ready: false,
    can_auto_publish: false,
    blockers: ["independent_final_av_review_pending"],
  });

  const report = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: "",
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
    targetPlatforms: TARGET_PLATFORMS,
  });

  assert.equal(report.verdict, "FAIL");
  assert.equal(report.publish_readiness, "RED");
  assert.equal(report.current_evidence.verdict, "PASS");
  assert.equal(report.current_evidence.reconciled, true);
  assert.equal(report.current_evidence.same_run_verified, true);
  assert.equal(report.current_evidence.final_render_decodable, true);
  assert.equal(report.current_evidence.rights_complete, true);
  assert.equal(report.current_evidence.publish_readiness, "RED");
  assert.equal(report.current_evidence.green_eligible, false);
  assert.deepEqual(report.current_evidence.blockers, []);
  assert.ok(
    report.current_evidence.publish_blockers.includes("authoritative_goal_package_summary_red"),
  );
  assert.ok(
    report.current_evidence.publish_blockers.includes("authoritative_publish_verdict_red"),
  );
  assert.ok(
    report.current_evidence.publish_blockers.includes("independent_final_av_review_pending"),
  );
});

test("candidate evidence reconciliation binds current audio, timestamp and caption manifests without changing publish authority", async () => {
  const storyId = "story-current-lineage-bindings";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-current-lineage-bindings-",
    storyId,
  });
  const audioManifestPath = path.join(fixture.artifactDir, "audio_manifest.json");
  const narrationManifestPath = path.join(fixture.artifactDir, "narration_manifest.json");
  const captionManifestPath = path.join(fixture.artifactDir, "caption_manifest.json");
  const audioManifest = await fs.readJson(audioManifestPath);
  const captionPath = path.join(fixture.artifactDir, "captions.srt");
  await fs.outputFile(captionPath, "1\n00:00:00,000 --> 00:00:00,200\nGoverned\n");
  await fs.outputJson(narrationManifestPath, {
    story_id: storyId,
    status: "ready",
    resolved_audio_path: audioManifest.resolved_narration_audio_path,
    resolved_word_timestamps_path: audioManifest.resolved_word_timestamps_path,
  });
  await fs.outputJson(captionManifestPath, {
    story_id: storyId,
    caption_srt_path: captionPath,
    word_timestamps_path: audioManifest.resolved_word_timestamps_path,
  });
  const originalPublishVerdict = await fs.readFile(
    path.join(fixture.artifactDir, "publish_verdict.json"),
  );

  const report = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: "",
    storyId,
    repairRights: false,
    repairBridgeFingerprints: false,
    repairLineageHashes: true,
    apply: true,
    generatedAt: "2026-07-17T09:40:00.000Z",
    probeMedia: async () => ({ decodable: true, duration_seconds: 1 }),
  });

  assert.equal(report.lineage_hashes.verdict, "PASS");
  assert.equal(report.lineage_hashes.applied, true);
  assert.equal(report.lineage_hashes.same_run_verified, true);
  assert.deepEqual(report.lineage_hashes.blockers, []);
  const repairedAudio = await fs.readJson(audioManifestPath);
  const repairedNarration = await fs.readJson(narrationManifestPath);
  const repairedCaptions = await fs.readJson(captionManifestPath);
  assert.equal(repairedAudio.verdict, "PASS");
  assert.equal(repairedAudio.narration_audio_sha256, sha256(await fs.readFile(audioManifest.resolved_narration_audio_path)));
  assert.equal(repairedAudio.word_timestamps_sha256, sha256(await fs.readFile(audioManifest.resolved_word_timestamps_path)));
  assert.equal(repairedNarration.audio_sha256, repairedAudio.narration_audio_sha256);
  assert.equal(repairedNarration.word_timestamps_sha256, repairedAudio.word_timestamps_sha256);
  assert.equal(repairedCaptions.verdict, "PASS");
  assert.equal(repairedCaptions.word_timestamps_sha256, repairedAudio.word_timestamps_sha256);
  assert.match(repairedCaptions.caption_srt_sha256, /^[a-f0-9]{64}$/);
  assert.ok(report.lineage_hashes.backups.every((backupPath) => fs.existsSync(backupPath)));
  assert.deepEqual(
    await fs.readFile(path.join(fixture.artifactDir, "publish_verdict.json")),
    originalPublishVerdict,
  );
});

test("candidate evidence reconciliation keeps an otherwise GREEN package RED while independent AV review is pending", async () => {
  const storyId = "pending_av_review_candidate";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-pending-av-review-",
    storyId,
  });
  await addNarrationRightsFixture(fixture, storyId);
  await fs.outputJson(path.join(fixture.artifactDir, "final_av_review.json"), {
    story_id: storyId,
    status: "PENDING",
    verdict: "PENDING",
    publish_ready: false,
    can_auto_publish: false,
    blockers: ["independent_final_av_review_pending"],
  });

  const report = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: "",
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
    targetPlatforms: TARGET_PLATFORMS,
  });

  assert.equal(report.authority.verdict, "FAIL");
  assert.ok(
    report.authority.blockers.includes("authoritative_final_av_review_not_green"),
  );
  assert.equal(report.rights.verdict, "PASS");
  assert.equal(report.current_evidence.verdict, "PASS");
  assert.equal(report.current_evidence.reconciled, true);
  assert.equal(report.current_evidence.green_eligible, false);
  assert.deepEqual(
    report.current_evidence.final_av_review.blockers,
    ["independent_final_av_review_pending"],
  );
  assert.equal(report.verdict, "FAIL");
  assert.equal(report.publish_readiness, "RED");
});

test("candidate evidence reconciliation rejects a stale canonical-copy hash even when audio and timestamps match", async () => {
  const artifactDir = await makeArtifactDir("pulse-stale-canonical-copy-");
  const audioPath = path.join(artifactDir, "audio", "narration.mp3");
  const timestampsPath = path.join(artifactDir, "audio", "word_timestamps.json");
  const finalVideoPath = path.join(artifactDir, "visual_v4_render.mp4");
  const bridgePath = path.join(artifactDir, "scheduler_bridge_candidates.json");
  const audio = Buffer.from("canonical narration audio");
  const timestamps = Buffer.from(JSON.stringify([{ word: "Canonical", start: 0, end: 0.2 }]));
  const canonical = {
    story_id: "stale_canonical_candidate",
    selected_title: "The Current Governed Title",
    thumbnail_headline: "CURRENT TITLE",
    first_spoken_line: "This is the current opening line.",
    narration_script: "This is the current opening line with governed public copy.",
    canonical_subject: "Current Game",
    canonical_angle: "confirmed_update",
    primary_source: "Official Publisher",
  };
  await fs.outputFile(audioPath, audio);
  await fs.outputFile(timestampsPath, timestamps);
  await fs.outputFile(finalVideoPath, "decodable media fixture");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), canonical);
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    resolved_narration_audio_path: audioPath,
    resolved_word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    output_path: finalVideoPath,
    input_fingerprint: renderInputFingerprint({
      canonical,
      audio,
      timestamps,
      overrides: { canonical_public_copy_hash: sha256("stale canonical copy") },
    }),
  });
  await fs.outputJson(path.join(artifactDir, "goal_package_summary.json"), {
    story_id: "stale_canonical_candidate",
    verdict: "GREEN",
    blockers: [],
  });
  await fs.outputJson(path.join(artifactDir, "publish_verdict.json"), {
    verdict: "GREEN",
    can_auto_publish: true,
    reason_codes: [],
  });
  const originalBridge = {
    scheduler_bridge_candidates: [{
      story_id: "stale_canonical_candidate",
      governance_publish_status: "GREEN",
      publish_verdict: { verdict: "GREEN", can_auto_publish: true },
      render_manifest: { input_fingerprint: { signature: "stale-bridge-signature" } },
    }],
  };
  await fs.outputJson(bridgePath, originalBridge);

  const report = await reconcileCandidateEvidence({
    artifactDir,
    bridgePath,
    storyId: "stale_canonical_candidate",
    repairRights: false,
    repairBridgeFingerprints: true,
    apply: true,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
  });

  assert.equal(report.verdict, "FAIL");
  assert.equal(report.bridge_fingerprints.same_run_verified, false);
  assert.ok(report.bridge_fingerprints.blockers.includes("final_render_canonical_copy_fingerprint_mismatch"));
  assert.equal(report.bridge_fingerprints.applied, false);
  assert.deepEqual(await fs.readJson(bridgePath), originalBridge);
});

test("candidate evidence reconciliation cannot let a GREEN bridge override an authoritative RED aggregate entry", async () => {
  const artifactDir = await makeArtifactDir("pulse-authoritative-red-aggregate-");
  const audioPath = path.join(artifactDir, "audio", "narration.mp3");
  const timestampsPath = path.join(artifactDir, "audio", "word_timestamps.json");
  const finalVideoPath = path.join(artifactDir, "visual_v4_render.mp4");
  const bridgePath = path.join(artifactDir, "scheduler_bridge_candidates.json");
  const aggregatePath = path.join(artifactDir, "story-packages.json");
  const audio = Buffer.from("aggregate governed narration");
  const timestamps = Buffer.from(JSON.stringify([{ word: "Aggregate", start: 0, end: 0.2 }]));
  const canonical = {
    story_id: "aggregate_red_candidate",
    selected_title: "Aggregate Authority Must Win",
    thumbnail_headline: "AGGREGATE AUTHORITY",
    first_spoken_line: "The aggregate remains authoritative.",
    narration_script: "The aggregate remains authoritative for this governed candidate.",
    canonical_subject: "Aggregate Game",
    canonical_angle: "confirmed_update",
    primary_source: "Official Publisher",
  };
  await fs.outputFile(audioPath, audio);
  await fs.outputFile(timestampsPath, timestamps);
  await fs.outputFile(finalVideoPath, "decodable media fixture");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), canonical);
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    resolved_narration_audio_path: audioPath,
    resolved_word_timestamps_path: timestampsPath,
  });
  const fingerprint = renderInputFingerprint({ canonical, audio, timestamps });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    output_path: finalVideoPath,
    input_fingerprint: fingerprint,
  });
  await fs.outputJson(path.join(artifactDir, "goal_package_summary.json"), {
    story_id: "aggregate_red_candidate",
    verdict: "GREEN",
    blockers: [],
  });
  await fs.outputJson(path.join(artifactDir, "publish_verdict.json"), {
    verdict: "GREEN",
    can_auto_publish: true,
    reason_codes: [],
  });
  await fs.outputJson(aggregatePath, {
    story_packages: [{
      story_id: "aggregate_red_candidate",
      verdict: "RED",
      control_tower: {
        verdict: "RED",
        can_auto_publish: false,
        blockers: ["operator_hold"],
      },
    }],
  });
  const originalBridge = {
    scheduler_bridge_candidates: [{
      story_id: "aggregate_red_candidate",
      governance_publish_status: "GREEN",
      publish_verdict: { verdict: "GREEN", can_auto_publish: true },
      render_manifest: { input_fingerprint: { signature: "stale-bridge-signature" } },
    }],
  };
  await fs.outputJson(bridgePath, originalBridge);

  const report = await reconcileCandidateEvidence({
    artifactDir,
    bridgePath,
    aggregatePaths: [aggregatePath],
    storyId: "aggregate_red_candidate",
    repairRights: false,
    repairBridgeFingerprints: true,
    apply: true,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
  });

  assert.equal(report.verdict, "FAIL");
  assert.ok(report.authority.blockers.includes("authoritative_aggregate_package_red"));
  assert.equal(report.authority.sources.find((source) => source.key === "aggregate").authoritative_red, true);
  assert.equal(report.bridge_fingerprints.applied, false);
  assert.deepEqual(await fs.readJson(bridgePath), originalBridge);
});

test("candidate evidence reconciliation rejects a validly signed canonical snapshot for a different story", async () => {
  const storyId = "canonical_identity_candidate";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-canonical-identity-mismatch-",
    storyId,
    canonicalStoryId: "different_story",
  });

  const report = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: fixture.bridgePath,
    storyId,
    repairRights: false,
    repairBridgeFingerprints: true,
    apply: true,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
  });

  assert.equal(report.verdict, "FAIL");
  assert.ok(report.bridge_fingerprints.blockers.includes("canonical_story_id_mismatch"));
  assert.equal(report.bridge_fingerprints.applied, false);
  assert.deepEqual(await fs.readJson(fixture.bridgePath), fixture.originalBridge);
});

test("candidate evidence reconciliation rejects a stale aggregate signature with current component fingerprints", async () => {
  const storyId = "aggregate_signature_candidate";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-aggregate-signature-mismatch-",
    storyId,
    fingerprintOverrides: { signature: sha256("stale aggregate signature") },
  });

  const report = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: fixture.bridgePath,
    storyId,
    repairRights: false,
    repairBridgeFingerprints: true,
    apply: true,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
  });

  assert.equal(report.verdict, "FAIL");
  assert.equal(report.publish_readiness, "RED");
  assert.ok(report.bridge_fingerprints.blockers.includes("final_render_fingerprint_signature_mismatch"));
  assert.equal(report.bridge_fingerprints.current_files.audio_sha256.length, 64);
  assert.equal(report.bridge_fingerprints.current_files.word_timestamps_sha256.length, 64);
  assert.equal(report.bridge_fingerprints.applied, false);
  assert.deepEqual(await fs.readJson(fixture.bridgePath), fixture.originalBridge);
});

test("candidate evidence reconciliation fails closed on malformed authoritative package evidence", async () => {
  const storyId = "malformed_authority_candidate";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-malformed-authority-",
    storyId,
  });
  await fs.writeFile(
    path.join(fixture.artifactDir, "goal_package_summary.json"),
    "{ not valid json",
    "utf8",
  );

  const report = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: fixture.bridgePath,
    storyId,
    repairRights: false,
    repairBridgeFingerprints: true,
    apply: true,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
  });

  assert.equal(report.verdict, "FAIL");
  assert.ok(report.authority.blockers.includes("authoritative_goal_package_summary_invalid"));
  const source = report.authority.sources.find((item) => item.key === "goal_package_summary");
  assert.equal(source.present, true);
  assert.equal(source.valid, false);
  assert.equal(report.bridge_fingerprints.applied, false);
  assert.deepEqual(await fs.readJson(fixture.bridgePath), fixture.originalBridge);
});

test("candidate evidence reconciliation applies no lane when aggregate signature validation fails", async () => {
  const storyId = "atomic_reconciliation_candidate";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-atomic-reconciliation-",
    storyId,
    fingerprintOverrides: { signature: sha256("stale aggregate signature") },
  });
  const audioManifest = await fs.readJson(path.join(fixture.artifactDir, "audio_manifest.json"));
  const audioPath = audioManifest.resolved_narration_audio_path;
  await fs.outputJson(path.join(fixture.artifactDir, "narration_manifest.json"), {
    story_id: storyId,
    provider: "elevenlabs",
    resolved_audio_path: audioPath,
    status: "ready",
  });
  await fs.outputJson(path.join(fixture.artifactDir, "sfx_manifest.json"), {
    source_plan: { selected_assets: [] },
  });
  const originalRights = [completeRights({
    asset_id: `${storyId}_narration`,
    path: audioPath,
    source_url: `elevenlabs://pulse-gaming/${storyId}`,
    source_type: "elevenlabs_generated_narration",
    licence_basis: "operator_licensed_elevenlabs_commercial_generation",
    evidence_file: "narration_manifest.json",
  })];
  await fs.outputJson(path.join(fixture.artifactDir, "rights_ledger.json"), originalRights);

  const report = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: fixture.bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: true,
    apply: true,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
  });

  assert.equal(report.verdict, "FAIL");
  assert.equal(report.rights.verdict, "PASS");
  assert.equal(report.rights.applied, false);
  assert.equal(report.bridge_fingerprints.verdict, "FAIL");
  assert.deepEqual(await fs.readJson(fixture.bridgePath), fixture.originalBridge);
  assert.deepEqual(await fs.readJson(path.join(fixture.artifactDir, "rights_ledger.json")), originalRights);
});

test("candidate evidence reconciliation applies valid rights and fingerprints with distinct backups", async () => {
  const storyId = "combined_reconciliation_candidate";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-combined-reconciliation-",
    storyId,
  });
  const audioManifest = await fs.readJson(path.join(fixture.artifactDir, "audio_manifest.json"));
  const audioPath = audioManifest.resolved_narration_audio_path;
  await fs.outputJson(path.join(fixture.artifactDir, "narration_manifest.json"), {
    story_id: storyId,
    provider: "elevenlabs",
    resolved_audio_path: audioPath,
    status: "ready",
  });
  await fs.outputJson(path.join(fixture.artifactDir, "sfx_manifest.json"), {
    source_plan: { selected_assets: [] },
  });
  await fs.outputJson(path.join(fixture.artifactDir, "rights_ledger.json"), [completeRights({
    asset_id: `${storyId}_narration`,
    path: audioPath,
    source_url: `elevenlabs://pulse-gaming/${storyId}`,
    source_type: "elevenlabs_generated_narration",
    licence_basis: "operator_licensed_elevenlabs_commercial_generation",
    evidence_file: "narration_manifest.json",
  })]);

  const report = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: fixture.bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: true,
    apply: true,
    generatedAt: "2026-07-15T10:00:00.000Z",
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.publish_readiness, "UNCHANGED");
  assert.equal(report.apply_preflight.passed, true);
  assert.equal(report.rights.applied, true);
  assert.equal(report.bridge_fingerprints.applied, true);
  assert.notEqual(report.rights.bridge_backup_path, report.bridge_fingerprints.backup_path);
  assert.equal(await fs.pathExists(report.rights.bridge_backup_path), true);
  assert.equal(await fs.pathExists(report.bridge_fingerprints.backup_path), true);
  const bridge = await fs.readJson(fixture.bridgePath);
  const candidate = bridge.scheduler_bridge_candidates[0];
  assert.equal(candidate.governance_publish_status, "GREEN");
  assert.deepEqual(candidate.publish_verdict, { verdict: "GREEN", can_auto_publish: true });
  assert.equal(candidate.rights_ledger.verdict, "pass");
  assert.equal(candidate.render_manifest.input_fingerprint.signature.length, 64);
  const reconciledRenderManifest = await fs.readJson(
    path.join(fixture.artifactDir, "render_manifest.json"),
  );
  assert.equal(reconciledRenderManifest.rights_reconciliation.verdict, "PASS");
  assert.equal(reconciledRenderManifest.rights_reconciliation.status, "GREEN");
  assert.deepEqual(
    candidate.render_manifest.rights_reconciliation,
    reconciledRenderManifest.rights_reconciliation,
  );
});

test("candidate evidence reconciliation atomically rebinds flagship rights sidecars to the reconciled ledger", async () => {
  const storyId = "flagship_rights_sidecar_rebind_candidate";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-flagship-rights-sidecar-rebind-",
    storyId,
  });
  const {
    assetId,
    evidencePath,
    initialLedgerBytes,
    rightsPath,
  } = await addFlagshipNarrationSidecarFixture(fixture, storyId);

  const report = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: fixture.bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: true,
    generatedAt: "2026-07-19T12:00:00.000Z",
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.rights.applied, true);
  assert.equal(report.rights.flagship_sidecar_bindings.discovered_count, 1);
  assert.equal(report.rights.flagship_sidecar_bindings.rebound_count, 1);
  assert.deepEqual(report.rights.flagship_sidecar_bindings.blockers, []);
  const reconciledLedgerBytes = await fs.readFile(rightsPath);
  const reconciledLedger = await fs.readJson(rightsPath);
  const reconciledRecord = reconciledLedger.records.filter((record) => record.asset_id === assetId);
  const reboundEvidence = await fs.readJson(evidencePath);
  assert.equal(reboundEvidence.source_ledger_sha256, sha256(reconciledLedgerBytes));
  assert.equal(
    reboundEvidence.source_record_sha256,
    sha256(Buffer.from(stableJson(reconciledRecord), "utf8")),
  );
  assert.notEqual(reboundEvidence.source_ledger_sha256, sha256(initialLedgerBytes));
  assert.equal(await fs.pathExists(
    report.rights.flagship_sidecar_bindings.rebound[0].backup_path,
  ), true);
});

test("candidate evidence reconciliation rebuilds an explicitly RED flagship inventory after current rights converge", async () => {
  const storyId = "flagship_rights_stale_inventory_candidate";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-flagship-rights-stale-inventory-",
    storyId,
  });
  const { evidencePath } = await addFlagshipNarrationSidecarFixture(fixture, storyId);
  const inventoryPath = path.join(fixture.artifactDir, "flagship", "inventory.json");
  const inventory = await fs.readJson(inventoryPath);
  inventory.complete = false;
  inventory.verdict = "RED";
  inventory.blockers = ["rights_ledger_not_passed"];
  inventory.used_assets[0].allowed_platforms = ["youtube_shorts"];
  await fs.writeJson(inventoryPath, inventory, { spaces: 2 });
  const sidecar = await fs.readJson(evidencePath);
  sidecar.allowed_platforms = ["youtube_shorts"];
  await fs.writeJson(evidencePath, sidecar, { spaces: 2 });

  const report = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: fixture.bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: true,
    generatedAt: "2026-07-19T12:15:00.000Z",
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
  });

  assert.equal(report.rights.verdict, "PASS", JSON.stringify(report.rights, null, 2));
  assert.equal(report.rights.applied, true);
  assert.equal(report.rights.flagship_sidecar_bindings.rebuild_required, true);
  assert.equal(report.rights.flagship_sidecar_bindings.verified_count, 0);
  assert.deepEqual(report.rights.flagship_sidecar_bindings.blockers, []);
});

test("candidate evidence reconciliation rolls back a rights-only apply when the later bridge write fails", async (t) => {
  const storyId = "rights_transaction_rollback_candidate";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-rights-transaction-rollback-",
    storyId,
  });
  const {
    evidencePath,
    rightsPath,
  } = await addFlagshipNarrationSidecarFixture(fixture, storyId);
  const renderPath = path.join(fixture.artifactDir, "render_manifest.json");
  const paths = [rightsPath, renderPath, evidencePath, fixture.bridgePath];
  const before = await captureFiles(paths);
  failNextRenameTo(t, fixture.bridgePath);

  const report = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: fixture.bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: true,
    generatedAt: "2026-07-15T11:00:00.000Z",
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
  });

  assert.equal(report.verdict, "FAIL");
  assert.equal(report.rights.applied, false);
  assert.equal(report.rights.bridge_rights_synced, false);
  assert.ok(report.rights.blockers.includes("local_file_transaction_failed"));
  assert.equal(
    report.rights.proposed_render_rights_reconciliation.verdict,
    "FAIL",
  );
  assert.equal(
    report.rights.proposed_render_rights_reconciliation.status,
    "RED",
  );
  assert.equal(
    report.rights.proposed_render_rights_reconciliation.applied,
    false,
  );
  assert.equal(
    report.rights.proposed_render_rights_reconciliation.can_auto_publish,
    false,
  );
  assert.equal(
    report.rights.proposed_render_rights_reconciliation.final_state_verified,
    false,
  );
  assert.ok(
    report.rights.proposed_render_rights_reconciliation.blockers.includes(
      "local_file_transaction_failed",
    ),
  );
  assert.equal(report.transaction.committed, false);
  assert.equal(report.transaction.rolled_back, true);
  const after = await captureFiles(paths);
  assert.deepEqual(after, before);
});

test("candidate evidence reconciliation can apply rights twice with one generated timestamp without backup collisions", async () => {
  const storyId = "same_run_rights_reconciliation_candidate";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-same-run-rights-reconciliation-",
    storyId,
  });
  await addFlagshipNarrationSidecarFixture(fixture, storyId);
  const options = {
    artifactDir: fixture.artifactDir,
    bridgePath: fixture.bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: true,
    generatedAt: "2026-07-19T13:15:00.000Z",
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
  };

  const first = await reconcileCandidateEvidence(options);
  const second = await reconcileCandidateEvidence(options);

  assert.equal(first.rights.verdict, "PASS", JSON.stringify(first.rights, null, 2));
  assert.equal(second.rights.verdict, "PASS", JSON.stringify(second.rights, null, 2));
  assert.equal(first.transaction.committed, true);
  assert.equal(second.transaction.committed, true);
  assert.notEqual(first.rights.backup_path, second.rights.backup_path);
  assert.notEqual(
    first.rights.render_manifest_backup_path,
    second.rights.render_manifest_backup_path,
  );
  assert.equal(first.rights.flagship_sidecar_bindings.rebound_count, 1);
  assert.equal(second.rights.flagship_sidecar_bindings.rebound_count, 0);
  assert.equal(await fs.pathExists(first.rights.backup_path), true);
  assert.equal(await fs.pathExists(second.rights.backup_path), true);
  assert.equal(
    second.rights.blockers.includes("local_file_transaction_failed"),
    false,
  );
});

test("candidate evidence reconciliation rolls back a fingerprint-only apply when the later bridge write fails", async (t) => {
  const storyId = "fingerprint_transaction_rollback_candidate";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-fingerprint-transaction-rollback-",
    storyId,
  });
  const renderPath = path.join(fixture.artifactDir, "render_manifest.json");
  const paths = [renderPath, fixture.bridgePath];
  const before = await captureFiles(paths);
  failNextRenameTo(t, fixture.bridgePath);

  const report = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: fixture.bridgePath,
    storyId,
    repairRights: false,
    repairBridgeFingerprints: true,
    apply: true,
    generatedAt: "2026-07-15T11:05:00.000Z",
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
  });

  assert.equal(report.verdict, "FAIL");
  assert.equal(report.bridge_fingerprints.applied, false);
  assert.ok(report.bridge_fingerprints.blockers.includes("local_file_transaction_failed"));
  assert.equal(report.transaction.committed, false);
  assert.equal(report.transaction.rolled_back, true);
  const after = await captureFiles(paths);
  assert.deepEqual(after, before);
});

test("candidate evidence reconciliation rolls back rights, render and bridge files when combined apply fails late", async (t) => {
  const storyId = "combined_transaction_rollback_candidate";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-combined-transaction-rollback-",
    storyId,
  });
  const { rightsPath } = await addNarrationRightsFixture(fixture, storyId);
  const renderPath = path.join(fixture.artifactDir, "render_manifest.json");
  const paths = [rightsPath, renderPath, fixture.bridgePath];
  const before = await captureFiles(paths);
  failNextRenameTo(t, fixture.bridgePath);

  const report = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: fixture.bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: true,
    apply: true,
    generatedAt: "2026-07-15T11:10:00.000Z",
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
  });

  assert.equal(report.verdict, "FAIL");
  assert.equal(report.rights.applied, false);
  assert.equal(report.rights.bridge_rights_synced, false);
  assert.equal(report.bridge_fingerprints.applied, false);
  assert.equal(report.transaction.committed, false);
  assert.equal(report.transaction.rolled_back, true);
  const after = await captureFiles(paths);
  assert.deepEqual(after, before);
});

test("candidate evidence reconciliation prefers a materialised local SFX path over its remote source URL", async () => {
  const storyId = "materialised_sfx_candidate";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-materialised-sfx-",
    storyId,
  });
  const { rightsPath } = await addNarrationRightsFixture(fixture, storyId);
  const sfxPath = path.join(fixture.artifactDir, "audio", "impact.wav");
  const sourceUrl = "https://audio.example/licensed/impact.wav";
  await fs.outputFile(sfxPath, Buffer.from("materialised licensed impact"));
  await fs.writeJson(path.join(fixture.artifactDir, "sfx_manifest.json"), {
    source_plan: {
      selected_assets: [{
        asset_id: "licensed_impact",
        provider_id: "licensed_provider",
        family: "impact",
        source_url: sourceUrl,
        local_materialized_path: sfxPath,
      }],
    },
  }, { spaces: 2 });
  const rights = await fs.readJson(rightsPath);
  rights.push(completeRights({
    asset_id: "licensed_impact",
    path: sfxPath,
    source_url: sourceUrl,
    source_type: "licensed_sfx",
    source_family: "impact",
    evidence_file: "sfx_manifest.json",
  }));
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const report = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: fixture.bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
  });

  assert.equal(report.rights.verdict, "PASS");
  const sfxRecord = report.rights.proposed_ledger.records.find((record) => record.kind === "sfx");
  assert.equal(sfxRecord.path, sfxPath);
  assert.equal(sfxRecord.local_materialized_path, sfxPath);
  assert.equal(sfxRecord.source_url, sourceUrl);
});

test("candidate evidence reconciliation binds Epidemic SFX to an exact local rights ledger record", async () => {
  const storyId = "epidemic_sfx_candidate";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-epidemic-sfx-rights-",
    storyId,
  });
  const { rightsPath } = await addNarrationRightsFixture(fixture, storyId);
  const workspaceRoot = path.join(fixture.artifactDir, "workspace");
  const localLedgerPath = path.join(
    workspaceRoot,
    "output",
    "epidemic-sound-intake",
    "sfx_rights_ledger.json",
  );
  const assetId = "epidemic_sound_impact_fixture";
  const sfxPath = path.join(fixture.artifactDir, "audio", "impact.wav");
  await fs.outputFile(sfxPath, Buffer.from("licensed Epidemic impact"));
  await fs.outputJson(localLedgerPath, {
    records: [{
      asset_id: assetId,
      provider_id: "epidemic_sound",
      licence_basis: "operator_licensed_epidemic_sound_commercial_use",
    }],
  });
  await fs.writeJson(path.join(fixture.artifactDir, "sfx_manifest.json"), {
    source_plan: {
      selected_assets: [{
        asset_id: assetId,
        provider_id: "epidemic_sound",
        family: "impact",
        source_url: `file://${sfxPath.replace(/\\/g, "/")}`,
        local_materialized_path: sfxPath,
      }],
    },
  }, { spaces: 2 });
  const rights = await fs.readJson(rightsPath);
  rights.push(completeRights({
    asset_id: assetId,
    path: sfxPath,
    source_url: `file://${sfxPath.replace(/\\/g, "/")}`,
    source_type: "epidemic_sound",
    source_family: "impact",
    licence_basis: "operator_licensed_epidemic_sound_commercial_use",
    evidence_file: "https://help.epidemicsound.com/hc/en-us/articles/26248340314258-Safelisting",
  }));
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const report = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: fixture.bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    workspaceRoot,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
  });

  assert.equal(report.rights.verdict, "PASS", JSON.stringify(report.rights, null, 2));
  const sfxRecord = report.rights.proposed_ledger.records.find((record) => record.asset_id === assetId);
  assert.equal(sfxRecord.evidence_file, localLedgerPath);
  assert.match(sfxRecord.evidence_sha256, /^[a-f0-9]{64}$/);
  assert.equal(sfxRecord.evidence_size_bytes, (await fs.stat(localLedgerPath)).size);
  assert.equal(sfxRecord.source_owner, "Epidemic Sound");
  assert.equal(sfxRecord.provider_id, "epidemic_sound");
});

test("candidate evidence reconciliation discovers repo-level provider rights from an isolated workspace", async () => {
  const storyId = "isolated_epidemic_sfx_candidate";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-isolated-epidemic-sfx-rights-",
    storyId,
  });
  await addNarrationRightsFixture(fixture, storyId);
  const projectRoot = path.join(fixture.artifactDir, "project-root");
  const workspaceRoot = path.join(projectRoot, "output", "isolated-roots", "flagship-proof");
  const providerLedgerPath = path.join(
    projectRoot,
    "output",
    "epidemic-sound-intake",
    "sfx_rights_ledger.json",
  );
  await fs.outputJson(path.join(projectRoot, "package.json"), {
    name: "pulse-provider-rights-fixture",
  });
  const assetId = "epidemic_sound_isolated_impact_fixture";
  const sfxPath = path.join(fixture.artifactDir, "audio", "isolated-impact.wav");
  await fs.outputFile(sfxPath, Buffer.from("licensed isolated Epidemic impact"));
  await fs.outputJson(providerLedgerPath, {
    records: [completeRights({
      asset_id: assetId,
      kind: "sfx",
      path: sfxPath,
      source_url: `file://${sfxPath.replace(/\\/g, "/")}`,
      source_type: "epidemic_sound_local_file",
      source_family: "impact",
      source_owner: "Epidemic Sound",
      provider_id: "epidemic_sound",
      licence_basis: "epidemic_sound_active_subscription_safelisted_channel",
      evidence_reference: providerLedgerPath,
    })],
  });
  await fs.writeJson(path.join(fixture.artifactDir, "sfx_manifest.json"), {
    source_plan: {
      selected_assets: [{
        asset_id: assetId,
        provider_id: "epidemic_sound",
        family: "impact",
        source_url: `file://${sfxPath.replace(/\\/g, "/")}`,
        local_materialized_path: sfxPath,
      }],
    },
  }, { spaces: 2 });

  const report = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: fixture.bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    workspaceRoot,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
  });

  assert.equal(report.rights.verdict, "PASS", JSON.stringify(report.rights, null, 2));
  const sfxRecord = report.rights.proposed_ledger.records.find(
    (record) => record.asset_id === assetId,
  );
  assert.equal(sfxRecord.evidence_file, providerLedgerPath);
  assert.equal(sfxRecord.source_owner, "Epidemic Sound");
  assert.equal(sfxRecord.provider_id, "epidemic_sound");
});

test("candidate evidence reconciliation includes every renderer-selected music bed and sting", async () => {
  const storyId = "renderer_selected_music_candidate";
  const fixture = await makeFingerprintFixture({
    prefix: "pulse-renderer-selected-music-",
    storyId,
  });
  const { rightsPath } = await addNarrationRightsFixture(fixture, storyId);
  const workspaceRoot = path.join(fixture.artifactDir, "workspace");
  const globalMusicRightsPath = path.join(
    workspaceRoot,
    "output",
    "epidemic-sound-intake",
    "epidemic_rights_ledger.json",
  );
  const bedPath = path.join(fixture.artifactDir, "audio", "bed.mp3");
  const stingPath = path.join(fixture.artifactDir, "audio", "sting.wav");
  await fs.outputFile(bedPath, Buffer.from("licensed Epidemic music bed"));
  await fs.outputFile(stingPath, Buffer.from("licensed Epidemic music sting"));
  const renderManifestPath = path.join(fixture.artifactDir, "render_manifest.json");
  const renderManifest = await fs.readJson(renderManifestPath);
  renderManifest.selected_input_assets = {
    authoritative: true,
    assets: [
      {
        asset_id: "epidemic_sound_bed_fixture",
        kind: "music",
        role: "music_bed",
        path: bedPath,
      },
      {
        asset_id: "epidemic_sound_sting_fixture",
        kind: "music",
        role: "music_sting",
        path: stingPath,
      },
    ],
  };
  await fs.writeJson(renderManifestPath, renderManifest, { spaces: 2 });
  const globalRights = [];
  for (const [assetId, role, assetPath] of [
    ["epidemic_sound_bed_fixture", "music_bed", bedPath],
    ["epidemic_sound_sting_fixture", "music_sting", stingPath],
  ]) {
    globalRights.push(completeRights({
      asset_id: assetId,
      kind: "music",
      role,
      path: assetPath,
      source_url: `file://${assetPath.replace(/\\/g, "/")}`,
      source_type: "licensed_music_library_file",
      source_family: role,
      source_owner: "Epidemic Sound",
      provider_id: "epidemic_sound",
      licence_basis: "epidemic_sound_active_subscription_safelisted_channel",
      evidence_reference:
        "https://help.epidemicsound.com/hc/en-us/articles/26248340314258-Safelisting",
    }));
  }
  await fs.outputJson(globalMusicRightsPath, { records: globalRights }, { spaces: 2 });

  const report = await reconcileCandidateEvidence({
    artifactDir: fixture.artifactDir,
    bridgePath: fixture.bridgePath,
    storyId,
    repairRights: true,
    repairBridgeFingerprints: false,
    apply: false,
    workspaceRoot,
    probeMedia: async () => ({ decodable: true, duration_seconds: 50 }),
  });

  assert.equal(report.rights.verdict, "PASS", JSON.stringify(report.rights, null, 2));
  assert.equal(report.rights.used_asset_count, 3);
  const music = report.rights.proposed_ledger.records.filter((record) => record.kind === "music");
  assert.deepEqual(
    music.map((record) => record.asset_id).sort(),
    ["epidemic_sound_bed_fixture", "epidemic_sound_sting_fixture"],
  );
  assert.ok(music.every((record) => record.source_owner === "Epidemic Sound"));
  assert.ok(music.every((record) => record.provider_id === "epidemic_sound"));
  assert.ok(music.every((record) => record.evidence_file === globalMusicRightsPath));
});
