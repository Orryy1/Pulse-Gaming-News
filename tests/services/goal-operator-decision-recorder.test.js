"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildOperatorDecisionRecorder,
  renderOperatorDecisionRecorderMarkdown,
  writeOperatorDecisionRecorder,
} = require("../../lib/goal-operator-decision-recorder");

const ROOT = path.resolve(__dirname, "..", "..");

const REQUIRED_ARTEFACT_KEYS = [
  "video_path",
  "first_frame_source",
  "captions_path",
  "canonical_manifest_path",
  "platform_publish_manifest_path",
];

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
  await fs.writeJson(artefacts.canonical_manifest_path, { story_id: storyId, version: 1 }, { spaces: 2 });
  await fs.writeJson(artefacts.platform_publish_manifest_path, { story_id: storyId, version: 1 }, { spaces: 2 });
  return artefacts;
}

async function visualReviewArtefacts(root, storyId = "story-one") {
  const dir = path.join(root, "goal-contract");
  await fs.ensureDir(dir);
  const visualStripPath = path.join(dir, "human_review_visual_strip_report.json");
  const visualStripQaPath = path.join(dir, "human_review_visual_strip_qa_report.json");
  await fs.writeJson(visualStripPath, {
    schema_version: 1,
    generated_at: "2026-05-31T20:01:00.000Z",
    mode: "HUMAN_REVIEW_VISUAL_STRIP",
    source_console_dry_run_generated_at: "2026-05-31T20:00:00.000Z",
    verdict: "AMBER",
    safe_to_publish_boolean: false,
    summary: { extracted_frame_count: 4, failed_card_count: 0 },
    cards: [{ story_id: storyId, status: "frames_extracted", frame_targets: [{ exists: true }] }],
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      approval_omitted_from_visual_strip: true,
    },
  }, { spaces: 2 });
  await fs.writeJson(visualStripQaPath, {
    schema_version: 1,
    generated_at: "2026-05-31T20:02:00.000Z",
    mode: "HUMAN_REVIEW_VISUAL_STRIP_QA",
    source_visual_strip_generated_at: "2026-05-31T20:01:00.000Z",
    source_console_dry_run_generated_at: "2026-05-31T20:00:00.000Z",
    verdict: "GREEN",
    safe_to_publish_boolean: false,
    summary: { risk_card_count: 0, frame_warning_count: 0, red_card_count: 0 },
    cards: [{ story_id: storyId, verdict: "GREEN", risk_reasons: [] }],
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      approval_omitted_from_visual_strip_qa: true,
    },
  }, { spaces: 2 });
  return {
    human_review_visual_strip_report_path: visualStripPath,
    human_review_visual_strip_qa_report_path: visualStripQaPath,
  };
}

function fingerprint(filePath) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function fingerprintMap(artefacts) {
  return Object.fromEntries(
    REQUIRED_ARTEFACT_KEYS.map((key) => [key, fingerprint(artefacts[key])]),
  );
}

function packet(overrides = {}) {
  return {
    packet_id: "story-one:human_review",
    story_id: "story-one",
    title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
    enabled_review_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    deferred_platforms: ["tiktok", "x"],
    blocked_platforms: [],
    artefacts: {
      video_path: "C:\\proof\\story-one\\visual_v4_render.mp4",
      first_frame_source: "C:\\proof\\story-one\\visual_v4_render.mp4",
      captions_path: "C:\\proof\\story-one\\captions.srt",
      canonical_manifest_path: "C:\\proof\\story-one\\canonical_story_manifest.json",
      platform_publish_manifest_path: "C:\\proof\\story-one\\platform_publish_manifest.json",
    },
    ...overrides,
  };
}

