"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  REQUIRED_EVIDENCE_CHECKS,
  buildLongformFlagshipRepairPlan,
  defaultProbeMedia,
  renderLongformFlagshipRepairPlanMarkdown,
  writeLongformFlagshipRepairPlan,
} = require("../../lib/longform-flagship-repair-plan");
const {
  main: runRepairPlanCli,
  parseArgs: parseRepairPlanArgs,
} = require("../../tools/longform-flagship-repair-plan");

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function srtTimestamp(seconds) {
  const milliseconds = Math.round(Number(seconds) * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

test("the default probe accepts a decodable narration-only file", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "longform-flagship-probe-"));
  t.after(() => fs.remove(root));
  const audioPath = path.join(root, "narration.mp3");
  execFileSync(process.env.FFMPEG_PATH || "ffmpeg", [
    "-y",
    "-v", "error",
    "-f", "lavfi",
    "-i", "sine=frequency=440:sample_rate=44100:duration=1",
    audioPath,
  ], { windowsHide: true, timeout: 30_000 });

  const probe = defaultProbeMedia(audioPath);
  assert.equal(probe.decodable, true);
  assert.equal(probe.video, null);
  assert.equal(probe.audio.codec, "mp3");
  assert.ok(probe.duration_seconds > 0.9);
});

test("a longform candidate without production evidence is blocked in every required lane", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "longform-flagship-repair-"));
  t.after(() => fs.remove(root));

  const candidatePackagePath = path.join(root, "pulse_release_radar_package.json");
  const finalMp4Path = path.join(root, "pulse_release_radar_longform.mp4");
  await fs.writeJson(candidatePackagePath, {
    schema_version: 1,
    generated_at: "2020-07-15T10:00:00.000Z",
    package_id: "pulse_release_radar_august_2026",
    format: "monthly_release_radar",
    longform: {
      title: "Release Radar",
      script: "A real longform script.",
      transcript_qa: { verdict: "pass", word_count: 1600, blockers: [] },
    },
  });
  await fs.writeFile(finalMp4Path, "real-media-placeholder");

  const report = await buildLongformFlagshipRepairPlan({
    candidatePackagePath,
    finalMp4Path,
    generatedAt: "2026-07-15T12:00:00.000Z",
    probeMedia: async () => ({
      decodable: true,
      duration_seconds: 601,
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      video: { codec: "h264", width: 1920, height: 1080 },
      audio: { codec: "aac" },
    }),
  });

  assert.equal(report.status, "BLOCKED");
  assert.notEqual(report.verdict, "GREEN");
  assert.equal(report.publish_authorised, false);
  assert.deepEqual(Object.keys(report.checks), REQUIRED_EVIDENCE_CHECKS);
  assert.deepEqual(
    report.blocker_codes,
    [
      "same_run_transcript_binding_missing",
      "final_narration_manifest_missing",
      "word_timestamps_missing",
      "captions_missing",
      "rights_lineage_missing",
      "platform_variants_manifest_missing",
      "decoded_qa_report_missing",
      "human_av_review_missing",
    ],
  );
  assert.equal(report.final_mp4.duration_seconds, 601);
  assert.equal(report.final_mp4.meets_minimum_duration, true);
  assert.equal(report.safety.no_publish, true);
  assert.equal(report.safety.production_db_mutated, false);
  assert.equal(report.safety.oauth_or_token_mutated, false);
  assert.equal(report.safety.human_signoff_generated, false);
});

test("the final MP4 must be a decoded >=600s H.264/AAC landscape master", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "longform-flagship-master-"));
  t.after(() => fs.remove(root));
  const candidatePackagePath = path.join(root, "candidate.json");
  const finalMp4Path = path.join(root, "final.mp4");
  await fs.writeJson(candidatePackagePath, {
    package_id: "release_radar",
    format: "monthly_release_radar",
    longform: { title: "Release Radar", script: "script" },
  });
  await fs.writeFile(finalMp4Path, "media");

  const report = await buildLongformFlagshipRepairPlan({
    candidatePackagePath,
    finalMp4Path,
    probeMedia: async () => ({
      decodable: false,
      duration_seconds: 599.9,
      format_name: "matroska",
      video: { codec: "vp9", width: 1080, height: 1920 },
      audio: { codec: "opus" },
    }),
  });

  assert.deepEqual(report.final_mp4.blockers, [
    "final_mp4_not_decodable",
    "final_mp4_container_not_mp4",
    "final_mp4_duration_below_600_seconds",
    "final_mp4_not_landscape",
    "final_mp4_video_codec_not_h264",
    "final_mp4_audio_codec_not_aac",
  ]);
  assert.deepEqual(report.blocker_codes.slice(0, 6), report.final_mp4.blockers);
  assert.equal(report.final_mp4.meets_flagship_contract, false);
  assert.equal(report.status, "BLOCKED");
});

