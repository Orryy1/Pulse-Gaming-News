"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const { ffprobeDuration } = require("./studio/media-acquisition");
const {
  PROFESSIONAL_MOTION_SOURCE_POLICY,
  assessProfessionalSourceDiversity,
  canonicaliseMotionSourceUrl,
} = require("./studio/motion-source-identity");
const {
  inspectDirectMotionClip,
} = require("./studio/v5/direct-motion-visual-selector");
const {
  fingerprintVideoClip,
  compareVideoFingerprints,
} = require("./video-visual-fingerprint");

const FLAGSHIP_MOTION_PLAN_POLICY = Object.freeze({
  version: "pulse_flagship_motion_plan_v1",
  minimum_direct_motion_scenes: 8,
  minimum_genuine_base_sources: 3,
  maximum_scenes_per_source: PROFESSIONAL_MOTION_SOURCE_POLICY.max_scenes_per_source,
  maximum_source_share: PROFESSIONAL_MOTION_SOURCE_POLICY.max_source_share,
  maximum_direct_scene_duration_s: 5,
  maximum_generated_card_ratio: 0.2,
  maximum_source_cards: 1,
  duration_tolerance_s: 0.15,
  overlap_tolerance_s: 0.1,
  minimum_render_transition_s: 0.04,
  render_transition_headroom_s: 0.08,
});

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function fileEvidence(filePath, label, { minBytes = 1 } = {}) {
  const resolved = path.resolve(clean(filePath));
  if (!resolved || !(await fs.pathExists(resolved))) throw new Error(`missing_file:${label}`);
  const before = await fs.stat(resolved);
  if (!before.isFile() || before.size < minBytes) throw new Error(`unusable_file:${label}`);
  const bytes = await fs.readFile(resolved);
  const after = await fs.stat(resolved);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== after.size) {
    throw new Error(`file_changed_during_validation:${label}`);
  }
  return {
    path: resolved,
    sha256: sha256Bytes(bytes),
    size_bytes: after.size,
    mtime_ms: after.mtimeMs,
    bytes,
  };
}

async function readJsonEvidence(filePath, label) {
  const evidence = await fileEvidence(filePath, label);
  let value;
  try {
    value = JSON.parse(evidence.bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`invalid_json:${label}:${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid_json_object:${label}`);
  }
  delete evidence.bytes;
  return { value, evidence };
}

function youtubeVideoIdFromUrl(value) {
  try {
    const parsed = new URL(clean(value));
    const host = parsed.hostname.toLowerCase().replace(/^(?:www\.|m\.)/, "");
    if (host === "youtu.be") return clean(parsed.pathname.split("/").filter(Boolean)[0]);
    if (host !== "youtube.com" && host !== "youtube-nocookie.com") return "";
    return clean(
      parsed.searchParams.get("v") ||
        parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/i)?.[1],
    );
  } catch {
    return "";
  }
}

function isGeneratedCard(scene) {
  return clean(scene?.kind).toLowerCase() === "generated_card";
}

function isDirectMotion(scene) {
  return clean(scene?.kind).toLowerCase() === "direct_motion";
}

function sourceIdentityRows(provenance = {}) {
  if (clean(provenance.kind) === "source_identity_evidence_bundle") {
    return Array.isArray(provenance.sources) ? provenance.sources : [];
  }
  return provenance && typeof provenance === "object" ? [provenance] : [];
}

function adaptV5SelectorClip(clip = {}) {
  const provenance =
    clip.source_identity_provenance ||
    clip.motion_source_identity?.source_identity_provenance ||
    {};
  const identityRows = sourceIdentityRows(provenance);
  const sourceIdentity = identityRows.find(
    (row) => clean(row?.kind) === "pulse_source_identity_sidecar",
  );
  const sourceInfo = identityRows.find(
    (row) => clean(row?.kind) === "yt_dlp_info_sidecar",
  );
  return {
    ...clip,
    kind: "direct_motion",
    path: clean(clip.path || clip.local_materialized_path),
    master_path: clean(clip.source_master_path || clip.master_path || clip.source_url),
    source_url: clean(
      clip.canonical_source_url ||
        clip.motion_source_identity?.canonical_source_url,
    ),
    info_json_path: clean(sourceInfo?.sidecar_path),
    source_identity_path: clean(sourceIdentity?.sidecar_path),
    start_s: finite(
      clip.source_media_start_s ??
        clip.media_start_s ??
        clip.mediaStartS ??
        clip.start_s,
    ),
    duration_s: finite(
      clip.duration_s ??
        clip.durationS ??
        clip.source_window_duration_s ??
        clip.materialized_duration_s,
    ),
    rights_grant: false,
  };
}

