"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  assessEvergreenVerdictCandidate,
} = require("../../lib/formats/evergreen-verdict-short");
const {
  createAnthropicEvergreenJsonGenerator,
  enrichEvergreenVerdictPitch,
  renderEvergreenVerdictPitchEnrichmentMarkdown,
} = require("../../lib/services/evergreen-verdict-pitch-enrichment");

const FIXTURE = require("../fixtures/evergreen-verdict-candidates-input.json");
const NOW = "2026-07-28T12:00:00.000Z";

function assessedInput() {
  const evergreenPitch = structuredClone(
    FIXTURE.manifests[0].evergreen_pitch,
  );
  evergreenPitch.story_id = "story-fallout-enrichment";
  evergreenPitch.claims = evergreenPitch.claims.map((claim, index) => ({
    id: `claim-${index + 1}`,
    ...claim,
  }));
  evergreenPitch.script_contract = {
    ...evergreenPitch.script_contract,
    target_duration_seconds: 70,
    target_words_per_minute: 175,
    opening_premise_words: 11,
  };
  evergreenPitch.media_plan.exact_subject_motion_seconds = 66;
  const story = {
    id: "story-fallout-enrichment",
    title: "Fallout return guide source package",
    url: "https://fallout.bethesda.net/en/games",
    source_confidence: "verified",
  };
  return {
    now: NOW,
    story,
    evergreen_pitch: evergreenPitch,
    assessment: assessEvergreenVerdictCandidate(evergreenPitch, {
      now: NOW,
    }),
  };
}

function generatedMaterial(pitch) {
  const claimIds = pitch.claims.map((claim) => claim.id);
  const claimNarrative = pitch.claims
    .map((claim) => claim.text)
    .join(" ");
  const rightsAssetIds = pitch.media_plan.rights_records.map(
    (record) => record.asset_id,
  );
  return {
    script_material: {
      hook: {
        text: "The easiest Fallout to return to is not the newest one.",
        claim_refs: [claimIds[2]],
      },
      body: {
        text: Array(8).fill(claimNarrative).join(" "),
        claim_refs: claimIds,
      },
      payoff: {
        text: claimNarrative,
        claim_refs: claimIds,
      },
      loop: {
        text: "Fallout 3 begins in Vault 101.",
        claim_refs: [claimIds[0]],
      },
    },
    visual_beats: [
      [0, 6, "hook", rightsAssetIds[0], "THE EASIEST RETURN?"],
      [6, 14, "body", rightsAssetIds[0], "OPENING FRICTION"],
      [14, 23, "body", rightsAssetIds[0], "VAULT 101"],
      [23, 32, "body", rightsAssetIds[1], "THE MOJAVE"],
      [32, 41, "body", rightsAssetIds[2], "SETTLEMENT BUILDING"],
      [41, 51, "body", rightsAssetIds[2], "BUILD FLEXIBILITY"],
      [51, 61, "payoff", rightsAssetIds[1], "THREE LENSES"],
      [61, 70, "loop", rightsAssetIds[0], "BACK TO THE VAULT"],
    ].map(([start, end, section, assetId, overlay], index) => ({
      id: `generated-beat-${index + 1}`,
      section,
      start_seconds: start,
      end_seconds: end,
      asset_id: assetId,
      overlay_text: overlay,
    })),
  };
}

