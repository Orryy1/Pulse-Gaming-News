"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");
const {
  createPublishRunwayGenerationStore,
} = require("./publish-runway-generation-store");
const {
  createPublishRunwaySchedulerCoordinator,
  normaliseReserveTarget,
} = require("./publish-runway-scheduler-coordinator");
const {
  resolvePublishWindow,
} = require("./publish-runway-lock-controller");

const PHASE_OFFSET_MINUTES = Object.freeze({
  "T-180": 180,
  "T-90": 90,
  T0: 0,
});
const SOURCE_FILENAMES = Object.freeze({
  candidate: "candidate.json",
  preflight: "preflight.json",
  dry_run: "dry-run.json",
  guarded: "guarded.json",
  executor: "executor.json",
});
const ENABLED_PLATFORMS = Object.freeze([
  "youtube_shorts",
  "instagram_reels",
  "facebook_reels",
]);
const DISABLED_PLATFORMS = Object.freeze([
  "tiktok",
  "x",
  "threads",
  "pinterest",
]);
const STRICT_IMMEDIATE_COUNT = 5;
const STRICT_RESERVE_COUNT = 5;
const STRICT_BUFFER_COUNT = STRICT_IMMEDIATE_COUNT + STRICT_RESERVE_COUNT;

class PublishRunwayJobRuntimeError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "PublishRunwayJobRuntimeError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(code, message, details = {}) {
  throw new PublishRunwayJobRuntimeError(code, message, details);
}

function clean(value) {
  return String(value ?? "").trim();
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function unique(values) {
  return [...new Set(array(values).map(clean).filter(Boolean))];
}

function truthy(value) {
  return /^(?:1|true|yes|on)$/i.test(clean(value));
}

function normalisePhase(value) {
  const phase = clean(value).toUpperCase();
  if (!Object.hasOwn(PHASE_OFFSET_MINUTES, phase)) {
    fail("RUNWAY_PHASE_INVALID", "job payload phase must be T-180, T-90 or T0", {
      phase,
    });
  }
  return phase;
}

function publishHour(value) {
  const hour = Number(value);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    fail(
      "RUNWAY_PUBLISH_HOUR_INVALID",
      "job payload publish_hour_utc must be an integer from 0 through 23",
      { publish_hour_utc: value },
    );
  }
  return hour;
}

function parseUtcDate(value, fallback) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return new Date(value.getTime());
  }
  let text = clean(value);
  if (text && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(text)) {
    text = `${text.replace(" ", "T")}Z`;
  }
  const parsed = text ? new Date(text) : new Date(fallback);
  if (!Number.isFinite(parsed.getTime())) {
    fail("RUNWAY_JOB_TIMESTAMP_INVALID", "job timestamp is invalid", {
      timestamp: value,
    });
  }
  return parsed;
}

function phaseTimestampForJob(job = {}, { now = new Date() } = {}) {
  const payload = object(job.payload) ? job.payload : {};
  const explicit =
    payload.phase_scheduled_at_utc ||
    payload.scheduled_at_utc ||
    payload.phase_at;
  if (clean(explicit)) return parseUtcDate(explicit, now).toISOString();

  const phase = normalisePhase(payload.phase);
  const hour = publishHour(payload.publish_hour_utc);
  const anchor = parseUtcDate(
    job.created_at || job.run_at || job.updated_at,
    now,
  );
  const candidates = [-1, 0, 1].map((dayDelta) => {
    const publishAt = new Date(
      Date.UTC(
        anchor.getUTCFullYear(),
        anchor.getUTCMonth(),
        anchor.getUTCDate() + dayDelta,
        hour,
      ),
    );
    return new Date(
      publishAt.getTime() - PHASE_OFFSET_MINUTES[phase] * 60_000,
    );
  });
  candidates.sort((left, right) => {
    const distance =
      Math.abs(left.getTime() - anchor.getTime()) -
      Math.abs(right.getTime() - anchor.getTime());
    return distance || left.getTime() - right.getTime();
  });
  return candidates[0].toISOString();
}

