"use strict";

const crypto = require("node:crypto");
const defaultFileSystem = require("node:fs/promises");
const path = require("node:path");

const {
  STATIC_ARTIFACT_FIELDS,
  canonicalSha256,
  createAutonomousOfficialJitPreparationManifest,
} = require("./autonomous-official-jit-admission-packet");
const {
  assessPublicationEvidence,
  hashRightsLedger,
} = require("./publication-evidence-gates");
const {
  validateGovernedFastNewsLaneDecision,
} = require("./governed-fast-news-lane-decision");

const REQUEST_SCHEMA_VERSION =
  "pulse-autonomous-official-candidate-staging-request-v3";
const RESULT_SCHEMA_VERSION =
  "pulse-autonomous-official-candidate-staging-result-v3";
const RIGHTS_EVIDENCE_SCHEMA_VERSION =
  "pulse-monetisation-aware-candidate-rights-evidence-v1";
const MODE = "LOCAL_PROOF";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const REQUEST_FIELDS = new Set([
  "schema_version",
  "mode",
  "story_id",
  "channel_id",
  "lane_id",
  "platform",
  "scheduled_for",
  "role",
  "candidate_revision_sha256",
  "request_fingerprint",
  "generated_at",
  "workspace_root",
  "candidate_source_root",
  "candidate_workspace_relative_root",
  "allowed_external_source_roots",
  "artifacts",
  "owned_visual_assets",
  "synthetic_media_disclosure",
]);
const REQUEST_FIELDS_WITH_FAST_NEWS = new Set([
  ...REQUEST_FIELDS,
  "fast_news_lane_decision",
]);
const SOURCE_REFERENCE_FIELDS = new Set(["source_path", "sha256"]);
const OWNED_SOURCE_REFERENCE_FIELDS = new Set([
  "asset_id",
  ...SOURCE_REFERENCE_FIELDS,
]);
const DISCLOSURE_FIELDS = new Set([
  "decision_authority",
  "altered_content",
  "policy_basis",
  "youtube_field_value",
  "decision_provenance",
]);
const PROVENANCE_FIELDS = new Set([
  "policy_id",
  "policy_version",
  "evaluated_at",
  "evidence_sha256",
]);
const JSON_ARTIFACT_FIELDS = new Set(
  STATIC_ARTIFACT_FIELDS.filter(
    (field) =>
      !["owned_programme", "narration_audio", "final_mp4"].includes(field),
  ),
);

class AutonomousOfficialCandidateStagingError extends Error {
  constructor(blockers) {
    const values = Array.isArray(blockers) ? blockers : [blockers];
    const unique = [
      ...new Set(
        values.map((value) => String(value || "").trim()).filter(Boolean),
      ),
    ].sort();
    super(unique.join(",") || "candidate_staging_failed");
    this.name = "AutonomousOfficialCandidateStagingError";
    this.code = unique[0] || "candidate_staging_failed";
    this.blockers = unique;
  }
}

function fail(...blockers) {
  throw new AutonomousOfficialCandidateStagingError(blockers.flat());
}

function text(value) {
  return String(value ?? "").trim();
}

function plainObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactFields(value, fields, code) {
  if (!plainObject(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    fail(code);
  }
  return value;
}

function requestFields(value) {
  return plainObject(value) &&
    Object.hasOwn(value, "fast_news_lane_decision")
    ? REQUEST_FIELDS_WITH_FAST_NEWS
    : REQUEST_FIELDS;
}

function exactSha256(value, code) {
  const hash = text(value).toLowerCase();
  if (!SHA256_PATTERN.test(hash)) fail(code);
  return hash;
}

function exactTimestamp(value, code) {
  const raw = text(value);
  const timestamp = Date.parse(raw);
  if (
    !raw ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== raw
  ) {
    fail(code);
  }
  return raw;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((field) => value[field] !== undefined)
        .sort()
        .map((field) => [field, stableValue(value[field])]),
    );
  }
  return value;
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function pathWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function slashPath(value) {
  return String(value).split(path.sep).join("/");
}

function relativeWorkspacePath(value, code) {
  const raw = text(value).replaceAll("\\", "/");
  if (
    !raw ||
    path.posix.isAbsolute(raw) ||
    raw === "." ||
    raw === ".." ||
    raw.startsWith("../") ||
    raw.includes("/../") ||
    raw.endsWith("/..")
  ) {
    fail(code);
  }
  const normalised = path.posix.normalize(raw);
  if (normalised !== raw || normalised.startsWith("staging-proof/")) {
    fail(code);
  }
  return normalised;
}

function normaliseSourceReference(value, code) {
  exactFields(value, SOURCE_REFERENCE_FIELDS, code);
  const sourcePath = text(value.source_path);
  if (!sourcePath || !path.isAbsolute(sourcePath)) fail(code);
  return {
    source_path: path.resolve(sourcePath),
    sha256: exactSha256(value.sha256, code),
  };
}

function normaliseDisclosure(value, generatedAt) {
  exactFields(
    value,
    DISCLOSURE_FIELDS,
    "candidate_staging_disclosure_fields_invalid",
  );
  exactFields(
    value.decision_provenance,
    PROVENANCE_FIELDS,
    "candidate_staging_disclosure_provenance_invalid",
  );
  const policyBasis = text(value.policy_basis).toUpperCase();
  const evaluatedAt = exactTimestamp(
    value.decision_provenance.evaluated_at,
    "candidate_staging_disclosure_time_invalid",
  );
  if (
    value.decision_authority !== "SYSTEM_POLICY" ||
    typeof value.altered_content !== "boolean" ||
    !["DISCLOSE", "NO_DISCLOSURE_REQUIRED"].includes(policyBasis) ||
    typeof value.youtube_field_value !== "boolean" ||
    value.youtube_field_value !== (policyBasis === "DISCLOSE") ||
    !text(value.decision_provenance.policy_id) ||
    !text(value.decision_provenance.policy_version) ||
    Date.parse(evaluatedAt) > Date.parse(generatedAt)
  ) {
    fail("candidate_staging_disclosure_invalid");
  }
  return {
    decision_authority: "SYSTEM_POLICY",
    altered_content: value.altered_content,
    policy_basis: policyBasis,
    youtube_field_value: value.youtube_field_value,
    decision_provenance: {
      policy_id: text(value.decision_provenance.policy_id),
      policy_version: text(value.decision_provenance.policy_version),
      evaluated_at: evaluatedAt,
      evidence_sha256: exactSha256(
        value.decision_provenance.evidence_sha256,
        "candidate_staging_disclosure_provenance_invalid",
      ),
    },
  };
}

