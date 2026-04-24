#!/usr/bin/env node
/**
 * scripts/clean-bad-chroma-mp4s.js
 *
 * One-off operational script (2026-04-24).
 *
 * Today's 13:00 UTC produce_afternoon and 18:00 UTC produce_primary
 * both ran BEFORE commit 489d215 (Meta-safe H.264 encoder flags)
 * landed on Railway. Every MP4 currently under /data/media/output/
 * final/ was therefore rendered with the libx264 default, which
 * auto-selected "High 4:4:4 Predictive" / pix_fmt=yuv444p because
 * our Sharp-composited thumbnails carry full chroma. Meta decoders
 * refuse 4:4:4 (IG Reel → 2207076, FB Reel → 422). YouTube accepts
 * anything because it transcodes server-side.
 *
 * selfHealStaleMediaPaths in publisher.js only NULLs exported_path
 * when the file is MISSING — not when it's merely the wrong chroma.
 * Result: the 4:4:4 MP4s would sit on disk forever and every future
 * publish window would try them and fail on Meta.
 *
 * This script:
 *   1. Walks /data/media/output/final/
 *   2. For each .mp4, ffprobes pix_fmt
 *   3. If pix_fmt is yuv444p (or anything other than yuv420p):
 *        a. deletes the file + its _teaser.mp4 sibling
 *        b. finds the story row by filename (id strips `.mp4`)
 *        c. NULLs the story's exported_path so the next
 *           produce cycle regenerates it with the new encoder
 *   4. Leaves yuv420p MP4s untouched.
 *
 * Safety:
 *   - READ-ONLY by default. Pass `--apply` to actually delete.
 *   - Only deletes .mp4 / _teaser.mp4 — never touches audio /
 *     images / entity portraits / story cards.
 *   - Only NULLs exported_path — platform post ids are preserved,
 *     same invariant as selfHealStaleMediaPaths. Partial-retry
 *     semantics stay intact.
 *   - Operates against /data/media/output/final (persistent
 *     volume). Does NOT touch /app/output (ephemeral).
 *
 * Usage:
 *   railway ssh -- 'cd /app && node scripts/clean-bad-chroma-mp4s.js'           # dry run
 *   railway ssh -- 'cd /app && node scripts/clean-bad-chroma-mp4s.js --apply'   # actually delete
 *
 * After --apply: the next scheduled produce cycle (08:00 UTC) will
 * re-render every cleaned-up story on the new Meta-safe encoder.
 * The subsequent publish window (09:00 UTC) can then upload to
 * IG Reel and FB Reel successfully.
 */

"use strict";

const path = require("node:path");
const fsExtra = require("fs-extra");
const { execSync } = require("node:child_process");
const Database = require("better-sqlite3");

const DRY_RUN = !process.argv.includes("--apply");

const MEDIA_ROOT = process.env.MEDIA_ROOT || null;
const FINAL_DIR = MEDIA_ROOT
  ? path.join(MEDIA_ROOT, "output", "final")
  : path.resolve(__dirname, "..", "output", "final");

const DB_PATH =
  process.env.SQLITE_DB_PATH ||
  path.resolve(__dirname, "..", "data", "pulse.db");

console.log(
  `[clean-chroma] ${DRY_RUN ? "DRY RUN" : "APPLY"} — scanning ${FINAL_DIR}`,
);

if (!fsExtra.existsSync(FINAL_DIR)) {
  console.log(`[clean-chroma] directory does not exist, nothing to do`);
  process.exit(0);
}

const files = fsExtra
  .readdirSync(FINAL_DIR)
  .filter((f) => f.endsWith(".mp4") && !f.endsWith("_teaser.mp4"));

console.log(`[clean-chroma] found ${files.length} primary .mp4 files`);

const db = new Database(DB_PATH);

const bad = [];
const good = [];

