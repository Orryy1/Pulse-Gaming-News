import { test } from "node:test";
import assert from "node:assert/strict";
import { goodScript, testDb, tmpDir } from "./helpers.ts";
import { segmentInputs } from "../src/pipeline.ts";
import { buildSegments } from "../src/render/timeline.ts";
import {
  actualWeakMoments,
  crossValidate,
  curveFromHazards,
  datasetItems,
  dropScore,
  FEATURES,
  featuresAt,
  gbmImportance,
  hazardBaseline,
  hazardSteps,
  modelFindings,
  modelLessonLines,
  predictFrame,
  predictGbm,
  predictRidge,
  rng,
  samplesOf,
  shortFrame,
  smoothCurve,
  spearman,
  trainGbm,
  trainModel,
  trainRidge,
  weakMoments,
  winsorise,
  type DatasetVideo,
  type RetentionModel,
  type TrainItem,
} from "../src/retentionmodel.ts";
import {
  directorMode,
  directShort,
  freshFootage,
  loadModel,
  saveModel,
  strongestImage,
  type DirectorInput,
} from "../src/retentiondirector.ts";
import {
  directorStep,
  retrainTick,
  retentionModelLessons,
} from "../src/retentionstep.ts";
import { mergeRetentionLessons } from "../src/analyticsloop.ts";

const DUR = 30;
const FPS = 30;

/** A 30-second Short: words evenly through it, five shots of 6 s of the given kinds, clips of 20 s each. */
function records(kinds: string[], o: { cardSecondary?: string } = {}) {
  const script = goodScript();
  if (o.cardSecondary !== undefined && script.beats[0]?.visual)
    script.beats[0].visual.secondary = o.cardSecondary;
  const text = segmentInputs(script, false)
    .map((s) => s.text)
    .join(" ")
    .split(/\s+/)
    .filter(Boolean);
  const step = (DUR - 1) / text.length;
  const words = text.map((t, i) => ({
    text: t,
    start: +(i * step).toFixed(3),
    end: +((i + 1) * step).toFixed(3),
  }));
  const shots = kinds.map((type, k) => ({
    start: k * 180,
    end: (k + 1) * 180,
    segment: 0,
    move: "pushIn",
    framed: false,
    luma: 100,
    media:
      type === "clip"
        ? { type, index: k % 2, trimFrom: Math.floor(k / 2) * 180 }
        : { type, index: 0 },
  }));
  return {
    lane: "news",
    script,
    assets: {
      words,
      durationSeconds: DUR - 1,
      plan: {
        version: 1,
        fps: FPS,
        totalFrames: DUR * FPS,
        tailFrames: 30,
        heroIndex: 0,
        shots,
        turns: [],
        sfx: [],
        shelf: [],
      },
      clips: [
        { durationSeconds: 20, motion: 0.6, provenance: "gameplay" },
        { durationSeconds: 20, motion: 0.4, provenance: "Official trailer" },
        { durationSeconds: 25, motion: 0.8, provenance: "gameplay" },
      ],
      images: [{ kind: "capsule", luma: 120 }],
    },
  };
}

/** A curve where viewers leave at a steady rate, twice as fast on a plain plate and half again on a still. */
function curveFor(
  kinds: string[],
  noise: () => number,
  extra = 0,
): Array<{ at: number; watch: number; relative: number }> {
  let w = 1.1;
  const out = [];
  for (let k = 1; k <= 100; k++) {
    const t = (k / 100) * DUR;
    const kind = kinds[Math.min(kinds.length - 1, Math.floor(t / 6))]!;
    const h =
      0.02 +
      (k < 5 ? 0.15 : 0) +
      (kind === "plate" ? 0.06 : kind === "image" ? 0.025 : 0) +
      extra +
      (noise() - 0.5) * 0.01;
    w *= Math.exp(-h * 0.3);
    out.push({ at: k / 100, watch: +w.toFixed(5), relative: 0.5 });
  }
  return out;
}

