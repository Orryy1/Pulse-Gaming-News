import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIRST_EDITOR_SITE,
  FIRST_SECOND,
  FIRST_VIEWER_SITE,
  FIRST_WRITE_SITE,
  alternativeProblems,
  applyOpening,
  firstEditorPrompt,
  firstSecondArm,
  firstSecondArmFor,
  firstSecondEvent,
  firstSecondLinesForReport,
  firstSecondView,
  firstViewerPrompt,
  firstWritePrompt,
  openingView,
  pictureOf,
  readFirstViewer,
  runFirstSecond,
  withFirstSentence,
  type FirstSecondDeps,
  type FirstWrite,
} from "../src/panel/firstsecond.ts";
import { scoresFromEvent } from "../src/learn/judges.ts";
import { siteListed } from "../src/editorial/codex.ts";
import { spearman } from "../src/analyticsloop.ts";
import { loadConfig } from "../src/config.ts";
import { narrationOf } from "../src/editorial/schema.ts";
import type { Llm } from "../src/editorial/llm.ts";
import { goodScript } from "./helpers.ts";

const script = () =>
  goodScript({
    hook: "Starfield's second expansion has been delayed to early 2027. Bethesda knew in August.",
    hook_footage: { want: "gameplay", keywords: ["new planet", "ship"] },
  });

const viewerRead = (
  label: string,
  stop: number,
  over: Record<string, unknown> = {},
) => ({
  label,
  stop,
  clear: 7,
  want_next: 6,
  reason: `reason ${label}`,
  gives_away: false,
  fault: `fault ${label}`,
  ...over,
});
const editorRead = (label: string, overall: number) => ({
  label,
  hook: overall,
  clarity: 7,
  honesty: 8,
  overall,
  gives_away: false,
  fault: `fault ${label}`,
});

/** The labels in a critic's content, in order, with what each opening says. */
const openings = (content: string) =>
  [
    ...content.matchAll(
      /^OPENING (\S+)\nON SCREEN: (.*)\nPICTURE: .*\nSAID: (.*)$/gm,
    ),
  ].map((m) => ({
    label: m[1]!,
    text: m[2]!,
    sentence: m[3]!,
  }));

// ---------------------------------------------------------------- settings, arms and off

test("settings default off with half the covered Shorts in the panel's arm; anything else reads as off", () => {
  const keys = ["FIRST_SECOND_PANEL", "FIRST_SECOND_PANEL_SHARE"];
  const saved = keys.map((k) => process.env[k]);
  for (const k of keys) delete process.env[k];
  try {
    const cfg = loadConfig();
    assert.equal(cfg.firstSecondPanel, "off");
    assert.equal(cfg.firstSecondShare, 0.5);
    assert.equal(FIRST_SECOND.share, 0.5);
    process.env.FIRST_SECOND_PANEL = "bogus";
    assert.equal(loadConfig().firstSecondPanel, "off");
    process.env.FIRST_SECOND_PANEL = "CHECK";
    process.env.FIRST_SECOND_PANEL_SHARE = "7";
    assert.equal(loadConfig().firstSecondPanel, "check");
    assert.equal(loadConfig().firstSecondShare, 1);
  } finally {
    keys.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
  }
});

test("off changes nothing: no arm, so the pipeline makes no call and writes no record", () => {
  for (const id of ["a", "b", "c", "ep-9"]) {
    assert.equal(firstSecondArmFor("off", 0.5, id, true), undefined);
    assert.equal(firstSecondArmFor("off", 1, id, true), undefined);
    assert.equal(
      firstSecondArmFor("on", 1, id, false),
      undefined,
      "an uncovered Short is never read",
    );
  }
  assert.deepEqual(
    firstSecondLinesForReport([], spearman),
    [],
    "no record, no report line",
  );
  assert.deepEqual(firstSecondLinesForReport([{ stop: 5 }], spearman), []);
});

