"use strict";

const crypto = require("node:crypto");
const defaultFileSystem = require("node:fs/promises");
const path = require("node:path");

const {
  createSafeHttpsFetchCapture,
  extractReadableBody,
} = require("./breaking-source-adapters");
const { canonicalSha256 } = require("./autonomous-green-admission");
const {
  fingerprintRendererManifest,
} = require("../stabilisation/renderer-governance");

const AUTHORITY = "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE";
const APPLY_REQUEST_SCHEMA_VERSION =
  "pulse-autonomous-official-source-evidence-apply-request-v1";
const APPLY_REPORT_SCHEMA_VERSION =
  "pulse-autonomous-official-source-evidence-apply-report-v1";
const MODE = "LOCAL_PROOF";
const SOURCE_SNAPSHOT_SCHEMA = "pulse-official-source-snapshot-v1";
const MAX_JIT_AGE_MS = 2 * 60 * 1000;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REQUEST_FIELDS = new Set([
  "schema_version",
  "mode",
  "story_id",
  "artifacts",
  "owned_visual_assets",
  "report_path",
]);
const FILE_REFERENCE_FIELDS = new Set(["path", "sha256"]);
const OWNED_ASSET_REFERENCE_FIELDS = new Set(["asset_id", "path", "sha256"]);
const KILL_SWITCH_PROOF_FIELDS = new Set([
  "schema_version",
  "story_id",
  "checked_at",
  "valid_until",
  "kill_switch_healthy",
  "emergency_kill_switch_tripped",
  "primary_kill_switch_tripped",
]);
const SINGLE_OWNER_PROOF_FIELDS = new Set([
  "schema_version",
  "story_id",
  "checked_at",
  "valid_until",
  "owner_id",
  "active_scheduler_owner_count",
  "active_publisher_owner_count",
  "scheduler_owner_healthy",
  "publisher_owner_healthy",
  "lease_expires_at",
]);
const ARTIFACT_FIELDS = Object.freeze([
  "story_intake",
  "source_evidence",
  "owned_motion_manifest",
  "owned_motion_source_manifest",
  "owned_programme",
  "narration_audio",
  "narration_manifest",
  "narration_licence_evidence",
  "final_composite_manifest",
  "renderer_manifest",
  "deterministic_qa",
  "multimodal_visual_qa",
  "final_mp4",
  "publication_metadata",
  "kill_switch_proof",
  "single_owner_proof",
]);
const JSON_ARTIFACT_FIELDS = new Set(
  ARTIFACT_FIELDS.filter(
    (field) =>
      !["owned_programme", "narration_audio", "final_mp4"].includes(field),
  ),
);

