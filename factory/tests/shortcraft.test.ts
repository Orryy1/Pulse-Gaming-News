import { test } from "node:test";
import assert from "node:assert/strict";
import type { Segment } from "../src/render/timeline.ts";
import type { RenderPlan, Shot } from "../src/render/plan.ts";
import {
  longDate,
  namedYear,
  packGraphic,
  storyYearOf,
} from "../src/render/components/vertical/pulse/map.ts";
import {
  PULSE_LOOKS,
  pulseFits,
  STYLES as PULSE,
} from "../src/render/components/vertical/VPulse.tsx";
import {
  fitsPlatforms,
  platformsOf,
} from "../src/render/components/vertical/pulse/Platforms.tsx";
import {
  windowOf,
  packLen,
} from "../src/render/components/vertical/pulse/PackCard.tsx";
import {
  V_STYLES,
  V_STYLES_CORE,
} from "../src/render/components/vertical/index.ts";
import { VFULL } from "../src/render/components/vertical/types.ts";
import {
  ALL_ON,
  cardData,
  craftLooks,
  craftSummary,
  fillSeconds,
  fittingCards,
  freezeLabelOk,
  HOUSE,
  isFull,
  maxMoves,
  MOVE_GAP_FRAMES,
  pickCards,
  pickFillers,
  pickMoves,
  pickPhotos,
  planShortCraft,
  readRecentCraft,
  RECENT_CRAFT_KEEP,
  rememberCraft,
  SHORT_PHOTO_TREATMENTS,
  type CraftInput,
  type RecentCraft,
  type ShortCraft,
} from "../src/render/shortcraft.ts";
import { bareLines, shortMediaRichness } from "../src/qa/mediarich.ts";
import { craftForShort, craftNotice } from "../src/shortcraftstep.ts";
import { testConfig, testDb, tmpDir } from "./helpers.ts";

const LONG_DASH = new RegExp("[\\u2013\\u2014]");

// ---- The translation ----------------------------------------------------------------------------

test("a beat's ISO date is written out for the calendar; a bare year is not a date", () => {
  assert.equal(longDate("2026-11-11"), "November 11, 2026");
  assert.equal(longDate("2027-03"), "March 2027");
  assert.equal(longDate("2027"), undefined);
  assert.equal(longDate("2027-13-01"), undefined);
});

test("the story's year is the one the beat names, else the year the Short is made", () => {
  assert.equal(
    namedYear({
      kind: "report",
      primary: "Vice City for October",
      secondary: "GameSpot, 2002",
      items: [],
    }),
    2002,
  );
  assert.equal(
    storyYearOf(
      {
        kind: "report",
        primary: "No details yet",
        secondary: "GameSpot",
        items: [],
      },
      2026,
    ),
    2026,
  );
});

test("each beat kind becomes the pack graphic it honestly is, or nothing", () => {
  const report = {
    kind: "report",
    primary: "No other details announced yet",
    secondary: "GameSpot",
    items: [],
  };
  assert.deepEqual(packGraphic(report, "headline"), {
    kind: "headline",
    primary: report.primary,
    secondary: "GameSpot",
    items: [],
  });
  assert.equal(packGraphic(report, "quote"), undefined);
  const quote = {
    kind: "quote",
    primary: '"Nothing more"',
    secondary: "Name only, reportedly",
    items: [],
  };
  assert.equal(packGraphic(quote, "quote")!.primary, "Nothing more");
  const date = {
    kind: "date",
    primary: "NOV 11",
    secondary: "Skyrim turns 15",
    items: [],
    date_to: "2026-11-11",
  };
  assert.equal(packGraphic(date, "date")!.primary, "November 11, 2026");
  // A price keeps a caption that says price, else takes the fixed label, never an invented one.
  assert.equal(
    packGraphic(
      {
        kind: "price",
        primary: "$39.99",
        secondary: "Steam price today",
        items: [],
      },
      "stat",
    )!.secondary,
    "Steam price today",
  );
  assert.equal(
    packGraphic(
      { kind: "price", primary: "$39.99", secondary: "on Steam", items: [] },
      "stat",
    )!.secondary,
    "Listed price",
  );
  assert.deepEqual(
    packGraphic(
      {
        kind: "specs",
        primary: "Inside",
        secondary: "",
        items: ["GPU:16 TFLOPS", "RAM: 16 GB"],
      },
      "specs",
    )!.items,
    ["GPU: 16 TFLOPS", "RAM: 16 GB"],
  );
  assert.equal(
    packGraphic(
      {
        kind: "specs",
        primary: "Inside",
        secondary: "",
        items: ["GPU: 16 TFLOPS"],
      },
      "specs",
    ),
    undefined,
  );
});