test("the arm is stable per episode, follows the share and is its own split", () => {
  assert.equal(firstSecondArm("x", 0), "control");
  assert.equal(firstSecondArm("x", 1), "panel");
  const ids = Array.from({ length: 400 }, (_, i) => `ep-${i}`);
  const n = ids.filter((id) => firstSecondArm(id, 0.5) === "panel").length;
  assert.ok(n > 160 && n < 240, String(n));
  for (const id of ids.slice(0, 10))
    assert.equal(
      firstSecondArmFor("check", 0.5, id, true),
      firstSecondArm(id, 0.5),
    );
});

test("every site is named so CODEX_CALLS can route it", () => {
  for (const s of [FIRST_VIEWER_SITE, FIRST_EDITOR_SITE, FIRST_WRITE_SITE]) {
    assert.match(s, /^first\./);
    assert.ok(siteListed(s, ["first"]));
  }
});

// ---------------------------------------------------------------- the view

test("the view is the first sentence, the first-frame text and the planned picture, nothing else", () => {
  const v = firstSecondView(script());
  assert.equal(
    v.sentence,
    "Starfield's second expansion has been delayed to early 2027.",
  );
  assert.equal(v.text, "Starfield Expansion Delayed To 2027");
  assert.equal(
    v.picture,
    "moving: gameplay footage from Starfield, showing new planet, ship",
  );
  const shown = openingView("1", v);
  assert.ok(
    !shown.includes("Bethesda knew"),
    "the second sentence is not part of the first second",
  );
  assert.ok(!shown.includes("polish"), "nor the rest of the script");
  assert.equal(
    pictureOf(goodScript()),
    "a still picture (key art or a screenshot) of Starfield",
  );
  assert.equal(
    pictureOf(goodScript({ hook_footage: { want: "none", keywords: [] } })),
    "a still picture (key art or a screenshot) of Starfield",
  );
});

test("prompts: no em dash, blind (no plan, no sources), the write rules carried", () => {
  for (const p of [
    firstViewerPrompt(),
    firstEditorPrompt(),
    firstWritePrompt(true),
    firstWritePrompt(false),
  ])
    assert.ok(!/[—–]/.test(p));
  assert.match(firstWritePrompt(true), /6 words or fewer, names the game/);
  assert.match(firstWritePrompt(true), /Never the answer/);
  assert.match(firstWritePrompt(false), /keeps its own; return no sentences/);
});

// ---------------------------------------------------------------- the guards

test("guards: length, the game named, no hype, no question, no new figure or name, never the held answer", () => {
  const sc = script();
  const text = narrationOf(sc) + "\n" + sc.youtube.title;
  assert.deepEqual(
    alternativeProblems(
      "text",
      "Starfield's Expansion Slips Three Months",
      sc,
      text,
    ),
    [],
  );
  assert.match(
    alternativeProblems(
      "text",
      "Starfield Expansion Slips By Three Long Months",
      sc,
      text,
    ).join(),
    /over 6 words/,
  );
  assert.match(
    alternativeProblems(
      "text",
      "Expansion Slips Three Months",
      sc,
      text,
    ).join(),
    /name the game/,
  );
  assert.match(
    alternativeProblems(
      "text",
      "Starfield's Huge Expansion Delay",
      sc,
      text,
    ).join(),
    /hype/,
  );
  assert.match(
    alternativeProblems("text", "Starfield Delayed Again?", sc, text).join(),
    /question/,
  );
  assert.match(
    alternativeProblems("text", "Starfield Slips To 2029", sc, text).join(),
    /figure the Short does not say: 2029/,
  );
  assert.match(
    alternativeProblems("sentence", "Starfield slipped, says Todd Howard.", sc, text).join(),
    /name the Short does not say: Todd, Howard/,
  );
  assert.deepEqual(alternativeProblems("sentence", "Bethesda pushed Starfield's expansion past December.", sc, text), []);
  const gated = {
    ...sc,
    payoff: {
      question: "Why?",
      answer: "performance on Series S",
      answer_line: "",
      angle: "",
      side: "",
    },
    payoff_gate: { arm: "gate" },
  } as never;
  assert.match(
    alternativeProblems(
      "text",
      "Starfield Slips For Series S Performance",
      gated,
      text + " Series S performance",
    ).join(),
    /held answer/,
  );
  assert.match(
    alternativeProblems(
      "sentence",
      "Starfield is late, and the reason is not the one you would guess at all",
      sc,
      text,
    ).join(),
    /over 12 words/,
  );
});

