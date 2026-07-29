"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  stageAutonomousOfficialCandidate,
} = require("../../lib/services/autonomous-official-candidate-staging");
const {
  assessPublicationEvidence,
} = require("../../lib/services/publication-evidence-gates");
const {
  validateAutonomousOfficialJitPreparationManifest,
} = require("../../lib/services/autonomous-official-jit-admission-packet");

const STORY_ID = "official_3b8d305c4e17";
const SHA = {
  candidate: "c".repeat(64),
  request: "d".repeat(64),
};
const ARTIFACT_FIELDS = [
  "story_intake",
  "source_evidence",
  "owned_motion_manifest",
  "owned_motion_source_manifest",
  "owned_programme",
  "narration_audio",
  "narration_manifest",
  "narration_licence_evidence",
  "final_composite_manifest",
  "renderer_manifest",
  "deterministic_qa",
  "multimodal_visual_qa",
  "final_mp4",
  "publication_metadata",
  "autonomous_green_supplement",
];

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeFile(root, relativePath, bytes) {
  const absolutePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, bytes);
  return {
    source_path: absolutePath,
    sha256: sha256(bytes),
  };
}

async function rewriteJsonReference(reference, mutate) {
  const value = JSON.parse(await fs.readFile(reference.source_path, "utf8"));
  mutate(value);
  const bytes = jsonBytes(value);
  await fs.writeFile(reference.source_path, bytes);
  reference.sha256 = sha256(bytes);
}

