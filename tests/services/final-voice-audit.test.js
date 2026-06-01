"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  buildFinalVoiceAudit,
  classifyFinalRenderVoice,
  renderFinalVoiceAuditMarkdown,
  storyIdFromPath,
} = require("../../lib/studio/v2/final-voice-audit");
const {
  loadFinalVoiceReportsByStoryId,
} = require("../../lib/studio/v2/final-voice-report-loader");
const {
  listMp4s,
  defaultOutDir,
  listAuditMp4s,
} = require("../../tools/final-voice-audit");

test("final voice audit marks legacy MP4s without approved voice evidence as not reusable", () => {
  const row = classifyFinalRenderVoice({
    mp4Path: "D:/pulse-data/media/output/final/rss_legacy.mp4",
  });

  assert.equal(row.verdict, "review");
  assert.ok(row.blockers.includes("approved_voice_metadata_missing"));
  assert.equal(row.do_not_reuse_for_tiktok_dispatch, true);
});

test("final voice audit rejects demonic low local voice evidence", () => {
  const row = classifyFinalRenderVoice({
    mp4Path: "D:/pulse-data/media/output/final/rss_bad.mp4",
    report: {
      narration: {
        provider: "local",
        source: "local-production-voxcpm",
        audioPath: "test/output/local_tts/rss_bad.mp3",
        acoustic: { medianPitchHz: 58 },
        transcript: "Follow Pulse Gaming so you never miss a beat.",
      },
    },
  });

  assert.equal(row.verdict, "reject");
  assert.ok(row.blockers.includes("unapproved_local_tts_voice_path"));
  assert.ok(row.blockers.includes("demonic_low_voice_risk"));
});

test("final voice audit passes approved production voice evidence", () => {
  const row = classifyFinalRenderVoice({
    mp4Path: "D:/pulse-data/media/output/final/rss_good.mp4",
    report: {
      narration: {
        provider: "elevenlabs",
        source: "elevenlabs-production-path",
        audioPath: "D:/pulse-data/media/output/audio/rss_good.mp3",
        acoustic: { medianPitchHz: 118 },
        transcript: "A clean gaming update. Follow Pulse Gaming so you never miss a beat.",
      },
    },
  });

  assert.equal(row.verdict, "pass");
  assert.deepEqual(row.blockers, []);
  assert.equal(row.do_not_reuse_for_tiktok_dispatch, false);
});

test("final voice audit report is readable and does not mutate media", () => {
  const report = buildFinalVoiceAudit({
    files: [
      "D:/pulse-data/media/output/final/rss_legacy.mp4",
      "D:/pulse-data/media/output/final/rss_good.mp4",
    ],
    reportsByStoryId: {
      rss_good: {
        narration: {
          provider: "elevenlabs",
          source: "elevenlabs-production-path",
          audioPath: "D:/pulse-data/media/output/audio/rss_good.mp3",
          acoustic: { medianPitchHz: 118 },
          transcript: "Follow Pulse Gaming so you never miss a beat.",
        },
      },
    },
  });

  assert.equal(report.safety.mutates_media, false);
  assert.equal(report.counts.review, 1);
  assert.equal(report.counts.pass, 1);
  const md = renderFinalVoiceAuditMarkdown(report);
  assert.match(md, /Final Voice Audit/);
  assert.match(md, /approved_voice_metadata_missing/);
});

test("final voice audit does not report GREEN when no MP4s were inspected", () => {
  const report = buildFinalVoiceAudit({ files: [] });

  assert.equal(report.verdict, "AMBER");
  assert.ok(report.inspection_blockers.includes("no_final_mp4s_inspected"));
  const md = renderFinalVoiceAuditMarkdown(report);
  assert.match(md, /no_final_mp4s_inspected/);
});

test("final voice audit derives story IDs from nested proof render paths", () => {
  const storyId = storyIdFromPath(
    "C:/repo/output/goal-proof/batch/1s4denn/visual_v4_render.mp4",
  );

  assert.equal(storyId, "1s4denn");
});

