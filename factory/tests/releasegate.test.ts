import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  estimateGateCost,
  gateDecision,
  gateShots,
  gateStats,
  heldNotice,
  releaseGateStep,
  scoreShots,
  shotLine,
  worstShots,
  type GateShot,
  type ScoredShot,
} from "../src/qa/releaseGate.ts";
import { createEpisode, getEpisode, transition } from "../src/episodes.ts";
import { clusterItems } from "../src/discovery/cluster.ts";
import type { Llm } from "../src/editorial/llm.ts";
import { item, testConfig, testDb, tmpDir } from "./helpers.ts";

const words = (text: string, from: number, step = 0.5) =>
  text
    .split(" ")
    .map((t, i) => ({
      text: t,
      start: from + i * step,
      end: from + (i + 1) * step,
    }));

test("every shot with narration gets its middle frame, its exact words and its chapter; silent shots are skipped", () => {
  const plan = {
    fps: 30,
    shots: [
      { start: 0, end: 150 }, // 0-5 s: the breather, nobody speaks
      { start: 150, end: 300 }, // 5-10 s
      { start: 300, end: 450 }, // 10-15 s
      { start: 450, end: 600 }, // 15-20 s: tail, nothing said
    ],
  };
  const spoken = [
    ...words("Rockstar North moved to Edinburgh", 5),
    ...words("in two thousand and two", 10),
  ];
  const windows = [
    { entry: 0, segment: 0, moment: 0, start: 5, end: 9, at: 5 },
    { entry: 1, segment: 1, moment: 0, start: 9, end: 14, at: 9 },
  ];
  const shots = gateShots(plan as never, spoken, windows, [
    { game: "Grand Theft Auto III", year: 2001 },
    { game: "Grand Theft Auto: Vice City", year: 2002 },
  ]);
  assert.deepEqual(
    shots.map((s) => [s.index, s.frame, s.chapter]),
    [
      [1, 225, "Grand Theft Auto III (2001)"],
      [2, 375, "Grand Theft Auto: Vice City (2002)"],
    ],
  );
  assert.equal(shots[0]!.words, "Rockstar North moved to Edinburgh");
  assert.equal(shots[1]!.words, "in two thousand and two");
  assert.equal(shots[0]!.seconds, 5);
  assert.match(
    shotLine(1, shots[0]!),
    /^Frame 1: 0:05 to 0:10, chapter "Grand Theft Auto III \(2001\)"\. Narration: "Rockstar North/,
  );
});

test("the stats weigh scores by screen time and leave unscored shots out", () => {
  const s = gateStats([
    { seconds: 10, score: 3 },
    { seconds: 10, score: 0 },
    { seconds: 20, score: 2 },
    { seconds: 5 }, // not scored
  ]);
  assert.equal(s.shots, 3);
  assert.equal(s.seconds, 40);
  assert.equal(s.mean, (10 * 3 + 20 * 2) / 40);
  assert.equal(s.zeroShare, 0.25);
  assert.equal(s.threeShare, 0.25);
  assert.deepEqual(gateStats([]), {
    shots: 0,
    seconds: 0,
    mean: 0,
    zeroShare: 0,
    threeShare: 0,
  });
});

test("the gate holds under the mean, over the zero share, or when nothing was scored", () => {
  const limits = { minMean: 2, maxZero: 0.03 };
  assert.deepEqual(
    gateDecision(
      { shots: 100, seconds: 600, mean: 2.4, zeroShare: 0.02, threeShare: 0.5 },
      limits,
    ),
    { pass: true, reasons: [] },
  );
  const low = gateDecision(
    { shots: 100, seconds: 600, mean: 1.9, zeroShare: 0.0, threeShare: 0.3 },
    limits,
  );
  assert.equal(low.pass, false);
  assert.match(low.reasons[0]!, /mean shot score 1.90 of 3 \(needs 2.0\)/);
  const wrong = gateDecision(
    { shots: 100, seconds: 600, mean: 2.5, zeroShare: 0.05, threeShare: 0.6 },
    limits,
  );
  assert.equal(wrong.pass, false);
  assert.match(
    wrong.reasons[0]!,
    /5% of screen time shows the wrong thing \(allowed 3%\)/,
  );
  assert.equal(
    gateDecision(
      { shots: 0, seconds: 0, mean: 0, zeroShare: 0, threeShare: 0 },
      limits,
    ).pass,
    false,
  );
  // Exactly on the line passes.
  assert.equal(
    gateDecision(
      { shots: 10, seconds: 60, mean: 2, zeroShare: 0.03, threeShare: 0 },
      limits,
    ).pass,
    true,
  );
});

const shot = (
  index: number,
  score: number | undefined,
  seconds = 5,
  start = index * 5,
): ScoredShot => ({
  index,
  start,
  end: start + seconds,
  seconds,
  frame: 0,
  words: `words ${index}`,
  chapter: "",
  score,
  reason: `reason ${index}`,
});

