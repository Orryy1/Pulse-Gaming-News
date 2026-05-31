"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildHumanReviewApprovalGate,
  renderHumanReviewApprovalGateMarkdown,
  writeHumanReviewApprovalGate,
} = require("../../lib/goal-human-review-approval-gate");

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

function fingerprint(filePath) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function fingerprintMap(artefacts) {
  return Object.fromEntries(
    REQUIRED_ARTEFACT_KEYS.map((key) => [key, fingerprint(artefacts[key])]),
  );
}

function reviewPacket(overrides = {}) {
  const artefacts = {
    video_path: "C:\\proof\\story-one\\visual_v4_render.mp4",
    first_frame_source: "C:\\proof\\story-one\\visual_v4_render.mp4",
    captions_path: "C:\\proof\\story-one\\captions.srt",
    canonical_manifest_path: "C:\\proof\\story-one\\canonical_story_manifest.json",
    platform_publish_manifest_path: "C:\\proof\\story-one\\platform_publish_manifest.json",
  };
  return {
    packet_id: "story-one:human_review",
    story_id: "story-one",
    title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
    verdict: "AMBER",
    enabled_review_platforms: ["youtube_shorts", "instagram_reels"],
    deferred_platforms: ["tiktok", "x"],
    blocked_platforms: [],
    public_copy: {
      title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
      thumbnail_headline: "FORZA STEAM BET",
      first_spoken_line: "Forza Horizon 6 just made Xbox's Steam plan harder to ignore.",
    },
    source_list: {
      primary: { name: "Eurogamer", url: "https://www.eurogamer.net/forza-horizon-6-steam" },
    },
    artefacts,
    required_operator_checks: [
      "watch_first_three_seconds",
      "verify_title_thumbnail_opening_source_parity",
      "verify_enabled_platforms_only",
      "confirm_no_disabled_platform_counted_ready",
      "record_approve_or_reject_decision",
    ],
    approval_gate: {
      operator_decision_required: true,
      live_publish_allowed_before_decision: false,
      disabled_platforms_must_remain_deferred: true,
    },
    ...overrides,
  };
}

async function reviewPacketWithProof(root) {
  return reviewPacket({ artefacts: await proofArtefacts(root) });
}

