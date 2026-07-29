"use strict";

const {
  DEFAULT_ROTATION_POLICY,
  FORMAT_ID,
  assessEvergreenVerdictCandidate,
  buildEvergreenVerdictRotation,
} = require("../formats/evergreen-verdict-short");

const SCHEMA_VERSION = "pulse-evergreen-candidate-report-v1";
const MODE = "LOCAL_PROOF";

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value || "").trim();
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function utcWeekBounds(now) {
  const value = new Date(now);
  const daysSinceMonday = (value.getUTCDay() + 6) % 7;
  const weekStart = new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate() - daysSinceMonday,
    ),
  );
  return {
    weekStart,
    weekEnd: new Date(weekStart.getTime() + 7 * 86_400_000),
  };
}

function isEvergreenCommitment(item) {
  return (
    [item?.format_id, item?.editorial_format, item?.format_family].some(
      (value) => text(value) === FORMAT_ID,
    ) || text(item?.lane_id) === "evergreen_short"
  );
}

function weeklyRotationState({ history, now, policy }) {
  const { weekStart, weekEnd } = utcWeekBounds(now);
  const configuredMaximum = Number(policy?.maximum_per_week);
  const maximumPerWeek = Math.max(
    0,
    Math.min(
      DEFAULT_ROTATION_POLICY.maximum_per_week,
      Number.isFinite(configuredMaximum)
        ? Math.floor(configuredMaximum)
        : DEFAULT_ROTATION_POLICY.maximum_per_week,
    ),
  );
  const identities = new Set();
  for (const item of array(history)) {
    if (!isEvergreenCommitment(item)) continue;
    const rawTimestamp = item?.published_at || item?.scheduled_for;
    const timestamp = Date.parse(rawTimestamp || "");
    if (
      !Number.isFinite(timestamp) ||
      timestamp < weekStart.getTime() ||
      timestamp >= weekEnd.getTime()
    ) {
      continue;
    }
    identities.add(
      text(item?.story_id || item?.id || item?.post_id) ||
        `${new Date(timestamp).toISOString()}|${text(item?.franchise)}`,
    );
  }
  const priorCommitmentCount = identities.size;
  return {
    week_start: weekStart.toISOString(),
    week_end: weekEnd.toISOString(),
    maximum_per_week: maximumPerWeek,
    prior_commitment_count: priorCommitmentCount,
    remaining_capacity: Math.max(
      0,
      maximumPerWeek - priorCommitmentCount,
    ),
  };
}