// ---- The Pulse looks ----------------------------------------------------------------------------

test("the phone story is a story from 2012 on, the period browser and TV an older one", () => {
  const now = {
    kind: "report",
    primary: "Rockstar confirms the new trailer date",
    secondary: "IGN",
    items: [],
  };
  assert.ok(pulseFits(PULSE_LOOKS.Phone!, now, 2026));
  assert.ok(!pulseFits(PULSE_LOOKS.OldWeb!, now, 2026));
  assert.ok(!pulseFits(PULSE_LOOKS.TV!, now, 2026));
  const then = {
    kind: "report",
    primary: "Rockstar confirms Vice City for October",
    secondary: "GameSpot, 2002",
    items: [],
  };
  assert.ok(pulseFits(PULSE_LOOKS.OldWeb!, then, 2002));
  assert.ok(pulseFits(PULSE_LOOKS.TV!, then, 2002));
  assert.ok(!pulseFits(PULSE_LOOKS.Phone!, then, 2002));
});

test("a post, a mail or a chat only when the quote's credit names that medium", () => {
  const tweet = {
    kind: "quote",
    primary: "Thank you all for waiting, it will be worth it",
    secondary: "Sam Houser, on Twitter, 2026",
    items: [],
  };
  const said = {
    kind: "quote",
    primary: "Thank you all for waiting, it will be worth it",
    secondary: "Sam Houser, to IGN",
    items: [],
  };
  assert.ok(pulseFits(PULSE_LOOKS.Social!, tweet, 2026));
  assert.ok(!pulseFits(PULSE_LOOKS.Social!, said, 2026));
  assert.ok(!pulseFits(PULSE_LOOKS.Mail!, tweet, 2026));
  assert.ok(!pulseFits(PULSE_LOOKS.Chat!, said, 2026));
});

test("the calendar takes a beat with a full date, the store a price, the console hardware specs", () => {
  assert.ok(
    pulseFits(
      PULSE_LOOKS.Calendar!,
      {
        kind: "date",
        primary: "NOV 11",
        secondary: "Skyrim turns 15",
        items: [],
        date_to: "2026-11-11",
      },
      2026,
    ),
  );
  assert.ok(
    !pulseFits(
      PULSE_LOOKS.Calendar!,
      { kind: "date", primary: "Soon", secondary: "", items: [] },
      2026,
    ),
  );
  assert.ok(
    pulseFits(
      PULSE_LOOKS.Store!,
      {
        kind: "price",
        primary: "$39.99",
        secondary: "Steam price today",
        items: [],
      },
      2026,
    ),
  );
  assert.ok(
    !pulseFits(
      PULSE_LOOKS.StoreSales!,
      {
        kind: "stat",
        primary: "8.5 YEARS",
        secondary: "Since the E3 2018 tease",
        items: [],
      },
      2026,
    ),
  );
  assert.ok(
    pulseFits(
      PULSE_LOOKS.StoreSales!,
      {
        kind: "stat",
        primary: "500,000",
        secondary: "copies sold in a week",
        items: [],
      },
      2026,
    ),
  );
  assert.ok(
    pulseFits(
      PULSE_LOOKS.Console!,
      {
        kind: "specs",
        primary: "PS5 Pro inside",
        secondary: "",
        items: ["GPU: 16.7 TFLOPS", "RAM: 16 GB", "Storage: 2 TB SSD"],
      },
      2026,
    ),
  );
  assert.ok(
    !pulseFits(
      PULSE_LOOKS.Console!,
      {
        kind: "specs",
        primary: "Glover's resume",
        secondary: "",
        items: ["Emmys: 2", "Grammys: 5"],
      },
      2026,
    ),
  );
});

