"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");
const FONT_OPT =
  process.platform === "win32"
    ? "fontfile='C\\:/Windows/Fonts/arial.ttf'"
    : "font='DejaVu Sans'";

function variantSuffix(variant) {
  return !variant || variant === "canonical" ? "" : `_${variant}`;
}

function mp4Path(storyId, variant) {
  return path.join(TEST_OUT, `studio_v2_${storyId}${variantSuffix(variant)}.mp4`);
}

function labelFor(variant) {
  return variant === "canonical" ? "V2 CANONICAL" : `V2 ${variant.toUpperCase()}`;
}

function safeName(value) {
  return String(value || "canonical").replace(/[^a-z0-9]+/gi, "_").toLowerCase();
}

async function renderVariantComparison({
  storyId = "1sn9xhe",
  leftVariant = "canonical",
  rightVariant = "nofreeze",
} = {}) {
  const left = mp4Path(storyId, leftVariant);
  const right = mp4Path(storyId, rightVariant);
  for (const file of [left, right]) {
    if (!(await fs.pathExists(file))) {
      throw new Error(`comparison input missing: ${file}`);
    }
  }

  const out = path.join(
    TEST_OUT,
    `studio_v2_${storyId}_${safeName(leftVariant)}_vs_${safeName(rightVariant)}.mp4`,
  );
  const contact = path.join(
    TEST_OUT,
    `studio_v2_${storyId}_${safeName(leftVariant)}_vs_${safeName(rightVariant)}_contact.jpg`,
  );
  const filterPath = path.join(
    TEST_OUT,
    `studio_v2_${storyId}_${safeName(leftVariant)}_vs_${safeName(rightVariant)}_filter.txt`,
  );

  const leftLabel = labelFor(leftVariant);
  const rightLabel = labelFor(rightVariant);
  const filter = [
    `[0:v]setpts=PTS-STARTPTS,scale=1080:1920,fps=30,format=yuv420p[leftRaw]`,
    `[1:v]setpts=PTS-STARTPTS,scale=1080:1920,fps=30,format=yuv420p[rightRaw]`,
    `[leftRaw]drawbox=x=0:y=0:w=iw:h=86:color=black@0.78:t=fill,drawbox=x=0:y=84:w=iw:h=4:color=0xFF6B1A@0.95:t=fill,drawtext=text='${leftLabel}':${FONT_OPT}:fontcolor=0xFF6B1A:fontsize=44:x=(w-tw)/2:y=18[leftLab]`,
    `[rightRaw]drawbox=x=0:y=0:w=iw:h=86:color=black@0.78:t=fill,drawbox=x=0:y=84:w=iw:h=4:color=0x6E6E6E@0.95:t=fill,drawtext=text='${rightLabel}':${FONT_OPT}:fontcolor=white:fontsize=44:x=(w-tw)/2:y=18[rightLab]`,
    `[leftLab][rightLab]hstack=inputs=2[outv]`,
    `[0:a]anull[outa]`,
  ].join(";\n");
  await fs.writeFile(filterPath, filter);

  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "warning",
      "-i",
      left,
      "-i",
      right,
      "-filter_complex_script",
      filterPath,
      "-map",
      "[outv]",
      "-map",
      "[outa]",
      "-c:v",
      "libx264",
      "-crf",
      "21",
      "-preset",
      "medium",
      "-pix_fmt",
      "yuv420p",
      "-profile:v",
      "high",
      "-level:v",
      "5.1",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-r",
      "30",
      "-shortest",
      "-movflags",
      "+faststart",
      out,
    ],
    { cwd: ROOT, stdio: "inherit", maxBuffer: 80 * 1024 * 1024 },
  );

  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "warning",
      "-i",
      out,
      "-vf",
      "fps=1/2,scale=540:480:force_original_aspect_ratio=decrease,pad=540:480:(ow-iw)/2:(oh-ih)/2:0x0D0D0F,tile=4x4:padding=8:margin=12:color=0x0D0D0F",
      "-frames:v",
      "1",
      "-update",
      "1",
      "-q:v",
      "2",
      contact,
    ],
    { cwd: ROOT, stdio: "inherit", maxBuffer: 80 * 1024 * 1024 },
  );

  return {
    mp4: path.relative(ROOT, out).replace(/\\/g, "/"),
    contact: path.relative(ROOT, contact).replace(/\\/g, "/"),
    filter: path.relative(ROOT, filterPath).replace(/\\/g, "/"),
  };
}

async function main() {
  const storyId = process.argv[2] || "1sn9xhe";
  const leftVariant = process.argv[3] || "canonical";
  const rightVariant = process.argv[4] || "nofreeze";
  console.log(
    `[variant-compare] ${storyId}: ${leftVariant} vs ${rightVariant}`,
  );
  const out = await renderVariantComparison({
    storyId,
    leftVariant,
    rightVariant,
  });
  console.log(`[variant-compare] mp4: ${out.mp4}`);
  console.log(`[variant-compare] contact: ${out.contact}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { renderVariantComparison, variantSuffix, mp4Path, safeName };
