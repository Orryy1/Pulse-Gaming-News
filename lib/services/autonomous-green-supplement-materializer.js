"use strict";

const crypto = require("node:crypto");
const defaultFileSystem = require("node:fs/promises");
const path = require("node:path");

const REQUEST_SCHEMA_VERSION = "pulse-autonomous-green-supplement-request-v1";
const SUPPLEMENT_SCHEMA_VERSION = "pulse-autonomous-green-supplement-v1";
const CLAIM_MAP_SCHEMA_VERSION = "pulse-governed-claim-map-v1";
const FINAL_MEDIA_INVENTORY_SCHEMA_VERSION =
  "pulse-autonomous-final-media-inventory-v1";
const PROMPT_INJECTION_CONTROL_SCHEMA_VERSION =
  "pulse-prompt-injection-control-proof-v1";
const MEDIA_RIGHTS_EVIDENCE_SCHEMA_VERSION =
  "pulse-autonomous-media-rights-evidence-v1";
const AUTONOMOUS_PACKAGE_MANIFEST_SCHEMA_VERSION =
  "pulse-autonomous-package-manifest-v1";
const WORD_TIMESTAMPS_SCHEMA_VERSION = "pulse-word-timestamps-v1";
const RIGHTS_LEDGER_SCHEMA_VERSION = "pulse-autonomous-media-rights-ledger-v1";
const MODE = "LOCAL_PROOF";
const PLATFORM = "youtube";
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const WORD_TIMING_AUDIO_TOLERANCE_SECONDS = 0.01;
const CANONICAL_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const OUTPUT_JSON_NAME = "autonomous-green-supplement.json";
const OUTPUT_MARKDOWN_NAME = "autonomous-green-supplement.md";

const REQUEST_FIELDS = new Set([
  "schema_version",
  "mode",
  "story_id",
  "channel_id",
  "lane_id",
  "platform",
  "generated_at",
  "output_dir",
  "claim_map",
  "word_timestamps",
  "final_media_inventory",
  "prompt_injection_control",
  "media_rights_evidence",
  "autonomous_package_manifest",
]);
const FILE_REFERENCE_FIELDS = new Set(["path", "sha256"]);
const RIGHTS_REFERENCE_FIELDS = new Set([
  "item_id",
  "rights_evidence",
  "licence_document",
]);
const CLAIM_MAP_FIELDS = new Set([
  "schema_version",
  "story_id",
  "channel_id",
  "lane_id",
  "generated_at",
  "source_intake_sha256",
  "script_sha256",
  "claims",
]);
const CLAIM_FIELDS = new Set([
  "claim_id",
  "claim_text_sha256",
  "source_evidence_sha256",
  "verification_status",
  "script_sections",
]);
const WORD_TIMESTAMPS_FIELDS = new Set([
  "schema_version",
  "story_id",
  "generated_at",
  "script_sha256",
  "source_alignment_sha256",
  "audio_sha256",
  "audio_duration_seconds",
  "character_count",
  "word_count",
  "words",
]);
const WORD_FIELDS = new Set(["text", "start_seconds", "end_seconds"]);
const FINAL_MEDIA_INVENTORY_FIELDS = new Set([
  "schema_version",
  "story_id",
  "channel_id",
  "lane_id",
  "platform",
  "generated_at",
  "complete",
  "item_count",
  "script_sha256",
  "narration_sha256",
  "timestamps_sha256",
  "final_mp4_sha256",
  "items",
]);
const MEDIA_ITEM_FIELDS = new Set([
  "item_id",
  "media_role",
  "asset_sha256",
  "included_in_final",
  "rights_decision",
  "rights_basis",
  "rights_evidence_sha256",
  "licence_document_sha256",
  "review_status",
  "risk_decision",
  "attribution_decision",
  "attribution_text",
  "scope",
]);
const RIGHTS_EVIDENCE_FIELDS = new Set([
  "schema_version",
  "story_id",
  "channel_id",
  "lane_id",
  "item_id",
  "media_role",
  "asset_sha256",
  "rights_decision",
  "rights_basis",
  "licence_document_sha256",
  "review_status",
  "risk_decision",
  "attribution_decision",
  "attribution_text",
  "scope",
]);
const SCOPE_FIELDS = new Set([
  "destinations",
  "revenue_modes",
  "territory",
  "account_id",
]);
const PROMPT_INJECTION_CONTROL_FIELDS = new Set([
  "schema_version",
  "story_id",
  "channel_id",
  "lane_id",
  "evaluated_at",
  "policy_id",
  "source_intake_sha256",
  "untrusted_content_treated_as_data",
  "instructions_followed_from_source",
  "detected",
  "signals",
  "verdict",
]);
const PACKAGE_FIELDS = new Set([
  "schema_version",
  "mode",
  "story_id",
  "channel_id",
  "lane_id",
  "platform",
  "generated_at",
  "lineage",
  "prompt_injection_control_sha256",
  "media_items",
  "controls",
]);
const LINEAGE_FIELDS = Object.freeze([
  "source_intake_sha256",
  "claim_map_sha256",
  "script_sha256",
  "narration_sha256",
  "timestamps_sha256",
  "media_inventory_sha256",
  "rights_ledger_sha256",
  "motion_manifest_sha256",
  "render_manifest_sha256",
  "final_mp4_sha256",
  "qa_report_sha256",
  "publication_metadata_sha256",
]);
const PACKAGE_CONTROL_FIELDS = new Set([
  "local_proof_only",
  "publish_authority",
  "scheduler_authority",
  "database_authority",
  "oauth_or_token_authority",
  "network_authority",
]);
const ALLOWED_SCRIPT_SECTIONS = new Set(["HOOK", "BODY", "LOOP"]);
const ALLOWED_MEDIA_ROLES = new Set([
  "VISUAL",
  "MOTION",
  "SOURCE_MEDIA",
  "NARRATION",
  "MUSIC",
  "SOUND_EFFECT",
]);
const OWNED_RIGHTS_BASES = new Set(["OWNED", "OWNED_CAPTURE"]);
const LICENSED_RIGHTS_BASES = new Set([
  "LICENSED",
  "EXPLICIT_LICENCE",
  "PRESS_KIT_TERMS",
  "PLATFORM_PROMOTIONAL_TERMS",
]);
const ALLOWED_RIGHTS_BASES = new Set([
  ...OWNED_RIGHTS_BASES,
  ...LICENSED_RIGHTS_BASES,
]);

