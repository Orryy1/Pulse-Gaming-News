/**
 * tools/quality-render.js — render one local story through the
 * quality-redesign pipeline.
 *
 * This is a LOCAL TEST HARNESS. It does NOT replace assemble.js — it
 * exists so we can validate the new lib/ modules end-to-end on a
 * sample story without needing the full Reddit / RSS / approval /
 * publish stack to be running.
 *
 * Inputs (auto-discovered from the working directory):
 *   - SQLite story row     data/pulse.db                              (optional)
 *   - Audio narration      output/audio/<id>.mp3                       (required)
 *   - Word timestamps      output/audio/<id>_timestamps.json           (preferred)
 *                          OR output/audio/<id>_timing.json             (older format, char-level)
 *   - Images               output/image_cache/<id>_*.jpg                (required)
 *   - Music                output/audio/Main Background Loop 1.wav     (optional)
 *
 * Output: test/output/after_<id>.mp4 + test/output/<id>_after.ass
 *
 * Usage: node tools/quality-render.js <storyId>
 */

"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execSync } = require("node:child_process");

const { smartCropBatch } = require("../lib/image-crop");
const { buildPerImageMotion, FPS } = require("../lib/motion");
const {
  buildTransitionStrategy,
  buildTransitionFilters,
  TRANSITION_TYPES,
} = require("../lib/transitions");
const {
  composeOpenerOverlay,
  buildOpenerDrawtext,
} = require("../lib/hook-factory");
const { buildAss } = require("../lib/caption-emphasis");
const { rankImagesByRelevance } = require("../lib/relevance");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");

const ACCENT_COLOR = "0xFF6B1A"; // Pulse Gaming amber
const FONT_OPT =
  process.platform === "win32"
    ? "fontfile='C\\:/Windows/Fonts/arial.ttf'"
    : "font='DejaVu Sans'";

/**
 * Find audio + timestamps + images for `id` in the local repo.
 * Returns { audioPath, timestampsPath, images, musicPath } or
 * throws if anything mandatory is missing.
 */
async function discoverFixture(id) {
  const audioPath = path.join(ROOT, "output", "audio", `${id}.mp3`);
  if (!(await fs.pathExists(audioPath))) {
    throw new Error(`audio missing: ${audioPath}`);
  }

  // Prefer the newer word-level _timestamps.json. The older
  // _timing.json is character-level — caption-emphasis can convert.
  const newTs = path.join(ROOT, "output", "audio", `${id}_timestamps.json`);
  const oldTs = path.join(ROOT, "output", "audio", `${id}_timing.json`);
  const timestampsPath = (await fs.pathExists(newTs))
    ? newTs
    : (await fs.pathExists(oldTs))
      ? oldTs
      : null;

  const cacheDir = path.join(ROOT, "output", "image_cache");
  let images = [];
  if (await fs.pathExists(cacheDir)) {
    const all = await fs.readdir(cacheDir);
    images = all
      .filter((f) => f.startsWith(`${id}_`) && /\.(jpg|jpeg|png)$/i.test(f))
      // exclude any prior smart-crop outputs (we re-do that step)
      .filter((f) => !f.includes("_smartcrop"))
      .map((f) => ({
        path: path.join(cacheDir, f),
        filename: f,
        // Infer type + source from filename for relevance ranking.
        type: inferType(f),
        source: inferSource(f),
        priority: inferPriority(f),
      }));
  }
  if (images.length === 0) {
    throw new Error(`no images found for ${id} under ${cacheDir}`);
  }

  const musicPath = path.join(ROOT, "audio", "Main Background Loop 1.wav");
  return {
    audioPath,
    timestampsPath,
    images,
    musicPath: (await fs.pathExists(musicPath)) ? musicPath : null,
  };
}

function inferType(filename) {
  if (filename.includes("article_hero")) return "article_hero";
  if (filename.includes("article_inline")) return "article_inline";
  if (filename.includes("hero_steam")) return "steam_hero";
  if (filename.includes("screenshot_steam")) return "steam_screenshot";
  if (filename.includes("capsule_steam")) return "steam_capsule";
  if (filename.includes("pexels")) return "pexels";
  if (filename.includes("unsplash")) return "unsplash";
  if (filename.includes("bing")) return "bing";
  if (filename.includes("article")) return "article";
  return "unknown";
}

