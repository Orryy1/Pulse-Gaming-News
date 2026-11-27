// Proof that lines from real GTA VI scripts find their moments in the stream recordings the PC serves
// (src/vodindex/serve.ts), with no YouTube involved: each line is searched on the server, the best moment not held
// is cut there and fetched like the Mac would, and a contact sheet of the clip is made beside a summary.
//   node --import tsx src/tools/vodpc-proof.ts [--base http://127.0.0.1:8793] [--out D:\pulse-data\scratch\vodpc]
//     [--game "Grand Theft Auto VI"] [--lines lines.json]   (a JSON array of strings; the built-in six otherwise)

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";

const exec = promisify(execFile);
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = (flag("base") ?? "http://127.0.0.1:8793").replace(/\/$/, "");
const out = path.resolve(flag("out") ?? "D:/pulse-data/scratch/vodpc");
const game = flag("game") ?? "Grand Theft Auto VI";

// Lines from the factory's recent GTA VI Shorts and the GTA File (21 to 24 Nov 2026).
const LINES = [
  "Will you cross Leonida refueling at the pump, or calling a fresh car on Scooter Bros?",
  "Leonida includes Vice City and stretches into swamps and rural regions.",
  "Grand Theft Auto 6 has hurricanes worth looking for. Rockstar confirmed tropical storms too.",
  "Rockstar's Vintage Vice City Pack includes a classic car and an Ocean Beach garage.",
  "The seven fixes also cover crashes and Wanted Levels you couldn't lose.",
  "A storm is another reason to pull over and take in the view.",
];

interface Moment {
  vodId: string;
  channel: string;
  credit: string;
  start: number;
  end: number;
  score: number;
  label: string;
  held?: string;
  clip: string;
}

const lines: string[] = flag("lines")
  ? JSON.parse(await fs.readFile(flag("lines")!, "utf8"))
  : LINES;
await fs.mkdir(out, { recursive: true });
const report: string[] = [
  `# Stream recordings proof (${new Date().toISOString()})`,
  "",
  `Server: ${base}; game: ${game}`,
  "",
];
for (const [i, line] of lines.entries()) {
  const res = await fetch(`${base}/vod/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ game, text: line, max: 8 }),
  });
  const { moments = [] } = (await res.json()) as { moments?: Moment[] };
  const pick = moments.find((m) => !m.held);
  const held = moments
    .filter((m) => m.held)
    .map((m) => `${m.vodId} ${m.start.toFixed(0)}s (${m.held})`);
  report.push(`## ${i + 1}. ${line}`);
  if (!pick) {
    report.push(
      `No moment free to use.${held.length ? ` Held: ${held.join("; ")}` : ""}`,
      "",
    );
    console.log(`${i + 1}: none`);
    continue;
  }
  // The clip the Mac would use: five seconds from the moment's start, cut on the server.
  const to = Math.min(pick.end, pick.start + 5);
  const clipUrl = `${base}/vod/clip?vod=${encodeURIComponent(pick.vodId)}&from=${pick.start.toFixed(2)}&to=${to.toFixed(2)}`;
  const t0 = Date.now();
  const clipRes = await fetch(clipUrl);
  const clip = path.join(
    out,
    `line${i + 1}_${pick.vodId}_${pick.start.toFixed(0)}.mp4`,
  );
  await fs.writeFile(clip, Buffer.from(await clipRes.arrayBuffer()));
  const sheet = clip.replace(/\.mp4$/, "_sheet.jpg");
  await exec(
    FFMPEG,
    [
      "-loglevel",
      "error",
      "-y",
      "-i",
      clip,
      "-vf",
      "fps=0.8,scale=480:-2,tile=4x1",
      "-frames:v",
      "1",
      sheet,
    ],
    { windowsHide: true },
  );
  report.push(
    `Moment: ${pick.vodId} [${pick.channel}] at ${pick.start.toFixed(1)} s, score ${pick.score.toFixed(2)}${pick.credit ? `, credit "${pick.credit}"` : ""}`,
    `What it shows: ${pick.label}`,
    `Clip: ${path.basename(clip)} (${((await fs.stat(clip)).size / 1e6).toFixed(1)} MB, cut and fetched in ${((Date.now() - t0) / 1000).toFixed(1)} s); sheet: ${path.basename(sheet)}`,
    held.length ? `Held by the guard: ${held.join("; ")}` : "",
    "",
  );
  console.log(
    `${i + 1}: ${pick.vodId} ${pick.start.toFixed(1)}s ${pick.score.toFixed(2)} ${pick.label}`,
  );
}
await fs.writeFile(path.join(out, "proof.md"), report.join("\n"));
console.log(path.join(out, "proof.md"));
