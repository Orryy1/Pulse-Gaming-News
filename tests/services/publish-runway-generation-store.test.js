"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const fs = require("fs-extra");

const {
  COMMIT_FILENAME,
  MANIFEST_FILENAME,
  createPublishRunwayGenerationStore,
} = require("../../lib/ops/publish-runway-generation-store");

const MORNING_WINDOW = "publish_morning_2026-07-17";
const AFTERNOON_WINDOW = "publish_afternoon_2026-07-17";

async function fixture(t) {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-publish-runway-generations-"),
  );
  t.after(() => fs.remove(rootDir));
  return {
    rootDir,
    store: createPublishRunwayGenerationStore({ rootDir }),
  };
}

function generationFiles(label) {
  return {
    "candidate-evidence.json": {
      generation: label,
      candidates: [{ story_id: `${label}-story` }],
    },
    "proof/executor-evidence.json": {
      generation: label,
      handoff_ready_actions: [
        {
          story_id: `${label}-story`,
          platform: "youtube_shorts",
        },
      ],
    },
  };
}

async function createGeneration(
  store,
  {
    generationId,
    windowId = MORNING_WINDOW,
    generatedAt,
    files = generationFiles(generationId),
  },
) {
  const staged = await store.stageGeneration({
    generationId,
    windowId,
    generatedAt,
    files,
  });
  return store.commitGeneration(staged);
}

test("staging stays invisible and commits atomically on the store volume into an immutable generation", async (t) => {
  const { rootDir, store } = await fixture(t);
  const generationId = "runway-2026-07-17-morning-001";
  const staged = await store.stageGeneration({
    generationId,
    windowId: MORNING_WINDOW,
    generatedAt: "2026-07-17T07:20:00.000Z",
    files: generationFiles("first"),
  });

  assert.equal(
    path.relative(rootDir, staged.staging_path).split(path.sep)[0],
    ".staging",
  );
  assert.equal(await fs.pathExists(staged.generation_path), false);
  assert.deepEqual(await store.listCommittedGenerations(), []);
  assert.equal(
    await store.selectNewestValidGeneration({ windowId: MORNING_WINDOW }),
    null,
  );

  const committed = await store.commitGeneration(staged);

  assert.equal(await fs.pathExists(staged.staging_path), false);
  assert.equal(await fs.pathExists(committed.generation_path), true);
  assert.equal(
    path.parse(staged.staging_path).root.toLowerCase(),
    path.parse(committed.generation_path).root.toLowerCase(),
  );
  assert.equal(committed.commit_method, "same_volume_atomic_rename");
  assert.deepEqual(await store.listCommittedGenerations(), [generationId]);

  const duplicate = await store.stageGeneration({
    generationId,
    windowId: MORNING_WINDOW,
    generatedAt: "2026-07-17T07:21:00.000Z",
    files: generationFiles("replacement"),
  });
  await assert.rejects(
    store.commitGeneration(duplicate),
    (error) => error.code === "GENERATION_ALREADY_EXISTS",
  );

  const original = await fs.readJson(
    path.join(committed.generation_path, "candidate-evidence.json"),
  );
  assert.equal(original.generation, "first");
});

test("committed generations carry and verify a SHA-256-bound manifest", async (t) => {
  const { store } = await fixture(t);
  const committed = await createGeneration(store, {
    generationId: "runway-2026-07-17-morning-002",
    generatedAt: "2026-07-17T07:30:00.000Z",
  });
  const manifestPath = path.join(committed.generation_path, MANIFEST_FILENAME);
  const commitPath = path.join(committed.generation_path, COMMIT_FILENAME);
  const manifestBytes = await fs.readFile(manifestPath);
  const commitRecord = await fs.readJson(commitPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const expectedManifestSha256 = crypto
    .createHash("sha256")
    .update(manifestBytes)
    .digest("hex");

  assert.equal(commitRecord.manifest_sha256, expectedManifestSha256);
  assert.equal(committed.manifest_sha256, expectedManifestSha256);
  assert.equal(manifest.generation_id, committed.generation_id);
  assert.equal(manifest.window_id, MORNING_WINDOW);
  assert.deepEqual(
    manifest.files.map((file) => file.path),
    ["candidate-evidence.json", "proof/executor-evidence.json"],
  );
  assert.ok(
    manifest.files.every(
      (file) =>
        /^[a-f0-9]{64}$/.test(file.sha256) &&
        Number.isSafeInteger(file.size_bytes) &&
        file.size_bytes > 0,
    ),
  );

  const verified = await store.verifyGeneration({
    generationId: committed.generation_id,
    expectedWindowId: MORNING_WINDOW,
  });
  assert.equal(verified.valid, true);
  assert.equal(verified.manifest_sha256, expectedManifestSha256);
});

test("verification and selection reject payload or manifest tampering", async (t) => {
  const { store } = await fixture(t);
  const payloadTampered = await createGeneration(store, {
    generationId: "runway-2026-07-17-morning-payload-tamper",
    generatedAt: "2026-07-17T07:40:00.000Z",
  });
  await fs.writeJson(
    path.join(payloadTampered.generation_path, "candidate-evidence.json"),
    { candidates: [{ story_id: "substituted-story" }] },
  );

  await assert.rejects(
    store.verifyGeneration({
      generationId: payloadTampered.generation_id,
      expectedWindowId: MORNING_WINDOW,
    }),
    (error) => error.code === "GENERATION_FILE_SHA256_MISMATCH",
  );
  assert.equal(
    await store.selectNewestValidGeneration({ windowId: MORNING_WINDOW }),
    null,
  );

  const manifestTampered = await createGeneration(store, {
    generationId: "runway-2026-07-17-morning-manifest-tamper",
    generatedAt: "2026-07-17T07:41:00.000Z",
  });
  const manifestPath = path.join(
    manifestTampered.generation_path,
    MANIFEST_FILENAME,
  );
  const manifest = await fs.readJson(manifestPath);
  manifest.window_id = AFTERNOON_WINDOW;
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });

  await assert.rejects(
    store.verifyGeneration({
      generationId: manifestTampered.generation_id,
      expectedWindowId: MORNING_WINDOW,
    }),
    (error) => error.code === "GENERATION_MANIFEST_SHA256_MISMATCH",
  );
});

