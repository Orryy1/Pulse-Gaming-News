import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  crosspostTick,
  socialCaption,
  MAX_TRIES,
  tiktokTooSoon,
  capReached,
  dailyCap,
  gapMinutes,
  nextForCapped,
  nextForTikTok,
  postsLast24h,
  tooSoon,
} from "../src/social/crosspost.ts";
import { platformRank } from "../src/loopfeedback.ts";
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

test("Threads and Bluesky captions fit their limits and carry the link; Bluesky links get byte ranges", async () => {
  const { socialCaption } = await import("../src/social/crosspost.ts");
  const { linkFacets } = await import("../src/social/platforms.ts");
  const { goodScript } = await import("./helpers.ts");
  const script = goodScript();
  const bsky = socialCaption("bluesky", script, "abc123");
  assert.ok(bsky.length <= 300, `bluesky caption is ${bsky.length} characters`);
  assert.match(bsky, /https:\/\/youtube\.com\/shorts\/abc123/);
  assert.match(bsky, /#gaming/);
  const threads = socialCaption("threads", script, "abc123");
  assert.ok(threads.length <= 500);
  assert.match(threads, /Full story and sources: https:\/\/youtube\.com\/shorts\/abc123/);
  assert.match(threads, /Narrated with an AI voice\./);
  const text = "Pokémon news · https://youtube.com/shorts/abc123 #gaming";
  const [f] = linkFacets(text);
  assert.equal(Buffer.from(text, "utf8").subarray(f!.index.byteStart, f!.index.byteEnd).toString("utf8"), "https://youtube.com/shorts/abc123");
});

test("Threads posts go to /me, never to a saved id that JSON may have rounded", async () => {
  const { postThreadsVideo } = await import("../src/social/platforms.ts");
  const urls: string[] = [];
  const fake = async (url: string) => {
    urls.push(url);
    const body = url.includes("/threads_publish") ? { id: "post1" } : url.includes("fields=") ? { status: "FINISHED" } : { id: "c1" };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const id = await postThreadsVideo({ userId: "39441857878762960", token: "t" }, "https://x/v.mp4", "hi", fake as any, 0);
  assert.equal(id, "post1");
  assert.ok(urls.every((u) => !u.includes("39441857878762960")), "the saved id is never used");
  assert.ok(urls[0]!.includes("/v1.0/me/threads?"));
  assert.ok(urls.at(-1)!.includes("/v1.0/me/threads_publish?"));
});

test("TikTok and Instagram captions use all five hashtags, a ranking's own games before #gaming", async () => {
  const { socialCaption } = await import("../src/social/crosspost.ts");
  const ranking = {
    hook: "Every mainline Fallout, ranked by how it plays today.",
    game_title: "Fallout",
    headline: "Ranking every mainline Fallout game",
    hashtags: ["#Fallout"],
    entries: [
      { rank: 2, game_title: "Fallout 4", year: 2015 },
      { rank: 1, game_title: "Fallout: New Vegas", year: 2010 },
      { rank: 3, game_title: "Fallout 3", year: 2008 },
    ],
    youtube: { title: "Fallout: Ranking Every Mainline Game", description: "", tags: [] },
  } as never;
  for (const platform of ["tiktok", "instagram"] as const) {
    const tags = socialCaption(platform, ranking, "abc").match(/#\w+/g) ?? [];
    assert.deepEqual(tags, ["#Fallout", "#FalloutNewVegas", "#Fallout4", "#Fallout3", "#gamingnews"], platform);
  }
});

test("TikTok posts keep TIKTOK_GAP_MINUTES apart so a backlog never lands as a burst", async () => {
  const db = await testDb();
  const now = new Date();
  assert.equal(await tiktokTooSoon(db, { tiktokGapMinutes: 90 }, now), false, "nothing posted yet");
  const { logEvent } = await import("../src/episodes.ts");
  await logEvent(db, "ep_g", "crosspost", { platform: "instagram", id: "i1" });
  assert.equal(await tiktokTooSoon(db, { tiktokGapMinutes: 90 }, now), false, "other platforms do not count");
  await logEvent(db, "ep_g", "crosspost", { platform: "tiktok", id: "buffer:1" });
  assert.equal(await tiktokTooSoon(db, { tiktokGapMinutes: 90 }, now), true, "a TikTok post just went");
  assert.equal(await tiktokTooSoon(db, { tiktokGapMinutes: 0 }, now), false, "0 turns the gap off");
  const later = new Date(now.getTime() + 91 * 60_000);
  assert.equal(await tiktokTooSoon(db, { tiktokGapMinutes: 90 }, later), false, "free again after the gap");
});

// ------------------------------------------------------------------ daily caps and the per-platform pick

async function cappedShort(
  db: Awaited<ReturnType<typeof testDb>>,
  dir: string,
  id: string,
  o: { hoursAgo?: number; views?: number; title?: string; why?: boolean } = {},
) {
  await fs.mkdir(path.join(dir, id), { recursive: true });
  await fs.writeFile(path.join(dir, id, "short.mp4"), "x");
  const script = goodScript(
    o.title ? { youtube: { ...goodScript().youtube, title: o.title } } : {},
  );
  await db.query(
    `INSERT INTO episodes (id, story_hash, story_json, status, lane, script_json, youtube_video_id, publish_at, updated_at)
     VALUES ($1, $2, '{"headline":"x","items":[]}', 'published', 'news', $3, $4, now() - make_interval(hours => $5), now())`,
    [id, o.why ? `why:${id}` : id, JSON.stringify(script), `yt_${id}`, o.hoursAgo ?? 3],
  );
  if (o.views !== undefined)
    await db.query(
      `INSERT INTO video_metrics (episode_id, label, captured_at, views, likes, comments) VALUES ($1, '3h', now(), $2, 0, 0)`,
      [id, o.views],
    );
}

function capDeps(
  db: Awaited<ReturnType<typeof testDb>>,
  dir: string,
  cfg: ReturnType<typeof testConfig>,
  posted: string[],
) {
  const poster = (p: string) => async () => (posted.push(p), `${p}${posted.length}`);
  return {
    db,
    cfg,
    now: () => new Date(),
    isPublic: async () => true,
    notify: async () => true,
    episodeDir: (id: string) => path.join(dir, id),
    videoUrl: (id: string) => `https://example.test/${id}.mp4`,
    posters: {
      x: async () => (posted.push("x"), `x${posted.length}`),
      facebook: poster("facebook"),
      instagram: poster("instagram"),
      threads: poster("threads"),
      tiktok: poster("tiktok"),
    },
  };
}

const postedOn = async (db: Awaited<ReturnType<typeof testDb>>, platform: string) =>
  (
    await db.query<{ episode_id: string }>(
      `SELECT episode_id FROM events WHERE kind = 'crosspost' AND detail->>'platform' = $1 ORDER BY id`,
      [platform],
    )
  ).map((r) => r.episode_id);

test("daily caps are hard limits per platform; 0 means uncapped, as before", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  const cfg = testConfig(dir, { instagramDaily: 2, facebookDaily: 1, tiktokDaily: 3, tiktokFromHour: 0 });
  for (const id of ["c1", "c2", "c3", "c4", "c5"]) await cappedShort(db, dir, id);
  const posted: string[] = [];
  const deps = capDeps(db, dir, cfg, posted);
  for (let i = 0; i < 7; i++) await crosspostTick(deps);
  const count = (p: string) => posted.filter((x) => x === p).length;
  assert.equal(count("facebook"), 1, "FACEBOOK_DAILY=1");
  assert.equal(count("instagram"), 2, "INSTAGRAM_DAILY=2");
  assert.equal(count("tiktok"), 3, "TIKTOK_DAILY=3");
  assert.equal(count("threads"), 5, "THREADS_DAILY=0: every Short");
  assert.equal(count("x"), 5, "X is never capped");
  await db.close();
});

test("a cap counts retries and posts that may have landed without a record", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  const { logEvent } = await import("../src/episodes.ts");
  const now = new Date();
  assert.equal(await postsLast24h(db, "facebook", now), 0);
  // A retry that posted counts once; the failures before it do not.
  await logEvent(db, "r1", "crosspost_failed", { platform: "facebook", error: "down" });
  await logEvent(db, "r1", "crosspost_started", { platform: "facebook" });
  await logEvent(db, "r1", "crosspost", { platform: "facebook", id: "f1" });
  assert.equal(await postsLast24h(db, "facebook", now), 1);
  // A started attempt with no record after it may have landed: it counts too.
  await logEvent(db, "r2", "crosspost_started", { platform: "facebook" });
  assert.equal(await postsLast24h(db, "facebook", now), 2);
  assert.equal(await postsLast24h(db, "instagram", now), 0, "other platforms do not count");
  assert.equal(await capReached(db, { facebookDaily: 2 }, "facebook", now), true);
  assert.equal(await capReached(db, { facebookDaily: 3 }, "facebook", now), false);
  assert.equal(await capReached(db, { facebookDaily: 0 }, "facebook", now), false, "0 = no cap");
  const tomorrow = new Date(now.getTime() + 25 * 3_600_000);
  assert.equal(await postsLast24h(db, "facebook", tomorrow), 0, "a rolling 24 hours");
  // In the tick: Facebook at its cap of 2 posts nothing more, whatever is waiting.
  await cappedShort(db, dir, "r3");
  const posted: string[] = [];
  await crosspostTick(capDeps(db, dir, testConfig(dir, { facebookDaily: 2 }), posted));
  assert.ok(!posted.includes("facebook"), posted.join());
  assert.ok(posted.includes("instagram"), "uncapped platforms still post");
  await db.close();
});

test("each platform's gap keeps its posts apart, capped or not", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  const cfg = testConfig(dir, {
    instagramGapMinutes: 120,
    threadsGapMinutes: 60,
    facebookDaily: 3,
    facebookGapMinutes: 180,
  });
  for (const id of ["g1", "g2", "g3"]) await cappedShort(db, dir, id);
  const posted: string[] = [];
  const deps = capDeps(db, dir, cfg, posted);
  for (let i = 0; i < 3; i++) await crosspostTick(deps);
  const count = (p: string) => posted.filter((x) => x === p).length;
  assert.equal(count("instagram"), 1);
  assert.equal(count("threads"), 1);
  assert.equal(count("facebook"), 1);
  assert.equal(count("x"), 3, "no gap set");
  const later = new Date(Date.now() + 121 * 60_000);
  assert.equal(await tooSoon(db, "instagram", gapMinutes(cfg, "instagram"), later), false, "free after the gap");
  assert.equal(await tooSoon(db, "facebook", gapMinutes(cfg, "facebook"), later), true, "Facebook's own gap is longer");
  assert.equal(gapMinutes(testConfig(dir, { tiktokGapMinutes: 200 }), "tiktok"), 200, "TIKTOK_GAP_MINUTES still works");
  await db.close();
});

