"use strict";

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function verdictRank(verdict) {
  const value = lower(verdict);
  if (["red", "fail", "failed", "block", "blocked"].includes(value)) return 3;
  if (["amber", "review", "warn", "warning"].includes(value)) return 2;
  if (["green", "pass", "passed", "ok"].includes(value)) return 1;
  return 0;
}

function normaliseVerdict(verdict, fallback = "unknown") {
  const value = lower(verdict);
  if (["red", "fail", "failed", "block", "blocked"].includes(value)) return "red";
  if (["amber", "review", "warn", "warning"].includes(value)) return "amber";
  if (["green", "pass", "passed", "ok"].includes(value)) return "green";
  return fallback;
}

function worstVerdict(values) {
  const normalised = values.map((value) => normaliseVerdict(value)).filter((value) => value !== "unknown");
  if (normalised.includes("red")) return "red";
  if (normalised.includes("amber")) return "amber";
  if (normalised.includes("green")) return "green";
  return "unknown";
}

function isReadyCandidate(candidate = {}) {
  const status = lower(candidate.status);
  const qa = lower(candidate.preflight_qa?.status || candidate.preflightQa?.status);
  const blockers = asArray(candidate.preflight_qa?.blockers || candidate.blockers);
  return status === "publish_ready" && blockers.length === 0 && (!qa || qa === "pass" || qa === "green");
}

function isV4ReadyCandidate(candidate = {}) {
  const exportedPath = lower(candidate.source?.exported_path || candidate.exported_path);
  const reasons = asArray(candidate.reasons).map(lower);
  return (
    exportedPath.includes("visual_v4") ||
    exportedPath.includes("studio-v4") ||
    reasons.includes("scheduler_bridge_candidate")
  );
}

function buildCandidateBuffer(candidateReport = {}, targets = {}) {
  const targetReady = Number(targets.readyCandidates || 10);
  const targetSourceSafe = Number(targets.sourceSafeCandidates || 6);
  const targetV4 = Number(targets.v4ReadyCandidates || 3);
  const candidates = asArray(candidateReport.candidates);
  const readyCandidates = candidates.filter(isReadyCandidate);
  const sourceSafeCandidates = readyCandidates.filter((candidate) => {
    const reasons = asArray(candidate.reasons).map(lower);
    return reasons.includes("preflight_qa_pass") || lower(candidate.preflight_qa?.checks?.content?.result) === "pass";
  });
  const v4ReadyCandidates = readyCandidates.filter(isV4ReadyCandidate);
  const pendingAudio = Number(candidateReport.totals?.pending_audio || 0);
  const blockers = [];
  const warnings = [];

  if (readyCandidates.length === 0) blockers.push("candidate_buffer_empty");
  if (readyCandidates.length < targetReady) warnings.push(`ready_candidates_below_target:${readyCandidates.length}/${targetReady}`);
  if (sourceSafeCandidates.length < targetSourceSafe) warnings.push(`source_safe_candidates_below_target:${sourceSafeCandidates.length}/${targetSourceSafe}`);
  if (v4ReadyCandidates.length < targetV4) warnings.push(`v4_ready_candidates_below_target:${v4ReadyCandidates.length}/${targetV4}`);
  if (pendingAudio > 0) warnings.push(`pending_audio_candidates:${pendingAudio}`);

  const verdict = blockers.length
    ? "red"
    : warnings.length
      ? "amber"
      : "green";

  return {
    verdict,
    generated_at: candidateReport.generated_at || candidateReport.generatedAt || null,
    targets: {
      ready_candidates: targetReady,
      source_safe_candidates: targetSourceSafe,
      v4_ready_candidates: targetV4,
    },
    counts: {
      stories_seen: Number(candidateReport.totals?.stories_seen || 0),
      returned: Number(candidateReport.totals?.returned || candidates.length),
      ready_candidates: readyCandidates.length,
      source_safe_candidates: sourceSafeCandidates.length,
      v4_ready_candidates: v4ReadyCandidates.length,
      pending_audio: pendingAudio,
      excluded: Number(candidateReport.totals?.excluded || 0),
    },
    top_candidates: readyCandidates.slice(0, 8).map((candidate) => ({
      id: clean(candidate.id),
      title: clean(candidate.title),
      score: Number(candidate.score || 0),
      duration_seconds: candidate.duration_seconds ?? null,
      source: clean(candidate.source?.source_type || candidate.source_type),
      v4_ready: isV4ReadyCandidate(candidate),
    })),
    blockers,
    warnings,
    next_action:
      verdict === "green"
        ? "Keep scheduler cadence; maintain this candidate buffer daily."
        : "Run candidate supply, render and preflight repair lanes before the buffer drops further.",
  };
}

