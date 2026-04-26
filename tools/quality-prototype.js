/**
 * tools/quality-prototype.js — Studio Short Engine prototype.
 *
 * Single-purpose harness: render `1sn9xhe` (Metro 2039 trailer
 * reveal) using ZERO stock-photo filler. The slate is hand-tuned
 * so we can answer one question:
 *
 *   Does source-diversity + clip-first composition produce a
 *   visible leap in quality vs the PRL slideshow approach?
 *
 * What this prototype DELIBERATELY does NOT do:
 *   - No HyperFrames (per user instruction — clean ffmpeg test)
 *   - No HTML rendering
 *   - No TTS regeneration (uses cached fixtures)
 *   - No production touches
 *   - No env var reads, no Railway, no merge
 *
 * Inputs (auto-discovered):
 *   output/audio/1sn9xhe.mp3
 *   output/audio/1sn9xhe_timestamps.json
 *   output/image_cache/1sn9xhe_article.jpg                        (article hero)
 *   output/image_cache/1sn9xhe_trailerframe_{1..6}.jpg             (frames extracted via ffmpeg from the trailer)
 *   output/video_cache/1sn9xhe_clip_{A,B,C}.mp4                    (4-second slices)
 *
 * Output:
 *   test/output/proto_1sn9xhe.mp4
 *   test/output/1sn9xhe_proto.ass
 *   test/output/1sn9xhe_proto_filter.txt
 *
 * Usage: node tools/quality-prototype.js
 */

"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execSync } = require("node:child_process");

const { smartCropToReel } = require("../lib/image-crop");
const { buildAss } = require("../lib/caption-emphasis");
const { buildPrlChain } = require("../lib/prl-overlays");
const {
  composeOpenerOverlay,
  buildOpenerDrawtext,
} = require("../lib/hook-factory");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");
const STORY_ID = "1sn9xhe";
const FPS = 30;

const ACCENT_COLOR = "0xFF6B1A";
const FONT_OPT =
  process.platform === "win32"
    ? "fontfile='C\\:/Windows/Fonts/arial.ttf'"
    : "font='DejaVu Sans'";

// ---- Fixture discovery ------------------------------------------

async function loadStory() {
  const Database = require("better-sqlite3");
  const db = new Database(path.join(ROOT, "data", "pulse.db"), {
    readonly: true,
  });
  const r = db
    .prepare(
      `SELECT id, title, hook, body, full_script, classification,
              flair, subreddit, source_type, top_comment
       FROM stories WHERE id = ?`,
    )
    .get(STORY_ID);
  db.close();
  return r;
}

function ffprobeDuration(file) {
  const out = execSync(
    `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${file.replace(/\\/g, "/")}"`,
    { encoding: "utf8" },
  ).trim();
  return parseFloat(out);
}

// ---- Slate definition -------------------------------------------

/**
 * Hand-tuned slate for the Metro 2039 prototype. 12 scenes, no
 * stock filler. Mix: 3 clip slices + 6 trailer-frames + 1 article
 * hero (used twice as bookends) + 1 takeaway card.
 *
 * Durations sum to ~62s; xfade overlaps + the dissolve mix bring
 * the rendered length to ~61s, matching the audio narration.
 */
