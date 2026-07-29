"use strict";

const crypto = require("node:crypto");

const MATRIX_VERSION = "pulse-controlled-12-v1";
const ASSIGNMENT_POLICY = "observed-cell-match-v1";
const CREATIVE_MANIFEST_FIELDS = Object.freeze([
  "runtime_seconds",
  "hook_type",
  "narrator_version",
  "first_frame_text",
  "motion_ratio",
  "topic",
  "game",
  "platform",
  "source_type",
  "consequence_lane",
  "runtime_commit_sha",
  "renderer_version",
  "qa_result",
  "published_at",
]);

const LANE_DURATIONS = Object.freeze([
  Object.freeze({
    editorialLane: "what_changes_for_players",
    short: Object.freeze([25, 32]),
    standard: Object.freeze([35, 42]),
  }),
  Object.freeze({
    editorialLane: "trailer_truth_check",
    short: Object.freeze([28, 35]),
    standard: Object.freeze([38, 48]),
  }),
  Object.freeze({
    editorialLane: "platform_pulse",
    short: Object.freeze([30, 36]),
    standard: Object.freeze([42, 50]),
  }),
]);

const EXPERIMENT_MATRIX = Object.freeze(
  LANE_DURATIONS.flatMap((lane) =>
    ["direct", "open_loop"].flatMap((hookType) =>
      ["short", "standard"].map((durationBand) => {
        const [runtimeMinSeconds, runtimeMaxSeconds] = lane[durationBand];
        return Object.freeze({
          editorialLane: lane.editorialLane,
          hookType,
          durationBand,
          runtimeMinSeconds,
          runtimeMaxSeconds,
        });
      }),
    ),
  ).map((cell, index) =>
    Object.freeze({
      ...cell,
      ordinal: index + 1,
      cellKey: [
        laneKey(cell.editorialLane),
        cell.hookType,
        cell.durationBand,
      ].join(":"),
    }),
  ),
);

function laneKey(value) {
  return String(value || "").trim();
}

function requireText(value, code) {
  const result = String(value || "").trim();
  if (!result) throw new Error(code);
  return result;
}

function requireTimestamp(value, code) {
  const result = new Date(value);
  if (!value || Number.isNaN(result.getTime())) throw new Error(code);
  return result.toISOString();
}

function requireObservedNumber(value, field, { min, max } = {}) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (min !== undefined && value < min) ||
    (max !== undefined && value > max)
  ) {
    throw new Error(`controlled_experiment_creative_manifest_invalid:${field}`);
  }
  return value;
}

function requireObservedText(value, field) {
  if (value === null || value === undefined || value === "") {
    throw new Error(
      `controlled_experiment_creative_manifest_missing:${field}`,
    );
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `controlled_experiment_creative_manifest_invalid:${field}`,
    );
  }
  return value.trim();
}

function requireObservedTimestamp(value, field) {
  if (value === null || value === undefined || value === "") {
    throw new Error(
      `controlled_experiment_creative_manifest_missing:${field}`,
    );
  }
  if (typeof value !== "string") {
    throw new Error(
      `controlled_experiment_creative_manifest_invalid:${field}`,
    );
  }
  return requireTimestamp(
    value,
    `controlled_experiment_creative_manifest_invalid:${field}`,
  );
}

function normaliseCreativeManifest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("controlled_experiment_creative_manifest_required");
  }
  const unknownFields = Object.keys(input).filter(
    (field) => !CREATIVE_MANIFEST_FIELDS.includes(field),
  );
  if (unknownFields.length > 0) {
    throw new Error(
      `controlled_experiment_creative_manifest_unknown:${unknownFields.sort().join(",")}`,
    );
  }
  const manifest = {
    runtime_seconds: requireObservedNumber(
      input.runtime_seconds,
      "runtime_seconds",
      { min: Number.EPSILON },
    ),
    hook_type: requireObservedText(
      input.hook_type,
      "hook_type",
    ),
    narrator_version: requireObservedText(
      input.narrator_version,
      "narrator_version",
    ),
    first_frame_text: requireObservedText(
      input.first_frame_text,
      "first_frame_text",
    ),
    motion_ratio: requireObservedNumber(input.motion_ratio, "motion_ratio", {
      min: 0,
      max: 1,
    }),
    topic: requireObservedText(
      input.topic,
      "topic",
    ),
    game: requireObservedText(
      input.game,
      "game",
    ),
    platform: requireObservedText(
      input.platform,
      "platform",
    ),
    source_type: requireObservedText(
      input.source_type,
      "source_type",
    ),
    consequence_lane: requireObservedText(
      input.consequence_lane,
      "consequence_lane",
    ),
    runtime_commit_sha: requireObservedText(
      input.runtime_commit_sha,
      "runtime_commit_sha",
    ).toLowerCase(),
    renderer_version: requireObservedText(
      input.renderer_version,
      "renderer_version",
    ),
    qa_result: requireObservedText(
      input.qa_result,
      "qa_result",
    ),
    published_at: requireObservedTimestamp(
      input.published_at,
      "published_at",
    ),
  };
  if (!/^[a-f0-9]{7,64}$/.test(manifest.runtime_commit_sha)) {
    throw new Error(
      "controlled_experiment_creative_manifest_invalid:runtime_commit_sha",
    );
  }
  if (!["direct", "open_loop"].includes(manifest.hook_type)) {
    throw new Error(
      "controlled_experiment_creative_manifest_invalid:hook_type",
    );
  }
  if (manifest.qa_result !== "pass") {
    throw new Error(
      "controlled_experiment_creative_manifest_invalid:qa_result",
    );
  }
  const json = JSON.stringify(manifest);
  return Object.freeze({
    json,
    manifest: Object.freeze(manifest),
    sha256: crypto.createHash("sha256").update(json).digest("hex"),
  });
}

