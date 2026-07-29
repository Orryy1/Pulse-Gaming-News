"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");

const {
  buildWeeklyLongformWorkOrder,
} = require("./weekly-longform-work-order");
const {
  editorialIdentityFor,
} = require("./governed-editorial-client");

const SCHEMA_VERSION =
  "pulse-weekly-longform-editorial-enrichment-v1";
const REQUEST_SCHEMA_VERSION =
  "pulse-weekly-longform-editorial-generation-request-v1";
const MODE = "LOCAL_PROOF";
const MINIMUM_STORY_COUNT = 4;
const MAXIMUM_STORY_COUNT = 6;
const ALLOWED_GENERATOR_OUTPUT_KEYS = Object.freeze([
  "editorial_frame",
  "weekly_longform_pitch",
]);
const ALLOWED_EDITORIAL_FRAME_KEYS = Object.freeze([
  "episode_title",
  "editorial_thesis",
  "opening_script",
  "closing_script",
]);
const ALLOWED_PITCH_KEYS = Object.freeze([
  "section_title",
  "angle",
  "why_it_matters",
  "claim_ids",
  "script_section",
  "visual_beats",
  "derivative_hooks",
]);
const ALLOWED_VISUAL_BEAT_KEYS = Object.freeze([
  "beat_id",
  "purpose",
  "asset_item_id",
  "treatment",
  "claim_ids",
]);
const ALLOWED_DERIVATIVE_HOOK_KEYS = Object.freeze([
  "short",
  "social_thread",
]);

function stringProperties(keys) {
  return Object.fromEntries(
    keys.map((key) => [key, { type: "string" }]),
  );
}

function exactStringValues(values) {
  return [...new Set(list(values).map(text).filter(Boolean))];
}

function weeklyLongformPitchResponseJsonSchema(story) {
  const claimIds = exactStringValues(
    list(story?.verified_claims).map((claim) => claim?.claim_id),
  );
  const clearedAssetIds = exactStringValues(
    story?.cleared_asset_ids,
  );
  if (!claimIds.length || !clearedAssetIds.length) {
    throw new Error(
      "editorial_response_json_schema_bindings_invalid",
    );
  }
  const claimIdsSchema = {
    type: "array",
    minItems: 1,
    maxItems: claimIds.length,
    items: {
      type: "string",
      enum: claimIds,
    },
  };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      section_title: { type: "string" },
      angle: { type: "string" },
      why_it_matters: { type: "string" },
      claim_ids: clone(claimIdsSchema),
      script_section: { type: "string" },
      visual_beats: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            beat_id: { type: "string" },
            purpose: { type: "string" },
            asset_item_id: {
              type: "string",
              enum: clearedAssetIds,
            },
            treatment: { type: "string" },
            claim_ids: clone(claimIdsSchema),
          },
          required: [...ALLOWED_VISUAL_BEAT_KEYS],
        },
      },
      derivative_hooks: {
        type: "object",
        additionalProperties: false,
        properties: stringProperties(
          ALLOWED_DERIVATIVE_HOOK_KEYS,
        ),
        required: [...ALLOWED_DERIVATIVE_HOOK_KEYS],
      },
    },
    required: [...ALLOWED_PITCH_KEYS],
  };
}

function weeklyLongformResponseJsonSchema(request) {
  const storyIds = list(request?.stories)
    .map((story) => text(story?.story_id))
    .filter(Boolean);
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      editorial_frame: {
        type: "object",
        additionalProperties: false,
        properties: stringProperties(
          ALLOWED_EDITORIAL_FRAME_KEYS,
        ),
        required: [...ALLOWED_EDITORIAL_FRAME_KEYS],
      },
      weekly_longform_pitch: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(
          list(request?.stories).map((story) => [
            text(story?.story_id),
            weeklyLongformPitchResponseJsonSchema(story),
          ]),
        ),
        required: storyIds,
      },
    },
    required: [...ALLOWED_GENERATOR_OUTPUT_KEYS],
  };
}

