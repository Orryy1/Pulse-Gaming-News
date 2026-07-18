"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CONTRACT_ID: FLAGSHIP_MEDIA_PORTFOLIO_CONTRACT_ID,
  FLAGSHIP_MEDIA_PORTFOLIO_SLOTS,
} = require("../../lib/flagship-media-portfolio");

const {
  REQUIRED_ARTEFACTS,
  REQUIRED_STORY_PACKAGE_ARTEFACTS,
  REQUIRED_SYSTEMS,
  REQUIRED_TESTS,
  buildGoalContractReport,
  buildPublishCutoverGate,
  renderGoalContractMarkdown,
  verifyFinalRenderInputLineage,
  writeGoalContractArtifacts,
} = require("../../lib/goal-contract");

function completeStoryPackage(id) {
  return {
    story_id: id,
    artefacts: [
      "canonical_story_manifest.json",
      "script_scorecard.json",
      "footage_inventory.json",
      "rights_ledger.json",
      "director_beat_map.json",
      "render_manifest.json",
      "visual_v4_render.mp4",
      "audio_manifest.json",
      "sfx_manifest.json",
      "captions.srt",
      "platform_publish_manifest.json",
      "x_publish_pack.json",
      "instagram_publish_pack.json",
      "affiliate_link_manifest.json",
      "landing_page_manifest.json",
      "platform_policy_report.json",
      "benchmark_report.json",
      "coherence_report.json",
      "publish_verdict.json",
      "final_av_review.json",
      "analytics_ingest_plan.json",
    ],
    verdict: "GREEN",
  };
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

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function digestFile(filePath) {
  return digest(fs.readFileSync(filePath));
}

function srtTimestamp(seconds) {
  const milliseconds = Math.max(0, Math.round(Number(seconds) * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function sampledFrameHash(mediaPath, timeSeconds) {
  const pixels = execFileSync("ffmpeg", [
    "-hide_banner", "-nostdin", "-v", "error",
    "-i", mediaPath,
    "-ss", String(timeSeconds),
    "-map", "0:v:0",
    "-frames:v", "1",
    "-an", "-sn", "-dn",
    "-threads", "1",
    "-pix_fmt", "rgba",
    "-f", "rawvideo",
    "pipe:1",
  ], { encoding: null, maxBuffer: 128 * 1024 * 1024, timeout: 120000 });
  assert.ok(pixels.length > 0, `sampled frame missing at ${timeSeconds}s`);
  return digest(pixels);
}

function timelineEvidence(durationSeconds, audioSha256) {
  const wordCount = Math.max(12, Math.ceil(durationSeconds));
  const wordDuration = durationSeconds / wordCount;
  const words = Array.from({ length: wordCount }, (_, index) => ({
    word: `pulseword${index % 64}`,
    start: Number((index * wordDuration).toFixed(6)),
    end: Number(((index + 1) * wordDuration).toFixed(6)),
  }));
  words[words.length - 1].end = durationSeconds;
  const cues = [];
  for (let index = 0; index < words.length; index += 5) {
    const cueWords = words.slice(index, index + 5);
    cues.push(
      `${cues.length + 1}\n${srtTimestamp(cueWords[0].start)} --> ${srtTimestamp(cueWords.at(-1).end)}\n${cueWords.map((row) => row.word).join(" ")}\n`,
    );
  }
  return {
    timestamps: { complete: true, audio_sha256: audioSha256, words },
    captions: `${cues.join("\n")}\n`,
  };
}

async function materialiseFlagshipSlot(root, {
  slotId,
  storyId,
  mediaType,
  size,
  durationSeconds,
  visualFilter,
  noiseColour,
  tremoloFrequency,
  sourceFamily,
  motionFamily,
}) {
  const slotDir = path.join(root, slotId);
  const mediaPath = path.join(slotDir, "final.mp4");
  const narrationPath = path.join(slotDir, "narration.m4a");
  const timestampsPath = path.join(slotDir, "word_timestamps.json");
  const captionsPath = path.join(slotDir, "captions.srt");
  const rightsPath = path.join(slotDir, "rights_lineage.json");
  const contactSheetPath = path.join(slotDir, "contact-sheet.png");
  const sourceAssetPath = path.join(slotDir, "source-asset.png");
  const rightsEvidencePath = path.join(slotDir, "rights-evidence.txt");
  const forensicPath = path.join(slotDir, "decoded-forensic-report.json");
  const finalAvReviewPath = path.join(slotDir, "final_av_review.json");
  await fs.ensureDir(slotDir);

  execFileSync("ffmpeg", [
    "-y", "-v", "error",
    "-f", "lavfi",
    "-i", `testsrc2=size=${size}:rate=1:duration=${durationSeconds},${visualFilter}`,
    "-f", "lavfi",
    "-i", `anoisesrc=color=${noiseColour}:amplitude=0.35:sample_rate=8000:duration=${durationSeconds},tremolo=f=${tremoloFrequency}:d=0.85`,
    "-shortest",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "24k",
    mediaPath,
  ], { stdio: "ignore", timeout: 120000 });
  execFileSync("ffmpeg", [
    "-y", "-v", "error", "-i", mediaPath, "-vn", "-c:a", "copy", narrationPath,
  ], { stdio: "ignore", timeout: 120000 });
  const narrationHash = digestFile(narrationPath);
  const timeline = timelineEvidence(durationSeconds, narrationHash);
  await fs.outputJson(timestampsPath, timeline.timestamps);
  await fs.outputFile(captionsPath, timeline.captions);

  execFileSync("ffmpeg", [
    "-y", "-v", "error", "-ss", "1", "-i", mediaPath,
    "-frames:v", "1", contactSheetPath,
  ], { stdio: "ignore", timeout: 120000 });
  await fs.copy(contactSheetPath, sourceAssetPath);
  await fs.outputFile(
    rightsEvidencePath,
    `Owned source evidence for ${storyId} from ${sourceFamily}.\n`,
  );

  const mediaHash = digestFile(mediaPath);
  const sourceAssetHash = digestFile(sourceAssetPath);
  const rightsEvidenceHash = digestFile(rightsEvidencePath);
  const rightsAssetId = `${slotId}_primary_source`;
  await fs.outputJson(rightsPath, {
    complete: true,
    verdict: "GREEN",
    used_assets: [{
      asset_id: rightsAssetId,
      source_url: `https://example.test/${sourceFamily}`,
      local_path: sourceAssetPath,
      asset_sha256: sourceAssetHash,
    }],
    records: [{
      asset_id: rightsAssetId,
      source_url: `https://example.test/${sourceFamily}`,
      source_owner: "Pulse test fixture",
      licence_basis: "owned test media",
      commercial_use_allowed: true,
      asset_path: sourceAssetPath,
      asset_sha256: sourceAssetHash,
      rights_evidence_path: rightsEvidencePath,
      rights_evidence_sha256: rightsEvidenceHash,
    }],
  });

  const mediaStat = fs.statSync(mediaPath);
  const sampledTimes = [0, durationSeconds / 3, (durationSeconds * 2) / 3, durationSeconds - 1];
  const sampledFrames = sampledTimes.map((timeSeconds) => ({
    time_seconds: Number(timeSeconds.toFixed(6)),
    hash: sampledFrameHash(mediaPath, Number(timeSeconds.toFixed(6))),
  }));
  await fs.outputJson(forensicPath, {
    schema_version: 1,
    story_id: storyId,
    verdict: "pass",
    status: "pass",
    final_media: { sha256: mediaHash, size_bytes: mediaStat.size },
    checks: Object.fromEntries(
      ["audio", "video", "captions", "av_sync", "freeze", "black", "blur", "repetition"]
        .map((key) => [key, { checked: true, verdict: "pass" }]),
    ),
    sampled_frames: sampledFrames,
    critical_defects: [],
  });
  const contactSheetHash = digestFile(contactSheetPath);
  const forensicHash = digestFile(forensicPath);
  await fs.outputJson(finalAvReviewPath, {
    schema_version: 1,
    story_id: storyId,
    reviewed_at: "2026-07-15T12:00:00.000Z",
    signed_at: "2026-07-15T12:01:00.000Z",
    reviewer: { id: "independent-av-reviewer", independent: true },
    signoff: {
      reviewer_id: "independent-av-reviewer",
      signed_at: "2026-07-15T12:01:00.000Z",
    },
    artefacts: {
      final_mp4: mediaPath,
      contact_sheet: contactSheetPath,
      decoded_forensic_report: forensicPath,
    },
    reviewed_artefact_fingerprints: {
      final_mp4: mediaHash,
      contact_sheet: contactSheetHash,
      decoded_forensic_report: forensicHash,
    },
    contact_sheet_binding: {
      contact_sheet_sha256: contactSheetHash,
      final_mp4_sha256: mediaHash,
      decoded_forensic_report_sha256: forensicHash,
      sampled_frames: sampledFrames,
    },
    attestations: {
      full_watch: true,
      full_listen: true,
      av_sync: true,
      caption_readability: true,
      subject_match: true,
    },
    defects: [],
    verdict: "GREEN",
    status: "GREEN",
    final_verdict: "GREEN",
    publish_ready: true,
    can_auto_publish: true,
    blockers: [],
    failures: [],
    errors: [],
  });
  const hashes = {
    media: mediaHash,
    narration: narrationHash,
    word_timestamps: digestFile(timestampsPath),
    captions: digestFile(captionsPath),
    rights_lineage: digestFile(rightsPath),
  };
  const [width, height] = size.split("x").map(Number);
  return {
    artifact_dir: slotDir,
    story_id: storyId,
    media_type: mediaType,
    media: {
      path: mediaPath,
      sha256: hashes.media,
      container: "mp4",
      duration_seconds: durationSeconds,
      width,
      height,
      video_codec: "h264",
      audio_codec: "aac",
      decodable: true,
    },
    narration: {
      path: narrationPath,
      sha256: hashes.narration,
      duration_seconds: durationSeconds,
      complete: true,
    },
    word_timestamps: {
      path: timestampsPath,
      sha256: hashes.word_timestamps,
      complete: true,
    },
    captions: {
      path: captionsPath,
      sha256: hashes.captions,
      complete: true,
    },
    rights_lineage: {
      path: rightsPath,
      sha256: hashes.rights_lineage,
      complete: true,
    },
    source_identity: { family: sourceFamily },
    motion_identity: { family: motionFamily },
    final_av_review: finalAvReviewPath,
  };
}

let rawFlagshipPortfolioPromise;
async function rawFlagshipPortfolioFixture() {
  if (!rawFlagshipPortfolioPromise) {
    rawFlagshipPortfolioPromise = (async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-flagship-"));
      const definitions = [
        ["short_1", "flagship-short-one", "short", "180x320", 36, "drawgrid=w=23:h=31:t=2:c=white@0.8", "pink", 2.5, "official_press_release", "owned_gameplay_capture"],
        ["short_2", "flagship-short-two", "short", "180x320", 41, "hflip,edgedetect=mode=colormix:high=0.3", "white", 3.5, "steam_store_news", "licensed_trailer_edit"],
        ["short_3", "flagship-short-three", "short", "180x320", 51, "vflip,negate,drawgrid=w=17:h=29:t=3:c=yellow@0.8", "brown", 4.5, "publisher_newsroom", "owned_kinetic_graphics"],
        ["longform_1", "flagship-longform-one", "longform", "320x180", 601, "hflip,vflip", "violet", 5.5, "multi_source_dossier", "chaptered_editorial_mix"],
      ];
      const slots = {};
      for (const [
        slotId,
        storyId,
        mediaType,
        size,
        durationSeconds,
        visualFilter,
        noiseColour,
        tremoloFrequency,
        sourceFamily,
        motionFamily,
      ] of definitions) {
        slots[slotId] = await materialiseFlagshipSlot(root, {
          slotId,
          storyId,
          mediaType,
          size,
          durationSeconds,
          visualFilter,
          noiseColour,
          tremoloFrequency,
          sourceFamily,
          motionFamily,
        });
      }
      return { schema_version: 1, operating_mode: "LOCAL_PROOF", slots };
    })();
  }
  return clone(await rawFlagshipPortfolioPromise);
}

async function rawPortfolioWithReviewVerdict(portfolio, slotId, verdict) {
  const candidate = clone(portfolio);
  const sourcePath = candidate.slots[slotId].final_av_review;
  const review = await fs.readJson(sourcePath);
  const variantPath = path.join(
    path.dirname(sourcePath),
    `final_av_review-${String(verdict).toLowerCase()}.json`,
  );
  await fs.outputJson(variantPath, { ...review, verdict, status: verdict });
  candidate.slots[slotId].final_av_review = variantPath;
  return candidate;
}

function completeGoalContractIndexes() {
  return {
    moduleIndex: Object.fromEntries(
      REQUIRED_SYSTEMS.flatMap((system) => system.modules).map((file) => [file, true]),
    ),
    artefactIndex: Object.fromEntries(REQUIRED_ARTEFACTS.map((file) => [file, true])),
    testIndex: Object.fromEntries(REQUIRED_TESTS.map((testId) => [testId, true])),
  };
}

async function materialiseFinalMediaFixture({
  storyId,
  includeAudio = true,
  width = 1080,
  height = 1920,
  durationSeconds = 12,
  frameRate = 25,
  videoCodec = "libx264",
  audioCodec = "aac",
  colour = "0x18202b",
  frequency = 440,
} = {}) {
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), `pulse-goal-final-${storyId}-`));
  const canonicalSnapshot = {
    story_id: storyId,
    selected_title: "A concrete player-facing story",
    thumbnail_headline: "CONCRETE PAYOFF",
    first_spoken_line: "This update changes what players can do.",
    narration_script: "This update changes what players can do, and the payoff is specific.",
    canonical_subject: "Concrete Game",
    canonical_angle: "confirmed_update",
    primary_source: "Official Publisher",
    public_copy_repaired_at: "",
    duration_variant_repaired_at: "",
  };
  const canonical = { ...canonicalSnapshot };
  const audioPath = path.join(artifactDir, "narration.wav");
  const timestampsPath = path.join(artifactDir, "word_timestamps.json");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), canonical);
  await fs.outputFile(audioPath, "same-run-narration-input");
  await fs.outputJson(timestampsPath, [{ word: "This", start: 0, end: 0.2 }]);
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: "narration.wav",
    word_timestamps_path: "word_timestamps.json",
  });

  const audioBytes = await fs.readFile(audioPath);
  const timestampsBytes = await fs.readFile(timestampsPath);
  const fingerprintSource = {
    canonical_snapshot: canonicalSnapshot,
    audio_sha256: digest(audioBytes),
    word_timestamps_sha256: digest(timestampsBytes),
    audio_size_bytes: audioBytes.length,
    word_timestamps_size_bytes: timestampsBytes.length,
  };
  const outputPath = path.join(artifactDir, "visual_v4_render.mp4");
  const ffmpegArgs = [
    "-v", "error",
    "-f", "lavfi",
    "-i", `color=c=${colour}:s=${width}x${height}:r=${frameRate}`,
  ];
  if (includeAudio) {
    ffmpegArgs.push("-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000`);
  }
  ffmpegArgs.push(
    "-t", String(durationSeconds),
    "-c:v", videoCodec,
    "-preset", "ultrafast",
    "-pix_fmt", "yuv420p",
  );
  if (includeAudio) {
    ffmpegArgs.push("-c:a", audioCodec, "-b:a", "128k", "-shortest");
  } else {
    ffmpegArgs.push("-an");
  }
  ffmpegArgs.push("-movflags", "+faststart", "-y", outputPath);
  execFileSync("ffmpeg", ffmpegArgs, { stdio: "ignore", timeout: 120000 });

  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    final_publish_render: true,
    renderer: "visual_v4_production",
    output: "visual_v4_render.mp4",
    input_fingerprint: {
      algorithm: "sha256",
      signature: digest(Buffer.from(stableJson(fingerprintSource), "utf8")),
      canonical_public_copy_hash: digest(Buffer.from(stableJson(canonicalSnapshot), "utf8")),
      ...fingerprintSource,
    },
  });
  await fs.outputJson(path.join(artifactDir, "final_av_review.json"), {
    schema_version: 1,
    story_id: storyId,
    verdict: "GREEN",
    status: "GREEN",
  });
  await fs.outputJson(path.join(artifactDir, "publish_verdict.json"), {
    story_id: storyId,
    verdict: "GREEN",
    status: "GREEN",
    can_auto_publish: true,
  });
  return { story_id: storyId, artifact_dir: artifactDir };
}

