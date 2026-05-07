"use strict";

const {
  buildTikTokDispatchPack,
} = require("./tiktok-dispatch");
const {
  buildTikTokInboxCommandPlan,
} = require("./tiktok-inbox-command");
const {
  evaluateApprovedVoicePath,
} = require("../studio/v2/approved-voice-path");

function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function normaliseDate(value) {
  if (value instanceof Date) return value;
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function mediaFreshnessFromInfo(mediaInfo = null) {
  if (!mediaInfo || typeof mediaInfo !== "object") return null;
  return {
    stale: mediaInfo.stale === true || mediaInfo.is_current_render === false,
    ageHours:
      Number.isFinite(Number(mediaInfo.ageHours))
        ? Number(mediaInfo.ageHours)
        : Number.isFinite(Number(mediaInfo.age_hours))
          ? Number(mediaInfo.age_hours)
          : null,
    lastModifiedIso:
      mediaInfo.lastModifiedIso ||
      mediaInfo.last_modified_iso ||
      mediaInfo.mtime_iso ||
      null,
  };
}

function voiceAuditFromNarration({
  voiceNarration = null,
  voiceAudit = null,
  env = process.env,
  requireExistingAudio = true,
} = {}) {
  if (voiceAudit && typeof voiceAudit === "object") {
    return {
      audit: {
        verdict: voiceAudit.verdict || "review",
        blockers: Array.isArray(voiceAudit.blockers) ? voiceAudit.blockers : [],
        warnings: Array.isArray(voiceAudit.warnings) ? voiceAudit.warnings : [],
      },
      approvedVoicePath: voiceAudit.approvedVoicePath || null,
    };
  }

  if (!voiceNarration || typeof voiceNarration !== "object") {
    return {
      audit: {
        verdict: "review",
        blockers: ["approved_voice_evidence_missing"],
        warnings: [],
      },
      approvedVoicePath: null,
    };
  }

  const approvedVoicePath = evaluateApprovedVoicePath({
    narration: voiceNarration,
    env,
    requireExistingAudio,
  });
  return {
    audit: {
      verdict:
        approvedVoicePath.verdict === "approved_for_studio_v2_proof"
          ? "pass"
          : "review",
      blockers: approvedVoicePath.blockers || [],
      warnings: approvedVoicePath.warnings || [],
    },
    approvedVoicePath,
  };
}

function studioV2PromotionGate(studioV2PromotionPacket = null) {
  if (!studioV2PromotionPacket || typeof studioV2PromotionPacket !== "object") {
    return {
      checked: false,
      verdict: "not_checked",
      blockers: [],
      warnings: [],
      blocks_dispatch: false,
    };
  }

  const verdict = String(studioV2PromotionPacket.verdict || "unknown").toLowerCase();
  const packetBlockers = Array.isArray(studioV2PromotionPacket.blockers)
    ? studioV2PromotionPacket.blockers
    : [];
  const packetWarnings = Array.isArray(studioV2PromotionPacket.warnings)
    ? studioV2PromotionPacket.warnings
    : [];
  const blockers = [];

  if (verdict && verdict !== "amber_local_proof") {
    blockers.push(`studio_v2_promotion_${verdict}`);
  }
  blockers.push(...packetBlockers);

  return {
    checked: true,
    verdict,
    blockers: unique(blockers),
    warnings: unique(packetWarnings),
    blocks_dispatch: blockers.length > 0,
  };
}

function forceLocalDryRunInboxPlan(plan, dispatchPack) {
  const dispatchBlockers =
    dispatchPack.status === "ready_for_operator_review"
      ? []
      : [`dispatch_pack_${dispatchPack.status}`];
  const creativeBlockers =
    dispatchPack.creativeGate?.blocks_dispatch === true
      ? dispatchPack.creativeGate.blockers || []
      : [];
  const blockers = unique([...(plan.blockers || []), ...dispatchBlockers, ...creativeBlockers]);
  return {
    ...plan,
    dry_run: true,
    will_upload_to_tiktok: false,
    public_auto_publish: false,
    requires_manual_completion: true,
    status: blockers.length ? "not_ready" : "dry_run_ready",
    blockers,
    completion_state: "dry_run_only",
    next_operator_step:
      "This fresh pack is local dry-run only. Visually review the MP4 and cover, then use the separate TikTok inbox upload command only after explicit operator approval.",
  };
}

function buildFreshTikTokDispatchPack({
  story = {},
  mp4Path = null,
  coverPath = null,
  durationSeconds = null,
  mediaInfo = null,
  voiceNarration = null,
  voiceAudit = null,
  tiktokTokenStatus = null,
  studioV2PromotionPacket = null,
  now = new Date(),
  env = process.env,
  requireExistingAudio = true,
} = {}) {
  const generatedAtDate = normaliseDate(now);
  const localStory = {
    ...story,
    id: story.id || story.story_id || null,
    title: story.title || story.suggested_title || "Pulse Gaming TikTok dispatch",
    exported_path: mp4Path || story.exported_path || story.video_path || null,
    thumbnail_candidate_path:
      coverPath ||
      story.thumbnail_candidate_path ||
      story.hf_thumbnail_path ||
      story.story_image_path ||
      story.image_path ||
      null,
  };
  const { audit, approvedVoicePath } = voiceAuditFromNarration({
    voiceNarration,
    voiceAudit,
    env,
    requireExistingAudio,
  });

  const dispatchPack = buildTikTokDispatchPack(localStory, {
    durationSeconds,
    now: generatedAtDate,
    voiceAudit: audit,
    renderFreshness: mediaFreshnessFromInfo(mediaInfo),
    tiktokTokenStatus,
    env,
  });
  const creativeGate = studioV2PromotionGate(studioV2PromotionPacket);
  dispatchPack.creativeGate = creativeGate;
  if (creativeGate.blocks_dispatch) {
    dispatchPack.status = "creative_review_required";
  }

  dispatchPack.schedulerReadyJson = {
    ...dispatchPack.schedulerReadyJson,
    auto_publish: false,
    notes:
      "Disabled for fresh local dispatch packs. Use official inbox/manual review only.",
  };
  if (dispatchPack.status !== "ready_for_operator_review") {
    dispatchPack.officialInboxJson = {
      ...dispatchPack.officialInboxJson,
      ready_for_upload: false,
    };
  }

  const inboxPlan = forceLocalDryRunInboxPlan(
    buildTikTokInboxCommandPlan({
      story: localStory,
      args: {
        story: localStory.id,
        mp4: localStory.exported_path,
        title: localStory.title,
        sendInbox: false,
        allowStale: false,
      },
      mediaInfo,
      tiktokStatus: dispatchPack.tiktokTokenGate,
      now: generatedAtDate.toISOString(),
    }),
    dispatchPack,
  );

  const creativeReviewBlockers = unique([
    ...(creativeGate.blocks_dispatch ? creativeGate.blockers : []),
  ]);

  return {
    schemaVersion: 1,
    generatedAt: generatedAtDate.toISOString(),
    story: {
      id: localStory.id,
      title: localStory.title,
    },
    dispatchPack,
    inboxPlan,
    approvedVoicePath,
    mediaInfo,
    creativeReview: {
      operator_visual_review_required: true,
      studio_v2_promotion_gate: creativeGate,
      blockers: creativeReviewBlockers,
      reason:
        creativeReviewBlockers.length
          ? "Fresh dispatch pack is blocked because the Studio V2 promotion packet still has visual or forensic blockers."
          : "Fresh dispatch packs prove routing and asset readiness only; the final MP4/cover still need human visual approval before upload.",
    },
    safety: {
      local_dry_run_only: true,
      live_upload_executed: false,
      public_post_created: false,
      browser_automation_used: false,
      oauth_triggered: false,
      token_mutated: false,
      production_db_mutated: false,
      railway_mutated: false,
    },
  };
}

function renderFreshTikTokDispatchMarkdown(result) {
  const pack = result.dispatchPack;
  const plan = result.inboxPlan;
  const lines = [];
  lines.push("# Fresh TikTok Dispatch Pack");
  lines.push("");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Story: ${result.story.id || "unknown"}`);
  lines.push(`Title: ${result.story.title}`);
  lines.push(`Status: ${pack.status}`);
  lines.push(`Duration: ${pack.eligibility.durationSeconds ?? "unknown"}s`);
  lines.push(`Creator Rewards length: ${pack.eligibility.creatorRewardsLengthEligible}`);
  lines.push(`MP4: ${pack.mp4 || "missing"}`);
  lines.push(`Cover: ${pack.cover || "missing"}`);
  lines.push("");
  lines.push("## Voice Gate");
  lines.push(`- Verdict: ${pack.voiceGate?.verdict || "missing"}`);
  lines.push(`- Blockers: ${pack.voiceGate?.blockers?.join(", ") || "clear"}`);
  lines.push(`- Warnings: ${pack.voiceGate?.warnings?.join(", ") || "none"}`);
  if (result.approvedVoicePath?.audio_path) {
    lines.push(`- Audio proof: ${result.approvedVoicePath.audio_path}`);
  }
  lines.push("");
  lines.push("## TikTok Inbox Plan");
  lines.push(`- Plan status: ${plan.status}`);
  lines.push(`- Will upload to TikTok: ${plan.will_upload_to_tiktok}`);
  lines.push(`- Public auto-publish: ${plan.public_auto_publish}`);
  lines.push(`- Requires manual completion: ${plan.requires_manual_completion}`);
  lines.push(`- Blockers: ${plan.blockers.join(", ") || "none"}`);
  lines.push(`- Next step: ${plan.next_operator_step}`);
  lines.push("");
  lines.push("## Creative Review");
  lines.push("- Operator visual review required before any inbox upload.");
  if (result.creativeReview.blockers?.length) {
    lines.push(`- Blockers: ${result.creativeReview.blockers.join(", ")}`);
  }
  lines.push(`- Reason: ${result.creativeReview.reason}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("- No public post is created.");
  lines.push("- No OAuth flow is started.");
  lines.push("- No token, Railway env var, production DB or scheduler value is mutated.");
  lines.push("- No browser automation is used.");
  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildFreshTikTokDispatchPack,
  mediaFreshnessFromInfo,
  renderFreshTikTokDispatchMarkdown,
  studioV2PromotionGate,
  voiceAuditFromNarration,
};
