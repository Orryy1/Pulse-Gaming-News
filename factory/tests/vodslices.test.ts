// The stream index in short turns (26 Nov 2026, src/vodindex/slices.ts): two NVIDIA driver resets inside Ollama's
// vision model came while one 90-to-110-minute stream-index turn held the GPU. Now each slice is at most 18 minutes in
// its own orchestrator turn with an --est from measured rates, Whisper and SigLIP run on the CPU, and no piece of the
// index's work runs outside a turn.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "./helpers.ts";
import {
  DEFAULT_RATES,
  SLICE_MARGIN,
  indexInSlices,
  stopsRun,
  inTurn,
  learnRate,
  loadRates,
  minutesPerStreamHour,
  planSlice,
  saveRates,
  sliceCap,
  type PlanInput,
  type SlicePlan,
  type VodRates,
  type VodWork,
} from "../src/vodindex/slices.ts";
import { vodIndexStep } from "../src/vodindex/build.ts";

const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  work: "tag",
  left: 400,
  rates: DEFAULT_RATES,
  capMinutes: 18,
  chunkSeconds: 1200,
  whisperDevice: "cpu",
  semanticDevice: "cpu",
  ...over,
});

test("slices: a tag slice fits 18 minutes at the measured 34 s a stretch, in a gpu turn of its own kind", () => {
  const p = planSlice(base());
  assert.equal(p.cls, "gpu");
  assert.equal(p.kind, "pulse:vodtag");
  assert.equal(p.units, Math.floor((18 * 60) / (34 * SLICE_MARGIN)));
  assert.equal(p.units, 27);
  assert.equal(p.est, 18);
  // A few left: just those, and an --est for just those.
  const few = planSlice(base({ left: 5 }));
  assert.equal(few.units, 5);
  assert.equal(few.est, Math.ceil((5 * 34 * SLICE_MARGIN) / 60));
});

test("slices: no slice ever plans past its cap or 20 minutes, however slow a step has been", () => {
  for (const work of ["stretch", "describe", "tag", "embed"] as const)
    for (const scale of [0.01, 1, 10, 1000])
      for (const cap of [5, 18, 20]) {
        const rates = Object.fromEntries(
          Object.entries(DEFAULT_RATES).map(([k, v]) => [k, v * scale]),
        ) as unknown as VodRates;
        const p = planSlice(
          base({
            work,
            rates,
            capMinutes: cap,
            left: work === "stretch" ? 15389 : 2000,
          }),
        );
        assert.ok(
          p.est >= 1 && p.est <= cap && p.est <= 20,
          `${work} x${scale} cap ${cap}: est ${p.est}`,
        );
        assert.ok(p.units >= 1, `${work} x${scale}: at least one unit`);
      }
});

test("slices: stretch chunks shrink to fit a turn when CPU Whisper is slow, and run in a cpu turn", () => {
  // 0.8 s a second of recording (CPU Whisper medium): a 20-minute chunk would not fit 18 minutes.
  const slow = planSlice(
    base({
      work: "stretch",
      left: 15389,
      rates: { ...DEFAULT_RATES, stretch: 0.8 },
    }),
  );
  assert.equal(slow.cls, "cpu");
  assert.equal(slow.kind, "pulse:vodstretch");
  assert.equal(slow.units, 1);
  assert.ok(slow.chunkSeconds! < 1200 && slow.chunkSeconds! % 60 === 0);
  assert.ok(slow.chunkSeconds! * 0.8 * SLICE_MARGIN <= 18 * 60);
  assert.ok(slow.est <= 18);
  // Fast: whole 20-minute chunks, as many as fit.
  const fast = planSlice(
    base({
      work: "stretch",
      left: 15389,
      rates: { ...DEFAULT_RATES, stretch: 0.2 },
    }),
  );
  assert.equal(fast.chunkSeconds, 1200);
  assert.equal(fast.units, Math.floor((18 * 60) / (1200 * 0.2 * SLICE_MARGIN)));
  // The last bit of a recording: one chunk and an --est for what is left.
  const tail = planSlice(
    base({
      work: "stretch",
      left: 300,
      rates: { ...DEFAULT_RATES, stretch: 0.2 },
    }),
  );
  assert.equal(tail.units, 1);
  assert.equal(tail.est, Math.ceil((300 * 0.2 * SLICE_MARGIN) / 60));
  // Whisper moved back to CUDA by hand: the stretch slice then needs a gpu turn.
  assert.equal(
    planSlice(base({ work: "stretch", whisperDevice: "cuda" })).cls,
    "gpu",
  );
});

