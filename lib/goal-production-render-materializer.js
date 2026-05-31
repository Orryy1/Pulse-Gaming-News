"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("fs-extra");

const { renderProof: defaultRenderProof } = require("./studio/v4/proof-render");
const { buildVisualV4DirectorPlan } = require("./studio/v4/director-brain");
const { runMediaHouseBenchmark } = require("./media-house-benchmark");
const { evaluateGoalPublicCopy } = require("./goal-public-copy-qa");
const mediaPaths = require("./media-paths");
const {
  STUDIO_V4_SFX_MIX_POLICY_VERSION,
  STUDIO_V4_VOICE_MIX_POLICY_VERSION,
  STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
  currentRenderPolicyManifest,
  policyVersionBlockers,
} = require("./studio/v4/render-policy");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function actionNeedsProductionRender(action = {}) {
  return cleanText(action.action_id) === "run_visual_v4_production_render";
}

function targetRenderManifestFor(job = {}) {
  return asArray(job.actions).find(actionNeedsProductionRender)?.target_render_manifest || {};
}

function jobForcesFinalRender(job = {}) {
  return (
    job.force_final_render === true ||
    asArray(job.actions).some((action) => actionNeedsProductionRender(action) && action.force === true)
  );
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

function pathOrNull(value) {
  const text = cleanText(value);
  return text || null;
}

function normalisePathKey(value) {
  return cleanText(value).replace(/\\/g, "/").toLowerCase();
}

function clipPathValue(clip = {}) {
  if (typeof clip === "string") return pathOrNull(clip);
  return pathOrNull(
    clip.local_materialized_path ||
      clip.path ||
      clip.local_path ||
      clip.file_path ||
      clip.media_path,
  );
}

function clipIdentity(clip = {}, index = 0) {
  if (typeof clip === "string") return `production_motion_${index + 1}`;
  return cleanText(clip.id || clip.asset_id || clip.motion_family || clip.source_family || `production_motion_${index + 1}`);
}

function isRealMaterialisedClip(clip = {}) {
  if (!clip || typeof clip !== "object") return false;
  const clipPath = clipPathValue(clip);
  if (!/\.mp4$/i.test(clipPath)) return false;
  if (clip.counts_towards_motion_readiness === false) return false;
  const text = [
    clip.source_url,
    clip.source_type,
    clip.media_kind,
    clip.rights_basis,
    clip.licence_basis,
    clip.allowed_use,
    clip.source_family,
  ].map(cleanText).join(" ").toLowerCase();
  if (/local:\/\/pulse-generated|output\/generated-motion/i.test(text)) return false;
  return /(?:https?:\/\/|steam|storefront|screenshot|official|publisher|press_kit|igdb)/i.test(text);
}

function isApprovedOwnedExplainerClip(clip = {}) {
  if (!clip || typeof clip !== "object") return false;
  const clipPath = clipPathValue(clip);
  if (!/\.mp4$/i.test(clipPath)) return false;
  if (clip.counts_towards_motion_readiness === false) return false;
  const text = [
    clip.source_url,
    clip.source_type,
    clip.media_kind,
    clip.rights_basis,
    clip.licence_basis,
    clip.allowed_use,
    clip.source_family,
    clip.path,
  ].map(cleanText).join(" ").toLowerCase();
  if (!/local:\/\/pulse-generated|output[\\/]generated-motion|internally_generated_motion_graphic/.test(text)) {
    return false;
  }
  return (
    clip.owned_explainer_visual_plan === true ||
    /owned_explainer_motion|owned_generated_editorial_motion_graphic/.test(text)
  );
}

function ownedExplainerMotionAllowed(materialisedMotion = {}, footageInventory = {}) {
  return (
    cleanText(materialisedMotion.status) === "ready" &&
    (
      materialisedMotion.owned_explainer_visual_plan === true ||
      footageInventory.motion_budget?.allow_owned_explainer_motion_only === true ||
      footageInventory.motion_budget?.owned_explainer_visual_plan === true ||
      footageInventory.motion_inventory?.owned_explainer_visual_plan === true
    )
  );
}

function materialisedMotionClips(materialisedMotion = {}) {
  if (Array.isArray(materialisedMotion)) return materialisedMotion.filter(Boolean);
  return [
    ...asArray(materialisedMotion.clips),
    ...asArray(materialisedMotion.materialised_clips),
    ...asArray(materialisedMotion.materialized_clips),
    ...asArray(materialisedMotion.production_motion_clips),
  ].filter(Boolean);
}

function dedupeClipObjects(clips = []) {
  const seen = new Set();
  const deduped = [];
  for (const clip of asArray(clips)) {
    const clipPath = clipPathValue(clip);
    const key = normalisePathKey(clipPath || cleanText(clip.id || clip.asset_id || clip.source_url));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...clip, path: clipPath || clip.path });
  }
  return deduped;
}

function preferredMaterialisedClips({ materialisedMotion = {}, footageInventory = {}, rightsLedger = {}, job = {} } = {}) {
  const allClips = dedupeClipObjects([
    ...rightsLedgerMotionClips(rightsLedger),
    ...materialisedMotionClips(materialisedMotion),
    ...footageMotionClips(footageInventory),
  ]);
  const realClips = allClips.filter(isRealMaterialisedClip);
  const ownedExplainerClips = allClips.filter(isApprovedOwnedExplainerClip);
  const fallbackClips = asArray(job.evidence?.materialised_motion_clip_paths)
    .map((clipPath, index) => ({
      id: `production_motion_${index + 1}`,
      path: pathOrNull(clipPath),
      source_family: `production_motion_${index + 1}`,
    }))
    .filter((clip) => clip.path);
  if (realClips.length >= 3) {
    const realKeys = new Set(realClips.map((clip) => normalisePathKey(clipPathValue(clip))).filter(Boolean));
    const ownedTopUp = fallbackClips.filter((clip) => !realKeys.has(normalisePathKey(clipPathValue(clip))));
    return [...realClips, ...ownedTopUp].slice(0, Math.max(8, realClips.length));
  }
  if (
    ownedExplainerClips.length >= 5 &&
    ownedExplainerMotionAllowed(materialisedMotion, footageInventory)
  ) {
    return ownedExplainerClips.slice(0, Math.max(8, ownedExplainerClips.length));
  }
  return fallbackClips;
}

