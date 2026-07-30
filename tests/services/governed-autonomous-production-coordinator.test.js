"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  REQUEST_SCHEMA_VERSION,
  materialiseGovernedAutonomousOfficialCandidate,
} = require("../../lib/services/governed-autonomous-production-coordinator");
const {
  validateAutonomousOfficialJitPreparationManifest,
} = require("../../lib/services/autonomous-official-jit-admission-packet");
const {
  buildLockedYazdInventoryFixture,
} = require("../fixtures/governed-story-intake-inventory-bridge");
const {
  canonicalHash,
} = require("../../lib/services/url-canonical");
const {
  createGovernedAutonomousDatabaseStoryBinding,
} = require("../../lib/services/governed-autonomous-database-story-binding");
const {
  createGovernedFastNewsLaneDecision,
} = require("../../lib/services/governed-fast-news-lane-decision");
const {
  CANDIDATE_REVISION_SCHEMA_VERSION,
  canonicalSha256: compiledCanonicalSha256,
  createGovernedAutonomousCompiledCandidateRevision,
} = require("../../lib/services/governed-autonomous-compiled-candidate-binding");

const GENERATED_AT = "2026-07-29T12:00:00.000Z";
const SCHEDULED_FOR = "2026-07-30T09:00:00.000Z";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function rendererReceipt(adapterId, extra = {}) {
  return {
    adapter_id: adapterId,
    deterministic: true,
    ownership: "owned",
    rights_basis: "OWNED",
    attribution_required: false,
    third_party_media_used: false,
    third_party_music: false,
    network_used: false,
    ...extra,
  };
}

function scene({
  assetId,
  role,
  mediaType,
  start,
  duration,
  headline,
  layout,
}) {
  return {
    asset_id: assetId,
    role,
    media_type: mediaType,
    start_seconds: start,
    duration_seconds: duration,
    design: {
      schema_version: "pulse-owned-vector-scene-v1",
      headline,
      supporting_text: "Exact authored player-impact graphic",
      accent_colour: "#FF6B1A",
      layout,
    },
    ownership: "owned",
    rights_basis: "OWNED",
    attribution_required: false,
    provenance: {
      source: "repository_owned_authored_vector_scene",
      third_party_media_used: false,
      third_party_music: false,
    },
  };
}

function scenes(target = 36.48) {
  return [
    scene({
      assetId: "owned-hook",
      role: "hook_slam",
      mediaType: "image",
      start: 0,
      duration: 3,
      headline: "FREE TO KEEP",
      layout: "TITLE",
    }),
    scene({
      assetId: "owned-motion-backbone",
      role: "owned_motion_backbone",
      mediaType: "video",
      start: 0,
      duration: target,
      headline: "YAZD HD",
      layout: "BACKBONE",
    }),
    scene({
      assetId: "owned-deadline",
      role: "verified_deadline",
      mediaType: "image",
      start: 3,
      duration: 7,
      headline: "ENDS 30 JULY",
      layout: "TIMELINE",
    }),
    scene({
      assetId: "owned-price",
      role: "verified_price",
      mediaType: "image",
      start: 10,
      duration: 7,
      headline: "100% OFF",
      layout: "COMPARISON",
    }),
    scene({
      assetId: "owned-coop",
      role: "verified_coop",
      mediaType: "image",
      start: 17,
      duration: 7,
      headline: "UP TO 4 PLAYERS",
      layout: "GRID",
    }),
    scene({
      assetId: "owned-impact",
      role: "player_impact",
      mediaType: "image",
      start: 24,
      duration: target - 24,
      headline: "CLAIM IT NOW",
      layout: "IMPACT",
    }),
  ];
}

function videoProbe({ duration = 36.48, audio = false } = {}) {
  const streams = [
    {
      codec_type: "video",
      codec_name: "h264",
      profile: "High",
      pix_fmt: "yuv420p",
      width: 1080,
      height: 1920,
      avg_frame_rate: "30/1",
      r_frame_rate: "30/1",
    },
  ];
  if (audio) {
    streams.push({
      codec_type: "audio",
      codec_name: "aac",
      sample_rate: "48000",
    });
  }
  return { streams, format: { duration: String(duration) } };
}

function audioProbe(duration = 36) {
  return {
    streams: [
      {
        codec_type: "audio",
        codec_name: "mp3",
        sample_rate: "44100",
      },
    ],
    format: { duration: String(duration) },
  };
}

