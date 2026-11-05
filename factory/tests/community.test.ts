import { test } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers.ts";
import { arguableQuestion, firstComment } from "../src/social/firstcomment.ts";
import {
  firstCommentCheckTick,
  firstCommentStats,
  parsePublicComments,
  pinPlan,
} from "../src/social/commentcheck.ts";
import {
  metaRepliesTick,
  resetMetaMemory,
} from "../src/social/metacomments.ts";
import {
  scoreboardLines,
  socialBoard,
  socialProblems,
} from "../src/social/scoreboard.ts";
import { LAUNCH_POSTS } from "../src/social/launchcommunity.ts";
import {
  artTitles,
  engageTick,
  EngageTopicSchema,
} from "../src/social/engage.ts";
import { testConfig, tmpDir } from "./helpers.ts";
import {
  askBackAllowed,
  polishReply,
  replyToFollowups,
  resetReplyMemory,
} from "../src/youtube/replies.ts";
import { pinnedCommentProblems } from "../src/youtube/pinned.ts";

const NOW = new Date("2026-11-05T12:00:00Z");

const story = (over: Record<string, unknown> = {}) =>
  ({
    headline: "Elder Scrolls 6 is officially Sentinel",
    hook: "Bethesda finally named the next Elder Scrolls.",
    loop_line:
      "Will you replay Skyrim before Sentinel, or save Tamriel for Hammerfell?",
    game_title: "The Elder Scrolls VI",
    story_type: "announcement",
    pulse_take: { on_screen: "STEADY: a name, no date yet", narration: "" },
    youtube: { title: "Elder Scrolls 6", description: "" },
    beats: [],
    ...over,
  }) as any;

test("the first comment asks the video's own question and passes the pinned rule", () => {
  const text = firstComment(story());
  assert.match(text, /^Will you replay Skyrim before Sentinel/);
  assert.doesNotMatch(text, /What do you make of it/);
  assert.deepEqual(pinnedCommentProblems(text), []);
});

test("a stamp is never read out and a tease for the next video is not used", () => {
  const text = firstComment(story());
  assert.doesNotMatch(text, /STEADY:/);
  assert.match(text, /a name, no date yet/);
  assert.equal(
    arguableQuestion(
      story({
        loop_line:
          "The next Why lands tomorrow, so why did Konami's best Silent Hill reach casinos?",
      }),
    ),
    "",
  );
  // No question at the end of the video: the old opener stays, so the comment still asks something.
  assert.match(firstComment(story({ loop_line: "" })), /\?/);
});

test("a ranking's criterion is not used as a game's name", () => {
  const text = firstComment(
    story({
      evergreen_format: "ranked",
      entries: [{ rank: 1, game_title: "Super Mario Odyssey", year: 2017 }],
      game_title: "3D Super Mario games",
      pulse_take: { on_screen: "Precision beats extra freedom", narration: "" },
    }),
  );
  assert.doesNotMatch(text, /games game/);
  assert.match(text, /Which one would you move up or down the list\?/);
});

test("replies lose the stock opener, keep whole sentences and ask back only when allowed", () => {
  assert.equal(
    polishReply(
      "Fair point, Fallout 4 does have factions. Which ending was yours?",
      {
        askBack: true,
      },
    ),
    "Fallout 4 does have factions. Which ending was yours?",
  );
  assert.equal(
    polishReply(
      "Fair point, Fallout 4 does have factions. Which ending was yours?",
      {
        askBack: false,
      },
    ),
    "Fallout 4 does have factions.",
  );
  // A decimal is not a sentence end, and over length only the closing question goes.
  assert.equal(
    polishReply("The requirement is 14.22, reportedly. Does a 14.22 download bother you?", { askBack: false }),
    "The requirement is 14.22, reportedly.",
  );
  const long = `${"The map is big and it is reportedly unconfirmed, so wait. ".repeat(4)}Will you wait?`;
  const out = polishReply(long, { askBack: true });
  assert.ok(out.endsWith("wait."));
  assert.equal(out.match(/unconfirmed/g)?.length, 4);
  assert.equal(askBackAllowed(["a?", "b?", "c?", "d."]), false);
  assert.equal(askBackAllowed(["a?", "b.", "c.", "d?"]), true);
});

const apiReply = (entries: Array<[string, boolean, string]>) => ({
  frameworkUpdates: {
    entityBatchUpdate: {
      mutations: entries.map(([id, isCreator, content]) => ({
        payload: {
          commentEntityPayload: {
            properties: { commentId: id, content: { content } },
            author: { isCreator },
          },
        },
      })),
    },
  },
});