test("the worst list is lowest score first, longest first among equals, ten at most, never an unscored shot", () => {
  const shots = [
    shot(0, 3),
    shot(1, 0, 4),
    shot(2, 1),
    shot(3, 0, 9),
    shot(4, undefined),
    shot(5, 2),
    shot(6, 1, 8),
  ];
  assert.deepEqual(
    worstShots(shots).map((s) => s.index),
    [3, 1, 6, 2, 5, 0],
  );
  assert.deepEqual(
    worstShots(shots, 2).map((s) => s.index),
    [3, 1],
  );
  const many = Array.from({ length: 30 }, (_, i) => shot(i, 1));
  assert.equal(worstShots(many).length, 10);
});

test("the cost estimate grows with the shots and stays at cents for a documentary", () => {
  const c = estimateGateCost(400);
  assert.equal(c.calls, 50);
  assert.ok(c.usd > 0.1 && c.usd < 1, `got $${c.usd}`);
  assert.ok(estimateGateCost(800).usd > c.usd);
  assert.deepEqual(estimateGateCost(0), {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    usd: 0,
  });
});

test("scoring runs in batches of eight, maps frame numbers back, clamps scores and survives a failed batch", async () => {
  const dir = await tmpDir();
  const shots: GateShot[] = Array.from({ length: 11 }, (_, i) => ({
    index: i,
    start: i * 5,
    end: i * 5 + 5,
    seconds: 5,
    frame: i * 150 + 75,
    words: `line ${i}`,
    chapter: "GTA (2001)",
  }));
  const calls: number[] = [];
  const llm = {
    structured: async ({ content }: { content: unknown[] }) => {
      const images = content.filter((c: any) => c.type === "image").length;
      calls.push(images);
      if (images === 3) throw new Error("model down");
      return {
        frames: [
          { frame: 1, score: 3, reason: "shows it" },
          { frame: 2, score: 7, reason: "over" }, // clamped to 3
          { frame: 3, score: -1, reason: "under" }, // clamped to 0
          { frame: 4, score: 1.6, reason: "rounds to 2" },
          // frames 5-8 not answered
        ],
      };
    },
  } as unknown as Llm;
  const scored = await scoreShots(shots, {
    llm,
    headline: "h",
    game: "GTA",
    frame: async (s) => {
      const f = path.join(dir, `s${s.index}.jpg`);
      await fs.writeFile(f, "jpeg");
      return f;
    },
  });
  assert.deepEqual(calls, [8, 3]);
  assert.deepEqual(
    scored.slice(0, 5).map((s) => s.score),
    [3, 3, 0, 2, undefined],
  );
  assert.equal(scored[4]!.reason, "not scored");
  assert.equal(scored.filter((s) => s.score === undefined).length, 7);
});

test("the held card lists the worst shots with their words and reasons, the links and no em dash", () => {
  const msg = heldNotice(
    "The Making of Vice City",
    { shots: 300, seconds: 1800, mean: 1.6, zeroShare: 0.07, threeShare: 0.3 },
    ["mean shot score 1.60 of 3 (needs 2.0)"],
    [shot(3, 0, 9, 754), shot(1, 0, 4, 60)],
    { usd: 0.31 },
    {
      approve: "https://x/approve",
      reject: "https://x/reject",
      preview: "https://x/watch",
    },
  );
  const text = `${msg.content}\n${msg.embeds?.[0]?.description}`;
  assert.match(text, /Held because: mean shot score 1.60 of 3/);
  assert.match(text, /1\. 12:34 to 12:43 · score 0 · "words 3" · reason 3/);
  assert.match(text, /2\. 1:00 to 1:04/);
  assert.match(text, /https:\/\/x\/approve/);
  assert.match(text, /\$0\.31/);
  assert.equal(msg.ping, true);
  assert.doesNotMatch(text, /—/);
});