async function materialiseCompleteStoryPackage(storyId, mediaOptions = {}) {
  const mediaFixture = await materialiseFinalMediaFixture({
    storyId,
    durationSeconds: 10.2,
    frameRate: 1,
    ...mediaOptions,
  });
  const storyPackage = completeStoryPackage(storyId);
  for (const basename of storyPackage.artefacts) {
    const artefactPath = path.join(mediaFixture.artifact_dir, basename);
    if (await fs.pathExists(artefactPath)) continue;
    await fs.outputFile(artefactPath, basename.endsWith(".json") ? "{}" : "local proof");
  }
  return { ...storyPackage, artifact_dir: mediaFixture.artifact_dir };
}

async function materialiseAliasedThirtyStoryPackages() {
  const mediaFixture = await materialiseCompleteStoryPackage("strict-thirty-story-control");
  return Array.from({ length: 30 }, (_, index) => ({
    ...completeStoryPackage(`strict-story-${index + 1}`),
    artifact_dir: mediaFixture.artifact_dir,
  }));
}

let strictThirtyStoryPackagesPromise;
async function materialiseStrictThirtyStoryPackages() {
  if (!strictThirtyStoryPackagesPromise) {
    strictThirtyStoryPackagesPromise = (async () => {
      const packages = [];
      for (let index = 0; index < 30; index += 1) {
        const colour = `0x${((index + 1) * 0x07111d).toString(16).padStart(6, "0").slice(-6)}`;
        packages.push(await materialiseCompleteStoryPackage(`strict-story-${index + 1}`, {
          colour,
          frequency: 300 + index * 13,
        }));
      }
      return packages;
    })();
  }
  return clone(await strictThirtyStoryPackagesPromise);
}

