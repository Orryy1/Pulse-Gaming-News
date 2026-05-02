"use strict";

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ override: true, quiet: true });

const {
  buildPlatformOperationalConfig,
  buildPlatformStatus,
} = require("../lib/ops/platform-status");
const {
  fetchFacebookReelsEvidence,
  buildFacebookReelsEligibilityReport,
} = require("../lib/platforms/facebook-reels-eligibility");
const {
  diagnoseTikTok403,
} = require("../lib/platforms/tiktok-403-diagnosis");
const {
  buildTikTokDispatchManifest,
} = require("../lib/platforms/tiktok-dispatch");
const {
  buildFinalVoiceAudit,
} = require("../lib/studio/v2/final-voice-audit");
const {
  buildSocialPlatformOperationsReport,
  renderSocialPlatformOperationsMarkdown,
} = require("../lib/ops/social-platform-operations");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

async function readTextIfExists(filePath) {
  if (!(await fs.pathExists(filePath))) return "";
  return fs.readFile(filePath, "utf8");
}

async function main() {
  await fs.ensureDir(OUT);
  const db = require("../lib/db");
  const stories = await db.getStories();
  let platformPosts = [];
  try {
    if (db.useSqlite()) {
      platformPosts = db
        .getDb()
        .prepare("SELECT * FROM platform_posts ORDER BY updated_at DESC, id DESC LIMIT 200")
        .all();
    }
  } catch {
    platformPosts = [];
  }

  const platformStatus = buildPlatformStatus({
    stories,
    platformPosts,
    platformConfig: buildPlatformOperationalConfig(process.env),
  });

  let facebookReelsEligibility = null;
  try {
    const fbEvidence = await fetchFacebookReelsEvidence();
    facebookReelsEligibility = buildFacebookReelsEligibilityReport(fbEvidence);
  } catch (err) {
    facebookReelsEligibility = {
      classification: {
        verdict: "blocked",
        reason: `facebook_probe_failed:${err.message}`,
        counts: { videos: 0, reels: 0, posts: 0 },
        page: {},
        green: [],
        warnings: [],
        hardFails: ["facebook_probe_failed"],
      },
    };
  }

  const uploadSource = await readTextIfExists(path.join(ROOT, "upload_tiktok.js"));
  const privacyTestSource = await readTextIfExists(
    path.join(ROOT, "tests", "services", "tiktok-privacy-level.test.js"),
  );
  const browserFallbackSource = await readTextIfExists(
    path.join(ROOT, "tests", "services", "tiktok-browser-fallback.test.js"),
  );
  const tiktokDiagnosis = diagnoseTikTok403({
    uploadSource,
    privacyTestSource,
    browserFallbackSource,
  });

  let tiktokTokenStatus = null;
  try {
    const { inspectTokenStatus } = require("../upload_tiktok");
    tiktokTokenStatus = await inspectTokenStatus();
  } catch (err) {
    tiktokTokenStatus = {
      ok: false,
      reason: `token_status_failed:${err.message}`,
      refresh_available: false,
      needs_reauth: true,
    };
  }

  const finalVoiceAudit = buildFinalVoiceAudit({
    files: stories.filter((story) => story.exported_path).map((story) => story.exported_path),
  });
  const voiceAuditByStoryId = Object.fromEntries(
    finalVoiceAudit.rows.map((row) => [row.story_id, row]),
  );
  const dispatchManifest = buildTikTokDispatchManifest(stories, {
    durationByStoryId: {},
    voiceAuditByStoryId,
  });

  const report = buildSocialPlatformOperationsReport({
    platformStatus,
    facebookReelsEligibility,
    tiktokDiagnosis,
    tiktokTokenStatus,
    dispatchManifest,
  });

  const jsonPath = path.join(OUT, "social_platform_operations.json");
  const mdPath = path.join(OUT, "social_platform_operations.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderSocialPlatformOperationsMarkdown(report), "utf8");
  console.log(`[social-platform-ops] verdict=${report.verdict}`);
  console.log(`[social-platform-ops] json=${path.relative(ROOT, jsonPath)}`);
  console.log(`[social-platform-ops] md=${path.relative(ROOT, mdPath)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[social-platform-ops] FAILED: ${err.message || err}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
