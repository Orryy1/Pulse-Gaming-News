"use strict";

const MINIMUM_RUNWAY_STORIES = 5;
const MINIMUM_RESERVE_STORIES = 5;
const MAX_TARGET_STORIES = 100;
const MAX_EVIDENCE_ROWS = 500;
const DEFAULT_MAX_EVIDENCE_AGE_MS = 2 * 60 * 60 * 1000;

const EVIDENCE_NAMES = [
  "candidate",
  "preflight",
  "dry_run",
  "guarded",
  "executor",
];

const ACTION_PATHS = {
  preflight: [
    "executable_actions",
    "ready_actions",
    "preflight_ready_actions",
    "actions",
    "preflight.executable_actions",
  ],
  dry_run: ["actions", "safe_publish_plan.actions", "dry_run_plan.actions"],
  guarded: [
    "dispatch_ready_actions",
    "guarded_dispatch_plan.dispatch_ready_actions",
    "ready_actions",
    "actions",
  ],
  executor: [
    "handoff_ready_actions",
    "executor_plan.handoff_ready_actions",
    "ready_actions",
    "actions",
  ],
};

const CANDIDATE_PATHS = [
  "candidates",
  "ready_candidates",
  "candidate_stories",
  "ready_stories",
  "runway.candidates",
  "candidate_pool.candidates",
];

const RESERVE_PATHS = [
  "reserve_stories",
  "reserve_candidates",
  "runway.reserve_stories",
  "candidate_buffer.reserve_stories",
  "youtube_upload_runway.reserve_stories",
];

const BLOCKED_ACTION_PATHS = [
  "blocked_actions",
  "blocked_selected_actions",
  "guarded_dispatch_plan.blocked_actions",
  "executor_plan.blocked_selected_actions",
];

const PATH_KEYS = new Set([
  "document_path",
  "evidence_path",
  "exists",
  "file",
  "file_path",
  "path",
  "report_path",
  "source_path",
]);

const ENVELOPE_KEYS = new Set([
  "advisory",
  "blockers",
  "created_at",
  "critical_inputs",
  "disabled_platforms",
  "enabled_platforms",
  "evidence_generation_id",
  "generated_at",
  "generation",
  "generation_id",
  "generationId",
  "metadata",
  "mode",
  "overall_verdict",
  "publish_runway_generation_id",
  "runway_generation_id",
  "safety",
  "schema_version",
  "status",
  "summary",
  "target_window",
  "target_window_id",
  "verdict",
  "window",
  "window_id",
]);

function clean(value) {
  return String(value ?? "").trim();
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Date),
  );
}

function unique(values) {
  return [...new Set(array(values).map(clean).filter(Boolean))];
}