function inferSource(filename) {
  if (filename.includes("steam")) return "steam";
  if (filename.includes("article")) return "article";
  if (filename.includes("pexels")) return "pexels";
  if (filename.includes("unsplash")) return "unsplash";
  if (filename.includes("bing")) return "bing";
  if (filename.includes("wikipedia")) return "wikipedia";
  return "unknown";
}

function inferPriority(filename) {
  // Mirror images_download.js's priority hierarchy.
  if (filename.includes("article_hero")) return 100;
  if (filename.includes("article_inline")) return 80;
  if (filename.includes("hero_steam")) return 90;
  if (filename.includes("capsule_steam")) return 95;
  if (filename.includes("screenshot_steam")) return 70;
  if (filename.includes("pexels")) return 25;
  if (filename.includes("unsplash")) return 15;
  if (filename.includes("bing")) return 10;
  return 50;
}

/**
 * Load story metadata from the local SQLite DB if available, else
 * synthesise a minimal stub so the renderer can proceed.
 */
async function loadStory(id) {
  try {
    const Database = require("better-sqlite3");
    const dbPath = path.join(ROOT, "data", "pulse.db");
    if (await fs.pathExists(dbPath)) {
      const db = new Database(dbPath, { readonly: true });
      const row = db
        .prepare(
          `SELECT id, title, hook, body, full_script, classification,
                  flair, subreddit, source_type, company_name
           FROM stories WHERE id = ?`,
        )
        .get(id);
      db.close();
      if (row) return row;
    }
  } catch (e) {
    /* fall through to stub */
  }
  return {
    id,
    title: `Local sample ${id}`,
    hook: `This is a local quality-test render of ${id}.`,
    body: "",
    full_script: "",
    classification: "[NEWS]",
    flair: "Test",
    subreddit: "local",
    source_type: "local",
  };
}

function ffprobeJson(file) {
  const out = execSync(
    `ffprobe -v quiet -print_format json -show_format -show_streams "${file.replace(/\\/g, "/")}"`,
    { encoding: "utf8" },
  );
  return JSON.parse(out);
}

function audioDuration(audioPath) {
  try {
    const j = ffprobeJson(audioPath);
    return parseFloat(j.format.duration);
  } catch {
    return 60.0;
  }
}

/**
 * Compose the full filter graph and ffmpeg command for `id`.
 */
