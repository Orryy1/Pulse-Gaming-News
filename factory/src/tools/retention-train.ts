// Trains and validates the retention model from a dataset (src/tools/retention-dataset.ts) and writes the model, its
// held-out scores, the backtest on the newest Shorts and the findings. Pure computation: no network, no database.
//   node --import tsx src/tools/retention-train.ts <dataset.json> <out dir> [--backtest=30]
import fs from "node:fs";
import path from "node:path";
import { segmentInputs } from "../pipeline.ts";
import { buildSegments } from "../render/timeline.ts";
import { baselineOf, findDrops } from "../retentionlearn.ts";
import { directShort, type DirectorInput } from "../retentiondirector.ts";
import {
  crossValidate,
  dropScore,
  RANDOM_SETS,
  randomFlags,
  rng,
  datasetItems,
  evaluateSplit,
  FEATURES,
  gbmImportance,
  stableFindings,
  modelLessonLines,
  samplesOf,
  shortFrame,
  trainModel,
  type BaselineItem,
  type DatasetVideo,
  type TrainItem,
} from "../retentionmodel.ts";

const [dsFile, outArg] = process.argv.slice(2);
if (!dsFile || !outArg)
  throw new Error("usage: retention-train.ts <dataset.json> <out dir>");
const outDir = path.resolve(outArg);
const backtestN = Number(
  process.argv.find((a) => a.startsWith("--backtest="))?.split("=")[1] ?? 30,
);
const ds = JSON.parse(fs.readFileSync(dsFile, "utf8")) as {
  at: string;
  uploads: number;
  videos: DatasetVideo[];
};
const { items, extra, skipped } = datasetItems(ds.videos, segmentInputs);
console.log(
  `uploads ${ds.uploads}; curves ${ds.videos.filter((v) => v.curve.length >= 20).length}; Shorts with records ${items.length}; baseline-only Shorts ${extra.length}; skipped ${skipped}`,
);

