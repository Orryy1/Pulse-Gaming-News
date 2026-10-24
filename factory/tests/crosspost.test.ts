import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  crosspostTick,
  socialCaption,
  MAX_TRIES,
} from "../src/social/crosspost.ts";
import { oauth1Header } from "../src/social/oauth1.ts";
import { testDb, tmpDir, testConfig, goodScript } from "./helpers.ts";

test("OAuth 1.0a signature matches X's documented example", () => {
  // https://developer.x.com/en/docs/authentication/oauth-1-0a/creating-a-signature
  const h = oauth1Header(
    "POST",
    "https://api.twitter.com/1.1/statuses/update.json?include_entities=true",
    {
      consumerKey: "xvz1evFS4wEEPTGEFPHBog",
      consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
      token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
      tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
    },
    { status: "Hello Ladies + Gentlemen, a signed OAuth request!" },
    "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
    "1318622958",
  );
  assert.match(h, /oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"/);
});

test("captions: X fits in 280 with the link, Facebook links to YouTube, rumours are labelled", () => {
  const s = goodScript({
    game_title: "Grand Theft Auto VI",
    hook: "Rockstar just confirmed the date.",
  });
  const x = socialCaption("x", s, "abc123");
  assert.ok(
    x.length - "https://youtube.com/shorts/abc123".length + 23 <= 280,
    x,
  );
  assert.match(x, /https:\/\/youtube\.com\/shorts\/abc123/);
  assert.match(
    socialCaption("facebook", s, "abc123"),
    /Full story and sources: https:\/\/youtube\.com\/shorts\/abc123/,
  );
  const ig = socialCaption("instagram", s, "abc123");
  assert.match(ig, /#GTA6 #GTA/);
  assert.match(ig, /AI voice/);
  assert.ok((ig.match(/#\w+/g) ?? []).length <= 5, "Instagram allows five hashtags");
  assert.doesNotMatch(x, /#\w+/, "no topic hashtags on X");
  const tt = socialCaption("tiktok", s, "abc123");
  assert.ok(tt.startsWith("Rockstar just confirmed the date."), "TikTok opens on the spoken fact");
  assert.ok((tt.match(/#\w+/g) ?? []).length <= 5);
  assert.match(
    socialCaption("tiktok", { ...s, is_rumour: true }, "abc123"),
    /Unconfirmed report/,
  );
  assert.doesNotMatch(socialCaption("tiktok", s, "abc123"), /\n{3,}/);
});

async function publishedShort(
  db: Awaited<ReturnType<typeof testDb>>,
  id: string,
  minutesAgo: number,
  extra: { lane?: string; runtime?: string } = {},
) {
  const script = {
    ...goodScript(),
    ...(extra.runtime ? { runtime: extra.runtime } : {}),
  };
  await db.query(
    `INSERT INTO episodes (id, story_hash, story_json, status, lane, script_json, youtube_video_id, publish_at, updated_at)
     VALUES ($1, $1, '{"headline":"x","items":[]}', 'published', $2, $3, $4, now() - make_interval(mins => $5), now())`,
    [id, extra.lane ?? "news", JSON.stringify(script), `yt_${id}`, minutesAgo],
  );
}

test("crossposting: staggered per platform, once each, skips private videos, gives up after three failures", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  const cfg = testConfig(dir);
  for (const id of ["ep_a", "ep_b", "ep_long"]) {
    await fs.mkdir(path.join(dir, id), { recursive: true });
    await fs.writeFile(path.join(dir, id, "short.mp4"), "x");
  }
  await publishedShort(db, "ep_a", 45); // past X (5) and Facebook (30), not Instagram (60)
  await publishedShort(db, "ep_long", 120, {
    lane: "longform",
    runtime: "long",
  }); // never crossposted
  const posted: string[] = [];
  let failTikTok = true;
  const deps = {
    db,
    cfg,
    now: () => new Date(),
    isPublic: async (v: string) => v !== "yt_ep_b",
    notify: async () => true,
    episodeDir: (id: string) => path.join(dir, id),
    posters: {
      x: async (text: string) => (
        posted.push(`x:${text.includes("yt_ep_a") ? "a" : "?"}`),
        "x1"
      ),
      facebook: async () => (posted.push("facebook"), "f1"),
      instagram: async () => (posted.push("instagram"), "i1"),
      tiktok: async () => {
        if (failTikTok) throw new Error("tiktok down");
        posted.push("tiktok");
        return "t1";
      },
    },
  };
  await crosspostTick(deps);
  assert.deepEqual(posted, ["x:a", "facebook"]);
  await crosspostTick(deps); // nothing new is due
  assert.deepEqual(posted, ["x:a", "facebook"]);
  // Two hours on: Instagram and TikTok are due; TikTok fails three times, then is left alone.
  await db.query(
    `UPDATE episodes SET publish_at = now() - interval '2 hours' WHERE id = 'ep_a'`,
  );
  for (let i = 0; i < MAX_TRIES + 1; i++) await crosspostTick(deps);
  assert.deepEqual(posted, ["x:a", "facebook", "instagram"]);
  const [fails] = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM events WHERE kind = 'crosspost_failed'`,
  );
  assert.equal(Number(fails!.n), MAX_TRIES);
  failTikTok = false;
  await crosspostTick(deps);
  assert.deepEqual(posted, ["x:a", "facebook", "instagram"]);
  // A video made private on YouTube is skipped everywhere.
  await publishedShort(db, "ep_b", 120);
  await crosspostTick(deps);
  assert.equal(posted.length, 3);
  const [skips] = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM events WHERE kind = 'crosspost_skip' AND episode_id = 'ep_b'`,
  );
  assert.equal(Number(skips!.n), 4);
  await db.close();
});

test("a lost response never posts twice: the uncertain post is left for the owner, a plain failure retries", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  const cfg = testConfig(dir);
  await fs.mkdir(path.join(dir, "ep_c"), { recursive: true });
  await fs.writeFile(path.join(dir, "ep_c", "short.mp4"), "x");
  await publishedShort(db, "ep_c", 180);
  const notes: string[] = [];
  let posts = 0;
  let crash = true;
  const deps = {
    db,
    cfg,
    now: () => new Date(),
    isPublic: async () => true,
    notify: async (m: { content?: string }) => (notes.push(m.content ?? ""), true),
    episodeDir: (id: string) => path.join(dir, id),
    posters: {
      tiktok: async () => {
        posts++;
        if (crash) {
          crash = false;
          // The platform accepted the post, then the process died before recording it.
          throw Object.assign(new Error("process killed"), { silent: true });
        }
        return "t1";
      },
    },
  };
  // Simulate the silent death: the started marker is written, the poster "succeeds" remotely, nothing is recorded.
  const { logEvent } = await import("../src/episodes.ts");
  await logEvent(db, "ep_c", "crosspost_started", { platform: "tiktok" });
  posts = 1;
  crash = false;
  await crosspostTick(deps);
  assert.equal(posts, 1, "not posted again after a lost response");
  assert.ok(notes.some((n) => /may or may not have posted/.test(n)), "the owner is told");
  const [skips] = await db.query<{ n: string }>(`SELECT count(*) AS n FROM events WHERE kind = 'crosspost_skip' AND episode_id = 'ep_c'`);
  assert.equal(Number(skips!.n), 1);
  // A plain failure (the platform threw) is retried as before.
  await fs.mkdir(path.join(dir, "ep_d"), { recursive: true });
  await fs.writeFile(path.join(dir, "ep_d", "short.mp4"), "x");
  await publishedShort(db, "ep_d", 180);
  let fail = true;
  let dPosts = 0;
  const deps2 = { ...deps, posters: { tiktok: async () => { dPosts++; if (fail) { fail = false; throw new Error("tiktok down"); } return "t2"; } } };
  await crosspostTick(deps2);
  await crosspostTick(deps2);
  assert.equal(dPosts, 2, "retried after a plain failure");
  const [done] = await db.query<{ n: string }>(`SELECT count(*) AS n FROM events WHERE kind = 'crosspost' AND episode_id = 'ep_d'`);
  assert.equal(Number(done!.n), 1);
  await db.close();
});