test("a capped platform takes its best Short by YouTube views per hour; the loop's favours lift by at most 25%", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  // 3 hours live each: views per hour 300, 260 and 100.
  await cappedShort(db, dir, "b_news", { views: 900, title: "Witchbrook Slips to January" });
  await cappedShort(db, dir, "b_why", { views: 780, title: "Why Witchbrook Slipped", why: true });
  await cappedShort(db, dir, "b_low", { views: 300, title: "Patch Notes Are Out" });
  const cfg = testConfig(dir, { instagramDaily: 2, facebookDaily: 1, tiktokDaily: 1, tiktokFromHour: 0 });
  const now = new Date();
  assert.equal((await nextForCapped(db, "instagram", cfg, now))!.id, "b_news", "views per hour alone");
  // The weekly report favours "why" stories on Instagram only.
  const out = path.join(dir, "reports", "analytics");
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(
    path.join(out, "latest.json"),
    JSON.stringify({
      run_at: now.toISOString(),
      feedback: {
        posting: { tiktok_boost: 0, instagram_held: [], favour: { instagram: { why: 0.25, bogus: 3 } } },
      },
    }),
  );
  const on = { ...cfg, analyticsLoopPosting: true };
  assert.equal((await nextForCapped(db, "instagram", cfg, now))!.id, "b_news", "off: the report is ignored");
  assert.equal((await nextForCapped(db, "instagram", on, now))!.id, "b_why", "260 x 1.25 beats 300");
  assert.equal((await nextForCapped(db, "facebook", on, now))!.id, "b_news", "a favour is per platform");
  assert.equal((await nextForTikTok(db, on, now))!.id, "b_news", "TikTok keeps its own fit boost only");
  assert.equal(
    platformRank(
      100,
      { title: "Elden Ring: you need 60GB", game: "Elden Ring", durationSeconds: 30 },
      "why",
      { fit: 0.25, favour: { why: 0.25, strong_fandom: 0.25 } },
    ),
    125,
    "the lifts add up to 25% at most",
  );
  // The tick posts Instagram's two best, in order, and the weakest never.
  const posted: string[] = [];
  for (let i = 0; i < 4; i++) await crosspostTick(capDeps(db, dir, on, posted));
  assert.deepEqual(await postedOn(db, "instagram"), ["b_why", "b_news"]);
  assert.deepEqual(await postedOn(db, "facebook"), ["b_news"]);
  // A lift never passes 25%, so a much stronger Short still wins.
  await db.query(`UPDATE video_metrics SET views = 1200 WHERE episode_id = 'b_low'`);
  await db.query(`DELETE FROM events WHERE detail->>'platform' = 'instagram'`);
  await db.query(`UPDATE video_metrics SET views = 600 WHERE episode_id = 'b_news'`);
  assert.equal((await nextForCapped(db, "instagram", on, now))!.id, "b_low", "400 beats 260 x 1.25");
  await db.close();
});

