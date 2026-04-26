/**
 * tools/studio-prototype.js — Studio Short Engine prototype renderer.
 *
 * Successor to tools/quality-prototype.js. Where the old prototype
 * had a hand-tuned 12-scene slate, this renderer:
 *
 *   1. Builds a typed scene list via lib/scene-composer.js (anti-
 *      repetition + budgeting + scene-type variety baked in).
 *   2. Dispatches each scene to the right per-type filter generator
 *      (clip, still, clip.frame, opener, card.source, card.release,
 *      card.quote, card.takeaway).
 *   3. Writes a structured metrics report to test/output/<id>_studio_metrics.json
 *      so the quality harness can judge the result.
 *
 * Single story (1sn9xhe), all-ffmpeg, zero HyperFrames.
 *
 * Usage: node tools/studio-prototype.js
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
const {
  composeStudioSlate,
  SCENE_TYPES,
  computeMetrics,
} = require("../lib/scene-composer");
const { buildSourceCardFilter } = require("../lib/scenes/source-card");
const {
  buildReleaseDateCardFilter,
} = require("../lib/scenes/release-date-card");
const { buildQuoteCardFilter } = require("../lib/scenes/quote-card");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");
const STORY_ID = "1sn9xhe";
const FPS = 30;

const ACCENT_COLOR = "0xFF6B1A";
const FONT_OPT =
  process.platform === "win32"
    ? "fontfile='C\\:/Windows/Fonts/arial.ttf'"
    : "font='DejaVu Sans'";

// ---- Fixture loading ---------------------------------------------

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

async function discoverMedia() {
  const cache = path.join(ROOT, "output", "image_cache");
  const vc = path.join(ROOT, "output", "video_cache");

  const articleHero = path.join(cache, `${STORY_ID}_article.jpg`);
  const articleHeroes = (await fs.pathExists(articleHero))
    ? [{ path: articleHero }]
    : [];

  const trailerFrames = [];
  for (let i = 1; i <= 6; i++) {
    const p = path.join(cache, `${STORY_ID}_trailerframe_${i}.jpg`);
    if (await fs.pathExists(p)) trailerFrames.push({ path: p });
  }

  const clips = [];
  for (const tag of ["A", "B", "C"]) {
    const p = path.join(vc, `${STORY_ID}_clip_${tag}.mp4`);
    if (await fs.pathExists(p)) {
      clips.push({ path: p, durationS: ffprobeDuration(p) });
    }
  }

  return {
    clips,
    trailerFrames,
    articleHeroes,
    publisherAssets: [],
    stockFillers: [],
  };
}

// ---- Smart-crop the still inputs ---------------------------------

async function preprocessStills(media) {
  const out = { ...media };
  out.trailerFrames = await Promise.all(
    media.trailerFrames.map(async (f) => ({
      ...f,
      path: await smartCropToReel(f.path),
    })),
  );
  out.articleHeroes = await Promise.all(
    media.articleHeroes.map(async (h) => ({
      ...h,
      path: await smartCropToReel(h.path),
    })),
  );
  return out;
}

// ---- Per-scene filter dispatch -----------------------------------

/**
 * Build per-image motion filter (used by still + clip.frame + opener).
 * Pulled inline rather than from lib/motion.js so the slot index +
 * input-side scaling stay co-located.
 */
function buildMotionFilter({ slot, duration, motion }) {
  const dFrames = Math.max(1, Math.round(duration * FPS));
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
    `trim=duration=${duration},setpts=PTS-STARTPTS`,
    `format=yuv420p,setsar=1[v${slot}]`,
  ].join(",");
}

function buildClipFilter({ slot, duration }) {
  const trim = `trim=duration=${duration},setpts=PTS-STARTPTS`;
  return [
    `[${slot}:v]setrange=tv`,
    `scale=1080:1920:force_original_aspect_ratio=increase`,
    `crop=1080:1920:(iw-1080)/2:(ih-1920)/2`,
    `fps=${FPS}`,
    trim,
    `format=yuv420p,setsar=1[v${slot}]`,
  ].join(",");
}

/**
 * Studio opener: clip-backed if available, else article hero.
 * Adds a punchy 0–1.5s headline overlay over the first second.
 */