test("slices: SigLIP on the CPU takes a cpu turn, on CUDA a gpu one; descriptions always a gpu one", () => {
  assert.equal(planSlice(base({ work: "embed", left: 1543 })).cls, "cpu");
  assert.equal(
    planSlice(base({ work: "embed", left: 1543, semanticDevice: "cuda" })).cls,
    "gpu",
  );
  assert.equal(
    planSlice(base({ work: "embed", left: 1543, semanticDevice: "auto" })).cls,
    "gpu",
  );
  assert.equal(planSlice(base({ work: "describe", left: 50 })).cls, "gpu");
  assert.equal(
    planSlice(base({ work: "embed", left: 1543 })).kind,
    "pulse:vodembed",
  );
});

test("slices: VOD_SLICE_MINUTES is 18 by default and held between 5 and 20", () => {
  assert.equal(sliceCap({}), 18);
  assert.equal(sliceCap({ VOD_SLICE_MINUTES: "12" }), 12);
  assert.equal(sliceCap({ VOD_SLICE_MINUTES: "45" }), 20);
  assert.equal(sliceCap({ VOD_SLICE_MINUTES: "2" }), 5);
  assert.equal(sliceCap({ VOD_SLICE_MINUTES: "lots" }), 18);
});

test("slices: a slice's real time moves the learned rate a third of the way, within bounds; nothing learned from nothing", () => {
  const r = learnRate(DEFAULT_RATES, "tag", 60 * 20, 30); // 40 s a stretch
  assert.equal(r.tag, Math.round(((34 * 2) / 3 + 40 / 3) * 10000) / 10000);
  assert.equal(r.stretch, DEFAULT_RATES.stretch);
  assert.equal(learnRate(DEFAULT_RATES, "tag", 0, 30), DEFAULT_RATES);
  assert.equal(learnRate(DEFAULT_RATES, "tag", 100, 0), DEFAULT_RATES);
  let wild = DEFAULT_RATES;
  for (let i = 0; i < 50; i++) wild = learnRate(wild, "embed", 1e6, 1);
  assert.equal(wild.embed, DEFAULT_RATES.embed * 20);
});

test("slices: rates are kept beside the indexes; a broken file falls back to the measured defaults", async () => {
  const dir = await tmpDir();
  assert.deepEqual(await loadRates(dir), DEFAULT_RATES);
  await saveRates(dir, { ...DEFAULT_RATES, tag: 40 });
  assert.equal((await loadRates(dir)).tag, 40);
  await fsp.writeFile(path.join(dir, "vodindex", "rates.json"), "{not json");
  assert.deepEqual(await loadRates(dir), DEFAULT_RATES);
  await fsp.writeFile(
    path.join(dir, "vodindex", "rates.json"),
    JSON.stringify({ tag: -1, stretch: 0.5 }),
  );
  const mixed = await loadRates(dir);
  assert.equal(mixed.tag, DEFAULT_RATES.tag);
  assert.equal(mixed.stretch, 0.5);
});

test("slices: a stream-hour at the measured rates, per step", () => {
  const m = minutesPerStreamHour({
    ...DEFAULT_RATES,
    stretch: 0.5,
    embed: 0.1,
  });
  assert.equal(m.stretch, 30);
  assert.equal(m.tag, 68);
  assert.equal(m.embed, Math.round(((680 * 0.1) / 60) * 10) / 10);
});

test("inTurn: one lease per slice at p20 with its --est and kind, released even when the work throws", async () => {
  const leases: Array<{ cls: string; o: Record<string, unknown> }> = [];
  let held = 0;
  const deps = {
    now: () => 1_000_000,
    lease: async (cls: "gpu" | "cpu", o: any) => {
      leases.push({ cls, o });
      held++;
      return () => {
        held--;
      };
    },
  };
  const plan: SlicePlan = {
    work: "tag",
    cls: "gpu",
    kind: "pulse:vodtag",
    units: 27,
    est: 18,
  };
  const ok = await inTurn(
    plan,
    "v1",
    deps,
    async (until) => {
      assert.equal(held, 1);
      assert.equal(until, 1_000_000 + 18 * 60_000 * 1.1);
      return "tagged";
    },
    90,
  );
  assert.equal(ok.result, "tagged");
  assert.equal(held, 0);
  assert.deepEqual(leases[0], {
    cls: "gpu",
    o: {
      job: "vodpc: tag v1 (27 stretches, 18 min)",
      kind: "pulse:vodtag",
      est: 18,
      priority: 20,
      maxWait: 90,
    },
  });
  await assert.rejects(
    inTurn(plan, "v1", deps, async () => {
      throw new Error("ffmpeg died");
    }),
  );
  assert.equal(held, 0, "released after a failure");
});

