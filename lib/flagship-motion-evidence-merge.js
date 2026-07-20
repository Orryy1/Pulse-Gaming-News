"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const fs = require("fs-extra");

const {
  evaluateGenuineBaseSourceDiversity,
} = require("./genuine-base-source-diversity");
const {
  assessProfessionalSourceDiversity,
} = require("./studio/motion-source-identity");

const ENABLED_PLATFORMS = Object.freeze([
  "youtube_shorts",
  "instagram_reels",
  "facebook_reels",
]);
const SCRIPT_REPAIR_BLOCKER =
  "narration_and_render_regeneration_required_after_script_repair";

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/i.test(clean(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalPath(value) {
  return path.resolve(value).replace(/\\/g, "/").toLowerCase();
}

function pathIsInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function motionRows(manifest = {}) {
  if (asArray(manifest.materialised_clips).length) return manifest.materialised_clips;
  if (asArray(manifest.materialized_clips).length) return manifest.materialized_clips;
  return asArray(manifest.clips);
}

function clipId(clip = {}) {
  return clean(clip.id || clip.clip_id || clip.asset_id || clip.motion_pack_clip_id);
}

function clipPath(clip = {}) {
  return clean(
    clip.path ||
      clip.local_materialized_path ||
      clip.local_materialised_path ||
      clip.clip_path,
  );
}

function clipHash(clip = {}) {
  return clean(
    clip.asset_sha256 ||
      clip.sha256 ||
      clip.file_sha256 ||
      clip.materialized_file_evidence?.sha256 ||
      clip.materialised_file_evidence?.sha256,
  ).toLowerCase();
}

function clipSize(clip = {}) {
  return Number(
    clip.asset_size_bytes ??
      clip.size_bytes ??
      clip.file_size_bytes ??
      clip.materialized_file_evidence?.size_bytes ??
      clip.materialised_file_evidence?.size_bytes,
  );
}

function recordId(record = {}) {
  return clean(record.asset_id || record.assetId || record.id);
}

function recordHash(record = {}) {
  return clean(
    record.asset_sha256 ||
      record.assetSha256 ||
      record.file_sha256 ||
      record.sha256,
  ).toLowerCase();
}

function recordSize(record = {}) {
  return Number(
    record.asset_size_bytes ??
      record.assetSizeBytes ??
      record.file_size_bytes ??
      record.size_bytes,
  );
}

function recordPath(record = {}) {
  return clean(record.path || record.local_materialized_path || record.asset_path);
}

function exactStringSet(left = [], right = []) {
  const a = [...new Set(left.map(clean).filter(Boolean))].sort();
  const b = [...new Set(right.map(clean).filter(Boolean))].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function readJsonWithEvidence(filePath, label) {
  const resolved = path.resolve(filePath);
  if (!(await fs.pathExists(resolved))) throw new Error(`missing_file:${label}`);
  const before = await fs.stat(resolved);
  if (!before.isFile() || before.size <= 0) throw new Error(`unusable_file:${label}`);
  const bytes = await fs.readFile(resolved);
  const after = await fs.stat(resolved);
  if (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    bytes.length !== after.size
  ) {
    throw new Error(`file_changed_during_validation:${label}`);
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`invalid_json:${label}:${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid_json_object:${label}`);
  }
  return {
    value,
    evidence: {
      path: resolved,
      sha256: sha256(bytes),
      size_bytes: bytes.length,
    },
  };
}

async function fingerprintFile(filePath, label) {
  const resolved = path.resolve(filePath);
  if (!(await fs.pathExists(resolved))) throw new Error(`missing_file:${label}`);
  const before = await fs.stat(resolved);
  if (!before.isFile() || before.size <= 0) throw new Error(`unusable_file:${label}`);
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(resolved)) hash.update(chunk);
  const after = await fs.stat(resolved);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new Error(`file_changed_during_validation:${label}`);
  }
  return {
    path: resolved,
    sha256: hash.digest("hex"),
    size_bytes: after.size,
  };
}

