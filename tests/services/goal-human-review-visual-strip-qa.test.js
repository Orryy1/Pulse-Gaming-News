"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const test = require("node:test");

const {
  buildHumanReviewVisualStripQaReport,
  renderHumanReviewVisualStripQaHtml,
  writeHumanReviewVisualStripQaReport,
} = require("../../lib/goal-human-review-visual-strip-qa");

const ROOT = path.resolve(__dirname, "..", "..");

function visualStripReport({ framePath, exists = true } = {}) {
  return {
    schema_version: 1,
    generated_at: "2026-05-31T23:00:00.000Z",
    mode: "HUMAN_REVIEW_VISUAL_STRIP",
    verdict: "AMBER",
    safe_to_publish_boolean: false,
    summary: {
      card_count: 1,
      extracted_card_count: exists ? 1 : 0,
      failed_card_count: exists ? 0 : 1,
      extracted_frame_count: exists ? 4 : 0,
    },
    cards: [
      {
        review_sequence: 1,
        story_id: "story-one",
        title: "Hades 2 Needs A Better Opening",
        status: exists ? "frames_extracted" : "frame_extraction_failed",
        first_spoken_line: "Hades two just changed the launch fight.",
        thumbnail_headline: "HADES LAUNCH FIGHT THAT WILL DEFINITELY CLIP",
        frame_targets: [0, 1, 2, 3].map((timestamp) => ({
          timestamp_seconds: timestamp,
          output_path: framePath || path.join(ROOT, "missing.jpg"),
          output_uri: "file:///missing.jpg",
          exists,
          status: exists ? "extracted" : "failed",
        })),
        blockers: exists ? [] : ["frame_extraction_failed"],
      },
    ],
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      approval_omitted_from_visual_strip: true,
    },
  };
}

test("visual strip QA flags weak first frame and possible edge text cutoff", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-strip-qa-risk-"));
  const framePath = path.join(dir, "frame.jpg");
  await fs.writeFile(framePath, "fake image bytes");
  const report = await buildHumanReviewVisualStripQaReport({
    visualStripReport: visualStripReport({ framePath }),
    generatedAt: "2026-05-31T23:01:00.000Z",
    analyseFrame: async (_file, frame) => ({
      width: 360,
      height: 640,
      prescan: frame.timestamp_seconds === 0
        ? {
            edge_density: 0.02,
            dark_pixel_ratio: 0.82,
            bright_pixel_ratio: 0.01,
            text_overlay_likelihood: 0.03,
            white_text_on_dark_likelihood: 0.1,
          }
        : {
            edge_density: 0.22,
            dark_pixel_ratio: 0.2,
            bright_pixel_ratio: 0.08,
            text_overlay_likelihood: 0.08,
            white_text_on_dark_likelihood: 0.12,
          },
      border: frame.timestamp_seconds === 1
        ? {
            text_cutoff_risk_score: 0.61,
            edge_touch_ratio: 0.24,
            bright_edge_ratio: 0.09,
          }
        : {
            text_cutoff_risk_score: 0.02,
            edge_touch_ratio: 0.01,
            bright_edge_ratio: 0.01,
          },
    }),
  });

  assert.equal(report.mode, "HUMAN_REVIEW_VISUAL_STRIP_QA");
  assert.equal(report.safe_to_publish_boolean, false);
  assert.equal(report.verdict, "AMBER");
  assert.equal(report.summary.risk_card_count, 1);
  assert.equal(report.summary.frame_warning_count >= 2, true);
  assert.equal(report.safety.no_network_uploads, true);

  const card = report.cards[0];
  assert.equal(card.verdict, "AMBER");
  assert.ok(card.risk_reasons.includes("weak_first_frame_low_detail_or_too_dark"));
  assert.ok(card.risk_reasons.includes("possible_edge_text_cutoff"));
  assert.ok(card.risk_reasons.includes("thumbnail_headline_mobile_readability_risk"));
  assert.ok(card.repair_recommendations.includes("open_full_video_before_any_approval"));
});

test("visual strip QA hard-blocks missing frame evidence without pretending review is complete", async () => {
  const report = await buildHumanReviewVisualStripQaReport({
    visualStripReport: visualStripReport({ exists: false }),
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.blocked_card_count, 1);
  assert.equal(report.cards[0].verdict, "RED");
  assert.ok(report.cards[0].risk_reasons.includes("missing_visual_strip_frame"));
});

test("visual strip QA HTML is local-only and exposes no approval surface", async () => {
  const report = await buildHumanReviewVisualStripQaReport({
    visualStripReport: visualStripReport({ exists: false }),
  });
  const html = renderHumanReviewVisualStripQaHtml(report);

  assert.match(html, /Visual strip QA/);
  assert.match(html, /This report cannot approve or publish/);
  assert.match(html, /missing_visual_strip_frame/);
  assert.doesNotMatch(html, /--apply/);
  assert.doesNotMatch(html, /<form/i);
  assert.doesNotMatch(html, /fetch\(/i);
});

test("visual strip QA writer and CLI emit local proof artefacts", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-strip-qa-cli-"));
  const framePath = path.join(dir, "frame.jpg");
  await sharp({
    create: {
      width: 180,
      height: 320,
      channels: 3,
      background: { r: 22, g: 28, b: 36 },
    },
  }).jpeg().toFile(framePath);

  const stripPath = path.join(dir, "human_review_visual_strip_report.json");
  const outDir = path.join(dir, "out");
  await fs.writeJson(stripPath, visualStripReport({ framePath }), { spaces: 2 });
  const report = await buildHumanReviewVisualStripQaReport({
    visualStripReport: await fs.readJson(stripPath),
  });
  const written = await writeHumanReviewVisualStripQaReport(report, { outputDir: outDir });

  assert.equal(await fs.pathExists(written.jsonPath), true);
  assert.equal(await fs.pathExists(written.htmlPath), true);

  const result = spawnSync(
    process.execPath,
    [
      "tools/goal-human-review-visual-strip-qa.js",
      "--visual-strip",
      stripPath,
      "--out-dir",
      outDir,
      "--json",
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, PULSE_SKIP_DOTENV: "1" },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.safe_to_publish_boolean, false);
  assert.equal(await fs.pathExists(path.join(outDir, "human_review_visual_strip_qa_report.html")), true);

  const pkg = await fs.readJson(path.join(ROOT, "package.json"));
  assert.equal(pkg.scripts["ops:goal-human-review-visual-strip-qa"], "node tools/goal-human-review-visual-strip-qa.js");
});
