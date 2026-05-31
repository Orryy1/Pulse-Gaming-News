"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildHumanReviewDecisionSheet,
  renderHumanReviewDecisionSheetMarkdown,
  writeHumanReviewDecisionSheet,
} = require("../../lib/goal-human-review-decision-sheet");

const ROOT = path.resolve(__dirname, "..", "..");

async function proofArtefacts(root, storyId = "story-one") {
  const dir = path.join(root, storyId);
  await fs.ensureDir(dir);
  const artefacts = {
    video_path: path.join(dir, "visual_v4_render.mp4"),
    first_frame_source: path.join(dir, "visual_v4_render.mp4"),
    captions_path: path.join(dir, "captions.srt"),
    canonical_manifest_path: path.join(dir, "canonical_story_manifest.json"),
    platform_publish_manifest_path: path.join(dir, "platform_publish_manifest.json"),
  };
  await fs.writeFile(artefacts.video_path, "video-v1");
  await fs.writeFile(artefacts.captions_path, "caption-v1");
  await fs.writeJson(artefacts.canonical_manifest_path, { story_id: storyId }, { spaces: 2 });
  await fs.writeJson(artefacts.platform_publish_manifest_path, { story_id: storyId }, { spaces: 2 });
  return artefacts;
}

function fingerprint(filePath) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function packet(overrides = {}) {
  return {
    packet_id: "story-one:human_review",
    story_id: "story-one",
    title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
    verdict: "AMBER",
    enabled_review_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    deferred_platforms: ["tiktok", "x"],
    blocked_platforms: [],
    public_copy: {
      title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
      thumbnail_headline: "FORZA STEAM BET",
      first_spoken_line: "Forza Horizon 6 just made Xbox's Steam plan harder to ignore.",
      description: "Forza Horizon 6 is launching on Steam. Source: Xbox.",
    },
    source_list: {
      primary: { name: "Xbox", url: "https://www.xbox.com/en-US/games/forza-horizon-6" },
      discovery: { name: "Reddit", url: null },
      secondary: [],
    },
    artefacts: {
      video_path: "C:\\proof\\story-one\\visual_v4_render.mp4",
      first_frame_source: "C:\\proof\\story-one\\visual_v4_render.mp4",
      captions_path: "C:\\proof\\story-one\\captions.srt",
      canonical_manifest_path: "C:\\proof\\story-one\\canonical_story_manifest.json",
      platform_publish_manifest_path: "C:\\proof\\story-one\\platform_publish_manifest.json",
    },
    required_operator_checks: [
      "watch_first_three_seconds",
      "verify_title_thumbnail_opening_source_parity",
      "verify_enabled_platforms_only",
      "confirm_no_disabled_platform_counted_ready",
      "record_approve_or_reject_decision",
    ],
    ...overrides,
  };
}

