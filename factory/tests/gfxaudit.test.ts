import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSegments, type SegmentInput } from "../src/render/timeline.ts";
import { cardWindow } from "../src/render/shortcraft.ts";
import {
  arbitrate,
  overlaySpans,
  shortLayout,
} from "../src/render/cleanframe.ts";
import {
  auditLongGraphics,
  auditShortGraphics,
  figureSupported,
  figuresIn,
  fixShortGraphics,
  graphicsDigestLine,
  gfxSummary,
  readNeed,
  spokenNumbers,
  type ShortGfxInput,
} from "../src/qa/gfxaudit.ts";
import { graphicsAuditMode } from "../src/config.ts";
import {
  cardCheckTimes,
  faultedCards,
  graphicsGateShort,
} from "../src/gfxauditstep.ts";
import { testConfig, testDb, tmpDir } from "./helpers.ts";

/** Words spoken evenly, `per` seconds each, from the segments' texts. */
function wordsOf(inputs: SegmentInput[], per = 0.36) {
  const out: Array<{ text: string; start: number; end: number }> = [];
  let t = 0;
  for (const s of inputs)
    for (const w of s.text.split(/\s+/).filter(Boolean)) {
      out.push({ text: w, start: t, end: t + per * 0.85 });
      t += per;
    }
  return out;
}

function shortOf(
  inputs: SegmentInput[],
  stamps: ShortGfxInput["stamps"] = [],
  extra: Partial<ShortGfxInput> = {},
): ShortGfxInput {
  const words = wordsOf(inputs);
  const seconds = words.at(-1)!.end + 1;
  const segments = buildSegments(inputs, words, seconds);
  return {
    segments,
    words,
    plan: {
      fps: 30,
      totalFrames: Math.round(seconds * 30),
      tailFrames: 30,
      shelf: [],
      craft: undefined,
    },
    stamps,
    clean: true,
    headline: "Halo Firefight arrives free",
    narration: inputs.map((s) => s.text).join(" "),
    sources: "",
    ...extra,
  };
}

const HOOK: SegmentInput = {
  kind: "hook",
  text: "Halo Firefight is coming back this winter and it costs nothing at all.",
};
const LOOP: SegmentInput = {
  kind: "loop",
  text: "So clear your calendar for the squad this winter.",
};

test("the reading rule: 0.3 s a word plus 0.6 s, never under 1.2 s for any text", () => {
  assert.equal(readNeed(0), 0);
  assert.equal(readNeed(1), 1.2);
  assert.equal(readNeed(10), 3.6);
  assert.equal(readNeed(10, 0.25), 3.1);
});

test("figures: dates count by their year, spoken numbers and prices are recognised", () => {
  assert.deepEqual(figuresIn("Bandai acquires 2024-10-18 · $942M · 17%"), [
    "2024",
    "$942M",
    "17%",
  ]);
  const said = spokenNumbers(
    "nearly nine point six nine million pre-orders, that's nine hundred forty-two million dollars and twenty twenty-six".split(
      " ",
    ),
  );
  for (const n of ["9.69", "942", "2026"]) assert.ok(said.has(n), n);
  assert.ok(spokenNumbers(["seven", "dollars", "nineteen"]).has("7.19"));
  assert.ok(
    figureSupported("4-player", "", "", ["free", "four-player", "co-op"]),
  );
  assert.ok(figureSupported("0", "", "", ["without", "layoffs"]));
  assert.ok(
    !figureSupported("$69.99", "it costs fifty dollars", "", [
      "it",
      "costs",
      "fifty",
      "dollars",
    ]),
  );
  assert.ok(figureSupported("$49.99", "", '{"price":"$49.99"}', []));
});

