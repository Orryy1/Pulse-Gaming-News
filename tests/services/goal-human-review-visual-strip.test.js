"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildHumanReviewVisualStripPlan,
  extractHumanReviewVisualStrips,
  renderHumanReviewVisualStripHtml,
  writeHumanReviewVisualStripReport,
} = require("../../lib/goal-human-review-visual-strip");

const ROOT = path.resolve(__dirname, "..", "..");

async function createConsoleBundle(root, { missingVideo = false } = {}) {
  const storyDir = path.join(root, "story-one");
  await fs.ensureDir(storyDir);
  const videoPath = path.join(storyDir, "visual_v4_render.mp4");
  const captionsPath = path.join(storyDir, "captions.srt");
  if (!missingVideo) await fs.writeFile(videoPath, "fixture mp4 bytes");
  await fs.writeFile(captionsPath, "1\n00:00:00,000 --> 00:00:01,000\nHades two just changed the launch fight.\n");
  return {
    schema_version: 1,
    generated_at: "2026-05-31T22:05:00.000Z",
    mode: "HUMAN_REVIEW_CONSOLE",
    verdict: "AMBER",
    safe_to_publish_boolean: false,
    summary: {
      card_count: 1,
      ready_card_count: missingVideo ? 0 : 1,
      actionable_card_count: missingVideo ? 0 : 1,
      missing_artefact_card_count: missingVideo ? 1 : 0,
      blocked_input_count: 0,
    },
    cards: [
      {
        review_sequence: 1,
        story_id: "story-one",
        title: "Hades 2 Needs A Better Hook",
        review_status: missingVideo ? "missing_review_artefacts" : "ready_for_operator_review",
        first_spoken_line: "Hades two just changed the launch fight.",
        thumbnail_headline: "HADES LAUNCH FIGHT",
        video_path: videoPath,
        video_uri: `file:///${videoPath.replace(/\\/g, "/")}`,
        captions_path: captionsPath,
        actionable: !missingVideo,
        blockers: missingVideo ? ["missing_video_path"] : [],
      },
    ],
    blockers: [],
    next_step: "watch_console_cards_then_record_operator_decisions",
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      approval_omitted_from_console: true,
    },
  };
}

test("visual strip plan creates four first-3s frame targets per actionable review card", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-review-strip-plan-"));
  const consoleBundle = await createConsoleBundle(dir);
  consoleBundle.source_operator_index_dry_run_generated_at = "2026-05-31T22:00:00.000Z";
  consoleBundle.source_strict_dry_run_generated_at = "2026-05-31T22:00:00.000Z";
  const report = buildHumanReviewVisualStripPlan({
    consoleBundle,
    outputDir: path.join(dir, "out"),
    generatedAt: "2026-05-31T22:06:00.000Z",
  });

  assert.equal(report.mode, "HUMAN_REVIEW_VISUAL_STRIP");
  assert.equal(report.source_console_generated_at, "2026-05-31T22:05:00.000Z");
  assert.equal(report.source_console_dry_run_generated_at, "2026-05-31T22:00:00.000Z");
  assert.equal(report.source_strict_dry_run_generated_at, "2026-05-31T22:00:00.000Z");
  assert.equal(report.safe_to_publish_boolean, false);
  assert.equal(report.summary.card_count, 1);
  assert.equal(report.summary.extractable_card_count, 1);
  assert.equal(report.summary.frame_target_count, 4);
  assert.equal(report.safety.no_network_uploads, true);
  assert.equal(report.safety.no_db_mutation, true);
  assert.equal(report.safety.approval_omitted_from_visual_strip, true);

  const card = report.cards[0];
  assert.equal(card.story_id, "story-one");
  assert.equal(card.status, "ready_for_frame_extraction");
  assert.deepEqual(card.frame_targets.map((frame) => frame.timestamp_seconds), [0, 1, 2, 3]);
  assert.ok(card.frame_targets.every((frame) => frame.output_path.includes("human-review-visual-strips")));
});

