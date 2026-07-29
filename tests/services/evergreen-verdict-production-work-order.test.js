"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  buildEvergreenVerdictProductionWorkOrder,
  renderEvergreenVerdictProductionWorkOrderMarkdown,
} = require("../../lib/services/evergreen-verdict-production-work-order");

const FIXTURE = require("../fixtures/evergreen-verdict-candidates-input.json");
const NOW = "2026-07-28T12:00:00.000Z";

function completeInput() {
  const pitch = structuredClone(
    FIXTURE.manifests[0].evergreen_pitch,
  );
  pitch.story_id = "story-fallout-return";
  pitch.claims = pitch.claims.map((claim, index) => ({
    id: `claim-${index + 1}`,
    ...claim,
  }));
  pitch.script_contract = {
    ...pitch.script_contract,
    target_duration_seconds: 70,
    target_words_per_minute: 175,
    opening_premise_words: 11,
    originality: {
      script_original: true,
      copied_reference_script: false,
      copied_reference_sequence: false,
      competitor_assets_used: false,
      reviewed_by: "editorial-review-001",
    },
  };
  pitch.media_plan.exact_subject_motion_seconds = 66;
  pitch.script_material = {
    hook: {
      text: "The easiest Fallout to return to is not the newest one.",
      claim_refs: ["claim-3"],
    },
    body: {
      text:
        "Start with the friction. Fallout 3 moves from Vault 101 into open exploration quickly, so its core loop becomes clear before the systems become overwhelming. New Vegas offers the strongest early role-playing choices and makes the Mojave feel reactive almost immediately, but returning players still need to accept its rougher technical edges. Fallout 4 feels the smoothest in your hands and its settlement building adds a clear long-term project, yet that same system can slow the opening when you only want quests and discovery. Against our two stated criteria, opening-hour friction and build flexibility, each game wins a different argument. Fallout 3 is the cleanest route back into wandering. New Vegas gives choices the greatest weight. Fallout 4 offers the most comfortable controls and the broadest construction layer. None of those judgements requires pretending the games are identical, and every comparison stays tied to the official game descriptions and the declared editorial criteria.",
      claim_refs: ["claim-1", "claim-2", "claim-3"],
    },
    payoff: {
      text:
        "The verdict is Fallout 3 for the fastest return, New Vegas for role-playing depth and Fallout 4 for modern handling. Your best entry depends on which friction you will tolerate.",
      claim_refs: ["claim-1", "claim-2", "claim-3"],
    },
    loop: {
      text:
        "That is why the oldest-looking option can still be the easiest doorway back into Fallout.",
      claim_refs: ["claim-1"],
    },
  };
  const assetIds = pitch.media_plan.rights_records.map(
    (record) => record.asset_id,
  );
  pitch.visual_beats = [
    {
      id: "beat-hook",
      section: "hook",
      start_seconds: 0,
      end_seconds: 6,
      asset_id: assetIds[0],
      overlay_text: "THE EASIEST RETURN?",
    },
    {
      id: "beat-criteria",
      section: "body",
      start_seconds: 6,
      end_seconds: 14,
      asset_id: assetIds[0],
      overlay_text: "OPENING FRICTION",
    },
    {
      id: "beat-fallout-3",
      section: "body",
      start_seconds: 14,
      end_seconds: 23,
      asset_id: assetIds[0],
      overlay_text: "FASTEST TO WANDERING",
    },
    {
      id: "beat-new-vegas",
      section: "body",
      start_seconds: 23,
      end_seconds: 32,
      asset_id: assetIds[1],
      overlay_text: "CHOICES CARRY WEIGHT",
    },
    {
      id: "beat-fallout-4",
      section: "body",
      start_seconds: 32,
      end_seconds: 41,
      asset_id: assetIds[2],
      overlay_text: "SMOOTHEST CONTROLS",
    },
    {
      id: "beat-builds",
      section: "body",
      start_seconds: 41,
      end_seconds: 51,
      asset_id: assetIds[2],
      overlay_text: "BUILDS VS MOMENTUM",
    },
    {
      id: "beat-payoff",
      section: "payoff",
      start_seconds: 51,
      end_seconds: 61,
      asset_id: assetIds[1],
      overlay_text: "THREE DIFFERENT WINNERS",
    },
    {
      id: "beat-loop",
      section: "loop",
      start_seconds: 61,
      end_seconds: 70,
      asset_id: assetIds[0],
      overlay_text: "THE OLDEST DOORWAY",
    },
  ];

  return {
    now: NOW,
    story: {
      id: "story-fallout-return",
      title: "Fallout return guide source package",
      url: "https://fallout.bethesda.net/en/games",
      source_confidence: "verified",
    },
    evergreen_pitch: pitch,
  };
}