function proofCardFromDirector(director = {}) {
  const proof = asArray(director.shot_plan).find((shot) => cleanText(shot.kind) === "proof_card");
  return {
    proof_card_primary: cleanText(proof?.label),
    proof_card_secondary: cleanText(proof?.detail),
  };
}

function lowerText(value) {
  return cleanText(value).toLowerCase();
}

function genericProofCardText(value = "") {
  return /^(?:source locked|one claim,\s*one source|proof beat|why it matters)?$/i.test(cleanText(value));
}

function semanticProofCardFromCanonical(canonical = {}) {
  const subject = cleanText(canonical.canonical_subject || canonical.canonical_game || canonical.selected_title);
  const claim = cleanText(asArray(canonical.confirmed_claims)[0] || canonical.primary_claim || canonical.narration_script);
  const text = lowerText([
    subject,
    canonical.selected_title,
    claim,
    canonical.description,
    canonical.first_spoken_line,
  ].join(" "));
  if (/\bhades ii\b/.test(text) && /\bxbox\b/.test(text) && /\bplaystation\b/.test(text) && /\bapril\s*14\b/.test(text)) {
    return {
      proof_card_primary: "APRIL 14 CONSOLE DATE",
      proof_card_secondary: "XBOX + PLAYSTATION LISTED",
    };
  }
  if (/\bmetacritic\b/.test(text) && /highest[-\s]rated|score|rated/.test(text)) {
    return {
      proof_card_primary: "METACRITIC SIGNAL",
      proof_card_secondary: "SCORE LEADS THE STORY",
    };
  }
  if (/steam/.test(text) && /xbox|forza/.test(text)) {
    return {
      proof_card_primary: "STEAM BREAKOUT",
      proof_card_secondary: "XBOX STRATEGY SIGNAL",
    };
  }
  if (/gameplay|trailer|showcase/.test(text)) {
    return {
      proof_card_primary: "OFFICIAL FOOTAGE",
      proof_card_secondary: `${subject.toUpperCase().slice(0, 28) || "GAME"} ON SCREEN`,
    };
  }
  if (claim) {
    return {
      proof_card_primary: subject ? `${subject.toUpperCase().slice(0, 28)} PROOF` : "SOURCE PROOF",
      proof_card_secondary: cleanText(canonical.primary_source || "SOURCE") .toUpperCase().slice(0, 28),
    };
  }
  return {
    proof_card_primary: "SOURCE PROOF",
    proof_card_secondary: "CLAIM CHECKED",
  };
}

function productionProofCard({ director = {}, canonical = {} } = {}) {
  const directorProof = proofCardFromDirector(director);
  if (
    !genericProofCardText(directorProof.proof_card_primary) &&
    !genericProofCardText(directorProof.proof_card_secondary)
  ) {
    return directorProof;
  }
  return semanticProofCardFromCanonical(canonical);
}

function footageMotionClips(footageInventory = {}) {
  return [
    ...asArray(footageInventory.motion_inventory?.accepted_local_clips),
    ...asArray(footageInventory.motion_inventory?.production_motion_clips),
    ...asArray(footageInventory.accepted_local_clips),
    ...asArray(footageInventory.production_motion_clips),
    ...asArray(footageInventory.clips),
  ].filter(Boolean);
}

function recordsFromRightsLedger(rightsLedger = {}) {
  if (Array.isArray(rightsLedger)) return rightsLedger.filter(Boolean);
  return [
    ...asArray(rightsLedger.records),
    ...asArray(rightsLedger.assets),
    ...asArray(rightsLedger.rights_ledger),
  ].filter(Boolean);
}

