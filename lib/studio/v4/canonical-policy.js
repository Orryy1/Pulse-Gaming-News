"use strict";

const path = require("node:path");

const { buildAssetAcquisitionPlan } = require("../../asset-acquisition-pro");
const { buildMotionAcquisitionPlan } = require("../../motion-acquisition-pro");
const { runMediaHouseBenchmark } = require("../../media-house-benchmark");
const { buildFootageEmpirePlan } = require("./footage-empire");
const { buildVisualV4DirectorPlan } = require("./director-brain");

const READY = "ready_for_studio_v4_render";
const HOLD_MOTION = "hold_for_motion_acquisition";
const HOLD_BENCHMARK = "hold_for_premium_benchmark";

function envFlag(env = {}, name, fallback = false) {
  const raw = env?.[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return /^(true|1|yes|on)$/i.test(String(raw).trim());
}

function envExplicitFalse(env = {}, name) {
  return /^(false|0|no|off)$/i.test(String(env?.[name] || "").trim());
}

function resolveStudioV4Policy(env = process.env) {
  return {
    enabled: !envExplicitFalse(env, "STUDIO_V4_CANONICAL"),
    requirePremiumPublish: !envExplicitFalse(
      env,
      "STUDIO_V4_PREMIUM_PUBLISH_GATE",
    ),
    allowEmergencyLegacyFallback:
      envFlag(env, "STUDIO_V4_ALLOW_LEGACY_FALLBACK") ||
      envFlag(env, "ALLOW_EMERGENCY_RENDER_FALLBACK"),
  };
}

function parseArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [parsed];
      } catch {
        return [];
      }
    }
    return [trimmed];
  }
  if (typeof value === "object") return [value];
  return [];
}

function sourceFamilyFromPath(value) {
  const base = path.basename(String(value || ""), path.extname(String(value || "")));
  return (
    base
      .replace(/[_-]?(?:clip|video|trailer|shot|slice|window)\d*$/i, "")
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase() || "local"
  );
}

function normaliseLocalMotionClip(raw, index = 0) {
  if (typeof raw === "string") {
    return {
      id: `local_clip_${index + 1}`,
      source_family: sourceFamilyFromPath(raw),
      path: raw,
      durationS: null,
      validated: true,
      rights_risk_class: "local_reference_unknown",
    };
  }
  const clip = raw && typeof raw === "object" ? raw : {};
  const clipPath =
    clip.path || clip.local_path || clip.source || clip.file || clip.source_url || "";
  return {
    ...clip,
    id: String(clip.id || clip.clip_id || `local_clip_${index + 1}`),
    source_family:
      String(
        clip.source_family ||
          clip.trusted_footage_source_id ||
          clip.source_id ||
          clip.provider ||
          sourceFamilyFromPath(clipPath),
      ).trim() || "local",
    path: String(clipPath || "").trim(),
    durationS:
      Number(clip.durationS ?? clip.duration_s ?? clip.duration) || null,
    validated: clip.validated !== false,
    rights_risk_class:
      clip.rights_risk_class ||
      clip.rights_status ||
      clip.licence_scope ||
      "official_reference_only",
  };
}

function localMotionClipsForStory(story = {}) {
  const motionPack = story.visual_v4_motion_pack || {};
  const raw = [
    ...parseArray(motionPack.handoff?.visual_v4_local_motion_clips),
    ...parseArray(motionPack.clips),
    ...parseArray(story.visual_v4_local_motion_clips),
    ...parseArray(story.local_motion_clips),
    ...parseArray(story.motion_clips),
    ...parseArray(story.video_clips),
    ...parseArray(story.downloaded_videos),
  ];
  const seen = new Set();
  const clips = [];
  for (const item of raw) {
    const clip = normaliseLocalMotionClip(item, clips.length);
    const key = `${clip.path}|${clip.source_family}|${clip.id}`;
    if (!clip.path || seen.has(key)) continue;
    seen.add(key);
    clips.push(clip);
  }
  return clips;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map((value) => String(value)))];
}

function canonicalSubjectFromTrustedReport(report = {}, story = {}) {
  if (story.canonical_subject || story.canonical_game || story.game_title) {
    return story.canonical_subject || story.canonical_game || story.game_title;
  }
  const storyId = String(story.id || "");
  const candidates = [
    ...parseArray(report.story_candidates),
    ...parseArray(report.accepted_sources),
  ];
  const match = candidates.find((candidate) => {
    const candidateStoryId = String(candidate.story_id || "");
    return (!storyId || !candidateStoryId || candidateStoryId === storyId) && candidate.entity;
  });
  return match?.entity || null;
}

function safeBuild(label, fn) {
  try {
    return { value: fn(), error: null };
  } catch (err) {
    return {
      value: null,
      error: `${label}:${err.code || err.message || "failed"}`,
    };
  }
}

