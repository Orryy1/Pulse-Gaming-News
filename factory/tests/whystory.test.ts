import { test } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers.ts";
import {
  WHY_SEEDS,
  followRule,
  franchiseWords,
  hookOpening,
  hookShape,
  recentWhyHooks,
  sameFranchise,
  sameGame,
  whyBrief,
  whyCandidates,
  whyFollowProblems,
  whyFreshProblems,
  whyHookProblems,
  whyPinnedLine,
  whySlug,
  whyTopicPrompt,
} from "../src/editorial/why.ts";
import {
  followFor,
  pickLong,
  spokenFranchise,
} from "../src/youtube/longlink.ts";

test("the Why editor sees well-loved games with arcs first, rotated by the day, without duplicates", () => {
  const base = [
    { name: "Grand Theft Auto: San Andreas", source: "franchise seed" },
    { name: "Hades II", source: "steam top sellers" },
  ];
  const day1 = whyCandidates(base, "2026-11-01");
  const day2 = whyCandidates(base, "2026-11-02");
  assert.equal(day1[0]!.source, "well-loved game");
  assert.notEqual(day1[0]!.name, day2[0]!.name, "a different lead each day");
  assert.equal(day1.filter((c) => c.source === "well-loved game").length, 12);
  assert.ok(
    day1.some((c) => c.name === "Hades II"),
    "the store's list follows",
  );
  const all = whyCandidates(base, "2026-11-01", WHY_SEEDS.length);
  assert.equal(
    all.filter((c) => c.name === "Grand Theft Auto: San Andreas").length,
    1,
  );
  assert.match(whyTopicPrompt(), /San Andreas sequel/);
  assert.match(whyTopicPrompt(), /turning point/);
  assert.match(whyTopicPrompt(), /Games used recently/);
});

test("same game and same franchise are told apart", () => {
  assert.equal(sameGame("Grand Theft Auto IV", "grand theft auto iv"), true);
  assert.equal(sameGame("Grand Theft Auto IV", "Grand Theft Auto V"), false);
  assert.equal(
    franchiseWords("Grand Theft Auto: San Andreas"),
    "grand theft auto",
  );
  assert.equal(franchiseWords("Half-Life 2"), "half life");
  assert.equal(
    sameFranchise("Grand Theft Auto: San Andreas", "Grand Theft Auto VI"),
    true,
  );
  assert.equal(sameFranchise("Metal Gear Solid 3", "Metal Gear"), true);
  assert.equal(sameFranchise("Halo 3", "Half-Life 2"), false);
  assert.equal(
    whySlug("Why did Rockstar never make a San Andreas sequel?"),
    "why-did-rockstar-never-make-a-san-andreas-sequel",
  );
});

test("a pick is refused when its game or question had a Why Short in the fresh window", () => {
  const recent = {
    games: ["Grand Theft Auto: San Andreas"],
    slugs: [whySlug("Why did Konami quit Silent Hill?")],
  };
  assert.deepEqual(
    whyFreshProblems(
      {
        game: "Grand Theft Auto IV",
        question: "Why has Rockstar never remastered GTA 4?",
      },
      recent,
      14,
    ),
    [],
    "the same franchise, another game, is fine",
  );
  assert.match(
    whyFreshProblems(
      { game: "Grand Theft Auto: San Andreas", question: "Why is CJ loved?" },
      recent,
      14,
    )[0]!,
    /already had a Why Short in the last 14 days/,
  );
  assert.match(
    whyFreshProblems(
      { game: "Silent Hill 2", question: "Why did Konami quit Silent Hill?" },
      recent,
      14,
    )[0]!,
    /was answered in the last 14 days/,
  );
});

