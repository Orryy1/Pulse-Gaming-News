"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execSync } = require("node:child_process");

const { smartCropToReel } = require("../lib/image-crop");
const { composeStudioSlate } = require("../lib/scene-composer");
const { buildPrlChain } = require("../lib/prl-overlays");
const { buildStudioEditorial, scriptFromTimestampAlignment } = require("../lib/studio/editorial-layer");
const {
  discoverLocalStudioMedia,
  ensureTrailerClipSlices,
  ensureTrailerFrames,
  rankSourceDiversity,
  ffprobeDuration,
} = require("../lib/studio/media-acquisition");
const { applyPremiumCardLane } = require("../lib/studio/premium-card-lane");
const {
  buildSceneInput,
  dispatchSceneFilter,
  buildTransitionPlan,
  buildTransitionFilters,
  FPS,
} = require("../lib/studio/ffmpeg-scene-renderer");
const {
  ensureTrimmedLocalLiam,
  ensureFreshLocalLiam,
  ensureProductionElevenLabsVoice,
  discoverSoundAssets,
  buildAudioInputSpecs,
  buildAudioMixFilters,
  cueTimesForScenes,
} = require("../lib/studio/sound-layer");
const { buildStudioSubtitles } = require("../lib/studio/subtitle-layer");
const { buildQualityReport } = require("../lib/studio/quality-gate");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");
const STORY_ID = process.argv[2] || "1sn9xhe";
const OUTPUT_SUFFIX = process.env.STUDIO_V1_OUTPUT_SUFFIX || "";
const FONT_OPT =
  process.platform === "win32"
    ? "fontfile='C\\:/Windows/Fonts/arial.ttf'"
    : "font='DejaVu Sans'";

function loadStory(storyId) {
  const Database = require("better-sqlite3");
  const db = new Database(path.join(ROOT, "data", "pulse.db"), {
    readonly: true,
  });
  const row = db
    .prepare(
      `SELECT id, title, hook, body, full_script, classification,
              flair, subreddit, source_type, top_comment
       FROM stories WHERE id = ?`,
    )
    .get(storyId);
  db.close();
  if (!row) throw new Error(`no story row found for ${storyId}`);
  return row;
}

function ffprobeJson(file) {
  return JSON.parse(
    execSync(
      `ffprobe -v quiet -print_format json -show_format -show_streams "${file.replace(/\\/g, "/")}"`,
      { encoding: "utf8" },
    ),
  );
}