test("enriches an assessed pitch only with generated script and visual material before the work-order gate", async () => {
  const input = assessedInput();
  const originalClaims = structuredClone(input.evergreen_pitch.claims);
  const originalSources = structuredClone(
    input.evergreen_pitch.source_manifest,
  );
  const originalRights = structuredClone(
    input.evergreen_pitch.media_plan.rights_records,
  );
  let request;
  const generator = async (value) => {
    request = value;
    return generatedMaterial(input.evergreen_pitch);
  };

  const result = await enrichEvergreenVerdictPitch({
    ...input,
    generator,
    generator_identity: {
      provider: "test",
      model: "deterministic-json-fixture",
      adapter: "injected",
    },
  });

  assert.equal(result.verdict, "READY_FOR_LOCAL_PRODUCTION");
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.enriched_pitch.claims, originalClaims);
  assert.deepEqual(result.enriched_pitch.source_manifest, originalSources);
  assert.deepEqual(
    result.enriched_pitch.media_plan.rights_records,
    originalRights,
  );
  assert.deepEqual(
    Object.keys(result.generator_output).sort(),
    ["script_material", "visual_beats"],
  );
  assert.deepEqual(request.allowed_claim_ids, [
    "claim-1",
    "claim-2",
    "claim-3",
  ]);
  assert.deepEqual(request.allowed_rights_asset_ids, [
    "fallout3-owned",
    "new-vegas-owned",
    "fallout4-owned",
  ]);
  assert.equal(
    result.enriched_pitch.script_contract.originality.script_original,
    true,
  );
  assert.equal(
    result.enriched_pitch.script_contract.originality
      .copied_reference_script,
    false,
  );
  assert.equal(result.generator_provenance.provider, "test");
  assert.equal(
    result.generator_provenance.evidence_fields_mutated,
    false,
  );
  assert.equal(
    result.work_order_result.verdict,
    "READY_FOR_LOCAL_PRODUCTION",
  );
  assert.equal(result.safety.approval_authority_created, false);
  assert.equal(result.safety.publish_authority_created, false);
});

test("rejects generator attempts to return claims, sources or rights", async () => {
  const input = assessedInput();
  const output = generatedMaterial(input.evergreen_pitch);
  output.claims = [
    {
      id: "invented-claim",
      text: "This was not present in the pitch.",
      source_url: "https://example.com/invented",
    },
  ];
  output.source_manifest = [{ name: "Invented source" }];
  output.rights_records = [{ asset_id: "invented-asset" }];

  const result = await enrichEvergreenVerdictPitch({
    ...input,
    generator: async () => output,
  });

  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.enriched_pitch, null);
  assert.equal(result.work_order_result, null);
  assert.equal(result.generator_output, null);
  assert.ok(
    result.blockers.includes("generator_output_forbidden_field:claims"),
  );
  assert.ok(
    result.blockers.includes(
      "generator_output_forbidden_field:source_manifest",
    ),
  );
  assert.ok(
    result.blockers.includes(
      "generator_output_forbidden_field:rights_records",
    ),
  );
  assert.equal(result.safety.evidence_fields_mutated, false);
});

test("does not call the generator when the supplied pitch assessment is not ready", async () => {
  const input = assessedInput();
  input.assessment = {
    ...input.assessment,
    verdict: "BLOCKED",
    blockers: ["rights_records_too_thin"],
  };
  let callCount = 0;

  const result = await enrichEvergreenVerdictPitch({
    ...input,
    generator: async () => {
      callCount += 1;
      return generatedMaterial(input.evergreen_pitch);
    },
  });

  assert.equal(callCount, 0);
  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.enriched_pitch, null);
  assert.equal(result.work_order_result, null);
  assert.ok(
    result.blockers.includes("evergreen_pitch_assessment_not_ready"),
  );
});

test("passes generated identifiers through the work-order gate and fails closed on unknown claims or assets", async () => {
  const input = assessedInput();
  const output = generatedMaterial(input.evergreen_pitch);
  output.script_material.hook.claim_refs = ["claim-unknown"];
  output.visual_beats[0].asset_id = "asset-unknown";

  const result = await enrichEvergreenVerdictPitch({
    ...input,
    generator: async () => output,
  });

  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.enriched_pitch, null);
  assert.equal(result.work_order_result.verdict, "BLOCKED");
  assert.ok(
    result.blockers.includes(
      "script_claim_reference_unknown:hook:claim-unknown",
    ),
  );
  assert.ok(
    result.blockers.includes(
      "visual_beat_rights_asset_unknown:generated-beat-1:asset-unknown",
    ),
  );
  assert.equal(result.safety.publish_authority_created, false);
});

