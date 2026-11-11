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
import { editDistance, joinSplitLines, namesWritten, speakerSpellings, tidyIndex } from "../src/sceneindex/tidy.ts";
import {
  chooseSource,
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
  launchGames,
  nextJob,
  parseQueue,
  queueGame,
  readQueue,
  requestSceneIndex,
  sceneIndexTick,
  turnCommand,
  turnOutcome,
} from "../src/sceneindex/job.ts";
import {
  cutscenesIndexFirst,
  indexFirstCutscenes,
  indexFitsRelease,
  indexedCutsceneClips,
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