function currentSourceCard(story = {}) {
  const candidates = [
    ...(Array.isArray(story.visual_v4_bridge_video_clips)
      ? story.visual_v4_bridge_video_clips
      : []),
    ...(Array.isArray(story.video_clips) ? story.video_clips : []),
  ];
  const card = candidates.find((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const generated =
      clean(candidate.kind).toLowerCase() === "generated_card" ||
      clean(candidate.media_kind).toLowerCase() === "generated_card";
    return generated && clean(candidate.card_type).toLowerCase() === "source";
  });
  if (card) {
    return {
      ...card,
      kind: "generated_card",
      path: clean(card.path),
      duration_s: finite(card.duration_s ?? card.durationS),
    };
  }

  const gate =
    story.hyperframes_premium_shell_gate ||
    story.premiumLane?.hyperframesPremiumShellGate ||
    story.premium_lane?.hyperframes_premium_shell_gate ||
    {};
  const source = gate.checks?.source;
  const sourceBlockers = Array.isArray(source?.blockers) ? source.blockers.filter(Boolean) : [];
  const evidence = source?.evidence || {};
  const readabilityContract =
    evidence.readabilityContract ||
    evidence.readability_contract ||
    {};
  const readabilityBlockers = Array.isArray(readabilityContract.blockers)
    ? readabilityContract.blockers.filter(Boolean)
    : [];
  const readability = readabilityContract.evidence || readabilityContract;
  const durationS = finite(
    readability.planned_visible_duration_s ??
      readability.visible_duration_s ??
      readability.duration_s,
  );
  const cardPath = clean(evidence.cardPath || evidence.card_path);
  if (
    clean(source?.verdict).toLowerCase() !== "pass" ||
    sourceBlockers.length ||
    clean(readabilityContract.status || readabilityContract.verdict).toLowerCase() !== "pass" ||
    readabilityBlockers.length ||
    !cardPath ||
    durationS <= 0
  ) {
    return null;
  }
  const storyId = clean(story.story_id || story.id);
  return {
    id: `hyperframes_source_card_${storyId || "story"}`,
    kind: "generated_card",
    media_kind: "generated_card",
    card_type: "source",
    path: cardPath,
    source_url: `local://pulse-hyperframes/${storyId || "story"}/source`,
    source_family: "hyperframes_source_card",
    motion_family: "hyperframes_source_card",
    rights_basis: "owned_generated_editorial_motion_graphic",
    rights_grant: true,
    commercial_use_allowed: true,
    approval_status: "approved_for_owned_editorial_use",
    readable_text: clean(readability.readable_text || readability.text || "SOURCE"),
    duration_s: durationS,
    minimum_readable_duration_s: finite(
      readability.minimum_visible_duration_s ??
        readability.minimum_readable_duration_s ??
        durationS,
    ),
    maximum_visible_duration_s: finite(
      readability.maximum_visible_duration_s ??
        readability.maximum_readable_duration_s ??
        durationS,
    ),
    hyperframes_premium_shell_evidence: evidence,
  };
}

function selectionScenes(selection = {}, story = {}) {
  if (Array.isArray(selection.scenes)) {
    return {
      adapter: "native_flagship_motion_selection",
      scenes: selection.scenes.map((scene) => ({ ...scene })),
    };
  }
  if (clean(selection.version) !== "pulse_direct_motion_visual_selector_v5") {
    return { adapter: "", scenes: [] };
  }
  const blockers = Array.isArray(selection.blockers) ? selection.blockers.filter(Boolean) : [];
  if (blockers.length) {
    throw new Error(`decoded_selector_blocked:${blockers.join(",")}`);
  }
  if (clean(selection.policy_tier) !== "ultimate_professional") {
    throw new Error("decoded_selector_policy_tier_invalid");
  }
  const clips = Array.isArray(selection.clips) ? selection.clips : [];
  if (!clips.length) throw new Error("decoded_selector_clips_missing");
  if (clips.some((clip) => clean(clip?.media_kind).toLowerCase() !== "direct_video")) {
    throw new Error("decoded_selector_contains_non_direct_motion");
  }
  const card = currentSourceCard(story);
  const scenes = clips.map(adaptV5SelectorClip);
  if (card) scenes.splice(Math.min(1, scenes.length), 0, card);
  return {
    adapter: "pulse_direct_motion_visual_selector_v5",
    scenes,
  };
}

function sceneId(scene, index) {
  return clean(scene?.id) || `flagship_scene_${String(index + 1).padStart(2, "0")}`;
}

function sourceIdentity(scene) {
  const youtubeId = clean(scene?.youtube_video_id).toLowerCase();
  if (youtubeId) return `youtube:${youtubeId}`;
  return canonicaliseMotionSourceUrl(scene?.source_url);
}

function resolveStoryMediaPath(story = {}, storyManifestPath = "", fields = []) {
  for (const field of fields) {
    const value = clean(story[field]);
    if (!value) continue;
    return path.isAbsolute(value)
      ? path.resolve(value)
      : path.resolve(path.dirname(path.resolve(storyManifestPath)), value);
  }
  return "";
}

