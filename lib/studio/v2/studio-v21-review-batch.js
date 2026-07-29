"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  resolveRenderEngine,
  buildStudioV21ReviewMetadata,
} = require("../../render-engine-switch");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const PRODUCTION_WORK_ROOT = path.join(ROOT, "output", "studio-v21");
const PRODUCTION_FINAL_ROOT = path.join(ROOT, "output", "final");

function truthy(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value || ""));
}

function platformCount(story) {
  return [
    story.youtube_post_id,
    story.tiktok_post_id,
    story.instagram_media_id,
    story.facebook_post_id,
    story.twitter_post_id,
  ].filter(Boolean).length;
}

function selectStudioV21Candidates(stories, opts = {}) {
  const limit = Math.max(1, Math.min(Number(opts.limit) || 5, 5));
  return (stories || [])
    .filter((story) => {
      if (!story || typeof story !== "object") return false;
      if (!(story.approved === true || story.approved === 1)) return false;
      if (story.qa_failed === true || story.publish_status === "failed") {
        return false;
      }
      if (story.render_engine === "studio-v21") {
        const status = String(story.render_review_status || "").toLowerCase();
        if (
          story.exported_path &&
          (status === "approved" || status === "pending")
        ) {
          return false;
        }
      }
      return platformCount(story) === 0;
    })
    .slice(0, limit);
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, "/");
}

function safeStoryStem(storyId) {
  const stem = String(storyId || "")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/^_+|_+$/g, "");
  if (!stem) throw new Error("studio_v21_story_id_required");
  return stem;
}

function defaultPathsForStory(storyId) {
  const stem = safeStoryStem(storyId);
  const workRoot = path.join(PRODUCTION_WORK_ROOT, stem);
  return {
    workRoot: rel(workRoot),
    renderedCandidatePath: rel(
      path.join(workRoot, `studio_v2_${stem}_v21.mp4`),
    ),
    reportPath: rel(
      path.join(workRoot, `${stem}_studio_v2_v21_report.json`),
    ),
    gatePath: rel(path.join(workRoot, `${stem}_studio_v21_gate.json`)),
    gauntletPath: rel(path.join(workRoot, "studio_v2_gauntlet_report.json")),
    candidatePath: rel(
      path.join(PRODUCTION_FINAL_ROOT, `${stem}_studio-v21.mp4`),
    ),
    outputStem: stem,
  };
}

function timestampCompanionPath(audioPath) {
  const value = String(audioPath || "").trim();
  if (!value) return null;
  return /\.[^./\\]+$/.test(value)
    ? value.replace(/\.[^./\\]+$/, "_timestamps.json")
    : `${value}_timestamps.json`;
}