function pageFetch(entries: Array<[string, boolean, string]>) {
  return (async (url: any) => {
    if (String(url).includes("/watch"))
      return new Response(
        `"INNERTUBE_API_KEY":"k" "INNERTUBE_CLIENT_VERSION":"2" "continuationCommand":{"token":"t","request":"CONTINUATION_REQUEST_TYPE_WATCH_NEXT"}`,
      );
    return new Response(JSON.stringify(apiReply(entries)));
  }) as typeof fetch;
}

async function postedComment(
  db: Awaited<ReturnType<typeof testDb>>,
  id: string,
  ageHours = 12,
) {
  await db.query(
    `INSERT INTO episodes (id, story_hash, lane, status, story_json, youtube_video_id, created_at, updated_at)
     VALUES ($1, $1, 'news', 'published', '{}', $2, $3, $3)`,
    [id, `v_${id}`, NOW],
  );
  await db.query(
    `INSERT INTO events (episode_id, kind, detail, created_at) VALUES ($1, 'comment_posted', $2, $3)`,
    [
      id,
      JSON.stringify({ id: `c_${id}`, text: "Our question?" }),
      new Date(NOW.getTime() - ageHours * 3600_000),
    ],
  );
}

test("the public list is parsed, and a hidden first comment is logged, explained and told once", async () => {
  assert.deepEqual(parsePublicComments(apiReply([["a", true, "hi"]])), [
    { id: "a", text: "hi", byChannel: true },
  ]);
  const db = await testDb();
  for (const i of [1, 2, 3, 4, 5]) await postedComment(db, `ep_${i}`);
  await postedComment(db, "ep_young", 1); // too new to judge
  const told: string[] = [];
  const deps = {
    db,
    now: () => NOW,
    fetchFn: pageFetch([["x", false, "a viewer"]]),
    youtube: () => ({ commentStatus: async () => "likelySpam" }) as any,
    notify: async (m: { content: string }) => void told.push(m.content),
  };
  assert.equal(await firstCommentCheckTick(deps), 5);
  assert.deepEqual(await firstCommentStats(db, NOW), { checked: 5, hidden: 5 });
  const [row] = await db.query<{ detail: any }>(
    `SELECT detail FROM events WHERE kind = 'first_comment_check' LIMIT 1`,
  );
  assert.equal(row!.detail.moderation, "likelySpam");
  assert.equal(told.length, 1);
  assert.match(told[0]!, /5 of the last 5/);
  await postedComment(db, "ep_6");
  assert.equal(await firstCommentCheckTick(deps), 1);
  assert.equal(told.length, 1, "at most one alert a week");
});

test("a visible first comment or an unreadable page raises nothing", async () => {
  const db = await testDb();
  await postedComment(db, "ep_a");
  const told: string[] = [];
  const base = {
    db,
    now: () => NOW,
    notify: async (m: { content: string }) => void told.push(m.content),
  };
  // Unreadable: no result is logged, so it is tried again.
  assert.equal(
    await firstCommentCheckTick({
      ...base,
      fetchFn: (async () => new Response("", { status: 500 })) as typeof fetch,
    }),
    0,
  );
  assert.equal(
    await firstCommentCheckTick({
      ...base,
      fetchFn: pageFetch([["own", true, "Our question?"]]),
    }),
    1,
  );
  assert.deepEqual(await firstCommentStats(db, NOW), { checked: 1, hidden: 0 });
  assert.equal(told.length, 0);
});

test("the pin plan lists recent first comments and leaves out finished ones", async () => {
  const db = await testDb();
  await postedComment(db, "ep_p1");
  await postedComment(db, "ep_p2");
  const all = await pinPlan(db, NOW, []);
  assert.equal(all.length, 2);
  assert.match(all[0]!.url, /watch\?v=/);
  const rest = await pinPlan(db, NOW, [all[0]!.video]);
  assert.deepEqual(
    rest.map((r) => r.video),
    [all[1]!.video],
  );
});

function fakeLlm(decide: (ids: string[]) => any[]) {
  const calls: any[] = [];
  return {
    calls,
    llm: {
      structured: async (req: any) => {
        calls.push(req);
        const ids = [...String(req.content).matchAll(/^(\S+): /gm)].map(
          (m) => m[1]!,
        );
        return { decisions: decide(ids) };
      },
    } as any,
  };
}