test("a new first sentence replaces only the first sentence of the hook", () => {
  assert.equal(
    withFirstSentence(
      "Starfield slipped. Bethesda knew in August.",
      "Bethesda sat on Starfield's delay.",
    ),
    "Bethesda sat on Starfield's delay. Bethesda knew in August.",
  );
  const sc = script();
  const after = applyOpening(sc, {
    text: "Starfield Slips Three Months",
    sentence: firstSecondView(sc).sentence,
  });
  assert.equal(after.headline, "Starfield Slips Three Months");
  assert.equal(after.hook, sc.hook);
});

// ---------------------------------------------------------------- check

test("check: one audience read of the Short as it stands, recorded with the stop mark, reason and give-away; nothing changes", async () => {
  const seen: string[] = [];
  const deps: FirstSecondDeps = {
    viewer: async (c) => (
      seen.push(c),
      { reads: [viewerRead("1", 4, { gives_away: true })] }
    ),
    editor: async () => assert.fail("no editor read under check"),
    write: async () => assert.fail("no write under check"),
  };
  const sc = script();
  for (const [arm, mode] of [
    ["panel", "check"],
    ["control", "on"],
  ] as const) {
    seen.length = 0;
    const r = await runFirstSecond({
      script: sc,
      narration: narrationOf(sc),
      episodeId: "ep1",
      arm,
      mode,
      deps,
    });
    assert.equal(r.script, sc, "the script object itself is returned");
    assert.equal(seen.length, 1);
    assert.equal(openings(seen[0]!).length, 1);
    assert.equal(r.record.stop, 4);
    assert.equal(r.record.reason, "reason 1");
    assert.equal(r.record.gives_away, true);
    assert.equal(r.record.changed, false);
    assert.deepEqual(r.record.calls, { write: 0, read: 1 });
    assert.deepEqual(r.record.before, firstSecondView(sc));
  }
});

test("check: a failed read is recorded and the script stands", async () => {
  const sc = script();
  const r = await runFirstSecond({
    script: sc,
    narration: narrationOf(sc),
    episodeId: "ep1",
    arm: "panel",
    mode: "check",
    deps: { viewer: async () => Promise.reject(new Error("timeout")) },
  });
  assert.equal(r.script, sc);
  assert.equal(r.record.error, "timeout");
  assert.equal(r.record.stop, undefined);
});

test("the read helper sends the audience prompt to first.viewer on the mid tier", async () => {
  const seen: any[] = [];
  const llm = {
    structured: async (req: any) => (seen.push(req), { reads: [] }),
  } as unknown as Llm;
  await readFirstViewer(llm, "OPENING 1");
  assert.equal(seen[0].site, FIRST_VIEWER_SITE);
  assert.equal(seen[0].tier, "mid");
  assert.equal(seen[0].system, firstViewerPrompt());
});

// ---------------------------------------------------------------- on

function onDeps(o: {
  write: FirstWrite;
  stop: (text: string, sentence: string) => number;
  overall: (text: string, sentence: string) => number;
  accept?: FirstSecondDeps["accept"];
  seen?: { viewer: string[]; editor: string[]; write: boolean[] };
}): FirstSecondDeps {
  const seen = o.seen ?? { viewer: [], editor: [], write: [] };
  return {
    viewer: async (c) => (
      seen.viewer.push(c),
      {
        reads: openings(c).map((x) =>
          viewerRead(x.label, o.stop(x.text, x.sentence)),
        ),
      }
    ),
    editor: async (c) => (
      seen.editor.push(c),
      {
        reads: openings(c).map((x) =>
          editorRead(x.label, o.overall(x.text, x.sentence)),
        ),
      }
    ),
    write: async (sentences) => (seen.write.push(sentences), o.write),
    accept: o.accept ?? (() => []),
  };
}

