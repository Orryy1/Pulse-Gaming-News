"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  applyLocalAudioRepairs,
  buildLocalMediaRepairQueue,
  renderLocalMediaRepairApplyMarkdown,
  renderLocalMediaRepairMarkdown,
} = require("../../lib/ops/local-media-repair");
const {
  resolveAcceptedLocalVoiceReference,
} = require("../../lib/studio/v2/local-voice-reference");

const ROOT = path.resolve(__dirname, "..", "..");
const ACCEPTED_SLEEPY_LIAM = resolveAcceptedLocalVoiceReference();

const READY_TTS = {
  ok: true,
  ready: true,
  status: "ok",
  phase: "ready",
  voice: {
    alias: "liam",
    loaded: true,
    refResolved: true,
    acceptedReferenceId: ACCEPTED_SLEEPY_LIAM.id,
    acceptedReferenceFile: ACCEPTED_SLEEPY_LIAM.fileName,
    referenceHash: ACCEPTED_SLEEPY_LIAM.referenceHash,
  },
};

test("local media repair queues approved stale voice renders for local Liam regeneration", () => {
  const report = buildLocalMediaRepairQueue({
    stories: [
      {
        id: "rss_voice_bad",
        title: "GTA 6 trailer evidence is stacking up",
        approved: true,
        full_script: "GTA 6 has a confirmed clue today. ".repeat(28),
        audio_path: "output/audio/rss_voice_bad.mp3",
        exported_path: "output/final/rss_voice_bad.mp4",
        breaking_score: 82,
      },
    ],
    mediaByStoryId: {
      rss_voice_bad: {
        audioExists: true,
        finalExists: true,
        finalDurationSeconds: 64,
      },
    },
    voiceAuditByStoryId: {
      rss_voice_bad: {
        verdict: "reject",
        blockers: ["demonic_low_voice_risk"],
        warnings: [],
      },
    },
    localTts: READY_TTS,
    dryRun: true,
  });

  assert.equal(report.counts.ready_local_repair, 1);
  assert.equal(report.items[0].action, "ready_local_audio_render_repair");
  assert.ok(report.items[0].needs.includes("regenerate_audio_with_sleepy_liam"));
  assert.ok(report.items[0].needs.includes("rerender_video_local"));
  assert.equal(report.safety.posts_to_platforms, false);
  assert.equal(report.safety.mutates_production_db, false);
});

test("local media repair blocks overlong scripts before spending local TTS time", () => {
  const report = buildLocalMediaRepairQueue({
    stories: [
      {
        id: "rss_too_long",
        title: "GTA 6 trailer evidence gets everything explained",
        approved: true,
        full_script: "This sentence makes the short too long. ".repeat(45),
        audio_path: null,
        exported_path: null,
      },
    ],
    localTts: READY_TTS,
  });

  assert.equal(report.items[0].action, "rewrite_or_route_before_render");
  assert.equal(report.items[0].runtime.shouldGenerateShortAudio, false);
  assert.ok(report.items[0].blockers.some((item) => item.includes("script_runtime")));
  assert.equal(report.counts.blocked_runtime, 1);
});

test("local media repair does not treat old 100-word scripts as 60-second local Liam candidates", () => {
  const report = buildLocalMediaRepairQueue({
    stories: [
      {
        id: "rss_too_short_for_local",
        title: "Short local voice script",
        approved: true,
        full_script: "GTA 6 has a new clue. ".repeat(17),
        audio_path: "output/audio/rss_too_short_for_local.mp3",
        exported_path: "output/final/rss_too_short_for_local.mp4",
      },
    ],
    mediaByStoryId: {
      rss_too_short_for_local: {
        audioExists: true,
        finalExists: true,
        finalDurationSeconds: 35,
      },
    },
    voiceAuditByStoryId: {
      rss_too_short_for_local: {
        verdict: "review",
        blockers: ["approved_voice_metadata_missing"],
      },
    },
    localTts: READY_TTS,
  });

  assert.equal(report.items[0].action, "extend_script_before_local_repair");
  assert.ok(report.items[0].needs.includes("extend_script_for_64_70s_local_voice"));
  assert.match(report.items[0].warnings[0], /below_flash_target/);
});