function reviewPacketManifest() {
  return {
    schema_version: 1,
    generated_at: "2026-05-31T20:00:00.000Z",
    source_dry_run_generated_at: "2026-05-31T20:00:00.000Z",
    mode: "HUMAN_REVIEW",
    review_packets: [packet()],
    blocked_packets: [],
    safety: {
      no_live_publish_from_manifest: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function reviewPacketManifestWithPacket(reviewPacket) {
  return {
    ...reviewPacketManifest(),
    review_packets: [reviewPacket],
  };
}

function decisionLog(decisions = []) {
  return {
    schema_version: 1,
    generated_at: "2026-05-31T20:00:00.000Z",
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

function approvalInput(overrides = {}) {
  return {
    story_id: "story-one",
    operator: "MORR",
    decision: "approve_enabled_platforms",
    approved_platforms: ["youtube_shorts", "instagram_reels"],
    reviewed_artefacts: [
      "video_path",
      "first_frame_source",
      "captions_path",
      "canonical_manifest_path",
      "platform_publish_manifest_path",
    ],
    risk_acceptance_notes: "Watched the proof video and checked title, source, captions and first frame.",
    decided_at: "2026-05-31T20:05:00.000Z",
    ...overrides,
  };
}

test("operator decision recorder dry-runs a valid explicit approval without writing publish authority", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-decision-recorder-valid-"));
  const artefacts = await proofArtefacts(root);
  const report = buildOperatorDecisionRecorder({
    reviewPacketManifest: reviewPacketManifestWithPacket(packet({ artefacts })),
    operatorDecisionLog: decisionLog(),
    decisionInput: approvalInput({ reviewed_artefact_fingerprints: fingerprintMap(artefacts) }),
    apply: false,
    generatedAt: "2026-05-31T20:10:00.000Z",
  });

  assert.equal(report.mode, "OPERATOR_DECISION_RECORDER");
  assert.equal(report.verdict, "GREEN");
  assert.equal(report.safe_to_publish_boolean, false);
  assert.equal(report.summary.existing_decision_count, 0);
  assert.equal(report.summary.updated_decision_count, 1);
  assert.equal(report.write_plan.apply_requested, false);
  assert.equal(report.write_plan.would_write_operator_decision_log, true);
  assert.equal(report.proposed_decision.story_id, "story-one");
  assert.deepEqual(report.proposed_decision.approved_platforms, ["youtube_shorts", "instagram_reels"]);
  assert.equal(report.proposed_decision.reviewed_artefact_fingerprints.video_path, fingerprintMap(artefacts).video_path);
  assert.equal(report.updated_operator_decision_log.safety.no_network_uploads, true);
});

test("operator decision recorder requires fresh visual strip and QA evidence when the packet exposes it", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-decision-recorder-visual-evidence-"));
  const artefacts = {
    ...await proofArtefacts(root),
    ...await visualReviewArtefacts(root),
  };
  const report = buildOperatorDecisionRecorder({
    reviewPacketManifest: reviewPacketManifestWithPacket(packet({ artefacts })),
    operatorDecisionLog: decisionLog(),
    decisionInput: approvalInput({
      reviewed_artefact_fingerprints: fingerprintMap(artefacts),
    }),
    apply: false,
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.proposed_decision, null);
  assert.ok(report.blockers.includes("required_artefact_not_reviewed:human_review_visual_strip_report_path"));
  assert.ok(report.blockers.includes("required_artefact_not_reviewed:human_review_visual_strip_qa_report_path"));
  assert.equal(report.write_plan.would_write_operator_decision_log, false);
});

test("operator decision recorder rejects disabled platform approvals and missing artefact review", () => {
  const report = buildOperatorDecisionRecorder({
    reviewPacketManifest: reviewPacketManifest(),
    operatorDecisionLog: decisionLog(),
    decisionInput: approvalInput({
      approved_platforms: ["youtube_shorts", "tiktok"],
      reviewed_artefacts: ["video_path"],
    }),
    apply: false,
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.proposed_decision, null);
  assert.ok(report.blockers.includes("approved_platform_not_enabled_for_review:tiktok"));
  assert.ok(report.blockers.includes("approved_platform_is_deferred:tiktok"));
  assert.ok(report.blockers.includes("required_artefact_not_reviewed:first_frame_source"));
  assert.equal(report.write_plan.would_write_operator_decision_log, false);
});

test("operator decision recorder rejects stale reviewed artefact fingerprints", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-decision-recorder-stale-"));
  const artefacts = await proofArtefacts(root);
  const staleFingerprints = fingerprintMap(artefacts);
  await fs.writeFile(artefacts.video_path, "video-v2-after-review");

  const report = buildOperatorDecisionRecorder({
    reviewPacketManifest: reviewPacketManifestWithPacket(packet({ artefacts })),
    operatorDecisionLog: decisionLog(),
    decisionInput: approvalInput({
      reviewed_artefact_fingerprints: staleFingerprints,
    }),
    apply: false,
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.proposed_decision, null);
  assert.ok(report.blockers.includes("reviewed_artefact_fingerprint_mismatch:video_path"));
  assert.equal(report.write_plan.would_write_operator_decision_log, false);
});

test("operator decision recorder prevents accidental duplicate story decisions unless replace is explicit", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-decision-recorder-duplicate-"));
  const artefacts = await proofArtefacts(root);
  const manifest = reviewPacketManifestWithPacket(packet({ artefacts }));
  const validApproval = approvalInput({ reviewed_artefact_fingerprints: fingerprintMap(artefacts) });
  const existing = approvalInput({ decision: "reject", approved_platforms: [] });
  const report = buildOperatorDecisionRecorder({
    reviewPacketManifest: manifest,
    operatorDecisionLog: decisionLog([existing]),
    decisionInput: validApproval,
    apply: false,
    replaceExisting: false,
  });

  assert.equal(report.verdict, "RED");
  assert.ok(report.blockers.includes("decision_already_exists_for_story:story-one"));

  const replaced = buildOperatorDecisionRecorder({
    reviewPacketManifest: manifest,
    operatorDecisionLog: decisionLog([existing]),
    decisionInput: validApproval,
    apply: false,
    replaceExisting: true,
  });
  assert.equal(replaced.verdict, "GREEN");
  assert.equal(replaced.summary.updated_decision_count, 1);
});

test("operator decision recorder writes reports and applies decision log only when requested", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-decision-recorder-"));
  const artefacts = await proofArtefacts(root);
  const manifest = reviewPacketManifestWithPacket(packet({ artefacts }));
  const validApproval = approvalInput({ reviewed_artefact_fingerprints: fingerprintMap(artefacts) });
  const logPath = path.join(root, "operator_decision_log.json");
  await fs.writeJson(logPath, decisionLog(), { spaces: 2 });

  const dryRun = buildOperatorDecisionRecorder({
    reviewPacketManifest: manifest,
    operatorDecisionLog: await fs.readJson(logPath),
    operatorDecisionLogPath: logPath,
    decisionInput: validApproval,
    apply: false,
  });
  const dryWritten = await writeOperatorDecisionRecorder(dryRun, { outputDir: root });
  assert.equal(path.basename(dryWritten.reportPath), "operator_decision_recorder_report.json");
  assert.equal((await fs.readJson(logPath)).decisions.length, 0);

  const apply = buildOperatorDecisionRecorder({
    reviewPacketManifest: manifest,
    operatorDecisionLog: await fs.readJson(logPath),
    operatorDecisionLogPath: logPath,
    decisionInput: validApproval,
    apply: true,
  });
  await writeOperatorDecisionRecorder(apply, { outputDir: root });
  const updated = await fs.readJson(logPath);
  assert.equal(updated.decisions.length, 1);
  assert.equal(updated.decisions[0].story_id, "story-one");
  assert.equal(await fs.pathExists(path.join(root, "operator_decision_log.backup.json")), true);

  const markdown = renderOperatorDecisionRecorderMarkdown(apply);
  assert.match(markdown, /Operator Decision Recorder/);
  assert.match(markdown, /No uploads are triggered/);
});

test("operator decision recorder CLI is registered, dry-runs by default and emits JSON", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-decision-recorder-cli-"));
  const artefacts = await proofArtefacts(root);
  const fingerprints = fingerprintMap(artefacts);
  const manifestPath = path.join(root, "review_packet_manifest.json");
  const logPath = path.join(root, "operator_decision_log.json");
  await fs.writeJson(manifestPath, reviewPacketManifestWithPacket(packet({ artefacts })), { spaces: 2 });
  await fs.writeJson(logPath, decisionLog(), { spaces: 2 });

  const result = spawnSync(
    process.execPath,
    [
      "tools/goal-operator-decision-recorder.js",
      "--review-packet-manifest",
      manifestPath,
      "--operator-decision-log",
      logPath,
      "--story",
      "story-one",
      "--operator",
      "MORR",
      "--decision",
      "approve_enabled_platforms",
      "--approved-platforms",
      "youtube_shorts,instagram_reels",
      "--reviewed-artefacts",
      "video_path,first_frame_source,captions_path,canonical_manifest_path,platform_publish_manifest_path",
      "--reviewed-artefact-fingerprints",
      REQUIRED_ARTEFACT_KEYS.map((key) => `${key}=${fingerprints[key]}`).join(","),
      "--risk-notes",
      "Watched proof video, source card and first frame.",
      "--out-dir",
      root,
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
  assert.equal(parsed.verdict, "GREEN");
  assert.equal(parsed.write_plan.apply_requested, false);
  assert.equal((await fs.readJson(logPath)).decisions.length, 0);

  const pkg = await fs.readJson(path.join(ROOT, "package.json"));
  assert.equal(
    pkg.scripts["ops:goal-record-operator-decision"],
    "node tools/goal-operator-decision-recorder.js",
  );
});
