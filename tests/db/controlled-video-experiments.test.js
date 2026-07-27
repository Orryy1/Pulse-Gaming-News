"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const {
  CREATIVE_MANIFEST_FIELDS,
  EXPERIMENT_MATRIX,
  bind: bindControlledExperiments,
} = require("../../lib/repositories/controlled_video_experiments");

const MIGRATIONS = path.resolve(__dirname, "..", "..", "db", "migrations");

function fixture() {
  const db = new Database(":memory:");
  for (const filename of fs
    .readdirSync(MIGRATIONS)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS, filename), "utf8"));
  }
  db.prepare("INSERT INTO channels (id, name) VALUES (?, ?)").run(
    "pulse-gaming",
    "Pulse Gaming",
  );
  return { db, experiments: bindControlledExperiments(db) };
}

function creativeManifest(overrides = {}) {
  return {
    runtime_seconds: 31.25,
    narrator_version: "elevenlabs-pulse-v3",
    first_frame_text: "GAME PASS JUST CHANGED",
    motion_ratio: 0.625,
    topic: "Game Pass catalogue update",
    game: "Fable",
    platform: "Xbox",
    source_type: "official_xbox_wire",
    consequence_lane: "what_changes_for_players",
    runtime_commit_sha: "a".repeat(40),
    renderer_version: "studio-v21.4.0",
    qa_result: "pass",
    published_at: "2026-07-27T11:58:00.000Z",
    ...overrides,
  };
}

test("experiment ledger persists the canonical 12-cell editorial matrix", () => {
  const { db, experiments } = fixture();

  experiments.ensureExperiment({
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
  });
  const cells = experiments.listCells("pulse-v1-controlled-12");

  assert.equal(cells.length, 12);
  assert.deepEqual(
    cells.map((cell) => [
      cell.ordinal,
      cell.editorial_lane,
      cell.hook_type,
      cell.duration_band,
      cell.runtime_min_seconds,
      cell.runtime_max_seconds,
    ]),
    [
      [1, "what_changes_for_players", "direct", "short", 25, 32],
      [2, "what_changes_for_players", "direct", "standard", 35, 42],
      [3, "what_changes_for_players", "open_loop", "short", 25, 32],
      [4, "what_changes_for_players", "open_loop", "standard", 35, 42],
      [5, "trailer_truth_check", "direct", "short", 28, 35],
      [6, "trailer_truth_check", "direct", "standard", 38, 48],
      [7, "trailer_truth_check", "open_loop", "short", 28, 35],
      [8, "trailer_truth_check", "open_loop", "standard", 38, 48],
      [9, "platform_pulse", "direct", "short", 30, 36],
      [10, "platform_pulse", "direct", "standard", 42, 50],
      [11, "platform_pulse", "open_loop", "short", 30, 36],
      [12, "platform_pulse", "open_loop", "standard", 42, 50],
    ],
  );
  assert.equal(new Set(cells.map((cell) => cell.cell_key)).size, 12);

  experiments.ensureExperiment({
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
  });
  assert.equal(
    experiments.listCells("pulse-v1-controlled-12").length,
    12,
  );
  db.close();
});

test("video assignment persists a canonical observed creative manifest and fingerprint", () => {
  const { db, experiments } = fixture();
  db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(
    "story-1",
    "Story one",
  );
  experiments.ensureExperiment({
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
  });
  const observed = creativeManifest();

  const assignment = experiments.assignNextVideo({
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
    storyId: "story-1",
    videoId: "youtube-video-1",
    assignedAt: "2026-07-27T12:00:00.000Z",
    creativeManifest: observed,
  });
  const retry = experiments.assignNextVideo({
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
    storyId: "story-1",
    videoId: "youtube-video-1",
    assignedAt: "2026-07-27T12:00:00.000Z",
    creativeManifest: Object.fromEntries(
      Object.entries(observed).reverse(),
    ),
  });

  assert.deepEqual(
    JSON.parse(assignment.creative_manifest_json),
    observed,
  );
  assert.equal(
    assignment.creative_manifest_sha256,
    crypto
      .createHash("sha256")
      .update(assignment.creative_manifest_json)
      .digest("hex"),
  );
  assert.equal(
    experiments.getAssignment({
      experimentId: "pulse-v1-controlled-12",
      channelId: "pulse-gaming",
      videoId: "youtube-video-1",
    }).creative_manifest_sha256,
    assignment.creative_manifest_sha256,
  );
  assert.equal(retry.id, assignment.id);
  assert.equal(
    retry.creative_manifest_sha256,
    assignment.creative_manifest_sha256,
  );
  assert.throws(
    () =>
      experiments.assignNextVideo({
        experimentId: "pulse-v1-controlled-12",
        channelId: "pulse-gaming",
        storyId: "story-1",
        videoId: "youtube-video-1",
        assignedAt: "2026-07-27T12:00:00.000Z",
        creativeManifest: creativeManifest({
          first_frame_text: "A DIFFERENT FIRST FRAME",
        }),
      }),
    /controlled_experiment_assignment_conflict/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          `UPDATE controlled_video_experiment_cells
           SET creative_manifest_json = ?
           WHERE id = ?`,
        )
        .run(JSON.stringify(creativeManifest()), assignment.id),
    /immutable_controlled_experiment_assignment/,
  );
  db.close();
});

