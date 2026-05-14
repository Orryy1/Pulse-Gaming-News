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
} = require("../../lib/studio/v2/final-voice-audit");
const {
  loadFinalVoiceReportsByStoryId,
} = require("../../lib/studio/v2/final-voice-report-loader");
const {
  listMp4s,
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

test("final voice audit markdown surfaces pitch, outro and WPM evidence", () => {
  const report = buildFinalVoiceAudit({
    files: ["D:/pulse-data/media/output/final/rss_good.mp4"],
    reportsByStoryId: {
      rss_good: {
        narration: {
          provider: "elevenlabs",
          source: "elevenlabs-production-path",
          audioPath: "D:/pulse-data/media/output/audio/rss_good.mp3",
          acoustic: { medianPitchHz: 118 },
          transcript: "Follow Pulse Gaming so you never miss a beat.",
          wpm: 176,
        },
      },
    },
  });

  const md = renderFinalVoiceAuditMarkdown(report);

  assert.match(md, /pitch=118Hz/);
  assert.match(md, /outro=true/);
  assert.match(md, /wpm=176/);
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
      acoustic: { medianPitchHz: 118, integratedLufs: -14.4 },
      voiceMastering: { ok: true, code: "voice_mastered", targetLufs: -14 },
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
