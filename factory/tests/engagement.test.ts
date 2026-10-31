// Engagement around a documentary: the chapter list YouTube reads, the first comment's timestamp, the
// "next" documentary for the end card and the description, the two bookends' timing, and the community
// post and poll the owner pastes.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  finishChapters,
  hasChapterMarks,
  searchableTitle,
  stamp,
} from "../src/youtube/chapters.ts";
import {
  docPinnedComment,
  pinnedCommentProblems,
  pinnedMoment,
} from "../src/youtube/pinned.ts";
import { latestPublicDocumentary, nextLine } from "../src/youtube/nextdoc.ts";
import {
  COLD_OPEN_SECONDS,
  COLD_OPEN_LINE_MAX,
  END_CARD_SECONDS,
  coldOpenLine,
  coldOpenTiming,
  endCardTiming,
} from "../src/render/bookends.ts";
import {
  communityBlock,
  communityDrafts,
  communityPoll,
  spread,
} from "../src/social/community.ts";
import { docToScript, type DocDraft } from "../src/editorial/documentary.ts";
import { pinnedComment } from "../src/editorial/seo.ts";
import { longChapters, segmentInputs, videoMetadata } from "../src/pipeline.ts";
import type { Episode } from "../src/episodes.ts";
import { goodScript, testDb } from "./helpers.ts";

// ------------------------------------------------------------------ fixtures

const words = (n: number, seed: string) =>
  Array.from({ length: n }, (_, i) => (i === 0 ? seed : `w${i}`)).join(" ") +
  ".";

const GAMES = [
  {
    title: "Grand Theft Auto",
    year: 1997,
    chapter: "A Top-Down Game From Dundee",
  },
  {
    title: "Grand Theft Auto III",
    year: 2001,
    chapter: "GTA III and the Leap to 3D",
  },
  {
    title: "Grand Theft Auto: Vice City",
    year: 2002,
    chapter: "Vice City and the Eighties",
  },
  {
    title: "Grand Theft Auto: San Andreas",
    year: 2004,
    chapter: "San Andreas Goes Statewide",
  },
  { title: "Grand Theft Auto IV", year: 2008, chapter: "Liberty City Rebuilt" },
  {
    title: "Grand Theft Auto V",
    year: 2013,
    chapter: "Los Santos and the Online Decade",
  },
];

function draft(n = 6): DocDraft {
  const chapters = GAMES.slice(0, n).map((g, ci) => {
    const plan = {
      chapter_title: g.chapter,
      game_title: g.title,
      wiki_title: g.title,
      steam_search_term: g.title,
      year: g.year,
      platforms: "PC, PS2",
      focus: "the leap",
      photo_searches: [] as string[],
    };
    return {
      plan,
      chapter: {
        paragraphs: Array.from({ length: 4 }, (_, i) => ({
          narration: words(60, `c${ci}p${i}`),
          callout: { kind: "none" as const, primary: "", secondary: "" },
          footage: { want: "gameplay" as const, keywords: [`${g.title} ${i}`] },
        })),
        claims: [{ claim: `${g.title} sold well`, section: "Sales" }],
      },
      source: {
        title: g.title,
        url: `https://en.wikipedia.org/wiki/${g.title.replace(/ /g, "_")}`,
        text: "## Overview\nReleased.",
      },
    };
  });
  return {
    topic: {
      kind: "franchise",
      franchise_index: 0,
      story_index: -1,
      franchise: "Grand Theft Auto",
      title_idea: "The Complete History of GTA",
      angle: "x",
      reason: "y",
    },
    outline: {
      question: "How did a Dundee studio's top-down game become GTA?",
      title: "The Complete History of Grand Theft Auto",
      kicker: "From Dundee to Leonida",
      franchise_wiki_title: "Grand Theft Auto",
      chapters: chapters.map((c) => c.plan),
      youtube: {
        title: "How a Dundee Studio Built Grand Theft Auto",
        description: "All of it, game by game.",
        tags: ["GTA"],
      },
    },
    chapters,
    bookends: {
      intro: {
        narration:
          "On October 22, 2001, in a converted warehouse in Edinburgh, Sam Houser watched the first reviews of Grand Theft Auto III arrive. " +
          words(130, "By"),
        on_screen: "From Dundee to Leonida",
      },
      outro: {
        label: "What comes next",
        narration: words(120, "Now"),
        on_screen: "Thirty years in",
      },
    },
  };
}

