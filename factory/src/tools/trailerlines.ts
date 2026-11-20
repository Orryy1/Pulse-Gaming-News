// Trailer voice lines, made once per library trailer on the PC (TRAILER_QUOTES, src/assets/trailerlines.ts).
//   npx tsx src/tools/trailerlines.ts "Grand Theft Auto VI" [--audio-dir=DIR] [--force]
//   npx tsx src/tools/trailerlines.ts --all     every game in the library with an official trailer not yet processed
// For each official trailer in the game's library: its sound (from DIR/<item>.m4a when given, else read from the
// publisher's own file, picture skipped: the library keeps the picture only), Demucs's isolated voice and the music
// under it (src/tools/trailervoice.py, htdemucs_ft from the torch cache), Whisper's word timings of the voice
// (src/qa/whisperwords.py), the voice mix (voice over the music 20 dB down) and the lines file. Heavy: run it through
// the orchestrator (orch run --class gpu ... --est 6).
// DATA_DIR or GAME_LIBRARY_DIR pick the library; DEMUCS_PYTHON and WHISPER_PYTHON the two Pythons.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FFMPEG } from "../lib/bin.ts";
import { runCapped } from "../lib/child.ts";
import { errorMessage } from "../lib/util.ts";
import {
  canonicalGame,
  libraryDir,
  libraryRoot,
  readLibrary,
} from "../assets/gamelib.ts";
import { envelopeDb } from "../assets/quoteclip.ts";
import {
  buildTrailerLines,
  isLibraryTrailer,
  LEVEL_STEP,
  MUSIC_UNDER_DB,
  TRAILER_LINES_VERSION,
  trailerName,
  voicelinesFile,
  voiceMixFile,
  VOICELINES_DIR,
  type TrailerLines,
} from "../assets/trailerlines.ts";
import { transcribeWords } from "../qa/narration.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const [game0, ...rest] = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const hit = rest.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  return hit === undefined
    ? undefined
    : hit.includes("=")
      ? hit.slice(hit.indexOf("=") + 1)
      : "true";
};
const firstThere = (...p: string[]) =>
  p.find((x) => x && fs.existsSync(x)) ?? "";
const DEMUCS_PY =
  process.env.DEMUCS_PYTHON ||
  firstThere("D:/pulse-tools/avtools-venv/Scripts/python.exe");
const WHISPER_PY =
  process.env.WHISPER_PYTHON ||
  firstThere(
    "D:/pulse-tools/pulse-python-runtime/Scripts/python.exe",
    `${process.env.HOME ?? ""}/PulseFactory/asr/bin/python`,
  );

async function monoLevels(file: string, step: number): Promise<number[]> {
  const raw = `${file}.f32`;
  await runCapped(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-i",
      file,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "f32le",
      raw,
    ],
    {
      timeout: 300_000,
    },
  );
  const b = await fsp.readFile(raw);
  await fsp.rm(raw, { force: true });
  const copy = new Uint8Array(b.byteLength - (b.byteLength % 4));
  copy.set(b.subarray(0, copy.byteLength));
  return envelopeDb(new Float32Array(copy.buffer), 16000, step).map(
    (x) => Math.round(x * 10) / 10,
  );
}

/** Every game in the library with an official trailer whose lines are not made yet (pure over the read libraries). */
export function gamesNeedingLines(
  libs: ReadonlyArray<{ game: string; items: Parameters<typeof isLibraryTrailer>[0][] }>,
  done: (game: string, item: string) => boolean,
): string[] {
  return libs
    .filter((l) => l.items.some((i) => isLibraryTrailer(i) && !done(l.game, i.id)))
    .map((l) => l.game);
}

async function main(): Promise<void> {
  if (!game0)
    throw new Error(
      'usage: trailerlines.ts "<game>"|--all [--audio-dir=DIR] [--force]',
    );
  if (!DEMUCS_PY) throw new Error("no Python with Demucs (DEMUCS_PYTHON)");
  if (!WHISPER_PY) throw new Error("no Python with Whisper (WHISPER_PYTHON)");
  const root = libraryRoot(process.env.DATA_DIR || "data");
  if (game0 === "--all") {
    // Every library game with an official trailer, not just GTA VI (20 Nov 2026: not one trailer had been processed).
    const libs = [];
    for (const d of await fsp.readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!d.isDirectory()) continue;
      try {
        libs.push(JSON.parse(await fsp.readFile(path.join(root, d.name, "library.json"), "utf8")));
      } catch {
        // not a library
      }
    }
    const games = gamesNeedingLines(libs, (game, item) =>
      !flag("force") && fs.existsSync(path.join(libraryDir(root, game), voicelinesFile(item))),
    );
    console.log(`${games.length} games with trailers to process: ${games.join(", ")}`);
    for (const g of games) await processGame(root, g);
    return;
  }
  await processGame(root, game0);
}