function buildStudioV4CanonicalPacket({
  story = {},
  trustedFootageReport = {},
  localTimeline = {},
  retentionIntelligence = {},
  localMotionClips,
  generatedAt = new Date().toISOString(),
} = {}) {
  const canonicalSubject = canonicalSubjectFromTrustedReport(
    trustedFootageReport,
    story,
  );
  const storyForPlanning = canonicalSubject
    ? {
        ...story,
        canonical_subject: story.canonical_subject || canonicalSubject,
        canonical_game: story.canonical_game || canonicalSubject,
      }
    : story;
  const motionClips =
    localMotionClips !== undefined
      ? parseArray(localMotionClips).map(normaliseLocalMotionClip)
      : localMotionClipsForStory(storyForPlanning);

  const acquisition = safeBuild("asset_acquisition_plan", () =>
    buildAssetAcquisitionPlan(storyForPlanning, {
      executionMode: "studio_v4_pre_render_plan",
    }),
  );
  const motionAcquisition = safeBuild("motion_acquisition_plan", () =>
    buildMotionAcquisitionPlan(storyForPlanning, {
      executionMode: "studio_v4_motion_pre_render_plan",
    }),
  );
  const footagePlan = buildFootageEmpirePlan({
    story: storyForPlanning,
    trustedFootageReport,
    localMotionClips: motionClips,
    generatedAt,
  });
  const directorPlan = buildVisualV4DirectorPlan({
    story: storyForPlanning,
    footagePlan,
    localTimeline,
    retentionIntelligence,
    generatedAt,
  });
  const benchmarkStory = {
    ...storyForPlanning,
    video_clips: motionClips,
    visual_v4_director_plan: directorPlan,
  };
  const benchmark = runMediaHouseBenchmark({
    story: benchmarkStory,
    directorPlan,
    requireGate: true,
  });

  const motionBlockers = unique([
    ...parseArray(footagePlan.readiness?.blockers),
    ...parseArray(directorPlan.readiness?.blockers),
    acquisition.error,
    motionAcquisition.error,
  ]);
  const benchmarkBlockers = benchmark.result === "pass" ? [] : benchmark.failures;
  const blockers = unique([...motionBlockers, ...benchmarkBlockers]);
  const status = motionBlockers.length
    ? HOLD_MOTION
    : benchmarkBlockers.length
      ? HOLD_BENCHMARK
      : READY;

  return {
    schema_version: 1,
    generated_at: generatedAt,
    execution_mode: "studio_v4_canonical_policy",
    local_only: true,
    story_id: story.id || null,
    title: story.title || null,
    canonical_subject: canonicalSubject || null,
    readiness: {
      status,
      ready: status === READY,
      blockers,
      warnings: unique([
        ...parseArray(footagePlan.readiness?.warnings),
        ...parseArray(directorPlan.readiness?.warnings),
        ...benchmark.warnings,
      ]),
    },
    policy: resolveStudioV4Policy(),
    local_motion_clip_count: motionClips.length,
    local_motion_clips: motionClips,
    visual_v4_motion_pack: storyForPlanning.visual_v4_motion_pack || null,
    asset_acquisition_plan: acquisition.value,
    motion_acquisition_plan: motionAcquisition.value,
    footage_plan: footagePlan,
    director_plan: directorPlan,
    media_house_benchmark: benchmark,
    next_actions: unique([
      ...parseArray(footagePlan.next_actions).map((item) => item.id || item.label),
      ...(motionAcquisition.value?.planned_actions || []).map(
        (item) => item.type || item.reason,
      ),
    ]),
    safety: {
      local_only: true,
      planner_only: true,
      video_downloads_started: false,
      browser_scraping_started: false,
      yt_dlp_started: false,
      oauth_triggered: false,
      production_db_mutated: false,
      social_posting_triggered: false,
    },
  };
}

function shouldHoldLegacyRender(
  story = {},
  packet = {},
  policy = resolveStudioV4Policy(),
) {
  if (!policy.enabled) return false;
  if (story.allow_legacy_render_emergency === true) return false;
  if (policy.allowEmergencyLegacyFallback) return false;
  return packet?.readiness?.status !== READY;
}

function applyStudioV4PacketToStory(story = {}, packet = {}) {
  story.render_engine = "studio_v4";
  story.studio_v4_canonical_enabled = true;
  story.require_studio_v4_premium_publish = true;
  story.studio_v4_readiness_status = packet.readiness?.status || "unknown";
  story.studio_v4_readiness_blockers = packet.readiness?.blockers || [];
  story.studio_v4_next_actions = packet.next_actions || [];
  story.visual_v4_footage_plan = packet.footage_plan || null;
  story.visual_v4_motion_pack = packet.visual_v4_motion_pack || story.visual_v4_motion_pack || null;
  story.visual_v4_director_plan = packet.director_plan || null;
  story.visual_v4_motion_acquisition_plan = packet.motion_acquisition_plan || null;
  story.studio_v4_asset_acquisition_plan = packet.asset_acquisition_plan || null;
  story.media_house_benchmark = packet.media_house_benchmark || null;
  story.reference_pack_used = packet.media_house_benchmark?.reference_pack_used || [];
  story.media_house_polish_score =
    packet.media_house_benchmark?.scores?.media_house_polish_score ?? null;

  if (packet.readiness?.status && packet.readiness.status !== READY) {
    const first = packet.readiness.blockers?.[0] || "not_ready";
    const prefix =
      packet.readiness.status === HOLD_MOTION
        ? "studio_v4_motion_acquisition_pending"
        : "studio_v4_premium_benchmark_pending";
    story.render_fallback_reason = `${prefix}:${first}`;
    story.render_fallback_at = packet.generated_at || new Date().toISOString();
  }

  return story;
}

module.exports = {
  READY,
  HOLD_MOTION,
  HOLD_BENCHMARK,
  resolveStudioV4Policy,
  localMotionClipsForStory,
  buildStudioV4CanonicalPacket,
  shouldHoldLegacyRender,
  applyStudioV4PacketToStory,
};
