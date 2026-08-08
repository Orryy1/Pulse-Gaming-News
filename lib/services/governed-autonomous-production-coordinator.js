"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const {
  validateBreakingSourceEvidencePacket,
} = require("./breaking-source-evidence");
const {
  materializeGovernedLockedStoryIntakeFromInventory,
} = require("./governed-story-intake-inventory-bridge");
const {
  materialiseGovernedOwnedProgrammePack,
} = require("./governed-owned-programme-pack");
const {
  buildGovernedNarrationPlan,
  materializeGovernedNarration,
  validateApplyAuthority,
} = require("./governed-narration-materialize");
const {
  REQUEST_SCHEMA_VERSION:
    ELEVENLABS_RECEIPT_REQUEST_SCHEMA_VERSION,
  materializeElevenLabsCommercialGenerationReceipt,
} = require("./elevenlabs-commercial-generation-receipt");
const {
  executeGovernedFinalComposite,
} = require("./governed-final-composite");
const {
  REQUEST_SCHEMA_VERSION: VISUAL_QA_REQUEST_SCHEMA_VERSION,
  materialiseAutonomousMultimodalVisualQa,
} = require("./autonomous-multimodal-visual-qa-materializer");
const {
  REQUEST_SCHEMA_VERSION: VISUAL_GATE_REQUEST_SCHEMA_VERSION,
  canonicalSha256: visualGateCanonicalSha256,
  materialiseGovernedAutonomousVisualGateDecision,
} = require("./governed-autonomous-visual-gate-decision");
const {
  REQUEST_SCHEMA_VERSION: METADATA_REQUEST_SCHEMA_VERSION,
  materialiseAutonomousPublicationMetadata,
} = require("./autonomous-publication-metadata-materializer");
const {
  AUTONOMOUS_PACKAGE_MANIFEST_SCHEMA_VERSION,
  CLAIM_MAP_SCHEMA_VERSION,
  FINAL_MEDIA_INVENTORY_SCHEMA_VERSION,
  MEDIA_RIGHTS_EVIDENCE_SCHEMA_VERSION,
  PROMPT_INJECTION_CONTROL_SCHEMA_VERSION,
  REQUEST_SCHEMA_VERSION: GREEN_SUPPLEMENT_REQUEST_SCHEMA_VERSION,
  canonicalSha256,
  materialiseAutonomousGreenSupplement,
} = require("./autonomous-green-supplement-materializer");
const {
  REQUEST_SCHEMA_VERSION: CANDIDATE_STAGING_REQUEST_SCHEMA_VERSION,
  stageAutonomousOfficialCandidate,
} = require("./autonomous-official-candidate-staging");
const {
  validateAutonomousOfficialJitPreparationManifest,
} = require("./autonomous-official-jit-admission-packet");
const {
  canonicalHash,
  canonicalUrl,
} = require("./url-canonical");
const {
  validateGovernedAutonomousDatabaseStoryBinding,
} = require("./governed-autonomous-database-story-binding");
const {
  validateGovernedFastNewsLaneDecision,
} = require("./governed-fast-news-lane-decision");
const {
  validateGovernedAutonomousCompiledCandidateBinding,
} = require("./governed-autonomous-compiled-candidate-binding");
const {
  MAXIMUM_NARRATION_TAIL_SECONDS,
  discoverGovernedAutonomousNarrationTimingEvidence,
  materializeGovernedAutonomousNarrationTimingEvidence,
  validateGovernedAutonomousNarrationTimingEvidence,
} = require("./governed-autonomous-narration-timing-evidence");

const REQUEST_SCHEMA_VERSION =
  "pulse-governed-autonomous-production-request-v1";
const RESULT_SCHEMA_VERSION =
  "pulse-governed-autonomous-production-result-v1";
const MODE = "LOCAL_PROOF";
const CHANNEL_ID = "pulse-gaming";
const LANE_ID = "breaking_short";
const PLATFORM = "youtube";
const PLATFORM_METADATA = "youtube_shorts";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const STORY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const REQUEST_FIELDS = Object.freeze([
  "candidate_revision_sha256",
  "candidate_source_root",
  "candidate_workspace_relative_root",
  "creative",
  "disclosure_policy",
  "generated_at",
  "locked_intake",
  "mode",
  "narration",
  "request_fingerprint",
  "role",
  "scheduled_for",
  "schema_version",
  "visual_qa",
  "workspace_root",
]);
const REQUEST_FIELDS_WITH_REVISION = Object.freeze([
  ...REQUEST_FIELDS,
  "candidate_revision",
]);
const LOCKED_INTAKE_FIELDS = Object.freeze([
  "allowed_roots",
  "canonical_identity_url",
  "contract",
  "database_story_binding",
  "experiment_dimensions",
  "final_script",
  "final_script_sha256",
  "freshness",
  "inventory_file_sha256",
  "inventory_path",
  "inventory_root",
  "presentation_claim_bindings",
  "script_claim_bindings",
  "supplemental_official_sources",
  "visual_brief",
]);
const LOCKED_INTAKE_FIELDS_WITH_FAST_NEWS = Object.freeze([
  ...LOCKED_INTAKE_FIELDS,
  "fast_news_lane_decision",
]);
const CREATIVE_FIELDS = Object.freeze([
  "description",
  "official_source_url",
  "required_attributions",
  "scenes",
  "subject_terms",
  "title",
]);
const NARRATION_FIELDS = Object.freeze([
  "model_id",
  "provider",
  "speed",
  "voice_id",
]);
const VISUAL_QA_FIELDS = Object.freeze(["reviewers"]);
const DISCLOSURE_POLICY_FIELDS = Object.freeze([
  "policy_id",
  "policy_version",
]);
const DEPENDENCY_FIELDS = Object.freeze([
  "finalComposite",
  "generateNarration",
  "ownedProgramme",
  "probeNarrationAudio",
  "visualQa",
]);
const DEPENDENCY_FIELDS_WITH_TIMING = Object.freeze([
  ...DEPENDENCY_FIELDS,
  "narrationTimingEvidence",
]);
const GENERATION_RESULT_FIELDS = Object.freeze([
  "credit_report",
  "network_used",
  "post_generation_transform_status",
  "provider",
  "transform_status",
]);
const GENERATION_PROVIDER_FIELDS = Object.freeze([
  "http_status",
  "id",
  "model_id",
  "provider_result",
  "provider_result_recorded",
  "voice_id",
]);
const GENERATION_PROVIDER_RESULT_FIELDS = Object.freeze([
  "byte_length",
  "relative_path",
  "sha256",
]);

class GovernedAutonomousProductionCoordinatorError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "GovernedAutonomousProductionCoordinatorError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, details = {}) {
  throw new GovernedAutonomousProductionCoordinatorError(
    code,
    details,
  );
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

function exactFields(value, expected, code) {
  if (!plainObject(value)) fail(code);
  const actual = Object.keys(value).sort();
  const fields = [...expected].sort();
  if (
    actual.length !== fields.length ||
    actual.some((field, index) => field !== fields[index])
  ) {
    fail(code);
  }
  return value;
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
  return { raw, timestamp };
}

function exactAbsolutePath(value, code) {
  const supplied = text(value);
  if (
    !supplied ||
    !path.isAbsolute(supplied) ||
    path.resolve(supplied) !== supplied
  ) {
    fail(code);
  }
  return supplied;
}

function exactStringList(value, code, { minimum = 0 } = {}) {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.some((entry) => typeof entry !== "string" || !entry.trim())
  ) {
    fail(code);
  }
  const values = value.map((entry) => entry.trim());
  if (new Set(values).size !== values.length) fail(code);
  return values;
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashFile(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeJsonExclusive(filePath, value) {
  const bytes = jsonBytes(value);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, bytes, { flag: "wx" });
  return Object.freeze({
    path: filePath,
    sha256: sha256Bytes(bytes),
    value,
  });
}

