// Trailer voice lines (TRAILER_QUOTES): an official trailer's spoken lines as character quotes and as heard game
// sound. No network, no model, no ffmpeg.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { goodScript, testConfig, testDb, tmpDir } from "./helpers.ts";
import {
  buildTrailerLines,
  dialogueShare,
  isTrailerVideoId,
  meanDb,
  parseTrailerLines,
  sentencePieces,
  sustainShare,
  trailerIndexes,
  trailerSceneIndex,
  trailerVideoId,
  TRAILER_LINES_VERSION,
  type TrailerLines,
} from "../src/assets/trailerlines.ts";
import {
  quoteCandidates,
  quoteSpan,
  verifyQuote,
  type QuoteCandidate,
} from "../src/sceneindex/quotepick.ts";
import { spoilerWindow } from "../src/sceneindex/spoilers.ts";
import {
  fitClipsAroundQuotes,
  isTrailerQuote,
  mergeCandidates,
  quoteCredit,
  quoteScriptStep,
} from "../src/charquotestep.ts";
import { quoteMomentBrief } from "../src/editorial/charquote.ts";
import {
  hearClips,
  trailerVoicePolicy,
  SPEECH_DB,
} from "../src/assets/gameaudio.ts";
import type { Script } from "../src/editorial/schema.ts";

const GAME = "Grand Theft Auto VI";
const ITEM = "16065768986994";

const words = (text: string, start: number, per = 0.3) =>
  text
    .split(/\s+/)
    .map((w, i) => ({
      text: w,
      start: start + i * per,
      end: start + i * per + per * 0.8,
    }));

/** Pitch every 10 ms: speech glides (a new pitch each frame), a sung note holds. */
function pitch(
  seconds: number,
  spans: Array<{ from: number; to: number; sung: boolean }>,
): number[] {
  const f0 = new Array<number>(Math.ceil(seconds / 0.01)).fill(0);
  for (const s of spans)
    for (let i = Math.floor(s.from / 0.01); i < Math.ceil(s.to / 0.01); i++)
      f0[i] = s.sung ? 220 : 140 + 40 * Math.sin(i * 1.3) + (i % 3) * 9;
  return f0;
}

function lines(): TrailerLines {
  const w = [
    ...words("Only way we survive is together.", 2),
    ...words("You ready?", 5),
    ...words("Love is a long road", 20, 0.9),
  ];
  const f0 = pitch(30, [
    { from: 2, to: 4, sung: false },
    { from: 5, to: 5.6, sung: false },
    { from: 20, to: 24, sung: true },
  ]);
  const step = 0.25;
  const voice = new Array<number>(120).fill(-30);
  const music = new Array<number>(120).fill(-24);
  return {
    version: TRAILER_LINES_VERSION,
    game: GAME,
    item: ITEM,
    name: "Trailer 2",
    sourceUrl: "https://media.example/GTAVI_Trailer_2.mp4",
    publisher: "Rockstar Games",
    duration: 30,
    voiceFile: `voicelines/${ITEM}.voice.m4a`,
    builtAt: "2026-11-15T00:00:00Z",
    lines: buildTrailerLines(w, { f0, hop: 0.01, voice, music, step }),
    levels: { step, voice, music },
  };
}

test("a held, steady pitch is singing; a gliding one is speech", () => {
  const f0 = pitch(10, [
    { from: 0, to: 2, sung: false },
    { from: 4, to: 6, sung: true },
  ]);
  assert.ok(sustainShare(f0, 0.01, 0, 2) < 0.2);
  assert.ok(sustainShare(f0, 0.01, 4, 6) > 0.9);
  assert.equal(sustainShare(f0, 0.01, 7, 9), 0, "nothing voiced");
  assert.equal(meanDb([-10, -10, -10, -10], 0.25, 0, 1), -10);
});

test("the trailer's heard words become one sentence a line, with the sung lyric marked unusable", () => {
  assert.equal(
    sentencePieces([{ words: words("Hey. You good? Let's go.", 0) }]).length,
    3,
  );
  const tl = lines();
  assert.deepEqual(
    tl.lines.map((l) => [l.text, l.unusable ?? "ok"]),
    [
      ["Only way we survive is together.", "ok"],
      ["You ready?", "ok"],
      ["Love is a long road", "sung"],
    ],
  );
  // A voice buried far under the music was split badly: never trusted.
  const buried = buildTrailerLines(words("We can do this, okay.", 1), {
    f0: pitch(5, [{ from: 1, to: 2.5, sung: false }]),
    hop: 0.01,
    voice: new Array(20).fill(-50),
    music: new Array(20).fill(-20),
    step: 0.25,
  });
  assert.equal(buried[0]!.unusable, "the voice is buried under the music");
  assert.equal(parseTrailerLines({ ...tl, version: 99 }), undefined);
  assert.ok(parseTrailerLines(JSON.parse(JSON.stringify(tl))));
});

