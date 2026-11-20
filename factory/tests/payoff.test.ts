import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OPENER_WINDOW,
  absenceAnswer,
  heldMark,
  holdMode,
  statesSide,
  teaseFillers,
  SEGMENT_OPENERS,
  PAYOFF_JUDGE_SITE,
  answerKeys,
  contentTokens,
  earlyAnswer,
  findAnswer,
  firstFrameText,
  gameAliases,
  keyPairs,
  leaksAnswer,
  openerProblems,
  payoffApplies,
  payoffArm,
  payoffArmLine,
  payoffFeedback,
  payoffFindings,
  payoffKeepNote,
  payoffLines,
  payoffReadContent,
  payoffRecord,
  payoffRule,
  pivotAt,
  premiseOnly,
  readFindings,
  readPayoff,
  sideEarly,
  spokenSentences,
  stackedIds,
  stockOpener,
  verdictLate,
  type PayoffPlan,
  type PayoffRead,
} from "../src/editorial/payoff.ts";
import {
  PAYOFF_BARRED,
  allSkeletons,
  pickSkeleton,
} from "../src/editorial/skeletons.ts";
import {
  validateScript,
  withoutQuotedQuestions,
  writeScript,
} from "../src/editorial/editorial.ts";
import { siteListed } from "../src/editorial/codex.ts";
import type { Llm } from "../src/editorial/llm.ts";
import type { Script } from "../src/editorial/schema.ts";
import { goodScript, item } from "./helpers.ts";

// A Short written the way the gate wants it: the question planted, a lean early, a turn in the middle, the answer late.
const roadsPlan: PayoffPlan = {
  angle: "why",
  question: "Why did Rockstar make GTA 6's roads narrower?",
  answer:
    "The roads are narrower to fit more people, cars and street life into each block of Vice City.",
  answer_line:
    "So the roads shrank to make room for the crowd, not to slow you down.",
  side: "a smart call",
  verdict: "a smart trade",
};

function roads(over: Partial<Script> = {}): Script {
  return goodScript({
    game_title: "Grand Theft Auto VI",
    headline: "GTA 6's Roads Are Narrower",
    hook: "Rockstar made GTA 6's roads narrower on purpose, and it's a smart call.",
    beats: [
      {
        narration:
          "Players spotted it in the second trailer: lanes in Vice City look tighter than in GTA 5's Los Santos.",
        visual: { kind: "none", primary: "", secondary: "" },
      },
      {
        narration:
          "That sounds like a downgrade for anyone who loves a high-speed chase.",
        visual: { kind: "none", primary: "", secondary: "" },
      },
      {
        narration:
          "But the trailer also shows far more parked cars, food stalls and people on every street.",
        visual: { kind: "none", primary: "", secondary: "" },
      },
    ],
    pulse_take: {
      label: "",
      narration:
        "Rockstar has said it wants the city to feel lived in, and narrow streets pack more life into every block. So the roads shrank to make room for the crowd, not to slow you down. I think that's the right trade.",
      on_screen: "Narrow roads, busier city",
    },
    loop_line: "A busier street beats an empty motorway every time.",
    youtube: {
      title: "Why Did Rockstar Narrow GTA 6's Roads?",
      description: "Why Vice City's roads are tighter.",
      tags: [],
    },
    ...over,
  }) as Script;
}

const withPlan = (s: Script, plan: PayoffPlan = roadsPlan) =>
  ({ ...s, payoff: plan }) as Script;

test("the gate covers news, breaking and Why Shorts, never a reply, a search Short or a GTA File part", () => {
  assert.equal(payoffApplies({ lane: "news" }), true);
  assert.equal(payoffApplies({ lane: "news_breaking" }), true);
  assert.equal(payoffApplies({ lane: "free", why: true }), true);
  assert.equal(
    payoffApplies({ lane: "evergreen" }),
    false,
    "rankings, deals and charts",
  );
  assert.equal(payoffApplies({ lane: "news", reply: true }), false);
  assert.equal(payoffApplies({ lane: "news", search: true }), false);
  assert.equal(
    payoffApplies({ lane: "news", why: true, gtaFile: true }),
    false,
  );
});