function currentBranch() {
  try {
    return execSync("git branch --show-current", {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

async function preprocessStills(media) {
  return {
    ...media,
    trailerFrames: await Promise.all(
      media.trailerFrames.map(async (frame) => ({
        ...frame,
        path: await smartCropToReel(frame.path),
      })),
    ),
    articleHeroes: await Promise.all(
      media.articleHeroes.map(async (hero) => ({
        ...hero,
        path: await smartCropToReel(hero.path),
      })),
    ),
    publisherAssets: await Promise.all(
      media.publisherAssets.map(async (asset) => ({
        ...asset,
        path: await smartCropToReel(asset.path),
      })),
    ),
  };
}

function offsetAudioIndices(indices, offset) {
  return {
    voice: indices.voice + offset,
    music: indices.music === null || indices.music === undefined ? null : indices.music + offset,
    stings: (indices.stings || []).map((item) => ({
      ...item,
      index: item.index + offset,
    })),
  };
}

async function main() {
  await fs.ensureDir(TEST_OUT);

  const story = loadStory(STORY_ID);
  const editorial = buildStudioEditorial(story);

  let media = await discoverLocalStudioMedia({ root: ROOT, storyId: STORY_ID });
  media = await ensureTrailerClipSlices({ root: ROOT, storyId: STORY_ID, media });
  media = await ensureTrailerFrames({ root: ROOT, storyId: STORY_ID, media });
  const mediaDiversity = rankSourceDiversity(media);
  const croppedMedia = await preprocessStills(media);

  const voiceMode = (process.env.STUDIO_V1_VOICE || "production").toLowerCase();
  let voice;
  if (voiceMode === "production" || voiceMode === "elevenlabs") {
    voice = await ensureProductionElevenLabsVoice({
      root: ROOT,
      storyId: STORY_ID,
      editorial,
      force: process.env.STUDIO_V1_FORCE_TTS === "true",
    }).catch(async (err) => {
      if (process.env.STUDIO_V1_ALLOW_VOICE_FALLBACK !== "true") throw err;
      const fallback = await ensureFreshLocalLiam({
        root: ROOT,
        storyId: STORY_ID,
        editorial,
        force: false,
      }).catch(() => ensureTrimmedLocalLiam({ root: ROOT, storyId: STORY_ID }));
      return {
        ...fallback,
        warning: `production ElevenLabs voice failed: ${err.message}`,
        editorialScriptAppliedToAudio: false,
      };
    });
  } else {
    voice = await ensureFreshLocalLiam({
      root: ROOT,
      storyId: STORY_ID,
      editorial,
      force: process.env.STUDIO_V1_FORCE_TTS === "true",
    }).catch(async (err) => {
      if (process.env.STUDIO_V1_REQUIRE_FRESH_TTS === "true") throw err;
      const fallback = await ensureTrimmedLocalLiam({ root: ROOT, storyId: STORY_ID });
      return {
        ...fallback,
        warning: `fresh local Liam failed: ${err.message}`,
        editorialScriptAppliedToAudio: false,
      };
    });
  }
  if (!(await fs.pathExists(voice.audioPath))) {
    throw new Error(`voice audio missing: ${voice.audioPath}`);
  }
  const audioDurationS = ffprobeDuration(voice.audioPath);
  const tsData = await fs.readJson(voice.timestampsPath);
  const spokenTranscript = scriptFromTimestampAlignment(tsData);

  const renderStory = {
    ...story,
    hook: editorial.hook,
    body: editorial.body,
    full_script: editorial.scriptForCaption,
    studio_editorial_script: editorial.fullScript,
    studio_spoken_transcript: spokenTranscript,
  };

  const composed = composeStudioSlate({
    story: renderStory,
    media: croppedMedia,
    audioDurationS,
    opts: {
      takeawayText: "WATCH THE FULL TRAILER",
      cta: "FOLLOW FOR MORE",
      allowStockFiller: false,
    },
  });
  const lane = applyPremiumCardLane({
    scenes: composed.scenes,
    story: renderStory,
    root: ROOT,
  });
  const scenes = lane.scenes;

  console.log(
    `[studio-v1] ${STORY_ID}: audio=${audioDurationS.toFixed(2)}s scenes=${scenes.length}`,
  );
  for (const scene of scenes) {
    const premium = scene.premiumLane ? ` ${scene.premiumLane}` : "";
    console.log(
      `  - ${scene.type.padEnd(14)} ${String(scene.label || "").padEnd(20)} ${Number(scene.duration).toFixed(2)}s${premium}`,
    );
  }

  const sceneInputs = scenes.map(buildSceneInput);
  const soundAssets = discoverSoundAssets(ROOT);
  const cues = cueTimesForScenes(scenes);
  const audioSpecs = buildAudioInputSpecs({
    voicePath: voice.audioPath,
    musicPath: soundAssets.musicPath,
    stingPath: soundAssets.stingPath,
    cueTimesS: cues,
  });
  const audioIndices = offsetAudioIndices(audioSpecs.indices, sceneInputs.length);
  const inputs = [...sceneInputs, ...audioSpecs.inputs];

  const filterParts = scenes.map((scene, index) =>
    dispatchSceneFilter({ slot: index, scene, story: renderStory, fontOpt: FONT_OPT }),
  );

  const transitions = buildTransitionPlan(scenes);
  filterParts.push(...buildTransitionFilters(transitions));

  let lastLabel = "base";
  const polish = buildPrlChain({
    story: renderStory,
    fontOpt: FONT_OPT,
    videoDuration: audioDurationS,
    options: {
      enableLowerThird: false,
      enableBadge: false,
      enableSourceBug: false,
      enableStatCard: false,
      enableCommentSwoop: false,
      enableHotTake: false,
    },
  });
  if (polish.length) {
    filterParts.push(`[${lastLabel}]${polish.join(",")}[afterpolish]`);
    lastLabel = "afterpolish";
  }

  const assPath = path.join(TEST_OUT, `${STORY_ID}_studio_v1${OUTPUT_SUFFIX}.ass`);
  const subtitleResult = await buildStudioSubtitles({
    story: renderStory,
    timestampsPath: voice.timestampsPath,
    durationS: audioDurationS,
    scriptText: editorial.scriptForCaption,
    outputPath: assPath,
  });
  if (
    process.env.STUDIO_V1_REQUIRE_TRUE_SUBTITLES === "true" &&
    subtitleResult?.inspection?.fallbackUsed
  ) {
    throw new Error(
      `[studio-v1] subtitle fallback was used: ${subtitleResult.inspection.fallbackReason}`,
    );
  }
  const assRel = path.relative(ROOT, assPath).replace(/\\/g, "/");
  filterParts.push(`[${lastLabel}]ass=${assRel}[outv]`);

  filterParts.push(...buildAudioMixFilters({ indices: audioIndices, outputLabel: "outa" }));

  const filterPath = path.join(TEST_OUT, `${STORY_ID}_studio_v1${OUTPUT_SUFFIX}_filter.txt`);
  await fs.writeFile(filterPath, filterParts.join(";\n"));

  const outputPath = path.join(TEST_OUT, `studio_v1_${STORY_ID}${OUTPUT_SUFFIX}.mp4`);
  const command = [
    "ffmpeg -y -hide_banner -loglevel warning",
    inputs.join(" "),
    `-filter_complex_script "${filterPath.replace(/\\/g, "/")}"`,
    '-map "[outv]" -map "[outa]"',
    "-c:v libx264 -crf 21 -preset medium",
    "-pix_fmt yuv420p -profile:v high -level:v 4.0",
    "-c:a aac -b:a 192k",
    `-r ${FPS} -shortest`,
    `-movflags +faststart "${outputPath.replace(/\\/g, "/")}"`,
  ].join(" ");

  console.log("[studio-v1] rendering...");
  const start = Date.now();
  execSync(command, {
    cwd: ROOT,
    stdio: "inherit",
    maxBuffer: 80 * 1024 * 1024,
  });
  const elapsedMs = Date.now() - start;

  const probe = ffprobeJson(outputPath);
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const output = {
    path: path.relative(ROOT, outputPath).replace(/\\/g, "/"),
    durationS: Number.parseFloat(probe.format.duration),
    sizeBytes: Number.parseInt(probe.format.size, 10),
    bitrateKbps: Math.round(Number.parseInt(probe.format.bit_rate, 10) / 1000),
    width: video?.width,
    height: video?.height,
    pixFmt: video?.pix_fmt,
    profile: video?.profile,
    elapsedMs,
  };

  const voiceForReport = {
    ...voice,
    audioPath: path.relative(ROOT, voice.audioPath).replace(/\\/g, "/"),
    timestampsPath: path.relative(ROOT, voice.timestampsPath).replace(/\\/g, "/"),
    audioDurationS,
    editorialScriptAppliedToAudio: voice.editorialScriptAppliedToAudio === true,
    timestampSource: voice.timestampSource || null,
    spokenTranscriptWordCount: spokenTranscript
      ? spokenTranscript.split(/\s+/).filter(Boolean).length
      : null,
    note: voice.editorialScriptAppliedToAudio
      ? voice.source === "elevenlabs-production-path"
        ? "Generated fresh ElevenLabs narration from the tightened v1 editorial script using the production voice path."
        : "Generated fresh local Liam narration from the tightened v1 editorial script."
      : voice.wasTrimmed
      ? "Used the newest local Liam-style fixture with the generic CTA trimmed."
      : "Used the newest local Liam-style fixture. Full v1 script regeneration was skipped because the local TTS server was not already running.",
  };

  const report = buildQualityReport({
    storyId: STORY_ID,
    branch: currentBranch(),
    output,
    scenes,
    editorial: {
      ...editorial,
      renderedCaptionWordCount: editorial.scriptForCaption
        .split(/\s+/)
        .filter(Boolean).length,
    },
    mediaDiversity,
    voice: voiceForReport,
    subtitles: subtitleResult,
    premiumLane: lane.premiumLane,
  });
  report.sceneList = scenes.map((scene) => ({
    type: scene.type,
    label: scene.label,
    duration: scene.duration,
    source:
      scene.source ||
      scene.backgroundSource ||
      scene.prerenderedMp4 ||
      scene.statLabel ||
      scene.dateLabel ||
      null,
    premiumLane: scene.premiumLane || null,
  }));
  report.transitions = transitions;

  const reportPath = path.join(TEST_OUT, `${STORY_ID}_studio_v1${OUTPUT_SUFFIX}_report.json`);
  await fs.writeJson(reportPath, report, { spaces: 2 });

  console.log("");
  console.log(`=== Studio Short Engine v1 render complete (${elapsedMs} ms) ===`);
  console.log(`  output: ${outputPath}`);
  console.log(`  report: ${reportPath}`);
  console.log(`  duration: ${output.durationS.toFixed(2)}s`);
  console.log(`  mix: clips=${report.clipCount}, stills=${report.stillCount}, cards=${report.cardCount}`);
  console.log(`  slideshow: ${report.slideshowLikeVerdict}`);
  console.log(`  premium lane: ${report.premiumLaneVerdict}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
