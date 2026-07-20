"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  repairFlagshipRenderWorkOrder,
} = require("../../lib/flagship-render-workorder-repair");
const {
  main: runRepairCli,
  parseArgs,
  usage,
} = require("../../tools/flagship-render-workorder-repair");

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function sha256File(filePath) {
  return sha256Buffer(await fs.readFile(filePath));
}

async function makeFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-flagship-workorder-repair-"));
  t.after(() => fs.remove(root));

  const sourceArtifactDir = path.join(root, "source-artifact");
  const mediaDir = path.join(root, "current-evidence");
  const sourceWorkOrderPath = path.join(root, "source-render-input-work-order.json");
  const currentEvidencePath = path.join(root, "current-render-evidence.json");
  const motionManifestPath = path.join(mediaDir, "materialised_motion_clips.json");
  const narrationPath = path.join(mediaDir, "narration.mp3");
  const timestampsPath = path.join(mediaDir, "word_timestamps.json");
  const workspaceDir = path.join(root, "isolated-workspace");
  const storyId = "story-flagship-repair";

  await fs.ensureDir(sourceArtifactDir);
  await fs.ensureDir(mediaDir);
  await fs.writeJson(path.join(sourceArtifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "Current Flagship Story",
    narration_script: "Current evidence",
    tts_script: "Current evidence",
  });
  await fs.writeJson(path.join(sourceArtifactDir, "audio_manifest.json"), {
    story_id: storyId,
    resolved_narration_audio_path: "C:/old/audio.mp3",
    resolved_word_timestamps_path: "C:/old/timestamps.json",
  });
  await fs.writeJson(path.join(sourceArtifactDir, "materialised_motion_clips.json"), {
    story_id: storyId,
    status: "ready",
    clips: [{ id: "old-clip", path: "C:/old/clip.mp4", source_family: "old-family" }],
    materialised_clips: [{ id: "old-clip", path: "C:/old/clip.mp4", source_family: "old-family" }],
    clip_count: 1,
    distinct_motion_family_count: 1,
  });
  await fs.writeFile(path.join(sourceArtifactDir, "visual_v4_render.mp4"), "old-final-render");
  await fs.writeJson(path.join(sourceArtifactDir, "render_manifest.json"), {
    story_id: storyId,
    final_publish_render: true,
  });
  await fs.writeFile(path.join(sourceArtifactDir, "package-marker.txt"), "copy-me");

  const narrationBytes = Buffer.alloc(2_048, 0x31);
  const timestampPayload = {
    meta: {
      source: "local_whisper_word_alignment",
      display_text: "Current evidence",
      spoken_text: "Current evidence",
    },
    words: [
      { word: "Current", start: 0, end: 0.25 },
      { word: "evidence", start: 0.25, end: 0.5 },
    ],
  };
  const timestampBytes = Buffer.from(`${JSON.stringify(timestampPayload, null, 2)}\n`);
  await fs.writeFile(narrationPath, narrationBytes);
  await fs.writeFile(timestampsPath, timestampBytes);

  const clips = [];
  for (let index = 1; index <= 5; index += 1) {
    const clipPath = path.join(mediaDir, `fresh-clip-${index}.mp4`);
    const clipBytes = Buffer.alloc(512 + index, index);
    await fs.writeFile(clipPath, clipBytes);
    const timestamp = new Date(`2026-07-15T10:0${index}:00.000Z`);
    await fs.utimes(clipPath, timestamp, timestamp);
    clips.push({
      id: `fresh-clip-${index}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_family: `current-family-${index}`,
      motion_family: `current-family-${index}`,
      base_source_asset_id: `black-flag-base-${index}`,
      source_master_sha256: sha256Buffer(Buffer.from(`black-flag-master-${index}`)),
      canonical_source_url: `https://media.example.test/black-flag/master-${index}`,
      sha256: sha256Buffer(clipBytes),
      media_kind: "direct_video",
      source_type: "official_trailer",
      counts_towards_motion_readiness: true,
      materialized: true,
    });
  }
  await fs.writeJson(motionManifestPath, {
    schema_version: 1,
    story_id: storyId,
    status: "ready",
    generated_at: "2026-07-15T10:10:00.000Z",
    clips,
    materialised_clips: clips,
    clip_count: clips.length,
    distinct_motion_family_count: clips.length,
  });

  const narrationRightsRecord = {
    asset_id: `${storyId}_audio_path`,
    asset_type: "narration_audio",
    kind: "audio",
    path: narrationPath,
    source_url: `elevenlabs://pulse-gaming/${storyId}`,
    source_type: "elevenlabs_tts_voice",
    provider_id: "elevenlabs",
    licence_basis: "elevenlabs_commercial_tts_generation",
    allowed_use: "short_form_editorial_narration",
    allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    commercial_use_allowed: true,
    approval_status: "approved",
    asset_sha256: sha256Buffer(narrationBytes),
    asset_size_bytes: narrationBytes.length,
  };
  const motionRightsRecord = async (clip) => ({
    asset_id: clip.id,
    asset_type: "motion_clip",
    kind: "video",
    path: clip.path,
    source_url: clip.canonical_source_url || `https://media.example.test/${clip.id}`,
    source_type: clip.source_type || "official_trailer",
    licence_basis: "official_publisher_promotional_editorial_use",
    allowed_use: "transformative_editorial_short_form",
    allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    commercial_use_allowed: true,
    approval_status: "approved_for_transformative_editorial_use",
    asset_sha256: await sha256File(clip.path),
    asset_size_bytes: (await fs.stat(clip.path)).size,
  });
  const writeMotionRights = async (rows = clips) => {
    const records = await Promise.all(rows.map(motionRightsRecord));
    await fs.writeJson(path.join(mediaDir, "rights_ledger.json"), {
      schema_version: 1,
      story_id: storyId,
      verdict: "pass",
      status: "ready",
      blockers: [],
      failures: [],
      records,
      used_assets: records.map((record) => ({ ...record })),
      metrics: {
        used_asset_count: records.length,
        rights_record_count: records.length,
        missing_asset_count: 0,
        duplicate_record_count: 0,
      },
    }, { spaces: 2 });
  };
  await writeMotionRights(clips);
  const sourceRightsRecords = [
    narrationRightsRecord,
    ...await Promise.all(clips.map(motionRightsRecord)),
  ];
  await fs.writeJson(path.join(sourceArtifactDir, "rights_ledger.json"), {
    schema_version: 1,
    story_id: storyId,
    verdict: "pass",
    status: "ready",
    blockers: [],
    failures: [],
    records: sourceRightsRecords,
    used_assets: sourceRightsRecords.map((record) => ({ ...record })),
    metrics: {
      used_asset_count: sourceRightsRecords.length,
      rights_record_count: sourceRightsRecords.length,
      missing_asset_count: 0,
      duplicate_record_count: 0,
    },
  }, { spaces: 2 });

  const oldOutputPath = path.join(sourceArtifactDir, "visual_v4_render.mp4");
  const oldManifestPath = path.join(sourceArtifactDir, "render_manifest.json");
  await fs.writeJson(sourceWorkOrderPath, {
    schema_version: 1,
    generated_at: "2026-07-14T08:00:00.000Z",
    mode: "GOAL_RENDER_INPUT_WORK_ORDER",
    summary: {
      story_count: 2,
      ready_for_final_render_job_count: 1,
      blocked_on_render_inputs_count: 1,
      audio_timestamp_jobs: 7,
    },
    repair_backlog: { items: [{ story_id: "unrelated-story", command: "do-not-carry" }] },
    jobs: [
      {
        story_id: "unrelated-story",
        artifact_dir: path.join(root, "unrelated-artifact"),
        status: "blocked_on_render_inputs",
        blockers: ["final_narration_audio_missing"],
        evidence: {},
        actions: [],
      },
      {
        story_id: storyId,
        title: "Current Flagship Story",
        artifact_dir: sourceArtifactDir,
        force_final_render: true,
        status: "ready_for_final_render_job",
        blockers: [],
        requirements: {
          min_materialised_motion_clips: 4,
          min_distinct_motion_families: 4,
        },
        evidence: {
          narration_audio_path: "C:/old/audio.mp3",
          word_timestamps_path: "C:/old/timestamps.json",
          narration_audio_sha256: "a".repeat(64),
          narration_audio_size_bytes: 10,
          word_timestamps_sha256: "b".repeat(64),
          word_timestamps_size_bytes: 20,
          materialised_motion_clip_paths: ["C:/old/clip.mp4"],
          materialised_motion_clip_mtimes: { "C:/old/clip.mp4": 1 },
          materialised_motion_clip_count: 1,
          distinct_motion_family_count: 1,
          real_visual_motion_clip_count: 1,
          real_visual_motion_family_count: 1,
          real_motion_input_readiness: {
            direct_video_motion_clip_floor: 4,
            direct_video_motion_clip_floor_met: false,
          },
          audio_fingerprint_matches_render: false,
          word_timestamps_fingerprint_matches_render: false,
        },
        target_render_manifest: {
          renderer: "visual_v4_production",
          visual_tier: "production_v4_motion",
          final_publish_render: true,
          output: "visual_v4_render.mp4",
          output_path: oldOutputPath,
          manifest_path: oldManifestPath,
          required_quality_gates: { media_house_polish_score: 80 },
        },
        actions: [
          {
            action_id: "run_visual_v4_production_render",
            status: "ready_after_inputs",
            required_artefact_path: oldOutputPath,
            recommended_command: `npm run ops:goal-production-render -- --work-order ${sourceWorkOrderPath}`,
            target_render_manifest: {
              renderer: "visual_v4_production",
              visual_tier: "production_v4_motion",
              final_publish_render: true,
              output: "visual_v4_render.mp4",
              output_path: oldOutputPath,
              manifest_path: oldManifestPath,
              required_quality_gates: { media_house_polish_score: 80 },
            },
          },
        ],
      },
    ],
    safety: {
      no_publish_triggered: true,
      production_db_mutated: false,
      oauth_or_token_mutated: false,
    },
  });

  const currentEvidence = {
    schema_version: 1,
    story_id: storyId,
    narration_audio_path: narrationPath,
    narration_audio_sha256: sha256Buffer(narrationBytes),
    narration_audio_size_bytes: narrationBytes.length,
    word_timestamps_path: timestampsPath,
    word_timestamps_sha256: sha256Buffer(timestampBytes),
    word_timestamps_size_bytes: timestampBytes.length,
    materialised_motion_manifest_path: motionManifestPath,
    materialised_motion_manifest_sha256: await sha256File(motionManifestPath),
    selected_materialised_motion_clip_ids: clips.slice(0, 4).map((clip) => clip.id),
  };
  await fs.writeJson(currentEvidencePath, currentEvidence);

  return {
    root,
    storyId,
    sourceArtifactDir,
    sourceWorkOrderPath,
    currentEvidencePath,
    currentEvidence,
    motionManifestPath,
    narrationPath,
    timestampsPath,
    clips,
    workspaceDir,
    writeMotionRights,
  };
}

