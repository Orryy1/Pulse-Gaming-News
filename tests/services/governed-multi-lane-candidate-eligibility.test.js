"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  canonicalSha256,
  governMultiLaneCandidates,
} = require("../../lib/services/governed-multi-lane-candidate-eligibility");

const NOW = "2026-07-28T12:00:00.000Z";

function validEvergreenPitch(storyId) {
  const sourceUrl = "https://bethesda.net/en/game/fallout";
  return {
    id: "fallout-return-2026",
    story_id: storyId,
    origin_story_id: storyId,
    title: "Which Fallout Is Easiest To Return To In 2026?",
    franchise: "Fallout",
    platform: "multi-platform",
    topic_key: "fallout-return",
    format_shape: "ranked_lens",
    editorial_criteria: [
      "opening-hour friction",
      "build flexibility",
    ],
    item_rationales: ["Fallout 3", "New Vegas", "Fallout 4"].map(
      (subject) => ({
        subject,
        judgement: `${subject} has a distinct return profile.`,
        source_url: sourceUrl,
      }),
    ),
    claims: [
      "Fallout 3 begins in Vault 101.",
      "New Vegas is set in the Mojave.",
      "Fallout 4 includes settlements.",
    ].map((claim, index) => ({
      id: `claim-${index + 1}`,
      text: claim,
      source_url: sourceUrl,
    })),
    source_manifest: [
      {
        name: "Bethesda",
        url: sourceUrl,
        tier: "official_publisher",
      },
      {
        name: "Steam",
        url: "https://store.steampowered.com/franchise/Fallout/",
        tier: "official_storefront",
      },
    ],
    script_contract: {
      voice_mode: "sourced_synthesis",
      uses_first_person_play_claims: false,
      target_duration_seconds: 82,
      target_words_per_minute: 195,
      opening_premise_words: 11,
      closing_cta_count: 1,
    },
    media_plan: {
      exact_subject_motion_seconds: 62,
      clip_count: 7,
      distinct_motion_families: 3,
      unknown_reuploads: 0,
      third_party_music: false,
      rights_records: ["fallout-3", "new-vegas", "fallout-4"].map(
        (assetId) => ({
          asset_id: assetId,
          owner: "Pulse Gaming",
          source_url: sourceUrl,
          rights_basis: "owned_capture",
          usage: "gameplay_backbone",
        }),
      ),
    },
  };
}

test("a stale high-score raw Reddit script is excluded from breaking production", () => {
  const result = governMultiLaneCandidates({
    now: NOW,
    candidates: [
      {
        lane_id: "breaking_short",
        story_id: "1t0ee5l",
        title: "I got a 4TB external drive off Temu",
        source_type: "reddit",
        stage: "SCRIPT_READY",
        score: 99999,
        full_script: "An arbitrary old script is not governed evidence.",
        published_at: "2026-05-19T09:00:00.000Z",
      },
    ],
  });

  assert.deepEqual(result.eligible_candidates, []);
  assert.deepEqual(result.rejected_candidates, [
    {
      lane_id: "breaking_short",
      story_id: "1t0ee5l",
      stage: "SCRIPT_READY",
      score: 99999,
      exact_urgent_target: false,
      blockers: [
        "breaking_story_outside_current_window",
        "governed_source_evidence_required",
      ],
    },
  ]);
  assert.equal(result.verdict, "HOLD");
});

