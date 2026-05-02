"use strict";

const path = require("node:path");

function buildTikTokInboxCommandPlan({
  story = {},
  args = {},
  now = new Date().toISOString(),
} = {}) {
  const sendInbox = args.sendInbox === true;
  const mp4Path = args.mp4 || story.exported_path || story.video_path || null;
  const title = story.suggested_title || story.title || args.title || "Untitled TikTok inbox item";
  const storyId = story.id || args.story || (mp4Path ? path.basename(mp4Path, path.extname(mp4Path)) : null);
  const missing = [];
  if (!mp4Path) missing.push("mp4_path_missing");
  if (!storyId) missing.push("story_id_missing");

  return {
    schemaVersion: 1,
    generatedAt: now,
    route: "official_inbox_upload",
    dry_run: !sendInbox,
    will_upload_to_tiktok: sendInbox && missing.length === 0,
    public_auto_publish: false,
    requires_manual_completion: true,
    story_id: storyId,
    title,
    mp4_path: mp4Path,
    status: missing.length
      ? "not_ready"
      : sendInbox
        ? "ready_to_send_to_tiktok_inbox"
        : "dry_run_ready",
    blockers: missing,
    safety: {
      no_public_post: true,
      no_browser_automation: true,
      no_oauth_triggered: true,
      no_token_mutation_by_planning: true,
      operator_must_finish_in_tiktok_app: true,
    },
    next_operator_step: sendInbox
      ? "After upload succeeds, open the TikTok app inbox/drafts and manually review/publish."
      : "Run again with --send-inbox only after TikTok auth is valid and the MP4 is the intended current render.",
  };
}

function renderTikTokInboxCommandMarkdown(plan) {
  const lines = [];
  lines.push("# TikTok Inbox Upload Plan");
  lines.push("");
  lines.push(`Generated: ${plan.generatedAt}`);
  lines.push(`Route: ${plan.route}`);
  lines.push(`Status: ${plan.status}`);
  lines.push(`Dry-run: ${plan.dry_run}`);
  lines.push(`Will upload to TikTok: ${plan.will_upload_to_tiktok}`);
  lines.push(`Public auto-publish: ${plan.public_auto_publish}`);
  lines.push(`Requires manual completion: ${plan.requires_manual_completion}`);
  lines.push("");
  lines.push("## Story");
  lines.push(`- ID: ${plan.story_id || "missing"}`);
  lines.push(`- Title: ${plan.title}`);
  lines.push(`- MP4: ${plan.mp4_path || "missing"}`);
  lines.push("");
  lines.push("## Blockers");
  if (plan.blockers.length) {
    for (const blocker of plan.blockers) lines.push(`- ${blocker}`);
  } else {
    lines.push("- none in command plan");
  }
  lines.push("");
  lines.push("## Safety");
  for (const [key, value] of Object.entries(plan.safety)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Next Step");
  lines.push(`- ${plan.next_operator_step}`);
  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildTikTokInboxCommandPlan,
  renderTikTokInboxCommandMarkdown,
};
