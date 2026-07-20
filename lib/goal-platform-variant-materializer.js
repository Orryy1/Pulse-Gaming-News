"use strict";

const crypto = require("node:crypto");
const nativeFs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const fs = require("fs-extra");
const {
  buildFacebookTranscodeArgs,
} = require("./platforms/facebook-reel-media");

const PLATFORM_KEYS = ["youtube_shorts", "tiktok", "instagram_reels", "facebook_reels", "x", "threads", "pinterest"];
const PLATFORM_VARIANT_MAX_MARGIN_SECONDS = 1;
const PLATFORM_VARIANT_ENCODER_PROFILE = {
  instagram_reels: "instagram_reels_meta_safe_h264_aac_v3",
  facebook_reels: "facebook_reels_meta_safe_h264_aac_v1",
};
const PLATFORM_SAFE_VARIANT_DURATION_WINDOW = {
  youtube_shorts: { min: 15, max: 180 },
  instagram_reels: { min: 15, max: 59 },
  facebook_reels: { min: 15, max: 90 },
};

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, places = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** places;
  return Math.round(number * factor) / factor;
}

function timeMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

async function readJsonIfPresent(filePath, fallback = {}) {
  try {
    if (await fs.pathExists(filePath)) return await fs.readJson(filePath);
  } catch {}
  return fallback;
}

async function fileFingerprint(filePath) {
  const resolved = path.resolve(filePath || "");
  if (!filePath || !(await fs.pathExists(resolved))) return null;
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) return null;
  const sha256 = await new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = nativeFs.createReadStream(resolved);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
  return {
    path: resolved,
    sha256,
    size_bytes: stat.size,
  };
}

function spawnProcess(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stderr });
      else reject(new Error(`${command}_failed:${code}:${stderr.slice(0, 400)}`));
    });
  });
}

function encoderProfileForPlatform(platform) {
  return PLATFORM_VARIANT_ENCODER_PROFILE[cleanText(platform)] || "standard_short_form_h264_aac_v1";
}

function platformRequiresSafeVariant(platform) {
  return ["youtube_shorts", "instagram_reels", "facebook_reels"].includes(cleanText(platform));
}

function buildPlatformVariantFfmpegArgs({ inputPath, outputPath, targetDurationS, platform } = {}) {
  const target = String(targetDurationS);
  if (cleanText(platform) === "facebook_reels") {
    const args = buildFacebookTranscodeArgs(inputPath, outputPath);
    const yIndex = args.indexOf("-y");
    const facebookArgs = yIndex >= 0 ? args.slice(yIndex) : args;
    const inputIndex = facebookArgs.indexOf(inputPath);
    facebookArgs.splice(
      inputIndex + 1,
      0,
      "-t",
      target,
      "-vf",
      "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
    );
    return facebookArgs;
  }
  const common = [
    "-y",
    "-i",
    inputPath,
    "-t",
    target,
    "-vf",
    "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "21",
    "-pix_fmt",
    "yuv420p",
  ];

  if (cleanText(platform) === "instagram_reels") {
    return [
      ...common,
      "-r",
      "30",
      "-fps_mode",
      "cfr",
      "-profile:v",
      "high",
      "-level",
      "4.0",
      "-maxrate",
      "12000k",
      "-bufsize",
      "24000k",
      "-g",
      "60",
      "-keyint_min",
      "60",
      "-sc_threshold",
      "0",
      "-bf",
      "0",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      outputPath,
    ];
  }

  return [
    ...common,
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

async function defaultVariantRenderer({
  inputPath,
  outputPath,
  targetDurationS,
  platform,
  ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg",
} = {}) {
  await fs.ensureDir(path.dirname(outputPath));
  await spawnProcess(
    ffmpegPath,
    buildPlatformVariantFfmpegArgs({ inputPath, outputPath, targetDurationS, platform }),
  );
}

async function defaultProbeDuration(outputPath, { ffprobePath = process.env.FFPROBE_PATH || "ffprobe" } = {}) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(ffprobePath, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      outputPath,
    ], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`ffprobe_failed:${code}:${stderr.slice(0, 400)}`));
    });
  });
  const duration = Number(String(result).trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("ffprobe_duration_missing");
  }
  return round(duration);
}

