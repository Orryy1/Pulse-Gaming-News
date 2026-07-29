"use strict";

const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");

const { scoreStory } = require("../scoring");
const {
  validateBreakingSourceEvidencePacket,
} = require("./breaking-source-evidence");
const {
  ASSET_MANIFEST_SCHEMA,
  buildOwnedMotionPlan,
  inspectFfmpeg,
  materializeOwnedMotion,
  renderOwnedMotionMarkdown,
  renderOwnedMotionPlanMarkdown,
} = require("./governed-owned-motion");
const {
  prepareGovernedEditorialInventory,
} = require("./governed-editorial-inventory-preparer");

const WORKFLOW_SCHEMA =
  "pulse-governed-editorial-inventory-workflow-v1";
const SAFETY_ENVELOPE_SCHEMA =
  "pulse-autonomous-local-proof-job-safety-v1";
const AUTHORITY_SCHEMA =
  "pulse-autonomous-draft-materialisation-authority-v1";
const INTAKE_SCHEMA = "pulse-governed-story-intake-v1";
const AUTHORITY_SCOPE =
  "governed_editorial_inventory_draft_materialisation";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAXIMUM_JSON_BYTES = 8 * 1024 * 1024;

const PLATFORM_ALIASES = Object.freeze({
  xbox: "Xbox",
  "xbox series": "Xbox Series X|S",
  "xbox series x/s": "Xbox Series X|S",
  "xbox series x|s": "Xbox Series X|S",
  "xbox series x and s": "Xbox Series X|S",
  xsx: "Xbox Series X|S",
  playstation: "PlayStation",
  "playstation 5": "PlayStation 5",
  ps5: "PlayStation 5",
  "nintendo switch": "Nintendo Switch",
  switch: "Nintendo Switch",
  "nintendo switch 2": "Nintendo Switch 2",
  "switch 2": "Nintendo Switch 2",
  pc: "PC",
  steam: "PC",
});

