// Puts one clip through the gameplay lane as a rehearsal: a fresh copy in the inbox marked "rehearsal", which the
// lane reviews (one vision call), cuts, renders and posts to Discord with a preview link only. It can never publish:
// the episode ends as soon as the notice is sent, and no manifest reaches Leonida Intel.
//   npx tsx src/tools/gameplay-rehearsal.ts <inbox id, or a path to a video file>
// A video file is copied whole and gets eight frames, as the highlight finder does for a short Xbox clip.

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FFMPEG, FFPROBE } from "../lib/bin.ts";
import { readMeta, type GameplayMeta } from "../gameplay.ts";

const arg = process.argv[2];
if (!arg) {
  console.error("usage: gameplay-rehearsal.ts <inbox id or video file>");
  process.exit(1);
}
const root =
  process.env.GAMEPLAY_ROOT ||
  path.join(os.homedir(), "Videos", "Pulse Gameplay");
const id = `gp_rehearsal_${Date.now().toString(36)}`;
const dir = path.join(root, "inbox", id);
await fs.mkdir(path.join(dir, "frames"), { recursive: true });

let meta: GameplayMeta;
const from = await readMeta(path.join(root, "inbox", arg));
if (from) {
  const src = path.join(root, "inbox", arg);
  await fs.copyFile(
    path.join(src, from.clip.file || "clip.mp4"),
    path.join(dir, "clip.mp4"),
  );
  for (const f of from.frames)
    await fs.copyFile(path.join(src, f), path.join(dir, f));
  meta = {
    ...from,
    id,
    status: "new",
    rehearsal: true,
    review: undefined,
    created_at: new Date().toISOString(),
  };
} else {
  const seconds = Number(
    execFileSync(FFPROBE, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      arg,
    ]).toString(),
  );
  await fs.copyFile(arg, path.join(dir, "clip.mp4"));
  execFileSync(FFMPEG, [
    "-v",
    "error",
    "-y",
    "-i",
    arg,
    "-vf",
    `fps=8/${Math.max(1, seconds)},scale=480:-2`,
    "-frames:v",
    "8",
    path.join(dir, "frames", "%02d.jpg"),
  ]);
  meta = {
    id,
    status: "new",
    rehearsal: true,
    source: {
      file: arg,
      title: path.basename(arg, path.extname(arg)),
      kind: "xbox_clip",
      duration_seconds: Math.round(seconds),
    },
    clip: {
      file: "clip.mp4",
      start_in_source: 0,
      seconds: Math.round(seconds),
    },
    score: 1,
    frames: (await fs.readdir(path.join(dir, "frames"))).map(
      (n) => `frames/${n}`,
    ),
    created_at: new Date().toISOString(),
  };
}
await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
console.log(`rehearsal clip ready: ${dir}`);