function normaliseVerdict(value) {
  const verdict = clean(value).toUpperCase();
  if (["GREEN", "PASS", "PASSED", "READY", "SUCCESS", "OK"].includes(verdict)) {
    return "GREEN";
  }
  if (["AMBER", "WARN", "WARNING", "REVIEW", "HELD", "PARTIAL"].includes(verdict)) {
    return "AMBER";
  }
  if (["RED", "FAIL", "FAILED", "BLOCKED", "REJECTED", "ERROR"].includes(verdict)) {
    return "RED";
  }
  return "UNKNOWN";
}

function storyId(row = {}) {
  return clean(row.story_id || row.storyId || row.id);
}

function actionId(row = {}) {
  const id = storyId(row);
  const platform = clean(row.platform).toLowerCase();
  return clean(row.action_id) || (id && platform ? `${id}:${platform}` : "");
}

function candidatePassesStrictPreflight(row = {}) {
  const preflight = object(row.preflight_qa) ? row.preflight_qa : {};
  const status = normaliseVerdict(
    preflight.verdict || preflight.status || preflight.result,
  );
  const blockers = unique([
    ...array(preflight.blockers),
    ...array(preflight.critical_blockers),
    ...array(row.blockers),
  ]);
  return (
    status === "GREEN" &&
    blockers.length === 0 &&
    row.scheduler_quarantine !== true &&
    row.quarantined !== true
  );
}

function strictCandidateRow(row = {}, role = "immediate") {
  const id = storyId(row);
  return {
    ...clone(row),
    id,
    story_id: id,
    role,
    verdict: "GREEN",
    blockers: [],
    youtube_first: true,
    enabled_platforms: [...ENABLED_PLATFORMS],
    disabled_platforms: [...DISABLED_PLATFORMS],
  };
}

function generatedAt(document = {}) {
  const value = clean(
    document.generated_at ||
      document.generatedAt ||
      document.created_at ||
      document.metadata?.generated_at,
  );
  if (!value || !Number.isFinite(Date.parse(value))) {
    fail(
      "RUNWAY_SOURCE_GENERATED_AT_INVALID",
      "source evidence has no valid generated_at",
    );
  }
  return new Date(value).toISOString();
}

function sourceEnvelope({
  document,
  generationId,
  windowId,
  verdict,
  blockers = [],
}) {
  return {
    ...clone(document),
    generation_id: `source-${generationId}`,
    window_id: windowId,
    generated_at: generatedAt(document),
    verdict,
    blockers: unique(blockers),
    enabled_platforms: [...ENABLED_PLATFORMS],
    disabled_platforms: [...DISABLED_PLATFORMS],
  };
}

function actionVerdict(row = {}) {
  const blockers = unique([
    ...array(row.blockers),
    ...array(row.critical_blockers),
  ]);
  const verdict = normaliseVerdict(
    row.verdict || row.status || row.result,
  );
  if (
    blockers.length ||
    verdict === "RED" ||
    verdict === "AMBER" ||
    row.blocked === true ||
    row.executable === false ||
    row.ready === false
  ) {
    return verdict === "AMBER" ? "AMBER" : "RED";
  }
  return "GREEN";
}

function normaliseAction(row = {}, stage) {
  const platform = clean(row.platform).toLowerCase();
  const verdict = actionVerdict(row);
  const enabled = ENABLED_PLATFORMS.includes(platform);
  return {
    ...clone(row),
    action_id: actionId(row),
    story_id: storyId(row),
    platform,
    platform_enabled: enabled,
    enabled,
    youtube_first: platform === "youtube_shorts",
    verdict,
    blockers: unique(row.blockers),
    executable:
      verdict === "GREEN" &&
      enabled &&
      (
        stage !== "dry_run" ||
        (
          clean(row.action).toLowerCase() === "would_publish" &&
          row.autonomous_green_lit_by_dry_run !== false
        )
      ),
  };
}

function explicitDocumentVerdict(document = {}, stage) {
  const direct = normaliseVerdict(
    document.verdict ||
      document.overall_verdict ||
      document.status,
  );
  if (direct !== "UNKNOWN") return direct;
  if (stage === "guarded") {
    return document.ready_for_guarded_dispatch === true ? "GREEN" : "RED";
  }
  if (stage === "executor") {
    return document.ready_for_live_executor_handoff === true ? "GREEN" : "RED";
  }
  if (stage === "dry_run") {
    return document.ready_for_unattended_publish === true ? "GREEN" : "RED";
  }
  return "UNKNOWN";
}

