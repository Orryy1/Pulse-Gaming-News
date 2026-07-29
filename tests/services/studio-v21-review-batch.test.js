"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildStudioV21ChildEnv,
  defaultPathsForStory,
  finaliseStudioV21Candidate,
  selectStudioV21Candidates,
  buildReviewHoldUpdate,
  runStudioV21ReviewBatch,
  validateStudioV21RenderInputs,
} = require("../../lib/studio/v2/studio-v21-review-batch");
const {
  resolvePreapprovedStudioVoice,
  resolveStudioV2OutputPaths,
} = require("../../tools/studio-v2-render");

function story(id, overrides = {}) {
  return {
    id,
    title: id,
    approved: true,
    exported_path: `output/final/${id}.mp4`,
    audio_path: `output/audio/${id}.mp3`,
    ...overrides,
  };
}

async function acceptRenderInputs(candidate) {
  return {
    provider: "elevenlabs",
    audioPath: `C:/media/${candidate.id}.mp3`,
    timestampsPath: `C:/media/${candidate.id}_timestamps.json`,
    durationGate: { result: "pass" },
    wordTimestampEvidence: { character_count: 10 },
  };
}

test("defaultPathsForStory: isolates production work evidence and final media from disposable test output", () => {
  const paths = defaultPathsForStory("rss/story 1");
  assert.equal(paths.workRoot, "output/studio-v21/rss_story_1");
  assert.equal(
    paths.renderedCandidatePath,
    "output/studio-v21/rss_story_1/studio_v2_rss_story_1_v21.mp4",
  );
  assert.equal(
    paths.reportPath,
    "output/studio-v21/rss_story_1/rss_story_1_studio_v2_v21_report.json",
  );
  assert.equal(
    paths.gatePath,
    "output/studio-v21/rss_story_1/rss_story_1_studio_v21_gate.json",
  );
  assert.equal(
    paths.candidatePath,
    "output/final/rss_story_1_studio-v21.mp4",
  );
  for (const value of Object.values(paths)) {
    assert.doesNotMatch(String(value), /(^|\/)test\/output(\/|$)/);
  }
});

test("buildStudioV21ChildEnv: forces pre-approved narration, production work root and no voice fallback", () => {
  const paths = defaultPathsForStory("child-env");
  const child = buildStudioV21ChildEnv(
    {
      STUDIO_V2_ALLOW_VOICE_FALLBACK: "true",
      STUDIO_V2_FORCE_TTS: "true",
    },
    paths,
    {
      audioPath: "C:/media/child-env.mp3",
      timestampsPath: "C:/media/child-env_timestamps.json",
    },
  );

  assert.equal(child.RENDER_ENGINE, "studio-v21");
  assert.equal(child.STUDIO_V2_VOICE, "preapproved");
  assert.equal(child.STUDIO_V2_ALLOW_VOICE_FALLBACK, "false");
  assert.equal(child.STUDIO_V2_FORCE_TTS, "false");
  assert.equal(child.STUDIO_V2_PREAPPROVED_AUDIO_PATH, "C:/media/child-env.mp3");
  assert.equal(
    child.STUDIO_V2_PREAPPROVED_TIMESTAMPS_PATH,
    "C:/media/child-env_timestamps.json",
  );
  assert.equal(child.STUDIO_V2_OUTPUT_STEM, "child-env");
  assert.match(
    child.STUDIO_V2_OUTPUT_DIR.replace(/\\/g, "/"),
    /\/output\/studio-v21\/child-env$/,
  );
  assert.equal(child.STUDIO_V21_REQUIRE_CANONICAL, "false");
});