function buildRuntimeOwnership(localRestartReport = {}) {
  const local = localRestartReport.running?.local || {};
  const pub = localRestartReport.running?.public || {};
  const facts = pub.runtime_ownership?.facts || local.runtime_ownership?.facts || {};
  const blockers = [
    ...asArray(localRestartReport.blockers),
    ...asArray(local.runtime_ownership?.blockers),
    ...asArray(pub.runtime_ownership?.blockers),
  ];

  if (local.ok !== true) blockers.push("local_health_unreachable");
  if (pub.ok !== true) blockers.push("public_health_unreachable");
  if (local.matches_current_commit !== true) blockers.push("local_commit_mismatch");
  if (pub.matches_current_commit !== true) blockers.push("public_commit_mismatch");
  if (facts.auto_publish !== true) blockers.push("auto_publish_not_true");
  if (String(facts.use_job_queue_explicit || "").toLowerCase() !== "true") blockers.push("use_job_queue_not_true");
  if (facts.schedulerActive !== true) blockers.push("scheduler_not_active");
  if (clean(facts.dispatch_mode) !== "queue") blockers.push("dispatch_not_queue");
  if (facts.primary !== true) blockers.push("runtime_not_primary");

  return {
    verdict: blockers.length ? "red" : "green",
    expected_commit: localRestartReport.expected_build?.commit_short || null,
    local: {
      ok: local.ok === true,
      commit: local.build?.commit_short || null,
      matches_current_commit: local.matches_current_commit === true,
    },
    public: {
      ok: pub.ok === true,
      commit: pub.build?.commit_short || null,
      matches_current_commit: pub.matches_current_commit === true,
    },
    facts: {
      auto_publish: facts.auto_publish === true,
      use_job_queue: clean(facts.use_job_queue_explicit),
      scheduler_active: facts.schedulerActive === true,
      dispatch_mode: clean(facts.dispatch_mode),
      primary: facts.primary === true,
    },
    blockers: Array.from(new Set(blockers)),
  };
}

function buildPostWindowVerification({ cadenceReport = {}, readinessReport = {} } = {}) {
  const recentPublish = readinessReport.pillars?.recent_publish?.raw || {};
  const summary = cadenceReport.summary || {};
  const blockers = asArray(cadenceReport.blockers);
  const advisory = asArray(cadenceReport.advisory);
  const verdict = blockers.length
    ? "red"
    : normaliseVerdict(cadenceReport.verdict, "amber");
  const latest = asArray(cadenceReport.publish_events)[0] || null;

  return {
    verdict,
    latest_public_post: latest
      ? {
          id: clean(latest.id),
          title: clean(latest.title),
          published_at: latest.published_at || null,
          platforms: asArray(latest.platforms),
          status: clean(latest.publish_status || latest.status),
        }
      : null,
    latest_publish_age_hours: recentPublish.age_hours ?? null,
    publish_jobs_seen: Number(summary.publish_jobs_seen || 0),
    next_safe_publish_at_utc: cadenceReport.next_safe_publish?.next_safe_publish_at_utc || summary.next_safe_publish_at_utc || null,
    off_schedule_count: Number(summary.off_schedule_count || 0),
    burst_pairs: Number(summary.burst_pairs || 0),
    blockers,
    advisory,
  };
}

function buildQueueHealth(queueReport = {}) {
  return {
    verdict: normaliseVerdict(queueReport.verdict),
    counts: queueReport.counts || {},
    pending_jobs: asArray(queueReport.pendingJobs).length,
    recent_failed_jobs: asArray(queueReport.recentFailedJobs).length,
    stale_claims: asArray(queueReport.staleClaims).length,
    warnings: asArray(queueReport.warnings),
    hard_fails: asArray(queueReport.hardFails),
  };
}

