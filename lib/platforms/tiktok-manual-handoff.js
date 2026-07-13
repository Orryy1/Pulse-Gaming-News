"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fsExtra = require("fs-extra");

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanList(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(cleanText).filter(Boolean))];
}

function buildTikTokManualHandoff({
  action = {},
  publishPack = {},
  contentPostingApiStatus = "permission_unavailable",
  assetEvidence = {},
  now = new Date(),
} = {}) {
  const storyId = cleanText(action.story_id);
  const durationSeconds = Number(action.video_duration_s);
  const caption = cleanText(publishPack.caption || action.caption);
  const hashtags = cleanList(publishPack.hashtags);
  const blockers = cleanList(action.blockers);

  if (!storyId) blockers.push("story_id_missing");
  if (cleanText(action.platform) !== "tiktok") blockers.push("not_a_tiktok_action");
  if (!cleanText(action.video_path)) blockers.push("video_path_missing");
  if (assetEvidence.video_exists !== true) blockers.push("video_not_on_disk");
  if (!cleanText(action.captions_path)) blockers.push("captions_path_missing");
  if (assetEvidence.captions_exist !== true) blockers.push("captions_not_on_disk");
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    blockers.push("duration_unknown");
  }
  if (!caption) blockers.push("governed_caption_missing");
  if (!hashtags.length) blockers.push("governed_hashtags_missing");
  if (!cleanText(publishPack.disclosure_flag)) blockers.push("disclosure_status_missing");

  const uniqueBlockers = cleanList(blockers);
  const creatorRewardsEligible =
    Number.isFinite(durationSeconds) && durationSeconds > 60 && durationSeconds <= 90;

  return {
    schema_version: "pulse-tiktok-manual-handoff-v1",
    generated_at: new Date(now).toISOString(),
    story_id: storyId || null,
    title: cleanText(action.title) || null,
    status: uniqueBlockers.length
      ? "blocked_before_operator_upload"
      : "ready_for_operator_upload",
    blockers: uniqueBlockers,
    route: "tiktok_studio_web_or_mobile",
    media: {
      video_path: cleanText(action.video_path) || null,
      captions_path: cleanText(action.captions_path) || null,
      cover_source: cleanText(action.cover_frame_source) || cleanText(action.video_path) || null,
      duration_seconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
    },
    copy: {
      hook: cleanText(publishPack.conversational_hook) || null,
      caption,
      hashtags,
      paste_block: [caption, hashtags.join(" ")].filter(Boolean).join("\n\n"),
    },
    disclosure: {
      disclosure_flag: cleanText(publishPack.disclosure_flag) || null,
      commercial_content_setting_recommendation:
        cleanText(publishPack.commercial_content_setting_recommendation) || null,
      action_requirements: action.disclosure_requirements || {},
    },
    creator_rewards: {
      eligible: creatorRewardsEligible,
      rule: "original_high_quality_video_longer_than_one_minute",
      recommended_window_seconds: { min: 61, max: 90 },
    },
    operator_steps: [
      "Open TikTok Studio on the web or the TikTok mobile app.",
      "Upload the governed video file and select the supplied cover source.",
      "Paste the governed caption and hashtags without rewriting factual claims.",
      "Apply the stated AI and commercial-content disclosure settings.",
      "Run TikTok's sound copyright check, then schedule or publish after final preview.",
      "Record the public post ID and URL in the completion receipt.",
    ],
    completion_receipt: {
      story_id: storyId || null,
      status: "pending_operator_upload",
      external_id: null,
      external_url: null,
      completed_at: null,
      operator: null,
      notes: null,
    },
    platform_control: {
      platform_state: "deferred_operator_handoff",
      auto_publish_enabled: false,
      content_posting_api_status: cleanText(contentPostingApiStatus) || "unknown",
      direct_post_attempted: false,
    },
    safety: {
      posts_to_tiktok: false,
      mutates_oauth_or_tokens: false,
      mutates_production_db: false,
      marks_platform_auto_enabled: false,
    },
  };
}