async function readJsonBound(filePath, expectedSha256, code) {
  let bytes;
  try {
    bytes = await fsp.readFile(filePath);
  } catch {
    fail(code);
  }
  if (sha256Bytes(bytes) !== expectedSha256) fail(code);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(code);
  }
  return Object.freeze({ path: filePath, sha256: expectedSha256, value });
}

function exactRelativeCandidateRoot(value, storyId) {
  const supplied = text(value).replaceAll("\\", "/");
  if (
    path.posix.normalize(supplied) !== supplied ||
    supplied !== `output/canary/${storyId}`
  ) {
    fail("autonomous_production_candidate_relative_root_invalid");
  }
  return supplied;
}

function normaliseRequest(value) {
  exactFields(
    value,
    Object.hasOwn(value, "candidate_revision")
      ? REQUEST_FIELDS_WITH_REVISION
      : REQUEST_FIELDS,
    "autonomous_production_request_fields_invalid",
  );
  if (
    value.schema_version !== REQUEST_SCHEMA_VERSION ||
    value.mode !== MODE
  ) {
    fail("autonomous_production_local_proof_only");
  }
  const generatedAt = exactTimestamp(
    value.generated_at,
    "autonomous_production_generated_at_invalid",
  );
  const scheduledFor = exactTimestamp(
    value.scheduled_for,
    "autonomous_production_scheduled_for_invalid",
  );
  if (scheduledFor.timestamp <= generatedAt.timestamp) {
    fail("autonomous_production_schedule_expired");
  }
  const role = text(value.role).toUpperCase();
  if (!["PRIMARY", "STANDBY"].includes(role)) {
    fail("autonomous_production_role_invalid");
  }

  exactFields(
    value.locked_intake,
    Object.hasOwn(
      value.locked_intake,
      "fast_news_lane_decision",
    )
      ? LOCKED_INTAKE_FIELDS_WITH_FAST_NEWS
      : LOCKED_INTAKE_FIELDS,
    "autonomous_production_locked_intake_fields_invalid",
  );
  exactFields(
    value.creative,
    CREATIVE_FIELDS,
    "autonomous_production_creative_fields_invalid",
  );
  exactFields(
    value.narration,
    NARRATION_FIELDS,
    "autonomous_production_narration_fields_invalid",
  );
  exactFields(
    value.visual_qa,
    VISUAL_QA_FIELDS,
    "autonomous_production_visual_qa_fields_invalid",
  );
  exactFields(
    value.disclosure_policy,
    DISCLOSURE_POLICY_FIELDS,
    "autonomous_production_disclosure_fields_invalid",
  );

  const finalScript = String(value.locked_intake.final_script ?? "").trim();
  const storyIdentity = (() => {
    let bytes;
    try {
      bytes = fs.readFileSync(value.locked_intake.inventory_path);
    } catch {
      fail("autonomous_production_inventory_unreadable");
    }
    const expectedInventorySha256 = exactSha256(
      value.locked_intake.inventory_file_sha256,
      "autonomous_production_inventory_sha256_invalid",
    );
    if (sha256Bytes(bytes) !== expectedInventorySha256) {
      fail("autonomous_production_inventory_sha256_mismatch");
    }
    let parsed;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      fail("autonomous_production_inventory_unreadable");
    }
    const inventoryStoryId = text(parsed?.story?.id);
    if (!STORY_ID_PATTERN.test(inventoryStoryId)) {
      fail("autonomous_production_story_id_invalid");
    }
    const identityUrl = text(
      value.locked_intake.canonical_identity_url,
    );
    const canonicalIdentityUrl = canonicalUrl(identityUrl);
    if (!canonicalIdentityUrl) {
      fail("autonomous_production_canonical_identity_invalid");
    }
    const canonicalStoryId =
      `official_${canonicalHash(identityUrl)}`;
    const exactOfficialIdentity =
      inventoryStoryId === canonicalStoryId;
    const exactInventorySourceIdentity =
      !inventoryStoryId.startsWith("official_") &&
      canonicalUrl(parsed?.story?.primary_source_url) ===
        canonicalIdentityUrl;
    if (!exactOfficialIdentity && !exactInventorySourceIdentity) {
      fail("autonomous_production_story_identity_binding_invalid");
    }
    return {
      canonical_story_id: canonicalStoryId,
      database_story_id: inventoryStoryId,
    };
  })();
  const storyId = storyIdentity.canonical_story_id;
  if (
    !finalScript ||
    exactSha256(
      value.locked_intake.final_script_sha256,
      "autonomous_production_script_sha256_invalid",
    ) !== sha256Bytes(Buffer.from(finalScript, "utf8"))
  ) {
    fail("autonomous_production_script_binding_invalid");
  }
  let databaseStoryBinding;
  try {
    databaseStoryBinding =
      validateGovernedAutonomousDatabaseStoryBinding(
      value.locked_intake.database_story_binding,
      {
        canonical_story_id: storyId,
        database_story_id:
          storyIdentity.database_story_id,
        canonical_identity_url:
          value.locked_intake.canonical_identity_url,
        inventory_file_sha256:
          value.locked_intake.inventory_file_sha256,
        final_script_sha256:
          value.locked_intake.final_script_sha256,
      },
    );
  } catch {
    fail("autonomous_production_database_story_binding_invalid");
  }
  if (
    value.locked_intake.fast_news_lane_decision !==
    undefined
  ) {
    let decision;
    try {
      decision =
        validateGovernedFastNewsLaneDecision(
          value.locked_intake.fast_news_lane_decision,
        );
    } catch {
      fail("autonomous_production_fast_news_decision_invalid");
    }
    if (
      decision.story_id !==
        databaseStoryBinding.database_story_id ||
      decision.inventory_file_sha256 !==
        value.locked_intake.inventory_file_sha256 ||
      decision.scheduled_for !== scheduledFor.raw
    ) {
      fail(
        "autonomous_production_fast_news_decision_binding_invalid",
      );
    }
  }
  if (
    !Array.isArray(value.locked_intake.allowed_roots) ||
    !value.locked_intake.allowed_roots.length ||
    !Array.isArray(value.locked_intake.script_claim_bindings) ||
    !value.locked_intake.script_claim_bindings.length ||
    !Array.isArray(value.locked_intake.presentation_claim_bindings) ||
    !Array.isArray(value.locked_intake.supplemental_official_sources)
  ) {
    fail("autonomous_production_locked_intake_invalid");
  }
  if (
    !Array.isArray(value.creative.scenes) ||
    !value.creative.scenes.length ||
    typeof value.creative.title !== "string" ||
    typeof value.creative.description !== "string"
  ) {
    fail("autonomous_production_creative_invalid");
  }
  const provider = text(value.narration.provider).toLowerCase();
  const speed = Number(value.narration.speed);
  if (
    provider !== "elevenlabs" ||
    !text(value.narration.voice_id) ||
    !text(value.narration.model_id) ||
    !Number.isFinite(speed) ||
    speed <= 0
  ) {
    fail("autonomous_production_narration_invalid");
  }
  if (
    !Array.isArray(value.visual_qa.reviewers) ||
    value.visual_qa.reviewers.length < 2
  ) {
    fail("autonomous_production_visual_qa_invalid");
  }
  if (
    !text(value.disclosure_policy.policy_id) ||
    !text(value.disclosure_policy.policy_version)
  ) {
    fail("autonomous_production_disclosure_invalid");
  }
  const narration = {
    provider,
    voice_id: text(value.narration.voice_id),
    model_id: text(value.narration.model_id),
    speed,
  };
  const visualQa = structuredClone(value.visual_qa);
  const disclosurePolicy = {
    policy_id: text(value.disclosure_policy.policy_id),
    policy_version: text(value.disclosure_policy.policy_version),
  };
  const carriesFastNewsDecision =
    value.locked_intake.fast_news_lane_decision !==
    undefined;
  if (
    carriesFastNewsDecision &&
    !Object.hasOwn(value, "candidate_revision")
  ) {
    fail("autonomous_production_candidate_revision_required");
  }
  if (Object.hasOwn(value, "candidate_revision")) {
    try {
      validateGovernedAutonomousCompiledCandidateBinding({
        candidate_revision: value.candidate_revision,
        candidate_revision_sha256:
          value.candidate_revision_sha256,
        request_fingerprint: value.request_fingerprint,
        story_id: storyId,
        channel_id: CHANNEL_ID,
        lane_id: LANE_ID,
        platform: PLATFORM,
        scheduled_for: scheduledFor.raw,
        source_evidence_sha256:
          value.candidate_revision
            .primary_source_packet_sha256,
        locked_intake_binding: {
          story_id: storyId,
          locked_intake: value.locked_intake,
        },
        creative_package: value.creative,
        runtime_policy: {
          schema_version:
            "pulse-governed-autonomous-production-runtime-policy-v1",
          mode: MODE,
          generated_at: generatedAt.raw,
          workspace_root: value.workspace_root,
          candidate_source_root:
            value.candidate_source_root,
          narration,
          visual_qa: visualQa,
          disclosure_policy: disclosurePolicy,
          safety: {
            local_proof_only: true,
            database_authority: false,
            database_mutated: false,
            network_authority: false,
            network_used: false,
            oauth_or_token_authority: false,
            oauth_or_tokens_mutated: false,
            platform_contacted: false,
            publish_authority: false,
            scheduler_authority: false,
            external_publish_authorised: false,
          },
        },
      });
    } catch {
      fail("autonomous_production_candidate_revision_invalid");
    }
  }

  return Object.freeze({
    schema_version: REQUEST_SCHEMA_VERSION,
    mode: MODE,
    generated_at: generatedAt.raw,
    scheduled_for: scheduledFor.raw,
    role,
    story_id: storyId,
    candidate_revision_sha256: exactSha256(
      value.candidate_revision_sha256,
      "autonomous_production_candidate_revision_invalid",
    ),
    request_fingerprint: exactSha256(
      value.request_fingerprint,
      "autonomous_production_request_fingerprint_invalid",
    ),
    workspace_root: exactAbsolutePath(
      value.workspace_root,
      "autonomous_production_workspace_root_invalid",
    ),
    candidate_source_root: exactAbsolutePath(
      value.candidate_source_root,
      "autonomous_production_candidate_source_root_invalid",
    ),
    candidate_workspace_relative_root: exactRelativeCandidateRoot(
      value.candidate_workspace_relative_root,
      storyId,
    ),
    ...(value.candidate_revision
      ? {
          candidate_revision: structuredClone(
            value.candidate_revision,
          ),
        }
      : {}),
    locked_intake: structuredClone(value.locked_intake),
    creative: {
      scenes: structuredClone(value.creative.scenes),
      title: value.creative.title.trim(),
      description: value.creative.description.trim(),
      official_source_url: text(value.creative.official_source_url),
      required_attributions: exactStringList(
        value.creative.required_attributions,
        "autonomous_production_attributions_invalid",
      ),
      subject_terms: exactStringList(
        value.creative.subject_terms,
        "autonomous_production_subject_terms_invalid",
        { minimum: 1 },
      ),
    },
    narration,
    visual_qa: visualQa,
    disclosure_policy: disclosurePolicy,
  });
}