test("TikTok's daily pick is unchanged: TIKTOK_DAILY, best views per hour, nothing before TIKTOK_FROM_HOUR", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  await cappedShort(db, dir, "t_a", { views: 300 });
  await cappedShort(db, dir, "t_b", { views: 900 });
  await cappedShort(db, dir, "t_c", { views: 600 });
  const now = new Date();
  assert.equal(
    await nextForTikTok(db, testConfig(dir, { tiktokDaily: 2, tiktokFromHour: 24 }), now),
    undefined,
    "before TIKTOK_FROM_HOUR",
  );
  const cfg = testConfig(dir, { tiktokDaily: 2, tiktokFromHour: 0 });
  assert.equal((await nextForTikTok(db, cfg, now))!.id, "t_b");
  const posted: string[] = [];
  for (let i = 0; i < 4; i++) await crosspostTick(capDeps(db, dir, cfg, posted));
  assert.deepEqual(await postedOn(db, "tiktok"), ["t_b", "t_c"]);
  assert.deepEqual(await postedOn(db, "instagram"), ["t_a", "t_b", "t_c"], "uncapped: oldest first, every Short");
  assert.equal(dailyCap(cfg, "tiktok"), 2);
  assert.equal(await tiktokTooSoon(db, { tiktokGapMinutes: 60 }, new Date()), true);
  await db.close();
});
