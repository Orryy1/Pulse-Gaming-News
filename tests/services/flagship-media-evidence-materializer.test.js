"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const materializerApi = require("../../lib/flagship-media-evidence-materializer");
const {
  createTrustedRenderInputInventory,
  materializeFlagshipMediaEvidence: publicMaterializeFlagshipMediaEvidence,
} = require("../../lib/flagship-media-evidence-materializer");

async function materializeFlagshipMediaEvidence(options) {
  const trustedRenderInputs = await createTrustedRenderInputInventory({
    packageDir: options.packageDir,
    inventory: options.inventory,
  });
  return publicMaterializeFlagshipMediaEvidence({ ...options, trustedRenderInputs });
}

test("RED: public API exposes no unrestricted verifier seams or binary overrides", async () => {
  assert.equal(Object.hasOwn(materializerApi, "_testables"), false);
  assert.equal(Object.hasOwn(materializerApi, "defaultProbeMedia"), false);
  assert.equal(Object.hasOwn(materializerApi, "defaultDecodeMedia"), false);

  await assert.rejects(
    () => publicMaterializeFlagshipMediaEvidence({
      packageDir: "unused-package",
      inventory: {},
      outputDir: "unused-output",
      ffprobePath: process.execPath,
    }),
    /caller-selected verifier binaries are forbidden/,
  );
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function writeFixtureFile(packageDir, relativePath, contents) {
  const target = path.join(packageDir, relativePath);
  await fs.ensureDir(path.dirname(target));
  await fs.writeFile(target, contents);
  return target;
}

function rights(assetId, kind, relativePath, evidenceFile, overrides = {}) {
  return {
    asset_id: assetId,
    kind,
    path: relativePath,
    source_url: `https://example.test/assets/${assetId}`,
    creator: "Fixture Creator",
    licence_basis: "licensed editorial use",
    commercial_use_allowed: true,
    rights_verdict: "GREEN",
    evidence_file: evidenceFile,
    allowed_platforms: ["youtube_shorts", "tiktok", "instagram_reels"],
    ...overrides,
  };
}

let realMediaTemplatePromise;

async function realMediaTemplate() {
  if (!realMediaTemplatePromise) {
    realMediaTemplatePromise = (async () => {
      const templateDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-flagship-real-media-"));
      await fs.ensureDir(path.join(templateDir, "final"));
      await fs.ensureDir(path.join(templateDir, "audio"));
      await fs.ensureDir(path.join(templateDir, "assets"));
      const runFfmpeg = (args) => execFileSync("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y", ...args,
      ], { stdio: "ignore", windowsHide: true });
      runFfmpeg([
        "-f", "lavfi", "-i", "color=c=0x112233:s=1080x1920:r=5:d=1",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-ar", "48000", "-ac", "2", "-shortest",
        "-movflags", "+faststart", "-brand", "mp42",
        path.join(templateDir, "final/final.mp4"),
      ]);
      runFfmpeg([
        "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:duration=1",
        "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "1",
        path.join(templateDir, "audio/narration.wav"),
      ]);
      runFfmpeg([
        "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=1",
        "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "1",
        path.join(templateDir, "assets/music.wav"),
      ]);
      runFfmpeg([
        "-f", "lavfi", "-i", "color=c=red:s=64x64:d=0.1",
        "-frames:v", "1", "-update", "1", path.join(templateDir, "assets/card.png"),
      ]);
      runFfmpeg([
        "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=0.1",
        "-frames:v", "1", "-update", "1", path.join(templateDir, "assets/backdrop.png"),
      ]);
      return templateDir;
    })();
  }
  return realMediaTemplatePromise;
}

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-flagship-evidence-"));
  const packageDir = path.join(root, "immutable-package");
  const outputDir = path.join(root, "proof");
  await fs.copy(await realMediaTemplate(), packageDir);

  const video = await fs.readFile(path.join(packageDir, "final/final.mp4"));
  const audio = await fs.readFile(path.join(packageDir, "audio/narration.wav"));
  const script = Buffer.from("Pulse\n");
  const captions = Buffer.from("1\n00:00:00,000 --> 00:00:01,000\nPulse\n");
  const timestamps = Buffer.from(JSON.stringify({
    complete: true,
    audio_sha256: sha256(audio),
    script_sha256: sha256(script),
    captions_sha256: sha256(captions),
    words: [{ word: "Pulse", start: 0, end: 1 }],
  }));
  const runId = "flagship-run-0001";

  await writeFixtureFile(packageDir, "scripts/final_script.txt", script);
  await writeFixtureFile(packageDir, "captions/word_timestamps.json", timestamps);
  await writeFixtureFile(packageDir, "captions/captions.srt", captions);
  await fs.ensureDir(path.join(packageDir, "manifests"));
  await fs.writeJson(path.join(packageDir, "manifests/generation_manifest.json"), {
    schema_version: 1,
    complete: true,
    producer_id: "pulse-gaming-flagship-renderer",
    run_id: runId,
    script_sha256: sha256(script),
    artifacts: {
      final_video: { path: "final/final.mp4", sha256: sha256(video), run_id: runId, script_sha256: sha256(script) },
      final_audio: { path: "audio/narration.wav", sha256: sha256(audio), run_id: runId, script_sha256: sha256(script) },
      word_timestamps: { path: "captions/word_timestamps.json", sha256: sha256(timestamps), run_id: runId, script_sha256: sha256(script) },
      captions: { path: "captions/captions.srt", sha256: sha256(captions), run_id: runId, script_sha256: sha256(script) },
      script: { path: "scripts/final_script.txt", sha256: sha256(script), run_id: runId, script_sha256: sha256(script) },
    },
  }, { spaces: 2 });

  const inventory = {
    schema_version: 1,
    story_id: "flagship-story-1",
    complete: true,
    verdict: "GREEN",
    blockers: [],
    episode_contract: {
      final_video: {
        width: 1080,
        height: 1920,
        aspect_ratio: "9:16",
        video_codec: "h264",
        audio_codec: "aac",
        audio_sample_rate_hz: 48000,
        require_audio: true,
      },
    },
    generation_manifest: { path: "manifests/generation_manifest.json" },
    final_outputs: {
      video: { path: "final/final.mp4" },
      audio: { path: "audio/narration.wav" },
      script: { path: "scripts/final_script.txt" },
      timestamps: { path: "captions/word_timestamps.json" },
      captions: {
        path: "captions/captions.srt",
        final_video_sha256: sha256(video),
        final_audio_sha256: sha256(audio),
        word_timestamps_sha256: sha256(timestamps),
        script_sha256: sha256(script),
      },
    },
    used_assets: [
      rights("music-bed", "music", "assets/music.wav", "rights/music.txt"),
      rights("generated-card", "generated_card", "assets/card.png", "rights/card.txt", {
        source_url: "pulse-generated://flagship-story-1/generated-card",
        creator: "Pulse Gaming renderer",
        licence_basis: "owned generated media",
        nested_backdrops: [
          rights("card-backdrop", "backdrop", "assets/backdrop.png", "rights/backdrop.txt"),
        ],
      }),
    ],
  };

  const evidenceAssets = [
    inventory.used_assets[0],
    inventory.used_assets[1],
    inventory.used_assets[1].nested_backdrops[0],
  ];
  for (const asset of evidenceAssets) {
    const assetBytes = await fs.readFile(path.join(packageDir, asset.path));
    await fs.ensureDir(path.dirname(path.join(packageDir, asset.evidence_file)));
    await fs.writeJson(path.join(packageDir, asset.evidence_file), {
      schema_version: 1,
      asset_id: asset.asset_id,
      asset_sha256: sha256(assetBytes),
      source_url: asset.source_url,
      creator: asset.creator,
      licence_basis: asset.licence_basis,
      commercial_use_allowed: true,
      rights_verdict: asset.rights_verdict,
      allowed_platforms: asset.allowed_platforms,
    }, { spaces: 2 });
  }

  return { root, packageDir, outputDir, inventory };
}

