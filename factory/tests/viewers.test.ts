import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { testConfig, testDb, tmpDir } from "./helpers.ts";
import {
  VIEWER_LIMITS,
  communityTick,
  decide,
  heartKey,
  pinChoices,
  resetViewerMemory,
  screenComment,
  viewerPlan,
  type Verdict,
  type ViewerComment,
} from "../src/youtube/viewers.ts";
import { YouTubeClient } from "../src/youtube/upload.ts";
import { validDoneKey } from "../src/routines.ts";
import { primeTimeLines } from "../src/experiments.ts";

const at = "2026-11-12T08:00:00Z";
const c = (
  id: string,
  text: string,
  more: Partial<ViewerComment> = {},
): ViewerComment => ({
  id,
  videoId: "vidAAAAAAAA",
  text,
  authorChannelId: `UC_${id}`,
  authorName: `@viewer_${id}`,
  likes: 0,
  replies: 0,
  publishedAt: at,
  ...more,
});
const v = (
  id: string,
  kind: Verdict["kind"],
  reply: string,
  pin = 1,
): Verdict => ({ id, kind, reply, pin });
const none = { answered: new Set<string>(), recent: [] as string[] };

test("the rules screen links, self-promotion, spam, abuse and empty comments before any model", () => {
  assert.equal(
    screenComment("check out my channel for GTA tips").screen,
    "self_promo",
  );
  assert.equal(
    screenComment("full leak at www.example.com/gta").screen,
    "link",
  );
  assert.equal(
    screenComment("DM me on telegram for free robux").screen,
    "spam",
  );
  assert.equal(screenComment("ai slot dipshitt").screen, "hostile");
  assert.equal(screenComment("😂😂😂").screen, "empty");
  assert.equal(screenComment("COD is over 300GB 😂").screen, "ok");
  assert.equal(
    screenComment("Quake, only Quake is worth waiting for at this point :)")
      .screen,
    "ok",
  );
});

test("decide: hearts real comments, never touches criticism or abuse, one reply per person per video", () => {
  const comments = [
    c("a", "Quake, only Quake is worth waiting for at this point"),
    c("b", "Hypocritical criticism, seeing as this video used AI"),
    c("c", "ai slot dipshitt"),
    c("d", "and another thing about Quake", {
      authorChannelId: "UC_a",
      authorName: "@viewer_a",
    }),
    c("e", "Is it on PS5?", { replyAuthors: ["UCown"] }),
    c("f", "Which one first?", {
      videoId: "vidBBBBBBBB",
      authorChannelId: "UC_a",
    }),
  ];
  const plans = decide(
    comments,
    [
      v(
        "a",
        "opinion",
        "Quake would be the dream. Nothing is announced yet, though.",
        3,
      ),
      v("b", "criticism", "We do use AI, here's why..."),
      v("c", "opinion", "Thanks!"),
      v("d", "opinion", "Still Quake, then."),
      v("e", "question", "Yes, PS5 and Xbox Series X."),
      v(
        "f",
        "question",
        "Doom first, by the look of it. Visit www.example.com",
      ),
    ],
    "UCown",
    none,
  );
  const by = new Map(plans.map((p) => [p.comment.id, p]));
  assert.equal(by.get("a")!.heart, true);
  assert.match(by.get("a")!.reply, /^Quake would be the dream/);
  assert.equal(by.get("b")!.heart, false, "criticism of the channel: no heart");
  assert.equal(by.get("b")!.reply, "", "never argue");
  assert.equal(by.get("c")!.heart, false, "the rules overrule the model");
  assert.equal(by.get("c")!.kind, "hostile");
  assert.equal(
    by.get("d")!.reply,
    "",
    "the same person on the same video is answered once",
  );
  assert.match(by.get("d")!.skip, /already answered this person/);
  assert.equal(by.get("d")!.draft, "Still Quake, then.");
  assert.equal(
    by.get("e")!.reply,
    "",
    "the channel already replied in the thread",
  );
  assert.equal(by.get("f")!.reply, "", "a reply with a link never goes");
  // Earlier answers count too.
  const again = decide(
    [comments[0]!],
    [v("a", "opinion", "Quake forever.")],
    "UCown",
    {
      answered: new Set(["vidAAAAAAAA|UC_a"]),
      recent: [],
    },
  );
  assert.equal(again[0]!.reply, "");
});

