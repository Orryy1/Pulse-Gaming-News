import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  DOC_BEATS_MAX,
  beatGrounded,
  groundBeats,
  groundDocMoments,
  type DocMoment,
} from "../src/editorial/documentary.ts";
import {
  BEAT_CLEAR_SECONDS,
  KEY_BACK_SECONDS,
  REVEAL_DUCK,
  REVEAL_LEAD_SECONDS,
  REVEAL_RISE_SECONDS,
  beatCuesFrom,
  beatLevel,
  nearBeat,
  turnSections,
} from "../src/render/musicplan.ts";
import {
  ERA_BEDS,
  ERA_BED_LUFS_CEILING,
  LEVEL,
  RECORD_GAP_SECONDS,
  SFX,
  UNDER_VOICE,
  eraBed,
  gateLongSounds,
} from "../src/render/soundscape.ts";
import {
  QUIET_BEAT_PAUSE_MAX,
  QUIET_BEAT_SECONDS,
  gapSpans,
  quietGaps,
} from "../src/voice/pauses.ts";
import { quietBeatGaps } from "../src/voice/quietbeats.ts";
import {
  soundDesignLine,
  soundDesignSummary,
} from "../src/render/sounddesign.ts";
import { buildSegments } from "../src/render/timeline.ts";
import { FFMPEG } from "../src/lib/bin.ts";

const fps = 30;

// ---------------------------------------------------------------- 1. beats in the script

test("a beat needs a figure, a quote or a superlative in its sentence", () => {
  assert.equal(beatGrounded("It sold 11 million copies in a week."), true);
  assert.equal(beatGrounded("Two hundred million dollars, gone."), true);
  assert.equal(
    beatGrounded('Houser said "we wanted the city to feel alive".'),
    true,
  );
  assert.equal(beatGrounded("Benzies told the court it was his."), true);
  assert.equal(
    beatGrounded("It was the fastest-selling game ever made."),
    true,
  );
  assert.equal(beatGrounded("The team moved to Edinburgh that spring."), false);
  assert.equal(
    beatGrounded("One of them had an idea."),
    false,
    "'one' is too common to count",
  );
  assert.equal(beatGrounded(undefined), false);
});

test("beats are kept only on grounded sentences, never first, never adjacent, one key, four at most", () => {
  const sentences = [
    "In 2001 a studio in Edinburgh had a problem.", // 0: first sentence, never a beat
    "It had spent $5 million and had nothing to show.", // 1: figure: kept
    "Nobody at the studio believed in it.", // 2: nothing to ground a beat
    "Then it sold 17 million copies.", // 3: figure: kept
    "The biggest launch the company had seen.", // 4: superlative, but adjacent to 3
    "Houser said it changed everything.", // 5: quote, but a second key
    "The second-biggest came a year later.", // 6: superlative: kept
    "The quietest year ever followed.", // 7: superlative, but adjacent to 6
    "Then 2 million more.", // 8: figure: kept, the fourth
    "Then 3 million more.", // 9: figure, adjacent to 8
    "And 4 million more.", // 10: figure, over the cap
  ];
  const m = (beat?: DocMoment["beat"]) => ({ beat });
  const { moments, removed } = groundBeats(
    [
      m("key"),
      m("reveal"),
      m("turn"),
      m("key"),
      m("record"),
      m("key"),
      m("record"),
      m("quiet"),
      m("turn"),
      m("turn"),
      m("quiet"),
    ],
    sentences,
  );
  assert.deepEqual(
    moments.map((x) => x.beat),
    [
      "none",
      "reveal",
      "none",
      "key",
      "none",
      "none",
      "record",
      "none",
      "turn",
      "none",
      "none",
    ],
  );
  assert.equal(moments.filter((x) => x.beat !== "none").length, DOC_BEATS_MAX);
  assert.equal(removed.length, 7);
  assert.ok(removed[0]!.startsWith("key: In 2001"), "the first sentence");
  assert.ok(
    removed.some((r) => r.startsWith("turn: Nobody")),
    "ungrounded",
  );
  assert.ok(
    removed.some((r) => r.startsWith("key: Houser")),
    "a second key",
  );
  assert.ok(
    removed.some((r) => r.startsWith("quiet: And 4 million")),
    "over the cap",
  );
  // A moment without a beat is returned as it was (older shot lists have no field at all).
  const plain = groundBeats([{ beat: undefined }, {}], sentences);
  assert.equal("beat" in plain.moments[1]!, false);
});

