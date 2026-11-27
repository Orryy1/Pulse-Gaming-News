import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DESK_JUDGE_SITE,
  DESK_REWRITE_SITE,
  DESK_RUBRIC,
  DeskReadSchema,
  antithesis,
  betterRead,
  clearsDesk,
  deskArm,
  deskCaps,
  deskChecks,
  deskInstruction,
  deskJudgeContent,
  deskJudgePrompt,
  deskKill,
  deskLines,
  deskLinesForReport,
  deskPlanRule,
  deskRecord,
  deskShortProblems,
  formulaEnding,
  fullNameCount,
  judgeDesk,
  parallelPair,
  repeatedFacts,
  runDesk,
  verblessThree,
  type DeskPlan,
  type DeskRead,
} from "../src/editorial/desk.ts";
import { writeScript } from "../src/editorial/editorial.ts";
import { siteListed } from "../src/editorial/codex.ts";
import { firstFrameText } from "../src/editorial/payoff.ts";
import type { Llm } from "../src/editorial/llm.ts";
import type { Script } from "../src/editorial/schema.ts";
import { spearman } from "../src/analyticsloop.ts";
import {
  checkRows,
  countFindings,
  guessGame,
} from "../src/tools/desk-proof.ts";
import { goodScript, item } from "./helpers.ts";

const read = (overall: number, rest: Partial<DeskRead> = {}): DeskRead => ({
  clarity: overall,
  hook: overall,
  payoff: overall,
  voice: overall,
  human: overall,
  overall,
  note: `weak at ${overall}`,
  ...rest,
});

const plan: DeskPlan = {
  angle:
    "The most interesting true thing is that the delay follows a pattern, and it matters to Starfield players because the last delay came back better.",
  mode: "verdict",
  kill: "none",
  kill_reason: "",
  source_gap: "",
};

// ---------------------------------------------------------------- arms, caps, rubric

test("the arm is stable per episode and follows the share", () => {
  assert.equal(deskArm("ep1", 0), "control");
  assert.equal(deskArm("ep1", 1), "desk");
  assert.equal(deskArm("abc", 0.5), deskArm("abc", 0.5));
  const n = Array.from({ length: 400 }, (_, i) =>
    deskArm(`ep${i}`, 0.5),
  ).filter((a) => a === "desk").length;
  assert.ok(n > 150 && n < 250, `about half (${n})`);
  assert.deepEqual(deskCaps(2), { judge: 3, rewrite: 2 });
  assert.deepEqual(deskCaps(9), { judge: 4, rewrite: 3 }, "at most 3 rounds");
});

test("the judge reads title, first frame and narration only, on the mid tier, with the rubric verbatim", async () => {
  const calls: Array<{
    site?: string;
    tier?: string;
    content: string;
    system: string;
    schema: unknown;
  }> = [];
  const llm = {
    structured: async (req: (typeof calls)[number]) => {
      calls.push(req);
      return read(6);
    },
  } as unknown as Llm;
  const s = { ...goodScript(), desk_plan: plan };
  await judgeDesk(llm, {
    title: s.youtube.title,
    firstFrame: firstFrameText(s),
    narration: deskLines(s),
  });
  const c = calls[0]!;
  assert.equal(c.site, DESK_JUDGE_SITE);
  assert.equal(c.tier, "mid", "not the writer's tier");
  assert.equal(c.schema, DeskReadSchema);
  assert.ok(c.content.includes(s.youtube.title));
  assert.ok(c.content.includes(s.beats[1]!.narration));
  assert.ok(!c.content.includes(plan.angle), "never the writer's plan");
  assert.ok(
    !c.content.includes("Xbox Wire / IGN"),
    "never the attribution or sources",
  );
  for (const d of Object.values(DESK_RUBRIC)) assert.ok(c.system.includes(d));
  assert.match(c.system, /5 is average for a competent channel/);
  assert.match(c.system, /full range/);
  assert.equal(
    DESK_RUBRIC.voice,
    "sounds like a real person with a view talking to a friend, natural spoken rhythm, an honest opinion, humour only where it lands, not a news desk and not a try-hard",
  );
  assert.ok(
    siteListed(DESK_JUDGE_SITE, ["desk"]) &&
      siteListed(DESK_REWRITE_SITE, ["desk"]),
    "CODEX_CALLS=desk routes both",
  );
  assert.ok(
    siteListed(DESK_REWRITE_SITE, ["desk.rewrite"]) &&
      !siteListed(DESK_JUDGE_SITE, ["desk.rewrite"]),
  );
  assert.match(
    deskJudgeContent({ title: "T", firstFrame: "", narration: ["a"] }),
    /FIRST-FRAME TEXT: \(none\)/,
  );
});

