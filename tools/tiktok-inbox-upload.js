"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const dotenv = require("dotenv");
const db = require("../lib/db");
const { uploadVideoToInbox } = require("../upload_tiktok");
const {
  buildTikTokInboxCommandPlan,
  renderTikTokInboxCommandMarkdown,
} = require("../lib/platforms/tiktok-inbox-command");

dotenv.config({ override: true });

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
    else if (arg === "--send-inbox" || arg === "--apply-inbox") args.sendInbox = true;
    else if (arg === "--dry-run") args.sendInbox = false;
  }
  return args;
}

async function loadStory(args) {
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
  return (
    stories.find((story) => story.approved && story.exported_path && !story.tiktok_post_id) ||
    stories.find((story) => story.exported_path) ||
    {}
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(args.outDir || OUT);
  await fs.ensureDir(outDir);

  const story = await loadStory(args);
  const plan = buildTikTokInboxCommandPlan({ story, args });

  let result = null;
  if (plan.will_upload_to_tiktok) {
    result = await uploadVideoToInbox(story);
  }

  const payload = { ...plan, result };
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