test("an exact urgent verified target enters ahead of a higher-score raw distractor", () => {
  const sourceEvidence = {
    verification_status: "CONFIRMED",
    verified_for_planning: true,
    primary_source_url:
      "https://news.xbox.com/en-us/2026/07/22/xbox-backward-compatibility-on-pc/",
    source_evidence_sha256: "1".repeat(64),
    path: "D:\\pulse-data\\evidence\\xbox-back-compat.json",
    file_sha256: "2".repeat(64),
  };
  const result = governMultiLaneCandidates({
    now: NOW,
    planner_payload: {
      breaking_story_id: "rss_5efb04ad7c4889e1",
      verification_status: sourceEvidence.verification_status,
      primary_source_url: sourceEvidence.primary_source_url,
      source_evidence_sha256:
        sourceEvidence.source_evidence_sha256,
      source_evidence_path: sourceEvidence.path,
      source_evidence_file_sha256:
        sourceEvidence.file_sha256,
    },
    candidates: [
      {
        lane_id: "breaking_short",
        story_id: "raw-score-distractor",
        title: "A high-score discussion post",
        stage: "PLANNING",
        score: 100000,
        published_at: "2026-07-28T11:00:00.000Z",
      },
      {
        lane_id: "breaking_short",
        story_id: "rss_5efb04ad7c4889e1",
        title: "4 Xbox Classics Hit PC, Achievements Come Later",
        stage: "PLANNING",
        score: 92,
        published_at: "2026-07-22T10:00:00.000Z",
      },
    ],
  });

  assert.equal(result.verdict, "READY");
  assert.equal(result.eligible_candidates.length, 1);
  assert.equal(
    result.eligible_candidates[0].story_id,
    "rss_5efb04ad7c4889e1",
  );
  assert.deepEqual(
    result.eligible_candidates[0].governed_source_evidence,
    sourceEvidence,
  );
  assert.deepEqual(result.eligible_candidates[0].eligibility, {
    basis: "EXACT_URGENT_TARGET",
    exact_urgent_target: true,
    planning_window_checked: true,
    planning_window_exception: "EXACT_URGENT_TARGET",
    source_evidence_sha256: "1".repeat(64),
    source_evidence_file_sha256: "2".repeat(64),
  });
  assert.deepEqual(result.rejected_candidates, [
    {
      lane_id: "breaking_short",
      story_id: "raw-score-distractor",
      stage: "PLANNING",
      score: 100000,
      exact_urgent_target: false,
      blockers: ["governed_source_evidence_required"],
    },
  ]);
});

test("an exact urgent verified target below the breaking score floor is held before planning", () => {
  const storyId = "rss_cabe09fbc0ecebd8";
  const sourceEvidence = {
    verification_status: "CONFIRMED",
    verified_for_planning: true,
    primary_source_url:
      "https://news.xbox.com/en-us/2026/07/28/play-more-ubisoft-games-on-pc/",
    source_evidence_sha256: "5".repeat(64),
    path: `D:\\pulse-data\\evidence\\${storyId}.json`,
    file_sha256: "6".repeat(64),
  };
  const result = governMultiLaneCandidates({
    now: NOW,
    planner_payload: {
      breaking_story_id: storyId,
      verification_status: sourceEvidence.verification_status,
      primary_source_url: sourceEvidence.primary_source_url,
      source_evidence_sha256:
        sourceEvidence.source_evidence_sha256,
      source_evidence_path: sourceEvidence.path,
      source_evidence_file_sha256:
        sourceEvidence.file_sha256,
    },
    candidates: [
      {
        lane_id: "breaking_short",
        story_id: storyId,
        title: "Play More Ubisoft Games on PC",
        stage: "PLANNING",
        score: 70,
        published_at: "2026-07-28T10:00:00.000Z",
      },
    ],
  });

  assert.equal(result.verdict, "HOLD");
  assert.deepEqual(result.eligible_candidates, []);
  assert.deepEqual(result.rejected_candidates, [
    {
      lane_id: "breaking_short",
      story_id: storyId,
      stage: "PLANNING",
      score: 70,
      exact_urgent_target: true,
      blockers: ["breaking_score_below_80"],
    },
  ]);
});

