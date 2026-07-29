"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const {
  assessRightsLedger,
} = require("./publication-evidence-gates");
const {
  workOrderFingerprint,
} = require("./weekly-longform-work-order");

const MANIFEST_SCHEMA =
  "pulse-weekly-longform-derivative-manifest-v1";
const CLIP_METADATA_SCHEMA =
  "pulse-weekly-longform-derivative-clip-metadata-v1";
const RIGHTS_INHERITANCE_SCHEMA =
  "pulse-weekly-longform-derivative-rights-inheritance-v1";
const DECODED_PROBE_SCHEMA =
  "pulse-weekly-longform-derivative-decoded-probe-v1";
const GENERATOR_ID =
  "pulse-weekly-longform-derivative-materializer-v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{5,127}$/i;
const DERIVATIVE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,159}$/i;
const GEOMETRY = Object.freeze({ width: 1080, height: 1920 });
const DURATION_TOLERANCE_SECONDS = 0.35;
const PROFILES = Object.freeze([
  Object.freeze({
    id: "platform-teaser",
    kind: "platform_teaser",
    maximum_duration_seconds: 20,
    platform_targets: Object.freeze([
      "X_VIDEO",
      "INSTAGRAM_STORIES",
      "FACEBOOK_STORIES",
    ]),
  }),
  Object.freeze({
    id: "vertical-short",
    kind: "vertical_short",
    maximum_duration_seconds: 55,
    platform_targets: Object.freeze([
      "YOUTUBE_SHORTS",
      "TIKTOK",
      "INSTAGRAM_REELS",
      "FACEBOOK_REELS",
    ]),
  }),
]);

