"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");
const {
  createPublishRunwayLockController,
} = require("./publish-runway-lock-controller");
const {
  MINIMUM_RESERVE_STORIES,
  MINIMUM_RUNWAY_STORIES,
  reconcilePublishRunway,
} = require("./publish-runway-reconciler");

const SCHEMA = "pulse_publish_runway_scheduler_coordinator_v1";
const ACTION_BINDING_SCHEMA = "pulse_publish_runway_action_binding_v1";
const DEFAULT_MAX_EVIDENCE_AGE_MS = 2 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DURATION_MS = 60 * 60 * 1000;
const EVIDENCE_NAMES = Object.freeze([
  "candidate",
  "preflight",
  "dry_run",
  "guarded",
  "executor",
]);
const EVIDENCE_FILENAMES = Object.freeze({
  candidate: "candidate-evidence.json",
  preflight: "preflight-evidence.json",
  dry_run: "dry-run-evidence.json",
  guarded: "guarded-evidence.json",
  executor: "executor-evidence.json",
});
const ACTION_PATHS = Object.freeze({
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
});
const CRITICAL_PATH_FIELDS = new Set([
  "audio_manifest_path",
  "audio_path",
  "canonical_manifest_path",
  "caption_manifest_path",
  "caption_path",
  "captions_path",
  "claim_inventory_path",
  "cover_frame_source",
  "cover_path",
  "exported_path",
  "final_audio_path",
  "final_mp4_path",
  "final_render_path",
  "final_video_path",
  "first_frame_source",
  "forensic_qa_path",
  "input_manifest_path",
  "manual_caption_path",
  "motion_manifest_path",
  "narration_audio_path",
  "platform_captions_path",
  "platform_publish_manifest_path",
  "platform_variant_video_path",
  "render_manifest_path",
  "render_path",
  "rights_ledger_path",
  "sfx_manifest_path",
  "source_manifest_path",
  "thumbnail_path",
  "timestamps_path",
  "variant_captions_path",
  "variant_video_path",
  "video_path",
  "visual_qa_path",
  "voice_quality_report_path",
  "word_timestamps_path",
]);
const REQUIRED_EXECUTOR_PATH_FIELDS = Object.freeze([
  "video_path",
  "captions_path",
  "canonical_manifest_path",
  "platform_publish_manifest_path",
]);
const VERDICT_FIELDS = Object.freeze([
  "verdict",
  "overall_verdict",
  "status",
]);
const VERDICT_ENVELOPES = Object.freeze([
  "summary",
  "preflight",
  "safe_publish_plan",
  "guarded_dispatch_plan",
  "executor_plan",
]);

class PublishRunwaySchedulerCoordinatorError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "PublishRunwaySchedulerCoordinatorError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(code, message, details = {}) {
  throw new PublishRunwaySchedulerCoordinatorError(code, message, details);
}

function clean(value) {
  return String(value ?? "").trim();
}

