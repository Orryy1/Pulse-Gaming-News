// VERSUS_LONG (src/versus.ts): the share of long slots, the pair picker, the chapter shape (old game, new game, what it
// means), the bar for a chapter, the title and question, the fact pack's baselines, the writer, the text-free split
// thumbnail and its rule, the packaging, the A/B verdict and the long lane with the setting off and on.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type React from "react";
import {
  DEFAULT_GUIDE_FACTS,
  GUIDE_KINDS,
  GUIDE_QUERIES,
  VERSUS_KINDS,
  kindOf,
  kindSections,
  pickGuideTopic,
  readFactPack,
  type GuideDraft,
  type GuideItem,
} from "../src/gtaguide.ts";
import {
  NEW_GAME,
  VERSUS_TITLES,
  keyArtCandidates,
  oldMoment,
  pickVersusKind,
  qaGameTitle,
  versusClipKept,
  versusItemProblems,
  versusPlanProblems,
  versusProblems,
  versusQuestion,
  versusSlot,
  versusThumb,
  versusTitleFor,
  versusToScript,
  versusVerdict,
} from "../src/versus.ts";
import {
  GuideTooThinError,
  VERSUS_BATCH,
  writeVersus,
} from "../src/editorial/gtaguidewriter.ts";
import { titleShapeProblems } from "../src/editorial/titleshape.ts";
import {
  designProblems,
  layoutProblem,
  panelCount,
  thumbWordProblems,
} from "../src/qa/thumbrule.ts";
import {
  keywordLead,
  pinnedComment,
  thumbTitle,
} from "../src/editorial/seo.ts";
import { gtaGuideProofEnv } from "../src/tools/gtaguide-proofenv.ts";
import { thumbFiles } from "../src/render/macrender.ts";
import { Thumb } from "../src/render/Brand.tsx";
import { VersusSplitThumb } from "../src/render/ThumbStudio.tsx";
import { maybeSelectLongform, type Services } from "../src/pipeline.ts";
import type { Llm } from "../src/editorial/llm.ts";
import { sentencesOf } from "../src/editorial/longform.ts";
import { testDb, tmpDir, testConfig } from "./helpers.ts";

const gta5 = kindOf("vs-gta5")!;
const rdr2 = kindOf("vs-rdr2")!;
const NOW = new Date("2026-11-27T12:00:00Z");
const has = (ps: string[], re: RegExp) => ps.some((p) => re.test(p));

const moment = (show: string, game: "old" | "new" = "new") => ({
  show,
  keywords: ["Grand Theft Auto VI"],
  graphic: { kind: "none" as const, primary: "", secondary: "", items: [] },
  emphasis: "",
  person: "",
  game,
});

function chapter(n: number, over: Partial<GuideItem> = {}): GuideItem {
  const narration =
    over.narration ??
    `Back in GTA 5, Trevor could carry a minigun in his pocket with nobody asking where it went. GTA 6 keeps a small loadout on you and the rest in the boot of your car. You swap guns at the boot or at the safehouse locker. So the car you park matters far more than it used to. Leave it somewhere silly and your rifle is a long walk away. Plan the job around where the car sits.`;
  const said = sentencesOf(narration);
  return {
    number: n,
    title: over.title ?? `Weapons carried, part ${n}`,
    label: "confirmed",
    basis: "fact pack",
    chip: "Pack light",
    then: "Every gun on you at once",
    how: "A small loadout, the rest in the boot",
    payoff: "Plan where you park before a job",
    narration,
    footage: { want: "gameplay", keywords: ["Vice City"] },
    claims: [
      {
        claim: "GTA 6 keeps a small loadout",
        label: "confirmed",
        source: "fact pack",
      },
    ],
    moments: said.map((s, k) => moment(s, k === 0 ? "old" : "new")),
    ...over,
  };
}