test("same-run transcript proof is invalidated when the candidate package changes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "longform-flagship-run-"));
  t.after(() => fs.remove(root));
  const candidatePackagePath = path.join(root, "candidate.json");
  const transcriptPath = path.join(root, "longform_script.md");
  const finalMp4Path = path.join(root, "final.mp4");
  const runManifestPath = path.join(root, "longform_run_manifest.json");
  const script = "This transcript belongs to the rendered longform run.";
  await fs.writeJson(candidatePackagePath, {
    package_id: "release_radar",
    format: "monthly_release_radar",
    production_run_id: "run-20260715-a",
    longform: { title: "Release Radar", script },
  });
  await fs.writeFile(transcriptPath, `${script}\n`);
  await fs.writeFile(finalMp4Path, "media-for-run-a");
  await fs.writeJson(runManifestPath, {
    schema_version: 1,
    complete: true,
    run_id: "run-20260715-a",
    candidate_package: {
      path: candidatePackagePath,
      sha256: sha256(candidatePackagePath),
    },
    transcript: {
      path: transcriptPath,
      sha256: sha256(transcriptPath),
      text_sha256: crypto.createHash("sha256").update(script).digest("hex"),
    },
    final_mp4: {
      path: finalMp4Path,
      sha256: sha256(finalMp4Path),
    },
  });
  const options = {
    candidatePackagePath,
    finalMp4Path,
    probeMedia: async () => ({
      decodable: true,
      duration_seconds: 620,
      format_name: "mp4",
      video: { codec: "h264", width: 1920, height: 1080 },
      audio: { codec: "aac" },
    }),
  };

  const bound = await buildLongformFlagshipRepairPlan(options);
  assert.equal(bound.checks.same_run_transcript.status, "PASS");
  assert.deepEqual(bound.checks.same_run_transcript.blockers, []);

  const changed = await fs.readJson(candidatePackagePath);
  changed.longform.script = `${script} A later package edit.`;
  await fs.writeJson(candidatePackagePath, changed);
  const stale = await buildLongformFlagshipRepairPlan(options);
  assert.equal(stale.checks.same_run_transcript.status, "BLOCKED");
  assert.ok(stale.checks.same_run_transcript.blockers.includes(
    "same_run_candidate_package_sha256_mismatch",
  ));
  assert.ok(stale.checks.same_run_transcript.blockers.includes(
    "same_run_transcript_text_sha256_mismatch",
  ));
});

test("missing run binding still reports observed package, compilation and story-set drift", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "longform-flagship-drift-"));
  t.after(() => fs.remove(root));
  const candidatePackagePath = path.join(root, "candidate.json");
  const finalMp4Path = path.join(root, "final.mp4");
  const audioPath = path.join(root, "narration.mp3");
  await fs.writeFile(finalMp4Path, "older-media");
  await fs.utimes(finalMp4Path, new Date("2026-07-14T10:00:00.000Z"), new Date("2026-07-14T10:00:00.000Z"));
  await fs.writeFile(audioPath, "older-audio");
  await fs.writeJson(candidatePackagePath, {
    generated_at: "2026-07-15T10:00:00.000Z",
    package_id: "release_radar",
    format: "monthly_release_radar",
    longform: {
      title: "Release Radar",
      script: "new package transcript",
      segments: [{ id: "new-game", canonical_game: "New Game" }],
    },
  });
  await fs.writeJson(path.join(root, "longform_compilation.json"), {
    fullScript: "old rendered transcript",
    outputPath: finalMp4Path,
  });
  await fs.writeJson(path.join(root, "longform_evidence.json"), {
    sourcePack: [{ story_id: "old-game", title: "Old Game" }],
  });
  await fs.writeJson(path.join(root, "pulse_release_radar_audio_manifest.json"), {
    generated_at: "2026-07-14T09:00:00.000Z",
    audio_path: audioPath,
    protected_titles: ["Old Game"],
  });

  const report = await buildLongformFlagshipRepairPlan({
    candidatePackagePath,
    finalMp4Path,
    probeMedia: async () => ({
      decodable: true,
      duration_seconds: 620,
      format_name: "mp4",
      video: { codec: "h264", width: 1920, height: 1080 },
      audio: { codec: "aac" },
    }),
    probeAudio: async () => ({
      decodable: true,
      duration_seconds: 620,
      audio: { codec: "mp3" },
    }),
  });

  assert.deepEqual(report.checks.same_run_transcript.blockers, [
    "same_run_transcript_binding_missing",
    "same_run_candidate_newer_than_final_mp4",
    "same_run_compilation_transcript_mismatch",
    "same_run_story_set_mismatch",
  ]);
  assert.ok(report.checks.final_narration.blockers.includes("final_narration_predates_candidate_package"));
  assert.ok(report.checks.final_narration.blockers.includes(
    "final_narration_candidate_subject_set_mismatch",
  ));
});

