/**
 * tests/services/ingrid-publish-fixes.test.js
 *
 * 2026-04-24 — pin the four fixes that came out of today's 14:00
 * UTC Ingrid publish (job #7950), which went YT ✅ but TT ❌ /
 * IG Reel ❌ / FB Reel ❌ / IG Story ❌.
 *
 * Diagnoses + fixes:
 *   1. IG Reel 2207076 + FB Reel 422 — video encoder was emitting
 *      "High 4:4:4 Predictive" H.264 profile (confirmed via ffprobe
 *      on the produced MP4). Meta decoders refuse anything above
 *      4:2:0. Fix: force `-pix_fmt yuv420p -profile:v high
 *      -level:v 4.0` on both assemble.js encoders (primary +
 *      single-image fallback).
 *
 *   2. IG Story 2207052 "Media URI doesn't meet our requirements"
 *      — Meta's crawler rejects URIs without a recognised media
 *      extension even when Content-Type is correct. Fix:
 *      server.js accepts `/api/story-image/:id` AND
 *      `/api/story-image/:id.png`; `/api/download/:id` AND
 *      `/api/download/:id.mp4`. Uploaders now construct URLs with
 *      the extension.
 *
 *   3. Subtitle timing drift — `generateSubtitles` checked
 *      `fs.pathExists(timestampsPath)` with a repo-relative path,
 *      which resolves against CWD=/app in the container. The
 *      ElevenLabs word-level timestamps JSON was always at
 *      `/data/media/output/audio/<id>_timestamps.json`, the check
 *      always returned false, captions fell through to synthetic
 *      even-spacing timestamps and drifted 0.5-2s over 60s. Fix:
 *      route the existence check through lib/media-paths.
 *
 *   4. Subject-focus — article og:images land landscape,
 *      letterboxed to portrait, with the character's face in the
 *      top 20% of the frame (viewer's eye went to the arm, not
 *      the face). Fix: preprocess each video image via Sharp's
 *      attention-based smart crop to 1080×1920 before ffmpeg
 *      consumes it. New helper lib/image-crop.js.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ASSEMBLE = fs.readFileSync(
  path.join(__dirname, "..", "..", "assemble.js"),
  "utf8",
);

// ---------- H.264 profile fix -----------------------------------

test("assemble.js: primary encoder forces -pix_fmt yuv420p (Meta-safe chroma)", () => {
  // Both branches of assemble.js's ffmpeg command must force
  // 4:2:0 chroma. The default x264 auto-selects High 4:4:4 when
  // the input images have alpha or full chroma — which is what
  // Sharp-rendered composites ship. Meta refuses 4:4:4. YouTube
  // transcodes server-side so it was masking the issue.
  const occurrences = (ASSEMBLE.match(/-pix_fmt\s+yuv420p/g) || []).length;
  assert.ok(
    occurrences >= 2,
    `expected -pix_fmt yuv420p in BOTH encoders (primary + single-image fallback), got ${occurrences}`,
  );
});

test("assemble.js: explicit high profile + level 4.0 baked in", () => {
  const occurrences = (
    ASSEMBLE.match(/-profile:v\s+high\s+-level:v\s+4\.0/g) || []
  ).length;
  assert.ok(
    occurrences >= 2,
    `expected -profile:v high -level:v 4.0 in both encoders, got ${occurrences}`,
  );
});

// ---------- URL extension fix -----------------------------------

test("server.js: /api/story-image route accepts optional .png suffix", () => {
  const server = fs.readFileSync(
    path.join(__dirname, "..", "..", "server.js"),
    "utf8",
  );
  // Regex route form — `app.get(/^\/api\/story-image\/([^/]+?)(?:\.png)?$/`
  assert.match(
    server,
    /app\.get\(\/\^\\\/api\\\/story-image\\\/\(\[\^\/\]\+\?\)\(\?:\\\.png\)\?\$\//,
    "server.js must define a regex route accepting optional .png suffix on story-image",
  );
});

test("server.js: /api/download route accepts optional .mp4 suffix", () => {
  const server = fs.readFileSync(
    path.join(__dirname, "..", "..", "server.js"),
    "utf8",
  );
  assert.match(
    server,
    /app\.get\(\/\^\\\/api\\\/download\\\/\(\[\^\/\]\+\?\)\(\?:\\\.mp4\)\?\$\//,
    "server.js must define a regex route accepting optional .mp4 suffix on download",
  );
});

test("upload_instagram.js: story-image URL includes .png extension", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "upload_instagram.js"),
    "utf8",
  );
  assert.match(
    src,
    /\/api\/story-image\/\$\{story\.id\}\.png/,
    "IG uploader must request story-image with .png suffix so Meta crawler accepts it",
  );
});

test("upload_instagram.js: video URL includes .mp4 extension", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "upload_instagram.js"),
    "utf8",
  );
  assert.match(
    src,
    /\/api\/download\/\$\{story\.id\}\.mp4/,
    "IG uploader must request video URL with .mp4 suffix",
  );
});

test("upload_facebook.js: video URL includes .mp4 extension", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "upload_facebook.js"),
    "utf8",
  );
  const occurrences = (
    src.match(/\/api\/download\/\$\{story\.id\}\.mp4/g) || []
  ).length;
  assert.ok(
    occurrences >= 2,
    `FB uploader must use .mp4 suffix in ALL video URL constructions (Reel + image-tweet fallback), got ${occurrences}`,
  );
});

// ---------- Subtitle drift fix ----------------------------------

// Strip comments so docstring mentions of the old pattern don't
// false-match the negative regex below.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/([^:])\/\/[^\n]*/g, "$1");
}
const ASSEMBLE_CODE = stripComments(ASSEMBLE);