function draft(n = 16, over: Partial<GuideDraft> = {}): GuideDraft {
  return {
    kind: "vs-gta5",
    intro: {
      narration:
        "In GTA 5 you carried every gun at once, and in GTA 6 your weapons carried part one lives in the boot. Fuel, stolen cars and the police all changed too. There are sixteen changes here and no story spoilers.",
      on_screen: "Then versus now",
    },
    items: Array.from({ length: n }, (_, i) => chapter(i + 1)),
    outro: {
      narration:
        "GTA 5 asked how much you could get away with, and GTA 6 asks what you leave behind. The boot full of guns, the fuel gauge and the shirt a witness remembers all point the same way. Some of it will feel like homework on a bad night. But the chaos is still there, it just sends you a bill now. One GTA 6 system goes back to the GTA 5 way, which one?",
      on_screen: "The chaos sends a bill",
    },
    thumb_words: "",
    description: "Every system GTA 6 changed from GTA 5, compared.",
    tags: [],
    question:
      "If one GTA 6 system went back to the way GTA 5 did it, which would you pick?",
    ...over,
  };
}

// ---- The share of long slots and the pair -------------------------------------------------------------------------------

test("the share: off or zero never, a full share always, a half share decided per slot and stable", () => {
  const slot = new Date("2026-11-28T17:00:00Z");
  assert.equal(versusSlot({ versusLong: false, versusShare: 1 }, slot), false);
  assert.equal(versusSlot({ versusLong: true, versusShare: 0 }, slot), false);
  assert.equal(versusSlot({ versusLong: true, versusShare: 1 }, slot), true);
  const days = Array.from(
    { length: 400 },
    (_, i) => new Date(Date.UTC(2026, 10, 20 + i, 17)),
  );
  const on = days.filter((d) =>
    versusSlot({ versusLong: true, versusShare: 0.5 }, d),
  ).length;
  assert.ok(on > 150 && on < 250, `${on} of 400`);
  for (const d of days.slice(0, 20))
    assert.equal(
      versusSlot({ versusLong: true, versusShare: 0.5 }, d),
      versusSlot({ versusLong: true, versusShare: 0.5 }, d),
    );
});

test("the pair picker: none before launch, GTA 5 first, then Red Dead 2, none when both were made in 30 days", () => {
  assert.equal(pickVersusKind([], new Date("2026-11-10T00:00:00Z")), undefined);
  assert.equal(pickVersusKind([], NOW)!.key, "vs-gta5");
  assert.equal(
    pickVersusKind([{ kind: "vs-gta5", at: "2026-11-26T00:00:00Z" }], NOW)!.key,
    "vs-rdr2",
  );
  assert.equal(
    pickVersusKind([{ kind: "vs-gta5", at: "2026-10-01T00:00:00Z" }], NOW)!.key,
    "vs-gta5",
  );
  assert.equal(
    pickVersusKind(
      [
        { kind: "vs-gta5", at: "2026-11-26T00:00:00Z" },
        { kind: "vs-rdr2", at: "2026-11-25T00:00:00Z" },
      ],
      NOW,
    ),
    undefined,
  );
});

test("versus kinds stay out of the guide's picker, its searches and its list, but resolve by key", () => {
  for (const k of VERSUS_KINDS) {
    assert.ok(k.versus, k.key);
    assert.ok(!GUIDE_KINDS.includes(k), k.key);
    assert.equal(kindOf(k.key), k);
    assert.ok(!GUIDE_QUERIES.includes(k.queries[0]!), k.key);
    assert.ok(k.items[0] >= 15 && k.items[1] <= 30, k.key);
  }
  const all = GUIDE_KINDS.map((k) => ({
    kind: k.key,
    at: "2026-11-26T00:00:00Z",
  }));
  assert.equal(
    pickGuideTopic({ now: NOW, made: all, demand: new Map(), asks: [] }),
    undefined,
  );
  assert.equal(kindOf("vs-nothing"), undefined);
});

// ---- The fact pack ----------------------------------------------------------------------------------------------------