function buildSlate(paths) {
  // Total target ~63s to cover 61.91s audio narration with a small
  // tail margin. Mix of 5.0s clips, 5.0–5.5s stills, 6.0s takeaway.
  return [
    {
      type: "clip",
      source: paths.clipA,
      duration: 5.0,
      label: "scene_clip_A",
    },
    {
      type: "still",
      source: paths.articleHero,
      duration: 5.5,
      motion: "pushInCentre",
      label: "scene_article_1",
    },
    {
      type: "still",
      source: paths.frame1,
      duration: 5.0,
      motion: "pushPanRight",
      label: "scene_frame_1",
    },
    {
      type: "still",
      source: paths.frame2,
      duration: 5.0,
      motion: "pullBackCentre",
      label: "scene_frame_2",
    },
    {
      type: "clip",
      source: paths.clipB,
      duration: 5.0,
      label: "scene_clip_B",
    },
    {
      type: "still",
      source: paths.frame3,
      duration: 5.5,
      motion: "pushPanLeft",
      label: "scene_frame_3",
    },
    {
      type: "still",
      source: paths.frame4,
      duration: 5.5,
      motion: "pushInCentre",
      label: "scene_frame_4",
    },
    {
      type: "clip",
      source: paths.clipC,
      duration: 5.0,
      label: "scene_clip_C",
    },
    {
      type: "still",
      source: paths.frame5,
      duration: 5.5,
      motion: "pushPanRight",
      label: "scene_frame_5",
    },
    {
      type: "still",
      source: paths.frame6,
      duration: 5.5,
      motion: "pullBackCentre",
      label: "scene_frame_6",
    },
    {
      type: "still",
      source: paths.articleHero,
      duration: 5.5,
      motion: "driftDown",
      label: "scene_article_2",
    },
    {
      type: "card",
      cardKind: "takeaway",
      text: "WATCH THE FULL TRAILER",
      duration: 6.0,
      label: "scene_takeaway",
    },
  ];
}

// ---- Per-scene filter generation ---------------------------------

/**
 * Build the per-scene filter graph fragment. Returns a string ending
 * in `[v<i>]` so transitions can chain it.
 */