async function fixture() {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-candidate-staging-"),
  );
  const sourceRepository = path.join(root, "source-repository");
  const candidateSource = path.join(
    sourceRepository,
    "output",
    "canary",
    STORY_ID,
  );
  const externalSource = path.join(root, "external-render");
  const workspace = path.join(root, "trusted-workspace");
  await Promise.all([
    fs.mkdir(candidateSource, { recursive: true }),
    fs.mkdir(externalSource, { recursive: true }),
    fs.mkdir(workspace, { recursive: true }),
  ]);

  const programme = await writeFile(
    externalSource,
    "owned-programme.mp4",
    Buffer.from("exact-owned-programme", "utf8"),
  );
  const narration = await writeFile(
    candidateSource,
    "narration/narration.mp3",
    Buffer.from("licensed-narration", "utf8"),
  );
  const finalMp4 = await writeFile(
    candidateSource,
    "final/final.mp4",
    Buffer.from("exact-final-mp4", "utf8"),
  );
  const scriptSha256 = sha256(Buffer.from("Exact locked narration", "utf8"));
  const visualAssets = [];
  const motionAssetValues = [];
  for (let index = 1; index <= 6; index += 1) {
    const assetId = `owned-scene-${index}`;
    const asset = await writeFile(
      candidateSource,
      `motion/${String(index).padStart(2, "0")}.mp4`,
      Buffer.from(`owned-scene-${index}`, "utf8"),
    );
    visualAssets.push({
      asset_id: assetId,
      ...asset,
    });
    motionAssetValues.push({
      asset_id: assetId,
      path: `${String(index).padStart(2, "0")}.mp4`,
      sha256: asset.sha256,
      ownership: "owned",
      rights_basis: "OWNED",
      attribution_required: false,
      provenance: {
        source: "authored_motion_scene",
        source_programme_sha256: programme.sha256,
        source_programme_audio_streams: 0,
        third_party_media_used: false,
        third_party_music: false,
      },
    });
  }
  const sourceMotionManifest = await writeFile(
    candidateSource,
    "motion/owned-motion-manifest.json",
    jsonBytes({
      schema_version: "pulse-owned-motion-manifest-v1",
      story_id: STORY_ID,
      assets: motionAssetValues,
      combination: {
        mode: "LOCAL_PROOF",
        source_programme_sha256: programme.sha256,
        source_programme_audio_streams: 0,
        third_party_media_used: false,
        third_party_music: false,
      },
    }),
  );
  const finalMotionManifest = await writeFile(
    candidateSource,
    "final/combined-owned-motion-manifest.json",
    jsonBytes({
      schema_version: "pulse-owned-motion-manifest-v1",
      story_id: STORY_ID,
      assets: [
        ...motionAssetValues,
        {
          asset_id: "owned-programme",
          path: programme.source_path,
          sha256: programme.sha256,
          ownership: "owned",
          rights_basis: "OWNED",
          attribution_required: false,
          provenance: {
            source: "authored_motion_programme",
            source_programme_sha256: programme.sha256,
            source_programme_audio_streams: 0,
            third_party_media_used: false,
            third_party_music: false,
          },
        },
      ],
      combination: {
        mode: "LOCAL_PROOF",
        source_manifest: {
          path: "../motion/owned-motion-manifest.json",
          sha256: sourceMotionManifest.sha256,
        },
        third_party_media_used: false,
      },
    }),
  );
  const receipt = await writeFile(
    candidateSource,
    "narration/elevenlabs-generation-receipt.json",
    jsonBytes({
      schema: "pulse_elevenlabs_generation_receipt_v1",
      schema_version: 1,
      story_id: STORY_ID,
      verdict: "AMBER",
      generation_verdict: "GREEN",
      final_media_lineage_status: "PENDING",
      commercial_use_allowed: false,
      provider: {
        id: "elevenlabs",
        model_id: "eleven_multilingual_v2",
      },
      account_entitlement: {
        paid_at_generation: true,
      },
      generation: {
        request_text_sha256: scriptSha256,
      },
      generation_checks: {
        every_generation_condition_proven: true,
      },
      generation_blockers: [],
      blockers: ["final_media_lineage_pending"],
      licence_basis: "elevenlabs_commercial_tts_generation",
      allowed_platforms: ["youtube_shorts"],
      mastering_lineage: {
        mastered_audio_sha256: narration.sha256,
        transform_status: "COMPLETE",
        post_generation_transform_status: "COMPLETE",
      },
    }),
  );
  const candidateRelativeRoot = `output/canary/${STORY_ID}`;
  const narrationManifest = await writeFile(
    candidateSource,
    "narration/governed-narration-manifest.json",
    jsonBytes({
      schema_version: "pulse-governed-narration-manifest-v1",
      story_id: STORY_ID,
      script: {
        sha256: scriptSha256,
        exact_alignment_match: true,
      },
      narration: {
        provider: "elevenlabs",
        model_id: "eleven_multilingual_v2",
      },
      licence: {
        rights_basis: "LICENSED",
        evidence_reference:
          `${candidateRelativeRoot}/narration/` +
          "elevenlabs-generation-receipt.json",
      },
      sources: {
        audio: {
          expected_sha256: narration.sha256,
          pre_apply_sha256: narration.sha256,
          post_apply_sha256: narration.sha256,
          mutated: false,
        },
      },
    }),
  );
  const renderer = await writeFile(
    candidateSource,
    "final/renderer-manifest.json",
    jsonBytes({
      schema_version: "pulse-render-manifest-v1",
      story_id: STORY_ID,
      channel_id: "pulse-gaming",
      inputs: [
        {
          role: "motion",
          sha256: programme.sha256,
          embedded_in_final: true,
        },
        {
          role: "narration",
          sha256: narration.sha256,
          embedded_in_final: true,
        },
      ],
      output: {
        sha256: finalMp4.sha256,
      },
    }),
  );
  const finalComposite = await writeFile(
    candidateSource,
    "final/final-composite-manifest.json",
    jsonBytes({
      schema_version: "pulse-governed-final-composite-v1",
      story_id: STORY_ID,
      channel_id: "pulse-gaming",
      inputs: {
        owned_motion_manifest: {
          sha256: finalMotionManifest.sha256,
        },
        hyperframes_intermediate: {
          sha256: programme.sha256,
        },
        narration_audio: {
          sha256: narration.sha256,
        },
        governed_narration_manifest: {
          sha256: narrationManifest.sha256,
        },
      },
      ffmpeg: {
        background_music_used: false,
        sound_effects_used: false,
        mix_mode: "GOVERNED_NARRATION_ONLY",
        programme_audio_present: false,
        programme_audio_mapped: false,
      },
      renderer_manifest: {
        file_sha256: renderer.sha256,
      },
      output: {
        sha256: finalMp4.sha256,
      },
    }),
  );
  const deterministicQa = await writeFile(
    candidateSource,
    "final/final-render-qa.json",
    jsonBytes({
      schema_version: "pulse-final-render-qa-v1",
      story_id: STORY_ID,
      channel_id: "pulse-gaming",
      verdict: "PASS",
      media_sha256: finalMp4.sha256,
      script_sha256: scriptSha256,
      platform_video_qa: {
        result: "pass",
        failures: [],
      },
      audio: {
        source_sha256: narration.sha256,
        mix_mode: "GOVERNED_NARRATION_ONLY",
        background_music_used: false,
        sound_effects_used: false,
        programme_audio_present: false,
        programme_audio_mapped: false,
      },
    }),
  );
  const storyIntake = await writeFile(
    candidateSource,
    "intake/story-intake.json",
    jsonBytes({
      schema_version: "pulse-governed-story-intake-v1",
      story_id: STORY_ID,
    }),
  );
  const sourceEvidence = await writeFile(
    candidateSource,
    "intake/source-evidence.json",
    jsonBytes({
      schema_version: "pulse-breaking-source-evidence-v1",
      story_id: STORY_ID,
    }),
  );
  const visualQa = await writeFile(
    candidateSource,
    "proof/visual-qa.json",
    jsonBytes({
      schema_version: "pulse-local-multimodal-visual-review-v1",
      story_id: STORY_ID,
      verdict: "PASS",
      blockers: [],
      bindings: {
        final_mp4: {
          sha256: finalMp4.sha256,
        },
      },
    }),
  );
  const metadata = await writeFile(
    candidateSource,
    "publication/youtube-shorts-metadata.json",
    jsonBytes({
      schema_version: "pulse-governed-publication-metadata-v1",
      story_id: STORY_ID,
      channel_id: "pulse-gaming",
      platform: "youtube_shorts",
    }),
  );
  const autonomousGreenSupplement = await writeFile(
    candidateSource,
    "evidence/autonomous-green-supplement.json",
    jsonBytes({
      schema_version: "pulse-autonomous-green-supplement-v1",
      mode: "LOCAL_PROOF",
      verdict: "GREEN",
      story_id: STORY_ID,
    }),
  );

  const artifacts = {
    story_intake: storyIntake,
    source_evidence: sourceEvidence,
    owned_motion_manifest: finalMotionManifest,
    owned_motion_source_manifest: sourceMotionManifest,
    owned_programme: programme,
    narration_audio: narration,
    narration_manifest: narrationManifest,
    narration_licence_evidence: receipt,
    final_composite_manifest: finalComposite,
    renderer_manifest: renderer,
    deterministic_qa: deterministicQa,
    multimodal_visual_qa: visualQa,
    final_mp4: finalMp4,
    publication_metadata: metadata,
    autonomous_green_supplement: autonomousGreenSupplement,
  };
  assert.deepEqual(Object.keys(artifacts).sort(), [...ARTIFACT_FIELDS].sort());

  return {
    root,
    sourceRepository,
    candidateSource,
    externalSource,
    workspace,
    programme,
    narration,
    artifacts,
    visualAssets,
    request: {
      schema_version: "pulse-autonomous-official-candidate-staging-request-v2",
      mode: "LOCAL_PROOF",
      story_id: STORY_ID,
      channel_id: "pulse-gaming",
      lane_id: "breaking_short",
      platform: "youtube",
      scheduled_for: "2026-07-29T19:00:00.000Z",
      role: "PRIMARY",
      candidate_revision_sha256: SHA.candidate,
      request_fingerprint: SHA.request,
      generated_at: "2026-07-29T17:40:00.000Z",
      workspace_root: workspace,
      candidate_source_root: candidateSource,
      candidate_workspace_relative_root: candidateRelativeRoot,
      allowed_external_source_roots: [externalSource],
      artifacts,
      owned_visual_assets: visualAssets,
      synthetic_media_disclosure: {
        decision_authority: "SYSTEM_POLICY",
        altered_content: true,
        policy_basis: "DISCLOSE",
        youtube_field_value: true,
        decision_provenance: {
          policy_id: "pulse-youtube-synthetic-media",
          policy_version: "1",
          evaluated_at: "2026-07-29T17:39:59.000Z",
          evidence_sha256: finalComposite.sha256,
        },
      },
    },
  };
}