test("a trailer's lines read as a scene index: quotable, checked and cut like a cutscene's", () => {
  const index = trailerSceneIndex(lines());
  assert.equal(index.origin, "trailer");
  assert.ok(isTrailerVideoId(index.source.videoId));
  assert.equal(index.source.videoId, trailerVideoId(ITEM));
  const c = quoteCandidates(index, "Jason and Lucia survive together", {});
  // The sung lyric is never offered; "You ready?" is under three words.
  assert.deepEqual(
    c.map((x) => x.text),
    ["Only way we survive is together."],
  );
  assert.equal(c[0]!.origin, "trailer");
  assert.equal(c[0]!.speaker, "Trailer 2");
  assert.equal(c[0]!.fit, "story");
  assert.ok(verifyQuote(index, c[0]!).ok);
  // The cut stays clear of the next line's first word.
  const span = quoteSpan(index, index.lines[0]!);
  assert.ok(span.to <= 5 - 0.12 + 1e-9);
  // The writer is told it is the trailer, and never to name the speaker.
  const brief = quoteMomentBrief(goodScript({ game_title: GAME }), c);
  assert.match(
    brief,
    /a voice in the official trailer "Trailer 2" \(never name who says it\)/,
  );
});

test("a trailer clip is heard in the bed only where its stretch is mostly speech", () => {
  const tl = lines();
  assert.ok(dialogueShare(tl, 2, 4) > 0.8);
  assert.equal(dialogueShare(tl, 20, 24), 0, "the song is not dialogue");
  assert.deepEqual(trailerVoicePolicy(-20), { trimDb: SPEECH_DB, swell: true });
  assert.deepEqual(trailerVoicePolicy(-70), { skip: "silent" });
});

test("candidates from several indexes: story fits first, filler taken in turn, IDs once", () => {
  const c = (
    id: string,
    fit: "story" | "general",
    score: number,
    videoId: string,
  ) => ({ id, fit, score, start: 0, videoId }) as QuoteCandidate;
  const merged = mergeCandidates(
    [
      [
        c("q1", "story", 2, "a"),
        c("q2", "general", 0, "a"),
        c("q3", "general", 0, "a"),
      ],
      [
        c("q9", "story", 5, "b"),
        c("q4", "general", 0, "b"),
        c("q1", "story", 1, "b"),
      ],
    ],
    5,
  );
  assert.deepEqual(
    merged.map((x) => `${x.id}${x.videoId}`),
    ["q9b", "q1a", "q2a", "q4b", "q3a"],
  );
  assert.equal(
    quoteCredit(GAME, "trailer"),
    "Grand Theft Auto VI official trailer",
  );
  assert.equal(quoteCredit(GAME), "Grand Theft Auto VI cutscenes, via YouTube");
  assert.ok(isTrailerQuote({ videoId: trailerVideoId(ITEM) }));
  assert.ok(!isTrailerQuote({ videoId: "L45cq1H2d1s" }));
});

test("a trailer quote counts against the publisher's cap but not the cutscene budget", () => {
  const clips = [
    {
      provenance:
        'Official trailer "Trailer 1" from Rockstar Games\'s own site (x), publisher: Rockstar Games, 4s at 3.0s, muted',
      durationSeconds: 4,
      beatIndex: 0,
    },
    {
      provenance:
        'Cutscenes for "Hollow Knight" (video ID: abcdefghijk, source time: 3s)',
      durationSeconds: 4,
      beatIndex: 1,
    },
  ];
  const kept = fitClipsAroundQuotes(
    clips,
    [{ game: GAME, seconds: 3, origin: "trailer" }],
    5,
  );
  assert.equal(
    kept.length,
    2,
    "the cutscene clip still fits a 5 s cutscene budget",
  );
  const asCutscene = fitClipsAroundQuotes(
    clips,
    [{ game: GAME, seconds: 3 }],
    5,
  );
  assert.equal(asCutscene.length, 1);
});

function gtaScript(): Script {
  return goodScript({
    game_title: GAME,
    headline: "GTA 6 Lets You Play As Jason And Lucia",
    hook: "GTA 6 gives you two leads, not one.",
    beats: [
      {
        narration:
          "Rockstar confirmed the launch on November 19 for PS5 and Xbox Series X.",
        visual: { kind: "title", primary: "Nov 19", secondary: "" },
      },
      {
        narration:
          "You play as Jason and Lucia across Leonida, and you can swap between them.",
        visual: { kind: "title", primary: "Two leads", secondary: "" },
      },
    ],
  });
}