function object(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function array(value) {
  return Array.isArray(value) ? value : [];
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
  return platform;
}

function normaliseVerdict(value) {
  const verdict = clean(value).toLowerCase();
  if (
    [
      "green",
      "ok",
      "pass",
      "passed",
      "ready",
      "success",
      "approved",
      "eligible",
    ].includes(verdict)
  ) {
    return "GREEN";
  }
  if (
    ["amber", "partial", "review", "warn", "warning", "held"].includes(
      verdict,
    )
  ) {
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

function verdictRank(verdict) {
  return {
    UNKNOWN: 0,
    GREEN: 1,
    AMBER: 2,
    RED: 3,
  }[normaliseVerdict(verdict)] ?? 0;
}

function worstExplicitVerdict(document) {
  const values = [];
  const inspect = (value) => {
    if (!object(value)) return;
    for (const field of VERDICT_FIELDS) {
      if (Object.hasOwn(value, field)) {
        const verdict = normaliseVerdict(value[field]);
        if (verdict !== "UNKNOWN") values.push(verdict);
      }
    }
  };
  inspect(document);
  for (const key of VERDICT_ENVELOPES) inspect(document?.[key]);
  return values.sort((left, right) => verdictRank(right) - verdictRank(left))[0] ||
    "UNKNOWN";
}

function validIso(value, code, field, details = {}) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    fail(code, `${field} must be a valid timestamp`, {
      field,
      ...details,
    });
  }
  return date.toISOString();
}

function boundedPositiveNumber(value, fallback, field) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    fail("INVALID_COORDINATOR_OPTION", `${field} must be a positive number`, {
      field,
      value,
    });
  }
  return number;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function get(value, dottedPath) {
  let current = value;
  for (const key of dottedPath.split(".")) {
    if (!object(current) || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

function set(value, dottedPath, next) {
  const keys = dottedPath.split(".");
  let current = value;
  for (const key of keys.slice(0, -1)) {
    if (!object(current[key])) current[key] = {};
    current = current[key];
  }
  current[keys.at(-1)] = next;
}

function firstActionCollection(document, stage) {
  for (const actionPath of ACTION_PATHS[stage] || []) {
    const rows = get(document, actionPath);
    if (Array.isArray(rows)) return { path: actionPath, rows };
  }
  return { path: null, rows: [] };
}

function actionId(row) {
  const storyId = clean(row?.story_id || row?.storyId || row?.id);
  const platform = normalisePlatform(row?.platform);
  return clean(row?.action_id) ||
    (storyId && platform ? `${storyId}:${platform}` : "");
}

function normaliseActionIds(document, stage) {
  const result = clone(document);
  const collection = firstActionCollection(result, stage);
  if (!collection.path) return result;
  const rows = collection.rows.map((row) => {
    if (!object(row)) return row;
    const id = actionId(row);
    return id ? { ...row, action_id: id } : row;
  });
  set(result, collection.path, rows);
  return result;
}

function pathInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function assertRegularFileInsideRoot({
  filePath,
  allowedRoot,
  allowedRootReal,
  missingCode,
  outsideCode,
  invalidCode,
  label,
}) {
  const requested = clean(filePath);
  if (!requested || /^https?:\/\//i.test(requested)) {
    fail(invalidCode, `${label} must reference a local regular file`, {
      file_path: requested || null,
    });
  }
  const resolved = path.isAbsolute(requested)
    ? path.resolve(requested)
    : path.resolve(allowedRoot, requested);
  if (!pathInside(path.resolve(allowedRoot), resolved)) {
    fail(outsideCode, `${label} is outside the allowed root`, {
      file_path: resolved,
      allowed_root: path.resolve(allowedRoot),
    });
  }

  let stat;
  try {
    stat = await fs.lstat(resolved);
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail(missingCode, `${label} is missing`, { file_path: resolved });
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(invalidCode, `${label} must be a non-symlink regular file`, {
      file_path: resolved,
    });
  }
  const real = await fs.realpath(resolved);
  if (!pathInside(allowedRootReal, real)) {
    fail(outsideCode, `${label} resolves outside the allowed root`, {
      file_path: resolved,
      resolved_file_path: real,
      allowed_root: allowedRootReal,
    });
  }
  return {
    requested,
    resolved,
    real,
    size_bytes: stat.size,
  };
}

function evidencePathMap(input = {}) {
  const nested =
    input.evidencePaths ||
    input.evidence_paths ||
    input.documents ||
    input.evidence ||
    {};
  return {
    candidate:
      nested.candidate ||
      input.candidateEvidencePath ||
      input.candidate_evidence_path,
    preflight:
      nested.preflight ||
      input.preflightEvidencePath ||
      input.preflight_evidence_path,
    dry_run:
      nested.dry_run ||
      nested.dryRun ||
      input.dryRunEvidencePath ||
      input.dry_run_evidence_path,
    guarded:
      nested.guarded ||
      input.guardedEvidencePath ||
      input.guarded_evidence_path,
    executor:
      nested.executor ||
      input.executorEvidencePath ||
      input.executor_evidence_path,
  };
}

async function loadEvidenceDocuments(input, roots) {
  const paths = evidencePathMap(input);
  const documents = {};
  const sourcePaths = {};
  for (const name of EVIDENCE_NAMES) {
    const suppliedPath = clean(paths[name]);
    if (!suppliedPath) {
      fail(
        "EVIDENCE_PATH_MISSING",
        `a concrete ${name} evidence JSON path is required`,
        { evidence: name },
      );
    }
    const checked = await assertRegularFileInsideRoot({
      filePath: suppliedPath,
      allowedRoot: roots.allowedRoot,
      allowedRootReal: roots.allowedRootReal,
      missingCode: "EVIDENCE_FILE_MISSING",
      outsideCode: "EVIDENCE_FILE_OUTSIDE_ALLOWED_ROOT",
      invalidCode: "EVIDENCE_FILE_INVALID",
      label: `${name} evidence`,
    });
    let document;
    try {
      document = await fs.readJson(checked.real);
    } catch {
      fail("EVIDENCE_JSON_INVALID", `${name} evidence is not valid JSON`, {
        evidence: name,
        file_path: checked.resolved,
      });
    }
    if (!object(document) || Object.keys(document).length === 0) {
      fail(
        "EVIDENCE_DOCUMENT_INVALID",
        `${name} evidence must be a non-empty JSON object`,
        { evidence: name, file_path: checked.resolved },
      );
    }
    documents[name] = document;
    sourcePaths[name] = checked.resolved;
  }
  return { documents, sourcePaths };
}

function documentGenerationId(document) {
  return clean(
    document?.generation_id ||
      document?.publish_runway_generation_id ||
      document?.runway_generation_id ||
      document?.evidence_generation_id ||
      document?.generationId ||
      document?.generation?.id ||
      document?.metadata?.generation_id,
  );
}

function documentWindowId(document) {
  return clean(
    document?.window_id ||
      document?.publish_window_id ||
      document?.target_window_id ||
      document?.window?.id ||
      document?.window?.window_id ||
      document?.target_window?.id ||
      document?.metadata?.window_id,
  );
}

function documentGeneratedAt(document) {
  return clean(
    document?.generated_at ||
      document?.created_at ||
      document?.metadata?.generated_at,
  );
}

function validateSourceEvidence({
  documents,
  targetWindowId,
  evaluatedAt,
  maxEvidenceAgeMs,
}) {
  const sourceGenerationIds = unique(
    EVIDENCE_NAMES.map((name) => documentGenerationId(documents[name])),
  );
  if (sourceGenerationIds.length > 1) {
    fail(
      "SOURCE_EVIDENCE_GENERATION_MIXED",
      "source evidence contains mixed generation ids",
      { source_generation_ids: sourceGenerationIds.sort() },
    );
  }

  const sourceWindowIds = unique(
    EVIDENCE_NAMES.map((name) => documentWindowId(documents[name])),
  );
  if (
    sourceWindowIds.length > 1 ||
    sourceWindowIds.some((windowId) => windowId !== targetWindowId)
  ) {
    fail(
      "SOURCE_EVIDENCE_WINDOW_MISMATCH",
      "source evidence does not belong to one target publish window",
      {
        expected_window_id: targetWindowId,
        source_window_ids: sourceWindowIds.sort(),
      },
    );
  }

  const nowMs = Date.parse(evaluatedAt);
  const cutoffMs = nowMs - maxEvidenceAgeMs;
  for (const name of EVIDENCE_NAMES) {
    const generatedAt = documentGeneratedAt(documents[name]);
    const generatedMs = Date.parse(generatedAt);
    if (!generatedAt || !Number.isFinite(generatedMs)) {
      fail(
        "SOURCE_EVIDENCE_GENERATED_AT_INVALID",
        `${name} source evidence has no valid generated_at`,
        { evidence: name, generated_at: generatedAt || null },
      );
    }
    if (generatedMs > nowMs) {
      fail(
        "SOURCE_EVIDENCE_FROM_FUTURE",
        `${name} source evidence is from the future`,
        { evidence: name, generated_at: generatedAt, evaluated_at: evaluatedAt },
      );
    }
    if (generatedMs < cutoffMs) {
      fail(
        "SOURCE_EVIDENCE_STALE",
        `${name} source evidence is stale`,
        {
          evidence: name,
          generated_at: generatedAt,
          freshness_cutoff: new Date(cutoffMs).toISOString(),
        },
      );
    }
  }
  return {
    source_generation_id: sourceGenerationIds[0] || null,
    source_window_id: sourceWindowIds[0] || null,
  };
}

function normaliseDocument({
  name,
  document,
  generationId,
  windowId,
  generatedAt,
  sourceIdentity,
}) {
  let result = clone(document);
  if (name !== "candidate") result = normaliseActionIds(result, name);
  const worst = worstExplicitVerdict(result);
  result = {
    ...result,
    generation_id: generationId,
    window_id: windowId,
    generated_at: generatedAt,
    source_evidence_identity: {
      evidence: name,
      source_generation_id: documentGenerationId(document) || null,
      source_window_id: documentWindowId(document) || null,
      source_generated_at: documentGeneratedAt(document) || null,
      source_verdict: worst,
      canonical_source_generation_id:
        sourceIdentity.source_generation_id || null,
    },
  };
  if (worst === "RED" || worst === "AMBER") result.verdict = worst;
  return result;
}

function criticalPathField(key) {
  const field = clean(key).toLowerCase();
  return (
    CRITICAL_PATH_FIELDS.has(field) ||
    /^(?:final|platform|platform_variant|variant)_(?:audio|video|captions|timestamps|manifest)_path$/.test(
      field,
    )
  );
}

function collectCriticalReferences(value, references = [], trail = []) {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      collectCriticalReferences(child, references, [...trail, index]),
    );
    return references;
  }
  if (!object(value)) return references;
  for (const [key, child] of Object.entries(value)) {
    const nextTrail = [...trail, key];
    if (criticalPathField(key) && typeof child === "string" && clean(child)) {
      references.push({
        field: key,
        object: value,
        trail: nextTrail,
        source_path: child,
      });
      continue;
    }
    collectCriticalReferences(child, references, nextTrail);
  }
  return references;
}

function safeAssetBasename(filePath) {
  const safe = path
    .basename(filePath)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/[. ]+$/g, "");
  return safe || "asset.bin";
}