test("a generation is rejected when its manifest belongs to another publish window", async (t) => {
  const { store } = await fixture(t);
  const committed = await createGeneration(store, {
    generationId: "runway-2026-07-17-afternoon-001",
    windowId: AFTERNOON_WINDOW,
    generatedAt: "2026-07-17T11:30:00.000Z",
  });

  await assert.rejects(
    store.verifyGeneration({
      generationId: committed.generation_id,
      expectedWindowId: MORNING_WINDOW,
    }),
    (error) => error.code === "GENERATION_WINDOW_MISMATCH",
  );
  await assert.rejects(
    store.lockGenerationAtT90({
      windowId: MORNING_WINDOW,
      generationId: committed.generation_id,
      lockedAt: "2026-07-17T07:30:00.000Z",
    }),
    (error) => error.code === "GENERATION_WINDOW_MISMATCH",
  );
});

test("selection returns the newest valid generation for exactly one window", async (t) => {
  const { store } = await fixture(t);
  await createGeneration(store, {
    generationId: "runway-morning-old",
    generatedAt: "2026-07-17T07:00:00.000Z",
  });
  const expected = await createGeneration(store, {
    generationId: "runway-morning-newest-valid",
    generatedAt: "2026-07-17T07:20:00.000Z",
  });
  const tampered = await createGeneration(store, {
    generationId: "runway-morning-newest-tampered",
    generatedAt: "2026-07-17T07:25:00.000Z",
  });
  await fs.appendFile(
    path.join(tampered.generation_path, "candidate-evidence.json"),
    "\n",
  );
  await createGeneration(store, {
    generationId: "runway-afternoon-newer",
    windowId: AFTERNOON_WINDOW,
    generatedAt: "2026-07-17T11:40:00.000Z",
  });

  const selected = await store.selectNewestValidGeneration({
    windowId: MORNING_WINDOW,
  });

  assert.equal(selected.generation_id, expected.generation_id);
  assert.equal(selected.window_id, MORNING_WINDOW);
  assert.equal(selected.generated_at, "2026-07-17T07:20:00.000Z");
});

test("the T-90 generation lock is exclusive and cannot be overwritten", async (t) => {
  const { store } = await fixture(t);
  const first = await createGeneration(store, {
    generationId: "runway-lock-contender-a",
    generatedAt: "2026-07-17T07:10:00.000Z",
  });
  const second = await createGeneration(store, {
    generationId: "runway-lock-contender-b",
    generatedAt: "2026-07-17T07:20:00.000Z",
  });

  const attempts = await Promise.allSettled([
    store.lockGenerationAtT90({
      windowId: MORNING_WINDOW,
      generationId: first.generation_id,
      lockedAt: "2026-07-17T07:30:00.000Z",
    }),
    store.lockGenerationAtT90({
      windowId: MORNING_WINDOW,
      generationId: second.generation_id,
      lockedAt: "2026-07-17T07:30:00.000Z",
    }),
  ]);
  const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");
  const rejected = attempts.filter((attempt) => attempt.status === "rejected");

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "T90_GENERATION_LOCK_EXISTS");

  const persisted = await fs.readJson(fulfilled[0].value.lock_path);
  assert.equal(persisted.generation_id, fulfilled[0].value.generation_id);
  assert.equal(persisted.window_id, MORNING_WINDOW);
  await assert.rejects(
    store.lockGenerationAtT90({
      windowId: MORNING_WINDOW,
      generationId: fulfilled[0].value.generation_id,
      lockedAt: "2026-07-17T07:31:00.000Z",
    }),
    (error) => error.code === "T90_GENERATION_LOCK_EXISTS",
  );
  assert.deepEqual(
    await fs.readJson(fulfilled[0].value.lock_path),
    persisted,
  );
});

test("T0 resolves exactly the generation pinned at T-90 even after a newer commit", async (t) => {
  const { store } = await fixture(t);
  const lockedGeneration = await createGeneration(store, {
    generationId: "runway-locked-at-t90",
    generatedAt: "2026-07-17T07:20:00.000Z",
  });
  const lock = await store.lockGenerationAtT90({
    windowId: MORNING_WINDOW,
    lockedAt: "2026-07-17T07:30:00.000Z",
  });
  assert.equal(lock.generation_id, lockedGeneration.generation_id);

  const laterGeneration = await createGeneration(store, {
    generationId: "runway-created-after-t90",
    generatedAt: "2026-07-17T08:50:00.000Z",
  });
  const newest = await store.selectNewestValidGeneration({
    windowId: MORNING_WINDOW,
  });
  assert.equal(newest.generation_id, laterGeneration.generation_id);

  const resolved = await store.resolveGenerationAtT0({
    windowId: MORNING_WINDOW,
  });
  assert.equal(resolved.generation_id, lockedGeneration.generation_id);
  assert.equal(resolved.manifest_sha256, lock.manifest_sha256);
  assert.equal(resolved.t90_lock.generation_id, lockedGeneration.generation_id);
});