test("a fresh DB candidate can present persisted governed source bindings as flat fields", () => {
  const result = governMultiLaneCandidates({
    now: NOW,
    candidates: [
      {
        lane_id: "breaking_short",
        story_id: "official-xbox-fresh",
        title: "An official Xbox update",
        stage: "PLANNING",
        score: 90,
        published_at: "2026-07-28T10:30:00.000Z",
        verification_status: "CONFIRMED",
        verified_for_planning: true,
        primary_source_url:
          "https://news.xbox.com/en-us/2026/07/28/example/",
        source_evidence_sha256: "3".repeat(64),
        source_evidence_path:
          "D:\\pulse-data\\evidence\\official-xbox-fresh.json",
        source_evidence_file_sha256: "4".repeat(64),
      },
    ],
  });

  assert.equal(result.verdict, "READY");
  assert.equal(result.rejected_candidates.length, 0);
  assert.equal(
    result.eligible_candidates[0].governed_source_evidence
      .source_evidence_sha256,
    "3".repeat(64),
  );
});

test("an arbitrary evergreen script cannot substitute for a governed explicit pitch", () => {
  const result = governMultiLaneCandidates({
    now: NOW,
    candidates: [
      {
        lane_id: "evergreen_short",
        story_id: "evergreen-arbitrary-script",
        stage: "SCRIPT_READY",
        score: 500,
        full_script: "This script alone must never enter production.",
        evergreen_pitch: {
          title: "An unbound pitch-shaped object",
        },
      },
    ],
  });

  assert.deepEqual(result.eligible_candidates, []);
  assert.deepEqual(result.rejected_candidates[0].blockers, [
    "governed_evergreen_pitch_manifest_required",
  ]);
});

test("a hash-bound governed evergreen pitch with source and rights provenance is eligible", () => {
  const storyId = "evergreen-fallout-return";
  const pitch = validEvergreenPitch(storyId);
  const manifest = {
    schema_version: "pulse-evergreen-pitch-v1",
    manifest_id: "discovery-fallout-return-2026",
    origin_story_id: storyId,
    evidence_provenance: {
      source_evidence_sha256: `sha256:${"3".repeat(64)}`,
      source_packet_sha256: "1".repeat(64),
      rights_evidence_sha256: `sha256:${"4".repeat(64)}`,
      rights_ledger_sha256: "2".repeat(64),
      evidence_fields_mutated: false,
    },
    evergreen_pitch: pitch,
  };
  const pitchSha256 = canonicalSha256(manifest);
  const result = governMultiLaneCandidates({
    now: NOW,
    candidates: [
      {
        lane_id: "evergreen_short",
        story_id: storyId,
        stage: "PLANNING",
        score: 82,
        evergreen_pitch_manifest: manifest,
        pitch_sha256: pitchSha256,
      },
    ],
  });

  assert.equal(result.verdict, "READY");
  assert.equal(result.rejected_candidates.length, 0);
  assert.equal(result.eligible_candidates.length, 1);
  assert.deepEqual(result.eligible_candidates[0].evergreen_pitch, pitch);
  assert.equal(
    result.eligible_candidates[0].source_evidence_sha256,
    "1".repeat(64),
  );
  assert.equal(
    result.eligible_candidates[0].rights_ledger_sha256,
    "2".repeat(64),
  );
  assert.equal(
    result.eligible_candidates[0].eligibility.pitch_sha256,
    pitchSha256,
  );
});

test("a persisted explicit evergreen pitch can bind provenance without a wrapper manifest", () => {
  const storyId = "evergreen-halo-return";
  const pitch = {
    ...validEvergreenPitch(storyId),
    id: "halo-return-2026",
    title: "Which Halo Campaign Is Easiest To Return To?",
    franchise: "Halo",
  };
  const result = governMultiLaneCandidates({
    now: NOW,
    candidates: [
      {
        lane_id: "evergreen_short",
        story_id: storyId,
        stage: "PRODUCTION_READY",
        score: 79,
        evergreen_pitch: pitch,
        pitch_sha256: canonicalSha256(pitch),
        evidence_provenance: {
          source_evidence_sha256: `sha256:${"a".repeat(64)}`,
          source_packet_sha256: "b".repeat(64),
          rights_evidence_sha256: `sha256:${"c".repeat(64)}`,
          rights_ledger_sha256: "d".repeat(64),
          evidence_fields_mutated: false,
        },
      },
    ],
  });

  assert.equal(result.verdict, "READY");
  assert.equal(result.rejected_candidates.length, 0);
  assert.equal(result.eligible_candidates[0].story_id, storyId);
});