test("pins: one per video, the model's top score and a real sentence, never a hostile one", () => {
  const plans = decide(
    [
      c("a", "flop", { likes: 9 }),
      c("b", "Quake, only Quake is worth waiting for at this point", {
        likes: 1,
      }),
      c("c", "Honestly the Doom reboot already proved they can do it", {
        likes: 4,
      }),
      c("d", "This is shit and so are you", { likes: 50 }),
      c("e", "Vice City for the soundtrack alone, every single time", {
        videoId: "vidBBBBBBBB",
      }),
    ],
    [
      v("a", "opinion", "", 3),
      v("b", "opinion", "", 3),
      v("c", "opinion", "", 3),
      v("d", "opinion", "", 3),
      v("e", "opinion", "", 2),
    ],
    "UCown",
    none,
  );
  const pins = pinChoices(plans);
  assert.equal(pins.size, 1);
  assert.equal(
    pins.get("vidAAAAAAAA")!.comment.id,
    "c",
    "most liked of the top-scored real sentences",
  );
  assert.equal(VIEWER_LIMITS.pinMin, 3);
});

test("heart keys match the Studio routine's ledger format", () => {
  const k = heartKey({
    authorName: "@viewer",
    text: "line one\nline two that goes on and on and on past sixty characters for sure",
  });
  assert.ok(k.startsWith("@viewer|line one line two"));
  assert.ok(!/\n/.test(k));
  assert.equal(k.split("|")[1]!.length, 60);
  assert.ok(validDoneKey("hearted", k));
  assert.ok(validDoneKey("viewerpin", "vidAAAAAAAA"));
  assert.ok(!validDoneKey("viewerpin", "../etc"));
});