function buildSceneFilter(scene, slot) {
  const { type, duration } = scene;
  const dFrames = Math.max(1, Math.round(duration * FPS));
  const trim = `trim=duration=${duration},setpts=PTS-STARTPTS`;

  if (type === "clip") {
    // Video clip: scale to 1080x1920 portrait, crop centre, take
    // first `duration` seconds. No zoompan — motion is in source.
    return [
      `[${slot}:v]setrange=tv`,
      `scale=1080:1920:force_original_aspect_ratio=increase`,
      `crop=1080:1920:(iw-1080)/2:(ih-1920)/2`,
      `fps=${FPS}`,
      trim,
      `format=yuv420p,setsar=1[v${slot}]`,
    ].join(",");
  }

  if (type === "still") {
    // Smart-cropped still gets motion via zoompan.
    const motion = scene.motion || "pushInCentre";
    const inc = Math.round(10000 * (0.18 / dFrames)) / 10000;
    let zoompan;
    switch (motion) {
      case "pullBackCentre":
        zoompan = `zoompan=z=if(eq(on\\,1)\\,1.18\\,max(zoom-${inc}\\,1.0)):x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):d=${dFrames}:s=1080x1920:fps=${FPS}`;
        break;
      case "pushPanRight":
        zoompan = `zoompan=z=min(zoom+${inc}\\,1.18):x=(iw-iw/zoom)*on/${dFrames}:y=ih/2-(ih/zoom/2):d=${dFrames}:s=1080x1920:fps=${FPS}`;
        break;
      case "pushPanLeft":
        zoompan = `zoompan=z=min(zoom+${inc}\\,1.18):x=(iw-iw/zoom)*(1-on/${dFrames}):y=ih/2-(ih/zoom/2):d=${dFrames}:s=1080x1920:fps=${FPS}`;
        break;
      case "driftDown":
        zoompan = `zoompan=z=min(zoom+${inc}\\,1.18):x=iw/2-(iw/zoom/2):y=(ih-ih/zoom)*on/${dFrames}:d=${dFrames}:s=1080x1920:fps=${FPS}`;
        break;
      case "pushInCentre":
      default:
        zoompan = `zoompan=z=min(zoom+${inc}\\,1.18):x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):d=${dFrames}:s=1080x1920:fps=${FPS}`;
    }
    return [
      `[${slot}:v]setrange=tv`,
      `scale=1080:1920:force_original_aspect_ratio=increase`,
      `crop=1080:1920:(iw-1080)/2:(ih-1920)/2`,
      zoompan,
      trim,
      `format=yuv420p,setsar=1[v${slot}]`,
    ].join(",");
  }

  if (type === "card") {
    // Text-only takeaway card — black background with brand-amber
    // accent line + big text. We synthesise this via the `color`
    // filter source (no image input needed).
    const cardKind = scene.cardKind || "takeaway";
    const text = (scene.text || "").replace(/'/g, "’");
    // We inject the card by using the `color` source as input N.
    // The slot index maps to a CARD-typed input we pre-add to the
    // ffmpeg `inputs` list as `-f lavfi -i color=c=0x0D0D0F:s=1080x1920:r=30 -t <d>`.
    return [
      `[${slot}:v]setrange=tv`,
      `drawbox=x=0:y=h/2-150:w=iw:h=300:color=black@0.0:t=fill`,
      // Top amber accent line
      `drawbox=x=(w-600)/2:y=h/2-180:w=600:h=4:color=${ACCENT_COLOR}@0.95:t=fill`,
      // Bottom amber accent line
      `drawbox=x=(w-600)/2:y=h/2+180:w=600:h=4:color=${ACCENT_COLOR}@0.95:t=fill`,
      // Label small caps
      `drawtext=text='${cardKind.toUpperCase()}':${FONT_OPT}:fontcolor=${ACCENT_COLOR}:fontsize=28:x=(w-tw)/2:y=h/2-130`,
      // Big text
      `drawtext=text='${text}':${FONT_OPT}:fontcolor=white:fontsize=64:x=(w-tw)/2:y=h/2-30`,
      trim,
      `format=yuv420p,setsar=1[v${slot}]`,
    ].join(",");
  }

  throw new Error(`unknown scene type: ${type}`);
}

// ---- Transition strategy for the slate ---------------------------

/**
 * For the prototype: alternate hard cuts and 0.22s dissolves.
 * Tracks running duration so xfade offsets are correct after a
 * mixed cut/xfade chain.
 */
function buildTransitions(slate) {
  const out = [];
  let runningDur = slate[0].duration;
  for (let i = 0; i < slate.length - 1; i++) {
    const cut = i % 2 === 0; // even edges = cut, odd = dissolve
    if (cut) {
      out.push({ type: "cut", duration: 0, offset: runningDur });
      runningDur += slate[i + 1].duration;
    } else {
      const d = 0.22;
      const offset = runningDur - d;
      out.push({ type: "dissolve", duration: d, offset });
      runningDur = offset + slate[i + 1].duration;
    }
  }
  return { transitions: out, totalDur: runningDur };
}

function buildTransitionFilters(transitions) {
  const lines = [];
  let prev = "v0";
  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];
    const isLast = i === transitions.length - 1;
    const out = isLast ? "base" : `xf${i + 1}`;
    if (t.type === "cut") {
      lines.push(
        `[${prev}][v${i + 1}]concat=n=2:v=1:a=0,fps=${FPS},setpts=PTS-STARTPTS[${out}]`,
      );
    } else {
      lines.push(
        `[${prev}][v${i + 1}]xfade=transition=dissolve:duration=${t.duration}:offset=${t.offset.toFixed(2)}[${out}]`,
      );
    }
    prev = out;
  }
  return lines;
}

// ---- ASS captions -----------------------------------------------

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

// ---- Main --------------------------------------------------------

