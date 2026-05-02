"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildFlashLaneVoiceWorkbench,
  evaluateVoiceCandidate,
  generateLocalVoiceCandidate,
  renderFlashLaneVoiceWorkbenchMarkdown,
  scriptWithRequiredOutro,
} = require("../../lib/studio/v2/flash-lane-voice-workbench");

const FLASH_SCRIPT = [
  "Take-Two just made the weirdest legacy franchise call of the week.",
  "The company says it passed on a sequel to one of its legacy franchises because the pitch was not strong enough.",
  "That matters because Take-Two owns names that still make gaming audiences stop scrolling: GTA, Red Dead, BioShock, Mafia and Borderlands.",
  "This is not a release-date reveal and it is not confirmation of a cancelled project.",
  "It is a rare look at how the publisher decides what gets revived and what stays buried.",
  "The interesting bit is the standard.",
  "Take-Two is saying nostalgia alone is not enough.",
  "If a sequel cannot clear the creative bar, even a famous logo does not save it.",
  "That makes the mystery bigger, not smaller.",
  "Was it BioShock, Midnight Club, Bully, Max Payne or something else entirely?",
  "For players, the real takeaway is brutal.",
  "A beloved franchise can still lose internally if the pitch feels average.",
  "Follow Pulse Gaming so you never miss a beat.",
].join(" ");

function story(overrides = {}) {
  return {
    id: "voice-story",
    title: "GTA 6 Owner Passed On A Sequel To A Legacy Franchise",
    hook: "Take-Two just made the weirdest legacy franchise call of the week.",
    full_script: FLASH_SCRIPT,
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    id: "candidate-a",
    provider: "elevenlabs",
    source: "elevenlabs-production-path",
    path: "test/output/audio/candidate-a.mp3",
    durationS: 64.5,
    transcript: FLASH_SCRIPT,
    acoustic: {
      medianPitchHz: 118,
      integratedLufs: -18.5,
      truePeakDb: -1.4,
      silenceRatio: 0.02,
      clippingRatio: 0,
    },
    ...overrides,
  };
}

test("Flash Lane voice workbench approves a clean production candidate", () => {
  const report = buildFlashLaneVoiceWorkbench({
    story: story(),
    candidates: [candidate()],
    now: "2026-05-02T00:00:00.000Z",
  });

  assert.equal(report.verdict, "candidate_ready");
  assert.equal(report.selected_candidate.id, "candidate-a");
  assert.equal(report.selected_candidate.pilot_allowed, true);
  assert.equal(report.candidates[0].verdict, "approved_for_flash_lane_preflight");
  assert.equal(report.candidates[0].blockers.length, 0);
});

test("Flash Lane voice workbench rejects cached slow demonic local narration", () => {
  const result = evaluateVoiceCandidate({
    story: story(),
    candidate: candidate({
      id: "slow-local",
      provider: "local",
      source: "local-production-voxcpm-path",
      durationS: 118.025,
      acoustic: {
        medianPitchHz: 61,
        integratedLufs: -25,
        truePeakDb: -4,
        silenceRatio: 0.03,
        clippingRatio: 0,
      },
    }),
    env: { STUDIO_V2_LOCAL_VOICE_APPROVED: "false" },
  });

  assert.equal(result.verdict, "rejected");
  assert.equal(result.pilot_allowed, false);
  assert.ok(result.blockers.includes("narration_too_long_for_flash_lane"));
  assert.ok(result.blockers.includes("spoken_pace_too_slow"));
  assert.ok(result.blockers.includes("demonic_low_voice_risk"));
});

test("Flash Lane voice workbench keeps clean local output in human review until approved", () => {
  const result = evaluateVoiceCandidate({
    story: story(),
    candidate: candidate({
      id: "clean-local",
      provider: "local",
      source: "local-production-chatterbox-path",
      acoustic: {
        medianPitchHz: 116,
        integratedLufs: -18,
        truePeakDb: -1.8,
        silenceRatio: 0.01,
        clippingRatio: 0,
      },
    }),
    env: { STUDIO_V2_LOCAL_VOICE_APPROVED: "false" },
  });

  assert.equal(result.verdict, "needs_human_voice_review");
  assert.equal(result.pilot_allowed, false);
  assert.ok(result.warnings.includes("local_voice_requires_human_approval"));
});