async function captureCriticalAssets({
  documents,
  roots,
  generationId,
  generationPath,
}) {
  const references = [];
  for (const name of EVIDENCE_NAMES) {
    for (const reference of collectCriticalReferences(documents[name])) {
      references.push({ ...reference, evidence: name });
    }
  }
  const sourceByRealPath = new Map();
  for (const reference of references) {
    const checked = await assertRegularFileInsideRoot({
      filePath: reference.source_path,
      allowedRoot: roots.allowedRoot,
      allowedRootReal: roots.allowedRootReal,
      missingCode: "CRITICAL_FILE_MISSING",
      outsideCode: "CRITICAL_FILE_OUTSIDE_ALLOWED_ROOT",
      invalidCode: "CRITICAL_FILE_INVALID",
      label: `${reference.evidence}.${reference.trail.join(".")}`,
    });
    let captured = sourceByRealPath.get(checked.real);
    if (!captured) {
      const key = crypto
        .createHash("sha256")
        .update(checked.real.toLowerCase())
        .digest("hex")
        .slice(0, 24);
      const relativePath = path.posix.join(
        "assets",
        key,
        safeAssetBasename(checked.real),
      );
      captured = {
        source_path: checked.real,
        relative_path: relativePath,
        generation_path: path.join(
          generationPath,
          ...relativePath.split("/"),
        ),
        size_bytes: checked.size_bytes,
      };
      sourceByRealPath.set(checked.real, captured);
    }
    reference.object[reference.field] = captured.generation_path;
  }
  return {
    generation_id: generationId,
    references,
    assets: [...sourceByRealPath.values()].sort((left, right) =>
      left.relative_path.localeCompare(right.relative_path),
    ),
  };
}

