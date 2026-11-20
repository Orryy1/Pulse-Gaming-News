// GAME_SPEECH_DIALOGUE (20 Nov 2026): the game's characters talking with the narrator. Speakers named on demand, the
// clip heard before the voice, the proxy when YouTube will not serve, the verdict reaction, the deeper duck, and the
// switch staying off by default. No network, no model, no ffmpeg.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { testConfig, testDb, tmpDir } from "./helpers.ts";
import {
  emptySceneIndex,
  saveSceneIndex,
  sceneIndexDir,
  type DialogueLine,
  type SceneIndex,
} from "../src/sceneindex/schema.ts";
import {
  DEMAND_FILE,
  demandChunk,
  demandLines,
  nameSpeakersOnDemand,
  overlayDemand,
  quotableOnceNamed,
} from "../src/sceneindex/speakerdemand.ts";
import {
  heardMatchesLine,
  sectionWithProxyFallback,
} from "../src/assets/quoteclip.ts";
import {
  exchangeProblems,
  VERDICT_REACTION,
} from "../src/editorial/charquote.ts";
import {
  DIALOGUE_BED_UNDER,
  dialogueOn,
  quoteIndexFor,
  quoteLongStep,
  quoteRenderFiles,
  trailersOn,
} from "../src/charquotestep.ts";
import {
  QUOTE_BED_UNDER,
  quoteBedFactor,
} from "../src/render/components/QuoteMoment.tsx";
import { loadConfig } from "../src/config.ts";
import { gamesNeedingLines } from "../src/tools/trailerlines.ts";

const GAME = "Grand Theft Auto V";

function timed(text: string, start: number, per = 0.3): DialogueLine["words"] {
  return text
    .split(/\s+/)
    .map((w, i) => ({
      text: w,
      start: start + i * per,
      end: start + i * per + per * 0.8,
    }));
}
function line(
  id: number,
  start: number,
  text: string,
  speaker?: string,
  o: Partial<DialogueLine> = {},
): DialogueLine {
  const words = timed(text, start);
  return {
    id,
    start,
    end: words!.at(-1)!.end,
    text,
    ...(speaker ? { speaker } : {}),
    via: "voice",
    shot: 0,
    words,
    ...o,
  };
}

function gtav(): SceneIndex {
  const index = emptySceneIndex(
    GAME,
    {
      videoId: "aD5T3K9mFAw",
      title: "GTA 5 All Cutscenes",
      uploader: "Uploader",
      duration: 32000,
      kind: "movie",
      pickedAt: "",
    },
    new Date("2026-11-12T00:00:00Z"),
  );
  index.cast = ["Michael", "Trevor", "Franklin", "Lamar"];
  index.places = ["Los Santos", "Vinewood"];
  index.coverage = [{ from: 0, to: 32000 }];
  index.shots = [
    {
      id: 0,
      start: 0,
      end: 32000,
      keyframes: [],
      desc: "",
      who: [],
      where: "",
      mood: "",
      tags: [],
      text: "",
      luma: 90,
      motion: 4,
    },
  ];
  index.lines = [
    line(0, 100, "Franklin, you gotta get that car back tonight.", undefined),
    line(1, 104, "Relax, Lamar, the repo always goes smooth.", undefined),
    line(
      2,
      108,
      "Smooth? Nothing in Los Santos ever goes smooth, homie.",
      undefined,
    ),
    line(3, 200, "Michael, this is your life now, isn't it?", "Trevor"),
    line(4, 300, "Read off a text box only.", undefined, {
      via: "textbox",
      words: undefined,
    }),
  ];
  return index;
}

test("GAME_SPEECH_DIALOGUE is off by default and turns trailer lines on with it", () => {
  delete process.env.GAME_SPEECH_DIALOGUE;
  const cfg = loadConfig();
  assert.equal(cfg.gameSpeechDialogue, false);
  assert.equal(
    dialogueOn({ characterQuotes: true, gameSpeechDialogue: false }),
    false,
  );
  assert.equal(
    dialogueOn({ characterQuotes: false, gameSpeechDialogue: true }),
    false,
  );
  assert.equal(
    dialogueOn({ characterQuotes: true, gameSpeechDialogue: true }),
    true,
  );
  assert.equal(
    trailersOn({
      characterQuotes: true,
      trailerQuotes: false,
      gameSpeechDialogue: true,
    }),
    true,
  );
  assert.equal(
    trailersOn({
      characterQuotes: true,
      trailerQuotes: false,
      gameSpeechDialogue: false,
    }),
    false,
  );
});

