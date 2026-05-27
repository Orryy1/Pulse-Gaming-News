"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  buildLocalTtsProofPromotionReport,
  renderLocalTtsProofPromotionMarkdown,
} = require("../../lib/studio/local-tts-proof-promoter");

const ROOT = path.resolve(__dirname, "..", "..");
const {
  writePromotionReport,
} = require("../../tools/local-tts-proof-promoter");

const ACCEPTED_REF = {
  id: "pulse-sleepy-liam-20260502",
  fileName: "pulse_liam_sleepy.wav",
  referencePresent: true,
  referenceHash: "a".repeat(40),
};

const DOCTOR_GREEN = {
  verdict: "green",
  action: "none",
  failure_code: null,
  reason: "local TTS is ready with the accepted voice loaded",
  before: {
    ok: true,
    status: "ok",
    phase: "ready",
    voice: {
      alias: "liam",
      loaded: true,
      refResolved: true,
      reference: ACCEPTED_REF,
    },
  },
};

function passingProof(overrides = {}) {
  return {
    story_id: "rss_ready",
    proof_source: "local_script_extension",
    output_audio_path: "test/output/local-script-extension/audio/rss_ready_liam_extended.mp3",
    resolved_audio_path: "D:/pulse-data/media/test/output/local-script-extension/audio/rss_ready_liam_extended.mp3",
    duration_seconds: 66.4,
    duration_verdict: "pass",
    target_duration_verdict: "pass",
    failure_code: null,
    acoustic: {
      medianPitchHz: 118,
      integratedLufs: -15.8,
      truePeakDb: -2.4,
    },
    transcript: "A clean gaming update. Follow Pulse Gaming so you never miss a beat.",
    wpm: 172,
    local_voice_reference: ACCEPTED_REF,
    local_voice_metadata: "stamped",
    timestamp_verdict: "pass",
    verdict: "voice_ready",
    ...overrides,
  };
}

function timestampPayload(overrides = {}) {
  const text = "A clean gaming update. Follow Pulse Gaming so you never miss a beat.";
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, index) => index * 0.05),
    character_end_times_seconds: characters.map((_, index) => index * 0.05 + 0.04),
    meta: {
      provider: "local",
      source: "local-tts-server",
      acceptedLocalVoice: ACCEPTED_REF,
      voiceMastering: {
        ok: true,
        code: "voice_mastered",
        targetLufs: -16,
        acoustic: {
          integratedLufs: -15.8,
          truePeakDb: -2.4,
          loudnessRange: 7.2,
        },
      },
      acoustic: {
        integratedLufs: -15.8,
        truePeakDb: -2.4,
        medianPitchHz: 118,
      },
      transcript: text,
      spokenOutroPresent: true,
      ...overrides.meta,
    },
    ...overrides,
  };
}

test("local TTS proof promoter goes green only when Liam sample, health, proof, timestamps and mastering are verified", () => {
  const audioPath = "D:/pulse-data/media/test/output/local-script-extension/audio/rss_ready_liam_extended.mp3";
  const report = buildLocalTtsProofPromotionReport({
    generatedAt: "2026-05-16T10:00:00.000Z",
    acceptedReference: ACCEPTED_REF,
    doctorReport: DOCTOR_GREEN,
    proofReports: [
      {
        source: "local_script_extension",
        report: {
          applied: [passingProof({ resolved_audio_path: audioPath })],
          skipped: [],
        },
      },
    ],
    timestampPayloads: {
      "D:/pulse-data/media/test/output/local-script-extension/audio/rss_ready_liam_extended_timestamps.json":
        timestampPayload(),
    },
    env: { LOCAL_TTS_PROMOTION_MIN_READY_PROOFS: "1" },
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.can_replace_elevenlabs_for_proof_renders, true);
  assert.equal(report.gates.approved_voice_sample.ok, true);
  assert.equal(report.gates.health.ok, true);
  assert.equal(report.gates.generation_evidence.ok, true);
  assert.equal(report.gates.timestamp_usability.ok, true);
  assert.equal(report.gates.loudness_mastering.ok, true);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.safety.local_only, true);
  assert.equal(report.safety.production_voice_unchanged, true);
});

