import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOCUMENTS_PER_CHAPTER,
  KINETIC_PER_CHAPTER,
  STOCK_UPGRADE,
  applyFillers,
  chooseFillers,
  fillersEvent,
  fillersNotice,
  needsOf,
  type FillersChapter,
} from "../src/assets/fillers.ts";
import { chooseEpisodeFillers } from "../src/assets/fillerstep.ts";
import {
  DIAGRAM_SETTLED,
  DOCUMENT_SETTLED,
  FILLER_MAX_SECONDS,
  RECON_FILL_MIN_RATE,
  RECON_FILL_RATE,
  fillerMaxFrames,
  fillerSettle,
  kineticLandFrames,
  reconFillRate,
  type MomentFiller,
} from "../src/render/fillerplan.ts";
import { landFrames } from "../src/render/components/kinetic/kit.tsx";
import { DIAGRAMS } from "../src/render/components/diagram/index.ts";
import { SETTLED } from "../src/render/components/docs/layout.ts";
import { RECON_MIN_RATE, RECON_RATE } from "../src/assets/recon.ts";
import { coverageShare } from "../src/assets/fill.ts";
import {
  buildLongPlan,
  momentWindows,
  type LongShot,
} from "../src/render/longplan.ts";
import type { Segment } from "../src/render/timeline.ts";
import { graphicChecks } from "../src/qa/graphicscheck.ts";
import { gateShots } from "../src/qa/releaseGate.ts";

const none = {
  kind: "none",
  primary: "",
  secondary: "",
  items: [] as string[],
};
const m = (show: string, extra: Record<string, unknown> = {}) => ({
  show,
  broll: "",
  person: "",
  emphasis: "",
  keywords: [] as string[],
  graphic: { ...none },
  ...extra,
});

// Real Vice City documentary lines (31 Oct 2026 database copy) whose families are known.
const LINES: Array<[string, ReturnType<typeof m>]> = [
  ["The story of the studio begins in a small town.", m("Studio exterior")], // 0: under the title card
  [
    "The schedule didn't survive contact with the game.",
    m("Calendar pages flipping, missed deadlines", {
      broll: "calendar pages turning",
    }),
  ],
  [
    "Then the ownership changed.",
    m("Studio ownership changing hands", { broll: "business handshake" }),
  ],
  [
    "Nobody outside the studio knows it yet.",
    m("Closed studio door, secret project", {
      broll: "office at night",
      emphasis: "Nobody outside knows",
    }),
  ],
  [
    "Critics agreed.",
    m("Critics praise Vice City", { emphasis: "Critics agreed" }),
  ],
  [
    "The first decision was the name.",
    m("Grand Theft Auto IV logo reveal", { emphasis: "The first decision" }),
  ],
  ["Not everyone was pleased.", m("Fans unhappy about re-release")],
  [
    "Even the windows needed an NDA.",
    m("Privacy film on office windows", {
      emphasis: "Even the windows needed an NDA",
    }),
  ],
  ["The ambition came from the top.", m("Executives")],
];
const chapter = (lines = LINES, entry = 0): FillersChapter => ({
  entry,
  game: "Grand Theft Auto: Vice City",
  year: 2002,
  sentences: lines.map((l) => l[0]),
  moments: lines.map((l) => ({
    ...l[1],
    graphic: { ...l[1].graphic },
  })) as never,
});

test("eligible lines are bare or stock-only; own media, graphics and the first line are not", () => {
  const ch = chapter();
  ch.moments[4]!.graphic = { kind: "stat" } as never;
  const needs = needsOf(
    ch,
    [{ file: "a.jpg", kind: "screenshot", beatIndex: 0, moment: 5 }],
    [
      { file: "s.mp4", stock: true, beatIndex: 0, moment: 2 },
      { file: "t.mp4", beatIndex: 0, moment: 6 },
      { file: "u.mp4", stock: true, beatIndex: 1, moment: 3 }, // another chapter's
    ],
  );
  assert.equal(
    needs.has(0),
    false,
    "the first line plays under its title card",
  );
  assert.equal(needs.get(2), "stock");
  assert.equal(needs.get(3), "bare");
  assert.equal(needs.has(4), false, "a graphic covers it");
  assert.equal(needs.has(5), false, "its own picture");
  assert.equal(needs.has(6), false, "its own clip");
});