function sourceLoudness() {
  return {
    integrated_lufs: -23.9,
    true_peak_dbfs: -8.4,
    loudness_range_lu: 3.2,
    threshold_lufs: -34,
    target_offset_lu: 0.1,
  };
}

function finalLoudness() {
  return {
    integrated_lufs: -16,
    true_peak_dbfs: -1.7,
    loudness_range_lu: 3.1,
    threshold_lufs: -26,
    target_offset_lu: 0,
  };
}

function makeAlignment(script, duration = 35.9) {
  const characters = Array.from(script);
  return {
    characters,
    character_start_times_seconds: characters.map((_, index) =>
      Number(((duration * index) / characters.length).toFixed(6)),
    ),
    character_end_times_seconds: characters.map((_, index) =>
      Number(((duration * (index + 1)) / characters.length).toFixed(6)),
    ),
  };
}

function commercialCreditReport() {
  return {
    schema_version: "pulse-elevenlabs-credit-preflight-v1",
    generated_at: GENERATED_AT,
    provider: "elevenlabs",
    tier: "creator",
    status: "active",
    included_credit_limit: 100000,
    included_credits_remaining: 80000,
    idempotency_key_hash: sha256("governed-yazd-narration"),
    verdict: "ALLOW",
    warnings: [],
    durable_reservation_state: "COMPLETED",
  };
}

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-autonomous-coordinator-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const locked = await buildLockedYazdInventoryFixture(root, {
    ...(options.inventoryStoryId
      ? { storyId: options.inventoryStoryId }
      : {}),
  });
  const workspaceRoot = path.join(root, "trusted-workspace");
  const candidateSourceRoot = path.join(root, "candidate-source");
  await fs.mkdir(workspaceRoot, { recursive: true });
  const canonicalIdentityUrl =
    options.useRegistryPrimaryIdentity === true
      ? locked.newsUrl
      : locked.canonicalIdentityUrl;
  const storyId =
    options.useRegistryPrimaryIdentity === true
      ? `official_${canonicalHash(canonicalIdentityUrl)}`
      : locked.storyId;
  const fastNewsSourceEvidenceSha256 = sha256(
    `${locked.storyId}:fast-news-source-evidence`,
  );
  const fastNewsLaneDecision =
    createGovernedFastNewsLaneDecision({
      story_id: locked.storyId,
      evaluated_at: GENERATED_AT,
      scheduled_for: SCHEDULED_FOR,
      source_published_at: "2026-07-29T11:00:00.000Z",
      verification_status: "CONFIRMED",
      source_class: "OFFICIAL_FIRST_PARTY",
      inventory_file_sha256: locked.registryFileSha256,
      source_evidence_sha256:
        fastNewsSourceEvidenceSha256,
      explicit_formats: [],
    });
  const request = {
    schema_version: REQUEST_SCHEMA_VERSION,
    mode: "LOCAL_PROOF",
    generated_at: GENERATED_AT,
    scheduled_for: SCHEDULED_FOR,
    role: "PRIMARY",
    candidate_revision_sha256: sha256("candidate-revision"),
    request_fingerprint: sha256("candidate-request"),
    workspace_root: workspaceRoot,
    candidate_source_root: candidateSourceRoot,
    candidate_workspace_relative_root: `output/canary/${storyId}`,
    locked_intake: {
      fast_news_lane_decision: fastNewsLaneDecision,
      database_story_binding:
        createGovernedAutonomousDatabaseStoryBinding({
          canonical_story_id: storyId,
          database_story_id: locked.storyId,
          canonical_identity_url: canonicalIdentityUrl,
          inventory_file_sha256:
            locked.registryFileSha256,
          final_script_sha256: locked.scriptSha256,
        }),
      inventory_path: locked.registryPath,
      inventory_file_sha256: locked.registryFileSha256,
      inventory_root: locked.inventoryRoot,
      allowed_roots: [locked.outputRoot, root],
      canonical_identity_url: canonicalIdentityUrl,
      final_script: locked.script,
      final_script_sha256: locked.scriptSha256,
      script_claim_bindings: locked.scriptClaimBindings,
      presentation_claim_bindings: locked.presentationClaimBindings,
      supplemental_official_sources: [
        {
          path: locked.supplementalPath,
          file_sha256: locked.supplementalFileSha256,
          canonical_sha256: locked.storePacket.packet_sha256,
        },
      ],
      contract: locked.contract,
      freshness: locked.freshness,
      visual_brief: locked.visualBrief,
      experiment_dimensions: {
        eligible: false,
        ineligibility_reason:
          "Breaking high-cadence stories are outside the controlled calibration.",
      },
    },
    creative: {
      scenes: scenes(),
      title:
        "Yet Another Zombie Defense HD Is Free Until 30 July",
      description: [
        "Yet Another Zombie Defense HD is free to keep for a limited time.",
        "",
        `Official source: ${canonicalIdentityUrl}`,
        "Official source: Steam",
        "",
        "#Steam #FreeGames #GamingNews #Shorts",
      ].join("\n"),
      official_source_url: canonicalIdentityUrl,
      required_attributions: ["Official source: Steam"],
      subject_terms: [
        "Yet Another Zombie Defense HD",
        "Zombie Defense",
      ],
    },
    narration: {
      provider: "elevenlabs",
      voice_id: "pulse-liam-approved",
      model_id: "eleven_multilingual_v2",
      speed: 1,
    },
    visual_qa: {
      reviewers: [
        {
          provider: "ollama",
          model: "gemma3:12b",
          endpoint_origin: "http://127.0.0.1:11434",
        },
        {
          provider: "ollama",
          model: "qwen2.5vl:7b",
          endpoint_origin: "http://127.0.0.1:11434",
        },
      ],
    },
    disclosure_policy: {
      policy_id: "pulse-youtube-synthetic-media",
      policy_version: "1",
    },
  };
  const runtimePolicy = {
    schema_version:
      "pulse-governed-autonomous-production-runtime-policy-v1",
    mode: "LOCAL_PROOF",
    generated_at: request.generated_at,
    workspace_root: request.workspace_root,
    candidate_source_root: request.candidate_source_root,
    narration: request.narration,
    visual_qa: request.visual_qa,
    disclosure_policy: request.disclosure_policy,
    safety: {
      local_proof_only: true,
      database_authority: false,
      database_mutated: false,
      network_authority: false,
      network_used: false,
      oauth_or_token_authority: false,
      oauth_or_tokens_mutated: false,
      platform_contacted: false,
      publish_authority: false,
      scheduler_authority: false,
      external_publish_authorised: false,
    },
  };
  const candidateRevision =
    createGovernedAutonomousCompiledCandidateRevision({
      schema_version: CANDIDATE_REVISION_SCHEMA_VERSION,
      legacy_story_id: locked.storyId,
      story_id: storyId,
      scheduled_for: SCHEDULED_FOR,
      inventory_file_sha256: locked.registryFileSha256,
      inventory_canonical_sha256: sha256(
        `${locked.storyId}:inventory-canonical`,
      ),
      primary_source_packet_sha256:
        fastNewsSourceEvidenceSha256,
      publication_source_evidence_sha256: sha256(
        `${locked.storyId}:publication-source`,
      ),
      rights_ledger_sha256: sha256(
        `${locked.storyId}:rights-ledger`,
      ),
      supplemental_source_packet_sha256: [
        locked.storePacket.packet_sha256,
      ],
      final_script_sha256: locked.scriptSha256,
      fast_news_lane_decision_sha256:
        fastNewsLaneDecision.decision_sha256,
      locked_intake_sha256: compiledCanonicalSha256(
        request.locked_intake,
      ),
      creative_package_sha256: compiledCanonicalSha256(
        request.creative,
      ),
      runtime_policy_sha256:
        compiledCanonicalSha256(runtimePolicy),
    });
  request.candidate_revision = candidateRevision;
  request.candidate_revision_sha256 =
    compiledCanonicalSha256(candidateRevision);
  request.request_fingerprint = compiledCanonicalSha256({
    schema_version:
      "pulse-governed-autonomous-breaking-production-request-fingerprint-v1",
    story_id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: SCHEDULED_FOR,
    candidate_revision_sha256:
      request.candidate_revision_sha256,
    locked_intake_sha256:
      candidateRevision.locked_intake_sha256,
    creative_package_sha256:
      candidateRevision.creative_package_sha256,
    runtime_policy_sha256:
      candidateRevision.runtime_policy_sha256,
  });

  let generatedNarrations = 0;
  const finalCompositeFfmpegPath = path.join(
    root,
    "bin",
    "ffmpeg.exe",
  );
  const dependencies = {
    async generateNarration({
      script_text: scriptText,
      audio_path: audioPath,
      alignment_path: alignmentPath,
    }) {
      generatedNarrations += 1;
      await fs.mkdir(path.dirname(audioPath), { recursive: true });
      await fs.writeFile(
        audioPath,
        Buffer.from("exact-mastered-elevenlabs-narration", "utf8"),
      );
      await fs.writeFile(
        alignmentPath,
        jsonBytes(makeAlignment(scriptText)),
      );
      return {
        provider: {
          id: "elevenlabs",
          model_id: "eleven_multilingual_v2",
          voice_id: "pulse-liam-approved",
          http_status: 200,
          provider_result_recorded: true,
        },
        credit_report: commercialCreditReport(),
        transform_status: "COMPLETE",
        post_generation_transform_status: "COMPLETE",
        network_used: true,
      };
    },
    ownedProgramme: {
      hyperframesGeneratorIdentity: "hyperframes@0.7.77",
      async renderScene({ outputPath, scene: input }) {
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(
          outputPath,
          Buffer.from(`owned-scene:${input.asset_id}`, "utf8"),
        );
        return rendererReceipt("test-owned-scene-renderer-v1");
      },
      async renderProgramme({
        outputPath,
        storyId: exactStoryId,
        targetDurationSeconds,
      }) {
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(
          outputPath,
          Buffer.from(
            `owned-hyperframes:${exactStoryId}:${targetDurationSeconds}`,
            "utf8",
          ),
        );
        return rendererReceipt(
          "test-hyperframes-programme-renderer-v1",
          { generator_identity: "hyperframes@0.7.77" },
        );
      },
      async probeMedia({ mediaType, expectedDurationSeconds }) {
        return videoProbe({
          duration: expectedDurationSeconds,
          audio: false,
          mediaType,
        });
      },
    },
    async probeNarrationAudio() {
      return {
        duration_seconds: 36,
        codec_name: "mp3",
        has_audio: true,
      };
    },
    finalComposite: {
      ffmpegPath: finalCompositeFfmpegPath,
      async probeMedia(filePath) {
        if (path.extname(filePath).toLowerCase() === ".mp3") {
          return audioProbe();
        }
        if (path.basename(filePath).includes("owned-programme")) {
          return videoProbe();
        }
        return videoProbe({ audio: true });
      },
      async measureLoudness(filePath) {
        return path.extname(filePath).toLowerCase() === ".mp3"
          ? sourceLoudness()
          : finalLoudness();
      },
      async measureTerminalSilence() {
        return {
          threshold_db: -50,
          minimum_duration_seconds: 0.1,
          terminal_silence_start_seconds: 36,
          terminal_silence_seconds: 0.48,
        };
      },
      async renderComposite(invocation) {
        assert.equal(
          invocation.command,
          finalCompositeFfmpegPath,
        );
        await fs.writeFile(
          invocation.outputPath,
          Buffer.from("exact-governed-final-video", "utf8"),
        );
      },
    },
    visualQa: {
      async extractFrames({ frame_plan: framePlan, frames_dir: framesDir }) {
        await fs.mkdir(framesDir, { recursive: true });
        return Promise.all(
          framePlan.map(async (frame) => {
            const bytes = Buffer.from(
              `exact-frame:${frame.frame_id}:${frame.timestamp_ms}`,
              "utf8",
            );
            const framePath = path.join(
              framesDir,
              `${frame.frame_id}.png`,
            );
            await fs.writeFile(framePath, bytes);
            return {
              ...frame,
              path: framePath,
              sha256: sha256(bytes),
              width: 1080,
              height: 1920,
              deterministic_blockers: [],
            };
          }),
        );
      },
      reviewerAdapters: {
        "ollama:gemma3:12b": async () => ({
          provider: "ollama",
          model: "gemma3:12b",
          verdict: "PASS",
          blockers: [],
          capability_evidence: {
            completion: true,
            vision: true,
          },
        }),
        "ollama:qwen2.5vl:7b": async () => ({
          provider: "ollama",
          model: "qwen2.5vl:7b",
          verdict: "PASS",
          blockers: [],
          capability_evidence: {
            completion: true,
            vision: true,
          },
        }),
      },
    },
  };
  return {
    root,
    locked,
    request,
    dependencies,
    generatedNarrations: () => generatedNarrations,
  };
}