test("goal contract rejects 30 package aliases backed by one canonical story and final MP4", async () => {
  const storyPackages = await materialiseAliasedThirtyStoryPackages();

  const report = await buildGoalContractReport({ storyPackages });

  assert.equal(report.acceptance_30_story_gate.status, "blocked");
  assert.equal(report.acceptance_30_story_gate.unique_canonical_story_count, 1);
  assert.equal(report.publish_cutover_gate.status, "blocked");
  assert.equal(report.publish_cutover_gate.unique_final_render_fingerprint_count, 1);
  assert.equal(report.publish_cutover_gate.final_publish_render_count, 0);
  assert.ok(
    report.publish_cutover_gate.story_results.every((row) =>
      row.blockers.includes("canonical_story_id_not_unique")),
  );
  assert.ok(
    report.publish_cutover_gate.story_results.every((row) =>
      row.blockers.includes("final_render_fingerprint_not_unique")),
  );
});

test("goal contract requires package, canonical, render and review story IDs to match", async () => {
  assert.ok(REQUIRED_STORY_PACKAGE_ARTEFACTS.includes("final_av_review.json"));
  const canonicalMismatch = await materialiseFinalMediaFixture({
    storyId: "canonical-evidence-story",
  });
  canonicalMismatch.story_id = "package-alias-story";

  const renderMismatch = await materialiseFinalMediaFixture({
    storyId: "render-evidence-story",
  });
  const renderManifestPath = path.join(renderMismatch.artifact_dir, "render_manifest.json");
  const renderManifest = await fs.readJson(renderManifestPath);
  await fs.outputJson(renderManifestPath, {
    ...renderManifest,
    story_id: "different-render-story",
  });

  const reviewMismatch = await materialiseFinalMediaFixture({
    storyId: "review-evidence-story",
  });
  await fs.outputJson(path.join(reviewMismatch.artifact_dir, "final_av_review.json"), {
    schema_version: 1,
    story_id: "different-review-story",
    verdict: "GREEN",
    status: "GREEN",
  });

  const report = await buildGoalContractReport({
    storyPackages: [canonicalMismatch, renderMismatch, reviewMismatch],
  });
  const rows = report.publish_cutover_gate.story_results;

  assert.equal(report.publish_cutover_gate.final_publish_render_count, 0);
  assert.ok(rows[0].blockers.includes("package_canonical_story_id_mismatch"));
  assert.ok(rows[1].blockers.includes("package_render_story_id_mismatch"));
  assert.ok(rows[2].blockers.includes("package_review_story_id_mismatch"));
});

