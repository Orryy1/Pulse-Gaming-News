"use strict";

const crypto = require("node:crypto");

const {
  DEFAULT_ROTATION_POLICY,
  FORMAT_SHAPES,
  assessEvergreenVerdictCandidate,
  validEvergreenRightsSourceUrl,
} = require("../formats/evergreen-verdict-short");
const {
  editorialIdentityFor,
} = require("./governed-editorial-client");
const {
  hashEvergreenMotionRepairWorkOrder,
} = require("./evergreen-motion-repair-work-order");

const SCHEMA_VERSION = "pulse-evergreen-autonomous-discovery-v1";
const MOTION_REPAIR_WORK_ORDER_SCHEMA =
  "pulse-evergreen-motion-coverage-repair-work-order-v1";
const MODE = "LOCAL_PROOF";
const CANDIDATE_ID_VERSION = "evergreen-candidate-v1";
const GOOGLE_DISCOVERY_DEFAULT_MAX_OUTPUT_TOKENS = 8_192;
const DEFAULT_DISCOVERY_POLICY = Object.freeze({
  maximum_selected: 4,
  maximum_per_topic: 1,
  maximum_per_franchise: 1,
  maximum_per_shape: 2,
  maximum_per_platform: 2,
});
const ALLOWED_GENERATOR_OUTPUT_KEYS = Object.freeze(["pitches"]);
const ALLOWED_GENERATED_PITCH_KEYS = Object.freeze([
  "story_id",
  "title",
  "format_shape",
  "editorial_criteria",
  "item_rationales",
]);
const ALLOWED_RATIONALE_KEYS = Object.freeze([
  "subject",
  "judgement",
  "claim_ids",
]);
const CORRECTABLE_GENERATOR_STRUCTURAL_MINIMUM_BLOCKERS = new Set([
  "generated_pitch_editorial_criteria_too_thin",
  "generated_pitch_item_rationales_too_thin",
]);
const ADVERTISER_UNSAFE_PATTERNS = Object.freeze([
  {
    id: "graphic_gore",
    pattern: /\b(?:graphic\s+gore|gory\s+dismemberment)\b/i,
  },
  {
    id: "self_harm",
    pattern: /\b(?:suicide|self[-\s]?harm)\b/i,
  },
  {
    id: "sexual_violence",
    pattern: /\b(?:rape|sexual\s+assault)\b/i,
  },
  {
    id: "explicit_sexual_content",
    pattern: /\b(?:porn(?:ography)?|explicit\s+sexual\s+content)\b/i,
  },
  {
    id: "real_world_mass_violence",
    pattern: /\b(?:mass\s+shooting|terrorist\s+attack)\b/i,
  },
]);
const DEFENSIBLE_RIGHTS_BASES = new Set([
  "owned_capture",
  "licensed",
  "official_publisher_policy",
  "bounded_editorial_excerpt",
]);
const OFFICIAL_SOURCE_TIERS =
  /^(?:official_publisher|official_platform|official_storefront|first_party)$/i;

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normaliseGeneratorErrorCode(error) {
  const values = [error?.code, error?.message]
    .map((value) => text(value).toLowerCase())
    .filter(Boolean);
  if (
    error?.name === "AbortError" ||
    values.some((value) =>
      [
        "abort_err",
        "etimedout",
        "editorial_request_timeout",
      ].includes(value),
    )
  ) {
    return "editorial_request_timeout";
  }
  const exactCodes = new Map([
    ["editorial_transport_failed", "editorial_transport_failed"],
    ["editorial_request_too_large", "editorial_request_too_large"],
    ["editorial_response_too_large", "editorial_response_too_large"],
    [
      "editorial_response_invalid_json",
      "editorial_response_invalid_json",
    ],
    [
      "anthropic_json_response_missing",
      "editorial_response_text_missing",
    ],
    [
      "editorial_response_text_missing",
      "editorial_response_text_missing",
    ],
    ["editorial_prompt_blocked", "editorial_prompt_blocked"],
    ["editorial_candidate_blocked", "editorial_candidate_blocked"],
    [
      "editorial_request_profile_unsupported",
      "editorial_request_profile_unsupported",
    ],
    [
      "editorial_thinking_level_invalid",
      "editorial_thinking_level_invalid",
    ],
  ]);
  for (const value of values) {
    if (exactCodes.has(value)) return exactCodes.get(value);
    const httpStatus = /^editorial_http_status_(\d{3})$/.exec(value);
    if (httpStatus) {
      const status = Number(httpStatus[1]);
      if (status === 429) return "editorial_rate_limited";
      if (status >= 500) return "editorial_provider_unavailable";
      return "editorial_request_rejected";
    }
    if (/^editorial_finish_reason_[a-z0-9_]+$/.test(value)) {
      return "editorial_generation_incomplete";
    }
  }
  if (error?.name === "SyntaxError") {
    return "editorial_response_invalid_json";
  }
  return "editorial_generation_failed";
}