async function validateStudioV21RenderInputs(story, options = {}) {
  const fs = options.fs || require("fs-extra");
  const resolveExisting =
    options.resolveExisting ||
    ((mediaPath) => require("../../media-paths").resolveExisting(mediaPath, { fs }));
  const env = options.env || process.env;
  const blockers = [];
  const provider = String(env.TTS_PROVIDER || "elevenlabs")
    .trim()
    .toLowerCase();
  const storedAudioPath = String(story?.audio_path || "").trim();
  const storedTimestampsPath = timestampCompanionPath(storedAudioPath);

  if (provider !== "elevenlabs") {
    blockers.push(`approved_elevenlabs_narration_required:${provider || "missing"}`);
  }
  if (!storedAudioPath) blockers.push("narration_audio_path_missing");
  const durationGate = story?.audio_duration_gate;
  if (
    durationGate?.result !== "pass" &&
    durationGate?.eligible !== true
  ) {
    blockers.push("narration_duration_gate_not_passed");
  }

  let audioPath = null;
  let timestampsPath = null;
  if (storedAudioPath) {
    audioPath = await resolveExisting(storedAudioPath).catch(() => null);
    if (!audioPath || !(await fs.pathExists(audioPath))) {
      blockers.push("narration_audio_file_missing");
    }
  }
  if (storedTimestampsPath) {
    timestampsPath = await resolveExisting(storedTimestampsPath).catch(
      () => null,
    );
    if (!timestampsPath || !(await fs.pathExists(timestampsPath))) {
      blockers.push("narration_timestamps_file_missing");
    }
  } else {
    blockers.push("narration_timestamps_path_missing");
  }

  let timestampJson = null;
  if (timestampsPath && !blockers.includes("narration_timestamps_file_missing")) {
    try {
      timestampJson = await fs.readJson(timestampsPath);
    } catch {
      blockers.push("narration_timestamps_json_invalid");
    }
  }
  const alignment = timestampJson?.alignment || timestampJson;
  const characters = Array.isArray(alignment?.characters)
    ? alignment.characters
    : [];
  const starts = Array.isArray(alignment?.character_start_times_seconds)
    ? alignment.character_start_times_seconds
    : [];
  const ends = Array.isArray(alignment?.character_end_times_seconds)
    ? alignment.character_end_times_seconds
    : [];
  if (
    timestampJson &&
    (characters.length === 0 ||
      starts.length !== characters.length ||
      ends.length !== characters.length)
  ) {
    blockers.push("narration_word_timestamps_incomplete");
  }

  if (blockers.length > 0) {
    const err = new Error(
      `Studio v2.1 narration preflight failed: ${[...new Set(blockers)].join(", ")}`,
    );
    err.code = "STANDARD_RENDER_INPUTS_INVALID";
    err.storyId = story?.id || null;
    err.blockers = [...new Set(blockers)];
    throw err;
  }

  return {
    provider,
    audioPath,
    timestampsPath,
    durationGate,
    wordTimestampEvidence: {
      character_count: characters.length,
      first_start_seconds: Number(starts[0]),
      last_end_seconds: Number(ends[ends.length - 1]),
    },
  };
}

function governedAbsolute(relativePath, expectedRoot, blocker) {
  const absolute = path.resolve(ROOT, String(relativePath || ""));
  const root = path.resolve(expectedRoot);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    const err = new Error(blocker);
    err.code = "STANDARD_RENDER_EVIDENCE_INVALID";
    err.blockers = [blocker];
    throw err;
  }
  return absolute;
}

function technicalEvidenceBlockers(qa) {
  const technical = qa?.technical || {};
  const blockers = [];
  if (qa?.result !== "pass") blockers.push("platform_video_qa_must_pass");
  if (technical.ffprobe_passed !== true) blockers.push("ffprobe_evidence_missing");
  if (technical.video_codec !== "h264") blockers.push("video_codec_must_be_h264");
  if (Number(technical.width) !== 1080 || Number(technical.height) !== 1920) {
    blockers.push("video_dimensions_must_be_1080x1920");
  }
  if (technical.audio_codec !== "aac") blockers.push("audio_codec_must_be_aac");
  if (Number(technical.audio_sample_rate_hz) !== 48000) {
    blockers.push("audio_sample_rate_must_be_48000");
  }
  if (technical.has_audio !== true) blockers.push("audio_stream_required");
  if (!(Number(technical.duration_seconds) > 0)) {
    blockers.push("video_duration_evidence_missing");
  }
  return blockers;
}