function normaliseRequest(value) {
  exactFields(
    value,
    requestFields(value),
    "candidate_staging_request_fields_invalid",
  );
  if (value.schema_version !== REQUEST_SCHEMA_VERSION || value.mode !== MODE) {
    fail("candidate_staging_local_proof_only");
  }
  const storyId = text(value.story_id);
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(storyId)) {
    fail("candidate_staging_story_id_invalid");
  }
  if (
    text(value.channel_id) !== "pulse-gaming" ||
    text(value.lane_id) !== "breaking_short" ||
    text(value.platform).toLowerCase() !== "youtube" ||
    !["PRIMARY", "STANDBY"].includes(text(value.role).toUpperCase())
  ) {
    fail("candidate_staging_scope_invalid");
  }
  const generatedAt = exactTimestamp(
    value.generated_at,
    "candidate_staging_generated_at_invalid",
  );
  const scheduledFor = exactTimestamp(
    value.scheduled_for,
    "candidate_staging_schedule_invalid",
  );
  if (Date.parse(scheduledFor) <= Date.parse(generatedAt)) {
    fail("candidate_staging_schedule_expired");
  }
  const relativeRoot = relativeWorkspacePath(
    value.candidate_workspace_relative_root,
    "candidate_staging_workspace_relative_root_invalid",
  );
  if (relativeRoot !== `output/canary/${storyId}`) {
    fail("candidate_staging_workspace_relative_root_invalid");
  }
  if (
    !Array.isArray(value.allowed_external_source_roots) ||
    value.allowed_external_source_roots.length < 1
  ) {
    fail("candidate_staging_external_source_roots_required");
  }
  const externalRoots = value.allowed_external_source_roots.map((root) => {
    const absolute = text(root);
    if (!absolute || !path.isAbsolute(absolute)) {
      fail("candidate_staging_external_source_root_invalid");
    }
    return path.resolve(absolute);
  });
  if (new Set(externalRoots).size !== externalRoots.length) {
    fail("candidate_staging_external_source_root_duplicate");
  }
  let fastNewsLaneDecision;
  if (Object.hasOwn(value, "fast_news_lane_decision")) {
    try {
      fastNewsLaneDecision =
        validateGovernedFastNewsLaneDecision(
          value.fast_news_lane_decision,
        );
    } catch {
      fail("candidate_staging_fast_news_lane_decision_invalid");
    }
    if (fastNewsLaneDecision.scheduled_for !== scheduledFor) {
      fail("candidate_staging_fast_news_lane_decision_mismatch");
    }
  }
  exactFields(
    value.artifacts,
    new Set(STATIC_ARTIFACT_FIELDS),
    "candidate_staging_artifacts_invalid",
  );
  const artifacts = Object.fromEntries(
    STATIC_ARTIFACT_FIELDS.map((field) => [
      field,
      normaliseSourceReference(
        value.artifacts[field],
        `candidate_staging_${field}_invalid`,
      ),
    ]),
  );
  if (
    !Array.isArray(value.owned_visual_assets) ||
    !value.owned_visual_assets.length
  ) {
    fail("candidate_staging_owned_visual_assets_required");
  }
  const assetIds = new Set();
  const ownedVisualAssets = value.owned_visual_assets.map((asset) => {
    exactFields(
      asset,
      OWNED_SOURCE_REFERENCE_FIELDS,
      "candidate_staging_owned_visual_asset_invalid",
    );
    const assetId = text(asset.asset_id);
    if (!assetId || assetIds.has(assetId)) {
      fail("candidate_staging_owned_visual_asset_id_invalid");
    }
    assetIds.add(assetId);
    return {
      asset_id: assetId,
      ...normaliseSourceReference(
        {
          source_path: asset.source_path,
          sha256: asset.sha256,
        },
        "candidate_staging_owned_visual_asset_invalid",
      ),
    };
  });
  return {
    schema_version: REQUEST_SCHEMA_VERSION,
    mode: MODE,
    story_id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: scheduledFor,
    role: text(value.role).toUpperCase(),
    candidate_revision_sha256: exactSha256(
      value.candidate_revision_sha256,
      "candidate_staging_candidate_revision_invalid",
    ),
    request_fingerprint: exactSha256(
      value.request_fingerprint,
      "candidate_staging_request_fingerprint_invalid",
    ),
    generated_at: generatedAt,
    workspace_root: path.resolve(text(value.workspace_root)),
    candidate_source_root: path.resolve(text(value.candidate_source_root)),
    candidate_workspace_relative_root: relativeRoot,
    allowed_external_source_roots: externalRoots,
    artifacts,
    owned_visual_assets: ownedVisualAssets,
    synthetic_media_disclosure: normaliseDisclosure(
      value.synthetic_media_disclosure,
      generatedAt,
    ),
    ...(fastNewsLaneDecision
      ? { fast_news_lane_decision: fastNewsLaneDecision }
      : {}),
  };
}