/** Synthetic word timings: 0.4 s a word, as the voice would give. */
function timed(s: ReturnType<typeof docToScript>) {
  const all = segmentInputs(s).flatMap((x) =>
    x.text.split(/\s+/).filter(Boolean),
  );
  return all.map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.35 }));
}

function docEpisode(overrides: Partial<Episode> = {}): Episode {
  const script = docToScript(draft());
  const w = timed(script);
  return {
    id: "ep_doc",
    story_hash: "h",
    status: "uploaded",
    story_json: { headline: "x", items: [] } as never,
    script_json: script,
    factcheck_json: null,
    assets_json: { words: w, durationSeconds: w.at(-1)!.end + 0.5 },
    qa_json: null,
    approval_mode: null,
    approved_by: null,
    approval_requested_at: null,
    upload_session_uri: null,
    youtube_video_id: "vid_doc",
    youtube_status: null,
    publish_at: null,
    lane: "evergreen",
    priority: 50,
    slot_at: null,
    attempts: 0,
    last_error: null,
    next_attempt_at: null,
    created_at: "2026-10-30T10:00:00Z",
    updated_at: "2026-10-30T10:00:00Z",
    ...overrides,
  };
}

// ------------------------------------------------------------------ chapters

test("chapter marks: 0:00 first, three or more, ten seconds apart, searchable titles, never twice", () => {
  assert.deepEqual(
    finishChapters([
      "0:00 Intro",
      "0:04 Too soon",
      "1:30 Part 2: The Leap to 3D",
      "2:00 Chapter 3",
      "70:05 Legacy",
    ]),
    ["0:00 Intro", "1:30 The Leap to 3D", "1:10:05 Legacy"],
  );
  // The first mark within a second of the start is written as 0:00; one later than that is not a list YouTube reads.
  assert.deepEqual(finishChapters(["0:01 Intro", "0:40 A", "1:20 B"]), [
    "0:00 Intro",
    "0:40 A",
    "1:20 B",
  ]);
  assert.deepEqual(finishChapters(["0:05 Intro", "0:40 A", "1:20 B"]), []);
  // Fewer than three usable marks: nothing rather than a broken list.
  assert.deepEqual(finishChapters(["0:00 Intro", "0:40 A"]), []);
  // A description that already carries marks keeps its own.
  assert.deepEqual(
    finishChapters(
      ["0:00 Intro", "0:40 A", "1:20 B"],
      "Our film.\n0:00 Start\n5:00 Middle\n",
    ),
    [],
  );
  assert.equal(hasChapterMarks("Out on 10:30 tonight"), false);
  assert.equal(searchableTitle("Part 3: The Fall."), "The Fall");
  assert.equal(searchableTitle("Entry 4"), "");
  assert.equal(stamp(3725), "1:02:05");
  assert.equal(stamp(65), "1:05");
});

test("a documentary's description carries its chapters from the real timeline and the next link up top", () => {
  const ep = docEpisode({
    assets_json: {
      ...docEpisode().assets_json,
      nextDoc: {
        id: "ep_prev",
        videoId: "prev123",
        title: "Why Xbox Lost a Generation",
        thumb: "thumb.jpg",
      },
    },
  });
  const lines = finishChapters(
    longChapters(ep),
    ep.script_json!.youtube.description,
  );
  assert.equal(lines[0], "0:00 Intro");
  assert.ok(lines.length >= 1 + GAMES.length, lines.join(" | "));
  assert.ok(lines.some((l) => / GTA III and the Leap to 3D$/.test(l)));
  const meta = videoMetadata(ep, "public");
  const [first, second] = meta.description.split("\n");
  assert.match(first!, /^The complete history of Grand Theft Auto/);
  assert.equal(
    second,
    "Next: Why Xbox Lost a Generation https://youtu.be/prev123",
  );
  assert.match(meta.description, /\nChapters:\n0:00 Intro\n/);
  // Without a next documentary the line is simply absent.
  const plain = videoMetadata(docEpisode(), "public");
  assert.doesNotMatch(plain.description, /^Next:/m);
  assert.equal(nextLine(undefined), "");
});