test("visual strip plan blocks unsafe or stale console inputs before frame extraction", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-review-strip-console-red-"));
  const consoleBundle = await createConsoleBundle(dir);
  consoleBundle.verdict = "RED";
  consoleBundle.blockers = ["human_review_console_source_stale_after_strict_dry_run"];

  const report = buildHumanReviewVisualStripPlan({
    consoleBundle,
    outputDir: path.join(dir, "out"),
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.card_count, 0);
  assert.ok(report.blockers.includes("human_review_console_input_blocked"));
  assert.equal(report.next_step, "repair_human_review_console_inputs");
});

test("visual strip plan blocks missing videos instead of marking review evidence usable", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-review-strip-missing-"));
  const consoleBundle = await createConsoleBundle(dir, { missingVideo: true });
  const report = buildHumanReviewVisualStripPlan({
    consoleBundle,
    outputDir: path.join(dir, "out"),
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.summary.extractable_card_count, 0);
  assert.equal(report.summary.blocked_card_count, 1);
  assert.equal(report.cards[0].status, "blocked");
  assert.ok(report.cards[0].blockers.includes("video_file_missing"));
});

test("visual strip extraction uses hidden ffmpeg execFile calls and records extracted frames", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-review-strip-extract-"));
  const consoleBundle = await createConsoleBundle(dir);
  const plan = buildHumanReviewVisualStripPlan({
    consoleBundle,
    outputDir: path.join(dir, "out"),
  });
  const calls = [];
  const report = await extractHumanReviewVisualStrips(plan, {
    ffmpegPath: "ffmpeg",
    execFileImpl(file, args, opts, cb) {
      calls.push({ file, args, opts });
      const output = args[args.length - 1];
      fs.ensureDirSync(path.dirname(output));
      fs.writeFileSync(output, "jpeg bytes");
      cb(null, "", "");
    },
  });

  assert.equal(calls.length, 4);
  assert.ok(calls.every((call) => call.file === "ffmpeg"));
  assert.ok(calls.every((call) => call.opts.windowsHide === true));
  assert.ok(calls.every((call) => call.opts.shell !== true));
  assert.ok(calls.every((call) => call.args.includes("-frames:v")));
  assert.equal(report.summary.extracted_frame_count, 4);
  assert.equal(report.cards[0].status, "frames_extracted");
  assert.ok(report.cards[0].frame_targets.every((frame) => frame.exists === true));
});

test("visual strip HTML is local-only and contains no approval or publish surface", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-review-strip-html-"));
  const consoleBundle = await createConsoleBundle(dir);
  const report = buildHumanReviewVisualStripPlan({
    consoleBundle,
    outputDir: path.join(dir, "out"),
  });
  const html = renderHumanReviewVisualStripHtml(report);

  assert.match(html, /First-three-second visual strips/);
  assert.match(html, /Hades 2 Needs A Better Hook/);
  assert.match(html, /This page cannot approve or publish/);
  assert.match(html, /<img loading="lazy"/);
  assert.doesNotMatch(html, /--apply/);
  assert.doesNotMatch(html, /<form/i);
  assert.doesNotMatch(html, /fetch\(/i);
});

test("visual strip writer and CLI emit local proof artefacts", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-review-strip-cli-"));
  const consoleBundle = await createConsoleBundle(dir);
  const consolePath = path.join(dir, "human_review_console.json");
  const outDir = path.join(dir, "out");
  await fs.writeJson(consolePath, consoleBundle, { spaces: 2 });

  const plan = buildHumanReviewVisualStripPlan({ consoleBundle, outputDir: outDir });
  const written = await writeHumanReviewVisualStripReport(plan, { outputDir: outDir });
  assert.equal(await fs.pathExists(written.jsonPath), true);
  assert.equal(await fs.pathExists(written.htmlPath), true);

  const result = spawnSync(
    process.execPath,
    [
      "tools/goal-human-review-visual-strip.js",
      "--console",
      consolePath,
      "--out-dir",
      outDir,
      "--plan-only",
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
  assert.equal(parsed.summary.frame_target_count, 4);
  assert.equal(await fs.pathExists(path.join(outDir, "human_review_visual_strip_report.html")), true);

  const pkg = await fs.readJson(path.join(ROOT, "package.json"));
  assert.equal(pkg.scripts["ops:goal-human-review-visual-strip"], "node tools/goal-human-review-visual-strip.js");
});