test("the chooser picks one family per line, never the same family twice in a row", () => {
  const c = chooseFillers([chapter()], { images: [], clips: [], seed: 0 });
  assert.ok(c.picks.length >= 4, `picked ${c.picks.length}`);
  const at = new Map(c.picks.map((p) => [p.moment, p.filler.family]));
  for (const [k, f] of at)
    assert.notEqual(at.get(k + 1), f, `lines ${k} and ${k + 1}`);
  assert.equal(at.has(0), false);
  // Every eligible line is either picked or left with a reason.
  assert.equal(
    c.picks.length + c.left.length,
    c.eligible.bare + c.eligible.stock,
  );
  for (const l of c.left) assert.ok(l.why.length > 5);
  // The calendar line is a drawn calendar; the NDA line a document.
  assert.equal(at.get(1), "objects");
  assert.equal(at.get(7), "document");
});

test("at most three kinetic cards and two document pages a chapter", () => {
  // Twelve punch lines and six contract lines, alternating so the neighbour rule does not hide the caps.
  const lines: Array<[string, ReturnType<typeof m>]> = [
    ["Opening line of the chapter.", m("x")],
  ];
  for (let i = 0; i < 12; i++) {
    lines.push([
      `Nobody saw it coming, again and again ${i}.`,
      m("Closed door", { emphasis: "Nobody saw it coming" }),
    ]);
    lines.push([
      `Even the windows needed an NDA ${i}.`,
      m("Privacy film on office windows"),
    ]);
  }
  const c = chooseFillers([chapter(lines)], { images: [], clips: [], seed: 0 });
  assert.ok((c.counts.kinetic ?? 0) <= KINETIC_PER_CHAPTER);
  assert.ok((c.counts.document ?? 0) <= DOCUMENTS_PER_CHAPTER);
  assert.ok(c.left.some((l) => /variety rules/.test(l.why)));
});

test("a stock-only line keeps its stock unless the best candidate reaches 0.7", () => {
  const ch = chapter();
  const clips = ch.moments.map((_, k) => ({
    file: `s${k}.mp4`,
    stock: true,
    beatIndex: 0,
    moment: k,
  }));
  const c = chooseFillers([ch], { images: [], clips, seed: 0 });
  for (const p of c.picks)
    assert.ok(
      p.filler.confidence >= STOCK_UPGRADE,
      `${p.moment} ${p.filler.confidence}`,
    );
  assert.ok(c.picks.every((p) => p.need === "stock"));
  // "Critics agreed." is a 0.55-0.7 kinetic line: bare it takes a card, on stock it keeps the stock.
  const bare = chooseFillers([chapter()], { images: [], clips: [], seed: 0 });
  const low = bare.picks.find((p) => p.filler.confidence < STOCK_UPGRADE);
  if (low) assert.ok(!c.picks.some((p) => p.moment === low.moment));
});

test("a reconstruction verified for the video is ranked with the rest", () => {
  const recon = new Map([
    [
      0,
      new Map([
        [
          8,
          {
            area: "recon",
            kind: "reconstruction",
            clip: 0,
            confidence: 0.9,
            reason: "skyline at dusk",
            scene: {
              tags: ["skyline", "dusk"],
              worlds: [],
              survey: true,
              people: false,
            },
            reuse: false,
            rate: 0.85,
            maxSeconds: 8,
            hud: false,
          } as never,
        ],
      ]),
    ],
  ]);
  const clips = [
    {
      file: "official_3.mp4",
      label: "Skyline at dusk",
      durationSeconds: 6,
      beatIndex: 0,
    },
  ];
  const c = chooseFillers([chapter()], { images: [], clips, seed: 0, recon });
  const p = c.picks.find((x) => x.moment === 8)!;
  assert.equal(p.filler.family, "recon");
  assert.deepEqual(
    (p.filler.data as { clip: number; clipSeconds: number }).clip,
    0,
  );
  assert.equal((p.filler.data as { clipSeconds: number }).clipSeconds, 6);
});

