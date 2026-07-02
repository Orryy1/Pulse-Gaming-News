"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_OUT = path.join(ROOT, "output", "autonomous-feedback-monitor");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function normaliseVerdict(value, fallback = "unknown") {
  const text = lower(value);
  if (["red", "fail", "failed", "blocked", "error"].includes(text)) return "red";
  if (["amber", "warn", "warning", "review", "partial"].includes(text)) return "amber";
  if (["green", "pass", "passed", "ok", "success"].includes(text)) return "green";
  return fallback;
}

function worstVerdict(values) {
  const normalised = values.map((value) => normaliseVerdict(value)).filter((value) => value !== "unknown");
  if (normalised.includes("red")) return "red";
  if (normalised.includes("amber")) return "amber";
  if (normalised.includes("green")) return "green";
  return "unknown";
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hoursBetween(later, earlier) {
  const a = parseDate(later);
  const b = parseDate(earlier);
  if (!a || !b) return null;
  return Math.max(0, (a.getTime() - b.getTime()) / 36e5);
}

function candidateIdSet(candidateReport = {}) {
  return new Map(asArray(candidateReport.candidates).map((candidate) => [clean(candidate.id), candidate]));
}

function candidateHasCurrentDirectMotion(candidate = {}) {
  const qa = candidate.preflight_qa || candidate.preflightQa || {};
  const visual = qa.checks?.visual_entity_match || qa.checks?.visualEntityMatch || {};
  const evidence = visual.evidence || {};
  const directCount = Number(evidence.direct_motion_asset_count || asArray(evidence.direct_motion_assets).length || 0);
  const visualPass = normaliseVerdict(visual.result || visual.verdict, "unknown") === "green";
  const qaPass = normaliseVerdict(qa.status || qa.verdict, "unknown") === "green";
  return directCount > 0 && (visualPass || qaPass);
}

function candidateHasCurrentVoiceTimestampPass(candidate = {}) {
  const qa = candidate.preflight_qa || candidate.preflightQa || {};
  const qaPass = normaliseVerdict(qa.status || qa.verdict, "unknown") === "green";
  const voice = qa.checks?.voice_quality || qa.checks?.voiceQuality || {};
  const timestamps = qa.checks?.timestamp_alignment || qa.checks?.timestampAlignment || {};
  return (
    qaPass &&
    normaliseVerdict(voice.result || voice.verdict, "unknown") === "green" &&
    normaliseVerdict(timestamps.result || timestamps.verdict, "unknown") === "green"
  );
}

function checkPass(check = {}) {
  return normaliseVerdict(check.result || check.verdict || check.status, "unknown") === "green";
}

function candidateHasCurrentTranscriptPreflightPass(candidate = {}) {
  const qa = candidate.preflight_qa || candidate.preflightQa || {};
  const qaPass = normaliseVerdict(qa.status || qa.verdict, "unknown") === "green";
  if (!qaPass) return false;
  const checks = qa.checks || {};
  const scriptScorecard = checks.script_scorecard || checks.scriptScorecard || {};
  const publicCopy = checks.public_copy || checks.publicCopy || {};
  const content = checks.content || {};
  const mediaHouse = checks.media_house || checks.mediaHouse || {};
  const transcriptAudience = candidate.transcript_audience || candidate.transcriptAudience || {};
  const transcriptAudienceVerdict = lower(transcriptAudience.verdict || transcriptAudience.status);
  if (
    ["pass", "passed", "green", "pass_or_not_flagged", "not_flagged"].includes(transcriptAudienceVerdict) &&
    asArray(transcriptAudience.blockers).length === 0
  ) {
    return true;
  }
  return checkPass(scriptScorecard) && checkPass(publicCopy) && checkPass(content) && checkPass(mediaHouse);
}

function readJsonSyncIfExists(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return fs.readJsonSync(filePath);
  } catch {
    return null;
  }
}

function candidateArtifactDir(candidate = {}) {
  const explicit = clean(candidate.artifact_dir || candidate.artifactDir || candidate.source?.artifact_dir || candidate.source?.artifactDir);
  if (explicit) return path.resolve(explicit);
  const exportedPath = clean(candidate.exported_path || candidate.exportedPath || candidate.source?.exported_path || candidate.source?.exportedPath);
  return exportedPath ? path.dirname(path.resolve(exportedPath)) : "";
}

function normaliseArtifactPath(value = "") {
  const resolved = clean(value);
  if (!resolved) return "";
  return path.resolve(resolved).replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "");
}

function artifactPathMatches(left = "", right = "") {
  const normalisedLeft = normaliseArtifactPath(left);
  const normalisedRight = normaliseArtifactPath(right);
  return !!normalisedLeft && !!normalisedRight && normalisedLeft === normalisedRight;
}

function dirsFromDispatchAction(action = {}) {
  const explicit = clean(action.artifact_dir || action.artifactDir);
  const paths = [
    explicit,
    action.canonical_manifest_path,
    action.platform_publish_manifest_path,
    action.video_path,
    action.captions_path,
    action.first_frame_source,
    action.cover_frame_source,
  ];
  return Array.from(new Set(paths
    .map((value) => {
      const text = clean(value);
      if (!text) return "";
      const resolved = path.resolve(text);
      return explicit && artifactPathMatches(text, explicit) ? resolved : path.dirname(resolved);
    })
    .filter(Boolean)
    .map((dir) => path.resolve(dir))));
}

function selectedArtifactDirsFromGuardedPreflight(report = {}, selectedActionId = "") {
  report = report && typeof report === "object" ? report : {};
  const selectedStoryId = storyIdFromActionId(selectedActionId);
  const dirs = [];
  for (const action of asArray(report.dispatch_ready_actions)) {
    const actionId = actionIdFromDispatchAction(action);
    if (selectedActionId && actionId !== selectedActionId && clean(action.story_id) !== selectedStoryId) continue;
    dirs.push(...dirsFromDispatchAction(action));
  }
  return Array.from(new Set(dirs.map((dir) => normaliseArtifactPath(dir)).filter(Boolean)));
}

function readyOrPass(value) {
  const text = lower(value);
  return ["ready", "pass", "passed", "ok", "success", "green"].includes(text);
}

function reportGeneratedAfter(report = {}, olderGeneratedAt = null) {
  const newer = parseDate(report.generated_at || report.generatedAt);
  const older = parseDate(olderGeneratedAt);
  return !!(newer && older && newer.getTime() > older.getTime());
}

function candidateHasCurrentAudioCaptionArtifactPass(candidate = {}, olderGeneratedAt = null) {
  const dir = candidateArtifactDir(candidate);
  if (!dir) return false;
  const voice = readJsonSyncIfExists(path.join(dir, "voice_quality_report.json")) || {};
  const caption = readJsonSyncIfExists(path.join(dir, "caption_manifest.json")) || {};
  const narration = readJsonSyncIfExists(path.join(dir, "narration_manifest.json")) || {};
  const newer =
    reportGeneratedAfter(voice, olderGeneratedAt) ||
    reportGeneratedAfter(caption, olderGeneratedAt) ||
    reportGeneratedAfter(narration, olderGeneratedAt);
  if (!newer) return false;
  const voicePass = readyOrPass(voice.verdict) && asArray(voice.blockers).length === 0;
  const captionPass =
    readyOrPass(caption.status || caption.verdict) &&
    asArray(caption.blockers).length === 0 &&
    (caption.checks?.word_timestamps_present === true ||
      Number(caption.word_timestamp_count || 0) > 0);
  const narrationPass =
    readyOrPass(narration.status || narration.verdict) &&
    asArray(narration.blockers).length === 0 &&
    narration.checks?.word_timestamps_present === true;
  return voicePass && captionPass && narrationPass;
}

