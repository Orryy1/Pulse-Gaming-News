"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");

const {
  main,
  parseArgs,
} = require("../../tools/publication-evidence-snapshot");

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

test("publication evidence snapshot parses an explicit read-only scope", () => {
  const args = parseArgs([
    "--story-packages",
    "packages.json",
    "--db",
    "pulse.db",
    "--platforms",
    "youtube_shorts,instagram_reels,facebook_reels",
    "--out",
    "publication-evidence.json",
  ]);

  assert.equal(args.storyPackagesPath, "packages.json");
  assert.equal(args.dbPath, "pulse.db");
  assert.deepEqual(args.platforms, [
    "youtube_shorts",
    "instagram_reels",
    "facebook_reels",
  ]);
  assert.equal(args.outPath, "publication-evidence.json");
});

test("publication evidence snapshot reads SQLite without changing it", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-publication-snapshot-"));
  const dbPath = path.join(root, "pulse.db");
  const storyPackagesPath = path.join(root, "story-packages.json");
  const outPath = path.join(root, "publication-evidence.json");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE stories (
      id TEXT PRIMARY KEY,
      title TEXT,
      source_url_hash TEXT,
      youtube_post_id TEXT,
      youtube_url TEXT,
      instagram_media_id TEXT,
      facebook_post_id TEXT,
      tiktok_post_id TEXT,
      twitter_post_id TEXT
    );
    CREATE TABLE platform_posts (
      story_id TEXT,
      platform TEXT,
      external_id TEXT,
      external_url TEXT,
      status TEXT,
      published_at TEXT,
      updated_at TEXT,
      created_at TEXT
    );
  `);
  db.prepare(
    "INSERT INTO stories (id, title, source_url_hash) VALUES (?, ?, ?)",
  ).run("black-flag-v31", "Black Flag Sold 3 Million", "source-hash-v31");
  db.prepare(`
    INSERT INTO platform_posts (
      story_id, platform, external_id, external_url, status, published_at, updated_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "black-flag-v31",
    "youtube_shorts",
    "yt-v31",
    "https://youtube.com/shorts/yt-v31",
    "published",
    "2026-07-19T08:00:00.000Z",
    "2026-07-19T08:00:00.000Z",
    "2026-07-19T08:00:00.000Z",
  );
  db.close();
  await fs.writeJson(storyPackagesPath, [{
    story_id: "black-flag-v31",
    title: "Black Flag Sold 3 Million",
  }]);
  const beforeHash = sha256File(dbPath);

  const result = await main([
    "--root",
    root,
    "--story-packages",
    storyPackagesPath,
    "--db",
    dbPath,
    "--platforms",
    "youtube_shorts,instagram_reels,facebook_reels",
    "--out",
    outPath,
    "--generated-at",
    "2026-07-19T08:05:00.000Z",
  ], {
    stdout: { write() {} },
  });

  const afterHash = sha256File(dbPath);
  const snapshot = await fs.readJson(outPath);
  assert.equal(afterHash, beforeHash);
  assert.equal(result.snapshot.safety.sqlite_read_only, true);
  assert.equal(snapshot.schema_version, 1);
  assert.deepEqual(snapshot.scope.story_ids, ["black-flag-v31"]);
  assert.deepEqual(snapshot.scope.platforms, [
    "youtube_shorts",
    "instagram_reels",
    "facebook_reels",
  ]);
  assert.deepEqual(
    snapshot.by_story_id["black-flag-v31"].already_published_platforms,
    ["youtube_shorts"],
  );
  assert.equal(snapshot.by_story_id["black-flag-v31"].rows[0].external_id, "yt-v31");
  assert.equal(snapshot.safety.production_db_mutation, false);
  assert.equal(snapshot.safety.network_write_attempted, false);
});
