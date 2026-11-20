// Old against new packaging for Pulse's most recent videos, as the lab would have chosen under PACKAGING_LAB=pick.
//   npx tsx src/packaging/tools/sidebyside.ts --pulse <export.json> --thumbs <dir> --out <folder> [--n 10] [--model <file>]
// Writes sidebyside.json and sidebyside.html (with the live thumbnails copied beside it). Changes nothing anywhere.
import fs from "node:fs";
import path from "node:path";
import { imageFeatures } from "../image.ts";
import { pickHookWords, rankTitles } from "../lab.ts";
import { imageScore, loadModel, pickBest, type FullModel } from "../score.ts";
import { packagingSettings } from "../settings.ts";
import type { Script } from "../../editorial/schema.ts";

const arg = (name: string, fallback?: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const rows = JSON.parse(fs.readFileSync(arg("pulse")!, "utf8")) as Array<
  Record<string, any>
>;
const thumbs = arg("thumbs");
const out = arg("out")!;
const n = Number(arg("n", "10"));
const modelFile = arg("model");
const model: FullModel = modelFile
  ? JSON.parse(fs.readFileSync(modelFile, "utf8"))
  : loadModel()!;
const st = packagingSettings({ PACKAGING_LAB: "pick" });
fs.mkdirSync(path.join(out, "thumbs"), { recursive: true });

const esc = (t: string) =>
  t.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
const metric = (e: Record<string, any>, label: string) =>
  (e.metrics ?? []).find((m: any) => m.label === label);

// Percentile of each live thumbnail's picture score among all Pulse thumbnails of its format.
const picScores = new Map<string, number>();
for (const e of rows) {
  const file = thumbs ? path.join(thumbs, `${e.youtube_video_id}.jpg`) : "";
  if (!file || !fs.existsSync(file)) continue;
  const fmt = e.script_json?.runtime === "long" ? "long" : "short";
  const f = await imageFeatures(file, fmt);
  if (f) picScores.set(e.youtube_video_id, imageScore(model, fmt, f));
}
const pct = (id: string) => {
  const v = picScores.get(id);
  if (v === undefined) return undefined;
  const all = [...picScores.values()];
  return all.filter((x) => x < v).length / all.length;
};

const recent = rows
  .filter((e) => e.script_json?.youtube?.title && e.youtube_video_id)
  .slice(0, n);
const items = recent.map((e) => {
  const script = e.script_json as Script;
  const ranked = rankTitles(model, script, st.candidates);
  const pick = pickBest(ranked, script.youtube.title, st.minLift)!;
  const ctr = metric(e, "ctr")?.raw;
  const ret = metric(e, "retention")?.raw;
  const v = metric(e, "72h") ?? metric(e, "24h");
  const fmt = script.runtime === "long" ? "long" : "short";
  if (thumbs && fs.existsSync(path.join(thumbs, `${e.youtube_video_id}.jpg`)))
    fs.copyFileSync(
      path.join(thumbs, `${e.youtube_video_id}.jpg`),
      path.join(out, "thumbs", `${e.youtube_video_id}.jpg`),
    );
  return {
    videoId: e.youtube_video_id,
    format: fmt,
    liveAt: e.live_at,
    views: v?.views,
    ctr: ctr?.ctr,
    impressions: ctr?.impressions,
    viewedRate: ret?.views ? ret.engagedViews / ret.views : undefined,
    old: {
      title: script.youtube.title,
      score: Number(pick.current.final.toFixed(3)),
      clarity: pick.current.clarity,
    },
    new: {
      title: pick.chosen.text,
      origin: pick.chosen.origin,
      score: Number(pick.chosen.final.toFixed(3)),
      changed: pick.changed,
      lift: Number.isFinite(pick.lift)
        ? Number(pick.lift.toFixed(3))
        : "old title fails the clarity check",
    },
    runnersUp: pick.runnersUp.map((r) => ({
      text: r.text,
      score: Number(r.final.toFixed(3)),
      origin: r.origin,
    })),
    refused: ranked
      .filter((r) => !r.clarity.ok)
      .slice(0, 3)
      .map((r) => ({ text: r.text, why: r.clarity.hard[0] })),
    hookWords:
      fmt === "short"
        ? {
            old: script.youtube.thumb_text ?? null,
            new: pickHookWords(st, "", script) ?? null,
          }
        : undefined,
    thumbPercentile: pct(e.youtube_video_id),
    candidates: ranked.length,
  };
});
fs.writeFileSync(
  path.join(out, "sidebyside.json"),
  JSON.stringify(items, null, 2),
);

const card = (x: (typeof items)[number]) => `
<section class="v">
  <img src="thumbs/${x.videoId}.jpg" class="${x.format}" alt="">
  <div>
    <p class="meta">${x.format === "long" ? "Long video" : "Short"} · ${esc(String(x.liveAt).slice(0, 10))} · ${x.views ?? "?"} views at 72 h${x.ctr !== undefined ? ` · CTR ${(x.ctr * 100).toFixed(1)}% on ${x.impressions} impressions` : ""}${x.viewedRate !== undefined ? ` · engaged ${(x.viewedRate * 100).toFixed(0)}%` : ""}${x.thumbPercentile !== undefined ? ` · picture score ${Math.round(x.thumbPercentile * 100)}th percentile` : ""}</p>
    <p><span class="tag old">Old</span> ${esc(x.old.title)} <small>${x.old.score}${x.old.clarity.ok ? "" : ` · fails: ${esc(x.old.clarity.hard[0] ?? "")}`}</small></p>
    <p><span class="tag ${x.new.changed ? "new" : "same"}">${x.new.changed ? "New" : "Kept"}</span> ${esc(x.new.title)} <small>${x.new.score} · ${esc(x.new.origin)}${x.new.changed ? ` · lift ${x.new.lift}` : ""}</small></p>
    ${x.hookWords ? `<p><span class="tag">Hook words</span> ${esc(x.hookWords.old ?? "(none)")} → ${esc(x.hookWords.new ?? "(none)")}</p>` : ""}
    <details><summary>Next best and refused (${x.candidates} candidates)</summary><ul>${x.runnersUp.map((r) => `<li>${esc(r.text)} <small>${r.score} · ${r.origin}</small></li>`).join("")}${x.refused.map((r) => `<li class="no">${esc(r.text)} <small>refused: ${esc(r.why ?? "")}</small></li>`).join("")}</ul></details>
  </div>
</section>`;
fs.writeFileSync(
  path.join(out, "sidebyside.html"),
  `<!doctype html><meta charset="utf-8"><title>Pulse Packaging Lab: old vs new</title>
<style>body{font:15px/1.45 system-ui,sans-serif;background:#0d0d10;color:#eee;max-width:980px;margin:24px auto;padding:0 16px}
.v{display:flex;gap:16px;border-bottom:1px solid #2a2a30;padding:14px 0}.v img.long{width:240px;height:135px;object-fit:cover}.v img.short{width:90px;height:160px;object-fit:cover}
.tag{display:inline-block;font-size:11px;padding:1px 6px;border-radius:4px;background:#333;margin-right:6px}.tag.old{background:#553}.tag.new{background:#FF6B1A;color:#000}.tag.same{background:#355}
small{color:#999}.meta{color:#aaa;font-size:13px;margin:0 0 6px}.no{color:#c77}</style>
<h1>Pulse Packaging Lab: old against new</h1><p>The ${items.length} most recent videos. "New" is what PACKAGING_LAB=pick would have chosen before upload. Nothing here was changed on YouTube.</p>
${items.map(card).join("")}`,
);
console.log(
  `${items.length} videos; ${items.filter((x) => x.new.changed).length} would get a new title`,
);