function platformDurationWindow(output = {}, platform = "") {
  const candidates = [
    output.publish_duration_seconds,
    output.target_duration_seconds,
    output.strategic_duration_seconds,
    output.duration_window,
    output.duration_seconds,
    output.technical_duration_seconds,
  ];
  const explicitWindow = candidates.find((candidate) =>
    candidate && typeof candidate === "object" && !Array.isArray(candidate),
  );
  if (explicitWindow) return explicitWindow;
  const safeDefault = PLATFORM_SAFE_VARIANT_DURATION_WINDOW[cleanText(platform)];
  if (safeDefault) return { ...safeDefault };
  return candidates.find((candidate) => candidate != null) || null;
}

function sourceRenderPath(artifactDir, renderManifest = {}) {
  const outputPath = cleanText(renderManifest.output_path || renderManifest.output);
  if (!outputPath) return path.join(artifactDir, "visual_v4_render.mp4");
  return path.isAbsolute(outputPath) ? outputPath : path.join(artifactDir, outputPath);
}

function sourceCaptionsPath(artifactDir, platformManifest = {}, narrationManifest = {}) {
  const candidates = [
    platformManifest.captions_path,
    platformManifest.caption_path,
    narrationManifest.resolved_captions_path,
    narrationManifest.captions_path,
    path.join("flagship", "captions.srt"),
    "captions.srt",
  ].map(cleanText).filter(Boolean).map((candidate) =>
    path.isAbsolute(candidate) ? candidate : path.join(artifactDir, candidate),
  );
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0] || path.join(artifactDir, "captions.srt");
}

function srtTimestampToSeconds(value = "") {
  const match = String(value).match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!match) return null;
  const [, hours, minutes, seconds, millis] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(millis) / 1000;
}

function secondsToSrtTimestamp(value = 0) {
  const totalMillis = Math.max(0, Math.round(Number(value) * 1000));
  const hours = Math.floor(totalMillis / 3600000);
  const minutes = Math.floor((totalMillis % 3600000) / 60000);
  const seconds = Math.floor((totalMillis % 60000) / 1000);
  const millis = totalMillis % 1000;
  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(seconds).padStart(2, "0"),
  ].join(":") + `,${String(millis).padStart(3, "0")}`;
}

function trimSrtCaptions(captionsText = "", maxDurationS = 0) {
  const maxDuration = Number(maxDurationS);
  if (!Number.isFinite(maxDuration) || maxDuration <= 0) return "";
  const blocks = String(captionsText)
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const output = [];
  let index = 1;
  for (const block of blocks) {
    const lines = block.split("\n");
    const timingIndex = lines.findIndex((line) => /\d\d:\d\d:\d\d,\d{3}\s+-->\s+\d\d:\d\d:\d\d,\d{3}/.test(line));
    if (timingIndex < 0) continue;
    const timing = lines[timingIndex].match(/(\d\d:\d\d:\d\d,\d{3})\s+-->\s+(\d\d:\d\d:\d\d,\d{3})/);
    if (!timing) continue;
    const start = srtTimestampToSeconds(timing[1]);
    const end = srtTimestampToSeconds(timing[2]);
    if (start == null || end == null || start >= maxDuration) continue;
    const clampedEnd = Math.min(end, maxDuration);
    if (clampedEnd <= start) continue;
    const textLines = lines.slice(timingIndex + 1).filter((line) => cleanText(line));
    if (!textLines.length) continue;
    output.push([
      String(index),
      `${secondsToSrtTimestamp(start)} --> ${secondsToSrtTimestamp(clampedEnd)}`,
      ...textLines,
    ].join("\n"));
    index += 1;
  }
  return output.length ? `${output.join("\n\n")}\n` : "";
}

async function materializeVariantCaptions({ sourcePath, outputPath, maxDurationS, expectedSha256 = "" } = {}) {
  if (!(await fs.pathExists(sourcePath))) throw new Error("source_captions_missing");
  const source = await fs.readFile(sourcePath);
  const expected = cleanText(expectedSha256).toLowerCase();
  const actual = crypto.createHash("sha256").update(source).digest("hex");
  if (expected && expected !== actual) throw new Error("source_captions_hash_mismatch");
  const trimmed = trimSrtCaptions(source.toString("utf8"), maxDurationS);
  if (!trimmed) throw new Error("variant_captions_empty");
  await fs.outputFile(outputPath, trimmed, "utf8");
  return outputPath;
}

