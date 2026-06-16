"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPulseReleaseRadarPack,
  renderPulseReleaseRadarMarkdown,
} = require("../../lib/formats/pulse-release-radar");

function candidate(index, overrides = {}) {
  const n = String(index).padStart(2, "0");
  return {
    id: `july-2026-game-${n}`,
    title: `Verified Game ${n}`,
    canonical_game: `Verified Game ${n}`,
    release_date: `2026-07-${String(Math.min(index + 1, 28)).padStart(2, "0")}`,
    platforms: ["PC", "PlayStation 5", "Xbox Series X/S"],
    source_manifest: [
      {
        type: "official_store",
        label: "Steam",
        url: `https://store.steampowered.com/app/${1000 + index}/verified-game-${n}`,
        supports: ["release_date", "platforms", "screenshots"],
      },
      {
        type: "official_trailer",
        label: "Official trailer",
        url: `https://www.youtube.com/watch?v=verified${n}`,
        supports: ["gameplay_motion", "visual_style"],
      },
    ],
    claim_inventory: [
      {
        claim: `Verified Game ${n} launches in July 2026.`,
        source_url: `https://store.steampowered.com/app/${1000 + index}/verified-game-${n}`,
      },
      {
        claim: `Verified Game ${n} has official gameplay motion available.`,
        source_url: `https://www.youtube.com/watch?v=verified${n}`,
      },
    ],
    official_motion: {
      trailer_url: `https://www.youtube.com/watch?v=verified${n}`,
      clip_count: 4,
      distinct_source_families: 2,
      gameplay_seconds: 90,
    },
    player_impact: `The player-facing reason is specific for game ${n}.`,
    curiosity_gap: `The open question is whether game ${n} can hold attention after launch.`,
    risk_factor: `Risk ${n}: the official footage still leaves one design trade-off unclear.`,
    payoff: `By the end, viewers know if game ${n} is a buy, wait or wishlist candidate.`,
    verdict: index % 3 === 0 ? "wait" : "wishlist",
    debate_prompt: `Would you put game ${n} above the bigger sequel this month?`,
    search_demand: index % 2 === 0 ? "high" : "medium",
    affiliate_angle: index % 2 === 0 ? "PC setup and controller checks" : "console edition checks",
    ...overrides,
  };
}

test("Pulse Release Radar blocks unsourced or motion-thin candidates", () => {
  const pack = buildPulseReleaseRadarPack({
    monthLabel: "July 2026",
    candidates: [
      candidate(1, {
        source_manifest: [],
      }),
      candidate(2, {
        official_motion: { trailer_url: "", clip_count: 0, distinct_source_families: 0 },
      }),
      candidate(3),
    ],
  });

  assert.equal(pack.readiness.verdict, "BLOCKED");
  assert.equal(pack.ready_candidates.length, 1);
  assert.ok(pack.blocked_candidates.some((item) => item.blockers.includes("source_manifest_missing")));
  assert.ok(pack.blocked_candidates.some((item) => item.blockers.includes("official_motion_missing")));
});

test("Pulse Release Radar emits a blocked report when no candidates pass", () => {
  const pack = buildPulseReleaseRadarPack({
    monthLabel: "July 2026",
    candidates: [],
  });

  assert.equal(pack.readiness.verdict, "BLOCKED");
  assert.equal(pack.ready_candidates.length, 0);
  assert.ok(pack.readiness.hard_blockers.includes("insufficient_ready_candidates"));
  assert.doesNotThrow(() => renderPulseReleaseRadarMarkdown(pack));
});

test("Pulse Release Radar builds a review-ready 10 game long-form package", () => {
  const pack = buildPulseReleaseRadarPack({
    monthLabel: "July 2026",
    candidates: Array.from({ length: 10 }, (_, index) => candidate(index + 1)),
    affiliateTag: "pulsegaming-21",
  });

  assert.equal(pack.readiness.verdict, "READY_FOR_OPERATOR_REVIEW");
  assert.equal(pack.ready_candidates.length, 10);
  assert.ok(pack.longform.estimated_runtime_seconds >= 600);
  assert.equal(pack.longform.segments[0].rank, 1);
  assert.match(pack.longform.script, /^1\. Verified Game/m);
  assert.doesNotMatch(pack.longform.script, /^0\./m);
  assert.doesNotMatch(pack.longform.script, /\.\./);
  assert.ok(pack.longform.segments.every((segment) => segment.estimated_seconds >= 55));
  assert.ok(pack.repurposing.shorts.length, 10);
  assert.ok(pack.affiliate_plan.disclosure_required);
  assert.ok(pack.affiliate_plan.links.every((link) => link.url.includes("tag=pulsegaming-21")));
});

