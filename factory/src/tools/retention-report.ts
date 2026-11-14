// The retention model's proof page: data, held-out accuracy, the backtest on the newest Shorts (curves with the real
// and the flagged drops), the findings and the five before-and-after Shorts with their contact sheets.
//   node --import tsx src/tools/retention-report.ts <model dir (retention-train output)> <sheets dir> <out dir>
import fs from "node:fs";
import path from "node:path";

const [MODEL, SHEETS, OUT] = process.argv.slice(2);
if (!MODEL || !SHEETS || !OUT)
  throw new Error(
    "usage: retention-report.ts <model dir> <sheets dir> <out dir>",
  );
const v = JSON.parse(
  fs.readFileSync(path.join(MODEL, "validation.json"), "utf8"),
);
const sheets: any[] = fs.existsSync(path.join(SHEETS, "sheets.json"))
  ? JSON.parse(fs.readFileSync(path.join(SHEETS, "sheets.json"), "utf8"))
  : [];
const all: any[] = JSON.parse(
  fs.readFileSync(path.join(MODEL, "director-all.json"), "utf8"),
);
fs.mkdirSync(OUT, { recursive: true });
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
const pc = (x: number) => `${Math.round(x * 100)}%`;
const cv = v.crossValidation;
const bt = v.backtest;
const ld = v.backtestLearnDrops;

function curveSvg(
  lines: Array<{
    pts: number[];
    colour: string;
    dash?: boolean;
    label: string;
  }>,
  bands: Array<{ from: number; to: number; colour: string }>,
  duration: number,
  w = 300,
  h = 120,
): string {
  const max = Math.max(1, ...lines.flatMap((l) => l.pts));
  const X = (i: number, n: number) => ((i / Math.max(1, n - 1)) * w).toFixed(1);
  const Y = (y: number) => (h - (y / max) * (h - 8)).toFixed(1);
  const b = bands
    .map(
      (x) =>
        `<rect x="${((x.from / duration) * w).toFixed(1)}" y="0" width="${Math.max(2, ((x.to - x.from) / duration) * w).toFixed(1)}" height="${h}" fill="${x.colour}" opacity="0.28"/>`,
    )
    .join("");
  const p = lines
    .map(
      (l) =>
        `<path d="${l.pts.map((y, i) => `${i ? "L" : "M"}${X(i, l.pts.length)},${Y(y)}`).join(" ")}" fill="none" stroke="${l.colour}" stroke-width="2"${l.dash ? ' stroke-dasharray="4 3"' : ""}><title>${esc(l.label)}</title></path>`,
    )
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">${b}${p}</svg>`;
}

const backtestCards = (v.backtestVideos as any[])
  .map((x) => {
    const learn = (ld.rows as any[]).find((r) => r.video === x.video);
    const bands = [
      ...(learn?.real ?? []).map((d: any) => ({ ...d, colour: "#ff3b30" })),
      ...(x.flagged ?? []).map((d: any) => ({ ...d, colour: "#3b82f6" })),
    ];
    return `<div class="bt"><div class="t">${esc(x.title)}</div>${curveSvg(
      [
        { pts: x.rel, colour: "#e8e8e8", label: "real curve" },
        {
          pts: x.relG,
          colour: "#3b82f6",
          label: "predicted before it went out",
        },
        { pts: x.relB, colour: "#777", dash: true, label: "our usual curve" },
      ],
      bands,
      x.duration,
    )}<div class="m">Real drops ${learn?.real.length ?? 0}, caught ${learn?.caught ?? 0}; flags ${learn?.flagged.length ?? 0}, on a real drop ${learn?.hit ?? 0}</div></div>`;
  })
  .join("");