async function sha256File(filePath, fs = fsExtra) {
  if (!filePath || !(await fs.pathExists(filePath))) return null;
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

function renderTikTokManualHandoffMarkdown(report = {}) {
  const lines = [
    "# TikTok Operator Handoff",
    "",
    `Generated: ${report.generated_at}`,
    `Content Posting API: ${report.content_posting_api_status}`,
    `Ready: ${report.summary?.ready || 0}`,
    `Blocked: ${report.summary?.blocked || 0}`,
    "",
    "TikTok remains deferred from automatic publishing. These packs are for TikTok Studio or mobile upload only.",
    "",
  ];
  for (const item of report.items || []) {
    lines.push(`## ${item.title || item.story_id}`);
    lines.push("");
    lines.push(`- Story ID: ${item.story_id}`);
    lines.push(`- Status: ${item.status}`);
    lines.push(`- Video: ${item.media?.video_path || "missing"}`);
    lines.push(`- Captions: ${item.media?.captions_path || "missing"}`);
    lines.push(`- Duration: ${item.media?.duration_seconds ?? "unknown"}s`);
    lines.push(`- Creator Rewards eligible: ${item.creator_rewards?.eligible === true}`);
    lines.push(`- Disclosure: ${item.disclosure?.disclosure_flag || "unresolved"}`);
    if (item.blockers?.length) lines.push(`- Blockers: ${item.blockers.join(", ")}`);
    lines.push("");
    lines.push("### Caption");
    lines.push("");
    lines.push(item.copy?.paste_block || "(missing)");
    lines.push("");
    lines.push("### Upload Checklist");
    lines.push("");
    for (const step of item.operator_steps || []) lines.push(`- ${step}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function writeTikTokManualHandoff({
  planPath,
  outDir,
  storyId = null,
  contentPostingApiStatus = "permission_unavailable",
  now = new Date(),
  fs = fsExtra,
} = {}) {
  if (!planPath || !(await fs.pathExists(planPath))) {
    throw new Error(`TikTok dry-run plan not found: ${planPath || "(missing)"}`);
  }
  if (!outDir) throw new Error("TikTok manual handoff output directory is required");

  const plan = await fs.readJson(planPath);
  const actions = (Array.isArray(plan.actions) ? plan.actions : []).filter(
    (action) =>
      cleanText(action.platform) === "tiktok" &&
      (!storyId || cleanText(action.story_id) === cleanText(storyId)),
  );
  const items = [];
  for (const action of actions) {
    const artifactDir = action.canonical_manifest_path
      ? path.dirname(action.canonical_manifest_path)
      : path.dirname(action.video_path || planPath);
    const publishPackPath = path.join(artifactDir, "tiktok_publish_pack.json");
    const publishPack = (await fs.pathExists(publishPackPath))
      ? await fs.readJson(publishPackPath)
      : {};
    const item = buildTikTokManualHandoff({
      action,
      publishPack,
      contentPostingApiStatus,
      assetEvidence: {
        video_exists: Boolean(action.video_path && (await fs.pathExists(action.video_path))),
        captions_exist: Boolean(
          action.captions_path && (await fs.pathExists(action.captions_path)),
        ),
      },
      now,
    });
    item.evidence = {
      dry_run_plan_path: path.resolve(planPath),
      artifact_dir: artifactDir,
      tiktok_publish_pack_path: (await fs.pathExists(publishPackPath))
        ? publishPackPath
        : null,
    };
    item.fingerprints = {
      video_sha256: await sha256File(action.video_path, fs),
      captions_sha256: await sha256File(action.captions_path, fs),
    };
    items.push(item);
  }

  const report = {
    schema_version: "pulse-tiktok-manual-handoff-report-v1",
    generated_at: new Date(now).toISOString(),
    route: "tiktok_studio_web_or_mobile",
    content_posting_api_status: cleanText(contentPostingApiStatus) || "unknown",
    platform_state: "deferred_operator_handoff",
    summary: {
      total: items.length,
      ready: items.filter((item) => item.status === "ready_for_operator_upload").length,
      blocked: items.filter((item) => item.status !== "ready_for_operator_upload").length,
      creator_rewards_eligible: items.filter((item) => item.creator_rewards?.eligible === true)
        .length,
    },
    items,
    safety: {
      network_uploads: 0,
      auto_publish_enabled: false,
      credentials_changed: false,
      production_db_mutations: 0,
    },
  };

  await fs.ensureDir(outDir);
  const paths = {
    json: path.join(outDir, "tiktok_manual_handoff.json"),
    markdown: path.join(outDir, "tiktok_manual_handoff.md"),
    caption: path.join(outDir, "tiktok_manual_caption.txt"),
    receipt: path.join(outDir, "tiktok_manual_completion_receipt.json"),
    creatorRewardsWorkOrder: path.join(
      outDir,
      "tiktok_creator_rewards_manual_work_order.json",
    ),
  };
  const firstReady = items.find((item) => item.status === "ready_for_operator_upload");
  await fs.writeJson(paths.json, report, { spaces: 2 });
  await fs.writeFile(paths.markdown, renderTikTokManualHandoffMarkdown(report), "utf8");
  await fs.writeFile(paths.caption, `${firstReady?.copy?.paste_block || ""}\n`, "utf8");
  await fs.writeJson(
    paths.receipt,
    {
      schema_version: "pulse-tiktok-manual-receipt-v1",
      receipts: items.map((item) => item.completion_receipt),
      instructions:
        "Complete only after TikTok confirms the public post. This file does not update production state by itself.",
    },
    { spaces: 2 },
  );
  await fs.writeJson(
    paths.creatorRewardsWorkOrder,
    {
      schema_version: 1,
      generated_at: report.generated_at,
      mode: "TIKTOK_CREATOR_REWARDS_VARIANT_WORK_ORDER",
      jobs: items
        .filter(
          (item) =>
            item.status === "ready_for_operator_upload" &&
            item.creator_rewards?.eligible !== true &&
            Number(item.media?.duration_seconds) > 0 &&
            Number(item.media?.duration_seconds) <= 60,
        )
        .map((item) => ({
          story_id: item.story_id,
          title: item.title,
          artifact_dir: item.evidence?.artifact_dir,
          readiness_scope: "operator_handoff",
          status: "needs_tiktok_creator_rewards_variant",
          platform: "tiktok",
          current_duration_s: item.media.duration_seconds,
          target_duration_seconds: { min: 61, max: 75 },
          publish_gate:
            "do_not_count_tiktok_creator_rewards_ready_until_long_variant_audio_render_captions_and_preflight_pass",
        })),
      safety: {
        no_publish_triggered: true,
        no_network_uploads: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
        no_gate_weakened: true,
      },
    },
    { spaces: 2 },
  );
  return { report, paths };
}

module.exports = {
  buildTikTokManualHandoff,
  renderTikTokManualHandoffMarkdown,
  writeTikTokManualHandoff,
};
