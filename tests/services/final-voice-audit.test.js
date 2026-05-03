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
