"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");

const {
  createAnthropicEvergreenDiscoveryJsonGenerator,
  discoverEvergreenVerdictPitches,
  renderEvergreenAutonomousDiscoveryMarkdown,
} = require("../../lib/services/evergreen-autonomous-discovery");
const {
  buildEvergreenVerdictCandidateReport,
} = require("../../lib/services/evergreen-verdict-candidate-builder");

const NOW = "2026-07-28T12:00:00.000Z";

function verifiedStory({
  id = "fallout-return",
  franchise = "Fallout",
  platform = "multiplatform",
  topic_key = "returning-player-friction",
} = {}) {
  const sources = [
    {
      name: "Bethesda",
      url: `https://publisher.example/${id}`,
      tier: "official_publisher",
    },
    {
      name: "Steam",
      url: `https://store.steampowered.com/${id}`,
      tier: "official_storefront",
    },
  ];
  const claims = [1, 2, 3].map((index) => ({
    id: `${id}-claim-${index}`,
    subject: `${franchise} game ${index}`,
    text: `${franchise} verified stable fact ${index}.`,
    source_url: sources[(index - 1) % sources.length].url,
  }));
  const rightsRecords = [1, 2, 3].map((index) => ({
    asset_id: `${id}-owned-${index}`,
    owner: "Pulse Gaming",
    source_url: sources[0].url,
    rights_basis: "owned_capture",
    usage: "gameplay_backbone",
  }));
  return {
    id,
    title: `${franchise} evidence collection`,
    franchise,
    platform,
    topic_key,
    source_evidence: {
      schema_version: "pulse-evergreen-source-evidence-v1",
      verification_status: "CONFIRMED",
      verified_for_planning: true,
      packet_sha256: "b".repeat(64),
      claims,
      source_manifest: sources,
    },
    rights_evidence: {
      schema_version: "pulse-evergreen-rights-evidence-v1",
      decision: "CLEARED",
      ledger_sha256: "c".repeat(64),
      media_plan: {
        exact_subject_motion_seconds: 62,
        clip_count: 7,
        distinct_motion_families: 3,
        unknown_reuploads: 0,
        third_party_music: false,
        rights_records: rightsRecords,
      },
    },
    advertiser_safety: {
      decision: "SAFE",
      policy_version: "pulse-advertiser-safe-v1",
      evidence_sha256: "a".repeat(64),
    },
  };
}

function pitchFor(story, overrides = {}) {
  return {
    story_id: story.id,
    title: `Which ${story.franchise} Game Is Easiest To Return To?`,
    format_shape: "ranked_lens",
    editorial_criteria: [
      "opening-hour friction",
      "control readability",
    ],
    item_rationales: story.source_evidence.claims.map((claim) => ({
      subject: claim.subject,
      judgement: `${claim.subject} has one evidence-bound return consideration.`,
      claim_ids: [claim.id],
    })),
    ...overrides,
  };
}

test("derives a production-assessable original pitch while retaining verified claims and cleared rights verbatim", async () => {
  const story = verifiedStory();
  const generator = async () => ({
    pitches: [pitchFor(story)],
  });
  generator.identity = {
    provider: "fixture",
    model: "deterministic-editorial-v1",
    adapter: "injected",
  };

  const result = await discoverEvergreenVerdictPitches({
    stories: [story],
    generator,
    now: NOW,
  });

  assert.equal(result.verdict, "READY_FOR_CANDIDATE_ASSESSMENT");
  assert.equal(result.selected_candidates.length, 1);
  const selected = result.selected_candidates[0];
  assert.equal(selected.origin.story_id, story.id);
  assert.equal(selected.assessment.verdict, "READY_FOR_PRODUCTION");
  assert.deepEqual(
    selected.evergreen_pitch.claims,
    story.source_evidence.claims,
  );
  assert.deepEqual(
    selected.evergreen_pitch.source_manifest,
    story.source_evidence.source_manifest,
  );
  assert.deepEqual(
    selected.evergreen_pitch.media_plan,
    story.rights_evidence.media_plan,
  );
  assert.match(
    selected.evidence_provenance.source_evidence_sha256,
    /^sha256:[a-f0-9]{64}$/,
  );
  assert.match(
    selected.evidence_provenance.rights_evidence_sha256,
    /^sha256:[a-f0-9]{64}$/,
  );
  assert.equal(
    selected.evidence_provenance.source_packet_sha256,
    story.source_evidence.packet_sha256,
  );
  assert.equal(
    selected.evidence_provenance.rights_ledger_sha256,
    story.rights_evidence.ledger_sha256,
  );
  assert.equal(
    selected.evidence_provenance.advertiser_safety_evidence_sha256_declared,
    story.advertiser_safety.evidence_sha256,
  );
  assert.equal(selected.evidence_provenance.evidence_fields_mutated, false);
  assert.equal(result.candidate_manifests.length, 1);
  assert.deepEqual(
    result.candidate_manifests[0].evergreen_pitch,
    selected.evergreen_pitch,
  );
  assert.equal(result.safety.planning_only, true);
  assert.equal(result.safety.approval_authority_created, false);
  assert.equal(result.safety.scheduler_authority_created, false);
  assert.equal(result.safety.publish_authority_created, false);
  assert.equal(result.safety.no_external_publish_triggered, true);
});