function isHttps(value) {
  try {
    return new URL(text(value)).protocol === "https:";
  } catch {
    return false;
  }
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/i.test(text(value));
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(stableJson(value))
    .digest("hex")}`;
}

function roundUpTenth(value) {
  return Math.ceil(Number(value) * 10) / 10;
}

function buildMotionCoverageRepairWorkOrder({
  story,
  pitch,
  now,
} = {}) {
  const targetDuration = Number(
    pitch?.script_contract?.target_duration_seconds,
  );
  const minimumRatio = Number(
    DEFAULT_ROTATION_POLICY.minimum_exact_subject_motion_ratio,
  );
  const mediaPlan = pitch?.media_plan || {};
  const verifiedMotionSeconds = Number(
    mediaPlan.exact_subject_motion_seconds,
  );
  const minimumRequiredMotionSeconds = roundUpTenth(
    targetDuration * minimumRatio,
  );
  const additionalMotionSecondsRequired = roundUpTenth(
    Math.max(
      0,
      minimumRequiredMotionSeconds - verifiedMotionSeconds,
    ),
  );
  const base = {
    schema_version: MOTION_REPAIR_WORK_ORDER_SCHEMA,
    generated_at: new Date(now).toISOString(),
    mode: MODE,
    story_id: text(story?.id),
    candidate_id: text(pitch?.id),
    candidate_title: text(pitch?.title),
    blocker: "exact_subject_motion_ratio_too_low",
    target_duration_seconds: targetDuration,
    minimum_exact_subject_motion_ratio: minimumRatio,
    minimum_required_motion_seconds: minimumRequiredMotionSeconds,
    verified_materialised_motion_seconds: verifiedMotionSeconds,
    additional_motion_seconds_required:
      additionalMotionSecondsRequired,
    baseline_rights_ledger_sha256: text(
      story?.rights_evidence?.ledger_sha256,
    ).toLowerCase(),
    baseline_rights_asset_ids: array(
      mediaPlan.rights_records,
    )
      .map((record) => text(record?.asset_id))
      .filter(Boolean)
      .sort(),
    completion_contract: {
      schema_version:
        "pulse-evergreen-motion-coverage-completion-v1",
      amended_rights_ledger_required: true,
      materialisation_receipt_required: true,
      parent_source_media_url_and_sha256_required: true,
      exact_extraction_window_binding_required: true,
      materialised_output_segment_sha256_required: true,
      amended_rights_ledger_new_canonical_sha256_required: true,
      full_amended_rights_ledger_inventory_required: true,
      materialised_video_probe_required: true,
      exact_story_and_candidate_binding_required: true,
      exact_subject_evidence_required: true,
      asset_file_sha256_required: true,
      rights_decision_cleared_required: true,
      defensible_rights_basis_required: true,
      baseline_assets_must_remain_hash_identical: true,
      duplicate_or_overlapping_motion_counted_once: true,
      static_images_count_as_motion_seconds: false,
      minimum_verified_motion_seconds:
        minimumRequiredMotionSeconds,
      minimum_additional_motion_seconds:
        additionalMotionSecondsRequired,
      required_artifact_filename:
        "evergreen-motion-coverage-completion.json",
      post_repair_validation:
        "Replay evergreen_candidate_builder. The autonomous input adapter must rehash the amended rights ledger and every materialised asset before this candidate may be reassessed.",
    },
    operator_action: {
      command:
        "node tools/evergreen-motion-repair-materialize.js --work-order <standalone-work-order.json> --source-video <already-local-official-source.mp4> --segments-file <segments.json> --source-media-url <official-source-url> --apply-local",
      instructions:
        "Materialise bounded exact-subject excerpts from an already-local source. The immutable receipt must bind the official parent media URL, parent source bytes, exact extraction windows and every muted output segment hash. The materialiser records probes and hashes but does not make a rights decision. Human review must separately create a complete amended CLEARED rights ledger that preserves every baseline item, adds exactly the materialised segments and has a new canonical SHA-256, then bind it in the completion manifest.",
      expected_output:
        "A hash-bound materialisation receipt plus local muted clips, followed by a completion manifest referencing the full amended rights ledger and its new canonical SHA-256. Parent source URL/bytes, exact windows, output bytes and every baseline/new ledger item must revalidate before the declared motion minimum can count.",
      database_mutation_required: false,
      operator_approval_required: true,
    },
    safety: {
      planning_only: true,
      local_proof_only: true,
      network_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
      platform_contact_authorised: false,
      approval_authority_created: false,
      scheduler_authority_created: false,
      publish_authority_created: false,
      external_posting_authorised: false,
    },
  };
  return {
    ...base,
    work_order_sha256:
      hashEvergreenMotionRepairWorkOrder(base),
  };
}

function evidenceBinding(story) {
  return {
    source_evidence_sha256: digest(story?.source_evidence),
    source_packet_sha256: text(
      story?.source_evidence?.packet_sha256,
    ).toLowerCase(),
    rights_evidence_sha256: digest(story?.rights_evidence),
    rights_ledger_sha256: text(
      story?.rights_evidence?.ledger_sha256,
    ).toLowerCase(),
    advertiser_safety_evidence_sha256: digest(
      story?.advertiser_safety,
    ),
    advertiser_safety_evidence_sha256_declared: text(
      story?.advertiser_safety?.evidence_sha256,
    ).toLowerCase(),
  };
}

function stableId(value) {
  return crypto
    .createHash("sha256")
    .update(text(value).toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

function boundedPositiveInteger(value, fallback, maximum = 12) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(maximum, Math.floor(parsed));
}

function discoveryPolicy(value = {}) {
  const maximumSelected = boundedPositiveInteger(
    value.maximum_selected,
    DEFAULT_DISCOVERY_POLICY.maximum_selected,
  );
  return {
    maximum_selected: maximumSelected,
    maximum_per_topic: boundedPositiveInteger(
      value.maximum_per_topic,
      DEFAULT_DISCOVERY_POLICY.maximum_per_topic,
      maximumSelected,
    ),
    maximum_per_franchise: boundedPositiveInteger(
      value.maximum_per_franchise,
      DEFAULT_DISCOVERY_POLICY.maximum_per_franchise,
      maximumSelected,
    ),
    maximum_per_shape: boundedPositiveInteger(
      value.maximum_per_shape,
      DEFAULT_DISCOVERY_POLICY.maximum_per_shape,
      maximumSelected,
    ),
    maximum_per_platform: boundedPositiveInteger(
      value.maximum_per_platform,
      DEFAULT_DISCOVERY_POLICY.maximum_per_platform,
      maximumSelected,
    ),
  };
}

function normaliseTitle(value) {
  return text(value)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleSimilarity(left, right) {
  const leftTokens = new Set(normaliseTitle(left).split(" ").filter(Boolean));
  const rightTokens = new Set(
    normaliseTitle(right).split(" ").filter(Boolean),
  );
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return Number(
    ((2 * intersection) / (leftTokens.size + rightTokens.size)).toFixed(3),
  );
}

function noveltyAssessment({
  title,
  history,
  referenceTitles,
  threshold = 0.8,
}) {
  const comparisons = [
    ...array(history)
      .map((item) => ({
        title: text(item?.title),
        origin: "history",
      }))
      .filter((item) => item.title),
    ...array(referenceTitles)
      .map((item) => ({
        title: text(
          typeof item === "string" ? item : item?.title,
        ),
        origin: "reference",
      }))
      .filter((item) => item.title),
  ];
  let nearest = null;
  for (const comparison of comparisons) {
    const similarity = titleSimilarity(title, comparison.title);
    if (
      !nearest ||
      similarity > nearest.similarity ||
      (similarity === nearest.similarity &&
        `${comparison.origin}|${comparison.title}` <
          `${nearest.origin}|${nearest.title}`)
    ) {
      nearest = { ...comparison, similarity };
    }
  }
  const maximumSimilarity = nearest?.similarity || 0;
  return {
    nearest_title: nearest?.title || null,
    nearest_title_origin: nearest?.origin || null,
    maximum_similarity: maximumSimilarity,
    threshold,
    passes: maximumSimilarity < threshold,
  };
}

function inputBlockers(story) {
  const blockers = [];
  const source = story?.source_evidence || {};
  const rights = story?.rights_evidence || {};
  const advertiserSafety = story?.advertiser_safety || {};
  if (!text(story?.id)) blockers.push("story_id_required");
  if (!text(story?.title)) blockers.push("story_title_required");
  if (!text(story?.franchise)) blockers.push("story_franchise_required");
  if (!text(story?.topic_key)) blockers.push("story_topic_key_required");
  if (
    text(source.verification_status).toUpperCase() !== "CONFIRMED" ||
    source.verified_for_planning !== true
  ) {
    blockers.push("source_evidence_not_confirmed");
  }
  if (array(source.claims).length < 3) {
    blockers.push("verified_claim_inventory_too_thin");
  }
  if (
    text(source.schema_version) !==
    "pulse-evergreen-source-evidence-v1"
  ) {
    blockers.push("source_evidence_schema_invalid");
  }
  if (!isSha256(source.packet_sha256)) {
    blockers.push("source_packet_sha256_required");
  }
  const sources = array(source.source_manifest);
  if (sources.length < 2) blockers.push("source_manifest_too_thin");
  if (
    sources.some(
      (entry) => !text(entry?.name) || !isHttps(entry?.url),
    )
  ) {
    blockers.push("source_manifest_entry_invalid");
  }
  if (!sources.some((entry) => OFFICIAL_SOURCE_TIERS.test(text(entry?.tier)))) {
    blockers.push("source_manifest_official_source_required");
  }
  const sourceUrls = new Set(sources.map((entry) => text(entry?.url)));
  const claimIds = new Set();
  for (const claim of array(source.claims)) {
    const claimId = text(claim?.id);
    if (
      !claimId ||
      !text(claim?.subject) ||
      !text(claim?.text) ||
      !isHttps(claim?.source_url)
    ) {
      blockers.push("source_claim_invalid");
    }
    if (claimIds.has(claimId)) blockers.push("source_claim_id_duplicate");
    claimIds.add(claimId);
    if (
      isHttps(claim?.source_url) &&
      !sourceUrls.has(text(claim.source_url))
    ) {
      blockers.push("source_claim_not_bound_to_source_manifest");
    }
  }
  if (text(rights.decision).toUpperCase() !== "CLEARED") {
    blockers.push("rights_evidence_not_cleared");
  }
  if (
    text(rights.schema_version) !==
    "pulse-evergreen-rights-evidence-v1"
  ) {
    blockers.push("rights_evidence_schema_invalid");
  }
  if (!isSha256(rights.ledger_sha256)) {
    blockers.push("rights_ledger_sha256_required");
  }
  const rightsRecords = array(rights?.media_plan?.rights_records);
  if (rightsRecords.length < 3) blockers.push("rights_records_too_thin");
  const assetIds = new Set();
  for (const record of rightsRecords) {
    const assetId = text(record?.asset_id);
    if (
      !assetId ||
      !text(record?.owner) ||
      !validEvergreenRightsSourceUrl(record, story?.id) ||
      !text(record?.usage)
    ) {
      blockers.push("rights_record_invalid");
    }
    if (assetIds.has(assetId)) blockers.push("rights_asset_id_duplicate");
    assetIds.add(assetId);
    if (
      !DEFENSIBLE_RIGHTS_BASES.has(
        text(record?.rights_basis).toLowerCase(),
      )
    ) {
      blockers.push("rights_basis_not_defensible");
    }
  }
  if (text(advertiserSafety.decision).toUpperCase() !== "SAFE") {
    blockers.push("advertiser_safety_not_green");
  }
  if (!text(advertiserSafety.policy_version)) {
    blockers.push("advertiser_safety_policy_version_required");
  }
  if (!isSha256(advertiserSafety.evidence_sha256)) {
    blockers.push("advertiser_safety_evidence_sha256_required");
  }
  return [...new Set(blockers)].sort();
}

function generatorOutputBlockers(output) {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return ["generator_output_invalid"];
  }
  const blockers = [];
  for (const key of Object.keys(output)) {
    if (!ALLOWED_GENERATOR_OUTPUT_KEYS.includes(key)) {
      blockers.push(`generator_output_forbidden_field:${key}`);
    }
  }
  if (!Array.isArray(output.pitches)) {
    blockers.push("generator_output_pitches_required");
    return blockers;
  }
  output.pitches.forEach((pitch, index) => {
    if (!pitch || typeof pitch !== "object" || Array.isArray(pitch)) {
      blockers.push(`generator_pitch_invalid:pitches.${index}`);
      return;
    }
    for (const key of Object.keys(pitch)) {
      if (!ALLOWED_GENERATED_PITCH_KEYS.includes(key)) {
        blockers.push(
          `generator_output_forbidden_field:pitches.${index}.${key}`,
        );
      }
    }
    array(pitch.item_rationales).forEach((rationale, rationaleIndex) => {
      if (
        !rationale ||
        typeof rationale !== "object" ||
        Array.isArray(rationale)
      ) {
        blockers.push(
          `generator_rationale_invalid:pitches.${index}.item_rationales.${rationaleIndex}`,
        );
        return;
      }
      for (const key of Object.keys(rationale)) {
        if (!ALLOWED_RATIONALE_KEYS.includes(key)) {
          blockers.push(
            `generator_output_forbidden_field:pitches.${index}.item_rationales.${rationaleIndex}.${key}`,
          );
        }
      }
    });
  });
  return [...new Set(blockers)].sort();
}

function generatorIdentityBlockers(output, validEntries) {
  const allowedStoryIds = new Set(
    array(validEntries).map((entry) => text(entry?.story?.id)),
  );
  const seen = new Set();
  const blockers = [];
  for (const pitch of array(output?.pitches)) {
    const storyId = text(pitch?.story_id);
    if (!allowedStoryIds.has(storyId)) {
      blockers.push(`generator_output_unknown_story:${storyId || "missing"}`);
    }
    if (seen.has(storyId)) {
      blockers.push(`generator_output_duplicate_story:${storyId || "missing"}`);
    }
    seen.add(storyId);
  }
  return [...new Set(blockers)].sort();
}

function generatedPitchBlockers(story, generated) {
  if (!generated) return ["generated_pitch_missing"];
  const blockers = [];
  if (text(generated.story_id) !== text(story.id)) {
    blockers.push("generated_pitch_story_binding_mismatch");
  }
  if (!text(generated.title)) blockers.push("generated_pitch_title_required");
  if (!FORMAT_SHAPES.includes(text(generated.format_shape))) {
    blockers.push("generated_pitch_format_shape_invalid");
  }
  if (array(generated.editorial_criteria).length < 2) {
    blockers.push("generated_pitch_editorial_criteria_too_thin");
  }
  if (array(generated.item_rationales).length < 3) {
    blockers.push("generated_pitch_item_rationales_too_thin");
  }
  const allowedClaimIds = new Set(
    array(story.source_evidence?.claims)
      .map((claim) => text(claim?.id))
      .filter(Boolean),
  );
  for (const rationale of array(generated.item_rationales)) {
    if (!text(rationale?.subject) || !text(rationale?.judgement)) {
      blockers.push("generated_rationale_subject_or_judgement_missing");
    }
    const claimIds = array(rationale?.claim_ids).map(text).filter(Boolean);
    if (!claimIds.length) {
      blockers.push("generated_rationale_claim_binding_missing");
    }
    for (const claimId of claimIds) {
      if (!allowedClaimIds.has(claimId)) {
        blockers.push(`generated_rationale_unknown_claim:${claimId}`);
      }
    }
  }
  const generatedCopy = [
    generated.title,
    ...array(generated.editorial_criteria),
    ...array(generated.item_rationales).flatMap((rationale) => [
      rationale?.subject,
      rationale?.judgement,
    ]),
  ]
    .map(text)
    .join(" ");
  for (const rule of ADVERTISER_UNSAFE_PATTERNS) {
    if (rule.pattern.test(generatedCopy)) {
      blockers.push(`generated_copy_advertiser_unsafe:${rule.id}`);
    }
  }
  return [...new Set(blockers)].sort();
}

function structuralMinimumCorrection(stories, output) {
  const generatedByStory = new Map(
    array(output?.pitches).map((pitch) => [text(pitch?.story_id), pitch]),
  );
  const blockersByStory = array(stories).map((story) => ({
    story_id: text(story?.id),
    blockers: generatedPitchBlockers(
      story,
      generatedByStory.get(text(story?.id)),
    ),
  }));
  const activeBlockers = blockersByStory.filter(
    (entry) => entry.blockers.length > 0,
  );
  if (
    !activeBlockers.length ||
    activeBlockers.some((entry) =>
      entry.blockers.some(
        (blocker) =>
          !CORRECTABLE_GENERATOR_STRUCTURAL_MINIMUM_BLOCKERS.has(blocker),
      ),
    )
  ) {
    return null;
  }
  return {
    attempt: 1,
    maximum_attempts: 1,
    reason: "generator_structural_minimums_not_met",
    blockers_by_story: activeBlockers,
    instruction:
      "Return the complete pitches object again with exactly one pitch for every eligible story and satisfy every declared output_contract minimum. Do not add or alter claims, sources, rights, evidence or authority fields.",
  };
}

function createAnthropicEvergreenDiscoveryJsonGenerator({
  client,
  model,
  max_tokens: configuredMaxTokens,
} = {}) {
  if (typeof client?.messages?.create !== "function") {
    throw new Error("anthropic_messages_client_required");
  }
  if (!text(model)) throw new Error("anthropic_model_required");
  const identity = editorialIdentityFor(client, model);
  const governedLongOutput = ["google", "ollama"].includes(
    identity.provider,
  );
  const googleThinking = identity.provider === "google";
  const maxTokens =
    configuredMaxTokens === undefined
      ? governedLongOutput
        ? GOOGLE_DISCOVERY_DEFAULT_MAX_OUTPUT_TOKENS
        : 4096
      : configuredMaxTokens;
  if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
    throw new Error("anthropic_max_tokens_invalid");
  }
  const generator = async (request) => {
    const response = await client.messages.create({
      model: text(model),
      max_tokens: maxTokens,
      temperature: 0,
      ...(governedLongOutput
        ? {
            editorial_request_profile: "long_output",
            ...(googleThinking
              ? { editorial_thinking_level: "low" }
              : {}),
          }
        : {}),
      system:
        "Return one JSON object only with the requested allow-listed editorial pitch fields. Return exactly one pitch for every eligible story. Every pitch must contain at least 2 distinct editorial criteria and at least 3 evidence-bound item rationales. Use only a format_shape listed in allowed_format_shapes. Every rationale must contain a subject, a judgement and one or more allowed verified claim IDs. Never create or edit claims, sources, rights, evidence or asset identifiers. Create original Pulse Gaming framing without copying reference titles, scripts, sequences, branding or trade dress. Keep all copy advertiser-safe. This task grants no approval, scheduling or publishing authority.",
      messages: [
        {
          role: "user",
          content: JSON.stringify(request),
        },
      ],
    });
    const responseText = array(response?.content)
      .filter((block) => block?.type === "text")
      .map((block) => String(block.text || ""))
      .join("")
      .trim();
    if (!responseText) {
      throw new Error("anthropic_json_response_missing");
    }
    return JSON.parse(responseText);
  };
  generator.identity = identity;
  return generator;
}

function buildPitch({ story, generated }) {
  const sourceEvidence = clone(story.source_evidence);
  const rightsEvidence = clone(story.rights_evidence);
  const claimsById = new Map(
    array(sourceEvidence.claims).map((claim) => [text(claim.id), claim]),
  );
  const itemRationales = array(generated.item_rationales).map((item) => {
    const claimIds = array(item.claim_ids).map(text).filter(Boolean);
    const claim = claimsById.get(claimIds[0]);
    return {
      subject: text(item.subject),
      judgement: text(item.judgement),
      source_url: text(claim?.source_url),
      claim_ids: claimIds,
    };
  });
  return {
    id: `evergreen-${stableId(
      `${CANDIDATE_ID_VERSION}|${story.id}`,
    )}`,
    origin_story_id: text(story.id),
    title: text(generated.title),
    franchise: text(story.franchise),
    platform: text(story.platform),
    topic_key: text(story.topic_key),
    format_shape: text(generated.format_shape),
    editorial_criteria: array(generated.editorial_criteria).map(text),
    item_rationales: itemRationales,
    claims: clone(sourceEvidence.claims),
    source_manifest: clone(sourceEvidence.source_manifest),
    script_contract: {
      voice_mode: "sourced_synthesis",
      uses_first_person_play_claims: false,
      target_duration_seconds: 82,
      target_words_per_minute: 195,
      opening_premise_words: 12,
      closing_cta_count: 1,
    },
    media_plan: clone(rightsEvidence.media_plan),
  };
}

async function discoverEvergreenVerdictPitches({
  stories = [],
  manifests = [],
  history = [],
  reference_titles: referenceTitles = [],
  policy = {},
  generator,
  now = new Date().toISOString(),
} = {}) {
  const generatedAt = new Date(now);
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error("evergreen_discovery_time_invalid");
  }
  const effectivePolicy = discoveryPolicy(policy);
  const inputEntries = [
    ...array(stories).map((story) => ({
      story: clone(story),
      origin: {
        kind: "story",
        story_id: text(story?.id),
      },
    })),
    ...array(manifests).map((manifest) => ({
      story: clone(manifest?.story),
      origin: {
        kind: "manifest",
        manifest_id: text(manifest?.manifest_id || manifest?.id),
        story_id: text(manifest?.story?.id),
      },
    })),
  ];
  const storyIdCounts = new Map();
  for (const entry of inputEntries) {
    const storyId = text(entry?.story?.id);
    if (!storyId) continue;
    storyIdCounts.set(storyId, (storyIdCounts.get(storyId) || 0) + 1);
  }
  const duplicateStoryIds = [...storyIdCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([storyId]) => storyId)
    .sort();
  const duplicateStoryIdSet = new Set(duplicateStoryIds);
  const duplicateInputBlockers = duplicateStoryIds.map(
    (storyId) => `duplicate_story_input:${storyId}`,
  );
  const assessedInputs = inputEntries
    .map((entry) => ({
      ...entry,
      blockers: [
        ...inputBlockers(entry.story),
        ...(duplicateStoryIdSet.has(text(entry?.story?.id))
          ? [`duplicate_story_input:${text(entry.story.id)}`]
          : []),
      ].sort(),
    }))
    .sort(
      (a, b) =>
        a.origin.story_id.localeCompare(b.origin.story_id) ||
        a.origin.kind.localeCompare(b.origin.kind) ||
        text(a.origin.manifest_id).localeCompare(
          text(b.origin.manifest_id),
        ),
    );
  const validEntries = assessedInputs.filter(
    (entry) => entry.blockers.length === 0,
  );
  const rejectedInputs = assessedInputs
    .filter((entry) => entry.blockers.length > 0)
    .map(({ origin, blockers }) => ({ origin, blockers }));
  if (typeof generator !== "function" || !validEntries.length) {
    return {
      schema_version: SCHEMA_VERSION,
      generated_at: generatedAt.toISOString(),
      mode: MODE,
      verdict: "HOLD",
      blockers: [
        ...(typeof generator === "function"
          ? []
          : ["evergreen_discovery_generator_required"]),
        ...duplicateInputBlockers,
        ...(validEntries.length
          ? []
          : [
              "no_verified_rights_cleared_advertiser_safe_inputs",
            ]),
      ],
      selected_candidates: [],
      candidate_manifests: [],
      rejected_inputs: rejectedInputs,
      safety: safety(),
    };
  }
  const request = {
    schema_version: "pulse-evergreen-discovery-generation-request-v1",
    task:
      "Create original, evidence-bound evergreen verdict pitch framing only.",
    stories: validEntries.map(({ story }) => ({
      id: text(story.id),
      title: text(story.title),
      franchise: text(story.franchise),
      platform: text(story.platform),
      topic_key: text(story.topic_key),
      claims: clone(story.source_evidence.claims),
      allowed_claim_ids: array(story.source_evidence.claims).map((claim) =>
        text(claim.id),
      ),
      allowed_rights_asset_ids: array(
        story.rights_evidence?.media_plan?.rights_records,
      )
        .map((record) => text(record?.asset_id))
        .filter(Boolean),
      evidence_binding: evidenceBinding(story),
      allowed_format_shapes: [...FORMAT_SHAPES],
    })),
    novelty: {
      prohibited_titles: [
        ...array(history)
          .map((item) => ({
            origin: "history",
            title: text(item?.title),
          }))
          .filter((item) => item.title),
        ...array(referenceTitles)
          .map((item) => ({
            origin: "reference",
            title: text(
              typeof item === "string" ? item : item?.title,
            ),
          }))
          .filter((item) => item.title),
      ].sort(
        (a, b) =>
          a.origin.localeCompare(b.origin) ||
          a.title.localeCompare(b.title),
      ),
    },
    editorial_contract: {
      structural_inspiration_only: true,
      immediate_premise: true,
      criterion_led_judgements: true,
      one_evidence_bound_reason_per_rationale: true,
      rapid_progression_without_channel_intro: true,
      competitor_titles_may_be_copied: false,
      competitor_scripts_allowed: false,
      competitor_assets_allowed: false,
      competitor_branding_or_trade_dress_allowed: false,
      advertiser_safe_copy_required: true,
    },
    output_contract: {
      allowed_top_level_keys: [...ALLOWED_GENERATOR_OUTPUT_KEYS],
      allowed_pitch_keys: [...ALLOWED_GENERATED_PITCH_KEYS],
      allowed_rationale_keys: [...ALLOWED_RATIONALE_KEYS],
      exactly_one_pitch_per_eligible_story: true,
      eligible_story_ids: validEntries.map(({ story }) => text(story.id)),
      minimum_editorial_criteria_per_pitch: 2,
      minimum_evidence_bound_item_rationales_per_pitch: 3,
      allowed_format_shapes: [...FORMAT_SHAPES],
      each_rationale_requires_subject_judgement_and_allowed_claim_ids: true,
      claims_may_be_returned: false,
      sources_may_be_returned: false,
      rights_may_be_returned: false,
      unknown_story_ids_allowed: false,
      unknown_claim_ids_allowed: false,
      approval_scheduler_or_publish_authority_allowed: false,
    },
  };
  let output;
  let finalGeneratorRequest = request;
  let correctiveRetryUsed = false;
  let generatorErrorCode = null;
  try {
    output = await generator(clone(request));
  } catch (error) {
    generatorErrorCode = normaliseGeneratorErrorCode(error);
    output = null;
  }
  let outputBlockers = [
    ...generatorOutputBlockers(output),
    ...generatorIdentityBlockers(output, validEntries),
  ]
    .filter(Boolean)
    .sort();
  if (!outputBlockers.length) {
    const correction = structuralMinimumCorrection(
      validEntries.map((entry) => entry.story),
      output,
    );
    if (correction) {
      finalGeneratorRequest = {
        ...request,
        corrective_retry: correction,
      };
      correctiveRetryUsed = true;
      try {
        output = await generator(clone(finalGeneratorRequest));
      } catch (error) {
        generatorErrorCode = normaliseGeneratorErrorCode(error);
        output = null;
      }
      outputBlockers = [
        ...generatorOutputBlockers(output),
        ...generatorIdentityBlockers(output, validEntries),
      ]
        .filter(Boolean)
        .sort();
    }
  }
  if (outputBlockers.length) {
    return {
      schema_version: SCHEMA_VERSION,
      generated_at: generatedAt.toISOString(),
      mode: MODE,
      verdict: "HOLD",
      blockers: outputBlockers,
      selected_candidates: [],
      candidate_manifests: [],
      rejected_inputs: rejectedInputs,
      generator_error_code: generatorErrorCode,
      generator_provenance: {
        provider: text(generator.identity?.provider) || "injected",
        model: text(generator.identity?.model) || "unspecified",
        adapter: text(generator.identity?.adapter) || "injected",
        request_sha256: digest(request),
        final_request_sha256: digest(finalGeneratorRequest),
        output_sha256: digest(output),
        attempt_count: correctiveRetryUsed ? 2 : 1,
        corrective_retry_used: correctiveRetryUsed,
      },
      safety: safety(),
    };
  }
  const generatedByStory = new Map(
    array(output?.pitches).map((pitch) => [text(pitch?.story_id), pitch]),
  );
  const deferredCandidates = [];
  const motionRepairWorkOrders = [];
  const candidates = [];
  for (const entry of validEntries) {
    const { story } = entry;
    const generated = generatedByStory.get(text(story.id));
    const pitchBlockers = generatedPitchBlockers(story, generated);
    if (pitchBlockers.length) {
      deferredCandidates.push({
        story_id: text(story.id),
        blockers: pitchBlockers,
      });
      continue;
    }
    const originAlreadyUsed = array(history).some(
      (item) =>
        [
          item?.origin_story_id,
          item?.source_story_id,
          item?.story_id,
        ].some((value) => text(value) === text(story.id)),
    );
    if (originAlreadyUsed) {
      deferredCandidates.push({
        story_id: text(story.id),
        blockers: ["origin_story_already_used"],
      });
      continue;
    }
    const novelty = noveltyAssessment({
      title: generated.title,
      history,
      referenceTitles,
    });
    if (!novelty.passes) {
      deferredCandidates.push({
        story_id: text(story.id),
        blockers: ["near_duplicate_title"],
        novelty,
      });
      continue;
    }
    const evergreenPitch = buildPitch({ story, generated });
    const motionCompletionCandidateId = text(
      story?.motion_completion?.candidate_id,
    );
    if (
      motionCompletionCandidateId &&
      motionCompletionCandidateId !== text(evergreenPitch.id)
    ) {
      deferredCandidates.push({
        story_id: text(story.id),
        blockers: [
          "motion_completion_candidate_id_mismatch",
        ],
        expected_candidate_id: motionCompletionCandidateId,
        generated_candidate_id: text(evergreenPitch.id),
      });
      continue;
    }
    const assessment = assessEvergreenVerdictCandidate(evergreenPitch, {
      history,
      now: generatedAt.toISOString(),
    });
    if (assessment.verdict !== "READY_FOR_PRODUCTION") {
      const deferred = {
        story_id: text(story.id),
        blockers: [...assessment.blockers],
      };
      if (
        assessment.blockers.length === 1 &&
        assessment.blockers[0] ===
          "exact_subject_motion_ratio_too_low"
      ) {
        const workOrder = buildMotionCoverageRepairWorkOrder({
          story,
          pitch: evergreenPitch,
          now: generatedAt.toISOString(),
        });
        motionRepairWorkOrders.push(workOrder);
        deferred.motion_repair_work_order_sha256 =
          workOrder.work_order_sha256;
      }
      deferredCandidates.push(deferred);
      continue;
    }
    const rankingComponents = {
      evidence_score: assessment.score,
      novelty_score: Math.round(
        (1 - novelty.maximum_similarity) * 100,
      ),
    };
    candidates.push({
      origin: clone(entry.origin),
      evergreen_pitch: evergreenPitch,
      assessment,
      discovery_score: Math.round(
        rankingComponents.evidence_score * 0.75 +
          rankingComponents.novelty_score * 0.25,
      ),
      ranking_components: rankingComponents,
      novelty,
      evidence_provenance: {
        ...evidenceBinding(story),
        evidence_fields_mutated: false,
      },
    });
  }
  candidates.sort(
    (a, b) =>
      b.discovery_score - a.discovery_score ||
      text(a.evergreen_pitch.id).localeCompare(
        text(b.evergreen_pitch.id),
      ),
  );
  const selectedCandidates = [];
  const counts = {
    topic: new Map(),
    franchise: new Map(),
    shape: new Map(),
    platform: new Map(),
  };
  for (const candidate of candidates) {
    const pitch = candidate.evergreen_pitch;
    const batchDuplicate = selectedCandidates
      .map((selected) => ({
        candidate: selected,
        similarity: titleSimilarity(
          pitch.title,
          selected.evergreen_pitch.title,
        ),
      }))
      .filter((comparison) => comparison.similarity >= 0.8)
      .sort(
        (a, b) =>
          b.similarity - a.similarity ||
          a.candidate.origin.story_id.localeCompare(
            b.candidate.origin.story_id,
          ),
      )[0];
    if (batchDuplicate) {
      deferredCandidates.push({
        story_id: candidate.origin.story_id,
        blockers: ["batch_duplicate_title"],
        duplicate_of_story_id:
          batchDuplicate.candidate.origin.story_id,
        title_similarity: batchDuplicate.similarity,
      });
      continue;
    }
    const dimensions = {
      topic: text(pitch.topic_key).toLowerCase(),
      franchise: text(pitch.franchise).toLowerCase(),
      shape: text(pitch.format_shape).toLowerCase(),
      platform: text(pitch.platform).toLowerCase(),
    };
    const diversityBlockers = [];
    if (selectedCandidates.length >= effectivePolicy.maximum_selected) {
      diversityBlockers.push("discovery_capacity_reached");
    }
    if (
      (counts.topic.get(dimensions.topic) || 0) >=
      effectivePolicy.maximum_per_topic
    ) {
      diversityBlockers.push("topic_diversity_guard");
    }
    if (
      (counts.franchise.get(dimensions.franchise) || 0) >=
      effectivePolicy.maximum_per_franchise
    ) {
      diversityBlockers.push("franchise_diversity_guard");
    }
    if (
      (counts.shape.get(dimensions.shape) || 0) >=
      effectivePolicy.maximum_per_shape
    ) {
      diversityBlockers.push("format_shape_diversity_guard");
    }
    if (
      (counts.platform.get(dimensions.platform) || 0) >=
      effectivePolicy.maximum_per_platform
    ) {
      diversityBlockers.push("platform_diversity_guard");
    }
    if (diversityBlockers.length) {
      deferredCandidates.push({
        story_id: candidate.origin.story_id,
        blockers: diversityBlockers,
        discovery_score: candidate.discovery_score,
      });
      continue;
    }
    selectedCandidates.push(candidate);
    for (const [dimension, key] of Object.entries(dimensions)) {
      counts[dimension].set(key, (counts[dimension].get(key) || 0) + 1);
    }
  }
  deferredCandidates.sort((a, b) =>
    a.story_id.localeCompare(b.story_id),
  );
  const candidateManifests = selectedCandidates.map((candidate) => ({
    schema_version: "pulse-evergreen-pitch-v1",
    manifest_id: `discovery-${candidate.evergreen_pitch.id}`,
    origin_story_id: candidate.origin.story_id,
    source_manifest_id: candidate.origin.manifest_id || null,
    evidence_provenance: clone(candidate.evidence_provenance),
    evergreen_pitch: clone(candidate.evergreen_pitch),
  }));

  return {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt.toISOString(),
    mode: MODE,
    verdict: selectedCandidates.length
      ? "READY_FOR_CANDIDATE_ASSESSMENT"
      : "HOLD",
    blockers: selectedCandidates.length
      ? []
      : ["no_governed_evergreen_candidates_selected"],
    selected_candidates: selectedCandidates,
    deferred_candidates: deferredCandidates,
    candidate_manifests: candidateManifests,
    motion_repair_work_orders: motionRepairWorkOrders,
    rejected_inputs: rejectedInputs,
    generator_error_code: null,
    generator_provenance: {
      provider: text(generator.identity?.provider) || "injected",
      model: text(generator.identity?.model) || "unspecified",
      adapter: text(generator.identity?.adapter) || "injected",
      request_sha256: digest(request),
      final_request_sha256: digest(finalGeneratorRequest),
      output_sha256: digest(output),
      attempt_count: correctiveRetryUsed ? 2 : 1,
      corrective_retry_used: correctiveRetryUsed,
    },
    ranking_contract: {
      algorithm: "evidence_novelty_then_stable_id_v1",
      stable_tie_breaker: "evergreen_pitch.id:ascending",
      diversity_selection: "deterministic_greedy_v1",
      policy: effectivePolicy,
    },
    safety: safety(),
  };
}

function renderEvergreenAutonomousDiscoveryMarkdown(result = {}) {
  const selected = array(result.selected_candidates);
  const deferred = array(result.deferred_candidates);
  const rejected = array(result.rejected_inputs);
  const motionRepairWorkOrders = array(
    result.motion_repair_work_orders,
  );
  const lines = [
    "# Pulse Gaming Autonomous Evergreen Discovery",
    "",
    `Generated: ${text(result.generated_at)}`,
    `Mode: ${text(result.mode)}`,
    `Verdict: ${text(result.verdict)}`,
    `Selected: ${selected.length}`,
    `Deferred: ${deferred.length}`,
    `Rejected inputs: ${rejected.length}`,
    ...(text(result.generator_error_code)
      ? [`Generator error: ${text(result.generator_error_code)}`]
      : []),
    "",
    "## Selected pitches",
    "",
  ];
  if (!selected.length) lines.push("- None");
  for (const candidate of selected) {
    lines.push(
      `- ${text(candidate?.evergreen_pitch?.title)} — ${text(
        candidate?.evergreen_pitch?.franchise,
      )} / ${text(candidate?.evergreen_pitch?.format_shape)} / score ${Number(
        candidate?.discovery_score || 0,
      )}`,
      `  - Evidence SHA-256: ${text(
        candidate?.evidence_provenance?.source_evidence_sha256,
      )}; rights ${text(
        candidate?.evidence_provenance?.rights_evidence_sha256,
      )}`,
    );
  }
  lines.push("", "## Deferred pitches", "");
  if (!deferred.length) lines.push("- None");
  for (const candidate of deferred) {
    lines.push(
      `- ${text(candidate?.story_id) || "(unknown story)"}: ${
        array(candidate?.blockers).join(", ") || "deferred"
      }`,
    );
  }
  lines.push("", "## Motion coverage repair work orders", "");
  if (!motionRepairWorkOrders.length) lines.push("- None");
  for (const workOrder of motionRepairWorkOrders) {
    lines.push(
      `- ${text(workOrder?.story_id) || "(unknown story)"} / ${text(
        workOrder?.candidate_id,
      ) || "(unknown candidate)"}: ${Number(
        workOrder?.additional_motion_seconds_required || 0,
      )} additional seconds of probed, materialised exact-subject motion required`,
      `  - Work order SHA-256: ${text(
        workOrder?.work_order_sha256,
      )}`,
    );
  }
  lines.push("", "## Rejected evidence inputs", "");
  if (!rejected.length) lines.push("- None");
  for (const entry of rejected) {
    lines.push(
      `- ${text(entry?.origin?.story_id) || "(unknown story)"}: ${
        array(entry?.blockers).join(", ") || "rejected"
      }`,
    );
  }
  lines.push(
    "",
    "This LOCAL_PROOF discovery does not grant approval, scheduling, database, OAuth or publishing authority.",
    "",
  );
  return lines.join("\n");
}

function safety() {
  return {
    planning_only: true,
    approval_authority_created: false,
    scheduler_authority_created: false,
    publish_authority_created: false,
    database_mutation_allowed: false,
    oauth_mutation_allowed: false,
    no_external_publish_triggered: true,
  };
}

module.exports = {
  ALLOWED_GENERATED_PITCH_KEYS,
  ALLOWED_GENERATOR_OUTPUT_KEYS,
  DEFAULT_DISCOVERY_POLICY,
  MODE,
  SCHEMA_VERSION,
  createAnthropicEvergreenDiscoveryJsonGenerator,
  discoverEvergreenVerdictPitches,
  renderEvergreenAutonomousDiscoveryMarkdown,
};