async function replaceBoundTimeline(fixture, {
  scriptText,
  captionsRelativePath,
  captionsText,
  words,
}) {
  const videoPath = path.join(fixture.packageDir, "final/final.mp4");
  const audioPath = path.join(fixture.packageDir, "audio/narration.wav");
  const scriptRelativePath = "scripts/final_script.txt";
  const timestampsRelativePath = "captions/word_timestamps.json";
  const script = Buffer.from(scriptText);
  const captions = Buffer.from(captionsText);
  const video = await fs.readFile(videoPath);
  const audio = await fs.readFile(audioPath);
  await writeFixtureFile(fixture.packageDir, scriptRelativePath, script);
  await writeFixtureFile(fixture.packageDir, captionsRelativePath, captions);
  const timestamps = Buffer.from(JSON.stringify({
    complete: true,
    audio_sha256: sha256(audio),
    script_sha256: sha256(script),
    captions_sha256: sha256(captions),
    words,
  }));
  await writeFixtureFile(fixture.packageDir, timestampsRelativePath, timestamps);

  const runId = "flagship-run-0001";
  fixture.inventory.final_outputs.script = { path: scriptRelativePath };
  fixture.inventory.final_outputs.timestamps = { path: timestampsRelativePath };
  fixture.inventory.final_outputs.captions = {
    path: captionsRelativePath,
    final_video_sha256: sha256(video),
    final_audio_sha256: sha256(audio),
    word_timestamps_sha256: sha256(timestamps),
    script_sha256: sha256(script),
  };
  await fs.writeJson(path.join(fixture.packageDir, "manifests/generation_manifest.json"), {
    schema_version: 1,
    complete: true,
    producer_id: "pulse-gaming-flagship-renderer",
    run_id: runId,
    script_sha256: sha256(script),
    artifacts: {
      final_video: { path: "final/final.mp4", sha256: sha256(video), run_id: runId, script_sha256: sha256(script) },
      final_audio: { path: "audio/narration.wav", sha256: sha256(audio), run_id: runId, script_sha256: sha256(script) },
      word_timestamps: { path: timestampsRelativePath, sha256: sha256(timestamps), run_id: runId, script_sha256: sha256(script) },
      captions: { path: captionsRelativePath, sha256: sha256(captions), run_id: runId, script_sha256: sha256(script) },
      script: { path: scriptRelativePath, sha256: sha256(script), run_id: runId, script_sha256: sha256(script) },
    },
  }, { spaces: 2 });
}