test("goal contract rejects contradictory RED or AMBER authority fields behind GREEN claims", async () => {
  const storyPackage = await materialiseFinalMediaFixture({
    storyId: "contradictory-verdict-story",
  });
  storyPackage.verdict = "GREEN";
  storyPackage.publish_verdict = "AMBER";

  const canonicalPath = path.join(storyPackage.artifact_dir, "canonical_story_manifest.json");
  const canonical = await fs.readJson(canonicalPath);
  await fs.outputJson(canonicalPath, { ...canonical, status: "RED" });
  const renderPath = path.join(storyPackage.artifact_dir, "render_manifest.json");
  const render = await fs.readJson(renderPath);
  await fs.outputJson(renderPath, { ...render, verdict: "RED", status: "GREEN" });
  await fs.outputJson(path.join(storyPackage.artifact_dir, "final_av_review.json"), {
    schema_version: 1,
    story_id: storyPackage.story_id,
    verdict: "GREEN",
    status: "AMBER",
  });
  await fs.outputJson(path.join(storyPackage.artifact_dir, "publish_verdict.json"), {
    story_id: storyPackage.story_id,
    verdict: "RED",
    status: "GREEN",
    can_auto_publish: false,
  });

  const report = await buildGoalContractReport({ storyPackages: [storyPackage] });
  const row = report.publish_cutover_gate.story_results[0];

  assert.equal(row.final_publish_render, false);
  assert.ok(row.blockers.includes("package_verdict_not_green"));
  assert.ok(row.blockers.includes("canonical_verdict_not_green"));
  assert.ok(row.blockers.includes("render_verdict_not_green"));
  assert.ok(row.blockers.includes("review_verdict_not_green"));
  assert.ok(row.blockers.includes("publish_verdict_not_green"));
  assert.ok(row.blockers.includes("contradictory_green_and_non_green_verdicts"));
});

test("goal contract report turns the /goal into a no-fake-readiness acceptance matrix", async () => {
  const report = await buildGoalContractReport({
    generatedAt: "2026-05-21T19:00:00.000Z",
    moduleIndex: {
      "lib/public-output-manifest.js": true,
      "lib/studio-governance-engine.js": true,
      "lib/studio/v4/director-brain.js": true,
      "lib/studio/v4/footage-empire.js": true,
      "lib/studio/v4/sound-transition-planner.js": true,
      "lib/studio-enterprise-os.js": true,
      "lib/revenue-path-engine.js": true,
      "lib/intelligence/retention-intelligence.js": true,
    },
    artefactIndex: {
      "canonical_story_manifest.json": true,
      "rights_ledger.json": true,
      "publish_verdict.json": true,
      "platform_policy_report.json": true,
      "coherence_report.json": true,
    },
    testIndex: {
      generic_title_rejection: true,
      this_gaming_story_rejection: true,
      internal_qa_language_rejection: true,
      missing_rights_record_rejection: true,
      finance_crypto_unsafe_wording_rejection: true,
      green_amber_red_control_tower_verdicts: true,
    },
    storyPackages: Array.from({ length: 3 }, (_, index) =>
      completeStoryPackage(`story-${index + 1}`),
    ),
  });

  assert.equal(report.goal_id, "pulse_gaming_enterprise_media_os");
  assert.equal(report.status, "IN_PROGRESS");
  assert.equal(report.no_fake_readiness, true);
  assert.equal(report.required_systems.length, 26);
  assert.ok(report.system_summary.implemented > 0);
  assert.ok(report.system_summary.missing > 0);
  assert.equal(report.acceptance_30_story_gate.required_story_count, 30);
  assert.equal(report.acceptance_30_story_gate.package_complete_story_count, 3);
  assert.equal(report.acceptance_30_story_gate.complete_story_count, 0);
  assert.equal(report.acceptance_30_story_gate.status, "blocked");
  assert.ok(report.next_actions[0].reason_code);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);
});

test("goal contract requires flagship media portfolio evidence independently of 30-story breadth", async () => {
  const report = await buildGoalContractReport({
    storyPackages: Array.from({ length: 30 }, (_, index) =>
      completeStoryPackage(`breadth-story-${index + 1}`),
    ),
  });

  assert.equal(report.flagship_media_portfolio_gate.status, "blocked");
  assert.equal(report.flagship_media_portfolio_gate.portfolio_status, "MISSING");
  assert.deepEqual(report.flagship_media_portfolio_gate.blockers, [
    "flagship_media_portfolio_missing",
  ]);
  assert.equal(report.flagship_media_portfolio_gate.evidence, null);
  assert.ok(
    report.next_actions.some(
      (action) => action.reason_code === "flagship_media_portfolio_not_met",
    ),
  );
});

