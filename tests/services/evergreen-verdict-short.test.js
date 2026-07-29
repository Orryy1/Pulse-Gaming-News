"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  DEFAULT_ROTATION_POLICY,
  assessEvergreenVerdictCandidate,
  buildEvergreenReferenceAudit,
  buildEvergreenVerdictRotation,
} = require("../../lib/formats/evergreen-verdict-short");
const pulseGaming = require("../../channels/pulse-gaming");

const NOW = "2026-07-28T12:00:00.000Z";

function candidate(overrides = {}) {
  return {
    id: "fallout-return-2026",
    title: "Which Fallout Is Easiest To Return To In 2026?",
    franchise: "Fallout",
    format_shape: "ranked_lens",
    editorial_criteria: [
      "opening-hour friction",
      "build flexibility",
      "quest density",
    ],
    item_rationales: [
      {
        subject: "Fallout 3",
        judgement: "Fast route from vault exit to exploration.",
        source_url: "https://fallout.bethesda.net/en/games/fallout-3",
      },
      {
        subject: "Fallout New Vegas",
        judgement: "Strong early choices with a rougher technical return.",
        source_url:
          "https://fallout.bethesda.net/en/games/fallout-new-vegas",
      },
      {
        subject: "Fallout 4",
        judgement: "Smooth controls with a slower settlement opening.",
        source_url: "https://fallout.bethesda.net/en/games/fallout-4",
      },
    ],
    claims: [
      {
        text: "Fallout 3 begins in Vault 101.",
        source_url: "https://fallout.bethesda.net/en/games/fallout-3",
      },
      {
        text: "New Vegas is set in the Mojave.",
        source_url:
          "https://fallout.bethesda.net/en/games/fallout-new-vegas",
      },
      {
        text: "Fallout 4 includes settlement building.",
        source_url: "https://fallout.bethesda.net/en/games/fallout-4",
      },
    ],
    source_manifest: [
      {
        name: "Bethesda",
        url: "https://fallout.bethesda.net/en/games",
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
      rights_records: [
        {
          asset_id: "fallout3-owned",
          owner: "Pulse Gaming",
          source_url: "https://fallout.bethesda.net/en/games/fallout-3",
          rights_basis: "owned_capture",
          usage: "gameplay_backbone",
        },
        {
          asset_id: "new-vegas-owned",
          owner: "Pulse Gaming",
          source_url:
            "https://fallout.bethesda.net/en/games/fallout-new-vegas",
          rights_basis: "owned_capture",
          usage: "gameplay_backbone",
        },
        {
          asset_id: "fallout4-owned",
          owner: "Pulse Gaming",
          source_url: "https://fallout.bethesda.net/en/games/fallout-4",
          rights_basis: "owned_capture",
          usage: "gameplay_backbone",
        },
      ],
    },
    reference_titles: ["The Worst Thing In Every Fallout Game"],
    ...overrides,
  };
}

test("reference audit records performance, franchise mix and continuation risk without copying", () => {
  const report = buildEvergreenReferenceAudit({
    channel: {
      id: "epix-reference",
      display_name: "Epix Gaming",
    },
    collected_at: NOW,
    videos: [
      {
        id: "one",
        title: "The WORST Thing In EVERY AC Game",
        view_count: 217000,
        duration_s: 111,
        published_at: "2026-07-25T10:00:00.000Z",
      },
      {
        id: "two",
        title: "AC DLCs Ranked From Worst To Best Pt.1",
        view_count: 100000,
        duration_s: 81,
        published_at: "2026-07-21T10:00:00.000Z",
      },
      {
        id: "three",
        title: "AC DLCs Ranked From Worst To Best Pt.2",
        view_count: 40000,
        duration_s: 84,
        published_at: "2026-07-21T15:00:00.000Z",
      },
    ],
  });

  assert.equal(report.channel.display_name, "Epix Gaming");
  assert.equal(report.franchise_mix[0].franchise, "Assassin's Creed");
  assert.equal(report.continuation_analysis.pairs.length, 1);
  assert.equal(
    report.continuation_analysis.pairs[0]
      .part_two_to_part_one_view_ratio,
    0.4,
  );
  assert.equal(
    report.continuation_analysis.automatic_continuations_supported,
    false,
  );
  assert.equal(report.performance.top_by_views[0].id, "one");
  assert.equal(report.pulse_adaptation.copy_titles, false);
  assert.equal(report.pulse_adaptation.copy_assets, false);
});

test("source-backed motion-rich evergreen candidate passes the production gate", () => {
  const result = assessEvergreenVerdictCandidate(candidate(), {
    history: [],
    now: NOW,
  });

  assert.equal(result.verdict, "READY_FOR_PRODUCTION");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.format_id, "evergreen_verdict_short");
  assert.equal(result.duration_lane, "pulse_extended_short");
  assert.equal(result.scheduler_authoritative, false);
  assert.equal(result.dispatch_ready, false);
});

test("rotation selects at most two distinct shapes and respects franchise cooldown", () => {
  const rotation = buildEvergreenVerdictRotation({
    now: NOW,
    policy: DEFAULT_ROTATION_POLICY,
    history: [
      {
        story_id: "recent-fallout",
        franchise: "Fallout",
        format_shape: "ranked_lens",
        published_at: "2026-07-26T12:00:00.000Z",
      },
    ],
    candidates: [
      candidate(),
      candidate({
        id: "zelda-fault-line",
        title: "The Zelda Mechanic That Aged Best In Every Era",
        franchise: "The Legend of Zelda",
        format_shape: "franchise_fault_line",
      }),
      candidate({
        id: "halo-versus",
        title: "Halo 2 Or Halo 3: Which Campaign Respects Your Time?",
        franchise: "Halo",
        format_shape: "versus_verdict",
      }),
      candidate({
        id: "forza-return",
        title: "Is Forza Horizon 4 Still Worth Playing In 2026?",
        franchise: "Forza",
        format_shape: "still_worth_playing",
      }),
    ],
  });

  assert.equal(rotation.selected.length, 2);
  assert.equal(
    new Set(rotation.selected.map((row) => row.format_shape)).size,
    2,
  );
  assert.ok(
    rotation.deferred.some(
      (row) =>
        row.id === "fallout-return-2026" &&
        row.blockers.includes("franchise_cooldown_active"),
    ),
  );
  assert.equal(rotation.scheduler_authoritative_candidate_count, 0);
  assert.equal(rotation.safety.no_publish_triggered, true);
});

test("Pulse channel exposes the bounded original evergreen experiment", () => {
  const config = pulseGaming.evergreenVerdictRotation;

  assert.equal(config.enabled, true);
  assert.equal(config.target_per_week, 2);
  assert.equal(config.maximum_per_week, 2);
  assert.equal(config.duration_lane, "pulse_extended_short");
  assert.match(
    pulseGaming.evergreenVerdictPrompt,
    /never copy/i,
  );
  assert.match(
    pulseGaming.evergreenVerdictPrompt,
    /verified first-hand play evidence/i,
  );
});