function variantCaptionPath(output = {}) {
  return cleanText(
    output.variant_captions_path ||
      output.platform_variant_render?.captions_path ||
      output.platform_variant_render?.caption_path ||
      "",
  );
}

function variantVideoPath(output = {}) {
  return cleanText(
    output.variant_video_path ||
      output.platform_variant_render?.output_path ||
      output.platform_variant_render?.video_path ||
      "",
  );
}

async function variantFreshAgainstRender({
  output = {},
  renderManifest = {},
  baseDuration = null,
  platform = "",
  artifactDir = "",
  sourceFingerprint = null,
  storyId = "",
} = {}) {
  const variant = output.platform_variant_render || {};
  if (cleanText(variant.story_id || output.story_id) !== cleanText(storyId)) {
    return false;
  }
  const renderRunId = cleanText(
    renderManifest.run_id || renderManifest.render_run_id || renderManifest.generation_id,
  );
  if (
    renderRunId &&
    cleanText(variant.source_render_run_id || output.source_render_run_id) !== renderRunId
  ) {
    return false;
  }
  const renderGeneratedAt = timeMs(renderManifest.generated_at || renderManifest.generatedAt || renderManifest.rendered_at);
  const variantGeneratedAt = timeMs(
    variant.generated_at ||
      variant.generatedAt ||
      variant.rendered_at ||
      output.platform_variant_materialized_at,
  );
  if (renderGeneratedAt && (!variantGeneratedAt || variantGeneratedAt < renderGeneratedAt)) {
    return false;
  }
  const currentDuration = round(baseDuration);
  const sourceDuration = round(
    variant.source_duration_s ||
      variant.source_render_duration_s ||
      variant.base_duration_s,
  );
  if (
    Number.isFinite(currentDuration) &&
    Number.isFinite(sourceDuration) &&
    Math.abs(currentDuration - sourceDuration) > 0.25
  ) {
    return false;
  }
  const platformKey = cleanText(platform || variant.platform || output.platform);
  const expectedProfile = PLATFORM_VARIANT_ENCODER_PROFILE[platformKey];
  if (expectedProfile && cleanText(variant.encoder_profile) !== expectedProfile) {
    return false;
  }
  const expectedSourceSha256 = cleanText(variant.source_video_sha256).toLowerCase();
  const expectedSourceSize = numberOrNull(variant.source_video_size_bytes);
  if (
    !sourceFingerprint ||
    !expectedSourceSha256 ||
    expectedSourceSha256 !== sourceFingerprint.sha256 ||
    expectedSourceSize !== sourceFingerprint.size_bytes
  ) {
    return false;
  }
  const currentVariantPath = variantVideoPath(output);
  const resolvedVariantPath = path.isAbsolute(currentVariantPath)
    ? currentVariantPath
    : path.join(artifactDir, currentVariantPath);
  const outputFingerprint = await fileFingerprint(resolvedVariantPath);
  const expectedOutputSha256 = cleanText(variant.output_sha256).toLowerCase();
  const expectedOutputSize = numberOrNull(variant.output_size_bytes);
  if (
    !outputFingerprint ||
    !expectedOutputSha256 ||
    expectedOutputSha256 !== outputFingerprint.sha256 ||
    expectedOutputSize !== outputFingerprint.size_bytes
  ) {
    return false;
  }
  return true;
}

function variantDurationSeconds(output = {}, baseDuration = null) {
  return numberOrNull(
    output.technical_duration_seconds ||
      output.platform_variant_render?.duration_s ||
      output.platform_variant_render?.duration_seconds ||
      baseDuration,
  );
}

async function captionsNeedRefresh(sourcePath, outputPath, maxDurationS) {
  if (!(await fs.pathExists(sourcePath))) return false;
  if (!(await fs.pathExists(outputPath))) return true;
  const source = await fs.readFile(sourcePath, "utf8").catch(() => "");
  const current = await fs.readFile(outputPath, "utf8").catch(() => "");
  const trimmed = trimSrtCaptions(source, maxDurationS);
  return cleanText(trimmed) && trimmed !== current;
}