test("kinetic cards and diagrams get a backdrop from the chapter's scenery, rotating", () => {
  const images = [
    {
      file: "a/hero.jpg",
      kind: "hero",
      aspect: 1.78,
      beatIndex: 0,
      label: "Tommy holding a pistol",
    },
    {
      file: "a/s1.jpg",
      kind: "screenshot",
      aspect: 1.78,
      beatIndex: 0,
      label: "Ocean Drive at night",
    },
    {
      file: "a/s2.jpg",
      kind: "screenshot",
      aspect: 1.78,
      beatIndex: 0,
      label: "Cars on a city street",
    },
  ];
  const c = chooseFillers([chapter()], { images, clips: [], seed: 0 });
  const backs = c.picks
    .filter((p) => p.filler.family === "kinetic")
    .map((p) => (p.filler.data as { backdrop?: number }).backdrop);
  assert.ok(backs.length >= 2);
  assert.ok(
    backs.every((b) => b === 1 || b === 2),
    "scenery, never the key art",
  );
  assert.notEqual(backs[0], backs[1]);
});

test("applyFillers writes the decision on its moment and coverage counts it", () => {
  const ch = chapter();
  const c = chooseFillers([ch], { images: [], clips: [], seed: 0 });
  const before = coverageShare([{ ...ch, moments: ch.moments }], [], []);
  applyFillers([ch], c);
  for (const p of c.picks)
    assert.equal(
      (ch.moments[p.moment] as { filler?: MomentFiller }).filler,
      p.filler,
    );
  const after = coverageShare([{ ...ch, moments: ch.moments }], [], []);
  assert.ok(after > before);
  assert.equal(after, c.picks.length / ch.moments.length);
});

test("the event and the notice say what was chosen and what stayed, in plain words", () => {
  const c = chooseFillers([chapter()], { images: [], clips: [], seed: 0 });
  const e = fillersEvent(c, { sketches: 0 }) as {
    counts: object;
    left: unknown[];
    eligible: object;
  };
  assert.deepEqual(e.counts, c.counts);
  assert.equal(e.left.length, c.left.length);
  const n = fillersNotice("Vice City", c);
  assert.match(n, /FILLERS_ENABLED/);
  assert.match(n, /ILLUSTRATION or RECONSTRUCTION/);
  assert.doesNotMatch(n, /—/);
});

test("the filler step writes the shot list, logs and tells the owner", async () => {
  const ch = chapter();
  const events: string[] = [];
  const notes: string[] = [];
  const r = await chooseEpisodeFillers({
    chapters: [ch],
    images: [],
    clips: [],
    variant: 0,
    sketches: false,
    check: async () => ({ ok: true, reason: "" }),
    now: new Date("2026-10-31T12:00:00Z"),
    headline: "Vice City",
    logEvent: async (k) => {
      events.push(k);
    },
    notify: async (msg) => notes.push(msg.content),
  });
  assert.ok(r && r.chosen > 0);
  assert.deepEqual(events, ["fillers"]);
  assert.equal(notes.length, 1);
  assert.ok(ch.moments.some((x) => (x as { filler?: unknown }).filler));
});

