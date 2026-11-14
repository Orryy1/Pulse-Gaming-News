import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testConfig, tmpDir } from "./helpers.ts";
import {
  SCENE_INDEX_VERSION,
  betterSource,
  coveredSeconds,
  emptySceneIndex,
  indexComplete,
  loadSceneIndex,
  mergeCoverage,
  mergeStretch,
  nextGap,
  parseSceneIndex,
  saveSceneIndex,
  sceneSlug,
  shotAt,
  type SceneIndex,
  type SceneSource,
} from "../src/sceneindex/schema.ts";
import {
  keyframeTimes,
  shotsFromScan,
  splitShots,
} from "../src/sceneindex/shots.ts";
import {
  alike,
  isDialogue,
  isName,
  mergeDialogue,
  readBox,
  shotText,
  textBoxLines,
  tidyLine,
  voiceLines,
  type OcrSample,
} from "../src/sceneindex/dialogue.ts";
import {
  findQuote,
  findShots,
  quotableLines,
  stem,
  tokens,
} from "../src/sceneindex/lookup.ts";
import {
  knownName,
  mergeNames,
  namesInText,
  splitNames,
  storyText,
} from "../src/sceneindex/names.ts";
import { lookAnswer, lookPrompt } from "../src/sceneindex/describe.ts";
import { editDistance, groundedCast, joinSplitLines, namesWritten, speakerSpellings, tidyIndex } from "../src/sceneindex/tidy.ts";
import {
  chooseSource,
  frameArgs,
  ocrFrameArgs,
  pickSource,
  proxyArgs,
  scanArgs,
  sceneIndexReady,
  sourceKind,
  stripArgs,
  undescribed,
} from "../src/sceneindex/build.ts";
import {
  afterTurn,
  gamesOfScript,
  launchGames,
  nextJob,
  parseQueue,
  queueGame,
  readQueue,
  requestSceneIndex,
  requestSceneIndexes,
  sceneIndexTick,
  sourceRecheckDue,
  turnCommand,
  turnOutcome,
} from "../src/sceneindex/job.ts";
import {
  clearStretch,
  cutscenesIndexFirst,
  indexFirstCutscenes,
  indexFitsRelease,
  indexedCutsceneClips,
  indexedSceneStills,
  firstSpoken,
  stillConfirmed,
  matchingSlug,
  planIndexedClips,
  quotedWords,
} from "../src/sceneindex/footage.ts";
import { footageCredits } from "../src/pipeline.ts";
import type { CutsceneClip, CutsceneUpload } from "../src/assets/cutscenes.ts";
import type { FootageTarget } from "../src/assets/clipscore.ts";
import type { OcrPage } from "../src/assets/ocr.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const source: SceneSource = {
  videoId: "8UVbiI44V_c",
  title:
    "ZELDA: OCARINA OF TIME REMAKE Full Movie (Cutscenes Only) 4K Ultra HD",
  uploader: "Gamer's Little Playground",
  duration: 7518,
  height: 2160,
  kind: "movie",
  pickedAt: "2026-11-11T14:26:12.106Z",
};
const GAME = "The Legend of Zelda: Ocarina of Time";

/** A small index in the real one's shape: three scenes of the remake's movie. */
function sample(): SceneIndex {
  const shot = (
    start: number,
    end: number,
    desc: string,
    who: string[],
    where: string,
    tags: string[] = [],
    extra = {},
  ) => ({
    start,
    end,
    keyframes: keyframeTimes(start, end),
    desc,
    who,
    where,
    mood: "",
    tags,
    text: "",
    luma: 80,
    motion: 6,
    ...extra,
  });
  const base = emptySceneIndex(GAME, source, new Date("2026-11-11T15:00:00Z"));
  base.cast = [
    "Link",
    "Ganondorf",
    "Princess Zelda",
    "Navi",
    "Sheik",
    "Great Deku Tree",
    "Master Sword",
  ];
  base.places = ["Hyrule Castle", "Temple of Time", "Kokiri Forest"];
  return mergeStretch(
    base,
    { from: 0, to: 7518 },
    [
      shot(
        185,
        191,
        "An ancient tree with a face speaks in a misty clearing.",
        ["Great Deku Tree"],
        "Kokiri Forest",
        ["tree", "mist"],
      ),
      shot(
        191,
        200,
        "A small glowing fairy flies through the forest.",
        ["Navi"],
        "Kokiri Forest",
        ["fairy", "light"],
      ),
      shot(
        2400,
        2406,
        "A boy in green walks up the steps of a stone hall towards a pedestal.",
        ["Link"],
        "Temple of Time",
        ["pedestal", "light"],
      ),
      shot(
        2406,
        2411,
        "Close on two hands gripping a hilt set in stone.",
        [],
        "",
        ["hands", "hilt", "stone"],
      ),
      shot(
        2411,
        2418,
        "The boy pulls the blade from the pedestal as blue light floods the hall.",
        ["Link"],
        "Temple of Time",
        ["sword", "blue", "light"],
      ),
      shot(2418, 2420, "A black screen.", [], "", [], { blank: true }),
      shot(
        6900,
        6908,
        "A red-haired man in dark armour floats up above the ruins of a castle.",
        ["Ganondorf"],
        "Hyrule Castle",
        ["ruins", "rubble", "storm"],
      ),
      shot(
        6908,
        6914,
        "A princess in a pink dress watches the sky.",
        ["Princess Zelda"],
        "Hyrule Castle",
        ["sky"],
      ),
      shot(
        7000,
        7006,
        "A man in dark armour plays an organ in a tower.",
        ["Ganondorf"],
        "",
        ["organ", "tower"],
      ),
    ],
    [
      {
        start: 187.25,
        end: 190.75,
        text: "I will entrust everything to the child.",
        speaker: "Great Deku Tree",
        via: "textbox",
      },
      {
        start: 191.75,
        end: 193.25,
        text: "Navi...",
        speaker: "Great Deku Tree",
        via: "textbox",
      },
      {
        start: 2412,
        end: 2416,
        text: "The Master Sword... the blade of evil's bane.",
        speaker: "Rauru",
        via: "textbox",
      },
      {
        start: 6901,
        end: 6905,
        text: "No... Not your power. Rather, the power of the",
        speaker: "Ganondorf",
        via: "textbox",
      },
      {
        start: 6905.5,
        end: 6907.5,
        text: "Triforce of Courage...",
        speaker: "Ganondorf",
        via: "textbox",
      },
      {
        start: 6909,
        end: 6912.4,
        text: "Ganondorf, the King of Evil, is no more.",
        speaker: "Princess Zelda",
        via: "both",
        words: [
          { text: "Ganondorf,", start: 6909, end: 6909.8 },
          { text: "the", start: 6909.9, end: 6910 },
          { text: "King", start: 6910.1, end: 6910.4 },
          { text: "of", start: 6910.4, end: 6910.5 },
          { text: "Evil,", start: 6910.6, end: 6911 },
          { text: "is", start: 6911.3, end: 6911.4 },
          { text: "no", start: 6911.5, end: 6911.7 },
          { text: "more.", start: 6911.8, end: 6912.4 },
        ],
      },
    ],
  );
}

// ---- shot splitting maths ----

test("shots cover a stretch end to end, split at the cuts inside it", () => {
  const shots = splitShots([4, 9.5, 700], 0, 20);
  assert.deepEqual(shots, [
    { start: 0, end: 4 },
    { start: 4, end: 9.5 },
    { start: 9.5, end: 20 },
  ]);
  // No gaps, no overlaps, whatever the cuts.
  const many = splitShots([0.2, 3, 3.1, 3.3, 8, 19.9, 55], 0, 60);
  assert.equal(many[0]!.start, 0);
  assert.equal(many.at(-1)!.end, 60);
  many.forEach((s, i) => i && assert.equal(s.start, many[i - 1]!.end));
});

test("a shot too short to show joins its neighbour and a long one is divided evenly", () => {
  // The cut at 0.2 and the flurry at 3.1 and 3.3 make no shots of their own; the tail under 0.7 s joins the last.
  assert.deepEqual(
    splitShots([0.2, 3, 3.1, 3.3, 9.6], 0, 10).map((s) => s.start),
    [0, 3],
  );
  const long = splitShots([], 100, 166);
  assert.equal(long.length, 6);
  assert.ok(long.every((s) => Math.abs(s.end - s.start - 11) < 0.01));
  assert.deepEqual(splitShots([], 5, 5), []);
  // A stretch in the middle of the source ignores cuts outside it.
  assert.deepEqual(
    splitShots([10, 650, 1300], 600, 700),
    [
      { start: 600, end: 650 },
      { start: 650, end: 700 },
    ].flatMap((s) => splitShots([], s.start, s.end)),
  );
});

test("keyframes: one for a short shot, two for a few seconds, three beyond, never on the edges", () => {
  assert.deepEqual(keyframeTimes(10, 12), [11]);
  assert.deepEqual(keyframeTimes(10, 14), [11, 13]);
  assert.deepEqual(keyframeTimes(0, 10), [1.5, 5, 8.5]);
  assert.deepEqual(keyframeTimes(3, 3), []);
});

test("shots from a scan: a hard cut splits, a black stretch is marked blank", () => {
  const rows = [];
  for (let i = 0; i < 100; i++) {
    const time = 600 + i / 10;
    const cut = i === 40 || i === 70;
    rows.push({
      time,
      luma: i >= 70 ? 3 : 90,
      motion: cut ? 60 : 2,
      scene: cut ? 0.6 : 0.01,
    });
  }
  const shots = shotsFromScan(rows, 600, 610);
  assert.deepEqual(
    shots.map((s) => [s.start, s.end]),
    [
      [600, 604],
      [604, 607],
      [607, 610],
    ],
  );
  assert.deepEqual(
    shots.map((s) => s.blank),
    [false, false, true],
  );
  assert.ok(
    shots[0]!.motion < 5,
    "the cut frame's own difference is not the shot's movement",
  );
});

