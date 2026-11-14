import { test } from "node:test";
import assert from "node:assert/strict";
import { goodScript, testDb } from "./helpers.ts";
import {
  answerability,
  cardText,
  filedQuestions,
  hookForRepetition,
  isQuestion,
  pickQuestion,
  pointerText,
  publicHandle,
  replyBrief,
  replyCluster,
  replyDescriptionLine,
  replyPointers,
  replyProblems,
  repliesToday,
  screenQuestion,
  usedComments,
  type FiledComment,
} from "../src/commentreply.ts";
import { commentCardFrames } from "../src/render/components/CommentCard.tsx";

const FACTS =
  "Starfield's second expansion has been delayed to early 2027. Bethesda confirmed the move on Xbox Wire and says the extra time will go on polish and performance. The expansion was previously due this December.";

const comment = (o: Partial<FiledComment> = {}): FiledComment => ({
  commentId: "c1",
  videoId: "vid1",
  episodeId: "ep1",
  text: "Why did Bethesda delay the expansion again?",
  author: "@starfan99",
  kind: "question",
  likes: 0,
  createdAt: "2026-11-12T10:00:00Z",
  ...o,
});

test("reply Shorts: a question is substantive, answerable from the facts, not hostile and has a public handle", () => {
  assert.ok(isQuestion("why shut down i love this game"));
  assert.ok(isQuestion("Is it on PS5?"));
  assert.ok(!isQuestion("Great video, loved it"));
  assert.equal(publicHandle("@starfan99"), "@starfan99");
  assert.equal(
    publicHandle("John Smith"),
    undefined,
    "a display name never goes on screen",
  );
  assert.deepEqual(
    answerability("Why did Bethesda delay the expansion?", FACTS).sort(),
    ["beth", "dela", "expa"],
  );

  assert.equal(screenQuestion(comment(), FACTS).ok, true);
  assert.match(
    screenQuestion(
      comment({ text: "Why is Sony so useless at launches?" }),
      FACTS,
    ).why,
    /do not answer/,
  );
  assert.match(
    screenQuestion(comment({ kind: "opinion" }), FACTS).why,
    /not a question/,
  );
  assert.match(
    screenQuestion(comment({ text: "Why do you guys use an AI voice?" }), FACTS)
      .why,
    /about the channel/,
  );
  assert.match(
    screenQuestion(comment({ author: "Jane Doe" }), FACTS).why,
    /public handle/,
  );
  assert.match(
    screenQuestion(
      comment({ text: "why delay this trash, are you idiots?" }),
      FACTS,
    ).why,
    /hostile/,
  );
  assert.match(
    screenQuestion(comment({ text: "delay?" }), FACTS).why,
    /too short/,
  );
  // A short question needs all of its few content words: "shut" alone in "why shut down i love this game".
  assert.equal(
    screenQuestion(
      comment({ text: "why shut down i love this game" }),
      "The servers shut down in March.",
    ).ok,
    true,
  );
  // The older passes filed a question in their reason text.
  assert.equal(
    screenQuestion(
      comment({ kind: "Sincere question and affection for the game" }),
      FACTS,
    ).ok,
    true,
  );
});

test("reply Shorts: the day's pick is the most answerable, then most liked, never one already answered", () => {
  const a = comment({ commentId: "a", text: "Why the delay?" });
  const b = comment({
    commentId: "b",
    text: "Why did Bethesda delay the Starfield expansion to 2027?",
    likes: 3,
  });
  const c = comment({
    commentId: "c",
    text: "Why did Bethesda delay the expansion?",
    episodeId: "missing",
  });
  const facts = (id: string) => (id === "ep1" ? FACTS : undefined);
  assert.equal(pickQuestion([a, b, c], facts, new Set())?.commentId, "b");
  assert.equal(pickQuestion([a, b, c], facts, new Set(["b"]))?.commentId, "a");
  assert.equal(pickQuestion([c], facts, new Set()), undefined);
});