test("Flash Lane voice workbench allows explicitly approved clean local output", () => {
  const result = evaluateVoiceCandidate({
    story: story(),
    candidate: candidate({
      id: "approved-local",
      provider: "local",
      source: "local-production-chatterbox-path",
      approvedLocalVoice: true,
    }),
    env: { STUDIO_V2_LOCAL_VOICE_APPROVED: "false" },
  });

  assert.equal(result.verdict, "approved_for_flash_lane_preflight");
  assert.equal(result.pilot_allowed, true);
});

test("Flash Lane voice workbench rejects candidates missing the spoken outro", () => {
  const result = evaluateVoiceCandidate({
    story: story(),
    candidate: candidate({
      id: "no-outro",
      transcript: "Take-Two just made the weirdest legacy franchise call of the week.",
    }),
  });

  assert.equal(result.verdict, "rejected");
  assert.ok(result.blockers.includes("spoken_outro_missing"));
});

test("Flash Lane voice workbench treats missing acoustic evidence as review, not green", () => {
  const result = evaluateVoiceCandidate({
    story: story(),
    candidate: candidate({
      id: "unknown-acoustic",
      acoustic: null,
    }),
  });

  assert.equal(result.verdict, "needs_human_voice_review");
  assert.equal(result.pilot_allowed, false);
  assert.ok(result.warnings.includes("acoustic_profile_unverified"));
});

test("Flash Lane voice workbench does not treat null acoustic values as zero", () => {
  const result = evaluateVoiceCandidate({
    story: story(),
    candidate: candidate({
      id: "partial-acoustic",
      acoustic: {
        medianPitchHz: null,
        integratedLufs: null,
        truePeakDb: null,
        silenceRatio: null,
        clippingRatio: null,
      },
    }),
  });

  assert.equal(result.verdict, "needs_human_voice_review");
  assert.ok(result.warnings.includes("pitch_profile_unverified"));
  assert.ok(result.warnings.includes("loudness_unverified"));
  assert.equal(result.warnings.includes("voice_loudness_hot"), false);
  assert.equal(result.blockers.includes("audio_clipping_risk"), false);
});

test("Flash Lane voice workbench warns when narration is slower than the high-energy lane ideal", () => {
  const result = evaluateVoiceCandidate({
    story: story(),
    candidate: candidate({
      id: "slow-but-publishable",
      durationS: 72.2,
    }),
  });

  assert.equal(result.verdict, "needs_human_voice_review");
  assert.ok(result.warnings.includes("spoken_pace_below_flash_lane_ideal"));
  assert.equal(result.blockers.includes("spoken_pace_too_slow"), false);
});

test("Flash Lane voice workbench blocks objectively too-quiet narration", () => {
  const result = evaluateVoiceCandidate({
    story: story(),
    candidate: candidate({
      id: "too-quiet",
      acoustic: {
        medianPitchHz: 118,
        integratedLufs: -30.6,
        truePeakDb: -10.5,
        silenceRatio: 0.01,
        clippingRatio: 0,
      },
    }),
  });

  assert.equal(result.verdict, "rejected");
  assert.ok(result.blockers.includes("voice_too_quiet"));
});

test("Flash Lane voice workbench emits a local-only dry-run generation plan", () => {
  const report = buildFlashLaneVoiceWorkbench({
    story: story(),
    candidates: [],
    dryRun: true,
    now: "2026-05-02T00:00:00.000Z",
  });

  assert.equal(report.verdict, "needs_voice_candidates");
  assert.equal(report.generation_plan.dry_run, true);
  assert.equal(report.generation_plan.calls_tts, false);
  assert.ok(report.generation_plan.local_engines.includes("voxcpm2"));
  assert.ok(report.generation_plan.local_engines.includes("chatterbox"));
  assert.equal(report.safety.posts_to_platforms, false);
  assert.equal(report.safety.mutates_railway, false);
});