test("the arm is stable per episode, all or nothing at the ends, and splits about half at 0.5", () => {
  assert.equal(payoffArm("ep_1", 0), "control");
  assert.equal(payoffArm("ep_1", 1), "gate");
  assert.equal(payoffArm("ep_x", 0.5), payoffArm("ep_x", 0.5));
  const gates = Array.from({ length: 400 }, (_, i) =>
    payoffArm(`ep_${i}`, 0.5),
  ).filter((a) => a === "gate").length;
  assert.ok(gates > 150 && gates < 250, `about half, got ${gates}`);
});

test("words are stemmed and counted the way the answer and the title are compared", () => {
  assert.deepEqual(contentTokens("The remake cuts fast travel for $99.99!"), [
    "remake",
    "cut",
    "fast",
    "travel",
    "$99.99",
  ]);
  const keys = answerKeys(roadsPlan, "Grand Theft Auto VI");
  assert.ok(keys.includes("people") && keys.includes("block"));
  assert.ok(
    !keys.includes("road") && !keys.includes("narrower"),
    "the question's words are premise",
  );
});

test("an answer leaks by a key pair, a number or half its keys; the premise does not", () => {
  const plan = {
    question: "Is the Starfield expansion delay a bad sign?",
    answer:
      "No, Bethesda's delays usually mean better content, so it is not a red flag.",
  };
  const keys = answerKeys(plan, "Starfield");
  assert.deepEqual(keyPairs(plan.answer, keys).includes("red flag"), true);
  assert.equal(
    leaksAnswer("Starfield's Delay Is No Red Flag", keys, plan.answer),
    true,
  );
  assert.equal(
    leaksAnswer("Starfield's Expansion Slips To 2027", keys, plan.answer),
    false,
  );
  const price = answerKeys({
    question: "What does the GTA 6 deluxe edition add?",
    answer: "It costs $99.99 for a cosmetic pack.",
  });
  assert.equal(
    leaksAnswer("GTA 6's $99.99 Edition", price),
    true,
    "an answer-only figure",
  );
  // A name in the answer is premise material: "Vice City" alone is no leak.
  assert.equal(
    leaksAnswer(
      "Vice City's roads look tighter",
      answerKeys(roadsPlan, "Grand Theft Auto VI"),
      roadsPlan.answer,
    ),
    false,
  );
});

test("the game's fan names are subject, never answer", () => {
  const a = gameAliases("Grand Theft Auto VI");
  assert.ok(a.has("gta") && a.has("6") && a.has("grand"));
  const keys = answerKeys({ question: "Why patch again?", answer: "GTA 6 won't boot without the new firmware." }, "Grand Theft Auto VI");
  assert.ok(!keys.includes("gta") && !keys.includes("6"));
});

test("spoken sentences carry their word positions across lines", () => {
  const { sentences, total } = spokenSentences([
    "One two three.",
    "Four five. Six seven eight.",
  ]);
  assert.equal(total, 8);
  assert.deepEqual(
    sentences.map((s) => [s.start, s.words]),
    [
      [0, 3],
      [3, 2],
      [5, 3],
    ],
  );
});

test("the answer is found by its copied line, or by overlap, and its position is measured", () => {
  const lines = payoffLines(roads());
  const found = findAnswer(lines, roadsPlan, "Grand Theft Auto VI");
  assert.equal(found?.how, "line");
  assert.ok(found!.at >= 0.6, `answer at ${found!.at}`);
  const overlap = findAnswer(
    lines,
    {
      ...roadsPlan,
      answer: "Narrow streets pack more life into every block.",
      answer_line: "",
    },
    "Grand Theft Auto VI",
  );
  assert.equal(overlap?.how, "overlap", "found by the keys when the line isn't copied");
  assert.equal(findAnswer(["Nothing to see here."], roadsPlan), undefined);
});