test("emits an exact motion-repair work order instead of promoting a media-thin evergreen pitch", async () => {
  const story = verifiedStory({ id: "motion-thin-evergreen" });
  story.rights_evidence.media_plan.exact_subject_motion_seconds = 28;

  const result = await discoverEvergreenVerdictPitches({
    stories: [story],
    generator: async () => ({ pitches: [pitchFor(story)] }),
    now: NOW,
  });

  assert.equal(result.verdict, "HOLD");
  assert.deepEqual(result.deferred_candidates, [
    {
      story_id: story.id,
      blockers: ["exact_subject_motion_ratio_too_low"],
      motion_repair_work_order_sha256:
        result.motion_repair_work_orders[0].work_order_sha256,
    },
  ]);
  assert.equal(result.selected_candidates.length, 0);
  assert.equal(result.candidate_manifests.length, 0);
  assert.equal(result.motion_repair_work_orders.length, 1);

  const workOrder = result.motion_repair_work_orders[0];
  assert.equal(
    workOrder.schema_version,
    "pulse-evergreen-motion-coverage-repair-work-order-v1",
  );
  assert.equal(workOrder.mode, "LOCAL_PROOF");
  assert.equal(workOrder.story_id, story.id);
  assert.equal(workOrder.blocker, "exact_subject_motion_ratio_too_low");
  assert.equal(workOrder.target_duration_seconds, 82);
  assert.equal(workOrder.minimum_exact_subject_motion_ratio, 0.65);
  assert.equal(workOrder.minimum_required_motion_seconds, 53.3);
  assert.equal(workOrder.verified_materialised_motion_seconds, 28);
  assert.equal(workOrder.additional_motion_seconds_required, 25.3);
  assert.deepEqual(
    workOrder.baseline_rights_asset_ids,
    story.rights_evidence.media_plan.rights_records
      .map((record) => record.asset_id)
      .sort(),
  );
  assert.match(workOrder.work_order_sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    workOrder.completion_contract.static_images_count_as_motion_seconds,
    false,
  );
  assert.equal(
    workOrder.completion_contract.materialised_video_probe_required,
    true,
  );
  assert.equal(
    workOrder.completion_contract.amended_rights_ledger_required,
    true,
  );
  assert.equal(
    workOrder.completion_contract.materialisation_receipt_required,
    true,
  );
  assert.equal(
    workOrder.completion_contract
      .parent_source_media_url_and_sha256_required,
    true,
  );
  assert.equal(
    workOrder.completion_contract
      .exact_extraction_window_binding_required,
    true,
  );
  assert.equal(
    workOrder.completion_contract
      .materialised_output_segment_sha256_required,
    true,
  );
  assert.equal(
    workOrder.completion_contract
      .amended_rights_ledger_new_canonical_sha256_required,
    true,
  );
  assert.match(
    workOrder.operator_action.command,
    /^node tools\/evergreen-motion-repair-materialize\.js /,
  );
  assert.match(workOrder.operator_action.command, /--apply-local/);
  assert.equal(workOrder.safety.publish_authority_created, false);
  assert.equal(workOrder.safety.database_mutation_authorised, false);
  assert.equal(workOrder.safety.network_authorised, false);

  const markdown =
    renderEvergreenAutonomousDiscoveryMarkdown(result);
  assert.match(markdown, /Motion coverage repair work orders/);
  assert.match(markdown, new RegExp(story.id));
  assert.match(markdown, /25\.3 additional seconds/);
  assert.match(
    markdown,
    new RegExp(workOrder.work_order_sha256),
  );
});

test("fails closed when a completed motion repair is bound to a different generated candidate", async () => {
  const story = verifiedStory({ id: "motion-completed-evergreen" });
  story.motion_completion = {
    candidate_id: "evergreen-different-candidate",
    work_order_sha256: "d".repeat(64),
  };

  const result = await discoverEvergreenVerdictPitches({
    stories: [story],
    generator: async () => ({ pitches: [pitchFor(story)] }),
    now: NOW,
  });

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.selected_candidates.length, 0);
  assert.equal(result.candidate_manifests.length, 0);
  assert.deepEqual(result.deferred_candidates, [
    {
      story_id: story.id,
      blockers: ["motion_completion_candidate_id_mismatch"],
      expected_candidate_id: "evergreen-different-candidate",
      generated_candidate_id:
        "evergreen-" +
        crypto
          .createHash("sha256")
          .update(
            `evergreen-candidate-v1|${story.id}`,
          )
          .digest("hex")
          .slice(0, 16),
    },
  ]);
});