/** A rendered documentary with a two-shot plan and narration over both. */
async function documentary(dir: string, scoresPerShot: number[]) {
  const db = await testDb();
  const cfg = testConfig(dir);
  const cluster = clusterItems([
    item("The making of Vice City", "Rockstar", "official"),
  ])[0]!;
  await createEpisode(db, "doc1", cluster, { lane: "longform", priority: 20 });
  const spoken = [
    ...words("Rockstar North moved to Edinburgh", 0),
    ...words("and Vice City followed in two thousand and two", 5),
  ];
  const script = {
    headline: "The making of Vice City",
    game_title: "Grand Theft Auto: Vice City",
    evergreen_format: "documentary",
    youtube: { title: "The Making of Vice City" },
    entries: [
      {
        rank: 1,
        game_title: "Grand Theft Auto: Vice City",
        year: 2002,
        moments: [{ show: "a" }, { show: "b" }],
      },
    ],
  };
  await transition(db, "doc1", "selected", "rendered", {
    script_json: script,
    assets_json: {
      video: "short.mp4",
      words: spoken,
      durationSeconds: 10,
      longPlan: {
        version: 1,
        fps: 30,
        totalFrames: 480,
        tailFrames: 180,
        shots: [
          {
            start: 0,
            end: 150,
            segment: 0,
            media: { type: "image", index: 0 },
            move: "pushIn",
          },
          {
            start: 150,
            end: 300,
            segment: 0,
            media: { type: "image", index: 1 },
            move: "pushIn",
          },
        ],
      },
    },
    qa_json: { checked_at: "2026-10-30T10:00:00.000Z" },
  });
  await fs.writeFile(path.join(dir, "short.mp4"), "mp4");
  const notices: any[] = [];
  const llmCalls: number[] = [];
  const s = {
    db,
    cfg,
    llm: {
      structured: async () => {
        llmCalls.push(1);
        return {
          frames: scoresPerShot.map((score, i) => ({
            frame: i + 1,
            score,
            reason: `shot ${i}`,
          })),
        };
      },
    } as unknown as Llm,
    notify: async (m: any) => void notices.push(m),
    now: () => new Date("2026-10-30T12:00:00Z"),
    episodeDir: () => dir,
    frame: async (_v: string, _t: number, dest: string) => {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, "jpeg");
      return dest;
    },
  };
  const segments = [
    {
      kind: "beat",
      text: "Rockstar North moved to Edinburgh. And Vice City followed in two thousand and two.",
      start: 0,
      end: 10,
      visual: {
        kind: "chapter",
        primary: "Vice City",
        secondary: "",
        items: [],
      },
    },
  ] as never;
  const ctx = {
    segments,
    chapters: [{ game: "Grand Theft Auto: Vice City", year: 2002 }],
    links: { approve: "a", reject: "r", preview: "p" },
  };
  return { db, s, ctx, notices, llmCalls };
}

test("a documentary above the gate carries on, its scores kept in qa_json and an event", async () => {
  const { db, s, ctx, notices, llmCalls } = await documentary(
    await tmpDir(),
    [3, 2],
  );
  const ep = (await getEpisode(db, "doc1"))!;
  assert.equal(await releaseGateStep(s, ep, ctx), false);
  const after = (await getEpisode(db, "doc1"))!;
  assert.equal(after.status, "rendered");
  const release = after.qa_json!.release as any;
  assert.equal(release.pass, true);
  assert.equal(release.stats.shots, 2);
  assert.equal(release.stats.mean, 2.5);
  assert.equal(release.for, "2026-10-30T10:00:00.000Z");
  assert.deepEqual(
    release.shots.map((x: any) => x.score),
    [3, 2],
  );
  const events = await db.query<{ kind: string }>(
    `SELECT kind FROM events WHERE episode_id = 'doc1' ORDER BY id`,
  );
  assert.deepEqual(
    events.map((e) => e.kind),
    ["release_gate"],
  );
  assert.equal(notices.length, 1);
  assert.equal(notices[0].level, "info");
  assert.match(notices[0].content, /passed the release gate/);
  // A retry for the same render reuses the stored scores: no second model call.
  assert.equal(
    await releaseGateStep(s, (await getEpisode(db, "doc1"))!, ctx),
    false,
  );
  assert.equal(llmCalls.length, 1);
  await db.close();
});

test("a documentary below the gate is held for the owner with the worst shots, never published on its own", async () => {
  const { db, s, ctx, notices } = await documentary(await tmpDir(), [0, 2]);
  const ep = (await getEpisode(db, "doc1"))!;
  assert.equal(await releaseGateStep(s, ep, ctx), true);
  const after = (await getEpisode(db, "doc1"))!;
  assert.equal(after.status, "awaiting_approval");
  assert.equal(after.approval_mode, "manual");
  assert.equal(after.next_attempt_at, null);
  assert.equal((after.qa_json!.release as any).pass, false);
  const events = await db.query<{ kind: string }>(
    `SELECT kind FROM events WHERE episode_id = 'doc1' ORDER BY id`,
  );
  assert.deepEqual(
    events.map((e) => e.kind),
    ["release_gate", "release_gate_held"],
  );
  const held = notices.find((n) => n.ping);
  assert.ok(held, "the owner is pinged");
  assert.match(
    held.embeds[0].description,
    /50% of screen time shows the wrong thing/,
  );
  assert.match(
    held.embeds[0].description,
    /1\. 0:00 to 0:05 · score 0 · "Rockstar North moved to Edinburgh" · shot 0/,
  );
  await db.close();
});

test("a gate that cannot run lets the documentary carry on and says so", async () => {
  const { db, s, ctx, notices } = await documentary(await tmpDir(), []);
  (s.llm as any).structured = async () => {
    throw new Error("model down");
  };
  const ep = (await getEpisode(db, "doc1"))!;
  assert.equal(await releaseGateStep(s, ep, ctx), false);
  assert.equal((await getEpisode(db, "doc1"))!.status, "rendered");
  assert.match(notices[0].content, /could not check/);
  const events = await db.query<{ detail: any }>(
    `SELECT detail FROM events WHERE episode_id = 'doc1'`,
  );
  assert.match(String(events[0]!.detail.skipped), /could not be scored/);
  await db.close();
});