test("on: one write, two reads of every combination, blind and shuffled; the best mean is kept", async () => {
  const sc = script();
  const seen = {
    viewer: [] as string[],
    editor: [] as string[],
    write: [] as boolean[],
  };
  const r = await runFirstSecond({
    script: sc,
    narration: narrationOf(sc),
    episodeId: "ep-on",
    arm: "panel",
    mode: "on",
    deps: onDeps({
      seen,
      write: {
        texts: [
          "Starfield's Expansion Slips Three Months",
          "Starfield's Huge Delay",
          "Starfield Misses December",
        ],
        sentences: [
          "Bethesda knew Starfield's expansion would slip back in August.",
        ],
      },
      stop: (t, s) =>
        (t === "Starfield Misses December" ? 8 : 5) +
        (s.startsWith("Bethesda") ? 1 : 0),
      overall: (t) => (t === "Starfield Misses December" ? 8 : 6),
    }),
  });
  assert.deepEqual(
    seen.write,
    [true],
    "sentences asked for: not a room script",
  );
  assert.equal(seen.viewer.length, 1);
  assert.equal(seen.editor.length, 1);
  const shown = openings(seen.viewer[0]!);
  assert.equal(
    shown.length,
    3 * 2,
    "current + 2 passing texts, current + 1 sentence",
  );
  assert.equal(
    seen.viewer[0],
    seen.editor[0],
    "both critics see the same blind view",
  );
  assert.notEqual(
    shown[0]!.text === "Starfield Expansion Delayed To 2027" &&
      shown[0]!.sentence.startsWith("Starfield's"),
    true,
  );
  assert.deepEqual(r.record.calls, { write: 1, read: 2 });
  assert.ok(r.record.refused?.some((x) => /Huge Delay.*hype/.test(x)));
  assert.equal(r.record.changed, true);
  assert.equal(r.script.headline, "Starfield Misses December");
  assert.match(
    r.script.hook,
    /^Bethesda knew Starfield's expansion would slip back in August\. Bethesda knew in August\.$/,
  );
  assert.equal(r.record.stop, 9, "the stop mark of the opening that went out");
  assert.equal(r.record.marks!.length, 12);
  assert.ok(r.record.why);
  const ev = firstSecondEvent(r.record);
  assert.equal(ev.changed, true);
  assert.equal(ev.stop, 9);
});

test("on: the current version wins ties", async () => {
  const sc = script();
  const r = await runFirstSecond({
    script: sc,
    narration: narrationOf(sc),
    episodeId: "ep-tie",
    arm: "panel",
    mode: "on",
    deps: onDeps({
      write: { texts: ["Starfield Misses December"], sentences: [] },
      stop: () => 6,
      overall: () => 6,
    }),
  });
  assert.equal(r.record.changed, false);
  assert.equal(r.script, sc);
  assert.match(r.record.why!, /preferred candidate/);
});

test("on: a room-written Short keeps its first sentence; no sentences are asked for", async () => {
  const sc = script();
  const seen = {
    viewer: [] as string[],
    editor: [] as string[],
    write: [] as boolean[],
  };
  const r = await runFirstSecond({
    script: sc,
    narration: narrationOf(sc),
    episodeId: "ep-room",
    arm: "panel",
    mode: "on",
    roomWrote: true,
    deps: onDeps({
      seen,
      write: {
        texts: ["Starfield Misses December"],
        sentences: ["Bethesda knew Starfield would slip."],
      },
      stop: (_t, s) => (s.startsWith("Bethesda") ? 10 : 5),
      overall: () => 6,
    }),
  });
  assert.deepEqual(seen.write, [false]);
  assert.ok(
    openings(seen.viewer[0]!).every(
      (x) => x.sentence === firstSecondView(sc).sentence,
    ),
  );
  assert.equal(r.script.hook, sc.hook);
  assert.equal(r.record.sentence_locked, true);
});

