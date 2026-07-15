"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  FLAGSHIP_MEDIA_PORTFOLIO_SLOTS,
  evaluateAndWriteFlagshipMediaPortfolio,
  evaluateFlagshipMediaPortfolio,
  writeFlagshipMediaPortfolioReport,
} = require("../../lib/flagship-media-portfolio");

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function srtTimestamp(seconds) {
  const milliseconds = Math.max(0, Math.round(Number(seconds) * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function runFfmpeg(args) {
  execFileSync(process.env.FFMPEG_PATH || "ffmpeg", args, {
    stdio: "ignore",
    timeout: 120_000,
    windowsHide: true,
  });
}

async function materialiseLegacySlot(root, {
  slotId,
  storyId,
  mediaType,
  size,
  durationSeconds,
  colour,
  frequency,
  sourceFamily,
  motionFamily,
}) {
  const slotDir = path.join(root, slotId);
  const mediaPath = path.join(slotDir, "final.mp4");
  const narrationPath = path.join(slotDir, "narration.m4a");
  const timestampsPath = path.join(slotDir, "word_timestamps.json");
  const captionsPath = path.join(slotDir, "captions.srt");
  const rightsPath = path.join(slotDir, "rights_lineage.json");
  await fs.ensureDir(slotDir);

  runFfmpeg([
    "-y",
    "-v", "error",
    "-f", "lavfi",
    "-i", `color=c=${colour}:s=${size}:r=1:d=${durationSeconds}`,
    "-f", "lavfi",
    "-i", `sine=frequency=${frequency}:sample_rate=8000:duration=${durationSeconds}`,
    "-shortest",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "stillimage",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "16k",
    mediaPath,
  ]);
  runFfmpeg([
    "-y",
    "-v", "error",
    "-i", mediaPath,
    "-vn",
    "-c:a", "copy",
    narrationPath,
  ]);

  await fs.writeJson(timestampsPath, {
    complete: true,
    words: [
      { word: "Opening", start: 0, end: Math.min(1, durationSeconds / 2) },
      { word: "complete", start: Math.min(1, durationSeconds / 2), end: durationSeconds },
    ],
  }, { spaces: 2 });
  await fs.writeFile(
    captionsPath,
    `1\n${srtTimestamp(0)} --> ${srtTimestamp(durationSeconds)}\nOpening complete\n`,
    "utf8",
  );

  const mediaHash = sha256(mediaPath);
  const rightsAssetId = `${slotId}_primary_source`;
  await fs.writeJson(rightsPath, {
    complete: true,
    verdict: "GREEN",
    used_assets: [{
      asset_id: rightsAssetId,
      source_url: `https://example.test/${sourceFamily}`,
      asset_sha256: mediaHash,
    }],
    records: [{
      asset_id: rightsAssetId,
      source_url: `https://example.test/${sourceFamily}`,
      source_owner: "Pulse test fixture",
      licence_basis: "owned test media",
      commercial_use_allowed: true,
      asset_sha256: mediaHash,
    }],
  }, { spaces: 2 });

  const hashes = {
    media: mediaHash,
    narration: sha256(narrationPath),
    word_timestamps: sha256(timestampsPath),
    captions: sha256(captionsPath),
    rights_lineage: sha256(rightsPath),
  };
  const [width, height] = size.split("x").map(Number);

  return {
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
    final_av_review: {
      verdict: "GREEN",
      reviewed_hashes: hashes,
    },
  };
}

async function materialiseLegacyPortfolio(root) {
  const slotInputs = [
    {
      slotId: "short_1",
      storyId: "story_alpha",
      mediaType: "short",
      size: "180x320",
      durationSeconds: 2,
      colour: "red",
      frequency: 310,
      sourceFamily: "official_press_release",
      motionFamily: "owned_gameplay_capture",
    },
    {
      slotId: "short_2",
      storyId: "story_bravo",
      mediaType: "short",
      size: "180x320",
      durationSeconds: 3,
      colour: "green",
      frequency: 410,
      sourceFamily: "steam_store_news",
      motionFamily: "licensed_trailer_edit",
    },
    {
      slotId: "short_3",
      storyId: "story_charlie",
      mediaType: "short",
      size: "180x320",
      durationSeconds: 4,
      colour: "blue",
      frequency: 510,
      sourceFamily: "publisher_newsroom",
      motionFamily: "owned_kinetic_graphics",
    },
    {
      slotId: "longform_1",
      storyId: "story_delta",
      mediaType: "longform",
      size: "320x180",
      durationSeconds: 4,
      colour: "purple",
      frequency: 610,
      sourceFamily: "multi_source_dossier",
      motionFamily: "chaptered_editorial_mix",
    },
  ];
  const slots = {};
  for (const input of slotInputs) slots[input.slotId] = await materialiseLegacySlot(root, input);
  return {
    schema_version: 1,
    operating_mode: "LOCAL_PROOF",
    slots,
  };
}

const TIMELINE_VOCABULARY = (
  "pulse gaming verified official footage reveals mechanics characters locations combat exploration " +
  "developer studio publisher confirms launch details platforms features performance accessibility " +
  "players discover missions rewards upgrades strategy movement animation lighting environments audio " +
  "analysis compares evidence sources context history changes systems choices consequences multiplayer " +
  "campaign progression design technology interface controls quality release coverage reporting explains " +
  "clearly accurately independently editorial review captions narration timestamps rights provenance"
).split(" ");

function buildDenseTimeline(durationSeconds) {
  const words = [];
  for (let start = 0, index = 0; start < durationSeconds; start += 0.5, index += 1) {
    words.push({
      word: TIMELINE_VOCABULARY[index % TIMELINE_VOCABULARY.length],
      start: Number(start.toFixed(3)),
      end: Number(Math.min(durationSeconds, start + 0.35).toFixed(3)),
    });
  }
  const cues = [];
  for (let index = 0; index < words.length; index += 8) {
    const cueWords = words.slice(index, index + 8);
    cues.push([
      String(cues.length + 1),
      `${srtTimestamp(cueWords[0].start)} --> ${srtTimestamp(cueWords.at(-1).end)}`,
      cueWords.map((row) => row.word).join(" "),
    ].join("\n"));
  }
  return { words, captions: `${cues.join("\n\n")}\n` };
}

function sampledFrameSha256(mediaPath, timeSeconds) {
  const pixels = execFileSync(process.env.FFMPEG_PATH || "ffmpeg", [
    "-hide_banner",
    "-nostdin",
    "-v", "error",
    "-i", mediaPath,
    "-ss", String(timeSeconds),
    "-map", "0:v:0",
    "-frames:v", "1",
    "-an",
    "-sn",
    "-dn",
    "-threads", "1",
    "-pix_fmt", "rgba",
    "-f", "rawvideo",
    "pipe:1",
  ], {
    encoding: null,
    timeout: 30_000,
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
  });
  return crypto.createHash("sha256").update(pixels).digest("hex");
}

function passingForensicReport({ storyId, mediaPath, durationSeconds }) {
  const mediaHash = sha256(mediaPath);
  const mediaSize = fs.statSync(mediaPath).size;
  const checks = Object.fromEntries(
    ["audio", "video", "captions", "av_sync", "freeze", "black", "blur", "repetition"]
      .map((key) => [key, { checked: true, verdict: "pass" }]),
  );
  return {
    schema_version: 1,
    story_id: storyId,
    status: "pass",
    verdict: "pass",
    final_media: { sha256: mediaHash, size_bytes: mediaSize },
    checks,
    sampled_frames: [0, 0.25, 0.5, 0.75, 0.95].map((ratio) => {
      const timeSeconds = Number((durationSeconds * ratio).toFixed(3));
      return {
        time_seconds: timeSeconds,
        hash: sampledFrameSha256(mediaPath, timeSeconds),
      };
    }),
    critical_defects: [],
  };
}

async function materialiseProductionSlot(root, {
  slotId,
  storyId,
  mediaType,
  size,
  durationSeconds,
  videoSource,
  sourceFamily,
  motionFamily,
  narrationText,
}) {
  const slotDir = path.join(root, "production", slotId);
  const speechSeedPath = path.join(slotDir, "speech-seed.wav");
  const narrationPath = path.join(slotDir, "narration.m4a");
  const mediaPath = path.join(slotDir, "final.mp4");
  const sourceAssetPath = path.join(slotDir, "source-asset.png");
  const rightsEvidencePath = path.join(slotDir, "rights-evidence.txt");
  const timestampsPath = path.join(slotDir, "word_timestamps.json");
  const captionsPath = path.join(slotDir, "captions.srt");
  const rightsPath = path.join(slotDir, "rights_lineage.json");
  const forensicPath = path.join(slotDir, "decoded-forensic-report.json");
  await fs.ensureDir(slotDir);

  runFfmpeg([
    "-y", "-v", "error",
    "-f", "lavfi",
    "-i", `flite=text='${narrationText}':voice=slt`,
    "-ar", "16000",
    "-ac", "1",
    speechSeedPath,
  ]);
  runFfmpeg([
    "-y", "-v", "error",
    "-stream_loop", "-1",
    "-i", speechSeedPath,
    "-t", String(durationSeconds),
    "-c:a", "aac",
    "-b:a", "48k",
    narrationPath,
  ]);
  runFfmpeg([
    "-y", "-v", "error",
    "-f", "lavfi",
    "-i", videoSource,
    "-frames:v", "1",
    sourceAssetPath,
  ]);
  runFfmpeg([
    "-y", "-v", "error",
    "-f", "lavfi",
    "-i", videoSource,
    "-i", narrationPath,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-t", String(durationSeconds),
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "28",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "48k",
    mediaPath,
  ]);

  const narrationHash = sha256(narrationPath);
  const timeline = buildDenseTimeline(durationSeconds);
  await fs.writeJson(timestampsPath, {
    complete: true,
    alignment_source: "decoded_speech_fixture",
    audio_sha256: narrationHash,
    words: timeline.words,
  }, { spaces: 2 });
  await fs.writeFile(captionsPath, timeline.captions, "utf8");

  const sourceAssetHash = sha256(sourceAssetPath);
  await fs.writeFile(
    rightsEvidencePath,
    `Owned local fixture for ${storyId}; commercial editorial use allowed; source ${sourceFamily}.\n`,
    "utf8",
  );
  const rightsEvidenceHash = sha256(rightsEvidencePath);
  const rightsAssetId = `${slotId}_primary_source`;
  await fs.writeJson(rightsPath, {
    complete: true,
    verdict: "GREEN",
    used_assets: [{
      asset_id: rightsAssetId,
      source_url: `https://example.test/${sourceFamily}/${storyId}`,
      local_path: sourceAssetPath,
      asset_sha256: sourceAssetHash,
    }],
    records: [{
      asset_id: rightsAssetId,
      source_url: `https://example.test/${sourceFamily}/${storyId}`,
      source_owner: "Pulse local fixture",
      licence_basis: "owned test media",
      commercial_use_allowed: true,
      asset_sha256: sourceAssetHash,
      rights_evidence_path: rightsEvidencePath,
      rights_evidence_sha256: rightsEvidenceHash,
    }],
  }, { spaces: 2 });

  const forensicReport = passingForensicReport({ storyId, mediaPath, durationSeconds });
  await fs.writeJson(forensicPath, forensicReport, { spaces: 2 });
  const artefacts = {
    final_mp4: mediaPath,
    contact_sheet: sourceAssetPath,
    decoded_forensic_report: forensicPath,
  };
  const finalAvReview = {
    schema_version: 1,
    story_id: storyId,
    reviewed_at: "2026-07-15T11:00:00.000Z",
    reviewer: { id: "independent-final-av-reviewer", independent: true },
    artefacts,
    reviewed_artefact_fingerprints: Object.fromEntries(
      Object.entries(artefacts).map(([key, filePath]) => [key, sha256(filePath)]),
    ),
    contact_sheet_binding: {
      contact_sheet_sha256: sha256(sourceAssetPath),
      final_mp4_sha256: sha256(mediaPath),
      decoded_forensic_report_sha256: sha256(forensicPath),
      sampled_frames: forensicReport.sampled_frames,
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
  };
  const [width, height] = size.split("x").map(Number);
  return {
    story_id: storyId,
    media_type: mediaType,
    artifact_dir: slotDir,
    media: {
      path: mediaPath,
      sha256: sha256(mediaPath),
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
      sha256: narrationHash,
      duration_seconds: durationSeconds,
      complete: true,
    },
    word_timestamps: {
      path: timestampsPath,
      sha256: sha256(timestampsPath),
      complete: true,
    },
    captions: {
      path: captionsPath,
      sha256: sha256(captionsPath),
      complete: true,
    },
    rights_lineage: {
      path: rightsPath,
      sha256: sha256(rightsPath),
      complete: true,
    },
    source_identity: { family: sourceFamily },
    motion_identity: { family: motionFamily },
    final_av_review: finalAvReview,
  };
}

async function materialiseProductionPortfolio(root) {
  const inputs = [
    {
      slotId: "short_1",
      storyId: "story_alpha",
      mediaType: "short",
      size: "180x320",
      durationSeconds: 36,
      videoSource: "testsrc2=size=180x320:rate=2",
      sourceFamily: "official_press_release",
      motionFamily: "owned_gameplay_capture",
      narrationText: "Official footage shows the new combat system and explains the verified launch details for players",
    },
    {
      slotId: "short_2",
      storyId: "story_bravo",
      mediaType: "short",
      size: "180x320",
      durationSeconds: 38,
      videoSource: "life=size=180x320:rate=2:ratio=0.25:seed=41:mold=8",
      sourceFamily: "steam_store_news",
      motionFamily: "licensed_trailer_edit",
      narrationText: "The store update confirms fresh progression features while this report separates evidence from speculation",
    },
    {
      slotId: "short_3",
      storyId: "story_charlie",
      mediaType: "short",
      size: "180x320",
      durationSeconds: 40,
      videoSource: "mandelbrot=size=180x320:rate=2:end_pts=80:morphamp=0.2",
      sourceFamily: "publisher_newsroom",
      motionFamily: "owned_kinetic_graphics",
      narrationText: "The publisher newsroom reveals the release plan with clear context on platforms performance and accessibility",
    },
    {
      slotId: "longform_1",
      storyId: "story_delta",
      mediaType: "longform",
      size: "320x180",
      durationSeconds: 600,
      videoSource: "cellauto=size=320x180:rate=1:rule=30:ratio=0.45:seed=73:scroll=1",
      sourceFamily: "multi_source_dossier",
      motionFamily: "chaptered_editorial_mix",
      narrationText: "This independent long form briefing traces verified evidence and gives every source the context needed for an accurate conclusion",
    },
  ];
  const slots = {};
  for (const input of inputs) slots[input.slotId] = await materialiseProductionSlot(root, input);
  return { schema_version: 1, operating_mode: "LOCAL_PROOF", slots };
}

let root;
let legacyPortfolio;
let portfolio;
let greenReport;

test.before(async () => {
  execFileSync(process.env.FFPROBE_PATH || "ffprobe", ["-version"], { stdio: "ignore" });
  root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-flagship-portfolio-"));
  legacyPortfolio = await materialiseLegacyPortfolio(root);
  portfolio = await materialiseProductionPortfolio(root);
  greenReport = await evaluateFlagshipMediaPortfolio(portfolio, {
    generatedAt: "2026-07-15T12:00:00.000Z",
  });
});

test.after(async () => {
  if (root) await fs.remove(root);
});

test("flagship portfolio rejects legacy solid-colour, pure-tone and sparse-timeline proof", async () => {
  const report = await evaluateFlagshipMediaPortfolio(legacyPortfolio);

  assert.equal(report.verdict, "RED");
  assert.equal(report.contract_satisfied, false);
  assert.ok(report.slots.short_1.blockers.includes("short_duration_below_production_minimum"));
});

test("public evaluator rejects self-claimed final AV hashes without strict decoded-forensic proof", async () => {
  const report = await evaluateFlagshipMediaPortfolio(legacyPortfolio);

  for (const slotId of FLAGSHIP_MEDIA_PORTFOLIO_SLOTS) {
    assert.equal(report.slots[slotId].final_av_review.strict_valid, false, slotId);
    assert.ok(
      report.slots[slotId].blockers.includes("final_av_review_schema_version_invalid"),
      slotId,
    );
    assert.ok(
      report.slots[slotId].blockers.includes("final_av_review_artefacts_invalid"),
      slotId,
    );
  }
});

test("public evaluator surfaces strict rejection of self-claimed sampled-frame hashes", async () => {
  const candidate = clone(portfolio);
  const slot = candidate.slots.short_1;
  const forensic = await fs.readJson(slot.final_av_review.artefacts.decoded_forensic_report);
  forensic.sampled_frames[2].hash = "0".repeat(64);
  const forensicPath = path.join(slot.artifact_dir, "tampered-decoded-forensic-report.json");
  await fs.writeJson(forensicPath, forensic, { spaces: 2 });
  slot.final_av_review.artefacts.decoded_forensic_report = forensicPath;
  slot.final_av_review.reviewed_artefact_fingerprints.decoded_forensic_report = sha256(forensicPath);
  slot.final_av_review.contact_sheet_binding.decoded_forensic_report_sha256 = sha256(forensicPath);
  slot.final_av_review.contact_sheet_binding.sampled_frames = forensic.sampled_frames;

  const report = await evaluateFlagshipMediaPortfolio(candidate);

  assert.ok(report.slots.short_1.blockers.includes("sampled_frame_hash_verification_failed"));
  assert.ok(
    report.slots.short_1.final_av_review.decoded_forensic_blockers.includes(
      "sampled_frame_hash_verification_failed",
    ),
  );
});

test("public evaluator rejects two-word timestamps, one caption cue and tone-only narration", async () => {
  const report = await evaluateFlagshipMediaPortfolio(legacyPortfolio);

  for (const slotId of FLAGSHIP_MEDIA_PORTFOLIO_SLOTS) {
    assert.ok(
      report.slots[slotId].blockers.includes("word_timestamps_nontrivial_coverage_missing"),
      slotId,
    );
    assert.ok(
      report.slots[slotId].blockers.includes("captions_nontrivial_coverage_missing"),
      slotId,
    );
    assert.ok(
      report.slots[slotId].blockers.includes("narration_speech_evidence_missing"),
      slotId,
    );
  }
});

test("public evaluator rejects rights ledgers without recomputable asset and evidence files", async () => {
  const report = await evaluateFlagshipMediaPortfolio(legacyPortfolio);

  for (const slotId of FLAGSHIP_MEDIA_PORTFOLIO_SLOTS) {
    assert.ok(
      report.slots[slotId].blockers.includes("rights_asset_file_missing"),
      slotId,
    );
    assert.ok(
      report.slots[slotId].blockers.includes("rights_evidence_file_missing"),
      slotId,
    );
    assert.equal(report.slots[slotId].rights_lineage.recomputed_asset_hash_count, 0);
    assert.equal(report.slots[slotId].rights_lineage.recomputed_evidence_hash_count, 0);
  }
});

test("public evaluator recomputes rights asset and licence-evidence hashes after tampering", async () => {
  const candidate = clone(portfolio);
  const ledger = await fs.readJson(candidate.slots.short_1.rights_lineage.path);
  const tamperDir = path.join(root, "tampered-rights");
  const assetPath = path.join(tamperDir, "source-asset.png");
  const evidencePath = path.join(tamperDir, "rights-evidence.txt");
  const ledgerPath = path.join(tamperDir, "rights-lineage.json");
  await fs.ensureDir(tamperDir);
  await fs.copy(ledger.used_assets[0].local_path, assetPath);
  await fs.copy(ledger.records[0].rights_evidence_path, evidencePath);
  await fs.appendFile(assetPath, Buffer.from("tampered-source"));
  await fs.appendFile(evidencePath, "tampered-evidence\n", "utf8");
  ledger.used_assets[0].local_path = assetPath;
  ledger.records[0].rights_evidence_path = evidencePath;
  await fs.writeJson(ledgerPath, ledger, { spaces: 2 });
  candidate.slots.short_1.rights_lineage.path = ledgerPath;
  candidate.slots.short_1.rights_lineage.sha256 = sha256(ledgerPath);

  const report = await evaluateFlagshipMediaPortfolio(candidate);

  assert.ok(report.slots.short_1.blockers.includes("rights_asset_sha256_mismatch"));
  assert.ok(report.slots.short_1.blockers.includes("rights_evidence_sha256_mismatch"));
  assert.equal(report.slots.short_1.rights_lineage.recomputed_asset_hash_count, 0);
  assert.equal(report.slots.short_1.rights_lineage.recomputed_evidence_hash_count, 0);
});

test("public evaluator rejects dense captions that do not match the timestamped narration", async () => {
  const candidate = clone(portfolio);
  const captionsPath = path.join(root, "mismatched-captions.srt");
  const captions = await fs.readFile(candidate.slots.short_1.captions.path, "utf8");
  let replacementIndex = 0;
  const mismatched = captions.replace(/\b[A-Za-z][A-Za-z']*\b/g, () => (
    `unrelated${replacementIndex++ % 60}`
  ));
  await fs.writeFile(captionsPath, mismatched, "utf8");
  candidate.slots.short_1.captions.path = captionsPath;
  candidate.slots.short_1.captions.sha256 = sha256(captionsPath);

  const report = await evaluateFlagshipMediaPortfolio(candidate);

  assert.ok(report.slots.short_1.blockers.includes("caption_timestamp_timeline_incoherent"));
  assert.ok(report.slots.short_1.captions.timestamp_text_coverage_ratio < 0.1);
});

test("public evaluator rejects production-duration pure-tone narration despite fresh file hashes", async () => {
  const candidate = clone(portfolio);
  const tonePath = path.join(root, "tone-only-narration.m4a");
  const timestampsPath = path.join(root, "tone-only-word-timestamps.json");
  runFfmpeg([
    "-y", "-v", "error",
    "-f", "lavfi",
    "-i", "sine=frequency=440:sample_rate=16000:duration=36",
    "-c:a", "aac",
    "-b:a", "48k",
    tonePath,
  ]);
  const toneHash = sha256(tonePath);
  const timestamps = await fs.readJson(candidate.slots.short_1.word_timestamps.path);
  timestamps.audio_sha256 = toneHash;
  await fs.writeJson(timestampsPath, timestamps, { spaces: 2 });
  Object.assign(candidate.slots.short_1.narration, {
    path: tonePath,
    sha256: toneHash,
    duration_seconds: 36,
    complete: true,
  });
  Object.assign(candidate.slots.short_1.word_timestamps, {
    path: timestampsPath,
    sha256: sha256(timestampsPath),
    complete: true,
  });

  const report = await evaluateFlagshipMediaPortfolio(candidate);

  assert.ok(report.slots.short_1.blockers.includes("narration_speech_evidence_missing"));
  assert.equal(report.slots.short_1.narration.decodable, true);
  assert.equal(report.slots.short_1.narration.speech_like, false);
  assert.equal(report.slots.short_1.word_timestamps.audio_hash_matches, true);
});

test("public evaluator derives material visual and source diversity from files, not family labels", async () => {
  const report = await evaluateFlagshipMediaPortfolio(legacyPortfolio);

  for (const slotId of FLAGSHIP_MEDIA_PORTFOLIO_SLOTS) {
    assert.ok(
      report.slots[slotId].blockers.includes("media_visual_diversity_insufficient"),
      slotId,
    );
    assert.equal(report.slots[slotId].media.visual_diversity.material, false, slotId);
  }
  assert.ok(report.blocker_codes.includes("short_visuals_not_materially_different"));
  assert.ok(report.blocker_codes.includes("short_sources_not_materially_different"));
  assert.equal(report.short_identity_diversity.materially_different, false);
});

test("short source diversity rejects reused verified asset bytes under different labels", async () => {
  const candidate = clone(portfolio);
  const firstLedger = await fs.readJson(candidate.slots.short_1.rights_lineage.path);
  const secondLedger = await fs.readJson(candidate.slots.short_2.rights_lineage.path);
  const reusedAssetPath = firstLedger.used_assets[0].local_path;
  const reusedAssetHash = sha256(reusedAssetPath);
  secondLedger.used_assets[0].local_path = reusedAssetPath;
  secondLedger.used_assets[0].asset_sha256 = reusedAssetHash;
  secondLedger.records[0].asset_sha256 = reusedAssetHash;
  const ledgerPath = path.join(candidate.slots.short_2.artifact_dir, "reused-source-rights.json");
  await fs.writeJson(ledgerPath, secondLedger, { spaces: 2 });
  candidate.slots.short_2.rights_lineage.path = ledgerPath;
  candidate.slots.short_2.rights_lineage.sha256 = sha256(ledgerPath);

  const report = await evaluateFlagshipMediaPortfolio(candidate);

  assert.equal(report.verdict, "RED");
  assert.ok(report.blocker_codes.includes("short_sources_not_materially_different"));
  assert.ok(report.slots.short_1.blockers.includes("source_asset_bytes_reused"));
  assert.ok(report.slots.short_2.blockers.includes("source_asset_bytes_reused"));
});

test("flagship portfolio accepts exactly three real portrait shorts and one real ten-minute landscape longform", () => {
  assert.deepEqual(FLAGSHIP_MEDIA_PORTFOLIO_SLOTS, ["short_1", "short_2", "short_3", "longform_1"]);
  assert.equal(greenReport.verdict, "GREEN", JSON.stringify({
    blockers: greenReport.blockers,
    longform_final_av: greenReport.slots.longform_1.final_av_review,
  }, null, 2));
  assert.equal(greenReport.contract_satisfied, true);
  assert.equal(greenReport.summary.required_slot_count, 4);
  assert.equal(greenReport.summary.verified_slot_count, 4);
  assert.equal(greenReport.summary.unique_story_count, 4);
  assert.equal(greenReport.summary.unique_media_hash_count, 4);
  assert.equal(greenReport.safety.publish_authorised, false);
  assert.equal(greenReport.safety.goal_contract_integrated, false);
  assert.equal(greenReport.slots.short_1.media.orientation, "portrait");
  assert.equal(greenReport.slots.short_1.media.video_codec, "h264");
  assert.equal(greenReport.slots.short_1.media.audio_codec, "aac");
  assert.equal(greenReport.slots.short_1.media.visual_diversity.material, true);
  assert.equal(greenReport.slots.short_1.narration.speech_like, true);
  assert.ok(greenReport.slots.short_1.word_timestamps.row_count >= 60);
  assert.ok(greenReport.slots.short_1.captions.cue_count >= 6);
  assert.equal(greenReport.slots.short_1.rights_lineage.recomputed_asset_hash_count, 1);
  assert.equal(greenReport.slots.short_1.rights_lineage.recomputed_evidence_hash_count, 1);
  assert.equal(greenReport.slots.short_1.final_av_review.strict_valid, true);
  assert.equal(greenReport.slots.longform_1.media.orientation, "landscape");
  assert.ok(greenReport.slots.longform_1.media.duration_seconds >= 600);
  assert.match(greenReport.slots.longform_1.media.sha256, /^[a-f0-9]{64}$/);
  assert.equal(greenReport.short_identity_diversity.unique_verified_source_material_count, 3);
  assert.equal(greenReport.short_identity_diversity.visual_materially_different, true);
});

test("flagship portfolio rejects missing, unexpected and duplicate-story slots", async () => {
  const candidate = clone(portfolio);
  candidate.slots.short_2.story_id = candidate.slots.short_1.story_id;
  delete candidate.slots.short_3;
  candidate.slots.bonus_short = clone(candidate.slots.short_1);

  const report = await evaluateFlagshipMediaPortfolio(candidate);

  assert.equal(report.verdict, "RED");
  assert.ok(report.blocker_codes.includes("required_slot_missing"));
  assert.ok(report.blocker_codes.includes("unexpected_slot"));
  assert.ok(report.blocker_codes.includes("story_id_not_unique"));
});

test("flagship portfolio rejects duplicate media bytes even when paths and slot manifests differ", async () => {
  const candidate = clone(portfolio);
  const copiedMediaPath = path.join(root, "short_2", "different-path-same-bytes.mp4");
  await fs.copy(candidate.slots.short_1.media.path, copiedMediaPath);
  candidate.slots.short_2.media.path = copiedMediaPath;
  candidate.slots.short_2.media.sha256 = candidate.slots.short_1.media.sha256;

  const report = await evaluateFlagshipMediaPortfolio(candidate);

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.unique_media_hash_count, 3);
  assert.ok(report.blocker_codes.includes("media_sha256_not_unique"));
});

test("manifest and path-only MP4 claims fail when bytes cannot be probed and decoded", async () => {
  const candidate = clone(portfolio);
  const fakePath = path.join(root, "short_1", "claimed-final.mp4");
  await fs.writeFile(fakePath, "manifest-complete but not media", "utf8");
  const fakeHash = sha256(fakePath);
  Object.assign(candidate.slots.short_1.media, {
    path: fakePath,
    sha256: fakeHash,
    container: "mp4",
    duration_seconds: 59,
    width: 1080,
    height: 1920,
    video_codec: "h264",
    audio_codec: "aac",
    decodable: true,
  });
  const report = await evaluateFlagshipMediaPortfolio(candidate);

  assert.equal(report.verdict, "RED");
  assert.ok(report.slots.short_1.blockers.includes("media_not_decodable"));
  assert.equal(report.slots.short_1.media.decodable, false);
});

test("measured geometry, longform runtime and declared codec evidence fail closed", async () => {
  const wrongPortrait = clone(portfolio);
  wrongPortrait.slots.short_1.media.path = portfolio.slots.longform_1.media.path;
  wrongPortrait.slots.short_1.media.sha256 = portfolio.slots.longform_1.media.sha256;
  const portraitReport = await evaluateFlagshipMediaPortfolio(wrongPortrait);
  assert.ok(portraitReport.slots.short_1.blockers.includes("short_media_not_portrait"));
  assert.ok(portraitReport.slots.short_1.blockers.includes("short_duration_above_production_maximum"));

  const shortLongform = clone(portfolio);
  shortLongform.slots.longform_1.media.path = portfolio.slots.short_1.media.path;
  shortLongform.slots.longform_1.media.sha256 = portfolio.slots.short_1.media.sha256;
  const longformReport = await evaluateFlagshipMediaPortfolio(shortLongform);
  assert.ok(longformReport.slots.longform_1.blockers.includes("longform_media_not_landscape"));
  assert.ok(longformReport.slots.longform_1.blockers.includes("longform_duration_below_600_seconds"));

  const staleCodec = clone(portfolio);
  staleCodec.slots.short_1.media.video_codec = "vp9";
  const codecReport = await evaluateFlagshipMediaPortfolio(staleCodec);
  assert.ok(codecReport.slots.short_1.blockers.includes("declared_video_codec_mismatch"));
});

test("narration, timestamps, captions and rights lineage must be complete file-backed hash evidence", async () => {
  const candidate = clone(portfolio);
  candidate.slots.short_1.narration.complete = false;
  candidate.slots.short_2.word_timestamps.path = path.join(root, "invalid-word-timestamps.json");
  await fs.writeJson(candidate.slots.short_2.word_timestamps.path, { complete: true, words: [] });
  candidate.slots.short_2.word_timestamps.sha256 = sha256(candidate.slots.short_2.word_timestamps.path);
  candidate.slots.short_3.captions.path = path.join(root, "invalid-captions.srt");
  await fs.writeFile(candidate.slots.short_3.captions.path, "captions claimed complete", "utf8");
  candidate.slots.short_3.captions.sha256 = sha256(candidate.slots.short_3.captions.path);
  candidate.slots.longform_1.rights_lineage.path = path.join(root, "invalid-rights-lineage.json");
  await fs.writeJson(candidate.slots.longform_1.rights_lineage.path, { complete: true, used_assets: [], records: [] });
  candidate.slots.longform_1.rights_lineage.sha256 = sha256(candidate.slots.longform_1.rights_lineage.path);

  const report = await evaluateFlagshipMediaPortfolio(candidate);

  assert.ok(report.slots.short_1.blockers.includes("narration_not_complete"));
  assert.ok(report.slots.short_2.blockers.includes("word_timestamps_content_incomplete"));
  assert.ok(report.slots.short_3.blockers.includes("captions_content_incomplete"));
  assert.ok(report.slots.longform_1.blockers.includes("rights_lineage_content_incomplete"));
});

test("strict final AV review must bind current decoded media and reviewed artefacts", async () => {
  const candidate = clone(portfolio);
  candidate.slots.short_1.final_av_review.verdict = "AMBER";
  candidate.slots.short_2.final_av_review.reviewed_artefact_fingerprints.final_mp4 = "0".repeat(64);
  delete candidate.slots.short_3.final_av_review.reviewed_artefact_fingerprints.contact_sheet;

  const report = await evaluateFlagshipMediaPortfolio(candidate);

  assert.ok(report.slots.short_1.blockers.includes("final_av_review_verdict_not_green"));
  assert.ok(
    report.slots.short_2.blockers.includes("reviewed_artefact_fingerprint_mismatch:final_mp4"),
  );
  assert.ok(
    report.slots.short_3.blockers.includes("final_av_review_fingerprint_invalid:contact_sheet"),
  );
});

test("shorts require materially different source and motion families", async () => {
  const candidate = clone(portfolio);
  candidate.slots.short_2.source_identity.family = "Official Press Release - crop 2";
  candidate.slots.short_2.motion_identity.family = "Owned Gameplay Capture variant 02";

  const report = await evaluateFlagshipMediaPortfolio(candidate);

  assert.equal(report.verdict, "RED");
  assert.ok(report.blocker_codes.includes("short_source_identities_not_materially_different"));
  assert.ok(report.blocker_codes.includes("short_motion_identities_not_materially_different"));
});

test("writer emits local-only JSON and Markdown from a fresh evaluation", async () => {
  const outputDir = path.join(root, "writer-output");
  await assert.rejects(
    writeFlagshipMediaPortfolioReport(portfolio, { outputDir }),
    /requires an evaluated flagship media portfolio report/,
  );

  const written = await evaluateAndWriteFlagshipMediaPortfolio(portfolio, {
    outputDir,
    generatedAt: "2026-07-15T12:00:00.000Z",
  });

  assert.equal(await fs.pathExists(written.jsonPath), true);
  assert.equal(await fs.pathExists(written.markdownPath), true);
  const json = await fs.readJson(written.jsonPath);
  const markdown = await fs.readFile(written.markdownPath, "utf8");
  assert.equal(json.verdict, "GREEN");
  assert.equal(json.safety.publish_authorised, false);
  assert.match(markdown, /Flagship Media Portfolio Contract/);
  assert.match(markdown, /longform_1.*GREEN/);
  assert.doesNotMatch(markdown, /publish authorised:\s*yes/i);
});