async function seedLibrary(dir: string): Promise<void> {
  const lib = path.join(dir, "gamelib", "grand-theft-auto-vi");
  await fs.mkdir(path.join(lib, "voicelines"), { recursive: true });
  await fs.writeFile(
    path.join(lib, "library.json"),
    JSON.stringify({
      version: 1,
      game: GAME,
      updatedAt: "",
      items: [
        {
          id: ITEM,
          kind: "video",
          file: `videos/${ITEM}.mp4`,
          sourceUrl: "https://media.example/GTAVI_Trailer_2.mp4",
          provenance:
            'Official trailer "Trailer 2" from Rockstar Games\'s own site (x)',
          source: "Rockstar Games",
          named: ["trailer"],
          tags: [],
          seen: "",
          addedAt: "",
        },
      ],
    }),
  );
  await fs.writeFile(
    path.join(lib, "voicelines", `${ITEM}.json`),
    JSON.stringify(lines()),
  );
}

test("with no scene index, GTA VI quotes its official trailer inside the spoiler window", async () => {
  const dir = await tmpDir();
  const saved = process.env.GAME_LIBRARY_DIR;
  delete process.env.GAME_LIBRARY_DIR;
  try {
    await seedLibrary(dir);
    assert.equal(
      (await trailerIndexes(dir, "Grand Theft Auto 6")).length,
      1,
      "GTA 6 finds GTA VI's library",
    );
    const db = await testDb();
    const now = new Date("2026-11-20T12:00:00Z");
    const window = spoilerWindow(GAME, "2026-11-19", {
      days: 28,
      openingShare: 0.1,
    })!;
    const briefs: string[] = [];
    const llm = {
      structured: async (o: any) => {
        briefs.push(String(o.content));
        const id = String(o.content).match(/^- (q\d+):/m)?.[1] ?? "";
        return {
          use: true,
          quote_id: id,
          beat: 1,
          before_quote:
            "You play as Jason and Lucia across Leonida. So why would Jason and Lucia ever survive alone?",
          after_quote: "Together, sure, and you can swap between them.",
          answers: "together",
          why: "the trailer line answers the two-lead story",
        };
      },
    } as any;
    const s = {
      cfg: testConfig(dir, { characterQuotes: true, spoilerGuard: true }),
      db,
      llm,
      now: () => now,
    };
    const o = {
      footageCap: { key: "Rockstar Games", seconds: 34 },
      wordsMax: 200,
      windows: [window],
    };
    const placed = await quoteScriptStep(s, { id: "ep1" }, gtaScript(), o);
    assert.equal(
      placed.character_quotes?.[0]?.text,
      "Only way we survive is together.",
      briefs.join("\n"),
    );
    assert.equal(placed.character_quotes?.[0]?.origin, "trailer");
    assert.ok(isTrailerVideoId(placed.character_quotes?.[0]?.videoId));
    // With TRAILER_QUOTES off the old answer stands: no index, no quote, no model call.
    briefs.length = 0;
    const off = await quoteScriptStep(
      {
        ...s,
        cfg: testConfig(dir, {
          characterQuotes: true,
          spoilerGuard: true,
          trailerQuotes: false,
        }),
      },
      { id: "ep2" },
      gtaScript(),
      o,
    );
    assert.equal(off.character_quotes, undefined);
    assert.equal(briefs.length, 0);
    // The publisher's cap still counts: no room left, no quote.
    const capped = await quoteScriptStep(s, { id: "ep3" }, gtaScript(), {
      ...o,
      footageCap: { key: "Rockstar Games", seconds: 1 },
    });
    assert.equal(capped.character_quotes, undefined);
    await db.close();
  } finally {
    if (saved !== undefined) process.env.GAME_LIBRARY_DIR = saved;
  }
});

test("the bed leaves a trailer clip silent when it has no voice lines", async () => {
  const dir = await tmpDir();
  const { heard, skipped } = await hearClips(
    dir,
    [
      {
        file: "clip_0.mp4",
        provenance: 'Official trailer "Trailer 9" from X, 4s at 1.0s, muted',
        durationSeconds: 4,
        sourceUrl: "https://nowhere.example/t.mp4",
        startSeconds: 1,
      },
    ],
    { dataDir: dir, ytdlp: "yt-dlp", trailers: false, trailerVoice: true },
  );
  assert.equal(heard.length, 0);
  assert.deepEqual(skipped, [{ index: 0, why: "trailer music" }]);
});