test("the shot list's grounding pass carries the beat rule and names what it drops", () => {
  const source = {
    title: "Game",
    url: "u",
    text: "## History\nIt sold 17 million copies.",
  };
  const none = {
    kind: "none" as const,
    primary: "",
    secondary: "",
    items: [] as string[],
  };
  const m = (beat?: DocMoment["beat"]): DocMoment => ({
    show: "x",
    keywords: [],
    broll: "",
    graphic: none,
    emphasis: "",
    person: "",
    ...(beat ? { beat } : {}),
  });
  const sentences = [
    "It began.",
    "It sold 17 million copies.",
    "People liked it.",
  ];
  const { moments, removed } = groundDocMoments(
    [m("key"), m("reveal"), m("quiet")],
    source,
    [],
    sentences,
  );
  assert.deepEqual(
    moments.map((x) => x.beat),
    ["none", "reveal", "none"],
  );
  assert.deepEqual(removed, [
    "beat key: It began.",
    "beat quiet: People liked it.",
  ]);
});

// ---------------------------------------------------------------- 2. the mix reacts

const win = (
  entry: number,
  moment: number,
  start: number,
  end: number,
  at = start,
) => ({
  entry,
  moment,
  start,
  end,
  at,
});

test("cues come from the windows with a beat, never a chapter's first line, the opening or a breather", () => {
  const windows = [
    win(0, 0, 10, 14), // chapter's first sentence: never
    win(0, 1, 14, 18, 15), // in the opening 20 s: never
    win(0, 2, 30, 34, 31.5),
    win(0, 3, 40, 44), // inside a breather
    win(1, 1, 50, 55, 52),
  ];
  const moments = [
    [{ beat: "key" }, { beat: "reveal" }, { beat: "reveal" }, { beat: "turn" }],
    [{ beat: "none" }, { beat: "record" }],
  ];
  const cues = beatCuesFrom(windows, moments, fps, [
    { from: 39 * fps, to: 43 * fps },
  ]);
  assert.deepEqual(cues, [
    {
      kind: "reveal",
      at: Math.round(31.5 * fps),
      start: 30 * fps,
      end: 34 * fps,
    },
    { kind: "record", at: 52 * fps, start: 50 * fps, end: 55 * fps },
  ]);
  assert.deepEqual(beatCuesFrom(windows, undefined, fps), []);
});

test("a reveal ducks the music to 20% for 1.5 s before the line and rises softly after", () => {
  const at = 100 * fps;
  const cues = [{ kind: "reveal" as const, at, start: at - 15, end: at + 90 }];
  const lead = at - REVEAL_LEAD_SECONDS * fps;
  assert.equal(beatLevel(lead - 1, cues, fps), 1, "untouched before the lead");
  assert.equal(
    beatLevel(lead + 18, cues, fps),
    REVEAL_DUCK,
    "at the floor through the lead",
  );
  assert.equal(beatLevel(at - 1, cues, fps), REVEAL_DUCK);
  const mid = beatLevel(
    at + Math.round((REVEAL_RISE_SECONDS * fps) / 2),
    cues,
    fps,
  );
  assert.ok(mid > REVEAL_DUCK && mid < 1, "rising after the line lands");
  assert.equal(beatLevel(at + REVEAL_RISE_SECONDS * fps, cues, fps), 1);
});

test("a key line takes the music out entirely under the sentence and brings it back over 2 s", () => {
  const start = 200 * fps;
  const end = 206 * fps;
  const cues = [{ kind: "key" as const, at: start + 10, start, end }];
  assert.equal(beatLevel(start - fps, cues, fps), 1);
  const going = beatLevel(start - 7, cues, fps);
  assert.ok(going > 0 && going < 1, "fading out just before the first word");
  assert.equal(beatLevel(start, cues, fps), 0);
  assert.equal(beatLevel(end, cues, fps), 0, "out for the whole sentence");
  const back = beatLevel(end + fps, cues, fps);
  assert.ok(
    Math.abs(back - 0.5) < 0.02,
    `halfway back after a second (${back})`,
  );
  assert.equal(beatLevel(end + KEY_BACK_SECONDS * fps, cues, fps), 1);
  // The lower cue wins where two overlap; record, turn and quiet leave the music alone.
  const quiet = [
    { kind: "quiet" as const, at: start, start, end },
    { kind: "record" as const, at: start, start, end },
  ];
  assert.equal(beatLevel(start, quiet, fps), 1);
  assert.equal(
    beatLevel(start, [...cues, { kind: "reveal", at: start, start, end }], fps),
    0,
  );
});