const titles = new Map(ds.videos.map((v) => [v.videoId, v.title]));
const cv = crossValidate(items, extra, 5);
console.log("5-fold by video:", JSON.stringify(cv.validation));
// The backtest: the newest N Shorts, each predicted by a model trained only on the Shorts published before it.
const cut = items.length - backtestN;
const bt = evaluateSplit(items, extra, (_, k) => (k >= cut ? 0 : -1), 1);
console.log(
  `backtest on the newest ${backtestN}:`,
  JSON.stringify(bt.validation),
);
// The same backtest against RETENTION_LEARN's own drop finder (src/retentionlearn.ts findDrops: runs where viewers left
// at more than twice our usual loss, costing at least 2 points), the factory's existing definition of a real drop. That
// finder leaves out the first 2 s and the last tenth, so flags there are left out of this comparison too.
const btModel = trainModel(items.slice(0, cut), extra, new Date(items[cut]!.publishedAt!));
const learnBase = baselineOf([...extra, ...items.slice(0, cut).map((i) => ({ curve: i.curve, duration: i.frame.duration }))]);
const rand = rng(5);
const learnScore = { real: 0, caught: 0, flagged: 0, hit: 0, chanceCaught: 0, chanceHit: 0, videosWithDrops: 0, videosCaught: 0 };
const learnRows = bt.perVideo.map((h) => {
  const it = items.find((i) => i.video === h.video)!;
  const real = findDrops(it.curve, it.frame.duration, learnBase).map((d) => ({ from: d.from, to: d.to, excess: d.excess }));
  const inBody = (m: { from: number; to: number }) => m.to > 2 && m.from < it.frame.duration * 0.9;
  const flags = h.flagged.filter(inBody);
  const d = dropScore(real, flags);
  learnScore.real += real.length;
  learnScore.caught += d.caught;
  learnScore.flagged += flags.length;
  learnScore.hit += d.hit;
  if (real.length) learnScore.videosWithDrops++;
  if (d.caught) learnScore.videosCaught++;
  for (let k = 0; k < RANDOM_SETS; k++) {
    const r = randomFlags(it.frame.duration, Math.max(1, flags.length), 1.5, rand).map((m) => ({ ...m, from: Math.max(2, m.from), to: Math.max(2, m.from) + 1.5 }));
    const q = dropScore(real, r);
    learnScore.chanceCaught += q.caught / RANDOM_SETS;
    learnScore.chanceHit += q.hit / RANDOM_SETS;
  }
  return { video: h.video, title: titles.get(h.video), real, flagged: flags, caught: d.caught, hit: d.hit };
});
console.log("backtest against RETENTION_LEARN's drops:", JSON.stringify(learnScore));
// The director on the backtest Shorts, as it would have run before each went out (the model that had not seen it).
const byVideo = new Map(ds.videos.map((v) => [v.videoId, v]));
const director = items.slice(cut).map((it) => {
  const ep = byVideo.get(it.video)!.episode!;
  const a = ep.assets;
  const words = a.words;
  const input: DirectorInput = {
    lane: ep.lane,
    script: ep.script!,
    words,
    spokenSeconds: Number(a.durationSeconds),
    segments: buildSegments(segmentInputs(ep.script!, Boolean(a.desk)), words, Number(a.durationSeconds) + 1),
    plan: structuredClone(a.plan),
    images: a.images ?? [],
    clips: a.clips ?? [],
    gameAudio: ep.gameAudio,
    desk: Boolean(a.desk),
  };
  const r = directShort(btModel, input, "fix", segmentInputs);
  return { video: it.video, episode: ep.id, title: titles.get(it.video), report: r, plan: r?.fixes.length ? input.plan : undefined };
});
console.log("director on the backtest Shorts:", director.map((d) => `${d.video} ${d.report?.predicted}->${d.report?.after ?? "-"} fixes ${d.report?.fixes.length}`).join("; "));
const model = trainModel(items, extra, new Date());
model.validation = cv.validation;
const rows = items.flatMap((i) =>
  samplesOf(i.video, i.frame, model.baseline, i.curve, i.views).map((s) => s.x),
);
model.findings = stableFindings(model, cv.models, rows);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "retention-model.json"),
  JSON.stringify(model),
);
fs.writeFileSync(path.join(outDir, "backtest-model.json"), JSON.stringify(btModel));
fs.writeFileSync(path.join(outDir, "director-backtest.json"), JSON.stringify(director, null, 1));
fs.writeFileSync(
  path.join(outDir, "validation.json"),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      uploads: ds.uploads,
      curves: ds.videos.filter((v) => v.curve.length >= 20).length,
      shorts: items.length,
      baselineOnly: extra.length,
      features: FEATURES.length,
      crossValidation: cv.validation,
      backtest: { n: backtestN, ...bt.validation },
      backtestLearnDrops: { ...learnScore, rows: learnRows },
      backtestVideos: bt.perVideo.map((h) => ({
        video: h.video,
        title: titles.get(h.video),
        duration: h.duration,
        real: h.real,
        flagged: h.flagged,
        rel: h.rel,
        relG: h.relG,
        relB: h.relB,
      })),
      importance: gbmImportance(model.gbm).slice(0, 20),
      findings: model.findings,
      lessons: modelLessonLines(
        model,
        new Date().toISOString().slice(0, 10),
        6,
        0.5,
      ),
    },
    null,
    1,
  ),
);
console.log(
  "importance:",
  gbmImportance(model.gbm)
    .slice(0, 12)
    .map((x) => `${x.feature} ${(x.share * 100).toFixed(1)}%`)
    .join(", "),
);
console.log(
  "findings:",
  model.findings
    .slice(0, 10)
    .map((f) => `${f.what}: ${f.points}`)
    .join("; "),
);
console.log(`written to ${outDir}`);