function inspectSelectionSources(scenes) {
  const direct = scenes.filter(isDirectMotion);
  const sourceCounts = new Map();
  for (const scene of direct) {
    const source = sourceIdentity(scene);
    if (!source) throw new Error(`direct_motion_source_identity_missing:${clean(scene.id)}`);
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
  }
  for (const [source, rows] of [...sourceCounts.keys()].map((source) => [
    source,
    direct
      .filter((scene) => sourceIdentity(scene) === source)
      .map((scene) => ({
        id: clean(scene.id),
        start: finite(scene.start_s, -1),
        end: finite(scene.start_s, -1) + finite(scene.duration_s),
      }))
      .sort((a, b) => a.start - b.start),
  ])) {
    for (let index = 1; index < rows.length; index += 1) {
      if (rows[index].start < rows[index - 1].end - FLAGSHIP_MOTION_PLAN_POLICY.overlap_tolerance_s) {
        throw new Error(`professional_source_windows_overlap:${source}:${rows[index - 1].id}:${rows[index].id}`);
      }
    }
  }
  for (const [source, count] of sourceCounts) {
    if (count > FLAGSHIP_MOTION_PLAN_POLICY.maximum_scenes_per_source) {
      throw new Error(`professional_source_scene_limit_exceeded:${source}:${count}`);
    }
  }
  return { direct, sourceCounts };
}

function assertSourceDistribution(direct, sourceCounts) {
  for (const [source, count] of sourceCounts) {
    if (direct.length && count / direct.length > FLAGSHIP_MOTION_PLAN_POLICY.maximum_source_share) {
      throw new Error(`professional_source_share_exceeded:${source}:${round(count / direct.length)}`);
    }
  }
}

async function probeDurationDefault(filePath) {
  return ffprobeDuration(filePath);
}

function steamSourceIdentity(value) {
  try {
    const parsed = new URL(clean(value));
    const hostname = parsed.hostname.toLowerCase();
    if (
      parsed.protocol !== "https:" ||
      (!hostname.endsWith("steamstatic.com") && !hostname.endsWith("steampowered.com"))
    ) {
      return null;
    }
    const appId = clean(
      parsed.pathname.match(/\/(?:app|apps|store_trailers)\/(\d+)(?:\/|$)/i)?.[1],
    );
    return appId ? { appId, hostname } : null;
  } catch {
    return null;
  }
}

async function validateOfficialPlatformSource(scene, id, master) {
  const sourceIdentityPath = clean(scene.source_identity_path || scene.sourceIdentityPath);
  if (!sourceIdentityPath) throw new Error(`official_platform_source_identity_missing:${id}`);
  const identity = await readJsonEvidence(sourceIdentityPath, `source_identity:${id}`);
  const value = identity.value;
  if (
    clean(value.schema) !== "pulse_motion_source_identity_sidecar_v1" ||
    finite(value.schema_version) !== 1 ||
    clean(value.identity_scope) !== "source_identity_only"
  ) {
    throw new Error(`official_platform_source_identity_schema_invalid:${id}`);
  }
  if (clean(value.platform).toLowerCase() !== "steam") {
    throw new Error(`official_platform_source_identity_platform_invalid:${id}`);
  }
  const sceneSteam = steamSourceIdentity(scene.source_url);
  const sidecarSteam = steamSourceIdentity(value.canonical_source_url);
  if (!sceneSteam || !sidecarSteam || sceneSteam.appId !== sidecarSteam.appId) {
    throw new Error(`official_platform_source_url_invalid:${id}`);
  }
  if (
    canonicaliseMotionSourceUrl(scene.source_url) !==
    canonicaliseMotionSourceUrl(value.canonical_source_url)
  ) {
    throw new Error(`official_platform_source_url_mismatch:${id}`);
  }
  if (clean(value.evidence?.steam_app_id) !== sceneSteam.appId) {
    throw new Error(`official_platform_source_app_id_mismatch:${id}`);
  }
  const referenceSteam = steamSourceIdentity(value.evidence?.reference_url);
  if (!referenceSteam || referenceSteam.appId !== sceneSteam.appId) {
    throw new Error(`official_platform_reference_url_invalid:${id}`);
  }
  if (!clean(value.source_owner) || clean(value.source_owner) !== clean(scene.source_owner)) {
    throw new Error(`official_platform_source_owner_mismatch:${id}`);
  }
  if (
    clean(value.source_type) !== "official_platform_product_page" ||
    clean(scene.source_type) !== "official_platform_product_page"
  ) {
    throw new Error(`official_platform_source_type_invalid:${id}`);
  }
  if (clean(value.source_master_sha256).toLowerCase() !== master.sha256) {
    throw new Error(`official_platform_source_master_hash_mismatch:${id}`);
  }
  if (value.rights_grant !== false) {
    throw new Error(`official_platform_identity_must_not_imply_rights_grant:${id}`);
  }
  return {
    platform: "steam",
    canonicalSourceUrl: clean(value.canonical_source_url),
    sourceOwner: clean(value.source_owner),
    sourceChannelUrl: clean(value.evidence?.reference_url),
    sourceIdentityPath: identity.evidence.path,
    sourceIdentitySha256: identity.evidence.sha256,
  };
}