test("the platforms panel lists up to six platforms and singles one out only when the beat says only", () => {
  const four = {
    kind: "platforms",
    primary: "Suit is PS5 only",
    secondary: "Game out December 3",
    items: ["PS5", "Xbox Series X|S", "Switch 2", "PC"],
  };
  assert.ok(fitsPlatforms(four));
  assert.equal(platformsOf(four)!.only, false);
  assert.equal(
    platformsOf({
      kind: "platforms",
      primary: "Only on Switch 2",
      secondary: "Exclusive",
      items: ["Switch 2"],
    })!.only,
    true,
  );
  assert.equal(
    platformsOf({
      kind: "platforms",
      primary: "Switch 2",
      secondary: "",
      items: ["Switch 2"],
    })!.only,
    false,
  );
  assert.ok(
    !fitsPlatforms({ ...four, items: ["a", "b", "c", "d", "e", "f", "g"] }),
  );
  assert.ok(
    !fitsPlatforms({ ...four, items: ["A platform name far too long"] }),
  );
});

test("every Pulse look is registered as a vertical style, the long-form ones full width", () => {
  for (const name of Object.keys(PULSE_LOOKS))
    assert.equal(V_STYLES[`Pulse/${name}`]?.frame, "full", name);
  assert.equal(V_STYLES["Pulse/Platforms"]?.frame, undefined);
  // Plans from before the craft keep rotating through the packs they knew.
  assert.ok(!Object.keys(V_STYLES_CORE).some((k) => k.startsWith("Pulse/")));
  assert.equal(Object.keys(PULSE).length, Object.keys(PULSE_LOOKS).length + 1);
});

test("a long-form crop fits the full-width area, and the pack is told it outlasts the Short's window", () => {
  const phone = windowOf(PULSE_LOOKS.Phone!.crop);
  assert.ok(phone.w <= VFULL.width && phone.h <= VFULL.height);
  assert.equal(phone.h, VFULL.height);
  const whole = windowOf({ x: 0, y: 0, w: 1920, h: 1080 });
  assert.equal(whole.w, VFULL.width);
  assert.ok(packLen(60, 75) > 60 + 75);
});

// ---- A Short to plan ----------------------------------------------------------------------------

const FPS = 30;
const seg = (
  kind: Segment["kind"],
  text: string,
  start: number,
  end: number,
  visual?: Segment["visual"],
): Segment => ({ kind, text, start, end, visual });
/** A 40 s Short: hook, a report, a price, a platforms beat, a desk question, the take and the loop. */
function sample(): {
  segments: Segment[];
  words: Array<{ text: string; start: number; end: number }>;
} {
  const segments: Segment[] = [
    seg(
      "hook",
      "Elder Scrolls 6 reportedly has a subtitle, and it's Sentinel.",
      0,
      4,
    ),
    seg(
      "beat",
      "The Verge says nothing else has been announced yet for the game.",
      4,
      10,
      {
        kind: "report",
        primary: "Nothing else announced yet",
        secondary: "The Verge",
      },
    ),
    seg("beat", "Steam lists the remaster today at forty dollars.", 10, 16, {
      kind: "price",
      primary: "$39.99",
      secondary: "Steam price today",
    }),
    seg("beat", "It lands on PS5, Xbox and PC on the same day.", 16, 22, {
      kind: "platforms",
      primary: "Same day everywhere",
      secondary: "",
      items: ["PS5", "Xbox Series X|S", "PC"],
    }),
    seg("desk", "Eight years of silence, and we only get a name?", 22, 27),
    seg("take", "Our read: a name is not a game yet.", 27, 34, {
      kind: "title",
      primary: "A name is not a game",
      secondary: "",
    }),
    seg("loop", "So will you wait for Sentinel, or move on?", 34, 40),
  ];
  const words: Array<{ text: string; start: number; end: number }> = [];
  for (const s of segments) {
    const ws = s.text.split(/\s+/);
    const step = (s.end - s.start) / ws.length;
    ws.forEach((w, i) =>
      words.push({
        text: w,
        start: s.start + i * step,
        end: s.start + (i + 0.8) * step,
      }),
    );
  }
  return { segments, words };
}

function shotsFor(
  segments: Segment[],
  media: (i: number) => Shot["media"],
): Shot[] {
  const out: Shot[] = [];
  let k = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    const a = Math.round(s.start * FPS);
    const b = Math.round(s.end * FPS);
    const mid = Math.round((a + b) / 2);
    for (const [from, to] of [
      [a, mid],
      [mid, b],
    ] as const)
      out.push({
        start: from,
        end: to,
        segment: i,
        media: media(k++),
        move: "pushIn",
        framed: false,
        luma: 100,
      });
  }
  return out;
}

