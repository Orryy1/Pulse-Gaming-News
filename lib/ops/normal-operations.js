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

function sourceAgeExpiresInHours(candidate = {}) {
  const explicit = Number(candidate.source_age_expires_in_hours ?? candidate.sourceAgeExpiresInHours);
  if (Number.isFinite(explicit)) return explicit;

  const evidence = candidate.preflight_qa?.checks?.source_age?.evidence || {};
  const ageHours = Number(evidence.age_hours);
  const policyHours = Number(evidence.policy_hours);
  if (Number.isFinite(ageHours) && Number.isFinite(policyHours)) return policyHours - ageHours;
  return null;
}

function buildPublishWindowRunway(readyCandidates = [], targets = {}) {
  const publishWindows24h = Number(targets.publishWindows24h || targets.publishWindowsPerDay || 5);
  const targetReady = Number(targets.readyCandidates || 10);
  const windowCount = Number.isFinite(publishWindows24h) && publishWindows24h > 0 ? publishWindows24h : 5;
  const reserveTarget = Math.max(0, targetReady - windowCount);
  const expiringWithin24h = readyCandidates.filter((candidate) => {
    const expiresIn = sourceAgeExpiresInHours(candidate);
    return Number.isFinite(expiresIn) && expiresIn <= 24;
  });
  const covered = Math.min(readyCandidates.length, windowCount);
  const uncovered = Math.max(0, windowCount - readyCandidates.length);
  const reserve = Math.max(0, readyCandidates.length - windowCount);
  const readyForNext24h = uncovered === 0 && expiringWithin24h.length === 0;
  const status = uncovered > 0
    ? "undercovered"
    : expiringWithin24h.length > 0
      ? "covered_with_expiring_candidates"
    : reserve < reserveTarget
      ? "covered_no_reserve"
      : "covered_with_reserve";

  return {
    publish_windows_24h: windowCount,
    ready_for_next_24h_boolean: readyForNext24h,
    covered_publish_windows_24h: covered,
    uncovered_publish_windows_24h: uncovered,
    reserve_candidates: reserve,
    reserve_target: reserveTarget,
    ready_candidates_expiring_within_24h: expiringWithin24h.length,
    expiring_candidate_ids: expiringWithin24h.map((candidate) => clean(candidate.id)).filter(Boolean),
    status,
    next_action: readyForNext24h
      ? reserve > 0
        ? "Keep producing fresh candidates so the two-day reserve stays covered."
        : "Refill the reserve before the next publish window consumes the last 24h runway."
      : uncovered > 0
        ? "Rebuild or repair fresh GREEN candidates before an uncovered publish window is reached."
        : "Replace expiring GREEN candidates with fresh reserve before the 24h runway ages out.",
  };
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
  const publishWindowRunway = buildPublishWindowRunway(readyCandidates, {
    ...targets,
    readyCandidates: targetReady,
  });
  const blockers = [];
  const warnings = [];

  if (readyCandidates.length === 0) blockers.push("candidate_buffer_empty");
  if (readyCandidates.length < targetReady) warnings.push(`ready_candidates_below_target:${readyCandidates.length}/${targetReady}`);
  if (publishWindowRunway.uncovered_publish_windows_24h > 0) warnings.push(`publish_window_runway_short:${publishWindowRunway.covered_publish_windows_24h}/${publishWindowRunway.publish_windows_24h}`);
  if (publishWindowRunway.reserve_candidates === 0 && publishWindowRunway.uncovered_publish_windows_24h === 0) warnings.push("publish_window_reserve_empty");
  if (publishWindowRunway.ready_candidates_expiring_within_24h > 0) warnings.push(`ready_candidates_expiring_within_24h:${publishWindowRunway.ready_candidates_expiring_within_24h}`);
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
    publish_window_runway: publishWindowRunway,
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
        : publishWindowRunway.next_action || "Run candidate supply, render and preflight repair lanes before the buffer drops further.",
  };
}

