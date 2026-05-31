"use strict";

const path = require("node:path");

const fsExtra = require("fs-extra");

const mediaPaths = require("../media-paths");
const {
  characterAlignmentToSubtitleWords,
  inspectSubtitleTimingWords,
} = require("../subtitle-timing");
const {
  runPublishVoiceQa,
  timestampPathForAudio,
} = require("../services/publish-voice-qa");
const {
  summarizeLocalTtsProofReports,
} = require("./local-resume-plan");

const PLATFORM_ID_KEYS = [
  "youtube_post_id",
  "youtube_url",
  "tiktok_post_id",
  "instagram_media_id",
  "facebook_post_id",
  "facebook_reel_id",
  "twitter_post_id",
  "instagram_story_id",
  "facebook_story_id",
  "twitter_image_tweet_id",
];

function safeStoryId(id) {
  return String(id || "unknown").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 96);
}

function bool(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value || ""));
}

function isRealPlatformValue(value) {
  if (value === null || value === undefined || value === "") return false;
  const str = String(value).trim();
  if (!str) return false;
  return !/^DUPE_/i.test(str);
}

function realPlatformIds(story = {}) {
  return PLATFORM_ID_KEYS
    .filter((key) => isRealPlatformValue(story[key]))
    .map((key) => ({ key, value: String(story[key]) }));
}

function isApproved(story = {}) {
  return bool(story.approved) || bool(story.auto_approved);
}

function firstScriptText(story = {}) {
  return (
    story.tts_script ||
    story.full_script ||
    [story.hook, story.body, story.loop].filter(Boolean).join(" ") ||
    ""
  );
}

function timestampRepairFromPayload(payload = {}) {
  const repair =
    payload?.meta?.timestampRepair ||
    payload?.meta?.timestamp_repair ||
    payload?.meta?.captionTimingRepair ||
    payload?.meta?.caption_timing_repair ||
    null;
  if (!repair || typeof repair !== "object") return null;
  if (!bool(repair.repaired)) return null;
  return {
    repaired: true,
    reason: String(repair.reason || repair.repairReason || "unknown"),
    strategy: repair.strategy || repair.repairStrategy || null,
    inspection: repair.inspection || repair.repairedInspection || null,
    originalInspection: repair.originalInspection || repair.original_inspection || null,
  };
}

function inspectTimestampPayload(payload = {}, durationSeconds = null) {
  const words = characterAlignmentToSubtitleWords(payload || {});
  const inspection = inspectSubtitleTimingWords(words, durationSeconds, {
    maxTrailingGapSeconds: 2,
  });
  return {
    word_count: words.length,
    inspection,
    repair: timestampRepairFromPayload(payload),
  };
}

async function readTimestampInspection(audioPath, { fs = fsExtra, durationSeconds = null } = {}) {
  const timestampsPath = timestampPathForAudio(audioPath);
  const timestampsAbs = await mediaPaths.resolveExisting(timestampsPath, { fs });
  if (!timestampsAbs || !(await fs.pathExists(timestampsAbs))) {
    return {
      timestamps_path: timestampsPath,
      timestamps_abs: timestampsAbs || null,
      missing: true,
      word_count: 0,
      inspection: {
        usable: false,
        reason: "timestamps_missing",
      },
      repair: null,
    };
  }
  const payload = await fs.readJson(timestampsAbs);
  return {
    timestamps_path: timestampsPath,
    timestamps_abs: timestampsAbs,
    missing: false,
    ...inspectTimestampPayload(payload, durationSeconds),
  };
}