async function exactRoot(rootPath, label, fileSystem) {
  if (!path.isAbsolute(rootPath)) fail(`${label}_invalid`);
  let stat;
  try {
    stat = await fileSystem.lstat(rootPath, { bigint: true });
  } catch {
    fail(`${label}_missing`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail(`${label}_invalid`);
  }
  const realPath = await fileSystem.realpath(rootPath);
  if (path.resolve(realPath) !== rootPath) {
    fail(`${label}_link_forbidden`);
  }
  return {
    path: rootPath,
    real_path: realPath,
  };
}

async function assertPathComponents(root, candidate, label, fileSystem) {
  if (!pathWithin(root.path, candidate)) {
    fail(`${label}_outside_allowed_root`);
  }
  const relative = path.relative(root.path, candidate);
  let cursor = root.path;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    let stat;
    try {
      stat = await fileSystem.lstat(cursor, { bigint: true });
    } catch {
      fail(`${label}_missing`);
    }
    if (stat.isSymbolicLink()) fail(`${label}_link_forbidden`);
    const realPath = await fileSystem.realpath(cursor);
    if (!pathWithin(root.real_path, realPath)) {
      fail(`${label}_outside_allowed_root`);
    }
  }
}

function sameIdentity(left, right) {
  return (
    left.isFile() &&
    right.isFile() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs
  );
}

async function readExactFile({ root, reference, label, json, fileSystem }) {
  await assertPathComponents(root, reference.source_path, label, fileSystem);
  const initial = await fileSystem.lstat(reference.source_path, {
    bigint: true,
  });
  if (
    !initial.isFile() ||
    initial.isSymbolicLink() ||
    initial.size <= 0n ||
    initial.size > BigInt(MAX_FILE_BYTES) ||
    initial.size > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    fail(`${label}_file_invalid`);
  }
  const initialRealPath = await fileSystem.realpath(reference.source_path);
  if (!pathWithin(root.real_path, initialRealPath)) {
    fail(`${label}_outside_allowed_root`);
  }
  let handle;
  try {
    handle = await fileSystem.open(reference.source_path, "r");
    const opened = await handle.stat({ bigint: true });
    if (!sameIdentity(initial, opened)) {
      fail(`${label}_changed_during_read`);
    }
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const chunk = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!chunk.bytesRead) break;
      offset += chunk.bytesRead;
    }
    const completed = await handle.stat({ bigint: true });
    const finalPathStat = await fileSystem.lstat(reference.source_path, {
      bigint: true,
    });
    const finalRealPath = await fileSystem.realpath(reference.source_path);
    if (
      offset !== bytes.length ||
      !sameIdentity(opened, completed) ||
      !sameIdentity(opened, finalPathStat) ||
      finalRealPath !== initialRealPath
    ) {
      fail(`${label}_changed_during_read`);
    }
    const observedSha256 = sha256Bytes(bytes);
    if (observedSha256 !== reference.sha256) {
      fail(`${label}_sha256_mismatch`);
    }
    let value = null;
    if (json) {
      try {
        value = JSON.parse(bytes.toString("utf8"));
      } catch {
        fail(`${label}_json_invalid`);
      }
      if (!plainObject(value)) fail(`${label}_json_invalid`);
    }
    return {
      bytes,
      value,
      observed_sha256: observedSha256,
      size_bytes: bytes.length,
      source_path: reference.source_path,
    };
  } finally {
    await handle?.close();
  }
}

function matchingRoot(candidate, roots) {
  const matches = roots.filter((root) => pathWithin(root.path, candidate));
  matches.sort((left, right) => right.path.length - left.path.length);
  return matches[0] || null;
}

function stagedPathForArtifact({
  field,
  observation,
  candidateSourceRoot,
  candidateRelativeRoot,
}) {
  if (pathWithin(candidateSourceRoot.path, observation.source_path)) {
    const relative = path.relative(
      candidateSourceRoot.path,
      observation.source_path,
    );
    return path.posix.join(candidateRelativeRoot, slashPath(relative));
  }
  if (field !== "owned_programme") {
    fail(`candidate_staging_${field}_external_source_forbidden`);
  }
  const extension = path.extname(observation.source_path).toLowerCase();
  return path.posix.join(
    candidateRelativeRoot,
    "_external",
    "owned-programme",
    `${observation.observed_sha256}${extension || ".bin"}`,
  );
}

function exactHash(value) {
  return text(value).toLowerCase();
}

function validateOwnedMotionLineage({
  storyId,
  sourceManifest,
  finalManifest,
  ownedAssets,
  programmeSha256,
}) {
  const blockers = [];
  const assets = Array.isArray(sourceManifest?.assets)
    ? sourceManifest.assets
    : [];
  if (
    sourceManifest?.schema_version !== "pulse-owned-motion-manifest-v1" ||
    text(sourceManifest?.story_id) !== storyId ||
    assets.length !== ownedAssets.length
  ) {
    blockers.push("candidate_staging_owned_motion_manifest_invalid");
  }
  const expected = new Map(
    ownedAssets.map((asset) => [asset.asset_id, asset.observed_sha256]),
  );
  for (const asset of assets) {
    const assetId = text(asset?.asset_id);
    if (
      !expected.has(assetId) ||
      expected.get(assetId) !== exactHash(asset?.sha256) ||
      text(asset?.ownership).toLowerCase() !== "owned" ||
      text(asset?.rights_basis).toUpperCase() !== "OWNED" ||
      asset?.attribution_required !== false ||
      asset?.provenance?.third_party_media_used !== false ||
      asset?.provenance?.third_party_music !== false ||
      Number(asset?.provenance?.source_programme_audio_streams) !== 0
    ) {
      blockers.push("candidate_staging_owned_visual_rights_invalid");
    }
  }
  const combination = sourceManifest?.combination || {};
  if (
    exactHash(combination.source_programme_sha256) !== programmeSha256 ||
    Number(combination.source_programme_audio_streams) !== 0 ||
    combination.third_party_media_used !== false ||
    combination.third_party_music !== false
  ) {
    blockers.push("candidate_staging_owned_programme_lineage_invalid");
  }
  const finalAssets = Array.isArray(finalManifest?.assets)
    ? finalManifest.assets
    : [];
  const allSourcesBound = assets.every((asset) =>
    finalAssets.some(
      (candidate) =>
        text(candidate?.asset_id) === text(asset?.asset_id) &&
        exactHash(candidate?.sha256) === exactHash(asset?.sha256),
    ),
  );
  const programmeBound = finalAssets.some(
    (asset) =>
      exactHash(asset?.sha256) === programmeSha256 &&
      text(asset?.ownership).toLowerCase() === "owned" &&
      text(asset?.rights_basis).toUpperCase() === "OWNED" &&
      asset?.attribution_required === false &&
      asset?.provenance?.third_party_media_used === false,
  );
  if (
    finalManifest?.schema_version !== "pulse-owned-motion-manifest-v1" ||
    text(finalManifest?.story_id) !== storyId ||
    !allSourcesBound ||
    !programmeBound ||
    finalManifest?.combination?.third_party_media_used !== false
  ) {
    blockers.push("candidate_staging_combined_owned_motion_lineage_invalid");
  }
  if (blockers.length) fail(blockers);
}