test("a sentence before 60% that already carries the answer is caught", () => {
  const lines = [
    "Rockstar narrowed GTA 6's roads.",
    "They did it to fit more people, cars and street life into each block of Vice City.",
    "Fans noticed in the trailer and argued about it for days on end online.",
    "Some liked it and some did not, and the debate rolled on and on and on.",
  ];
  assert.ok(earlyAnswer(lines, roadsPlan, "Grand Theft Auto VI"));
  assert.equal(
    earlyAnswer(payoffLines(roads()), roadsPlan, "Grand Theft Auto VI"),
    undefined,
  );
});

test("the turn must sit in the middle third", () => {
  assert.ok(pivotAt(payoffLines(roads())) !== undefined);
  const early = [
    "But this starts with a turn.",
    ...Array(10).fill("Then plain words follow here for a while."),
  ];
  assert.equal(
    pivotAt(early),
    undefined,
    "a turn in the first third does not count",
  );
  const catchLine = [
    "Ten plain words come first in this line right here now.",
    "The catch is that the price went up again for everyone.",
    "Ten plain words come last in this line right here too.",
  ];
  assert.ok(pivotAt(catchLine) !== undefined, '"the catch" is a turn');
});

test("a side early and a verdict late are found; their absence is too", () => {
  assert.equal(sideEarly(payoffLines(roads())), true);
  assert.equal(verdictLate(payoffLines(roads())), true);
  const flat = payoffLines(goodScript());
  assert.equal(
    sideEarly(flat),
    false,
    "the plain delay Short takes no side up front",
  );
  assert.equal(
    sideEarly(
      ["GTA 6 has narrower roads.", "Rockstar says so."],
      "narrower roads Rockstar",
    ),
    true,
    "the plan's own side words count",
  );
  assert.equal(
    verdictLate(["A fact.", "Another fact.", "A third fact."]),
    false,
  );
});

test("stock take openers rotate out; stacked I'd lines are flagged", () => {
  assert.equal(stockOpener("I'd wait for a sale."), "i_d");
  assert.equal(stockOpener("My verdict: wait."), "my_verdict");
  assert.equal(stockOpener("My Pulse check? Steady."), "pulse_check");
  assert.equal(stockOpener("Rockstar has a plan."), undefined);
  assert.equal(stackedIds("I'd wait. I'd skip the edition."), 2);
  const recent = [
    "Honestly, this is",
    "I'd wait for the",
    "Rockstar knows what it",
  ];
  assert.equal(openerProblems("I'd buy it now.", recent).length, 1);
  assert.equal(openerProblems("Honestly, it's fine.", recent).length, 1);
  assert.deepEqual(
    openerProblems("I'd buy it now.", ["a", "b", "c", "I'd wait"]),
    [],
    `only the last ${OPENER_WINDOW} count`,
  );
  assert.equal(openerProblems("I'd wait. I'd skip it.", []).length, 1);
});

test("a stock frame anywhere in the take rotates; the Pulse Check's own verdict line is exempt", () => {
  const recent = ["Prices went up. My verdict: wait for a sale."];
  assert.equal(openerProblems("That is steep. My verdict: skip it.", recent).length, 1);
  assert.deepEqual(openerProblems("That is steep. My verdict: skip it.", recent, SEGMENT_OPENERS), []);
  assert.equal(openerProblems("We think it lands. Fine.", ["We'd skip it."]).length, 1, "the old desk frame counts");
});

test("a script written to the rules passes every deterministic rule", () => {
  const r = payoffFindings({ script: withPlan(roads()), planned: true });
  assert.deepEqual(r.findings, []);
  assert.ok(r.answerAt! >= 0.6 && r.pivot !== undefined);
});