function defaultProbeMedia(filePath) {
  const raw = execFileSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,codec_name,width,height",
    "-of",
    "json",
    filePath,
  ], {
    encoding: "utf8",
    timeout: 30_000,
  });
  const parsed = JSON.parse(raw);
  const video = asArray(parsed.streams).find((stream) => stream.codec_type === "video");
  return {
    duration_seconds: Number(parsed.format?.duration || video?.duration || 0),
    video_codec: clean(video?.codec_name),
    width: Number(video?.width || 0),
    height: Number(video?.height || 0),
  };
}

function expectedTransitionBlockers(storyId) {
  const audioId = `${storyId}_audio_path`;
  return [
    `narration_commercial_rights_evidence_not_green:${audioId}`,
    "used_asset_rights_coverage_incomplete",
    `flagship_rights_sidecar_source_record_missing:${audioId}`,
    SCRIPT_REPAIR_BLOCKER,
  ];
}

function assertLedgerScope(ledger, storyId, label, { allowNarrationTransition = false } = {}) {
  if (clean(ledger.story_id) !== storyId) {
    throw new Error(`${label}_story_id_mismatch:${clean(ledger.story_id) || "missing"}`);
  }
  const verdict = clean(ledger.verdict).toLowerCase();
  const status = clean(ledger.status).toLowerCase();
  const blockers = asArray(ledger.blockers).map(clean).filter(Boolean);
  const failures = asArray(ledger.failures);
  if (["pass", "green"].includes(verdict)) {
    if (status && !["pass", "green", "ready"].includes(status)) {
      throw new Error(`${label}_status_not_ready:${status}`);
    }
    if (blockers.length || failures.length) throw new Error(`${label}_pass_has_blockers`);
    return "authoritative_pass";
  }
  const transitionAllowed =
    allowNarrationTransition &&
    verdict === "red" &&
    status === "blocked" &&
    failures.length === 0 &&
    exactStringSet(blockers, expectedTransitionBlockers(storyId)) &&
    Number(ledger.metrics?.missing_asset_count) === 1 &&
    Number(ledger.metrics?.duplicate_record_count || 0) === 0 &&
    ledger.reconciliation?.safe_demotion_applied === true &&
    ledger.reconciliation?.authoritative_publish_verdict_unchanged === true;
  if (!transitionAllowed) {
    throw new Error(`${label}_not_reconcilable:${verdict || "missing"}`);
  }
  return "narration_transition_preserved";
}

function indexedRows(rows, label) {
  const index = new Map();
  for (const row of asArray(rows)) {
    const id = recordId(row);
    if (!id) throw new Error(`${label}_asset_id_missing`);
    if (index.has(id)) throw new Error(`${label}_asset_id_duplicate:${id}`);
    index.set(id, row);
  }
  return index;
}

function assertCompleteMotionRightsRecord(record, clip, label) {
  const approval = clean(record.approval_status || record.status).toLowerCase();
  const kinds = [
    record.kind,
    record.asset_type,
    record.assetType,
  ].map((value) => clean(value).toLowerCase()).filter(Boolean);
  if (!kinds.some((value) => value.includes("video") || value.includes("motion"))) {
    throw new Error(`${label}_kind_invalid`);
  }
  if (!clean(record.source_url)) throw new Error(`${label}_source_url_missing`);
  if (!clean(record.source_type)) throw new Error(`${label}_source_type_missing`);
  if (!clean(record.licence_basis || record.license_basis)) {
    throw new Error(`${label}_licence_basis_missing`);
  }
  if (!clean(record.allowed_use)) throw new Error(`${label}_allowed_use_missing`);
  if (!ENABLED_PLATFORMS.every((platform) => asArray(record.allowed_platforms).includes(platform))) {
    throw new Error(`${label}_allowed_platforms_incomplete`);
  }
  if (record.commercial_use_allowed !== true) {
    throw new Error(`${label}_commercial_use_not_allowed`);
  }
  if (record.rights_grant !== true) throw new Error(`${label}_rights_grant_missing`);
  if (record.transformative_rights_evidence_verified !== true) {
    throw new Error(`${label}_transformative_evidence_not_verified`);
  }
  if (!approval.startsWith("approved") && approval !== "cleared" && approval !== "pass") {
    throw new Error(`${label}_approval_status_invalid`);
  }
  if (!clean(record.evidence_file || record.rights_evidence_file)) {
    throw new Error(`${label}_evidence_file_missing`);
  }
  if (!isSha256(record.evidence_sha256 || record.rights_evidence_sha256)) {
    throw new Error(`${label}_evidence_sha256_missing`);
  }
  if (!Number.isInteger(Number(record.evidence_size_bytes || record.rights_evidence_size_bytes))) {
    throw new Error(`${label}_evidence_size_missing`);
  }
  if (!clip || clipId(clip) !== recordId(record)) throw new Error(`${label}_clip_binding_invalid`);
}