async function finaliseStudioV21Candidate(paths, options = {}) {
  const fs = options.fs || require("fs-extra");
  const hashFile =
    options.sha256File ||
    require("../../services/publication-request-fingerprint").sha256File;
  const runVideoQa =
    options.runPlatformVideoQa ||
    require("../../services/platform-video-qa").runPlatformVideoQa;
  const renderedCandidate = governedAbsolute(
    paths.renderedCandidatePath,
    PRODUCTION_WORK_ROOT,
    "rendered_candidate_outside_production_work_root",
  );
  const reportPath = governedAbsolute(
    paths.reportPath,
    PRODUCTION_WORK_ROOT,
    "render_report_outside_production_work_root",
  );
  const gatePath = governedAbsolute(
    paths.gatePath,
    PRODUCTION_WORK_ROOT,
    "render_gate_outside_production_work_root",
  );
  const gauntletPath = governedAbsolute(
    paths.gauntletPath,
    PRODUCTION_WORK_ROOT,
    "render_gauntlet_outside_production_work_root",
  );
  const finalPath = governedAbsolute(
    paths.candidatePath,
    PRODUCTION_FINAL_ROOT,
    "final_candidate_outside_production_final_root",
  );
  const blockers = [];
  for (const [filePath, code] of [
    [renderedCandidate, "rendered_candidate_missing"],
    [reportPath, "render_report_missing"],
    [gatePath, "render_gate_missing"],
    [gauntletPath, "render_gauntlet_report_missing"],
  ]) {
    if (!(await fs.pathExists(filePath))) blockers.push(code);
  }

  let sourceSha256 = null;
  let reportSha256 = null;
  let gateSha256 = null;
  let gauntletSha256 = null;
  let sourceQa = null;
  if (blockers.length === 0) {
    sourceSha256 = await hashFile(renderedCandidate);
    if (!/^[a-f0-9]{64}$/i.test(String(sourceSha256 || ""))) {
      blockers.push("rendered_candidate_sha256_missing");
    }
    reportSha256 = await hashFile(reportPath);
    gateSha256 = await hashFile(gatePath);
    gauntletSha256 = await hashFile(gauntletPath);
    for (const [value, code] of [
      [reportSha256, "render_report_sha256_missing"],
      [gateSha256, "render_gate_sha256_missing"],
      [gauntletSha256, "render_gauntlet_sha256_missing"],
    ]) {
      if (!/^[a-f0-9]{64}$/i.test(String(value || ""))) {
        blockers.push(code);
      }
    }
    sourceQa = await runVideoQa(renderedCandidate, { fs });
    blockers.push(...technicalEvidenceBlockers(sourceQa));
  }
  if (blockers.length > 0) {
    const err = new Error(
      `Studio v2.1 render evidence failed: ${[...new Set(blockers)].join(", ")}`,
    );
    err.code = "STANDARD_RENDER_EVIDENCE_INVALID";
    err.blockers = [...new Set(blockers)];
    throw err;
  }

  await fs.ensureDir(path.dirname(finalPath));
  const temporaryFinalPath = `${finalPath}.partial-${process.pid}-${Date.now()}`;
  try {
    await fs.copy(renderedCandidate, temporaryFinalPath, { overwrite: true });
    await fs.move(temporaryFinalPath, finalPath, { overwrite: true });
  } finally {
    if (
      typeof fs.remove === "function" &&
      (await fs.pathExists(temporaryFinalPath))
    ) {
      await fs.remove(temporaryFinalPath);
    }
  }

  const finalBlockers = [];
  if (!(await fs.pathExists(finalPath))) finalBlockers.push("final_candidate_missing");
  const finalSha256 =
    finalBlockers.length === 0 ? await hashFile(finalPath) : null;
  if (finalSha256 !== sourceSha256) {
    finalBlockers.push("final_candidate_sha256_mismatch");
  }
  const finalQa =
    finalBlockers.length === 0 ? await runVideoQa(finalPath, { fs }) : null;
  if (finalQa) finalBlockers.push(...technicalEvidenceBlockers(finalQa));
  if (finalBlockers.length > 0) {
    const err = new Error(
      `Studio v2.1 final candidate failed: ${[...new Set(finalBlockers)].join(", ")}`,
    );
    err.code = "STANDARD_RENDER_EVIDENCE_INVALID";
    err.blockers = [...new Set(finalBlockers)];
    throw err;
  }

  return {
    candidatePath: paths.candidatePath,
    renderedCandidatePath: paths.renderedCandidatePath,
    reportPath: paths.reportPath,
    gatePath: paths.gatePath,
    gauntletPath: paths.gauntletPath,
    sha256: finalSha256,
    reportSha256,
    gateSha256,
    gauntletSha256,
    ffprobe: finalQa.technical,
    platformVideoQaResult: finalQa.result,
  };
}