test("a script that gives the answer away fails held, the leaks, the turn and the side, each with a reason", () => {
  const plan: PayoffPlan = {
    angle: "verdict",
    question: "Is the Starfield expansion delay a bad sign?",
    answer:
      "No, Bethesda's delays usually mean better content, so it is not a red flag.",
    answer_line:
      "Bethesda's delays usually mean better content, so this is not a red flag.",
    side: "not worried",
    verdict: "not a red flag",
  };
  const leaky = withPlan(
    goodScript({
      hook: "Starfield's delay is no red flag.",
      headline: "Starfield Delay No Red Flag",
      youtube: {
        title: "Starfield's Expansion Delay Is No Red Flag",
        description: "",
        tags: [],
      },
      beats: [
        {
          narration:
            "Bethesda's delays usually mean better content, so this is not a red flag.",
          visual: { kind: "none", primary: "", secondary: "" },
        },
        {
          narration:
            "The expansion was due this December and now lands in early 2027 instead.",
          visual: { kind: "none", primary: "", secondary: "" },
        },
      ],
      loop_line: "Will you wait for it?",
    }),
    plan,
  );
  const rules = payoffFindings({ script: leaky, planned: true }).findings.map(
    (f) => f.rule,
  );
  for (const r of [
    "held",
    "leak_hook",
    "leak_headline",
    "leak_title",
    "pivot",
    "ending",
  ])
    assert.ok(
      rules.includes(r as never),
      `expected ${r} in ${rules.join(", ")}`,
    );
  // SHORT_END_PAYOFF already checks the ending: left out of the writer's reasons then.
  const noEnding = payoffFindings({
    script: leaky,
    planned: true,
    endingChecked: true,
  }).findings;
  assert.ok(!noEnding.some((f) => f.rule === "ending"));
  // Every reason reaches the writer marked as the gate's.
  assert.ok(
    payoffFeedback(noEnding).every((p) => p.startsWith("Held answer: ")),
  );
});

test("no plan is a finding in the gate's arm; the control arm is measured only on the plan-free rules", () => {
  const gate = payoffFindings({ script: roads(), planned: true }).findings;
  assert.equal(gate[0]?.rule, "plan");
  const control = payoffFindings({ script: roads(), planned: false }).findings;
  assert.deepEqual(control, []);
});

test("the cold read sees only title, first-frame text and hook, then the plan; its findings say why", async () => {
  const calls: Array<{ site?: string; content: string; tier?: string }> = [];
  const llm = {
    structured: async (req: {
      site?: string;
      content: string;
      tier?: string;
    }) => {
      calls.push(req);
      return {
        about: "Why GTA 6's roads are narrower.",
        about_clear: true,
        answer_guess: "",
        gives_answer: false,
      } satisfies PayoffRead;
    },
  } as unknown as Llm;
  const s = withPlan(roads());
  const r = await readPayoff(llm, {
    title: s.youtube.title,
    firstFrame: firstFrameText(s),
    hook: s.hook,
    question: roadsPlan.question,
    answer: roadsPlan.answer,
  });
  assert.equal(calls[0]!.site, PAYOFF_JUDGE_SITE);
  assert.equal(calls[0]!.tier, "mid");
  assert.ok(calls[0]!.content.includes(s.hook));
  assert.ok(
    !calls[0]!.content.includes(s.beats[0]!.narration),
    "no beat reaches the cold reader",
  );
  assert.ok(
    calls[0]!.content.indexOf("Answer:") >
      calls[0]!.content.indexOf("FIRST LINE"),
    "the plan comes last",
  );
  assert.deepEqual(readFindings(r), []);
  assert.equal(
    readFindings({
      about: "?",
      about_clear: false,
      answer_guess: "it is fine",
      gives_answer: true,
    }).length,
    2,
  );
  assert.equal(
    siteListed(PAYOFF_JUDGE_SITE, ["payoff"]),
    true,
    "CODEX_CALLS=payoff routes the read",
  );
  assert.match(
    payoffReadContent({
      title: "T",
      firstFrame: "",
      hook: "H",
      question: "Q",
      answer: "A",
    }),
    /FIRST-FRAME TEXT: \(none\)/,
  );
});

