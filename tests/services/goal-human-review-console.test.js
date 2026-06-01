"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildHumanReviewConsole,
  renderHumanReviewConsoleHtml,
  writeHumanReviewConsole,
} = require("../../lib/goal-human-review-console");

const ROOT = path.resolve(__dirname, "..", "..");

async function createReviewFiles(root, storyId = "story-one") {
  const dir = path.join(root, storyId);
  await fs.ensureDir(dir);
  const files = {
    video: path.join(dir, "visual_v4_render.mp4"),
    captions: path.join(dir, "captions.srt"),
    canonical: path.join(dir, "canonical_story_manifest.json"),
    platform: path.join(dir, "platform_publish_manifest.json"),
  };
  await fs.writeFile(files.video, "fixture mp4 bytes");
  await fs.writeFile(
    files.captions,
    [
      "1",
      "00:00:00,000 --> 00:00:01,400",
      "Forza Horizon 6 just made Xbox's Steam plan harder to ignore.",
      "",
      "2",
      "00:00:01,400 --> 00:00:03,000",
      "That is the whole fight in one line.",
      "",
    ].join("\n"),
  );
  await fs.writeJson(files.canonical, { story_id: storyId }, { spaces: 2 });
  await fs.writeJson(files.platform, { story_id: storyId }, { spaces: 2 });
  return files;
}