function rightsLedgerMotionClips(rightsLedger = {}) {
  return recordsFromRightsLedger(rightsLedger).filter((record) => {
    const text = [
      record.asset_type,
      record.kind,
      record.type,
      record.source_type,
      record.media_kind,
      record.path,
      record.source_url,
    ].map(cleanText).join(" ").toLowerCase();
    if (/\.(?:wav|mp3|aac|m4a|flac|ogg)(?:$|[\s?#])/i.test(text)) return false;
    if (!clipPathValue(record)) return false;
    return /motion_clip|video|direct_media|trailer|gameplay|\.mp4|\.mov|\.webm/.test(text);
  });
}

function keySuffixes(value) {
  const key = normalisePathKey(value);
  if (!key) return [];
  const outputIndex = key.lastIndexOf("/output/");
  const suffixes = [key];
  if (outputIndex >= 0) suffixes.push(key.slice(outputIndex + 1));
  const filename = key.split("/").pop();
  if (filename) suffixes.push(filename);
  return [...new Set(suffixes.filter(Boolean))];
}

function indexedRightsRecords(rightsLedger = {}) {
  const byKey = new Map();
  for (const record of recordsFromRightsLedger(rightsLedger)) {
    const keys = [
      ...keySuffixes(record.path || record.local_path || record.file_path || record.media_path),
      ...keySuffixes(record.source_url || record.url),
      cleanText(record.asset_id).toLowerCase(),
      cleanText(record.id).toLowerCase(),
      cleanText(record.source_family).toLowerCase(),
      cleanText(record.motion_family).toLowerCase(),
    ].filter(Boolean);
    for (const key of keys) if (!byKey.has(key)) byKey.set(key, record);
  }
  return byKey;
}

function matchingRightsRecord(clip = {}, rightsByKey = new Map()) {
  const keys = [
    ...keySuffixes(clipPathValue(clip)),
    ...keySuffixes(clip.source_url || clip.url),
    cleanText(clip.asset_id).toLowerCase(),
    cleanText(clip.id).toLowerCase(),
    cleanText(clip.source_family).toLowerCase(),
    cleanText(clip.motion_family).toLowerCase(),
  ].filter(Boolean);
  for (const key of keys) {
    if (rightsByKey.has(key)) return rightsByKey.get(key);
  }
  return null;
}

function productionClipObjects({ footageInventory = {}, rightsLedger = {}, job = {}, materialisedMotion = {} } = {}) {
  const byPath = new Map();
  for (const clip of footageMotionClips(footageInventory)) {
    const key = normalisePathKey(clip.path || clip.local_path || clip.file_path || clip.media_path);
    if (key && !byPath.has(key)) byPath.set(key, clip);
  }
  const rightsByKey = indexedRightsRecords(rightsLedger);
  const preferred = preferredMaterialisedClips({ materialisedMotion, footageInventory, rightsLedger, job });
  const selected = preferred.length
    ? preferred.map((clip, index) => {
        const clipPath = clipPathValue(clip);
        const key = normalisePathKey(clipPath);
        const source = byPath.get(key) || matchingRightsRecord(clip, rightsByKey) || clip || {};
        const rights = matchingRightsRecord(source, rightsByKey) || matchingRightsRecord(clip, rightsByKey) || {};
        return {
          ...rights,
          ...source,
          ...clip,
          id: clipIdentity({ ...rights, ...source, ...clip }, index),
          path: clipPath,
          source_url: cleanText(clip.source_url || source.source_url || source.url || rights.source_url || rights.url),
          source_type: cleanText(clip.source_type || source.source_type || source.asset_type || rights.source_type || rights.asset_type || "materialised_motion_clip"),
          source_family: cleanText(clip.source_family || clip.motion_family || source.source_family || source.motion_family || rights.source_family || rights.motion_family || source.id || source.asset_id || `production_motion_${index + 1}`),
          media_kind: cleanText(clip.media_kind || source.media_kind || rights.media_kind),
        };
      })
    : footageMotionClips(footageInventory);
  const seen = new Set();
  const clips = [];
  for (const clip of selected) {
    const key = normalisePathKey(clip.path || clip.local_path || clip.file_path || clip.media_path || clip.source_url || clip.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    clips.push(clip);
  }
  return clips;
}

function clipFamily(clip = {}, index = 0) {
  return (
    cleanText(clip.source_family) ||
    cleanText(clip.motion_family) ||
    cleanText(clip.asset_id) ||
    cleanText(clip.id) ||
    `production_motion_${index + 1}`
  ).toLowerCase();
}

function statusText(value) {
  return cleanText(value).toLowerCase();
}

function passStatus(value) {
  return ["pass", "green", "viral_ready", "director_ready", "ready"].includes(statusText(value));
}

function failStatus(value) {
  return ["fail", "failed", "red", "blocked", "blocked_or_rewrite_required"].includes(statusText(value));
}

function rightsCheckStatus(rightsLedger = {}) {
  if (passStatus(rightsLedger.verdict || rightsLedger.result)) return "pass";
  if (failStatus(rightsLedger.verdict || rightsLedger.result)) return "fail";
  if (recordsFromRightsLedger(rightsLedger).length || asArray(rightsLedger.assets).length) return "pass";
  return "not_checked";
}

function buildPostRenderForensicQaReport({
  storyId = "",
  generatedAt = new Date().toISOString(),
  renderManifest = {},
  renderReport = {},
  outputPath = "",
  scriptScorecard = {},
  coherenceReport = {},
  rightsLedger = {},
  directorPlan = {},
  benchmark = {},
  visualQuality = {},
  clips = [],
  audioSegmentReport = {},
  voiceQualityReport = {},
  captionManifest = {},
} = {}) {
  const distinctFamilies = new Set(asArray(clips).map(clipFamily).filter(Boolean));
  const visualProfile =
    visualQuality.visual_evidence_profile ||
    benchmark.visual_evidence_profile ||
    {};
  const visualProfileFamilyCount =
    Number(visualProfile.real_media_family_count || 0) +
    Number(visualProfile.generated_motion_family_count || 0);
  const motionEvidenceCount = Math.max(
    clips.length,
    Number(visualProfile.motion_asset_count || 0),
  );
  const familyEvidenceCount = Math.max(
    distinctFamilies.size,
    visualProfileFamilyCount,
    Number(visualProfile.direct_video_motion_family_count || 0),
  );
  const minMotionClips = Math.max(3, Number(directorPlan.shot_budget?.min_actual_motion_clips || 0) || 0);
  const minFamilies = Math.max(3, Number(directorPlan.shot_budget?.min_distinct_motion_families || 0) || 0);
  const outputReady = renderManifest.final_publish_render === true && cleanText(outputPath || renderManifest.output_path || renderManifest.output);
  const motionFloorPass = motionEvidenceCount >= minMotionClips && !asArray(visualProfile.blockers).length;
  const familyFloorPass = familyEvidenceCount >= minFamilies && !asArray(visualProfile.blockers).length;
  const directorRawStatus =
    directorPlan.readiness?.status ||
    (asArray(directorPlan.shot_plan).length ? "director_ready" : "not_checked");
  const directorRawBlockers = asArray(directorPlan.readiness?.blockers).map(cleanText).filter(Boolean);
  const unresolvedDirectorBlockers = directorRawBlockers.filter((blocker) => {
    if (/actual_motion_clip_minimum_not_met/.test(blocker) && motionFloorPass) return false;
    if (/distinct_motion_families_minimum_not_met/.test(blocker) && familyFloorPass) return false;
    return true;
  });
  const checks = {
    final_render_mp4: outputReady ? "pass" : "fail",
    public_output: coherenceReport.result || coherenceReport.verdict || "not_checked",
    rights: rightsCheckStatus(rightsLedger),
    script: scriptScorecard.verdict || "not_checked",
    director: unresolvedDirectorBlockers.length ? directorRawStatus : "director_ready",
    benchmark: benchmark.result || "not_checked",
    visual_quality: visualQuality.result || benchmark.result || "not_checked",
    motion_clip_floor: motionFloorPass ? "pass" : "fail",
    distinct_motion_families: familyFloorPass ? "pass" : "fail",
    audio_loudness: audioSegmentReport.verdict || "not_checked",
    voice_quality: voiceQualityReport.verdict || voiceQualityReport.status || "not_checked",
    captions: captionManifest.verdict || captionManifest.status || "not_checked",
  };
  const blockers = [];
  if (checks.final_render_mp4 !== "pass") blockers.push("final_render_mp4_missing_or_not_final");
  if (failStatus(checks.public_output)) blockers.push("public_output_coherence_failed");
  if (checks.rights === "fail") blockers.push("rights_ledger_failed");
  if (failStatus(checks.script)) blockers.push("script_scorecard_failed");
  if (failStatus(checks.director)) blockers.push("director_plan_failed");
  if (failStatus(checks.benchmark)) blockers.push(...asArray(benchmark.failures), "benchmark_failed");
  if (failStatus(checks.visual_quality)) blockers.push(...asArray(visualQuality.failures), "visual_quality_failed");
  if (checks.motion_clip_floor !== "pass") blockers.push("actual_motion_clip_minimum_not_met");
  if (checks.distinct_motion_families !== "pass") blockers.push("distinct_motion_families_minimum_not_met");
  if (failStatus(checks.audio_loudness)) blockers.push("audio_loudness_failed");
  if (failStatus(checks.voice_quality)) blockers.push("voice_quality_failed");
  if (failStatus(checks.captions)) blockers.push("caption_manifest_failed");
  blockers.push(
    ...asArray(scriptScorecard.blockers),
    ...asArray(coherenceReport.failures),
    ...asArray(coherenceReport.blockers),
    ...asArray(rightsLedger.failures),
    ...unresolvedDirectorBlockers,
    ...asArray(audioSegmentReport.blockers),
    ...asArray(voiceQualityReport.blockers),
  );
  const uniqueBlockers = [...new Set(blockers.map(cleanText).filter(Boolean))];
  const result = uniqueBlockers.length ? "fail" : "pass";
  return {
    schema_version: 1,
    generated_at: generatedAt,
    story_id: cleanText(storyId || renderManifest.story_id),
    verdict: result === "pass" ? "post_render_forensics_passed" : "blocked_or_rewrite_required",
    result,
    checks,
    blockers: uniqueBlockers,
    warnings: [
      ...asArray(benchmark.warnings),
      ...asArray(visualQuality.warnings),
      ...asArray(audioSegmentReport.warnings),
      ...asArray(voiceQualityReport.warnings),
    ].map(cleanText).filter(Boolean),
    evidence: {
      final_render_path: pathOrNull(outputPath || renderManifest.output_path || renderManifest.output),
      final_publish_render: renderManifest.final_publish_render === true,
      render_generated_at: cleanText(renderManifest.generated_at),
      rendered_duration_s: renderReport.rendered_duration_s ?? renderManifest.rendered_duration_s ?? null,
      selected_motion_clip_count: clips.length,
      selected_distinct_motion_family_count: distinctFamilies.size,
      motion_clip_count: motionEvidenceCount,
      distinct_motion_family_count: familyEvidenceCount,
      visual_evidence_profile: visualProfile,
      benchmark_scores: benchmark.scores || {},
      visual_quality_scores: visualQuality.scores || benchmark.scores || {},
    },
    repair_source: "post_render_quality_refresh",
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      renderer_invoked: false,
    },
  };
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

async function sha256File(filePath) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalInputSnapshot(canonical = {}) {
  return {
    story_id: cleanText(canonical.story_id),
    selected_title: cleanText(canonical.selected_title || canonical.short_title),
    thumbnail_headline: cleanText(canonical.thumbnail_headline || canonical.thumbnail_text),
    first_spoken_line: cleanText(canonical.first_spoken_line || canonical.narration_hook),
    narration_script: cleanText(canonical.narration_script),
    canonical_subject: cleanText(canonical.canonical_subject || canonical.canonical_game),
    canonical_angle: cleanText(canonical.canonical_angle),
    primary_source: cleanText(canonical.primary_source || canonical.source_card_label),
    public_copy_repaired_at: cleanText(canonical.public_copy_repaired_at),
    duration_variant_repaired_at: cleanText(canonical.duration_variant_repaired_at),
  };
}

async function buildRenderInputFingerprint({
  canonical = {},
  audioPath,
  timestampsPath,
  audioStat,
  timestampsStat,
} = {}) {
  const canonical_snapshot = canonicalInputSnapshot(canonical);
  const audio_sha256 = await sha256File(audioPath);
  const word_timestamps_sha256 = await sha256File(timestampsPath);
  const fingerprintSource = {
    canonical_snapshot,
    audio_sha256,
    word_timestamps_sha256,
    audio_size_bytes: Number(audioStat?.size || 0),
    word_timestamps_size_bytes: Number(timestampsStat?.size || 0),
  };
  return {
    algorithm: "sha256",
    signature: sha256Text(stableJson(fingerprintSource)),
    canonical_public_copy_hash: sha256Text(stableJson(canonical_snapshot)),
    audio_sha256,
    word_timestamps_sha256,
    audio_size_bytes: fingerprintSource.audio_size_bytes,
    word_timestamps_size_bytes: fingerprintSource.word_timestamps_size_bytes,
    canonical_snapshot,
  };
}

function finalRenderOutputPath(job = {}) {
  const target = targetRenderManifestFor(job);
  const artifactDir = path.resolve(job.artifact_dir || "");
  return path.resolve(target.output_path || path.join(artifactDir, "visual_v4_render.mp4"));
}

function finalRenderManifestPath(job = {}) {
  const target = targetRenderManifestFor(job);
  const artifactDir = path.resolve(job.artifact_dir || "");
  return path.resolve(target.manifest_path || path.join(artifactDir, "render_manifest.json"));
}

async function hasExistingFinalRender(job = {}, inputState = {}) {
  const outputPath = finalRenderOutputPath(job);
  const manifestPath = finalRenderManifestPath(job);
  if (!(await fs.pathExists(outputPath)) || !(await fs.pathExists(manifestPath))) return false;
  const stat = await fs.stat(outputPath);
  if (!stat.isFile() || stat.size < 1024) return false;
  const manifest = await readJsonIfPresent(manifestPath, {});
  const isFinalRender =
    manifest.final_publish_render === true &&
    cleanText(manifest.renderer) === "visual_v4_production" &&
    cleanText(manifest.visual_tier) === "production_v4_motion";
  if (!isFinalRender) return false;
  if (!manifest.input_fingerprint?.signature) return false;
  if (manifest.input_fingerprint.signature !== inputState.inputFingerprint?.signature) return false;
  if (policyVersionBlockers(manifest).length) return false;

  const freshnessFloorMs = Math.max(
    Number.isFinite(inputState.repairedAtMs) ? inputState.repairedAtMs : 0,
    Number(inputState.audioStat?.mtimeMs || 0),
    Number(inputState.timestampsStat?.mtimeMs || 0),
  );
  if (freshnessFloorMs > 0 && stat.mtimeMs + 1000 < freshnessFloorMs) return false;
  return true;
}

function resolveWorkspacePath(filePath, workspaceRoot = process.cwd()) {
  const text = cleanText(filePath);
  if (!text) return null;
  if (path.isAbsolute(text)) return text;
  const mediaResolved = mediaPaths.resolveExistingSync(text);
  if (mediaResolved && fs.existsSync(mediaResolved)) return mediaResolved;
  return path.resolve(workspaceRoot, text);
}

async function statUsableFile(filePath, minBytes = 1) {
  if (!filePath || !(await fs.pathExists(filePath))) return null;
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size < minBytes) return null;
  return stat;
}

async function validateRenderInputs(job = {}, { workspaceRoot = process.cwd() } = {}) {
  const artifactDir = path.resolve(job.artifact_dir || "");
  const canonicalPath = path.join(artifactDir, "canonical_story_manifest.json");
  const canonical = await readJsonIfPresent(canonicalPath, {});
  const audioPath = resolveWorkspacePath(job.evidence?.narration_audio_path, workspaceRoot);
  const timestampsPath = resolveWorkspacePath(job.evidence?.word_timestamps_path, workspaceRoot);
  const audioStat = await statUsableFile(audioPath, 1024);
  const timestampsStat = await statUsableFile(timestampsPath, 16);
  const missing = [];
  if (!audioStat) missing.push("narration_audio_path");
  if (!timestampsStat) missing.push("word_timestamps_path");
  if (missing.length) throw new Error(`render_input_missing:${missing.join(",")}`);

  const publicCopyQa = evaluateGoalPublicCopy(canonical);
  if (publicCopyQa.verdict !== "pass") {
    throw new Error(`render_input_public_copy_failed:${asArray(publicCopyQa.failures).join(",")}`);
  }

  const repairEvents = [
    {
      at: Date.parse(canonical.public_copy_repaired_at || ""),
      reason: "render_input_stale_after_public_copy_repair",
    },
    {
      at: Date.parse(canonical.duration_variant_repaired_at || ""),
      reason: "render_input_stale_after_duration_variant_repair",
    },
  ].filter((event) => Number.isFinite(event.at)).sort((a, b) => b.at - a.at);
  const latestRepairEvent = repairEvents[0] || null;
  if (latestRepairEvent) {
    const stale = [];
    if (audioStat.mtimeMs + 1000 < latestRepairEvent.at) stale.push("narration_audio_path");
    if (timestampsStat.mtimeMs + 1000 < latestRepairEvent.at) stale.push("word_timestamps_path");
    if (stale.length) {
      throw new Error(`${latestRepairEvent.reason}:${stale.join(",")}`);
    }
  }

  return {
    artifactDir,
    canonicalPath,
    canonical,
    audioPath,
    timestampsPath,
    audioStat,
    timestampsStat,
    repairedAtMs: latestRepairEvent?.at ?? null,
    inputFingerprint: await buildRenderInputFingerprint({
      canonical,
      audioPath,
      timestampsPath,
      audioStat,
      timestampsStat,
    }),
  };
}

async function stampPublicCopyRenderRegenerated({
  job = {},
  inputState = {},
  completedAt,
  status = "rendered",
} = {}) {
  const repairedAt = cleanText(inputState.canonical?.public_copy_repaired_at);
  const canonicalPath = inputState.canonicalPath ||
    path.join(path.resolve(job.artifact_dir || ""), "canonical_story_manifest.json");
  if (!(await fs.pathExists(canonicalPath))) return null;
  const current = await readJsonIfPresent(canonicalPath, null);
  if (!current || typeof current !== "object") return null;
  const completed = cleanText(completedAt) || new Date().toISOString();
  const completedMs = Date.parse(completed);
  const durationVariantRepairedAt = cleanText(current.duration_variant_repaired_at);
  const durationVariantRepairMs = Date.parse(durationVariantRepairedAt || "");
  const shouldStampPublicCopy = Boolean(repairedAt);
  const shouldStampDurationVariant =
    Number.isFinite(completedMs) &&
    Number.isFinite(durationVariantRepairMs) &&
    completedMs + 1000 >= durationVariantRepairMs;
  if (!shouldStampPublicCopy && !shouldStampDurationVariant) return null;
  const updated = {
    ...current,
    ...(shouldStampPublicCopy
      ? {
          public_copy_final_render_regenerated_at: completed,
          public_copy_regeneration_completed_at: completed,
          public_copy_regeneration_status: status,
          public_copy_regenerated_render_path: finalRenderOutputPath(job),
          public_copy_regenerated_render_manifest_path: finalRenderManifestPath(job),
        }
      : {}),
    ...(shouldStampDurationVariant
      ? {
          duration_variant_status: "repaired_rendered",
          duration_variant_final_render_regenerated_at: completed,
          duration_variant_regeneration_completed_at: completed,
          duration_variant_regeneration_status: status,
          duration_variant_regenerated_render_path: finalRenderOutputPath(job),
          duration_variant_regenerated_render_manifest_path: finalRenderManifestPath(job),
        }
      : {}),
  };
  await fs.writeJson(canonicalPath, updated, { spaces: 2 });
  return {
    canonicalPath,
    ...(shouldStampPublicCopy
      ? { public_copy_regeneration_completed_at: completed }
      : {}),
    ...(shouldStampDurationVariant
      ? { duration_variant_regeneration_completed_at: completed }
      : {}),
  };
}

async function buildRendererStoryJson(job = {}, { generatedAt } = {}) {
  const artifactDir = path.resolve(job.artifact_dir || "");
  const [canonical, director, materialisedMotion, footageInventory, rightsLedger, sfxManifest] = await Promise.all([
    readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "director_beat_map.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "materialised_motion_clips.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "footage_inventory.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "rights_ledger.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "sfx_manifest.json"), {}),
  ]);
  const proofCard = productionProofCard({ director, canonical });
  const storyId = cleanText(job.story_id || canonical.story_id);
  const preferredClips = preferredMaterialisedClips({ materialisedMotion, footageInventory, rightsLedger, job });
  const preferredClipPaths = preferredClips.map(clipPathValue).filter(Boolean);
  const sfxAssets = asArray(
    sfxManifest.source_plan?.selected_assets ||
      sfxManifest.selected_assets ||
      sfxManifest.assets ||
      canonical.sfx_asset_inventory,
  );
  const story = {
    id: storyId,
    story_id: storyId,
    title: cleanText(canonical.selected_title || canonical.short_title || job.title),
    canonical_subject: cleanText(canonical.canonical_subject || canonical.canonical_game || job.title),
    canonical_angle: cleanText(canonical.canonical_angle || ""),
    primary_source: cleanText(canonical.primary_source || canonical.source_card_label || ""),
    first_frame_text: cleanText(canonical.thumbnail_headline || canonical.thumbnail_text || ""),
    mobile_hook_text: cleanText(canonical.first_spoken_line || canonical.narration_hook || ""),
    thumbnail_headline: cleanText(canonical.thumbnail_headline || canonical.thumbnail_text || ""),
    primary_claim: cleanText(asArray(canonical.confirmed_claims)[0] || canonical.narration_hook || ""),
    player_impact: cleanText(canonical.first_spoken_line || ""),
    commercial_safe_cta: cleanText(canonical.platform_ctas?.youtube || ""),
    narration_script: cleanText(canonical.narration_script || ""),
    full_script: cleanText(canonical.narration_script || ""),
    tts_script: cleanText(canonical.narration_script || ""),
    audio_path: pathOrNull(job.evidence?.narration_audio_path),
    timestamps_path: pathOrNull(job.evidence?.word_timestamps_path),
    video_clips: preferredClipPaths,
    visual_v4_bridge_video_clips: preferredClips.map((clip, index) => ({
      id: clipIdentity(clip, index),
      path: clipPathValue(clip),
      source_url: cleanText(clip.source_url || clip.url),
      source_type: cleanText(clip.source_type || clip.asset_type),
      source_family: cleanText(clip.source_family || clip.motion_family),
      media_kind: cleanText(clip.media_kind),
    })),
    sfx_asset_inventory: sfxAssets,
    sound_transition_plan: director.sound_transition_plan || null,
    visual_v4_director_plan: director,
    generated_at: generatedAt,
    render_invocation_mode: "final_production_render",
    ...proofCard,
  };
  const storyJsonPath = path.join(artifactDir, "visual_v4_render_story.json");
  await fs.writeJson(storyJsonPath, story, { spaces: 2 });
  return { storyJsonPath, story };
}

async function refreshPostRenderQualityArtifacts({
  job = {},
  renderReport = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const artifactDir = path.resolve(job.artifact_dir || "");
  const [
    canonical,
    footageInventory,
    rightsLedger,
    materialisedMotion,
    sfxManifest,
    renderManifest,
    scriptScorecard,
    coherenceReport,
    audioSegmentReport,
    voiceQualityReport,
    captionManifest,
  ] = await Promise.all([
    readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "footage_inventory.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "rights_ledger.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "materialised_motion_clips.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "sfx_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "render_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "script_scorecard.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "coherence_report.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "audio_segment_loudness_report.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "voice_quality_report.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "caption_manifest.json"), {}),
  ]);
  const clips = productionClipObjects({ footageInventory, rightsLedger, job, materialisedMotion });
  if (clips.length < 3) return null;

  const storyId = cleanText(job.story_id || canonical.story_id);
  const sfxAssets = asArray(
    sfxManifest.source_plan?.selected_assets ||
      sfxManifest.selected_assets ||
      sfxManifest.assets ||
      canonical.sfx_asset_inventory,
  );
  const story = {
    ...canonical,
    id: storyId,
    story_id: storyId,
    title: cleanText(canonical.selected_title || canonical.short_title || job.title),
    suggested_title: cleanText(canonical.selected_title || canonical.short_title || job.title),
    public_title: cleanText(canonical.selected_title || canonical.short_title || job.title),
    canonical_subject: cleanText(canonical.canonical_subject || canonical.canonical_game || job.title),
    hook: cleanText(canonical.first_spoken_line || canonical.narration_hook || canonical.narration_script),
    full_script: cleanText(canonical.narration_script || canonical.full_script),
    tts_script: cleanText(canonical.narration_script || canonical.full_script),
    suggested_thumbnail_text: cleanText(canonical.thumbnail_headline || canonical.thumbnail_text),
    thumbnail_text: cleanText(canonical.thumbnail_headline || canonical.thumbnail_text),
    source_card_label: cleanText(canonical.source_card_label || canonical.primary_source),
    video_clips: clips,
    visual_v4_bridge_video_clips: clips,
    rights_ledger: recordsFromRightsLedger(rightsLedger),
    sfx_asset_inventory: sfxAssets,
    clean_manual_captions: true,
    manual_caption_generated: true,
    subtitle_timing_source: "timestamps",
  };
  const directorPlan = buildVisualV4DirectorPlan({
    story,
    footagePlan: footageInventory,
    localTimeline: {
      duration_s: renderReport.rendered_duration_s,
      durationS: renderReport.rendered_duration_s,
    },
    sfxAssetInventory: sfxAssets,
    sfxRightsLedger: recordsFromRightsLedger(rightsLedger),
    generatedAt,
  });
  const benchmark = runMediaHouseBenchmark({
    story,
    directorPlan,
    rightsLedger,
    footageInventory,
    requireGate: true,
  });
  const visualQuality = {
    ...benchmark,
    report_type: "post_render_visual_quality_report",
    benchmark_source: "actual_materialised_motion_clips",
  };
  const forensicQa = buildPostRenderForensicQaReport({
    storyId,
    generatedAt,
    renderManifest,
    renderReport,
    outputPath: renderManifest.output_path || path.join(artifactDir, renderManifest.output || "visual_v4_render.mp4"),
    scriptScorecard,
    coherenceReport,
    rightsLedger,
    directorPlan,
    benchmark,
    visualQuality,
    clips,
    audioSegmentReport,
    voiceQualityReport,
    captionManifest,
  });

  await fs.writeJson(path.join(artifactDir, "director_beat_map.json"), directorPlan, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "benchmark_report.json"), benchmark, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "visual_quality_report.json"), visualQuality, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "forensic_qa_report.json"), forensicQa, { spaces: 2 });
  await fs.writeJson(
    path.join(artifactDir, "render_manifest.json"),
    {
      ...renderManifest,
      quality_gate_status:
        forensicQa.result === "pass"
          ? "post_render_forensics_passed"
          : "post_render_forensics_failed",
      post_render_quality_refreshed_at: generatedAt,
      post_render_forensic_result: forensicQa.result,
      post_render_forensic_blockers: forensicQa.blockers,
    },
    { spaces: 2 },
  );
  return {
    benchmark_result: benchmark.result,
    benchmark_scores: benchmark.scores,
    forensic_result: forensicQa.result,
    forensic_blockers: forensicQa.blockers,
    clip_count: clips.length,
    director_motion_shot_count: asArray(directorPlan.shot_plan).filter((shot) => cleanText(shot.kind) === "motion_clip").length,
  };
}