test("Pulse Release Radar public scripts avoid scaffold and filler language", () => {
  const pack = buildPulseReleaseRadarPack({
    monthLabel: "July 2026",
    candidates: Array.from({ length: 10 }, (_, index) => candidate(index + 1)),
  });

  const text = [
    pack.longform.script,
    ...pack.repurposing.shorts.map((short) => short.script),
    pack.blog_article.markdown,
    pack.newsletter.markdown,
  ].join("\n");

  assert.doesNotMatch(text, /let'?s dive in|here'?s what you need to know|source-backed update/i);
  assert.doesNotMatch(text, /the hook here is|the hook is|the signal is|for fans to argue about/i);
  assert.doesNotMatch(text, /viewers should know/i);
  assert.doesNotMatch(text, /this story finally has something specific to judge/i);
  assert.doesNotMatch(text, /\bFollow Pulse Gaming\b.*$/m);
});

test("Pulse Release Radar longform script blocks formulaic spreadsheet narration", () => {
  const pack = buildPulseReleaseRadarPack({
    monthLabel: "July 2026",
    candidates: Array.from({ length: 10 }, (_, index) => candidate(index + 1)),
  });

  assert.equal(pack.longform.transcript_qa.verdict, "pass");
  assert.doesNotMatch(pack.longform.script, /\bRisk check:/i);
  assert.doesNotMatch(pack.longform.script, /\bMy read is\b/i);
  assert.doesNotMatch(pack.longform.script, /\bBy the end, viewers know\b/i);
  assert.doesNotMatch(pack.longform.script, /That is why .* trailer both matter/i);
  assert.doesNotMatch(pack.longform.script, /answers The point is not/i);
  assert.doesNotMatch(pack.longform.script, /has to prove The tension/i);
  assert.doesNotMatch(pack.longform.script, /the worry is the risk is/i);
  assert.doesNotMatch(pack.longform.script, /reason will probably be licensed/i);
  assert.doesNotMatch(pack.longform.script, /visible risk is licensed/i);
  assert.doesNotMatch(pack.longform.script, /way this goes wrong is modernising/i);
  assert.doesNotMatch(pack.longform.script, /weak point is if/i);
  assert.ok((pack.longform.script.match(/\bThis is the obvious place to start\b/gi) || []).length <= 1);
  assert.ok((pack.longform.script.match(/\bThis is a different kind of bet\b/gi) || []).length <= 1);
  assert.ok((pack.longform.script.match(/\bis dated for\b/gi) || []).length <= 2);
  assert.ok((pack.longform.script.match(/\bThe question is whether\b/gi) || []).length <= 2);
  assert.ok((pack.longform.script.match(/\bYou should come away knowing\b/gi) || []).length <= 3);
  assert.match(pack.longform.script, /This is not a hype countdown/i);
});

test("Pulse Release Radar rewrites internal script notes into viewer-facing narration", () => {
  const pack = buildPulseReleaseRadarPack({
    monthLabel: "July 2026",
    candidates: Array.from({ length: 10 }, (_, index) =>
      candidate(index + 1, index === 0
        ? {
            curiosity_gap: "The hook is not that the remake exists. It is whether the changes matter.",
            payoff: "Viewers should know whether this is worth a preorder.",
          }
        : {}),
    ),
  });

  assert.doesNotMatch(pack.longform.script, /the hook is|viewers should know/i);
  assert.doesNotMatch(pack.longform.script, /\. Not that/);
  assert.match(pack.longform.script, /has to prove whether the changes matter/i);
  assert.match(pack.longform.script, /The practical call is whether this is worth a preorder/i);
});

test("Pulse Release Radar markdown exposes title, sources, verdict and review actions", () => {
  const pack = buildPulseReleaseRadarPack({
    monthLabel: "July 2026",
    candidates: Array.from({ length: 10 }, (_, index) => candidate(index + 1)),
  });

  const markdown = renderPulseReleaseRadarMarkdown(pack);

  assert.match(markdown, /Pulse Release Radar/);
  assert.match(markdown, /July 2026/);
  assert.match(markdown, /READY_FOR_OPERATOR_REVIEW/);
  assert.match(markdown, /Verified Game 01/);
  assert.match(markdown, /Official trailer/);
  assert.match(markdown, /operator review required/i);
});
