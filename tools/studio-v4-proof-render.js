#!/usr/bin/env node
"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const nativeFs = require("node:fs/promises");
const fs = require("fs-extra");
const { execFile, execFileSync } = require("node:child_process");
const { promisify } = require("node:util");
const { fileURLToPath } = require("node:url");

const execFileAsync = promisify(execFile);

const { ffprobeDuration } = require("../lib/studio/media-acquisition");
const { wordsFromAlignment } = require("../lib/studio/sound-layer");
const mediaPaths = require("../lib/media-paths");
const {
  prepareSubtitleWords,
} = require("../lib/studio/v2/subtitle-layer-v2");
const {
  KINETIC_TYPOGRAPHY_V5,
  buildPremiumKineticAss,
  inspectPremiumCaptionCadence,
} = require("../lib/studio/v5/kinetic-typography");
const {
  editorialSfxScore,
  minimumScoreForRole,
} = require("../lib/studio/v4/sfx-source-registry");
const {
  CINEMATIC_AUDIO_ARC_VERSION,
  bedDropoutFilterChain,
  buildCinematicAudioArc,
  buildCinematicBedFilters,
  cinematicCueTiming,
} = require("../lib/studio/v4/cinematic-audio-arc");
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
  V5_READABLE_CARD_TIMING,
  V5_SOURCE_CARD_TIMING,
} = require("../lib/studio/v4/premium-card-timing-policy");
const {
  resolveLivingMotionGrammar,
} = require("../lib/studio/v4/living-motion-grammar");
const {
  CREATIVE_SYSTEM_VERSION,
  resolvePulseTransitionCycle,
  resolvePulseVisualIdentity,
} = require("../lib/studio/v5/pulse-visual-identity");
const {
  PREMIUM_EDIT_RHYTHM_V5,
  inspectPremiumEditRhythm,
} = require("../lib/studio/v5/premium-edit-rhythm");
const {
  DIRECT_MOTION_VISUAL_SELECTOR_V5,
  filterPremiumDirectMotionClips,
} = require("../lib/studio/v5/direct-motion-visual-selector");
const {
  PROFESSIONAL_MOTION_SOURCE_POLICY,
  assessProfessionalSourceDiversity,
  reconcileMotionSourceIdentities,
  resolveMotionSourceIdentity,
} = require("../lib/studio/motion-source-identity");
const {
  runDecodedVisualGate,
} = require("../lib/studio/v2/forensic-qa-v2");
const {
  _private: {
    materializedSourceIdentityFields,
  },
} = require("../lib/goal-real-motion-materializer");
const {
  evaluateHyperframesPremiumShellEvidence,
  resolveCardAssetsV2,
} = require("../lib/studio/v2/premium-card-lane-v2");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");
const FPS = 30;
const XFADE_S = 0.25;
const DEFAULT_DIRECT_CLIP_MAX_VISIBLE_DWELL_S = 7;
const DEFAULT_DIRECT_CLIP_MAX_SCENES = 40;
const SCENE_DURATION_FRAME_TOLERANCE_S = 1 / FPS;
const SOURCE_LOCK_OVERLAY_CARD_DURATION_S = V5_SOURCE_CARD_TIMING.planned_visible_duration_s;
const MIN_OVERLAY_CARD_DURATION_S = 4.2;
const HEADLINE_OVERLAY_CARD_DURATION_S = 4.6;
const MAX_OVERLAY_CARD_DURATION_S = 5.8;
const MIN_COMPACT_PROOF_OVERLAY_DURATION_S = 2.6;
const MAX_COMPACT_PROOF_OVERLAY_DURATION_S = 4.2;
const MIN_GENERATED_CARD_SCENE_DURATION_S = V5_READABLE_CARD_TIMING.minimum_visible_duration_s;
const MIN_DIRECT_MOTION_SCENES_WITH_READABLE_CARDS = 4;
const MAX_READABLE_CARD_DURATION_RATIO = 0.42;
const MAX_V5_PREMIUM_CARD_DURATION_RATIO = PREMIUM_EDIT_RHYTHM_V5.max_generated_card_duration_ratio;
const MAX_DIRECT_MOTION_SOURCE_CONCENTRATION_RATIO = 0.25;
const MAX_DIRECT_MOTION_SCENES_PER_SOURCE_ROOT = 2;
const OVERLAY_ANTI_FREEZE_NOISE_STRENGTH = 10;
const FRAME_WIDTH_PX = 1080;
const FRAME_HEIGHT_PX = 1920;
const SAFE_RIGHT_PX = 42;
const SAFE_BOTTOM_PX = 92;
const INSTAGRAM_TOP_CHROME_SAFE_PX = 240;
const SOCIAL_AUDIO_SAMPLE_RATE = 48000;
const CARD_CAPTION_SAFE_ZONE_VERSION = "hyperframes_card_caption_safe_zone_v1";
const CARD_CAPTION_START_Y_PX = 1574;
const CARD_CAPTION_END_Y_PX = 1548;
const CARD_CAPTION_PLATE_Y_PX = 1410;

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

function ffmpegHex(value = "#ff6b1a") {
  const match = String(value || "").trim().match(/^#?([0-9a-f]{6})$/i);
  return `0x${(match?.[1] || "ff6b1a").toUpperCase()}`;
}

function buildCreativeTransitionSequence(story = {}, count = 0) {
  const cycle = resolvePulseTransitionCycle(story);
  const total = Math.max(0, Math.floor(Number(count) || 0));
  const sequence = [];
  for (let index = 0; index < total; index += 1) {
    let transition = cycle[index % cycle.length] || "fade";
    if (sequence.length && transition === sequence[sequence.length - 1]) {
      transition = cycle[(index + 1) % cycle.length] || "fade";
    }
    sequence.push(transition);
  }
  return sequence;
}

function parseArgs(argv = process.argv) {
  const args = {
    storyJson: null,
    output: null,
    proofOutputDir: null,
    json: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--story-json") args.storyJson = argv[++i] || null;
    else if (arg === "--output") args.output = argv[++i] || null;
    else if (arg === "--proof-output-dir") args.proofOutputDir = argv[++i] || null;
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
      "       [--proof-output-dir <directory>]",
      "",
      "Local proof render only. Reads a V4 render-ready story JSON, local audio and local materialized motion clips.",
      "It does not publish, touch OAuth tokens or mutate production database rows.",
    ].join("\n") + "\n",
  );
}

function resolveProofOutputDir(proofOutputDir) {
  const requested = String(proofOutputDir || "").trim();
  return requested ? resolvePathMaybeRoot(requested) : TEST_OUT;
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

function assTimestampSeconds(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function repositionAssCaptionsForCardWindows(ass = "", cardVisibleWindows = []) {
  const windows = (Array.isArray(cardVisibleWindows) ? cardVisibleWindows : [])
    .map((window) => ({
      kind: String(window?.kind || "card").trim() || "card",
      start_s: Number(window?.start_s),
      end_s: Number(window?.end_s),
    }))
    .filter(
      (window) =>
        Number.isFinite(window.start_s) &&
        Number.isFinite(window.end_s) &&
        window.end_s > window.start_s,
    );
  const cardKinds = new Set();
  const blockers = [];
  let overlappingCaptionCount = 0;
  let repositionedCaptionCount = 0;
  const lines = String(ass || "").split(/\r?\n/);
  const output = lines.map((line, index) => {
    if (!line.startsWith("Dialogue:")) return line;
    const timing = line.match(/^Dialogue:\s*\d+,([^,]+),([^,]+),/);
    const startS = assTimestampSeconds(timing?.[1]);
    const endS = assTimestampSeconds(timing?.[2]);
    if (!Number.isFinite(startS) || !Number.isFinite(endS)) return line;
    const overlaps = windows.filter(
      (window) => endS > window.start_s && startS < window.end_s,
    );
    if (!overlaps.length) return line;
    overlappingCaptionCount += 1;
    for (const window of overlaps) cardKinds.add(window.kind);
    const repositioned = line.replace(
      /\\move\(([^,]+),[^,]+,([^,]+),[^,]+,0,([^)]+)\)/,
      `\\move($1,${CARD_CAPTION_START_Y_PX},$2,${CARD_CAPTION_END_Y_PX},0,$3)`,
    );
    if (repositioned === line) {
      blockers.push(`caption_card_safe_move_missing:${index + 1}`);
      return line;
    }
    repositionedCaptionCount += 1;
    return repositioned;
  });

  return {
    version: CARD_CAPTION_SAFE_ZONE_VERSION,
    verdict: blockers.length ? "fail" : "pass",
    blockers,
    card_kinds: [...cardKinds].sort(),
    card_window_count: windows.length,
    overlapping_caption_count: overlappingCaptionCount,
    repositioned_caption_count: repositionedCaptionCount,
    normal_caption_end_y_px: 1346,
    card_caption_start_y_px: CARD_CAPTION_START_Y_PX,
    card_caption_end_y_px: CARD_CAPTION_END_Y_PX,
    card_caption_plate_y_px: CARD_CAPTION_PLATE_Y_PX,
    ass: output.join("\n"),
  };
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

function selectedInputPathKey(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return path.resolve(text).replace(/\\/g, "/").toLowerCase();
}

function selectedInputAssetId(value, fallback) {
  const text = String(value || fallback || "").trim();
  return text.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 160);
}

function fingerprintLocalFileSync(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error("selected input evidence is not a non-empty file");
  }
  return {
    sha256: crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"),
    size_bytes: stat.size,
  };
}

function selectedHyperframesOwnershipEvidence({
  story = {},
  asset = {},
  assetPath = "",
} = {}) {
  if (String(asset.kind || "").trim() !== "generated_card") return null;
  const cardKind = String(asset.card_kind || "").trim().toLowerCase();
  const identityText = [
    assetPath,
    asset.source_url,
    asset.source_type,
    asset.source_family,
    asset.media_kind,
    cardKind,
  ].filter(Boolean).join(" ").toLowerCase();
  if (!cardKind || !/(?:hyperframes|hf[_-])/.test(identityText)) return null;
  const storyId = String(story.id || story.story_id || "").trim();
  const channelId = String(story.channel_id || story.channel || "pulse-gaming").trim();
  const evaluation = evaluateHyperframesPremiumShellEvidence({
    cardPath: assetPath,
    kind: cardKind,
    storyId,
    channelId,
  });
  if (
    String(evaluation?.verdict || "").toLowerCase() !== "pass" ||
    (Array.isArray(evaluation?.blockers) && evaluation.blockers.length)
  ) {
    return null;
  }
  const sidecarPath = String(evaluation?.evidence?.sidecarPath || "").trim();
  if (!sidecarPath || !fs.existsSync(sidecarPath)) return null;
  let sidecar;
  try {
    sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
  } catch {
    return null;
  }
  const outputReference = String(
    sidecar?.hyperframes_premium_shell?.output_path ||
      sidecar?.output_path ||
      "",
  ).trim();
  const outputCandidates = outputReference
    ? [
        path.isAbsolute(outputReference) ? outputReference : path.resolve(ROOT, outputReference),
        path.isAbsolute(outputReference)
          ? outputReference
          : path.resolve(path.dirname(sidecarPath), outputReference),
      ]
    : [];
  if (
    !outputCandidates.some(
      (candidate) => selectedInputPathKey(candidate) === selectedInputPathKey(assetPath),
    )
  ) {
    return null;
  }
  const evidenceFingerprint = fingerprintLocalFileSync(sidecarPath);
  return {
    rights_grant: true,
    rights_basis: "owned_generated_editorial_motion_graphic",
    licence_basis: "owned_generated_editorial_motion_graphic",
    allowed_use: "owned_editorial_motion_graphic",
    source_type: "internally_generated_motion_graphic",
    source_family: `hyperframes_${cardKind}_card`,
    source_owner: "Pulse Gaming",
    creator: "Pulse Gaming",
    provider_id: "pulse_hyperframes",
    commercial_use_allowed: true,
    approval_status: "approved_for_owned_editorial_use",
    rights_status: "approved",
    usage_scope: "owned_editorial_commercial_distribution",
    allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    credit_required: false,
    risk_score: 0.02,
    evidence_kind: "owned_generated_hyperframes_shell_sidecar",
    evidence_file: sidecarPath,
    evidence_sha256: evidenceFingerprint.sha256,
    evidence_size_bytes: evidenceFingerprint.size_bytes,
  };
}