function buildRuntimeOwnership(localRestartReport = {}, runtimeSentinelReport = null) {
  if (runtimeSentinelReport?.verdict) {
    const summary = runtimeSentinelReport.summary || {};
    const blockers = asArray(runtimeSentinelReport.blockers);
    return {
      verdict: normaliseVerdict(runtimeSentinelReport.verdict),
      source: "runtime_ownership_sentinel",
      expected_commit:
        runtimeSentinelReport.expected?.commit_short ||
        runtimeSentinelReport.expected?.commit_sha ||
        null,
      local: {
        ok: runtimeSentinelReport.health?.local?.ok === true,
        commit: runtimeSentinelReport.health?.local?.facts?.commit_short || summary.commit_short || null,
        matches_current_commit: blockers.every((blocker) => !/local runtime commit/i.test(blocker)),
      },
      public: {
        ok: runtimeSentinelReport.health?.public?.ok === true,
        commit: runtimeSentinelReport.health?.public?.facts?.commit_short || summary.commit_short || null,
        matches_current_commit: blockers.every((blocker) => !/public runtime commit/i.test(blocker)),
      },
      facts: {
        auto_publish: summary.auto_publish === true,
        use_job_queue: clean(summary.use_job_queue_explicit),
        scheduler_active: summary.scheduler_active === true,
        dispatch_mode: clean(summary.dispatch_mode),
        primary: summary.primary === true,
        port_owner_pid: summary.port_owner_pid ?? null,
        cloudflared_present: summary.cloudflared_present === true,
      },
      blockers: Array.from(new Set(blockers)),
      warnings: asArray(runtimeSentinelReport.warnings),
    };
  }

  localRestartReport = localRestartReport || {};
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

function normalisePublishPlatform(value) {
  const platform = lower(value);
  if (["youtube", "youtube_short", "youtube_shorts", "yt_shorts"].includes(platform)) return "youtube_shorts";
  if (["instagram", "instagram_reel", "instagram_reels", "ig_reels"].includes(platform)) return "instagram_reels";
  if (["facebook", "facebook_reel", "facebook_reels", "fb_reels"].includes(platform)) return "facebook_reels";
  return platform || "unknown";
}

function latestTimestamp(values = []) {
  return values
    .map((value) => clean(value))
    .filter(Boolean)
    .sort()
    .pop() || null;
}

function average(values = []) {
  const nums = values.map(Number).filter((value) => Number.isFinite(value));
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function buildPlatformGrowthPlan(platforms = {}) {
  const youtube = platforms.youtube_shorts || {};
  const instagram = platforms.instagram_reels || {};
  const facebook = platforms.facebook_reels || {};
  const youtubeUnderTarget = youtube.performance_signal === "needs_title_hook_and_first_frame_iteration";
  const instagramTractionUnderInstrumented = instagram.performance_signal === "traction_signal_under_instrumented";
  const facebookUnverified = facebook.performance_signal === "published_but_unverified_distribution";
  const productionPriorities = [];
  const operatorActions = [];
  const warnings = [];

  if (instagramTractionUnderInstrumented) {
    productionPriorities.push("instagram_reels_native_first_frame", "instagram_reels_debate_led_payoff");
    warnings.push("instagram_growth_signal_requires_play_count_repair");
  }
  if (youtubeUnderTarget) {
    productionPriorities.push("youtube_shorts_title_hook_rescue", "youtube_shorts_first_three_seconds_recut");
    warnings.push("youtube_shorts_below_view_target");
  }
  if (facebookUnverified) {
    productionPriorities.push("facebook_reels_visibility_and_insights_probe");
    warnings.push("facebook_reels_distribution_unverified");
  }
  if (instagramTractionUnderInstrumented || facebookUnverified) {
    operatorActions.push("sync_meta_insights_permissions");
  }
  if (facebookUnverified) {
    operatorActions.push("verify_facebook_reels_visibility_in_creator_surface");
  }

  return {
    schema_version: 1,
    verdict: warnings.length ? "amber" : "green",
    scheduler_policy: "keep_guarded_multiplatform_enabled",
    decision_rule:
      "Keep YouTube, Instagram Reels and Facebook Reels enabled through guarded dispatch, but optimise the next creative cycle around measured YouTube weakness, Instagram traction and Facebook verification.",
    production_priorities: Array.from(new Set(productionPriorities)),
    youtube_recovery_contract: {
      required: youtubeUnderTarget,
      priority: youtubeUnderTarget ? "recovery_lane" : "monitor_lane",
      target: "lift YouTube Shorts above the measured view target without weakening source, transcript or render gates",
      required_changes: youtubeUnderTarget
        ? [
            "write a title that sells the exact viewer stakes in one line",
            "make the first frame readable and curiosity-heavy on mobile",
            "state the named game and payoff inside the first three seconds",
            "avoid generic industry commentary and delayed context",
          ]
        : [],
    },
    instagram_growth_contract: {
      priority: instagramTractionUnderInstrumented ? "growth_lane" : "monitor_lane",
      target: "preserve the Reels format traits that appear to be gaining traction while repairing play/reach measurement",
      required_changes: instagramTractionUnderInstrumented
        ? [
            "lead with the strongest visual or emotional beat rather than a setup sentence",
            "make the caption and ending invite a specific debate, not generic engagement bait",
            "keep cuts dense and avoid repeated footage loops",
          ]
        : [],
    },
    facebook_reels_contract: {
      priority: facebookUnverified ? "measurement_probe_lane" : "monitor_lane",
      target: "prove whether Facebook is a distribution failure or an insights-ingestion failure before changing platform enablement",
      required_changes: facebookUnverified
        ? [
            "collect or manually verify Reel visibility after the next guarded upload",
            "repair Reels insights ingestion before treating local zero counters as truth",
            "do not count Facebook as a growth lane until real views or insight snapshots exist",
          ]
        : [],
    },
    operator_actions: Array.from(new Set(operatorActions)),
    warnings: Array.from(new Set(warnings)),
    safety: {
      read_only: true,
      no_oauth_triggered: true,
      no_token_mutation: true,
      no_social_uploads: true,
      no_public_posts: true,
      no_production_db_mutation: true,
    },
  };
}

function buildPlatformPerformance({
  generatedAt = new Date().toISOString(),
  platformPosts = [],
  metricSnapshots = [],
  youtubeAverageViewTarget = 600,
} = {}) {
  const platforms = {
    youtube_shorts: {
      label: "YouTube Shorts",
      published_posts: 0,
      stats_missing_posts: 0,
      metric_snapshot_posts: 0,
      total_views: 0,
      total_likes: 0,
      total_comments: 0,
      total_shares: 0,
      latest_published_at: null,
      latest_snapshot_at: null,
    },
    instagram_reels: {
      label: "Instagram Reels",
      published_posts: 0,
      stats_missing_posts: 0,
      metric_snapshot_posts: 0,
      total_views: 0,
      total_likes: 0,
      total_comments: 0,
      total_shares: 0,
      latest_published_at: null,
      latest_snapshot_at: null,
    },
    facebook_reels: {
      label: "Facebook Reels",
      published_posts: 0,
      stats_missing_posts: 0,
      metric_snapshot_posts: 0,
      total_views: 0,
      total_likes: 0,
      total_comments: 0,
      total_shares: 0,
      latest_published_at: null,
      latest_snapshot_at: null,
    },
  };

  const postBuckets = new Map();
  for (const row of asArray(platformPosts)) {
    const platform = normalisePublishPlatform(row.platform);
    if (!platforms[platform]) continue;
    const bucket = postBuckets.get(platform) || [];
    bucket.push(row);
    postBuckets.set(platform, bucket);
    if (lower(row.status) !== "published") continue;
    platforms[platform].published_posts += 1;
    if (!clean(row.stats_fetched_at)) platforms[platform].stats_missing_posts += 1;
  }

  const metricBuckets = new Map();
  const snapshotStoryKeys = new Map();
  for (const row of asArray(metricSnapshots)) {
    const platform = normalisePublishPlatform(row.platform);
    if (!platforms[platform]) continue;
    const bucket = metricBuckets.get(platform) || [];
    bucket.push(row);
    metricBuckets.set(platform, bucket);
    const storyKey = clean(row.story_id) || `${platform}:${bucket.length}`;
    const key = `${platform}:${storyKey}`;
    if (!snapshotStoryKeys.has(key)) {
      snapshotStoryKeys.set(key, true);
      platforms[platform].metric_snapshot_posts += 1;
    }
    platforms[platform].total_views += Number(row.views) || 0;
    platforms[platform].total_likes += Number(row.likes) || 0;
    platforms[platform].total_comments += Number(row.comments) || 0;
    platforms[platform].total_shares += Number(row.shares) || 0;
  }

  for (const [platform, summary] of Object.entries(platforms)) {
    const posts = postBuckets.get(platform) || [];
    const snapshots = metricBuckets.get(platform) || [];
    const snapshotViews = snapshots.map((row) => Number(row.views) || 0);
    summary.avg_views_per_metric_post = average(snapshotViews);
    summary.max_views = snapshotViews.length ? Math.max(...snapshotViews) : 0;
    summary.latest_published_at = latestTimestamp(
      posts.map((row) => row.published_at || row.updated_at || row.created_at),
    );
    summary.latest_snapshot_at = latestTimestamp(snapshots.map((row) => row.snapshot_at));

    if (summary.metric_snapshot_posts === 0 && summary.published_posts > 0) {
      summary.measurement_status = "no_metric_snapshots";
      summary.performance_signal = "published_but_unverified_distribution";
      summary.recommendation =
        platform === "facebook_reels"
          ? "Keep Facebook posting enabled, but treat it as unverified until Reels insights are ingested or manually checked."
          : "Collect metric snapshots before changing packaging strategy.";
    } else if (
      platform === "instagram_reels" &&
      summary.metric_snapshot_posts > 0 &&
      summary.total_views === 0 &&
      summary.total_likes + summary.total_comments + summary.total_shares > 0
    ) {
      summary.measurement_status = "engagement_without_play_counts";
      summary.performance_signal = "traction_signal_under_instrumented";
      summary.recommendation =
        "Use Instagram app traction as a qualitative signal, but repair Reels plays/reach ingestion before ranking it against YouTube.";
    } else if (summary.metric_snapshot_posts > 0) {
      summary.measurement_status = "measured";
      if (
        platform === "youtube_shorts" &&
        Number.isFinite(summary.avg_views_per_metric_post) &&
        summary.avg_views_per_metric_post < youtubeAverageViewTarget
      ) {
        summary.performance_signal = "needs_title_hook_and_first_frame_iteration";
        summary.recommendation =
          "Use YouTube as the measured learning lane: sharpen titles, first frame, first three seconds and retention payoff.";
      } else {
        summary.performance_signal = "measured_distribution";
        summary.recommendation = "Keep collecting snapshots and compare story formats after each publish window.";
      }
    } else {
      summary.measurement_status = "no_recent_publish_or_metrics";
      summary.performance_signal = "insufficient_data";
      summary.recommendation = "Keep publishing through guarded scheduler before drawing platform conclusions.";
    }
  }

  const nextActions = [];
  const instagram = platforms.instagram_reels;
  const facebook = platforms.facebook_reels;
  const youtube = platforms.youtube_shorts;
  if (
    instagram.measurement_status === "engagement_without_play_counts" ||
    facebook.measurement_status === "no_metric_snapshots"
  ) {
    nextActions.push("Repair Meta Reels insights ingestion before treating local Instagram/Facebook zero-view counters as truth.");
  }
  if (youtube.performance_signal === "needs_title_hook_and_first_frame_iteration") {
    nextActions.push("Bias the next script and cover variants toward sharper YouTube Shorts titles, first frames and first-three-second payoffs.");
  }
  if (facebook.performance_signal === "published_but_unverified_distribution") {
    nextActions.push("Verify Facebook Reel visibility and page distribution evidence after the next upload.");
  }

  const warnings = [];
  if (instagram.measurement_status === "engagement_without_play_counts") warnings.push("instagram_views_under_instrumented");
  if (facebook.measurement_status === "no_metric_snapshots") warnings.push("facebook_metric_snapshots_missing");
  if (youtube.performance_signal === "needs_title_hook_and_first_frame_iteration") warnings.push("youtube_shorts_under_target");
  const platformGrowthPlan = buildPlatformGrowthPlan(platforms);

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "read_only_platform_performance",
    verdict: warnings.length ? "amber" : "green",
    platform_strategy: {
      primary_learning_platform: "youtube_shorts",
      traction_signal_platform: "instagram_reels",
      verification_platform: "facebook_reels",
      decision_rule:
        "Do not demote an enabled platform from local zero counters alone; first confirm platform-native insights and visibility evidence.",
    },
    platforms,
    platform_growth_plan: platformGrowthPlan,
    warnings,
    next_actions: nextActions,
    safety: {
      read_only: true,
      no_oauth_triggered: true,
      no_token_mutation: true,
      no_social_uploads: true,
      no_public_posts: true,
      no_production_db_mutation: true,
    },
  };
}

function buildNormalOperationsReport({
  generatedAt = new Date().toISOString(),
  readinessReport = {},
  queueReport = {},
  cadenceReport = {},
  localRestartReport = {},
  runtimeSentinelReport = null,
  platformReport = {},
  candidateReport = {},
  guardedSelection = null,
  candidateTargets = {},
  platformPerformanceReport = null,
} = {}) {
  const candidateBuffer = buildCandidateBuffer(candidateReport, candidateTargets);
  const runtimeOwnership = buildRuntimeOwnership(localRestartReport, runtimeSentinelReport);
  const postWindow = buildPostWindowVerification({ cadenceReport, readinessReport });
  const queueHealth = buildQueueHealth(queueReport);
  const platformHealth = buildPlatformHealth(platformReport);
  const platformPerformance = platformPerformanceReport || buildPlatformPerformance({ generatedAt });
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
    platformPerformance.verdict,
  ]);

  const nextActions = [];
  if (runtimeOwnership.verdict !== "green") nextActions.push("Restore primary runtime ownership before any publish window.");
  if (publishReadiness.verdict === "red") nextActions.push("Hold publishing and clear publish-readiness blockers.");
  if (candidateBuffer.verdict !== "green") nextActions.push(candidateBuffer.next_action);
  for (const action of asArray(platformPerformance.next_actions).slice(0, 3)) nextActions.push(action);
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
      platform_performance: platformPerformance,
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
  const performance = layers.platform_performance || {};
  const candidate = layers.candidate_buffer || {};
  const runway = candidate.publish_window_runway || {};
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
  if (runway.ready_for_next_24h_boolean === false) advisory.push("publish_window_runway_undercovered");
  else if (Number(runway.reserve_candidates || 0) === 0) advisory.push("publish_window_reserve_empty");
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
    publish_window_runway: runway,
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
  const runway = readiness.publish_window_runway || {};
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
    `24h runway: ${runway.covered_publish_windows_24h ?? 0}/${runway.publish_windows_24h ?? 0} windows covered`,
    `Reserve: ${runway.reserve_candidates ?? 0}/${runway.reserve_target ?? 0}`,
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

