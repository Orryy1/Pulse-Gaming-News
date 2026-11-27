// GTA_GUIDES (upgrade queue item 58): the topic picker, the list shape, the owner's play as a source, the thumbnail
// words, the share of long slots and the verdict, plus the long lane with the setting off and on.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_GUIDE_FACTS,
  GUIDE_KINDS,
  GUIDE_QUERIES,
  factPackText,
  kindSections,
  gtaGuideSlot,
  gtaGuideVerdict,
  guideDemand,
  guidePlanProblems,
  guideProblems,
  guideThumbWords,
  guideTitleFor,
  guideToScript,
  isGtaGuide,
  kindOf,
  labelLine,
  pickGuideTopic,
  playEvidence,
  readFactPack,
  COMPLETE,
  META_TALK,
  RANKING_TALK,
  countsSaid,
  dropThinItems,
  guideGraphicKept,
  itemQualityProblems,
  scrubDashes,
  withCount,
  type AskLike,
  type GuideDraft,
  type GuideItem,
} from "../src/gtaguide.ts";
import { clipOwner, frameScore } from "../src/gtaguidestep.ts";
import {
  batchesOf,
  fitMoments,
  writeGtaGuide,
} from "../src/editorial/gtaguidewriter.ts";
import { titleShapeProblems } from "../src/editorial/titleshape.ts";
import { thumbWordProblems, titleEchoProblems } from "../src/qa/thumbrule.ts";
import { loadConfig } from "../src/config.ts";
import { maybeSelectLongform, type Services } from "../src/pipeline.ts";
import { Thumb } from "../src/render/Brand.tsx";
import { GuideThumb } from "../src/render/ThumbStudio.tsx";
import type { Llm } from "../src/editorial/llm.ts";
import { sentencesOf } from "../src/editorial/longform.ts";
import { testDb, tmpDir, testConfig } from "./helpers.ts";

const wish = kindOf("wish-i-knew")!;
const NOW = new Date("2026-11-26T12:00:00Z");

const moment = (show: string) => ({
  show,
  keywords: ["Grand Theft Auto VI"],
  graphic: { kind: "none" as const, primary: "", secondary: "", items: [] },
  emphasis: "",
  person: "",
});

function item(n: number, over: Partial<GuideItem> = {}): GuideItem {
  const narration =
    over.narration ??
    `Number ${n} keeps your cash safe in Leonida. Park somewhere quiet before you open the phone. The map marks every shop you can walk into. Fuel matters on long drives across the state. Plan the route before you set off.`;
  return {
    number: n,
    title: over.title ?? `Tip ${n} for your first hours`,
    label: "confirmed",
    basis: "fact pack",
    chip: "Do this first",
    how: "Open the bank app on the phone and deposit",
    payoff: "A bust never takes the money you banked",
    narration,
    footage: { want: "gameplay", keywords: ["Vice City"] },
    claims: [
      {
        claim: "The map is about twice GTA V's size",
        label: "confirmed",
        source: "fact pack",
      },
    ],
    moments: narration.split(/(?<=[.!?])\s+/).map((s) => moment(s)),
    ...over,
  };
}

function draft(n = 12, over: Partial<GuideDraft> = {}): GuideDraft {
  return {
    kind: "wish-i-knew",
    intro: {
      narration:
        "Tip 1 for your first hours is to park before you touch the phone. That is the first of twelve things on this complete list, with no story spoilers at all, so you can start the right way tonight.",
      on_screen: "Start the right way",
    },
    items: Array.from({ length: n }, (_, i) => item(i + 1)),
    outro: {
      narration:
        "If you remember two things, make them the first and the fourth on this list. Park before the phone, and watch your fuel on the long roads out of Vice City. Everything else follows from those two habits, and your first night in Leonida goes a lot more smoothly for it.",
      on_screen: "Two habits that matter",
    },
    thumb_words: "DON'T PANIC",
    description: "Twelve things to know.",
    tags: ["gta 6"],
    ...over,
  };
}

// ---- Off by default, and the share ------------------------------------------------------------------------------------