async function writePendingElevenLabsGenerationReceipt({
  artifactDir,
  storyId,
  narrationPath,
  timestampsPath,
  requestStartedAt = "2026-07-15T12:00:00.000Z",
  responseReceivedAt = "2026-07-15T12:01:00.000Z",
} = {}) {
  const evidenceDir = path.join(artifactDir, "rights", "evidence");
  const receiptPath = path.join(evidenceDir, "elevenlabs-generation-receipt.json");
  const rawAudioPath = path.join(evidenceDir, "raw-provider-audio.bin");
  const modelSnapshotPath = path.join(evidenceDir, "model-snapshot.json");
  const subscriptionPrePath = path.join(evidenceDir, "subscription-pre.json");
  const subscriptionPostPath = path.join(evidenceDir, "subscription-post.json");
  const policyBillingPath = path.join(evidenceDir, "policy-01.bin");
  const policyTermsPath = path.join(evidenceDir, "policy-02.html");
  const narrationBytes = await fs.readFile(narrationPath);
  const narrationSha256 = sha256Buffer(narrationBytes);
  const rawAudioBytes = Buffer.from(narrationBytes);
  const rawAudioSha256 = sha256Buffer(rawAudioBytes);
  const requestId = "request-pre-render-rights";
  const historyItemId = "history-pre-render-rights";
  const timestampDocument = await fs.readJson(timestampsPath);
  const spokenText = timestampDocument.meta?.spoken_text || "Current evidence";

  await fs.ensureDir(evidenceDir);
  await fs.writeFile(rawAudioPath, rawAudioBytes);
  await fs.writeJson(modelSnapshotPath, {
    source_endpoint: "https://api.elevenlabs.io/v1/models",
    retrieved_at: "2026-07-15T11:58:00.000Z",
    model_id: "eleven_multilingual_v2",
    text_to_speech: true,
    requires_alpha_access: false,
    requires_beta_access: false,
    deprecated: false,
    regular_production_model: true,
    secrets_recorded: false,
  });
  await fs.writeJson(subscriptionPrePath, {
    source_endpoint: "https://api.elevenlabs.io/v1/user/subscription",
    retrieved_at: "2026-07-15T11:59:00.000Z",
    tier: "pro",
    status: "active",
    paid_plan: true,
    secrets_recorded: false,
  });
  await fs.writeJson(subscriptionPostPath, {
    source_endpoint: "https://api.elevenlabs.io/v1/user/subscription",
    retrieved_at: "2026-07-15T12:02:00.000Z",
    tier: "pro",
    status: "active",
    paid_plan: true,
    secrets_recorded: false,
  });
  await fs.writeFile(policyBillingPath, "ElevenLabs billing policy evidence");
  await fs.writeFile(policyTermsPath, "ElevenLabs UK and EEA terms evidence");

  const modelSnapshotStat = await fs.stat(modelSnapshotPath);
  const subscriptionPreStat = await fs.stat(subscriptionPrePath);
  const subscriptionPostStat = await fs.stat(subscriptionPostPath);
  const policyBillingStat = await fs.stat(policyBillingPath);
  const policyTermsStat = await fs.stat(policyTermsPath);
  await fs.writeJson(receiptPath, {
    schema: "pulse_elevenlabs_generation_receipt_v1",
    schema_version: 1,
    story_id: storyId,
    asset_id: `${storyId}_audio_path`,
    verdict: "AMBER",
    generation_verdict: "GREEN",
    final_media_lineage_status: "PENDING",
    commercial_use_allowed: false,
    provider: {
      id: "elevenlabs",
      model_id: "eleven_multilingual_v2",
      model_snapshot_path: "rights/evidence/model-snapshot.json",
      model_snapshot_sha256: await sha256File(modelSnapshotPath),
      model_snapshot_size_bytes: modelSnapshotStat.size,
      model_evidence: {
        source_endpoint: "https://api.elevenlabs.io/v1/models",
        retrieved_at: "2026-07-15T11:58:00.000Z",
        text_to_speech: true,
        requires_alpha_access: false,
      },
    },
    policy_evidence: {
      jurisdiction: "UK_EEA",
      paid_plan_required: true,
      beta_service_production_forbidden: true,
      documents: [
        {
          url: "https://elevenlabs.io/docs/overview/administration/billing",
          retrieved_at: "2026-07-15T11:58:30.000Z",
          materialised_path: "rights/evidence/policy-01.bin",
          sha256: await sha256File(policyBillingPath),
          size_bytes: policyBillingStat.size,
        },
        {
          url: "https://elevenlabs.io/terms-of-use-eu",
          retrieved_at: "2026-07-15T11:58:31.000Z",
          materialised_path: "rights/evidence/policy-02.html",
          sha256: await sha256File(policyTermsPath),
          size_bytes: policyTermsStat.size,
        },
      ],
    },
    account_entitlement: {
      source_endpoint: "https://api.elevenlabs.io/v1/user/subscription",
      pre_generation: {
        source_endpoint: "https://api.elevenlabs.io/v1/user/subscription",
        retrieved_at: "2026-07-15T11:59:00.000Z",
        tier: "pro",
        status: "active",
        paid_plan: true,
        secrets_recorded: false,
        evidence_path: "rights/evidence/subscription-pre.json",
        evidence_sha256: await sha256File(subscriptionPrePath),
        evidence_size_bytes: subscriptionPreStat.size,
      },
      post_generation: {
        source_endpoint: "https://api.elevenlabs.io/v1/user/subscription",
        retrieved_at: "2026-07-15T12:02:00.000Z",
        tier: "pro",
        status: "active",
        paid_plan: true,
        secrets_recorded: false,
        evidence_path: "rights/evidence/subscription-post.json",
        evidence_sha256: await sha256File(subscriptionPostPath),
        evidence_size_bytes: subscriptionPostStat.size,
      },
      paid_at_generation: true,
      secrets_recorded: false,
    },
    generation: {
      request_started_at: requestStartedAt,
      response_received_at: responseReceivedAt,
      request_id: requestId,
      history_item_id: historyItemId,
      history_date_unix: 1_752_577_260,
      voice_id_sha256: "1".repeat(64),
      request_text_sha256: sha256Buffer(Buffer.from(spokenText, "utf8")),
      request_settings_sha256: "2".repeat(64),
      raw_provider_audio_path: "rights/evidence/raw-provider-audio.bin",
      raw_provider_audio_sha256: rawAudioSha256,
      raw_provider_audio_size_bytes: rawAudioBytes.length,
      history_audio_sha256: rawAudioSha256,
      history_audio_size_bytes: rawAudioBytes.length,
    },
    generation_checks: {
      entitlement_brackets_generation: true,
      paid_subscription_pre_generation: true,
      paid_subscription_post_generation: true,
      model_is_production_tts: true,
      official_model_snapshot_verified: true,
      policy_files_verified: true,
      official_policy_files_verified: true,
      request_id_matches_history: true,
      history_item_identity_present: true,
      history_date_present: true,
      history_model_matches: true,
      history_voice_matches: true,
      history_text_matches: true,
      history_audio_matches_raw_response: true,
      no_secret_fields: true,
      no_personal_fields: true,
      no_invoice_fields: true,
      every_generation_condition_proven: true,
    },
    generation_blockers: [],
    blockers: ["final_media_lineage_pending"],
    mastering_lineage: {
      raw_provider_audio_sha256: rawAudioSha256,
      raw_provider_audio_size_bytes: rawAudioBytes.length,
      mastered_audio_sha256: narrationSha256,
      mastered_audio_size_bytes: narrationBytes.length,
      transform_status: "COMPLETE",
      post_generation_transform_status: "COMPLETE",
    },
    licence_basis: "elevenlabs_commercial_tts_generation",
    allowed_platforms: [
      "youtube_shorts",
      "instagram_reels",
      "facebook_reels",
    ],
    safety: {
      secrets_recorded: false,
      personal_account_fields_recorded: false,
      invoice_fields_recorded: false,
      oauth_mutated: false,
      token_mutated: false,
      billing_mutated: false,
      publishing_triggered: false,
      database_mutated: false,
    },
  }, { spaces: 2 });

  timestampDocument.meta = {
    ...(timestampDocument.meta || {}),
    provider: "elevenlabs",
    elevenlabsGenerationRights: {
      schemaVersion: 1,
      receiptPath: "rights/evidence/elevenlabs-generation-receipt.json",
      rawProviderAudioSha256: rawAudioSha256,
      rawProviderAudioSizeBytes: rawAudioBytes.length,
      masteredAudioSha256: narrationSha256,
      masteredAudioSizeBytes: narrationBytes.length,
      requestId,
      historyItemId,
      finalMediaLineageStatus: "PENDING",
      postGenerationTransformStatus: "COMPLETE",
    },
  };
  await fs.writeJson(timestampsPath, timestampDocument, { spaces: 2 });
  return receiptPath;
}

async function writeGovernedFlagshipCards({
  artifactDir,
  storyId,
  generatedAt = "2026-07-15T12:10:00.000Z",
} = {}) {
  const kinds = ["source", "context", "timeline", "quote", "takeaway", "outro"];
  const cardsDir = path.join(artifactDir, "flagship", "cards");
  await fs.ensureDir(cardsDir);
  for (const [index, kind] of kinds.entries()) {
    const cardPath = path.join(cardsDir, `hf_${kind}_card_${storyId}.mp4`);
    await fs.writeFile(cardPath, Buffer.alloc(4_096 + index, 0x41 + index));
    await fs.writeJson(cardPath.replace(/\.mp4$/i, ".shell.json"), {
      schema_version: 1,
      timing_policy_version: "pulse_card_timing_v5",
      generated_at: generatedAt,
      story_id: storyId,
      card_kind: kind,
      channel_id: "pulse-gaming",
      output_path: cardPath,
      project_dir: `experiments/hf-${kind}-${storyId}`,
      hyperframes_premium_shell: {
        status: "pass",
        timing_policy_version: "pulse_card_timing_v5",
        story_id: storyId,
        card_kind: kind,
        channel_id: "pulse-gaming",
        output_path: cardPath,
        checks: {
          check: { status: "pass" },
          render: { status: "pass" },
        },
        animation_contract: {
          status: "pass",
          blockers: [],
          evidence: {
            timeline_registry: true,
            paused_gsap_timeline: true,
            main_timeline_registered: true,
            timeline_animation_steps: 3,
          },
        },
        visual_identity: {
          status: "pass",
          blockers: [],
          evidence: {
            vertical_reel_viewport: true,
            tracked_clip: true,
            html_path: `experiments/hf-${kind}-${storyId}/index.html`,
            hyperframes_config_path: `experiments/hf-${kind}-${storyId}/hyperframes.json`,
          },
        },
        readability_contract: {
          status: "pass",
          contract_version: "pulse_card_timing_v5",
          evidence: {
            readable_text: kind === "source" ? "UBISOFT NEWS SOURCE" : "CURRENT EVIDENCE",
            word_count: kind === "source" ? 3 : 2,
            planned_visible_duration_s: 2.4,
            minimum_visible_duration_s: 1.9,
            maximum_visible_duration_s: 2.8,
            max_readable_card_duration_s: 2.8,
          },
        },
        blockers: [],
      },
    }, { spaces: 2 });
  }
  await fs.outputFile(
    path.join(cardsDir, "hf-backdrops", storyId, "stale.jpg"),
    "must-not-copy",
  );
  return kinds;
}

test("revalidates and preserves only generation-bound package-local flagship cards", async (t) => {
  const fixture = await makeFixture(t);
  const kinds = await writeGovernedFlagshipCards({
    artifactDir: fixture.sourceArtifactDir,
    storyId: fixture.storyId,
  });
  const sourceCardHashes = Object.fromEntries(await Promise.all(kinds.map(async (kind) => {
    const cardPath = path.join(
      fixture.sourceArtifactDir,
      "flagship",
      "cards",
      `hf_${kind}_card_${fixture.storyId}.mp4`,
    );
    return [kind, await sha256File(cardPath)];
  })));

  const result = await repairFlagshipRenderWorkOrder({
    sourceWorkOrderPath: fixture.sourceWorkOrderPath,
    currentEvidencePath: fixture.currentEvidencePath,
    workspaceDir: fixture.workspaceDir,
    generatedAt: "2026-07-15T12:20:00.000Z",
    cardProbeVideo: async () => ({
      decodable: true,
      duration_seconds: 2.4,
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      video: {
        codec: "h264",
        width: 1080,
        height: 1920,
      },
    }),
  });

  assert.equal(result.report.preserved_flagship_card_evidence.verdict, "GREEN");
  assert.equal(result.report.preserved_flagship_card_evidence.status, "copied");
  assert.equal(result.report.preserved_flagship_card_evidence.cards.length, kinds.length);
  assert.match(
    result.report.preserved_flagship_card_evidence.generation_id,
    /^flagship-card-generation-[a-f0-9]{64}$/,
  );

  const targetCardsDir = path.join(
    fixture.workspaceDir,
    "artifacts",
    fixture.storyId,
    "flagship",
    "cards",
  );
  const targetEntries = await fs.readdir(targetCardsDir);
  assert.equal(targetEntries.filter((entry) => entry.endsWith(".mp4")).length, kinds.length);
  assert.equal(targetEntries.filter((entry) => entry.endsWith(".shell.json")).length, kinds.length);
  assert.equal(
    await fs.pathExists(path.join(targetCardsDir, "hf-backdrops")),
    false,
    "unvalidated backdrop content must not survive the evidence copy",
  );

  for (const kind of kinds) {
    const targetCardPath = path.join(
      targetCardsDir,
      `hf_${kind}_card_${fixture.storyId}.mp4`,
    );
    const targetSidecar = await fs.readJson(
      targetCardPath.replace(/\.mp4$/i, ".shell.json"),
    );
    assert.equal(await sha256File(targetCardPath), sourceCardHashes[kind]);
    assert.equal(targetSidecar.output_path, targetCardPath);
    assert.equal(
      targetSidecar.hyperframes_premium_shell.output_path,
      targetCardPath,
    );
    assert.equal(
      targetSidecar.generation_id,
      result.report.preserved_flagship_card_evidence.generation_id,
    );
    assert.equal(targetSidecar.card_evidence_copy.source_sha256, sourceCardHashes[kind]);
    assert.equal(targetSidecar.card_evidence_copy.target_sha256, sourceCardHashes[kind]);
  }

  const evidencePath = path.join(
    fixture.workspaceDir,
    "artifacts",
    fixture.storyId,
    "flagship_card_evidence.json",
  );
  const storedEvidence = await fs.readJson(evidencePath);
  assert.deepEqual(storedEvidence, result.report.preserved_flagship_card_evidence);
  assert.equal(
    await fs.pathExists(path.join(
      fixture.sourceArtifactDir,
      "flagship",
      "cards",
      "hf-backdrops",
      fixture.storyId,
      "stale.jpg",
    )),
    true,
    "source evidence must remain unchanged",
  );
});

