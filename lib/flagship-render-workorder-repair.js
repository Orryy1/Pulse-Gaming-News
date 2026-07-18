"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");
const {
  evaluateGenuineBaseSourceDiversity,
} = require("./genuine-base-source-diversity");
const { pronunciationScriptDiverges } = require("./goal-public-copy-qa");
const { applyGamingPronunciation } = require("./tts-pronunciation");
const { ffprobeDuration: defaultFfprobeDuration } = require("./studio/media-acquisition");

const WORK_ORDER_MODE = "LOCAL_PROOF_FLAGSHIP_RENDER_REPAIR";
const RENDER_ACTION_ID = "run_visual_v4_production_render";
const REPEAT_FREE_TRANSITION_DURATION_S = 0.25;
const MEDIA_DURATION_TOLERANCE_S = 0.12;
const SCRIPT_REPAIR_RIGHTS_TRANSITION_BLOCKER =
  "narration_and_render_regeneration_required_after_script_repair";
const STALE_DERIVED_EVIDENCE_PATHS = Object.freeze([
  "narration_manifest.json",
  "caption_manifest.json",
  "captions.srt",
  "visual_v4_render_story.json",
  "flagship",
  "platform_variants",
  "production-report",
  "qa/decoded-visual",
]);
const BASE_SOURCE_ID_FIELDS = Object.freeze([
  "base_source_id",
  "baseSourceId",
  "base_source_asset_id",
  "baseSourceAssetId",
  "master_source_id",
  "masterSourceId",
  "original_source_id",
  "originalSourceId",
  "source_asset_id",
  "sourceAssetId",
  "youtube_video_id",
  "youtubeVideoId",
  "source_youtube_id",
  "sourceYoutubeId",
]);
const BASE_SOURCE_URL_FIELDS = Object.freeze([
  "canonical_source_url",
  "canonicalSourceUrl",
  "master_source_url",
  "masterSourceUrl",
  "original_source_url",
  "originalSourceUrl",
  "reference_url",
  "referenceUrl",
  "source_url",
  "sourceUrl",
]);
const BASE_SOURCE_HASH_FIELDS = Object.freeze([
  "source_master_sha256",
  "sourceMasterSha256",
  "master_sha256",
  "masterSha256",
  "base_source_sha256",
  "baseSourceSha256",
  "original_source_sha256",
  "originalSourceSha256",
  "master_content_sha256",
  "masterContentSha256",
]);
const BASE_SOURCE_EVIDENCE_FIELDS = Object.freeze([
  "source_identity",
  "sourceIdentity",
  "motion_source_identity",
  "motionSourceIdentity",
  "base_source",
  "baseSource",
  "source_master",
  "sourceMaster",
  "provenance",
  "evidence",
  "asset",
]);
const BASE_SOURCE_DESCRIPTOR_FIELDS = Object.freeze([
  "source_type",
  "sourceType",
  "media_kind",
  "mediaKind",
  "media_type",
  "mediaType",
  "motion_type",
  "motionType",
  "asset_type",
  "assetType",
  "derivation_method",
  "derivationMethod",
  "generation_method",
  "generationMethod",
]);

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function unique(values) {
  return [...new Set(values)];
}

function transcriptWords(value) {
  return clean(value)
    .toLowerCase()
    .replace(/([\p{L}])(\p{N})/gu, "$1 $2")
    .replace(/(\p{N})([\p{L}])/gu, "$1 $2")
    .match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];
}

const SPOKEN_NUMBER_ALIASES = new Map([
  ["zero", 0],
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
  ["twenty", 20],
  ["thirty", 30],
  ["forty", 40],
  ["fifty", 50],
  ["sixty", 60],
  ["seventy", 70],
  ["eighty", 80],
  ["ninety", 90],
]);

function spokenNumberAliasValue(value) {
  const token = clean(value).toLowerCase();
  if (/^\d+$/.test(token)) return Number(token);
  return SPOKEN_NUMBER_ALIASES.has(token) ? SPOKEN_NUMBER_ALIASES.get(token) : null;
}

function timestampSpokenWords(timestampDocument = {}) {
  const rows = asArray(timestampDocument.words).length
    ? timestampDocument.words
    : asArray(timestampDocument.timestamps);
  return rows.flatMap((row) => {
    const lineage = asArray(row?.spoken_words).map(clean).filter(Boolean);
    return transcriptWords(lineage.length ? lineage.join(" ") : row?.word ?? row?.text ?? row);
  });
}

function spokenTokenSequencesEquivalent(expectedWords = [], actualWords = []) {
  if (!expectedWords.length || expectedWords.length !== actualWords.length) return false;
  return expectedWords.every((expected, index) => {
    const actual = actualWords[index];
    if (expected === actual) return true;
    const expectedNumber = spokenNumberAliasValue(expected);
    const actualNumber = spokenNumberAliasValue(actual);
    return expectedNumber !== null && expectedNumber === actualNumber;
  });
}

function timestampSpokenScript(timestampDocument = {}) {
  const explicit = clean(
    timestampDocument.meta?.spoken_text ||
      timestampDocument.meta?.transcript ||
      timestampDocument.meta?.text ||
      timestampDocument.spoken_text ||
      timestampDocument.transcript,
  );
  if (explicit) return explicit;
  const rows = asArray(timestampDocument.words).length
    ? timestampDocument.words
    : asArray(timestampDocument.timestamps);
  return rows
    .map((row) => clean(row?.word ?? row?.text ?? row))
    .filter(Boolean)
    .join(" ");
}