test("prompt text is British, plain and has no em dash", () => {
  for (const t of [
    deskJudgePrompt(),
    deskPlanRule(true),
    deskInstruction({ read: read(4), findings: [] }),
  ])
    assert.ok(!t.includes("—"), t.slice(0, 60));
});

test("clearing the bar needs the overall at the minimum and no dimension under 5", () => {
  assert.equal(clearsDesk(read(7)), true);
  assert.equal(clearsDesk(read(6)), false);
  assert.equal(
    clearsDesk(read(8, { hook: 4 })),
    false,
    "one weak dimension sends it back",
  );
  assert.equal(clearsDesk(read(6), 6), true);
  assert.equal(
    betterRead(read(7), read(8, { hook: 4 })),
    true,
    "clearing beats a higher overall that doesn't",
  );
  assert.equal(betterRead(read(6), read(5)), true);
  assert.equal(
    betterRead(read(5), read(5)),
    false,
    "a tie keeps the earlier version",
  );
  assert.equal(
    betterRead(read(5, { voice: 7 }), read(5)),
    true,
    "then the six together",
  );
});

// ---------------------------------------------------------------- the angle and the kill

test("the kill: the writer's own call, or a payoff that is only an absence", () => {
  assert.equal(deskKill(plan), undefined);
  assert.deepEqual(
    deskKill({ ...plan, kill: "promotion", kill_reason: "A sale list." }),
    {
      kind: "promotion",
      why: "A sale list.",
    },
  );
  assert.equal(
    deskKill({ ...plan, kill: "common_knowledge", kill_reason: "" })?.kind,
    "common_knowledge",
  );
  assert.equal(
    deskKill(undefined, { answer: "Bethesda hasn't said why yet." })?.kind,
    "absence",
  );
  assert.equal(
    deskKill(undefined, { answer: "Because the last delay came back better." }),
    undefined,
  );
});

test("off: the writer sees exactly what it saw before; on: the angle rule and the plan field", async () => {
  const reqs: Array<{
    system: string;
    content: string;
    schema: { shape: Record<string, unknown> };
  }> = [];
  const llm = {
    structured: async (req: (typeof reqs)[number]) => {
      reqs.push(req);
      return { ...goodScript(), desk_plan: plan };
    },
  } as unknown as Llm;
  const cluster = {
    hash: "delay",
    items: [item("Starfield expansion delayed", "IGN")],
  } as never;
  await writeScript(llm, cluster, [], { mustLabelRumour: false });
  await writeScript(llm, cluster, [], {
    mustLabelRumour: false,
    deskPlan: false,
  });
  assert.equal(reqs[0]!.content, reqs[1]!.content);
  assert.equal(reqs[0]!.system, reqs[1]!.system);
  assert.equal(reqs[0]!.schema.shape.desk_plan, undefined);
  assert.ok(!reqs[0]!.content.includes("Editor's desk"));
  const out = await writeScript(llm, cluster, [], {
    mustLabelRumour: false,
    deskPlan: true,
  });
  assert.ok(reqs[2]!.content.includes(deskPlanRule(false)));
  assert.ok(
    reqs[2]!.schema.shape.desk_plan,
    "the plan is asked for in the same call",
  );
  assert.equal(out.desk_plan?.angle, plan.angle);
  await writeScript(llm, cluster, [], {
    mustLabelRumour: false,
    deskPlan: true,
    payoff: true,
  });
  assert.ok(
    reqs[3]!.schema.shape.desk_plan && reqs[3]!.schema.shape.payoff,
    "both plans together",
  );
  assert.ok(reqs[3]!.content.includes(deskPlanRule(true)));
});