class AutonomousGreenSupplementMaterializerError extends Error {
  constructor(code) {
    super(code);
    this.name = "AutonomousGreenSupplementMaterializerError";
    this.code = code;
  }
}

function fail(code) {
  throw new AutonomousGreenSupplementMaterializerError(code);
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

function exactArray(value, code) {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.keys(value).length !== value.length
  ) {
    fail(code);
  }
  return value;
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

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function exactSha256(value, code) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(code);
  }
  if (/^([a-f0-9])\1{63}$/.test(value)) fail(code);
  return value;
}

function exactTimestamp(value, code) {
  const raw = typeof value === "string" ? value : "";
  const parsed = Date.parse(raw);
  if (
    !CANONICAL_TIMESTAMP_PATTERN.test(raw) ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== raw
  ) {
    fail(code);
  }
  return raw;
}

function exactIdentity(value, request, prefix) {
  if (text(value.story_id) !== request.story_id) {
    fail(`${prefix}_story_id_mismatch`);
  }
  if (text(value.channel_id) !== request.channel_id) {
    fail(`${prefix}_channel_id_mismatch`);
  }
  if (text(value.lane_id) !== request.lane_id) {
    fail(`${prefix}_lane_id_mismatch`);
  }
}

function exactIdentifier(value, code) {
  const candidate = text(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidate)) {
    fail(code);
  }
  return candidate;
}

function exactAbsolutePath(value, code) {
  const supplied = typeof value === "string" ? value : "";
  if (!supplied || supplied !== text(value) || !path.isAbsolute(supplied)) {
    fail(code);
  }
  const resolved = path.resolve(supplied);
  if (resolved !== supplied) fail(code);
  return resolved;
}

function normaliseFileReference(value, code) {
  exactFields(value, FILE_REFERENCE_FIELDS, code);
  return {
    path: exactAbsolutePath(value.path, code),
    sha256: exactSha256(value.sha256, code),
  };
}

function samePath(left, right) {
  const leftPath = path.resolve(left);
  const rightPath = path.resolve(right);
  return process.platform === "win32"
    ? leftPath.toLowerCase() === rightPath.toLowerCase()
    : leftPath === rightPath;
}