function validateNarrationCommercialLineage({
  storyId,
  narrationAudioSha256,
  narrationManifest,
  narrationManifestSha256,
  licenceReceipt,
  licenceReceiptStagedPath,
  workspaceRoot,
  ownedProgrammeSha256,
  renderer,
  rendererSha256,
  finalComposite,
  finalMp4Sha256,
  deterministicQa,
}) {
  const blockers = [];
  const scriptSha256 = exactHash(narrationManifest?.script?.sha256);
  const licenceReference = text(narrationManifest?.licence?.evidence_reference);
  const resolvedLicenceReference = path.resolve(
    workspaceRoot,
    licenceReference,
  );
  if (
    narrationManifest?.schema_version !==
      "pulse-governed-narration-manifest-v1" ||
    text(narrationManifest?.story_id) !== storyId ||
    !SHA256_PATTERN.test(scriptSha256) ||
    narrationManifest?.script?.exact_alignment_match !== true ||
    text(narrationManifest?.narration?.provider).toLowerCase() !==
      "elevenlabs" ||
    text(narrationManifest?.licence?.rights_basis).toUpperCase() !==
      "LICENSED" ||
    resolvedLicenceReference !==
      path.resolve(workspaceRoot, licenceReceiptStagedPath) ||
    exactHash(narrationManifest?.sources?.audio?.expected_sha256) !==
      narrationAudioSha256 ||
    exactHash(narrationManifest?.sources?.audio?.pre_apply_sha256) !==
      narrationAudioSha256 ||
    exactHash(narrationManifest?.sources?.audio?.post_apply_sha256) !==
      narrationAudioSha256 ||
    narrationManifest?.sources?.audio?.mutated !== false
  ) {
    blockers.push("candidate_staging_licensed_narration_binding_invalid");
  }
  const exactPendingLineage =
    licenceReceipt?.verdict === "AMBER" &&
    text(licenceReceipt?.final_media_lineage_status).toUpperCase() ===
      "PENDING" &&
    licenceReceipt?.commercial_use_allowed === false &&
    Array.isArray(licenceReceipt?.blockers) &&
    licenceReceipt.blockers.length === 1 &&
    licenceReceipt.blockers[0] === "final_media_lineage_pending";
  if (
    licenceReceipt?.schema !== "pulse_elevenlabs_generation_receipt_v1" ||
    Number(licenceReceipt?.schema_version) !== 1 ||
    text(licenceReceipt?.story_id) !== storyId ||
    text(licenceReceipt?.generation_verdict).toUpperCase() !== "GREEN" ||
    licenceReceipt?.account_entitlement?.paid_at_generation !== true ||
    licenceReceipt?.generation_checks?.every_generation_condition_proven !==
      true ||
    !Array.isArray(licenceReceipt?.generation_blockers) ||
    licenceReceipt.generation_blockers.length !== 0 ||
    !exactPendingLineage ||
    text(licenceReceipt?.licence_basis) !==
      "elevenlabs_commercial_tts_generation" ||
    !Array.isArray(licenceReceipt?.allowed_platforms) ||
    !licenceReceipt.allowed_platforms.includes("youtube_shorts") ||
    exactHash(licenceReceipt?.generation?.request_text_sha256) !==
      scriptSha256 ||
    exactHash(licenceReceipt?.mastering_lineage?.mastered_audio_sha256) !==
      narrationAudioSha256 ||
    text(licenceReceipt?.mastering_lineage?.transform_status).toUpperCase() !==
      "COMPLETE" ||
    text(
      licenceReceipt?.mastering_lineage?.post_generation_transform_status,
    ).toUpperCase() !== "COMPLETE"
  ) {
    blockers.push("candidate_staging_narration_commercial_lineage_unproven");
  }
  const embeddedNarration = Array.isArray(renderer?.inputs)
    ? renderer.inputs.filter(
        (input) =>
          text(input?.role).toLowerCase() === "narration" &&
          input?.embedded_in_final === true,
      )
    : [];
  const embeddedMotion = Array.isArray(renderer?.inputs)
    ? renderer.inputs.filter(
        (input) =>
          text(input?.role).toLowerCase() === "motion" &&
          input?.embedded_in_final === true,
      )
    : [];
  if (
    renderer?.schema_version !== "pulse-render-manifest-v1" ||
    text(renderer?.story_id) !== storyId ||
    text(renderer?.channel_id) !== "pulse-gaming" ||
    embeddedNarration.length !== 1 ||
    exactHash(embeddedNarration[0]?.sha256) !== narrationAudioSha256 ||
    embeddedMotion.length !== 1 ||
    exactHash(embeddedMotion[0]?.sha256) !== ownedProgrammeSha256 ||
    exactHash(renderer?.output?.sha256) !== finalMp4Sha256
  ) {
    blockers.push("candidate_staging_final_renderer_lineage_invalid");
  }
  const audio = finalComposite?.ffmpeg || {};
  if (
    finalComposite?.schema_version !== "pulse-governed-final-composite-v1" ||
    text(finalComposite?.story_id) !== storyId ||
    text(finalComposite?.channel_id) !== "pulse-gaming" ||
    exactHash(finalComposite?.inputs?.hyperframes_intermediate?.sha256) !==
      ownedProgrammeSha256 ||
    exactHash(finalComposite?.inputs?.narration_audio?.sha256) !==
      narrationAudioSha256 ||
    exactHash(finalComposite?.inputs?.governed_narration_manifest?.sha256) !==
      narrationManifestSha256 ||
    exactHash(finalComposite?.renderer_manifest?.file_sha256) !==
      rendererSha256 ||
    exactHash(finalComposite?.output?.sha256) !== finalMp4Sha256 ||
    audio.background_music_used !== false ||
    audio.sound_effects_used !== false ||
    text(audio.mix_mode) !== "GOVERNED_NARRATION_ONLY" ||
    audio.programme_audio_present !== false ||
    audio.programme_audio_mapped !== false
  ) {
    blockers.push("candidate_staging_final_composite_lineage_invalid");
  }
  const qaAudio = deterministicQa?.audio || {};
  if (
    deterministicQa?.schema_version !== "pulse-final-render-qa-v1" ||
    text(deterministicQa?.story_id) !== storyId ||
    text(deterministicQa?.channel_id) !== "pulse-gaming" ||
    text(deterministicQa?.verdict).toUpperCase() !== "PASS" ||
    exactHash(deterministicQa?.media_sha256) !== finalMp4Sha256 ||
    text(deterministicQa?.platform_video_qa?.result).toLowerCase() !== "pass" ||
    !Array.isArray(deterministicQa?.platform_video_qa?.failures) ||
    deterministicQa.platform_video_qa.failures.length !== 0 ||
    exactHash(qaAudio.source_sha256) !== narrationAudioSha256 ||
    text(qaAudio.mix_mode) !== "GOVERNED_NARRATION_ONLY" ||
    qaAudio.background_music_used !== false ||
    qaAudio.sound_effects_used !== false ||
    qaAudio.programme_audio_present !== false ||
    qaAudio.programme_audio_mapped !== false
  ) {
    blockers.push("candidate_staging_final_audio_qa_lineage_invalid");
  }
  if (blockers.length) fail(blockers);
  return {
    script_sha256: scriptSha256,
    resolution: "PAID_GENERATION_GREEN_WITH_FINAL_MASTER_LINEAGE_BOUND",
  };
}

