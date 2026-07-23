"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CINEMATIC_SOUNDSCAPE_SLOTS,
  buildCinematicSoundscapeGenerationPlan,
  materializeCinematicSoundscapePack,
} = require("../../lib/elevenlabs-cinematic-soundscape-generator");

test("cinematic soundscape generation plan is bounded, narration-safe and credit transparent", () => {
  const plan = buildCinematicSoundscapeGenerationPlan({
    generatedAt: "2026-07-23T15:00:00.000Z",
  });

  assert.deepEqual(
    plan.slots.map((slot) => slot.role),
    ["ambience", "drone", "tension_bed"],
  );
  assert.equal(plan.estimated_credit_cost, 1280);
  assert.ok(plan.slots.every((slot) => slot.loop === true));
  assert.ok(plan.slots.every((slot) => /no (?:recognisable|copyrighted) melody/i.test(slot.prompt)));
  assert.equal(plan.safety.no_external_generation_started, true);
});

test("cinematic soundscape materializer writes governed sidecars and a ready runtime manifest", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cinematic-soundscape-"));
  t.after(() => fs.remove(root));
  const calls = [];

  const result = await materializeCinematicSoundscapePack({
    workspaceRoot: root,
    audioOutputDir: path.join(root, "audio", "elevenlabs", "sfx", "cinematic-v1"),
    governanceOutputDir: path.join(root, "output", "elevenlabs-cinematic-soundscapes"),
    generatedAt: "2026-07-23T15:05:00.000Z",
    apiKey: "test-key",
    requestSoundEffect: async (request) => {
      calls.push(request);
      return {
        audio: Buffer.from(`raw-${request.role}`),
        request_id: `request-${request.role}`,
        character_cost: request.duration_seconds * 40,
      };
    },
    masterAudio: async ({ inputPath, outputPath }) => {
      await fs.copy(inputPath, outputPath);
    },
    analyseAudio: async ({ slot }) => ({
      duration_ms: slot.duration_seconds * 1000,
      loudness_lufs: -24,
      true_peak_db: -3,
    }),
  });

  assert.equal(calls.length, CINEMATIC_SOUNDSCAPE_SLOTS.length);
  assert.equal(result.governance.verdict, "PASS");
  assert.equal(result.governance.summary.accepted_asset_count, 3);
  assert.equal(result.runtime_manifest.readiness.status, "ready");
  assert.deepEqual(result.runtime_manifest.required_roles, [
    "ambience",
    "drone",
    "tension_bed",
  ]);
  assert.equal(result.generation_receipt.external_api_calls, 3);
  assert.equal(result.generation_receipt.credits_reported, 1280);

  for (const asset of result.assets) {
    assert.equal(await fs.pathExists(asset.audio_path), true);
    assert.equal(await fs.pathExists(asset.sidecar_path), true);
    const sidecar = await fs.readJson(asset.sidecar_path);
    assert.equal(sidecar.commercial_use_allowed, true);
    assert.equal(sidecar.secondary_layer_only, true);
    assert.equal(sidecar.raw_redistribution_allowed, false);
    assert.match(sidecar.sha256, /^[a-f0-9]{64}$/);
  }
});
