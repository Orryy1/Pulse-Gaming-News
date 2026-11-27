// The AI motion trial (src/assets/localvideo.ts) on the concept-sketch trial's drawings. Reads a COPY of the
// database (never data/db of the live install) for each sketch's sentence and shot note, says which lines the
// chooser would animate and why the rest are declined (with the hit rate over all of the documentary's bare
// sentences), and with --run animates the sketches through ComfyUI (or the ffmpeg stub), measures each clip
// and writes a contact sheet: an HTML page with each sketch beside its clip, and a JPG of four frames a clip.
//
//   node --import tsx data/smoke/localvideo_trial.mts <episode id> <db copy dir> <sketch dir> [--run] [--stub]
//        [--all] [--out <dir>] [--max N]
//
// <sketch dir> holds the sketch trial's entry<N>_m<K>.png files (data/smoke/sketch_trial.mts --out).
// --all animates every sketch there, not only the lines the chooser takes (to judge the model's quality).
// Animating is GPU work (about 3 minutes a clip): run it through the PC orchestrator as a gpu job, e.g.
//   C:\Claude\orchestrator\orch.cmd run --class gpu --project pulse --job "localvideo trial" --priority 20 --est 40 -- node --import tsx data/smoke/localvideo_trial.mts ... --run
// The script takes no turn of its own (the orch run wrapper holds it) and expects ComfyUI at ILLUSTRATE_URL.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 1).length > 0 : false;
};
const value = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const RUN = flag("--run");
const STUB = flag("--stub");
const ALL = flag("--all");
const OUT = value("--out");
const MAX = Number(value("--max") ?? 10);
const [ID, DBCOPY, SKETCHES] = args;
if (!ID || !DBCOPY || !SKETCHES)
  throw new Error(
    "usage: localvideo_trial.mts <episode id> <db copy dir> <sketch dir> [--run] [--stub] [--all] [--out <dir>] [--max N]",
  );

const dataDir =
  path.basename(DBCOPY) === "db" ? path.dirname(path.resolve(DBCOPY)) : path.resolve(DBCOPY);
if (!fs.existsSync(path.join(dataDir, "db"))) throw new Error(`no db/ under ${dataDir}`);
if (path.resolve(dataDir).toLowerCase() === path.resolve("C:/PulseFactory/factory/data").toLowerCase())
  throw new Error("that is the live database; copy it first");
Object.assign(process.env, { DATA_DIR: dataDir, DATABASE_URL: "", DRY_RUN: "true", PORT: "0" });
if (STUB) process.env.ILLUSTRATE_VIDEO_STUB = "true";

const { loadConfig } = await import("../../src/config.ts");
const { openDb } = await import("../../src/db.ts");
const { getEpisode } = await import("../../src/episodes.ts");
const { chapterSentences } = await import("../../src/pipeline.ts");
const { coveredMoments } = await import("../../src/assets/fill.ts");
const lv = await import("../../src/assets/localvideo.ts");
const { FFMPEG } = await import("../../src/lib/bin.ts");

const cfg = loadConfig();
const db = await openDb("", dataDir);
const ep = await getEpisode(db, ID);
if (!ep?.script_json?.entries?.length) throw new Error(`episode ${ID} has no documentary script in that copy`);
const script = ep.script_json;
const images = ep.assets_json?.images ?? [];
const clips = (ep.assets_json?.clips ?? []).filter((c) => !c.stock);
const chapters = [...script.entries!].sort((a, b) => b.rank - a.rank);