test("the automatic drop-outs keep clear of a written reveal or key line", () => {
  const cues = [
    { kind: "key" as const, at: 300 * fps, start: 300 * fps, end: 305 * fps },
  ];
  assert.equal(
    nearBeat(
      300 * fps - BEAT_CLEAR_SECONDS * fps + 1,
      cues,
      BEAT_CLEAR_SECONDS * fps,
    ),
    true,
  );
  assert.equal(
    nearBeat(
      300 * fps - BEAT_CLEAR_SECONDS * fps - 1,
      cues,
      BEAT_CLEAR_SECONDS * fps,
    ),
    false,
  );
  assert.equal(
    nearBeat(300 * fps, [{ ...cues[0]!, kind: "turn" }], 10),
    false,
    "a turn is a bed change, not a drop",
  );
});

test("a turn moves the nearest bed change onto its line, once, and never leaves a short section", () => {
  const s = [
    { from: 0, to: 100 * fps, mood: undefined },
    { from: 100 * fps, to: 250 * fps, mood: "tense" },
    { from: 250 * fps, to: 400 * fps, mood: undefined },
  ];
  const out = turnSections(
    s,
    [108 * fps, 118 * fps, 245 * fps],
    20 * fps,
    20 * fps,
  );
  assert.deepEqual(
    out.map((x) => [x.from / fps, x.to / fps]),
    [
      [0, 108],
      [108, 245],
      [245, 400],
    ],
    "the first turn takes the 100 s boundary, the second finds it taken, the third moves 250 s",
  );
  assert.equal(out[1]!.mood, "tense", "sections keep their moods");
  const far = turnSections(s, [60 * fps], 20 * fps, 20 * fps);
  assert.deepEqual(
    far.map((x) => x.from),
    s.map((x) => x.from),
    "out of reach: nothing moves",
  );
  const tight = turnSections(s, [95 * fps], 20 * fps, 100 * fps);
  assert.deepEqual(
    tight.map((x) => x.from),
    s.map((x) => x.from),
    "a move that leaves a short section is refused",
  );
});

test("a record beat plays the sting in key, claims its moment first, and keeps stings 45 s apart", () => {
  const cands = [
    { key: 1, frame: 30 * fps, kind: "glint" as const },
    { key: 500001, frame: 31 * fps, kind: "record" as const }, // the sting wins the moment
    { key: 500002, frame: 60 * fps, kind: "record" as const }, // too soon after the first sting
    {
      key: 500003,
      frame: 31 * fps + RECORD_GAP_SECONDS * fps,
      kind: "record" as const,
    },
  ];
  const out = gateLongSounds(cands, [], fps);
  assert.equal(out.get(500001), SFX.sting);
  assert.equal(out.has(1), false, "the glint 1 s away gave way");
  assert.equal(out.has(500002), false);
  assert.equal(out.get(500003), SFX.sting);
  // Its level: the sting's long-video level less a quarter under the voice, about 14 dB under the narrator.
  assert.ok(
    Math.abs(
      LEVEL.recordLong - LEVEL.sting * Math.pow(10, -2 / 20) * UNDER_VOICE,
    ) < 0.005,
  );
});

// ---------------------------------------------------------------- the quiet beat, at voice time

test("a quiet beat lengthens the pause after its sentence by up to 0.8 s, never past 1.4 s in all", () => {
  const words = [
    { text: "It", start: 0, end: 0.2 },
    { text: "ended.", start: 0.3, end: 0.8 },
    { text: "Then", start: 1.4, end: 1.6 }, // a 0.6 s pause (as tightenPauses leaves it)
    { text: "silence.", start: 1.7, end: 2.2 },
    { text: "Next", start: 3.4, end: 3.6 }, // a 1.2 s pause already
    { text: "words.", start: 3.7, end: 4.1 },
  ];
  const gaps = quietGaps(words, [
    { start: 0, end: 1.4 },
    { start: 1.4, end: 3.4 },
    { start: 3.4, end: 4.2 }, // the last sentence: nothing follows
  ]);
  assert.deepEqual(gaps, [
    { at: 1.1, seconds: QUIET_BEAT_SECONDS, kind: "quiet" },
    {
      at: 2.8,
      seconds: Math.round((QUIET_BEAT_PAUSE_MAX - 1.2) * 1000) / 1000,
      kind: "quiet",
    },
  ]);
});

test("gap spans land where the silences fall once they are all in; chapters become the breathers", () => {
  const spans = gapSpans([
    { at: 30, seconds: 4 },
    { at: 10, seconds: 0.8, kind: "quiet" },
    { at: 50, seconds: 4, kind: "chapter" },
  ]);
  assert.deepEqual(spans, [
    { start: 10, end: 10.8, kind: "quiet" },
    { start: 30.8, end: 34.8, kind: "chapter" },
    { start: 54.8, end: 58.8, kind: "chapter" },
  ]);
});