function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function normaliseRequest(value) {
  exactFields(
    value,
    REQUEST_FIELDS,
    "autonomous_green_supplement_request_fields_invalid",
  );
  if (value.schema_version !== REQUEST_SCHEMA_VERSION || value.mode !== MODE) {
    fail("autonomous_green_supplement_local_proof_only");
  }
  const storyId = exactIdentifier(
    value.story_id,
    "autonomous_green_supplement_story_id_invalid",
  );
  if (
    value.channel_id !== "pulse-gaming" ||
    value.lane_id !== "breaking_short" ||
    value.platform !== PLATFORM
  ) {
    fail("autonomous_green_supplement_scope_invalid");
  }
  const outputDir = exactAbsolutePath(
    value.output_dir,
    "autonomous_green_supplement_output_dir_invalid",
  );
  const references = {
    claim_map: normaliseFileReference(
      value.claim_map,
      "autonomous_green_supplement_claim_map_reference_invalid",
    ),
    word_timestamps: normaliseFileReference(
      value.word_timestamps,
      "autonomous_green_supplement_word_timestamps_reference_invalid",
    ),
    final_media_inventory: normaliseFileReference(
      value.final_media_inventory,
      "autonomous_green_supplement_final_media_inventory_reference_invalid",
    ),
    prompt_injection_control: normaliseFileReference(
      value.prompt_injection_control,
      "autonomous_green_supplement_prompt_injection_control_reference_invalid",
    ),
    autonomous_package_manifest: normaliseFileReference(
      value.autonomous_package_manifest,
      "autonomous_green_supplement_package_reference_invalid",
    ),
  };
  const rawRightsReferences = exactArray(
    value.media_rights_evidence,
    "autonomous_green_supplement_rights_references_invalid",
  );
  if (!rawRightsReferences.length) {
    fail("autonomous_green_supplement_rights_references_required");
  }
  const seenItems = new Set();
  const mediaRightsEvidence = rawRightsReferences.map((rawReference) => {
    exactFields(
      rawReference,
      RIGHTS_REFERENCE_FIELDS,
      "autonomous_green_supplement_rights_reference_fields_invalid",
    );
    const itemId = exactIdentifier(
      rawReference.item_id,
      "autonomous_green_supplement_rights_item_id_invalid",
    );
    if (seenItems.has(itemId)) {
      fail("autonomous_green_supplement_rights_item_id_duplicate");
    }
    seenItems.add(itemId);
    return {
      item_id: itemId,
      rights_evidence: normaliseFileReference(
        rawReference.rights_evidence,
        "autonomous_green_supplement_rights_evidence_reference_invalid",
      ),
      licence_document:
        rawReference.licence_document === null
          ? null
          : normaliseFileReference(
              rawReference.licence_document,
              "autonomous_green_supplement_licence_document_reference_invalid",
            ),
    };
  });
  mediaRightsEvidence.sort((left, right) =>
    left.item_id.localeCompare(right.item_id),
  );
  const allReferences = [
    ...Object.values(references),
    ...mediaRightsEvidence.flatMap((reference) => [
      reference.rights_evidence,
      ...(reference.licence_document ? [reference.licence_document] : []),
    ]),
  ];
  const seenPaths = new Set();
  for (const reference of allReferences) {
    const pathKey =
      process.platform === "win32"
        ? reference.path.toLowerCase()
        : reference.path;
    if (seenPaths.has(pathKey)) {
      fail("autonomous_green_supplement_reference_path_reuse");
    }
    if (pathWithin(outputDir, reference.path)) {
      fail("autonomous_green_supplement_source_inside_output");
    }
    seenPaths.add(pathKey);
  }
  return {
    schema_version: REQUEST_SCHEMA_VERSION,
    mode: MODE,
    story_id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: PLATFORM,
    generated_at: exactTimestamp(
      value.generated_at,
      "autonomous_green_supplement_generated_at_invalid",
    ),
    output_dir: outputDir,
    ...references,
    media_rights_evidence: mediaRightsEvidence,
  };
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

async function readHashBoundFile({ reference, label, json, fileSystem }) {
  let initial;
  try {
    initial = await fileSystem.lstat(reference.path, { bigint: true });
  } catch {
    fail(`${label}_file_missing`);
  }
  if (
    !initial.isFile() ||
    initial.isSymbolicLink() ||
    initial.size <= 0n ||
    initial.size > BigInt(Number.MAX_SAFE_INTEGER) ||
    (json && initial.size > BigInt(MAX_JSON_BYTES))
  ) {
    fail(`${label}_regular_file_required`);
  }
  const initialRealPath = await fileSystem.realpath(reference.path);
  if (!samePath(initialRealPath, reference.path)) {
    fail(`${label}_link_forbidden`);
  }
  let handle;
  try {
    handle = await fileSystem.open(reference.path, "r");
    const opened = await handle.stat({ bigint: true });
    if (!sameFileIdentity(initial, opened)) {
      fail(`${label}_changed_during_read`);
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
    const finalPathStat = await fileSystem.lstat(reference.path, {
      bigint: true,
    });
    const finalRealPath = await fileSystem.realpath(reference.path);
    if (
      offset !== bytes.length ||
      !sameFileIdentity(opened, completed) ||
      !sameFileIdentity(opened, finalPathStat) ||
      !samePath(initialRealPath, finalRealPath)
    ) {
      fail(`${label}_changed_during_read`);
    }
    const observedSha256 = sha256Bytes(bytes);
    if (observedSha256 !== reference.sha256) {
      fail(`${label}_sha256_mismatch`);
    }
    let parsed = null;
    if (json) {
      try {
        parsed = JSON.parse(bytes.toString("utf8"));
      } catch {
        fail(`${label}_json_invalid`);
      }
      if (!plainObject(parsed)) fail(`${label}_json_object_required`);
    }
    return {
      path: reference.path,
      sha256: observedSha256,
      size_bytes: bytes.length,
      value: parsed,
    };
  } finally {
    await handle?.close();
  }
}

function assertNotAfter(value, upperBound, code) {
  if (Date.parse(value) > Date.parse(upperBound)) fail(code);
}

function validateClaimMap(value, request) {
  exactFields(
    value,
    CLAIM_MAP_FIELDS,
    "autonomous_green_supplement_claim_map_fields_invalid",
  );
  if (value.schema_version !== CLAIM_MAP_SCHEMA_VERSION) {
    fail("autonomous_green_supplement_claim_map_schema_invalid");
  }
  exactIdentity(value, request, "autonomous_green_supplement_claim_map");
  const generatedAt = exactTimestamp(
    value.generated_at,
    "autonomous_green_supplement_claim_map_generated_at_invalid",
  );
  assertNotAfter(
    generatedAt,
    request.generated_at,
    "autonomous_green_supplement_claim_map_from_future",
  );
  const sourceIntakeSha256 = exactSha256(
    value.source_intake_sha256,
    "autonomous_green_supplement_claim_map_source_intake_invalid",
  );
  const scriptSha256 = exactSha256(
    value.script_sha256,
    "autonomous_green_supplement_claim_map_script_invalid",
  );
  const claims = exactArray(
    value.claims,
    "autonomous_green_supplement_claims_invalid",
  );
  if (!claims.length) fail("autonomous_green_supplement_claims_required");
  const seenIds = new Set();
  const normalisedClaims = claims.map((claim) => {
    exactFields(
      claim,
      CLAIM_FIELDS,
      "autonomous_green_supplement_claim_fields_invalid",
    );
    const claimId = exactIdentifier(
      claim.claim_id,
      "autonomous_green_supplement_claim_id_invalid",
    );
    if (seenIds.has(claimId)) {
      fail("autonomous_green_supplement_claim_id_duplicate");
    }
    seenIds.add(claimId);
    if (claim.verification_status !== "CONFIRMED") {
      fail("autonomous_green_supplement_claim_not_confirmed");
    }
    const scriptSections = exactArray(
      claim.script_sections,
      "autonomous_green_supplement_claim_script_sections_invalid",
    );
    if (
      !scriptSections.length ||
      new Set(scriptSections).size !== scriptSections.length ||
      scriptSections.some(
        (section) =>
          typeof section !== "string" || !ALLOWED_SCRIPT_SECTIONS.has(section),
      )
    ) {
      fail("autonomous_green_supplement_claim_script_sections_invalid");
    }
    return {
      claim_id: claimId,
      claim_text_sha256: exactSha256(
        claim.claim_text_sha256,
        "autonomous_green_supplement_claim_text_sha256_invalid",
      ),
      source_evidence_sha256: exactSha256(
        claim.source_evidence_sha256,
        "autonomous_green_supplement_claim_source_evidence_invalid",
      ),
      verification_status: "CONFIRMED",
      script_sections: [...scriptSections],
    };
  });
  return {
    source_intake_sha256: sourceIntakeSha256,
    script_sha256: scriptSha256,
    claims: normalisedClaims,
  };
}

function finiteNumber(value, code) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(code);
  return value;
}

function positiveInteger(value, code) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(code);
  return value;
}

