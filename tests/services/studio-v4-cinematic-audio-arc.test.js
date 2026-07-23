"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CINEMATIC_AUDIO_ARC_VERSION,
  buildCinematicAudioArc,
  buildCinematicBedFilters,
  cinematicCueTiming,
  loadGovernedCinematicSoundscapeRuntime,
  selectCinematicSoundscapeAsset,
} = require("../../lib/studio/v4/cinematic-audio-arc");
const {
  buildSelectedInputAssetEvidence,
  resolveStorySoundscapeMix,
} = require("../../tools/studio-v4-proof-render");

function governedElevenLabsSoundscape(role = "tension_bed", id = "el-tension-01") {
  return {
    asset_id: id,
    role,
    family: role,
    provider_id: "elevenlabs_sfx",
    path: `C:/audio/${id}.wav`,
    approval_status: "approved_for_commercial_editorial_use",
    commercial_use_allowed: true,
    allowed_use: "finished_editorial_video_only",
    rights_note: "Generated during a paid ElevenLabs subscription for Pulse Gaming.",
    elevenlabs_governance: {
      sidecar_path: `C:/audio/${id}.elevenlabs-sfx.json`,
      sha256: "a".repeat(64),
      sha256_verified: true,
      loudness_qc_status: "pass",
      reuse_status: "within_reuse_limit",
    },
  };
}

test("cinematic audio arc selects a governed tension bed and creates a proof-beat micro-drop", () => {
  const soundscape = governedElevenLabsSoundscape();
  const arc = buildCinematicAudioArc({
    story: {
      id: "breaking-xbox-story",
      breaking_fast_track: true,
      sound_transition_plan: {
        sfx: {
          cues: [
            { family: "impact", target_kind: "hook_slam", atS: 0 },
            { family: "source_tick", target_kind: "source_lock", atS: 7.2 },
          ],
        },
      },
    },
    durationS: 42,
    soundscapeAssets: [soundscape],
  });

  assert.equal(arc.version, CINEMATIC_AUDIO_ARC_VERSION);
  assert.equal(arc.desired_soundscape_role, "tension_bed");
  assert.equal(arc.soundscape.asset_id, soundscape.asset_id);
  assert.equal(arc.soundscape.secondary_layer_only, true);
  assert.equal(arc.micro_drop_windows.length, 1);
  assert.equal(arc.micro_drop_windows[0].target_kind, "source_lock");
  assert.equal(arc.micro_drop_windows[0].start_s, 7.08);
  assert.equal(arc.micro_drop_windows[0].end_s, 7.28);
  assert.equal(arc.policy.narration_priority, true);
  assert.equal(arc.policy.max_soundscape_layers, 1);
});

test("cinematic soundscape selection rejects ungoverned generated audio and accepts retained Epidemic evidence", () => {
  const ungoverned = {
    ...governedElevenLabsSoundscape("ambience", "unsafe-generated"),
    commercial_use_allowed: false,
  };
  const epidemic = {
    asset_id: "epidemic-ambience-01",
    role: "ambience",
    provider_id: "epidemic_sound",
    path: "C:/audio/epidemic-ambience.wav",
    approval_status: "approved_for_commercial_editorial_use",
    commercial_use_allowed: true,
    licence_basis: "epidemic_sound_active_subscription_safelisted_channel",
    evidence_reference: "C:/evidence/epidemic-safelist.json",
  };

  const selected = selectCinematicSoundscapeAsset({
    story: { id: "confirmed-story", flair: "Verified" },
    assets: [ungoverned, epidemic],
  });

  assert.equal(selected.asset_id, epidemic.asset_id);
  assert.equal(selected.role, "ambience");
  assert.equal(selected.secondary_layer_only, true);
});

test("cinematic bed filters sidechain the soundscape and create a short reveal dropout", () => {
  const filters = buildCinematicBedFilters({
    inputIndex: 4,
    voiceSidechainLabel: "a_voice_soundscape_sc",
    outputLabel: "a_soundscape",
    durationS: 42,
    microDropWindows: [{ start_s: 7.08, end_s: 7.28 }],
  });
  const graph = filters.join(";");

  assert.match(graph, /\[4:a\].*highpass=f=45.*lowpass=f=7200/);
  assert.match(graph, /\[a_soundscape_raw\]\[a_voice_soundscape_sc\]sidechaincompress/);
  assert.match(graph, /volume=0\.180:enable='between\(t,7\.080,7\.280\)'/);
  assert.match(graph, /\[a_soundscape\]$/);
});