async function crossposted(
  db: Awaited<ReturnType<typeof testDb>>,
  platform: string,
  post: string,
) {
  await db.query(
    `INSERT INTO episodes (id, story_hash, lane, status, story_json, script_json, created_at, updated_at)
     VALUES ('ep_m', 'ep_m', 'news', 'published', '{}', $1, $2, $2) ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(story()), NOW],
  );
  await db.query(
    `INSERT INTO events (episode_id, kind, detail, created_at) VALUES ('ep_m', 'crosspost', $1, $2)`,
    [JSON.stringify({ platform, id: post }), NOW],
  );
}

test("Instagram comments are judged once, our own are ignored, and the cap holds", async () => {
  resetMetaMemory();
  const db = await testDb();
  await crossposted(db, "instagram", "m1");
  const sent: string[] = [];
  const { llm, calls } = fakeLlm((ids) =>
    ids.map((id) => ({
      id,
      action: "reply",
      reason: "nod",
      reply: "Fair point, Hammerfell has been a long wait.",
    })),
  );
  const comments = ["a", "b", "c", "d", "e", "f"].map((id) => ({
    id,
    text: `comment ${id}`,
    own: false,
  }));
  const deps = {
    db,
    llm,
    now: () => NOW,
    list: async () => [
      ...comments,
      { id: "us", text: "our link comment", own: true },
    ],
    reply: async (_: string, id: string, text: string) => {
      sent.push(`${id}:${text}`);
      return `r_${id}`;
    },
  };
  assert.equal(await metaRepliesTick(deps), 4, "four a post");
  assert.equal(sent[0], "a:Hammerfell has been a long wait.");
  assert.ok(!String(calls[0].content).includes("our link comment"));
  // Within the poll window nothing is asked again.
  assert.equal(await metaRepliesTick(deps), 0);
  assert.equal(calls.length, 1);
});

test("a viewer answering our reply gets one more answer; others and caps do not", async () => {
  resetReplyMemory();
  const db = await testDb();
  await db.query(
    `INSERT INTO episodes (id, story_hash, lane, status, story_json, script_json, created_at, updated_at)
     VALUES ('ep_f', 'ep_f', 'news', 'published', '{}', $1, $2, $2)`,
    [JSON.stringify(story()), NOW],
  );
  await db.query(
    `INSERT INTO comment_replies (comment_id, episode_id, video_id, comment, decision, reason, reply_text, reply_id, created_at)
     VALUES ('T1', 'ep_f', 'vid', 'I love Skyrim', 'reply', 'nod', 'Skyrim still holds up.', 'r1', $1)`,
    [new Date(NOW.getTime() - 3600_000)],
  );
  const posted: Array<[string, string]> = [];
  let listed = 0;
  const after = new Date(NOW.getTime() - 60_000).toISOString();
  const yt = {
    listReplies: async () => {
      listed++;
      return [
        {
          id: "T1.ours",
          text: "Skyrim still holds up.",
          authorChannelId: "ME",
          authorName: "@PulseGMG",
          publishedAt: after,
        },
        {
          id: "T1.fan",
          text: "@PulseGMG it really does, the mods too",
          authorChannelId: "FAN",
          authorName: "@fan",
          publishedAt: after,
        },
        {
          id: "T1.other",
          text: "lol ok",
          authorChannelId: "OTHER",
          authorName: "@other",
          publishedAt: after,
        },
      ];
    },
    replyToComment: async (parent: string, text: string) => {
      posted.push([parent, text]);
      return "r2";
    },
  };
  const { llm, calls } = fakeLlm((ids) =>
    ids.map((id) => ({
      id,
      action: "reply",
      reason: "chat",
      reply: "The mods keep it alive.",
    })),
  );
  const deps = {
    db,
    llm,
    youtube: () => yt as any,
    headroom: async () => 10_000,
    now: () => NOW,
    style: true,
  };
  const threads = [{ id: "T1", replies: 3 }];
  assert.equal(await replyToFollowups(deps, threads, "ME"), 1);
  assert.deepEqual(posted, [["T1", "@fan The mods keep it alive."]]);
  assert.match(String(calls[0].content), /Earlier, the viewer said/);
  // Same count next pass: no quota spent looking again.
  assert.equal(await replyToFollowups(deps, threads, "ME"), 0);
  assert.equal(listed, 1);
});

test("the scoreboard says what posted, failed and went quiet, from stored rows only", async () => {
  const db = await testDb();
  const at = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
  const evt = (kind: string, platform: string, days: number) =>
    db.query(
      `INSERT INTO events (episode_id, kind, detail, created_at) VALUES (NULL, $1, $2, $3)`,
      [kind, JSON.stringify({ platform }), at(days)],
    );
  await evt("crosspost", "instagram", 1);
  await evt("crosspost", "instagram", 3);
  await evt("crosspost", "threads", 4); // nothing in the last two days
  for (let i = 0; i < 5; i++) await evt("crosspost_failed", "tiktok", 0.2);
  await db.query(
    `INSERT INTO social_metrics (platform, post_id, label, captured_at, views, comments, extra)
     VALUES ('instagram', 'p1', '24h', $1, 120, 2, '{}'), ('instagram', 'account', 'd1', $2, NULL, NULL, '{"followers":6}'), ('instagram', 'account', 'd2', $1, NULL, NULL, '{"followers":9}')`,
    [at(1), at(7)],
  );
  const board = await socialBoard(db, NOW);
  const text = scoreboardLines(board).join("\n");
  assert.match(
    text,
    /Instagram: 2 posted, 120 views, 2 comments, 0 answered, 9 followers \(\+3 this week\)/,
  );
  assert.match(text, /TikTok drafts: 0 posted, 5 failed, no view numbers/);
  assert.match(text, /Bluesky: nothing posted/);
  assert.doesNotMatch(text, /—/);
  const problems = (await socialProblems(db, NOW)).join("\n");
  assert.match(problems, /Threads has posted nothing for two days/);
  assert.match(problems, /TikTok drafts failed 5 times/);
  assert.doesNotMatch(problems, /Instagram/);
});

test("launch posts fit the post format, stay spoiler free and need no model call", () => {
  assert.deepEqual(Object.keys(LAUNCH_POSTS), [
    "2026-11-18",
    "2026-11-19",
    "2026-11-20",
    "2026-11-21",
  ]);
  for (const post of Object.values(LAUNCH_POSTS)) {
    EngageTopicSchema.parse(post);
    assert.ok(post.question.length < 70);
    assert.doesNotMatch(
      `${post.question} ${post.caption}`,
      /—|like if|share if|tag a friend/i,
    );
    assert.match(`${post.caption}`, /spoiler/i);
  }
});

test("a numbered game can be found under its Roman numeral", () => {
  assert.deepEqual(artTitles("Dark Souls 3"), [
    "Dark Souls 3",
    "Dark Souls III",
  ]);
  assert.deepEqual(artTitles("Halo: Reach"), ["Halo: Reach"]);
});

function engageDeps(
  db: Awaited<ReturnType<typeof testDb>>,
  cfg: any,
  now: Date,
  art: any[],
) {
  const seen = { llm: 0, posted: [] as string[], told: [] as string[] };
  return {
    seen,
    deps: {
      db,
      cfg,
      now: () => now,
      llm: {
        structured: async () => {
          seen.llm++;
          return {
            format: "question",
            games: ["Dark Souls 3"],
            kicker: "YOUR TAKE",
            question: "Hardest boss?",
            caption: "Tell us why.",
            answer: "",
          };
        },
      } as any,
      headlines: async () => [],
      candidates: async () => [],
      igdbArt: async () => art,
      render: async () => undefined,
      facebook: {
        photo: async (_: string, m: string) => (seen.posted.push(m), "fb1"),
        comment: async () => "c",
        comments: async () => 0,
      },
      notify: async (m: { content: string }) => void seen.told.push(m.content),
    },
  };
}

test("on a launch day the fixed post goes out with no model call", async () => {
  const db = await testDb();
  const cfg = testConfig(await tmpDir(), {
    launchCommunityPosts: true,
    engageSlot: "15:00",
    timezone: "Europe/London",
  });
  const { deps, seen } = engageDeps(
    db,
    cfg,
    new Date("2026-11-19T15:05:00Z"),
    [{ kind: "screenshot", file: "a.jpg" }],
  );
  await engageTick(deps);
  assert.equal(seen.llm, 0);
  assert.match(seen.posted[0]!, /first thing you did in Leonida/);
});

test("no pictures: the day stays open once, then the owner hears and the day closes", async () => {
  const db = await testDb();
  const cfg = testConfig(await tmpDir(), {
    engageRetry: true,
    engageSlot: "15:00",
    timezone: "Europe/London",
  });
  const { deps, seen } = engageDeps(db, cfg, new Date("2026-11-06T15:05:00Z"), []);
  await engageTick(deps);
  assert.equal(seen.told.length, 0);
  await engageTick(deps);
  assert.equal(seen.told.length, 1);
  assert.match(seen.told[0]!, /No community post today/);
  await engageTick(deps);
  assert.equal(seen.llm, 2, "two tries at most");
});