test("clones one ready render job and binds current file-backed evidence inside an isolated workspace", async (t) => {
  const fixture = await makeFixture(t);
  const canonicalPath = path.join(
    fixture.sourceArtifactDir,
    "canonical_story_manifest.json",
  );
  const canonical = await fs.readJson(canonicalPath);
  canonical.selected_title = "Current Canonical Flagship Title";
  await fs.writeJson(canonicalPath, canonical);
  const result = await repairFlagshipRenderWorkOrder({
    sourceWorkOrderPath: fixture.sourceWorkOrderPath,
    currentEvidencePath: fixture.currentEvidencePath,
    workspaceDir: fixture.workspaceDir,
    generatedAt: "2026-07-15T12:00:00.000Z",
  });

  assert.equal(result.report.status, "READY_FOR_LOCAL_RENDER");
  assert.equal(result.report.publish_authorised, false);
  assert.equal(result.report.safety.render_executed, false);
  assert.equal(result.report.safety.production_db_mutated, false);
  assert.equal(result.report.safety.oauth_or_token_mutated, false);

  const repaired = await fs.readJson(result.workOrderPath);
  const job = repaired.jobs[0];
  const targetArtifactDir = path.join(fixture.workspaceDir, "artifacts", fixture.storyId);
  const targetOutputPath = path.join(targetArtifactDir, "visual_v4_render.mp4");
  const targetManifestPath = path.join(targetArtifactDir, "render_manifest.json");
  const selectedClips = fixture.clips.slice(0, 4);

  assert.equal(repaired.mode, "LOCAL_PROOF_FLAGSHIP_RENDER_REPAIR");
  assert.equal(repaired.publish_authorised, false);
  assert.equal(repaired.jobs.length, 1);
  assert.equal(repaired.summary.story_count, 1);
  assert.equal(repaired.summary.ready_for_final_render_job_count, 1);
  assert.equal(repaired.summary.blocked_on_render_inputs_count, 0);
  assert.equal(repaired.repair_backlog, undefined);
  assert.equal(job.story_id, fixture.storyId);
  assert.equal(
    job.title,
    "Current Canonical Flagship Title",
    "current canonical title must replace a stale source work-order title",
  );
  assert.equal(job.artifact_dir, targetArtifactDir);
  assert.equal(job.target_render_manifest.output_path, targetOutputPath);
  assert.equal(job.target_render_manifest.manifest_path, targetManifestPath);
  assert.equal(job.actions[0].required_artefact_path, targetOutputPath);
  assert.equal(job.actions[0].target_render_manifest.output_path, targetOutputPath);
  assert.equal(job.evidence.narration_audio_path, path.join(targetArtifactDir, "flagship", "final_audio.mp3"));
  assert.equal(job.evidence.word_timestamps_path, path.join(targetArtifactDir, "flagship", "word_timestamps.json"));
  assert.equal(job.evidence.narration_audio_sha256, fixture.currentEvidence.narration_audio_sha256);
  assert.equal(job.evidence.narration_audio_size_bytes, fixture.currentEvidence.narration_audio_size_bytes);
  assert.equal(job.evidence.word_timestamps_sha256, fixture.currentEvidence.word_timestamps_sha256);
  assert.equal(job.evidence.word_timestamps_size_bytes, fixture.currentEvidence.word_timestamps_size_bytes);
  assert.deepEqual(job.evidence.selected_materialised_motion_clip_ids, selectedClips.map((clip) => clip.id));
  assert.deepEqual(job.evidence.materialised_motion_clip_paths, selectedClips.map((clip) => clip.path));
  assert.equal(job.evidence.materialised_motion_clip_count, 4);
  assert.equal(job.evidence.distinct_motion_family_count, 4);
  assert.deepEqual(job.evidence.stale_materialised_motion_clip_paths, []);
  assert.equal(job.evidence.audio_fingerprint_matches_render, undefined);
  assert.equal(job.evidence.word_timestamps_fingerprint_matches_render, undefined);
  for (const clip of selectedClips) {
    assert.equal(
      job.evidence.materialised_motion_clip_mtimes[clip.path],
      (await fs.stat(clip.path)).mtimeMs,
    );
  }

  assert.equal(await fs.readFile(path.join(targetArtifactDir, "package-marker.txt"), "utf8"), "copy-me");
  assert.equal(await fs.pathExists(targetOutputPath), false, "old final render must not be cloned");
  assert.equal(await fs.pathExists(targetManifestPath), false, "old render manifest must not be cloned");
  const clonedMotion = await fs.readJson(path.join(targetArtifactDir, "materialised_motion_clips.json"));
  assert.deepEqual(clonedMotion.clips.map((clip) => clip.id), selectedClips.map((clip) => clip.id));
  assert.deepEqual(clonedMotion.materialised_clips.map((clip) => clip.id), selectedClips.map((clip) => clip.id));
  assert.equal(clonedMotion.clips.some((clip) => clip.id === "old-clip"), false);
  assert.equal(clonedMotion.clip_count, 4);
  assert.equal(clonedMotion.distinct_motion_family_count, 4);
  assert.equal(await fs.pathExists(result.reportPath), true);
});