function buildOpenerFilter({ slot, scene, story, fontOpt }) {
  const dFrames = Math.max(1, Math.round(scene.duration * FPS));
  const baseBlock = scene.isClipBacked
    ? [
        `[${slot}:v]setrange=tv`,
        `scale=1080:1920:force_original_aspect_ratio=increase`,
        `crop=1080:1920:(iw-1080)/2:(ih-1920)/2`,
        `fps=${FPS}`,
      ]
    : [
        `[${slot}:v]setrange=tv`,
        `scale=1080:1920:force_original_aspect_ratio=increase`,
        `crop=1080:1920:(iw-1080)/2:(ih-1920)/2`,
        `zoompan=z=min(zoom+${Math.round(10000 * (0.2 / dFrames)) / 10000}\\,1.20):x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):d=${dFrames}:s=1080x1920:fps=${FPS}`,
      ];

  // Headline derived from story.hook tightened. We compose a
  // SHORT 1.5s flash above the existing per-video opener overlay
  // (which lives in the global PRL chain). The headline here is
  // the SCENE-LOCAL hook flash — high-contrast bar across the top.
  const hook = (story?.hook || story?.title || "")
    .split(/[.!?]/)[0]
    .trim()
    .toUpperCase()
    .replace(/'/g, "’");
  const escaped = hook
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/=/g, "\\=")
    .replace(/%/g, "\\%");

  return [
    ...baseBlock,
    // Top high-contrast claim bar
    `drawbox=x=0:y=200:w=iw:h=160:color=black@0.85:t=fill:enable='lt(t\\,1.6)'`,
    `drawbox=x=0:y=355:w=iw:h=4:color=${ACCENT_COLOR}@0.95:t=fill:enable='lt(t\\,1.6)'`,
    `drawtext=text='${escaped}':${fontOpt}:fontcolor=white:fontsize=52:x=(w-tw)/2:y=240:enable='lt(t\\,1.6)':alpha='if(lt(t\\,0.15)\\,t/0.15\\,if(gt(t\\,1.4)\\,1-(t-1.4)/0.2\\,1))'`,
    `trim=duration=${scene.duration},setpts=PTS-STARTPTS`,
    `format=yuv420p,setsar=1[v${slot}]`,
  ].join(",");
}

/**
 * Card.takeaway filter — same code path as the v1 prototype's
 * redesigned takeaway card, kept here for the studio renderer.
 */