function synchronisedCanonicalNarration(canonical = {}, timestampDocument = {}) {
  const displayScript = clean(
    canonical.narration_script ||
      canonical.full_script ||
      canonical.display_script ||
      canonical.caption_display_text,
  );
  if (!displayScript) throw new Error("canonical_narration_script_missing");
  const spokenScript = timestampSpokenScript(timestampDocument) || clean(applyGamingPronunciation(displayScript));
  if (!spokenScript) throw new Error("current_spoken_script_missing");
  if (pronunciationScriptDiverges(displayScript, spokenScript)) {
    throw new Error("current_spoken_script_diverges_from_canonical_narration");
  }
  const alignedWords = asArray(timestampDocument.words).length
    ? timestampDocument.words
    : asArray(timestampDocument.timestamps);
  const timestampWords = timestampSpokenWords({ words: alignedWords });
  if (
    !timestampWords.length ||
    !spokenTokenSequencesEquivalent(transcriptWords(spokenScript), timestampWords)
  ) {
    throw new Error("current_word_timestamps_do_not_match_spoken_script");
  }
  const timestampDisplayText = clean(
    timestampDocument.meta?.display_text || timestampDocument.meta?.displayText,
  );
  if (timestampDisplayText && timestampDisplayText !== displayScript) {
    throw new Error("current_word_timestamps_display_script_mismatch");
  }
  return { displayScript, spokenScript };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function utf8JsonText(value) {
  return Buffer.from(value).toString("utf8").replace(/^\uFEFF/, "");
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/i.test(clean(value));
}

function pathIsInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function resolveFrom(baseDir, value) {
  const text = clean(value);
  if (!text) return "";
  return path.isAbsolute(text) ? path.resolve(text) : path.resolve(baseDir, text);
}

function requirePath(value, code) {
  const text = clean(value);
  if (!text) throw new Error(code);
  return path.resolve(text);
}

function assertTargetPath(workspaceDir, candidate, label) {
  const resolved = path.resolve(candidate);
  if (!pathIsInside(workspaceDir, resolved)) {
    throw new Error(`target_path_escapes_isolated_workspace:${label}`);
  }
  return resolved;
}

async function readJson(filePath, label) {
  if (!(await fs.pathExists(filePath))) throw new Error(`missing_file:${label}`);
  const before = await fs.stat(filePath);
  if (!before.isFile()) throw new Error(`unusable_file:${label}`);
  let bytes;
  try {
    bytes = await fs.readFile(filePath);
  } catch (error) {
    throw new Error(`unreadable_file:${label}:${error.message}`);
  }
  const after = await fs.stat(filePath);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== after.size) {
    throw new Error(`file_changed_during_validation:${label}`);
  }
  try {
    const value = JSON.parse(utf8JsonText(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("expected an object");
    }
    return {
      value,
      bytes,
      fileEvidence: {
        path: path.resolve(filePath),
        sha256: sha256(bytes),
        size_bytes: after.size,
        mtime_ms: after.mtimeMs,
      },
    };
  } catch (error) {
    throw new Error(`invalid_json:${label}:${error.message}`);
  }
}

async function verifyCurrentFile({
  filePath,
  label,
  expectedSha256,
  expectedSizeBytes,
  requireHash = true,
  requireSize = false,
  returnBytes = false,
  minBytes = 1,
}) {
  if (!clean(filePath) || !(await fs.pathExists(filePath))) {
    throw new Error(`missing_file:${label}`);
  }
  const before = await fs.stat(filePath);
  if (!before.isFile() || before.size < minBytes) throw new Error(`unusable_file:${label}`);
  const declaredHash = clean(expectedSha256).toLowerCase();
  if (requireHash && !declaredHash) throw new Error(`missing_hash:${label}`);
  if (declaredHash && !isSha256(declaredHash)) throw new Error(`invalid_hash:${label}`);
  let bytes = null;
  let actualSha256 = "";
  if (returnBytes) {
    bytes = await fs.readFile(filePath);
    actualSha256 = sha256(bytes);
  } else if (requireHash || declaredHash) {
    const hash = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
    actualSha256 = hash.digest("hex");
  }
  const after = await fs.stat(filePath);
  if (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    (bytes && bytes.length !== after.size)
  ) {
    throw new Error(`file_changed_during_validation:${label}`);
  }
  if (declaredHash && declaredHash !== actualSha256) throw new Error(`stale_hash:${label}`);
  if (requireSize && (expectedSizeBytes === undefined || expectedSizeBytes === null || expectedSizeBytes === "")) {
    throw new Error(`missing_size:${label}`);
  }
  if (expectedSizeBytes !== undefined && expectedSizeBytes !== null && expectedSizeBytes !== "") {
    const declaredSize = Number(expectedSizeBytes);
    if (!Number.isFinite(declaredSize) || declaredSize < 0) throw new Error(`invalid_size:${label}`);
    if (declaredSize !== after.size) throw new Error(`stale_size:${label}`);
  }
  return {
    path: path.resolve(filePath),
    sha256: actualSha256,
    size_bytes: after.size,
    mtime_ms: after.mtimeMs,
    bytes,
  };
}

function selectSourceJob(workOrder, storyId) {
  const matches = asArray(workOrder.jobs).filter((job) => clean(job?.story_id) === storyId);
  if (!matches.length) throw new Error(`source_render_job_missing:${storyId}`);
  if (matches.length > 1) throw new Error(`source_render_job_ambiguous:${storyId}`);
  const job = matches[0];
  const blockers = asArray(job.blockers).map(clean).filter(Boolean);
  const actions = asArray(job.actions).filter((action) => clean(action?.action_id) === RENDER_ACTION_ID);
  if (!actions.length) throw new Error("source_render_job_action_missing");
  if (actions.length > 1) throw new Error("source_render_job_action_ambiguous");
  const action = actions[0];
  const expectations = asArray(action.output_expectations).map(clean);
  const expectedMissingFinalOutputsOnly =
    blockers.length > 0 &&
    blockers.includes("render_manifest_missing") &&
    blockers.every((blocker) => (
      blocker === "render_manifest_missing" ||
      blocker === "final_mp4_missing"
    ));
  const expectedGovernedManifest =
    expectations.some((value) => /final_publish_render\s*=\s*true/i.test(value)) &&
    expectations.some((value) => /visual_tier\s*=\s*production_v4_motion/i.test(value));
  const explicitlyReadyPreRenderJob =
    clean(job.status) === "ready_for_final_render_job" &&
    ["ready", "ready_after_inputs"].includes(clean(action.status).toLowerCase());
  const recoverableMissingOutputState =
    expectedMissingFinalOutputsOnly &&
    (job.force_final_render === true || explicitlyReadyPreRenderJob) &&
    expectedGovernedManifest;
  const staleScriptInputBlockers = new Set([
    "narration_audio_missing",
    "word_timestamps_missing",
  ]);
  const recoverableScriptInputState =
    clean(job.status) === "blocked_on_render_inputs" &&
    blockers.length > 0 &&
    blockers.every((blocker) => staleScriptInputBlockers.has(blocker)) &&
    job.force_final_render === true &&
    clean(action.status) === "ready_after_inputs" &&
    expectedGovernedManifest;
  const recoverablePreRenderState =
    recoverableMissingOutputState || recoverableScriptInputState;
  if (
    clean(job.status) !== "ready_for_final_render_job" &&
    !recoverableScriptInputState
  ) {
    throw new Error(
      `source_render_job_not_ready:${blockers.join(",") || clean(job.status) || "unknown"}`,
    );
  }
  if (blockers.length && !recoverablePreRenderState) {
    throw new Error(`source_render_job_not_ready:${blockers.join(",")}`);
  }
  const declaredTarget = {
    ...(action.target_render_manifest || {}),
    ...(job.target_render_manifest || {}),
  };
  const target = recoverablePreRenderState
    ? {
        ...declaredTarget,
        renderer: "visual_v4_production",
        visual_tier: "production_v4_motion",
        final_publish_render: true,
      }
    : declaredTarget;
  if (
    clean(target.renderer) !== "visual_v4_production" ||
    clean(target.visual_tier) !== "production_v4_motion" ||
    target.final_publish_render !== true
  ) {
    throw new Error("source_render_job_target_not_governed");
  }
  const actionStatus = clean(action.status).toLowerCase();
  if (actionStatus && !["ready", "ready_after_inputs"].includes(actionStatus)) {
    throw new Error(`source_render_job_action_not_ready:${actionStatus}`);
  }
  return {
    job: { ...job, target_render_manifest: clone(target) },
    actions,
  };
}

function motionRows(manifest) {
  if (asArray(manifest.clips).length) return manifest.clips;
  if (asArray(manifest.materialised_clips).length) return manifest.materialised_clips;
  if (asArray(manifest.materialized_clips).length) return manifest.materialized_clips;
  return [];
}

function motionClipId(clip) {
  return clean(clip?.id || clip?.clip_id || clip?.asset_id || clip?.motion_pack_clip_id);
}

function motionClipPath(clip) {
  return clean(
    clip?.path ||
    clip?.local_materialized_path ||
    clip?.local_materialised_path ||
    clip?.local_path ||
    clip?.file_path ||
    clip?.media_path ||
    clip?.output_path ||
    clip?.asset?.path,
  );
}

function motionClipFamily(clip) {
  return clean(
    clip?.source_family ||
    clip?.motion_family ||
    clip?.family ||
    clip?.base_source_family ||
    clip?.asset?.source_family,
  );
}

function isGeneratedClip(clip) {
  const text = [
    clip?.source_type,
    clip?.media_kind,
    clip?.asset_type,
    clip?.motion_type,
    clip?.derivation_method,
    clip?.generation_method,
    clip?.source_url,
    clip?.rights_basis,
  ].map(clean).join(" ").toLowerCase();
  return clip?.generated === true || /generated|owned_motion_graphic|local:\/\//.test(text);
}

function isGeneratedCardClip(clip) {
  return [clip?.kind, clip?.media_kind, clip?.asset_type, clip?.source_type]
    .some((value) => clean(value).toLowerCase() === "generated_card");
}

function isDirectVideoClip(clip) {
  const text = [clip?.source_type, clip?.media_kind, clip?.asset_type].map(clean).join(" ").toLowerCase();
  return clip?.direct_video === true || /direct_video|official_trailer|video_clip|motion_clip/.test(text);
}

function baseSourceEvidenceOwners(source) {
  const owners = [];
  const queue = [source];
  const visited = new Set();
  while (queue.length) {
    const owner = queue.shift();
    if (!owner || typeof owner !== "object" || Array.isArray(owner) || visited.has(owner)) continue;
    visited.add(owner);
    owners.push(owner);
    for (const field of BASE_SOURCE_EVIDENCE_FIELDS) {
      if (owner[field] && typeof owner[field] === "object") queue.push(owner[field]);
    }
  }
  return owners;
}

function baseSourceFieldValues(source, fields) {
  const values = [];
  for (const owner of baseSourceEvidenceOwners(source)) {
    for (const field of fields) {
      const candidates = Array.isArray(owner[field]) ? owner[field] : [owner[field]];
      for (const candidate of candidates) {
        if (typeof candidate !== "string" && typeof candidate !== "number") continue;
        const value = clean(candidate);
        if (value) values.push(value);
      }
    }
  }
  return unique(values);
}

function normaliseBaseSourceSha256(value) {
  const candidate = clean(value).toLowerCase().replace(/^sha-?256:/, "");
  return isSha256(candidate) ? candidate : "";
}

function hasTruthyBaseSourceFlag(source, fields) {
  return baseSourceEvidenceOwners(source).some((owner) => fields.some((field) => (
    owner[field] === true || owner[field] === 1 || /^(?:true|yes|1)$/i.test(clean(owner[field]))
  )));
}

function genuineBaseSourceProjection(clip) {
  const ids = baseSourceFieldValues(clip, BASE_SOURCE_ID_FIELDS);
  const urls = baseSourceFieldValues(clip, BASE_SOURCE_URL_FIELDS);
  const declaredHashes = baseSourceFieldValues(clip, BASE_SOURCE_HASH_FIELDS);
  const hashes = declaredHashes.map(normaliseBaseSourceSha256).filter(Boolean);
  const descriptors = baseSourceFieldValues(clip, BASE_SOURCE_DESCRIPTOR_FIELDS);
  const identityText = [...ids, ...urls, ...declaredHashes].join(" ").toLowerCase();
  const placeholder = hasTruthyBaseSourceFlag(clip, [
    "placeholder",
    "is_placeholder",
    "isPlaceholder",
    "placeholder_source",
    "placeholderSource",
  ]) || /(?:^|[^a-z0-9])(?:placeholder|dummy|pending|tbd|unknown|missing)(?:[^a-z0-9]|$)/.test(identityText);
  const generatedOnly = isGeneratedClip(clip) || /(?:^|[^a-z0-9])(?:generated(?:[_ -]?only)?|owned[_ -]?generated|owned_motion_graphic|local:\/\/)(?:[^a-z0-9]|$)/i.test(
    [...descriptors, identityText].join(" "),
  );
  const synthetic = generatedOnly || hasTruthyBaseSourceFlag(clip, [
    "synthetic",
    "is_synthetic",
    "isSynthetic",
    "synthetic_still_loop",
    "syntheticStillLoop",
    "still_loop",
    "stillLoop",
    "derived_from_still",
    "derivedFromStill",
  ]);
  return {
    clip_id: motionClipId(clip),
    base_source_asset_id: ids,
    source_master_sha256: unique(hashes),
    canonical_source_url: urls,
    source_type: descriptors,
    placeholder,
    synthetic,
    generated_only: generatedOnly,
  };
}

function selectedGenuineBaseSources(selected, minimumRequired = 0) {
  const projections = selected.map((clip) => genuineBaseSourceProjection(clip.row));
  const diversity = evaluateGenuineBaseSourceDiversity(
    projections,
    { minimum: minimumRequired || 1 },
  );
  const invalid = diversity.rejected_sources.find((rejected) => (
    rejected.reasons.some((reason) => !reason.startsWith("duplicate_base_source_"))
  ));
  if (invalid) {
    const projection = projections[invalid.input_index];
    const reasons = invalid.reasons
      .filter((reason) => !reason.startsWith("duplicate_base_source_"))
      .map((reason) => (
        projection?.generated_only && reason === "synthetic_still_loop_base_source_rejected"
          ? "generated_only_base_source_rejected"
          : reason
      ));
    throw new Error(
      `selected_genuine_base_source_identity_rejected:${selected[invalid.input_index]?.id || invalid.input_index}:${unique(reasons).join(",")}`,
    );
  }
  const identities = diversity.genuine_base_sources.map((identity) => ({
    ...clone(identity),
    clip_ids: identity.input_indexes.map((index) => selected[index].id),
  }));
  return {
    count: identities.length,
    identities,
    evaluation: diversity,
  };
}

function genuineBaseSourceIdentityKeys(current) {
  return current.genuineBaseSourceIdentities.map((identity) => identity.base_source_key);
}

function repairedProfessionalSourceDiversity(current, minimumRequired = 0) {
  const duplicateSegmentWindows = current.genuineBaseSourceEvaluation.rejected_sources
    .filter((source) => source.reasons.every((reason) => reason.startsWith("duplicate_base_source_")))
    .map((source) => ({
      input_index: source.input_index,
      clip_id: current.selected[source.input_index]?.id || null,
      duplicate_of_input_index: source.duplicate_of_input_index,
      duplicate_of_clip_id: current.selected[source.duplicate_of_input_index]?.id || null,
      reasons: clone(source.reasons),
    }));
  return {
    schema_version: current.genuineBaseSourceEvaluation.schema_version,
    evaluator_version: current.genuineBaseSourceEvaluation.evaluator_version,
    verdict: "GREEN",
    status: "GREEN",
    strict_pass: true,
    minimum_met: !minimumRequired || current.genuineBaseSourceCount >= minimumRequired,
    minimum_required_genuine_base_source_count: minimumRequired,
    observed_genuine_base_source_count: current.genuineBaseSourceCount,
    input_source_count: current.selected.length,
    accepted_source_count: current.genuineBaseSourceCount,
    rejected_source_count: 0,
    collapsed_segment_window_count: duplicateSegmentWindows.length,
    genuine_base_sources: clone(current.genuineBaseSourceIdentities),
    rejected_sources: [],
    duplicate_segment_windows: duplicateSegmentWindows,
    blockers: [],
  };
}

async function inspectCurrentEvidence({ currentEvidence, currentEvidenceDir, storyId }) {
  const narrationPath = resolveFrom(currentEvidenceDir, currentEvidence.narration_audio_path);
  const timestampsPath = resolveFrom(currentEvidenceDir, currentEvidence.word_timestamps_path);
  const motionManifestPath = resolveFrom(
    currentEvidenceDir,
    currentEvidence.materialised_motion_manifest_path || currentEvidence.materialized_motion_manifest_path,
  );
  const narration = await verifyCurrentFile({
    filePath: narrationPath,
    label: "narration_audio",
    expectedSha256: currentEvidence.narration_audio_sha256,
    expectedSizeBytes: currentEvidence.narration_audio_size_bytes,
    requireSize: true,
    minBytes: 1_024,
  });
  const timestamps = await verifyCurrentFile({
    filePath: timestampsPath,
    label: "word_timestamps",
    expectedSha256: currentEvidence.word_timestamps_sha256,
    expectedSizeBytes: currentEvidence.word_timestamps_size_bytes,
    requireSize: true,
    returnBytes: true,
    minBytes: 16,
  });
  const motionManifestEvidence = await verifyCurrentFile({
    filePath: motionManifestPath,
    label: "materialised_motion_manifest",
    expectedSha256: currentEvidence.materialised_motion_manifest_sha256,
    expectedSizeBytes: currentEvidence.materialised_motion_manifest_size_bytes,
    returnBytes: true,
  });
  let motionManifest;
  try {
    motionManifest = JSON.parse(utf8JsonText(motionManifestEvidence.bytes));
  } catch (error) {
    throw new Error(`invalid_json:materialised_motion_manifest:${error.message}`);
  }
  if (clean(motionManifest.story_id) && clean(motionManifest.story_id) !== storyId) {
    throw new Error(`current_evidence_story_id_mismatch:materialised_motion_manifest`);
  }
  const motionStatus = clean(motionManifest.status).toLowerCase();
  if (motionStatus && !["ready", "pass", "green", "materialised", "materialized"].includes(motionStatus)) {
    throw new Error(`current_motion_manifest_not_ready:${motionStatus}`);
  }
  if (asArray(motionManifest.blockers).length) throw new Error("current_motion_manifest_has_blockers");
  let timestampDocument;
  try {
    timestampDocument = JSON.parse(utf8JsonText(timestamps.bytes));
  } catch (error) {
    throw new Error(`invalid_json:word_timestamps:${error.message}`);
  }
  const timestampRows = Array.isArray(timestampDocument)
    ? timestampDocument
    : asArray(timestampDocument.words).length
      ? timestampDocument.words
      : asArray(timestampDocument.timestamps);
  if (!timestampRows.length) throw new Error("word_timestamps_rows_missing");
  const timestampAudioHash = clean(
    timestampDocument.audio_sha256 ||
    timestampDocument.narration_audio_sha256 ||
    timestampDocument.meta?.audio_sha256,
  ).toLowerCase();
  if (timestampAudioHash && (!isSha256(timestampAudioHash) || timestampAudioHash !== narration.sha256)) {
    throw new Error("stale_hash:word_timestamps_audio_binding");
  }

  const rows = motionRows(motionManifest);
  if (!rows.length) throw new Error("current_motion_manifest_has_no_clips");
  const byId = new Map();
  for (const row of rows) {
    const id = motionClipId(row);
    if (!id) throw new Error("current_motion_clip_id_missing");
    if (byId.has(id)) throw new Error(`current_motion_clip_id_ambiguous:${id}`);
    byId.set(id, row);
  }
  if (
    motionManifest.clip_count !== undefined &&
    Number(motionManifest.clip_count) !== rows.length
  ) {
    throw new Error(`current_motion_manifest_clip_count_mismatch:${motionManifest.clip_count}/${rows.length}`);
  }
  const manifestFamilies = unique(rows.map((row) => motionClipFamily(row)).filter(Boolean));
  if (
    motionManifest.distinct_motion_family_count !== undefined &&
    Number(motionManifest.distinct_motion_family_count) !== manifestFamilies.length
  ) {
    throw new Error(
      `current_motion_manifest_family_count_mismatch:${motionManifest.distinct_motion_family_count}/${manifestFamilies.length}`,
    );
  }
  const selectedIds = asArray(currentEvidence.selected_materialised_motion_clip_ids)
    .map(clean)
    .filter(Boolean);
  if (!selectedIds.length) throw new Error("current_evidence_selected_clip_ids_missing");
  if (unique(selectedIds).length !== selectedIds.length) throw new Error("current_evidence_selected_clip_ids_duplicate");

  const selected = [];
  const motionManifestDir = path.dirname(motionManifestPath);
  for (const id of selectedIds) {
    const row = byId.get(id);
    if (!row) throw new Error(`old_clip_id_not_in_current_evidence:${id}`);
    const filePath = resolveFrom(motionManifestDir, motionClipPath(row));
    const family = motionClipFamily(row);
    if (!family) throw new Error(`current_motion_clip_family_missing:${id}`);
    const clipEvidence = await verifyCurrentFile({
      filePath,
      label: `materialised_motion_clip:${id}`,
      expectedSha256:
        row.sha256 ||
        row.file_sha256 ||
        row.asset_sha256 ||
        row.materialized_file_evidence?.sha256 ||
        row.materialised_file_evidence?.sha256 ||
        row.asset?.sha256,
      expectedSizeBytes:
        row.size_bytes ||
        row.file_size_bytes ||
        row.asset_size_bytes ||
        row.materialized_file_evidence?.size_bytes ||
        row.materialised_file_evidence?.size_bytes ||
        row.asset?.size_bytes,
      requireHash: false,
    });
    selected.push({
      id,
      row: {
        ...clone(row),
        path: filePath,
        local_materialized_path: clean(row.local_materialized_path || row.local_materialised_path) || filePath,
      },
      path: filePath,
      family,
      mtime_ms: clipEvidence.mtime_ms,
      size_bytes: clipEvidence.size_bytes,
      real_media: !isGeneratedClip(row),
      direct_video: isDirectVideoClip(row) && !isGeneratedClip(row),
    });
  }
  if (unique(selected.map((clip) => normalPath(clip.path))).length !== selected.length) {
    throw new Error("selected_materialised_motion_clip_path_duplicate");
  }

  return {
    narration,
    timestamps,
    timestampDocument,
    motionManifestPath,
    motionManifestEvidence,
    motionManifest,
    selected,
    selectedIds,
    clipPaths: selected.map((clip) => clip.path),
    clipMtimes: Object.fromEntries(selected.map((clip) => [clip.path, clip.mtime_ms])),
    families: unique(selected.map((clip) => clip.family)),
    realClips: selected.filter((clip) => clip.real_media),
    directVideoClips: selected.filter((clip) => clip.direct_video),
  };
}

function positiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function targetRequiresRepeatFreeTimeline(job = {}) {
  const values = [
    job.target_render_manifest?.visual_design_policy_version,
    job.target_render_manifest?.creative_system_version,
    job.visual_design_policy_version,
    ...asArray(job.actions).map((action) => action?.target_render_manifest?.visual_design_policy_version),
  ];
  return values.some((value) => /repeat[_-]?free/i.test(clean(value)));
}

function timestampDurationSeconds(timestampDocument = {}) {
  const rows = asArray(timestampDocument.words).length
    ? timestampDocument.words
    : asArray(timestampDocument.timestamps);
  return rows.reduce((maximum, row) => {
    const end = Number(row?.end ?? row?.end_s ?? row?.end_time ?? row?.endTime);
    return Number.isFinite(end) && end > maximum ? end : maximum;
  }, 0);
}

function probeDurationSeconds(filePath, ffprobeDurationImpl, label) {
  let duration;
  try {
    duration = Number(ffprobeDurationImpl(filePath));
  } catch (error) {
    throw new Error(`current_media_duration_probe_failed:${label}:${clean(error?.message) || "unknown"}`);
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`current_media_duration_probe_invalid:${label}`);
  }
  return duration;
}

