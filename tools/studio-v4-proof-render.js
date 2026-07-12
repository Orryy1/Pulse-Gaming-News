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
  variantAssetsForRole,
} = require("../lib/audio-identity");
const {
  resolveContentIdentity,
  selectIdentityVariant,
} = require("../lib/content-identity-system");
const {
  STUDIO_V4_SFX_MIX_POLICY_VERSION,
  STUDIO_V4_VOICE_MIX_POLICY_VERSION,
  STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
} = require("../lib/studio/v4/render-policy");
const {
  auditRenderedAudioSegments,
} = require("../lib/render-audio-segment-qa");
const {
  PULSE_SIGNATURE_VERSION,
  buildPulseSignatureContract,
} = require("../lib/studio/v4/pulse-signature-layer");
const {
  SOURCE_CARD_TIMING,
} = require("../lib/studio/v4/premium-card-timing-policy");
const {
  resolveLivingMotionGrammar,
} = require("../lib/studio/v4/living-motion-grammar");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");
const FPS = 30;
const XFADE_S = 0.25;
const DEFAULT_DIRECT_CLIP_MAX_VISIBLE_DWELL_S = 7;
const DEFAULT_DIRECT_CLIP_MAX_SCENES = 40;
const SCENE_DURATION_FRAME_TOLERANCE_S = 1 / FPS;
const SOURCE_LOCK_OVERLAY_CARD_DURATION_S = SOURCE_CARD_TIMING.planned_visible_duration_s;
const MIN_OVERLAY_CARD_DURATION_S = 4.2;
const HEADLINE_OVERLAY_CARD_DURATION_S = 4.6;
const MAX_OVERLAY_CARD_DURATION_S = 5.8;
const MIN_COMPACT_PROOF_OVERLAY_DURATION_S = 2.6;
const MAX_COMPACT_PROOF_OVERLAY_DURATION_S = 4.2;
const MIN_GENERATED_CARD_SCENE_DURATION_S = 7;
const MIN_DIRECT_MOTION_SCENES_WITH_READABLE_CARDS = 4;
const MAX_READABLE_CARD_DURATION_RATIO = 0.42;
const MAX_DIRECT_MOTION_SOURCE_CONCENTRATION_RATIO = 0.55;
const MAX_DIRECT_MOTION_SCENES_PER_SOURCE_ROOT = 4;
const OVERLAY_ANTI_FREEZE_NOISE_STRENGTH = 10;
const FRAME_WIDTH_PX = 1080;
const FRAME_HEIGHT_PX = 1920;
const SAFE_RIGHT_PX = 42;
const SAFE_BOTTOM_PX = 92;
const INSTAGRAM_TOP_CHROME_SAFE_PX = 240;
const SOCIAL_AUDIO_SAMPLE_RATE = 48000;

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

function positiveEnvNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function buildFinalSocialAudioMixFilter(mixLabels, { outputLabel = "outa" } = {}) {
  if (!Array.isArray(mixLabels) || mixLabels.length === 0) {
    throw new Error("final_social_audio_mix_labels_missing");
  }
  const safeOutputLabel = String(outputLabel || "outa").replace(/[^A-Za-z0-9_]/g, "") || "outa";
  return `${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=0:normalize=0,loudnorm=I=-16:TP=-2:LRA=6,alimiter=limit=0.80:level=disabled,aresample=${SOCIAL_AUDIO_SAMPLE_RATE}[${safeOutputLabel}]`;
}

function directClipMaxVisibleDwellS() {
  return positiveEnvNumber(
    "STUDIO_V4_DIRECT_CLIP_MAX_VISIBLE_DWELL_S",
    DEFAULT_DIRECT_CLIP_MAX_VISIBLE_DWELL_S,
  );
}

function directClipMaxScenes() {
  return Math.max(
    8,
    Math.round(positiveEnvNumber("STUDIO_V4_DIRECT_CLIP_MAX_SCENES", DEFAULT_DIRECT_CLIP_MAX_SCENES)),
  );
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

async function selectedIdentityPackAsset(packConfig = {}, identity = {}, kind = "bed", {
  seed = "",
  workspaceRoot = ROOT,
} = {}) {
  const selection = identity?.audio?.[kind];
  if (!selection?.role) return null;
  const variants = variantAssetsForRole(packConfig, selection.role);
  const asset = selectIdentityVariant(variants, selection.variant_indexes, {
    identityId: identity.id,
    storySeed: seed,
    role: kind,
  });
  if (!asset?.filename) return null;
  const assetPath = resolvePackAssetPath(packConfig, asset, workspaceRoot);
  if (!(await fs.pathExists(assetPath))) return null;
  return {
    ...asset,
    role: selection.role,
    asset_id: asset.asset_id || null,
    provider_id: asset.provider_id || "epidemic_sound",
    path: assetPath,
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
  const contentIdentity = resolveContentIdentity(story);
  if (pack) {
    let bed = await selectedIdentityPackAsset(pack, contentIdentity, "bed", { seed, workspaceRoot });
    if (!bed) {
      const bedRoles = isBreakingStory(story)
        ? ["bed_breaking", "bed_primary"]
        : ["bed_primary", "bed_breaking"];
      for (const role of bedRoles) {
        bed = await selectedPackAsset(pack, role, { seed, workspaceRoot });
        if (bed) break;
      }
    }
    let sting = await selectedIdentityPackAsset(pack, contentIdentity, "sting", { seed, workspaceRoot });
    if (!sting) {
      const stingRole = stingRoleForStory(story);
      sting = stingRole
        ? await selectedPackAsset(pack, stingRole, { seed, workspaceRoot })
        : null;
    }
    if (bed) {
      return {
        provider_id: bed.provider_id || "epidemic_sound",
        channel_id: channelId,
        pack_id: pack.id || null,
        bed,
        sting,
        content_identity: contentIdentity,
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
      content_identity: contentIdentity,
      policy: { ...MUSIC_MIX_POLICY, version: "legacy_sidechain_ducked_bed_v1" },
    };
  }

  return {
    provider_id: "none",
    channel_id: channelId,
    pack_id: null,
    bed: null,
    sting: null,
    content_identity: contentIdentity,
    policy: { ...MUSIC_MIX_POLICY },
  };
}

async function resolveStorySfxCueMix(story = {}, { limit = 6 } = {}) {
  const contentIdentity = resolveContentIdentity(story);
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
        identity_id: contentIdentity.id,
      });
      if (planned.length >= limit) break;
    }
    return planned;
  }

  const selected = [];
  const usedPaths = new Set();
  const hasContentIdentitySignal = Boolean(
    story.title || story.selected_title || story.public_title || story.classification || story.flair || story.content_pillar || story.content_identity,
  );
  const roleOrder = hasContentIdentitySignal
    ? [...new Set([...contentIdentity.audio.sfx_roles, ...SFX_ROLE_ORDER])]
    : SFX_ROLE_ORDER;
  for (const role of roleOrder) {
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
      identity_id: contentIdentity.id,
    };
  });
}

async function resolveStorySfxPaths(story = {}, { limit = 6 } = {}) {
  const mix = await resolveStorySfxCueMix(story, { limit });
  return mix.map((cue) => cue.path);
}

function sceneClipPath(clip) {
  if (typeof clip === "string") return clip.trim();
  return firstText(
    clip?.resolved_path,
    clip?.path,
    clip?.media_path,
    clip?.local_path,
    clip?.local_materialized_path,
  );
}

