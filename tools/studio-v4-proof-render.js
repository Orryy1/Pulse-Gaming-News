#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execFileSync } = require("node:child_process");
const { fileURLToPath } = require("node:url");

const { ffprobeDuration } = require("../lib/studio/media-acquisition");
const { wordsFromAlignment } = require("../lib/studio/sound-layer");
const mediaPaths = require("../lib/media-paths");
const {
  buildKineticAss,
  prepareSubtitleWords,
} = require("../lib/studio/v2/subtitle-layer-v2");
const {
  editorialSfxScore,
  minimumScoreForRole,
} = require("../lib/studio/v4/sfx-source-registry");
const {
  discoverPackConfigs,
  selectVariantAsset,
} = require("../lib/audio-identity");
const {
  STUDIO_V4_SFX_MIX_POLICY_VERSION,
  STUDIO_V4_VOICE_MIX_POLICY_VERSION,
  STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
} = require("../lib/studio/v4/render-policy");
const {
  auditRenderedAudioSegments,
} = require("../lib/render-audio-segment-qa");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");
const FPS = 30;
const XFADE_S = 0.25;
const FRAME_WIDTH_PX = 1080;
const FRAME_HEIGHT_PX = 1920;
const SAFE_RIGHT_PX = 42;
const SAFE_BOTTOM_PX = 92;

const SFX_ROLE_ORDER = ["ui_tick", "transition"];
const FALLBACK_SFX_CUE_LIMIT = 1;
const SFX_ROLE_BY_FAMILY = {
  impact: "impact",
  cash_snap: "impact",
  whoosh: "transition",
  transition_hit: "transition",
  source_tick: "ui_tick",
  chart_tick: "ui_tick",
  tick: "ui_tick",
  glitch: "glitch",
  sub_hit: "sub_hit",
  boom: "sub_hit",
  reveal: "riser",
  riser: "riser",
};
const SFX_MIX_PROFILE = {
  impact: { delayMs: 180, volume: 0.055, durationS: 0.32 },
  transition: { delayMs: 2250, volume: 0.045, durationS: 0.52 },
  ui_tick: { delayMs: 4700, volume: 0.003, durationS: 0.065 },
  glitch: { delayMs: 7200, volume: 0.036, durationS: 0.22 },
  sub_hit: { delayMs: 9800, volume: 0.048, durationS: 0.38 },
  riser: { delayMs: 12600, volume: 0.034, durationS: 0.55 },
};
const EARNED_SFX_TARGET_KINDS = new Set(["source_lock", "review_score_card", "steam_chart"]);
const EPIDEMIC_EARNED_SFX_TARGET_KINDS = new Set([
  "context_caveat",
  "hook_slam",
  "motion_clip",
  "pattern_interrupt",
  "price_snap",
  "proof_card",
  "review_score_card",
  "source_lock",
  "steam_chart",
]);
const MUSIC_MIX_POLICY = {
  version: "epidemic_sidechain_ducked_bed_v1",
  raw_bed_volume: 0.1,
  ducked_bed_output_volume: 0.26,
  sting_volume: 0.035,
  sting_duration_s: 0.62,
  duck_under_narration: true,
  sidechain_threshold: 0.035,
  sidechain_ratio: 5.5,
  sidechain_attack_ms: 18,
  sidechain_release_ms: 420,
};

function loadDotenvForCli() {
  try {
    if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
      require("dotenv").config({ override: true });
    }
  } catch {}
}

function parseArgs(argv = process.argv) {
  const args = {
    storyJson: null,
    output: null,
    json: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--story-json") args.storyJson = argv[++i] || null;
    else if (arg === "--output") args.output = argv[++i] || null;
    else if (arg === "--json") args.json = true;
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/studio-v4-proof-render.js --story-json <path> [--output <mp4>] [--json]",
      "",
      "Local proof render only. Reads a V4 render-ready story JSON, local audio and local materialized motion clips.",
      "It does not publish, touch OAuth tokens or mutate production database rows.",
    ].join("\n") + "\n",
  );
}

function drawtextEscape(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\u2019")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/%/g, " percent");
}

function assPathFilter(filePath) {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\\\:");
}

function resolvePathMaybeRoot(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return path.isAbsolute(text) ? text : path.resolve(ROOT, text);
}

function relativeReportPath(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return path.relative(ROOT, text).replace(/\\/g, "/");
}

function outputRelativeMediaPath(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const outputMatch = text.match(/[\\/]output[\\/].+$/i);
  if (outputMatch) return outputMatch[0].replace(/^[\\/]/, "").replace(/\\/g, "/");
  if (/^output[\\/]/i.test(text)) return text.replace(/\\/g, "/");
  return "";
}

async function resolveReadableMediaPath(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const mediaRoot = typeof mediaPaths.getMediaRoot === "function" ? mediaPaths.getMediaRoot() : null;
  const outputRelative = mediaRoot ? outputRelativeMediaPath(text) : "";
  if (outputRelative) {
    const mediaResolved = await mediaPaths.resolveExisting(outputRelative);
    if (mediaResolved && (await fs.pathExists(mediaResolved))) return mediaResolved;
  }
  const mediaResolved = await mediaPaths.resolveExisting(text);
  if (mediaResolved && (await fs.pathExists(mediaResolved))) return mediaResolved;
  return resolvePathMaybeRoot(text);
}

function sfxAssetsFromStory(story = {}) {
  const candidates = [
    story.sfx_asset_inventory,
    story.sfx_assets,
    story.sound_effects,
    story.sfx_manifest?.source_plan?.selected_assets,
    story.sfx_manifest?.selected_assets,
    story.sfx_source_plan?.selected_assets,
  ];
  for (const value of candidates) {
    if (Array.isArray(value) && value.length) return value.filter(Boolean);
  }
  return [];
}

function storyHasCuratedEpidemicSfx(story = {}) {
  return sfxAssetsFromStory(story).some((asset) =>
    String(asset.provider_id || asset.provider || "").toLowerCase() === "epidemic_sound",
  );
}