test("hook openings and shapes: no repeated first words in the window, no third shape in a row", () => {
  assert.equal(
    hookShape("Why does Valve's Steam Machine cost $1,049 today?"),
    "question",
  );
  assert.equal(
    hookShape(
      "San Andreas sold 4.5 million copies in one week. Rockstar never made a sequel.",
    ),
    "contrast",
  );
  assert.equal(
    hookShape(
      "Konami quit big console games in 2015, then remade Snake Eater.",
    ),
    "contrast",
  );
  assert.equal(
    hookShape("Metal Gear Solid V grossed $179 million on day one."),
    "claim",
  );
  assert.equal(
    hookShape("4.5 million copies in a week, and no sequel."),
    "figure",
  );
  assert.equal(
    hookShape('"We were done with it," Dan Houser said of GTA 4.'),
    "quote",
  );
  assert.equal(hookOpening("San Andreas sold 4.5 million"), "san andreas sold");
  const recent = [
    "Rockstar has re-released GTA 5 three times. GTA 4? Not once.",
    "Cyberpunk 2077 launched broken. Today it is a hit.",
  ];
  assert.match(
    whyHookProblems("Rockstar has re-released Bully twice. Why?", recent)[0]!,
    /opens "Rockstar has re-released"/,
  );
  assert.deepEqual(
    whyHookProblems("Rockstar never remade Bully. Why?", recent).filter((p) =>
      /opens/.test(p),
    ),
    [],
    "only the same first three words count",
  );
  assert.match(
    whyHookProblems(
      "Nintendo made five F-Zero games. Then it stopped.",
      recent,
    ).join(" "),
    /last two Why Shorts also opened with a contrast hook/,
  );
  assert.deepEqual(
    whyHookProblems("Why did Nintendo stop making F-Zero?", recent),
    [],
  );
  assert.deepEqual(
    whyHookProblems("Nintendo stopped making F-Zero. Why?", []),
    [],
  );
});

test("the last line points to our documentary or ranking, or else to the series, never to the button", () => {
  const doc = {
    kind: "documentary" as const,
    title: "Why GTA 6 Had to Go Back to Vice City",
    videoId: "BemcTLS8mVI",
    franchise: "GTA",
  };
  assert.deepEqual(
    whyFollowProblems(
      "The rest is in our GTA documentary, so why did Rockstar never go back?",
      doc,
    ),
    [],
  );
  assert.match(
    whyFollowProblems("So why did Rockstar never go back?", doc)[0]!,
    /must point to our documentary on GTA/,
  );
  assert.match(
    whyFollowProblems(
      "Subscribe for more, so why did Rockstar never go back?",
      undefined,
    ).join(" "),
    /asks for a subscribe or a like/,
  );
  assert.deepEqual(
    whyFollowProblems(
      "A new Why lands every day, so why did Nintendo stop?",
      undefined,
    ),
    [],
  );
  assert.deepEqual(
    whyFollowProblems(
      "Our Halo ranking has the rest, so which one still holds up?",
      {
        kind: "ranking",
        title: "Every Halo Campaign Ranked",
        videoId: "x",
        franchise: "Halo",
      },
    ),
    [],
  );
  // The brief tells the writer, and never asks for a comment.
  const brief = whyBrief(
    "Why no San Andreas sequel?",
    "Rockstar moved on to Liberty City",
    doc,
  );
  assert.match(
    brief,
    /our full documentary on GTA \("Why GTA 6 Had to Go Back to Vice City"\)/,
  );
  assert.match(followRule(undefined), /a new Why question lands every day/);
  assert.doesNotMatch(brief, /let me know in the comments/i);
  assert.equal(
    whyPinnedLine(doc),
    " The whole story, in our documentary: Why GTA 6 Had to Go Back to Vice City https://youtu.be/BemcTLS8mVI",
  );
  assert.match(whyPinnedLine(undefined), /A new Why question every day/);
  for (const t of [brief, whyPinnedLine(doc), whyPinnedLine(undefined)])
    assert.ok(!t.includes("—"));
});