async function refreshFinalRenderQualityOnly({
  artifactDir,
  storyId = "",
  generatedAt = new Date().toISOString(),
} = {}) {
  const resolvedArtifactDir = path.resolve(artifactDir || "");
  const renderManifest = await readJsonIfPresent(path.join(resolvedArtifactDir, "render_manifest.json"), {});
  const outputPath = resolveWorkspacePath(
    renderManifest.output_path || path.join(resolvedArtifactDir, renderManifest.output || "visual_v4_render.mp4"),
  );
  if (renderManifest.final_publish_render !== true) {
    return {
      story_id: cleanText(storyId || renderManifest.story_id),
      status: "blocked",
      blocker: "render_not_final_publish_ready",
      artifact_dir: resolvedArtifactDir,
    };
  }
  const outputStat = await statUsableFile(outputPath, 1024);
  if (!outputStat) {
    return {
      story_id: cleanText(storyId || renderManifest.story_id),
      status: "blocked",
      blocker: "final_render_mp4_missing",
      artifact_dir: resolvedArtifactDir,
      output_path: outputPath,
    };
  }
  const refresh = await refreshPostRenderQualityArtifacts({
    job: {
      story_id: cleanText(storyId || renderManifest.story_id),
      artifact_dir: resolvedArtifactDir,
    },
    renderReport: {
      rendered_duration_s: renderManifest.rendered_duration_s,
      duration_s: renderManifest.rendered_duration_s,
      clips: renderManifest.clips,
    },
    generatedAt,
  });
  const canonicalPath = path.join(resolvedArtifactDir, "canonical_story_manifest.json");
  const canonical = await readJsonIfPresent(canonicalPath, {});
  const completedAt =
    cleanText(renderManifest.generated_at) ||
    (Number.isFinite(Number(outputStat.mtimeMs))
      ? new Date(Number(outputStat.mtimeMs)).toISOString()
      : generatedAt);
  const lineageStamp = await stampPublicCopyRenderRegenerated({
    job: {
      story_id: cleanText(storyId || renderManifest.story_id),
      artifact_dir: resolvedArtifactDir,
    },
    inputState: {
      canonicalPath,
      canonical,
    },
    completedAt,
    status: "quality_refreshed",
  });
  return {
    story_id: cleanText(storyId || renderManifest.story_id),
    status: "quality_refreshed",
    artifact_dir: resolvedArtifactDir,
    output_path: outputPath,
    benchmark_result: refresh.benchmark_result,
    benchmark_scores: refresh.benchmark_scores,
    forensic_result: refresh.forensic_result,
    forensic_blockers: refresh.forensic_blockers,
    clip_count: refresh.clip_count,
    director_motion_shot_count: refresh.director_motion_shot_count,
    canonical_lineage_stamp: lineageStamp,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      renderer_invoked: false,
    },
  };
}