test("Studio v2 render resolves explicit work-root paths without changing its local CLI default", () => {
  const production = resolveStudioV2OutputPaths({
    root: "C:/repo",
    storyId: "rss/original",
    env: {
      STUDIO_V2_OUTPUT_DIR: "C:/repo/output/studio-v21/rss_original",
      STUDIO_V2_OUTPUT_STEM: "rss_original",
      STUDIO_V2_OUTPUT_SUFFIX: "_v21",
    },
  });
  assert.equal(
    production.outputPath.replace(/\\/g, "/"),
    "C:/repo/output/studio-v21/rss_original/studio_v2_rss_original_v21.mp4",
  );
  assert.equal(
    production.reportPath.replace(/\\/g, "/"),
    "C:/repo/output/studio-v21/rss_original/rss_original_studio_v2_v21_report.json",
  );

  const local = resolveStudioV2OutputPaths({
    root: "C:/repo",
    storyId: "local-story",
    env: {},
  });
  assert.match(local.outputPath.replace(/\\/g, "/"), /\/test\/output\//);
});

test("Studio v2 preapproved voice mode consumes exact narration files and cannot fall back or generate", () => {
  const voice = resolvePreapprovedStudioVoice({
    STUDIO_V2_VOICE: "preapproved",
    STUDIO_V2_PREAPPROVED_AUDIO_PATH: "C:/media/approved.mp3",
    STUDIO_V2_PREAPPROVED_TIMESTAMPS_PATH:
      "C:/media/approved_timestamps.json",
  });
  assert.deepEqual(voice, {
    provider: "elevenlabs",
    source: "governed-preapproved-elevenlabs",
    audioPath: "C:/media/approved.mp3",
    timestampsPath: "C:/media/approved_timestamps.json",
    editorialScriptAppliedToAudio: true,
    preapproved: true,
  });
  assert.throws(
    () =>
      resolvePreapprovedStudioVoice({
        STUDIO_V2_VOICE: "preapproved",
        STUDIO_V2_PREAPPROVED_AUDIO_PATH: "C:/media/approved.mp3",
      }),
    /preapproved_timestamps_path_required/,
  );
});

test("Studio v2 gauntlet and rejection-gate CLIs consume the explicit work root", () => {
  for (const file of [
    "tools/studio-v2-gauntlet.js",
    "tools/studio-v21-gate.js",
  ]) {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "..", file),
      "utf8",
    );
    assert.match(source, /STUDIO_V2_OUTPUT_DIR/);
    assert.match(source, /outputDir/);
  }
  const gateSource = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v21-gate.js"),
    "utf8",
  );
  assert.match(gateSource, /STUDIO_V21_REQUIRE_CANONICAL/);
});

test("Studio v2 production render and loudness pass explicitly encode AAC at 48 kHz", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v2-render.js"),
    "utf8",
  );
  const sampleRateFlags = source.match(/-ar 48000/g) || [];
  assert.ok(
    sampleRateFlags.length >= 2,
    "both the primary encode and optional loudness pass must retain 48 kHz audio",
  );
});

test("validateStudioV21RenderInputs: binds existing ElevenLabs narration and its deterministic timestamp companion", async () => {
  const reads = [];
  const result = await validateStudioV21RenderInputs(
    story("audio-ready", {
      audio_duration_gate: { result: "pass" },
    }),
    {
      env: { TTS_PROVIDER: "elevenlabs" },
      async resolveExisting(mediaPath) {
        return `C:/media/${mediaPath.replace(/\\/g, "/")}`;
      },
      fs: {
        async pathExists() {
          return true;
        },
        async readJson(filePath) {
          reads.push(filePath);
          return {
            characters: ["H", "i"],
            character_start_times_seconds: [0, 0.1],
            character_end_times_seconds: [0.1, 0.2],
          };
        },
      },
    },
  );

  assert.equal(result.provider, "elevenlabs");
  assert.match(result.audioPath, /audio-ready\.mp3$/);
  assert.match(result.timestampsPath, /audio-ready_timestamps\.json$/);
  assert.deepEqual(reads, [result.timestampsPath]);
  assert.equal(result.wordTimestampEvidence.character_count, 2);
});

test("validateStudioV21RenderInputs: refuses a local narration provider in the standard batch", async () => {
  await assert.rejects(
    validateStudioV21RenderInputs(
      story("local-audio", {
        audio_duration_gate: { result: "pass" },
      }),
      {
        env: { TTS_PROVIDER: "local" },
        async resolveExisting(mediaPath) {
          return mediaPath;
        },
        fs: {
          async pathExists() {
            return true;
          },
          async readJson() {
            return {
              characters: ["A"],
              character_start_times_seconds: [0],
              character_end_times_seconds: [0.2],
            };
          },
        },
      },
    ),
    (err) => {
      assert.equal(err.code, "STANDARD_RENDER_INPUTS_INVALID");
      assert.ok(
        err.blockers.includes(
          "approved_elevenlabs_narration_required:local",
        ),
      );
      return true;
    },
  );
});