function enforceRepeatFreeTimelineCoverage(
  job,
  current,
  { ffprobeDurationImpl = defaultFfprobeDuration } = {},
) {
  if (!targetRequiresRepeatFreeTimeline(job)) return null;
  if (typeof ffprobeDurationImpl !== "function") {
    throw new Error("current_media_duration_probe_missing");
  }
  const narrationDurationS = probeDurationSeconds(
    current.narration.path,
    ffprobeDurationImpl,
    "narration_audio",
  );
  const timestampDurationS = timestampDurationSeconds(current.timestampDocument);
  if (timestampDurationS > narrationDurationS + 1) {
    throw new Error(
      `current_word_timestamps_exceed_narration_duration:${timestampDurationS.toFixed(3)}/${narrationDurationS.toFixed(3)}`,
    );
  }
  const clipDurationsS = current.selected.map((clip) => probeDurationSeconds(
    clip.path,
    ffprobeDurationImpl,
    `materialised_motion_clip:${clip.id}`,
  ));
  const rawDurationS = clipDurationsS.reduce((sum, duration) => sum + duration, 0);
  const transitionLossS = REPEAT_FREE_TRANSITION_DURATION_S * Math.max(0, clipDurationsS.length - 1);
  const coveredDurationS = Math.max(0, rawDurationS - transitionLossS);
  const missingDurationS = Math.max(0, narrationDurationS - coveredDurationS);
  if (coveredDurationS + MEDIA_DURATION_TOLERANCE_S < narrationDurationS) {
    throw new Error(
      "selected_motion_timeline_below_narration_duration:" +
        `covered=${coveredDurationS.toFixed(3)}:` +
        `required=${narrationDurationS.toFixed(3)}:` +
        `missing=${missingDurationS.toFixed(3)}`,
    );
  }
  const proof = {
    status: "pass",
    policy: "repeat_free_file_probed_timeline_v1",
    narration_duration_s: Number(narrationDurationS.toFixed(3)),
    timestamp_duration_s: Number(timestampDurationS.toFixed(3)),
    raw_selected_motion_duration_s: Number(rawDurationS.toFixed(3)),
    transition_duration_s: REPEAT_FREE_TRANSITION_DURATION_S,
    transition_loss_s: Number(transitionLossS.toFixed(3)),
    covered_duration_s: Number(coveredDurationS.toFixed(3)),
    clip_duration_s: clipDurationsS.map((duration) => Number(duration.toFixed(3))),
  };
  current.timelineCoverage = proof;
  return proof;
}