test("materialises the locked official story through real governed staging into a JIT-valid closed packet", async (t) => {
  const input = await fixture(t);

  const result =
    await materialiseGovernedAutonomousOfficialCandidate(
      input.request,
      input.dependencies,
    );
  const preparation =
    validateAutonomousOfficialJitPreparationManifest(
      result.staging.preparation_manifest,
    );

  assert.equal(result.verdict, "GREEN");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.story_id, input.locked.storyId);
  assert.equal(result.green_supplement.verdict, "GREEN");
  assert.equal(result.staging.verdict, "GREEN");
  assert.equal(preparation.story_id, input.locked.storyId);
  assert.equal(preparation.role, "PRIMARY");
  assert.equal(preparation.scheduled_for, SCHEDULED_FOR);
  assert.deepEqual(
    preparation.fast_news_lane_decision,
    input.request.locked_intake.fast_news_lane_decision,
  );
  assert.equal(
    preparation.artifacts.autonomous_green_supplement.sha256,
    result.green_supplement.json_file_sha256,
  );
  assert.equal(
    preparation.artifacts.autonomous_visual_gate_decision.sha256,
    result.visual_gate_decision.file_sha256,
  );
  assert.equal(
    result.visual_gate_decision.decision.decision_authority,
    "SYSTEM_POLICY",
  );
  assert.equal(
    result.visual_gate_decision.decision.authority_scope,
    "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
  );
  assert.equal(
    result.visual_gate_decision.decision.controls.human_approval,
    false,
  );
  assert.equal(
    result.visual_gate_decision.decision.controls.models_treated_as_humans,
    false,
  );
  assert.equal(input.generatedNarrations(), 1);
  assert.equal(result.safety.publish_authority, false);
  assert.equal(result.safety.scheduler_authority, false);
  assert.equal(result.safety.database_mutated, false);
  assert.equal(result.safety.oauth_or_tokens_mutated, false);
  assert.equal(result.safety.platform_contacted, false);
  assert.equal(result.safety.narration_network_used, true);
  assert.equal(result.safety.external_publish_authorised, false);
});

