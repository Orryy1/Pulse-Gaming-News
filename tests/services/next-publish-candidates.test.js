const { test } = require("node:test");
const assert = require("node:assert");

const {
  buildNextPublishCandidatesReport,
  formatNextPublishCandidatesMarkdown,
  scoreAnalyticsFit,
} = require("../../tools/next-publish-candidates");

const analyticsText = [
  "## Tomorrow's recommendation",
  "Front corporate drama with named antagonists and concrete outcomes.",
  "Avoid abstract industry commentary. Prioritise specificity over vague insider quotes.",
].join("\n");

function baseStory(overrides = {}) {
  return {
    id: "story_base",
    title: "Nintendo executive says Amazon deal collapsed after pricing dispute",
    approved: true,
    auto_approved: false,
    exported_path: "D:/pulse-data/media/output/final/story_base.mp4",
    duration_seconds: 66,
    breaking_score: 60,
    publish_status: null,
    full_script: "Nintendo executive Reggie Fils-Aime says Amazon's pricing demand collapsed.",
    ...overrides,
  };
}

test("next publish report ranks clean approved candidates by approval, duration and analytics fit", () => {
  const report = buildNextPublishCandidatesReport(
    [
      baseStory({
        id: "generic",
        title: "Industry insider says a game could maybe be changing soon",
        approved: true,
        auto_approved: false,
        duration_seconds: 64,
        breaking_score: 95,
        full_script: "An insider says the industry could change soon.",
      }),
      baseStory({
        id: "specific_auto",
        title: "Reggie says Amazon tried to strong-arm Nintendo on console pricing",
        approved: true,
        auto_approved: true,
        duration_seconds: 68,
        breaking_score: 70,
        full_script:
          "Reggie Fils-Aime says Amazon tried to pressure Nintendo into a pricing deal and Nintendo walked away.",
      }),
      baseStory({
        id: "approved_specific",
        title: "eBay rejects GameStop takeover bid as not credible",
        approved: true,
        auto_approved: false,
        duration_seconds: 72,
        breaking_score: 80,
        full_script: "eBay rejected GameStop's takeover bid after the board called it not credible.",
      }),
    ],
    { analyticsText, generatedAt: "2026-05-15T09:00:00.000Z" },
  );

  assert.equal(report.candidates[0].id, "specific_auto");
  assert.equal(report.candidates[0].status, "publish_ready");
  assert.ok(report.candidates[0].score > report.candidates[1].score);
  assert.ok(report.candidates[0].reasons.includes("auto_approved"));
});

test("next publish report excludes rows with existing public platform ids and QA failures", () => {
  const report = buildNextPublishCandidatesReport(
    [
      baseStory({ id: "already_youtube", youtube_post_id: "yt_live_123" }),
      baseStory({
        id: "qa_failed",
        qa_failed: true,
        qa_failures: ["audio_duration_too_long (125.83s, max 74.00s)"],
      }),
      baseStory({ id: "clean", title: "Nintendo confirms Switch 2 bundle outcome" }),
    ],
    { analyticsText, generatedAt: "2026-05-15T09:00:00.000Z" },
  );

  assert.deepEqual(
    report.excluded.map((row) => row.id).sort(),
    ["already_youtube", "qa_failed"],
  );
  assert.deepEqual(report.candidates.map((row) => row.id), ["clean"]);
});

test("analytics specificity scoring rewards named corporate outcomes and penalises vague speculation", () => {
  const specific = scoreAnalyticsFit(baseStory({
    title: "GameStop takeover bid rejected by eBay board as not credible",
    full_script: "GameStop made a takeover bid and eBay's board rejected it as not credible.",
  }), analyticsText);
  const vague = scoreAnalyticsFit(baseStory({
    title: "A gaming insider says things could maybe shift soon",
    full_script: "An insider says the industry could maybe shift soon if rumours are true.",
  }), analyticsText);

  assert.ok(specific.score > vague.score);
  assert.ok(specific.reasons.includes("corporate_drama"));
  assert.ok(specific.reasons.includes("concrete_outcome"));
  assert.ok(vague.penalties.includes("speculative_language"));
});

test("next publish report JSON and Markdown are valid operator artefacts", () => {
  const report = buildNextPublishCandidatesReport(
    [baseStory({ id: "json_candidate" })],
    { analyticsText, generatedAt: "2026-05-15T09:00:00.000Z" },
  );
  const parsed = JSON.parse(JSON.stringify(report));
  const markdown = formatNextPublishCandidatesMarkdown(report);

  assert.equal(parsed.candidates[0].id, "json_candidate");
  assert.match(parsed.analytics_summary.latest_recommendation, /corporate drama/);
  assert.match(markdown, /# Next Publish Candidates/);
  assert.match(markdown, /json_candidate/);
  assert.match(markdown, /read-only/);
});