test("the record passes only when every rule and the cold read held", () => {
  const ok = payoffRecord({
    arm: "gate",
    mode: "check",
    findings: [],
    answerAt: 0.74,
    pivot: 0.41,
  });
  assert.equal(ok.pass, true);
  assert.equal(ok.answer_at, 0.74);
  const read = payoffRecord({
    arm: "gate",
    mode: "fix",
    findings: [],
    read: {
      about: "x",
      about_clear: true,
      answer_guess: "y",
      gives_answer: true,
    },
    sentBack: ["Held answer: something"],
  });
  assert.equal(read.pass, false);
  assert.equal(read.findings[0]!.rule, "read");
  assert.deepEqual(read.sent_back, ["Held answer: something"]);
});

test("packaging keeps a gated title premise-only; other scripts are untouched", () => {
  const gated = { ...withPlan(roads()), payoff_gate: { arm: "gate" as const } };
  assert.equal(
    premiseOnly("Why Did Rockstar Narrow GTA 6's Roads?", gated),
    true,
  );
  assert.equal(
    premiseOnly("GTA 6's Roads Shrank To Fit More People And Cars", gated),
    false,
  );
  assert.equal(
    premiseOnly(
      "GTA 6's Roads Shrank To Fit More People And Cars",
      withPlan(roads()),
    ),
    true,
    "no arm, no filter",
  );
});

test("the weekly line compares the arms; nothing when no Short carried one", () => {
  assert.equal(payoffArmLine([]), undefined);
  const line = payoffArmLine([
    { arm: "gate", pass: true, views: 1000, viewed_pct: 60, comments: 2 },
    { arm: "control", pass: false, views: 500, viewed_pct: 50, comments: 0 },
  ])!;
  assert.match(
    line,
    /gate 1 Shorts \(1 passed every rule\), average viewed 60\.0%, comments per 1,000 views 2\.00/,
  );
  assert.match(line, /control 1 Shorts/);
});

test("in the gate's arm the structures never give the call first or end on an ask; a drop keeps an order", () => {
  const all = allSkeletons({
    questionEndings: true,
    argument: false,
    payoff: true,
  });
  assert.ok(all.length > 0);
  assert.ok(all.every((s) => !PAYOFF_BARRED.orders.includes(s.order.id)));
  assert.ok(all.every((s) => !PAYOFF_BARRED.endings.includes(s.ending.id)));
  const drop = allSkeletons({
    questionEndings: false,
    argument: false,
    orders: ["call_then_proof", "one_detail"],
    payoff: true,
  });
  assert.ok(drop.every((s) => s.order.id === "one_detail"));
  const onlyBarred = allSkeletons({
    questionEndings: false,
    argument: false,
    orders: ["call_then_proof"],
    payoff: true,
  });
  assert.ok(onlyBarred.length > 0, "never narrowed to nothing");
  const picked = pickSkeleton("seed", [], {
    questionEndings: false,
    argument: false,
    payoff: true,
  });
  assert.ok(!PAYOFF_BARRED.orders.includes(picked.order.id));
  // Off, nothing changes.
  assert.equal(
    allSkeletons({ questionEndings: true, argument: false }).length,
    allSkeletons({ questionEndings: true, argument: false, payoff: false })
      .length,
  );
});

test("the writer gets the held-answer rule and the plan field only in the gate's arm", async () => {
  const reqs: Array<{
    content: string;
    schema: { shape: Record<string, unknown> };
  }> = [];
  const llm = {
    structured: async (req: {
      content: string;
      schema: { shape: Record<string, unknown> };
    }) => {
      reqs.push(req);
      return withPlan(roads());
    },
  } as unknown as Llm;
  const cluster = {
    hash: "roads",
    items: [item("GTA 6 roads are narrower", "IGN", "outlet")],
  } as never;
  await writeScript(llm, cluster, [], { mustLabelRumour: false });
  assert.ok(!reqs[0]!.content.includes("Held answer"));
  assert.equal(
    reqs[0]!.schema.shape.payoff,
    undefined,
    "off: the schema every Short has always had",
  );
  const out = await writeScript(llm, cluster, [], {
    mustLabelRumour: false,
    payoff: true,
  });
  assert.ok(reqs[1]!.content.includes(payoffRule()));
  assert.ok(reqs[1]!.schema.shape.payoff, "the plan is asked for");
  assert.equal(
    out.payoff?.question,
    roadsPlan.question,
    "the plan survives the writer's own tidy-up",
  );
});