test("canonicalises an exact inventory-bound RSS identity before autonomous production", async (t) => {
  const input = await fixture(t, {
    inventoryStoryId: "rss_locked_yazd_official",
    useRegistryPrimaryIdentity: true,
  });

  const result =
    await materialiseGovernedAutonomousOfficialCandidate(
      input.request,
      input.dependencies,
    );

  assert.equal(result.verdict, "GREEN");
  assert.equal(
    result.story_id,
    `official_${canonicalHash(input.locked.newsUrl)}`,
  );
  assert.equal(
    result.intake.legacy_story_id,
    "rss_locked_yazd_official",
  );
  assert.equal(
    result.intake.database_story_binding.database_story_id,
    "rss_locked_yazd_official",
  );
  assert.equal(
    result.intake.database_story_binding.canonical_story_id,
    result.story_id,
  );
  assert.equal(
    result.intake.database_story_binding.inventory_file_sha256,
    input.locked.registryFileSha256,
  );
});

test("binds commercial narration evidence to the later observed credit-governor timestamp without restamping deterministic media", async (t) => {
  const input = await fixture(t);
  const creditObservedAt = "2026-07-29T12:05:00.000Z";
  const generateNarration = input.dependencies.generateNarration;
  input.dependencies.generateNarration = async (request) => {
    const generated = await generateNarration(request);
    return {
      ...generated,
      credit_report: {
        ...generated.credit_report,
        generated_at: creditObservedAt,
      },
    };
  };

  const result =
    await materialiseGovernedAutonomousOfficialCandidate(
      input.request,
      input.dependencies,
    );
  const receipt = JSON.parse(
    await fs.readFile(
      result.narration.commercial_receipt_path,
      "utf8",
    ),
  );
  const narrationManifest = JSON.parse(
    await fs.readFile(result.narration.manifest_path, "utf8"),
  );
  const programmeManifest = JSON.parse(
    await fs.readFile(result.programme.source_manifest_path, "utf8"),
  );

  assert.equal(receipt.generated_at, creditObservedAt);
  assert.equal(
    receipt.account_entitlement.observed_at,
    creditObservedAt,
  );
  assert.equal(
    narrationManifest.licence.attested_at,
    creditObservedAt,
  );
  assert.equal(narrationManifest.generated_at, GENERATED_AT);
  assert.equal(programmeManifest.generated_at, GENERATED_AT);
});

test("closed request rejects authority smuggling before narration or rendering starts", async (t) => {
  const input = await fixture(t);

  await assert.rejects(
    () =>
      materialiseGovernedAutonomousOfficialCandidate(
        {
          ...input.request,
          publish_now: true,
        },
        input.dependencies,
      ),
    (error) =>
      error?.code ===
      "autonomous_production_request_fields_invalid",
  );
  assert.equal(input.generatedNarrations(), 0);
});
