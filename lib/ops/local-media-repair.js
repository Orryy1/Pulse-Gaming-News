"use strict";

const path = require("node:path");

const {
  classifyShortScriptRuntime,
  secondsPerWordForTtsProvider,
} = require("../services/short-runtime-planner");
const {
  classifyLocalTtsFailure,
  classifyLocalTtsProofFailure,
} = require("../studio/local-tts-failures");
const { evaluatePulseGamingTopicality } = require("../topicality-gate");
const {
  classifyLocalLiamSafety,
  unsafeVoiceSkip,
} = require("./local-liam-safety");
const { stampLocalVoiceTimestampMeta } = require("./local-voice-metadata");

const FLASH_MIN_SECONDS = 61;
const FLASH_MAX_SECONDS = 75;

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

  if (runtime.result === "fail" || runtime.result === "review") {
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
    runtime.warnings.some((warning) => warning.startsWith("script_runtime_below_flash_target"))
  ) {
    return {
      story_id: story.id || null,
      title: story.title || "",
      approved: true,
      action: "extend_script_before_local_repair",
      blockers,
      warnings: runtime.warnings,
      needs: ["extend_script_for_60s_local_voice"],
      media,
      voice_audit: audit,
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
    if (!needs.includes("regenerate_audio_with_sleepy_liam")) {
      needs.push("regenerate_audio_with_sleepy_liam");
    }
    if (!needs.includes("rerender_video_local")) needs.push("rerender_video_local");
  }
  if (voiceIssue) {
    blockers.push(...(voiceIssue.blockers || []));
    warnings.push(...(voiceIssue.warnings || []));
    if (!needs.includes("regenerate_audio_with_sleepy_liam")) {
      needs.push("regenerate_audio_with_sleepy_liam");
    }
    if (!needs.includes("rerender_video_local")) needs.push("rerender_video_local");
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

  if (needs.length > 0) {
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

async function applyLocalAudioRepairs({
  report,
  storiesById = {},
  outputRelDir = path.join("test", "output", "local-media-repair", "audio"),
  generateTts,
  cleanText = (value) => value,
  measureDuration,
  resolveOutputPath = async (outputRel) => outputRel,
  limit = null,
} = {}) {
  if (typeof generateTts !== "function") {
    throw new Error("applyLocalAudioRepairs requires a generateTts function");
  }
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
    try {
      await generateTts(text, outputRel, 1.0);
    } catch (err) {
      const failure = classifyLocalTtsFailure(err);
      skipped.push({
        story_id: item.story_id,
        reason: "generate_tts_failed",
        failure_code: failure.code,
        server_reset_recorded: failure.requires_server_reset === true,
        error: safeErrorMessage(err),
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
    });
    applied.push({
      story_id: item.story_id,
      output_audio_path: outputRel,
      resolved_audio_path: resolvedAudioPath,
      source_action: item.action,
      rate: 1.0,
      text_word_count: item.runtime.wordCount,
      estimated_seconds: item.runtime.estimatedSeconds,
      duration_seconds: durationSeconds,
      duration_verdict: durationVerdict,
      failure_code: proofFailure.code,
      failure_message: proofFailure.code ? proofFailure.message : null,
      duration_measure_error: durationMeasureError,
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
  applyLocalAudioRepairs,
  buildLocalMediaRepairQueue,
  classifyRepairItem,
  classifyDurationRepair,
  renderLocalMediaRepairApplyMarkdown,
  renderLocalMediaRepairMarkdown,
};