function normaliseDependencies(value) {
  exactFields(
    value,
    Object.hasOwn(value, "narrationTimingEvidence")
      ? DEPENDENCY_FIELDS_WITH_TIMING
      : DEPENDENCY_FIELDS,
    "autonomous_production_dependency_fields_invalid",
  );
  if (
    typeof value.generateNarration !== "function" ||
    typeof value.probeNarrationAudio !== "function" ||
    !plainObject(value.ownedProgramme) ||
    !plainObject(value.finalComposite) ||
    !plainObject(value.visualQa)
  ) {
    fail("autonomous_production_dependencies_invalid");
  }
  exactAbsolutePath(
    value.finalComposite.ffmpegPath,
    "autonomous_production_final_composite_ffmpeg_path_invalid",
  );
  let narrationTimingEvidence = null;
  if (Object.hasOwn(value, "narrationTimingEvidence")) {
    exactFields(
      value.narrationTimingEvidence,
      ["state_root"],
      "autonomous_production_narration_timing_dependency_invalid",
    );
    narrationTimingEvidence = {
      state_root: exactAbsolutePath(
        value.narrationTimingEvidence.state_root,
        "autonomous_production_narration_timing_state_root_invalid",
      ),
    };
  }
  return {
    ...value,
    narrationTimingEvidence,
  };
}