test("assemble.js: generateSubtitles resolves timestamps path through media-paths", () => {
  // Positive: mediaPaths.resolveExisting IS called on the
  // timestamps path inside generateSubtitles.
  const idx = ASSEMBLE_CODE.indexOf("async function generateSubtitles(");
  assert.ok(idx > 0);
  const fnBody = ASSEMBLE_CODE.slice(idx, idx + 2500);
  assert.match(
    fnBody,
    /mediaPaths\.resolveExisting\(timestampsRel\)/,
    "generateSubtitles must resolve timestampsPath through media-paths",
  );
  // Negative: the old `fs.pathExists(timestampsPath)` bare pattern
  // must NOT reappear — that would reintroduce the drift bug.
  assert.doesNotMatch(
    fnBody,
    /fs\.pathExists\(timestampsPath\)/,
    "generateSubtitles must NOT fs.pathExists a repo-relative timestamps path directly",
  );
});

// ---------- Smart-crop helper -----------------------------------

test("lib/image-crop.js exports smartCropToReel + smartCropBatch", () => {
  const m = require("../../lib/image-crop");
  assert.equal(typeof m.smartCropToReel, "function");
  assert.equal(typeof m.smartCropBatch, "function");
  assert.equal(m.REEL_WIDTH, 1080);
  assert.equal(m.REEL_HEIGHT, 1920);
});

test("smartCropToReel: returns input path when file doesn't exist (fail-safe)", async () => {
  const { smartCropToReel } = require("../../lib/image-crop");
  const result = await smartCropToReel("/tmp/definitely-not-there.jpg");
  assert.equal(result, "/tmp/definitely-not-there.jpg");
});

test("smartCropToReel: handles null / non-string gracefully", async () => {
  const { smartCropToReel } = require("../../lib/image-crop");
  assert.equal(await smartCropToReel(null), null);
  assert.equal(await smartCropToReel(undefined), undefined);
  assert.equal(await smartCropToReel(""), "");
});

test("assemble.js: smart-crop is invoked on images before the filter graph", () => {
  assert.match(
    ASSEMBLE_CODE,
    /smartCropBatch\(rawImages\)/,
    "assemble.js must pipe rawImages through smartCropBatch before building filter graph",
  );
  assert.match(
    ASSEMBLE_CODE,
    /require\(["']\.\/lib\/image-crop["']\)/,
    "assemble.js must import lib/image-crop",
  );
});