async function buildVariantJobsForPackage({
  storyId,
  artifactDir,
  renderManifest = {},
  platformManifest = {},
  narrationManifest = {},
  generatedAt,
} = {}) {
  const baseDuration = numberOrNull(
    renderManifest.rendered_duration_s ||
      renderManifest.duration_s ||
      renderManifest.video_duration_s ||
      platformManifest.rendered_duration_s,
  );
  if (!Number.isFinite(baseDuration)) return [];
  const sourcePath = sourceRenderPath(artifactDir, renderManifest);
  const sourceFingerprint = await fileFingerprint(sourcePath);
  const captionsPath = sourceCaptionsPath(artifactDir, platformManifest, narrationManifest);
  const jobs = [];
  for (const platform of PLATFORM_KEYS) {
    const output = platformManifest.outputs?.[platform] || {};
    const platformConfigured = Object.keys(output).length > 0;
    if (
      platform === "tiktok" &&
      cleanText(output.platform_variant_render?.variant_type) === "tiktok_creator_rewards"
    ) {
      continue;
    }
    const window = platformDurationWindow(output, platformConfigured ? platform : "");
    const max = numberOrNull(window?.max);
    const min = numberOrNull(window?.min) || 15;
    const existingVariantPath = variantVideoPath(output);
    const existingVariantIsStale =
      existingVariantPath &&
      !(await variantFreshAgainstRender({
        output,
        renderManifest,
        baseDuration,
        platform,
        artifactDir,
        sourceFingerprint,
        storyId,
      }));
    const needsSafePlatformVariant =
      platformConfigured && platformRequiresSafeVariant(platform) && !existingVariantPath;
    if (!max || (baseDuration <= max && !existingVariantIsStale && !needsSafePlatformVariant)) continue;
    const targetDurationS = round(
      baseDuration > max
        ? Math.min(baseDuration, Math.max(min, max - PLATFORM_VARIANT_MAX_MARGIN_SECONDS))
        : baseDuration,
    );
    const outputPath = path.join(artifactDir, "platform_variants", platform, `visual_v4_render_${platform}.mp4`);
    jobs.push({
      story_id: storyId,
      artifact_dir: artifactDir,
      platform,
      source_video_path: sourcePath,
      source_video_sha256: sourceFingerprint?.sha256 || null,
      source_video_size_bytes: sourceFingerprint?.size_bytes || null,
      source_render_run_id: cleanText(
        renderManifest.run_id || renderManifest.render_run_id || renderManifest.generation_id,
      ) || null,
      source_captions_path: captionsPath,
      source_captions_sha256: cleanText(narrationManifest.captions_sha256) || null,
      output_path: outputPath,
      captions_output_path: path.join(artifactDir, "platform_variants", platform, `captions_${platform}.srt`),
      source_duration_s: round(baseDuration),
      target_duration_s: targetDurationS,
      max_duration_s: max,
      generated_at: generatedAt,
    });
  }
  return jobs;
}

async function buildVariantCaptionRefreshJobsForPackage({
  storyId,
  artifactDir,
  renderManifest = {},
  platformManifest = {},
  narrationManifest = {},
  generatedAt,
} = {}) {
  const baseDuration = numberOrNull(
    renderManifest.rendered_duration_s ||
      renderManifest.duration_s ||
      renderManifest.video_duration_s ||
      platformManifest.rendered_duration_s,
  );
  const sourcePath = sourceCaptionsPath(artifactDir, platformManifest, narrationManifest);
  const jobs = [];
  for (const platform of PLATFORM_KEYS) {
    const output = platformManifest.outputs?.[platform] || {};
    const captionsPath = variantCaptionPath(output);
    const videoPath = variantVideoPath(output);
    if (!captionsPath || !videoPath) continue;
    const outputCaptionsPath = path.isAbsolute(captionsPath) ? captionsPath : path.join(artifactDir, captionsPath);
    const outputVideoPath = path.isAbsolute(videoPath) ? videoPath : path.join(artifactDir, videoPath);
    if (!(await fs.pathExists(outputVideoPath))) continue;
    const duration = variantDurationSeconds(output, baseDuration);
    if (!Number.isFinite(duration) || duration <= 0) continue;
    if (!(await captionsNeedRefresh(sourcePath, outputCaptionsPath, duration))) continue;
    jobs.push({
      story_id: storyId,
      artifact_dir: artifactDir,
      platform,
      source_captions_path: sourcePath,
      source_captions_sha256: cleanText(narrationManifest.captions_sha256) || null,
      captions_output_path: outputCaptionsPath,
      variant_video_path: outputVideoPath,
      target_duration_s: round(duration),
      max_duration_s: round(duration),
      generated_at: generatedAt,
      caption_refresh_only: true,
    });
  }
  return jobs;
}

