"use strict";

const crypto = require("node:crypto");
const defaultFileSystem = require("node:fs/promises");
const path = require("node:path");

const {
  materialiseAutonomousAdmissionControlProofs,
} = require("./autonomous-admission-control-proof");
const {
  APPLY_REQUEST_SCHEMA_VERSION,
  materialiseAutonomousOfficialSourceEvidence,
} = require("./autonomous-official-source-evidence-apply");
const {
  createAutonomousOfficialPublicationAuthority,
} = require("./autonomous-official-publication-authority");
const {
  buildOfficialSourceReleaseBinding,
} = require("./official-source-revalidation");
const {
  buildImmutablePublicationEvidence,
} = require("./publication-admission");
const { assessPublicationEvidence } = require("./publication-evidence-gates");
const {
  fingerprintPublicationRequest,
} = require("./publication-request-fingerprint");
const {
  resolveOperatingContract,
} = require("../stabilisation/operating-contract");
const {
  validateGovernedFastNewsLaneDecision,
} = require("./governed-fast-news-lane-decision");

const PREPARATION_SCHEMA_VERSION =
  "pulse-autonomous-official-source-jit-preparation-v3";
const RESULT_SCHEMA_VERSION =
  "pulse-autonomous-official-jit-admission-packet-result-v3";
const RESOLVED_PLAN_SCHEMA_VERSION =
  "pulse-autonomous-official-jit-resolved-plan-v3";
const MONETISATION_RIGHTS_EVIDENCE_SCHEMA_VERSION =
  "pulse-monetisation-aware-candidate-rights-evidence-v1";