test("settle frames and rates match each family's own constants", () => {
  for (const [k, v] of Object.entries(DIAGRAMS))
    assert.equal(DIAGRAM_SETTLED[k], v.settled, k);
  assert.equal(DOCUMENT_SETTLED, SETTLED);
  assert.equal(RECON_FILL_RATE, RECON_RATE);
  assert.equal(RECON_FILL_MIN_RATE, RECON_MIN_RATE);
  const card = {
    sentence: "Nobody outside knows it yet.",
    tokens: ["Nobody", "outside", "knows", "it", "yet."],
    shown: [0, 1, 2, 4],
    hero: 0,
    tone: "punch" as const,
  };
  for (const times of [undefined, [0.1, 0.5, 0.9, 1.2, 1.5]])
    assert.deepEqual(
      kineticLandFrames(card, times, 30, 200),
      landFrames(card, times, 30, 200),
    );
  const kin: MomentFiller = {
    family: "kinetic",
    style: "land",
    data: { card },
    confidence: 0.7,
    reason: "",
  };
  assert.equal(
    fillerSettle(kin, 200, 30, [0.1, 0.5, 0.9, 1.2, 1.5]),
    Math.round(1.5 * 30) - 1 + 30,
  );
  assert.equal(
    fillerSettle(kin, 60, 30, [0.1, 0.5, 0.9, 1.2, 1.5]),
    48,
    "never past the last 12 frames",
  );
  const recon: MomentFiller = {
    family: "recon",
    style: "scope",
    data: {
      clip: 0,
      tags: [],
      hud: false,
      clipSeconds: 3,
      game: "",
      year: 2002,
    },
    confidence: 0.7,
    reason: "",
  };
  assert.equal(fillerMaxFrames(recon, 30), Math.floor((3 / 0.75) * 30) - 2);
  assert.equal(fillerMaxFrames(kin, 30), FILLER_MAX_SECONDS * 30);
  assert.equal(reconFillRate(3, 120, 30), 0.75);
  assert.equal(reconFillRate(6, 120, 30), 0.85);
});

// A one-chapter documentary on the timeline: an intro, the chapter's sentences at 0.4 s a word, an outro.
function timeline(sentences: string[]) {
  const words: Array<{ text: string; start: number; end: number }> = [];
  let t = 0;
  const say = (text: string) => {
    for (const w of text.split(/\s+/).filter(Boolean)) {
      words.push({ text: w, start: t, end: t + 0.35 });
      t += 0.4;
    }
    t += 0.3;
  };
  say("A short intro to the story.");
  const beatStart = t;
  for (const s of sentences) say(s);
  const takeStart = t;
  say("That was the story.");
  const segments: Segment[] = [
    {
      kind: "hook",
      text: "A short intro to the story.",
      start: 0,
      end: beatStart,
    },
    {
      kind: "beat",
      text: sentences.join(" "),
      start: beatStart,
      end: takeStart,
      visual: {
        kind: "chapter",
        primary: "1",
        secondary: "Vice City",
        items: ["2002"],
      } as never,
    },
    { kind: "take", text: "That was the story.", start: takeStart, end: t },
  ];
  return { words, segments, duration: t + 6 };
}

