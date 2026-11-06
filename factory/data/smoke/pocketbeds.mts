// The voice pocket (31 Oct 2026, creator study #7): under speech the music should give way where the voice's
// intelligibility lives (2-4 kHz) instead of only getting quieter. Remotion's audio cannot EQ, so each music
// bed gets a pre-rendered "pocketed" copy with a dip there, and the composition crossfades between the plain
// and the pocketed bed by the bed envelope (src/render/soundfx.ts pocketWeight): all pocket under the voice,
// all plain in a long pause or a breather. The copies are FLAC (lossless, no encoder delay), so they stay
// sample-aligned with the WAV beds and the crossfade cannot comb. CPU only, a few seconds a bed.
//
//   node --import tsx data/smoke/pocketbeds.mts make    # (re)make public/music/pocket/*.flac and rights.json
//   node --import tsx data/smoke/pocketbeds.mts check   # every copy present, as long as its bed, dipped
//
// The dip: ffmpeg equalizer at 2.7 kHz, 1.5 octaves wide (about 1.6 to 4.5 kHz), -6 dB at its centre. The
// check measures the 2-4 kHz band of each copy against its bed (its K-weighted loudness at least
// POCKET_MIN_DIP_DB lower: the band's energy sits near its 2 kHz edge, so the average dip reads 2-4 dB) and
// the whole copy (no more than POCKET_MAX_SHIFT_DB away, so the crossfade never sounds like a level change).
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { FFMPEG, FFPROBE } = await import("../../src/lib/bin.ts");
const { BEDS, MOOD_BEDS } = await import("../../src/render/soundscape.ts");
const { pocketOf } = await import("../../src/render/soundfx.ts");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const POCKET_EQ = "equalizer=f=2700:t=o:w=1.5:g=-6";
const POCKET_MIN_DIP_DB = 1.8;
const POCKET_MAX_SHIFT_DB = 1.5;

const beds = [
  ...BEDS.map((b) => b.file),
  ...Object.values(MOOD_BEDS)
    .flat()
    .map((b) => b.file),
];

function ff(args: string[]): string {
  try {
    return execFileSync(FFMPEG, ["-hide_banner", "-nostats", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    }).toString("utf8");
  } catch (err) {
    const e = err as { stderr?: Buffer };
    throw new Error(`ffmpeg failed: ${e.stderr?.toString("utf8").trim() || String(err)}`);
  }
}

/** Integrated loudness (LUFS) of a file, optionally of one band of it. */
function lufs(file: string, band?: string): number {
  // ebur128 writes its summary to stderr, success or not.
  const r = spawnSync(
    FFMPEG,
    ["-hide_banner", "-nostats", "-i", file, "-af", `${band ? `${band},` : ""}ebur128`, "-f", "null", "-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const m = String(r.stderr ?? "").match(/Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/);
  return m ? Number(m[1]) : Number.NaN;
}

function samples(file: string): number {
  const out = execFileSync(FFPROBE, ["-v", "error", "-select_streams", "a:0", "-count_packets", "-show_entries", "stream=duration_ts,sample_rate", "-of", "csv=p=0", file]).toString("utf8").trim();
  const [rate, ts] = out.split(",").map(Number);
  return Number.isFinite(ts) && ts! > 0 ? ts! : Math.round(Number(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString()) * (rate ?? 48000));
}

const sha256 = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const BAND = "highpass=f=2000,highpass=f=2000,lowpass=f=4000,lowpass=f=4000";

function make() {
  const rights: Array<Record<string, string>> = [];
  for (const rel of beds) {
    const src = path.join(ROOT, "public", rel);
    const dst = path.join(ROOT, "public", pocketOf(rel));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    ff(["-y", "-loglevel", "error", "-i", src, "-af", POCKET_EQ, "-c:a", "flac", "-compression_level", "8", dst]);
    console.log(`${rel} -> ${pocketOf(rel)}`);
    rights.push({
      file: path.basename(dst),
      sha256: sha256(dst),
      origin: `${rel} (see public/music/rights.json), filtered by data/smoke/pocketbeds.mts`,
      licence: "as the bed it is made from",
      finishing: `ffmpeg ${POCKET_EQ}, FLAC, same length and sample rate as the bed`,
    });
  }
  fs.writeFileSync(
    path.join(ROOT, "public", "music", "pocket", "rights.json"),
    `${JSON.stringify({ schema: "pulse-audio-rights-v1", beds: rights }, null, 2)}\n`,
    "utf8",
  );
}

export function checkPocketBeds(): string[] {
  const problems: string[] = [];
  for (const rel of beds) {
    const src = path.join(ROOT, "public", rel);
    const dst = path.join(ROOT, "public", pocketOf(rel));
    if (!fs.existsSync(dst)) {
      problems.push(`${rel}: no pocketed copy (run: node --import tsx data/smoke/pocketbeds.mts make)`);
      continue;
    }
    const a = samples(src);
    const b = samples(dst);
    const dip = lufs(src, BAND) - lufs(dst, BAND);
    const shift = Math.abs(lufs(src) - lufs(dst));
    const line = `${rel}: ${a === b ? "same length" : `length ${a} vs ${b} samples`}, 2-4 kHz down ${dip.toFixed(1)} dB, whole bed moves ${shift.toFixed(2)} dB`;
    if (a !== b) problems.push(line);
    else if (!(dip >= POCKET_MIN_DIP_DB)) problems.push(`${line} (dip under ${POCKET_MIN_DIP_DB} dB)`);
    else if (!(shift <= POCKET_MAX_SHIFT_DB)) problems.push(`${line} (moves over ${POCKET_MAX_SHIFT_DB} dB)`);
    else console.log(`${line} ok`);
  }
  return problems;
}

const mode = process.argv[2] ?? "check";
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (mode === "make") make();
  const problems = checkPocketBeds();
  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    process.exit(1);
  }
  console.log("PASS");
}