test("a longform-labelled story cannot enter without a governed hash-bound work order", () => {
  const result = governMultiLaneCandidates({
    now: NOW,
    candidates: [
      {
        lane_id: "weekly_longform",
        story_id: "raw-longform-label",
        stage: "SCRIPT_READY",
        score: 900,
        full_script: "A long script is not a governed work order.",
      },
    ],
  });

  assert.deepEqual(result.eligible_candidates, []);
  assert.deepEqual(result.rejected_candidates[0].blockers, [
    "governed_weekly_longform_work_order_required",
  ]);
});

test("a materialised weekly work order with per-story evidence hashes is eligible", () => {
  const runId = "weekly-flagship-2026-W31";
  const workOrder = {
    schema_version: "pulse-weekly-longform-work-order-v1",
    generated_at: "2026-07-28T11:30:00.000Z",
    run_id: runId,
    status: "READY_FOR_HUMAN_AV_REVIEW",
    blockers: [],
    selection: {
      selected: [1, 2, 3, 4].map((index) => ({
        story_id: `weekly-story-${index}`,
        source_evidence: {
          path: `D:\\pulse-data\\weekly\\source-${index}.json`,
          sha256: String(index).repeat(64),
        },
        rights_ledger: {
          path: `D:\\pulse-data\\weekly\\rights-${index}.json`,
          sha256: String(index + 4).repeat(64),
          canonical_sha256: String(index + 4).repeat(64),
        },
      })),
    },
    safety: {
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
    },
  };
  workOrder.work_order_sha256 = canonicalSha256(workOrder);
  const fileSha256 = "f".repeat(64);
  const result = governMultiLaneCandidates({
    now: NOW,
    candidates: [
      {
        lane_id: "weekly_longform",
        story_id: runId,
        stage: "PRODUCTION_READY",
        score: 75,
        work_order: workOrder,
        work_order_path:
          "D:\\pulse-data\\weekly\\weekly-longform-work-order.json",
        work_order_sha256: fileSha256,
      },
    ],
  });

  assert.equal(result.verdict, "READY");
  assert.equal(result.rejected_candidates.length, 0);
  assert.equal(result.eligible_candidates.length, 1);
  assert.deepEqual(
    result.eligible_candidates[0].work_order,
    workOrder,
  );
  assert.equal(
    result.eligible_candidates[0].eligibility.work_order_sha256,
    fileSha256,
  );
});

test("later governed work remains eligible after the planning freshness window", () => {
  const result = governMultiLaneCandidates({
    now: NOW,
    candidates: [
      {
        lane_id: "breaking_short",
        story_id: "breaking-already-reviewed",
        stage: "SCHEDULED",
        score: 20,
        published_at: "2026-05-01T00:00:00.000Z",
        governed_source_evidence: {
          verification_status: "CONFIRMED",
          verified_for_planning: true,
          primary_source_url:
            "https://news.xbox.com/en-us/2026/05/01/example/",
          source_evidence_sha256: "a".repeat(64),
          path:
            "D:\\pulse-data\\evidence\\breaking-already-reviewed.json",
          file_sha256: "b".repeat(64),
        },
      },
    ],
  });

  assert.equal(result.verdict, "READY");
  assert.equal(result.rejected_candidates.length, 0);
  assert.equal(
    result.eligible_candidates[0].eligibility
      .planning_window_checked,
    false,
  );
});