test("local media repair estimates the cleaned narration text, not stale stored word_count", () => {
  const report = buildLocalMediaRepairQueue({
    stories: [
      {
        id: "rss_stale_count",
        title: "GTA 6 evidence is stacking up",
        approved: true,
        word_count: 260,
        full_script: "GTA 6 has a new clue. ".repeat(17),
        audio_path: "output/audio/rss_stale_count.mp3",
        exported_path: "output/final/rss_stale_count.mp4",
      },
    ],
    mediaByStoryId: {
      rss_stale_count: {
        audioExists: true,
        finalExists: true,
        finalDurationSeconds: 35,
      },
    },
    voiceAuditByStoryId: {
      rss_stale_count: {
        verdict: "review",
        blockers: ["approved_voice_metadata_missing"],
      },
    },
    localTts: READY_TTS,
    cleanText: (text) => text.replace(/\bGTA\s*6\b/gi, "G T A six"),
  });

  assert.equal(report.items[0].action, "extend_script_before_local_repair");
  assert.equal(report.items[0].runtime.wordCount, 136);
  assert.match(report.items[0].warnings[0], /below_flash_target/);
});

test("local media repair does not resurrect approved off-brand entertainment rows", () => {
  const report = buildLocalMediaRepairQueue({
    stories: [
      {
        id: "rss_hotd",
        title: "House of the Dragon Season 3 Trailer and Launch Date Confirmed",
        approved: true,
        full_script: "House of the Dragon has a new trailer. ".repeat(30),
        audio_path: null,
        exported_path: null,
      },
    ],
    localTts: READY_TTS,
  });

  assert.equal(report.items[0].action, "skip_topicality_reject");
  assert.ok(report.items[0].blockers.includes("off_topic_entertainment"));
  assert.equal(report.counts.skipped, 1);
});

test("local media repair refuses apply recommendations when local Liam is not healthy", () => {
  const report = buildLocalMediaRepairQueue({
    stories: [
      {
        id: "rss_missing",
        title: "Nintendo confirms a Switch 2 update",
        approved: true,
        full_script: "Nintendo confirmed new Switch details today. ".repeat(32),
        audio_path: null,
        exported_path: null,
      },
    ],
    mediaByStoryId: {
      rss_missing: {
        audioExists: false,
        finalExists: false,
      },
    },
    localTts: {
      ok: false,
      ready: false,
      status: "unreachable",
      phase: "unknown",
      reasons: ["health endpoint unreachable"],
      voice: { alias: null, loaded: false, refResolved: false },
    },
  });

  assert.equal(report.items[0].action, "blocked_local_tts_unavailable");
  assert.ok(report.items[0].blockers.includes("local_tts_not_ready"));
  assert.equal(report.counts.blocked_local_tts, 1);
});

test("local media repair leaves current approved-voice renders alone", () => {
  const report = buildLocalMediaRepairQueue({
    stories: [
      {
        id: "rss_good",
        title: "Pokemon Go event starts today",
        approved: true,
        full_script: "Pokemon Go has a confirmed event today. ".repeat(27),
        audio_path: "output/audio/rss_good.mp3",
        exported_path: "output/final/rss_good.mp4",
      },
    ],
    mediaByStoryId: {
      rss_good: {
        audioExists: true,
        finalExists: true,
        finalDurationSeconds: 66,
      },
    },
    voiceAuditByStoryId: {
      rss_good: {
        verdict: "pass",
        blockers: [],
        warnings: [],
      },
    },
    localTts: READY_TTS,
  });

  assert.equal(report.items[0].action, "no_action");
  assert.equal(report.counts.no_action, 1);
});