function declaredGenuineBaseMinimum(values, invalidCode) {
  const declared = values.filter((value) => (
    value !== undefined && value !== null && clean(value) !== ""
  ));
  if (!declared.length) return 0;
  const numbers = declared.map((value) => typeof value === "boolean" ? NaN : Number(value));
  if (numbers.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error(invalidCode);
  }
  return Math.max(...numbers);
}

function sourceGenuineBaseMinimum(job) {
  return declaredGenuineBaseMinimum([
    job.required_genuine_base_source_count,
    job.min_genuine_base_source_count,
    job.minimum_required_genuine_base_sources,
    job.requirements?.required_genuine_base_source_count,
    job.requirements?.min_genuine_base_sources,
    job.requirements?.minimum_required_genuine_base_sources,
    job.requirements?.min_distinct_motion_base_sources,
    job.render_input_requirements?.required_genuine_base_source_count,
    job.render_input_requirements?.min_genuine_base_sources,
    job.render_input_requirements?.minimum_required_genuine_base_sources,
    job.render_input_requirements?.min_distinct_motion_base_sources,
    job.shot_budget?.min_distinct_motion_base_sources,
    job.render_input_evidence?.required_genuine_base_source_count,
    job.render_input_evidence?.minimum_required_genuine_base_sources,
    job.render_input_evidence?.real_motion_input_readiness?.required_genuine_base_source_count,
    job.render_input_evidence?.real_motion_input_readiness?.minimum_required_genuine_base_sources,
    job.render_input_evidence?.real_motion_input_readiness?.min_distinct_motion_base_sources,
    job.evidence?.required_genuine_base_source_count,
    job.evidence?.minimum_required_genuine_base_sources,
    job.evidence?.professional_source_diversity?.minimum_required_genuine_base_source_count,
    job.evidence?.real_motion_input_readiness?.required_genuine_base_source_count,
    job.evidence?.real_motion_input_readiness?.minimum_required_genuine_base_sources,
    job.evidence?.real_motion_input_readiness?.min_distinct_motion_base_sources,
    ...asArray(job.actions).flatMap((action) => [
      action?.evidence?.required_genuine_base_source_count,
      action?.evidence?.min_genuine_base_sources,
      action?.evidence?.minimum_required_genuine_base_sources,
    ]),
  ], "source_genuine_base_source_minimum_invalid");
}

function currentEvidenceGenuineBaseMinimum(motionManifest) {
  return declaredGenuineBaseMinimum([
    motionManifest.required_genuine_base_source_count,
    motionManifest.minimum_required_genuine_base_sources,
    motionManifest.minimum_requirements?.required_genuine_base_source_count,
    motionManifest.minimum_requirements?.min_genuine_base_sources,
    motionManifest.minimum_requirements?.minimum_required_genuine_base_sources,
    motionManifest.professional_source_diversity?.minimum_required_genuine_base_source_count,
    motionManifest.source_diversity?.required_genuine_base_source_count,
    motionManifest.source_diversity?.metrics?.required_genuine_base_source_count,
    motionManifest.source_diversity?.professional_source_diversity
      ?.required_genuine_base_source_count,
  ], "current_evidence_genuine_base_source_minimum_invalid");
}

function enforceSourceRequirements(job, current) {
  const readiness = job.evidence?.real_motion_input_readiness || {};
  const directVideoFloor = positiveNumber(readiness.direct_video_motion_clip_floor);
  const minClips = positiveNumber(
    job.requirements?.min_materialised_motion_clips,
    job.render_input_requirements?.min_materialised_motion_clips,
    directVideoFloor,
  );
  const minFamilies = positiveNumber(
    job.requirements?.min_distinct_motion_families,
    job.render_input_requirements?.min_distinct_motion_families,
  );
  const sourceMinGenuineBaseSources = sourceGenuineBaseMinimum(job);
  const currentEvidenceMinGenuineBaseSources = currentEvidenceGenuineBaseMinimum(
    current.motionManifest,
  );
  const minGenuineBaseSources = Math.max(
    sourceMinGenuineBaseSources,
    currentEvidenceMinGenuineBaseSources,
  );
  if (minClips && current.selected.length < minClips) {
    throw new Error(`selected_motion_clip_count_below_source_requirement:${current.selected.length}/${minClips}`);
  }
  if (minFamilies && current.families.length < minFamilies) {
    throw new Error(`selected_motion_family_count_below_source_requirement:${current.families.length}/${minFamilies}`);
  }
  if (directVideoFloor && current.directVideoClips.length < directVideoFloor) {
    throw new Error(
      `selected_direct_motion_clip_count_below_source_requirement:${current.directVideoClips.length}/${directVideoFloor}`,
    );
  }
  const genuineBaseSources = selectedGenuineBaseSources(
    current.selected.filter((clip) => !isGeneratedCardClip(clip.row)),
    minGenuineBaseSources,
  );
  current.genuineBaseSourceCount = genuineBaseSources.count;
  current.genuineBaseSourceIdentities = genuineBaseSources.identities;
  current.genuineBaseSourceEvaluation = genuineBaseSources.evaluation;
  if (sourceMinGenuineBaseSources && current.genuineBaseSourceCount < sourceMinGenuineBaseSources) {
    throw new Error(
      `selected_genuine_base_source_count_below_source_requirement:${current.genuineBaseSourceCount}/${sourceMinGenuineBaseSources}`,
    );
  }
  if (
    currentEvidenceMinGenuineBaseSources &&
    current.genuineBaseSourceCount < currentEvidenceMinGenuineBaseSources
  ) {
    throw new Error(
      `selected_genuine_base_source_count_below_current_evidence_requirement:${current.genuineBaseSourceCount}/${currentEvidenceMinGenuineBaseSources}`,
    );
  }
  return {
    minClips,
    minFamilies,
    minGenuineBaseSources,
    sourceMinGenuineBaseSources,
    currentEvidenceMinGenuineBaseSources,
    directVideoFloor,
  };
}

async function rejectSourceArtifactSymlinks(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`source_artifact_symlink_forbidden:${candidate}`);
    if (entry.isDirectory()) await rejectSourceArtifactSymlinks(candidate);
  }
}

function normalPath(value) {
  return path.resolve(value).replace(/\\/g, "/").toLowerCase();
}

function rightsRecordId(record) {
  return clean(record?.asset_id || record?.assetId || record?.id);
}

function rightsRecordHash(record) {
  return clean(
    record?.asset_sha256 ||
    record?.assetSha256 ||
    record?.file_sha256 ||
    record?.fileSha256 ||
    record?.sha256,
  ).toLowerCase();
}

function rightsRecordSize(record) {
  return (
    record?.asset_size_bytes ??
    record?.assetSizeBytes ??
    record?.file_size_bytes ??
    record?.fileSizeBytes ??
    record?.size_bytes ??
    record?.sizeBytes
  );
}

function rightsRecordMap(rows, label) {
  const records = new Map();
  for (const row of asArray(rows)) {
    const id = rightsRecordId(row);
    if (!id) throw new Error(`${label}_asset_id_missing`);
    if (records.has(id)) throw new Error(`${label}_asset_id_duplicate:${id}`);
    records.set(id, row);
  }
  return records;
}

function assertCompleteRightsRecord(record, label, expectedKind) {
  const sourceUrl = clean(record?.source_url || record?.sourceUrl);
  const sourceType = clean(record?.source_type || record?.sourceType);
  const licenceBasis = clean(record?.licence_basis || record?.license_basis);
  const allowedUse = clean(record?.allowed_use || record?.allowedUse);
  const approvalStatus = clean(
    record?.approval_status ||
    record?.approvalStatus ||
    record?.status,
  ).toLowerCase();
  const declaredKinds = [
    record?.kind,
    record?.asset_type,
    record?.assetType,
  ]
    .map((value) => clean(value).toLowerCase())
    .filter(Boolean);
  const kind = declaredKinds[0] || "";
  if (!sourceUrl) throw new Error(`${label}_source_url_missing`);
  if (!sourceType) throw new Error(`${label}_source_type_missing`);
  if (!licenceBasis) throw new Error(`${label}_licence_basis_missing`);
  if (!allowedUse) throw new Error(`${label}_allowed_use_missing`);
  if (!asArray(record?.allowed_platforms || record?.allowedPlatforms).length) {
    throw new Error(`${label}_allowed_platforms_missing`);
  }
  if (record?.commercial_use_allowed !== true && record?.commercialUseAllowed !== true) {
    throw new Error(`${label}_commercial_use_not_approved`);
  }
  if (
    !approvalStatus ||
    !(
      approvalStatus.startsWith("approved") ||
      approvalStatus === "cleared" ||
      approvalStatus === "pass"
    )
  ) {
    throw new Error(`${label}_approval_status_invalid:${approvalStatus || "missing"}`);
  }
  if (expectedKind === "audio" && !declaredKinds.some((value) => value.includes("audio"))) {
    throw new Error(`${label}_kind_invalid:${kind || "missing"}`);
  }
  if (
    expectedKind === "video" &&
    !declaredKinds.some((value) => value.includes("video") || value.includes("motion"))
  ) {
    throw new Error(`${label}_kind_invalid:${kind || "missing"}`);
  }
}

function assertRightsLedgerStory(ledger, storyId, label) {
  const ledgerStoryId = clean(ledger?.story_id || ledger?.storyId);
  if (!ledgerStoryId) throw new Error(`${label}_story_id_missing`);
  if (ledgerStoryId !== storyId) {
    throw new Error(`${label}_story_id_mismatch:${ledgerStoryId}`);
  }
}

function assertPassRightsLedger(ledger, label) {
  const verdict = clean(ledger?.verdict).toLowerCase();
  const status = clean(ledger?.status).toLowerCase();
  if (!["pass", "green"].includes(verdict)) {
    throw new Error(`${label}_verdict_not_pass:${verdict || "missing"}`);
  }
  if (status && !["ready", "pass", "green"].includes(status)) {
    throw new Error(`${label}_status_not_ready:${status}`);
  }
  if (asArray(ledger?.blockers).length) throw new Error(`${label}_has_blockers`);
  if (asArray(ledger?.failures).length) throw new Error(`${label}_has_failures`);
}

