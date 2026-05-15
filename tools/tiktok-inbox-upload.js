"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ override: true });

const db = require("../lib/db");
const mediaPaths = require("../lib/media-paths");
const { uploadVideoToInbox, fetchPublishStatus } = require("../upload_tiktok");
const {
  buildTikTokInboxCommandPlan,
  renderTikTokInboxCommandMarkdown,
} = require("../lib/platforms/tiktok-inbox-command");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--story") args.story = argv[++i];
    else if (arg === "--mp4") args.mp4 = argv[++i];
    else if (arg === "--title") args.title = argv[++i];
    else if (arg === "--out-dir") args.outDir = argv[++i];
    else if (arg === "--max-age-hours") args.maxAgeHours = Number(argv[++i]);
    else if (arg === "--allow-stale") args.allowStale = true;
    else if (arg === "--publish-id") args.publishId = argv[++i];
    else if (arg === "--send-inbox" || arg === "--apply-inbox") args.sendInbox = true;
    else if (arg === "--operator-confirmed") args.operatorConfirmed = true;
    else if (arg === "--dry-run") args.sendInbox = false;
  }
  args.statusOnly = Boolean(args.publishId) && args.sendInbox !== true;
  args.explicitSelection = Boolean(args.story || args.mp4 || args.publishId);
  return args;
}

async function loadStory(args) {
  if (args.statusOnly) {
    if (args.story) {
      const story = await db.getStory(args.story);
      if (story) {
        if (args.mp4) story.exported_path = args.mp4;
        if (args.title) story.title = args.title;
        return story;
      }
    }
    return {
      id: args.story || null,
      title: args.title || "TikTok inbox status check",
      exported_path: args.mp4 || null,
    };
  }
  if (args.story) {
    const story = await db.getStory(args.story);
    if (!story) {
      return {
        id: args.story,
        title: args.title || args.story,
        exported_path: args.mp4 || null,
      };
    }
    if (args.mp4) story.exported_path = args.mp4;
    if (args.title) story.title = args.title;
    return story;
  }
  if (args.mp4) {
    return {
      id: path.basename(args.mp4, path.extname(args.mp4)),
      title: args.title || path.basename(args.mp4),
      exported_path: args.mp4,
    };
  }
  const stories = await db.getStories();
  args.autoSelected = true;
  return (
    stories.find((story) => story.approved && story.exported_path && !story.tiktok_post_id) ||
    stories.find((story) => story.exported_path) ||
    {}
  );
}

async function inspectMp4ForInbox(mp4Path, args = {}) {
  if (!mp4Path) return null;
  const maxAgeHours =
    Number.isFinite(args.maxAgeHours) && args.maxAgeHours > 0
      ? args.maxAgeHours
      : 36;
  const resolved = await mediaPaths.resolveExisting(mp4Path);
  if (!resolved || !(await fs.pathExists(resolved))) {
    return {
      exists: false,
      absolute_path: resolved || null,
      max_age_hours: maxAgeHours,
      is_current_render: false,
      reason: "mp4_missing_on_disk",
    };
  }
  const stat = await fs.stat(resolved);
  const ageHours = Math.max(0, (Date.now() - stat.mtimeMs) / 3_600_000);
  const isCurrent = ageHours <= maxAgeHours || args.allowStale === true;
  return {
    exists: true,
    absolute_path: resolved,
    size_bytes: stat.size,
    mtime_iso: stat.mtime.toISOString(),
    age_hours: ageHours,
    max_age_hours: maxAgeHours,
    allow_stale: args.allowStale === true,
    is_current_render: isCurrent,
    reason: isCurrent ? "current_render_window_ok" : "stale_or_unverified_mp4",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(args.outDir || OUT);
  await fs.ensureDir(outDir);

  const story = await loadStory(args);
  const mediaInfo = await inspectMp4ForInbox(
    args.mp4 || story.exported_path || story.video_path || null,
    args,
  );
  const plan = buildTikTokInboxCommandPlan({ story, args, mediaInfo });

  let result = null;
  let tiktokStatus = null;
  if (args.statusOnly && args.publishId) {
    tiktokStatus = await fetchPublishStatus(args.publishId);
  } else if (plan.will_upload_to_tiktok) {
    if (args.operatorConfirmed !== true) {
      throw new Error("tiktok_inbox_upload_requires_operator_confirmed_flag");
    }
    process.env.TIKTOK_ENABLED = "true";
    process.env.TIKTOK_AUTO_UPLOAD_ENABLED = "true";
    result = await uploadVideoToInbox(story);
    if (result?.publishId) {
      try {
        tiktokStatus = await fetchPublishStatus(result.publishId);
      } catch (err) {
        tiktokStatus = {
          ok: false,
          status: null,
          raw_error_code: "status_fetch_failed",
          raw_error_message: err.message || String(err),
        };
      }
    }
  }

  const payload = {
    ...buildTikTokInboxCommandPlan({ story, args, result, tiktokStatus, mediaInfo }),
    result,
  };
  const jsonPath = path.join(outDir, "tiktok_inbox_upload_plan.json");
  const mdPath = path.join(outDir, "tiktok_inbox_upload_plan.md");
  await fs.writeJson(jsonPath, payload, { spaces: 2 });
  await fs.writeFile(mdPath, renderTikTokInboxCommandMarkdown(payload), "utf8");
  console.log(`[tiktok-inbox] status=${payload.status} dry_run=${payload.dry_run} will_upload=${payload.will_upload_to_tiktok}`);
  console.log(`[tiktok-inbox] json=${path.relative(ROOT, jsonPath)}`);
  console.log(`[tiktok-inbox] md=${path.relative(ROOT, mdPath)}`);
  if (result) console.log(`[tiktok-inbox] publish_id=${result.publishId}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  });
}

module.exports = {
  inspectMp4ForInbox,
  main,
  parseArgs,
};