test("the rule and the keep note read plainly, with no em dash", () => {
  for (const t of [payoffRule(), payoffKeepNote(roadsPlan)])
    assert.ok(!t.includes("—"));
  assert.match(payoffRule(), /after 60% of the words/);
  assert.match(payoffKeepNote(roadsPlan), /must not give the answer/);
});

test("an answer that is only an absence is not held: it is recorded as absence_answer", () => {
  for (const a of [
    "Rockstar's launch post doesn't explain earnings or cash penalties.",
    "Nothing says so yet.",
    "Sony hasn't said why.",
    "It's still unconfirmed.",
    "Nobody knows yet.",
  ])
    assert.equal(absenceAnswer(a), true, a);
  assert.equal(absenceAnswer(roadsPlan.answer), false);
  const plan: PayoffPlan = {
    angle: "verdict",
    question: "Does the failed score mean you'll lose cash?",
    answer: "Nothing says so yet: Rockstar's launch post doesn't explain earnings.",
    answer_line: "Rockstar's launch post doesn't explain earnings at all.",
    side: "too early",
    verdict: "too early to worry",
  };
  const r = payoffFindings({ script: withPlan(roads(), plan), planned: true }).findings;
  assert.ok(r.some((f) => f.rule === "absence_answer"));
  assert.ok(!r.some((f) => f.rule === "held" || f.rule.startsWith("leak_")), "nothing is held");
  assert.equal(payoffRecord({ arm: "gate", mode: "check", findings: r }).pass, false);
});

test("a news angle may say the news in the hook; only the verdict is checked for leaks", () => {
  assert.equal(holdMode("why"), "reason");
  assert.equal(holdMode("verdict"), "verdict");
  assert.equal(holdMode("changes"), "verdict");
  assert.equal(holdMode("deadline"), "verdict");
  const plan: PayoffPlan = {
    angle: "verdict",
    question: "With no online at launch, is GTA 6's Ultimate Edition still worth $20 over Standard?",
    answer: "If you are buying for multiplayer, the $20 premium is poor value at launch, so keep the cash for now.",
    answer_line: "Until then, that $20 premium won't get you multiplayer, so it's poor value if friends are your reason.",
    side: "looks odd now",
    verdict: "poor value, keep the cash",
  };
  const base = goodScript({
    game_title: "Grand Theft Auto VI",
    hook: "GTA 6 launches without online, and the Ultimate Edition looks odd now.",
    headline: "GTA 6 Ultimate Buys No Multiplayer",
    youtube: { title: "GTA 6's $20 Ultimate Premium Buys No Multiplayer", description: "", tags: [] },
  });
  const rules = (p: PayoffPlan) =>
    payoffFindings({ script: withPlan(base, p), planned: true }).findings.map((f) => f.rule);
  assert.ok(!rules(plan).includes("leak_title"), "the news in the title is fine");
  assert.ok(rules({ ...plan, angle: "why" }).includes("leak_title"), "a why angle holds the whole answer");
  const leaky = { ...base, youtube: { ...base.youtube, title: "GTA 6's Ultimate Edition Is Poor Value" } };
  assert.ok(
    payoffFindings({ script: withPlan(leaky, plan), planned: true }).findings.some((f) => f.rule === "leak_title"),
    "the call itself in the title still leaks",
  );
  assert.match(payoffRule(), /hook may say the news plainly/);
  assert.match(payoffRule(), /holds the reason/);
});