function strictReconciliation(report) {
  return (
    object(report) &&
    report.verdict === "GREEN" &&
    report.can_auto_publish === true &&
    report.summary?.runway_target_met === true &&
    report.summary?.reserve_target_met === true &&
    report.summary?.executable_youtube_first_story_count >=
      MINIMUM_RUNWAY_STORIES &&
    report.summary?.reserve_story_count >= MINIMUM_RESERVE_STORIES &&
    Array.isArray(report.blockers) &&
    report.blockers.length === 0
  );
}

function assertStrictReconciliation(report) {
  if (!strictReconciliation(report)) {
    fail(
      "RUNWAY_RECONCILIATION_NOT_STRICT_GREEN",
      "immutable generation requires strict GREEN reconciliation with 5 immediate and 5 reserve stories",
      { reconciliation: report },
    );
  }
}

function youtubeRows(document, stage) {
  return firstActionCollection(document, stage).rows.filter(
    (row) =>
      object(row) &&
      normalisePlatform(row.platform) === "youtube_shorts" &&
      row.platform_enabled !== false &&
      row.enabled !== false,
  );
}

function exactActionBinding({
  documents,
  reconciliation,
  generationId,
  windowId,
  generatedAt,
}) {
  const selectedActionIds = reconciliation.executable_actions.map((row) =>
    clean(row.action_id),
  );
  if (
    selectedActionIds.length !== MINIMUM_RUNWAY_STORIES ||
    unique(selectedActionIds).length !== selectedActionIds.length
  ) {
    fail(
      "RUNWAY_ACTION_BINDING_INVALID",
      "reconciliation must bind exactly five unique immediate action ids",
      { selected_action_ids: selectedActionIds },
    );
  }
  const selectedByStory = new Map(
    reconciliation.executable_actions.map((row) => [
      clean(row.story_id),
      clean(row.action_id),
    ]),
  );
  for (const stage of ["preflight", "dry_run", "guarded", "executor"]) {
    const rows = youtubeRows(documents[stage], stage);
    for (const [storyId, expectedActionId] of selectedByStory.entries()) {
      const matchingRows = rows.filter(
        (row) => clean(row.story_id || row.storyId || row.id) === storyId,
      );
      const actualIds = unique(matchingRows.map(actionId));
      if (
        matchingRows.length !== 1 ||
        actualIds.length !== 1 ||
        actualIds[0] !== expectedActionId
      ) {
        fail(
          "RUNWAY_ACTION_ID_MISMATCH",
          `${stage} evidence does not match the canonical action id`,
          {
            evidence: stage,
            story_id: storyId,
            expected_action_id: expectedActionId,
            actual_action_ids: actualIds,
            matching_row_count: matchingRows.length,
          },
        );
      }
    }
  }

  const executorRows = youtubeRows(documents.executor, "executor");
  for (const row of executorRows.filter((candidate) =>
    selectedByStory.has(
      clean(candidate.story_id || candidate.storyId || candidate.id),
    ),
  )) {
    for (const field of REQUIRED_EXECUTOR_PATH_FIELDS) {
      if (!clean(row[field])) {
        fail(
          "EXECUTOR_CRITICAL_PATH_MISSING",
          `executor action ${actionId(row)} is missing ${field}`,
          { action_id: actionId(row), field },
        );
      }
    }
  }

  const reserveStoryIds = reconciliation.reserve_stories.map((row) =>
    clean(row.story_id),
  );
  if (
    reserveStoryIds.length !== MINIMUM_RESERVE_STORIES ||
    unique(reserveStoryIds).length !== reserveStoryIds.length ||
    reserveStoryIds.some((id) => selectedByStory.has(id))
  ) {
    fail(
      "RUNWAY_RESERVE_BINDING_INVALID",
      "reconciliation must bind five unique reserve stories disjoint from the immediate runway",
      { reserve_story_ids: reserveStoryIds },
    );
  }
  return {
    schema: ACTION_BINDING_SCHEMA,
    schema_version: 1,
    generation_id: generationId,
    window_id: windowId,
    generated_at: generatedAt,
    selected_action_ids: selectedActionIds,
    immediate_story_ids: [...selectedByStory.keys()],
    reserve_story_ids: reserveStoryIds,
    executor_evidence_file: `evidence/${EVIDENCE_FILENAMES.executor}`,
  };
}

