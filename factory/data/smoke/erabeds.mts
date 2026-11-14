// The era beds (30 Oct 2026): a quiet ambient bed per period under a documentary chapter's opening 20 s
// (src/render/soundscape.ts eraBed). No licensed asset exists for these, so they are synthesised with
// ffmpeg's own generators, deterministically (seeded noise, pure tones), mastered to ERA_BED_TARGET_LUFS
// (-33 LUFS integrated) and checked under ERA_BED_LUFS_CEILING (-30) with ffmpeg's ebur128. CPU only,
// a few seconds; nothing here touches the GPU, the factory or its database.
//
//   node --import tsx data/smoke/erabeds.mts make    # (re)generate public/soundscape/era/*.wav and rights.json
//   node --import tsx data/smoke/erabeds.mts check   # measure every bed; exit 1 if one is missing or too loud
//
// The recipes, each 24 s at 48 kHz mono (the renderer plays 20 s with its own fades):
//   arcade  (before 1990): a 60 Hz mains hum with its second harmonic, and pink noise banded around 500 Hz
//                          that swells slowly, the wash of a room full of cabinets heard from the door.
//   console (1990-1994):   a 50 Hz hum and brown noise rolled off at 1.2 kHz, a console and a tube TV warming up.
//   modem   (1995-2003):   room tone with a dial-up warble (two tones, one wobbling, one pulsing) 18 dB under it,
//                          coming and going, so it reads as a memory rather than a sound effect.
//   room    (2004 on):     clean room tone, pink and brown noise rolled off, barely moving.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { FFMPEG } = await import("../../src/lib/bin.ts");
const { loudness } = await import("../../src/qa/media.ts");
const { ERA_BEDS, ERA_BED_TARGET_LUFS, ERA_BED_LUFS_CEILING } = await import(
  "../../src/render/soundscape.ts"
);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(ROOT, "public", "soundscape", "era");
const SECONDS = 24;
const RATE = 48000;
/** A bed quieter than this is a mastering slip (silence would also pass the ceiling). */
const FLOOR_LUFS = ERA_BED_TARGET_LUFS - 3;

const src = (expr: string) => `${expr}:r=${RATE}:d=${SECONDS}`;

/** Each bed's filter graph: sources mixed without normalising (so the recipe, not amix, sets the balance). */
const RECIPES: Record<keyof typeof ERA_BEDS, string> = {
  arcade: [
    `${src("sine=f=60")},volume=0.5[h1]`,
    `${src("sine=f=120")},volume=0.18[h2]`,
    `${src("anoisesrc=c=pink:a=0.6:seed=11")},bandpass=f=500:width_type=o:w=2.5,tremolo=f=0.17:d=0.35,volume=1.4[n]`,
    `[h1][h2][n]amix=inputs=3:normalize=0,lowpass=f=4000,afade=t=in:d=0.5,afade=t=out:st=${SECONDS - 1}:d=1[out]`,
  ].join(";"),
  console: [
    `${src("sine=f=50")},volume=0.5[h1]`,
    `${src("sine=f=100")},volume=0.16[h2]`,
    `${src("anoisesrc=c=brown:a=0.7:seed=23")},lowpass=f=1200,tremolo=f=0.3:d=0.15,volume=1.2[n]`,
    `[h1][h2][n]amix=inputs=3:normalize=0,afade=t=in:d=0.5,afade=t=out:st=${SECONDS - 1}:d=1[out]`,
  ].join(";"),
  modem: [
    `${src("anoisesrc=c=pink:a=0.5:seed=37")},lowpass=f=2500,volume=1.0[room]`,
    `${src("sine=f=1700")},vibrato=f=5.5:d=0.7,volume=0.5[w1]`,
    `${src("sine=f=2100")},tremolo=f=3:d=0.9,volume=0.35[w2]`,
    // The warble sits 18 dB under the room tone and breathes in and out every nine seconds or so.
    `[w1][w2]amix=inputs=2:normalize=0,bandpass=f=1900:width_type=o:w=1.5,tremolo=f=0.11:d=0.8,volume=-18dB[warble]`,
    `[room][warble]amix=inputs=2:normalize=0,lowpass=f=3000,afade=t=in:d=0.5,afade=t=out:st=${SECONDS - 1}:d=1[out]`,
  ].join(";"),
  room: [
    `${src("anoisesrc=c=pink:a=0.5:seed=41")},lowpass=f=1800,volume=0.8[p]`,
    `${src("anoisesrc=c=brown:a=0.5:seed=43")},lowpass=f=400,volume=0.6[b]`,
    // tremolo's slowest rate is 0.1 Hz: a ten-second breath, the slightest movement.
    `[p][b]amix=inputs=2:normalize=0,tremolo=f=0.1:d=0.1,afade=t=in:d=0.5,afade=t=out:st=${SECONDS - 1}:d=1[out]`,
  ].join(";"),
};