function buildPlatformHealth(platformReport = {}) {
  const platforms = platformReport.platforms || {};
  const enabled = [];
  const deferred = [];
  const blockers = asArray(platformReport.blockers);

  if (/^enabled/i.test(clean(platforms.instagram_reel?.status))) enabled.push("instagram_reels");
  if (/^enabled/i.test(clean(platforms.facebook_reel?.status))) enabled.push("facebook_reels");
  enabled.unshift("youtube_shorts");

  for (const [name, value] of Object.entries(platforms)) {
    const status = clean(value?.status);
    if (!/^enabled/i.test(status) && name !== "instagram_reel" && name !== "facebook_reel") {
      deferred.push({ platform: name, status });
    }
  }

  return {
    verdict: blockers.length ? "amber" : normaliseVerdict(platformReport.verdict, "green"),
    enabled_publish_platforms: enabled,
    deferred_platforms: deferred,
    blockers,
  };
}

function buildNormalOperationsReport({
  generatedAt = new Date().toISOString(),
  readinessReport = {},
  queueReport = {},
  cadenceReport = {},
  localRestartReport = {},
  platformReport = {},
  candidateReport = {},
  guardedSelection = null,
  candidateTargets = {},
} = {}) {
  const candidateBuffer = buildCandidateBuffer(candidateReport, candidateTargets);
  const runtimeOwnership = buildRuntimeOwnership(localRestartReport);
  const postWindow = buildPostWindowVerification({ cadenceReport, readinessReport });
  const queueHealth = buildQueueHealth(queueReport);
  const platformHealth = buildPlatformHealth(platformReport);
  const publishReadiness = {
    verdict: normaliseVerdict(readinessReport.overall_verdict),
    blockers: asArray(readinessReport.blockers),
    advisory: asArray(readinessReport.advisory).slice(0, 12),
    next_action: clean(readinessReport.next_action),
  };

  const overall = worstVerdict([
    publishReadiness.verdict,
    runtimeOwnership.verdict,
    queueHealth.verdict,
    platformHealth.verdict,
    candidateBuffer.verdict,
    postWindow.verdict,
  ]);

  const nextActions = [];
  if (runtimeOwnership.verdict !== "green") nextActions.push("Restore primary runtime ownership before any publish window.");
  if (publishReadiness.verdict === "red") nextActions.push("Hold publishing and clear publish-readiness blockers.");
  if (candidateBuffer.verdict !== "green") nextActions.push(candidateBuffer.next_action);
  if (postWindow.next_safe_publish_at_utc) {
    nextActions.push(`Observe the next scheduler window at ${postWindow.next_safe_publish_at_utc}.`);
  }
  if (guardedSelection?.action_id) {
    nextActions.push(`Next guarded action currently selected: ${guardedSelection.action_id}.`);
  }
  if (!nextActions.length) nextActions.push("Continue normal scheduler operations and review post-window evidence.");

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "read_only_normal_operations",
    overall_verdict: overall,
    operating_posture: overall === "red" ? "recovery" : "normal_operations",
    safety: {
      read_only: true,
      no_oauth_triggered: true,
      no_token_mutation: true,
      no_social_uploads: true,
      no_public_posts: true,
      no_production_db_mutation: true,
    },
    layers: {
      runtime_ownership: runtimeOwnership,
      publish_readiness: publishReadiness,
      queue_health: queueHealth,
      platform_health: platformHealth,
      candidate_buffer: candidateBuffer,
      post_window_verification: postWindow,
    },
    guarded_selection: guardedSelection
      ? {
          action_id: guardedSelection.action_id || null,
          exhausted: guardedSelection.exhausted === true,
          skipped_actions: asArray(guardedSelection.skipped_actions).slice(0, 8),
        }
      : null,
    next_actions: nextActions,
    artefacts: {
      publish_readiness: "test/output/publish_readiness.json",
      queue_inspect: "test/output/queue_inspect.json",
      publish_cadence: "test/output/publish_cadence.json",
      local_restart_readiness: "test/output/local_restart_readiness.json",
      platform_readiness_doctor: "test/output/platform_readiness_doctor.json",
      fresh_candidate_queue: "output/normal-operations/fresh_candidate_queue.json",
      runtime_ownership_status: "output/normal-operations/runtime_ownership_status.json",
      scheduler_window_readiness: "output/normal-operations/scheduler_window_readiness.json",
    },
  };
}

function parseActionId(value) {
  const id = clean(value);
  const parts = id.split(":").filter(Boolean);
  if (parts.length < 2) return { action_id: id || null, story_id: null, platform: null };
  const platform = parts.pop();
  return {
    action_id: id,
    story_id: parts.join(":"),
    platform,
  };
}