test("accepts narration rights whose explicit asset type is narration audio", async (t) => {
  const fixture = await makeFixture(t);
  const rightsPath = path.join(fixture.sourceArtifactDir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  const narration = rights.records.find(
    (record) => record.asset_id === `${fixture.storyId}_audio_path`,
  );
  narration.kind = "narration";
  narration.asset_type = "narration_audio";
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const result = await repairFlagshipRenderWorkOrder({
    sourceWorkOrderPath: fixture.sourceWorkOrderPath,
    currentEvidencePath: fixture.currentEvidencePath,
    workspaceDir: fixture.workspaceDir,
    generatedAt: "2026-07-15T12:00:00.000Z",
  });

  assert.equal(result.report.status, "READY_FOR_LOCAL_RENDER");
  const clonedRights = await fs.readJson(
    path.join(fixture.workspaceDir, "artifacts", fixture.storyId, "rights_ledger.json"),
  );
  const clonedNarration = clonedRights.records.find(
    (record) => record.asset_id === `${fixture.storyId}_audio_path`,
  );
  assert.equal(clonedNarration.kind, "audio");
  assert.equal(clonedNarration.asset_type, "narration_audio");
});

test("fails closed when current ElevenLabs narration is labelled as local TTS in source rights", async (t) => {
  const fixture = await makeFixture(t);
  const timestampDocument = await fs.readJson(fixture.timestampsPath);
  timestampDocument.meta.provider = "elevenlabs";
  const timestampBytes = Buffer.from(`${JSON.stringify(timestampDocument, null, 2)}\n`);
  await fs.writeFile(fixture.timestampsPath, timestampBytes);
  fixture.currentEvidence.word_timestamps_sha256 = sha256Buffer(timestampBytes);
  fixture.currentEvidence.word_timestamps_size_bytes = timestampBytes.length;
  await fs.writeJson(fixture.currentEvidencePath, fixture.currentEvidence, { spaces: 2 });

  const rightsPath = path.join(fixture.sourceArtifactDir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  const narration = rights.records.find(
    (record) => record.asset_id === `${fixture.storyId}_audio_path`,
  );
  narration.source_url = `local://pulse-local-tts/${fixture.storyId}`;
  narration.source_type = "local_tts_voice";
  narration.provider_id = "local_tts";
  narration.licence_basis = "owned_local_voice_model";
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  await assert.rejects(
    () => repairFlagshipRenderWorkOrder({
      sourceWorkOrderPath: fixture.sourceWorkOrderPath,
      currentEvidencePath: fixture.currentEvidencePath,
      workspaceDir: fixture.workspaceDir,
      generatedAt: "2026-07-15T12:00:00.000Z",
    }),
    /source_narration_rights_provider_mismatch:local_tts:elevenlabs/,
  );
  assert.equal(await fs.pathExists(fixture.workspaceDir), false);
});

test("fails closed when current ElevenLabs narration is labelled as local TTS in the source audio manifest", async (t) => {
  const fixture = await makeFixture(t);
  const timestampDocument = await fs.readJson(fixture.timestampsPath);
  timestampDocument.meta.provider = "elevenlabs";
  const timestampBytes = Buffer.from(`${JSON.stringify(timestampDocument, null, 2)}\n`);
  await fs.writeFile(fixture.timestampsPath, timestampBytes);
  fixture.currentEvidence.word_timestamps_sha256 = sha256Buffer(timestampBytes);
  fixture.currentEvidence.word_timestamps_size_bytes = timestampBytes.length;
  await fs.writeJson(fixture.currentEvidencePath, fixture.currentEvidence, { spaces: 2 });

  const audioManifestPath = path.join(fixture.sourceArtifactDir, "audio_manifest.json");
  const audioManifest = await fs.readJson(audioManifestPath);
  audioManifest.voice_provider = "local_tts";
  await fs.writeJson(audioManifestPath, audioManifest, { spaces: 2 });

  await assert.rejects(
    () => repairFlagshipRenderWorkOrder({
      sourceWorkOrderPath: fixture.sourceWorkOrderPath,
      currentEvidencePath: fixture.currentEvidencePath,
      workspaceDir: fixture.workspaceDir,
      generatedAt: "2026-07-15T12:00:00.000Z",
    }),
    /source_audio_manifest_provider_mismatch:local_tts:elevenlabs/,
  );
  assert.equal(await fs.pathExists(fixture.workspaceDir), false);
});

test("treats the local timestamp provider alias as the governed local TTS provider", async (t) => {
  const fixture = await makeFixture(t);
  const timestampDocument = await fs.readJson(fixture.timestampsPath);
  timestampDocument.meta.provider = "local";
  timestampDocument.meta.source = "local-tts-server";
  const timestampBytes = Buffer.from(`${JSON.stringify(timestampDocument, null, 2)}\n`);
  await fs.writeFile(fixture.timestampsPath, timestampBytes);
  fixture.currentEvidence.word_timestamps_sha256 = sha256Buffer(timestampBytes);
  fixture.currentEvidence.word_timestamps_size_bytes = timestampBytes.length;
  await fs.writeJson(fixture.currentEvidencePath, fixture.currentEvidence, { spaces: 2 });

  const audioManifestPath = path.join(fixture.sourceArtifactDir, "audio_manifest.json");
  const audioManifest = await fs.readJson(audioManifestPath);
  audioManifest.voice_provider = "local_tts";
  await fs.writeJson(audioManifestPath, audioManifest, { spaces: 2 });

  const rightsPath = path.join(fixture.sourceArtifactDir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  const narration = rights.records.find(
    (record) => record.asset_id === `${fixture.storyId}_audio_path`,
  );
  narration.source_url = `local://pulse-local-tts/${fixture.storyId}`;
  narration.source_type = "local_tts_voice";
  narration.provider_id = "pulse_local_tts";
  narration.licence_basis = "owned_local_voice_model";
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const result = await repairFlagshipRenderWorkOrder({
    sourceWorkOrderPath: fixture.sourceWorkOrderPath,
    currentEvidencePath: fixture.currentEvidencePath,
    workspaceDir: fixture.workspaceDir,
  });

  assert.equal(result.report.status, "READY_FOR_LOCAL_RENDER");
});

test("repairs the cloned audio manifest from the current hash-bound provider lineage", async (t) => {
  const fixture = await makeFixture(t);
  const timestampDocument = await fs.readJson(fixture.timestampsPath);
  timestampDocument.meta.provider = "elevenlabs";
  timestampDocument.meta.wordTimestampSource = "local_whisper_word_alignment";
  timestampDocument.meta.timestampWhisperAlignment = {
    repaired: true,
    strategy: "local_whisper_word_alignment",
    transcript: "Current evidence",
  };
  const timestampBytes = Buffer.from(`${JSON.stringify(timestampDocument, null, 2)}\n`);
  await fs.writeFile(fixture.timestampsPath, timestampBytes);
  fixture.currentEvidence.word_timestamps_sha256 = sha256Buffer(timestampBytes);
  fixture.currentEvidence.word_timestamps_size_bytes = timestampBytes.length;
  await fs.writeJson(fixture.currentEvidencePath, fixture.currentEvidence, { spaces: 2 });

  const audioManifestPath = path.join(fixture.sourceArtifactDir, "audio_manifest.json");
  const audioManifest = await fs.readJson(audioManifestPath);
  audioManifest.voice_provider = "elevenlabs";
  audioManifest.provider_id = "elevenlabs";
  await fs.writeJson(audioManifestPath, audioManifest, { spaces: 2 });

  const result = await repairFlagshipRenderWorkOrder({
    sourceWorkOrderPath: fixture.sourceWorkOrderPath,
    currentEvidencePath: fixture.currentEvidencePath,
    workspaceDir: fixture.workspaceDir,
    generatedAt: "2026-07-15T12:00:00.000Z",
  });

  const repairedAudio = await fs.readJson(
    path.join(result.workOrder.jobs[0].artifact_dir, "audio_manifest.json"),
  );
  assert.equal(repairedAudio.voice_provider, "elevenlabs");
  assert.equal(repairedAudio.provider_id, "elevenlabs");
  assert.equal(repairedAudio.tts_provider, "elevenlabs");
  assert.equal(repairedAudio.transcript, "Current evidence");
  assert.equal(repairedAudio.word_timestamp_count, 2);
  assert.equal(repairedAudio.word_timestamp_source, "local_whisper_word_alignment");
  assert.deepEqual(
    repairedAudio.timestamp_whisper_alignment,
    timestampDocument.meta.timestampWhisperAlignment,
  );
});

test("fails closed when source narration rights do not bind to the current audio bytes", async (t) => {
  const fixture = await makeFixture(t);
  const rightsPath = path.join(fixture.sourceArtifactDir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  const narration = rights.records.find(
    (record) => record.asset_id === `${fixture.storyId}_audio_path`,
  );
  narration.asset_sha256 = "0".repeat(64);
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  await assert.rejects(
    () => repairFlagshipRenderWorkOrder({
      sourceWorkOrderPath: fixture.sourceWorkOrderPath,
      currentEvidencePath: fixture.currentEvidencePath,
      workspaceDir: fixture.workspaceDir,
      generatedAt: "2026-07-15T12:00:00.000Z",
    }),
    /source_narration_rights_hash_mismatch/,
  );
  assert.equal(await fs.pathExists(fixture.workspaceDir), false);
});

test("accepts only the expected missing-manifest pre-render state and restores the governed target contract", async (t) => {
  const fixture = await makeFixture(t);
  const sourceWorkOrder = await fs.readJson(fixture.sourceWorkOrderPath);
  const sourceJob = sourceWorkOrder.jobs.find((job) => job.story_id === fixture.storyId);
  sourceJob.blockers = ["render_manifest_missing"];
  sourceJob.target_render_manifest = {
    renderer: "visual_v4_production",
    output: "visual_v4_render.mp4",
    local_promotion_only: true,
  };
  const renderAction = sourceJob.actions.find(
    (action) => action.action_id === "run_visual_v4_production_render",
  );
  renderAction.target_render_manifest = structuredClone(sourceJob.target_render_manifest);
  renderAction.output_expectations = [
    "render_manifest.json:final_publish_render=true",
    "render_manifest.json:visual_tier=production_v4_motion",
  ];
  await fs.writeJson(fixture.sourceWorkOrderPath, sourceWorkOrder);

  const result = await repairFlagshipRenderWorkOrder({
    sourceWorkOrderPath: fixture.sourceWorkOrderPath,
    currentEvidencePath: fixture.currentEvidencePath,
    workspaceDir: fixture.workspaceDir,
  });

  const repaired = await fs.readJson(result.workOrderPath);
  assert.deepEqual(repaired.jobs[0].blockers, []);
  assert.equal(repaired.jobs[0].target_render_manifest.renderer, "visual_v4_production");
  assert.equal(repaired.jobs[0].target_render_manifest.visual_tier, "production_v4_motion");
  assert.equal(repaired.jobs[0].target_render_manifest.final_publish_render, true);
  assert.equal(repaired.jobs[0].target_render_manifest.local_promotion_only, true);
});

test("accepts expected missing final outputs on an otherwise ready forced governed pre-render job", async (t) => {
  const fixture = await makeFixture(t);
  const sourceWorkOrder = await fs.readJson(fixture.sourceWorkOrderPath);
  const sourceJob = sourceWorkOrder.jobs.find((job) => job.story_id === fixture.storyId);
  sourceJob.blockers = ["final_mp4_missing", "render_manifest_missing"];
  sourceJob.force_final_render = true;
  const renderAction = sourceJob.actions.find(
    (action) => action.action_id === "run_visual_v4_production_render",
  );
  renderAction.output_expectations = [
    "render_manifest.json:final_publish_render=true",
    "render_manifest.json:visual_tier=production_v4_motion",
  ];
  await fs.writeJson(fixture.sourceWorkOrderPath, sourceWorkOrder);

  const result = await repairFlagshipRenderWorkOrder({
    sourceWorkOrderPath: fixture.sourceWorkOrderPath,
    currentEvidencePath: fixture.currentEvidencePath,
    workspaceDir: fixture.workspaceDir,
  });

  const repaired = await fs.readJson(result.workOrderPath);
  assert.deepEqual(repaired.jobs[0].blockers, []);
  assert.equal(repaired.jobs[0].status, "ready_for_final_render_job");
  assert.equal(repaired.jobs[0].force_final_render, true);
  assert.equal(repaired.jobs[0].target_render_manifest.renderer, "visual_v4_production");
  assert.equal(repaired.jobs[0].target_render_manifest.visual_tier, "production_v4_motion");
  assert.equal(repaired.jobs[0].target_render_manifest.final_publish_render, true);
});

test("accepts expected missing final outputs on an explicitly ready governed pre-render job", async (t) => {
  const fixture = await makeFixture(t);
  const sourceWorkOrder = await fs.readJson(fixture.sourceWorkOrderPath);
  const sourceJob = sourceWorkOrder.jobs.find((job) => job.story_id === fixture.storyId);
  sourceJob.blockers = ["final_mp4_missing", "render_manifest_missing"];
  sourceJob.force_final_render = false;
  const renderAction = sourceJob.actions.find(
    (action) => action.action_id === "run_visual_v4_production_render",
  );
  renderAction.status = "ready_after_inputs";
  renderAction.output_expectations = [
    "render_manifest.json:final_publish_render=true",
    "render_manifest.json:visual_tier=production_v4_motion",
  ];
  await fs.writeJson(fixture.sourceWorkOrderPath, sourceWorkOrder);

  const result = await repairFlagshipRenderWorkOrder({
    sourceWorkOrderPath: fixture.sourceWorkOrderPath,
    currentEvidencePath: fixture.currentEvidencePath,
    workspaceDir: fixture.workspaceDir,
  });

  const repaired = await fs.readJson(result.workOrderPath);
  assert.deepEqual(repaired.jobs[0].blockers, []);
  assert.equal(repaired.jobs[0].status, "ready_for_final_render_job");
  assert.equal(repaired.jobs[0].target_render_manifest.renderer, "visual_v4_production");
  assert.equal(repaired.jobs[0].target_render_manifest.visual_tier, "production_v4_motion");
  assert.equal(repaired.jobs[0].target_render_manifest.final_publish_render, true);
});

test("accepts a governed render target declared only by the unique production action", async (t) => {
  const fixture = await makeFixture(t);
  const workOrder = await fs.readJson(fixture.sourceWorkOrderPath);
  const sourceJob = workOrder.jobs.find((job) => job.story_id === fixture.storyId);
  delete sourceJob.target_render_manifest;
  await fs.writeJson(fixture.sourceWorkOrderPath, workOrder, { spaces: 2 });

  const result = await repairFlagshipRenderWorkOrder({
    sourceWorkOrderPath: fixture.sourceWorkOrderPath,
    currentEvidencePath: fixture.currentEvidencePath,
    workspaceDir: fixture.workspaceDir,
    generatedAt: "2026-07-15T12:05:00.000Z",
  });

  const repaired = await fs.readJson(result.workOrderPath);
  assert.equal(repaired.jobs[0].target_render_manifest.renderer, "visual_v4_production");
  assert.equal(repaired.jobs[0].target_render_manifest.visual_tier, "production_v4_motion");
  assert.equal(repaired.jobs[0].target_render_manifest.final_publish_render, true);
});

test("accepts current Whisper timestamp JSON with a UTF-8 byte-order mark", async (t) => {
  const fixture = await makeFixture(t);
  const timestampBytes = await fs.readFile(fixture.timestampsPath);
  const bomTimestampBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), timestampBytes]);
  await fs.writeFile(fixture.timestampsPath, bomTimestampBytes);
  fixture.currentEvidence.word_timestamps_sha256 = sha256Buffer(bomTimestampBytes);
  fixture.currentEvidence.word_timestamps_size_bytes = bomTimestampBytes.length;
  await fs.writeJson(fixture.currentEvidencePath, fixture.currentEvidence, { spaces: 2 });

  const result = await repairFlagshipRenderWorkOrder({
    sourceWorkOrderPath: fixture.sourceWorkOrderPath,
    currentEvidencePath: fixture.currentEvidencePath,
    workspaceDir: fixture.workspaceDir,
    generatedAt: "2026-07-15T12:06:00.000Z",
  });

  assert.equal(result.report.status, "READY_FOR_LOCAL_RENDER");
  assert.equal(result.workOrder.jobs[0].evidence.word_timestamps_sha256, sha256Buffer(bomTimestampBytes));
});

test("treats compact display tokens as equivalent to strict Whisper letter-digit rows", async (t) => {
  const fixture = await makeFixture(t);
  const displayScript = "Choose 4K or 1080p.";
  await fs.writeJson(path.join(fixture.sourceArtifactDir, "canonical_story_manifest.json"), {
    story_id: fixture.storyId,
    selected_title: "Current Flagship Story",
    narration_script: displayScript,
    tts_script: displayScript,
  });
  const timestampPayload = {
    meta: {
      source: "local_whisper_word_alignment",
      display_text: displayScript,
      spoken_text: displayScript,
    },
    words: [
      { word: "Choose", start: 0, end: 0.1 },
      { word: "4", start: 0.1, end: 0.2 },
      { word: "K", start: 0.2, end: 0.3 },
      { word: "or", start: 0.3, end: 0.4 },
      { word: "1080", start: 0.4, end: 0.5 },
      { word: "p", start: 0.5, end: 0.6 },
    ],
  };
  const timestampBytes = Buffer.from(`${JSON.stringify(timestampPayload, null, 2)}\n`);
  await fs.writeFile(fixture.timestampsPath, timestampBytes);
  fixture.currentEvidence.word_timestamps_sha256 = sha256Buffer(timestampBytes);
  fixture.currentEvidence.word_timestamps_size_bytes = timestampBytes.length;
  await fs.writeJson(fixture.currentEvidencePath, fixture.currentEvidence, { spaces: 2 });

  const result = await repairFlagshipRenderWorkOrder({
    sourceWorkOrderPath: fixture.sourceWorkOrderPath,
    currentEvidencePath: fixture.currentEvidencePath,
    workspaceDir: fixture.workspaceDir,
    generatedAt: "2026-07-15T12:07:00.000Z",
  });

  assert.equal(result.report.status, "READY_FOR_LOCAL_RENDER");
});

test("treats an ASR numeral as equivalent to the approved spoken number word", async (t) => {
  const fixture = await makeFixture(t);
  const script = "The run starts with thirty seconds.";
  await fs.writeJson(path.join(fixture.sourceArtifactDir, "canonical_story_manifest.json"), {
    story_id: fixture.storyId,
    selected_title: "Thirty Seconds Changes Every Run",
    narration_script: script,
    spoken_narration_script: script,
    tts_script: script,
  });
  const timestampPayload = {
    meta: {
      source: "local_whisper_word_alignment",
      wordTimestampSource: "local_whisper_word_alignment",
      display_text: script,
      spoken_text: script,
      transcript: script,
      timestampWhisperAlignment: {
        repaired: true,
        strategy: "local_whisper_word_alignment",
        script_coverage_ratio: 1,
        script_inserted_actual_word_count: 0,
        script_trailing_actual_word_count: 0,
      },
    },
    words: [
      { word: "The", start: 0, end: 0.12 },
      { word: "run", start: 0.12, end: 0.3 },
      { word: "starts", start: 0.3, end: 0.5 },
      { word: "with", start: 0.5, end: 0.64 },
      { word: "30", start: 0.64, end: 0.88 },
      { word: "seconds.", start: 0.88, end: 1.16 },
    ],
  };
  const timestampBytes = Buffer.from(`${JSON.stringify(timestampPayload, null, 2)}\n`);
  await fs.writeFile(fixture.timestampsPath, timestampBytes);
  fixture.currentEvidence.word_timestamps_sha256 = sha256Buffer(timestampBytes);
  fixture.currentEvidence.word_timestamps_size_bytes = timestampBytes.length;
  await fs.writeJson(fixture.currentEvidencePath, fixture.currentEvidence, { spaces: 2 });

  const result = await repairFlagshipRenderWorkOrder({
    sourceWorkOrderPath: fixture.sourceWorkOrderPath,
    currentEvidencePath: fixture.currentEvidencePath,
    workspaceDir: fixture.workspaceDir,
    generatedAt: "2026-07-17T13:40:00.000Z",
  });

  assert.equal(result.report.status, "READY_FOR_LOCAL_RENDER");
});

test("keeps an owned generated source card without counting it as a genuine video source", async (t) => {
  const fixture = await makeFixture(t);
  const cardPath = path.join(path.dirname(fixture.motionManifestPath), "owned-source-card.mp4");
  const cardBytes = Buffer.alloc(640, 0x44);
  await fs.writeFile(cardPath, cardBytes);
  const motionManifest = await fs.readJson(fixture.motionManifestPath);
  const card = {
    id: "owned-source-card",
    path: cardPath,
    source_family: "hyperframes-owned-source-card",
    media_kind: "generated_card",
    source_type: "generated_card",
    rights_basis: "owned_generated_editorial_motion_graphic",
    rights_grant: true,
    sha256: sha256Buffer(cardBytes),
    size_bytes: cardBytes.length,
  };
  motionManifest.clips.push(card);
  motionManifest.materialised_clips.push(card);
  motionManifest.clip_count += 1;
  motionManifest.distinct_motion_family_count += 1;
  await fs.writeJson(fixture.motionManifestPath, motionManifest, { spaces: 2 });
  await fixture.writeMotionRights(motionManifest.clips);
  fixture.currentEvidence.selected_materialised_motion_clip_ids.push(card.id);
  fixture.currentEvidence.materialised_motion_manifest_sha256 = await sha256File(
    fixture.motionManifestPath,
  );
  await fs.writeJson(fixture.currentEvidencePath, fixture.currentEvidence, { spaces: 2 });

  const result = await repairFlagshipRenderWorkOrder({
    sourceWorkOrderPath: fixture.sourceWorkOrderPath,
    currentEvidencePath: fixture.currentEvidencePath,
    workspaceDir: fixture.workspaceDir,
    generatedAt: "2026-07-15T12:08:00.000Z",
  });

  assert.equal(result.report.status, "READY_FOR_LOCAL_RENDER");
  assert.equal(result.report.selected_materialised_motion_clip_count, 5);
  assert.equal(result.report.distinct_genuine_base_source_count, 4);
});

test("clones current narration lineage and invalidates stale derived media evidence", async (t) => {
  const fixture = await makeFixture(t);
  const canonicalPath = path.join(fixture.sourceArtifactDir, "canonical_story_manifest.json");
  const staleNarrationManifestPath = path.join(fixture.sourceArtifactDir, "narration_manifest.json");
  const staleCaptionManifestPath = path.join(fixture.sourceArtifactDir, "caption_manifest.json");
  const staleCaptionPath = path.join(fixture.sourceArtifactDir, "captions.srt");
  const staleRenderStoryPath = path.join(fixture.sourceArtifactDir, "visual_v4_render_story.json");
  const staleFlagshipDir = path.join(fixture.sourceArtifactDir, "flagship");
  const stalePlatformVariantsDir = path.join(fixture.sourceArtifactDir, "platform_variants");
  const staleProductionReportDir = path.join(fixture.sourceArtifactDir, "production-report");
  const staleDecodedVisualDir = path.join(fixture.sourceArtifactDir, "qa", "decoded-visual");
  const displayScript = "Black Flag Resynced is back.";
  const staleSpokenScript = "Black Flag re synced is back.";
  const currentSpokenScript = "Black Flag Resynced is back.";

  await fs.writeJson(canonicalPath, {
    story_id: fixture.storyId,
    selected_title: "Black Flag Resynced",
    narration_script: displayScript,
    tts_script: staleSpokenScript,
  });
  await fs.writeJson(staleNarrationManifestPath, {
    story_id: fixture.storyId,
    status: "ready",
    verdict: "PASS",
    spoken_text: staleSpokenScript,
    word_timestamps_path: "flagship/word_timestamps.json",
    word_timestamps_sha256: "a".repeat(64),
  });
  await fs.writeJson(staleCaptionManifestPath, {
    story_id: fixture.storyId,
    status: "ready",
    verdict: "PASS",
    caption_srt_path: "captions.srt",
  });
  await fs.writeFile(staleCaptionPath, "1\n00:00:00,000 --> 00:00:01,000\nStale caption\n");
  await fs.writeJson(staleRenderStoryPath, {
    story_id: fixture.storyId,
    visual_v4_bridge_video_clips: [{ id: "old-clip", path: "C:/old/clip.mp4" }],
  });
  await fs.ensureDir(staleFlagshipDir);
  await fs.writeFile(path.join(staleFlagshipDir, "final_audio.mp3"), Buffer.alloc(1_024, 0x22));
  await fs.writeJson(path.join(staleFlagshipDir, "word_timestamps.json"), {
    words: [{ word: "stale", start: 0, end: 0.2 }],
  });
  await fs.writeJson(path.join(staleFlagshipDir, "generation_manifest.json"), {
    verdict: "GREEN",
  });
  await fs.ensureDir(stalePlatformVariantsDir);
  await fs.writeFile(path.join(stalePlatformVariantsDir, "instagram_reels.mp4"), "stale variant");
  await fs.ensureDir(staleProductionReportDir);
  await fs.writeJson(path.join(staleProductionReportDir, "production_render_materialization_report.json"), {
    status: "GREEN",
    final_render_path: "C:/old/visual_v4_render.mp4",
  });
  await fs.ensureDir(staleDecodedVisualDir);
  await fs.writeJson(path.join(staleDecodedVisualDir, "decoded_visual_gate.json"), {
    status: "pass",
    final_render_path: "C:/old/visual_v4_render.mp4",
  });

  const timestampPayload = {
    meta: {
      source: "local_whisper_word_alignment",
      display_text: displayScript,
      spoken_text: currentSpokenScript,
      transcript: currentSpokenScript,
    },
    words: [
      { word: "Black", start: 0, end: 0.2 },
      { word: "Flag", start: 0.2, end: 0.4 },
      { word: "Resynced", start: 0.4, end: 0.7 },
      { word: "is", start: 0.7, end: 0.8 },
      { word: "back.", start: 0.8, end: 1.0 },
    ],
  };
  const timestampBytes = Buffer.from(`${JSON.stringify(timestampPayload, null, 2)}\n`);
  await fs.writeFile(fixture.timestampsPath, timestampBytes);
  fixture.currentEvidence.word_timestamps_sha256 = sha256Buffer(timestampBytes);
  fixture.currentEvidence.word_timestamps_size_bytes = timestampBytes.length;
  await fs.writeJson(fixture.currentEvidencePath, fixture.currentEvidence);

  const sourceAudioBefore = await fs.readFile(path.join(staleFlagshipDir, "final_audio.mp3"));
  const sourceCanonicalBefore = await fs.readJson(canonicalPath);
  const result = await repairFlagshipRenderWorkOrder({
    sourceWorkOrderPath: fixture.sourceWorkOrderPath,
    currentEvidencePath: fixture.currentEvidencePath,
    sourceArtifactDir: fixture.sourceArtifactDir,
    workspaceDir: fixture.workspaceDir,
    generatedAt: "2026-07-15T12:15:00.000Z",
  });

  const repaired = await fs.readJson(result.workOrderPath);
  const artifactDir = repaired.jobs[0].artifact_dir;
  const packagedAudioPath = path.join(artifactDir, "flagship", "final_audio.mp3");
  const packagedTimestampsPath = path.join(artifactDir, "flagship", "word_timestamps.json");
  const clonedCanonical = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));

  assert.equal(clonedCanonical.narration_script, displayScript);
  assert.equal(clonedCanonical.tts_script, currentSpokenScript);
  assert.equal(clonedCanonical.spoken_narration_script, currentSpokenScript);
  assert.equal(await sha256File(packagedAudioPath), fixture.currentEvidence.narration_audio_sha256);
  assert.equal(await sha256File(packagedTimestampsPath), fixture.currentEvidence.word_timestamps_sha256);
  assert.equal(repaired.jobs[0].evidence.narration_audio_path, packagedAudioPath);
  assert.equal(repaired.jobs[0].evidence.word_timestamps_path, packagedTimestampsPath);
  assert.equal(await fs.pathExists(path.join(artifactDir, "narration_manifest.json")), false);
  assert.equal(await fs.pathExists(path.join(artifactDir, "caption_manifest.json")), false);
  assert.equal(await fs.pathExists(path.join(artifactDir, "captions.srt")), false);
  assert.equal(await fs.pathExists(path.join(artifactDir, "visual_v4_render_story.json")), false);
  assert.equal(await fs.pathExists(path.join(artifactDir, "flagship", "generation_manifest.json")), false);
  assert.equal(await fs.pathExists(path.join(artifactDir, "platform_variants")), false);
  assert.equal(await fs.pathExists(path.join(artifactDir, "production-report")), false);
  assert.equal(await fs.pathExists(path.join(artifactDir, "qa", "decoded-visual")), false);
  assert.deepEqual(result.report.invalidated_stale_derived_evidence, [
    "narration_manifest.json",
    "caption_manifest.json",
    "captions.srt",
    "visual_v4_render_story.json",
    "flagship",
    "platform_variants",
    "production-report",
    "qa/decoded-visual",
  ]);

  assert.deepEqual(await fs.readJson(canonicalPath), sourceCanonicalBefore);
  assert.deepEqual(await fs.readFile(path.join(staleFlagshipDir, "final_audio.mp3")), sourceAudioBefore);
  assert.equal(await fs.pathExists(staleNarrationManifestPath), true);
  assert.equal(await fs.pathExists(staleCaptionManifestPath), true);
  assert.equal(await fs.pathExists(stalePlatformVariantsDir), true);
});

