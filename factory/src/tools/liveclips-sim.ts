// Replays a past stream as if it were live, through the same detector the live job uses (src/liveclips/detect.ts),
// to see which moments it would have caught, how soon, and what it would have skipped. No Twitch, no Discord, no
// inbox: everything goes to --out.
//   npx tsx src/tools/liveclips-sim.ts --vod <recording.mp4> --start <ISO the stream started> --out <dir>
//     [--chat <chat.jsonl>]   chat lines {at, user, text} (the live job saves them: data/liveclips/chat/)
//     [--clips <clips.json>]  viewer clips [{id, at, url, title, creator}] (Helix /clips)
//     [--signals <file>]      per-second measures saved by an earlier run (skips measuring the recording again)
//     [--cut <n>]             cut moment n (1 = the first) the live way: 10-second pieces, then the 40-second clip,
//                             frames and meta.json into <out>/inbox/<id>, ready for the gameplay lane
// Settings come from the LIVE_CLIPS_* variables, as live.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { FFMPEG, FFPROBE } from "../lib/bin.ts";
import {
  LiveDetector,
  type ChatLine,
  type Moment,
  type SecondSample,
  type ViewerClip,
} from "../liveclips/detect.ts";
import { dayStartIn, liveMeta } from "../liveclips/job.ts";
import {
  cutClip,
  listSegments,
  measure,
  segmentsFor,
  SEGMENT_SECONDS,
} from "../liveclips/recorder.ts";
import { liveClipsSettings } from "../liveclips/settings.ts";

const run = promisify(execFile);
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const vod = arg("vod");
const out = arg("out") ?? "liveclips-sim";
const startIso = arg("start");
if (!vod || !startIso) {
  console.error(
    "usage: liveclips-sim.ts --vod <file> --start <ISO> --out <dir>",
  );
  process.exit(1);
}
const start = Date.parse(startIso);
await fs.mkdir(out, { recursive: true });
const lc = liveClipsSettings(process.env);

const seconds = Number(
  (
    await run(FFPROBE, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      vod,
    ])
  ).stdout.trim(),
);
const signalsFile = arg("signals") ?? path.join(out, "signals.json");
let samples: SecondSample[];
try {
  samples = JSON.parse(
    await fs.readFile(signalsFile, "utf8"),
  ) as SecondSample[];
  console.log(`measures from ${signalsFile}`);
} catch {
  const t0 = Date.now();
  samples = await measure(FFMPEG, vod, start, seconds);
  await fs.writeFile(signalsFile, JSON.stringify(samples));
  console.log(
    `measured ${Math.round(seconds / 60)} min in ${Math.round((Date.now() - t0) / 1000)} s`,
  );
}
const chat: ChatLine[] = arg("chat")
  ? (await fs.readFile(arg("chat")!, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ChatLine)
      .sort((a, b) => a.at - b.at)
  : [];
const clips: ViewerClip[] = arg("clips")
  ? (JSON.parse(await fs.readFile(arg("clips")!, "utf8")) as ViewerClip[])
  : [];

const det = new LiveDetector({
  minScore: lc.minScore,
  perHour: lc.perHour,
  perDay: lc.perDay,
  gapMinutes: lc.gapMinutes,
  warmupMinutes: lc.warmupMinutes,
  chatLagSeconds: 8,
  clipLagSeconds: 15,
  dayStart: dayStartIn("Europe/London"),
});
det.title = path
  .basename(vod)
  .replace(/^\d{4}-\d\d-\d\d\s*|\s*\[[^\]]+\]\.\w+$/g, "");

// The live timeline: a second's measure exists once its 10-second piece has finished and been measured (about 3 s);
// a viewer clip shows up in Helix about a minute after it is made; the job looks every 15 seconds.
const PIECE_LAG = 3_000;
const CLIP_LIST_LAG = 60_000;
const found: Array<{ m: Moment; inInboxBy: number }> = [];
let ci = 0;
let ki = 0;
let nextPoll = start + 15_000;
const sortedClips = [...clips].sort((a, b) => a.at - b.at);
for (let i = 0; i < samples.length; i++) {
  const s = samples[i]!;
  const pieceEnd =
    start +
    (Math.floor((s.at - start) / 1000 / SEGMENT_SECONDS) + 1) *
      SEGMENT_SECONDS *
      1000;
  const now = pieceEnd + PIECE_LAG;
  det.addSecond(s);
  while (ci < chat.length && chat[ci]!.at <= now) det.addChat(chat[ci++]!);
  while (ki < sortedClips.length && sortedClips[ki]!.at + CLIP_LIST_LAG <= now)
    det.addClip(sortedClips[ki++]!);
  if (now >= nextPoll) {
    nextPoll = now + 15_000;
    for (const m of det.poll(now)) {
      // The window's last piece finished, plus the cut (measured on the Mac mini: see the report).
      const lastPiece =
        start +
        Math.ceil((m.end - start) / 1000 / SEGMENT_SECONDS) *
          SEGMENT_SECONDS *
          1000;
      found.push({ m, inInboxBy: Math.max(now, lastPiece + PIECE_LAG) });
    }
  }
}

