const { test } = require("node:test");
const assert = require("node:assert");
const Database = require("better-sqlite3");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  recordSnapshot,
  listForStory,
  latestForStory,
  VALID_PLATFORMS,
} = require("../../lib/repositories/platform_metric_snapshots");

function newDb() {
  // In-memory DB — test isolation is automatic, no temp files to
  // clean up. Each test gets its own fresh schema.
  const db = new Database(":memory:");
  // Replicate migration 015 here so we don't reach into the real
  // migration runner (which would require initialising the full
  // lib/db stack).
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "db",
      "migrations",
      "015_platform_metric_snapshots.sql",
    ),
    "utf8",
  );
  db.exec(migration);
  return db;
}

// ---------- recordSnapshot ----------

test("recordSnapshot: happy path with every field populated", () => {
  const db = newDb();
  const id = recordSnapshot(db, {
    story_id: "s1",
    platform: "youtube",
    external_id: "yt_abc",
    views: 1234,
    likes: 56,
    comments: 7,
    shares: 8,
    watch_time_seconds: 42.5,
    retention_percent: 67.8,
    raw_json: { source: "youtube", snapshot: true },
  });
  assert.strictEqual(typeof id, "number");
  assert.ok(id > 0);
  const row = db
    .prepare(`SELECT * FROM platform_metric_snapshots WHERE id = ?`)
    .get(id);
  assert.strictEqual(row.story_id, "s1");
  assert.strictEqual(row.platform, "youtube");
  assert.strictEqual(row.external_id, "yt_abc");
  assert.strictEqual(row.views, 1234);
  assert.strictEqual(row.likes, 56);
  assert.strictEqual(row.shares, 8);
  assert.strictEqual(row.retention_percent, 67.8);
  assert.strictEqual(
    row.channel_id,
    "pulse-gaming",
    "default channel_id should be applied",
  );
  assert.ok(
    row.raw_json && row.raw_json.includes("youtube"),
    "raw_json should be stringified",
  );
  assert.ok(row.snapshot_at, "snapshot_at should be populated by default");
});

test("recordSnapshot: minimal payload — only story_id + platform", () => {
  const db = newDb();
  const id = recordSnapshot(db, { story_id: "s2", platform: "tiktok" });
  const row = db
    .prepare(`SELECT * FROM platform_metric_snapshots WHERE id = ?`)
    .get(id);
  assert.strictEqual(row.views, null);
  assert.strictEqual(row.likes, null);
  assert.strictEqual(row.raw_json, null);
  assert.strictEqual(row.channel_id, "pulse-gaming");
});

test("recordSnapshot: throws on missing story_id", () => {
  const db = newDb();
  assert.throws(
    () => recordSnapshot(db, { platform: "youtube" }),
    /story_id required/,
  );
});

test("recordSnapshot: throws on unknown platform", () => {
  const db = newDb();
  assert.throws(
    () => recordSnapshot(db, { story_id: "s", platform: "reddit" }),
    /platform must be one of/,
  );
});

test("recordSnapshot: accepts raw_json as both string and object", () => {
  const db = newDb();
  const id1 = recordSnapshot(db, {
    story_id: "s3",
    platform: "youtube",
    raw_json: '{"from":"string"}',
  });
  const id2 = recordSnapshot(db, {
    story_id: "s3",
    platform: "youtube",
    raw_json: { from: "object" },
  });
  const r1 = db
    .prepare(`SELECT raw_json FROM platform_metric_snapshots WHERE id = ?`)
    .get(id1);
  const r2 = db
    .prepare(`SELECT raw_json FROM platform_metric_snapshots WHERE id = ?`)
    .get(id2);
  assert.strictEqual(r1.raw_json, '{"from":"string"}');
  assert.ok(r2.raw_json && r2.raw_json.includes('"from":"object"'));
});

test("recordSnapshot: non-numeric views/likes are coerced to null (not polluting the series)", () => {
  const db = newDb();
  const id = recordSnapshot(db, {
    story_id: "s4",
    platform: "youtube",
    views: "not-a-number",
    likes: NaN,
    shares: Infinity,
  });
  const row = db
    .prepare(`SELECT * FROM platform_metric_snapshots WHERE id = ?`)
    .get(id);
  assert.strictEqual(row.views, null);
  assert.strictEqual(row.likes, null);
  assert.strictEqual(row.shares, null);
});