test("materialises independently verified local evidence and preserves generated-card backdrop lineage", async () => {
  const fixture = await makeFixture();
  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
    generatedAt: "2026-07-15T10:00:00.000Z",
  });

  assert.equal(report.complete, true, JSON.stringify(report.blockers, null, 2));
  assert.equal(report.verdict, "GREEN");
  assert.equal(report.mode, "LOCAL_PROOF");
  assert.equal(report.publish_ready, false);
  assert.equal(report.human_av_signoff.status, "NOT_PERFORMED");
  assert.equal(
    report.bindings.final_video.sha256,
    sha256(await fs.readFile(path.join(fixture.packageDir, "final/final.mp4"))),
  );
  assert.equal(
    report.bindings.final_audio.sha256,
    sha256(await fs.readFile(path.join(fixture.packageDir, "audio/narration.wav"))),
  );
  assert.equal(report.bindings.word_timestamps.audio_binding_verified, true);
  assert.equal(report.bindings.captions.binding_verified, true);
  assert.equal(report.bindings.captions.declared_final_video_sha256, report.bindings.final_video.sha256);
  assert.equal(report.bindings.captions.declared_final_audio_sha256, report.bindings.final_audio.sha256);
  assert.equal(report.used_assets.length, 3);
  assert.equal(report.used_assets.find((asset) => asset.asset_id === "generated-card").asset_class, "generated_card");
  assert.equal(report.used_assets.find((asset) => asset.asset_id === "card-backdrop").asset_class, "nested_backdrop");
  assert.equal(report.used_assets.find((asset) => asset.asset_id === "card-backdrop").parent_asset_id, "generated-card");
  assert.ok(report.used_assets.every((asset) => asset.sha256 && asset.bytes > 0));
  assert.ok(await fs.pathExists(path.join(fixture.outputDir, "flagship_media_evidence.json")));
  assert.ok(await fs.pathExists(path.join(fixture.outputDir, "flagship_media_evidence_summary.md")));
  assert.equal(await fs.pathExists(path.join(fixture.packageDir, "flagship_media_evidence.json")), false);
  assert.equal(report.package_immutability.verified_after_all_writes, true);
  const persisted = await fs.readJson(path.join(fixture.outputDir, "flagship_media_evidence.json"));
  assert.equal(persisted.package_immutability.verified_after_all_writes, true);
});

test("RED: an upstream RED inventory remains RED after independent file verification", async () => {
  const fixture = await makeFixture();
  fixture.inventory.complete = false;
  fixture.inventory.verdict = "RED";
  fixture.inventory.blockers = ["renderer_rights_inventory_incomplete"];

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false);
  assert.equal(report.verdict, "RED");
  assert.ok(report.blockers.includes("upstream_inventory_not_complete"));
  assert.ok(report.blockers.includes("upstream_inventory_verdict_red"));
  assert.ok(report.blockers.includes("upstream_inventory_blocker:renderer_rights_inventory_incomplete"));
});

test("RED: package self-attestation cannot replace a trusted same-run input inventory", async () => {
  const fixture = await makeFixture();

  const report = await publicMaterializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false, JSON.stringify(report.blockers, null, 2));
  assert.ok(report.blockers.includes("trusted_render_input_inventory_missing"));
  assert.equal(report.trusted_render_inputs.verified, false);
});

test("RED: rejects a declared music asset whose actual input file is missing", async () => {
  const fixture = await makeFixture();
  await fs.remove(path.join(fixture.packageDir, "assets/music.wav"));

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false);
  assert.equal(report.verdict, "RED");
  assert.ok(report.blockers.includes("used_asset_file_missing:music-bed"));
  assert.equal(report.used_assets.find((asset) => asset.asset_id === "music-bed").verified, false);
});

test("RED: rejects a bare rights pass without file-backed rights fields", async () => {
  const fixture = await makeFixture();
  fixture.inventory.used_assets[0] = {
    asset_id: "music-bed",
    kind: "music",
    path: "assets/music.wav",
    rights_status: "pass",
  };

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false);
  assert.ok(report.blockers.includes("bare_rights_pass_rejected:music-bed"));
  assert.ok(report.blockers.includes("used_asset_source_url_missing:music-bed"));
  assert.ok(report.blockers.includes("used_asset_evidence_file_path_missing:music-bed"));
});

test("RED: generic rights prose cannot prove an exact asset permission binding", async () => {
  const fixture = await makeFixture();
  await fs.writeFile(
    path.join(fixture.packageDir, "rights/music.txt"),
    "Music licence receipt",
  );

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false, JSON.stringify(report.blockers, null, 2));
  assert.ok(report.blockers.includes("used_asset_evidence_json_required:music-bed"));
  assert.ok(report.blockers.includes("used_asset_evidence_binding_incomplete:music-bed"));
  assert.equal(report.rights_evidence_coverage.verified, false);
});

test("RED: rejects placeholder rights values, AMBER rights and absent commercial entitlement", async () => {
  const fixture = await makeFixture();
  Object.assign(fixture.inventory.used_assets[0], {
    creator: "unknown",
    licence_basis: "TBD",
    allowed_platforms: ["unknown"],
    commercial_use_allowed: false,
    rights_verdict: "AMBER",
  });

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false);
  assert.ok(report.blockers.includes("used_asset_creator_placeholder:music-bed"));
  assert.ok(report.blockers.includes("used_asset_licence_basis_placeholder:music-bed"));
  assert.ok(report.blockers.includes("used_asset_allowed_platforms_placeholder:music-bed"));
  assert.ok(report.blockers.includes("used_asset_commercial_use_not_allowed:music-bed"));
  assert.ok(report.blockers.includes("used_asset_rights_verdict_unacceptable:music-bed"));
});

test("RED: rejects structural rights placeholders and non-substantive evidence records", async () => {
  const fixture = await makeFixture();
  fixture.inventory.used_assets[0].creator = { name: "unknown" };
  fixture.inventory.used_assets[0].licence_basis = { value: "TBD" };
  await fs.writeJson(path.join(fixture.packageDir, "rights/music.txt"), {
    status: "TBD",
    notes: "unknown",
  });

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false);
  assert.ok(report.blockers.includes("used_asset_creator_structure_invalid:music-bed"));
  assert.ok(report.blockers.includes("used_asset_licence_basis_structure_invalid:music-bed"));
  assert.ok(report.blockers.includes("used_asset_evidence_not_substantive:music-bed"));
});