function classifyStoryForLocalTtsRefresh(story = {}, opts = {}) {
  const allowPublishedRepair = opts.allowPublishedRepair === true;
  const approvedProof = opts.approvedProof || null;
  const platformIds = realPlatformIds(story);
  const blockers = [];
  const warnings = [];
  const needs = [];
  let action = "refresh_audio_and_rerender";

  if (!story.id) blockers.push("story_id_missing");
  if (!isApproved(story)) blockers.push("story_not_approved");
  if (!story.audio_path) needs.push("set_audio_path");
  if (!story.image_path) blockers.push("image_path_missing");
  if (platformIds.length > 0 && !allowPublishedRepair) {
    blockers.push("already_has_platform_ids");
    warnings.push("use --allow-published-repair only for local media repair; platform ids are preserved");
  }

  if (blockers.length > 0) action = "blocked";
  const audioPath = story.audio_path || path.join("output", "audio", `${safeStoryId(story.id)}.mp3`);
  const proofAudioPath = approvedProof?.output_audio_path || null;
  return {
    story_id: story.id || null,
    title: story.title || "",
    action,
    blockers,
    warnings,
    needs: [
      ...new Set([
        proofAudioPath
          ? "copy_approved_local_liam_proof_audio"
          : "regenerate_local_liam_audio",
        ...(proofAudioPath ? ["copy_approved_local_liam_word_timestamps"] : []),
        "clear_exported_path_for_rerender",
        ...needs,
      ]),
    ],
    platform_ids: platformIds,
    audio_path: audioPath,
    timestamps_path: timestampPathForAudio(audioPath),
    proof_audio_path: proofAudioPath,
    proof_timestamps_path: proofAudioPath ? timestampPathForAudio(proofAudioPath) : null,
    proof_source: approvedProof?.source || null,
    proof_duration_seconds: approvedProof?.duration_seconds ?? null,
    exported_path: story.exported_path || null,
    teaser_path: story.teaser_path || null,
  };
}

function approvedProofsByStory(localTtsProofReports = []) {
  const summary = summarizeLocalTtsProofReports(localTtsProofReports);
  const byStory = new Map();
  for (const proof of summary.ready_for_local_rerender || []) {
    if (!proof.story_id || byStory.has(proof.story_id)) continue;
    byStory.set(proof.story_id, proof);
  }
  return byStory;
}

function buildLocalTtsPublishRefreshPlan({
  stories = [],
  storyIds = [],
  allowPublishedRepair = false,
  localTtsProofReports = [],
  generatedAt = new Date().toISOString(),
  dryRun = true,
} = {}) {
  const wanted = new Set((storyIds || []).map((id) => String(id).trim()).filter(Boolean));
  const byId = new Map((stories || []).map((story) => [String(story.id), story]));
  const proofByStory = approvedProofsByStory(localTtsProofReports);
  const selected = wanted.size
    ? [...wanted].map((id) => byId.get(id) || { id, missing: true })
    : stories || [];
  const items = selected.map((story) => {
    if (story.missing) {
      return {
        story_id: story.id,
        title: "",
        action: "blocked",
        blockers: ["story_not_found"],
        warnings: [],
        needs: [],
        platform_ids: [],
      };
    }
    return classifyStoryForLocalTtsRefresh(story, {
      allowPublishedRepair,
      approvedProof: proofByStory.get(String(story.id)),
    });
  });

  return {
    schema_version: 1,
    generated_at: generatedAt,
    dry_run: dryRun !== false,
    story_filter: wanted.size ? [...wanted] : null,
    counts: {
      total: items.length,
      refreshable: items.filter((item) => item.action === "refresh_audio_and_rerender").length,
      blocked: items.filter((item) => item.action === "blocked").length,
    },
    items,
    safety: {
      local_only: true,
      dry_run_default: true,
      mutates_media: dryRun === false,
      mutates_local_db: dryRun === false,
      mutates_production_db: false,
      mutates_tokens: false,
      mutates_railway_env: false,
      triggers_oauth: false,
      posts_to_platforms: false,
      clears_platform_ids: false,
      switches_renderer_default: false,
    },
  };
}

function backupFileName(label, originalPath) {
  const base = path.basename(String(originalPath || label || "file"));
  return `${String(label || "media").replace(/[^a-z0-9_-]+/gi, "_")}_${base}`;
}

async function copyIfExists({ fs = fsExtra, sourceRel, label, backupDir }) {
  if (!sourceRel) return null;
  const sourceAbs = await mediaPaths.resolveExisting(sourceRel, { fs });
  if (!sourceAbs || !(await fs.pathExists(sourceAbs))) {
    return {
      label,
      source: sourceRel,
      source_abs: sourceAbs || null,
      copied: false,
      reason: "missing",
    };
  }
  await fs.ensureDir(backupDir);
  const targetAbs = path.join(backupDir, backupFileName(label, sourceRel));
  await fs.copy(sourceAbs, targetAbs, { overwrite: true });
  return {
    label,
    source: sourceRel,
    source_abs: sourceAbs,
    backup_abs: targetAbs,
    copied: true,
  };
}