// The chooser over every bare sentence of the documentary: the hit rate and the reasons for the declines.
let bare = 0;
let taken = 0;
const reasons = new Map<string, number>();
const families = new Map<string, number>();
chapters.forEach((e, i) => {
  const moments = e.moments ?? [];
  const sentences = chapterSentences(script, i);
  const covered = coveredMoments(i, moments, images, clips);
  moments.forEach((m, k) => {
    if (covered.has(k)) return;
    bare++;
    const v = lv.localvideoVerdict(sentences[k] ?? "", m, { game: e.game_title, year: e.year });
    if (v.take) {
      taken++;
      families.set(v.candidate.family, (families.get(v.candidate.family) ?? 0) + 1);
    } else reasons.set(v.reason, (reasons.get(v.reason) ?? 0) + 1);
  });
});
console.log(`${script.headline}: ${bare} bare sentences; the chooser takes ${taken} (${Math.round((100 * taken) / Math.max(1, bare))}%).`);
for (const [f, n] of families) console.log(`  take  ${n}  ${f}`);
for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  decline ${n}  ${r}`);
console.log("");

// The trial's sketches, each with its sentence and the chooser's verdict.
type Row = {
  entry: number;
  k: number;
  sketch: string;
  sentence: string;
  show: string;
  game: string;
  year?: number;
  verdict: ReturnType<typeof lv.localvideoVerdict>;
  motion: string;
  file?: string;
  measure?: import("../../src/assets/localvideo.ts").MotionMeasure;
  judged?: { ok: boolean; reason: string };
  seconds?: number;
  error?: string;
};
const rows: Row[] = [];
for (const f of fs.readdirSync(SKETCHES).sort()) {
  const m = f.match(/^entry(\d+)_m(\d+)\.(png|jpg)$/);
  if (!m) continue;
  const entry = Number(m[1]);
  const k = Number(m[2]);
  const e = chapters[entry];
  const shot = e?.moments?.[k];
  if (!e || !shot) continue;
  const sentence = chapterSentences(script, entry)[k] ?? "";
  const chapter = { game: e.game_title, year: e.year };
  const verdict = lv.localvideoVerdict(sentence, shot, chapter);
  // --all: a sketch the chooser declines still gets the motion of its sentence, or a gentle default.
  const motion = verdict.take
    ? verdict.candidate.motion
    : (lv.motionOf(sentence, shot.show)?.motion ?? "subtle natural movement of the people in the scene");
  rows.push({ entry, k, sketch: path.join(SKETCHES, f), sentence, show: shot.show, game: e.game_title, year: e.year, verdict, motion });
}
const chosen = rows.filter((r) => ALL || r.verdict.take).slice(0, MAX);
console.log(`${rows.length} sketches in ${SKETCHES}; ${rows.filter((r) => r.verdict.take).length} the chooser takes; animating ${chosen.length}${ALL ? " (--all)" : ""}.\n`);
for (const r of rows) {
  console.log(`[entry ${r.entry} #${r.k}] ${r.verdict.take ? `TAKE ${r.verdict.candidate.confidence} ${r.verdict.candidate.reason}` : `decline: ${r.verdict.reason}`}`);
  console.log(`  sentence: ${r.sentence}`);
  console.log(`  show:     ${r.show}`);
  if (chosen.includes(r))
    console.log(`  prompt:   ${lv.motionPrompt(r.sentence, { game: r.game, year: r.year }, r.show, r.motion).prompt}`);
  console.log("");
}

