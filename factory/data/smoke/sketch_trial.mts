// The concept-sketch trial (src/assets/illustrate.ts) on one finished documentary, read from a COPY of the
// database (never data/db of the live install). Lists every sentence a sketch would be drawn for, with its
// prompt and seed; with --run draws them through ComfyUI (or the stub) into a scratch folder and writes a
// contact sheet (an HTML page and a tiled JPG) so the owner can see before and after.
//
//   node --import tsx data/smoke/sketch_trial.mts <episode id> <db copy dir> [--run] [--stub] [--out <dir>] [--max N]
//
// <db copy dir> is a folder holding db/ (robocopy C:\PulseFactory\factory\data\db <dir>\db /E /XF db.lock
// postmaster.pid), or that db/ folder itself. Drawing is GPU work: run it through the PC orchestrator,
//   C:\Claude\orchestrator\orch.cmd run --class gpu --project pulse --job "sketch trial" --priority 20 --est 15 -- node --import tsx data/smoke/sketch_trial.mts ... --run
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
const OUT = value("--out");
const MAX = Number(value("--max") ?? 24);
const [ID, DBCOPY] = args;
if (!ID || !DBCOPY)
  throw new Error("usage: sketch_trial.mts <episode id> <db copy dir> [--run] [--stub] [--out <dir>] [--max N]");

// The copy, never the live database.
const dataDir = path.basename(DBCOPY) === "db" ? path.dirname(path.resolve(DBCOPY)) : path.resolve(DBCOPY);
if (!fs.existsSync(path.join(dataDir, "db"))) throw new Error(`no db/ under ${dataDir}`);
const live = path.resolve("C:/PulseFactory/factory/data");
if (path.resolve(dataDir).toLowerCase() === live.toLowerCase())
  throw new Error("that is the live database; copy it first");
Object.assign(process.env, { DATA_DIR: dataDir, DATABASE_URL: "", DRY_RUN: "true", PORT: "0" });
if (STUB) process.env.ILLUSTRATE_STUB = "true";

const { loadConfig } = await import("../../src/config.ts");
const { openDb } = await import("../../src/db.ts");
const { getEpisode } = await import("../../src/episodes.ts");
const { chapterSentences } = await import("../../src/pipeline.ts");
const { coveredMoments } = await import("../../src/assets/fill.ts");
const { illustratable, illustrate, sketchPrompt, sketchSeed, SKETCH_WIDTH, SKETCH_HEIGHT } = await import(
  "../../src/assets/illustrate.ts"
);
const { FFMPEG } = await import("../../src/lib/bin.ts");

const cfg = loadConfig();
const db = await openDb("", dataDir);
const ep = await getEpisode(db, ID);
if (!ep?.script_json?.entries?.length) throw new Error(`episode ${ID} has no documentary script in that copy`);
const script = ep.script_json;
const assets = ep.assets_json ?? {};
const images = assets.images ?? [];
const clips = (assets.clips ?? []).filter((c) => !c.stock);

type Row = { entry: number; game: string; year?: number; k: number; sentence: string; show: string; prompt: string; negative: string; seed: number; file?: string };
const rows: Row[] = [];
const chapters = [...script.entries!].sort((a, b) => b.rank - a.rank);
let total = 0;
let bareCount = 0;
chapters.forEach((e, i) => {
  const moments = e.moments ?? [];
  const sentences = chapterSentences(script, i);
  const covered = coveredMoments(i, moments, images, clips);
  total += moments.length;
  const ch = { game: e.game_title, year: e.year };
  moments.forEach((m, k) => {
    if (covered.has(k)) return;
    bareCount++;
    const sentence = sentences[k] ?? "";
    if (!illustratable(sentence, m)) return;
    const { prompt, negative } = sketchPrompt(sentence, ch, m.show);
    rows.push({ entry: i, game: e.game_title, year: e.year, k, sentence, show: m.show, prompt, negative, seed: sketchSeed(ID, sentence) });
  });
});
const chosen = rows.slice(0, MAX);
console.log(`${script.headline}: ${total} sentences, ${bareCount} bare after the fill pass, ${rows.length} qualify for a sketch (cap ${MAX}).\n`);
for (const r of chosen) {
  console.log(`[entry ${r.entry} ${r.game}${r.year ? ` ${r.year}` : ""} #${r.k}] seed ${r.seed}`);
  console.log(`  sentence: ${r.sentence}`);
  console.log(`  show:     ${r.show}`);
  console.log(`  prompt:   ${r.prompt}\n`);
}