test("goal contract never promotes RED, AMBER or partial raw flagship portfolio evidence", async () => {
  const rawPortfolio = await rawFlagshipPortfolioFixture();
  const redPortfolio = await rawPortfolioWithReviewVerdict(rawPortfolio, "short_1", "RED");
  const amberPortfolio = await rawPortfolioWithReviewVerdict(rawPortfolio, "short_2", "AMBER");
  const partialPortfolio = clone(rawPortfolio);
  delete partialPortfolio.slots.longform_1;

  const red = await buildGoalContractReport({
    flagshipMediaPortfolio: redPortfolio,
  });
  const amber = await buildGoalContractReport({
    flagshipMediaPortfolio: amberPortfolio,
  });
  const partial = await buildGoalContractReport({
    flagshipMediaPortfolio: partialPortfolio,
  });

  assert.equal(red.flagship_media_portfolio_gate.status, "blocked");
  assert.equal(
    red.flagship_media_portfolio_gate.portfolio_status,
    "RED",
    JSON.stringify(red.flagship_media_portfolio_gate, null, 2),
  );
  assert.ok(
    red.flagship_media_portfolio_gate.blocker_codes.includes("final_av_review_verdict_not_green"),
  );
  assert.equal(amber.flagship_media_portfolio_gate.status, "blocked");
  assert.equal(amber.flagship_media_portfolio_gate.portfolio_status, "RED");
  assert.ok(
    amber.flagship_media_portfolio_gate.blocker_codes.includes("final_av_review_verdict_not_green"),
  );
  assert.equal(partial.flagship_media_portfolio_gate.status, "blocked");
  assert.equal(partial.flagship_media_portfolio_gate.portfolio_status, "RED");
  assert.ok(
    partial.flagship_media_portfolio_gate.blocker_codes.includes("required_slot_missing"),
  );
  assert.equal(red.status, "IN_PROGRESS");
  assert.equal(amber.status, "IN_PROGRESS");
  assert.equal(partial.status, "IN_PROGRESS");
});

test("goal contract evaluates raw flagship portfolio manifests through the strict evaluator", async () => {
  const report = await buildGoalContractReport({
    generatedAt: "2026-07-15T13:00:00.000Z",
    flagshipMediaPortfolio: {},
  });

  assert.equal(report.flagship_media_portfolio_gate.status, "blocked");
  assert.equal(report.flagship_media_portfolio_gate.portfolio_status, "RED");
  assert.ok(
    report.flagship_media_portfolio_gate.blocker_codes.includes("required_slot_missing"),
  );
  assert.equal(
    report.flagship_media_portfolio_gate.evidence.report_type,
    "flagship_media_portfolio_contract_evaluation",
  );
  assert.equal(
    report.flagship_media_portfolio_gate.evidence.generated_at,
    "2026-07-15T13:00:00.000Z",
  );
});

test("goal contract fails closed on a hand-crafted flagship portfolio report", async () => {
  const report = await buildGoalContractReport({
    flagshipMediaPortfolioReport: {
      contract_id: FLAGSHIP_MEDIA_PORTFOLIO_CONTRACT_ID,
      report_type: "flagship_media_portfolio_contract_evaluation",
      evaluation_complete: true,
      verdict: "GREEN",
      status: "GREEN",
      contract_satisfied: true,
      portfolio_ready: true,
      slots: Object.fromEntries(
        FLAGSHIP_MEDIA_PORTFOLIO_SLOTS.map((slotId) => [slotId, { pass: true }]),
      ),
    },
  });

  assert.equal(report.flagship_media_portfolio_gate.status, "blocked");
  assert.equal(
    report.flagship_media_portfolio_gate.portfolio_status,
    "UNEVALUATED_REPORT_REJECTED",
  );
  assert.deepEqual(report.flagship_media_portfolio_gate.blockers, [
    "flagship_media_portfolio_raw_manifest_required",
  ]);
  assert.equal(report.flagship_media_portfolio_gate.evidence, null);
});

test("goal contract accepts only an independently evaluated materialised flagship manifest", async () => {
  const flagshipMediaPortfolio = await rawFlagshipPortfolioFixture();

  const report = await buildGoalContractReport({ flagshipMediaPortfolio });

  assert.equal(
    report.flagship_media_portfolio_gate.status,
    "pass",
    JSON.stringify(report.flagship_media_portfolio_gate, null, 2),
  );
  assert.equal(report.flagship_media_portfolio_gate.portfolio_status, "GREEN");
  assert.equal(report.flagship_media_portfolio_gate.evidence.summary.verified_slot_count, 4);
  assert.equal(report.flagship_media_portfolio_gate.evidence.summary.unique_story_count, 4);
  assert.equal(report.flagship_media_portfolio_gate.evidence.summary.unique_media_hash_count, 4);
});

test("goal contract reaches acceptance only when the flagship portfolio and every existing gate pass", async () => {
  const [storyPackages, flagshipMediaPortfolio] = await Promise.all([
    materialiseStrictThirtyStoryPackages(),
    rawFlagshipPortfolioFixture(),
  ]);
  const report = await buildGoalContractReport({
    ...completeGoalContractIndexes(),
    storyPackages,
    flagshipMediaPortfolio,
  });

  assert.equal(report.system_summary.missing, 0);
  assert.equal(report.system_summary.partial, 0);
  assert.equal(report.required_artefacts_summary.missing, 0);
  assert.equal(report.required_tests_summary.missing, 0);
  assert.equal(report.acceptance_30_story_gate.status, "pass");
  assert.equal(report.acceptance_30_story_gate.unique_canonical_story_count, 30);
  assert.equal(report.acceptance_30_story_gate.unique_final_render_fingerprint_count, 30);
  assert.equal(report.publish_cutover_gate.status, "pass");
  assert.equal(report.publish_cutover_gate.unique_final_render_fingerprint_count, 30);
  assert.equal(report.flagship_media_portfolio_gate.status, "pass");
  assert.equal(report.flagship_media_portfolio_gate.portfolio_status, "GREEN");
  assert.equal(report.flagship_media_portfolio_gate.blockers.length, 0);
  assert.equal(report.status, "GOAL_ACCEPTANCE_READY");
  assert.equal(
    report.next_actions.some(
      (action) => action.reason_code === "flagship_media_portfolio_not_met",
    ),
    false,
  );
});

test("goal contract rejects a raw portfolio whose measured longform is below ten minutes", async () => {
  const flagshipMediaPortfolio = await rawFlagshipPortfolioFixture();
  flagshipMediaPortfolio.slots.longform_1.media = {
    ...flagshipMediaPortfolio.slots.short_1.media,
  };

  const report = await buildGoalContractReport({
    flagshipMediaPortfolio,
  });

  assert.equal(report.flagship_media_portfolio_gate.status, "blocked");
  assert.ok(
    report.flagship_media_portfolio_gate.blockers.includes(
      "longform_1:longform_duration_below_600_seconds",
    ),
  );
});

test("goal contract independently rejects a partial raw manifest despite headline-GREEN fields", async () => {
  const flagshipMediaPortfolio = await rawFlagshipPortfolioFixture();
  delete flagshipMediaPortfolio.slots.longform_1;
  Object.assign(flagshipMediaPortfolio, {
    verdict: "GREEN",
    status: "GREEN",
    contract_satisfied: true,
    portfolio_ready: true,
    summary: { verified_slot_count: 4, blocked_slot_count: 0 },
  });

  const report = await buildGoalContractReport({
    flagshipMediaPortfolio,
  });

  assert.equal(report.flagship_media_portfolio_gate.status, "blocked");
  assert.ok(
    report.flagship_media_portfolio_gate.blocker_codes.includes("required_slot_missing"),
  );
  assert.equal(report.flagship_media_portfolio_gate.evidence.summary.verified_slot_count, 3);
});

