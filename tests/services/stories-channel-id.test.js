const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

// Covers the 2026-04-21 channel_id fix:
//   - STORIES_COLUMNS now includes channel_id so storyToRow writes
//     it to the real column instead of stuffing it in _extra.
//   - Missing channel_id defaults to process.env.CHANNEL (or
//     "pulse-gaming") at save time, so new rows always carry a
//     non-null tag.
//   - Migration 014 backfills legacy NULL rows to 'pulse-gaming'.
//
// We force-reload lib/db per test with a fresh temp SQLite file so
// no test pollutes another via the module singleton.

function loadDbWithTempFile() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-chan-"));
  const dbPath = path.join(tmpDir, "test.db");
  const prevEnv = {
    PULSE_DB_PATH: process.env.PULSE_DB_PATH,
    DB_PATH: process.env.DB_PATH,
    CHANNEL: process.env.CHANNEL,
    SQLITE_DB_PATH: process.env.SQLITE_DB_PATH,
    USE_SQLITE: process.env.USE_SQLITE,
  };
  process.env.PULSE_DB_PATH = dbPath;
  process.env.DB_PATH = dbPath;
  process.env.SQLITE_DB_PATH = dbPath;
  process.env.USE_SQLITE = "true";
  delete require.cache[require.resolve("../../lib/db")];
  const db = require("../../lib/db");
  // Force DB initialisation by calling getDb — it lazily opens the
  // file and runs the base schema + migrations on first access.
  const handle = db.getDb();
  return {
    db,
    handle,
    dbPath,
    tmpDir,
    cleanup() {
      try {
        db.closeDb && db.closeDb();
      } catch {
        /* ignore */
      }
      delete require.cache[require.resolve("../../lib/db")];
      for (const k of Object.keys(prevEnv)) {
        if (prevEnv[k] === undefined) delete process.env[k];
        else process.env[k] = prevEnv[k];
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

// ---------- STORIES_COLUMNS membership ----------

test("STORIES_COLUMNS: includes channel_id", () => {
  const { STORIES_COLUMNS } = require("../../lib/db");
  assert.ok(
    STORIES_COLUMNS.has("channel_id"),
    "channel_id must be in STORIES_COLUMNS so storyToRow routes it to the real column, not _extra",
  );
});

// ---------- default channel_id on insert ----------

test("upsertStory: stamps default channel_id ('pulse-gaming') when caller omits it", async () => {
  const ctx = loadDbWithTempFile();
  try {
    delete process.env.CHANNEL;
    // Seed the pulse-gaming channel row so the FK passes.
    ctx.handle
      .prepare(
        `INSERT OR IGNORE INTO channels (id, name) VALUES ('pulse-gaming', 'Pulse Gaming')`,
      )
      .run();
    await ctx.db.upsertStory({
      id: "test_no_channel",
      title: "Missing channel_id on insert",
      url: "https://example.com/a",
    });
    const row = ctx.db.getStoriesSync().find((r) => r.id === "test_no_channel");
    assert.ok(row, "inserted story should round-trip");
    assert.strictEqual(
      row.channel_id,
      "pulse-gaming",
      "default channel_id should be pulse-gaming when env unset",
    );
  } finally {
    ctx.cleanup();
  }
});

test("upsertStory: respects caller-provided channel_id", async () => {
  const ctx = loadDbWithTempFile();
  try {
    ctx.handle
      .prepare(
        `INSERT OR IGNORE INTO channels (id, name) VALUES ('test-chan', 'Test Channel')`,
      )
      .run();
    await ctx.db.upsertStory({
      id: "test_explicit_channel",
      title: "Explicit",
      url: "https://example.com/b",
      channel_id: "test-chan",
    });
    const row = ctx.db
      .getStoriesSync()
      .find((r) => r.id === "test_explicit_channel");
    assert.ok(row);
    assert.strictEqual(row.channel_id, "test-chan");
  } finally {
    ctx.cleanup();
  }
});

test("upsertStory: honours process.env.CHANNEL as the default", async () => {
  const ctx = loadDbWithTempFile();
  try {
    process.env.CHANNEL = "pulse-gaming";
    ctx.handle
      .prepare(
        `INSERT OR IGNORE INTO channels (id, name) VALUES ('pulse-gaming', 'Pulse Gaming')`,
      )
      .run();
    await ctx.db.upsertStory({
      id: "test_env_channel",
      title: "From env",
      url: "https://example.com/c",
    });
    const row = ctx.db
      .getStoriesSync()
      .find((r) => r.id === "test_env_channel");
    assert.ok(row);
    assert.strictEqual(row.channel_id, "pulse-gaming");
  } finally {
    ctx.cleanup();
  }
});

// ---------- migration 014 backfill ----------

test("migration 014 backfills NULL channel_id to pulse-gaming", () => {
  const ctx = loadDbWithTempFile();
  try {
    ctx.handle
      .prepare(
        `INSERT OR IGNORE INTO channels (id, name) VALUES ('pulse-gaming', 'Pulse Gaming')`,
      )
      .run();
    // Insert a legacy story with NULL channel_id, simulating the
    // state of rows written before this patch.
    ctx.handle
      .prepare(
        `INSERT INTO stories (id, title, url, channel_id) VALUES (?, ?, ?, NULL)`,
      )
      .run("legacy_null_channel", "Legacy", "https://example.com/legacy");

    const before = ctx.handle
      .prepare(`SELECT channel_id FROM stories WHERE id = ?`)
      .get("legacy_null_channel");
    assert.strictEqual(before.channel_id, null);

    // Execute migration 014's SQL directly.
    const migrationSql = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "db",
        "migrations",
        "014_stories_channel_backfill.sql",
      ),
      "utf8",
    );
    ctx.handle.exec(migrationSql);

    const after = ctx.handle
      .prepare(`SELECT channel_id FROM stories WHERE id = ?`)
      .get("legacy_null_channel");
    assert.strictEqual(after.channel_id, "pulse-gaming");
  } finally {
    ctx.cleanup();
  }
});

// ---------- round-trip ----------

test("round-trip: channel_id lands in the real column, not _extra", async () => {
  const ctx = loadDbWithTempFile();
  try {
    ctx.handle
      .prepare(
        `INSERT OR IGNORE INTO channels (id, name) VALUES ('pulse-gaming', 'Pulse Gaming')`,
      )
      .run();
    await ctx.db.upsertStory({
      id: "test_roundtrip",
      title: "Roundtrip",
      url: "https://example.com/rt",
      channel_id: "pulse-gaming",
    });
    const row = ctx.handle
      .prepare(`SELECT channel_id, _extra FROM stories WHERE id = ?`)
      .get("test_roundtrip");
    assert.strictEqual(row.channel_id, "pulse-gaming");
    if (row._extra) {
      const parsed = JSON.parse(row._extra);
      assert.strictEqual(
        Object.prototype.hasOwnProperty.call(parsed, "channel_id"),
        false,
        "channel_id must not land in _extra JSON blob",
      );
    }
  } finally {
    ctx.cleanup();
  }
});