test("the fact pack: a versus reads every guide section and its own baseline only; a guide never reads a baseline", () => {
  const vs = readFactPack(DEFAULT_GUIDE_FACTS, "vs-gta5");
  assert.equal(vs.missed.length, 0);
  assert.match(vs.confirmed, /GTA 5 baseline/);
  assert.match(vs.confirmed, /What changed from GTA 5/);
  assert.match(vs.confirmed, /Hidden features/);
  assert.match(vs.confirmed, /five stars at most/);
  assert.doesNotMatch(vs.confirmed, /Red Dead Redemption 2 baseline/);
  const rd = readFactPack(DEFAULT_GUIDE_FACTS, "vs-rdr2");
  assert.match(rd.confirmed, /Red Dead Redemption 2 baseline/);
  assert.doesNotMatch(rd.confirmed, /GTA 5 baseline/);
  for (const k of GUIDE_KINDS) {
    const p = readFactPack(DEFAULT_GUIDE_FACTS, k.key);
    assert.doesNotMatch(p.confirmed, /baseline, the old game's side/, k.key);
  }
  // A key with a digit is a kind key too (the baselines are "(vs-gta5)").
  assert.equal(
    kindSections(
      "## Confirmed\n### A (vs-gta5)\n- a\n### B (vs-rdr2)\n- b\n### C (mistakes)\n- c",
      "vs-gta5",
    ),
    "## Confirmed\n### A (vs-gta5)\n- a\n### C (mistakes)\n- c",
  );
  for (const f of DEFAULT_GUIDE_FACTS)
    assert.doesNotMatch(fs.readFileSync(f, "utf8"), /—/, path.basename(f));
});

// ---- Packaging --------------------------------------------------------------------------------------------------------

test("titles: varied per episode, the count and both games, under 70 characters, never GTAbites' own words", () => {
  for (const k of VERSUS_KINDS) {
    const shapes = VERSUS_TITLES[k.key]!;
    assert.ok(shapes.length >= 3, k.key);
    for (const shape of shapes) {
      const t = shape(22);
      assert.match(t, /22/);
      assert.match(t, /GTA 6/);
      assert.match(t, new RegExp(k.versus!.oldShort));
      assert.ok(t.length <= 70, `${t} (${t.length})`);
      assert.deepEqual(titleShapeProblems(t), [], t);
      assert.doesNotMatch(t, /never imagined|more red dead 2 than you think/i);
    }
  }
  const seen = new Set(
    Array.from({ length: 40 }, (_, i) =>
      versusTitleFor(gta5, 18, `opening ${i}`),
    ),
  );
  assert.ok(seen.size >= 3, [...seen].join(" | "));
  assert.equal(
    versusTitleFor(gta5, 18, "same"),
    versusTitleFor(gta5, 18, "same"),
  );
});

test("the comment question: the writer's when it is one sharp question, the pair's otherwise", () => {
  const good =
    "If one GTA 6 system went back to the way GTA 5 did it, which would you pick?";
  assert.equal(versusQuestion(good, gta5), good);
  assert.equal(
    versusQuestion(
      "Let me know in the comments which system you would cut?",
      gta5,
    ),
    gta5.question,
  );
  assert.equal(versusQuestion("Which one? And why?", gta5), gta5.question);
  assert.equal(
    versusQuestion("Tell me your favourite system from GTA 6", gta5),
    gta5.question,
  );
  assert.equal(
    versusQuestion(
      "Fuel — or the weapon limit, which goes first for you?",
      gta5,
    ),
    gta5.question,
  );
  assert.equal(versusQuestion(undefined, rdr2), rdr2.question);
  for (const k of VERSUS_KINDS)
    assert.equal(versusQuestion(k.question, k), k.question);
});

// ---- The bar for a chapter --------------------------------------------------------------------------------------------

test("a chapter needs both sides and what it means; a console feature, scenery or no change is thin", () => {
  const ok = {
    title: "Cars need fuel",
    then: "GTA 5 cars never ran dry",
    how: "GTA 6 cars burn fuel and can strand you",
    payoff: "Fill up before a chase or you're stranded",
  };
  assert.deepEqual(versusItemProblems(ok, gta5), []);
  assert.ok(
    has(versusItemProblems({ ...ok, then: "" }, gta5), /what GTA 5 did/),
  );
  assert.ok(
    has(versusItemProblems({ ...ok, how: "x" }, gta5), /what GTA 6 does now/),
  );
  assert.ok(
    has(versusItemProblems({ ...ok, payoff: "" }, gta5), /what it means/),
  );
  assert.ok(
    has(versusItemProblems({ ...ok, payoff: "It's fun to do" }, gta5), /mood/),
  );
  assert.ok(
    has(
      versusItemProblems(
        {
          title: "Frame rate",
          then: "GTA 5 ran at 60 fps on PS5",
          how: "GTA 6 targets 30 fps",
          payoff: "Smoother play in the old game",
        },
        gta5,
      ),
      /console/,
    ),
  );
  assert.ok(
    has(
      versusItemProblems(
        {
          title: "Look at the sunsets",
          then: "GTA 5 had short sunsets",
          how: "GTA 6 has long sunsets",
          payoff: "A nice touch",
        },
        gta5,
      ),
      /scenery|mood/,
    ),
  );
  assert.ok(
    has(
      versusItemProblems(
        {
          title: "Stars",
          then: "five wanted stars police chase",
          how: "five wanted stars police chase",
          payoff: "Lose the cops the same way",
        },
        gta5,
      ),
      /same thing/,
    ),
  );
});

test("the plan goes back when the first line misses either game, a chapter is thin, or the question is not one", () => {
  const plan = {
    intro: {
      narration:
        "In GTA 5 every car ran forever, but GTA 6 cars need fuel. More follows.",
    },
    question:
      "If one GTA 6 system went back to the GTA 5 way, which would you pick?",
    items: Array.from({ length: 16 }, (_, i) => ({
      title: i === 0 ? "Cars need fuel" : `System ${i + 1} changed`,
      then: "GTA 5 did it the simple way",
      how: "GTA 6 adds a real cost to it now",
      payoff: "Plan ahead or lose money on the job",
      basis: "fact pack",
    })),
  };
  assert.deepEqual(versusPlanProblems(plan, gta5, []), []);
  assert.ok(
    has(
      versusPlanProblems(
        { ...plan, intro: { narration: "Cars need fuel now. More follows." } },
        gta5,
        [],
      ),
      /name both games/,
    ),
  );
  assert.ok(
    has(
      versusPlanProblems({ ...plan, question: "Thoughts" }, gta5, []),
      /comment question/,
    ),
  );
  assert.ok(
    has(
      versusPlanProblems({ ...plan, items: plan.items.slice(0, 10) }, gta5, []),
      /10 chapters/,
    ),
  );
  const mine = {
    ...plan,
    items: plan.items.map((x, i) =>
      i === 3 ? { ...x, basis: "my playthrough" } : x,
    ),
  };
  assert.ok(has(versusPlanProblems(mine, gta5, []), /no play evidence/));
  assert.ok(
    !has(
      versusPlanProblems(mine, gta5, ["My stream shows me driving"]),
      /no play evidence/,
    ),
  );
});

// ---- The chapter shape ------------------------------------------------------------------------------------------------

test("every chapter names the old game aloud and shows both games; the verdict weighs both", () => {
  const ok = versusProblems(draft(), { kind: gta5, evidence: [] });
  for (const re of [
    /never says what GTA 5 did/,
    /shows no GTA 5 footage/,
    /shows no GTA 6 footage/,
    /name both games/,
    /verdict must weigh/,
    /chapters; a versus/,
  ])
    assert.ok(!has(ok, re), `${re}: ${ok.join("\n")}`);
  const noOld = draft(16, {
    items: Array.from({ length: 16 }, (_, i) =>
      i === 2
        ? chapter(3, {
            narration:
              "GTA 6 keeps a small loadout on you. The rest sits in the boot. Park with care before a job. Your rifle is never far.",
          })
        : chapter(i + 1),
    ),
  });
  const p = versusProblems(noOld, { kind: gta5, evidence: [] });
  assert.ok(has(p, /Chapter 3 .* never says what GTA 5 did/));
  assert.ok(has(p, /Chapter 3 .* shows no GTA 5 footage/));
  const allNew = draft(16, {
    items: Array.from({ length: 16 }, (_, i) =>
      i === 4
        ? {
            ...chapter(5),
            moments: chapter(5).moments.map((m) => ({
              ...m,
              game: "new" as const,
            })),
          }
        : chapter(i + 1),
    ),
  });
  assert.ok(
    has(
      versusProblems(allNew, { kind: gta5, evidence: [] }),
      /Chapter 5 .* shows no GTA 5 footage/,
    ),
  );
  const oneSided = draft(16, {
    outro: {
      narration: draft().outro.narration.replace(/GTA 5/g, "the old days"),
      on_screen: "x",
    },
  });
  assert.ok(
    has(
      versusProblems(oneSided, { kind: gta5, evidence: [] }),
      /verdict must weigh/,
    ),
  );
  const opener = draft(16, {
    intro: {
      narration:
        "Welcome back! Weapons carried part one is our first change today, with no spoilers in sight at all.",
      on_screen: "x",
    },
  });
  const op = versusProblems(opener, { kind: gta5, evidence: [] });
  assert.ok(has(op, /name both games/) && has(op, /greeting/));
  const dash = draft();
  dash.items[0] = chapter(1, { title: "Weapons — carried" });
  assert.ok(has(versusProblems(dash, { kind: gta5, evidence: [] }), /em dash/));
  const reported = draft();
  reported.items[1] = {
    ...chapter(2),
    claims: [{ claim: "x", label: "reported", source: "fact pack" }],
  };
  assert.ok(
    has(
      versusProblems(reported, { kind: gta5, evidence: [] }),
      /Chapter 2 .* never says so aloud/,
    ),
  );
});

test("the script: a varied title, no thumbnail words, the old game and question carried, moments keep their game", () => {
  const d = draft();
  d.items[0] = chapter(1, { title: "Weapons — carried part one" });
  const sc = versusToScript(d, gta5);
  assert.ok(
    VERSUS_TITLES["vs-gta5"]!.some((f) => f(16) === sc.youtube.title),
    sc.youtube.title,
  );
  assert.equal(sc.headline, sc.youtube.title);
  assert.deepEqual(sc.gta_guide!.thumb, { big: "", small: "" });
  assert.equal(sc.youtube.thumb_text, "");
  assert.deepEqual(sc.gta_guide!.versus, { old: "Grand Theft Auto V", oldShort: "GTA 5", oldYear: 2013, steamYear: 2015 });
  assert.equal(sc.gta_guide!.question, d.question);
  assert.equal(sc.gta_guide!.list![0]!.then, "Every gun on you at once");
  assert.equal(sc.entries!.length, 16);
  const shown = [...sc.entries!].sort((a, b) => b.rank - a.rank)[0]!.moments!;
  assert.ok(oldMoment(shown[0]));
  assert.ok(!oldMoment(shown[1]));
  assert.doesNotMatch(JSON.stringify(sc), /—/);
  // Packaging: the keyword lead, the pinned question, the Test & compare designs' words.
  assert.match(keywordLead(sc), /GTA 6 vs GTA 5/);
  assert.equal(pinnedComment(sc), d.question);
  assert.equal(thumbTitle(sc), "THEN VS NOW");
  assert.deepEqual(thumbWordProblems("THEN VS NOW"), []);
  assert.match(qaGameTitle(sc), /Grand Theft Auto VI and Grand Theft Auto V/);
  assert.equal(
    qaGameTitle({ game_title: "Halo", gta_guide: undefined }),
    "Halo",
  );
  assert.ok(NEW_GAME.test("In GTA 6 the cops remember"));
});

// ---- The writer -------------------------------------------------------------------------------------------------------

function fakeLlm(sites: string[], planItems: number, thin = false): Llm {
  let plans = 0;
  return {
    async structured(o) {
      sites.push(o.site ?? "?");
      if (o.site === "versus.plan") {
        plans += 1;
        return {
          intro: {
            narration:
              plans === 1
                ? "Cars need fuel now. Lots changed."
                : "In GTA 5 cars never ran dry, but in GTA 6 cars need fuel—so watch the gauge. There are many changes.",
            on_screen: "Then and now",
          },
          items: Array.from({ length: planItems }, (_, i) => ({
            number: i + 1,
            title: i === 0 ? "Cars need fuel" : `System ${i + 1} changed`,
            label: "confirmed",
            basis: "fact pack",
            chip: "Fill up",
            then: thin ? "" : "GTA 5 did it the simple way",
            now: "GTA 6 adds a real cost to it now",
            means: "Plan ahead or lose money on the job",
            notes: "pack",
          })),
          outro: {
            narration: "GTA 5 was simple and GTA 6 sends a bill.",
            on_screen: "A bill",
          },
          question:
            "If one GTA 6 system went back to the GTA 5 way, which would you pick?",
          description: "d",
          tags: [],
        } as never;
      }
      const want = [
        ...String(o.content).matchAll(/Write chapters (\d+(?:, \d+)*)/g),
      ][0]![1]!
        .split(",")
        .map((x) => Number(x.trim()));
      return {
        items: want.map((n) => ({
          number: n,
          narration: `Back in GTA 5 chapter ${n} was simple. GTA 6 changes it. That costs you.`,
          footage: { want: "gameplay", keywords: ["Vice City"] },
          claims: [{ claim: "x", label: "confirmed", source: "fact pack" }],
          moments: [
            moment("GTA 5 street", "old"),
            moment("GTA 6 street", "new"),
          ],
        })),
      } as never;
    },
  };
}

test("the writer: the plan sent back once, chapters in batches of four, moments keep their game, no em dash", async () => {
  const sites: string[] = [];
  const brief = {
    kind: gta5,
    facts: { confirmed: "c", reported: "" },
    evidence: [],
    asks: [],
    rumours: [],
  };
  const d = await writeVersus(fakeLlm(sites, 17), brief, [], {}, (plan) =>
    versusPlanProblems(
      {
        ...plan,
        items: plan.items.map((x) => ({ ...x, how: x.now, payoff: x.means })),
      },
      gta5,
      [],
    ),
  );
  assert.equal(VERSUS_BATCH, 4);
  assert.deepEqual(sites, [
    "versus.plan",
    "versus.plan",
    ...Array(5).fill("versus.items"),
  ]);
  assert.equal(d.items.length, 17);
  assert.equal(d.items[0]!.then, "GTA 5 did it the simple way");
  assert.equal(d.items[0]!.how, "GTA 6 adds a real cost to it now");
  assert.equal(d.items[0]!.payoff, "Plan ahead or lose money on the job");
  // Two moments came back for three sentences: padded as GTA 6 footage.
  assert.deepEqual(
    d.items[0]!.moments.map((m) => m.game),
    ["old", "new", "new"],
  );
  assert.equal(
    d.question,
    "If one GTA 6 system went back to the GTA 5 way, which would you pick?",
  );
  assert.match(d.intro.narration, /^In GTA 5/);
  assert.doesNotMatch(JSON.stringify(d), /—/);
});

test("the writer stops before any chapter is paid for when too few chapters meet the bar", async () => {
  const sites: string[] = [];
  const brief = {
    kind: gta5,
    facts: { confirmed: "c", reported: "" },
    evidence: [],
    asks: [],
    rumours: [],
  };
  await assert.rejects(
    writeVersus(fakeLlm(sites, 16, true), brief),
    (e: unknown) =>
      e instanceof GuideTooThinError &&
      /too thin for this kind/.test(String((e as Error).message)),
  );
  assert.ok(!sites.includes("versus.items"));
});

test("the prompts carry the format: then, now, means, both games, a verdict, a question, never a ranking", async () => {
  const { versusPlanPrompt, versusBatchPrompt } =
    await import("../src/editorial/gtaguidewriter.ts");
  for (const k of VERSUS_KINDS) {
    const p = versusPlanPrompt(k);
    assert.match(p, /then/);
    assert.match(p, /flip side/);
    assert.match(p, /verdict/);
    assert.match(p, new RegExp(k.versus!.oldShort));
    assert.match(p, /never ranks/);
    assert.match(p, /baseline/);
    assert.match(versusBatchPrompt(k), /"old"/);
    assert.doesNotMatch(p + versusBatchPrompt(k), /—/);
  }
});

// ---- The thumbnail ----------------------------------------------------------------------------------------------------

test("the split-screen thumbnail: its own layout, allowed with no words, two pictures, both logos shipped", () => {
  const t = versusThumb({
    oldFile: "assets/versus_old.jpg",
    newFile: "assets/versus_new.jpg",
    oldLogo: "assets/gta5_logo.png",
    newLogo: "assets/gta_vi_logo.png",
  });
  assert.equal(t.layout, "vsplit");
  assert.equal(t.headline, "");
  assert.equal(layoutProblem("vsplit"), undefined);
  const script = {
    headline: "GTA 6 Can Do 18 Things GTA 5 Never Could",
    youtube: { title: "GTA 6 Can Do 18 Things GTA 5 Never Could" },
  } as never;
  assert.deepEqual(designProblems(t, script), []);
  assert.equal(panelCount(t), 2);
  // Words on a split screen are still held to the rule (an echo of the title fails).
  assert.ok(
    designProblems({ ...t, headline: "GTA 6 CAN DO" }, script).length > 0,
  );
  assert.deepEqual(
    thumbFiles([{ file: "thumb.jpg", thumb: t as never }]).sort(),
    [
      "assets/gta5_logo.png",
      "assets/gta_vi_logo.png",
      "assets/versus_new.jpg",
      "assets/versus_old.jpg",
    ],
  );
  const el = Thumb({
    layout: "vsplit",
    headline: "",
    kicker: "",
    game: "",
    imageSrc: "a.jpg",
    image2Src: "b.jpg",
    accent: "#FF6B1A",
  }) as React.ReactElement;
  assert.equal(el.type, VersusSplitThumb);
});

test("the thumbnail's pictures: official key art first, screenshots next, never a zip or a video", () => {
  const got = keyArtCandidates([
    { kind: "video", file: "videos/a.mp4", provenance: "Rockstar Games" },
    {
      kind: "still",
      file: "stills/s.jpg",
      provenance: "Steam store screenshot",
    },
    {
      kind: "still",
      file: "stills/z.zip",
      provenance: "Official Rockstar Games screenshot",
    },
    {
      kind: "still",
      file: "stills/r.jpg",
      provenance: "Official Rockstar Games screenshot",
    },
    {
      kind: "still",
      file: "stills/k.jpg",
      provenance: 'IGDB key art for "Grand Theft Auto V"',
    },
  ]).map((x) => x.file);
  assert.deepEqual(got, ["stills/k.jpg", "stills/r.jpg", "stills/s.jpg"]);
  assert.equal(versusClipKept({ luma: 30 }), false);
  assert.equal(versusClipKept({ luma: 90 }), true);
  assert.equal(versusClipKept({}), true);
});

// ---- The verdict ------------------------------------------------------------------------------------------------------

test("the verdict: waiting under six a side, pass when views and CTR both beat the rankings, fail otherwise", () => {
  const six = (arm: "versus" | "ranking", views: number, ctr?: number) =>
    Array.from({ length: 6 }, () => ({
      arm,
      views7d: views,
      ...(ctr !== undefined ? { ctr } : {}),
    }));
  assert.equal(
    versusVerdict([...six("versus", 900).slice(0, 5), ...six("ranking", 100)])
      .verdict,
    "waiting",
  );
  assert.equal(
    versusVerdict([...six("versus", 900, 0.08), ...six("ranking", 100, 0.05)])
      .verdict,
    "pass",
  );
  assert.equal(
    versusVerdict([...six("versus", 900, 0.03), ...six("ranking", 100, 0.05)])
      .verdict,
    "fail",
  );
  const v = versusVerdict([...six("versus", 900), ...six("ranking", 100)]);
  assert.equal(v.versus.n, 6);
  assert.equal(v.ranking.views, 100);
});

// ---- The long lane ----------------------------------------------------------------------------------------------------

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
  const clock = new Date("2026-11-27T12:00:00Z");
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

test("off: the long slot goes to the ranking and nothing of the versus is recorded", async () => {
  const { db, s, asked } = await rig({ versusLong: false, versusShare: 1 });
  const id = await maybeSelectLongform(s);
  assert.ok(id);
  assert.deepEqual(asked, ["longform.topic"]);
  assert.equal(
    (await db.query(`SELECT 1 FROM events WHERE kind = 'versus'`)).length,
    0,
  );
  await db.close();
});

test("on with a full share: the slot becomes the GTA 5 versus, picked without a model call, and recorded", async () => {
  const { db, s, asked } = await rig({
    versusLong: true,
    versusShare: 1,
    gtaGuides: true,
    gtaGuideShare: 1,
  });
  const id = await maybeSelectLongform(s);
  assert.ok(id);
  assert.deepEqual(asked, []);
  const [ep] = await db.query<{
    factcheck_json: { gta_guide: { kind: string } };
    lane: string;
  }>(`SELECT factcheck_json, lane FROM episodes WHERE id = $1`, [id]);
  assert.equal(ep!.lane, "longform");
  assert.equal(ep!.factcheck_json.gta_guide.kind, "vs-gta5");
  const ev = await db.query<{ detail: { arm: string; kind: string } }>(
    `SELECT detail FROM events WHERE kind = 'versus'`,
  );
  assert.deepEqual(
    ev.map((e) => [e.detail.arm, e.detail.kind]),
    [["versus", "vs-gta5"]],
  );
  // The guide's arm is not touched by a versus slot.
  assert.equal(
    (await db.query(`SELECT 1 FROM events WHERE kind = 'gta_guide'`)).length,
    0,
  );
  await db.close();
});

test("a versus that failed for a slot hands it on; the ranking that takes it is recorded in the versus's other arm", async () => {
  const { db, s, asked } = await rig({ versusLong: true, versusShare: 1 });
  const first = await maybeSelectLongform(s);
  assert.ok(first);
  await db.query(`UPDATE episodes SET status = 'failed' WHERE id = $1`, [
    first,
  ]);
  const second = await maybeSelectLongform(s);
  assert.ok(second && second !== first);
  assert.deepEqual(asked, ["longform.topic"]);
  const arms = (
    await db.query<{ detail: { arm: string } }>(
      `SELECT detail FROM events WHERE kind = 'versus' ORDER BY id`,
    )
  ).map((r) => r.detail.arm);
  assert.deepEqual(arms, ["versus", "ranking"]);
  await db.close();
});

test("the proof's sandbox turns the versus on only when asked", () => {
  const plain = gtaGuideProofEnv({ data: "d", backup: "b" });
  assert.equal(plain.VERSUS_LONG, undefined);
  const vs = gtaGuideProofEnv({ data: "d", backup: "b", versus: true });
  assert.equal(vs.VERSUS_LONG, "true");
  assert.equal(vs.VERSUS_SHARE, "1");
  assert.equal(vs.DRY_RUN, "true");
  assert.equal(vs.AUTO_PUBLISH, "false");
});

test("each line keeps only its own game's pin: GTA 6 pictures off old lines, old clips off GTA 6 lines", async () => {
  const { versusPins, oldGameFile } = await import("../src/versus.ts");
  const moments = [[moment("then", "old"), moment("now", "new")]];
  const got = versusPins(
    [
      { file: "entry_0/cut_1.mp4", beatIndex: 0, moment: 0 },
      { file: "entry_0/old/trailer_1.mp4", beatIndex: 0, moment: 0 },
      { file: "entry_0\\old\\gp_2.mp4", beatIndex: 0, moment: 1 },
      { file: "entry_0/own_3.mp4", beatIndex: 0, moment: 1 },
      { file: "entry_0/fill.mp4", beatIndex: 0 },
      { file: "entry_0/x.mp4", beatIndex: 3, moment: 0 },
    ],
    moments,
  );
  assert.deepEqual(
    got.map((c) => c.moment),
    [undefined, 0, undefined, 1, undefined, 0],
  );
  assert.equal(oldGameFile("entry_2/old/a.mp4"), true);
  assert.equal(oldGameFile("entry_2/bold/a.mp4"), false);
});

test("the versus clause reaches the thumbnail check only for a versus, and GTA V's store page is looked up by its Steam year", async () => {
  const { THUMB_HERO_PROMPT, THUMB_VERSUS_PROMPT } = await import("../src/qa/vision.ts");
  assert.doesNotMatch(THUMB_HERO_PROMPT, /versus split screen/);
  assert.match(THUMB_VERSUS_PROMPT, /split screen/);
  assert.match(qaGameTitle(versusToScript(draft(), gta5)), /\(a comparison video that shows both games\)/);
  assert.equal(gta5.versus!.steamYear, 2015);
  assert.equal(versusToScript(draft(), gta5).gta_guide!.versus!.steamYear, 2015);
});