function buildRunwaySourceDocuments({
  generationId,
  windowId,
  candidateReport,
  dryRunPlan,
  guardedPlan,
  executorPlan,
  targetReserveCount,
  target_reserve_count,
} = {}) {
  if (!clean(generationId) || !clean(windowId)) {
    fail(
      "RUNWAY_SOURCE_IDENTITY_MISSING",
      "generationId and windowId are required",
    );
  }
  for (const [name, document] of Object.entries({
    candidateReport,
    dryRunPlan,
    guardedPlan,
    executorPlan,
  })) {
    if (!object(document)) {
      fail(
        "RUNWAY_SOURCE_DOCUMENT_MISSING",
        `${name} must be a concrete evidence document`,
        { evidence: name },
      );
    }
  }

  const reserveTarget = normaliseReserveTarget(
    targetReserveCount ?? target_reserve_count,
  );
  const strictBufferCount =
    STRICT_IMMEDIATE_COUNT + reserveTarget.effective_story_count;
  const publishRunwayTargets = {
    immediate_story_count: STRICT_IMMEDIATE_COUNT,
    requested_reserve_story_count: reserveTarget.requested_story_count,
    effective_reserve_story_count: reserveTarget.effective_story_count,
    minimum_reserve_story_count: reserveTarget.minimum_story_count,
    maximum_reserve_story_count: reserveTarget.maximum_story_count,
    total_story_count: strictBufferCount,
  };
  const strictCandidates = array(candidateReport.candidates)
    .filter(candidatePassesStrictPreflight)
    .slice(0, strictBufferCount);
  const immediate = strictCandidates
    .slice(0, STRICT_IMMEDIATE_COUNT)
    .map((row) => strictCandidateRow(row, "immediate"));
  const reserve = strictCandidates
    .slice(STRICT_IMMEDIATE_COUNT, strictBufferCount)
    .map((row) => strictCandidateRow(row, "reserve"));
  const candidateBlockers = [];
  if (strictCandidates.length < strictBufferCount) {
    candidateBlockers.push(
      `strict_green_candidate_buffer_below_${strictBufferCount}:${strictCandidates.length}/${strictBufferCount}`,
    );
  }
  const candidateVerdict = candidateBlockers.length ? "RED" : "GREEN";
  const immediateIds = new Set(immediate.map((row) => row.story_id));

  const dryRunActions = array(dryRunPlan.actions).map((row) =>
    normaliseAction(row, "dry_run"),
  );
  const preflightActions = dryRunActions
    .filter(
      (row) =>
        row.platform === "youtube_shorts" &&
        row.executable === true &&
        immediateIds.has(row.story_id),
    )
    .slice(0, STRICT_IMMEDIATE_COUNT)
    .map((row) => ({
      ...row,
      action: "preflight_pass",
      ready: true,
      executable: true,
    }));
  const dryRunVerdict = explicitDocumentVerdict(dryRunPlan, "dry_run");
  const preflightBlockers = [...candidateBlockers];
  if (dryRunVerdict !== "GREEN") {
    preflightBlockers.push(
      `strict_dry_run_not_green:${dryRunVerdict.toLowerCase()}`,
    );
  }
  if (preflightActions.length !== STRICT_IMMEDIATE_COUNT) {
    preflightBlockers.push(
      `youtube_preflight_action_count:${preflightActions.length}/${STRICT_IMMEDIATE_COUNT}`,
    );
  }
  const preflightVerdict = preflightBlockers.length ? "RED" : "GREEN";

  const candidate = sourceEnvelope({
    document: candidateReport,
    generationId,
    windowId,
    verdict: candidateVerdict,
    blockers: candidateBlockers,
  });
  candidate.candidates = [...immediate, ...reserve];
  candidate.reserve_stories = reserve;

  const preflight = sourceEnvelope({
    document: {
      generated_at: generatedAt(candidateReport),
      source_candidate_generated_at: generatedAt(candidateReport),
      source_dry_run_generated_at: generatedAt(dryRunPlan),
      executable_actions: preflightActions,
      reserve_stories: reserve,
    },
    generationId,
    windowId,
    verdict: preflightVerdict,
    blockers: preflightBlockers,
  });

  const dryRun = sourceEnvelope({
    document: dryRunPlan,
    generationId,
    windowId,
    verdict: dryRunVerdict,
    blockers: array(dryRunPlan.blockers),
  });
  dryRun.actions = dryRunActions;

  const guardedVerdict = explicitDocumentVerdict(guardedPlan, "guarded");
  const guarded = sourceEnvelope({
    document: guardedPlan,
    generationId,
    windowId,
    verdict: guardedVerdict,
    blockers: array(guardedPlan.blockers),
  });
  guarded.dispatch_ready_actions = array(
    guardedPlan.dispatch_ready_actions,
  ).map((row) => normaliseAction(row, "guarded"));

  const executorVerdict = explicitDocumentVerdict(executorPlan, "executor");
  const executor = sourceEnvelope({
    document: executorPlan,
    generationId,
    windowId,
    verdict: executorVerdict,
    blockers: array(executorPlan.blockers),
  });
  executor.handoff_ready_actions = array(
    executorPlan.handoff_ready_actions,
  ).map((row) => normaliseAction(row, "executor"));

  const documents = {
    candidate,
    preflight,
    dry_run: dryRun,
    guarded,
    executor,
  };
  for (const document of Object.values(documents)) {
    document.publish_runway_targets = clone(publishRunwayTargets);
  }
  return documents;
}

