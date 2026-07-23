"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const CINEMATIC_AUDIO_ARC_VERSION = "pulse_cinematic_audio_arc_v1";
const CINEMATIC_SOUNDSCAPE_ROLES = Object.freeze([
  "ambience",
  "drone",
  "tension_bed",
]);
const DEFAULT_CINEMATIC_BED_POLICY = Object.freeze({
  narration_priority: true,
  max_soundscape_layers: 1,
  raw_volume: 0.055,
  ducked_output_volume: 0.3,
  highpass_hz: 45,
  lowpass_hz: 7200,
  sidechain_threshold: 0.028,
  sidechain_ratio: 7,
  sidechain_attack_ms: 12,
  sidechain_release_ms: 520,
  fade_in_s: 0.24,
  fade_out_s: 0.5,
  micro_drop_multiplier: 0.18,
  micro_drop_lead_s: 0.12,
  micro_drop_tail_s: 0.08,
});

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalise(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function round(value, digits = 3) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
}

function uniqueByAssetId(assets = []) {
  const seen = new Set();
  const result = [];
  for (const asset of asArray(assets)) {
    const key = cleanText(
      asset.asset_id ||
        asset.id ||
        asset.path ||
        asset.audio_path ||
        asset.file_path,
    );
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(asset);
  }
  return result;
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(await fs.readFile(filePath))
    .digest("hex");
}

function desiredSoundscapeRole(story = {}) {
  const text = [
    story.classification,
    story.content_pillar,
    story.flair,
    story.title,
  ]
    .map(cleanText)
    .join(" ")
    .toLowerCase();
  if (
    story.breaking_fast_track === true ||
    story.breaking === true ||
    Number(story.breaking_score || 0) >= 80 ||
    /\bbreaking\b/.test(text)
  ) {
    return "tension_bed";
  }
  if (/\brumou?r\b|\breportedly\b|\bleak\b/.test(text)) return "drone";
  return "ambience";
}

function soundscapeRole(asset = {}) {
  return normalise(asset.role || asset.sfx_role || asset.family || asset.category);
}

function approvedStatus(asset = {}) {
  return !/(?:blocked|rejected|failed|unapproved|unknown)/i.test(
    cleanText(asset.approval_status || asset.status),
  );
}

function isGovernedElevenLabsSoundscape(asset = {}) {
  const governance = asset.elevenlabs_governance || {};
  return Boolean(
    asset.commercial_use_allowed === true &&
      cleanText(asset.allowed_use) === "finished_editorial_video_only" &&
      cleanText(asset.rights_note) &&
      cleanText(governance.sidecar_path) &&
      /^[a-f0-9]{64}$/i.test(cleanText(governance.sha256)) &&
      governance.sha256_verified === true &&
      cleanText(governance.loudness_qc_status).toLowerCase() === "pass" &&
      cleanText(governance.reuse_status).toLowerCase() === "within_reuse_limit",
  );
}

function isGovernedEpidemicSoundscape(asset = {}) {
  const licence = cleanText(
    asset.licence_basis || asset.license_basis || asset.rights_basis,
  ).toLowerCase();
  const evidence = cleanText(
    asset.evidence_reference ||
      asset.safelist_evidence ||
      asset.evidence_file,
  );
  return Boolean(
    asset.commercial_use_allowed === true &&
      /epidemic_sound.*subscription.*safelist/.test(licence) &&
      evidence,
  );
}

function isGovernedCinematicSoundscape(asset = {}) {
  if (!asset || typeof asset !== "object") return false;
  if (!CINEMATIC_SOUNDSCAPE_ROLES.includes(soundscapeRole(asset))) return false;
  if (!approvedStatus(asset)) return false;
  const provider = normalise(asset.provider_id || asset.provider);
  if (provider === "elevenlabs_sfx") return isGovernedElevenLabsSoundscape(asset);
  if (provider === "epidemic_sound") return isGovernedEpidemicSoundscape(asset);
  return false;
}

function rolePreference(story = {}) {
  const desired = desiredSoundscapeRole(story);
  if (desired === "tension_bed") return ["tension_bed", "drone", "ambience"];
  if (desired === "drone") return ["drone", "tension_bed", "ambience"];
  return ["ambience", "drone", "tension_bed"];
}

function deterministicIndex(seed, size) {
  if (size <= 1) return 0;
  const digest = crypto.createHash("sha256").update(cleanText(seed) || "pulse").digest();
  return digest.readUInt32BE(0) % size;
}

