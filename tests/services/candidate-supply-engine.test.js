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