test("keeps the evergreen candidate identity stable when regenerated editorial wording changes", async () => {
  const story = verifiedStory({ id: "stable-evergreen-identity" });
  const first = await discoverEvergreenVerdictPitches({
    stories: [story],
    generator: async () => ({
      pitches: [
        pitchFor(story, {
          title: "Which Fallout Game Is Easiest To Return To?",
        }),
      ],
    }),
    now: NOW,
  });
  const second = await discoverEvergreenVerdictPitches({
    stories: [story],
    generator: async () => ({
      pitches: [
        pitchFor(story, {
          title: "The Best Fallout Starting Point For Returning Players",
        }),
      ],
    }),
    now: NOW,
  });

  assert.equal(first.selected_candidates.length, 1);
  assert.equal(second.selected_candidates.length, 1);
  assert.equal(
    first.selected_candidates[0].evergreen_pitch.id,
    second.selected_candidates[0].evergreen_pitch.id,
  );
  assert.equal(
    first.selected_candidates[0].evergreen_pitch.id,
    `evergreen-${crypto
      .createHash("sha256")
      .update("evergreen-candidate-v1|stable-evergreen-identity")
      .digest("hex")
      .slice(0, 16)}`,
  );
});

test("fails closed before generation when verification, rights or advertiser evidence is not explicitly green", async () => {
  const unverified = verifiedStory({ id: "unverified" });
  unverified.source_evidence.verification_status = "UNVERIFIED";
  const uncleared = verifiedStory({ id: "uncleared" });
  uncleared.rights_evidence.decision = "REVIEW";
  const unsafe = verifiedStory({ id: "unsafe" });
  unsafe.advertiser_safety.decision = "UNKNOWN";
  const incomplete = verifiedStory({ id: "incomplete" });
  incomplete.source_evidence.claims = incomplete.source_evidence.claims.slice(
    0,
    2,
  );
  let generatorCalls = 0;

  const result = await discoverEvergreenVerdictPitches({
    stories: [unverified, uncleared, unsafe, incomplete],
    generator: async () => {
      generatorCalls += 1;
      return { pitches: [] };
    },
    now: NOW,
  });

  assert.equal(generatorCalls, 0);
  assert.equal(result.verdict, "HOLD");
  assert.equal(result.selected_candidates.length, 0);
  assert.deepEqual(
    result.rejected_inputs.map((entry) => ({
      story_id: entry.origin.story_id,
      blockers: entry.blockers,
    })),
    [
      {
        story_id: "incomplete",
        blockers: ["verified_claim_inventory_too_thin"],
      },
      {
        story_id: "uncleared",
        blockers: ["rights_evidence_not_cleared"],
      },
      {
        story_id: "unsafe",
        blockers: ["advertiser_safety_not_green"],
      },
      {
        story_id: "unverified",
        blockers: ["source_evidence_not_confirmed"],
      },
    ],
  );
  assert.ok(
    result.blockers.includes(
      "no_verified_rights_cleared_advertiser_safe_inputs",
    ),
  );
});

test("rejects generator attempts to create or replace evidence and authority fields", async () => {
  const story = verifiedStory();
  const generated = pitchFor(story);
  generated.claims = [
    {
      id: "invented-claim",
      text: "An invented claim.",
      source_url: "https://invented.example/claim",
    },
  ];
  generated.publish_authority = true;

  const result = await discoverEvergreenVerdictPitches({
    stories: [story],
    generator: async () => ({
      pitches: [generated],
    }),
    now: NOW,
  });

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.selected_candidates.length, 0);
  assert.deepEqual(result.blockers, [
    "generator_output_forbidden_field:pitches.0.claims",
    "generator_output_forbidden_field:pitches.0.publish_authority",
  ]);
  assert.equal(result.safety.publish_authority_created, false);
});

test("rejects editorial rationales that are not bound to allowed verified claim IDs", async () => {
  const story = verifiedStory();
  const generated = pitchFor(story);
  generated.item_rationales[1].claim_ids = ["invented-claim"];

  const result = await discoverEvergreenVerdictPitches({
    stories: [story],
    generator: async () => ({ pitches: [generated] }),
    now: NOW,
  });

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.selected_candidates.length, 0);
  assert.deepEqual(result.deferred_candidates, [
    {
      story_id: story.id,
      blockers: [
        "generated_rationale_unknown_claim:invented-claim",
      ],
    },
  ]);
  assert.ok(
    result.blockers.includes("no_governed_evergreen_candidates_selected"),
  );
});

test("blocks pitches that copy or closely paraphrase recent and reference titles", async () => {
  const story = verifiedStory();
  const generated = pitchFor(story, {
    title: "Which Fallout Game Is Easiest To Return To In 2026?",
  });

  const result = await discoverEvergreenVerdictPitches({
    stories: [story],
    history: [
      {
        title: "Which Fallout Game Is Easiest To Return To?",
        published_at: "2026-07-21T19:00:00.000Z",
      },
    ],
    reference_titles: [
      "Every Fallout Game Ranked From Worst To Best",
    ],
    generator: async () => ({ pitches: [generated] }),
    now: NOW,
  });

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.deferred_candidates.length, 1);
  assert.deepEqual(result.deferred_candidates[0].blockers, [
    "near_duplicate_title",
  ]);
  assert.equal(
    result.deferred_candidates[0].novelty.nearest_title,
    "Which Fallout Game Is Easiest To Return To?",
  );
  assert.equal(
    result.deferred_candidates[0].novelty.nearest_title_origin,
    "history",
  );
  assert.ok(
    result.deferred_candidates[0].novelty.maximum_similarity >= 0.8,
  );
  assert.equal(result.deferred_candidates[0].novelty.passes, false);
});

