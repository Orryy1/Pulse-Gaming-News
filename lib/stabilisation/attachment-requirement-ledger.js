"use strict";

const STATUS = Object.freeze({
  IMPLEMENTED_LOCAL: "IMPLEMENTED_LOCAL",
  POLICY_FROZEN: "IMPLEMENTED_AS_POLICY_FREEZE",
  BLOCKED_OPERATOR: "BLOCKED_OPERATOR_APPROVAL",
  BLOCKED_EXTERNAL: "BLOCKED_EXTERNAL_OR_PRODUCTION_EVIDENCE",
  BLOCKED_TIME: "BLOCKED_OBSERVATION_WINDOW",
  PHASE_GATED: "PHASE_GATED_NOT_YET_PERMITTED",
});

function requirement(id, area, requirementText, status, evidence = []) {
  return Object.freeze({
    id,
    area,
    requirement: requirementText,
    status,
    evidence: Object.freeze(evidence),
  });
}

const REQUIREMENTS = Object.freeze([
  requirement("FRZ-01", "scope", "No additional platforms for 30 days", STATUS.POLICY_FROZEN, ["lib/stabilisation/operating-contract.js"]),
  requirement("FRZ-02", "scope", "No additional content verticals", STATUS.POLICY_FROZEN, ["lib/stabilisation/product-surface-contract.js"]),
  requirement("FRZ-03", "scope", "No finance or crypto expansion", STATUS.POLICY_FROZEN, ["lib/stabilisation/product-surface-contract.js"]),
  requirement("FRZ-04", "scope", "No further Studio generations", STATUS.POLICY_FROZEN, ["lib/stabilisation/product-surface-contract.js"]),
  requirement("FRZ-05", "scope", "No new affiliate systems", STATUS.POLICY_FROZEN, ["lib/stabilisation/operating-contract.js"]),
  requirement("FRZ-06", "scope", "No Discord economy expansion", STATUS.POLICY_FROZEN, ["lib/stabilisation/operating-contract.js"]),
  requirement("FRZ-07", "scope", "No autonomous public engagement", STATUS.POLICY_FROZEN, ["lib/stabilisation/operating-contract.js"]),
  requirement("FRZ-08", "scope", "No broad auto-publishing", STATUS.POLICY_FROZEN, ["lib/stabilisation/operating-contract.js"]),
  requirement("FRZ-09", "scope", "Preserve ElevenLabs, Epidemic Sound, HyperFrames and FFmpeg", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/operating-contract.js", "docs/MEDIA_AND_RIGHTS.md"]),
  requirement("FRZ-10", "scope", "Keep HeyGen, Kokoro and MusicGen disabled", STATUS.POLICY_FROZEN, ["lib/stabilisation/operating-contract.js"]),
  requirement("FRZ-11", "scope", "Do not alter the currently frozen upload assets", STATUS.IMPLEMENTED_LOCAL, ["docs/CURRENT_STATUS.md"]),

  requirement("BRD-01", "brand", "Use Pulse Gaming News as the public display-name candidate", STATUS.IMPLEMENTED_LOCAL, ["channels/pulse-gaming.js"]),
  requirement("BRD-02", "brand", "Apply the display name on the live channel", STATUS.BLOCKED_OPERATOR, ["docs/CONTENT_STANDARD.md"]),
  requirement("BRD-03", "brand", "Use PULSE as the in-video name", STATUS.IMPLEMENTED_LOCAL, ["channels/pulse-gaming.js"]),
  requirement("BRD-04", "brand", "Use Fast gaming news. Checked. Explained. as the tagline candidate", STATUS.IMPLEMENTED_LOCAL, ["channels/pulse-gaming.js"]),
  requirement("BRD-05", "brand", "Apply the tagline on the live channel", STATUS.BLOCKED_OPERATOR, ["docs/CONTENT_STANDARD.md"]),
  requirement("BRD-06", "brand", "Use the consequence, source and proof viewer proposition", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/brand-content-contract.js"]),
  requirement("BRD-07", "brand", "Use the player-consequence subscription promise", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/brand-content-contract.js"]),
  requirement("BRD-08", "brand", "Provide a wordless black-and-amber avatar candidate", STATUS.IMPLEMENTED_LOCAL, ["public/brand/pulse-v1/avatar.svg"]),
  requirement("BRD-09", "brand", "Use a 70–80% heavy asymmetric mark without glow", STATUS.IMPLEMENTED_LOCAL, ["public/brand/pulse-v1/avatar.svg", "tests/services/avatar-stabilisation.test.js"]),
  requirement("BRD-10", "brand", "Prove avatar legibility at 24px, 32px and 48px", STATUS.IMPLEMENTED_LOCAL, ["tests/services/avatar-stabilisation.test.js"]),
  requirement("BRD-11", "brand", "Approve and apply the avatar on YouTube", STATUS.BLOCKED_OPERATOR, ["docs/CONTENT_STANDARD.md"]),
  requirement("BRD-12", "brand", "Unify fragmented public handles where platforms permit", STATUS.BLOCKED_OPERATOR, ["docs/PLATFORM_MATRIX.md"]),
  requirement("BRD-13", "editorial", "Expose only What Changes for Players, Trailer Truth Check and Platform Pulse", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/brand-content-contract.js"]),

  requirement("CNT-01", "content", "Use 25–32 seconds for a single clear consequence", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/brand-content-contract.js", "lib/services/short-runtime-planner.js"]),
  requirement("CNT-02", "content", "Use 32–42 seconds for standard news", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/brand-content-contract.js", "lib/services/short-runtime-planner.js"]),
  requirement("CNT-03", "content", "Use 40–50 seconds for two-sided platform or business stories", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/brand-content-contract.js", "lib/services/short-runtime-planner.js"]),
  requirement("CNT-04", "content", "Use 42–55 seconds for four-item lists", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/brand-content-contract.js", "lib/services/short-runtime-planner.js"]),
  requirement("CNT-05", "content", "Permit 60-second-plus TikTok only as a separate justified derivative", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/brand-content-contract.js"]),
  requirement("CNT-06", "content", "Never pad simple narration to hit a platform duration", STATUS.IMPLEMENTED_LOCAL, ["audio.js", "lib/stabilisation/brand-content-contract.js"]),
  requirement(
    "CNT-07",
    "content",
    "Remove the repeated fixed follow CTA",
    STATUS.IMPLEMENTED_LOCAL,
    [
      "processor.js",
      "audio.js",
      "lib/goal-duration-variant-repair.js",
      "lib/viral-script-intelligence.js",
    ],
  ),
  requirement("CNT-08", "content", "Limit CTA use to one-third of the controlled cohort", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/brand-content-contract.js"]),
  requirement("CNT-09", "content", "Use a story-specific consequence, verdict, choice, question or real tease", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/brand-content-contract.js"]),
  requirement("CNT-10", "content", "Show exact subject by 0.5 seconds", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/brand-content-contract.js"]),
  requirement("CNT-11", "content", "Make the consequence clear by 1.5 seconds", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/brand-content-contract.js"]),
  requirement("CNT-12", "content", "Show proof by 3 seconds", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/brand-content-contract.js"]),
  requirement("CNT-13", "content", "Add a second fact before the midpoint and payoff in the final quarter", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/brand-content-contract.js"]),
  requirement("CNT-14", "content", "Do not delay the story with an opening logo", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/brand-content-contract.js"]),
  requirement("CNT-15", "engagement", "Allow only a specific human-approved pinned comment with a legitimate one- or two-word choice", STATUS.IMPLEMENTED_LOCAL, ["processor.js", "lib/stabilisation/brand-content-contract.js"]),

  requirement("POL-01", "originality", "Record STRONG, ADEQUATE, WEAK or REUSED_CONTENT_RISK", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/originality-disclosure-contract.js"]),
  requirement("POL-02", "originality", "Require editorial transformation independently from rights", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/publish-manifest-gate.js", "lib/goal06-rights-ledger.js"]),
  requirement("POL-03", "disclosure", "Record required flag, reason, operator decision, YouTube value and review time", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/originality-disclosure-contract.js"]),
  requirement("POL-04", "disclosure", "Review synthetic disclosure per video", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/publish-manifest-gate.js"]),

  requirement("REL-01", "release", "Produce PR 68 and PR 69 overlap and unique-work evidence", STATUS.IMPLEMENTED_LOCAL, ["docs/stabilisation/pr68_pr69_overlap_report.md"]),
  requirement("REL-02", "release", "Do not directly merge either giant draft PR", STATUS.POLICY_FROZEN, ["docs/stabilisation/release_pulse_v1_slice_plan.md"]),
  requirement("REL-03", "release", "Tag PR 69 head as a forensic archive", STATUS.BLOCKED_OPERATOR, ["docs/stabilisation/release_pulse_v1_slice_plan.md"]),
  requirement("REL-04", "release", "Tag the exact running commit once identified", STATUS.BLOCKED_EXTERNAL, ["docs/stabilisation/runtime_provenance_report.md"]),
  requirement("REL-05", "release", "Mark PR 68 superseded after unique work is captured", STATUS.BLOCKED_OPERATOR, ["docs/stabilisation/pr68_pr69_overlap_report.md"]),
  requirement("REL-06", "release", "Create clean release/pulse-v1 from exact main", STATUS.BLOCKED_OPERATOR, ["docs/stabilisation/release_pulse_v1_slice_plan.md"]),
  requirement("REL-07", "release", "Reconstruct the system as 12 thematic slices", STATUS.IMPLEMENTED_LOCAL, ["docs/stabilisation/release_pulse_v1_slice_plan.md"]),
  requirement("REL-08", "release", "Run clean CI install, tests, build and secret scan", STATUS.IMPLEMENTED_LOCAL, [".github/workflows/pulse-release.yml"]),
  requirement("REL-09", "release", "Enforce protected main and reviews", STATUS.BLOCKED_OPERATOR, ["docs/stabilisation/ci_implementation_plan.md"]),
  requirement("REL-10", "release", "Deploy production only from protected main or approved tag", STATUS.BLOCKED_OPERATOR, ["docs/DEPLOYMENT_RUNBOOK.md"]),

  requirement("DOC-01", "documentation", "Attach metadata, expiry, supersession and authority to reports", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/report-governance.js"]),
  requirement("DOC-02", "documentation", "Render a visible stale historical evidence banner", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/report-governance.js"]),
  requirement("DOC-03", "documentation", "Create the ten-document canonical reader set", STATUS.IMPLEMENTED_LOCAL, ["README.md", "docs/CURRENT_STATUS.md"]),
  requirement("DOC-04", "documentation", "Store architecture decisions under docs/adr", STATUS.IMPLEMENTED_LOCAL, ["docs/adr/0003-consolidate-canonical-documentation.md"]),
  requirement("DOC-05", "documentation", "Move superseded evidence to dated archives through reviewed slices", STATUS.BLOCKED_OPERATOR, ["docs/ARCHIVE_POLICY.md"]),

  requirement(
    "SCH-01",
    "scheduler",
    "Use one cron-to-job scheduler and one durable queue",
    STATUS.IMPLEMENTED_LOCAL,
    ["lib/scheduler.js", "lib/bootstrap-queue.js", "lib/dispatch-mode.js"],
  ),
  requirement("SCH-02", "scheduler", "Do not fall back to legacy live cron when the queue is disabled", STATUS.IMPLEMENTED_LOCAL, ["lib/dispatch-mode.js", "run.js", "server.js"]),
  requirement("SCH-03", "scheduler", "Require one renewable scheduler owner", STATUS.IMPLEMENTED_LOCAL, ["lib/services/scheduler-lock.js"]),
  requirement("SCH-04", "scheduler", "Use no more than two YouTube windows per rolling 24 hours", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/scheduler-profile.js"]),
  requirement("SCH-05", "scheduler", "Maintain at least four hours between posts", STATUS.IMPLEMENTED_LOCAL, ["lib/services/publish-window-policy.js"]),
  requirement("SCH-06", "scheduler", "Require human review", STATUS.IMPLEMENTED_LOCAL, ["publisher.js"]),
  requirement("SCH-07", "scheduler", "Prevent midnight-boundary loopholes", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/scheduler-profile.js"]),
  requirement("SCH-08", "scheduler", "Prevent queue catch-up bursts", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/scheduler-profile.js", "lib/ops/missed-publish-window-recovery.js"]),
  requirement("SCH-09", "scheduler", "Prevent automatic backlog batch publication", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/scheduler-profile.js"]),
  requirement("SCH-10", "scheduler", "Permit breaking exception only through explicit operator decision", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/scheduler-profile.js"]),
  requirement("SCH-11", "scheduler", "Disable automatic secondary-platform publication", STATUS.IMPLEMENTED_LOCAL, ["publisher.js"]),
  requirement("SCH-12", "scheduler", "Prove the one live production scheduler owner", STATUS.BLOCKED_EXTERNAL, ["docs/stabilisation/scheduler_ownership_report.md"]),

  requirement("DAT-01", "data", "Implement the canonical lifecycle and exceptional states", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/publication-lifecycle.js"]),
  requirement("DAT-02", "data", "Enforce platform plus idempotency uniqueness", STATUS.IMPLEMENTED_LOCAL, ["db/migrations/020_stabilisation_governance.sql"]),
  requirement("DAT-03", "data", "Enforce platform plus external-ID uniqueness", STATUS.IMPLEMENTED_LOCAL, ["db/migrations/020_stabilisation_governance.sql"]),
  requirement("DAT-04", "data", "Use immutable lifecycle and dispatch ledgers", STATUS.IMPLEMENTED_LOCAL, ["db/migrations/020_stabilisation_governance.sql"]),
  requirement("DAT-05", "data", "Use a separate current-state projection", STATUS.IMPLEMENTED_LOCAL, ["db/migrations/020_stabilisation_governance.sql"]),
  requirement("DAT-06", "data", "Use durable scheduler and publisher leases", STATUS.IMPLEMENTED_LOCAL, ["lib/services/scheduler-lock.js", "lib/services/publisher-lock.js"]),
  requirement("DAT-07", "data", "Retain transactional job claiming", STATUS.IMPLEMENTED_LOCAL, ["lib/repositories/jobs.js"]),
  requirement("DAT-08", "data", "Require explicit retryability classes and no blind ambiguous retry", STATUS.IMPLEMENTED_LOCAL, ["lib/repositories/publication_governance.js"]),
  requirement("DAT-09", "data", "Provide platform-verified operator-approved reconciliation", STATUS.IMPLEMENTED_LOCAL, ["lib/services/publication-reconciliation-worker.js"]),
  requirement("DAT-10", "data", "Retain immutable operator audit evidence", STATUS.IMPLEMENTED_LOCAL, ["db/migrations/020_stabilisation_governance.sql"]),
  requirement("DAT-11", "data", "Verify a production backup before repair", STATUS.BLOCKED_EXTERNAL, ["lib/services/publication-reconciliation-worker.js"]),
  requirement("DAT-12", "data", "Materialise migration 020 in production after backup and approval", STATUS.BLOCKED_OPERATOR, ["docs/stabilisation/database_state_integrity_report.md"]),

  requirement("ARC-01", "architecture", "Load dotenv once without overriding inherited values", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/runtime-config.js"]),
  requirement("ARC-02", "architecture", "Validate a single typed environment schema", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/runtime-config.js"]),
  requirement("ARC-03", "architecture", "Produce a redacted effective configuration report", STATUS.IMPLEMENTED_LOCAL, ["docs/stabilisation/effective_config_report.md"]),
  requirement("ARC-04", "architecture", "Use one standard renderer, one local experiment and one variant layer", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/product-surface-contract.js"]),
  requirement("ARC-05", "architecture", "Retire legacy renderers at the Pulse v1 milestone", STATUS.PHASE_GATED, ["docs/ARCHITECTURE.md"]),
  requirement("ARC-06", "architecture", "Restrict the present product to nine essential functions", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/product-surface-contract.js"]),
  requirement("ARC-07", "architecture", "Split the publisher state model from generic failure handling", STATUS.IMPLEMENTED_LOCAL, ["lib/services/governed-youtube-dispatch.js"]),

  requirement("MED-01", "media", "Use first-party and official exact-subject media before generic bridges", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/media-production-contract.js"]),
  requirement("MED-02", "media", "Forbid unrelated gameplay filler", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/media-production-contract.js"]),
  requirement("MED-03", "media", "Require 1080x1920 H.264, AAC 48kHz, audio and SHA-256 evidence", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/media-production-contract.js"]),
  requirement("MED-04", "media", "Require separate human creative QA", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/media-production-contract.js"]),
  requirement("MED-05", "media", "Hard-gate editorial, originality and media manifests before publish", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/publish-manifest-gate.js"]),
  requirement("MED-06", "media", "Maintain 100% rights-manifest coverage for autonomy", STATUS.BLOCKED_TIME, ["lib/stabilisation/recovery-programme.js"]),

  requirement("ANA-01", "analytics", "Use read-only YouTube Analytics scope only", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/analytics-contract.js"]),
  requirement("ANA-02", "analytics", "Do not initiate OAuth during the proof", STATUS.IMPLEMENTED_LOCAL, ["docs/stabilisation/analytics_readiness_report.md"]),
  requirement("ANA-03", "analytics", "Record identity, exposure, hook, retention, watch, engagement, conversion, audience, creative, editorial and operations fields", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/analytics-contract.js"]),
  requirement("ANA-04", "analytics", "Keep displayed views secondary and never choose a winner from views alone", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/analytics-experiment.js"]),
  requirement("ANA-05", "analytics", "Verify yt-analytics.readonly on the live token without mutating it", STATUS.BLOCKED_EXTERNAL, ["docs/stabilisation/analytics_readiness_report.md"]),
  requirement("ANA-06", "analytics", "Import and manually verify five already-published Shorts", STATUS.BLOCKED_EXTERNAL, ["docs/stabilisation/analytics_readiness_report.md"]),
  requirement("ANA-07", "analytics", "Build the three-lane, two-hook, two-duration 12-video plan", STATUS.IMPLEMENTED_LOCAL, ["docs/stabilisation/analytics-12-video-experiment.json"]),
  requirement("ANA-08", "analytics", "Review each experiment video at 24h, 48h and 7d", STATUS.BLOCKED_TIME, ["lib/stabilisation/analytics-experiment.js"]),
  requirement("ANA-09", "analytics", "Freeze scoring until the complete 12-video sample", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/analytics-experiment.js"]),
  requirement("ANA-10", "analytics", "Promote only when lane median beats the channel median on at least three named metrics", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/analytics-experiment.js"]),

  requirement("MOD-01", "operations", "Expose only LOCAL_PROOF, HUMAN_REVIEW and LIVE_GUARDED", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/operating-contract.js"]),
  requirement("MOD-02", "operations", "Refuse contradictory legacy mode flags", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/operating-contract.js"]),
  requirement("PLT-01", "platform", "Keep YouTube primary and human-reviewed", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/operating-contract.js"]),
  requirement("PLT-02", "platform", "Keep Instagram disabled until the YouTube experiment completes", STATUS.PHASE_GATED, ["docs/PLATFORM_MATRIX.md"]),
  requirement("PLT-03", "platform", "Keep Facebook disabled except controlled proof", STATUS.PHASE_GATED, ["docs/PLATFORM_MATRIX.md"]),
  requirement("PLT-04", "platform", "Keep TikTok manual only", STATUS.PHASE_GATED, ["docs/PLATFORM_MATRIX.md"]),
  requirement("PLT-05", "platform", "Keep X, Threads and Pinterest disabled", STATUS.POLICY_FROZEN, ["docs/PLATFORM_MATRIX.md"]),
  requirement("PLT-06", "platform", "Keep blog maintenance-only", STATUS.POLICY_FROZEN, ["docs/PLATFORM_MATRIX.md"]),
  requirement("PLT-07", "platform", "Gate one later long-form pilot on a proven Short topic", STATUS.PHASE_GATED, ["docs/PLATFORM_MATRIX.md"]),
  requirement("PLT-08", "platform", "Restrict Discord to announcements and feedback", STATUS.POLICY_FROZEN, ["docs/PLATFORM_MATRIX.md"]),

  requirement("REC-01", "recovery", "Encode the five-phase 90-day recovery programme", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/recovery-programme.js"]),
  requirement("REC-02", "recovery", "Require exact runtime, protected main, clean CI and state integrity before autonomy", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/recovery-programme.js"]),
  requirement("REC-03", "recovery", "Require 30 duplicate-free days", STATUS.BLOCKED_TIME, ["lib/stabilisation/recovery-programme.js"]),
  requirement("REC-04", "recovery", "Require 30 off-schedule-free days", STATUS.BLOCKED_TIME, ["lib/stabilisation/recovery-programme.js"]),
  requirement("REC-05", "recovery", "Require a tested kill switch and backup/restore rehearsal", STATUS.BLOCKED_EXTERNAL, ["lib/stabilisation/recovery-programme.js"]),
  requirement("REC-06", "recovery", "Require at least 12 analysed controlled videos and a repeatable winning lane", STATUS.BLOCKED_TIME, ["lib/stabilisation/recovery-programme.js"]),
  requirement("REC-07", "recovery", "Increase to three daily Shorts only if retention remains stable", STATUS.PHASE_GATED, ["lib/stabilisation/recovery-programme.js"]),
  requirement("REC-08", "recovery", "Pilot secondary platforms one at a time only after gates pass", STATUS.PHASE_GATED, ["lib/stabilisation/recovery-programme.js"]),

  requirement("COM-01", "commercial", "Record the audit valuation and revenue ranges as forecasts, not guarantees", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/commercial-forecast-tracker.js"]),
  requirement("COM-02", "commercial", "Track actual MRR and operating cost separately from forecast", STATUS.IMPLEMENTED_LOCAL, ["lib/stabilisation/commercial-forecast-tracker.js"]),
  requirement("COM-03", "commercial", "Freeze SaaS and multi-tenant productisation", STATUS.POLICY_FROZEN, ["lib/stabilisation/commercial-forecast-tracker.js"]),
  requirement("COM-04", "commercial", "Permit a selective sponsorship or affiliate test only after audience intent supports it", STATUS.PHASE_GATED, ["lib/stabilisation/recovery-programme.js"]),
]);

function buildAttachmentRequirementLedger({ metadata } = {}) {
  const counts = {};
  for (const item of REQUIREMENTS) {
    counts[item.status] = (counts[item.status] || 0) + 1;
  }
  return {
    schema_version: "pulse-attachment-implementation-ledger-v1",
    metadata,
    requirement_count: REQUIREMENTS.length,
    status_counts: counts,
    all_requirements_accounted_for: true,
    release_ready: false,
    requirements: REQUIREMENTS.map((item) => ({ ...item, evidence: [...item.evidence] })),
    interpretation:
      "Implemented means the local control, contract, test or evidence generator exists. It does not assert that an external platform, production database, GitHub setting or observation window has been completed.",
  };
}

module.exports = {
  REQUIREMENTS,
  STATUS,
  buildAttachmentRequirementLedger,
};
