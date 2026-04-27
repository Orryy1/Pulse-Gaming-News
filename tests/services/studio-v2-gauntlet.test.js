"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  parseReportFilename,
  discoverGauntletCandidates,
  parseLoudnormJson,
  summariseCandidate,
  rankCandidate,
  buildGauntletFindings,
  buildGauntletMarkdown,
} = require("../../lib/studio/v2/gauntlet-v2");

test("parseReportFilename recognises canonical v2 reports", () => {
  assert.deepEqual(parseReportFilename("1sn9xhe_studio_v2_report.json"), {
    storyId: "1sn9xhe",
    variant: "canonical",
    commit: null,
    kind: "canonical",
    channelId: "pulse-gaming",
    suffix: "",
    mp4Name: "studio_v2_1sn9xhe.mp4",
    assName: "1sn9xhe_studio_v2.ass",
    seoName: "1sn9xhe_studio_v2_seo.json",
  });
});

test("parseReportFilename recognises variant v2 reports", () => {
  assert.deepEqual(parseReportFilename("1sn9xhe_studio_v2_nofreeze_report.json"), {
    storyId: "1sn9xhe",
    variant: "nofreeze",
    commit: null,
    kind: "variant",
    channelId: null,
    suffix: "_nofreeze",
    mp4Name: "studio_v2_1sn9xhe_nofreeze.mp4",
    assName: "1sn9xhe_studio_v2_nofreeze.ass",
    seoName: "1sn9xhe_studio_v2_nofreeze_seo.json",
  });
});

test("parseReportFilename recognises channel-themed v2 reports", () => {
  assert.deepEqual(parseReportFilename("1sn9xhe_studio_v2__stacked_report.json"), {
    storyId: "1sn9xhe",
    variant: "stacked",
    commit: null,
    kind: "channel",
    channelId: "stacked",
    suffix: "__stacked",
    mp4Name: "studio_v2_1sn9xhe__stacked.mp4",
    assName: "1sn9xhe_studio_v2__stacked.ass",
    seoName: "1sn9xhe_studio_v2__stacked_seo.json",
  });
});

test("parseReportFilename recognises pinned QA snapshots", () => {
  assert.deepEqual(parseReportFilename("qa_1sn9xhe_studio_v2_3954f4c_report.json"), {
    storyId: "1sn9xhe",
    variant: "snapshot-3954f4c",
    commit: "3954f4c",
    kind: "snapshot",
    mp4Name: "qa_studio_v2_1sn9xhe_3954f4c_snapshot.mp4",
    assName: "qa_1sn9xhe_studio_v2_3954f4c.ass",
  });
});

test("discoverGauntletCandidates includes derived audio-master outputs", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-v2-gauntlet-"));
  fs.writeFileSync(path.join(dir, "1sn9xhe_studio_v2_report.json"), "{}");
  fs.writeFileSync(path.join(dir, "1sn9xhe_studio_v2.ass"), "");
  fs.writeFileSync(path.join(dir, "studio_v2_1sn9xhe.mp4"), "");
  fs.writeFileSync(path.join(dir, "studio_v2_1sn9xhe_loudnorm16.mp4"), "");
  const candidates = await discoverGauntletCandidates(dir);
  assert.ok(candidates.some((c) => c.variant === "canonical"));
  assert.ok(
    candidates.some((c) => c.variant === "loudnorm16" && c.kind === "audio-master"),
  );
});

test("parseLoudnormJson extracts loudness metrics from ffmpeg stderr", () => {
  const result = parseLoudnormJson(`
    [Parsed_loudnorm_0] 
    {
      "input_i" : "-24.23",
      "input_tp" : "-3.92",
      "input_lra" : "2.10",
      "input_thresh" : "-34.38",
      "target_offset" : "0.24"
    }
  `);
  assert.deepEqual(result, {
    integratedLufs: -24.2,
    truePeakDb: -3.9,
    lraLu: 2.1,
    thresholdLufs: -34.4,
    targetOffsetLu: 0.2,
  });
});

