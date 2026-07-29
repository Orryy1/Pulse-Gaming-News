"use strict";

const crypto = require("node:crypto");
const { types: utilTypes } = require("node:util");

const EVIDENCE_SCHEMA_VERSION = "pulse-autonomous-green-admission-evidence-v2";
const EVALUATOR_SCHEMA_VERSION =
  "pulse-autonomous-green-admission-evaluator-v2";
const RESULT_SCHEMA_VERSION = "pulse-autonomous-green-admission-result-v2";
const POLICY_VERSION = "pulse-autonomous-green-policy-v2";
const MAX_REVERIFICATION_AGE_MS = 30 * 60 * 1000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CANONICAL_UTC_RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SENTINEL_SHA256S = new Set([
  "deadbeef".repeat(8),
  "cafebabe".repeat(8),
  crypto.createHash("sha256").update("").digest("hex"),
]);

const TOP_LEVEL_FIELDS = new Set([
  "schema_version",
  "story",
  "freshness",
  "prompt_injection",
  "hashes",
  "qa",
  "renderer",
  "package_binding",
  "synthetic_media_disclosure",
  "commercial_scope",
  "media_items",
]);
const STORY_FIELDS = new Set([
  "story_id",
  "channel_id",
  "lane_id",
  "platform",
  "source_type",
  "primary_source",
  "verification_status",
  "content_classification",
  "rumour",
]);
const FRESHNESS_FIELDS = new Set([
  "discovered_at",
  "source_last_checked_at",
  "publish_by",
  "stale_after",
  "valid_until",
  "reverification_required",
  "stale_reframe_option",
]);
const STALE_REFRAME_FIELDS = new Set(["allowed", "reason"]);
const PROMPT_INJECTION_FIELDS = new Set(["verdict"]);
const HASH_FIELDS = new Set([
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
  "package_manifest_sha256",
]);
const QA_FIELDS = new Set([
  "story_id",
  "report_sha256",
  "final_mp4_sha256",
  "verdict",
  "blockers",
]);
const RENDERER_FIELDS = new Set([
  "story_id",
  "manifest_sha256",
  "final_mp4_sha256",
  "script_sha256",
  "narration_sha256",
  "timestamps_sha256",
  "media_inventory_sha256",
  "rights_ledger_sha256",
  "motion_manifest_sha256",
  "verdict",
  "publishable",
  "blockers",
]);
const PACKAGE_BINDING_FIELDS = new Set(["story_id", ...HASH_FIELDS]);
const DISCLOSURE_FIELDS = new Set([
  "contains_synthetic_media",
  "disclosure_required",
  "decision",
  "youtube_field_value",
]);
const SCOPE_FIELDS = new Set([
  "destinations",
  "revenue_modes",
  "territory",
  "account_id",
]);
const COMMERCIAL_SCOPE_FIELDS = new Set([
  ...SCOPE_FIELDS,
  "sponsor",
  "affiliate",
  "client",
  "paid_access",
]);
const MEDIA_ITEM_FIELDS = new Set([
  "item_id",
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
const OWNED_RIGHTS_BASES = new Set(["OWNED", "OWNED_CAPTURE"]);
const AUTOMATIC_RIGHTS_BASES = new Set([
  "OWNED",
  "OWNED_CAPTURE",
  "LICENSED",
  "EXPLICIT_LICENCE",
  "PRESS_KIT_TERMS",
  "PLATFORM_PROMOTIONAL_TERMS",
]);
const AUTOMATIC_REVIEW_STATUSES = new Set(["VERIFIED"]);
const ATTRIBUTION_DECISIONS = new Set([
  "NOT_REQUIRED",
  "REQUIRED_AND_SUPPLIED",
]);
const UNSAFE_BLOCKERS = new Set([
  "evidence_not_canonical_json",
  "pulse_gaming_channel_required",
  "breaking_short_lane_required",
  "youtube_platform_required",
  "official_primary_non_rumour_story_required",
  "prompt_injection_pass_required",
]);
const STALE_BLOCKERS = new Set([
  "source_reverification_stale",
  "story_stale",
  "evidence_validity_expired",
]);

function text(value) {
  return String(value ?? "").trim();
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
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

function isCanonicalJsonValue(value, ancestors = new Set()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && !Object.is(value, -0);
  }
  if (typeof value !== "object") return false;
  if (utilTypes.isProxy(value)) return false;
  if (ancestors.has(value)) return false;

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return false;
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.some((key) => typeof key !== "string")) return false;
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) return false;
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (
          !descriptor ||
          !descriptor.enumerable ||
          !Object.hasOwn(descriptor, "value") ||
          !isCanonicalJsonValue(descriptor.value, ancestors)
        ) {
          return false;
        }
      }
      return ownKeys.every(
        (key) =>
          key === "length" ||
          (/^(0|[1-9]\d*)$/.test(key) &&
            Number(key) < value.length &&
            String(Number(key)) === key),
      );
    }

    if (Object.getPrototypeOf(value) !== Object.prototype) return false;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value") ||
        !isCanonicalJsonValue(descriptor.value, ancestors)
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  } finally {
    ancestors.delete(value);
  }
}