function requireRuntimeInsideCell(creativeEvidence, cell) {
  const runtime = creativeEvidence.manifest.runtime_seconds;
  if (
    runtime < Number(cell.runtime_min_seconds) ||
    runtime > Number(cell.runtime_max_seconds)
  ) {
    throw new Error(
      "controlled_experiment_creative_manifest_runtime_outside_cell",
    );
  }
  if (
    creativeEvidence.manifest.consequence_lane !==
    String(cell.editorial_lane || "").trim()
  ) {
    throw new Error(
      "controlled_experiment_creative_manifest_lane_mismatch",
    );
  }
  if (
    creativeEvidence.manifest.hook_type !==
    String(cell.hook_type || "").trim()
  ) {
    throw new Error(
      "controlled_experiment_creative_manifest_hook_mismatch",
    );
  }
}

function bind(db) {
  if (!db || typeof db.prepare !== "function") {
    throw new Error("controlled_experiment_database_required");
  }
  const getExperiment = db.prepare(`
    SELECT *
    FROM controlled_video_experiments
    WHERE experiment_id = ?
  `);
  const insertExperiment = db.prepare(`
    INSERT INTO controlled_video_experiments
      (experiment_id, channel_id, matrix_version, assignment_policy)
    VALUES (?, ?, ?, ?)
  `);
  const insertCell = db.prepare(`
    INSERT INTO controlled_video_experiment_cells
      (experiment_id, channel_id, ordinal, cell_key, editorial_lane,
       hook_type, duration_band, runtime_min_seconds, runtime_max_seconds)
    VALUES
      (@experimentId, @channelId, @ordinal, @cellKey, @editorialLane,
       @hookType, @durationBand, @runtimeMinSeconds, @runtimeMaxSeconds)
  `);
  const listCellsStatement = db.prepare(`
    SELECT *
    FROM controlled_video_experiment_cells
    WHERE experiment_id = ?
    ORDER BY ordinal
  `);
  const getAssignmentStatement = db.prepare(`
    SELECT *
    FROM controlled_video_experiment_cells
    WHERE experiment_id = ? AND channel_id = ? AND video_id = ?
  `);
  const getAssignmentByChannelVideo = db.prepare(`
    SELECT *
    FROM controlled_video_experiment_cells
    WHERE channel_id = ? AND video_id = ?
  `);
  const getCellsByLaneAndHook = db.prepare(`
    SELECT *
    FROM controlled_video_experiment_cells
    WHERE experiment_id = ?
      AND channel_id = ?
      AND editorial_lane = ?
      AND hook_type = ?
    ORDER BY ordinal
  `);
  const countUnassignedCells = db.prepare(`
    SELECT COUNT(*) AS count
    FROM controlled_video_experiment_cells
    WHERE experiment_id = ?
      AND channel_id = ?
      AND story_id IS NULL
      AND video_id IS NULL
  `);
  const assignCell = db.prepare(`
    UPDATE controlled_video_experiment_cells
    SET story_id = ?, video_id = ?, assigned_at = ?,
        creative_manifest_json = ?, creative_manifest_sha256 = ?
    WHERE id = ? AND story_id IS NULL AND video_id IS NULL
  `);
  const getCellById = db.prepare(`
    SELECT *
    FROM controlled_video_experiment_cells
    WHERE id = ?
  `);
  const storyExists = db.prepare("SELECT id FROM stories WHERE id = ?");

  const ensureExperimentTransaction = db.transaction(
    ({ experimentId, channelId }) => {
      const normalisedExperimentId = requireText(
        experimentId,
        "controlled_experiment_id_required",
      );
      const normalisedChannelId = requireText(
        channelId,
        "controlled_experiment_channel_id_required",
      );
      const existing = getExperiment.get(normalisedExperimentId);
      if (existing) {
        if (
          existing.channel_id !== normalisedChannelId ||
          existing.matrix_version !== MATRIX_VERSION ||
          existing.assignment_policy !== ASSIGNMENT_POLICY
        ) {
          throw new Error("controlled_experiment_identity_conflict");
        }
        const cells = listCellsStatement.all(normalisedExperimentId);
        if (cells.length !== EXPERIMENT_MATRIX.length) {
          throw new Error("controlled_experiment_ledger_incomplete");
        }
        return existing;
      }

      insertExperiment.run(
        normalisedExperimentId,
        normalisedChannelId,
        MATRIX_VERSION,
        ASSIGNMENT_POLICY,
      );
      for (const cell of EXPERIMENT_MATRIX) {
        insertCell.run({
          experimentId: normalisedExperimentId,
          channelId: normalisedChannelId,
          ...cell,
        });
      }
      return getExperiment.get(normalisedExperimentId);
    },
  );
  const assignNextVideoTransaction = db.transaction(
    ({
      experimentId,
      channelId,
      storyId,
      videoId,
      assignedAt,
      creativeManifest,
    }) => {
      const normalisedExperimentId = requireText(
        experimentId,
        "controlled_experiment_id_required",
      );
      const normalisedChannelId = requireText(
        channelId,
        "controlled_experiment_channel_id_required",
      );
      const normalisedStoryId = requireText(
        storyId,
        "controlled_experiment_story_id_required",
      );
      const normalisedVideoId = requireText(
        videoId,
        "controlled_experiment_video_id_required",
      );
      const normalisedAssignedAt = requireTimestamp(
        assignedAt,
        "controlled_experiment_assigned_at_required",
      );
      const creativeEvidence = normaliseCreativeManifest(creativeManifest);
      const experiment = getExperiment.get(normalisedExperimentId);
      if (!experiment || experiment.channel_id !== normalisedChannelId) {
        throw new Error("controlled_experiment_identity_not_found");
      }
      if (!storyExists.get(normalisedStoryId)) {
        throw new Error("controlled_experiment_story_not_found");
      }
      const existing = getAssignmentByChannelVideo.get(
        normalisedChannelId,
        normalisedVideoId,
      );
      if (existing) {
        requireRuntimeInsideCell(creativeEvidence, existing);
        if (
          existing.experiment_id !== normalisedExperimentId ||
          existing.story_id !== normalisedStoryId ||
          existing.assigned_at !== normalisedAssignedAt ||
          existing.creative_manifest_sha256 !== creativeEvidence.sha256
        ) {
          throw new Error("controlled_experiment_assignment_conflict");
        }
        return existing;
      }
      const matchingLaneHookCells = getCellsByLaneAndHook.all(
        normalisedExperimentId,
        normalisedChannelId,
        creativeEvidence.manifest.consequence_lane,
        creativeEvidence.manifest.hook_type,
      );
      if (matchingLaneHookCells.length === 0) {
        throw new Error(
          "controlled_experiment_creative_manifest_lane_mismatch",
        );
      }
      const matchingRuntimeCells = matchingLaneHookCells.filter(
        (cell) =>
          creativeEvidence.manifest.runtime_seconds >=
            Number(cell.runtime_min_seconds) &&
          creativeEvidence.manifest.runtime_seconds <=
            Number(cell.runtime_max_seconds),
      );
      if (matchingRuntimeCells.length !== 1) {
        throw new Error(
          "controlled_experiment_creative_manifest_runtime_outside_cell",
        );
      }
      const next = matchingRuntimeCells[0];
      requireRuntimeInsideCell(creativeEvidence, next);
      if (
        next.story_id !== null ||
        next.video_id !== null ||
        next.assigned_at !== null
      ) {
        const remaining = countUnassignedCells.get(
          normalisedExperimentId,
          normalisedChannelId,
        ).count;
        throw new Error(
          remaining === 0
            ? "controlled_experiment_matrix_full"
            : "controlled_experiment_cell_already_assigned",
        );
      }
      const result = assignCell.run(
        normalisedStoryId,
        normalisedVideoId,
        normalisedAssignedAt,
        creativeEvidence.json,
        creativeEvidence.sha256,
        next.id,
      );
      if (result.changes !== 1) {
        throw new Error("controlled_experiment_assignment_race");
      }
      return getCellById.get(next.id);
    },
  );

  return {
    assignNextVideo(input) {
      return assignNextVideoTransaction.immediate(input || {});
    },
    ensureExperiment(input) {
      return ensureExperimentTransaction(input || {});
    },
    getExperiment(experimentId) {
      return (
        getExperiment.get(
          requireText(experimentId, "controlled_experiment_id_required"),
        ) || null
      );
    },
    getAssignment({ experimentId, channelId, videoId } = {}) {
      return (
        getAssignmentStatement.get(
          requireText(experimentId, "controlled_experiment_id_required"),
          requireText(channelId, "controlled_experiment_channel_id_required"),
          requireText(videoId, "controlled_experiment_video_id_required"),
        ) || null
      );
    },
    listCells(experimentId) {
      return listCellsStatement.all(
        requireText(experimentId, "controlled_experiment_id_required"),
      );
    },
  };
}

module.exports = {
  ASSIGNMENT_POLICY,
  CREATIVE_MANIFEST_FIELDS,
  EXPERIMENT_MATRIX,
  MATRIX_VERSION,
  bind,
  normaliseCreativeManifest,
};