test("local TTS proof promoter blocks replacement when a ready proof lacks timestamp and mastering evidence", () => {
  const report = buildLocalTtsProofPromotionReport({
    acceptedReference: ACCEPTED_REF,
    doctorReport: DOCTOR_GREEN,
    proofReports: [
      {
        source: "local_media_repair",
        report: {
          applied: [
            passingProof({
              story_id: "rss_unmastered",
              output_audio_path: "test/output/local-media-repair/audio/rss_unmastered_liam.mp3",
              resolved_audio_path: null,
              local_voice_metadata: "not_stamped:timestamps_missing",
              timestamp_verdict: "fail",
            }),
          ],
          skipped: [],
        },
      },
    ],
    timestampPayloads: {},
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.can_replace_elevenlabs_for_proof_renders, false);
  assert.ok(report.blockers.includes("timestamp_evidence_missing"));
  assert.ok(report.blockers.includes("voice_mastering_evidence_missing"));
  assert.equal(report.gates.timestamp_usability.ok, false);
  assert.equal(report.gates.loudness_mastering.ok, false);
});

test("local TTS proof promoter refuses unverified Sleepy Liam voice sample even with proof evidence", () => {
  const report = buildLocalTtsProofPromotionReport({
    acceptedReference: {
      id: "pulse-sleepy-liam-20260502",
      fileName: "pulse_liam_sleepy.wav",
      referencePresent: false,
      referenceHash: null,
    },
    doctorReport: DOCTOR_GREEN,
    proofReports: [
      {
        source: "local_script_extension",
        report: {
          applied: [passingProof()],
          skipped: [],
        },
      },
    ],
    timestampPayloads: {
      "test/output/local-script-extension/audio/rss_ready_liam_extended_timestamps.json":
        timestampPayload(),
    },
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.gates.approved_voice_sample.ok, false);
  assert.ok(report.blockers.includes("approved_sleepy_liam_sample_missing"));
});

test("local TTS proof promoter deduplicates proof rows repeated by latest and overnight reports", () => {
  const row = passingProof({
    resolved_audio_path:
      "D:/pulse-data/media/test/output/local-script-extension/audio/rss_ready_liam_extended.mp3",
  });
  const overnightRow = passingProof({ resolved_audio_path: null });
  delete overnightRow.verdict;
  const report = buildLocalTtsProofPromotionReport({
    acceptedReference: ACCEPTED_REF,
    doctorReport: DOCTOR_GREEN,
    proofReports: [
      {
        source: "local_script_extension",
        report: { applied: [row], skipped: [] },
      },
    ],
    overnightReport: {
      proof_batch: {
        applied: [overnightRow],
        skipped: [],
      },
    },
    timestampPayloads: {
      "test/output/local-script-extension/audio/rss_ready_liam_extended_timestamps.json":
        timestampPayload(),
    },
  });

  assert.equal(report.proof_candidates.length, 1);
  assert.equal(report.gates.timestamp_usability.checked_count, 1);
  assert.equal(report.gates.loudness_mastering.checked_count, 1);
});

test("local TTS proof promoter treats historical failed attempts as warnings once enough Liam proofs pass", () => {
  const proofRows = [
    passingProof({ story_id: "ready_1", output_audio_path: "test/output/local-script-extension/audio/ready_1_liam_extended.mp3" }),
    passingProof({ story_id: "ready_2", output_audio_path: "test/output/local-script-extension/audio/ready_2_liam_extended.mp3" }),
    passingProof({ story_id: "ready_3", output_audio_path: "test/output/local-script-extension/audio/ready_3_liam_extended.mp3" }),
  ];
  const timestampPayloads = {};
  for (const row of proofRows) {
    timestampPayloads[row.output_audio_path.replace(/\.mp3$/, "_timestamps.json")] =
      timestampPayload();
  }

  const report = buildLocalTtsProofPromotionReport({
    acceptedReference: ACCEPTED_REF,
    doctorReport: DOCTOR_GREEN,
    proofReports: [
      {
        source: "local_script_extension",
        report: {
          applied: [
            ...proofRows,
            {
              story_id: "old_failed_story",
              proof_source: "local_script_extension",
              output_audio_path: "test/output/local-script-extension/audio/old_failed_story_liam_extended.mp3",
              duration_verdict: "reject_duration",
              failure_code: "duration_too_short",
            },
          ],
          skipped: [{ story_id: "old_skipped_story", failure_code: "connection_reset" }],
        },
      },
    ],
    timestampPayloads,
  });

  assert.equal(report.gates.generation_evidence.ok, true);
  assert.equal(report.verdict, "GREEN");
  assert.ok(
    report.gates.generation_evidence.warnings.includes(
      "local_tts_historical_generation_failures_present",
    ),
  );
  assert.ok(!report.blockers.includes("local_tts_unresolved_generation_failures"));
});

test("local TTS proof promoter markdown is operator-readable and does not suggest production cutover", () => {
  const report = buildLocalTtsProofPromotionReport({
    acceptedReference: ACCEPTED_REF,
    doctorReport: DOCTOR_GREEN,
    proofReports: [
      {
        source: "local_script_extension",
        report: { applied: [passingProof()], skipped: [] },
      },
    ],
    timestampPayloads: {
      "test/output/local-script-extension/audio/rss_ready_liam_extended_timestamps.json":
        timestampPayload(),
    },
    env: { LOCAL_TTS_PROMOTION_MIN_READY_PROOFS: "1" },
  });
  const markdown = renderLocalTtsProofPromotionMarkdown(report);

  assert.match(markdown, /Local TTS Proof Render Promotion/);
  assert.match(markdown, /Can replace ElevenLabs for proof renders: yes/);
  assert.match(markdown, /Production voice remains unchanged/);
  assert.doesNotMatch(markdown, /switch production voice/i);
  assert.doesNotMatch(markdown, /api[_ -]?key|access_token|secret/i);
});

test("local TTS proof promoter command is registered", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["tts:proof-promoter"], "node tools/local-tts-proof-promoter.js");
});