async function writeRunwaySourceEvidence({ outputDir, documents } = {}) {
  const root = path.resolve(clean(outputDir));
  if (!clean(outputDir) || !object(documents)) {
    fail(
      "RUNWAY_SOURCE_OUTPUT_INVALID",
      "outputDir and documents are required",
    );
  }
  await fs.ensureDir(root);
  const paths = {};
  for (const [name, filename] of Object.entries(SOURCE_FILENAMES)) {
    if (!object(documents[name])) {
      fail(
        "RUNWAY_SOURCE_DOCUMENT_MISSING",
        `${name} source document is missing`,
      );
    }
    const filePath = path.join(root, filename);
    await fs.writeJson(filePath, documents[name], { spaces: 2 });
    paths[name] = filePath;
  }
  return paths;
}

function runtimeConfig({
  job = {},
  env = process.env,
  repoRoot = path.resolve(__dirname, "..", ".."),
  now = new Date(),
} = {}) {
  const payload = object(job.payload) ? job.payload : {};
  const phaseAt = phaseTimestampForJob(job, { now });
  const phase = normalisePhase(payload.phase);
  const hour = publishHour(payload.publish_hour_utc);
  const window = resolvePublishWindow({
    at: phaseAt,
    phase,
    publishHoursUtc: [hour],
  });
  const generationStem = window.scheduled_at
    .replace(/[-:]/g, "")
    .replace(".000Z", "Z");
  const suffix = crypto
    .createHash("sha256")
    .update(`${window.window_id}|${clean(payload.window_label)}`)
    .digest("hex")
    .slice(0, 10);
  const generationId = clean(payload.runway_generation_id) ||
    `runway-${generationStem}-${suffix}`;
  const root = path.resolve(repoRoot);
  const evidenceRoot = path.resolve(
    clean(
      payload.runway_evidence_root ||
        env.PULSE_PUBLISH_RUNWAY_EVIDENCE_ROOT,
    ) || root,
  );
  const storeRoot = path.resolve(
    clean(payload.runway_store_root || env.PULSE_PUBLISH_RUNWAY_ROOT) ||
      path.join(evidenceRoot, "output", "runtime", "publish-runway"),
  );
  const sourceRoot = path.resolve(
    clean(payload.runway_source_root || env.PULSE_PUBLISH_RUNWAY_SOURCE_ROOT) ||
      path.join(evidenceRoot, "output", "runtime", "publish-runway-source"),
    generationId,
  );
  const reserveTarget = normaliseReserveTarget(
    payload.target_reserve_count ?? payload.targetReserveCount,
  );
  return {
    phase,
    phase_at: phaseAt,
    publish_hour_utc: hour,
    window,
    generation_id: generationId,
    repo_root: root,
    evidence_root: evidenceRoot,
    store_root: storeRoot,
    source_root: sourceRoot,
    goal_contract_root: path.join(evidenceRoot, "output", "goal-contract"),
    reserve_target: reserveTarget,
  };
}