test("editsOnly: when the desk's edits don't land it throws instead of paying for a whole new draft", async () => {
  let calls = 0;
  const llm = {
    structured: async () => {
      calls++;
      return {
        edits: [{ find: "text that is not in the draft", replace: "x" }],
      };
    },
  } as unknown as Llm;
  const cluster = {
    hash: "delay",
    items: [item("Starfield expansion delayed", "IGN")],
  } as never;
  await assert.rejects(
    writeScript(llm, cluster, [], {
      mustLabelRumour: false,
      draft: goodScript(),
      feedback: ["Editor's desk: fix the hook."],
      editsOnly: true,
      site: DESK_REWRITE_SITE,
    }),
    /edits did not apply/,
  );
  assert.equal(calls, 1, "one call, no full redraft");
});

// ---------------------------------------------------------------- deterministic checks

test("banned lines, a question or ask last, and the Pulse Check's lines advisory while the segment is on", () => {
  const lines = [
    "Elder Scrolls 6 finally has a name.",
    "Pulse check: steady, a name but nothing to buy.",
    "My verdict: wait.",
    "Our full documentary covers the rest.",
    "Let me know what you think.",
    "Will you replay Skyrim first?",
  ];
  const f = deskChecks({ lines });
  const rules = f.map((x) => x.rule);
  assert.equal(rules.filter((r) => r === "banned_line").length, 4);
  assert.ok(rules.includes("last_line_ask"));
  const seg = deskChecks({ lines, segment: true });
  assert.equal(
    seg.filter((x) => x.rule === "banned_line" && x.advisory).length,
    2,
    "the segment's own two",
  );
  assert.ok(
    deskChecks({ lines: ["Tomorrow brings another Why, so stay."] }).some(
      (x) => x.rule === "banned_line",
    ),
  );
  assert.ok(
    !deskChecks({
      lines: ["If you subscribe, the best deal is the copy you already have."],
    }).some((x) => x.rule === "last_line_ask"),
    "a Game Pass subscription is not an ask",
  );
});

test("the full name over twice, with numerals in any form, and never for a one-word or fan-form name", () => {
  const lines = [
    "Grand Theft Auto VI is close.",
    "Grand Theft Auto six's map is huge.",
    "And Grand Theft Auto 6 keeps growing.",
  ];
  assert.equal(fullNameCount(lines, "Grand Theft Auto VI"), 3);
  assert.ok(
    deskChecks({ lines, game: "Grand Theft Auto VI" }).some(
      (x) => x.rule === "full_name",
    ),
  );
  assert.equal(
    fullNameCount(
      ["Grand Theft Auto VI, then GTA 6, then GTA."],
      "Grand Theft Auto VI",
    ),
    1,
  );
  assert.equal(
    fullNameCount(["Starfield. Starfield. Starfield."], "Starfield"),
    0,
  );
  assert.equal(fullNameCount(["GTA 6. GTA 6. GTA 6."], "GTA 6"), 0);
});

test("formula endings: a verbless list of three, a short parallel pair, a closing antithesis; a take passes", () => {
  assert.equal(verblessThree("A name, a province and no date."), true);
  assert.equal(verblessThree("It has a name, a province and no date."), false);
  assert.equal(
    parallelPair(
      "A trailer sells you the game.",
      "Twenty-seven minutes of real footage lets you judge it.",
    ),
    true,
  );
  assert.equal(
    parallelPair("Hornet gets new tricks", "your thumbs get homework."),
    true,
  );
  assert.equal(
    parallelPair(
      "Take-Two won't lose sleep.",
      "Both games pay the same company.",
    ),
    false,
  );
  assert.equal(
    parallelPair("I'd take that trade.", "I would."),
    false,
    "a first-person take is a person talking",
  );
  assert.equal(
    antithesis("That slide is Nintendo's problem, not your wallet's."),
    true,
  );
  assert.ok(
    formulaEnding(["The game is named.", "A name, a province and no date."]),
  );
  assert.ok(
    formulaEnding(["Hornet gets new tricks; your thumbs get homework."]),
  );
  assert.equal(
    formulaEnding([
      "Nintendo Life's one complaint is that Master Quest is missing.",
      "I'd take that trade.",
    ]),
    undefined,
  );
  const f = deskChecks({
    lines: [
      "Facts here.",
      "A trailer sells you the game.",
      "Footage lets you judge it.",
    ],
  });
  assert.ok(f.some((x) => x.rule === "formula_ending" && x.advisory));
});

