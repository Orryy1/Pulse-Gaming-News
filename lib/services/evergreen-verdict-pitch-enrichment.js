"use strict";

const crypto = require("node:crypto");
const {
  editorialIdentityFor,
} = require("./governed-editorial-client");

const {
  buildEvergreenVerdictProductionWorkOrder,
} = require("./evergreen-verdict-production-work-order");

const SCHEMA_VERSION = "pulse-evergreen-pitch-enrichment-v1";
const MODE = "LOCAL_PROOF";
const ALLOWED_GENERATOR_OUTPUT_KEYS = Object.freeze([
  "script_material",
  "visual_beats",
]);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value || "").trim();
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function digest(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

function normaliseGeneratorOutput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return clone(value);
}

function buildGenerationRequest({ story, pitch }) {
  return {
    schema_version: "pulse-evergreen-generation-request-v1",
    task:
      "Create only an original hook/body/payoff/loop script_material object and at least eight timed full-bleed visual beats.",
    story: clone(story),
    pitch_context: {
      id: text(pitch?.id),
      title: text(pitch?.title),
      franchise: text(pitch?.franchise),
      format_shape: text(pitch?.format_shape),
      editorial_criteria: clone(array(pitch?.editorial_criteria)),
      item_rationales: clone(array(pitch?.item_rationales)),
      script_contract: clone(pitch?.script_contract || {}),
    },
    claims: clone(array(pitch?.claims)),
    rights_records: clone(array(pitch?.media_plan?.rights_records)),
    source_manifest: clone(array(pitch?.source_manifest)),
    allowed_claim_ids: array(pitch?.claims)
      .map((claim) => text(claim?.id))
      .filter(Boolean),
    allowed_rights_asset_ids: array(pitch?.media_plan?.rights_records)
      .map((record) => text(record?.asset_id))
      .filter(Boolean),
    output_contract: {
      allowed_top_level_keys: [...ALLOWED_GENERATOR_OUTPUT_KEYS],
      script_sections: ["hook", "body", "payoff", "loop"],
      minimum_visual_beats: 8,
      visual_timeline_end_seconds:
        pitch?.script_contract?.target_duration_seconds,
      unknown_claim_references_allowed: false,
      unknown_rights_assets_allowed: false,
      claims_sources_or_rights_may_be_returned: false,
    },
  };
}

