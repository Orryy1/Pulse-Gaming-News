"use strict";

const POLICY = Object.freeze({
  ffmpeg_minimum: "8.1.2",
  ffmpeg_minimum_build_date: "2026-06-17",
  yt_dlp_minimum: "2026.06.09",
});

function parseVersion(value) {
  const match = String(value || "").match(/(\d{1,4})\.(\d{1,2})\.(\d{1,4})/);
  return match ? match.slice(1, 4).map(Number) : null;
}

function extractVersion(value) {
  const datedBuild = String(value || "").match(/\b(20\d{2}-\d{2}-\d{2})-git\b/i);
  if (datedBuild) return datedBuild[1];
  const match = String(value || "").match(/\d{1,4}\.\d{1,2}\.\d{1,4}/);
  return match ? match[0] : null;
}

function inspectFfmpegVersion(value) {
  const detectedVersion = extractVersion(value);
  const datedBuild = /^20\d{2}-\d{2}-\d{2}$/.test(detectedVersion || "");
  const stableComparison = compareVersions(detectedVersion, POLICY.ffmpeg_minimum);
  const current = datedBuild
    ? detectedVersion >= POLICY.ffmpeg_minimum_build_date
    : stableComparison != null && stableComparison >= 0;
  return {
    detected_version: detectedVersion,
    minimum_version: datedBuild
      ? POLICY.ffmpeg_minimum_build_date
      : POLICY.ffmpeg_minimum,
    version_kind: datedBuild ? "dated_git_build" : "stable_release",
    current,
  };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}

function evaluateProductionToolchain({
  ffmpegOutput,
  ffprobeOutput,
  ytDlpOutput,
} = {}) {
  const blockers = [];
  const ffmpeg = inspectFfmpegVersion(ffmpegOutput);
  const ffprobe = inspectFfmpegVersion(ffprobeOutput);
  const ytDlpCurrent = compareVersions(ytDlpOutput, POLICY.yt_dlp_minimum);

  if (!ffmpeg.current) {
    blockers.push("ffmpeg_security_baseline_not_met");
  }
  if (!ffprobe.current) {
    blockers.push("ffprobe_security_baseline_not_met");
  }
  if (ytDlpCurrent == null || ytDlpCurrent < 0) {
    blockers.push("yt_dlp_security_baseline_not_met");
  }

  return {
    policy: POLICY,
    components: {
      ffmpeg,
      ffprobe,
      yt_dlp: {
        detected_version: extractVersion(ytDlpOutput),
        minimum_version: POLICY.yt_dlp_minimum,
        version_kind: "dated_release",
        current: ytDlpCurrent != null && ytDlpCurrent >= 0,
      },
    },
    verdict: blockers.length === 0 ? "GREEN" : "RED",
    production_safe: blockers.length === 0,
    blockers,
  };
}

module.exports = {
  POLICY,
  compareVersions,
  evaluateProductionToolchain,
  extractVersion,
};