test("the held mark is 55% under 90 words and 60% otherwise", () => {
  assert.equal(heldMark(80), 0.55);
  assert.equal(heldMark(89), 0.55);
  assert.equal(heldMark(90), 0.6);
  const words = (n: number) => Array(n).fill("word").join(" ") + ".";
  const plan: PayoffPlan = { ...roadsPlan, answer_line: "So the roads shrank to make room for the crowd." };
  // 46 words before the answer line, 10 in it, 24 after: 80 words, the answer at 57.5%.
  const short = goodScript({
    hook: "Rockstar made GTA 6's roads narrower, and it's a smart call.",
    beats: [
      { narration: words(18), visual: { kind: "none", primary: "", secondary: "" } },
      { narration: `But ${words(17)}`, visual: { kind: "none", primary: "", secondary: "" } },
    ],
    pulse_take: { label: "", narration: `So the roads shrank to make room for the crowd. I think ${words(12)}`, on_screen: "" },
    loop_line: words(8),
  });
  const held = (s: Script) => payoffFindings({ script: withPlan(s, plan), planned: true }).findings.filter((f) => f.rule === "held");
  assert.deepEqual(held(short), [], "57% passes in a short script");
  const long = { ...short, loop_line: words(30) };
  assert.ok(held(long).length > 0, "over 90 words the same answer is early");
});

test("a stalling line before the answer is tease filler: advisory under check, a reason under fix", () => {
  const lines = [
    "Sony's patched the PS5 twice in 11 days, right before GTA 6.",
    "But the notes leave out the part that reportedly matters most if you're buying GTA 6.",
    "But the reason he left goes back to 1996.",
    "Push Square says GTA 6 reportedly won't boot without 14.22.",
  ];
  assert.deepEqual(teaseFillers(lines, 3, 0.6, "Grand Theft Auto VI"), [lines[1]]);
  assert.deepEqual(teaseFillers(lines, 1, 0.6, "Grand Theft Auto VI"), [], "only lines before the answer");
  const tease = { rule: "tease_filler" as const, problem: "x", advisory: true };
  assert.equal(payoffRecord({ arm: "gate", mode: "check", findings: [tease] }).pass, true);
  assert.equal(payoffRecord({ arm: "gate", mode: "fix", findings: [tease] }).pass, false);
  assert.deepEqual(payoffFeedback([tease]), ["Held answer: x"], "fix sends it back with the rest");
});

test("value calls and imperative calls count as a side and a verdict", () => {
  for (const t of [
    "Keep the cash for now, it's the easy call.",
    "That's poor value if friends are your reason.",
    "One download is a fair price.",
    "Believable streets are worth giving up space.",
    "I like that.",
    "I'll take that over room to spare.",
    "Buy Standard and wait for the reviews.",
    "Don't pre-order yet.",
  ])
    assert.equal(statesSide(t), true, t);
  assert.equal(verdictLate(["A plain fact here.", "Another plain fact.", "Keep the cash for now, it's the easy call."]), true);
});

test("a quoted question may stay in the gate's arm; a narrator's own question never", () => {
  const s = goodScript();
  s.beats[1]!.narration = "Playtests lost the moments where you stop and wonder, 'Wait, what's this?' in every town.";
  const q = (o: Parameters<typeof validateScript>[3]) =>
    validateScript(s, undefined, undefined, o).filter((p) => /asks a question halfway/.test(p));
  assert.equal(q({}).length, 1, "off: as before");
  assert.equal(q({ quotedQuestionsOk: true }).length, 0);
  s.beats[1]!.narration = 'IGN asked "Will it run on PS5?" and Sony said yes.';
  assert.equal(q({ quotedQuestionsOk: true }).length, 0, "double quotes too");
  s.beats[1]!.narration = "Why trust them? Not yet.";
  assert.equal(q({ quotedQuestionsOk: true }).length, 1, "the narrator's own question still goes back");
  assert.equal(withoutQuotedQuestions("He said 'what's next?' then left."), "He said QUOTE then left.");
});