async function runCanonicalEvidenceRefresh({
  at,
  repoRoot,
  outputDir,
} = {}) {
  const nextCandidates = require("../../tools/next-publish-candidates");
  const dryRun = require("../../tools/goal-dry-run-publish");
  const guarded = require("../../tools/goal-guarded-dispatch-preflight");
  const executor = require("../../tools/goal-guarded-dispatch-executor-preflight");

  await nextCandidates.runCli([
    process.execPath,
    "tools/next-publish-candidates.js",
    "--preflight-qa",
    "--limit",
    "30",
    "--out-dir",
    outputDir,
    "--generated-at",
    at,
  ]);
  await dryRun.main([
    "--root",
    repoRoot,
    "--candidate-report",
    path.join(outputDir, "next_publish_candidates.json"),
    "--out-dir",
    outputDir,
    "--generated-at",
    at,
  ]);
  await guarded.main([
    "--root",
    repoRoot,
    "--strict-dry-run-plan",
    path.join(outputDir, "dry_run_publish_plan.json"),
    "--out-dir",
    outputDir,
    "--generated-at",
    at,
  ]);
  await executor.main([
    "--root",
    repoRoot,
    "--guarded-dispatch-plan",
    path.join(outputDir, "guarded_dispatch_plan.json"),
    "--select-all-dispatch-ready",
    "--allow-non-green-plan-overwrite",
    "--out-dir",
    outputDir,
    "--generated-at",
    at,
  ]);
}

async function readCanonicalEvidence(goalContractRoot) {
  const paths = {
    candidateReport: path.join(
      goalContractRoot,
      "next_publish_candidates.json",
    ),
    dryRunPlan: path.join(goalContractRoot, "dry_run_publish_plan.json"),
    guardedPlan: path.join(goalContractRoot, "guarded_dispatch_plan.json"),
    executorPlan: path.join(
      goalContractRoot,
      "guarded_dispatch_executor_plan.json",
    ),
  };
  const values = {};
  for (const [name, filePath] of Object.entries(paths)) {
    try {
      values[name] = await fs.readJson(filePath);
    } catch (error) {
      fail(
        "RUNWAY_CANONICAL_EVIDENCE_MISSING",
        `${name} could not be read`,
        { evidence: name, file_path: filePath, cause: error.message },
      );
    }
  }
  return values;
}

function coordinatorFor(config) {
  return createPublishRunwaySchedulerCoordinator({
    allowedRoot: config.evidence_root,
    rootDir: config.store_root,
    publishHoursUtc: [config.publish_hour_utc],
  });
}

async function writePhaseReport(config, phase, report) {
  const reportRoot = path.join(
    config.evidence_root,
    "output",
    "runtime",
    "publish-runway-status",
  );
  await fs.ensureDir(reportRoot);
  const safePhase = phase.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const reportPath = path.join(
    reportRoot,
    `${config.window.window_id.replace(/[^A-Za-z0-9._-]+/g, "_")}-${safePhase}.json`,
  );
  await fs.writeJson(reportPath, report, { spaces: 2 });
  await fs.writeJson(path.join(reportRoot, `latest-${safePhase}.json`), report, {
    spaces: 2,
  });
  return reportPath;
}

async function generateRunwayForJob({
  job,
  env = process.env,
  repoRoot,
  now,
  refreshEvidence = runCanonicalEvidenceRefresh,
} = {}) {
  const config = runtimeConfig({ job, env, repoRoot, now });
  if (config.phase !== "T-180") {
    fail("RUNWAY_PHASE_MISMATCH", "generation handler requires T-180");
  }
  await refreshEvidence({
    at: config.phase_at,
    repoRoot: config.repo_root,
    outputDir: config.goal_contract_root,
  });
  const canonical = await readCanonicalEvidence(config.goal_contract_root);
  const documents = buildRunwaySourceDocuments({
    ...canonical,
    generationId: config.generation_id,
    windowId: config.window.window_id,
    targetReserveCount: config.reserve_target.requested_story_count,
  });
  const evidencePaths = await writeRunwaySourceEvidence({
    outputDir: config.source_root,
    documents,
  });
  const result = await coordinatorFor(config).generateAtT180({
    at: config.phase_at,
    generationId: config.generation_id,
    evidencePaths,
    targetReserveCount: config.reserve_target.requested_story_count,
  });
  const report = {
    ...result,
    runtime: config,
    source_evidence_paths: evidencePaths,
  };
  report.report_path = await writePhaseReport(config, "T-180", report);
  return report;
}

