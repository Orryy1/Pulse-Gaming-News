// Contact sheet for an every-game Short's sandbox (data/smoke/everygame_short.mts): one frame from the middle of
// every shot of every beat, labelled with the beat's game and year, so each beat can be checked against its era by
// eye. From the render when there is one (short.mp4), otherwise from the planned pictures themselves.
//   node --import tsx data/smoke/everygame_sheet.mts <sandbox dir> <out dir>
// Also prints the era check per shot: the picture's own game and year (from its provenance) against the beat's.
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { eraTrue, provenanceSource, displayTitle } from "../../src/editorial/everygame.ts";

const [SANDBOX, OUT] = process.argv.slice(2);
const ffmpeg = ffmpegPath as unknown as string;
const plan = JSON.parse(await fs.readFile(path.join(SANDBOX!, "footage_plan.json"), "utf8"));
const { script } = JSON.parse(await fs.readFile(path.join(SANDBOX!, "script.json"), "utf8"));
const epDir = path.join(SANDBOX!, "episodes", (await fs.readdir(path.join(SANDBOX!, "episodes")))[0]!);
const video = path.join(SANDBOX!, "short.mp4");
const rendered = await fs.stat(video).then(() => true, () => false);
const frames = path.join(OUT!, "frames");
await fs.rm(frames, { recursive: true, force: true });
await fs.mkdir(frames, { recursive: true });
const FONT = "C\\:/Windows/Fonts/arialbd.ttf";
const esc = (t: string) => t.replace(/[\\:']/g, " ").replace(/%/g, "pct");
let n = 0;
let bad = 0;
const lines: string[] = [];
for (const b of plan.beats) {
  const meta = script.every_game.beats[b.beat - 1];
  const shots = b.shots.length ? b.shots : [{ type: "none" }];
  for (const [k, sh] of shots.entries()) {
    const src = sh.provenance ? provenanceSource(sh.provenance) : undefined;
    const ok = Boolean(src && eraTrue(src, meta) && sh.beatIndex === b.beat - 1);
    if (!ok) bad++;
    lines.push(
      `${String(b.beat).padStart(2)}.${k + 1} ${meta.year} ${meta.title} [${meta.device}${meta.stamp ? ", year stamp" : ""}] -> ${sh.type}: ${src ? `${src.game} (${src.year ?? "?"})` : "nothing"}${sh.provenance?.includes("hardware of its day") ? " on its hardware" : ""} ${ok ? "OK" : "WRONG"}`,
    );
    const label = esc(`${b.beat}. ${meta.year} ${displayTitle(meta.title, script.every_game)}`);
    const sub = esc(`${ok ? "OK" : "WRONG"} ${sh.type}${sh.provenance?.includes("hardware of its day") ? " on hardware" : ""}`);
    const draw = `drawbox=x=0:y=0:w=iw:h=44:color=black@0.75:t=fill,drawtext=fontfile='${FONT}':text='${label}':x=6:y=4:fontsize=17:fontcolor=white,drawtext=fontfile='${FONT}':text='${sub}':x=6:y=25:fontsize=14:fontcolor=${ok ? "0x7CFC00" : "red"}`;
    const out = path.join(frames, `f${String(n++).padStart(3, "0")}.jpg`);
    const scale = "scale=270:480:force_original_aspect_ratio=increase,crop=270:480";
    try {
      if (rendered && sh.frames) {
        const t = ((sh.frames[0] + sh.frames[1]) / 2 / 30).toFixed(2);
        execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-ss", t, "-i", video, "-frames:v", "1", "-vf", `${scale},${draw}`, out]);
      } else if (sh.file) {
        execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", path.join(epDir, sh.file), "-frames:v", "1", "-vf", `${scale},${draw}`, out]);
      } else {
        execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x202020:s=270x480", "-frames:v", "1", "-vf", draw, out]);
      }
    } catch (err) {
      console.log("frame failed", label, String(err).slice(0, 200));
    }
  }
}
const cols = 8;
const rows = Math.ceil(n / cols);
const sheet = path.join(OUT!, rendered ? "contact_sheet.jpg" : "contact_sheet_planned.jpg");
execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-framerate", "1", "-i", path.join(frames, "f%03d.jpg"), "-vf", `tile=${cols}x${rows}:padding=4:color=0x101010`, "-frames:v", "1", "-q:v", "3", sheet]);
await fs.writeFile(path.join(OUT!, "era_check.txt"), `${rendered ? "From the render" : "From the planned pictures (no render yet)"}: ${n} shots, ${bad} wrong\n${lines.join("\n")}\n`);
console.log(lines.join("\n"));
console.log(`\n${sheet}\n${n} shots, ${bad} wrong`);