function buildSchedulerWindowReadiness(report = {}) {
  const layers = report.layers || {};
  const runtime = layers.runtime_ownership || {};
  const publish = layers.publish_readiness || {};
  const queue = layers.queue_health || {};
  const platform = layers.platform_health || {};
  const candidate = layers.candidate_buffer || {};
  const post = layers.post_window_verification || {};
  const guarded = report.guarded_selection || {};
  const selectedAction = parseActionId(guarded.action_id);
  const enabledPlatforms = asArray(platform.enabled_publish_platforms).map(clean).filter(Boolean);
  const blockers = [];
  const advisory = [];

  if (runtime.verdict !== "green") blockers.push("runtime_ownership_not_green");
  if (publish.verdict === "red" || asArray(publish.blockers).length) blockers.push("publish_readiness_blocked");
  if (queue.verdict === "red" || asArray(queue.hard_fails).length) blockers.push("queue_health_blocked");
  if (candidate.verdict === "red" || asArray(candidate.blockers).length) blockers.push("candidate_buffer_blocked");
  if (post.verdict === "red" || asArray(post.blockers).length) blockers.push("publish_cadence_blocked");
  if (!selectedAction.action_id || guarded.exhausted === true) blockers.push("no_guarded_action_selected");
  if (selectedAction.platform && !enabledPlatforms.includes(selectedAction.platform)) {
    blockers.push(`selected_platform_not_enabled:${selectedAction.platform}`);
  }

  if (publish.verdict === "amber") advisory.push("publish_readiness_amber");
  if (queue.verdict === "amber") advisory.push("queue_health_amber");
  if (platform.verdict === "amber") advisory.push("platform_health_amber");
  if (candidate.verdict === "amber") advisory.push("candidate_buffer_amber");
  if (post.verdict === "amber") advisory.push("cadence_or_post_window_amber");
  if (!post.next_safe_publish_at_utc) advisory.push("next_publish_window_unknown");

  const uniqueBlockers = Array.from(new Set(blockers));
  const uniqueAdvisory = Array.from(new Set(advisory));
  const verdict = uniqueBlockers.length ? "red" : uniqueAdvisory.length ? "amber" : "green";

  return {
    schema_version: 1,
    generated_at: report.generated_at || new Date().toISOString(),
    mode: "read_only_scheduler_window_readiness",
    verdict,
    ready_for_next_window_boolean: uniqueBlockers.length === 0,
    next_publish_window_utc: post.next_safe_publish_at_utc || null,
    selected_action: selectedAction,
    enabled_publish_platforms: enabledPlatforms,
    deferred_platforms: asArray(platform.deferred_platforms),
    skipped_actions: asArray(guarded.skipped_actions).slice(0, 12),
    blockers: uniqueBlockers,
    advisory: uniqueAdvisory,
    safety: {
      read_only: true,
      no_oauth_triggered: true,
      no_token_mutation: true,
      no_social_uploads: true,
      no_public_posts: true,
      no_production_db_mutation: true,
    },
    next_action: uniqueBlockers.length
      ? "hold_scheduler_and_repair_blockers"
      : "observe_next_scheduler_window",
  };
}

function formatSchedulerWindowReadinessMarkdown(readiness = {}) {
  const lines = [
    "# Scheduler Window Readiness",
    "",
    `Generated: ${readiness.generated_at || "unknown"}`,
    `Verdict: ${String(readiness.verdict || "unknown").toUpperCase()}`,
    `Ready for next window: ${readiness.ready_for_next_window_boolean === true}`,
    `Next publish window UTC: ${readiness.next_publish_window_utc || "unknown"}`,
    `Selected action: ${readiness.selected_action?.action_id || "none"}`,
    `Selected platform: ${readiness.selected_action?.platform || "none"}`,
    `Enabled platforms: ${asArray(readiness.enabled_publish_platforms).join(", ") || "none"}`,
    "",
    "## Blockers",
    "",
  ];
  for (const blocker of asArray(readiness.blockers)) lines.push(`- ${blocker}`);
  if (!asArray(readiness.blockers).length) lines.push("- none");
  lines.push("", "## Advisory", "");
  for (const item of asArray(readiness.advisory)) lines.push(`- ${item}`);
  if (!asArray(readiness.advisory).length) lines.push("- none");
  lines.push("", `Next action: ${readiness.next_action || "unknown"}`, "");
  return lines.join("\n");
}