test("legacy narration paths and character alignment do not count as final word evidence", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "longform-flagship-audio-"));
  t.after(() => fs.remove(root));
  const candidatePackagePath = path.join(root, "candidate.json");
  const finalMp4Path = path.join(root, "final.mp4");
  const audioPath = path.join(root, "pulse_release_radar.mp3");
  const timestampsPath = path.join(root, "pulse_release_radar_timestamps.json");
  await fs.writeJson(candidatePackagePath, {
    package_id: "release_radar",
    format: "monthly_release_radar",
    longform: { title: "Release Radar", script: "The package transcript." },
  });
  await fs.writeFile(finalMp4Path, "media");
  await fs.writeFile(audioPath, "narration");
  await fs.writeJson(timestampsPath, {
    characters: ["T", "h", "e"],
    character_start_times_seconds: [0, 0.1, 0.2],
    character_end_times_seconds: [0.1, 0.2, 620],
  });
  await fs.writeJson(path.join(root, "pulse_release_radar_audio_manifest.json"), {
    schema_version: 1,
    spoken_text_sha256: crypto.createHash("sha256").update("The package transcript.").digest("hex"),
    generated_at: "2026-07-15T10:00:00.000Z",
    audio_path: audioPath,
    timestamps_path: timestampsPath,
  });

  const report = await buildLongformFlagshipRepairPlan({
    candidatePackagePath,
    finalMp4Path,
    probeMedia: async () => ({
      decodable: true,
      duration_seconds: 620,
      format_name: "mp4",
      video: { codec: "h264", width: 1920, height: 1080 },
      audio: { codec: "aac" },
    }),
    probeAudio: async () => ({
      decodable: true,
      duration_seconds: 620,
      audio: { codec: "mp3" },
    }),
  });

  assert.deepEqual(report.checks.final_narration.blockers, [
    "final_narration_complete_flag_missing",
    "final_narration_run_id_missing",
    "final_narration_audio_sha256_missing",
    "final_narration_duration_missing_or_invalid",
    "final_narration_transcript_sha256_missing",
    "final_narration_final_mp4_sha256_missing",
  ]);
  assert.equal(report.checks.final_narration.evidence.audio_exists, true);
  assert.equal(report.checks.word_timestamps.evidence_path, timestampsPath);
  assert.deepEqual(report.checks.word_timestamps.blockers, [
    "word_timestamps_complete_flag_missing",
    "word_timestamps_run_id_missing",
    "word_timestamps_sha256_missing",
    "word_timestamps_audio_sha256_missing",
    "word_timestamps_not_word_level",
    "word_timestamps_nontrivial_coverage_missing",
  ]);
});

test("captions require a hash-bound manifest and nontrivial <=8s cues", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "longform-flagship-captions-"));
  t.after(() => fs.remove(root));
  const candidatePackagePath = path.join(root, "candidate.json");
  const finalMp4Path = path.join(root, "final.mp4");
  const captionsPath = path.join(root, "captions.srt");
  await fs.writeJson(candidatePackagePath, {
    package_id: "release_radar",
    format: "monthly_release_radar",
    production_run_id: "run-captions",
    longform: { title: "Release Radar", script: "script" },
  });
  await fs.writeFile(finalMp4Path, "media");
  await fs.writeFile(
    captionsPath,
    "1\n00:00:00,000 --> 00:10:20,000\nOne giant caption is not production evidence.\n",
  );
  await fs.writeJson(path.join(root, "caption_manifest.json"), {
    schema_version: 1,
    captions_path: captionsPath,
  });

  const report = await buildLongformFlagshipRepairPlan({
    candidatePackagePath,
    finalMp4Path,
    probeMedia: async () => ({
      decodable: true,
      duration_seconds: 620,
      format_name: "mp4",
      video: { codec: "h264", width: 1920, height: 1080 },
      audio: { codec: "aac" },
    }),
  });

  assert.deepEqual(report.checks.captions.blockers, [
    "captions_complete_flag_missing",
    "captions_run_id_missing",
    "captions_sha256_missing",
    "captions_audio_sha256_missing",
    "captions_word_timestamps_sha256_missing",
    "captions_final_mp4_sha256_missing",
    "captions_cue_duration_exceeds_8_seconds",
    "captions_nontrivial_coverage_missing",
    "captions_final_narration_not_verified",
    "captions_word_timestamps_not_verified",
  ]);
  assert.equal(report.checks.captions.evidence.cue_count, 1);
  assert.equal(report.checks.captions.status, "BLOCKED");
});

