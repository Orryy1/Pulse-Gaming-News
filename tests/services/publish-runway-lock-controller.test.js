"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const fs = require("fs-extra");

const {
  createPublishRunwayLockController,
  resolvePublishWindow,
} = require("../../lib/ops/publish-runway-lock-controller");

async function fixture(t) {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-publish-runway-controller-"),
  );
  t.after(() => fs.remove(rootDir));
  return {
    rootDir,
    controller: createPublishRunwayLockController({
      rootDir,
      publishHoursUtc: [9],
      phaseToleranceMs: 0,
    }),
  };
}

function candidateFiles(storyId = "story-green") {
  return {
    "candidate-evidence.json": {
      verdict: "GREEN",
      candidates: [{ story_id: storyId, verdict: "GREEN" }],
    },
  };
}

test("window identity is stable and unambiguous across the Europe/London DST fallback", () => {
  const beforeFallback = resolvePublishWindow({
    at: new Date("2026-10-25T00:00:00.000Z"),
    phase: "T0",
    publishHoursUtc: [0, 1],
  });
  const afterFallback = resolvePublishWindow({
    at: new Date("2026-10-25T01:00:00.000Z"),
    phase: "T0",
    publishHoursUtc: [0, 1],
  });
  const repeat = resolvePublishWindow({
    at: new Date("2026-10-25T00:00:00.000Z"),
    phase: "T0",
    publishHoursUtc: [0, 1],
  });

  assert.equal(beforeFallback.local_scheduled_at, "2026-10-25T01:00:00+01:00");
  assert.equal(afterFallback.local_scheduled_at, "2026-10-25T01:00:00+00:00");
  assert.notEqual(beforeFallback.window_id, afterFallback.window_id);
  assert.deepEqual(beforeFallback, repeat);
  assert.match(
    beforeFallback.window_id,
    /^publish-europe-london-local-20261025T010000-plus0100-utc-20261025T000000Z$/,
  );
  assert.match(
    afterFallback.window_id,
    /^publish-europe-london-local-20261025T010000-plus0000-utc-20261025T010000Z$/,
  );
});

test("T-180 commits an immutable generation for the resolved window without publishing", async (t) => {
  const { rootDir, controller } = await fixture(t);

  const result = await controller.generateAtT180({
    at: new Date("2026-07-17T06:00:00.000Z"),
    generationId: "window-20260717-0900-generation-001",
    files: candidateFiles(),
  });

  assert.equal(result.verdict, "GREEN");
  assert.equal(result.phase, "T-180");
  assert.equal(result.can_publish, false);
  assert.equal(result.mutated_database, false);
  assert.equal(result.external_publish_attempted, false);
  assert.equal(result.window.scheduled_at, "2026-07-17T09:00:00.000Z");
  assert.equal(result.generation.generation_id, "window-20260717-0900-generation-001");
  assert.equal(result.reason_codes.length, 0);
  assert.equal(
    await fs.pathExists(
      path.join(
        rootDir,
        "generations",
        "window-20260717-0900-generation-001",
        "commit.json",
      ),
    ),
    true,
  );
});

test("T-90 returns explicit RED and creates no lock when no valid candidate generation exists", async (t) => {
  const { rootDir, controller } = await fixture(t);

  const result = await controller.lockAtT90({
    at: new Date("2026-07-17T07:30:00.000Z"),
  });

  assert.equal(result.verdict, "RED");
  assert.equal(result.phase, "T-90");
  assert.equal(result.can_publish, false);
  assert.equal(result.lock, null);
  assert.deepEqual(result.reason_codes, ["NO_VALID_GENERATION_FOR_WINDOW"]);
  assert.equal(result.error.code, "NO_VALID_GENERATION_FOR_WINDOW");
  assert.equal(result.external_publish_attempted, false);
  assert.equal(result.mutated_database, false);
  assert.deepEqual(await fs.readdir(path.join(rootDir, "locks")), []);
});