function parseStoryExtra(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function explicitStoryPitches(stories) {
  const pitches = [];
  const rejected = [];
  for (const story of array(stories)) {
    const extra = parseStoryExtra(story?._extra);
    if (
      !Object.prototype.hasOwnProperty.call(extra, "evergreen_pitch") ||
      !extra.evergreen_pitch ||
      typeof extra.evergreen_pitch !== "object" ||
      Array.isArray(extra.evergreen_pitch)
    ) {
      rejected.push({
        origin: {
          kind: "story",
          id: text(story?.id),
        },
        blockers: ["evergreen_pitch_missing"],
      });
      continue;
    }
    pitches.push({
      origin: {
        kind: "story_extra",
        id: text(story?.id),
        field: "_extra.evergreen_pitch",
      },
      candidate: clone(extra.evergreen_pitch),
    });
  }
  return { pitches, rejected };
}

function explicitManifestPitches(manifests) {
  const pitches = [];
  const rejected = [];
  for (const manifest of array(manifests)) {
    if (
      !Object.prototype.hasOwnProperty.call(manifest || {}, "evergreen_pitch") ||
      !manifest.evergreen_pitch ||
      typeof manifest.evergreen_pitch !== "object" ||
      Array.isArray(manifest.evergreen_pitch)
    ) {
      rejected.push({
        origin: {
          kind: "manifest",
          id: text(manifest?.manifest_id || manifest?.id),
        },
        blockers: ["evergreen_pitch_missing"],
      });
      continue;
    }
    pitches.push({
      origin: {
        kind: "manifest",
        id: text(manifest?.manifest_id || manifest?.id),
        field: "evergreen_pitch",
      },
      candidate: clone(manifest.evergreen_pitch),
    });
  }
  return { pitches, rejected };
}

function buildEvergreenVerdictCandidateReport({
  manifests = [],
  stories = [],
  history = [],
  policy,
  now = new Date().toISOString(),
} = {}) {
  const generatedAt = new Date(now);
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error("evergreen_candidate_report_time_invalid");
  }
  const storyEntries = explicitStoryPitches(stories);
  const manifestEntries = explicitManifestPitches(manifests);
  const explicitEntries = [
    ...manifestEntries.pitches,
    ...storyEntries.pitches,
  ];
  const candidates = explicitEntries.map((entry) => ({
    ...entry,
    assessment: assessEvergreenVerdictCandidate(entry.candidate, {
      history,
      now: generatedAt.toISOString(),
      policy,
    }),
  }));
  const weeklyRotation = weeklyRotationState({
    history,
    now: generatedAt.toISOString(),
    policy,
  });
  const effectivePolicy = {
    ...(policy || {}),
    maximum_per_week: weeklyRotation.remaining_capacity,
  };
  const rotation = buildEvergreenVerdictRotation({
    candidates: candidates.map((entry) => entry.candidate),
    history,
    now: generatedAt.toISOString(),
    policy: effectivePolicy,
  });
  const selectedIds = new Set(
    rotation.selected.map((entry) => text(entry.id)),
  );
  const selectedCandidates = candidates.filter((entry) =>
    selectedIds.has(text(entry.candidate?.id)),
  );
  const weeklyRotationReport = {
    ...weeklyRotation,
    selected_candidate_count: rotation.selected.length,
    remaining_after_selection: Math.max(
      0,
      weeklyRotation.remaining_capacity - rotation.selected.length,
    ),
  };

  return {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt.toISOString(),
    mode: MODE,
    format_id: FORMAT_ID,
    summary: {
      manifest_input_count: array(manifests).length,
      story_input_count: array(stories).length,
      explicit_pitch_count: candidates.length,
      ready_candidate_count: candidates.filter(
        (entry) => entry.assessment.verdict === "READY_FOR_PRODUCTION",
      ).length,
      selected_candidate_count: rotation.selected.length,
    },
    candidates,
    selected_candidates: selectedCandidates,
    rejected_inputs: [
      ...manifestEntries.rejected,
      ...storyEntries.rejected,
    ],
    weekly_rotation: weeklyRotationReport,
    rotation,
    provenance_contract: {
      accepted_pitch_paths: [
        "manifest.evergreen_pitch",
        "story._extra.evergreen_pitch",
      ],
      surrounding_story_fields_used: false,
      claims_synthesised: false,
      rights_synthesised: false,
    },
    safety: {
      planning_only: true,
      claims_or_rights_invented: false,
      scheduler_authority_created: false,
      dispatch_enabled: false,
      no_publish_triggered: true,
    },
  };
}

function renderEvergreenVerdictCandidateReportMarkdown(report = {}) {
  const rotation = report.rotation || {};
  const weekly = report.weekly_rotation || {};
  const selected = array(rotation.selected);
  const deferred = array(rotation.deferred);
  const rejected = array(report.rejected_inputs);
  const remainingAfterSelection = Number(
    weekly.remaining_after_selection || 0,
  );
  const lines = [
    "# Pulse Gaming Evergreen Candidate Report",
    "",
    `Generated: ${text(report.generated_at)}`,
    `Mode: ${text(report.mode)}`,
    `Explicit pitches assessed: ${array(report.candidates).length}`,
    `Selected: ${selected.length}`,
    `Deferred or blocked: ${deferred.length}`,
    `Rejected inputs: ${rejected.length}`,
    `Weekly capacity: ${remainingAfterSelection} of ${Number(
      weekly.maximum_per_week || 0,
    )} remaining`,
    "",
    "## Selected candidates",
    "",
  ];
  if (!selected.length) lines.push("- None");
  for (const item of selected) {
    lines.push(
      `- ${text(item.title)} (${text(item.format_shape)}, score ${Number(
        item.score || 0,
      )})`,
    );
  }
  lines.push("", "## Deferred or blocked candidates", "");
  if (!deferred.length) lines.push("- None");
  for (const item of deferred) {
    lines.push(
      `- ${text(item.title) || text(item.id)}: ${
        array(item.blockers).join(", ") || "deferred"
      }`,
    );
  }
  lines.push("", "## Rejected inputs", "");
  if (!rejected.length) lines.push("- None");
  for (const item of rejected) {
    lines.push(
      `- ${text(item?.origin?.kind)} ${text(item?.origin?.id) || "(no id)"}: ${
        array(item.blockers).join(", ") || "rejected"
      }`,
    );
  }
  lines.push(
    "",
    "This LOCAL_PROOF report does not create scheduler authority or publish externally.",
    "",
  );
  return lines.join("\n");
}

module.exports = {
  MODE,
  SCHEMA_VERSION,
  buildEvergreenVerdictCandidateReport,
  renderEvergreenVerdictCandidateReportMarkdown,
};