if (RUN && chosen.length) {
  const out = path.resolve(OUT ?? path.join(dataDir, "localvideo_trial", ID));
  fs.mkdirSync(out, { recursive: true });
  const t0 = Date.now();
  for (const r of chosen) {
    const dest = path.join(out, `${lv.LOCALVIDEO_PREFIX}entry${r.entry}_m${r.k}.mp4`);
    const { prompt, negative } = lv.motionPrompt(r.sentence, { game: r.game, year: r.year }, r.show, r.motion);
    const t = Date.now();
    try {
      await lv.animate(r.sketch, prompt, {
        dest,
        seed: lv.videoSeed(ID, r.sentence),
        negative,
        url: cfg.illustrateUrl,
        timeoutMs: cfg.illustrateVideoTimeoutSeconds * 1000,
        stub: cfg.illustrateVideoStub,
      });
      r.file = dest;
      r.seconds = Math.round((Date.now() - t) / 1000);
      r.measure = await lv.measureClip(dest);
      r.judged = lv.judgeMotion(r.measure);
      console.log(`made ${path.basename(dest)} in ${r.seconds}s: ${r.judged.ok ? "KEEP" : "DROP"} ${r.judged.reason}`);
    } catch (err) {
      r.error = err instanceof Error ? err.message : String(err);
      console.log(`FAILED ${path.basename(dest)}: ${r.error}`);
    }
  }
  const made = chosen.filter((r) => r.file);
  console.log(`\n${made.length} of ${chosen.length} made in ${Math.round((Date.now() - t0) / 1000)}s (${made.filter((r) => r.judged?.ok).length} pass the measurement)`);

  // Four frames a clip, side by side, one row a clip: the still sheet the lead looks at before any render.
  const run = promisify(execFile);
  const strips: string[] = [];
  for (const r of made) {
    const strip = r.file!.replace(/\.mp4$/, "_strip.jpg");
    try {
      await run(FFMPEG, ["-v", "error", "-y", "-i", r.file!, "-vf", `fps=${4 / lv.VIDEO_SECONDS},scale=480:-2,tile=4x1`, "-frames:v", "1", "-q:v", "3", strip]);
      strips.push(strip);
    } catch (err) {
      console.log(`strip failed for ${path.basename(r.file!)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (strips.length) {
    const sheet = path.join(out, "contact_sheet.jpg");
    const inputs = strips.flatMap((s) => ["-i", s]);
    await run(FFMPEG, ["-v", "error", "-y", ...inputs, "-filter_complex", `${strips.map((_, i) => `[${i}:v]`).join("")}vstack=inputs=${strips.length}[v]`, "-map", "[v]", "-frames:v", "1", "-q:v", "3", sheet]).catch((err) =>
      console.log(`sheet failed: ${err instanceof Error ? err.message : String(err)}`),
    );
    console.log(`contact sheet: ${sheet}`);
  }
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const rel = (p: string) => esc(path.relative(out, p).split(path.sep).join("/"));
  const html = [
    `<!doctype html><meta charset="utf-8"><title>AI motion trial: ${esc(script.headline)}</title>`,
    `<style>body{font-family:system-ui;background:#111;color:#eee;margin:24px}figure{display:grid;grid-template-columns:420px 420px 1fr;gap:16px;margin:0 0 28px;align-items:start}img,video{width:420px;border:1px solid #444}small{color:#999}.tag{display:inline-block;border:1px solid #888;border-radius:4px;padding:2px 6px;font-size:11px;letter-spacing:2px;margin-left:8px}.keep{color:#22c55e}.drop{color:#ff3b3b}</style>`,
    `<h1>${esc(script.headline)}</h1><p>${made.length} concept sketches brought to life on this PC's Wan 2.2 TI2V 5B (left: the sketch; middle: the clip; each tagged ILLUSTRATION on screen). The chooser takes ${taken} of ${bare} bare sentences in this documentary.</p>`,
    ...chosen.map((r) => {
      const status = r.error
        ? `<b class="drop">FAILED</b> ${esc(r.error)}`
        : `<b class="${r.judged?.ok ? "keep" : "drop"}">${r.judged?.ok ? "KEEP" : "DROP"}</b> ${esc(r.judged?.reason ?? "")} · ${r.seconds}s`;
      return `<figure><img src="${rel(r.sketch)}"><div>${r.file ? `<video src="${rel(r.file)}" controls loop muted autoplay></video>` : ""}</div><figcaption><b>${esc(r.game)}${r.year ? ` · ${r.year}` : ""}</b> · sentence ${r.k}<span class="tag">ILLUSTRATION</span><p>${esc(r.sentence)}</p><p>${status}</p><small>${r.verdict.take ? `chooser: ${r.verdict.candidate.confidence}, ${esc(r.verdict.candidate.reason)}` : `chooser declines: ${esc(r.verdict.reason)}`}<br>show note: ${esc(r.show)}<br>motion: ${esc(r.motion)}</small></figcaption></figure>`;
    }),
  ].join("\n");
  fs.writeFileSync(path.join(out, "contact_sheet.html"), html);
  console.log(`contact sheet: ${path.join(out, "contact_sheet.html")}`);
}
await db.close();