async function inspectSelectedClip({
  clip,
  manifestDir,
  record,
  usedAsset,
  probeMedia,
  allowTransitionRebinding = false,
  label,
}) {
  assertCompleteMotionRightsRecord(record, clip, label);
  const resolvedClipPath = path.resolve(manifestDir, clipPath(clip));
  const file = await fingerprintFile(resolvedClipPath, `${label}:media`);
  const declaredClipHash = clipHash(clip);
  const declaredClipSize = clipSize(clip);
  if (!isSha256(declaredClipHash) || declaredClipHash !== file.sha256) {
    throw new Error(`${label}_clip_hash_mismatch`);
  }
  if (!Number.isInteger(declaredClipSize) || declaredClipSize !== file.size_bytes) {
    throw new Error(`${label}_clip_size_mismatch`);
  }
  const recordBindingMatches =
    normalPath(path.resolve(manifestDir, recordPath(record))) === normalPath(file.path) &&
    recordHash(record) === file.sha256 &&
    recordSize(record) === file.size_bytes;
  const usedBindingMatches =
    normalPath(path.resolve(manifestDir, recordPath(usedAsset))) === normalPath(file.path) &&
    recordHash(usedAsset) === file.sha256 &&
    recordSize(usedAsset) === file.size_bytes;
  const transitionEvidence =
    record.materialized_file_evidence ||
    record.materialised_file_evidence ||
    {};
  const transitionBindingMatches =
    allowTransitionRebinding &&
    clean(transitionEvidence.sha256).toLowerCase() === file.sha256 &&
    Number(transitionEvidence.size_bytes) === file.size_bytes &&
    clean(record.source_url) === clean(usedAsset.source_url) &&
    clean(record.source_type) === clean(usedAsset.source_type);
  if (!recordBindingMatches && !transitionBindingMatches) {
    throw new Error(`${label}_rights_file_binding_mismatch`);
  }
  if (!usedBindingMatches && !transitionBindingMatches) {
    throw new Error(`${label}_used_asset_binding_mismatch`);
  }
  const evidencePath = path.resolve(
    manifestDir,
    clean(record.evidence_file || record.rights_evidence_file),
  );
  const evidence = await fingerprintFile(evidencePath, `${label}:rights_evidence`);
  const declaredEvidenceHash = clean(
    record.evidence_sha256 || record.rights_evidence_sha256,
  ).toLowerCase();
  const declaredEvidenceSize = Number(
    record.evidence_size_bytes || record.rights_evidence_size_bytes,
  );
  if (
    evidence.sha256 !== declaredEvidenceHash ||
    evidence.size_bytes !== declaredEvidenceSize
  ) {
    throw new Error(`${label}_rights_evidence_binding_mismatch`);
  }
  const media = await probeMedia(file.path);
  if (
    !media ||
    !Number.isFinite(Number(media.duration_seconds)) ||
    Number(media.duration_seconds) <= 0 ||
    !clean(media.video_codec) ||
    Number(media.width) <= 0 ||
    Number(media.height) <= 0
  ) {
    throw new Error(`${label}_media_not_decodable_video`);
  }
  const descriptor = [
    clip.media_kind,
    clip.source_type,
    clip.motion_type,
  ].map((value) => clean(value).toLowerCase()).join(" ");
  if (
    !descriptor.includes("video") ||
    /(?:generated[_ -]?card|still|image|ken[_ -]?burns|placeholder)/.test(descriptor) ||
    clip.materialized !== true ||
    clip.counts_towards_motion_readiness !== true
  ) {
    throw new Error(`${label}_not_genuine_direct_motion`);
  }
  return {
    clip: {
      ...clone(clip),
      path: file.path,
      local_materialized_path: file.path,
      asset_sha256: file.sha256,
      asset_size_bytes: file.size_bytes,
      materialized_duration_s: Number(media.duration_seconds),
      materialized_file_evidence: {
        ...(clone(clip.materialized_file_evidence || {})),
        sha256: file.sha256,
        size_bytes: file.size_bytes,
        duration_seconds: Number(media.duration_seconds),
        video_codec: clean(media.video_codec),
        width: Number(media.width),
        height: Number(media.height),
      },
    },
    record: {
      ...clone(record),
      path: file.path,
      asset_sha256: file.sha256,
      asset_size_bytes: file.size_bytes,
    },
    usedAsset: {
      ...clone(usedAsset),
      path: file.path,
      asset_sha256: file.sha256,
      asset_size_bytes: file.size_bytes,
    },
    file,
    evidence,
    transitionRebound: !recordBindingMatches || !usedBindingMatches,
  };
}