function normaliseSceneSourceKey(value = "") {
  const withoutQuery = firstText(value)
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/[?#].*$/, "");
  return withoutQuery
    .replace(/\.(?:mp4|mov|webm|mkv|m3u8|mpd)$/i, "")
    .replace(
      /([_/-]v4[_/-]clip[_/-]?\d+)[_/-]segment[_/-]direct[_/-]motion[_/-]?\d+(?:[_/-][a-f0-9]{6,})?$/i,
      "$1",
    )
    .replace(
      /[_/-]segment[_/-]direct[_/-]motion[_/-]?\d+(?:[_/-][a-f0-9]{6,})?$/i,
      "",
    )
    .replace(
      /\/(?:hls(?:_[a-z0-9]+)*_master|hls(?:_[a-z0-9]+)*|dash(?:_[a-z0-9]+)*|movie(?:_max|\d+)?(?:_[a-z0-9]+)*)$/i,
      "",
    )
    .replace(/(?<!v4)(?:[_/-]clip[_/-]?\d+)$/i, "")
    .replace(/(?:[_/-]segment[_/-]?\d+)$/i, "");
}

function steamTrailerSceneAssetKey(value = "") {
  const text = firstText(value)
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/[?#].*$/, "");
  const match = text.match(
    /(?:^|[/:\s])store_trailers\/(\d+)\/(\d+)\/([a-f0-9]{16,})\/(\d+)(?:\/|$)/i,
  );
  return match ? `steam-trailer:${match[1]}/${match[2]}/${match[3]}/${match[4]}` : "";
}

function youtubeSceneAssetKey(value = "") {
  const text = firstText(value);
  if (!text) return "";
  try {
    const parsed = new URL(text);
    const host = parsed.hostname.toLowerCase().replace(/^(?:www\.|m\.)/, "");
    if (host === "youtube.com") {
      const pathVideoId = parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/i)?.[1];
      const videoId = firstText(parsed.searchParams.get("v"), pathVideoId);
      if (videoId) return `youtube:${videoId.toLowerCase()}`;
    }
    if (host === "youtu.be") {
      const videoId = firstText(parsed.pathname.split("/").filter(Boolean)[0]);
      if (videoId) return `youtube:${videoId.toLowerCase()}`;
    }
  } catch {}
  return "";
}

function windowedSceneSourceKey(clip = {}) {
  if (!clip || typeof clip !== "object") return "";
  const value = firstText(
    clip.source_family,
    clip.motion_family,
    clip.provenance?.source_family,
    clip.provenance?.motion_family,
  );
  if (!/(?:^|[_/-])window[_/-]?\d+/i.test(value)) {
    const startS = Number(
      clip.start_s ??
        clip.startS ??
        clip.mediaStartS ??
        clip.media_start_s ??
        clip.segment_start_s ??
        clip.provenance?.source_start_s,
    );
    if (!value || !Number.isFinite(startS) || startS < 0) return "";
    const durationS = Number(clip.durationS ?? clip.duration_s ?? clip.duration);
    const durationKey = Number.isFinite(durationS) && durationS > 0 ? `_${durationS}` : "";
    return normaliseSceneSourceKey(`${value}_window_${startS}${durationKey}`);
  }
  return normaliseSceneSourceKey(value);
}

function stripWindowFromSceneSourceKey(value = "") {
  return normaliseSceneSourceKey(value).replace(/(?:[_/-]window[_/-]?\d+(?:[_/-]\d+)?)$/i, "");
}

function sceneClipRepeatSourceKey(clip = {}, entry = {}) {
  if (entry.readableCardKind) return "";
  const explicit = clip && typeof clip === "object"
    ? firstText(
        clip.source_root_family,
        clip.base_source_family,
        clip.original_source_family,
        clip.provenance?.base_source_family,
        clip.source_family,
        clip.motion_family,
      )
    : clip;
  return stripWindowFromSceneSourceKey(entry.sourceRootKey || entry.baseSourceKey || explicit);
}

function clipHasWindowedSourceKey(clip = {}, entry = {}) {
  const value = firstText(
    entry.baseSourceKey,
    entry.sourceRootKey,
    clip && typeof clip === "object" ? clip.source_family : "",
    clip && typeof clip === "object" ? clip.motion_family : "",
    clip && typeof clip === "object" ? clip.base_source_family : "",
    clip && typeof clip === "object" ? clip.source_url : "",
  );
  return /(?:^|[_/-])window[_/-]?\d+/i.test(value);
}

function balancedWindowRepeatAllowances(clips = []) {
  const uniquePaths = new Set();
  const windowedEntries = [];
  for (const clip of clips.filter(Boolean)) {
    const clipPath = sceneClipPath(clip);
    const pathKey = String(clipPath || "").trim().toLowerCase();
    if (!pathKey || uniquePaths.has(pathKey)) continue;
    uniquePaths.add(pathKey);
    const readableCardKind = sceneClipReadableCardKind(clip);
    const entry = {
      baseSourceKey: sceneClipBaseSourceKey(clip),
      sourceRootKey: sceneClipSourceRootKey(clip),
      readableCardKind,
    };
    const repeatKey = sceneClipRepeatSourceKey(clip, entry);
    if (!repeatKey || readableCardKind || !clipHasWindowedSourceKey(clip, entry)) continue;
    windowedEntries.push({ repeatKey });
  }
  const total = windowedEntries.length;
  if (!total) return new Map();
  const counts = new Map();
  for (const entry of windowedEntries) {
    counts.set(entry.repeatKey, (counts.get(entry.repeatKey) || 0) + 1);
  }
  const allowances = new Map();
  const distinctRoots = counts.size;
  if (distinctRoots === 2 && total >= 6) {
    const balancedTwoRootPool = [...counts.values()].every((count) => count >= 3);
    if (balancedTwoRootPool) {
      for (const [key] of counts.entries()) {
        allowances.set(key, 3);
      }
    }
    return allowances;
  }
  if (distinctRoots < 4) return allowances;
  for (const [key, count] of counts.entries()) {
    const share = count / total;
    if (count === 3 && total >= 8 && share <= 0.38) {
      allowances.set(key, count);
      continue;
    }
    if (count <= 2 && share <= 0.34) {
      allowances.set(key, count);
    }
  }
  return allowances;
}

function readSceneClipSidecar(clip = {}) {
  const clipPath = sceneClipPath(clip);
  if (!clipPath) return null;
  const candidates = [`${clipPath}.json`];
  if (clip && typeof clip === "object" && clip.original_path) {
    candidates.push(`${clip.original_path}.json`);
  }
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return fs.readJsonSync(candidate);
    } catch {
      // Sidecar evidence is optional. A bad sidecar should not hide
      // the raw clip; other gates will still validate the render.
    }
  }
  return null;
}

function sceneClipBaseSourceKey(clip = {}) {
  if (!clip) return "";
  const isObject = typeof clip === "object";
  const windowed = isObject ? windowedSceneSourceKey(clip) : "";
  if (windowed) return windowed;
  const rawSourceUrl = isObject
    ? firstText(clip.source_url, clip.url, clip.original_source_url, clip.reference_url)
    : "";
  const sourceYoutubeKey = youtubeSceneAssetKey(rawSourceUrl);
  if (sourceYoutubeKey) return sourceYoutubeKey;
  const sourceSteamKey = steamTrailerSceneAssetKey(rawSourceUrl);
  if (sourceSteamKey) return sourceSteamKey;
  const explicit = isObject
    ? normaliseSceneSourceKey(
        clip.base_source_family ||
          clip.original_source_family ||
          clip.provenance?.base_source_family ||
          clip.provenance?.source_family ||
          clip.source_family ||
          clip.motion_family,
      )
    : "";
  const explicitSteamKey = steamTrailerSceneAssetKey(explicit);
  if (explicitSteamKey) return explicitSteamKey;
  if (explicit) return explicit;
  const sidecar = readSceneClipSidecar(clip);
  const sidecarExplicit = normaliseSceneSourceKey(
    sidecar?.base_source_family ||
      sidecar?.original_source_family ||
      sidecar?.source_family ||
      sidecar?.motion_family,
  );
  const sidecarExplicitSteamKey = steamTrailerSceneAssetKey(sidecarExplicit);
  if (sidecarExplicitSteamKey) return sidecarExplicitSteamKey;
  if (sidecarExplicit) return sidecarExplicit;
  const sidecarUrl = firstText(sidecar?.source_url, sidecar?.url, sidecar?.original_source_url);
  const sidecarYoutubeKey = youtubeSceneAssetKey(sidecarUrl);
  if (sidecarYoutubeKey) return sidecarYoutubeKey;
  const sidecarSteamKey = steamTrailerSceneAssetKey(sidecarUrl);
  if (sidecarSteamKey) return sidecarSteamKey;
  if (sidecarUrl) {
    try {
      const parsed = new URL(sidecarUrl);
      return normaliseSceneSourceKey(`${parsed.hostname}${parsed.pathname}`);
    } catch {
      return normaliseSceneSourceKey(sidecarUrl);
    }
  }
  const url = rawSourceUrl;
  if (!url) return isObject ? "" : normaliseSceneSourceKey(clip);
  try {
    const parsed = new URL(url);
    return normaliseSceneSourceKey(`${parsed.hostname}${parsed.pathname}`);
  } catch {
    return normaliseSceneSourceKey(url || clip);
  }
}

function sceneClipSourceRootKey(clip = {}) {
  if (!clip) return "";
  const isObject = typeof clip === "object";
  const sidecar = isObject ? readSceneClipSidecar(clip) : null;
  const url = isObject
    ? firstText(
        clip.source_url,
        clip.url,
        clip.original_source_url,
        clip.reference_url,
        sidecar?.source_url,
        sidecar?.url,
        sidecar?.original_source_url,
      )
    : "";
  if (url) {
    const youtubeKey = youtubeSceneAssetKey(url);
    if (youtubeKey) return youtubeKey;
    const steamKey = steamTrailerSceneAssetKey(url);
    if (steamKey) return steamKey;
    try {
      const parsed = new URL(url);
      return stripWindowFromSceneSourceKey(`${parsed.hostname}${parsed.pathname}`);
    } catch {
      return stripWindowFromSceneSourceKey(url);
    }
  }
  const explicit = isObject
    ? firstText(
        clip.source_root_family,
        clip.base_source_family,
        clip.original_source_family,
        clip.provenance?.base_source_family,
        sidecar?.source_root_family,
        sidecar?.base_source_family,
        sidecar?.original_source_family,
      )
    : "";
  const explicitSteamKey = steamTrailerSceneAssetKey(explicit);
  if (explicitSteamKey) return explicitSteamKey;
  if (explicit) return stripWindowFromSceneSourceKey(explicit);
  return stripWindowFromSceneSourceKey(sceneClipBaseSourceKey(clip));
}