async function exactExistingRoot(rootPath, code) {
  let stat;
  try {
    stat = await fsp.lstat(rootPath);
  } catch {
    fail(code);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(code);
  const real = await fsp.realpath(rootPath);
  if (path.resolve(real) !== rootPath) fail(code);
}

async function createOwnedCandidateRoot(candidateRoot) {
  try {
    await fsp.lstat(candidateRoot);
    fail("autonomous_production_candidate_source_exists");
  } catch (error) {
    if (error instanceof GovernedAutonomousProductionCoordinatorError) {
      throw error;
    }
    if (error?.code !== "ENOENT") throw error;
  }
  await fsp.mkdir(path.dirname(candidateRoot), { recursive: true });
  const parentReal = await fsp.realpath(path.dirname(candidateRoot));
  if (path.resolve(parentReal) !== path.dirname(candidateRoot)) {
    fail("autonomous_production_candidate_parent_alias_forbidden");
  }
  await fsp.mkdir(candidateRoot, { recursive: false });
}

function normaliseGenerationResult(value, request) {
  exactFields(
    value,
    GENERATION_RESULT_FIELDS,
    "autonomous_production_generation_result_fields_invalid",
  );
  exactFields(
    value.provider,
    GENERATION_PROVIDER_FIELDS,
    "autonomous_production_generation_provider_invalid",
  );
  const provider = value.provider;
  exactFields(
    provider.provider_result,
    GENERATION_PROVIDER_RESULT_FIELDS,
    "autonomous_production_generation_provider_result_invalid",
  );
  const providerResultRelativePath = text(
    provider.provider_result.relative_path,
  ).replaceAll("\\", "/");
  const providerResultSha256 = exactSha256(
    provider.provider_result.sha256,
    "autonomous_production_generation_provider_result_sha256_invalid",
  );
  const providerResultByteLength = Number(
    provider.provider_result.byte_length,
  );
  if (
    text(provider.id).toLowerCase() !== request.narration.provider ||
    text(provider.model_id) !== request.narration.model_id ||
    text(provider.voice_id) !== request.narration.voice_id ||
    !Number.isInteger(Number(provider.http_status)) ||
    Number(provider.http_status) < 200 ||
    Number(provider.http_status) >= 300 ||
    provider.provider_result_recorded !== true ||
    !providerResultRelativePath ||
    providerResultRelativePath.startsWith("/") ||
    providerResultRelativePath.includes("../") ||
    !Number.isInteger(providerResultByteLength) ||
    providerResultByteLength <= 0 ||
    text(value.transform_status).toUpperCase() !== "COMPLETE" ||
    text(value.post_generation_transform_status).toUpperCase() !==
      "COMPLETE" ||
    typeof value.network_used !== "boolean" ||
    !plainObject(value.credit_report)
  ) {
    fail("autonomous_production_generation_result_invalid");
  }
  return {
    provider: {
      id: request.narration.provider,
      model_id: request.narration.model_id,
      voice_id: request.narration.voice_id,
      http_status: Number(provider.http_status),
      provider_result_recorded: true,
      provider_result: {
        relative_path: providerResultRelativePath,
        sha256: providerResultSha256,
        byte_length: providerResultByteLength,
      },
    },
    credit_report: structuredClone(value.credit_report),
    transform_status: "COMPLETE",
    post_generation_transform_status: "COMPLETE",
    network_used: value.network_used,
  };
}

function commercialScope() {
  return {
    destinations: ["YOUTUBE"],
    revenue_modes: ["ORGANIC", "PLATFORM_ADVERTISING"],
    territory: "WORLDWIDE",
    account_id: "pulse-gaming-youtube",
  };
}

function mediaItem({
  itemId,
  mediaRole,
  assetSha256,
  rightsEvidenceSha256,
  rightsBasis,
  licenceDocumentSha256,
}) {
  return {
    item_id: itemId,
    media_role: mediaRole,
    asset_sha256: assetSha256,
    included_in_final: true,
    rights_decision: "CLEARED",
    rights_basis: rightsBasis,
    rights_evidence_sha256: rightsEvidenceSha256,
    licence_document_sha256: licenceDocumentSha256,
    review_status: "VERIFIED",
    risk_decision: null,
    attribution_decision: "NOT_REQUIRED",
    attribution_text: null,
    scope: commercialScope(),
  };
}

function rightsEvidence({
  storyId,
  itemId,
  mediaRole,
  assetSha256,
  rightsBasis,
  licenceDocumentSha256,
}) {
  return {
    schema_version: MEDIA_RIGHTS_EVIDENCE_SCHEMA_VERSION,
    story_id: storyId,
    channel_id: CHANNEL_ID,
    lane_id: LANE_ID,
    item_id: itemId,
    media_role: mediaRole,
    asset_sha256: assetSha256,
    rights_decision: "CLEARED",
    rights_basis: rightsBasis,
    licence_document_sha256: licenceDocumentSha256,
    review_status: "VERIFIED",
    risk_decision: null,
    attribution_decision: "NOT_REQUIRED",
    attribution_text: null,
    scope: commercialScope(),
  };
}

async function materialiseClaimMap({
  root,
  story,
  sourceEvidence,
  storyIntakeSha256,
  generatedAt,
}) {
  const inventory = new Map(
    sourceEvidence.source_claim_inventory.map((claim) => [
      claim.claim_key,
      claim,
    ]),
  );
  const claims = sourceEvidence.script_claim_bindings.map(
    (binding, index) => {
      const sourceClaims = binding.claim_keys.map((key) => inventory.get(key));
      if (sourceClaims.some((claim) => !claim)) {
        fail("autonomous_production_claim_map_source_missing");
      }
      return {
        claim_id: `script-claim-${index + 1}`,
        claim_text_sha256: exactSha256(
          binding.clause_sha256,
          "autonomous_production_claim_map_clause_invalid",
        ),
        source_evidence_sha256: canonicalSha256(
          sourceClaims.map((claim) => ({
            claim_key: claim.claim_key,
            claim_text_sha256: claim.claim_text_sha256,
            canonical_body_sha256: claim.canonical_body_sha256,
            source_url: claim.source_url,
          })),
        ),
        verification_status: "CONFIRMED",
        script_sections: [index === 0 ? "HOOK" : "BODY"],
      };
    },
  );
  return writeJsonExclusive(path.join(root, "evidence", "claim-map.json"), {
    schema_version: CLAIM_MAP_SCHEMA_VERSION,
    story_id: story.story.id,
    channel_id: CHANNEL_ID,
    lane_id: LANE_ID,
    generated_at: generatedAt,
    source_intake_sha256: storyIntakeSha256,
    script_sha256: story.story.script_sha256,
    claims,
  });
}

async function materialisePromptInjectionProof({
  root,
  story,
  sourceEvidence,
  storyIntakeSha256,
  generatedAt,
}) {
  const signals = [];
  for (const reference of sourceEvidence.lineage.official_source_packets) {
    const expectedSha256 = exactSha256(
      reference.file_sha256,
      "autonomous_production_source_packet_reference_invalid",
    );
    const packet = await readJsonBound(
      path.resolve(reference.path),
      expectedSha256,
      "autonomous_production_source_packet_invalid",
    );
    const validation = validateBreakingSourceEvidencePacket(packet.value);
    if (!validation.valid) {
      fail("autonomous_production_source_packet_invalid");
    }
    for (const source of packet.value.sources || []) {
      if (
        Array.isArray(source?.blockers) &&
        source.blockers.includes("source_prompt_injection_detected")
      ) {
        signals.push(
          `${text(source.source_id) || "unknown-source"}:source_prompt_injection_detected`,
        );
      }
    }
  }
  if (
    signals.length ||
    sourceEvidence.safety?.exact_official_source_claims_only !== true ||
    sourceEvidence.safety
      ?.deterministic_visible_text_transform_only !== true ||
    sourceEvidence.safety?.claims_synthesised !== false ||
    sourceEvidence.safety
      ?.script_is_hash_bound_reviewed_paraphrase !== true
  ) {
    fail("autonomous_production_prompt_injection_hold");
  }
  return writeJsonExclusive(
    path.join(root, "evidence", "prompt-injection-control.json"),
    {
      schema_version: PROMPT_INJECTION_CONTROL_SCHEMA_VERSION,
      story_id: story.story.id,
      channel_id: CHANNEL_ID,
      lane_id: LANE_ID,
      evaluated_at: generatedAt,
      policy_id: "pulse-untrusted-source-content-v1",
      source_intake_sha256: storyIntakeSha256,
      untrusted_content_treated_as_data: true,
      instructions_followed_from_source: false,
      detected: false,
      signals: [],
      verdict: "PASS",
    },
  );
}

function reference(sourcePath) {
  return {
    source_path: sourcePath,
    sha256: hashFile(sourcePath),
  };
}

function futureNarrationLicenceReference(request) {
  return path.posix.join(
    request.candidate_workspace_relative_root,
    "narration",
    "elevenlabs-generation-receipt.json",
  );
}

function visualFramePlan(targetDurationSeconds) {
  const targetMs = Math.round(targetDurationSeconds * 1000);
  const values = [
    0,
    Math.max(1, Math.floor(targetMs / 2)),
    Math.max(2, targetMs - 500),
  ];
  return values.map((timestamp, index) => ({
    frame_id: `frame-${String(index).padStart(3, "0")}`,
    timestamp_ms: timestamp,
  }));
}

function exactTargetDuration(story) {
  const target = Number(story?.contract?.target_duration_seconds);
  if (!Number.isFinite(target) || target <= 0) {
    fail("autonomous_production_target_duration_invalid");
  }
  return target;
}

function exactAlignmentEnd(alignmentPath) {
  let alignment;
  try {
    alignment = JSON.parse(
      fs.readFileSync(alignmentPath, "utf8"),
    );
  } catch {
    fail("autonomous_production_narration_alignment_invalid");
  }
  const characters = alignment?.characters;
  const starts =
    alignment?.character_start_times_seconds;
  const ends = alignment?.character_end_times_seconds;
  if (
    !Array.isArray(characters) ||
    !Array.isArray(starts) ||
    !Array.isArray(ends) ||
    !characters.length ||
    characters.length !== starts.length ||
    characters.length !== ends.length
  ) {
    fail("autonomous_production_narration_alignment_invalid");
  }
  const end = Number(ends.at(-1));
  if (!Number.isFinite(end) || end <= 0) {
    fail("autonomous_production_narration_alignment_invalid");
  }
  return end;
}

function readMeasuredTimingEvidence({
  contract,
  request,
  providerResultSha256,
  audioSha256,
  alignmentSha256,
  observedDuration,
  alignmentEnd,
}) {
  if (
    contract?.duration_band_id !==
    "what_changes_breaking_flash_18_24"
  ) {
    return null;
  }
  const review = contract.target_duration_review;
  const evidencePath = text(
    review?.narration_timing_evidence_path,
  );
  const expectedFileSha256 = exactSha256(
    review?.narration_timing_evidence_sha256,
    "autonomous_production_narration_timing_sha256_invalid",
  );
  let bytes;
  let evidence;
  try {
    bytes = fs.readFileSync(evidencePath);
    if (sha256Bytes(bytes) !== expectedFileSha256) {
      fail(
        "autonomous_production_narration_timing_sha256_mismatch",
      );
    }
    evidence =
      validateGovernedAutonomousNarrationTimingEvidence(
        JSON.parse(bytes.toString("utf8")),
        {
          storyId: request.story_id,
          legacyStoryId:
            request.locked_intake.database_story_binding
              .database_story_id,
          scriptSha256:
            request.locked_intake.final_script_sha256,
          provider: request.narration,
          providerResultSha256,
          alignmentSha256,
          requireAudioSha256: true,
        },
      );
  } catch (error) {
    if (
      error instanceof
      GovernedAutonomousProductionCoordinatorError
    ) {
      throw error;
    }
    fail("autonomous_production_narration_timing_invalid");
  }
  if (
    evidence.audio.sha256 !== audioSha256 ||
    text(review.narration_provider_result_sha256).toLowerCase() !==
      providerResultSha256 ||
    text(review.narration_alignment_sha256).toLowerCase() !==
      alignmentSha256 ||
    Math.abs(
      evidence.audio.duration_seconds -
        observedDuration,
    ) > 0.05 ||
    Math.abs(
      evidence.alignment.end_seconds - alignmentEnd,
    ) > 0.05 ||
    evidence.target.duration_seconds !==
      Number(contract.target_duration_seconds)
  ) {
    fail("autonomous_production_narration_timing_mismatch");
  }
  return evidence;
}

async function materialiseGovernedAutonomousOfficialCandidate(
  rawRequest,
  rawDependencies,
) {
  const request = normaliseRequest(rawRequest);
  const dependencies = normaliseDependencies(rawDependencies);
  await exactExistingRoot(
    request.workspace_root,
    "autonomous_production_workspace_root_invalid",
  );
  await createOwnedCandidateRoot(request.candidate_source_root);
  let completed = false;
  try {
    const intake = await materializeGovernedLockedStoryIntakeFromInventory({
      inventoryPath: request.locked_intake.inventory_path,
      inventoryFileSha256:
        request.locked_intake.inventory_file_sha256,
      inventoryRoot: request.locked_intake.inventory_root,
      allowedRoots: request.locked_intake.allowed_roots,
      canonicalIdentityUrl:
        request.locked_intake.canonical_identity_url,
      finalScript: request.locked_intake.final_script,
      finalScriptSha256:
        request.locked_intake.final_script_sha256,
      scriptClaimBindings:
        request.locked_intake.script_claim_bindings,
      presentationClaimBindings:
        request.locked_intake.presentation_claim_bindings,
      supplementalOfficialSources:
        request.locked_intake.supplemental_official_sources,
      contract: request.locked_intake.contract,
      freshness: request.locked_intake.freshness,
      visualBrief: request.locked_intake.visual_brief,
      experimentDimensions:
        request.locked_intake.experiment_dimensions,
      outputDir: path.join(request.candidate_source_root, "intake"),
    });
    if (intake.story_id !== request.story_id) {
      fail("autonomous_production_intake_story_mismatch");
    }
    if (
      intake.legacy_story_id !==
        request.locked_intake.database_story_binding
          .database_story_id
    ) {
      fail("autonomous_production_intake_database_story_mismatch");
    }
    const boundIntake = Object.freeze({
      ...intake,
      database_story_binding: structuredClone(
        request.locked_intake.database_story_binding,
      ),
    });
    const storyIntakeSha256 = hashFile(intake.paths.story_intake);
    const sourceEvidenceSha256 = hashFile(intake.paths.source_evidence);
    const story = (
      await readJsonBound(
        intake.paths.story_intake,
        storyIntakeSha256,
        "autonomous_production_story_intake_invalid",
      )
    ).value;
    const sourceEvidence = (
      await readJsonBound(
        intake.paths.source_evidence,
        sourceEvidenceSha256,
        "autonomous_production_source_evidence_invalid",
      )
    ).value;
    const targetDurationSeconds = exactTargetDuration(story);

    const narrationRoot = path.join(
      request.candidate_source_root,
      "narration",
    );
    const audioPath = path.join(narrationRoot, "narration.mp3");
    const alignmentPath = path.join(
      narrationRoot,
      "elevenlabs-alignment.json",
    );
    const generated = normaliseGenerationResult(
      await dependencies.generateNarration({
        schema_version:
          "pulse-governed-autonomous-narration-generation-v1",
        mode: MODE,
        story_id: request.story_id,
        generated_at: request.generated_at,
        script_text: story.story.full_script,
        script_sha256: story.story.script_sha256,
        provider: structuredClone(request.narration),
        audio_path: audioPath,
        alignment_path: alignmentPath,
        publish_authority: false,
      }),
      request,
    );
    const audioSha256 = hashFile(audioPath);
    const alignmentSha256 = hashFile(alignmentPath);
    const narrationInspection =
      await dependencies.probeNarrationAudio(audioPath);
    const observedDuration = Number(
      narrationInspection?.duration_seconds,
    );
    if (
      !Number.isFinite(observedDuration) ||
      observedDuration <= 0 ||
      observedDuration > targetDurationSeconds
    ) {
      fail("autonomous_production_narration_duration_invalid");
    }
    const alignmentEnd = exactAlignmentEnd(alignmentPath);
    const visualBreathAllowanceSeconds = Number(
      (targetDurationSeconds - observedDuration).toFixed(6),
    );
    const narrationTailSeconds = Number(
      (targetDurationSeconds - alignmentEnd).toFixed(6),
    );
    const measuredTiming = readMeasuredTimingEvidence({
      contract: story.contract,
      request,
      providerResultSha256:
        generated.provider.provider_result.sha256,
      audioSha256,
      alignmentSha256,
      observedDuration,
      alignmentEnd,
    });
    if (
      !measuredTiming &&
      story.contract.duration_band_id ===
        "what_changes_short_25_32" &&
      narrationTailSeconds >
        MAXIMUM_NARRATION_TAIL_SECONDS
    ) {
      if (!dependencies.narrationTimingEvidence) {
        fail(
          "autonomous_production_narration_timing_state_root_required",
        );
      }
      const timingEvidence =
        await materializeGovernedAutonomousNarrationTimingEvidence({
          schema_version:
            "pulse-governed-autonomous-narration-timing-evidence-request-v1",
          mode: MODE,
          story_id: request.story_id,
          legacy_story_id:
            request.locked_intake.database_story_binding
              .database_story_id,
          script_sha256:
            request.locked_intake.final_script_sha256,
          provider: request.narration,
          provider_result_sha256:
            generated.provider.provider_result.sha256,
          audio_sha256: audioSha256,
          audio_duration_seconds: observedDuration,
          alignment_sha256: alignmentSha256,
          alignment_end_seconds: alignmentEnd,
          generated_at:
            generated.credit_report.generated_at,
          reviewed_at:
            generated.credit_report.generated_at,
          state_root:
            dependencies.narrationTimingEvidence.state_root,
        });
      fail(
        "autonomous_production_narration_timing_replan_required",
        {
          narration_network_used: generated.network_used,
          timing_evidence: {
            path: timingEvidence.path,
            file_sha256: timingEvidence.file_sha256,
            evidence: timingEvidence.evidence,
          },
        },
      );
    }
    if (
      narrationTailSeconds < 0 ||
      narrationTailSeconds >
        MAXIMUM_NARRATION_TAIL_SECONDS
    ) {
      fail("autonomous_production_narration_tail_excessive");
    }

    const receiptPath = path.join(
      narrationRoot,
      "elevenlabs-generation-receipt.json",
    );
    const receipt =
      await materializeElevenLabsCommercialGenerationReceipt({
        schema_version:
          ELEVENLABS_RECEIPT_REQUEST_SCHEMA_VERSION,
        mode: "GENERATION_EVIDENCE",
        story_id: request.story_id,
        generated_at: generated.credit_report.generated_at,
        root_dir: request.candidate_source_root,
        output_path: receiptPath,
        request_text: story.story.full_script,
        provider: {
          id: generated.provider.id,
          model_id: generated.provider.model_id,
          voice_id: generated.provider.voice_id,
          http_status: generated.provider.http_status,
          provider_result_recorded:
            generated.provider.provider_result_recorded,
        },
        credit_report: generated.credit_report,
        audio: {
          path: audioPath,
          sha256: audioSha256,
          transform_status: generated.transform_status,
          post_generation_transform_status:
            generated.post_generation_transform_status,
        },
        allowed_platforms: [PLATFORM_METADATA],
      });
    if (
      receipt.receipt.generation_verdict !== "GREEN" ||
      receipt.receipt.account_entitlement?.paid_at_generation !== true
    ) {
      fail("autonomous_production_narration_licence_invalid");
    }

    const narrationPlan = await buildGovernedNarrationPlan({
      storyId: request.story_id,
      scriptText: story.story.full_script,
      scriptSha256: story.story.script_sha256,
      audioPath,
      audioSha256,
      alignmentPath,
      alignmentSha256,
      outputDir: path.join(narrationRoot, "governed"),
      generatedAt: request.generated_at,
      durationBandId: story.contract.duration_band_id,
      finalTargetSeconds: targetDurationSeconds,
      visualBreathAllowanceSeconds,
      expectedProvider: request.narration.provider,
      expectedVoiceId: request.narration.voice_id,
      expectedModelId: request.narration.model_id,
      expectedSpeed: request.narration.speed,
      licenceEvidenceReference:
        futureNarrationLicenceReference(request),
      licenceAttestedBy:
        "pulse-autonomous-paid-provider-policy-v1",
      licenceAttestedAt: receipt.receipt.generated_at,
      probeAudio: async () => narrationInspection,
    });
    const narrationAuthority = validateApplyAuthority({
      applyRequested: true,
      confirmStoryId: narrationPlan.story_id,
      confirmScriptSha256: narrationPlan.script.sha256,
      confirmAudioSha256:
        narrationPlan.sources.audio.expected_sha256,
      confirmAlignmentSha256:
        narrationPlan.sources.alignment.expected_sha256,
      confirmPlanSha256: narrationPlan.plan_sha256,
      plan: narrationPlan,
      env: {
        DEPLOYMENT_MODE: "local",
        PULSE_OPERATING_MODE: "HUMAN_REVIEW",
        AUTO_PUBLISH: "false",
        PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "false",
        PULSE_EMERGENCY_KILL_SWITCH: "true",
      },
    });
    if (!narrationAuthority.authorised) {
      fail("autonomous_production_narration_materialisation_denied");
    }
    const narration = await materializeGovernedNarration({
      plan: narrationPlan,
      authority: narrationAuthority,
    });

    const programme = await materialiseGovernedOwnedProgrammePack(
      {
        mode: MODE,
        storyId: request.story_id,
        storyIntakeRef: {
          path: intake.paths.story_intake,
          sha256: storyIntakeSha256,
        },
        storyRoot: path.join(
          request.candidate_source_root,
          "owned-programme",
          request.story_id,
        ),
        generatedAt: request.generated_at,
        scenes: request.creative.scenes,
      },
      dependencies.ownedProgramme,
    );

    const composite = await executeGovernedFinalComposite(
      {
        storyIntakePath: intake.paths.story_intake,
        ownedMotionManifestPath: programme.combined_manifest_path,
        videoPath: programme.programme_path,
        audioPath,
        timestampsPath: narration.timestamps_path,
        narrationManifestPath: narration.manifest_path,
        expectedNarrationManifestSha256:
          narration.manifest_sha256,
        outDir: path.join(request.candidate_source_root, "final"),
        generatedAt: request.generated_at,
        ffmpegPath: dependencies.finalComposite.ffmpegPath,
      },
      dependencies.finalComposite,
    );

    const claimMap = await materialiseClaimMap({
      root: request.candidate_source_root,
      story,
      sourceEvidence,
      storyIntakeSha256,
      generatedAt: request.generated_at,
    });
    const promptInjectionControl =
      await materialisePromptInjectionProof({
        root: request.candidate_source_root,
        story,
        sourceEvidence,
        storyIntakeSha256,
        generatedAt: request.generated_at,
      });

    const visualQa =
      await materialiseAutonomousMultimodalVisualQa(
        {
          schema_version: VISUAL_QA_REQUEST_SCHEMA_VERSION,
          mode: MODE,
          story_id: request.story_id,
          channel_id: CHANNEL_ID,
          lane_id: LANE_ID,
          platform: PLATFORM,
          generated_at: request.generated_at,
          root_dir: request.candidate_source_root,
          output_dir: path.join(
            request.candidate_source_root,
            "visual-qa",
          ),
          final_mp4: {
            path: composite.final_mp4_path,
            sha256: composite.media_sha256,
          },
          frame_plan: visualFramePlan(targetDurationSeconds),
          reviewers: request.visual_qa.reviewers,
        },
        dependencies.visualQa,
      );
    if (visualQa.verdict !== "PASS") {
      fail("autonomous_production_visual_qa_hold");
    }
    const visualGateDecision =
      await materialiseGovernedAutonomousVisualGateDecision({
        schema_version: VISUAL_GATE_REQUEST_SCHEMA_VERSION,
        mode: MODE,
        story_id: request.story_id,
        channel_id: CHANNEL_ID,
        lane_id: LANE_ID,
        platform: PLATFORM,
        generated_at: request.generated_at,
        root_dir: request.candidate_source_root,
        output_path: path.join(
          request.candidate_source_root,
          "visual-qa",
          "autonomous-visual-gate-decision.json",
        ),
        final_mp4: {
          path: composite.final_mp4_path,
          sha256: composite.media_sha256,
        },
        visual_qa: {
          path: visualQa.report_path,
          raw_sha256: visualQa.file_sha256,
          canonical_sha256: visualGateCanonicalSha256(
            visualQa.report,
          ),
        },
      });

    const metadata =
      await materialiseAutonomousPublicationMetadata({
        schema_version: METADATA_REQUEST_SCHEMA_VERSION,
        mode: MODE,
        story_id: request.story_id,
        channel_id: CHANNEL_ID,
        platform: PLATFORM_METADATA,
        generated_at: request.generated_at,
        root_dir: request.candidate_source_root,
        output_path: path.join(
          request.candidate_source_root,
          "publication",
          "youtube-shorts-metadata.json",
        ),
        title: request.creative.title,
        description: request.creative.description,
        official_source_url:
          request.creative.official_source_url,
        required_attributions:
          request.creative.required_attributions,
        subject_terms: request.creative.subject_terms,
        evidence_bindings: {
          source_evidence_sha256: sourceEvidenceSha256,
          claim_map_sha256: claimMap.sha256,
          qa_report_sha256: hashFile(composite.qa_report_path),
          final_mp4_sha256: composite.media_sha256,
        },
      });

    const ownedRightsRecords = [];
    const ownedMediaItems = [];
    for (const asset of programme.owned_visual_assets) {
      const itemId = `visual:${asset.asset_id}`;
      const mediaRole =
        asset.media_type === "video" ? "MOTION" : "VISUAL";
      const rights = await writeJsonExclusive(
        path.join(
          request.candidate_source_root,
          "rights",
          `visual-${asset.asset_id}.json`,
        ),
        rightsEvidence({
          storyId: request.story_id,
          itemId,
          mediaRole,
          assetSha256: asset.sha256,
          rightsBasis: "OWNED",
          licenceDocumentSha256: null,
        }),
      );
      ownedRightsRecords.push({ item_id: itemId, rights });
      ownedMediaItems.push(
        mediaItem({
          itemId,
          mediaRole,
          assetSha256: asset.sha256,
          rightsEvidenceSha256: rights.sha256,
          rightsBasis: "OWNED",
          licenceDocumentSha256: null,
        }),
      );
    }
    const programmeItemId = "visual:owned-programme";
    const programmeRights = await writeJsonExclusive(
      path.join(
        request.candidate_source_root,
        "rights",
        "visual-owned-programme.json",
      ),
      rightsEvidence({
        storyId: request.story_id,
        itemId: programmeItemId,
        mediaRole: "MOTION",
        assetSha256: programme.programme_sha256,
        rightsBasis: "OWNED",
        licenceDocumentSha256: null,
      }),
    );
    ownedRightsRecords.push({
      item_id: programmeItemId,
      rights: programmeRights,
    });
    ownedMediaItems.push(
      mediaItem({
        itemId: programmeItemId,
        mediaRole: "MOTION",
        assetSha256: programme.programme_sha256,
        rightsEvidenceSha256: programmeRights.sha256,
        rightsBasis: "OWNED",
        licenceDocumentSha256: null,
      }),
    );
    const narrationItemId = "audio:elevenlabs-narration";
    const narrationRights = await writeJsonExclusive(
      path.join(
        request.candidate_source_root,
        "rights",
        "narration.json",
      ),
      rightsEvidence({
        storyId: request.story_id,
        itemId: narrationItemId,
        mediaRole: "NARRATION",
        assetSha256: audioSha256,
        rightsBasis: "LICENSED",
        licenceDocumentSha256: receipt.file_sha256,
      }),
    );
    const mediaItems = [
      mediaItem({
        itemId: narrationItemId,
        mediaRole: "NARRATION",
        assetSha256: audioSha256,
        rightsEvidenceSha256: narrationRights.sha256,
        rightsBasis: "LICENSED",
        licenceDocumentSha256: receipt.file_sha256,
      }),
      ...ownedMediaItems,
    ].sort((left, right) =>
      left.item_id.localeCompare(right.item_id),
    );
    const finalMediaInventory = await writeJsonExclusive(
      path.join(
        request.candidate_source_root,
        "evidence",
        "final-media-inventory.json",
      ),
      {
        schema_version: FINAL_MEDIA_INVENTORY_SCHEMA_VERSION,
        story_id: request.story_id,
        channel_id: CHANNEL_ID,
        lane_id: LANE_ID,
        platform: PLATFORM,
        generated_at: request.generated_at,
        complete: true,
        item_count: mediaItems.length,
        script_sha256: story.story.script_sha256,
        narration_sha256: audioSha256,
        timestamps_sha256: narration.timestamps_sha256,
        final_mp4_sha256: composite.media_sha256,
        items: mediaItems,
      },
    );
    const rightsLedgerSha256 = canonicalSha256({
      schema_version:
        "pulse-autonomous-media-rights-ledger-v1",
      story_id: request.story_id,
      channel_id: CHANNEL_ID,
      lane_id: LANE_ID,
      decision: "CLEARED",
      items: mediaItems.map(
        ({ media_role: _mediaRole, ...item }) => item,
      ),
    });
    const autonomousPackage = await writeJsonExclusive(
      path.join(
        request.candidate_source_root,
        "evidence",
        "autonomous-package-manifest.json",
      ),
      {
        schema_version:
          AUTONOMOUS_PACKAGE_MANIFEST_SCHEMA_VERSION,
        mode: MODE,
        story_id: request.story_id,
        channel_id: CHANNEL_ID,
        lane_id: LANE_ID,
        platform: PLATFORM,
        generated_at: request.generated_at,
        lineage: {
          source_intake_sha256: storyIntakeSha256,
          claim_map_sha256: claimMap.sha256,
          script_sha256: story.story.script_sha256,
          narration_sha256: audioSha256,
          timestamps_sha256: narration.timestamps_sha256,
          media_inventory_sha256: finalMediaInventory.sha256,
          rights_ledger_sha256: rightsLedgerSha256,
          motion_manifest_sha256: hashFile(
            composite.combined_owned_motion_manifest_path,
          ),
          render_manifest_sha256: hashFile(
            composite.renderer_manifest_path,
          ),
          final_mp4_sha256: composite.media_sha256,
          qa_report_sha256: hashFile(composite.qa_report_path),
          publication_metadata_sha256: metadata.file_sha256,
        },
        prompt_injection_control_sha256:
          promptInjectionControl.sha256,
        media_items: mediaItems,
        controls: {
          local_proof_only: true,
          publish_authority: false,
          scheduler_authority: false,
          database_authority: false,
          oauth_or_token_authority: false,
          network_authority: false,
        },
      },
    );
    const greenSupplement =
      await materialiseAutonomousGreenSupplement({
        schema_version:
          GREEN_SUPPLEMENT_REQUEST_SCHEMA_VERSION,
        mode: MODE,
        story_id: request.story_id,
        channel_id: CHANNEL_ID,
        lane_id: LANE_ID,
        platform: PLATFORM,
        generated_at: request.generated_at,
        output_dir: path.join(
          request.candidate_source_root,
          "green-supplement",
        ),
        claim_map: {
          path: claimMap.path,
          sha256: claimMap.sha256,
        },
        word_timestamps: {
          path: narration.timestamps_path,
          sha256: narration.timestamps_sha256,
        },
        final_media_inventory: {
          path: finalMediaInventory.path,
          sha256: finalMediaInventory.sha256,
        },
        prompt_injection_control: {
          path: promptInjectionControl.path,
          sha256: promptInjectionControl.sha256,
        },
        media_rights_evidence: [
          {
            item_id: narrationItemId,
            rights_evidence: {
              path: narrationRights.path,
              sha256: narrationRights.sha256,
            },
            licence_document: {
              path: receipt.path,
              sha256: receipt.file_sha256,
            },
          },
          ...ownedRightsRecords.map(({ item_id: itemId, rights }) => ({
            item_id: itemId,
            rights_evidence: {
              path: rights.path,
              sha256: rights.sha256,
            },
            licence_document: null,
          })),
        ],
        autonomous_package_manifest: {
          path: autonomousPackage.path,
          sha256: autonomousPackage.sha256,
        },
      });
    if (greenSupplement.verdict !== "GREEN") {
      fail("autonomous_production_green_supplement_hold");
    }

    const artifacts = {
      story_intake: reference(intake.paths.story_intake),
      source_evidence: reference(intake.paths.source_evidence),
      owned_motion_manifest: reference(
        composite.combined_owned_motion_manifest_path,
      ),
      owned_motion_source_manifest: reference(
        programme.source_manifest_path,
      ),
      owned_programme: reference(programme.programme_path),
      narration_audio: reference(audioPath),
      narration_manifest: reference(narration.manifest_path),
      narration_licence_evidence: reference(receipt.path),
      final_composite_manifest: reference(
        composite.composite_manifest_path,
      ),
      renderer_manifest: reference(
        composite.renderer_manifest_path,
      ),
      deterministic_qa: reference(composite.qa_report_path),
      multimodal_visual_qa: reference(visualQa.report_path),
      final_mp4: reference(composite.final_mp4_path),
      publication_metadata: reference(metadata.path),
      autonomous_green_supplement: reference(
        greenSupplement.json_path,
      ),
      autonomous_visual_gate_decision: reference(
        visualGateDecision.path,
      ),
    };
    const staging = await stageAutonomousOfficialCandidate({
      schema_version: CANDIDATE_STAGING_REQUEST_SCHEMA_VERSION,
      mode: MODE,
      story_id: request.story_id,
      channel_id: CHANNEL_ID,
      lane_id: LANE_ID,
      platform: PLATFORM,
      scheduled_for: request.scheduled_for,
      role: request.role,
      candidate_revision_sha256:
        request.candidate_revision_sha256,
      request_fingerprint: request.request_fingerprint,
      generated_at: request.generated_at,
      workspace_root: request.workspace_root,
      candidate_source_root: request.candidate_source_root,
      candidate_workspace_relative_root:
        request.candidate_workspace_relative_root,
      allowed_external_source_roots: [
        path.resolve(request.locked_intake.inventory_root),
      ],
      artifacts,
      owned_visual_assets: programme.owned_visual_assets.map(
        (asset) => ({
          asset_id: asset.asset_id,
          source_path: asset.path,
          sha256: asset.sha256,
        }),
      ),
      synthetic_media_disclosure: {
        decision_authority: "SYSTEM_POLICY",
        altered_content: true,
        policy_basis: "DISCLOSE",
        youtube_field_value: true,
        decision_provenance: {
          policy_id: request.disclosure_policy.policy_id,
          policy_version:
            request.disclosure_policy.policy_version,
          evaluated_at: request.generated_at,
          evidence_sha256: hashFile(
            composite.composite_manifest_path,
          ),
        },
      },
      ...(request.locked_intake.fast_news_lane_decision
        ? {
            fast_news_lane_decision:
              request.locked_intake.fast_news_lane_decision,
          }
        : {}),
    });
    validateAutonomousOfficialJitPreparationManifest(
      staging.preparation_manifest,
    );

    completed = true;
    return Object.freeze({
      schema_version: RESULT_SCHEMA_VERSION,
      mode: MODE,
      verdict: "GREEN",
      blockers: [],
      story_id: request.story_id,
      intake: boundIntake,
      programme,
      narration: {
        audio_path: audioPath,
        audio_sha256: audioSha256,
        alignment_path: alignmentPath,
        alignment_sha256: alignmentSha256,
        manifest_path: narration.manifest_path,
        manifest_sha256: narration.manifest_sha256,
        timestamps_path: narration.timestamps_path,
        timestamps_sha256: narration.timestamps_sha256,
        commercial_receipt_path: receipt.path,
        commercial_receipt_sha256: receipt.file_sha256,
        timing_evidence_path: measuredTiming
          ? story.contract.target_duration_review
              .narration_timing_evidence_path
          : null,
        timing_evidence_sha256: measuredTiming
          ? story.contract.target_duration_review
              .narration_timing_evidence_sha256
          : null,
      },
      composite,
      visual_qa: visualQa,
      visual_gate_decision: visualGateDecision,
      publication_metadata: metadata,
      green_supplement: greenSupplement,
      staging,
      safety: {
        publish_authority: false,
        scheduler_authority: false,
        database_mutated: false,
        oauth_or_tokens_mutated: false,
        platform_contacted: false,
        narration_network_used: generated.network_used,
        external_publish_authorised: false,
      },
    });
  } finally {
    if (!completed) {
      await fsp.rm(request.candidate_source_root, {
        recursive: true,
        force: true,
      });
    }
  }
}

async function materialiseGovernedAutonomousNarrationTimingObservation(
  rawBuilderResult,
  rawDependencies,
) {
  const {
    validateGovernedAutonomousProductionRequestBuild,
  } = require("./governed-autonomous-production-request-builder");
  const builderResult =
    validateGovernedAutonomousProductionRequestBuild(
      rawBuilderResult,
    );
  const request = builderResult.production_request;
  if (
    request.locked_intake?.contract?.duration_band_id !==
    "what_changes_short_25_32"
  ) {
    fail(
      "autonomous_production_narration_timing_observation_provisional_contract_required",
    );
  }
  if (
    !plainObject(rawDependencies) ||
    !plainObject(
      rawDependencies.narrationTimingEvidence,
    )
  ) {
    fail(
      "autonomous_production_narration_timing_observation_dependencies_invalid",
    );
  }
  const forbidProgramme = async () => {
    fail(
      "autonomous_production_narration_timing_observation_programme_forbidden",
    );
  };
  const guardedDependencies = {
    ...rawDependencies,
    ownedProgramme: {
      ...rawDependencies.ownedProgramme,
      renderScene: forbidProgramme,
      renderProgramme: forbidProgramme,
      probeMedia: forbidProgramme,
    },
  };
  try {
    await materialiseGovernedAutonomousOfficialCandidate(
      request,
      guardedDependencies,
    );
  } catch (error) {
    if (
      error?.code !==
      "autonomous_production_narration_timing_replan_required"
    ) {
      throw error;
    }
    if (error?.details?.narration_network_used !== false) {
      fail(
        "autonomous_production_narration_timing_observation_replay_required",
      );
    }
    const databaseBinding =
      request.locked_intake.database_story_binding;
    const reference =
      await discoverGovernedAutonomousNarrationTimingEvidence({
        stateRoot:
          rawDependencies.narrationTimingEvidence
            .state_root,
        storyId: builderResult.story_id,
        legacyStoryId:
          databaseBinding.database_story_id,
        scriptSha256:
          request.locked_intake.final_script_sha256,
        provider: request.narration,
      });
    const observed = error.details.timing_evidence;
    if (
      !reference ||
      reference.path !== observed?.path ||
      reference.file_sha256 !== observed?.file_sha256
    ) {
      fail(
        "autonomous_production_narration_timing_observation_evidence_invalid",
      );
    }
    const evidence =
      validateGovernedAutonomousNarrationTimingEvidence(
        observed.evidence,
        {
          storyId: builderResult.story_id,
          legacyStoryId:
            databaseBinding.database_story_id,
          scriptSha256:
            request.locked_intake.final_script_sha256,
          provider: request.narration,
          requireAudioSha256: true,
        },
      );
    return Object.freeze({
      schema_version:
        "pulse-governed-autonomous-narration-timing-observation-v1",
      mode: MODE,
      status:
        "NARRATION_TIMING_OBSERVED_REPLAN_REQUIRED",
      story_id: builderResult.story_id,
      legacy_story_id:
        databaseBinding.database_story_id,
      builder_sha256: builderResult.builder_sha256,
      candidate_revision_sha256:
        request.candidate_revision_sha256,
      timing_evidence: Object.freeze({
        path: reference.path,
        file_sha256: reference.file_sha256,
        provider_result_sha256:
          evidence.provider_result.sha256,
        audio_sha256: evidence.audio.sha256,
        alignment_sha256: evidence.alignment.sha256,
        target_duration_seconds:
          evidence.target.duration_seconds,
        narration_tail_seconds:
          evidence.target.narration_tail_seconds,
      }),
      safety: Object.freeze({
        narration_network_used: false,
        programme_rendered: false,
        database_mutated: false,
        oauth_or_tokens_mutated: false,
        platform_contacted: false,
        publish_authority_created: false,
        external_posting: false,
      }),
    });
  }
  fail(
    "autonomous_production_narration_timing_observation_replan_not_required",
  );
}

module.exports = {
  GovernedAutonomousProductionCoordinatorError,
  REQUEST_SCHEMA_VERSION,
  RESULT_SCHEMA_VERSION,
  materialiseGovernedAutonomousNarrationTimingObservation,
  materialiseGovernedAutonomousOfficialCandidate,
};