function assertExactIds(actual, expected, code, label) {
  const actualIds = unique(actual);
  const expectedIds = unique(expected);
  if (
    actualIds.length !== array(actual).length ||
    expectedIds.length !== array(expected).length ||
    actualIds.length !== expectedIds.length ||
    actualIds.some((id, index) => id !== expectedIds[index])
  ) {
    fail(code, `${label} do not match the immutable action binding`, {
      expected_action_ids: expectedIds,
      actual_action_ids: actualIds,
    });
  }
}

function throwControllerRed(result) {
  if (result?.verdict !== "RED") return result;
  const code =
    clean(result.error?.code) ||
    clean(array(result.reason_codes)[0]) ||
    "RUNWAY_CONTROLLER_RED";
  fail(code, result.error?.message || "runway controller returned RED", {
    controller_result: result,
  });
}

async function readGenerationJson(generation, relativePath) {
  const filePath = path.join(
    generation.generation_path,
    ...relativePath.split("/"),
  );
  try {
    return await fs.readJson(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail("GENERATION_EVIDENCE_MISSING", "generation evidence file is missing", {
        file_path: relativePath,
      });
    }
    fail("GENERATION_EVIDENCE_INVALID", "generation evidence is invalid JSON", {
      file_path: relativePath,
    });
  }
}

async function readGenerationBundle(generation) {
  const documents = {};
  for (const name of EVIDENCE_NAMES) {
    documents[name] = await readGenerationJson(
      generation,
      `evidence/${EVIDENCE_FILENAMES[name]}`,
    );
  }
  const reconciliation = await readGenerationJson(
    generation,
    "reconciliation-report.json",
  );
  const binding = await readGenerationJson(generation, "action-binding.json");
  return { documents, reconciliation, binding };
}

function assertBundleIdentity({
  bundle,
  generation,
  expectedGenerationId,
  expectedWindowId,
  expectedActionIds,
  phase,
}) {
  const generationCode =
    phase === "T0" ? "T0_GENERATION_ID_MISMATCH" : "T90_GENERATION_ID_MISMATCH";
  const windowCode =
    phase === "T0" ? "T0_WINDOW_ID_MISMATCH" : "T90_WINDOW_ID_MISMATCH";
  const actionCode =
    phase === "T0" ? "T0_ACTION_ID_MISMATCH" : "T90_ACTION_ID_MISMATCH";
  if (generation.generation_id !== expectedGenerationId) {
    fail(generationCode, `${phase} resolved a different generation`, {
      expected_generation_id: expectedGenerationId,
      actual_generation_id: generation.generation_id,
    });
  }
  if (generation.window_id !== expectedWindowId) {
    fail(windowCode, `${phase} resolved a different publish window`, {
      expected_window_id: expectedWindowId,
      actual_window_id: generation.window_id,
    });
  }
  if (
    bundle.binding.generation_id !== expectedGenerationId ||
    bundle.binding.window_id !== expectedWindowId ||
    bundle.reconciliation.expected_generation_id !== expectedGenerationId ||
    bundle.reconciliation.window?.id !== expectedWindowId
  ) {
    fail(
      generationCode,
      `${phase} generation evidence identity is inconsistent`,
      {
        binding_generation_id: bundle.binding.generation_id,
        binding_window_id: bundle.binding.window_id,
        reconciliation_generation_id:
          bundle.reconciliation.expected_generation_id,
        reconciliation_window_id: bundle.reconciliation.window?.id,
      },
    );
  }
  for (const name of EVIDENCE_NAMES) {
    if (
      bundle.documents[name].generation_id !== expectedGenerationId ||
      bundle.documents[name].window_id !== expectedWindowId
    ) {
      fail(
        generationCode,
        `${phase} ${name} evidence identity is inconsistent`,
        { evidence: name },
      );
    }
  }
  assertExactIds(
    expectedActionIds,
    bundle.binding.selected_action_ids,
    actionCode,
    `${phase} selected action ids`,
  );
  assertStrictReconciliation(bundle.reconciliation);
}