function sceneClipSourceDurationS(clip = {}) {
  if (!clip) return null;
  const isObject = typeof clip === "object";
  const sidecar = readSceneClipSidecar(clip);
  const duration = Number(
    (isObject ? clip.durationS : undefined) ??
      (isObject ? clip.duration_s : undefined) ??
      (isObject ? clip.duration : undefined) ??
      sidecar?.durationS ??
      sidecar?.duration_s ??
      sidecar?.duration,
  );
  return Number.isFinite(duration) && duration > 0 ? Number(duration.toFixed(2)) : null;
}

function sceneClipMinimumReadableDurationS(clip = {}) {
  if (!clip || typeof clip !== "object") return null;
  const sidecar = readSceneClipSidecar(clip);
  const duration = Number(
    clip.minimum_readable_duration_s ??
      clip.minimum_visible_duration_s ??
      clip.min_readable_duration_s ??
      sidecar?.hyperframes_premium_shell?.readability_contract?.evidence?.minimum_visible_duration_s ??
      sidecar?.minimum_readable_duration_s ??
      sidecar?.minimum_visible_duration_s,
  );
  return Number.isFinite(duration) && duration > 0
    ? Number(Math.max(MIN_GENERATED_CARD_SCENE_DURATION_S, duration).toFixed(2))
    : null;
}

function sceneClipReadableCardKind(clip = {}) {
  if (!clip) return "";
  const clipPath = sceneClipPath(clip);
  const sidecar = readSceneClipSidecar(clip) || {};
  const text = [
    typeof clip === "object" ? clip.id : "",
    clipPath,
    typeof clip === "object" ? clip.asset_class : "",
    typeof clip === "object" ? clip.source_type : "",
    typeof clip === "object" ? clip.source_kind : "",
    typeof clip === "object" ? clip.media_kind : "",
    typeof clip === "object" ? clip.source_family : "",
    typeof clip === "object" ? clip.motion_family : "",
    sidecar.card_kind,
    sidecar.asset_class,
  ].filter(Boolean).join(" ").toLowerCase();
  if (!/hyperframes|generated-motion|pulse-generated-motion|owned_explainer_motion|internally_generated_motion_graphic/.test(text)) {
    return "";
  }
  if (/branded[_-]?wipe|motion[_-]?background|lower[_-]?third/.test(text)) return "";
  const matched = text.match(
    /(source|context|timeline|quote|takeaway|proof|stat|chart|carousel|screenshot|breaking|title)[_-]?(?:card|slide|transform)?/,
  );
  if (matched?.[1]) return matched[1];
  if (/\bcard\b/.test(text)) return "card";
  return "";
}

function sceneClipReadableText(clip = {}, fallbackKind = "") {
  if (!clip || typeof clip !== "object") return cleanCardText(fallbackKind);
  const sidecar = readSceneClipSidecar(clip) || {};
  return cleanCardText(
    firstText(
      clip.readable_text,
      clip.text,
      clip.copy,
      clip.headline,
      clip.title,
      clip.label,
      sidecar.hyperframes_premium_shell?.readability_contract?.evidence?.readable_text,
      sidecar.readability_contract?.evidence?.readable_text,
      sidecar.readable_text,
      fallbackKind,
    ),
  );
}

function readableCardMinimumDurationS({ readableText = "", explicitMinimumS = null, readableCardKind = "" } = {}) {
  const kind = String(readableCardKind || "").trim().toLowerCase();
  if (kind === "source" || kind === "source_lock") {
    const explicit = Number(explicitMinimumS);
    return Number(
      Math.min(
        SOURCE_LOCK_OVERLAY_CARD_DURATION_S,
        Math.max(
          Number.isFinite(explicit) && explicit > 0 ? explicit : SOURCE_LOCK_OVERLAY_CARD_DURATION_S,
          1.2,
        ),
      ).toFixed(2),
    );
  }
  const explicit = Number(explicitMinimumS);
  const text = cleanCardText(readableText);
  const textMinimum = readableOverlayCardDurationS(text, {
    minS: MIN_GENERATED_CARD_SCENE_DURATION_S,
    maxS: 12,
  });
  return Number(
    Math.max(
      MIN_GENERATED_CARD_SCENE_DURATION_S,
      Number.isFinite(explicit) && explicit > 0 ? explicit : 0,
      textMinimum,
    ).toFixed(2),
  );
}