// ---- schema and versioning ----

test("an index file round-trips, is renumbered in time order and carries its version", async () => {
  const dir = await tmpDir();
  const index = sample();
  assert.equal(index.version, SCENE_INDEX_VERSION);
  const file = await saveSceneIndex(dir, index);
  assert.equal(
    file,
    path.join(
      dir,
      "sceneindex",
      "the-legend-of-zelda-ocarina-of-time",
      "index.json",
    ),
  );
  const back = await loadSceneIndex(dir, GAME);
  assert.deepEqual(back, index);
  assert.deepEqual(
    back!.shots.map((s) => s.id),
    [0, 1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.equal(
    back!.lines[2]!.shot,
    4,
    "a line belongs to the shot it starts in",
  );
  assert.equal(await loadSceneIndex(dir, "Some Other Game"), undefined);
});

test("an index from a newer factory, or a broken one, reads as none; bad rows are dropped one by one", () => {
  const good = JSON.parse(JSON.stringify(sample()));
  assert.equal(
    parseSceneIndex({ ...good, version: SCENE_INDEX_VERSION + 1 }),
    undefined,
  );
  assert.equal(parseSceneIndex({ ...good, version: 0 }), undefined);
  assert.equal(
    parseSceneIndex({ ...good, source: { ...good.source, videoId: "nope" } }),
    undefined,
  );
  assert.equal(parseSceneIndex(null), undefined);
  assert.equal(parseSceneIndex("index"), undefined);
  const messy = parseSceneIndex({
    ...good,
    shots: [...good.shots, { start: 50, end: 40 }, null, { start: "x" }],
    lines: [
      ...good.lines,
      { start: 10, end: 12, text: "  " },
      { start: 9000, end: 8000, text: "backwards" },
    ],
  })!;
  assert.equal(messy.shots.length, good.shots.length);
  assert.equal(messy.lines.length, good.lines.length);
});

test("game folders, coverage and the next stretch to index", () => {
  assert.equal(
    sceneSlug("The Legend of Zelda: Ocarina of Time"),
    "the-legend-of-zelda-ocarina-of-time",
  );
  assert.equal(sceneSlug("Grand Theft Auto VI"), "grand-theft-auto-vi");
  assert.equal(sceneSlug("Pokémon Légendes: Z-A"), "pokemon-legendes-z-a");
  assert.deepEqual(
    mergeCoverage([
      { from: 600, to: 1200 },
      { from: 0, to: 600 },
      { from: 1500, to: 1800 },
    ]),
    [
      { from: 0, to: 1200 },
      { from: 1500, to: 1800 },
    ],
  );
  const idx = {
    coverage: mergeCoverage([
      { from: 0, to: 1200 },
      { from: 1500, to: 1800 },
    ]),
    source,
  };
  assert.equal(coveredSeconds(idx), 1500);
  assert.deepEqual(nextGap(idx, 600), { from: 1200, to: 1500 });
  assert.deepEqual(nextGap({ coverage: [], source }, 600), {
    from: 0,
    to: 600,
  });
  assert.equal(indexComplete(idx), false);
  const done = { coverage: [{ from: 0, to: 7460 }], source };
  assert.equal(
    indexComplete(done),
    true,
    "the last seconds of an upload are its end card",
  );
  assert.equal(nextGap(done, 600), undefined);
  assert.equal(shotAt([{ start: 0 }, { start: 5 }, { start: 9 }], 7), 1);
});

test("an index is rebuilt only for a better source: a movie over a playthrough, or a much sharper picture", () => {
  const cur = {
    videoId: "aaaaaaaaaaa",
    kind: "playthrough" as const,
    height: 1080,
  };
  assert.equal(
    betterSource(cur, { videoId: "bbbbbbbbbbb", kind: "movie", height: 720 }),
    true,
  );
  assert.equal(
    betterSource(
      { ...cur, kind: "movie" },
      { videoId: "bbbbbbbbbbb", kind: "playthrough", height: 2160 },
    ),
    false,
  );
  assert.equal(
    betterSource(
      { ...cur, kind: "movie" },
      { videoId: "bbbbbbbbbbb", kind: "movie", height: 2160 },
    ),
    false,
  );
  assert.equal(
    betterSource(
      { ...cur, kind: "movie", height: 480 },
      { videoId: "bbbbbbbbbbb", kind: "movie", height: 1080 },
    ),
    true,
  );
  assert.equal(
    betterSource(cur, { ...cur, kind: "movie" }),
    false,
    "the same upload never replaces itself",
  );
});

test("reading a stretch again keeps what was already seen in its shots", () => {
  const index = sample();
  const again = mergeStretch(
    index,
    { from: 180, to: 200 },
    [
      {
        start: 185,
        end: 191,
        keyframes: [188],
        desc: "",
        who: [],
        where: "",
        mood: "",
        tags: [],
        text: "",
        luma: 80,
        motion: 6,
      },
      {
        start: 191,
        end: 196,
        keyframes: [193],
        desc: "",
        who: [],
        where: "",
        mood: "",
        tags: [],
        text: "",
        luma: 80,
        motion: 6,
      },
    ],
    [
      {
        start: 187.25,
        end: 190.75,
        text: "I will entrust everything to the child.",
        speaker: "Great Deku Tree",
        via: "textbox",
      },
    ],
  );
  assert.equal(again.shots[0]!.desc, index.shots[0]!.desc);
  assert.deepEqual(again.shots[0]!.who, ["Great Deku Tree"]);
  assert.equal(
    again.shots[1]!.desc,
    "",
    "a shot whose span changed is looked at again",
  );
  assert.equal(again.lines.filter((l) => l.start < 200).length, 1);
  assert.equal(again.shots.length, index.shots.length);
  assert.equal(undescribed(again).length, 1);
  assert.equal(sceneIndexReady(again), false);
  assert.equal(sceneIndexReady(index), true);
});

// ---- dialogue: text recognition ----

const fixture = JSON.parse(
  fsSync.readFileSync(
    path.join(here, "fixtures", "sceneindex_ocr.json"),
    "utf8",
  ),
) as {
  results: Array<OcrPage & { file: string }>;
};
const pages = (prefix: string, from: number): OcrSample[] =>
  fixture.results
    .filter((r) => r.file.startsWith(prefix))
    .map((r, i) => ({
      time: from + i / 2,
      page: { width: r.width, height: r.height, words: r.words },
    }));

test("text-box dialogue from Apple's text reader: each line once, with its speaker, start and end", () => {
  const lines = textBoxLines(pages("a_", 185), { step: 0.5 });
  assert.deepEqual(
    lines.map((l) => [l.speaker, l.text]),
    [
      [
        "Great Deku Tree",
        "My heart feels heavy. Soon I will no longer be able to protect the forest. I must ensure its safety.",
      ],
      ["Great Deku Tree", "I will entrust everything to the child."],
      ["Great Deku Tree", "Navi..."],
    ],
  );
  assert.deepEqual(
    lines.map((l) => [l.start, l.end]),
    [
      [184.75, 186.75],
      [187.25, 190.75],
      [191.75, 193.25],
    ],
  );
  assert.ok(lines.every((l) => l.via === "textbox" && !l.words));
});

test("a place card is writing on screen, not a line of dialogue", () => {
  const card = pages("b_", 370);
  assert.deepEqual(textBoxLines(card, { step: 0.5 }), []);
  assert.match(shotText(card), /KOKIRI FOREST/);
  assert.equal(isDialogue("KOKIRI FOREST"), false);
  assert.equal(isDialogue("OCARINA OF TIME"), false);
  assert.equal(isDialogue("DaGG"), false);
  assert.equal(isDialogue("Navi..."), true);
  assert.equal(isDialogue("No!"), true);
  assert.equal(isDialogue("I will entrust everything to the child."), true);
});

test("a name plate is the speaker; 'Name: words' gives one too; a line typed out letter by letter is one line", () => {
  const word = (text: string, x: number, y: number, h = 30) => ({
    text,
    x,
    y,
    w: text.length * 16,
    h,
  });
  const frame = (words: ReturnType<typeof word>[]): OcrPage => ({
    width: 1708,
    height: 960,
    words,
  });
  const plate = readBox(
    frame([
      word("Sheik", 530, 700, 22),
      word("The", 700, 780),
      word("flow", 770, 780),
      word("of", 850, 780),
      word("time", 900, 780),
      word("is", 980, 780),
      word("cruel.", 1020, 780),
    ]),
  )!;
  assert.equal(plate.speaker, "Sheik");
  assert.equal(plate.text, "The flow of time is cruel.");
  const colon = readBox(
    frame([
      word("Navi:", 640, 800),
      word("Hey,", 750, 800),
      word("listen!", 840, 800),
    ]),
  )!;
  assert.deepEqual([colon.speaker, colon.text], ["Navi", "Hey, listen!"]);
  assert.equal(
    readBox(frame([word("36", 1600, 40)])),
    undefined,
    "a HUD number at the top is no dialogue",
  );
  assert.equal(isName("Great Deku Tree"), true);
  assert.equal(isName("Hey, listen!"), false);
  const typed = [
    "The flow",
    "The flow of time",
    "The flow of time is cruel.",
    "The flow of time is cruel.",
  ].map((t, i) => ({
    time: 10 + i / 2,
    page: frame(t.split(" ").map((w, k) => word(w, 700 + k * 90, 780))),
  }));
  const lines = textBoxLines(typed, { step: 0.5 });
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.text, "The flow of time is cruel.");
  assert.deepEqual([lines[0]!.start, lines[0]!.end], [9.75, 11.75]);
});

test("the reader's usual slips are tidied and near-identical readings are one", () => {
  assert.equal(
    tidyLine("Now that lim a sage, l can send you back"),
    "Now that I'm a sage, I can send you back",
  );
  assert.equal(
    tidyLine("l'll  wait for you , Link ."),
    "I'll wait for you, Link.",
  );
  assert.ok(
    alike(
      "Now that I'm a sage, I can send you back",
      "Now that lIm a sage, l can send you back",
    ) > 0.85,
  );
  assert.ok(alike("Navi...", "Hello, Link!") < 0.3);
});

// ---- dialogue: Whisper ----

/** Word timings in the shape src/qa/whisperwords.py writes. */
const whisper = {
  duration: 30,
  words: [
    { text: "You've", start: 1.0, end: 1.3 },
    { text: "finally", start: 1.3, end: 1.7 },
    { text: "awakened.", start: 1.7, end: 2.4 },
    { text: "I", start: 2.8, end: 2.9 },
    { text: "am", start: 2.9, end: 3.0 },
    { text: "Rauru,", start: 3.0, end: 3.6 },
    { text: "one", start: 3.7, end: 3.9 },
    { text: "of", start: 3.9, end: 4.0 },
    { text: "the", start: 4.0, end: 4.1 },
    { text: "ancient", start: 4.1, end: 4.6 },
    { text: "sages.", start: 4.6, end: 5.2 },
    { text: "Thank", start: 12.0, end: 12.3 },
    { text: "you.", start: 12.3, end: 12.6 },
    { text: "Ganondorf", start: 20.0, end: 20.8 },
    { text: "is", start: 21.9, end: 22.0 },
    { text: "", start: 22.0, end: 22.1 },
    { text: "gone.", start: 22.0, end: 22.5 },
    { text: "bad", start: Number.NaN, end: 23 },
  ],
};

test("Whisper's words become lines at the pauses, with word timings and the stretch's offset", () => {
  const lines = voiceLines(whisper.words, { offset: 600 });
  assert.deepEqual(
    lines.map((l) => l.text),
    [
      "You've finally awakened.",
      "I am Rauru, one of the ancient sages.",
      "Ganondorf",
      "is gone.",
    ],
  );
  assert.deepEqual([lines[0]!.start, lines[0]!.end], [601, 602.4]);
  assert.equal(lines[1]!.words!.length, 8);
  assert.deepEqual(lines[1]!.words![2], {
    text: "Rauru,",
    start: 603,
    end: 603.6,
  });
  assert.ok(lines.every((l) => l.via === "voice"));
  // "Thank you." over music is Whisper's invention; a line repeated on a loop is too.
  assert.ok(!lines.some((l) => /thank/i.test(l.text)));
  const loop = Array.from({ length: 6 }, (_, i) => ({
    text: "Hyah!",
    start: i * 2,
    end: i * 2 + 0.4,
  }));
  assert.equal(voiceLines(loop).length, 2);
});

test("a line heard and read at once is one line: the screen's spelling and speaker, the voice's timings", () => {
  const read = [
    {
      start: 600.75,
      end: 603,
      text: "You've finally awakened.",
      speaker: "Rauru",
      via: "textbox" as const,
    },
    {
      start: 700,
      end: 704,
      text: "Hey! Listen!",
      speaker: "Navi",
      via: "textbox" as const,
    },
  ];
  const heard = voiceLines(
    [
      { text: "You", start: 1.0, end: 1.2 },
      { text: "finally", start: 1.3, end: 1.7 },
      { text: "awakened.", start: 1.7, end: 2.4 },
      { text: "Completely", start: 50, end: 50.5 },
      { text: "unrelated", start: 50.5, end: 51 },
      { text: "words.", start: 51, end: 51.4 },
    ],
    { offset: 600 },
  );
  const merged = mergeDialogue(read, heard);
  assert.deepEqual(
    merged.map((l) => [l.via, l.speaker, l.text]),
    [
      ["both", "Rauru", "You've finally awakened."],
      ["voice", undefined, "Completely unrelated words."],
      ["textbox", "Navi", "Hey! Listen!"],
    ],
  );
  assert.deepEqual([merged[0]!.start, merged[0]!.end], [601, 602.4]);
  assert.equal(merged[0]!.words!.length, 3);
  // A game that speaks through text boxes: a heard line matching nothing on screen is a misheard grunt.
  const many = Array.from({ length: 24 }, (_, i) => ({
    start: i * 10,
    end: i * 10 + 4,
    text: `Line number ${i} of the story.`,
    via: "textbox" as const,
  }));
  assert.equal(
    mergeDialogue(many, heard).filter((l) => l.via === "voice").length,
    0,
  );
});

// ---- lookup ranking ----

test("a footage target finds the shot that shows it, with a confidence", () => {
  const index = sample();
  const rise = findShots(index, { text: "Ganondorf rises over Hyrule Castle" });
  assert.equal(rise[0]!.start, 6900);
  assert.ok(rise[0]!.confidence >= 0.7, `confidence ${rise[0]!.confidence}`);
  assert.ok(rise[0]!.matched.includes("ganondorf"));
  // The description says "pulls the blade from the pedestal"; the target says "draws the Master Sword".
  const draw = findShots(index, {
    text: "Link draws the Master Sword",
    keywords: ["Master Sword", "pedestal"],
  });
  assert.equal(draw[0]!.start, 2411);
  assert.ok(
    draw[0]!.confidence > rise.at(-1)!.confidence || draw[0]!.confidence >= 0.6,
  );
  // The organ scene has Ganondorf but neither the castle nor the rising: it ranks below, or not at all.
  const organ = rise.find((h) => h.start === 7000);
  assert.ok(!organ || organ.score < rise[0]!.score);
});

test("lookup rules: names count most, neighbours lend a little, blank shots never come back", () => {
  const index = sample();
  // The close-up of hands has no name of its own: it borrows the scene's from the shots beside it.
  const hands = findShots(
    index,
    { text: "Link's hands on the hilt of the sword in the stone" },
    { max: 3 },
  );
  assert.ok(hands.slice(0, 2).some((h) => h.start === 2406 && h.matched.includes("link")));
  // A target naming someone the index never saw is at best a weak look-alike.
  const nobody = findShots(index, { text: "Darunia dances in a stone hall" });
  assert.ok(nobody.every((h) => h.confidence < 0.5));
  assert.ok(
    findShots(index, { text: "a black screen" }).every((h) => h.start !== 2418),
  );
  assert.deepEqual(findShots(index, { text: "the of and" }), []);
  // Hits closer than the spacing are one moment; minSeconds drops shots too short to carry a line.
  const forest = findShots(index, { text: "Kokiri Forest" }, { spacing: 10 });
  assert.equal(forest.length, 1);
  assert.ok(
    findShots(index, { text: "Kokiri Forest" }, { minSeconds: 7 }).every(
      (h) => h.end - h.start >= 7,
    ),
  );
  assert.equal(stem("rises"), stem("rising"));
  assert.deepEqual(tokens("Link's hands on the Master Sword"), [
    "link",
    "hand",
    "master",
    "sword",
  ]);
});

test("a quote finds its exact line, across a page turn too, and its own words when the voice is timed", () => {
  const index = sample();
  const exact = findQuote(index, "I will entrust everything to the child")[0]!;
  assert.deepEqual(
    [exact.start, exact.end, exact.confidence, exact.speaker],
    [187.25, 190.75, 1, "Great Deku Tree"],
  );
  assert.equal(exact.shot, 0);
  // The sentence runs over two boxes.
  const turn = findQuote(
    index,
    "Rather, the power of the Triforce of Courage",
  )[0]!;
  assert.equal(turn.lines.length, 2);
  assert.deepEqual([turn.start, turn.end], [6901, 6907.5]);
  // Voice timings give the start and end of the quoted words themselves.
  const timed = findQuote(index, "the King of Evil")[0]!;
  assert.equal(timed.wordTimed, true);
  assert.deepEqual([timed.start, timed.end], [6909.9, 6911]);
  // A near miss (one word different) still finds the line, below full confidence; nonsense finds nothing.
  const near = findQuote(index, "I shall entrust everything to the child")[0]!;
  assert.equal(near.start, 187.25);
  assert.ok(near.confidence < 1 && near.confidence >= 0.8);
  assert.deepEqual(
    findQuote(index, "It's dangerous to go alone, take this"),
    [],
  );
  // The same words by another speaker are marked down.
  assert.ok(
    findQuote(index, "Navi...", { speaker: "Saria", minConfidence: 0 })[0]!
      .confidence < 0.7,
  );
});

// ---- names and descriptions ----

test("the game's names come from its story text and are split into places and the rest", () => {
  const text = storyText(
    "Lead text about Nintendo.\n\n== Gameplay ==\nPlayers use Z-targeting.\n\n== Plot ==\nGanondorf attacks Hyrule Castle. Link draws the Master Sword in the Temple of Time. Then Link defeats Ganondorf. Link meets Princess Zelda in Kakariko Village. Link rides on.\n\n== Development ==\nShigeru Miyamoto led the team at Nintendo.",
  );
  assert.ok(!text.includes("Miyamoto") && !text.includes("Z-targeting"));
  const names = namesInText(text);
  for (const n of [
    "Ganondorf",
    "Link",
    "Hyrule Castle",
    "Master Sword",
    "Temple of Time",
    "Princess Zelda",
    "Kakariko Village",
  ])
    assert.ok(names.includes(n), `${n} in ${names.join(", ")}`);
  const split = splitNames(names);
  assert.ok(
    split.places.includes("Hyrule Castle") &&
      split.places.includes("Temple of Time"),
  );
  assert.ok(
    split.cast.includes("Ganondorf") && !split.cast.includes("Hyrule Castle"),
  );
  assert.deepEqual(
    mergeNames(["Great Deku Tree", "Navi"], ["great deku tree", "Saria"]),
    ["Great Deku Tree", "Navi", "Saria"],
  );
  assert.equal(knownName("ganondorf", names), "Ganondorf");
  assert.equal(knownName("Ganondort", names), "Ganondorf", "one slip away");
  assert.equal(knownName("Zelda", names), "Princess Zelda");
  assert.equal(knownName("Mario", names), undefined);
});

test("the vision model's answer keeps only names on the game's list", () => {
  const c = {
    game: GAME,
    cast: ["Link", "Ganondorf", "Princess Zelda"],
    places: ["Hyrule Castle"],
    dialogue: ["Ganondorf: Pitiful little girl."],
    text: "",
    frames: 3,
  };
  const prompt = lookPrompt(c);
  assert.match(prompt, /Link, Ganondorf, Princess Zelda/);
  assert.match(prompt, /Ganondorf: Pitiful little girl\./);
  assert.match(prompt, /3 frames of one shot/);
  const look = lookAnswer(
    {
      description: " A man in dark armour  raises his fist. ",
      characters: ["ganondorf", "Mario", "Zelda"],
      place: "hyrule castle",
      mood: "Menacing",
      tags: ["Fist", "storm", "x"],
      menu: false,
    },
    c,
  )!;
  assert.equal(look.desc, "A man in dark armour raises his fist.");
  assert.deepEqual(look.who, ["Ganondorf", "Princess Zelda"]);
  assert.equal(look.where, "Hyrule Castle");
  assert.deepEqual(look.tags, ["fist", "storm"]);
  assert.equal(lookAnswer({ description: "true" }, c), undefined);
  assert.equal(lookAnswer({}, c), undefined);
});

// ---- choosing the source ----

const upload = (
  videoId: string,
  title: string,
  extra: Partial<CutsceneUpload> = {},
): CutsceneUpload => ({
  videoId,
  title,
  uploader: "Game Cinema",
  duration: 7500,
  height: 2160,
  viewCount: 1000,
  ...extra,
});

test("the source: a full movie beats a playthrough, the remake for a recent release, nothing endless", async () => {
  assert.equal(
    sourceKind("ZELDA: OCARINA OF TIME REMAKE Full Movie (Cutscenes Only) 4K"),
    "movie",
  );
  assert.equal(
    sourceKind("Zelda: Ocarina of Time Remake - All Cutscenes"),
    "movie",
  );
  assert.equal(
    sourceKind(
      "ZELDA OCARINA OF TIME REMAKE Gameplay Walkthrough FULL GAME No Commentary",
    ),
    "playthrough",
  );
  const hits = [
    upload(
      "aaaaaaaaaaa",
      "Zelda: Ocarina of Time Remake Walkthrough FULL GAME No Commentary",
      { duration: 40000, viewCount: 900000 },
    ),
    upload(
      "bbbbbbbbbbb",
      "Zelda: Ocarina of Time Remake - All Cutscenes Full Movie",
      { viewCount: 5000 },
    ),
    upload(
      "ccccccccccc",
      "Zelda: Ocarina of Time 3D All Cutscenes (Game Movie)",
      { viewCount: 800000 },
    ),
    upload(
      "ddddddddddd",
      "Zelda: Ocarina of Time Remake All Cutscenes reaction and commentary",
      { viewCount: 9000000 },
    ),
    upload(
      "eeeeeeeeeee",
      "Zelda: Ocarina of Time Remake - All Ganondorf Cutscenes",
      { duration: 900 },
    ),
  ];
  assert.equal(
    pickSource(hits, GAME, { recentRelease: true })!.videoId,
    "bbbbbbbbbbb",
  );
  assert.equal(pickSource(hits, GAME, { recentRelease: true })!.kind, "movie");
  assert.equal(
    pickSource(hits, GAME)!.videoId,
    "ccccccccccc",
    "the original's own movie when the video is not about the remake",
  );
  // Only a playthrough exists: it is taken, unless it runs past the limit.
  assert.equal(
    pickSource([hits[0]!], GAME, { recentRelease: true })!.kind,
    "playthrough",
  );
  assert.equal(
    pickSource([hits[0]!], GAME, { recentRelease: true, maxHours: 10 }),
    undefined,
  );
  const chosen = await chooseSource(
    GAME,
    { ytdlp: "yt-dlp", maxHours: 12 },
    { recentRelease: true },
    {
      search: async () => hits,
      details: async (u) => u,
      now: () => new Date("2026-11-11T12:00:00Z"),
    },
  );
  assert.deepEqual(
    [chosen!.videoId, chosen!.kind, chosen!.pickedAt],
    ["bbbbbbbbbbb", "movie", "2026-11-11T12:00:00.000Z"],
  );
  assert.equal(
    await chooseSource(
      GAME,
      { ytdlp: "yt-dlp", maxHours: 12 },
      {},
      { search: async () => [], details: async (u) => u },
    ),
    undefined,
  );
});

test("the proxy is small and the tools' arguments are as the build expects", () => {
  const args = proxyArgs("8UVbiI44V_c", 480, "/data/proxy.mp4");
  assert.ok(args.includes("https://www.youtube.com/watch?v=8UVbiI44V_c"));
  assert.match(args[args.indexOf("-f") + 1]!, /height<=480.*avc1/);
  assert.ok(
    scanArgs("/data/proxy.mp4", 600, 600, "scan.txt")
      .join(" ")
      .includes("-ss 600.00 -t 600.00"),
  );
  assert.ok(
    scanArgs("/data/proxy.mp4", 0, 600, "scan.txt")
      .at(-5)!
      .includes("metadata=print:file=scan.txt"),
  );
  assert.ok(
    ocrFrameArgs("/p.mp4", 0, 600, 2, "f_%06d.jpg")
      .join(" ")
      .includes("fps=2,scale=-2:960"),
  );
  const strip = stripArgs("/p.mp4", [1.5, 5, 8.5], "/s.jpg").join(" ");
  assert.ok(strip.includes("hstack=inputs=3") && strip.includes("-ss 8.50"));
  assert.ok(!stripArgs("/p.mp4", [4], "/s.jpg").join(" ").includes("hstack"));
});

// ---- the background job ----

test("the queue: one entry a game, launch-day releases, and rests between tries", () => {
  const now = new Date("2026-11-19T09:00:00Z");
  let q = queueGame(
    { games: [] },
    "Grand Theft Auto VI",
    "launched 2026-11-19",
    now,
    true,
  );
  q = queueGame(q, "grand theft auto vi", "a video about it", now);
  assert.equal(q.games.length, 1);
  assert.equal(q.games[0]!.recentRelease, true);
  assert.deepEqual(
    parseQueue({ games: [{ game: "x" }, null, q.games[0]] }).games,
    q.games,
  );
  const launches = [
    {
      game: "The Legend of Zelda: Ocarina of Time",
      match: "ocarina of time",
      launch: "2026-11-05",
    },
    {
      game: "Grand Theft Auto VI",
      match: "gta (6|vi)\\b",
      launch: "2026-11-19",
    },
    { game: "Path of Exile 2", match: "path of exile 2", launch: "2026-12-11" },
    { game: "Elden Ring", match: "elden ring", launch: "2022-02-25" },
  ];
  const calendar = [
    {
      date: "2026-11-22",
      lane: "doc" as const,
      text: "Elden Ring: the story so far",
    },
    {
      date: "2026-11-21",
      lane: "news" as const,
      text: "Path of Exile 2 preview",
    },
  ];
  assert.deepEqual(
    launchGames(launches, calendar, now).map((g) => g.game),
    [
      "The Legend of Zelda: Ocarina of Time",
      "Grand Theft Auto VI",
      "Elden Ring",
    ],
    "launched within two weeks, launching today, and an older game the calendar names; never a game not out yet",
  );
  assert.deepEqual(
    launchGames(launches, [], new Date("2026-11-18T23:00:00Z")).map(
      (g) => g.game,
    ),
    ["The Legend of Zelda: Ocarina of Time"],
  );
  assert.equal(nextJob(q, now)!.game, "Grand Theft Auto VI");
  const none = afterTurn(q, "Grand Theft Auto VI", "no-source", now);
  assert.equal(
    nextJob(none, new Date(now.getTime() + 3_600_000)),
    undefined,
    "no clean upload yet: look again in twelve hours",
  );
  assert.equal(
    nextJob(none, new Date(now.getTime() + 13 * 3_600_000))!.tries,
    1,
  );
  const waiting = afterTurn(q, "Grand Theft Auto VI", "waiting", now);
  assert.equal(
    nextJob(waiting, new Date(now.getTime() + 10 * 60_000)),
    undefined,
  );
  assert.ok(nextJob(waiting, new Date(now.getTime() + 31 * 60_000)));
  assert.ok(
    nextJob(afterTurn(q, "Grand Theft Auto VI", "stretch", now), now),
    "more to do: straight on",
  );
  assert.equal(
    nextJob(afterTurn(q, "Grand Theft Auto VI", "done", now), now),
    undefined,
  );
});

test("a turn runs behind the Mac's turn-taker and its last word is the outcome", () => {
  assert.deepEqual(
    turnCommand("darwin", "/Users/m/orch/macrun.sh", "/usr/bin/node", [
      "a",
      "b",
    ]),
    [
      "/bin/bash",
      [
        "/Users/m/orch/macrun.sh",
        "pulse-sceneindex",
        "/usr/bin/node",
        "a",
        "b",
      ],
    ],
  );
  assert.deepEqual(turnCommand("darwin", undefined, "/usr/bin/node", ["a"]), [
    "taskpolicy",
    ["-b", "/usr/bin/node", "a"],
  ]);
  assert.deepEqual(turnCommand("win32", undefined, "node.exe", ["a"]), [
    "node.exe",
    ["a"],
  ]);
  assert.equal(
    turnOutcome(
      '{"t":"x","msg":"scene index: stretch indexed"}\nstretch {"from":0,"to":600} in 200 s\ndescribed {"described":300} in 900 s\n',
    ),
    "described",
  );
  assert.equal(turnOutcome("waiting {} in 1 s\r\n"), "waiting");
  assert.equal(turnOutcome("Error: boom"), "");
});

test("SCENE_INDEX off: nothing is queued, built or looked up", async () => {
  const dir = await tmpDir();
  const cfg = testConfig(dir);
  assert.equal(cfg.sceneIndex, false);
  await saveSceneIndex(dir, sample());
  await requestSceneIndex(cfg, "Grand Theft Auto VI", "a video about it");
  assert.deepEqual(await readQueue(dir), { games: [] });
  let ran = 0;
  const outcome = await sceneIndexTick(
    cfg,
    [{ game: "Grand Theft Auto VI", reason: "launched" }],
    {
      run: async () => {
        ran++;
        return { stdout: "done", code: 0 };
      },
    },
  );
  assert.equal(outcome, undefined);
  assert.equal(ran, 0);
  assert.deepEqual(await readQueue(dir), { games: [] });
  // The cutscene hook is exactly the search: the stored index is not even read.
  const searched: string[] = [];
  const clips = await indexFirstCutscenes(
    cfg,
    {
      gameTitle: GAME,
      recentRelease: true,
      episodeDir: dir,
      targets: [target("hook", "Ganondorf rises over Hyrule Castle")],
      maxClips: 4,
      maxSeconds: 20,
    },
    async (o) => {
      searched.push(o.gameTitle);
      return [];
    },
    { download: async () => assert.fail("no download while off") },
  );
  assert.deepEqual(clips, []);
  assert.deepEqual(searched, [GAME]);
});

test("SCENE_INDEX on: the tick queues the launch games and gives the first one a turn", async () => {
  const dir = await tmpDir();
  const cfg = testConfig(dir, { sceneIndex: true, macMinFreeGb: 40 });
  const calls: Array<{ cmd: string; args: string[]; env: NodeJS.ProcessEnv }> =
    [];
  const now = () => new Date("2026-11-19T09:00:00Z");
  const run = async (cmd: string, args: string[], env: NodeJS.ProcessEnv) => {
    calls.push({ cmd, args, env });
    return { stdout: 'stretch {"from":0,"to":600} in 200 s\n', code: 0 };
  };
  const outcome = await sceneIndexTick(
    cfg,
    [{ game: "Grand Theft Auto VI", reason: "launched 2026-11-19" }],
    { now, run, freeGb: async () => 90 },
  );
  assert.equal(outcome, "stretch");
  assert.equal(calls.length, 1);
  const all = [calls[0]!.cmd, ...calls[0]!.args].join(" ");
  assert.match(
    all,
    /sceneindex\.ts build Grand Theft Auto VI --steps=3 --recent$/,
  );
  assert.equal(calls[0]!.env.DATA_DIR, dir);
  assert.equal(calls[0]!.env.SCENE_INDEX_PROXY_HEIGHT, "480");
  const q = await readQueue(dir);
  assert.deepEqual(
    [q.games[0]!.game, q.games[0]!.state],
    ["Grand Theft Auto VI", "building"],
  );
  // The disk near the Mac's floor: no turn.
  assert.equal(
    await sceneIndexTick(cfg, [], { now, run, freeGb: async () => 42 }),
    undefined,
  );
  // The turn-taker's "no turn" exit is a wait, not a failure.
  assert.equal(
    await sceneIndexTick(cfg, [], {
      now,
      run: async () => ({ stdout: "", code: 75 }),
      freeGb: async () => 90,
    }),
    "waiting",
  );
  assert.equal(calls.length, 1);
});

// ---- the footage hook ----

function target(
  key: string,
  text: string,
  keywords: string[] = [],
): FootageTarget {
  return { key, text, want: "cinematic", energy: "medium", keywords };
}

test("the plan: each line its exact shot, a quoted line the shot it is said in, inside the seconds allowed", () => {
  const index = sample();
  assert.deepEqual(
    quotedWords(
      'Then the tree says "I will entrust everything to the child" and "No".',
    ),
    ["I will entrust everything to the child"],
  );
  const plan = planIndexedClips(
    index,
    [
      target("hook", "Ganondorf rises over Hyrule Castle"),
      target("beat:0", "Link draws the Master Sword", ["Master Sword"]),
      target(
        "beat:1#m2",
        'The Great Deku Tree decides: "I will entrust everything to the child."',
      ),
      target("beat:2", "A stock market chart climbs"),
    ],
    { maxClips: 8, maxSeconds: 13, minConfidence: 0.45 },
  );
  assert.deepEqual(
    plan.map((p) => [p.key, p.from]),
    [
      ["hook", 6900.1],
      ["beat:0", 2411.1],
      ["beat:1#m2", 185.1],
    ],
  );
  assert.equal(plan[0]!.seconds, 4.8);
  assert.ok(plan[2]!.quote?.startsWith("I will entrust"));
  assert.ok(
    plan.reduce((n, p) => n + p.seconds, 0) <= 13 + 1e-9,
    "the per-video budget holds",
  );
  assert.ok(plan[2]!.seconds < 4.8);
  // The same moment is never used twice.
  const twice = planIndexedClips(
    index,
    [
      target("beat:0", "Ganondorf rises over Hyrule Castle"),
      target("beat:1", "Ganondorf rises above Hyrule Castle"),
    ],
    { maxClips: 8, maxSeconds: 60, minConfidence: 0.45 },
  );
  assert.equal(new Set(twice.map((p) => p.shot)).size, twice.length);
});

test("indexed clips carry the cutscene provenance, credit and source, so the rights rules still apply", async () => {
  const dir = await tmpDir();
  const index = sample();
  const fetched: Array<[string, number, number]> = [];
  const clips = await indexedCutsceneClips({
    index,
    gameTitle: GAME,
    episodeDir: dir,
    targets: [
      target("hook", "Ganondorf rises over Hyrule Castle"),
      target("beat:1#m2", "Link draws the Master Sword"),
      target("beat:3", "Navi the fairy flies through Kokiri Forest"),
    ],
    maxClips: 8,
    maxSeconds: 60,
    minConfidence: 0.45,
    ytdlp: "yt-dlp",
    deps: {
      download: async (videoId, from, to, file) => {
        fetched.push([videoId, from, to]);
        await fs.writeFile(file, "section");
      },
      cut: async (_section, at, _seconds, file) => {
        assert.equal(
          at,
          2,
          "the clip starts two seconds into its section: on the shot's own cut",
        );
        await fs.writeFile(file, "clip");
      },
      // The fairy shot fails the clean-frame screen: it is dropped, not shown.
      screen: async (file) =>
        !fsSync.readFileSync(file, "utf8").includes("x") &&
        fetched.length !== 3,
    },
  });
  assert.equal(clips.length, 2);
  assert.deepEqual(fetched[0], ["8UVbiI44V_c", 6898.1, 6906.9]);
  const [hook, sword] = clips as [CutsceneClip, CutsceneClip];
  assert.deepEqual(
    [hook.role, hook.beatIndex, hook.span.from, hook.audio],
    ["hook", undefined, 6900.1, false],
  );
  assert.deepEqual(
    [sword.beatIndex, sword.moment, sword.startSeconds],
    [1, 2, 2411.1],
  );
  assert.match(
    hook.provenance,
    /^Cutscenes for "The Legend of Zelda: Ocarina of Time" from YouTube video "ZELDA: OCARINA OF TIME REMAKE Full Movie/,
  );
  assert.match(
    hook.provenance,
    /video ID: 8UVbiI44V_c .*source time: 6900\.10s, muted; chosen for hook by the scene index/,
  );
  assert.equal(
    hook.credit,
    "FOOTAGE: THE LEGEND OF ZELDA: OCARINA OF TIME CUTSCENES / YOUTUBE",
  );
  assert.deepEqual(hook.youtubeSource, {
    videoId: "8UVbiI44V_c",
    title: source.title,
    uploader: source.uploader,
  });
  assert.ok(
    footageCredits({ game_title: GAME } as never, clips, undefined, undefined, "Zelda").includes(
      "Footage: The Legend of Zelda: Ocarina of Time cutscenes, via YouTube.",
    ),
  );
  assert.ok(fsSync.existsSync(path.join(dir, hook.file)));
  assert.deepEqual(
    (await fs.readdir(dir)).filter((f) => f.startsWith("sceneindex_work_")),
    [],
    "the downloaded sections are removed",
  );
});

test("index first, search second: the search covers only the lines and seconds the index left", async () => {
  const clip = (key: string, from: number, seconds: number): CutsceneClip =>
    ({
      kind: "clip",
      file: `assets/${key}.mp4`,
      sourceUrl: "u",
      provenance: "p",
      durationSeconds: seconds,
      role: key === "hook" ? "hook" : undefined,
      beatIndex: key.startsWith("beat:") ? Number(key.slice(5)) : undefined,
      credit: "c",
      span: { source: "u", from, to: from + seconds },
    }) as CutsceneClip;
  const options = {
    targets: [
      target("hook", "a"),
      target("beat:0", "b"),
      target("beat:1", "c"),
    ],
    maxClips: 6,
    maxSeconds: 20,
  };
  const asked: Array<{ keys: string[]; maxSeconds: number; maxClips: number }> =
    [];
  const search = async (o: typeof options) => {
    asked.push({
      keys: o.targets.map((t) => t.key),
      maxSeconds: o.maxSeconds,
      maxClips: o.maxClips,
    });
    return [clip("beat:1", 500, 4.8), clip("beat:1", 101, 4.8)];
  };
  const both = await cutscenesIndexFirst(
    options,
    async () => [clip("hook", 100, 4.8), clip("beat:0", 300, 4)],
    search,
  );
  assert.deepEqual(asked, [
    { keys: ["beat:1"], maxSeconds: 11.2, maxClips: 4 },
  ]);
  assert.deepEqual(
    both.map((c) => c.span.from),
    [100, 300, 500],
    "the search's copy of an indexed moment is dropped",
  );
  // No index, an empty lookup or a failing one: the whole search, as before.
  assert.equal(
    (await cutscenesIndexFirst(options, undefined, search)).length,
    2,
  );
  assert.equal(
    (await cutscenesIndexFirst(options, async () => [], search)).length,
    2,
  );
  assert.equal(
    (
      await cutscenesIndexFirst(
        options,
        async () => Promise.reject(new Error("x")),
        search,
      )
    ).length,
    2,
  );
  assert.deepEqual(asked.at(-1), {
    keys: ["hook", "beat:0", "beat:1"],
    maxSeconds: 20,
    maxClips: 6,
  });
});

test("SCENE_INDEX on: a game's index is found under the script's name, a remake's index only for the remake, a missing one is queued", async () => {
  const dir = await tmpDir();
  const cfg = testConfig(dir, { sceneIndex: true });
  await saveSceneIndex(dir, sample());
  assert.equal(
    matchingSlug(["the-legend-of-zelda-ocarina-of-time"], "Ocarina of Time"),
    "the-legend-of-zelda-ocarina-of-time",
  );
  assert.equal(
    matchingSlug(["ocarina-of-time"], "The Legend of Zelda: Ocarina of Time"),
    "ocarina-of-time",
  );
  assert.equal(
    matchingSlug(["halo-3-odst", "halo-infinite"], "Halo 3"),
    undefined,
  );
  assert.equal(indexFitsRelease(sample(), true), true);
  assert.equal(
    indexFitsRelease(sample(), false),
    false,
    "the 1998 game is not shown with the 2026 remake",
  );
  const deps = {
    download: async (_id: string, _a: number, _b: number, file: string) =>
      fs.writeFile(file, "s"),
    cut: async (_s: string, _at: number, _n: number, file: string) =>
      fs.writeFile(file, "c"),
    screen: async () => true,
  };
  let searches = 0;
  const search = async () => {
    searches++;
    return [] as CutsceneClip[];
  };
  const base = {
    episodeDir: path.join(dir, "ep"),
    targets: [target("hook", "Ganondorf rises over Hyrule Castle")],
    maxClips: 4,
    maxSeconds: 20,
  };
  await fs.mkdir(base.episodeDir, { recursive: true });
  const found = await indexFirstCutscenes(
    cfg,
    { ...base, gameTitle: "Ocarina of Time", recentRelease: true },
    search,
    deps,
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]!.span.from, 6900.1);
  assert.equal(
    searches,
    0,
    "every line has its shot: nothing left to search for",
  );
  await indexFirstCutscenes(
    cfg,
    { ...base, gameTitle: "Ocarina of Time", recentRelease: false },
    search,
    deps,
  );
  assert.equal(searches, 1);
  await indexFirstCutscenes(
    cfg,
    { ...base, gameTitle: "Hollow Knight: Silksong", recentRelease: true },
    search,
    deps,
  );
  assert.equal(searches, 2);
  const q = await readQueue(dir);
  assert.deepEqual(
    q.games.map((g) => [g.game, g.recentRelease]),
    [["Hollow Knight: Silksong", true]],
  );
});