async function buildCommand({ id, story, fixture, duration, croppedImages }) {
  const ranked = rankImagesByRelevance(croppedImages, story);
  // Cap segments at 12 (5s minimum * 12 = 60s coverage). Real videos
  // are 50–70s so this gives us comfortable headroom while ensuring
  // we get more cuts than the legacy 8 max.
  const segments = ranked.slice(0, Math.min(12, ranked.length));

  // Aim for ~5s per segment, capped at 12 segments for a 60-70s
  // video. Pad by reusing the best images if we have fewer than
  // targetSegments.
  const targetSegments = Math.min(12, Math.max(8, Math.ceil(duration / 5.0)));
  const finalSegments = [];
  for (let i = 0; i < targetSegments; i++) {
    finalSegments.push(segments[i % segments.length]);
  }
  const finalCount = finalSegments.length;

  // Effective coverage shrinks per edge — cuts add nothing, xfades
  // overlap by their duration. Average shrink ≈ 0.12s per edge
  // across the mixed strategy. Add ~0.4s tail margin so `-shortest`
  // doesn't clip the last sentence + outro dissolve.
  const totalShrink = (finalCount - 1) * 0.12;
  const finalDuration = Math.max(
    3.5,
    Math.min(6.5, (duration + totalShrink + 0.4) / finalCount),
  );

  const inputs = [];
  // Image inputs
  for (let i = 0; i < finalCount; i++) {
    inputs.push(
      `-loop 1 -t ${(finalDuration + 1).toFixed(2)} -i "${finalSegments[i].path.replace(/\\/g, "/")}"`,
    );
  }
  // Audio
  const audioIdx = finalCount;
  inputs.push(`-i "${fixture.audioPath.replace(/\\/g, "/")}"`);
  // Music (optional). -stream_loop -1 so ffmpeg loops the bed
  // forever; without this -shortest cuts the whole render to the
  // music length (the bed loops are 19-22s).
  let musicIdx = -1;
  if (fixture.musicPath) {
    musicIdx = audioIdx + 1;
    inputs.push(
      `-stream_loop -1 -i "${fixture.musicPath.replace(/\\/g, "/")}"`,
    );
  }

  // Per-segment motion
  const filterParts = [];
  for (let i = 0; i < finalCount; i++) {
    filterParts.push(
      buildPerImageMotion({
        slot: i,
        segmentCount: finalCount,
        segmentDuration: finalDuration,
        isVideoSlot: false,
      }),
    );
  }

  // Transitions
  const transitions = buildTransitionStrategy({
    segmentCount: finalCount,
    segmentDuration: finalDuration,
  });
  const transitionFilters = buildTransitionFilters(transitions, {
    segmentCount: finalCount,
  });
  filterParts.push(...transitionFilters);

  // Opener overlay on top of [base]
  const opener = composeOpenerOverlay(story);
  const openerFilters = buildOpenerDrawtext(opener, {
    fontOpt: FONT_OPT,
    accentColor: ACCENT_COLOR,
  });

  let lastVideoLabel = "base";
  if (openerFilters.length) {
    filterParts.push(`[base]${openerFilters.join(",")}[afterhook]`);
    lastVideoLabel = "afterhook";
  }

  // ASS subtitles. ffmpeg's ass filter parses `:` as option
  // separators, so a Windows drive letter `C:` in the path
  // breaks. Escaping with `\:` in the filter complex script
  // doesn't reliably suppress this. Cleanest fix: pass a
  // RELATIVE path. The harness invokes ffmpeg with cwd=ROOT, so
  // `test/output/<id>_after.ass` resolves correctly without
  // any colons in the filter.
  const assPathRel = path
    .relative(ROOT, path.join(TEST_OUT, `${id}_after.ass`))
    .replace(/\\/g, "/");
  filterParts.push(`[${lastVideoLabel}]ass=${assPathRel}[outv]`);

  // Audio mixing
  let audioMapping;
  if (musicIdx >= 0) {
    filterParts.push(`[${audioIdx}:a]volume=1.0[voice]`);
    filterParts.push(`[${musicIdx}:a]volume=0.10[bgm]`);
    filterParts.push(
      `[voice][bgm]amix=inputs=2:duration=first:dropout_transition=2[outa]`,
    );
    audioMapping = `-map "[outv]" -map "[outa]"`;
  } else {
    audioMapping = `-map "[outv]" -map ${audioIdx}:a`;
  }

  const filterScriptPath = path.join(TEST_OUT, `${id}_filter.txt`);
  await fs.writeFile(filterScriptPath, filterParts.join(";\n"));

  const outputPath = path.join(TEST_OUT, `after_${id}.mp4`);

  const command = [
    `ffmpeg -y -hide_banner -loglevel error`,
    inputs.join(" "),
    `-filter_complex_script "${filterScriptPath.replace(/\\/g, "/")}"`,
    audioMapping,
    `-c:v libx264 -crf 21 -preset medium`,
    `-pix_fmt yuv420p -profile:v high -level:v 4.0`,
    `-c:a aac -b:a 192k`,
    `-r ${FPS} -shortest`,
    `-movflags +faststart "${outputPath.replace(/\\/g, "/")}"`,
  ].join(" ");

  return {
    command,
    outputPath,
    filterScriptPath,
    transitions,
    finalCount,
    finalDuration,
  };
}

/**
 * Main entry: render one story.
 */