test("local media repair classifies out-of-range Liam audio for local duration repair planning", () => {
  const report = buildLocalMediaRepairQueue({
    stories: [
      {
        id: "rss_duration_short",
        title: "Nintendo confirms a Switch 2 update",
        approved: true,
        full_script: "Nintendo confirmed new Switch details today. ".repeat(32),
        audio_path: "output/audio/rss_duration_short.mp3",
        exported_path: "output/final/rss_duration_short.mp4",
      },
    ],
    mediaByStoryId: {
      rss_duration_short: {
        audioExists: true,
        finalExists: true,
        audioDurationSeconds: 58.2,
        finalDurationSeconds: 58.2,
      },
    },
    voiceAuditByStoryId: {
      rss_duration_short: {
        verdict: "pass",
        blockers: [],
        warnings: [],
      },
    },
    localTts: READY_TTS,
  });

  assert.equal(report.items[0].action, "extend_script_before_local_repair");
  assert.equal(report.items[0].failure_code, "duration_too_short");
  assert.ok(report.items[0].blockers.includes("duration_too_short"));
  assert.ok(report.items[0].needs.includes("extend_script_for_64_70s_local_voice"));
  assert.ok(!report.items[0].needs.includes("regenerate_audio_with_sleepy_liam"));
});

test("local media repair routes too-short Liam proofs through script extension before audio repair", () => {
  const report = buildLocalMediaRepairQueue({
    stories: [
      {
        id: "rss_duration_extension",
        title: "Nintendo confirms a Switch 2 update",
        approved: true,
        full_script: "Nintendo confirmed new Switch details today. ".repeat(32),
        audio_path: "output/audio/rss_duration_extension.mp3",
        exported_path: "output/final/rss_duration_extension.mp4",
      },
    ],
    mediaByStoryId: {
      rss_duration_extension: {
        audioExists: true,
        finalExists: true,
        audioDurationSeconds: 58.2,
        finalDurationSeconds: 58.2,
      },
    },
    voiceAuditByStoryId: {
      rss_duration_extension: {
        verdict: "pass",
        blockers: [],
        warnings: [],
      },
    },
    localTts: READY_TTS,
  });

  assert.equal(report.items[0].action, "extend_script_before_local_repair");
  assert.equal(report.items[0].failure_code, "duration_too_short");
  assert.ok(report.items[0].needs.includes("extend_script_for_64_70s_local_voice"));
  assert.ok(!report.items[0].needs.includes("regenerate_audio_with_sleepy_liam"));
  assert.equal(report.counts.blocked_runtime, 1);
});

test("local media repair rejects non-Liam local voices as unsafe", () => {
  const report = buildLocalMediaRepairQueue({
    stories: [
      {
        id: "rss_bad_voice",
        title: "Xbox confirms a new update",
        approved: true,
        full_script: "Xbox confirmed new details for players today. ".repeat(28),
        audio_path: null,
        exported_path: null,
      },
    ],
    mediaByStoryId: {
      rss_bad_voice: { audioExists: false, finalExists: false },
    },
    localTts: {
      ok: true,
      ready: true,
      status: "ok",
      phase: "ready",
      voice: {
        alias: "christopher",
        voiceId: "G17SuINrv2H9FC6nvetn",
        loaded: true,
        refResolved: true,
      },
    },
  });

  assert.equal(report.items[0].action, "blocked_local_tts_unavailable");
  assert.equal(report.items[0].failure_code, "unsafe_voice");
  assert.ok(report.items[0].blockers.includes("unsafe_voice"));
  assert.equal(report.counts.blocked_local_tts, 1);
});

test("local media repair rejects Liam aliases without the accepted Sleepy Liam reference", () => {
  const report = buildLocalMediaRepairQueue({
    stories: [
      {
        id: "rss_wrong_liam",
        title: "Xbox confirms a new update",
        approved: true,
        full_script: "Xbox confirmed new details for players today. ".repeat(28),
        audio_path: null,
        exported_path: null,
      },
    ],
    mediaByStoryId: {
      rss_wrong_liam: { audioExists: false, finalExists: false },
    },
    localTts: {
      ok: true,
      ready: true,
      status: "ok",
      phase: "ready",
      voice: {
        alias: "liam",
        voiceId: "TX3LPaxmHKxFdv7VOQHJ",
        loaded: true,
        refResolved: true,
        acceptedReferenceId: "old-pulse-liam",
        acceptedReferenceFile: "pulse_v2.wav",
        referenceHash: "0".repeat(40),
      },
    },
  });

  assert.equal(report.items[0].action, "blocked_local_tts_unavailable");
  assert.equal(report.items[0].failure_code, "unsafe_voice");
  assert.match(report.items[0].failure_message, /accepted Sleepy Liam reference/);
  assert.equal(report.counts.blocked_local_tts, 1);
});

