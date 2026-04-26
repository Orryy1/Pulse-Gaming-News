/**
 * tools/studio-v2-compare.js — build side-by-side comparison MP4.
 *
 * Stacks the v1 and v2 1sn9xhe shorts horizontally with labels,
 * matched durations, and the v2 audio bed. Produces a single
 * ~52s MP4 you can scrub through to spot-check editorial differences.
 *
 * Output: test/output/studio_v1_vs_v2_1sn9xhe.mp4 (2160x1920, 30fps)
 */

"use strict";

const path = require("node:path");
const { execSync } = require("node:child_process");
const fs = require("fs-extra");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");
const FONT_OPT =
  process.platform === "win32"
    ? "fontfile='C\\:/Windows/Fonts/arial.ttf'"
    : "font='DejaVu Sans'";

const V1 = path.join(TEST_OUT, "studio_v1_1sn9xhe.mp4");
const V2 = path.join(TEST_OUT, "studio_v2_1sn9xhe.mp4");
const OUT = path.join(TEST_OUT, "studio_v1_vs_v2_1sn9xhe.mp4");

async function main() {
  for (const f of [V1, V2]) {
    if (!(await fs.pathExists(f)))
      throw new Error(`comparison input missing: ${f}`);
  }

  // Each panel is 1080x1920. Stacked side-by-side makes a 2160x1920
  // output. We add 90px label strip TOP-LEFT and TOP-RIGHT inside
  // each panel using drawtext + drawbox.
  const filter = [
    `[0:v]setpts=PTS-STARTPTS,scale=1080:1920,fps=30,format=yuv420p[v1raw]`,
    `[1:v]setpts=PTS-STARTPTS,scale=1080:1920,fps=30,format=yuv420p[v2raw]`,
    // Labels with a brand-amber background bar across the top of
    // each panel so the comparison is unambiguous.
    `[v1raw]drawbox=x=0:y=0:w=iw:h=86:color=black@0.78:t=fill,drawbox=x=0:y=84:w=iw:h=4:color=0x6E6E6E@0.95:t=fill,drawtext=text='STUDIO V1 (BASELINE)':${FONT_OPT}:fontcolor=white:fontsize=44:x=(w-tw)/2:y=18[v1lab]`,
    `[v2raw]drawbox=x=0:y=0:w=iw:h=86:color=black@0.78:t=fill,drawbox=x=0:y=84:w=iw:h=4:color=0xFF6B1A@0.95:t=fill,drawtext=text='STUDIO V2 (PROTOTYPE)':${FONT_OPT}:fontcolor=0xFF6B1A:fontsize=44:x=(w-tw)/2:y=18[v2lab]`,
    `[v1lab][v2lab]hstack=inputs=2[outv]`,
    // Pull audio from the v2 panel only — that's the upgraded mix.
    `[1:a]anull[outa]`,
  ].join(";\n");

  const filterPath = path.join(TEST_OUT, "studio_v1_vs_v2_filter.txt");
  await fs.writeFile(filterPath, filter);

  const cmd = [
    "ffmpeg -y -hide_banner -loglevel warning",
    `-i "${V1.replace(/\\/g, "/")}"`,
    `-i "${V2.replace(/\\/g, "/")}"`,
    `-filter_complex_script "${filterPath.replace(/\\/g, "/")}"`,
    `-map "[outv]" -map "[outa]"`,
    "-c:v libx264 -crf 21 -preset medium",
    "-pix_fmt yuv420p -profile:v high -level:v 4.1",
    "-c:a aac -b:a 192k",
    "-r 30 -shortest",
    `-movflags +faststart "${OUT.replace(/\\/g, "/")}"`,
  ].join(" ");

  console.log("[compare] rendering side-by-side v1 vs v2…");
  const start = Date.now();
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
  console.log(
    `[compare] done in ${Date.now() - start}ms → ${path.relative(ROOT, OUT)}`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