test("validateStudioV21RenderInputs: missing audio, duration approval or complete timestamps hard-fail", async () => {
  const missingFiles = {
    async pathExists() {
      return false;
    },
    async readJson() {
      return null;
    },
  };
  await assert.rejects(
    validateStudioV21RenderInputs(
      story("missing-narration", {
        audio_path: null,
        audio_duration_gate: null,
      }),
      { env: {}, fs: missingFiles },
    ),
    (err) => {
      assert.ok(err.blockers.includes("narration_audio_path_missing"));
      assert.ok(err.blockers.includes("narration_duration_gate_not_passed"));
      assert.ok(err.blockers.includes("narration_timestamps_path_missing"));
      return true;
    },
  );

  await assert.rejects(
    validateStudioV21RenderInputs(
      story("broken-alignment", {
        audio_duration_gate: { eligible: true },
      }),
      {
        env: {},
        async resolveExisting(mediaPath) {
          return mediaPath;
        },
        fs: {
          async pathExists() {
            return true;
          },
          async readJson() {
            return {
              characters: ["H", "i"],
              character_start_times_seconds: [0],
              character_end_times_seconds: [0.1, 0.2],
            };
          },
        },
      },
    ),
    (err) => {
      assert.ok(err.blockers.includes("narration_word_timestamps_incomplete"));
      return true;
    },
  );
});

test("finaliseStudioV21Candidate: requires work evidence, atomically promotes the MP4 and binds matching hash/FFprobe proof", async () => {
  const paths = defaultPathsForStory("render-proof");
  const actions = [];
  const hash = "a".repeat(64);
  const result = await finaliseStudioV21Candidate(paths, {
    fs: {
      async pathExists() {
        return true;
      },
      async ensureDir(dir) {
        actions.push(`mkdir:${dir.replace(/\\/g, "/")}`);
      },
      async copy(source, target) {
        actions.push(
          `copy:${source.replace(/\\/g, "/")}->${target.replace(/\\/g, "/")}`,
        );
      },
      async move(source, target) {
        actions.push(
          `move:${source.replace(/\\/g, "/")}->${target.replace(/\\/g, "/")}`,
        );
      },
    },
    async sha256File() {
      return hash;
    },
    async runPlatformVideoQa() {
      return {
        result: "pass",
        failures: [],
        warnings: [],
        technical: {
          video_codec: "h264",
          width: 1080,
          height: 1920,
          audio_codec: "aac",
          audio_sample_rate_hz: 48000,
          has_audio: true,
          duration_seconds: 31,
          ffprobe_passed: true,
        },
      };
    },
  });

  assert.equal(result.candidatePath, paths.candidatePath);
  assert.equal(result.sha256, hash);
  assert.equal(result.reportSha256, hash);
  assert.equal(result.gateSha256, hash);
  assert.equal(result.gauntletSha256, hash);
  assert.equal(result.ffprobe.width, 1080);
  assert.equal(actions.filter((action) => action.startsWith("copy:")).length, 1);
  assert.equal(actions.filter((action) => action.startsWith("move:")).length, 1);
});