function sfxPathForAsset(asset = {}) {
  const raw = String(
    asset.local_path ||
      asset.file_path ||
      asset.path ||
      asset.source_url ||
      "",
  ).trim();
  if (!raw) return "";
  if (/^file:\/\//i.test(raw)) {
    try {
      return fileURLToPath(raw);
    } catch {
      return resolvePathMaybeRoot(raw.replace(/^file:\/\//i, ""));
    }
  }
  return resolvePathMaybeRoot(raw);
}

function isApprovedSfxAsset(asset = {}) {
  const approval = String(asset.approval_status || asset.status || "").toLowerCase();
  if (/(?:blocked|rejected|failed|unapproved|unknown)/.test(approval)) return false;
  const provider = String(asset.provider_id || asset.provider_name || "").toLowerCase();
  if (!provider) return false;
  return true;
}

function isEditoriallySuitableSfxAsset(asset = {}, role = sfxRoleForAsset(asset)) {
  const score = editorialSfxScore(asset, undefined, role);
  return score >= minimumScoreForRole(role);
}

function sfxRoleForAsset(asset = {}) {
  const raw = String(asset.role || asset.sfx_role || asset.family || asset.category || "transition")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return SFX_ROLE_BY_FAMILY[raw] || raw || "transition";
}

function sfxMixProfileForRole(role = "", index = 0) {
  const normalized = sfxRoleForAsset({ role });
  const base = SFX_MIX_PROFILE[normalized] || SFX_MIX_PROFILE.transition;
  return {
    delayMs: base.delayMs + Math.max(0, index) * 1150,
    volume: base.volume,
    durationS: base.durationS,
  };
}

function sfxSearchText(asset = {}, filePath = "") {
  const raw = [
    asset.asset_id,
    asset.id,
    asset.role,
    asset.family,
    asset.provider_id,
    asset.provider_name,
    asset.source_url,
    asset.local_path,
    asset.file_path,
    asset.path,
    filePath,
  ].filter(Boolean).join(" ");
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {}
  return decoded.toLowerCase().replace(/%20/g, " ").replace(/[_-]+/g, " ");
}

function sourceLockSfxScore(candidate = {}) {
  if (candidate.role !== "ui_tick") return -Infinity;
  const text = sfxSearchText(candidate.asset, candidate.path);
  let score = candidate.editorialScore || 0;
  const cleanInterfaceClick =
    /\b(?:uiclick ui click|ui click|user interface click|interface click|click standard short|short clean)\b/.test(text) &&
    !/\b(?:alert|confirm|data|progress|voice|vox|high tech beep|beep|plastic|window|zoom|activation ui click|activation user interface)\b/.test(text);
  if (cleanInterfaceClick) {
    score += 0.7;
  }
  if (/\buser interaction\b/.test(text)) score += 0.5;
  if (/\b(?:ui click|uiclick|user interface click|interface click|select middle|select)\b/.test(text)) score += 0.35;
  if (/\bselect middle\b/.test(text)) score -= 0.2;
  if (/\b(?:confirm middle|confirm|activation|alert|glitch|high tech beep|scanner|alien|kawaii|clock|voice|target acquired|calculation loop)\b/.test(text)) {
    if (!cleanInterfaceClick) score -= 1.15;
  }
  return score;
}

function sourceLockSfxCandidate(candidate = {}) {
  return sourceLockSfxScore(candidate) >= 0.82;
}

function bestCandidateForCue(candidates = [], request = {}, usedPaths = new Set()) {
  if (request.target_kind === "source_lock") {
    return candidates
      .filter((candidate) => !usedPaths.has(candidate.path))
      .filter(sourceLockSfxCandidate)
      .sort((a, b) => sourceLockSfxScore(b) - sourceLockSfxScore(a) || a.originalIndex - b.originalIndex)[0] || null;
  }
  return candidates.find((candidate) => candidate.role === request.role && !usedPaths.has(candidate.path)) || null;
}

function soundCueRequestsFromStory(story = {}) {
  const cues =
    story.sound_transition_plan?.sfx?.cues ||
    story.visual_v4_director_plan?.sound_transition_plan?.sfx?.cues ||
    story.director_plan?.sound_transition_plan?.sfx?.cues ||
    [];
  const earnedTargetKinds = storyHasCuratedEpidemicSfx(story)
    ? EPIDEMIC_EARNED_SFX_TARGET_KINDS
    : EARNED_SFX_TARGET_KINDS;
  return Array.isArray(cues)
    ? cues
        .map((cue) => ({
          role: sfxRoleForAsset({ role: cue.family || cue.role || cue.sfx_role }),
          target_kind: String(cue.target_kind || cue.kind || cue.targetKind || "").trim(),
          delayMs: Math.round(Math.max(0, Number(cue.atS || cue.startS || 0)) * 1000),
          durationS: Number(cue.durationS || cue.duration_s || 0) || null,
        }))
        .filter((cue) => earnedTargetKinds.has(cue.target_kind))
    : [];
}

function storyVariantSeed(story = {}) {
  return String(
    story.id ||
      story.story_id ||
      story.source_url_hash ||
      story.url ||
      story.title ||
      "story",
  );
}

function storyChannelId(story = {}) {
  return String(story.channel_id || story.channelId || process.env.CHANNEL || "pulse-gaming");
}

function isBreakingStory(story = {}) {
  const text = [
    story.classification,
    story.content_pillar,
    story.flair,
    story.title,
  ].join(" ").toLowerCase();
  return Boolean(
    story.breaking_fast_track ||
      story.breaking === true ||
      Number(story.breaking_score || 0) >= 80 ||
      /\bbreaking\b/.test(text),
  );
}

function stingRoleForStory(story = {}) {
  if (isBreakingStory(story)) return "sting_breaking";
  const flair = String(story.flair || story.content_pillar || "").toLowerCase();
  if (/\bverified\b|\bconfirmed\b/.test(flair)) return "sting_verified";
  if (/\brumou?r\b|\breportedly\b/.test(flair)) return "sting_rumour";
  return "";
}

function resolvePackAssetPath(packConfig = {}, asset = {}, workspaceRoot = ROOT) {
  const rootPath = packConfig.root_path || "";
  const resolvedRoot = path.isAbsolute(rootPath)
    ? rootPath
    : path.resolve(workspaceRoot, rootPath || ".");
  return path.resolve(resolvedRoot, asset.filename || "");
}

async function selectedPackAsset(packConfig = {}, role = "", { seed = "", workspaceRoot = ROOT } = {}) {
  const asset = selectVariantAsset(packConfig, role, { seed });
  if (!asset?.filename) return null;
  const assetPath = resolvePackAssetPath(packConfig, asset, workspaceRoot);
  if (!(await fs.pathExists(assetPath))) return null;
  return {
    role,
    asset_id: asset.asset_id || null,
    provider_id: asset.provider_id || "epidemic_sound",
    filename: asset.filename,
    path: assetPath,
    variant_index: asset.variant_index ?? null,
    variant_count: asset.variant_count ?? null,
    selection_strategy: asset.selection_strategy || null,
  };
}

async function resolveStoryMusicCueMix(story = {}, {
  workspaceRoot = ROOT,
  packConfigs = null,
} = {}) {
  const packs = Array.isArray(packConfigs) ? packConfigs : discoverPackConfigs();
  const channelId = storyChannelId(story);
  const pack = packs.find((candidate) => String(candidate.channel_id || "") === channelId);
  const seed = storyVariantSeed(story);
  if (pack) {
    const bedRoles = isBreakingStory(story)
      ? ["bed_breaking", "bed_primary"]
      : ["bed_primary", "bed_breaking"];
    let bed = null;
    for (const role of bedRoles) {
      bed = await selectedPackAsset(pack, role, { seed, workspaceRoot });
      if (bed) break;
    }
    const stingRole = stingRoleForStory(story);
    const sting = stingRole
      ? await selectedPackAsset(pack, stingRole, { seed, workspaceRoot })
      : null;
    if (bed) {
      return {
        provider_id: bed.provider_id || "epidemic_sound",
        channel_id: channelId,
        pack_id: pack.id || null,
        bed,
        sting,
        policy: { ...MUSIC_MIX_POLICY },
      };
    }
  }

  const legacyPath = path.join(ROOT, "audio", "mastered", "Main Background Loop 1.wav");
  if (await fs.pathExists(legacyPath)) {
    return {
      provider_id: "legacy_local",
      channel_id: channelId,
      pack_id: "legacy-mastered",
      bed: {
        role: "bed_primary",
        asset_id: "legacy_main_background_loop_1",
        provider_id: "legacy_local",
        filename: "audio/mastered/Main Background Loop 1.wav",
        path: legacyPath,
        variant_index: 0,
        variant_count: 1,
        selection_strategy: "legacy_fallback",
      },
      sting: null,
      policy: { ...MUSIC_MIX_POLICY, version: "legacy_sidechain_ducked_bed_v1" },
    };
  }

  return {
    provider_id: "none",
    channel_id: channelId,
    pack_id: null,
    bed: null,
    sting: null,
    policy: { ...MUSIC_MIX_POLICY },
  };
}

async function resolveStorySfxCueMix(story = {}, { limit = 6 } = {}) {
  const seenPaths = new Set();
  const candidates = [];
  for (const [index, asset] of sfxAssetsFromStory(story).entries()) {
    if (!isApprovedSfxAsset(asset)) continue;
    const resolved = sfxPathForAsset(asset);
    if (!resolved || seenPaths.has(resolved) || !(await fs.pathExists(resolved))) continue;
    const role = sfxRoleForAsset(asset);
    const editorialScore = editorialSfxScore(asset, undefined, role);
    if (!isEditoriallySuitableSfxAsset(asset, role)) continue;
    seenPaths.add(resolved);
    candidates.push({
      asset,
      path: resolved,
      role,
      editorialScore,
      originalIndex: index,
    });
  }
  candidates.sort((a, b) => b.editorialScore - a.editorialScore || a.originalIndex - b.originalIndex);

  const cueRequests = soundCueRequestsFromStory(story);
  if (cueRequests.length) {
    const usedPaths = new Set();
    const planned = [];
    for (const request of cueRequests) {
      const match = bestCandidateForCue(candidates, request, usedPaths);
      if (!match) continue;
      const profile = sfxMixProfileForRole(match.role, planned.length);
      usedPaths.add(match.path);
      planned.push({
        path: match.path,
        role: match.role,
        target_kind: request.target_kind,
        asset_id: match.asset.asset_id || match.asset.id || null,
        delayMs: request.delayMs,
        volume: profile.volume,
        durationS: Math.min(Number(request.durationS || profile.durationS || 0.32), 0.42),
      });
      if (planned.length >= limit) break;
    }
    return planned;
  }

  const selected = [];
  const usedPaths = new Set();
  for (const role of SFX_ROLE_ORDER) {
    const match = candidates.find((candidate) => candidate.role === role && !usedPaths.has(candidate.path));
    if (!match) continue;
    usedPaths.add(match.path);
    selected.push(match);
    if (selected.length >= Math.min(limit, FALLBACK_SFX_CUE_LIMIT)) break;
  }

  return selected.slice(0, Math.min(limit, FALLBACK_SFX_CUE_LIMIT)).map((entry, index) => {
    const profile = sfxMixProfileForRole(entry.role, index);
    return {
      path: entry.path,
      role: entry.role,
      asset_id: entry.asset.asset_id || entry.asset.id || null,
      delayMs: profile.delayMs,
      volume: profile.volume,
      durationS: profile.durationS,
    };
  });
}

async function resolveStorySfxPaths(story = {}, { limit = 6 } = {}) {
  const mix = await resolveStorySfxCueMix(story, { limit });
  return mix.map((cue) => cue.path);
}

function buildClipScenePlan({ clips = [], durationS, xfadeS = XFADE_S } = {}) {
  const cleanClips = clips.filter(Boolean);
  if (!cleanClips.length) {
    return { scenes: [], segmentDurationS: 0, xfadeS };
  }
  const duration = Math.max(1, Number(durationS) || 1);
  const count = Math.min(cleanClips.length, 8);
  const segmentDurationS = Number(
    ((duration + xfadeS * Math.max(0, count - 1)) / count).toFixed(2),
  );
  return {
    segmentDurationS,
    xfadeS,
    scenes: cleanClips.slice(0, count).map((clip, index) => ({
      index,
      path: clip,
      durationS: segmentDurationS,
    })),
  };
}

function sourceLabelFor(story = {}) {
  return (
    story.primary_source ||
    story.source_type ||
    story.subreddit ||
    "Verified source"
  );
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return "";
}

function renderNarrationScriptText(story = {}) {
  return firstText(
    story.narration_script,
    story.scriptForCaption,
    story.script_for_caption,
    story.transcript,
    story.caption_script,
    story.full_script,
    story.tts_script,
  );
}

function usableTimestampWord(word = {}) {
  const text = String(word?.word || word?.text || "").trim();
  const start = Number(word?.start);
  const end = Number(word?.end);
  return text && Number.isFinite(start) && Number.isFinite(end) && end >= start;
}

function subtitleWordsFromTimestampPayload(payload = {}) {
  const explicitWords = Array.isArray(payload?.words)
    ? payload.words
        .filter(usableTimestampWord)
        .map((word) => ({
          word: String(word.word || word.text).trim(),
          start: Number(word.start),
          end: Number(word.end),
        }))
    : [];
  if (explicitWords.length) return explicitWords;
  return wordsFromAlignment(payload?.alignment || payload);
}

function timestampPayloadMeta(payload = {}) {
  const alignment =
    payload?.alignment && typeof payload.alignment === "object"
      ? payload.alignment
      : {};
  if (payload?.meta && typeof payload.meta === "object") return payload.meta;
  if (alignment?.meta && typeof alignment.meta === "object") return alignment.meta;
  return {};
}

function validateProofTimestampPayload(payload = {}) {
  const meta = timestampPayloadMeta(payload);
  const source = String(
    meta.wordTimestampSource ||
      meta.word_timestamp_source ||
      payload.wordTimestampSource ||
      "",
  ).trim();
  const provider = String(
    meta.provider ||
      meta.voice_provider ||
      meta.source ||
      payload.provider ||
      "",
  ).trim().toLowerCase();
  const localTiming =
    provider.includes("local") ||
    /^local_/i.test(source) ||
    source === "local_tts_segmented_alignment_normalised";
  const localTimingStrict = !localTiming || source === "local_whisper_word_alignment";
  if (!localTimingStrict) {
    throw new Error(
      `proof render requires local_whisper_word_alignment timestamps for local voice review renders; got ${source || "missing_word_timestamp_source"}`,
    );
  }
  return {
    word_timestamp_source: source || null,
    local_timing_strict: localTimingStrict,
  };
}

function assertProofAudioSegmentLoudness(report = {}) {
  if (!report || report.verdict !== "pass") {
    const blockers = Array.isArray(report?.blockers) && report.blockers.length
      ? report.blockers.join(",")
      : "audio_segment_loudness_unverified";
    throw new Error(`proof render audio segment loudness failed: ${blockers}`);
  }
  return report;
}

function storyClipRows(story = {}) {
  const bridge = Array.isArray(story.visual_v4_bridge_video_clips)
    ? story.visual_v4_bridge_video_clips
    : [];
  const clips = Array.isArray(story.video_clips)
    ? story.video_clips.map((clip) => ({ path: clip }))
    : [];
  return [...bridge, ...clips].filter(Boolean);
}

function usesOwnedGeneratedMotionDeck(story = {}) {
  const clips = storyClipRows(story);
  if (clips.length < 5) return false;
  const ownedCount = clips.filter((clip) => {
    const text = [
      clip.path,
      clip.source_url,
      clip.source_type,
      clip.source_kind,
      clip.media_kind,
    ].filter(Boolean).join(" ").toLowerCase();
    return /output[\\/]+generated-motion|pulse-generated-motion|internally_generated_motion_graphic|owned_explainer_motion/.test(text);
  }).length;
  return ownedCount >= 5 && ownedCount / clips.length >= 0.5;
}

function compactOverlayText(value, fallback, maxChars = 34) {
  const raw = firstText(value, fallback);
  const words = raw.split(/\s+/).filter(Boolean);
  let out = "";
  for (const word of words) {
    const candidate = out ? `${out} ${word}` : word;
    if (candidate.length > maxChars && out) break;
    out = candidate;
    if (out.length >= maxChars) break;
  }
  return (out || fallback || "SOURCE LOCKED").toUpperCase();
}

function estimateOverlayTextWidthPx(value, fontSizePx) {
  const text = String(value || "");
  const fontSize = Math.max(1, Number(fontSizePx) || 1);
  let units = 0;
  for (const char of text) {
    if (char === " ") units += 0.34;
    else if (/[ilI1|!.,:;]/.test(char)) units += 0.34;
    else if (/[MW@#%&]/.test(char)) units += 0.78;
    else if (/[0-9]/.test(char)) units += 0.56;
    else if (/[A-Z]/.test(char)) units += 0.62;
    else units += 0.55;
  }
  return Math.ceil(units * fontSize);
}

function truncateTextToWidth(value, fontSizePx, maxWidthPx) {
  let text = String(value || "").trim();
  if (!text) return "";
  if (estimateOverlayTextWidthPx(text, fontSizePx) <= maxWidthPx) return text;
  const suffix = "...";
  while (text.length > 1) {
    text = text.slice(0, -1).trimEnd();
    if (estimateOverlayTextWidthPx(`${text}${suffix}`, fontSizePx) <= maxWidthPx) {
      return `${text}${suffix}`;
    }
  }
  return suffix;
}

function wrapOverlayText(value, { fontSizePx, maxWidthPx, maxLines = 1 } = {}) {
  const words = String(value || "").split(/\s+/).filter(Boolean);
  if (!words.length) return { lines: [], fits: true };
  const lines = [];
  let current = "";
  let consumed = 0;
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (estimateOverlayTextWidthPx(candidate, fontSizePx) <= maxWidthPx) {
      current = candidate;
      consumed += 1;
      continue;
    }
    if (current) {
      lines.push(current);
      current = "";
      if (lines.length >= maxLines) break;
    }
    if (estimateOverlayTextWidthPx(word, fontSizePx) <= maxWidthPx) {
      current = word;
      consumed += 1;
    } else {
      lines.push(truncateTextToWidth(word, fontSizePx, maxWidthPx));
      consumed += 1;
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  const fits = consumed >= words.length && lines.length <= maxLines;
  return { lines, fits };
}

function fitOverlayTextBlock({
  id,
  value,
  fallback,
  x,
  y,
  maxWidthPx,
  maxLines = 1,
  preferredFontSizePx,
  minFontSizePx,
  lineGapPx = 8,
  forceUpper = true,
}) {
  const raw = firstText(value, fallback, "SOURCE LOCKED");
  const text = forceUpper ? raw.toUpperCase() : raw;
  let layout = null;
  for (let fontSizePx = preferredFontSizePx; fontSizePx >= minFontSizePx; fontSizePx -= 2) {
    const candidate = wrapOverlayText(text, { fontSizePx, maxWidthPx, maxLines });
    if (candidate.fits) {
      layout = { ...candidate, fontSizePx };
      break;
    }
  }
  if (!layout) {
    const fallbackLayout = wrapOverlayText(text, {
      fontSizePx: minFontSizePx,
      maxWidthPx,
      maxLines,
    });
    const lines = fallbackLayout.lines.slice(0, maxLines);
    if (lines.length) {
      lines[lines.length - 1] = truncateTextToWidth(
        lines[lines.length - 1],
        minFontSizePx,
        maxWidthPx,
      );
    }
    layout = { lines, fits: false, fontSizePx: minFontSizePx };
  }
  const lineHeightPx = layout.fontSizePx + lineGapPx;
  const estimatedWidthPx = Math.max(
    0,
    ...layout.lines.map((line) => estimateOverlayTextWidthPx(line, layout.fontSizePx)),
  );
  return {
    id,
    text,
    lines: layout.lines,
    font_size_px: layout.fontSizePx,
    line_height_px: lineHeightPx,
    x,
    y,
    max_width_px: maxWidthPx,
    max_lines: maxLines,
    estimated_width_px: estimatedWidthPx,
    estimated_right_px: x + estimatedWidthPx,
    estimated_bottom_px: y + Math.max(1, layout.lines.length) * lineHeightPx,
    fits: layout.fits,
  };
}

function buildOverlayLayout({ story = {} } = {}) {
  const source = sourceLabelFor(story);
  const title = firstText(story.canonical_subject, story.title, "PULSE GAMING");
  const hook = firstText(
    story.first_frame_text,
    story.mobile_hook_text,
    story.canonical_subject,
    story.title,
    "PULSE GAMING",
  );
  const headline = firstText(
    story.thumbnail_headline,
    story.suggested_thumbnail_text,
    story.canonical_angle,
    story.title,
    hook,
  );
  const proofPrimary = firstText(
    story.proof_card_primary,
    story.primary_claim,
    story.player_impact,
    "SOURCE LOCKED",
  );
  const proofSecondary = firstText(
    story.proof_card_secondary,
    story.context_card,
    story.commercial_safe_cta,
    story.player_impact,
    "WHY IT MATTERS",
  );
  const blocks = [
    fitOverlayTextBlock({
      id: "top_subject",
      value: title,
      x: 66,
      y: 65,
      maxWidthPx: 710,
      maxLines: 1,
      preferredFontSizePx: 40,
      minFontSizePx: 28,
      lineGapPx: 5,
    }),
    fitOverlayTextBlock({
      id: "top_source_lock",
      value: `SOURCE LOCK  ${source}`,
      x: 66,
      y: 114,
      maxWidthPx: 820,
      maxLines: 1,
      preferredFontSizePx: 24,
      minFontSizePx: 18,
      lineGapPx: 5,
    }),
    fitOverlayTextBlock({
      id: "hook_card",
      value: hook,
      fallback: title,
      x: 82,
      y: 292,
      maxWidthPx: 860,
      maxLines: 2,
      preferredFontSizePx: 56,
      minFontSizePx: 42,
      lineGapPx: 8,
    }),
    fitOverlayTextBlock({
      id: "headline_card",
      value: headline,
      fallback: hook,
      x: 92,
      y: 558,
      maxWidthPx: 760,
      maxLines: 2,
      preferredFontSizePx: 58,
      minFontSizePx: 42,
      lineGapPx: 8,
    }),
    fitOverlayTextBlock({
      id: "headline_source",
      value: source,
      x: 92,
      y: 672,
      maxWidthPx: 780,
      maxLines: 1,
      preferredFontSizePx: 24,
      minFontSizePx: 18,
      lineGapPx: 5,
    }),
    fitOverlayTextBlock({
      id: "proof_primary",
      value: proofPrimary,
      x: 98,
      y: 850,
      maxWidthPx: 560,
      maxLines: 2,
      preferredFontSizePx: 40,
      minFontSizePx: 30,
      lineGapPx: 6,
    }),
    fitOverlayTextBlock({
      id: "proof_secondary",
      value: proofSecondary,
      x: 118,
      y: 1048,
      maxWidthPx: 540,
      maxLines: 2,
      preferredFontSizePx: 40,
      minFontSizePx: 30,
      lineGapPx: 6,
    }),
  ];
  return {
    frame: {
      width_px: FRAME_WIDTH_PX,
      height_px: FRAME_HEIGHT_PX,
      safe_right_px: FRAME_WIDTH_PX - SAFE_RIGHT_PX,
      safe_bottom_px: FRAME_HEIGHT_PX - SAFE_BOTTOM_PX,
    },
    text_blocks: blocks.map((block) => ({
      ...block,
      within_safe_bounds:
        block.estimated_right_px <= FRAME_WIDTH_PX - SAFE_RIGHT_PX &&
        block.estimated_bottom_px <= FRAME_HEIGHT_PX - SAFE_BOTTOM_PX,
    })),
  };
}

function drawtextLinesForBlock(block, { fontOpt, fontcolor, enable, shadow = true } = {}) {
  const filters = [];
  const suffix = enable ? `:enable='${enable}'` : "";
  const shadowArgs = shadow
    ? ":shadowcolor=black@0.82:shadowx=3:shadowy=3"
    : "";
  for (const [index, line] of block.lines.entries()) {
    filters.push(
      `drawtext=text='${drawtextEscape(line)}':${fontOpt}:fontcolor=${fontcolor}:fontsize=${block.font_size_px}:x=${block.x}:y=${block.y + index * block.line_height_px}${shadowArgs}${suffix}`,
    );
  }
  return filters;
}

function buildOverlayChain({ story, inputLabel, outputLabel, durationS, fontOpt }) {
  const layout = buildOverlayLayout({ story });
  const blockById = Object.fromEntries(layout.text_blocks.map((block) => [block.id, block]));
  const suppressStoryCards = usesOwnedGeneratedMotionDeck(story);
  return [
    `[${inputLabel}]eq=brightness=-0.045:contrast=1.08:saturation=1.16,drawbox=x=0:y=0:w=iw:h=230:color=black@0.34:t=fill,drawbox=x=0:y=138:w=iw:h=164:color=black@0.56:t=fill,drawbox=x=0:y=ih-430:w=iw:h=430:color=black@0.52:t=fill,drawbox=x=0:y=ih-315:w=iw:h=315:color=black@0.66:t=fill`,
    `drawbox=x=0:y=0:w=44:h=ih:color=0x0B0F19@0.72:t=fill`,
    `drawbox=x=iw-44:y=0:w=44:h=ih:color=0x0B0F19@0.72:t=fill`,
    `drawbox=x=44:y='mod(t*240\\,1920)-420':w=3:h=420:color=0x38BDF8@0.34:t=fill`,
    `drawbox=x='-260+mod(t*520\\,1540)':y=0:w=210:h=ih:color=white@0.055:t=fill`,
    `drawbox=x='940-mod(t*340\\,1220)':y=0:w=92:h=ih:color=0xFF6B1A@0.055:t=fill`,
    `drawbox=x=42:y=44:w=996:h=98:color=0x111827@0.58:t=fill`,
    `drawbox=x=42:y=44:w=996:h=98:color=0x0B0F19@0.34:t=fill`,
    `drawbox=x=42:y=44:w=996:h=98:color=0xF8FAFC@0.16:t=2`,
    `drawbox=x=42:y=44:w='if(lt(t\\,0.38)\\,1\\,1+(996-1)*(t-0.38)/0.34)':h=4:color=0x38BDF8@0.92:t=fill`,
    `drawtext=text='PULSE // NEWSWIRE':${fontOpt}:fontcolor=0x38BDF8:fontsize=18:x=66:y=53:shadowcolor=black@0.78:shadowx=2:shadowy=2`,
    ...drawtextLinesForBlock(blockById.top_subject, { fontOpt, fontcolor: "white" }),
    `drawtext=text='VERIFY':${fontOpt}:fontcolor=white@0.72:fontsize=17:x=w-tw-68:y=57:shadowcolor=black@0.72:shadowx=2:shadowy=2`,
    ...drawtextLinesForBlock(blockById.top_source_lock, { fontOpt, fontcolor: "0xFFB15C" }),
    ...(suppressStoryCards ? [] : [
    `drawbox=x=50:y=248:w=980:h=220:color=0x0B0F19@0.50:t=fill:enable='between(t,0,3.3)'`,
    `drawbox=x=50:y=248:w=980:h=220:color=0xF8FAFC@0.18:t=2:enable='between(t,0,3.3)'`,
    `drawbox=x=50:y=248:w=96:h=3:color=0xF8FAFC@0.88:t=fill:enable='between(t,0,3.3)'`,
    `drawbox=x=50:y=248:w='if(lt(t\\,0.18)\\,1\\,1+(980-1)*(t-0.18)/0.30)':h=5:color=0x38BDF8@0.92:t=fill:enable='between(t,0,3.3)'`,
    `drawbox=x=50:y=462:w=620:h=5:color=0xFF6B1A@0.72:t=fill:enable='between(t,0,3.3)'`,
    `drawbox=x='74+mod(t*380\\,820)':y=254:w=120:h=206:color=white@0.050:t=fill:enable='between(t,0,3.3)'`,
    ...drawtextLinesForBlock(blockById.hook_card, { fontOpt, fontcolor: "white", enable: "between(t,0,3.3)" }),
    `drawbox=x=64:y=520:w=956:h=222:color=0x0B0F19@0.48:t=fill:enable='between(t,4.0,8.4)'`,
    `drawbox=x=64:y=520:w=956:h=222:color=0xF8FAFC@0.16:t=2:enable='between(t,4.0,8.4)'`,
    `drawbox=x=64:y=520:w=956:h=4:color=white@0.22:t=fill:enable='between(t,4.0,8.4)'`,
    `drawbox=x=64:y=736:w='if(lt(t\\,4.22)\\,1\\,1+(956-1)*(t-4.22)/0.34)':h=6:color=0x38BDF8@0.92:t=fill:enable='between(t,4.0,8.4)'`,
    ...drawtextLinesForBlock(blockById.headline_card, { fontOpt, fontcolor: "white", enable: "between(t,4.0,8.4)" }),
    ...drawtextLinesForBlock(blockById.headline_source, { fontOpt, fontcolor: "0xFFB15C", enable: "between(t,4.0,8.4)", shadow: false }),
    `drawbox=x=76:y=812:w=690:h=140:color=0x0B0F19@0.46:t=fill:enable='between(t,9.0,12.4)'`,
    `drawbox=x=76:y=812:w=690:h=140:color=0xF8FAFC@0.14:t=2:enable='between(t,9.0,12.4)'`,
    `drawbox=x=76:y=812:w='if(lt(t\\,9.18)\\,1\\,1+(690-1)*(t-9.18)/0.28)':h=5:color=0x38BDF8@0.92:t=fill:enable='between(t,9.0,12.4)'`,
    `drawtext=text='PROOF BEAT':${fontOpt}:fontcolor=0x38BDF8:fontsize=18:x=98:y=824:enable='between(t,9.0,12.4)'`,
    ...drawtextLinesForBlock(blockById.proof_primary, { fontOpt, fontcolor: "white", enable: "between(t,9.0,12.4)" }),
    `drawbox=x=96:y=1010:w=690:h=140:color=0x0B0F19@0.46:t=fill:enable='between(t,16.0,19.3)'`,
    `drawbox=x=96:y=1010:w=690:h=140:color=0xF8FAFC@0.14:t=2:enable='between(t,16.0,19.3)'`,
    `drawbox=x=96:y=1144:w='if(lt(t\\,16.18)\\,1\\,1+(690-1)*(t-16.18)/0.32)':h=5:color=0x38BDF8@0.92:t=fill:enable='between(t,16.0,19.3)'`,
    `drawtext=text='PLAYER READ':${fontOpt}:fontcolor=0x38BDF8:fontsize=18:x=118:y=1022:enable='between(t,16.0,19.3)'`,
    ...drawtextLinesForBlock(blockById.proof_secondary, { fontOpt, fontcolor: "white", enable: "between(t,16.0,19.3)" }),
    ]),
    `drawtext=text='PULSE GAMING':${fontOpt}:fontcolor=white@0.78:fontsize=28:x=w-tw-42:y=h-92:shadowcolor=black@0.70:shadowx=2:shadowy=2`,
    `trim=duration=${Number(durationS).toFixed(3)},setpts=PTS-STARTPTS[${outputLabel}]`,
  ].join(",");
}

async function renderProof({ storyJson, output }) {
  if (!storyJson) throw new Error("missing --story-json");
  const storyPath = resolvePathMaybeRoot(storyJson);
  const story = await fs.readJson(storyPath);
  const audioPath = await resolveReadableMediaPath(story.audio_path);
  const timestampsPath = await resolveReadableMediaPath(
    story.timestamps_path ||
      story.audio_path?.replace(/\.mp3$/i, "_timestamps.json"),
  );
  if (!(await fs.pathExists(audioPath))) throw new Error(`audio missing: ${audioPath}`);
  if (!(await fs.pathExists(timestampsPath))) {
    throw new Error(`timestamps missing: ${timestampsPath}`);
  }

  const bridgeClips = Array.isArray(story.visual_v4_bridge_video_clips)
    ? story.visual_v4_bridge_video_clips.map((clip) => clip.path)
    : [];
  const clipCandidates = bridgeClips.length ? bridgeClips : story.video_clips || [];
  const clips = [];
  for (const clip of clipCandidates) {
    const resolved = await resolveReadableMediaPath(clip);
    if (resolved && fs.existsSync(resolved)) clips.push(resolved);
  }
  if (!clips.length) throw new Error("no local V4 clips available");

  const durationS = ffprobeDuration(audioPath);
  if (!Number.isFinite(durationS) || durationS <= 0) {
    throw new Error(`invalid audio duration: ${audioPath}`);
  }
  const scenePlan = buildClipScenePlan({ clips, durationS });
  const assPath = path.join(TEST_OUT, `${story.id || "story"}_studio_v4_proof.ass`);
  const timestampData = await fs.readJson(timestampsPath);
  const timestampValidation = validateProofTimestampPayload(timestampData);
  const scriptText = renderNarrationScriptText(story);
  const words = prepareSubtitleWords({
    words: subtitleWordsFromTimestampPayload(timestampData),
    duration: durationS,
    scriptText,
    strictEndCoverage: false,
  });
  const ass = buildKineticAss({
    story,
    words,
    duration: durationS,
    scriptText,
    maxWordsPerPhrase: 2,
    maxPhraseChars: 16,
    captionCase: "upper",
    revealMode: "word",
    motionStyle: "flash",
    avoidDanglingWords: true,
    maxPhraseDurationS: 1.1,
    minPhraseDurationS: 0.28,
  });
  await fs.ensureDir(TEST_OUT);
  await fs.writeFile(assPath, ass, "utf8");

  const outputPath = output
    ? resolvePathMaybeRoot(output)
    : path.join(TEST_OUT, `studio_v4_${story.id || "story"}_proof.mp4`);
  await fs.ensureDir(path.dirname(outputPath));

  const ffmpegArgs = ["-y", "-hide_banner", "-loglevel", "warning"];
  for (const scene of scenePlan.scenes) {
    ffmpegArgs.push("-stream_loop", "-1", "-t", String(scene.durationS), "-i", scene.path);
  }
  const voiceIdx = scenePlan.scenes.length;
  ffmpegArgs.push("-i", audioPath);
  const musicCueMix = await resolveStoryMusicCueMix(story);
  const musicPath = musicCueMix.bed?.path || "";
  const hasMusic = musicPath && (await fs.pathExists(musicPath));
  const musicIdx = hasMusic ? ffmpegArgs.filter((item) => item === "-i").length : -1;
  if (hasMusic) {
    ffmpegArgs.push(
      "-stream_loop",
      "-1",
      "-t",
      (durationS + 1).toFixed(2),
      "-i",
      musicPath,
    );
  }
  const stingPath = musicCueMix.sting?.path || "";
  const hasSting = stingPath && (await fs.pathExists(stingPath));
  const stingIdx = hasSting ? ffmpegArgs.filter((item) => item === "-i").length : -1;
  if (hasSting) ffmpegArgs.push("-i", stingPath);
  const sfxCueMix = await resolveStorySfxCueMix(story, { limit: 6 });
  const sfxStartIdx = ffmpegArgs.filter((item) => item === "-i").length;
  for (const cue of sfxCueMix) ffmpegArgs.push("-i", cue.path);

  const fontOpt =
    process.platform === "win32"
      ? "fontfile='C\\:/Windows/Fonts/arial.ttf'"
      : "font='DejaVu Sans'";
  const filterParts = [];
  for (const scene of scenePlan.scenes) {
    const i = scene.index;
    filterParts.push(
      `[${i}:v]split=2[bgsrc${i}][fgsrc${i}]`,
      `[bgsrc${i}]scale=1080:1920:force_original_aspect_ratio=increase:in_range=pc:out_range=tv,crop=w=1080:h=1920:x=(iw-1080)/2:y=(ih-1920)/2,boxblur=32:1,eq=brightness=-0.10:saturation=1.18,fps=${FPS},format=yuv420p,setsar=1[bg${i}]`,
      `[fgsrc${i}]scale=1010:1780:force_original_aspect_ratio=decrease:in_range=pc:out_range=tv,fps=${FPS},format=yuv420p,setsar=1[fg${i}]`,
      `[bg${i}][fg${i}]overlay=(W-w)/2:(H-h)/2,trim=duration=${scene.durationS},setpts=PTS-STARTPTS,fps=${FPS},format=yuv420p,setsar=1[v${i}]`,
    );
  }
  let prev = "v0";
  for (let i = 1; i < scenePlan.scenes.length; i++) {
    const out = i === scenePlan.scenes.length - 1 ? "base" : `xf${i}`;
    const offset = i * (scenePlan.segmentDurationS - scenePlan.xfadeS);
    filterParts.push(
      `[${prev}][v${i}]xfade=transition=smoothleft:duration=${scenePlan.xfadeS}:offset=${offset.toFixed(2)}[${out}]`,
    );
    prev = out;
  }
  if (scenePlan.scenes.length === 1) filterParts.push("[v0]copy[base]");
  filterParts.push(buildOverlayChain({
    story,
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS,
    fontOpt,
  }));
  filterParts.push(`[overlayBase]ass=${assPathFilter(assPath)},format=yuv420p[outv]`);

  const audioMixInputs = [];
  const mixLabels = ["[a_voice]"];
  if (hasMusic) {
    audioMixInputs.push(`[${voiceIdx}:a]asplit=2[a_voice_in][a_voice_sc]`);
    audioMixInputs.push(
      `[a_voice_in]highpass=f=70,volume=0.86,acompressor=threshold=-30dB:ratio=5.5:attack=4:release=260:makeup=1,alimiter=limit=0.68:level=disabled,loudnorm=I=-17:TP=-2.5:LRA=5[a_voice]`,
    );
    audioMixInputs.push(
      `[${musicIdx}:a]volume=${MUSIC_MIX_POLICY.raw_bed_volume.toFixed(3)},atrim=duration=${durationS.toFixed(3)}[a_music_raw]`,
    );
    audioMixInputs.push(
      `[a_music_raw][a_voice_sc]sidechaincompress=threshold=${MUSIC_MIX_POLICY.sidechain_threshold}:ratio=${MUSIC_MIX_POLICY.sidechain_ratio}:attack=${MUSIC_MIX_POLICY.sidechain_attack_ms}:release=${MUSIC_MIX_POLICY.sidechain_release_ms}:knee=3:level_sc=1,volume=${MUSIC_MIX_POLICY.ducked_bed_output_volume.toFixed(3)}[a_music]`,
    );
    mixLabels.push("[a_music]");
  } else {
    audioMixInputs.push(
      `[${voiceIdx}:a]highpass=f=70,volume=0.86,acompressor=threshold=-30dB:ratio=5.5:attack=4:release=260:makeup=1,alimiter=limit=0.68:level=disabled,loudnorm=I=-17:TP=-2.5:LRA=5[a_voice]`,
    );
  }
  if (hasSting) {
    const stingDuration = Math.max(0.18, Math.min(MUSIC_MIX_POLICY.sting_duration_s, 0.8));
    audioMixInputs.push(
      `[${stingIdx}:a]volume=${MUSIC_MIX_POLICY.sting_volume.toFixed(3)},atrim=duration=${stingDuration.toFixed(3)},afade=t=in:st=0:d=0.01,afade=t=out:st=${Math.max(0.02, stingDuration - 0.08).toFixed(3)}:d=0.08,atrim=duration=${durationS.toFixed(3)}[a_sting]`,
    );
    mixLabels.push("[a_sting]");
  }
  for (let i = 0; i < sfxCueMix.length; i++) {
    const cue = sfxCueMix[i];
    const label = `a_sfx_${i}`;
    const delay = Number(cue.delayMs) || 0;
    const volume = Number(cue.volume) || 0.04;
    const cueDuration = Math.max(0.08, Math.min(Number(cue.durationS) || 0.32, 0.55));
    audioMixInputs.push(
      `[${sfxStartIdx + i}:a]volume=${volume.toFixed(3)},atrim=duration=${cueDuration.toFixed(3)},afade=t=in:st=0:d=0.012,afade=t=out:st=${Math.max(0.02, cueDuration - 0.08).toFixed(3)}:d=0.08,adelay=${delay}|${delay},atrim=duration=${durationS.toFixed(3)}[${label}]`,
    );
    mixLabels.push(`[${label}]`);
  }
  filterParts.push(...audioMixInputs);
  filterParts.push(
    `${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=0:normalize=0,loudnorm=I=-16:TP=-2:LRA=6,alimiter=limit=0.80:level=disabled[outa]`,
  );

  const filterPath = path.join(TEST_OUT, `${story.id || "story"}_studio_v4_proof_filter.txt`);
  await fs.writeFile(filterPath, filterParts.join(";\n"), "utf8");

  ffmpegArgs.push(
    "-filter_complex_script",
    filterPath,
    "-map",
    "[outv]",
    "-map",
    "[outa]",
    "-c:v",
    "libx264",
    "-crf",
    "19",
    "-preset",
    "medium",
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "high",
    "-level:v",
    "4.0",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-t",
    durationS.toFixed(3),
    "-r",
    String(FPS),
    "-movflags",
    "+faststart",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    outputPath,
  );

  execFileSync("ffmpeg", ffmpegArgs, {
    cwd: ROOT,
    stdio: "inherit",
  });

  const finalDuration = ffprobeDuration(outputPath);
  const audioSegmentLoudness = assertProofAudioSegmentLoudness(await auditRenderedAudioSegments({
    storyId: story.id || null,
    inputPath: outputPath,
    durationS: finalDuration || durationS,
  }));
  const audioSegmentReportPath = path.join(TEST_OUT, `${story.id || "story"}_audio_segment_loudness_report.json`);
  await fs.writeJson(audioSegmentReportPath, audioSegmentLoudness, { spaces: 2 });
  const stat = await fs.stat(outputPath);
  const report = {
    story_id: story.id || null,
    title: story.title || null,
    output: path.relative(ROOT, outputPath).replace(/\\/g, "/"),
    ass: path.relative(ROOT, assPath).replace(/\\/g, "/"),
    filter: path.relative(ROOT, filterPath).replace(/\\/g, "/"),
    clips: scenePlan.scenes.length,
    audio_duration_s: Number(durationS.toFixed(3)),
    rendered_duration_s: Number(finalDuration.toFixed(3)),
    size_bytes: stat.size,
    sfx_mix_policy_version: STUDIO_V4_SFX_MIX_POLICY_VERSION,
    voice_mix_policy_version: STUDIO_V4_VOICE_MIX_POLICY_VERSION,
    visual_design_policy_version: STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
    narration_script_source: story.narration_script ? "narration_script" : story.full_script ? "full_script" : "tts_script",
    selected_sfx_cues: sfxCueMix.map((cue) => ({
      asset_id: cue.asset_id || null,
      role: cue.role || null,
      target_kind: cue.target_kind || null,
      volume: cue.volume,
      durationS: cue.durationS,
    })),
    selected_music_cues: {
      provider_id: musicCueMix.provider_id || null,
      pack_id: musicCueMix.pack_id || null,
      bed: musicCueMix.bed
        ? {
            role: musicCueMix.bed.role,
            asset_id: musicCueMix.bed.asset_id,
            path: relativeReportPath(musicCueMix.bed.path),
            variant_index: musicCueMix.bed.variant_index,
            variant_count: musicCueMix.bed.variant_count,
            selection_strategy: musicCueMix.bed.selection_strategy,
          }
        : null,
      sting: musicCueMix.sting
        ? {
            role: musicCueMix.sting.role,
            asset_id: musicCueMix.sting.asset_id,
            path: relativeReportPath(musicCueMix.sting.path),
            variant_index: musicCueMix.sting.variant_index,
            variant_count: musicCueMix.sting.variant_count,
            selection_strategy: musicCueMix.sting.selection_strategy,
          }
        : null,
      policy: musicCueMix.policy || null,
    },
    caption_timestamp_source: timestampValidation.word_timestamp_source,
    caption_timing_strict: timestampValidation.local_timing_strict,
    audio_segment_loudness_report: relativeReportPath(audioSegmentReportPath),
    audio_segment_loudness_verdict: audioSegmentLoudness.verdict,
    audio_segment_loudness_metrics: audioSegmentLoudness.metrics || {},
    local_only: true,
    no_publish_side_effects: true,
    no_db_mutation: true,
  };
  await fs.writeJson(path.join(TEST_OUT, `${story.id || "story"}_studio_v4_proof_report.json`), report, {
    spaces: 2,
  });
  return report;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  const report = await renderProof(args);
  if (args.json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else process.stdout.write(`[studio-v4-proof] ${report.output} (${report.clips} clips)\n`);
}

if (require.main === module) {
  loadDotenvForCli();
  main().catch((err) => {
    process.stderr.write(`[studio-v4-proof] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  loadDotenvForCli,
  parseArgs,
  buildOverlayLayout,
  buildClipScenePlan,
  buildOverlayChain,
  drawtextEscape,
  renderNarrationScriptText,
  resolveReadableMediaPath,
  resolveStoryMusicCueMix,
  resolveStorySfxCueMix,
  resolveStorySfxPaths,
  sfxPathForAsset,
  subtitleWordsFromTimestampPayload,
  validateProofTimestampPayload,
  assertProofAudioSegmentLoudness,
  renderProof,
};