test("cinematic risers pre-lap their target while impacts still land on the edit beat", () => {
  const riser = cinematicCueTiming({
    role: "riser",
    targetDelayMs: 8200,
    durationS: 0.55,
  });
  const impact = cinematicCueTiming({
    role: "impact",
    targetDelayMs: 8200,
    durationS: 0.32,
  });

  assert.equal(riser.delayMs, 7732);
  assert.equal(riser.landsAtMs, 8200);
  assert.equal(riser.preLapped, true);
  assert.equal(impact.delayMs, 8200);
  assert.equal(impact.preLapped, false);
});

test("V4 renderer resolves a governed soundscape and records it as a selected render input", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-v4-soundscape-"));
  t.after(() => fs.remove(root));
  const audioPath = path.join(root, "tension.wav");
  const narrationPath = path.join(root, "narration.wav");
  await fs.outputFile(audioPath, Buffer.alloc(2048, 3));
  await fs.outputFile(narrationPath, Buffer.alloc(2048, 4));
  const story = {
    id: "breaking-render-story",
    breaking_fast_track: true,
    soundscape_asset_inventory: [
      {
        ...governedElevenLabsSoundscape("tension_bed", "render-tension"),
        path: audioPath,
      },
    ],
  };

  const mix = await resolveStorySoundscapeMix(story, { durationS: 38 });
  assert.equal(mix.asset.asset_id, "render-tension");
  assert.equal(mix.arc.version, CINEMATIC_AUDIO_ARC_VERSION);

  const evidence = buildSelectedInputAssetEvidence({
    story,
    audioPath: narrationPath,
    selectedClips: [],
    scenePlan: { scenes: [] },
    soundscapeMix: mix,
  });
  const selected = evidence.assets.find((asset) => asset.kind === "soundscape");
  assert.equal(selected.asset_id, "render-tension");
  assert.equal(selected.role, "tension_bed");
});

test("cinematic soundscape runtime loader verifies the governed audio hash before autonomous use", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-soundscape-runtime-"));
  t.after(() => fs.remove(root));
  const outputDir = path.join(root, "output", "elevenlabs-cinematic-soundscapes");
  const audioDir = path.join(root, "audio", "elevenlabs", "sfx", "cinematic-v1");
  const audioPath = path.join(audioDir, "ambience.wav");
  const sidecarPath = path.join(audioDir, "ambience.elevenlabs-sfx.json");
  await fs.outputFile(audioPath, Buffer.alloc(2048, 6));
  const sha256 = crypto
    .createHash("sha256")
    .update(await fs.readFile(audioPath))
    .digest("hex");
  await fs.outputJson(sidecarPath, {
    asset_id: "runtime-ambience",
    role: "ambience",
    audio_path: audioPath,
    sha256,
  });
  const manifestPath = path.join(
    outputDir,
    "elevenlabs_sfx_runtime_manifest.json",
  );
  await fs.outputJson(manifestPath, {
    readiness: { status: "ready", blockers: [] },
    selected_assets: [
      {
        asset_id: "runtime-ambience",
        role: "ambience",
        provider_id: "elevenlabs_sfx",
        audio_path: audioPath,
        sidecar_path: sidecarPath,
        sha256,
        sha256_verified: true,
        status: "accepted",
        rights_note: "Generated under a paid ElevenLabs plan.",
        allowed_use: "finished_editorial_video_only",
        commercial_use_allowed: true,
      },
    ],
    variant_assets_by_role: {
      ambience: [
        {
          asset_id: "runtime-ambience",
          role: "ambience",
          provider_id: "elevenlabs_sfx",
          path: audioPath,
          approval_status: "approved_for_commercial_editorial_use",
          elevenlabs_governance: {
            sidecar_path: sidecarPath,
            sha256,
            sha256_verified: true,
            loudness_qc_status: "pass",
            reuse_status: "within_reuse_limit",
          },
        },
      ],
    },
  });

  const ready = await loadGovernedCinematicSoundscapeRuntime({
    workspaceRoot: root,
    manifestPath,
  });
  assert.equal(ready.status, "ready");
  assert.equal(ready.assets[0].asset_id, "runtime-ambience");

  await fs.writeFile(audioPath, Buffer.alloc(2048, 7));
  const tampered = await loadGovernedCinematicSoundscapeRuntime({
    workspaceRoot: root,
    manifestPath,
  });
  assert.equal(tampered.status, "blocked");
  assert.ok(
    tampered.blockers.includes(
      "cinematic_soundscape_audio_hash_mismatch:runtime-ambience",
    ),
  );
});