test("speakerless lines that fit the story are the ones asked about, with the lines around them", () => {
  const index = gtav();
  assert.equal(quotableOnceNamed(index, index.lines[2]!), true);
  assert.equal(
    quotableOnceNamed(index, index.lines[3]!),
    false,
    "already named",
  );
  assert.equal(
    quotableOnceNamed(index, index.lines[4]!),
    false,
    "a text box is never heard",
  );
  const wanted = demandLines(
    index,
    "The repo missions in Los Santos never go smooth",
    new Set(),
  );
  assert.ok(wanted.some((l) => l.id === 2));
  assert.ok(wanted.every((l) => !l.speaker));
  assert.deepEqual(
    demandLines(
      index,
      "repo smooth Los Santos",
      new Set(["q1080", "q1040", "q1000"]),
    ),
    [],
  );
  const chunk = demandChunk(index, [index.lines[2]!], 1);
  assert.deepEqual(
    chunk.ask.map((l) => l.id),
    [1, 2, 3],
  );
});

test("speakers named on demand are kept beside the index, sure answers on the cast list only, and asked once", async () => {
  const dir = await tmpDir();
  const index = gtav();
  await saveSceneIndex(dir, index);
  let calls = 0;
  const llm = {
    structured: async () => {
      calls++;
      return {
        lines: [
          { id: 0, speaker: "Lamar", sure: true },
          { id: 1, speaker: "Franklin", sure: true },
          { id: 2, speaker: "Lamar", sure: false },
          { id: 3, speaker: "Ghost", sure: true },
        ],
      };
    },
  };
  const story =
    "Franklin's repo jobs for Lamar in Los Santos: the car back tonight, relax, smooth";
  const r = await nameSpeakersOnDemand(llm as any, dir, index, story);
  assert.equal(calls, 1);
  assert.equal(r.index.lines[0]!.speaker, "Lamar");
  assert.equal(r.index.lines[1]!.speaker, "Franklin");
  assert.equal(
    r.index.lines[2]!.speaker,
    undefined,
    "an unsure answer is not kept",
  );
  assert.equal(
    r.index.lines[3]!.speaker,
    "Trevor",
    "a line the game named is never changed",
  );
  const kept = JSON.parse(
    await fs.readFile(path.join(sceneIndexDir(dir, GAME), DEMAND_FILE), "utf8"),
  );
  assert.equal(kept.videoId, "aD5T3K9mFAw");
  // The quote step's loader lays the kept answers over the index, so the check before the voice agrees.
  const loaded = await quoteIndexFor(dir, GAME);
  assert.equal(loaded!.lines[1]!.speaker, "Franklin");
  assert.equal(loaded!.lines[1]!.speakerFrom, "context");
  // Asked once: the same story asks nothing more.
  await nameSpeakersOnDemand(llm as any, dir, index, story);
  assert.equal(calls, 1);
  // A rebuild from another upload leaves the kept answers unused.
  const other = { ...index, source: { ...index.source, videoId: "other" } };
  assert.equal(overlayDemand(other, kept).lines[1]!.speaker, undefined);
});

test("a failed speaker call leaves the index as it was", async () => {
  const dir = await tmpDir();
  const index = gtav();
  const r = await nameSpeakersOnDemand(
    {
      structured: async () => {
        throw new Error("down");
      },
    } as any,
    dir,
    index,
    "repo smooth Los Santos",
  );
  assert.equal(r.named, 0);
  assert.equal(r.index.lines[1]!.speaker, undefined);
});

test("the clip is heard before the voice: the line's words, not another voice running in", () => {
  assert.equal(
    heardMatchesLine("You're too skinny, CJ, you need to put on some muscle!", [
      "you're",
      "too",
      "skinny",
      "cj",
      "you",
      "need",
      "to",
      "pock",
      "on",
      "some",
      "muscle",
    ]).ok,
    true,
  );
  const wrong = heardMatchesLine("Relax, Lamar, the repo always goes smooth.", [
    "get",
    "in",
    "the",
    "car",
  ]);
  assert.equal(wrong.ok, false);
  assert.match(wrong.reason, /heard \d+% of the line/);
  const bleed = heardMatchesLine("Go home.", [
    "go",
    "home",
    "and",
    "then",
    "we",
    "will",
    "talk",
    "about",
    "the",
    "money",
    "later",
  ]);
  assert.equal(bleed.ok, false);
  assert.match(bleed.reason, /another voice/);
});