test("GTA_GUIDES is off by default, with a share of 0.5 ready", () => {
  const was = {
    g: process.env.GTA_GUIDES,
    s: process.env.GTA_GUIDE_SHARE,
    f: process.env.GTA_GUIDE_FACTS,
  };
  delete process.env.GTA_GUIDES;
  delete process.env.GTA_GUIDE_SHARE;
  delete process.env.GTA_GUIDE_FACTS;
  try {
    const c = loadConfig();
    assert.equal(c.gtaGuides, false);
    assert.equal(c.gtaGuideShare, 0.5);
    assert.deepEqual(c.gtaGuideFacts, []);
    process.env.GTA_GUIDE_SHARE = "7";
    assert.equal(loadConfig().gtaGuideShare, 1);
  } finally {
    for (const [k, v] of [
      ["GTA_GUIDES", was.g],
      ["GTA_GUIDE_SHARE", was.s],
      ["GTA_GUIDE_FACTS", was.f],
    ] as const)
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
});

test("no change when off: no slot ever goes to a guide, whatever the share", () => {
  for (let d = 0; d < 60; d++) {
    const slot = new Date(Date.UTC(2026, 10, 20 + d, 17));
    assert.equal(
      gtaGuideSlot({ gtaGuides: false, gtaGuideShare: 1 }, slot),
      false,
    );
    assert.equal(
      gtaGuideSlot({ gtaGuides: true, gtaGuideShare: 0 }, slot),
      false,
    );
    assert.equal(
      gtaGuideSlot({ gtaGuides: true, gtaGuideShare: 1 }, slot),
      true,
    );
  }
});

test("a half share splits the slots about evenly and always gives the same answer for a slot", () => {
  let on = 0;
  for (let d = 0; d < 400; d++) {
    const slot = new Date(Date.UTC(2026, 10, 20, 17) + d * 86_400_000);
    const a = gtaGuideSlot({ gtaGuides: true, gtaGuideShare: 0.5 }, slot);
    assert.equal(
      gtaGuideSlot({ gtaGuides: true, gtaGuideShare: 0.5 }, new Date(slot)),
      a,
    );
    if (a) on++;
  }
  assert.ok(on > 150 && on < 250, `${on} of 400`);
});

// ---- The topic picker -------------------------------------------------------------------------------------------------

const ask = (question: string, over: Partial<AskLike> = {}): AskLike => ({
  question,
  status: "open",
  mentionCount: 3,
  score: 1,
  ...over,
});

test("the picker waits for launch, never repeats a kind inside 30 days, and runs out when every kind was made", () => {
  assert.equal(
    pickGuideTopic({
      now: new Date("2026-11-10T12:00:00Z"),
      made: [],
      demand: new Map(),
      asks: [],
    }),
    undefined,
  );
  const demand = new Map([
    ["mistakes", 900_000],
    ["wish-i-knew", 400_000],
  ]);
  assert.equal(
    pickGuideTopic({ now: NOW, made: [], demand, asks: [] })!.kind.key,
    "mistakes",
  );
  const recent = pickGuideTopic({
    now: NOW,
    made: [{ kind: "mistakes", at: "2026-11-20T00:00:00Z" }],
    demand,
    asks: [],
  });
  assert.equal(recent!.kind.key, "wish-i-knew");
  const old = pickGuideTopic({
    now: NOW,
    made: [{ kind: "mistakes", at: "2026-10-20T00:00:00Z" }],
    demand,
    asks: [],
  });
  assert.equal(old!.kind.key, "mistakes");
  const all = GUIDE_KINDS.map((k) => ({
    kind: k.key,
    at: "2026-11-25T00:00:00Z",
  }));
  assert.equal(
    pickGuideTopic({ now: NOW, made: all, demand, asks: [] }),
    undefined,
  );
});

test("the picker weighs the stream asks and the comments in them, never a spoiler ask", () => {
  const asks = [
    ask("Can your car really run out of fuel?", {
      mentions: [{ source: "comments" }, { source: "comments" }],
    }),
    ask("Do you lose the cash you carry when you get Wasted or Busted?"),
    ask("Does the ending reveal who betrayed Lucia?", { spoiler: true }),
  ];
  const pick = pickGuideTopic({ now: NOW, made: [], demand: new Map(), asks });
  assert.equal(pick!.kind.key, "mistakes");
  assert.ok(pick!.why.some((w) => /from our comments/.test(w)));
  assert.ok(!pick!.asks.some((a) => /ending/.test(a)));
});

test("demand counts only recent videos that name GTA 6, best query kept, a failed search gives no reading", () => {
  const rows = new Map<string, Array<{ views: number; title: string }> | Error>(
    [
      [
        "gta 6 mistakes to avoid",
        [
          { views: 100_000, title: "15 GTA 6 Mistakes" },
          { views: 9_000_000, title: "Minecraft tips" },
        ],
      ],
      [
        "gta 6 don't do this",
        [{ views: 250_000, title: "DON'T do this in GTA VI" }],
      ],
      ["gta 6 money guide", new Error("quota")],
    ],
  );
  const d = guideDemand(rows);
  assert.equal(d.get("mistakes"), 250_000);
  assert.equal(d.has("early-money"), false);
  assert.equal(new Set(GUIDE_QUERIES).size, GUIDE_QUERIES.length);
});

// ---- The fact pack and the owner's play -------------------------------------------------------------------------------

test("the fact pack keeps confirmed and reported apart, and the shipped pack has both", () => {
  const p = factPackText([
    {
      name: "a.md",
      text: "# Title\n\n## Confirmed\n- Out 19 Nov\n\n## Reported, label if used\n- PC in 2027",
    },
  ]);
  assert.match(p.confirmed, /Out 19 Nov/);
  assert.doesNotMatch(p.confirmed, /PC in 2027/);
  assert.match(p.reported, /PC in 2027/);
  for (const f of DEFAULT_GUIDE_FACTS) assert.ok(fs.existsSync(f), f);
  const real = readFactPack(DEFAULT_GUIDE_FACTS);
  assert.ok(real.confirmed.length > 500);
  assert.deepEqual(real.missed, []);
});

test("the post-launch mechanics file is read, each guide only its own kind's sections, inside a prompt budget", () => {
  assert.ok(DEFAULT_GUIDE_FACTS.some((f) => f.endsWith("guide_facts_gta6_mechanics.md")));
  const hidden = readFactPack(DEFAULT_GUIDE_FACTS, "hidden-features");
  // A hidden-features line is in; a mistakes line and an early-money line are not; its reported money loop is reported.
  assert.match(hidden.confirmed, /Leave a car with the engine running/);
  assert.doesNotMatch(hidden.confirmed, /### Mistakes to avoid/);
  assert.doesNotMatch(hidden.reported, /### Early money/);
  const money = readFactPack(DEFAULT_GUIDE_FACTS, "early-money");
  assert.match(money.reported, /warehouse/i);
  assert.doesNotMatch(money.confirmed, /### Hidden features/);
  // The pre-launch files are kept whole for every kind (they have no kind sections).
  assert.match(money.confirmed, /\$79\.99/);
  // The owner's footage notes are never facts: his play comes in only as play evidence.
  assert.doesNotMatch(hidden.reported, /Owner's play|2 stars lost in 17 seconds/);
  assert.match(hidden.reported, /Never use/);
  for (const k of GUIDE_KINDS) {
    const p = readFactPack(DEFAULT_GUIDE_FACTS, k.key);
    const size = p.confirmed.length + p.reported.length;
    assert.ok(size < 40_000, `${k.key}: ${size} characters of facts in every call`);
  }
  assert.equal(
    kindSections("## Confirmed\n### A (mistakes)\n- m\n### B (early-money)\n- e\n## Reported\n- r", "early-money"),
    "## Confirmed\n### B (early-money)\n- e\n## Reported\n- r",
  );
});

test("play evidence is only the owner's own recordings, never story or menus, sure HUD facts and settled checks", () => {
  const lines = playEvidence({
    recordings: [
      {
        vodId: "v1",
        title: "GTA 6 | Return to Vice City!",
        recordedOn: "2026-11-25",
        own: true,
        stretches: [
          {
            place: "Vice Beach",
            activity: "driving",
            vehicle: "a scooter",
            brands: ["Scooter Bros"],
          },
          { place: "Vice Beach", activity: "driving" },
          {
            place: "Port Gellhorn",
            activity: "a mission cutscene",
            story: true,
          },
          { activity: "map screen", menu: true },
        ],
      },
      {
        vodId: "v2",
        title: "GTA VI First Play",
        recordedOn: "2026-11-19",
        own: false,
        stretches: [{ place: "Kelly County", activity: "swimming" }],
      },
    ],
    hudFacts: [
      {
        vodId: "v1",
        text: "Lost a 2-star wanted level in 3 and a half minutes",
        confidence: 0.9,
      },
      {
        vodId: "v1",
        text: "Lost a 5-star wanted level in 2 seconds",
        confidence: 0.4,
      },
      { vodId: "v2", text: "Someone else's reading", confidence: 0.95 },
    ],
    asks: [
      ask("Can your car run out of fuel?", {
        verdict: {
          result: "proved",
          confidence: 0.9,
          vodId: "v1",
          recordedOn: "2026-11-25",
          reason: "the fuel gauge emptied",
        },
      }),
      ask("Can you swim?", {
        verdict: {
          result: "proved",
          confidence: 0.9,
          vodId: "v2",
          recordedOn: "2026-11-19",
          reason: "his cousin swam",
        },
      }),
    ],
  });
  const all = lines.join("\n");
  assert.match(all, /Vice Beach \(2\)/);
  assert.match(all, /Scooter Bros/);
  assert.doesNotMatch(
    all,
    /Port Gellhorn|cutscene|map screen|Kelly County|swimming|cousin|Someone else|5-star/,
  );
  assert.match(all, /3 and a half minutes/);
  assert.match(all, /fuel gauge emptied/);
  assert.deepEqual(
    playEvidence({ recordings: [], hudFacts: [], asks: [] }),
    [],
  );
});

// ---- The list shape ---------------------------------------------------------------------------------------------------

test("every title carries the count and a completeness promise, under 70 characters, and passes the title shape", () => {
  for (const k of GUIDE_KINDS) {
    const t = guideTitleFor(k, k.items[1]);
    assert.ok(t.includes(String(k.items[1])), t);
    assert.match(t, COMPLETE);
    assert.match(t, /GTA 6/);
    assert.ok(t.length <= 70, `${t} (${t.length})`);
    assert.deepEqual(titleShapeProblems(t), [], t);
  }
});

test("the thumbnail words: the writer's 2-3 when they hold, never an echo of the title, the kind's own otherwise", () => {
  const fallback = { big: "START HERE", small: "NO SPOILERS" };
  assert.deepEqual(guideThumbWords(wish, 16, "DON'T SWIM"), { big: "DON'T SWIM", small: "" });
  assert.deepEqual(guideThumbWords(wish, 16, "DON'T SWIM / AT NIGHT"), { big: "DON'T SWIM", small: "AT NIGHT" });
  // "16 THINGS" repeats "GTA 6: 16 Things I Wish I Knew"; a number that isn't the count, one word or four words fail too.
  assert.deepEqual(guideThumbWords(wish, 16, "16 THINGS / NO SPOILERS"), fallback);
  assert.deepEqual(guideThumbWords(wish, 16, "25 COPS"), fallback);
  assert.deepEqual(guideThumbWords(wish, 16, "WOW"), fallback);
  assert.deepEqual(guideThumbWords(wish, 16, "YOU MUST DO THIS"), fallback);
  for (const k of GUIDE_KINDS) {
    const n = k.items[1];
    const fb = k.thumb(n);
    assert.deepEqual(thumbWordProblems(fb.big), [], k.key);
    assert.deepEqual(titleEchoProblems(fb.big, guideTitleFor(k, n)), [], k.key);
  }
});

const has = (ps: string[], re: RegExp) => ps.some((p) => re.test(p));

test("item 1 is delivered in the first line, or the draft goes back", () => {
  const ok = guideProblems(draft(), { kind: wish, evidence: [] });
  assert.ok(!has(ok, /first sentence/), ok.join("\n"));
  const bad = guideProblems(
    draft(12, {
      intro: {
        narration:
          "Welcome back to the channel, today we have a big one for you with twelve tips and no spoilers in sight at all tonight.",
        on_screen: "x",
      },
    }),
    { kind: wish, evidence: [] },
  );
  assert.ok(has(bad, /must deliver item 1/));
  assert.ok(has(bad, /greeting/));
});

test("labels: a reported claim is said as reported; first-hand only with play evidence and a playthrough claim", () => {
  const reported = draft(12);
  reported.items[2] = item(3, {
    claims: [{ claim: "PC in 2027", label: "reported", source: "fact pack" }],
  });
  assert.ok(
    has(
      guideProblems(reported, { kind: wish, evidence: [] }),
      /never says so aloud/,
    ),
  );
  const hedged = draft(12);
  hedged.items[2] = item(3, {
    claims: [{ claim: "PC in 2027", label: "reported", source: "fact pack" }],
    narration:
      "Number 3 is about PC, which GamesBeat reportedly expects in early 2027. Rockstar has not said so. For now it is PS5 and Xbox Series X and S only. Plan around the console you own. Do not wait on a rumour.",
  });
  hedged.items[2]!.moments = fitMoments(hedged.items[2]!.narration, []);
  assert.ok(
    !has(
      guideProblems(hedged, { kind: wish, evidence: [] }),
      /never says so aloud/,
    ),
  );
  const firstHand = draft(12);
  firstHand.items[4] = item(5, {
    narration:
      "Number 5: in my playthrough the cops gave up fast. Keep moving and break the line of sight. Change streets often. Hide under a bridge if you can. Then wait it out.",
  });
  firstHand.items[4]!.moments = fitMoments(firstHand.items[4]!.narration, []);
  assert.ok(
    has(
      guideProblems(firstHand, {
        kind: wish,
        evidence: ["My stream shows me driving"],
      }),
      /speaks first-hand/,
    ),
  );
  firstHand.items[4]!.basis = "my playthrough";
  assert.ok(
    !has(
      guideProblems(firstHand, {
        kind: wish,
        evidence: ["My stream shows me driving"],
      }),
      /speaks first-hand/,
    ),
  );
  assert.ok(
    has(
      guideProblems(firstHand, { kind: wish, evidence: [] }),
      /no play evidence/,
    ),
  );
});

test("the count and the sentence-to-moment match are held", () => {
  assert.ok(
    has(
      guideProblems(draft(5), { kind: wish, evidence: [] }),
      /There are 5 items/,
    ),
  );
  const d = draft();
  d.items[0]!.moments = d.items[0]!.moments.slice(1);
  assert.ok(
    has(guideProblems(d, { kind: wish, evidence: [] }), /sentences but/),
  );
});

test("the plan check: count, item 1 first, no playthrough items without evidence", () => {
  const plan = {
    intro: {
      narration:
        "Never leave your car running on the hard shoulder. That is one of twelve.",
    },
    items: Array.from({ length: 12 }, (_, i) => ({
      title: i === 0 ? "Never leave your car running" : `Tip ${i + 1}`,
      basis: "fact pack",
      how: "Turn the engine off before you get out",
      payoff: "Nobody drives off with your car and its trunk",
    })),
  };
  assert.deepEqual(guidePlanProblems(plan, wish, []), []);
  plan.items[3]!.basis = "my playthrough";
  assert.ok(has(guidePlanProblems(plan, wish, []), /no play evidence/));
  assert.deepEqual(
    guidePlanProblems(plan, wish, ["My stream shows me driving"]),
    [],
  );
  assert.ok(
    has(
      guidePlanProblems({ ...plan, items: plan.items.slice(0, 4) }, wish, [
        "x",
      ]),
      /4 items/,
    ),
  );
});

test("the script is ranking-shaped: item 1 spoken first, cards and chapters count 1..N, every entry GTA VI", () => {
  const sc = guideToScript(draft(12), wish);
  assert.equal(
    sc.youtube.title,
    "GTA 6: 12 Things I Wish I Knew (No Spoilers, Full List)",
  );
  assert.equal(sc.evergreen_format, "ranking");
  assert.equal(sc.runtime, "long");
  assert.deepEqual(
    sc.beats.map((b) => b.visual?.value_a),
    Array.from({ length: 12 }, (_, i) => i + 1),
  );
  assert.equal(sc.beats[0]!.visual!.primary, "Tip 1 for your first hours");
  assert.equal(sc.beats[0]!.visual!.items![1], "CONFIRMED");
  // The render pairs beats with entries sorted from the highest rank down: item 1 first.
  const order = [...sc.entries!].sort((a, b) => b.rank - a.rank);
  assert.equal(
    order[0]!.moments![0]!.show,
    draft(12).items[0]!.moments[0]!.show,
  );
  assert.ok(
    sc.entries!.every(
      (e) =>
        e.game_title === "Grand Theft Auto VI" && e.steam_search_term === "",
    ),
  );
  assert.equal(sc.gta_guide!.items, 12);
  assert.deepEqual(sc.gta_guide!.thumb, { big: "DON'T PANIC", small: "" });
  assert.equal(
    labelLine({ label: "reported", basis: "my playthrough" }),
    "REPORTED · MY PLAYTHROUGH",
  );
});

test("isGtaGuide reads the episode's factcheck", () => {
  assert.equal(isGtaGuide({ gta_guide: { kind: "mistakes" } }), true);
  assert.equal(isGtaGuide({ gta_guide: { kind: "nope" } }), false);
  assert.equal(isGtaGuide({ topic: { format: "ranking" } }), false);
  assert.equal(isGtaGuide(null), false);
});

// ---- The writer (a fake model) ----------------------------------------------------------------------------------------

test("the writer plans once, sends a plan back once, and writes the items in batches of three", async () => {
  const sites: string[] = [];
  let plans = 0;
  const llm: Llm = {
    async structured(o) {
      sites.push(o.site ?? "?");
      if (o.site === "gtaguide.plan") {
        plans++;
        const first =
          plans === 1
            ? "Welcome to the guide."
            : "Never leave your car running on the hard shoulder.";
        return {
          intro: {
            narration: `${first} That is the first of twelve\u2014all of them.`,
            on_screen: "Start right",
          },
          items: Array.from({ length: 12 }, (_, i) => ({
            number: i + 1,
            title: i === 0 ? "Never leave your car running" : `Tip ${i + 1}`,
            label: "confirmed",
            basis: "fact pack",
            chip: "Do it",
            how: "Turn the engine off before you get out",
            payoff: "Nobody drives off with your car and its trunk",
            notes: "from the pack",
          })),
          outro: {
            narration: "Remember the first two.",
            on_screen: "Two habits",
          },
          thumb_words: "DON'T STOP",
          description: "d",
          tags: [],
        } as never;
      }
      const want = [
        ...String(o.content).matchAll(/Write items (\d+(?:, \d+)*)/g),
      ][0]![1]!
        .split(",")
        .map((x) => Number(x.trim()));
      return {
        items: want.map((n) => ({
          number: n,
          narration: `Number ${n} is short. It has two sentences.`,
          footage: { want: "gameplay", keywords: ["Vice City"] },
          claims: [{ claim: "x", label: "confirmed", source: "fact pack" }],
          moments: [moment("a")],
        })),
      } as never;
    },
  };
  const d = await writeGtaGuide(
    llm,
    {
      kind: wish,
      facts: { confirmed: "c", reported: "" },
      evidence: [],
      asks: [],
      rumours: [],
    },
    [],
    {},
    (plan) => guidePlanProblems(plan, wish, []),
  );
  assert.deepEqual(sites, [
    "gtaguide.plan",
    "gtaguide.plan",
    "gtaguide.items",
    "gtaguide.items",
    "gtaguide.items",
    "gtaguide.items",
  ]);
  assert.equal(d.items.length, 12);
  assert.match(d.intro.narration, /^Never leave/);
  // The writer's own em dash never leaves it.
  assert.doesNotMatch(JSON.stringify(d), /\u2014/);
  assert.equal(d.items[0]!.payoff, "Nobody drives off with your car and its trunk");
  // One moment came back for two sentences: padded so every sentence has a picture.
  assert.equal(d.items[0]!.moments.length, 2);
  assert.deepEqual(
    batchesOf([1, 2, 3, 4, 5, 6, 7]).map((b) => b.length),
    [3, 3, 1],
  );
});

// ---- The thumbnail ----------------------------------------------------------------------------------------------------

test("the guide thumbnail: its own layout, the owner's footage first, bright and colourful frames", () => {
  const el = Thumb({
    layout: "guide",
    headline: "DON'T SWIM",
    kicker: "",
    game: "",
    imageSrc: "x.jpg",
    accent: "#FF6B1A",
  }) as React.ReactElement;
  assert.equal(el.type, GuideThumb);
  assert.equal(
    clipOwner({
      provenance:
        "Pulse's own gameplay capture of Grand Theft Auto VI (stream ...)",
    }),
    "own",
  );
  assert.equal(
    clipOwner({
      provenance:
        "Permitted stream capture of Grand Theft Auto VI (Gameplay: Spencey96 on Twitch; ...)",
    }),
    "permitted",
  );
  assert.equal(clipOwner({ provenance: 'Cutscenes for "GTA VI"' }), "other");
  assert.equal(frameScore(10, 80), -1);
  assert.equal(frameScore(240, 80), -1);
  assert.ok(frameScore(125, 90) > frameScore(125, 20));
  assert.ok(frameScore(125, 60) > frameScore(70, 60));
});

// ---- The verdict ------------------------------------------------------------------------------------------------------

test("the verdict waits for 6 a side, then needs both views and CTR above the rankings' medians", () => {
  const side = (arm: "guide" | "ranking", views: number, ctr?: number, n = 6) =>
    Array.from({ length: n }, () => ({
      arm,
      views7d: views,
      ...(ctr !== undefined ? { ctr } : {}),
    }));
  assert.equal(
    gtaGuideVerdict([
      ...side("guide", 9000, 0.06, 5),
      ...side("ranking", 1000, 0.04),
    ]).verdict,
    "waiting",
  );
  assert.equal(
    gtaGuideVerdict([
      ...side("guide", 9000, 0.06),
      ...side("ranking", 1000, 0.04),
    ]).verdict,
    "pass",
  );
  assert.equal(
    gtaGuideVerdict([
      ...side("guide", 9000, 0.03),
      ...side("ranking", 1000, 0.04),
    ]).verdict,
    "fail",
  );
  assert.equal(
    gtaGuideVerdict([...side("guide", 900), ...side("ranking", 1000)]).verdict,
    "fail",
  );
  // CTR unknown on a side: views alone decide.
  assert.equal(
    gtaGuideVerdict([...side("guide", 9000), ...side("ranking", 1000)]).verdict,
    "pass",
  );
});

// ---- The long lane, off and on ----------------------------------------------------------------------------------------

async function rig(over: Record<string, unknown>) {
  const db = await testDb();
  const dir = await tmpDir();
  const cfg = testConfig(dir, {
    longformEnabled: true,
    longformDays: ["sat"],
    longformSlot: "17:00",
    longLeadMinutes: 30 * 60,
    timezone: "Europe/London",
    demandCheck: false,
    sequelWinners: false,
    ...over,
  });
  const asked: string[] = [];
  const llm: Llm = {
    async structured(o) {
      asked.push(o.site ?? "?");
      return {
        candidate_index: 0,
        format: "ranking",
        theme: "The Legend of Zelda",
        title_idea: "Ranking EVERY Zelda Game",
        criterion: "how well each one holds up today",
        reason: "a big series",
      } as never;
    },
  };
  const clock = new Date("2026-11-20T12:00:00Z");
  const s = {
    db,
    cfg,
    llm,
    now: () => clock,
    notify: async () => undefined,
    trending: async () => [],
    discoverEvergreen: async () => [
      { name: "The Legend of Zelda", source: "franchise seed" },
    ],
  } as unknown as Services;
  return { db, s, asked, dir };
}

test("no change when off: the long slot goes to the ranking and nothing of the guide is read or recorded", async () => {
  const { db, s, asked } = await rig({ gtaGuides: false, gtaGuideShare: 1 });
  const id = await maybeSelectLongform(s);
  assert.ok(id);
  assert.deepEqual(asked, ["longform.topic"]);
  const [ep] = await db.query<{ factcheck_json: Record<string, unknown> }>(
    `SELECT factcheck_json FROM episodes WHERE id = $1`,
    [id],
  );
  assert.ok(ep!.factcheck_json.topic);
  assert.equal(ep!.factcheck_json.gta_guide, undefined);
  const ev = await db.query(`SELECT 1 FROM events WHERE kind = 'gta_guide'`);
  assert.equal(ev.length, 0);
  await db.close();
});

test("on with a full share: the slot becomes a GTA guide, picked without a model call, and recorded", async () => {
  const { db, s, asked, dir } = await rig({
    gtaGuides: true,
    gtaGuideShare: 1,
  });
  fs.mkdirSync(path.join(dir, "streamasks"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "streamasks", "asks.json"),
    JSON.stringify({
      updatedAt: "",
      notes: [],
      asks: [
        {
          game: "Grand Theft Auto VI",
          question: "Is the Ultimate edition worth it over Standard?",
          claim: "",
          status: "open",
          mentionCount: 5,
          mentions: [],
        },
      ],
    }),
  );
  const id = await maybeSelectLongform(s);
  assert.ok(id);
  assert.deepEqual(asked, []);
  const [ep] = await db.query<{
    factcheck_json: { gta_guide: { kind: string; asks: string[] } };
    lane: string;
  }>(`SELECT factcheck_json, lane FROM episodes WHERE id = $1`, [id]);
  assert.equal(ep!.lane, "longform");
  assert.equal(ep!.factcheck_json.gta_guide.kind, "which-edition");
  assert.ok(ep!.factcheck_json.gta_guide.asks.some((a) => /edition/.test(a)));
  const ev = await db.query<{ detail: { arm: string } }>(
    `SELECT detail FROM events WHERE kind = 'gta_guide'`,
  );
  assert.equal(ev[0]!.detail.arm, "guide");
  await db.close();
});

test("a guide that failed for a slot hands that slot to the ranking", async () => {
  const { db, s, asked } = await rig({ gtaGuides: true, gtaGuideShare: 1 });
  const first = await maybeSelectLongform(s);
  assert.ok(first);
  await db.query(`UPDATE episodes SET status = 'failed' WHERE id = $1`, [first]);
  const second = await maybeSelectLongform(s);
  assert.ok(second && second !== first);
  assert.deepEqual(asked, ["longform.topic"]);
  const [ep] = await db.query<{ factcheck_json: Record<string, unknown> }>(`SELECT factcheck_json FROM episodes WHERE id = $1`, [second]);
  assert.ok(ep!.factcheck_json.topic);
  const arms = (await db.query<{ detail: { arm: string } }>(`SELECT detail FROM events WHERE kind = 'gta_guide' ORDER BY id`)).map((r) => r.detail.arm);
  assert.deepEqual(arms, ["guide", "ranking"]);
  await db.close();
});

test("demand ignores GTA 6 videos that are not this kind of guide", () => {
  const rows = new Map<string, Array<{ views: number; title: string }> | Error>([
    ["gta 6 which edition to buy", [{ views: 90_000_000, title: "GTA 6 Launch Trailer" }, { views: 120_000, title: "GTA 6 Ultimate Edition: worth it?" }]],
  ]);
  assert.equal(guideDemand(rows).get("which-edition"), 120_000);
});

test("the verdict's numbers: published videos in an arm with 7-day views, CTR where the reach reports have it", async () => {
  const { gtaGuideResults } = await import("../src/gtaguidestep.ts");
  const db = await testDb();
  const ep = async (id: string, status: string, arm: string, v7?: number, ctr?: number) => {
    await db.query(
      `INSERT INTO episodes (id, story_hash, lane, status, story_json, youtube_video_id) VALUES ($1, $1, 'longform', $2, '{}'::jsonb, $3)`,
      [id, status, status === "published" ? `yt_${id}` : null],
    );
    await db.query(`INSERT INTO events (episode_id, kind, detail) VALUES ($1, 'gta_guide', $2)`, [id, JSON.stringify({ arm })]);
    await db.query(`INSERT INTO events (episode_id, kind, detail) VALUES ($1, 'gta_guide', $2)`, [id, JSON.stringify({ stage: "scripted" })]);
    if (v7 !== undefined) await db.query(`INSERT INTO video_metrics (episode_id, label, views) VALUES ($1, '7d', $2)`, [id, v7]);
    if (ctr !== undefined) await db.query(`INSERT INTO video_metrics (episode_id, label, raw) VALUES ($1, 'ctr', $2)`, [id, JSON.stringify({ ctr })]);
  };
  await ep("g1", "published", "guide", 5000, 0.07);
  await ep("g2", "published", "guide");
  await ep("g3", "failed", "guide", 100);
  await ep("r1", "published", "ranking", 800);
  const r = (await gtaGuideResults(db)).sort((a, b) => a.views7d - b.views7d);
  assert.deepEqual(r, [{ arm: "ranking", views7d: 800 }, { arm: "guide", views7d: 5000, ctr: 0.07 }]);
  await db.close();
});

test("a guide goes out as a guide: its own title, description lead, thumbnail words, pinned comment and chapter label", async () => {
  const { evergreenTitle, polishTitle, keywordLead, thumbTitle, pinnedComment } = await import("../src/editorial/seo.ts");
  const { layoutProblem, heroThumbWords } = await import("../src/qa/thumbrule.ts");
  const { hasSpoilerWarning } = await import("../src/sceneindex/spoilers.ts");
  const sc = guideToScript(draft(12), wish);
  assert.equal(evergreenTitle(sc), "GTA 6: 12 Things I Wish I Knew (No Spoilers, Full List)");
  assert.equal(polishTitle(sc), sc.youtube.title);
  assert.match(keywordLead(sc), /^GTA 6: 12 Things I Wish I Knew/);
  assert.doesNotMatch(keywordLead(sc), /ranked/i);
  assert.equal(thumbTitle(sc), "DON'T PANIC");
  assert.doesNotMatch(pinnedComment(sc), /number one|rank/i);
  assert.equal(layoutProblem("guide"), undefined);
  assert.equal(heroThumbWords({ ...sc, youtube: { ...sc.youtube, thumb_text: "12 THINGS" } }), "START HERE");
  // "No story spoilers" is a promise: it never opens the late story to the footage.
  assert.equal(hasSpoilerWarning(["Park before the phone. That's one of twelve, with no story spoilers."]), false);
  assert.equal(hasSpoilerWarning(["Spoiler warning: the story is discussed from here."]), true);
});

test("the guide thumbnail passes the thumbnail rule's design checks, its second line included", async () => {
  const { designProblems } = await import("../src/qa/thumbrule.ts");
  const sc = guideToScript(draft(12, { thumb_words: "DON'T SWIM / AT NIGHT" }), wish);
  const thumb = { layout: "guide", headline: sc.gta_guide!.thumb.big, kicker: "", subline: sc.gta_guide!.thumb.small, game: "", accent: "#FF6B1A", imageFile: "assets/guide_frame.jpg" };
  const p = designProblems(thumb, sc);
  assert.deepEqual(p, []);
  const { pinnedComment } = await import("../src/editorial/seo.ts");
  const ed = guideToScript({ ...draft(10), kind: "which-edition" }, kindOf("which-edition")!);
  assert.match(pinnedComment(ed), /edition/);
});

// ---- The first proof's faults (26 Nov 2026) ----------------------------------------------------------------------------

const stat = (primary: string, secondary = "") => ({
  kind: "stat" as const,
  primary,
  secondary,
  items: [] as string[],
});

test("one order on screen: cards, chapters and narration count up 1..N as spoken; no graphic restates the number", async () => {
  const { usefulGraphic } = await import("../src/render/longplan.ts");
  const d = draft(12);
  // The proof's writer put "No. 1" on item 1, a stream date on item 2 and a real date on item 3.
  d.items[0]!.moments[0] = { ...d.items[0]!.moments[0]!, graphic: stat("No. 1", "Radio on foot") };
  d.items[1]!.moments[1] = {
    ...d.items[1]!.moments[1]!,
    graphic: { kind: "date", primary: "November 25", secondary: "Forest path on stream", items: [] },
  };
  d.items[2] = item(3, {
    narration:
      "Number 3 is the bank app. The next update arrives on December 18 with new stock. Deposit before then. Banked money stays put. Then head out.",
  });
  d.items[2]!.moments[1] = {
    ...d.items[2]!.moments[1]!,
    graphic: { kind: "date", primary: "December 18", secondary: "Update arrives", items: [] },
  };
  d.items[3]!.moments[2] = { ...d.items[3]!.moments[2]!, graphic: stat("$500", "Stream footage") };
  d.items[4]!.moments[2] = { ...d.items[4]!.moments[2]!, graphic: stat("$500", "Fine for a crash") };
  const sc = guideToScript(d, wish);
  // The card, the chapter index ("#1") and the YouTube chapter line all read visual.value_a: 1..N in beat order.
  assert.deepEqual(
    sc.beats.map((b) => b.visual?.value_a),
    Array.from({ length: 12 }, (_, i) => i + 1),
  );
  // The render pairs beat k with the k-th entry from the highest rank down: beat 1's pictures are item 1's.
  const paired = [...sc.entries!].sort((a, b) => b.rank - a.rank);
  assert.equal(paired[2]!.moments![0]!.show, d.items[2]!.moments[0]!.show);
  const g = (e: number, m: number) => (paired[e]!.moments![m] as { graphic: { kind: string; primary: string } }).graphic;
  assert.equal(g(0, 0).kind, "none", "No. 1 repeats the card");
  assert.equal(g(1, 1).kind, "none", "a stream date tells the viewer nothing");
  assert.equal(g(2, 1).kind, "date", "a date that matters stays");
  assert.equal(g(3, 2).kind, "none", "where the footage came from is not a graphic");
  assert.equal(g(4, 2).primary, "$500");
  // Rankings too: "No. 3" restates the rank card as surely as "#3".
  assert.equal(usefulGraphic(stat("No. 3")), false);
  assert.equal(usefulGraphic(stat("Number 3")), false);
  assert.equal(usefulGraphic(stat("$500", "Fine")), true);
  // The narration's number must be the card's.
  const off = draft(12);
  off.items[1] = item(2, { narration: off.items[1]!.narration.replace("Number 2", "Number 11") });
  assert.ok(has(guideProblems(off, { kind: wish, evidence: [] }), /says it is number 11; on screen it is number 2/));
  // The intro's count must be the list's.
  const count = draft(12);
  count.intro = { ...count.intro, narration: count.intro.narration.replace("twelve things", "fifteen things") };
  assert.ok(has(guideProblems(count, { kind: wish, evidence: [] }), /says 15 items; the list has 12/));
  assert.deepEqual(countsSaid("These 12 GTA 6 features, and GTA 5 things"), [12]);
  assert.deepEqual(countsSaid("one of these 12 hidden features"), [12]);
  assert.deepEqual(countsSaid("That is the first of twelve things"), [12]);
});

test("a guide never talks like a ranking: its own voice, and ranking talk goes back", async () => {
  const { FORMAT_VOICE, voiceFor } = await import("../src/editorial/voice.ts");
  const { planPrompt, batchPrompt } = await import("../src/editorial/gtaguidewriter.ts");
  assert.match(FORMAT_VOICE.guide, /not a ranking/);
  assert.match(voiceFor("guide"), /not a ranking/);
  for (const k of GUIDE_KINDS) {
    assert.doesNotMatch(planPrompt(k), /the ranking rule|hardest call honestly/);
    assert.match(planPrompt(k), /not a ranking/);
  }
  assert.doesNotMatch(batchPrompt(), /the ranking rule/);
  const d = draft(12);
  d.outro = {
    ...d.outro,
    narration: `${d.outro.narration} Dirt racing over storm watching was the hardest call for me.`,
  };
  assert.ok(has(guideProblems(d, { kind: wish, evidence: [] }), /ranking talk/));
  assert.match("I'm ranking everyday usefulness first", RANKING_TALK);
  assert.match("I'd put portable radio ahead of a scenic detour", RANKING_TALK);
  assert.doesNotMatch("Get ahead of the cops by cutting through the mall", RANKING_TALK);
});

test("no em dash anywhere a guide goes: hook, narration, cards, title, description, tags, pinned comment", async () => {
  const { pinnedComment, keywordLead } = await import("../src/editorial/seo.ts");
  const d = draft(12);
  d.intro = {
    narration:
      "Tip 1 for your first hours: park before you touch the phone—it saves your car. That is the first of twelve things on this complete list, with no story spoilers at all, so you can start the right way tonight.\nNo greeting — just the list.",
    on_screen: "Start — right",
  };
  d.items[1] = item(2, {
    title: "Bank it — always",
    chip: "Safe – money",
    narration:
      "Number 2 is the bank—use it. Deposit before every job. A bust takes what you carry — not what you banked. Check the app often. Then move on.",
  });
  d.items[1]!.moments[0] = { ...d.items[1]!.moments[0]!, show: "ATM — close up" };
  d.description = "Twelve things — no spoilers.";
  d.tags = ["gta 6 — tips"];
  assert.ok(has(guideProblems(d, { kind: wish, evidence: [] }), /em dash/));
  const sc = guideToScript(d, wish);
  assert.doesNotMatch(JSON.stringify(sc), /—|\s–\s/);
  assert.match(sc.hook, /phone, it saves your car\./);
  assert.match(sc.hook, /\nNo greeting, just the list\./, "line breaks are kept");
  // A dash becomes a comma, never a full stop, so every sentence keeps its picture.
  assert.equal(sentencesOf(sc.beats[1]!.narration).length, sentencesOf(d.items[1]!.narration).length);
  assert.equal(sc.beats[1]!.visual!.primary, "Bank it, always");
  for (const k of GUIDE_KINDS) {
    const s = guideToScript({ ...draft(k.items[0]), kind: k.key }, k);
    for (const t of [s.youtube.title, pinnedComment(s), keywordLead(s), k.question, k.angle])
      assert.doesNotMatch(t, /—/, k.key);
  }
  assert.equal(scrubDashes("a — b — c."), "a, b, c.");
  assert.equal(scrubDashes("done—."), "done.");
});

// The twelve items of the 26 Nov proof, with the how and payoff a writer would give them.
const PROOF_ITEMS = [
  ["Take the radio on foot", "Plug headphones into the phone", "Music while you walk"],
  ["Look underwater for ruins", "Dive off the coast near the keys", "Something different to see"],
  ["Choose an on-demand podcast", "Open the podcast app on the phone", "Choose your listening"],
  ["Go racing on a dirt track", "Drive to the dirt track", "A change of scenery from the streets"],
  ["Listen with PS5 3D audio", "Use headphones on PS5", "Hear the city around you"],
  ["Take a jet ski ride", "Rent one at the beach", "Explore the coast by water"],
  ["Listen to the radio hosts", "Tune to a talk station", "It's fun to hear the hosts"],
  ["Watch for tropical storms", "Look at the sky over Leonida", "Atmosphere you won't forget"],
  ["Notice Vice City's art deco streets", "Walk Ocean Drive slowly", "A beautiful old district"],
  ["Look for alligators in wetlands", "Head into the swamps", "Wildlife up close"],
  ["Notice the DualSense haptics", "Drive over rough roads", "Feel the feedback"],
  ["Look for a forest path", "Leave the road up north", "Change the scenery"],
] as const;

test("item quality: the proof's sightseeing, console features and trailer headlines are refused; real tips pass", () => {
  const hidden = kindOf("hidden-features")!;
  for (const [title, how, payoff] of PROOF_ITEMS)
    assert.ok(itemQualityProblems({ title, how, payoff }, hidden).length > 0, title);
  const good = [
    {
      title: "Bank your cash before a job",
      how: "Open the bank app on the phone and deposit what you carry",
      payoff: "A bust or a wipe-out never takes the money you banked",
    },
    {
      title: "Duck into a car wash to lose the cops",
      how: "Drive through any car wash while your wanted level is flashing",
      payoff: "The search zone shrinks and you escape faster",
    },
    {
      title: "Storms close the shops, so rob them after",
      how: "Wait out a storm warning on the phone, then hit the boarded-up stores",
      payoff: "The tills are full and the cops are slower to arrive",
    },
  ];
  for (const g of good) assert.deepEqual(itemQualityProblems(g, hidden), [], g.title);
  // No how or no payoff: refused.
  assert.ok(itemQualityProblems({ title: "Bank your cash" }, hidden).some((p) => /what to do/.test(p)));
  assert.ok(itemQualityProblems({ title: "Bank your cash", how: "Open the bank app" }, hidden).some((p) => /what you get/.test(p)));
  // A console feature is fine only in the edition guide.
  const pro = { title: "PS5 Pro gets a sharper mode", how: "Pick the performance mode in settings", payoff: "Steadier frame rate in chases" };
  assert.ok(itemQualityProblems(pro, hidden).length > 0);
  assert.deepEqual(itemQualityProblems(pro, kindOf("which-edition")!), []);
});

test("thin items are dropped down to the kind's minimum, and the count, intro and title follow", async () => {
  const hidden = kindOf("hidden-features")!;
  const goodItem = (i: number) => ({
    title: `Bank your cash trick ${i}`,
    how: "Open the bank app on the phone and deposit",
    payoff: "A bust never takes the money you banked",
    notes: "",
    chip: "Bank it",
  });
  const plan = {
    intro: { narration: "Bank your cash trick 1 before every job. These 10 hidden features come with no story spoilers.", on_screen: "x" },
    items: [
      ...Array.from({ length: 8 }, (_, i) => goodItem(i + 1)),
      { title: "Look for alligators in wetlands", how: "Head into the swamps", payoff: "Wildlife up close", notes: "", chip: "Gators" },
      { title: "Notice the DualSense haptics", how: "Drive over rough roads", payoff: "Feel the feedback", notes: "", chip: "Feel it" },
    ],
  };
  const r = dropThinItems(plan, hidden);
  assert.deepEqual(r.dropped, ["Look for alligators in wetlands", "Notice the DualSense haptics"]);
  assert.equal(r.plan.items.length, 8);
  assert.match(r.plan.intro.narration, /These 8 hidden features/);
  assert.deepEqual(guidePlanProblems({ ...r.plan, items: r.plan.items.map((x) => ({ ...x, basis: "fact pack" })) }, hidden, []), []);
  assert.equal(guideTitleFor(hidden, r.plan.items.length), "GTA 6: 8 Hidden Features Nobody Told You About (Full List)");
  // Never below the minimum: the first thin item in spoken order fills the gap, the problems go back to the writer.
  const short = { ...plan, items: plan.items.slice(2) };
  const r2 = dropThinItems(short, hidden);
  assert.equal(r2.plan.items.length, 7);
  assert.deepEqual(r2.dropped, ["Notice the DualSense haptics"]);
  assert.ok(has(guidePlanProblems({ ...short, items: short.items.map((x) => ({ ...x, basis: "fact pack" })) }, hidden, []), /sightseeing|console/));
  assert.equal(withCount("All twelve things, and GTA 5 tips", 12, 8), "All eight things, and GTA 5 tips");
  // Every count follows: the description, the outro, the kicker and the thumbnail words.
  const full = dropThinItems(
    {
      ...plan,
      description: "All 10 hidden features, no spoilers.",
      outro: { narration: "Those are all 10 features. Bank first.", on_screen: "These 10 tricks" },
      thumb_words: "10 SECRETS",
    },
    hidden,
  ).plan;
  assert.equal(full.description, "All 8 hidden features, no spoilers.");
  assert.equal(full.outro.narration, "Those are all 8 features. Bank first.");
  assert.equal(full.outro.on_screen, "These 8 tricks");
  assert.equal(full.thumb_words, "8 SECRETS");
  assert.deepEqual(kindOf("hidden-features")!.items, [7, 15]);
});

test("the proof never waits for the owner's footage: the sandbox switches the capture hold off", async () => {
  const { gtaGuideProofEnv } = await import("../src/tools/gtaguide-proofenv.ts");
  const { captureHold } = await import("../src/capture.ts");
  const env = gtaGuideProofEnv({ data: "/tmp/d", backup: "/tmp/b" });
  assert.equal(env.CAPTURE_CHECKLIST, "false");
  assert.equal(env.DRY_RUN, "true");
  assert.equal(env.DATABASE_URL, "");
  assert.equal(env.AUTO_PUBLISH, "false");
  const was = process.env.CAPTURE_CHECKLIST;
  process.env.CAPTURE_CHECKLIST = env.CAPTURE_CHECKLIST;
  try {
    const cfg = loadConfig();
    assert.equal(cfg.captureChecklist, false);
    const s = {
      cfg,
      db: { query: async () => [{ remade: false, listed: true }] },
      notify: async () => true,
      now: () => NOW,
    } as never;
    const ep = {
      id: "ep_x",
      lane: "longform",
      script_json: guideToScript(draft(12), wish),
      publish_at: null,
      slot_at: new Date(NOW.getTime() + 30 * 3600_000),
    } as never;
    assert.equal(await captureHold(s, ep), undefined);
  } finally {
    if (was === undefined) delete process.env.CAPTURE_CHECKLIST;
    else process.env.CAPTURE_CHECKLIST = was;
  }
});

test("the gates leave ordinary guide lines alone (the review's false positives)", () => {
  const hidden = kindOf("hidden-features")!;
  const money = kindOf("early-money")!;
  // The baseline draft passes the count, number and ranking checks: its outro names "two things" and "two habits".
  const base = guideProblems(draft(12), { kind: wish, evidence: [] });
  assert.ok(!has(base, /items; the list has|says it is number|ranking talk|em dash/), base.join("\n"));
  assert.deepEqual(countsSaid(draft().outro.narration), []);
  for (const t of [
    "The two items that matter most are the bank and the car wash.",
    "This one is the first of these things.",
    "The first three tips matter most.",
    "You'll find 3 more tricks later.",
    "Watch 10 seconds of tips.",
    "Grand Theft Auto 6 features a phone.",
    "Just remember these two things tonight.",
    "Do all three of these things.",
  ])
    assert.deepEqual(countsSaid(t), [], t);
  assert.deepEqual(countsSaid("These 12 GTA 6 features"), [12]);
  // Ranking talk only where it ranks.
  assert.doesNotMatch("Your wanted meter sits just below the minimap.", RANKING_TALK);
  assert.doesNotMatch("Make the bank app top of your list on day one.", RANKING_TALK);
  // "Your number one job" on item 3 is not a number clash; "Number 11" on item 2 is.
  const d = draft(12);
  d.items[2] = item(3, { narration: "Your number one job after a heist is to lose the car. Park it somewhere quiet. Walk away. Change clothes. Then go home." });
  assert.ok(!has(guideProblems(d, { kind: wish, evidence: [] }), /says it is number/));
  d.items[2] = item(3, { narration: "Tip eleven is the car wash. Park it somewhere quiet. Walk away. Change clothes. Then go home." });
  assert.ok(has(guideProblems(d, { kind: wish, evidence: [] }), /says it is number 11/));
  d.items[2] = item(3, { narration: "[curious] Number 9 is the car wash. Park it somewhere quiet. Walk away. Change clothes. Then go home." });
  assert.ok(has(guideProblems(d, { kind: wish, evidence: [] }), /says it is number 9/));
  // Money and real things in the game are not hardware or footage credits.
  assert.deepEqual(
    itemQualityProblems({ title: "Run the dock job twice a day", how: "Take the dock job from the phone", payoff: "Each run pays about $4K" }, money),
    [],
  );
  assert.deepEqual(
    itemQualityProblems({ title: "Duck into a car wash", how: "Drive through any car wash while wanted", payoff: "Cool down your wanted level twice as fast" }, hidden),
    [],
  );
  assert.equal(guideGraphicKept({ kind: "stat", primary: "$1,200", secondary: "Extended clip" }, "The extended clip costs $1,200."), true);
  assert.equal(guideGraphicKept({ kind: "stat", primary: "3 cameras", secondary: "CCTV footage" }, "Three cameras watch the till."), true);
  assert.equal(guideGraphicKept({ kind: "stat", primary: "Jet ski", secondary: "On my stream" }, "I rode one."), false);
});

test("a plan too thin for the bar stops before any item is paid for, and source talk goes back", async () => {
  const sites: string[] = [];
  const llm: Llm = {
    async structured(o) {
      sites.push(o.site ?? "?");
      return {
        intro: { narration: "Never leave your car running on the hard shoulder.", on_screen: "x" },
        items: Array.from({ length: 3 }, (_, i) => ({
          number: i + 1,
          title: i === 0 ? "Never leave your car running" : "Look for alligators",
          label: "confirmed",
          basis: "fact pack",
          chip: "Do it",
          how: "Turn the engine off first",
          payoff: i === 0 ? "Nobody drives off with your car" : "Wildlife up close",
          notes: "",
        })),
        outro: { narration: "x", on_screen: "x" },
        thumb_words: "DON'T STOP",
        description: "The recordings provide no reproducible escape methods.",
        tags: [],
      } as never;
    },
  };
  await assert.rejects(
    writeGtaGuide(
      llm,
      { kind: kindOf("hidden-features")!, facts: { confirmed: "c", reported: "" }, evidence: [], asks: [], rumours: [] },
      [],
      {},
      (plan) => guidePlanProblems(plan, kindOf("hidden-features")!, []),
    ),
    /only 1 planned item meet the bar \(7 needed\)/,
  );
  assert.deepEqual(sites, ["gtaguide.plan", "gtaguide.plan"]);
  assert.ok(
    has(
      guidePlanProblems(
        { intro: { narration: "x" }, description: "The recordings provide no reproducible escape methods.", items: [] },
        wish,
        [],
      ),
      /talks about the sources/,
    ),
  );
  const d = draft(12);
  d.description = "The fact pack lacks detail.";
  assert.ok(has(guideProblems(d, { kind: wish, evidence: [] }), /talks about the sources/));
  assert.doesNotMatch("Your phone's map shows every shop you can walk into.", META_TALK);
  // Game talk in item narration is never source talk.
  for (const line of [
    "Burn the clothes, and the evidence doesn't lead back to you.",
    "The recording doesn't save if you're busted.",
    "The mission brief gives no time limit.",
    "There's no usable cover on the bridge.",
  ]) {
    const g = draft(12);
    g.items[3] = item(4, { narration: `Number 4 is the bridge. ${line} Park it somewhere quiet. Walk away. Then go home.` });
    assert.ok(!has(guideProblems(g, { kind: wish, evidence: [] }), /talks about the sources/), line);
  }
});

test("a kind that failed as too thin stays out for a week; an ordinary failure for two days", async () => {
  for (const [error, blocked] of [
    ['GTA guide "which-edition": only 2 planned items meet the bar (6 needed); the fact pack and play evidence are too thin for this kind', true],
    ["fact-check still failing after a rewrite", false],
  ] as const) {
    const { db, s } = await rig({ gtaGuides: true, gtaGuideShare: 1 });
    const first = await maybeSelectLongform(s);
    assert.ok(first);
    const [a] = await db.query<{ k: string }>(`SELECT factcheck_json->'gta_guide'->>'kind' AS k FROM episodes WHERE id = $1`, [first]);
    // Failed three days ago for another slot.
    await db.query(
      `UPDATE episodes SET status = 'failed', story_hash = story_hash || ':old', last_error = $2, slot_at = $3::timestamptz - interval '3 days',
         created_at = $3::timestamptz - interval '3 days' WHERE id = $1`,
      [first, error, s.now()],
    );
    const second = await maybeSelectLongform(s);
    assert.ok(second && second !== first);
    const [b] = await db.query<{ k: string | null }>(`SELECT factcheck_json->'gta_guide'->>'kind' AS k FROM episodes WHERE id = $1`, [second]);
    assert.ok(b!.k, "the slot stays a guide");
    if (blocked) assert.notEqual(b!.k, a!.k, error);
    else assert.equal(b!.k, a!.k, error);
    await db.close();
  }
});