async function backupStoryMedia({ story, backupRoot, generatedAt, fs = fsExtra } = {}) {
  const stamp = String(generatedAt || new Date().toISOString()).replace(/[:.]/g, "-");
  const backupDir = path.join(backupRoot, `${safeStoryId(story.id)}_${stamp}`);
  const audioPath = story.audio_path || path.join("output", "audio", `${safeStoryId(story.id)}.mp3`);
  const files = [];
  files.push(await copyIfExists({ fs, sourceRel: audioPath, label: "audio", backupDir }));
  files.push(await copyIfExists({ fs, sourceRel: timestampPathForAudio(audioPath), label: "timestamps", backupDir }));
  files.push(await copyIfExists({ fs, sourceRel: story.exported_path, label: "final", backupDir }));
  files.push(await copyIfExists({ fs, sourceRel: story.teaser_path, label: "teaser", backupDir }));
  return {
    backup_dir: backupDir,
    files: files.filter(Boolean),
  };
}

async function restoreBackedUpAudio({ backup, fs = fsExtra } = {}) {
  const restored = [];
  for (const item of backup?.files || []) {
    if (!item.copied || !["audio", "timestamps"].includes(item.label)) continue;
    await fs.copy(item.backup_abs, item.source_abs, { overwrite: true });
    restored.push({
      label: item.label,
      restored_to: item.source_abs,
    });
  }
  return restored;
}

async function copyApprovedProofAudio({
  proofAudioPath,
  proofTimestampsPath,
  targetAudioPath,
  fs = fsExtra,
} = {}) {
  const sourceAudioAbs = await mediaPaths.resolveExisting(proofAudioPath, { fs });
  if (!sourceAudioAbs || !(await fs.pathExists(sourceAudioAbs))) {
    const err = new Error("approved local Liam proof audio is missing");
    err.code = "approved_proof_audio_missing";
    throw err;
  }

  const sourceTimestampsPath = proofTimestampsPath || timestampPathForAudio(proofAudioPath);
  const sourceTimestampsAbs = await mediaPaths.resolveExisting(sourceTimestampsPath, { fs });
  if (!sourceTimestampsAbs || !(await fs.pathExists(sourceTimestampsAbs))) {
    const err = new Error("approved local Liam proof timestamps are missing");
    err.code = "approved_proof_timestamps_missing";
    throw err;
  }

  const targetAudioAbs = mediaPaths.writePath(targetAudioPath);
  const targetTimestampsPath = timestampPathForAudio(targetAudioPath);
  const targetTimestampsAbs = mediaPaths.writePath(targetTimestampsPath);
  await fs.ensureDir(path.dirname(targetAudioAbs));
  await fs.ensureDir(path.dirname(targetTimestampsAbs));
  await fs.copy(sourceAudioAbs, targetAudioAbs, { overwrite: true });
  await fs.copy(sourceTimestampsAbs, targetTimestampsAbs, { overwrite: true });

  return {
    source_audio_path: proofAudioPath,
    source_audio_abs: sourceAudioAbs,
    source_timestamps_path: sourceTimestampsPath,
    source_timestamps_abs: sourceTimestampsAbs,
    target_audio_path: targetAudioPath,
    target_audio_abs: targetAudioAbs,
    target_timestamps_path: targetTimestampsPath,
    target_timestamps_abs: targetTimestampsAbs,
  };
}

function clearStoryForLocalRerender(story = {}, { audioPath, audioDuration, reason } = {}) {
  const next = { ...story };
  next.audio_path = audioPath || next.audio_path || path.join("output", "audio", `${safeStoryId(next.id)}.mp3`);
  next.audio_duration = Number.isFinite(Number(audioDuration)) ? Number(Number(audioDuration).toFixed(2)) : next.audio_duration;
  next.exported_path = null;
  next.exported_at = null;
  next.teaser_path = null;
  next.qa_failed = false;
  next.publish_status = null;
  next.publish_error = null;
  next.qa_failed_at = null;
  delete next.qa_failures;
  delete next.qa_warnings;
  next.render_fallback_reason = reason || "local_tts_publish_refresh";
  next.local_tts_publish_refresh = {
    refreshed_at: new Date().toISOString(),
    reason: reason || "local_tts_publish_refresh",
    audio_path: next.audio_path,
    audio_duration_seconds: next.audio_duration ?? null,
  };
  return next;
}

