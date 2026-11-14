import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auditPip,
  jokeMood,
  momentAt,
  pipMoments,
  PIP_FIRST_SECOND,
  PIP_GAP_SECONDS,
  PIP_MOODS,
  PIP_SHORT,
  revealMood,
  verdictMood,
} from "../src/render/mascot.ts";
import { BANDS, SAFE } from "../src/render/layout.ts";
import type { Segment } from "../src/render/timeline.ts";
import { mascotFor } from "../src/experiments.ts";
import { mascotLine, scoreMascot } from "../src/learn/mascottest.ts";
import type { Outcome } from "../src/learn/outcomes.ts";

// The Wolverine Short of 5 Nov 2026 (ep_20261105_b7acbc6f), as stored.
const WOLVERINE: Segment[] = [
  {
    kind: "hook",
    text: "Marvel's Wolverine hit two point four million, and it's already discounted.",
    start: 0,
    end: 4.1,
  },
  {
    kind: "beat",
    text: "That took 50 days. Spider-Man 2 sold two point five million on day one.",
    start: 4.1,
    end: 9.3,
    visual: { kind: "versus", primary: "", secondary: "" },
  },
  {
    kind: "beat",
    text: "Here's the catch. One analytics firm's one point nine million opening-week estimate would leave just five hundred thousand since.",
    start: 9.3,
    end: 17.0,
    visual: { kind: "stat", primary: "", secondary: "" },
  },
  {
    kind: "beat",
    text: "Insider Gaming reports a three hundred million dollars budget, so the holidays matter.",
    start: 17.0,
    end: 22.4,
    visual: { kind: "report", primary: "", secondary: "" },
  },
  {
    kind: "take",
    text: "Wasn't it still September's best-selling game? It was, and Sony credited it for a stronger quarter. Next comes Black Friday, and it's already in PlayStation's sale. Pulse check: strong, if you skipped it at launch.",
    start: 22.4,
    end: 36.8,
    visual: { kind: "title", primary: "", secondary: "" },
  },
  {
    kind: "loop",
    text: "Insomniac needs a long tail, and your discounted copy builds it.",
    start: 36.8,
    end: 42.2,
  },
];

// The God of War Laufey Short of 5 Nov 2026 (ep_20261105_b88d4645).
const LAUFEY: Segment[] = [
  {
    kind: "hook",
    text: "God of War Laufey just lost three months.",
    start: 0,
    end: 2.5,
  },
  {
    kind: "beat",
    text: "It was set for February 16, and Santa Monica Studio now says May 20, twenty twenty-seven.",
    start: 2.5,
    end: 8.5,
    visual: { kind: "timeline", primary: "", secondary: "" },
  },
  {
    kind: "beat",
    text: "Its post gave one reason. It wants time for the finishing touches.",
    start: 8.5,
    end: 12.3,
    visual: { kind: "quote", primary: "", secondary: "" },
  },
  {
    kind: "beat",
    text: "Except Eurogamer and IGN point at February itself, already packed with Fable, Persona 4 Revival and Metro twenty thirty-nine.",
    start: 12.3,
    end: 20.8,
    visual: { kind: "title", primary: "", secondary: "" },
  },
  {
    kind: "take",
    text: "Granted, the crowded month is the outlets' theory, not Sony's. We'd still call it smart, since a God of War without Kratos leading needs your full attention.",
    start: 20.8,
    end: 29.9,
    visual: { kind: "title", primary: "", secondary: "" },
  },
  {
    kind: "loop",
    text: "Your February backlog just got lighter, because Faye stepped aside.",
    start: 29.9,
    end: 35.5,
  },
];

test("Pip: two or three moments on real Shorts, at the reveal, the twist and the verdict", () => {
  const w = pipMoments({
    segments: WOLVERINE,
    stamps: [
      { at: 3.338, text: "ON SALE", sub: "BLACK FRIDAY", tone: "price" },
    ],
    isRumour: false,
    durationSeconds: 42.2,
  });
  // The sale stamp would be hype too, but the verdict keeps hype (Pulse check: strong), so the reveal is shocked.
  assert.deepEqual(
    w.map((m) => [m.beat, m.mood]),
    [
      ["reveal", "shocked"],
      ["joke", "sceptical"],
      ["verdict", "hype"],
    ],
  );
  assert.deepEqual(auditPip(w, WOLVERINE), []);

  const l = pipMoments({
    segments: LAUFEY,
    stamps: [{ at: 6.3, text: "MAY 20", sub: "DELAYED", tone: "alert" }],
    isRumour: false,
    durationSeconds: 35.5,
  });
  assert.deepEqual(
    l.map((m) => [m.beat, m.mood]),
    [
      ["reveal", "facepalm"],
      ["joke", "sceptical"],
      ["verdict", "smug"],
    ],
  );
  assert.deepEqual(auditPip(l, LAUFEY), []);
});

test("Pip: never in the hook or the loop, always apart, faces differ", () => {
  // A stamp in the hook is skipped; the reveal falls back to the first figure beat.
  const m = pipMoments({
    segments: WOLVERINE,
    stamps: [{ at: 1.5, text: "2.4M", tone: "confirm" }],
    isRumour: false,
    durationSeconds: 42.2,
  });
  for (const x of m) {
    assert.ok(x.at >= PIP_FIRST_SECOND);
    assert.ok(x.at + x.seconds <= 36.8 + 0.01, "clear of the loop");
  }
  for (let i = 1; i < m.length; i++)
    assert.ok(m[i]!.at - m[i - 1]!.at >= PIP_GAP_SECONDS);
  assert.equal(new Set(m.map((x) => x.mood)).size, m.length);
  assert.equal(momentAt(m, m[0]!.at + 0.5), m[0]);
  assert.equal(momentAt(m, 1), undefined);
});