test("LOCAL_PROOF staging emits a JIT-valid closed packet with monetisation-scoped rights evidence", async (t) => {
  const input = await fixture();
  t.after(() => fs.rm(input.root, { recursive: true, force: true }));

  const result = await stageAutonomousOfficialCandidate(input.request);
  const manifest = validateAutonomousOfficialJitPreparationManifest(
    result.preparation_manifest,
  );

  assert.equal(result.verdict, "GREEN");
  assert.deepEqual(result.blockers, []);
  assert.equal(manifest.story_id, STORY_ID);
  assert.equal(
    manifest.artifacts.owned_programme.sha256,
    input.programme.sha256,
  );
  assert.equal(
    manifest.publication_evidence_gate_input.synthetic_media_disclosure
      .decision_authority,
    "SYSTEM_POLICY",
  );
  assert.equal(
    assessPublicationEvidence(manifest.publication_evidence_gate_input)
      .eligible,
    true,
  );
  assert.deepEqual(
    await fs.readFile(
      path.join(input.workspace, manifest.artifacts.owned_programme.path),
    ),
    Buffer.from("exact-owned-programme", "utf8"),
  );
  assert.equal(result.monetisation_scope.platform_advertising, "CLEARED");
  assert.equal(result.monetisation_scope.sponsorship, "NOT_ESTABLISHED");
  assert.equal(result.safety.database_mutated, false);
  assert.equal(result.safety.oauth_or_tokens_mutated, false);
  assert.equal(result.safety.platform_contacted, false);
  assert.equal(result.safety.network_used, false);
});