test("a card the word moment lands on is cut to a flash; the moment that only repeats it goes and the card reads", () => {
  const inputs: SegmentInput[] = [
    HOOK,
    {
      kind: "beat",
      text: "Xbox Wire says free four player co-op with new maps arrives this winter for every owner of the campaign.",
      visual: {
        kind: "stat",
        primary: "Free Firefight",
        secondary: "This winter",
        items: [],
      },
    },
    {
      kind: "take",
      text: "My Pulse check is strong because the free mode stretches your money further.",
      label: "PULSE CHECK",
      visual: { kind: "title", primary: "Strong value", secondary: "" },
    },
    LOOP,
  ];
  const base = shortOf(inputs);
  // The moment lands just after the card's own first frame, as it does when both are on one word.
  const at =
    cardWindow(base.segments, base.words, 1, 30, base.plan.totalFrames).from / 30 + 0.2;
  const input = {
    ...base,
    stamps: [{ at, text: "FREE THIS WINTER", sub: "" }],
  };
  const audit = auditShortGraphics(input);
  const card = audit.elements.find((e) => e.key === "card1")!;
  assert.ok(card.shown < card.need, "the stamp cuts the card");
  assert.ok(
    audit.findings.some(
      (f) => f.key === "stamp0" && f.check === "meaning" && f.action === "drop",
    ),
  );
  const fixed = fixShortGraphics(input);
  assert.equal(fixed.stamps.length, 0);
  const after = fixed.after.elements.find((e) => e.key === "card1")!;
  assert.ok(
    after.shown >= after.need,
    `card reads after the fix (${after.shown} s)`,
  );
  assert.equal(fixed.wrong.length, 0);
  assert.match(gfxSummary(fixed), /dropped/);
});

test("a word moment that adds something keeps its place; the card is held or trimmed in what is left", () => {
  const inputs: SegmentInput[] = [
    HOOK,
    {
      kind: "beat",
      text: "Sensor Tower says the game passed nine point six nine million pre-orders this week, up from eight million last week across both stores.",
      visual: {
        kind: "stat",
        primary: "9.69M pre-orders",
        secondary: "Sensor Tower estimate",
        items: ["Nov 7:8M", "Nov 11:9.69M"],
      },
    },
    {
      kind: "take",
      text: "My read is simple: preload before the launch day rush.",
      label: "OUR READ",
      visual: { kind: "title", primary: "Preload early", secondary: "" },
    },
    LOOP,
  ];
  const base = shortOf(inputs);
  const at = base.words.find((w) => w.text === "nine")!.start;
  const input = {
    ...base,
    stamps: [{ at, text: "RECORD", sub: "PRE-ORDERS WEEK" }],
  };
  const fixed = fixShortGraphics(input);
  assert.equal(
    fixed.stamps.length,
    1,
    "the moment says something the card does not",
  );
  const card = fixed.after.elements.find((e) => e.key === "card1");
  // Either readable in its new stretch, or trimmed to what fits, or gone: never a flash.
  if (card && card.shown > 0)
    assert.ok(
      card.shown >= readNeed(card.words, 0.25),
      `${card.shown} s for ${card.words} words`,
    );
  for (const f of fixed.fixes.filter((x) => x.key === "card1"))
    assert.ok(["hold", "move", "trim", "drop"].includes(f.action));
});

test("the renderer draws a card exactly where the audit put it", () => {
  const inputs: SegmentInput[] = [
    HOOK,
    {
      kind: "beat",
      text: "The base game is fifty dollars on Steam right now.",
      visual: {
        kind: "price",
        primary: "$49.99",
        secondary: "Base game",
        items: [],
        span: [5.5, 7.5],
      },
    },
    LOOP,
  ];
  const s = shortOf(inputs);
  const w = cardWindow(s.segments, s.words, 1, 30, s.plan.totalFrames);
  assert.deepEqual(w, { from: 165, len: 60 });
  const layout = shortLayout(s.segments, 30, s.plan.totalFrames, 30);
  const kept = arbitrate(
    overlaySpans({
      segments: s.segments,
      words: s.words,
      plan: s.plan,
      layout,
      stamps: [],
      sting: false,
    }),
  );
  assert.equal(kept.find((k) => k.key === "card1")?.from, 165);
});