async function assertGenerationCriticalFiles(generation, documents) {
  const generationRoot = path.resolve(generation.generation_path);
  for (const name of EVIDENCE_NAMES) {
    for (const reference of collectCriticalReferences(documents[name])) {
      const filePath = path.resolve(clean(reference.source_path));
      if (!pathInside(generationRoot, filePath)) {
        fail(
          "GENERATION_CRITICAL_FILE_OUTSIDE_GENERATION",
          "normalised critical file path escapes the immutable generation",
          {
            evidence: name,
            field: reference.field,
            file_path: filePath,
          },
        );
      }
      let stat;
      try {
        stat = await fs.lstat(filePath);
      } catch (error) {
        if (error?.code === "ENOENT") {
          fail(
            "GENERATION_CRITICAL_FILE_MISSING",
            "normalised critical file is missing from the immutable generation",
            { evidence: name, field: reference.field, file_path: filePath },
          );
        }
        throw error;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) {
        fail(
          "GENERATION_CRITICAL_FILE_INVALID",
          "normalised critical file is not a regular immutable file",
          { evidence: name, field: reference.field, file_path: filePath },
        );
      }
    }
  }
}

class PublishRunwaySchedulerCoordinator {
  constructor(options = {}) {
    const allowedRoot = clean(options.allowedRoot || options.allowed_root);
    if (!allowedRoot) {
      fail(
        "INVALID_ALLOWED_ROOT",
        "an explicit allowed root is required for evidence and critical files",
      );
    }
    this.allowedRoot = path.resolve(allowedRoot);
    this.maxEvidenceAgeMs = boundedPositiveNumber(
      options.maxEvidenceAgeMs ?? options.max_evidence_age_ms,
      DEFAULT_MAX_EVIDENCE_AGE_MS,
      "maxEvidenceAgeMs",
    );
    this.windowDurationMs = boundedPositiveNumber(
      options.windowDurationMs ?? options.window_duration_ms,
      DEFAULT_WINDOW_DURATION_MS,
      "windowDurationMs",
    );
    this.controller =
      options.controller ||
      createPublishRunwayLockController({
        rootDir:
          options.rootDir ||
          options.root_dir ||
          options.storeRoot ||
          options.store_root,
        publishHoursUtc:
          options.publishHoursUtc || options.publish_hours_utc,
        phaseToleranceMs:
          options.phaseToleranceMs ?? options.phase_tolerance_ms,
        now: options.now,
      });
  }

  async roots() {
    let stat;
    try {
      stat = await fs.lstat(this.allowedRoot);
    } catch (error) {
      if (error?.code === "ENOENT") {
        fail("INVALID_ALLOWED_ROOT", "allowed root does not exist", {
          allowed_root: this.allowedRoot,
        });
      }
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fail(
        "INVALID_ALLOWED_ROOT",
        "allowed root must be a non-symlink directory",
        { allowed_root: this.allowedRoot },
      );
    }
    return {
      allowedRoot: this.allowedRoot,
      allowedRootReal: await fs.realpath(this.allowedRoot),
    };
  }

  targetWindow(resolvedWindow, generatedAt) {
    const startsAtMs = Date.parse(resolvedWindow.scheduled_at);
    return {
      id: resolvedWindow.window_id,
      starts_at: resolvedWindow.scheduled_at,
      ends_at: new Date(startsAtMs + this.windowDurationMs).toISOString(),
      evidence_fresh_after: new Date(
        Date.parse(generatedAt) - this.maxEvidenceAgeMs,
      ).toISOString(),
    };
  }

  reconciliationInput({
    documents,
    generationId,
    generatedAt,
    targetWindow,
  }) {
    return {
      now: generatedAt,
      targetWindow,
      expectedGenerationId: generationId,
      candidateEvidence: documents.candidate,
      preflightEvidence: documents.preflight,
      dryRunEvidence: documents.dry_run,
      guardedEvidence: documents.guarded,
      executorEvidence: documents.executor,
      targetRunwayCount: MINIMUM_RUNWAY_STORIES,
      targetReserveCount: MINIMUM_RESERVE_STORIES,
      maxEvidenceAgeMs: this.maxEvidenceAgeMs,
    };
  }