test("a repeated fact: most of a sentence said before, or a figure back with its words; a planted question is fine", () => {
  const lines = [
    "Your Switch 2 rose fifty dollars in September to $499.",
    "Nintendo says there's no second rise planned.",
    "Remember your Switch 2 rose to $499 in September.",
  ];
  assert.deepEqual(repeatedFacts(lines), [
    "Remember your Switch 2 rose to $499 in September.",
  ]);
  assert.deepEqual(
    repeatedFacts([
      "Xbox gets the GTA 6 preload early.",
      "So why does Xbox get the preload early?",
    ]),
    [],
  );
  assert.deepEqual(
    repeatedFacts(["GTA 6 launches soon.", "GTA 6 sells well."], "GTA 6"),
    [],
    "the game's name is not a fact",
  );
});

test("the desk's fact guard lets a sentence go but not a fact arrive", () => {
  const before = goodScript();
  const cut: Script = {
    ...before,
    beats: [
      before.beats[0]!,
      {
        ...before.beats[1]!,
        narration: "That's a real slip if you were waiting on it.",
      },
    ],
  };
  assert.deepEqual(
    deskShortProblems(before, cut),
    [],
    "dropping 3+ months with its sentence is the edit working",
  );
  const added: Script = {
    ...before,
    beats: [
      before.beats[0]!,
      {
        ...before.beats[1]!,
        narration: "That's a slip of nine months, says Todd Howard.",
      },
    ],
  };
  const p = deskShortProblems(before, added);
  assert.ok(
    p.some((x) => /adds the figure/.test(x)),
    p.join(" | "),
  );
  assert.ok(
    p.some((x) => /adds the name/.test(x)),
    p.join(" | "),
  );
});

test("the instruction is one item: the note, the firm findings, the order rules, the caller's extras", () => {
  const t = deskInstruction({
    read: read(4, {
      hook: 3,
      note: 'The hook "X was announced" gives nothing away to want.',
    }),
    findings: [
      { rule: "banned_line", problem: 'Cut "let me know".' },
      { rule: "formula_ending", problem: "Formula.", advisory: true },
    ],
    min: 7,
    angle: plan.angle,
    extra: ["Keep the held answer late."],
  });
  assert.match(
    t,
    /scored this Short 4\/10 overall \(it needs 7, and clarity, hook, payoff, voice, human sit under 5\)/,
  );
  assert.match(t, /X was announced/);
  assert.match(t, /Cut "let me know"/);
  assert.ok(
    !t.includes("Formula."),
    "advice waits while something firmer is wrong",
  );
  assert.match(t, /order a listener needs them/);
  assert.match(t, /could not be pasted onto another script/);
  assert.match(t, /Keep the held answer late/);
  assert.ok(t.includes(plan.angle));
  const only = deskInstruction({
    read: read(6),
    findings: [{ rule: "formula_ending", problem: "Formula.", advisory: true }],
  });
  assert.match(
    only,
    /Formula\./,
    "the formula ending is named when nothing firmer is wrong",
  );
});

// ---------------------------------------------------------------- the loop (model mocked)

function loop(
  reads: Array<DeskRead | Error>,
  opts: { refuse?: number[]; rewriteFails?: number[] } = {},
) {
  const seen = {
    judge: 0,
    rewrite: 0,
    accept: 0,
    instructions: [] as string[],
  };
  const queue = [...reads];
  return {
    seen,
    run: (
      mode: "check" | "fix",
      extra: Partial<Parameters<typeof runDesk<string>>[0]> = {},
    ) =>
      runDesk<string>({
        value: "v0",
        mode,
        judge: async () => {
          seen.judge++;
          const r = queue.shift();
          if (!r || r instanceof Error) throw r ?? new Error("no read");
          return r;
        },
        checks: (v) =>
          v === "v0"
            ? [{ rule: "banned_line", problem: 'Cut "let me know".' }]
            : [],
        rewrite: async (v, instruction) => {
          seen.rewrite++;
          seen.instructions.push(instruction);
          if (opts.rewriteFails?.includes(seen.rewrite))
            throw new Error("edits did not apply");
          return `v${seen.rewrite}`;
        },
        accept: async () => {
          seen.accept++;
          return opts.refuse?.includes(seen.accept)
            ? ["Fact-check: unsupported"]
            : [];
        },
        ...extra,
      }),
  };
}

