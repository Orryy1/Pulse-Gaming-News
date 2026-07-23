"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  inspectGeneratedVoiceReference,
  materializeGeneratedNarrationRights,
  materializeGeneratedVoiceReviewPacket,
  validateGeneratedNarrationRightsEvidence,
} = require("../../lib/local-generated-voice-rights");

const MODEL_REVISION = "bffb3df5a29440629464e5e839f4d214c8714c3d";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function makeCandidate() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-generated-voice-"));
  const referencePath = path.join(root, "no_ref_default.wav");
  const auditionReportPath = path.join(root, "voice_audition_report.json");
  const audio = Buffer.from("model-generated no-reference voice candidate");
  await fs.writeFile(referencePath, audio);
  await fs.writeJson(auditionReportPath, {
    schema_version: 2,
    model: {
      id: "openbmb/VoxCPM2",
      revision: MODEL_REVISION,
      licence: "Apache-2.0",
      source_url: "https://huggingface.co/openbmb/VoxCPM2",
    },
    variants: [
      {
        name: "no_ref_default",
        path: referencePath,
        reference: null,
        prompt_text: false,
        generation_mode: "no_reference",
      },
    ],
  });
  return {
    root,
    referencePath,
    auditionReportPath,
    audioSha256: sha256(audio),
  };
}

test("generated local voice reference becomes GREEN only with no-reference lineage and matching human approval", async (t) => {
  const candidate = await makeCandidate();
  t.after(() => fs.remove(candidate.root));

  const result = await inspectGeneratedVoiceReference({
    referencePath: candidate.referencePath,
    auditionReportPath: candidate.auditionReportPath,
    variantName: "no_ref_default",
    humanReview: {
      status: "approved",
      reviewer: "pulse-operator",
      reviewed_at: "2026-07-23T11:30:00.000Z",
      candidate_sha256: candidate.audioSha256,
      no_impersonation_confirmed: true,
      quality_approved: true,
    },
  });

  assert.equal(result.verdict, "GREEN");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.reference.sha256, candidate.audioSha256);
  assert.equal(result.reference.generation_mode, "no_reference");
  assert.equal(result.reference.human_voice_source_used, false);
  assert.equal(result.model.id, "openbmb/VoxCPM2");
  assert.equal(result.model.licence, "Apache-2.0");
  assert.equal(result.human_review.status, "approved");
});

test("generated local voice reference remains RED while operator listening review is pending", async (t) => {
  const candidate = await makeCandidate();
  t.after(() => fs.remove(candidate.root));

  const result = await inspectGeneratedVoiceReference({
    referencePath: candidate.referencePath,
    auditionReportPath: candidate.auditionReportPath,
    variantName: "no_ref_default",
    humanReview: {
      status: "pending",
      candidate_sha256: candidate.audioSha256,
    },
  });

  assert.equal(result.verdict, "RED");
  assert.ok(result.blockers.includes("generated_voice_human_review_pending"));
  assert.ok(result.blockers.includes("generated_voice_human_reviewer_missing"));
  assert.ok(result.blockers.includes("generated_voice_human_review_time_missing"));
  assert.ok(result.blockers.includes("generated_voice_no_impersonation_unconfirmed"));
  assert.ok(result.blockers.includes("generated_voice_quality_unapproved"));
});

test("legacy no-reference audition materialises a hash-bound RED operator review packet", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-generated-voice-packet-"));
  t.after(() => fs.remove(root));
  const referencePath = path.join(root, "no_ref_default.wav");
  const legacyReportPath = path.join(root, "legacy_audition.json");
  const generatorScriptPath = path.join(root, "audition.py");
  const outDir = path.join(root, "packet");
  const audio = Buffer.from("legacy model-generated no-reference candidate");
  await fs.writeFile(referencePath, audio);
  await fs.writeFile(
    generatorScriptPath,
    'model = VoxCPM.from_pretrained("openbmb/VoxCPM2")\n',
  );
  await fs.writeJson(legacyReportPath, {
    model_sample_rate: 48000,
    variants: [{
      name: "no_ref_default",
      path: referencePath,
      reference: null,
      prompt_text: false,
    }],
  });

  const result = await materializeGeneratedVoiceReviewPacket({
    referencePath,
    legacyAuditionReportPath: legacyReportPath,
    generatorScriptPath,
    outDir,
    modelRevision: MODEL_REVISION,
    generatedAt: "2026-07-23T11:45:00.000Z",
  });

  assert.equal(result.review.verdict, "RED");
  assert.deepEqual(result.review.blockers, [
    "generated_voice_human_review_pending",
    "generated_voice_human_reviewer_missing",
    "generated_voice_human_review_time_missing",
    "generated_voice_no_impersonation_unconfirmed",
    "generated_voice_quality_unapproved",
  ]);
  assert.equal(result.evidence.provenance.kind, "legacy_audition_report_envelope");
  assert.equal(result.evidence.variants[0].sha256, sha256(audio));
  assert.equal(await fs.pathExists(result.paths.evidence_json), true);
  assert.equal(await fs.pathExists(result.paths.review_json), true);
  assert.equal(await fs.pathExists(result.paths.review_markdown), true);
});