test("YouTube first, the scene index's proxy when YouTube will not serve, nothing to fall back to rethrows", async () => {
  const used: string[] = [];
  const ok = sectionWithProxyFallback(async () => {
    used.push("youtube");
  }, "/nowhere/proxy.mp4");
  await ok("v", 1, 2, path.join(await tmpDir(), "s.mkv"));
  assert.deepEqual(used, ["youtube"]);
  const none = sectionWithProxyFallback(async () => {
    throw new Error("YouTube asked for a bot check");
  }, undefined);
  await assert.rejects(none("v", 1, 2, "x.mkv"), /bot check/);
  let fell = "";
  const fallback = sectionWithProxyFallback(
    async () => {
      throw new Error("paused");
    },
    "/definitely/not/here/proxy.mp4",
    (err) => (fell = String((err as Error).message)),
  );
  await assert.rejects(fallback("v", 1, 2, path.join(await tmpDir(), "s.mkv")));
  assert.equal(fell, "paused", "the fallback was tried");
});

test("a short verdict answers a line the setup led into, only in dialogue mode", () => {
  const lucia = {
    text: "Nothing ever goes to plan in Leonida.",
    speaker: "Lucia",
  };
  const beat = "Rockstar says the heist missions can go wrong in many ways.";
  const names = ["Lucia", "Jason", "Leonida"];
  assert.ok(VERDICT_REACTION.test("He's not wrong."));
  assert.ok(VERDICT_REACTION.test("Fair point, Lucia."));
  assert.ok(VERDICT_REACTION.test("Can't argue with that."));
  assert.ok(!VERDICT_REACTION.test("Fair enough."));
  const setup = "Surely the heist goes to plan this time?";
  assert.match(
    exchangeProblems(setup, "She's not wrong.", lucia, { beat, names }).join(
      " ",
    ),
    /does not answer/,
  );
  assert.deepEqual(
    exchangeProblems(setup, "She's not wrong.", lucia, {
      beat,
      names,
      dialogue: true,
    }),
    [],
  );
  // A verdict after a setup that does not lead into the line still goes back.
  assert.match(
    exchangeProblems(
      "Rockstar shipped the heists early.",
      "She's not wrong.",
      lucia,
      { beat, names, dialogue: true },
    ).join(" "),
    /does not answer/,
  );
});

test("the music bed ducks further under the character in dialogue mode", () => {
  const spans = [
    { from: 10, frames: 20, q: {} },
    { from: 50, frames: 20, q: { bedUnder: DIALOGUE_BED_UNDER } },
  ];
  assert.equal(quoteBedFactor(spans, 5), 1);
  assert.equal(quoteBedFactor(spans, 15), QUOTE_BED_UNDER);
  assert.equal(quoteBedFactor(spans, 55), DIALOGUE_BED_UNDER);
  const assets = {
    quotes: [
      {
        id: "q1",
        file: "quote_q1.mp4",
        start: 3,
        end: 5,
        seconds: 2,
        speaker: "Lucia",
        text: "Hi.",
        credit: "c",
        mode: "framed" as const,
      } as any,
    ],
  };
  assert.equal(quoteRenderFiles(assets)![0]!.bedUnder, undefined);
  assert.equal(
    quoteRenderFiles(assets, { dialogue: true })![0]!.bedUnder,
    DIALOGUE_BED_UNDER,
  );
});

test("a long video that places no quote says why, chapter by chapter", async () => {
  const dir = await tmpDir();
  const db = await testDb();
  await db
    .query(
      `INSERT INTO episodes (id, story_hash, story_json, lane, status) VALUES ('ep9', 'h9', '{"headline":"x"}', 'longform', 'selected')`,
    )
    .catch(() => undefined);
  const words = (n: number) =>
    Array.from({ length: n }, (_, i) => `word${i}`).join(" ") + ".";
  const script = {
    game_title: "Some Unindexed Game",
    headline: "x",
    hook: words(20),
    beats: [
      { narration: words(200) },
      { narration: words(80) },
      { narration: words(80) },
    ],
    pulse_take: { narration: "t" },
    loop_line: "l",
    youtube: { title: "t", description: "d", tags: [] },
  } as any;
  const s = {
    cfg: testConfig(dir, { characterQuotes: true, gameSpeechDialogue: true }),
    db,
    llm: { structured: async () => assert.fail("no call") } as any,
    now: () => new Date("2026-11-20T00:00:00Z"),
  };
  const out = await quoteLongStep(s, { id: "ep9" }, script);
  assert.equal(out, script);
  const [ev] = await db.query<{ detail: any }>(
    `SELECT detail FROM events WHERE episode_id = 'ep9' AND kind = 'character_quote'`,
  );
  assert.equal(ev!.detail.long, true);
  assert.match(
    ev!.detail.why,
    /Some Unindexed Game: no scene index and no trailer lines/,
  );
  await db.close();
});