/** A stand-in index: what is left of each step, worked down by the step calls. */
function fakeIndex(
  left: Partial<Record<VodWork, number>>,
  o: { vision?: boolean; leaseFails?: boolean; stepMs?: number; stepFails?: boolean; wordsStuck?: boolean } = {},
) {
  const state = {
    stretch: 0,
    describe: 0,
    tag: 0,
    words: 0,
    embed: 0,
    ...left,
  };
  const order = ["stretch", "describe", "tag", "words", "embed"] as const;
  let now = 0;
  let held: string | undefined;
  const calls: Array<{
    work: string;
    held: string | undefined;
    units?: number;
    est?: number;
  }> = [];
  const leases: Array<{
    cls: string;
    kind: string;
    est: number;
    priority: number;
  }> = [];
  const logs: string[] = [];
  let saved: VodRates | undefined;
  const deps = {
    now: () => now,
    lease: async (cls: "gpu" | "cpu", l: any) => {
      if (o.leaseFails) throw new Error("no turn within 90 min");
      assert.equal(held, undefined, "never two turns at once");
      leases.push({ cls, kind: l.kind, est: l.est, priority: l.priority });
      held = l.kind;
      return () => {
        held = undefined;
      };
    },
    next: async () => {
      for (const w of order)
        if (state[w] > 0) return { work: w as VodWork, left: state[w] };
      return { work: "done" as VodWork, left: 0 };
    },
    step: async (plan: SlicePlan | undefined) => {
      const w = plan?.work ?? "words";
      calls.push({ work: w, held, units: plan?.units, est: plan?.est });
      if (w === "words") {
        now += 1000;
        if (o.wordsStuck) return "waiting";
        state.words = 0;
        return "tagged";
      }
      if (o.stepFails) throw new Error("ffmpeg exited 1");
      const per = w === "stretch" ? plan!.chunkSeconds! : 1;
      const did = Math.min(state[w], (w === "stretch" ? 1 : plan!.units) * per);
      state[w] -= did;
      // Each unit takes as long as the measured rate says (or a fixed time a call, to test the run's end).
      now += o.stepMs ?? did * DEFAULT_RATES[w] * 1000;
      return w === "stretch"
        ? "stretch"
        : w === "tag"
          ? "tagged"
          : w === "embed"
            ? "embedded"
            : "described";
    },
    visionUp: async () => o.vision ?? true,
    saveRates: async (r: VodRates) => {
      saved = r;
    },
    log: (l: string) => {
      logs.push(l);
    },
  };
  return {
    deps,
    calls,
    leases,
    logs,
    state,
    saved: () => saved,
    advance: (ms: number) => (now += ms),
  };
}

const run = (until = 10 * 3_600_000) => ({
  label: "v2937253081",
  until,
  rates: DEFAULT_RATES,
  capMinutes: 18,
  chunkSeconds: 1200,
  whisperDevice: "cpu",
  semanticDevice: "cpu",
});

test("indexInSlices: every piece of work but the words runs inside its own turn, each turn under 20 minutes", async () => {
  // A 4.3-hour stream from scratch: 15,389 s to cover, 532 stretches to tag, the words, 1,895 shots to embed.
  const f = fakeIndex({ stretch: 15389, tag: 532, words: 1, embed: 1895 });
  const out = await indexInSlices(run(), f.deps);
  assert.equal(out.stopped, "done");
  for (const c of f.calls) {
    if (c.work === "words")
      assert.equal(c.held, undefined, "words need no turn");
    else
      assert.equal(
        c.held,
        `pulse:vod${c.work}`,
        `${c.work} ran inside its own turn`,
      );
  }
  assert.ok(f.leases.every((l) => l.est <= 18 && l.priority === 20));
  assert.ok(
    f.leases
      .filter((l) => l.kind === "pulse:vodtag")
      .every((l) => l.cls === "gpu"),
  );
  assert.ok(
    f.leases
      .filter((l) => l.kind !== "pulse:vodtag")
      .every((l) => l.cls === "cpu"),
    "Whisper and SigLIP on the CPU",
  );
  // Tags: 532 stretches in slices of at most 27 (18 minutes at 34 s), not one 5-hour turn.
  const tagTurns = f.leases.filter((l) => l.kind === "pulse:vodtag").length;
  assert.ok(tagTurns >= Math.ceil(532 / 27), `tag turns ${tagTurns}`);
  assert.ok(out.slices === f.leases.length);
  assert.ok(f.saved(), "the rates learned from the slices are kept");
  assert.deepEqual(f.state, {
    stretch: 0,
    describe: 0,
    tag: 0,
    words: 0,
    embed: 0,
  });
});