function validateWordTimestamps(value, request) {
  exactFields(
    value,
    WORD_TIMESTAMPS_FIELDS,
    "autonomous_green_supplement_word_timestamps_fields_invalid",
  );
  if (value.schema_version !== WORD_TIMESTAMPS_SCHEMA_VERSION) {
    fail("autonomous_green_supplement_word_timestamps_schema_invalid");
  }
  if (text(value.story_id) !== request.story_id) {
    fail("autonomous_green_supplement_word_timestamps_story_id_mismatch");
  }
  const generatedAt = exactTimestamp(
    value.generated_at,
    "autonomous_green_supplement_word_timestamps_generated_at_invalid",
  );
  assertNotAfter(
    generatedAt,
    request.generated_at,
    "autonomous_green_supplement_word_timestamps_from_future",
  );
  const audioDuration = finiteNumber(
    value.audio_duration_seconds,
    "autonomous_green_supplement_audio_duration_invalid",
  );
  if (audioDuration <= 0) {
    fail("autonomous_green_supplement_audio_duration_invalid");
  }
  const characterCount = positiveInteger(
    value.character_count,
    "autonomous_green_supplement_character_count_invalid",
  );
  const wordCount = positiveInteger(
    value.word_count,
    "autonomous_green_supplement_word_count_invalid",
  );
  const words = exactArray(
    value.words,
    "autonomous_green_supplement_words_invalid",
  );
  if (words.length !== wordCount) {
    fail("autonomous_green_supplement_word_count_mismatch");
  }
  let previousEnd = -Infinity;
  let textCharacters = 0;
  const timingFingerprints = new Set();
  const normalisedWords = words.map((word) => {
    exactFields(
      word,
      WORD_FIELDS,
      "autonomous_green_supplement_word_fields_invalid",
    );
    const wordText = typeof word.text === "string" ? word.text : "";
    if (
      !wordText ||
      text(wordText) !== wordText ||
      /\s/u.test(wordText) ||
      wordText.length > 200
    ) {
      fail("autonomous_green_supplement_word_text_invalid");
    }
    const start = finiteNumber(
      word.start_seconds,
      "autonomous_green_supplement_word_timing_invalid",
    );
    const end = finiteNumber(
      word.end_seconds,
      "autonomous_green_supplement_word_timing_invalid",
    );
    if (
      start < 0 ||
      end <= start ||
      start < previousEnd ||
      end > audioDuration + WORD_TIMING_AUDIO_TOLERANCE_SECONDS
    ) {
      fail("autonomous_green_supplement_word_timing_invalid");
    }
    previousEnd = end;
    textCharacters += Array.from(wordText).length;
    timingFingerprints.add(`${start}:${end}`);
    return {
      text: wordText,
      start_seconds: start,
      end_seconds: end,
    };
  });
  if (
    characterCount < textCharacters ||
    (words.length > 1 && timingFingerprints.size < 2)
  ) {
    fail("autonomous_green_supplement_actual_word_timestamps_required");
  }
  return {
    script_sha256: exactSha256(
      value.script_sha256,
      "autonomous_green_supplement_word_timestamps_script_invalid",
    ),
    source_alignment_sha256: exactSha256(
      value.source_alignment_sha256,
      "autonomous_green_supplement_source_alignment_invalid",
    ),
    narration_sha256: exactSha256(
      value.audio_sha256,
      "autonomous_green_supplement_word_timestamps_audio_invalid",
    ),
    word_count: wordCount,
    words: normalisedWords,
  };
}

function validateScope(value, prefix) {
  exactFields(value, SCOPE_FIELDS, `${prefix}_scope_fields_invalid`);
  const destinations = exactArray(
    value.destinations,
    `${prefix}_destinations_invalid`,
  );
  const revenueModes = exactArray(
    value.revenue_modes,
    `${prefix}_revenue_modes_invalid`,
  );
  if (
    destinations.length !== 1 ||
    destinations[0] !== "YOUTUBE" ||
    revenueModes.length !== 2 ||
    revenueModes[0] !== "ORGANIC" ||
    revenueModes[1] !== "PLATFORM_ADVERTISING" ||
    value.territory !== "WORLDWIDE" ||
    value.account_id !== "pulse-gaming-youtube"
  ) {
    fail(`${prefix}_commercial_scope_invalid`);
  }
  return stableValue(value);
}

function validateMediaItem(value, prefix) {
  exactFields(value, MEDIA_ITEM_FIELDS, `${prefix}_fields_invalid`);
  const itemId = exactIdentifier(value.item_id, `${prefix}_item_id_invalid`);
  if (!ALLOWED_MEDIA_ROLES.has(value.media_role)) {
    fail(`${prefix}_media_role_invalid`);
  }
  const rightsBasis = value.rights_basis;
  if (
    value.included_in_final !== true ||
    value.rights_decision !== "CLEARED" ||
    !ALLOWED_RIGHTS_BASES.has(rightsBasis) ||
    value.review_status !== "VERIFIED" ||
    value.risk_decision !== null ||
    !["NOT_REQUIRED", "REQUIRED_AND_SUPPLIED"].includes(
      value.attribution_decision,
    ) ||
    (value.attribution_decision === "NOT_REQUIRED" &&
      value.attribution_text !== null) ||
    (value.attribution_decision === "REQUIRED_AND_SUPPLIED" &&
      !text(value.attribution_text))
  ) {
    fail(`${prefix}_clearance_invalid`);
  }
  const licenceDocumentSha256 =
    value.licence_document_sha256 === null
      ? null
      : exactSha256(
          value.licence_document_sha256,
          `${prefix}_licence_document_invalid`,
        );
  if (
    (OWNED_RIGHTS_BASES.has(rightsBasis) && licenceDocumentSha256 !== null) ||
    (LICENSED_RIGHTS_BASES.has(rightsBasis) && licenceDocumentSha256 === null)
  ) {
    fail(`${prefix}_licence_document_invalid`);
  }
  return {
    item_id: itemId,
    media_role: value.media_role,
    asset_sha256: exactSha256(
      value.asset_sha256,
      `${prefix}_asset_sha256_invalid`,
    ),
    included_in_final: true,
    rights_decision: "CLEARED",
    rights_basis: rightsBasis,
    rights_evidence_sha256: exactSha256(
      value.rights_evidence_sha256,
      `${prefix}_rights_evidence_sha256_invalid`,
    ),
    licence_document_sha256: licenceDocumentSha256,
    review_status: "VERIFIED",
    risk_decision: null,
    attribution_decision: value.attribution_decision,
    attribution_text:
      value.attribution_decision === "NOT_REQUIRED"
        ? null
        : text(value.attribution_text),
    scope: validateScope(value.scope, prefix),
  };
}