test("goal contract does not accept a manifest-only 30-story package set", async () => {
  const moduleIndex = Object.fromEntries(
    [
      "lib/public-output-manifest.js",
      "lib/studio-governance-engine.js",
      "lib/editorial-angle-engine.js",
      "lib/viral-script-intelligence.js",
      "lib/studio/v4/footage-empire.js",
      "lib/studio/v4/director-brain.js",
      "lib/studio/v4/proof-render.js",
      "lib/studio/v4/sound-transition-planner.js",
      "lib/media-house-benchmark.js",
      "lib/intelligence/retention-intelligence.js",
      "lib/intelligence/continuous-learning-loop.js",
      "lib/studio-enterprise-os.js",
      "lib/commercial-intelligence-engine.js",
      "lib/revenue-path-engine.js",
      "lib/intelligence/monetisation-readiness.js",
    ].map((file) => [file, true]),
  );

  const report = await buildGoalContractReport({
    moduleIndex,
    artefactIndex: Object.fromEntries(
      [
        "canonical_story_manifest.json",
        "story_scorecard.json",
        "source_manifest.json",
        "claim_inventory.json",
        "script_scorecard.json",
        "footage_inventory.json",
        "rights_ledger.json",
        "director_beat_map.json",
        "render_manifest.json",
        "audio_manifest.json",
        "sfx_manifest.json",
        "visual_quality_report.json",
        "forensic_qa_report.json",
        "benchmark_report.json",
        "coherence_report.json",
        "platform_policy_report.json",
        "affiliate_link_manifest.json",
        "landing_page_manifest.json",
        "publish_verdict.json",
        "analytics_ingest_plan.json",
        "audit_log.json",
        "youtube_publish_pack.json",
        "tiktok_publish_pack.json",
        "instagram_publish_pack.json",
        "facebook_publish_pack.json",
        "x_publish_pack.json",
        "threads_publish_pack.json",
        "pinterest_publish_pack.json",
        "carousel_manifest.json",
        "image_card_manifest.json",
        "thread_manifest.json",
        "observability_report.json",
        "security_report.json",
        "secrets_scan_report.json",
        "deployment_safety_report.json",
        "correction_queue.json",
        "affected_content_report.json",
        "correction_plan.json",
        "takedown_response_log.json",
        "sponsor_media_kit.json",
        "sponsor_pitch_pack.md",
        "brand_safety_report.json",
        "brand_system_manifest.json",
        "visual_style_guide.md",
        "editorial_style_guide.md",
        "recurring_format_registry.json",
        "prompt_model_registry.json",
        "video_lineage_manifest.json",
      ].map((file) => [file, true]),
    ),
    testIndex: {
      generic_title_rejection: true,
      this_gaming_story_rejection: true,
      internal_qa_language_rejection: true,
      source_mismatch_rejection: true,
      thumbnail_title_script_mismatch_rejection: true,
      missing_canonical_subject_rejection: true,
      missing_rights_record_rejection: true,
      affiliate_disclosure_rejection: true,
      finance_crypto_unsafe_wording_rejection: true,
      weak_first_frame_rejection: true,
      unreadable_mobile_text_rejection: true,
      excessive_caveat_ratio_rejection: true,
      repeated_visual_pattern_rejection: true,
      repeated_cta_rejection: true,
      platform_mirroring_detection: true,
      green_amber_red_control_tower_verdicts: true,
      platform_native_publish_pack_generation: true,
      x_thread_generation: true,
      instagram_carousel_generation: true,
      landing_page_generation: true,
      analytics_rule_update_generation: true,
      correction_workflow: true,
      secrets_scan: true,
      dry_run_publishing_mode: true,
    },
    storyPackages: Array.from({ length: 30 }, (_, index) =>
      completeStoryPackage(`story-${index + 1}`),
    ),
  });

  assert.equal(report.status, "IN_PROGRESS");
  assert.equal(report.acceptance_30_story_gate.package_complete_story_count, 30);
  assert.equal(report.acceptance_30_story_gate.complete_story_count, 0);
  assert.equal(report.acceptance_30_story_gate.verified_complete_story_count, 0);
  assert.equal(report.acceptance_30_story_gate.status, "blocked");
  assert.equal(report.publish_cutover_gate.final_publish_render_count, 0);
  assert.equal(report.required_tests_summary.missing, 0);
  assert.equal(report.required_artefacts_summary.missing, 0);
});

