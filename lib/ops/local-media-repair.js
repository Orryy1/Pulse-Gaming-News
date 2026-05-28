"use strict";

const path = require("node:path");

const {
  classifyShortScriptRuntime,
  secondsPerWordForTtsProvider,
} = require("../services/short-runtime-planner");
const {
  classifyLocalTtsProofFailure,
} = require("../studio/local-tts-failures");
const { evaluatePulseGamingTopicality } = require("../topicality-gate");
const {
  classifyLocalLiamSafety,
  unsafeVoiceSkip,
} = require("./local-liam-safety");
const {
  generateLocalTtsWithOptionalRecovery,
} = require("./local-tts-batch-recovery");
const { stampLocalVoiceTimestampMeta } = require("./local-voice-metadata");

const FLASH_MIN_SECONDS = 61;
const FLASH_MAX_SECONDS = 75;
const LOCAL_REPAIR_TARGET_MIN_SECONDS = 64;
const LOCAL_REPAIR_TARGET_MAX_SECONDS = 70;

function bool(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value || ""));
}

function firstText(story = {}) {
  return (
    story.tts_script ||
    story.full_script ||
    [story.hook, story.body, story.loop].filter(Boolean).join(" ") ||
    ""
  );
}

function isStoryApproved(story = {}) {
  return bool(story.approved) || bool(story.auto_approved);
}

function localTtsReady(localTts = {}) {
  return classifyLocalLiamSafety(localTts).safe === true;
}

function mediaStatusFor(story = {}, mediaByStoryId = {}) {
  const media = mediaByStoryId[story.id] || {};
  return {
    audioExists:
      media.audioExists === undefined ? Boolean(story.audio_path) : bool(media.audioExists),
    finalExists:
      media.finalExists === undefined ? Boolean(story.exported_path) : bool(media.finalExists),
    audioPath: media.audioPath || story.audio_path || null,
    finalPath: media.finalPath || story.exported_path || null,
    finalDurationSeconds:
      media.finalDurationSeconds === undefined
        ? null
        : Number(media.finalDurationSeconds),
    audioDurationSeconds:
      media.audioDurationSeconds === undefined
        ? null
        : Number(media.audioDurationSeconds),
  };
}

function classifyDurationRepair(media = {}) {
  const rawDuration =
    media.audioDurationSeconds !== null && media.audioDurationSeconds !== undefined
      ? media.audioDurationSeconds
      : media.finalDurationSeconds;
  const duration = Number(rawDuration);
  if (!Number.isFinite(duration)) return null;
  if (duration < FLASH_MIN_SECONDS) {
    return {
      code: "duration_too_short",
      message: `local Liam audio is ${duration.toFixed(2)}s, below ${FLASH_MIN_SECONDS}s`,
      duration_seconds: duration,
    };
  }
  if (duration > FLASH_MAX_SECONDS) {
    return {
      code: "duration_too_long",
      message: `local Liam audio is ${duration.toFixed(2)}s, above ${FLASH_MAX_SECONDS}s`,
      duration_seconds: duration,
    };
  }
  return null;
}

function voiceIssueFor(story, media, voiceAuditByStoryId = {}) {
  const audit = voiceAuditByStoryId[story.id] || null;
  if (!media.finalExists) return { audit, issue: null };
  if (!audit) {
    return {
      audit,
      issue: {
        verdict: "review",
        blockers: ["approved_voice_metadata_missing"],
        warnings: [],
      },
    };
  }
  if (audit.verdict && audit.verdict !== "pass" && audit.verdict !== "skip") {
    return {
      audit,
      issue: {
        verdict: audit.verdict,
        blockers: audit.blockers || [],
        warnings: audit.warnings || [],
      },
    };
  }
  return { audit, issue: null };
}

function increment(counts, key) {
  counts[key] = (counts[key] || 0) + 1;
}