function normaliseNarrationProvider(value) {
  const provider = clean(value).toLowerCase();
  if (!provider) return null;
  if (provider.includes("elevenlabs")) return "elevenlabs";
  if (
    provider === "local" ||
    provider.includes("local_tts") ||
    provider.includes("local-tts") ||
    provider.includes("pulse-local-tts") ||
    provider.includes("owned_local_voice_model")
  ) {
    return "local_tts";
  }
  return provider.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || null;
}

function timestampNarrationProvider(timestampDocument = {}) {
  return normaliseNarrationProvider(
    timestampDocument.meta?.provider ||
      timestampDocument.meta?.tts_provider ||
      timestampDocument.meta?.voice_provider ||
      timestampDocument.provider ||
      timestampDocument.tts_provider ||
      timestampDocument.voice_provider,
  );
}

function audioManifestNarrationProvider(audioManifest = {}) {
  const explicit = normaliseNarrationProvider(
    audioManifest.voice_provider ||
      audioManifest.provider_id ||
      audioManifest.provider ||
      audioManifest.tts_provider ||
      audioManifest.meta?.voice_provider ||
      audioManifest.meta?.provider_id ||
      audioManifest.meta?.provider ||
      audioManifest.meta?.tts_provider,
  );
  if (explicit) return explicit;
  return normaliseNarrationProvider(
    [
      audioManifest.source,
      audioManifest.source_type,
      audioManifest.source_url,
      audioManifest.licence_basis,
    ]
      .map(clean)
      .filter(Boolean)
      .join(" "),
  );
}

function rightsNarrationProvider(record = {}) {
  const explicit = normaliseNarrationProvider(
    record.provider_id ||
      record.provider ||
      record.tts_provider ||
      record.voice_provider,
  );
  if (explicit) return explicit;
  return normaliseNarrationProvider(
    [record.source_type, record.source_url, record.licence_basis]
      .map(clean)
      .filter(Boolean)
      .join(" "),
  );
}

function assertNarrationRightsLedgerState(ledger, narrationEvidence) {
  const verdict = clean(ledger?.verdict).toLowerCase();
  const blockers = asArray(ledger?.blockers).map(clean).filter(Boolean);
  const failures = asArray(ledger?.failures);
  if (["pass", "green"].includes(verdict)) {
    if (blockers.length) throw new Error("source_rights_ledger_has_blockers");
    if (failures.length) throw new Error("source_rights_ledger_has_failures");
    return "authoritative_pass";
  }
  const transitionOnly =
    verdict === "red" &&
    failures.length === 0 &&
    blockers.length === 1 &&
    blockers[0] === SCRIPT_REPAIR_RIGHTS_TRANSITION_BLOCKER;
  if (!transitionOnly) {
    throw new Error(`source_rights_ledger_not_reconcilable:${verdict || "missing"}`);
  }
  const invalidatedAt = Date.parse(clean(ledger?.script_repair_invalidated_at));
  const updatedAt = Date.parse(clean(ledger?.narration_rights_updated_at));
  if (!Number.isFinite(invalidatedAt)) {
    throw new Error("source_rights_script_repair_invalidated_at_missing");
  }
  if (!Number.isFinite(updatedAt) || updatedAt < invalidatedAt) {
    throw new Error("source_rights_narration_update_precedes_script_repair");
  }
  if (narrationEvidence.mtime_ms + 1 < invalidatedAt) {
    throw new Error("current_narration_audio_predates_script_repair");
  }
  return "script_repair_narration_regenerated";
}

async function inspectCurrentRightsEvidence({
  sourceArtifactDir,
  current,
  storyId,
}) {
  const sourceRightsPath = path.join(sourceArtifactDir, "rights_ledger.json");
  const sourceAudioManifestPath = path.join(sourceArtifactDir, "audio_manifest.json");
  const motionRightsPath = path.join(
    path.dirname(current.motionManifestPath),
    "rights_ledger.json",
  );
  const sourceDocument = await readJson(sourceRightsPath, "source_rights_ledger");
  const sourceAudioDocument = await fs.pathExists(sourceAudioManifestPath)
    ? await readJson(sourceAudioManifestPath, "source_audio_manifest")
    : null;
  const motionDocument = normalPath(sourceRightsPath) === normalPath(motionRightsPath)
    ? sourceDocument
    : await readJson(motionRightsPath, "motion_rights_ledger");
  const sourceLedger = sourceDocument.value;
  const motionLedger = motionDocument.value;
  const sourceLedgerStoryId = clean(sourceLedger?.story_id || sourceLedger?.storyId);
  if (sourceLedgerStoryId) {
    assertRightsLedgerStory(sourceLedger, storyId, "source_rights_ledger");
  }
  assertRightsLedgerStory(motionLedger, storyId, "motion_rights_ledger");
  const narrationTransition = assertNarrationRightsLedgerState(
    sourceLedger,
    current.narration,
  );
  const coLocatedTransitionLedger =
    narrationTransition === "script_repair_narration_regenerated" &&
    normalPath(sourceDocument.fileEvidence.path) ===
      normalPath(motionDocument.fileEvidence.path);
  if (!coLocatedTransitionLedger) {
    assertPassRightsLedger(motionLedger, "motion_rights_ledger");
  }

  const expectedNarrationId = `${storyId}_audio_path`;
  const sourceRecords = rightsRecordMap(sourceLedger.records, "source_rights_record");
  const narrationRecord = sourceRecords.get(expectedNarrationId);
  if (!narrationRecord) throw new Error(`source_narration_rights_missing:${expectedNarrationId}`);
  assertCompleteRightsRecord(narrationRecord, "source_narration_rights", "audio");
  const sourceNarrationHash = rightsRecordHash(narrationRecord);
  const sourceNarrationSize = Number(rightsRecordSize(narrationRecord));
  if (!isSha256(sourceNarrationHash)) {
    throw new Error("source_narration_rights_hash_missing_or_invalid");
  }
  if (sourceNarrationHash !== current.narration.sha256) {
    throw new Error("source_narration_rights_hash_mismatch");
  }
  if (!Number.isInteger(sourceNarrationSize) || sourceNarrationSize <= 0) {
    throw new Error("source_narration_rights_size_missing_or_invalid");
  }
  if (sourceNarrationSize !== current.narration.size_bytes) {
    throw new Error("source_narration_rights_size_mismatch");
  }
  const currentNarrationProvider = timestampNarrationProvider(current.timestampDocument);
  const sourceAudioManifestProvider = audioManifestNarrationProvider(
    sourceAudioDocument?.value,
  );
  if (
    currentNarrationProvider &&
    sourceAudioManifestProvider &&
    currentNarrationProvider !== sourceAudioManifestProvider
  ) {
    throw new Error(
      `source_audio_manifest_provider_mismatch:${sourceAudioManifestProvider}:${currentNarrationProvider}`,
    );
  }
  const sourceNarrationProvider = rightsNarrationProvider(narrationRecord);
  if (
    currentNarrationProvider &&
    sourceNarrationProvider &&
    currentNarrationProvider !== sourceNarrationProvider
  ) {
    throw new Error(
      `source_narration_rights_provider_mismatch:${sourceNarrationProvider}:${currentNarrationProvider}`,
    );
  }

  const motionRecords = rightsRecordMap(motionLedger.records, "motion_rights_record");
  const usedAssets = rightsRecordMap(motionLedger.used_assets, "motion_used_asset");
  const selectedMotion = [];
  for (const clip of current.selected) {
    const record = motionRecords.get(clip.id);
    if (!record) throw new Error(`selected_motion_rights_missing:${clip.id}`);
    const usedAsset = usedAssets.get(clip.id);
    if (!usedAsset) throw new Error(`selected_motion_used_asset_missing:${clip.id}`);
    assertCompleteRightsRecord(record, `selected_motion_rights:${clip.id}`, "video");
    const recordPath = resolveFrom(path.dirname(motionRightsPath), record.path);
    const usedAssetPath = resolveFrom(path.dirname(motionRightsPath), usedAsset.path);
    if (!recordPath || normalPath(recordPath) !== normalPath(clip.path)) {
      throw new Error(`selected_motion_rights_path_mismatch:${clip.id}`);
    }
    if (!usedAssetPath || normalPath(usedAssetPath) !== normalPath(clip.path)) {
      throw new Error(`selected_motion_used_asset_path_mismatch:${clip.id}`);
    }
    const recordHash = rightsRecordHash(record);
    const usedAssetHash = rightsRecordHash(usedAsset);
    const recordSize = rightsRecordSize(record);
    const usedAssetSize = rightsRecordSize(usedAsset);
    if (!recordHash || !usedAssetHash || recordHash !== usedAssetHash) {
      throw new Error(`selected_motion_rights_hash_mismatch:${clip.id}`);
    }
    if (
      recordSize === undefined ||
      recordSize === null ||
      usedAssetSize === undefined ||
      usedAssetSize === null ||
      Number(recordSize) !== Number(usedAssetSize)
    ) {
      throw new Error(`selected_motion_rights_size_mismatch:${clip.id}`);
    }
    const fileEvidence = await verifyCurrentFile({
      filePath: clip.path,
      label: `selected_motion_rights_file:${clip.id}`,
      expectedSha256: recordHash,
      expectedSizeBytes: recordSize,
      requireHash: true,
      requireSize: true,
      minBytes: 1,
    });
    selectedMotion.push({
      clip,
      record: clone(record),
      usedAsset: clone(usedAsset),
      fileEvidence,
    });
  }

  const evidenceDocuments = [sourceDocument, sourceAudioDocument, motionDocument]
    .filter(Boolean)
    .filter((document, index, documents) => (
      documents.findIndex((candidate) => (
        normalPath(candidate.fileEvidence.path) === normalPath(document.fileEvidence.path)
      )) === index
    ));
  return {
    sourceLedgerPath: sourceDocument.fileEvidence.path,
    sourceLedgerEvidence: sourceDocument.fileEvidence,
    motionLedgerPath: motionDocument.fileEvidence.path,
    motionLedgerEvidence: motionDocument.fileEvidence,
    narrationTransition,
    sourceStoryBinding: sourceLedgerStoryId
      ? "explicit_top_level_story_id"
      : "exact_story_specific_narration_asset_id",
    narrationRecord: clone(narrationRecord),
    selectedMotion,
    controlFiles: evidenceDocuments.map((document) => [
      normalPath(document.fileEvidence.path) === normalPath(sourceDocument.fileEvidence.path)
        ? "source_rights_ledger"
        : normalPath(document.fileEvidence.path) === normalPath(sourceAudioDocument?.fileEvidence.path)
          ? "source_audio_manifest"
          : "motion_rights_ledger",
      document.fileEvidence,
    ]),
  };
}