function buildDailyStudioReport(report = {}) {
  const layers = report.layers || {};
  const runtime = layers.runtime_ownership || {};
  const publish = layers.publish_readiness || {};
  const queue = layers.queue_health || {};
  const platform = layers.platform_health || {};
  const candidate = layers.candidate_buffer || {};
  const post = layers.post_window_verification || {};
  const schedulerWindow = buildSchedulerWindowReadiness(report);
  const guarded = report.guarded_selection || {};

  return {
    schema_version: 1,
    generated_at: report.generated_at || new Date().toISOString(),
    mode: "read_only_daily_studio_report",
    verdict: normaliseVerdict(report.overall_verdict),
    posture: report.operating_posture || "unknown",
    runtime: {
      verdict: runtime.verdict || "unknown",
      commit: runtime.public?.commit || runtime.local?.commit || null,
      auto_publish: runtime.facts?.auto_publish === true,
      use_job_queue: runtime.facts?.use_job_queue || null,
      scheduler_active: runtime.facts?.scheduler_active === true,
      dispatch_mode: runtime.facts?.dispatch_mode || null,
      blockers: asArray(runtime.blockers),
    },
    publish_readiness: {
      verdict: publish.verdict || "unknown",
      blockers: asArray(publish.blockers),
      advisory_count: asArray(publish.advisory).length,
      next_action: publish.next_action || null,
    },
    scheduler_window: {
      verdict: schedulerWindow.verdict,
      ready_for_next_window_boolean: schedulerWindow.ready_for_next_window_boolean === true,
      next_publish_window_utc: schedulerWindow.next_publish_window_utc || null,
      blockers: asArray(schedulerWindow.blockers),
      advisory: asArray(schedulerWindow.advisory),
    },
    candidate_buffer: {
      verdict: candidate.verdict || "unknown",
      ready_candidates: Number(candidate.counts?.ready_candidates || 0),
      ready_target: Number(candidate.targets?.ready_candidates || 0),
      source_safe_candidates: Number(candidate.counts?.source_safe_candidates || 0),
      v4_ready_candidates: Number(candidate.counts?.v4_ready_candidates || 0),
      pending_audio: Number(candidate.counts?.pending_audio || 0),
      publish_window_runway: candidate.publish_window_runway || null,
      top_candidates: asArray(candidate.top_candidates).slice(0, 5),
      blockers: asArray(candidate.blockers),
      warnings: asArray(candidate.warnings),
    },
    queue_health: {
      verdict: queue.verdict || "unknown",
      pending_jobs: Number(queue.pending_jobs || 0),
      recent_failed_jobs: Number(queue.recent_failed_jobs || 0),
      stale_claims: Number(queue.stale_claims || 0),
      hard_fails: asArray(queue.hard_fails),
    },
    platform_health: {
      verdict: platform.verdict || "unknown",
      enabled_publish_platforms: asArray(platform.enabled_publish_platforms),
      deferred_platforms: asArray(platform.deferred_platforms),
      blockers: asArray(platform.blockers),
    },
    platform_performance: {
      verdict: performance.verdict || "unknown",
      strategy: performance.platform_strategy || null,
      growth_plan: performance.platform_growth_plan || null,
      platforms: performance.platforms || {},
      warnings: asArray(performance.warnings),
      next_actions: asArray(performance.next_actions),
    },
    post_evidence: {
      verdict: post.verdict || "unknown",
      latest_public_post: post.latest_public_post || null,
      latest_publish_age_hours: post.latest_publish_age_hours ?? null,
      publish_jobs_seen: Number(post.publish_jobs_seen || 0),
      off_schedule_count: Number(post.off_schedule_count || 0),
      burst_pairs: Number(post.burst_pairs || 0),
      blockers: asArray(post.blockers),
      advisory: asArray(post.advisory),
    },
    guarded_scheduler: {
      selected_action: guarded.action_id || null,
      exhausted: guarded.exhausted === true,
      skipped_action_count: asArray(guarded.skipped_actions).length,
      skipped_actions: asArray(guarded.skipped_actions).slice(0, 8),
    },
    next_day_action_plan: asArray(report.next_actions),
    safety: {
      read_only: true,
      no_oauth_triggered: true,
      no_token_mutation: true,
      no_social_uploads: true,
      no_public_posts: true,
      no_production_db_mutation: true,
      do_not_touch: [
        "Do not stop the primary runtime or Cloudflare tunnel during a publish window.",
        "Do not enable TikTok, X, Threads or Pinterest from this report.",
        "Do not mutate OAuth, tokens, credentials or billing.",
        "Do not bypass dry-run or guarded dispatch gates.",
      ],
    },
  };
}

