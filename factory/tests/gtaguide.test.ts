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
            narration: `${first} That is the first of twelve.`,
            on_screen: "Start right",
          },
          items: Array.from({ length: 12 }, (_, i) => ({
            number: i + 1,
            title: i === 0 ? "Never leave your car running" : `Tip ${i + 1}`,
            label: "confirmed",
            basis: "fact pack",
            chip: "Do it",
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
        ...String(o.content).matchAll(/Write items ([\d, ]+)\./g),
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