test("rights lineage rejects the final MP4 as its own source and licence evidence", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "longform-flagship-rights-"));
  t.after(() => fs.remove(root));
  const candidatePackagePath = path.join(root, "candidate.json");
  const finalMp4Path = path.join(root, "final.mp4");
  await fs.writeJson(candidatePackagePath, {
    package_id: "release_radar",
    format: "monthly_release_radar",
    production_run_id: "run-rights",
    longform: { title: "Release Radar", script: "script" },
  });
  await fs.writeFile(finalMp4Path, "media-used-as-fake-rights-proof");
  const mediaHash = sha256(finalMp4Path);
  await fs.writeJson(path.join(root, "rights_lineage.json"), {
    schema_version: 1,
    complete: true,
    run_id: "run-rights",
    final_mp4_sha256: mediaHash,
    used_assets: [{
      asset_id: "fake-source",
      path: finalMp4Path,
      sha256: mediaHash,
    }],
    records: [{
      asset_id: "fake-source",
      source_url: "https://example.test/official-source",
      rights_basis: "owned",
      commercial_use_allowed: true,
      asset_sha256: mediaHash,
      rights_evidence_path: finalMp4Path,
      rights_evidence_sha256: mediaHash,
    }],
  });

  const report = await buildLongformFlagshipRepairPlan({
    candidatePackagePath,
    finalMp4Path,
    probeMedia: async () => ({
      decodable: true,
      duration_seconds: 620,
      format_name: "mp4",
      video: { codec: "h264", width: 1920, height: 1080 },
      audio: { codec: "aac" },
    }),
  });

  assert.deepEqual(report.checks.rights_lineage.blockers, [
    "rights_asset_is_final_mp4",
    "rights_evidence_not_independent",
  ]);
  assert.equal(report.checks.rights_lineage.evidence.verified_asset_count, 0);
  assert.equal(report.checks.rights_lineage.status, "BLOCKED");
});

test("platform variants are blocked when they were rendered from a different final master", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "longform-flagship-variants-"));
  t.after(() => fs.remove(root));
  const candidatePackagePath = path.join(root, "candidate.json");
  const finalMp4Path = path.join(root, "final.mp4");
  const variantPath = path.join(root, "youtube_longform.mp4");
  await fs.writeJson(candidatePackagePath, {
    package_id: "release_radar",
    format: "monthly_release_radar",
    production_run_id: "run-variants",
    longform: { title: "Release Radar", script: "script" },
  });
  await fs.writeFile(finalMp4Path, "current-master");
  await fs.writeFile(variantPath, "youtube-platform-variant");
  const staleSourceHash = "a".repeat(64);
  await fs.writeJson(path.join(root, "platform_variants.json"), {
    schema_version: 1,
    complete: true,
    run_id: "run-variants",
    source_final_mp4_sha256: staleSourceHash,
    required_platforms: ["youtube_longform"],
    variants: [{
      platform: "youtube_longform",
      status: "ready",
      path: variantPath,
      sha256: sha256(variantPath),
      source_final_mp4_sha256: staleSourceHash,
      duration_seconds: 620,
      width: 1920,
      height: 1080,
      video_codec: "h264",
      audio_codec: "aac",
      decodable: true,
    }],
  });

  const report = await buildLongformFlagshipRepairPlan({
    candidatePackagePath,
    finalMp4Path,
    probeMedia: async () => ({
      decodable: true,
      duration_seconds: 620,
      format_name: "mp4",
      video: { codec: "h264", width: 1920, height: 1080 },
      audio: { codec: "aac" },
    }),
  });

  assert.deepEqual(report.checks.platform_variants.blockers, [
    "platform_variants_source_mp4_sha256_mismatch",
    "platform_variant_source_mp4_sha256_mismatch:youtube_longform",
  ]);
  assert.equal(report.checks.platform_variants.evidence.verified_variant_count, 0);
  assert.equal(report.checks.platform_variants.status, "BLOCKED");
});

