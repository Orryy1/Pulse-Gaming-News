// The proof for funny Shorts and meme posts (src/funny), by hand. Nothing uploads, posts or touches the database.
//   npx tsx src/tools/funny-proof.ts find <recording> --out <dir> [--hud] [--no-vision] [--top 10]
//       ranks the recording's funny moments into <dir>/moments.json and moments.md (frames in <dir>/work/frames)
//   npx tsx src/tools/funny-proof.ts render --out <dir> [--n 1]
//       cuts moment n from <dir>/moments.json into an inbox clip and renders the funny Short the lane's way:
//       the comedy cut (freeze, zoom punch, slowed replay), the PulseGameplayShort render, loudness normalising
//   npx tsx src/tools/funny-proof.ts meme --out <dir> [--frames a.jpg,b.jpg]
//       one meme image from the owner's frames (the best moments' frames when none are given)
// A recording's name may hold "%" ("GTA V 100% [v...]"): pass it through node, never through cmd.

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG, FFPROBE } from "../lib/bin.ts";
import { parseVodName } from "../vodindex/schema.ts";
import {
  findFunnyMoments,
  cutFunnyClip,
  payoffFrames,
  type FunnyMeta,
} from "../funny/finder.ts";
import { rateComedy } from "../funny/vision.ts";
import { funnySettings } from "../funny/settings.ts";
import type { FunnyCandidate, FunnyHud } from "../funny/moments.ts";
import type { SoundCue } from "../funny/audio.ts";
import { hudSettings } from "../hudreader/settings.ts";
import { profileFor, readClip } from "../hudreader/job.ts";
import { funnyFilter } from "../funny/edit.ts";
import { funnyShortProps } from "../funny/review.ts";
import { pickMeme, memeProblems } from "../funny/meme.ts";

const run = promisify(execFile);
const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string) => argv.includes(`--${name}`);
const [cmd, a1] = argv.filter(
  (a, i) => (!a.startsWith("--") && !argv[i - 1]?.startsWith("--")) || false,
);
const out = path.resolve(arg("out") ?? "funny-proof");
const fs_ = funnySettings(process.env);
const hms = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

interface Saved {
  file: string;
  title: string;
  recordedOn: string;
  seconds: number;
  hudRead: boolean;
  visionChecked: number;
  cues: SoundCue[];
  ranked: FunnyCandidate[];
}

async function find(file: string): Promise<void> {
  await fs.mkdir(out, { recursive: true });
  const name = parseVodName(file);
  const hud = hudSettings({ ...process.env, HUD_READER: "true" });
  const game = profileFor(name.title);
  const dataDir = process.env.DATA_DIR || path.resolve("data");
  const result = await findFunnyMoments(
    file,
    {
      work: path.join(out, "work"),
      candidates: Number(arg("candidates") ?? fs_.candidates),
      inSpoilerWindow: false,
      visionMin: fs_.visionMin,
    },
    {
      log: (l) => console.log(l),
      ...(has("no-vision") ? {} : { rate: rateComedy }),
      ...(has("hud") && game
        ? {
            readHud: async (
              start: number,
              duration: number,
            ): Promise<FunnyHud[] | undefined> => {
              const o = await readClip(hud, dataDir, {
                file,
                game,
                out: path.join(
                  out,
                  "work",
                  "hud",
                  `${Math.round(start)}`,
                  "raw.json",
                ),
                start,
                duration,
              });
              return o?.track.events.map((e) => ({
                t: e.t,
                kind: e.kind,
                ...(e.value !== undefined ? { value: e.value } : {}),
                ...(e.from !== undefined ? { from: e.from } : {}),
                detail: e.detail,
              }));
            },
          }
        : {}),
    },
  );
  const saved: Saved = {
    ...result,
    title: name.title,
    recordedOn: name.recordedOn ?? "",
  };
  await fs.writeFile(
    path.join(out, "moments.json"),
    JSON.stringify(saved, null, 2),
  );
  const top = result.ranked.slice(0, Number(arg("top") ?? 10));
  const md = [
    `# Funny moments: ${path.basename(file)}`,
    "",
    `${hms(result.seconds)} of stream, ${result.cues.length} sound cues, HUD ${result.hudRead ? "read" : "not read"}, local vision on ${result.visionChecked} candidates (PC relay, no paid calls).`,
    "",
    ...top.map((c, i) =>
      [
        `${i + 1}. **${hms(c.payoff)}**, score ${c.score}${c.veto ? ` (set aside: ${c.veto})` : ""}`,
        ...c.reasons.slice(0, 4).map((r) => `   - ${r}`),
      ].join("\n"),
    ),
  ].join("\n");
  await fs.writeFile(path.join(out, "moments.md"), md + "\n");
  console.log(md);
}

