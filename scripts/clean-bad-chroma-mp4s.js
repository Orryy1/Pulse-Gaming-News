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
const errored = [];

for (const f of files) {
  const abs = path.join(FINAL_DIR, f);
  try {
    // ffprobe is tolerant of extra whitespace in the -of default output.
    const out = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of default=nw=1:nk=1 "${abs}"`,
      { encoding: "utf8", timeout: 10000 },
    ).trim();
    if (out === "yuv420p") {
      good.push({ file: f, pix_fmt: out });
    } else {
      bad.push({ file: f, pix_fmt: out, path: abs });
    }
  } catch (err) {
    errored.push({ file: f, error: err.message.slice(0, 100) });
  }
}

console.log("");
console.log(`=== Summary ===`);
console.log(`  good (yuv420p):     ${good.length}`);
console.log(`  BAD (wrong chroma): ${bad.length}`);
console.log(`  ffprobe errors:     ${errored.length}`);
console.log("");

if (bad.length > 0) {
  console.log(`=== BAD MP4s to clean ===`);
  for (const b of bad) {
    console.log(`  ${b.file.padEnd(40)}  pix_fmt=${b.pix_fmt}`);
  }
}

if (errored.length > 0) {
  console.log(`=== ffprobe errors ===`);
  for (const e of errored) console.log(`  ${e.file}: ${e.error}`);
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