function classifyRepairItem(story, opts = {}) {
  const media = mediaStatusFor(story, opts.mediaByStoryId || {});
  const { audit, issue: voiceIssue } = voiceIssueFor(
    story,
    media,
    opts.voiceAuditByStoryId || {},
  );
  const text = firstText(story);
  const runtimeText =
    typeof opts.cleanText === "function" ? opts.cleanText(text) : text;
  const topicality = evaluatePulseGamingTopicality(story, {
    channelId: story.channel_id,
  });
  const runtime = classifyShortScriptRuntime({
    text: runtimeText,
    story,
    secondsPerWord: opts.secondsPerWord || secondsPerWordForTtsProvider(
      opts.ttsProvider || "local",
      opts.env || process.env,
    ),
  });
  const blockers = [];
  const warnings = [];
  const needs = [];
  let failureCode = null;

  if (!isStoryApproved(story)) {
    return {
      story_id: story.id || null,
      title: story.title || "",
      approved: false,
      action: "skip_not_approved",
      blockers: ["story_not_approved"],
      warnings,
      needs,
      media,
      voice_audit: audit,
      runtime,
      priority: 0,
    };
  }

  if (topicality.decision === "reject") {
    return {
      story_id: story.id || null,
      title: story.title || "",
      approved: true,
      action: "skip_topicality_reject",
      blockers: [topicality.reason || "topicality_reject"],
      warnings: [],
      needs: [],
      media,
      voice_audit: audit,
      topicality,
      runtime,
      priority: Number(story.breaking_score || 0),
    };
  }

  if (runtime.result === "route_longform") {
    warnings.push(...runtime.warnings);
    return {
      story_id: story.id || null,
      title: story.title || "",
      approved: true,
      action: "route_longform_not_short_repair",
      blockers,
      warnings,
      needs: ["briefing_or_longform_lane"],
      media,
      voice_audit: audit,
      runtime,
      priority: Number(story.breaking_score || 0),
    };
  }

  if (!media.audioExists) needs.push("regenerate_audio_with_sleepy_liam");
  if (!media.finalExists) needs.push("rerender_video_local");
  const durationRepair = media.audioExists ? classifyDurationRepair(media) : null;
  if (durationRepair) {
    failureCode = durationRepair.code;
    blockers.push(durationRepair.code);
    warnings.push(durationRepair.message);
    if (durationRepair.code === "duration_too_short") {
      warnings.push(
        `extend script before regenerating local Liam audio toward ${LOCAL_REPAIR_TARGET_MIN_SECONDS}-${LOCAL_REPAIR_TARGET_MAX_SECONDS}s`,
      );
      needs.push("extend_script_for_64_70s_local_voice");
    } else {
      return {
        story_id: story.id || null,
        title: story.title || "",
        approved: true,
        action: "rewrite_or_route_before_render",
        blockers,
        warnings,
        needs: ["shorten_or_route_to_briefing"],
        media,
        voice_audit: audit,
        runtime,
        failure_code: failureCode,
        priority: Number(story.breaking_score || 0),
      };
    }
    if (durationRepair.code !== "duration_too_short" && !needs.includes("rerender_video_local")) {
      needs.push("rerender_video_local");
    }
  }
  if (voiceIssue) {
    blockers.push(...(voiceIssue.blockers || []));
    warnings.push(...(voiceIssue.warnings || []));
    if (!needs.includes("regenerate_audio_with_sleepy_liam")) {
      needs.push("regenerate_audio_with_sleepy_liam");
    }
    if (!needs.includes("rerender_video_local")) needs.push("rerender_video_local");
  }

  const measuredDuration =
    media.audioDurationSeconds !== null && media.audioDurationSeconds !== undefined
      ? Number(media.audioDurationSeconds)
      : media.finalDurationSeconds !== null && media.finalDurationSeconds !== undefined
        ? Number(media.finalDurationSeconds)
        : null;
  const hasMeasuredInRangeAudio =
    media.audioExists &&
    Number.isFinite(measuredDuration) &&
    measuredDuration >= FLASH_MIN_SECONDS &&
    measuredDuration <= FLASH_MAX_SECONDS &&
    !durationRepair;
  if (
    runtime.route === "extended_short" &&
    !hasMeasuredInRangeAudio &&
    needs.includes("regenerate_audio_with_sleepy_liam")
  ) {
    return {
      story_id: story.id || null,
      title: story.title || "",
      approved: true,
      action: "rewrite_or_route_before_render",
      blockers: ["script_runtime_extended_short_not_local_repair"],
      warnings,
      needs: ["shorten_or_route_to_briefing"],
      media,
      voice_audit: audit,
      runtime,
      failure_code: "script_runtime_extended_short_not_local_repair",
      priority: Number(story.breaking_score || 0),
    };
  }
  const requiresLocalTts = needs.includes("regenerate_audio_with_sleepy_liam");
  const localVoiceSafety = classifyLocalLiamSafety(opts.localTts || {});
  if (requiresLocalTts && localVoiceSafety.safe !== true) {
    failureCode = localVoiceSafety.code || "unsafe_voice";
    if (failureCode === "unsafe_voice") blockers.push("unsafe_voice");
    else blockers.push("local_tts_not_ready");
    return {
      story_id: story.id || null,
      title: story.title || "",
      approved: true,
      action: "blocked_local_tts_unavailable",
      blockers,
      warnings,
      needs,
      failure_code: failureCode,
      failure_message: localVoiceSafety.message,
      media,
      voice_audit: audit,
      runtime,
      priority: Number(story.breaking_score || 0),
    };
  }

  if (
    (runtime.result === "fail" || runtime.result === "review") &&
    !hasMeasuredInRangeAudio
  ) {
    blockers.push(...runtime.failures, ...runtime.warnings);
    return {
      story_id: story.id || null,
      title: story.title || "",
      approved: true,
      action: "rewrite_or_route_before_render",
      blockers,
      warnings,
      needs: ["shorten_or_route_to_briefing"],
      media,
      voice_audit: audit,
      runtime,
      priority: Number(story.breaking_score || 0),
    };
  }

  if (
    runtime.result === "warn" &&
    runtime.warnings.some((warning) => warning.startsWith("script_runtime_below_flash_target")) &&
    !hasMeasuredInRangeAudio &&
    !needs.includes("extend_script_for_64_70s_local_voice")
  ) {
    return {
      story_id: story.id || null,
      title: story.title || "",
      approved: true,
      action: "extend_script_before_local_repair",
      blockers,
      warnings: runtime.warnings,
      needs: ["extend_script_for_64_70s_local_voice"],
      media,
      voice_audit: audit,
      runtime,
      priority: Number(story.breaking_score || 0),
    };
  }

  if (needs.length > 0) {
    if (needs.includes("extend_script_for_64_70s_local_voice")) {
      return {
        story_id: story.id || null,
        title: story.title || "",
        approved: true,
        action: "extend_script_before_local_repair",
        blockers,
        warnings,
        needs,
        media,
        voice_audit: audit,
        runtime,
        failure_code: failureCode,
        priority: Number(story.breaking_score || 0),
      };
    }
    return {
      story_id: story.id || null,
      title: story.title || "",
      approved: true,
      action: "ready_local_audio_render_repair",
      blockers,
      warnings,
      needs,
      media,
      voice_audit: audit,
      runtime,
      failure_code: failureCode,
      priority: Number(story.breaking_score || 0),
    };
  }

  return {
    story_id: story.id || null,
    title: story.title || "",
    approved: true,
    action: "no_action",
    blockers,
    warnings,
    needs,
    media,
    voice_audit: audit,
    runtime,
    failure_code: failureCode,
    priority: Number(story.breaking_score || 0),
  };
}