function formatDailyStudioReportMarkdown(daily = {}) {
  const runway = daily.candidate_buffer?.publish_window_runway || {};
  const lines = [
    "# Pulse Gaming Daily Studio Report",
    "",
    `Generated: ${daily.generated_at || "unknown"}`,
    `Verdict: ${String(daily.verdict || "unknown").toUpperCase()}`,
    `Posture: ${daily.posture || "unknown"}`,
    "",
    "## Scheduler",
    "",
    `- Ready for next window: ${daily.scheduler_window?.ready_for_next_window_boolean === true}`,
    `- Next window UTC: ${daily.scheduler_window?.next_publish_window_utc || "unknown"}`,
    `- Selected action: ${daily.guarded_scheduler?.selected_action || "none"}`,
    `- Runtime commit: ${daily.runtime?.commit || "unknown"}`,
    `- Auto publish: ${daily.runtime?.auto_publish === true}`,
    "",
    "## Buffer And Queue",
    "",
    `- Ready candidates: ${daily.candidate_buffer?.ready_candidates ?? 0}/${daily.candidate_buffer?.ready_target ?? 0}`,
    `- Publish-window runway: ${runway.covered_publish_windows_24h ?? 0}/${runway.publish_windows_24h ?? 0} covered`,
    `- Reserve candidates: ${runway.reserve_candidates ?? 0}/${runway.reserve_target ?? 0}`,
    `- Source-safe: ${daily.candidate_buffer?.source_safe_candidates ?? 0}`,
    `- V4-ready: ${daily.candidate_buffer?.v4_ready_candidates ?? 0}`,
    `- Queue pending: ${daily.queue_health?.pending_jobs ?? 0}`,
    `- Recent failed jobs: ${daily.queue_health?.recent_failed_jobs ?? 0}`,
    "",
    "## Post Evidence",
    "",
    `- Latest post: ${daily.post_evidence?.latest_public_post?.id || "none"}`,
    `- Latest age hours: ${daily.post_evidence?.latest_publish_age_hours ?? "unknown"}`,
    `- Publish jobs seen: ${daily.post_evidence?.publish_jobs_seen ?? 0}`,
    `- Off-schedule posts: ${daily.post_evidence?.off_schedule_count ?? 0}`,
    "",
    "## Next Day Actions",
    "",
  ];
  for (const action of asArray(daily.next_day_action_plan)) lines.push(`- ${action}`);
  if (!asArray(daily.next_day_action_plan).length) lines.push("- none");
  lines.push("", "## Do Not Touch", "");
  for (const item of asArray(daily.safety?.do_not_touch)) lines.push(`- ${item}`);
  lines.push("");
  return lines.join("\n");
}

