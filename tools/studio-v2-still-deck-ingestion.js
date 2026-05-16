#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execFileSync, execSync } = require("node:child_process");

try {
  require("dotenv").config();
} catch {}

const { composeStudioSlate, SCENE_TYPES } = require("../lib/scene-composer");
const mediaPaths = require("../lib/media-paths");
const {
  buildSceneInput,
  dispatchSceneFilter,
  FPS,
} = require("../lib/studio/ffmpeg-scene-renderer");
const {
  discoverLocalStudioMedia,
  ffprobeDuration,
  rankSourceDiversity,
} = require("../lib/studio/media-acquisition");
const {
  buildQualityReportV2,
} = require("../lib/studio/v2/quality-gate-v2");
const {
  compareForensicReports,
  runForensicQa,
} = require("../lib/studio/v2/forensic-qa-v2");
const { resolveAudioPlan } = require("../lib/studio/v2/audio-library");
const { buildSoundLayerV2 } = require("../lib/studio/v2/sound-layer-v2");
const {
  buildKineticAss,
  prepareSubtitleWords,
  realignTimestampsToScript,
} = require("../lib/studio/v2/subtitle-layer-v2");
const {
  alignSceneDurationsToWordBoundaries,
} = require("../lib/studio/v2/beat-aware-scene-durations");
const {
  buildFlashLaneOverlayPlan,
  buildFlashLaneOverlayFilters,
} = require("../lib/studio/v2/flash-lane-overlays");
const { buildStudioEditorial } = require("../lib/studio/editorial-layer");
const {
  cleanForTTS,
} = require("../audio");
const {
  ensureProductionLocalVoice,
  wordsFromAlignment,
  resolveStudioOutroLine,
} = require("../lib/studio/sound-layer");
const {
  buildStoryFromStillDeckPlan,
  buildStillDeckMarkdown,
  buildStillDeckMediaPackage,
  selectStillDeckPlan,
} = require("../lib/studio/v2/still-deck-ingestion");
const {
  renderStillImageEnrichmentMarkdown,
  runStillImageEnrichment,
} = require("../lib/still-image-enrichment");
const {
  resolveOfficialTrailerClipRefsForProof,
} = require("../lib/studio/v2/proof-official-clip-safety");
const {
  assertNarrationAllowedForProof,
  looksLikeLocalTtsPath,
} = require("../lib/studio/v2/proof-render-safety");
const {
  probeLocalAudioAcoustics,
} = require("../lib/ops/local-acoustic-probe");
const {
  assertFlashLaneProofReady,
  buildFlashLaneProofPreflight,
  buildFlashLaneProofReadinessSummary,
} = require("../lib/studio/v2/flash-lane-preflight");
const {
  classifyStudioV2Suitability,
  evaluateStillDeckRenderReadiness,
  recommendStudioV2Promotion,
} = require("../lib/studio/v2/still-deck-promotion");
const {
  FLASH_LANE_DEFAULT_MAX_WORDS,
} = require("../lib/studio/v2/flash-lane-production-contract");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output", "studio-v2-still-deck");
const SOURCE_OUT = path.join(OUT, "assets");
const DEFAULT_REPORT_CANDIDATES = [
  path.join(ROOT, "test", "output", "asset_acquisition_v16_gameplay_stills_apply_local.json"),
  path.join(ROOT, "test", "output", "asset_acquisition_v16_gameplay_stills.json"),
  path.join(ROOT, "test", "output", "asset_acquisition_v16_gameplay_stills_dry_run.json"),
  path.join(ROOT, "test", "output", "asset_acquisition_v15_multi_entity_apply_local.json"),
  path.join(ROOT, "test", "output", "asset_acquisition_v15_multi_entity_dry_run.json"),
  path.join(ROOT, "test", "output", "asset_acquisition_v14_verified_store_apply_local.json"),
  path.join(ROOT, "test", "output", "asset_acquisition_v14_verified_store_dry_run.json"),
  path.join(ROOT, "test", "output", "asset_acquisition_v11_dry_run.json"),
];
const DEFAULT_FRAME_REPORT = path.join(
  ROOT,
  "test",
  "output",
  "controlled_frame_extraction_worker_apply_local.json",
);
const DEFAULT_SEGMENT_VALIDATION_REPORT = path.join(
  ROOT,
  "test",
  "output",
  "official_trailer_segment_validation_apply_local.json",
);
const PREFERRED = ["1szzhy9", "rss_4105cb7c837252c3"];
const TARGET_RUNTIME_S = 61;
const FONT_OPT =
  process.platform === "win32"
    ? "fontfile='C\\:/Windows/Fonts/arial.ttf'"
    : "font='DejaVu Sans'";

function parseArgs(argv) {
  const args = {
    storyId: null,
    reportPath: null,
    applyLocal: false,
    frameReportPath: null,
    segmentValidationReportPath: null,
    noSegmentValidationReport: false,
    noFrameReport: false,
    noRender: false,
    withSoundDesign: false,
    allowSilentFixture: false,
    allowFlashDiagnosticRender: false,
    allowLocalVoiceDiagnostic: false,
    allowUnvalidatedOfficialClips: false,
    generateLocalTts: false,
    useOfficialTrailerClips: false,
    audioPath: null,
    timestampsPath: null,
    limit: 1,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--story") args.storyId = argv[++i] || null;
    else if (arg === "--report") args.reportPath = path.resolve(argv[++i] || "");
    else if (arg === "--frame-report") args.frameReportPath = path.resolve(argv[++i] || "");
    else if (arg === "--segment-validation-report")
      args.segmentValidationReportPath = path.resolve(argv[++i] || "");
    else if (arg === "--no-segment-validation-report") args.noSegmentValidationReport = true;
    else if (arg === "--no-frame-report") args.noFrameReport = true;
    else if (arg === "--apply-local") args.applyLocal = true;
    else if (arg === "--no-render") args.noRender = true;
    else if (arg === "--with-sound-design") args.withSoundDesign = true;
    else if (arg === "--allow-silent-fixture") args.allowSilentFixture = true;
    else if (arg === "--allow-flash-diagnostic-render") args.allowFlashDiagnosticRender = true;
    else if (arg === "--allow-local-voice-diagnostic") args.allowLocalVoiceDiagnostic = true;
    else if (arg === "--allow-unvalidated-official-clips") args.allowUnvalidatedOfficialClips = true;
    else if (arg === "--generate-local-tts") args.generateLocalTts = true;
    else if (arg === "--use-official-trailer-clips") args.useOfficialTrailerClips = true;
    else if (arg === "--audio") args.audioPath = argv[++i] || "";
    else if (arg === "--timestamps") args.timestampsPath = argv[++i] || "";
    else if (arg === "--limit") args.limit = Math.max(1, Number(argv[++i]) || 1);
    else if (arg === "--help" || arg === "-?") args.help = true;
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/studio-v2-still-deck-ingestion.js [options]",
      "",
      "Options:",
      "  --story <id>       Prefer one story id",
      "  --report <path>    still-enrichment report path; defaults to newest v1.5/v1.4/v1.1 output",
      "  --frame-report <path>  accepted local frame-extraction report; defaults to controlled worker apply-local output if present",
      "  --segment-validation-report <path>  optional local segment validation report for official trailer clip refs",
      "  --no-segment-validation-report  Ignore trailer segment validation reports",
      "  --no-frame-report  Ignore local frame-extraction reports",
      "  --apply-local      Download allowed still images to test/output only",
      "  --no-render        Build packages/reports without ffmpeg render",
      "  --with-sound-design  Mix local music bed + restrained SFX in the local proof",
      "  --audio <path>     Use real narration audio for the proof",
      "  --timestamps <path>  Use matching ElevenLabs/local-TTS timestamps JSON",
      "  --generate-local-tts  Generate local TTS audio under test/output before rendering",
      "  --use-official-trailer-clips  Use official Steam/IGDB trailer references as local-only ffmpeg clip inputs",
      "  --allow-silent-fixture  Explicitly allow silent visual-only proof renders",
      "  --allow-flash-diagnostic-render  Explicitly allow a proof render even when Flash Lane preflight blocks it",
      "  --allow-local-voice-diagnostic  Explicitly allow unapproved local TTS in a local diagnostic render",
      "  --allow-unvalidated-official-clips  Local diagnostic override; official clips otherwise require segment validation",
      "  --limit <n>        Number of selected stories to attempt, default 1",
      "",
      "This command is local-only. It does not mutate Railway, OAuth, production DB, scheduler, render defaults or publishing paths.",
    ].join("\n") + "\n",
  );
}