test("reports ten Black Flag segment families as seven genuine base sources", async (t) => {
  const fixture = await makeFixture(t);
  const motionManifest = await fs.readJson(fixture.motionManifestPath);
  const duplicateIdentityByIndex = {
    6: { base_source_asset_id: "black-flag-base-1" },
    7: { source_master_sha256: sha256Buffer(Buffer.from("black-flag-master-2")) },
    8: {
      canonical_source_url:
        "https://www.media.example.test/black-flag/master-3?utm_source=repair&t=90",
    },
    9: { base_source_asset_id: "black-flag-base-6" },
    10: { canonical_source_url: "https://media.example.test/black-flag/master-7" },
  };

  for (let index = 6; index <= 10; index += 1) {
    const clipPath = path.join(path.dirname(fixture.motionManifestPath), `fresh-clip-${index}.mp4`);
    const clipBytes = Buffer.alloc(512 + index, index);
    await fs.writeFile(clipPath, clipBytes);
    const timestamp = new Date(`2026-07-15T10:${index}:00.000Z`);
    await fs.utimes(clipPath, timestamp, timestamp);
    motionManifest.clips.push({
      id: `fresh-clip-${index}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_family: `current-family-${index}`,
      motion_family: `current-family-${index}`,
      ...duplicateIdentityByIndex[index],
      sha256: sha256Buffer(clipBytes),
      media_kind: "direct_video",
      source_type: "official_trailer",
      counts_towards_motion_readiness: true,
      materialized: true,
    });
  }
  motionManifest.materialised_clips = motionManifest.clips;
  motionManifest.clip_count = motionManifest.clips.length;
  motionManifest.distinct_motion_family_count = motionManifest.clips.length;
  motionManifest.minimum_requirements = { min_genuine_base_sources: 7 };
  await fs.writeJson(fixture.motionManifestPath, motionManifest);
  await fixture.writeMotionRights(motionManifest.clips);

  const evidence = await fs.readJson(fixture.currentEvidencePath);
  evidence.selected_materialised_motion_clip_ids = motionManifest.clips.map((clip) => clip.id);
  evidence.materialised_motion_manifest_sha256 = await sha256File(fixture.motionManifestPath);
  await fs.writeJson(fixture.currentEvidencePath, evidence);

  const result = await repairFlagshipRenderWorkOrder({
    sourceWorkOrderPath: fixture.sourceWorkOrderPath,
    currentEvidencePath: fixture.currentEvidencePath,
    workspaceDir: fixture.workspaceDir,
    generatedAt: "2026-07-15T12:05:00.000Z",
  });
  const repairedJob = result.workOrder.jobs[0];
  const clonedMotion = await fs.readJson(
    path.join(repairedJob.artifact_dir, "materialised_motion_clips.json"),
  );

  assert.equal(repairedJob.evidence.distinct_motion_family_count, 10);
  assert.equal(repairedJob.evidence.distinct_genuine_base_source_count, 7);
  assert.equal(repairedJob.evidence.genuine_base_source_identities.length, 7);
  assert.deepEqual(
    repairedJob.evidence.genuine_base_source_identities
      .map((identity) => identity.window_count)
      .sort((left, right) => left - right),
    [1, 1, 1, 1, 2, 2, 2],
  );
  assert.equal(clonedMotion.distinct_motion_family_count, 10);
  assert.equal(clonedMotion.distinct_genuine_base_source_count, 7);
  assert.equal(clonedMotion.genuine_base_source_identities.length, 7);
  assert.deepEqual(
    clonedMotion.distinct_source_families,
    clonedMotion.genuine_base_source_identities.map((identity) => identity.base_source_key),
  );
  assert.notDeepEqual(clonedMotion.distinct_source_families, clonedMotion.distinct_motion_families);
  assert.equal(
    clonedMotion.professional_source_diversity.observed_genuine_base_source_count,
    7,
  );
  assert.equal(clonedMotion.professional_source_diversity.input_source_count, 10);
  assert.equal(clonedMotion.minimum_requirements.min_genuine_base_sources, 7);
  assert.equal(
    repairedJob.evidence.professional_source_diversity.observed_genuine_base_source_count,
    7,
  );
  assert.equal(result.report.distinct_motion_family_count, 10);
  assert.equal(result.report.distinct_genuine_base_source_count, 7);
  assert.equal(result.report.minimum_required_genuine_base_sources, 7);
  assert.equal(result.report.genuine_base_source_identities.length, 7);
});

test("preserves the selector source-diversity floor as a repaired render requirement", async (t) => {
  const fixture = await makeFixture(t);
  const motionManifest = await fs.readJson(fixture.motionManifestPath);
  motionManifest.source_diversity = {
    strict_pass: true,
    metrics: {
      distinct_genuine_base_source_count: 5,
      required_genuine_base_source_count: 5,
    },
    professional_source_diversity: {
      status: "pass",
      strict_pass: true,
      required_genuine_base_source_count: 5,
      observed_genuine_base_source_count: 5,
    },
  };
  await fs.writeJson(fixture.motionManifestPath, motionManifest, { spaces: 2 });

  const evidence = await fs.readJson(fixture.currentEvidencePath);
  evidence.selected_materialised_motion_clip_ids = motionManifest.clips.map((clip) => clip.id);
  evidence.materialised_motion_manifest_sha256 = await sha256File(fixture.motionManifestPath);
  await fs.writeJson(fixture.currentEvidencePath, evidence, { spaces: 2 });

  const result = await repairFlagshipRenderWorkOrder({
    sourceWorkOrderPath: fixture.sourceWorkOrderPath,
    currentEvidencePath: fixture.currentEvidencePath,
    workspaceDir: fixture.workspaceDir,
  });

  const repairedJob = result.workOrder.jobs[0];
  const clonedMotion = await fs.readJson(
    path.join(repairedJob.artifact_dir, "materialised_motion_clips.json"),
  );
  assert.equal(result.report.minimum_required_genuine_base_sources, 5);
  assert.equal(
    repairedJob.evidence.professional_source_diversity.minimum_required_genuine_base_source_count,
    5,
  );
  assert.equal(clonedMotion.minimum_requirements.min_genuine_base_sources, 5);
});

test("fails closed when the selected genuine base sources miss the source job minimum", async (t) => {
  const fixture = await makeFixture(t);
  const sourceWorkOrder = await fs.readJson(fixture.sourceWorkOrderPath);
  const sourceJob = sourceWorkOrder.jobs.find((job) => job.story_id === fixture.storyId);
  sourceJob.required_genuine_base_source_count = 5;
  await fs.writeJson(fixture.sourceWorkOrderPath, sourceWorkOrder);

  await assert.rejects(
    () => repairFlagshipRenderWorkOrder({
      sourceWorkOrderPath: fixture.sourceWorkOrderPath,
      currentEvidencePath: fixture.currentEvidencePath,
      workspaceDir: fixture.workspaceDir,
    }),
    /selected_genuine_base_source_count_below_source_requirement:4\/5/,
  );
  assert.equal(await fs.pathExists(fixture.workspaceDir), false);
});

test("fails closed when a repaired flagship selects three scenes from one source at exactly 25 percent share", async (t) => {
  const fixture = await makeFixture(t);
  const clips = [];
  for (let sourceIndex = 0; sourceIndex < 4; sourceIndex += 1) {
    const sourceMasterSha256 = sha256Buffer(
      Buffer.from(`concentrated-source-${sourceIndex + 1}`),
    );
    for (let sceneIndex = 0; sceneIndex < 3; sceneIndex += 1) {
      const clipIndex = sourceIndex * 3 + sceneIndex + 1;
      const clipPath = path.join(
        path.dirname(fixture.motionManifestPath),
        `concentrated-source-${sourceIndex + 1}-scene-${sceneIndex + 1}.mp4`,
      );
      const clipBytes = Buffer.alloc(640 + clipIndex, clipIndex);
      await fs.writeFile(clipPath, clipBytes);
      clips.push({
        id: `concentrated-source-${sourceIndex + 1}-scene-${sceneIndex + 1}`,
        path: clipPath,
        local_materialized_path: clipPath,
        source_family: `concentrated-source-${sourceIndex + 1}-scene-${sceneIndex + 1}`,
        motion_family: `concentrated-source-${sourceIndex + 1}-scene-${sceneIndex + 1}`,
        source_master_sha256: sourceMasterSha256,
        canonical_source_url:
          `https://media.example.test/concentrated-source-${sourceIndex + 1}.mp4`,
        sha256: sha256Buffer(clipBytes),
        media_kind: "direct_video",
        source_type: "official_trailer",
        counts_towards_motion_readiness: true,
        materialized: true,
      });
    }
  }

  const motionManifest = await fs.readJson(fixture.motionManifestPath);
  motionManifest.clips = clips;
  motionManifest.materialised_clips = clips;
  motionManifest.clip_count = clips.length;
  motionManifest.distinct_motion_family_count = clips.length;
  await fs.writeJson(fixture.motionManifestPath, motionManifest);
  await fixture.writeMotionRights(clips);

  const evidence = await fs.readJson(fixture.currentEvidencePath);
  evidence.selected_materialised_motion_clip_ids = clips.map((clip) => clip.id);
  evidence.materialised_motion_manifest_sha256 = await sha256File(
    fixture.motionManifestPath,
  );
  await fs.writeJson(fixture.currentEvidencePath, evidence);

  await assert.rejects(
    () => repairFlagshipRenderWorkOrder({
      sourceWorkOrderPath: fixture.sourceWorkOrderPath,
      currentEvidencePath: fixture.currentEvidencePath,
      workspaceDir: fixture.workspaceDir,
    }),
    /selected_professional_source_diversity_blocked:professional_motion_source_concentration_above_floor/,
  );
  assert.equal(await fs.pathExists(fixture.workspaceDir), false);
});

