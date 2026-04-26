/**
 * tools/studio-v2-contact-sheet.js — frame-grid contact sheet.
 *
 * Pulls one frame every ~1.5s from the v2 render and tiles them
 * 8 across into a single static JPEG. Useful for spotting visible
 * artifacts (palette drift, hand artefacts, busy crops) at a glance
 * without scrubbing through the MP4.
 *
 * Output: test/output/studio_v2_1sn9xhe_contact.jpg
 */

"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");

const STORY_ID = process.argv[2] || "1sn9xhe";
const SRC = path.join(TEST_OUT, `studio_v2_${STORY_ID}.mp4`);
const OUT = path.join(TEST_OUT, `studio_v2_${STORY_ID}_contact.jpg`);
const TILE_W = 320; // each tile width
const TILE_H = 568; // 320 * 1920/1080 keeping 9:16
const COLS = 8;
const FRAME_INTERVAL_S = 1.5;

async function main() {
  if (!(await fs.pathExists(SRC))) {
    throw new Error(`source MP4 not found: ${SRC}`);
  }

  const cmd = [
    "ffmpeg -y -hide_banner -loglevel warning",
    `-i "${SRC.replace(/\\/g, "/")}"`,
    `-vf "fps=1/${FRAME_INTERVAL_S},scale=${TILE_W}:${TILE_H}:force_original_aspect_ratio=decrease,pad=${TILE_W}:${TILE_H}:(ow-iw)/2:(oh-ih)/2:0x0D0D0F,tile=${COLS}x4:padding=8:margin=12:color=0x0D0D0F"`,
    "-frames:v 1",
    "-q:v 2",
    `"${OUT.replace(/\\/g, "/")}"`,
  ].join(" ");

  console.log(`[contact-sheet] building ${path.basename(OUT)}…`);
  const start = Date.now();
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
  const stat = await fs.stat(OUT);
  console.log(
    `[contact-sheet] done in ${Date.now() - start}ms (${(stat.size / 1024).toFixed(1)} KB) → ${path.relative(ROOT, OUT)}`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