function buildSelectedInputAssetEvidence({
  story = {},
  audioPath = "",
  selectedClips = [],
  scenePlan = {},
  musicCueMix = {},
  sfxCueMix = [],
  soundscapeMix = {},
} = {}) {
  const assets = [];
  const byPath = new Map();
  const blockers = [];
  const storyId = selectedInputAssetId(story.id || story.story_id, "story");
  const add = (asset = {}) => {
    const assetPath = String(asset.path || "").trim();
    const key = selectedInputPathKey(assetPath);
    if (!key) return;
    const existing = byPath.get(key);
    if (existing) {
      existing.scene_count = Number(existing.scene_count || 0) + Number(asset.scene_count || 0);
      existing.scene_indexes = [...new Set([
        ...(Array.isArray(existing.scene_indexes) ? existing.scene_indexes : []),
        ...(Array.isArray(asset.scene_indexes) ? asset.scene_indexes : []),
      ])].sort((left, right) => left - right);
      return;
    }
    let assetSha256 = null;
    let assetSizeBytes = null;
    try {
      const stat = fs.statSync(assetPath);
      if (!stat.isFile() || stat.size <= 0) {
        throw new Error("selected input is not a non-empty file");
      }
      assetSha256 = crypto
        .createHash("sha256")
        .update(fs.readFileSync(assetPath))
        .digest("hex");
      assetSizeBytes = stat.size;
    } catch {
      blockers.push(
        `renderer_selected_input_file_missing_or_unreadable:${selectedInputAssetId(
          asset.asset_id,
          `selected_input_${assets.length + 1}`,
        )}`,
      );
    }
    const ownedCardEvidence = selectedHyperframesOwnershipEvidence({
      story,
      asset,
      assetPath,
    });
    if (
      asset.kind === "generated_card" &&
      /(?:hyperframes|hf[_-])/.test(
        [assetPath, asset.source_url, asset.source_type, asset.source_family]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      ) &&
      !ownedCardEvidence
    ) {
      blockers.push(
        `renderer_selected_owned_card_rights_evidence_missing:${selectedInputAssetId(
          asset.asset_id,
          `selected_input_${assets.length + 1}`,
        )}`,
      );
    }
    const row = {
      asset_id: selectedInputAssetId(asset.asset_id, `selected_input_${assets.length + 1}`),
      kind: String(asset.kind || "asset").trim() || "asset",
      path: assetPath,
      asset_sha256: assetSha256,
      asset_size_bytes: assetSizeBytes,
      source_url: String(asset.source_url || "").trim() || null,
      media_start_s: Number.isFinite(Number(asset.media_start_s)) ? Number(asset.media_start_s) : null,
      duration_s: Number.isFinite(Number(asset.duration_s)) ? Number(asset.duration_s) : null,
      role: String(asset.role || "").trim() || null,
      scene_count: Number(asset.scene_count || 0),
      scene_indexes: Array.isArray(asset.scene_indexes) ? [...asset.scene_indexes] : [],
      ...(ownedCardEvidence || {}),
    };
    assets.push(row);
    byPath.set(key, row);
  };

  add({
    asset_id: `${storyId}_audio_path`,
    kind: "narration",
    path: audioPath,
    role: "final_narration",
  });

  const clipByPath = new Map(
    (Array.isArray(selectedClips) ? selectedClips : [])
      .map((clip) => [selectedInputPathKey(sceneClipPath(clip)), clip])
      .filter(([key]) => key),
  );
  for (const [index, scene] of (Array.isArray(scenePlan.scenes) ? scenePlan.scenes : []).entries()) {
    const clip = clipByPath.get(selectedInputPathKey(scene.path)) || {};
    const cardKind = String(
      scene.readableCardKind ||
        scene.readable_card_kind ||
        clip.card_kind ||
        sceneClipReadableCardKind(clip),
    ).trim().toLowerCase();
    add({
      asset_id: clip.id || clip.asset_id || scene.id || `render_scene_${index + 1}`,
      kind: clip.media_kind === "owned_editorial_motion_graphic" ? "generated_card" : "video",
      path: scene.path,
      source_url: clip.source_url || clip.canonical_source_url || null,
      source_type: clip.source_type || null,
      source_family: clip.source_family || clip.motion_family || null,
      media_kind: clip.media_kind || null,
      card_kind: cardKind || null,
      media_start_s: clip.mediaStartS ?? clip.media_start_s ?? clip.start_s,
      duration_s: clip.durationS ?? clip.duration_s ?? scene.durationS,
      role: "visual_scene",
      scene_count: 1,
      scene_indexes: [index],
    });
  }

  for (const [role, cue] of [["music_bed", musicCueMix.bed], ["music_sting", musicCueMix.sting]]) {
    if (!cue) continue;
    add({
      asset_id: cue.asset_id || role,
      kind: "music",
      path: cue.path,
      source_url: cue.source_url || null,
      role,
    });
  }
  for (const [index, cue] of (Array.isArray(sfxCueMix) ? sfxCueMix : []).entries()) {
    add({
      asset_id: cue.asset_id || `sfx_${index + 1}`,
      kind: "sfx",
      path: cue.path,
      source_url: cue.source_url || null,
      role: cue.role || cue.target_kind || "sfx",
    });
  }
  if (soundscapeMix.asset) {
    add({
      asset_id: soundscapeMix.asset.asset_id || "cinematic_soundscape",
      kind: "soundscape",
      path: soundscapeMix.asset.path,
      source_url: soundscapeMix.asset.source_url || null,
      role: soundscapeMix.asset.role || "soundscape",
    });
  }

  return {
    schema_version: 2,
    authoritative: true,
    producer_id: "pulse-gaming-studio-v4-renderer",
    asset_count: assets.length,
    assets,
    complete: blockers.length === 0 && assets.length > 0,
    blockers,
  };
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

function soundscapeAssetsFromStory(story = {}) {
  const candidates = [
    story.soundscape_asset_inventory,
    story.soundscape_assets,
    story.cinematic_soundscape_assets,
    story.cinematic_soundscape_manifest?.selected_assets,
    story.cinematic_soundscape_manifest?.source_plan?.selected_assets,
    ...Object.values(
      story.cinematic_soundscape_manifest?.variant_assets_by_role || {},
    ),
  ];
  const seen = new Set();
  const assets = [];
  for (const asset of candidates.flatMap((value) =>
    Array.isArray(value) ? value : [],
  )) {
    const key = String(
      asset?.asset_id ||
        asset?.id ||
        asset?.path ||
        asset?.audio_path ||
        asset?.file_path ||
        "",
    ).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    assets.push(asset);
  }
  return assets;
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
      asset.audio_path ||
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
        ...cinematicCueTiming({
          role: match.role,
          targetDelayMs: request.delayMs,
          durationS: Math.min(
            Number(request.durationS || profile.durationS || 0.32),
            0.42,
          ),
        }),
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

async function resolveStorySoundscapeMix(
  story = {},
  { durationS = 0 } = {},
) {
  const assets = soundscapeAssetsFromStory(story);
  const arc = buildCinematicAudioArc({
    story,
    durationS,
    soundscapeAssets: assets,
  });
  if (!arc.soundscape) {
    return {
      asset: null,
      arc,
      policy: arc.policy,
      status: "unavailable",
    };
  }
  const assetPath = sfxPathForAsset(arc.soundscape);
  if (!assetPath || !(await fs.pathExists(assetPath))) {
    return {
      asset: null,
      arc: {
        ...arc,
        soundscape: null,
        blocker: "cinematic_soundscape_file_missing",
      },
      policy: arc.policy,
      status: "blocked",
    };
  }
  return {
    asset: {
      ...arc.soundscape,
      path: assetPath,
    },
    arc,
    policy: arc.policy,
    status: "ready",
  };
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

function clipHasValidatorApprovedWindowEvidence(clip = {}, entry = {}) {
  if (!clip || typeof clip !== "object" || !clipHasWindowedSourceKey(clip, entry)) return false;
  const sidecar = readSceneClipSidecar(clip) || {};
  const provenance = clip.provenance || sidecar.provenance || {};
  const validationSource = firstText(
    provenance.source,
    clip.validation_source,
    sidecar.validation_source,
  ).toLowerCase();
  return (
    (provenance.segment_validated === true || clip.segment_validated === true) &&
    (provenance.allowed_for_flash_lane === true || clip.allowed_for_flash_lane === true) &&
    /official_trailer_segment_validation/.test(validationSource)
  );
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
    windowedEntries.push({
      repeatKey,
      exactWindowKey: entry.baseSourceKey,
      validatorApproved: clipHasValidatorApprovedWindowEvidence(clip, entry),
    });
  }
  const total = windowedEntries.length;
  if (!total) return new Map();
  const counts = new Map();
  for (const entry of windowedEntries) {
    counts.set(entry.repeatKey, (counts.get(entry.repeatKey) || 0) + 1);
  }
  const allowances = new Map();
  for (const [key, count] of counts.entries()) {
    const group = windowedEntries.filter((entry) => entry.repeatKey === key);
    const exactWindows = new Set(group.map((entry) => entry.exactWindowKey).filter(Boolean));
    if (
      group.length > 1 &&
      group.every((entry) => entry.validatorApproved) &&
      exactWindows.size === group.length
    ) {
      allowances.set(key, Math.min(count, MAX_DIRECT_MOTION_SCENES_PER_SOURCE_ROOT));
    }
  }
  const distinctRoots = counts.size;
  if (distinctRoots === 2 && total >= 6) {
    const balancedTwoRootPool = [...counts.values()].every((count) => count >= 3);
    if (balancedTwoRootPool) {
      for (const [key, count] of counts.entries()) {
        const validatorApprovedAllowance = Number(allowances.get(key) || 0);
        allowances.set(key, Math.min(count, Math.max(3, validatorApprovedAllowance)));
      }
    }
    return allowances;
  }
  if (distinctRoots < 4) return allowances;
  const balancedFourRootPool = [...counts.entries()].filter(
    ([key, count]) => count >= 3 && allowances.has(key),
  ).length >= 4;
  if (balancedFourRootPool) {
    for (const [key, count] of counts.entries()) {
      if (count >= 3 && allowances.has(key)) {
        allowances.set(key, Math.min(count, 3));
      }
    }
  }
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
  const candidates = [
    clipPath.replace(/\.mp4$/i, ".shell.json"),
    `${clipPath}.json`,
  ];
  if (clip && typeof clip === "object" && clip.original_path) {
    candidates.push(String(clip.original_path).replace(/\.mp4$/i, ".shell.json"));
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

function resolveFreshHyperframesPremiumShellGate({ selectedCards = [], fallbackGate = {} } = {}) {
  const checks = {};
  const blockers = [];
  const generatedAt = [];
  for (const card of Array.isArray(selectedCards) ? selectedCards : []) {
    const kind = firstText(card?.kind, sceneClipReadableCardKind(card)).toLowerCase();
    const cardPath = sceneClipPath(card);
    if (!kind || !cardPath) continue;
    const sidecar = readSceneClipSidecar(card);
    const shell = sidecar?.hyperframes_premium_shell;
    if (!shell || typeof shell !== "object") continue;
    const status = firstText(shell.status, shell.verdict).toLowerCase();
    const shellBlockers = Array.isArray(shell.blockers) ? shell.blockers.filter(Boolean) : [];
    if (status !== "pass") blockers.push(`${kind}:shell_${status || "unknown"}`);
    blockers.push(...shellBlockers.map((blocker) => `${kind}:${blocker}`));
    if (sidecar.generated_at) generatedAt.push(sidecar.generated_at);
    checks[kind] = {
      verdict: status || "unknown",
      blockers: shellBlockers,
      warnings: Array.isArray(shell.warnings) ? shell.warnings.filter(Boolean) : [],
      evidence: {
        kind,
        storyId: shell.story_id || sidecar.story_id || null,
        channelId: shell.channel_id || sidecar.channel_id || null,
        cardPath,
        sidecarPath: cardPath.replace(/\.mp4$/i, ".shell.json"),
        generatedAt: sidecar.generated_at || null,
        projectDir: shell.project_dir || sidecar.project_dir || null,
        outputPath: shell.output_path || sidecar.output_path || cardPath,
        checks: shell.checks || {},
        visualIdentity: shell.visual_identity || {},
        animationContract: shell.animation_contract || {},
        readabilityContract: shell.readability_contract || {},
        creativeIdentityContract: shell.creative_identity_contract || {},
      },
    };
  }
  const selectedCardCount = Object.keys(checks).length;
  if (selectedCardCount === 0) return fallbackGate || {};
  const passCount = Object.values(checks).filter((entry) => entry.verdict === "pass").length;
  return {
    verdict: blockers.length === 0 && passCount === selectedCardCount ? "pass" : "blocked",
    evidenceSource: "selected_card_sidecars",
    generatedAt: generatedAt.sort().at(-1) || null,
    requiredPassCount: selectedCardCount,
    requiredSelectedCardCount: selectedCardCount,
    passCount,
    selectedCardCount,
    blockers: [...new Set(blockers)],
    checks,
  };
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
  const youtubeVideoId = isObject
    ? firstText(
        clip.youtube_video_id,
        clip.youtubeVideoId,
        sidecar?.youtube_video_id,
        sidecar?.youtubeVideoId,
      )
    : "";
  if (youtubeVideoId) return `youtube:${youtubeVideoId.toLowerCase()}`;
  const canonicalUrl = isObject
    ? firstText(
        clip.canonical_source_url,
        clip.canonicalSourceUrl,
        clip.reference_url,
        clip.referenceUrl,
        sidecar?.canonical_source_url,
        sidecar?.canonicalSourceUrl,
        sidecar?.reference_url,
        sidecar?.referenceUrl,
      )
    : "";
  if (canonicalUrl) {
    const youtubeKey = youtubeSceneAssetKey(canonicalUrl);
    if (youtubeKey) return youtubeKey;
    const steamKey = steamTrailerSceneAssetKey(canonicalUrl);
    if (steamKey) return steamKey;
  }
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
  const mediaKind = firstText(
    typeof clip === "object" ? clip.media_kind : "",
    typeof clip === "object" ? clip.mediaKind : "",
  ).toLowerCase();
  const sourceType = firstText(
    typeof clip === "object" ? clip.source_type : "",
    typeof clip === "object" ? clip.sourceType : "",
  ).toLowerCase();
  const isOwnedExplainer =
    mediaKind === "owned_explainer_motion" ||
    sourceType === "internally_generated_motion_graphic";
  if (isOwnedExplainer) {
    const designRole = firstText(
      typeof clip === "object" ? clip.generator_design_role : "",
      typeof clip === "object" ? clip.generatorDesignRole : "",
      sidecar.generator_design_role,
    ).toLowerCase();
    const explicitKind = firstText(
      typeof clip === "object" ? clip.readable_card_kind : "",
      typeof clip === "object" ? clip.readableCardKind : "",
      typeof clip === "object" ? clip.card_kind : "",
      typeof clip === "object" ? clip.cardKind : "",
      sidecar.card_kind,
    ).toLowerCase();
    if (designRole !== "support_card" || !explicitKind) return "";
    const matchedExplicitKind = explicitKind.match(
      /^(source|source_lock|context|timeline|quote|takeaway|proof|stat|chart|carousel|screenshot|breaking|title)$/,
    );
    return matchedExplicitKind?.[1] || "";
  }
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

const PREMIUM_CARD_KIND_PRIORITY = Object.freeze({
  source: 100,
  source_lock: 100,
  takeaway: 95,
  context: 90,
  proof: 85,
  breaking: 84,
  stat: 80,
  chart: 80,
  quote: 75,
  timeline: 65,
  title: 55,
  carousel: 50,
  screenshot: 45,
  card: 40,
});

function selectPremiumSceneClips(
  clips = [],
  {
    targetDurationS = null,
    maxCardDurationRatio = MAX_READABLE_CARD_DURATION_RATIO,
  } = {},
) {
  const source = Array.isArray(clips) ? clips.filter(Boolean) : [];
  const cards = source
    .map((clip, index) => {
      const kind = sceneClipReadableCardKind(clip);
      return kind
        ? {
            index,
            kind,
            path: sceneClipPath(clip),
            priority: PREMIUM_CARD_KIND_PRIORITY[kind] || 40,
            source_lock: kind === "source" || kind === "source_lock",
            minimum_duration_s:
              sceneClipMinimumReadableDurationS(clip) ||
              sceneClipSourceDurationS(clip) ||
              MIN_GENERATED_CARD_SCENE_DURATION_S,
            premium_card_v5: sceneClipUsesV5PremiumCard(clip),
          }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.priority - left.priority || left.index - right.index);
  const selected = [];
  const skippedReasons = new Map();
  let sourceLocks = 0;
  let narrativeCards = 0;
  let selectedCardMinimumDurationS = 0;
  const targetDuration = Number(targetDurationS);
  const configuredMaxRatio = Number(maxCardDurationRatio);
  const standardMaxRatio = Number.isFinite(configuredMaxRatio) && configuredMaxRatio > 0
    ? configuredMaxRatio
    : MAX_READABLE_CARD_DURATION_RATIO;
  for (const card of cards) {
    if (selected.length >= PREMIUM_EDIT_RHYTHM_V5.max_generated_card_scene_count) break;
    if (card.source_lock && sourceLocks >= 1) {
      skippedReasons.set(card.index, "premium_card_ceiling");
      continue;
    }
    if (!card.source_lock && narrativeCards >= PREMIUM_EDIT_RHYTHM_V5.max_narrative_card_scene_count) {
      skippedReasons.set(card.index, "premium_card_ceiling");
      continue;
    }
    const adjacent = selected.some((entry) => Math.abs(entry.index - card.index) === 1);
    if (adjacent) {
      skippedReasons.set(card.index, "premium_card_spacing");
      continue;
    }
    const prospectiveMinimumDurationS = Number(
      (selectedCardMinimumDurationS + card.minimum_duration_s).toFixed(2),
    );
    const prospectiveUsesV5 = card.premium_card_v5 || selected.some(
      (entry) => entry.premium_card_v5,
    );
    const durationRatio = prospectiveUsesV5
      ? Math.min(standardMaxRatio, MAX_V5_PREMIUM_CARD_DURATION_RATIO)
      : standardMaxRatio;
    const durationBudgetS = Number.isFinite(targetDuration) && targetDuration > 0
      ? targetDuration * durationRatio
      : Number.POSITIVE_INFINITY;
    if (prospectiveMinimumDurationS > durationBudgetS + 0.01) {
      skippedReasons.set(card.index, "premium_card_duration_budget");
      continue;
    }
    selected.push(card);
    selectedCardMinimumDurationS = prospectiveMinimumDurationS;
    if (card.source_lock) sourceLocks += 1;
    else narrativeCards += 1;
  }
  const selectedIndexes = new Set(selected.map((entry) => entry.index));
  const skippedCards = cards
    .filter((entry) => !selectedIndexes.has(entry.index))
    .sort((left, right) => left.index - right.index)
    .map((entry) => ({
      index: entry.index,
      kind: entry.kind,
      path: entry.path,
      reason: skippedReasons.get(entry.index) || (
        selected.some((chosen) => Math.abs(chosen.index - entry.index) === 1)
          ? "premium_card_spacing"
          : "premium_card_ceiling"
      ),
    }));
  const selectedInOrder = selected.slice().sort((left, right) => left.index - right.index);
  const selectedUsesV5 = selected.some((entry) => entry.premium_card_v5);
  const selectedMaxRatio = selectedUsesV5
    ? Math.min(standardMaxRatio, MAX_V5_PREMIUM_CARD_DURATION_RATIO)
    : standardMaxRatio;
  const cardDurationBudgetS = Number.isFinite(targetDuration) && targetDuration > 0
    ? Number((targetDuration * selectedMaxRatio).toFixed(2))
    : null;
  return {
    version: PREMIUM_EDIT_RHYTHM_V5.version,
    clips: source.filter((_, index) => {
      const kind = sceneClipReadableCardKind(source[index]);
      return !kind || selectedIndexes.has(index);
    }),
    selected_cards: selectedInOrder.map(({ index, kind, path }) => ({ index, kind, path })),
    selected_card_minimum_duration_s: selectedCardMinimumDurationS,
    card_duration_budget_s: cardDurationBudgetS,
    skipped_cards: skippedCards,
  };
}

function materialisedMotionClipIdentityKeys(clip) {
  const keys = [];
  if (clip && typeof clip === "object") {
    const stableId = firstText(clip.id, clip.asset_id, clip.clip_id)
      .toLowerCase();
    if (stableId) keys.push(`id:${stableId}`);
  }
  const paths = [
    sceneClipPath(clip),
    clip && typeof clip === "object" ? clip.original_path : "",
    clip && typeof clip === "object" ? clip.visual_repair?.source_path : "",
  ];
  for (const candidatePath of paths) {
    const normalisedPath = firstText(candidatePath)
      .replace(/\\/g, "/")
      .toLowerCase();
    if (normalisedPath) keys.push(`path:${normalisedPath}`);
  }
  return [...new Set(keys)];
}

function isVerifiedOwnedMaterialisedMotionClip(clip = {}) {
  if (!clip || typeof clip !== "object") return false;
  const mediaKind = firstText(clip.media_kind, clip.mediaKind).toLowerCase();
  const sourceType = firstText(clip.source_type, clip.sourceType).toLowerCase();
  const rightsEvaluation = clip.owned_rights_evaluation || {};
  const rightsGrant = clip.owned_generated_rights_grant || {};
  const sha256 = (value) => /^[a-f0-9]{64}$/i.test(firstText(value));
  const positiveNumber = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
  return Boolean(
    mediaKind === "owned_explainer_motion" &&
      sourceType === "internally_generated_motion_graphic" &&
      clip.source_safety_blocked !== true &&
      clip.owned_explainer_visual_plan === true &&
      clip.counts_towards_motion_readiness === true &&
      clip.materialized === true &&
      firstText(clip.generator_project_id) &&
      sha256(clip.generator_master_sha256) &&
      sha256(clip.materialised_output_sha256) &&
      positiveNumber(clip.materialised_output_size_bytes) &&
      firstText(clip.evidence_file_path) &&
      sha256(clip.evidence_file_sha256) &&
      positiveNumber(clip.evidence_file_size_bytes) &&
      firstText(clip.rights_evidence_file_path) &&
      sha256(clip.rights_evidence_file_sha256) &&
      positiveNumber(clip.rights_evidence_file_size_bytes) &&
      firstText(rightsEvaluation.status).toLowerCase() === "pass" &&
      rightsEvaluation.verified === true &&
      (!Array.isArray(rightsEvaluation.blockers) || !rightsEvaluation.blockers.length) &&
      firstText(rightsGrant.grant_type).toLowerCase() === "owned_generated" &&
      rightsGrant.commercial_use_allowed === true
  );
}

function validateVerifiedOwnedMaterialisedMotionClipEvidence(clip = {}) {
  const blockers = [];
  const evidence = {};
  if (!isVerifiedOwnedMaterialisedMotionClip(clip)) {
    blockers.push("owned_motion_verified_metadata_missing");
  }
  const checks = [
    {
      key: "asset",
      path: sceneClipPath(clip),
      sha256: clip.materialised_output_sha256,
      size: clip.materialised_output_size_bytes,
      missing: "owned_motion_asset_missing",
      shaMismatch: "owned_motion_asset_sha256_mismatch",
      sizeMismatch: "owned_motion_asset_size_mismatch",
    },
    {
      key: "generation_evidence",
      path: clip.evidence_file_path,
      sha256: clip.evidence_file_sha256,
      size: clip.evidence_file_size_bytes,
      missing: "owned_motion_generation_evidence_missing",
      shaMismatch: "owned_motion_generation_evidence_sha256_mismatch",
      sizeMismatch: "owned_motion_generation_evidence_size_mismatch",
    },
    {
      key: "rights_evidence",
      path: clip.rights_evidence_file_path,
      sha256: clip.rights_evidence_file_sha256,
      size: clip.rights_evidence_file_size_bytes,
      missing: "owned_motion_rights_evidence_missing",
      shaMismatch: "owned_motion_rights_evidence_sha256_mismatch",
      sizeMismatch: "owned_motion_rights_evidence_size_mismatch",
    },
  ];
  for (const check of checks) {
    const filePath = resolvePathMaybeRoot(check.path);
    try {
      const fingerprint = fingerprintLocalFileSync(filePath);
      evidence[check.key] = {
        path: filePath,
        sha256: fingerprint.sha256,
        size_bytes: fingerprint.size_bytes,
      };
      if (fingerprint.sha256 !== firstText(check.sha256).toLowerCase()) {
        blockers.push(check.shaMismatch);
      }
      if (fingerprint.size_bytes !== Number(check.size)) {
        blockers.push(check.sizeMismatch);
      }
    } catch {
      blockers.push(check.missing);
    }
  }
  return {
    status: blockers.length ? "blocked" : "pass",
    blockers: [...new Set(blockers)],
    evidence,
  };
}

function mergeMaterialisedMotionClipCandidates(
  storyClips = [],
  manifest = {},
  { rightsSafeOwnedMotionOnly = false } = {},
) {
  const base = Array.isArray(storyClips) ? storyClips.filter(Boolean) : [];
  if (rightsSafeOwnedMotionOnly === true) {
    const blocked = base
      .map((clip, index) => ({ clip, index }))
      .filter(({ clip }) => !isVerifiedOwnedMaterialisedMotionClip(clip));
    if (blocked.length) {
      const identities = blocked.map(({ clip, index }) => firstText(
        clip?.id,
        clip?.asset_id,
        clip?.clip_id,
        sceneClipPath(clip),
        `clip-${index + 1}`,
      ));
      throw new Error(
        `rights_safe_owned_motion_only_story_clip_blocked:${identities.join(",")}`,
      );
    }
    return base;
  }
  const status = String(manifest?.status || "").trim().toLowerCase();
  if (!/^(?:pass|ready|green|materialized|materialised)$/.test(status)) return base;
  const candidates = [
    ...(Array.isArray(manifest.clips) ? manifest.clips : []),
    ...(Array.isArray(manifest.materialised_clips) ? manifest.materialised_clips : []),
  ];
  const seen = new Set(base.flatMap(materialisedMotionClipIdentityKeys));
  const merged = base.slice();
  for (const clip of candidates) {
    const mediaKind = String(clip?.media_kind || clip?.mediaKind || "").trim().toLowerCase();
    const clipPath = sceneClipPath(clip);
    const identityKeys = materialisedMotionClipIdentityKeys(clip);
    const admissibleManifestClip =
      mediaKind === "direct_video" || isVerifiedOwnedMaterialisedMotionClip(clip);
    if (
      !admissibleManifestClip ||
      !clipPath ||
      identityKeys.some((key) => seen.has(key))
    ) {
      continue;
    }
    for (const key of identityKeys) seen.add(key);
    merged.push(clip);
  }
  return merged;
}

async function hydrateProofClipSourceIdentities(
  clips = [],
  {
    root = ROOT,
    resolveIdentity = materializedSourceIdentityFields,
  } = {},
) {
  return Promise.all(
    (Array.isArray(clips) ? clips : []).map(async (clip) => {
      if (!clip || typeof clip !== "object") return clip;
      const identity = await resolveIdentity(clip, { root });
      return {
        ...clip,
        ...identity,
        source_identity_conflicts: [...new Set([
          ...(Array.isArray(clip.source_identity_conflicts)
            ? clip.source_identity_conflicts
            : []),
          ...(Array.isArray(identity.source_identity_conflicts)
            ? identity.source_identity_conflicts
            : []),
        ].filter(Boolean))],
      };
    }),
  );
}

function selectBalancedProfessionalMotionCandidates(
  clips = [],
  {
    requiredBaseSources = PROFESSIONAL_MOTION_SOURCE_POLICY.min_genuine_base_sources,
    maxCandidateLayers = 3,
    policyMaxScenesPerSource = PROFESSIONAL_MOTION_SOURCE_POLICY.max_scenes_per_source,
    maxSourceShare = PROFESSIONAL_MOTION_SOURCE_POLICY.max_source_share,
    targetDurationS = null,
  } = {},
) {
  const source = Array.isArray(clips) ? clips.filter(Boolean) : [];
  const cards = [];
  const groups = new Map();
  const unresolved = [];
  const directRows = [];
  source.forEach((clip, index) => {
    if (sceneClipReadableCardKind(clip)) {
      cards.push({ clip, index });
      return;
    }
    directRows.push({ clip, index });
  });
  const reconciliation = reconcileMotionSourceIdentities(
    directRows.map((row) => row.clip),
  );
  directRows.forEach(({ clip, index }, directIndex) => {
    const identity = reconciliation.assignments[directIndex];
    if (
      identity?.resolved !== true ||
      !String(identity.base_source_asset_id || "").trim()
    ) {
      unresolved.push({
        clip_index: index,
        clip_id: firstText(clip?.id, clip?.clip_id),
        path: sceneClipPath(clip),
        blockers: identity?.blockers || ["professional_motion_source_identity_unresolved"],
      });
      return;
    }
    const key = identity.base_source_asset_id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ clip, index, identity });
  });

  const selectedDirectRows = [];
  const candidateLayerLimit = Math.max(
    1,
    Math.min(
      Math.floor(Number(maxCandidateLayers) || 1),
      Math.floor(Number(policyMaxScenesPerSource) || 1),
    ),
  );
  const groupedRows = [...groups.values()];
  const targetDuration = Number(targetDurationS);
  const selectedCoverageS = () => {
    const rawDurationS = selectedDirectRows.reduce((sum, row) => {
      const durationS = sceneClipSourceDurationS(row.clip);
      return sum + (Number.isFinite(durationS) ? durationS : 0);
    }, 0);
    return Number(
      Math.max(0, rawDurationS - XFADE_S * Math.max(0, selectedDirectRows.length - 1)).toFixed(3),
    );
  };
  for (let round = 0; round < candidateLayerLimit; round += 1) {
    if (!groupedRows.length) break;
    const layer = groupedRows.map((rows) => rows[round]).filter(Boolean);
    if (!layer.length) break;
    const completeLayer = layer.length === groupedRows.length;
    const coverageNeedsPartialLayer =
      Number.isFinite(targetDuration) &&
      targetDuration > 0 &&
      selectedCoverageS() + 0.12 < targetDuration;
    if (!completeLayer && !coverageNeedsPartialLayer) break;
    selectedDirectRows.push(...layer);
  }
  const selectedDirectIndexes = new Set(selectedDirectRows.map((row) => row.index));
  const selectedDirect = selectedDirectRows.map((row) => row.clip);
  const selected = [];
  const cardSpacing = cards.length
    ? Math.max(1, Math.ceil(selectedDirect.length / (cards.length + 1)))
    : Number.MAX_SAFE_INTEGER;
  let nextCard = 0;
  for (let index = 0; index < selectedDirect.length; index += 1) {
    selected.push(selectedDirect[index]);
    if (
      nextCard < cards.length &&
      (index + 1) % cardSpacing === 0
    ) {
      selected.push(cards[nextCard].clip);
      nextCard += 1;
    }
  }
  while (nextCard < cards.length) {
    selected.push(cards[nextCard].clip);
    nextCard += 1;
  }
  const professionalSourceDiversity = assessProfessionalSourceDiversity({
    clips: selectedDirect,
    scenes: selectedDirect,
    requiredBaseSources,
    maxScenesPerSource: policyMaxScenesPerSource,
    maxSourceShare,
  });
  const blockers = [...new Set([
    ...(unresolved.length ? ["professional_motion_source_identity_unresolved"] : []),
    ...unresolved.flatMap((entry) => entry.blockers || []),
    ...professionalSourceDiversity.blockers,
  ])];
  const dropped = source
    .map((clip, index) => ({ clip, index }))
    .filter(
      ({ index }) =>
        !cards.some((card) => card.index === index) &&
        !selectedDirectIndexes.has(index),
    )
    .map(({ clip, index }) => ({
      clip_index: index,
      clip_id: firstText(clip?.id, clip?.clip_id),
      path: sceneClipPath(clip),
      reason: unresolved.some((entry) => entry.clip_index === index)
        ? "professional_motion_source_identity_unresolved"
        : "professional_source_candidate_pool_balanced",
    }));

  return {
    schema_version: 1,
    version: "pulse_professional_motion_candidate_balancer_v1",
    status: blockers.length ? "blocked" : "pass",
    strict_pass: blockers.length === 0,
    clips: selected,
    selected_direct_motion_clip_count: selectedDirect.length,
    dropped_direct_motion_clip_count: dropped.length,
    unresolved_candidate_count: unresolved.length,
    unresolved_candidates: unresolved,
    dropped_candidates: dropped,
    professional_source_diversity: professionalSourceDiversity,
    blockers,
  };
}

const DISCOVERED_HYPERFRAMES_CARD_KINDS = Object.freeze([
  "source",
  "context",
  "takeaway",
]);

function mergeCurrentHyperframesStoryCardCandidates({
  clips = [],
  story = {},
  root = ROOT,
  channelId = "",
  resolveAssets = resolveCardAssetsV2,
  evaluateCard = evaluateHyperframesPremiumShellEvidence,
} = {}) {
  const source = Array.isArray(clips) ? clips.filter(Boolean) : [];
  const storyId = firstText(story.id, story.story_id);
  const resolvedChannelId = firstText(
    channelId,
    story.channel_id,
    story.channelId,
    process.env.CHANNEL,
    "pulse-gaming",
  );
  const existingCards = source.filter((clip) => sceneClipReadableCardKind(clip));
  if (!storyId || existingCards.length) {
    return {
      clips: source,
      accepted_cards: [],
      rejected_cards: [],
      skipped_reason: !storyId ? "story_id_missing" : "story_cards_already_explicit",
    };
  }

  const governedShellGate =
    story.hyperframes_premium_shell_gate ||
    story.premium_shell_gate ||
    story.premiumLane?.hyperframesPremiumShellGate ||
    null;
  if (governedShellGate && typeof governedShellGate === "object") {
    const verdict = String(
      governedShellGate.verdict ||
        governedShellGate.status ||
        story.premium_shell_verdict ||
        "",
    ).trim().toLowerCase();
    const selectedCardCount = Number(
      governedShellGate.selectedCardCount ??
        governedShellGate.selected_card_count ??
        story.premium_shell_selected_card_count ??
        0,
    );
    return {
      clips: source,
      accepted_cards: [],
      rejected_cards: [],
      skipped_reason:
        verdict !== "pass" || !Number.isFinite(selectedCardCount) || selectedCardCount <= 0
          ? "governed_premium_shell_selection_not_passed"
          : "governed_premium_shell_cards_missing_from_renderer_inputs",
    };
  }

  const assets = resolveAssets(root, storyId, resolvedChannelId) || {};
  const acceptedCards = [];
  const rejectedCards = [];
  for (const kind of DISCOVERED_HYPERFRAMES_CARD_KINDS) {
    const descriptor = assets[kind] || {};
    const cardPath = firstText(descriptor.path);
    if (!cardPath) continue;
    const evaluation = evaluateCard({
      cardPath,
      kind,
      storyId,
      channelId: resolvedChannelId,
    }) || {};
    const blockers = Array.isArray(evaluation.blockers)
      ? evaluation.blockers.filter(Boolean)
      : [];
    if (String(evaluation.verdict || "").toLowerCase() !== "pass" || blockers.length) {
      rejectedCards.push({ kind, path: cardPath, blockers });
      continue;
    }
    const readabilityContract = evaluation.evidence?.readabilityContract || {};
    const readability = readabilityContract.evidence || readabilityContract;
    const durationS = Number(
      readability.planned_visible_duration_s ??
        readability.visible_duration_s ??
        readability.duration_s,
    );
    const minimumReadableDurationS = Number(
      readability.minimum_visible_duration_s ??
        readability.minimum_readable_duration_s ??
        durationS,
    );
    if (!Number.isFinite(durationS) || durationS <= 0) {
      rejectedCards.push({
        kind,
        path: cardPath,
        blockers: ["hyperframes_readable_hold_duration_missing"],
      });
      continue;
    }
    acceptedCards.push({
      id: `hyperframes_${kind}_card_${storyId}`,
      kind,
      card_kind: kind,
      path: cardPath,
      source_url: `local://pulse-hyperframes/${storyId}/${kind}`,
      source_type: "hyperframes_premium_shell_card",
      source_family: `hyperframes_${kind}_card`,
      motion_family: `hyperframes_${kind}_card`,
      media_kind: "owned_editorial_motion_graphic",
      asset_class: `hyperframes_${kind}_card`,
      readable_text: firstText(readability.readable_text, readability.text, kind),
      durationS: Number(durationS.toFixed(3)),
      minimum_readable_duration_s: Number(
        (Number.isFinite(minimumReadableDurationS) && minimumReadableDurationS > 0
          ? minimumReadableDurationS
          : durationS).toFixed(3),
      ),
      rights_basis: "owned_generated_editorial_motion_graphic",
      licence_basis: "owned_generated_editorial_motion_graphic",
      allowed_use: "owned_editorial_motion_graphic",
      commercial_use_allowed: true,
      approval_status: "approved_for_owned_editorial_use",
      hyperframes_card: true,
      hyperframes_premium_shell_evidence: evaluation.evidence || {},
    });
  }

  if (!acceptedCards.length) {
    return {
      clips: source,
      accepted_cards: [],
      rejected_cards: rejectedCards,
      skipped_reason: "no_verified_story_cards",
    };
  }

  const insertionPoints = acceptedCards.map((_, index) =>
    Math.max(
      1,
      Math.min(
        source.length,
        Math.round(((index + 1) * source.length) / (acceptedCards.length + 1)),
      ),
    ),
  );
  const merged = [];
  for (let index = 0; index < source.length; index += 1) {
    merged.push(source[index]);
    for (let cardIndex = 0; cardIndex < acceptedCards.length; cardIndex += 1) {
      if (insertionPoints[cardIndex] === index + 1) {
        merged.push(acceptedCards[cardIndex]);
      }
    }
  }

  return {
    clips: merged,
    accepted_cards: acceptedCards.map((card, index) => ({
      kind: card.card_kind,
      path: card.path,
      duration_s: card.durationS,
      insertion_after_direct_clip: insertionPoints[index],
    })),
    rejected_cards: rejectedCards,
    skipped_reason: null,
  };
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

function sceneClipUsesV5PremiumCard(clip = {}) {
  if (!clip || typeof clip !== "object") return false;
  const provenance = firstText(
    clip.media_kind,
    clip.source_kind,
    clip.source_type,
    clip.rights_risk_class,
  ).toLowerCase();
  if (/owned_(?:generated_)?explainer|owned_generated_motion/.test(provenance)) return false;
  const sidecar = readSceneClipSidecar(clip) || {};
  const version = firstText(
    clip.creative_system_version,
    clip.creativeSystemVersion,
    sidecar.creative_system_version,
    sidecar.hyperframes_premium_shell?.creative_identity_contract?.evidence?.version,
  ).toLowerCase();
  if (version === CREATIVE_SYSTEM_VERSION) return true;
  const cardDescriptor = [
    clip.source_type,
    clip.source_kind,
    clip.source_family,
    clip.motion_family,
    clip.hyperframes_card === true ? "hyperframes_card" : "",
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  return /hyperframes_(?:premium_shell_)?card|hyperframes.*(?:source|context|quote|takeaway|timeline)_card/.test(
    cardDescriptor,
  );
}

function readableCardMinimumDurationS({ readableText = "", explicitMinimumS = null, readableCardKind = "" } = {}) {
  const kind = String(readableCardKind || "").trim().toLowerCase();
  if (kind === "source" || kind === "source_lock") {
    return Number(SOURCE_LOCK_OVERLAY_CARD_DURATION_S.toFixed(2));
  }
  const explicit = Number(explicitMinimumS);
  return Number(
    Math.max(
      MIN_GENERATED_CARD_SCENE_DURATION_S,
      Number.isFinite(explicit) && explicit > 0 ? explicit : 0,
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
    if (
      entry.readableCardKind ||
      entry.verifiedOwnedGeneratedMotion ||
      !entry.baseSourceKey
    ) continue;
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

function buildProfessionalSourceDiversityProof({
  clips = [],
  scenePlan = {},
  requiredBaseSources = null,
} = {}) {
  const clipByPath = new Map();
  for (const clip of Array.isArray(clips) ? clips.filter(Boolean) : []) {
    const clipPath = sceneClipPath(clip);
    const key = String(clipPath || "").trim().replace(/\\/g, "/").toLowerCase();
    if (key && !clipByPath.has(key)) clipByPath.set(key, clip);
  }

  const selectedDirectScenes = (Array.isArray(scenePlan?.scenes) ? scenePlan.scenes : [])
    .filter((scene) => !scene?.readableCardKind)
    .map((scene) => {
      const scenePath = sceneClipPath(scene);
      const key = String(scenePath || "").trim().replace(/\\/g, "/").toLowerCase();
      const original = clipByPath.get(key);
      const sidecar = original ? readSceneClipSidecar(original) || {} : {};
      return {
        ...sidecar,
        ...(original && typeof original === "object" ? original : {}),
        ...scene,
        path: scenePath,
        provenance: {
          ...(sidecar?.provenance || {}),
          ...(original?.provenance || {}),
          ...(scene?.provenance || {}),
        },
      };
    });

  const explicitMinimum = Number(requiredBaseSources);
  const effectiveMinimum = Number.isFinite(explicitMinimum) && explicitMinimum > 0
    ? Math.max(PROFESSIONAL_MOTION_SOURCE_POLICY.min_genuine_base_sources, Math.floor(explicitMinimum))
    : PROFESSIONAL_MOTION_SOURCE_POLICY.min_genuine_base_sources;
  const proof = assessProfessionalSourceDiversity({
    clips: selectedDirectScenes,
    scenes: selectedDirectScenes,
    requiredBaseSources: effectiveMinimum,
    maxScenesPerSource: MAX_DIRECT_MOTION_SCENES_PER_SOURCE_ROOT,
    maxSourceShare: MAX_DIRECT_MOTION_SOURCE_CONCENTRATION_RATIO,
  });

  return {
    ...proof,
    scene_plan_concentration_evidence: {
      ...(scenePlan?.directMotionSourceConcentrationMetrics || {}),
      current_rule: proof.concentration_rule,
    },
  };
}

function scenePlanBlockerDiagnostic(plan = {}, { targetDurationS = null } = {}) {
  const parts = [
    `available=${Number(plan.availableUniqueClipCount || 0)}`,
    `required=${Number(plan.requiredUniqueClipCount || 0)}`,
  ];
  const metrics =
    plan.directMotionSourceConcentrationMetrics ||
    plan.direct_motion_source_concentration_metrics ||
    {};
  const maxRatio = Number(
    metrics.max_source_concentration_ratio ?? metrics.maxSourceConcentrationRatio,
  );
  for (const source of metrics.concentrated_sources || metrics.concentratedSources || []) {
    const key = String(source.key || source.source_root || source.sourceRoot || "unknown").trim();
    const count = Number(source.count || 0);
    const ratio = Number(source.ratio || 0);
    parts.push(
      [
        `source=${key}`,
        `count=${count}`,
        `ratio=${Number(ratio.toFixed(3))}`,
        Number.isFinite(maxRatio) ? `max_ratio=${Number(maxRatio.toFixed(3))}` : "",
      ].filter(Boolean).join(";"),
    );
  }
  const covered = Number(plan.coveredDurationS ?? plan.covered_duration_s);
  const target = Number(targetDurationS);
  if (Number.isFinite(covered) && Number.isFinite(target) && target > 0) {
    parts.push(
      `covered=${Number(covered.toFixed(3))};target=${Number(target.toFixed(3))};` +
        `missing=${Number(Math.max(0, target - covered).toFixed(3))}`,
    );
  }
  return parts.join(":");
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
      premiumCardV5: readableCardKind ? sceneClipUsesV5PremiumCard(clip) : false,
      verifiedOwnedGeneratedMotion:
        !readableCardKind &&
        isVerifiedOwnedMaterialisedMotionClip(clip) &&
        firstText(clip.generator_design_role).toLowerCase() === "primary_procedural_motion",
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
    cleanEntries.length > 1
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
  const coveredDurationS = Number(
    (
      sceneEntries.reduce((sum, entry) => sum + entry.plannedDurationS, 0) -
      xfadeS * Math.max(0, sceneEntries.length - 1)
    ).toFixed(3),
  );
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
  const v5PremiumCardSceneCount = sceneEntries.filter(
    (entry) => entry.readableCardKind && entry.premiumCardV5 === true,
  ).length;
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
    v5_premium_card_scene_count: v5PremiumCardSceneCount,
    max_readable_card_duration_ratio: v5PremiumCardSceneCount
      ? MAX_V5_PREMIUM_CARD_DURATION_RATIO
      : MAX_READABLE_CARD_DURATION_RATIO,
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
    readableCardDurationRatio > (
      v5PremiumCardSceneCount
        ? MAX_V5_PREMIUM_CARD_DURATION_RATIO
        : MAX_READABLE_CARD_DURATION_RATIO
    )
  ) {
    blockers.push("readable_card_duration_ratio_above_premium_floor");
  }
  const premiumEditRhythm = inspectPremiumEditRhythm({
    scenes: sceneEntries,
    coveredDurationS,
  });
  if (repeatFree) {
    for (const blocker of premiumEditRhythm.blockers) {
      if (!blockers.includes(blocker)) blockers.push(blocker);
    }
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
    premiumCardV5: entry.premiumCardV5 === true,
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
    premiumEditRhythm,
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
  const contentIdentity = resolveContentIdentity(story);
  const pulseIdentity = resolvePulseVisualIdentity(story);
  const openingOffsetX = safeMarginMode ? 12 : 0;
  const openingChipX = signature.opening.layout.chip_x_px + openingOffsetX;
  const openingChipRight = openingChipX + signature.opening.layout.chip_width_px;
  const openingSourceX = signature.opening.layout.source_x_px + openingOffsetX;
  const openingSafeRight = safeMarginMode ? 998 : 1010;
  const openingRailGapPx = 18;
  const openingIdentityMaxWidthPx = safeMarginMode ? 250 : 270;
  const openingIdentityX = openingSafeRight - openingIdentityMaxWidthPx;
  const openingSourceMaxWidthPx = Math.max(
    160,
    openingIdentityX - openingRailGapPx - openingSourceX,
  );
  const source = sourceLabelFor(story);
  const identity = `${contentIdentity.brand.on_screen_label} // ${pulseIdentity.code}`;
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
      maxWidthPx: openingSourceMaxWidthPx,
      maxLines: 1,
      preferredFontSizePx: 20,
      minFontSizePx: 16,
      lineGapPx: 5,
    }),
    fitOverlayTextBlock({
      id: "top_identity",
      value: identity,
      x: openingIdentityX,
      y: 268,
      maxWidthPx: openingIdentityMaxWidthPx,
      maxLines: 1,
      preferredFontSizePx: 18,
      minFontSizePx: 14,
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
    opening_rail: {
      segment_chip_right_px: openingChipRight,
      source_left_px: openingSourceX,
      source_right_px: openingIdentityX - openingRailGapPx,
      identity_left_px: openingIdentityX,
      identity_right_px: openingSafeRight,
      minimum_gap_px: openingRailGapPx,
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
  const signature = buildPulseSignatureContract({ story, durationS: finalDuration });
  if (Number(signature?.outro?.duration_s || 0) >= 2.2) {
    windows.push(overlayWindow({
      id: "brand_outro",
      kind: "title",
      text: `${signature.outro.brand_line} - ${signature.outro.catch_line}`,
      startS: Number(signature.outro.start_s),
      durationS: Number(signature.outro.duration_s),
      source: "studio_v4_pulse_signature_layer",
    }));
  }
  return windows.filter((window) => Number(window.end_s || 0) <= finalDuration + 0.05);
}

function buildMediaAttributionFilterParts({
  story = {},
  fontOpt = "font='DejaVu Sans Mono'",
} = {}) {
  const manifest =
    story.media_attribution_manifest ||
    story.attribution_manifest?.media ||
    null;
  const manifestVerdict = String(manifest?.verdict || "").trim().toUpperCase();
  if (["RED", "FAIL", "FAILED"].includes(manifestVerdict)) return [];
  const entries = Array.isArray(manifest?.entries)
    ? manifest.entries
    : Array.isArray(story.media_attribution_entries)
      ? story.media_attribution_entries
      : [];
  const parts = [];
  for (const entry of entries.slice(0, 12)) {
    const decisionVerdict = String(entry?.decision_verdict || "").trim().toUpperCase();
    if (["RED", "FAIL", "FAILED"].includes(decisionVerdict)) continue;
    const text = String(entry?.display_text || "").replace(/\s+/g, " ").trim().slice(0, 72);
    const start = Number(entry?.timeline?.start_seconds ?? entry?.start_seconds);
    const end = Number(entry?.timeline?.end_seconds ?? entry?.end_seconds);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      continue;
    }
    const enable = `between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})`;
    parts.push(
      `drawbox=x=46:y=h-224:w=720:h=48:color=0x080B12@0.68:t=fill:enable='${enable}'`,
      `drawtext=text='${drawtextEscape(text)}':${fontOpt}:fontcolor=white@0.92:fontsize=18:x=62:y=h-211:shadowcolor=black@0.72:shadowx=2:shadowy=2:enable='${enable}'`,
    );
  }
  return parts;
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
  const pulseIdentity = resolvePulseVisualIdentity(story);
  const livingMotion = resolveLivingMotionGrammar(story);
  const identityAccent = `0x${String(contentIdentity.brand.accent || "#FF6B1A").replace(/^#/, "")}`;
  const pulseBrandAccent = signature.palette.pulse_amber;
  const pulseSignalCyan = signature.palette.signal_cyan;
  const pulsePrimary = ffmpegHex(pulseIdentity.primary);
  const pulseSecondary = ffmpegHex(pulseIdentity.secondary);
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
  const nonCardOverlayEnable = cardExclusions.join("*");
  const nonCardOverlayEnableSuffix = nonCardOverlayEnable
    ? `:enable='${nonCardOverlayEnable}'`
    : "";
  const cardCaptionPlateEnable = cardVisibleWindows
    .filter((window) => Number.isFinite(Number(window?.start_s)) && Number.isFinite(Number(window?.end_s)))
    .map((window) => `between(t,${t(window.start_s)},${t(window.end_s)})`)
    .join("+");
  const livingGhostWindow =
    `between(t,${t(livingMotion.editorial.ghost_start_s)},${t(livingMotion.editorial.ghost_end_s)})`;
  const livingGhostEnable = `:enable='${
    cardExclusions.length
      ? [livingGhostWindow, ...cardExclusions].join("*")
      : livingGhostWindow
  }'`;
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
  const outroEnable = enableFor(signature.outro, { avoidCardWindows: true });
  const progressStart = (window, offsetS) => t(Number(window.start_s || 0) + offsetS);
  const segmentLabel = drawtextEscape(signature.segment.display_label);
  const creativeSegmentLabel = drawtextEscape(pulseIdentity.segment_name.toUpperCase());
  const livingGhostWord = drawtextEscape(livingMotion.ghost_word);
  const proofLabel = drawtextEscape(signature.proof_label);
  const impactLabel = drawtextEscape(signature.impact_label);
  return [
    `[${inputLabel}]eq=brightness='if(lt(t\\,3.3)\\,0.055\\,-0.015)':contrast=1.10:saturation=1.20:eval=frame`,
    `drawbox=x=0:y=0:w=${sideMaskWidth}:h=ih:color=0x0B0F19@${sideMaskAlpha}:t=fill${nonCardOverlayEnableSuffix}`,
    `drawbox=x=iw-${sideMaskWidth}:y=0:w=${sideMaskWidth}:h=ih:color=0x0B0F19@${sideMaskAlpha}:t=fill${nonCardOverlayEnableSuffix}`,
    `drawbox=x=${accentRailX}:y=0:w=4:h=ih:color=${pulseBrandAccent}@0.30:t=fill${nonCardOverlayEnableSuffix}`,
    `drawbox=x=${accentRailX}:y='mod(t*480\\,2080)-160':w=4:h=160:color=${pulseBrandAccent}@0.95:t=fill${nonCardOverlayEnableSuffix}`,
    `drawbox=x=${accentRailX + 5}:y=0:w=2:h=ih:color=${pulsePrimary}@0.95:t=fill${nonCardOverlayEnableSuffix}`,
    `drawbox=x=${accentRailX + 7}:y='mod(t*480+420\\,2000)-80':w=2:h=80:color=${pulseSignalCyan}@0.78:t=fill${nonCardOverlayEnableSuffix}`,
    `drawbox=x='-260+mod(t*${livingMotion.sweeps.primary_speed_px_s}\\,1540)':y=0:w=210:h=ih:color=white@${livingMotion.sweeps.primary_opacity.toFixed(3)}:t=fill${nonCardOverlayEnableSuffix}`,
    `drawbox=x='940-mod(t*${livingMotion.sweeps.accent_speed_px_s}\\,1220)':y=0:w=92:h=ih:color=${identityAccent}@${livingMotion.sweeps.accent_opacity.toFixed(3)}:t=fill${nonCardOverlayEnableSuffix}`,
    `drawbox=x=54:y='560+sin(t*0.21)*34':w=972:h=1:color=${identityAccent}@0.24:t=fill${nonCardOverlayEnableSuffix}`,
    `drawtext=text='${livingGhostWord}':${fontOpt}:fontcolor=${identityAccent}@${livingMotion.editorial.ghost_opacity.toFixed(3)}:fontsize=${livingMotion.editorial.ghost_font_size_px}:x='-24+sin(t*${livingMotion.editorial.ghost_rate})*${livingMotion.editorial.ghost_drift_x_px}':y=${livingMotion.editorial.ghost_y_px}:shadowcolor=black@0.16:shadowx=3:shadowy=3${livingGhostEnable}`,
    ...(cardCaptionPlateEnable ? [
      `drawbox=x=96:y=${CARD_CAPTION_PLATE_Y_PX}:w=888:h=210:color=0x07090D@0.66:t=fill:enable='${cardCaptionPlateEnable}'`,
      `drawbox=x=96:y=${CARD_CAPTION_PLATE_Y_PX}:w=888:h=3:color=${identityAccent}@0.82:t=fill:enable='${cardCaptionPlateEnable}'`,
    ] : []),
    ...(suppressOpeningStoryCard ? [] : [
    `drawbox=x=${openingCardX}:y=${openingCardY}:w=${openingCardW}:h=${openingCardH}:color=0x111827@0.58:t=fill:enable='${openingEnable}'`,
    `drawbox=x=${openingCardX}:y=${openingCardY}:w=${openingCardW}:h=${openingCardH}:color=0x0B0F19@0.18:t=fill:enable='${openingEnable}'`,
    `drawbox=x=${openingCardX}:y=${openingCardY}:w=${openingCardW}:h=${openingCardH}:color=0xF8FAFC@0.16:t=2:enable='${openingEnable}'`,
    `drawbox=x=${openingCardX}:y=${openingCardY}:w=118:h=3:color=0xF8FAFC@0.88:t=fill:enable='${openingEnable}'`,
    `drawbox=x=${openingCardX}:y=${openingCardY}:w='if(lt(t\\,${progressStart(openingWindow, 0.18)})\\,1\\,1+(${openingCardW}-1)*(t-${progressStart(openingWindow, 0.18)})/0.30)':h=5:color=${pulseSecondary}@0.92:t=fill:enable='${openingEnable}'`,
    `drawbox=x=${openingCardX}:y=${openingCardY + openingCardH - 6}:w=600:h=5:color=${identityAccent}@0.68:t=fill:enable='${openingEnable}'`,
    `drawbox=x=${openingChipX}:y=264:w=${openingChipW}:h=36:color=0x38BDF8@0.16:t=fill:enable='${openingEnable}'`,
    `drawbox=x=${openingChipX}:y=264:w=${openingChipW}:h=36:color=0x38BDF8@0.56:t=2:enable='${openingEnable}'`,
    `drawtext=text='${segmentLabel}':${metaFontOpt}:fontcolor=0xBEEBFF:fontsize=18:x=${openingChipX + 16}:y=268:shadowcolor=black@0.72:shadowx=2:shadowy=2:enable='${openingEnable}'`,
    ...drawtextLinesForBlock(blockById.top_identity, { fontOpt: metaFontOpt, fontcolor: identityAccent, enable: openingEnable }),
    ...drawtextLinesForBlock(blockById.top_source_lock, { fontOpt: metaFontOpt, fontcolor: "0xFFB15C", enable: openingEnable, shadow: false }),
    `drawbox=x='${openingCardX + 24}+mod(t*380\\,760)':y=${openingCardY + 12}:w=92:h=${openingCardH - 24}:color=white@0.046:t=fill:enable='${openingEnable}'`,
    ...drawtextLinesForBlock(blockById.hook_card, { fontOpt, fontcolor: "white", enable: openingEnable }),
    `drawtext=text='${creativeSegmentLabel}':${metaFontOpt}:fontcolor=${pulseSecondary}:fontsize=17:x=${openingCardX + 24}:y=${openingCardY + openingCardH - 30}:enable='${openingEnable}'`,
    ]),
    ...(suppressAllStoryCards ? [] : [
    `drawbox=x=64:y=520:w=956:h=222:color=0x0B0F19@0.48:t=fill:enable='${headlineEnable}'`,
    `drawbox=x=64:y=520:w=956:h=222:color=0xF8FAFC@0.16:t=2:enable='${headlineEnable}'`,
    `drawbox=x=64:y=520:w=956:h=4:color=white@0.22:t=fill:enable='${headlineEnable}'`,
    `drawbox=x=64:y=736:w='if(lt(t\\,${progressStart(headlineWindow, 0.22)})\\,1\\,1+(956-1)*(t-${progressStart(headlineWindow, 0.22)})/0.34)':h=6:color=${pulseSecondary}@0.92:t=fill:enable='${headlineEnable}'`,
    ...drawtextLinesForBlock(blockById.headline_card, { fontOpt, fontcolor: "white", enable: headlineEnable }),
    ...drawtextLinesForBlock(blockById.headline_source, { fontOpt, fontcolor: "0xFFB15C", enable: headlineEnable, shadow: false }),
    `drawbox=x=76:y=812:w=690:h=140:color=0x0B0F19@0.46:t=fill:enable='${proofPrimaryEnable}'`,
    `drawbox=x=76:y=812:w=690:h=140:color=0xF8FAFC@0.14:t=2:enable='${proofPrimaryEnable}'`,
    `drawbox=x=76:y=812:w='if(lt(t\\,${progressStart(proofPrimaryWindow, 0.18)})\\,1\\,1+(690-1)*(t-${progressStart(proofPrimaryWindow, 0.18)})/0.28)':h=5:color=${pulseSecondary}@0.92:t=fill:enable='${proofPrimaryEnable}'`,
    `drawtext=text='${proofLabel}':${metaFontOpt}:fontcolor=${pulseSecondary}:fontsize=18:x=98:y=824:enable='${proofPrimaryEnable}'`,
    ...drawtextLinesForBlock(blockById.proof_primary, { fontOpt, fontcolor: "white", enable: proofPrimaryEnable }),
    `drawbox=x=96:y=1010:w=690:h=140:color=0x0B0F19@0.46:t=fill:enable='${proofSecondaryEnable}'`,
    `drawbox=x=96:y=1010:w=690:h=140:color=0xF8FAFC@0.14:t=2:enable='${proofSecondaryEnable}'`,
    `drawbox=x=96:y=1144:w='if(lt(t\\,${progressStart(proofSecondaryWindow, 0.18)})\\,1\\,1+(690-1)*(t-${progressStart(proofSecondaryWindow, 0.18)})/0.32)':h=5:color=${pulseSecondary}@0.92:t=fill:enable='${proofSecondaryEnable}'`,
    `drawtext=text='${impactLabel}':${metaFontOpt}:fontcolor=${pulseSecondary}:fontsize=18:x=118:y=1022:enable='${proofSecondaryEnable}'`,
    ...drawtextLinesForBlock(blockById.proof_secondary, { fontOpt, fontcolor: "white", enable: proofSecondaryEnable }),
    ]),
    ...buildMediaAttributionFilterParts({ story, fontOpt: metaFontOpt }),
    `drawbox=x=w-286:y=h-126:w=244:h=60:color=0x0D0D0F@0.58:t=fill${nonCardOverlayEnableSuffix}`,
    `drawbox=x=w-286:y=h-126:w=6:h=60:color=${identityAccent}@0.95:t=fill${nonCardOverlayEnableSuffix}`,
    `drawbox=x=w-280:y=h-126:w=238:h=2:color=${pulseSecondary}@0.78:t=fill${nonCardOverlayEnableSuffix}`,
    `drawtext=text='PULSE // GAMING // ${drawtextEscape(pulseIdentity.code)}':${metaFontOpt}:fontcolor=white@0.92:fontsize=22:x=w-tw-58:y=h-108:shadowcolor=black@0.70:shadowx=2:shadowy=2${nonCardOverlayEnableSuffix}`,
    `drawbox=x=70:y=310:w=940:h=178:color=0x0D0D0F@0.74:t=fill:enable='${outroEnable}'`,
    `drawbox=x=70:y=310:w=940:h=5:color=${identityAccent}@0.95:t=fill:enable='${outroEnable}'`,
    `drawbox=x=70:y=483:w=940:h=3:color=${pulseSecondary}@0.78:t=fill:enable='${outroEnable}'`,
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
  const readableCardKind = String(scene.readableCardKind || "").trim();
  if (readableCardKind) {
    return [
      `[${i}:v]scale=1080:1920:flags=lanczos,trim=duration=${durationS},setpts=PTS-STARTPTS,fps=${FPS},format=yuv420p,setsar=1[v${i}]`,
    ];
  }
  const motion = livingMotion || resolveLivingMotionGrammar({});
  const depth = motion.depth;

  return [
    `[${i}:v]scale=1260:2240:force_original_aspect_ratio=increase:in_range=pc:out_range=tv,crop=w=1080:h=1920:x='(iw-1080)*(0.50+${depth.background_drift_ratio.toFixed(2)}*sin(t*${depth.background_rate_x.toFixed(2)}+${i}))':y='(ih-1920)*(0.50+${depth.background_drift_ratio.toFixed(2)}*cos(t*${depth.background_rate_y.toFixed(2)}+${i}))',eq=brightness=0.035:saturation=1.16:contrast=1.10,unsharp=5:5:0.42:3:3:0.12,noise=alls=4:allf=t+u,trim=duration=${durationS},setpts=PTS-STARTPTS,fps=${FPS},format=yuv420p,setsar=1[v${i}]`,
  ];
}

async function materializeVerifiedProofOutput({
  outputPath,
  renderTemporary,
  verifyTemporary,
} = {}) {
  if (typeof renderTemporary !== "function") throw new Error("render_temporary_handler_missing");
  if (typeof verifyTemporary !== "function") throw new Error("verify_temporary_handler_missing");
  const resolvedOutputPath = path.resolve(outputPath || "");
  await fs.ensureDir(path.dirname(resolvedOutputPath));
  const lockPath = `${resolvedOutputPath}.render.lock`;
  const temporaryPath = path.join(
    path.dirname(resolvedOutputPath),
    `.${path.basename(resolvedOutputPath)}.rendering-${process.pid}-${crypto.randomUUID()}.mp4`,
  );
  const backupPath = `${resolvedOutputPath}.previous-${crypto.randomUUID()}`;
  let lockHandle;
  let ownsLock = false;
  let hadPrevious = false;
  try {
    try {
      lockHandle = await nativeFs.open(lockPath, "wx");
      ownsLock = true;
      await lockHandle.writeFile(JSON.stringify({
        pid: process.pid,
        started_at: new Date().toISOString(),
        output_path: resolvedOutputPath,
        temporary_path: temporaryPath,
      }, null, 2));
    } catch (error) {
      if (error?.code === "EEXIST") throw new Error(`proof_render_already_in_progress:${resolvedOutputPath}`);
      throw error;
    }
    await renderTemporary(temporaryPath);
    if (!(await fs.pathExists(temporaryPath))) throw new Error("proof_render_temporary_output_missing");
    const temporaryStat = await fs.stat(temporaryPath);
    if (!temporaryStat.isFile() || temporaryStat.size < 1024) {
      throw new Error("proof_render_temporary_output_too_small");
    }
    const verification = await verifyTemporary(temporaryPath);
    hadPrevious = await fs.pathExists(resolvedOutputPath);
    if (hadPrevious) await fs.rename(resolvedOutputPath, backupPath);
    try {
      await fs.rename(temporaryPath, resolvedOutputPath);
      if (hadPrevious) await fs.remove(backupPath);
    } catch (error) {
      if (hadPrevious && (await fs.pathExists(backupPath))) {
        await fs.rename(backupPath, resolvedOutputPath).catch(() => {});
      }
      throw error;
    }
    return { output_path: resolvedOutputPath, verification };
  } finally {
    await fs.remove(temporaryPath).catch(() => {});
    if (lockHandle) await lockHandle.close().catch(() => {});
    if (ownsLock) await fs.remove(lockPath).catch(() => {});
    if (hadPrevious && (await fs.pathExists(backupPath))) await fs.remove(backupPath).catch(() => {});
  }
}

async function verifyRenderedProofMedia(filePath, {
  expectedDurationS,
  execFileImpl = execFileAsync,
} = {}) {
  const resolvedPath = path.resolve(filePath || "");
  if (!(await fs.pathExists(resolvedPath))) throw new Error("proof_render_output_missing");
  let metadata;
  try {
    const { stdout } = await execFileImpl("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,sample_rate",
      "-of", "json",
      resolvedPath,
    ], {
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    metadata = JSON.parse(stdout);
  } catch (error) {
    const detail = String(error?.stderr || error?.message || "probe_error").replace(/\s+/g, " ").slice(0, 240);
    throw new Error(`proof_render_probe_failed:${detail}`);
  }
  const streams = Array.isArray(metadata?.streams) ? metadata.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const durationS = Number(metadata?.format?.duration);
  const profileBlockers = [];
  if (!Number.isFinite(durationS) || durationS <= 0) profileBlockers.push("duration_invalid");
  if (video?.codec_name !== "h264") profileBlockers.push("video_codec_not_h264");
  if (Number(video?.width) !== 1080 || Number(video?.height) !== 1920) {
    profileBlockers.push("video_dimensions_not_1080x1920");
  }
  if (audio?.codec_name !== "aac") profileBlockers.push("audio_codec_not_aac");
  if (Number(audio?.sample_rate) !== SOCIAL_AUDIO_SAMPLE_RATE) {
    profileBlockers.push("audio_sample_rate_not_48000");
  }
  if (
    Number.isFinite(Number(expectedDurationS)) &&
    Number.isFinite(durationS) &&
    Math.abs(durationS - Number(expectedDurationS)) > 0.5
  ) {
    profileBlockers.push("duration_mismatch");
  }
  if (profileBlockers.length) {
    throw new Error(`proof_render_profile_failed:${profileBlockers.join(",")}`);
  }
  const nullSink = process.platform === "win32" ? "NUL" : "/dev/null";
  try {
    await execFileImpl("ffmpeg", [
      "-hide_banner",
      "-nostdin",
      "-v", "error",
      "-xerror",
      "-i", resolvedPath,
      "-map", "0:v:0",
      "-map", "0:a:0",
      "-f", "null",
      nullSink,
    ], {
      encoding: "utf8",
      timeout: 300_000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    const detail = String(error?.stderr || error?.message || "decode_error").replace(/\s+/g, " ").slice(0, 240);
    throw new Error(`proof_render_full_decode_failed:${detail}`);
  }
  return {
    status: "pass",
    fully_decoded: true,
    duration_s: durationS,
    video: { codec: video.codec_name, width: Number(video.width), height: Number(video.height) },
    audio: { codec: audio.codec_name, sample_rate_hz: Number(audio.sample_rate) },
  };
}

async function renderProof({ storyJson, output, proofOutputDir }) {
  if (!storyJson) throw new Error("missing --story-json");
  const storyPath = resolvePathMaybeRoot(storyJson);
  const story = await fs.readJson(storyPath);
  const proofOut = resolveProofOutputDir(proofOutputDir);
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
  const siblingMotionManifestPath = path.join(path.dirname(storyPath), "materialised_motion_clips.json");
  const siblingMotionManifest = await fs.pathExists(siblingMotionManifestPath)
    ? await fs.readJson(siblingMotionManifestPath)
    : {};
  const materialisedClipCandidates = mergeMaterialisedMotionClipCandidates(
    bridgeClips.length ? bridgeClips : story.video_clips || [],
    siblingMotionManifest,
    { rightsSafeOwnedMotionOnly: story.rights_safe_owned_motion_only === true },
  );
  const hyperframesCardDiscovery = mergeCurrentHyperframesStoryCardCandidates({
    clips: materialisedClipCandidates,
    story,
    root: ROOT,
  });
  const clipCandidates = hyperframesCardDiscovery.clips;
  const clips = [];
  for (const clip of clipCandidates) {
    const rawPath = sceneClipPath(clip);
    const resolved = await resolveReadableMediaPath(rawPath);
    if (resolved && fs.existsSync(resolved)) {
      if (clip && typeof clip === "object") {
        const mediaKind = firstText(clip.media_kind, clip.mediaKind).toLowerCase();
        const ownedMotionEvidence = mediaKind === "owned_explainer_motion"
          ? validateVerifiedOwnedMaterialisedMotionClipEvidence(clip)
          : null;
        if (ownedMotionEvidence && ownedMotionEvidence.status !== "pass") {
          throw new Error(
            `owned_materialised_motion_evidence_blocked:${ownedMotionEvidence.blockers.join(",")}`,
          );
        }
        clips.push({
          ...clip,
          path: resolved,
          original_path: rawPath,
          ...(ownedMotionEvidence
            ? { exact_owned_motion_evidence: ownedMotionEvidence.evidence }
            : {}),
        });
      }
      else clips.push(resolved);
    }
  }
  if (!clips.length) throw new Error("no local V4 clips available");
  const identityHydratedClips = await hydrateProofClipSourceIdentities(clips, {
    root: ROOT,
  });

  const durationS = ffprobeDuration(audioPath);
  if (!Number.isFinite(durationS) || durationS <= 0) {
    throw new Error(`invalid audio duration: ${audioPath}`);
  }
  const visualEligibilitySelection = await filterPremiumDirectMotionClips(
    identityHydratedClips,
    {
    outputDir: path.join(
      proofOut,
      "v5-direct-motion-visual",
      String(story.id || "story").replace(/[^a-z0-9_-]+/gi, "_"),
    ),
      policyTier: "normal_strict_green",
    },
  );
  if (visualEligibilitySelection.blockers.length) {
    throw new Error(
      `direct_motion_visual_selector_blocked:${visualEligibilitySelection.blockers.join(",")}`,
    );
  }
  const professionalCandidateSelection =
    selectBalancedProfessionalMotionCandidates(visualEligibilitySelection.clips, {
      requiredBaseSources: story.required_genuine_base_source_count,
      targetDurationS: durationS,
    });
  if (professionalCandidateSelection.blockers.length) {
    throw new Error(
      `direct_motion_visual_selector_blocked:${professionalCandidateSelection.blockers.join(",")}`,
    );
  }
  const directMotionVisualSelection = {
    ...visualEligibilitySelection,
    policy_tier: "ultimate_professional",
    clips: professionalCandidateSelection.clips,
    source_diversity: {
      ...visualEligibilitySelection.source_diversity,
      strict_pass: professionalCandidateSelection.strict_pass,
      reasons: professionalCandidateSelection.blockers,
      professional_source_diversity:
        professionalCandidateSelection.professional_source_diversity,
    },
    professional_source_diversity:
      professionalCandidateSelection.professional_source_diversity,
    professional_candidate_selection: professionalCandidateSelection,
    blockers: professionalCandidateSelection.blockers,
  };
  const premiumSceneSelection = selectPremiumSceneClips(
    directMotionVisualSelection.clips,
    { targetDurationS: durationS },
  );
  const scenePlan = buildClipScenePlan({
    clips: premiumSceneSelection.clips,
    durationS,
    maxSceneDurationS: directClipMaxVisibleDwellS(),
    maxScenes: directClipMaxScenes(),
  });
  const professionalSourceDiversity = buildProfessionalSourceDiversityProof({
    clips: premiumSceneSelection.clips,
    scenePlan,
    requiredBaseSources: story.required_genuine_base_source_count,
  });
  if (professionalSourceDiversity.status !== "pass") {
    throw new Error(
      `professional_source_diversity_blocked:${professionalSourceDiversity.blockers.join(",")}`,
    );
  }
  if (Array.isArray(scenePlan.blockers) && scenePlan.blockers.length) {
    throw new Error(
      `direct_motion_scene_plan_blocked:${scenePlan.blockers.join(",")}:` +
        scenePlanBlockerDiagnostic(scenePlan, { targetDurationS: durationS }),
    );
  }
  const assPath = path.join(proofOut, `${story.id || "story"}_studio_v4_proof.ass`);
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
  const rawAss = buildPremiumKineticAss({
    story,
    words,
    duration: durationS,
    scriptText,
  });
  const captionCardSafeZone = repositionAssCaptionsForCardWindows(
    rawAss,
    scenePlan.cardVisibleWindows,
  );
  if (captionCardSafeZone.verdict !== "pass") {
    throw new Error(
      `caption_card_safe_zone_blocked:${captionCardSafeZone.blockers.join(",")}`,
    );
  }
  const ass = captionCardSafeZone.ass;
  const captionCadence = inspectPremiumCaptionCadence(ass);
  if (captionCadence.status !== "pass") {
    throw new Error(`kinetic_typography_gate_blocked:${captionCadence.blockers.join(",")}`);
  }
  await fs.ensureDir(proofOut);
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
  const soundscapeMix = await resolveStorySoundscapeMix(story, { durationS });
  const soundscapePath = soundscapeMix.asset?.path || "";
  const hasSoundscape =
    soundscapePath && (await fs.pathExists(soundscapePath));
  const soundscapeIdx = hasSoundscape
    ? ffmpegArgs.filter((item) => item === "-i").length
    : -1;
  if (hasSoundscape) {
    ffmpegArgs.push(
      "-stream_loop",
      "-1",
      "-t",
      (durationS + 1).toFixed(2),
      "-i",
      soundscapePath,
    );
  }
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
  const creativeTransitionSequence = buildCreativeTransitionSequence(
    story,
    Math.max(0, scenePlan.scenes.length - 1),
  );
  for (const scene of scenePlan.scenes) {
    filterParts.push(...buildSceneCompositeFilterParts(scene, livingMotion));
  }
  let prev = "v0";
  for (let i = 1; i < scenePlan.scenes.length; i++) {
    const out = i === scenePlan.scenes.length - 1 ? "base" : `xf${i}`;
    const offset = (Array.isArray(scenePlan.transitionOffsets) ? scenePlan.transitionOffsets : [])[i - 1] ??
      i * (scenePlan.segmentDurationS - scenePlan.xfadeS);
    filterParts.push(
      `[${prev}][v${i}]xfade=transition=${creativeTransitionSequence[i - 1] || "fade"}:duration=${scenePlan.xfadeS}:offset=${offset.toFixed(2)}[${out}]`,
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
  const voiceSidechainLabels = [];
  if (hasMusic) voiceSidechainLabels.push("a_voice_music_sc");
  if (hasSoundscape) voiceSidechainLabels.push("a_voice_soundscape_sc");
  if (voiceSidechainLabels.length) {
    audioMixInputs.push(
      `[${voiceIdx}:a]asplit=${voiceSidechainLabels.length + 1}[a_voice_in]${voiceSidechainLabels
        .map((label) => `[${label}]`)
        .join("")}`,
    );
    audioMixInputs.push(
      `[a_voice_in]highpass=f=70,volume=0.86,acompressor=threshold=-30dB:ratio=5.5:attack=4:release=260:makeup=1,alimiter=limit=0.68:level=disabled,loudnorm=I=-17:TP=-2.5:LRA=5[a_voice]`,
    );
  } else {
    audioMixInputs.push(
      `[${voiceIdx}:a]highpass=f=70,volume=0.86,acompressor=threshold=-30dB:ratio=5.5:attack=4:release=260:makeup=1,alimiter=limit=0.68:level=disabled,loudnorm=I=-17:TP=-2.5:LRA=5[a_voice]`,
    );
  }
  if (hasMusic) {
    audioMixInputs.push(
      `[${musicIdx}:a]volume=${MUSIC_MIX_POLICY.raw_bed_volume.toFixed(3)},atrim=duration=${durationS.toFixed(3)}[a_music_raw]`,
    );
    audioMixInputs.push(
      `[a_music_raw][a_voice_music_sc]sidechaincompress=threshold=${MUSIC_MIX_POLICY.sidechain_threshold}:ratio=${MUSIC_MIX_POLICY.sidechain_ratio}:attack=${MUSIC_MIX_POLICY.sidechain_attack_ms}:release=${MUSIC_MIX_POLICY.sidechain_release_ms}:knee=3:level_sc=1,volume=${MUSIC_MIX_POLICY.ducked_bed_output_volume.toFixed(3)}[a_music_ducked]`,
    );
    audioMixInputs.push(
      ...bedDropoutFilterChain({
        inputLabel: "a_music_ducked",
        outputLabel: "a_music",
        microDropWindows: soundscapeMix.arc.micro_drop_windows,
      }),
    );
    mixLabels.push("[a_music]");
  }
  if (hasSoundscape) {
    audioMixInputs.push(
      ...buildCinematicBedFilters({
        inputIndex: soundscapeIdx,
        voiceSidechainLabel: "a_voice_soundscape_sc",
        outputLabel: "a_soundscape",
        durationS,
        microDropWindows: soundscapeMix.arc.micro_drop_windows,
        policy: soundscapeMix.policy,
      }),
    );
    mixLabels.push("[a_soundscape]");
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

  const filterPath = path.join(proofOut, `${story.id || "story"}_studio_v4_proof_filter.txt`);
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
  );

  const outputTransaction = await materializeVerifiedProofOutput({
    outputPath,
    renderTemporary: async (temporaryPath) => {
      execFileSync("ffmpeg", [...ffmpegArgs, temporaryPath], {
        cwd: ROOT,
        stdio: "inherit",
      });
    },
    verifyTemporary: (temporaryPath) => verifyRenderedProofMedia(temporaryPath, {
      expectedDurationS: durationS,
    }),
  });

  const renderedMediaIntegrity = outputTransaction.verification;
  const finalDuration = ffprobeDuration(outputPath);
  const decodedReadableCardWindows = [
    ...scenePlan.cardVisibleWindows,
    ...overlayCardWindowsForStory(story, { durationS }),
  ];
  const decodedVisualGate = await runDecodedVisualGate({
    storyId: story.id || "story",
    mp4Path: outputPath,
    outputDir: path.join(path.dirname(outputPath), "qa", "decoded-visual"),
    frameIntervalS: 1,
    subtitlePath: assPath,
    renderReport: {
      sceneList: scenePlan.scenes.map((scene) => ({
        ...scene,
        duration: scene.durationS,
        type: scene.type || scene.sceneType,
      })),
      card_visible_windows: decodedReadableCardWindows,
    },
  });
  if (decodedVisualGate.status !== "pass") {
    throw new Error(
      `decoded_visual_gate_blocked:${decodedVisualGate.blockers.join(",")}`,
    );
  }
  const audioSegmentLoudness = assertProofAudioSegmentLoudness(await auditRenderedAudioSegments({
    storyId: story.id || null,
    inputPath: outputPath,
    durationS: finalDuration || durationS,
  }));
  const audioSegmentReportPath = path.join(
    proofOut,
    `${story.id || "story"}_audio_segment_loudness_report.json`,
  );
  await fs.writeJson(audioSegmentReportPath, audioSegmentLoudness, { spaces: 2 });
  const stat = await fs.stat(outputPath);
  const freshHyperframesPremiumShellGate = resolveFreshHyperframesPremiumShellGate({
    selectedCards: premiumSceneSelection.selected_cards,
    fallbackGate: story.hyperframes_premium_shell_gate || {},
  });
  const selectedInputAssets = buildSelectedInputAssetEvidence({
    story,
    audioPath,
    selectedClips: premiumSceneSelection.clips,
    scenePlan,
    musicCueMix,
    sfxCueMix,
    soundscapeMix,
  });
  const report = {
    story_id: story.id || null,
    title: story.title || null,
    output: path.relative(ROOT, outputPath).replace(/\\/g, "/"),
    proof_output_dir: path.relative(ROOT, proofOut).replace(/\\/g, "/"),
    ass: path.relative(ROOT, assPath).replace(/\\/g, "/"),
    filter: path.relative(ROOT, filterPath).replace(/\\/g, "/"),
    clips: scenePlan.scenes.length,
    rendered_media_integrity: renderedMediaIntegrity,
    professional_source_diversity: professionalSourceDiversity,
    clip_scene_plan: {
      repeat_free: scenePlan.repeatFree,
      covered_duration_s: scenePlan.coveredDurationS,
      transition_offsets: scenePlan.transitionOffsets,
      repeated_base_sources: scenePlan.repeatedBaseSources,
      skipped_duplicate_base_sources: scenePlan.skippedDuplicateBaseSources,
      source_duration_overruns: scenePlan.sourceDurationOverruns,
      professional_source_diversity: professionalSourceDiversity,
      premium_edit_rhythm: scenePlan.premiumEditRhythm,
      premium_scene_selection: {
        version: premiumSceneSelection.version,
        selected_cards: premiumSceneSelection.selected_cards,
        skipped_cards: premiumSceneSelection.skipped_cards,
        clip_count: premiumSceneSelection.clips.length,
        discovered_story_cards: hyperframesCardDiscovery.accepted_cards,
        rejected_story_cards: hyperframesCardDiscovery.rejected_cards,
        discovery_skipped_reason: hyperframesCardDiscovery.skipped_reason,
      },
      direct_motion_visual_selection: {
        version: DIRECT_MOTION_VISUAL_SELECTOR_V5.version,
        accepted_count: directMotionVisualSelection.accepted.length,
        rejected_count: directMotionVisualSelection.rejected.length,
        rejected: directMotionVisualSelection.rejected.map((clip) => ({
          path: clip.path,
          reasons: clip.reasons,
          metrics: clip.metrics,
        })),
      },
      sibling_motion_manifest: path.relative(ROOT, siblingMotionManifestPath).replace(/\\/g, "/"),
      transition_sequence: creativeTransitionSequence,
      scenes: scenePlan.scenes,
    },
    audio_duration_s: Number(durationS.toFixed(3)),
    rendered_duration_s: Number(finalDuration.toFixed(3)),
    size_bytes: stat.size,
    sfx_mix_policy_version: STUDIO_V4_SFX_MIX_POLICY_VERSION,
    voice_mix_policy_version: STUDIO_V4_VOICE_MIX_POLICY_VERSION,
    visual_design_policy_version: STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
    creative_system_version: CREATIVE_SYSTEM_VERSION,
    creative_identity: resolvePulseVisualIdentity(story),
    decoded_visual_gate: decodedVisualGate,
    kinetic_typography_version: KINETIC_TYPOGRAPHY_V5.version,
    kinetic_typography_gate: captionCadence,
    caption_card_safe_zone: {
      ...captionCardSafeZone,
      ass: undefined,
    },
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
    hyperframes_premium_shell_gate: freshHyperframesPremiumShellGate,
    story_package_hyperframes_premium_shell_gate: story.hyperframes_premium_shell_gate || {},
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
      path: relativeReportPath(cue.path),
      delayMs: cue.delayMs,
      landsAtMs: cue.landsAtMs ?? cue.delayMs,
      preLapped: cue.preLapped === true,
      volume: cue.volume,
      durationS: cue.durationS,
    })),
    cinematic_audio_arc_version: CINEMATIC_AUDIO_ARC_VERSION,
    cinematic_audio_arc: {
      ...soundscapeMix.arc,
      soundscape: soundscapeMix.asset
        ? {
            asset_id: soundscapeMix.asset.asset_id || null,
            role: soundscapeMix.asset.role || null,
            provider_id: soundscapeMix.asset.provider_id || null,
            path: relativeReportPath(soundscapeMix.asset.path),
            secondary_layer_only: true,
          }
        : null,
    },
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
    selected_input_assets: selectedInputAssets,
    caption_timestamp_source: timestampValidation.word_timestamp_source,
    caption_timing_strict: timestampValidation.local_timing_strict,
    audio_segment_loudness_report: relativeReportPath(audioSegmentReportPath),
    audio_segment_loudness_verdict: audioSegmentLoudness.verdict,
    audio_segment_loudness_metrics: audioSegmentLoudness.metrics || {},
    local_only: true,
    no_publish_side_effects: true,
    no_db_mutation: true,
  };
  await fs.writeJson(path.join(proofOut, `${story.id || "story"}_studio_v4_proof_report.json`), report, {
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
  resolveProofOutputDir,
  buildOverlayLayout,
  buildClipScenePlan,
  scenePlanBlockerDiagnostic,
  buildSceneCompositeFilterParts,
  buildOverlayChain,
  buildMediaAttributionFilterParts,
  repositionAssCaptionsForCardWindows,
  buildCreativeTransitionSequence,
  mergeMaterialisedMotionClipCandidates,
  isVerifiedOwnedMaterialisedMotionClip,
  validateVerifiedOwnedMaterialisedMotionClipEvidence,
  hydrateProofClipSourceIdentities,
  selectBalancedProfessionalMotionCandidates,
  mergeCurrentHyperframesStoryCardCandidates,
  selectPremiumSceneClips,
  resolveFreshHyperframesPremiumShellGate,
  buildProfessionalSourceDiversityProof,
  overlayCardWindowsForStory,
  buildFinalSocialAudioMixFilter,
  drawtextEscape,
  renderNarrationScriptText,
  resolveReadableMediaPath,
  resolveStoryMusicCueMix,
  resolveStorySfxCueMix,
  resolveStorySfxPaths,
  resolveStorySoundscapeMix,
  directClipMaxScenes,
  directClipMaxVisibleDwellS,
  sfxPathForAsset,
  subtitleWordsFromTimestampPayload,
  validateProofTimestampPayload,
  assertProofAudioSegmentLoudness,
  verifyRenderedProofMedia,
  materializeVerifiedProofOutput,
  buildSelectedInputAssetEvidence,
  renderProof,
};