test("indexInSlices: stops at the run's end, when the vision model is away, or when no turn comes", async () => {
  const late = fakeIndex({ tag: 200 }, { stepMs: 20 * 60_000 });
  const t = await indexInSlices(run(30 * 60_000), late.deps);
  assert.equal(t.stopped, "time");
  assert.equal(late.leases.length, 2, "no new turn once the run's time is up");

  const away = fakeIndex({ tag: 200 }, { vision: false });
  assert.equal((await indexInSlices(run(), away.deps)).stopped, "vision-away");
  assert.equal(
    away.leases.length,
    0,
    "no GPU turn taken for a model that is not there",
  );

  const busy = fakeIndex({ embed: 100 }, { leaseFails: true });
  assert.equal((await indexInSlices(run(), busy.deps)).stopped, "no-turn");
  assert.equal(busy.calls.length, 0, "nothing runs without its turn");
  assert.match(busy.logs[0]!, /no turn for embed/);
  assert.ok(stopsRun("no-turn") && stopsRun("vision-away") && stopsRun("time"));
});

test("indexInSlices: a recording whose work fails or stalls stops alone, released, and the run goes on", async () => {
  const broken = fakeIndex({ stretch: 3600 }, { stepFails: true });
  const out = await indexInSlices(run(), broken.deps);
  assert.equal(out.stopped, "failed");
  assert.equal(broken.leases.length, 1);
  assert.match(broken.logs[0]!, /stretch failed on v2937253081: ffmpeg exited 1/);
  assert.doesNotMatch(broken.logs[0]!, /no turn/);
  assert.equal(stopsRun(out.stopped), false, "the next recording still gets its turn");
  // Words bookkeeping that changes nothing is not asked for again and again.
  const stuck = fakeIndex({ words: 1, embed: 10 }, { wordsStuck: true });
  const s = await indexInSlices(run(), stuck.deps);
  assert.equal(s.stopped, "no-progress");
  assert.equal(stuck.calls.length, 1);
  assert.equal(stopsRun(s.stopped), false);
});

test("indexInSlices: a describe slice and a stretch slice of several chunks stop at the slice's own deadline", async () => {
  const d = fakeIndex({ describe: 500 });
  await indexInSlices(run(), d.deps);
  assert.ok(d.leases.length >= 2 && d.leases.every((l) => l.cls === "gpu" && l.kind === "pulse:voddescribe" && l.est <= 18));
  // Chunks far slower than planned: the slice stops after the chunk that passes its deadline.
  const slow = fakeIndex({ stretch: 15389 }, { stepMs: 15 * 60_000 });
  const fast = { ...run(), rates: { ...DEFAULT_RATES, stretch: 0.1 } };
  await indexInSlices({ ...fast, until: 1 }, slow.deps);
  const firstTurn = slow.calls.filter((c) => c.work === "stretch");
  assert.ok(firstTurn[0]!.units! >= 3, "planned several chunks");
  assert.equal(firstTurn.length, 2, "two 15-minute chunks, then the 18-minute turn was over");
});

test("vodIndexStep: a call made for one kind of work never starts another (only)", async () => {
  const dataDir = await tmpDir();
  const file = path.join(dataDir, "2026-11-22 GTA 6 [v1].mp4");
  // A new index has a gap to cover; a call made for tags answers waiting and runs nothing (no ffmpeg, no Whisper).
  const r = await vodIndexStep(
    file,
    "Grand Theft Auto VI",
    {
      dataDir,
      whisperPython: "",
      ocrFps: 0,
      chunkSeconds: 1200,
      describeBatch: 10,
      only: "tag",
    },
    { duration: async () => 3600 },
  );
  assert.equal(r.did, "waiting");
  assert.equal(r.index.coverage.length, 0);
});

test("stream recordings task: no single orchestrator turn round the whole index; Whisper can run on the CPU", () => {
  const root = path.join(import.meta.dirname, "..");
  const ps = fs.readFileSync(
    path.join(root, "windows", "vod-daily.ps1"),
    "utf8",
  );
  assert.doesNotMatch(
    ps,
    /\brun\b[^\n]*vodpc\.ts index/,
    "vodpc.ts takes its own turns per slice",
  );
  assert.match(ps, /node --import tsx src\/tools\/vodpc\.ts index --hours \d/);
  const py = fs.readFileSync(
    path.join(root, "src", "qa", "whisperwords.py"),
    "utf8",
  );
  assert.match(py, /WHISPER_DEVICE/);
  assert.match(py, /device="cpu", compute_type="int8"/);
  // The stream tools default Whisper and SigLIP to the CPU; nothing in them asks for CUDA itself.
  for (const f of ["src/tools/vodpc.ts", "src/tools/vodindex.ts"]) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    assert.match(src, /VOD_SEMANTIC_DEVICE \|\| "cpu"/, f);
    assert.match(src, /VOD_WHISPER_DEVICE \|\| "cpu"/, f);
    assert.doesNotMatch(src, /"cuda"/, f);
  }
  // The hand tool needs a gpu turn itself, not just any turn.
  const tool = fs.readFileSync(path.join(root, "src", "tools", "vodindex.ts"), "utf8");
  assert.match(tool, /ORCH_HELD \?\? ""\)\.split\(","\)\.includes\("gpu"\)/);
});