// ---- tidying the whole index ----

test("a misread name plate takes the game's spelling, a split line is one again, a card names who and where", () => {
  const counts = new Map([
    ["Ruto", 27],
    ["Roto", 1],
    ["Ruto-", 1],
    ["Zelda", 26],
    ["Zeida", 2],
    ["Darunia", 44],
    ["Durania", 1],
    ["Impa", 4],
    ["DELO TREE", 1],
    ["Sheik", 3],
  ]);
  const spell = speakerSpellings(counts, ["Impa", "Sheik", "Link"]);
  assert.equal(spell.get("Roto"), "Ruto");
  assert.equal(spell.get("Ruto-"), "Ruto");
  assert.equal(spell.get("Zeida"), "Zelda");
  assert.equal(spell.get("Durania"), "Darunia");
  assert.equal(spell.get("Impa"), "Impa", "rare but on the cast list");
  assert.equal(spell.get("Sheik"), "Sheik");
  assert.equal(spell.get("DELO TREE"), "", "a scrap seen once and close to nothing");
  assert.equal(editDistance("darunia", "durania"), 2);
  const joined = joinSplitLines([
    { start: 1797.5, end: 1799.5, text: "The Zora Sapphire shall be yours!", speaker: "Ruto", via: "textbox" as const },
    { start: 1799.5, end: 1800.5, text: "The Zora Sapphire shall be yours!", speaker: "Ruto", via: "textbox" as const },
    { start: 1803, end: 1805, text: "The Zora Sapphire shall be yours!", speaker: "Ruto", via: "textbox" as const },
  ]);
  assert.deepEqual(joined.map((l) => [l.start, l.end]), [[1797.5, 1800.5], [1803, 1805]]);
  assert.deepEqual(namesWritten("SARIA Link's Childhood Friend", ["Link", "Saria", "Navi"]), ["Link", "Saria"]);
  const index = sample();
  index.shots[1]!.text = "SARIA Link's Childhood Friend";
  index.shots[1]!.who = [];
  index.shots[2]!.text = "TEMPLE OF TIME";
  index.shots[2]!.where = "";
  index.cast.push("Saria");
  index.lines[1]!.speaker = "Great Deku Tee";
  const tidy = tidyIndex({ ...index, lines: [...index.lines, ...Array.from({ length: 5 }, (_, i) => ({ ...index.lines[0]!, start: 300 + i * 10, end: 304 + i * 10, text: `Line ${i} of the tree's long speech.` }))] });
  assert.deepEqual(tidy.shots[1]!.who, ["Saria"], "the first name on a card is whose card it is");
  assert.equal(tidy.shots[2]!.where, "Temple of Time");
  assert.equal(tidy.lines[1]!.speaker, "Great Deku Tree");
  assert.deepEqual(tidyIndex(tidy), tidy, "tidying twice changes nothing");
});

