"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildHumanReviewOperatorIndex,
  renderHumanReviewOperatorIndexMarkdown,
  writeHumanReviewOperatorIndex,
} = require("../../lib/goal-human-review-operator-index");

const ROOT = path.resolve(__dirname, "..", "..");

function slot(overrides = {}) {
  return {
    packet_id: "story-one:human_review",
    story_id: "story-one",
    title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
    decision_status: "pending_operator_decision",
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
    review_artefact_paths: {
      video_path: "C:\\proof\\story-one\\visual_v4_render.mp4",
      first_frame_source: "C:\\proof\\story-one\\visual_v4_render.mp4",
      captions_path: "C:\\proof\\story-one\\captions.srt",
      canonical_manifest_path: "C:\\proof\\story-one\\canonical_story_manifest.json",
      platform_publish_manifest_path: "C:\\proof\\story-one\\platform_publish_manifest.json",
    },
    operator_decision_recorder_commands: {
      approve_enabled_platforms_dry_run:
        "npm run ops:goal-record-operator-decision -- --story story-one --decision approve_enabled_platforms --json",
      approve_enabled_platforms_apply_template:
        "npm run ops:goal-record-operator-decision -- --story story-one --decision approve_enabled_platforms --json --apply",
      reject_dry_run:
        "npm run ops:goal-record-operator-decision -- --story story-one --decision reject --json",
      request_repairs_dry_run:
        "npm run ops:goal-record-operator-decision -- --story story-one --decision request_repairs --json",
    },
    allowed_approval_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    non_approvable_platforms: ["tiktok", "x"],
    required_operator_checks: [
      "watch_first_three_seconds",
      "verify_title_thumbnail_opening_source_parity",
      "verify_enabled_platforms_only",
      "confirm_no_disabled_platform_counted_ready",
      "record_approve_or_reject_decision",
    ],
    approval_gate: {
      operator_must_choose_decision: true,
      live_publish_allowed_from_sheet: false,
      guarded_dispatch_still_requires_approval_gate: true,
      disabled_platforms_must_remain_deferred: true,
    },
    ...overrides,
  };
}