function selectCinematicSoundscapeAsset({ story = {}, assets = [] } = {}) {
  const governed = uniqueByAssetId(assets).filter(isGovernedCinematicSoundscape);
  const seed = cleanText(
    story.id || story.story_id || story.url || story.title || "pulse-story",
  );
  for (const role of rolePreference(story)) {
    const matches = governed.filter((asset) => soundscapeRole(asset) === role);
    if (!matches.length) continue;
    const selected = matches[deterministicIndex(`${seed}:${role}`, matches.length)];
    return {
      ...selected,
      role,
      secondary_layer_only: true,
      raw_redistribution_allowed: false,
      selection_strategy: "story_seeded_governed_role_preference",
    };
  }
  return null;
}

function cinematicSoundscapeAssetsFromRuntimeManifest(manifest = {}) {
  const selectedById = new Map(
    asArray(manifest.selected_assets).map((asset) => [
      cleanText(asset.asset_id || asset.id),
      asset,
    ]),
  );
  const variants = Object.values(
    manifest.variant_assets_by_role || manifest.variantAssetsByRole || {},
  ).flatMap((items) => asArray(items));
  const merged = [];
  const seen = new Set();
  for (const asset of [...variants, ...asArray(manifest.selected_assets)]) {
    const id = cleanText(asset.asset_id || asset.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const selected = selectedById.get(id) || {};
    const governance = {
      sidecar_path: cleanText(
        asset.elevenlabs_governance?.sidecar_path || selected.sidecar_path,
      ),
      sha256: cleanText(
        asset.elevenlabs_governance?.sha256 ||
          selected.sha256 ||
          selected.actual_sha256,
      ),
      sha256_verified:
        asset.elevenlabs_governance?.sha256_verified === true ||
        selected.sha256_verified === true,
      loudness_qc_status: cleanText(
        asset.elevenlabs_governance?.loudness_qc_status ||
          (selected.status === "accepted" ? "pass" : ""),
      ),
      reuse_status: cleanText(
        asset.elevenlabs_governance?.reuse_status ||
          (selected.status === "accepted" ? "within_reuse_limit" : ""),
      ),
      prompt: cleanText(
        asset.elevenlabs_governance?.prompt || selected.prompt,
      ),
      model: cleanText(
        asset.elevenlabs_governance?.model || selected.model,
      ),
      generation_time: cleanText(
        asset.elevenlabs_governance?.generation_time ||
          selected.generation_time,
      ),
    };
    merged.push({
      ...selected,
      ...asset,
      asset_id: id,
      role: soundscapeRole(asset) || soundscapeRole(selected),
      provider_id: "elevenlabs_sfx",
      path: cleanText(
        asset.path ||
          asset.audio_path ||
          selected.audio_path ||
          selected.path,
      ),
      audio_path: cleanText(
        asset.audio_path ||
          asset.path ||
          selected.audio_path ||
          selected.path,
      ),
      approval_status: cleanText(
        asset.approval_status ||
          selected.approval_status ||
          (selected.status === "accepted"
            ? "approved_for_commercial_editorial_use"
            : ""),
      ),
      commercial_use_allowed: selected.commercial_use_allowed === true,
      allowed_use: cleanText(selected.allowed_use),
      rights_note: cleanText(selected.rights_note),
      raw_redistribution_allowed: false,
      secondary_layer_only: true,
      elevenlabs_governance: governance,
    });
  }
  return merged.filter((asset) =>
    CINEMATIC_SOUNDSCAPE_ROLES.includes(soundscapeRole(asset)),
  );
}

async function loadGovernedCinematicSoundscapeRuntime({
  workspaceRoot = process.cwd(),
  manifestPath = "",
} = {}) {
  const root = path.resolve(workspaceRoot);
  const resolvedManifestPath = path.resolve(
    manifestPath ||
      path.join(
        root,
        "output",
        "elevenlabs-cinematic-soundscapes",
        "elevenlabs_sfx_runtime_manifest.json",
      ),
  );
  if (!(await fs.pathExists(resolvedManifestPath))) {
    return {
      status: "unavailable",
      manifest_path: resolvedManifestPath,
      assets: [],
      blockers: ["cinematic_soundscape_runtime_manifest_missing"],
    };
  }
  if (!isWithin(root, resolvedManifestPath)) {
    return {
      status: "blocked",
      manifest_path: resolvedManifestPath,
      assets: [],
      blockers: ["cinematic_soundscape_runtime_manifest_outside_workspace"],
    };
  }
  let manifest;
  try {
    manifest = await fs.readJson(resolvedManifestPath);
  } catch {
    return {
      status: "blocked",
      manifest_path: resolvedManifestPath,
      assets: [],
      blockers: ["cinematic_soundscape_runtime_manifest_unreadable"],
    };
  }
  const blockers = [];
  if (cleanText(manifest.readiness?.status).toLowerCase() !== "ready") {
    blockers.push("cinematic_soundscape_runtime_manifest_not_ready");
  }
  blockers.push(
    ...asArray(manifest.readiness?.blockers).map(
      (blocker) => `cinematic_soundscape_runtime:${cleanText(blocker)}`,
    ),
  );
  const assets = [];
  for (const candidate of cinematicSoundscapeAssetsFromRuntimeManifest(
    manifest,
  )) {
    if (!isGovernedCinematicSoundscape(candidate)) {
      blockers.push(
        `cinematic_soundscape_governance_invalid:${candidate.asset_id}`,
      );
      continue;
    }
    const audioPath = path.resolve(candidate.path || "");
    const sidecarPath = path.resolve(
      candidate.elevenlabs_governance?.sidecar_path || "",
    );
    if (!isWithin(root, audioPath) || !isWithin(root, sidecarPath)) {
      blockers.push(
        `cinematic_soundscape_evidence_outside_workspace:${candidate.asset_id}`,
      );
      continue;
    }
    if (
      !(await fs.pathExists(audioPath)) ||
      !(await fs.pathExists(sidecarPath))
    ) {
      blockers.push(
        `cinematic_soundscape_evidence_missing:${candidate.asset_id}`,
      );
      continue;
    }
    const actualSha256 = await sha256File(audioPath);
    if (
      actualSha256 !==
      cleanText(candidate.elevenlabs_governance.sha256).toLowerCase()
    ) {
      blockers.push(
        `cinematic_soundscape_audio_hash_mismatch:${candidate.asset_id}`,
      );
      continue;
    }
    assets.push({
      ...candidate,
      path: audioPath,
      audio_path: audioPath,
      runtime_manifest_path: resolvedManifestPath,
      runtime_manifest_sha256: null,
    });
  }
  if (!assets.length) blockers.push("cinematic_soundscape_no_governed_assets");
  const manifestSha256 = await sha256File(resolvedManifestPath);
  const uniqueBlockers = [...new Set(blockers.filter(Boolean))];
  return {
    status: uniqueBlockers.length ? "blocked" : "ready",
    manifest_path: resolvedManifestPath,
    manifest_sha256: manifestSha256,
    assets: assets.map((asset) => ({
      ...asset,
      runtime_manifest_sha256: manifestSha256,
    })),
    blockers: uniqueBlockers,
  };
}

function storySoundCues(story = {}) {
  return asArray(
    story.sound_transition_plan?.sfx?.cues ||
      story.visual_v4_director_plan?.sound_transition_plan?.sfx?.cues ||
      story.director_plan?.sound_transition_plan?.sfx?.cues,
  );
}

function microDropWindowsForStory(story = {}, durationS = 0, policy = DEFAULT_CINEMATIC_BED_POLICY) {
  const duration = Number(durationS) || 0;
  const priority = new Map([
    ["source_lock", 0],
    ["review_score_card", 1],
    ["steam_chart", 2],
    ["proof_card", 3],
    ["pattern_interrupt", 4],
  ]);
  return storySoundCues(story)
    .map((cue, index) => ({
      cue,
      index,
      target_kind: normalise(cue.target_kind || cue.targetKind || cue.kind),
      at_s: Number(cue.atS ?? cue.startS ?? cue.start_s),
    }))
    .filter(
      (entry) =>
        priority.has(entry.target_kind) &&
        Number.isFinite(entry.at_s) &&
        entry.at_s >= 1 &&
        (!duration || entry.at_s <= duration - 1),
    )
    .sort(
      (left, right) =>
        priority.get(left.target_kind) - priority.get(right.target_kind) ||
        left.at_s - right.at_s ||
        left.index - right.index,
    )
    .slice(0, 2)
    .map((entry) => ({
      target_kind: entry.target_kind,
      target_at_s: round(entry.at_s),
      start_s: round(Math.max(0, entry.at_s - policy.micro_drop_lead_s)),
      end_s: round(
        Math.min(duration || Infinity, entry.at_s + policy.micro_drop_tail_s),
      ),
      bed_multiplier: policy.micro_drop_multiplier,
      reason: "brief_bed_space_before_proof_or_reveal",
    }));
}

function buildCinematicAudioArc({
  story = {},
  durationS = 0,
  soundscapeAssets = [],
  policy = DEFAULT_CINEMATIC_BED_POLICY,
} = {}) {
  const mergedPolicy = { ...DEFAULT_CINEMATIC_BED_POLICY, ...(policy || {}) };
  const selected = selectCinematicSoundscapeAsset({
    story,
    assets: soundscapeAssets,
  });
  return {
    version: CINEMATIC_AUDIO_ARC_VERSION,
    story_id: cleanText(story.id || story.story_id) || null,
    duration_s: round(durationS),
    desired_soundscape_role: desiredSoundscapeRole(story),
    soundscape: selected,
    micro_drop_windows: microDropWindowsForStory(
      story,
      durationS,
      mergedPolicy,
    ),
    policy: mergedPolicy,
    creative_rules: {
      atmosphere_is_secondary_to_narration: true,
      silence_is_an_editing_tool: true,
      risers_land_on_reveals: true,
      no_effect_on_every_cut: true,
      no_recognisable_game_ui_or_melody: true,
      no_raw_generated_asset_redistribution: true,
    },
  };
}

function cinematicCueTiming({
  role = "",
  targetDelayMs = 0,
  durationS = 0,
} = {}) {
  const target = Math.max(0, Math.round(Number(targetDelayMs) || 0));
  const duration = Math.max(0, Number(durationS) || 0);
  const isRiser = normalise(role) === "riser";
  const preLapMs = isRiser ? Math.round(duration * 1000 * 0.85) : 0;
  return {
    delayMs: Math.max(0, target - preLapMs),
    landsAtMs: target,
    preLapMs,
    preLapped: isRiser && preLapMs > 0,
  };
}

function bedDropoutFilterChain({
  inputLabel,
  outputLabel,
  microDropWindows = [],
  multiplier = DEFAULT_CINEMATIC_BED_POLICY.micro_drop_multiplier,
} = {}) {
  const windows = asArray(microDropWindows).filter(
    (window) =>
      Number.isFinite(Number(window.start_s)) &&
      Number.isFinite(Number(window.end_s)) &&
      Number(window.end_s) > Number(window.start_s),
  );
  if (!windows.length) return [`[${inputLabel}]anull[${outputLabel}]`];
  const filters = [];
  let previous = inputLabel;
  windows.forEach((window, index) => {
    const next = index === windows.length - 1 ? outputLabel : `${outputLabel}_drop_${index}`;
    const floor = Number.isFinite(Number(window.bed_multiplier))
      ? Number(window.bed_multiplier)
      : multiplier;
    filters.push(
      `[${previous}]volume=${floor.toFixed(3)}:enable='between(t,${Number(
        window.start_s,
      ).toFixed(3)},${Number(window.end_s).toFixed(3)})'[${next}]`,
    );
    previous = next;
  });
  return filters;
}

function buildCinematicBedFilters({
  inputIndex,
  voiceSidechainLabel,
  outputLabel = "a_soundscape",
  durationS,
  microDropWindows = [],
  policy = DEFAULT_CINEMATIC_BED_POLICY,
} = {}) {
  const merged = { ...DEFAULT_CINEMATIC_BED_POLICY, ...(policy || {}) };
  const duration = Math.max(0.5, Number(durationS) || 0.5);
  const fadeOutStart = Math.max(0, duration - merged.fade_out_s);
  const rawLabel = `${outputLabel}_raw`;
  const duckedLabel = `${outputLabel}_ducked`;
  return [
    `[${inputIndex}:a]volume=${merged.raw_volume.toFixed(
      3,
    )},highpass=f=${merged.highpass_hz},lowpass=f=${merged.lowpass_hz},atrim=duration=${duration.toFixed(
      3,
    )},afade=t=in:st=0:d=${merged.fade_in_s.toFixed(
      3,
    )},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${merged.fade_out_s.toFixed(
      3,
    )}[${rawLabel}]`,
    `[${rawLabel}][${voiceSidechainLabel}]sidechaincompress=threshold=${merged.sidechain_threshold}:ratio=${merged.sidechain_ratio}:attack=${merged.sidechain_attack_ms}:release=${merged.sidechain_release_ms}:knee=3:level_sc=1,volume=${merged.ducked_output_volume.toFixed(
      3,
    )}[${duckedLabel}]`,
    ...bedDropoutFilterChain({
      inputLabel: duckedLabel,
      outputLabel,
      microDropWindows,
      multiplier: merged.micro_drop_multiplier,
    }),
  ];
}

module.exports = {
  CINEMATIC_AUDIO_ARC_VERSION,
  CINEMATIC_SOUNDSCAPE_ROLES,
  DEFAULT_CINEMATIC_BED_POLICY,
  bedDropoutFilterChain,
  buildCinematicAudioArc,
  buildCinematicBedFilters,
  cinematicSoundscapeAssetsFromRuntimeManifest,
  cinematicCueTiming,
  desiredSoundscapeRole,
  isGovernedCinematicSoundscape,
  loadGovernedCinematicSoundscapeRuntime,
  microDropWindowsForStory,
  selectCinematicSoundscapeAsset,
};