test("does not treat segment source IDs or source-family labels as genuine base identities", async (t) => {
  const fixture = await makeFixture(t);
  const motionManifest = await fs.readJson(fixture.motionManifestPath);
  for (const [index, clip] of motionManifest.clips.slice(0, 4).entries()) {
    delete clip.base_source_asset_id;
    delete clip.source_master_sha256;
    delete clip.canonical_source_url;
    clip.source_id = `segment-source-${index + 1}`;
  }
  await fs.writeJson(fixture.motionManifestPath, motionManifest);

  const evidence = await fs.readJson(fixture.currentEvidencePath);
  evidence.materialised_motion_manifest_sha256 = await sha256File(fixture.motionManifestPath);
  await fs.writeJson(fixture.currentEvidencePath, evidence);

  await assert.rejects(
    () => repairFlagshipRenderWorkOrder({
      sourceWorkOrderPath: fixture.sourceWorkOrderPath,
      currentEvidencePath: fixture.currentEvidencePath,
      workspaceDir: fixture.workspaceDir,
    }),
    /selected_genuine_base_source_identity_rejected:fresh-clip-1:base_source_identity_missing/,
  );
  assert.equal(await fs.pathExists(fixture.workspaceDir), false);
});

test("rejects placeholder, synthetic and generated-only selected base identities", async (t) => {
  const scenarios = [
    {
      mutate(clip) {
        clip.base_source_asset_id = "placeholder-base-source";
        delete clip.source_master_sha256;
        delete clip.canonical_source_url;
      },
      expected: /selected_genuine_base_source_identity_rejected:fresh-clip-1:placeholder_base_source_rejected/,
    },
    {
      mutate(clip) {
        clip.synthetic = true;
        clip.motion_type = "synthetic_still_loop";
      },
      expected: /selected_genuine_base_source_identity_rejected:fresh-clip-1:synthetic_still_loop_base_source_rejected/,
    },
    {
      mutate(clip) {
        clip.source_identity = { generation_method: "generated_only" };
      },
      expected: /selected_genuine_base_source_identity_rejected:fresh-clip-1:generated_only_base_source_rejected/,
    },
  ];

  for (const scenario of scenarios) {
    const fixture = await makeFixture(t);
    const motionManifest = await fs.readJson(fixture.motionManifestPath);
    scenario.mutate(motionManifest.clips[0]);
    await fs.writeJson(fixture.motionManifestPath, motionManifest);

    const evidence = await fs.readJson(fixture.currentEvidencePath);
    evidence.materialised_motion_manifest_sha256 = await sha256File(fixture.motionManifestPath);
    await fs.writeJson(fixture.currentEvidencePath, evidence);

    const sourceWorkOrder = await fs.readJson(fixture.sourceWorkOrderPath);
    const sourceJob = sourceWorkOrder.jobs.find((job) => job.story_id === fixture.storyId);
    sourceJob.evidence.real_motion_input_readiness.direct_video_motion_clip_floor = 3;
    await fs.writeJson(fixture.sourceWorkOrderPath, sourceWorkOrder);

    await assert.rejects(
      () => repairFlagshipRenderWorkOrder({
        sourceWorkOrderPath: fixture.sourceWorkOrderPath,
        currentEvidencePath: fixture.currentEvidencePath,
        workspaceDir: fixture.workspaceDir,
      }),
      scenario.expected,
    );
    assert.equal(await fs.pathExists(fixture.workspaceDir), false);
  }
});

test("fails closed before creating the workspace when declared current hashes are stale", async (t) => {
  const fixture = await makeFixture(t);
  const evidence = await fs.readJson(fixture.currentEvidencePath);
  evidence.narration_audio_sha256 = "0".repeat(64);
  await fs.writeJson(fixture.currentEvidencePath, evidence);

  await assert.rejects(
    () => repairFlagshipRenderWorkOrder({
      sourceWorkOrderPath: fixture.sourceWorkOrderPath,
      currentEvidencePath: fixture.currentEvidencePath,
      workspaceDir: fixture.workspaceDir,
    }),
    /stale_hash:narration_audio/,
  );
  assert.equal(await fs.pathExists(fixture.workspaceDir), false);
});

test("fails closed when selector-style asset fingerprints do not match a selected clip", async (t) => {
  const fixture = await makeFixture(t);
  const motionManifest = await fs.readJson(fixture.motionManifestPath);
  const selectedClip = motionManifest.clips[0];
  selectedClip.asset_sha256 = selectedClip.sha256;
  selectedClip.asset_size_bytes = (await fs.stat(selectedClip.path)).size;
  delete selectedClip.sha256;
  const materialisedClip = motionManifest.materialised_clips.find(
    (clip) => clip.id === selectedClip.id,
  );
  materialisedClip.asset_sha256 = selectedClip.asset_sha256;
  materialisedClip.asset_size_bytes = selectedClip.asset_size_bytes;
  delete materialisedClip.sha256;
  await fs.writeJson(fixture.motionManifestPath, motionManifest, { spaces: 2 });

  const evidence = await fs.readJson(fixture.currentEvidencePath);
  evidence.materialised_motion_manifest_sha256 = await sha256File(fixture.motionManifestPath);
  await fs.writeJson(fixture.currentEvidencePath, evidence, { spaces: 2 });
  await fs.appendFile(selectedClip.path, Buffer.from("changed-after-selector-proof"));

  await assert.rejects(
    () => repairFlagshipRenderWorkOrder({
      sourceWorkOrderPath: fixture.sourceWorkOrderPath,
      currentEvidencePath: fixture.currentEvidencePath,
      workspaceDir: fixture.workspaceDir,
    }),
    /stale_hash:materialised_motion_clip:fresh-clip-1/,
  );
  assert.equal(await fs.pathExists(fixture.workspaceDir), false);
});

test("fails closed when a current evidence file is missing", async (t) => {
  const fixture = await makeFixture(t);
  const evidence = await fs.readJson(fixture.currentEvidencePath);
  evidence.word_timestamps_path = path.join(fixture.root, "missing-word-timestamps.json");
  await fs.writeJson(fixture.currentEvidencePath, evidence);

  await assert.rejects(
    () => repairFlagshipRenderWorkOrder({
      sourceWorkOrderPath: fixture.sourceWorkOrderPath,
      currentEvidencePath: fixture.currentEvidencePath,
      workspaceDir: fixture.workspaceDir,
    }),
    /missing_file:word_timestamps/,
  );
  assert.equal(await fs.pathExists(fixture.workspaceDir), false);
});

test("fails closed when selected clip IDs belong to old evidence", async (t) => {
  const fixture = await makeFixture(t);
  const evidence = await fs.readJson(fixture.currentEvidencePath);
  evidence.selected_materialised_motion_clip_ids = ["fresh-clip-1", "old-clip"];
  await fs.writeJson(fixture.currentEvidencePath, evidence);

  await assert.rejects(
    () => repairFlagshipRenderWorkOrder({
      sourceWorkOrderPath: fixture.sourceWorkOrderPath,
      currentEvidencePath: fixture.currentEvidencePath,
      workspaceDir: fixture.workspaceDir,
    }),
    /old_clip_id_not_in_current_evidence:old-clip/,
  );
  assert.equal(await fs.pathExists(fixture.workspaceDir), false);
});

test("fails closed when a selected current clip is missing on disk", async (t) => {
  const fixture = await makeFixture(t);
  await fs.remove(fixture.clips[1].path);

  await assert.rejects(
    () => repairFlagshipRenderWorkOrder({
      sourceWorkOrderPath: fixture.sourceWorkOrderPath,
      currentEvidencePath: fixture.currentEvidencePath,
      workspaceDir: fixture.workspaceDir,
    }),
    /missing_file:materialised_motion_clip:fresh-clip-2/,
  );
  assert.equal(await fs.pathExists(fixture.workspaceDir), false);
});

test("rejects every write target that escapes the isolated workspace", async (t) => {
  const fixture = await makeFixture(t);
  const escapedOutput = path.join(fixture.root, "escaped-render.mp4");

  await assert.rejects(
    () => repairFlagshipRenderWorkOrder({
      sourceWorkOrderPath: fixture.sourceWorkOrderPath,
      currentEvidencePath: fixture.currentEvidencePath,
      workspaceDir: fixture.workspaceDir,
      targetOutputPath: escapedOutput,
    }),
    /target_path_escapes_isolated_workspace:output_path/,
  );
  assert.equal(await fs.pathExists(fixture.workspaceDir), false);
  assert.equal(await fs.pathExists(escapedOutput), false);
});

test("does not turn a blocked source job into a renderable job", async (t) => {
  const fixture = await makeFixture(t);
  const workOrder = await fs.readJson(fixture.sourceWorkOrderPath);
  const job = workOrder.jobs.find((item) => item.story_id === fixture.storyId);
  job.status = "blocked_on_render_inputs";
  job.blockers = ["rights_ledger_missing"];
  await fs.writeJson(fixture.sourceWorkOrderPath, workOrder);

  await assert.rejects(
    () => repairFlagshipRenderWorkOrder({
      sourceWorkOrderPath: fixture.sourceWorkOrderPath,
      currentEvidencePath: fixture.currentEvidencePath,
      workspaceDir: fixture.workspaceDir,
    }),
    /source_render_job_not_ready:rights_ledger_missing/,
  );
  assert.equal(await fs.pathExists(fixture.workspaceDir), false);
});

test("repairs stale script audio blockers only when current governed evidence validates", async (t) => {
  const fixture = await makeFixture(t);
  const workOrder = await fs.readJson(fixture.sourceWorkOrderPath);
  const job = workOrder.jobs.find((item) => item.story_id === fixture.storyId);
  job.status = "blocked_on_render_inputs";
  job.blockers = ["narration_audio_missing", "word_timestamps_missing"];
  delete job.target_render_manifest.visual_tier;
  delete job.target_render_manifest.final_publish_render;
  job.actions[0].output_expectations = [
    "render_manifest.json:final_publish_render=true",
    "render_manifest.json:visual_tier=production_v4_motion",
  ];
  await fs.writeJson(fixture.sourceWorkOrderPath, workOrder);

  const result = await repairFlagshipRenderWorkOrder({
    sourceWorkOrderPath: fixture.sourceWorkOrderPath,
    currentEvidencePath: fixture.currentEvidencePath,
    workspaceDir: fixture.workspaceDir,
  });
  const repaired = await fs.readJson(result.workOrderPath);

  assert.equal(result.report.status, "READY_FOR_LOCAL_RENDER");
  assert.equal(repaired.jobs[0].status, "ready_for_final_render_job");
  assert.deepEqual(repaired.jobs[0].blockers, []);
  assert.equal(repaired.jobs[0].target_render_manifest.renderer, "visual_v4_production");
  assert.equal(repaired.jobs[0].target_render_manifest.visual_tier, "production_v4_motion");
  assert.equal(repaired.jobs[0].target_render_manifest.final_publish_render, true);
});

test("does not weaken the source direct-video motion floor", async (t) => {
  const fixture = await makeFixture(t);
  const motionManifest = await fs.readJson(fixture.motionManifestPath);
  for (const clip of motionManifest.clips.slice(0, 4)) {
    clip.media_kind = "generated_motion";
    clip.source_type = "owned_generated_motion";
    clip.rights_basis = "owned_generated_motion";
  }
  await fs.writeJson(fixture.motionManifestPath, motionManifest);
  const evidence = await fs.readJson(fixture.currentEvidencePath);
  evidence.materialised_motion_manifest_sha256 = await sha256File(fixture.motionManifestPath);
  await fs.writeJson(fixture.currentEvidencePath, evidence);

  await assert.rejects(
    () => repairFlagshipRenderWorkOrder({
      sourceWorkOrderPath: fixture.sourceWorkOrderPath,
      currentEvidencePath: fixture.currentEvidencePath,
      workspaceDir: fixture.workspaceDir,
    }),
    /selected_direct_motion_clip_count_below_source_requirement:0\/4/,
  );
  assert.equal(await fs.pathExists(fixture.workspaceDir), false);
});

test("fails closed when repeat-free selected motion cannot cover current narration", async (t) => {
  const fixture = await makeFixture(t);
  const sourceWorkOrder = await fs.readJson(fixture.sourceWorkOrderPath);
  const sourceJob = sourceWorkOrder.jobs.find((job) => job.story_id === fixture.storyId);
  sourceJob.target_render_manifest.visual_design_policy_version =
    "pulse_signature_repeat_free_v14";
  await fs.writeJson(fixture.sourceWorkOrderPath, sourceWorkOrder);

  const motionManifest = await fs.readJson(fixture.motionManifestPath);
  for (const clip of motionManifest.clips) clip.duration_s = 5;
  for (const clip of motionManifest.materialised_clips) clip.duration_s = 5;
  await fs.writeJson(fixture.motionManifestPath, motionManifest);
  fixture.currentEvidence.materialised_motion_manifest_sha256 = await sha256File(
    fixture.motionManifestPath,
  );
  await fs.writeJson(fixture.currentEvidencePath, fixture.currentEvidence);

  await assert.rejects(
    repairFlagshipRenderWorkOrder({
      sourceWorkOrderPath: fixture.sourceWorkOrderPath,
      currentEvidencePath: fixture.currentEvidencePath,
      workspaceDir: fixture.workspaceDir,
      generatedAt: "2026-07-15T12:30:00.000Z",
      ffprobeDurationImpl: (filePath) => (
        path.resolve(filePath) === path.resolve(fixture.narrationPath) ? 51.7 : 5
      ),
    }),
    /selected_motion_timeline_below_narration_duration/,
  );
  assert.equal(await fs.pathExists(fixture.workspaceDir), false);
});

test("records file-probed repeat-free timeline coverage in repaired evidence", async (t) => {
  const fixture = await makeFixture(t);
  const sourceWorkOrder = await fs.readJson(fixture.sourceWorkOrderPath);
  const sourceJob = sourceWorkOrder.jobs.find((job) => job.story_id === fixture.storyId);
  sourceJob.target_render_manifest.visual_design_policy_version =
    "pulse_signature_repeat_free_v14";
  await fs.writeJson(fixture.sourceWorkOrderPath, sourceWorkOrder);

  const result = await repairFlagshipRenderWorkOrder({
    sourceWorkOrderPath: fixture.sourceWorkOrderPath,
    currentEvidencePath: fixture.currentEvidencePath,
    workspaceDir: fixture.workspaceDir,
    generatedAt: "2026-07-15T12:31:00.000Z",
    ffprobeDurationImpl: (filePath) => (
      path.resolve(filePath) === path.resolve(fixture.narrationPath) ? 10 : 5
    ),
  });

  const repaired = await fs.readJson(result.workOrderPath);
  assert.equal(result.report.repeat_free_timeline_coverage.status, "pass");
  assert.equal(result.report.repeat_free_timeline_coverage.covered_duration_s, 19.25);
  assert.equal(repaired.jobs[0].evidence.repeat_free_timeline_coverage.status, "pass");
  assert.equal(repaired.jobs[0].evidence.selected_render_input_motion_ready, true);
});