async function writeFinalRenderManifest({
  job = {},
  renderReport = {},
  inputState = {},
  generatedAt,
} = {}) {
  const manifestPath = finalRenderManifestPath(job);
  const outputPath = finalRenderOutputPath(job);
  const stat = await fs.stat(outputPath);
  const manifest = {
    schema_version: 1,
    story_id: cleanText(job.story_id),
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    output: "visual_v4_render.mp4",
    output_path: outputPath,
    generated_at: generatedAt,
    render_basis: "fresh visual v4 production render generated from final render inputs",
    render_invocation_mode: "final_production_render",
    engine: "studio_v4_creator_studio_renderer",
    source_renderer_engine: "studio_v4_render_engine",
    file_size_bytes: stat.size,
    rendered_duration_s: renderReport.rendered_duration_s ?? null,
    clips: renderReport.clips ?? null,
    ...currentRenderPolicyManifest(),
    input_fingerprint: inputState.inputFingerprint || null,
    input_evidence: {
      narration_audio_path: pathOrNull(job.evidence?.narration_audio_path),
      resolved_narration_audio_path: pathOrNull(inputState.audioPath),
      word_timestamps_path: pathOrNull(job.evidence?.word_timestamps_path),
      resolved_word_timestamps_path: pathOrNull(inputState.timestampsPath),
      public_copy_repaired_at: cleanText(inputState.canonical?.public_copy_repaired_at),
    },
    quality_gate_status: "pending_post_render_forensics",
    no_publish_triggered: true,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_local_proof_promoted_to_final: true,
    },
  };
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });
  return { manifestPath, manifest };
}