test("does not recycle a source story that already produced an evergreen item", async () => {
  const story = verifiedStory();

  const result = await discoverEvergreenVerdictPitches({
    stories: [story],
    history: [
      {
        origin_story_id: story.id,
        title: "A completely different prior angle",
        published_at: "2026-07-20T19:00:00.000Z",
      },
    ],
    generator: async () => ({ pitches: [pitchFor(story)] }),
    now: NOW,
  });

  assert.equal(result.verdict, "HOLD");
  assert.deepEqual(result.deferred_candidates, [
    {
      story_id: story.id,
      blockers: ["origin_story_already_used"],
    },
  ]);
});

test("holds generated framing that violates the advertiser-safe copy policy", async () => {
  const story = verifiedStory();
  const generated = pitchFor(story, {
    title: "The Graphic Gore And Suicide Footage Ranking",
  });

  const result = await discoverEvergreenVerdictPitches({
    stories: [story],
    generator: async () => ({ pitches: [generated] }),
    now: NOW,
  });

  assert.equal(result.verdict, "HOLD");
  assert.deepEqual(result.deferred_candidates, [
    {
      story_id: story.id,
      blockers: [
        "generated_copy_advertiser_unsafe:graphic_gore",
        "generated_copy_advertiser_unsafe:self_harm",
      ],
    },
  ]);
});

test("ranks deterministically and selects a topic, franchise, shape and platform-diverse slate", async () => {
  const stories = [
    verifiedStory({
      id: "fallout-return",
      franchise: "Fallout",
      platform: "xbox",
      topic_key: "returning-player-friction",
    }),
    verifiedStory({
      id: "halo-return",
      franchise: "Halo",
      platform: "xbox",
      topic_key: "returning-player-friction",
    }),
    verifiedStory({
      id: "zelda-mechanics",
      franchise: "Zelda",
      platform: "nintendo",
      topic_key: "mechanics-that-aged-well",
    }),
    verifiedStory({
      id: "final-fantasy-builds",
      franchise: "Final Fantasy",
      platform: "playstation",
      topic_key: "build-flexibility",
    }),
  ];
  const shapeByStory = {
    "fallout-return": "ranked_lens",
    "halo-return": "still_worth_playing",
    "zelda-mechanics": "franchise_fault_line",
    "final-fantasy-builds": "versus_verdict",
  };
  const titleByStory = {
    "fallout-return": "Which Fallout Game Welcomes You Back Fastest?",
    "halo-return": "Is Halo Infinite Still Worth Returning To?",
    "zelda-mechanics": "The Zelda Mechanic That Aged Better Than Expected",
    "final-fantasy-builds":
      "Final Fantasy Builds: Flexibility Versus Immediate Power",
  };
  const generatedFor = (story) =>
    pitchFor(story, {
      title: titleByStory[story.id],
      format_shape: shapeByStory[story.id],
    });
  const generatorFor = (orderedStories) => async () => ({
    pitches: orderedStories.map(generatedFor),
  });
  const policy = {
    maximum_selected: 3,
    maximum_per_topic: 1,
    maximum_per_franchise: 1,
    maximum_per_shape: 1,
    maximum_per_platform: 1,
  };

  const forward = await discoverEvergreenVerdictPitches({
    stories,
    generator: generatorFor([...stories].reverse()),
    policy,
    now: NOW,
  });
  const reversed = await discoverEvergreenVerdictPitches({
    stories: [...stories].reverse(),
    generator: generatorFor(stories),
    policy,
    now: NOW,
  });

  const selectedIds = (result) =>
    result.selected_candidates.map((item) => item.origin.story_id);
  assert.deepEqual(selectedIds(forward), selectedIds(reversed));
  assert.equal(forward.selected_candidates.length, 3);
  assert.equal(
    new Set(
      forward.selected_candidates.map(
        (item) => item.evergreen_pitch.topic_key,
      ),
    ).size,
    3,
  );
  assert.equal(
    new Set(
      forward.selected_candidates.map(
        (item) => item.evergreen_pitch.platform,
      ),
    ).size,
    3,
  );
  assert.ok(
    forward.deferred_candidates.some((item) =>
      item.blockers.includes("topic_diversity_guard"),
    ),
  );
  assert.deepEqual(forward.ranking_contract, {
    algorithm: "evidence_novelty_then_stable_id_v1",
    stable_tie_breaker: "evergreen_pitch.id:ascending",
    diversity_selection: "deterministic_greedy_v1",
    policy,
  });
});

test("accepts the same governed evidence through a source-backed manifest without trusting surrounding manifest prose", async () => {
  const story = verifiedStory({
    id: "zelda-manifest",
    franchise: "Zelda",
    platform: "nintendo",
    topic_key: "mechanics-that-aged-well",
  });
  const manifest = {
    manifest_id: "governed-manifest-zelda",
    title: "This surrounding prose is not evidence",
    claims: [{ id: "invented-surrounding-claim" }],
    story,
  };

  const result = await discoverEvergreenVerdictPitches({
    manifests: [manifest],
    generator: async () => ({
      pitches: [
        pitchFor(story, {
          title: "The Zelda Mechanic That Still Earns Its Place",
          format_shape: "franchise_fault_line",
        }),
      ],
    }),
    now: NOW,
  });

  assert.equal(result.verdict, "READY_FOR_CANDIDATE_ASSESSMENT");
  assert.deepEqual(result.selected_candidates[0].origin, {
    kind: "manifest",
    manifest_id: manifest.manifest_id,
    story_id: story.id,
  });
  assert.deepEqual(
    result.selected_candidates[0].evergreen_pitch.claims,
    story.source_evidence.claims,
  );
  assert.equal(
    result.candidate_manifests[0].source_manifest_id,
    manifest.manifest_id,
  );
});