test("local TTS proof promoter CLI writer persists local report paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-local-tts-promoter-"));
  try {
    const outDir = path.join(root, "test", "output");
    const report = buildLocalTtsProofPromotionReport({
      acceptedReference: ACCEPTED_REF,
      doctorReport: DOCTOR_GREEN,
      proofReports: [
        {
          source: "local_script_extension",
          report: { applied: [passingProof()], skipped: [] },
        },
      ],
      timestampPayloads: {
        "test/output/local-script-extension/audio/rss_ready_liam_extended_timestamps.json":
          timestampPayload(),
      },
      env: { LOCAL_TTS_PROMOTION_MIN_READY_PROOFS: "1" },
    });

    const paths = await writePromotionReport({
      report,
      outDir,
      root,
      writeRootReport: true,
    });
    const json = await fs.readJson(paths.jsonPath);
    const markdown = await fs.readFile(paths.mdPath, "utf8");
    const rootMarkdown = await fs.readFile(paths.rootPath, "utf8");

    assert.equal(json.report_paths.jsonPath, paths.jsonPath);
    assert.equal(json.report_paths.mdPath, paths.mdPath);
    assert.equal(json.report_paths.rootPath, paths.rootPath);
    assert.match(markdown, /Local TTS Proof Render Promotion/);
    assert.match(rootMarkdown, /Production voice remains unchanged/);
  } finally {
    await fs.remove(root);
  }
});
