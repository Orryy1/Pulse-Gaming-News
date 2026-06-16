"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildCandidateSupplyReport,
  buildOfficialSourceWatchlist,
  fingerprintTitle,
  formatCandidateSupplyMarkdown,
} = require("../../lib/ops/candidate-supply");

function candidate(id, overrides = {}) {
  return {
    id,
    title: `Nintendo Confirms Switch 2 Story ${id}`,
    status: "publish_ready",
    score: 90,
    reasons: ["preflight_qa_pass", "scheduler_bridge_candidate"],
    source: {
      source_type: "rss",
      exported_path: `output/goal-proof/batch/${id}/visual_v4_render.mp4`,
    },
    source_manifest: {
      primary_source: {
        name: "IGN",
        url: `https://www.ign.com/articles/${id}`,
        published_at: "2026-06-11T09:00:00.000Z",
      },
      source_age_policy_hours: 168,
    },
    preflight_qa: { status: "pass", blockers: [] },
    ...overrides,
  };
}

test("buildOfficialSourceWatchlist combines official, media, event and discovery sources", () => {
  const watchlist = buildOfficialSourceWatchlist({
    rssFeeds: [{ name: "IGN", url: "https://feeds.feedburner.com/ign/all" }],
    subreddits: ["GamingLeaksAndRumours"],
  });

  assert.equal(watchlist.channel_id, "pulse-gaming");
  assert.ok(watchlist.sources.some((source) => source.name === "PlayStation Blog" && source.tier === "official_platform"));
  assert.ok(watchlist.sources.some((source) => source.name === "IGN" && source.tier === "major_media"));
  assert.ok(watchlist.sources.some((source) => source.name === "GamingLeaksAndRumours" && source.tier === "discovery_only"));
  assert.ok(watchlist.events.some((event) => event.name === "Nintendo Direct"));
});

test("fingerprintTitle dedupes outlet variants of the same story", () => {
  assert.equal(
    fingerprintTitle("Nintendo confirms a Switch 2 gameplay trailer"),
    fingerprintTitle("Nintendo confirmed Switch 2 gameplay trailer"),
  );
});

test("buildCandidateSupplyReport scores supply, dedupes stories and enforces green-ready targets", () => {
  const now = new Date("2026-06-11T10:00:00.000Z");
  const stories = [
    {
      id: "rss_1",
      title: "Nintendo confirms Switch 2 gameplay trailer",
      source_type: "rss",
      subreddit: "IGN",
      url: "https://www.ign.com/articles/switch-2-gameplay",
      timestamp: "2026-06-11T09:00:00.000Z",
    },
    {
      id: "rss_2",
      title: "Nintendo confirmed a Switch 2 gameplay trailer",
      source_type: "rss",
      subreddit: "GameSpot",
      url: "https://www.gamespot.com/articles/switch-2-gameplay",
      timestamp: "2026-06-11T09:10:00.000Z",
    },
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `rss_extra_${index + 1}`,
      title: `Official Publisher Story ${index + 1}`,
      source_type: "rss",
      subreddit: "Official",
      url: `https://example.com/official-story-${index + 1}`,
      timestamp: "2026-06-11T08:00:00.000Z",
    })),
  ];
  const candidateReport = {
    generated_at: now.toISOString(),
    totals: { stories_seen: 12, returned: 10, pending_audio: 0 },
    candidates: Array.from({ length: 10 }, (_, index) => candidate(`story-${index + 1}`)),
  };

  const report = buildCandidateSupplyReport({
    stories,
    candidateReport,
    channelConfig: {
      rssFeeds: [{ name: "IGN", url: "https://feeds.feedburner.com/ign/all" }],
      subreddits: ["GamingLeaksAndRumours"],
    },
    now,
  });

  assert.equal(report.verdict, "green");
  assert.equal(report.targets.green_ready_candidates, 10);
  assert.equal(report.summary.green_ready_candidates, 10);
  assert.equal(report.summary.source_safe_candidates, 10);
  assert.equal(report.summary.v4_ready_candidates, 10);
  assert.equal(report.dedupe.duplicate_group_count, 1);
  assert.ok(report.priority_scorecards[0].visual_availability_score > 0);
  assert.match(formatCandidateSupplyMarkdown(report), /Candidate Supply Engine/);
});

test("buildCandidateSupplyReport uses bridge source-age evidence for near-expiry runway warnings", () => {
  const now = new Date("2026-06-16T22:00:00.000Z");
  const candidateReport = {
    generated_at: now.toISOString(),
    totals: { stories_seen: 1, returned: 1, pending_audio: 0 },
    candidates: [
      candidate("fresh_xbox_alien_isolation_2_20260610", {
        title: "Alien Isolation 2 Has One Horror Risk",
        source_manifest: {
          primary_source: {
            name: "Xbox Wire",
            url: "https://news.xbox.com/en-us/2026/06/10/alien-isolation-2-poised-to-deliver-another-bold-chapter/",
            published_at: "2026-06-10T00:00:00.000Z",
          },
          source_age_policy_hours: 168,
        },
        preflight_qa: {
          status: "pass",
          blockers: [],
          checks: {
            source_age: {
              result: "pass",
              evidence: {
                source_published_at: "2026-06-10T00:00:00.000Z",
                policy_hours: 168,
              },
            },
          },
        },
      }),
      candidate("fresh_xbox_fable_living_population_20260610", {
        title: "Fable Has A 1,000 NPC Risk",
        status: "review",
        preflight_qa: {
          status: "blocked",
          blockers: ["visual_entity_match:direct_motion_subject_mismatch"],
          checks: {
            source_age: {
              result: "pass",
              evidence: {
                source_published_at: "2026-06-10T00:00:00.000Z",
                policy_hours: 168,
              },
            },
          },
        },
      }),
    ],
  };

  const report = buildCandidateSupplyReport({
    stories: [],
    candidateReport,
    channelConfig: {},
    now,
    targets: {
      greenReadyCandidates: 1,
      sourceSafeCandidates: 1,
      v4ReadyCandidates: 1,
      freshSourceBackedStories: 0,
    },
  });

  assert.equal(report.summary.green_ready_candidates, 1);
  assert.equal(report.summary.ready_candidates_expiring_within_24h, 1);
  assert.equal(report.summary.non_ready_candidates_expiring_within_24h, 1);
  assert.equal(report.summary.durable_green_ready_candidates, 0);
  assert.equal(report.priority_scorecards[0].age_hours, 166);
  assert.equal(report.priority_scorecards[0].source_age_policy_hours, 168);
  assert.equal(report.priority_scorecards[0].source_age_expires_in_hours, 2);
  assert.ok(report.warnings.includes("ready_candidates_expiring_within_24h:1"));
  assert.ok(report.warnings.includes("non_ready_candidates_expiring_within_24h:1"));
  assert.ok(report.warnings.includes("durable_green_ready_candidates_below_target:0/1"));
  assert.equal(report.next_action, "refresh_fresh_source_intake_and_promote_new_green_candidates_before_expiring_backlog");
  assert.match(formatCandidateSupplyMarkdown(report), /Durable GREEN-ready candidates: 0\/1/);
});