test("rejects structurally invalid source, rights and safety provenance before editorial generation", async () => {
  const story = verifiedStory({ id: "invalid-evidence" });
  story.source_evidence.packet_sha256 = "not-a-hash";
  story.source_evidence.claims[0].source_url =
    "https://unlisted.example/claim";
  story.rights_evidence.ledger_sha256 = "";
  story.rights_evidence.media_plan.rights_records[0].rights_basis =
    "attribution_only";
  story.advertiser_safety.evidence_sha256 = "";
  let calls = 0;

  const result = await discoverEvergreenVerdictPitches({
    stories: [story],
    generator: async () => {
      calls += 1;
      return { pitches: [] };
    },
    now: NOW,
  });

  assert.equal(calls, 0);
  assert.equal(result.verdict, "HOLD");
  assert.deepEqual(result.rejected_inputs, [
    {
      origin: {
        kind: "story",
        story_id: story.id,
      },
      blockers: [
        "advertiser_safety_evidence_sha256_required",
        "rights_basis_not_defensible",
        "rights_ledger_sha256_required",
        "source_claim_not_bound_to_source_manifest",
        "source_packet_sha256_required",
      ],
    },
  ]);
});

test("fails the whole generation batch on unknown or duplicate story identities", async () => {
  const story = verifiedStory();

  const result = await discoverEvergreenVerdictPitches({
    stories: [story],
    generator: async () => ({
      pitches: [
        pitchFor(story),
        pitchFor(story, { title: "A second pitch for the same story" }),
        {
          ...pitchFor(story),
          story_id: "unknown-story",
        },
      ],
    }),
    now: NOW,
  });

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.selected_candidates.length, 0);
  assert.deepEqual(result.blockers, [
    `generator_output_duplicate_story:${story.id}`,
    "generator_output_unknown_story:unknown-story",
  ]);
});

test("provides a deterministic JSON-only Anthropic adapter with no publishing authority", async () => {
  const calls = [];
  const expected = {
    pitches: [
      {
        story_id: "story-1",
        title: "A New Original Angle",
        format_shape: "ranked_lens",
        editorial_criteria: ["criterion one", "criterion two"],
        item_rationales: [],
      },
    ],
  };
  const generator = createAnthropicEvergreenDiscoveryJsonGenerator({
    client: {
      messages: {
        async create(input) {
          calls.push(input);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(expected),
              },
            ],
          };
        },
      },
    },
    model: "claude-governed-editorial",
  });
  const request = {
    schema_version: "pulse-evergreen-discovery-generation-request-v1",
    stories: [],
  };

  assert.deepEqual(await generator(request), expected);
  assert.deepEqual(generator.identity, {
    provider: "anthropic",
    model: "claude-governed-editorial",
    adapter: "messages.create",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].temperature, 0);
  assert.equal(calls[0].max_tokens, 4096);
  assert.equal(calls[0].editorial_request_profile, undefined);
  assert.match(calls[0].system, /never create or edit claims/i);
  assert.match(
    calls[0].system,
    /exactly one pitch for every eligible story/i,
  );
  assert.match(
    calls[0].system,
    /at least 2 distinct editorial criteria/i,
  );
  assert.match(
    calls[0].system,
    /at least 3 evidence-bound item rationales/i,
  );
  assert.match(
    calls[0].system,
    /format_shape listed in allowed_format_shapes/i,
  );
  assert.match(calls[0].system, /no approval, scheduling or publishing/i);
  assert.equal(calls[0].messages[0].content, JSON.stringify(request));
});

test("gives Google evergreen discovery an 8,192-token governed long-output profile", async () => {
  const calls = [];
  const client = {
    editorial_identity: {
      provider: "google",
      model: "gemini-evergreen-test",
      adapter: "gemini.generateContent",
    },
    messages: {
      async create(input) {
        calls.push(input);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ pitches: [] }),
            },
          ],
        };
      },
    },
  };
  const generator = createAnthropicEvergreenDiscoveryJsonGenerator({
    client,
    model: "gemini-evergreen-test",
  });

  await generator({
    schema_version: "pulse-evergreen-discovery-generation-request-v1",
    stories: [],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].max_tokens, 8_192);
  assert.equal(calls[0].editorial_request_profile, "long_output");
  assert.equal(calls[0].editorial_thinking_level, "low");
  assert.deepEqual(generator.identity, client.editorial_identity);

  const configuredGenerator =
    createAnthropicEvergreenDiscoveryJsonGenerator({
      client,
      model: "gemini-evergreen-test",
      max_tokens: 12_288,
    });
  await configuredGenerator({
    schema_version: "pulse-evergreen-discovery-generation-request-v1",
    stories: [],
  });
  assert.equal(calls[1].max_tokens, 12_288);
});

