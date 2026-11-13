import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLARITY_JUDGE_SITE,
  CLARITY_REWRITE_SITE,
  clarityAction,
  clarityGate,
  clarityJudgeContent,
  clarityJudgePrompt,
  clarityNotes,
  clarityRewriteShort,
  clarityShortProblems,
  groundIssues,
  judgeClarity,
  shortLines,
  type ClarityJudgement,
} from "../src/editorial/clarity.ts";
import { videoPlugProblems } from "../src/editorial/shortrules.ts";
import { siteListed } from "../src/editorial/codex.ts";
import { PULSE_CHECK_LABEL } from "../src/editorial/newssegment.ts";
import { goodScript } from "./helpers.ts";

const judgement = (over: Partial<ClarityJudgement> = {}): ClarityJudgement => ({
  point: "Starfield's second expansion slipped to early 2027.",
  point_matches: true,
  issues: [],
  score: 9,
  ...over,
});

test("the judge and the rewrite are their own steps, so CODEX_CALLS=clarity routes both", () => {
  assert.ok(siteListed(CLARITY_JUDGE_SITE, ["clarity"]));
  assert.ok(siteListed(CLARITY_REWRITE_SITE, ["clarity"]));
  assert.ok(!siteListed(CLARITY_JUDGE_SITE, ["friend", "doc"]));
});