function buildDiscordOperationsSummary(report = {}) {
  const daily = buildDailyStudioReport(report);
  const candidate = daily.candidate_buffer || {};
  const runway = candidate.publish_window_runway || {};
  const queue = daily.queue_health || {};
  const platforms = daily.platform_health || {};
  const performance = daily.platform_performance || {};
  const post = daily.post_evidence || {};
  const lines = [
    `**Pulse Gaming Daily Studio**`,
    `Status: ${String(daily.verdict || "unknown").toUpperCase()} (${daily.posture || "unknown"})`,
    `Runtime: ${daily.runtime?.commit || "unknown"} | AUTO_PUBLISH=${daily.runtime?.auto_publish === true} | queue=${daily.runtime?.use_job_queue || "unknown"} | scheduler=${daily.runtime?.scheduler_active === true}`,
    `Next window: ${daily.scheduler_window?.next_publish_window_utc || "unknown"}`,
    `Selected: ${daily.guarded_scheduler?.selected_action || "none"}`,
    `Candidates: ${candidate.ready_candidates || 0}/${candidate.ready_target || 0} ready | windows ${runway.covered_publish_windows_24h || 0}/${runway.publish_windows_24h || 0} | reserve ${runway.reserve_candidates || 0}/${runway.reserve_target || 0}`,
    `Candidate quality: source-safe ${candidate.source_safe_candidates || 0} | V4 ${candidate.v4_ready_candidates || 0}`,
    `Queue: pending ${queue.pending_jobs || 0} | recent failed ${queue.recent_failed_jobs || 0} | stale claims ${queue.stale_claims || 0}`,
    `Platforms: live ${(platforms.enabled_publish_platforms || []).join(", ") || "none"} | deferred ${(platforms.deferred_platforms || []).map((item) => `${item.platform}:${item.status}`).join(", ") || "none"}`,
    `Performance: YT=${performance.platforms?.youtube_shorts?.performance_signal || "unknown"} | IG=${performance.platforms?.instagram_reels?.performance_signal || "unknown"} | FB=${performance.platforms?.facebook_reels?.performance_signal || "unknown"}`,
    `Growth plan: ${asArray(performance.growth_plan?.production_priorities).slice(0, 3).join(", ") || "none"}`,
    `Post evidence: latest ${post.latest_public_post?.id || "none"} | age ${post.latest_publish_age_hours ?? "unknown"}h | publish jobs ${post.publish_jobs_seen || 0}`,
  ];

  const blockers = [
    ...asArray(daily.runtime?.blockers),
    ...asArray(daily.publish_readiness?.blockers),
    ...asArray(daily.scheduler_window?.blockers),
    ...asArray(candidate.blockers),
    ...asArray(queue.hard_fails),
    ...asArray(post.blockers),
  ];
  lines.push(`Blockers: ${blockers.length ? Array.from(new Set(blockers)).slice(0, 5).join(", ") : "none"}`);
  lines.push(`Next: ${asArray(daily.next_day_action_plan)[0] || "Continue normal guarded scheduler operations."}`);
  lines.push("Safety: no manual blast, no token changes, disabled platforms stay deferred.");

  return {
    schema_version: 1,
    generated_at: daily.generated_at,
    mode: "read_only_discord_operations_summary",
    verdict: daily.verdict,
    message: lines.join("\n").slice(0, 1900),
    safety: daily.safety,
  };
}