test("legacy forensic summaries expose defects but do not count as decoded QA", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "longform-flagship-decoded-"));
  t.after(() => fs.remove(root));
  const reviewDir = path.join(root, "review");
  const candidatePackagePath = path.join(root, "candidate.json");
  const finalMp4Path = path.join(root, "final.mp4");
  await fs.writeJson(candidatePackagePath, {
    package_id: "release_radar",
    format: "monthly_release_radar",
    production_run_id: "run-decoded",
    longform: { title: "Release Radar", script: "script" },
  });
  await fs.writeFile(finalMp4Path, "media");
  await fs.ensureDir(reviewDir);
  const legacyForensicPath = path.join(reviewDir, "forensic_summary.json");
  await fs.writeJson(legacyForensicPath, {
    black_events: 1,
    freeze_events: 0,
    silence_events: 0,
  });

  const report = await buildLongformFlagshipRepairPlan({
    candidatePackagePath,
    finalMp4Path,
    probeMedia: async () => ({
      decodable: true,
      duration_seconds: 620,
      format_name: "mp4",
      video: { codec: "h264", width: 1920, height: 1080 },
      audio: { codec: "aac" },
    }),
  });

  assert.equal(report.checks.decoded_qa.evidence_path, legacyForensicPath);
  assert.ok(report.checks.decoded_qa.blockers.includes("decoded_qa_schema_version_invalid"));
  assert.ok(report.checks.decoded_qa.blockers.includes("decoded_qa_full_decode_missing"));
  assert.ok(report.checks.decoded_qa.blockers.includes("decoded_qa_required_check_missing:black"));
  assert.ok(report.checks.decoded_qa.blockers.includes("decoded_qa_sampled_frames_missing"));
  assert.ok(report.checks.decoded_qa.blockers.includes("decoded_qa_black_events_present"));
  assert.equal(report.checks.decoded_qa.evidence.reported_black_events, 1);
  assert.equal(report.checks.decoded_qa.status, "BLOCKED");
});

test("an automated reviewer cannot satisfy the human AV review gate", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "longform-flagship-human-"));
  t.after(() => fs.remove(root));
  const candidatePackagePath = path.join(root, "candidate.json");
  const finalMp4Path = path.join(root, "final.mp4");
  const contactSheetPath = path.join(root, "contact_sheet.jpg");
  await fs.writeJson(candidatePackagePath, {
    package_id: "release_radar",
    format: "monthly_release_radar",
    production_run_id: "run-human",
    longform: { title: "Release Radar", script: "script" },
  });
  await fs.writeFile(finalMp4Path, "media");
  await fs.writeFile(contactSheetPath, "contact-sheet-evidence");
  await fs.writeJson(path.join(root, "final_av_review.json"), {
    schema_version: 1,
    complete: true,
    run_id: "run-human",
    reviewed_at: "2026-07-15T12:00:00.000Z",
    reviewer: {
      id: "codex-automated-reviewer",
      human: false,
      independent: false,
      registry_verified: false,
    },
    verdict: "GREEN",
    reviewed_artifacts: {
      final_mp4_sha256: sha256(finalMp4Path),
      decoded_qa_sha256: "a".repeat(64),
      contact_sheet_path: contactSheetPath,
      contact_sheet_sha256: sha256(contactSheetPath),
    },
    attestations: {
      full_watch: true,
      full_listen: true,
      av_sync: true,
      caption_readability: true,
      subject_match: true,
    },
    defects: [],
  });

  const report = await buildLongformFlagshipRepairPlan({
    candidatePackagePath,
    finalMp4Path,
    probeMedia: async () => ({
      decodable: true,
      duration_seconds: 620,
      format_name: "mp4",
      video: { codec: "h264", width: 1920, height: 1080 },
      audio: { codec: "aac" },
    }),
  });

  assert.ok(report.checks.human_av_review.blockers.includes("human_av_review_reviewer_not_human"));
  assert.ok(report.checks.human_av_review.blockers.includes("human_av_review_reviewer_not_independent"));
  assert.ok(report.checks.human_av_review.blockers.includes("human_av_review_reviewer_not_registry_verified"));
  assert.ok(report.checks.human_av_review.blockers.includes("human_av_review_decoded_qa_not_verified"));
  assert.equal(report.checks.human_av_review.evidence.reviewer_id, "codex-automated-reviewer");
  assert.equal(report.safety.human_signoff_generated, false);
  assert.equal(report.checks.human_av_review.status, "BLOCKED");
});