test("local media repair accepts nested local TTS reference metadata from health checks", () => {
  const report = buildLocalMediaRepairQueue({
    stories: [
      {
        id: "rss_nested_ref",
        title: "Xbox confirms a new update",
        approved: true,
        full_script: "Xbox confirmed new details for players today. ".repeat(28),
        audio_path: null,
        exported_path: null,
      },
    ],
    mediaByStoryId: {
      rss_nested_ref: { audioExists: false, finalExists: false },
    },
    localTts: {
      ok: true,
      ready: true,
      status: "ok",
      phase: "ready",
      voice: {
        alias: "liam",
        voiceId: "TX3LPaxmHKxFdv7VOQHJ",
        loaded: true,
        refResolved: true,
        reference: {
          id: ACCEPTED_SLEEPY_LIAM.id,
          fileName: ACCEPTED_SLEEPY_LIAM.fileName,
          referenceHash: ACCEPTED_SLEEPY_LIAM.referenceHash,
          referencePresent: true,
        },
      },
    },
  });

  assert.equal(report.local_tts.ready, true);
  assert.equal(report.items[0].action, "ready_local_audio_render_repair");
  assert.equal(report.items[0].failure_code, null);
});

test("local media repair markdown is operator-readable and explicitly local-only", () => {
  const report = buildLocalMediaRepairQueue({
    stories: [],
    localTts: READY_TTS,
  });
  const md = renderLocalMediaRepairMarkdown(report);

  assert.match(md, /Local Media Repair Queue/);
  assert.match(md, /local-only/);
  assert.match(md, /No OAuth, tokens, Railway env vars or social posts/);
});

test("local media repair CLI loads .env before opening SQLite and defaults to dry-run", () => {
  const tool = fs.readFileSync(
    path.join(ROOT, "tools", "local-media-repair.js"),
    "utf8",
  );
  const dotenvIndex = tool.indexOf("dotenv.config");
  const dbIndex = tool.indexOf('require("../lib/db")');

  assert.ok(dotenvIndex >= 0, "tool must load .env");
  assert.ok(dbIndex > dotenvIndex, "tool must load .env before requiring db");
  assert.match(tool, /dryRun\s*:\s*!args\.applyLocal/);
  assert.match(tool, /applyLocalAudioRepairs/);
  assert.match(tool, /--apply-local-audio/);
  assert.match(tool, /probeLocalAudioAcoustics/);
  assert.match(tool, /createLocalTtsBatchRecovery/);
  assert.match(tool, /recoverLocalTts/);
  assert.match(tool, /--apply-limit/);
  assert.doesNotMatch(tool, /postShort|uploadShort|publishAll|autonomous\/publish/);
});

test("apply-local audio repair writes only queued Liam audio proofs", async () => {
  const story = {
    id: "rss_voice_bad",
    title: "GTA 6 trailer evidence is stacking up",
    approved: true,
    full_script: "GTA 6 has a confirmed clue today. ".repeat(28),
    audio_path: "output/audio/rss_voice_bad.mp3",
    exported_path: "output/final/rss_voice_bad.mp4",
  };
  const report = buildLocalMediaRepairQueue({
    stories: [
      story,
      {
        id: "rss_too_long",
        approved: true,
        full_script: "This sentence makes the short too long. ".repeat(45),
      },
    ],
    mediaByStoryId: {
      rss_voice_bad: {
        audioExists: true,
        finalExists: true,
        finalDurationSeconds: 64,
      },
    },
    voiceAuditByStoryId: {
      rss_voice_bad: {
        verdict: "review",
        blockers: ["approved_voice_metadata_missing"],
      },
    },
    localTts: READY_TTS,
  });
  const generated = [];

  const result = await applyLocalAudioRepairs({
    report,
    storiesById: { rss_voice_bad: story },
    outputRelDir: "test/output/local-media-repair/audio",
    generateTts: async (text, outputRel, rate) => {
      generated.push({ text, outputRel, rate });
      return outputRel;
    },
    measureDuration: async () => 66.2,
    resolveOutputPath: async (outputRel) => path.resolve("D:/pulse-data/media", outputRel),
  });

  assert.equal(result.applied.length, 1);
  assert.equal(result.skipped.length, 0);
  assert.equal(generated.length, 1);
  assert.equal(generated[0].rate, 1.0);
  assert.match(generated[0].outputRel, /test[\\/]output[\\/]local-media-repair[\\/]audio[\\/]rss_voice_bad_liam\.mp3/);
  assert.equal(result.applied[0].duration_seconds, 66.2);
  assert.equal(result.applied[0].duration_verdict, "pass");
  assert.equal(result.applied[0].estimated_seconds, report.items[0].runtime.estimatedSeconds);
  assert.match(result.applied[0].resolved_audio_path, /D:[\\/]pulse-data[\\/]media/);
  assert.match(renderLocalMediaRepairApplyMarkdown(result), /Local Media Repair Audio Apply/);
  assert.equal(result.safety.mutates_production_db, false);
  assert.equal(result.safety.posts_to_platforms, false);
});