class WeeklyLongformDerivativeMaterializationError extends Error {
  constructor(codes) {
    const values = unique(
      Array.isArray(codes) ? codes : [codes],
    );
    super(
      `weekly_longform_derivative_materialization_invalid: ${values.join(", ")}`,
    );
    this.name = "WeeklyLongformDerivativeMaterializationError";
    this.codes = values;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stableJsonBytes(value) {
  return Buffer.from(
    `${JSON.stringify(stableValue(value), null, 2)}\n`,
    "utf8",
  );
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256Json(value) {
  return sha256Buffer(
    Buffer.from(JSON.stringify(stableValue(value)), "utf8"),
  );
}

function normaliseSha256(value) {
  const hash = text(value).replace(/^sha256:/i, "").toLowerCase();
  return SHA256_PATTERN.test(hash) ? hash : null;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function exactGeneratedAt(value) {
  const parsed = Date.parse(text(value));
  if (!Number.isFinite(parsed)) {
    throw new WeeklyLongformDerivativeMaterializationError(
      "derivative_generated_at_invalid",
    );
  }
  return new Date(parsed).toISOString();
}

function exactRunId(value) {
  const runId = text(value);
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new WeeklyLongformDerivativeMaterializationError(
      "derivative_run_id_invalid",
    );
  }
  return runId;
}

function contained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function observeBoundFile(
  record,
  prefix,
  { json = false, allowedRoot = null } = {},
) {
  const blockers = [];
  const filePath = text(record?.path);
  const declaredSha256 = normaliseSha256(record?.sha256);
  const resolvedPath = filePath ? path.resolve(filePath) : null;
  if (!filePath) blockers.push(`${prefix}_path_required`);
  if (!declaredSha256) blockers.push(`${prefix}_sha256_required`);
  if (
    resolvedPath &&
    allowedRoot &&
    !contained(allowedRoot, resolvedPath)
  ) {
    blockers.push(`${prefix}_outside_allowed_root`);
  }
  if (
    resolvedPath &&
    (!fs.existsSync(resolvedPath) ||
      !fs.statSync(resolvedPath).isFile())
  ) {
    blockers.push(`${prefix}_file_missing`);
  }
  if (blockers.length) {
    throw new WeeklyLongformDerivativeMaterializationError(blockers);
  }
  const bytes = fs.readFileSync(resolvedPath);
  const observedSha256 = sha256Buffer(bytes);
  if (!bytes.length) blockers.push(`${prefix}_file_empty`);
  if (observedSha256 !== declaredSha256) {
    blockers.push(`${prefix}_sha256_mismatch`);
  }
  let value = null;
  if (json) {
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      blockers.push(`${prefix}_json_invalid`);
    }
  }
  if (blockers.length) {
    throw new WeeklyLongformDerivativeMaterializationError(blockers);
  }
  return {
    path: resolvedPath,
    sha256: observedSha256,
    byte_length: bytes.length,
    bytes,
    value,
  };
}

function record(observed) {
  return {
    path: observed.path,
    sha256: observed.sha256,
    byte_length: observed.byte_length,
  };
}

function pathsMatch(left, right) {
  return path.resolve(text(left)) === path.resolve(text(right));
}

function validateWorkOrder(workOrder) {
  const blockers = [];
  if (
    !workOrder ||
    typeof workOrder !== "object" ||
    Array.isArray(workOrder)
  ) {
    throw new WeeklyLongformDerivativeMaterializationError(
      "derivative_work_order_required",
    );
  }
  const runId = exactRunId(workOrder.run_id);
  if (
    workOrder.schema_version !==
    "pulse-weekly-longform-work-order-v1"
  ) {
    blockers.push("derivative_work_order_schema_invalid");
  }
  if (workOrder.mode !== "LOCAL_PROOF") {
    blockers.push("derivative_work_order_local_proof_required");
  }
  const declaredFingerprint = normaliseSha256(
    workOrder.work_order_sha256,
  );
  if (
    !declaredFingerprint ||
    workOrderFingerprint(workOrder) !== declaredFingerprint
  ) {
    blockers.push("derivative_work_order_fingerprint_invalid");
  }
  for (const [field, code] of [
    ["external_publish_authorised", "derivative_publish_authority_forbidden"],
    ["database_mutation_authorised", "derivative_database_authority_forbidden"],
    ["oauth_mutation_authorised", "derivative_oauth_authority_forbidden"],
  ]) {
    if (workOrder?.safety?.[field] !== false) blockers.push(code);
  }
  const derivativePlan = workOrder.derivative_plan;
  if (
    derivativePlan?.schema_version !==
      "pulse-weekly-derivative-plan-v1" ||
    derivativePlan?.status !== "PLANNED_LOCAL_PROOF" ||
    !Array.isArray(derivativePlan?.items)
  ) {
    blockers.push("derivative_plan_invalid");
  }
  const estimatedDurationSeconds = positiveNumber(
    workOrder?.script?.estimated_duration_seconds,
  );
  if (
    workOrder?.script?.schema_version !==
      "pulse-weekly-longform-script-v1" ||
    !normaliseSha256(workOrder?.script?.sha256) ||
    !estimatedDurationSeconds
  ) {
    blockers.push("derivative_script_binding_invalid");
  }
  const beats = Array.isArray(workOrder?.visual_beat_plan?.beats)
    ? workOrder.visual_beat_plan.beats
    : [];
  if (
    workOrder?.visual_beat_plan?.schema_version !==
      "pulse-weekly-visual-beat-plan-v1" ||
    !beats.length
  ) {
    blockers.push("derivative_visual_beat_plan_invalid");
  }

  const selectedStoryRights = new Map(
    (Array.isArray(workOrder?.selection?.selected)
      ? workOrder.selection.selected
      : []
    ).map((story) => [
      text(story?.story_id),
      normaliseSha256(story?.rights_ledger?.sha256),
    ]),
  );
  const mediaItems = [];
  const seenDerivativeIds = new Set();
  for (const item of Array.isArray(derivativePlan?.items)
    ? derivativePlan.items
    : []) {
    if (text(item?.format) !== "vertical_short") continue;
    const derivativeId = text(item?.derivative_id);
    const storyId = text(item?.story_id);
    const itemBlockers = [];
    if (
      !DERIVATIVE_ID_PATTERN.test(derivativeId) ||
      seenDerivativeIds.has(derivativeId)
    ) {
      itemBlockers.push(
        seenDerivativeIds.has(derivativeId)
          ? "derivative_id_duplicate"
          : "derivative_id_invalid",
      );
    }
    seenDerivativeIds.add(derivativeId);
    if (!storyId) itemBlockers.push("derivative_story_id_required");
    if (!text(item?.hook)) itemBlockers.push("derivative_hook_required");
    if (
      !Array.isArray(item?.claim_ids) ||
      item.claim_ids.length === 0 ||
      item.claim_ids.some((claimId) => !text(claimId))
    ) {
      itemBlockers.push("derivative_claim_binding_required");
    }
    if (!normaliseSha256(item?.source_evidence_sha256)) {
      itemBlockers.push("derivative_source_evidence_hash_required");
    }
    const itemRightsSha256 = normaliseSha256(
      item?.rights_lineage_sha256,
    );
    if (!itemRightsSha256) {
      itemBlockers.push("derivative_story_rights_hash_required");
    } else if (
      !selectedStoryRights.has(storyId) ||
      selectedStoryRights.get(storyId) !== itemRightsSha256
    ) {
      itemBlockers.push("derivative_story_rights_binding_mismatch");
    }
    const storyBeats = beats
      .filter((beat) => text(beat?.story_id) === storyId)
      .map((beat) => ({
        start_seconds: positiveNumber(beat?.estimated_start_seconds),
        end_seconds: positiveNumber(beat?.estimated_end_seconds),
      }));
    if (
      !storyBeats.length ||
      storyBeats.some(
        (beat) =>
          !beat.start_seconds ||
          !beat.end_seconds ||
          beat.end_seconds <= beat.start_seconds,
      )
    ) {
      itemBlockers.push("derivative_story_time_basis_invalid");
    }
    if (itemBlockers.length) {
      blockers.push(...itemBlockers);
      continue;
    }
    mediaItems.push({
      derivative_id: derivativeId,
      story_id: storyId,
      hook: text(item.hook),
      claim_ids: unique(item.claim_ids.map(text)).sort(),
      source_evidence_sha256: normaliseSha256(
        item.source_evidence_sha256,
      ),
      rights_lineage_sha256: itemRightsSha256,
      story_estimated_start_seconds: Math.min(
        ...storyBeats.map((beat) => beat.start_seconds),
      ),
      story_estimated_end_seconds: Math.max(
        ...storyBeats.map((beat) => beat.end_seconds),
      ),
    });
  }
  if (!mediaItems.length) {
    blockers.push("derivative_vertical_short_items_required");
  }
  if (blockers.length) {
    throw new WeeklyLongformDerivativeMaterializationError(blockers);
  }
  return {
    runId,
    fingerprint: declaredFingerprint,
    estimatedDurationSeconds,
    mediaItems: mediaItems.sort((left, right) =>
      left.derivative_id.localeCompare(right.derivative_id),
    ),
    ignoredItems: derivativePlan.items
      .filter((item) => text(item?.format) !== "vertical_short")
      .map((item) => ({
        derivative_id: text(item?.derivative_id) || null,
        format: text(item?.format) || null,
        reason: "non_media_derivative_not_materialised_by_this_lane",
      }))
      .sort((left, right) =>
        text(left.derivative_id).localeCompare(
          text(right.derivative_id),
        ),
      ),
  };
}

function requireExactEvidenceBinding({
  declared,
  observed,
  prefix,
}) {
  const blockers = [];
  if (!declared || declared.ready !== true) {
    blockers.push(`${prefix}_not_ready`);
  }
  if (
    !pathsMatch(declared?.path, observed.path) ||
    normaliseSha256(declared?.sha256) !== observed.sha256
  ) {
    blockers.push(`${prefix}_manifest_binding_mismatch`);
  }
  if (blockers.length) {
    throw new WeeklyLongformDerivativeMaterializationError(blockers);
  }
}

function validateWords(value, runId) {
  const blockers = [];
  if (
    value?.schema_version !==
      "pulse-longform-word-timestamps-binding-v1" ||
    text(value?.run_id) !== runId ||
    value?.timing_basis !== "provider_word_alignment" ||
    !text(value?.provider) ||
    value?.exact_script_match !== true ||
    !normaliseSha256(value?.source_alignment_sha256)
  ) {
    blockers.push("derivative_provider_word_alignment_invalid");
  }
  const words = Array.isArray(value?.words) ? value.words : [];
  if (!words.length || Number(value?.word_count) !== words.length) {
    blockers.push("derivative_provider_words_required");
  }
  const canonicalWords = [];
  let previousEnd = 0;
  for (const [index, word] of words.entries()) {
    const start = Number(word?.start_seconds);
    const end = Number(word?.end_seconds);
    if (
      !text(word?.text) ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      (index > 0 && start < previousEnd)
    ) {
      blockers.push("derivative_provider_word_timing_invalid");
      break;
    }
    canonicalWords.push({
      text: text(word.text),
      start_seconds: start,
      end_seconds: end,
    });
    previousEnd = end;
  }
  if (canonicalWords.length !== words.length) {
    blockers.push("derivative_provider_word_count_invalid");
  }
  if (blockers.length) {
    throw new WeeklyLongformDerivativeMaterializationError(blockers);
  }
  return canonicalWords;
}

function validateSameRunEvidence({
  workOrder,
  workOrderState,
  sameRunEvidence,
}) {
  const manifest = observeBoundFile(
    sameRunEvidence?.manifest,
    "derivative_same_run_manifest",
    { json: true },
  );
  const report = observeBoundFile(
    sameRunEvidence?.report,
    "derivative_same_run_report",
    { json: true },
  );
  const captions = observeBoundFile(
    sameRunEvidence?.caption_manifest,
    "derivative_caption_manifest",
    { json: true },
  );
  const rights = observeBoundFile(
    sameRunEvidence?.rights_lineage,
    "derivative_rights_lineage",
    { json: true },
  );
  const blockers = [];
  const manifestValue = manifest.value || {};
  const reportValue = report.value || {};
  const captionValue = captions.value || {};
  const rightsValue = rights.value || {};

  if (
    manifestValue.schema_version !==
      "pulse-longform-same-run-manifest-v1" ||
    text(manifestValue.run_id) !== workOrderState.runId ||
    manifestValue.mode !== "LOCAL_PROOF" ||
    manifestValue.package_bindings?.all_match !== true ||
    manifestValue.machine_evidence_complete !== true
  ) {
    blockers.push("derivative_same_run_manifest_not_complete");
  }
  if (
    manifestValue.controls?.external_publish_authorised !== false ||
    manifestValue.controls?.database_mutation_authorised !== false ||
    manifestValue.controls?.oauth_mutation_authorised !== false
  ) {
    blockers.push("derivative_same_run_authority_forbidden");
  }
  if (
    reportValue.schema_version !==
      "pulse-longform-same-run-evidence-report-v1" ||
    text(reportValue.run_id) !== workOrderState.runId ||
    reportValue.same_run_core_bound !== true ||
    reportValue.machine_evidence_complete !== true ||
    reportValue.status !==
      "MACHINE_EVIDENCE_COMPLETE_AWAITING_HUMAN_REVIEW" ||
    normaliseSha256(reportValue.evidence?.manifest_sha256) !==
      manifest.sha256
  ) {
    blockers.push("derivative_same_run_report_not_complete");
  }
  if (
    reportValue.external_publish_authorised !== false ||
    reportValue.database_mutation_authorised !== false ||
    reportValue.oauth_mutation_authorised !== false
  ) {
    blockers.push("derivative_same_run_report_authority_forbidden");
  }
  if (blockers.length) {
    throw new WeeklyLongformDerivativeMaterializationError(blockers);
  }

  const master = observeBoundFile(
    manifestValue.sources?.master,
    "derivative_same_run_master",
  );
  if (
    normaliseSha256(manifestValue.sources?.script?.sha256) !==
    normaliseSha256(workOrder?.script?.sha256)
  ) {
    throw new WeeklyLongformDerivativeMaterializationError(
      "derivative_same_run_script_binding_mismatch",
    );
  }
  requireExactEvidenceBinding({
    declared: manifestValue.evidence_outputs?.captions,
    observed: captions,
    prefix: "derivative_caption_manifest",
  });
  requireExactEvidenceBinding({
    declared: manifestValue.evidence_outputs?.rights_lineage,
    observed: rights,
    prefix: "derivative_rights_lineage",
  });

  if (
    captionValue.schema_version !==
      "pulse-longform-caption-manifest-v1" ||
    text(captionValue.run_id) !== workOrderState.runId ||
    captionValue.ready !== true ||
    captionValue.timing_basis !== "provider_word_alignment" ||
    normaliseSha256(captionValue.bindings?.master_sha256) !==
      master.sha256 ||
    normaliseSha256(captionValue.bindings?.script_sha256) !==
      normaliseSha256(workOrder?.script?.sha256)
  ) {
    throw new WeeklyLongformDerivativeMaterializationError(
      "derivative_caption_manifest_invalid",
    );
  }
  const timestamps = observeBoundFile(
    captionValue.outputs?.word_timestamps,
    "derivative_word_timestamps",
    { json: true },
  );
  if (
    normaliseSha256(
      captionValue.bindings?.word_timestamps_sha256,
    ) !== timestamps.sha256 ||
    Number(captionValue.outputs?.word_timestamps?.word_count) !==
      Number(timestamps.value?.word_count)
  ) {
    throw new WeeklyLongformDerivativeMaterializationError(
      "derivative_word_timestamps_caption_binding_mismatch",
    );
  }
  const words = validateWords(
    timestamps.value,
    workOrderState.runId,
  );

  if (
    rightsValue.schema_version !==
      "pulse-longform-rights-lineage-v1" ||
    text(rightsValue.run_id) !== workOrderState.runId ||
    rightsValue.status !== "CLEARED" ||
    rightsValue.ready !== true ||
    normaliseSha256(rightsValue.bindings?.master_sha256) !==
      master.sha256
  ) {
    throw new WeeklyLongformDerivativeMaterializationError(
      "derivative_rights_lineage_not_cleared",
    );
  }
  const rightsAssessment = assessRightsLedger(
    rightsValue.decision,
    rightsValue.bindings?.canonical_ledger_sha256,
  );
  if (
    rightsAssessment.blockers.length ||
    rightsAssessment.sha256 !==
      normaliseSha256(
        rightsValue.bindings?.declared_ledger_sha256,
      )
  ) {
    throw new WeeklyLongformDerivativeMaterializationError([
      "derivative_rights_lineage_invalid",
      ...rightsAssessment.blockers,
    ]);
  }

  return {
    manifest,
    report,
    captions,
    rights,
    master,
    timestamps,
    words,
    rightsDecision: rightsAssessment.decision,
    canonicalRightsSha256: rightsAssessment.sha256,
  };
}

function validateRuntime({ ffmpegPath, ffprobePath, processRunner }) {
  const blockers = [];
  for (const [value, prefix] of [
    [ffmpegPath, "ffmpeg"],
    [ffprobePath, "ffprobe"],
  ]) {
    if (!text(value) || !path.isAbsolute(text(value))) {
      blockers.push(`derivative_explicit_${prefix}_path_required`);
      continue;
    }
    const resolved = path.resolve(text(value));
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      blockers.push(`derivative_explicit_${prefix}_binary_missing`);
    }
  }
  if (typeof processRunner !== "function") {
    blockers.push("derivative_injected_process_runner_required");
  }
  if (blockers.length) {
    throw new WeeklyLongformDerivativeMaterializationError(blockers);
  }
  return {
    ffmpegPath: path.resolve(ffmpegPath),
    ffprobePath: path.resolve(ffprobePath),
    processRunner,
  };
}

function selectWords(words, startSeconds, endSeconds) {
  return words.filter(
    (word) =>
      word.end_seconds > startSeconds &&
      word.start_seconds < endSeconds,
  );
}

function snapWindow({
  words,
  targetStartSeconds,
  targetEndSeconds,
  maximumDurationSeconds,
}) {
  const first = words.find(
    (word) => word.end_seconds > targetStartSeconds,
  );
  if (!first) {
    throw new WeeklyLongformDerivativeMaterializationError(
      "derivative_clip_start_outside_alignment",
    );
  }
  const maximumEnd = Math.min(
    targetEndSeconds,
    first.start_seconds + maximumDurationSeconds,
    words.at(-1).end_seconds,
  );
  const candidates = words.filter(
    (word) =>
      word.start_seconds >= first.start_seconds &&
      word.end_seconds <= maximumEnd,
  );
  const last = candidates.at(-1);
  if (!last || last.end_seconds <= first.start_seconds) {
    throw new WeeklyLongformDerivativeMaterializationError(
      "derivative_clip_has_no_aligned_words",
    );
  }
  return {
    start_seconds: first.start_seconds,
    end_seconds: last.end_seconds,
    duration_seconds: Number(
      (last.end_seconds - first.start_seconds).toFixed(3),
    ),
    words: selectWords(
      words,
      first.start_seconds,
      last.end_seconds,
    ),
  };
}

function buildMaterializationPlan({
  workOrderState,
  evidence,
}) {
  const alignmentDuration = evidence.words.at(-1).end_seconds;
  const runtimeScale =
    alignmentDuration / workOrderState.estimatedDurationSeconds;
  const clips = [];
  for (const item of workOrderState.mediaItems) {
    const targetStart =
      item.story_estimated_start_seconds * runtimeScale;
    const targetEnd =
      item.story_estimated_end_seconds * runtimeScale;
    for (const profile of PROFILES) {
      const window = snapWindow({
        words: evidence.words,
        targetStartSeconds: targetStart,
        targetEndSeconds: targetEnd,
        maximumDurationSeconds: profile.maximum_duration_seconds,
      });
      clips.push({
        clip_id: `${item.derivative_id}-${profile.id}`,
        derivative_id: item.derivative_id,
        story_id: item.story_id,
        kind: profile.kind,
        profile_id: profile.id,
        hook: item.hook,
        claim_ids: item.claim_ids,
        source_evidence_sha256: item.source_evidence_sha256,
        story_rights_lineage_sha256:
          item.rights_lineage_sha256,
        platform_targets: [...profile.platform_targets],
        width: GEOMETRY.width,
        height: GEOMETRY.height,
        timing_basis:
          "work_order_story_beats_scaled_to_provider_alignment_and_snapped_to_word_boundaries",
        source_estimate: {
          start_seconds: item.story_estimated_start_seconds,
          end_seconds: item.story_estimated_end_seconds,
          runtime_scale: Number(runtimeScale.toFixed(9)),
        },
        exact_time_bounds: {
          start_seconds: window.start_seconds,
          end_seconds: window.end_seconds,
          duration_seconds: window.duration_seconds,
        },
        words: window.words,
      });
    }
  }
  return {
    schema_version:
      "pulse-weekly-longform-derivative-materialization-plan-v1",
    work_order_sha256: workOrderState.fingerprint,
    same_run_manifest_sha256: evidence.manifest.sha256,
    alignment_sha256: evidence.timestamps.sha256,
    master_sha256: evidence.master.sha256,
    rights_lineage_sha256: evidence.rights.sha256,
    timing_basis:
      "work_order_story_beats_scaled_to_provider_alignment_and_snapped_to_word_boundaries",
    clips: clips.sort((left, right) =>
      left.clip_id.localeCompare(right.clip_id),
    ),
  };
}

function captionCues(words, clipStartSeconds) {
  const cues = [];
  let current = [];
  for (const word of words) {
    const relative = {
      text: word.text,
      start_seconds: Math.max(
        0,
        word.start_seconds - clipStartSeconds,
      ),
      end_seconds: Math.max(
        0,
        word.end_seconds - clipStartSeconds,
      ),
    };
    const proposed = [...current, relative];
    const duration =
      proposed.at(-1).end_seconds -
      proposed[0].start_seconds;
    if (current.length && (proposed.length > 6 || duration > 2.8)) {
      cues.push(current);
      current = [relative];
    } else {
      current = proposed;
    }
  }
  if (current.length) cues.push(current);
  return cues.map((cue, index) => ({
    cue_index: index + 1,
    start_seconds: Number(cue[0].start_seconds.toFixed(3)),
    end_seconds: Number(cue.at(-1).end_seconds.toFixed(3)),
    text: cue.map((word) => word.text).join(" "),
  }));
}

function assTimestamp(seconds) {
  const centiseconds = Math.max(0, Math.round(Number(seconds) * 100));
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const secs = Math.floor((centiseconds % 6000) / 100);
  const fraction = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(fraction).padStart(2, "0")}`;
}

function assText(value) {
  return text(value)
    .replace(/[{}]/g, "")
    .replace(/\r?\n/g, "\\N");
}

function renderAss(cues) {
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "ScaledBorderAndShadow: yes",
    "WrapStyle: 2",
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    "Style: PulseCaption,Arial,64,&H00FFFFFF,&H000000FF,&H00101010,&H90000000,-1,0,0,0,100,100,0,0,1,5,1,2,80,80,300,1",
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
  ];
  const events = cues.map(
    (cue) =>
      `Dialogue: 0,${assTimestamp(cue.start_seconds)},${assTimestamp(cue.end_seconds)},PulseCaption,,0,0,0,,${assText(cue.text)}`,
  );
  return `${[...header, ...events].join("\r\n")}\r\n`;
}

function ffmpegFilter(captionPath) {
  const escapedPath = path
    .resolve(captionPath)
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
  return [
    `[0:v]scale=${GEOMETRY.width}:${GEOMETRY.height}:force_original_aspect_ratio=increase`,
    `crop=${GEOMETRY.width}:${GEOMETRY.height}`,
    "boxblur=24:2[bg]",
    `[0:v]scale=${GEOMETRY.width}:${GEOMETRY.height}:force_original_aspect_ratio=decrease[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,subtitles=filename='${escapedPath}'[v]`,
  ].join(";");
}

async function writeAtomic(filePath, bytes) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsp.writeFile(temporaryPath, bytes, { flag: "wx" });
    await fsp.rename(temporaryPath, filePath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function writeJson(filePath, value) {
  const bytes = stableJsonBytes(value);
  await writeAtomic(filePath, bytes);
  return {
    path: path.resolve(filePath),
    sha256: sha256Buffer(bytes),
    byte_length: bytes.length,
  };
}

async function invokeProcess(
  runtime,
  { command, args, cwd, timeoutMs, failureCode },
) {
  let result;
  try {
    result = await runtime.processRunner({
      command,
      args,
      cwd,
      timeout_ms: timeoutMs,
    });
  } catch {
    throw new WeeklyLongformDerivativeMaterializationError(
      failureCode,
    );
  }
  if (Number(result?.status) !== 0) {
    throw new WeeklyLongformDerivativeMaterializationError(
      failureCode,
    );
  }
  return {
    stdout: String(result?.stdout || ""),
    stderr: String(result?.stderr || ""),
  };
}

function parseProbe(stdout, expectedDurationSeconds) {
  let value;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new WeeklyLongformDerivativeMaterializationError(
      "derivative_ffprobe_json_invalid",
    );
  }
  const streams = Array.isArray(value?.streams) ? value.streams : [];
  const video = streams.find((stream) => stream?.codec_type === "video");
  const audio = streams.find((stream) => stream?.codec_type === "audio");
  const durationSeconds = positiveNumber(value?.format?.duration);
  const blockers = [];
  if (
    positiveNumber(video?.width) !== GEOMETRY.width ||
    positiveNumber(video?.height) !== GEOMETRY.height
  ) {
    blockers.push("derivative_decoded_geometry_invalid");
  }
  if (!text(video?.codec_name)) {
    blockers.push("derivative_decoded_video_codec_required");
  }
  if (!text(audio?.codec_name)) {
    blockers.push("derivative_decoded_audio_codec_required");
  }
  if (!durationSeconds) {
    blockers.push("derivative_decoded_duration_required");
  } else if (
    Math.abs(durationSeconds - expectedDurationSeconds) >
    DURATION_TOLERANCE_SECONDS
  ) {
    blockers.push("derivative_decoded_duration_mismatch");
  }
  const formatNames = text(value?.format?.format_name)
    .toLowerCase()
    .split(",");
  if (!formatNames.includes("mp4")) {
    blockers.push("derivative_decoded_container_invalid");
  }
  if (blockers.length) {
    throw new WeeklyLongformDerivativeMaterializationError(blockers);
  }
  return {
    width: Number(video.width),
    height: Number(video.height),
    duration_seconds: Number(durationSeconds.toFixed(3)),
    video_duration_seconds:
      positiveNumber(video.duration) || durationSeconds,
    audio_duration_seconds:
      positiveNumber(audio.duration) || durationSeconds,
    container: "mp4",
    video_codec: text(video.codec_name).toLowerCase(),
    audio_codec: text(audio.codec_name).toLowerCase(),
  };
}

function safeName(value) {
  const normalised = text(value).toLowerCase();
  if (!DERIVATIVE_ID_PATTERN.test(normalised)) {
    throw new WeeklyLongformDerivativeMaterializationError(
      "derivative_output_identity_invalid",
    );
  }
  return normalised;
}

function assertInputIntegrity(evidence) {
  for (const [observed, prefix] of [
    [evidence.manifest, "derivative_same_run_manifest"],
    [evidence.report, "derivative_same_run_report"],
    [evidence.captions, "derivative_caption_manifest"],
    [evidence.rights, "derivative_rights_lineage"],
    [evidence.master, "derivative_same_run_master"],
    [evidence.timestamps, "derivative_word_timestamps"],
  ]) {
    observeBoundFile(record(observed), prefix);
  }
}

async function materializeClip({
  clip,
  outputRoot,
  generatedAt,
  runId,
  workOrderSha256,
  materializationPlanSha256,
  evidence,
  runtime,
}) {
  const clipRoot = path.join(
    outputRoot,
    safeName(clip.derivative_id),
    clip.profile_id,
  );
  await fsp.mkdir(clipRoot, { recursive: true });
  const captionsPath = path.join(clipRoot, "captions.ass");
  const cues = captionCues(
    clip.words,
    clip.exact_time_bounds.start_seconds,
  );
  if (!cues.length) {
    throw new WeeklyLongformDerivativeMaterializationError(
      "derivative_caption_cues_required",
    );
  }
  const captionsBytes = Buffer.from(renderAss(cues), "utf8");
  await writeAtomic(captionsPath, captionsBytes);
  const captionsRecord = {
    path: captionsPath,
    sha256: sha256Buffer(captionsBytes),
    byte_length: captionsBytes.length,
    cue_count: cues.length,
    word_count: clip.words.length,
    timing_basis: "provider_word_alignment",
    source_alignment_sha256:
      evidence.timestamps.value.source_alignment_sha256,
    source_word_timestamps_sha256: evidence.timestamps.sha256,
  };

  const finalMediaPath = path.join(clipRoot, `${clip.kind}.mp4`);
  const temporaryMediaPath = path.join(
    clipRoot,
    `${clip.kind}.${process.pid}.${Date.now()}.partial.mp4`,
  );
  if (fs.existsSync(finalMediaPath)) {
    throw new WeeklyLongformDerivativeMaterializationError(
      "derivative_output_already_exists",
    );
  }
  const start = clip.exact_time_bounds.start_seconds.toFixed(3);
  const duration = clip.exact_time_bounds.duration_seconds.toFixed(3);
  let decoded;
  try {
    await invokeProcess(runtime, {
      command: runtime.ffmpegPath,
      args: [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        evidence.master.path,
        "-ss",
        start,
        "-t",
        duration,
        "-filter_complex",
        ffmpegFilter(captionsPath),
        "-map",
        "[v]",
        "-map",
        "0:a:0",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "48000",
        "-shortest",
        "-avoid_negative_ts",
        "make_zero",
        "-map_metadata",
        "-1",
        "-metadata",
        `title=${clip.hook}`,
        "-metadata",
        `comment=pulse:${runId}:${clip.clip_id}:${evidence.master.sha256}`,
        "-movflags",
        "+faststart",
        temporaryMediaPath,
      ],
      cwd: clipRoot,
      timeoutMs: 30 * 60 * 1000,
      failureCode: "derivative_ffmpeg_transcode_failed",
    });
    const temporaryMedia = observeBoundFile(
      {
        path: temporaryMediaPath,
        sha256: fs.existsSync(temporaryMediaPath)
          ? sha256Buffer(fs.readFileSync(temporaryMediaPath))
          : null,
      },
      "derivative_encoded_media",
      { allowedRoot: clipRoot },
    );
    const probeResult = await invokeProcess(runtime, {
      command: runtime.ffprobePath,
      args: [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        temporaryMedia.path,
      ],
      cwd: clipRoot,
      timeoutMs: 120000,
      failureCode: "derivative_ffprobe_failed",
    });
    decoded = parseProbe(
      probeResult.stdout,
      clip.exact_time_bounds.duration_seconds,
    );
    await invokeProcess(runtime, {
      command: runtime.ffmpegPath,
      args: [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        temporaryMedia.path,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0",
        "-f",
        "null",
        "-",
      ],
      cwd: clipRoot,
      timeoutMs: 30 * 60 * 1000,
      failureCode: "derivative_full_decode_failed",
    });
    assertInputIntegrity(evidence);
    await fsp.rename(temporaryMedia.path, finalMediaPath);
  } catch (error) {
    await Promise.all([
      fsp.rm(temporaryMediaPath, { force: true }),
      fsp.rm(finalMediaPath, { force: true }),
    ]);
    throw error;
  }
  const media = observeBoundFile(
    {
      path: finalMediaPath,
      sha256: sha256Buffer(fs.readFileSync(finalMediaPath)),
    },
    "derivative_final_media",
    { allowedRoot: clipRoot },
  );

  const probeEvidence = {
    schema_version: DECODED_PROBE_SCHEMA,
    generated_at: generatedAt,
    generator_identity: GENERATOR_ID,
    run_id: runId,
    clip_id: clip.clip_id,
    master_sha256: evidence.master.sha256,
    media_sha256: media.sha256,
    exact_time_bounds: clip.exact_time_bounds,
    decoder: "ffmpeg+ffprobe",
    full_decode_passed: true,
    decoded_media: decoded,
  };
  const decodedProbeRecord = await writeJson(
    path.join(clipRoot, "decoded-probe-evidence.json"),
    probeEvidence,
  );

  const rightsInheritance = {
    schema_version: RIGHTS_INHERITANCE_SCHEMA,
    generated_at: generatedAt,
    generator_identity: GENERATOR_ID,
    run_id: runId,
    clip_id: clip.clip_id,
    status: "CLEARED_BY_EXACT_PARENT_INHERITANCE",
    policy: "NO_RIGHTS_EXPANSION_FROM_COMPLETED_PARENT_MASTER",
    parent: {
      same_run_rights_lineage_path: evidence.rights.path,
      same_run_rights_lineage_sha256: evidence.rights.sha256,
      canonical_ledger_sha256: evidence.canonicalRightsSha256,
      master_sha256: evidence.master.sha256,
      story_rights_lineage_sha256:
        clip.story_rights_lineage_sha256,
      inherited_items: evidence.rightsDecision.items,
    },
    derivative_asset: {
      sha256: media.sha256,
      transformation:
        "exact_time_bound_reframe_with_provider_aligned_burned_captions",
      rights_scope:
        "inherits_only_the_parent_ledger_cleared_scope_and_restrictions",
    },
    external_publish_authorised: false,
  };
  const rightsRecord = await writeJson(
    path.join(clipRoot, "rights-inheritance.json"),
    rightsInheritance,
  );

  const metadataValue = {
    schema_version: CLIP_METADATA_SCHEMA,
    generated_at: generatedAt,
    generator_identity: GENERATOR_ID,
    run_id: runId,
    clip_id: clip.clip_id,
    derivative_id: clip.derivative_id,
    story_id: clip.story_id,
    kind: clip.kind,
    hook: clip.hook,
    claim_ids: clip.claim_ids,
    source_evidence_sha256: clip.source_evidence_sha256,
    work_order_sha256: workOrderSha256,
    materialization_plan_sha256: materializationPlanSha256,
    master_sha256: evidence.master.sha256,
    alignment_sha256: evidence.timestamps.sha256,
    rights_lineage_sha256: evidence.rights.sha256,
    exact_time_bounds: clip.exact_time_bounds,
    width: clip.width,
    height: clip.height,
    platform_targets: clip.platform_targets,
    captions_sha256: captionsRecord.sha256,
    media_sha256: media.sha256,
    decoded_probe_sha256: decodedProbeRecord.sha256,
    rights_inheritance_sha256: rightsRecord.sha256,
    human_review_required: true,
    external_publish_authorised: false,
  };
  const metadataRecord = await writeJson(
    path.join(clipRoot, "clip-metadata.json"),
    metadataValue,
  );

  return {
    clip_id: clip.clip_id,
    derivative_id: clip.derivative_id,
    story_id: clip.story_id,
    kind: clip.kind,
    hook: clip.hook,
    claim_ids: clip.claim_ids,
    source_evidence_sha256: clip.source_evidence_sha256,
    story_rights_lineage_sha256:
      clip.story_rights_lineage_sha256,
    platform_targets: clip.platform_targets,
    width: clip.width,
    height: clip.height,
    exact_time_bounds: clip.exact_time_bounds,
    media: record(media),
    captions: captionsRecord,
    metadata: metadataRecord,
    rights_inheritance: rightsRecord,
    decoded_probe: decodedProbeRecord,
    decode_evidence: {
      decoder: "ffmpeg+ffprobe",
      full_decode_passed: true,
      decoded_media: decoded,
    },
    status: "AWAITING_HUMAN_AV_REVIEW",
    external_publish_authorised: false,
  };
}

async function materializeGovernedWeeklyLongformDerivatives({
  workOrder,
  sameRunEvidence,
  outputDir,
  generatedAt,
  ffmpegPath,
  ffprobePath,
  processRunner,
} = {}) {
  if (!text(outputDir)) {
    throw new WeeklyLongformDerivativeMaterializationError(
      "derivative_output_dir_required",
    );
  }
  const exactGenerated = exactGeneratedAt(generatedAt);
  const workOrderState = validateWorkOrder(workOrder);
  const evidence = validateSameRunEvidence({
    workOrder,
    workOrderState,
    sameRunEvidence,
  });
  const runtime = validateRuntime({
    ffmpegPath,
    ffprobePath,
    processRunner,
  });
  const outputRoot = path.resolve(outputDir);
  if (
    [
      evidence.master.path,
      evidence.manifest.path,
      evidence.report.path,
      evidence.captions.path,
      evidence.rights.path,
      evidence.timestamps.path,
    ].some((inputPath) => contained(outputRoot, inputPath))
  ) {
    throw new WeeklyLongformDerivativeMaterializationError(
      "derivative_output_root_must_not_contain_source_evidence",
    );
  }
  const plan = buildMaterializationPlan({
    workOrderState,
    evidence,
  });
  const planSha256 = sha256Json(plan);
  await fsp.mkdir(outputRoot, { recursive: true });
  const planRecord = await writeJson(
    path.join(outputRoot, "derivative-materialization-plan.json"),
    plan,
  );
  const clips = [];
  try {
    for (const clip of plan.clips) {
      clips.push(
        await materializeClip({
          clip,
          outputRoot,
          generatedAt: exactGenerated,
          runId: workOrderState.runId,
          workOrderSha256: workOrderState.fingerprint,
          materializationPlanSha256: planSha256,
          evidence,
          runtime,
        }),
      );
    }
    assertInputIntegrity(evidence);
  } catch (error) {
    await fsp.rm(
      path.join(outputRoot, "weekly-longform-derivative-manifest.json"),
      { force: true },
    );
    throw error;
  }

  const manifest = {
    schema_version: MANIFEST_SCHEMA,
    generated_at: exactGenerated,
    generator_identity: GENERATOR_ID,
    run_id: workOrderState.runId,
    mode: "LOCAL_PROOF",
    status: "AWAITING_HUMAN_AV_REVIEW",
    work_order: {
      sha256: workOrderState.fingerprint,
      derivative_plan_sha256: sha256Json(workOrder.derivative_plan),
    },
    materialization_plan: {
      path: planRecord.path,
      sha256: planRecord.sha256,
      semantic_sha256: planSha256,
    },
    inputs: {
      same_run_manifest: record(evidence.manifest),
      same_run_report: record(evidence.report),
      master: record(evidence.master),
      caption_manifest: record(evidence.captions),
      word_timestamps: record(evidence.timestamps),
      rights_lineage: record(evidence.rights),
    },
    input_integrity_verified_after_materialization: true,
    ignored_derivatives: workOrderState.ignoredItems,
    clip_count: clips.length,
    clips: clips.sort((left, right) =>
      left.clip_id.localeCompare(right.clip_id),
    ),
    controls: {
      human_av_review_required: true,
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
      network_used: false,
      implicit_process_spawn_used: false,
      process_runtime: "injected_explicit_ffmpeg_ffprobe",
    },
  };
  const manifestRecord = await writeJson(
    path.join(outputRoot, "weekly-longform-derivative-manifest.json"),
    manifest,
  );
  return {
    manifest,
    manifest_path: manifestRecord.path,
    manifest_sha256: manifestRecord.sha256,
    materialization_plan: plan,
    materialization_plan_sha256: planSha256,
    external_publish_authorised: false,
    database_mutation_authorised: false,
    oauth_mutation_authorised: false,
    network_used: false,
  };
}

module.exports = {
  CLIP_METADATA_SCHEMA,
  DECODED_PROBE_SCHEMA,
  GENERATOR_ID,
  MANIFEST_SCHEMA,
  PROFILES,
  RIGHTS_INHERITANCE_SCHEMA,
  WeeklyLongformDerivativeMaterializationError,
  materializeGovernedWeeklyLongformDerivatives,
  sha256Buffer,
  sha256Json,
};