async function main() {
  await fs.ensureDir(TEST_OUT);

  // 1. Load story metadata
  const story = await loadStory();
  if (!story) throw new Error(`no DB row for ${STORY_ID}`);

  const audioPath = path.join(ROOT, "output", "audio", `${STORY_ID}.mp3`);
  const tsPath = path.join(
    ROOT,
    "output",
    "audio",
    `${STORY_ID}_timestamps.json`,
  );
  const musicPath = path.join(ROOT, "audio", "Main Background Loop 1.wav");
  if (!(await fs.pathExists(audioPath)))
    throw new Error(`audio missing: ${audioPath}`);
  const duration = ffprobeDuration(audioPath);
  console.log(`[proto] ${STORY_ID} narration ${duration.toFixed(2)}s`);

  // 2. Smart-crop the article hero + trailer-frames
  const cache = path.join(ROOT, "output", "image_cache");
  const stillSources = {
    articleHero: path.join(cache, `${STORY_ID}_article.jpg`),
    frame1: path.join(cache, `${STORY_ID}_trailerframe_1.jpg`),
    frame2: path.join(cache, `${STORY_ID}_trailerframe_2.jpg`),
    frame3: path.join(cache, `${STORY_ID}_trailerframe_3.jpg`),
    frame4: path.join(cache, `${STORY_ID}_trailerframe_4.jpg`),
    frame5: path.join(cache, `${STORY_ID}_trailerframe_5.jpg`),
    frame6: path.join(cache, `${STORY_ID}_trailerframe_6.jpg`),
  };
  const stillCropped = {};
  for (const [k, p] of Object.entries(stillSources)) {
    stillCropped[k] = await smartCropToReel(p);
  }

  // 3. Clip paths
  const vc = path.join(ROOT, "output", "video_cache");
  const clipA = path.join(vc, `${STORY_ID}_clip_A.mp4`);
  const clipB = path.join(vc, `${STORY_ID}_clip_B.mp4`);
  const clipC = path.join(vc, `${STORY_ID}_clip_C.mp4`);
  for (const f of [clipA, clipB, clipC]) {
    if (!(await fs.pathExists(f))) throw new Error(`clip missing: ${f}`);
  }

  // 4. Build the slate
  const slate = buildSlate({ ...stillCropped, clipA, clipB, clipC });
  console.log(`[proto] slate: ${slate.length} scenes`);
  for (const s of slate) {
    console.log(
      `  - [${s.type.padEnd(5)}] ${s.label.padEnd(22)} ${s.duration}s`,
    );
  }

  // 5. Build inputs list
  const inputs = [];
  for (const scene of slate) {
    if (scene.type === "still") {
      inputs.push(
        `-loop 1 -t ${(scene.duration + 1).toFixed(2)} -i "${scene.source.replace(/\\/g, "/")}"`,
      );
    } else if (scene.type === "clip") {
      // Trim to duration to keep input bounds tight.
      inputs.push(
        `-t ${(scene.duration + 0.2).toFixed(2)} -i "${scene.source.replace(/\\/g, "/")}"`,
      );
    } else if (scene.type === "card") {
      // Synthetic black background — fed to drawtext via lavfi.
      inputs.push(
        `-f lavfi -t ${(scene.duration + 1).toFixed(2)} -i color=c=0x0D0D0F:s=1080x1920:r=${FPS}`,
      );
    }
  }
  const audioIdx = inputs.length;
  inputs.push(`-i "${audioPath.replace(/\\/g, "/")}"`);
  let musicIdx = -1;
  if (await fs.pathExists(musicPath)) {
    musicIdx = audioIdx + 1;
    inputs.push(`-stream_loop -1 -i "${musicPath.replace(/\\/g, "/")}"`);
  }

  // 6. Per-scene filters
  const filterParts = [];
  for (let i = 0; i < slate.length; i++) {
    filterParts.push(buildSceneFilter(slate[i], i));
  }

  // 7. Transitions
  const { transitions, totalDur } = buildTransitions(slate);
  console.log(
    `[proto] running duration after transitions: ${totalDur.toFixed(2)}s (audio ${duration.toFixed(2)}s)`,
  );
  filterParts.push(...buildTransitionFilters(transitions));

  // 8. PRL overlay layer (badge / source bug / lower third / hot-take)
  let lastLabel = "base";
  const prlChain = buildPrlChain({
    story,
    fontOpt: FONT_OPT,
    videoDuration: duration,
    options: {
      enableStatCard: false, // no Steam metrics on this story
      enableHotTake: false, // we have a dedicated takeaway card scene now
    },
  });
  if (prlChain.length) {
    filterParts.push(`[${lastLabel}]${prlChain.join(",")}[afterprl]`);
    lastLabel = "afterprl";
  }

  // 9. Hook opener (0-3s overlay)
  const opener = composeOpenerOverlay(story);
  const openerFilters = buildOpenerDrawtext(opener, {
    fontOpt: FONT_OPT,
    accentColor: ACCENT_COLOR,
  });
  if (openerFilters.length) {
    filterParts.push(`[${lastLabel}]${openerFilters.join(",")}[afterhook]`);
    lastLabel = "afterhook";
  }

  // 10. ASS captions
  const tsData = await fs.readJson(tsPath);
  let words = [];
  if (Array.isArray(tsData?.words)) words = tsData.words;
  else if (Array.isArray(tsData?.alignment?.words))
    words = tsData.alignment.words;
  else if (Array.isArray(tsData?.characters))
    words = inlineCharsToWords(tsData);
  else if (Array.isArray(tsData?.alignment?.characters))
    words = inlineCharsToWords(tsData.alignment);
  const assContent = buildAss({ story, words, duration });
  const assPath = path.join(TEST_OUT, `${STORY_ID}_proto.ass`);
  await fs.writeFile(assPath, assContent);
  const assRel = path.relative(ROOT, assPath).replace(/\\/g, "/");
  filterParts.push(`[${lastLabel}]ass=${assRel}[outv]`);

  // 11. Audio mixing
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

  // 12. Assemble + run
  const filterScript = path.join(TEST_OUT, `${STORY_ID}_proto_filter.txt`);
  await fs.writeFile(filterScript, filterParts.join(";\n"));
  const outputPath = path.join(TEST_OUT, `proto_${STORY_ID}.mp4`);

  const cmd = [
    `ffmpeg -y -hide_banner -loglevel warning`,
    inputs.join(" "),
    `-filter_complex_script "${filterScript.replace(/\\/g, "/")}"`,
    audioMapping,
    `-c:v libx264 -crf 21 -preset medium`,
    `-pix_fmt yuv420p -profile:v high -level:v 4.0`,
    `-c:a aac -b:a 192k`,
    `-r ${FPS} -shortest`,
    `-movflags +faststart "${outputPath.replace(/\\/g, "/")}"`,
  ].join(" ");

  console.log(`[proto] rendering...`);
  const t0 = Date.now();
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
  const elapsed = Date.now() - t0;

  // 13. ffprobe the result
  const probeOut = execSync(
    `ffprobe -v quiet -print_format json -show_format -show_streams "${outputPath.replace(/\\/g, "/")}"`,
    { encoding: "utf8" },
  );
  const probe = JSON.parse(probeOut);
  const v = probe.streams.find((s) => s.codec_type === "video");
  console.log(``);
  console.log(`=== Render complete (${elapsed} ms) ===`);
  console.log(`  output: ${outputPath}`);
  console.log(`  duration: ${parseFloat(probe.format.duration).toFixed(2)}s`);
  console.log(
    `  size: ${(parseInt(probe.format.size, 10) / 1024 / 1024).toFixed(1)} MB`,
  );
  console.log(
    `  bitrate: ${Math.round(parseInt(probe.format.bit_rate, 10) / 1000)} kbps`,
  );
  console.log(`  resolution: ${v?.width}x${v?.height} ${v?.pix_fmt}`);
  console.log(``);
  console.log(`Source mix:`);
  const counts = { article: 0, frame: 0, clip: 0, card: 0 };
  for (const s of slate) {
    if (s.type === "card") counts.card++;
    else if (s.type === "clip") counts.clip++;
    else if (s.label.includes("article")) counts.article++;
    else if (s.label.includes("frame")) counts.frame++;
  }
  console.log(`  article hero: ${counts.article} scenes`);
  console.log(`  trailer frames: ${counts.frame} scenes`);
  console.log(`  trailer clips: ${counts.clip} scenes`);
  console.log(`  cards: ${counts.card} scenes`);
  console.log(`  STOCK FILLER: 0 scenes  ←  the whole point`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