test("apply-local audio repair stamps accepted Sleepy Liam metadata", async () => {
  const previousApproval = process.env.STUDIO_V2_LOCAL_VOICE_APPROVED;
  process.env.STUDIO_V2_LOCAL_VOICE_APPROVED = "true";
  const outputDir = path.join(ROOT, "test", "output", "tmp-local-media-repair");
  fs.rmSync(outputDir, { recursive: true, force: true });
  const story = {
    id: "rss_voice_meta",
    title: "Xbox confirms a new update",
    approved: true,
    full_script: "Xbox confirmed a useful detail today. ".repeat(32),
    audio_path: "output/audio/rss_voice_meta.mp3",
    exported_path: "output/final/rss_voice_meta.mp4",
  };
  const report = buildLocalMediaRepairQueue({
    stories: [story],
    mediaByStoryId: {
      rss_voice_meta: {
        audioExists: true,
        finalExists: true,
        finalDurationSeconds: 64,
      },
    },
    voiceAuditByStoryId: {
      rss_voice_meta: {
        verdict: "review",
        blockers: ["approved_voice_metadata_missing"],
      },
    },
    localTts: READY_TTS,
  });

  try {
    const result = await applyLocalAudioRepairs({
      report,
      storiesById: { rss_voice_meta: story },
      outputRelDir: outputDir,
      generateTts: async (_text, outputRel) => {
        fs.mkdirSync(path.dirname(outputRel), { recursive: true });
        fs.writeFileSync(outputRel, "fake mp3 bytes");
        fs.writeFileSync(
          outputRel.replace(/\.mp3$/, "_timestamps.json"),
          JSON.stringify({
            characters: Array.from("Xbox confirmed. Follow Pulse Gaming so you never miss a beat."),
            character_start_times_seconds: [],
            character_end_times_seconds: [],
            meta: {
              acoustic: { medianPitchHz: 118 },
              voiceDiagnostics: {
                selectedCandidate: "configured",
                metrics: { median_f0_hz: 118 },
              },
            },
          }),
        );
      },
      measureDuration: async () => 65.1,
    });

    const applied = result.applied[0];
    const timestamps = JSON.parse(
      fs.readFileSync(path.join(outputDir, "rss_voice_meta_liam_timestamps.json"), "utf8"),
    );
    assert.equal(applied.local_voice_metadata, "stamped");
    assert.equal(applied.failure_code, null);
    assert.equal(applied.acoustic.medianPitchHz, 118);
    assert.equal(applied.spoken_outro_present, true);
    assert.equal(applied.local_voice_reference.referencePresent, true);
    assert.equal(timestamps.meta.provider, "local");
    assert.equal(timestamps.meta.acoustic.medianPitchHz, 118);
    assert.match(timestamps.meta.transcript, /Follow Pulse Gaming so you never miss a beat/);
    assert.equal(timestamps.meta.acceptedLocalVoice.id, "pulse-sleepy-liam-20260502");
    assert.equal(timestamps.meta.acceptedLocalVoice.referencePresent, true);
  } finally {
    if (previousApproval === undefined) delete process.env.STUDIO_V2_LOCAL_VOICE_APPROVED;
    else process.env.STUDIO_V2_LOCAL_VOICE_APPROVED = previousApproval;
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("apply-local audio repair probes acoustic diagnostics when timestamps omit them", async () => {
  const previousApproval = process.env.STUDIO_V2_LOCAL_VOICE_APPROVED;
  process.env.STUDIO_V2_LOCAL_VOICE_APPROVED = "true";
  const outputDir = path.join(ROOT, "test", "output", "tmp-local-media-repair-probe");
  fs.rmSync(outputDir, { recursive: true, force: true });
  const story = {
    id: "rss_voice_probe",
    title: "Xbox confirms a new update",
    approved: true,
    full_script: "Xbox confirmed a useful detail today. ".repeat(32),
    audio_path: "output/audio/rss_voice_probe.mp3",
    exported_path: "output/final/rss_voice_probe.mp4",
  };
  const report = buildLocalMediaRepairQueue({
    stories: [story],
    mediaByStoryId: {
      rss_voice_probe: {
        audioExists: true,
        finalExists: true,
        finalDurationSeconds: 64,
      },
    },
    voiceAuditByStoryId: {
      rss_voice_probe: {
        verdict: "review",
        blockers: ["approved_voice_metadata_missing"],
      },
    },
    localTts: READY_TTS,
  });
  const probed = [];

  try {
    const result = await applyLocalAudioRepairs({
      report,
      storiesById: { rss_voice_probe: story },
      outputRelDir: outputDir,
      generateTts: async (_text, outputRel) => {
        fs.mkdirSync(path.dirname(outputRel), { recursive: true });
        fs.writeFileSync(outputRel, "fake mp3 bytes");
        fs.writeFileSync(
          outputRel.replace(/\.mp3$/, "_timestamps.json"),
          JSON.stringify({
            characters: Array.from("Xbox confirmed. Follow Pulse Gaming so you never miss a beat."),
            character_start_times_seconds: [],
            character_end_times_seconds: [],
            meta: {},
          }),
        );
      },
      acousticProbe: async (audioPath) => {
        probed.push(audioPath);
        return {
          medianPitchHz: 118,
          integratedLufs: -16,
        };
      },
      measureDuration: async () => 65.1,
    });

    const applied = result.applied[0];
    const timestamps = JSON.parse(
      fs.readFileSync(path.join(outputDir, "rss_voice_probe_liam_timestamps.json"), "utf8"),
    );
    assert.equal(probed.length, 1);
    assert.match(probed[0], /rss_voice_probe_liam\.mp3$/);
    assert.equal(applied.failure_code, null);
    assert.equal(applied.acoustic.medianPitchHz, 118);
    assert.equal(timestamps.meta.acoustic.medianPitchHz, 118);
    assert.equal(timestamps.meta.voiceDiagnostics.source, "local_acoustic_probe");
  } finally {
    if (previousApproval === undefined) delete process.env.STUDIO_V2_LOCAL_VOICE_APPROVED;
    else process.env.STUDIO_V2_LOCAL_VOICE_APPROVED = previousApproval;
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("apply-local audio repair reports below-floor Liam proofs as rejected", async () => {
  const story = {
    id: "rss_voice_short",
    title: "GTA 6 trailer evidence is stacking up",
    approved: true,
    full_script: "GTA 6 has a confirmed clue today. ".repeat(22),
    audio_path: "output/audio/rss_voice_short.mp3",
    exported_path: "output/final/rss_voice_short.mp4",
  };
  const report = buildLocalMediaRepairQueue({
    stories: [story],
    mediaByStoryId: {
      rss_voice_short: {
        audioExists: true,
        finalExists: true,
        finalDurationSeconds: 64,
      },
    },
    voiceAuditByStoryId: {
      rss_voice_short: {
        verdict: "review",
        blockers: ["approved_voice_metadata_missing"],
      },
    },
    localTts: READY_TTS,
    cleanText: (text) => text.replace(/\bGTA\s*6\b/gi, "G T A six"),
  });

  const result = await applyLocalAudioRepairs({
    report,
    storiesById: { rss_voice_short: story },
    generateTts: async () => null,
    measureDuration: async () => 58.4,
  });

  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].duration_verdict, "reject_duration");
  assert.equal(result.applied[0].failure_code, "duration_too_short");
  assert.equal(result.applied[0].duration_seconds, 58.4);
});

test("apply-local audio repair records TTS failures without aborting the batch", async () => {
  const stories = [
    {
      id: "rss_first",
      title: "GTA 6 trailer evidence is stacking up",
      approved: true,
      full_script: "GTA 6 has a confirmed clue today. ".repeat(28),
      audio_path: "output/audio/rss_first.mp3",
      exported_path: "output/final/rss_first.mp4",
      breaking_score: 90,
    },
    {
      id: "rss_second",
      title: "Xbox confirms a new update",
      approved: true,
      full_script: "Xbox confirmed new details for players today. ".repeat(28),
      audio_path: "output/audio/rss_second.mp3",
      exported_path: "output/final/rss_second.mp4",
      breaking_score: 80,
    },
  ];
  const report = buildLocalMediaRepairQueue({
    stories,
    mediaByStoryId: {
      rss_first: { audioExists: true, finalExists: true, finalDurationSeconds: 64 },
      rss_second: { audioExists: true, finalExists: true, finalDurationSeconds: 64 },
    },
    voiceAuditByStoryId: {
      rss_first: { verdict: "review", blockers: ["approved_voice_metadata_missing"] },
      rss_second: { verdict: "review", blockers: ["approved_voice_metadata_missing"] },
    },
    localTts: READY_TTS,
  });
  const generated = [];

  const result = await applyLocalAudioRepairs({
    report,
    storiesById: Object.fromEntries(stories.map((story) => [story.id, story])),
    generateTts: async (_text, outputRel) => {
      generated.push(outputRel);
      if (outputRel.includes("rss_first")) throw new Error("read ECONNRESET");
    },
    measureDuration: async () => 66.1,
  });

  assert.equal(generated.length, 2);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].story_id, "rss_first");
  assert.equal(result.skipped[0].reason, "generate_tts_failed");
  assert.equal(result.skipped[0].failure_code, "connection_reset");
  assert.equal(result.skipped[0].server_reset_recorded, true);
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].story_id, "rss_second");
});