async function setup(now: Date) {
  const db = await testDb();
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane, script_json, youtube_video_id, publish_at)
     VALUES ('ep_v', 'v', 'published', '{"headline":"V","items":[]}', 'news', $1, 'vidAAAAAAAA', $2)`,
    [
      JSON.stringify({
        youtube: { title: "Id Teams Up With MachineGames" },
        hook: "h",
        beats: [],
      }),
      new Date(now.getTime() - 3 * 86_400_000),
    ],
  );
  const sent: Array<[string, string]> = [];
  const threads = [
    c("a", "Quake, only Quake is worth waiting for at this point", {
      likes: 3,
    }),
    c("b", "Would love a new Hexen while they are at it", { likes: 2 }),
    c("c", "And a Heretic remaster too please", {
      authorChannelId: "UC_b",
      authorName: "@viewer_b",
      likes: 1,
    }),
    c("d", "check out my channel for Quake speedruns"),
    c("e", "our own comment", { authorChannelId: "UCown" }),
    c("old", "from three weeks ago", {
      publishedAt: new Date(now.getTime() - 21 * 86_400_000).toISOString(),
    }),
    c("x", "on a video the factory did not make", { videoId: "vidZZZZZZZZ" }),
  ];
  let pagesAsked = 0;
  const youtube = () =>
    ({
      myChannelId: async () => "UCown",
      listChannelComments: async (_id: string, pages = 1) => (
        (pagesAsked = pages),
        threads
      ),
      replyToComment: async (id: string, text: string) => (
        sent.push([id, text]),
        `r_${id}`
      ),
    }) as never;
  let calls = 0;
  const llm = {
    structured: async (o: {
      tier?: string;
      site?: string;
      content: string;
    }) => {
      calls++;
      assert.equal(o.tier, "low", "the small model tier");
      assert.equal(o.site, "community.reply", "routable to Codex");
      assert.ok(
        !/vidZZZZZZZZ|from three weeks ago|our own comment/.test(o.content),
      );
      return {
        verdicts: [
          v(
            "a",
            "opinion",
            "Quake would be the dream pairing. Nothing is announced yet.",
            3,
          ),
          v("b", "opinion", "A new Hexen would be a sneaky great pick.", 2),
          v("c", "opinion", "Heretic deserves it too.", 1),
          v("d", "self_promo", ""),
        ],
      };
    },
  } as never;
  return {
    db,
    sent,
    youtube,
    llm,
    calls: () => calls,
    pages: () => pagesAsked,
  };
}

test("community tick: answers each real viewer once, records hearts and pins, spends quota, never twice", async () => {
  resetViewerMemory();
  const now = new Date("2026-11-12T09:00:00Z");
  const s = await setup(now);
  const deps = {
    db: s.db,
    youtube: s.youtube,
    llm: s.llm,
    headroom: async () => 10_000,
    now: () => now,
  };
  assert.equal(await communityTick(deps), 2);
  assert.deepEqual(
    s.sent.map(([id]) => id),
    ["a", "b"],
    "viewer_b's second comment waits: one reply per person per video",
  );
  assert.equal(s.pages(), VIEWER_LIMITS.pages);
  const rows = await s.db.query<{
    comment_id: string;
    decision: string;
    heart: boolean;
    author_channel: string;
    pin_score: number;
  }>(
    `SELECT comment_id, decision, heart, author_channel, pin_score FROM comment_replies ORDER BY comment_id`,
  );
  assert.deepEqual(
    rows.map((r) => [r.comment_id, r.decision, r.heart]),
    [
      ["a", "reply", true],
      ["b", "reply", true],
      ["c", "skip", true],
      ["d", "skip", false],
    ],
  );
  const [ledger] = await s.db.query<{ units: number }>(
    `SELECT units FROM quota_ledger`,
  );
  assert.equal(Number(ledger!.units), VIEWER_LIMITS.pages + 2 * 50);
  // Inside fifteen minutes nothing is read again; later, nothing judged is judged or answered twice.
  assert.equal(await communityTick(deps), 0);
  assert.equal(
    await communityTick({
      ...deps,
      now: () => new Date(now.getTime() + 20 * 60_000),
    }),
    0,
  );
  assert.equal(s.calls(), 1);
  assert.equal(s.sent.length, 2);

  // The Studio plan: hearts for the real comments, one pin, minus what the routine already did.
  const plan = await viewerPlan(
    s.db,
    now,
    [
      heartKey({
        authorName: "@viewer_b",
        text: "Would love a new Hexen while they are at it",
      }),
    ],
    [],
  );
  assert.deepEqual(plan.hearts.map((h) => h.author).sort(), [
    "@viewer_a",
    "@viewer_b",
  ]);
  assert.match(
    plan.hearts[0]!.url,
    /^https:\/\/www\.youtube\.com\/watch\?v=vidAAAAAAAA&lc=/,
  );
  assert.deepEqual(
    plan.pins.map((p) => p.author),
    ["@viewer_a"],
  );
  assert.equal(
    (await viewerPlan(s.db, now, [], ["vidAAAAAAAA"])).pins.length,
    0,
  );
  await s.db.close();
});

test("community tick: no quota, a pass cap or the owner's hold leave comments fresh", async () => {
  resetViewerMemory();
  const now = new Date("2026-11-12T09:00:00Z");
  const s = await setup(now);
  const base = { db: s.db, youtube: s.youtube, llm: s.llm, now: () => now };
  assert.equal(await communityTick({ ...base, headroom: async () => 10 }), 0);
  assert.equal(s.calls(), 0, "no quota: not even judged");
  resetViewerMemory();
  assert.equal(
    await communityTick({ ...base, headroom: async () => 10_000, perPass: 1 }),
    1,
  );
  const replied = await s.db.query(
    `SELECT 1 FROM comment_replies WHERE comment_id = 'b'`,
  );
  assert.equal(
    replied.length,
    0,
    "held back by the cap, not judged: answered on a later pass",
  );
  await s.db.query(
    `INSERT INTO settings (key, value) VALUES ('publish_hold', 'on')`,
  );
  resetViewerMemory();
  assert.equal(
    await communityTick({ ...base, headroom: async () => 10_000 }),
    0,
  );
  await s.db.close();
});

test("the channel comment list reads author names and who replied, page by page", async () => {
  const urls: string[] = [];
  const pages = [
    {
      items: [
        {
          id: "t1",
          snippet: {
            videoId: "v1",
            totalReplyCount: 1,
            topLevelComment: {
              id: "c1",
              snippet: {
                textOriginal: "hi",
                authorDisplayName: "@a",
                authorChannelId: { value: "UCa" },
                likeCount: 2,
                publishedAt: at,
              },
            },
          },
          replies: {
            comments: [{ snippet: { authorChannelId: { value: "UCown" } } }],
          },
        },
      ],
      nextPageToken: "p2",
    },
    {
      items: [
        {
          id: "t2",
          snippet: {
            videoId: "v2",
            topLevelComment: {
              id: "c2",
              snippet: {
                textOriginal: "yo",
                authorChannelId: { value: "UCb" },
              },
            },
          },
        },
      ],
    },
  ];
  const fetchFn = (async (u: string) => {
    urls.push(String(u));
    return new Response(JSON.stringify(pages[urls.length - 1]), {
      status: 200,
    });
  }) as typeof fetch;
  const yt = new YouTubeClient(async () => "tok", fetchFn);
  const list = await yt.listChannelComments("UCown", 2);
  assert.equal(urls.length, 2);
  assert.match(urls[0]!, /part=snippet%2Creplies/);
  assert.match(urls[1]!, /pageToken=p2/);
  assert.deepEqual(list[0], {
    id: "c1",
    videoId: "v1",
    text: "hi",
    authorChannelId: "UCa",
    likes: 2,
    replies: 1,
    publishedAt: at,
    authorName: "@a",
    replyAuthors: ["UCown"],
  });
  assert.equal(list[1]!.authorName, "");
});

test("the engine is off by default and takes the reply passes' place when on", async () => {
  const dir = await tmpDir();
  assert.equal(testConfig(dir).communityEngine, false);
  const env = fs.readFileSync(
    path.join(import.meta.dirname, "..", ".env.example"),
    "utf8",
  );
  assert.match(env, /# COMMUNITY_ENGINE=true/);
  const server = fs.readFileSync(
    path.join(import.meta.dirname, "..", "src", "server.ts"),
    "utf8",
  );
  assert.match(server, /if \(cfg\.communityEngine && !cfg\.dryRun\)/);
  assert.match(
    server,
    /if \(cfg\.commentReplies && !cfg\.communityEngine && !cfg\.dryRun\)/,
  );
});

test("posting-time report: a platform that counted nothing says so instead of 'about the same'", () => {
  const fb = (h: number, d: number) => ({
    platform: "facebook",
    at: new Date(`2026-11-0${d}T${h}:00:00Z`),
    views: 0,
  });
  const lines = primeTimeLines([
    fb(21, 1),
    fb(21, 2),
    fb(21, 3),
    fb(15, 1),
    fb(15, 2),
    fb(15, 3),
  ]);
  const line = lines.find((l) => l.includes("Facebook"))!;
  assert.match(
    line,
    /no reach to compare: Facebook's own numbers give 0 views on all 6 posts/,
  );
  assert.doesNotMatch(line, /about the same/);
});

test("community tick: an older pass's answer stands, its 'nothing to add' skip gets one engine judgement", async () => {
  resetViewerMemory();
  const now = new Date("2026-11-12T09:00:00Z");
  const s = await setup(now);
  await s.db.query(
    `INSERT INTO comment_replies (comment_id, episode_id, video_id, comment, decision, reason, reply_text)
     VALUES ('a', 'ep_v', 'vidAAAAAAAA', 'Quake', 'reply', 'old pass', 'Quake would rule.'),
            ('b', 'ep_v', 'vidAAAAAAAA', 'Hexen', 'skip', 'adds nothing', NULL)`,
  );
  assert.equal(await communityTick({ db: s.db, youtube: s.youtube, llm: s.llm, headroom: async () => 10_000, now: () => now }), 1);
  assert.deepEqual(s.sent.map(([id]) => id), ["b"]);
  const [b] = await s.db.query<{ decision: string; kind: string; heart: boolean }>(
    `SELECT decision, kind, heart FROM comment_replies WHERE comment_id = 'b'`,
  );
  assert.deepEqual(b, { decision: "reply", kind: "opinion", heart: true });
  const [a] = await s.db.query<{ reply_text: string }>(`SELECT reply_text FROM comment_replies WHERE comment_id = 'a'`);
  assert.equal(a!.reply_text, "Quake would rule.");
  await s.db.close();
});