test("RED: rejects placeholder tokens embedded in rights fields and evidence paths", async () => {
  const fixture = await makeFixture();
  await writeFixtureFile(
    fixture.packageDir,
    "rights/pending-music-evidence.txt",
    "Signed commercial media licence receipt",
  );
  Object.assign(fixture.inventory.used_assets[0], {
    creator: "Unknown creator",
    licence_basis: "Commercial use TBD",
    evidence_file: "rights/pending-music-evidence.txt",
    allowed_platforms: ["youtube_shorts", "tiktok_pending"],
  });

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false);
  assert.ok(report.blockers.includes("used_asset_creator_placeholder:music-bed"));
  assert.ok(report.blockers.includes("used_asset_licence_basis_placeholder:music-bed"));
  assert.ok(report.blockers.includes("used_asset_evidence_file_placeholder:music-bed"));
  assert.ok(report.blockers.includes("used_asset_allowed_platforms_placeholder:music-bed"));
});

test("RED: rejects stale timestamp-to-audio hashes", async () => {
  const fixture = await makeFixture();
  await fs.writeJson(path.join(fixture.packageDir, "captions/word_timestamps.json"), {
    complete: true,
    audio_sha256: "0".repeat(64),
    words: [{ word: "Pulse", start: 0, end: 0.4 }],
  });

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false);
  assert.ok(report.blockers.includes("binding_mismatch:word_timestamps_to_final_audio"));
  assert.equal(report.bindings.word_timestamps.audio_binding_verified, false);
  assert.equal(report.bindings.word_timestamps.binding_verified, false);
  assert.notEqual(
    report.bindings.word_timestamps.declared_audio_sha256,
    report.bindings.word_timestamps.final_audio_sha256,
  );
});

test("RED: marks timestamps unverified when their audio binding is absent", async () => {
  const fixture = await makeFixture();
  const timestampPath = path.join(fixture.packageDir, "captions/word_timestamps.json");
  await fs.writeJson(timestampPath, {
    complete: true,
    words: [{ word: "Pulse", start: 0, end: 0.4 }],
  });
  fixture.inventory.final_outputs.captions.word_timestamps_sha256 = sha256(
    await fs.readFile(timestampPath),
  );

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false);
  assert.ok(report.blockers.includes("binding_missing:word_timestamps_to_final_audio"));
  assert.equal(report.final_outputs.word_timestamps.verified, false);
  assert.ok(
    report.final_outputs.word_timestamps.blockers.includes(
      "binding_missing:word_timestamps_to_final_audio",
    ),
  );
});

test("RED: rejects malformed, non-finite and non-monotonic timestamp words", async () => {
  const fixture = await makeFixture();
  const audio = await fs.readFile(path.join(fixture.packageDir, "audio/narration.wav"));
  await fs.writeJson(path.join(fixture.packageDir, "captions/word_timestamps.json"), {
    complete: true,
    audio_sha256: sha256(audio),
    words: [
      { word: "Pulse", start: 0, end: 0.4 },
      { word: "overlap", start: 0.2, end: 0.6 },
      { word: "broken", start: "not-finite", end: 0.8 },
      { word: "coerced", start: "0.8", end: "1.0" },
    ],
  });

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false);
  assert.ok(report.blockers.includes("word_timestamps_non_monotonic:2"));
  assert.ok(report.blockers.includes("word_timestamp_non_finite:3"));
  assert.ok(report.blockers.includes("word_timestamp_non_finite:4"));
  assert.equal(report.final_outputs.word_timestamps.content_valid, false);
});

test("RED: rejects stale declared caption bindings instead of synthesising replacements", async () => {
  const fixture = await makeFixture();
  const audio = await fs.readFile(path.join(fixture.packageDir, "audio/narration.wav"));
  const timestamps = await fs.readFile(path.join(fixture.packageDir, "captions/word_timestamps.json"));
  fixture.inventory.final_outputs.captions = {
    path: "captions/captions.srt",
    final_video_sha256: "0".repeat(64),
    final_audio_sha256: sha256(audio),
    word_timestamps_sha256: sha256(timestamps),
  };

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false);
  assert.ok(report.blockers.includes("binding_mismatch:captions_to_final_video"));
  assert.equal(report.bindings.captions.binding_verified, false);
  assert.equal(report.bindings.captions.declared_final_video_sha256, "0".repeat(64));
  assert.notEqual(
    report.bindings.captions.declared_final_video_sha256,
    report.bindings.captions.actual_final_video_sha256,
  );
});

test("RED: rejects non-empty caption files without parseable timed cues", async () => {
  const fixture = await makeFixture();
  await fs.writeFile(
    path.join(fixture.packageDir, "captions/captions.srt"),
    "captions claimed complete but contain no timed cue\n",
    "utf8",
  );

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false);
  assert.ok(report.blockers.includes("captions_content_unparseable"));
  assert.equal(report.final_outputs.captions.content_valid, false);
  assert.equal(report.final_outputs.captions.cue_count, 0);
});