function decisionSheet(slots = [slot()]) {
  return {
    schema_version: 1,
    generated_at: "2026-05-31T18:40:00.000Z",
    source_dry_run_generated_at: "2026-05-31T18:20:00.000Z",
    source_review_packet_manifest_generated_at: "2026-05-31T18:30:00.000Z",
    mode: "HUMAN_REVIEW_DECISION_SHEET",
    verdict: "AMBER",
    safe_to_publish_boolean: false,
    summary: {
      decision_slot_count: slots.length,
      pending_decision_count: slots.filter((item) => item.decision_status === "pending_operator_decision").length,
      already_decided_count: slots.filter((item) => item.decision_status === "already_decided").length,
      blocked_input_count: 0,
    },
    decision_slots: slots,
    blockers: [],
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function reviewPacketManifest(packets = [{
  packet_id: "story-one:human_review",
  story_id: "story-one",
  title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
  enabled_review_platforms: ["youtube_shorts", "facebook_reels"],
  deferred_platforms: ["tiktok", "x"],
  blocked_platforms: ["instagram_reels"],
}]) {
  return {
    schema_version: 1,
    generated_at: "2026-05-31T19:01:00.000Z",
    mode: "HUMAN_REVIEW",
    review_packets: packets,
    blocked_packets: [],
    safety: {
      no_live_publish_from_manifest: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function fingerprint(filePath) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

async function createProofFiles(root, storyId = "story-one") {
  const dir = path.join(root, "proof", storyId);
  await fs.ensureDir(dir);
  const files = {
    video_path: path.join(dir, "visual_v4_render.mp4"),
    first_frame_source: path.join(dir, "visual_v4_render.mp4"),
    captions_path: path.join(dir, "captions.srt"),
    canonical_manifest_path: path.join(dir, "canonical_story_manifest.json"),
    platform_publish_manifest_path: path.join(dir, "platform_publish_manifest.json"),
  };
  await fs.writeFile(files.video_path, "not a real mp4 fixture");
  await fs.writeFile(files.captions_path, "1\n00:00:00,000 --> 00:00:01,000\nForza\n");
  await fs.writeJson(files.canonical_manifest_path, { story_id: storyId }, { spaces: 2 });
  await fs.writeJson(files.platform_publish_manifest_path, { story_id: storyId }, { spaces: 2 });
  return files;
}

test("operator index turns pending decisions into non-publishing review cards", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-index-"));
  const proof = await createProofFiles(dir);
  const index = buildHumanReviewOperatorIndex({
    decisionSheet: decisionSheet([slot({ review_artefact_paths: proof })]),
    generatedAt: "2026-05-31T19:00:00.000Z",
  });

  assert.equal(index.mode, "HUMAN_REVIEW_OPERATOR_INDEX");
  assert.equal(index.verdict, "AMBER");
  assert.equal(index.source_dry_run_generated_at, "2026-05-31T18:20:00.000Z");
  assert.equal(index.source_decision_sheet_generated_at, "2026-05-31T18:40:00.000Z");
  assert.equal(index.source_review_packet_manifest_generated_at, "2026-05-31T18:30:00.000Z");
  assert.equal(index.safe_to_publish_boolean, false);
  assert.equal(index.summary.pending_review_count, 1);
  assert.equal(index.summary.ready_for_operator_review_count, 1);
  assert.equal(index.summary.missing_artefact_card_count, 0);
  assert.equal(index.safety.no_network_uploads, true);

  const card = index.review_cards[0];
  assert.equal(card.story_id, "story-one");
  assert.equal(card.review_status, "ready_for_operator_review");
  assert.equal(card.recommended_next_decision, "operator_watch_then_decide");
  assert.equal(card.open_targets.video_path.path, proof.video_path);
  assert.equal(card.open_targets.video_path.exists, true);
  assert.equal(card.open_targets.video_path.sha256, fingerprint(proof.video_path));
  assert.ok(card.open_targets.video_path.size_bytes > 0);
  assert.equal(card.platform_plan.enabled_for_review.join(","), "youtube_shorts,instagram_reels,facebook_reels");
  assert.equal(card.platform_plan.deferred_or_disabled.join(","), "tiktok,x");
  assert.match(card.decision_commands.approve_enabled_platforms_dry_run, /ops:goal-record-operator-decision/);
  assert.doesNotMatch(card.decision_commands.approve_enabled_platforms_dry_run, /--apply/);
  assert.equal(card.approval_guard.live_publish_allowed_from_index, false);
  assert.equal(card.approval_guard.dispatch_still_requires_approval_gate, true);
});

test("operator index routes missing review artefacts to repair instead of approval", () => {
  const index = buildHumanReviewOperatorIndex({
    decisionSheet: decisionSheet(),
  });

  assert.equal(index.verdict, "AMBER");
  assert.equal(index.summary.ready_for_operator_review_count, 0);
  assert.equal(index.summary.missing_artefact_card_count, 1);

  const card = index.review_cards[0];
  assert.equal(card.review_status, "missing_review_artefacts");
  assert.equal(card.recommended_next_decision, "request_repairs");
  assert.ok(card.blockers.includes("missing_review_artefact:video_path"));
  assert.match(card.decision_commands.request_repairs_dry_run, /request_repairs/);
});

test("operator index rejects stale decision-sheet platform approvals", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-index-stale-platforms-"));
  const proof = await createProofFiles(dir);
  const index = buildHumanReviewOperatorIndex({
    decisionSheet: decisionSheet([slot({ review_artefact_paths: proof })]),
    reviewPacketManifest: reviewPacketManifest(),
    generatedAt: "2026-05-31T19:03:00.000Z",
  });

  assert.equal(index.verdict, "RED");
  assert.equal(index.summary.review_card_count, 0);
  assert.equal(index.summary.blocked_input_count, 1);
  assert.ok(index.blockers.includes("decision_sheet_platforms_stale:story-one"));
  assert.equal(index.next_step, "repair_operator_index_inputs");
  assert.equal(index.safety.no_network_uploads, true);
});

test("operator index writes JSON and markdown contact-sheet artefacts", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-index-write-"));
  const proof = await createProofFiles(dir);
  const index = buildHumanReviewOperatorIndex({
    decisionSheet: decisionSheet([slot({ review_artefact_paths: proof })]),
  });

  const written = await writeHumanReviewOperatorIndex(index, { outputDir: dir });

  assert.equal(await fs.pathExists(path.join(dir, "human_review_operator_index.json")), true);
  assert.equal(await fs.pathExists(path.join(dir, "human_review_operator_index.md")), true);
  assert.equal(path.basename(written.markdownPath), "human_review_operator_index.md");

  const markdown = renderHumanReviewOperatorIndexMarkdown(index);
  assert.match(markdown, /Human Review Operator Index/);
  assert.match(markdown, /Forza Horizon 6 Exposes Xbox's Steam Bet/);
  assert.match(markdown, /Watch this first/);
  assert.match(markdown, /No uploads are triggered/);
  assert.match(markdown, /npm run ops:goal-record-operator-decision/);
});

test("operator index CLI is registered and writes clean JSON", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-index-cli-"));
  const proof = await createProofFiles(dir);
  const sheetPath = path.join(dir, "human_review_decision_sheet.json");
  const outDir = path.join(dir, "out");
  await fs.writeJson(sheetPath, decisionSheet([slot({ review_artefact_paths: proof })]), { spaces: 2 });

  const result = spawnSync(
    process.execPath,
    [
      "tools/goal-human-review-operator-index.js",
      "--decision-sheet",
      sheetPath,
      "--out-dir",
      outDir,
      "--json",
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.trimStart().startsWith("{"), result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.summary.review_card_count, 1);
  assert.equal(await fs.pathExists(path.join(outDir, "human_review_operator_index.json")), true);

  const pkg = await fs.readJson(path.join(ROOT, "package.json"));
  assert.equal(pkg.scripts["ops:goal-human-review-index"], "node tools/goal-human-review-operator-index.js");
});