async function processGame(root: string, game0: string): Promise<void> {
  const game = canonicalGame(game0);
  const lib = await readLibrary(root, game);
  if (!lib) throw new Error(`no library for ${game} under ${root}`);
  const dir = libraryDir(root, lib.game);
  await fsp.mkdir(path.join(dir, VOICELINES_DIR), { recursive: true });
  const audioDir = flag("audio-dir");
  const trailers = lib.items.filter(isLibraryTrailer);
  console.log(`${lib.game}: ${trailers.length} trailers`);
  for (const item of trailers) {
    const name = trailerName(item);
    const out = path.join(dir, voicelinesFile(item.id));
    if (!flag("force") && fs.existsSync(out)) {
      console.log(`  ${name}: done already`);
      continue;
    }
    const work = path.join(dir, VOICELINES_DIR, `${item.id}_work`);
    await fsp.mkdir(work, { recursive: true });
    try {
      const wav = path.join(work, "mix.wav");
      const local = audioDir ? path.join(audioDir, `${item.id}.m4a`) : "";
      const input = local && fs.existsSync(local) ? local : item.sourceUrl;
      await runCapped(
        FFMPEG,
        [
          "-v",
          "error",
          "-y",
          ...(input === item.sourceUrl ? ["-user_agent", "Mozilla/5.0"] : []),
          "-i",
          input,
          "-vn",
          "-map",
          "0:a:0",
          "-ac",
          "2",
          "-ar",
          "44100",
          wav,
        ],
        { timeout: 1800_000 },
      );
      await runCapped(
        DEMUCS_PY,
        ["-I", path.join(here, "trailervoice.py"), wav, work],
        {
          timeout: 1800_000,
          maxBuffer: 16 * 1024 * 1024,
        },
      );
      const vocals = path.join(work, "vocals.wav");
      const music = path.join(work, "music.wav");
      const words = await transcribeWords(vocals, WHISPER_PY);
      const feats = JSON.parse(
        await fsp.readFile(path.join(work, "features.json"), "utf8"),
      ) as {
        hop: number;
        f0: number[];
      };
      const voice = await monoLevels(vocals, LEVEL_STEP);
      const musicLv = await monoLevels(music, LEVEL_STEP);
      const lines = buildTrailerLines(
        words.filter((w): w is typeof w & { end: number } => typeof w.end === "number"), {
        f0: feats.f0,
        hop: feats.hop,
        voice,
        music: musicLv,
        step: LEVEL_STEP,
      });
      await runCapped(
        FFMPEG,
        [
          "-v",
          "error",
          "-y",
          "-i",
          vocals,
          "-i",
          music,
          "-filter_complex",
          `[1:a]volume=${MUSIC_UNDER_DB}dB[m];[0:a][m]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.89:level=disabled`,
          "-ar",
          "48000",
          "-ac",
          "2",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          path.join(dir, voiceMixFile(item.id)),
        ],
        { timeout: 600_000 },
      );
      const duration = item.durationSeconds ?? voice.length * LEVEL_STEP;
      const tl: TrailerLines = {
        version: TRAILER_LINES_VERSION,
        game: lib.game,
        item: item.id,
        name,
        sourceUrl: item.sourceUrl,
        publisher: item.source,
        duration: Math.round(duration * 1000) / 1000,
        voiceFile: voiceMixFile(item.id).split(path.sep).join("/"),
        builtAt: new Date().toISOString(),
        lines,
        levels: { step: LEVEL_STEP, voice, music: musicLv },
      };
      await fsp.writeFile(`${out}.tmp`, JSON.stringify(tl));
      await fsp.rename(`${out}.tmp`, out);
      const usable = lines.filter((l) => !l.unusable);
      console.log(
        `  ${name}: ${words.length} words, ${lines.length} lines, ${usable.length} usable`,
      );
      for (const l of lines)
        console.log(
          `    ${l.start.toFixed(2)}-${l.end.toFixed(2)} ${l.unusable ? `[${l.unusable}] ` : ""}(sustain ${l.sustain}, voice ${l.voiceDb} dB, music ${l.musicDb} dB) ${l.text}`,
        );
    } catch (err) {
      console.log(`  ${name}: failed: ${errorMessage(err).slice(0, 400)}`);
      process.exitCode = 1;
    } finally {
      await fsp
        .rm(work, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((err) => {
    console.error(errorMessage(err));
    process.exit(1);
  });