test("RED: caller-refreshed hashes cannot bless 999-second cues against one-second media", async () => {
  const fixture = await makeFixture();
  const audio = await fs.readFile(path.join(fixture.packageDir, "audio/narration.wav"));
  const timestampPath = path.join(fixture.packageDir, "captions/word_timestamps.json");
  const captionPath = path.join(fixture.packageDir, "captions/captions.srt");
  await fs.writeJson(timestampPath, {
    complete: true,
    audio_sha256: sha256(audio),
    words: [{ word: "Pulse", start: 999, end: 1000 }],
  });
  await fs.writeFile(
    captionPath,
    "1\n00:16:39,000 --> 00:16:40,000\nPulse\n",
    "utf8",
  );
  const timestampHash = sha256(await fs.readFile(timestampPath));
  fixture.inventory.final_outputs.timestamps.sha256 = timestampHash;
  fixture.inventory.final_outputs.captions = {
    ...fixture.inventory.final_outputs.captions,
    sha256: sha256(await fs.readFile(captionPath)),
    word_timestamps_sha256: timestampHash,
  };
  delete fixture.inventory.generation_manifest;
  await fs.remove(path.join(fixture.packageDir, "manifests/generation_manifest.json"));

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false);
  assert.ok(report.blockers.includes("word_timestamps_outside_audio_duration"));
  assert.ok(report.blockers.includes("captions_outside_video_duration"));
  assert.ok(report.blockers.includes("trusted_generation_manifest_missing"));
});

test("RED: rejects an unreadable final video", async () => {
  const fixture = await makeFixture();
  await fs.writeFile(
    path.join(fixture.packageDir, "final/final.mp4"),
    "not a readable media container",
  );

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false);
  assert.ok(report.blockers.includes("media_unreadable:final_video"));
  assert.equal(report.final_outputs.final_video.media_readable, false);
  assert.equal(report.final_outputs.final_video.technical_metadata, null);
  assert.match(report.final_outputs.final_video.probe_error, /ffprobe|invalid data|command failed/i);
});

test("RED: public API cannot bless PNG bytes named final.mp4 through injected media seams", async () => {
  const fixture = await makeFixture();
  const pngBytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("not-an-mp4"),
  ]);
  await fs.writeFile(path.join(fixture.packageDir, "final/final.mp4"), pngBytes);
  fixture.inventory.final_outputs.captions.final_video_sha256 = sha256(pngBytes);

  await assert.rejects(
    () => publicMaterializeFlagshipMediaEvidence({
      packageDir: fixture.packageDir,
      inventory: fixture.inventory,
      outputDir: fixture.outputDir,
      probeMedia: async () => ({
        format: { duration: "1", format_name: "mov,mp4" },
        streams: [{ codec_type: "video", codec_name: "h264", width: 1080, height: 1920 }],
      }),
      decodeMedia: async () => ({ fully_decoded: true, errors: [] }),
    }),
    /caller-selected verifier binaries are forbidden on the public API/,
  );
  assert.equal(await fs.pathExists(fixture.outputDir), false);
});

test("RED: final video rejects a decoded PNG container renamed to .mp4", async () => {
  const fixture = await makeFixture();
  const pngBytes = await fs.readFile(path.join(fixture.packageDir, "assets/card.png"));
  await fs.writeFile(path.join(fixture.packageDir, "final/final.mp4"), pngBytes);
  fixture.inventory.final_outputs.captions.final_video_sha256 = sha256(pngBytes);

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false);
  assert.ok(report.blockers.includes("final_video_container_not_mp4_or_quicktime"));
  assert.ok(report.blockers.includes("final_video_video_codec_not_h264"));
  assert.ok(report.blockers.includes("final_video_audio_stream_missing"));
  assert.equal(report.final_outputs.final_video.contract_verified, false);
});

test("RED: caller cannot relax flagship AAC sample rate below 48 kHz", async () => {
  const fixture = await makeFixture();
  const finalVideoPath = path.join(fixture.packageDir, "final/final.mp4");
  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=5:d=1",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=1",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "44100", "-ac", "2", "-shortest",
    "-movflags", "+faststart", "-brand", "mp42", finalVideoPath,
  ], { stdio: "ignore", windowsHide: true });
  fixture.inventory.episode_contract.final_video.audio_sample_rate_hz = 44100;
  await replaceBoundTimeline(fixture, {
    scriptText: "Pulse\n",
    captionsRelativePath: "captions/captions.srt",
    captionsText: "1\n00:00:00,000 --> 00:00:01,000\nPulse\n",
    words: [{ word: "Pulse", start: 0, end: 1 }],
  });

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false);
  assert.ok(report.blockers.includes("episode_contract_audio_sample_rate_must_be_48000"));
  assert.ok(report.blockers.includes("final_video_audio_sample_rate_not_48000"));
});

test("RED: 3GP brand cannot pass through ffprobe MP4 format aliases", async () => {
  const fixture = await makeFixture();
  const finalVideoPath = path.join(fixture.packageDir, "final/final.mp4");
  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=5:d=1",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "48000", "-ac", "2", "-shortest",
    "-f", "3gp", finalVideoPath,
  ], { stdio: "ignore", windowsHide: true });
  await replaceBoundTimeline(fixture, {
    scriptText: "Pulse\n",
    captionsRelativePath: "captions/captions.srt",
    captionsText: "1\n00:00:00,000 --> 00:00:01,000\nPulse\n",
    words: [{ word: "Pulse", start: 0, end: 1 }],
  });

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false);
  assert.ok(report.blockers.includes("final_video_brand_not_mp4_or_quicktime"));
});