function buildLocalMediaRepairQueue({
  stories = [],
  mediaByStoryId = {},
  voiceAuditByStoryId = {},
  localTts = {},
  ttsProvider = "local",
  env = process.env,
  dryRun = true,
  generatedAt = new Date().toISOString(),
  cleanText,
} = {}) {
  const items = (Array.isArray(stories) ? stories : [])
    .map((story) =>
      classifyRepairItem(story, {
        mediaByStoryId,
        voiceAuditByStoryId,
        localTts,
        ttsProvider,
        env,
        cleanText,
      }),
    )
    .sort((a, b) => {
      const actionA = a.action === "ready_local_audio_render_repair" ? 1 : 0;
      const actionB = b.action === "ready_local_audio_render_repair" ? 1 : 0;
      return actionB - actionA || b.priority - a.priority;
    });

  const counts = {
    total: items.length,
    ready_local_repair: 0,
    blocked_runtime: 0,
    blocked_local_tts: 0,
    route_longform: 0,
    no_action: 0,
    skipped: 0,
  };
  for (const item of items) {
    if (item.action === "ready_local_audio_render_repair") increment(counts, "ready_local_repair");
    else if (item.action === "rewrite_or_route_before_render") increment(counts, "blocked_runtime");
    else if (item.action === "extend_script_before_local_repair") increment(counts, "blocked_runtime");
    else if (item.action === "blocked_local_tts_unavailable") increment(counts, "blocked_local_tts");
    else if (item.action === "route_longform_not_short_repair") increment(counts, "route_longform");
    else if (item.action === "no_action") increment(counts, "no_action");
    else increment(counts, "skipped");
  }
  const failureCounts = countFailureCodes({ applied: items, skipped: [] });

  return {
    schema_version: 1,
    generated_at: generatedAt,
    dry_run: dryRun !== false,
    local_tts: {
      ready: localTtsReady(localTts),
      status: localTts.status || "unknown",
      phase: localTts.phase || "unknown",
      voice: {
        alias: localTts.voice?.alias || null,
        loaded: bool(localTts.voice?.loaded),
        ref_resolved: bool(localTts.voice?.refResolved ?? localTts.voice?.ref_resolved),
        reference_present: bool(
          localTts.voice?.reference?.referencePresent ??
            localTts.voice?.reference_present ??
            localTts.voice?.referencePresent ??
            localTts.voice?.refResolved ??
            localTts.voice?.ref_resolved,
        ),
        accepted_reference_id:
          localTts.voice?.reference?.id ||
          localTts.voice?.acceptedReferenceId ||
          localTts.voice?.accepted_reference_id ||
          null,
        accepted_reference_file:
          localTts.voice?.reference?.fileName ||
          localTts.voice?.acceptedReferenceFile ||
          localTts.voice?.accepted_reference_file ||
          null,
        reference_sha1:
          localTts.voice?.reference?.referenceHash ||
          localTts.voice?.referenceHash ||
          localTts.voice?.reference_hash ||
          localTts.voice?.referenceSha1 ||
          localTts.voice?.reference_sha1 ||
          null,
      },
      reasons: localTts.reasons || [],
    },
    counts,
    failure_counts: failureCounts,
    items,
    safety: {
      local_only: true,
      dry_run_default: true,
      mutates_media: dryRun === false,
      mutates_production_db: false,
      mutates_tokens: false,
      mutates_railway_env: false,
      triggers_oauth: false,
      posts_to_platforms: false,
      switches_renderer_default: false,
    },
  };
}

