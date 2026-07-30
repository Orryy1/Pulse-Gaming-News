const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const { runMigrations } = require("../../lib/migrate");
const { pickCandidates } = require("../../lib/decision-engine");

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function insertStory(db, { id, createdAt, updatedAt }) {
  db.prepare(
    `INSERT INTO stories (
       id,
       title,
       timestamp,
       created_at,
       updated_at,
       approved,
       auto_approved
     ) VALUES (?, ?, ?, ?, ?, 0, 0)`,
  ).run(id, `Story ${id}`, createdAt, createdAt, updatedAt);
}

function insertAutoScore(db, { storyId, scoredAt }) {
  db.prepare(
    `INSERT INTO story_scores (
       story_id,
       total,
       decision,
       scored_at
     ) VALUES (?, 90, 'auto', ?)`,
  ).run(storyId, scoredAt);
}

function insertScore(db, { storyId, scoredAt, decision }) {
  db.prepare(
    `INSERT INTO story_scores (
       story_id,
       total,
       decision,
       scored_at
     ) VALUES (?, 90, ?, ?)`,
  ).run(storyId, decision, scoredAt);
}

test("a deapproved story changed after its latest auto score is immediately eligible for rescoring", () => {
  const db = new Database(":memory:");
  runMigrations(db, { log: () => {} });
  try {
    const now = Date.now();
    const createdAt = iso(now - 30 * 60_000);
    const scoredAt = iso(now - 2 * 60_000);
    insertStory(db, {
      id: "repaired-after-score",
      createdAt,
      updatedAt: iso(now - 60_000),
    });
    insertAutoScore(db, {
      storyId: "repaired-after-score",
      scoredAt,
    });

    const candidates = pickCandidates({ db });

    assert.deepEqual(
      candidates.map((candidate) => candidate.id),
      ["repaired-after-score"],
    );
  } finally {
    db.close();
  }
});

test("an unchanged deapproved story with a recent auto score remains rate limited", () => {
  const db = new Database(":memory:");
  runMigrations(db, { log: () => {} });
  try {
    const now = Date.now();
    const createdAt = iso(now - 30 * 60_000);
    const scoredAt = iso(now - 60_000);
    insertStory(db, {
      id: "unchanged-after-score",
      createdAt,
      updatedAt: iso(now - 2 * 60_000),
    });
    insertAutoScore(db, {
      storyId: "unchanged-after-score",
      scoredAt,
    });

    assert.deepEqual(pickCandidates({ db }), []);
  } finally {
    db.close();
  }
});

test("candidate selection uses the last score id when multiple decisions share one timestamp", () => {
  const db = new Database(":memory:");
  runMigrations(db, { log: () => {} });
  try {
    const now = Date.now();
    const createdAt = iso(now - 30 * 60_000);
    const scoredAt = iso(now - 60_000);
    insertStory(db, {
      id: "same-second-latest-review",
      createdAt,
      updatedAt: iso(now - 2 * 60_000),
    });
    insertScore(db, {
      storyId: "same-second-latest-review",
      scoredAt,
      decision: "auto",
    });
    insertScore(db, {
      storyId: "same-second-latest-review",
      scoredAt,
      decision: "review",
    });

    assert.deepEqual(
      pickCandidates({ db }).map((candidate) => candidate.id),
      ["same-second-latest-review"],
    );
  } finally {
    db.close();
  }
});
