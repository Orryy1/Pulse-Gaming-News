"use strict";

function upper(value) {
  return String(value || "unknown").trim().toUpperCase();
}

function lower(value) {
  return String(value || "").trim().toLowerCase();
}

function bool(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value || ""));
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function platformState(socialOps = {}, platform) {
  return socialOps.platforms?.[platform]?.state || "unknown";
}

function tiktokTokenStatus(platformDoctor = {}, socialOps = {}) {
  return (
    platformDoctor.platforms?.tiktok?.token ||
    socialOps.platforms?.tiktok?.token ||
    null
  );
}

function tiktokRouteStatus(platformDoctor = {}, socialOps = {}) {
  const doctorRoute = platformDoctor.platforms?.tiktok?.official_inbox_route;
  if (doctorRoute) return doctorRoute;
  const routes = array(socialOps.platforms?.tiktok?.safeRoutes);
  return routes.find((route) => route.id === "official_inbox_upload")?.status || "unknown";
}

function summarizeProofCandidates(proofCandidates = {}) {
  const candidates = array(proofCandidates.candidates);
  const ready = candidates.filter((candidate) => candidate.verdict === "ready_flash_proof");
  const localVoiceReady = candidates.filter((candidate) => candidate.audio?.ready === true);
  const mediaRepairFirst = candidates.filter(
    (candidate) => candidate.proof_readiness?.final_recommendation === "repair_media_first",
  );
  const voiceRepairFirst = candidates.filter(
    (candidate) => candidate.proof_readiness?.final_recommendation === "repair_voice_first",
  );
  const closest = candidates
    .slice()
    .sort((a, b) => {
      const aScore =
        Number(a.audio?.ready === true) * 100 +
        Number(a.visuals?.exact_subject_count || 0) +
        Number(a.visuals?.validated_clip_ref_count || 0);
      const bScore =
        Number(b.audio?.ready === true) * 100 +
        Number(b.visuals?.exact_subject_count || 0) +
        Number(b.visuals?.validated_clip_ref_count || 0);
      return bScore - aScore;
    })
    .slice(0, 5)
    .map((candidate) => ({
      story_id: candidate.story_id,
      title: candidate.title,
      verdict: candidate.verdict,
      next_action: candidate.next_action,
      audio_ready: candidate.audio?.ready === true,
      duration_seconds: candidate.audio?.duration_seconds || null,
      exact_subject_count: candidate.visuals?.exact_subject_count || 0,
      validated_clip_refs: candidate.visuals?.validated_clip_ref_count || 0,
      validated_clip_sources: candidate.visuals?.validated_clip_source_count || 0,
      blockers: array(candidate.blockers).slice(0, 5),
    }));

  return {
    ready_flash_proof_count: ready.length,
    local_voice_ready_count: localVoiceReady.length,
    repair_media_first_count: mediaRepairFirst.length,
    repair_voice_first_count: voiceRepairFirst.length,
    closest_candidates: closest,
  };
}