test("approved generated reference produces a file-backed rights row bound to current narration bytes", async (t) => {
  const candidate = await makeCandidate();
  t.after(() => fs.remove(candidate.root));
  const artifactDir = path.join(candidate.root, "story-package");
  const audioPath = path.join(artifactDir, "audio", "narration.mp3");
  const narration = Buffer.from("current Pulse narration generated from approved model voice");
  await fs.outputFile(audioPath, narration);
  const approvedReview = await inspectGeneratedVoiceReference({
    referencePath: candidate.referencePath,
    auditionReportPath: candidate.auditionReportPath,
    humanReview: {
      status: "approved",
      reviewer: "pulse-operator",
      reviewed_at: "2026-07-23T11:30:00.000Z",
      candidate_sha256: candidate.audioSha256,
      no_impersonation_confirmed: true,
      quality_approved: true,
    },
  });
  const referenceReviewPath = path.join(candidate.root, "approved-review.json");
  await fs.writeJson(referenceReviewPath, approvedReview);

  const result = await materializeGeneratedNarrationRights({
    storyId: "fresh-story",
    audioPath,
    artifactDir,
    referenceReviewPath,
    generationReceipt: {
      schema_version: 1,
      provider_id: "pulse_local_tts",
      model_id: "openbmb/VoxCPM2",
      model_revision: MODEL_REVISION,
      generation_mode: "approved_generated_reference",
      reference_sha256: candidate.audioSha256,
      final_audio_sha256: sha256(narration),
      final_audio_size_bytes: narration.length,
      generated_at: "2026-07-23T11:59:00.000Z",
    },
    targetPlatforms: ["youtube", "tiktok"],
    generatedAt: "2026-07-23T12:00:00.000Z",
  });

  assert.equal(result.verdict, "GREEN");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.rights_record.asset_sha256, sha256(narration));
  assert.equal(result.rights_record.asset_size_bytes, narration.length);
  assert.equal(result.rights_record.commercial_use_allowed, true);
  assert.equal(result.rights_record.live_publish_allowed, true);
  assert.deepEqual(result.rights_record.allowed_platforms, ["youtube", "tiktok"]);
  assert.equal(result.evidence.lineage.reference_sha256, candidate.audioSha256);
  assert.equal(result.evidence.lineage.final_audio_sha256, sha256(narration));
  assert.equal(await fs.pathExists(result.paths.evidence_json), true);
});

test("generated narration rights validation rejects audio changed after the sidecar was written", async (t) => {
  const candidate = await makeCandidate();
  t.after(() => fs.remove(candidate.root));
  const audioPath = path.join(candidate.root, "story", "audio", "narration.mp3");
  const original = Buffer.from("original hash-bound narration");
  await fs.outputFile(audioPath, original);
  const approvedReview = await inspectGeneratedVoiceReference({
    referencePath: candidate.referencePath,
    auditionReportPath: candidate.auditionReportPath,
    humanReview: {
      status: "approved",
      reviewer: "pulse-operator",
      reviewed_at: "2026-07-23T11:30:00.000Z",
      candidate_sha256: candidate.audioSha256,
      no_impersonation_confirmed: true,
      quality_approved: true,
    },
  });
  const referenceReviewPath = path.join(candidate.root, "approved-review.json");
  await fs.writeJson(referenceReviewPath, approvedReview);
  const materialized = await materializeGeneratedNarrationRights({
    storyId: "tamper-story",
    audioPath,
    artifactDir: path.join(candidate.root, "story"),
    referenceReviewPath,
    generationReceipt: {
      schema_version: 1,
      provider_id: "pulse_local_tts",
      model_id: "openbmb/VoxCPM2",
      model_revision: MODEL_REVISION,
      generation_mode: "approved_generated_reference",
      reference_sha256: candidate.audioSha256,
      final_audio_sha256: sha256(original),
      final_audio_size_bytes: original.length,
      generated_at: "2026-07-23T11:59:00.000Z",
    },
    targetPlatforms: ["youtube"],
  });
  await fs.writeFile(audioPath, Buffer.from("changed narration bytes"));

  const validation = await validateGeneratedNarrationRightsEvidence({
    evidence: materialized.evidence,
    audioPath,
    targetPlatforms: ["youtube"],
  });

  assert.equal(validation.verdict, "RED");
  assert.ok(validation.blockers.includes("generated_narration_audio_hash_mismatch"));
  assert.ok(validation.blockers.includes("generated_narration_audio_size_mismatch"));
});
