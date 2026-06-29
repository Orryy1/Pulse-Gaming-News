"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { TTS_PRONUNCIATION_PROFILE_VERSION } = require("./tts-pronunciation");
const {
  hasGtaViSpokenSix,
  hasMalformedGtaViSpokenStutter,
  hasRiskyGtaViOpening,
  hasSplitGtaViRomanNarration,
} = require("./studio/v2/approved-voice-path");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return Array.from(new Set(asArray(values).map(clean).filter(Boolean)));
}

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(clean(value));
}

function killSwitchState(env = {}) {
  const explicit = clean(env.PULSE_EMERGENCY_KILL_SWITCH || env.PULSE_KILL_SWITCH);
  if (explicit) return explicit.toLowerCase();
  if (truthy(env.PULSE_EMERGENCY_KILL_SWITCH_CLEAR)) return "clear";
  return "unknown";
}

function actionId(action = {}) {
  return `${clean(action.story_id)}:${clean(action.platform)}`;
}

function platformStatusFor(matrix = {}, platform) {
  return matrix.platforms?.[platform] || null;
}

function platformBlockers({ matrix = {}, action = {} } = {}) {
  const blockers = [];
  const platform = clean(action.platform);
  const storyId = clean(action.story_id);
  const status = platformStatusFor(matrix, platform);

  if (!status) {
    blockers.push(`platform_status_missing:${platform || "missing"}`);
    return blockers;
  }
  if (clean(status.status) !== "ready_now") blockers.push(`platform_not_ready_now:${platform}`);
  if (clean(status.operational_state) !== "enabled") blockers.push(`platform_not_enabled:${platform}`);
  if (Number(status.blocked_action_count || 0) > 0) blockers.push(`platform_has_blocked_actions:${platform}`);
  if (Number(status.deferred_action_count || 0) > 0) blockers.push(`platform_has_deferred_actions:${platform}`);
  if (!asArray(status.planned_story_ids).map(clean).includes(storyId)) {
    blockers.push(`platform_status_missing_story:${platform}`);
  }
  return blockers;
}

function platformMatrixSafetyOk(matrix = {}) {
  const safety = matrix.safety || {};
  return (
    safety.dry_run_only === true &&
    safety.no_network_uploads === true &&
    safety.no_public_posts === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true
  );
}

function guardedDispatchPlanSafetyOk(plan = {}) {
  const safety = plan.safety || {};
  return (
    plan.live_publish_allowed_from_this_tool === false &&
    safety.no_publish_triggered === true &&
    safety.no_network_uploads === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true
  );
}

function fileExistsWithMinimumBytes(filePath, minBytes = 1024) {
  const resolved = clean(filePath);
  if (!resolved || !fs.existsSync(resolved)) return false;
  try {
    return fs.statSync(resolved).size >= minBytes;
  } catch {
    return false;
  }
}

function resolveMaybeRelative(filePath, baseDir = process.cwd()) {
  const text = clean(filePath);
  if (!text) return "";
  return path.isAbsolute(text) ? text : path.resolve(baseDir || process.cwd(), text);
}

function readJsonSyncIfExists(filePath) {
  const resolved = clean(filePath);
  if (!resolved || !fs.existsSync(resolved)) return null;
  try {
    return fs.readJsonSync(resolved);
  } catch {
    return null;
  }
}