async function inspectStoryPackage(storyPackage = {}, { generatedAt = new Date().toISOString() } = {}) {
  const rawArtifactDir =
    storyPackage.artifact_dir ||
    storyPackage.scheduler_bridge_artifact_dir ||
    storyPackage.output_dir ||
    storyPackage.package_dir ||
    "";
  const artifactDir = rawArtifactDir ? path.resolve(rawArtifactDir) : "";
  const storyId = storyPackage.story_id || storyPackage.id || "unknown";
  const blockers = [];
  if (!artifactDir) blockers.push("missing_artifact_dir");
  if (artifactDir && !(await fs.pathExists(artifactDir))) blockers.push("artifact_dir_missing");
  const renderManifest = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "render_manifest.json"))
    : {};
  const platformManifest = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"))
    : {};
  const narrationManifest = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "narration_manifest.json"))
    : {};
  if (!Object.keys(renderManifest).length) blockers.push("render_manifest_missing");
  if (!Object.keys(platformManifest).length) blockers.push("platform_publish_manifest_missing");
  const jobs = blockers.length
    ? []
    : await buildVariantJobsForPackage({
        storyId,
        artifactDir,
        renderManifest,
        platformManifest,
        narrationManifest,
        generatedAt,
      });
  const rawCaptionRefreshJobs = blockers.length
    ? []
    : await buildVariantCaptionRefreshJobsForPackage({
        storyId,
        artifactDir,
        renderManifest,
        platformManifest,
        narrationManifest,
        generatedAt,
      });
  const variantJobPlatforms = new Set(jobs.map((job) => cleanText(job.platform)));
  const captionRefreshJobs = rawCaptionRefreshJobs.filter(
    (job) => !variantJobPlatforms.has(cleanText(job.platform)),
  );
  return {
    story_id: storyId,
    artifact_dir: artifactDir || null,
    status: blockers.length
      ? "blocked"
      : jobs.length
        ? "needs_platform_variants"
        : captionRefreshJobs.length
          ? "needs_caption_refresh"
          : "already_in_window",
    blockers,
    jobs,
    caption_refresh_jobs: captionRefreshJobs,
  };
}