test("final voice audit markdown surfaces pitch, loudness, true peak, outro and WPM evidence", () => {
  const report = buildFinalVoiceAudit({
    files: ["D:/pulse-data/media/output/final/rss_good.mp4"],
    reportsByStoryId: {
      rss_good: {
        narration: {
          provider: "elevenlabs",
          source: "elevenlabs-production-path",
          audioPath: "D:/pulse-data/media/output/audio/rss_good.mp3",
          acoustic: { medianPitchHz: 118, integratedLufs: -15.8, truePeakDb: -1.4 },
          transcript: "Follow Pulse Gaming so you never miss a beat.",
          wpm: 176,
        },
      },
    },
  });

  const md = renderFinalVoiceAuditMarkdown(report);

  assert.match(md, /pitch=118Hz/);
  assert.match(md, /lufs=-15\.8/);
  assert.match(md, /tp=-1\.4dBTP/);
  assert.match(md, /outro=true/);
  assert.match(md, /wpm=176/);
});

test("final voice audit derives local WPM from transcript and acoustic duration when missing", () => {
  const row = classifyFinalRenderVoice({
    mp4Path: "D:/pulse-data/media/output/final/rss_local.mp4",
    report: {
      narration: {
        provider: "local",
        source: "local-tts-server",
        audioPath: "D:/pulse-data/media/output/audio/rss_local.mp3",
        approvedLocalVoice: true,
        acceptedLocalVoice: {
          id: "pulse-sleepy-liam-20260502",
          fileName: "pulse_liam_sleepy.wav",
          referencePresent: true,
          referenceHash: "4bb87b65b64213fd8447ef1146eda42035b89f51",
        },
        acoustic: {
          medianPitchHz: 118,
          integratedLufs: -16.1,
          truePeakDb: -2.1,
          durationSeconds: 60,
        },
        voiceMastering: { ok: true, code: "voice_mastered", targetLufs: -16 },
        transcript:
          "one two three four five six seven eight nine ten Follow Pulse Gaming so you never miss a beat.",
      },
    },
    env: { STUDIO_V2_LOCAL_VOICE_APPROVED: "true" },
  });

  assert.equal(row.verdict, "pass");
  assert.equal(row.voice_path.wpm, 19);
  assert.equal(row.warnings.includes("voice_pace_unverified"), false);
  assert.equal(row.do_not_reuse_for_tiktok_dispatch, false);
});

test("final voice audit rejects impossible local voice pace instead of counting it as reusable", () => {
  const row = classifyFinalRenderVoice({
    mp4Path: "D:/pulse-data/media/output/final/rss_too_fast.mp4",
    report: {
      narration: {
        provider: "local",
        source: "local-tts-server",
        audioPath: "D:/pulse-data/media/output/audio/rss_too_fast.mp3",
        approvedLocalVoice: true,
        acceptedLocalVoice: {
          id: "pulse-sleepy-liam-20260502",
          fileName: "pulse_liam_sleepy.wav",
          referencePresent: true,
          referenceHash: "c".repeat(40),
        },
        acoustic: { medianPitchHz: 118, integratedLufs: -16.1, truePeakDb: -2.1 },
        voiceMastering: { ok: true, code: "voice_mastered", targetLufs: -16 },
        transcript: "A clean local render. Follow Pulse Gaming so you never miss a beat.",
        wpm: 430,
      },
    },
    env: { STUDIO_V2_LOCAL_VOICE_APPROVED: "true" },
  });

  assert.equal(row.verdict, "reject");
  assert.ok(row.blockers.includes("voice_pace_too_fast"));
  assert.equal(row.voice_path.wpm, 430);
  assert.equal(row.do_not_reuse_for_tiktok_dispatch, true);
});

test("final voice audit reviews local voice when true peak is too hot for social transcodes", () => {
  const row = classifyFinalRenderVoice({
    mp4Path: "D:/pulse-data/media/output/final/rss_hot.mp4",
    report: {
      narration: {
        provider: "local",
        source: "local-production-voxcpm",
        audioPath: "D:/pulse-data/media/output/audio/rss_hot.mp3",
        approvedLocalVoice: true,
        acceptedLocalVoice: {
          id: "pulse-sleepy-liam-20260502",
          fileName: "pulse_liam_sleepy.wav",
          referencePresent: true,
          referenceHash: "a".repeat(40),
        },
        acoustic: { medianPitchHz: 118, integratedLufs: -13.3, truePeakDb: 0.4 },
        voiceMastering: { ok: true, code: "voice_mastered", targetLufs: -16 },
        transcript: "A clean local render. Follow Pulse Gaming so you never miss a beat.",
        wpm: 168,
      },
    },
    env: { STUDIO_V2_LOCAL_VOICE_APPROVED: "true" },
  });

  assert.equal(row.verdict, "review");
  assert.ok(row.warnings.includes("voice_true_peak_too_hot"));
  assert.ok(row.warnings.includes("voice_loudness_too_hot"));
  assert.equal(row.do_not_reuse_for_tiktok_dispatch, true);
});