test("RED: rejects a corrupted media payload even when ffprobe accepts the container", async () => {
  const fixture = await makeFixture();
  const finalVideoPath = path.join(fixture.packageDir, "final/final.mp4");
  const corrupted = await fs.readFile(finalVideoPath);
  const mdatTypeOffset = corrupted.indexOf(Buffer.from("mdat"));
  assert.ok(mdatTypeOffset > 3, "fixture MP4 must contain an mdat box");
  corrupted.fill(0xff, mdatTypeOffset + 4);
  await fs.writeFile(finalVideoPath, corrupted);
  await replaceBoundTimeline(fixture, {
    scriptText: "Pulse\n",
    captionsRelativePath: "captions/captions.srt",
    captionsText: "1\n00:00:00,000 --> 00:00:01,000\nPulse\n",
    words: [{ word: "Pulse", start: 0, end: 1 }],
  });

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false);
  assert.ok(report.blockers.includes("media_decode_failed:final_video"));
  assert.equal(report.final_outputs.final_video.media_readable, true);
  assert.equal(report.final_outputs.final_video.decode_verified, false);
  assert.match(report.final_outputs.final_video.decode_error, /ffmpeg|command failed|invalid data|error/i);
});

test("RED: ffmpeg exit zero cannot bless an early-EOF decode", async () => {
  const fixture = await makeFixture();
  const finalVideoPath = path.join(fixture.packageDir, "final/final.mp4");
  const longSubtitlePath = path.join(fixture.root, "ten-seconds.srt");
  await fs.writeFile(
    longSubtitlePath,
    "1\n00:00:00,000 --> 00:00:10,000\nContainer duration only\n",
  );
  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=5:d=1",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1",
    "-i", longSubtitlePath,
    "-map", "0:v:0", "-map", "1:a:0", "-map", "2:s:0",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "48000", "-ac", "2", "-c:s", "mov_text",
    "-movflags", "+faststart", "-brand", "mp42", finalVideoPath,
  ], { stdio: "ignore", windowsHide: true });
  await replaceBoundTimeline(fixture, {
    scriptText: "Pulse\n",
    captionsRelativePath: "captions/captions.srt",
    captionsText: "1\n00:00:00,000 --> 00:00:01,000\nPulse\n",
    words: [{ word: "Pulse", start: 0, end: 1 }],
  });

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false, JSON.stringify(report.blockers, null, 2));
  assert.ok(
    report.blockers.includes("media_decode_incomplete:final_video"),
    JSON.stringify(report.blockers, null, 2),
  );
  assert.ok(
    report.final_outputs.final_video.decode_evidence.decoded_duration_seconds <
    report.final_outputs.final_video.decode_evidence.expected_duration_seconds,
  );
});

test("RED: final narration duration must match video and bound timestamp words", async () => {
  const fixture = await makeFixture();
  const finalAudioPath = path.join(fixture.packageDir, "audio/narration.wav");
  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:duration=2",
    "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "1", finalAudioPath,
  ], { stdio: "ignore", windowsHide: true });
  await replaceBoundTimeline(fixture, {
    scriptText: "Pulse\n",
    captionsRelativePath: "captions/captions.srt",
    captionsText: "1\n00:00:00,000 --> 00:00:01,000\nPulse\n",
    words: [{ word: "Pulse", start: 0, end: 2 }],
  });

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false, JSON.stringify(report.blockers, null, 2));
  assert.ok(report.blockers.includes("final_audio_video_duration_mismatch"));
  assert.ok(report.blockers.includes("word_timestamps_outside_video_duration"));
});

test("RED: detects final video swapped during probe/decode and restored afterwards", async () => {
  const fixture = await makeFixture();
  const finalVideoPath = path.join(fixture.packageDir, "final/final.mp4");
  const original = await fs.readFile(finalVideoPath);
  const swapped = Buffer.from("different-decoded-video-payload");
  const probeStdout = execFileSync("ffprobe", [
    "-v", "error", "-show_format", "-show_streams", "-of", "json", finalVideoPath,
  ], { encoding: "utf8", windowsHide: true });
  const childProcess = require("node:child_process");
  const { promisify } = require("node:util");
  const originalExecFile = childProcess.execFile;
  const originalExecFileAsync = promisify(originalExecFile);
  const modulePath = require.resolve("../../lib/flagship-media-evidence-materializer");
  let decodedBytes = null;
  const interceptedExecFile = (...args) => originalExecFile(...args);
  interceptedExecFile[promisify.custom] = async (command, args, options) => {
    const executable = path.basename(String(command)).toLowerCase().replace(/\.exe$/, "");
    const probeTarget = executable === "ffprobe" ? path.resolve(args[args.length - 1]) : null;
    const inputIndex = executable === "ffmpeg" ? args.indexOf("-i") : -1;
    const decodeTarget = inputIndex >= 0 ? path.resolve(args[inputIndex + 1]) : null;
    if (probeTarget === path.resolve(finalVideoPath)) {
      fs.writeFileSync(finalVideoPath, swapped);
      return { stdout: probeStdout, stderr: "" };
    }
    if (decodeTarget === path.resolve(finalVideoPath)) {
      decodedBytes = fs.readFileSync(finalVideoPath);
      fs.writeFileSync(finalVideoPath, original);
      return { stdout: "out_time_us=1000000\nprogress=end\n", stderr: "" };
    }
    return originalExecFileAsync(command, args, options);
  };

  let report;
  try {
    childProcess.execFile = interceptedExecFile;
    delete require.cache[modulePath];
    const isolatedApi = require(modulePath);
    const trustedRenderInputs = await isolatedApi.createTrustedRenderInputInventory({
      packageDir: fixture.packageDir,
      inventory: fixture.inventory,
    });
    report = await isolatedApi.materializeFlagshipMediaEvidence({
      packageDir: fixture.packageDir,
      inventory: fixture.inventory,
      outputDir: fixture.outputDir,
      trustedRenderInputs,
    });
  } finally {
    childProcess.execFile = originalExecFile;
    delete require.cache[modulePath];
    await fs.writeFile(finalVideoPath, original);
  }

  assert.deepEqual(decodedBytes, swapped);
  assert.deepEqual(await fs.readFile(finalVideoPath), original);
  assert.equal(report.complete, false);
  assert.ok(
    report.blockers.includes(
      "critical_file_mutated_during_media_verification:final_video",
    ),
  );
  assert.equal(report.final_outputs.final_video.verification_identity_stable, false);
});