function reportNewerThan(candidateReport = {}, olderGeneratedAt = null) {
  const newer = parseDate(candidateReport.generated_at || candidateReport.generatedAt);
  const older = parseDate(olderGeneratedAt);
  return !!(newer && older && newer.getTime() > older.getTime());
}

function extractDirectVideoSampleIds(markdown = "") {
  const ids = new Set();
  const samplePattern = /Direct-video gap sample:\s*([^\n.]+)/gi;
  let match;
  while ((match = samplePattern.exec(String(markdown || "")))) {
    for (const part of match[1].split(/[,;]/)) {
      const id = clean(part).replace(/[.`*]+$/g, "");
      if (id) ids.add(id);
    }
  }
  return Array.from(ids);
}

function storyIdFromActionId(actionId) {
  const text = clean(actionId);
  if (!text.includes(":")) return text;
  return text.split(":").slice(0, -1).join(":");
}

function actionIdFromDispatchAction(action = {}) {
  const storyId = clean(action.story_id);
  const platform = clean(action.platform);
  return storyId && platform ? `${storyId}:${platform}` : "";
}

function publishedPlatformPost(post = {}) {
  const status = lower(post.status);
  return status === "published" || (!!clean(post.external_id) && !["blocked", "failed", "skipped"].includes(status));
}

function publishedPlatformCountByStory(platformPosts = []) {
  const counts = new Map();
  for (const post of asArray(platformPosts)) {
    if (!publishedPlatformPost(post)) continue;
    const storyId = clean(post.story_id);
    if (!storyId) continue;
    counts.set(storyId, (counts.get(storyId) || 0) + 1);
  }
  return counts;
}

function guardedMonitorPlatformPriority(platform) {
  const text = clean(platform);
  if (text === "youtube_shorts") return 0;
  if (text === "instagram_reels") return 1;
  if (text === "facebook_reels" || text === "facebook_reel") return 2;
  return 9;
}

function selectedActionFromGuardedPreflight(report = {}, { platformPosts = [] } = {}) {
  if (!report || typeof report !== "object") return "";
  const actions = asArray(report.dispatch_ready_actions);
  if (!actions.length) return "";
  const counts = publishedPlatformCountByStory(platformPosts);
  const [selected] = [...actions].sort((a, b) => {
    const aCount = counts.get(clean(a.story_id)) || 0;
    const bCount = counts.get(clean(b.story_id)) || 0;
    if (aCount !== bCount) return aCount - bCount;
    const aPlatform = guardedMonitorPlatformPriority(a.platform);
    const bPlatform = guardedMonitorPlatformPriority(b.platform);
    if (aPlatform !== bPlatform) return aPlatform - bPlatform;
    return actionIdFromDispatchAction(a).localeCompare(actionIdFromDispatchAction(b));
  });
  return actionIdFromDispatchAction(selected);
}

function classifyDiscordFeedback({
  discordDigestPayload = null,
  candidateReport = {},
  generatedAt = new Date().toISOString(),
  selectedStoryIds = [],
} = {}) {
  if (!discordDigestPayload) {
    return {
      generated_at: null,
      age_hours: null,
      items: [],
      stale_count: 0,
      superseded_count: 0,
      real_blocker_count: 0,
      summary: "no_discord_digest_payload_loaded",
    };
  }

  const digestGeneratedAt = discordDigestPayload.generated_at || discordDigestPayload.generatedAt || null;
  const digestAge = hoursBetween(generatedAt, digestGeneratedAt);
  const summary = discordDigestPayload.summary || {};
  const markdown = clean(discordDigestPayload.markdown);
  const samples = extractDirectVideoSampleIds(discordDigestPayload.markdown || markdown);
  const candidatesById = candidateIdSet(candidateReport);
  const selected = new Set(asArray(selectedStoryIds).map(clean).filter(Boolean));
  const items = [];
  const hasDirectVideoWarning =
    Number(summary.scheduler_bridge_direct_video_gap_count || 0) > 0 ||
    Number(summary.scheduler_bridge_direct_video_subject_mismatch_count || 0) > 0 ||
    /direct-video/i.test(markdown);

  if (hasDirectVideoWarning) {
    const ids = samples.length ? samples : ["unknown"];
    for (const id of ids) {
      const candidate = candidatesById.get(id);
      const current = Boolean(candidate);
      const selectedForWindow = selected.size === 0 || selected.has(id);
      const hasDirectMotion = candidateHasCurrentDirectMotion(candidate);
      let state = "current_blocker";
      let blocker = true;
      let action = "hold_scheduler_and_repair_current_candidate";
      if (current && hasDirectMotion) {
        state = "superseded_by_current_preflight";
        blocker = false;
        action = "trust_current_scheduler_preflight";
      } else if (current && !selectedForWindow) {
        state = "backlog_repair_candidate_not_selected";
        blocker = false;
        action = "keep_backlog_repair_visible_without_holding_selected_window";
      } else if (!current || (digestAge !== null && digestAge > 6)) {
        state = "stale_or_not_current_candidate";
        blocker = false;
        action = "regenerate_render_health_digest";
      }
      items.push({
        type: "direct_motion_gap",
        story_id: id,
        state,
        blocker,
        generated_at: digestGeneratedAt,
        age_hours: digestAge === null ? null : Number(digestAge.toFixed(2)),
        current_candidate: current,
        selected_for_window: selectedForWindow,
        current_direct_motion: hasDirectMotion,
        action,
      });
    }
  }

  return {
    generated_at: digestGeneratedAt,
    age_hours: digestAge === null ? null : Number(digestAge.toFixed(2)),
    items,
    stale_count: items.filter((item) => item.state === "stale_or_not_current_candidate").length,
    backlog_count: items.filter((item) => item.state === "backlog_repair_candidate_not_selected").length,
    superseded_count: items.filter((item) => item.state === "superseded_by_current_preflight").length,
    real_blocker_count: items.filter((item) => item.blocker).length,
    summary: items.length ? "discord_feedback_classified" : "discord_feedback_no_actionable_items",
  };
}

function normaliseIngestedDiscordFeedback(report = null) {
  if (!report) {
    return {
      capability: { status: "not_run" },
      summary: {
        messages_seen: 0,
        actionable_count: 0,
        blocking_count: 0,
        stale_count: 0,
        unmatched_count: 0,
      },
      items: [],
    };
  }
  return {
    capability: report.capability || { status: "unknown" },
    summary: {
      messages_seen: Number(report.summary?.messages_seen || 0),
      actionable_count: Number(report.summary?.actionable_count || 0),
      blocking_count: Number(report.summary?.blocking_count || 0),
      stale_count: Number(report.summary?.stale_count || 0),
      unmatched_count: Number(report.summary?.unmatched_count || 0),
    },
    items: asArray(report.items),
  };
}

function buildTranscriptAudienceFeedback({
  transcriptAudienceReport = null,
  selectedStoryIds = [],
  candidateReport = {},
  selectedArtifactDirs = [],
} = {}) {
  const selected = new Set(asArray(selectedStoryIds).map(clean).filter(Boolean));
  const candidates = candidateIdSet(candidateReport);
  const stories = asArray(transcriptAudienceReport?.stories);
  const selectedDirs = new Set(asArray(selectedArtifactDirs).map(normaliseArtifactPath).filter(Boolean));
  const selectedArtifactPassStories = new Set();
  for (const story of stories) {
    const storyId = clean(story.story_id || story.id);
    const artifactDir = normaliseArtifactPath(story.artifact_dir || story.artifactDir);
    if (!storyId || !selected.has(storyId) || !artifactDir || !selectedDirs.has(artifactDir)) continue;
    if (clean(story.verdict) === "pass") selectedArtifactPassStories.add(storyId);
  }
  const items = stories
    .filter((story) => clean(story.verdict) && clean(story.verdict) !== "pass")
    .map((story) => {
      const storyId = clean(story.story_id || story.id);
      const selectedForWindow = selected.has(storyId);
      const candidate = candidates.get(storyId);
      const currentCandidate = !!candidate;
      const artifactDir = normaliseArtifactPath(story.artifact_dir || story.artifactDir);
      const selectedArtifactKnown = selectedForWindow && selectedDirs.size > 0;
      const matchesSelectedArtifact = selectedArtifactKnown && artifactDir && selectedDirs.has(artifactDir);
      const supersededBySelectedArtifactPass =
        selectedForWindow &&
        selectedArtifactPassStories.has(storyId) &&
        (!artifactDir || !matchesSelectedArtifact);
      const supersededByCurrentPreflight =
        supersededBySelectedArtifactPass ||
        ((selectedForWindow || currentCandidate) && candidateHasCurrentTranscriptPreflightPass(candidate));
      const staleDifferentArtifact =
        selectedArtifactKnown &&
        artifactDir &&
        !matchesSelectedArtifact &&
        !supersededBySelectedArtifactPass;
      const blocksPublishing =
        selectedForWindow &&
        !supersededByCurrentPreflight &&
        (!selectedArtifactKnown || !artifactDir || matchesSelectedArtifact);
      return {
        story_id: storyId,
        title: clean(story.title),
        verdict: clean(story.verdict),
        blockers: asArray(story.blockers),
        selected_for_window: selectedForWindow,
        current_candidate: currentCandidate,
        selected_artifact: matchesSelectedArtifact,
        stale_different_artifact: staleDifferentArtifact,
        superseded: supersededByCurrentPreflight,
        state: supersededByCurrentPreflight
          ? "superseded_by_current_transcript_preflight"
          : blocksPublishing
            ? "current_selected_transcript_blocker"
            : staleDifferentArtifact
              ? "historical_transcript_debt_different_artifact"
            : currentCandidate
              ? "current_candidate_transcript_repair"
              : "historical_transcript_debt",
        blocks_publishing: blocksPublishing,
        action: blocksPublishing
          ? "hold_selected_candidate_and_repair_transcript"
          : supersededByCurrentPreflight
            ? "keep_historical_transcript_debt_visible_current_package_passed"
            : staleDifferentArtifact
              ? "keep_historical_transcript_debt_visible_different_artifact"
            : currentCandidate
            ? "route_candidate_transcript_to_repair_lane"
            : "keep_historical_transcript_debt_visible",
      };
    });

  return {
    generated_at: transcriptAudienceReport?.generated_at || null,
    summary: {
      total: Number(transcriptAudienceReport?.summary?.total || 0),
      pass: Number(transcriptAudienceReport?.summary?.pass || 0),
      rewrite_required: Number(transcriptAudienceReport?.summary?.rewrite_required || 0),
      current_blocking_count: items.filter((item) => item.blocks_publishing).length,
      current_candidate_rewrite_count: items.filter((item) => item.current_candidate).length,
      superseded_by_current_preflight_count: items.filter((item) => item.superseded).length,
    },
    items,
  };
}

function latestPublishJob(recentJobs = []) {
  return asArray(recentJobs)
    .filter((job) => clean(job.kind) === "publish")
    .sort((a, b) => {
      const at = parseDate(b.completed_at || b.updated_at || b.created_at)?.getTime() || 0;
      const bt = parseDate(a.completed_at || a.updated_at || a.created_at)?.getTime() || 0;
      return at - bt;
    })[0] || null;
}

function platformEvidenceTimestamps(post = {}) {
  return [post.created_at, post.updated_at, post.published_at]
    .map(parseDate)
    .filter(Boolean)
    .map((date) => date.getTime());
}

function hasPlatformEvidenceDuringJob(platformPosts = [], job = {}) {
  const completed = parseDate(job.completed_at || job.updated_at || job.created_at);
  if (!completed) return false;
  const started = parseDate(job.created_at || job.run_at || job.updated_at || job.completed_at);
  const startMs = started ? started.getTime() : completed.getTime();
  const endMs = completed.getTime();
  const graceMs = 60 * 1000;
  return asArray(platformPosts).some((post) =>
    platformEvidenceTimestamps(post).some((time) => time >= startMs && time <= endMs + graceMs),
  );
}

function buildPostWindowFeedback({ recentJobs = [], platformPosts = [] } = {}) {
  const anomalies = [];
  const job = latestPublishJob(recentJobs);
  if (job && lower(job.status) === "done") {
    const completedAt = job.completed_at || job.updated_at || job.created_at;
    if (!hasPlatformEvidenceDuringJob(platformPosts, job)) {
      anomalies.push({
        type: "publish_job_without_platform_evidence",
        job_id: job.id ?? null,
        completed_at: completedAt || null,
        action: "inspect_guarded_publish_result_and_scheduler_selection",
      });
    }
  }
  return {
    latest_publish_job: job
      ? {
          id: job.id ?? null,
          status: clean(job.status),
          completed_at: job.completed_at || job.updated_at || job.created_at || null,
        }
      : null,
    anomalies,
    anomaly_count: anomalies.length,
  };
}

function buildLearningFeedback(learningReport = {}) {
  const blockers = asArray(learningReport.blockers);
  return {
    status: clean(learningReport.status || "unknown"),
    target_count: Number(learningReport.target_count || 0),
    blockers,
    automatic_adjustments: learningReport.automatic_adjustments || {},
    blocks_publishing: false,
    action: blockers.length
      ? "keep_learning_blockers_visible_but_do_not_block_enabled_platform_scheduler"
      : "continue_learning_loop",
  };
}

function buildTtsCaptionFeedback(materializationReport = {}, { candidateReport = {}, selectedStoryIds = [] } = {}) {
  const failedJobs = asArray(materializationReport.jobs).filter((job) =>
    clean(job.status).toLowerCase() === "failed" || clean(job.error),
  );
  const candidatesById = candidateIdSet(candidateReport);
  const selectedIds = new Set(asArray(selectedStoryIds).map(clean).filter(Boolean));
  const supersededItems = [];
  const items = failedJobs.map((job) => {
    const error = clean(job.error || "unknown_tts_caption_failure");
    let type = "tts_caption_materialization_failed";
    if (/whisper|alignment|timestamp/i.test(error)) type = "caption_alignment_failed";
    else if (/server_down|server_error|local_tts|tts/i.test(error)) type = "local_tts_failed";
    const storyId = clean(job.story_id || job.id || "unknown");
    if (selectedIds.size > 0 && storyId && !selectedIds.has(storyId)) {
      supersededItems.push({
        story_id: storyId,
        title: clean(job.title),
        type,
        error,
        superseded_by: "not_selected_for_current_guarded_window",
      });
      return null;
    }
    const candidate = candidatesById.get(storyId);
    if (
      (reportNewerThan(candidateReport, materializationReport.generated_at) &&
        candidateHasCurrentVoiceTimestampPass(candidate)) ||
      candidateHasCurrentAudioCaptionArtifactPass(candidate, materializationReport.generated_at)
    ) {
      supersededItems.push({
        story_id: storyId,
        title: clean(job.title),
        type,
        error,
        superseded_by: "current_candidate_preflight_voice_and_timestamp_pass",
      });
      return null;
    }
    return {
      story_id: storyId,
      title: clean(job.title),
      type,
      error,
      blocks_publishing: true,
      action: type === "caption_alignment_failed"
        ? "repair_script_or_timestamps_then_regenerate_audio"
        : "recover_local_tts_or_select_next_safe_candidate",
    };
  }).filter(Boolean);
  const failedCount = items.length;
  return {
    generated_at: materializationReport.generated_at || null,
    failed_count: failedCount,
    superseded_count: supersededItems.length,
    superseded_items: supersededItems,
    items,
    blocks_publishing: failedCount > 0 || items.length > 0,
  };
}

function buildPublishRunwayFeedback(blockerResolutionReport = {}) {
  const summary = blockerResolutionReport.summary || {};
  const runway = blockerResolutionReport.publish_runway || {};
  const priorityItems = asArray(blockerResolutionReport.priority_items).slice(0, 8).map((item) => ({
    story_id: clean(item.story_id),
    title: clean(item.title),
    lane: clean(item.resolution_lane || item.lane),
    priority: Number(item.priority || 0),
    safe_next_command: clean(item.safe_next_command || item.recommended_command || item.command),
  }));
  const liveCandidates = Number(summary.live_publish_candidates ?? runway.publishable_now ?? 0);
  const greenPackAvailable = Number(runway.green_pack_available ?? 0);
  const repairableBacklog = Number(summary.auto_repairable_items ?? runway.repairable_backlog ?? 0);
  const deadEndBlockers = Number(summary.dead_end_blockers || 0);
  const status = clean(runway.status || "unknown");
  const blockers = [];
  if (liveCandidates <= 0 && greenPackAvailable <= 0 && repairableBacklog > 0) {
    blockers.push("no_live_candidates_with_repairable_backlog");
  }
  if (deadEndBlockers > 0) blockers.push("dead_end_blockers_present");
  return {
    status,
    live_publish_candidates: liveCandidates,
    green_pack_available: greenPackAvailable,
    repairable_backlog: repairableBacklog,
    dead_end_blockers: deadEndBlockers,
    recovery_lanes: blockerResolutionReport.recovery_lanes || {},
    recommended_sequence: asArray(runway.recommended_sequence),
    next_action: clean(runway.next_action || ""),
    priority_items: priorityItems,
    blockers,
    blocks_publishing: blockers.length > 0,
    action: blockers.length
      ? "run_safe_repair_lanes_then_regenerate_scheduler_preflight"
      : "continue_guarded_scheduler",
  };
}

function reportAgeHours(generatedAt, report = {}) {
  report = report && typeof report === "object" ? report : {};
  const value = report.generated_at || report.generatedAt || null;
  const age = hoursBetween(generatedAt, value);
  return age === null ? null : Number(age.toFixed(2));
}

function reportIsStale(generatedAt, report = {}, maxAgeHours = 6) {
  const age = reportAgeHours(generatedAt, report);
  return age !== null && age > maxAgeHours;
}

function reportGeneratedAtMs(report = {}) {
  report = report && typeof report === "object" ? report : {};
  const date = parseDate(report.generated_at || report.generatedAt);
  return date ? date.getTime() : 0;
}

function hasCurrentEnabledRunwayProof({
  dryRunPublishPlan = {},
  guardedDispatchPreflightReport = {},
} = {}) {
  dryRunPublishPlan = dryRunPublishPlan && typeof dryRunPublishPlan === "object" ? dryRunPublishPlan : {};
  guardedDispatchPreflightReport =
    guardedDispatchPreflightReport && typeof guardedDispatchPreflightReport === "object"
      ? guardedDispatchPreflightReport
      : {};
  const drySummary = dryRunPublishPlan.summary || {};
  const guardedSummary = guardedDispatchPreflightReport.summary || {};
  const dryRunReady =
    Number(drySummary.platform_enabled_dry_run_action_count || 0) > 0 &&
    Number(drySummary.blocked_action_count || 0) === 0;
  const guardedReady =
    normaliseVerdict(guardedDispatchPreflightReport.verdict) === "green" &&
    (Number(guardedSummary.dispatch_ready_action_count || 0) > 0 ||
      asArray(guardedDispatchPreflightReport.dispatch_ready_actions).length > 0) &&
    Number(guardedSummary.blocked_action_count || 0) === 0;
  const newestGeneratedAtMs = Math.max(
    reportGeneratedAtMs(dryRunPublishPlan),
    reportGeneratedAtMs(guardedDispatchPreflightReport),
  );
  return {
    ready: dryRunReady || guardedReady,
    dry_run_ready: dryRunReady,
    guarded_ready: guardedReady,
    newest_generated_at_ms: newestGeneratedAtMs,
  };
}

function currentRunwaySupersedesReport({
  generatedAt,
  report = {},
  runwayProof = {},
  maxAgeHours = 6,
} = {}) {
  if (!runwayProof.ready || !reportIsStale(generatedAt, report, maxAgeHours)) return false;
  const reportMs = reportGeneratedAtMs(report);
  if (!reportMs) return true;
  return runwayProof.newest_generated_at_ms > reportMs;
}

function nextSafePublishFromCadence(report = {}) {
  return (
    report.next_safe_publish?.next_safe_publish_at_utc ||
    report.summary?.next_safe_publish_at_utc ||
    report.nextSafePublish?.nextSafePublishAtUtc ||
    null
  );
}

function competitorVerdict(report = {}) {
  const raw = clean(report.verdict || report.status);
  if (/^pass$/i.test(raw)) return "green";
  if (/^partial$/i.test(raw)) return "amber";
  if (/^(fail|blocked)$/i.test(raw)) return "red";
  return normaliseVerdict(raw, Object.keys(report).length ? "amber" : "unknown");
}

function commercialVerdict(report = {}) {
  const status = lower(report.status);
  if (!Object.keys(report || {}).length) return "unknown";
  if (/active|ready|learning|ok/.test(status)) return "green";
  if (/blocked|fail|error/.test(status)) return "red";
  return "amber";
}

function buildMarketIntelligenceFeedback({
  generatedAt = new Date().toISOString(),
  candidateSupplyReport = {},
  competitorForensicsReport = {},
  competitorQualityGateReport = {},
  commercialLearningReport = {},
} = {}) {
  const candidateVerdict = normaliseVerdict(candidateSupplyReport.verdict, Object.keys(candidateSupplyReport).length ? "amber" : "unknown");
  const forensicsVerdict = competitorVerdict(competitorForensicsReport);
  const qualityVerdict = competitorVerdict(competitorQualityGateReport);
  const commercialStatus = commercialVerdict(commercialLearningReport);
  const advisories = [];
  if (candidateVerdict === "red") advisories.push("candidate_supply_red");
  if (forensicsVerdict === "unknown") advisories.push("competitor_forensics_missing");
  if (forensicsVerdict === "red") advisories.push("competitor_forensics_failed");
  if (qualityVerdict === "red") advisories.push("competitor_quality_gate_blocked");
  if (commercialStatus === "unknown") advisories.push("commercial_learning_missing");
  return {
    status: worstVerdict([candidateVerdict, forensicsVerdict, qualityVerdict, commercialStatus]),
    blocks_publishing: false,
    candidate_supply: {
      verdict: candidateVerdict,
      age_hours: reportAgeHours(generatedAt, candidateSupplyReport),
      fresh_source_backed_stories_24h: Number(candidateSupplyReport.summary?.fresh_source_backed_stories_24h || 0),
      green_ready_candidates: Number(candidateSupplyReport.summary?.green_ready_candidates || 0),
      durable_green_ready_candidates: Number(candidateSupplyReport.summary?.durable_green_ready_candidates || 0),
      ready_candidates_expiring_within_24h: Number(candidateSupplyReport.summary?.ready_candidates_expiring_within_24h || 0),
      non_ready_candidates_expiring_within_24h: Number(candidateSupplyReport.summary?.non_ready_candidates_expiring_within_24h || 0),
      v4_ready_candidates: Number(candidateSupplyReport.summary?.v4_ready_candidates || 0),
      next_action: clean(candidateSupplyReport.next_action || ""),
      blockers: asArray(candidateSupplyReport.blockers),
      warnings: asArray(candidateSupplyReport.warnings),
    },
    competitor_forensics: {
      verdict: forensicsVerdict,
      age_hours: reportAgeHours(generatedAt, competitorForensicsReport),
      reviewed_channels: Number(competitorForensicsReport.summary?.reviewed_channel_count || 0),
      assessed_videos: Number(competitorForensicsReport.summary?.assessed_video_count || 0),
      outliers: Number(competitorForensicsReport.summary?.recent_outlier_count || 0),
      pulse_rules: Number(competitorForensicsReport.summary?.pulse_upgrade_rule_count || 0),
    },
    competitor_quality_gate: {
      verdict: qualityVerdict,
      green_stories: Number(competitorQualityGateReport.summary?.green_story_count || 0),
      amber_stories: Number(competitorQualityGateReport.summary?.amber_story_count || 0),
      red_stories: Number(competitorQualityGateReport.summary?.red_story_count || 0),
    },
    commercial_learning: {
      verdict: commercialStatus,
      clicks: Number(commercialLearningReport.totals?.clicks || 0),
      clicked_stories: Number(commercialLearningReport.totals?.clicked_stories || 0),
      recommendations: asArray(commercialLearningReport.recommendations).length,
    },
    advisories,
    action: advisories.length
      ? "keep_market_learning_visible_without_bypassing_publish_gates"
      : "continue_autonomous_market_learning_loop",
  };
}

function buildAutonomousFeedbackReport({
  generatedAt = new Date().toISOString(),
  normalOperationsReport = {},
  schedulerWindowReadiness = null,
  guardedDispatchPreflightReport = null,
  candidateReport = {},
  discordDigestPayload = null,
  ingestedDiscordFeedbackReport = null,
  transcriptAudienceReport = null,
  learningReport = {},
  ttsCaptionReport = {},
  dryRunPublishPlan = {},
  publishCadenceReport = {},
  candidateSupplyReport = {},
  competitorForensicsReport = {},
  competitorQualityGateReport = {},
  commercialLearningReport = {},
  publishBlockerResolutionReport = {},
  recentJobs = [],
  platformPosts = [],
} = {}) {
  const layers = normalOperationsReport.layers || {};
  const runtime = layers.runtime_ownership || {};
  const readiness = layers.publish_readiness || {};
  const queue = layers.queue_health || {};
  const candidateBuffer = layers.candidate_buffer || {};
  const postWindow = layers.post_window_verification || {};
  const runwayProof = hasCurrentEnabledRunwayProof({
    dryRunPublishPlan,
    guardedDispatchPreflightReport,
  });
  const staleNormalOpsSuperseded = currentRunwaySupersedesReport({
    generatedAt,
    report: normalOperationsReport,
    runwayProof,
  });
  const staleSchedulerWindowSuperseded = currentRunwaySupersedesReport({
    generatedAt,
    report: schedulerWindowReadiness || {},
    runwayProof,
  });
  const readinessEffective = staleNormalOpsSuperseded && normaliseVerdict(readiness.verdict) === "red"
    ? {
        ...readiness,
        verdict: "amber",
        blockers: [],
        advisory: [
          ...asArray(readiness.advisory),
          "stale_publish_readiness_superseded_by_current_enabled_runway",
        ],
      }
    : readiness;
  const guardedSelection = normalOperationsReport.guarded_selection || {};
  const currentGuardedActionId =
    selectedActionFromGuardedPreflight(guardedDispatchPreflightReport, { platformPosts }) ||
    guardedSelection.action_id ||
    "";
  const discordFeedback = classifyDiscordFeedback({
    discordDigestPayload,
    candidateReport,
    generatedAt,
    selectedStoryIds: [storyIdFromActionId(currentGuardedActionId)].filter(Boolean),
  });
  const ingestedDiscordFeedback = normaliseIngestedDiscordFeedback(ingestedDiscordFeedbackReport);
  const transcriptAudienceFeedback = buildTranscriptAudienceFeedback({
    transcriptAudienceReport,
    selectedStoryIds: [storyIdFromActionId(currentGuardedActionId)].filter(Boolean),
    candidateReport,
    selectedArtifactDirs: selectedArtifactDirsFromGuardedPreflight(
      guardedDispatchPreflightReport,
      currentGuardedActionId,
    ),
  });
  const selectedStoryIds = [storyIdFromActionId(currentGuardedActionId)].filter(Boolean);
  const postWindowFeedback = buildPostWindowFeedback({ recentJobs, platformPosts });
  const learningFeedback = buildLearningFeedback(learningReport);
  const ttsCaptionFeedback = buildTtsCaptionFeedback(ttsCaptionReport, { candidateReport, selectedStoryIds });
  const publishRunwayFeedback = buildPublishRunwayFeedback(publishBlockerResolutionReport);
  const marketIntelligence = buildMarketIntelligenceFeedback({
    generatedAt,
    candidateSupplyReport,
    competitorForensicsReport,
    competitorQualityGateReport,
    commercialLearningReport,
  });
  const schedulerWindowRaw = schedulerWindowReadiness || {};
  const schedulerWindow = staleSchedulerWindowSuperseded && normaliseVerdict(schedulerWindowRaw.verdict) === "red"
    ? {
        ...schedulerWindowRaw,
        verdict: "amber",
        ready_for_next_window_boolean: true,
        blockers: [],
        advisory: [
          ...asArray(schedulerWindowRaw.advisory),
          "stale_scheduler_window_superseded_by_current_enabled_runway",
        ],
      }
    : schedulerWindowRaw;
  const schedulerBlockers = [
    ...asArray(schedulerWindow.blockers),
    ...(guardedSelection.exhausted === true && !guardedSelection.action_id
      ? ["guarded_selection_exhausted"]
      : []),
  ];

  const blockers = [
    ...asArray(runtime.blockers).map((item) => `runtime:${item}`),
    ...asArray(readinessEffective.blockers).map((item) => `publish_readiness:${item}`),
    ...asArray(queue.hard_fails).map((item) => `queue:${item}`),
    ...schedulerBlockers.map((item) => `scheduler_window:${item}`),
    ...discordFeedback.items
      .filter((item) => item.blocker)
      .map((item) => `discord_feedback:direct_motion_gap_current:${item.story_id}`),
    ...ingestedDiscordFeedback.items
      .filter((item) => item.blocks_publishing)
      .map((item) => {
        const category = asArray(item.categories)[0] || "feedback";
        return `discord_ingested_feedback:${item.story_id || "unmatched"}:${category}`;
      }),
    ...transcriptAudienceFeedback.items
      .filter((item) => item.blocks_publishing)
      .map((item) => `transcript_audience:${item.story_id}:${asArray(item.blockers)[0] || "rewrite_required"}`),
    ...ttsCaptionFeedback.items
      .filter((item) => item.blocks_publishing)
      .map((item) => `tts_caption:${item.story_id}:${item.type}`),
    ...publishRunwayFeedback.blockers.map((item) => `publish_runway:${item}`),
    ...postWindowFeedback.anomalies.map((item) => `post_window:${item.type}`),
  ];

  const baseVerdict = worstVerdict([
    runtime.verdict,
    readinessEffective.verdict,
    queue.verdict,
    candidateBuffer.verdict,
    postWindow.verdict,
    schedulerWindow.verdict,
    staleNormalOpsSuperseded && normaliseVerdict(normalOperationsReport.overall_verdict) === "red"
      ? "amber"
      : normalOperationsReport.overall_verdict,
  ]);
  const verdict = blockers.length
    ? "red"
    : baseVerdict === "red"
      ? "red"
      : baseVerdict === "green"
        ? "green"
        : "amber";

  let currentAction = "observe_next_scheduler_window";
  if (ttsCaptionFeedback.blocks_publishing) currentAction = "repair_tts_caption_blockers";
  else if (ingestedDiscordFeedback.summary.blocking_count > 0) currentAction = "hold_scheduler_and_apply_discord_feedback";
  else if (transcriptAudienceFeedback.summary.current_blocking_count > 0) currentAction = "repair_transcript_audience_blockers";
  else if (discordFeedback.real_blocker_count > 0) currentAction = "hold_scheduler_and_repair_current_candidate";
  else if (publishRunwayFeedback.blocks_publishing) currentAction = "run_safe_repair_lanes_for_candidate_runway";
  else if (schedulerBlockers.length > 0 || (guardedSelection.exhausted === true && !guardedSelection.action_id)) {
    currentAction = "repair_guarded_scheduler_selection";
  }
  else if (postWindowFeedback.anomaly_count > 0) currentAction = "diagnose_publish_window_without_platform_evidence";
  else if (normaliseVerdict(runtime.verdict) === "red") currentAction = "recover_runtime_ownership";
  else if (normaliseVerdict(readinessEffective.verdict) === "red") currentAction = "hold_scheduler_and_clear_publish_readiness";
  else if (Number(candidateBuffer.counts?.ready_candidates || 0) === 0) currentAction = "rebuild_fresh_green_candidate_buffer";

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "read_only_autonomous_feedback_monitor",
    verdict,
    current_action: currentAction,
    blockers: Array.from(new Set(blockers)),
    runtime: {
      verdict: normaliseVerdict(runtime.verdict),
      auto_publish: runtime.facts?.auto_publish === true,
      use_job_queue: runtime.facts?.use_job_queue || null,
      scheduler_active: runtime.facts?.scheduler_active === true,
      dispatch_mode: runtime.facts?.dispatch_mode || null,
    },
    publish_readiness: {
      verdict: normaliseVerdict(readinessEffective.verdict),
      blockers: asArray(readinessEffective.blockers),
      advisory: asArray(readinessEffective.advisory),
    },
    candidate_buffer: {
      verdict: normaliseVerdict(candidateBuffer.verdict),
      ready_candidates: Number(candidateBuffer.counts?.ready_candidates || 0),
      source_safe_candidates: Number(candidateBuffer.counts?.source_safe_candidates || 0),
      v4_ready_candidates: Number(candidateBuffer.counts?.v4_ready_candidates || 0),
      top_candidates: asArray(candidateBuffer.top_candidates).map((candidate) => ({
        id: clean(candidate.id),
        title: clean(candidate.title),
        score: Number(candidate.score || 0),
      })),
      blockers: asArray(candidateBuffer.blockers),
      warnings: asArray(candidateBuffer.warnings),
    },
    scheduler: {
      verdict: normaliseVerdict(schedulerWindow.verdict),
      ready_for_next_window_boolean: schedulerWindow.ready_for_next_window_boolean === true,
      next_safe_publish_at_utc:
        nextSafePublishFromCadence(publishCadenceReport) ||
        schedulerWindow.next_publish_window_utc ||
        postWindow.next_safe_publish_at_utc ||
        null,
      selected_action: currentGuardedActionId || schedulerWindow.selected_action?.action_id || null,
      guarded_exhausted: guardedSelection.exhausted === true,
      skipped_actions: asArray(schedulerWindow.skipped_actions || guardedSelection.skipped_actions).slice(0, 8),
      blockers: schedulerBlockers,
    },
    stale_evidence: {
      normal_operations_superseded: staleNormalOpsSuperseded,
      scheduler_window_superseded: staleSchedulerWindowSuperseded,
      current_enabled_runway_ready: runwayProof.ready,
      dry_run_ready: runwayProof.dry_run_ready,
      guarded_preflight_ready: runwayProof.guarded_ready,
    },
    discord_feedback: discordFeedback,
    ingested_discord_feedback: ingestedDiscordFeedback,
    transcript_audience_feedback: transcriptAudienceFeedback,
    tts_caption_feedback: ttsCaptionFeedback,
    publish_runway_feedback: publishRunwayFeedback,
    post_window_feedback: postWindowFeedback,
    learning_feedback: learningFeedback,
    market_intelligence: marketIntelligence,
    safety: {
      read_only: true,
      no_live_publish: true,
      no_oauth_or_token_mutation: true,
      no_production_db_mutation: true,
      disabled_platforms_stay_deferred: true,
    },
  };
}

function formatAutonomousFeedbackMarkdown(report = {}) {
  const lines = [
    "# Pulse Gaming Autonomous Feedback Monitor",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Verdict: ${String(report.verdict || "unknown").toUpperCase()}`,
    `Current action: ${report.current_action || "unknown"}`,
    "",
    "## Scheduler",
    "",
    `- Next safe publish UTC: ${report.scheduler?.next_safe_publish_at_utc || "unknown"}`,
    `- Selected action: ${report.scheduler?.selected_action || "none"}`,
    `- AUTO_PUBLISH: ${report.runtime?.auto_publish === true}`,
    `- USE_JOB_QUEUE: ${report.runtime?.use_job_queue || "unknown"}`,
    `- Scheduler active: ${report.runtime?.scheduler_active === true}`,
    "",
    "## Current Candidates",
    "",
  ];
  for (const candidate of asArray(report.candidate_buffer?.top_candidates)) {
    lines.push(`- ${candidate.id}: ${candidate.title} (${candidate.score})`);
  }
  if (!asArray(report.candidate_buffer?.top_candidates).length) lines.push("- none");
  lines.push(
    "",
    "## TTS / Caption Feedback",
    "",
    `- Failed materialisations: ${report.tts_caption_feedback?.failed_count || 0}`,
  );
  for (const item of asArray(report.tts_caption_feedback?.items)) {
    lines.push(`- ${item.story_id}: ${item.type}; action=${item.action}`);
  }
  if (!asArray(report.tts_caption_feedback?.items).length) lines.push("- none");
  lines.push(
    "",
    "## Publish Runway",
    "",
    `- Live publish candidates: ${report.publish_runway_feedback?.live_publish_candidates || 0}`,
    `- Repairable backlog: ${report.publish_runway_feedback?.repairable_backlog || 0}`,
    `- Dead-end blockers: ${report.publish_runway_feedback?.dead_end_blockers || 0}`,
    `- Action: ${report.publish_runway_feedback?.action || "unknown"}`,
  );
  for (const item of asArray(report.publish_runway_feedback?.priority_items).slice(0, 5)) {
    lines.push(`- ${item.story_id}: ${item.lane} -> ${item.title}`);
  }
  if (!asArray(report.publish_runway_feedback?.priority_items).length) lines.push("- none");
  lines.push(
    "",
    "## Discord Feedback",
    "",
    `- Current blockers: ${report.discord_feedback?.real_blocker_count || 0}`,
    `- Superseded: ${report.discord_feedback?.superseded_count || 0}`,
    `- Stale/not current: ${report.discord_feedback?.stale_count || 0}`,
    `- Live ingestion capability: ${report.ingested_discord_feedback?.capability?.status || "unknown"}`,
    `- Live ingestion actionable: ${report.ingested_discord_feedback?.summary?.actionable_count || 0}`,
    `- Live ingestion blockers: ${report.ingested_discord_feedback?.summary?.blocking_count || 0}`,
  );
  for (const item of asArray(report.discord_feedback?.items)) {
    lines.push(`- ${item.story_id}: ${item.type} -> ${item.state}; action=${item.action}`);
  }
  for (const item of asArray(report.ingested_discord_feedback?.items)) {
    lines.push(
      `- live ${item.story_id || "unmatched"}: ${asArray(item.categories).join(", ")} -> ${item.state}; action=${item.action}`,
    );
  }
  lines.push(
    "",
    "## Transcript Audience Feedback",
    "",
    `- Rewrite required: ${report.transcript_audience_feedback?.summary?.rewrite_required || 0}`,
    `- Current candidate blockers: ${report.transcript_audience_feedback?.summary?.current_blocking_count || 0}`,
  );
  for (const item of asArray(report.transcript_audience_feedback?.items).filter((row) => row.current_candidate).slice(0, 8)) {
    lines.push(`- ${item.story_id}: ${asArray(item.blockers).join(", ") || "rewrite_required"}; action=${item.action}`);
  }
  lines.push("", "## Post Window Feedback", "");
  for (const anomaly of asArray(report.post_window_feedback?.anomalies)) {
    lines.push(`- ${anomaly.type}: job #${anomaly.job_id || "unknown"} at ${anomaly.completed_at || "unknown"}`);
  }
  if (!asArray(report.post_window_feedback?.anomalies).length) lines.push("- none");
  lines.push(
    "",
    "## Market Intelligence",
    "",
    `- Candidate supply: ${report.market_intelligence?.candidate_supply?.verdict || "unknown"} (${report.market_intelligence?.candidate_supply?.durable_green_ready_candidates || 0} durable GREEN, ${report.market_intelligence?.candidate_supply?.green_ready_candidates || 0} raw GREEN, ${report.market_intelligence?.candidate_supply?.non_ready_candidates_expiring_within_24h || 0} expiring non-ready, ${report.market_intelligence?.candidate_supply?.fresh_source_backed_stories_24h || 0} fresh source-backed)`,
    `- Competitor forensics: ${report.market_intelligence?.competitor_forensics?.verdict || "unknown"} (${report.market_intelligence?.competitor_forensics?.assessed_videos || 0} videos, ${report.market_intelligence?.competitor_forensics?.outliers || 0} outliers)`,
    `- Competitor quality gate: ${report.market_intelligence?.competitor_quality_gate?.verdict || "unknown"} (${report.market_intelligence?.competitor_quality_gate?.green_stories || 0} GREEN, ${report.market_intelligence?.competitor_quality_gate?.red_stories || 0} RED)`,
    `- Commercial learning: ${report.market_intelligence?.commercial_learning?.verdict || "unknown"} (${report.market_intelligence?.commercial_learning?.clicks || 0} clicks)`,
  );
  for (const advisory of asArray(report.market_intelligence?.advisories)) lines.push(`- advisory: ${advisory}`);
  lines.push("", "## Blockers", "");
  for (const blocker of asArray(report.blockers)) lines.push(`- ${blocker}`);
  if (!asArray(report.blockers).length) lines.push("- none");
  lines.push("");
  return lines.join("\n");
}

function formatAutonomousFeedbackDiscord(report = {}) {
  const candidates = asArray(report.candidate_buffer?.top_candidates)
    .slice(0, 3)
    .map((candidate) => `- ${candidate.score || 0} ${candidate.id}: ${candidate.title}`);
  const lines = [
    `**Pulse Gaming Autonomous Feedback**`,
    `Status: ${String(report.verdict || "unknown").toUpperCase()}`,
    `Action: ${report.current_action || "unknown"}`,
    `Runtime: AUTO_PUBLISH=${report.runtime?.auto_publish === true} | queue=${report.runtime?.use_job_queue || "unknown"} | scheduler=${report.runtime?.scheduler_active === true}`,
    `Next window: ${report.scheduler?.next_safe_publish_at_utc || "unknown"}`,
    `Selected: ${report.scheduler?.selected_action || "none"}`,
    `Candidates: ${report.candidate_buffer?.ready_candidates || 0} ready`,
    `Runway: ${report.publish_runway_feedback?.live_publish_candidates || 0} live | ${report.publish_runway_feedback?.repairable_backlog || 0} repairable`,
    `TTS/captions: ${report.tts_caption_feedback?.failed_count || 0} failed materialisations`,
    `Discord feedback: ${report.discord_feedback?.real_blocker_count || 0} current blockers | ${report.discord_feedback?.superseded_count || 0} superseded | ${report.discord_feedback?.stale_count || 0} stale`,
    `Live Discord ingest: ${report.ingested_discord_feedback?.capability?.status || "unknown"} | ${report.ingested_discord_feedback?.summary?.actionable_count || 0} actionable | ${report.ingested_discord_feedback?.summary?.blocking_count || 0} blocking`,
    `Transcripts: ${report.transcript_audience_feedback?.summary?.rewrite_required || 0} rewrite required | ${report.transcript_audience_feedback?.summary?.current_blocking_count || 0} current blockers`,
    `Market: candidate=${report.market_intelligence?.candidate_supply?.verdict || "unknown"} (${report.market_intelligence?.candidate_supply?.durable_green_ready_candidates || 0} durable GREEN, ${report.market_intelligence?.candidate_supply?.non_ready_candidates_expiring_within_24h || 0} expiring non-ready) | competitors=${report.market_intelligence?.competitor_forensics?.verdict || "unknown"} | quality=${report.market_intelligence?.competitor_quality_gate?.verdict || "unknown"} | commercial=${report.market_intelligence?.commercial_learning?.verdict || "unknown"}`,
  ];
  if (candidates.length) {
    lines.push("Top candidates:");
    lines.push(...candidates);
  }
  if (asArray(report.post_window_feedback?.anomalies).length) {
    lines.push(`Post-window anomaly: ${report.post_window_feedback.anomalies[0].type}`);
  }
  if (asArray(report.blockers).length) {
    lines.push(`Blockers: ${asArray(report.blockers).slice(0, 3).join("; ")}`);
  }
  lines.push("Safety: read-only monitor; no manual blast, no token changes, deferred platforms stay deferred.");
  return lines.join("\n").slice(0, 1900);
}

async function readJsonIfExists(filePath) {
  try {
    if (!(await fs.pathExists(filePath))) return null;
    return fs.readJson(filePath);
  } catch {
    return null;
  }
}

async function readFirstJsonIfExists(filePaths = []) {
  for (const filePath of asArray(filePaths)) {
    const payload = await readJsonIfExists(filePath);
    if (payload) return payload;
  }
  return null;
}

async function loadCurrentCandidateReport({ candidateReport = null, paths = [] } = {}) {
  return candidateReport || (await readFirstJsonIfExists(paths)) || {};
}

async function recentJobsFromDb({ limit = 20 } = {}) {
  try {
    const { getRepos } = require("../repositories");
    const { db } = getRepos();
    return db
      .prepare(
        `SELECT id, kind, status, created_at, updated_at, completed_at, last_error
           FROM jobs
          WHERE kind IN ('publish', 'publish_window_watchdog', 'scoring_digest', 'render_health_digest')
          ORDER BY id DESC
          LIMIT ?`,
      )
      .all(limit);
  } catch {
    return [];
  }
}

async function platformPostsFromDb({ limit = 20 } = {}) {
  try {
    const { getRepos } = require("../repositories");
    const { db } = getRepos();
    return db
      .prepare(
        `SELECT id, story_id, platform, external_id, status, created_at, updated_at, published_at
           FROM platform_posts
          ORDER BY id DESC
          LIMIT ?`,
      )
      .all(limit);
  } catch {
    return [];
  }
}

async function runAutonomousFeedbackMonitor({
  generatedAt = new Date().toISOString(),
  outDir = DEFAULT_OUT,
  normalOperationsReport = null,
  candidateReport = null,
  discordDigestPayload = null,
  ingestedDiscordFeedbackReport = null,
  transcriptAudienceReport = null,
  learningReport = null,
  recentJobs = null,
  platformPosts = null,
  postDiscord = false,
  sendDiscord = null,
} = {}) {
  const normalOpsPath = path.join(ROOT, "output", "normal-operations", "normal_operations_report.json");
  const schedulerWindowPath = path.join(ROOT, "output", "normal-operations", "scheduler_window_readiness.json");
  const candidatePaths = [
    path.join(ROOT, "output", "goal-contract", "next_publish_candidates.json"),
    path.join(ROOT, "test", "output", "next_publish_candidates.json"),
  ];
  const discordPath = path.join(ROOT, "output", "goal-contract", "discord_digest_payload.json");
  const ttsCaptionPath = path.join(ROOT, "output", "autonomous-feedback-monitor", "audio_timestamp_materialization_report.json");
  const publishBlockerPath = path.join(ROOT, "test", "output", "publish_blocker_resolution.json");
  const dryRunPublishPath = path.join(ROOT, "output", "goal-contract", "dry_run_publish_plan.json");
  const publishCadencePath = path.join(ROOT, "test", "output", "publish_cadence.json");
  const candidateSupplyPath = path.join(ROOT, "output", "candidate-supply", "candidate_supply_report.json");
  const competitorForensicsPath = path.join(ROOT, "output", "competitor-forensics-lab", "competitor_forensics_lab_report.json");
  const competitorQualityGatePath = path.join(ROOT, "output", "competitor-quality-gate", "competitor_informed_quality_gate_report.json");
  const commercialLearningPath = path.join(ROOT, "data", "learning", "commercial", "commercial-learning.json");
  const guardedDispatchPreflightPath = path.join(ROOT, "output", "goal-contract", "guarded_dispatch_preflight_report.json");
  const learningPath = "D:\\pulse-data\\learning\\reports\\continuous_learning_loop.json";
  const loadedNormalOperationsReport = normalOperationsReport || (await readJsonIfExists(normalOpsPath)) || {};
  const loadedGuardedDispatchPreflightReport = await readJsonIfExists(guardedDispatchPreflightPath) || {};
  const loadedGuardedSelectedAction =
    selectedActionFromGuardedPreflight(loadedGuardedDispatchPreflightReport) ||
    loadedNormalOperationsReport.guarded_selection?.action_id ||
    "";
  const loadedCandidateReport = await loadCurrentCandidateReport({
    candidateReport,
    paths: candidatePaths,
  });
  let loadedTranscriptAudienceReport = transcriptAudienceReport;
  if (!loadedTranscriptAudienceReport) {
    try {
      const {
        auditGeneratedTranscripts,
        writeTranscriptAudienceAudit,
      } = require("./transcript-audience-audit");
      loadedTranscriptAudienceReport = await auditGeneratedTranscripts({ root: ROOT });
      await writeTranscriptAudienceAudit(loadedTranscriptAudienceReport, {
        outputDir: path.join(ROOT, "output", "transcript-audience-audit"),
      });
    } catch (err) {
      loadedTranscriptAudienceReport = {
        generated_at: generatedAt,
        summary: { total: 0, pass: 0, rewrite_required: 0 },
        stories: [],
        error: err.message || "transcript_audience_audit_failed",
      };
    }
  }
  let loadedIngestedDiscordFeedbackReport = ingestedDiscordFeedbackReport;
  if (!loadedIngestedDiscordFeedbackReport) {
    try {
      const { runDiscordFeedbackIngestion } = require("./discord-feedback-ingestion");
      loadedIngestedDiscordFeedbackReport = await runDiscordFeedbackIngestion({
        generatedAt,
        candidateReport: loadedCandidateReport,
        selectedStoryIds: [
          storyIdFromActionId(loadedGuardedSelectedAction),
        ].filter(Boolean),
        outDir: path.join(ROOT, "output", "discord-feedback-ingestion"),
      });
    } catch (err) {
      loadedIngestedDiscordFeedbackReport = {
        capability: { status: "ingestion_error", reason: err.message || "discord_ingestion_error" },
        summary: {
          messages_seen: 0,
          actionable_count: 0,
          blocking_count: 0,
          stale_count: 0,
          unmatched_count: 0,
        },
        items: [],
      };
    }
  }

  const report = buildAutonomousFeedbackReport({
    generatedAt,
    normalOperationsReport: loadedNormalOperationsReport,
    schedulerWindowReadiness: await readJsonIfExists(schedulerWindowPath),
    guardedDispatchPreflightReport: loadedGuardedDispatchPreflightReport,
    candidateReport: loadedCandidateReport,
    discordDigestPayload: discordDigestPayload || (await readJsonIfExists(discordPath)),
    ingestedDiscordFeedbackReport: loadedIngestedDiscordFeedbackReport,
    transcriptAudienceReport: loadedTranscriptAudienceReport,
    learningReport: learningReport || (await readJsonIfExists(learningPath)) || {},
    ttsCaptionReport: await readJsonIfExists(ttsCaptionPath) || {},
    dryRunPublishPlan: await readJsonIfExists(dryRunPublishPath) || {},
    publishCadenceReport: await readJsonIfExists(publishCadencePath) || {},
    publishBlockerResolutionReport: await readJsonIfExists(publishBlockerPath) || {},
    candidateSupplyReport: await readJsonIfExists(candidateSupplyPath) || {},
    competitorForensicsReport: await readJsonIfExists(competitorForensicsPath) || {},
    competitorQualityGateReport: await readJsonIfExists(competitorQualityGatePath) || {},
    commercialLearningReport: await readJsonIfExists(commercialLearningPath) || {},
    recentJobs: recentJobs || (await recentJobsFromDb()),
    platformPosts: platformPosts || (await platformPostsFromDb()),
  });

  await fs.ensureDir(outDir);
  await Promise.all([
    fs.writeJson(path.join(outDir, "autonomous_feedback_report.json"), report, { spaces: 2 }),
    fs.writeFile(path.join(outDir, "autonomous_feedback_report.md"), formatAutonomousFeedbackMarkdown(report), "utf8"),
    fs.writeFile(path.join(outDir, "autonomous_feedback_discord.md"), `${formatAutonomousFeedbackDiscord(report)}\n`, "utf8"),
  ]);

  if (postDiscord) {
    const notify = sendDiscord || require("../../notify");
    await notify(formatAutonomousFeedbackDiscord(report));
  }

  return report;
}

module.exports = {
  buildAutonomousFeedbackReport,
  buildLearningFeedback,
  buildMarketIntelligenceFeedback,
  buildPublishRunwayFeedback,
  buildTtsCaptionFeedback,
  buildPostWindowFeedback,
  candidateHasCurrentDirectMotion,
  classifyDiscordFeedback,
  formatAutonomousFeedbackDiscord,
  formatAutonomousFeedbackMarkdown,
  loadCurrentCandidateReport,
  selectedArtifactDirsFromGuardedPreflight,
  recentJobsFromDb,
  runAutonomousFeedbackMonitor,
  normaliseVerdict,
};