function validateFinalMediaInventory(value, request) {
  exactFields(
    value,
    FINAL_MEDIA_INVENTORY_FIELDS,
    "autonomous_green_supplement_final_media_inventory_fields_invalid",
  );
  if (value.schema_version !== FINAL_MEDIA_INVENTORY_SCHEMA_VERSION) {
    fail("autonomous_green_supplement_final_media_inventory_schema_invalid");
  }
  exactIdentity(
    value,
    request,
    "autonomous_green_supplement_final_media_inventory",
  );
  if (value.platform !== PLATFORM) {
    fail("autonomous_green_supplement_final_media_inventory_platform_invalid");
  }
  const generatedAt = exactTimestamp(
    value.generated_at,
    "autonomous_green_supplement_final_media_inventory_generated_at_invalid",
  );
  assertNotAfter(
    generatedAt,
    request.generated_at,
    "autonomous_green_supplement_final_media_inventory_from_future",
  );
  const rawItems = exactArray(
    value.items,
    "autonomous_green_supplement_final_media_items_invalid",
  );
  if (
    value.complete !== true ||
    !Number.isSafeInteger(value.item_count) ||
    value.item_count !== rawItems.length ||
    rawItems.length < 2
  ) {
    fail("autonomous_green_supplement_complete_final_media_required");
  }
  const itemIds = new Set();
  const assetSha256s = new Set();
  const rightsSha256s = new Set();
  const items = rawItems.map((item, index) => {
    const normalised = validateMediaItem(
      item,
      `autonomous_green_supplement_final_media_item_${index}`,
    );
    if (itemIds.has(normalised.item_id)) {
      fail("autonomous_green_supplement_final_media_item_id_duplicate");
    }
    if (assetSha256s.has(normalised.asset_sha256)) {
      fail("autonomous_green_supplement_final_media_asset_digest_reuse");
    }
    if (rightsSha256s.has(normalised.rights_evidence_sha256)) {
      fail("autonomous_green_supplement_rights_evidence_digest_reuse");
    }
    itemIds.add(normalised.item_id);
    assetSha256s.add(normalised.asset_sha256);
    rightsSha256s.add(normalised.rights_evidence_sha256);
    return normalised;
  });
  items.sort((left, right) => left.item_id.localeCompare(right.item_id));
  const narrationSha256 = exactSha256(
    value.narration_sha256,
    "autonomous_green_supplement_inventory_narration_invalid",
  );
  const narrationItems = items.filter(
    (item) =>
      item.media_role === "NARRATION" && item.asset_sha256 === narrationSha256,
  );
  const visualItems = items.filter((item) =>
    ["VISUAL", "MOTION", "SOURCE_MEDIA"].includes(item.media_role),
  );
  if (narrationItems.length !== 1 || !visualItems.length) {
    fail("autonomous_green_supplement_complete_final_media_required");
  }
  return {
    script_sha256: exactSha256(
      value.script_sha256,
      "autonomous_green_supplement_inventory_script_invalid",
    ),
    narration_sha256: narrationSha256,
    timestamps_sha256: exactSha256(
      value.timestamps_sha256,
      "autonomous_green_supplement_inventory_timestamps_invalid",
    ),
    final_mp4_sha256: exactSha256(
      value.final_mp4_sha256,
      "autonomous_green_supplement_inventory_final_mp4_invalid",
    ),
    items,
  };
}

function validatePromptInjectionControl(value, request) {
  exactFields(
    value,
    PROMPT_INJECTION_CONTROL_FIELDS,
    "autonomous_green_supplement_prompt_injection_control_fields_invalid",
  );
  if (value.schema_version !== PROMPT_INJECTION_CONTROL_SCHEMA_VERSION) {
    fail("autonomous_green_supplement_prompt_injection_control_schema_invalid");
  }
  exactIdentity(
    value,
    request,
    "autonomous_green_supplement_prompt_injection_control",
  );
  const evaluatedAt = exactTimestamp(
    value.evaluated_at,
    "autonomous_green_supplement_prompt_injection_control_time_invalid",
  );
  assertNotAfter(
    evaluatedAt,
    request.generated_at,
    "autonomous_green_supplement_prompt_injection_control_from_future",
  );
  const signals = exactArray(
    value.signals,
    "autonomous_green_supplement_prompt_injection_signals_invalid",
  );
  if (
    !text(value.policy_id) ||
    value.untrusted_content_treated_as_data !== true ||
    value.instructions_followed_from_source !== false ||
    value.detected !== false ||
    signals.length !== 0 ||
    value.verdict !== "PASS"
  ) {
    fail("autonomous_green_supplement_prompt_injection_pass_required");
  }
  return {
    source_intake_sha256: exactSha256(
      value.source_intake_sha256,
      "autonomous_green_supplement_prompt_injection_source_invalid",
    ),
    verdict: "PASS",
  };
}

function comparableRightsItem(item) {
  const { media_role: _mediaRole, ...value } = item;
  return value;
}

function rightsLedgerSha256(request, items) {
  return canonicalSha256({
    schema_version: RIGHTS_LEDGER_SCHEMA_VERSION,
    story_id: request.story_id,
    channel_id: request.channel_id,
    lane_id: request.lane_id,
    decision: "CLEARED",
    items: items.map(comparableRightsItem),
  });
}

function validatePackage(value, request) {
  exactFields(
    value,
    PACKAGE_FIELDS,
    "autonomous_green_supplement_package_fields_invalid",
  );
  if (
    value.schema_version !== AUTONOMOUS_PACKAGE_MANIFEST_SCHEMA_VERSION ||
    value.mode !== MODE
  ) {
    fail("autonomous_green_supplement_package_schema_invalid");
  }
  exactIdentity(value, request, "autonomous_green_supplement_package");
  if (
    value.platform !== PLATFORM ||
    exactTimestamp(
      value.generated_at,
      "autonomous_green_supplement_package_generated_at_invalid",
    ) !== request.generated_at
  ) {
    fail("autonomous_green_supplement_package_binding_invalid");
  }
  exactFields(
    value.lineage,
    new Set(LINEAGE_FIELDS),
    "autonomous_green_supplement_package_lineage_fields_invalid",
  );
  const lineage = Object.fromEntries(
    LINEAGE_FIELDS.map((field) => [
      field,
      exactSha256(
        value.lineage[field],
        `autonomous_green_supplement_package_${field}_invalid`,
      ),
    ]),
  );
  exactFields(
    value.controls,
    PACKAGE_CONTROL_FIELDS,
    "autonomous_green_supplement_package_controls_fields_invalid",
  );
  if (
    value.controls.local_proof_only !== true ||
    value.controls.publish_authority !== false ||
    value.controls.scheduler_authority !== false ||
    value.controls.database_authority !== false ||
    value.controls.oauth_or_token_authority !== false ||
    value.controls.network_authority !== false
  ) {
    fail("autonomous_green_supplement_package_no_authority_required");
  }
  const rawItems = exactArray(
    value.media_items,
    "autonomous_green_supplement_package_media_items_invalid",
  );
  if (!rawItems.length) {
    fail("autonomous_green_supplement_package_media_items_required");
  }
  const itemIds = new Set();
  const items = rawItems.map((item, index) => {
    const normalised = validateMediaItem(
      item,
      `autonomous_green_supplement_package_media_item_${index}`,
    );
    if (itemIds.has(normalised.item_id)) {
      fail("autonomous_green_supplement_package_media_item_id_duplicate");
    }
    itemIds.add(normalised.item_id);
    return normalised;
  });
  items.sort((left, right) => left.item_id.localeCompare(right.item_id));
  return {
    lineage,
    prompt_injection_control_sha256: exactSha256(
      value.prompt_injection_control_sha256,
      "autonomous_green_supplement_package_prompt_control_invalid",
    ),
    media_items: items,
  };
}