test("T0 resolves the exact T-90 generation and never falls forward to a newer generation", async (t) => {
  const { controller } = await fixture(t);
  const generated = await controller.generateAtT180({
    at: new Date("2026-07-17T06:00:00.000Z"),
    generationId: "locked-generation",
    files: candidateFiles("locked-story"),
  });
  const locked = await controller.lockAtT90({
    at: new Date("2026-07-17T07:30:00.000Z"),
  });
  assert.equal(locked.verdict, "GREEN");
  assert.equal(locked.generation.generation_id, "locked-generation");

  const stagedLater = await controller.store.stageGeneration({
    generationId: "newer-after-lock",
    windowId: generated.window.window_id,
    generatedAt: "2026-07-17T08:30:00.000Z",
    files: candidateFiles("later-story"),
  });
  await controller.store.commitGeneration(stagedLater, {
    committedAt: "2026-07-17T08:30:00.000Z",
  });
  const newest = await controller.store.selectNewestValidGeneration({
    windowId: generated.window.window_id,
  });
  assert.equal(newest.generation_id, "newer-after-lock");

  const resolved = await controller.resolveAtT0({
    at: new Date("2026-07-17T09:00:00.000Z"),
  });

  assert.equal(resolved.verdict, "GREEN");
  assert.equal(resolved.phase, "T0");
  assert.equal(resolved.generation.generation_id, "locked-generation");
  assert.equal(resolved.lock.generation_id, "locked-generation");
  assert.equal(
    resolved.generation.manifest_sha256,
    locked.generation.manifest_sha256,
  );
  assert.equal(resolved.external_publish_attempted, false);
});

test("T-90 rejects a valid but stale same-window generation before creating a lock", async (t) => {
  const { rootDir, controller } = await fixture(t);
  const window = resolvePublishWindow({
    at: new Date("2026-07-17T07:30:00.000Z"),
    phase: "T-90",
    publishHoursUtc: [9],
    phaseToleranceMs: 0,
  });
  const staged = await controller.store.stageGeneration({
    generationId: "stale-same-window-generation",
    windowId: window.window_id,
    generatedAt: "2026-07-17T05:59:59.999Z",
    files: candidateFiles(),
  });
  await controller.store.commitGeneration(staged, {
    committedAt: "2026-07-17T06:00:00.000Z",
  });

  const result = await controller.lockAtT90({
    at: new Date("2026-07-17T07:30:00.000Z"),
  });

  assert.equal(result.verdict, "RED");
  assert.deepEqual(result.reason_codes, ["GENERATION_OUTSIDE_RUNWAY_INTERVAL"]);
  assert.equal(result.lock, null);
  assert.deepEqual(await fs.readdir(path.join(rootDir, "locks")), []);
});

test("T0 returns RED for a tampered locked generation and does not fall forward", async (t) => {
  const { controller } = await fixture(t);
  const generated = await controller.generateAtT180({
    at: new Date("2026-07-17T06:00:00.000Z"),
    generationId: "generation-to-tamper",
    files: candidateFiles("original-story"),
  });
  const locked = await controller.lockAtT90({
    at: new Date("2026-07-17T07:30:00.000Z"),
  });
  assert.equal(locked.verdict, "GREEN");

  const stagedLater = await controller.store.stageGeneration({
    generationId: "clean-newer-generation",
    windowId: generated.window.window_id,
    generatedAt: "2026-07-17T08:00:00.000Z",
    files: candidateFiles("clean-newer-story"),
  });
  await controller.store.commitGeneration(stagedLater, {
    committedAt: "2026-07-17T08:00:00.000Z",
  });
  await fs.writeJson(
    path.join(
      generated.generation.generation_path,
      "candidate-evidence.json",
    ),
    {
      verdict: "GREEN",
      candidates: [{ story_id: "substituted-story", verdict: "GREEN" }],
    },
  );

  const result = await controller.resolveAtT0({
    at: new Date("2026-07-17T09:00:00.000Z"),
  });

  assert.equal(result.verdict, "RED");
  assert.equal(result.can_publish, false);
  assert.deepEqual(result.reason_codes, ["GENERATION_FILE_SHA256_MISMATCH"]);
  assert.equal(result.generation, null);
  assert.notEqual(result.generation?.generation_id, "clean-newer-generation");
});

test("repeated T0 resolution is an idempotent read and leaves lock evidence unchanged", async (t) => {
  const { controller } = await fixture(t);
  await controller.generateAtT180({
    at: new Date("2026-07-17T06:00:00.000Z"),
    generationId: "idempotent-read-generation",
    files: candidateFiles(),
  });
  const locked = await controller.lockAtT90({
    at: new Date("2026-07-17T07:30:00.000Z"),
  });
  const lockBytesBefore = await fs.readFile(locked.lock.lock_path);
  const lockStatBefore = await fs.stat(locked.lock.lock_path);

  const first = await controller.resolveAtT0({
    at: new Date("2026-07-17T09:00:00.000Z"),
  });
  const second = await controller.resolveAtT0({
    at: new Date("2026-07-17T09:00:00.000Z"),
  });
  const lockBytesAfter = await fs.readFile(locked.lock.lock_path);
  const lockStatAfter = await fs.stat(locked.lock.lock_path);

  assert.deepEqual(second, first);
  assert.deepEqual(lockBytesAfter, lockBytesBefore);
  assert.equal(lockStatAfter.mtimeMs, lockStatBefore.mtimeMs);
  assert.equal(first.idempotent, true);
  assert.equal(first.external_publish_attempted, false);
});