  async generateAtT180({
    at,
    generationId,
    generation_id,
    generatedAt,
    generated_at,
    ...input
  } = {}) {
    const expectedGenerationId = clean(generationId || generation_id);
    if (!expectedGenerationId) {
      fail("GENERATION_ID_MISSING", "T-180 generation id is required");
    }
    const evaluatedAt = validIso(
      at,
      "INVALID_T180_TIMESTAMP",
      "at",
    );
    const explicitGeneratedAt = validIso(
      generatedAt || generated_at || evaluatedAt,
      "INVALID_GENERATED_AT",
      "generated_at",
    );
    if (explicitGeneratedAt !== evaluatedAt) {
      fail(
        "GENERATED_AT_PHASE_MISMATCH",
        "T-180 generated_at must equal the phase timestamp",
        { at: evaluatedAt, generated_at: explicitGeneratedAt },
      );
    }

    const roots = await this.roots();
    const window = this.controller.window(new Date(evaluatedAt), "T-180");
    const targetWindow = this.targetWindow(window, explicitGeneratedAt);
    const loaded = await loadEvidenceDocuments(input, roots);
    const sourceIdentity = validateSourceEvidence({
      documents: loaded.documents,
      targetWindowId: window.window_id,
      evaluatedAt: explicitGeneratedAt,
      maxEvidenceAgeMs: this.maxEvidenceAgeMs,
    });
    const documents = Object.fromEntries(
      EVIDENCE_NAMES.map((name) => [
        name,
        normaliseDocument({
          name,
          document: loaded.documents[name],
          generationId: expectedGenerationId,
          windowId: window.window_id,
          generatedAt: explicitGeneratedAt,
          sourceIdentity,
        }),
      ]),
    );

    let reconciliation = reconcilePublishRunway(
      this.reconciliationInput({
        documents,
        generationId: expectedGenerationId,
        generatedAt: explicitGeneratedAt,
        targetWindow,
      }),
    );
    assertStrictReconciliation(reconciliation);
    let binding = exactActionBinding({
      documents,
      reconciliation,
      generationId: expectedGenerationId,
      windowId: window.window_id,
      generatedAt: explicitGeneratedAt,
    });

    const generationPath = this.controller.store.generationPath(
      expectedGenerationId,
    );
    const captured = await captureCriticalAssets({
      documents,
      roots,
      generationId: expectedGenerationId,
      generationPath,
    });

    reconciliation = reconcilePublishRunway(
      this.reconciliationInput({
        documents,
        generationId: expectedGenerationId,
        generatedAt: explicitGeneratedAt,
        targetWindow,
      }),
    );
    assertStrictReconciliation(reconciliation);
    binding = exactActionBinding({
      documents,
      reconciliation,
      generationId: expectedGenerationId,
      windowId: window.window_id,
      generatedAt: explicitGeneratedAt,
    });

    const files = [];
    for (const name of EVIDENCE_NAMES) {
      files.push({
        path: `evidence/${EVIDENCE_FILENAMES[name]}`,
        json: documents[name],
      });
      files.push({
        path: `raw-evidence/${name}.json`,
        json: loaded.documents[name],
      });
    }
    files.push(
      { path: "reconciliation-report.json", json: reconciliation },
      { path: "action-binding.json", json: binding },
      {
        path: "asset-capture-report.json",
        json: {
          schema: "pulse_publish_runway_asset_capture_v1",
          schema_version: 1,
          generation_id: expectedGenerationId,
          window_id: window.window_id,
          generated_at: explicitGeneratedAt,
          asset_count: captured.assets.length,
          reference_count: captured.references.length,
          assets: captured.assets.map((asset) => ({
            relative_path: asset.relative_path,
            size_bytes: asset.size_bytes,
          })),
        },
      },
    );
    files.push(
      ...captured.assets.map((asset) => ({
        path: asset.relative_path,
        sourcePath: asset.source_path,
      })),
    );

    const controllerResult = await this.controller.generateAtT180({
      at: new Date(evaluatedAt),
      generationId: expectedGenerationId,
      files,
    });
    throwControllerRed(controllerResult);
    return {
      schema: SCHEMA,
      schema_version: 1,
      verdict: "GREEN",
      phase: "T-180",
      window: controllerResult.window,
      generation: controllerResult.generation,
      reconciliation,
      selected_action_ids: binding.selected_action_ids,
      reserve_story_ids: binding.reserve_story_ids,
      captured_asset_count: captured.assets.length,
      external_publish_attempted: false,
      mutated_database: false,
      mutated_oauth: false,
    };
  }

  async lockAtT90({
    at,
    generationId,
    generation_id,
    windowId,
    window_id,
    selectedActionIds,
    selected_action_ids,
  } = {}) {
    const expectedGenerationId = clean(generationId || generation_id);
    const expectedWindowId = clean(windowId || window_id);
    const expectedActionIds = array(
      selectedActionIds || selected_action_ids,
    );
    if (!expectedGenerationId || !expectedWindowId || !expectedActionIds.length) {
      fail(
        "T90_BINDING_REQUIRED",
        "T-90 requires explicit generation, window and selected action ids",
      );
    }
    const window = this.controller.window(at, "T-90");
    if (window.window_id !== expectedWindowId) {
      fail("T90_WINDOW_ID_MISMATCH", "T-90 phase resolves another window", {
        expected_window_id: expectedWindowId,
        actual_window_id: window.window_id,
      });
    }
    const generation = await this.controller.store.verifyGeneration({
      generationId: expectedGenerationId,
      expectedWindowId,
    });
    const bundle = await readGenerationBundle(generation);
    assertBundleIdentity({
      bundle,
      generation,
      expectedGenerationId,
      expectedWindowId,
      expectedActionIds,
      phase: "T-90",
    });
    await assertGenerationCriticalFiles(generation, bundle.documents);

    const controllerResult = await this.controller.lockAtT90({
      at,
      generationId: expectedGenerationId,
    });
    throwControllerRed(controllerResult);
    return {
      schema: SCHEMA,
      schema_version: 1,
      verdict: "GREEN",
      phase: "T-90",
      window: controllerResult.window,
      generation: controllerResult.generation,
      lock: controllerResult.lock,
      reconciliation: bundle.reconciliation,
      selected_action_ids: bundle.binding.selected_action_ids,
      external_publish_attempted: false,
      mutated_database: false,
      mutated_oauth: false,
    };
  }