async function applyLocalTtsPublishRefresh({
  plan,
  storiesById = {},
  generateTtsForStory,
  cleanText = (value) => value,
  selectRawTtsScript = firstScriptText,
  getAudioDuration,
  recoverLocalTts = null,
  persistStory,
  backupRoot,
  fs = fsExtra,
  env = process.env,
} = {}) {
  const needsGeneration = (plan?.items || []).some(
    (item) => item.action === "refresh_audio_and_rerender" && !item.proof_audio_path,
  );
  if (needsGeneration && typeof generateTtsForStory !== "function") {
    throw new Error("applyLocalTtsPublishRefresh requires generateTtsForStory");
  }
  if (typeof persistStory !== "function") {
    throw new Error("applyLocalTtsPublishRefresh requires persistStory");
  }
  if (typeof getAudioDuration !== "function") {
    throw new Error("applyLocalTtsPublishRefresh requires getAudioDuration");
  }
  const generatedAt = new Date().toISOString();
  const root = backupRoot || path.join(process.cwd(), "test", "output", "local-tts-publish-refresh", "backups");
  const applied = [];
  const skipped = [];

  for (const item of plan?.items || []) {
    if (item.action !== "refresh_audio_and_rerender") {
      skipped.push({
        story_id: item.story_id,
        reason: "not_refreshable",
        blockers: item.blockers || [],
      });
      continue;
    }
    const story = storiesById[item.story_id];
    if (!story) {
      skipped.push({ story_id: item.story_id, reason: "story_not_available" });
      continue;
    }

    const audioPath = item.audio_path || story.audio_path || path.join("output", "audio", `${safeStoryId(story.id)}.mp3`);
    const text = cleanText(selectRawTtsScript(story));
    const backup = await backupStoryMedia({ story: { ...story, audio_path: audioPath }, backupRoot: root, generatedAt, fs });
    try {
      let proofCopy = null;
      if (item.proof_audio_path) {
        proofCopy = await copyApprovedProofAudio({
          proofAudioPath: item.proof_audio_path,
          proofTimestampsPath: item.proof_timestamps_path,
          targetAudioPath: audioPath,
          fs,
        });
      } else {
        await generateTtsForStory({
          story,
          text,
          outputPath: audioPath,
          rate: 1.0,
          provider: "local",
          recoverLocalTts,
        });
      }
      const audioDuration = await getAudioDuration(audioPath);
      const timestampInspection = await readTimestampInspection(audioPath, {
        fs,
        durationSeconds: audioDuration,
      });
      const voiceQa = await runPublishVoiceQa(
        { ...story, audio_path: audioPath, tts_script: text },
        {
          fs,
          env: {
            ...env,
            DEPLOYMENT_MODE: "local",
            AUTO_PUBLISH: "true",
            REQUIRE_APPROVED_VOICE_FOR_PUBLISH: "true",
            ALLOW_REPAIRED_CAPTION_TIMING_FOR_PUBLISH: "false",
          },
        },
      );
      if (voiceQa.result === "fail") {
        const restored = await restoreBackedUpAudio({ backup, fs });
        skipped.push({
          story_id: item.story_id,
          reason: "new_voice_qa_failed",
          failures: voiceQa.failures || [],
          warnings: voiceQa.warnings || [],
          restored,
          backup,
        });
        continue;
      }
      const nextStory = clearStoryForLocalRerender(story, {
        audioPath,
        audioDuration,
        reason: "local_tts_caption_timing_refresh",
      });
      await persistStory(nextStory);
      applied.push({
        story_id: item.story_id,
        title: story.title || "",
        audio_path: audioPath,
        audio_duration_seconds: audioDuration,
        proof_source: item.proof_source || null,
        proof_audio_path: item.proof_audio_path || null,
        proof_copy: proofCopy,
        duration_verdict:
          Number.isFinite(Number(audioDuration)) &&
          Number(audioDuration) >= 60 &&
          Number(audioDuration) <= 75
            ? "shorts_ready"
            : Number.isFinite(Number(audioDuration)) && Number(audioDuration) < 60
              ? "under_60s_review"
              : Number.isFinite(Number(audioDuration)) && Number(audioDuration) > 75
                ? "over_75s_review"
                : "unknown",
        timestamp_inspection: timestampInspection,
        voice_qa: voiceQa,
        backup,
        next_action: "rerender_video_local",
      });
    } catch (err) {
      const restored = await restoreBackedUpAudio({ backup, fs });
      skipped.push({
        story_id: item.story_id,
        reason: "refresh_failed",
        error: String(err?.message || err).slice(0, 240),
        code: err?.code || null,
        restored,
        backup,
      });
    }
  }

  return {
    schema_version: 1,
    generated_at: generatedAt,
    applied,
    skipped,
    counts: {
      applied: applied.length,
      skipped: skipped.length,
    },
    safety: {
      local_only: true,
      mutates_media: true,
      mutates_local_db: true,
      mutates_production_db: false,
      mutates_tokens: false,
      mutates_railway_env: false,
      triggers_oauth: false,
      posts_to_platforms: false,
      clears_platform_ids: false,
      switches_renderer_default: false,
    },
  };
}