function validateRightsEvidence(value, request, expectedItem) {
  exactFields(
    value,
    RIGHTS_EVIDENCE_FIELDS,
    "autonomous_green_supplement_rights_evidence_fields_invalid",
  );
  if (value.schema_version !== MEDIA_RIGHTS_EVIDENCE_SCHEMA_VERSION) {
    fail("autonomous_green_supplement_rights_evidence_schema_invalid");
  }
  exactIdentity(value, request, "autonomous_green_supplement_rights_evidence");
  const expectedEvidence = {
    item_id: expectedItem.item_id,
    media_role: expectedItem.media_role,
    asset_sha256: expectedItem.asset_sha256,
    rights_decision: expectedItem.rights_decision,
    rights_basis: expectedItem.rights_basis,
    licence_document_sha256: expectedItem.licence_document_sha256,
    review_status: expectedItem.review_status,
    risk_decision: expectedItem.risk_decision,
    attribution_decision: expectedItem.attribution_decision,
    attribution_text: expectedItem.attribution_text,
    scope: expectedItem.scope,
  };
  const actualEvidence = {
    item_id: exactIdentifier(
      value.item_id,
      "autonomous_green_supplement_rights_evidence_item_id_invalid",
    ),
    media_role: value.media_role,
    asset_sha256: exactSha256(
      value.asset_sha256,
      "autonomous_green_supplement_rights_evidence_asset_invalid",
    ),
    rights_decision: value.rights_decision,
    rights_basis: value.rights_basis,
    licence_document_sha256:
      value.licence_document_sha256 === null
        ? null
        : exactSha256(
            value.licence_document_sha256,
            "autonomous_green_supplement_rights_evidence_licence_invalid",
          ),
    review_status: value.review_status,
    risk_decision: value.risk_decision,
    attribution_decision: value.attribution_decision,
    attribution_text: value.attribution_text,
    scope: validateScope(
      value.scope,
      "autonomous_green_supplement_rights_evidence",
    ),
  };
  if (
    JSON.stringify(stableValue(actualEvidence)) !==
    JSON.stringify(stableValue(expectedEvidence))
  ) {
    fail("autonomous_green_supplement_rights_evidence_binding_mismatch");
  }
}

function assertSameItems(left, right, code) {
  if (
    JSON.stringify(stableValue(left)) !== JSON.stringify(stableValue(right))
  ) {
    fail(code);
  }
}