test("summariseCandidate extracts studio, forensic and loudness signals", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-v2-gauntlet-summary-"));
  const seoPath = path.join(dir, "1sn9xhe_studio_v2_seo.json");
  fs.writeFileSync(
    seoPath,
    JSON.stringify({
      channelId: "pulse-gaming",
      title: "Metro 2039 reveal is bleak",
      hashtags: ["#Gaming", "#Metro"],
      pinnedComment: "Freeze-frame at 0:47.",
      thumbnailText: "METRO RETURNS",
      validation: [],
    }),
  );
  const summary = summariseCandidate({
    candidate: {
      storyId: "1sn9xhe",
      variant: "canonical",
      kind: "canonical",
      channelId: "pulse-gaming",
      commit: null,
      mp4Path: "C:/repo/test/output/studio_v2_1sn9xhe.mp4",
      reportPath: "C:/repo/test/output/1sn9xhe_studio_v2_report.json",
      assPath: "C:/repo/test/output/1sn9xhe_studio_v2.ass",
      seoPath,
    },
    studioReport: {
      verdict: { lane: "pass", greenHits: 13, amberTrips: 3, redTrips: 0 },
      runtime: { durationS: 55.432, sizeBytes: 1000 },
      auto: {
        sourceDiversity: { value: 0.88, grade: "green" },
        clipDominance: { value: 0.75, grade: "green" },
        sfxEventCount: { value: 1, grade: "amber" },
        durationIntegrity: { value: 55.43, grade: "green" },
        voicePathUsed: { value: "production", grade: "green" },
      },
    },
    forensicReport: {
      summary: { verdict: "pass", issueCount: 0, failCount: 0, warnCount: 0 },
      outputs: { jsonPath: "test/output/qa.json" },
      audio: { verdict: "pass" },
      subtitles: { verdict: "pass", overrunS: 0 },
      visual: { verdict: "pass", repeatPairCount: 2 },
      issues: [],
    },
    loudness: { integratedLufs: -24.2 },
  });
  assert.equal(summary.key, "1sn9xhe:canonical");
  assert.equal(summary.studio.lane, "pass");
  assert.equal(summary.forensic.audioRecurrence, "pass");
  assert.equal(summary.loudness.integratedLufs, -24.2);
  assert.equal(summary.channelId, "pulse-gaming");
  assert.equal(summary.seo.present, true);
  assert.equal(summary.seo.validationCount, 0);
  assert.equal(summary.seo.hasPinnedComment, true);
});

test("rankCandidate penalises reject, forensic failure and quiet audio", () => {
  const good = {
    studio: { lane: "pass", redTrips: 0, amberTrips: 1 },
    forensic: {
      failCount: 0,
      warnCount: 0,
      audioRecurrence: "pass",
      subtitleVerdict: "pass",
      visualVerdict: "pass",
    },
    loudness: { integratedLufs: -24 },
    seo: { present: true, validationCount: 0 },
  };
  const bad = {
    studio: { lane: "reject", redTrips: 1, amberTrips: 4 },
    forensic: {
      failCount: 1,
      warnCount: 1,
      audioRecurrence: "fail",
      subtitleVerdict: "warn",
      visualVerdict: "pass",
    },
    loudness: { integratedLufs: -36 },
    seo: { present: true, validationCount: 2 },
  };
  assert.ok(rankCandidate(good) > rankCandidate(bad));
});

test("rankCandidate rewards visible editorial grammar and full HF card lane", () => {
  const base = {
    studio: {
      lane: "pass",
      redTrips: 0,
      amberTrips: 3,
      clipDominance: 0.69,
      beatAwarenessRatio: 0.8,
      grammarKinds: ["punch-pair-cross-clip"],
      hyperframesCardCount: 4,
    },
    forensic: {
      failCount: 0,
      warnCount: 0,
      audioRecurrence: "pass",
      subtitleVerdict: "pass",
      visualVerdict: "pass",
    },
    loudness: { integratedLufs: -24 },
    seo: { present: true, validationCount: 0 },
  };
  const richer = {
    ...base,
    studio: {
      ...base.studio,
      clipDominance: 0.75,
      grammarKinds: ["punch-pair-cross-clip", "freeze-frame"],
    },
  };
  assert.ok(rankCandidate(richer) > rankCandidate(base));
});

test("buildGauntletFindings surfaces repeated SFX and truncation history", () => {
  const findings = buildGauntletFindings([
    {
      key: "old",
      studio: {
        lane: "downgrade",
        redTrips: 1,
        sfxEventCount: 16,
        durationIntegrity: "red",
      },
      forensic: {
        verdict: "fail",
        subtitleOverrunS: 4.1,
      },
      loudness: { integratedLufs: -24 },
      seo: { present: false, validationCount: null },
    },
  ]);
  assert.ok(findings.some((f) => f.code === "failing_candidates"));
  assert.ok(findings.some((f) => f.code === "repeated_sfx_history"));
  assert.ok(findings.some((f) => f.code === "truncated_timeline_history"));
});

test("buildGauntletMarkdown produces a candidate matrix", () => {
  const md = buildGauntletMarkdown({
    generatedAt: "now",
    candidateCount: 1,
    summary: { verdict: "pass", bestCandidate: "x" },
    findings: [],
    candidates: [
      {
        key: "x",
        score: 99,
        studio: { lane: "pass", durationS: 55.4, sfxEventCount: 1 },
        forensic: {
          verdict: "pass",
          subtitleVerdict: "pass",
          visualVerdict: "pass",
        },
        loudness: { integratedLufs: -24.2 },
        seo: { validationCount: 0 },
      },
    ],
  });
  assert.match(md, /Candidate Matrix/);
  assert.match(md, /x \| 99/);
});