function comparableVoiceText(value = "") {
  return clean(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasGtaViPronunciationContext(value = "") {
  const text = comparableVoiceText(value);
  if (!text) return false;
  return (
    /\bg\s+t\s+a\s+(?:6|six|v\s+i|vi)\b/.test(text) ||
    /\bgta\s+(?:6|six|v\s+i|vi)\b/.test(text) ||
    /\bgrand\s+theft\s+auto\s+(?:6|six|v\s+i|vi)\b/.test(text) ||
    /\brockstars\s+next\s+grand\s+theft\s+auto\b/.test(text) ||
    /\bthe\s+next\s+grand\s+theft\s+auto\b/.test(text)
  );
}

function timestampPronunciationProfile(payload = {}) {
  const meta = payload?.meta || payload?.alignment?.meta || {};
  return clean(
    meta.ttsPronunciationProfileVersion ||
      meta.tts_pronunciation_profile_version ||
      payload.ttsPronunciationProfileVersion ||
      payload.tts_pronunciation_profile_version,
  );
}

function timestampWordText(payload = {}) {
  const words = Array.isArray(payload.words)
    ? payload.words
    : Array.isArray(payload.alignment?.words)
      ? payload.alignment.words
      : [];
  return clean(
    words
      .map((word) => word?.word || word?.text || word?.token || "")
      .filter(Boolean)
      .join(" "),
  );
}

function timestampVoiceTexts(payload = {}) {
  const meta = payload?.meta || payload?.alignment?.meta || {};
  return [
    meta.spoken_text,
    meta.transcript,
    meta.text,
    payload.transcript,
    payload.text,
    timestampWordText(payload),
  ].map(clean).filter(Boolean);
}

function canonicalManifestForAction(action = {}) {
  const canonicalPath = resolveMaybeRelative(action.canonical_manifest_path);
  const manifest = readJsonSyncIfExists(canonicalPath);
  return {
    path: canonicalPath,
    baseDir: canonicalPath ? path.dirname(canonicalPath) : process.cwd(),
    manifest: manifest || {},
  };
}

function timestampCandidatesForAction(action = {}, manifestLoad = {}) {
  const story = manifestLoad.manifest || {};
  const storyId = clean(action.story_id || story.story_id || story.id);
  const candidates = [
    action.word_timestamps_path,
    action.word_timestamp_path,
    action.timestamps_path,
    action.timestamp_path,
    action.subtitle_timestamps_path,
    action.alignment_path,
  ].map((filePath) => resolveMaybeRelative(filePath));

  for (const filePath of [
    story.word_timestamps_path,
    story.word_timestamp_path,
    story.timestamps_path,
    story.timestamp_path,
    story.subtitle_timestamps_path,
    story.alignment_path,
  ]) {
    if (!clean(filePath)) continue;
    candidates.push(resolveMaybeRelative(filePath));
    candidates.push(resolveMaybeRelative(filePath, manifestLoad.baseDir));
  }

  for (const filePath of [
    manifestLoad.path,
    action.video_path,
    action.captions_path,
    action.platform_publish_manifest_path,
  ]) {
    const resolved = resolveMaybeRelative(filePath);
    if (!resolved) continue;
    const dir = path.dirname(resolved);
    candidates.push(
      path.join(dir, "word_timestamps.json"),
      path.join(dir, "timestamps.json"),
      path.join(dir, "audio_timestamps.json"),
      path.join(dir, "narration_timestamps.json"),
      path.join(dir, "audio", "word_timestamps.json"),
    );
    if (storyId) candidates.push(path.join(dir, `${storyId}_timestamps.json`));
  }

  if (storyId) {
    candidates.push(path.join(process.cwd(), "output", "audio", `${storyId}_timestamps.json`));
  }

  return unique(candidates.map(clean).filter(Boolean));
}

function actionHasGtaViPronunciationContext(action = {}, story = {}) {
  return [
    story.title,
    story.public_title,
    story.upload_title,
    story.selected_title,
    story.canonical_subject,
    story.canonical_game,
    story.full_script,
    story.narration_script,
    story.tts_script,
    action.title,
  ].some(hasGtaViPronunciationContext);
}

function gtaViPronunciationEvidenceBlockers(action = {}) {
  const manifestLoad = canonicalManifestForAction(action);
  const story = manifestLoad.manifest || {};
  const storyHasGtaContext = actionHasGtaViPronunciationContext(action, story);
  const candidates = timestampCandidatesForAction(action, manifestLoad);
  let loadedTimestampPayload = null;

  for (const candidate of candidates) {
    const payload = readJsonSyncIfExists(candidate);
    if (payload) {
      loadedTimestampPayload = payload;
      break;
    }
  }

  if (!storyHasGtaContext && !loadedTimestampPayload) return [];

  const voiceTexts = loadedTimestampPayload ? timestampVoiceTexts(loadedTimestampPayload) : [];
  const voiceHasGtaContext = voiceTexts.some(hasGtaViPronunciationContext);
  if (!storyHasGtaContext && !voiceHasGtaContext) return [];

  const blockers = [];
  if (!loadedTimestampPayload) {
    blockers.push("gta_vi_timestamp_evidence_missing");
    return blockers;
  }

  if (timestampPronunciationProfile(loadedTimestampPayload) !== TTS_PRONUNCIATION_PROFILE_VERSION) {
    blockers.push("gta_vi_timestamp_profile_stale");
  }

  for (const value of voiceTexts) {
    if (hasMalformedGtaViSpokenStutter(value)) blockers.push("gta_vi_spoken_stutter");
    if (hasRiskyGtaViOpening(value)) blockers.push("gta_vi_opening_spoken_six_risk");
    if (hasSplitGtaViRomanNarration(value)) blockers.push("gta_vi_spoken_roman_split");
    if (hasGtaViSpokenSix(value)) blockers.push("gta_vi_spoken_six");
  }

  return unique(blockers);
}

function evidenceBlockers(action = {}) {
  const blockers = [];
  if (!fileExistsWithMinimumBytes(action.video_path)) blockers.push("video_path_missing_or_too_small");
  if (!fileExistsWithMinimumBytes(action.first_frame_source || action.video_path)) {
    blockers.push("first_frame_source_missing_or_too_small");
  }
  if (!fileExistsWithMinimumBytes(action.captions_path, 1)) blockers.push("captions_path_missing_or_empty");
  if (!fileExistsWithMinimumBytes(action.canonical_manifest_path, 1)) blockers.push("canonical_manifest_missing");
  if (!fileExistsWithMinimumBytes(action.platform_publish_manifest_path, 1)) {
    blockers.push("platform_publish_manifest_missing");
  }
  blockers.push(...gtaViPronunciationEvidenceBlockers(action));
  return blockers;
}

function executorState(env = {}) {
  const enabled = truthy(env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED);
  const killSwitch = killSwitchState(env);
  return {
    guarded_live_dispatch_enabled: enabled,
    emergency_kill_switch_state: killSwitch,
  };
}

function validateSelectedAction({
  action = {},
  guardedDispatchPlan = {},
  platformStatusMatrix = {},
  state = {},
} = {}) {
  const blockers = [];
  if (state.guarded_live_dispatch_enabled !== true) blockers.push("guarded_live_dispatch_not_armed");
  if (state.emergency_kill_switch_state !== "clear") blockers.push("emergency_kill_switch_not_clear");
  if (!guardedDispatchPlanSafetyOk(guardedDispatchPlan)) {
    blockers.push("guarded_dispatch_plan_safety_contract_failed");
  }
  if (!platformMatrixSafetyOk(platformStatusMatrix)) {
    blockers.push("platform_status_matrix_safety_contract_failed");
  }
  if (action.live_publish_allowed_from_preflight !== false) {
    blockers.push("dispatch_preflight_live_publish_flag_not_false");
  }
  if (action.requires_guarded_live_dispatch_executor !== true) {
    blockers.push("missing_live_executor_requirement");
  }
  if (action.requires_last_second_kill_switch_check !== true) {
    blockers.push("missing_last_second_kill_switch_requirement");
  }
  if (action.requires_last_second_platform_recheck !== true) {
    blockers.push("missing_last_second_platform_recheck_requirement");
  }
  blockers.push(...platformBlockers({ matrix: platformStatusMatrix, action }));
  blockers.push(...evidenceBlockers(action));
  return unique(blockers);
}

function buildHandoffAction(action = {}) {
  return {
    action_id: actionId(action),
    story_id: clean(action.story_id),
    platform: clean(action.platform),
    title: clean(action.title),
    video_path: clean(action.video_path),
    captions_path: clean(action.captions_path),
    first_frame_source: clean(action.first_frame_source),
    canonical_manifest_path: clean(action.canonical_manifest_path),
    platform_publish_manifest_path: clean(action.platform_publish_manifest_path),
    live_publish_allowed_from_preflight_only: false,
    requires_live_executor_command: true,
    requires_last_second_kill_switch_check: true,
    requires_last_second_platform_recheck: true,
  };
}

function buildGuardedDispatchExecutorPreflight({
  guardedDispatchPlan = {},
  platformStatusMatrix = {},
  selectedActionIds = [],
  selectAllDispatchReady = false,
  env = process.env,
  generatedAt = new Date().toISOString(),
} = {}) {
  const dispatchReadyActions = asArray(guardedDispatchPlan.dispatch_ready_actions);
  const actionById = new Map(dispatchReadyActions.map((action) => [actionId(action), action]));
  const selected = unique(
    selectAllDispatchReady
      ? dispatchReadyActions.map(actionId)
      : selectedActionIds,
  );
  const state = executorState(env);
  const advisory = [];
  const blockedSelectedActions = [];
  const handoffReadyActions = [];

  if (!dispatchReadyActions.length) advisory.push("no_dispatch_ready_actions");
  if (dispatchReadyActions.length && !selected.length) advisory.push("explicit_action_ids_required");
  if (selectAllDispatchReady && dispatchReadyActions.length) {
    advisory.push("selected_all_dispatch_ready_actions");
  }

  for (const id of selected) {
    const action = actionById.get(id);
    if (!action) {
      blockedSelectedActions.push({
        action_id: id,
        story_id: clean(id.split(":")[0]),
        platform: clean(id.split(":").slice(1).join(":")),
        blockers: ["selected_action_not_dispatch_ready"],
      });
      continue;
    }
    const blockers = validateSelectedAction({
      action,
      guardedDispatchPlan,
      platformStatusMatrix,
      state,
    });
    if (blockers.length) {
      blockedSelectedActions.push({
        action_id: id,
        story_id: clean(action.story_id),
        platform: clean(action.platform),
        title: clean(action.title),
        blockers,
      });
    } else {
      handoffReadyActions.push(buildHandoffAction(action));
    }
  }

  const verdict = blockedSelectedActions.length
    ? "RED"
    : handoffReadyActions.length
      ? "GREEN"
      : "AMBER";
  const requiredNextStep = verdict === "GREEN"
    ? "run_guarded_live_dispatch_executor"
    : blockedSelectedActions.length
      ? "repair_executor_preflight_blockers"
      : dispatchReadyActions.length
        ? "select_explicit_dispatch_action_ids"
        : clean(guardedDispatchPlan.required_next_step) ||
          "record_operator_approved_actions_before_guarded_dispatch";

  const executorPlan = {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "GUARDED_DISPATCH_EXECUTOR_PREFLIGHT",
    ready_for_live_executor_handoff: verdict === "GREEN" && handoffReadyActions.length > 0,
    live_publish_allowed_from_this_tool: false,
    required_next_step: requiredNextStep,
    handoff_ready_action_count: handoffReadyActions.length,
    blocked_selected_action_count: blockedSelectedActions.length,
    handoff_ready_actions: handoffReadyActions,
    blocked_selected_actions: blockedSelectedActions,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "GUARDED_DISPATCH_EXECUTOR_PREFLIGHT",
    verdict,
    safe_to_publish_boolean: false,
    executor_state: state,
    summary: {
      dispatch_ready_action_count: dispatchReadyActions.length,
      selected_action_count: selected.length,
      handoff_ready_action_count: handoffReadyActions.length,
      blocked_selected_action_count: blockedSelectedActions.length,
    },
    handoff_ready_actions: handoffReadyActions,
    blocked_selected_actions: blockedSelectedActions,
    advisory,
    executor_plan: executorPlan,
    safety: executorPlan.safety,
  };
}

function renderGuardedDispatchExecutorPreflightMarkdown(report = {}) {
  const lines = [
    "# Guarded Dispatch Executor Preflight",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Verdict: ${report.verdict || "UNKNOWN"}`,
    `Selected actions: ${report.summary?.selected_action_count || 0}`,
    `Handoff-ready actions: ${report.summary?.handoff_ready_action_count || 0}`,
    `Blocked selected actions: ${report.summary?.blocked_selected_action_count || 0}`,
    "No uploads are triggered. No database rows, OAuth settings or token files are changed.",
    "",
  ];
  if (asArray(report.handoff_ready_actions).length) {
    lines.push("## Ready For Live Executor Handoff", "");
    for (const action of asArray(report.handoff_ready_actions)) {
      lines.push(`- ${action.story_id} -> ${action.platform}: ${action.title}`);
    }
    lines.push("");
  }
  if (asArray(report.blocked_selected_actions).length) {
    lines.push("## Blocked", "");
    for (const action of asArray(report.blocked_selected_actions)) {
      lines.push(`- ${action.action_id || "unknown"}: ${asArray(action.blockers).join(", ")}`);
    }
    lines.push("");
  }
  if (asArray(report.advisory).length) {
    lines.push("## Advisory", "");
    for (const item of asArray(report.advisory)) lines.push(`- ${item}`);
    lines.push("");
  }
  return lines.join("\n");
}

function executorPlanReadyForHandoff(plan = {}) {
  return (
    plan.ready_for_live_executor_handoff === true &&
    Number(plan.handoff_ready_action_count || 0) > 0 &&
    asArray(plan.handoff_ready_actions).length > 0
  );
}

const CONTEXT_ONLY_NON_GREEN_BLOCKERS = new Set([
  "guarded_live_dispatch_not_armed",
  "emergency_kill_switch_not_clear",
]);

function reportIsContextOnlyNonGreen(report = {}) {
  if (clean(report.verdict) === "GREEN") return false;
  const summary = report.summary || {};
  const dispatchReadyCount = Number(summary.dispatch_ready_action_count || 0);
  const selectedCount = Number(summary.selected_action_count || 0);
  const handoffReadyCount = Number(summary.handoff_ready_action_count || 0);
  const blocked = asArray(report.blocked_selected_actions);
  const advisory = asArray(report.advisory);

  if (
    dispatchReadyCount > 0 &&
    selectedCount === 0 &&
    handoffReadyCount === 0 &&
    blocked.length === 0 &&
    advisory.includes("explicit_action_ids_required")
  ) {
    return true;
  }

  if (!blocked.length) return false;
  return blocked.every((action) => {
    const blockers = asArray(action.blockers);
    return blockers.length > 0 &&
      blockers.every((blocker) => CONTEXT_ONLY_NON_GREEN_BLOCKERS.has(clean(blocker)));
  });
}

async function shouldPreserveExistingReadyExecutorPlan({
  report = {},
  executorPlanPath,
  preserveExistingReadyExecutorPlanOnContextOnlyNonGreen = false,
} = {}) {
  if (!preserveExistingReadyExecutorPlanOnContextOnlyNonGreen) return false;
  if (!reportIsContextOnlyNonGreen(report)) return false;
  if (!executorPlanPath || !await fs.pathExists(executorPlanPath)) return false;
  try {
    return executorPlanReadyForHandoff(await fs.readJson(executorPlanPath));
  } catch {
    return false;
  }
}

async function writeGuardedDispatchExecutorPreflight(
  report = {},
  {
    outputDir,
    preserveExistingReadyExecutorPlanOnContextOnlyNonGreen = false,
  } = {},
) {
  if (!outputDir) throw new Error("writeGuardedDispatchExecutorPreflight requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const reportPath = path.join(outDir, "guarded_dispatch_executor_preflight_report.json");
  const executorPlanPath = path.join(outDir, "guarded_dispatch_executor_plan.json");
  const nonGreenExecutorPlanPath = path.join(outDir, "guarded_dispatch_executor_plan.non_green.json");
  const markdownPath = path.join(outDir, "guarded_dispatch_executor_preflight.md");
  await fs.writeJson(reportPath, report, { spaces: 2 });
  const executorPlanPreserved = await shouldPreserveExistingReadyExecutorPlan({
    report,
    executorPlanPath,
    preserveExistingReadyExecutorPlanOnContextOnlyNonGreen,
  });
  if (executorPlanPreserved) {
    await fs.writeJson(nonGreenExecutorPlanPath, report.executor_plan || {}, { spaces: 2 });
  } else {
    await fs.writeJson(executorPlanPath, report.executor_plan || {}, { spaces: 2 });
  }
  await fs.writeFile(markdownPath, renderGuardedDispatchExecutorPreflightMarkdown(report), "utf8");
  return {
    outputDir: outDir,
    reportPath,
    executorPlanPath,
    nonGreenExecutorPlanPath: executorPlanPreserved ? nonGreenExecutorPlanPath : null,
    executorPlanPreserved,
    markdownPath,
  };
}

module.exports = {
  buildGuardedDispatchExecutorPreflight,
  renderGuardedDispatchExecutorPreflightMarkdown,
  reportIsContextOnlyNonGreen,
  writeGuardedDispatchExecutorPreflight,
};