test("complete evidence clears machine blockers without producing a GREEN or publish claim", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "longform-flagship-complete-"));
  t.after(() => fs.remove(root));
  const runId = "run-complete";
  const candidatePackagePath = path.join(root, "candidate.json");
  const transcriptPath = path.join(root, "longform_script.md");
  const finalMp4Path = path.join(root, "final.mp4");
  const audioPath = path.join(root, "narration.mp3");
  const timestampsPath = path.join(root, "word_timestamps.json");
  const captionsPath = path.join(root, "captions.srt");
  const sourceAssetPath = path.join(root, "source.mp4");
  const rightsEvidencePath = path.join(root, "source-licence.txt");
  const variantPath = path.join(root, "youtube_longform.mp4");
  const decodedQaPath = path.join(root, "decoded_qa_report.json");
  const contactSheetPath = path.join(root, "contact_sheet.jpg");
  const words = Array.from({ length: 601 }, (_, index) => `word${index % 67}`);
  const script = words.join(" ");

  await fs.writeJson(candidatePackagePath, {
    package_id: "release_radar",
    format: "monthly_release_radar",
    production_run_id: runId,
    longform: { title: "Release Radar", script },
  });
  await fs.writeFile(transcriptPath, `${script}\n`);
  await fs.writeFile(finalMp4Path, "current-final-master");
  await fs.writeFile(audioPath, "current-final-narration");
  await fs.writeJson(timestampsPath, {
    schema_version: 1,
    complete: true,
    run_id: runId,
    audio_sha256: sha256(audioPath),
    words: words.map((word, index) => ({ word, start: index, end: index + 0.6 })),
  });
  const cues = [];
  for (let index = 0; index < words.length; index += 6) {
    const cueWords = words.slice(index, index + 6);
    cues.push([
      String(cues.length + 1),
      `${srtTimestamp(index)} --> ${srtTimestamp(Math.min(601, index + 5.6))}`,
      cueWords.join(" "),
    ].join("\n"));
  }
  await fs.writeFile(captionsPath, `${cues.join("\n\n")}\n`);
  await fs.writeFile(sourceAssetPath, "licensed-source-asset");
  await fs.writeFile(rightsEvidencePath, "independent licence evidence");
  await fs.writeFile(variantPath, "youtube-variant");
  await fs.writeFile(contactSheetPath, "contact-sheet");
  const finalHash = sha256(finalMp4Path);

  await fs.writeJson(path.join(root, "longform_run_manifest.json"), {
    schema_version: 1,
    complete: true,
    run_id: runId,
    candidate_package: { path: candidatePackagePath, sha256: sha256(candidatePackagePath) },
    transcript: {
      path: transcriptPath,
      sha256: sha256(transcriptPath),
      text_sha256: crypto.createHash("sha256").update(script).digest("hex"),
    },
    final_mp4: { path: finalMp4Path, sha256: finalHash },
  });
  await fs.writeJson(path.join(root, "pulse_release_radar_audio_manifest.json"), {
    schema_version: 1,
    complete: true,
    run_id: runId,
    audio_path: audioPath,
    audio_sha256: sha256(audioPath),
    duration_seconds: 601,
    transcript_sha256: sha256(transcriptPath),
    spoken_text_sha256: crypto.createHash("sha256").update(script).digest("hex"),
    final_mp4_sha256: finalHash,
    timestamps_path: timestampsPath,
    timestamps_sha256: sha256(timestampsPath),
  });
  await fs.writeJson(path.join(root, "caption_manifest.json"), {
    schema_version: 1,
    complete: true,
    run_id: runId,
    captions_path: captionsPath,
    captions_sha256: sha256(captionsPath),
    audio_sha256: sha256(audioPath),
    word_timestamps_sha256: sha256(timestampsPath),
    final_mp4_sha256: finalHash,
  });
  await fs.writeJson(path.join(root, "rights_lineage.json"), {
    schema_version: 1,
    complete: true,
    run_id: runId,
    final_mp4_sha256: finalHash,
    used_assets: [{ asset_id: "source-1", path: sourceAssetPath, sha256: sha256(sourceAssetPath) }],
    records: [{
      asset_id: "source-1",
      source_url: "https://example.test/official",
      rights_basis: "licensed commercial use",
      commercial_use_allowed: true,
      asset_sha256: sha256(sourceAssetPath),
      rights_evidence_path: rightsEvidencePath,
      rights_evidence_sha256: sha256(rightsEvidencePath),
    }],
  });
  await fs.writeJson(path.join(root, "platform_variants.json"), {
    schema_version: 1,
    complete: true,
    run_id: runId,
    source_final_mp4_sha256: finalHash,
    required_platforms: ["youtube_longform"],
    variants: [{
      platform: "youtube_longform",
      status: "ready",
      path: variantPath,
      sha256: sha256(variantPath),
      source_final_mp4_sha256: finalHash,
      duration_seconds: 601,
      width: 1920,
      height: 1080,
      video_codec: "h264",
      audio_codec: "aac",
      decodable: true,
    }],
  });
  await fs.writeJson(decodedQaPath, {
    schema_version: 1,
    complete: true,
    run_id: runId,
    verdict: "pass",
    final_media: { sha256: finalHash, size_bytes: (await fs.stat(finalMp4Path)).size },
    decode: {
      fully_decoded: true,
      audio_checked: true,
      video_checked: true,
      errors: [],
      decoded_duration_seconds: 601,
    },
    checks: Object.fromEntries(
      ["audio", "video", "captions", "av_sync", "freeze", "black", "blur", "repetition"]
        .map((id) => [id, { checked: true, verdict: "pass", event_count: 0 }]),
    ),
    sampled_frames: [0, 199, 398, 597].map((time, index) => ({
      time_seconds: time,
      hash: String(index + 1).repeat(64),
    })),
    critical_defects: [],
  });
  await fs.writeJson(path.join(root, "final_av_review.json"), {
    schema_version: 1,
    complete: true,
    run_id: runId,
    reviewed_at: "2026-07-15T12:00:00.000Z",
    reviewer: {
      id: "registered-human-reviewer-17",
      human: true,
      independent: true,
      registry_verified: true,
    },
    verdict: "GREEN",
    reviewed_artifacts: {
      final_mp4_sha256: finalHash,
      decoded_qa_sha256: sha256(decodedQaPath),
      contact_sheet_path: contactSheetPath,
      contact_sheet_sha256: sha256(contactSheetPath),
    },
    attestations: {
      full_watch: true,
      full_listen: true,
      av_sync: true,
      caption_readability: true,
      subject_match: true,
    },
    defects: [],
  });

  const report = await buildLongformFlagshipRepairPlan({
    candidatePackagePath,
    finalMp4Path,
    probeMedia: async () => ({
      decodable: true,
      duration_seconds: 601,
      format_name: "mp4",
      video: { codec: "h264", width: 1920, height: 1080 },
      audio: { codec: "aac" },
    }),
    probeAudio: async () => ({
      decodable: true,
      duration_seconds: 601,
      audio: { codec: "mp3" },
    }),
  });

  assert.deepEqual(report.blocker_codes, []);
  assert.ok(Object.values(report.checks).every((check) => check.status === "PASS"));
  assert.equal(report.status, "EVIDENCE_COMPLETE_AWAITING_EXTERNAL_GATE");
  assert.equal(report.verdict, "NOT_GREEN_EVIDENCE_COMPLETE");
  assert.equal(report.publish_authorised, false);
  assert.equal(report.green_claimed, false);
  assert.doesNotMatch(JSON.stringify(report), /"GREEN"/);
});