async function validateYoutubeSource(scene, id, master, declaredVideoId) {
  const sourceIdentityPath = clean(scene.source_identity_path || scene.sourceIdentityPath);
  if (sourceIdentityPath) {
    const identity = await readJsonEvidence(sourceIdentityPath, `source_identity:${id}`);
    const value = identity.value;
    if (
      clean(value.schema) !== "pulse_motion_source_identity_sidecar_v1" ||
      finite(value.schema_version) !== 1 ||
      clean(value.identity_scope) !== "source_identity_only"
    ) {
      throw new Error(`youtube_source_identity_schema_invalid:${id}`);
    }
    if (clean(value.youtube_video_id) !== declaredVideoId) {
      throw new Error(`youtube_source_identity_video_id_mismatch:${id}`);
    }
    if (youtubeVideoIdFromUrl(value.canonical_source_url) !== declaredVideoId) {
      throw new Error(`youtube_source_identity_url_mismatch:${id}`);
    }
    if (youtubeVideoIdFromUrl(scene.source_url) !== declaredVideoId) {
      throw new Error(`source_url_video_id_mismatch:${id}`);
    }
    if (clean(value.source_master_sha256).toLowerCase() !== master.sha256) {
      throw new Error(`youtube_source_master_hash_mismatch:${id}`);
    }
    const channelName = clean(value.channel_identity?.author_name);
    const channelUrl = clean(value.channel_identity?.author_url);
    if (!channelName || !/^https:\/\/www\.youtube\.com\/@[^/]+$/i.test(channelUrl)) {
      throw new Error(`youtube_source_channel_identity_missing:${id}`);
    }
    if (value.rights_grant !== false) {
      throw new Error(`youtube_identity_must_not_imply_rights_grant:${id}`);
    }
    return {
      sourceChannel: channelName,
      sourceChannelUrl: channelUrl,
      sourceInfoPath: "",
      sourceInfoSha256: "",
      sourceIdentityPath: identity.evidence.path,
      sourceIdentitySha256: identity.evidence.sha256,
    };
  }

  const info = await readJsonEvidence(scene.info_json_path, `source_info:${id}`);
  if (clean(info.value.id) !== declaredVideoId) {
    throw new Error(`source_info_video_id_mismatch:${id}`);
  }
  if (youtubeVideoIdFromUrl(scene.source_url) !== declaredVideoId) {
    throw new Error(`source_url_video_id_mismatch:${id}`);
  }
  if (!clean(info.value.channel) || !clean(info.value.channel_url)) {
    throw new Error(`source_info_channel_identity_missing:${id}`);
  }
  return {
    sourceChannel: clean(info.value.channel),
    sourceChannelUrl: clean(info.value.channel_url),
    sourceInfoPath: info.evidence.path,
    sourceInfoSha256: info.evidence.sha256,
    sourceIdentityPath: "",
    sourceIdentitySha256: "",
  };
}

function cueForScene(scene, index, atS) {
  const cardType = clean(scene.card_type).toLowerCase();
  const card = isGeneratedCard(scene);
  return {
    id: `flagship_sfx_${String(index + 1).padStart(2, "0")}`,
    target: clean(scene.id),
    target_kind: cardType === "source" ? "source_lock" : card ? "proof_card" : "motion_clip",
    atS: round(atS),
    family: cardType === "source" ? "source_tick" : index % 2 === 0 ? "whoosh" : "transition_hit",
    gainDb: cardType === "source" ? -12 : -10,
    duckGroup: "under_narration",
  };
}

function directorPlanForScenes(storyId, scenes, generatedAt, summary) {
  let cursor = 0;
  const shotPlan = [];
  const cues = [];
  scenes.forEach((scene, index) => {
    const durationS = finite(scene.duration_s);
    const cardType = clean(scene.card_type).toLowerCase();
    const kind = cardType === "source" ? "source_lock" : isGeneratedCard(scene) ? "proof_card" : "motion_clip";
    shotPlan.push({
      id: clean(scene.id),
      kind,
      startS: round(cursor),
      durationS: round(durationS),
      source_family: clean(scene.source_family),
      base_source_family: clean(scene.base_source_family),
      media_path: clean(scene.path),
      priority: 100 - index,
      visual_treatment: isGeneratedCard(scene)
        ? "short readable kinetic editorial card"
        : "full-bleed direct motion hard cut",
    });
    cues.push(cueForScene(scene, index, cursor));
    cursor += durationS;
  });
  const soundTransitionPlan = {
    schema_version: 1,
    generated_at: generatedAt,
    local_only: true,
    sfx: {
      cue_count: cues.length,
      cues,
      max_same_family_run: 1,
      mastering: {
        narration_priority: true,
        duck_under_narration: true,
        target_peak_db: -1.5,
      },
    },
  };
  return {
    director: {
      schema_version: 1,
      generated_at: generatedAt,
      execution_mode: "flagship_motion_plan_materializer",
      local_only: true,
      story_id: storyId,
      shot_budget: {
        available_motion_clips: summary.direct_motion_scene_count,
        available_distinct_motion_source_assets: summary.genuine_base_source_count,
        max_static_card_ratio: FLAGSHIP_MOTION_PLAN_POLICY.maximum_generated_card_ratio,
        target_motion_ratio: 1 - FLAGSHIP_MOTION_PLAN_POLICY.maximum_generated_card_ratio,
      },
      shot_plan: shotPlan,
      sound_transition_plan: soundTransitionPlan,
      readiness: { verdict: "pass", blockers: [], warnings: [] },
      safety: { local_only: true, no_publishing_side_effects: true },
    },
    soundTransitionPlan,
  };
}