async function inspectSource({
  manifestPath,
  storyId,
  selectedIds,
  allowNarrationTransition,
  probeMedia,
  label,
}) {
  const manifestDocument = await readJsonWithEvidence(manifestPath, `${label}_manifest`);
  const manifest = manifestDocument.value;
  if (clean(manifest.story_id) !== storyId) {
    throw new Error(`${label}_manifest_story_id_mismatch`);
  }
  const status = clean(manifest.status).toLowerCase();
  if (!["ready", "pass", "green", "materialised", "materialized"].includes(status)) {
    throw new Error(`${label}_manifest_not_ready:${status || "missing"}`);
  }
  if (asArray(manifest.blockers).length) throw new Error(`${label}_manifest_has_blockers`);
  const rows = motionRows(manifest);
  const byId = new Map();
  for (const row of rows) {
    const id = clipId(row);
    if (!id) throw new Error(`${label}_clip_id_missing`);
    if (byId.has(id)) throw new Error(`${label}_clip_id_duplicate:${id}`);
    byId.set(id, row);
  }
  const ids = asArray(selectedIds).map(clean).filter(Boolean);
  if (!ids.length) throw new Error(`${label}_selected_clip_ids_missing`);
  if (new Set(ids).size !== ids.length) throw new Error(`${label}_selected_clip_ids_duplicate`);

  const rightsPath = path.join(path.dirname(path.resolve(manifestPath)), "rights_ledger.json");
  const rightsDocument = await readJsonWithEvidence(rightsPath, `${label}_rights`);
  const ledgerState = assertLedgerScope(
    rightsDocument.value,
    storyId,
    `${label}_rights`,
    { allowNarrationTransition },
  );
  const records = indexedRows(rightsDocument.value.records, `${label}_rights_record`);
  const usedAssets = indexedRows(rightsDocument.value.used_assets, `${label}_used_asset`);
  const selected = [];
  for (const id of ids) {
    const clip = byId.get(id);
    if (!clip) throw new Error(`${label}_selected_clip_missing:${id}`);
    const record = records.get(id);
    const usedAsset = usedAssets.get(id);
    if (!record) throw new Error(`${label}_selected_rights_missing:${id}`);
    if (!usedAsset) throw new Error(`${label}_selected_used_asset_missing:${id}`);
    selected.push(await inspectSelectedClip({
      clip,
      manifestDir: path.dirname(path.resolve(manifestPath)),
      record,
      usedAsset,
      probeMedia,
      allowTransitionRebinding:
        ledgerState === "narration_transition_preserved",
      label: `${label}:${id}`,
    }));
  }
  return {
    manifest,
    manifestDocument,
    rightsDocument,
    ledgerState,
    selected,
  };
}

function selectedIdsOrAll(manifestPath, suppliedIds) {
  return async () => {
    if (asArray(suppliedIds).map(clean).filter(Boolean).length) {
      return asArray(suppliedIds).map(clean).filter(Boolean);
    }
    const document = await readJsonWithEvidence(manifestPath, "primary_manifest_selection");
    return motionRows(document.value).map(clipId).filter(Boolean);
  };
}