test("the judge reads cold: the narration first, the intended point after, and the owner's examples of confusion", () => {
  const c = clarityJudgeContent({
    lines: ["Line one.", "Line [sighs] two."],
    intended: "The point.",
  });
  assert.ok(c.indexOf("Line one.") < c.indexOf("The point."));
  assert.doesNotMatch(c, /\[sighs\]/, "delivery tags are not read");
  const p = clarityJudgePrompt();
  for (const re of [
    /Math isn't an upgrade policy/,
    /your East Coast unlock/,
    /My Pulse check\? Faint/,
    /our full documentary/,
  ])
    assert.match(p, re);
  assert.match(p, /before you look at the writer's intended point/);
  assert.doesNotMatch(p, /—/);
});

test("a flagged line must really be in the script, so a paraphrase can't be rewritten", () => {
  const lines = [
    "Take-Two lists Standard at $79.99.",
    "Math isn't an upgrade policy.",
  ];
  const issues = groundIssues(
    [
      {
        line: "Math isn't an upgrade policy.",
        kind: "non_sequitur",
        problem: "p",
        fix: "f",
      },
      { line: "Maths is no policy", kind: "unclear", problem: "p", fix: "f" },
    ],
    lines,
  );
  assert.deepEqual(
    issues.map((i) => i.line),
    ["Math isn't an upgrade policy."],
  );
});

test("under the minimum or a missed point goes to the writer, a flag to the rewrite, a clean read passes", () => {
  assert.equal(clarityAction(judgement()), "pass");
  assert.equal(
    clarityAction(
      judgement({
        issues: [{ line: "x", kind: "jargon", problem: "p", fix: "f" }],
      }),
    ),
    "rewrite",
  );
  assert.equal(clarityAction(judgement({ score: 7 })), "writer");
  assert.equal(clarityAction(judgement({ point_matches: false })), "writer");
  assert.equal(
    clarityAction(judgement({ score: 7 }), 6),
    "pass",
    "CLARITY_MIN moves the bar",
  );
  const notes = clarityNotes(
    judgement({
      score: 5,
      issues: [
        {
          line: "The calendar's picking favorites.",
          kind: "non_sequitur",
          problem: "no link",
          fix: "Say the times differ by region.",
        },
      ],
    }),
  );
  assert.match(notes.join(" "), /5\/10/);
  assert.match(notes.join(" "), /The calendar's picking favorites\./);
  assert.match(notes.join(" "), /Say the times differ by region/);
});

test("the gate: a clean read passes untouched, a flag is rewritten, a low score goes to the writer first", async () => {
  // Clean.
  let calls: string[] = [];
  const clean = await clarityGate({
    value: "v0",
    judge: async () => (calls.push("judge"), judgement()),
    rewrite: async () => (calls.push("rewrite"), "v1"),
    accept: async () => [],
  });
  assert.equal(clean.value, "v0");
  assert.deepEqual(calls, ["judge"]);

  // A flagged line: one rewrite, read again.
  calls = [];
  const reads = [
    judgement({
      issues: [{ line: "x", kind: "jargon", problem: "p", fix: "f" }],
    }),
    judgement({ score: 10 }),
  ];
  const flagged = await clarityGate({
    value: "v0",
    judge: async () => (calls.push("judge"), reads.shift()!),
    writer: async () => (calls.push("writer"), "w"),
    rewrite: async (_v, _j, plain) => (
      calls.push(plain ? "plain" : "rewrite"),
      "v1"
    ),
    accept: async () => [],
  });
  assert.equal(flagged.value, "v1");
  assert.deepEqual(calls, ["judge", "rewrite", "judge"]);
  assert.equal(flagged.first?.score, 9);
  assert.equal(flagged.last?.score, 10);

  // Under 8: the writer once; still under 8: the plain rewrite.
  calls = [];
  const low = [
    judgement({ score: 4 }),
    judgement({ score: 6 }),
    judgement({ score: 9 }),
  ];
  const out = await clarityGate({
    value: "v0",
    judge: async () => (calls.push("judge"), low.shift()!),
    writer: async (_v, notes) => (calls.push(`writer:${notes.length}`), "w1"),
    rewrite: async (_v, _j, plain) => (
      calls.push(plain ? "plain" : "rewrite"),
      "p1"
    ),
    accept: async () => [],
  });
  assert.equal(out.value, "p1");
  assert.deepEqual(calls, ["judge", "writer:1", "judge", "plain", "judge"]);
});

test("the gate keeps the version before when a rewrite fails its checks, and never throws", async () => {
  const kept = await clarityGate({
    value: "v0",
    judge: async () =>
      judgement({
        issues: [{ line: "x", kind: "plug", problem: "p", fix: "f" }],
      }),
    rewrite: async () => "v1",
    accept: async () => ["The rewrite drops the figure 80."],
  });
  assert.equal(kept.value, "v0");
  assert.equal(kept.steps.find((s) => s.step === "rewrite")?.kept, false);
  const broken = await clarityGate({
    value: "v0",
    judge: async () => {
      throw new Error("codex down");
    },
    rewrite: async () => "v1",
    accept: async () => [],
  });
  assert.equal(broken.value, "v0");
  assert.equal(broken.first, undefined);
});

test("the Short rewrite edits only the spoken lines and keeps the facts, the verdict and the stamp", async () => {
  const before = goodScript({
    point: "Starfield's second expansion slipped to early 2027.",
    pulse_take: {
      label: PULSE_CHECK_LABEL,
      narration:
        "Delays usually help Bethesda. My verdict: nothing to worry about yet.",
      on_screen: "STEADY: not a red flag",
    },
  });
  const seen: any[] = [];
  const llm = {
    structured: async (o: any) => {
      seen.push(o);
      return {
        edits: [
          {
            find: "So if you're waiting, mark early 2027 for Starfield's second expansion.",
            replace: "If you're waiting for it, the new window is early 2027.",
          },
        ],
      };
    },
  } as any;
  const after = await clarityRewriteShort(
    llm,
    before,
    judgement({
      issues: [
        { line: before.loop_line, kind: "unclear", problem: "p", fix: "f" },
      ],
    }),
  );
  assert.equal(seen[0].site, CLARITY_REWRITE_SITE);
  assert.match(
    seen[0].content,
    /The intended point: Starfield's second expansion/,
  );
  assert.equal(
    after.loop_line,
    "If you're waiting for it, the new window is early 2027.",
  );
  assert.equal(after.hook, before.hook);
  assert.deepEqual(clarityShortProblems(before, after), []);
  const lostVerdict = {
    ...after,
    pulse_take: {
      ...after.pulse_take,
      narration: "Delays usually help Bethesda.",
    },
  };
  assert.match(
    clarityShortProblems(before, lostVerdict).join(" "),
    /closing verdict/,
  );
  const moved = {
    ...after,
    hook: "Starfield's second expansion has been delayed to early 2028.",
  };
  assert.match(clarityShortProblems(before, moved).join(" "), /figure/);
});

test("judgeClarity asks the judge step and drops flags it can't find in the script", async () => {
  const s = goodScript();
  const llm = {
    structured: async (o: any) => {
      assert.equal(o.site, CLARITY_JUDGE_SITE);
      return judgement({
        issues: [
          { line: s.loop_line, kind: "unclear", problem: "p", fix: "f" },
          {
            line: "a line nobody said",
            kind: "unclear",
            problem: "p",
            fix: "f",
          },
        ],
      });
    },
  } as any;
  const j = await judgeClarity(llm, {
    lines: shortLines(s),
    intended: s.point,
  });
  assert.equal(j.issues.length, 1);
});

test("a plug for another video goes back; a funnel cut is not written here", () => {
  for (const t of [
    "The calendar gets you to Vice City; our full GTA documentary checks which launch promises survive the trip.",
    "Even car theft comes with homework; our documentary asks which GTA 6 launch promises you can trust.",
    "Our GTA documentary checks the launch promises, but your first mission is still the download queue.",
    "The full guide is linked just below.",
  ])
    assert.equal(videoPlugProblems(t).length, 1, t);
  for (const t of [
    "The game's ranking on Steam fell to 40th.",
    "It won the Golden Joysticks ranking by a point.",
    "Rockstar's guide to Vice City is out.",
  ])
    assert.equal(videoPlugProblems(t).length, 0, t);
});

test("the facts guard reads short forms, possessives and a verdict's capital as the same facts", async () => {
  const { factDrift } = await import("../src/editorial/friendpass.ts");
  assert.deepEqual(factDrift("Grand Theft Auto 6 Ultimate costs $99.99.", "GTA 6 Ultimate costs $99.99."), []);
  assert.deepEqual(
    factDrift("Bethesda brings back B.J. Blazkowicz. B.J.'s daughters left.", "Bethesda brings back B.J. Blazkowicz. His daughters left B.J. alone."),
    [],
  );
  assert.deepEqual(factDrift("It costs $80. My Pulse check? Faint.", "It costs $80. My verdict: Don't buy it yet."), []);
  assert.match(factDrift("Sony makes it.", "Sony and Nintendo make it.").join(" "), /adds the name Nintendo/);
});