async function atomicWriteJson(filePath, value) {
  const resolved = path.resolve(filePath);
  await fs.ensureDir(path.dirname(resolved));
  const temporary = `${resolved}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.move(temporary, resolved, { overwrite: true });
}

async function materializeFlagshipMotionPlan({
  sourceStoryPath,
  selectionPath,
  outputStoryPath,
  reportPath,
  motionManifestPath,
  qaDir,
  generatedAt = new Date().toISOString(),
  probeDuration = probeDurationDefault,
  inspectClip = inspectDirectMotionClip,
  fingerprintClip = fingerprintVideoClip,
} = {}) {
  const source = await readJsonEvidence(sourceStoryPath, "source_story");
  const selection = await readJsonEvidence(selectionPath, "selection");
  const storyId = clean(source.value.story_id || source.value.id);
  if (!storyId) throw new Error("source_story_id_missing");
  const declaredSelectionStoryId = clean(selection.value.story_id);
  if (declaredSelectionStoryId && declaredSelectionStoryId !== storyId) {
    throw new Error("selection_story_id_mismatch");
  }
  const adaptedSelection = selectionScenes(selection.value, source.value);
  if (!declaredSelectionStoryId && adaptedSelection.adapter !== "pulse_direct_motion_visual_selector_v5") {
    throw new Error("selection_story_id_missing");
  }
  const selectedScenes = adaptedSelection.scenes;
  if (!selectedScenes.length) throw new Error("flagship_motion_scenes_missing");
  if (!selectedScenes.every((scene) => isDirectMotion(scene) || isGeneratedCard(scene))) {
    throw new Error("unsupported_flagship_scene_kind");
  }
  const excludedGeneratedCards = [];
  let selectedSourceCardCount = 0;
  const scenes = selectedScenes.filter((scene, index) => {
    if (!isGeneratedCard(scene)) return true;
    const id = sceneId(scene, index);
    const cardType = clean(scene.card_type).toLowerCase();
    let reason = "";
    if (cardType !== "source") {
      reason = "flagship_narrative_card_disallowed";
    } else if (selectedSourceCardCount >= FLAGSHIP_MOTION_PLAN_POLICY.maximum_source_cards) {
      reason = "flagship_source_card_limit_exceeded";
    } else {
      selectedSourceCardCount += 1;
    }
    if (!reason) return true;
    excludedGeneratedCards.push({
      id,
      card_type: cardType || "unspecified",
      reason,
    });
    return false;
  });
  scenes.forEach((scene, index) => {
    scene.id = sceneId(scene, index);
    scene.path = path.resolve(clean(scene.path));
  });
  const { direct, sourceCounts } = inspectSelectionSources(scenes);

  const audioPath = resolveStoryMediaPath(source.value, source.evidence.path, [
    "resolved_narration_audio_path",
    "resolved_audio_path",
    "audio_path",
    "narration_audio_path",
  ]);
  const audioEvidence = await fileEvidence(audioPath, "narration_audio");
  delete audioEvidence.bytes;
  const narrationDurationS = finite(await probeDuration(audioPath));
  if (narrationDurationS <= 0) throw new Error("narration_audio_not_decodable");

  const clipHashes = new Set();
  const directFingerprints = [];
  const resolvedScenes = [];
  for (const scene of scenes) {
    const id = clean(scene.id);
    const durationS = finite(scene.duration_s);
    if (durationS <= 0) throw new Error(`scene_duration_invalid:${id}`);
    if (isDirectMotion(scene) && durationS > FLAGSHIP_MOTION_PLAN_POLICY.maximum_direct_scene_duration_s) {
      throw new Error(`direct_motion_scene_duration_exceeds_maximum:${id}`);
    }
    if (isGeneratedCard(scene)) {
      const minimum = finite(scene.minimum_readable_duration_s);
      const maximum = finite(scene.maximum_visible_duration_s || scene.max_readable_card_duration_s);
      if (minimum > 0 && durationS < minimum) throw new Error(`generated_card_below_readable_minimum:${id}`);
      if (maximum > 0 && durationS > maximum) throw new Error(`generated_card_exceeds_visible_maximum:${id}`);
    }

    const media = await fileEvidence(scene.path, `scene:${id}`);
    delete media.bytes;
    if (clipHashes.has(media.sha256)) throw new Error(`duplicate_scene_content_hash:${id}`);
    clipHashes.add(media.sha256);
    const decodedDurationS = finite(await probeDuration(scene.path));
    if (decodedDurationS <= 0) throw new Error(`scene_not_decodable:${id}`);
    if (
      !isGeneratedCard(scene) &&
      Math.abs(decodedDurationS - durationS) > FLAGSHIP_MOTION_PLAN_POLICY.duration_tolerance_s
    ) {
      throw new Error(`scene_duration_mismatch:${id}:${round(decodedDurationS)}:${round(durationS)}`);
    }

    if (isGeneratedCard(scene)) {
      const minimum = finite(scene.minimum_readable_duration_s);
      const maximum = finite(scene.maximum_visible_duration_s || scene.max_readable_card_duration_s);
      if (minimum > 0 && decodedDurationS < minimum) {
        throw new Error(`generated_card_decoded_duration_below_readable_minimum:${id}`);
      }
      if (maximum > 0 && decodedDurationS > maximum) {
        throw new Error(`generated_card_decoded_duration_exceeds_visible_maximum:${id}`);
      }
      resolvedScenes.push({
        ...scene,
        source_family: clean(scene.source_family) || `hyperframes_${clean(scene.card_type) || "editorial"}_card`,
        base_source_family: clean(scene.source_url) || `local://hyperframes/${storyId}/${clean(scene.card_type) || id}`,
        motion_family: clean(scene.source_family) || `hyperframes_${clean(scene.card_type) || "editorial"}_card`,
        media_kind: "generated_card",
        source_kind: "video_file",
        path: media.path,
        sha256: media.sha256,
        size_bytes: media.size_bytes,
        duration_s: round(decodedDurationS),
        durationS: round(decodedDurationS),
      });
      continue;
    }

    const master = await fileEvidence(scene.master_path, `source_master:${id}`);
    delete master.bytes;
    const declaredVideoId = clean(scene.youtube_video_id);
    let sourcePlatform = "youtube";
    let sourceChannel = "";
    let sourceChannelUrl = "";
    let sourceInfoPath = "";
    let sourceInfoSha256 = "";
    let sourceIdentityPath = "";
    let sourceIdentitySha256 = "";
    let baseSourceFamily = "";
    if (declaredVideoId) {
      const youtube = await validateYoutubeSource(scene, id, master, declaredVideoId);
      sourceChannel = youtube.sourceChannel;
      sourceChannelUrl = youtube.sourceChannelUrl;
      sourceInfoPath = youtube.sourceInfoPath;
      sourceInfoSha256 = youtube.sourceInfoSha256;
      sourceIdentityPath = youtube.sourceIdentityPath;
      sourceIdentitySha256 = youtube.sourceIdentitySha256;
      baseSourceFamily = `youtube:${declaredVideoId.toLowerCase()}`;
    } else {
      const platform = await validateOfficialPlatformSource(scene, id, master);
      sourcePlatform = platform.platform;
      sourceChannel = platform.sourceOwner;
      sourceChannelUrl = platform.sourceChannelUrl;
      sourceIdentityPath = platform.sourceIdentityPath;
      sourceIdentitySha256 = platform.sourceIdentitySha256;
      baseSourceFamily = canonicaliseMotionSourceUrl(platform.canonicalSourceUrl);
    }
    const visualQa = await inspectClip(scene, { outputDir: path.resolve(qaDir) });
    if (!visualQa?.eligible) {
      throw new Error(`direct_motion_visual_qa_failed:${id}:${(visualQa?.reasons || []).join(",")}`);
    }
    const visualFingerprint = await Promise.resolve(fingerprintClip({ ...scene, path: media.path }));
    if (!visualFingerprint) throw new Error(`direct_motion_visual_fingerprint_missing:${id}`);
    for (const prior of directFingerprints) {
      const comparison = compareVideoFingerprints(prior.fingerprint, visualFingerprint);
      if (comparison.near_duplicate) {
        throw new Error(`flagship_visual_near_duplicate:${prior.id}:${id}`);
      }
    }
    directFingerprints.push({ id, fingerprint: visualFingerprint });
    const canonicalSourceUrl = clean(scene.source_url);
    const sourceIdentityProvenance = {
      schema_version: 1,
      kind: sourceIdentityPath
        ? "pulse_source_identity_sidecar"
        : "youtube_source_info",
      status: "resolved",
      sidecar_path: sourceIdentityPath || null,
      sidecar_sha256: sourceIdentitySha256 || null,
      source_info_path: sourceInfoPath || null,
      source_info_sha256: sourceInfoSha256 || null,
      channel_identity: {
        author_name: sourceChannel || clean(scene.source_owner),
        author_url: sourceChannelUrl || null,
      },
      source_master_sha256: master.sha256,
      identity_scope: "source_identity_only",
      rights_grant: false,
    };
    const editorialDurationS = Math.min(durationS, decodedDurationS);
    resolvedScenes.push({
      ...scene,
      path: media.path,
      source_family:
        clean(scene.source_family) ||
        `${sourcePlatform}_${sourceIdentity(scene)}_window_${finite(scene.start_s)}_${durationS}`,
      base_source_family: baseSourceFamily,
      motion_family:
        clean(scene.motion_family) ||
        `${sourcePlatform}_${sourceIdentity(scene)}_window_${finite(scene.start_s)}_${durationS}`,
      visual_family:
        clean(scene.visual_family) ||
        `${sourcePlatform}_${sourceIdentity(scene)}_window_${finite(scene.start_s)}_${durationS}`,
      media_kind: "direct_video",
      source_kind: "video_file",
      source_url_kind: "official_video_source",
      source_platform: sourcePlatform,
      source_master_path: master.path,
      source_master_sha256: master.sha256,
      source_master_size_bytes: master.size_bytes,
      source_info_path: sourceInfoPath,
      source_info_sha256: sourceInfoSha256,
      source_identity_path: sourceIdentityPath,
      source_identity_sha256: sourceIdentitySha256,
      source_owner: clean(scene.source_owner) || sourceChannel,
      source_channel: sourceChannel,
      source_channel_url: sourceChannelUrl,
      rights_grant: scene.rights_grant === true,
      rights_status: scene.rights_grant === true ? "explicit_grant_recorded" : "operator_legal_review_required",
      usage_scope: scene.rights_grant === true ? "declared_licensed_scope" : "local_proof_only",
      materialized: true,
      validated: true,
      segmentValidationPassed: true,
      provenance: {
        ...(scene.provenance && typeof scene.provenance === "object" ? scene.provenance : {}),
        source: "flagship_motion_plan_materializer",
        segment_validated: true,
        validation_reason: "hash_bound_official_source_and_decoded_visual_qa_passed",
        visual_qa_passed: true,
      },
      motion_source_identity: {
        schema_version: 1,
        status: "resolved",
        strict_pass: true,
        canonical_source_url: canonicalSourceUrl,
        youtube_video_id: declaredVideoId || null,
        source_master_sha256: master.sha256,
        source_identity_provenance: sourceIdentityProvenance,
        source_identity_conflicts: [],
        blockers: [],
      },
      sha256: media.sha256,
      size_bytes: media.size_bytes,
      duration_s: round(editorialDurationS),
      durationS: round(editorialDurationS),
      decoded_duration_s: round(decodedDurationS),
      mediaStartS: finite(scene.start_s),
      visual_qa: {
        version: clean(visualQa.version),
        eligible: true,
        reasons: [],
        metrics: visualQa.metrics || {},
      },
      visual_fingerprint: visualFingerprint,
    });
  }

  const totalDurationS = resolvedScenes.reduce((sum, scene) => sum + finite(scene.duration_s), 0);
  if (totalDurationS + FLAGSHIP_MOTION_PLAN_POLICY.duration_tolerance_s < narrationDurationS) {
    throw new Error(
      `flagship_scene_duration_below_narration_duration:${round(totalDurationS)}:${round(narrationDurationS)}`,
    );
  }
  const minimumRenderTransitionLossS =
    FLAGSHIP_MOTION_PLAN_POLICY.minimum_render_transition_s * Math.max(0, resolvedScenes.length - 1);
  const effectiveRenderCoverageS = totalDurationS - minimumRenderTransitionLossS;
  if (
    effectiveRenderCoverageS + FLAGSHIP_MOTION_PLAN_POLICY.render_transition_headroom_s <
    narrationDurationS
  ) {
    throw new Error(
      `flagship_effective_render_duration_below_narration_duration:${round(effectiveRenderCoverageS)}:${round(narrationDurationS)}`,
    );
  }
  assertSourceDistribution(direct, sourceCounts);
  if (direct.length < FLAGSHIP_MOTION_PLAN_POLICY.minimum_direct_motion_scenes) {
    throw new Error(`flagship_direct_motion_scene_floor_not_met:${direct.length}`);
  }
  if (sourceCounts.size < FLAGSHIP_MOTION_PLAN_POLICY.minimum_genuine_base_sources) {
    throw new Error(`flagship_genuine_base_source_floor_not_met:${sourceCounts.size}`);
  }

  const generatedCardDurationS = resolvedScenes
    .filter(isGeneratedCard)
    .reduce((sum, scene) => sum + finite(scene.duration_s), 0);
  const cardDurationRatio = totalDurationS > 0 ? generatedCardDurationS / totalDurationS : 1;
  if (cardDurationRatio > FLAGSHIP_MOTION_PLAN_POLICY.maximum_generated_card_ratio) {
    throw new Error(`flagship_generated_card_ratio_exceeded:${round(cardDurationRatio)}`);
  }

  const professional = assessProfessionalSourceDiversity({
    clips: resolvedScenes.filter(isDirectMotion),
    scenes: resolvedScenes.filter(isDirectMotion),
    requiredBaseSources: FLAGSHIP_MOTION_PLAN_POLICY.minimum_genuine_base_sources,
    maxScenesPerSource: FLAGSHIP_MOTION_PLAN_POLICY.maximum_scenes_per_source,
    maxSourceShare: FLAGSHIP_MOTION_PLAN_POLICY.maximum_source_share,
  });
  if (professional.status !== "pass") {
    throw new Error(`professional_source_diversity_failed:${professional.blockers.join(",")}`);
  }

  const summary = {
    scene_count: resolvedScenes.length,
    direct_motion_scene_count: resolvedScenes.filter(isDirectMotion).length,
    generated_card_scene_count: resolvedScenes.filter(isGeneratedCard).length,
    excluded_generated_card_scene_count: excludedGeneratedCards.length,
    genuine_base_source_count: sourceCounts.size,
    max_scenes_per_source: Math.max(...sourceCounts.values()),
    max_direct_motion_scene_duration_s: round(
      Math.max(...resolvedScenes.filter(isDirectMotion).map((scene) => finite(scene.duration_s))),
    ),
    total_scene_duration_s: round(totalDurationS),
    minimum_render_transition_loss_s: round(minimumRenderTransitionLossS),
    effective_render_coverage_s: round(effectiveRenderCoverageS),
    narration_duration_s: round(narrationDurationS),
    generated_card_duration_s: round(generatedCardDurationS),
    card_duration_ratio: round(cardDurationRatio),
    direct_motion_duration_ratio: round(1 - cardDurationRatio),
  };
  const plans = directorPlanForScenes(storyId, resolvedScenes, new Date(generatedAt).toISOString(), summary);
  const story = {
    ...source.value,
    generated_at: new Date(generatedAt).toISOString(),
    publish_authorised: false,
    render_invocation_mode: "local_proof_flagship_motion_refresh",
    video_clips: resolvedScenes.map((scene) => scene.path),
    visual_v4_bridge_video_clips: resolvedScenes,
    visual_v4_director_plan: plans.director,
    sound_transition_plan: plans.soundTransitionPlan,
    hyperframes_available_card_count: summary.generated_card_scene_count,
    hyperframes_premium_shell_selected_card_count: summary.generated_card_scene_count,
    premium_shell_selected_card_count: summary.generated_card_scene_count,
  };

  await atomicWriteJson(outputStoryPath, story);
  const outputStoryEvidence = await fileEvidence(outputStoryPath, "output_story");
  delete outputStoryEvidence.bytes;
  const report = {
    schema_version: 1,
    policy_version: FLAGSHIP_MOTION_PLAN_POLICY.version,
    generated_at: new Date(generatedAt).toISOString(),
    mode: "LOCAL_PROOF_FLAGSHIP_MOTION_PLAN",
    status: "READY_FOR_LOCAL_FLAGSHIP_RENDER",
    story_id: storyId,
    publish_authorised: false,
    summary,
    source_story: source.evidence,
    selection: selection.evidence,
    selection_adapter: adaptedSelection.adapter,
    narration_audio: audioEvidence,
    output_story: outputStoryEvidence,
    professional_source_diversity: professional,
    excluded_generated_cards: excludedGeneratedCards,
    scenes: resolvedScenes,
    safety: {
      local_proof_only: true,
      render_executed: false,
      production_db_mutated: false,
      oauth_or_tokens_mutated: false,
      external_posting_triggered: false,
    },
  };
  await atomicWriteJson(reportPath, report);
  let resolvedMotionManifestPath = "";
  if (clean(motionManifestPath)) {
    resolvedMotionManifestPath = path.resolve(motionManifestPath);
    const directScenes = resolvedScenes.filter(isDirectMotion);
    const distinctMotionFamilies = [...new Set(
      resolvedScenes.map((scene) => clean(scene.motion_family)).filter(Boolean),
    )];
    const distinctDirectMotionFamilies = [...new Set(
      directScenes.map((scene) => clean(scene.motion_family)).filter(Boolean),
    )];
    const motionManifest = {
      schema_version: 1,
      generated_at: new Date(generatedAt).toISOString(),
      story_id: storyId,
      status: "ready",
      policy_tier: clean(selection.value.policy_tier) || "ultimate_professional",
      clips: resolvedScenes,
      materialised_clips: resolvedScenes,
      materialized_clips: resolvedScenes,
      selected_materialised_motion_clip_ids: resolvedScenes.map((scene) => scene.id),
      clip_count: resolvedScenes.length,
      distinct_motion_family_count: distinctMotionFamilies.length,
      distinct_motion_families: distinctMotionFamilies,
      distinct_genuine_base_source_count: sourceCounts.size,
      professional_source_diversity: professional,
      minimum_requirements: {
        min_genuine_base_sources: FLAGSHIP_MOTION_PLAN_POLICY.minimum_genuine_base_sources,
      },
      direct_video_motion_asset_count: directScenes.length,
      direct_video_motion_family_count: distinctDirectMotionFamilies.length,
      motion_plan_report_path: path.resolve(reportPath),
      safety: {
        local_proof_only: true,
        no_publish: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
      },
    };
    await atomicWriteJson(resolvedMotionManifestPath, motionManifest);
  }
  return {
    report,
    story,
    outputStoryPath: path.resolve(outputStoryPath),
    reportPath: path.resolve(reportPath),
    motionManifestPath: resolvedMotionManifestPath,
  };
}

module.exports = {
  FLAGSHIP_MOTION_PLAN_POLICY,
  materializeFlagshipMotionPlan,
};