async function atomicWriteJson(filePath, value) {
  await fs.ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeJson(temporary, value, { spaces: 2 });
    await fs.move(temporary, filePath, { overwrite: true });
  } finally {
    await fs.remove(temporary);
  }
}

async function mergeFlagshipMotionEvidence(options = {}, dependencies = {}) {
  const storyId = clean(options.storyId);
  if (!storyId) throw new Error("story_id_missing");
  const primaryManifestPath = path.resolve(clean(options.primaryManifestPath));
  const donorManifestPath = path.resolve(clean(options.donorManifestPath));
  const outputDir = path.resolve(clean(options.outputDir));
  if (!clean(options.primaryManifestPath)) throw new Error("primary_manifest_path_missing");
  if (!clean(options.donorManifestPath)) throw new Error("donor_manifest_path_missing");
  if (!clean(options.outputDir)) throw new Error("output_dir_missing");
  const primaryDir = path.dirname(primaryManifestPath);
  const donorDir = path.dirname(donorManifestPath);
  if (
    pathIsInside(primaryDir, outputDir) ||
    pathIsInside(outputDir, primaryDir) ||
    pathIsInside(donorDir, outputDir) ||
    pathIsInside(outputDir, donorDir)
  ) {
    throw new Error("output_dir_overlaps_source_evidence");
  }
  if (await fs.pathExists(outputDir)) throw new Error("output_dir_already_exists");
  const generatedAt = clean(options.generatedAt) || new Date().toISOString();
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("generated_at_invalid");
  const probeMedia = dependencies.probeMedia || defaultProbeMedia;
  const primaryIds = await selectedIdsOrAll(
    primaryManifestPath,
    options.primaryClipIds,
  )();
  const donorIds = asArray(options.donorClipIds).map(clean).filter(Boolean);
  if (!donorIds.length) throw new Error("donor_clip_ids_missing");

  const primary = await inspectSource({
    manifestPath: primaryManifestPath,
    storyId,
    selectedIds: primaryIds,
    allowNarrationTransition: true,
    probeMedia,
    label: "primary",
  });
  const donor = await inspectSource({
    manifestPath: donorManifestPath,
    storyId,
    selectedIds: donorIds,
    allowNarrationTransition: false,
    probeMedia,
    label: "donor",
  });
  const selected = [...primary.selected, ...donor.selected];
  const ids = selected.map(({ clip }) => clipId(clip));
  const paths = selected.map(({ file }) => normalPath(file.path));
  if (new Set(ids).size !== ids.length) throw new Error("merged_clip_id_duplicate");
  if (new Set(paths).size !== paths.length) throw new Error("merged_clip_path_duplicate");

  const clips = selected.map(({ clip }) => clip);
  const diversity = evaluateGenuineBaseSourceDiversity({
    sources: clips,
    minimumRequired: clips.length,
  });
  if (
    diversity.strict_pass !== true ||
    diversity.observed_genuine_base_source_count !== clips.length
  ) {
    throw new Error(
      `merged_genuine_base_source_diversity_blocked:${diversity.blockers.join(",") || "unknown"}`,
    );
  }
  const professional = assessProfessionalSourceDiversity({
    clips,
    scenes: clips,
    requiredBaseSources: clips.length,
  });
  if (professional.strict_pass !== true) {
    throw new Error(
      `merged_professional_source_diversity_blocked:${professional.blockers.join(",") || "unknown"}`,
    );
  }

  const manifestPath = path.join(outputDir, "materialised_motion_clips.json");
  const rightsLedgerPath = path.join(outputDir, "rights_ledger.json");
  const reportPath = path.join(outputDir, "flagship_motion_evidence_merge_report.json");
  const sourceFamilies = diversity.genuine_base_sources.map(
    (source) => source.base_source_key,
  );
  const manifest = {
    ...clone(primary.manifest),
    schema_version: Math.max(1, Number(primary.manifest.schema_version) || 1),
    generated_at: generatedAt,
    story_id: storyId,
    status: "ready",
    clips,
    materialised_clips: clips,
    materialized_clips: clips,
    selected_materialised_motion_clip_ids: ids,
    clip_count: clips.length,
    distinct_motion_families: clips.map((clip) => clean(clip.motion_family || clip.source_family)),
    distinct_motion_family_count: clips.length,
    distinct_source_families: sourceFamilies,
    distinct_genuine_base_source_count: clips.length,
    genuine_base_source_identity_keys: sourceFamilies,
    genuine_base_source_identities: diversity.genuine_base_sources,
    professional_source_diversity: {
      ...professional,
      verdict: "GREEN",
    },
    minimum_requirements: {
      ...(clone(primary.manifest.minimum_requirements || {})),
      required_genuine_base_source_count: clips.length,
      min_genuine_base_sources: clips.length,
    },
    motion_evidence_merge: {
      policy: "strict_hash_bound_motion_only_merge_v1",
      primary_manifest_path: primary.manifestDocument.evidence.path,
      primary_manifest_sha256: primary.manifestDocument.evidence.sha256,
      primary_rights_path: primary.rightsDocument.evidence.path,
      primary_rights_sha256: primary.rightsDocument.evidence.sha256,
      primary_rights_state: primary.ledgerState,
      donor_manifest_path: donor.manifestDocument.evidence.path,
      donor_manifest_sha256: donor.manifestDocument.evidence.sha256,
      donor_rights_path: donor.rightsDocument.evidence.path,
      donor_rights_sha256: donor.rightsDocument.evidence.sha256,
      donor_rights_state: donor.ledgerState,
      donor_clip_ids: donorIds,
    },
  };
  const records = selected.map(({ record }) => record);
  const usedAssets = selected.map(({ usedAsset }) => usedAsset);
  const transitionMotionRebindingCount = selected.filter(
    ({ transitionRebound }) => transitionRebound,
  ).length;
  const rightsLedger = {
    schema_version: 1,
    generated_at: generatedAt,
    story_id: storyId,
    verdict: "pass",
    status: "ready",
    motion_only_scope: true,
    can_auto_publish: false,
    blockers: [],
    failures: [],
    records,
    used_assets: usedAssets,
    metrics: {
      used_asset_count: usedAssets.length,
      rights_record_count: records.length,
      missing_asset_count: 0,
      duplicate_record_count: 0,
    },
    source_ledger_reconciliation: {
      policy: "selected_motion_records_only_v1",
      primary_narration_debt_preserved:
        primary.ledgerState === "narration_transition_preserved",
      primary_ledger_verdict_unchanged: true,
      donor_ledger_verdict: donor.rightsDocument.value.verdict,
      selected_motion_asset_count: clips.length,
      transition_motion_rebinding_count: transitionMotionRebindingCount,
      exact_file_hash_binding: true,
      exact_rights_evidence_hash_binding: true,
      publish_authorised: false,
    },
  };
  const report = {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF_FLAGSHIP_MOTION_EVIDENCE_MERGE",
    status: "PASS",
    story_id: storyId,
    selected_motion_clip_count: clips.length,
    distinct_genuine_base_source_count: clips.length,
    primary_clip_count: primary.selected.length,
    donor_clip_count: donor.selected.length,
    donor_clip_ids: donorIds,
    manifest_path: manifestPath,
    rights_ledger_path: rightsLedgerPath,
    publish_authorised: false,
    safety: {
      no_publish_triggered: true,
      production_db_mutated: false,
      oauth_or_token_mutated: false,
      source_evidence_mutated: false,
    },
  };

  const stagingDir = `${outputDir}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await atomicWriteJson(path.join(stagingDir, "materialised_motion_clips.json"), manifest);
    await atomicWriteJson(path.join(stagingDir, "rights_ledger.json"), rightsLedger);
    await atomicWriteJson(
      path.join(stagingDir, "flagship_motion_evidence_merge_report.json"),
      report,
    );
    await fs.move(stagingDir, outputDir, { overwrite: false });
  } catch (error) {
    await fs.remove(stagingDir);
    throw error;
  }
  return {
    manifestPath,
    rightsLedgerPath,
    reportPath,
    manifest,
    rightsLedger,
    report,
  };
}

module.exports = {
  mergeFlagshipMotionEvidence,
};