function createRightsEvidence({
  request,
  artifacts,
  ownedAssets,
  stagedArtifacts,
  stagedOwnedAssets,
  narrationResolution,
}) {
  const visualItems = ownedAssets.map((asset, index) => ({
    item_id: asset.asset_id,
    asset_sha256: asset.observed_sha256,
    staged_path: stagedOwnedAssets[index].path,
    rights_basis: "OWNED",
    included_via_owned_programme_sha256:
      artifacts.owned_programme.observed_sha256,
    evidence: {
      reference: stagedArtifacts.owned_motion_manifest.path,
      sha256: artifacts.owned_motion_manifest.observed_sha256,
    },
    commercial_scope: {
      platform_advertising: "CLEARED",
      sponsorship: "NOT_ESTABLISHED",
      affiliate_promotion: "NOT_ESTABLISHED",
      paid_access: "NOT_ESTABLISHED",
      client_production: "NOT_ESTABLISHED",
    },
  }));
  const evidenceBase = stableValue({
    schema_version: RIGHTS_EVIDENCE_SCHEMA_VERSION,
    generated_at: request.generated_at,
    mode: MODE,
    story_id: request.story_id,
    channel_id: request.channel_id,
    platform: "youtube_shorts",
    decision: "CLEARED_FOR_PLATFORM_ADVERTISING_ONLY",
    platform_advertising: "CLEARED",
    sponsorship: "NOT_ESTABLISHED",
    affiliate_promotion: "NOT_ESTABLISHED",
    paid_access: "NOT_ESTABLISHED",
    client_production: "NOT_ESTABLISHED",
    visual_items: visualItems,
    owned_programme: {
      asset_sha256: artifacts.owned_programme.observed_sha256,
      staged_path: stagedArtifacts.owned_programme.path,
      rights_basis: "OWNED",
      evidence: {
        reference: stagedArtifacts.owned_motion_manifest.path,
        sha256: artifacts.owned_motion_manifest.observed_sha256,
      },
    },
    narration: {
      asset_sha256: artifacts.narration_audio.observed_sha256,
      staged_path: stagedArtifacts.narration_audio.path,
      rights_basis: "LICENSED",
      provider: "elevenlabs",
      lineage_resolution: narrationResolution,
      evidence: {
        reference: stagedArtifacts.narration_licence_evidence.path,
        sha256: artifacts.narration_licence_evidence.observed_sha256,
      },
    },
    limitations: [
      "This evidence establishes only YouTube Shorts platform-advertising use.",
      "Sponsorship, affiliate promotion, paid access and client production are not established.",
    ],
  });
  return {
    ...evidenceBase,
    evidence_sha256: canonicalSha256(evidenceBase),
  };
}

