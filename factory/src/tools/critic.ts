// The finished-video critic by hand (CRITIC, src/criticstep.ts), over renders already made: the proof runs and any
// re-check of a published video. Reads episode rows from a JSON dump (id, lane, script_json, assets_json, story_json)
// and each video from <src>/<episode>/short.mp4. Nothing is written to the database and nothing is uploaded.
//   node --import tsx src/tools/critic.ts --rows=<rows.json> --src=<dir> --out=<dir> [--episodes=a,b] [--model=<ollama model>]
//        [--every=2] [--no-lease] [--measure-only] [--gfx-fix]
// --no-lease: the caller already holds the GPU turn (orch.cmd run --class gpu ... -- node ... --no-lease).
// --measure-only: the ffmpeg measurements and the timeline, no model (for calibrating the thresholds).
import fs from "node:fs/promises";
import path from "node:path";
import { segmentInputs, stampsFor } from "../pipeline.ts";
import { criticTimeline } from "../qa/critictimeline.ts";
import {
  DEFAULT_CRITIC,
  type CriticSettings,
  type CriticWord,
} from "../qa/criticcore.ts";
import { measureVideo } from "../qa/criticmeasure.ts";
import { defaultCriticDeps, runCritic } from "../criticstep.ts";
import { chooseCriticModel, unloadModel } from "../qa/criticvision.ts";
import { LOCAL_VISION_MODEL } from "../assets/localvision.ts";

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);
const ROWS = arg("rows");
const SRC = arg("src");
const OUT = arg("out");
if (!ROWS || !SRC || !OUT)
  throw new Error(
    "usage: critic.ts --rows=<rows.json> --src=<dir> --out=<dir> [--episodes=a,b] [--model=m] [--every=2] [--no-lease] [--measure-only]",
  );
const only = (arg("episodes") ?? "").split(",").filter(Boolean);
const rows = (JSON.parse(await fs.readFile(ROWS, "utf8")) as any[]).filter(
  (r) => !only.length || only.includes(r.id),
);
const settings: CriticSettings = {
  ...DEFAULT_CRITIC,
  mode: "report",
  model: arg("model") ?? process.env.CRITIC_VISION_MODEL ?? "",
  everySeconds: Number(arg("every") ?? 2) || 2,
};
const summary: unknown[] = [];
for (const row of only.length
  ? only.map((id) => rows.find((r) => r.id === id)).filter(Boolean)
  : rows) {
  const video = path.join(SRC, row.id, "short.mp4");
  if (!(await fs.stat(video).catch(() => undefined))) {
    console.log(`${row.id}: no video at ${video}`);
    continue;
  }
  const tl = criticTimeline(row, {
    segmentInputs,
    stampsFor,
    gfxFix: flag("gfx-fix"),
  });
  if (!tl) {
    console.log(`${row.id}: no stored plan`);
    continue;
  }
  const dir = path.join(OUT, row.id);
  const title =
    row.script_json?.youtube?.title ?? row.script_json?.headline ?? row.id;
  if (flag("measure-only")) {
    const m = await measureVideo(video);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "measure.json"),
      JSON.stringify({ measured: m, timeline: tl }, null, 1),
    );
    const planCuts = tl.shots.map((s) => Math.round(s.start * 100) / 100);
    console.log(
      `${row.id}: ${m.cuts.length} cuts measured, ${planCuts.length} planned; black ${m.black.length}, white ${m.white.length}, frozen ${m.frozen.length}, silence ${m.silence.length}`,
    );
    summary.push({
      id: row.id,
      title,
      cuts: m.cuts,
      planCuts,
      black: m.black,
      white: m.white,
      frozen: m.frozen,
      silence: m.silence,
    });
    continue;
  }
  const deps = defaultCriticDeps(settings, Math.ceil(tl.duration / 30), 20);
  if (flag("no-lease")) {
    const choice = chooseCriticModel(settings, { orchestrator: true });
    deps.withModel = async (fn) => {
      try {
        if (choice.big) await unloadModel(LOCAL_VISION_MODEL);
        return await fn({
          ...choice,
          why: `${choice.model} (the caller held the GPU turn)`,
        });
      } finally {
        await unloadModel(choice.model);
      }
    };
  }
  const t0 = Date.now();
  const { report, plan } = await runCritic(
    {
      episode: row.id,
      video,
      dir,
      tl,
      words: (row.assets_json.words ?? []) as CriticWord[],
      settings,
      pass: 0,
      mediaLeft: {
        clips: row.assets_json.clips?.length ?? 0,
        images: row.assets_json.images?.length ?? 0,
      },
      title,
    },
    deps,
  );
  console.log(
    `${row.id} ${report.verdict} ${report.scores.overall}/100, match ${report.scores.match}, ${report.findings.length} findings, ${((Date.now() - t0) / 1000).toFixed(0)} s`,
  );
  summary.push({
    id: row.id,
    title,
    kind: report.kind,
    verdict: report.verdict,
    scores: report.scores,
    findings: report.findings,
    reasons: report.reasons,
    plan,
    notes: report.notes,
    seconds: report.seconds,
  });
}
await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(
  path.join(
    OUT,
    flag("measure-only") ? "measure_summary.json" : "summary.json",
  ),
  JSON.stringify(summary, null, 1),
);