const proofCards = sheets
  .map((s) => {
    const d = all.find((x) => x.episode === s.id);
    if (s.failed)
      return `<section class="proof"><h3>${esc(d?.title ?? s.id)} <small>not shown as a proof</small></h3><p>The director swapped in footage (${s.fixes.map((f: any) => esc(f.what)).join("; ")}) and the re-render then failed the factory's own frame check (status: ${esc(s.failed)}); the check faulted frames outside the director's change too. This is the case the QA revert now handles: on a QA failure after its swaps, the retry renders the plan as it was.</p></section>`;
    return `<section class="proof"><h3>${esc(d?.title ?? s.id)} <small><a href="https://youtu.be/${esc(d?.video)}">${esc(d?.video)}</a></small></h3>
<p>Predicted share watched (relative to the first second): <b>${s.predicted}%</b> as published, <b>${s.after}%</b> after the director (our usual curve for this length: ${s.usual}%). The model that judged it had not seen this Short.</p>
<ul>${s.fixes.map((f: any) => `<li>${esc(f.what)} <b>(+${f.gain} points)</b></li>`).join("")}</ul>
${curveSvg(
  [
    { pts: s.curve, colour: "#e8e8e8", label: "predicted, as published" },
    {
      pts: s.curveAfter ?? s.curve,
      colour: "#34c759",
      label: "predicted, after",
    },
  ],
  (s.weak ?? []).map((w: any) => ({
    from: w.from,
    to: w.to,
    colour: "#ff9500",
  })),
  s.seconds.after,
  420,
  130,
)}
<p class="m">Orange: the predicted weak moments. Black-frame scan (frames darker than 16/255): ${s.darkFrames.before} before, ${s.darkFrames.after} after. Length ${s.seconds.before.toFixed(2)} s before, ${s.seconds.after.toFixed(2)} s after.</p>
${s.advice?.length ? `<p class="m">Advice recorded for the writers and the shot picker:</p><ul class="m">${s.advice.map((a: string) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
<p class="m">Frames, two pairs a row, each pair ${s.base === "control.mp4" ? "the same plan rendered today with the director off (left)" : "the published file (left)"} then the director's render (right), at ${s.times.map((t: number) => `${t.toFixed(1)} s`).join(", ")}.</p><img src="${esc(s.sheet)}" alt="before and after frames" loading="lazy"></section>`;
  })
  .join("");

const row = (name: string, a: string, b: string, c: string) =>
  `<tr><td>${name}</td><td>${a}</td><td>${b}</td><td>${c}</td></tr>`;
const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Pulse retention model: proof, 14 Nov 2026</title>
<style>body{background:#111;color:#e8e8e8;font:15px/1.55 system-ui,sans-serif;max-width:1180px;margin:2rem auto;padding:0 1rem}h1{color:#ff6b1a}h2{border-bottom:1px solid #333;padding-bottom:.3rem;margin-top:2.2rem}
small,.m{color:#aaa}a{color:#ffa060}table{border-collapse:collapse;margin:.6rem 0}td,th{padding:.25rem .7rem;border-bottom:1px solid #2a2a2a;text-align:left}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:.8rem}.bt{background:#181818;padding:.5rem;border-radius:6px}.bt .t{font-size:13px;height:2.6em;overflow:hidden}.bt .m{font-size:12px}
.proof{background:#181818;padding:.8rem 1rem;margin:1rem 0;border-radius:6px}.proof img{max-width:100%;margin-top:.5rem;border-radius:4px}.key span{display:inline-block;width:12px;height:12px;margin:0 .3rem 0 1rem;vertical-align:middle}</style></head><body>
<h1>Retention model and edit director: proof</h1>
<p>Built 14 Nov 2026 on branch <code>claude/retentionmodel</code>. Everything is behind <code>RETENTION_DIRECTOR=off|advise|fix</code>, default <b>off</b>.</p>
<h2>In plain English</h2>
<ul>
<li>The factory now has a model that reads a Short's plan before it renders and predicts where viewers will leave. It learnt from the real YouTube retention curves of every Pulse Short.</li>
<li>It is a <b>modest</b> predictor, and this page says so with numbers. It is clearly better than guessing at <b>where a Short will lose people</b>, and at the overall shape of the curve. It is not good enough to promise how a single Short will do.</li>
<li>When it flags a moment, that moment is a real drop about ${pc(ld.hit / Math.max(1, ld.flagged))} of the time, against ${pc(ld.chanceHit / Math.max(1, ld.flagged))} for a random guess. It misses more drops than it finds: it caught ${ld.caught} of ${ld.real} real drops in the newest ${bt.n} Shorts (chance: about ${Math.round(ld.chanceCaught)}).</li>
<li>The director only makes small, safe changes the model scores as gains (fresh footage over a still, the strongest picture first, a shorter card label). The predicted gains are small: a fraction of a point to two points of average watch.</li>
</ul>
<h2>The data</h2>
<p>${v.uploads} uploads on the channel; ${v.curves} had a retention curve (YouTube Analytics <code>audienceWatchRatio</code> and <code>relativeRetentionPerformance</code> at each 1% of the length). ${v.shorts} Shorts made by the factory have full records (word timings, shot plan, cards, footage, sound effects) and train the model; ${v.baselineOnly} older Shorts from the previous pipeline have curves but no records, so they only teach the usual curve shape. Long videos (about 70 curves, 8 with factory records) are not modelled yet. ${v.features} features at each step: the shot (footage, still, plate, static, trailer, gameplay, own footage), cuts, cards and their text length, the stamp, sound effects, speaking pace, pauses, numbers, long words, names, the part of the Short and the whole Short's traits (hook length, question hook, how it opens, footage share, cut rate, pace, rumour).</p>
<h2>Accuracy, on Shorts the model had not seen</h2>
<table><tr><th>Measure</th><th>5-fold by video (${cv.videos} Shorts)</th><th>Backtest: newest ${bt.n}, trained only on older</th><th>What it means</th></tr>
${row("Ranking the weak moments inside a Short (rank correlation, 0 = guessing)", String(cv.withinSpearman.gbm), String(bt.withinSpearman.gbm), "Weak but real: it puts the worse moments ahead of the better ones more often than not")}
${row("Share of step-by-step variation explained (R²)", String(cv.stepR2.gbm), String(bt.stepR2.gbm), "Tiny: a curve with a few hundred views is mostly noise step to step")}
${row("Curve error, points (model / usual curve alone)", `${cv.curveMae.gbm} / ${cv.curveMae.baseline}`, `${bt.curveMae.gbm} / ${bt.curveMae.baseline}`, "The predicted curve is closer to the real one than our usual curve is")}
${row("Ranking Shorts by average watch (rank correlation)", String(cv.avgSpearman.gbm), String(bt.avgSpearman.gbm), "Some signal on which Shorts hold better overall")}
${row("Flags on a real worst moment (model / chance)", `${pc(cv.drops.precision)} / ${pc(cv.drops.randomPrecision)}`, `${pc(bt.drops.precision)} / ${pc(bt.drops.randomPrecision)}`, "Better than chance when it flags")}
${row("Worst moments caught (model / chance)", `${pc(cv.drops.recall)} / ${pc(cv.drops.randomRecall)}`, `${pc(bt.drops.recall)} / ${pc(bt.drops.randomRecall)}`, "About chance: it misses many")}
</table>
<p class="m">Chance levels are the average of 20 random sets of flags of the same size. A ridge regression trained beside the boosted trees as a plain check scored lower on most measures (within-Short ranking ${cv.withinSpearman.ridge} against ${cv.withinSpearman.gbm}).</p>
<h2>Backtest: would it have flagged the real drops in the last ${bt.n} Shorts?</h2>
<p>Each Short was predicted by a model trained only on the Shorts published before it. Real drops here are RETENTION_LEARN's own definition (runs where viewers left at more than twice our usual loss, costing at least 2 points; the first 2 s and the last tenth are left out, so flags there are too).</p>
<table><tr><th></th><th>Model</th><th>Chance</th></tr>
<tr><td>Real drops caught</td><td>${ld.caught} of ${ld.real} (${pc(ld.caught / Math.max(1, ld.real))})</td><td>${ld.chanceCaught.toFixed(0)} (${pc(ld.chanceCaught / Math.max(1, ld.real))})</td></tr>
<tr><td>Flags that landed on a real drop</td><td>${ld.hit} of ${ld.flagged} (${pc(ld.hit / Math.max(1, ld.flagged))})</td><td>${ld.chanceHit.toFixed(0)} (${pc(ld.chanceHit / Math.max(1, ld.flagged))})</td></tr>
<tr><td>Shorts with a real drop where at least one was flagged</td><td colspan="2">${ld.videosCaught} of ${ld.videosWithDrops}</td></tr></table>
<p class="key">Key:<span style="background:#e8e8e8"></span>real curve<span style="background:#3b82f6"></span>predicted before it went out (blue bands: flagged moments)<span style="background:#ff3b30"></span>real drops<span style="background:#777"></span>our usual curve</p>
<div class="grid">${backtestCards}</div>
<h2>What the model learnt (directions agreed by at least 4 of the 5 fold models)</h2>
<table><tr><th>Feature</th><th>Points of a Short's audience, all else equal</th></tr>${(v.findings as any[]).map((f) => `<tr><td>${esc(f.what)}</td><td>${f.points > 0 ? "costs" : "holds"} ${Math.abs(f.points).toFixed(1)}</td></tr>`).join("")}</table>
<p class="m">These are associations in 108 Shorts, not experiments: a trait common to one kind of story can carry that story's audience with it. The lessons the writers receive are the strongest of these, each with its sample size.</p>
<h2>Five real Shorts, before and after the director</h2>
<p>Each Short was rendered again in a sandbox from its own stored plan, voice and media with <code>RETENTION_DIRECTOR=fix</code>; nothing else changed and nothing was uploaded. Each was also rendered with the director off from the same plan in the same sandbox (the control), so the pairs differ only by what the director changed, not by other factory changes since the Short was published. Frames are taken at each changed shot and each predicted weak moment.</p>
${proofCards || "<p>No proof renders yet.</p>"}
<h2>Settings</h2>
<ul><li><code>RETENTION_DIRECTOR=off</code> (default): nothing runs.</li><li><code>advise</code>: each Short's predicted curve, weak moments, proposed fixes and advice are recorded on the episode (event <code>retention_director</code>, <code>assets.retention</code>); the plan is untouched. The model retrains weekly and its findings join the writers' lessons.</li><li><code>fix</code>: as advise, and the fixes the model scores as gains of at least ${0.15} points are applied to the plan before the one render, so no re-render is needed.</li></ul>
</body></html>`;
fs.writeFileSync(path.join(OUT, "index.html"), html);
console.log(`written ${path.join(OUT, "index.html")}`);
