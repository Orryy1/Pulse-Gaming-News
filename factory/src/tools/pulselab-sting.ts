// Builds the Pulse Lab's sting (public/sfx/lab/lab-sting.mp3) in-house from ffmpeg sine primitives, so the channel
// owns it outright: a low thump, then two bright "glass" pings a fifth apart (the lab's beaker), 0.6 s, mixed well under
// a narrator (peak about -9 dBFS; the composition plays it at 0.45 under the game's own sound). Writes the file's
// sha256 into public/sfx/lab/rights.json. Re-running it rebuilds the same sound.
//
// Usage: node --import tsx src/tools/pulselab-sting.ts

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { FFMPEG } from "../lib/bin.ts";

/** The sting's waveform as an ffmpeg aevalsrc expression (t in seconds). */
export const STING_EXPR = [
  "0.30*sin(2*PI*82*t)*exp(-22*t)", // the thump
  "0.34*sin(2*PI*1318.5*t)*exp(-13*t)", // E6 ping
  "0.12*sin(2*PI*2637*t)*exp(-18*t)", // its overtone
  "0.30*sin(2*PI*1975.5*(t-0.11))*exp(-8*(t-0.11))*gte(t,0.11)", // B6 ping, a fifth up
  "0.08*sin(2*PI*3951*(t-0.11))*exp(-14*(t-0.11))*gte(t,0.11)",
].join("+");

const out = path.resolve("public", "sfx", "lab", "lab-sting.mp3");
fs.mkdirSync(path.dirname(out), { recursive: true });
execFileSync(FFMPEG, [
  "-v",
  "error",
  "-y",
  "-f",
  "lavfi",
  "-i",
  `aevalsrc='${STING_EXPR}':s=48000:d=0.62`,
  "-af",
  "afade=t=in:d=0.004,afade=t=out:st=0.5:d=0.12,aformat=channel_layouts=stereo",
  "-c:a",
  "libmp3lame",
  "-b:a",
  "192k",
  out,
]);
const sha256 = crypto
  .createHash("sha256")
  .update(fs.readFileSync(out))
  .digest("hex");
fs.writeFileSync(
  path.join(path.dirname(out), "rights.json"),
  JSON.stringify(
    {
      schema: "pulse-audio-rights-v1",
      sfx: [
        {
          file: "lab-sting.mp3",
          sha256,
          origin:
            "synthesised in-house by src/tools/pulselab-sting.ts (ffmpeg sine primitives)",
          licence: "owned",
        },
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log(out, sha256);