test("the lines a video may quote: named speaker, a whole sentence, each once, in the quote feature's shape", () => {
  const lines = quotableLines(sample());
  assert.deepEqual(lines.map((l) => l.text), [
    "I will entrust everything to the child.",
    "The Master Sword... the blade of evil's bane.",
    "Ganondorf, the King of Evil, is no more.",
  ]);
  assert.deepEqual(lines[0], {
    id: "q1873",
    videoId: "8UVbiI44V_c",
    text: "I will entrust everything to the child.",
    start: 187.25,
    end: 190.75,
    speaker: "Great Deku Tree",
  });
  assert.equal(quotableLines(sample(), 1).length, 1);
});

test("real recordings: Whisper's words and the text reader's boxes for the same half minute make one set of lines", () => {
  const heard = voiceLines(
    (JSON.parse(fsSync.readFileSync(path.join(here, "fixtures", "sceneindex_whisper.json"), "utf8")) as { words: Array<{ text: string; start: number; end: number }> }).words,
  );
  // Whisper heard the tree's long sentence in three breaths and split "Navi" in two.
  assert.ok(heard.length >= 5);
  assert.ok(heard.some((l) => l.text === "Na'vi!"));
  const read = textBoxLines(pages("a_", 185), { step: 0.5 });
  // The fixture's frames begin mid-line; the box had been on screen since 176.25 s.
  read[0]!.start = 176.25;
  const lines = mergeDialogue(read, heard).filter((l) => l.start >= 175 && l.start < 194);
  assert.deepEqual(
    lines.map((l) => [l.via, l.speaker, l.text]),
    [
      ["both", "Great Deku Tree", "My heart feels heavy. Soon I will no longer be able to protect the forest. I must ensure its safety."],
      ["both", "Great Deku Tree", "I will entrust everything to the child."],
      ["both", "Great Deku Tree", "Navi..."],
    ],
  );
  // The voice gives each line its true start and end, to the word.
  assert.deepEqual([lines[0]!.start, lines[1]!.start, lines[2]!.start], [175.8, 187.54, 192.66]);
  assert.equal(lines[0]!.words!.length, 20);
  assert.equal(lines[1]!.words![2]!.text, "entrust");
  const index = mergeStretch(emptySceneIndex(GAME, source, new Date(0)), { from: 160, to: 200 }, [
    { start: 160, end: 200, keyframes: [], desc: "", who: [], where: "", mood: "", tags: [], text: "", luma: 60, motion: 3 },
  ], lines);
  const hit = findQuote(index, "entrust everything to the child")[0]!;
  assert.equal(hit.wordTimed, true);
  assert.deepEqual([hit.start, hit.speaker], [188.14, "Great Deku Tree"]);
});

