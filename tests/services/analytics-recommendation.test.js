"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  evaluateHookRecommendationSignal,
  formatRecommendationForPrompt,
  parseLatestRecommendation,
  readLatestRecommendation,
  resolveFindingsPath,
} = require("../../lib/analytics-recommendation");
const { scoreStory } = require("../../lib/scoring");

test("parseLatestRecommendation returns the newest Tomorrow recommendation", () => {
  const md = [
    "# Analytics Findings",
    "## Tomorrow's recommendation",
    "Lead with older guidance.",
    "## Some other section",
    "text",
    "## Tomorrow's recommendation",
    "Front corporate drama with named antagonists and concrete outcomes.",
  ].join("\n");

  assert.equal(
    parseLatestRecommendation(md),
    "Front corporate drama with named antagonists and concrete outcomes.",
  );
});

test("readLatestRecommendation uses explicit findings path without leaking contents", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-analytics-"));
  const findings = path.join(dir, "analytics_findings.md");
  fs.writeFileSync(
    findings,
    "## Tomorrow's recommendation\nAvoid abstract industry commentary.\n",
  );

  const result = readLatestRecommendation({ findingsPath: findings });

  assert.equal(result.exists, true);
  assert.equal(result.path, findings);
  assert.equal(result.recommendation, "Avoid abstract industry commentary.");
});

test("resolveFindingsPath follows the analytics DB directory by default", () => {
  const target = resolveFindingsPath({
    resolveDbPath: () => "D:\\pulse-data\\pulse.db",
  });

  assert.equal(target, "D:\\pulse-data\\analytics_findings.md");
});

test("evaluateHookRecommendationSignal rewards named corporate conflict and concrete outcomes", () => {
  const signal = evaluateHookRecommendationSignal(
    {
      title:
        "Reggie says Nintendo stopped selling products on Amazon after price pressure",
      hook:
        "Amazon tried to strong-arm Nintendo into an illegal pricing move and Reggie shut it down.",
    },
    "Front corporate drama with named antagonists and concrete outcomes.",
  );

  assert.equal(signal.priority, "aligns_with_latest_recommendation");
  assert.ok(signal.score >= 55);
  assert.ok(signal.corporate_actors.includes("amazon"));
  assert.ok(signal.corporate_actors.includes("nintendo"));
  assert.ok(signal.conflict_terms.includes("strong-arm"));
});

test("evaluateHookRecommendationSignal flags abstract commentary for reframing", () => {
  const signal = evaluateHookRecommendationSignal(
    {
      title: "An executive says the future of the industry could be positive",
      hook: "The industry might be entering a vague new trend.",
    },
    "Front corporate drama with named antagonists and concrete outcomes.",
  );

  assert.equal(signal.priority, "avoid_or_reframe");
  assert.ok(signal.abstract_commentary_terms.length >= 2);
});

test("formatRecommendationForPrompt makes the daily signal actionable", () => {
  const prompt = formatRecommendationForPrompt(
    "Front corporate drama with named antagonists and concrete outcomes.",
  );

  assert.match(prompt, /DAILY ANALYTICS RECOMMENDATION/);
  assert.match(prompt, /named people\/companies/);
  assert.match(prompt, /could\/might/);
});

test("scoring records analytics signal without changing totals or decisions", () => {
  const story = {
    id: "story",
    title:
      "Reggie says Nintendo stopped selling products on Amazon after price pressure",
    hook:
      "Amazon tried to strong-arm Nintendo into an illegal pricing move and Reggie shut it down.",
    flair: "News",
    subreddit: "nintendo",
    source_type: "rss",
    score: 50,
    timestamp: "2026-05-14T12:00:00.000Z",
  };

  const baseline = scoreStory(story, { analyticsRecommendation: null });
  const withSignal = scoreStory(story, {
    analyticsRecommendation:
      "Front corporate drama with named antagonists and concrete outcomes.",
  });

  assert.equal(withSignal.total, baseline.total);
  assert.equal(withSignal.decision, baseline.decision);
  assert.equal(
    withSignal.inputs.analytics_recommendation_signal.priority,
    "aligns_with_latest_recommendation",
  );
});
