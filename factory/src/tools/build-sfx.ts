// Builds the channel's sound family (public/sfx/v2): several ElevenLabs takes per sound, each measured
// (harsh top end, clipping, length), the cleanest kept and finished the same way: trimmed, rumble and
// fizz filtered out, a short fade in so nothing clicks, a long fade out so nothing stops dead, peaks
// matched. One family, one character: soft air, warm lows, gentle glints. Nothing that startles.
// Usage: node --import tsx src/tools/build-sfx.ts [takes=4]
process.loadEnvFile(".env");
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { FFMPEG } from "../lib/bin.ts";

interface Sound {
  name: string;
  prompt: string;
  seconds: number;
  keep: number; // how many distinct takes to keep (variants rotate so no cut repeats the same sound)
  lowpass: number; // Hz: where the top end is rolled off
  fadeOut: number; // fraction of the length faded out
}

const FAMILY =
  "Polished, warm, modern, subtle; high-end documentary and trailer sound design; no harsh highs, no distortion, no clicks, no voice, no music melody.";
const SOUNDS: Sound[] = [
  {
    name: "air",
    prompt:
      "a soft airy cinematic whoosh for a scene transition, a smooth swish of air passing by, gentle and short, no impact",
    seconds: 0.8,
    keep: 3,
    lowpass: 11000,
    fadeOut: 0.45,
  },
  {
    name: "swell",
    prompt:
      "a gentle cinematic reverse swell rising into a reveal, soft warm synth pad and air, smooth crescendo that ends cleanly without a hit",
    seconds: 1.4,
    keep: 2,
    lowpass: 10000,
    fadeOut: 0.12,
  },
  {
    name: "land",
    prompt:
      "a warm soft cinematic low thud as a title lands, deep and round with a short airy tail, felt more than heard, subtle",
    seconds: 1.3,
    keep: 2,
    lowpass: 9000,
    fadeOut: 0.55,
  },
  {
    name: "glint",
    prompt:
      "a delicate soft tonal glint for a number appearing on screen, warm bell-like shimmer, very clean and quiet, modern motion graphics",
    seconds: 0.7,
    keep: 2,
    lowpass: 13000,
    fadeOut: 0.6,
  },
  {
    name: "sting",
    prompt:
      "a short warm modern brand sting for a gaming news channel, soft synth chime over a low pulse, calm and confident, broadcast logo sound",
    seconds: 1.8,
    keep: 1,
    lowpass: 12000,
    fadeOut: 0.4,
  },
  {
    name: "swipe",
    prompt:
      "a very soft subtle swipe as a graphic card slides in, smooth paper-like air movement, quiet",
    seconds: 0.5,
    keep: 2,
    lowpass: 10000,
    fadeOut: 0.5,
  },
];

const takes = Number(process.argv[2] ?? 4);
const key = process.env.ELEVENLABS_API_KEY ?? "";
if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
const lab = path.join("data", "sfxlab");
const out = path.join("public", "sfx", "v2");
fs.mkdirSync(lab, { recursive: true });
fs.mkdirSync(out, { recursive: true });

const ff = (args: string[]) => {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-nostats", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${String(r.stderr).slice(-300)}`);
  return String(r.stderr);
};
/** ffmpeg's report (it writes to stderr), whatever the exit code. */
const report = (args: string[]) => String(spawnSync(FFMPEG, ["-hide_banner", "-nostats", ...args], { encoding: "utf8" }).stderr ?? "");
/** volumedetect over a filter chain, as dB (mean, max). */
function levels(file: string, filter = "anull"): { mean: number; max: number } {
  const txt = report(["-i", file, "-af", `${filter},volumedetect`, "-f", "null", "-"]);
  return {
    mean: Number(txt.match(/mean_volume: (-?[\d.]+) dB/)?.[1] ?? -99),
    max: Number(txt.match(/max_volume: (-?[\d.]+) dB/)?.[1] ?? -99),
  };
}
function seconds(file: string): number {
  const t = [...report(["-i", file, "-f", "null", "-"]).matchAll(/time=(\d+):(\d+):([\d.]+)/g)].at(-1);
  return t ? Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]) : 0;
}

const rights: Array<Record<string, string>> = [];
for (const s of SOUNDS) {
  const scored: Array<{
    file: string;
    harsh: number;
    clip: number;
    len: number;
    score: number;
  }> = [];
  for (let i = 0; i < takes; i++) {
    const raw = path.join(lab, `${s.name}_${i}.mp3`);
    if (!fs.existsSync(raw)) {
      const res = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
        method: "POST",
        headers: { "xi-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({
          text: `${s.prompt}. ${FAMILY}`,
          duration_seconds: s.seconds,
          prompt_influence: 0.6,
        }),
      });
      if (!res.ok)
        throw new Error(
          `sound-generation ${s.name}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
        );
      fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
    }
    const all = levels(raw);
    const top = levels(raw, "highpass=f=7000");
    // Harshness: how much of the energy sits above 7 kHz (lower is warmer). Clipping: a peak at 0 dBFS.
    const harsh = top.mean - all.mean;
    const clip = all.max > -0.3 ? 1 : 0;
    const len = seconds(raw);
    const score = harsh + clip * 20 + Math.abs(len - s.seconds) * 4;
    scored.push({ file: raw, harsh, clip, len, score });
  }
  scored.sort((a, b) => a.score - b.score);
  for (const [k, t] of scored.slice(0, s.keep).entries()) {
    const name = s.keep > 1 ? `${s.name}-${k + 1}` : s.name;
    const dest = path.join(out, `${name}.mp3`);
    const len = Math.max(0.2, t.len);
    // Trim leading silence; rumble and fizz out; 6 ms fade in; long fade out; then peaks matched to -4 dBFS.
    const chain = [
      "silenceremove=start_periods=1:start_threshold=-55dB",
      "highpass=f=38",
      `lowpass=f=${s.lowpass}`,
      "afade=t=in:d=0.006",
      `afade=t=out:st=${(len * (1 - s.fadeOut)).toFixed(3)}:d=${(len * s.fadeOut).toFixed(3)}`,
    ].join(",");
    const tmp = path.join(lab, `${name}.wav`);
    ff(["-y", "-i", t.file, "-af", chain, "-ar", "48000", "-ac", "2", tmp]);
    const peak = levels(tmp).max;
    ff([
      "-y",
      "-i",
      tmp,
      "-af",
      `volume=${(-4 - peak).toFixed(2)}dB`,
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      dest,
    ]);
    rights.push({
      file: `v2/${name}.mp3`,
      origin: `ElevenLabs sound effects (generated ${new Date().toISOString().slice(0, 10)}), prompt: ${s.prompt}`,
      licence: "ElevenLabs paid-plan commercial use",
    });
    console.log(
      `${name.padEnd(9)} from ${path.basename(t.file)}  harsh ${t.harsh.toFixed(1)} dB  clip ${t.clip}  ${t.len.toFixed(2)}s`,
    );
  }
}
fs.writeFileSync(
  path.join(out, "rights.json"),
  JSON.stringify({ schema: "pulse-audio-rights-v1", sfx: rights }, null, 2),
);
console.log("written", out);