test("fails closed when generated runtime or visual coverage violates the pitch contract", async () => {
  const input = assessedInput();
  const output = generatedMaterial(input.evergreen_pitch);
  for (const section of ["hook", "body", "payoff", "loop"]) {
    output.script_material[section].text = "One sourced fact.";
  }
  output.visual_beats.pop();

  const result = await enrichEvergreenVerdictPitch({
    ...input,
    generator: async () => output,
  });

  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.enriched_pitch, null);
  assert.ok(
    result.blockers.includes(
      "script_estimated_duration_outside_61_to_90_seconds",
    ),
  );
  assert.ok(result.blockers.includes("visual_beat_count_too_low"));
  assert.ok(result.blockers.includes("visual_beat_timeline_incomplete"));
  assert.equal(result.safety.approval_authority_created, false);
});

test("Anthropic adapter is client-injected, JSON-only and carries provider provenance without a network dependency", async () => {
  const input = assessedInput();
  const calls = [];
  const fakeClient = {
    messages: {
      async create(payload) {
        calls.push(payload);
        return {
          id: "msg_fixture_001",
          content: [
            {
              type: "text",
              text: JSON.stringify(
                generatedMaterial(input.evergreen_pitch),
              ),
            },
          ],
        };
      },
    },
  };
  const generator = createAnthropicEvergreenJsonGenerator({
    client: fakeClient,
    model: "claude-test-model",
    max_tokens: 4096,
  });

  const result = await enrichEvergreenVerdictPitch({
    ...input,
    generator,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "claude-test-model");
  assert.equal(calls[0].max_tokens, 4096);
  assert.match(calls[0].system, /JSON object only/i);
  assert.equal(result.verdict, "READY_FOR_LOCAL_PRODUCTION");
  assert.equal(result.generator_provenance.provider, "anthropic");
  assert.equal(
    result.generator_provenance.model,
    "claude-test-model",
  );
  assert.equal(result.generator_provenance.adapter, "messages.create");
});

test("generator failures remain a fail-closed LOCAL_PROOF result", async () => {
  const input = assessedInput();

  const result = await enrichEvergreenVerdictPitch({
    ...input,
    generator: async () => {
      throw new Error("sensitive provider detail");
    },
  });

  assert.equal(result.verdict, "BLOCKED");
  assert.deepEqual(result.blockers, ["evergreen_json_generation_failed"]);
  assert.equal(result.generator_output, null);
  assert.equal(result.enriched_pitch, null);
  assert.equal(
    JSON.stringify(result).includes("sensitive provider detail"),
    false,
  );
  assert.equal(result.safety.no_publish_triggered, true);
});

test("renders a human-readable enrichment provenance summary", async () => {
  const input = assessedInput();
  const result = await enrichEvergreenVerdictPitch({
    ...input,
    generator: async () => generatedMaterial(input.evergreen_pitch),
    generator_identity: {
      provider: "test",
      model: "fixture-model",
      adapter: "injected",
    },
  });

  const markdown =
    renderEvergreenVerdictPitchEnrichmentMarkdown(result);

  assert.match(
    markdown,
    /^# Pulse Gaming Evergreen Pitch Enrichment/m,
  );
  assert.match(markdown, /Verdict: READY_FOR_LOCAL_PRODUCTION/);
  assert.match(markdown, /Generator: test \/ fixture-model/);
  assert.match(markdown, /Allowed claim IDs: 3/);
  assert.match(markdown, /Allowed rights asset IDs: 3/);
  assert.match(
    markdown,
    /does not grant approval, scheduler or publish authority/i,
  );
});

module.exports = {
  assessedInput,
  generatedMaterial,
};