function normalisePlatform(value) {
  const platform = clean(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (["youtube", "youtube_short", "youtube_shorts"].includes(platform)) {
    return "youtube_shorts";
  }
  if (["instagram", "instagram_reel", "instagram_reels"].includes(platform)) {
    return "instagram_reels";
  }
  if (["facebook", "facebook_reel", "facebook_reels"].includes(platform)) {
    return "facebook_reels";
  }
  if (["twitter", "twitter_video", "x", "x_video"].includes(platform)) {
    return "x";
  }
  return platform;
}

function normaliseVerdict(value) {
  const verdict = clean(value).toLowerCase();
  if (
    ["green", "ok", "pass", "passed", "ready", "success", "approved", "eligible"]
      .includes(verdict)
  ) {
    return "GREEN";
  }
  if (["amber", "partial", "review", "warn", "warning", "held"].includes(verdict)) {
    return "AMBER";
  }
  if (
    [
      "red",
      "block",
      "blocked",
      "error",
      "fail",
      "failed",
      "ineligible",
      "reject",
      "rejected",
    ].includes(verdict)
  ) {
    return "RED";
  }
  return "UNKNOWN";
}

function timeMs(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function get(value, dottedPath) {
  let current = value;
  for (const key of dottedPath.split(".")) {
    if (!object(current) || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

function firstList(document, paths) {
  for (const path of paths) {
    const value = get(document, path);
    if (Array.isArray(value)) return { present: true, path, rows: value };
  }
  return { present: false, path: null, rows: [] };
}

function allLists(document, paths) {
  const rows = [];
  const seen = new Set();
  for (const path of paths) {
    for (const row of array(get(document, path))) {
      const key = object(row)
        ? [
            clean(row.action_id),
            clean(row.story_id || row.storyId || row.id),
            normalisePlatform(row.platform),
            unique(row.blockers).join("|"),
          ].join(":")
        : JSON.stringify(row);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }
  return rows;
}

function addBlocker(blockers, blocker) {
  const key = [
    blocker.code,
    blocker.severity,
    blocker.evidence,
    blocker.story_id,
    blocker.platform,
    blocker.input,
    blocker.field,
    blocker.message,
  ].map(clean).join("|");
  if (!blockers.keys.has(key)) {
    blockers.keys.add(key);
    blockers.rows.push(
      Object.fromEntries(
        Object.entries(blocker).filter(([, value]) => value !== undefined),
      ),
    );
  }
}

function bounded(rows, blockers, evidence, collection) {
  if (rows.length > MAX_EVIDENCE_ROWS) {
    addBlocker(blockers, {
      code: "EVIDENCE_ROW_LIMIT_EXCEEDED",
      severity: "RED",
      evidence,
      collection,
      actual_count: rows.length,
      maximum_count: MAX_EVIDENCE_ROWS,
      message: `${evidence} ${collection} exceeds the bounded row limit`,
    });
  }
  return rows.slice(0, MAX_EVIDENCE_ROWS);
}

function storyId(row) {
  return object(row) ? clean(row.story_id || row.storyId || row.id) : clean(row);
}

function generationId(document) {
  return clean(
    document.generation_id ||
      document.publish_runway_generation_id ||
      document.runway_generation_id ||
      document.evidence_generation_id ||
      document.generationId ||
      document.generation?.id ||
      document.metadata?.generation_id,
  );
}

function windowId(document) {
  return clean(
    document.window_id ||
      document.publish_window_id ||
      document.target_window_id ||
      document.window_label ||
      document.window?.id ||
      document.window?.window_id ||
      document.target_window?.id ||
      document.metadata?.window_id,
  );
}

function generatedAt(document) {
  return clean(
    document.generated_at ||
      document.created_at ||
      document.metadata?.generated_at,
  );
}

function documentVerdict(name, document) {
  const explicit = normaliseVerdict(
    document.verdict || document.overall_verdict || document.status,
  );
  if (explicit !== "UNKNOWN") return explicit;
  if (
    name === "guarded" &&
    (document.ready_for_guarded_dispatch === true ||
      document.guarded_dispatch_plan?.ready_for_guarded_dispatch === true)
  ) {
    return "GREEN";
  }
  if (
    name === "executor" &&
    (document.ready_for_live_executor_handoff === true ||
      document.executor_plan?.ready_for_live_executor_handoff === true)
  ) {
    return "GREEN";
  }
  if (document.can_auto_publish === true || document.ready === true) return "GREEN";
  return "UNKNOWN";
}

function pathOnly(value) {
  if (typeof value === "string") return Boolean(clean(value));
  if (!object(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.some((key) => PATH_KEYS.has(key)) &&
    keys.every((key) => PATH_KEYS.has(key) || ENVELOPE_KEYS.has(key))
  );
}

function platformValues(value, expectedState) {
  if (Array.isArray(value)) return value;
  if (!object(value)) return [];
  return Object.entries(value)
    .filter(([, state]) => state === expectedState)
    .map(([platform]) => platform);
}

function platformScope(document) {
  const enabled = new Set(
    unique([
      ...platformValues(document.enabled_platforms, true),
      ...array(document.platform_scope?.enabled_platforms),
      ...array(document.safety?.enabled_platforms),
    ]).map(normalisePlatform),
  );
  const disabled = new Set(
    unique([
      ...platformValues(document.disabled_platforms, true),
      ...array(document.platform_scope?.disabled_platforms),
      ...array(document.safety?.disabled_platforms),
    ]).map(normalisePlatform),
  );
  for (const map of [
    document.platforms,
    document.platform_status_matrix?.platforms,
    document.platform_operational_config,
  ]) {
    if (!object(map)) continue;
    for (const [key, value] of Object.entries(map)) {
      const platform = normalisePlatform(value?.platform || key);
      const state = clean(
        value?.operational_state || value?.state || value?.status || value,
      ).toLowerCase();
      if (
        value?.enabled === true ||
        ["enabled", "ready", "ready_now", "operational"].includes(state)
      ) {
        enabled.add(platform);
      }
      if (
        value?.enabled === false ||
        [
          "disabled",
          "deferred",
          "deferred_until_platform_enabled",
          "needs_credentials",
        ].includes(state)
      ) {
        disabled.add(platform);
      }
    }
  }
  for (const platform of disabled) enabled.delete(platform);
  return { enabled, disabled };
}

function platformEnabled(row, scope) {
  const platform = normalisePlatform(row.platform);
  const rowEnabled = new Set(unique(row.enabled_platforms).map(normalisePlatform));
  const rowDisabled = new Set(unique(row.disabled_platforms).map(normalisePlatform));
  if (
    row.platform_enabled === false ||
    row.enabled === false ||
    rowDisabled.has(platform) ||
    scope.disabled.has(platform)
  ) {
    return false;
  }
  if (
    row.platform_enabled === true ||
    row.enabled === true ||
    rowEnabled.has(platform) ||
    scope.enabled.has(platform)
  ) {
    return true;
  }
  const state = clean(
    row.operational_state || row.platform_state || row.platform_status,
  ).toLowerCase();
  if (["enabled", "ready", "ready_now", "operational"].includes(state)) return true;
  if (
    ["disabled", "deferred", "deferred_until_platform_enabled", "needs_credentials"]
      .includes(state)
  ) {
    return false;
  }
  return null;
}

function rowBlocked(row) {
  const verdict = normaliseVerdict(
    row.verdict || row.overall_verdict || row.status || row.result,
  );
  return (
    row.blocked === true ||
    row.eligible === false ||
    row.executable === false ||
    row.ready === false ||
    verdict === "RED" ||
    array(row.blockers).length > 0 ||
    array(row.critical_blockers).length > 0
  );
}

function inspectCriticalInputs(name, document, blockers) {
  for (const detail of unique([
    ...array(document.blockers),
    ...array(document.critical_blockers),
    ...array(document.blocking_reasons),
  ])) {
    addBlocker(blockers, {
      code: "EVIDENCE_BLOCKER_PRESENT",
      severity: "RED",
      evidence: name,
      detail,
      message: `${name} evidence has an explicit blocker`,
    });
  }

  const container = document.critical_inputs;
  const rows = Array.isArray(container)
    ? container
    : [
        ...array(container?.inputs),
        ...array(container?.items),
        ...array(document.blocked_critical_inputs),
      ];
  for (const input of bounded(rows, blockers, name, "critical_inputs")) {
    if (!object(input)) {
      addBlocker(blockers, {
        code: "CRITICAL_INPUT_INVALID",
        severity: "RED",
        evidence: name,
        message: `${name} has a non-object critical input`,
      });
      continue;
    }
    const verdict = normaliseVerdict(input.verdict || input.status || input.result);
    const inputName = clean(input.input || input.name || input.key) || "unknown";
    if (
      verdict === "RED" ||
      input.blocked === true ||
      input.passed === false ||
      array(input.blockers).length > 0
    ) {
      addBlocker(blockers, {
        code: "CRITICAL_INPUT_BLOCKED",
        severity: "RED",
        evidence: name,
        input: inputName,
        details: unique(input.blockers),
        message: `${name} has a blocked critical input`,
      });
    } else if (verdict === "AMBER") {
      addBlocker(blockers, {
        code: "CRITICAL_INPUT_AMBER",
        severity: "AMBER",
        evidence: name,
        input: inputName,
        message: `${name} has an AMBER critical input`,
      });
    } else if (verdict === "UNKNOWN" && input.passed !== true) {
      addBlocker(blockers, {
        code: "CRITICAL_INPUT_VERDICT_MISSING",
        severity: "RED",
        evidence: name,
        input: inputName,
        message: `${name} critical input has no explicit passing state`,
      });
    }
  }

  const countFields = [
    ["critical_inputs.red_count", container?.red_count, "RED"],
    ["critical_inputs.blocked_count", container?.blocked_count, "RED"],
    ["critical_inputs.failed_count", container?.failed_count, "RED"],
    ["critical_inputs.amber_count", container?.amber_count, "AMBER"],
    ["blocked_critical_input_count", document.blocked_critical_input_count, "RED"],
    ["critical_blocker_count", document.critical_blocker_count, "RED"],
    ["red_critical_input_count", document.red_critical_input_count, "RED"],
    ["safety_blocker_count", document.safety_blocker_count, "RED"],
    ["summary.blocked_critical_input_count", document.summary?.blocked_critical_input_count, "RED"],
    ["summary.critical_blocker_count", document.summary?.critical_blocker_count, "RED"],
    ["summary.red_critical_input_count", document.summary?.red_critical_input_count, "RED"],
    ["summary.safety_blocker_count", document.summary?.safety_blocker_count, "RED"],
  ];
  for (const [field, rawCount, severity] of countFields) {
    const count = Number(rawCount || 0);
    if (!Number.isFinite(count) || count <= 0) continue;
    addBlocker(blockers, {
      code: "CRITICAL_INPUT_COUNT_NONZERO",
      severity,
      evidence: name,
      field,
      count,
      message: `${name} reports non-passing critical inputs`,
    });
  }
}

function inspectBlockedActions(name, document, blockers) {
  const rows = bounded(
    allLists(document, BLOCKED_ACTION_PATHS),
    blockers,
    name,
    "blocked_actions",
  );
  const scope = platformScope(document);
  let ignoredDisabled = 0;
  for (const row of rows) {
    if (!object(row)) {
      addBlocker(blockers, {
        code: "BLOCKED_ACTION_INVALID",
        severity: "RED",
        evidence: name,
        message: `${name} has invalid blocked action evidence`,
      });
      continue;
    }
    const enabled = platformEnabled(row, scope);
    if (enabled === false) {
      ignoredDisabled += 1;
      continue;
    }
    addBlocker(blockers, {
      code:
        enabled === true
          ? "ENABLED_PLATFORM_ACTION_BLOCKED"
          : "BLOCKED_ACTION_PLATFORM_ENABLEMENT_UNKNOWN",
      severity: "RED",
      evidence: name,
      story_id: storyId(row) || null,
      platform: normalisePlatform(row.platform) || null,
      details: unique(row.blockers),
      message:
        enabled === true
          ? `${name} has a blocked enabled-platform action`
          : `${name} blocked action platform enablement is unproven`,
    });
  }

  const declaredCount = Math.max(
    0,
    ...[
      document.blocked_action_count,
      document.blocked_selected_action_count,
      document.summary?.blocked_action_count,
      document.summary?.blocked_selected_action_count,
    ].map((value) => Number(value) || 0),
  );
  if (declaredCount > rows.length) {
    addBlocker(blockers, {
      code: "BLOCKED_ACTION_DETAILS_MISSING",
      severity: "RED",
      evidence: name,
      declared_count: declaredCount,
      evidenced_count: rows.length,
      message: `${name} blocked action count exceeds its concrete action rows`,
    });
  }
  return {
    blocked_action_count: rows.length,
    ignored_disabled_blocked_action_count: ignoredDisabled,
  };
}

function actionExecutable(row, stage, sourcePath) {
  if (rowBlocked(row)) return false;
  if (row.executable === true || row.ready === true) return true;
  if (
    stage === "preflight" &&
    ["executable_actions", "ready_actions", "preflight_ready_actions"]
      .includes(sourcePath)
  ) {
    return true;
  }
  if (stage === "dry_run") {
    return (
      clean(row.action).toLowerCase() === "would_publish" &&
      row.autonomous_green_lit_by_dry_run !== false
    );
  }
  if (stage === "guarded" && sourcePath.includes("dispatch_ready_actions")) return true;
  return stage === "executor" && sourcePath.includes("handoff_ready_actions");
}

function inspectActions(stage, document, blockers) {
  const collection = firstList(document, ACTION_PATHS[stage]);
  const result = {
    collection_path: collection.path,
    actions: new Map(),
    input_action_count: 0,
    ignored_disabled_actions: [],
    ignored_non_youtube_action_count: 0,
  };
  if (!collection.present) {
    addBlocker(blockers, {
      code: "ACTION_EVIDENCE_MISSING",
      severity: "RED",
      evidence: stage,
      message: `${stage} has no concrete executable action collection`,
    });
    return result;
  }

  const rows = bounded(collection.rows, blockers, stage, collection.path);
  const scope = platformScope(document);
  result.input_action_count = rows.length;
  for (const row of rows) {
    if (!object(row)) {
      addBlocker(blockers, {
        code: "ACTION_EVIDENCE_INVALID",
        severity: "RED",
        evidence: stage,
        message: `${stage} has a non-object action row`,
      });
      continue;
    }
    const id = storyId(row);
    const platform = normalisePlatform(row.platform);
    const enabled = platformEnabled(row, scope);
    if (enabled === false) {
      result.ignored_disabled_actions.push({
        action_id: clean(row.action_id) || (id && platform ? `${id}:${platform}` : null),
        story_id: id || null,
        platform: platform || null,
        evidence: stage,
      });
      continue;
    }
    if (platform !== "youtube_shorts") {
      result.ignored_non_youtube_action_count += 1;
      continue;
    }
    if (enabled !== true) {
      addBlocker(blockers, {
        code: "ACTION_PLATFORM_ENABLEMENT_UNPROVEN",
        severity: "RED",
        evidence: stage,
        story_id: id || null,
        platform,
        message: `${stage} YouTube action is not explicitly enabled`,
      });
      continue;
    }
    if (!id) {
      addBlocker(blockers, {
        code: "ACTION_STORY_ID_MISSING",
        severity: "RED",
        evidence: stage,
        platform,
        message: `${stage} YouTube action has no story id`,
      });
      continue;
    }
    if (row.youtube_first === false || Number(row.publish_order || 1) > 1) {
      addBlocker(blockers, {
        code: "ACTION_NOT_YOUTUBE_FIRST",
        severity: "AMBER",
        evidence: stage,
        story_id: id,
        platform,
        message: `${stage} action is not YouTube-first`,
      });
      continue;
    }
    const verdict = normaliseVerdict(row.verdict || row.status || row.result);
    if (verdict === "RED" || rowBlocked(row)) {
      addBlocker(blockers, {
        code: "EXECUTABLE_ACTION_BLOCKED",
        severity: "RED",
        evidence: stage,
        story_id: id,
        platform,
        details: unique(row.blockers),
        message: `${stage} executable action is blocked`,
      });
      continue;
    }
    if (verdict === "AMBER") {
      addBlocker(blockers, {
        code: "EXECUTABLE_ACTION_AMBER",
        severity: "AMBER",
        evidence: stage,
        story_id: id,
        platform,
        message: `${stage} executable action is AMBER`,
      });
      continue;
    }
    if (!actionExecutable(row, stage, collection.path)) {
      addBlocker(blockers, {
        code: "ACTION_EXECUTABILITY_UNPROVEN",
        severity: "RED",
        evidence: stage,
        story_id: id,
        platform,
        message: `${stage} action is not explicitly executable`,
      });
      continue;
    }
    if (!result.actions.has(id)) result.actions.set(id, row);
  }
  return result;
}

function eligibleStories(rows, document, blockers, evidence, collection) {
  const result = new Map();
  const scope = platformScope(document);
  for (const value of bounded(rows, blockers, evidence, collection)) {
    const row = typeof value === "string" ? { story_id: clean(value) } : value;
    if (!object(row)) continue;
    const id = storyId(row);
    const verdict = normaliseVerdict(row.verdict || row.status || row.result);
    if (!id || rowBlocked(row) || ["RED", "AMBER"].includes(verdict)) continue;
    if (row.youtube_first === false) continue;
    const enabled = new Set(unique(row.enabled_platforms).map(normalisePlatform));
    const disabled = new Set(unique(row.disabled_platforms).map(normalisePlatform));
    const youtubeEnabled =
      !disabled.has("youtube_shorts") &&
      (enabled.has("youtube_shorts") ||
        scope.enabled.has("youtube_shorts") ||
        (
          normalisePlatform(row.platform) === "youtube_shorts" &&
          platformEnabled(row, scope) === true
        ));
    if (youtubeEnabled && !result.has(id)) result.set(id, row);
  }
  return result;
}

function suppliedDocuments(options) {
  const nested =
    options.evidenceDocuments ||
    options.evidence_documents ||
    options.documents ||
    options.evidence ||
    {};
  return {
    candidate:
      options.candidateEvidence ??
      options.candidateEvidenceDocument ??
      options.candidate_evidence ??
      options.candidateDocument ??
      options.candidate_document ??
      options.candidateReport ??
      options.candidate_report ??
      nested.candidate ??
      options.candidate,
    preflight:
      options.preflightEvidence ??
      options.preflightEvidenceDocument ??
      options.preflight_evidence ??
      options.preflightDocument ??
      options.preflight_document ??
      options.preflightReport ??
      options.preflight_report ??
      nested.preflight ??
      options.preflight,
    dry_run:
      options.dryRunEvidence ??
      options.dryRunEvidenceDocument ??
      options.dry_run_evidence ??
      options.dryRunDocument ??
      options.dry_run_document ??
      options.dryRunPlan ??
      options.dry_run_plan ??
      nested.dry_run ??
      nested.dryRun ??
      options.dryRun ??
      options.dry_run,
    guarded:
      options.guardedEvidence ??
      options.guardedEvidenceDocument ??
      options.guarded_evidence ??
      options.guardedDocument ??
      options.guarded_document ??
      options.guardedDispatchPlan ??
      options.guarded_dispatch_plan ??
      nested.guarded ??
      options.guarded,
    executor:
      options.executorEvidence ??
      options.executorEvidenceDocument ??
      options.executor_evidence ??
      options.executorDocument ??
      options.executor_document ??
      options.executorPlan ??
      options.executor_plan ??
      nested.executor ??
      options.executor,
  };
}

function targetCount(value, minimum, field, blockers) {
  if (value === undefined || value === null || clean(value) === "") return minimum;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0 || count > MAX_TARGET_STORIES) {
    addBlocker(blockers, {
      code: "TARGET_COUNT_INVALID",
      severity: "RED",
      field,
      value,
      minimum,
      maximum: MAX_TARGET_STORIES,
      message: `${field} must be an integer between 0 and ${MAX_TARGET_STORIES}`,
    });
    return minimum;
  }
  return Math.max(minimum, count);
}

function normaliseWindow(options, blockers) {
  const currentMs = timeMs(
    options.now ??
      options.currentTime ??
      options.current_time ??
      options.generatedAt ??
      options.generated_at,
  );
  const target =
    options.targetWindow ??
    options.target_window ??
    options.window ?? {
      id: options.windowId ?? options.window_id ?? options.windowLabel ?? options.window_label,
      starts_at:
        options.windowStartsAt ??
        options.window_starts_at ??
        options.windowStart ??
        options.window_start,
      ends_at:
        options.windowEndsAt ??
        options.window_ends_at ??
        options.windowEnd ??
        options.window_end,
      evidence_fresh_after:
        options.evidenceFreshAfter ?? options.evidence_fresh_after,
    };
  const id = clean(target.id || target.window_id || target.label || target.window_label);
  const startsMs = timeMs(
    target.starts_at ||
      target.start_at ||
      target.window_starts_at ||
      target.window_start ||
      target.start,
  );
  const endsMs = timeMs(
    target.ends_at ||
      target.end_at ||
      target.window_ends_at ||
      target.window_end ||
      target.end,
  );
  const explicitCutoff = timeMs(
    target.evidence_fresh_after || target.fresh_after || target.freshness_cutoff,
  );
  const configuredMaxAge = Number(
    options.maxEvidenceAgeMs ??
      options.max_evidence_age_ms ??
      target.max_evidence_age_ms ??
      (
        target.max_evidence_age_minutes != null
          ? Number(target.max_evidence_age_minutes) * 60_000
          : DEFAULT_MAX_EVIDENCE_AGE_MS
      ),
  );
  const maxAgeMs =
    Number.isFinite(configuredMaxAge) && configuredMaxAge > 0
      ? configuredMaxAge
      : DEFAULT_MAX_EVIDENCE_AGE_MS;
  const cutoffMs =
    explicitCutoff !== null
      ? explicitCutoff
      : currentMs !== null
        ? currentMs - maxAgeMs
        : null;

  if (currentMs === null) {
    addBlocker(blockers, {
      code: "CURRENT_TIME_INVALID",
      severity: "RED",
      message: "current time must be an explicit valid timestamp",
    });
  }
  if (!id) {
    addBlocker(blockers, {
      code: "TARGET_WINDOW_ID_MISSING",
      severity: "RED",
      message: "target window id is required",
    });
  }
  if (startsMs === null || endsMs === null || startsMs >= endsMs) {
    addBlocker(blockers, {
      code: "TARGET_WINDOW_INVALID",
      severity: "RED",
      message: "target window needs valid ordered start and end timestamps",
    });
  }
  if (currentMs !== null && endsMs !== null && currentMs > endsMs) {
    addBlocker(blockers, {
      code: "TARGET_WINDOW_CLOSED",
      severity: "RED",
      window_id: id || null,
      message: "target window has already closed",
    });
  }

  let state = "unknown";
  if (currentMs !== null && startsMs !== null && endsMs !== null) {
    state = currentMs < startsMs ? "upcoming" : currentMs <= endsMs ? "open" : "closed";
  }
  return {
    id: id || null,
    current_time: iso(currentMs),
    starts_at: iso(startsMs),
    ends_at: iso(endsMs),
    state,
    freshness_cutoff: iso(cutoffMs),
    max_evidence_age_ms: maxAgeMs,
    current_ms: currentMs,
    cutoff_ms: cutoffMs,
  };
}

function inspectDocument(name, document, expectedGenerationId, window, blockers) {
  const inspection = {
    present: document !== null && document !== undefined,
    materialised: false,
    generation_id: null,
    generated_at: null,
    window_id: null,
    verdict: "UNKNOWN",
    fresh: false,
  };
  if (document === null || document === undefined) {
    addBlocker(blockers, {
      code: "EVIDENCE_DOCUMENT_MISSING",
      severity: "RED",
      evidence: name,
      message: `${name} evidence document is missing`,
    });
    return { document: null, inspection };
  }
  if (pathOnly(document)) {
    addBlocker(blockers, {
      code: "EVIDENCE_PATH_ONLY",
      severity: "RED",
      evidence: name,
      message: `${name} evidence is a path rather than a materialised document`,
    });
    return { document: null, inspection };
  }
  if (!object(document) || Object.keys(document).length === 0) {
    addBlocker(blockers, {
      code: "EVIDENCE_DOCUMENT_INVALID",
      severity: "RED",
      evidence: name,
      message: `${name} evidence must be a non-empty object`,
    });
    return { document: null, inspection };
  }

  inspection.materialised = true;
  inspection.generation_id = generationId(document) || null;
  inspection.generated_at = generatedAt(document) || null;
  inspection.window_id = windowId(document) || null;
  inspection.verdict = documentVerdict(name, document);

  if (!inspection.generation_id) {
    addBlocker(blockers, {
      code: "EVIDENCE_GENERATION_ID_MISSING",
      severity: "RED",
      evidence: name,
      message: `${name} has no explicit generation id`,
    });
  } else if (
    expectedGenerationId &&
    inspection.generation_id !== expectedGenerationId
  ) {
    addBlocker(blockers, {
      code: "EVIDENCE_GENERATION_MISMATCH",
      severity: "RED",
      evidence: name,
      expected_generation_id: expectedGenerationId,
      actual_generation_id: inspection.generation_id,
      message: `${name} belongs to a different evidence generation`,
    });
  }

  if (!inspection.window_id) {
    addBlocker(blockers, {
      code: "EVIDENCE_WINDOW_ID_MISSING",
      severity: "RED",
      evidence: name,
      message: `${name} has no explicit target window id`,
    });
  } else if (window.id && inspection.window_id !== window.id) {
    addBlocker(blockers, {
      code: "EVIDENCE_WINDOW_MISMATCH",
      severity: "RED",
      evidence: name,
      expected_window_id: window.id,
      actual_window_id: inspection.window_id,
      message: `${name} belongs to a different target window`,
    });
  }

  const generatedMs = timeMs(inspection.generated_at);
  if (generatedMs === null) {
    addBlocker(blockers, {
      code: "EVIDENCE_GENERATED_AT_INVALID",
      severity: "RED",
      evidence: name,
      message: `${name} has no valid generated_at timestamp`,
    });
  } else if (window.current_ms !== null && generatedMs > window.current_ms) {
    addBlocker(blockers, {
      code: "EVIDENCE_FROM_FUTURE",
      severity: "RED",
      evidence: name,
      generated_at: inspection.generated_at,
      current_time: window.current_time,
      message: `${name} was generated after the supplied current time`,
    });
  } else if (window.cutoff_ms !== null && generatedMs < window.cutoff_ms) {
    addBlocker(blockers, {
      code: "EVIDENCE_STALE",
      severity: "RED",
      evidence: name,
      generated_at: inspection.generated_at,
      freshness_cutoff: window.freshness_cutoff,
      message: `${name} is stale for the target window`,
    });
  } else {
    inspection.fresh = true;
  }

  const verdictCode = {
    RED: ["EVIDENCE_RED", "RED"],
    AMBER: ["EVIDENCE_AMBER", "AMBER"],
    UNKNOWN: ["EVIDENCE_VERDICT_MISSING", "RED"],
  }[inspection.verdict];
  if (verdictCode) {
    addBlocker(blockers, {
      code: verdictCode[0],
      severity: verdictCode[1],
      evidence: name,
      message:
        inspection.verdict === "UNKNOWN"
          ? `${name} has no explicit passing verdict`
          : `${name} evidence verdict is ${inspection.verdict}`,
    });
  }

  inspectCriticalInputs(name, document, blockers);
  inspection.blocked_actions = inspectBlockedActions(name, document, blockers);
  return { document, inspection };
}

function exactNextAction({
  verdict,
  blockers,
  expectedGenerationId,
  window,
  runwayShortfall,
  reserveShortfall,
}) {
  const has = (...codes) => blockers.some((blocker) => codes.includes(blocker.code));
  const documents = (...codes) =>
    unique(
      blockers
        .filter((blocker) => codes.includes(blocker.code))
        .map((blocker) => blocker.evidence),
    ).sort();
  const base = {
    generation_id: expectedGenerationId || null,
    window_id: window.id || null,
  };
  if (has("EVIDENCE_DOCUMENT_MISSING", "EVIDENCE_DOCUMENT_INVALID", "EVIDENCE_PATH_ONLY")) {
    const evidence = documents(
      "EVIDENCE_DOCUMENT_MISSING",
      "EVIDENCE_DOCUMENT_INVALID",
      "EVIDENCE_PATH_ONLY",
    );
    return {
      ...base,
      code: "MATERIALISE_EVIDENCE_DOCUMENTS",
      evidence_documents: evidence,
      instruction: `Materialise ${evidence.join(", ")} evidence documents, then rebuild generation ${expectedGenerationId || "unknown"}.`,
    };
  }
  if (has("CURRENT_TIME_INVALID", "TARGET_COUNT_INVALID", "TARGET_WINDOW_ID_MISSING", "TARGET_WINDOW_INVALID")) {
    return {
      ...base,
      code: "PROVIDE_VALID_RECONCILIATION_PARAMETERS",
      instruction: "Provide a valid current time, target window and bounded runway targets before reconciling.",
    };
  }
  if (has("TARGET_WINDOW_CLOSED")) {
    return {
      ...base,
      code: "SELECT_OPEN_TARGET_WINDOW",
      instruction: "Select the next open publish window and generate a new canonical evidence generation.",
    };
  }
  if (has("EXPECTED_GENERATION_ID_MISSING", "EVIDENCE_GENERATION_ID_MISSING", "EVIDENCE_GENERATION_MISMATCH", "MIXED_EVIDENCE_GENERATIONS")) {
    return {
      ...base,
      code: "REGENERATE_CANONICAL_EVIDENCE_GENERATION",
      evidence_documents: [...EVIDENCE_NAMES],
      instruction: `Regenerate all publish runway evidence with generation id ${expectedGenerationId || "a new explicit generation id"}.`,
    };
  }
  if (has("EVIDENCE_FROM_FUTURE", "EVIDENCE_GENERATED_AT_INVALID", "EVIDENCE_STALE", "EVIDENCE_WINDOW_ID_MISSING", "EVIDENCE_WINDOW_MISMATCH")) {
    const evidence = documents(
      "EVIDENCE_FROM_FUTURE",
      "EVIDENCE_GENERATED_AT_INVALID",
      "EVIDENCE_STALE",
      "EVIDENCE_WINDOW_ID_MISSING",
      "EVIDENCE_WINDOW_MISMATCH",
    );
    return {
      ...base,
      code: "REFRESH_EVIDENCE_FOR_TARGET_WINDOW",
      evidence_documents: evidence,
      instruction: `Refresh ${evidence.join(", ")} for window ${window.id || "unknown"} under generation ${expectedGenerationId || "unknown"}.`,
    };
  }

  const criticalCodes = new Set([
    "BLOCKED_ACTION_DETAILS_MISSING",
    "BLOCKED_ACTION_INVALID",
    "BLOCKED_ACTION_PLATFORM_ENABLEMENT_UNKNOWN",
    "CRITICAL_INPUT_BLOCKED",
    "CRITICAL_INPUT_COUNT_NONZERO",
    "CRITICAL_INPUT_INVALID",
    "CRITICAL_INPUT_VERDICT_MISSING",
    "ENABLED_PLATFORM_ACTION_BLOCKED",
    "EVIDENCE_BLOCKER_PRESENT",
    "EVIDENCE_RED",
    "EXECUTABLE_ACTION_BLOCKED",
  ]);
  if (blockers.some((blocker) => criticalCodes.has(blocker.code))) {
    return {
      ...base,
      code: "REPAIR_CRITICAL_INPUTS_AND_REGENERATE",
      evidence_documents: unique(
        blockers
          .filter((blocker) => blocker.severity === "RED")
          .map((blocker) => blocker.evidence),
      ).sort(),
      instruction: `Repair all RED or blocked critical inputs, then regenerate canonical generation ${expectedGenerationId || "unknown"}.`,
    };
  }
  if (has("CRITICAL_INPUT_AMBER", "EVIDENCE_AMBER", "EXECUTABLE_ACTION_AMBER")) {
    return {
      ...base,
      code: "RESOLVE_AMBER_EVIDENCE",
      evidence_documents: documents(
        "CRITICAL_INPUT_AMBER",
        "EVIDENCE_AMBER",
        "EXECUTABLE_ACTION_AMBER",
      ),
      instruction: `Resolve AMBER evidence and regenerate generation ${expectedGenerationId || "unknown"} before auto-publish.`,
    };
  }
  if (runwayShortfall > 0) {
    return {
      ...base,
      code: "SYNCHRONOUSLY_REPAIR_OR_PROMOTE_RUNWAY",
      required_story_count: runwayShortfall,
      instruction: `Synchronously repair or promote ${runwayShortfall} additional enabled YouTube-first executable ${runwayShortfall === 1 ? "story" : "stories"}, then regenerate generation ${expectedGenerationId || "unknown"}.`,
    };
  }
  if (reserveShortfall > 0) {
    return {
      ...base,
      code: "SYNCHRONOUSLY_PROMOTE_RESERVE",
      required_story_count: reserveShortfall,
      instruction: `Synchronously promote ${reserveShortfall} additional unique reserve ${reserveShortfall === 1 ? "story" : "stories"}, then regenerate generation ${expectedGenerationId || "unknown"}.`,
    };
  }
  if (verdict === "GREEN") {
    return {
      ...base,
      code: "CONSUME_CANONICAL_GENERATION_IN_GUARDED_WINDOW",
      instruction: `Allow the guarded scheduler to consume generation ${expectedGenerationId} for window ${window.id}.`,
    };
  }
  return {
    ...base,
    code: "REPAIR_RECONCILIATION_BLOCKERS",
    instruction: `Repair all reconciliation blockers and regenerate generation ${expectedGenerationId || "unknown"}.`,
  };
}

function reconcilePublishRunway(options = {}) {
  const blockerStore = { keys: new Set(), rows: [] };
  const window = normaliseWindow(options, blockerStore);
  const expectedGenerationId = clean(
    options.expectedGenerationId ??
      options.expected_generation_id ??
      options.generationId ??
      options.generation_id,
  );
  if (!expectedGenerationId) {
    addBlocker(blockerStore, {
      code: "EXPECTED_GENERATION_ID_MISSING",
      severity: "RED",
      message: "expected generation id is required",
    });
  }
  const runwayTarget = targetCount(
    options.targetRunwayCount ??
      options.target_runway_count ??
      options.runwayTarget ??
      options.runway_target,
    MINIMUM_RUNWAY_STORIES,
    "target_runway_count",
    blockerStore,
  );
  const reserveTarget = targetCount(
    options.targetReserveCount ??
      options.target_reserve_count ??
      options.reserveTarget ??
      options.reserve_target,
    MINIMUM_RESERVE_STORIES,
    "target_reserve_count",
    blockerStore,
  );

  const supplied = suppliedDocuments(options);
  const documents = {};
  const inspections = {};
  for (const name of EVIDENCE_NAMES) {
    const checked = inspectDocument(
      name,
      supplied[name],
      expectedGenerationId,
      window,
      blockerStore,
    );
    documents[name] = checked.document;
    inspections[name] = checked.inspection;
  }

  const observedGenerationIds = unique(
    Object.values(inspections).map((inspection) => inspection.generation_id),
  );
  if (observedGenerationIds.length > 1) {
    addBlocker(blockerStore, {
      code: "MIXED_EVIDENCE_GENERATIONS",
      severity: "RED",
      generation_ids: [...observedGenerationIds].sort(),
      message: "evidence documents contain mixed generation ids",
    });
  }

  const stages = {};
  for (const stage of ["preflight", "dry_run", "guarded", "executor"]) {
    stages[stage] = documents[stage]
      ? inspectActions(stage, documents[stage], blockerStore)
      : {
          collection_path: null,
          actions: new Map(),
          input_action_count: 0,
          ignored_disabled_actions: [],
          ignored_non_youtube_action_count: 0,
        };
    inspections[stage].action_collection_path = stages[stage].collection_path;
    inspections[stage].enabled_youtube_first_action_count = stages[stage].actions.size;
  }

  const candidateCollection = documents.candidate
    ? firstList(documents.candidate, CANDIDATE_PATHS)
    : { present: false, path: null, rows: [] };
  if (documents.candidate && !candidateCollection.present) {
    addBlocker(blockerStore, {
      code: "CANDIDATE_STORY_EVIDENCE_MISSING",
      severity: "RED",
      evidence: "candidate",
      message: "candidate evidence has no concrete story collection",
    });
  }
  const candidates = documents.candidate
    ? eligibleStories(
        candidateCollection.rows,
        documents.candidate,
        blockerStore,
        "candidate",
        candidateCollection.path || "candidates",
      )
    : new Map();
  inspections.candidate.candidate_collection_path = candidateCollection.path;
  inspections.candidate.eligible_candidate_story_count = candidates.size;

  let canonicalIds = [...stages.preflight.actions.keys()];
  for (const stage of ["dry_run", "guarded", "executor"]) {
    canonicalIds = canonicalIds.filter((id) => stages[stage].actions.has(id));
  }
  canonicalIds = canonicalIds.filter((id) => candidates.has(id));
  const canonicalSet = new Set(canonicalIds);
  const canonicalOrder = [...stages.executor.actions.keys()]
    .filter((id) => canonicalSet.has(id));
  const immediateIds = canonicalOrder.slice(0, runwayTarget);
  const immediateSet = new Set(immediateIds);
  const executableActions = immediateIds.map((id) => {
    const row = stages.executor.actions.get(id);
    return {
      action_id: clean(row.action_id) || `${id}:youtube_shorts`,
      story_id: id,
      platform: "youtube_shorts",
      platform_enabled: true,
      youtube_first: true,
      executable: true,
      generation_id: expectedGenerationId || null,
      window_id: window.id,
      source_evidence: [...EVIDENCE_NAMES],
    };
  });

  const reserveMaps = {};
  const reservePresence = {};
  for (const name of EVIDENCE_NAMES) {
    const collection = documents[name]
      ? firstList(documents[name], RESERVE_PATHS)
      : { present: false, path: null, rows: [] };
    reservePresence[name] = collection.present;
    reserveMaps[name] = documents[name]
      ? eligibleStories(
          collection.rows,
          documents[name],
          blockerStore,
          name,
          collection.path || "reserve_stories",
        )
      : new Map();
  }

  if (documents.candidate && !reservePresence.candidate) {
    const labelled = candidateCollection.rows.filter(
      (row) =>
        object(row) &&
        (clean(row.role).toLowerCase() === "reserve" || row.reserve === true),
    );
    reserveMaps.candidate = eligibleStories(
      labelled,
      documents.candidate,
      blockerStore,
      "candidate",
      "candidates.reserve_rows",
    );
  }
  if (documents.preflight && !reservePresence.preflight) {
    const preflightCandidates = firstList(documents.preflight, CANDIDATE_PATHS);
    const labelled = preflightCandidates.rows.filter(
      (row) =>
        object(row) &&
        (clean(row.role).toLowerCase() === "reserve" || row.reserve === true),
    );
    reserveMaps.preflight = eligibleStories(
      labelled,
      documents.preflight,
      blockerStore,
      "preflight",
      `${preflightCandidates.path || "candidates"}.reserve_rows`,
    );
    reservePresence.preflight = preflightCandidates.present && labelled.length > 0;
  }

  const reserveIds = [];
  const reserveSet = new Set();
  const addReserve = (id) => {
    if (!id || immediateSet.has(id) || reserveSet.has(id)) return;
    reserveSet.add(id);
    reserveIds.push(id);
  };
  for (const id of canonicalOrder.slice(runwayTarget)) addReserve(id);

  for (const id of reserveMaps.candidate.keys()) {
    if (!reserveMaps.preflight.has(id) || !candidates.has(id)) continue;
    const laterExplicitMaps = ["dry_run", "guarded", "executor"]
      .filter((name) => reservePresence[name])
      .map((name) => reserveMaps[name]);
    if (laterExplicitMaps.every((map) => map.has(id))) addReserve(id);
  }
  if (canonicalOrder.length <= runwayTarget && !reservePresence.preflight) {
    addBlocker(blockerStore, {
      code: "RESERVE_PREFLIGHT_EVIDENCE_MISSING",
      severity: "AMBER",
      evidence: "preflight",
      message: "preflight evidence has no concrete reserve story collection",
    });
  }

  const reserveStories = reserveIds.map((id) => ({
    story_id: id,
    platform: "youtube_shorts",
    platform_enabled: true,
    youtube_first: true,
    reserve: true,
    generation_id: expectedGenerationId || null,
    window_id: window.id,
    source_evidence: canonicalSet.has(id)
      ? [...EVIDENCE_NAMES]
      : ["candidate", "preflight"],
  }));
  const runwayShortfall = Math.max(0, runwayTarget - executableActions.length);
  const reserveShortfall = Math.max(0, reserveTarget - reserveStories.length);
  if (executableActions.length === 0) {
    addBlocker(blockerStore, {
      code: "CANONICAL_EXECUTABLE_RUNWAY_EMPTY",
      severity: "RED",
      actual_count: 0,
      target_count: runwayTarget,
      message: "no enabled YouTube-first action survives every evidence stage",
    });
  } else if (runwayShortfall > 0) {
    addBlocker(blockerStore, {
      code: "RUNWAY_TARGET_NOT_MET",
      severity: "AMBER",
      actual_count: executableActions.length,
      target_count: runwayTarget,
      shortfall: runwayShortfall,
      message: "canonical executable runway is below target",
    });
  }
  if (reserveShortfall > 0) {
    addBlocker(blockerStore, {
      code: "RESERVE_TARGET_NOT_MET",
      severity: "AMBER",
      actual_count: reserveStories.length,
      target_count: reserveTarget,
      shortfall: reserveShortfall,
      message: "canonical reserve is below target",
    });
  }

  const blockers = blockerStore.rows;
  const verdict = blockers.some((blocker) => blocker.severity === "RED")
    ? "RED"
    : blockers.some((blocker) => blocker.severity === "AMBER")
      ? "AMBER"
      : "GREEN";
  const canAutoPublish =
    verdict === "GREEN" &&
    executableActions.length >= runwayTarget &&
    reserveStories.length >= reserveTarget;
  const next = exactNextAction({
    verdict,
    blockers,
    expectedGenerationId,
    window,
    runwayShortfall,
    reserveShortfall,
  });
  const ignoredDisabled = Object.values(stages)
    .flatMap((stage) => stage.ignored_disabled_actions);
  const windowMetadata = {
    id: window.id,
    current_time: window.current_time,
    starts_at: window.starts_at,
    ends_at: window.ends_at,
    state: window.state,
    freshness_cutoff: window.freshness_cutoff,
    max_evidence_age_ms: window.max_evidence_age_ms,
  };

  return {
    schema_version: 1,
    mode: "CANONICAL_PUBLISH_RUNWAY_RECONCILIATION",
    generated_at: window.current_time,
    expected_generation_id: expectedGenerationId || null,
    verdict,
    overall_verdict: verdict,
    can_auto_publish: canAutoPublish,
    safe_to_auto_publish: canAutoPublish,
    synchronous_repair_or_promotion_needed: !canAutoPublish,
    window: windowMetadata,
    window_metadata: windowMetadata,
    targets: {
      runway_story_count: runwayTarget,
      reserve_story_count: reserveTarget,
      minimum_runway_story_count: MINIMUM_RUNWAY_STORIES,
      minimum_reserve_story_count: MINIMUM_RESERVE_STORIES,
    },
    summary: {
      evidence_document_count: EVIDENCE_NAMES.length,
      matching_generation_document_count: Object.values(inspections)
        .filter((item) => item.generation_id === expectedGenerationId).length,
      fresh_document_count: Object.values(inspections)
        .filter((item) => item.fresh).length,
      canonical_executable_story_count: canonicalOrder.length,
      executable_youtube_first_story_count: executableActions.length,
      reserve_story_count: reserveStories.length,
      runway_target_met: runwayShortfall === 0,
      reserve_target_met: reserveShortfall === 0,
      runway_shortfall: runwayShortfall,
      reserve_shortfall: reserveShortfall,
      ignored_disabled_platform_action_count: ignoredDisabled.length,
      ignored_non_youtube_action_count: Object.values(stages)
        .reduce((sum, stage) => sum + stage.ignored_non_youtube_action_count, 0),
      red_blocker_count: blockers.filter((item) => item.severity === "RED").length,
      amber_blocker_count: blockers.filter((item) => item.severity === "AMBER").length,
    },
    evidence: inspections,
    generation: {
      expected_id: expectedGenerationId || null,
      observed_ids: [...observedGenerationIds].sort(),
      all_documents_match:
        Boolean(expectedGenerationId) &&
        Object.values(inspections)
          .every((item) => item.generation_id === expectedGenerationId),
    },
    runway: {
      target_story_count: runwayTarget,
      canonical_executable_story_count: canonicalOrder.length,
      immediate_story_count: executableActions.length,
      shortfall: runwayShortfall,
      target_met: runwayShortfall === 0,
      story_ids: executableActions.map((action) => action.story_id),
    },
    reserve: {
      target_story_count: reserveTarget,
      story_count: reserveStories.length,
      shortfall: reserveShortfall,
      target_met: reserveShortfall === 0,
      story_ids: reserveStories.map((story) => story.story_id),
    },
    executable_actions: executableActions,
    reserve_stories: reserveStories,
    ignored_disabled_platform_actions: ignoredDisabled,
    blockers,
    critical_blockers: blockers.filter((item) => item.severity === "RED"),
    blocker_codes: unique(blockers.map((item) => item.code)),
    exact_next_action: next,
    exact_next_action_instruction: next.instruction,
    next_action_code: next.code,
    next_action: next.instruction,
    safety: {
      pure_service: true,
      read_only: true,
      input_documents_loaded_from_paths: false,
      live_publish_attempted: false,
      db_mutation: false,
      oauth_or_token_mutation: false,
      disabled_platforms_counted: false,
    },
  };
}

function publishRunwayNeedsSynchronousRepair(report = {}) {
  return !(
    object(report) &&
    normaliseVerdict(report.verdict) === "GREEN" &&
    report.can_auto_publish === true &&
    report.summary?.runway_target_met === true &&
    report.summary?.reserve_target_met === true &&
    Array.isArray(report.blockers) &&
    report.blockers.length === 0
  );
}

module.exports = {
  MAX_EVIDENCE_ROWS,
  MAX_TARGET_STORIES,
  MINIMUM_RESERVE_STORIES,
  MINIMUM_RUNWAY_STORIES,
  buildPublishRunwayReconciliation: reconcilePublishRunway,
  buildPublishRunwayReconciliationReport: reconcilePublishRunway,
  buildDurableCanonicalPublishRunway: reconcilePublishRunway,
  needsSynchronousRepairOrPromotion: publishRunwayNeedsSynchronousRepair,
  needsSynchronousRunwayRepairOrPromotion: publishRunwayNeedsSynchronousRepair,
  normalisePlatform,
  publishRunwayNeedsSynchronousRepair,
  publishRunwayNeedsSynchronousRepairOrPromotion: publishRunwayNeedsSynchronousRepair,
  reconcileCanonicalPublishRunway: reconcilePublishRunway,
  reconcilePublishRunwayEvidence: reconcilePublishRunway,
  reconcilePublishRunway,
  shouldSynchronouslyRepairOrPromote: publishRunwayNeedsSynchronousRepair,
};
