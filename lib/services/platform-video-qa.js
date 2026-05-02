const { execFile } = require("node:child_process");
const util = require("node:util");
const fsExtra = require("fs-extra");
const mediaPaths = require("../media-paths");

const execFileAsync = util.promisify(execFile);

function parseFfprobeJson(stdout) {
  if (typeof stdout !== "string" || stdout.trim().length === 0) return null;
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function firstStream(probe, codecType) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  return streams.find((s) => s && s.codec_type === codecType) || null;
}

function isUnsupportedH264Profile(profile) {
  const text = String(profile || "");
  return /\b(?:high\s*10|high\s*4:2:2|high\s*4:4:4|4:2:2|4:4:4|10-bit)\b/i.test(
    text,
  );
}

function classifyPlatformVideoQa(probe, opts = {}) {
  const failures = [];
  const warnings = [];
  const platform = opts.platform || "shorts";

  if (!probe || typeof probe !== "object") {
    return {
      result: "fail",
      failures: ["ffprobe_metadata_invalid"],
      warnings,
      platform,
    };
  }

  const video = firstStream(probe, "video");
  const audio = firstStream(probe, "audio");

  if (!video) {
    failures.push("video_stream_missing");
  } else {
    const codec = String(video.codec_name || "").toLowerCase();
    if (codec !== "h264") {
      failures.push(`video_codec_not_h264 (${codec || "unknown"})`);
    }

    const pixFmt = String(video.pix_fmt || "").toLowerCase();
    if (pixFmt && pixFmt !== "yuv420p") {
      failures.push(`video_pixel_format_not_yuv420p (${pixFmt})`);
    } else if (!pixFmt) {
      warnings.push("video_pixel_format_unknown");
    }

    if (isUnsupportedH264Profile(video.profile)) {
      failures.push(`video_h264_profile_unsupported (${video.profile})`);
    } else if (!video.profile) {
      warnings.push("video_h264_profile_unknown");
    }

    const width = Number(video.width);
    const height = Number(video.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      failures.push("video_dimensions_unknown");
    } else {
      const ratio = width / height;
      if (width >= height) {
        failures.push(`video_not_vertical (${width}x${height})`);
      } else if (ratio < 0.45 || ratio > 0.75) {
        failures.push(`video_aspect_not_short_form (${width}x${height})`);
      }
      if (width < 540 || height < 960) {
        warnings.push(`video_resolution_low (${width}x${height})`);
      }
    }
  }

  if (!audio) {
    failures.push("audio_stream_missing");
  } else {
    const codec = String(audio.codec_name || "").toLowerCase();
    if (codec !== "aac") {
      failures.push(`audio_codec_not_aac (${codec || "unknown"})`);
    }
  }

  return {
    result: failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    failures,
    warnings,
    platform,
  };
}

async function runPlatformVideoQa(mp4Path, opts = {}) {
  const fs = opts.fs || fsExtra;
  const runExecFile = opts.execFile || execFileAsync;

  if (!mp4Path || typeof mp4Path !== "string") {
    return { result: "fail", failures: ["mp4_path_missing"], warnings: [] };
  }

  let resolvedPath;
  try {
    resolvedPath = await mediaPaths.resolveExisting(mp4Path, { fs });
  } catch {
    resolvedPath = mp4Path;
  }
  if (!resolvedPath) {
    return { result: "fail", failures: ["mp4_not_on_disk"], warnings: [] };
  }

  let exists;
  try {
    exists = await fs.pathExists(resolvedPath);
  } catch (err) {
    return {
      result: "fail",
      failures: [`mp4_stat_failed:${err.code || "unknown"}`],
      warnings: [],
    };
  }
  if (!exists) {
    return { result: "fail", failures: ["mp4_not_on_disk"], warnings: [] };
  }

  try {
    const probe = await runExecFile(
      "ffprobe",
      [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        resolvedPath,
      ],
      { timeout: opts.timeout || 15000, maxBuffer: 2 * 1024 * 1024 },
    );
    const parsed = parseFfprobeJson(probe.stdout);
    return classifyPlatformVideoQa(parsed, opts);
  } catch (err) {
    if (
      err.code === "ENOENT" ||
      (err.message || "").includes("ffprobe") ||
      (err.message || "").includes("not recognized")
    ) {
      return { result: "skip", reason: "ffprobe_missing" };
    }
    return {
      result: "fail",
      failures: [`ffprobe_metadata_failed:${err.code || "unknown"}`],
      warnings: [],
    };
  }
}

module.exports = {
  runPlatformVideoQa,
  classifyPlatformVideoQa,
  parseFfprobeJson,
};