test("reply Shorts: the story, brief, house rules, card, description and pointer", () => {
  const original = {
    story_json: {
      hash: "h",
      headline: "Starfield delayed",
      items: [],
      sources: ["Xbox Wire"],
      hasOfficial: true,
      corroborated: true,
      rumourSignals: false,
      newestAt: "",
      score: 70,
      why: { question: "q", angle: "a" },
    },
    script_json: goodScript(),
  } as any;
  const long =
    "Why did Bethesda delay the expansion again when they said December was locked in and the team was finished, I really want to know what changed this time around?";
  const cl = replyCluster(original, comment({ text: long }));
  assert.equal(cl.hash, "reply:c1");
  assert.ok(cl.headline.startsWith("You asked: "));
  assert.equal(cl.why, undefined, "a reply never answers to the Why's rules");
  assert.equal(cl.gameHint, "Starfield");
  assert.equal(cl.reply!.handle, "@starfan99");
  assert.ok(cl.reply!.card.length <= 153 && cl.reply!.card.endsWith("..."));
  assert.equal(cardText("Short one?"), "Short one?");
  assert.match(replyBrief(cl.reply!), /begins with the words "You asked"/);

  const ok = goodScript({
    hook: "You asked why Starfield's expansion slipped again. Here's why.",
  });
  assert.deepEqual(replyProblems(ok, cl.reply!), []);
  assert.match(
    replyProblems(goodScript(), cl.reply!)[0]!,
    /must begin with "You asked"/,
  );
  assert.match(
    replyProblems(
      goodScript({ hook: "You asked, starfan99, why it slipped." }),
      cl.reply!,
    ).join(" "),
    /handle aloud/,
  );
  assert.equal(
    hookForRepetition("You asked why it slipped. Here's why."),
    "Here's why.",
  );

  assert.match(
    replyDescriptionLine(cl.reply!),
    /^Answering @starfan99's question from the comments under https:\/\/youtu\.be\/vid1\./,
  );
  assert.match(
    pointerText(cl.reply!, "NEWID"),
    /https:\/\/youtube\.com\/shorts\/NEWID$/,
  );
  assert.ok(
    !/https?:\/\/(?!youtube\.com\/shorts)/.test(
      pointerText(cl.reply!, "NEWID"),
    ),
  );
  assert.equal(commentCardFrames(60, 30), 75, "never under 2.5 s");
  assert.equal(commentCardFrames(200, 30), 135, "never over 4.5 s");
  assert.equal(commentCardFrames(100, 30), 100);
});

test("reply Shorts: filed questions, the daily cap and one pointer reply once the Short is public", async () => {
  const db = await testDb();
  const now = new Date();
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane, script_json, youtube_video_id) VALUES ('ep1', 'h1', 'published', '{"headline":"x","items":[]}', 'news', $1, 'vid1')`,
    [JSON.stringify(goodScript())],
  );
  await db.query(
    `INSERT INTO comment_replies (comment_id, episode_id, video_id, comment, decision, reason, author_name, kind) VALUES
       ('q1', 'ep1', 'vid1', 'Why did Bethesda delay it?', 'reply', 'question', '@fan', 'question'),
       ('q2', 'ep1', 'vid1', 'Great video', 'reply', 'praise', '@fan2', 'praise'),
       ('q3', 'ep1', 'vid1', 'Is it out on PS5?', 'reply', 'Sincere question about platforms', '@fan3', NULL)`,
  );
  const filed = await filedQuestions(db, now);
  assert.deepEqual(filed.map((f) => f.commentId).sort(), ["q1", "q3"]);
  assert.equal(await repliesToday(db, "Europe/London"), 0);

  const story = replyCluster(
    {
      story_json: { hash: "h1", headline: "x", items: [] } as any,
      script_json: goodScript(),
    } as any,
    filed.find((f) => f.commentId === "q1")!,
  );
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane, youtube_video_id) VALUES ('ep_r', $1, 'published', $2, 'news', 'NEWSHORT')`,
    [story.hash, JSON.stringify(story)],
  );
  assert.equal(await repliesToday(db, "Europe/London"), 1);
  assert.deepEqual([...(await usedComments(db))], ["q1"]);

  const sent: Array<[string, string]> = [];
  const deps = {
    db,
    reply: async (id: string, text: string) => {
      sent.push([id, text]);
      return "r1";
    },
    headroom: async () => 1000,
    now,
  };
  assert.equal(
    await replyPointers(deps),
    0,
    "nothing until the Short is public",
  );
  await db.query(
    `INSERT INTO events (episode_id, kind, detail) VALUES ('ep_r', 'public_confirmed', '{}')`,
  );
  assert.equal(await replyPointers(deps), 1);
  assert.deepEqual(sent[0]![0], "q1");
  assert.match(sent[0]![1], /youtube\.com\/shorts\/NEWSHORT/);
  assert.equal(await replyPointers(deps), 0, "once only");
  await db.close();
});