test("accepts overlapping WebVTT cues with nondecreasing starts and valid spans", async () => {
  const fixture = await makeFixture();
  await replaceBoundTimeline(fixture, {
    scriptText: "Pulse Gaming\n",
    captionsRelativePath: "captions/captions.vtt",
    captionsText: [
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:00:00.750",
      "Pulse",
      "",
      "00:00:00.500 --> 00:00:01.000",
      "Gaming",
      "",
    ].join("\n"),
    words: [
      { word: "Pulse", start: 0, end: 0.5 },
      { word: "Gaming", start: 0.5, end: 1 },
    ],
  });

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, true, JSON.stringify(report.blockers, null, 2));
  assert.equal(report.final_outputs.captions.cue_count, 2);
  assert.ok(!report.blockers.includes("caption_cues_non_monotonic:2"));
});

test("RED: sparse caption endpoints do not masquerade as meaningful timeline coverage", async () => {
  const fixture = await makeFixture();
  await replaceBoundTimeline(fixture, {
    scriptText: "Pulse Gaming\n",
    captionsRelativePath: "captions/captions.vtt",
    captionsText: [
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:00:00.050",
      "Pulse",
      "",
      "00:00:00.950 --> 00:00:01.000",
      "Gaming",
      "",
    ].join("\n"),
    words: [
      { word: "Pulse", start: 0, end: 0.5 },
      { word: "Gaming", start: 0.5, end: 1 },
    ],
  });

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false);
  assert.ok(report.blockers.includes("captions_coverage_insufficient"));
  assert.equal(report.final_outputs.captions.coverage_ratio, 0.1);
});

test("corrupted mdat regression: ffprobe-valid MP4 fails real ffmpeg decode", async () => {
  const fixture = await makeFixture();
  const finalVideoPath = path.join(fixture.packageDir, "final/final.mp4");
  const corrupted = await fs.readFile(finalVideoPath);
  const mdatTypeOffset = corrupted.indexOf(Buffer.from("mdat"));
  assert.ok(mdatTypeOffset > 3, "fixture MP4 must contain an mdat box");
  corrupted.fill(0xff, mdatTypeOffset + 4);
  await fs.writeFile(finalVideoPath, corrupted);
  await replaceBoundTimeline(fixture, {
    scriptText: "Pulse\n",
    captionsRelativePath: "captions/captions.srt",
    captionsText: "1\n00:00:00,000 --> 00:00:01,000\nPulse\n",
    words: [{ word: "Pulse", start: 0, end: 1 }],
  });

  const probed = JSON.parse(execFileSync("ffprobe", [
    "-v", "error", "-show_format", "-show_streams", "-of", "json", finalVideoPath,
  ], { encoding: "utf8", windowsHide: true }));
  assert.ok(probed.streams.some((stream) => stream.codec_type === "video" && stream.codec_name === "h264"));
  assert.ok(probed.streams.some((stream) => stream.codec_type === "audio" && stream.codec_name === "aac"));

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false);
  assert.ok(report.blockers.includes("media_decode_failed:final_video"));
  assert.equal(report.final_outputs.final_video.media_readable, true);
  assert.equal(report.final_outputs.final_video.decode_verified, false);
  assert.equal(report.final_outputs.final_video.contract_verified, true);
  assert.equal(report.generation_manifest.verified, true);
});

test("RED: rejects duplicate used-asset identity rows", async () => {
  const fixture = await makeFixture();
  fixture.inventory.used_assets.push({ ...fixture.inventory.used_assets[0] });

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false);
  assert.deepEqual(report.duplicate_asset_identities, ["music-bed"]);
  assert.ok(report.blockers.includes("used_asset_identity_duplicate:music-bed"));
  assert.equal(report.used_assets.filter((asset) => asset.asset_id === "music-bed").length, 2);
  assert.ok(report.used_assets.filter((asset) => asset.asset_id === "music-bed").every((asset) => !asset.verified));
});

test("RED: rejects a used asset whose rights evidence file is absent", async () => {
  const fixture = await makeFixture();
  await fs.remove(path.join(fixture.packageDir, "rights/backdrop.txt"));

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false);
  assert.deepEqual(report.missing_evidence_asset_identities, ["card-backdrop"]);
  assert.ok(report.blockers.includes("used_asset_evidence_file_missing:card-backdrop"));
  const backdrop = report.used_assets.find((asset) => asset.asset_id === "card-backdrop");
  assert.equal(backdrop.asset_class, "nested_backdrop");
  assert.equal(backdrop.evidence_file.exists, false);
  assert.equal(backdrop.verified, false);
  const card = report.used_assets.find((asset) => asset.asset_id === "generated-card");
  assert.ok(report.blockers.includes("generated_card_backdrop_lineage_incomplete:generated-card"));
  assert.equal(card.backdrop_lineage.verified, false);
  assert.equal(card.verified, false);
});