function buildLocalResumePlan({
  generatedAt = new Date().toISOString(),
  localPostingReadiness = {},
  platformDoctor = {},
  socialOps = {},
  proofCandidates = {},
  ttsReport = {},
} = {}) {
  const blockers = [];
  const warnings = [];
  const approvalQueue = [];
  const nextActions = [];

  const localVerdict = lower(localPostingReadiness.verdict);
  const localReady = localVerdict === "green";
  const localBlockers = array(localPostingReadiness.blockers);
  const duplicateControlKeys = array(localPostingReadiness.readiness?.duplicate_control_keys);
  const ttsGreen = lower(ttsReport.verdict) === "green" || localPostingReadiness.readiness?.local_tts_green === true;
  const proofSummary = summarizeProofCandidates(proofCandidates);

  if (!localReady) {
    blockers.push(...localBlockers);
    if (!localBlockers.length) blockers.push(`local posting readiness is ${localVerdict || "unknown"}, not green`);
  }
  if (duplicateControlKeys.length) {
    blockers.push(`duplicate local control switches in .env: ${duplicateControlKeys.join(", ")}`);
  }
  if (!ttsGreen) blockers.push("local Liam TTS is not green");

  const youtube = platformState(socialOps, "youtube");
  const instagram = platformState(socialOps, "instagram_reel");
  const facebook = platformState(socialOps, "facebook_reel");
  const tiktok = platformState(socialOps, "tiktok");
  const token = tiktokTokenStatus(platformDoctor, socialOps);
  const tiktokRoute = tiktokRouteStatus(platformDoctor, socialOps);

  const corePlatformReady =
    youtube === "working" &&
    (instagram === "working" || instagram === "review" || platformDoctor.platforms?.instagram_reel?.status === "enabled_monitor_next_publish") &&
    (facebook === "working" || platformDoctor.platforms?.facebook_reel?.status === "enabled_verify_after_upload");

  if (youtube !== "working") blockers.push(`YouTube is not marked working (${youtube})`);
  if (instagram !== "working" && platformDoctor.platforms?.instagram_reel?.status !== "enabled_monitor_next_publish") {
    warnings.push(`Instagram Reels needs monitoring or repair (${instagram})`);
  }
  if (facebook !== "working" && platformDoctor.platforms?.facebook_reel?.status !== "enabled_verify_after_upload") {
    warnings.push(`Facebook Reels is not proven automated-ready (${facebook})`);
  }
  if (tiktok !== "working" || token?.ok !== true) {
    warnings.push("TikTok is not a blocker for resuming YouTube/Instagram/Facebook, but automated TikTok remains blocked.");
  }

  if (proofSummary.ready_flash_proof_count < 1) {
    warnings.push("No Studio V2 Flash proof candidate is ready; resume posting should use the safer legacy/standard lane until media repair catches up.");
  }

  const canResumeLocalAutomaticPosting =
    localReady && corePlatformReady && ttsGreen && duplicateControlKeys.length === 0;
  const verdict = canResumeLocalAutomaticPosting ? "green" : blockers.length ? "amber" : "amber";
  const status = canResumeLocalAutomaticPosting
    ? "ready_to_resume_local_automatic_posting"
    : "local_resume_blocked_but_recoverable";

  nextActions.push("Keep Railway standby only; do not restore Railway as the active publisher.");
  nextActions.push("Keep building local Liam; treat ElevenLabs as a temporary bridge only while local voice coverage improves.");
  if (!localReady) {
    nextActions.push("Resolve local cutover blockers in order: duplicate .env switches, Cloudflare tunnel, public health, primary flag, queue flag, AUTO_PUBLISH flag.");
  }
  nextActions.push("Resume with the safe standard/legacy lane first; do not switch Studio V2 into production until a promotion packet is green.");
  nextActions.push("Use TikTok dispatch/inbox tooling only after token refresh/sync and creative-review blocker are resolved; do not rely on Railway.");
  nextActions.push("Keep Facebook Reels enabled behind verifier checks because manual Page UI proof succeeded.");

  approvalQueue.push({
    decision: "local_primary_cutover",
    why: "Needed before this PC can become the active low-cost publisher.",
    change: "Enable local primary, local job queue and AUTO_PUBLISH after public health is green.",
    risk: "If enabled too early, jobs can fail or publish from an unreachable/stale local instance.",
    rollback: "Set PULSE_PRIMARY_INSTANCE=false, USE_JOB_QUEUE=false and AUTO_PUBLISH=false, then restart local server.",
    recommendation: localReady ? "approve_when_ready" : "wait_until_local_resume_plan_is_green",
  });
  approvalQueue.push({
    decision: "temporary_elevenlabs_bridge",
    why: "Can resume traction while local Liam becomes universal.",
    change: "Allow production voice to keep using ElevenLabs only for stories without approved local Liam proof.",
    risk: "Credit spend continues temporarily.",
    rollback: "Disable ElevenLabs fallback once local Liam coverage is sufficient.",
    recommendation: "allow_temporarily_but_keep_local_liam_as_target",
  });
  if (token?.ok !== true || /creative/i.test(tiktokRoute)) {
    approvalQueue.push({
      decision: "tiktok_route_recovery",
      why: "TikTok is strategically important but the official route is still blocked.",
      change: "Refresh/sync the local token and prepare an inbox/dispatch test pack; do not auto-post.",
      risk: "Token mutation or posting before app review can fail or create account/platform risk.",
      rollback: "Leave TikTok disabled and use manual phone dispatch packs.",
      recommendation: "prepare_tooling_now_operator_test_later",
    });
  }

  return {
    schema_version: 1,
    generated_at: generatedAt,
    verdict,
    status,
    strategy: {
      hosting: "local_pc_primary_target",
      railway_role: "standby_optional_only",
      voice_target: "local_liam",
      paid_voice_role: "elevenlabs_temporary_bridge_only",
      production_quality_lane_now:
        proofSummary.ready_flash_proof_count > 0 ? "studio_v2_pilot_candidate" : "legacy_standard_lane",
    },
    plain_english_summary: canResumeLocalAutomaticPosting
      ? "Pulse can resume local automatic posting once the operator intentionally starts the local primary path. Railway stays standby only."
      : "Pulse is not ready to resume local automatic posting yet. The remaining work is local cutover plumbing, not a return to Railway.",
    readiness: {
      can_resume_local_automatic_posting: canResumeLocalAutomaticPosting,
      local_posting_verdict: upper(localPostingReadiness.verdict),
      local_health: bool(localPostingReadiness.readiness?.local_health),
      public_health: bool(localPostingReadiness.readiness?.public_health),
      tunnel_connected: bool(localPostingReadiness.readiness?.tunnel_connected),
      duplicate_control_keys: duplicateControlKeys,
      primary_enabled: bool(localPostingReadiness.readiness?.primary_enabled),
      queue_enabled: bool(localPostingReadiness.readiness?.queue_enabled),
      auto_publish_enabled: bool(localPostingReadiness.readiness?.auto_publish_enabled),
      local_tts_green: ttsGreen,
      local_voice_ready_count:
        Number(ttsReport.proof_batch?.voice_ready_count || localPostingReadiness.readiness?.local_voice_ready_count || 0),
      core_platform_ready: corePlatformReady,
    },
    platforms: {
      youtube,
      instagram_reel: instagram,
      facebook_reel: facebook,
      tiktok: {
        state: tiktok,
        token_ok: token?.ok === true,
        token_reason: token?.reason || null,
        refresh_available: token?.refresh_available === true,
        route: tiktokRoute,
        blocks_core_resume: false,
      },
    },
    quality: {
      production_lane_now:
        proofSummary.ready_flash_proof_count > 0 ? "studio_v2_pilot_candidate" : "legacy_standard_lane",
      ...proofSummary,
    },
    blockers: Array.from(new Set(blockers)),
    warnings: Array.from(new Set(warnings)),
    next_actions: nextActions,
    morning_approval_queue: approvalQueue,
    commands: {
      local_posting_readiness: "npm run ops:local-posting-readiness",
      local_cutover_plan: "npm run ops:local-cutover-plan",
      platform_doctor: "npm run ops:platform-doctor",
      social_platforms: "npm run ops:social-platforms",
      proof_candidates: "npm run studio:v2:proof-candidates -- --limit 10",
      local_tts_report: "npm run tts:overnight-report",
    },
    safety:
      "read-only plan; does not edit .env, start Cloudflare, switch primary, mutate tokens, post, touch Railway or trigger OAuth",
  };
}