function createAnthropicEvergreenJsonGenerator({
  client,
  model,
  max_tokens: maxTokens = 4096,
} = {}) {
  if (typeof client?.messages?.create !== "function") {
    throw new Error("anthropic_messages_client_required");
  }
  if (!text(model)) throw new Error("anthropic_model_required");
  if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
    throw new Error("anthropic_max_tokens_invalid");
  }
  const generator = async (request) => {
    const response = await client.messages.create({
      model: text(model),
      max_tokens: maxTokens,
      temperature: 0,
      system:
        "Return one JSON object only. Use exactly the requested output keys. Never create, edit or return claims, sources or rights. Reference only the allowed claim IDs and rights asset IDs.",
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
  generator.identity = editorialIdentityFor(client, model);
  return generator;
}

function blockedResult({ now, blockers, provenance = null } = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: now,
    mode: MODE,
    verdict: "BLOCKED",
    blockers: [...new Set(array(blockers))],
    generator_provenance: provenance,
    generator_output: null,
    enriched_pitch: null,
    work_order_result: null,
    safety: {
      planning_only: true,
      evidence_fields_mutated: false,
      approval_authority_created: false,
      scheduler_authority_created: false,
      publish_authority_created: false,
      no_publish_triggered: true,
    },
  };
}

async function enrichEvergreenVerdictPitch({
  story = {},
  evergreen_pitch: pitch = {},
  assessment,
  generator,
  generator_identity: generatorIdentity = {},
  history = [],
  policy,
  now = new Date().toISOString(),
} = {}) {
  const generatedAt = new Date(now);
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error("evergreen_enrichment_time_invalid");
  }
  const timestamp = generatedAt.toISOString();
  const preflightBlockers = [];
  if (!pitch || typeof pitch !== "object" || Array.isArray(pitch)) {
    preflightBlockers.push("explicit_evergreen_pitch_required");
  }
  if (
    !assessment ||
    assessment.verdict !== "READY_FOR_PRODUCTION" ||
    array(assessment.blockers).length > 0
  ) {
    preflightBlockers.push("evergreen_pitch_assessment_not_ready");
  }
  if (
    assessment &&
    text(assessment.candidate_id) !== text(pitch?.id)
  ) {
    preflightBlockers.push("evergreen_pitch_assessment_identity_mismatch");
  }
  if (typeof generator !== "function") {
    preflightBlockers.push("async_json_generator_required");
  }
  if (preflightBlockers.length) {
    return blockedResult({
      now: timestamp,
      blockers: preflightBlockers,
    });
  }

  const request = buildGenerationRequest({ story, pitch });
  let rawOutput;
  try {
    rawOutput = await generator(clone(request));
  } catch {
    return blockedResult({
      now: timestamp,
      blockers: ["evergreen_json_generation_failed"],
    });
  }
  const output = normaliseGeneratorOutput(rawOutput);
  if (!output) {
    return blockedResult({
      now: timestamp,
      blockers: ["evergreen_generator_output_invalid"],
    });
  }
  const forbiddenOutputKeys = Object.keys(output).filter(
    (key) => !ALLOWED_GENERATOR_OUTPUT_KEYS.includes(key),
  );
  if (forbiddenOutputKeys.length) {
    return blockedResult({
      now: timestamp,
      blockers: forbiddenOutputKeys.map(
        (key) => `generator_output_forbidden_field:${key}`,
      ),
    });
  }

  const effectiveIdentity = {
    ...generatorIdentity,
    ...(generator.identity || {}),
  };
  const provider = text(effectiveIdentity.provider) || "injected";
  const model = text(effectiveIdentity.model) || "unspecified";
  const adapter = text(effectiveIdentity.adapter) || "injected";
  const provenance = {
    schema_version: "pulse-generator-provenance-v1",
    generated_at: timestamp,
    provider,
    model,
    adapter,
    request_sha256: digest(request),
    output_sha256: digest(output),
    allowed_claim_ids: [...request.allowed_claim_ids],
    allowed_rights_asset_ids: [...request.allowed_rights_asset_ids],
    evidence_fields_mutated: false,
    human_approval_granted: false,
  };
  const enrichedPitch = clone(pitch);
  enrichedPitch.script_material = clone(output.script_material);
  enrichedPitch.visual_beats = clone(output.visual_beats);
  enrichedPitch.generator_provenance = clone(provenance);
  enrichedPitch.script_contract = {
    ...clone(pitch.script_contract || {}),
    originality: {
      script_original: true,
      copied_reference_script: false,
      copied_reference_sequence: false,
      competitor_assets_used: false,
      reviewed_by: `generator:${provider}:${model}`,
      attestation_kind: "generator_evidence_bound_originality_v1",
      human_review_complete: false,
    },
  };
  const workOrderResult =
    buildEvergreenVerdictProductionWorkOrder({
      story,
      evergreen_pitch: enrichedPitch,
      history,
      policy,
      now: timestamp,
    });

  if (workOrderResult.verdict !== "READY_FOR_LOCAL_PRODUCTION") {
    return {
      ...blockedResult({
        now: timestamp,
        blockers: workOrderResult.blockers,
        provenance,
      }),
      generator_output: output,
      work_order_result: workOrderResult,
    };
  }

  return {
    schema_version: SCHEMA_VERSION,
    generated_at: timestamp,
    mode: MODE,
    verdict: "READY_FOR_LOCAL_PRODUCTION",
    blockers: [],
    generator_provenance: provenance,
    generator_output: output,
    enriched_pitch: enrichedPitch,
    work_order_result: workOrderResult,
    safety: {
      planning_only: true,
      evidence_fields_mutated: false,
      approval_authority_created: false,
      scheduler_authority_created: false,
      publish_authority_created: false,
      no_publish_triggered: true,
    },
  };
}

function renderEvergreenVerdictPitchEnrichmentMarkdown(result = {}) {
  const provenance = result.generator_provenance || {};
  const lines = [
    "# Pulse Gaming Evergreen Pitch Enrichment",
    "",
    `Generated: ${text(result.generated_at)}`,
    `Mode: ${text(result.mode)}`,
    `Verdict: ${text(result.verdict)}`,
    `Generator: ${text(provenance.provider) || "not called"} / ${
      text(provenance.model) || "not specified"
    }`,
    `Allowed claim IDs: ${array(provenance.allowed_claim_ids).length}`,
    `Allowed rights asset IDs: ${
      array(provenance.allowed_rights_asset_ids).length
    }`,
    "",
    "## Blockers",
    "",
  ];
  if (!array(result.blockers).length) lines.push("- None");
  for (const blocker of array(result.blockers)) {
    lines.push(`- ${text(blocker)}`);
  }
  lines.push(
    "",
    "This LOCAL_PROOF enrichment does not grant approval, scheduler or publish authority.",
    "",
  );
  return lines.join("\n");
}

module.exports = {
  ALLOWED_GENERATOR_OUTPUT_KEYS,
  MODE,
  SCHEMA_VERSION,
  buildGenerationRequest,
  createAnthropicEvergreenJsonGenerator,
  enrichEvergreenVerdictPitch,
  renderEvergreenVerdictPitchEnrichmentMarkdown,
};