test("trailer lines are made for every library game with an unprocessed official trailer", () => {
  const trailer = (id: string) =>
    ({
      id,
      kind: "video",
      source: "Rockstar Games",
      named: "official trailer",
      unusable: undefined,
    }) as any;
  const libs = [
    { game: "Grand Theft Auto VI", items: [trailer("a"), trailer("b")] },
    { game: "Grand Theft Auto V", items: [trailer("c")] },
    {
      game: "No Trailers",
      items: [
        { id: "d", kind: "still", source: "x", named: "screenshot" } as any,
      ],
    },
  ];
  assert.deepEqual(
    gamesNeedingLines(libs, (g, i) => g === "Grand Theft Auto V" && i === "c"),
    ["Grand Theft Auto VI"],
  );
  assert.deepEqual(
    gamesNeedingLines(libs, () => false),
    ["Grand Theft Auto VI", "Grand Theft Auto V"],
  );
});

test("in dialogue mode a line read with slips off the subtitles is never quoted: every word but names is heard", async () => {
  const { unquotable } = await import("../src/sceneindex/quotepick.ts");
  const index = gtav();
  const slip = line(9, 500, "ljust got him out, Lamar, that was all.", "Franklin", {
    words: timed("I just got him out Lamar that was all", 500),
  });
  index.lines.push(slip);
  assert.equal(unquotable(index, slip), undefined, "the old check lets it through");
  assert.match(unquotable(index, slip, { verbatim: true }) ?? "", /never says \("ljust"\)/);
  // A name Whisper mishears is fine.
  const name = line(10, 600, "Franklin, you got the car back.", "Lamar", {
    words: timed("Frankie you got the car back", 600),
    speakerFrom: "context",
  });
  index.lines.push(name);
  assert.equal(unquotable(index, name, { verbatim: true }), undefined);
});

test("a long ranking's rank cards open its chapters, each about its entry's game", async () => {
  const { quoteChapters } = await import("../src/charquotestep.ts");
  const rank = (n: string) => ({ narration: n, visual: { kind: "rank" as const, primary: "R", secondary: "" } });
  const script = {
    game_title: "Grand Theft Auto",
    beats: [rank("a"), rank("b"), rank("c")],
    entries: [
      { rank: 3, game_title: "Grand Theft Auto III" },
      { rank: 1, game_title: "Grand Theft Auto V" },
      { rank: 2, game_title: "Grand Theft Auto: San Andreas" },
    ],
  } as any;
  assert.deepEqual(quoteChapters(script), [
    { game: "Grand Theft Auto III", beats: [0] },
    { game: "Grand Theft Auto: San Andreas", beats: [1] },
    { game: "Grand Theft Auto V", beats: [2] },
  ]);
});

test("in dialogue mode a caption names characters, never a screen label or a place the text reader took for one", async () => {
  const { speakerProblem } = await import("../src/sceneindex/quotepick.ts");
  const index = {
    cast: ["Michael", "Trevor", "Ryder", "Cesar Vialpando", "CONNECTED", "APPROACH", "La Mesa", "Grand Senora Desert", "OUGRideR"],
    places: ["Blaine County"],
  };
  assert.equal(speakerProblem(index, "Michael"), undefined);
  assert.equal(speakerProblem(index, "RydeR"), undefined, "the reader's odd capitals still name Ryder");
  assert.equal(speakerProblem(index, "Cesar vialPando"), undefined);
  for (const bad of ["APPROACH", "CONNECTED", "La Mesa", "Grand Senora Desert", "OUGRideR", "Blaine County", "San Andreas", "Final Chapter"])
    assert.ok(speakerProblem(index, bad), bad);
});