if (RUN && chosen.length) {
  const out = path.resolve(OUT ?? path.join(dataDir, "sketch_trial", ID));
  fs.mkdirSync(out, { recursive: true });
  const t0 = Date.now();
  for (const r of chosen) {
    const dest = path.join(out, `entry${r.entry}_m${r.k}.png`);
    const t = Date.now();
    try {
      await illustrate(r.prompt, {
        dest,
        seed: r.seed,
        negative: r.negative,
        url: cfg.illustrateUrl,
        timeoutMs: cfg.illustrateTimeoutSeconds * 1000,
        stub: cfg.illustrateStub,
      });
      r.file = dest;
      console.log(`drawn ${path.basename(dest)} in ${Math.round((Date.now() - t) / 1000)}s`);
    } catch (err) {
      console.log(`FAILED ${path.basename(dest)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const drawn = chosen.filter((r) => r.file);
  console.log(`\n${drawn.length} of ${chosen.length} drawn in ${Math.round((Date.now() - t0) / 1000)}s`);
  // The contact sheet: each sketch beside its sentence, and what the line shows today (the chapter's general footage).
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const html = [
    `<!doctype html><meta charset="utf-8"><title>Sketch trial: ${esc(script.headline)}</title>`,
    `<style>body{font-family:system-ui;background:#111;color:#eee;margin:24px}figure{display:grid;grid-template-columns:480px 1fr;gap:18px;margin:0 0 28px;align-items:start}img{width:480px;border:1px solid #444}small{color:#999}.tag{display:inline-block;border:1px solid #888;border-radius:4px;padding:2px 6px;font-size:11px;letter-spacing:2px;margin-left:8px}</style>`,
    `<h1>${esc(script.headline)}</h1><p>${drawn.length} concept sketches for lines that today play on the chapter's general footage (before: footage of the chapter; after: the sketch, tagged ILLUSTRATION).</p>`,
    ...drawn.map(
      (r) =>
        `<figure><img src="${esc(path.basename(r.file!))}"><figcaption><b>${esc(r.game)}${r.year ? ` · ${r.year}` : ""}</b> · sentence ${r.k}<span class="tag">ILLUSTRATION</span><p>${esc(r.sentence)}</p><small>before: the chapter's general footage<br>show note: ${esc(r.show)}<br>seed ${r.seed}<br>prompt: ${esc(r.prompt)}</small></figcaption></figure>`,
    ),
  ].join("\n");
  fs.writeFileSync(path.join(out, "contact_sheet.html"), html);
  if (drawn.length) {
    const cols = Math.min(4, drawn.length);
    const rowsN = Math.ceil(drawn.length / cols);
    const run = promisify(execFile);
    const inputs = drawn.flatMap((r) => ["-i", r.file!]);
    const filter = `${drawn.map((_, i) => `[${i}:v]scale=${SKETCH_WIDTH / 2}:${SKETCH_HEIGHT / 2}[s${i}]`).join(";")};${drawn.map((_, i) => `[s${i}]`).join("")}xstack=inputs=${drawn.length}:layout=${drawn.map((_, i) => `${(i % cols) * (SKETCH_WIDTH / 2)}_${Math.floor(i / cols) * (SKETCH_HEIGHT / 2)}`).join("|")}:fill=black[v]`;
    try {
      await run(FFMPEG, ["-v", "error", "-y", ...inputs, "-filter_complex", filter, "-map", "[v]", "-frames:v", "1", "-q:v", "3", path.join(out, "contact_sheet.jpg")]);
      console.log(`contact sheet: ${path.join(out, "contact_sheet.jpg")} (${cols}x${rowsN})`);
    } catch (err) {
      console.log(`tiled sheet failed (${err instanceof Error ? err.message : String(err)}); the HTML sheet still works`);
    }
  }
  console.log(`contact sheet: ${path.join(out, "contact_sheet.html")}`);
}
await db.close();
