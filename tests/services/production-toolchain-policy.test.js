"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  evaluateProductionToolchain,
} = require("../../lib/production-toolchain-policy");
const {
  buildToolchainReport,
} = require("../../tools/production-toolchain-doctor");

test("production toolchain accepts security-current FFmpeg and yt-dlp builds", () => {
  const report = evaluateProductionToolchain({
    ffmpegOutput: "ffmpeg version 8.1.2 Copyright (c) the FFmpeg developers",
    ffprobeOutput: "ffprobe version 8.1.2 Copyright (c) the FFmpeg developers",
    ytDlpOutput: "2026.06.09",
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.production_safe, true);
  assert.deepEqual(report.blockers, []);
});

test("production toolchain rejects yt-dlp builds older than the security baseline", () => {
  const report = evaluateProductionToolchain({
    ffmpegOutput: "ffmpeg version 8.1.2",
    ffprobeOutput: "ffprobe version 8.1.2",
    ytDlpOutput: "2026.03.17",
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.production_safe, false);
  assert.deepEqual(report.blockers, ["yt_dlp_security_baseline_not_met"]);
  assert.equal(report.components.yt_dlp.detected_version, "2026.03.17");
  assert.equal(report.components.yt_dlp.minimum_version, "2026.06.09");
  assert.equal(report.components.yt_dlp.current, false);
});

test("production toolchain rejects stale dated FFmpeg git builds", () => {
  const report = evaluateProductionToolchain({
    ffmpegOutput:
      "ffmpeg version 2025-09-04-git-2611874a50-full_build-www.gyan.dev",
    ffprobeOutput:
      "ffprobe version 2025-09-04-git-2611874a50-full_build-www.gyan.dev",
    ytDlpOutput: "2026.06.09",
  });

  assert.equal(report.verdict, "RED");
  assert.deepEqual(report.blockers, [
    "ffmpeg_security_baseline_not_met",
    "ffprobe_security_baseline_not_met",
  ]);
  assert.equal(report.components.ffmpeg.detected_version, "2025-09-04");
  assert.equal(report.components.ffmpeg.version_kind, "dated_git_build");
});

test("production toolchain doctor probes configured binaries without mutating them", () => {
  const calls = [];
  const report = buildToolchainReport({
    env: {
      FFMPEG_PATH: "D:/toolchain/ffmpeg.exe",
      FFPROBE_PATH: "D:/toolchain/ffprobe.exe",
      YTDLP_PATH: "D:/toolchain/yt-dlp.exe",
    },
    execFileSync(binary, args) {
      calls.push({ binary, args });
      if (binary.includes("yt-dlp")) return "2026.06.09\n";
      const name = binary.includes("ffprobe") ? "ffprobe" : "ffmpeg";
      return `${name} version 8.1.2\n`;
    },
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.read_only, true);
  assert.deepEqual(calls, [
    { binary: "D:/toolchain/ffmpeg.exe", args: ["-version"] },
    { binary: "D:/toolchain/ffprobe.exe", args: ["-version"] },
    { binary: "D:/toolchain/yt-dlp.exe", args: ["--version"] },
  ]);
});