test("materialises one exact evidence-retaining LOCAL_PROOF production work order", () => {
  const input = completeInput();
  const result = buildEvergreenVerdictProductionWorkOrder(input);

  assert.equal(result.verdict, "READY_FOR_LOCAL_PRODUCTION");
  assert.deepEqual(result.blockers, []);
  assert.equal(
    result.work_order.schema_version,
    "pulse-evergreen-production-work-order-v1",
  );
  assert.deepEqual(result.work_order.story_snapshot, input.story);
  assert.deepEqual(
    result.work_order.evidence.claims,
    input.evergreen_pitch.claims,
  );
  assert.deepEqual(
    result.work_order.evidence.source_manifest,
    input.evergreen_pitch.source_manifest,
  );
  assert.deepEqual(
    result.work_order.evidence.rights_records,
    input.evergreen_pitch.media_plan.rights_records,
  );
  assert.deepEqual(
    result.work_order.script_contract.sections,
    input.evergreen_pitch.script_material,
  );
  assert.ok(
    result.work_order.script_contract.estimated_duration_seconds >= 61,
  );
  assert.ok(
    result.work_order.script_contract.estimated_duration_seconds <= 90,
  );
  assert.equal(
    result.work_order.script_contract.materialisation,
    "verbatim_from_explicit_evergreen_pitch",
  );
  assert.deepEqual(result.work_order.visual_beat_plan.canvas, {
    width: 1080,
    height: 1920,
  });
  assert.deepEqual(
    result.work_order.visual_beat_plan.full_bleed_region,
    {
      x: 0,
      y: 0,
      width: 1080,
      height: 1920,
    },
  );
  assert.ok(
    result.work_order.visual_beat_plan.covered_surfaces.includes(
      "youtube_shorts",
    ),
  );
  assert.ok(
    result.work_order.visual_beat_plan.covered_surfaces.includes("tiktok"),
  );
  assert.ok(
    result.work_order.visual_beat_plan.beats.every(
      (beat) =>
        beat.background.full_bleed === true &&
        beat.meaningful_overlay.bbox.x >=
          result.work_order.visual_beat_plan.safe_rect.x,
    ),
  );
  assert.equal(result.work_order.authority.approval_created, false);
  assert.equal(result.work_order.authority.scheduler_created, false);
  assert.equal(result.work_order.authority.publish_created, false);
});

test("fails closed when any required script section is missing", () => {
  const input = completeInput();
  delete input.evergreen_pitch.script_material.payoff;

  const result = buildEvergreenVerdictProductionWorkOrder(input);

  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.work_order, null);
  assert.ok(result.blockers.includes("script_section_missing:payoff"));
  assert.equal(result.safety.approval_authority_created, false);
  assert.equal(result.safety.publish_authority_created, false);
});

test("fails closed when script sections are not bound exclusively to explicit claims", () => {
  const input = completeInput();
  input.evergreen_pitch.script_material.hook.claim_refs = [];
  input.evergreen_pitch.script_material.body.claim_refs.push(
    "claim-invented",
  );

  const result = buildEvergreenVerdictProductionWorkOrder(input);

  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.work_order, null);
  assert.ok(
    result.blockers.includes("script_claim_references_missing:hook"),
  );
  assert.ok(
    result.blockers.includes(
      "script_claim_reference_unknown:body:claim-invented",
    ),
  );
});

test("fails closed when the materialised script cannot fill the 61 to 90 second lane", () => {
  const input = completeInput();
  for (const section of ["hook", "body", "payoff", "loop"]) {
    input.evergreen_pitch.script_material[section].text =
      "A sourced fact remains.";
  }

  const result = buildEvergreenVerdictProductionWorkOrder(input);

  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.work_order, null);
  assert.ok(
    result.blockers.includes(
      "script_estimated_duration_outside_61_to_90_seconds",
    ),
  );
});