function operatorIndex(files) {
  return {
    schema_version: 1,
    generated_at: "2026-05-31T21:40:00.000Z",
    mode: "HUMAN_REVIEW_OPERATOR_INDEX",
    verdict: "AMBER",
    safe_to_publish_boolean: false,
    summary: {
      review_card_count: 1,
      pending_review_count: 1,
      ready_for_operator_review_count: 1,
      missing_artefact_card_count: 0,
      already_decided_count: 0,
      blocked_input_count: 0,
    },
    review_cards: [
      {
        review_sequence: 1,
        packet_id: "story-one:human_review",
        story_id: "story-one",
        title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
        decision_status: "pending_operator_decision",
        review_status: "ready_for_operator_review",
        recommended_next_decision: "operator_watch_then_decide",
        public_copy: {
          title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
          thumbnail_headline: "FORZA STEAM BET",
          first_spoken_line: "Forza Horizon 6 just made Xbox's Steam plan harder to ignore.",
          script_excerpt: "Forza Horizon 6 just made Xbox's Steam plan harder to ignore.",
          description: "Forza Horizon 6 is launching on Steam. Source: Xbox.",
        },
        source_check_summary: {
          primary_source: "Xbox",
          discovery_source: "Reddit",
          primary_must_match_public_source_label: true,
        },
        open_targets: {
          video_path: {
            key: "video_path",
            path: files.video,
            exists: true,
            sha256: "sha256:video",
            size_bytes: 17,
            required_for_review: true,
          },
          first_frame_source: {
            key: "first_frame_source",
            path: files.video,
            exists: true,
            sha256: "sha256:video",
            size_bytes: 17,
            required_for_review: true,
          },
          captions_path: {
            key: "captions_path",
            path: files.captions,
            exists: true,
            sha256: "sha256:captions",
            size_bytes: 150,
            required_for_review: true,
          },
          canonical_manifest_path: {
            key: "canonical_manifest_path",
            path: files.canonical,
            exists: true,
            sha256: "sha256:canonical",
            size_bytes: 20,
            required_for_review: true,
          },
          platform_publish_manifest_path: {
            key: "platform_publish_manifest_path",
            path: files.platform,
            exists: true,
            sha256: "sha256:platform",
            size_bytes: 20,
            required_for_review: true,
          },
        },
        platform_plan: {
          enabled_for_review: ["youtube_shorts", "instagram_reels", "facebook_reels"],
          deferred_or_disabled: ["tiktok", "x", "threads", "pinterest"],
          disabled_platforms_must_remain_deferred: true,
        },
        operator_checklist: [
          "watch_first_three_seconds",
          "verify_title_thumbnail_opening_source_parity",
          "verify_enabled_platforms_only",
          "confirm_no_disabled_platform_counted_ready",
          "record_approve_or_reject_decision",
        ],
        decision_commands: {
          approve_enabled_platforms_dry_run:
            "npm run ops:goal-record-operator-decision -- --story story-one --decision approve_enabled_platforms --json",
          reject_dry_run:
            "npm run ops:goal-record-operator-decision -- --story story-one --decision reject --json",
          request_repairs_dry_run:
            "npm run ops:goal-record-operator-decision -- --story story-one --decision request_repairs --json",
          apply_template_after_review_only:
            "npm run ops:goal-record-operator-decision -- --story story-one --decision approve_enabled_platforms --json --apply",
        },
        blockers: [],
        approval_guard: {
          live_publish_allowed_from_index: false,
          dispatch_still_requires_approval_gate: true,
          operator_decision_required: true,
          no_disabled_platform_approval: true,
        },
      },
    ],
    blockers: [],
    next_step: "watch_review_cards_and_record_operator_decisions",
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

test("human review console turns review cards into a local-only watch bundle", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-console-"));
  const files = await createReviewFiles(dir);
  const consoleBundle = buildHumanReviewConsole({
    operatorIndex: operatorIndex(files),
    generatedAt: "2026-05-31T21:45:00.000Z",
  });

  assert.equal(consoleBundle.mode, "HUMAN_REVIEW_CONSOLE");
  assert.equal(consoleBundle.verdict, "AMBER");
  assert.equal(consoleBundle.safe_to_publish_boolean, false);
  assert.equal(consoleBundle.summary.ready_card_count, 1);
  assert.equal(consoleBundle.summary.actionable_card_count, 1);
  assert.equal(consoleBundle.safety.no_network_uploads, true);
  assert.equal(consoleBundle.safety.no_db_mutation, true);

  const card = consoleBundle.cards[0];
  assert.equal(card.story_id, "story-one");
  assert.match(card.video_uri, /^file:\/\/\//);
  assert.match(card.captions_preview, /Forza Horizon 6/);
  assert.equal(card.review_actions.approve_dry_run.includes("--apply"), false);
  assert.equal(card.review_actions.apply_command_omitted_from_console, true);
  assert.deepEqual(card.disabled_or_deferred_platforms, ["tiktok", "x", "threads", "pinterest"]);
  assert.equal(card.review_guard.can_approve_from_console, false);
});

test("human review console blocks stale operator index after a newer strict dry-run", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-console-stale-"));
  const files = await createReviewFiles(dir);
  const index = operatorIndex(files);
  index.generated_at = "2026-06-01T00:28:48.838Z";
  index.source_dry_run_generated_at = "2026-06-01T00:28:37.938Z";

  const consoleBundle = buildHumanReviewConsole({
    operatorIndex: index,
    strictDryRunPlan: {
      generated_at: "2026-06-01T01:03:55.657Z",
      mode: "DRY_RUN_PUBLISH",
    },
    generatedAt: "2026-06-01T01:04:16.455Z",
  });

  assert.equal(consoleBundle.verdict, "RED");
  assert.equal(consoleBundle.summary.actionable_card_count, 0);
  assert.ok(consoleBundle.blockers.includes("human_review_console_source_stale_after_strict_dry_run"));
  assert.equal(consoleBundle.next_step, "regenerate_human_review_queue_index_and_console");
});

test("human review console refuses unsafe operator index contracts", () => {
  const index = operatorIndex({ video: "", captions: "", canonical: "", platform: "" });
  index.safe_to_publish_boolean = true;
  const consoleBundle = buildHumanReviewConsole({ operatorIndex: index });

  assert.equal(consoleBundle.verdict, "RED");
  assert.equal(consoleBundle.summary.actionable_card_count, 0);
  assert.ok(consoleBundle.blockers.includes("human_review_console_safety_contract_failed"));
});

test("human review console HTML is watch-only and contains no apply path", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-console-html-"));
  const files = await createReviewFiles(dir);
  const consoleBundle = buildHumanReviewConsole({ operatorIndex: operatorIndex(files) });
  const html = renderHumanReviewConsoleHtml(consoleBundle);

  assert.match(html, /<video controls preload="metadata"/);
  assert.match(html, /Forza Horizon 6 Exposes Xbox&#39;s Steam Bet/);
  assert.match(html, /Review cannot approve or publish/);
  assert.doesNotMatch(html, /--apply/);
  assert.doesNotMatch(html, /<form/i);
  assert.doesNotMatch(html, /fetch\(/i);
});

test("human review console writes JSON and HTML artefacts", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-console-write-"));
  const files = await createReviewFiles(dir);
  const consoleBundle = buildHumanReviewConsole({ operatorIndex: operatorIndex(files) });
  const written = await writeHumanReviewConsole(consoleBundle, { outputDir: dir });

  assert.equal(await fs.pathExists(written.jsonPath), true);
  assert.equal(await fs.pathExists(written.htmlPath), true);
  assert.equal(path.basename(written.jsonPath), "human_review_console.json");
  assert.equal(path.basename(written.htmlPath), "human_review_console.html");
});

test("human review console CLI is registered and emits JSON", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-console-cli-"));
  const files = await createReviewFiles(dir);
  const indexPath = path.join(dir, "human_review_operator_index.json");
  const outDir = path.join(dir, "out");
  await fs.writeJson(indexPath, operatorIndex(files), { spaces: 2 });

  const result = spawnSync(
    process.execPath,
    [
      "tools/goal-human-review-console.js",
      "--operator-index",
      indexPath,
      "--out-dir",
      outDir,
      "--no-strict-dry-run-plan",
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
  assert.equal(parsed.summary.actionable_card_count, 1);
  assert.equal(await fs.pathExists(path.join(outDir, "human_review_console.html")), true);

  const pkg = await fs.readJson(path.join(ROOT, "package.json"));
  assert.equal(pkg.scripts["ops:goal-human-review-console"], "node tools/goal-human-review-console.js");
});