test("in a game that names its speakers, a speakerless unvoiced line is the game's own message: writing on screen, not dialogue", () => {
  const index = sample();
  const spoken = Array.from({ length: 24 }, (_, i) => ({
    id: 0,
    shot: 0,
    start: 3000 + i * 10,
    end: 3004 + i * 10,
    text: `Sentence number ${i} of a long conversation.`,
    speaker: i % 2 ? "Navi" : "Rauru",
    via: "both" as const,
  }));
  const message = { id: 0, shot: 0, start: 2413, end: 2416, text: "You got the Master Sword!", via: "textbox" as const };
  const half = { id: 0, shot: 0, start: 3004.5, end: 3005.5, text: "of a long conversation.", speaker: "Rauru", via: "textbox" as const };
  const tidy = tidyIndex({ ...index, lines: [...index.lines, ...spoken, message, half] });
  assert.ok(!tidy.lines.some((l) => l.text === "You got the Master Sword!"));
  assert.match(tidy.shots[4]!.text, /You got the Master Sword!/);
  assert.deepEqual(tidy.shots[4]!.written, [{ from: 2413, to: 2416 }], "and the shot knows when the message is up");
  assert.deepEqual(clearStretch({ lines: [] }, tidy.shots[4]!, 1), { start: 2411, end: 2412.5 });
  assert.equal(findShots(tidy, { text: "Link gets the Master Sword" })[0]!.start, 2411);
  assert.deepEqual(tidyIndex(tidy), tidy);
});