test("the long video a Why Short points to: same franchise, a documentary first, only once public", async () => {
  const rows = [
    {
      video_id: "R1",
      title: "Every Halo Campaign Ranked",
      game: "Halo",
      format: "ranking",
    },
    {
      video_id: "R2",
      title: "Grand Theft Auto Games Ranked",
      game: "Grand Theft Auto",
      format: "ranking",
    },
    {
      video_id: "D1",
      title: "Why GTA 6 Had to Go Back to Vice City",
      game: "Grand Theft Auto",
      format: "documentary",
    },
  ];
  assert.deepEqual(pickLong("Grand Theft Auto: San Andreas", rows), {
    kind: "documentary",
    title: "Why GTA 6 Had to Go Back to Vice City",
    videoId: "D1",
    franchise: "GTA",
  });
  assert.equal(pickLong("Halo 3", rows)?.kind, "ranking");
  assert.equal(pickLong("Silent Hill 2", rows), undefined);
  assert.equal(spokenFranchise("Halo: Reach"), "Halo");
  assert.equal(spokenFranchise("Grand Theft Auto VI"), "GTA");

  const db = await testDb();
  const now = new Date("2026-11-01T12:00:00Z");
  const add = (
    id: string,
    status: string,
    video: string | null,
    publishAt: string | null,
    script: object,
  ) =>
    db.query(
      `INSERT INTO episodes (id, story_hash, status, story_json, script_json, lane, youtube_video_id, publish_at) VALUES ($1, $1, $2, '{"headline":"x","items":[]}', $3, 'longform', $4, $5)`,
      [id, status, JSON.stringify(script), video, publishAt],
    );
  const long = (title: string, game: string, format: string) => ({
    runtime: "long",
    evergreen_format: format,
    game_title: game,
    youtube: { title },
  });
  await add(
    "ep_a",
    "published",
    "DOC_LATER",
    "2026-11-05T19:00:00Z",
    long("A scheduled GTA doc", "Grand Theft Auto", "documentary"),
  );
  await add(
    "ep_b",
    "published",
    "RANK_GTA",
    "2026-10-20T19:00:00Z",
    long("Every GTA Ranked", "Grand Theft Auto", "ranking"),
  );
  await add(
    "ep_c",
    "failed",
    null,
    null,
    long("A failed doc", "Grand Theft Auto", "documentary"),
  );
  const f = await followFor(db, "Grand Theft Auto IV", now);
  assert.equal(f.videoId, "RANK_GTA", "the scheduled doc is not public yet");
  assert.deepEqual(await followFor(db, "Bully", now), { kind: "series" });
  await db.close();
});

test("recent Why hooks come from Why Shorts only, newest first, inside the window", async () => {
  const db = await testDb();
  const add = (id: string, hash: string, hook: string, created: string) =>
    db.query(
      `INSERT INTO episodes (id, story_hash, status, story_json, script_json, lane, created_at) VALUES ($1, $2, 'published', '{"headline":"x","items":[]}', $3, 'news', $4)`,
      [id, hash, JSON.stringify({ hook }), created],
    );
  await add("e1", "why:one", "Old hook.", "2026-10-01T12:00:00Z");
  await add("e2", "why:two", "Second hook.", "2026-10-28T12:00:00Z");
  await add("e3", "why:three", "Newest hook.", "2026-10-31T12:00:00Z");
  await add("e4", "news:x", "A news hook.", "2026-10-31T13:00:00Z");
  assert.deepEqual(
    await recentWhyHooks(db, "e3", new Date("2026-11-01T12:00:00Z"), 14),
    ["Second hook."],
  );
  assert.deepEqual(
    await recentWhyHooks(db, "", new Date("2026-11-01T12:00:00Z"), 14),
    ["Newest hook.", "Second hook."],
  );
  await db.close();
});

test("a Why Short that says the reason is unknown is sent back; one that gives a reason is not", async () => {
  const { whyAnswerProblems } = await import("../src/editorial/why.ts");
  assert.equal(whyAnswerProblems("Konami's reasons aren't in the record, and we won't guess.").length, 1);
  assert.equal(whyAnswerProblems("Nobody knows why it happened.").length, 1);
  assert.equal(whyAnswerProblems("Rockstar moved on because the team wanted a new setting.").length, 0);
});