// ------------------------------------------------------------------ pinned comment

test("the documentary's first comment asks one question and points at a chapter by its timestamp", () => {
  const ep = docEpisode();
  const chapters = finishChapters(longChapters(ep));
  const text = docPinnedComment(ep.script_json!, chapters);
  const moment = pinnedMoment(chapters)!;
  assert.ok(moment.stamp !== "0:00", "never the intro");
  assert.notEqual(
    moment.title,
    chapters.at(-1)!.replace(/^\S+ /, ""),
    "never the outro",
  );
  assert.match(
    text,
    new RegExp(
      `turns at ${moment.stamp} \\(${moment.title.replace(/[()]/g, "\\$&")}\\)`,
    ),
  );
  assert.match(text, /^Which Grand Theft Auto game was the one for you\?/);
  assert.deepEqual(pinnedCommentProblems(text), []);
  // Without usable chapters the question still stands, without a timestamp.
  assert.doesNotMatch(docPinnedComment(ep.script_json!, []), /\d:\d\d/);
});

test("every pinned comment follows the owner's rule: a question, no 'let us know', American spelling", () => {
  const shapes = [
    goodScript(),
    goodScript({ story_type: "explainer" }),
    goodScript({ story_type: "rumour", is_rumour: true }),
    { ...goodScript(), evergreen_format: "steam_deals" as const },
    {
      ...goodScript(),
      runtime: "long" as const,
      entries: [
        {
          rank: 1,
          game_title: "A",
          steam_search_term: "A",
          year: 2001,
          platforms: "PC",
        },
      ],
    },
    docToScript(draft()),
  ];
  for (const s of shapes)
    assert.deepEqual(
      pinnedCommentProblems(pinnedComment(s)),
      [],
      pinnedComment(s),
    );
  assert.deepEqual(
    pinnedCommentProblems("Our favourite? Let me know in the comments"),
    ['says "let us know in the comments"', "British spelling: favourite"],
  );
  assert.deepEqual(pinnedCommentProblems("A statement with no question."), [
    "asks the viewer nothing",
  ]);
});

// ------------------------------------------------------------------ next documentary

test("the next documentary is the newest public one: long, a documentary, live, never itself", async () => {
  const db = await testDb();
  const now = new Date("2026-10-30T12:00:00Z");
  const insert = (
    id: string,
    status: string,
    script: Record<string, unknown>,
    video: string | null,
    publishAt: string | null,
    updated: string,
  ) =>
    db.query(
      `INSERT INTO episodes (id, story_hash, status, story_json, script_json, assets_json, youtube_video_id, publish_at, updated_at)
       VALUES ($1, $1, $2, '{}', $3, '{"thumb":"thumb.jpg"}', $4, $5, $6)`,
      [id, status, JSON.stringify(script), video, publishAt, updated],
    );
  const doc = (title: string) => ({
    runtime: "long",
    evergreen_format: "documentary",
    youtube: { title },
  });
  await insert(
    "old",
    "published",
    doc("Old Doc"),
    "v_old",
    "2026-10-01T19:00:00Z",
    "2026-10-01T19:05:00Z",
  );
  await insert(
    "newest",
    "published",
    doc("Newest Doc"),
    "v_new",
    "2026-10-27T19:00:00Z",
    "2026-10-27T19:05:00Z",
  );
  await insert(
    "future",
    "published",
    doc("Scheduled Doc"),
    "v_fut",
    "2026-11-03T19:00:00Z",
    "2026-10-30T11:00:00Z",
  );
  await insert(
    "ranking",
    "published",
    {
      runtime: "long",
      evergreen_format: "ranking",
      youtube: { title: "A Ranking" },
    },
    "v_rank",
    "2026-10-29T19:00:00Z",
    "2026-10-29T19:05:00Z",
  );
  await insert(
    "short",
    "published",
    { evergreen_format: "documentary", youtube: { title: "A Short" } },
    "v_short",
    "2026-10-29T20:00:00Z",
    "2026-10-29T20:05:00Z",
  );
  await insert(
    "failed",
    "failed",
    doc("Failed Doc"),
    "v_fail",
    "2026-10-29T21:00:00Z",
    "2026-10-29T21:05:00Z",
  );
  const next = await latestPublicDocumentary(db, now, "me");
  assert.deepEqual(next, {
    id: "newest",
    videoId: "v_new",
    title: "Newest Doc",
    thumb: "thumb.jpg",
  });
  // The episode being rendered is never its own next: the one before it is.
  assert.equal((await latestPublicDocumentary(db, now, "newest"))?.id, "old");
  // The scheduled one counts once its time has passed.
  assert.equal(
    (await latestPublicDocumentary(db, new Date("2026-11-04T00:00:00Z"), "me"))
      ?.id,
    "future",
  );
  await db.close();
});

