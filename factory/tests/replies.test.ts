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

test("channel-wide pass: a late comment on any factory video gets judged and answered once", async () => {
  const { replyToChannelComments } = await import("../src/youtube/replies.ts");
  const db = await testDb();
  const now = new Date("2026-10-23T20:00:00Z");
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane, script_json, youtube_video_id, publish_at)
     VALUES ('ep_sa', 'sa', 'published', '{"headline":"SA","items":[]}', 'news', $1, 'vidSA', $2)`,
    [JSON.stringify({ youtube: { title: "Why Rockstar Never Made a San Andreas Sequel" }, hook: "h", beats: [] }), new Date(now.getTime() - 20 * 3600_000)],
  );
  const replied: Array<[string, string]> = [];
  const youtube = () =>
    ({
      myChannelId: async () => "UCown",
      listChannelComments: async () => [
        { id: "c1", videoId: "vidSA", text: "Should be a new city every expansion", authorChannelId: "UCviewer", likes: 0, replies: 0, publishedAt: now.toISOString() },
        { id: "c2", videoId: "vidSA", text: "our own comment", authorChannelId: "UCown", likes: 0, replies: 0, publishedAt: now.toISOString() },
        { id: "c3", videoId: "vidOld", text: "on a video the factory did not make", authorChannelId: "UCviewer", likes: 0, replies: 0, publishedAt: now.toISOString() },
      ],
      replyToComment: async (id: string, text: string) => {
        replied.push([id, text]);
        return `r_${id}`;
      },
    }) as never;
  const llm = {
    structured: async () => ({ decisions: [{ id: "c1", action: "reply", reason: "good idea", reply: "Fair shout, a new city per expansion would be huge. Which one first?" }] }),
  } as never;
  const deps = { db, youtube, llm, headroom: async () => 10_000, now: () => now };
  assert.equal(await replyToChannelComments(deps), 1);
  assert.deepEqual(replied.map(([id]) => id), ["c1"]);
  // Inside fifteen minutes it does not ask again; later, a judged comment is never answered twice.
  assert.equal(await replyToChannelComments(deps), 0);
  const later = { ...deps, now: () => new Date(now.getTime() + 20 * 60_000) };
  assert.equal(await replyToChannelComments(later), 0);
  assert.equal(replied.length, 1);
});