function input(over: Partial<CraftInput> = {}): CraftInput {
  const { segments, words } = sample();
  const shots = shotsFor(segments, (k) => ({ type: "clip", index: k % 4 }));
  const plan: Pick<RenderPlan, "shots" | "fps" | "totalFrames" | "turns"> = {
    shots,
    fps: FPS,
    totalFrames: 1200,
    turns: [120, 810],
  };
  const bare = segments.map((s) => !s.visual);
  return {
    segments,
    words,
    plan,
    images: [{ kind: "screenshot" }, { kind: "photo" }],
    clips: [0, 1, 2, 3].map(() => ({ durationSeconds: 8 })),
    stamps: [],
    bare,
    game: "The Elder Scrolls VI",
    madeYear: 2026,
    seed: 3,
    ...over,
  };
}

// ---- 1. Cards -------------------------------------------------------------------------------------

test("the house card is always offered, then the styles that fit the beat", () => {
  const v = cardData(sample().segments[2]!)!;
  const fits = fittingCards(v, 2026);
  assert.equal(fits[0], HOUSE);
  assert.ok(fits.includes("Pulse/Store"));
  assert.ok(fits.includes("Numbers/Price"));
  assert.ok(
    !fits.some((f) => !f.startsWith("House") && V_STYLES[f]!.kind !== "price"),
  );
});

test("cards: never one look twice in a row, at most one full-width device a Short", () => {
  const { segments } = sample();
  // Many beats of one kind, so the rule has work to do.
  const many = Array.from({ length: 6 }, (_, i) =>
    seg("beat", `b${i}`, i * 5, i * 5 + 5, {
      kind: "price",
      primary: `$${10 + i}.99`,
      secondary: "Steam price today",
    }),
  );
  for (const list of [segments, many]) {
    const cards = pickCards(list, { seed: 1, madeYear: 2026 }, []);
    for (let i = 1; i < cards.length; i++)
      assert.notEqual(cards[i]!.look, cards[i - 1]!.look);
    assert.ok(cards.filter((c) => isFull(c.look)).length <= 1);
  }
});

test("cards remember the channel's last Shorts: a look the previous Short used is passed over while another fits", () => {
  const { segments } = sample();
  const first = pickCards(segments, { seed: 1, madeYear: 2026 }, []);
  const craft: ShortCraft = {
    version: 1,
    cards: first,
    photos: [],
    fillers: [],
    moves: [],
  };
  const recent = rememberCraft([], craft, "2026-10-31");
  const second = pickCards(segments, { seed: 1, madeYear: 2026 }, recent);
  for (const c of second) {
    const was = first.find((x) => x.segment === c.segment)!;
    if (
      was.look !== HOUSE &&
      fittingCards(cardData(segments[c.segment]!)!, 2026).length > 2
    )
      assert.notEqual(c.look, was.look);
  }
  // And the same memory picks the same looks again: a retry is identical.
  assert.deepEqual(
    pickCards(segments, { seed: 1, madeYear: 2026 }, recent),
    second,
  );
});

// ---- 2. Photos ------------------------------------------------------------------------------------

test("a real photo shot of two seconds or more gets a fast treatment, never on the opening or the last shot", () => {
  const base = input();
  const shots = base.plan.shots.map((s, i) =>
    i === 0 || i === 3 || i === base.plan.shots.length - 1
      ? { ...s, media: { type: "image" as const, index: 1 } }
      : s,
  );
  const photos = pickPhotos({ ...base, plan: { ...base.plan, shots } }, [], []);
  assert.deepEqual(
    photos.map((p) => p.shot),
    [3],
  );
  assert.ok(SHORT_PHOTO_TREATMENTS.includes(photos[0]!.treatment));
  assert.notEqual(photos[0]!.treatment, "newsprint"); // not a press photo
  // A screenshot is never treated as a photo.
  assert.equal(pickPhotos(base, [], []).length, 0);
});

test("photos: newsprint only for a press credit, at most two, never the same twice running", () => {
  const base = input({
    images: [{ kind: "screenshot" }, { kind: "photo", credit: "Reuters" }],
  });
  const shots = base.plan.shots.map((s, i) =>
    i >= 2 && i <= 8
      ? { ...s, media: { type: "image" as const, index: 1 } }
      : s,
  );
  const photos = pickPhotos({ ...base, plan: { ...base.plan, shots } }, [], []);
  assert.equal(photos.length, 2);
  assert.notEqual(photos[0]!.treatment, photos[1]!.treatment);
  const noPress = pickPhotos(
    { ...input(), plan: { ...base.plan, shots } },
    [],
    [],
  );
  assert.ok(noPress.every((p) => p.treatment !== "newsprint"));
});

