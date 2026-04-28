"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const path = require("node:path");
const os = require("node:os");

const { validateVideo, MIN_VIDEO_BYTES } = require("../../lib/validate");

async function withTempFile(bytes, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-validate-"));
  const file = path.join(dir, "fixture.mp4");
  await fs.writeFile(file, Buffer.alloc(bytes));
  try {
    return await fn(file);
  } finally {
    await fs.remove(dir).catch(() => {});
  }
}

test("validateVideo: rejects 0-byte files explicitly", async () => {
  await withTempFile(0, async (file) => {
    await assert.rejects(
      () => validateVideo(file, "youtube"),
      /empty \(0 bytes\)/,
    );
  });
});

test("validateVideo: rejects header-only files under MIN_VIDEO_BYTES", async () => {
  await withTempFile(2048, async (file) => {
    await assert.rejects(
      () => validateVideo(file, "youtube"),
      /suspiciously small/,
    );
  });
});

test("validateVideo: accepts files at or above MIN_VIDEO_BYTES", async () => {
  await withTempFile(MIN_VIDEO_BYTES + 1, async (file) => {
    const size = await validateVideo(file, "youtube");
    assert.equal(size, MIN_VIDEO_BYTES + 1);
  });
});

test("validateVideo: still flags missing files first (no size check needed)", async () => {
  await assert.rejects(
    () => validateVideo("/nonexistent/path/missing.mp4", "youtube"),
    /not found/,
  );
});

test("validateVideo: MIN_VIDEO_BYTES is exported and is at least 1 KB", () => {
  assert.equal(typeof MIN_VIDEO_BYTES, "number");
  assert.ok(MIN_VIDEO_BYTES >= 1024);
});