function cleanCardText(value = "") {
  return firstText(value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function repeatedSceneBaseSources(entries = []) {
  const counts = new Map();
  for (const entry of entries) {
    if (!entry.baseSourceKey) continue;
    counts.set(entry.baseSourceKey, (counts.get(entry.baseSourceKey) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function repeatedReadableCardKinds(entries = []) {
  const counts = new Map();
  for (const entry of entries) {
    if (!entry.readableCardKind) continue;
    counts.set(entry.readableCardKind, (counts.get(entry.readableCardKind) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

function directMotionSourceConcentration(entries = []) {
  const directEntries = entries.filter((entry) => !entry.readableCardKind);
  const total = directEntries.length;
  const counts = new Map();
  for (const entry of directEntries) {
    if (!entry.sourceRootKey) continue;
    counts.set(entry.sourceRootKey, (counts.get(entry.sourceRootKey) || 0) + 1);
  }
  const concentrated = [...counts.entries()]
    .map(([key, count]) => ({
      key,
      count,
      ratio: total > 0 ? Number((count / total).toFixed(3)) : 0,
    }))
    .filter((entry) =>
      entry.count > MAX_DIRECT_MOTION_SCENES_PER_SOURCE_ROOT &&
      entry.ratio > MAX_DIRECT_MOTION_SOURCE_CONCENTRATION_RATIO,
    )
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return {
    direct_motion_scene_count: total,
    max_scenes_per_source_root: MAX_DIRECT_MOTION_SCENES_PER_SOURCE_ROOT,
    max_source_concentration_ratio: MAX_DIRECT_MOTION_SOURCE_CONCENTRATION_RATIO,
    concentrated_sources: concentrated,
  };
}

function buildClipScenePlan({
  clips = [],
  durationS,
  xfadeS = XFADE_S,
  maxSceneDurationS = null,
  maxScenes = DEFAULT_DIRECT_CLIP_MAX_SCENES,
  allowClipReuse = false,
} = {}) {
  let maxSceneLimit = Math.max(1, Math.round(Number(maxScenes) || DEFAULT_DIRECT_CLIP_MAX_SCENES));
  const cleanEntries = [];
  const seen = new Set();
  const seenDirectBaseSources = new Map();
  const windowRepeatAllowances = allowClipReuse === true ? new Map() : balancedWindowRepeatAllowances(clips);
  const skippedDuplicateBaseSources = [];
  const duration = Math.max(1, Number(durationS) || 1);
  const maxDwell = Number(maxSceneDurationS);
  if (Number.isFinite(maxDwell) && maxDwell > xfadeS + 0.1) {
    let sourceCappedCoverageS = 0;
    let sourceCappedCount = 0;
    const seenSourceCapPaths = new Set();
    for (const clip of clips.filter(Boolean)) {
      const clipPath = sceneClipPath(clip);
      const key = String(clipPath).trim().toLowerCase();
      if (!key || seenSourceCapPaths.has(key)) continue;
      seenSourceCapPaths.add(key);
      const sourceDuration = sceneClipSourceDurationS(clip);
      const usableDuration = Math.min(
        maxDwell,
        Number.isFinite(sourceDuration) ? sourceDuration : maxDwell,
      );
      sourceCappedCoverageS = Number(
        (sourceCappedCoverageS + usableDuration - (sourceCappedCount > 0 ? xfadeS : 0)).toFixed(3),
      );
      sourceCappedCount += 1;
      if (sourceCappedCoverageS + 0.12 >= duration) break;
    }
    if (sourceCappedCoverageS + 0.12 >= duration) {
      maxSceneLimit = Math.max(maxSceneLimit, sourceCappedCount);
    }
  }
  for (const clip of clips.filter(Boolean)) {
    const clipPath = sceneClipPath(clip);
    const key = String(clipPath).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const readableCardKind = sceneClipReadableCardKind(clip);
    const readableText = sceneClipReadableText(clip, readableCardKind);
    const explicitReadableMinimum = sceneClipMinimumReadableDurationS(clip);
    const entry = {
      path: clipPath,
      baseSourceKey: sceneClipBaseSourceKey(clip),
      sourceRootKey: sceneClipSourceRootKey(clip),
      sourceDurationS: sceneClipSourceDurationS(clip),
      minimumReadableDurationS: readableCardKind
        ? readableCardMinimumDurationS({
            readableText,
            explicitMinimumS: explicitReadableMinimum,
            readableCardKind,
          })
        : explicitReadableMinimum,
      readableCardKind,
      readableText,
    };
    const repeatSourceKey = allowClipReuse === true ? "" : sceneClipRepeatSourceKey(clip, entry);
    const allowedRepeatCount = Math.max(1, Number(windowRepeatAllowances.get(repeatSourceKey) || 1));
    const seenRepeatCount = repeatSourceKey ? Number(seenDirectBaseSources.get(repeatSourceKey) || 0) : 0;
    if (repeatSourceKey && seenRepeatCount >= allowedRepeatCount) {
      skippedDuplicateBaseSources.push({
        key: repeatSourceKey,
        path: clipPath,
        baseSourceKey: entry.baseSourceKey || null,
        sourceRootKey: entry.sourceRootKey || null,
      });
      continue;
    }
    if (repeatSourceKey) seenDirectBaseSources.set(repeatSourceKey, seenRepeatCount + 1);
    cleanEntries.push(entry);
    if (cleanEntries.length >= maxSceneLimit) break;
  }
  if (!cleanEntries.length) {
    return {
      scenes: [],
      segmentDurationS: 0,
      xfadeS,
      repeatFree: true,
      blockers: ["direct_motion_clips_missing"],
      requiredUniqueClipCount: 0,
      availableUniqueClipCount: 0,
      sourceDurationOverruns: [],
      skippedDuplicateBaseSources,
    };
  }
  const repeatFree = allowClipReuse !== true;
  if (
    repeatFree &&
    cleanEntries.length > 1 &&
    cleanEntries.every((entry) => !entry.readableCardKind)
  ) {
    const rawSourceCoverageS = Number(
      cleanEntries
        .reduce((sum, entry) => {
          const sourceDuration = Number.isFinite(entry.sourceDurationS)
            ? entry.sourceDurationS
            : maxDwell;
          const usableDuration =
            Number.isFinite(maxDwell) && maxDwell > 0
              ? Math.min(maxDwell, sourceDuration)
              : sourceDuration;
          return sum + (Number.isFinite(usableDuration) ? usableDuration : 0);
        }, 0)
        .toFixed(3),
    );
    const transitionCount = cleanEntries.length - 1;
    const currentTransitionLossS = Number((xfadeS * transitionCount).toFixed(3));
    const currentCoveredS = Number((rawSourceCoverageS - currentTransitionLossS).toFixed(3));
    if (rawSourceCoverageS + 0.12 >= duration && currentCoveredS + 0.12 < duration) {
      const maxTransitionLossS = Math.max(0, rawSourceCoverageS - duration + 0.08);
      const fittedXfadeS = Number((maxTransitionLossS / transitionCount).toFixed(3));
      if (Number.isFinite(fittedXfadeS) && fittedXfadeS >= 0.04 && fittedXfadeS < xfadeS) {
        xfadeS = fittedXfadeS;
      }
    }
  }
  let requiredCount = cleanEntries.length;
  const readableDeck =
    cleanEntries.filter((entry) => entry.readableCardKind).length >= 3 &&
    cleanEntries.filter((entry) => entry.readableCardKind).length / cleanEntries.length >= 0.4;
  if (Number.isFinite(maxDwell) && maxDwell > xfadeS + 0.1) {
    const dwellRequiredCount = Math.ceil((duration - xfadeS) / (maxDwell - xfadeS));
    requiredCount = readableDeck
      ? Math.min(maxSceneLimit, dwellRequiredCount)
      : Math.max(cleanEntries.length, Math.min(maxSceneLimit, dwellRequiredCount));
  }
  if (Number.isFinite(maxDwell) && maxDwell > xfadeS + 0.1) {
    let sourceCappedCoverageS = 0;
    let sourceCappedRequiredCount = null;
    for (let index = 0; index < Math.min(cleanEntries.length, maxSceneLimit); index += 1) {
      const entry = cleanEntries[index];
      const sourceDuration = Number.isFinite(entry.sourceDurationS)
        ? entry.sourceDurationS
        : maxDwell;
      const usableDuration = Math.min(maxDwell, sourceDuration);
      sourceCappedCoverageS = Number(
        (sourceCappedCoverageS + usableDuration - (index > 0 ? xfadeS : 0)).toFixed(3),
      );
      if (sourceCappedCoverageS + 0.12 >= duration) {
        sourceCappedRequiredCount = index + 1;
        break;
      }
    }
    if (sourceCappedRequiredCount != null) {
      requiredCount = Math.max(requiredCount, sourceCappedRequiredCount);
    }
  }
  const blockers = [];
  const repeatedBaseSources = repeatFree ? repeatedSceneBaseSources(cleanEntries) : [];
  if (repeatFree && repeatedBaseSources.length) {
    blockers.push("direct_motion_base_source_repeated");
  }
  const repeatedReadableCards = repeatFree ? repeatedReadableCardKinds(cleanEntries) : [];
  if (repeatFree && repeatedReadableCards.length) {
    blockers.push("readable_card_kind_repeated");
  }
  const directMotionSourceConcentrationMetrics =
    repeatFree ? directMotionSourceConcentration(cleanEntries) : {
      direct_motion_scene_count: cleanEntries.filter((entry) => !entry.readableCardKind).length,
      max_scenes_per_source_root: MAX_DIRECT_MOTION_SCENES_PER_SOURCE_ROOT,
      max_source_concentration_ratio: MAX_DIRECT_MOTION_SOURCE_CONCENTRATION_RATIO,
      concentrated_sources: [],
    };
  if (repeatFree && directMotionSourceConcentrationMetrics.concentrated_sources.length) {
    blockers.push("direct_motion_source_concentration_above_premium_floor");
  }
  if (repeatFree && requiredCount > cleanEntries.length) {
    blockers.push("direct_motion_clip_diversity_below_dwell_floor");
  }
  const count = repeatFree ? Math.min(cleanEntries.length, requiredCount) : requiredCount;
  const equalSegmentDurationS = Number(
    ((duration + xfadeS * Math.max(0, count - 1)) / count).toFixed(2),
  );
  const selectedEntries = [];
  for (let index = 0; index < count; index += 1) {
    const entry = repeatFree ? cleanEntries[index] : cleanEntries[index % cleanEntries.length];
    if (!entry) continue;
    selectedEntries.push(entry);
  }
  const desiredSceneDurationTotalS = Number(
    (duration + xfadeS * Math.max(0, selectedEntries.length - 1)).toFixed(2),
  );
  const readableCardIndexes = selectedEntries
    .map((entry, index) => Number.isFinite(entry.minimumReadableDurationS) && entry.readableCardKind ? index : -1)
    .filter((index) => index >= 0);
  const directSceneIndexes = selectedEntries
    .map((entry, index) => entry.readableCardKind ? -1 : index)
    .filter((index) => index >= 0);
  const readableCardMinimumTotalS = Number(
    readableCardIndexes
      .reduce((sum, index) => sum + Number(selectedEntries[index].minimumReadableDurationS || 0), 0)
      .toFixed(2),
  );
  const directSceneBudgetS =
    readableCardIndexes.length && directSceneIndexes.length
      ? Number((desiredSceneDurationTotalS - readableCardMinimumTotalS).toFixed(2))
      : null;
  const directSceneEqualDurationS =
    directSceneBudgetS != null && directSceneBudgetS > 0
      ? Number((directSceneBudgetS / directSceneIndexes.length).toFixed(3))
      : null;
  const plannedDurations = selectedEntries.map((entry) => {
    const maxDuration = Number.isFinite(entry.sourceDurationS)
      ? entry.sourceDurationS
      : equalSegmentDurationS;
    const minimumReadable = Number.isFinite(entry.minimumReadableDurationS)
      ? entry.minimumReadableDurationS
      : null;
    const baseline = minimumReadable ||
      (directSceneEqualDurationS != null
        ? Math.min(maxDuration, directSceneEqualDurationS)
        : Math.min(maxDuration, equalSegmentDurationS));
    return Number(Math.max(1, Math.min(maxDuration, baseline)).toFixed(2));
  });
  let remainingExtraS = Number(
    (desiredSceneDurationTotalS - plannedDurations.reduce((sum, value) => sum + value, 0)).toFixed(2),
  );
  while (remainingExtraS > 0.009) {
    const expandable = selectedEntries
      .map((entry, index) => {
        const maxDuration = Number.isFinite(entry.sourceDurationS)
          ? entry.sourceDurationS
          : equalSegmentDurationS;
        return {
          index,
          headroom: Number((maxDuration - plannedDurations[index]).toFixed(3)),
        };
      })
      .filter((entry) => entry.headroom > 0.009);
    if (!expandable.length) break;
    const slice = Number((remainingExtraS / expandable.length).toFixed(3));
    let consumed = 0;
    for (const entry of expandable) {
      const add = Math.min(entry.headroom, slice);
      plannedDurations[entry.index] = Number((plannedDurations[entry.index] + add).toFixed(3));
      consumed += add;
    }
    remainingExtraS = Number((remainingExtraS - consumed).toFixed(3));
    if (consumed <= 0.009) break;
  }
  const sceneEntries = selectedEntries.map((entry, index) => ({
      ...entry,
      durationS: Number(plannedDurations[index].toFixed(2)),
      plannedDurationS: Number(plannedDurations[index].toFixed(2)),
    }));
  let coveredDurationS = 0;
  for (const entry of sceneEntries) {
    coveredDurationS = Number(
      (coveredDurationS + entry.plannedDurationS - (coveredDurationS > 0 ? xfadeS : 0)).toFixed(2),
    );
  }
  const sourceDurationOverruns = repeatFree
    ? sceneEntries
        .filter((entry) => Number.isFinite(entry.sourceDurationS))
        .map((entry) => ({
          path: entry.path,
          planned_duration_s: entry.plannedDurationS,
          source_duration_s: entry.sourceDurationS,
          overrun_s: Number((entry.plannedDurationS - entry.sourceDurationS).toFixed(2)),
        }))
        .filter((entry) => entry.overrun_s > 0.12)
    : [];
  if (sourceDurationOverruns.length) {
    blockers.push("motion_scene_duration_exceeds_source_duration");
  }
  const readableDurationUnderruns = repeatFree
    ? sceneEntries
        .filter((entry) => Number.isFinite(entry.minimumReadableDurationS))
        .map((entry) => ({
          path: entry.path,
          planned_duration_s: entry.plannedDurationS,
          minimum_readable_duration_s: entry.minimumReadableDurationS,
          underrun_s: Number((entry.minimumReadableDurationS - entry.plannedDurationS).toFixed(2)),
        }))
        .filter((entry) => entry.underrun_s > SCENE_DURATION_FRAME_TOLERANCE_S)
    : [];
  if (readableDurationUnderruns.length) {
    blockers.push("readable_card_scene_duration_below_minimum");
  }
  if (repeatFree && coveredDurationS + 0.12 < duration) {
    blockers.push("approved_scene_duration_below_audio_duration");
  }
  if (repeatFree && coveredDurationS - 0.12 > duration) {
    blockers.push("approved_scene_duration_exceeds_audio_duration");
  }
  const readableCardSceneCount = sceneEntries.filter((entry) => entry.readableCardKind).length;
  const directMotionSceneCount = sceneEntries.length - readableCardSceneCount;
  const readableCardDurationS = Number(
    sceneEntries
      .filter((entry) => entry.readableCardKind)
      .reduce((sum, entry) => sum + Number(entry.durationS || 0), 0)
      .toFixed(2),
  );
  const directMotionDurationS = Number(
    sceneEntries
      .filter((entry) => !entry.readableCardKind)
      .reduce((sum, entry) => sum + Number(entry.durationS || 0), 0)
      .toFixed(2),
  );
  const readableCardDurationRatio =
    coveredDurationS > 0
      ? Number((readableCardDurationS / coveredDurationS).toFixed(3))
      : 0;
  const readableCardSceneMetrics = {
    readable_card_scene_count: readableCardSceneCount,
    direct_motion_scene_count: directMotionSceneCount,
    readable_card_duration_s: readableCardDurationS,
    direct_motion_duration_s: directMotionDurationS,
    readable_card_duration_ratio: readableCardDurationRatio,
    max_readable_card_duration_ratio: MAX_READABLE_CARD_DURATION_RATIO,
    min_direct_motion_scene_count_with_readable_cards:
      MIN_DIRECT_MOTION_SCENES_WITH_READABLE_CARDS,
  };
  if (
    repeatFree &&
    readableCardSceneCount >= 2 &&
    directMotionSceneCount > 0 &&
    directMotionSceneCount < MIN_DIRECT_MOTION_SCENES_WITH_READABLE_CARDS
  ) {
    blockers.push("direct_motion_scene_count_below_premium_floor");
  }
  if (
    repeatFree &&
    readableCardSceneCount > 0 &&
    readableCardDurationRatio > MAX_READABLE_CARD_DURATION_RATIO
  ) {
    blockers.push("readable_card_duration_ratio_above_premium_floor");
  }
  const transitionOffsets = sceneEntries.slice(1).map((_, index) => {
    const scenesBeforeTransition = sceneEntries.slice(0, index + 1);
    return Number(
      (
        scenesBeforeTransition.reduce((sum, scene) => sum + scene.durationS, 0) -
        xfadeS * scenesBeforeTransition.length
      ).toFixed(2),
    );
  });
  const scenes = sceneEntries.map((entry, index) => ({
    index,
    path: entry.path,
    durationS: entry.durationS,
    sourceDurationS: entry.sourceDurationS || null,
    minimumReadableDurationS: entry.minimumReadableDurationS || null,
    baseSourceKey: entry.baseSourceKey || null,
    sourceRootKey: entry.sourceRootKey || null,
    readableCardKind: entry.readableCardKind || null,
    readableText: entry.readableText || "",
  }));
  const cardVisibleWindows = scenes
    .filter((scene) => scene.readableCardKind)
    .map((scene) => {
      const start = scene.index === 0 ? 0 : transitionOffsets[scene.index - 1] ?? 0;
      const duration = Number(scene.durationS || 0);
      return {
        id: `scene_${scene.index}_${scene.readableCardKind}`,
        kind: scene.readableCardKind,
        text: scene.readableText || scene.readableCardKind,
        path: scene.path,
        start_s: Number(start.toFixed(2)),
        end_s: Number((start + duration).toFixed(2)),
        duration_s: Number(duration.toFixed(2)),
        minimum_readable_duration_s:
          scene.minimumReadableDurationS || MIN_OVERLAY_CARD_DURATION_S,
        source: "visual_v4_scene_plan",
      };
    });
  return {
    segmentDurationS: sceneEntries.length
      ? Number((sceneEntries.reduce((sum, scene) => sum + scene.durationS, 0) / sceneEntries.length).toFixed(2))
      : 0,
    xfadeS,
    repeatFree,
    blockers,
    requiredUniqueClipCount: requiredCount,
    availableUniqueClipCount: cleanEntries.length,
    repeatedBaseSources,
    skippedDuplicateBaseSources,
    repeatedReadableCardKinds: repeatedReadableCards,
    directMotionSourceConcentrationMetrics,
    sourceDurationOverruns,
    readableDurationUnderruns,
    readableCardSceneMetrics,
    coveredDurationS,
    transitionOffsets,
    cardVisibleWindows,
    scenes,
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

function validateProofTimestampPayload(payload = {}, options = {}) {
  const meta = timestampPayloadMeta(payload);
  const source = String(
    meta.wordTimestampSource ||
      meta.word_timestamp_source ||
      payload.wordTimestampSource ||
      options.wordTimestampSource ||
      options.word_timestamp_source ||
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
  const safeMarginMode = story.render_safe_text_margins === true;
  const signature = buildPulseSignatureContract({ story });
  const openingOffsetX = safeMarginMode ? 12 : 0;
  const openingSourceX = signature.opening.layout.source_x_px + openingOffsetX;
  const openingSafeRight = safeMarginMode ? 998 : 1010;
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
      id: "top_source_lock",
      value: `SOURCE LOCK  ${source}`,
      x: openingSourceX,
      y: 268,
      maxWidthPx: openingSafeRight - openingSourceX,
      maxLines: 1,
      preferredFontSizePx: 20,
      minFontSizePx: 16,
      lineGapPx: 5,
    }),
    fitOverlayTextBlock({
      id: "hook_card",
      value: hook,
      fallback: title,
      x: safeMarginMode ? 122 : 92,
      y: 326,
      maxWidthPx: safeMarginMode ? 790 : 830,
      maxLines: 2,
      preferredFontSizePx: 54,
      minFontSizePx: 40,
      lineGapPx: 8,
    }),
    fitOverlayTextBlock({
      id: "headline_card",
      value: headline,
      fallback: hook,
      x: safeMarginMode ? 122 : 92,
      y: 558,
      maxWidthPx: safeMarginMode ? 700 : 760,
      maxLines: 2,
      preferredFontSizePx: 58,
      minFontSizePx: 42,
      lineGapPx: 8,
    }),
    fitOverlayTextBlock({
      id: "headline_source",
      value: source,
      x: safeMarginMode ? 122 : 92,
      y: 672,
      maxWidthPx: safeMarginMode ? 700 : 780,
      maxLines: 1,
      preferredFontSizePx: 24,
      minFontSizePx: 18,
      lineGapPx: 5,
    }),
    fitOverlayTextBlock({
      id: "proof_primary",
      value: proofPrimary,
      x: safeMarginMode ? 124 : 98,
      y: 850,
      maxWidthPx: safeMarginMode ? 520 : 560,
      maxLines: 2,
      preferredFontSizePx: 40,
      minFontSizePx: 30,
      lineGapPx: 6,
    }),
    fitOverlayTextBlock({
      id: "proof_secondary",
      value: proofSecondary,
      x: safeMarginMode ? 142 : 118,
      y: 1048,
      maxWidthPx: safeMarginMode ? 500 : 540,
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
      instagram_top_chrome_safe_px: INSTAGRAM_TOP_CHROME_SAFE_PX,
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

function readableOverlayCardDurationS(
  value = "",
  { minS = MIN_OVERLAY_CARD_DURATION_S, maxS = MAX_OVERLAY_CARD_DURATION_S } = {},
) {
  const text = firstText(value);
  if (!text) return minS;
  const words = text.split(/\s+/).filter(Boolean).length;
  const longTokenPenalty = /\b[A-Z0-9]{6,}\b/.test(text) ? 0.25 : 0;
  const computed = Math.max(minS, 0.34 * words + 2.8 + longTokenPenalty);
  return Number(
    Math.min(
      maxS,
      Math.ceil(Math.max(computed, minS) * 10) / 10,
    ).toFixed(1),
  );
}

function readableCompactProofOverlayDurationS(value = "") {
  const text = firstText(value);
  if (!text) return MIN_COMPACT_PROOF_OVERLAY_DURATION_S;
  const words = text.split(/\s+/).filter(Boolean).length;
  const computed = Math.max(MIN_COMPACT_PROOF_OVERLAY_DURATION_S, 0.22 * words + 1.8);
  return Number(
    Math.min(
      MAX_COMPACT_PROOF_OVERLAY_DURATION_S,
      Math.ceil(computed * 10) / 10,
    ).toFixed(1),
  );
}

function overlayWindow({
  id,
  kind,
  startS,
  durationS,
  text = "",
  source = "studio_v4_overlay_chain",
  presentationMode = "",
}) {
  const start = Number(startS.toFixed(2));
  const duration = Number(durationS.toFixed(2));
  return {
    id,
    kind,
    text,
    start_s: start,
    end_s: Number((start + duration).toFixed(2)),
    duration_s: duration,
    source,
    ...(presentationMode ? { presentation_mode: presentationMode } : {}),
  };
}

function overlayCardWindowsForStory(story = {}, { durationS = null } = {}) {
  const suppressAllStoryCards = usesOwnedGeneratedMotionDeck(story);
  const suppressOpeningStoryCard =
    suppressAllStoryCards ||
    story.suppress_opening_story_cards === true ||
    String(story.visual_repair_lane || "").trim() === "visual_first_frame_rerender";
  const layout = buildOverlayLayout({ story });
  const blockById = Object.fromEntries(layout.text_blocks.map((block) => [block.id, block]));
  const openingText = firstText(blockById.hook_card?.text, story.first_frame_text, story.title);
  const headlineText = firstText(blockById.headline_card?.text, story.thumbnail_headline, story.title);
  const proofPrimaryText = firstText(blockById.proof_primary?.text, story.proof_card_primary, story.player_impact);
  const proofSecondaryText = firstText(blockById.proof_secondary?.text, story.proof_card_secondary, story.player_impact);
  const normaliseCardCopy = (value) => String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const headlineRepeatsOpening =
    normaliseCardCopy(headlineText) === normaliseCardCopy(openingText);
  const windows = [];
  let openingWindow = null;
  if (!suppressOpeningStoryCard) {
    openingWindow = overlayWindow({
      id: "opening_source_lock",
      kind: "source_lock",
      text: openingText,
      startS: 0,
      durationS: readableOverlayCardDurationS(openingText, {
        minS: SOURCE_LOCK_OVERLAY_CARD_DURATION_S,
        maxS: SOURCE_LOCK_OVERLAY_CARD_DURATION_S,
      }),
    });
    windows.push(openingWindow);
  }
  if (!suppressAllStoryCards) {
    let headlineWindow = null;
    if (!(openingWindow && headlineRepeatsOpening)) {
      const headlineStartS = Math.max(4, (openingWindow?.end_s || 0) + 0.2);
      headlineWindow = overlayWindow({
        id: "headline_card",
        kind: "proof_card",
        text: headlineText,
        startS: headlineStartS,
        durationS: readableOverlayCardDurationS(headlineText, {
          minS: HEADLINE_OVERLAY_CARD_DURATION_S,
        }),
        presentationMode: "compact_headline_overlay",
      });
    }
    const proofPrimaryWindow = overlayWindow({
      id: "proof_primary",
      kind: "proof_card",
      text: proofPrimaryText,
      startS: headlineWindow
        ? Math.max(9, headlineWindow.end_s + 0.8)
        : Math.max(4, (openingWindow?.end_s || 0) + 0.8),
      durationS: readableCompactProofOverlayDurationS(proofPrimaryText),
      presentationMode: "compact_proof_overlay",
    });
    const proofSecondaryWindow = overlayWindow({
      id: "proof_secondary",
      kind: "proof_card",
      text: proofSecondaryText,
      startS: Math.max(headlineWindow ? 16 : 10, proofPrimaryWindow.end_s + 0.8),
      durationS: readableCompactProofOverlayDurationS(proofSecondaryText),
      presentationMode: "compact_proof_overlay",
    });
    windows.push(
      ...(headlineWindow ? [headlineWindow] : []),
      proofPrimaryWindow,
      proofSecondaryWindow,
    );
  }
  const finalDuration = Number(durationS);
  if (!Number.isFinite(finalDuration) || finalDuration <= 0) return windows;
  return windows.filter((window) => Number(window.end_s || 0) <= finalDuration + 0.05);
}

function buildOverlayChain({
  story,
  inputLabel,
  outputLabel,
  durationS,
  fontOpt,
  metaFontOpt = fontOpt,
  cardVisibleWindows = [],
}) {
  const layout = buildOverlayLayout({ story });
  const signature = buildPulseSignatureContract({ story, durationS });
  const contentIdentity = resolveContentIdentity(story);
  const livingMotion = resolveLivingMotionGrammar(story);
  const identityAccent = `0x${String(contentIdentity.brand.accent || "#FF6B1A").replace(/^#/, "")}`;
  const blockById = Object.fromEntries(layout.text_blocks.map((block) => [block.id, block]));
  const suppressAllStoryCards = usesOwnedGeneratedMotionDeck(story);
  const suppressOpeningStoryCard =
    suppressAllStoryCards ||
    story.suppress_opening_story_cards === true ||
    String(story.visual_repair_lane || "").trim() === "visual_first_frame_rerender";
  const safeMarginMode = story.render_safe_text_margins === true;
  const sideMaskWidth = safeMarginMode ? 72 : 44;
  const sideMaskAlpha = safeMarginMode ? "0.80" : "0.72";
  const accentRailX = safeMarginMode ? 72 : 44;
  const openingCardX = safeMarginMode ? 82 : 70;
  const openingCardW = safeMarginMode ? 916 : 940;
  const openingCardY = 252;
  const openingCardH = 214;
  const openingChipX = signature.opening.layout.chip_x_px + (safeMarginMode ? 12 : 0);
  const openingChipW = signature.opening.layout.chip_width_px;
  const cardWindows = overlayCardWindowsForStory(story, { durationS });
  const windowById = Object.fromEntries(cardWindows.map((window) => [window.id, window]));
  const disabledWindow = {
    start_s: Number.isFinite(Number(durationS)) ? Number(durationS) + 1 : 9999,
    end_s: Number.isFinite(Number(durationS)) ? Number(durationS) + 1 : 9999,
  };
  const openingWindow = windowById.opening_source_lock || disabledWindow;
  const headlineWindow = windowById.headline_card || disabledWindow;
  const proofPrimaryWindow = windowById.proof_primary || disabledWindow;
  const proofSecondaryWindow = windowById.proof_secondary || disabledWindow;
  const t = (value) => {
    const number = Number(value || 0);
    if (Math.abs(number) < 0.005) return "0";
    if (Math.abs(number - Math.round(number)) < 0.005) return number.toFixed(1);
    if (Math.abs(number * 10 - Math.round(number * 10)) < 0.005) return number.toFixed(1);
    return number.toFixed(2);
  };
  const cardExclusions = cardVisibleWindows
    .filter((window) => Number.isFinite(Number(window?.start_s)) && Number.isFinite(Number(window?.end_s)))
    .map((window) => `not(between(t,${t(window.start_s)},${t(window.end_s)}))`);
  const enableFor = (window, { avoidCardWindows = false } = {}) => {
    const base = `between(t,${t(window.start_s)},${t(window.end_s)})`;
    return avoidCardWindows && cardExclusions.length
      ? `${base}*${cardExclusions.join("*")}`
      : base;
  };
  const openingEnable = enableFor(openingWindow);
  const headlineEnable = enableFor(headlineWindow, { avoidCardWindows: true });
  const proofPrimaryEnable = enableFor(proofPrimaryWindow, { avoidCardWindows: true });
  const proofSecondaryEnable = enableFor(proofSecondaryWindow, { avoidCardWindows: true });
  const outroEnable = enableFor(signature.outro);
  const progressStart = (window, offsetS) => t(Number(window.start_s || 0) + offsetS);
  const segmentLabel = drawtextEscape(signature.segment.display_label);
  const identityLabel = drawtextEscape(contentIdentity.brand.on_screen_label);
  const livingGhostWord = drawtextEscape(livingMotion.ghost_word);
  return [
    `[${inputLabel}]eq=brightness='if(lt(t\\,3.3)\\,0.055\\,-0.015)':contrast=1.10:saturation=1.20:eval=frame,drawbox=x=0:y=0:w=iw:h=230:color=black@0.34:t=fill,drawbox=x=0:y=138:w=iw:h=164:color=black@0.56:t=fill,drawbox=x=0:y=ih-430:w=iw:h=430:color=black@0.52:t=fill,drawbox=x=0:y=ih-315:w=iw:h=315:color=black@0.66:t=fill`,
    `drawbox=x=0:y=0:w=${sideMaskWidth}:h=ih:color=0x0B0F19@${sideMaskAlpha}:t=fill`,
    `drawbox=x=iw-${sideMaskWidth}:y=0:w=${sideMaskWidth}:h=ih:color=0x0B0F19@${sideMaskAlpha}:t=fill`,
    `drawbox=x=${accentRailX}:y=0:w=4:h=ih:color=${identityAccent}@0.30:t=fill`,
    `drawbox=x=${accentRailX}:y='mod(t*480\\,2080)-160':w=4:h=160:color=${identityAccent}@0.95:t=fill`,
    `drawbox=x=${accentRailX + 5}:y=0:w=2:h=ih:color=0xFF6B1A@0.95:t=fill`,
    `drawbox=x=${accentRailX + 7}:y='mod(t*480+420\\,2000)-80':w=2:h=80:color=0x38BDF8@0.78:t=fill`,
    `drawbox=x='-260+mod(t*${livingMotion.sweeps.primary_speed_px_s}\\,1540)':y=0:w=210:h=ih:color=white@${livingMotion.sweeps.primary_opacity.toFixed(3)}:t=fill`,
    `drawbox=x='940-mod(t*${livingMotion.sweeps.accent_speed_px_s}\\,1220)':y=0:w=92:h=ih:color=${identityAccent}@${livingMotion.sweeps.accent_opacity.toFixed(3)}:t=fill`,
    `drawbox=x=54:y='560+sin(t*0.21)*34':w=972:h=1:color=${identityAccent}@0.24:t=fill`,
    `drawtext=text='${livingGhostWord}':${fontOpt}:fontcolor=${identityAccent}@${livingMotion.editorial.ghost_opacity.toFixed(3)}:fontsize=${livingMotion.editorial.ghost_font_size_px}:x='-24+sin(t*${livingMotion.editorial.ghost_rate})*${livingMotion.editorial.ghost_drift_x_px}':y=${livingMotion.editorial.ghost_y_px}:shadowcolor=black@0.16:shadowx=3:shadowy=3`,
    ...(suppressOpeningStoryCard ? [] : [
    `drawbox=x=${openingCardX}:y=${openingCardY}:w=${openingCardW}:h=${openingCardH}:color=0x111827@0.58:t=fill:enable='${openingEnable}'`,
    `drawbox=x=${openingCardX}:y=${openingCardY}:w=${openingCardW}:h=${openingCardH}:color=0x0B0F19@0.18:t=fill:enable='${openingEnable}'`,
    `drawbox=x=${openingCardX}:y=${openingCardY}:w=${openingCardW}:h=${openingCardH}:color=0xF8FAFC@0.16:t=2:enable='${openingEnable}'`,
    `drawbox=x=${openingCardX}:y=${openingCardY}:w=118:h=3:color=0xF8FAFC@0.88:t=fill:enable='${openingEnable}'`,
    `drawbox=x=${openingCardX}:y=${openingCardY}:w='if(lt(t\\,${progressStart(openingWindow, 0.18)})\\,1\\,1+(${openingCardW}-1)*(t-${progressStart(openingWindow, 0.18)})/0.30)':h=5:color=0x38BDF8@0.92:t=fill:enable='${openingEnable}'`,
    `drawbox=x=${openingCardX}:y=${openingCardY + openingCardH - 6}:w=600:h=5:color=${identityAccent}@0.68:t=fill:enable='${openingEnable}'`,
    `drawbox=x=${openingChipX}:y=264:w=${openingChipW}:h=36:color=0x38BDF8@0.16:t=fill:enable='${openingEnable}'`,
    `drawbox=x=${openingChipX}:y=264:w=${openingChipW}:h=36:color=0x38BDF8@0.56:t=2:enable='${openingEnable}'`,
    `drawtext=text='${segmentLabel}':${metaFontOpt}:fontcolor=0xBEEBFF:fontsize=18:x=${openingChipX + 16}:y=268:shadowcolor=black@0.72:shadowx=2:shadowy=2:enable='${openingEnable}'`,
    `drawtext=text='${identityLabel}':${metaFontOpt}:fontcolor=${identityAccent}:fontsize=18:x=w-tw-${safeMarginMode ? 98 : 86}:y=268:shadowcolor=black@0.72:shadowx=2:shadowy=2:enable='${openingEnable}'`,
    ...drawtextLinesForBlock(blockById.top_source_lock, { fontOpt: metaFontOpt, fontcolor: "0xFFB15C", enable: openingEnable, shadow: false }),
    `drawbox=x='${openingCardX + 24}+mod(t*380\\,760)':y=${openingCardY + 12}:w=92:h=${openingCardH - 24}:color=white@0.046:t=fill:enable='${openingEnable}'`,
    ...drawtextLinesForBlock(blockById.hook_card, { fontOpt, fontcolor: "white", enable: openingEnable }),
    ]),
    ...(suppressAllStoryCards ? [] : [
    `drawbox=x=64:y=520:w=956:h=222:color=0x0B0F19@0.48:t=fill:enable='${headlineEnable}'`,
    `drawbox=x=64:y=520:w=956:h=222:color=0xF8FAFC@0.16:t=2:enable='${headlineEnable}'`,
    `drawbox=x=64:y=520:w=956:h=4:color=white@0.22:t=fill:enable='${headlineEnable}'`,
    `drawbox=x=64:y=736:w='if(lt(t\\,${progressStart(headlineWindow, 0.22)})\\,1\\,1+(956-1)*(t-${progressStart(headlineWindow, 0.22)})/0.34)':h=6:color=0x38BDF8@0.92:t=fill:enable='${headlineEnable}'`,
    ...drawtextLinesForBlock(blockById.headline_card, { fontOpt, fontcolor: "white", enable: headlineEnable }),
    ...drawtextLinesForBlock(blockById.headline_source, { fontOpt, fontcolor: "0xFFB15C", enable: headlineEnable, shadow: false }),
    `drawbox=x=76:y=812:w=690:h=140:color=0x0B0F19@0.46:t=fill:enable='${proofPrimaryEnable}'`,
    `drawbox=x=76:y=812:w=690:h=140:color=0xF8FAFC@0.14:t=2:enable='${proofPrimaryEnable}'`,
    `drawbox=x=76:y=812:w='if(lt(t\\,${progressStart(proofPrimaryWindow, 0.18)})\\,1\\,1+(690-1)*(t-${progressStart(proofPrimaryWindow, 0.18)})/0.28)':h=5:color=0x38BDF8@0.92:t=fill:enable='${proofPrimaryEnable}'`,
    `drawtext=text='PULSE PROOF':${metaFontOpt}:fontcolor=0x38BDF8:fontsize=18:x=98:y=824:enable='${proofPrimaryEnable}'`,
    ...drawtextLinesForBlock(blockById.proof_primary, { fontOpt, fontcolor: "white", enable: proofPrimaryEnable }),
    `drawbox=x=96:y=1010:w=690:h=140:color=0x0B0F19@0.46:t=fill:enable='${proofSecondaryEnable}'`,
    `drawbox=x=96:y=1010:w=690:h=140:color=0xF8FAFC@0.14:t=2:enable='${proofSecondaryEnable}'`,
    `drawbox=x=96:y=1144:w='if(lt(t\\,${progressStart(proofSecondaryWindow, 0.18)})\\,1\\,1+(690-1)*(t-${progressStart(proofSecondaryWindow, 0.18)})/0.32)':h=5:color=0x38BDF8@0.92:t=fill:enable='${proofSecondaryEnable}'`,
    `drawtext=text='PLAYER IMPACT':${metaFontOpt}:fontcolor=0x38BDF8:fontsize=18:x=118:y=1022:enable='${proofSecondaryEnable}'`,
    ...drawtextLinesForBlock(blockById.proof_secondary, { fontOpt, fontcolor: "white", enable: proofSecondaryEnable }),
    ]),
    `drawbox=x=w-286:y=h-126:w=244:h=60:color=0x0D0D0F@0.58:t=fill`,
    `drawbox=x=w-286:y=h-126:w=6:h=60:color=${identityAccent}@0.95:t=fill`,
    `drawbox=x=w-280:y=h-126:w=238:h=2:color=0x38BDF8@0.78:t=fill`,
    `drawtext=text='PULSE // GAMING':${metaFontOpt}:fontcolor=white@0.92:fontsize=25:x=w-tw-58:y=h-108:shadowcolor=black@0.70:shadowx=2:shadowy=2`,
    `drawbox=x=70:y=310:w=940:h=178:color=0x0D0D0F@0.74:t=fill:enable='${outroEnable}'`,
    `drawbox=x=70:y=310:w=940:h=5:color=${identityAccent}@0.95:t=fill:enable='${outroEnable}'`,
    `drawbox=x=70:y=483:w=940:h=3:color=0x38BDF8@0.78:t=fill:enable='${outroEnable}'`,
    `drawtext=text='PULSE GAMING':${fontOpt}:fontcolor=white:fontsize=62:x=110:y=332:shadowcolor=black@0.82:shadowx=3:shadowy=3:enable='${outroEnable}'`,
    `drawtext=text='NEVER MISS A BEAT':${metaFontOpt}:fontcolor=0xFFB15C:fontsize=30:x=114:y=420:enable='${outroEnable}'`,
    `noise=alls=${OVERLAY_ANTI_FREEZE_NOISE_STRENGTH}:allf=t+u`,
    `trim=duration=${Number(durationS).toFixed(3)},setpts=PTS-STARTPTS[${outputLabel}]`,
  ].join(",");
}

function buildSceneCompositeFilterParts(scene = {}, livingMotion = null) {
  const index = Number(scene.index);
  const i = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
  const duration = Number(scene.durationS);
  const durationS = Number.isFinite(duration) && duration > 0 ? duration.toFixed(2) : "1.00";
  const motion = livingMotion || resolveLivingMotionGrammar({});
  const depth = motion.depth;

  return [
    `[${i}:v]split=2[bgsrc${i}][fgsrc${i}]`,
    `[bgsrc${i}]scale=1260:2240:force_original_aspect_ratio=increase:in_range=pc:out_range=tv,crop=w=1080:h=1920:x='(iw-1080)*(0.50+${depth.background_drift_ratio.toFixed(2)}*sin(t*${depth.background_rate_x.toFixed(2)}+${i}))':y='(ih-1920)*(0.50+${depth.background_drift_ratio.toFixed(2)}*cos(t*${depth.background_rate_y.toFixed(2)}+${i}))',boxblur=32:1,eq=brightness=-0.015:saturation=1.26:contrast=1.12,fps=${FPS},format=yuv420p,setsar=1[bg${i}]`,
    `[fgsrc${i}]scale=1000:1760:force_original_aspect_ratio=decrease:in_range=pc:out_range=tv,eq=brightness=0.055:saturation=1.12:contrast=1.10,unsharp=5:5:0.38:3:3:0.12,fps=${FPS},format=yuv420p,setsar=1[fg${i}]`,
    `[bg${i}][fg${i}]overlay=x='(W-w)/2+sin(t*${depth.foreground_rate_x.toFixed(2)}+${i})*${depth.foreground_drift_x_px}':y='(H-h)/2+cos(t*${depth.foreground_rate_y.toFixed(2)}+${i})*${depth.foreground_drift_y_px}':eval=frame,noise=alls=4:allf=t+u,trim=duration=${durationS},setpts=PTS-STARTPTS,fps=${FPS},format=yuv420p,setsar=1[v${i}]`,
  ];
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
    ? story.visual_v4_bridge_video_clips
    : [];
  const clipCandidates = bridgeClips.length ? bridgeClips : story.video_clips || [];
  const clips = [];
  for (const clip of clipCandidates) {
    const rawPath = sceneClipPath(clip);
    const resolved = await resolveReadableMediaPath(rawPath);
    if (resolved && fs.existsSync(resolved)) {
      if (clip && typeof clip === "object") clips.push({ ...clip, path: resolved, original_path: rawPath });
      else clips.push(resolved);
    }
  }
  if (!clips.length) throw new Error("no local V4 clips available");

  const durationS = ffprobeDuration(audioPath);
  if (!Number.isFinite(durationS) || durationS <= 0) {
    throw new Error(`invalid audio duration: ${audioPath}`);
  }
  const scenePlan = buildClipScenePlan({
    clips,
    durationS,
    maxSceneDurationS: directClipMaxVisibleDwellS(),
    maxScenes: directClipMaxScenes(),
  });
  if (Array.isArray(scenePlan.blockers) && scenePlan.blockers.length) {
    throw new Error(
      `direct_motion_scene_plan_blocked:${scenePlan.blockers.join(",")}:` +
        `available=${scenePlan.availableUniqueClipCount}:required=${scenePlan.requiredUniqueClipCount}`,
    );
  }
  const assPath = path.join(TEST_OUT, `${story.id || "story"}_studio_v4_proof.ass`);
  const timestampData = await fs.readJson(timestampsPath);
  const timestampValidation = validateProofTimestampPayload(timestampData, {
    wordTimestampSource: story.word_timestamp_source,
  });
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
      ? "fontfile='C\\:/Windows/Fonts/bahnschrift.ttf'"
      : "font='DejaVu Sans'";
  const metaFontOpt =
    process.platform === "win32"
      ? "fontfile='C\\:/Windows/Fonts/consola.ttf'"
      : "font='DejaVu Sans Mono'";
  const filterParts = [];
  const livingMotion = resolveLivingMotionGrammar(story);
  for (const scene of scenePlan.scenes) {
    filterParts.push(...buildSceneCompositeFilterParts(scene, livingMotion));
  }
  let prev = "v0";
  for (let i = 1; i < scenePlan.scenes.length; i++) {
    const out = i === scenePlan.scenes.length - 1 ? "base" : `xf${i}`;
    const offset = (Array.isArray(scenePlan.transitionOffsets) ? scenePlan.transitionOffsets : [])[i - 1] ??
      i * (scenePlan.segmentDurationS - scenePlan.xfadeS);
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
    metaFontOpt,
    cardVisibleWindows: scenePlan.cardVisibleWindows,
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
  filterParts.push(buildFinalSocialAudioMixFilter(mixLabels));

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
    "-ar",
    String(SOCIAL_AUDIO_SAMPLE_RATE),
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
    clip_scene_plan: {
      repeat_free: scenePlan.repeatFree,
      covered_duration_s: scenePlan.coveredDurationS,
      transition_offsets: scenePlan.transitionOffsets,
      repeated_base_sources: scenePlan.repeatedBaseSources,
      skipped_duplicate_base_sources: scenePlan.skippedDuplicateBaseSources,
      source_duration_overruns: scenePlan.sourceDurationOverruns,
      scenes: scenePlan.scenes,
    },
    audio_duration_s: Number(durationS.toFixed(3)),
    rendered_duration_s: Number(finalDuration.toFixed(3)),
    size_bytes: stat.size,
    sfx_mix_policy_version: STUDIO_V4_SFX_MIX_POLICY_VERSION,
    voice_mix_policy_version: STUDIO_V4_VOICE_MIX_POLICY_VERSION,
    visual_design_policy_version: STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
    pulse_signature_version: PULSE_SIGNATURE_VERSION,
    pulse_signature_contract: buildPulseSignatureContract({
      story,
      durationS: finalDuration || durationS,
    }),
    living_motion_grammar: resolveLivingMotionGrammar(story),
    hyperframes_premium_shell_required: story.hyperframes_premium_shell_required === true,
    hyperframes_card_count: Number.isFinite(Number(story.hyperframes_card_count))
      ? Number(story.hyperframes_card_count)
      : null,
    hyperframes_premium_shell_gate: story.hyperframes_premium_shell_gate || {},
    overlay_card_windows: overlayCardWindowsForStory(story, { durationS: finalDuration || durationS }),
    card_visible_windows: scenePlan.cardVisibleWindows,
    premium_shell_verdict: story.premium_shell_verdict || null,
    premium_shell_pass_count: Number.isFinite(Number(story.premium_shell_pass_count))
      ? Number(story.premium_shell_pass_count)
      : null,
    premium_shell_required_pass_count: Number.isFinite(Number(story.premium_shell_required_pass_count))
      ? Number(story.premium_shell_required_pass_count)
      : null,
    premium_shell_blockers: Array.isArray(story.premium_shell_blockers)
      ? story.premium_shell_blockers
      : [],
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
      content_identity: musicCueMix.content_identity || null,
      bed: musicCueMix.bed
        ? {
            role: musicCueMix.bed.role,
            asset_id: musicCueMix.bed.asset_id,
            path: relativeReportPath(musicCueMix.bed.path),
            variant_index: musicCueMix.bed.variant_index,
            variant_count: musicCueMix.bed.variant_count,
            selection_strategy: musicCueMix.bed.selection_strategy,
            identity_id: musicCueMix.bed.identity_id || null,
            identity_variant_index: musicCueMix.bed.identity_variant_index ?? null,
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
            identity_id: musicCueMix.sting.identity_id || null,
            identity_variant_index: musicCueMix.sting.identity_variant_index ?? null,
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
  buildSceneCompositeFilterParts,
  buildOverlayChain,
  overlayCardWindowsForStory,
  buildFinalSocialAudioMixFilter,
  drawtextEscape,
  renderNarrationScriptText,
  resolveReadableMediaPath,
  resolveStoryMusicCueMix,
  resolveStorySfxCueMix,
  resolveStorySfxPaths,
  directClipMaxScenes,
  directClipMaxVisibleDwellS,
  sfxPathForAsset,
  subtitleWordsFromTimestampPayload,
  validateProofTimestampPayload,
  assertProofAudioSegmentLoudness,
  renderProof,
};