test("Flash Lane voice workbench marks apply-local voice generation as local TTS work", () => {
  const report = buildFlashLaneVoiceWorkbench({
    story: story(),
    candidates: [],
    dryRun: false,
    now: "2026-05-02T00:00:00.000Z",
  });

  assert.equal(report.generation_plan.dry_run, false);
  assert.equal(report.generation_plan.calls_tts, true);
  assert.equal(report.safety.report_only, false);
  assert.equal(report.safety.calls_tts, true);
  assert.equal(report.safety.local_only, true);
  assert.equal(report.safety.posts_to_platforms, false);
});

test("Flash Lane voice workbench appends the required spoken outro when the contract strips it", () => {
  const bodyOnly = FLASH_SCRIPT.replace(" Follow Pulse Gaming so you never miss a beat.", "");
  const text = scriptWithRequiredOutro(bodyOnly, {
    script: { spoken_outro_required: true },
  });

  assert.match(text, /Follow Pulse Gaming so you never miss a beat\.$/);
});

test("Flash Lane voice workbench markdown is readable and safety-explicit", () => {
  const report = buildFlashLaneVoiceWorkbench({
    story: story(),
    candidates: [
      candidate({ id: "reject", durationS: 118.025 }),
      candidate({ id: "approve" }),
    ],
    now: "2026-05-02T00:00:00.000Z",
  });
  const markdown = renderFlashLaneVoiceWorkbenchMarkdown(report);

  assert.doesNotThrow(() => JSON.parse(JSON.stringify(report)));
  assert.match(markdown, /Flash Lane Voice Workbench/);
  assert.match(markdown, /approve/);
  assert.match(markdown, /No Railway, OAuth, production DB or posting/);
});

test("Flash Lane voice workbench has a local operator command", () => {
  const pkg = require("../../package.json");
  const toolPath = path.join(process.cwd(), "tools", "flash-lane-voice-workbench.js");

  assert.equal(
    pkg.scripts["studio:v2:voice-workbench"],
    "node tools/flash-lane-voice-workbench.js",
  );
  assert.equal(fs.existsSync(toolPath), true);
});

test("Flash Lane voice workbench CLI can target a specific local TTS base URL", () => {
  const { parseArgs } = require("../../tools/flash-lane-voice-workbench");
  const args = parseArgs([
    "node",
    "tools/flash-lane-voice-workbench.js",
    "--generate-local",
    "--engine",
    "chatterbox",
    "--base-url",
    "http://127.0.0.1:8766",
    "--apply-local",
  ]);

  assert.equal(args.generateLocal, true);
  assert.equal(args.engine, "chatterbox");
  assert.equal(args.baseUrl, "http://127.0.0.1:8766");
  assert.equal(args.dryRun, false);
});

test("Flash Lane voice workbench can generate a local candidate under test/output", async () => {
  const outputRoot = path.join(process.cwd(), "test", "output", "tmp-voice-workbench");
  fs.rmSync(outputRoot, { recursive: true, force: true });
  let requestedUrl = "";
  let requestedBody = null;

  const result = await generateLocalVoiceCandidate({
    story: story(),
    outputRoot,
    applyLocal: true,
    engine: "chatterbox",
    rate: 1.7,
    voiceId: "loaded-pulse-voice",
    fetchImpl: async (url, request = {}) => {
      requestedUrl = url;
      requestedBody = JSON.parse(request.body);
      return {
        ok: true,
        json: async () => ({
          audio_base64: Buffer.from("fake mp3 bytes").toString("base64"),
          alignment: {
            characters: Array.from(
              "Take-Two call. Follow Pulse Gaming so you never miss a beat.",
            ),
            character_start_times_seconds: [],
            character_end_times_seconds: [],
          },
        }),
      };
    },
    durationProbe: () => 68.2,
    acousticProbe: () => ({
      medianPitchHz: 118,
      integratedLufs: -18,
      truePeakDb: -1.4,
      silenceRatio: 0.01,
      clippingRatio: 0,
    }),
  });

  assert.equal(result.status, "generated");
  assert.equal(result.candidate.provider, "local");
  assert.equal(result.candidate.source, "local-production-chatterbox-path");
  assert.equal(result.candidate.durationS, 68.2);
  assert.match(result.candidate.transcript, /Follow Pulse Gaming/);
  assert.match(requestedUrl, /loaded-pulse-voice/);
  assert.match(requestedBody.text, /Follow Pulse Gaming so you never miss a beat\.$/);
  assert.equal(fs.existsSync(result.candidate.path), true);
});