test("recordSnapshot: respects caller-provided snapshot_at", () => {
  const db = newDb();
  const ts = "2026-04-21T12:00:00.000Z";
  const id = recordSnapshot(db, {
    story_id: "s5",
    platform: "youtube",
    snapshot_at: ts,
  });
  const row = db
    .prepare(`SELECT snapshot_at FROM platform_metric_snapshots WHERE id = ?`)
    .get(id);
  assert.strictEqual(row.snapshot_at, ts);
});

test("recordSnapshot: respects caller-provided channel_id", () => {
  const db = newDb();
  const id = recordSnapshot(db, {
    story_id: "s6",
    platform: "youtube",
    channel_id: "stacked",
  });
  const row = db
    .prepare(`SELECT channel_id FROM platform_metric_snapshots WHERE id = ?`)
    .get(id);
  assert.strictEqual(row.channel_id, "stacked");
});

// ---------- listForStory / latestForStory ----------

test("listForStory: returns most-recent-first across platforms", () => {
  const db = newDb();
  recordSnapshot(db, {
    story_id: "s7",
    platform: "youtube",
    views: 10,
    snapshot_at: "2026-04-21T10:00:00.000Z",
  });
  recordSnapshot(db, {
    story_id: "s7",
    platform: "youtube",
    views: 25,
    snapshot_at: "2026-04-21T14:00:00.000Z",
  });
  recordSnapshot(db, {
    story_id: "s7",
    platform: "tiktok",
    views: 1000,
    snapshot_at: "2026-04-21T14:00:00.000Z",
  });
  const rows = listForStory(db, "s7");
  assert.strictEqual(rows.length, 3);
  // Most recent first
  assert.strictEqual(rows[0].snapshot_at, "2026-04-21T14:00:00.000Z");
});

test("listForStory: optional platform filter", () => {
  const db = newDb();
  recordSnapshot(db, { story_id: "s8", platform: "youtube", views: 1 });
  recordSnapshot(db, { story_id: "s8", platform: "tiktok", views: 2 });
  const ytOnly = listForStory(db, "s8", { platform: "youtube" });
  assert.strictEqual(ytOnly.length, 1);
  assert.strictEqual(ytOnly[0].platform, "youtube");
});

test("listForStory: limit honoured", () => {
  const db = newDb();
  for (let i = 0; i < 5; i++) {
    recordSnapshot(db, {
      story_id: "s9",
      platform: "youtube",
      views: i,
      snapshot_at: `2026-04-21T1${i}:00:00.000Z`,
    });
  }
  const rows = listForStory(db, "s9", { limit: 2 });
  assert.strictEqual(rows.length, 2);
});

test("latestForStory: returns the newest row only", () => {
  const db = newDb();
  recordSnapshot(db, {
    story_id: "s10",
    platform: "youtube",
    views: 1,
    snapshot_at: "2026-04-20T10:00:00.000Z",
  });
  recordSnapshot(db, {
    story_id: "s10",
    platform: "youtube",
    views: 99,
    snapshot_at: "2026-04-21T10:00:00.000Z",
  });
  const latest = latestForStory(db, "s10", "youtube");
  assert.strictEqual(latest.views, 99);
});

test("latestForStory: returns null when nothing matches", () => {
  const db = newDb();
  assert.strictEqual(latestForStory(db, "missing", "youtube"), null);
});

test("latestForStory: unknown platform returns null safely", () => {
  const db = newDb();
  assert.strictEqual(latestForStory(db, "s", "reddit"), null);
});

// ---------- append-only (no UPSERT) ----------

test("recordSnapshot: identical inputs produce a SECOND row — time series is append-only", () => {
  const db = newDb();
  recordSnapshot(db, { story_id: "s11", platform: "youtube", views: 10 });
  recordSnapshot(db, { story_id: "s11", platform: "youtube", views: 10 });
  const rows = listForStory(db, "s11");
  assert.strictEqual(rows.length, 2);
});

test("VALID_PLATFORMS: lists the expected platforms", () => {
  assert.ok(VALID_PLATFORMS.has("youtube"));
  assert.ok(VALID_PLATFORMS.has("tiktok"));
  assert.ok(VALID_PLATFORMS.has("instagram"));
  assert.ok(VALID_PLATFORMS.has("facebook"));
  assert.ok(VALID_PLATFORMS.has("twitter"));
  assert.ok(!VALID_PLATFORMS.has("reddit"));
});
