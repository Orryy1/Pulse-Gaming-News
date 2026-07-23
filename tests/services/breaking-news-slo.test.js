"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("fs-extra");

const {
  buildBreakingNewsSloReport,
  writeBreakingNewsSloReport,
} = require("../../lib/breaking-news-slo");

test("breaking-news SLO records stage latency and emits an incident after a candidate miss", async () => {
  const report = buildBreakingNewsSloReport({
    storyId: "rss_xbox_pc_bc",
    announcementAt: "2026-07-22T14:55:00.000Z",
    nextFeedPollAt: "2026-07-22T17:00:00.000Z",
    detectedAt: "2026-07-22T15:41:37.000Z",
    editorialDecisionAt: "2026-07-22T15:42:00.000Z",
    generatedAt: "2026-07-22T19:57:00.000Z",
    dispatchGatesPermit: false,
    rootCauses: {
      scheduler_authority: [
        "first_party_source_underweighted",
        "rigid_flash_lane_word_budget",
      ],
      dispatch_opportunity: ["rights_and_human_review_not_green"],
    },
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.stages.detection.status, "pass");
  assert.equal(report.stages.editorial_decision.status, "pass");
  assert.equal(report.stages.scheduler_authority.status, "missed");
  assert.equal(report.stages.scheduler_authority.elapsed_minutes, 255.38);
  assert.equal(report.stages.dispatch_opportunity.status, "blocked_by_gate");
  assert.deepEqual(report.incident.missed_stages, ["scheduler_authority"]);

  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-breaking-slo-"));
  const written = await writeBreakingNewsSloReport(report, { outputDir });
  assert.equal(await fs.pathExists(written.reportPath), true);
  assert.equal(await fs.pathExists(written.markdownPath), true);
  assert.equal(await fs.pathExists(written.incidentPath), true);
  const incident = await fs.readJson(written.incidentPath);
  assert.deepEqual(incident.missed_stages, ["scheduler_authority"]);
});

test("breaking-news SLO passes without an incident when all permitted stages meet target", async () => {
  const report = buildBreakingNewsSloReport({
    storyId: "rss_fast_story",
    announcementAt: "2026-07-22T14:55:00.000Z",
    nextFeedPollAt: "2026-07-22T15:00:00.000Z",
    detectedAt: "2026-07-22T14:59:00.000Z",
    editorialDecisionAt: "2026-07-22T15:12:00.000Z",
    schedulerCandidateAt: "2026-07-22T16:10:00.000Z",
    safeDispatchOpportunityAt: "2026-07-22T18:00:00.000Z",
    generatedAt: "2026-07-22T18:01:00.000Z",
    dispatchGatesPermit: true,
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.stages.scheduler_authority.latency_minutes, 71);
  assert.equal(report.stages.dispatch_opportunity.status, "pass");
  assert.equal(report.incident, null);

  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-breaking-slo-pass-"));
  const written = await writeBreakingNewsSloReport(report, { outputDir });
  assert.equal(written.incidentPath, null);
});