test("staging preserves case-sensitive candidate paths for later Linux JIT resolution", async (t) => {
  const input = await fixture();
  t.after(() => fs.rm(input.root, { recursive: true, force: true }));
  const original = input.request.artifacts.publication_metadata.source_path;
  const renamed = path.join(
    input.candidateSource,
    "Publication",
    "YouTube-Metadata.JSON",
  );
  await fs.mkdir(path.dirname(renamed), { recursive: true });
  await fs.rename(original, renamed);
  input.request.artifacts.publication_metadata.source_path = renamed;

  const result = await stageAutonomousOfficialCandidate(input.request);

  assert.equal(
    result.preparation_manifest.artifacts.publication_metadata.path,
    `output/canary/${STORY_ID}/Publication/YouTube-Metadata.JSON`,
  );
  assert.ok(
    (
      await fs.readdir(path.join(input.workspace, "output", "canary", STORY_ID))
    ).includes("Publication"),
  );
});

test("staging fails closed when the pending ElevenLabs receipt is not fully master-lineage bound", async (t) => {
  const input = await fixture();
  t.after(() => fs.rm(input.root, { recursive: true, force: true }));
  await rewriteJsonReference(
    input.request.artifacts.narration_licence_evidence,
    (receipt) => {
      receipt.mastering_lineage.post_generation_transform_status = "PENDING";
    },
  );

  await assert.rejects(
    () => stageAutonomousOfficialCandidate(input.request),
    (error) => {
      assert.deepEqual(error.blockers, [
        "candidate_staging_narration_commercial_lineage_unproven",
      ]);
      return true;
    },
  );
  await assert.rejects(
    fs.lstat(path.join(input.workspace, "output", "canary", STORY_ID)),
    { code: "ENOENT" },
  );
});

test("staging refuses an existing candidate destination instead of overwriting it", async (t) => {
  const input = await fixture();
  t.after(() => fs.rm(input.root, { recursive: true, force: true }));
  const destination = path.join(input.workspace, "output", "canary", STORY_ID);
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(
    path.join(destination, "operator-file.txt"),
    "preserve me",
  );

  await assert.rejects(
    () => stageAutonomousOfficialCandidate(input.request),
    (error) => {
      assert.ok(
        error.blockers.includes("candidate_staging_destination_exists"),
      );
      return true;
    },
  );
  assert.equal(
    await fs.readFile(path.join(destination, "operator-file.txt"), "utf8"),
    "preserve me",
  );
});

test("staging rejects a hash-bound source that escapes all allowed roots", async (t) => {
  const input = await fixture();
  t.after(() => fs.rm(input.root, { recursive: true, force: true }));
  const outside = await writeFile(
    input.root,
    "outside/metadata.json",
    jsonBytes({
      schema_version: "pulse-governed-publication-metadata-v1",
      story_id: STORY_ID,
    }),
  );
  input.request.artifacts.publication_metadata = outside;

  await assert.rejects(
    () => stageAutonomousOfficialCandidate(input.request),
    (error) => {
      assert.deepEqual(error.blockers, [
        "candidate_staging_publication_metadata_outside_allowed_root",
      ]);
      return true;
    },
  );
});