async function renderOne(id, opts = {}) {
  await fs.ensureDir(TEST_OUT);
  const fixture = await discoverFixture(id);
  const story = await loadStory(id);
  const duration = audioDuration(fixture.audioPath);

  console.log(
    `[quality] ${id} duration=${duration.toFixed(2)}s images=${fixture.images.length}`,
  );

  // 1. Smart-crop images
  const cropped = await smartCropBatch(fixture.images.map((i) => i.path));
  // Pair cropped paths back to fixture metadata so relevance ranking
  // still has type/source.
  const croppedImages = fixture.images.map((img, i) => ({
    ...img,
    path: cropped[i],
  }));

  // 2. Build captions FIRST so any timestamps issue surfaces before
  //    we sink time into ffmpeg.
  let assContent;
  if (fixture.timestampsPath) {
    try {
      const data = await fs.readJson(fixture.timestampsPath);
      let words = [];
      if (Array.isArray(data?.words)) words = data.words;
      else if (Array.isArray(data?.alignment?.words))
        words = data.alignment.words;
      else if (Array.isArray(data?.characters)) {
        const { buildAss: _buildAss } = require("../lib/caption-emphasis");
        const charsToWords = require("../lib/caption-emphasis").charsToWords;
        // charsToWords isn't exported — inline the conversion.
        words = inlineCharsToWords(data);
      } else if (Array.isArray(data?.alignment?.characters)) {
        words = inlineCharsToWords(data.alignment);
      }
      assContent = buildAss({ story, words, duration });
    } catch (e) {
      console.warn(
        `[quality] ${id}: timestamps parse failed (${e.message}) — falling back to even spacing`,
      );
      assContent = buildEvenSpacedAss(story, duration);
    }
  } else {
    console.warn(
      `[quality] ${id}: no timestamps file, using even-spacing fallback`,
    );
    assContent = buildEvenSpacedAss(story, duration);
  }
  const assPath = path.join(TEST_OUT, `${id}_after.ass`);
  await fs.writeFile(assPath, assContent);

  // 3. Build the ffmpeg command
  const { command, outputPath, finalCount, finalDuration, transitions } =
    await buildCommand({ id, story, fixture, duration, croppedImages });

  if (opts.dryRun) {
    return { command, outputPath, finalCount, finalDuration, transitions };
  }

  // 4. Run ffmpeg
  const t0 = Date.now();
  try {
    execSync(command, {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      command,
      outputPath,
      finalCount,
      finalDuration,
    };
  }
  const elapsedMs = Date.now() - t0;

  // 5. ffprobe the output
  const probe = ffprobeJson(outputPath);
  const vid = probe.streams.find((s) => s.codec_type === "video");
  return {
    ok: true,
    outputPath,
    elapsedMs,
    duration: parseFloat(probe.format.duration),
    width: vid?.width,
    height: vid?.height,
    bitrate: parseInt(probe.format.bit_rate, 10),
    sizeBytes: parseInt(probe.format.size, 10),
    finalCount,
    finalDuration,
    transitions,
  };
}

function inlineCharsToWords(alignment) {
  const chars = alignment.characters || [];
  const starts =
    alignment.character_start_times_seconds ||
    alignment.characterStartTimesSeconds ||
    [];
  const ends =
    alignment.character_end_times_seconds ||
    alignment.characterEndTimesSeconds ||
    [];
  const words = [];
  let buffer = "";
  let bufStart = null;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === " " || ch === "\n" || ch === "\t") {
      if (buffer) {
        words.push({
          word: buffer,
          start: bufStart,
          end: ends[i - 1] ?? bufStart,
        });
        buffer = "";
        bufStart = null;
      }
    } else {
      if (bufStart === null) bufStart = starts[i] ?? 0;
      buffer += ch;
    }
  }
  if (buffer && bufStart !== null) {
    words.push({
      word: buffer,
      start: bufStart,
      end: ends[ends.length - 1] ?? bufStart,
    });
  }
  return words;
}

/**
 * Crude even-spacing ASS for stories without timestamps.
 * Uses the script text split into 4-word phrases.
 */
function buildEvenSpacedAss(story, duration) {
  const text = (story.full_script || story.body || story.hook || "").trim();
  const phrases = [];
  const tokens = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 4) {
    phrases.push(tokens.slice(i, i + 4).join(" "));
  }
  if (phrases.length === 0) phrases.push(story.title || "Pulse Gaming");
  const per = duration / phrases.length;
  // Build pseudo-words with even start/end.
  const words = [];
  for (let pi = 0; pi < phrases.length; pi++) {
    const base = pi * per;
    const subTokens = phrases[pi].split(/\s+/);
    const sub = per / subTokens.length;
    for (let wi = 0; wi < subTokens.length; wi++) {
      words.push({
        word: subTokens[wi],
        start: base + wi * sub,
        end: base + (wi + 1) * sub,
      });
    }
  }
  return buildAss({ story, words, duration });
}

module.exports = { renderOne, discoverFixture, loadStory };

if (require.main === module) {
  const id = process.argv[2];
  if (!id) {
    console.error("Usage: node tools/quality-render.js <storyId>");
    process.exit(2);
  }
  renderOne(id)
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r?.ok === false ? 1 : 0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