test("on: a first sentence the fact guard or house rules refuse is never shown", async () => {
  const sc = script();
  const seen = {
    viewer: [] as string[],
    editor: [] as string[],
    write: [] as boolean[],
  };
  const r = await runFirstSecond({
    script: sc,
    narration: narrationOf(sc),
    episodeId: "ep-guard",
    arm: "panel",
    mode: "on",
    deps: onDeps({
      seen,
      write: {
        texts: [],
        sentences: ["Bethesda knew Starfield's expansion would slip."],
      },
      stop: () => 6,
      overall: () => 6,
      accept: () => ["Banned phrase matched"],
    }),
  });
  assert.ok(r.record.refused?.some((x) => /Banned phrase/.test(x)));
  assert.equal(
    r.record.calls.read,
    1,
    "nothing to choose between: the audience read alone",
  );
  assert.equal(seen.editor.length, 0);
  assert.equal(r.script, sc);
});

test("on: a failed write still reads the current opening; a failed audience read changes nothing", async () => {
  const sc = script();
  const r = await runFirstSecond({
    script: sc,
    narration: narrationOf(sc),
    episodeId: "ep-fail",
    arm: "panel",
    mode: "on",
    deps: {
      ...onDeps({
        write: { texts: [], sentences: [] },
        stop: () => 7,
        overall: () => 7,
      }),
      write: async () => Promise.reject(new Error("down")),
    },
  });
  assert.equal(r.record.stop, 7);
  assert.deepEqual(r.record.calls, { write: 1, read: 1 });
  const r2 = await runFirstSecond({
    script: sc,
    narration: narrationOf(sc),
    episodeId: "ep-fail",
    arm: "panel",
    mode: "on",
    deps: {
      ...onDeps({
        write: { texts: ["Starfield Misses December"], sentences: [] },
        stop: () => 9,
        overall: () => 9,
      }),
      viewer: async () => Promise.reject(new Error("timeout")),
    },
  });
  assert.equal(r2.script, sc);
  assert.equal(r2.record.changed, false);
  assert.match(r2.record.error!, /audience: timeout/);
});

// ---------------------------------------------------------------- calibration

test("calibration: the stop mark goes to the judge ledger and the weekly report sets it against stayed to watch", () => {
  const [score] = scoresFromEvent({
    id: 7,
    episode_id: "ep1",
    kind: "first_second",
    detail: { arm: "panel", mode: "check", stop: 6, changed: false },
    created_at: "2026-11-19T10:00:00Z",
  });
  assert.equal(score!.judge, "first_second");
  assert.equal(score!.score, 6);
  assert.equal(score!.scaleMax, 10);
  const few = firstSecondLinesForReport(
    [
      { arm: "panel", stop: 6, stayed: 60, gives_away: false },
      { arm: "control", stop: 4, stayed: 50, gives_away: true },
    ],
    spearman,
  );
  assert.match(
    few[0]!,
    /panel arm 1 Shorts, stayed to watch 60\.0%; control arm 1 Shorts, stayed to watch 50\.0%/,
  );
  assert.match(
    few[1]!,
    /2 of 20 Shorts so far; the first-frame text gave the answer away on 1 of 2 read/,
  );
  const many = firstSecondLinesForReport(
    Array.from({ length: 24 }, (_, i) => ({
      arm: "panel" as const,
      stop: 1 + (i % 10),
      stayed: 30 + (i % 10) * 3,
    })),
    spearman,
  );
  assert.match(many[1]!, /rank correlation 1\.00 over 24 Shorts/);
});