function synthetic(n: number, seed = 3): TrainItem[] {
  const r = rng(seed);
  const types = ["clip", "image", "plate"];
  const items: TrainItem[] = [];
  for (let v = 0; v < n; v++) {
    const kinds = Array.from({ length: 5 }, () => types[Math.floor(r() * 3)]!);
    const frame = shortFrame(records(kinds), segmentInputs)!;
    items.push({
      video: `v${v}`,
      frame,
      curve: curveFor(kinds, r),
      views: 2000,
      publishedAt: new Date(2026, 9, 1 + v).toISOString(),
    });
  }
  return items;
}

let trained: { model: RetentionModel; items: TrainItem[] } | undefined;
function model() {
  if (!trained) {
    const items = synthetic(60);
    trained = {
      items,
      model: trainModel(items, [], new Date("2026-11-14T00:00:00Z"), {
        trees: 80,
      }),
    };
  }
  return trained;
}

test("hazard steps and the curve rebuilt from them agree", () => {
  const curve = curveFor(["clip", "clip", "clip", "clip", "clip"], () => 0.5);
  const steps = hazardSteps(curve, DUR);
  assert.equal(steps.length, 99);
  const rel = curveFromHazards(
    steps,
    steps.map((s) => s.hazard),
  );
  const sm = smoothCurve(curve);
  assert.ok(Math.abs(rel.at(-1)! - sm.at(-1)!.watch / sm[0]!.watch) < 1e-6);
  // A steady rate reads back as that rate.
  assert.ok(Math.abs(steps[50]!.hazard - 0.02) < 1e-3);
});

test("the baseline is the median leaving rate at each point", () => {
  const curves = [0, 1, 2].map(() => ({
    curve: curveFor(["clip", "clip", "clip", "clip", "clip"], () => 0.5),
    duration: DUR,
  }));
  const b = hazardBaseline(curves);
  assert.equal(b.length, 101);
  assert.ok(Math.abs(b[50]! - 0.02) < 1e-3);
  assert.ok(b[3]! > b[50]!, "the opening loses more");
});

test("boosted trees learn a step and ridge a line", () => {
  const r = rng(1);
  const x = Array.from({ length: 600 }, () => [r(), r()]);
  const y = x.map((v) => (v[0]! > 0.5 ? 1 : 0) + 0.3 * v[1]!);
  const w = x.map(() => 1);
  const g = trainGbm(x, y, w, ["a", "b"], {
    trees: 120,
    minLeaf: 10,
    lambda: 0,
  });
  assert.ok(Math.abs(predictGbm(g, [0.9, 0.5]) - 1.15) < 0.12);
  assert.ok(Math.abs(predictGbm(g, [0.1, 0.5]) - 0.15) < 0.12);
  assert.equal(gbmImportance(g)[0]!.feature, "a");
  const lin = trainRidge(
    x,
    x.map((v) => 2 * v[0]! - v[1]! + 0.5),
    w,
    ["a", "b"],
    0.001,
  );
  assert.ok(Math.abs(predictRidge(lin, [0.3, 0.2]) - 0.9) < 1e-3);
});

test("winsorise clips the tails; spearman ranks", () => {
  const ys = [...Array.from({ length: 998 }, (_, i) => i / 1000), 50, -50];
  const w = winsorise(ys);
  assert.ok(Math.max(...w) < 50 && Math.min(...w) > -50);
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
});

test("weak moments: the costliest windows first, never overlapping, the end left out", () => {
  const steps = Array.from({ length: 100 }, (_, i) => ({
    from: i * 0.3,
    to: (i + 1) * 0.3,
    excess: i >= 30 && i < 35 ? 0.2 : i >= 60 && i < 63 ? 0.1 : i > 95 ? 1 : 0,
  }));
  const w = weakMoments(steps, { n: 3, seconds: 1.5 });
  assert.equal(w.length, 2);
  assert.ok(w[0]!.from >= 8.9 && w[0]!.to <= 10.6);
  assert.ok(w[1]!.from >= 17.9 && w[1]!.to <= 19.6);
  assert.deepEqual(dropScore(w, [{ from: 9, to: 10, excess: 0 }]), {
    caught: 1,
    hit: 1,
  });
});

