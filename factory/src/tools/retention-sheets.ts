// Contact sheets for the edit director's proof (src/tools/retention-proof.ts): for each episode, the published frame
// (before.mp4) beside the re-rendered one (after.mp4) at every second the director changed and at each predicted weak
// moment, plus a per-frame black-flash scan of the new render. Needs ffmpeg on PATH.
//   node --import tsx src/tools/retention-sheets.ts <sandbox data dir> <out dir>
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [SB, OUT] = process.argv.slice(2);
if (!SB || !OUT)
  throw new Error("usage: retention-sheets.ts <sandbox data dir> <out dir>");
fs.mkdirSync(OUT, { recursive: true });
const ff = (args: string[]) =>
  execFileSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", ...args],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
const FONT = [
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
  "C:/Windows/Fonts/arial.ttf",
].find((f) => fs.existsSync(f));
// Labels need ffmpeg's drawtext (not in every build); without it the page names the times instead.
const DRAWTEXT = (() => {
  try {
    return execFileSync("ffmpeg", ["-hide_banner", "-filters"]).toString().includes(" drawtext ");
  } catch {
    return false;
  }
})();
const label = (t: string) =>
  FONT && DRAWTEXT
    ? `,drawtext=fontfile='${FONT}':text='${t.replace(/[':\\]/g, " ")}':x=10:y=10:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.6`
    : "";

const summary: unknown[] = [];
for (const f of fs
  .readdirSync(SB)
  .filter((x) => /^proof-ep_.*\.json$/.test(x))) {
  const [r] = JSON.parse(fs.readFileSync(path.join(SB, f), "utf8")) as any[];
  // Only renders that passed the factory's own QA (a failed one is reported, not shown as a proof).
  if (!r?.after || r.status !== "rendered" || !r.afterPlan) {
    if (r) summary.push({ id: r.id, failed: r.status, fixes: r.retention?.report?.fixes ?? [] });
    continue;
  }
  const dir = path.join(SB, "episodes", r.id);
  // The director-off render of the same plan when there is one (only the director differs); else the published file.
  const base = fs.existsSync(path.join(dir, "control.mp4")) ? path.join(dir, "control.mp4") : path.join(dir, "before.mp4");
  const report = r.retention?.report;
  const fps = r.afterPlan?.fps ?? 30;
  const times = new Set<number>();
  for (const fx of report?.fixes ?? []) {
    const shot = fx.shot !== undefined ? r.afterPlan.shots[fx.shot] : undefined;
    if (shot) times.add(+((shot.start + shot.end) / 2 / fps).toFixed(2));
  }
  for (const w of report?.weak ?? [])
    times.add(+((w.from + w.to) / 2).toFixed(2));
  const list = [...times].sort((a, b) => a - b).slice(0, 6);
  const rows: string[] = [];
  for (const [k, t] of list.entries()) {
    const b = path.join(OUT, `${r.id}_${k}_b.png`);
    const a = path.join(OUT, `${r.id}_${k}_a.png`);
    ff([
      "-ss",
      String(t),
      "-i",
      base,
      "-frames:v",
      "1",
      "-vf",
      `scale=360:-2${label(`before ${t.toFixed(1)} s`)}`,
      b,
    ]);
    ff([
      "-ss",
      String(t),
      "-i",
      path.join(dir, "after.mp4"),
      "-frames:v",
      "1",
      "-vf",
      `scale=360:-2${label(`after ${t.toFixed(1)} s`)}`,
      a,
    ]);
    const row = path.join(OUT, `${r.id}_${k}_row.png`);
    ff(["-i", b, "-i", a, "-filter_complex", "hstack=inputs=2", row]);
    rows.push(row);
    fs.rmSync(a);
    fs.rmSync(b);
  }
  const sheet = path.join(OUT, `${r.id}_sheet.png`);
  if (rows.length) {
    // Two before/after pairs a line.
    const pairs: string[] = [];
    for (let i = 0; i < rows.length; i += 2) {
      const p = path.join(OUT, `${r.id}_pair${i}.png`);
      if (rows[i + 1])
        ff([
          "-i",
          rows[i]!,
          "-i",
          rows[i + 1]!,
          "-filter_complex",
          "hstack=inputs=2",
          p,
        ]);
      else ff(["-i", rows[i]!, "-vf", "pad=iw*2:ih:0:0:black", p]);
      pairs.push(p);
    }
    if (pairs.length === 1) fs.copyFileSync(pairs[0]!, sheet);
    else
      ff([
        ...pairs.flatMap((p) => ["-i", p]),
        "-filter_complex",
        `vstack=inputs=${pairs.length}`,
        sheet,
      ]);
    for (const p of [...rows, ...pairs]) fs.rmSync(p, { force: true });
  }
  // Black flashes: frames whose mean brightness falls below 16 (of 255), before and after.
  const flashes = (file: string) => {
    const out = execFileSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-i",
        file,
        "-vf",
        "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-",
        "-f",
        "null",
        "-",
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    ).toString();
    return out
      .split("\n")
      .filter((l) => l.startsWith("lavfi.signalstats.YAVG="))
      .map((l) => Number(l.split("=")[1]))
      .filter((y) => y < 16).length;
  };
  const durationOf = (file: string) =>
    Number(
      execFileSync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        file,
      ])
        .toString()
        .trim(),
    );
  summary.push({
    id: r.id,
    sheet: path.basename(sheet),
    base: path.basename(base),
    times: list,
    fixes: report?.fixes ?? [],
    predicted: report?.predicted,
    after: report?.after,
    usual: report?.usual,
    curve: report?.curve,
    curveAfter: report?.curveAfter,
    weak: report?.weak,
    advice: report?.advice,
    darkFrames: {
      before: flashes(base),
      after: flashes(path.join(dir, "after.mp4")),
    },
    seconds: {
      before: durationOf(base),
      after: durationOf(path.join(dir, "after.mp4")),
    },
  });
  console.log(`${r.id}: sheet ${rows.length} pairs`);
}
fs.writeFileSync(
  path.join(OUT, "sheets.json"),
  JSON.stringify(summary, null, 1),
);