function ffmpeg(args: string[]) {
  try {
    execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    // ffmpeg says what is wrong with a filter graph on stderr; show that, not the whole command.
    const e = err as { stderr?: Buffer };
    throw new Error(`ffmpeg failed: ${e.stderr?.toString("utf8").trim() || String(err)}`);
  }
}

const sha256 = (file: string) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");

async function make() {
  fs.mkdirSync(OUT, { recursive: true });
  const rights: Array<Record<string, string | number>> = [];
  for (const [name, graph] of Object.entries(RECIPES) as Array<[keyof typeof ERA_BEDS, string]>) {
    const final = path.join(ROOT, "public", ERA_BEDS[name]);
    const raw = `${final}.raw.wav`;
    // 1. The recipe as written, at whatever loudness it comes out.
    ffmpeg(["-filter_complex", graph, "-map", "[out]", "-ac", "1", "-ar", String(RATE), "-c:a", "pcm_s16le", raw]);
    // 2. Measured, then moved to the target by plain gain (no limiter, nothing dynamic, so the file is the recipe).
    const measured = await loudness(raw);
    if (!Number.isFinite(measured)) throw new Error(`${name}: could not measure the raw bed`);
    const gain = ERA_BED_TARGET_LUFS - measured;
    ffmpeg(["-i", raw, "-af", `volume=${gain.toFixed(2)}dB`, "-ac", "1", "-ar", String(RATE), "-c:a", "pcm_s16le", final]);
    fs.rmSync(raw, { force: true });
    const got = await loudness(final);
    console.log(`${name.padEnd(8)} raw ${measured.toFixed(1)} LUFS, gain ${gain >= 0 ? "+" : ""}${gain.toFixed(1)} dB, now ${got.toFixed(1)} LUFS`);
    rights.push({
      file: path.basename(final),
      sha256: sha256(final),
      origin: "synthesised by data/smoke/erabeds.mts with ffmpeg generators (sine, anoisesrc); no third-party audio",
      licence: "Pulse's own; no claim possible",
      finishing: `${SECONDS} s mono ${RATE} Hz, gain to ${ERA_BED_TARGET_LUFS} LUFS integrated (ffmpeg ebur128), measured ${got.toFixed(1)} LUFS`,
    });
  }
  fs.writeFileSync(
    path.join(OUT, "rights.json"),
    `${JSON.stringify({ schema: "pulse-audio-rights-v1", beds: rights }, null, 2)}\n`,
    "utf8",
  );
}

/** Every bed present and between the floor and the ceiling; the failures listed. */
export async function checkEraBeds(): Promise<string[]> {
  const problems: string[] = [];
  for (const [name, rel] of Object.entries(ERA_BEDS)) {
    const file = path.join(ROOT, "public", rel);
    if (!fs.existsSync(file)) {
      problems.push(`${name}: ${rel} is missing (run: node --import tsx data/smoke/erabeds.mts make)`);
      continue;
    }
    const lufs = await loudness(file);
    if (!Number.isFinite(lufs)) problems.push(`${name}: could not measure ${rel}`);
    else if (lufs > ERA_BED_LUFS_CEILING)
      problems.push(`${name}: ${lufs.toFixed(1)} LUFS is over the ${ERA_BED_LUFS_CEILING} LUFS ceiling`);
    else if (lufs < FLOOR_LUFS)
      problems.push(`${name}: ${lufs.toFixed(1)} LUFS is under the ${FLOOR_LUFS} LUFS floor (near silent)`);
    else console.log(`${name.padEnd(8)} ${lufs.toFixed(1)} LUFS ok`);
  }
  return problems;
}

const mode = process.argv[2] ?? "check";
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (mode === "make") await make();
  const problems = await checkEraBeds();
  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    process.exit(1);
  }
  console.log("PASS");
}