test("features read the shot, card, words and part at a moment", () => {
  const f = shortFrame(
    records(["plate", "clip", "image", "clip", "clip"]),
    segmentInputs,
  )!;
  assert.equal(f.duration, DUR);
  const at = (t: number, n: string) =>
    featuresAt(f, t - 0.1, t + 0.1)[FEATURES.indexOf(n as never)]!;
  assert.equal(at(3, "shot_plate"), 1);
  assert.equal(at(8, "shot_clip"), 1);
  assert.equal(at(14, "shot_still"), 1);
  assert.equal(at(0.5, "part_hook"), 1);
  assert.equal(at(0.5, "opening"), 1);
  assert.equal(at(8, "opening"), 0);
  assert.ok(at(14, "wps") > 1);
  assert.equal(at(3, "v_open_plate"), 1);
  assert.equal(at(6.05, "cut_here"), 1);
  assert.equal(FEATURES.length, featuresAt(f, 1, 1.3).length);
});

test("frames need records: no words, no plan, no frame", () => {
  const r = records(["clip"]);
  assert.equal(
    shortFrame({ ...r, assets: { ...r.assets, words: [] } }, segmentInputs),
    undefined,
  );
  assert.equal(
    shortFrame({ ...r, assets: { ...r.assets, plan: {} } }, segmentInputs),
    undefined,
  );
  assert.equal(shortFrame({ ...r, script: null }, segmentInputs), undefined);
});

test("the model learns that plates and stills lose viewers, held out", () => {
  const items = synthetic(50, 5);
  const { validation } = crossValidate(items, [], 5, { trees: 60 });
  assert.ok(
    validation.withinSpearman.gbm > 0.3,
    `within-video rank correlation ${validation.withinSpearman.gbm}`,
  );
  assert.ok(
    validation.curveMae.gbm < validation.curveMae.baseline,
    "beats the usual curve",
  );
  assert.ok(
    validation.drops.precision > validation.drops.randomPrecision,
    "flags beat chance",
  );
  const { model: m } = model();
  const plate = predictFrame(
    m,
    shortFrame(
      records(["plate", "plate", "plate", "plate", "plate"]),
      segmentInputs,
    )!,
  );
  const clip = predictFrame(
    m,
    shortFrame(
      records(["clip", "clip", "clip", "clip", "clip"]),
      segmentInputs,
    )!,
  );
  assert.ok(clip.avg > plate.avg + 0.02);
  const findings = modelFindings(
    m,
    items.flatMap((i) =>
      samplesOf(i.video, i.frame, m.baseline, i.curve).map((s) => s.x),
    ),
  );
  const p = findings.find((x) => x.feature === "shot_plate");
  assert.ok(p && p.points > 0, "plates cost viewers");
});

test("lesson lines need a model that ranks moments better than nothing", () => {
  const { model: m } = model();
  assert.deepEqual(
    modelLessonLines({ ...m, validation: undefined }, "2026-11-14"),
    [],
  );
  const withV = {
    ...m,
    validation: { withinSpearman: { gbm: 0.3, ridge: 0.2 } } as any,
    findings: [
      {
        feature: "shot_plate",
        what: "a plain plate (no picture) on screen",
        points: 4.2,
        share: 0.1,
      },
      {
        feature: "shot_clip",
        what: "moving footage on screen",
        points: -3.1,
        share: 0.1,
      },
      { feature: "x", what: "tiny", points: 0.2, share: 0 },
    ],
  };
  const lines = modelLessonLines(withV, "2026-11-14");
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /A plain plate .* costs a Short about 4\.2 points/);
  assert.match(lines[1]!, /Moving footage on screen holds about 3\.1 points/);
  assert.deepEqual(mergeRetentionLessons(["a", "b", "c"], ["m1", "m2"]), [
    "a",
    "b",
    "m1",
    "c",
    "m2",
  ]);
});