test("apply-local audio repair restarts local TTS once on recoverable failures", async () => {
  const story = {
    id: "rss_recovers",
    title: "Xbox confirms a new update",
    approved: true,
    full_script: "Xbox confirmed new details for players today. ".repeat(28),
    audio_path: "output/audio/rss_recovers.mp3",
    exported_path: "output/final/rss_recovers.mp4",
  };
  const report = buildLocalMediaRepairQueue({
    stories: [story],
    mediaByStoryId: {
      rss_recovers: { audioExists: true, finalExists: true, finalDurationSeconds: 64 },
    },
    voiceAuditByStoryId: {
      rss_recovers: { verdict: "review", blockers: ["approved_voice_metadata_missing"] },
    },
    localTts: READY_TTS,
  });
  const generated = [];
  const recoveries = [];

  const result = await applyLocalAudioRepairs({
    report,
    storiesById: { rss_recovers: story },
    generateTts: async (_text, outputRel) => {
      generated.push(outputRel);
      if (generated.length === 1) throw new Error("read ECONNRESET");
    },
    recoverLocalTts: async (context) => {
      recoveries.push(context);
      return { ok: true, action: "restart", after: { status: "ok" } };
    },
    measureDuration: async () => 66.1,
  });

  assert.equal(generated.length, 2);
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0].storyId, "rss_recovers");
  assert.equal(recoveries[0].failure.code, "connection_reset");
  assert.equal(result.skipped.length, 0);
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].story_id, "rss_recovers");
  assert.equal(result.applied[0].tts_attempts, 2);
  assert.equal(result.applied[0].server_recovery.action, "restart");
});

