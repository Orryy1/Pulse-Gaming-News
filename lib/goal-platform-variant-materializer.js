"use strict";

const path = require("node:path");
const { spawn } = require("node:child_process");
const fs = require("fs-extra");

const PLATFORM_KEYS = ["youtube_shorts", "tiktok", "instagram_reels", "facebook_reels", "x", "threads", "pinterest"];

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

async function defaultVariantRenderer({ inputPath, outputPath, targetDurationS, ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg" } = {}) {
  await fs.ensureDir(path.dirname(outputPath));
  await spawnProcess(ffmpegPath, [
    "-y",
    "-i",
    inputPath,
    "-t",
    String(targetDurationS),
    "-vf",
    "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "21",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
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

function platformDurationWindow(output = {}) {
  return output.publish_duration_seconds || output.duration_seconds || output.technical_duration_seconds || null;
}

function sourceRenderPath(artifactDir, renderManifest = {}) {
  const outputPath = cleanText(renderManifest.output_path || renderManifest.output);
  if (!outputPath) return path.join(artifactDir, "visual_v4_render.mp4");
  return path.isAbsolute(outputPath) ? outputPath : path.join(artifactDir, outputPath);
}

function sourceCaptionsPath(artifactDir, platformManifest = {}) {
  const captionsPath = cleanText(platformManifest.captions_path || platformManifest.caption_path || "captions.srt");
  return path.isAbsolute(captionsPath) ? captionsPath : path.join(artifactDir, captionsPath);
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

async function materializeVariantCaptions({ sourcePath, outputPath, maxDurationS } = {}) {
  if (!(await fs.pathExists(sourcePath))) throw new Error("source_captions_missing");
  const trimmed = trimSrtCaptions(await fs.readFile(sourcePath, "utf8"), maxDurationS);
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

function variantFreshAgainstRender({ output = {}, renderManifest = {}, baseDuration = null } = {}) {
  const variant = output.platform_variant_render || {};
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

function buildVariantJobsForPackage({ storyId, artifactDir, renderManifest = {}, platformManifest = {}, generatedAt } = {}) {
  const baseDuration = numberOrNull(
    renderManifest.rendered_duration_s ||
      renderManifest.duration_s ||
      renderManifest.video_duration_s ||
      platformManifest.rendered_duration_s,
  );
  if (!Number.isFinite(baseDuration)) return [];
  const sourcePath = sourceRenderPath(artifactDir, renderManifest);
  const captionsPath = sourceCaptionsPath(artifactDir, platformManifest);
  const jobs = [];
  for (const platform of PLATFORM_KEYS) {
    const output = platformManifest.outputs?.[platform] || {};
    if (
      platform === "tiktok" &&
      cleanText(output.platform_variant_render?.variant_type) === "tiktok_creator_rewards"
    ) {
      continue;
    }
    const window = platformDurationWindow(output);
    const max = numberOrNull(window?.max);
    const min = numberOrNull(window?.min) || 15;
    const existingVariantPath = variantVideoPath(output);
    const existingVariantIsStale =
      existingVariantPath &&
      !variantFreshAgainstRender({ output, renderManifest, baseDuration });
    if (!max || (baseDuration <= max && !existingVariantIsStale)) continue;
    const targetDurationS = round(Math.min(baseDuration, Math.max(min, max - 0.2)));
    const outputPath = path.join(artifactDir, "platform_variants", platform, `visual_v4_render_${platform}.mp4`);
    jobs.push({
      story_id: storyId,
      artifact_dir: artifactDir,
      platform,
      source_video_path: sourcePath,
      source_captions_path: captionsPath,
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
  generatedAt,
} = {}) {
  const baseDuration = numberOrNull(
    renderManifest.rendered_duration_s ||
      renderManifest.duration_s ||
      renderManifest.video_duration_s ||
      platformManifest.rendered_duration_s,
  );
  const sourcePath = sourceCaptionsPath(artifactDir, platformManifest);
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
  const artifactDir = storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir || "";
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
  if (!Object.keys(renderManifest).length) blockers.push("render_manifest_missing");
  if (!Object.keys(platformManifest).length) blockers.push("platform_publish_manifest_missing");
  const jobs = blockers.length
    ? []
    : buildVariantJobsForPackage({
        storyId,
        artifactDir,
        renderManifest,
        platformManifest,
        generatedAt,
      });
  const captionRefreshJobs = blockers.length
    ? []
    : await buildVariantCaptionRefreshJobsForPackage({
        storyId,
        artifactDir,
        renderManifest,
        platformManifest,
        generatedAt,
      });
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
  const variantCaptionsPath = await materializeVariantCaptions({
    sourcePath: job.source_captions_path,
    outputPath: job.captions_output_path,
    maxDurationS: probedDurationS,
  });
  const manifestPath = path.join(job.artifact_dir, "platform_publish_manifest.json");
  const scorecardPath = path.join(job.artifact_dir, "platform_variant_scorecard.json");
  const platformManifest = await readJsonIfPresent(manifestPath);
  const scorecard = await readJsonIfPresent(scorecardPath);
  const outputs = { ...(platformManifest.outputs || {}) };
  const existing = outputs[job.platform] || {};
  const variantEvidence = {
    status: "ready",
    platform: job.platform,
    source_video_path: job.source_video_path,
    output_path: job.output_path,
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
    variant_video_path: job.output_path,
    variant_captions_path: variantCaptionsPath,
    technical_duration_seconds: probedDurationS,
    platform_variant_render: variantEvidence,
  };
  await fs.writeJson(manifestPath, {
    ...platformManifest,
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
};