test("cost guard: a first read that clears means no rewrite and no second read", async () => {
  const l = loop([read(8)]);
  const r = await l.run("fix");
  assert.equal(r.stop, "cleared");
  assert.deepEqual(r.calls, { judge: 1, rewrite: 0 });
  assert.equal(r.value, "v0");
  assert.equal(l.seen.accept, 0);
});

test("check mode reads once and changes nothing, however low the score", async () => {
  const l = loop([read(2)]);
  const r = await l.run("check");
  assert.equal(r.value, "v0");
  assert.equal(r.stop, "check");
  assert.deepEqual(r.calls, { judge: 1, rewrite: 0 });
  assert.equal(r.rounds.length, 1);
  assert.deepEqual(r.rounds[0]!.findings, ["banned_line"]);
});

test("fix: rounds until it clears, the note and the findings in the one instruction", async () => {
  const l = loop([read(4), read(6), read(7)]);
  const r = await l.run("fix");
  assert.equal(r.stop, "cleared");
  assert.equal(r.value, "v2");
  assert.equal(r.kept, 2);
  assert.equal(r.cleared, true);
  assert.deepEqual(r.calls, { judge: 3, rewrite: 2 });
  assert.match(l.seen.instructions[0]!, /weak at 4/);
  assert.match(l.seen.instructions[0]!, /let me know/);
  assert.deepEqual(
    r.rounds.map((x) => x.scores?.overall),
    [4, 6, 7],
  );
});

test("fix: the best version that passed is kept, never a later worse one", async () => {
  const l = loop([read(4), read(6), read(5)]);
  const r = await l.run("fix");
  assert.equal(r.stop, "rounds");
  assert.equal(r.value, "v1", "round 1 scored 6, round 2 fell to 5");
  assert.equal(r.kept, 1);
  assert.equal(r.cleared, false);
  // Round 2 rewrote from the best version, not the worse one.
  assert.match(l.seen.instructions[1]!, /weak at 6/);
});

test("fix: stops when no score moves", async () => {
  const l = loop([read(4), read(4)]);
  const r = await l.run("fix");
  assert.equal(r.stop, "no_change");
  assert.deepEqual(r.calls, { judge: 2, rewrite: 1 });
  assert.equal(r.value, "v0", "an equal score keeps the original");
});

test("fix: a rewrite refused by the fact check is never kept and costs no read; the next round hears why", async () => {
  const l = loop([read(4), read(7)], { refuse: [1] });
  const r = await l.run("fix");
  assert.equal(r.value, "v2");
  assert.deepEqual(r.rounds[1]!.refused, ["Fact-check: unsupported"]);
  assert.equal(r.rounds[1]!.scores, undefined);
  assert.match(
    l.seen.instructions[1]!,
    /The last attempt was refused: Fact-check: unsupported/,
  );
  assert.deepEqual(r.calls, { judge: 2, rewrite: 2 });
});

test("fix: every rewrite refused leaves the original; a failed edit is a refused round", async () => {
  const l = loop([read(3)], { rewriteFails: [1], refuse: [1] });
  const r = await l.run("fix");
  assert.equal(r.value, "v0");
  assert.equal(r.kept, 0);
  assert.equal(r.stop, "rounds");
  assert.match(r.rounds[1]!.refused![0]!, /edits did not apply/);
  assert.ok(r.calls.rewrite <= 2 && r.calls.judge <= 3);
});

test("the hard cap holds whatever SCRIPT_DESK_ROUNDS says, and a failed read changes nothing", async () => {
  const l = loop([read(2), read(3), read(4), read(5), read(6)]);
  const r = await l.run("fix", { rounds: 9 });
  assert.ok(
    r.calls.rewrite <= 3 && r.calls.judge <= 4,
    JSON.stringify(r.calls),
  );
  const unread = await loop([new Error("api down")]).run("fix");
  assert.equal(unread.stop, "unread");
  assert.equal(unread.value, "v0");
  assert.deepEqual(unread.calls, { judge: 1, rewrite: 0 });
  const second = await loop([read(3), new Error("api down")]).run("fix");
  assert.equal(second.stop, "unread");
  assert.equal(
    second.value,
    "v0",
    "an unread rewrite can't be compared, so the original stands",
  );
});