async function generationBindingForPhase(config) {
  const store = createPublishRunwayGenerationStore({
    rootDir: config.store_root,
  });
  let generation;
  if (config.phase === "T-90") {
    generation = await store.selectNewestValidGeneration({
      windowId: config.window.window_id,
    });
    if (!generation) {
      fail(
        "NO_VALID_GENERATION_FOR_WINDOW",
        "no immutable generation exists for the publish window",
        { window_id: config.window.window_id },
      );
    }
  } else {
    let lock;
    try {
      lock = await store.readT90Lock(config.window.window_id);
    } catch (error) {
      fail(
        clean(error.code) || "T90_GENERATION_LOCK_MISSING",
        "T0 cannot dispatch without an immutable T-90 lock",
        { window_id: config.window.window_id },
      );
    }
    generation = await store.verifyGeneration({
      generationId: lock.generation_id,
      expectedWindowId: config.window.window_id,
      expectedManifestSha256: lock.manifest_sha256,
    });
  }
  const bindingPath = path.join(generation.generation_path, "action-binding.json");
  const binding = await fs.readJson(bindingPath);
  return { generation, binding };
}

async function lockRunwayForJob({
  job,
  env = process.env,
  repoRoot,
  now,
} = {}) {
  const config = runtimeConfig({ job, env, repoRoot, now });
  if (config.phase !== "T-90") {
    fail("RUNWAY_PHASE_MISMATCH", "lock handler requires T-90");
  }
  const { generation, binding } = await generationBindingForPhase(config);
  const result = await coordinatorFor(config).lockAtT90({
    at: config.phase_at,
    generationId: generation.generation_id,
    windowId: config.window.window_id,
    selectedActionIds: binding.selected_action_ids,
  });
  const report = { ...result, runtime: config };
  report.report_path = await writePhaseReport(config, "T-90", report);
  return report;
}

async function resolveRunwayForJob({
  job,
  env = process.env,
  repoRoot,
  now,
} = {}) {
  const config = runtimeConfig({ job, env, repoRoot, now });
  if (config.phase !== "T0") {
    fail("RUNWAY_PHASE_MISMATCH", "dispatch handler requires T0");
  }
  const { generation, binding } = await generationBindingForPhase(config);
  const result = await coordinatorFor(config).resolveAtT0({
    at: config.phase_at,
    generationId: generation.generation_id,
    windowId: config.window.window_id,
    selectedActionIds: binding.selected_action_ids,
  });
  const report = { ...result, runtime: config };
  report.report_path = await writePhaseReport(config, "T0", {
    ...report,
    executor_plan: undefined,
  });
  return report;
}

function immutableRunwayRequired(job = {}, env = process.env) {
  const payload = object(job.payload) ? job.payload : {};
  if (payload.immutable_runway_required === false) return false;
  return (
    payload.immutable_runway_required === true ||
    clean(payload.phase).toUpperCase() === "T0" ||
    truthy(env.PULSE_IMMUTABLE_PUBLISH_RUNWAY_REQUIRED)
  );
}

module.exports = {
  DISABLED_PLATFORMS,
  ENABLED_PLATFORMS,
  PHASE_OFFSET_MINUTES,
  PublishRunwayJobRuntimeError,
  SOURCE_FILENAMES,
  STRICT_BUFFER_COUNT,
  STRICT_IMMEDIATE_COUNT,
  STRICT_RESERVE_COUNT,
  buildRunwaySourceDocuments,
  generateRunwayForJob,
  immutableRunwayRequired,
  lockRunwayForJob,
  phaseTimestampForJob,
  readCanonicalEvidence,
  resolveRunwayForJob,
  runCanonicalEvidenceRefresh,
  runtimeConfig,
  writeRunwaySourceEvidence,
};