test("RED: rejects a generated card without a nested backdrop lineage row", async () => {
  const fixture = await makeFixture();
  delete fixture.inventory.used_assets[1].nested_backdrops;

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false);
  assert.ok(report.blockers.includes("generated_card_backdrop_lineage_missing:generated-card"));
  const card = report.used_assets.find((asset) => asset.asset_id === "generated-card");
  assert.equal(card.backdrop_lineage.required, true);
  assert.equal(card.backdrop_lineage.row_count, 0);
  assert.equal(card.backdrop_lineage.verified, false);
  assert.equal(card.verified, false);
});

test("RED: rejects generated-card self-nesting masquerading as a backdrop", async () => {
  const fixture = await makeFixture();
  fixture.inventory.used_assets[1].nested_backdrops = [
    rights(
      "card-self-nested",
      "generated_card",
      "assets/card.png",
      "rights/card.txt",
      {
        source_url: "pulse-generated://flagship-story-1/card-self-nested",
        creator: "Pulse Gaming renderer",
        licence_basis: "owned generated media",
      },
    ),
  ];

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false);
  assert.ok(report.blockers.includes("generated_card_backdrop_type_invalid:card-self-nested"));
  assert.ok(
    report.blockers.includes(
      "generated_card_backdrop_not_distinct:generated-card:card-self-nested",
    ),
  );
  assert.ok(report.blockers.includes("generated_card_backdrop_lineage_incomplete:generated-card"));
});

test("rejects a used-asset row with no asset identity", async () => {
  const fixture = await makeFixture();
  delete fixture.inventory.used_assets[0].asset_id;

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, false);
  assert.deepEqual(report.missing_asset_identity_rows, [1]);
  assert.ok(report.blockers.includes("used_asset_identity_missing:row_1"));
  assert.equal(report.used_assets[0].asset_id, null);
  assert.equal(report.used_assets[0].verified, false);
});

test("matches a separate rights record to exactly one used-asset identity", async () => {
  const fixture = await makeFixture();
  const music = fixture.inventory.used_assets[0];
  fixture.inventory.records = [{
    asset_id: music.asset_id,
    source_url: music.source_url,
    source_owner: music.creator,
    licence_basis: music.licence_basis,
    commercial_use_allowed: music.commercial_use_allowed,
    rights_verdict: music.rights_verdict,
    evidence_file: music.evidence_file,
    allowed_platforms: music.allowed_platforms,
  }];
  fixture.inventory.used_assets[0] = {
    asset_id: music.asset_id,
    kind: music.kind,
    path: music.path,
  };

  const report = await materializeFlagshipMediaEvidence({
    packageDir: fixture.packageDir,
    inventory: fixture.inventory,
    outputDir: fixture.outputDir,
  });

  assert.equal(report.complete, true, JSON.stringify(report.blockers, null, 2));
  const materialisedMusic = report.used_assets.find((asset) => asset.asset_id === "music-bed");
  assert.equal(materialisedMusic.rights_record_matched, true);
  assert.equal(materialisedMusic.evidence_file.exists, true);
  assert.equal(materialisedMusic.verified, true);
});

test("refuses a proof-output symlink that resolves inside the immutable package", async (t) => {
  const fixture = await makeFixture();
  const outputLink = path.join(fixture.root, "proof-link");
  try {
    await fs.symlink(fixture.packageDir, outputLink, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`symlinks unavailable: ${error.code || error.message}`);
    return;
  }

  await assert.rejects(
    () => materializeFlagshipMediaEvidence({
      packageDir: fixture.packageDir,
      inventory: fixture.inventory,
      outputDir: outputLink,
    }),
    /outside the immutable package directory/,
  );
  assert.equal(await fs.pathExists(path.join(fixture.packageDir, "flagship_media_evidence.json")), false);
});

test("RED: refuses an existing hardlink proof leaf without mutating the immutable package", async () => {
  const fixture = await makeFixture();
  await fs.ensureDir(fixture.outputDir);
  const packageEvidence = path.join(fixture.packageDir, "rights/music.txt");
  const original = await fs.readFile(packageEvidence);
  await fs.link(
    packageEvidence,
    path.join(fixture.outputDir, "flagship_media_evidence.json"),
  );

  await assert.rejects(
    () => materializeFlagshipMediaEvidence({
      packageDir: fixture.packageDir,
      inventory: fixture.inventory,
      outputDir: fixture.outputDir,
    }),
    /proof output leaf must be fresh/,
  );
  assert.deepEqual(await fs.readFile(packageEvidence), original);
});

test("RED: refuses an existing symlink proof leaf without mutating the immutable package", async (t) => {
  const fixture = await makeFixture();
  await fs.ensureDir(fixture.outputDir);
  const packageEvidence = path.join(fixture.packageDir, "rights/music.txt");
  const original = await fs.readFile(packageEvidence);
  try {
    await fs.symlink(
      process.platform === "win32" ? fixture.packageDir : packageEvidence,
      path.join(fixture.outputDir, "flagship_media_evidence.json"),
      process.platform === "win32" ? "junction" : "file",
    );
  } catch (error) {
    t.skip(`symlink/junction leaves unavailable: ${error.code || error.message}`);
    return;
  }

  await assert.rejects(
    () => materializeFlagshipMediaEvidence({
      packageDir: fixture.packageDir,
      inventory: fixture.inventory,
      outputDir: fixture.outputDir,
    }),
    /proof output leaf must be fresh/,
  );
  assert.deepEqual(await fs.readFile(packageEvidence), original);
});