test("apply-local audio repair skips every candidate instead of using an unsafe voice", async () => {
  let generated = 0;
  const result = await applyLocalAudioRepairs({
    report: {
      local_tts: {
        ready: true,
        status: "ok",
        phase: "ready",
        voice: {
          alias: "unknown",
          loaded: true,
          ref_resolved: true,
        },
      },
      items: [
        {
          story_id: "rss_unsafe",
          action: "ready_local_audio_render_repair",
          needs: ["regenerate_audio_with_sleepy_liam"],
          runtime: { wordCount: 190, estimatedSeconds: 64 },
        },
      ],
    },
    storiesById: {
      rss_unsafe: {
        id: "rss_unsafe",
        full_script: "Xbox confirmed new details for players today. ".repeat(32),
      },
    },
    generateTts: async () => {
      generated += 1;
    },
  });

  assert.equal(generated, 0);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, "unsafe_voice");
  assert.equal(result.skipped[0].failure_code, "unsafe_voice");
});

test("apply-local audio repair records missing timestamps as a proof failure", async () => {
  const story = {
    id: "rss_missing_ts",
    title: "Xbox confirms a new update",
    approved: true,
    full_script: "Xbox confirmed new details for players today. ".repeat(28),
    audio_path: "output/audio/rss_missing_ts.mp3",
    exported_path: "output/final/rss_missing_ts.mp4",
  };
  const report = buildLocalMediaRepairQueue({
    stories: [story],
    mediaByStoryId: {
      rss_missing_ts: { audioExists: true, finalExists: true, finalDurationSeconds: 64 },
    },
    voiceAuditByStoryId: {
      rss_missing_ts: { verdict: "review", blockers: ["approved_voice_metadata_missing"] },
    },
    localTts: READY_TTS,
  });

  const result = await applyLocalAudioRepairs({
    report,
    storiesById: { rss_missing_ts: story },
    generateTts: async () => null,
    measureDuration: async () => 66.1,
  });

  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].duration_verdict, "pass");
  assert.equal(result.applied[0].failure_code, "missing_timestamps");
  assert.match(result.applied[0].local_voice_metadata, /not_stamped:timestamps_missing/);
});