test("rejects ambiguous production-render actions", async (t) => {
  const fixture = await makeFixture(t);
  const workOrder = await fs.readJson(fixture.sourceWorkOrderPath);
  const job = workOrder.jobs.find((item) => item.story_id === fixture.storyId);
  job.actions.push(structuredClone(job.actions[0]));
  await fs.writeJson(fixture.sourceWorkOrderPath, workOrder);

  await assert.rejects(
    () => repairFlagshipRenderWorkOrder({
      sourceWorkOrderPath: fixture.sourceWorkOrderPath,
      currentEvidencePath: fixture.currentEvidencePath,
      workspaceDir: fixture.workspaceDir,
    }),
    /source_render_job_action_ambiguous/,
  );
  assert.equal(await fs.pathExists(fixture.workspaceDir), false);
});

test("rejects an output file target that aliases the cloned artifact directory", async (t) => {
  const fixture = await makeFixture(t);
  const artifactDir = path.join(fixture.workspaceDir, "artifacts", fixture.storyId);

  await assert.rejects(
    () => repairFlagshipRenderWorkOrder({
      sourceWorkOrderPath: fixture.sourceWorkOrderPath,
      currentEvidencePath: fixture.currentEvidencePath,
      workspaceDir: fixture.workspaceDir,
      targetArtifactDir: artifactDir,
      targetOutputPath: artifactDir,
    }),
    /isolated_target_file_matches_directory:output_path/,
  );
  assert.equal(await fs.pathExists(fixture.workspaceDir), false);
});

test("revalidates current file evidence after the artifact copy", { concurrency: false }, async (t) => {
  const fixture = await makeFixture(t);
  const originalCopy = fs.copy;
  fs.copy = async (...args) => {
    const result = await originalCopy(...args);
    await fs.writeFile(fixture.narrationPath, Buffer.alloc(2_048, 0x32));
    return result;
  };
  t.after(() => { fs.copy = originalCopy; });

  await assert.rejects(
    () => repairFlagshipRenderWorkOrder({
      sourceWorkOrderPath: fixture.sourceWorkOrderPath,
      currentEvidencePath: fixture.currentEvidencePath,
      workspaceDir: fixture.workspaceDir,
    }),
    /stale_hash:narration_audio|current_evidence_changed_before_commit/,
  );
  assert.equal(await fs.pathExists(fixture.workspaceDir), false);
});

test("does not delete a workspace created by another process during the final rename", { concurrency: false }, async (t) => {
  const fixture = await makeFixture(t);
  const markerPath = path.join(fixture.workspaceDir, "other-process-marker.txt");
  const originalRename = fs.rename;
  fs.rename = async (_source, destination) => {
    await fs.ensureDir(destination);
    await fs.writeFile(path.join(destination, "other-process-marker.txt"), "owned elsewhere");
    throw new Error("simulated_workspace_race");
  };
  t.after(() => { fs.rename = originalRename; });

  await assert.rejects(
    () => repairFlagshipRenderWorkOrder({
      sourceWorkOrderPath: fixture.sourceWorkOrderPath,
      currentEvidencePath: fixture.currentEvidencePath,
      workspaceDir: fixture.workspaceDir,
    }),
    /simulated_workspace_race/,
  );
  assert.equal(await fs.readFile(markerPath, "utf8"), "owned elsewhere");
});

test("CLI exposes explicit local-proof inputs and writes the repaired work order without rendering", async (t) => {
  const fixture = await makeFixture(t);
  const parsed = parseArgs([
    "--work-order", fixture.sourceWorkOrderPath,
    "--evidence", fixture.currentEvidencePath,
    "--workspace", fixture.workspaceDir,
    "--generated-at", "2026-07-15T12:30:00.000Z",
    "--json",
  ]);
  assert.equal(parsed.sourceWorkOrderPath, fixture.sourceWorkOrderPath);
  assert.equal(parsed.currentEvidencePath, fixture.currentEvidencePath);
  assert.equal(parsed.workspaceDir, fixture.workspaceDir);
  assert.equal(parsed.json, true);
  assert.match(usage(), /does not execute a render/i);

  let stdout = "";
  const result = await runRepairCli([
    "--work-order", fixture.sourceWorkOrderPath,
    "--evidence", fixture.currentEvidencePath,
    "--workspace", fixture.workspaceDir,
    "--generated-at", "2026-07-15T12:30:00.000Z",
    "--json",
  ], { stdout: (value) => { stdout += value; } });

  assert.equal(JSON.parse(stdout).status, "READY_FOR_LOCAL_RENDER");
  assert.equal(result.report.safety.render_executed, false);
  assert.equal(await fs.pathExists(result.workOrderPath), true);
});

test("CLI clones a current staging package from explicitly pinned file evidence", async (t) => {
  const fixture = await makeFixture(t);
  const currentPackageDir = path.join(fixture.root, "current-staging-package");
  const currentMotionManifestPath = path.join(currentPackageDir, "materialised_motion_clips.json");
  await fs.copy(fixture.sourceArtifactDir, currentPackageDir);
  await fs.copy(fixture.motionManifestPath, currentMotionManifestPath, { overwrite: true });
  await fs.writeFile(path.join(currentPackageDir, "package-marker.txt"), "current-staging-package");

  const narrationStat = await fs.stat(fixture.narrationPath);
  const timestampsStat = await fs.stat(fixture.timestampsPath);
  const motionStat = await fs.stat(currentMotionManifestPath);
  const result = await runRepairCli([
    "--work-order", fixture.sourceWorkOrderPath,
    "--current-package", currentPackageDir,
    "--narration-audio", fixture.narrationPath,
    "--narration-sha256", await sha256File(fixture.narrationPath),
    "--narration-size", String(narrationStat.size),
    "--word-timestamps", fixture.timestampsPath,
    "--timestamps-sha256", await sha256File(fixture.timestampsPath),
    "--timestamps-size", String(timestampsStat.size),
    "--motion-sha256", await sha256File(currentMotionManifestPath),
    "--motion-size", String(motionStat.size),
    "--workspace", fixture.workspaceDir,
    "--generated-at", "2026-07-15T13:00:00.000Z",
    "--json",
  ], { stdout: () => {} });

  const embeddedEvidencePath = path.join(fixture.workspaceDir, "current_evidence.json");
  const embeddedEvidence = await fs.readJson(embeddedEvidencePath);
  const repaired = await fs.readJson(result.workOrderPath);
  const clonedArtifactDir = repaired.jobs[0].artifact_dir;

  assert.equal(repaired.current_evidence_path, embeddedEvidencePath);
  assert.equal(repaired.current_evidence_embedded, true);
  assert.equal(embeddedEvidence.narration_audio_sha256, fixture.currentEvidence.narration_audio_sha256);
  assert.deepEqual(
    embeddedEvidence.selected_materialised_motion_clip_ids,
    fixture.clips.map((clip) => clip.id),
  );
  assert.equal(
    await fs.readFile(path.join(clonedArtifactDir, "package-marker.txt"), "utf8"),
    "current-staging-package",
  );
  assert.equal(result.report.safety.render_executed, false);
});

test("CLI binds the matching motion rights ledger and current narration rights into the isolated package", async (t) => {
  const fixture = await makeFixture(t);
  const currentPackageDir = path.join(fixture.root, "current-staging-package-with-rights");
  const motionRightsPath = path.join(path.dirname(fixture.motionManifestPath), "rights_ledger.json");
  await fs.copy(fixture.sourceArtifactDir, currentPackageDir);
  await fs.writeJson(path.join(currentPackageDir, "rights_ledger.json"), {
    schema_version: 1,
    story_id: fixture.storyId,
    verdict: "RED",
    status: "blocked",
    blockers: ["narration_and_render_regeneration_required_after_script_repair"],
    failures: [],
    script_repair_invalidated_at: "2026-07-15T11:55:00.000Z",
    narration_rights_updated_at: "2026-07-15T12:05:00.000Z",
    records: [{
      asset_id: `${fixture.storyId}_audio_path`,
      asset_type: "narration_audio",
      kind: "audio",
      path: "audio/narration.mp3",
      source_url: `elevenlabs://pulse-gaming/${fixture.storyId}`,
      source_type: "elevenlabs_tts_voice",
      provider_id: "elevenlabs",
      licence_basis: "elevenlabs_commercial_tts_generation",
      allowed_use: "short_form_editorial_narration",
      allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
      commercial_use_allowed: true,
      approval_status: "approved",
      asset_sha256: fixture.currentEvidence.narration_audio_sha256,
      asset_size_bytes: fixture.currentEvidence.narration_audio_size_bytes,
      risk_score: 0.08,
    }],
    used_assets: [{
      asset_id: `${fixture.storyId}_audio_path`,
      kind: "audio",
      path: "audio/narration.mp3",
      source_url: `elevenlabs://pulse-gaming/${fixture.storyId}`,
      source_type: "elevenlabs_tts_voice",
      asset_sha256: fixture.currentEvidence.narration_audio_sha256,
      asset_size_bytes: fixture.currentEvidence.narration_audio_size_bytes,
    }],
  }, { spaces: 2 });
  const motionRecords = await Promise.all(fixture.clips.map(async (clip) => ({
    asset_id: clip.id,
    asset_type: "motion_clip",
    kind: "video",
    path: clip.path,
    source_url: clip.canonical_source_url,
    source_type: clip.source_type,
    licence_basis: "official_publisher_promotional_editorial_use",
    allowed_use: "transformative_editorial_short_form",
    allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    commercial_use_allowed: true,
    approval_status: "approved_for_transformative_editorial_use",
    asset_sha256: clip.sha256,
    asset_size_bytes: (await fs.stat(clip.path)).size,
    risk_score: 0.25,
  })));
  await fs.writeJson(motionRightsPath, {
    schema_version: 1,
    story_id: fixture.storyId,
    verdict: "pass",
    status: "ready",
    blockers: [],
    failures: [],
    records: motionRecords,
    used_assets: motionRecords.map((record) => ({
      asset_id: record.asset_id,
      kind: record.kind,
      path: record.path,
      source_url: record.source_url,
      source_type: record.source_type,
      asset_sha256: record.asset_sha256,
      asset_size_bytes: record.asset_size_bytes,
    })),
    metrics: {
      used_asset_count: motionRecords.length,
      rights_record_count: motionRecords.length,
      missing_asset_count: 0,
      duplicate_record_count: 0,
    },
  }, { spaces: 2 });

  const narrationTimestamp = new Date("2026-07-15T12:06:00.000Z");
  await fs.utimes(fixture.narrationPath, narrationTimestamp, narrationTimestamp);
  const narrationStat = await fs.stat(fixture.narrationPath);
  const timestampsStat = await fs.stat(fixture.timestampsPath);
  const motionStat = await fs.stat(fixture.motionManifestPath);
  const result = await runRepairCli([
    "--work-order", fixture.sourceWorkOrderPath,
    "--current-package", currentPackageDir,
    "--motion-manifest", fixture.motionManifestPath,
    "--narration-audio", fixture.narrationPath,
    "--narration-sha256", await sha256File(fixture.narrationPath),
    "--narration-size", String(narrationStat.size),
    "--word-timestamps", fixture.timestampsPath,
    "--timestamps-sha256", await sha256File(fixture.timestampsPath),
    "--timestamps-size", String(timestampsStat.size),
    "--motion-sha256", await sha256File(fixture.motionManifestPath),
    "--motion-size", String(motionStat.size),
    "--workspace", fixture.workspaceDir,
    "--generated-at", "2026-07-15T13:05:00.000Z",
    "--json",
  ], { stdout: () => {} });

  const repaired = await fs.readJson(result.workOrderPath);
  const rights = await fs.readJson(path.join(repaired.jobs[0].artifact_dir, "rights_ledger.json"));
  const expectedIds = [
    `${fixture.storyId}_audio_path`,
    ...fixture.clips.map((clip) => clip.id),
  ];
  assert.equal(rights.verdict, "pass");
  assert.equal(rights.status, "ready");
  assert.deepEqual(rights.blockers, []);
  assert.deepEqual(rights.failures, []);
  assert.deepEqual(rights.records.map((record) => record.asset_id), expectedIds);
  assert.deepEqual(rights.used_assets.map((record) => record.asset_id), expectedIds);
  assert.equal(rights.metrics.used_asset_count, expectedIds.length);
  assert.equal(rights.metrics.rights_record_count, expectedIds.length);
  const narration = rights.records[0];
  assert.equal(narration.source_type, "elevenlabs_tts_voice");
  assert.equal(narration.asset_sha256, await sha256File(fixture.narrationPath));
  assert.equal(narration.asset_size_bytes, narrationStat.size);
  assert.equal(rights.flagship_rights_reconciliation.motion_rights_ledger_path, motionRightsPath);
  assert.equal(rights.flagship_rights_reconciliation.selected_motion_asset_count, fixture.clips.length);
});