test("the voice step finds the quiet beats' sentences from the script's shot list", () => {
  const inputs = [
    { kind: "hook" as const, text: "Welcome to the story. It begins here." },
    {
      kind: "beat" as const,
      text: "Alpha opens the scene in 2008. It sold 17 million copies. Money pours in.",
      visual: {
        kind: "chapter" as const,
        primary: "Turn 1",
        secondary: "Game 1",
        value_a: 1,
        items: ["2008", "PS3"],
      },
    },
    {
      kind: "beat" as const,
      text: "A second paragraph follows. Nothing more.",
    },
  ];
  const all = inputs.flatMap((x) => x.text.split(/\s+/).filter(Boolean));
  const words = all.map((text, i) => ({
    text,
    start: i * 0.4,
    end: i * 0.4 + 0.3,
  }));
  const segs = buildSegments(inputs, words, words.at(-1)!.end + 6);
  const moment = (beat?: "quiet" | "key") => ({
    show: "x",
    keywords: [],
    graphic: { kind: "none" as const, primary: "", secondary: "", items: [] },
    emphasis: "",
    ...(beat ? { beat } : {}),
  });
  const script = {
    entries: [
      {
        rank: 1,
        game_title: "Game 1",
        steam_search_term: "",
        year: 2008,
        platforms: "PS3",
        moments: [
          moment("quiet"),
          moment("quiet"),
          moment("key"),
          moment("quiet"),
          moment(),
        ],
      },
    ],
  };
  const gaps = quietBeatGaps(script, words, segs);
  // Sentence 0 is the chapter's first (never); sentence 1 ends on "copies."; sentence 3 ends on "follows."
  const endOf = (w: string) => words.find((x) => x.text === w)!;
  const after = (w: string) => words[words.indexOf(endOf(w)) + 1]!;
  assert.deepEqual(
    gaps.map((g) => g.at),
    [endOf("copies."), endOf("follows.")].map(
      (w) => Math.round(((w.end + after(w.text).start) / 2) * 1000) / 1000,
    ),
  );
  assert.ok(
    gaps.every(
      (g) =>
        g.kind === "quiet" && g.seconds > 0 && g.seconds <= QUIET_BEAT_SECONDS,
    ),
  );
  assert.deepEqual(quietBeatGaps({ entries: [] }, words, segs), []);
});

// ---------------------------------------------------------------- 3. era beds

test("each chapter opens on the bed of its decade; an unknown year gets none", () => {
  assert.equal(eraBed(1983), "arcade");
  assert.equal(eraBed(1989), "arcade");
  assert.equal(eraBed(1990), "console");
  assert.equal(eraBed(1994), "console");
  assert.equal(eraBed(1995), "modem");
  assert.equal(eraBed(2003), "modem");
  assert.equal(eraBed(2004), "room");
  assert.equal(eraBed(2026), "room");
  assert.equal(eraBed(undefined), undefined);
  assert.equal(eraBed(0), undefined);
  assert.equal(eraBed(1960), undefined);
});

test(
  "the era beds are on disk and under the loudness ceiling (ffmpeg ebur128)",
  { skip: !fs.existsSync(FFMPEG) && "no ffmpeg" },
  async () => {
    const { checkEraBeds } = await import("../data/smoke/erabeds.mts");
    const problems = await checkEraBeds();
    assert.deepEqual(problems, []);
    assert.ok(ERA_BED_LUFS_CEILING <= -30, "the lead's ceiling");
    for (const rel of Object.values(ERA_BEDS))
      assert.ok(fs.existsSync(`public/${rel}`), rel);
  },
);

// ---------------------------------------------------------------- what the owner hears about it

test("the sound design line counts the beats and the era beds in plain English", () => {
  const s = soundDesignSummary(
    [
      [{ beat: "none" }, { beat: "reveal" }, { beat: "key" }],
      [{ beat: "record" }, { beat: "quiet" }, {}],
    ],
    [1998, 2013, undefined],
    true,
  );
  assert.deepEqual(s.beats, {
    reveal: 1,
    key: 1,
    record: 1,
    turn: 0,
    quiet: 1,
  });
  assert.equal(s.total, 4);
  assert.deepEqual(s.eras, { modem: 1, room: 1 });
  assert.equal(
    soundDesignLine("Why GTA Left Scotland", s),
    '🎚️ "Why GTA Left Scotland": the mix follows 4 beats the writer marked (1 reveal, 1 key line, 1 record sting, 1 quiet breath); era beds open 2 chapters (modem 1, room 1).',
  );
  const off = soundDesignSummary([[{ beat: "key" }]], [1998], false);
  assert.equal(off.chapters, 0, "era beds off: none counted");
});