test("Flash Lane voice workbench can keep raw local audio and evaluate a normalised file", async () => {
  const outputRoot = path.join(process.cwd(), "test", "output", "tmp-voice-workbench-normalised");
  fs.rmSync(outputRoot, { recursive: true, force: true });

  const result = await generateLocalVoiceCandidate({
    story: story(),
    outputRoot,
    applyLocal: true,
    engine: "voxcpm2",
    rate: 1.9,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        audio_base64: Buffer.from("raw mp3 bytes").toString("base64"),
        alignment: { characters: Array.from("Follow Pulse Gaming so you never miss a beat.") },
      }),
    }),
    postProcessAudio: async ({ inputPath, outputPath }) => {
      assert.match(inputPath, /_raw\.mp3$/);
      await fs.promises.copyFile(inputPath, outputPath);
      return { applied: true, filter: "test-normalise" };
    },
    durationProbe: (file) => {
      assert.equal(file.endsWith(".mp3"), true);
      assert.equal(file.includes("_raw"), false);
      return 64.2;
    },
    acousticProbe: () => ({
      medianPitchHz: 118,
      integratedLufs: -16,
      truePeakDb: -1.5,
      silenceRatio: 0.01,
      clippingRatio: 0,
    }),
  });

  assert.equal(result.status, "generated");
  assert.equal(result.candidate.generation.audio_post_process.applied, true);
  assert.equal(result.candidate.generation.audio_post_process.filter, "test-normalise");
  assert.equal(fs.existsSync(result.candidate.generation.raw_path), true);
  assert.equal(fs.existsSync(result.candidate.path), true);
});

test("Flash Lane voice workbench refuses local generation outside test/output", async () => {
  await assert.rejects(
    () =>
      generateLocalVoiceCandidate({
        story: story(),
        outputRoot: path.join(process.cwd(), "tmp-voice-outside"),
        applyLocal: true,
        fetchImpl: async () => {
          throw new Error("should not call fetch");
        },
      }),
    /voice workbench output must stay under test\/output/i,
  );
});

test("Flash Lane voice workbench defaults local generation to the channel brand voice", async () => {
  const brand = require("../../brand");
  const outputRoot = path.join(process.cwd(), "test", "output", "tmp-voice-workbench-brand");
  fs.rmSync(outputRoot, { recursive: true, force: true });
  const oldVoice = process.env.ELEVENLABS_VOICE_ID;
  delete process.env.ELEVENLABS_VOICE_ID;
  let requestedUrl = "";

  try {
    await generateLocalVoiceCandidate({
      story: story(),
      outputRoot,
      applyLocal: true,
      fetchImpl: async (url) => {
        requestedUrl = url;
        return {
          ok: true,
          json: async () => ({
            audio_base64: Buffer.from("fake mp3 bytes").toString("base64"),
            alignment: { characters: Array.from("Follow Pulse Gaming so you never miss a beat.") },
          }),
        };
      },
      durationProbe: () => 68,
      acousticProbe: () => null,
    });
  } finally {
    if (oldVoice === undefined) delete process.env.ELEVENLABS_VOICE_ID;
    else process.env.ELEVENLABS_VOICE_ID = oldVoice;
  }

  assert.match(requestedUrl, new RegExp(encodeURIComponent(brand.voiceId)));
});