async function materializeVariantJob(job = {}, { variantRenderer, probeDuration, generatedAt } = {}) {
  if (!(await fs.pathExists(job.source_video_path))) {
    throw new Error("source_video_missing");
  }
  const sourceBefore = await fileFingerprint(job.source_video_path);
  if (!sourceBefore) throw new Error("source_video_fingerprint_missing");
  if (
    cleanText(job.source_video_sha256).toLowerCase() !== sourceBefore.sha256 ||
    numberOrNull(job.source_video_size_bytes) !== sourceBefore.size_bytes
  ) {
    throw new Error("source_video_fingerprint_changed_before_variant_render");
  }
  await variantRenderer({
    inputPath: job.source_video_path,
    outputPath: job.output_path,
    targetDurationS: job.target_duration_s,
    platform: job.platform,
  });
  if (!(await fs.pathExists(job.output_path))) throw new Error("variant_output_missing");
  const stat = await fs.stat(job.output_path);
  if (!stat.isFile() || stat.size < 1024) throw new Error("variant_output_too_small");
  const probedDurationS = round(await probeDuration(job.output_path, { platform: job.platform }));
  if (!Number.isFinite(probedDurationS)) throw new Error("variant_duration_probe_missing");
  if (probedDurationS > job.max_duration_s) {
    throw new Error(`variant_duration_above_platform_max:${job.platform}:${probedDurationS}`);
  }
  const sourceAfter = await fileFingerprint(job.source_video_path);
  if (
    !sourceAfter ||
    sourceAfter.sha256 !== sourceBefore.sha256 ||
    sourceAfter.size_bytes !== sourceBefore.size_bytes
  ) {
    throw new Error("source_video_changed_during_variant_render");
  }
  const outputFingerprint = await fileFingerprint(job.output_path);
  if (!outputFingerprint) throw new Error("variant_output_fingerprint_missing");
  const variantCaptionsPath = await materializeVariantCaptions({
    sourcePath: job.source_captions_path,
    outputPath: job.captions_output_path,
    maxDurationS: probedDurationS,
    expectedSha256: job.source_captions_sha256,
  });
  const manifestPath = path.join(job.artifact_dir, "platform_publish_manifest.json");
  const scorecardPath = path.join(job.artifact_dir, "platform_variant_scorecard.json");
  const platformManifest = await readJsonIfPresent(manifestPath);
  const scorecard = await readJsonIfPresent(scorecardPath);
  const outputs = { ...(platformManifest.outputs || {}) };
  const existing = outputs[job.platform] || {};
  const variantEvidence = {
    status: "ready",
    producer_id: "pulse-goal-platform-variant-materializer",
    materialization_run_id: [
      cleanText(job.source_render_run_id) || "unbound-render",
      job.platform,
      generatedAt,
    ].join(":"),
    story_id: job.story_id,
    platform: job.platform,
    encoder_profile: encoderProfileForPlatform(job.platform),
    transformation_mode: "transcode",
    passthrough_approved: false,
    source_video_path: job.source_video_path,
    source_video_sha256: sourceBefore.sha256,
    source_video_size_bytes: sourceBefore.size_bytes,
    source_render_run_id: cleanText(job.source_render_run_id) || null,
    output_path: job.output_path,
    output_sha256: outputFingerprint.sha256,
    output_size_bytes: outputFingerprint.size_bytes,
    captions_path: variantCaptionsPath,
    source_duration_s: job.source_duration_s,
    target_duration_s: job.target_duration_s,
    duration_s: probedDurationS,
    max_duration_s: job.max_duration_s,
    generated_at: generatedAt,
    probe_required: true,
  };
  outputs[job.platform] = {
    ...existing,
    story_id: job.story_id,
    generated_at: generatedAt,
    source_render_run_id: cleanText(job.source_render_run_id) || null,
    variant_video_path: job.output_path,
    variant_captions_path: variantCaptionsPath,
    technical_duration_seconds: probedDurationS,
    platform_variant_render: variantEvidence,
  };
  await fs.writeJson(manifestPath, {
    ...platformManifest,
    story_id: job.story_id,
    generated_at: generatedAt,
    outputs,
    platform_variant_materialized_at: generatedAt,
    no_publish_triggered: true,
  }, { spaces: 2 });
  await fs.writeJson(scorecardPath, {
    ...scorecard,
    story_id: job.story_id,
    variants: {
      ...(scorecard.variants || {}),
      [job.platform]: variantEvidence,
    },
    platform_variant_materialized_at: generatedAt,
  }, { spaces: 2 });
  return {
    ...job,
    status: "materialized",
    probed_duration_s: probedDurationS,
    size_bytes: stat.size,
  };
}

async function materializeVariantCaptionRefreshJob(job = {}, { generatedAt } = {}) {
  const variantCaptionsPath = await materializeVariantCaptions({
    sourcePath: job.source_captions_path,
    outputPath: job.captions_output_path,
    maxDurationS: job.target_duration_s || job.max_duration_s,
    expectedSha256: job.source_captions_sha256,
  });
  const manifestPath = path.join(job.artifact_dir, "platform_publish_manifest.json");
  const scorecardPath = path.join(job.artifact_dir, "platform_variant_scorecard.json");
  const platformManifest = await readJsonIfPresent(manifestPath);
  const scorecard = await readJsonIfPresent(scorecardPath);
  const outputs = { ...(platformManifest.outputs || {}) };
  const existing = outputs[job.platform] || {};
  outputs[job.platform] = {
    ...existing,
    variant_captions_path: variantCaptionsPath,
    platform_variant_caption_refreshed_at: generatedAt,
    platform_variant_render: {
      ...(existing.platform_variant_render || {}),
      captions_path: variantCaptionsPath,
      caption_refreshed_at: generatedAt,
    },
  };
  await fs.writeJson(manifestPath, {
    ...platformManifest,
    outputs,
    platform_variant_caption_refreshed_at: generatedAt,
    no_publish_triggered: true,
  }, { spaces: 2 });
  await fs.writeJson(scorecardPath, {
    ...scorecard,
    story_id: job.story_id,
    caption_refreshes: {
      ...(scorecard.caption_refreshes || {}),
      [job.platform]: {
        status: "captions_refreshed",
        platform: job.platform,
        captions_path: variantCaptionsPath,
        source_captions_path: job.source_captions_path,
        duration_s: job.target_duration_s,
        generated_at: generatedAt,
      },
    },
    platform_variant_caption_refreshed_at: generatedAt,
  }, { spaces: 2 });
  return {
    ...job,
    status: "captions_refreshed",
    captions_path: variantCaptionsPath,
  };
}