function formatNormalOperationsMarkdown(report = {}) {
  const layers = report.layers || {};
  const candidate = layers.candidate_buffer || {};
  const runway = candidate.publish_window_runway || {};
  const runtime = layers.runtime_ownership || {};
  const post = layers.post_window_verification || {};
  const platform = layers.platform_health || {};
  const performance = layers.platform_performance || {};
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
    `- Publish-window runway: ${runway.covered_publish_windows_24h ?? 0}/${runway.publish_windows_24h ?? 0} covered`,
    `- Reserve: ${runway.reserve_candidates ?? 0}/${runway.reserve_target ?? 0}`,
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
    "## Platform Performance",
    "",
    `- Verdict: ${String(performance.verdict || "unknown").toUpperCase()}`,
    `- YouTube: ${performance.platforms?.youtube_shorts?.performance_signal || "unknown"} (${performance.platforms?.youtube_shorts?.avg_views_per_metric_post ?? "unknown"} avg measured views)`,
    `- Instagram: ${performance.platforms?.instagram_reels?.performance_signal || "unknown"} (${performance.platforms?.instagram_reels?.total_likes ?? 0} measured likes; local views ${performance.platforms?.instagram_reels?.total_views ?? 0})`,
    `- Facebook: ${performance.platforms?.facebook_reels?.performance_signal || "unknown"} (${performance.platforms?.facebook_reels?.metric_snapshot_posts ?? 0} metric posts)`,
    `- Growth priorities: ${asArray(performance.platform_growth_plan?.production_priorities).join(", ") || "none"}`,
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
  buildDailyStudioReport,
  buildCandidateBuffer,
  buildDiscordOperationsSummary,
  buildNormalOperationsReport,
  buildPlatformGrowthPlan,
  buildPlatformPerformance,
  buildPlatformHealth,
  buildPostWindowVerification,
  buildQueueHealth,
  buildRuntimeOwnership,
  buildSchedulerWindowReadiness,
  formatNormalOperationsMarkdown,
  formatDailyStudioReportMarkdown,
  formatSchedulerWindowReadinessMarkdown,
  normaliseVerdict,
  worstVerdict,
};