function rightsUsedAsset(record) {
  return {
    asset_id: record.asset_id,
    kind: record.kind,
    asset_type: record.asset_type,
    path: record.path,
    source_url: record.source_url,
    source_type: record.source_type,
    provider_id: record.provider_id || null,
    asset_sha256: record.asset_sha256,
    asset_size_bytes: record.asset_size_bytes,
  };
}

function reconciledRightsLedger({
  evidence,
  current,
  storyId,
  generatedAt,
}) {
  const narration = {
    ...clone(evidence.narrationRecord),
    asset_id: `${storyId}_audio_path`,
    asset_type: "narration_audio",
    kind: "audio",
    path: current.narration.path,
    asset_sha256: current.narration.sha256,
    asset_size_bytes: current.narration.size_bytes,
  };
  const motion = evidence.selectedMotion.map(({ clip, record, fileEvidence }) => ({
    ...clone(record),
    asset_id: clip.id,
    asset_type: clean(record.asset_type) || "motion_clip",
    kind: clean(record.kind) || "video",
    path: clip.path,
    asset_sha256: fileEvidence.sha256,
    asset_size_bytes: fileEvidence.size_bytes,
  }));
  const records = [narration, ...motion];
  return {
    schema_version: 1,
    generated_at: generatedAt,
    story_id: storyId,
    verdict: "pass",
    status: "ready",
    blockers: [],
    failures: [],
    records,
    used_assets: records.map(rightsUsedAsset),
    metrics: {
      used_asset_count: records.length,
      rights_record_count: records.length,
      missing_asset_count: 0,
      duplicate_record_count: 0,
    },
    flagship_rights_reconciliation: {
      policy: "exact_current_narration_and_selected_motion_rights_v1",
      generated_at: generatedAt,
      source_rights_ledger_path: evidence.sourceLedgerPath,
      source_rights_ledger_sha256: evidence.sourceLedgerEvidence.sha256,
      motion_rights_ledger_path: evidence.motionLedgerPath,
      motion_rights_ledger_sha256: evidence.motionLedgerEvidence.sha256,
      narration_transition: evidence.narrationTransition,
      source_story_binding: evidence.sourceStoryBinding,
      narration_provider:
        clean(narration.provider_id) ||
        clean(narration.source_type),
      narration_audio_sha256: current.narration.sha256,
      narration_audio_size_bytes: current.narration.size_bytes,
      selected_motion_asset_count: motion.length,
      exact_used_asset_mapping: true,
    },
  };
}

function sourceCopyFilter(sourceArtifactDir, sourceTarget) {
  const excluded = new Set([
    sourceTarget.output_path,
    sourceTarget.manifest_path,
    path.join(sourceArtifactDir, "visual_v4_render.mp4"),
    path.join(sourceArtifactDir, "render_manifest.json"),
  ].map((value) => clean(value)).filter(Boolean).map((value) => normalPath(resolveFrom(sourceArtifactDir, value))));
  return (sourcePath) => {
    if (normalPath(sourcePath) === normalPath(sourceArtifactDir)) return true;
    if (excluded.has(normalPath(sourcePath))) return false;
    const relative = path.relative(sourceArtifactDir, sourcePath).replace(/\\/g, "/").toLowerCase();
    if (/\.render\.lock$|\.partial-[^/]+\.mp4$/.test(relative)) return false;
    if (["flagship/generation_manifest.json", "flagship/inventory.json"].includes(relative)) return false;
    return true;
  };
}

function repairedAudioManifest(sourceManifest, storyId, current) {
  const timestampMeta = current.timestampDocument?.meta || {};
  const provider = timestampNarrationProvider(current.timestampDocument);
  const whisperAlignment =
    timestampMeta.timestampWhisperAlignment ||
    timestampMeta.timestamp_whisper_alignment ||
    current.timestampDocument?.timestampWhisperAlignment ||
    current.timestampDocument?.timestamp_whisper_alignment ||
    null;
  const wordTimestampSource = clean(
    timestampMeta.wordTimestampSource ||
      timestampMeta.word_timestamp_source ||
      current.timestampDocument?.wordTimestampSource ||
      current.timestampDocument?.word_timestamp_source,
  );
  return {
    ...(sourceManifest || {}),
    story_id: storyId,
    ...(provider ? {
      voice_provider: provider,
      provider_id: provider,
      tts_provider: provider,
    } : {}),
    transcript: timestampSpokenScript(current.timestampDocument),
    word_timestamp_count: timestampSpokenWords(current.timestampDocument).length,
    ...(wordTimestampSource ? { word_timestamp_source: wordTimestampSource } : {}),
    ...(whisperAlignment ? { timestamp_whisper_alignment: clone(whisperAlignment) } : {}),
    narration_audio_path: current.narration.path,
    resolved_narration_audio_path: current.narration.path,
    narration_audio_sha256: current.narration.sha256,
    narration_audio_size_bytes: current.narration.size_bytes,
    word_timestamps_path: current.timestamps.path,
    resolved_word_timestamps_path: current.timestamps.path,
    word_timestamps_sha256: current.timestamps.sha256,
    word_timestamps_size_bytes: current.timestamps.size_bytes,
  };
}

function repairedMotionManifest(current, storyId, generatedAt, requirements) {
  const rows = current.selected.map((clip) => clip.row);
  const directFamilies = unique(current.directVideoClips.map((clip) => clip.family));
  const genuineBaseSourceKeys = genuineBaseSourceIdentityKeys(current);
  return {
    ...clone(current.motionManifest),
    story_id: storyId,
    status: "ready",
    clips: rows,
    materialised_clips: rows,
    materialized_clips: rows,
    selected_materialised_motion_clip_ids: current.selectedIds,
    distinct_motion_families: current.families,
    distinct_source_families: genuineBaseSourceKeys,
    clip_count: rows.length,
    distinct_motion_family_count: current.families.length,
    distinct_genuine_base_source_count: current.genuineBaseSourceCount,
    genuine_base_source_identity_keys: genuineBaseSourceKeys,
    genuine_base_source_identities: clone(current.genuineBaseSourceIdentities),
    genuine_base_sources: clone(current.genuineBaseSourceIdentities),
    professional_source_diversity: repairedProfessionalSourceDiversity(
      current,
      requirements.minGenuineBaseSources,
    ),
    minimum_requirements: {
      ...(current.motionManifest.minimum_requirements || {}),
      min_genuine_base_sources: requirements.minGenuineBaseSources,
    },
    direct_video_motion_asset_count: current.directVideoClips.length,
    direct_video_motion_family_count: directFamilies.length,
    flagship_work_order_repaired_at: generatedAt,
  };
}

function repairedJobEvidence(sourceEvidence, current, requirements) {
  const evidence = clone(sourceEvidence || {});
  const realFamilies = unique(current.realClips.map((clip) => clip.family));
  const directFamilies = unique(current.directVideoClips.map((clip) => clip.family));
  const genuineBaseSourceKeys = genuineBaseSourceIdentityKeys(current);
  const professionalSourceDiversity = repairedProfessionalSourceDiversity(
    current,
    requirements.minGenuineBaseSources,
  );
  Object.assign(evidence, {
    narration_ready: true,
    word_timestamps_ready: true,
    materialised_motion_ready: true,
    distinct_motion_families_ready: current.families.length > 0,
    narration_audio_path: current.narration.path,
    narration_audio_sha256: current.narration.sha256,
    narration_audio_size_bytes: current.narration.size_bytes,
    word_timestamps_path: current.timestamps.path,
    word_timestamps_sha256: current.timestamps.sha256,
    word_timestamps_size_bytes: current.timestamps.size_bytes,
    selected_materialised_motion_clip_ids: current.selectedIds,
    materialised_motion_clip_paths: current.clipPaths,
    materialised_motion_clip_mtimes: current.clipMtimes,
    materialised_motion_clip_count: current.selected.length,
    distinct_motion_family_count: current.families.length,
    distinct_genuine_base_source_count: current.genuineBaseSourceCount,
    distinct_source_families: genuineBaseSourceKeys,
    genuine_base_source_identity_keys: genuineBaseSourceKeys,
    genuine_base_source_identities: clone(current.genuineBaseSourceIdentities),
    genuine_base_sources: clone(current.genuineBaseSourceIdentities),
    professional_source_diversity: professionalSourceDiversity,
    repeat_free_timeline_coverage: current.timelineCoverage
      ? clone(current.timelineCoverage)
      : null,
    minimum_required_genuine_base_sources: requirements.minGenuineBaseSources,
    real_visual_motion_clip_count: current.realClips.length,
    real_visual_motion_family_count: realFamilies.length,
    real_visual_motion_clip_paths: current.realClips.map((clip) => clip.path),
    direct_video_motion_clip_count: current.directVideoClips.length,
    direct_video_motion_family_count: directFamilies.length,
    stale_materialised_motion_clip_paths: [],
    selected_render_input_motion_ready:
      (!requirements.minClips || current.selected.length >= requirements.minClips) &&
      (!requirements.minFamilies || current.families.length >= requirements.minFamilies) &&
      (!requirements.minGenuineBaseSources ||
        current.genuineBaseSourceCount >= requirements.minGenuineBaseSources) &&
      (!current.timelineCoverage || current.timelineCoverage.status === "pass"),
  });
  evidence.real_motion_input_readiness = {
    ...(sourceEvidence?.real_motion_input_readiness || {}),
    has_direct_video_motion: current.directVideoClips.length > 0 && directFamilies.length > 0,
    direct_video_motion_asset_count: current.directVideoClips.length,
    direct_video_motion_family_count: directFamilies.length,
    direct_video_motion_clip_floor:
      requirements.directVideoFloor || requirements.minClips || current.directVideoClips.length,
    direct_video_motion_clip_floor_met:
      !(requirements.directVideoFloor || requirements.minClips) ||
      current.directVideoClips.length >= (requirements.directVideoFloor || requirements.minClips),
    materialised_real_motion_clip_floor_met:
      !requirements.minClips || current.realClips.length >= requirements.minClips,
    total_motion_budget_met:
      (!requirements.minClips || current.selected.length >= requirements.minClips) &&
      (!requirements.minFamilies || current.families.length >= requirements.minFamilies) &&
      (!requirements.minGenuineBaseSources ||
        current.genuineBaseSourceCount >= requirements.minGenuineBaseSources) &&
      (!current.timelineCoverage || current.timelineCoverage.status === "pass"),
    required_genuine_base_source_count: requirements.minGenuineBaseSources,
    distinct_genuine_base_source_count: current.genuineBaseSourceCount,
    genuine_base_source_count_met:
      !requirements.minGenuineBaseSources ||
      current.genuineBaseSourceCount >= requirements.minGenuineBaseSources,
  };
  if (sourceEvidence?.file_evidence && typeof sourceEvidence.file_evidence === "object") {
    evidence.file_evidence = {
      ...clone(sourceEvidence.file_evidence),
      narration_ready: true,
      word_timestamps_ready: true,
      materialised_motion_ready: true,
      distinct_motion_families_ready: current.families.length > 0,
      narration_audio_path: current.narration.path,
      narration_audio_sha256: current.narration.sha256,
      narration_audio_size_bytes: current.narration.size_bytes,
      word_timestamps_path: current.timestamps.path,
      word_timestamps_sha256: current.timestamps.sha256,
      word_timestamps_size_bytes: current.timestamps.size_bytes,
      selected_materialised_motion_clip_ids: current.selectedIds,
      materialised_motion_clip_paths: current.clipPaths,
      materialised_motion_clip_mtimes: current.clipMtimes,
      materialised_motion_clip_count: current.selected.length,
      distinct_motion_family_count: current.families.length,
      distinct_genuine_base_source_count: current.genuineBaseSourceCount,
      distinct_source_families: genuineBaseSourceKeys,
      genuine_base_source_identity_keys: genuineBaseSourceKeys,
      genuine_base_source_identities: clone(current.genuineBaseSourceIdentities),
      genuine_base_sources: clone(current.genuineBaseSourceIdentities),
      professional_source_diversity: clone(professionalSourceDiversity),
      repeat_free_timeline_coverage: current.timelineCoverage
        ? clone(current.timelineCoverage)
        : null,
      minimum_required_genuine_base_sources: requirements.minGenuineBaseSources,
      stale_materialised_motion_clip_paths: [],
    };
  }
  for (const key of [
    "audio_fingerprint_matches_render",
    "word_timestamps_fingerprint_matches_render",
    "audio_size_matches_render",
    "word_timestamps_size_matches_render",
  ]) {
    delete evidence[key];
    if (evidence.file_evidence) delete evidence.file_evidence[key];
  }
  return evidence;
}