test("reconciles a co-located script-repair transition ledger without requiring a false pre-render PASS", async (t) => {
  const fixture = await makeFixture(t);
  const currentPackageDir = path.join(fixture.root, "co-located-transition-package");
  const currentMotionManifestPath = path.join(currentPackageDir, "materialised_motion_clips.json");
  const currentRightsPath = path.join(currentPackageDir, "rights_ledger.json");
  await fs.copy(fixture.sourceArtifactDir, currentPackageDir);
  await fs.copy(fixture.motionManifestPath, currentMotionManifestPath);

  const sourceRights = await fs.readJson(path.join(fixture.sourceArtifactDir, "rights_ledger.json"));
  const motionRights = await fs.readJson(path.join(path.dirname(fixture.motionManifestPath), "rights_ledger.json"));
  const narrationRecord = sourceRights.records.find(
    (record) => record.asset_id === `${fixture.storyId}_audio_path`,
  );
  await fs.writeJson(currentRightsPath, {
    schema_version: 1,
    story_id: fixture.storyId,
    verdict: "RED",
    status: "blocked",
    blockers: ["narration_and_render_regeneration_required_after_script_repair"],
    failures: [],
    script_repair_invalidated_at: "2026-07-15T11:55:00.000Z",
    narration_rights_updated_at: "2026-07-15T12:05:00.000Z",
    records: [narrationRecord, ...motionRights.records],
    used_assets: [
      {
        ...narrationRecord,
        path: "flagship/stale_audio.mp3",
        asset_sha256: "f".repeat(64),
        asset_size_bytes: 1,
      },
      ...motionRights.used_assets,
    ],
  }, { spaces: 2 });

  const narrationTimestamp = new Date("2026-07-15T12:06:00.000Z");
  await fs.utimes(fixture.narrationPath, narrationTimestamp, narrationTimestamp);
  const narrationStat = await fs.stat(fixture.narrationPath);
  const timestampsStat = await fs.stat(fixture.timestampsPath);
  const motionStat = await fs.stat(currentMotionManifestPath);
  const result = await runRepairCli([
    "--work-order", fixture.sourceWorkOrderPath,
    "--current-package", currentPackageDir,
    "--motion-manifest", currentMotionManifestPath,
    "--narration-audio", fixture.narrationPath,
    "--narration-sha256", await sha256File(fixture.narrationPath),
    "--narration-size", String(narrationStat.size),
    "--word-timestamps", fixture.timestampsPath,
    "--timestamps-sha256", await sha256File(fixture.timestampsPath),
    "--timestamps-size", String(timestampsStat.size),
    "--motion-sha256", await sha256File(currentMotionManifestPath),
    "--motion-size", String(motionStat.size),
    "--workspace", fixture.workspaceDir,
    "--generated-at", "2026-07-15T13:07:00.000Z",
    "--json",
  ], { stdout: () => {} });

  const repaired = await fs.readJson(result.workOrderPath);
  const rights = await fs.readJson(path.join(repaired.jobs[0].artifact_dir, "rights_ledger.json"));
  const repairedNarration = rights.records[0];
  const repairedNarrationUse = rights.used_assets[0];

  assert.equal(rights.verdict, "pass");
  assert.equal(rights.status, "ready");
  assert.deepEqual(rights.blockers, []);
  assert.equal(rights.records.length, fixture.clips.length + 1);
  assert.equal(rights.used_assets.length, fixture.clips.length + 1);
  assert.equal(repairedNarration.asset_sha256, await sha256File(fixture.narrationPath));
  assert.equal(repairedNarration.asset_size_bytes, narrationStat.size);
  assert.equal(repairedNarrationUse.asset_sha256, repairedNarration.asset_sha256);
  assert.equal(repairedNarrationUse.asset_size_bytes, repairedNarration.asset_size_bytes);
  assert.equal(
    rights.flagship_rights_reconciliation.motion_rights_ledger_path,
    currentRightsPath,
  );
  assert.equal(
    rights.flagship_rights_reconciliation.narration_transition,
    "script_repair_narration_regenerated",
  );
});

test("reconciles candidate-derived pre-render narration blockers only through a strict pending ElevenLabs receipt", async (t) => {
  const fixture = await makeFixture(t);
  const currentPackageDir = path.join(fixture.root, "candidate-derived-transition-package");
  const currentMotionManifestPath = path.join(currentPackageDir, "materialised_motion_clips.json");
  const currentRightsPath = path.join(currentPackageDir, "rights_ledger.json");
  await fs.copy(fixture.sourceArtifactDir, currentPackageDir);
  await fs.copy(fixture.motionManifestPath, currentMotionManifestPath);

  const sourceRights = await fs.readJson(path.join(fixture.sourceArtifactDir, "rights_ledger.json"));
  const motionRights = await fs.readJson(
    path.join(path.dirname(fixture.motionManifestPath), "rights_ledger.json"),
  );
  const transitionedClip = fixture.clips[0];
  const transitionedClipStat = await fs.stat(transitionedClip.path);
  const transitionedClipSha256 = await sha256File(transitionedClip.path);
  const transitionedRecord = motionRights.records.find(
    (record) => record.asset_id === transitionedClip.id,
  );
  const transitionedUse = motionRights.used_assets.find(
    (used) => used.asset_id === transitionedClip.id,
  );
  const staleTransitionPath = path.join(fixture.root, "prior-render", "clip.mp4");
  for (const entry of [transitionedRecord, transitionedUse]) {
    entry.path = staleTransitionPath;
    entry.asset_sha256 = "5".repeat(64);
    entry.asset_size_bytes = 1024;
  }
  transitionedRecord.materialized_file_evidence = {
    schema_version: 1,
    sha256: transitionedClipSha256,
    size_bytes: transitionedClipStat.size,
  };
  const narrationRecord = sourceRights.records.find(
    (record) => record.asset_id === `${fixture.storyId}_audio_path`,
  );
  const transitionBlocker =
    "narration_and_render_regeneration_required_after_script_repair";
  const candidateDerivedBlockers = [
    `narration_commercial_rights_evidence_not_green:${fixture.storyId}_audio_path`,
    "used_asset_rights_coverage_incomplete",
    `flagship_rights_sidecar_source_record_missing:${fixture.storyId}_audio_path`,
    transitionBlocker,
  ];
  await fs.writeJson(currentRightsPath, {
    schema_version: 2,
    story_id: fixture.storyId,
    verdict: "RED",
    status: "blocked",
    blockers: candidateDerivedBlockers,
    failures: [],
    script_repair_invalidated_at: "2026-07-15T11:55:00.000Z",
    narration_rights_updated_at: "2026-07-15T12:05:00.000Z",
    records: [narrationRecord, ...motionRights.records],
    used_assets: motionRights.used_assets,
    matched_assets: [{
      asset_id: narrationRecord.asset_id,
      kind: narrationRecord.kind,
      path: narrationRecord.path,
      source_url: narrationRecord.source_url,
      rights_record_id: narrationRecord.asset_id,
      licence_basis: narrationRecord.licence_basis,
      asset_sha256: narrationRecord.asset_sha256,
      asset_size_bytes: narrationRecord.asset_size_bytes,
    }],
    metrics: {
      used_asset_count: motionRights.used_assets.length + 1,
      rights_record_count: motionRights.used_assets.length,
      missing_asset_count: 1,
      duplicate_record_count: 0,
    },
    reconciliation: {
      current_files_hashed: true,
      authoritative_publish_verdict_unchanged: true,
      safe_demotion_applied: true,
      safe_demotion_reason:
        "current_evidence_failed_and_stale_stored_rights_were_not_publishable",
    },
  }, { spaces: 2 });
  const originalRights = await fs.readJson(currentRightsPath);

  const narrationTimestamp = new Date("2026-07-15T12:06:00.000Z");
  await fs.utimes(fixture.narrationPath, narrationTimestamp, narrationTimestamp);
  const pendingReceiptPath = await writePendingElevenLabsGenerationReceipt({
    artifactDir: currentPackageDir,
    storyId: fixture.storyId,
    narrationPath: fixture.narrationPath,
    timestampsPath: fixture.timestampsPath,
  });
  const pendingReceipt = await fs.readJson(pendingReceiptPath);
  pendingReceipt.generation.history_audio_sha256 = "3".repeat(64);
  pendingReceipt.generation.history_audio_size_bytes += 1;
  pendingReceipt.generation.audio_identity_method =
    "decoded_pcm_s16le_44100_mono_sha256";
  pendingReceipt.generation.compressed_bytes_match = false;
  pendingReceipt.generation.raw_provider_audio_decoded_pcm_sha256 = "4".repeat(64);
  pendingReceipt.generation.raw_provider_audio_decoded_pcm_size_bytes = 4096;
  pendingReceipt.generation.history_audio_decoded_pcm_sha256 = "4".repeat(64);
  pendingReceipt.generation.history_audio_decoded_pcm_size_bytes = 4096;
  pendingReceipt.generation.decoded_pcm_sample_rate_hz = 44100;
  pendingReceipt.generation.decoded_pcm_channels = 1;
  pendingReceipt.generation.decoded_pcm_sample_format = "s16le";
  await fs.writeJson(pendingReceiptPath, pendingReceipt, { spaces: 2 });
  fixture.currentEvidence.word_timestamps_sha256 = await sha256File(fixture.timestampsPath);
  fixture.currentEvidence.word_timestamps_size_bytes = (await fs.stat(fixture.timestampsPath)).size;
  await fs.writeJson(fixture.currentEvidencePath, fixture.currentEvidence, { spaces: 2 });

  const narrationStat = await fs.stat(fixture.narrationPath);
  const timestampsStat = await fs.stat(fixture.timestampsPath);
  const motionStat = await fs.stat(currentMotionManifestPath);
  const cliArgs = [
    "--work-order", fixture.sourceWorkOrderPath,
    "--current-package", currentPackageDir,
    "--motion-manifest", currentMotionManifestPath,
    "--narration-audio", fixture.narrationPath,
    "--narration-sha256", await sha256File(fixture.narrationPath),
    "--narration-size", String(narrationStat.size),
    "--word-timestamps", fixture.timestampsPath,
    "--timestamps-sha256", await sha256File(fixture.timestampsPath),
    "--timestamps-size", String(timestampsStat.size),
    "--motion-sha256", await sha256File(currentMotionManifestPath),
    "--motion-size", String(motionStat.size),
    "--workspace", fixture.workspaceDir,
    "--generated-at", "2026-07-15T13:08:00.000Z",
    "--json",
  ];
  const result = await runRepairCli(cliArgs, { stdout: () => {} });

  const repaired = await fs.readJson(result.workOrderPath);
  const repairedRights = await fs.readJson(
    path.join(repaired.jobs[0].artifact_dir, "rights_ledger.json"),
  );
  const copiedReceipt = await fs.readJson(
    path.join(
      repaired.jobs[0].artifact_dir,
      "rights",
      "evidence",
      "elevenlabs-generation-receipt.json",
    ),
  );

  assert.equal(result.report.status, "READY_FOR_LOCAL_RENDER");
  assert.equal(result.report.publish_authorised, false);
  assert.equal(repairedRights.verdict, "AMBER");
  assert.equal(repairedRights.status, "ready_for_local_render");
  assert.deepEqual(repairedRights.blockers, [transitionBlocker]);
  assert.equal(repairedRights.can_auto_publish, false);
  assert.equal(repairedRights.final_media_lineage_status, "PENDING");
  assert.equal(repairedRights.final_media_commercial_use_allowed, false);
  assert.equal(
    repairedRights.flagship_rights_reconciliation.narration_transition,
    "script_repair_narration_regenerated_pending_final_media",
  );
  assert.equal(
    repairedRights.flagship_rights_reconciliation.generation_receipt_verdict,
    "AMBER",
  );
  assert.equal(copiedReceipt.generation_verdict, "GREEN");
  assert.equal(copiedReceipt.commercial_use_allowed, false);
  assert.deepEqual(copiedReceipt.blockers, ["final_media_lineage_pending"]);
  assert.deepEqual(await fs.readJson(currentRightsPath), originalRights);

  const staleMotionRights = await fs.readJson(currentRightsPath);
  staleMotionRights.records.find(
    (record) => record.asset_id === transitionedClip.id,
  ).materialized_file_evidence.sha256 = "6".repeat(64);
  await fs.writeJson(currentRightsPath, staleMotionRights, { spaces: 2 });
  const staleMotionWorkspaceDir = path.join(
    fixture.root,
    "stale-motion-transition-workspace",
  );
  const staleMotionCliArgs = [...cliArgs];
  staleMotionCliArgs[staleMotionCliArgs.indexOf("--workspace") + 1] =
    staleMotionWorkspaceDir;
  await assert.rejects(
    () => runRepairCli(staleMotionCliArgs, { stdout: () => {} }),
    /selected_motion_rights_path_mismatch:fresh-clip-1/,
  );
  assert.equal(await fs.pathExists(staleMotionWorkspaceDir), false);
  await fs.writeJson(currentRightsPath, originalRights, { spaces: 2 });

  const unsafeReceiptPath = path.join(
    currentPackageDir,
    "rights",
    "evidence",
    "elevenlabs-generation-receipt.json",
  );
  const unsafeReceipt = await fs.readJson(unsafeReceiptPath);
  unsafeReceipt.generation_checks.every_generation_condition_proven = false;
  await fs.writeJson(unsafeReceiptPath, unsafeReceipt, { spaces: 2 });
  const unsafeWorkspaceDir = path.join(fixture.root, "unsafe-receipt-workspace");
  const unsafeCliArgs = [...cliArgs];
  unsafeCliArgs[unsafeCliArgs.indexOf("--workspace") + 1] = unsafeWorkspaceDir;

  await assert.rejects(
    () => runRepairCli(unsafeCliArgs, { stdout: () => {} }),
    /generation_receipt_checks_incomplete/,
  );
  assert.equal(await fs.pathExists(unsafeWorkspaceDir), false);
});

test("accepts a package-scoped source ledger without a top-level story ID only when the exact narration asset binds the story", async (t) => {
  const fixture = await makeFixture(t);
  const sourceRightsPath = path.join(fixture.sourceArtifactDir, "rights_ledger.json");
  const sourceRights = await fs.readJson(sourceRightsPath);
  delete sourceRights.story_id;
  await fs.writeJson(sourceRightsPath, sourceRights, { spaces: 2 });

  const result = await repairFlagshipRenderWorkOrder({
    sourceWorkOrderPath: fixture.sourceWorkOrderPath,
    currentEvidencePath: fixture.currentEvidencePath,
    workspaceDir: fixture.workspaceDir,
    generatedAt: "2026-07-15T13:10:00.000Z",
  });

  const repaired = await fs.readJson(result.workOrderPath);
  const rights = await fs.readJson(path.join(repaired.jobs[0].artifact_dir, "rights_ledger.json"));
  assert.equal(rights.story_id, fixture.storyId);
  assert.equal(rights.verdict, "pass");
  assert.equal(
    rights.records[0].asset_id,
    `${fixture.storyId}_audio_path`,
  );
});