test("goal contract rejects 30 manifest-complete packages when no final MP4 is decodable", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-cutover-"));
  const storyPackages = [];
  for (let index = 0; index < 30; index += 1) {
    const entry = completeStoryPackage(`story-${index + 1}`);
    const storyDir = path.join(tmp, entry.story_id);
    await fs.ensureDir(storyDir);
    for (const basename of entry.artefacts) {
      if (basename === "render_manifest.json") {
        await fs.outputJson(path.join(storyDir, basename), {
          final_publish_render: index === 0,
          renderer: index === 0 ? "visual_v4_production" : "visual_v4_local_proof",
          output: "visual_v4_render.mp4",
        });
      } else {
        await fs.outputFile(path.join(storyDir, basename), basename.endsWith(".json") ? "{}" : "video");
      }
    }
    entry.artifact_dir = storyDir;
    storyPackages.push(entry);
  }

  const report = await buildGoalContractReport({
    moduleIndex: Object.fromEntries([
      "lib/public-output-manifest.js",
      "lib/studio-governance-engine.js",
      "lib/editorial-angle-engine.js",
      "lib/viral-script-intelligence.js",
      "lib/studio/v4/footage-empire.js",
      "lib/studio/v4/director-brain.js",
      "lib/studio/v4/proof-render.js",
      "lib/studio/v4/sound-transition-planner.js",
      "lib/media-house-benchmark.js",
      "lib/intelligence/retention-intelligence.js",
      "lib/intelligence/continuous-learning-loop.js",
      "lib/studio-enterprise-os.js",
      "lib/commercial-intelligence-engine.js",
      "lib/revenue-path-engine.js",
      "lib/intelligence/monetisation-readiness.js",
    ].map((file) => [file, true])),
    artefactIndex: Object.fromEntries([
      "canonical_story_manifest.json",
      "story_scorecard.json",
      "source_manifest.json",
      "claim_inventory.json",
      "script_scorecard.json",
      "footage_inventory.json",
      "rights_ledger.json",
      "director_beat_map.json",
      "render_manifest.json",
      "audio_manifest.json",
      "sfx_manifest.json",
      "visual_quality_report.json",
      "forensic_qa_report.json",
      "benchmark_report.json",
      "coherence_report.json",
      "platform_policy_report.json",
      "affiliate_link_manifest.json",
      "landing_page_manifest.json",
      "publish_verdict.json",
      "analytics_ingest_plan.json",
      "audit_log.json",
      "youtube_publish_pack.json",
      "tiktok_publish_pack.json",
      "instagram_publish_pack.json",
      "facebook_publish_pack.json",
      "x_publish_pack.json",
      "threads_publish_pack.json",
      "pinterest_publish_pack.json",
      "carousel_manifest.json",
      "image_card_manifest.json",
      "thread_manifest.json",
      "observability_report.json",
      "security_report.json",
      "secrets_scan_report.json",
      "deployment_safety_report.json",
      "correction_queue.json",
      "affected_content_report.json",
      "correction_plan.json",
      "takedown_response_log.json",
      "sponsor_media_kit.json",
      "sponsor_pitch_pack.md",
      "brand_safety_report.json",
      "brand_system_manifest.json",
      "visual_style_guide.md",
      "editorial_style_guide.md",
      "recurring_format_registry.json",
      "prompt_model_registry.json",
      "video_lineage_manifest.json",
    ].map((file) => [file, true])),
    testIndex: Object.fromEntries([
      "generic_title_rejection",
      "this_gaming_story_rejection",
      "internal_qa_language_rejection",
      "source_mismatch_rejection",
      "thumbnail_title_script_mismatch_rejection",
      "missing_canonical_subject_rejection",
      "missing_rights_record_rejection",
      "affiliate_disclosure_rejection",
      "finance_crypto_unsafe_wording_rejection",
      "weak_first_frame_rejection",
      "unreadable_mobile_text_rejection",
      "excessive_caveat_ratio_rejection",
      "repeated_visual_pattern_rejection",
      "repeated_cta_rejection",
      "platform_mirroring_detection",
      "green_amber_red_control_tower_verdicts",
      "platform_native_publish_pack_generation",
      "x_thread_generation",
      "instagram_carousel_generation",
      "landing_page_generation",
      "analytics_rule_update_generation",
      "correction_workflow",
      "secrets_scan",
      "dry_run_publishing_mode",
    ].map((id) => [id, true])),
    storyPackages,
  });

  assert.equal(report.acceptance_30_story_gate.status, "blocked");
  assert.equal(report.publish_cutover_gate.status, "blocked");
  assert.equal(report.publish_cutover_gate.final_publish_render_count, 0);
  assert.equal(report.status, "IN_PROGRESS");
  assert.ok(report.next_actions.some((action) => action.reason_code === "production_render_cutover_not_met"));
});

test("publish cutover rejects missing and non-decodable MP4s despite final-render claims", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-media-proof-"));
  const storyPackages = [];
  for (const [index, materialiseInvalidMp4] of [false, true].entries()) {
    const storyDir = path.join(tmp, `story-${index + 1}`);
    await fs.ensureDir(storyDir);
    await fs.outputJson(path.join(storyDir, "render_manifest.json"), {
      final_publish_render: true,
      renderer: "visual_v4_production",
      output: "visual_v4_render.mp4",
    });
    if (materialiseInvalidMp4) {
      await fs.outputFile(path.join(storyDir, "visual_v4_render.mp4"), "not-a-decodable-mp4");
    }
    storyPackages.push({ story_id: `story-${index + 1}`, artifact_dir: storyDir });
  }

  const gate = buildPublishCutoverGate(storyPackages);

  assert.equal(gate.final_publish_render_count, 0);
  assert.equal(gate.status, "blocked");
  assert.deepEqual(
    gate.blocked_stories.map((story) => story.blocker),
    ["final_render_missing", "final_render_not_decodable"],
  );
});

test("publish cutover rejects a decodable H.264 portrait MP4 without embedded audio", async () => {
  const storyPackage = await materialiseFinalMediaFixture({
    storyId: "audio-less-final",
    includeAudio: false,
  });

  const gate = buildPublishCutoverGate([storyPackage]);

  assert.equal(gate.final_publish_render_count, 0);
  assert.equal(gate.story_results[0].final_publish_render, false);
  assert.equal(gate.story_results[0].blocker, "final_render_audio_missing");
});

test("publish cutover rejects a decodable portrait MP4 with a non-H.264 video stream", async () => {
  const storyPackage = await materialiseFinalMediaFixture({
    storyId: "wrong-video-codec",
    videoCodec: "mpeg4",
  });

  const gate = buildPublishCutoverGate([storyPackage]);

  assert.equal(gate.final_publish_render_count, 0);
  assert.equal(gate.story_results[0].final_publish_render, false);
  assert.equal(gate.story_results[0].blocker, "final_render_video_codec_invalid");
});

test("publish cutover rejects a decodable H.264 portrait MP4 with non-AAC audio", async () => {
  const storyPackage = await materialiseFinalMediaFixture({
    storyId: "wrong-audio-codec",
    audioCodec: "libmp3lame",
  });

  const gate = buildPublishCutoverGate([storyPackage]);

  assert.equal(gate.final_publish_render_count, 0);
  assert.equal(gate.story_results[0].final_publish_render, false);
  assert.equal(gate.story_results[0].blocker, "final_render_audio_codec_invalid");
});

test("publish cutover rejects a decodable H.264/AAC MP4 that is not 1080x1920 portrait", async () => {
  const landscapePackage = await materialiseFinalMediaFixture({
    storyId: "wrong-final-aspect",
    width: 1920,
    height: 1080,
  });
  const undersizedPortraitPackage = await materialiseFinalMediaFixture({
    storyId: "wrong-final-resolution",
    width: 720,
    height: 1280,
  });

  const gate = buildPublishCutoverGate([landscapePackage, undersizedPortraitPackage]);

  assert.equal(gate.final_publish_render_count, 0);
  assert.deepEqual(
    gate.story_results.map((row) => row.blocker),
    ["final_render_dimensions_invalid", "final_render_dimensions_invalid"],
  );
});

test("publish cutover rejects a decodable 2.4-second placeholder as nontrivial final media", async () => {
  const storyPackage = await materialiseFinalMediaFixture({
    storyId: "placeholder-duration",
    durationSeconds: 2.4,
  });

  const gate = buildPublishCutoverGate([storyPackage]);

  assert.equal(gate.final_publish_render_count, 0);
  assert.equal(gate.story_results[0].final_publish_render, false);
  assert.equal(gate.story_results[0].blocker, "final_render_duration_too_short");
});