function resolveReportPath(reportPath) {
  if (reportPath) return reportPath;
  const existing = DEFAULT_REPORT_CANDIDATES.find((candidate) => fs.pathExistsSync(candidate));
  return existing || DEFAULT_REPORT_CANDIDATES[DEFAULT_REPORT_CANDIDATES.length - 1];
}

function resolveFrameReportPath({ frameReportPath, noFrameReport }) {
  if (noFrameReport) return null;
  if (frameReportPath) return frameReportPath;
  return fs.pathExistsSync(DEFAULT_FRAME_REPORT) ? DEFAULT_FRAME_REPORT : null;
}

function resolveSegmentValidationReportPath({
  segmentValidationReportPath,
  noSegmentValidationReport,
}) {
  if (noSegmentValidationReport) return null;
  if (segmentValidationReportPath) return segmentValidationReportPath;
  return fs.pathExistsSync(DEFAULT_SEGMENT_VALIDATION_REPORT) ? DEFAULT_SEGMENT_VALIDATION_REPORT : null;
}

function parseJsonField(value) {
  if (!value || typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function normaliseStory(row) {
  return {
    ...row,
    downloaded_images: Array.isArray(row?.downloaded_images)
      ? row.downloaded_images
      : parseJsonField(row?.downloaded_images) || [],
    game_images: Array.isArray(row?.game_images)
      ? row.game_images
      : parseJsonField(row?.game_images) || [],
    video_clips: Array.isArray(row?.video_clips)
      ? row.video_clips
      : parseJsonField(row?.video_clips) || [],
    article_inline_images: Array.isArray(row?.article_inline_images)
      ? row.article_inline_images
      : parseJsonField(row?.article_inline_images) || [],
    media_candidates: Array.isArray(row?.media_candidates)
      ? row.media_candidates
      : parseJsonField(row?.media_candidates) || [],
    igdb_assets: Array.isArray(row?.igdb_assets)
      ? row.igdb_assets
      : parseJsonField(row?.igdb_assets) || [],
  };
}

async function loadStory(storyId, plan) {
  const db = require("../lib/db");
  const rows = (await db.getStories()).map(normaliseStory);
  const story = rows.find((item) => item.id === storyId);
  return story || buildStoryFromStillDeckPlan(plan);
}

function secondsToAss(value) {
  const total = Math.max(0, Number(value) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

function wordsForScript(text, durationS) {
  const words = String(text || "")
    .replace(/\[PAUSE\]/gi, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 160);
  const step = durationS / Math.max(1, words.length);
  return words.map((word, index) => ({
    word,
    start: Number((index * step).toFixed(3)),
    end: Number(((index + 0.85) * step).toFixed(3)),
  }));
}

function buildSimpleAss({ story, durationS }) {
  const script = String(story.full_script || story.body || story.title || "")
    .replace(/\[PAUSE\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const words = script.split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < words.length; i += 7) {
    chunks.push(words.slice(i, i + 7).join(" "));
  }
  const cueDur = durationS / Math.max(1, chunks.length);
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    "Style: Caption,Arial,58,&H00FFFFFF,&H000000FF,&H00101010,&HAA000000,-1,0,0,0,100,100,0,0,1,4,2,2,80,80,170,1",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
  ];
  chunks.forEach((chunk, index) => {
    const start = index * cueDur;
    const end = Math.min(durationS, start + cueDur + 0.15);
    lines.push(`Dialogue: 0,${secondsToAss(start)},${secondsToAss(end)},Caption,,0,0,0,,${chunk}`);
  });
  return lines.join("\n") + "\n";
}

function resolveSubtitleTimelineDurationS({ renderDurationS, narrationDurationS }) {
  const renderDuration = Number(renderDurationS);
  const narrationDuration = Number(narrationDurationS);
  const candidates = [renderDuration, narrationDuration].filter(
    (value) => Number.isFinite(value) && value > 0,
  );
  return Math.max(0.1, ...candidates);
}

function buildSubtitleBaseFilter({
  inputLabel,
  outputLabel = "subtitleBase",
  renderDurationS,
  subtitleDurationS,
}) {
  const renderDuration = Number(renderDurationS);
  const subtitleDuration = Number(subtitleDurationS);
  const targetDurationS = Math.max(
    0.1,
    ...[renderDuration, subtitleDuration].filter(
      (value) => Number.isFinite(value) && value > 0,
    ),
  );
  const padDurationS = Math.max(
    1,
    targetDurationS -
      (Number.isFinite(renderDuration) && renderDuration > 0
        ? renderDuration
        : 0) +
      1,
  );
  return `[${inputLabel}]tpad=stop_mode=clone:stop_duration=${padDurationS.toFixed(3)},trim=duration=${targetDurationS.toFixed(3)},setpts=PTS-STARTPTS[${outputLabel}]`;
}

function resolveStillDeckCaptionOptions({ variant } = {}) {
  const flash = variant === "enriched";
  return {
    maxWordsPerPhrase: 2,
    maxPhraseChars: 14,
    captionCase: "upper",
    revealMode: flash ? "phrase" : "word",
    motionStyle: flash ? "flash" : "default",
    avoidDanglingWords: flash,
    danglingMergeMaxWords: 2,
    maxPhraseDurationS: flash ? 1.15 : 2.2,
    minPhraseDurationS: flash ? 0.32 : 0.5,
  };
}

function ensureSpokenOutro(text) {
  const outro = resolveStudioOutroLine({});
  const script = String(text || "").trim();
  if (!script) return outro;
  if (/follow pulse gaming/i.test(script)) return script;
  return `${script} ${outro}`;
}

function cleanInlineText(text) {
  return String(text || "")
    .replace(/\[PAUSE\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(text) {
  return cleanInlineText(text).split(/\s+/).filter(Boolean).length;
}

function selectProofHook({ editorialHook, story }) {
  const editorial = cleanInlineText(editorialHook);
  const original = cleanInlineText(story.hook || story.title);
  if (!editorial) return original;
  if (countWords(editorial) >= 8) return editorial;
  const originalWords = countWords(original);
  if (originalWords >= 8 && originalWords <= 16) return original;
  return editorial;
}

function hookForQuality(text) {
  const normalised = cleanInlineText(text);
  if (!normalised) return "";
  const sentences = normalised.match(/[^.!?]+[.!?]*/g) || [normalised];
  const first = cleanInlineText(sentences[0]);
  if (countWords(first) >= 8 || sentences.length < 2) return first;
  return cleanInlineText(`${sentences[0]} ${sentences[1]}`);
}

function buildRenderStory(story) {
  const base = {
    ...story,
    hook: story.hook || story.title,
    full_script: story.full_script || story.body || story.title,
  };
  const previousMaxWords = process.env.STUDIO_EDITORIAL_MAX_WORDS;
  process.env.STUDIO_EDITORIAL_MAX_WORDS =
    process.env.STUDIO_EDITORIAL_MAX_WORDS || String(FLASH_LANE_DEFAULT_MAX_WORDS);
  try {
    const editorial = buildStudioEditorial(base);
    const caption = ensureSpokenOutro(editorial.scriptForCaption || editorial.fullScript || base.full_script);
    const tts = ensureSpokenOutro(editorial.scriptForTTS || caption);
    const hook = selectProofHook({ editorialHook: editorial.hook, story: base });
    return {
      ...base,
      hook,
      body: editorial.body || base.body,
      full_script: caption,
      tts_script: tts,
      scriptForCaption: caption,
    };
  } finally {
    if (previousMaxWords === undefined) delete process.env.STUDIO_EDITORIAL_MAX_WORDS;
    else process.env.STUDIO_EDITORIAL_MAX_WORDS = previousMaxWords;
  }
}

async function readTimestampWords(timestampsPath) {
  if (!timestampsPath || !(await fs.pathExists(timestampsPath))) return [];
  const data = await fs.readJson(timestampsPath).catch(() => null);
  const alignment = data?.alignment || data;
  return wordsFromAlignment(alignment);
}

async function resolveReadableMediaArg(inputPath) {
  if (!inputPath) return null;
  const mediaResolved = await mediaPaths.resolveExisting(inputPath);
  if (mediaResolved && (await fs.pathExists(mediaResolved))) return mediaResolved;
  const absolute = path.resolve(inputPath);
  if (await fs.pathExists(absolute)) return absolute;
  return mediaResolved || absolute;
}

async function resolveNarration({
  story,
  variant,
  outputDir,
  audioPath,
  timestampsPath,
  generateLocalTts,
  allowSilentFixture,
}) {
  if (audioPath) {
    const resolvedAudioPath = await resolveReadableMediaArg(audioPath);
    if (!resolvedAudioPath || !(await fs.pathExists(resolvedAudioPath))) {
      throw new Error(`narration audio missing: ${resolvedAudioPath || audioPath}`);
    }
    const inferredTs = timestampsPath
      ? await resolveReadableMediaArg(timestampsPath)
      : resolvedAudioPath.replace(/\.(mp3|wav|m4a)$/i, "_timestamps.json");
    const suppliedLocalTts = looksLikeLocalTtsPath(resolvedAudioPath);
    const meta = inferredTs && (await fs.pathExists(inferredTs))
      ? await fs.readJson(inferredTs).catch(() => null)
      : null;
    const transcriptChars = meta?.characters || meta?.alignment?.characters || [];
    const acoustic =
      meta?.meta?.acoustic ||
      (suppliedLocalTts ? probeLocalAudioAcoustics(resolvedAudioPath) : null);
    return {
      mode: "real_audio",
      audioPath: resolvedAudioPath,
      timestampsPath: inferredTs && (await fs.pathExists(inferredTs)) ? inferredTs : null,
      durationS: ffprobeDuration(resolvedAudioPath),
      provider: suppliedLocalTts ? "local" : "external",
      source: suppliedLocalTts ? "provided-local-tts-audio" : "provided-real-audio",
      signatureHash: meta?.meta?.signatureHash || null,
      approvedLocalVoice: meta?.meta?.approvedLocalVoice === true,
      acceptedLocalVoice: meta?.meta?.acceptedLocalVoice || null,
      acoustic,
      voiceMastering:
        meta?.meta?.voiceMastering ||
        meta?.meta?.voice_mastering ||
        meta?.meta?.mastering ||
        null,
      voiceDiagnostics: meta?.meta?.voiceDiagnostics || null,
      transcript:
        meta?.meta?.transcript ||
        meta?.meta?.text ||
        (Array.isArray(transcriptChars) ? transcriptChars.join("") : ""),
    };
  }

  if (generateLocalTts) {
    const text = cleanForTTS(story.tts_script || story.full_script || story.body || story.title);
    if (!text.trim()) throw new Error("cannot generate local TTS for empty script");
    const voice = await ensureProductionLocalVoice({
      root: ROOT,
      storyId: story.id,
      editorial: {
        hook: story.hook || story.title,
        body: story.body || story.full_script || story.title,
        loop: story.loop || "",
        fullScript: story.full_script || story.body || story.title,
        scriptForCaption: story.scriptForCaption || story.full_script || story.body || story.title,
        scriptForTTS: story.tts_script || story.full_script || story.body || story.title,
      },
      force: process.env.STUDIO_V2_FORCE_TTS === "true",
    });
    const meta = await fs.readJson(voice.timestampsPath).catch(() => null);
    return {
      mode: "real_audio",
      audioPath: voice.audioPath,
      timestampsPath: voice.timestampsPath,
      durationS: voice.durationS || ffprobeDuration(voice.audioPath),
      provider: "local",
      source: voice.source || "local-production-voxcpm-path",
      signatureHash: voice.signatureHash || meta?.meta?.signatureHash || null,
      approvedLocalVoice: meta?.meta?.approvedLocalVoice === true,
      acceptedLocalVoice: meta?.meta?.acceptedLocalVoice || null,
      acoustic: meta?.meta?.acoustic || null,
      voiceMastering:
        meta?.meta?.voiceMastering ||
        meta?.meta?.voice_mastering ||
        meta?.meta?.mastering ||
        null,
      voiceDiagnostics: meta?.meta?.voiceDiagnostics || null,
      transcript: meta?.meta?.transcript || meta?.meta?.text || "",
    };
  }

  if (!allowSilentFixture) {
    throw new Error(
      "Studio V2 still-deck render now requires narration. Use --generate-local-tts, --audio <path>, or explicit --allow-silent-fixture for visual-only diagnostics.",
    );
  }

  return {
    mode: "silent_fixture",
    audioPath: null,
    timestampsPath: null,
    durationS: TARGET_RUNTIME_S,
    provider: "silent_fixture",
    source: "silent_visual_proof",
  };
}

function buildPackageForQuality({ story, words }) {
  const hook = hookForQuality(story.hook || story.title);
  const tightened = cleanInlineText(story.full_script || story.body || story.title);
  return {
    hook: {
      chosen: {
        text: hook,
        wordCount: countWords(hook),
      },
      source: "local-still-deck-fixture",
    },
    script: {
      tightened,
      wordCountTightened: words.length,
    },
    pronunciationMap: [],
    riskFlags: [],
  };
}

function buildCutTransitions(scenes) {
  const transitions = [];
  let offset = 0;
  for (let i = 0; i < scenes.length - 1; i++) {
    offset += Number(scenes[i].duration || 0);
    transitions.push({ type: "cut", duration: 0, offset: Number(offset.toFixed(3)) });
  }
  return transitions;
}

function sumDurations(scenes) {
  return scenes.reduce((sum, scene) => sum + Number(scene.duration || 0), 0);
}

function prepareNarrationWords({ rawWords, durationS, scriptText }) {
  const realigned = rawWords.length
    ? realignTimestampsToScript(scriptText || "", rawWords)
    : [];
  const prepared = prepareSubtitleWords({
    words: realigned,
    duration: durationS,
    scriptText,
    strictEndCoverage: true,
  });
  return prepared.length ? prepared : wordsForScript(scriptText, durationS);
}

async function readPreparedNarrationWords({ narration, durationS, scriptText }) {
  if (narration.mode !== "real_audio") return wordsForScript(scriptText, durationS);
  const rawWords = await readTimestampWords(narration.timestampsPath);
  return prepareNarrationWords({ rawWords, durationS, scriptText });
}

function alignScenesToNarrationBeats({ scenes, words, totalDurationS }) {
  const result = alignSceneDurationsToWordBoundaries(scenes, words, {
    totalDurationS,
    minSceneDurationS: 2.6,
    maxSceneDurationS: 8.2,
  });
  return result.adjusted ? result.scenes : scenes;
}

function sceneListForReport(scenes) {
  return scenes.map((scene) => ({
    type: scene.type || scene.sceneType,
    label: scene.label || null,
    duration: scene.duration,
    source: scene.source || scene.backgroundSource || scene.prerenderedMp4 || scene.statLabel || null,
    mediaStartS: scene.mediaStartS ?? null,
    clipDurationS: scene.clipDurationS ?? null,
    clipTimingProvenance: scene.clipTimingProvenance || null,
    premiumLane: scene.premiumLane || null,
    cardTreatment: scene.cardTreatment || null,
  }));
}

async function buildFlashLaneRenderPreflight({
  story,
  media,
  outputDir,
  allowSilentFixture = false,
  allowLocalVoiceDiagnostic = false,
  generateLocalTts = false,
  audioPath = null,
  timestampsPath = null,
}) {
  const renderStory = buildRenderStory(story);
  const narration = await resolveNarration({
    story: renderStory,
    variant: "enriched",
    outputDir,
    audioPath,
    timestampsPath,
    generateLocalTts,
    allowSilentFixture,
  });
  const targetDurationS =
    narration.mode === "real_audio" && Number.isFinite(narration.durationS)
      ? narration.durationS
      : TARGET_RUNTIME_S;
  const composed = composeStudioSlate({
    story: renderStory,
    media,
    audioDurationS: targetDurationS,
    opts: {
      allowStockFiller: false,
      flashLane: true,
      sourceCardMode: "overlay",
      takeawayText: "FOLLOW PULSE GAMING",
      cta: "NEVER MISS A BEAT",
    },
  });
  let scenes = composed.scenes.length
    ? composed.scenes
    : [
        {
          type: SCENE_TYPES.CARD_SOURCE,
          label: "card_source",
          duration: TARGET_RUNTIME_S,
          sourceLabel: story.source_type || "NEWS",
        },
      ];
  const initialDurationS = sumDurations(scenes) || targetDurationS;
  const scriptText =
    narration.transcript || renderStory.scriptForCaption || renderStory.full_script;
  const words = await readPreparedNarrationWords({
    narration,
    durationS: initialDurationS,
    scriptText,
  });
  scenes = alignScenesToNarrationBeats({
    scenes,
    words,
    totalDurationS: initialDurationS,
  });
  const durationS = sumDurations(scenes) || targetDurationS;
  const overlayPlan = buildFlashLaneOverlayPlan({ story: renderStory, scenes, durationS });
  const report = buildFlashLaneProofPreflight({
    narration,
    scenes,
    media,
    overlayPlan,
    scriptWordCount: countWords(renderStory.tts_script || renderStory.full_script || renderStory.body || renderStory.title),
  });
  return {
    ...report,
    narration: {
      mode: narration.mode,
      provider: narration.provider,
      source: narration.source,
      audioPath: narration.audioPath || null,
      timestampsPath: narration.timestampsPath || null,
      durationS: Number.isFinite(Number(narration.durationS))
        ? Number(Number(narration.durationS).toFixed(3))
        : null,
    },
    flashLaneOverlays: overlayPlan,
    sceneList: sceneListForReport(scenes),
  };
}

async function renderStillDeckVariant({
  story,
  media,
  variant,
  outputDir,
  withSoundDesign = false,
  allowSilentFixture = false,
  allowFlashDiagnosticRender = false,
  allowLocalVoiceDiagnostic = false,
  generateLocalTts = false,
  audioPath = null,
  timestampsPath = null,
}) {
  await fs.ensureDir(outputDir);
  const renderStory = buildRenderStory(story);
  const narration = await resolveNarration({
    story: renderStory,
    variant,
    outputDir,
    audioPath,
    timestampsPath,
    generateLocalTts,
    allowSilentFixture,
  });
  assertNarrationAllowedForProof(narration, { allowSilentFixture, allowLocalVoiceDiagnostic });
  const targetDurationS =
    narration.mode === "real_audio" && Number.isFinite(narration.durationS)
      ? narration.durationS
      : TARGET_RUNTIME_S;
  const composed = composeStudioSlate({
    story: renderStory,
    media,
    audioDurationS: targetDurationS,
    opts: {
      allowStockFiller: false,
      flashLane: variant === "enriched",
      sourceCardMode: variant === "enriched" ? "overlay" : "scene",
      takeawayText: "FOLLOW PULSE GAMING",
      cta: "NEVER MISS A BEAT",
    },
  });
  let scenes = composed.scenes.length
    ? composed.scenes
    : [
        {
          type: SCENE_TYPES.CARD_SOURCE,
          label: "card_source",
          duration: TARGET_RUNTIME_S,
          sourceLabel: story.source_type || "NEWS",
        },
      ];
  const initialDurationS = sumDurations(scenes);
  const assDurationS = resolveSubtitleTimelineDurationS({
    renderDurationS: initialDurationS,
    narrationDurationS: narration.durationS,
  });
  const scriptText =
    narration.transcript || renderStory.scriptForCaption || renderStory.full_script;
  let words = await readPreparedNarrationWords({
    narration,
    durationS: assDurationS,
    scriptText,
  });
  scenes = alignScenesToNarrationBeats({
    scenes,
    words,
    totalDurationS: initialDurationS,
  });
  const durationS = sumDurations(scenes);
  const overlayPlan =
    variant === "enriched"
      ? buildFlashLaneOverlayPlan({ story: renderStory, scenes, durationS })
      : null;
  const flashLanePreflight =
    variant === "enriched"
      ? assertFlashLaneProofReady(
          { narration, scenes, media, overlayPlan },
          { allowDiagnosticRender: allowFlashDiagnosticRender },
        )
      : null;
  const transitions = buildCutTransitions(scenes);
  const assPath = path.join(outputDir, `${story.id}_${variant}.ass`);
  let subtitleStatus = "fixture_ass_generated";
  if (narration.mode === "real_audio") {
    await fs.writeFile(
      assPath,
      buildKineticAss({
        story: renderStory,
        words,
        duration: assDurationS,
        scriptText,
        realign: false,
        ...resolveStillDeckCaptionOptions({ variant }),
      }),
      "utf8",
    );
    subtitleStatus = words.length ? "kinetic_ass_from_real_audio" : "kinetic_ass_even_timing";
  } else {
    await fs.writeFile(assPath, buildSimpleAss({ story: renderStory, durationS: assDurationS }), "utf8");
    words = wordsForScript(renderStory.full_script, assDurationS);
  }

  const sceneInputs = scenes.map(buildSceneInput);
  const filterParts = scenes.map((scene, index) =>
    dispatchSceneFilter({ slot: index, scene, story: renderStory, fontOpt: FONT_OPT }),
  );
  let prev = "v0";
  for (let i = 0; i < transitions.length; i++) {
    const out = i === transitions.length - 1 ? "base" : `xf${i + 1}`;
    filterParts.push(
      `[${prev}][v${i + 1}]concat=n=2:v=1:a=0,fps=${FPS},setpts=PTS-STARTPTS[${out}]`,
    );
    prev = out;
  }
  if (scenes.length === 1) filterParts.push("[v0]copy[base]");
  const subtitleInputLabel = overlayPlan ? "overlayed" : "base";
  if (overlayPlan) {
    filterParts.push(
      ...buildFlashLaneOverlayFilters({
        plan: overlayPlan,
        inputLabel: "base",
        outputLabel: subtitleInputLabel,
        fontOpt: FONT_OPT,
      }),
    );
  }
  const assRel = path.relative(ROOT, assPath).replace(/\\/g, "/");
  const subtitleRenderDurationS = assDurationS;
  filterParts.push(
    buildSubtitleBaseFilter({
      inputLabel: subtitleInputLabel,
      renderDurationS: durationS,
      subtitleDurationS: subtitleRenderDurationS,
    }),
    `[subtitleBase]ass=${assRel},format=yuv420p[outv]`,
  );

  const filterPath = path.join(outputDir, `${story.id}_${variant}_filter.txt`);
  const mp4Path = path.join(outputDir, `studio_v2_${story.id}_${variant}.mp4`);
  const audioIndex = sceneInputs.length;
  const allInputs = [
    ...sceneInputs,
    narration.mode === "real_audio"
      ? `-i "${narration.audioPath.replace(/\\/g, "/")}"`
      : `-f lavfi -t ${subtitleRenderDurationS.toFixed(3)} -i anullsrc=channel_layout=stereo:sample_rate=48000`,
  ];
  let audioMapArg = `-map ${audioIndex}:a`;
  let audioPlan = null;
  let soundLayerPayload = {
    cueCount: 0,
    sfxCues: [],
    filterLines: [],
    duckingDb: 0,
  };

  if (withSoundDesign) {
    audioPlan = resolveAudioPlan({ story: renderStory, scenes, transitions });
    const musicIndex = allInputs.length;
    allInputs.push(`-stream_loop -1 -i "${audioPlan.musicBed.path.replace(/\\/g, "/")}"`);
    const soundLayer = buildSoundLayerV2({
      scenes,
      transitions,
      voiceInputIdx: audioIndex,
      musicInputIdx: musicIndex,
      audioInputsBaseIdx: allInputs.length,
      audioPlan,
      targetDurationS: subtitleRenderDurationS,
    });
    allInputs.push(...soundLayer.extraInputs);
    filterParts.push(...soundLayer.filterLines);
    audioMapArg = soundLayer.mapArg;
    soundLayerPayload = {
      cueCount: soundLayer.cueCount,
      sfxCues: soundLayer.cues,
      filterLines: soundLayer.filterLines,
      duckingDb: 7,
      audioPlan: audioPlan.decisions,
      musicBed: audioPlan.musicBed,
    };
  } else {
    filterParts.push(
      `[${audioIndex}:a]apad,atrim=duration=${subtitleRenderDurationS.toFixed(3)},asetpts=PTS-STARTPTS[outa]`,
    );
    audioMapArg = '-map "[outa]"';
  }

  await fs.writeFile(filterPath, filterParts.join(";\n"), "utf8");
  const command = [
    "ffmpeg -y -hide_banner -loglevel warning",
    allInputs.join(" "),
    `-filter_complex_script "${filterPath.replace(/\\/g, "/")}"`,
    `-map "[outv]" ${audioMapArg}`,
    "-c:v libx264 -crf 21 -preset veryfast",
    "-pix_fmt yuv420p -profile:v high -level:v 4.0",
    "-c:a aac -b:a 96k",
    `-r ${FPS} -shortest -movflags +faststart "${mp4Path.replace(/\\/g, "/")}"`,
  ].join(" ");
  execSync(command, { cwd: ROOT, stdio: "inherit", maxBuffer: 80 * 1024 * 1024 });

  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", mp4Path],
      { encoding: "utf8" },
    ),
  );
  const renderedDurationS = Number(probe.format?.duration || durationS);
  const fixtureDurationS = Math.max(0.1, Math.min(durationS, renderedDurationS));
  const pkg = buildPackageForQuality({ story: renderStory, words });
  const quality = buildQualityReportV2({
    storyId: `${story.id}_${variant}`,
    outputPath: path.relative(ROOT, mp4Path).replace(/\\/g, "/"),
    pkg,
    scenes,
    transitions,
    audioMeta: {
      provider: narration.provider,
      source: narration.source,
      voiceId: process.env.ELEVENLABS_VOICE_ID || null,
      editorialScriptAppliedToAudio: narration.mode === "real_audio",
      timestampSource: narration.timestampsPath ? "tts-alignment" : null,
      approvedLocalVoice: narration.approvedLocalVoice === true,
      acceptedLocalVoice: narration.acceptedLocalVoice || null,
      acoustic: narration.acoustic || null,
      voiceDiagnostics: narration.voiceDiagnostics || null,
      transcript: narration.transcript || null,
    },
    audioDurationS: narration.mode === "real_audio" ? narration.durationS : fixtureDurationS,
    assPath,
    soundLayerPayload,
    realignedWords: words,
    renderedDurationS,
    flashLanePreflight,
    branch: "local-still-deck-ingestion",
  });
  quality.runtime = {
    path: path.relative(ROOT, mp4Path).replace(/\\/g, "/"),
    durationS: renderedDurationS,
    sizeBytes: Number(probe.format?.size || 0),
  };
  quality.sceneList = sceneListForReport(scenes);
  quality.transitions = transitions;
  quality.mediaDiversity = rankSourceDiversity(media);
  quality.subtitles = {
    assPath: path.relative(ROOT, assPath).replace(/\\/g, "/"),
    status: subtitleStatus,
  };
  quality.voice = {
    source: narration.source,
    audioPath: narration.audioPath ? path.relative(ROOT, narration.audioPath).replace(/\\/g, "/") : null,
    timestampsPath: narration.timestampsPath ? path.relative(ROOT, narration.timestampsPath).replace(/\\/g, "/") : null,
    signatureHash: narration.signatureHash || null,
    approvedLocalVoice: narration.approvedLocalVoice === true,
    acceptedLocalVoice: narration.acceptedLocalVoice || null,
    acoustic: narration.acoustic || null,
    voiceDiagnostics: narration.voiceDiagnostics || null,
    transcript: narration.transcript || null,
    note:
      narration.mode === "real_audio"
        ? "Real narration audio was used for this local proof."
        : "Silent fixture audio was explicitly allowed for this local visual diagnostic.",
  };
  if (flashLanePreflight) quality.flashLanePreflight = flashLanePreflight;
  if (overlayPlan) quality.flashLaneOverlays = overlayPlan;
  const reportPath = path.join(outputDir, `${story.id}_${variant}_qa.json`);
  await fs.writeJson(reportPath, quality, { spaces: 2 });
  const forensic = await runForensicQa({
    storyId: `${story.id}_${variant}`,
    outputDir,
    mp4Path,
    reportPath,
    assPath,
    flashLane: variant === "enriched",
  });
  return {
    variant,
    mp4Path,
    reportPath,
    assPath,
    forensic,
    quality,
    scenes,
    composedMetrics: composed.metrics,
  };
}

function contactSheetCommand(mp4Path, outPath) {
  return [
    "ffmpeg",
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    mp4Path,
    "-vf",
    "fps=1/5,scale=216:384,tile=5x3",
    "-frames:v",
    "1",
    outPath,
  ];
}

async function makeContactSheet(mp4Path, outPath) {
  execFileSync("ffmpeg", contactSheetCommand(mp4Path, outPath).slice(1), {
    cwd: ROOT,
    stdio: "ignore",
  });
  return outPath;
}

function renderComparisonMarkdown(report) {
  const narration = report.narration || {};
  const motion = report.motion || {};
  const narrationLine = report.render_attempted === false
    ? "- No render was attempted, so no narration audio was used or verified; a pilot proof still requires approved narration."
    : report.render_preflight_error
    ? `- Narration/render was blocked before FFmpeg: ${report.render_preflight_error}`
    : narration.mode === "real_audio"
      ? `- Real narration audio used (${narration.enriched_source || "unknown source"}); ElevenLabs was not called.`
      : "- Silent fixture audio was explicitly allowed for a visual-only diagnostic; not valid for pilot approval.";
  const clipSafety = motion.official_clip_safety || {};
  const blockedClipLine =
    clipSafety.status === "blocked_footage_backbone_not_ready"
      ? `- Official trailer clips were blocked: ${clipSafety.backbone_verdict || "not_ready"}; validated entities: ${(clipSafety.validated_entities || []).join(", ") || "none"}; missing validated entities: ${(clipSafety.missing_validated_entities || []).join(", ") || "unknown"}.`
      : null;
  const mediaLine =
    motion.official_clip_refs_used > 0
      ? `- Uses ${motion.official_clip_refs_used} local-only official Steam trailer reference(s) plus ${motion.official_trailer_frames_used || 0} extracted frame(s); no yt-dlp, browser scraping or persisted trailer downloads.`
      : blockedClipLine
        ? blockedClipLine
      : "- Still-image proof only; no trailer/video clip ingestion used.";
  const lines = [
    `# ${report.report_title || "Studio V2 Still-Deck Ingestion v1"}`,
    "",
    `Generated: ${report.generated_at}`,
    `Story: ${report.story_id}`,
    `Title: ${report.title}`,
    "",
    "## Judgement",
    "",
    `- Visual judgement: ${report.judgement.visual_output}`,
    `- Studio V2 suitability: ${report.judgement.studio_v2_suitability}`,
    `- Recommendation: ${report.judgement.recommendation}`,
    "",
    "## Artefacts",
    "",
  ];
  for (const item of report.artefacts) {
    lines.push(`- ${item.label}: ${item.path}`);
  }
  lines.push(
    "",
    "## Metrics",
    "",
    "| metric | baseline | enriched |",
    "| --- | ---: | ---: |",
  );
  for (const row of report.metric_rows) {
    lines.push(`| ${row.metric} | ${row.baseline} | ${row.enriched} |`);
  }
  if (report.render_readiness) {
    const readiness = report.render_readiness;
    const blockers = Array.isArray(readiness.blockers) ? readiness.blockers : [];
    const warnings = Array.isArray(readiness.warnings) ? readiness.warnings : [];
    lines.push("", "## Render Readiness", "");
    lines.push(`- Verdict: ${readiness.verdict || "review"} (${readiness.statusColour || readiness.readinessClass || "amber"})`);
    if (blockers.length) lines.push(`- Blockers: ${blockers.join(", ")}`);
    if (warnings.length) lines.push(`- Warnings: ${warnings.join(", ")}`);
    lines.push(
      `- Motion dominance: ${readiness.motionDominance ?? "unknown"}; story beat overlays: ${readiness.storyBeatOverlayCount ?? "unknown"}/${readiness.requiredBeatOverlayMinimum ?? "unknown"}; unique clip sources: ${readiness.uniqueClipSources ?? "unknown"}; distinct scene beats: ${readiness.distinctSceneBeats ?? "unknown"}`,
    );
    lines.push(`- Recommendation: ${readiness.recommendation || "Operator review advised."}`);
  }
  if (report.render_preflight) {
    lines.push("", "## Flash Lane Preflight", "");
    lines.push(`- Verdict: ${report.render_preflight.verdict || "unknown"}`);
    const blockers = Array.isArray(report.render_preflight.blockers)
      ? report.render_preflight.blockers
      : [];
    const warnings = Array.isArray(report.render_preflight.warnings)
      ? report.render_preflight.warnings
      : [];
    if (blockers.length) lines.push(`- Blockers: ${blockers.join(", ")}`);
    if (warnings.length) lines.push(`- Warnings: ${warnings.join(", ")}`);
    const metrics = report.render_preflight.metrics || {};
    if (Object.keys(metrics).length) {
      const visualMetrics = report.render_preflight.visualDirector?.metrics || {};
      lines.push(
        `- Runtime: ${metrics.narrationDurationS ?? "unknown"}s; spoken pace: ${metrics.spokenWpm ?? "unknown"} WPM; actual clip dominance: ${metrics.actualClipDominance ?? "unknown"}; motion dominance: ${metrics.motionDominance ?? "unknown"}; card ratio: ${metrics.cardRatio ?? "unknown"}; story beat overlays: ${metrics.storyBeatOverlayCount ?? "unknown"}; unique clip sources: ${visualMetrics.uniqueClipSources ?? "unknown"}; distinct scene beats: ${visualMetrics.distinctSceneBeats ?? "unknown"}`,
      );
    }
    if (report.render_preflight.narrationPlan) {
      const plan = report.render_preflight.narrationPlan;
      lines.push(
        `- Narration plan: ${plan.recommendation}; target ${plan.targetRuntimeS?.[0] ?? "?"}-${plan.targetRuntimeS?.[1] ?? "?"}s, ${plan.targetWordRange?.[0] ?? "?"}-${plan.targetWordRange?.[1] ?? "?"} words at ${plan.idealWpmRange?.[0] ?? "?"}-${plan.idealWpmRange?.[1] ?? "?"} WPM`,
      );
      if (Array.isArray(plan.issues) && plan.issues.length) {
        lines.push(`- Narration issues: ${plan.issues.join(", ")}`);
      }
    }
  }
  lines.push("", "## Safety", "");
  lines.push("- Local-only proof.");
  lines.push(mediaLine);
  lines.push(narrationLine);
  if (report.sound_design_used) lines.push("- Local music bed/SFX were used in the proof render.");
  lines.push("- No Railway, OAuth, production DB, production render defaults, hard gates or posting paths changed.");
  return lines.join("\n") + "\n";
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, "/");
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  args.reportPath = resolveReportPath(args.reportPath);
  args.frameReportPath = resolveFrameReportPath(args);
  args.segmentValidationReportPath = resolveSegmentValidationReportPath(args);
  await fs.ensureDir(OUT);
  const dryReport = await fs.readJson(args.reportPath);
  const frameReport = args.frameReportPath && (await fs.pathExists(args.frameReportPath))
    ? await fs.readJson(args.frameReportPath)
    : null;
  const segmentValidationReport =
    args.segmentValidationReportPath && (await fs.pathExists(args.segmentValidationReportPath))
      ? await fs.readJson(args.segmentValidationReportPath)
      : null;
  const preferredStoryIds = args.storyId ? [args.storyId, ...PREFERRED] : PREFERRED;
  const selected = selectStillDeckPlan(dryReport, {
    storyId: args.storyId,
    preferredStoryIds,
  });
  if (!selected) throw new Error("No still-deck plan found");
  const story = await loadStory(selected.story_id, selected);

  let plan = selected;
  let localApplyReport = null;
  if (args.applyLocal) {
    localApplyReport = await runStillImageEnrichment([story], {
      dryRun: false,
      applyLocal: true,
      outputRoot: SOURCE_OUT,
    });
    plan = localApplyReport.plans[0];
    await fs.writeJson(path.join(OUT, "still_deck_apply_local.json"), localApplyReport, { spaces: 2 });
    await fs.writeFile(
      path.join(OUT, "still_deck_apply_local.md"),
      renderStillImageEnrichmentMarkdown(localApplyReport),
      "utf8",
    );
  }

  const enrichedPackage = await buildStillDeckMediaPackage({ story, plan, frameReport });
  const officialClipResolution = resolveOfficialTrailerClipRefsForProof({
    storyId: story.id,
    frameReport,
    segmentValidationReport,
    useOfficialTrailerClips: args.useOfficialTrailerClips,
    allowUnvalidatedOfficialClips: args.allowUnvalidatedOfficialClips,
    targetRuntimeS: 66,
  });
  const officialClipRefs = officialClipResolution.clipRefs;
  const footageBackboneReport = officialClipResolution.footageBackboneReport;
  if (officialClipRefs.length) {
    enrichedPackage.media.clips = officialClipRefs;
    enrichedPackage.metrics.acceptedOfficialClipRefs = officialClipRefs.length;
  }
  enrichedPackage.metrics.officialClipSafetyStatus = officialClipResolution.safety.status;
  enrichedPackage.metrics.officialClipSafetyReason = officialClipResolution.safety.reason;
  if (footageBackboneReport) {
    await fs.writeJson(path.join(OUT, "footage_backbone_for_render.json"), footageBackboneReport, {
      spaces: 2,
    });
    enrichedPackage.metrics.footageBackboneVerdict = footageBackboneReport.verdict;
    enrichedPackage.metrics.projectedClipDominance = footageBackboneReport.projected_clip_dominance;
  }
  await fs.writeJson(path.join(OUT, "enriched_media_package.json"), enrichedPackage, { spaces: 2 });
  await fs.writeFile(
    path.join(OUT, "enriched_media_package.md"),
    buildStillDeckMarkdown({ packageResult: enrichedPackage }),
    "utf8",
  );

  const baselineMedia = await discoverLocalStudioMedia({ root: ROOT, storyId: story.id });
  const baselineSummary = rankSourceDiversity(baselineMedia);
  const enrichedSummary = rankSourceDiversity(enrichedPackage.media);
  const enrichedVisualCount =
    enrichedPackage.metrics.acceptedCount + enrichedPackage.metrics.acceptedFrameCount;

  const artefacts = [];
  let baselineRender = null;
  let enrichedRender = null;
  let comparison = null;
  const renderRequested =
    !args.noRender &&
    (enrichedPackage.media.articleHeroes.length > 0 || enrichedPackage.media.trailerFrames.length > 0);
  const renderPackageGate = evaluateStillDeckRenderReadiness({
    baselineSummary,
    enrichedSummary,
    enrichedMetrics: enrichedPackage.metrics,
  });
  let renderPreflight = null;
  let renderPreflightBlocked = false;
  let renderPreflightError = null;
  if (renderRequested && renderPackageGate.verdict === "block" && !args.allowFlashDiagnosticRender) {
    renderPreflightBlocked = true;
    renderPreflightError = renderPackageGate.blockers.join(", ");
    renderPreflight = {
      verdict: "block",
      blockers: renderPackageGate.blockers,
      warnings: renderPackageGate.warnings,
      metrics: {
        package_gate: renderPackageGate.metrics,
      },
      package_gate: renderPackageGate,
    };
  } else if (renderRequested) {
    try {
      renderPreflight = await buildFlashLaneRenderPreflight({
        story,
        media: enrichedPackage.media,
        outputDir: OUT,
        allowSilentFixture: args.allowSilentFixture,
        allowLocalVoiceDiagnostic: args.allowLocalVoiceDiagnostic,
        generateLocalTts: args.generateLocalTts,
        audioPath: args.audioPath,
        timestampsPath: args.timestampsPath,
      });
      renderPreflightBlocked =
        renderPreflight.verdict === "block" && !args.allowFlashDiagnosticRender;
      if (renderPreflightBlocked) {
        renderPreflightError = renderPreflight.blockers.join(", ");
      }
    } catch (err) {
      renderPreflightBlocked = true;
      renderPreflightError = err.message || String(err);
      renderPreflight = {
        verdict: "block",
        blockers: [renderPreflightError],
        warnings: [],
        metrics: {},
      };
    }
  }

  if (renderRequested && (!renderPreflightBlocked || args.allowFlashDiagnosticRender)) {
    baselineRender = await renderStillDeckVariant({
      story,
      media: baselineMedia,
      variant: "baseline",
      outputDir: OUT,
      withSoundDesign: args.withSoundDesign,
      allowSilentFixture: args.allowSilentFixture,
      allowLocalVoiceDiagnostic: args.allowLocalVoiceDiagnostic,
      allowFlashDiagnosticRender: args.allowFlashDiagnosticRender,
      generateLocalTts: args.generateLocalTts,
      audioPath: args.audioPath,
      timestampsPath: args.timestampsPath,
    });
    enrichedRender = await renderStillDeckVariant({
      story,
      media: enrichedPackage.media,
      variant: "enriched",
      outputDir: OUT,
      withSoundDesign: args.withSoundDesign,
      allowSilentFixture: args.allowSilentFixture,
      allowFlashDiagnosticRender: args.allowFlashDiagnosticRender,
      allowLocalVoiceDiagnostic: args.allowLocalVoiceDiagnostic,
      generateLocalTts: args.generateLocalTts,
      audioPath: args.audioPath,
      timestampsPath: args.timestampsPath,
    });
    comparison = compareForensicReports(baselineRender.forensic, enrichedRender.forensic);
    await fs.writeJson(path.join(OUT, "forensic_comparison.json"), comparison, { spaces: 2 });
    await fs.writeFile(
      path.join(OUT, "forensic_comparison.md"),
      require("../lib/studio/v2/forensic-qa-v2").buildComparisonMarkdown(comparison),
      "utf8",
    );
    const baselineSheet = await makeContactSheet(
      baselineRender.mp4Path,
      path.join(OUT, `${story.id}_baseline_contact_sheet.jpg`),
    );
    const enrichedSheet = await makeContactSheet(
      enrichedRender.mp4Path,
      path.join(OUT, `${story.id}_enriched_contact_sheet.jpg`),
    );
    artefacts.push(
      { label: "baseline mp4", path: rel(baselineRender.mp4Path) },
      { label: "enriched mp4", path: rel(enrichedRender.mp4Path) },
      { label: "baseline contact sheet", path: rel(baselineSheet) },
      { label: "enriched contact sheet", path: rel(enrichedSheet) },
      { label: "baseline QA", path: rel(baselineRender.reportPath) },
      { label: "enriched QA", path: rel(enrichedRender.reportPath) },
      { label: "forensic comparison", path: rel(path.join(OUT, "forensic_comparison.json")) },
    );
  }

  const baselineUnique = baselineRender?.quality?.auto?.sourceDiversity?.uniqueSources || baselineSummary.topicalSources;
  const enrichedUnique = enrichedRender?.quality?.auto?.sourceDiversity?.uniqueSources || enrichedSummary.topicalSources;
  const baselineRepeat = baselineRender?.quality?.auto?.maxStillRepeat?.value ?? null;
  const enrichedRepeat = enrichedRender?.quality?.auto?.maxStillRepeat?.value ?? null;
  const visualImproved =
    enrichedVisualCount > 0 &&
    (enrichedUnique > baselineUnique ||
      (Number.isFinite(enrichedRepeat) && Number.isFinite(baselineRepeat) && enrichedRepeat < baselineRepeat));
  const frameReportUsed =
    Boolean(frameReport) && enrichedPackage.metrics.acceptedFrameCount + enrichedPackage.metrics.rejectedFrameCount > 0;
  const enrichedVoice = enrichedRender?.quality?.voice || {};
  const preflightNarration = renderPreflight?.narration || {};
  const realNarrationUsed = Boolean(enrichedVoice.audioPath || preflightNarration.audioPath);
  const enrichedVoiceSource = String(enrichedVoice.source || preflightNarration.source || "");
  const officialClipRefsUsed = Number(enrichedPackage.metrics.acceptedOfficialClipRefs || 0);
  const renderAttempted = Boolean(baselineRender || enrichedRender);
  const enrichedVoiceGate = enrichedRender?.quality?.auto?.voicePathUsed?.grade || null;
  const renderRejected = enrichedRender?.quality?.verdict?.lane === "reject";
  const premiumBlockers = [
    officialClipRefsUsed > 0
      ? "official Steam trailer references add real motion but still need human visual approval"
      : frameReportUsed
        ? "official local frames improve motion variety but are not full trailer/video clips"
        : "no trailer/video clips in this phase",
    !renderAttempted
      ? "no MP4 render was attempted, so narration was not verified"
      : realNarrationUsed && enrichedVoiceSource === "provided-real-audio"
        ? "provided cached narration is present; runtime and render QA still decide pilot readiness"
        : realNarrationUsed
          ? "local narration is present but is blocked until human-approved against the production ElevenLabs voice"
          : "silent fixture audio is not valid for pilot approval",
  ];
  if (!renderAttempted) {
    premiumBlockers.push("no MP4 render was attempted, so suitability is diagnostic only");
  }
  if (renderPreflightBlocked) {
    premiumBlockers.push(
      `Flash Lane preflight blocked render before FFmpeg: ${renderPreflight?.blockers?.join(", ")}`,
    );
  }
  if (enrichedVoiceGate === "red") {
    premiumBlockers.push("unapproved local TTS voice path blocks pilot approval");
  }
  if (renderRejected) {
    premiumBlockers.push("render QA rejected the enriched proof");
  }
  if (officialClipRefsUsed <= 0) {
    premiumBlockers.push("still images alone cannot prove premium motion quality");
  }
  const studioV2Suitability = classifyStudioV2Suitability({
    renderPreflightBlocked,
    renderAttempted,
    renderRejected,
    enrichedVoiceGate,
    enrichedVisualCount,
    distinctEntities: enrichedPackage.metrics.distinctEntities,
    officialClipRefsUsed,
    acceptedFrameCount: enrichedPackage.metrics.acceptedFrameCount,
    renderPreflight,
  });
  const promotionRecommendation = recommendStudioV2Promotion({
    renderPreflightBlocked,
    renderPreflight,
    renderAttempted,
    enrichedVoiceGate,
    renderRejected,
    visualImproved,
  });
  const visualOutput = !renderAttempted
    ? visualImproved
      ? "package_improved_not_render_verified"
      : "not_proven"
    : renderPreflightBlocked
      ? visualImproved
        ? "package_improved_not_render_verified"
        : "not_proven"
      : visualImproved
        ? "improved"
        : "not_proven";
  const renderReadiness = buildFlashLaneProofReadinessSummary({
    preflight: renderPreflight,
    overlayPlan: renderPreflight?.flashLaneOverlays,
    scenes: renderPreflight?.sceneList,
  });
  const report = {
    schema_version: 1,
    report_title:
      frameReportUsed
        ? "Studio V2 Still-Deck + Official Frame Ingestion v1"
        : dryReport?.summary?.multi_entity_store_searches > 0
        ? "Studio V2 Verified Multi-Entity Deck Proof v1"
        : "Studio V2 Still-Deck Ingestion v1",
    generated_at: new Date().toISOString(),
    story_id: story.id,
    title: story.title,
    selected_from: rel(args.reportPath),
    frame_report_used: frameReportUsed,
    frame_report_path: args.frameReportPath ? rel(args.frameReportPath) : null,
    segment_validation_report_used: Boolean(segmentValidationReport),
    segment_validation_report_path: args.segmentValidationReportPath
      ? rel(args.segmentValidationReportPath)
      : null,
    apply_local_used: args.applyLocal,
    sound_design_used: args.withSoundDesign,
    narration: {
      mode: realNarrationUsed ? "real_audio" : "silent_fixture",
      enriched_source: enrichedVoice.source || preflightNarration.source || null,
      enriched_audio_path: enrichedVoice.audioPath || preflightNarration.audioPath || null,
      enriched_timestamps_path: enrichedVoice.timestampsPath || preflightNarration.timestampsPath || null,
      durationS: preflightNarration.durationS || null,
    },
    motion: {
      official_clip_refs_used: officialClipRefsUsed,
      official_clip_safety: officialClipResolution.safety,
      official_trailer_frames_used: Number(enrichedPackage.metrics.acceptedFrameCount || 0),
    },
    render_requested: renderRequested,
    render_package_gate: renderPackageGate,
    render_readiness: renderReadiness,
    render_preflight: renderPreflight,
    render_preflight_error: renderPreflightError,
    render_attempted: renderAttempted,
    baseline_media: {
      source: "current_local_studio_discovery",
      diversity: baselineSummary,
    },
    enriched_media: {
      source:
        frameReportUsed
          ? "asset_acquisition_still_deck_plus_local_official_frames"
          : dryReport?.summary?.multi_entity_store_searches > 0
          ? "asset_acquisition_v15_multi_entity_apply_local"
          : "asset_acquisition_still_deck",
      package: rel(path.join(OUT, "enriched_media_package.json")),
      metrics: enrichedPackage.metrics,
      rejected: enrichedPackage.rejected,
      diversity: enrichedSummary,
    },
    renders: {
      baseline: baselineRender
        ? {
            mp4: rel(baselineRender.mp4Path),
            qa: rel(baselineRender.reportPath),
            forensic: baselineRender.forensic.outputs,
          }
        : null,
      enriched: enrichedRender
        ? {
            mp4: rel(enrichedRender.mp4Path),
            qa: rel(enrichedRender.reportPath),
            forensic: enrichedRender.forensic.outputs,
          }
        : null,
    },
    comparison,
    metric_rows: [
      { metric: "accepted stills", baseline: baselineSummary.topicalSources, enriched: enrichedPackage.metrics.acceptedCount },
      { metric: "accepted trailer frames", baseline: baselineSummary.groups?.trailerFrames || 0, enriched: enrichedPackage.metrics.acceptedFrameCount },
      { metric: "source diversity score", baseline: baselineSummary.sourceMixScore, enriched: enrichedSummary.sourceMixScore },
      { metric: "unique scene sources", baseline: baselineUnique, enriched: enrichedUnique },
      { metric: "max still repeat", baseline: baselineRepeat ?? "n/a", enriched: enrichedRepeat ?? "n/a" },
      {
        metric: "visual repeat pairs",
        baseline: baselineRender?.forensic?.visual?.repeatPairCount ?? "n/a",
        enriched: enrichedRender?.forensic?.visual?.repeatPairCount ?? "n/a",
      },
    ],
    judgement: {
      visual_output: visualOutput,
      studio_v2_suitability: studioV2Suitability,
      premium_blockers: premiumBlockers,
      recommendation: promotionRecommendation,
    },
    artefacts,
    safety: {
      local_only: true,
      railway_mutated: false,
      production_db_mutated: false,
      oauth_triggered: false,
      posted_to_platforms: false,
      video_downloads: false,
      yt_dlp: false,
      browser_scraping: false,
      production_render_default_changed: false,
    },
  };

  const reportJson = path.join(OUT, "studio_v2_still_deck_report.json");
  const reportMd = path.join(OUT, "studio_v2_still_deck_report.md");
  await fs.writeJson(reportJson, report, { spaces: 2 });
  await fs.writeFile(reportMd, renderComparisonMarkdown(report), "utf8");
  process.stdout.write(renderComparisonMarkdown(report));
  process.stderr.write(`[still-deck] wrote ${rel(reportJson)} and ${rel(reportMd)}\n`);
}

main().catch((err) => {
  process.stderr.write(`[still-deck] ${err.stack || err.message}\n`);
  process.exit(1);
});