test("a finished index looks for a better source weekly while the release is new, then is left alone", () => {
  const asked = new Date("2026-11-19T09:00:00Z");
  const done = afterTurn(queueGame({ games: [] }, "Grand Theft Auto VI", "launched", asked, true), "Grand Theft Auto VI", "done", asked);
  const days = (n: number) => new Date(asked.getTime() + n * 86_400_000);
  assert.equal(nextJob(done, days(3)), undefined);
  assert.equal(nextJob(done, days(8))!.state, "done");
  assert.equal(sourceRecheckDue(done.games[0]!, days(8)), true);
  assert.equal(nextJob(afterTurn(done, "Grand Theft Auto VI", "done", days(40)), days(48)), undefined, "past its first weeks");
});

test("a voiced line with no name plate takes the one character in its shot, marked as a guess", () => {
  const index = sample();
  // A voiced game without plates (GTA): strip the speakers the sample's plates gave.
  const bare = { ...index, lines: index.lines.map(({ speaker: _s, ...l }) => ({ ...l, via: "voice" as const })) };
  const tidy = tidyIndex(bare);
  const tree = tidy.lines.find((l) => l.text.startsWith("I will entrust"))!;
  assert.deepEqual([tree.speaker, tree.speakerGuessed], ["Great Deku Tree", true]);
  const zelda = tidy.lines.find((l) => l.text.startsWith("Ganondorf, the King"))!;
  assert.deepEqual([zelda.speaker, zelda.speakerGuessed], ["Princess Zelda", true]);
  // Read from a file and tidied again, a guess stays a guess and is never counted as the game's own plate.
  const again = tidyIndex(parseSceneIndex(JSON.parse(JSON.stringify(tidy)))!);
  assert.deepEqual(again.lines, tidy.lines);
  // With plates in the game, a shown speaker is never replaced and a text-only line is never guessed.
  const plated = tidyIndex(index);
  assert.ok(plated.lines.every((l) => !l.speakerGuessed));
  // Two characters in the shot: no guess.
  const two = tidyIndex({ ...bare, shots: bare.shots.map((s, i) => (i === 0 ? { ...s, who: ["Great Deku Tree", "Navi"] } : s)) });
  assert.equal(two.lines.find((l) => l.text.startsWith("I will entrust"))!.speaker, undefined);
});

