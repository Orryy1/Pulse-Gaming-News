// Game-sound stems, made once per library video on the PC (GAME_SFX_STEMS, src/assets/gamesfx.ts).
//   npx tsx src/tools/gamesfx.ts "Grand Theft Auto VI" [--audio-dir=DIR] [--force] [--priority=60]
//   npx tsx src/tools/gamesfx.ts --source=<file or URL> --out=<dir> [--priority=20]   (one source, for checks)
// For each official video in the game's library (trailers and gameplay; never the owner's own capture): its sound
// (from DIR/<item>.m4a when given, else read from the publisher's own file, picture skipped: the library keeps the
// picture only), split by src/tools/gamesfx.py (Demucs htdemucs_ft from the torch cache, then the tonal part and the
// beat taken out), written beside the item as sfxstems/<item>.sfx.m4a and sfxstems/<item>.json. Each item takes a
// GPU turn from the PC orchestrator itself (orch.mjs, Pulse's priority 60 by default; 20 for tests), so do not also
// wrap it in orch run. DATA_DIR or GAME_LIBRARY_DIR pick the library; DEMUCS_PYTHON the Python with Demucs.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FFMPEG } from "../lib/bin.ts";
import { runCapped } from "../lib/child.ts";
import { loadOrch } from "../lib/orch.ts";
import { errorMessage } from "../lib/util.ts";
import {
  canonicalGame,
  libraryDir,
  libraryRoot,
  readLibrary,
} from "../assets/gamelib.ts";
import {
  SFX_STEM_VERSION,
  SFX_STEMS_DIR,
  sfxStemFile,
  sfxStemInfoFile,
  type SfxStemInfo,
  wantsStem,
} from "../assets/gamesfx.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  return hit === undefined
    ? undefined
    : hit.includes("=")
      ? hit.slice(hit.indexOf("=") + 1)
      : "true";
};
const game0 = args.find((a) => !a.startsWith("--"));
const DEMUCS_PY =
  process.env.DEMUCS_PYTHON ||
  ["D:/pulse-tools/avtools-venv/Scripts/python.exe"].find((p) =>
    fs.existsSync(p),
  ) ||
  "";
const PRIORITY = Math.max(
  1,
  Math.min(60, Number(flag("priority") ?? 60) || 60),
);

/** One GPU turn from the orchestrator around `fn`; fails open when the orchestrator is not there. */
async function withGpu<T>(
  job: string,
  est: number,
  fn: () => Promise<T>,
): Promise<T> {
  let release: () => void = () => undefined;
  try {
    const orch = await loadOrch();
    release = (await orch.lease("gpu", {
      job,
      project: "pulse",
      priority: PRIORITY,
      kind: "pulse:gamesfx",
      est,
      vram: 6,
      ram: 6,
    })) as () => void;
  } catch (err) {
    console.log(`  no orchestrator turn (${errorMessage(err)}); going ahead`);
  }
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Splits one source's sound into `work`: work/sfx.wav, work/music.wav, work/sfx.json. */
async function split(
  input: string,
  work: string,
  label: string,
): Promise<void> {
  await fsp.mkdir(work, { recursive: true });
  const wav = path.join(work, "mix.wav");
  await runCapped(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      ...(/^https?:/.test(input) ? ["-user_agent", "Mozilla/5.0"] : []),
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
  const seconds = fs.statSync(wav).size / (44100 * 4);
  await withGpu(
    `game-sfx stem: ${label}`,
    Math.max(2, Math.ceil(seconds / 60)),
    () =>
      runCapped(DEMUCS_PY, ["-I", path.join(here, "gamesfx.py"), wav, work], {
        timeout: 1800_000,
        maxBuffer: 16 * 1024 * 1024,
      }),
  );
}

async function aac(src: string, dest: string): Promise<void> {
  await runCapped(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-i",
      src,
      "-ar",
      "48000",
      "-ac",
      "2",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      dest,
    ],
    { timeout: 600_000 },
  );
}

async function main(): Promise<void> {
  if (!DEMUCS_PY) throw new Error("no Python with Demucs (DEMUCS_PYTHON)");
  const source = flag("source");
  if (source) {
    const out = flag("out");
    if (!out) throw new Error("--source needs --out=<dir>");
    await split(source, out, path.basename(source).slice(0, 40));
    console.log(`stems in ${out}`);
    return;
  }
  if (!game0)
    throw new Error(
      'usage: gamesfx.ts "<game>" [--audio-dir=DIR] [--force] | --source=<file|url> --out=<dir>',
    );
  const root = libraryRoot(process.env.DATA_DIR || "data");
  const lib = await readLibrary(root, canonicalGame(game0));
  if (!lib) throw new Error(`no library for ${game0} under ${root}`);
  const dir = libraryDir(root, lib.game);
  await fsp.mkdir(path.join(dir, SFX_STEMS_DIR), { recursive: true });
  const audioDir = flag("audio-dir");
  const items = lib.items.filter(wantsStem);
  console.log(`${lib.game}: ${items.length} videos`);
  for (const item of items) {
    const infoPath = path.join(dir, sfxStemInfoFile(item.id));
    if (!flag("force") && fs.existsSync(infoPath)) {
      console.log(`  ${item.id}: done already`);
      continue;
    }
    const work = path.join(dir, SFX_STEMS_DIR, `${item.id}_work`);
    try {
      const local = audioDir ? path.join(audioDir, `${item.id}.m4a`) : "";
      await split(
        local && fs.existsSync(local) ? local : item.sourceUrl,
        work,
        `${lib.game} ${item.id}`,
      );
      const m = JSON.parse(
        await fsp.readFile(path.join(work, "sfx.json"), "utf8"),
      ) as {
        step: number;
        sfx: number[];
        music: number[];
        gate: number[];
        kept: number;
        gatedShare: number;
      };
      await aac(
        path.join(work, "sfx.wav"),
        path.join(dir, sfxStemFile(item.id)),
      );
      const info: SfxStemInfo = {
        version: SFX_STEM_VERSION,
        item: item.id,
        sourceUrl: item.sourceUrl,
        file: sfxStemFile(item.id).split(path.sep).join("/"),
        step: m.step,
        sfx: m.sfx,
        music: m.music,
        gate: m.gate,
        kept: m.kept,
        gatedShare: m.gatedShare,
        builtAt: new Date().toISOString(),
      };
      await fsp.writeFile(`${infoPath}.tmp`, JSON.stringify(info));
      await fsp.rename(`${infoPath}.tmp`, infoPath);
      console.log(
        `  ${item.id}: kept ${(m.kept * 100).toFixed(1)}% of the energy, ${(m.gatedShare * 100).toFixed(0)}% under a beat`,
      );
    } catch (err) {
      console.log(`  ${item.id}: failed: ${errorMessage(err).slice(0, 400)}`);
      process.exitCode = 1;
    } finally {
      await fsp
        .rm(work, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }
}

main().catch((err) => {
  console.error(errorMessage(err));
  process.exit(1);
});