test("an unsupported figure is dropped; a figure the line contradicts on a ranked card fails the render", async () => {
  const inputs: SegmentInput[] = [
    HOOK,
    {
      kind: "beat",
      text: "The deluxe edition costs fifty dollars on every store this week.",
      visual: {
        kind: "price",
        primary: "$69.99",
        secondary: "Deluxe",
        items: [],
      },
    },
    {
      kind: "beat",
      text: "Number one is Outer Wilds from twenty nineteen, still the best surprise.",
      visual: {
        kind: "rank",
        primary: "Outer Wilds",
        secondary: "",
        items: ["2014"],
        value_a: 1,
      },
    },
    LOOP,
  ];
  const input = shortOf(inputs);
  const audit = auditShortGraphics(input);
  assert.ok(
    audit.findings.some((f) => f.key === "card1" && f.check === "figures"),
  );
  assert.ok(
    audit.findings.some((f) => f.key === "card2" && f.level === "wrong"),
  );
  const fixed = fixShortGraphics(input);
  assert.equal(fixed.segments[1]!.visual, undefined, "the price card goes");
  assert.equal(fixed.wrong.length, 1, "the rank card cannot be dropped");
  const db = await testDb();
  const cfg = testConfig(await tmpDir(), { graphicsAudit: "fix" });
  await assert.rejects(
    graphicsGateShort({ db, cfg }, "ep_t", input),
    /graphics audit/,
  );
  const events = await db.query<{ kind: string }>(
    `SELECT kind FROM events WHERE episode_id = 'ep_t'`,
  );
  assert.ok(events.some((e) => e.kind === "graphics_audit"));
  assert.ok(events.some((e) => e.kind === "graphics_fix"));
  await db.close();
});

test("the gate is off by default, and report mode changes nothing", async () => {
  assert.equal(graphicsAuditMode(undefined), "off");
  assert.equal(graphicsAuditMode("fix"), "fix");
  assert.equal(graphicsAuditMode("report"), "report");
  const db = await testDb();
  const input = shortOf([HOOK, LOOP]);
  assert.equal(
    await graphicsGateShort(
      { db, cfg: testConfig(await tmpDir()) },
      "ep_o",
      input,
    ),
    undefined,
  );
  assert.equal(
    await graphicsGateShort(
      { db, cfg: testConfig(await tmpDir(), { graphicsAudit: "report" }) },
      "ep_o",
      input,
    ),
    undefined,
  );
  const rows = await db.query(
    `SELECT kind FROM events WHERE episode_id = 'ep_o'`,
  );
  assert.equal(rows.length, 1);
  await db.close();
});

test("the frame check samples each card once it has settled and maps a faulted frame back to its card", () => {
  const inputs: SegmentInput[] = [
    HOOK,
    {
      kind: "beat",
      text: "The base game is fifty dollars on Steam right now for everyone.",
      visual: {
        kind: "price",
        primary: "$49.99",
        secondary: "Base game",
        items: [],
      },
    },
    {
      kind: "take",
      text: "My read: this is the cheapest way into the series this year.",
      label: "OUR READ",
      visual: { kind: "title", primary: "Cheapest way in", secondary: "" },
    },
    LOOP,
  ];
  const checked = cardCheckTimes(shortOf(inputs));
  assert.deepEqual(
    checked.map((c) => c.key),
    ["card1", "card2"],
  );
  assert.deepEqual(
    faultedCards(
      ["Frame 2: the verdict's last word is cut off at the right edge"],
      checked,
    ),
    ["card2"],
  );
});

test("long videos: a graphic gone before it can be read, and one left out, are both reported", () => {
  const audit = auditLongGraphics(
    [
      {
        key: "0:1",
        kind: "compare",
        text: "Development time Vice City one year San Andreas two years",
        from: 10,
        len: 1.5,
        short: false,
        sentence: "Vice City took one year and San Andreas two.",
        at: 10.2,
        start: 10,
        end: 14,
      },
      {
        key: "0:2",
        kind: "stat",
        text: "17 hours a day",
        from: 14,
        len: 1,
        short: true,
        sentence: "Some worked seventeen hours a day.",
        at: 14.1,
        start: 14,
        end: 16,
      },
    ],
    "",
    "",
    "Vice City took one year and San Andreas two. Some worked seventeen hours a day.".split(
      " ",
    ),
  );
  assert.ok(
    audit.findings.some(
      (f) => f.key === "0:1" && f.check === "reading" && f.level === "fix",
    ),
  );
  assert.ok(audit.findings.some((f) => f.key === "0:2" && f.check === "clash"));
});

test("the digest line sums the day's audits", () => {
  assert.equal(graphicsDigestLine([]), undefined);
  assert.equal(
    graphicsDigestLine([
      { fixes: 3, dropped: 1, unreadableBefore: 2, unreadableAfter: 0 },
      {
        fixes: 1,
        dropped: 0,
        unreadableBefore: 1,
        unreadableAfter: 0,
        failed: true,
      },
    ]),
    "Graphics audit: 2 videos, 4 fixes (1 dropped), unreadable 3 -> 0, 1 failed for a wrong graphic.",
  );
});