async function materializeProductionRenderJob(job = {}, options = {}) {
  const storyId = cleanText(job.story_id);
  const outputPath = finalRenderOutputPath(job);
  if (options.inspectOnly) {
    return {
      story_id: storyId,
      title: cleanText(job.title),
      status: "inspect_only_pending_render",
      output_path: outputPath,
    };
  }
  const inputState = await validateRenderInputs(job, {
    workspaceRoot: options.workspaceRoot,
  });
  if (!options.force && !jobForcesFinalRender(job) && (await hasExistingFinalRender(job, inputState))) {
    const existingManifest = await readJsonIfPresent(finalRenderManifestPath(job), {});
    const completion = await stampPublicCopyRenderRegenerated({
      job,
      inputState,
      completedAt: existingManifest.generated_at || options.generatedAt,
      status: "skipped_existing_final_render",
    });
    return {
      story_id: storyId,
      title: cleanText(job.title),
      status: "skipped_existing_final_render",
      output_path: outputPath,
      public_copy_regeneration: completion,
    };
  }
  const { storyJsonPath } = await buildRendererStoryJson(job, {
    generatedAt: options.generatedAt,
  });
  await fs.ensureDir(path.dirname(outputPath));
  const renderReport = await options.renderProof({
    storyJson: storyJsonPath,
    output: outputPath,
  });
  if (!(await fs.pathExists(outputPath))) throw new Error("production_render_output_missing");
  const stat = await fs.stat(outputPath);
  if (!stat.isFile() || stat.size < 1024) throw new Error("production_render_output_too_small");
  await writeFinalRenderManifest({
    job,
    renderReport,
    inputState,
    generatedAt: options.generatedAt,
  });
  const publicCopyRegeneration = await stampPublicCopyRenderRegenerated({
    job,
    inputState,
    completedAt: options.generatedAt,
    status: "rendered",
  });
  const qualityRefresh = await refreshPostRenderQualityArtifacts({
    job,
    renderReport,
    generatedAt: options.generatedAt,
  });
  return {
    story_id: storyId,
    title: cleanText(job.title),
    status: "rendered",
    output_path: outputPath,
    render_manifest_path: finalRenderManifestPath(job),
    size_bytes: stat.size,
    clips: renderReport.clips ?? null,
    rendered_duration_s: renderReport.rendered_duration_s ?? null,
    post_render_quality_refresh: qualityRefresh,
    public_copy_regeneration: publicCopyRegeneration,
  };
}