function assertDistinctDigests(values, code) {
  if (new Set(values).size !== values.length) fail(code);
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function markdownBytes(supplement) {
  return Buffer.from(
    [
      "# Autonomous GREEN supplement",
      "",
      `- Story: ${supplement.story_id}`,
      `- Channel: ${supplement.channel_id}`,
      `- Lane: ${supplement.lane_id}`,
      `- Platform: ${supplement.platform}`,
      `- Mode: ${supplement.mode}`,
      `- Verdict: ${supplement.verdict}`,
      `- Supplement SHA-256: ${supplement.supplement_sha256}`,
      `- Governed claims: ${supplement.validated.claim_count}`,
      `- Actual word timestamps: ${supplement.validated.word_count}`,
      `- Final media items: ${supplement.validated.final_media_item_count}`,
      "",
      "This LOCAL_PROOF evidence grants no publish, scheduling, database, OAuth, token or network authority.",
      "",
    ].join("\n"),
    "utf8",
  );
}

async function readExistingOutput(fileSystem, filePath, expectedBytes) {
  let stat;
  try {
    stat = await fileSystem.lstat(filePath, { bigint: true });
  } catch {
    fail("autonomous_green_supplement_output_conflict");
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail("autonomous_green_supplement_output_conflict");
  }
  const bytes = await fileSystem.readFile(filePath);
  if (!bytes.equals(expectedBytes)) {
    fail("autonomous_green_supplement_output_conflict");
  }
}

async function acceptExactExistingOutput({
  fileSystem,
  outputDir,
  json,
  markdown,
}) {
  let stat;
  try {
    stat = await fileSystem.lstat(outputDir, { bigint: true });
  } catch {
    return false;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("autonomous_green_supplement_output_conflict");
  }
  const realPath = await fileSystem.realpath(outputDir);
  if (!samePath(realPath, outputDir)) {
    fail("autonomous_green_supplement_output_conflict");
  }
  const entries = (await fileSystem.readdir(outputDir)).sort();
  const expectedEntries = [OUTPUT_JSON_NAME, OUTPUT_MARKDOWN_NAME].sort();
  if (
    entries.length !== expectedEntries.length ||
    entries.some((entry, index) => entry !== expectedEntries[index])
  ) {
    fail("autonomous_green_supplement_output_conflict");
  }
  await readExistingOutput(
    fileSystem,
    path.join(outputDir, OUTPUT_JSON_NAME),
    json,
  );
  await readExistingOutput(
    fileSystem,
    path.join(outputDir, OUTPUT_MARKDOWN_NAME),
    markdown,
  );
  return true;
}

async function writeExclusive(fileSystem, filePath, bytes) {
  const handle = await fileSystem.open(filePath, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function materialiseExactOutput({
  fileSystem,
  outputDir,
  json,
  markdown,
}) {
  if (
    await acceptExactExistingOutput({
      fileSystem,
      outputDir,
      json,
      markdown,
    })
  ) {
    return;
  }
  const parent = path.dirname(outputDir);
  let parentStat;
  try {
    parentStat = await fileSystem.lstat(parent, { bigint: true });
  } catch {
    fail("autonomous_green_supplement_output_parent_invalid");
  }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    fail("autonomous_green_supplement_output_parent_invalid");
  }
  const parentRealPath = await fileSystem.realpath(parent);
  if (!samePath(parentRealPath, parent)) {
    fail("autonomous_green_supplement_output_parent_invalid");
  }
  const stagingDir = path.join(
    parent,
    `.${path.basename(outputDir)}.staging-${crypto.randomUUID()}`,
  );
  await fileSystem.mkdir(stagingDir, { recursive: false });
  try {
    await writeExclusive(
      fileSystem,
      path.join(stagingDir, OUTPUT_JSON_NAME),
      json,
    );
    await writeExclusive(
      fileSystem,
      path.join(stagingDir, OUTPUT_MARKDOWN_NAME),
      markdown,
    );
    try {
      await fileSystem.rename(stagingDir, outputDir);
    } catch (error) {
      if (!["EEXIST", "EPERM", "ENOTEMPTY"].includes(error?.code)) {
        throw error;
      }
      if (
        !(await acceptExactExistingOutput({
          fileSystem,
          outputDir,
          json,
          markdown,
        }))
      ) {
        fail("autonomous_green_supplement_output_conflict");
      }
    }
  } finally {
    await fileSystem
      .rm(stagingDir, { recursive: true, force: true })
      .catch(() => {});
  }
}

/**
 * Re-read and materialise the evidence missing from the autonomous GREEN
 * evaluator's hash-only contract. This seam is deliberately LOCAL_PROOF-only
 * and has no database, OAuth, network, scheduler or platform dependency.
 */
async function materialiseAutonomousGreenSupplement(value, options = {}) {
  const request = normaliseRequest(value);
  const fileSystem = options.fileSystem || defaultFileSystem;
  const claimMapObservation = await readHashBoundFile({
    reference: request.claim_map,
    label: "autonomous_green_supplement_claim_map",
    json: true,
    fileSystem,
  });
  const timestampsObservation = await readHashBoundFile({
    reference: request.word_timestamps,
    label: "autonomous_green_supplement_word_timestamps",
    json: true,
    fileSystem,
  });
  const inventoryObservation = await readHashBoundFile({
    reference: request.final_media_inventory,
    label: "autonomous_green_supplement_final_media_inventory",
    json: true,
    fileSystem,
  });
  const promptControlObservation = await readHashBoundFile({
    reference: request.prompt_injection_control,
    label: "autonomous_green_supplement_prompt_injection_control",
    json: true,
    fileSystem,
  });
  const packageObservation = await readHashBoundFile({
    reference: request.autonomous_package_manifest,
    label: "autonomous_green_supplement_package",
    json: true,
    fileSystem,
  });
  const claimMap = validateClaimMap(claimMapObservation.value, request);
  const timestamps = validateWordTimestamps(
    timestampsObservation.value,
    request,
  );
  const inventory = validateFinalMediaInventory(
    inventoryObservation.value,
    request,
  );
  const promptControl = validatePromptInjectionControl(
    promptControlObservation.value,
    request,
  );
  const autonomousPackage = validatePackage(packageObservation.value, request);

  if (
    claimMap.script_sha256 !== timestamps.script_sha256 ||
    claimMap.script_sha256 !== inventory.script_sha256 ||
    timestamps.narration_sha256 !== inventory.narration_sha256 ||
    inventory.timestamps_sha256 !== timestampsObservation.sha256
  ) {
    fail("autonomous_green_supplement_editorial_media_lineage_mismatch");
  }
  if (promptControl.source_intake_sha256 !== claimMap.source_intake_sha256) {
    fail("autonomous_green_supplement_prompt_source_lineage_mismatch");
  }
  assertSameItems(
    autonomousPackage.media_items,
    inventory.items,
    "autonomous_green_supplement_package_media_inventory_mismatch",
  );
  const lineage = autonomousPackage.lineage;
  const expectedLineage = {
    source_intake_sha256: claimMap.source_intake_sha256,
    claim_map_sha256: claimMapObservation.sha256,
    script_sha256: claimMap.script_sha256,
    narration_sha256: inventory.narration_sha256,
    timestamps_sha256: timestampsObservation.sha256,
    media_inventory_sha256: inventoryObservation.sha256,
    rights_ledger_sha256: rightsLedgerSha256(request, inventory.items),
    final_mp4_sha256: inventory.final_mp4_sha256,
  };
  for (const [field, expected] of Object.entries(expectedLineage)) {
    if (lineage[field] !== expected) {
      fail(`autonomous_green_supplement_${field}_binding_mismatch`);
    }
  }
  if (
    autonomousPackage.prompt_injection_control_sha256 !==
    promptControlObservation.sha256
  ) {
    fail("autonomous_green_supplement_prompt_control_binding_mismatch");
  }

  const lineageDigests = [
    ...LINEAGE_FIELDS.map((field) => lineage[field]),
    packageObservation.sha256,
    promptControlObservation.sha256,
  ];
  assertDistinctDigests(
    lineageDigests,
    "autonomous_green_supplement_lineage_digest_reuse",
  );

  const itemById = new Map(inventory.items.map((item) => [item.item_id, item]));
  if (
    request.media_rights_evidence.length !== itemById.size ||
    request.media_rights_evidence.some(
      (reference) => !itemById.has(reference.item_id),
    )
  ) {
    fail("autonomous_green_supplement_rights_inventory_incomplete");
  }
  const rightsObservations = [];
  for (const reference of request.media_rights_evidence) {
    const expectedItem = itemById.get(reference.item_id);
    const rightsObservation = await readHashBoundFile({
      reference: reference.rights_evidence,
      label: `autonomous_green_supplement_rights_${reference.item_id}`,
      json: true,
      fileSystem,
    });
    if (rightsObservation.sha256 !== expectedItem.rights_evidence_sha256) {
      fail("autonomous_green_supplement_rights_evidence_binding_mismatch");
    }
    validateRightsEvidence(rightsObservation.value, request, expectedItem);
    let licenceObservation = null;
    if (reference.licence_document) {
      licenceObservation = await readHashBoundFile({
        reference: reference.licence_document,
        label: `autonomous_green_supplement_licence_${reference.item_id}`,
        json: false,
        fileSystem,
      });
    }
    if (
      (expectedItem.licence_document_sha256 === null &&
        licenceObservation !== null) ||
      (expectedItem.licence_document_sha256 !== null &&
        licenceObservation?.sha256 !== expectedItem.licence_document_sha256)
    ) {
      fail("autonomous_green_supplement_licence_document_binding_mismatch");
    }
    rightsObservations.push({
      item_id: reference.item_id,
      rights_evidence: rightsObservation,
      licence_document: licenceObservation,
    });
  }
  rightsObservations.sort((left, right) =>
    left.item_id.localeCompare(right.item_id),
  );

  const rightsDigests = rightsObservations.map(
    (item) => item.rights_evidence.sha256,
  );
  const licenceDigests = rightsObservations
    .map((item) => item.licence_document?.sha256)
    .filter(Boolean);
  assertDistinctDigests(
    rightsDigests,
    "autonomous_green_supplement_rights_evidence_digest_reuse",
  );
  assertDistinctDigests(
    licenceDigests,
    "autonomous_green_supplement_licence_document_digest_reuse",
  );
  const protectedDigests = new Set([
    ...lineageDigests,
    promptControlObservation.sha256,
    ...inventory.items.map((item) => item.asset_sha256),
  ]);
  if (
    [...rightsDigests, ...licenceDigests].some((digest) =>
      protectedDigests.has(digest),
    ) ||
    licenceDigests.some((digest) => rightsDigests.includes(digest))
  ) {
    fail("autonomous_green_supplement_rights_evidence_digest_reuse");
  }

  const hashes = {
    ...lineage,
    package_manifest_sha256: packageObservation.sha256,
  };
  const materialisedMediaItems = inventory.items.map(
    ({ media_role: _mediaRole, ...item }) => item,
  );
  const supplementBase = stableValue({
    schema_version: SUPPLEMENT_SCHEMA_VERSION,
    generated_at: request.generated_at,
    mode: MODE,
    verdict: "GREEN",
    authority_scope: "LOCAL_PROOF_EVIDENCE_ONLY",
    story_id: request.story_id,
    channel_id: request.channel_id,
    lane_id: request.lane_id,
    platform: request.platform,
    hashes,
    prompt_injection: {
      verdict: "PASS",
      control_proof_sha256: promptControlObservation.sha256,
    },
    artifacts: {
      claim_map: {
        path: claimMapObservation.path,
        sha256: claimMapObservation.sha256,
        size_bytes: claimMapObservation.size_bytes,
      },
      word_timestamps: {
        path: timestampsObservation.path,
        sha256: timestampsObservation.sha256,
        size_bytes: timestampsObservation.size_bytes,
      },
      final_media_inventory: {
        path: inventoryObservation.path,
        sha256: inventoryObservation.sha256,
        size_bytes: inventoryObservation.size_bytes,
      },
      prompt_injection_control: {
        path: promptControlObservation.path,
        sha256: promptControlObservation.sha256,
        size_bytes: promptControlObservation.size_bytes,
      },
      autonomous_package_manifest: {
        path: packageObservation.path,
        sha256: packageObservation.sha256,
        size_bytes: packageObservation.size_bytes,
      },
      media_rights_evidence: rightsObservations.map((item) => ({
        item_id: item.item_id,
        rights_evidence: {
          path: item.rights_evidence.path,
          sha256: item.rights_evidence.sha256,
          size_bytes: item.rights_evidence.size_bytes,
        },
        licence_document: item.licence_document
          ? {
              path: item.licence_document.path,
              sha256: item.licence_document.sha256,
              size_bytes: item.licence_document.size_bytes,
            }
          : null,
      })),
    },
    media_items: materialisedMediaItems,
    validated: {
      claim_count: claimMap.claims.length,
      word_count: timestamps.word_count,
      final_media_item_count: inventory.items.length,
      final_media_inventory_complete: true,
      prompt_injection_verdict: "PASS",
      distinct_lineage_digests: true,
      distinct_rights_evidence_digests: true,
    },
    safety: {
      local_proof_only: true,
      publish_authority: false,
      scheduler_authority: false,
      database_authority: false,
      oauth_or_token_authority: false,
      network_authority: false,
      network_used: false,
      platform_contacted: false,
    },
  });
  const supplement = {
    ...supplementBase,
    supplement_sha256: canonicalSha256(supplementBase),
  };
  const outputJson = jsonBytes(supplement);
  const outputMarkdown = markdownBytes(supplement);
  await materialiseExactOutput({
    fileSystem,
    outputDir: request.output_dir,
    json: outputJson,
    markdown: outputMarkdown,
  });
  return Object.freeze({
    ...supplement,
    json_path: path.join(request.output_dir, OUTPUT_JSON_NAME),
    json_file_sha256: sha256Bytes(outputJson),
    markdown_path: path.join(request.output_dir, OUTPUT_MARKDOWN_NAME),
    markdown_file_sha256: sha256Bytes(outputMarkdown),
  });
}

module.exports = {
  AUTONOMOUS_PACKAGE_MANIFEST_SCHEMA_VERSION,
  AutonomousGreenSupplementMaterializerError,
  CLAIM_MAP_SCHEMA_VERSION,
  FINAL_MEDIA_INVENTORY_SCHEMA_VERSION,
  MEDIA_RIGHTS_EVIDENCE_SCHEMA_VERSION,
  PROMPT_INJECTION_CONTROL_SCHEMA_VERSION,
  REQUEST_SCHEMA_VERSION,
  SUPPLEMENT_SCHEMA_VERSION,
  WORD_TIMESTAMPS_SCHEMA_VERSION,
  canonicalSha256,
  materialiseAutonomousGreenSupplement,
};