test("publish cutover accepts a same-run 1080x1920 H.264/AAC final MP4", async () => {
  const storyPackage = await materialiseFinalMediaFixture({
    storyId: "strict-final-control",
  });

  const gate = buildPublishCutoverGate([storyPackage]);

  assert.equal(gate.final_publish_render_count, 1);
  assert.equal(gate.story_results[0].final_publish_render, true);
  assert.equal(gate.story_results[0].blocker, null);
  assert.equal(gate.story_results[0].video_codec, "h264");
  assert.ok(gate.story_results[0].duration_seconds >= 10);
});

test("publish cutover rejects codec-correct final media when its same-run hashes are stale", async () => {
  const storyPackage = await materialiseFinalMediaFixture({
    storyId: "stale-final-control",
  });
  await fs.appendFile(path.join(storyPackage.artifact_dir, "narration.wav"), "-changed-after-render");

  const gate = buildPublishCutoverGate([storyPackage]);

  assert.equal(gate.final_publish_render_count, 0);
  assert.equal(gate.story_results[0].final_publish_render, false);
  assert.equal(gate.story_results[0].blocker, "final_render_audio_fingerprint_mismatch");
  assert.ok(gate.story_results[0].lineage_blockers.includes("final_render_fingerprint_signature_mismatch"));
});

test("final render lineage fails closed when same-run input fingerprints are absent", async () => {
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-lineage-"));
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "story-one",
    selected_title: "A concrete title",
    thumbnail_headline: "CONCRETE TITLE",
    first_spoken_line: "A concrete opening line.",
    narration_script: "A concrete opening line with a specific player-facing payoff.",
    canonical_subject: "Concrete Game",
    canonical_angle: "confirmed_update",
    primary_source: "Official Publisher",
  });
  await fs.outputFile(path.join(artifactDir, "narration.mp3"), "current-audio-bytes");
  await fs.outputJson(path.join(artifactDir, "word_timestamps.json"), [
    { word: "A", start: 0, end: 0.1 },
  ]);
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: "narration.mp3",
    word_timestamps_path: "word_timestamps.json",
  });

  const result = verifyFinalRenderInputLineage(
    { story_id: "story-one", artifact_dir: artifactDir },
    { final_publish_render: true, input_fingerprint: {} },
  );

  assert.equal(result.pass, false);
  assert.deepEqual(result.blockers, [
    "final_render_fingerprint_signature_missing",
    "final_render_canonical_copy_hash_missing",
    "final_render_audio_fingerprint_missing",
    "final_render_word_timestamps_fingerprint_missing",
  ]);
});

test("final render lineage rejects populated but stale input fingerprints", async () => {
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-lineage-stale-"));
  const canonical = {
    story_id: "story-two",
    selected_title: "Current concrete title",
    thumbnail_headline: "CURRENT TITLE",
    first_spoken_line: "The current opening line.",
    narration_script: "The current opening line has a concrete and useful payoff.",
    canonical_subject: "Current Game",
    canonical_angle: "confirmed_update",
    primary_source: "Official Publisher",
  };
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), canonical);
  await fs.outputFile(path.join(artifactDir, "narration.mp3"), "current-audio-bytes");
  await fs.outputJson(path.join(artifactDir, "word_timestamps.json"), [
    { word: "The", start: 0, end: 0.2 },
  ]);
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: "narration.mp3",
    word_timestamps_path: "word_timestamps.json",
  });

  const staleHash = crypto.createHash("sha256").update("stale").digest("hex");
  const result = verifyFinalRenderInputLineage(
    { story_id: "story-two", artifact_dir: artifactDir },
    {
      final_publish_render: true,
      input_fingerprint: {
        algorithm: "sha256",
        signature: staleHash,
        canonical_public_copy_hash: staleHash,
        audio_sha256: staleHash,
        word_timestamps_sha256: staleHash,
        audio_size_bytes: 999,
        word_timestamps_size_bytes: 999,
        canonical_snapshot: { story_id: "stale-story" },
      },
    },
  );

  assert.equal(result.pass, false);
  assert.deepEqual(result.blockers, [
    "final_render_canonical_copy_fingerprint_mismatch",
    "final_render_audio_fingerprint_mismatch",
    "final_render_word_timestamps_fingerprint_mismatch",
    "final_render_audio_size_mismatch",
    "final_render_word_timestamps_size_mismatch",
    "final_render_fingerprint_signature_mismatch",
  ]);
});

test("goal contract blocks GREEN story packages when claimed artefacts are not materialised", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-materialised-"));
  const storyDir = path.join(tmp, "story-one");
  await fs.ensureDir(storyDir);
  const packageEntry = completeStoryPackage("story-one");
  packageEntry.artifact_dir = storyDir;
  for (const basename of packageEntry.artefacts.filter((name) => name !== "captions.srt")) {
    await fs.outputFile(path.join(storyDir, basename), basename.endsWith(".json") ? "{}" : "video");
  }

  const report = await buildGoalContractReport({
    storyPackages: [
      packageEntry,
      ...Array.from({ length: 29 }, (_, index) => completeStoryPackage(`story-${index + 2}`)),
    ],
  });

  assert.equal(report.acceptance_30_story_gate.status, "blocked");
  assert.equal(report.acceptance_30_story_gate.package_complete_story_count, 29);
  assert.equal(report.acceptance_30_story_gate.complete_story_count, 0);
  assert.deepEqual(
    report.acceptance_30_story_gate.incomplete_stories[0].missing_materialised_artefacts,
    ["captions.srt"],
  );
});

test("goal contract artefacts are written as JSON and readable Markdown", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-contract-"));
  const report = await buildGoalContractReport({
    generatedAt: "2026-05-21T19:10:00.000Z",
    storyPackages: [completeStoryPackage("one")],
  });

  const artefacts = await writeGoalContractArtifacts(report, { outputDir: tmp });
  const markdown = renderGoalContractMarkdown(report);
  const matrix = await fs.readJson(artefacts.matrixPath);

  assert.equal(await fs.pathExists(artefacts.jsonPath), true);
  assert.equal(await fs.pathExists(artefacts.markdownPath), true);
  assert.match(markdown, /Pulse Gaming Goal Contract/);
  assert.match(markdown, /Status: IN_PROGRESS/);
  assert.match(markdown, /30-story gate: blocked/);
  assert.match(markdown, /Flagship media portfolio: blocked \(MISSING, 0\/4 verified\)/);
  assert.doesNotMatch(markdown, /done/i);
  assert.equal(matrix.status, "IN_PROGRESS");
  assert.equal(matrix.acceptance_status, "blocked");
  assert.equal(matrix.no_fake_readiness, true);
  assert.deepEqual(
    matrix.flagship_media_portfolio_gate,
    report.flagship_media_portfolio_gate,
  );
});