test("experiment assignment fails closed when observed creative evidence is incomplete", () => {
  const { db, experiments } = fixture();
  db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(
    "story-1",
    "Story one",
  );
  experiments.ensureExperiment({
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
  });
  const assignment = {
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
    storyId: "story-1",
    videoId: "youtube-video-1",
    assignedAt: "2026-07-27T12:00:00.000Z",
  };

  assert.throws(
    () => experiments.assignNextVideo(assignment),
    /controlled_experiment_creative_manifest_required/,
  );
  for (const field of CREATIVE_MANIFEST_FIELDS) {
    const incomplete = creativeManifest();
    delete incomplete[field];
    assert.throws(
      () =>
        experiments.assignNextVideo({
          ...assignment,
          creativeManifest: incomplete,
        }),
      new RegExp(
        `controlled_experiment_creative_manifest_(?:missing|invalid):${field}`,
      ),
    );
  }
  assert.throws(
    () =>
      experiments.assignNextVideo({
        ...assignment,
        creativeManifest: creativeManifest({
          runtime_seconds: "31.25",
        }),
      }),
    /controlled_experiment_creative_manifest_invalid:runtime_seconds/,
  );
  assert.equal(
    experiments.listCells("pulse-v1-controlled-12")[0].video_id,
    null,
  );
  db.close();
});

test("creative evidence preserves observed types instead of coercing synthetic values", () => {
  const { db, experiments } = fixture();
  db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(
    "story-1",
    "Story one",
  );
  experiments.ensureExperiment({
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
  });

  assert.throws(
    () =>
      experiments.assignNextVideo({
        experimentId: "pulse-v1-controlled-12",
        channelId: "pulse-gaming",
        storyId: "story-1",
        videoId: "youtube-video-1",
        assignedAt: "2026-07-27T12:00:00.000Z",
        creativeManifest: creativeManifest({ narrator_version: 3 }),
      }),
    /controlled_experiment_creative_manifest_invalid:narrator_version/,
  );
  assert.equal(
    experiments.listCells("pulse-v1-controlled-12")[0].video_id,
    null,
  );
  db.close();
});

test("observed runtime must fit the assigned experiment duration cell", () => {
  const { db, experiments } = fixture();
  db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(
    "story-1",
    "Story one",
  );
  experiments.ensureExperiment({
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
  });

  assert.throws(
    () =>
      experiments.assignNextVideo({
        experimentId: "pulse-v1-controlled-12",
        channelId: "pulse-gaming",
        storyId: "story-1",
        videoId: "youtube-video-1",
        assignedAt: "2026-07-27T12:00:00.000Z",
        creativeManifest: creativeManifest({ runtime_seconds: 24.99 }),
      }),
    /controlled_experiment_creative_manifest_runtime_outside_cell/,
  );
  assert.equal(
    experiments.listCells("pulse-v1-controlled-12")[0].video_id,
    null,
  );
  db.close();
});

test("creative evidence must describe the assigned editorial lane and a passing QA result", () => {
  const { db, experiments } = fixture();
  db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(
    "story-1",
    "Story one",
  );
  experiments.ensureExperiment({
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
  });
  const assignment = {
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
    storyId: "story-1",
    videoId: "youtube-video-1",
    assignedAt: "2026-07-27T12:00:00.000Z",
  };

  assert.throws(
    () =>
      experiments.assignNextVideo({
        ...assignment,
        creativeManifest: creativeManifest({
          consequence_lane: "platform_pulse",
        }),
      }),
    /controlled_experiment_creative_manifest_lane_mismatch/,
  );
  assert.throws(
    () =>
      experiments.assignNextVideo({
        ...assignment,
        creativeManifest: creativeManifest({
          qa_result: "warning",
        }),
      }),
    /controlled_experiment_creative_manifest_invalid:qa_result/,
  );
  assert.equal(
    experiments.listCells("pulse-v1-controlled-12")[0].video_id,
    null,
  );
  db.close();
});

