"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildScoringDigestMessage } = require("../../lib/observability");

test("scoring digest keeps long titles readable and explains review action", () => {
  const longTitle =
    "While Other Games Try To Avoid GTA 6, Phantom Blade Zero Has Changed Its Entire Launch Plan";
  const message = buildScoringDigestMessage({
    window_hours: 24,
    scored: 12,
    by_decision: { auto: 0, review: 10, defer: 2, reject: 0 },
    hard_stops: 0,
    avg_total: 63.1,
    top: [
      {
        story_id: "phantom",
        total: 70,
        decision: "review",
        title: longTitle,
      },
    ],
    near_miss: [
      {
        story_id: "phantom",
        total: 70,
        decision: "review",
        title: longTitle,
      },
    ],
  });

  assert.match(message, /Review means/);
  assert.match(message, /Open the review queue/);
  assert.match(message, new RegExp(longTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(message, /\.\.\./);
});