test("finaliseStudioV21Candidate: missing reports or non-flagship FFprobe evidence cannot be promoted", async () => {
  const paths = defaultPathsForStory("blocked-proof");
  await assert.rejects(
    finaliseStudioV21Candidate(paths, {
      fs: {
        async pathExists(filePath) {
          return !String(filePath).endsWith("_report.json");
        },
      },
    }),
    (err) => {
      assert.equal(err.code, "STANDARD_RENDER_EVIDENCE_INVALID");
      assert.ok(err.blockers.includes("render_report_missing"));
      return true;
    },
  );

  await assert.rejects(
    finaliseStudioV21Candidate(paths, {
      fs: {
        async pathExists(filePath) {
          return !String(filePath).endsWith("studio_v2_gauntlet_report.json");
        },
      },
    }),
    (err) => {
      assert.equal(err.code, "STANDARD_RENDER_EVIDENCE_INVALID");
      assert.ok(err.blockers.includes("render_gauntlet_report_missing"));
      return true;
    },
  );

  await assert.rejects(
    finaliseStudioV21Candidate(paths, {
      fs: {
        async pathExists() {
          return true;
        },
      },
      async sha256File() {
        return "b".repeat(64);
      },
      async runPlatformVideoQa() {
        return {
          result: "warn",
          technical: {
            video_codec: "h264",
            width: 720,
            height: 1280,
            audio_codec: "aac",
            audio_sample_rate_hz: 44100,
            has_audio: true,
            duration_seconds: 31,
            ffprobe_passed: true,
          },
        };
      },
    }),
    (err) => {
      assert.ok(err.blockers.includes("platform_video_qa_must_pass"));
      assert.ok(err.blockers.includes("video_dimensions_must_be_1080x1920"));
      assert.ok(err.blockers.includes("audio_sample_rate_must_be_48000"));
      return true;
    },
  );
});

test("selectStudioV21Candidates: chooses approved unpublished stories so missing render inputs fail loudly", () => {
  const selected = selectStudioV21Candidates(
    [
      story("ready-a"),
      story("ready-without-legacy-output", { exported_path: null }),
      story("partially-published", {
        youtube_post_id: "yt",
        instagram_media_id: "ig",
      }),
      story("unapproved", { approved: false }),
      story("no-audio", { audio_path: null }),
      story("qa-failed", { qa_failed: true }),
      story("already-approved", {
        render_engine: "studio-v21",
        render_review_status: "approved",
      }),
      story("ready-c"),
    ],
    { limit: 3 },
  );
  assert.deepEqual(
    selected.map((s) => s.id),
    ["ready-a", "ready-without-legacy-output", "no-audio"],
  );
});

test("selectStudioV21Candidates: re-renders a reviewed standard story when its primary artefact was cleared", () => {
  const selected = selectStudioV21Candidates([
    story("stale-standard", {
      exported_path: null,
      render_engine: "studio-v21",
      render_review_status: "approved",
    }),
  ]);
  assert.deepEqual(selected.map((item) => item.id), ["stale-standard"]);
});

test("buildReviewHoldUpdate: makes the governed Studio v2.1 render primary and preserves legacy only as migration evidence", () => {
  const paths = defaultPathsForStory("candidate");
  const update = buildReviewHoldUpdate(story("candidate"), {
    ...paths,
    gateVerdict: "pass",
    sha256: "c".repeat(64),
    reportSha256: "d".repeat(64),
    gateSha256: "e".repeat(64),
    gauntletSha256: "f".repeat(64),
    platformVideoQaResult: "pass",
    ffprobe: {
      width: 1080,
      height: 1920,
      video_codec: "h264",
      audio_codec: "aac",
      audio_sample_rate_hz: 48000,
      has_audio: true,
      duration_seconds: 31,
      ffprobe_passed: true,
    },
  });
  assert.equal(update.exported_path, paths.candidatePath);
  assert.equal(
    update.migration_legacy_exported_path,
    "output/final/candidate.mp4",
  );
  assert.equal(update.render_engine, "studio-v21");
  assert.equal(update.studio_v21_candidate_path, paths.candidatePath);
  assert.equal(
    update.studio_v21_work_candidate_path,
    paths.renderedCandidatePath,
  );
  assert.equal(update.studio_v21_output_sha256, "c".repeat(64));
  assert.equal(update.studio_v21_report_sha256, "d".repeat(64));
  assert.equal(update.studio_v21_gate_sha256, "e".repeat(64));
  assert.equal(update.studio_v21_gauntlet_sha256, "f".repeat(64));
  assert.equal(update.studio_v21_gauntlet_path, paths.gauntletPath);
  assert.equal(update.studio_v21_platform_video_qa_result, "pass");
  assert.equal(update.studio_v21_ffprobe.width, 1080);
  assert.equal(update.human_visual_review_required, true);
  assert.equal(update.render_review_status, "pending");
  assert.equal(update.publish_hold_reason, "studio_v21_human_visual_review_required");
});