test("final voice audit rejects local voice when segment loudness jumps mid-render", () => {
  const row = classifyFinalRenderVoice({
    mp4Path: "D:/pulse-data/media/output/final/rss_jump.mp4",
    report: {
      narration: {
        provider: "local",
        source: "local-production-voxcpm",
        audioPath: "D:/pulse-data/media/output/audio/rss_jump.mp3",
        approvedLocalVoice: true,
        acceptedLocalVoice: {
          id: "pulse-sleepy-liam-20260502",
          fileName: "pulse_liam_sleepy.wav",
          referencePresent: true,
          referenceHash: "b".repeat(40),
        },
        acoustic: {
          medianPitchHz: 118,
          integratedLufs: -15.7,
          truePeakDb: -2.4,
          segmentLufs: [-18.2, -17.8, -10.9, -10.6],
        },
        voiceMastering: { ok: true, code: "voice_mastered", targetLufs: -16 },
        transcript: "A clean local render. Follow Pulse Gaming so you never miss a beat.",
        wpm: 168,
      },
    },
    env: { STUDIO_V2_LOCAL_VOICE_APPROVED: "true" },
  });

  assert.equal(row.verdict, "reject");
  assert.ok(row.blockers.includes("voice_segment_loudness_jump"));
  assert.equal(row.do_not_reuse_for_tiktok_dispatch, true);
});

test("final voice report loader finds sidecar reports for dispatch tooling", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "final-voice-loader-"));
  const finalDir = path.join(dir, "final");
  const outDir = path.join(dir, "out");
  await fs.ensureDir(finalDir);
  await fs.ensureDir(outDir);
  const mp4 = path.join(finalDir, "rss_good.mp4");
  await fs.writeFile(mp4, "fake mp4");
  await fs.writeJson(path.join(outDir, "rss_good_studio_v2_report.json"), {
    voice: {
      provider: "elevenlabs",
      source: "elevenlabs-production-path",
      audioPath: "D:/pulse-data/media/output/audio/rss_good.mp3",
      acoustic: { medianPitchHz: 118 },
      transcript: "Follow Pulse Gaming so you never miss a beat.",
    },
  });

  const reports = await loadFinalVoiceReportsByStoryId([mp4], {
    finalDir,
    outputDirs: [outDir],
  });
  const report = buildFinalVoiceAudit({
    files: [mp4],
    reportsByStoryId: reports,
  });

  assert.equal(reports.rss_good.voice.provider, "elevenlabs");
  assert.equal(report.counts.pass, 1);
});

test("final voice report loader falls back to local TTS timestamp metadata", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "final-voice-timestamps-"));
  const finalDir = path.join(dir, "output", "final");
  const audioDir = path.join(dir, "output", "audio");
  await fs.ensureDir(finalDir);
  await fs.ensureDir(audioDir);
  const mp4 = path.join(finalDir, "rss_local.mp4");
  await fs.writeFile(mp4, "fake mp4");
  await fs.writeJson(path.join(audioDir, "rss_local_timestamps.json"), {
    characters: ["F", "o", "l", "l", "o", "w"],
    meta: {
      provider: "local",
      source: "local-tts-server",
      transcript: "A clean local render. Follow Pulse Gaming so you never miss a beat.",
      approvedLocalVoice: true,
      acceptedLocalVoice: {
        id: "pulse-sleepy-liam-20260502",
        fileName: "pulse_liam_sleepy.wav",
        referencePresent: true,
        referenceHash: "4bb87b65b64213fd8447ef1146eda42035b89f51",
      },
      acoustic: { medianPitchHz: 118, integratedLufs: -15.8, truePeakDb: -1.4 },
      voiceMastering: { ok: true, code: "voice_mastered", targetLufs: -16 },
      wpm: 168,
    },
  });

  const reports = await loadFinalVoiceReportsByStoryId([mp4], {
    finalDir,
    outputDirs: [],
  });
  const report = buildFinalVoiceAudit({
    files: [mp4],
    reportsByStoryId: reports,
  });

  assert.equal(reports.rss_local.source, "audio_timestamp_sidecar");
  assert.equal(report.counts.pass, 1);
  assert.equal(report.rows[0].do_not_reuse_for_tiktok_dispatch, false);
});

