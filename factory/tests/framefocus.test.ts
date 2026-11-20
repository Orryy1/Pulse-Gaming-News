import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import {
  FOCUS,
  fixCandidates,
  focusEvent,
  focusLinesForReport,
  focusPrompt,
  focusReportRow,
  focusSamples,
  focusSummary,
  frameFocusArm,
  parseFocusMode,
  parseFocusShare,
  parseFocusVerdict,
  runFrameFocus,
  type FocusLine,
} from "../src/qa/framefocus.ts";
import { frameFocusStep } from "../src/framefocusstep.ts";
import type { Segment } from "../src/render/timeline.ts";

const SEGMENTS: Segment[] = [
  { kind: "hook", text: "GTA VI just got a new trailer.", start: 0, end: 2.4 },
  {
    kind: "beat",
    text: "Lucia steals a car in Vice City.",
    start: 2.4,
    end: 5.6,
  },
  { kind: "beat", text: "Yes.", start: 5.6, end: 6.0 },
  { kind: "loop", text: "So when does it land?", start: 6.0, end: 8.0 },
];

const GOOD = {
  subject: "Lucia",
  visible: "yes",
  size: "large",
  centred: true,
  blocked_by_text: false,
  score: 3,
};

// ---------------------------------------------------------------- settings

test("settings: FRAME_FOCUS and FRAME_FOCUS_SHARE parse, off by default", () => {
  const keep = {
    FRAME_FOCUS: process.env.FRAME_FOCUS,
    FRAME_FOCUS_SHARE: process.env.FRAME_FOCUS_SHARE,
  };
  try {
    delete process.env.FRAME_FOCUS;
    delete process.env.FRAME_FOCUS_SHARE;
    const cfg = loadConfig();
    assert.equal(cfg.frameFocus, "off");
    assert.equal(cfg.frameFocusShare, 0.5);
    process.env.FRAME_FOCUS = " Check ";
    process.env.FRAME_FOCUS_SHARE = "0.25";
    assert.equal(loadConfig().frameFocus, "check");
    assert.equal(loadConfig().frameFocusShare, 0.25);
    process.env.FRAME_FOCUS = "fix";
    process.env.FRAME_FOCUS_SHARE = "7";
    assert.equal(loadConfig().frameFocus, "fix");
    assert.equal(loadConfig().frameFocusShare, 1);
    process.env.FRAME_FOCUS = "on";
    process.env.FRAME_FOCUS_SHARE = "lots";
    assert.equal(loadConfig().frameFocus, "off", "an unknown mode is off");
    assert.equal(loadConfig().frameFocusShare, 0.5);
  } finally {
    for (const [k, v] of Object.entries(keep))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
  assert.equal(parseFocusMode(undefined), "off");
  assert.equal(parseFocusShare(""), 0.5);
  assert.equal(parseFocusShare("-1"), 0);
  assert.equal(parseFocusShare("0"), 0);
});

// ---------------------------------------------------------------- arms

test("arm split: stable per episode, roughly the share, the ends exact", () => {
  assert.equal(frameFocusArm("ep_a", 0), "control");
  assert.equal(frameFocusArm("ep_a", 1), "check");
  assert.equal(frameFocusArm("ep_a", 0.5), frameFocusArm("ep_a", 0.5));
  let check = 0;
  for (let i = 0; i < 2000; i++)
    if (frameFocusArm(`ep_${i}`, 0.5) === "check") check++;
  assert.ok(check > 850 && check < 1150, `about half: ${check}`);
  let quarter = 0;
  for (let i = 0; i < 2000; i++)
    if (frameFocusArm(`ep_${i}`, 0.25) === "check") quarter++;
  assert.ok(quarter > 380 && quarter < 620, `about a quarter: ${quarter}`);
});

// ---------------------------------------------------------------- the verdict parser

test("verdict parser: a clean answer, loose shapes and malformed output", () => {
  assert.deepEqual(parseFocusVerdict(GOOD), GOOD);
  assert.deepEqual(parseFocusVerdict(JSON.stringify(GOOD)), GOOD);
  assert.deepEqual(
    parseFocusVerdict(
      `Sure, here it is: ${JSON.stringify(GOOD)} hope that helps`,
    ),
    GOOD,
  );
  const loose = parseFocusVerdict({
    subject: "the car",
    visible: true,
    size: "big",
    centered: "yes",
    blocked_by_text: "false",
    score: "2.6",
  });
  assert.deepEqual(loose, {
    subject: "the car",
    visible: "yes",
    size: "large",
    centred: true,
    blocked_by_text: false,
    score: 3,
  });
  assert.equal(parseFocusVerdict({ ...GOOD, score: 9 })!.score, 3, "clamped");
  assert.equal(parseFocusVerdict({ ...GOOD, score: -2 })!.score, 0, "clamped");
  assert.equal(
    parseFocusVerdict({ ...GOOD, visible: "no", score: 3 })!.score,
    0,
    "not there cannot score",
  );
  assert.equal(
    parseFocusVerdict({ ...GOOD, visible: "partially" })!.visible,
    "partly",
  );
  // No score: derived from the other answers.
  const { score: _s, ...noScore } = GOOD;
  assert.equal(parseFocusVerdict(noScore)!.score, 3);
  assert.equal(
    parseFocusVerdict({ ...noScore, size: "small", centred: false })!.score,
    1,
  );
  assert.equal(
    parseFocusVerdict({ ...noScore, visible: "partly", blocked_by_text: true })!
      .score,
    1,
  );
  // Malformed: nothing usable.
  for (const bad of [
    undefined,
    null,
    "",
    "not json",
    "{broken",
    42,
    [],
    {},
    { visible: "maybe" },
    { score: 2 },
  ])
    assert.equal(parseFocusVerdict(bad), undefined, JSON.stringify(bad));
  assert.equal(
    parseFocusVerdict({ ...GOOD, subject: "x".repeat(200) })!.subject.length,
    60,
  );
});

test("the prompt names the game, the line, the 9:16 frame and every field", () => {
  const p = focusPrompt({
    game: "Grand Theft Auto VI",
    line: " Lucia steals a car. ",
  });
  assert.match(p, /9:16/);
  assert.match(p, /Grand Theft Auto VI/);
  assert.match(p, /"Lucia steals a car\."/);
  for (const f of [
    "subject",
    "visible",
    "size",
    "centred",
    "blocked_by_text",
    "score",
  ])
    assert.match(p, new RegExp(`${f}:`));
  assert.match(focusPrompt({ game: "", line: "x" }), /about a video game/);
  assert.doesNotMatch(p, /\u2014/, "no em dashes");
});

// ---------------------------------------------------------------- sampling and summary maths

test("samples: the middle of each line, short and empty lines skipped, inside the video", () => {
  const withEmpty: Segment[] = [
    ...SEGMENTS,
    { kind: "beat", text: "  ", start: 8, end: 9 },
  ];
  const lines = focusSamples(withEmpty, 7.5);
  assert.deepEqual(
    lines.map((l) => [l.line, l.t, l.skipped]),
    [
      [0, 1.2, undefined],
      [1, 4, undefined],
      [2, undefined, "too short to sample"],
      [3, 7, undefined],
      [4, undefined, "no words"],
    ],
  );
  const late = focusSamples([{ text: "End.", start: 9, end: 11 }], 9.5);
  assert.equal(late[0]!.t, 9.4, "clamped inside the video");
  const many = focusSamples(
    Array.from({ length: FOCUS.maxLines + 3 }, (_, i) => ({
      text: "Line.",
      start: i,
      end: i + 1,
    })),
    100,
  );
  assert.equal(many.filter((l) => l.t !== undefined).length, FOCUS.maxLines);
  assert.equal(many.at(-1)!.skipped, "past the line limit");
});

test("summary: mean score, weak share and the fix scaffolding's pick", () => {
  const v = (score: number) => ({ ...GOOD, score }) as FocusLine["verdict"];
  const lines: FocusLine[] = [
    { line: 0, text: "a", t: 1, verdict: v(3) },
    { line: 1, text: "b", t: 2, verdict: v(1) },
    { line: 2, text: "c", skipped: "too short to sample" },
    { line: 3, text: "d", t: 4, verdict: v(0) },
    { line: 4, text: "e", t: 5, verdict: v(2) },
  ];
  assert.deepEqual(focusSummary(lines), {
    lines: 5,
    checked: 4,
    mean: 1.5,
    weak_share: 0.5,
    weak: [1, 3],
  });
  assert.deepEqual(focusSummary([{ line: 0, text: "a", skipped: "x" }]), {
    lines: 1,
    checked: 0,
    weak: [],
  });
  assert.deepEqual(fixCandidates(lines), [3, 1], "weakest first");
  const row = focusReportRow({
    at: "x",
    arm: "check",
    mode: "check",
    summary: focusSummary(lines),
  });
  assert.deepEqual(row, { arm: "check", mean: 1.5, weak_share: 0.5 });
  assert.deepEqual(focusReportRow({ at: "x", arm: "control", mode: "check" }), {
    arm: "control",
  });
  assert.equal(focusReportRow(undefined), undefined);
});

// ---------------------------------------------------------------- the run

const NOW = () => new Date("2026-11-19T12:00:00Z");

test("check mode: every long line asked once with its own text, recorded, video untouched", async () => {
  const asked: string[] = [];
  const extracted: number[][] = [];
  const rec = await runFrameFocus({
    mode: "check",
    arm: "check",
    game: "GTA VI",
    segments: SEGMENTS,
    duration: 8,
    extract: async (times) => {
      extracted.push(times);
      return times.map((_, i) => `f${i}.jpg`);
    },
    ready: async () => true,
    ask: async (file, prompt) => {
      asked.push(file);
      if (file === "f1.jpg") return { ...GOOD, subject: "Lucia", score: 1 };
      if (file === "f2.jpg") return "garbage";
      assert.match(prompt, /GTA VI/);
      return GOOD;
    },
    now: NOW,
  });
  assert.deepEqual(extracted, [[1.2, 4, 7]]);
  assert.deepEqual(asked, ["f0.jpg", "f1.jpg", "f2.jpg"]);
  assert.equal(rec.arm, "check");
  assert.equal(rec.at, "2026-11-19T12:00:00.000Z");
  assert.equal(rec.lines![2]!.skipped, "too short to sample");
  assert.equal(rec.lines![3]!.skipped, "unreadable answer");
  assert.deepEqual(rec.summary, {
    lines: 4,
    checked: 2,
    mean: 2,
    weak_share: 0.5,
    weak: [1],
  });
  assert.equal(rec.would_fix, undefined, "check lists no fixes");
  const ev = focusEvent(rec);
  assert.equal((ev.lines as unknown[]).length, 4);
  assert.deepEqual(ev.summary, rec.summary);
});

test("check mode swallows every failure: model throws, frames fail, model down, time box", async () => {
  const base = {
    mode: "check" as const,
    arm: "check" as const,
    game: "GTA VI",
    segments: SEGMENTS,
    duration: 8,
    now: NOW,
  };
  const throws = await runFrameFocus({
    ...base,
    extract: async (t) => t.map((_, i) => `f${i}.jpg`),
    ready: async () => true,
    ask: async () => {
      throw new Error("ollama 500");
    },
  });
  assert.equal(throws.summary!.checked, 0);
  assert.match(throws.lines![0]!.skipped!, /failed: ollama 500/);
  assert.equal(throws.error, undefined);

  const noFrames = await runFrameFocus({
    ...base,
    extract: async () => {
      throw new Error("ffmpeg died");
    },
    ready: async () => true,
    ask: async () => GOOD,
  });
  assert.match(noFrames.error!, /ffmpeg died/);
  assert.equal(noFrames.summary!.checked, 0);

  let asked = 0;
  const down = await runFrameFocus({
    ...base,
    extract: async (t) => t.map(() => "f.jpg"),
    ready: async () => false,
    ask: async () => {
      asked++;
      return GOOD;
    },
  });
  assert.equal(asked, 0);
  assert.match(down.note!, /not available/);

  const readyThrows = await runFrameFocus({
    ...base,
    extract: async (t) => t.map(() => "f.jpg"),
    ready: async () => {
      throw new Error("relay gone");
    },
    ask: async () => GOOD,
  });
  assert.match(readyThrows.note!, /not available/);

  let t = 0;
  const slow = await runFrameFocus({
    ...base,
    extract: async (times) => times.map(() => "f.jpg"),
    ready: async () => true,
    ask: async () => {
      t += 100;
      return GOOD;
    },
    budgetMs: 150,
    clock: () => t,
  });
  assert.equal(slow.summary!.checked, 2);
  assert.equal(slow.lines![3]!.skipped, "time box");

  const hangs = await runFrameFocus({
    ...base,
    extract: async (times) => times.map(() => "f.jpg"),
    ready: async () => true,
    ask: () => new Promise(() => undefined),
    frameTimeoutMs: 5,
  });
  assert.match(hangs.lines![0]!.skipped!, /timed out/);
});

test("fix mode does the same as check and only lists the weak lines", async () => {
  const rec = await runFrameFocus({
    mode: "fix",
    arm: "check",
    game: "GTA VI",
    segments: SEGMENTS,
    duration: 8,
    extract: async (t) => t.map((_, i) => `f${i}.jpg`),
    ready: async () => true,
    ask: async (file) =>
      file === "f2.jpg" ? { ...GOOD, visible: "no" } : GOOD,
    now: NOW,
  });
  assert.deepEqual(rec.would_fix, [3]);
  assert.deepEqual(focusEvent(rec).would_fix, [3]);
});

test("control arm and off mode ask nothing", async () => {
  let calls = 0;
  const count = async () => {
    calls++;
    return [] as never;
  };
  const control = await runFrameFocus({
    mode: "check",
    arm: "control",
    game: "x",
    segments: SEGMENTS,
    duration: 8,
    extract: count,
    ready: async () => {
      calls++;
      return true;
    },
    ask: count,
    now: NOW,
  });
  assert.deepEqual(control, {
    at: "2026-11-19T12:00:00.000Z",
    arm: "control",
    mode: "check",
  });
  assert.equal(calls, 0);
  const off = await runFrameFocus({
    mode: "off",
    arm: "check",
    game: "x",
    segments: SEGMENTS,
    duration: 8,
    extract: count,
    ready: async () => {
      calls++;
      return true;
    },
    ask: count,
    now: NOW,
  });
  assert.equal(off.lines, undefined);
  assert.equal(calls, 0);
});

// ---------------------------------------------------------------- the step

function stepServices(mode: "off" | "check" | "fix", share: number) {
  const events: Array<{ kind: string; payload: unknown }> = [];
  let frames = 0;
  return {
    events,
    frames: () => frames,
    s: {
      db: {
        query: async (_sql: string, params: unknown[]) => {
          events.push({ kind: String(params[1]), payload: params[2] });
          return [];
        },
      } as never,
      cfg: { frameFocus: mode, frameFocusShare: share },
      now: NOW,
      extractFrames: async (_f: string, _d: string, times: number[]) => {
        frames++;
        return times.map((_, i) => `f${i}.jpg`);
      },
    },
  };
}

test("step: off makes no calls and records nothing", async () => {
  const { s, frames, events } = stepServices("off", 1);
  let asked = 0;
  const assets: { frame_focus?: unknown } = {};
  await frameFocusStep(
    s,
    { id: "ep_1", lane: "news" },
    {
      assets: assets as never,
      game: "GTA VI",
      segments: SEGMENTS,
      duration: 8,
      video: "v.mp4",
      dir: "d",
    },
    {
      ready: async () => {
        asked++;
        return true;
      },
      ask: async () => {
        asked++;
        return GOOD;
      },
    },
  );
  assert.equal(asked, 0);
  assert.equal(frames(), 0);
  assert.equal(events.length, 0);
  assert.equal(assets.frame_focus, undefined);
});

test("step: check records on the assets and logs frame_focus; errors never escape", async () => {
  const { s, events } = stepServices("check", 1);
  const assets: { frame_focus?: any } = {};
  await frameFocusStep(
    s,
    { id: "ep_2", lane: "news" },
    {
      assets,
      game: "GTA VI",
      segments: SEGMENTS,
      duration: 8,
      video: "v.mp4",
      dir: "d",
    },
    { ready: async () => true, ask: async () => GOOD },
  );
  assert.equal(assets.frame_focus.arm, "check");
  assert.equal(assets.frame_focus.summary.mean, 3);
  assert.ok(events.some((e) => e.kind === "frame_focus"));

  // A database that throws and a model that throws: the step still returns quietly.
  const broken = {
    ...s,
    db: {
      query: async () => {
        throw new Error("db down");
      },
    } as never,
  };
  const again: { frame_focus?: any } = {};
  await frameFocusStep(
    broken,
    { id: "ep_3", lane: "news" },
    {
      assets: again,
      game: "GTA VI",
      segments: SEGMENTS,
      duration: 8,
      video: "v.mp4",
      dir: "d",
    },
    {
      ready: async () => true,
      ask: async () => {
        throw new Error("boom");
      },
    },
  );
  assert.equal(again.frame_focus.summary.checked, 0);

  // Already recorded (a retried step): nothing asked again.
  let asked = 0;
  await frameFocusStep(
    s,
    { id: "ep_2", lane: "news" },
    {
      assets,
      game: "GTA VI",
      segments: SEGMENTS,
      duration: 8,
      video: "v.mp4",
      dir: "d",
    },
    {
      ready: async () => true,
      ask: async () => {
        asked++;
        return GOOD;
      },
    },
  );
  assert.equal(asked, 0);
});

test("step: the control arm records only its arm", async () => {
  const { s, frames } = stepServices("check", 0);
  const assets: { frame_focus?: any } = {};
  let asked = 0;
  await frameFocusStep(
    s,
    { id: "ep_4", lane: "news" },
    {
      assets,
      game: "GTA VI",
      segments: SEGMENTS,
      duration: 8,
      video: "v.mp4",
      dir: "d",
    },
    {
      ready: async () => true,
      ask: async () => {
        asked++;
        return GOOD;
      },
    },
  );
  assert.deepEqual(Object.keys(assets.frame_focus).sort(), [
    "arm",
    "at",
    "mode",
  ]);
  assert.equal(assets.frame_focus.arm, "control");
  assert.equal(asked, 0);
  assert.equal(frames(), 0);
});

// ---------------------------------------------------------------- the weekly report

test("report lines: two lines, no verdict before twenty a side, then the difference and correlations", () => {
  const corr = () => 0.42;
  assert.deepEqual(focusLinesForReport([], corr), []);
  const few = focusLinesForReport(
    [
      { arm: "check", mean: 2.5, weak_share: 0.1, viewed_pct: 70 },
      { arm: "control", viewed_pct: 60 },
    ],
    corr,
  );
  assert.equal(few.length, 2);
  assert.match(
    few[0]!,
    /check arm 1 Shorts \(1 scored\), mean focus score 2\.50 of 3, weak lines 10%, average viewed 70\.0%; control arm 1 Shorts, average viewed 60\.0%/,
  );
  assert.match(few[1]!, /no verdict before 20 a side/);
  const rows = [
    ...Array.from({ length: 20 }, (_, k) => ({
      arm: "check" as const,
      mean: 2 + (k % 2) * 0.5,
      weak_share: 0.2,
      viewed_pct: 72,
    })),
    ...Array.from({ length: 20 }, () => ({
      arm: "control" as const,
      viewed_pct: 68,
    })),
  ];
  const lines = focusLinesForReport(rows, corr);
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /mean focus score 2\.25 of 3, weak lines 20%/);
  assert.match(
    lines[1]!,
    /72\.0% in the check arm against 68\.0% in the control arm \(4\.0 points, 20 against 20 Shorts\).*mean focus score 0\.42 over 20, weak-line share 0\.42 over 20/,
  );
  for (const l of lines) assert.doesNotMatch(l, /\u2014/);
});