function buildReviewHoldUpdate(story, metadata = {}) {
  const candidatePath = metadata.candidatePath || null;
  const legacyPath =
    story.exported_path && story.exported_path !== candidatePath
      ? story.exported_path
      : story.migration_legacy_exported_path || null;
  return {
    ...story,
    ...buildStudioV21ReviewMetadata(metadata),
    exported_path: candidatePath,
    migration_legacy_exported_path: legacyPath,
    studio_v21_work_candidate_path:
      metadata.renderedCandidatePath || null,
    studio_v21_output_sha256: metadata.sha256 || null,
    studio_v21_report_sha256: metadata.reportSha256 || null,
    studio_v21_gate_sha256: metadata.gateSha256 || null,
    studio_v21_gauntlet_path: metadata.gauntletPath || null,
    studio_v21_gauntlet_sha256: metadata.gauntletSha256 || null,
    studio_v21_platform_video_qa_result:
      metadata.platformVideoQaResult || null,
    studio_v21_ffprobe: metadata.ffprobe || null,
    studio_v21_narration_evidence: metadata.inputEvidence
      ? {
          provider: metadata.inputEvidence.provider,
          word_timestamp_evidence:
            metadata.inputEvidence.wordTimestampEvidence || null,
          duration_gate: metadata.inputEvidence.durationGate || null,
        }
      : null,
  };
}

function buildStudioV21ChildEnv(env, paths, inputEvidence) {
  const outputDir = governedAbsolute(
    paths.workRoot,
    PRODUCTION_WORK_ROOT,
    "child_output_outside_production_work_root",
  );
  return {
    ...process.env,
    ...(env || {}),
    RENDER_ENGINE: "studio-v21",
    STUDIO_V21_HERO: "true",
    STUDIO_V2_OUTPUT_SUFFIX: "_v21",
    STUDIO_V2_OUTPUT_DIR: outputDir,
    STUDIO_V2_OUTPUT_STEM: paths.outputStem,
    STUDIO_V2_SKIP_LLM: env?.STUDIO_V2_SKIP_LLM || "true",
    STUDIO_V2_VOICE: "preapproved",
    STUDIO_V2_PREAPPROVED_AUDIO_PATH: inputEvidence.audioPath,
    STUDIO_V2_PREAPPROVED_TIMESTAMPS_PATH: inputEvidence.timestampsPath,
    STUDIO_V2_ALLOW_VOICE_FALLBACK: "false",
    STUDIO_V2_FORCE_TTS: "false",
    STUDIO_V21_REQUIRE_CANONICAL: "false",
  };
}