function quoted(value) {
  return JSON.stringify(String(value));
}

function buildRepairedWorkOrder({
  sourceWorkOrder,
  sourceJob,
  sourceActions,
  canonicalTitle,
  storyId,
  artifactDir,
  outputPath,
  manifestPath,
  workOrderPath,
  workspaceDir,
  current,
  requirements,
  generatedAt,
  sourceWorkOrderPath,
  sourceWorkOrderSha256,
  currentEvidencePath,
  currentEvidenceSha256,
  currentEvidenceEmbedded,
}) {
  const target = {
    ...clone(sourceJob.target_render_manifest),
    output: path.basename(outputPath),
    output_path: outputPath,
    manifest_path: manifestPath,
    story_id: storyId,
  };
  const actions = sourceActions.map((sourceAction) => {
    const action = clone(sourceAction);
    action.required_artefact_path = outputPath;
    action.required_artefact_paths = [outputPath, manifestPath];
    action.target_render_manifest = { ...(action.target_render_manifest || {}), ...target };
    action.recommended_command = [
      "node tools/goal-production-render-materializer.js",
      `--work-order ${quoted(workOrderPath)}`,
      `--workspace ${quoted(workspaceDir)}`,
      `--story-id ${quoted(storyId)}`,
      "--force --json",
    ].join(" ");
    delete action.post_repair_validation_command;
    return action;
  });
  const job = {
    ...clone(sourceJob),
    title: clean(canonicalTitle) || clean(sourceJob.title),
    artifact_dir: artifactDir,
    force_final_render: true,
    status: "ready_for_final_render_job",
    blockers: [],
    evidence: repairedJobEvidence(sourceJob.evidence, current, requirements),
    target_render_manifest: target,
    actions,
  };
  return {
    schema_version: Number(sourceWorkOrder.schema_version || 1),
    generated_at: generatedAt,
    mode: WORK_ORDER_MODE,
    source_work_order_path: sourceWorkOrderPath,
    source_work_order_sha256: sourceWorkOrderSha256,
    source_work_order_generated_at: sourceWorkOrder.generated_at || null,
    current_evidence_path: currentEvidencePath,
    current_evidence_sha256: currentEvidenceSha256,
    current_evidence_embedded: currentEvidenceEmbedded,
    summary: {
      story_count: 1,
      ready_for_final_render_job_count: 1,
      blocked_on_render_inputs_count: 0,
    },
    jobs: [job],
    publish_authorised: false,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      production_db_mutated: false,
      oauth_or_token_mutated: false,
      gate_weakened: false,
      render_executed: false,
    },
  };
}

function stagePath(workspaceDir, stagingDir, finalPath) {
  return path.join(stagingDir, path.relative(workspaceDir, finalPath));
}

async function assertCurrentEvidenceUnchanged(current, controlFiles = []) {
  const files = [
    ...controlFiles,
    ["narration_audio", current.narration],
    ["word_timestamps", current.timestamps],
    ["materialised_motion_manifest", current.motionManifestEvidence],
    ...current.selected.map((clip) => [
      `materialised_motion_clip:${clip.id}`,
      { path: clip.path, size_bytes: clip.size_bytes, mtime_ms: clip.mtime_ms },
    ]),
  ];
  for (const [label, evidence] of files) {
    if (!(await fs.pathExists(evidence.path))) {
      throw new Error(`current_evidence_changed_before_commit:${label}`);
    }
    const stat = await fs.stat(evidence.path);
    if (!stat.isFile() || stat.size !== evidence.size_bytes || stat.mtimeMs !== evidence.mtime_ms) {
      throw new Error(`current_evidence_changed_before_commit:${label}`);
    }
  }
}

function assertTargetFilesDoNotAliasDirectories({ workspaceDir, artifactDir, files }) {
  for (const [label, filePath] of files) {
    if (
      filePath === workspaceDir ||
      filePath === artifactDir ||
      pathIsInside(filePath, artifactDir)
    ) {
      throw new Error(`isolated_target_file_matches_directory:${label}`);
    }
  }
  for (let left = 0; left < files.length; left += 1) {
    for (let right = left + 1; right < files.length; right += 1) {
      if (files[left][1] === files[right][1]) {
        throw new Error(`isolated_target_file_collision:${files[left][0]}:${files[right][0]}`);
      }
    }
  }
}