function renderLocalTtsPublishRefreshMarkdown(report) {
  const lines = [];
  lines.push("# Local TTS Publish Refresh");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  if (report.dry_run !== undefined) {
    lines.push(`Mode: ${report.dry_run ? "dry-run" : "apply-local"}`);
  }
  if (report.counts) {
    lines.push(
      `Counts: applied=${report.counts.applied ?? "n/a"} skipped=${report.counts.skipped ?? "n/a"} refreshable=${report.counts.refreshable ?? "n/a"} blocked=${report.counts.blocked ?? "n/a"}`,
    );
  }
  lines.push("");
  if (report.items) {
    lines.push("## Plan");
    for (const item of report.items) {
      lines.push(
        `- ${item.story_id}: ${item.action} | blockers=${(item.blockers || []).join(", ") || "clear"} | needs=${(item.needs || []).join(", ") || "none"} | ${item.title || ""}`,
      );
    }
    lines.push("");
  }
  if (report.applied) {
    lines.push("## Applied");
    if (!report.applied.length) {
      lines.push("- none");
    } else {
      for (const item of report.applied) {
        const timing = item.timestamp_inspection?.inspection;
        lines.push(
          `- ${item.story_id}: ${Number(item.audio_duration_seconds || 0).toFixed(2)}s | ${item.duration_verdict || "unknown"} | timing=${timing?.usable ? "pass" : `fail:${timing?.reason || "unknown"}`} | next=${item.next_action}`,
        );
      }
    }
    lines.push("");
  }
  if (report.rows) {
    lines.push("## Rerender");
    if (!report.rows.length) {
      lines.push("- none");
    } else {
      for (const row of report.rows) {
        lines.push(
          `- ${row.story_id}: exported=${row.exported_path || "none"} | final=${row.final_duration_seconds ?? "unknown"}s | audio=${row.audio_duration_seconds ?? "unknown"}s | qa_failed=${row.qa_failed}`,
        );
      }
    }
    lines.push("");
  }
  if (report.skipped?.length) {
    lines.push("## Skipped");
    for (const item of report.skipped) {
      lines.push(
        `- ${item.story_id}: ${item.reason}${item.error ? ` (${item.error})` : ""}${item.failures?.length ? ` | failures=${item.failures.join(", ")}` : ""}`,
      );
    }
    lines.push("");
  }
  lines.push("## Safety");
  lines.push("- Local-only audio/video repair.");
  lines.push("- Existing audio, timestamp and MP4 files are backed up before overwrite.");
  lines.push("- Platform post IDs are preserved.");
  lines.push("- No OAuth, tokens, Railway env vars or social posts are changed.");
  return `${lines.join("\n")}\n`;
}

module.exports = {
  applyLocalTtsPublishRefresh,
  approvedProofsByStory,
  buildLocalTtsPublishRefreshPlan,
  clearStoryForLocalRerender,
  copyApprovedProofAudio,
  inspectTimestampPayload,
  readTimestampInspection,
  realPlatformIds,
  renderLocalTtsPublishRefreshMarkdown,
  restoreBackedUpAudio,
  timestampRepairFromPayload,
};