test("fails closed without an explicit original-script review", () => {
  const input = completeInput();
  delete input.evergreen_pitch.script_contract.originality.reviewed_by;
  input.evergreen_pitch.script_contract.originality.copied_reference_sequence =
    true;

  const result = buildEvergreenVerdictProductionWorkOrder(input);

  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.work_order, null);
  assert.ok(result.blockers.includes("script_originality_review_missing"));
  assert.ok(
    result.blockers.includes("copied_reference_sequence_not_allowed"),
  );
});

test("fails closed when the pitch is not bound to the exact verified source story", () => {
  const input = completeInput();
  input.story.id = "different-story";
  input.story.url = "http://unverified.invalid/story";
  input.story.source_confidence = "rumour";

  const result = buildEvergreenVerdictProductionWorkOrder(input);

  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.work_order, null);
  assert.ok(result.blockers.includes("evergreen_story_binding_mismatch"));
  assert.ok(result.blockers.includes("evergreen_story_https_source_required"));
  assert.ok(
    result.blockers.includes("evergreen_story_verified_confidence_required"),
  );
});

test("fails closed when the visual beat plan is incomplete or references uncleared media", () => {
  const input = completeInput();
  input.evergreen_pitch.visual_beats[0].asset_id = "unknown-asset";
  input.evergreen_pitch.visual_beats.pop();

  const result = buildEvergreenVerdictProductionWorkOrder(input);

  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.work_order, null);
  assert.ok(result.blockers.includes("visual_beat_count_too_low"));
  assert.ok(result.blockers.includes("visual_beat_timeline_incomplete"));
  assert.ok(
    result.blockers.includes(
      "visual_beat_rights_asset_unknown:beat-hook:unknown-asset",
    ),
  );
});

test("inherits the evergreen gate and emits no work order when claims, sources or rights are incomplete", () => {
  const input = completeInput();
  input.evergreen_pitch.claims = [];
  input.evergreen_pitch.source_manifest = [];
  input.evergreen_pitch.media_plan.rights_records = [];

  const result = buildEvergreenVerdictProductionWorkOrder(input);

  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.work_order, null);
  assert.ok(result.blockers.includes("claim_inventory_too_thin"));
  assert.ok(result.blockers.includes("source_manifest_too_thin"));
  assert.ok(result.blockers.includes("rights_records_too_thin"));
  assert.equal(result.safety.no_publish_triggered, true);
});

test("validates the actual hook against the declared opening contract", () => {
  const input = completeInput();
  input.evergreen_pitch.script_material.hook.text =
    "This deliberately overlong opening premise contains far more than fifteen spoken words and therefore cannot pass the governed hook contract.";

  const result = buildEvergreenVerdictProductionWorkOrder(input);

  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.work_order, null);
  assert.ok(result.blockers.includes("script_hook_exceeds_15_words"));
  assert.ok(
    result.blockers.includes("opening_premise_word_count_mismatch"),
  );
});

test("renders a human-readable LOCAL_PROOF work-order summary", () => {
  const result = buildEvergreenVerdictProductionWorkOrder(completeInput());

  const markdown =
    renderEvergreenVerdictProductionWorkOrderMarkdown(result);

  assert.match(
    markdown,
    /^# Pulse Gaming Evergreen Production Work Order/m,
  );
  assert.match(markdown, /Mode: LOCAL_PROOF/);
  assert.match(markdown, /Verdict: READY_FOR_LOCAL_PRODUCTION/);
  assert.match(markdown, /Visual beats: 8/);
  assert.match(markdown, /Sources: 2/);
  assert.match(
    markdown,
    /does not grant approval, scheduler or publish authority/i,
  );
});

test("fails closed instead of throwing when the explicit evergreen pitch is absent", () => {
  const input = completeInput();
  input.evergreen_pitch = null;

  const result = buildEvergreenVerdictProductionWorkOrder(input);

  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.work_order, null);
  assert.ok(result.blockers.includes("explicit_evergreen_pitch_required"));
  assert.equal(result.safety.no_publish_triggered, true);
});

module.exports = {
  completeInput,
};
