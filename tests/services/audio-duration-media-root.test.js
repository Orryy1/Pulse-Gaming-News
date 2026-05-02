"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { getAudioDuration } = require("../../audio");

function hasFfprobe() {
  try {
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function makeSilentWav(durationSeconds = 0.25) {
  const sampleRate = 8000;
  const channels = 1;
  const bitsPerSample = 16;
  const frames = Math.floor(sampleRate * durationSeconds);
  const dataSize = frames * channels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

test(
  "getAudioDuration resolves stored relative paths through MEDIA_ROOT",
  { skip: !hasFfprobe() },
  async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-root-"));
    const oldMediaRoot = process.env.MEDIA_ROOT;
    process.env.MEDIA_ROOT = tmp;

    try {
      const storedPath = path.join("output", "audio", "media-root-duration.wav");
      const absolutePath = path.join(tmp, storedPath);
      await fs.ensureDir(path.dirname(absolutePath));
      await fs.writeFile(absolutePath, makeSilentWav(0.25));

      const duration = await getAudioDuration(storedPath);
      assert.ok(duration > 0.2 && duration < 0.4, `duration=${duration}`);
    } finally {
      if (oldMediaRoot === undefined) delete process.env.MEDIA_ROOT;
      else process.env.MEDIA_ROOT = oldMediaRoot;
      await fs.remove(tmp).catch(() => {});
    }
  },
);