test("the games a script is about are queued: each entry's game, recent when new or a remake", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  assert.deepEqual(
    gamesOfScript({ game_title: "Ignored", entries: [{ game_title: "Halo 3", year: 2007 }, { game_title: "Grand Theft Auto VI", year: 2026 }, { game_title: "Halo 3", year: 2007 }, { game_title: "Fable", year: 2027 }, {}] }, now),
    [{ game: "Halo 3", recentRelease: false }, { game: "Grand Theft Auto VI", recentRelease: true }],
  );
  assert.deepEqual(gamesOfScript({ game_title: "The Legend of Zelda: Ocarina of Time", headline: "The Ocarina remake changes one scene" }, now), [
    { game: "The Legend of Zelda: Ocarina of Time", recentRelease: true },
  ]);
  assert.deepEqual(gamesOfScript({ game_title: "Halo 3", hook: "Halo 3 still holds up" }, now), [{ game: "Halo 3", recentRelease: false }]);
  assert.deepEqual(gamesOfScript({}, now), []);
});

test("several games asked for at once all reach the queue", async () => {
  const dir = await tmpDir();
  await requestSceneIndexes(testConfig(dir, { sceneIndex: true }), [{ game: "Halo 3" }, { game: "Grand Theft Auto VI", recentRelease: true }, { game: "halo 3" }], "a video about it");
  assert.deepEqual((await readQueue(dir)).games.map((g) => [g.game, g.recentRelease ?? false]), [["Halo 3", false], ["Grand Theft Auto VI", true]]);
});

test("the credits roll is not footage: its shots never answer a lookup for the cast it lists", () => {
  const index = sample();
  const shot = (start: number, text: string) => ({ start, end: start + 6, keyframes: [], desc: "", who: [], where: "", mood: "", tags: [], text, luma: 40, motion: 3 });
  const names = ["Director HokWai Ng", "", "Voice Cast Ganondorf Fabio Azevedo", "Zelda Sheik Performance Capture", "", "Brazilian Portuguese Voice Navi Flavia Narciso", "Special Thanks Hyrule Castle Team", "", "Executive Producer", "Presented by Nintendo"];
  const rolled = mergeStretch(index, { from: 7100, to: 7200 }, names.map((text, i) => shot(7100 + i * 8, text)), []);
  const tidy = tidyIndex(rolled);
  const credits = tidy.shots.filter((s) => s.start >= 7100);
  assert.deepEqual(credits.map((s) => Boolean(s.menu)), names.map((n) => n.length > 0));
  assert.ok(findShots(tidy, { text: "Ganondorf at Hyrule Castle" }).every((h) => h.start < 7100));
  assert.ok(undescribed(tidy).every((s) => !s.menu), "and the GPU is not spent describing them");
  // Writing on screen during the story (a place card before the last line) is not credits.
  assert.ok(tidy.shots.filter((s) => s.start < 7000).every((s) => !s.menu));
});

test("the vision model is offered the names this game uses, not every name in the series", () => {
  const index = sample();
  index.cast = ["Link", "Ganondorf", "Majora's Mask", "Skull Kid", "Navi", "Princess Zelda", "Twilight Princess", "Rauru", "Great Deku Tree"];
  assert.deepEqual(groundedCast(index, 2), ["Link", "Ganondorf", "Navi", "Princess Zelda", "Rauru", "Great Deku Tree"]);
  assert.deepEqual(groundedCast({ ...index, lines: [], shots: [] }, 3), ["Link", "Ganondorf", "Majora's Mask"]);
});

test("the vision model gets each keyframe as its own picture", () => {
  const args = frameArgs("/data/proxy.mp4", 6350.5, "/work/s_1_0.jpg").join(" ");
  assert.ok(args.includes("-ss 6350.50 -i /data/proxy.mp4") && args.includes("scale=640:-2") && args.endsWith("/work/s_1_0.jpg"));
  assert.ok(!lookPrompt({ game: GAME, cast: [], places: [], dialogue: [], text: "", frames: 3 }).includes("side by side"));
});

test("a clip is cut from the part of its shot with no dialogue written over the picture", () => {
  const index = sample();
  // The rise shot runs 6900-6908 with a box up from 6901 to 6905 and another from 6905.5 to 6907.5.
  assert.deepEqual(clearStretch(index, { start: 6900, end: 6908 }, 1.9), undefined);
  assert.deepEqual(clearStretch(index, { start: 6890, end: 6908 }, 1.9), { start: 6890, end: 6900.7 });
  assert.deepEqual(clearStretch(index, { start: 2400, end: 2406 }, 1.9), { start: 2400, end: 2406 }, "nothing written: the whole shot");
  // The sword shot (2411-2418) has a box from 2412 to 2416: the clear second and a bit after it is too short, so
  // the clip keeps the shot's start; the tree's shot (185-191) is clear before its line starts at 187.25.
  const plan = planIndexedClips(index, [target("beat:0", "The Great Deku Tree in Kokiri Forest")], { maxClips: 2, maxSeconds: 20, minConfidence: 0.3 });
  assert.equal(plan[0]!.shot, 0);
  assert.deepEqual([plan[0]!.from, Math.round(plan[0]!.seconds * 100) / 100], [185.1, 1.73]);
});

test("in a game that writes out what it says, a line only heard stays when the screen bears it out", () => {
  const index = sample();
  const spoken = Array.from({ length: 60 }, (_, i) => ({
    id: 0,
    shot: 0,
    start: 3000 + i * 10,
    end: 3004 + i * 10,
    text: `Sentence number ${i} of a long conversation.`,
    speaker: i % 2 ? "Navi" : "Rauru",
    via: "both" as const,
  }));
  const heard = (start: number, text: string) => ({ id: 0, shot: 0, start, end: start + 2, text, via: "voice" as const });
  index.shots[6]!.text = "What is this... His power-it's running wild!";
  const tidy = tidyIndex({
    ...index,
    lines: [...index.lines, ...spoken, heard(6902, "It's power, it's running wild!"), heard(6904, "And by the way, that's an effects test."), heard(2401, "This is for you! This is for you!")],
  });
  const only = tidy.lines.filter((l) => l.via === "voice").map((l) => l.text);
  assert.deepEqual(only, ["It's power, it's running wild!"]);
  // A voiced game with no subtitles keeps everything it hears.
  const unsubtitled = tidyIndex({ ...index, lines: [heard(6902, "Nobody wrote this down."), heard(6904, "Or this.")] });
  assert.equal(unsubtitled.lines.length, 2);
});