test("final voice report loader reads nested proof narration manifests before generic QA reports", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "final-voice-proof-manifest-"));
  const batchDir = path.join(dir, "batch");
  const storyDir = path.join(batchDir, "1s4denn");
  await fs.ensureDir(storyDir);
  const mp4 = path.join(storyDir, "visual_v4_render.mp4");
  const timestampsPath = path.join(storyDir, "word_timestamps.json");
  await fs.writeFile(mp4, "fake mp4");
  await fs.writeJson(path.join(storyDir, "audio_segment_loudness_report.json"), {
    story_id: "1s4denn",
    verdict: "pass",
    metrics: { max_adjacent_rise_db: 0.6 },
    segments: [
      { mean_volume_db: -16.2 },
      { mean_volume_db: -16.1 },
    ],
  });
  await fs.writeJson(timestampsPath, {
    characters: ["F", "o", "l", "l", "o", "w"],
    meta: {
      provider: "local",
      source: "local-tts-server",
      approvedLocalVoice: true,
      acceptedLocalVoice: {
        id: "pulse-sleepy-liam-20260502",
        fileName: "pulse_liam_sleepy.wav",
        referencePresent: true,
        referenceHash: "4bb87b65b64213fd8447ef1146eda42035b89f51",
      },
      acoustic: {
        medianPitchHz: 118,
        integratedLufs: -15.8,
        truePeakDb: -1.4,
        durationSeconds: 60,
      },
      voiceMastering: { ok: true, code: "voice_mastered", targetLufs: -16 },
      wpm: 168,
    },
  });
  await fs.writeJson(path.join(storyDir, "narration_manifest.json"), {
    provider: "local_tts",
    resolved_audio_path: path.join(storyDir, "narration.mp3"),
    final_transcript: "A clean local render. Follow Pulse Gaming so you never miss a beat.",
    resolved_word_timestamps_path: timestampsPath,
  });

  const reports = await loadFinalVoiceReportsByStoryId([mp4], {
    finalDir: batchDir,
    outputDirs: [],
  });
  const report = buildFinalVoiceAudit({
    files: [mp4],
    reportsByStoryId: reports,
  });

  assert.equal(reports["1s4denn"].source, "goal_proof_narration_manifest");
  assert.equal(report.counts.pass, 1);
});