test("publisher produce path uses Studio v2.1 as its fatal primary renderer and never invokes the legacy assembler", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "publisher.js"),
    "utf8",
  );
  const produceStart = src.indexOf("async function produce()");
  const produceEnd = src.indexOf(
    "async function logFormatRecommendationsForApprovedStories",
  );
  const produceSource = src.slice(produceStart, produceEnd);
  assert.ok(produceStart >= 0 && produceEnd > produceStart);
  assert.match(produceSource, /await runStudioV21ReviewBatch\(\{/);
  assert.doesNotMatch(produceSource, /require\(["']\.\/assemble["']\)/);
  assert.doesNotMatch(produceSource, /\bawait assemble\(\)/);
  assert.doesNotMatch(produceSource, /review batch errored \(non-fatal\)/);
  assert.doesNotMatch(
    produceSource,
    /\bawait logFormatRecommendationsForApprovedStories\(\)/,
  );
});

test("runStudioV21ReviewBatch: isolates each candidate through render, gauntlet, gate and promotion", async () => {
  const calls = [];
  const updates = [];
  const db = {
    async getStories() {
      return [story("a"), story("b")];
    },
    async upsertStory(update) {
      updates.push(update);
    },
  };

  const result = await runStudioV21ReviewBatch({
    db,
    env: { RENDER_ENGINE: "studio-v21" },
    limit: 2,
    async validateInputs(candidate) {
      calls.push(`inputs:${candidate.id}`);
      return {
        provider: "elevenlabs",
        audioPath: `C:/media/${candidate.id}.mp3`,
        timestampsPath: `C:/media/${candidate.id}_timestamps.json`,
      };
    },
    renderOne(storyId) {
      calls.push(`render:${storyId}`);
      return { status: 0 };
    },
    runGauntlet({ story: candidate }) {
      calls.push(`gauntlet:${candidate.id}`);
      return { status: 0 };
    },
    gateOne(storyId) {
      calls.push(`gate:${storyId}`);
      return { status: 0 };
    },
    async readGateReport() {
      return { verdict: "pass" };
    },
    async finaliseCandidate(paths) {
      calls.push(`finalise:${paths.outputStem}`);
      return {
        ...paths,
        sha256: "d".repeat(64),
        platformVideoQaResult: "pass",
        ffprobe: {
          width: 1080,
          height: 1920,
          video_codec: "h264",
          audio_codec: "aac",
          audio_sample_rate_hz: 48000,
          has_audio: true,
          duration_seconds: 31,
          ffprobe_passed: true,
        },
      };
    },
  });

  assert.deepEqual(calls, [
    "inputs:a",
    "render:a",
    "inputs:b",
    "render:b",
    "gauntlet:a",
    "gate:a",
    "finalise:a",
    "gauntlet:b",
    "gate:b",
    "finalise:b",
  ]);
  assert.deepEqual(result.candidates, ["a", "b"]);
  assert.equal(updates.length, 2);
  assert.ok(updates.every((u) => u.human_visual_review_required === true));
  assert.ok(updates.every((u) => u.exported_path.startsWith("output/final/")));
  assert.ok(updates.every((u) => u.studio_v21_output_sha256 === "d".repeat(64)));
});

test("runStudioV21ReviewBatch: standard render failures reject the production batch", async () => {
  const db = {
    async getStories() {
      return [story("broken-render", { exported_path: null })];
    },
    async upsertStory() {
      assert.fail("failed render must not be persisted as a candidate");
    },
  };

  await assert.rejects(
    runStudioV21ReviewBatch({
      db,
      env: { RENDER_ENGINE: "studio-v21" },
      validateInputs: acceptRenderInputs,
      renderOne() {
        return { status: 9 };
      },
    }),
    (err) => {
      assert.equal(err.code, "STANDARD_RENDER_FAILED");
      assert.equal(err.stage, "render");
      assert.equal(err.storyId, "broken-render");
      return true;
    },
  );
});

test("runStudioV21ReviewBatch: gauntlet failures reject every rendered candidate", async () => {
  await assert.rejects(
    runStudioV21ReviewBatch({
      stories: [
        story("gauntlet-a", { exported_path: null }),
        story("gauntlet-b", { exported_path: null }),
      ],
      db: { async upsertStory() {} },
      env: { RENDER_ENGINE: "studio-v21" },
      validateInputs: acceptRenderInputs,
      renderOne() {
        return { status: 0 };
      },
      runGauntlet() {
        return { status: 4 };
      },
    }),
    (err) => {
      assert.equal(err.code, "STANDARD_RENDER_GAUNTLET_FAILED");
      assert.equal(err.stage, "gauntlet");
      assert.equal(err.storyId, "gauntlet-a");
      return true;
    },
  );
});

test("runStudioV21ReviewBatch: automatic gate command failures reject the candidate", async () => {
  await assert.rejects(
    runStudioV21ReviewBatch({
      stories: [story("gate-failure", { exported_path: null })],
      db: { async upsertStory() {} },
      env: { RENDER_ENGINE: "studio-v21" },
      validateInputs: acceptRenderInputs,
      renderOne() {
        return { status: 0 };
      },
      runGauntlet() {
        return { status: 0 };
      },
      gateOne() {
        return { status: 7 };
      },
    }),
    (err) => {
      assert.equal(err.code, "STANDARD_RENDER_GATE_FAILED");
      assert.equal(err.stage, "gate");
      assert.equal(err.storyId, "gate-failure");
      return true;
    },
  );
});

test("runStudioV21ReviewBatch: a missing or rejected gate verdict fails closed", async () => {
  for (const gateReport of [null, { verdict: "reject" }]) {
    await assert.rejects(
      runStudioV21ReviewBatch({
        stories: [story("rejected-verdict", { exported_path: null })],
        db: { async upsertStory() {} },
        env: { RENDER_ENGINE: "studio-v21" },
        validateInputs: acceptRenderInputs,
        renderOne() {
          return { status: 0 };
        },
        runGauntlet() {
          return { status: 0 };
        },
        gateOne() {
          return { status: 0 };
        },
        async readGateReport() {
          return gateReport;
        },
      }),
      (err) => {
        assert.equal(err.code, "STANDARD_RENDER_GATE_VERDICT_FAILED");
        assert.equal(err.stage, "gate-verdict");
        assert.equal(err.storyId, "rejected-verdict");
        return true;
      },
    );
  }
});

test("runStudioV21ReviewBatch: render evidence failure occurs before any DB update", async () => {
  let updateCount = 0;
  await assert.rejects(
    runStudioV21ReviewBatch({
      stories: [story("invalid-evidence", { exported_path: null })],
      db: {
        async upsertStory() {
          updateCount += 1;
        },
      },
      env: { RENDER_ENGINE: "studio-v21" },
      validateInputs: acceptRenderInputs,
      renderOne() {
        return { status: 0 };
      },
      runGauntlet() {
        return { status: 0 };
      },
      gateOne() {
        return { status: 0 };
      },
      async readGateReport() {
        return { verdict: "pass" };
      },
      async finaliseCandidate() {
        const err = new Error("missing exact MP4 evidence");
        err.code = "STANDARD_RENDER_EVIDENCE_INVALID";
        throw err;
      },
    }),
    (err) => err.code === "STANDARD_RENDER_EVIDENCE_INVALID",
  );
  assert.equal(updateCount, 0);
});

test("runStudioV21ReviewBatch: refuses migration, experimental and unknown renderer identities", async () => {
  for (const renderer of ["legacy", "hyperframes-next", "invented"]) {
    await assert.rejects(
      runStudioV21ReviewBatch({
        stories: [],
        db: {},
        env: { RENDER_ENGINE: renderer },
      }),
      (err) => {
        assert.equal(err.code, "STANDARD_RENDERER_REQUIRED");
        assert.equal(err.requestedRenderer, renderer);
        return true;
      },
    );
  }
});