test("SCENE_MATCH: a named line keeps its next best shots, and an unnamed line keeps one", () => {
  const index = sample();
  const plan = planIndexedClips(
    index,
    [
      target("beat:0", "Ganondorf rises over Hyrule Castle"),
      target("beat:1", "The camera drifts through the mist"),
    ],
    { maxClips: 8, maxSeconds: 60, minConfidence: 0.2, alternates: 3, gameTitle: GAME },
  );
  const [named] = plan;
  assert.deepEqual(named!.names, ["Hyrule Castle", "Ganondorf"]);
  assert.equal(index.shots[named!.shot]!.start, 6900);
  assert.ok(named!.alternates?.length, "the next Ganondorf shots ride along");
  assert.ok(named!.alternates!.every((a) => a.shot !== named!.shot && a.seconds <= named!.seconds));
  const unnamed = plan.find((p) => p.key === "beat:1");
  if (unnamed) assert.equal(unnamed.alternates, undefined);
  // Off: exactly the old plan, no names and no alternates.
  const off = planIndexedClips(index, [target("beat:0", "Ganondorf rises over Hyrule Castle")], {
    maxClips: 8,
    maxSeconds: 60,
    minConfidence: 0.2,
  });
  assert.equal(off[0]!.names, undefined);
  assert.equal(off[0]!.alternates, undefined);
});

test("SCENE_MATCH: a named moment the picture check refuses gives way to the next shot; seen, it is the line's alone", async () => {
  const dir = await tmpDir();
  const asked: Array<{ at: number; names: string[]; line: string }> = [];
  const clips = await indexedCutsceneClips({
    index: sample(),
    gameTitle: GAME,
    episodeDir: dir,
    targets: [target("beat:2", "Ganondorf rises over Hyrule Castle")],
    maxClips: 8,
    maxSeconds: 60,
    minConfidence: 0.2,
    ytdlp: "yt-dlp",
    check: async (file, _seconds, ask) => {
      asked.push({ at: Number(fsSync.readFileSync(file, "utf8")), names: ask.names, line: ask.line });
      return asked.length === 2; // the first shot is refused, the second seen
    },
    deps: {
      download: async (_id, from, _to, file) => fs.writeFile(file, String(from)),
      cut: async (section, at, _s, file) =>
        fs.writeFile(file, String(Number(fsSync.readFileSync(section, "utf8")) + at)),
      screen: async () => true,
    },
  });
  assert.equal(asked.length, 2);
  assert.equal(asked[0]!.line, "Ganondorf rises over Hyrule Castle");
  assert.deepEqual(asked[0]!.names, ["Hyrule Castle", "Ganondorf"]);
  assert.equal(clips.length, 1);
  assert.equal(clips[0]!.beatIndex, 2);
  assert.notEqual(clips[0]!.span.from, asked[0]!.at, "not the refused shot");
  assert.deepEqual(clips[0]!.cutsceneMatch, { targetKey: "beat:2", how: "index" });
  assert.match(clips[0]!.reason ?? "", /seen by the picture check/);
  // Every shot refused: nothing from the index, so the ordinary search covers the line.
  const dir2 = await tmpDir();
  const none = await indexedCutsceneClips({
    index: sample(),
    gameTitle: GAME,
    episodeDir: dir2,
    targets: [target("beat:2", "Ganondorf rises over Hyrule Castle")],
    maxClips: 8,
    maxSeconds: 60,
    minConfidence: 0.2,
    ytdlp: "yt-dlp",
    check: async () => false,
    deps: {
      download: async (_id, _f, _t, file) => fs.writeFile(file, "s"),
      cut: async (_s, _a, _x, file) => fs.writeFile(file, "c"),
      screen: async () => true,
    },
  });
  assert.equal(none.length, 0);
  assert.deepEqual(await fs.readdir(path.join(dir2, "assets")), [], "refused clips are not left on disk");
});

test("SCENE_MATCH: an unnamed line is not sent to the picture check", async () => {
  const dir = await tmpDir();
  let asked = 0;
  const clips = await indexedCutsceneClips({
    index: sample(),
    gameTitle: GAME,
    episodeDir: dir,
    targets: [target("beat:0", "a red-haired man in dark armour floats above the ruins", ["ruins", "storm"])],
    maxClips: 8,
    maxSeconds: 60,
    minConfidence: 0.2,
    ytdlp: "yt-dlp",
    check: async () => {
      asked++;
      return false;
    },
    deps: {
      download: async (_id, _f, _t, file) => fs.writeFile(file, "s"),
      cut: async (_s, _a, _x, file) => fs.writeFile(file, "c"),
      screen: async () => true,
    },
  });
  assert.equal(asked, 0);
  assert.equal(clips.length, 1);
  assert.equal(clips[0]!.cutsceneMatch, undefined);
});

test("SCENE_MATCH stills: a stills-only publisher's named moment comes as one checked frame, placed on the name", async () => {
  const data = await tmpDir();
  const index = sample();
  await saveSceneIndex(data, index);
  const dir = await tmpDir();
  const looked: string[] = [];
  const cfg = { ...testConfig(data), sceneIndex: true, sceneMatch: true, spoilerGuard: false };
  const stills = await indexedSceneStills(
    cfg,
    {
      gameTitle: GAME,
      recentRelease: true,
      episodeDir: dir,
      targets: [
        target("beat:0", "Then Princess Zelda watches Ganondorf rise over Hyrule Castle"),
        target("beat:1", "Sales doubled in a week"),
      ],
      max: 4,
    },
    {
      precheck: null,
      download: async (_id, from, _to, file) => fs.writeFile(file, String(from)),
      grab: async (section, at, file) => fs.writeFile(file, String(Number(fsSync.readFileSync(section, "utf8")) + at)),
      // The first frame shows someone else; the second shows the moment.
      look: async (file) => {
        looked.push(fsSync.readFileSync(file, "utf8"));
        return looked.length === 1
          ? { shows: false, confidence: 0.2, seen: "a hall" }
          : { shows: true, confidence: 0.9, seen: "a red-haired man above a ruined castle" };
      },
      screen: async () => ({ hud: false, text: false, webcam: false, gore: false, letterbox: false, dark: false, blurry: false }),
    },
  );
  assert.equal(looked.length, 2, "the unnamed line is never looked at");
  assert.equal(stills.length, 1);
  const [still] = stills;
  assert.equal(still!.kind, "screenshot");
  assert.equal(still!.beatIndex, 0);
  assert.equal(still!.forWords, "Princess Zelda", "placed on the first name as it is said");
  assert.match(still!.provenance, /^Cutscene still for "The Legend of Zelda: Ocarina of Time" from YouTube video/);
  assert.match(still!.provenance, /seen by the picture check/);
  assert.ok(fsSync.existsSync(path.join(dir, still!.file)));
  // Off: nothing at all.
  assert.deepEqual(
    await indexedSceneStills({ ...cfg, sceneMatch: false }, { gameTitle: GAME, recentRelease: true, episodeDir: dir, targets: [target("beat:0", "Ganondorf rises")], max: 2 }),
    [],
  );
});

test("SCENE_MATCH stills: a frame with text across it is refused even when it shows the moment", () => {
  const yes = { shows: true, confidence: 0.9, seen: "Ganondorf" };
  const clean = { hud: false, text: false, webcam: false, gore: false, letterbox: false, dark: false, blurry: false };
  assert.equal(stillConfirmed(yes, clean), true);
  assert.equal(stillConfirmed(yes, { ...clean, text: true }), false);
  assert.equal(stillConfirmed(yes, { ...clean, hud: true }), true, "the game's own small HUD is fine");
  assert.equal(stillConfirmed({ ...yes, confidence: 0.4 }, clean), false);
  assert.equal(stillConfirmed(undefined, clean), false);
  assert.equal(firstSpoken("And at Lon Lon Ranch, Malon sings to Epona.", ["Malon", "Epona", "Lon Lon Ranch"]), "Lon Lon Ranch");
});

test("SCENE_MATCH_UNCHECKED: a named moment nobody could check is kept at the index's time, flagged, never locked to its line", async () => {
  const run = async (uncheckedOk: boolean) =>
    indexedCutsceneClips({
      index: sample(),
      gameTitle: GAME,
      episodeDir: await tmpDir(),
      targets: [target("beat:2", "Ganondorf rises over Hyrule Castle")],
      maxClips: 8,
      maxSeconds: 60,
      minConfidence: 0.2,
      ytdlp: "yt-dlp",
      check: async () => "unchecked" as const,
      uncheckedOk,
      deps: {
        download: async (_id, from, _to, file) => fs.writeFile(file, String(from)),
        cut: async (_s, _a, _x, file) => fs.writeFile(file, "c"),
        screen: async () => true,
      },
    });
  const kept = await run(true);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]!.cutsceneMatch, undefined, "an unchecked moment is not the line's alone");
  assert.match(kept[0]!.reason ?? "", /unchecked: lower confidence/);
  // Off: refused unseen, as before (the search covers the line).
  assert.equal((await run(false)).length, 0);
});

test("a scene index whose upload YouTube keeps refusing gives the rest of its lines to the search", async () => {
  let tries = 0;
  const clips = await indexedCutsceneClips({
    index: sample(),
    gameTitle: GAME,
    episodeDir: await tmpDir(),
    targets: [
      target("beat:0", "Ganondorf rises over Hyrule Castle"),
      target("beat:1", "The camera drifts through the mist"),
      target("beat:2", "Link wakes in the forest"),
    ],
    maxClips: 8,
    maxSeconds: 60,
    minConfidence: 0.2,
    ytdlp: "yt-dlp",
    deps: {
      download: async () => {
        tries++;
        throw new Error("ERROR: unable to download video data: HTTP Error 403: Forbidden");
      },
      cut: async (_s, _a, _x, file) => fs.writeFile(file, "c"),
      screen: async () => true,
    },
  });
  assert.equal(clips.length, 0);
  assert.equal(tries, 2, "two refusals and the index stops");
});