async function materializeGoalPlatformVariants({
  storyPackages = [],
  generatedAt = new Date().toISOString(),
  variantRenderer = defaultVariantRenderer,
  probeDuration = defaultProbeDuration,
} = {}) {
  const inspected = [];
  for (const storyPackage of asArray(storyPackages)) {
    inspected.push(await inspectStoryPackage(storyPackage, { generatedAt }));
  }
  const jobs = inspected.flatMap((item) => item.jobs);
  const captionRefreshJobs = inspected.flatMap((item) => item.caption_refresh_jobs || []);
  const results = [];
  for (const job of jobs) {
    try {
      results.push(await materializeVariantJob(job, { variantRenderer, probeDuration, generatedAt }));
    } catch (error) {
      results.push({
        ...job,
        status: "failed",
        error: error.message,
      });
    }
  }
  const captionRefreshResults = [];
  for (const job of captionRefreshJobs) {
    try {
      captionRefreshResults.push(await materializeVariantCaptionRefreshJob(job, { generatedAt }));
    } catch (error) {
      captionRefreshResults.push({
        ...job,
        status: "failed",
        error: error.message,
      });
    }
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "PLATFORM_VARIANT_MATERIALIZER",
    summary: {
      story_count: inspected.length,
      variant_job_count: jobs.length,
      caption_refresh_job_count: captionRefreshJobs.length,
      materialized_count: results.filter((item) => item.status === "materialized").length,
      caption_refreshed_count: captionRefreshResults.filter((item) => item.status === "captions_refreshed").length,
      failed_count: results.filter((item) => item.status === "failed").length,
      caption_refresh_failed_count: captionRefreshResults.filter((item) => item.status === "failed").length,
      already_in_window_count: inspected.filter((item) => item.status === "already_in_window").length,
      blocked_count: inspected.filter((item) => item.status === "blocked").length,
    },
    inspected: inspected.map((item) => ({
      story_id: item.story_id,
      artifact_dir: item.artifact_dir,
      status: item.status,
      blockers: item.blockers,
      variant_job_count: item.jobs.length,
      caption_refresh_job_count: (item.caption_refresh_jobs || []).length,
    })),
    jobs: results,
    caption_refresh_jobs: captionRefreshResults,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
    },
  };
}

function renderGoalPlatformVariantMaterializationMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal Platform Variant Materializer");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Variant jobs: ${report.summary?.variant_job_count || 0}`);
  lines.push(`Materialized: ${report.summary?.materialized_count || 0}`);
  lines.push(`Failed: ${report.summary?.failed_count || 0}`);
  lines.push("");
  lines.push("Safety: local platform-variant files only. No publishing, DB mutation, OAuth or token change.");
  if (asArray(report.jobs).length) {
    lines.push("");
    lines.push("## Jobs");
    for (const job of asArray(report.jobs).slice(0, 20)) {
      lines.push(`- ${job.story_id}/${job.platform}: ${job.status} ${job.probed_duration_s || job.target_duration_s || ""}s`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function writeGoalPlatformVariantMaterializationReport(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoalPlatformVariantMaterializationReport requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "platform_variant_materialization_report.json");
  const markdownPath = path.join(outDir, "platform_variant_materialization_report.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGoalPlatformVariantMaterializationMarkdown(report), "utf8");
  return { outputDir: outDir, jsonPath, markdownPath };
}

module.exports = {
  materializeGoalPlatformVariants,
  renderGoalPlatformVariantMaterializationMarkdown,
  writeGoalPlatformVariantMaterializationReport,
  buildVariantJobsForPackage,
  buildPlatformVariantFfmpegArgs,
};
