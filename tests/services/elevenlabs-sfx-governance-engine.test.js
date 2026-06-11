"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildElevenLabsSfxGovernanceEngine,
  writeElevenLabsSfxGovernanceEngine,
} = require("../../lib/elevenlabs-sfx-governance-engine");

async function writeGeneratedAsset(root, role, overrides = {}) {
  const audioPath = path.join(root, `${role}.wav`);
  const body = Buffer.from(`${role}-audio-proof`);
  await fs.outputFile(audioPath, body);
  const sha256 = crypto.createHash("sha256").update(body).digest("hex");
  const sidecar = {
    asset_id: `elevenlabs_${role}_001`,
    role,
    family: role,
    provider_id: "elevenlabs_sfx",
    prompt: `Clean editorial ${role} for a gaming-news short, no voice, no copyrighted melody.`,
    model: "operator_selected_elevenlabs_sfx_model",
    generation_time: "2026-06-11T08:30:00.000Z",
    audio_path: audioPath,
    sha256,
    rights_note: "Generated for Pulse Gaming editorial videos under the retained ElevenLabs account terms.",
    terms_evidence_url: "https://elevenlabs.io/terms",
    allowed_use: "finished_editorial_video_only",
    commercial_use_allowed: true,
    duration_ms: 900,
    loudness_lufs: -18,
    true_peak_db: -2.1,
    reuse_limit: 12,
    usage_count: 2,
    ...overrides,
  };
  const sidecarPath = path.join(root, `${role}.elevenlabs-sfx.json`);
  await fs.outputJson(sidecarPath, sidecar, { spaces: 2 });
  return sidecarPath;
}

test("ElevenLabs SFX governance accepts hashed sidecars with rights, loudness and reuse evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-elevenlabs-sfx-ready-"));
  const sidecars = [
    await writeGeneratedAsset(root, "impact"),
    await writeGeneratedAsset(root, "transition"),
    await writeGeneratedAsset(root, "ui_tick"),
  ];

  const report = await buildElevenLabsSfxGovernanceEngine({
    workspaceRoot: root,
    sidecarPaths: sidecars,
    requiredRoles: ["impact", "transition", "ui_tick"],
    generatedAt: "2026-06-11T08:35:00.000Z",
    outputDir: path.join(root, "out"),
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.summary.accepted_asset_count, 3);
  assert.equal(report.summary.covered_role_count, 3);
  assert.deepEqual(report.blocker_counts, {});
  assert.equal(report.sfx_runtime_manifest.readiness.status, "ready");
  assert.equal(report.sfx_runtime_manifest.provider_id, "elevenlabs_sfx");
  assert.ok(report.sidecar_manifest.assets.every((asset) => asset.sha256_verified === true));
  assert.ok(report.rights_ledger.records.every((record) => record.commercial_use_allowed === true));
  assert.ok(report.loudness_qc.assets.every((asset) => asset.status === "pass"));
  assert.equal(report.reuse_policy.assets[0].status, "within_reuse_limit");
  assert.equal(report.safety.no_external_generation_started, true);
});

test("ElevenLabs SFX governance blocks unsafe generated assets", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-elevenlabs-sfx-blocked-"));
  const sidecarPath = await writeGeneratedAsset(root, "impact", {
    sha256: "not-the-real-hash",
    rights_note: "",
    true_peak_db: -0.1,
    reuse_limit: 2,
    usage_count: 3,
  });

  const report = await buildElevenLabsSfxGovernanceEngine({
    workspaceRoot: root,
    sidecarPaths: [sidecarPath],
    requiredRoles: ["impact", "transition"],
    generatedAt: "2026-06-11T08:35:00.000Z",
    outputDir: path.join(root, "out"),
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.ok(report.blocker_counts["elevenlabs_sfx:sha256_mismatch"] >= 1);
  assert.ok(report.blocker_counts["elevenlabs_sfx:rights_note_missing"] >= 1);
  assert.ok(report.blocker_counts["elevenlabs_sfx:true_peak_too_hot"] >= 1);
  assert.ok(report.blocker_counts["elevenlabs_sfx:reuse_limit_exceeded"] >= 1);
  assert.ok(report.blocker_counts["elevenlabs_sfx:missing_required_role:transition"] >= 1);
  assert.equal(report.sfx_runtime_manifest.readiness.status, "blocked");
});

test("ElevenLabs SFX governance writes all production proof artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-elevenlabs-sfx-write-"));
  const sidecarPath = await writeGeneratedAsset(root, "impact");
  const outputDir = path.join(root, "out");
  const report = await buildElevenLabsSfxGovernanceEngine({
    workspaceRoot: root,
    sidecarPaths: [sidecarPath],
    requiredRoles: ["impact"],
    generatedAt: "2026-06-11T08:35:00.000Z",
    outputDir,
  });

  const written = await writeElevenLabsSfxGovernanceEngine(report, { outputDir });

  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.generationPlan), true);
  assert.equal(await fs.pathExists(written.sidecarManifest), true);
  assert.equal(await fs.pathExists(written.rightsLedger), true);
  assert.equal(await fs.pathExists(written.loudnessQc), true);
  assert.equal(await fs.pathExists(written.reusePolicy), true);
  assert.equal(await fs.pathExists(written.sfxRuntimeManifest), true);
});