const FRANCHISE_ALIASES = Object.freeze({
  xbox: "Xbox",
  ffxiv: "Final Fantasy XIV",
  "final fantasy 14": "Final Fantasy XIV",
  "final fantasy xiv": "Final Fantasy XIV",
  eso: "The Elder Scrolls Online",
  "elder scrolls online": "The Elder Scrolls Online",
  "the elder scrolls online": "The Elder Scrolls Online",
});

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashObject(value) {
  return sha256(Buffer.from(JSON.stringify(stableValue(value)), "utf8"));
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normaliseSha256(value) {
  const result = text(value).replace(/^sha256:/i, "").toLowerCase();
  return SHA256_PATTERN.test(result) ? result : null;
}

function isoDate(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function unique(values) {
  return [...new Set(array(values).filter(Boolean))];
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function workflowError(code, blockers = [code]) {
  const error = new Error(
    `governed_editorial_inventory_workflow_${code}:${unique(blockers).join(",")}`,
  );
  error.code = `GOVERNED_EDITORIAL_INVENTORY_WORKFLOW_${String(code).toUpperCase()}`;
  error.blockers = unique(blockers);
  return error;
}

function slug(value) {
  return text(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function explicitIdentity(value, field, aliases) {
  const declared = text(value);
  if (!declared) throw workflowError("invalid", [`story_${field}_required`]);
  if (
    declared.length > 120 ||
    /[\u0000-\u001f\u007f]/.test(declared) ||
    /^https?:\/\//i.test(declared)
  ) {
    throw workflowError("invalid", [`story_${field}_invalid`]);
  }
  return aliases[declared.toLowerCase()] || declared;
}

function normaliseStory(storyInput, packet) {
  const input = object(storyInput);
  const id = text(input.id || input.story_id);
  if (!/^[a-z0-9][a-z0-9._-]{5,127}$/i.test(id)) {
    throw workflowError("invalid", ["story_id_invalid"]);
  }
  const title = text(input.title);
  if (!title || title.length > 300) {
    throw workflowError("invalid", ["story_title_required"]);
  }
  const franchise = explicitIdentity(
    input.franchise,
    "franchise",
    FRANCHISE_ALIASES,
  );
  const platform = explicitIdentity(
    input.platform,
    "platform",
    PLATFORM_ALIASES,
  );
  const publishedAt = isoDate(input.published_at || input.timestamp);
  if (!publishedAt) {
    throw workflowError("invalid", ["story_published_at_required"]);
  }
  const primarySourceUrl = text(input.primary_source_url);
  if (!/^https:\/\//i.test(primarySourceUrl)) {
    throw workflowError("invalid", [
      "story_primary_source_https_url_required",
    ]);
  }
  if (text(packet?.story_id) !== id) {
    throw workflowError("invalid", [
      "breaking_source_evidence_story_id_mismatch",
    ]);
  }
  if (text(packet?.primary_source_url) !== primarySourceUrl) {
    throw workflowError("invalid", [
      "breaking_source_evidence_primary_url_mismatch",
    ]);
  }
  const subjectCandidates = unique(
    [
      input.subject_key,
      input.subject_id,
      ...(array(input.subject_ids).length === 1
        ? [input.subject_ids[0]]
        : []),
    ].map(text),
  );
  const topicKey = slug(input.topic_key || subjectCandidates[0] || title);
  if (!topicKey) {
    throw workflowError("invalid", ["story_topic_key_invalid"]);
  }
  return {
    id,
    title,
    franchise,
    platform,
    topic_key: topicKey,
    published_at: publishedAt,
    primary_source_url: primarySourceUrl,
    verification_status: "CONFIRMED",
  };
}

function extractOfficialClaims(packet) {
  const primaryUrl = text(packet?.primary_source_url);
  const sources = new Map(
    array(packet?.sources).map((source) => [text(source?.source_id), source]),
  );
  const claims = [];
  const blockers = [];
  for (const group of array(packet?.confirmed_claims)) {
    const claimKey = text(group?.claim_key);
    const evidence = array(group?.evidence).find((entry) => {
      const source = sources.get(text(entry?.source_id));
      return (
        source?.status === "CAPTURED" &&
        text(source?.source_class).toUpperCase() ===
          "OFFICIAL_FIRST_PARTY" &&
        text(source?.final_url) === primaryUrl &&
        text(entry?.final_url) === primaryUrl
      );
    });
    const source = sources.get(text(evidence?.source_id));
    const quote = String(evidence?.text ?? "");
    const sourceClaim = array(source?.claims).find(
      (claim) =>
        text(claim?.claim_key) === claimKey &&
        String(claim?.text ?? "") === quote &&
        normaliseSha256(claim?.claim_sha256) ===
          normaliseSha256(evidence?.claim_sha256) &&
        normaliseSha256(claim?.claim_text_sha256) ===
          sha256(Buffer.from(quote, "utf8")),
    );
    if (!claimKey || !evidence || !sourceClaim || !quote.trim()) {
      blockers.push("breaking_source_official_claim_binding_invalid");
      continue;
    }
    claims.push({
      claim_key: claimKey,
      text: quote,
      source_id: text(source.source_id),
      source_url: primaryUrl,
      claim_sha256: normaliseSha256(sourceClaim.claim_sha256),
      claim_text_sha256: normaliseSha256(sourceClaim.claim_text_sha256),
    });
  }
  claims.sort(
    (left, right) =>
      left.claim_key.localeCompare(right.claim_key) ||
      left.text.localeCompare(right.text),
  );
  if (claims.length === 0) {
    blockers.push("breaking_source_official_claims_required");
  }
  if (blockers.length) throw workflowError("invalid", blockers);
  return claims;
}

/**
 * Create the owned-motion input exclusively from exact official claim text.
 * It performs no discovery, inference or generative rewriting.
 */
function buildOwnedMotionIntake({
  story: storyInput,
  packet,
  sourceEvidence,
} = {}) {
  if (
    packet?.verdict !== "OFFICIAL_CONFIRMED" ||
    packet?.verification_status !== "CONFIRMED" ||
    packet?.confirmation_basis !== "official_first_party" ||
    packet?.verified_for_planning !== true
  ) {
    throw workflowError("invalid", [
      "breaking_source_evidence_official_confirmation_required",
    ]);
  }
  const story = normaliseStory(storyInput, packet);
  const claims = extractOfficialClaims(packet);
  const fullScript = claims.map((claim) => claim.text).join(" ");
  const sourcePath = text(object(sourceEvidence).path);
  const fileSha256 = normaliseSha256(object(sourceEvidence).file_sha256);
  const canonicalSha256 = normaliseSha256(
    object(sourceEvidence).canonical_sha256,
  );
  if (!sourcePath || !fileSha256 || !canonicalSha256) {
    throw workflowError("invalid", [
      "breaking_source_evidence_exact_reference_required",
    ]);
  }
  const intake = {
    schema_version: INTAKE_SCHEMA,
    source_url: story.primary_source_url,
    source_type: "official",
    source_evidence_path: sourcePath,
    source_evidence_file_sha256: fileSha256,
    source_evidence_sha256: canonicalSha256,
    published_at: story.published_at,
    claims,
    story: {
      ...story,
      hook: claims[0].text,
      full_script: fullScript,
      script_sha256: sha256(Buffer.from(fullScript, "utf8")),
    },
    contract: {
      editorial_lane_id: "what_changes_for_players",
      hook_type: "direct",
      duration_band_id: "what_changes_short_25_32",
    },
    safety: {
      exact_official_claim_text_only: true,
      claims_synthesised: false,
      game_identity_inferred: false,
      network_used: false,
      publication_authority: false,
    },
  };
  const bytes = jsonBytes(intake);
  return {
    intake: deepFreeze(intake),
    bytes,
    sha256: sha256(bytes),
  };
}

function validateAutonomousDraftMaterialisationAuthority({
  safety: safetyInput,
  plan,
  confirm_story_id: confirmStoryId,
  confirm_intake_manifest_sha256: confirmIntakeManifestSha256,
} = {}) {
  const safety = object(safetyInput);
  const blockers = [];
  if (safety.schema_version !== SAFETY_ENVELOPE_SCHEMA) {
    blockers.push("local_proof_safety_envelope_schema_invalid");
  }
  if (text(safety.mode).toUpperCase() !== "LOCAL_PROOF") {
    blockers.push("local_proof_mode_required");
  }
  if (text(safety.scope) !== AUTHORITY_SCOPE) {
    blockers.push("draft_materialisation_scope_invalid");
  }
  if (safety.local_proof_only !== true) {
    blockers.push("local_proof_only_required");
  }
  if (safety.human_review_required !== true) {
    blockers.push("human_review_required");
  }
  if (safety.publish_authority !== false) {
    blockers.push("publish_authority_must_be_false");
  }
  if (safety.external_posting_authorised !== false) {
    blockers.push("external_posting_must_be_forbidden");
  }
  if (safety.network_authorised !== false) {
    blockers.push("network_must_be_forbidden");
  }
  if (safety.database_mutation_authorised !== false) {
    blockers.push("database_mutation_must_be_forbidden");
  }
  if (safety.oauth_mutation_authorised !== false) {
    blockers.push("oauth_mutation_must_be_forbidden");
  }
  if (safety.scheduler_authority_created !== false) {
    blockers.push("scheduler_authority_must_be_false");
  }
  if (safety.auto_publish !== false) {
    blockers.push("auto_publish_must_be_false");
  }
  if (safety.guarded_live_dispatch_enabled !== false) {
    blockers.push("guarded_live_dispatch_must_be_false");
  }
  if (typeof safety.emergency_kill_switch_engaged !== "boolean") {
    blockers.push("emergency_kill_switch_state_required");
  }
  if (plan?.ready !== true || plan?.mode !== "DRY_RUN") {
    blockers.push("owned_motion_dry_run_plan_not_ready");
  }
  if (text(confirmStoryId) !== text(plan?.story_id)) {
    blockers.push("story_id_confirmation_mismatch");
  }
  const confirmedHash = normaliseSha256(confirmIntakeManifestSha256);
  if (!confirmedHash) {
    blockers.push("intake_manifest_sha256_confirmation_invalid");
  } else if (confirmedHash !== normaliseSha256(plan?.intake_manifest_sha256)) {
    blockers.push("intake_manifest_sha256_confirmation_mismatch");
  }
  return deepFreeze({
    schema_version: AUTHORITY_SCHEMA,
    authorised: blockers.length === 0,
    blockers: unique(blockers).sort(),
    mode: "LOCAL_PROOF",
    scope: AUTHORITY_SCOPE,
    human_review_required: true,
    external_publish_authorised: false,
    database_mutation_authorised: false,
    oauth_mutation_authorised: false,
    network_authorised: false,
    scheduler_authority_created: false,
  });
}

function relativeContained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function lstatOrNull(candidate) {
  try {
    return await fsp.lstat(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function assertSafePath({
  root,
  candidate,
  prefix,
  leafType,
  allowMissing = false,
  disallowRoot = false,
}) {
  const absoluteRoot = path.resolve(root);
  const absoluteCandidate = path.resolve(candidate);
  const rootStat = await lstatOrNull(absoluteRoot);
  if (!rootStat || !rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw workflowError("invalid", [`${prefix}_root_directory_invalid`]);
  }
  if (
    !relativeContained(absoluteRoot, absoluteCandidate) ||
    (disallowRoot && absoluteRoot === absoluteCandidate)
  ) {
    throw workflowError("invalid", [`${prefix}_path_outside_root`]);
  }
  const relative = path.relative(absoluteRoot, absoluteCandidate);
  const parts = relative ? relative.split(path.sep).filter(Boolean) : [];
  let cursor = absoluteRoot;
  let missing = false;
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    const stat = await lstatOrNull(cursor);
    if (!stat) {
      missing = true;
      continue;
    }
    if (stat.isSymbolicLink()) {
      throw workflowError("invalid", [`${prefix}_symlink_forbidden`]);
    }
    const isLeaf = index === parts.length - 1;
    if (!isLeaf && !stat.isDirectory()) {
      throw workflowError("invalid", [`${prefix}_parent_not_directory`]);
    }
    if (isLeaf && leafType === "file" && !stat.isFile()) {
      throw workflowError("invalid", [`${prefix}_not_a_file`]);
    }
    if (isLeaf && leafType === "directory" && !stat.isDirectory()) {
      throw workflowError("invalid", [`${prefix}_not_a_directory`]);
    }
  }
  if (missing && !allowMissing) {
    throw workflowError("invalid", [`${prefix}_missing`]);
  }
  return absoluteCandidate;
}

async function ensureSafeDirectory(root, directory, prefix) {
  await assertSafePath({
    root,
    candidate: directory,
    prefix,
    leafType: "directory",
    allowMissing: true,
  });
  await fsp.mkdir(directory, { recursive: true });
  await assertSafePath({
    root,
    candidate: directory,
    prefix,
    leafType: "directory",
  });
}

async function readHashBoundEvidence(reference, rootDir) {
  const ref = object(reference);
  const declaredPath = text(ref.path);
  const expectedFileSha256 = normaliseSha256(
    ref.file_sha256 || ref.sha256,
  );
  if (!declaredPath) {
    throw workflowError("invalid", [
      "breaking_source_evidence_path_required",
    ]);
  }
  if (!expectedFileSha256) {
    throw workflowError("invalid", [
      "breaking_source_evidence_file_sha256_required",
    ]);
  }
  const absolutePath = path.resolve(
    path.isAbsolute(declaredPath)
      ? declaredPath
      : path.join(rootDir, declaredPath),
  );
  await assertSafePath({
    root: rootDir,
    candidate: absolutePath,
    prefix: "breaking_source_evidence",
    leafType: "file",
  });
  const stat = await fsp.lstat(absolutePath);
  if (stat.size <= 0 || stat.size > MAXIMUM_JSON_BYTES) {
    throw workflowError("invalid", [
      "breaking_source_evidence_file_size_invalid",
    ]);
  }
  const bytes = await fsp.readFile(absolutePath);
  const observedFileSha256 = sha256(bytes);
  if (observedFileSha256 !== expectedFileSha256) {
    throw workflowError("invalid", [
      "breaking_source_evidence_file_sha256_mismatch",
    ]);
  }
  let packet;
  try {
    packet = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw workflowError("invalid", [
      "breaking_source_evidence_json_invalid",
    ]);
  }
  const validation = validateBreakingSourceEvidencePacket(packet);
  if (!validation.valid) {
    throw workflowError("invalid", validation.blockers);
  }
  const declaredCanonicalSha256 = normaliseSha256(
    ref.canonical_sha256 ||
      ref.packet_sha256 ||
      ref.source_evidence_sha256,
  );
  if (
    declaredCanonicalSha256 &&
    declaredCanonicalSha256 !== validation.packet_sha256
  ) {
    throw workflowError("invalid", [
      "breaking_source_evidence_canonical_sha256_mismatch",
    ]);
  }
  return {
    packet,
    reference: {
      path: absolutePath,
      file_sha256: observedFileSha256,
      canonical_sha256: validation.packet_sha256,
    },
  };
}

async function writeImmutableFile({
  root,
  filePath,
  bytes,
  prefix = "output",
}) {
  const absolutePath = path.resolve(filePath);
  await ensureSafeDirectory(root, path.dirname(absolutePath), prefix);
  const existing = await lstatOrNull(absolutePath);
  if (existing) {
    if (existing.isSymbolicLink()) {
      throw workflowError("immutable_conflict", [
        `${prefix}_symlink_forbidden`,
      ]);
    }
    if (!existing.isFile()) {
      throw workflowError("immutable_conflict", [
        `${prefix}_not_a_file`,
      ]);
    }
    const observed = await fsp.readFile(absolutePath);
    if (
      observed.length !== bytes.length ||
      !crypto.timingSafeEqual(observed, bytes)
    ) {
      throw workflowError("immutable_conflict", [
        `${prefix}_bytes_mismatch`,
      ]);
    }
    return { path: absolutePath, file_sha256: sha256(observed), reused: true };
  }
  const temporaryPath = `${absolutePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(temporaryPath, bytes, { flag: "wx" });
  try {
    try {
      await fsp.rename(temporaryPath, absolutePath);
    } catch (error) {
      if (!["EEXIST", "EPERM"].includes(error?.code)) throw error;
      const observed = await fsp.readFile(absolutePath);
      if (
        observed.length !== bytes.length ||
        !crypto.timingSafeEqual(observed, bytes)
      ) {
        throw workflowError("immutable_conflict", [
          `${prefix}_concurrent_write_mismatch`,
        ]);
      }
    }
  } finally {
    await fsp.rm(temporaryPath, { force: true }).catch(() => {});
  }
  return { path: absolutePath, file_sha256: sha256(bytes), reused: false };
}

async function readJsonFileSafe({
  root,
  filePath,
  prefix,
  maximumBytes = MAXIMUM_JSON_BYTES,
}) {
  await assertSafePath({
    root,
    candidate: filePath,
    prefix,
    leafType: "file",
  });
  const stat = await fsp.lstat(filePath);
  if (stat.size <= 0 || stat.size > maximumBytes) {
    throw workflowError("conflict", [`${prefix}_file_size_invalid`]);
  }
  const bytes = await fsp.readFile(filePath);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw workflowError("conflict", [`${prefix}_json_invalid`]);
  }
  return { bytes, value, file_sha256: sha256(bytes) };
}

async function validateExistingOwnedMotionPackage({
  rootDir,
  plan,
  generatedAt,
}) {
  const storyRoot = path.resolve(plan.output_root);
  const manifestPath = path.join(storyRoot, "owned-motion-manifest.json");
  const markdownPath = path.join(storyRoot, "owned-motion-manifest.md");
  const manifestStat = await lstatOrNull(manifestPath);
  const assetsRoot = path.join(storyRoot, "assets");
  const assetsStat = await lstatOrNull(assetsRoot);
  const markdownStat = await lstatOrNull(markdownPath);
  if (!manifestStat) {
    if (assetsStat || markdownStat) {
      throw workflowError("conflict", [
        "owned_motion_partial_output_present",
      ]);
    }
    return null;
  }
  const observed = await readJsonFileSafe({
    root: rootDir,
    filePath: manifestPath,
    prefix: "owned_motion_manifest",
  });
  const manifest = object(observed.value);
  const blockers = [];
  if (manifest.schema_version !== ASSET_MANIFEST_SCHEMA) {
    blockers.push("owned_motion_manifest_schema_invalid");
  }
  if (text(manifest.story_id) !== text(plan.story_id)) {
    blockers.push("owned_motion_manifest_story_id_mismatch");
  }
  if (isoDate(manifest.generated_at) !== generatedAt) {
    blockers.push("owned_motion_manifest_generated_at_mismatch");
  }
  const plannedByPath = new Map(
    array(plan.assets).map((asset) => [
      String(asset.path).replace(/\\/g, "/"),
      asset,
    ]),
  );
  const manifestAssets = array(manifest.assets);
  if (manifestAssets.length !== plannedByPath.size) {
    blockers.push("owned_motion_asset_inventory_mismatch");
  }
  const observedAssetNames = [];
  const enrichedAssets = [];
  for (const asset of manifestAssets) {
    const relativePath = String(asset?.path || "").replace(/\\/g, "/");
    const planned = plannedByPath.get(relativePath);
    if (
      !relativePath ||
      path.posix.isAbsolute(relativePath) ||
      relativePath.split("/").includes("..") ||
      !planned
    ) {
      blockers.push("owned_motion_asset_path_unplanned");
      continue;
    }
    const absolutePath = path.resolve(storyRoot, ...relativePath.split("/"));
    if (!relativeContained(storyRoot, absolutePath)) {
      blockers.push("owned_motion_asset_path_outside_story_root");
      continue;
    }
    try {
      await assertSafePath({
        root: rootDir,
        candidate: absolutePath,
        prefix: "owned_motion_asset",
        leafType: "file",
      });
    } catch (error) {
      blockers.push(...array(error?.blockers));
      continue;
    }
    const bytes = await fsp.readFile(absolutePath);
    const observedSha256 = sha256(bytes);
    if (observedSha256 !== normaliseSha256(asset.sha256)) {
      blockers.push("owned_motion_asset_sha256_mismatch");
    }
    if (
      text(asset.media_type) !== text(planned.media_type) ||
      text(asset.role) !== text(planned.role) ||
      text(asset.ownership).toLowerCase() !== "owned" ||
      text(asset.rights_basis).toUpperCase() !== "OWNED" ||
      asset.attribution_required !== false ||
      asset?.provenance?.third_party_media_used !== false ||
      normaliseSha256(asset?.provenance?.intake_manifest_sha256) !==
        normaliseSha256(plan.intake_manifest_sha256)
    ) {
      blockers.push("owned_motion_asset_contract_mismatch");
    }
    observedAssetNames.push(path.basename(absolutePath));
    enrichedAssets.push({ ...asset, absolute_path: absolutePath });
  }
  if (assetsStat?.isSymbolicLink() || !assetsStat?.isDirectory()) {
    blockers.push("owned_motion_assets_directory_invalid");
  } else {
    const entries = await fsp.readdir(assetsRoot, { withFileTypes: true });
    if (
      entries.some(
        (entry) => entry.isSymbolicLink() || !entry.isFile(),
      ) ||
      JSON.stringify(entries.map((entry) => entry.name).sort()) !==
        JSON.stringify(observedAssetNames.sort())
    ) {
      blockers.push("owned_motion_assets_directory_inventory_mismatch");
    }
  }
  if (!markdownStat || markdownStat.isSymbolicLink() || !markdownStat.isFile()) {
    blockers.push("owned_motion_manifest_markdown_invalid");
  } else {
    const expectedMarkdown = Buffer.from(
      renderOwnedMotionMarkdown(manifest),
      "utf8",
    );
    const actualMarkdown = await fsp.readFile(markdownPath);
    if (
      actualMarkdown.length !== expectedMarkdown.length ||
      !crypto.timingSafeEqual(actualMarkdown, expectedMarkdown)
    ) {
      blockers.push("owned_motion_manifest_markdown_mismatch");
    }
  }
  if (blockers.length) {
    throw workflowError("conflict", unique(blockers).sort());
  }
  return {
    manifest: { ...manifest, assets: enrichedAssets },
    manifest_path: manifestPath,
    markdown_path: markdownPath,
    manifest_sha256: observed.file_sha256,
    reused: true,
  };
}

function advertiserSafetyInput({
  exactInput,
  scorerResult,
  storyId,
  scoredAt,
}) {
  if (exactInput && typeof exactInput === "object") {
    return structuredClone(exactInput);
  }
  const result = object(scorerResult);
  return {
    story_id: storyId,
    advertiser_safety: Number(result?.breakdown?.advertiser_safety),
    maximum_score: 5,
    hard_stops: array(result.hard_stops).map(text).filter(Boolean),
    policy_version: text(result.scorer_version) ||
      "pulse-score-story-advertiser-safety-v1",
    scored_at: scoredAt,
    decision:
      Number(result?.breakdown?.advertiser_safety) === 5 &&
      array(result.hard_stops).length === 0
        ? "SAFE"
        : "HOLD",
  };
}

function workflowSafety() {
  return {
    mode: "LOCAL_PROOF",
    local_proof_only: true,
    exact_official_claims_only: true,
    owned_motion_only: true,
    claims_synthesised: false,
    rights_synthesised: false,
    network_used: false,
    database_mutated: false,
    oauth_mutated: false,
    platform_contacted: false,
    publish_authority_created: false,
    scheduler_authority_created: false,
    external_posting_authorised: false,
    human_review_required: true,
  };
}

async function fileReference(root, filePath, prefix) {
  if (!filePath) return { path: null, file_sha256: null };
  await assertSafePath({
    root,
    candidate: filePath,
    prefix,
    leafType: "file",
  });
  const bytes = await fsp.readFile(filePath);
  return { path: path.resolve(filePath), file_sha256: sha256(bytes) };
}

function renderWorkflowSummary(reportBase) {
  const lines = [
    "# Governed Editorial Inventory Workflow",
    "",
    `- Story: \`${reportBase.story_id}\``,
    `- Verdict: **${reportBase.verdict}**`,
    `- Mode: **LOCAL_PROOF**`,
    `- Evidence revision: \`${reportBase.workflow_revision_sha256}\``,
    "- Official exact claims only: **Yes**",
    "- Owned motion only: **Yes**",
    "- Human review required: **Yes**",
    "- No external publication authority: **Yes**",
    "- Network used: **No**",
    "- Database mutated: **No**",
    "- OAuth mutated: **No**",
    "",
    "## Blockers",
    "",
    ...(reportBase.blockers.length
      ? reportBase.blockers.map((blocker) => `- ${blocker}`)
      : ["- None."]),
    "",
    "This package is local draft evidence. It does not schedule or publish media.",
    "",
  ];
  return lines.join("\n");
}

/**
 * Handler-friendly, local-only workflow. All expensive or environment-specific
 * media dependencies can be injected, while the default path uses the existing
 * governed owned-motion renderer.
 */
async function runGovernedEditorialInventoryWorkflow({
  story: storyInput,
  breaking_source_evidence: breakingSourceEvidence,
  safety: safetyInput,
  output_dir: outputDir,
  root_dir: rootDir = process.cwd(),
  advertiser_safety: exactAdvertiserSafety,
  advertiser_scorer: advertiserScorer = scoreStory,
  inspect_ffmpeg: inspectFfmpegImpl = inspectFfmpeg,
  render_still: renderStill,
  render_video: renderVideo,
  inspect_asset: inspectAsset,
  now,
} = {}) {
  const absoluteRoot = path.resolve(rootDir);
  const outputRoot = path.resolve(
    path.isAbsolute(String(outputDir || ""))
      ? String(outputDir || "")
      : path.join(absoluteRoot, String(outputDir || "")),
  );
  if (!text(outputDir)) {
    throw workflowError("invalid", ["workflow_output_dir_required"]);
  }
  await assertSafePath({
    root: absoluteRoot,
    candidate: outputRoot,
    prefix: "workflow_output",
    leafType: "directory",
    allowMissing: true,
    disallowRoot: true,
  });

  const source = await readHashBoundEvidence(
    breakingSourceEvidence,
    absoluteRoot,
  );
  const validation = validateBreakingSourceEvidencePacket(source.packet);
  if (
    !validation.valid ||
    source.packet.verdict !== "OFFICIAL_CONFIRMED" ||
    source.packet.verification_status !== "CONFIRMED" ||
    source.packet.confirmation_basis !== "official_first_party" ||
    source.packet.verified_for_planning !== true
  ) {
    throw workflowError("invalid", [
      ...validation.blockers,
      "breaking_source_evidence_official_confirmation_required",
    ]);
  }
  const generatedAt =
    isoDate(source.packet.generated_at) ||
    isoDate(object(storyInput).published_at) ||
    isoDate(now);
  if (!generatedAt) {
    throw workflowError("invalid", ["workflow_generated_at_invalid"]);
  }
  const intakeResult = buildOwnedMotionIntake({
    story: storyInput,
    packet: source.packet,
    sourceEvidence: source.reference,
  });
  const ffmpeg = await inspectFfmpegImpl();
  const motionRoot = path.join(outputRoot, "owned-motion");
  const plan = buildOwnedMotionPlan({
    intake: intakeResult.intake,
    intakeManifestSha256: intakeResult.sha256,
    outputDir: motionRoot,
    generatedAt,
    ffmpegAvailable: ffmpeg?.available === true,
  });
  if (!plan.ready) {
    throw workflowError("blocked", plan.blockers);
  }
  const authority =
    validateAutonomousDraftMaterialisationAuthority({
      safety: safetyInput,
      plan,
      confirm_story_id: intakeResult.intake.story.id,
      confirm_intake_manifest_sha256: intakeResult.sha256,
    });
  if (!authority.authorised) {
    throw workflowError("blocked", authority.blockers);
  }

  await ensureSafeDirectory(absoluteRoot, outputRoot, "workflow_output");
  const intakePath = path.join(outputRoot, "owned-motion-intake.json");
  const intakeReference = await writeImmutableFile({
    root: absoluteRoot,
    filePath: intakePath,
    bytes: intakeResult.bytes,
    prefix: "owned_motion_intake",
  });
  await ensureSafeDirectory(
    absoluteRoot,
    path.resolve(plan.output_root),
    "owned_motion_output",
  );
  const planPath = path.join(plan.output_root, "owned-motion-plan.json");
  const planMarkdownPath = path.join(
    plan.output_root,
    "owned-motion-plan.md",
  );
  const planReference = await writeImmutableFile({
    root: absoluteRoot,
    filePath: planPath,
    bytes: jsonBytes(plan),
    prefix: "owned_motion_plan",
  });
  await writeImmutableFile({
    root: absoluteRoot,
    filePath: planMarkdownPath,
    bytes: Buffer.from(renderOwnedMotionPlanMarkdown(plan), "utf8"),
    prefix: "owned_motion_plan_markdown",
  });

  let ownedMotion = await validateExistingOwnedMotionPackage({
    rootDir: absoluteRoot,
    plan,
    generatedAt,
  });
  const reusedOwnedMotion = Boolean(ownedMotion);
  if (!ownedMotion) {
    const materialised = await materializeOwnedMotion({
      intake: intakeResult.intake,
      plan,
      authority,
      generatedAt,
      ...(renderStill ? { renderStill } : {}),
      ...(renderVideo ? { renderVideo } : {}),
      ...(inspectAsset ? { inspectAsset } : {}),
    });
    if (
      materialised.external_publish_authorised !== false ||
      materialised.database_mutation_authorised !== false ||
      materialised.oauth_mutation_authorised !== false ||
      materialised.network_used !== false
    ) {
      throw workflowError("blocked", [
        "owned_motion_materialisation_safety_contract_invalid",
      ]);
    }
    ownedMotion = await validateExistingOwnedMotionPackage({
      rootDir: absoluteRoot,
      plan,
      generatedAt,
    });
  }

  const scoringStory = {
    ...object(storyInput),
    ...intakeResult.intake.story,
    body: intakeResult.intake.story.full_script,
    source_type: "official",
    flair: "Verified",
    timestamp: intakeResult.intake.story.published_at,
  };
  const scorerResult = exactAdvertiserSafety
    ? null
    : await advertiserScorer(scoringStory, {});
  const advertiserInput = advertiserSafetyInput({
    exactInput: exactAdvertiserSafety,
    scorerResult,
    storyId: intakeResult.intake.story.id,
    scoredAt: generatedAt,
  });
  const inventoryRoot = path.join(outputRoot, "inventory");
  const inventoryRegistryPath = path.join(
    inventoryRoot,
    "governed-editorial-inventory.json",
  );
  const reusedInventory = Boolean(await lstatOrNull(inventoryRegistryPath));
  const inventory = await prepareGovernedEditorialInventory({
    story: intakeResult.intake.story,
    breaking_source_evidence: source.reference,
    owned_motion_manifest: {
      path: ownedMotion.manifest_path,
      file_sha256: ownedMotion.manifest_sha256,
    },
    advertiser_safety: advertiserInput,
    output_dir: inventoryRoot,
    root_dir: absoluteRoot,
    now: generatedAt,
  });

  const artifacts = {
    source_evidence: source.reference,
    owned_motion_intake: {
      path: intakeReference.path,
      file_sha256: intakeReference.file_sha256,
      canonical_sha256: intakeResult.sha256,
    },
    owned_motion_plan: {
      path: planReference.path,
      file_sha256: planReference.file_sha256,
      canonical_sha256: hashObject(plan),
    },
    owned_motion_manifest: {
      path: ownedMotion.manifest_path,
      file_sha256: ownedMotion.manifest_sha256,
    },
    inventory_registry: await fileReference(
      absoluteRoot,
      inventory.paths.registry,
      "inventory_registry",
    ),
    weekly_source_evidence: await fileReference(
      absoluteRoot,
      inventory.paths.weekly_source_evidence,
      "weekly_source_evidence",
    ),
    rights_ledger: await fileReference(
      absoluteRoot,
      inventory.paths.rights_ledger,
      "rights_ledger",
    ),
    advertiser_safety_report: await fileReference(
      absoluteRoot,
      inventory.paths.advertiser_safety_report,
      "advertiser_safety_report",
    ),
  };
  const workflowRevisionSha256 = hashObject({
    story: intakeResult.intake.story,
    source_evidence: source.reference,
    owned_motion_intake_sha256: intakeResult.sha256,
    safety: stableValue(safetyInput),
    advertiser_safety: advertiserInput,
  });
  const reportBase = {
    schema_version: WORKFLOW_SCHEMA,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    story_id: intakeResult.intake.story.id,
    verdict: inventory.registry.verdict,
    blockers: array(inventory.registry.blockers),
    workflow_revision_sha256: workflowRevisionSha256,
    stages: {
      source_evidence: "PASS",
      exact_claim_projection: "PASS",
      draft_authority: "PASS",
      owned_motion_materialisation: "PASS",
      editorial_inventory:
        inventory.registry.verdict === "READY" ? "PASS" : "HOLD",
    },
    artifacts,
    safety: workflowSafety(),
  };
  const summaryPath = path.join(
    outputRoot,
    "governed-editorial-inventory-workflow.md",
  );
  const summaryBytes = Buffer.from(renderWorkflowSummary(reportBase), "utf8");
  const summaryReference = await writeImmutableFile({
    root: absoluteRoot,
    filePath: summaryPath,
    bytes: summaryBytes,
    prefix: "workflow_summary",
  });
  const completeReportBase = {
    ...reportBase,
    summary: {
      path: summaryReference.path,
      file_sha256: summaryReference.file_sha256,
    },
  };
  const report = {
    ...completeReportBase,
    report_sha256: hashObject(completeReportBase),
  };
  const reportPath = path.join(
    outputRoot,
    "governed-editorial-inventory-workflow.json",
  );
  await writeImmutableFile({
    root: absoluteRoot,
    filePath: reportPath,
    bytes: jsonBytes(report),
    prefix: "workflow_report",
  });

  return {
    verdict: report.verdict,
    blockers: report.blockers,
    report,
    inventory,
    intake: intakeResult.intake,
    plan,
    authority,
    owned_motion: ownedMotion,
    advertiser_safety: advertiserInput,
    reused_owned_motion: reusedOwnedMotion,
    reused_inventory: reusedInventory,
    paths: {
      output_root: outputRoot,
      report: reportPath,
      summary: summaryPath,
      intake: intakePath,
      plan: planPath,
      owned_motion_manifest: ownedMotion.manifest_path,
      inventory: inventory.paths.registry,
    },
    safety: workflowSafety(),
  };
}

module.exports = {
  AUTHORITY_SCHEMA,
  AUTHORITY_SCOPE,
  SAFETY_ENVELOPE_SCHEMA,
  WORKFLOW_SCHEMA,
  buildOwnedMotionIntake,
  renderWorkflowSummary,
  runGovernedEditorialInventoryWorkflow,
  validateAutonomousDraftMaterialisationAuthority,
};