for (const f of files) {
  const abs = path.join(FINAL_DIR, f);
  let stSize = 0;
  try {
    stSize = fsExtra.statSync(abs).size;
  } catch {
    // File vanished between readdir and stat — skip.
    continue;
  }
  // Zero-byte / pathologically-small files are ffmpeg-crashed
  // artefacts from produce cycles that bailed before writing any
  // frames (today's 18:00 UTC produce_primary left 21 of these
  // when the 4:4:4 encoder bug took it down). Treat as BAD so
  // they get cleared alongside the wrong-chroma ones — they're
  // useless and they hold exported_path hostage.
  if (stSize < 1024) {
    bad.push({ file: f, path: abs, pix_fmt: "(0-byte/corrupt)", size: stSize });
    continue;
  }
  try {
    const out = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of default=nw=1:nk=1 "${abs}"`,
      { encoding: "utf8", timeout: 10000 },
    ).trim();
    if (out === "yuv420p") {
      good.push({ file: f, pix_fmt: out });
    } else {
      bad.push({ file: f, pix_fmt: out, path: abs, size: stSize });
    }
  } catch (err) {
    // ffprobe refused the file — container header broken, codec
    // unrecognised, etc. Treat same as zero-byte: unusable,
    // sharply bad, must be cleared.
    bad.push({
      file: f,
      pix_fmt: "(ffprobe-failed)",
      path: abs,
      size: stSize,
      err: err.message.slice(0, 80),
    });
  }
}

console.log("");
console.log(`=== Summary ===`);
console.log(`  good (yuv420p):        ${good.length}`);
console.log(`  BAD (to be cleaned):   ${bad.length}`);
const byReason = bad.reduce((acc, b) => {
  acc[b.pix_fmt] = (acc[b.pix_fmt] || 0) + 1;
  return acc;
}, {});
for (const [r, n] of Object.entries(byReason)) {
  console.log(`    - ${r.padEnd(22)} ${n}`);
}
console.log("");

if (bad.length > 0) {
  console.log(`=== BAD MP4s to clean ===`);
  for (const b of bad) {
    const sizeStr =
      b.size < 1024 ? `${b.size}B` : `${Math.round(b.size / 1024)}KB`;
    console.log(`  ${b.file.padEnd(42)}  ${b.pix_fmt.padEnd(22)}  ${sizeStr}`);
  }
}

if (DRY_RUN) {
  console.log("");
  console.log("DRY RUN — no files deleted, no DB changes.");
  console.log("Re-run with --apply to clean.");
  db.close();
  process.exit(0);
}

if (bad.length === 0) {
  console.log("\nNothing to do.");
  db.close();
  process.exit(0);
}

console.log("");
console.log("Applying...");

let deleted = 0;
let nulledRows = 0;

for (const b of bad) {
  const storyId = b.file.replace(/\.mp4$/, "");
  const teaserPath = path.join(FINAL_DIR, `${storyId}_teaser.mp4`);

  // Delete the bad MP4 and its teaser sibling.
  try {
    fsExtra.removeSync(b.path);
    deleted++;
  } catch (err) {
    console.log(`  FAIL delete ${b.file}: ${err.message}`);
    continue;
  }
  if (fsExtra.existsSync(teaserPath)) {
    try {
      fsExtra.removeSync(teaserPath);
    } catch {
      /* teaser is best-effort */
    }
  }

  // NULL exported_path on the matching story row so the next
  // produce cycle self-heals + re-renders.
  try {
    const info = db
      .prepare(
        `UPDATE stories
         SET exported_path = NULL,
             updated_at = datetime('now')
         WHERE id = ? AND exported_path IS NOT NULL`,
      )
      .run(storyId);
    if (info.changes > 0) nulledRows++;
  } catch (err) {
    console.log(`  FAIL update ${storyId}: ${err.message}`);
  }
}

console.log("");
console.log(
  `Deleted ${deleted} bad MP4s, NULLed exported_path on ${nulledRows} stories.`,
);
console.log(
  "Next produce cycle (normally 08:00 UTC) will regenerate them on the new encoder.",
);

db.close();