// ------------------------------------------------------------------ bookends

test("the end card holds the last twenty seconds and the cold open the first three", () => {
  const fps = 30;
  const t = endCardTiming(40 * 60 * fps, fps);
  assert.equal(END_CARD_SECONDS, 20);
  assert.equal(t.frames, 20 * fps);
  assert.equal(t.from + t.frames, 40 * 60 * fps);
  assert.ok(t.nextIn < t.subscribeIn && t.subscribeIn < t.frames);
  // A clip shorter than two cards (a smoke render) gets half of itself, never a negative start.
  const small = endCardTiming(10 * fps, fps);
  assert.equal(small.frames, 5 * fps);
  assert.equal(small.from, 5 * fps);
  const c = coldOpenTiming(fps);
  assert.equal(COLD_OPEN_SECONDS, 3);
  assert.equal(c.frames, 90);
  assert.ok(
    c.markIn < c.lineIn && c.lineIn < c.fadeOutFrom && c.fadeOutFrom < c.frames,
  );
});

test("the cold open's line is the hook's first sentence, cut at a clause when it runs long", () => {
  const hook = docToScript(draft()).hook;
  // The first sentence runs to 124 characters: it ends at the last clause break before the limit.
  assert.equal(
    coldOpenLine(hook),
    "On October 22, 2001, in a converted warehouse in Edinburgh",
  );
  assert.ok(coldOpenLine(hook).length <= COLD_OPEN_LINE_MAX);
  assert.equal(
    coldOpenLine(
      "Metal Gear Solid V grossed $179 million on day one. Then it stopped.",
    ),
    "Metal Gear Solid V grossed $179 million on day one",
  );
  assert.equal(
    coldOpenLine("Who built Xbox? Nobody agrees."),
    "Who built Xbox?",
  );
});

// ------------------------------------------------------------------ community

test("community post and poll come from the chapters, with no model call", () => {
  const s = docToScript(draft());
  const d = communityDrafts(s, "vid_doc");
  const lines = d.post.split("\n");
  assert.equal(lines.length, 3);
  assert.match(
    lines[0]!,
    /^New documentary: How a Dundee Studio Built Grand Theft Auto\. 6 chapters, from Grand Theft Auto \(1997\) to Grand Theft Auto V \(2013\)\.$/,
  );
  assert.match(lines[1]!, /\?$/);
  assert.equal(lines[2], "Watch: https://youtu.be/vid_doc");
  assert.equal(d.poll!.question, "Which Grand Theft Auto game was the peak?");
  assert.equal(d.poll!.options.length, 4);
  assert.equal(d.poll!.options[0], "Grand Theft Auto");
  assert.equal(d.poll!.options.at(-1), "Grand Theft Auto V");
  assert.ok(d.poll!.options.every((o) => o.length <= 36));
  assert.deepEqual(spread([1, 2, 3, 4, 5, 6], 4), [1, 3, 4, 6]);
  // Fewer than three distinct games: a post, no poll.
  assert.equal(communityPoll(docToScript(draft(2))), undefined);
  assert.match(communityBlock(d), /^Community post to paste:\n/);
  assert.match(
    communityBlock(d),
    /\nPoll to paste:\nWhich Grand Theft Auto game was the peak\?\n• Grand Theft Auto\n/,
  );
  assert.doesNotMatch(communityBlock(d), /\u2014/);
});
