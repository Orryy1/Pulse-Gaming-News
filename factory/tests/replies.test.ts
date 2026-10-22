import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { testDb } from "./helpers.ts";
import {
  COMMENT_RECORD_RETENTION_DAYS,
  pruneCommentRecords,
} from "../src/youtube/replies.ts";
import { PRIVACY_NOTICE_HTML } from "../src/web/privacy.ts";

const DAY = 24 * 3600_000;

async function record(
  db: Awaited<ReturnType<typeof testDb>>,
  id: string,
  ageDays: number,
  now: Date,
) {
  await db.query(
    `INSERT INTO comment_replies (comment_id, episode_id, video_id, comment, decision, reason, reply_text, reply_id, created_at)
     VALUES ($1, 'ep_1', 'vid_1', 'a viewer comment', 'reply', 'answers a question', 'our reply', 'r_1', $2)`,
    [id, new Date(now.getTime() - ageDays * DAY)],
  );
}

test("comment records are deleted after 90 days and kept until then", async () => {
  const db = await testDb();
  const now = new Date("2026-10-22T04:00:00Z");
  await record(db, "c_new", 1, now);
  await record(db, "c_89", 89, now);
  await record(db, "c_91", 91, now);
  await record(db, "c_400", 400, now);

  assert.equal(COMMENT_RECORD_RETENTION_DAYS, 90);
  assert.equal(await pruneCommentRecords(db, now), 2);
  const left = await db.query<{ comment_id: string; comment: string }>(
    `SELECT comment_id, comment FROM comment_replies ORDER BY comment_id`,
  );
  assert.deepEqual(
    left.map((r) => r.comment_id),
    ["c_89", "c_new"],
  );
  // Running again deletes nothing more.
  assert.equal(await pruneCommentRecords(db, now), 0);
});

test("the tick runs the comment record prune and the notice states the same limit", () => {
  const src = fs.readFileSync(
    path.join(import.meta.dirname, "..", "src", "pipeline.ts"),
    "utf8",
  );
  assert.match(src, /await pruneCommentRecords\(s\.db, s\.now\(\)\)/);
  assert.match(PRIVACY_NOTICE_HTML, /deleted after 90 days/);
});