test("gives local Ollama evergreen discovery the governed 8,192-token long-output profile without paid thinking controls", async () => {
  const calls = [];
  const client = {
    editorial_identity: {
      provider: "ollama",
      model: "qwen3.5:27b",
      adapter: "ollama.api.chat",
    },
    messages: {
      async create(input) {
        calls.push(input);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ pitches: [] }),
            },
          ],
        };
      },
    },
  };
  const generator = createAnthropicEvergreenDiscoveryJsonGenerator({
    client,
    model: "qwen3.5:27b",
  });

  await generator({
    schema_version: "pulse-evergreen-discovery-generation-request-v1",
    stories: [],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].max_tokens, 8_192);
  assert.equal(calls[0].editorial_request_profile, "long_output");
  assert.equal(calls[0].editorial_thinking_level, undefined);
  assert.deepEqual(generator.identity, client.editorial_identity);
});

test("retains only a safe normalised generator failure code in discovery proof", async () => {
  const story = verifiedStory();
  const result = await discoverEvergreenVerdictPitches({
    stories: [story],
    generator: async () => {
      throw new Error("editorial_finish_reason_max_tokens");
    },
    now: NOW,
  });

  assert.equal(result.verdict, "HOLD");
  assert.deepEqual(result.blockers, ["generator_output_invalid"]);
  assert.equal(
    result.generator_error_code,
    "editorial_generation_incomplete",
  );
  assert.doesNotMatch(
    JSON.stringify(result),
    /editorial_finish_reason_max_tokens/,
  );
  assert.equal(result.generator_provenance.attempt_count, 1);
  assert.equal(result.generator_provenance.corrective_retry_used, false);
  assert.equal(result.safety.publish_authority_created, false);
  assert.match(
    renderEvergreenAutonomousDiscoveryMarkdown(result),
    /Generator error: editorial_generation_incomplete/,
  );
});

test("does not retain unknown provider failure text in discovery proof", async () => {
  const story = verifiedStory();
  const secret = "provider-secret-that-must-not-be-retained";
  const result = await discoverEvergreenVerdictPitches({
    stories: [story],
    generator: async () => {
      throw new Error(`upstream failed with ${secret}`);
    },
    now: NOW,
  });

  assert.equal(
    result.generator_error_code,
    "editorial_generation_failed",
  );
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
});

test("preserves the shared safe Gemini thinking-level validation code", async () => {
  const result = await discoverEvergreenVerdictPitches({
    stories: [verifiedStory()],
    generator: async () => {
      throw new Error("editorial_thinking_level_invalid");
    },
    now: NOW,
  });

  assert.equal(
    result.generator_error_code,
    "editorial_thinking_level_invalid",
  );
});

test("gives the editorial generator only evidence-bound claims, cleared asset IDs and originality constraints", async () => {
  const story = verifiedStory();
  let request;

  const result = await discoverEvergreenVerdictPitches({
    stories: [story],
    history: [{ title: "A Recent Pulse Verdict" }],
    reference_titles: ["A Competitor Reference Title"],
    generator: async (value) => {
      request = value;
      return { pitches: [pitchFor(story)] };
    },
    now: NOW,
  });

  assert.equal(result.verdict, "READY_FOR_CANDIDATE_ASSESSMENT");
  assert.deepEqual(request.novelty.prohibited_titles, [
    {
      origin: "history",
      title: "A Recent Pulse Verdict",
    },
    {
      origin: "reference",
      title: "A Competitor Reference Title",
    },
  ]);
  assert.deepEqual(
    request.stories[0].allowed_claim_ids,
    story.source_evidence.claims.map((claim) => claim.id),
  );
  assert.deepEqual(
    request.stories[0].allowed_rights_asset_ids,
    story.rights_evidence.media_plan.rights_records.map(
      (record) => record.asset_id,
    ),
  );
  assert.deepEqual(request.stories[0].evidence_binding, {
    source_evidence_sha256:
      result.selected_candidates[0].evidence_provenance
        .source_evidence_sha256,
    source_packet_sha256: story.source_evidence.packet_sha256,
    rights_evidence_sha256:
      result.selected_candidates[0].evidence_provenance
        .rights_evidence_sha256,
    rights_ledger_sha256: story.rights_evidence.ledger_sha256,
    advertiser_safety_evidence_sha256:
      result.selected_candidates[0].evidence_provenance
        .advertiser_safety_evidence_sha256,
    advertiser_safety_evidence_sha256_declared:
      story.advertiser_safety.evidence_sha256,
  });
  assert.equal(request.editorial_contract.structural_inspiration_only, true);
  assert.equal(request.editorial_contract.competitor_assets_allowed, false);
  assert.equal(request.editorial_contract.competitor_scripts_allowed, false);
  assert.equal(request.output_contract.claims_may_be_returned, false);
  assert.equal(request.output_contract.rights_may_be_returned, false);
  assert.deepEqual(request.output_contract.allowed_top_level_keys, [
    "pitches",
  ]);
  assert.equal(
    request.output_contract.exactly_one_pitch_per_eligible_story,
    true,
  );
  assert.deepEqual(
    request.output_contract.eligible_story_ids,
    [story.id],
  );
  assert.equal(
    request.output_contract.minimum_editorial_criteria_per_pitch,
    2,
  );
  assert.equal(
    request.output_contract.minimum_evidence_bound_item_rationales_per_pitch,
    3,
  );
  assert.deepEqual(
    request.output_contract.allowed_format_shapes,
    [
      "franchise_fault_line",
      "ranked_lens",
      "versus_verdict",
      "still_worth_playing",
    ],
  );
  assert.equal(
    request.output_contract.each_rationale_requires_subject_judgement_and_allowed_claim_ids,
    true,
  );
});