test("a line with a filler opens on its filler shot from its first word; its stock never plays", () => {
  const sentences = [
    "The story of the studio begins in a small town far from anywhere.",
    "The schedule did not survive contact with the game at all, it seemed.",
    "Nobody outside the studio knows it yet, and nobody will for a long while.",
    "The team kept on working through the long nights of that winter in the office.",
  ];
  const { words, segments, duration } = timeline(sentences);
  const card = {
    sentence: sentences[2]!,
    tokens: sentences[2]!.split(" "),
    shown: [0, 1, 2],
    hero: 0,
    tone: "punch" as const,
  };
  const filler: MomentFiller = {
    family: "kinetic",
    style: "land",
    data: { card },
    confidence: 0.75,
    reason: "",
  };
  const input = {
    segments,
    words,
    durationSeconds: duration,
    images: Array.from({ length: 4 }, () => ({
      kind: "screenshot",
      aspect: 1.78,
      beatIndex: 0,
    })),
    clips: [
      { durationSeconds: 8, beatIndex: 0, moment: 2 }, // the line's stock clip
      { durationSeconds: 8, beatIndex: 0 },
    ],
    variant: 0,
    momentCounts: [4],
  };
  const without = buildLongPlan(input);
  assert.ok(
    without.shots.some((s) => s.media.type === "clip" && s.media.index === 0),
    "the stock plays without a filler",
  );
  const plan = buildLongPlan({
    ...input,
    momentFillers: [[undefined, undefined, filler, undefined]],
  });
  const w = momentWindows(segments, words, [4]).find((x) => x.moment === 2)!;
  const shot = plan.shots.find((s) => s.media.type === "filler")!;
  assert.ok(shot, "a filler shot");
  assert.deepEqual(shot.media, { type: "filler", index: 2, entry: 0 });
  assert.equal(shot.start, Math.round(w.start * 30));
  assert.ok(
    shot.end <= Math.round(w.end * 30) + 15 + 60,
    "ends with its sentence (a sliver may join it)",
  );
  assert.ok(shot.settle! > 0 && shot.settle! < shot.end - shot.start);
  // (The outro may replay the last chapter's footage, as it always has; the chapter itself never shows it.)
  assert.ok(
    !plan.shots.some(
      (s) => s.segment === 1 && s.media.type === "clip" && s.media.index === 0,
    ),
    "the filler replaces the stock",
  );
  for (let i = 1; i < plan.shots.length; i++)
    assert.equal(plan.shots[i]!.start, plan.shots[i - 1]!.end, "no gaps");
});

test("a line too short for a filler keeps its ordinary shot", () => {
  const sentences = [
    "The story begins in a small town far from anywhere.",
    "Critics agreed.",
    "The team kept working through the long nights of that winter.",
  ];
  const { words, segments, duration } = timeline(sentences);
  const card = {
    sentence: "Critics agreed.",
    tokens: ["Critics", "agreed."],
    shown: [0, 1],
    hero: 0,
    tone: "punch" as const,
  };
  const plan = buildLongPlan({
    segments,
    words,
    durationSeconds: duration,
    images: Array.from({ length: 4 }, () => ({
      kind: "screenshot",
      aspect: 1.78,
      beatIndex: 0,
    })),
    clips: [],
    variant: 0,
    momentCounts: [3],
    momentFillers: [
      [
        undefined,
        {
          family: "kinetic",
          style: "land",
          data: { card },
          confidence: 0.7,
          reason: "",
        },
        undefined,
      ],
    ],
  });
  assert.ok(
    !plan.shots.some((s) => s.media.type === "filler"),
    "0.8 s is too short to land a card",
  );
});

test("the graphics check looks at a filler at its settle frame; muted ones are skipped", () => {
  const shots: LongShot[] = [
    {
      start: 300,
      end: 600,
      segment: 1,
      media: { type: "filler", index: 4, entry: 1 },
      move: "settle",
      settle: 98,
    },
    {
      start: 900,
      end: 1100,
      segment: 1,
      media: { type: "filler", index: 7, entry: 1 },
      move: "settle",
      settle: 100,
    },
  ];
  const input = {
    windows: [],
    graphicOf: () => undefined,
    durationSeconds: 100,
    shots,
  };
  const checks = graphicChecks(input, {}, 10);
  assert.deepEqual(checks, [
    { t: (300 + 98) / 30, what: "1:4" },
    { t: (900 + 100) / 30, what: "1:7" },
  ]);
  assert.deepEqual(
    graphicChecks(input, { quietMoments: ["1:4"] }, 10).map((c) => c.what),
    ["1:7"],
  );
});

test("the release gate looks at a filler shot once it has settled", () => {
  const plan = {
    fps: 30,
    shots: [
      {
        start: 0,
        end: 120,
        segment: 0,
        media: { type: "filler" as const, index: 1, entry: 0 },
        move: "settle" as const,
        settle: 100,
      },
    ],
  };
  const words = [{ text: "Critics", start: 0.5, end: 1 }];
  const [g] = gateShots(plan, words, [], []);
  assert.equal(g!.frame, 100);
});