test("final voice report loader prefers rich local-clone timestamp evidence over sparse stale sidecars", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "final-voice-rich-timestamps-"));
  const oldMediaRoot = process.env.MEDIA_ROOT;
  const mediaRoot = path.join(dir, "media");
  const batchDir = path.join(dir, "batch");
  const storyId = "1voicepref";
  const storyDir = path.join(batchDir, storyId);
  const mediaAudioDir = path.join(mediaRoot, "output", "audio");
  await fs.ensureDir(storyDir);
  await fs.ensureDir(mediaAudioDir);
  const mp4 = path.join(storyDir, "visual_v4_render.mp4");
  const sparseTimestampsPath = path.join(storyDir, "sparse_timestamps.json");
  const richTimestampRel = path.join("output", "audio", `${storyId}_timestamps.json`);
  const richTimestampsPath = path.join(mediaAudioDir, `${storyId}_timestamps.json`);
  await fs.writeFile(mp4, "fake mp4");
  await fs.writeJson(sparseTimestampsPath, {
    characters: ["F", "o", "l", "l", "o", "w"],
    meta: {
      wordTimestampSource: "stale-local-copy",
    },
  });
  await fs.writeJson(richTimestampsPath, {
    characters: ["F", "o", "l", "l", "o", "w"],
    meta: {
      provider: "local",
      source: "local-tts-server",
      text: "A clean local render. Follow Pulse Gaming so you never miss a beat.",
      approvedLocalVoice: true,
      acceptedLocalVoice: {
        id: "pulse-sleepy-liam-20260502",
        fileName: "pulse_liam_sleepy.wav",
        referencePresent: true,
        referenceHash: "4bb87b65b64213fd8447ef1146eda42035b89f51",
      },
      acoustic: {
        medianPitchHz: 118,
        integratedLufs: -15.8,
        truePeakDb: -1.4,
        durationSeconds: 60,
      },
      voiceMastering: { ok: true, code: "voice_mastered", targetLufs: -16 },
      wpm: 168,
    },
  });
  await fs.writeJson(path.join(storyDir, "narration_manifest.json"), {
    provider: "local_tts",
    resolved_audio_path: path.join(storyDir, "narration.mp3"),
    final_transcript: "A clean local render. Follow Pulse Gaming so you never miss a beat.",
    resolved_word_timestamps_path: sparseTimestampsPath,
    word_timestamps_path: richTimestampRel,
  });

  try {
    process.env.MEDIA_ROOT = mediaRoot;
    const reports = await loadFinalVoiceReportsByStoryId([mp4], {
      finalDir: batchDir,
      outputDirs: [],
    });
    const report = buildFinalVoiceAudit({
      files: [mp4],
      reportsByStoryId: reports,
    });

    assert.equal(reports[storyId].timestampPath, richTimestampsPath);
    assert.equal(report.counts.pass, 1);
    assert.equal(report.rows[0].do_not_reuse_for_tiktok_dispatch, false);
  } finally {
    if (oldMediaRoot === undefined) delete process.env.MEDIA_ROOT;
    else process.env.MEDIA_ROOT = oldMediaRoot;
  }
});

test("final voice audit CLI inspects newest MP4s first when limited", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "final-voice-newest-"));
  const oldMp4 = path.join(dir, "aaa_old.mp4");
  const newMp4 = path.join(dir, "zzz_new.mp4");
  await fs.writeFile(oldMp4, "old");
  await fs.writeFile(newMp4, "new");
  const oldDate = new Date("2026-05-01T10:00:00Z");
  const newDate = new Date("2026-05-05T10:00:00Z");
  await fs.utimes(oldMp4, oldDate, oldDate);
  await fs.utimes(newMp4, newDate, newDate);

  const files = await listMp4s(dir, 1);

  assert.deepEqual(files, [newMp4]);
});

test("final voice audit CLI discovers nested proof MP4s", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "final-voice-nested-"));
  const storyDir = path.join(dir, "1s4denn");
  await fs.ensureDir(storyDir);
  const nestedMp4 = path.join(storyDir, "visual_v4_render.mp4");
  await fs.writeFile(nestedMp4, "nested");

  const files = await listMp4s(dir);

  assert.deepEqual(files, [nestedMp4]);
});

test("final voice audit CLI includes active local proof manifest videos", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "final-voice-active-manifest-"));
  const finalDir = path.join(dir, "final");
  const proofDir = path.join(dir, "proof", "1s4denn");
  await fs.ensureDir(finalDir);
  await fs.ensureDir(proofDir);
  const productionMp4 = path.join(finalDir, "rss_live.mp4");
  const activeMp4 = path.join(proofDir, "visual_v4_render.mp4");
  const manifestPath = path.join(dir, "local_test_video_manifest.json");
  await fs.writeFile(productionMp4, "production");
  await fs.writeFile(activeMp4, "active proof");
  await fs.writeJson(manifestPath, {
    videos: [
      {
        story_id: "1s4denn",
        video_path: activeMp4,
        safety: { can_count_as_final_production_render: false },
      },
    ],
  });

  const files = await listAuditMp4s({
    finalDir,
    localTestManifestPath: manifestPath,
  });

  assert.ok(files.includes(productionMp4));
  assert.ok(files.includes(activeMp4));
});

test("final voice audit CLI defaults to the control-tower artefact directory", () => {
  const dir = defaultOutDir();

  assert.match(dir.replace(/\\/g, "/"), /\/output\/goal-contract$/);
});