async function repairFlagshipRenderWorkOrder(options = {}) {
  const sourceWorkOrderPath = requirePath(
    options.sourceWorkOrderPath || options.workOrderPath,
    "source_work_order_path_required",
  );
  const workspaceDir = requirePath(
    options.workspaceDir || options.isolatedWorkspace || options.workspaceRoot,
    "workspace_dir_required",
  );
  if (await fs.pathExists(workspaceDir)) throw new Error("isolated_workspace_already_exists");

  const inlineEvidence = options.currentEvidence;
  const currentEvidenceEmbedded = Boolean(inlineEvidence);
  if (
    currentEvidenceEmbedded &&
    (typeof inlineEvidence !== "object" || Array.isArray(inlineEvidence))
  ) {
    throw new Error("current_evidence_inline_invalid");
  }
  const currentEvidencePath = currentEvidenceEmbedded
    ? assertTargetPath(
      workspaceDir,
      options.currentEvidenceOutputPath || path.join(workspaceDir, "current_evidence.json"),
      "current_evidence_path",
    )
    : requirePath(
      options.currentEvidencePath || options.evidencePath,
      "current_evidence_path_required",
    );
  const inlineEvidenceBytes = currentEvidenceEmbedded
    ? Buffer.from(`${JSON.stringify(inlineEvidence, null, 2)}\n`)
    : null;

  const [sourceDocument, evidenceDocument] = await Promise.all([
    readJson(sourceWorkOrderPath, "source_work_order"),
    currentEvidenceEmbedded
      ? Promise.resolve({
        value: clone(inlineEvidence),
        bytes: inlineEvidenceBytes,
        fileEvidence: {
          path: currentEvidencePath,
          sha256: sha256(inlineEvidenceBytes),
          size_bytes: inlineEvidenceBytes.length,
          mtime_ms: null,
        },
      })
      : readJson(currentEvidencePath, "current_evidence"),
  ]);
  const sourceWorkOrder = sourceDocument.value;
  const currentEvidence = evidenceDocument.value;
  const storyId = clean(currentEvidence.story_id);
  if (!storyId) throw new Error("current_evidence_story_id_missing");
  if (!/^[A-Za-z0-9._-]+$/.test(storyId)) throw new Error("current_evidence_story_id_not_path_safe");
  const { job: sourceJob, actions: sourceActions } = selectSourceJob(sourceWorkOrder, storyId);
  const sourceArtifactDir = resolveFrom(
    path.dirname(sourceWorkOrderPath),
    options.sourceArtifactDir || sourceJob.artifact_dir,
  );
  if (!sourceArtifactDir || !(await fs.pathExists(sourceArtifactDir))) {
    throw new Error("missing_file:source_artifact_dir");
  }
  const sourceArtifactStat = await fs.stat(sourceArtifactDir);
  if (!sourceArtifactStat.isDirectory()) throw new Error("unusable_file:source_artifact_dir");
  const sourceCanonicalPath = path.join(sourceArtifactDir, "canonical_story_manifest.json");
  let sourceCanonical = null;
  if (await fs.pathExists(sourceCanonicalPath)) {
    sourceCanonical = (await readJson(sourceCanonicalPath, "source_canonical_story_manifest")).value;
    const canonicalStoryId = clean(sourceCanonical.story_id || sourceCanonical.id);
    if (canonicalStoryId && canonicalStoryId !== storyId) {
      throw new Error(`source_artifact_story_id_mismatch:${canonicalStoryId}`);
    }
  }

  const artifactDir = assertTargetPath(
    workspaceDir,
    options.targetArtifactDir || path.join(workspaceDir, "artifacts", storyId),
    "artifact_dir",
  );
  const outputPath = assertTargetPath(
    workspaceDir,
    options.targetOutputPath || path.join(artifactDir, "visual_v4_render.mp4"),
    "output_path",
  );
  const manifestPath = assertTargetPath(
    workspaceDir,
    options.targetManifestPath || path.join(artifactDir, "render_manifest.json"),
    "manifest_path",
  );
  const workOrderPath = assertTargetPath(
    workspaceDir,
    options.outputWorkOrderPath || options.repairedWorkOrderPath || path.join(workspaceDir, "render_input_work_order.json"),
    "work_order_path",
  );
  const reportPath = assertTargetPath(
    workspaceDir,
    options.reportPath || path.join(workspaceDir, "flagship_render_workorder_repair_report.json"),
    "report_path",
  );
  assertTargetFilesDoNotAliasDirectories({
    workspaceDir,
    artifactDir,
    files: [
      ["output_path", outputPath],
      ["manifest_path", manifestPath],
      ["work_order_path", workOrderPath],
      ["report_path", reportPath],
      ...(currentEvidenceEmbedded ? [["current_evidence_path", currentEvidencePath]] : []),
    ],
  });
  if (pathIsInside(sourceArtifactDir, workspaceDir) || pathIsInside(workspaceDir, sourceArtifactDir)) {
    throw new Error("isolated_workspace_overlaps_source_artifact");
  }

  const current = await inspectCurrentEvidence({
    currentEvidence,
    currentEvidenceDir: currentEvidenceEmbedded
      ? path.resolve(options.currentEvidenceBaseDir || process.cwd())
      : path.dirname(currentEvidencePath),
    storyId,
  });
  if (!sourceCanonical) throw new Error("missing_file:source_canonical_story_manifest");
  const narrationLineage = synchronisedCanonicalNarration(sourceCanonical, current.timestampDocument);
  const requirements = enforceSourceRequirements(sourceJob, current);
  enforceRepeatFreeTimelineCoverage(sourceJob, current, {
    ffprobeDurationImpl: options.ffprobeDurationImpl,
  });
  const rightsEvidence = await inspectCurrentRightsEvidence({
    sourceArtifactDir,
    current,
    storyId,
  });
  await rejectSourceArtifactSymlinks(sourceArtifactDir);
  const generatedAt = clean(options.generatedAt) || new Date().toISOString();
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("generated_at_invalid");

  const packagedNarrationPath = path.join(
    artifactDir,
    "flagship",
    `final_audio${path.extname(current.narration.path) || ".audio"}`,
  );
  const packagedTimestampsPath = path.join(artifactDir, "flagship", "word_timestamps.json");
  const packagedCurrent = {
    ...current,
    narration: { ...current.narration, path: packagedNarrationPath },
    timestamps: { ...current.timestamps, path: packagedTimestampsPath },
  };
  const packagedRightsLedger = reconciledRightsLedger({
    evidence: rightsEvidence,
    current: packagedCurrent,
    storyId,
    generatedAt,
  });
  const workOrder = buildRepairedWorkOrder({
    sourceWorkOrder,
    sourceJob,
    sourceActions,
    canonicalTitle:
      sourceCanonical.selected_title ||
      sourceCanonical.canonical_title ||
      sourceCanonical.public_title ||
      sourceCanonical.title,
    storyId,
    artifactDir,
    outputPath,
    manifestPath,
    workOrderPath,
    workspaceDir,
    current: packagedCurrent,
    requirements,
    generatedAt,
    sourceWorkOrderPath,
    sourceWorkOrderSha256: sourceDocument.fileEvidence.sha256,
    currentEvidencePath,
    currentEvidenceSha256: evidenceDocument.fileEvidence.sha256,
    currentEvidenceEmbedded,
  });
  const report = {
    schema_version: 1,
    generated_at: generatedAt,
    mode: WORK_ORDER_MODE,
    status: "READY_FOR_LOCAL_RENDER",
    story_id: storyId,
    source_work_order_path: sourceWorkOrderPath,
    source_work_order_sha256: sourceDocument.fileEvidence.sha256,
    current_evidence_path: currentEvidencePath,
    current_evidence_sha256: evidenceDocument.fileEvidence.sha256,
    current_evidence_embedded: currentEvidenceEmbedded,
    work_order_path: workOrderPath,
    artifact_dir: artifactDir,
    target_output_path: outputPath,
    target_manifest_path: manifestPath,
    selected_materialised_motion_clip_ids: current.selectedIds,
    selected_materialised_motion_clip_count: current.selected.length,
    distinct_motion_family_count: current.families.length,
    distinct_genuine_base_source_count: current.genuineBaseSourceCount,
    distinct_source_families: genuineBaseSourceIdentityKeys(current),
    genuine_base_source_identity_keys: genuineBaseSourceIdentityKeys(current),
    genuine_base_source_identities: clone(current.genuineBaseSourceIdentities),
    genuine_base_sources: clone(current.genuineBaseSourceIdentities),
    professional_source_diversity: repairedProfessionalSourceDiversity(
      current,
      requirements.minGenuineBaseSources,
    ),
    repeat_free_timeline_coverage: current.timelineCoverage || null,
    minimum_required_genuine_base_sources: requirements.minGenuineBaseSources,
    current_media_evidence_embedded: true,
    packaged_narration_audio_path: packagedNarrationPath,
    packaged_word_timestamps_path: packagedTimestampsPath,
    packaged_rights_ledger_path: path.join(artifactDir, "rights_ledger.json"),
    rights_record_count: packagedRightsLedger.records.length,
    rights_reconciliation: clone(
      packagedRightsLedger.flagship_rights_reconciliation,
    ),
    invalidated_stale_derived_evidence: [],
    publish_authorised: false,
    safety: {
      render_executed: false,
      no_publish_triggered: true,
      production_db_mutated: false,
      oauth_or_token_mutated: false,
      source_artifact_mutated: false,
      isolated_workspace_created: true,
    },
  };

  const stagingDir = path.join(
    path.dirname(workspaceDir),
    `.${path.basename(workspaceDir)}.${crypto.randomUUID()}.tmp`,
  );
  try {
    await fs.ensureDir(path.dirname(workspaceDir));
    const stagingArtifactDir = stagePath(workspaceDir, stagingDir, artifactDir);
    await fs.copy(sourceArtifactDir, stagingArtifactDir, {
      overwrite: false,
      errorOnExist: true,
      filter: sourceCopyFilter(sourceArtifactDir, sourceJob.target_render_manifest || {}),
    });

    await fs.remove(stagePath(workspaceDir, stagingDir, outputPath));
    await fs.remove(stagePath(workspaceDir, stagingDir, manifestPath));
    const invalidatedStaleDerivedEvidence = [];
    for (const relativePath of STALE_DERIVED_EVIDENCE_PATHS) {
      const candidate = path.join(stagingArtifactDir, relativePath);
      if (await fs.pathExists(candidate)) invalidatedStaleDerivedEvidence.push(relativePath);
      await fs.remove(candidate);
    }
    report.invalidated_stale_derived_evidence = invalidatedStaleDerivedEvidence;

    await fs.ensureDir(path.dirname(stagePath(workspaceDir, stagingDir, packagedNarrationPath)));
    await fs.copyFile(current.narration.path, stagePath(workspaceDir, stagingDir, packagedNarrationPath));
    await fs.copyFile(current.timestamps.path, stagePath(workspaceDir, stagingDir, packagedTimestampsPath));

    const clonedCanonicalPath = path.join(stagingArtifactDir, "canonical_story_manifest.json");
    const clonedCanonical = (await readJson(clonedCanonicalPath, "cloned_canonical_story_manifest")).value;
    await fs.writeJson(clonedCanonicalPath, {
      ...clonedCanonical,
      narration_script: narrationLineage.displayScript,
      tts_script: narrationLineage.spokenScript,
      spoken_narration_script: narrationLineage.spokenScript,
      flagship_narration_lineage_repaired_at: generatedAt,
    }, { spaces: 2 });

    const sourceAudioManifestPath = path.join(stagingArtifactDir, "audio_manifest.json");
    const sourceAudioManifest = await fs.pathExists(sourceAudioManifestPath)
      ? (await readJson(sourceAudioManifestPath, "cloned_audio_manifest")).value
      : {};
    await fs.writeJson(
      sourceAudioManifestPath,
      repairedAudioManifest(sourceAudioManifest, storyId, packagedCurrent),
      { spaces: 2 },
    );
    await fs.writeJson(
      path.join(stagingArtifactDir, "rights_ledger.json"),
      packagedRightsLedger,
      { spaces: 2 },
    );
    await fs.writeJson(
      path.join(stagingArtifactDir, "materialised_motion_clips.json"),
      repairedMotionManifest(current, storyId, generatedAt, requirements),
      { spaces: 2 },
    );
    const familyReportPath = path.join(stagingArtifactDir, "distinct_motion_family_report.json");
    if (await fs.pathExists(familyReportPath)) {
      const familyReport = (await readJson(familyReportPath, "cloned_motion_family_report")).value;
      await fs.writeJson(familyReportPath, {
        ...familyReport,
        story_id: storyId,
        status: "ready",
        generated_at: generatedAt,
        clip_count: current.selected.length,
        distinct_motion_family_count: current.families.length,
        distinct_genuine_base_source_count: current.genuineBaseSourceCount,
        distinct_source_families: genuineBaseSourceIdentityKeys(current),
        genuine_base_source_identity_keys: genuineBaseSourceIdentityKeys(current),
        genuine_base_source_identities: clone(current.genuineBaseSourceIdentities),
        genuine_base_sources: clone(current.genuineBaseSourceIdentities),
        professional_source_diversity: repairedProfessionalSourceDiversity(
          current,
          requirements.minGenuineBaseSources,
        ),
        families: current.families,
        distinct_motion_families: current.families,
        summary: {
          ...(familyReport.summary || {}),
          clip_count: current.selected.length,
          distinct_motion_family_count: current.families.length,
          distinct_genuine_base_source_count: current.genuineBaseSourceCount,
          minimum_required_genuine_base_sources: requirements.minGenuineBaseSources,
        },
      }, { spaces: 2 });
    }

    const stagingWorkOrderPath = stagePath(workspaceDir, stagingDir, workOrderPath);
    const stagingReportPath = stagePath(workspaceDir, stagingDir, reportPath);
    if (currentEvidenceEmbedded) {
      const stagingEvidencePath = stagePath(workspaceDir, stagingDir, currentEvidencePath);
      await fs.ensureDir(path.dirname(stagingEvidencePath));
      await fs.writeFile(stagingEvidencePath, inlineEvidenceBytes);
    }
    await fs.ensureDir(path.dirname(stagingWorkOrderPath));
    await fs.ensureDir(path.dirname(stagingReportPath));
    await fs.writeJson(stagingWorkOrderPath, workOrder, { spaces: 2 });
    await fs.writeJson(stagingReportPath, report, { spaces: 2 });
    await assertCurrentEvidenceUnchanged(current, [
      ["source_work_order", sourceDocument.fileEvidence],
      ...(!currentEvidenceEmbedded ? [["current_evidence", evidenceDocument.fileEvidence]] : []),
      ...rightsEvidence.controlFiles,
    ]);
    if (await fs.pathExists(workspaceDir)) throw new Error("isolated_workspace_created_concurrently");
    await fs.rename(stagingDir, workspaceDir);
  } catch (error) {
    await fs.remove(stagingDir).catch(() => {});
    throw error;
  }

  return {
    workOrder,
    workOrderPath,
    report,
    reportPath,
    currentEvidencePath,
  };
}

module.exports = {
  repairFlagshipRenderWorkOrder,
};