test("video assignment is deterministic, persisted and idempotent", () => {
  const { db, experiments } = fixture();
  db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(
    "story-1",
    "Story one",
  );
  db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(
    "story-2",
    "Story two",
  );
  experiments.ensureExperiment({
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
  });

  const first = experiments.assignNextVideo({
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
    storyId: "story-1",
    videoId: "youtube-video-1",
    assignedAt: "2026-07-27T12:00:00.000Z",
    creativeManifest: creativeManifest(),
  });
  const retry = experiments.assignNextVideo({
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
    storyId: "story-1",
    videoId: "youtube-video-1",
    assignedAt: "2026-07-27T12:00:00.000Z",
    creativeManifest: creativeManifest(),
  });
  const second = experiments.assignNextVideo({
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
    storyId: "story-2",
    videoId: "youtube-video-2",
    assignedAt: "2026-07-27T12:01:00.000Z",
    creativeManifest: creativeManifest({
      runtime_seconds: 38.5,
      published_at: "2026-07-27T11:59:00.000Z",
    }),
  });

  assert.equal(first.ordinal, 1);
  assert.equal(first.editorial_lane, "what_changes_for_players");
  assert.equal(first.hook_type, "direct");
  assert.equal(first.duration_band, "short");
  assert.equal(first.story_id, "story-1");
  assert.equal(first.video_id, "youtube-video-1");
  assert.equal(retry.id, first.id);
  assert.equal(second.ordinal, 2);
  assert.equal(
    experiments.getAssignment({
      experimentId: "pulse-v1-controlled-12",
      channelId: "pulse-gaming",
      videoId: "youtube-video-2",
    }).story_id,
    "story-2",
  );
  assert.equal(
    experiments
      .listCells("pulse-v1-controlled-12")
      .filter((cell) => cell.video_id).length,
    2,
  );
  db.close();
});

test("the controlled ledger accepts exactly one video per cell and then closes", () => {
  const { db, experiments } = fixture();
  for (let index = 1; index <= 13; index += 1) {
    db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(
      `story-${index}`,
      `Story ${index}`,
    );
  }
  experiments.ensureExperiment({
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
  });

  const assignments = [];
  for (let index = 1; index <= 12; index += 1) {
    const cell = EXPERIMENT_MATRIX[index - 1];
    assignments.push(
      experiments.assignNextVideo({
        experimentId: "pulse-v1-controlled-12",
        channelId: "pulse-gaming",
        storyId: `story-${index}`,
        videoId: `youtube-video-${index}`,
        assignedAt: `2026-07-27T12:00:${String(index).padStart(2, "0")}.000Z`,
        creativeManifest: creativeManifest({
          runtime_seconds:
            (cell.runtimeMinSeconds + cell.runtimeMaxSeconds) / 2,
          consequence_lane: cell.editorialLane,
          published_at: `2026-07-27T11:59:${String(index).padStart(2, "0")}.000Z`,
        }),
      }),
    );
  }

  assert.deepEqual(
    assignments.map((assignment) => assignment.ordinal),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  assert.equal(new Set(assignments.map((row) => row.cell_key)).size, 12);
  assert.throws(
    () =>
      experiments.assignNextVideo({
        experimentId: "pulse-v1-controlled-12",
        channelId: "pulse-gaming",
        storyId: "story-13",
        videoId: "youtube-video-13",
        assignedAt: "2026-07-27T12:00:13.000Z",
        creativeManifest: creativeManifest(),
      }),
    /controlled_experiment_matrix_full/,
  );
  assert.throws(
    () =>
      experiments.assignNextVideo({
        experimentId: "pulse-v1-controlled-12",
        channelId: "pulse-gaming",
        storyId: "story-13",
        videoId: "youtube-video-1",
        assignedAt: "2026-07-27T12:00:13.000Z",
        creativeManifest: creativeManifest(),
      }),
    /controlled_experiment_assignment_conflict/,
  );
  db.close();
});