function createGateRightsLedger({
  request,
  artifacts,
  ownedAssets,
  stagedArtifacts,
}) {
  const items = ownedAssets.map((asset) => ({
    item_id: `visual:${asset.asset_id}`,
    source_url:
      `pulse-owned://pulse-gaming/${request.story_id}/` +
      encodeURIComponent(asset.asset_id),
    asset_sha256: asset.observed_sha256,
    included_in_final: true,
    rights_decision: "CLEARED",
    rights_basis: "OWNED",
    rights_evidence: {
      reference: stagedArtifacts.owned_motion_manifest.path,
      sha256: artifacts.owned_motion_manifest.observed_sha256,
    },
    attribution_decision: "NOT_REQUIRED",
    attribution_text: null,
  }));
  items.push(
    {
      item_id: "visual:owned-programme",
      source_url:
        `pulse-owned://pulse-gaming/${request.story_id}/` + "owned-programme",
      asset_sha256: artifacts.owned_programme.observed_sha256,
      included_in_final: true,
      rights_decision: "CLEARED",
      rights_basis: "OWNED",
      rights_evidence: {
        reference: stagedArtifacts.owned_motion_manifest.path,
        sha256: artifacts.owned_motion_manifest.observed_sha256,
      },
      attribution_decision: "NOT_REQUIRED",
      attribution_text: null,
    },
    {
      item_id: "audio:elevenlabs-narration",
      source_url: `pulse-licensed://elevenlabs/${request.story_id}/narration`,
      asset_sha256: artifacts.narration_audio.observed_sha256,
      included_in_final: true,
      rights_decision: "CLEARED",
      rights_basis: "LICENSED",
      rights_evidence: {
        reference: stagedArtifacts.narration_licence_evidence.path,
        sha256: artifacts.narration_licence_evidence.observed_sha256,
      },
      attribution_decision: "NOT_REQUIRED",
      attribution_text: null,
    },
  );
  return {
    ledger_version: 1,
    decision: "CLEARED",
    items,
  };
}

async function ensureDestinationParent({
  workspace,
  destinationRoot,
  fileSystem,
}) {
  if (!pathWithin(workspace.path, destinationRoot)) {
    fail("candidate_staging_destination_outside_workspace");
  }
  try {
    await fileSystem.lstat(destinationRoot, { bigint: true });
    fail("candidate_staging_destination_exists");
  } catch (error) {
    if (error instanceof AutonomousOfficialCandidateStagingError) {
      throw error;
    }
    if (error?.code !== "ENOENT") throw error;
  }
  const parent = path.dirname(destinationRoot);
  await fileSystem.mkdir(parent, { recursive: true });
  const relative = path.relative(workspace.path, parent);
  let cursor = workspace.path;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    const stat = await fileSystem.lstat(cursor, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fail("candidate_staging_destination_parent_invalid");
    }
    const realPath = await fileSystem.realpath(cursor);
    if (!pathWithin(workspace.real_path, realPath)) {
      fail("candidate_staging_destination_parent_outside_workspace");
    }
  }
  return parent;
}