test("the record: arm, angle, mode, each round's scores and note, rounds used, kill, kept and calls", async () => {
  const { value, ...lr } = await loop([read(4), read(7)]).run("fix");
  assert.equal(value, "v1");
  const rec = deskRecord({
    arm: "desk",
    mode: "fix",
    plan: { ...plan, source_gap: "the new date" },
    loop: lr,
    checks: 1,
  });
  assert.equal(rec.angle, plan.angle);
  assert.equal(rec.hold_mode, "verdict");
  assert.equal(rec.source_gap, "the new date");
  assert.equal(rec.rounds_used, 1);
  assert.equal(rec.kept, 1);
  assert.equal(rec.scores?.overall, 7);
  assert.equal(rec.rounds[0]!.note, "weak at 4");
  assert.deepEqual(rec.calls, { judge: 2, rewrite: 1, check: 1 });
  const killed = deskRecord({
    arm: "desk",
    mode: "fix",
    plan: { ...plan, kill: "promotion" },
    kill: { kind: "promotion", why: "A sale.", acted: true },
  });
  assert.equal(killed.stop, "killed");
  assert.equal(killed.kill?.acted, true);
  assert.deepEqual(killed.calls, { judge: 0, rewrite: 0, check: 0 });
});

// ---------------------------------------------------------------- the weekly table

test("the weekly lines: per arm, per score band, and the rank correlation only from 20 Shorts", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    arm: (i % 2 ? "desk" : "control") as "desk" | "control",
    overall: 3 + (i % 6),
    views: 1000,
    viewed_pct: 50 + i,
    comments: 2,
  }));
  const few = deskLinesForReport(rows, spearman);
  assert.equal(few.length, 3);
  assert.match(
    few[0]!,
    /desk arm 6 Shorts, desk score [\d.]+, average viewed [\d.]+%, comments per 1,000 views 2\.00/,
  );
  assert.match(few[0]!, /control arm 6 Shorts/);
  assert.match(few[1]!, /scored 1-4 \d+ Shorts/);
  assert.match(few[2]!, /12 of 20 Shorts with retention data so far/);
  const many = Array.from({ length: 24 }, (_, i) => ({
    arm: "desk" as const,
    overall: 1 + (i % 10),
    viewed_pct: 40 + (i % 10),
  }));
  assert.match(
    deskLinesForReport(many, spearman)[2]!,
    /rank correlation 1\.00 over 24 Shorts/,
  );
  assert.deepEqual(
    deskLinesForReport([{ views: 5 }], spearman),
    [],
    "nothing read, no lines",
  );
});

// ---------------------------------------------------------------- the proof tool's free half

test("the proof tool counts findings per rule and guesses a flat row's game from title and narration", () => {
  assert.equal(
    guessGame(
      "Elder Scrolls 6 is officially Sentinel",
      "The Elder Scrolls 6 is called Sentinel.",
    ),
    "Elder Scrolls 6",
  );
  const results = checkRows([
    { code: "A", title: "T", narration: "One fact here. Let me know below?" },
    { code: "B", title: "T", narration: "One fact. Another fact follows it." },
    { id: "C", script_json: goodScript() },
  ]);
  const c = countFindings(results);
  assert.equal(c.banned_line.scripts, 1);
  assert.equal(c.last_line_ask.scripts, 1);
  assert.equal(results[2]!.code, "C");
});

test("the caller's constraints (the payoff gate's held answer) ride on every instruction", async () => {
  const l = loop([read(4), read(5), read(7)]);
  const r = await l.run("fix", { extra: () => ["Keep the held answer in the last 40% of the words."] });
  assert.equal(r.value, "v2");
  assert.equal(l.seen.instructions.length, 2);
  for (const t of l.seen.instructions) assert.match(t, /Keep the held answer in the last 40%/);
});