function renderLocalMediaRepairMarkdown(report) {
  const lines = [];
  lines.push("# Local Media Repair Queue");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Mode: ${report.dry_run ? "dry-run local-only" : "apply-local media-only"}`);
  lines.push(
    `Local TTS: ready=${report.local_tts.ready} status=${report.local_tts.status} phase=${report.local_tts.phase} voice=${report.local_tts.voice.alias || "unknown"} loaded=${report.local_tts.voice.loaded} ref=${report.local_tts.voice.ref_resolved}`,
  );
  if (report.local_tts.reasons?.length) {
    lines.push(`Local TTS reasons: ${report.local_tts.reasons.join("; ")}`);
  }
  lines.push("");
  lines.push("## Counts");
  lines.push(
    `- total=${report.counts.total} ready=${report.counts.ready_local_repair} runtime_blocked=${report.counts.blocked_runtime} tts_blocked=${report.counts.blocked_local_tts} no_action=${report.counts.no_action}`,
  );
  lines.push("");
  lines.push("## Queue");
  const rows = report.items.filter((item) => item.action !== "skip_not_approved");
  if (!rows.length) {
    lines.push("- none");
  } else {
    for (const item of rows.slice(0, 25)) {
      lines.push(
        `- ${item.story_id}: ${item.action} | runtime=${item.runtime.estimatedSeconds || "unknown"}s | needs=${item.needs.join(", ") || "none"} | blockers=${item.blockers.join(", ") || "clear"}${item.failure_code ? ` | failure=${item.failure_code}` : ""} | ${item.title}`,
      );
    }
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- This is local-only repair planning by default.");
  lines.push("- No OAuth, tokens, Railway env vars or social posts are changed.");
  lines.push("- No production DB rows are mutated.");
  lines.push("- Existing good assets are not overwritten blindly.");
  return lines.join("\n") + "\n";
}

function safeStoryId(id) {
  return String(id || "unknown").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 96);
}

function safeErrorMessage(err) {
  return String(err?.message || err || "unknown_error")
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

function countFailureCodes({ applied = [], skipped = [] } = {}) {
  const counts = {};
  for (const item of [...applied, ...skipped]) {
    if (!item.failure_code) continue;
    counts[item.failure_code] = (counts[item.failure_code] || 0) + 1;
  }
  return counts;
}

function storyHasStaleAudioGenerationFailure(story = {}) {
  if (story.qa_failed !== true) return false;
  if (story.publish_status !== "failed") return false;
  const publishError = String(story.publish_error || "");
  const failures = Array.isArray(story.qa_failures) ? story.qa_failures : [];
  const haystack = [publishError, ...failures].join(" ").toLowerCase();
  if (!haystack.includes("audio_generation_failed")) return false;
  return /server_down|health_timeout|tts_timeout|connection_reset|econnreset|econnrefused|local tts server is not reachable/.test(
    haystack,
  );
}

function itemHasRecoveredLocalAudio(item = {}) {
  if (!item.media?.audioExists) return false;
  if (item.needs?.includes("regenerate_audio_with_sleepy_liam")) return false;
  if (item.needs?.includes("extend_script_for_64_70s_local_voice")) return false;
  if (item.action !== "ready_local_audio_render_repair" && item.action !== "no_action") {
    return false;
  }
  if (Array.isArray(item.blockers) && item.blockers.length > 0) return false;
  const duration =
    item.media.audioDurationSeconds !== null && item.media.audioDurationSeconds !== undefined
      ? Number(item.media.audioDurationSeconds)
      : null;
  if (duration !== null && Number.isFinite(duration)) {
    return duration >= FLASH_MIN_SECONDS && duration <= FLASH_MAX_SECONDS;
  }
  return item.runtime?.shouldGenerateShortAudio !== false;
}

function buildStaleAudioQaFailureResetPlan({
  report,
  storiesById = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const resettable = [];
  const skipped = [];
  for (const item of report?.items || []) {
    const story = storiesById[item.story_id];
    if (!story) {
      skipped.push({
        story_id: item.story_id,
        reason: "story_not_available",
      });
      continue;
    }
    if (!storyHasStaleAudioGenerationFailure(story)) {
      skipped.push({
        story_id: item.story_id,
        reason: "not_stale_audio_generation_failure",
      });
      continue;
    }
    if (!item.media?.audioExists || item.needs?.includes("regenerate_audio_with_sleepy_liam")) {
      skipped.push({
        story_id: item.story_id,
        reason: "local_audio_not_recovered",
        needs: item.needs || [],
      });
      continue;
    }
    if (!itemHasRecoveredLocalAudio(item)) {
      skipped.push({
        story_id: item.story_id,
        reason: "recovered_audio_not_publishable",
        action: item.action,
        blockers: item.blockers || [],
        needs: item.needs || [],
      });
      continue;
    }
    resettable.push({
      story_id: item.story_id,
      title: item.title || story.title || "",
      action: "reset_stale_audio_qa_failure",
      reason: "recovered_local_audio_after_tts_outage",
      previous_publish_error: story.publish_error || null,
      audio_path: item.media.audioPath || story.audio_path || null,
      audio_duration_seconds: item.media.audioDurationSeconds ?? null,
      next_action: item.media.finalExists ? "publish_candidate_recheck" : "rerender_video_local",
      needs: item.needs || [],
    });
  }

  return {
    schema_version: 1,
    generated_at: generatedAt,
    resettable,
    skipped,
    counts: {
      resettable: resettable.length,
      skipped: skipped.length,
    },
    safety: {
      local_only: true,
      dry_run_default: true,
      mutates_production_db: false,
      mutates_tokens: false,
      mutates_railway_env: false,
      triggers_oauth: false,
      posts_to_platforms: false,
      switches_renderer_default: false,
    },
  };
}

function clearStaleAudioQaFailure(story = {}) {
  const next = { ...story };
  next.qa_failed = false;
  next.publish_status = null;
  next.publish_error = null;
  next.qa_failed_at = null;
  delete next.qa_failures;
  delete next.qa_warnings;
  delete next.audio_generation_failure;
  delete next.local_tts_failure;
  if (!Object.prototype.hasOwnProperty.call(next, "_extra")) {
    next._extra = null;
  }
  return next;
}

async function applyStaleAudioQaFailureReset({
  plan,
  storiesById = {},
  persistStory,
} = {}) {
  if (typeof persistStory !== "function") {
    throw new Error("applyStaleAudioQaFailureReset requires a persistStory function");
  }
  const applied = [];
  const skipped = [];
  for (const item of plan?.resettable || []) {
    const story = storiesById[item.story_id];
    if (!story) {
      skipped.push({
        story_id: item.story_id,
        reason: "story_not_available",
      });
      continue;
    }
    if (!storyHasStaleAudioGenerationFailure(story)) {
      skipped.push({
        story_id: item.story_id,
        reason: "not_stale_audio_generation_failure",
      });
      continue;
    }
    const nextStory = clearStaleAudioQaFailure(story);
    await persistStory(nextStory);
    applied.push({
      story_id: item.story_id,
      action: item.action,
      reason: item.reason,
      next_action: item.next_action,
    });
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    applied,
    skipped,
    safety: {
      local_only: true,
      mutates_local_db: true,
      mutates_production_db: false,
      mutates_tokens: false,
      mutates_railway_env: false,
      triggers_oauth: false,
      posts_to_platforms: false,
      switches_renderer_default: false,
    },
  };
}

function renderStaleAudioQaFailureResetMarkdown(plan, applyReport = null) {
  const lines = [];
  lines.push("# Stale Audio QA Failure Reset");
  lines.push("");
  lines.push(`Generated: ${plan.generated_at}`);
  lines.push(
    `Resettable: ${plan.counts?.resettable ?? plan.resettable?.length ?? 0} | Skipped: ${plan.counts?.skipped ?? plan.skipped?.length ?? 0}`,
  );
  lines.push("");
  lines.push("## Resettable");
  if (!plan.resettable?.length) {
    lines.push("- none");
  } else {
    for (const item of plan.resettable) {
      lines.push(
        `- ${item.story_id}: ${item.next_action} | audio=${item.audio_duration_seconds ?? "unknown"}s | ${item.title}`,
      );
    }
  }
  if (plan.skipped?.length) {
    lines.push("");
    lines.push("## Skipped");
    for (const item of plan.skipped.slice(0, 25)) {
      lines.push(`- ${item.story_id}: ${item.reason}`);
    }
  }
  if (applyReport) {
    lines.push("");
    lines.push("## Apply Result");
    lines.push(`- applied=${applyReport.applied.length}`);
    lines.push(`- skipped=${applyReport.skipped.length}`);
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- Only stale local TTS outage QA failures are eligible.");
  lines.push("- Content, source, video, attribution and duration QA failures are not reset.");
  lines.push("- No OAuth, tokens, Railway env vars or social posts are changed.");
  lines.push("- Apply mode mutates the local story row so the normal producer can re-render it.");
  return `${lines.join("\n")}\n`;
}

function wordsPerMinute(wordCount, durationSeconds) {
  const words = Number(wordCount);
  const duration = Number(durationSeconds);
  if (!Number.isFinite(words) || !Number.isFinite(duration) || duration <= 0) return null;
  return Math.round((words / duration) * 60);
}

function assertTestOutputDir(outputRelDir) {
  const raw = String(outputRelDir || "");
  const normalised = raw.replace(/\\/g, "/");
  const repoTestOutput = path.resolve(process.cwd(), "test", "output");
  const resolved = path.resolve(raw);
  const relativeTestOutput = !path.isAbsolute(raw) && /^test\/output(?:\/|$)/i.test(normalised);
  const absoluteTestOutput =
    path.isAbsolute(raw) &&
    (resolved === repoTestOutput || resolved.startsWith(`${repoTestOutput}${path.sep}`));
  if (!relativeTestOutput && !absoluteTestOutput) {
    throw new Error("local proof audio output must stay under test/output");
  }
}

async function applyLocalAudioRepairs({
  report,
  storiesById = {},
  outputRelDir = path.join("test", "output", "local-media-repair", "audio"),
  generateTts,
  cleanText = (value) => value,
  measureDuration,
  acousticProbe = null,
  resolveOutputPath = async (outputRel) => outputRel,
  recoverLocalTts = null,
  limit = null,
} = {}) {
  if (typeof generateTts !== "function") {
    throw new Error("applyLocalAudioRepairs requires a generateTts function");
  }
  assertTestOutputDir(outputRelDir);
  const candidates = (report?.items || []).filter(
    (item) =>
      item.action === "ready_local_audio_render_repair" &&
      item.needs.includes("regenerate_audio_with_sleepy_liam"),
  );
  const selected =
    Number.isFinite(Number(limit)) && Number(limit) > 0
      ? candidates.slice(0, Number(limit))
      : candidates;
  const applied = [];
  const skipped = [];
  const localVoiceSafety = classifyLocalLiamSafety(report?.local_tts || {});

  for (const item of selected) {
    if (localVoiceSafety.safe !== true) {
      skipped.push(unsafeVoiceSkip(item.story_id, localVoiceSafety));
      continue;
    }
    const story = storiesById[item.story_id];
    if (!story) {
      skipped.push({
        story_id: item.story_id,
        reason: "story_not_available",
      });
      continue;
    }
    const outputRel = path.join(outputRelDir, `${safeStoryId(item.story_id)}_liam.mp3`);
    const text = cleanText(firstText(story));
    const ttsAttempt = await generateLocalTtsWithOptionalRecovery({
      storyId: item.story_id,
      text,
      outputRel,
      rate: 1.0,
      generateTts,
      recoverLocalTts,
    });
    if (!ttsAttempt.ok) {
      const failure = ttsAttempt.failure || {};
      skipped.push({
        story_id: item.story_id,
        reason: "generate_tts_failed",
        failure_code: failure.code,
        server_reset_recorded: failure.requires_server_reset === true,
        attempts: ttsAttempt.attempts,
        server_recovery: ttsAttempt.recovery || null,
        error: ttsAttempt.error,
      });
      continue;
    }
    let resolvedAudioPath = outputRel;
    try {
      resolvedAudioPath = await resolveOutputPath(outputRel);
    } catch (err) {
      resolvedAudioPath = outputRel;
    }
    let voiceMeta;
    try {
      voiceMeta = await stampLocalVoiceTimestampMeta({
        outputAudioPath: outputRel,
        text,
        rate: 1.0,
        acousticProbe,
      });
    } catch (err) {
      voiceMeta = {
        stamped: false,
        reason: `timestamps_error:${safeErrorMessage(err)}`,
      };
    }
    let durationSeconds = null;
    let durationMeasureError = null;
    if (typeof measureDuration === "function") {
      try {
        durationSeconds = await measureDuration(outputRel);
      } catch (err) {
        durationMeasureError = safeErrorMessage(err);
      }
    }
    const hasDuration =
      durationSeconds !== null && durationSeconds !== undefined && durationSeconds !== "";
    const numericDuration = Number(durationSeconds);
    const durationVerdict =
      hasDuration &&
      Number.isFinite(numericDuration) &&
      numericDuration >= 61 &&
      numericDuration <= 75
        ? "pass"
        : hasDuration && Number.isFinite(numericDuration)
          ? "reject_duration"
          : "unknown";
    const proofFailure = classifyLocalTtsProofFailure({
      durationSeconds,
      timestampsStamped: voiceMeta.stamped === true,
      localVoiceReference: voiceMeta.local_voice_reference || null,
      acoustic: voiceMeta.acoustic || null,
      transcript: voiceMeta.transcript || text,
      wordCount: item.runtime.wordCount,
    });
    const wpm = wordsPerMinute(item.runtime.wordCount, durationSeconds);
    applied.push({
      story_id: item.story_id,
      output_audio_path: outputRel,
      resolved_audio_path: resolvedAudioPath,
      source_action: item.action,
      rate: 1.0,
      tts_attempts: ttsAttempt.attempts,
      server_recovery: ttsAttempt.recovery || null,
      text_word_count: item.runtime.wordCount,
      estimated_seconds: item.runtime.estimatedSeconds,
      duration_seconds: durationSeconds,
      duration_verdict: durationVerdict,
      failure_code: proofFailure.code,
      failure_message: proofFailure.code ? proofFailure.message : null,
      duration_measure_error: durationMeasureError,
      acoustic: voiceMeta.acoustic || null,
      transcript: voiceMeta.transcript || null,
      spoken_outro_present: voiceMeta.spoken_outro_present === true,
      wpm,
      local_pace: {
        wpm,
        min_wpm: 130,
        max_wpm: 220,
        verdict: proofFailure.code === "spoken_pace_too_slow" || proofFailure.code === "spoken_pace_too_fast"
          ? proofFailure.code
          : wpm === null
            ? "unknown"
            : "pass",
      },
      local_voice_reference: voiceMeta.local_voice_reference || null,
      local_voice_metadata: voiceMeta.stamped
        ? "stamped"
        : `not_stamped:${voiceMeta.reason || "unknown"}`,
    });
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    applied,
    skipped,
    failure_counts: countFailureCodes({ applied, skipped }),
    safety: {
      local_only: true,
      writes_under_output_dir: outputRelDir,
      mutates_media: true,
      mutates_production_db: false,
      mutates_tokens: false,
      mutates_railway_env: false,
      triggers_oauth: false,
      posts_to_platforms: false,
      switches_renderer_default: false,
    },
  };
}

function renderLocalMediaRepairApplyMarkdown(report) {
  const lines = [];
  lines.push("# Local Media Repair Audio Apply");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Applied: ${report.applied.length}`);
  lines.push(`Skipped: ${report.skipped.length}`);
  lines.push("");
  lines.push("## Applied");
  if (!report.applied.length) {
    lines.push("- none");
  } else {
    for (const item of report.applied) {
      lines.push(
        `- ${item.story_id}: ${item.duration_verdict} ${item.duration_seconds ?? "unknown"}s${item.failure_code ? ` | failure=${item.failure_code}` : ""} | ${item.resolved_audio_path || item.output_audio_path}`,
      );
    }
  }
  if (report.skipped.length) {
    lines.push("");
    lines.push("## Skipped");
    for (const item of report.skipped) {
      lines.push(`- ${item.story_id}: ${item.reason}${item.failure_code ? ` | failure=${item.failure_code}` : ""}${item.error ? ` (${item.error})` : ""}`);
    }
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- Local audio files only.");
  lines.push("- No production DB rows were changed.");
  lines.push("- No OAuth, Railway env vars, tokens or social posts were changed.");
  lines.push("- `reject_duration` audio is not suitable for a 61-75s Flash Lane render without script timing work.");
  return `${lines.join("\n")}\n`;
}

module.exports = {
  applyStaleAudioQaFailureReset,
  applyLocalAudioRepairs,
  buildLocalMediaRepairQueue,
  buildStaleAudioQaFailureResetPlan,
  classifyRepairItem,
  classifyDurationRepair,
  renderLocalMediaRepairApplyMarkdown,
  renderLocalMediaRepairMarkdown,
  renderStaleAudioQaFailureResetMarkdown,
};