test("repair actions use a disjoint staging run and expose materialiser gaps", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "longform-flagship-actions-"));
  t.after(() => fs.remove(root));
  const currentDir = path.join(root, "current");
  await fs.ensureDir(currentDir);
  const candidatePackagePath = path.join(currentDir, "candidate.json");
  const finalMp4Path = path.join(currentDir, "final.mp4");
  const repairRoot = path.join(root, "repair-staging");
  const sourceInputPath = path.join(root, "release_radar_candidates.json");
  await fs.writeJson(candidatePackagePath, {
    package_id: "release_radar_august_2026",
    format: "monthly_release_radar",
    month_label: "August 2026",
    longform: { title: "Release Radar", script: "script" },
  });
  await fs.writeJson(sourceInputPath, { candidates: [] });
  await fs.writeFile(finalMp4Path, "media");

  const report = await buildLongformFlagshipRepairPlan({
    candidatePackagePath,
    finalMp4Path,
    repairRoot,
    sourceInputPath,
    generatedAt: "2026-07-15T12:34:56.000Z",
    probeMedia: async () => ({
      decodable: true,
      duration_seconds: 620,
      format_name: "mp4",
      video: { codec: "h264", width: 1920, height: 1080 },
      audio: { codec: "aac" },
    }),
  });

  assert.equal(report.repair_workspace, path.resolve(repairRoot));
  assert.match(report.safe_commands.render_same_run_master.command, /--render-longform/);
  assert.match(report.safe_commands.render_same_run_master.command, new RegExp(
    repairRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ));
  assert.equal(report.safe_commands.render_same_run_master.expected_paths.includes(
    path.join(repairRoot, "pulse_release_radar_longform.mp4"),
  ), true);
  assert.match(report.safe_commands.validate_repair.command, /longform-flagship-repair-plan\.js/);
  assert.doesNotMatch(
    Object.values(report.safe_commands).map((row) => row.command).join("\n"),
    /--publish-youtube|\bupload\b|\boauth\b|\btoken\b|\bAUTO_PUBLISH\b/i,
  );
  assert.equal(report.repair_actions.length, 8);
  assert.ok(report.repair_actions.every((action) => action.expected_paths.length > 0));
  assert.ok(report.repair_actions.every((action) => action.post_repair_validation_command));
  assert.equal(
    report.repair_actions.find((action) => action.check_id === "word_timestamps").materializer_gap,
    "governed_longform_word_timestamp_materializer_missing",
  );
  const humanAction = report.repair_actions.find((action) => action.check_id === "human_av_review");
  assert.equal(humanAction.command, null);
  assert.equal(humanAction.operator_approval_status, "human_action_required");
  assert.equal(humanAction.human_signoff_may_be_generated, false);
});