async function render(): Promise<void> {
  const saved = JSON.parse(
    await fs.readFile(path.join(out, "moments.json"), "utf8"),
  ) as Saved;
  const n = Number(arg("n") ?? 1);
  // The proof renders the best moment even when nothing clears the production bar (it says so in render.json): a
  // moment only under the vision rating may be shown, never a menu, gore, a cutscene or music.
  const usable = saved.ranked.filter((c) => !c.veto);
  const nearly = saved.ranked
    .filter((c) => c.veto?.startsWith("local vision rated"))
    .sort(
      (a, b) =>
        (b.vision?.funny ?? 0) - (a.vision?.funny ?? 0) ||
        b.signalScore - a.signalScore,
    );
  const cand = [...usable, ...nearly][n - 1];
  const belowBar = !usable.includes(cand!);
  if (!cand) throw new Error(`no moment ${n}`);
  const id = `funny_proof_${Math.round(cand.payoff)}`;
  const inbox = path.join(out, "inbox");
  const { dir, meta } = await cutFunnyClip({
    file: saved.file,
    title: saved.title,
    recordedOn: saved.recordedOn,
    candidate: cand,
    cues: saved.cues,
    inbox,
    id,
    now: new Date(),
  });
  const f: FunnyMeta = meta.funny;
  const ep = path.join(out, "episode");
  await fs.mkdir(ep, { recursive: true });
  // The comedy cut: what the lane's voice step makes for a funny clip (src/funny/review.ts funnyCut).
  await run(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-i",
      path.join(dir, "clip.mp4"),
      "-filter_complex",
      funnyFilter(f.plan, { focus: 0.5 }),
      "-map",
      "[vout]",
      "-map",
      "[aout]",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      path.join(ep, "cut.mp4"),
    ],
    { maxBuffer: 1 << 26 },
  );
  await run(FFMPEG, [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=48000:cl=stereo",
    "-t",
    String(f.plan.seconds),
    "-c:a",
    "libmp3lame",
    "-q:a",
    "4",
    path.join(ep, "voice.mp3"),
  ]);
  const { renderGameplayShort } = await import("../render/render.ts");
  const props = funnyShortProps(f);
  await renderGameplayShort({
    episodeDir: ep,
    props: { videoFile: "cut.mp4", voiceFile: "voice.mp3", ...props },
    outFile: path.join(ep, "render_raw.mp4"),
    posterFile: path.join(ep, "poster.jpg"),
    concurrency: Number(process.env.REMOTION_CONCURRENCY || 4),
  });
  // The factory's normalise: two-pass loudness to -14 LUFS, true peak -1.
  const first = await run(
    FFMPEG,
    [
      "-hide_banner",
      "-nostats",
      "-i",
      path.join(ep, "render_raw.mp4"),
      "-af",
      "loudnorm=I=-14:TP=-1:LRA=11:print_format=json",
      "-f",
      "null",
      "-",
    ],
    { maxBuffer: 1 << 24 },
  );
  const j = JSON.parse(first.stderr.slice(first.stderr.lastIndexOf("{")));
  await run(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-i",
      path.join(ep, "render_raw.mp4"),
      "-c:v",
      "copy",
      "-af",
      `loudnorm=I=-14:TP=-1:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,aresample=48000`,
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      path.join(out, "funny_short.mp4"),
    ],
    { maxBuffer: 1 << 24 },
  );
  await fs.writeFile(
    path.join(out, "render.json"),
    JSON.stringify(
      { moment: n, id, payoff_in_source: cand.payoff, below_production_bar: belowBar, veto: cand.veto ?? null, funny: f, props },
      null,
      2,
    ),
  );
  console.log(
    `rendered ${path.join(out, "funny_short.mp4")} (${f.plan.seconds} s)`,
  );
}

async function meme(): Promise<void> {
  const saved = JSON.parse(
    await fs
      .readFile(path.join(out, "moments.json"), "utf8")
      .catch(() => "null"),
  ) as Saved | null;
  let frames = (arg("frames") ?? "").split(",").filter(Boolean);
  if (!frames.length && saved) {
    const best = saved.ranked
      .filter((c) => !c.veto && c.vision && !c.vision.menu)
      .slice(0, 2);
    for (const c of best)
      frames.push(
        (
          await payoffFrames(
            saved.file,
            c.payoff,
            path.join(out, "work", "meme"),
          )
        )[1]!,
      );
  }
  if (!frames.length)
    throw new Error("no frames: give --frames or run find first");
  const pick = pickMeme({
    id: `proof_${Date.now()}`,
    frames,
    kinds: saved?.ranked.map((c) => c.vision?.kind ?? "none") ?? [],
    game: saved?.title ?? "",
  });
  const problems = memeProblems(pick);
  if (problems.length) throw new Error(`meme text: ${problems.join("; ")}`);
  const { renderMeme } = await import("../funny/memerender.ts");
  const file = path.join(out, "meme.png");
  await renderMeme({
    dir: path.dirname(frames[0]!),
    meme: pick,
    outFile: file,
  });
  await fs.writeFile(
    path.join(out, "meme.json"),
    JSON.stringify(pick, null, 2),
  );
  console.log(`meme ${file}: ${pick.layout} / ${pick.lines.join(" | ")}`);
}

if (cmd === "find") {
  if (!a1) throw new Error("find <recording>");
  await find(a1);
} else if (cmd === "render") await render();
else if (cmd === "meme") await meme();
else {
  console.error(
    "usage: funny-proof.ts find <recording> --out <dir> | render --out <dir> | meme --out <dir>",
  );
  process.exit(1);
}
void FFPROBE;