test("Pip: serious stories and Shorts with too little to react to get none", () => {
  const sad = WOLVERINE.map((s) =>
    s.kind === "beat"
      ? { ...s, text: `${s.text} The studio announced layoffs.` }
      : s,
  );
  assert.deepEqual(
    pipMoments({ segments: sad, isRumour: false, durationSeconds: 42.2 }),
    [],
  );
  const tiny: Segment[] = [
    { kind: "hook", text: "A short one.", start: 0, end: 3 },
    { kind: "loop", text: "That's it.", start: 3, end: 6 },
  ];
  assert.deepEqual(
    pipMoments({ segments: tiny, isRumour: false, durationSeconds: 6 }),
    [],
  );
});

test("Pip: faces follow the meaning of the line", () => {
  assert.equal(
    revealMood("x", false, {
      at: 5,
      text: "SENTINEL",
      sub: "CONFIRMED",
      tone: "confirm",
    }),
    "receipt",
  );
  assert.equal(revealMood("The game slips to May.", false), "facepalm");
  assert.equal(
    revealMood("It reportedly needs new firmware.", false),
    "sceptical",
  );
  assert.equal(revealMood("Nobody saw this one coming.", false), "shocked");
  assert.equal(jokeMood("Of course, the price went up."), "smug");
  assert.equal(
    jokeMood("Apparently the horse has its own jump button."),
    "laughing",
  );
  const take = (text: string, primary = ""): Segment => ({
    kind: "take",
    text,
    start: 0,
    end: 5,
    visual: { kind: "title", primary, secondary: "" },
  });
  assert.equal(
    verdictMood(take("My verdict: buy it.", "STRONG: worth it"), false),
    "hype",
  );
  assert.equal(
    verdictMood(take("My verdict: wait.", "WEAK: you pay more"), false),
    "facepalm",
  );
  assert.equal(
    verdictMood(
      take("My verdict: treat it as a rumour.", "FAINT: unconfirmed"),
      true,
    ),
    "sceptical",
  );
  assert.equal(
    verdictMood(take("Sony confirmed it on record."), false),
    "receipt",
  );
  assert.equal(
    verdictMood(take("Nothing changes yet.", "STEADY: nothing to do"), false),
    "thinking",
  );
  assert.equal(PIP_MOODS.length, 8);
});

test("Pip: his box stays in the brand band and the safe width, clear of captions and the rail", () => {
  assert.ok(PIP_SHORT.top >= BANDS.brand[0]);
  assert.ok(PIP_SHORT.top + PIP_SHORT.size <= BANDS.brand[1]);
  assert.ok(PIP_SHORT.left + PIP_SHORT.size <= SAFE.right);
  assert.ok(PIP_SHORT.top + PIP_SHORT.size < SAFE.railTop);
  assert.ok(
    PIP_SHORT.top + PIP_SHORT.size < BANDS.hero[0],
    "never over the hero picture",
  );
  // The audit catches a box moved into the captions.
  assert.ok(
    auditPip([], WOLVERINE, { left: 870, top: 1200, size: 146 }).length > 0,
  );
});

test("Pip test: only news and why Shorts take part, a deterministic quarter at 0.25", () => {
  assert.equal(mascotFor(1, { id: "ep_1", lane: "evergreen" }), false);
  assert.equal(mascotFor(1, { id: "ep_1", lane: "cutdown" }), false);
  assert.equal(mascotFor(1, { id: "ep_1", lane: "news_breaking" }), true);
  const ids = Array.from(
    { length: 2000 },
    (_, i) => `ep_2026111${i % 10}_${(i * 7919).toString(16)}`,
  );
  const picked = ids.filter((id) => mascotFor(0.25, { id, lane: "news" }));
  assert.ok(
    picked.length > 420 && picked.length < 580,
    `about a quarter, got ${picked.length}`,
  );
});

test("Pip test scorecard: 20 a side, average viewed and subscribers per 1,000 not worse", () => {
  const o = (mascot: boolean, apv: number, subsPer1k: number): Outcome => ({
    episodeId: "x",
    format: "news",
    lane: "news",
    mascot,
    apv,
    subsPer1k,
  });
  const few = scoreMascot([o(true, 70, 1), o(false, 70, 1)]);
  assert.equal(few.verdict, "too_few");
  assert.match(mascotLine(few)!, /20 a side needed/);
  const pass = scoreMascot([
    ...Array(20).fill(o(true, 69.5, 0.9)),
    ...Array(20).fill(o(false, 70, 0.8)),
  ]);
  assert.equal(pass.verdict, "pass");
  const fail = scoreMascot([
    ...Array(20).fill(o(true, 66, 0.9)),
    ...Array(20).fill(o(false, 70, 0.8)),
  ]);
  assert.equal(fail.verdict, "fail");
  assert.match(mascotLine(fail)!, /MASCOT_SHARE=0/);
  assert.equal(mascotLine(scoreMascot([])), undefined);
  for (const l of [mascotLine(few)!, mascotLine(pass)!, mascotLine(fail)!])
    assert.ok(!/[–—]/.test(l));
});