// ---- 3. Fillers -----------------------------------------------------------------------------------

test("a bare desk question becomes kinetic type; the hook and the loop are never filled", () => {
  const fillers = pickFillers(input(), []);
  assert.ok(fillers.length >= 1 && fillers.length <= 2);
  assert.ok(
    fillers.every(
      (f) => !["hook", "loop"].includes(input().segments[f.segment]!.kind),
    ),
  );
  const desk = fillers.find(
    (f) => input().segments[f.segment]!.kind === "desk",
  );
  assert.equal(desk?.family, "kinetic");
  assert.ok(desk!.len <= 84 && desk!.len >= 45);
  // Families never repeat in a Short.
  assert.equal(new Set(fillers.map((f) => f.family)).size, fillers.length);
});

test("a filler keeps clear of the word moment and of lines that are not bare", () => {
  const base = input();
  assert.equal(
    pickFillers({ ...base, bare: base.segments.map(() => false) }, []).length,
    0,
  );
  const deskFrom = 22 * FPS;
  assert.equal(
    pickFillers(base, [{ from: deskFrom, to: deskFrom + 60 }]).length,
    0,
  );
});

test("the next Short's kinetic filler differs from the channel's last one", () => {
  const first = pickFillers(input(), []);
  const style = first[0]!.style;
  const second = pickFillers(
    input(),
    [],
    [{ look: `Filler/${style}`, day: "2026-10-31" }],
  );
  assert.notEqual(second[0]!.style, style);
});

// ---- 4. Camera ------------------------------------------------------------------------------------

test("at most three camera moves in a 40 s Short, fewer in a shorter one", () => {
  assert.equal(maxMoves(1200, 30), 3);
  assert.equal(maxMoves(1500, 30), 3);
  assert.equal(maxMoves(1050, 30), 2);
  assert.equal(maxMoves(600, 30), 1);
});

test("camera moves come after the hook, before the loop, six seconds apart, clear of turns and covered frames", () => {
  const base = input();
  const moves = pickMoves(base, [], new Set());
  assert.ok(moves.length >= 1 && moves.length <= 3);
  for (let i = 1; i < moves.length; i++)
    assert.ok(moves[i]!.at - moves[i - 1]!.at >= MOVE_GAP_FRAMES);
  for (const m of moves) {
    assert.ok(m.at >= 4 * FPS && m.at <= 34 * FPS);
    assert.ok(base.plan.turns.every((t) => Math.abs(t - m.at) >= 20));
  }
  // Everything covered: nothing moves.
  assert.equal(pickMoves(base, [{ from: 0, to: 1200 }], new Set()).length, 0);
  // A treated photo's shot is fixed: no cut moves into or out of it.
  const fixed = new Set(base.plan.shots.map((_, i) => i));
  assert.equal(pickMoves(base, [], fixed).length, 0);
});

test("a freeze lands on a key word said inside a beat's own clip, labelled with that word", () => {
  const base = input();
  const moves = pickMoves(base, [], new Set());
  const freeze = moves.find((m) => m.kind === "freeze");
  assert.ok(freeze && freeze.kind === "freeze");
  const shot = base.plan.shots[freeze.shot]!;
  assert.ok(
    freeze.at - shot.start >= 15 && shot.end - freeze.at >= freeze.hold + 8,
  );
  assert.ok(
    base.segments[shot.segment]!.text.toUpperCase().includes(freeze.label),
  );
  assert.ok(
    freezeLabelOk("SENTINEL") &&
      !freezeLabelOk("DOLLARS") &&
      !freezeLabelOk("3"),
  );
});

// ---- The whole plan and the measure ---------------------------------------------------------------

test("each layer only runs with its setting on", () => {
  const off = planShortCraft(
    input(),
    { cards: false, photos: false, fillers: false, camera: false },
    [],
  );
  assert.deepEqual(off, {
    version: 1,
    cards: [],
    photos: [],
    fillers: [],
    moves: [],
  });
  const on = planShortCraft(input(), ALL_ON, []);
  assert.ok(
    on.cards.length === 3 && on.fillers.length >= 1 && on.moves.length >= 1,
  );
  // No move under a filler.
  for (const m of on.moves)
    for (const f of on.fillers)
      assert.ok(m.at < f.from - 4 || m.at > f.from + f.len + 4);
});

