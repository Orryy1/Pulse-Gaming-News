"use strict";

const { mediaSourceUrlKindFields } = require("../../media-source-url-kind");
const { isSafeOutboundUrl } = require("../../safe-url");

const DEFAULT_RIGHTS_PLATFORMS = ["youtube", "tiktok", "instagram", "facebook"];

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normaliseFamily(value) {
  return (
    cleanText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || null
  );
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function canonicalPacketFor(story = {}, options = {}) {
  if (options.canonicalPacket && typeof options.canonicalPacket === "object") {
    return options.canonicalPacket;
  }
  return (
    story.studio_v4_canonical_packet ||
    story.visual_v4_canonical_packet ||
    story._extra?.studio_v4_canonical_packet ||
    asObject(story.studio_v4_canonical_packet) ||
    asObject(story.visual_v4_canonical_packet) ||
    asObject(story._extra?.studio_v4_canonical_packet)
  );
}

function directorPlanFor(packet = {}, story = {}) {
  return (
    packet.director_plan ||
    packet.visual_v4_director_plan ||
    story.visual_v4_director_plan ||
    story.director_plan ||
    asObject(packet.director_plan) ||
    asObject(packet.visual_v4_director_plan) ||
    asObject(story.visual_v4_director_plan) ||
    asObject(story.director_plan)
  );
}

function motionPackFor(story = {}, options = {}) {
  if (options.motionPack && typeof options.motionPack === "object") {
    return options.motionPack;
  }
  return (
    story.visual_v4_motion_pack ||
    story._extra?.visual_v4_motion_pack ||
    asObject(story.visual_v4_motion_pack) ||
    asObject(story._extra?.visual_v4_motion_pack)
  );
}

function clipListFor(story = {}, motionPack = {}) {
  return [
    ...asArray(story.visual_v4_local_motion_clips),
    ...asArray(motionPack.handoff?.visual_v4_local_motion_clips),
    ...asArray(motionPack.clips),
  ];
}

function familyFor(value = {}) {
  return (
    normaliseFamily(value.source_family) ||
    normaliseFamily(value.sourceFamily) ||
    normaliseFamily(value.family) ||
    normaliseFamily(value.id) ||
    null
  );
}

function pathForClip(clip = {}, shot = {}) {
  return cleanText(shot.media_path || shot.path || clip.path || clip.source_url);
}

function sourceUrlForClip(clip = {}) {
  return cleanText(
    clip.source_url ||
      clip.original_source_url ||
      clip.reference_url ||
      clip.official_source_url ||
      clip.direct_media_url_if_available ||
      "",
  );
}

function riskScoreForRightsClass(value) {
  const text = cleanText(value).toLowerCase();
  if (text.includes("owned") || text.includes("local_tts") || text.includes("generated")) return 0.05;
  if (text.includes("licensed")) return 0.12;
  if (text.includes("official") || text.includes("steam")) return 0.18;
  if (text.includes("editorial")) return 0.24;
  return 0.24;
}

function mergeRightsLedger(existing = [], incoming = []) {
  const out = [];
  const seen = new Set();
  for (const record of [...asArray(existing), ...asArray(incoming)]) {
    if (!record || typeof record !== "object") continue;
    const key = [
      cleanText(record.asset_id || record.id),
      cleanText(record.path || record.local_path),
      sourceUrlForClip(record),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }
  return out;
}

function isSafeDirectMediaUrl(value) {
  const text = cleanText(value);
  if (!/^https?:\/\//i.test(text)) return false;
  if (!isSafeOutboundUrl(text)) return false;
  const kind = mediaSourceUrlKindFields(text);
  return kind.segment_validation_eligible === true;
}

function isReadyPacket(packet = {}) {
  const status = cleanText(packet.readiness?.status);
  return status === "ready_for_studio_v4_render" || status === "studio_v4_ready";
}

function buildClipIndex(clips = []) {
  const byFamily = new Map();
  const byId = new Map();
  for (const clip of asArray(clips)) {
    const family = familyFor(clip);
    const id = cleanText(clip.id || clip.clip_id);
    if (id && !byId.has(id)) byId.set(id, clip);
    if (!family || byFamily.has(family)) continue;
    byFamily.set(family, clip);
  }
  return { byFamily, byId };
}

function clipFromShot({ shot, clip, index }) {
  const family = familyFor(shot) || familyFor(clip);
  const duration = numberOrNull(shot.durationS ?? shot.duration_s) ??
    numberOrNull(clip.durationS ?? clip.duration_s);
  const mediaStart =
    numberOrNull(clip.mediaStartS ?? clip.media_start_s) ??
    numberOrNull(shot.mediaStartS ?? shot.media_start_s);
  return {
    id: cleanText(shot.id || clip.id || `v4_bridge_clip_${index + 1}`),
    type: "motion_clip",
    source_family: family,
    path: pathForClip(clip, shot),
    source_url: sourceUrlForClip(clip),
    source_type: cleanText(clip.source_type || clip.source_kind || "official_reference_clip"),
    licence_basis: cleanText(clip.licence_basis || clip.license_basis || clip.licence_scope || ""),
    mediaStartS: mediaStart,
    durationS: duration,
    timelineStartS: numberOrNull(shot.startS ?? shot.start_s),
    target_kind: shot.kind || "motion_clip",
    rights_risk_class: clip.rights_risk_class || shot.rights_risk_class || null,
    provenance: {
      source: "studio_v4_render_bridge",
      director_shot_id: shot.id || null,
      motion_pack_clip_id: clip.id || null,
    },
  };
}

function buildStudioV4BridgeRightsLedger({
  story = {},
  bridge = {},
  evidenceFile = "",
  platforms = DEFAULT_RIGHTS_PLATFORMS,
} = {}) {
  const allowedPlatforms = asArray(platforms).map((platform) =>
    cleanText(platform).toLowerCase(),
  ).filter(Boolean);
  const records = [];

  for (const [index, clip] of asArray(bridge.video_clips).entries()) {
    const path = cleanText(clip.path || clip.local_path || "");
    const sourceUrl = sourceUrlForClip(clip);
    if (!path && !sourceUrl) continue;
    const rightsClass = cleanText(clip.rights_risk_class || clip.rights_status || "");
    records.push({
      asset_id: cleanText(clip.asset_id || clip.id || clip.clip_id) ||
        `studio_v4_motion_${index + 1}`,
      path,
      source_url: sourceUrl,
      source_type: cleanText(clip.source_type || clip.source_kind || "official_reference_clip"),
      licence_basis: cleanText(clip.licence_basis || clip.license_basis || clip.licence_scope) ||
        "official_reference_transformative_short",
      allowed_platforms: allowedPlatforms,
      expiry: clip.expiry || clip.expires_at || null,
      credit_required: clip.credit_required === true,
      commercial_use_allowed: clip.commercial_use_allowed !== false,
      risk_score: Number.isFinite(Number(clip.risk_score))
        ? Number(clip.risk_score)
        : riskScoreForRightsClass(rightsClass),
      evidence_file: cleanText(clip.evidence_file || evidenceFile),
      rights_risk_class: rightsClass,
      source_family: cleanText(clip.source_family || clip.trusted_footage_source_id || ""),
    });
  }

  if (story.audio_path) {
    records.push({
      asset_id: `${cleanText(story.id || "story")}_audio_path`,
      path: cleanText(story.audio_path),
      source_url: cleanText(story.audio_source_url || "local://tts/local-voice"),
      source_type: cleanText(story.audio_source_type || "local_tts_voice"),
      licence_basis: cleanText(story.audio_licence_basis || "owned_local_voice_model"),
      allowed_platforms: allowedPlatforms,
      expiry: null,
      credit_required: false,
      commercial_use_allowed: true,
      risk_score: Number.isFinite(Number(story.audio_rights_risk_score))
        ? Number(story.audio_rights_risk_score)
        : 0.05,
      evidence_file: cleanText(story.audio_rights_evidence_file || ""),
    });
  }

  return mergeRightsLedger([], records);
}

function buildStudioV4RenderBridge({
  story = {},
  canonicalPacket = null,
  motionPack = null,
  pathExists = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const packet = canonicalPacketFor(story, { canonicalPacket });
  const resolvedMotionPack = motionPackFor(story, { motionPack });
  const directorPlan = directorPlanFor(packet, story);
  const blockers = [];
  const rejected = [];

  if (!isReadyPacket(packet)) blockers.push("canonical_packet_not_ready");
  const shots = asArray(directorPlan.shot_plan || directorPlan.shots);
  if (!shots.length) blockers.push("director_shot_plan_missing");
  const motionClips = clipListFor(story, resolvedMotionPack);
  if (!motionClips.length) blockers.push("motion_pack_clips_missing");

  if (blockers.length) {
    return {
      schema_version: 1,
      generated_at: generatedAt,
      execution_mode: "studio_v4_render_bridge",
      local_only: true,
      readiness: {
        status: "bridge_blocked",
        blockers,
        warnings: [],
      },
      video_clips: [],
      rejected,
      safety: {
        no_downloads_started: true,
        no_browser_scraping_started: true,
        no_yt_dlp_started: true,
        no_publish_side_effects: true,
        no_db_mutation: true,
      },
    };
  }

  const clipIndex = buildClipIndex(motionClips);
  const usedFamilies = new Set();
  const usedClipIds = new Set();
  const out = [];

  for (const shot of shots.filter((item) => item?.kind === "motion_clip")) {
    const family = familyFor(shot);
    const explicitClipId = cleanText(
      shot.motion_pack_clip_id || shot.clip_id || shot.motionPackClipId,
    );
    const clip = explicitClipId
      ? clipIndex.byId.get(explicitClipId)
      : family
        ? clipIndex.byFamily.get(family)
        : null;
    if (!family) {
      rejected.push({ id: shot.id || null, reason: "source_family_missing" });
      continue;
    }
    if (!clip) {
      rejected.push({ id: shot.id || null, source_family: family, reason: "clip_not_in_motion_pack" });
      continue;
    }
    const clipId = cleanText(clip.id || clip.clip_id);
    if (explicitClipId && clipId && usedClipIds.has(clipId)) {
      rejected.push({ id: shot.id || null, source_family: family, reason: "duplicate_motion_clip" });
      continue;
    }
    if (!explicitClipId && usedFamilies.has(family)) {
      rejected.push({ id: shot.id || null, source_family: family, reason: "duplicate_source_family" });
      continue;
    }
    const bridged = clipFromShot({ shot, clip, index: out.length });
    if (!bridged.path) {
      rejected.push({ id: shot.id || null, source_family: family, reason: "clip_path_missing" });
      continue;
    }
    if (
      typeof pathExists === "function" &&
      !isSafeDirectMediaUrl(bridged.path) &&
      !pathExists(bridged.path)
    ) {
      rejected.push({
        id: shot.id || null,
        source_family: family,
        path: bridged.path,
        reason: "clip_path_missing",
      });
      continue;
    }
    out.push(bridged);
    usedFamilies.add(family);
    if (clipId) usedClipIds.add(clipId);
  }

  return {
    schema_version: 1,
    generated_at: generatedAt,
    execution_mode: "studio_v4_render_bridge",
    local_only: true,
    readiness: {
      status: out.length ? "bridge_ready" : "bridge_blocked",
      blockers: out.length ? [] : ["no_bridgeable_motion_clips"],
      warnings: rejected.length ? ["some_director_motion_shots_rejected"] : [],
    },
    director_shots_seen: shots.length,
    video_clips: out,
    rejected,
    safety: {
      no_downloads_started: true,
      no_browser_scraping_started: true,
      no_yt_dlp_started: true,
      no_publish_side_effects: true,
      no_db_mutation: true,
    },
  };
}

function applyStudioV4RenderBridgeToStory(story = {}, bridge = {}) {
  story.visual_v4_render_bridge = bridge;
  story.visual_v4_render_bridge_status = bridge.readiness?.status || "unknown";
  story.visual_v4_render_bridge_clip_count = asArray(bridge.video_clips).length;
  if (bridge.readiness?.status === "bridge_ready") {
    story.video_clips = asArray(bridge.video_clips).map((clip) => clip.path).filter(Boolean);
    story.render_lane = "studio_v4_director_bridge";
    story.visual_v4_bridge_video_clips = bridge.video_clips;
    story.rights_ledger = mergeRightsLedger(
      story.rights_ledger,
      buildStudioV4BridgeRightsLedger({ story, bridge }),
    );
  }
  return story;
}

module.exports = {
  buildStudioV4RenderBridge,
  buildStudioV4BridgeRightsLedger,
  applyStudioV4RenderBridgeToStory,
};