test("JSON and Markdown proof are written outside the inspected artefact directory", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "longform-flagship-output-"));
  t.after(() => fs.remove(root));
  const currentDir = path.join(root, "current");
  const outputDir = path.join(root, "proof");
  await fs.ensureDir(currentDir);
  const candidatePackagePath = path.join(currentDir, "candidate.json");
  const finalMp4Path = path.join(currentDir, "final.mp4");
  await fs.writeJson(candidatePackagePath, {
    package_id: "release_radar",
    format: "monthly_release_radar",
    month_label: "August 2026",
    longform: { title: "Release Radar", script: "script" },
  });
  await fs.writeFile(finalMp4Path, "media");
  const report = await buildLongformFlagshipRepairPlan({
    candidatePackagePath,
    finalMp4Path,
    repairRoot: path.join(root, "staging"),
    generatedAt: "2026-07-15T12:34:56.000Z",
    probeMedia: async () => ({
      decodable: true,
      duration_seconds: 620,
      format_name: "mp4",
      video: { codec: "h264", width: 1920, height: 1080 },
      audio: { codec: "aac" },
    }),
  });

  const written = await writeLongformFlagshipRepairPlan(report, { outputDir });
  const stored = await fs.readJson(written.jsonPath);
  const markdown = await fs.readFile(written.markdownPath, "utf8");
  assert.equal(written.jsonPath, path.join(outputDir, "longform_flagship_repair_plan.json"));
  assert.equal(written.markdownPath, path.join(outputDir, "longform_flagship_repair_plan.md"));
  assert.equal(stored.verdict, "NOT_GREEN_BLOCKED");
  assert.equal(stored.publish_authorised, false);
  assert.equal(stored.safety.human_signoff_generated, false);
  assert.match(markdown, /^# Longform Flagship Evidence Repair Plan/m);
  assert.match(markdown, /same_run_transcript_binding_missing/);
  assert.match(markdown, /node tools\/pulse-release-radar\.js/);
  assert.match(markdown, /governed_longform_word_timestamp_materializer_missing/);
  assert.match(markdown, /Human signoff generated: no/);
  assert.equal(renderLongformFlagshipRepairPlanMarkdown(report), markdown);

  await assert.rejects(
    writeLongformFlagshipRepairPlan(report, { outputDir: path.join(currentDir, "proof") }),
    /outside the inspected production artefact directory/,
  );
});

test("CLI writes both proof files and prints a bounded JSON summary", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "longform-flagship-cli-"));
  t.after(() => fs.remove(root));
  const currentDir = path.join(root, "current");
  const outputDir = path.join(root, "proof");
  const repairRoot = path.join(root, "staging");
  const sourceInputPath = path.join(root, "release_radar_candidates.json");
  await fs.ensureDir(currentDir);
  const candidatePackagePath = path.join(currentDir, "candidate.json");
  const finalMp4Path = path.join(currentDir, "final.mp4");
  await fs.writeJson(candidatePackagePath, {
    package_id: "release_radar",
    format: "monthly_release_radar",
    month_label: "August 2026",
    longform: { title: "Release Radar", script: "script" },
  });
  await fs.writeJson(sourceInputPath, { candidates: [] });
  await fs.writeFile(finalMp4Path, "media");
  let stdout = "";
  const argv = [
    "--candidate-package", candidatePackagePath,
    "--final-mp4", finalMp4Path,
    "--artifact-dir", currentDir,
    "--output-dir", outputDir,
    "--repair-root", repairRoot,
    "--source-input", sourceInputPath,
    "--generated-at", "2026-07-15T12:34:56.000Z",
    "--json",
  ];

  const parsed = parseRepairPlanArgs(argv);
  assert.equal(parsed.candidatePackagePath, path.resolve(candidatePackagePath));
  assert.equal(parsed.finalMp4Path, path.resolve(finalMp4Path));
  assert.equal(parsed.outputDir, path.resolve(outputDir));
  const result = await runRepairPlanCli(argv, {
    stdout: { write: (value) => { stdout += value; } },
    probeMedia: async () => ({
      decodable: true,
      duration_seconds: 620,
      format_name: "mp4",
      video: { codec: "h264", width: 1920, height: 1080 },
      audio: { codec: "aac" },
    }),
  });

  const summary = JSON.parse(stdout);
  assert.equal(summary.status, "BLOCKED");
  assert.equal(summary.green_claimed, false);
  assert.equal(summary.publish_authorised, false);
  assert.equal(summary.blocker_count, 8);
  assert.equal(summary.json_path, path.join(outputDir, "longform_flagship_repair_plan.json"));
  assert.equal(summary.markdown_path, path.join(outputDir, "longform_flagship_repair_plan.md"));
  assert.equal(result.report.safety.production_db_mutated, false);
  assert.equal(await fs.pathExists(summary.json_path), true);
  assert.equal(await fs.pathExists(summary.markdown_path), true);
});