function runNodeScript(script, args, env) {
  return spawnSync(process.execPath, [path.join(ROOT, script), ...args], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
}

function standardRenderError(code, stage, storyId, status) {
  const err = new Error(
    `Governed Studio v2.1 ${stage} failed${storyId ? ` for ${storyId}` : ""} (exit ${status})`,
  );
  err.code = code;
  err.stage = stage;
  err.storyId = storyId || null;
  err.status = status;
  return err;
}

async function runStudioV21ReviewBatch({
  db,
  stories,
  env = process.env,
  limit = 5,
  dryRun = false,
  logger = console,
  renderOne,
  runGauntlet,
  gateOne,
  readGateReport,
  validateInputs,
  finaliseCandidate,
} = {}) {
  const cfg = resolveRenderEngine(env);
  if (!cfg.useStudioV21) {
    const err = new Error(
      `Governed production requires studio-v21; requested ${cfg.requested}`,
    );
    err.code = "STANDARD_RENDERER_REQUIRED";
    err.requestedRenderer = cfg.requested;
    err.rendererReason = cfg.reason;
    throw err;
  }

  const activeDb = db || require("../../db");
  const allStories = stories || (await activeDb.getStories());
  const candidates = selectStudioV21Candidates(allStories, { limit });
  const results = [];
  const rendered = [];

  const runRender =
    renderOne ||
    ((storyId, context) =>
      runNodeScript(
        "tools/studio-v21-render.js",
        [storyId],
        context.childEnv,
      ));
  const runGate =
    gateOne ||
    ((storyId, context) =>
      runNodeScript(
        "tools/studio-v21-gate.js",
        [storyId, "--variant", "v21"],
        context.childEnv,
      ));
  const runCandidateGauntlet =
    runGauntlet ||
    ((context) =>
      runNodeScript(
        "tools/studio-v2-gauntlet.js",
        [],
        context.childEnv,
      ));
  const validateRenderInputs =
    validateInputs ||
    ((story) => validateStudioV21RenderInputs(story, { env }));
  const finaliseRenderedCandidate =
    finaliseCandidate ||
    ((paths) => finaliseStudioV21Candidate(paths));
  const loadGateReport =
    readGateReport ||
    (async (paths) => {
      const fs = require("fs-extra");
      return fs.readJson(path.join(ROOT, paths.gatePath));
    });

  for (const story of candidates) {
    const paths = defaultPathsForStory(story.id);
    if (dryRun) {
      results.push({ id: story.id, dryRun: true, ...paths });
      continue;
    }

    const inputEvidence = await validateRenderInputs(story, { env, paths });
    const childEnv = buildStudioV21ChildEnv(env, paths, inputEvidence);
    const renderResult = runRender(story.id, {
      env,
      paths,
      inputEvidence,
      childEnv,
    });
    if (!renderResult || renderResult.status !== 0) {
      const status = renderResult?.status ?? 1;
      logger.warn(`[studio-v21] render failed for ${story.id} (exit ${status})`);
      throw standardRenderError(
        "STANDARD_RENDER_FAILED",
        "render",
        story.id,
        status,
      );
    }
    rendered.push({ story, paths, inputEvidence, childEnv });
  }

  for (const { story, paths, inputEvidence, childEnv } of rendered) {
    const gauntletResult = runCandidateGauntlet({
      env,
      paths,
      story,
      inputEvidence,
      childEnv,
    });
    if (!gauntletResult || gauntletResult.status !== 0) {
      const status = gauntletResult?.status ?? 1;
      logger.warn(
        `[studio-v21] gauntlet failed for ${story.id} (exit ${status})`,
      );
      throw standardRenderError(
        "STANDARD_RENDER_GAUNTLET_FAILED",
        "gauntlet",
        story.id,
        status,
      );
    }

    const gateResult = runGate(paths.outputStem, {
      env,
      paths,
      story,
      childEnv,
    });
    if (!gateResult || gateResult.status !== 0) {
      const status = gateResult?.status ?? 1;
      logger.warn(`[studio-v21] gate failed for ${story.id} (exit ${status})`);
      throw standardRenderError(
        "STANDARD_RENDER_GATE_FAILED",
        "gate",
        story.id,
        status,
      );
    }

    let gateReport = null;
    try {
      gateReport = await loadGateReport(paths, story);
    } catch {
      gateReport = null;
    }
    const gateVerdict = String(gateReport?.verdict || "")
      .trim()
      .toLowerCase();
    if (!["pass", "review"].includes(gateVerdict)) {
      logger.warn(
        `[studio-v21] gate verdict failed for ${story.id} (${gateVerdict || "missing"})`,
      );
      throw standardRenderError(
        "STANDARD_RENDER_GATE_VERDICT_FAILED",
        "gate-verdict",
        story.id,
        gateVerdict || "missing",
      );
    }

    const outputEvidence = await finaliseRenderedCandidate(paths, {
      story,
      inputEvidence,
      gateReport,
    });
    const updated = buildReviewHoldUpdate(story, {
      ...paths,
      ...outputEvidence,
      gateVerdict,
      inputEvidence,
    });
    await activeDb.upsertStory(updated);
    results.push({
      id: story.id,
      ok: true,
      gateVerdict,
      humanReviewRequired: true,
      ...paths,
    });
  }

  return {
    engine: cfg.engine,
    candidates: candidates.map((s) => s.id),
    results,
  };
}

function isStudioV21BatchEnabled(env = process.env) {
  const cfg = resolveRenderEngine(env);
  return cfg.useStudioV21 && !truthy(env.STUDIO_V21_BATCH_DISABLED);
}

module.exports = {
  buildStudioV21ChildEnv,
  selectStudioV21Candidates,
  buildReviewHoldUpdate,
  finaliseStudioV21Candidate,
  runStudioV21ReviewBatch,
  isStudioV21BatchEnabled,
  defaultPathsForStory,
  validateStudioV21RenderInputs,
};
