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
  scriptForGovernedNarration,
} = require("../../lib/studio/v2/flash-lane-voice-workbench");
const {
  CTA_POLICY,
} = require("../../lib/services/pulse-editorial-contract");

const FLASH_SCRIPT =
  "Xbox has added achievement support to selected original Xbox games in backwards compatibility. " +
  "That changes old catalogue releases from simple nostalgia plays into trackable games with modern profile progress. " +
  "Microsoft has not confirmed every title yet, so the affected list still matters. " +
  "For players, the practical change is clear: returning classics can now contribute achievements alongside newer Game Pass releases.";

function story(overrides = {}) {
  return {
    id: "voice-story",
    title: "Xbox adds achievements to backwards-compatible games",
    hook: "Xbox has added achievement support to selected original Xbox games.",
    hook_type: "direct",
    editorial_lane_id: "what_changes_for_players",
    duration_band_id: "what_changes_standard_35_42",
    cta: "",
    cta_policy: {
      policy_version: CTA_POLICY.version,
      scope: "shorts",
      include_cta: false,
      copy_strategy: "none",
      cohort_bucket: 1,
      cohort_numerator: 1,
      cohort_denominator: 3,
      audit_hash: `sha256:${"b".repeat(64)}`,
    },
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
    durationS: 40,
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

test("Flash Lane voice workbench rejects out-of-band demonic local narration", () => {
  const result = evaluateVoiceCandidate({
    story: story(),
    candidate: candidate({
      id: "slow-local",
      provider: "local",
      source: "local-production-voxcpm-path",
      durationS: 50,
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
  assert.ok(
    result.blockers.includes("audio_duration_above_selected_band"),
  );
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

test("Flash Lane voice workbench approves an omitted-CTA narration without an outro", () => {
  const result = evaluateVoiceCandidate({
    story: story(),
    candidate: candidate({ id: "no-cta-outro" }),
  });

  assert.equal(result.verdict, "approved_for_flash_lane_preflight");
  assert.equal(result.transcript.cta_policy_verified, true);
  assert.equal(result.transcript.contextual_cta_present, false);
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

test("Flash Lane voice workbench accepts calibrated narration inside its selected band", () => {
  const result = evaluateVoiceCandidate({
    story: story(),
    candidate: candidate({
      id: "calibrated-selected-band",
      durationS: 41.5,
    }),
  });

  assert.equal(result.verdict, "approved_for_flash_lane_preflight");
  assert.equal(
    result.blockers.includes("audio_duration_above_selected_band"),
    false,
  );
  assert.equal(
    result.blockers.includes("audio_duration_below_selected_band"),
    false,
  );
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

test("Flash Lane voice workbench preserves governed narration without appending copy", () => {
  const text = scriptForGovernedNarration(FLASH_SCRIPT, story());

  assert.equal(text, FLASH_SCRIPT);
});

test("Flash Lane voice workbench markdown is readable and safety-explicit", () => {
  const report = buildFlashLaneVoiceWorkbench({
    story: story(),
    candidates: [
      candidate({ id: "reject", durationS: 50 }),
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
            characters: Array.from(FLASH_SCRIPT),
            character_start_times_seconds: [],
            character_end_times_seconds: [],
          },
        }),
      };
    },
    durationProbe: () => 40.5,
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
  assert.equal(result.candidate.durationS, 40.5);
  assert.equal(result.candidate.transcript, FLASH_SCRIPT);
  assert.match(requestedUrl, /loaded-pulse-voice/);
  assert.match(requestedBody.text, /^Xbox has added achievement support/);
  assert.doesNotMatch(requestedBody.text, /\bfollow\b|\bsubscribe\b/i);
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
        alignment: { characters: Array.from(FLASH_SCRIPT) },
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
      return 40.2;
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
            alignment: { characters: Array.from(FLASH_SCRIPT) },
          }),
        };
      },
      durationProbe: () => 40,
      acousticProbe: () => null,
    });
  } finally {
    if (oldVoice === undefined) delete process.env.ELEVENLABS_VOICE_ID;
    else process.env.ELEVENLABS_VOICE_ID = oldVoice;
  }

  assert.match(requestedUrl, new RegExp(encodeURIComponent(brand.voiceId)));
});