function reviewPacketManifest(packets = [packet()]) {
  return {
    schema_version: 1,
    generated_at: "2026-05-31T18:30:00.000Z",
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

function operatorDecisionLog(decisions = []) {
  return {
    schema_version: 1,
    generated_at: "2026-05-31T18:30:00.000Z",
    mode: "HUMAN_REVIEW_DECISION_LOG",
    decisions,
    safety: {
      no_live_publish_from_log: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

test("decision sheet turns every pending review packet into a non-publishing decision slot", () => {
  const sheet = buildHumanReviewDecisionSheet({
    reviewPacketManifest: reviewPacketManifest(),
    operatorDecisionLog: operatorDecisionLog(),
    generatedAt: "2026-05-31T18:35:00.000Z",
  });

  assert.equal(sheet.mode, "HUMAN_REVIEW_DECISION_SHEET");
  assert.equal(sheet.verdict, "AMBER");
  assert.equal(sheet.safe_to_publish_boolean, false);
  assert.equal(sheet.summary.decision_slot_count, 1);
  assert.equal(sheet.summary.pending_decision_count, 1);
  assert.equal(sheet.summary.already_decided_count, 0);

  const slot = sheet.decision_slots[0];
  assert.equal(slot.story_id, "story-one");
  assert.deepEqual(slot.allowed_approval_platforms, ["youtube_shorts", "instagram_reels", "facebook_reels"]);
  assert.deepEqual(slot.non_approvable_platforms, ["tiktok", "x"]);
  assert.equal(slot.review_artefact_paths.video_path, "C:\\proof\\story-one\\visual_v4_render.mp4");
  assert.equal(slot.review_artefact_paths.captions_path, "C:\\proof\\story-one\\captions.srt");
  assert.match(
    slot.operator_decision_recorder_commands.approve_enabled_platforms_dry_run,
    /ops:goal-record-operator-decision/,
  );
  assert.match(
    slot.operator_decision_recorder_commands.approve_enabled_platforms_dry_run,
    /--story story-one/,
  );
  assert.match(
    slot.operator_decision_recorder_commands.approve_enabled_platforms_dry_run,
    /--approved-platforms youtube_shorts,instagram_reels,facebook_reels/,
  );
  assert.doesNotMatch(
    slot.operator_decision_recorder_commands.approve_enabled_platforms_dry_run,
    /--apply/,
  );
  assert.match(
    slot.operator_decision_recorder_commands.approve_enabled_platforms_apply_template,
    /--apply/,
  );
  assert.equal(slot.approve_enabled_platforms_template.approved_platforms.length, 3);
  assert.equal(slot.approval_gate.live_publish_allowed_from_sheet, false);
  assert.equal(slot.approval_gate.operator_must_choose_decision, true);
  assert.deepEqual(
    slot.required_reviewed_artefacts.map((artefact) => artefact.key),
    [
      "video_path",
      "first_frame_source",
      "captions_path",
      "canonical_manifest_path",
      "platform_publish_manifest_path",
    ],
  );
  assert.ok(slot.validation_rules.includes("Approvals may only include allowed_approval_platforms."));
  assert.ok(sheet.safety.no_network_uploads);
});

test("decision sheet includes exact artefact fingerprints in recorder commands when files exist", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-fingerprints-"));
  const artefacts = await proofArtefacts(dir);
  const sheet = buildHumanReviewDecisionSheet({
    reviewPacketManifest: reviewPacketManifest([packet({ artefacts })]),
    operatorDecisionLog: operatorDecisionLog(),
    generatedAt: "2026-05-31T18:35:00.000Z",
  });

  const slot = sheet.decision_slots[0];
  assert.equal(slot.required_reviewed_artefacts[0].fingerprint.sha256, fingerprint(artefacts.video_path));
  assert.match(
    slot.operator_decision_recorder_commands.approve_enabled_platforms_dry_run,
    /--reviewed-artefact-fingerprints/,
  );
  assert.match(
    slot.operator_decision_recorder_commands.approve_enabled_platforms_dry_run,
    new RegExp(fingerprint(artefacts.video_path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.equal(
    slot.approve_enabled_platforms_template.reviewed_artefact_fingerprints.video_path,
    fingerprint(artefacts.video_path),
  );
});

test("decision sheet marks already decided packets but does not create guarded actions", () => {
  const sheet = buildHumanReviewDecisionSheet({
    reviewPacketManifest: reviewPacketManifest(),
    operatorDecisionLog: operatorDecisionLog([
      {
        story_id: "story-one",
        operator: "MORR",
        decision: "reject",
        decided_at: "2026-05-31T18:40:00.000Z",
      },
    ]),
  });

  assert.equal(sheet.summary.already_decided_count, 1);
  assert.equal(sheet.summary.pending_decision_count, 0);
  assert.equal(sheet.decision_slots[0].decision_status, "already_decided");
  assert.equal(sheet.decision_slots[0].existing_decision.decision, "reject");
  assert.equal(sheet.safe_publish_plan.live_publish_allowed_from_this_tool, false);
});

test("decision sheet fails red when the input safety contracts are missing", () => {
  const unsafeManifest = reviewPacketManifest();
  unsafeManifest.safety.no_network_uploads = false;

  const sheet = buildHumanReviewDecisionSheet({
    reviewPacketManifest: unsafeManifest,
    operatorDecisionLog: operatorDecisionLog(),
  });

  assert.equal(sheet.verdict, "RED");
  assert.ok(sheet.blockers.includes("human_review_decision_sheet_safety_contract_failed"));
  assert.equal(sheet.summary.decision_slot_count, 0);
});

test("decision sheet writes JSON and markdown artefacts", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-decision-sheet-"));
  const sheet = buildHumanReviewDecisionSheet({
    reviewPacketManifest: reviewPacketManifest(),
    operatorDecisionLog: operatorDecisionLog(),
  });

  const written = await writeHumanReviewDecisionSheet(sheet, { outputDir: dir });

  assert.equal(await fs.pathExists(path.join(dir, "human_review_decision_sheet.json")), true);
  assert.equal(await fs.pathExists(path.join(dir, "human_review_decision_sheet.md")), true);
  assert.equal(path.basename(written.jsonPath), "human_review_decision_sheet.json");

  const markdown = renderHumanReviewDecisionSheetMarkdown(sheet);
  assert.match(markdown, /Human Review Decision Sheet/);
  assert.match(markdown, /Forza Horizon 6 Exposes Xbox's Steam Bet/);
  assert.match(markdown, /enabled only: youtube_shorts, instagram_reels, facebook_reels/);
  assert.match(markdown, /C:\\proof\\story-one\\visual_v4_render\.mp4/);
  assert.match(markdown, /npm run ops:goal-record-operator-decision/);
  assert.match(markdown, /--risk-notes "<review note>"/);
  assert.match(markdown, /No uploads are triggered/);
});

test("decision sheet CLI is registered and writes clean JSON", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-decision-sheet-cli-"));
  const manifestPath = path.join(dir, "review_packet_manifest.json");
  const decisionLogPath = path.join(dir, "operator_decision_log.json");
  const outDir = path.join(dir, "out");
  await fs.writeJson(manifestPath, reviewPacketManifest(), { spaces: 2 });
  await fs.writeJson(decisionLogPath, operatorDecisionLog(), { spaces: 2 });

  const result = spawnSync(
    process.execPath,
    [
      "tools/goal-human-review-decision-sheet.js",
      "--review-packet-manifest",
      manifestPath,
      "--operator-decision-log",
      decisionLogPath,
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
  assert.equal(parsed.summary.decision_slot_count, 1);
  assert.equal(await fs.pathExists(path.join(outDir, "human_review_decision_sheet.json")), true);

  const pkg = await fs.readJson(path.join(ROOT, "package.json"));
  assert.equal(pkg.scripts["ops:goal-human-review-decisions"], "node tools/goal-human-review-decision-sheet.js");
});