test("makes one bounded corrective retry when the first pitch misses only structural minimum counts", async () => {
  const story = verifiedStory();
  const requests = [];
  const thinPitch = pitchFor(story, {
    editorial_criteria: ["opening-hour friction"],
  });

  const result = await discoverEvergreenVerdictPitches({
    stories: [story],
    generator: async (request) => {
      requests.push(request);
      return requests.length === 1
        ? { pitches: [thinPitch] }
        : { pitches: [pitchFor(story)] };
    },
    now: NOW,
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].corrective_retry, undefined);
  assert.deepEqual(requests[1].corrective_retry, {
    attempt: 1,
    maximum_attempts: 1,
    reason: "generator_structural_minimums_not_met",
    blockers_by_story: [
      {
        story_id: story.id,
        blockers: ["generated_pitch_editorial_criteria_too_thin"],
      },
    ],
    instruction:
      "Return the complete pitches object again with exactly one pitch for every eligible story and satisfy every declared output_contract minimum. Do not add or alter claims, sources, rights, evidence or authority fields.",
  });
  assert.equal(result.verdict, "READY_FOR_CANDIDATE_ASSESSMENT");
  assert.equal(result.selected_candidates.length, 1);
  assert.equal(result.safety.approval_authority_created, false);
  assert.equal(result.safety.scheduler_authority_created, false);
  assert.equal(result.safety.publish_authority_created, false);
});

test("stops after the single structural corrective retry and holds a still-thin pitch", async () => {
  const story = verifiedStory();
  const thinPitch = pitchFor(story, {
    editorial_criteria: ["opening-hour friction"],
    item_rationales: pitchFor(story).item_rationales.slice(0, 2),
  });
  let calls = 0;

  const result = await discoverEvergreenVerdictPitches({
    stories: [story],
    generator: async () => {
      calls += 1;
      return { pitches: [thinPitch] };
    },
    now: NOW,
  });

  assert.equal(calls, 2);
  assert.equal(result.verdict, "HOLD");
  assert.deepEqual(result.deferred_candidates, [
    {
      story_id: story.id,
      blockers: [
        "generated_pitch_editorial_criteria_too_thin",
        "generated_pitch_item_rationales_too_thin",
      ],
    },
  ]);
  assert.equal(result.generator_provenance.attempt_count, 2);
  assert.equal(result.generator_provenance.corrective_retry_used, true);
});

test("does not retry when a structurally thin pitch also violates verified claim binding", async () => {
  const story = verifiedStory();
  const invalidPitch = pitchFor(story, {
    editorial_criteria: ["opening-hour friction"],
  });
  invalidPitch.item_rationales[0].claim_ids = ["invented-claim"];
  let calls = 0;

  const result = await discoverEvergreenVerdictPitches({
    stories: [story],
    generator: async () => {
      calls += 1;
      return { pitches: [invalidPitch] };
    },
    now: NOW,
  });

  assert.equal(calls, 1);
  assert.equal(result.verdict, "HOLD");
  assert.deepEqual(result.deferred_candidates, [
    {
      story_id: story.id,
      blockers: [
        "generated_pitch_editorial_criteria_too_thin",
        "generated_rationale_unknown_claim:invented-claim",
      ],
    },
  ]);
  assert.equal(result.generator_provenance.attempt_count, 1);
  assert.equal(result.generator_provenance.corrective_retry_used, false);
  assert.equal(result.safety.publish_authority_created, false);
});

test("fails closed when the corrective response attempts to add publishing authority", async () => {
  const story = verifiedStory();
  const thinPitch = pitchFor(story, {
    editorial_criteria: ["opening-hour friction"],
  });
  const authorityPitch = pitchFor(story);
  authorityPitch.publish_authority = true;
  let calls = 0;

  const result = await discoverEvergreenVerdictPitches({
    stories: [story],
    generator: async () => {
      calls += 1;
      return {
        pitches: [calls === 1 ? thinPitch : authorityPitch],
      };
    },
    now: NOW,
  });

  assert.equal(calls, 2);
  assert.equal(result.verdict, "HOLD");
  assert.deepEqual(result.blockers, [
    "generator_output_forbidden_field:pitches.0.publish_authority",
  ]);
  assert.equal(result.selected_candidates.length, 0);
  assert.equal(result.safety.approval_authority_created, false);
  assert.equal(result.safety.scheduler_authority_created, false);
  assert.equal(result.safety.publish_authority_created, false);
  assert.equal(result.safety.no_external_publish_triggered, true);
});