function formatLocalResumePlanMarkdown(report = {}) {
  const lines = [];
  lines.push("# Local Resume Posting Plan");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || "unknown"}`);
  lines.push(`Verdict: ${upper(report.verdict)}`);
  lines.push(`Status: ${report.status || "unknown"}`);
  lines.push(`Safety: ${report.safety || "unknown"}`);
  lines.push("");
  lines.push("## Plain English");
  lines.push(`- ${report.plain_english_summary || "Status unavailable."}`);
  lines.push("- Railway stays standby only. The target is this PC running Pulse locally.");
  lines.push("- Local Liam is the target voice. ElevenLabs is only a temporary bridge while local coverage improves.");
  lines.push(`- Current safe production lane: ${report.quality?.production_lane_now || report.strategy?.production_quality_lane_now || "unknown"}.`);
  lines.push("");
  lines.push("## Readiness");
  for (const [key, value] of Object.entries(report.readiness || {})) {
    const display = Array.isArray(value) ? (value.length ? value.join(", ") : "none") : value;
    lines.push(`- ${key}: ${display}`);
  }
  lines.push("");
  lines.push("## Platforms");
  const platforms = report.platforms || {};
  lines.push(`- YouTube: ${platforms.youtube || "unknown"}`);
  lines.push(`- Instagram Reel: ${platforms.instagram_reel || "unknown"}`);
  lines.push(`- Facebook Reel: ${platforms.facebook_reel || "unknown"}`);
  const tiktok = platforms.tiktok || {};
  lines.push(
    `- TikTok: ${tiktok.state || "unknown"}; token_ok=${tiktok.token_ok}; route=${tiktok.route || "unknown"}; blocks_core_resume=${tiktok.blocks_core_resume}`,
  );
  lines.push("");
  lines.push("## Quality Lane");
  const quality = report.quality || {};
  lines.push(`- ready_flash_proof_count: ${quality.ready_flash_proof_count ?? 0}`);
  lines.push(`- local_voice_ready_count: ${quality.local_voice_ready_count ?? 0}`);
  lines.push(`- repair_media_first_count: ${quality.repair_media_first_count ?? 0}`);
  lines.push(`- repair_voice_first_count: ${quality.repair_voice_first_count ?? 0}`);
  if (array(quality.closest_candidates).length) {
    lines.push("");
    lines.push("### Closest Studio V2 Candidates");
    for (const candidate of quality.closest_candidates) {
      lines.push(
        `- ${candidate.story_id}: audio_ready=${candidate.audio_ready}; exact=${candidate.exact_subject_count}; clips=${candidate.validated_clip_refs}; next=${candidate.next_action}`,
      );
    }
  }
  if (array(report.blockers).length) {
    lines.push("");
    lines.push("## Blockers");
    for (const blocker of report.blockers) lines.push(`- ${blocker}`);
  }
  if (array(report.warnings).length) {
    lines.push("");
    lines.push("## Warnings");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }
  lines.push("");
  lines.push("## Next Actions");
  for (const action of array(report.next_actions)) lines.push(`- ${action}`);
  lines.push("");
  lines.push("## Morning Approval Queue");
  for (const item of array(report.morning_approval_queue)) {
    lines.push(`- ${item.decision}: ${item.recommendation}`);
  }
  lines.push("");
  lines.push("## Commands");
  for (const [key, value] of Object.entries(report.commands || {})) {
    lines.push(`- ${key}: \`${value}\``);
  }
  return lines.join("\n");
}

module.exports = {
  buildLocalResumePlan,
  formatLocalResumePlanMarkdown,
  summarizeProofCandidates,
};