function buildTakeawayCardFilter({ slot, duration, scene, fontOpt }) {
  const text = (scene.text || "WATCH THE FULL TRAILER").replace(/'/g, "’");
  const cta = (scene.cta || "FOLLOW FOR MORE").replace(/'/g, "’");
  const cardKind = scene.cardKind || "takeaway";
  const fadeIn = (start, dur = 0.4) =>
    `alpha='if(lt(t\\,${start})\\,0\\,if(lt(t-${start}\\,${dur})\\,(t-${start})/${dur}\\,1))'`;
  return [
    `[${slot}:v]setrange=tv`,
    `scale=1080:1920:force_original_aspect_ratio=increase`,
    `crop=1080:1920:(iw-1080)/2:(ih-1920)/2`,
    // Force 30fps for xfade compat with clip/still scenes
    `fps=30`,
    `boxblur=20:6`,
    `eq=brightness=-0.35:saturation=0.55:contrast=1.05`,
    `drawbox=x=0:y=0:w=iw:h=400:color=black@0.55:t=fill`,
    `drawbox=x=0:y=h-500:w=iw:h=500:color=black@0.55:t=fill`,
    `drawbox=x=(w-1)/2:y=h/2-220:w='if(lt(t\\,0.6)\\,1+(700-1)*t/0.6\\,700)':h=3:color=${ACCENT_COLOR}@0.95:t=fill`,
    `drawbox=x=(w-1)/2:y=h/2+200:w='if(lt(t\\,0.6)\\,1+(700-1)*t/0.6\\,700)':h=3:color=${ACCENT_COLOR}@0.95:t=fill`,
    `drawtext=text='${cardKind.toUpperCase()}':${fontOpt}:fontcolor=${ACCENT_COLOR}:fontsize=32:x=(w-tw)/2:y=h/2-170:${fadeIn(0, 0.4)}`,
    `drawtext=text='${text}':${fontOpt}:fontcolor=black@0.7:fontsize=78:x=(w-tw)/2+4:y=h/2-40+4:${fadeIn(0.4, 0.6)}`,
    `drawtext=text='${text}':${fontOpt}:fontcolor=white:fontsize=78:x=(w-tw)/2:y=h/2-40:${fadeIn(0.4, 0.6)}`,
    `drawtext=text='   ${cta}   ':${fontOpt}:fontcolor=black:fontsize=32:x=(w-tw)/2:y=h/2+108:box=1:boxcolor=${ACCENT_COLOR}@0.95:boxborderw=18:${fadeIn(1.0, 0.6)}`,
    `drawtext=text='^':${fontOpt}:fontcolor=${ACCENT_COLOR}:fontsize=64:x=(w-tw)/2:y='h/2+50-15*sin(2*PI*(t-1.6)/1.5)':${fadeIn(1.6, 0.4)}`,
    `trim=duration=${duration},setpts=PTS-STARTPTS`,
    `format=yuv420p,setsar=1[v${slot}]`,
  ].join(",");
}

function dispatchSceneFilter({ slot, scene, story, fontOpt }) {
  switch (scene.type) {
    case SCENE_TYPES.CLIP:
      return buildClipFilter({ slot, duration: scene.duration });
    case SCENE_TYPES.STILL:
    case SCENE_TYPES.CLIP_FRAME:
      return buildMotionFilter({
        slot,
        duration: scene.duration,
        motion: scene.motion || "pushInCentre",
      });
    case SCENE_TYPES.OPENER:
      return buildOpenerFilter({ slot, scene, story, fontOpt });
    case SCENE_TYPES.CARD_SOURCE:
      return buildSourceCardFilter({
        slot,
        duration: scene.duration,
        sourceLabel: scene.sourceLabel,
        sublabel: scene.sublabel,
        fontOpt,
      });
    case SCENE_TYPES.CARD_RELEASE:
      return buildReleaseDateCardFilter({
        slot,
        duration: scene.duration,
        dateLabel: scene.dateLabel,
        kicker: scene.kicker,
        sublabel: scene.sublabel,
        fontOpt,
      });
    case SCENE_TYPES.CARD_QUOTE:
      return buildQuoteCardFilter({
        slot,
        duration: scene.duration,
        body: scene.body,
        author: scene.author,
        score: scene.score,
        fontOpt,
      });
    case SCENE_TYPES.CARD_TAKEAWAY:
      return buildTakeawayCardFilter({
        slot,
        duration: scene.duration,
        scene,
        fontOpt,
      });
    default:
      throw new Error(`unknown scene type: ${scene.type}`);
  }
}

/**
 * For each scene, decide what the input is. Cards use their
 * backgroundSource as a looped image input. Clips use the source
 * file directly. Stills loop the image.
 */
function buildSceneInput(scene) {
  const dur = (scene.duration + 1).toFixed(2);
  const escape = (p) => p.replace(/\\/g, "/");
  switch (scene.type) {
    case SCENE_TYPES.CLIP:
      return `-t ${dur} -i "${escape(scene.source)}"`;
    case SCENE_TYPES.STILL:
    case SCENE_TYPES.CLIP_FRAME:
      return `-loop 1 -t ${dur} -i "${escape(scene.source)}"`;
    case SCENE_TYPES.OPENER:
      if (scene.isClipBacked) {
        return `-t ${dur} -i "${escape(scene.source)}"`;
      }
      return `-loop 1 -t ${dur} -i "${escape(scene.source)}"`;
    case SCENE_TYPES.CARD_SOURCE:
    case SCENE_TYPES.CARD_RELEASE:
    case SCENE_TYPES.CARD_QUOTE:
    case SCENE_TYPES.CARD_TAKEAWAY:
      if (scene.backgroundSource) {
        return `-loop 1 -t ${dur} -i "${escape(scene.backgroundSource)}"`;
      }
      return `-f lavfi -t ${dur} -i color=c=0x0D0D0F:s=1080x1920:r=${FPS}`;
    default:
      throw new Error(`unknown scene type: ${scene.type}`);
  }
}

// ---- Mixed cut/dissolve transition strategy ---------------------

function buildTransitionPlan(scenes) {
  const out = [];
  let runningDur = scenes[0].duration;
  for (let i = 0; i < scenes.length - 1; i++) {
    // First edge always cut, last edge soft dissolve, others
    // alternate cut / 0.22s dissolve / occasional 0.25s slide.
    let type, duration;
    if (i === 0) {
      type = "cut";
      duration = 0;
    } else if (i === scenes.length - 2) {
      type = "dissolve";
      duration = 0.3;
    } else if (i % 5 === 4) {
      type = "slideleft";
      duration = 0.25;
    } else if (i % 2 === 0) {
      type = "cut";
      duration = 0;
    } else {
      type = "dissolve";
      duration = 0.22;
    }
    let offset;
    if (type === "cut") {
      offset = runningDur;
      runningDur += scenes[i + 1].duration;
    } else {
      offset = runningDur - duration;
      runningDur = offset + scenes[i + 1].duration;
    }
    out.push({ type, duration, offset });
  }
  return out;
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
        `[${prev}][v${i + 1}]xfade=transition=${t.type}:duration=${t.duration}:offset=${t.offset.toFixed(2)}[${out}]`,
      );
    }
    prev = out;
  }
  return lines;
}