function directorInput(kinds: string[], cardSecondary?: string): DirectorInput {
  const r = records(kinds, { cardSecondary });
  return {
    lane: "news",
    script: r.script,
    words: r.assets.words,
    spokenSeconds: r.assets.durationSeconds,
    segments: buildSegments(
      segmentInputs(r.script, false),
      r.assets.words,
      r.assets.durationSeconds + 1,
    ),
    plan: structuredClone(r.assets.plan) as any,
    images: r.assets.images,
    clips: r.assets.clips,
  };
}

test("the director: off does nothing, advise changes nothing, fix swaps plates for fresh footage", () => {
  const { model: m } = model();
  assert.equal(directorMode("FIX"), "fix");
  assert.equal(directorMode("maybe"), "off");
  const kinds = ["clip", "plate", "clip", "plate", "clip"];
  assert.equal(
    directShort(m, directorInput(kinds), "off", segmentInputs),
    undefined,
  );
  const adv = directorInput(kinds);
  const before = JSON.stringify(adv.plan);
  const ra = directShort(m, adv, "advise", segmentInputs)!;
  assert.equal(
    JSON.stringify(adv.plan),
    before,
    "advise leaves the plan alone",
  );
  assert.ok(ra.weak.length >= 1);
  assert.ok(ra.fixes.length >= 1, "it proposes fixes");
  const fix = directorInput(kinds);
  const rf = directShort(m, fix, "fix", segmentInputs)!;
  assert.ok(rf.after! > rf.predicted, `${rf.after} > ${rf.predicted}`);
  const plates = fix.plan.shots.filter((s) => s.media.type === "plate").length;
  assert.ok(plates < 2, "a plate took footage");
  // The swapped footage is footage not shown yet.
  for (const s of fix.plan.shots.filter((x) => x.media.type === "clip")) {
    const others = fix.plan.shots.filter(
      (o) =>
        o !== s && o.media.type === "clip" && o.media.index === s.media.index,
    );
    for (const o of others) {
      const a = [
        s.media.trimFrom ?? 0,
        (s.media.trimFrom ?? 0) + s.end - s.start,
      ];
      const b = [
        o.media.trimFrom ?? 0,
        (o.media.trimFrom ?? 0) + o.end - o.start,
      ];
      assert.ok(
        a[1]! <= b[0]! || b[1]! <= a[0]!,
        "no frame of footage shown twice",
      );
    }
  }
});

test("fresh footage: only clips with enough unused frames, the line's own first", () => {
  const plan = directorInput(["clip", "clip", "clip", "plate", "plate"]).plan;
  const clips = [
    { durationSeconds: 7 },
    { durationSeconds: 20, beatIndex: 1 },
    { durationSeconds: 20, beatIndex: 0, motion: 0.1 },
  ];
  // Clip 0 has used 12 s of 7 s; clip 1 has used 6 s; clip 2 none.
  const got = freshFootage(plan, clips, 180, 0).map((c) => c.index);
  assert.deepEqual(got, [2, 1]);
  assert.equal(freshFootage(plan, clips, 180, 0)[1]!.trimFrom, 180);
  assert.equal(
    strongestImage([{ luma: 50 }, { luma: 200, wordy: true }, { luma: 150 }]),
    2,
  );
  assert.equal(strongestImage([{ luma: 50 }, { role: "hook" }]), 1);
});