test("repeated T-90 locking reads the existing exclusive lock and ignores newer generations", async (t) => {
  const { controller } = await fixture(t);
  const generated = await controller.generateAtT180({
    at: new Date("2026-07-17T06:00:00.000Z"),
    generationId: "first-exclusive-generation",
    files: candidateFiles("first-story"),
  });
  const first = await controller.lockAtT90({
    at: new Date("2026-07-17T07:30:00.000Z"),
  });
  const lockBytesBefore = await fs.readFile(first.lock.lock_path);

  const stagedLater = await controller.store.stageGeneration({
    generationId: "later-unlocked-generation",
    windowId: generated.window.window_id,
    generatedAt: "2026-07-17T07:30:00.000Z",
    files: candidateFiles("later-story"),
  });
  await controller.store.commitGeneration(stagedLater, {
    committedAt: "2026-07-17T07:30:00.000Z",
  });

  const second = await controller.lockAtT90({
    at: new Date("2026-07-17T07:30:00.000Z"),
  });

  assert.equal(second.verdict, "GREEN");
  assert.equal(second.idempotent, true);
  assert.equal(second.lock.generation_id, "first-exclusive-generation");
  assert.equal(second.generation.generation_id, "first-exclusive-generation");
  assert.deepEqual(await fs.readFile(first.lock.lock_path), lockBytesBefore);
});

test("T-90 inspection returns machine-readable AMBER while a valid generation awaits locking", async (t) => {
  const { rootDir, controller } = await fixture(t);
  await controller.generateAtT180({
    at: new Date("2026-07-17T06:00:00.000Z"),
    generationId: "generation-awaiting-lock",
    files: candidateFiles(),
  });

  const result = await controller.inspectAtT90({
    at: new Date("2026-07-17T07:30:00.000Z"),
  });

  assert.equal(result.verdict, "AMBER");
  assert.equal(result.can_publish, false);
  assert.equal(result.idempotent, true);
  assert.equal(result.generation.generation_id, "generation-awaiting-lock");
  assert.equal(result.lock, null);
  assert.deepEqual(result.reason_codes, ["T90_LOCK_PENDING"]);
  assert.deepEqual(await fs.readdir(path.join(rootDir, "locks")), []);
});

test("T-90 rejects an explicitly requested generation from another publish window", async (t) => {
  const { rootDir, controller } = await fixture(t);
  const otherWindow = resolvePublishWindow({
    at: new Date("2026-07-17T10:00:00.000Z"),
    phase: "T0",
    publishHoursUtc: [10],
    phaseToleranceMs: 0,
  });
  const staged = await controller.store.stageGeneration({
    generationId: "different-window-generation",
    windowId: otherWindow.window_id,
    generatedAt: "2026-07-17T07:00:00.000Z",
    files: candidateFiles(),
  });
  await controller.store.commitGeneration(staged, {
    committedAt: "2026-07-17T07:00:00.000Z",
  });

  const result = await controller.lockAtT90({
    at: new Date("2026-07-17T07:30:00.000Z"),
    generationId: "different-window-generation",
  });

  assert.equal(result.verdict, "RED");
  assert.deepEqual(result.reason_codes, ["GENERATION_WINDOW_MISMATCH"]);
  assert.equal(result.lock, null);
  assert.deepEqual(await fs.readdir(path.join(rootDir, "locks")), []);
});

test("T-90 returns RED when a generation explicitly declares an empty candidate set", async (t) => {
  const { rootDir, controller } = await fixture(t);
  const generated = await controller.generateAtT180({
    at: new Date("2026-07-17T06:00:00.000Z"),
    generationId: "empty-candidate-generation",
    files: {
      "candidate-evidence.json": {
        verdict: "RED",
        candidates: [],
      },
    },
  });
  assert.equal(generated.verdict, "GREEN");

  const result = await controller.lockAtT90({
    at: new Date("2026-07-17T07:30:00.000Z"),
  });

  assert.equal(result.verdict, "RED");
  assert.deepEqual(result.reason_codes, ["NO_CANDIDATE_IN_GENERATION"]);
  assert.equal(result.lock, null);
  assert.deepEqual(await fs.readdir(path.join(rootDir, "locks")), []);
});