async function writeExclusive(fileSystem, filePath, bytes) {
  await fileSystem.mkdir(path.dirname(filePath), {
    recursive: true,
  });
  const handle = await fileSystem.open(filePath, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function markdownSummary(result) {
  return [
    "# Autonomous official candidate staging",
    "",
    `- Verdict: ${result.verdict}`,
    `- Story: ${result.story_id}`,
    `- Mode: ${result.mode}`,
    `- Scheduled for: ${result.scheduled_for}`,
    `- Preparation SHA-256: ${result.preparation_sha256}`,
    `- Rights ledger SHA-256: ${result.rights_ledger_sha256}`,
    `- Platform advertising: ${result.monetisation_scope.platform_advertising}`,
    `- Sponsorship: ${result.monetisation_scope.sponsorship}`,
    `- Affiliate promotion: ${result.monetisation_scope.affiliate_promotion}`,
    "",
    "This LOCAL_PROOF operation copied and rehashed local artefacts only. It did not contact a platform, mutate a database, change OAuth or tokens, or grant publish authority.",
    "",
  ].join("\n");
}

/**
 * Copy one exact, already-rendered official-source candidate into a trusted
 * local workspace and produce the closed preparation manifest consumed by the
 * autonomous JIT admission packet builder.
 *
 * This seam is LOCAL_PROOF-only. It has no database, OAuth, network or platform
 * dependencies and grants no scheduling, admission or publication authority.
 */
async function stageAutonomousOfficialCandidate(value, options = {}) {
  const request = normaliseRequest(value);
  const fileSystem = options.fileSystem || defaultFileSystem;
  const workspace = await exactRoot(
    request.workspace_root,
    "candidate_staging_workspace",
    fileSystem,
  );
  const candidateSourceRoot = await exactRoot(
    request.candidate_source_root,
    "candidate_staging_source_root",
    fileSystem,
  );
  const externalRoots = [];
  for (const rootPath of request.allowed_external_source_roots) {
    externalRoots.push(
      await exactRoot(
        rootPath,
        "candidate_staging_external_source_root",
        fileSystem,
      ),
    );
  }

  const artifacts = {};
  for (const field of STATIC_ARTIFACT_FIELDS) {
    const reference = request.artifacts[field];
    const root = pathWithin(candidateSourceRoot.path, reference.source_path)
      ? candidateSourceRoot
      : matchingRoot(reference.source_path, externalRoots);
    if (!root) {
      fail(`candidate_staging_${field}_outside_allowed_root`);
    }
    if (root !== candidateSourceRoot && field !== "owned_programme") {
      fail(`candidate_staging_${field}_external_source_forbidden`);
    }
    artifacts[field] = await readExactFile({
      root,
      reference,
      label: `candidate_staging_${field}`,
      json: JSON_ARTIFACT_FIELDS.has(field),
      fileSystem,
    });
  }
  const ownedAssets = [];
  for (let index = 0; index < request.owned_visual_assets.length; index += 1) {
    const reference = request.owned_visual_assets[index];
    if (!pathWithin(candidateSourceRoot.path, reference.source_path)) {
      fail("candidate_staging_owned_visual_asset_outside_candidate_source");
    }
    const observation = await readExactFile({
      root: candidateSourceRoot,
      reference,
      label: `candidate_staging_owned_visual_asset_${index}`,
      json: false,
      fileSystem,
    });
    ownedAssets.push({
      asset_id: reference.asset_id,
      ...observation,
    });
  }

  const stagedArtifacts = Object.fromEntries(
    STATIC_ARTIFACT_FIELDS.map((field) => {
      const observation = artifacts[field];
      return [
        field,
        {
          path: stagedPathForArtifact({
            field,
            observation,
            candidateSourceRoot,
            candidateRelativeRoot: request.candidate_workspace_relative_root,
          }),
          sha256: observation.observed_sha256,
        },
      ];
    }),
  );
  const stagedOwnedAssets = ownedAssets.map((asset) => {
    const relative = path.relative(candidateSourceRoot.path, asset.source_path);
    return {
      asset_id: asset.asset_id,
      path: path.posix.join(
        request.candidate_workspace_relative_root,
        slashPath(relative),
      ),
      sha256: asset.observed_sha256,
    };
  });

  validateOwnedMotionLineage({
    storyId: request.story_id,
    sourceManifest: artifacts.owned_motion_source_manifest.value,
    finalManifest: artifacts.owned_motion_manifest.value,
    ownedAssets,
    programmeSha256: artifacts.owned_programme.observed_sha256,
  });
  const narration = validateNarrationCommercialLineage({
    storyId: request.story_id,
    narrationAudioSha256: artifacts.narration_audio.observed_sha256,
    narrationManifest: artifacts.narration_manifest.value,
    narrationManifestSha256: artifacts.narration_manifest.observed_sha256,
    licenceReceipt: artifacts.narration_licence_evidence.value,
    licenceReceiptStagedPath: stagedArtifacts.narration_licence_evidence.path,
    workspaceRoot: workspace.path,
    ownedProgrammeSha256: artifacts.owned_programme.observed_sha256,
    renderer: artifacts.renderer_manifest.value,
    rendererSha256: artifacts.renderer_manifest.observed_sha256,
    finalComposite: artifacts.final_composite_manifest.value,
    finalMp4Sha256: artifacts.final_mp4.observed_sha256,
    deterministicQa: artifacts.deterministic_qa.value,
  });
  if (
    request.synthetic_media_disclosure.decision_provenance.evidence_sha256 !==
    artifacts.final_composite_manifest.observed_sha256
  ) {
    fail("candidate_staging_disclosure_evidence_mismatch");
  }

  const rightsEvidence = createRightsEvidence({
    request,
    artifacts,
    ownedAssets,
    stagedArtifacts,
    stagedOwnedAssets,
    narrationResolution: narration.resolution,
  });
  const rightsLedger = createGateRightsLedger({
    request,
    artifacts,
    ownedAssets,
    stagedArtifacts,
  });
  const rightsLedgerSha256 = hashRightsLedger(rightsLedger);
  const gateInput = {
    originality_transformation: {
      verdict: "STRONG",
      rationale:
        `${ownedAssets.length} hash-bound story-specific visual scenes ` +
        "are declared OWNED, contain no third-party media or music and " +
        "are bound through the owned programme into the final render.",
      evidence_ref: stagedArtifacts.owned_motion_manifest.path,
      evidence_sha256: artifacts.owned_motion_manifest.observed_sha256,
    },
    rights_ledger: rightsLedger,
    rights_ledger_sha256: rightsLedgerSha256,
    synthetic_media_disclosure: request.synthetic_media_disclosure,
  };
  const gateAssessment = assessPublicationEvidence(gateInput);
  if (!gateAssessment.eligible) {
    fail(
      gateAssessment.blockers.map(
        (blocker) => `candidate_staging_publication_gate:${blocker}`,
      ),
    );
  }
  const preparationManifest = createAutonomousOfficialJitPreparationManifest({
    story_id: request.story_id,
    channel_id: request.channel_id,
    lane_id: request.lane_id,
    platform: request.platform,
    scheduled_for: request.scheduled_for,
    role: request.role,
    candidate_revision_sha256: request.candidate_revision_sha256,
    request_fingerprint: request.request_fingerprint,
    artifacts: stagedArtifacts,
    owned_visual_assets: stagedOwnedAssets,
    publication_evidence_gate_input: gateInput,
    ...(request.fast_news_lane_decision
      ? {
          fast_news_lane_decision:
            request.fast_news_lane_decision,
        }
      : {}),
  });

  const candidateDestinationRoot = path.resolve(
    workspace.path,
    request.candidate_workspace_relative_root,
  );
  const destinationParent = await ensureDestinationParent({
    workspace,
    destinationRoot: candidateDestinationRoot,
    fileSystem,
  });
  const stagingRoot = path.join(
    destinationParent,
    `.${request.story_id}.staging-${crypto.randomUUID()}`,
  );
  await fileSystem.mkdir(stagingRoot, { recursive: false });
  try {
    const copyPlan = new Map();
    const addCopy = (relativeToCandidate, observation) => {
      const key = relativeToCandidate.toLowerCase();
      const previous = copyPlan.get(key);
      if (
        previous &&
        (previous.observation.observed_sha256 !== observation.observed_sha256 ||
          previous.observation.source_path !== observation.source_path)
      ) {
        fail("candidate_staging_destination_collision");
      }
      copyPlan.set(key, {
        relative: relativeToCandidate,
        observation,
      });
    };
    for (const field of STATIC_ARTIFACT_FIELDS) {
      const reference = stagedArtifacts[field];
      const relative = path.posix.relative(
        request.candidate_workspace_relative_root,
        reference.path,
      );
      addCopy(relative, artifacts[field]);
    }
    for (let index = 0; index < stagedOwnedAssets.length; index += 1) {
      const reference = stagedOwnedAssets[index];
      const relative = path.posix.relative(
        request.candidate_workspace_relative_root,
        reference.path,
      );
      addCopy(relative, ownedAssets[index]);
    }
    for (const { relative, observation } of copyPlan.values()) {
      if (
        relative === ".." ||
        relative.startsWith("../") ||
        path.posix.isAbsolute(relative)
      ) {
        fail("candidate_staging_destination_path_invalid");
      }
      await writeExclusive(
        fileSystem,
        path.resolve(stagingRoot, relative),
        observation.bytes,
      );
    }

    const proofRelativeRoot = "staging-proof";
    const rightsEvidenceRelative = path.posix.join(
      proofRelativeRoot,
      "monetisation-aware-rights-evidence.json",
    );
    const rightsLedgerRelative = path.posix.join(
      proofRelativeRoot,
      "publication-rights-ledger.json",
    );
    const preparationRelative = path.posix.join(
      proofRelativeRoot,
      "jit-preparation-manifest.json",
    );
    await writeExclusive(
      fileSystem,
      path.resolve(stagingRoot, rightsEvidenceRelative),
      jsonBytes(rightsEvidence),
    );
    await writeExclusive(
      fileSystem,
      path.resolve(stagingRoot, rightsLedgerRelative),
      jsonBytes({
        ...rightsLedger,
        rights_ledger_sha256: rightsLedgerSha256,
      }),
    );
    await writeExclusive(
      fileSystem,
      path.resolve(stagingRoot, preparationRelative),
      jsonBytes(preparationManifest),
    );

    const resultBase = stableValue({
      schema_version: RESULT_SCHEMA_VERSION,
      generated_at: request.generated_at,
      mode: MODE,
      verdict: "GREEN",
      blockers: [],
      story_id: request.story_id,
      channel_id: request.channel_id,
      lane_id: request.lane_id,
      platform: request.platform,
      scheduled_for: request.scheduled_for,
      role: request.role,
      workspace_root: workspace.path,
      candidate_workspace_relative_root:
        request.candidate_workspace_relative_root,
      preparation_sha256: preparationManifest.preparation_sha256,
      rights_ledger_sha256: rightsLedgerSha256,
      monetisation_scope: {
        platform_advertising: "CLEARED",
        sponsorship: "NOT_ESTABLISHED",
        affiliate_promotion: "NOT_ESTABLISHED",
        paid_access: "NOT_ESTABLISHED",
        client_production: "NOT_ESTABLISHED",
      },
      rights_evidence: {
        path: path.posix.join(
          request.candidate_workspace_relative_root,
          rightsEvidenceRelative,
        ),
        sha256: sha256Bytes(jsonBytes(rightsEvidence)),
        canonical_sha256: rightsEvidence.evidence_sha256,
      },
      rights_ledger: {
        path: path.posix.join(
          request.candidate_workspace_relative_root,
          rightsLedgerRelative,
        ),
        sha256: sha256Bytes(
          jsonBytes({
            ...rightsLedger,
            rights_ledger_sha256: rightsLedgerSha256,
          }),
        ),
      },
      preparation_manifest: {
        path: path.posix.join(
          request.candidate_workspace_relative_root,
          preparationRelative,
        ),
        sha256: sha256Bytes(jsonBytes(preparationManifest)),
      },
      copied_artifact_count: STATIC_ARTIFACT_FIELDS.length + ownedAssets.length,
      safety: {
        local_proof_only: true,
        publish_authority: false,
        external_publish_authorised: false,
        database_mutated: false,
        oauth_or_tokens_mutated: false,
        platform_contacted: false,
        network_used: false,
      },
    });
    const proof = {
      ...resultBase,
      result_sha256: canonicalSha256(resultBase),
    };
    const proofRelative = path.posix.join(
      proofRelativeRoot,
      "candidate-staging-result.json",
    );
    const summaryRelative = path.posix.join(
      proofRelativeRoot,
      "candidate-staging-result.md",
    );
    await writeExclusive(
      fileSystem,
      path.resolve(stagingRoot, proofRelative),
      jsonBytes(proof),
    );
    await writeExclusive(
      fileSystem,
      path.resolve(stagingRoot, summaryRelative),
      Buffer.from(markdownSummary(resultBase), "utf8"),
    );

    try {
      await fileSystem.rename(stagingRoot, candidateDestinationRoot);
    } catch (error) {
      if (["EEXIST", "EPERM", "ENOTEMPTY"].includes(error?.code)) {
        fail("candidate_staging_destination_exists");
      }
      throw error;
    }

    return Object.freeze({
      ...resultBase,
      result_sha256: proof.result_sha256,
      preparation_manifest: preparationManifest,
      preparation_manifest_path: path.resolve(
        candidateDestinationRoot,
        preparationRelative,
      ),
      rights_evidence_path: path.resolve(
        candidateDestinationRoot,
        rightsEvidenceRelative,
      ),
      rights_ledger_path: path.resolve(
        candidateDestinationRoot,
        rightsLedgerRelative,
      ),
      result_path: path.resolve(candidateDestinationRoot, proofRelative),
      summary_path: path.resolve(candidateDestinationRoot, summaryRelative),
    });
  } catch (error) {
    await fileSystem
      .rm(stagingRoot, { recursive: true, force: true })
      .catch(() => {});
    throw error;
  }
}

module.exports = {
  AutonomousOfficialCandidateStagingError,
  REQUEST_SCHEMA_VERSION,
  RESULT_SCHEMA_VERSION,
  RIGHTS_EVIDENCE_SCHEMA_VERSION,
  stageAutonomousOfficialCandidate,
};