test("apply-local audio repair records duration measurement failures without aborting the batch", async () => {
  const stories = [
    {
      id: "rss_measure_fails",
      title: "GTA 6 trailer evidence is stacking up",
      approved: true,
      full_script: "GTA 6 has a confirmed clue today. ".repeat(28),
      audio_path: "output/audio/rss_measure_fails.mp3",
      exported_path: "output/final/rss_measure_fails.mp4",
      breaking_score: 90,
    },
    {
      id: "rss_measure_ok",
      title: "Xbox confirms a new update",
      approved: true,
      full_script: "Xbox confirmed new details for players today. ".repeat(28),
      audio_path: "output/audio/rss_measure_ok.mp3",
      exported_path: "output/final/rss_measure_ok.mp4",
      breaking_score: 80,
    },
  ];
  const report = buildLocalMediaRepairQueue({
    stories,
    mediaByStoryId: {
      rss_measure_fails: { audioExists: true, finalExists: true, finalDurationSeconds: 64 },
      rss_measure_ok: { audioExists: true, finalExists: true, finalDurationSeconds: 64 },
    },
    voiceAuditByStoryId: {
      rss_measure_fails: { verdict: "review", blockers: ["approved_voice_metadata_missing"] },
      rss_measure_ok: { verdict: "review", blockers: ["approved_voice_metadata_missing"] },
    },
    localTts: READY_TTS,
  });

  const result = await applyLocalAudioRepairs({
    report,
    storiesById: Object.fromEntries(stories.map((story) => [story.id, story])),
    generateTts: async () => null,
    measureDuration: async (outputRel) => {
      if (outputRel.includes("rss_measure_fails")) throw new Error("ffprobe duration failed");
      return 66.1;
    },
  });

  assert.equal(result.applied.length, 2);
  assert.equal(result.applied[0].story_id, "rss_measure_fails");
  assert.equal(result.applied[0].duration_verdict, "unknown");
  assert.equal(result.applied[0].failure_code, "duration_unknown");
  assert.match(result.applied[0].failure_message, /duration/i);
  assert.equal(result.applied[1].story_id, "rss_measure_ok");
  assert.equal(result.applied[1].duration_verdict, "pass");
});
