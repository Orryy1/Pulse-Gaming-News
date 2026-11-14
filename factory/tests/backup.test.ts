import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { createEmbeddedDb, migrate } from "../src/db.ts";
import { backupDue, backupKey, decryptFile, makeBackup, markBackup, TAR } from "../src/backup.ts";

test("a backup restores with episode states, platform ids, pending work and the YouTube login intact", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-bk-"));
  const dataDir = path.join(root, "data");
  fs.mkdirSync(path.join(dataDir, "admin"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "admin", "layout.json"), "{}");
  const db = await createEmbeddedDb(path.join(dataDir, "db"));
  await migrate(db);
  await db.query(`INSERT INTO settings (key, value) VALUES ('youtube_refresh_token', 'tok')`);
  await db.query(`INSERT INTO episodes (id, story_hash, status, story_json, lane, youtube_video_id) VALUES ('ep_live', 'a', 'published', '{"headline":"a","items":[]}', 'news', 'vidA')`);
  await db.query(`INSERT INTO episodes (id, story_hash, status, story_json, lane, upload_session_uri) VALUES ('ep_wait', 'b', 'uploading', '{"headline":"b","items":[]}', 'news', 'https://upload/1')`);
  const outDir = path.join(root, "backups");
  const now = new Date("2026-10-24T03:05:00Z");
  const file = await makeBackup(db, { dataDir, outDir, secret: "s3cret", now });
  assert.ok(fs.existsSync(file));
  assert.ok(fs.statSync(file).size > 1000);
  // The archive is not readable without the secret.
  const bad = path.join(root, "bad.tar");
  assert.throws(() => decryptFile(file, bad, backupKey("wrong")));
  // Restore into a fresh folder and read it.
  const work = path.join(root, "restore");
  fs.mkdirSync(work);
  const tar = path.join(work, "backup.tar");
  decryptFile(file, tar, backupKey("s3cret"));
  execFileSync(TAR, ["-xf", tar, "-C", work]);
  assert.ok(fs.existsSync(path.join(work, "admin", "layout.json")), "admin state travels");
  assert.ok(fs.existsSync(path.join(work, "MANIFEST.json")));
  const restored = await PGlite.create(path.join(work, "db"), { loadDataDir: new Blob([fs.readFileSync(path.join(work, "db.tar.gz"))]) });
  try {
    const eps = (await restored.query<{ id: string; status: string; youtube_video_id: string | null; upload_session_uri: string | null }>(`SELECT id, status, youtube_video_id, upload_session_uri FROM episodes ORDER BY id`)).rows;
    assert.deepEqual(eps, [
      { id: "ep_live", status: "published", youtube_video_id: "vidA", upload_session_uri: null },
      { id: "ep_wait", status: "uploading", youtube_video_id: null, upload_session_uri: "https://upload/1" },
    ]);
    const [tok] = (await restored.query<{ value: string }>(`SELECT value FROM settings WHERE key = 'youtube_refresh_token'`)).rows;
    assert.equal(tok?.value, "tok");
  } finally {
    await restored.close();
  }
  // Due once a day from 03:00 local, then not again until tomorrow.
  assert.equal(await backupDue(db, "Europe/London", new Date("2026-10-24T01:30:00Z")), undefined, "too early");
  const day = await backupDue(db, "Europe/London", new Date("2026-10-24T02:10:00Z"));
  assert.equal(day, "2026-10-24", "03:10 London is due");
  await markBackup(db, day!, file);
  assert.equal(await backupDue(db, "Europe/London", new Date("2026-10-24T12:00:00Z")), undefined, "done for today");
  // 25 Oct 2026 is GMT (the clocks went back at 02:00): 03:10 local is 03:10Z.
  assert.equal(await backupDue(db, "Europe/London", new Date("2026-10-25T03:10:00Z")), "2026-10-25");
  await db.close();
  fs.rmSync(root, { recursive: true, force: true });
});