function jobsForProductionRender(workOrder = {}, { limit = 0 } = {}) {
  let jobs = asArray(workOrder.jobs).filter(
    (job) =>
      cleanText(job.status) === "ready_for_final_render_job" &&
      asArray(job.actions).some(actionNeedsProductionRender),
  );
  if (Number(limit) > 0) jobs = jobs.slice(0, Number(limit));
  return jobs;
}

async function materializeGoalProductionRenders({
  workOrder = {},
  workspaceRoot = process.cwd(),
  generatedAt = new Date().toISOString(),
  limit = 0,
  force = false,
  inspectOnly = false,
  renderProof = defaultRenderProof,
} = {}) {
  const jobs = jobsForProductionRender(workOrder, { limit });
  const results = [];
  for (const job of jobs) {
    try {
      results.push(
        await materializeProductionRenderJob(job, {
          workspaceRoot,
          generatedAt,
          force,
          inspectOnly,
          renderProof,
        }),
      );
    } catch (error) {
      results.push({
        story_id: cleanText(job.story_id),
        title: cleanText(job.title),
        status: "failed",
        error: error.message,
      });
    }
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "PRODUCTION_RENDER_MATERIALIZER",
    source_work_order_generated_at: workOrder.generated_at || null,
    summary: {
      candidate_count: jobs.length,
      rendered_count: results.filter((job) => job.status === "rendered").length,
      failed_count: results.filter((job) => job.status === "failed").length,
      skipped_existing_count: results.filter((job) => job.status === "skipped_existing_final_render").length,
      inspect_only_count: results.filter((job) => job.status === "inspect_only_pending_render").length,
    },
    jobs: results,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
      no_local_proof_promoted_to_final: true,
      renderer_invoked: inspectOnly !== true,
    },
  };
}