// ---- ASS captions ------------------------------------------------

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
  if (!(await fs.pathExists(audioPath))) throw new Error(`audio missing`);
  const audioDuration = ffprobeDuration(audioPath);

  const rawMedia = await discoverMedia();
  const media = await preprocessStills(rawMedia);
  console.log(
    `[studio] ${STORY_ID} audio=${audioDuration.toFixed(2)}s   clips=${media.clips.length} frames=${media.trailerFrames.length} hero=${media.articleHeroes.length}`,
  );

  // 1. Compose typed slate
  const { scenes, metrics } = composeStudioSlate({
    story,
    media,
    audioDurationS: audioDuration,
    opts: { takeawayText: "WATCH THE FULL TRAILER", cta: "FOLLOW FOR MORE" },
  });
  console.log(`[studio] composer produced ${scenes.length} scenes:`);
  for (const s of scenes) {
    console.log(
      `  - [${s.type.padEnd(15)}] ${s.label.padEnd(22)} ${s.duration.toFixed(2)}s`,
    );
  }
  console.log(`[studio] metrics:`, JSON.stringify(metrics));

  // 2. Build inputs list
  const inputs = scenes.map(buildSceneInput);
  const audioIdx = inputs.length;
  inputs.push(`-i "${audioPath.replace(/\\/g, "/")}"`);
  let musicIdx = -1;
  if (await fs.pathExists(musicPath)) {
    musicIdx = audioIdx + 1;
    inputs.push(`-stream_loop -1 -i "${musicPath.replace(/\\/g, "/")}"`);
  }

  // 3. Per-scene filter graph
  const filterParts = scenes.map((scene, i) =>
    dispatchSceneFilter({ slot: i, scene, story, fontOpt: FONT_OPT }),
  );

  // 4. Transitions
  const transitions = buildTransitionPlan(scenes);
  filterParts.push(...buildTransitionFilters(transitions));
  let lastLabel = "base";

  // 5. PRL persistent overlay layer (badge + source bug + lower
  // third). DISABLE the comment swoop overlay since we have a
  // dedicated quote-card scene now. Disable stat card (no metrics).
  const prlChain = buildPrlChain({
    story,
    fontOpt: FONT_OPT,
    videoDuration: audioDuration,
    options: {
      enableStatCard: false,
      enableHotTake: false,
      enableCommentSwoop: false,
    },
  });
  if (prlChain.length) {
    filterParts.push(`[${lastLabel}]${prlChain.join(",")}[afterprl]`);
    lastLabel = "afterprl";
  }

  // 6. Hook opener overlay (on top of everything)
  const opener = composeOpenerOverlay(story);
  const openerFilters = buildOpenerDrawtext(opener, {
    fontOpt: FONT_OPT,
    accentColor: ACCENT_COLOR,
  });
  if (openerFilters.length) {
    filterParts.push(`[${lastLabel}]${openerFilters.join(",")}[afterhook]`);
    lastLabel = "afterhook";
  }

  // 7. ASS captions
  const tsData = await fs.readJson(tsPath);
  let words = [];
  if (Array.isArray(tsData?.words)) words = tsData.words;
  else if (Array.isArray(tsData?.alignment?.words))
    words = tsData.alignment.words;
  else if (Array.isArray(tsData?.characters))
    words = inlineCharsToWords(tsData);
  else if (Array.isArray(tsData?.alignment?.characters))
    words = inlineCharsToWords(tsData.alignment);
  const scriptText = story?.full_script || story?.body || story?.hook || "";
  const assContent = buildAss({
    story,
    words,
    duration: audioDuration,
    scriptText,
  });
  const assPath = path.join(TEST_OUT, `${STORY_ID}_studio.ass`);
  await fs.writeFile(assPath, assContent);
  const assRel = path.relative(ROOT, assPath).replace(/\\/g, "/");
  filterParts.push(`[${lastLabel}]ass=${assRel}[outv]`);

  // 8. Audio mixing
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

  // 9. Run ffmpeg
  const filterScript = path.join(TEST_OUT, `${STORY_ID}_studio_filter.txt`);
  await fs.writeFile(filterScript, filterParts.join(";\n"));
  const outputPath = path.join(TEST_OUT, `studio_${STORY_ID}.mp4`);
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

  console.log(`[studio] rendering...`);
  const t0 = Date.now();
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
  const elapsed = Date.now() - t0;

  // 10. ffprobe + metrics report
  const probe = JSON.parse(
    execSync(
      `ffprobe -v quiet -print_format json -show_format -show_streams "${outputPath.replace(/\\/g, "/")}"`,
      { encoding: "utf8" },
    ),
  );
  const v = probe.streams.find((s) => s.codec_type === "video");

  // Subtitle integrity: count Dialogue events + check that none run
  // past the audio duration.
  const assTxt = await fs.readFile(assPath, "utf8");
  const dialogueLines = assTxt
    .split("\n")
    .filter((l) => l.startsWith("Dialogue:"));
  let lastEnd = 0;
  for (const line of dialogueLines) {
    const m = line.match(/Dialogue:\s*\d+,([^,]+),([^,]+),/);
    if (m) {
      const parts = m[2].split(":").map(parseFloat);
      const end = parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (end > lastEnd) lastEnd = end;
    }
  }

  const finalMetrics = {
    storyId: STORY_ID,
    timestamp: new Date().toISOString(),
    elapsedMs: elapsed,
    output: {
      path: path.relative(ROOT, outputPath).replace(/\\/g, "/"),
      durationS: parseFloat(probe.format.duration),
      sizeBytes: parseInt(probe.format.size, 10),
      bitrateKbps: Math.round(parseInt(probe.format.bit_rate, 10) / 1000),
      width: v?.width,
      height: v?.height,
      pixFmt: v?.pix_fmt,
      profile: v?.profile,
    },
    audio: {
      narrationDurationS: audioDuration,
    },
    sourceMix: {
      // Counts from composer metrics — represents what the SLATE
      // requested. `stockFillerCount: 0` is the headline number.
      ...metrics,
    },
    sceneList: scenes.map((s) => ({
      type: s.type,
      label: s.label,
      duration: s.duration,
      sourceId:
        s.source ||
        s.backgroundSource ||
        (s.dateLabel ? `release:${s.dateLabel}` : null) ||
        (s.sourceLabel ? `source:${s.sourceLabel}` : null) ||
        null,
    })),
    subtitleIntegrity: {
      dialogueLines: dialogueLines.length,
      lastDialogueEndS: Number(lastEnd.toFixed(2)),
      runsPastAudio: lastEnd > audioDuration + 0.1,
    },
    verdict: {
      isSlideshow: metrics.isSlideshow,
      stockFreePercent:
        metrics.totalScenes > 0
          ? Math.round(
              (1 - metrics.stockFillerCount / metrics.totalScenes) * 100,
            )
          : 100,
      clipsAndCardsRatio:
        metrics.totalScenes > 0
          ? Number(
              (
                (metrics.clipCount + metrics.cardCount) /
                metrics.totalScenes
              ).toFixed(2),
            )
          : 0,
    },
  };

  const metricsPath = path.join(TEST_OUT, `${STORY_ID}_studio_metrics.json`);
  await fs.writeJson(metricsPath, finalMetrics, { spaces: 2 });

  console.log("");
  console.log(`=== Studio prototype render complete (${elapsed} ms) ===`);
  console.log(`  output:   ${outputPath}`);
  console.log(
    `  duration: ${finalMetrics.output.durationS}s (audio ${audioDuration.toFixed(2)}s)`,
  );
  console.log(
    `  size:     ${(finalMetrics.output.sizeBytes / 1024 / 1024).toFixed(1)} MB`,
  );
  console.log(`  bitrate:  ${finalMetrics.output.bitrateKbps} kbps`);
  console.log("");
  console.log(`Source mix:`);
  console.log(`  clips:           ${metrics.clipCount}`);
  console.log(`  trailer frames:  ${metrics.trailerFrameCount}`);
  console.log(`  article heroes:  ${metrics.articleHeroCount}`);
  console.log(`  cards:           ${metrics.cardCount}`);
  console.log(`  stock filler:    ${metrics.stockFillerCount}`);
  console.log(`  unique stills:   ${metrics.uniqueStillSources}`);
  console.log(`  repeated:        ${metrics.repeatedStillScenes}`);
  console.log(
    `  isSlideshow:     ${metrics.isSlideshow ? "YES (FAIL)" : "no"}`,
  );
  console.log("");
  console.log(`Metrics report:  ${metricsPath}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