function canonicalSha256(value) {
  if (!isCanonicalJsonValue(value)) {
    throw new TypeError("value_not_canonical_json");
  }
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function detachedCanonicalJson(value) {
  if (!isCanonicalJsonValue(value)) return null;
  try {
    return {
      value: JSON.parse(JSON.stringify(value)),
    };
  } catch {
    return null;
  }
}

function isEvidenceSha256(value) {
  if (typeof value !== "string") return false;
  const candidate = value;
  if (!SHA256_PATTERN.test(candidate)) return false;
  if (/^([a-f0-9])\1{63}$/.test(candidate)) return false;
  return !SENTINEL_SHA256S.has(candidate);
}

function trustedClockTimestamp(options, blockers) {
  if (typeof options?.clock !== "function") {
    blockers.push("trusted_clock_required");
    return null;
  }
  try {
    const now = options.clock();
    if (now instanceof Date) {
      const value = Date.prototype.getTime.call(now);
      if (Number.isFinite(value)) return value;
    }
  } catch {
    // The fail-closed blocker below is the public outcome.
  }
  blockers.push("trusted_clock_invalid");
  return null;
}

function editorialDecision({
  evaluatedAt,
  validUntil,
  storyId,
  finalMp4Sha256,
  verdict,
  blockers,
  evidenceSha256,
}) {
  const decisionPayload = {
    result_schema_version: RESULT_SCHEMA_VERSION,
    evaluator_schema_version: EVALUATOR_SCHEMA_VERSION,
    policy_version: POLICY_VERSION,
    decision_scope: "EDITORIAL_ELIGIBILITY_ONLY",
    operational_publish_authority: false,
    trust_semantics: "AUTHORITATIVE_MATERIALISER_REQUIRED",
    dispatch_revalidation_required: true,
    evaluated_at:
      evaluatedAt === null ? null : new Date(evaluatedAt).toISOString(),
    valid_until:
      validUntil === null ? null : new Date(validUntil).toISOString(),
    story_id: storyId || null,
    final_mp4_sha256: finalMp4Sha256 || null,
    verdict,
    eligible: verdict === "GREEN",
    blockers,
    evidence_sha256: evidenceSha256,
  };
  return {
    ...decisionPayload,
    decision_sha256: canonicalSha256(decisionPayload),
  };
}

function exactObject(value, fields, prefix, blockers) {
  const candidate = object(value);
  if (!candidate) {
    blockers.push(`${prefix}_object_required`);
    return null;
  }
  const keys = Object.keys(candidate);
  if (keys.some((key) => !fields.has(key))) {
    blockers.push(`${prefix}_schema_closed`);
  }
  for (const field of fields) {
    if (!Object.hasOwn(candidate, field)) {
      blockers.push(`${prefix}_${field}_required`);
    }
  }
  return candidate;
}

function timestamp(value, code, blockers) {
  const raw = typeof value === "string" ? value : "";
  const parsed = Date.parse(raw);
  if (
    !CANONICAL_UTC_RFC3339_PATTERN.test(raw) ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== raw
  ) {
    blockers.push(code);
    return null;
  }
  return parsed;
}

function exactScope(value, fields, prefix, blockers) {
  const scope = exactObject(value, fields, prefix, blockers);
  if (!scope) return null;
  const destinations = Array.isArray(scope.destinations)
    ? scope.destinations.map((item) => text(item).toUpperCase())
    : [];
  const revenueModes = Array.isArray(scope.revenue_modes)
    ? scope.revenue_modes.map((item) => text(item).toUpperCase())
    : [];
  if (destinations.length !== 1 || destinations[0] !== "YOUTUBE") {
    blockers.push(`${prefix}_youtube_destination_required`);
  }
  if (
    revenueModes.length !== 2 ||
    new Set(revenueModes).size !== 2 ||
    !revenueModes.includes("ORGANIC") ||
    !revenueModes.includes("PLATFORM_ADVERTISING")
  ) {
    blockers.push(`${prefix}_organic_platform_ad_scope_required`);
  }
  const territory = text(scope.territory).toUpperCase();
  const accountId = text(scope.account_id);
  if (!territory) blockers.push(`${prefix}_territory_required`);
  if (!accountId) blockers.push(`${prefix}_account_id_required`);
  return {
    destinations,
    revenueModes,
    territory,
    accountId,
  };
}

function evaluateAutonomousGreenAdmission(evidence, options = {}) {
  const blockers = [];
  const evaluatedAt = trustedClockTimestamp(options, blockers);
  const detachedEvidence = detachedCanonicalJson(evidence);
  if (!detachedEvidence) {
    blockers.push("evidence_not_canonical_json");
    return editorialDecision({
      evaluatedAt,
      validUntil: null,
      storyId: null,
      finalMp4Sha256: null,
      verdict: "SKIP_UNSAFE",
      blockers: [...new Set(blockers)].sort(),
      evidenceSha256: null,
    });
  }
  const evidenceSnapshot = detachedEvidence.value;
  const evidenceSha256 = canonicalSha256(evidenceSnapshot);
  const input = exactObject(
    evidenceSnapshot,
    TOP_LEVEL_FIELDS,
    "evidence",
    blockers,
  );
  if (input?.schema_version !== EVIDENCE_SCHEMA_VERSION) {
    blockers.push("evidence_schema_version_invalid");
  }

  const story = exactObject(input?.story, STORY_FIELDS, "story", blockers);
  if (!text(story?.story_id)) blockers.push("story_id_required");
  if (story && text(story.channel_id) !== "pulse-gaming") {
    blockers.push("pulse_gaming_channel_required");
  }
  if (story && text(story.lane_id) !== "breaking_short") {
    blockers.push("breaking_short_lane_required");
  }
  if (story && text(story.platform).toLowerCase() !== "youtube") {
    blockers.push("youtube_platform_required");
  }
  if (
    story &&
    (text(story.source_type).toUpperCase() !== "OFFICIAL" ||
      story.primary_source !== true ||
      text(story.verification_status).toUpperCase() !== "CONFIRMED" ||
      text(story.content_classification).toUpperCase() !== "CONFIRMED_NEWS" ||
      story.rumour !== false)
  ) {
    blockers.push("official_primary_non_rumour_story_required");
  }

  const freshness = exactObject(
    input?.freshness,
    FRESHNESS_FIELDS,
    "freshness",
    blockers,
  );
  const staleReframe = exactObject(
    freshness?.stale_reframe_option,
    STALE_REFRAME_FIELDS,
    "freshness_stale_reframe",
    blockers,
  );
  const discoveredAt = timestamp(
    freshness?.discovered_at,
    "freshness_discovered_at_invalid",
    blockers,
  );
  const sourceLastCheckedAt = timestamp(
    freshness?.source_last_checked_at,
    "freshness_source_last_checked_at_invalid",
    blockers,
  );
  const publishBy = timestamp(
    freshness?.publish_by,
    "freshness_publish_by_invalid",
    blockers,
  );
  const staleAfter = timestamp(
    freshness?.stale_after,
    "freshness_stale_after_invalid",
    blockers,
  );
  const validUntil = timestamp(
    freshness?.valid_until,
    "freshness_valid_until_invalid",
    blockers,
  );
  if (freshness?.reverification_required !== true) {
    blockers.push("freshness_reverification_required");
  }
  if (
    typeof staleReframe?.allowed !== "boolean" ||
    !text(staleReframe?.reason)
  ) {
    blockers.push("freshness_stale_reframe_invalid");
  }
  if (
    evaluatedAt !== null &&
    discoveredAt !== null &&
    sourceLastCheckedAt !== null &&
    publishBy !== null &&
    staleAfter !== null &&
    validUntil !== null
  ) {
    if (
      discoveredAt > sourceLastCheckedAt ||
      sourceLastCheckedAt > evaluatedAt ||
      publishBy > staleAfter
    ) {
      blockers.push("freshness_order_invalid");
    }
    if (
      validUntil <= sourceLastCheckedAt ||
      validUntil > sourceLastCheckedAt + MAX_REVERIFICATION_AGE_MS ||
      validUntil > publishBy ||
      validUntil > staleAfter
    ) {
      blockers.push("freshness_valid_until_invalid");
    }
    if (evaluatedAt - sourceLastCheckedAt > MAX_REVERIFICATION_AGE_MS) {
      blockers.push("source_reverification_stale");
    }
    if (evaluatedAt >= publishBy || evaluatedAt >= staleAfter) {
      blockers.push("story_stale");
    }
    if (evaluatedAt >= validUntil) {
      blockers.push("evidence_validity_expired");
    }
  }

  const promptInjection = exactObject(
    input?.prompt_injection,
    PROMPT_INJECTION_FIELDS,
    "prompt_injection",
    blockers,
  );
  if (
    promptInjection &&
    text(promptInjection.verdict).toUpperCase() !== "PASS"
  ) {
    blockers.push("prompt_injection_pass_required");
  }

  const hashes = exactObject(input?.hashes, HASH_FIELDS, "hashes", blockers);
  for (const field of HASH_FIELDS) {
    if (!isEvidenceSha256(hashes?.[field])) {
      blockers.push(`${field}_required`);
    }
  }
  const lineageDigests = [...HASH_FIELDS].map((field) => hashes?.[field]);
  const lineageDigestSet = new Set(lineageDigests);
  if (
    lineageDigests.every(isEvidenceSha256) &&
    lineageDigestSet.size !== lineageDigests.length
  ) {
    blockers.push("lineage_digest_reuse");
  }

  const qa = exactObject(input?.qa, QA_FIELDS, "qa", blockers);
  if (
    qa &&
    (text(qa.story_id) !== text(story?.story_id) ||
      text(qa.report_sha256).toLowerCase() !==
        text(hashes?.qa_report_sha256).toLowerCase() ||
      text(qa.final_mp4_sha256).toLowerCase() !==
        text(hashes?.final_mp4_sha256).toLowerCase())
  ) {
    blockers.push("qa_lineage_mismatch");
  }
  if (
    !["GREEN", "PASS"].includes(text(qa?.verdict).toUpperCase()) ||
    !Array.isArray(qa?.blockers) ||
    qa.blockers.length !== 0
  ) {
    blockers.push("qa_green_required");
  }
  const renderer = exactObject(
    input?.renderer,
    RENDERER_FIELDS,
    "renderer",
    blockers,
  );
  if (
    renderer &&
    (text(renderer.story_id) !== text(story?.story_id) ||
      text(renderer.manifest_sha256).toLowerCase() !==
        text(hashes?.render_manifest_sha256).toLowerCase() ||
      text(renderer.final_mp4_sha256).toLowerCase() !==
        text(hashes?.final_mp4_sha256).toLowerCase() ||
      text(renderer.script_sha256).toLowerCase() !==
        text(hashes?.script_sha256).toLowerCase() ||
      text(renderer.narration_sha256).toLowerCase() !==
        text(hashes?.narration_sha256).toLowerCase() ||
      text(renderer.timestamps_sha256).toLowerCase() !==
        text(hashes?.timestamps_sha256).toLowerCase() ||
      text(renderer.media_inventory_sha256).toLowerCase() !==
        text(hashes?.media_inventory_sha256).toLowerCase() ||
      text(renderer.rights_ledger_sha256).toLowerCase() !==
        text(hashes?.rights_ledger_sha256).toLowerCase() ||
      text(renderer.motion_manifest_sha256).toLowerCase() !==
        text(hashes?.motion_manifest_sha256).toLowerCase())
  ) {
    blockers.push("renderer_lineage_mismatch");
  }
  if (
    !["GREEN", "PASS"].includes(text(renderer?.verdict).toUpperCase()) ||
    renderer?.publishable !== true ||
    !Array.isArray(renderer?.blockers) ||
    renderer.blockers.length !== 0
  ) {
    blockers.push("renderer_green_required");
  }

  const packageBinding = exactObject(
    input?.package_binding,
    PACKAGE_BINDING_FIELDS,
    "package_binding",
    blockers,
  );
  if (
    packageBinding &&
    (text(packageBinding.story_id) !== text(story?.story_id) ||
      [...HASH_FIELDS].some(
        (field) =>
          text(packageBinding[field]).toLowerCase() !==
          text(hashes?.[field]).toLowerCase(),
      ))
  ) {
    blockers.push("package_binding_lineage_mismatch");
  }

  const disclosure = exactObject(
    input?.synthetic_media_disclosure,
    DISCLOSURE_FIELDS,
    "synthetic_media_disclosure",
    blockers,
  );
  if (
    disclosure?.contains_synthetic_media !== true ||
    disclosure?.disclosure_required !== true ||
    text(disclosure?.decision).toUpperCase() !== "DISCLOSE" ||
    disclosure?.youtube_field_value !== true
  ) {
    blockers.push("deterministic_synthetic_disclosure_required");
  }

  const commercialScope = exactScope(
    input?.commercial_scope,
    COMMERCIAL_SCOPE_FIELDS,
    "commercial_scope",
    blockers,
  );
  const commercialScopeInput = object(input?.commercial_scope);
  if (
    commercialScopeInput?.sponsor !== false ||
    commercialScopeInput?.affiliate !== false ||
    commercialScopeInput?.client !== false ||
    commercialScopeInput?.paid_access !== false
  ) {
    blockers.push("commercial_scope_non_ad_revenue_prohibited");
  }
  if (commercialScope?.territory !== "WORLDWIDE") {
    blockers.push("commercial_scope_worldwide_territory_required");
  }
  if (commercialScope?.accountId !== "pulse-gaming-youtube") {
    blockers.push("commercial_scope_pulse_account_required");
  }

  const mediaItems = Array.isArray(input?.media_items) ? input.media_items : [];
  if (!mediaItems.length) blockers.push("media_items_required");
  const seenItemIds = new Set();
  const seenAssetSha256s = new Set();
  const automaticRightsBlockers = [];
  mediaItems.forEach((rawItem, index) => {
    const prefix = `media_item_${index}`;
    const item = exactObject(rawItem, MEDIA_ITEM_FIELDS, prefix, blockers);
    const itemId = text(item?.item_id);
    const rightsBasis = text(item?.rights_basis).toUpperCase();
    const ownedAsset = OWNED_RIGHTS_BASES.has(rightsBasis);
    const assetScope = exactScope(
      item?.scope,
      SCOPE_FIELDS,
      `${prefix}_scope`,
      blockers,
    );
    const licenceScopeMatches =
      assetScope &&
      commercialScope &&
      assetScope.destinations.length === commercialScope.destinations.length &&
      assetScope.destinations.every(
        (destination, scopeIndex) =>
          destination === commercialScope.destinations[scopeIndex],
      ) &&
      assetScope.revenueModes.length === commercialScope.revenueModes.length &&
      assetScope.revenueModes.every(
        (mode, scopeIndex) => mode === commercialScope.revenueModes[scopeIndex],
      ) &&
      assetScope.territory === commercialScope.territory &&
      assetScope.accountId === commercialScope.accountId;
    if (!itemId) blockers.push(`${prefix}_item_id_required`);
    else if (seenItemIds.has(itemId)) {
      blockers.push("media_item_id_duplicate");
    } else {
      seenItemIds.add(itemId);
    }
    if (isEvidenceSha256(item?.asset_sha256)) {
      if (seenAssetSha256s.has(item.asset_sha256)) {
        blockers.push("media_asset_sha256_duplicate");
      } else {
        seenAssetSha256s.add(item.asset_sha256);
      }
    }
    if (
      item?.included_in_final !== true ||
      text(item?.rights_decision).toUpperCase() !== "CLEARED" ||
      !AUTOMATIC_RIGHTS_BASES.has(rightsBasis) ||
      !isEvidenceSha256(item?.asset_sha256) ||
      !isEvidenceSha256(item?.rights_evidence_sha256) ||
      item?.asset_sha256 === item?.rights_evidence_sha256 ||
      lineageDigestSet.has(item?.asset_sha256) ||
      lineageDigestSet.has(item?.rights_evidence_sha256) ||
      !licenceScopeMatches ||
      (ownedAsset
        ? item?.licence_document_sha256 !== null
        : !isEvidenceSha256(item?.licence_document_sha256) ||
          item?.licence_document_sha256 === item?.asset_sha256 ||
          lineageDigestSet.has(item?.licence_document_sha256)) ||
      !AUTOMATIC_REVIEW_STATUSES.has(text(item?.review_status).toUpperCase()) ||
      item?.risk_decision !== null ||
      !ATTRIBUTION_DECISIONS.has(text(item?.attribution_decision).toUpperCase())
    ) {
      const blocker = `${prefix}_automatic_rights_required`;
      blockers.push(blocker);
      automaticRightsBlockers.push(blocker);
    }
    if (
      text(item?.attribution_decision).toUpperCase() ===
        "REQUIRED_AND_SUPPLIED" &&
      !text(item?.attribution_text)
    ) {
      blockers.push(`${prefix}_attribution_text_required`);
    }
  });

  const exactBlockers = [...new Set(blockers)].sort();
  const automaticRightsBlockerSet = new Set(automaticRightsBlockers);
  const onlyAutomaticRightsFailures =
    exactBlockers.length > 0 &&
    exactBlockers.every((blocker) => automaticRightsBlockerSet.has(blocker));
  let verdict = "GREEN";
  if (
    exactBlockers.some(
      (blocker) =>
        blocker.endsWith("_schema_closed") || UNSAFE_BLOCKERS.has(blocker),
    )
  ) {
    verdict = "SKIP_UNSAFE";
  } else if (exactBlockers.some((blocker) => STALE_BLOCKERS.has(blocker))) {
    verdict = "SKIP_STALE";
  } else if (onlyAutomaticRightsFailures) {
    verdict =
      automaticRightsBlockerSet.size === mediaItems.length
        ? "REFRAME_OWNED_ONLY"
        : "SUBSTITUTE_OWNED";
  } else if (exactBlockers.length) {
    verdict = "HOLD";
  }
  return editorialDecision({
    evaluatedAt,
    validUntil,
    storyId: text(story?.story_id),
    finalMp4Sha256: text(hashes?.final_mp4_sha256).toLowerCase(),
    verdict,
    blockers: exactBlockers,
    evidenceSha256,
  });
}

module.exports = {
  EVIDENCE_SCHEMA_VERSION,
  EVALUATOR_SCHEMA_VERSION,
  MAX_REVERIFICATION_AGE_MS,
  POLICY_VERSION,
  RESULT_SCHEMA_VERSION,
  canonicalSha256,
  evaluateAutonomousGreenAdmission,
};