test("the filler seconds raise the media-richness reading, and only for the bare line", () => {
  const base = input();
  const plan = { ...base.plan, shots: base.plan.shots, fps: FPS } as RenderPlan;
  const before = shortMediaRichness(
    base.segments,
    plan,
    base.images,
    base.clips,
  );
  const craft = planShortCraft(base, ALL_ON, []);
  const after = shortMediaRichness(
    base.segments,
    plan,
    base.images,
    base.clips,
    fillSeconds(craft, FPS),
  );
  assert.ok(after.covered > before.covered);
  assert.ok(bareLines(before).filter(Boolean).length >= 1);
  assert.equal(
    shortMediaRichness(base.segments, plan, base.images, base.clips, new Map())
      .covered,
    before.covered,
  );
});

test("the memory keeps the newest looks first and at most RECENT_CRAFT_KEEP", () => {
  const craft: ShortCraft = {
    version: 1,
    cards: [
      { segment: 1, look: "Pulse/Phone" },
      { segment: 2, look: HOUSE },
    ],
    photos: [{ shot: 3, treatment: "ductTape", seed: 1 }],
    fillers: [],
    moves: [],
  };
  assert.deepEqual(craftLooks(craft), ["Pulse/Phone", "Photo/ductTape"]);
  let recent: RecentCraft[] = [];
  for (let i = 0; i < 20; i++)
    recent = rememberCraft(recent, craft, "2026-10-31");
  assert.equal(recent.length, RECENT_CRAFT_KEEP);
  assert.equal(recent[0]!.look, "Pulse/Phone");
  assert.ok(!LONG_DASH.test(craftSummary(craft)));
  assert.ok(!LONG_DASH.test(craftNotice(ALL_ON)));
});

// ---- The step ---------------------------------------------------------------------------------------

test("the step plans the craft once on a new-look Short, remembers its looks and tells the owner once", async () => {
  const db = await testDb();
  const cfg = testConfig(await tmpDir());
  const sent: string[] = [];
  const s = {
    db,
    cfg,
    now: () => new Date("2026-10-31T12:00:00Z"),
    notify: async (m: { content: string }) => void sent.push(m.content),
  } as never;
  const base = input();
  const mk = () => ({
    ...(base.plan as RenderPlan),
    version: 1 as const,
    tailFrames: 30,
    heroIndex: 0,
    sfx: [],
    shelf: [],
  });
  const args = (plan: RenderPlan, suite: boolean) => ({
    suite,
    segments: base.segments,
    words: base.words,
    plan,
    images: base.images,
    clips: base.clips,
    stamps: [],
    game: base.game,
    seed: 3,
  });
  // The test's other half is left alone.
  const control = mk();
  assert.equal(await craftForShort(s, "ep_a", args(control, false)), undefined);
  assert.equal(control.craft, undefined);
  const plan = mk();
  const fills = await craftForShort(s, "ep_b", args(plan, true));
  assert.ok(plan.craft && plan.craft.cards.length === 3);
  assert.ok(fills && fills.size >= 1);
  const recent = await readRecentCraft(db);
  assert.ok(recent.length >= 1 && recent.every((r) => r.day === "2026-10-31"));
  // A retry keeps the stored craft; a second Short does not announce again.
  const stored = JSON.stringify(plan.craft);
  await craftForShort(s, "ep_b", args(plan, true));
  assert.equal(JSON.stringify(plan.craft), stored);
  await craftForShort(s, "ep_c", args(mk(), true));
  assert.equal(sent.length, 1);
  const events = await db.query<{ kind: string }>(
    `SELECT kind FROM events WHERE kind = 'short_craft'`,
  );
  assert.equal(events.length, 2);
  // Every setting off: nothing happens.
  const quiet = mk();
  const off = {
    ...(s as object),
    cfg: {
      ...cfg,
      shortCraftCards: false,
      shortCraftPhotos: false,
      shortCraftFillers: false,
      shortCraftCamera: false,
    },
  } as never;
  assert.equal(await craftForShort(off, "ep_d", args(quiet, true)), undefined);
  assert.equal(quiet.craft, undefined);
  await db.close();
});