const hms = (ms: number) => {
  const t = Math.max(0, Math.round((ms - start) / 1000));
  return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
const report = {
  vod: path.basename(vod),
  stream_started: startIso,
  minutes: Math.round(seconds / 60),
  settings: lc,
  chat_lines: chat.length,
  viewer_clips: clips.length,
  moments: found.map(({ m, inInboxBy }, i) => ({
    n: i + 1,
    at: hms(m.at),
    window: `${hms(m.start)}-${hms(m.end)}`,
    score: m.score,
    signals: m.signals,
    ask: m.ask?.question,
    decided_after_s: Math.round((m.decidedAt - m.at) / 1000),
    clip_ready_after_s: Math.round((inInboxBy - m.at) / 1000),
  })),
  skipped: det.skipped.map((x) => ({
    at: hms(x.moment.at),
    score: x.moment.score,
    why: x.why,
    signals: x.moment.signals.map((s) => s.kind).join("+"),
  })),
};
await fs.writeFile(
  path.join(out, "moments.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report.moments, null, 2));
console.log(`${found.length} moment(s), ${det.skipped.length} set aside`);

const n = Number(arg("cut") ?? 0);
const pick = found[n - 1];
if (pick) {
  // The live way: the recording around the window in 10-second pieces, as the recorder leaves them, then the cut.
  const m = pick.m;
  const pieces = path.join(out, "pieces");
  await fs.rm(pieces, { recursive: true, force: true });
  await fs.mkdir(pieces, { recursive: true });
  const from = Math.max(
    0,
    Math.floor((m.start - start) / 1000 / SEGMENT_SECONDS) * SEGMENT_SECONDS -
      SEGMENT_SECONDS,
  );
  await run(FFMPEG, [
    "-v",
    "error",
    "-y",
    "-ss",
    String(from),
    "-i",
    vod,
    "-t",
    "80",
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c",
    "copy",
    "-f",
    "segment",
    "-segment_time",
    String(SEGMENT_SECONDS),
    "-reset_timestamps",
    "1",
    path.join(pieces, "p%03d.ts"),
  ]);
  // Named by their start, as the live recorder names them.
  const made = (await fs.readdir(pieces))
    .filter((x) => x.endsWith(".ts"))
    .sort();
  let at = start + from * 1000;
  for (const name of made) {
    const stamp = new Date(at).toISOString().replace(/[-:]/g, "").slice(0, 15);
    await fs.rename(
      path.join(pieces, name),
      path.join(pieces, `seg_${stamp}.ts`),
    );
    const d = Number(
      (
        await run(FFPROBE, [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "csv=p=0",
          path.join(pieces, `seg_${stamp}.ts`),
        ])
      ).stdout.trim(),
    );
    at += Math.round(d) * 1000;
  }
  // listSegments leaves out the newest piece (live, it is still being written): a marker stands in for it.
  await fs.writeFile(
    path.join(
      pieces,
      `seg_${new Date(at).toISOString().replace(/[-:]/g, "").slice(0, 15)}.ts`,
    ),
    "",
  );
  const need = segmentsFor(listSegments(pieces), m.start, m.end);
  if (!need) throw new Error("the pieces do not cover the window");
  const stream = { id: "sim", startedAt: startIso, title: det.title };
  const id = liveMeta(m, stream, [], new Date()).id;
  const dir = path.join(out, "inbox", id);
  const t0 = Date.now();
  const frames = await cutClip({
    ffmpeg: FFMPEG,
    pieces: need.names.map((x) => path.join(pieces, x)),
    offset: need.offset,
    seconds: 40,
    outDir: dir,
    waitMinutes: lc.waitMinutes,
  });
  const cutSeconds = Math.round((Date.now() - t0) / 1000);
  await fs.writeFile(
    path.join(dir, "meta.json"),
    JSON.stringify(liveMeta(m, stream, frames, new Date()), null, 2),
  );
  await fs.writeFile(
    path.join(out, "cut.json"),
    JSON.stringify(
      {
        n,
        id,
        pieces: need.names,
        offset: need.offset,
        cut_seconds: cutSeconds,
      },
      null,
      2,
    ),
  );
  console.log(
    `cut moment ${n} to ${dir} in ${cutSeconds} s (pieces ${need.names.join(", ")})`,
  );
}