function renderGoalProductionRenderMaterializationMarkdown(report = {}) {
  const lines = [];
  lines.push("# Production Render Materialization");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Candidates: ${report.summary?.candidate_count || 0}`);
  lines.push(`Rendered: ${report.summary?.rendered_count || 0}`);
  lines.push(`Existing final renders: ${report.summary?.skipped_existing_count || 0}`);
  lines.push(`Inspect-only: ${report.summary?.inspect_only_count || 0}`);
  lines.push(`Failed: ${report.summary?.failed_count || 0}`);
  lines.push("");
  lines.push("## Jobs");
  for (const job of asArray(report.jobs).slice(0, 40)) {
    const suffix = job.error ? `; error: ${job.error}` : "";
    lines.push(`- ${job.story_id}: ${job.status}${suffix}`);
  }
  if (!asArray(report.jobs).length) lines.push("- none");
  lines.push("");
  lines.push("Safety: final render materialisation only. No publish, database, token or OAuth change was triggered.");
  return `${lines.join("\n")}\n`;
}

async function writeGoalProductionRenderMaterializationReport(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoalProductionRenderMaterializationReport requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "production_render_materialization_report.json");
  const markdownPath = path.join(outDir, "production_render_materialization_report.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGoalProductionRenderMaterializationMarkdown(report), "utf8");
  return { outputDir: outDir, jsonPath, markdownPath };
}

module.exports = {
  materializeGoalProductionRenders,
  refreshFinalRenderQualityOnly,
  renderGoalProductionRenderMaterializationMarkdown,
  writeGoalProductionRenderMaterializationReport,
  buildRendererStoryJson,
  jobsForProductionRender,
};