function reviewPacketManifest(packet = reviewPacket()) {
  return {
    schema_version: 1,
    generated_at: "2026-05-31T18:00:00.000Z",
    mode: "HUMAN_REVIEW",
    review_packets: [packet],
    blocked_packets: [],
    safety: {
      no_live_publish_from_manifest: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function humanReviewQueue(packet = reviewPacket()) {
  return {
    schema_version: 1,
    generated_at: "2026-05-31T18:00:00.000Z",
    mode: "HUMAN_REVIEW",
    summary: {
      review_item_count: 1,
      blocked_item_count: 0,
      ready_for_unattended_publish: false,
    },
    review_items: [
      {
        story_id: packet.story_id,
        full_platform_verdict: packet.verdict,
        enabled_review_platforms: packet.enabled_review_platforms,
        deferred_platforms: packet.deferred_platforms,
        blocked_platforms: packet.blocked_platforms,
        public_copy: packet.public_copy,
        source_list: packet.source_list,
        evidence: packet.artefacts,
      },
    ],
    blocked_items: [],
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function decision(overrides = {}) {
  return {
    story_id: "story-one",
    operator: "MORR",
    decision: "approve_enabled_platforms",
    approved_platforms: ["youtube_shorts", "instagram_reels"],
    rejected_platforms: [],
    repair_requested: "",
    reviewed_artefacts: [
      "video_path",
      "first_frame_source",
      "captions_path",
      "canonical_manifest_path",
      "platform_publish_manifest_path",
    ],
    risk_acceptance_notes: "Watched proof video, checked first frame, captions and source card.",
    decided_at: "2026-05-31T18:05:00.000Z",
    ...overrides,
  };
}

async function decisionWithProof(root, overrides = {}) {
  const artefacts = await proofArtefacts(root);
  return {
    ...decision({
      reviewed_artefact_fingerprints: fingerprintMap(artefacts),
    }),
    ...overrides,
  };
}

test("approval gate keeps an empty operator decision log in AMBER with no approved actions", () => {
  const report = buildHumanReviewApprovalGate({
    humanReviewQueue: humanReviewQueue(),
    reviewPacketManifest: reviewPacketManifest(),
    operatorDecisionLog: {
      mode: "HUMAN_REVIEW_DECISION_LOG",
      decisions: [],
      safety: {
        no_live_publish_from_log: true,
        no_network_uploads: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
      },
    },
    generatedAt: "2026-05-31T18:10:00.000Z",
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.summary.approved_action_count, 0);
  assert.equal(report.summary.pending_review_packet_count, 1);
  assert.deepEqual(report.advisory, [
    "no_recorded_operator_decisions",
    "review_packets_still_pending_operator_decision",
  ]);
  assert.equal(report.safe_publish_plan.guarded_dispatch_eligible, false);
  assert.equal(report.safe_publish_plan.live_publish_allowed_from_this_tool, false);
});

test("approval gate converts a valid operator decision into enabled-platform guarded actions only", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-valid-"));
  const packet = await reviewPacketWithProof(root);
  const report = buildHumanReviewApprovalGate({
    humanReviewQueue: humanReviewQueue(packet),
    reviewPacketManifest: reviewPacketManifest(packet),
    operatorDecisionLog: {
      mode: "HUMAN_REVIEW_DECISION_LOG",
      decisions: [decision({ reviewed_artefact_fingerprints: fingerprintMap(packet.artefacts) })],
      safety: {
        no_live_publish_from_log: true,
        no_network_uploads: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
      },
    },
    generatedAt: "2026-05-31T18:10:00.000Z",
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.summary.approved_story_count, 1);
  assert.equal(report.summary.approved_action_count, 2);
  assert.deepEqual(report.approved_actions.map((action) => action.platform), ["youtube_shorts", "instagram_reels"]);
  assert.equal(report.approved_actions[0].live_publish_allowed_from_gate, false);
  assert.equal(report.approved_actions[0].requires_guarded_dispatch_command, true);
  assert.equal(report.approved_actions[0].video_path, packet.artefacts.video_path);
  assert.equal(
    report.approved_actions[0].reviewed_artefact_fingerprints.video_path,
    fingerprintMap(packet.artefacts).video_path,
  );
  assert.equal(report.safe_publish_plan.guarded_dispatch_eligible, true);
  assert.equal(report.safe_publish_plan.live_publish_allowed_from_this_tool, false);
  assert.equal(report.safety.no_network_uploads, true);
});

test("approval gate rejects decisions that approve disabled or deferred platforms", () => {
  const report = buildHumanReviewApprovalGate({
    humanReviewQueue: humanReviewQueue(),
    reviewPacketManifest: reviewPacketManifest(),
    operatorDecisionLog: {
      mode: "HUMAN_REVIEW_DECISION_LOG",
      decisions: [decision({ approved_platforms: ["youtube_shorts", "tiktok"] })],
      safety: {
        no_live_publish_from_log: true,
        no_network_uploads: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
      },
    },
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.invalid_decision_count, 1);
  assert.equal(report.summary.approved_action_count, 0);
  assert.ok(report.blocked_decisions[0].blockers.includes("approved_platform_not_enabled_for_review:tiktok"));
  assert.equal(report.safe_publish_plan.guarded_dispatch_eligible, false);
});

test("approval gate rejects decisions that do not record the required artefact review", () => {
  const report = buildHumanReviewApprovalGate({
    humanReviewQueue: humanReviewQueue(),
    reviewPacketManifest: reviewPacketManifest(),
    operatorDecisionLog: {
      mode: "HUMAN_REVIEW_DECISION_LOG",
      decisions: [
        decision({
          reviewed_artefacts: ["video_path", "captions_path"],
        }),
      ],
      safety: {
        no_live_publish_from_log: true,
        no_network_uploads: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
      },
    },
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.invalid_decision_count, 1);
  assert.ok(report.blocked_decisions[0].blockers.includes("required_artefact_not_reviewed:first_frame_source"));
  assert.ok(report.blocked_decisions[0].blockers.includes("required_artefact_not_reviewed:canonical_manifest_path"));
  assert.equal(report.summary.approved_action_count, 0);
});

test("approval gate rejects stale operator approvals when reviewed artefact fingerprints drift", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-stale-"));
  const packet = await reviewPacketWithProof(root);
  const reviewedFingerprints = fingerprintMap(packet.artefacts);
  await fs.writeFile(packet.artefacts.video_path, "video-v2-after-review");

  const report = buildHumanReviewApprovalGate({
    humanReviewQueue: humanReviewQueue(packet),
    reviewPacketManifest: reviewPacketManifest(packet),
    operatorDecisionLog: {
      mode: "HUMAN_REVIEW_DECISION_LOG",
      decisions: [
        decision({
          reviewed_artefact_fingerprints: reviewedFingerprints,
        }),
      ],
      safety: {
        no_live_publish_from_log: true,
        no_network_uploads: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
      },
    },
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.invalid_decision_count, 1);
  assert.ok(report.blocked_decisions[0].blockers.includes("reviewed_artefact_fingerprint_mismatch:video_path"));
  assert.equal(report.summary.approved_action_count, 0);
});

test("approval gate writes machine-readable reports and operator markdown", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-approval-"));
  const packet = await reviewPacketWithProof(root);
  const report = buildHumanReviewApprovalGate({
    humanReviewQueue: humanReviewQueue(packet),
    reviewPacketManifest: reviewPacketManifest(packet),
    operatorDecisionLog: {
      mode: "HUMAN_REVIEW_DECISION_LOG",
      decisions: [decision({ reviewed_artefact_fingerprints: fingerprintMap(packet.artefacts) })],
      safety: {
        no_live_publish_from_log: true,
        no_network_uploads: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
      },
    },
  });

  const written = await writeHumanReviewApprovalGate(report, { outputDir: root });
  assert.equal(await fs.pathExists(path.join(root, "human_review_approval_gate_report.json")), true);
  assert.equal(await fs.pathExists(path.join(root, "human_review_controlled_publish_plan.json")), true);
  assert.equal(await fs.pathExists(path.join(root, "human_review_approval_gate.md")), true);
  assert.equal(path.basename(written.controlledPublishPlanPath), "human_review_controlled_publish_plan.json");

  const markdown = renderHumanReviewApprovalGateMarkdown(report);
  assert.match(markdown, /# Human Review Approval Gate/);
  assert.match(markdown, /Verdict: GREEN/);
  assert.match(markdown, /No uploads are triggered/);
});

test("approval gate CLI is registered and writes clean JSON", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-approval-cli-"));
  const packet = await reviewPacketWithProof(root);
  const queuePath = path.join(root, "human_review_queue.json");
  const packetPath = path.join(root, "review_packet_manifest.json");
  const decisionPath = path.join(root, "operator_decision_log.json");
  const outDir = path.join(root, "out");
  await fs.writeJson(queuePath, humanReviewQueue(packet), { spaces: 2 });
  await fs.writeJson(packetPath, reviewPacketManifest(packet), { spaces: 2 });
  await fs.writeJson(decisionPath, {
    mode: "HUMAN_REVIEW_DECISION_LOG",
    decisions: [decision({ reviewed_artefact_fingerprints: fingerprintMap(packet.artefacts) })],
    safety: {
      no_live_publish_from_log: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  }, { spaces: 2 });

  const result = spawnSync(
    process.execPath,
    [
      "tools/goal-human-review-approval-gate.js",
      "--human-review-queue",
      queuePath,
      "--review-packet-manifest",
      packetPath,
      "--operator-decision-log",
      decisionPath,
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
  assert.equal(parsed.summary.approved_action_count, 2);
  assert.equal(await fs.pathExists(path.join(outDir, "human_review_approval_gate_report.json")), true);

  const pkg = await fs.readJson(path.join(ROOT, "package.json"));
  assert.equal(pkg.scripts["ops:goal-human-review-approval"], "node tools/goal-human-review-approval-gate.js");
});
