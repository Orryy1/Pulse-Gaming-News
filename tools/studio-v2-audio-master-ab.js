"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execFileSync } = require("node:child_process");
const { measureLoudness } = require("../lib/studio/v2/gauntlet-v2");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");

function parseTarget(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return -14;
  return Math.max(-24, Math.min(-12, n));
}

function targetLabel(target) {
  return `loudnorm${String(Math.abs(target)).replace(/[^0-9]+/g, "")}`;
}

function outputPathFor({ storyId, target }) {
  return path.join(
    TEST_OUT,
    `studio_v2_${storyId}_${targetLabel(target)}.mp4`,
  );
}

function waveformPathFor({ storyId, target, side }) {
  return path.join(
    TEST_OUT,
    `studio_v2_${storyId}_${targetLabel(target)}_${side}_waveform.png`,
  );
}

function buildLoudnormFilter({ target, truePeak = -1.5, lra = 11 }) {
  return `loudnorm=I=${target}:TP=${truePeak}:LRA=${lra}:print_format=summary`;
}

function renderWaveform({ inputPath, outputPath, colour }) {
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-filter_complex",
      `aformat=channel_layouts=mono,showwavespic=s=1600x260:colors=${colour}`,
      "-frames:v",
      "1",
      outputPath,
    ],
    { cwd: ROOT, stdio: "inherit", maxBuffer: 32 * 1024 * 1024 },
  );
}

async function buildAudioMasterAb({
  storyId = "1sn9xhe",
  target = -14,
  inputPath = path.join(TEST_OUT, `studio_v2_${storyId}.mp4`),
} = {}) {
  const clampedTarget = parseTarget(target);
  if (!(await fs.pathExists(inputPath))) {
    throw new Error(`input MP4 not found: ${inputPath}`);
  }

  const outputPath = outputPathFor({ storyId, target: clampedTarget });
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "warning",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-c:v",
      "copy",
      "-af",
      buildLoudnormFilter({ target: clampedTarget }),
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    { cwd: ROOT, stdio: "inherit", maxBuffer: 80 * 1024 * 1024 },
  );

  const beforeLoudness = measureLoudness(inputPath);
  const afterLoudness = measureLoudness(outputPath);
  const beforeWaveform = waveformPathFor({
    storyId,
    target: clampedTarget,
    side: "before",
  });
  const afterWaveform = waveformPathFor({
    storyId,
    target: clampedTarget,
    side: "after",
  });
  renderWaveform({
    inputPath,
    outputPath: beforeWaveform,
    colour: "0x777777",
  });
  renderWaveform({
    inputPath: outputPath,
    outputPath: afterWaveform,
    colour: "0xFF6B1A",
  });

  const report = {
    storyId,
    generatedAt: new Date().toISOString(),
    targetIntegratedLufs: clampedTarget,
    inputPath: path.relative(ROOT, inputPath).replace(/\\/g, "/"),
    outputPath: path.relative(ROOT, outputPath).replace(/\\/g, "/"),
    beforeWaveform: path.relative(ROOT, beforeWaveform).replace(/\\/g, "/"),
    afterWaveform: path.relative(ROOT, afterWaveform).replace(/\\/g, "/"),
    beforeLoudness,
    afterLoudness,
    delta: {
      integratedLufs:
        beforeLoudness && afterLoudness
          ? Number(
              (
                afterLoudness.integratedLufs - beforeLoudness.integratedLufs
              ).toFixed(1),
            )
          : null,
      truePeakDb:
        beforeLoudness && afterLoudness
          ? Number((afterLoudness.truePeakDb - beforeLoudness.truePeakDb).toFixed(1))
          : null,
    },
    judgement:
      afterLoudness && afterLoudness.truePeakDb <= -1
        ? "benchmark-safe"
        : "check-for-limiter-risk",
  };
  const jsonPath = path.join(
    TEST_OUT,
    `studio_v2_${storyId}_${targetLabel(clampedTarget)}_audio_master_report.json`,
  );
  const mdPath = path.join(
    TEST_OUT,
    `studio_v2_${storyId}_${targetLabel(clampedTarget)}_audio_master.md`,
  );
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(
    mdPath,
    [
      `# Studio V2 Audio Master A/B - ${storyId}`,
      "",
      `Target: ${clampedTarget} LUFS`,
      `Judgement: ${report.judgement}`,
      "",
      "| Metric | Before | After | Delta |",
      "| --- | ---: | ---: | ---: |",
      `| Integrated LUFS | ${beforeLoudness?.integratedLufs ?? ""} | ${afterLoudness?.integratedLufs ?? ""} | ${report.delta.integratedLufs ?? ""} |`,
      `| True peak dB | ${beforeLoudness?.truePeakDb ?? ""} | ${afterLoudness?.truePeakDb ?? ""} | ${report.delta.truePeakDb ?? ""} |`,
      `| LRA LU | ${beforeLoudness?.lraLu ?? ""} | ${afterLoudness?.lraLu ?? ""} |  |`,
      "",
      `Output: ${report.outputPath}`,
      `Before waveform: ${report.beforeWaveform}`,
      `After waveform: ${report.afterWaveform}`,
      "",
    ].join("\n"),
  );
  report.reportPath = path.relative(ROOT, jsonPath).replace(/\\/g, "/");
  report.markdownPath = path.relative(ROOT, mdPath).replace(/\\/g, "/");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  return report;
}

async function main() {
  const storyId = process.argv[2] || "1sn9xhe";
  const target = parseTarget(process.argv[3] || -14);
  console.log(`[audio-master] ${storyId} target ${target} LUFS`);
  const report = await buildAudioMasterAb({ storyId, target });
  console.log(`[audio-master] output: ${report.outputPath}`);
  console.log(
    `[audio-master] LUFS: ${report.beforeLoudness?.integratedLufs} -> ${report.afterLoudness?.integratedLufs}`,
  );
  console.log(`[audio-master] report: ${report.reportPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  parseTarget,
  targetLabel,
  outputPathFor,
  buildLoudnormFilter,
  buildAudioMasterAb,
};