function formatNormalOperationsMarkdown(report = {}) {
  const layers = report.layers || {};
  const candidate = layers.candidate_buffer || {};
  const runtime = layers.runtime_ownership || {};
  const post = layers.post_window_verification || {};
  const platform = layers.platform_health || {};
  const queue = layers.queue_health || {};
  const publish = layers.publish_readiness || {};
  const lines = [
    "# Pulse Gaming Normal Operations Report",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Verdict: ${String(report.overall_verdict || "unknown").toUpperCase()}`,
    `Posture: ${report.operating_posture || "unknown"}`,
    "",
    "## Runtime",
    "",
    `- Verdict: ${String(runtime.verdict || "unknown").toUpperCase()}`,
    `- Commit: local=${runtime.local?.commit || "unknown"}, public=${runtime.public?.commit || "unknown"}, expected=${runtime.expected_commit || "unknown"}`,
    `- Auto publish: ${runtime.facts?.auto_publish === true}`,
    `- Queue: ${runtime.facts?.use_job_queue || "unknown"}`,
    `- Scheduler active: ${runtime.facts?.scheduler_active === true}`,
    `- Dispatch: ${runtime.facts?.dispatch_mode || "unknown"}`,
    "",
    "## Publish Readiness",
    "",
    `- Verdict: ${String(publish.verdict || "unknown").toUpperCase()}`,
    `- Blockers: ${asArray(publish.blockers).length ? asArray(publish.blockers).join("; ") : "none"}`,
    `- Next action: ${publish.next_action || "none"}`,
    "",
    "## Candidate Buffer",
    "",
    `- Verdict: ${String(candidate.verdict || "unknown").toUpperCase()}`,
    `- Ready: ${candidate.counts?.ready_candidates ?? 0}/${candidate.targets?.ready_candidates ?? 0}`,
    `- Source-safe: ${candidate.counts?.source_safe_candidates ?? 0}/${candidate.targets?.source_safe_candidates ?? 0}`,
    `- V4-ready: ${candidate.counts?.v4_ready_candidates ?? 0}/${candidate.targets?.v4_ready_candidates ?? 0}`,
    `- Pending audio: ${candidate.counts?.pending_audio ?? 0}`,
  ];

  if (asArray(candidate.top_candidates).length) {
    lines.push("", "Top candidates:");
    for (const item of candidate.top_candidates.slice(0, 5)) {
      lines.push(`- ${item.id}: ${item.title} (${item.score})`);
    }
  }

  lines.push(
    "",
    "## Queue And Platforms",
    "",
    `- Queue verdict: ${String(queue.verdict || "unknown").toUpperCase()}`,
    `- Pending jobs: ${queue.pending_jobs ?? 0}`,
    `- Recent failed jobs: ${queue.recent_failed_jobs ?? 0}`,
    `- Platform verdict: ${String(platform.verdict || "unknown").toUpperCase()}`,
    `- Enabled platforms: ${asArray(platform.enabled_publish_platforms).join(", ") || "none"}`,
    `- Deferred platforms: ${
      asArray(platform.deferred_platforms).map((item) => `${item.platform}:${item.status}`).join(", ") || "none"
    }`,
    "",
    "## Post Window",
    "",
    `- Verdict: ${String(post.verdict || "unknown").toUpperCase()}`,
    `- Latest post: ${post.latest_public_post?.id || "none"} (${post.latest_public_post?.published_at || "unknown"})`,
    `- Latest age hours: ${post.latest_publish_age_hours ?? "unknown"}`,
    `- Publish jobs seen: ${post.publish_jobs_seen ?? 0}`,
    `- Next safe publish UTC: ${post.next_safe_publish_at_utc || "unknown"}`,
    "",
    "## Next Actions",
    "",
  );

  for (const action of asArray(report.next_actions)) lines.push(`- ${action}`);

  lines.push(
    "",
    "## Safety",
    "",
    "- Read-only report",
    "- No OAuth or token mutation",
    "- No upload or public post",
    "- No production DB mutation",
    "",
  );

  return `${lines.join("\n")}`;
}

module.exports = {
  buildCandidateBuffer,
  buildNormalOperationsReport,
  buildPlatformHealth,
  buildPostWindowVerification,
  buildQueueHealth,
  buildRuntimeOwnership,
  buildSchedulerWindowReadiness,
  formatNormalOperationsMarkdown,
  formatSchedulerWindowReadinessMarkdown,
  normaliseVerdict,
  worstVerdict,
};