const AUTHORITY_TYPE = "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE";
const JIT_EARLIEST_OFFSET_MS = 80 * 60 * 1000;
const STATIC_ARTIFACT_FIELDS = Object.freeze([
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
  "autonomous_visual_gate_decision",
  "final_mp4",
  "publication_metadata",
  "autonomous_green_supplement",
]);
const PREPARATION_INPUT_FIELDS = new Set([
  "story_id",
  "channel_id",
  "lane_id",
  "platform",
  "scheduled_for",
  "role",
  "candidate_revision_sha256",
  "request_fingerprint",
  "artifacts",
  "owned_visual_assets",
  "publication_evidence_gate_input",
]);
const PREPARATION_FIELDS = new Set([
  "schema_version",
  ...PREPARATION_INPUT_FIELDS,
  "preparation_sha256",
]);
const PREPARATION_INPUT_FIELDS_WITH_FAST_NEWS = new Set([
  ...PREPARATION_INPUT_FIELDS,
  "fast_news_lane_decision",
]);
const PREPARATION_FIELDS_WITH_FAST_NEWS = new Set([
  ...PREPARATION_FIELDS,
  "fast_news_lane_decision",
]);
const FILE_REFERENCE_FIELDS = new Set(["path", "sha256"]);
const OWNED_ASSET_FIELDS = new Set(["asset_id", "path", "sha256"]);
const GATE_INPUT_FIELDS = new Set([
  "originality_transformation",
  "rights_ledger",
  "rights_ledger_sha256",
  "synthetic_media_disclosure",
]);
const SYNTHETIC_DISCLOSURE_FIELDS = new Set([
  "decision_authority",
  "decision_provenance",
  "altered_content",
  "policy_basis",
  "youtube_field_value",
]);
const SYSTEM_POLICY_PROVENANCE_FIELDS = new Set([
  "policy_id",
  "policy_version",
  "evaluated_at",
  "evidence_sha256",
]);
const RIGHTS_LEDGER_FIELDS = new Set(["ledger_version", "decision", "items"]);
const RIGHTS_ITEM_FIELDS = new Set([
  "item_id",
  "source_url",
  "asset_sha256",
  "included_in_final",
  "rights_decision",
  "rights_basis",
  "rights_evidence",
  "attribution_decision",
  "attribution_text",
]);
const RIGHTS_EVIDENCE_FIELDS = new Set(["reference", "sha256"]);
const PRODUCTION_MEDIA_ARTIFACT_FIELDS = Object.freeze([
  "owned_programme",
  "narration_audio",
  "final_mp4",
]);
const PACKET_REQUEST_FIELDS = new Set([
  "runway_lock",
  "runway_binding",
  "eligibility_attestation",
  "preparation_manifest",
  "repos",
  "env",
  "workspace_root",
  "attempt_output_root",
  "publisher_lease",
  "resolve_media_path",
  "channel",
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const JSON_ARTIFACT_FIELDS = new Set(
  STATIC_ARTIFACT_FIELDS.filter(
    (field) =>
      !["owned_programme", "narration_audio", "final_mp4"].includes(field),
  ),
);

class AutonomousOfficialJitAdmissionPacketError extends Error {
  constructor(code) {
    super(code);
    this.name = "AutonomousOfficialJitAdmissionPacketError";
    this.code = code;
  }
}

function fail(code) {
  throw new AutonomousOfficialJitAdmissionPacketError(code);
}

function text(value) {
  return String(value ?? "").trim();
}

function object(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactFields(value, fields, code) {
  if (!object(value)) fail(code);
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

function preparationFields(value, manifest = false) {
  const hasFastNewsDecision =
    object(value) &&
    Object.hasOwn(value, "fast_news_lane_decision");
  if (manifest) {
    return hasFastNewsDecision
      ? PREPARATION_FIELDS_WITH_FAST_NEWS
      : PREPARATION_FIELDS;
  }
  return hasFastNewsDecision
    ? PREPARATION_INPUT_FIELDS_WITH_FAST_NEWS
    : PREPARATION_INPUT_FIELDS;
}

function exactSha256(value, code) {
  const hash = text(value).toLowerCase();
  if (!SHA256_PATTERN.test(hash)) fail(code);
  return hash;
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

function canonicalSha256(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
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

async function prepareWorkspaceRoot(workspaceRoot, fileSystem) {
  const supplied = text(workspaceRoot);
  if (!supplied) fail("autonomous_jit_workspace_required");
  const resolved = path.resolve(supplied);
  let stat;
  try {
    stat = await fileSystem.lstat(resolved, { bigint: true });
  } catch {
    fail("autonomous_jit_workspace_invalid");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("autonomous_jit_workspace_invalid");
  }
  const real = await fileSystem.realpath(resolved);
  if (path.resolve(real) !== resolved) {
    fail("autonomous_jit_workspace_link_forbidden");
  }
  return { resolved, real };
}

async function assertContainedPath(workspace, candidate, fileSystem, code) {
  if (!pathWithin(workspace.resolved, candidate)) {
    fail(`${code}_outside_workspace`);
  }
  const relative = path.relative(workspace.resolved, candidate);
  let cursor = workspace.resolved;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    let stat;
    try {
      stat = await fileSystem.lstat(cursor, { bigint: true });
    } catch {
      fail(`${code}_read_failed`);
    }
    if (stat.isSymbolicLink()) fail(`${code}_path_link_forbidden`);
    const real = await fileSystem.realpath(cursor);
    if (!pathWithin(workspace.real, real)) {
      fail(`${code}_outside_workspace`);
    }
  }
}

function sameFileIdentity(left, right) {
  return (
    left.isFile() &&
    right.isFile() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs
  );
}

async function readExactPlanFile({
  workspace,
  reference,
  field,
  json,
  optionalJson = false,
  fileSystem,
}) {
  const resolved = path.resolve(workspace.resolved, reference.path);
  await assertContainedPath(
    workspace,
    resolved,
    fileSystem,
    `autonomous_jit_plan_${field}`,
  );
  const initial = await fileSystem.lstat(resolved, {
    bigint: true,
  });
  if (
    !initial.isFile() ||
    initial.isSymbolicLink() ||
    initial.size <= 0n ||
    initial.size > BigInt(Number.MAX_SAFE_INTEGER) ||
    (json && initial.size > 16n * 1024n * 1024n)
  ) {
    fail(`autonomous_jit_plan_${field}_file_invalid`);
  }
  const realPath = await fileSystem.realpath(resolved);
  if (!pathWithin(workspace.real, realPath)) {
    fail(`autonomous_jit_plan_${field}_outside_workspace`);
  }
  let handle;
  try {
    handle = await fileSystem.open(resolved, "r");
    const opened = await handle.stat({ bigint: true });
    if (!sameFileIdentity(initial, opened)) {
      fail(`autonomous_jit_plan_${field}_changed_during_read`);
    }
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    const completed = await handle.stat({ bigint: true });
    const finalPathStat = await fileSystem.lstat(resolved, {
      bigint: true,
    });
    const finalRealPath = await fileSystem.realpath(resolved);
    if (
      offset !== bytes.length ||
      !sameFileIdentity(opened, completed) ||
      !sameFileIdentity(opened, finalPathStat) ||
      finalRealPath !== realPath
    ) {
      fail(`autonomous_jit_plan_${field}_changed_during_read`);
    }
    const observedSha256 = crypto
      .createHash("sha256")
      .update(bytes)
      .digest("hex");
    if (observedSha256 !== reference.sha256) {
      fail(`autonomous_jit_plan_${field}_sha256_mismatch`);
    }
    let value = null;
    if (json || optionalJson) {
      try {
        value = JSON.parse(bytes.toString("utf8"));
      } catch {
        if (json) {
          fail(`autonomous_jit_plan_${field}_json_invalid`);
        }
      }
      if (json && !object(value)) {
        fail(`autonomous_jit_plan_${field}_json_invalid`);
      }
    }
    return {
      path: resolved,
      sha256: observedSha256,
      real_path: realPath,
      size_bytes: bytes.length,
      value,
    };
  } finally {
    await handle?.close();
  }
}

function exactTimestamp(value, code) {
  const raw = text(value);
  const parsed = Date.parse(raw);
  if (
    !raw ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== raw
  ) {
    fail(code);
  }
  return raw;
}

function trustedNow(clock) {
  if (typeof clock !== "function") {
    fail("autonomous_jit_packet_trusted_clock_required");
  }
  const value = clock();
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    fail("autonomous_jit_packet_trusted_clock_invalid");
  }
  return date;
}

function normaliseFileReference(value, code) {
  exactFields(value, FILE_REFERENCE_FIELDS, code);
  const filePath = text(value.path);
  if (!filePath) fail(code);
  return {
    path: filePath,
    sha256: exactSha256(value.sha256, code),
  };
}

function normaliseStaticArtifacts(value) {
  exactFields(
    value,
    new Set(STATIC_ARTIFACT_FIELDS),
    "autonomous_jit_preparation_artifacts_invalid",
  );
  return Object.fromEntries(
    STATIC_ARTIFACT_FIELDS.map((field) => [
      field,
      normaliseFileReference(
        value[field],
        `autonomous_jit_preparation_${field}_invalid`,
      ),
    ]),
  );
}

function normaliseOwnedAssets(value) {
  if (!Array.isArray(value)) {
    fail("autonomous_jit_preparation_owned_assets_invalid");
  }
  const seen = new Set();
  const assets = value.map((asset) => {
    exactFields(
      asset,
      OWNED_ASSET_FIELDS,
      "autonomous_jit_preparation_owned_asset_invalid",
    );
    const assetId = text(asset.asset_id);
    if (!assetId || seen.has(assetId)) {
      fail("autonomous_jit_preparation_owned_asset_id_invalid");
    }
    seen.add(assetId);
    const reference = normaliseFileReference(
      { path: asset.path, sha256: asset.sha256 },
      "autonomous_jit_preparation_owned_asset_invalid",
    );
    return {
      asset_id: assetId,
      ...reference,
    };
  });
  assets.sort((left, right) => left.asset_id.localeCompare(right.asset_id));
  return assets;
}

function normaliseGateInput(value) {
  exactFields(
    value,
    GATE_INPUT_FIELDS,
    "autonomous_jit_preparation_gate_input_invalid",
  );
  for (const field of ["originality_transformation", "rights_ledger"]) {
    if (!object(value[field])) {
      fail("autonomous_jit_preparation_gate_input_invalid");
    }
  }
  exactFields(
    value.rights_ledger,
    RIGHTS_LEDGER_FIELDS,
    "autonomous_jit_preparation_rights_ledger_fields_invalid",
  );
  if (!Array.isArray(value.rights_ledger.items)) {
    fail("autonomous_jit_preparation_rights_ledger_items_invalid");
  }
  for (const item of value.rights_ledger.items) {
    exactFields(
      item,
      RIGHTS_ITEM_FIELDS,
      "autonomous_jit_preparation_rights_item_fields_invalid",
    );
    exactFields(
      item.rights_evidence,
      RIGHTS_EVIDENCE_FIELDS,
      "autonomous_jit_preparation_rights_evidence_fields_invalid",
    );
  }
  const disclosure = value.synthetic_media_disclosure;
  exactFields(
    disclosure,
    SYNTHETIC_DISCLOSURE_FIELDS,
    "autonomous_jit_preparation_synthetic_disclosure_invalid",
  );
  const provenance = disclosure.decision_provenance;
  exactFields(
    provenance,
    SYSTEM_POLICY_PROVENANCE_FIELDS,
    "autonomous_jit_preparation_synthetic_disclosure_provenance_invalid",
  );
  const evaluatedAt = exactTimestamp(
    provenance.evaluated_at,
    "autonomous_jit_preparation_synthetic_disclosure_time_invalid",
  );
  const policyBasis = text(disclosure.policy_basis).toUpperCase();
  if (
    disclosure.decision_authority !== "SYSTEM_POLICY" ||
    !text(provenance.policy_id) ||
    !text(provenance.policy_version) ||
    typeof disclosure.altered_content !== "boolean" ||
    !["DISCLOSE", "NO_DISCLOSURE_REQUIRED"].includes(policyBasis) ||
    typeof disclosure.youtube_field_value !== "boolean" ||
    disclosure.youtube_field_value !== (policyBasis === "DISCLOSE")
  ) {
    fail("autonomous_jit_preparation_synthetic_disclosure_provenance_invalid");
  }
  const normalisedDisclosure = {
    decision_authority: "SYSTEM_POLICY",
    decision_provenance: {
      policy_id: text(provenance.policy_id),
      policy_version: text(provenance.policy_version),
      evaluated_at: evaluatedAt,
      evidence_sha256: exactSha256(
        provenance.evidence_sha256,
        "autonomous_jit_preparation_synthetic_disclosure_provenance_invalid",
      ),
    },
    altered_content: disclosure.altered_content,
    policy_basis: policyBasis,
    youtube_field_value: disclosure.youtube_field_value,
  };
  return stableValue({
    originality_transformation: value.originality_transformation,
    rights_ledger: value.rights_ledger,
    rights_ledger_sha256: exactSha256(
      value.rights_ledger_sha256,
      "autonomous_jit_preparation_rights_sha256_invalid",
    ),
    synthetic_media_disclosure: normalisedDisclosure,
  });
}

function assertRightsEvidenceCommercialScope(value) {
  if (!object(value)) return;
  if (value.schema_version === MONETISATION_RIGHTS_EVIDENCE_SCHEMA_VERSION) {
    if (
      text(value.platform_advertising).toUpperCase() !== "CLEARED" ||
      text(value.sponsorship).toUpperCase() !== "NOT_ESTABLISHED" ||
      text(value.affiliate_promotion).toUpperCase() !== "NOT_ESTABLISHED" ||
      text(value.paid_access).toUpperCase() !== "NOT_ESTABLISHED" ||
      text(value.client_production).toUpperCase() !== "NOT_ESTABLISHED"
    ) {
      fail("autonomous_jit_plan_rights_commercial_scope_widening");
    }
  }
  const visit = (candidate) => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    for (const [field, fieldValue] of Object.entries(candidate)) {
      const key = field.toLowerCase();
      if (
        [
          "sponsorship",
          "sponsor_use",
          "affiliate",
          "affiliate_promotion",
          "paid_access",
          "client_use",
          "client_production",
        ].includes(key) &&
        text(fieldValue).toUpperCase() !== "NOT_ESTABLISHED"
      ) {
        fail("autonomous_jit_plan_rights_commercial_scope_widening");
      }
      if (["allowed_revenue_modes", "revenue_modes_allowed"].includes(key)) {
        if (
          !Array.isArray(fieldValue) ||
          fieldValue.some(
            (mode) => text(mode).toUpperCase() !== "PLATFORM_ADVERTISING",
          )
        ) {
          fail("autonomous_jit_plan_rights_commercial_scope_widening");
        }
      }
      visit(fieldValue);
    }
  };
  visit(value);
}

async function resolveIncludedRightsEvidence({
  manifest,
  workspace,
  artifacts,
  ownedVisualAssets,
  fileSystem,
}) {
  const productionAssetSha256 = new Set([
    ...PRODUCTION_MEDIA_ARTIFACT_FIELDS.map((field) => artifacts[field].sha256),
    ...ownedVisualAssets.map((asset) => asset.sha256),
  ]);
  const includedItems =
    manifest.publication_evidence_gate_input.rights_ledger.items.filter(
      (item) => item.included_in_final === true,
    );
  const resolved = [];
  for (let index = 0; index < includedItems.length; index += 1) {
    const item = includedItems[index];
    const assetSha256 = exactSha256(
      item.asset_sha256,
      "autonomous_jit_plan_rights_asset_sha256_invalid",
    );
    if (!productionAssetSha256.has(assetSha256)) {
      fail("autonomous_jit_plan_rights_asset_not_resolved");
    }
    const reference = {
      path: text(item.rights_evidence.reference),
      sha256: exactSha256(
        item.rights_evidence.sha256,
        "autonomous_jit_plan_rights_evidence_invalid",
      ),
    };
    if (!reference.path) {
      fail("autonomous_jit_plan_rights_evidence_invalid");
    }
    const observation = await readExactPlanFile({
      workspace,
      reference,
      field: `rights_evidence_${index}`,
      json: false,
      optionalJson: true,
      fileSystem,
    });
    assertRightsEvidenceCommercialScope(observation.value);
    resolved.push({
      item_id: text(item.item_id),
      asset_sha256: assetSha256,
      path: observation.path,
      sha256: observation.sha256,
      real_path: observation.real_path,
      size_bytes: observation.size_bytes,
    });
  }
  return resolved;
}

function buildAutonomousGreenRightsBridge({
  manifest,
  artifacts,
}) {
  const supplement = artifacts.autonomous_green_supplement.value;
  if (!object(supplement) || !Array.isArray(supplement.media_items)) {
    fail("autonomous_jit_plan_green_rights_bridge_invalid");
  }
  const normaliseItems = (items, source) => {
    const seenItemIds = new Set();
    const seenAssetSha256 = new Set();
    const normalised = [];
    for (const item of items) {
      if (!object(item) || item.included_in_final !== true) {
        fail("autonomous_jit_plan_green_rights_bridge_invalid");
      }
      const itemId = text(item.item_id);
      const assetSha256 = exactSha256(
        item.asset_sha256,
        "autonomous_jit_plan_green_rights_bridge_invalid",
      );
      if (
        !itemId ||
        seenItemIds.has(itemId) ||
        seenAssetSha256.has(assetSha256)
      ) {
        fail("autonomous_jit_plan_green_rights_bridge_invalid");
      }
      seenItemIds.add(itemId);
      seenAssetSha256.add(assetSha256);
      normalised.push({
        item_id: itemId,
        asset_sha256: assetSha256,
        source,
      });
    }
    if (!normalised.length) {
      fail("autonomous_jit_plan_green_rights_bridge_invalid");
    }
    return normalised.sort(
      (left, right) =>
        left.item_id.localeCompare(right.item_id) ||
        left.asset_sha256.localeCompare(right.asset_sha256),
    );
  };
  const supplementItems = normaliseItems(
    supplement.media_items,
    "AUTONOMOUS_GREEN_SUPPLEMENT",
  );
  const publicationGateItems = normaliseItems(
    manifest.publication_evidence_gate_input.rights_ledger.items.filter(
      (item) => item.included_in_final === true,
    ),
    "PUBLICATION_GATE_RIGHTS_LEDGER",
  );
  const stripSource = (items) =>
    items.map(({ item_id, asset_sha256 }) => ({
      item_id,
      asset_sha256,
    }));
  const supplementBindings = stripSource(supplementItems);
  const publicationGateBindings = stripSource(publicationGateItems);
  if (
    JSON.stringify(supplementBindings) !==
    JSON.stringify(publicationGateBindings)
  ) {
    fail("autonomous_jit_plan_green_rights_bridge_mismatch");
  }
  return Object.freeze({
    item_count: supplementBindings.length,
    item_bindings_sha256: canonicalSha256(supplementBindings),
    autonomous_green_supplement_sha256:
      artifacts.autonomous_green_supplement.sha256,
    publication_gate_rights_ledger_sha256:
      manifest.publication_evidence_gate_input.rights_ledger_sha256,
  });
}

function normalisePreparationBody(value) {
  const storyId = text(value.story_id);
  const role = text(value.role).toUpperCase();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(storyId)) {
    fail("autonomous_jit_preparation_story_invalid");
  }
  if (
    text(value.channel_id) !== "pulse-gaming" ||
    text(value.lane_id) !== "breaking_short" ||
    text(value.platform).toLowerCase() !== "youtube" ||
    !["PRIMARY", "STANDBY"].includes(role)
  ) {
    fail("autonomous_jit_preparation_scope_invalid");
  }
  const scheduledFor = exactTimestamp(
    value.scheduled_for,
    "autonomous_jit_preparation_schedule_invalid",
  );
  let fastNewsLaneDecision;
  if (Object.hasOwn(value, "fast_news_lane_decision")) {
    try {
      fastNewsLaneDecision =
        validateGovernedFastNewsLaneDecision(
          value.fast_news_lane_decision,
        );
    } catch {
      fail(
        "autonomous_jit_preparation_fast_news_lane_decision_invalid",
      );
    }
    if (fastNewsLaneDecision.scheduled_for !== scheduledFor) {
      fail(
        "autonomous_jit_preparation_fast_news_lane_decision_mismatch",
      );
    }
  }
  return {
    schema_version: PREPARATION_SCHEMA_VERSION,
    story_id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: scheduledFor,
    role,
    candidate_revision_sha256: exactSha256(
      value.candidate_revision_sha256,
      "autonomous_jit_preparation_candidate_revision_invalid",
    ),
    request_fingerprint: exactSha256(
      value.request_fingerprint,
      "autonomous_jit_preparation_request_fingerprint_invalid",
    ),
    artifacts: normaliseStaticArtifacts(value.artifacts),
    owned_visual_assets: normaliseOwnedAssets(value.owned_visual_assets),
    publication_evidence_gate_input: normaliseGateInput(
      value.publication_evidence_gate_input,
    ),
    ...(fastNewsLaneDecision
      ? { fast_news_lane_decision: fastNewsLaneDecision }
      : {}),
  };
}

function createAutonomousOfficialJitPreparationManifest(value = {}) {
  exactFields(
    value,
    preparationFields(value),
    "autonomous_jit_preparation_fields_invalid",
  );
  const body = normalisePreparationBody(value);
  return Object.freeze({
    ...body,
    preparation_sha256: canonicalSha256(body),
  });
}

function validateAutonomousOfficialJitPreparationManifest(value) {
  exactFields(
    value,
    preparationFields(value, true),
    "autonomous_jit_preparation_fields_invalid",
  );
  if (value.schema_version !== PREPARATION_SCHEMA_VERSION) {
    fail("autonomous_jit_preparation_schema_invalid");
  }
  const body = normalisePreparationBody(value);
  const preparationSha256 = exactSha256(
    value.preparation_sha256,
    "autonomous_jit_preparation_sha256_invalid",
  );
  if (canonicalSha256(body) !== preparationSha256) {
    fail("autonomous_jit_preparation_sha256_mismatch");
  }
  return JSON.parse(
    JSON.stringify({
      ...body,
      preparation_sha256: preparationSha256,
    }),
  );
}

async function resolveAutonomousOfficialJitPreparationPlan(
  value,
  options = {},
) {
  const manifest = validateAutonomousOfficialJitPreparationManifest(value);
  const fileSystem = options.fileSystem || defaultFileSystem;
  const workspace = await prepareWorkspaceRoot(
    options.workspaceRoot,
    fileSystem,
  );
  const artifacts = {};
  for (const field of STATIC_ARTIFACT_FIELDS) {
    artifacts[field] = await readExactPlanFile({
      workspace,
      reference: manifest.artifacts[field],
      field,
      json: JSON_ARTIFACT_FIELDS.has(field),
      fileSystem,
    });
  }
  const ownedVisualAssets = [];
  for (let index = 0; index < manifest.owned_visual_assets.length; index += 1) {
    const asset = manifest.owned_visual_assets[index];
    const observed = await readExactPlanFile({
      workspace,
      reference: asset,
      field: `owned_visual_asset_${index}`,
      json: false,
      fileSystem,
    });
    ownedVisualAssets.push({
      asset_id: asset.asset_id,
      ...observed,
    });
  }
  const rightsBridge = buildAutonomousGreenRightsBridge({
    manifest,
    artifacts,
  });
  const rightsEvidence = await resolveIncludedRightsEvidence({
    manifest,
    workspace,
    artifacts,
    ownedVisualAssets,
    fileSystem,
  });
  return Object.freeze({
    schema_version: RESOLVED_PLAN_SCHEMA_VERSION,
    preparation_sha256: manifest.preparation_sha256,
    workspace_root: workspace.resolved,
    artifacts,
    owned_visual_assets: ownedVisualAssets,
    rights_bridge: rightsBridge,
    rights_evidence: rightsEvidence,
  });
}

async function materialiseAutonomousOfficialJitAdmissionPacket(
  request,
  options = {},
) {
  exactFields(
    request,
    PACKET_REQUEST_FIELDS,
    "autonomous_jit_packet_request_fields_invalid",
  );
  const preparation = validateAutonomousOfficialJitPreparationManifest(
    request.preparation_manifest,
  );
  const now = trustedNow(options.clock);
  const scheduleMs = Date.parse(preparation.scheduled_for);
  if (
    scheduleMs <= now.getTime() ||
    now.getTime() < scheduleMs - JIT_EARLIEST_OFFSET_MS
  ) {
    fail("autonomous_jit_packet_window_invalid");
  }
  if (
    !request.repos?.stories ||
    typeof request.repos.stories.get !== "function" ||
    !request.repos?.runtimeLeases
  ) {
    fail("autonomous_jit_packet_repositories_required");
  }
  if (
    typeof request.resolve_media_path !== "function" ||
    !object(request.channel) ||
    text(request.channel.id) !== "pulse-gaming"
  ) {
    fail("autonomous_jit_packet_publication_context_invalid");
  }
  const story = request.repos.stories.get(preparation.story_id);
  if (
    !story ||
    text(story.id) !== preparation.story_id ||
    text(story.channel_id || "pulse-gaming") !== "pulse-gaming" ||
    !text(story.full_script) ||
    !text(story.exported_path)
  ) {
    fail("autonomous_jit_packet_canonical_story_invalid");
  }

  const validateRunwayLock =
    options.validateRunwayLock ||
    require("./governed-youtube-release-runway").validateLock;
  const lockBlockers = validateRunwayLock(request.runway_lock);
  if (!Array.isArray(lockBlockers) || lockBlockers.length !== 0) {
    fail(lockBlockers?.[0] || "autonomous_jit_packet_runway_lock_invalid");
  }
  const lockSha256 = exactSha256(
    request.runway_lock.lock_sha256,
    "autonomous_jit_packet_runway_lock_sha256_invalid",
  );
  const lockBody = { ...request.runway_lock };
  delete lockBody.lock_sha256;
  if (canonicalSha256(lockBody) !== lockSha256) {
    fail("autonomous_jit_packet_runway_lock_sha256_mismatch");
  }
  if (
    text(request.runway_lock.scheduled_for) !== preparation.scheduled_for ||
    request.runway_lock.publish_authority !== false
  ) {
    fail("autonomous_jit_packet_runway_window_mismatch");
  }
  const selectedRole = preparation.role === "PRIMARY" ? "primary" : "reserve";
  const lockedBinding = request.runway_lock[selectedRole];
  if (
    !object(request.runway_binding) ||
    !object(lockedBinding) ||
    canonicalSha256(request.runway_binding) !== canonicalSha256(lockedBinding)
  ) {
    fail("autonomous_jit_packet_runway_binding_mismatch");
  }
  const binding = request.runway_binding;
  for (const [actual, expected, code] of [
    [
      text(binding.story_id),
      preparation.story_id,
      "autonomous_jit_packet_story_mismatch",
    ],
    [
      text(binding.lane_id),
      preparation.lane_id,
      "autonomous_jit_packet_lane_mismatch",
    ],
    [
      text(binding.candidate_revision_sha256).toLowerCase(),
      preparation.candidate_revision_sha256,
      "autonomous_jit_packet_candidate_revision_mismatch",
    ],
    [
      text(binding.request_fingerprint).toLowerCase(),
      preparation.request_fingerprint,
      "autonomous_jit_packet_request_fingerprint_mismatch",
    ],
    [
      text(binding.jit_preparation_sha256).toLowerCase(),
      preparation.preparation_sha256,
      "autonomous_jit_packet_preparation_mismatch",
    ],
  ]) {
    if (actual !== expected) fail(code);
  }
  if (
    text(binding.approval_type) !== AUTHORITY_TYPE ||
    Object.hasOwn(binding, "operator") ||
    Object.hasOwn(binding, "human_review_status") ||
    Object.hasOwn(binding, "human_review_audit_id")
  ) {
    fail("autonomous_jit_packet_approval_scope_invalid");
  }

  const validateEligibilityAttestation =
    options.validateEligibilityAttestation ||
    require("./governed-youtube-release-runway")
      .validateAutonomousWindowEligibilityAttestation;
  const validatedAttestation = validateEligibilityAttestation(
    request.eligibility_attestation,
    {
      now,
      expected: {
        story_id: preparation.story_id,
        channel_id: preparation.channel_id,
        lane_id: preparation.lane_id,
        platform: preparation.platform,
        scheduled_for: preparation.scheduled_for,
        role: preparation.role,
        candidate_binding_sha256: binding.candidate_binding_sha256,
        evidence_hashes: {
          media_sha256: binding.media_sha256,
          script_sha256: binding.script_sha256,
          qa_report_sha256: binding.qa_report_sha256,
          rights_ledger_sha256: binding.rights_ledger_sha256,
          source_evidence_sha256: binding.source_evidence_sha256,
        },
        jit_preparation: preparation,
      },
    },
  );
  const attestationSha256 = exactSha256(
    validatedAttestation.attestation_sha256,
    "autonomous_jit_packet_attestation_sha256_invalid",
  );
  if (
    text(binding.autonomous_eligibility_attestation_sha256).toLowerCase() !==
      attestationSha256 ||
    text(validatedAttestation.jit_preparation_sha256).toLowerCase() !==
      preparation.preparation_sha256 ||
    validatedAttestation.admission_authorised !== false ||
    validatedAttestation.operational_publish_authority !== false ||
    validatedAttestation.dispatch_authorised !== false ||
    validatedAttestation.external_publish_authorised !== false
  ) {
    fail("autonomous_jit_packet_attestation_binding_mismatch");
  }

  const resolvedPlan = await resolveAutonomousOfficialJitPreparationPlan(
    preparation,
    {
      workspaceRoot: request.workspace_root,
      fileSystem: options.fileSystem,
    },
  );
  for (const [actual, expected, code] of [
    [
      resolvedPlan.artifacts.final_mp4.sha256,
      text(binding.media_sha256).toLowerCase(),
      "autonomous_jit_packet_media_sha256_mismatch",
    ],
    [
      resolvedPlan.artifacts.deterministic_qa.sha256,
      text(binding.qa_report_sha256).toLowerCase(),
      "autonomous_jit_packet_qa_sha256_mismatch",
    ],
    [
      resolvedPlan.artifacts.source_evidence.sha256,
      text(binding.source_evidence_sha256).toLowerCase(),
      "autonomous_jit_packet_source_sha256_mismatch",
    ],
    [
      preparation.publication_evidence_gate_input.rights_ledger_sha256,
      text(binding.rights_ledger_sha256).toLowerCase(),
      "autonomous_jit_packet_rights_sha256_mismatch",
    ],
  ]) {
    if (actual !== expected) fail(code);
  }

  const gateInput = preparation.publication_evidence_gate_input;
  const assessment = assessPublicationEvidence(gateInput);
  if (assessment.eligible !== true) {
    fail(
      assessment.blockers?.[0] ||
        "autonomous_jit_packet_publication_evidence_not_green",
    );
  }
  const sourceEvidence = resolvedPlan.artifacts.source_evidence.value;
  const publicationMetadata = resolvedPlan.artifacts.publication_metadata.value;
  const officialSourceReleaseBinding = buildOfficialSourceReleaseBinding({
    storyId: preparation.story_id,
    sourceEvidenceSha256: resolvedPlan.artifacts.source_evidence.sha256,
    sourceEvidence,
  });
  const rawPublicationEvidence = {
    source_evidence_sha256: resolvedPlan.artifacts.source_evidence.sha256,
    official_source_release_binding: officialSourceReleaseBinding,
    qa_report_sha256: resolvedPlan.artifacts.deterministic_qa.sha256,
    publication_metadata_sha256:
      resolvedPlan.artifacts.publication_metadata.sha256,
    publication_metadata: {
      path: resolvedPlan.artifacts.publication_metadata.path,
      sha256: resolvedPlan.artifacts.publication_metadata.sha256,
      platform: text(publicationMetadata.platform),
      title: text(publicationMetadata.title),
      description: text(publicationMetadata.description),
    },
    renderer_manifest: resolvedPlan.artifacts.renderer_manifest.value,
    ...gateInput,
  };
  const operatingContract = resolveOperatingContract({
    env: request.env,
  });
  const publicationEvidence = buildImmutablePublicationEvidence({
    evidence: rawPublicationEvidence,
    evidenceAssessment: assessment,
    operatingMode: operatingContract.mode,
  });
  const resolvedCanonicalMedia = await request.resolve_media_path(
    story.exported_path,
  );
  const canonicalMediaPath = path.resolve(
    resolvedPlan.workspace_root,
    text(resolvedCanonicalMedia),
  );
  let canonicalMediaRealPath;
  try {
    canonicalMediaRealPath = await (
      options.fileSystem || defaultFileSystem
    ).realpath(canonicalMediaPath);
  } catch {
    fail("autonomous_jit_packet_canonical_media_invalid");
  }
  if (canonicalMediaRealPath !== resolvedPlan.artifacts.final_mp4.real_path) {
    fail("autonomous_jit_packet_canonical_media_mismatch");
  }
  const fingerprint = await fingerprintPublicationRequest(story, {
    channelId: preparation.channel_id,
    platform: preparation.platform,
    resolveMediaPath: async () => resolvedPlan.artifacts.final_mp4.real_path,
    channel: request.channel,
    publicationEvidence,
  });
  for (const [actual, expected, code] of [
    [
      fingerprint.request_fingerprint,
      preparation.request_fingerprint,
      "autonomous_jit_packet_request_fingerprint_mismatch",
    ],
    [
      fingerprint.media_sha256,
      text(binding.media_sha256).toLowerCase(),
      "autonomous_jit_packet_media_sha256_mismatch",
    ],
    [
      fingerprint.script_sha256,
      text(binding.script_sha256).toLowerCase(),
      "autonomous_jit_packet_script_sha256_mismatch",
    ],
  ]) {
    if (actual !== expected) fail(code);
  }

  const workspace = await prepareWorkspaceRoot(
    request.workspace_root,
    options.fileSystem || defaultFileSystem,
  );
  const attemptOutputRoot = path.resolve(
    workspace.resolved,
    text(request.attempt_output_root),
  );
  if (
    !pathWithin(workspace.resolved, attemptOutputRoot) ||
    !/^attempt-[A-Za-z0-9._-]+$/.test(path.basename(attemptOutputRoot))
  ) {
    fail("autonomous_jit_packet_attempt_root_invalid");
  }
  try {
    await (options.fileSystem || defaultFileSystem).lstat(attemptOutputRoot);
    fail("autonomous_jit_packet_attempt_replay_forbidden");
  } catch (error) {
    if (error instanceof AutonomousOfficialJitAdmissionPacketError) {
      throw error;
    }
    if (error?.code !== "ENOENT") throw error;
  }

  const controlResult = await materialiseAutonomousAdmissionControlProofs(
    {
      storyId: preparation.story_id,
      channelId: preparation.channel_id,
      workspaceRoot: workspace.resolved,
      outputDir: path.join(attemptOutputRoot, "control-proofs"),
      repos: request.repos,
      env: request.env,
      publisherLease: request.publisher_lease,
    },
    {
      clock: options.clock,
      fileSystem: options.fileSystem,
    },
  );
  const fullArtifacts = Object.fromEntries(
    STATIC_ARTIFACT_FIELDS.map((field) => [
      field,
      {
        path: resolvedPlan.artifacts[field].path,
        sha256: resolvedPlan.artifacts[field].sha256,
      },
    ]),
  );
  fullArtifacts.kill_switch_proof = controlResult.kill_switch_proof;
  fullArtifacts.single_owner_proof = controlResult.single_owner_proof;
  const sourceReportPath = path.join(
    attemptOutputRoot,
    "official-source-evidence.json",
  );
  const materialisedEvidence =
    await materialiseAutonomousOfficialSourceEvidence(
      {
        schema_version: APPLY_REQUEST_SCHEMA_VERSION,
        mode: "LOCAL_PROOF",
        story_id: preparation.story_id,
        artifacts: fullArtifacts,
        owned_visual_assets: resolvedPlan.owned_visual_assets.map((asset) => ({
          asset_id: asset.asset_id,
          path: asset.path,
          sha256: asset.sha256,
        })),
        report_path: sourceReportPath,
      },
      {
        clock: options.clock,
        fileSystem: options.fileSystem,
        fetchCapture: options.fetchCapture,
        workspaceRoot: workspace.resolved,
      },
    );
  if (
    materialisedEvidence.status !== "APPLIED" ||
    materialisedEvidence.idempotent !== false
  ) {
    fail("autonomous_jit_packet_source_report_replay_forbidden");
  }
  const fileSystem = options.fileSystem || defaultFileSystem;
  const reportBytes = await fileSystem.readFile(
    materialisedEvidence.report_path,
  );
  const reportFileSha256 = crypto
    .createHash("sha256")
    .update(reportBytes)
    .digest("hex");
  const authority = await createAutonomousOfficialPublicationAuthority(
    {
      source_report: {
        path: materialisedEvidence.report_path,
        file_sha256: reportFileSha256,
      },
      binding: {
        story_id: preparation.story_id,
        channel_id: preparation.channel_id,
        lane_id: preparation.lane_id,
        platform: preparation.platform,
        scheduled_for: preparation.scheduled_for,
        runway_lock_sha256: lockSha256,
        dispatch_idempotency_key: `youtube:${preparation.story_id}:${preparation.scheduled_for}`,
        request_fingerprint: fingerprint.request_fingerprint,
      },
      publication_evidence: publicationEvidence,
      publication_evidence_gate_input: gateInput,
      admission_controls: {
        kill_switch_proof_sha256: controlResult.kill_switch_proof.sha256,
        kill_switch_checked_at: controlResult.generated_at,
        single_owner_proof_sha256: controlResult.single_owner_proof.sha256,
        single_owner_checked_at: controlResult.generated_at,
      },
    },
    {
      clock: options.clock,
      fileSystem,
    },
  );
  return Object.freeze({
    schema_version: RESULT_SCHEMA_VERSION,
    verdict: "GREEN",
    generated_at: authority.issued_at,
    valid_until: authority.valid_until,
    story_id: preparation.story_id,
    role: preparation.role,
    candidate_revision_sha256: preparation.candidate_revision_sha256,
    preparation_sha256: preparation.preparation_sha256,
    eligibility_attestation_sha256: attestationSha256,
    runway_lock_sha256: lockSha256,
    request_fingerprint: fingerprint.request_fingerprint,
    source_report: {
      path: materialisedEvidence.report_path,
      file_sha256: reportFileSha256,
      report_sha256: materialisedEvidence.report.report_sha256,
      request_sha256: materialisedEvidence.report.request_sha256,
      generated_at: materialisedEvidence.report.generated_at,
      valid_until: materialisedEvidence.report.valid_until,
    },
    control_proofs: {
      kill_switch: controlResult.kill_switch_proof,
      single_owner: controlResult.single_owner_proof,
    },
    admission_packet: {
      authority,
      storyId: preparation.story_id,
      channelId: preparation.channel_id,
      laneId: preparation.lane_id,
      platform: preparation.platform,
      scheduledFor: preparation.scheduled_for,
      runwayLockSha256: lockSha256,
      requestFingerprint: fingerprint.request_fingerprint,
      publicationEvidence,
    },
    operational_publish_authority: false,
    dispatch_authorised: false,
    external_publish_authorised: false,
    platform_contacted: false,
    database_mutated: false,
    oauth_or_tokens_mutated: false,
    untrusted_source_content_role: "DATA_ONLY",
    external_source_instructions_authorised: false,
  });
}

module.exports = {
  AutonomousOfficialJitAdmissionPacketError,
  PREPARATION_SCHEMA_VERSION,
  RESOLVED_PLAN_SCHEMA_VERSION,
  RESULT_SCHEMA_VERSION,
  STATIC_ARTIFACT_FIELDS,
  canonicalSha256,
  createAutonomousOfficialJitPreparationManifest,
  materialiseAutonomousOfficialJitAdmissionPacket,
  resolveAutonomousOfficialJitPreparationPlan,
  validateAutonomousOfficialJitPreparationManifest,
};
