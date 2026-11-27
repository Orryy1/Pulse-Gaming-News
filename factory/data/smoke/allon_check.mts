// Checks a rendered proof video: length (ffprobe), black flashes at full frame rate (src/qa/media.ts blackFlashes),
// loudness, and a contact sheet of one frame every N seconds.
//   node --import tsx data/smoke/allon_check.mts <video> <out dir> <name> [sheet every seconds]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const [VIDEO, OUT, NAME, EVERY] = process.argv.slice(2);
const { blackFlashes } = await import("../../src/qa/media.ts");
const ff = process.env.FFMPEG_PATH || "ffmpeg";
const probe = process.env.FFPROBE_PATH || "ffprobe";
fs.mkdirSync(OUT!, { recursive: true });
const info = JSON.parse(
  execFileSync(probe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate,nb_frames", "-of", "json", VIDEO!]).toString(),
);
const duration = Number(info.format.duration);
const flashes = await blackFlashes(VIDEO!, duration);
const { spawnSync } = await import("node:child_process");
const loudErr = spawnSync(ff, ["-hide_banner", "-nostats", "-i", VIDEO!, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stderr ?? "";
const summaryAt = loudErr.lastIndexOf("Summary:");
const tail = summaryAt >= 0 ? loudErr.slice(summaryAt) : "";
const lufs = Number(tail.match(/I:\s+(-?[\d.]+) LUFS/)?.[1]);
const peak = Number(tail.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1]);
const every = Number(EVERY ?? 3);
const n = Math.ceil(duration / every);
const cols = 6;
const rows = Math.ceil(n / cols);
execFileSync(ff, [
  "-hide_banner", "-loglevel", "error", "-y", "-i", VIDEO!,
  "-vf", `fps=1/${every},scale=270:-2,drawtext=text='%{pts\\:hms}':x=6:y=6:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6,tile=${cols}x${rows}:padding=4:margin=4`,
  "-frames:v", "1", path.join(OUT!, `${NAME}_contact_sheet.jpg`),
]);
const report = { file: VIDEO, seconds: +duration.toFixed(2), streams: info.streams, black_flashes: flashes, integrated_lufs: lufs, true_peak_dbfs: peak, sheet_every_seconds: every };
fs.writeFileSync(path.join(OUT!, `${NAME}_check.json`), JSON.stringify(report, null, 1));
console.log(NAME, JSON.stringify({ seconds: report.seconds, lufs, peak, flashes: flashes.length, first: flashes.slice(0, 5) }));