test("fails closed on duplicate source story identities so input order cannot change provenance", async () => {
  const first = verifiedStory({ id: "duplicate-story" });
  const conflicting = structuredClone(first);
  conflicting.source_evidence.claims[0].text =
    "A conflicting version of the same evidence.";
  let calls = 0;

  const result = await discoverEvergreenVerdictPitches({
    stories: [conflicting, first],
    generator: async () => {
      calls += 1;
      return { pitches: [] };
    },
    now: NOW,
  });

  assert.equal(calls, 0);
  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes("duplicate_story_input:duplicate-story"),
  );
  assert.equal(result.selected_candidates.length, 0);
});

test("keeps only one deterministic winner when two stories generate the same batch angle", async () => {
  const first = verifiedStory({
    id: "first-angle",
    franchise: "Fallout",
    platform: "xbox",
    topic_key: "return-friction",
  });
  const second = verifiedStory({
    id: "second-angle",
    franchise: "Zelda",
    platform: "nintendo",
    topic_key: "mechanics",
  });
  const sharedTitle = "The One Old Mechanic Players Still Notice";
  const outputs = [
    pitchFor(first, { title: sharedTitle }),
    pitchFor(second, { title: sharedTitle }),
  ];

  const result = await discoverEvergreenVerdictPitches({
    stories: [second, first],
    generator: async () => ({ pitches: [...outputs].reverse() }),
    now: NOW,
  });

  assert.equal(result.selected_candidates.length, 1);
  assert.equal(result.deferred_candidates.length, 1);
  assert.deepEqual(result.deferred_candidates[0].blockers, [
    "batch_duplicate_title",
  ]);
  assert.equal(
    result.deferred_candidates[0].duplicate_of_story_id,
    result.selected_candidates[0].origin.story_id,
  );
});

test("uses novelty as a declared ranking component after evidence quality", async () => {
  const familiar = verifiedStory({
    id: "familiar-angle",
    franchise: "Fallout",
    platform: "xbox",
    topic_key: "return-friction",
  });
  const original = verifiedStory({
    id: "original-angle",
    franchise: "Zelda",
    platform: "nintendo",
    topic_key: "world-navigation",
  });

  const result = await discoverEvergreenVerdictPitches({
    stories: [familiar, original],
    reference_titles: [
      "Which Fallout Game Is Easiest To Return To?",
    ],
    policy: {
      maximum_selected: 2,
      maximum_per_topic: 1,
      maximum_per_franchise: 1,
      maximum_per_shape: 2,
      maximum_per_platform: 1,
    },
    generator: async () => ({
      pitches: [
        pitchFor(familiar, {
          title: "Fallout Return: Which Game Feels Most Accessible?",
        }),
        pitchFor(original, {
          title: "The Zelda Navigation Rule Hiding In Plain Sight",
          format_shape: "franchise_fault_line",
        }),
      ],
    }),
    now: NOW,
  });

  assert.deepEqual(
    result.selected_candidates.map((item) => item.origin.story_id),
    ["original-angle", "familiar-angle"],
  );
  assert.ok(
    result.selected_candidates[0].ranking_components.novelty_score >
      result.selected_candidates[1].ranking_components.novelty_score,
  );
  assert.equal(
    result.selected_candidates[0].discovery_score,
    Math.round(
      result.selected_candidates[0].ranking_components.evidence_score *
        0.75 +
        result.selected_candidates[0].ranking_components.novelty_score *
          0.25,
    ),
  );
});

test("renders a human-readable LOCAL_PROOF discovery and safety summary", async () => {
  const story = verifiedStory();
  const result = await discoverEvergreenVerdictPitches({
    stories: [story],
    generator: async () => ({ pitches: [pitchFor(story)] }),
    now: NOW,
  });

  const markdown = renderEvergreenAutonomousDiscoveryMarkdown(result);

  assert.match(markdown, /^# Pulse Gaming Autonomous Evergreen Discovery/m);
  assert.match(markdown, /Mode: LOCAL_PROOF/);
  assert.match(markdown, /Verdict: READY_FOR_CANDIDATE_ASSESSMENT/);
  assert.match(markdown, /Which Fallout Game Is Easiest To Return To\?/);
  assert.match(markdown, /Evidence SHA-256:/);
  assert.match(
    markdown,
    /does not grant approval, scheduling, database, OAuth or publishing authority/i,
  );
});

test("hands selected manifests directly to the existing candidate assessment and enrichment lane", async () => {
  const story = verifiedStory();
  const discovery = await discoverEvergreenVerdictPitches({
    stories: [story],
    generator: async () => ({ pitches: [pitchFor(story)] }),
    now: NOW,
  });

  const report = buildEvergreenVerdictCandidateReport({
    manifests: discovery.candidate_manifests,
    now: NOW,
  });

  assert.equal(report.candidates.length, 1);
  assert.equal(
    report.candidates[0].assessment.verdict,
    "READY_FOR_PRODUCTION",
  );
  assert.equal(report.rotation.selected.length, 1);
  assert.deepEqual(
    report.selected_candidates[0].candidate,
    discovery.selected_candidates[0].evergreen_pitch,
  );
});
