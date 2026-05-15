"use strict";

const path = require("node:path");

function buildTikTokInboxCommandPlan({
  story = {},
  args = {},
  result = null,
  tiktokStatus = null,
  mediaInfo = null,
  now = new Date().toISOString(),
} = {}) {
  const sendInbox = args.sendInbox === true;
  const mp4Path = args.mp4 || story.exported_path || story.video_path || null;
  const title = story.suggested_title || story.title || args.title || "Untitled TikTok inbox item";
  const storyId = story.id || args.story || (mp4Path ? path.basename(mp4Path, path.extname(mp4Path)) : null);
  const statusOnly = Boolean(args.publishId) && !sendInbox;
  const missing = [];
  if (!statusOnly) {
    if (!mp4Path) missing.push("mp4_path_missing");
    if (!storyId) missing.push("story_id_missing");
  }
  const blockers = missing.slice();
  const warnings = [];
  if (sendInbox && args.autoSelected === true) {
    blockers.push("explicit_story_or_mp4_required");
  }
  if (mediaInfo) {
    if (mediaInfo.exists === false) {
      blockers.push("mp4_missing_on_disk");
    }
    if (mediaInfo.is_current_render === false) {
      const staleReason = mediaInfo.reason || "stale_or_unverified_mp4";
      if (args.allowStale === true) warnings.push(staleReason);
      else blockers.push(staleReason);
    }
  }

  const publishId = result?.publishId || result?.publish_id || args.publishId || null;
  const statusValue = tiktokStatus?.status || result?.status || null;
  const completionState =
    statusValue === "SEND_TO_USER_INBOX"
      ? "sent_to_user_inbox"
      : publishId
        ? "uploaded_status_unknown"
        : sendInbox
          ? blockers.length
            ? "blocked_before_upload"
            : "pending_upload"
          : "dry_run_only";
  const discordSummary = publishId
    ? [
        `TikTok Inbox OK ${storyId || "unknown story"}`,
        `Status: ${statusValue || "unknown"}`,
        `Publish ID: ${publishId}`,
        "Manual action: open TikTok inbox/drafts, review the post and publish or discard it.",
        "Public auto-post: false",
      ].join("\n")
    : null;

  return {
    schemaVersion: 1,
    generatedAt: now,
    route: "official_inbox_upload",
    status_only: statusOnly,
    dry_run: !sendInbox,
    will_upload_to_tiktok: sendInbox && blockers.length === 0,
    public_auto_publish: false,
    requires_manual_completion: true,
    story_id: storyId,
    title,
    mp4_path: mp4Path,
    media_info: mediaInfo,
    publish_id: publishId,
    tiktok_status: tiktokStatus || (statusValue ? { status: statusValue } : null),
    completion_state: completionState,
    discord_summary: discordSummary,
    status: statusOnly
      ? "status_checked"
      : blockers.length
      ? "not_ready"
      : sendInbox
        ? "ready_to_send_to_tiktok_inbox"
        : "dry_run_ready",
    blockers,
    warnings,
    safety: {
      no_public_post: true,
      no_browser_automation: true,
      no_oauth_triggered: true,
      no_token_mutation_by_planning: true,
      operator_must_finish_in_tiktok_app: true,
    },
    next_operator_step: statusOnly
      ? "If TikTok Status is SEND_TO_USER_INBOX, open TikTok inbox/drafts, review the post and publish or discard it."
      : sendInbox
      ? blockers.length
        ? "Resolve the blockers, then rerun with an explicit --story or --mp4 for the intended current render."
        : "After upload succeeds, open the TikTok app inbox/drafts and manually review/publish."
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
  lines.push(`Status-only: ${plan.status_only === true}`);
  lines.push(`Dry-run: ${plan.dry_run}`);
  lines.push(`Will upload to TikTok: ${plan.will_upload_to_tiktok}`);
  lines.push(`Public auto-publish: ${plan.public_auto_publish}`);
  lines.push(`Requires manual completion: ${plan.requires_manual_completion}`);
  if (plan.publish_id) lines.push(`Publish ID: ${plan.publish_id}`);
  if (plan.tiktok_status?.status) lines.push(`TikTok Status: ${plan.tiktok_status.status}`);
  if (plan.completion_state) lines.push(`Completion state: ${plan.completion_state}`);
  lines.push("");
  lines.push("## Story");
  lines.push(`- ID: ${plan.story_id || "missing"}`);
  lines.push(`- Title: ${plan.title}`);
  lines.push(`- MP4: ${plan.mp4_path || "missing"}`);
  if (plan.media_info) {
    lines.push("");
    lines.push("## Media Safety");
    lines.push(`- Exists: ${plan.media_info.exists === true}`);
    if (plan.media_info.absolute_path) lines.push(`- Resolved path: ${plan.media_info.absolute_path}`);
    if (plan.media_info.mtime_iso) lines.push(`- Modified: ${plan.media_info.mtime_iso}`);
    if (Number.isFinite(Number(plan.media_info.age_hours))) {
      lines.push(`- Age hours: ${Number(plan.media_info.age_hours).toFixed(2)}`);
    }
    if (Number.isFinite(Number(plan.media_info.max_age_hours))) {
      lines.push(`- Max age hours: ${Number(plan.media_info.max_age_hours).toFixed(2)}`);
    }
    lines.push(`- Current render: ${plan.media_info.is_current_render === true}`);
    if (plan.media_info.reason) lines.push(`- Reason: ${plan.media_info.reason}`);
  }
  lines.push("");
  lines.push("## Blockers");
  if (plan.blockers.length) {
    for (const blocker of plan.blockers) lines.push(`- ${blocker}`);
  } else {
    lines.push("- none in command plan");
  }
  if (plan.warnings?.length) {
    lines.push("");
    lines.push("## Warnings");
    for (const warning of plan.warnings) lines.push(`- ${warning}`);
  }
  lines.push("");
  lines.push("## Safety");
  for (const [key, value] of Object.entries(plan.safety)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Next Step");
  lines.push(`- ${plan.next_operator_step}`);
  if (plan.discord_summary) {
    lines.push("");
    lines.push("## Discord Summary");
    lines.push("```text");
    lines.push(plan.discord_summary);
    lines.push("```");
  }
  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildTikTokInboxCommandPlan,
  renderTikTokInboxCommandMarkdown,
};