  async resolveAtT0({
    at,
    generationId,
    generation_id,
    windowId,
    window_id,
    selectedActionIds,
    selected_action_ids,
  } = {}) {
    const expectedGenerationId = clean(generationId || generation_id);
    const expectedWindowId = clean(windowId || window_id);
    const expectedActionIds = array(
      selectedActionIds || selected_action_ids,
    );
    if (!expectedGenerationId || !expectedWindowId || !expectedActionIds.length) {
      fail(
        "T0_BINDING_REQUIRED",
        "T0 requires explicit generation, window and selected action ids",
      );
    }

    const controllerResult = await this.controller.resolveAtT0({ at });
    throwControllerRed(controllerResult);
    const bundle = await readGenerationBundle(controllerResult.generation);
    assertBundleIdentity({
      bundle,
      generation: controllerResult.generation,
      expectedGenerationId,
      expectedWindowId,
      expectedActionIds,
      phase: "T0",
    });
    await assertGenerationCriticalFiles(
      controllerResult.generation,
      bundle.documents,
    );

    const executorIds = youtubeRows(
      bundle.documents.executor,
      "executor",
    )
      .filter((row) =>
        bundle.binding.immediate_story_ids.includes(
          clean(row.story_id || row.storyId || row.id),
        ),
      )
      .map(actionId);
    assertExactIds(
      executorIds,
      bundle.binding.selected_action_ids,
      "T0_ACTION_ID_MISMATCH",
      "T0 executor action ids",
    );

    return {
      schema: SCHEMA,
      schema_version: 1,
      verdict: "GREEN",
      phase: "T0",
      can_publish: true,
      window: controllerResult.window,
      generation: controllerResult.generation,
      lock: controllerResult.lock,
      reconciliation: bundle.reconciliation,
      selected_action_ids: bundle.binding.selected_action_ids,
      executor_plan: bundle.documents.executor,
      executor_plan_source: path.join(
        controllerResult.generation.generation_path,
        "evidence",
        EVIDENCE_FILENAMES.executor,
      ),
      mutable_global_fallback_used: false,
      external_publish_attempted: false,
      mutated_database: false,
      mutated_oauth: false,
    };
  }

  readExecutorPlanAtT0(options) {
    return this.resolveAtT0(options);
  }
}

function createPublishRunwaySchedulerCoordinator(options) {
  return new PublishRunwaySchedulerCoordinator(options);
}

async function generatePublishRunwayAtT180(options = {}) {
  return createPublishRunwaySchedulerCoordinator(options).generateAtT180(
    options,
  );
}

async function lockPublishRunwayAtT90(options = {}) {
  return createPublishRunwaySchedulerCoordinator(options).lockAtT90(options);
}

async function resolvePublishRunwayAtT0(options = {}) {
  return createPublishRunwaySchedulerCoordinator(options).resolveAtT0(options);
}

async function readPublishRunwayExecutorPlanAtT0(options = {}) {
  return createPublishRunwaySchedulerCoordinator(
    options,
  ).readExecutorPlanAtT0(options);
}

module.exports = {
  ACTION_BINDING_SCHEMA,
  CRITICAL_PATH_FIELDS,
  DEFAULT_MAX_EVIDENCE_AGE_MS,
  DEFAULT_WINDOW_DURATION_MS,
  EVIDENCE_FILENAMES,
  EVIDENCE_NAMES,
  PublishRunwaySchedulerCoordinator,
  PublishRunwaySchedulerCoordinatorError,
  SCHEMA,
  createPublishRunwaySchedulerCoordinator,
  generateAtT180: generatePublishRunwayAtT180,
  generatePublishRunwayAtT180,
  lockAtT90: lockPublishRunwayAtT90,
  lockPublishRunwayAtT90,
  readExecutorPlanAtT0: readPublishRunwayExecutorPlanAtT0,
  readPublishRunwayExecutorPlanAtT0,
  resolveAtT0: resolvePublishRunwayAtT0,
  resolvePublishRunwayAtT0,
};
