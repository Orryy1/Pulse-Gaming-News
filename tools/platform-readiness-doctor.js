"use strict";

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ override: true, quiet: true });

const { inspectTokenStatus } = require("../upload_tiktok");
const { buildPlatformOperationalConfig } = require("../lib/ops/platform-status");
const {
  buildTikTokAuthDoctorReport,
} = require("../lib/platforms/tiktok-auth-doctor");
const {
  buildTikTokAutomationReport,
} = require("../lib/platforms/tiktok-automation-report");
const {
  buildPlatformReadinessDoctor,
  renderPlatformReadinessDoctorMarkdown,
} = require("../lib/ops/platform-readiness-doctor");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function readJsonIfExists(filePath) {
  if (!(await fs.pathExists(filePath))) return {};
  return fs.readJson(filePath);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasDispatchEvidence(report = {}) {
  return Boolean(
    report?.dispatchGate?.topReadyPack ||
      report?.dispatchGate?.topPack ||
      report?.noPostReadiness?.dispatchCreative?.storyId,
  );
}

function hasFreshOrManifestEvidence({ dispatchManifest = {}, freshDispatchPack = {} } = {}) {
  return Boolean(
    freshDispatchPack?.dispatchPack ||
      dispatchManifest?.topReadyPack ||
      dispatchManifest?.topPack ||
      (Array.isArray(dispatchManifest?.packs) && dispatchManifest.packs.length),
  );
}

function strictDryRunTikTokActions(strictDryRunPlan = {}) {
  if (strictDryRunPlan?.mode && strictDryRunPlan.mode !== "DRY_RUN_PUBLISH") return [];
  const actions = Array.isArray(strictDryRunPlan?.actions) ? strictDryRunPlan.actions : [];
  return actions.filter((action) => {
    if (String(action?.platform || "").toLowerCase() !== "tiktok") return false;
    if (!/^(would_queue_when_enabled|would_publish)$/i.test(String(action?.action || ""))) return false;
    if (Array.isArray(action.blockers) && action.blockers.length > 0) return false;
    if (action.no_network_upload !== true) return false;
    const duration = numberOrNull(action.video_duration_s ?? action.duration_s ?? action.duration_seconds);
    if (duration === null || duration < 60) return false;
    if (!action.video_path) return false;
    return true;
  });
}

function freshDispatchPackFromStrictDryRunPlan(strictDryRunPlan = {}, { tiktokTokenStatus = {} } = {}) {
  const action = strictDryRunTikTokActions(strictDryRunPlan)[0] || null;
  if (!action) return {};
  const durationSeconds = numberOrNull(action.video_duration_s ?? action.duration_s ?? action.duration_seconds);
  const tokenBlocked = tiktokTokenStatus?.ok !== true;
  const status = tokenBlocked ? "tiktok_auth_action_required" : "ready_for_operator_review";
  const storyId = action.story_id || action.storyId || null;
  const cover = action.cover_frame_source || action.cover_path || action.video_path || null;
  return {
    schemaVersion: 1,
    generatedAt: strictDryRunPlan.generated_at || strictDryRunPlan.generatedAt || new Date().toISOString(),
    story: {
      id: storyId,
      title: action.title || storyId || "TikTok dispatch candidate",
    },
    dispatchPack: {
      storyId,
      title: action.title || storyId || "",
      source: "strict_dry_run_tiktok_action",
      status,
      mp4: action.video_path,
      cover,
      caption: action.title || storyId || "",
      hashtags: [],
      eligibility: {
        durationSeconds,
        captionReady: true,
        dispatchLengthReady: durationSeconds !== null && durationSeconds >= 60,
        hasMp4: true,
        hasCover: Boolean(cover),
      },
      voiceGate: {
        verdict: "pass",
        blockers: [],
        warnings: [],
        do_not_reuse_for_tiktok_dispatch: false,
      },
      creativeGate: {
        checked: true,
        verdict: "strict_dry_run_current",
        blockers: [],
        warnings: Array.isArray(action.warnings) ? action.warnings : [],
        blocks_dispatch: false,
      },
    },
    inboxPlan: {
      status: tokenBlocked ? "not_ready" : "dry_run_ready",
      dry_run: true,
      will_upload_to_tiktok: false,
      public_auto_publish: false,
      blockers: tokenBlocked ? ["dispatch_pack_tiktok_auth_action_required"] : [],
    },
    creativeReview: {
      operator_visual_review_required: true,
      blockers: [],
      reason:
        "Strict dry-run selected this current TikTok action. It is routing evidence only; operator visual review is still required before any inbox upload.",
    },
    safety: {
      local_dry_run_only: true,
      live_upload_executed: false,
      public_post_created: false,
      browser_automation_used: false,
      oauth_triggered: false,
      token_mutated: false,
      production_db_mutated: false,
    },
  };
}

function buildCurrentTikTokAutomationReport({
  generatedAt = new Date().toISOString(),
  env = process.env,
  tiktokTokenStatus = {},
  existingAutomationReport = {},
  dispatchManifest = {},
  freshDispatchPack = {},
  strictDryRunPlan = {},
} = {}) {
  const strictDryRunDispatchPack = freshDispatchPackFromStrictDryRunPlan(strictDryRunPlan, {
    tiktokTokenStatus,
  });
  const currentFreshDispatchPack = hasFreshOrManifestEvidence({
    freshDispatchPack: strictDryRunDispatchPack,
  })
    ? strictDryRunDispatchPack
    : freshDispatchPack;

  if (!hasFreshOrManifestEvidence({ dispatchManifest, freshDispatchPack: currentFreshDispatchPack })) {
    return existingAutomationReport || {};
  }
  const authDoctorReport = buildTikTokAuthDoctorReport({
    env,
    tokenStatus: tiktokTokenStatus,
    tokenStatusMode: "inspected",
  });
  const current = buildTikTokAutomationReport({
    generatedAt,
    authDoctorReport,
    dispatchManifest,
    freshDispatchPack: currentFreshDispatchPack,
  });
  return hasDispatchEvidence(current) ? current : existingAutomationReport || current;
}

async function main() {
  await fs.ensureDir(OUT);
  const tiktokTokenStatus = await inspectTokenStatus();
  const existingTikTokAutomationReport = await readJsonIfExists(
    path.join(OUT, "tiktok_overnight_automation_report.json"),
  );
  const dispatchManifest = await readJsonIfExists(path.join(OUT, "tiktok_dispatch_manifest.json"));
  const freshDispatchPack = await readJsonIfExists(
    path.join(OUT, "tiktok-fresh-dispatch", "tiktok_fresh_dispatch_pack.json"),
  );
  const strictDryRunPlan = await readJsonIfExists(
    getArg("--strict-dry-run-plan") ||
      path.join(ROOT, "output", "goal-contract", "dry_run_publish_plan.json"),
  );
  const tiktokAutomationReport = buildCurrentTikTokAutomationReport({
    tiktokTokenStatus,
    existingAutomationReport: existingTikTokAutomationReport,
    dispatchManifest,
    freshDispatchPack,
    strictDryRunPlan,
  });
  const facebookEligibilityReport = await readJsonIfExists(
    path.join(OUT, "facebook_reels_eligibility.json"),
  );
  const instagramLastError = getArg("--instagram-error") || process.env.PLATFORM_DOCTOR_INSTAGRAM_ERROR || null;
  const facebookManualProof = {
    observed:
      hasFlag("--facebook-manual-proof") ||
      String(process.env.FACEBOOK_REELS_MANUAL_PROOF || "").toLowerCase() === "true",
    note:
      getArg("--facebook-manual-proof-note") ||
      process.env.FACEBOOK_REELS_MANUAL_PROOF_NOTE ||
      null,
  };
  const report = buildPlatformReadinessDoctor({
    tiktokTokenStatus,
    tiktokAutomationReport,
    platformConfig: buildPlatformOperationalConfig(process.env),
    instagramLastError,
    facebookManualProof,
    facebookEligibilityReport,
  });
  const jsonPath = path.join(OUT, "platform_readiness_doctor.json");
  const mdPath = path.join(OUT, "platform_readiness_doctor.md");
  const rootPath = path.join(ROOT, "PLATFORM_READINESS_DOCTOR.md");
  const writeRootMarkdown =
    hasFlag("--write-root-md") ||
    String(process.env.PLATFORM_DOCTOR_WRITE_ROOT_MD || "").toLowerCase() === "true";
  const markdown = renderPlatformReadinessDoctorMarkdown(report);
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, markdown, "utf8");
  if (writeRootMarkdown) {
    await fs.writeFile(rootPath, markdown, "utf8");
  }
  console.log(`[platform-doctor] verdict=${report.verdict}`);
  console.log(`[platform-doctor] json=${path.relative(ROOT, jsonPath)}`);
  console.log(`[platform-doctor] md=${path.relative(ROOT, mdPath)}`);
  if (writeRootMarkdown) {
    console.log(`[platform-doctor] root_md=${path.relative(ROOT, rootPath)}`);
  }
  console.log("[platform-doctor] no OAuth, token mutation, uploads or posts");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[platform-doctor] FAILED: ${err.message || err}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildCurrentTikTokAutomationReport,
  freshDispatchPackFromStrictDryRunPlan,
  main,
  strictDryRunTikTokActions,
};