class AutonomousOfficialSourceEvidenceApplyError extends Error {
  constructor(codes) {
    const exactCodes = [
      ...new Set(
        (Array.isArray(codes) ? codes : [codes])
          .map((code) => String(code || "").trim())
          .filter(Boolean),
      ),
    ].sort();
    super(exactCodes.join(",") || "autonomous_official_apply_failed");
    this.name = "AutonomousOfficialSourceEvidenceApplyError";
    this.code = exactCodes[0] || "autonomous_official_apply_failed";
    this.codes = exactCodes;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function exactSha256(value, code) {
  const candidate = text(value).toLowerCase();
  if (!SHA256_PATTERN.test(candidate)) {
    throw new AutonomousOfficialSourceEvidenceApplyError(code);
  }
  return candidate;
}

function exactTimestamp(value, code) {
  const raw = text(value);
  const parsed = Date.parse(raw);
  if (
    !raw ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== raw
  ) {
    throw new AutonomousOfficialSourceEvidenceApplyError(code);
  }
  return parsed;
}

function trustedNow(clock) {
  if (typeof clock !== "function") {
    throw new AutonomousOfficialSourceEvidenceApplyError(
      "trusted_clock_required",
    );
  }
  let observed;
  try {
    observed = clock();
  } catch {
    throw new AutonomousOfficialSourceEvidenceApplyError(
      "trusted_clock_invalid",
    );
  }
  if (
    !(observed instanceof Date) ||
    !Number.isFinite(Date.prototype.getTime.call(observed))
  ) {
    throw new AutonomousOfficialSourceEvidenceApplyError(
      "trusted_clock_invalid",
    );
  }
  return new Date(observed.getTime());
}

function exactHttpsUrl(value) {
  let parsed;
  try {
    parsed = new URL(text(value));
  } catch {
    throw new AutonomousOfficialSourceEvidenceApplyError(
      "official_source_https_url_required",
    );
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443")
  ) {
    throw new AutonomousOfficialSourceEvidenceApplyError(
      "official_source_https_url_required",
    );
  }
  parsed.hash = "";
  return parsed.toString();
}

function pathComponents(absolutePath) {
  const parsed = path.parse(absolutePath);
  const relative = absolutePath.slice(parsed.root.length);
  const components = relative.split(path.sep).filter(Boolean);
  const paths = [parsed.root];
  let cursor = parsed.root;
  for (const component of components) {
    cursor = path.join(cursor, component);
    paths.push(cursor);
  }
  return paths;
}

function isPathWithinRoot(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

async function assertNoPathLinks(filePath, prefix, fileSystem) {
  for (const componentPath of pathComponents(filePath)) {
    const stat = await fileSystem.lstat(componentPath, { bigint: true });
    if (stat.isSymbolicLink()) {
      throw new AutonomousOfficialSourceEvidenceApplyError(
        `${prefix}_path_link_forbidden`,
      );
    }
  }
}

function assertPathWithinWorkspace(
  candidatePath,
  workspace,
  prefix,
  { real = false } = {},
) {
  const rootPath = real ? workspace.real_path : workspace.resolved_path;
  if (!isPathWithinRoot(rootPath, candidatePath)) {
    throw new AutonomousOfficialSourceEvidenceApplyError(
      `${prefix}_path_outside_workspace_root`,
    );
  }
}

async function prepareWorkspaceRoot(workspaceRoot, fileSystem) {
  const declaredPath = text(workspaceRoot);
  if (!declaredPath) {
    throw new AutonomousOfficialSourceEvidenceApplyError(
      "workspace_root_required",
    );
  }
  const resolvedPath = path.resolve(declaredPath);
  await assertNoPathLinks(resolvedPath, "workspace_root", fileSystem);
  const stat = await fileSystem.lstat(resolvedPath, {
    bigint: true,
  });
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new AutonomousOfficialSourceEvidenceApplyError(
      "workspace_root_directory_required",
    );
  }
  return {
    resolved_path: resolvedPath,
    real_path: await fileSystem.realpath(resolvedPath),
  };
}

async function ensureSafeWorkspaceDirectory(
  directoryPath,
  workspace,
  fileSystem,
) {
  const resolvedPath = path.resolve(directoryPath);
  assertPathWithinWorkspace(resolvedPath, workspace, "report_directory");
  const relative = path.relative(workspace.resolved_path, resolvedPath);
  let cursor = workspace.resolved_path;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    try {
      await fileSystem.mkdir(cursor);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const stat = await fileSystem.lstat(cursor, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new AutonomousOfficialSourceEvidenceApplyError(
        "report_directory_path_link_forbidden",
      );
    }
    const realPath = await fileSystem.realpath(cursor);
    assertPathWithinWorkspace(realPath, workspace, "report_directory", {
      real: true,
    });
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

async function readExactFile({
  reference,
  prefix,
  json,
  fileSystem,
  workspace,
}) {
  const input = object(reference);
  if (
    !input ||
    Object.keys(input).some((field) => !FILE_REFERENCE_FIELDS.has(field)) ||
    Object.keys(input).length !== FILE_REFERENCE_FIELDS.size
  ) {
    throw new AutonomousOfficialSourceEvidenceApplyError(
      `${prefix}_reference_invalid`,
    );
  }
  const expectedSha256 = exactSha256(input.sha256, `${prefix}_sha256_required`);
  const declaredPath = text(input.path);
  if (!declaredPath) {
    throw new AutonomousOfficialSourceEvidenceApplyError(
      `${prefix}_path_required`,
    );
  }
  const resolvedPath = path.resolve(declaredPath);
  assertPathWithinWorkspace(resolvedPath, workspace, prefix);
  await assertNoPathLinks(resolvedPath, prefix, fileSystem);
  const initial = await fileSystem.lstat(resolvedPath, {
    bigint: true,
  });
  if (!initial.isFile() || initial.isSymbolicLink()) {
    throw new AutonomousOfficialSourceEvidenceApplyError(
      `${prefix}_regular_file_required`,
    );
  }
  if (
    initial.size <= 0n ||
    initial.size > BigInt(Number.MAX_SAFE_INTEGER) ||
    (json && initial.size > BigInt(MAX_JSON_BYTES))
  ) {
    throw new AutonomousOfficialSourceEvidenceApplyError(
      `${prefix}_size_invalid`,
    );
  }
  const realPath = await fileSystem.realpath(resolvedPath);
  assertPathWithinWorkspace(realPath, workspace, prefix, {
    real: true,
  });
  let handle;
  try {
    handle = await fileSystem.open(resolvedPath, "r");
    const opened = await handle.stat({ bigint: true });
    if (!sameIdentity(initial, opened)) {
      throw new AutonomousOfficialSourceEvidenceApplyError(
        `${prefix}_changed_during_read`,
      );
    }
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const completed = await handle.stat({ bigint: true });
    const finalPathStat = await fileSystem.lstat(resolvedPath, {
      bigint: true,
    });
    const finalRealPath = await fileSystem.realpath(resolvedPath);
    await assertNoPathLinks(resolvedPath, prefix, fileSystem);
    if (
      offset !== bytes.length ||
      !sameIdentity(opened, completed) ||
      !sameIdentity(opened, finalPathStat) ||
      finalRealPath !== realPath
    ) {
      throw new AutonomousOfficialSourceEvidenceApplyError(
        `${prefix}_changed_during_read`,
      );
    }
    const observedSha256 = sha256Bytes(bytes);
    if (observedSha256 !== expectedSha256) {
      throw new AutonomousOfficialSourceEvidenceApplyError(
        `${prefix}_sha256_mismatch`,
      );
    }
    let value = null;
    if (json) {
      try {
        value = JSON.parse(bytes.toString("utf8"));
      } catch {
        throw new AutonomousOfficialSourceEvidenceApplyError(
          `${prefix}_json_invalid`,
        );
      }
      if (!object(value)) {
        throw new AutonomousOfficialSourceEvidenceApplyError(
          `${prefix}_json_object_required`,
        );
      }
    }
    return {
      declared_path: declaredPath,
      resolved_path: resolvedPath,
      real_path: realPath,
      observed_sha256: observedSha256,
      size_bytes: bytes.length,
      value,
    };
  } finally {
    await handle?.close();
  }
}

function publicObservation(observed) {
  return {
    declared_path: observed.declared_path,
    resolved_path: observed.resolved_path,
    real_path: observed.real_path,
    observed_sha256: observed.observed_sha256,
    size_bytes: observed.size_bytes,
  };
}

function validateRequest(request) {
  const input = object(request);
  const blockers = [];
  if (!input) blockers.push("request_object_required");
  else {
    if (
      Object.keys(input).some((field) => !REQUEST_FIELDS.has(field)) ||
      Object.keys(input).length !== REQUEST_FIELDS.size
    ) {
      blockers.push("request_schema_closed");
    }
    if (input.schema_version !== APPLY_REQUEST_SCHEMA_VERSION) {
      blockers.push("request_schema_version_invalid");
    }
    if (text(input.mode).toUpperCase() !== MODE) {
      blockers.push("local_proof_mode_required");
    }
    if (!text(input.story_id)) blockers.push("story_id_required");
    if (!text(input.report_path)) blockers.push("report_path_required");
    const artifacts = object(input.artifacts);
    if (
      !artifacts ||
      Object.keys(artifacts).length !== ARTIFACT_FIELDS.length ||
      Object.keys(artifacts).some((field) => !ARTIFACT_FIELDS.includes(field))
    ) {
      blockers.push("artifact_schema_closed");
    }
    if (!Array.isArray(input.owned_visual_assets)) {
      blockers.push("owned_visual_assets_array_required");
    }
  }
  if (blockers.length) {
    throw new AutonomousOfficialSourceEvidenceApplyError(blockers);
  }
  return input;
}

async function readInputs(request, fileSystem, workspace) {
  const artifacts = {};
  for (const field of ARTIFACT_FIELDS) {
    artifacts[field] = await readExactFile({
      reference: request.artifacts[field],
      prefix: field,
      json: JSON_ARTIFACT_FIELDS.has(field),
      fileSystem,
      workspace,
    });
  }
  const ownedVisualAssets = [];
  const seenIds = new Set();
  for (let index = 0; index < request.owned_visual_assets.length; index += 1) {
    const item = object(request.owned_visual_assets[index]);
    const prefix = `owned_visual_asset_${index}`;
    if (
      !item ||
      Object.keys(item).length !== OWNED_ASSET_REFERENCE_FIELDS.size ||
      Object.keys(item).some(
        (field) => !OWNED_ASSET_REFERENCE_FIELDS.has(field),
      )
    ) {
      throw new AutonomousOfficialSourceEvidenceApplyError(
        `${prefix}_reference_invalid`,
      );
    }
    const assetId = text(item.asset_id);
    if (!assetId || seenIds.has(assetId)) {
      throw new AutonomousOfficialSourceEvidenceApplyError(
        "owned_visual_asset_id_invalid",
      );
    }
    seenIds.add(assetId);
    const observed = await readExactFile({
      reference: { path: item.path, sha256: item.sha256 },
      prefix,
      json: false,
      fileSystem,
      workspace,
    });
    ownedVisualAssets.push({
      asset_id: assetId,
      ...observed,
    });
  }
  return { artifacts, ownedVisualAssets };
}

function validateStoryAndFreshness({ request, intake, sourceEvidence, nowMs }) {
  const blockers = [];
  const story = object(intake?.story);
  const freshness = object(intake?.freshness);
  if (
    intake?.schema_version !== "pulse-governed-story-intake-v1" ||
    text(intake?.source_type).toLowerCase() !== "official" ||
    text(story?.id) !== request.story_id ||
    text(story?.channel_id) !== "pulse-gaming" ||
    text(sourceEvidence?.story_id) !== request.story_id ||
    sourceEvidence?.schema_version !== "pulse-source-evidence-v1" ||
    text(sourceEvidence?.source_type).toLowerCase() !== "official"
  ) {
    blockers.push("official_story_binding_required");
  }
  if (
    story?.visual_brief?.source_media_policy !== "OWNED_ONLY" ||
    story?.visual_brief?.format !== "owned-motion-only"
  ) {
    blockers.push("owned_only_visual_policy_required");
  }
  const script = String(story?.full_script ?? "");
  const scriptSha256 = sha256Bytes(Buffer.from(script, "utf8"));
  if (
    !script.trim() ||
    scriptSha256 !== text(story?.script_sha256).toLowerCase()
  ) {
    blockers.push("exact_script_hash_required");
  }
  let publishBy = null;
  let staleAfter = null;
  try {
    const discoveredAt = exactTimestamp(
      freshness?.discovered_at,
      "freshness_discovered_at_invalid",
    );
    const sourceLastCheckedAt = exactTimestamp(
      freshness?.source_last_checked_at,
      "freshness_source_last_checked_at_invalid",
    );
    publishBy = exactTimestamp(
      freshness?.publish_by,
      "freshness_publish_by_invalid",
    );
    staleAfter = exactTimestamp(
      freshness?.stale_after,
      "freshness_stale_after_invalid",
    );
    if (
      freshness?.reverification_required !== true ||
      discoveredAt > sourceLastCheckedAt ||
      sourceLastCheckedAt > nowMs ||
      nowMs >= publishBy ||
      nowMs >= staleAfter
    ) {
      blockers.push("fresh_official_story_required");
    }
  } catch (error) {
    blockers.push(...(error.codes || [error.message]));
  }
  if (blockers.length) {
    throw new AutonomousOfficialSourceEvidenceApplyError(blockers);
  }
  return {
    script,
    scriptSha256,
    publishBy,
    staleAfter,
  };
}

function exactSourceSnapshot(snapshot, role) {
  const snapshotFields = new Set([
    "schema_version",
    "source_url",
    "source_id",
    "source_class",
    "canonical_body_algorithm",
    "canonical_body_sha256",
    "claims",
  ]);
  if (
    !object(snapshot) ||
    Object.keys(snapshot).length !== snapshotFields.size ||
    Object.keys(snapshot).some((field) => !snapshotFields.has(field)) ||
    snapshot.schema_version !== SOURCE_SNAPSHOT_SCHEMA ||
    text(snapshot.source_class).toUpperCase() !== "OFFICIAL_FIRST_PARTY" ||
    text(snapshot.canonical_body_algorithm) !== "pulse-readable-body-v1"
  ) {
    throw new AutonomousOfficialSourceEvidenceApplyError(
      "official_source_snapshot_invalid",
    );
  }
  const sourceId = text(snapshot.source_id);
  if (!sourceId) {
    throw new AutonomousOfficialSourceEvidenceApplyError(
      "official_source_id_required",
    );
  }
  const claims = Array.isArray(snapshot.claims) ? snapshot.claims : [];
  if (!claims.length) {
    throw new AutonomousOfficialSourceEvidenceApplyError(
      "official_source_claims_required",
    );
  }
  const seenClaimKeys = new Set();
  const exactClaims = claims.map((claim) => {
    const claimFields = new Set(["claim_key", "text", "claim_text_sha256"]);
    const claimKey = text(claim?.claim_key);
    const claimText = String(claim?.text ?? "");
    const claimSha256 = exactSha256(
      claim?.claim_text_sha256,
      "official_source_claim_sha256_required",
    );
    if (
      !claimKey ||
      !claimText.trim() ||
      !object(claim) ||
      Object.keys(claim).length !== claimFields.size ||
      Object.keys(claim).some((field) => !claimFields.has(field)) ||
      seenClaimKeys.has(claimKey) ||
      sha256Bytes(Buffer.from(claimText, "utf8")) !== claimSha256
    ) {
      throw new AutonomousOfficialSourceEvidenceApplyError(
        "official_source_claim_invalid",
      );
    }
    seenClaimKeys.add(claimKey);
    return {
      claim_key: claimKey,
      text: claimText,
      claim_text_sha256: claimSha256,
    };
  });
  return {
    role,
    source_id: sourceId,
    source_url: exactHttpsUrl(snapshot.source_url),
    source_class: "OFFICIAL_FIRST_PARTY",
    canonical_body_algorithm: "pulse-readable-body-v1",
    canonical_body_sha256: exactSha256(
      snapshot.canonical_body_sha256,
      "official_source_body_sha256_required",
    ),
    claims: exactClaims,
    snapshot_sha256: canonicalSha256(snapshot),
  };
}

async function revalidateAllOfficialSources({
  sourceEvidence,
  fetchCapture,
  nowIso,
}) {
  if (typeof fetchCapture !== "function") {
    throw new AutonomousOfficialSourceEvidenceApplyError(
      "official_source_fetch_capture_required",
    );
  }
  const snapshots = [
    exactSourceSnapshot(sourceEvidence.official_source_snapshot, "PRIMARY"),
    ...(Array.isArray(sourceEvidence.supporting_official_source_snapshots)
      ? sourceEvidence.supporting_official_source_snapshots.map((snapshot) =>
          exactSourceSnapshot(snapshot, "SUPPORTING"),
        )
      : []),
  ];
  const identities = snapshots.map(
    (snapshot) => `${snapshot.source_id}\0${snapshot.source_url}`,
  );
  if (new Set(identities).size !== identities.length) {
    throw new AutonomousOfficialSourceEvidenceApplyError(
      "official_source_snapshot_duplicate",
    );
  }
  const sources = [];
  for (const snapshot of snapshots) {
    let response;
    try {
      response = await fetchCapture({
        url: snapshot.source_url,
        redirect: "manual",
        max_bytes: MAX_SOURCE_BYTES,
      });
    } catch (error) {
      const wrapped = new AutonomousOfficialSourceEvidenceApplyError(
        "official_source_revalidation_fetch_failed",
      );
      wrapped.cause = error;
      throw wrapped;
    }
    const bytes = Buffer.isBuffer(response?.bytes)
      ? Buffer.from(response.bytes)
      : Buffer.from(response?.bytes || []);
    if (
      Number(response?.status) < 200 ||
      Number(response?.status) >= 300 ||
      !bytes.length ||
      bytes.length > MAX_SOURCE_BYTES
    ) {
      throw new AutonomousOfficialSourceEvidenceApplyError(
        "official_source_revalidation_response_invalid",
      );
    }
    if (exactHttpsUrl(response?.final_url) !== snapshot.source_url) {
      throw new AutonomousOfficialSourceEvidenceApplyError(
        "official_source_revalidation_url_mismatch",
      );
    }
    const canonicalBody = extractReadableBody(
      bytes,
      text(response?.content_type),
    );
    const observedBodySha256 = sha256Bytes(Buffer.from(canonicalBody, "utf8"));
    if (observedBodySha256 !== snapshot.canonical_body_sha256) {
      throw new AutonomousOfficialSourceEvidenceApplyError(
        `official_source_changed:${snapshot.source_id}`,
      );
    }
    if (snapshot.claims.some((claim) => !canonicalBody.includes(claim.text))) {
      throw new AutonomousOfficialSourceEvidenceApplyError(
        `official_source_claim_missing:${snapshot.source_id}`,
      );
    }
    sources.push({
      role: snapshot.role,
      source_id: snapshot.source_id,
      source_url: snapshot.source_url,
      snapshot_sha256: snapshot.snapshot_sha256,
      canonical_body_sha256: observedBodySha256,
      matched_claim_text_sha256: snapshot.claims.map(
        (claim) => claim.claim_text_sha256,
      ),
      bytes_sha256: sha256Bytes(bytes),
      fetch_status: Number(response.status),
      revalidated_at: nowIso,
      unchanged: true,
      claims_match: true,
    });
  }
  return {
    policy: "PRIMARY_AND_ALL_SUPPORTING_OFFICIAL_SNAPSHOTS",
    snapshot_count: sources.length,
    primary_count: sources.filter((source) => source.role === "PRIMARY").length,
    supporting_count: sources.filter((source) => source.role === "SUPPORTING")
      .length,
    sources,
  };
}

function validateOwnedVisuals({
  request,
  motionManifest,
  ownedVisualAssets,
  ownedProgramme,
  renderer,
  finalMotionManifest = null,
  sourceMotionManifestObservation = null,
  finalMotionManifestObservation = null,
}) {
  const blockers = [];
  const assets = Array.isArray(motionManifest?.assets)
    ? motionManifest.assets
    : [];
  if (
    motionManifest?.schema_version !== "pulse-owned-motion-manifest-v1" ||
    text(motionManifest?.story_id) !== request.story_id ||
    !assets.length ||
    assets.length !== ownedVisualAssets.length
  ) {
    blockers.push("owned_motion_manifest_invalid");
  }
  const requestedById = new Map(
    ownedVisualAssets.map((asset) => [asset.asset_id, asset]),
  );
  for (const asset of assets) {
    const observed = requestedById.get(text(asset?.asset_id));
    if (
      !observed ||
      observed.observed_sha256 !== text(asset?.sha256).toLowerCase() ||
      text(asset?.ownership).toLowerCase() !== "owned" ||
      !["OWNED", "OWNED_CAPTURE"].includes(
        text(asset?.rights_basis).toUpperCase(),
      ) ||
      asset?.attribution_required !== false ||
      asset?.provenance?.third_party_media_used !== false ||
      asset?.provenance?.third_party_music !== false ||
      Number(asset?.provenance?.source_programme_audio_streams) !== 0
    ) {
      blockers.push("owned_only_visual_asset_required");
    }
  }
  const combination = object(motionManifest?.combination);
  if (
    text(combination?.source_programme_sha256).toLowerCase() !==
      ownedProgramme.observed_sha256 ||
    Number(combination?.source_programme_audio_streams) !== 0 ||
    combination?.third_party_media_used !== false ||
    combination?.third_party_music !== false
  ) {
    blockers.push("owned_video_only_programme_required");
  }
  if (
    finalMotionManifest &&
    finalMotionManifestObservation?.observed_sha256 !==
      sourceMotionManifestObservation?.observed_sha256
  ) {
    const finalAssets = Array.isArray(finalMotionManifest.assets)
      ? finalMotionManifest.assets
      : [];
    const sourceBinding = finalMotionManifest?.combination?.source_manifest;
    const sourceAssetsBound = assets.every((asset) =>
      finalAssets.some(
        (candidate) =>
          text(candidate?.asset_id) === text(asset?.asset_id) &&
          text(candidate?.sha256).toLowerCase() ===
            text(asset?.sha256).toLowerCase(),
      ),
    );
    const programmeBound = finalAssets.some(
      (asset) =>
        text(asset?.sha256).toLowerCase() === ownedProgramme.observed_sha256 &&
        text(asset?.ownership).toLowerCase() === "owned" &&
        text(asset?.rights_basis).toUpperCase() === "OWNED" &&
        asset?.attribution_required === false &&
        asset?.provenance?.third_party_media_used === false,
    );
    if (
      finalMotionManifest?.schema_version !==
        "pulse-owned-motion-manifest-v1" ||
      text(finalMotionManifest?.story_id) !== request.story_id ||
      text(sourceBinding?.sha256).toLowerCase() !==
        sourceMotionManifestObservation.observed_sha256 ||
      finalMotionManifest?.combination?.third_party_media_used !== false ||
      !sourceAssetsBound ||
      !programmeBound
    ) {
      blockers.push("combined_owned_motion_lineage_required");
    }
  }
  const embeddedMotion = Array.isArray(renderer?.inputs)
    ? renderer.inputs.filter(
        (input) =>
          text(input?.role).toLowerCase() === "motion" &&
          input?.embedded_in_final === true,
      )
    : [];
  if (
    embeddedMotion.length !== 1 ||
    text(embeddedMotion[0]?.sha256).toLowerCase() !==
      ownedProgramme.observed_sha256
  ) {
    blockers.push("renderer_owned_programme_binding_required");
  }
  if (blockers.length) {
    throw new AutonomousOfficialSourceEvidenceApplyError(blockers);
  }
}

function validateNarration({
  request,
  scriptSha256,
  narrationManifest,
  licenceEvidenceObservation,
  narrationAudio,
  renderer,
  finalComposite,
  deterministicQa,
}) {
  const blockers = [];
  const licenceEvidence = licenceEvidenceObservation.value;
  const declaredLicenceEvidenceSha256 = text(
    narrationManifest?.licence?.evidence_sha256,
  ).toLowerCase();
  if (
    narrationManifest?.schema_version !==
      "pulse-governed-narration-manifest-v1" ||
    text(narrationManifest?.story_id) !== request.story_id ||
    text(narrationManifest?.script?.sha256).toLowerCase() !== scriptSha256 ||
    narrationManifest?.script?.exact_alignment_match !== true ||
    text(narrationManifest?.narration?.provider).toLowerCase() !==
      "elevenlabs" ||
    text(narrationManifest?.licence?.rights_basis).toUpperCase() !==
      "LICENSED" ||
    (declaredLicenceEvidenceSha256 &&
      declaredLicenceEvidenceSha256 !==
        licenceEvidenceObservation.observed_sha256) ||
    path.resolve(text(narrationManifest?.licence?.evidence_reference)) !==
      licenceEvidenceObservation.resolved_path ||
    text(narrationManifest?.sources?.audio?.expected_sha256).toLowerCase() !==
      narrationAudio.observed_sha256 ||
    text(narrationManifest?.sources?.audio?.pre_apply_sha256).toLowerCase() !==
      narrationAudio.observed_sha256 ||
    text(narrationManifest?.sources?.audio?.post_apply_sha256).toLowerCase() !==
      narrationAudio.observed_sha256 ||
    narrationManifest?.sources?.audio?.mutated !== false
  ) {
    blockers.push("licensed_hash_bound_narration_required");
  }
  const permittedPendingLineage =
    Array.isArray(licenceEvidence?.blockers) &&
    licenceEvidence.blockers.length === 1 &&
    licenceEvidence.blockers[0] === "final_media_lineage_pending";
  if (
    licenceEvidence?.schema !== "pulse_elevenlabs_generation_receipt_v1" ||
    Number(licenceEvidence?.schema_version) !== 1 ||
    text(licenceEvidence?.story_id) !== request.story_id ||
    text(licenceEvidence?.generation_verdict).toUpperCase() !== "GREEN" ||
    licenceEvidence?.account_entitlement?.paid_at_generation !== true ||
    licenceEvidence?.generation_checks?.every_generation_condition_proven !==
      true ||
    !Array.isArray(licenceEvidence?.generation_blockers) ||
    licenceEvidence.generation_blockers.length !== 0 ||
    !permittedPendingLineage ||
    text(licenceEvidence?.licence_basis) !==
      "elevenlabs_commercial_tts_generation" ||
    !Array.isArray(licenceEvidence?.allowed_platforms) ||
    !licenceEvidence.allowed_platforms.includes("youtube_shorts") ||
    text(licenceEvidence?.generation?.request_text_sha256).toLowerCase() !==
      scriptSha256 ||
    text(
      licenceEvidence?.mastering_lineage?.mastered_audio_sha256,
    ).toLowerCase() !== narrationAudio.observed_sha256 ||
    text(licenceEvidence?.mastering_lineage?.transform_status).toUpperCase() !==
      "COMPLETE" ||
    text(
      licenceEvidence?.mastering_lineage?.post_generation_transform_status,
    ).toUpperCase() !== "COMPLETE"
  ) {
    blockers.push("narration_licence_evidence_invalid");
  }
  const embeddedNarration = Array.isArray(renderer?.inputs)
    ? renderer.inputs.filter(
        (input) =>
          text(input?.role).toLowerCase() === "narration" &&
          input?.embedded_in_final === true,
      )
    : [];
  if (
    embeddedNarration.length !== 1 ||
    text(embeddedNarration[0]?.sha256).toLowerCase() !==
      narrationAudio.observed_sha256
  ) {
    blockers.push("renderer_narration_binding_required");
  }
  const finalAudio = finalComposite?.ffmpeg;
  const qaAudio = deterministicQa?.audio;
  if (
    finalAudio?.background_music_used !== false ||
    finalAudio?.sound_effects_used !== false ||
    text(finalAudio?.mix_mode) !== "GOVERNED_NARRATION_ONLY" ||
    finalAudio?.programme_audio_present !== false ||
    finalAudio?.programme_audio_mapped !== false ||
    qaAudio?.background_music_used !== false ||
    qaAudio?.sound_effects_used !== false ||
    text(qaAudio?.mix_mode) !== "GOVERNED_NARRATION_ONLY" ||
    qaAudio?.programme_audio_present !== false ||
    qaAudio?.programme_audio_mapped !== false ||
    text(qaAudio?.source_sha256).toLowerCase() !==
      narrationAudio.observed_sha256
  ) {
    blockers.push("narration_only_audio_required");
  }
  const forbiddenAudioInputs = Array.isArray(renderer?.inputs)
    ? renderer.inputs.filter(
        (input) =>
          input?.embedded_in_final === true &&
          !["motion", "narration"].includes(text(input?.role).toLowerCase()),
      )
    : [];
  if (forbiddenAudioInputs.length) {
    blockers.push("embedded_music_or_sfx_forbidden");
  }
  if (blockers.length) {
    throw new AutonomousOfficialSourceEvidenceApplyError(blockers);
  }
}

function validateLineageAndQa({ request, observations, scriptSha256 }) {
  const artifacts = observations.artifacts;
  const intake = artifacts.story_intake.value;
  const sourceEvidence = artifacts.source_evidence.value;
  const finalMotionManifest = artifacts.owned_motion_manifest.value;
  const motionManifest = artifacts.owned_motion_source_manifest.value;
  const narrationManifest = artifacts.narration_manifest.value;
  const finalComposite = artifacts.final_composite_manifest.value;
  const renderer = artifacts.renderer_manifest.value;
  const deterministicQa = artifacts.deterministic_qa.value;
  const visualQa = artifacts.multimodal_visual_qa.value;
  const metadata = artifacts.publication_metadata.value;
  const finalMp4 = artifacts.final_mp4;
  const rendererCanonicalSha256 = fingerprintRendererManifest(renderer);
  const blockers = [];

  if (
    text(intake?.source_evidence_sha256).toLowerCase() !==
      artifacts.source_evidence.observed_sha256 ||
    text(finalComposite?.inputs?.story_intake?.sha256).toLowerCase() !==
      artifacts.story_intake.observed_sha256 ||
    text(
      finalComposite?.inputs?.owned_motion_manifest?.sha256,
    ).toLowerCase() !== artifacts.owned_motion_manifest.observed_sha256 ||
    text(
      finalComposite?.inputs?.governed_narration_manifest?.sha256,
    ).toLowerCase() !== artifacts.narration_manifest.observed_sha256 ||
    text(finalComposite?.inputs?.narration_audio?.sha256).toLowerCase() !==
      artifacts.narration_audio.observed_sha256 ||
    text(
      finalComposite?.inputs?.hyperframes_intermediate?.sha256,
    ).toLowerCase() !== artifacts.owned_programme.observed_sha256
  ) {
    blockers.push("final_composite_input_lineage_mismatch");
  }
  if (
    finalComposite?.schema_version !== "pulse-governed-final-composite-v1" ||
    text(finalComposite?.story_id) !== request.story_id ||
    text(finalComposite?.channel_id) !== "pulse-gaming" ||
    text(finalComposite?.script_sha256).toLowerCase() !== scriptSha256 ||
    text(finalComposite?.renderer_manifest?.file_sha256).toLowerCase() !==
      artifacts.renderer_manifest.observed_sha256 ||
    text(finalComposite?.renderer_manifest?.canonical_sha256).toLowerCase() !==
      rendererCanonicalSha256 ||
    text(finalComposite?.qa_report?.sha256).toLowerCase() !==
      artifacts.deterministic_qa.observed_sha256 ||
    text(finalComposite?.output?.sha256).toLowerCase() !==
      finalMp4.observed_sha256
  ) {
    blockers.push("final_composite_exact_binding_required");
  }
  if (
    renderer?.schema_version !== "pulse-render-manifest-v1" ||
    text(renderer?.story_id) !== request.story_id ||
    text(renderer?.channel_id) !== "pulse-gaming" ||
    text(renderer?.output?.sha256).toLowerCase() !== finalMp4.observed_sha256
  ) {
    blockers.push("renderer_exact_binding_required");
  }
  if (
    deterministicQa?.schema_version !== "pulse-final-render-qa-v1" ||
    text(deterministicQa?.story_id) !== request.story_id ||
    text(deterministicQa?.channel_id) !== "pulse-gaming" ||
    text(deterministicQa?.verdict).toUpperCase() !== "PASS" ||
    text(deterministicQa?.media_sha256).toLowerCase() !==
      finalMp4.observed_sha256 ||
    text(deterministicQa?.script_sha256).toLowerCase() !== scriptSha256 ||
    text(deterministicQa?.renderer_manifest_sha256).toLowerCase() !==
      rendererCanonicalSha256 ||
    text(deterministicQa?.platform_video_qa?.result).toLowerCase() !== "pass" ||
    !Array.isArray(deterministicQa?.platform_video_qa?.failures) ||
    deterministicQa.platform_video_qa.failures.length !== 0
  ) {
    blockers.push("deterministic_qa_unanimous_pass_required");
  }
  const aggregation = object(visualQa?.model_aggregation);
  const modelReviews = Array.isArray(visualQa?.model_reviews)
    ? visualQa.model_reviews
    : [];
  const frames = Array.isArray(visualQa?.frames) ? visualQa.frames : [];
  if (
    visualQa?.schema_version !== "pulse-local-multimodal-visual-review-v1" ||
    text(visualQa?.story_id) !== request.story_id ||
    text(visualQa?.verdict).toUpperCase() !== "PASS" ||
    !Array.isArray(visualQa?.blockers) ||
    visualQa.blockers.length !== 0 ||
    text(visualQa?.bindings?.final_mp4?.sha256).toLowerCase() !==
      finalMp4.observed_sha256 ||
    visualQa?.authority?.human_review !== false ||
    visualQa?.authority?.approval_authority !== false ||
    visualQa?.authority?.publication_authorised !== false ||
    visualQa?.authority?.may_replace_human_approval !== false ||
    !frames.length ||
    frames.some(
      (frame) =>
        !Array.isArray(frame?.deterministic_blockers) ||
        frame.deterministic_blockers.length !== 0,
    ) ||
    text(aggregation?.strategy) !== "UNANIMOUS_PASS" ||
    aggregation?.all_reviews_must_pass !== true ||
    !Number.isInteger(aggregation?.review_count) ||
    aggregation.review_count < 1 ||
    aggregation?.pass_count !== aggregation.review_count ||
    !Array.isArray(aggregation?.requested_models) ||
    aggregation.requested_models.length !== aggregation.review_count ||
    modelReviews.length !== aggregation.review_count ||
    modelReviews.some(
      (review) =>
        text(review?.verdict).toUpperCase() !== "PASS" ||
        !Array.isArray(review?.blockers) ||
        review.blockers.length !== 0 ||
        review?.capability_evidence?.completion !== true ||
        review?.capability_evidence?.vision !== true,
    )
  ) {
    blockers.push("multimodal_unanimous_pass_required");
  }
  if (
    metadata?.schema_version !== "pulse-governed-publication-metadata-v1" ||
    text(metadata?.story_id) !== request.story_id ||
    text(metadata?.channel_id) !== "pulse-gaming" ||
    text(metadata?.platform) !== "youtube_shorts" ||
    !text(metadata?.title) ||
    !text(metadata?.description) ||
    text(metadata?.editorial_review?.method) !== AUTHORITY ||
    Object.keys(metadata?.editorial_review || {}).length !== 4 ||
    Object.keys(metadata?.editorial_review || {}).some(
      (field) =>
        ![
          "method",
          "title_approved",
          "description_approved",
          "attribution_approved",
        ].includes(field),
    ) ||
    metadata?.editorial_review?.title_approved !== true ||
    metadata?.editorial_review?.description_approved !== true ||
    metadata?.editorial_review?.attribution_approved !== true ||
    Object.hasOwn(metadata, "human_approval") ||
    Object.hasOwn(metadata?.editorial_review || {}, "human_actor")
  ) {
    blockers.push("autonomous_metadata_binding_required");
  }
  if (blockers.length) {
    throw new AutonomousOfficialSourceEvidenceApplyError(blockers);
  }

  validateOwnedVisuals({
    request,
    motionManifest,
    ownedVisualAssets: observations.ownedVisualAssets,
    ownedProgramme: artifacts.owned_programme,
    renderer,
    finalMotionManifest,
    sourceMotionManifestObservation: artifacts.owned_motion_source_manifest,
    finalMotionManifestObservation: artifacts.owned_motion_manifest,
  });
  validateNarration({
    request,
    scriptSha256,
    narrationManifest,
    licenceEvidenceObservation: artifacts.narration_licence_evidence,
    narrationAudio: artifacts.narration_audio,
    renderer,
    finalComposite,
    deterministicQa,
  });
  return {
    rendererCanonicalSha256,
    sourceEvidence,
  };
}

function validateControlProof({ request, killSwitch, singleOwner, nowMs }) {
  const blockers = [];
  let killValidUntil = null;
  let ownerValidUntil = null;
  try {
    if (
      !object(killSwitch) ||
      Object.keys(killSwitch).length !== KILL_SWITCH_PROOF_FIELDS.size ||
      Object.keys(killSwitch).some(
        (field) => !KILL_SWITCH_PROOF_FIELDS.has(field),
      )
    ) {
      blockers.push("kill_switch_proof_schema_closed");
    }
    const killCheckedAt = exactTimestamp(
      killSwitch?.checked_at,
      "kill_switch_checked_at_invalid",
    );
    killValidUntil = exactTimestamp(
      killSwitch?.valid_until,
      "kill_switch_valid_until_invalid",
    );
    if (
      killSwitch?.schema_version !== "pulse-kill-switch-health-proof-v1" ||
      text(killSwitch?.story_id) !== request.story_id ||
      killSwitch?.kill_switch_healthy !== true ||
      killSwitch?.emergency_kill_switch_tripped !== false ||
      killSwitch?.primary_kill_switch_tripped !== false ||
      killCheckedAt > nowMs ||
      nowMs - killCheckedAt > MAX_JIT_AGE_MS ||
      nowMs >= killValidUntil
    ) {
      blockers.push("fresh_healthy_kill_switch_proof_required");
    }
    const ownerCheckedAt = exactTimestamp(
      singleOwner?.checked_at,
      "single_owner_checked_at_invalid",
    );
    ownerValidUntil = exactTimestamp(
      singleOwner?.valid_until,
      "single_owner_valid_until_invalid",
    );
    const leaseExpiresAt = exactTimestamp(
      singleOwner?.lease_expires_at,
      "single_owner_lease_expiry_invalid",
    );
    if (
      !object(singleOwner) ||
      Object.keys(singleOwner).length !== SINGLE_OWNER_PROOF_FIELDS.size ||
      Object.keys(singleOwner).some(
        (field) => !SINGLE_OWNER_PROOF_FIELDS.has(field),
      )
    ) {
      blockers.push("single_owner_proof_schema_closed");
    }
    if (
      singleOwner?.schema_version !== "pulse-single-owner-proof-v1" ||
      text(singleOwner?.story_id) !== request.story_id ||
      !text(singleOwner?.owner_id) ||
      singleOwner?.active_scheduler_owner_count !== 1 ||
      singleOwner?.active_publisher_owner_count !== 1 ||
      singleOwner?.scheduler_owner_healthy !== true ||
      singleOwner?.publisher_owner_healthy !== true ||
      ownerCheckedAt > nowMs ||
      nowMs - ownerCheckedAt > MAX_JIT_AGE_MS ||
      nowMs >= ownerValidUntil ||
      nowMs >= leaseExpiresAt
    ) {
      blockers.push("fresh_single_owner_proof_required");
    }
  } catch (error) {
    blockers.push(...(error.codes || [error.message]));
  }
  if (blockers.length) {
    throw new AutonomousOfficialSourceEvidenceApplyError(blockers);
  }
  return {
    killValidUntil,
    ownerValidUntil,
  };
}

async function verifyInputsUnchanged(
  request,
  observations,
  fileSystem,
  workspace,
) {
  const reread = await readInputs(request, fileSystem, workspace);
  for (const field of ARTIFACT_FIELDS) {
    if (
      reread.artifacts[field].observed_sha256 !==
        observations.artifacts[field].observed_sha256 ||
      reread.artifacts[field].real_path !==
        observations.artifacts[field].real_path
    ) {
      throw new AutonomousOfficialSourceEvidenceApplyError(
        `${field}_changed_at_apply_boundary`,
      );
    }
  }
  if (
    reread.ownedVisualAssets.length !== observations.ownedVisualAssets.length ||
    reread.ownedVisualAssets.some(
      (asset, index) =>
        asset.asset_id !== observations.ownedVisualAssets[index].asset_id ||
        asset.observed_sha256 !==
          observations.ownedVisualAssets[index].observed_sha256 ||
        asset.real_path !== observations.ownedVisualAssets[index].real_path,
    )
  ) {
    throw new AutonomousOfficialSourceEvidenceApplyError(
      "owned_visual_assets_changed_at_apply_boundary",
    );
  }
}

async function writeAtomicNoClobber(reportPath, report, fileSystem, workspace) {
  const absolutePath = path.resolve(reportPath);
  assertPathWithinWorkspace(absolutePath, workspace, "report");
  await ensureSafeWorkspaceDirectory(
    path.dirname(absolutePath),
    workspace,
    fileSystem,
  );
  await assertNoPathLinks(
    path.dirname(absolutePath),
    "report_directory",
    fileSystem,
  );
  const tempPath = path.join(
    path.dirname(absolutePath),
    `.${path.basename(absolutePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await fileSystem.open(tempPath, "wx");
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`);
    await handle.sync();
    await handle.close();
    handle = null;
    await fileSystem.link(tempPath, absolutePath);
  } finally {
    await handle?.close().catch(() => {});
    await fileSystem.rm(tempPath, { force: true }).catch(() => {});
  }
  return absolutePath;
}

async function readExistingReport(reportPath, fileSystem, workspace) {
  const absolutePath = path.resolve(text(reportPath));
  assertPathWithinWorkspace(absolutePath, workspace, "existing_report");
  let initial;
  try {
    await assertNoPathLinks(absolutePath, "existing_report", fileSystem);
    initial = await fileSystem.lstat(absolutePath, {
      bigint: true,
    });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (
    !initial.isFile() ||
    initial.isSymbolicLink() ||
    initial.size <= 0n ||
    initial.size > BigInt(MAX_JSON_BYTES)
  ) {
    throw new AutonomousOfficialSourceEvidenceApplyError(
      "existing_report_regular_json_file_required",
    );
  }
  const realPath = await fileSystem.realpath(absolutePath);
  let handle;
  try {
    handle = await fileSystem.open(absolutePath, "r");
    const opened = await handle.stat({ bigint: true });
    if (!sameIdentity(initial, opened)) {
      throw new AutonomousOfficialSourceEvidenceApplyError(
        "existing_report_changed_during_read",
      );
    }
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const completed = await handle.stat({ bigint: true });
    const finalStat = await fileSystem.lstat(absolutePath, {
      bigint: true,
    });
    if (
      offset !== bytes.length ||
      !sameIdentity(opened, completed) ||
      !sameIdentity(opened, finalStat) ||
      (await fileSystem.realpath(absolutePath)) !== realPath
    ) {
      throw new AutonomousOfficialSourceEvidenceApplyError(
        "existing_report_changed_during_read",
      );
    }
    let report;
    try {
      report = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new AutonomousOfficialSourceEvidenceApplyError(
        "existing_report_json_invalid",
      );
    }
    return report;
  } finally {
    await handle?.close();
  }
}

function validateExistingReport({
  report,
  requestSha256,
  sourceEvidence,
  nowMs,
}) {
  const value = object(report);
  if (!value) {
    throw new AutonomousOfficialSourceEvidenceApplyError(
      "existing_report_invalid",
    );
  }
  const reportSha256 = exactSha256(
    value.report_sha256,
    "existing_report_sha256_required",
  );
  const { report_sha256: _reportSha256, ...payload } = value;
  if (
    canonicalSha256(payload) !== reportSha256 ||
    value.schema_version !== APPLY_REPORT_SCHEMA_VERSION ||
    text(value.request_sha256).toLowerCase() !== requestSha256 ||
    text(value.verdict).toUpperCase() !== "GREEN" ||
    value.operational_publish_authority !== false ||
    value.dispatch_authorised !== false ||
    value.external_publish_authorised !== false
  ) {
    throw new AutonomousOfficialSourceEvidenceApplyError(
      "existing_report_idempotency_conflict",
    );
  }
  const validUntil = exactTimestamp(
    value.valid_until,
    "existing_report_valid_until_invalid",
  );
  if (nowMs >= validUntil) {
    throw new AutonomousOfficialSourceEvidenceApplyError(
      "existing_report_expired_new_path_required",
    );
  }
  const expectedSnapshots = [
    exactSourceSnapshot(sourceEvidence.official_source_snapshot, "PRIMARY"),
    ...(Array.isArray(sourceEvidence.supporting_official_source_snapshots)
      ? sourceEvidence.supporting_official_source_snapshots.map((snapshot) =>
          exactSourceSnapshot(snapshot, "SUPPORTING"),
        )
      : []),
  ];
  const observedSources = Array.isArray(value.source_revalidation?.sources)
    ? value.source_revalidation.sources
    : [];
  if (
    value.source_revalidation?.snapshot_count !== expectedSnapshots.length ||
    observedSources.length !== expectedSnapshots.length
  ) {
    throw new AutonomousOfficialSourceEvidenceApplyError(
      "existing_report_source_set_mismatch",
    );
  }
  for (let index = 0; index < expectedSnapshots.length; index += 1) {
    const expected = expectedSnapshots[index];
    const observed = observedSources[index];
    const revalidatedAt = exactTimestamp(
      observed?.revalidated_at,
      "existing_report_revalidation_time_invalid",
    );
    if (
      observed?.role !== expected.role ||
      text(observed?.source_id) !== expected.source_id ||
      text(observed?.source_url) !== expected.source_url ||
      text(observed?.snapshot_sha256).toLowerCase() !==
        expected.snapshot_sha256 ||
      observed?.unchanged !== true ||
      observed?.claims_match !== true ||
      revalidatedAt > nowMs ||
      nowMs - revalidatedAt > MAX_JIT_AGE_MS
    ) {
      throw new AutonomousOfficialSourceEvidenceApplyError(
        "existing_report_source_revalidation_invalid",
      );
    }
  }
  return value;
}

function buildLineage({ observations, scriptSha256, rendererSha256 }) {
  return {
    story_intake_sha256: observations.artifacts.story_intake.observed_sha256,
    source_evidence_sha256:
      observations.artifacts.source_evidence.observed_sha256,
    script_sha256: scriptSha256,
    owned_motion_manifest_sha256:
      observations.artifacts.owned_motion_manifest.observed_sha256,
    owned_motion_source_manifest_sha256:
      observations.artifacts.owned_motion_source_manifest.observed_sha256,
    owned_programme_sha256:
      observations.artifacts.owned_programme.observed_sha256,
    narration_audio_sha256:
      observations.artifacts.narration_audio.observed_sha256,
    narration_manifest_sha256:
      observations.artifacts.narration_manifest.observed_sha256,
    narration_licence_evidence_sha256:
      observations.artifacts.narration_licence_evidence.observed_sha256,
    final_composite_manifest_sha256:
      observations.artifacts.final_composite_manifest.observed_sha256,
    renderer_manifest_file_sha256:
      observations.artifacts.renderer_manifest.observed_sha256,
    renderer_manifest_canonical_sha256: rendererSha256,
    deterministic_qa_sha256:
      observations.artifacts.deterministic_qa.observed_sha256,
    multimodal_visual_qa_sha256:
      observations.artifacts.multimodal_visual_qa.observed_sha256,
    final_mp4_sha256: observations.artifacts.final_mp4.observed_sha256,
    publication_metadata_sha256:
      observations.artifacts.publication_metadata.observed_sha256,
    kill_switch_proof_sha256:
      observations.artifacts.kill_switch_proof.observed_sha256,
    single_owner_proof_sha256:
      observations.artifacts.single_owner_proof.observed_sha256,
  };
}

async function materialiseAutonomousOfficialSourceEvidence(
  request,
  options = {},
) {
  const input = validateRequest(request);
  const fileSystem = options.fileSystem || defaultFileSystem;
  const now = trustedNow(options.clock);
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const workspace = await prepareWorkspaceRoot(
    options.workspaceRoot,
    fileSystem,
  );
  const requestSha256 = canonicalSha256(input);
  const observations = await readInputs(input, fileSystem, workspace);
  const intake = observations.artifacts.story_intake.value;
  const sourceEvidence = observations.artifacts.source_evidence.value;
  const story = validateStoryAndFreshness({
    request: input,
    intake,
    sourceEvidence,
    nowMs,
  });
  const lineage = validateLineageAndQa({
    request: input,
    observations,
    scriptSha256: story.scriptSha256,
  });
  const controls = validateControlProof({
    request: input,
    killSwitch: observations.artifacts.kill_switch_proof.value,
    singleOwner: observations.artifacts.single_owner_proof.value,
    nowMs,
  });
  const existingReport = await readExistingReport(
    input.report_path,
    fileSystem,
    workspace,
  );
  if (existingReport) {
    await verifyInputsUnchanged(input, observations, fileSystem, workspace);
    const exactExistingReport = validateExistingReport({
      report: existingReport,
      requestSha256,
      sourceEvidence: lineage.sourceEvidence,
      nowMs,
    });
    return {
      schema_version:
        "pulse-autonomous-official-source-evidence-apply-result-v1",
      status: "IDEMPOTENT",
      mutated: false,
      idempotent: true,
      report_path: path.resolve(input.report_path),
      report: exactExistingReport,
    };
  }
  const sourceRevalidation = await revalidateAllOfficialSources({
    sourceEvidence: lineage.sourceEvidence,
    fetchCapture: options.fetchCapture || createSafeHttpsFetchCapture(),
    nowIso,
  });
  await verifyInputsUnchanged(input, observations, fileSystem, workspace);
  const validUntilMs = Math.min(
    nowMs + MAX_JIT_AGE_MS,
    story.publishBy,
    story.staleAfter,
    controls.killValidUntil,
    controls.ownerValidUntil,
  );
  const reportPayload = {
    schema_version: APPLY_REPORT_SCHEMA_VERSION,
    materialiser_id: "pulse-autonomous-official-source-evidence-apply-v1",
    mode: MODE,
    generated_at: nowIso,
    valid_until: new Date(validUntilMs).toISOString(),
    request_sha256: requestSha256,
    story_id: input.story_id,
    verdict: "GREEN",
    blockers: [],
    authority: {
      method: AUTHORITY,
      scope: "LOCAL_EDITORIAL_AND_RELEASE_EVIDENCE_ONLY",
      human_approval: false,
      may_impersonate_human: false,
    },
    visual_policy: "OWNED_ONLY",
    audio_policy: "LICENSED_NARRATION_ONLY",
    source_revalidation: sourceRevalidation,
    lineage: buildLineage({
      observations,
      scriptSha256: story.scriptSha256,
      rendererSha256: lineage.rendererCanonicalSha256,
    }),
    controls: {
      kill_switch: "FRESH_HEALTHY",
      scheduler_and_publisher_ownership: "SINGLE_OWNER",
      kill_switch_proof: publicObservation(
        observations.artifacts.kill_switch_proof,
      ),
      single_owner_proof: publicObservation(
        observations.artifacts.single_owner_proof,
      ),
    },
    qa: {
      deterministic: "PASS",
      multimodal: "UNANIMOUS_PASS",
      deterministic_report: publicObservation(
        observations.artifacts.deterministic_qa,
      ),
      multimodal_report: publicObservation(
        observations.artifacts.multimodal_visual_qa,
      ),
    },
    input_files: Object.fromEntries(
      ARTIFACT_FIELDS.map((field) => [
        field,
        publicObservation(observations.artifacts[field]),
      ]),
    ),
    owned_visual_files: observations.ownedVisualAssets.map((asset) => ({
      asset_id: asset.asset_id,
      ...publicObservation(asset),
    })),
    operational_publish_authority: false,
    dispatch_authorised: false,
    dispatch_revalidation_required: true,
    external_publish_authorised: false,
    platform_contacted: false,
    database_mutated: false,
    oauth_or_tokens_mutated: false,
    platform_objects_created: false,
    local_files_written: 1,
    network_scope: "OFFICIAL_PRIMARY_AND_SUPPORTING_SOURCE_READS_ONLY",
  };
  const report = {
    ...reportPayload,
    report_sha256: canonicalSha256(reportPayload),
  };
  const reportPath = await writeAtomicNoClobber(
    input.report_path,
    report,
    fileSystem,
    workspace,
  );
  return {
    schema_version: "pulse-autonomous-official-source-evidence-apply-result-v1",
    status: "APPLIED",
    mutated: true,
    idempotent: false,
    report_path: reportPath,
    report,
  };
}

module.exports = {
  APPLY_REPORT_SCHEMA_VERSION,
  APPLY_REQUEST_SCHEMA_VERSION,
  AUTHORITY,
  AutonomousOfficialSourceEvidenceApplyError,
  MAX_JIT_AGE_MS,
  materialiseAutonomousOfficialSourceEvidence,
};