function text(value) {
  return String(value ?? "").trim();
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
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

function digest(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function unique(values) {
  return [...new Set(list(values).filter(Boolean))];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
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

function blockedResult({
  generatedAt,
  runId,
  blockers,
  generatorErrorCode = null,
  generatorProvenance = null,
  workOrderResult = null,
  evidencePreservation = null,
} = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt || null,
    run_id: text(runId) || null,
    mode: MODE,
    verdict: "BLOCKED",
    blockers: unique(blockers),
    generator_error_code: generatorErrorCode,
    generator_provenance: generatorProvenance,
    generator_output: null,
    editorial_frame: null,
    enriched_candidates: null,
    evidence_preservation: evidencePreservation,
    work_order_result: workOrderResult,
    safety: {
      local_proof_only: true,
      source_or_rights_fields_mutated: false,
      approval_authority_created: false,
      scheduler_authority_created: false,
      publish_authority_created: false,
      database_authority_created: false,
      oauth_authority_created: false,
      external_publish_triggered: false,
      database_mutation_triggered: false,
    },
  };
}

function preflightCandidates({
  runId,
  generatedAt,
  candidates,
}) {
  const blockers = [];
  if (
    candidates.length < MINIMUM_STORY_COUNT ||
    candidates.length > MAXIMUM_STORY_COUNT
  ) {
    blockers.push("weekly_verified_candidate_count_must_be_4_to_6");
  }
  const ids = candidates.map((candidate) =>
    text(candidate?.id || candidate?.story_id),
  );
  if (
    ids.some((id) => !id) ||
    new Set(ids).size !== candidates.length
  ) {
    blockers.push("weekly_candidate_story_ids_must_be_unique");
  }
  let workOrder = null;
  try {
    workOrder = buildWeeklyLongformWorkOrder({
      runId,
      generatedAt,
      candidates,
      editorialFrame: {},
    });
  } catch {
    blockers.push("weekly_work_order_preflight_failed");
  }
  if (workOrder) {
    const selected = list(workOrder.selection?.selected);
    const rejected = list(workOrder.selection?.rejected);
    const deferred = list(workOrder.selection?.deferred);
    if (
      selected.length !== candidates.length ||
      rejected.length > 0 ||
      deferred.length > 0
    ) {
      blockers.push("weekly_candidate_evidence_not_fully_verified");
      for (const rejection of rejected) {
        for (const blocker of list(rejection?.blockers)) {
          blockers.push(
            `candidate:${text(rejection?.story_id) || "unknown"}:${blocker}`,
          );
        }
      }
    }
  }
  return {
    blockers: unique(blockers),
    workOrder,
  };
}

function buildGenerationRequest({
  runId,
  generatedAt,
  selected,
}) {
  const stories = selected.map((story) => ({
    story_id: story.story_id,
    title: story.title,
    published_at: story.published_at,
    verified_claims: clone(story.source_evidence.claims),
    cleared_asset_ids: list(story.rights_ledger?.decision?.items)
      .filter(
        (item) =>
          item.included_in_final === true &&
          item.rights_decision === "CLEARED",
      )
      .map((item) => item.item_id),
  }));
  return {
    schema_version: REQUEST_SCHEMA_VERSION,
    run_id: runId,
    generated_at: generatedAt,
    allowed_story_ids: stories.map((story) => story.story_id),
    stories,
    output_contract: {
      allowed_top_level_keys: [...ALLOWED_GENERATOR_OUTPUT_KEYS],
      allowed_editorial_frame_keys: [
        ...ALLOWED_EDITORIAL_FRAME_KEYS,
      ],
      allowed_pitch_keys: [...ALLOWED_PITCH_KEYS],
      allowed_visual_beat_keys: [...ALLOWED_VISUAL_BEAT_KEYS],
      allowed_derivative_hook_keys: [
        ...ALLOWED_DERIVATIVE_HOOK_KEYS,
      ],
      one_pitch_per_story_required: true,
      unknown_story_ids_allowed: false,
      unknown_claim_ids_allowed: false,
      unknown_cleared_asset_ids_allowed: false,
      sources_or_rights_may_be_returned: false,
    },
  };
}

function createAnthropicWeeklyLongformJsonGenerator({
  client,
  model,
  max_tokens: requestedMaxTokens,
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
    requestedMaxTokens == null
      ? governedLongOutput
        ? 16_384
        : 8_192
      : requestedMaxTokens;
  if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
    throw new Error("anthropic_max_tokens_invalid");
  }
  const generator = async (request) => {
    const storyCount = Math.max(
      MINIMUM_STORY_COUNT,
      Math.min(
        MAXIMUM_STORY_COUNT,
        list(request?.stories).length || MINIMUM_STORY_COUNT,
      ),
    );
    const openingClosingWords = 140;
    const targetTotalWords = 1_320;
    const targetWordsPerStory = Math.floor(
      (targetTotalWords - openingClosingWords) / storyCount,
    );
    const response = await client.messages.create({
      model: text(model),
      max_tokens: maxTokens,
      temperature: 0,
      ...(governedLongOutput
        ? {
            editorial_request_profile: "long_output",
            ...(googleThinking
              ? { editorial_thinking_level: "MEDIUM" }
              : {}),
            editorial_response_json_schema:
              weeklyLongformResponseJsonSchema(request),
          }
        : {}),
      system:
        "Return one compact JSON object only for an 8 to 12 minute " +
        "weekly episode. Return only editorial_frame and " +
        "weekly_longform_pitch. Never create or return claims, sources " +
        "or rights. Reference only the supplied story IDs, verified " +
        "claim IDs and cleared asset IDs. Write about " +
        `${targetWordsPerStory} words per story, plus roughly 70 words ` +
        "for each of the opening and closing scripts. Use exactly three " +
        "visual beats per story. Keep titles, angles, consequences, " +
        "treatments and derivative hooks concise. Return no Markdown.",
      messages: [
        {
          role: "user",
          content: JSON.stringify(request),
        },
      ],
    });
    const responseText = list(response?.content)
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

function unknownKeys(value, allowed, prefix) {
  const record = object(value);
  if (!record) return [`${prefix}_object_required`];
  return Object.keys(record)
    .filter((key) => !allowed.includes(key))
    .map((key) => `generator_output_forbidden_field:${prefix}.${key}`);
}

function validateGeneratorOutput(output, request) {
  const value = object(output);
  if (!value) {
    return {
      blockers: ["weekly_editorial_generator_output_invalid"],
      value: null,
    };
  }
  const blockers = unknownKeys(
    value,
    ALLOWED_GENERATOR_OUTPUT_KEYS,
    "output",
  );
  blockers.push(
    ...unknownKeys(
      value.editorial_frame,
      ALLOWED_EDITORIAL_FRAME_KEYS,
      "editorial_frame",
    ),
  );
  const pitches = object(value.weekly_longform_pitch);
  if (!pitches) {
    blockers.push("weekly_longform_pitch_map_required");
  }
  const allowedStories = new Map(
    request.stories.map((story) => [story.story_id, story]),
  );
  const pitchStoryIds = pitches ? Object.keys(pitches) : [];
  for (const storyId of pitchStoryIds) {
    if (!allowedStories.has(storyId)) {
      blockers.push(`generator_output_unknown_story:${storyId}`);
      continue;
    }
    const pitch = pitches[storyId];
    blockers.push(
      ...unknownKeys(
        pitch,
        ALLOWED_PITCH_KEYS,
        `weekly_longform_pitch.${storyId}`,
      ),
    );
    const allowedClaimIds = new Set(
      allowedStories
        .get(storyId)
        .verified_claims.map((claim) => claim.claim_id),
    );
    const allowedAssetIds = new Set(
      allowedStories.get(storyId).cleared_asset_ids,
    );
    for (const claimId of list(pitch?.claim_ids).map(text)) {
      if (!allowedClaimIds.has(claimId)) {
        blockers.push(
          `generator_output_unknown_claim:${storyId}:${claimId}`,
        );
      }
    }
    for (const [index, beat] of list(pitch?.visual_beats).entries()) {
      blockers.push(
        ...unknownKeys(
          beat,
          ALLOWED_VISUAL_BEAT_KEYS,
          `weekly_longform_pitch.${storyId}.visual_beats.${index}`,
        ),
      );
      const assetId = text(beat?.asset_item_id);
      if (assetId && !allowedAssetIds.has(assetId)) {
        blockers.push(
          `generator_output_unknown_asset:${storyId}:${assetId}`,
        );
      }
      for (const claimId of list(beat?.claim_ids).map(text)) {
        if (!allowedClaimIds.has(claimId)) {
          blockers.push(
            `generator_output_unknown_claim:${storyId}:${claimId}`,
          );
        }
      }
    }
    blockers.push(
      ...unknownKeys(
        pitch?.derivative_hooks,
        ALLOWED_DERIVATIVE_HOOK_KEYS,
        `weekly_longform_pitch.${storyId}.derivative_hooks`,
      ),
    );
  }
  for (const storyId of allowedStories.keys()) {
    if (!pitchStoryIds.includes(storyId)) {
      blockers.push(`generator_output_story_pitch_missing:${storyId}`);
    }
  }
  return {
    blockers: unique(blockers),
    value: blockers.length ? null : clone(value),
  };
}

function evidenceLineage(workOrder) {
  return list(workOrder?.selection?.selected).map((story) => ({
    story_id: story.story_id,
    source_evidence: {
      path: story.source_evidence.path,
      sha256: story.source_evidence.sha256,
    },
    rights_ledger: {
      path: story.rights_ledger.path,
      sha256: story.rights_ledger.sha256,
      canonical_sha256: story.rights_ledger.canonical_sha256,
    },
  }));
}

function observeEvidenceLineage(lineage) {
  return lineage.map((record) => {
    const next = clone(record);
    for (const key of ["source_evidence", "rights_ledger"]) {
      try {
        const bytes = fs.readFileSync(record[key].path);
        next[key].observed_sha256 = crypto
          .createHash("sha256")
          .update(bytes)
          .digest("hex");
        next[key].byte_length = bytes.length;
        next[key].available = true;
      } catch {
        next[key].observed_sha256 = null;
        next[key].byte_length = null;
        next[key].available = false;
      }
    }
    return next;
  });
}

function compareEvidenceLineage(before, after) {
  const afterByStory = new Map(
    after.map((record) => [record.story_id, record]),
  );
  const blockers = [];
  for (const record of before) {
    const observed = afterByStory.get(record.story_id);
    if (!observed) {
      blockers.push(
        `evidence_lineage_story_missing:${record.story_id}`,
      );
      continue;
    }
    if (
      digest(record.source_evidence) !==
      digest(observed.source_evidence)
    ) {
      blockers.push(
        `source_evidence_changed_during_enrichment:${record.story_id}`,
      );
    }
    if (
      digest(record.rights_ledger) !==
      digest(observed.rights_ledger)
    ) {
      blockers.push(
        `rights_ledger_changed_during_enrichment:${record.story_id}`,
      );
    }
  }
  return unique(blockers);
}

function evidencePreservationResult(before) {
  const after = observeEvidenceLineage(before);
  const blockers = compareEvidenceLineage(before, after);
  return {
    blockers,
    value: {
      all_match: blockers.length === 0,
      before_sha256: digest(before),
      after_sha256: digest(after),
      stories: after,
    },
  };
}

async function enrichWeeklyLongformEditorial({
  runId,
  generatedAt = new Date().toISOString(),
  candidates = [],
  generator,
  generator_identity: generatorIdentity = {},
} = {}) {
  const exactGeneratedAt = new Date(generatedAt);
  const timestamp = Number.isNaN(exactGeneratedAt.getTime())
    ? null
    : exactGeneratedAt.toISOString();
  const inputCandidates = Array.isArray(candidates) ? candidates : [];
  const preflight = preflightCandidates({
    runId,
    generatedAt,
    candidates: inputCandidates,
  });
  if (typeof generator !== "function") {
    preflight.blockers.push("async_json_generator_required");
  }
  if (!timestamp) {
    preflight.blockers.push("weekly_editorial_generated_at_invalid");
  }
  if (preflight.blockers.length) {
    return blockedResult({
      generatedAt: timestamp,
      runId,
      blockers: preflight.blockers,
      workOrderResult: preflight.workOrder,
    });
  }

  const selected = preflight.workOrder.selection.selected;
  const request = buildGenerationRequest({
    runId: preflight.workOrder.run_id,
    generatedAt: timestamp,
    selected,
  });
  const beforeLineage = observeEvidenceLineage(
    evidenceLineage(preflight.workOrder),
  );
  let rawOutput;
  try {
    rawOutput = await generator(clone(request));
  } catch (error) {
    const generatorErrorCode =
      normaliseGeneratorErrorCode(error);
    const preservation = evidencePreservationResult(beforeLineage);
    return blockedResult({
      generatedAt: timestamp,
      runId,
      blockers: [
        "weekly_editorial_json_generation_failed",
        ...(generatorErrorCode === "editorial_request_timeout"
          ? ["weekly_editorial_json_generation_timeout"]
          : []),
        ...preservation.blockers,
      ],
      generatorErrorCode,
      evidencePreservation: preservation.value,
    });
  }
  const postGenerationPreservation =
    evidencePreservationResult(beforeLineage);
  const validation = validateGeneratorOutput(rawOutput, request);
  if (
    validation.blockers.length ||
    postGenerationPreservation.blockers.length
  ) {
    return blockedResult({
      generatedAt: timestamp,
      runId,
      blockers: [
        ...validation.blockers,
        ...postGenerationPreservation.blockers,
      ],
      evidencePreservation: postGenerationPreservation.value,
    });
  }

  const output = validation.value;
  const effectiveIdentity = {
    ...generatorIdentity,
    ...(generator.identity || {}),
  };
  const provenance = {
    schema_version: "pulse-generator-provenance-v1",
    generated_at: timestamp,
    provider: text(effectiveIdentity.provider) || "injected",
    model: text(effectiveIdentity.model) || "unspecified",
    adapter: text(effectiveIdentity.adapter) || "injected",
    request_sha256: digest(request),
    output_sha256: digest(output),
    candidate_bindings_sha256: digest(beforeLineage),
    allowed_story_ids: [...request.allowed_story_ids],
    allowed_claim_ids_by_story: Object.fromEntries(
      request.stories.map((story) => [
        story.story_id,
        story.verified_claims.map((claim) => claim.claim_id),
      ]),
    ),
    allowed_asset_ids_by_story: Object.fromEntries(
      request.stories.map((story) => [
        story.story_id,
        [...story.cleared_asset_ids],
      ]),
    ),
    source_or_rights_fields_mutated: false,
    human_approval_granted: false,
  };
  const enrichedCandidates = inputCandidates.map((candidate) => {
    const storyId = text(candidate?.id || candidate?.story_id);
    return {
      ...clone(candidate),
      weekly_longform_pitch: clone(
        output.weekly_longform_pitch[storyId],
      ),
    };
  });
  let workOrderResult;
  try {
    workOrderResult = buildWeeklyLongformWorkOrder({
      runId,
      generatedAt: timestamp,
      candidates: enrichedCandidates,
      editorialFrame: clone(output.editorial_frame),
    });
  } catch {
    return blockedResult({
      generatedAt: timestamp,
      runId,
      blockers: ["weekly_enriched_work_order_validation_failed"],
      generatorProvenance: provenance,
      evidencePreservation: {
        all_match: false,
        stories: beforeLineage,
      },
    });
  }
  const finalPreservation = evidencePreservationResult(beforeLineage);
  const lineageBlockers = finalPreservation.blockers;
  const workOrderBlockers =
    workOrderResult.production_runner_admission?.status === "READY"
      ? []
      : list(workOrderResult.production_runner_admission?.blockers);
  const blockers = unique([
    ...lineageBlockers,
    ...workOrderBlockers,
  ]);
  const preservation = finalPreservation.value;
  if (blockers.length) {
    return blockedResult({
      generatedAt: timestamp,
      runId,
      blockers,
      generatorProvenance: provenance,
      workOrderResult,
      evidencePreservation: preservation,
    });
  }

  return {
    schema_version: SCHEMA_VERSION,
    generated_at: timestamp,
    run_id: preflight.workOrder.run_id,
    mode: MODE,
    verdict: "READY_FOR_LOCAL_PRODUCTION",
    blockers: [],
    generator_error_code: null,
    generation_request: request,
    generator_provenance: provenance,
    generator_output: output,
    editorial_frame: clone(output.editorial_frame),
    enriched_candidates: enrichedCandidates,
    evidence_preservation: preservation,
    work_order_result: workOrderResult,
    safety: {
      local_proof_only: true,
      source_or_rights_fields_mutated: false,
      approval_authority_created: false,
      scheduler_authority_created: false,
      publish_authority_created: false,
      database_authority_created: false,
      oauth_authority_created: false,
      external_publish_triggered: false,
      database_mutation_triggered: false,
    },
  };
}

function renderWeeklyLongformEditorialEnrichmentJson(result = {}) {
  return `${JSON.stringify(result, null, 2)}\n`;
}

function renderWeeklyLongformEditorialEnrichmentMarkdown(
  result = {},
) {
  const provenance = result.generator_provenance || {};
  const lines = [
    "# Pulse Gaming Weekly Longform Editorial Enrichment",
    "",
    `Generated: ${text(result.generated_at) || "unknown"}`,
    `Run: ${text(result.run_id) || "unknown"}`,
    `Mode: ${text(result.mode) || MODE}`,
    `Verdict: ${text(result.verdict) || "BLOCKED"}`,
    `Generator: ${text(provenance.provider) || "not called"} / ${
      text(provenance.model) || "not specified"
    }`,
    `Generator error code: \`${
      text(result.generator_error_code) || "none"
    }\``,
    `Enriched verified stories: ${list(
      result.enriched_candidates,
    ).length}`,
    `Request SHA-256: \`${text(provenance.request_sha256) || "none"}\``,
    `Output SHA-256: \`${text(provenance.output_sha256) || "none"}\``,
    `Evidence preserved: ${
      result.evidence_preservation?.all_match === true ? "Yes" : "No"
    }`,
    "",
    "## Blockers",
    "",
  ];
  if (!list(result.blockers).length) lines.push("- None");
  for (const blocker of list(result.blockers)) {
    lines.push(`- ${text(blocker)}`);
  }
  lines.push(
    "",
    "This LOCAL_PROOF enrichment does not grant approval, scheduler, database or publish authority.",
    "",
  );
  return lines.join("\n");
}

module.exports = {
  ALLOWED_GENERATOR_OUTPUT_KEYS,
  MODE,
  REQUEST_SCHEMA_VERSION,
  SCHEMA_VERSION,
  buildGenerationRequest,
  createAnthropicWeeklyLongformJsonGenerator,
  enrichWeeklyLongformEditorial,
  renderWeeklyLongformEditorialEnrichmentJson,
  renderWeeklyLongformEditorialEnrichmentMarkdown,
};