test("directorStep: once per episode, retries repeat the card trims, no model is recorded", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  const cfg = { retentionDirector: "fix" as const, dataDir: dir };
  const now = () => new Date("2026-11-14T12:00:00Z");
  const inp = directorInput(["clip", "plate", "clip", "plate", "clip"]);
  const assets: any = {
    durationSeconds: inp.spokenSeconds,
    images: inp.images,
    clips: inp.clips,
  };
  await directorStep(
    { db, cfg, now },
    { id: "e1", lane: "news" },
    {
      assets,
      script: inp.script,
      words: inp.words,
      segments: inp.segments,
      plan: inp.plan,
      segmentsOf: segmentInputs,
    },
  );
  assert.equal(assets.retention.skipped, "no trained model yet");
  saveModel(dir, model().model);
  assert.ok(loadModel(dir));
  const assets2: any = {
    durationSeconds: inp.spokenSeconds,
    images: inp.images,
    clips: inp.clips,
  };
  await directorStep(
    { db, cfg, now },
    { id: "e2", lane: "news" },
    {
      assets: assets2,
      script: inp.script,
      words: inp.words,
      segments: inp.segments,
      plan: inp.plan,
      segmentsOf: segmentInputs,
    },
  );
  assert.ok(assets2.retention.report, "a report");
  const ev = await db.query<{ kind: string }>(
    `SELECT kind FROM events WHERE episode_id = 'e2'`,
  );
  assert.ok(ev.some((e) => e.kind === "retention_director"));
  // A retry with stored trims puts them back on fresh segments and runs nothing again.
  const segs = buildSegments(
    segmentInputs(inp.script, false),
    inp.words,
    inp.spokenSeconds + 1,
  );
  const k = segs.findIndex(
    (g) => g.visual && g.visual.kind !== "none" && g.kind === "beat",
  );
  const retry: any = {
    retention: {
      at: "x",
      mode: "fix",
      cardTrims: [{ segment: k, dropSecondary: true }],
    },
  };
  await directorStep(
    { db, cfg, now },
    { id: "e3", lane: "news" },
    {
      assets: retry,
      script: inp.script,
      words: inp.words,
      segments: segs,
      plan: inp.plan,
      segmentsOf: segmentInputs,
    },
  );
  assert.equal(segs[k]!.visual!.secondary, "");
  // Long videos and "off" are left alone.
  const off: any = {};
  await directorStep(
    { db, cfg: { ...cfg, retentionDirector: "off" }, now },
    { id: "e4", lane: "news" },
    {
      assets: off,
      script: inp.script,
      words: inp.words,
      segments: inp.segments,
      plan: inp.plan,
      segmentsOf: segmentInputs,
    },
  );
  assert.equal(off.retention, undefined);
  await db.close();
});

test("retrainTick: off or too few curves trains nothing; lessons only with a model", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  const now = () => new Date("2026-11-14T12:00:00Z");
  assert.equal(
    await retrainTick({
      db,
      cfg: { retentionDirector: "off", dataDir: dir },
      now,
      segmentsOf: segmentInputs,
    }),
    undefined,
  );
  assert.equal(
    await retrainTick({
      db,
      cfg: { retentionDirector: "advise", dataDir: dir },
      now,
      segmentsOf: segmentInputs,
    }),
    undefined,
  );
  assert.deepEqual(
    retentionModelLessons({ retentionDirector: "advise", dataDir: dir }, now()),
    [],
  );
  await db.close();
});

test("datasetItems: Shorts with records train, the rest teach the baseline", () => {
  const kinds = ["clip", "image", "clip", "plate", "clip"];
  const r = records(kinds);
  const curve = curveFor(kinds, () => 0.5);
  const vids: DatasetVideo[] = [
    {
      videoId: "a",
      title: "a",
      publishedAt: "2026-11-02",
      duration: 30,
      views: 100,
      curve,
      episode: { id: "e", ...r },
    },
    {
      videoId: "b",
      title: "b",
      publishedAt: "2026-05-01",
      duration: 40,
      views: 100,
      curve,
    },
    {
      videoId: "c",
      title: "c",
      publishedAt: "2026-05-01",
      duration: 600,
      views: 100,
      curve,
    },
    {
      videoId: "d",
      title: "d",
      publishedAt: "2026-05-01",
      duration: 30,
      views: 100,
      curve: curve.slice(0, 5),
    },
  ];
  const got = datasetItems(vids, segmentInputs);
  assert.equal(got.items.length, 1);
  assert.equal(got.extra.length, 1);
  assert.ok(
    actualWeakMoments(curve, 30, hazardBaseline([{ curve, duration: 30 }]))
      .length <= 3,
  );
});
