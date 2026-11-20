// A/B proof of GAME_SFX_STEMS on a real episode (src/assets/gamesfx.ts), on the PC, with the production code path.
//   npx tsx src/tools/gamesfxproof.ts --assets=<episode assets_json file> --short=<short.mp4> --stems=<dir> --out=<dir>
// <stems>/<key>/ holds src/tools/gamesfx.py's output (sfx.wav, sfx.json, mix.wav) for each source the clips use; a
// clip's key is its library item ID (from "lib_<id>_..." file names) or "steam_<id>" for a Steam trailer. A throwaway
// library is made from them, then src/assets/gameaudio.ts buildShortBed mixes the bed from the episode's own plan,
// words and clips twice: through the stems (B) and, for reference only, through the full original sound (C: what
// GAME_AUDIO_TRAILERS would play, licensed score and all). Each is laid under the published Short's own audio (A).
// The published mix already holds its music at full level, so B and C lack the music dip GAME_AUDIO_MUSIC_DIP gives in
// a real render: they are, if anything, a little busier than a render would be. Writes A.wav, B.wav, C.wav, the beds
// and proof.json (EBU R128 loudness of each, and of the bed under the voice and in the gaps).
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FFMPEG } from "../lib/bin.ts";
import { runCapped } from "../lib/child.ts";
import { buildShortBed, type SoundClip } from "../assets/gameaudio.ts";
import { SFX_STEM_VERSION } from "../assets/gamesfx.ts";

const args = process.argv.slice(2);
const flag = (name: string): string => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  if (!hit) throw new Error(`missing --${name}=`);
  return hit.slice(name.length + 3);
};

/** The source key of a clip (pure): its library item ID, or "steam_<id>" for a Steam trailer. */
export function sourceKey(c: {
  file: string;
  sourceUrl?: string;
}): string | undefined {
  const lib = path.basename(c.file).match(/^lib_([0-9a-f]{14})_/)?.[1];
  if (lib) return lib;
  const steam = (c.sourceUrl ?? "").match(/store_trailers\/\d+\/(\d+)\//)?.[1];
  return steam ? `steam_${steam}` : undefined;
}

async function ebur(
  file: string,
): Promise<{ I: number; LRA: number; TP: number }> {
  const { stderr } = await runCapped(
    FFMPEG,
    [
      "-hide_banner",
      "-nostats",
      "-i",
      file,
      "-af",
      "ebur128=peak=true",
      "-f",
      "null",
      "-",
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const num = (re: RegExp) => Number(stderr.match(re)?.[1] ?? Number.NaN);
  return {
    I: num(/I:\s*(-?[\d.]+) LUFS\s*\n\s*Threshold/),
    LRA: num(/LRA:\s*(-?[\d.]+) LU\s*\n/),
    TP: num(/Peak:\s*(-?[\d.]+) dBFS/),
  };
}

/** Loudness of `file` over the stretches `keep` (seconds), by muting the rest; NaN when nothing is left. */
async function eburOver(
  file: string,
  keep: Array<[number, number]>,
  work: string,
  name: string,
) {
  if (!keep.length) return Number.NaN;
  const expr = keep
    .map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`)
    .join("+");
  const out = path.join(work, `${name}.wav`);
  await runCapped(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-i",
      file,
      "-af",
      `volume='if(${expr},1,0)':eval=frame`,
      out,
    ],
    {
      timeout: 120_000,
    },
  );
  return (await ebur(out)).I;
}

async function makeLibrary(
  root: string,
  stems: string,
  keys: Map<string, string>,
  which: "sfx" | "mix",
): Promise<void> {
  const dir = path.join(root, "gamelib", "proof");
  await fsp.mkdir(path.join(dir, "sfxstems"), { recursive: true });
  const items = [];
  for (const [url, key] of keys) {
    const src = path.join(stems, key, `${which}.wav`);
    const m = JSON.parse(
      await fsp.readFile(path.join(stems, key, "sfx.json"), "utf8"),
    );
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
        path.join(dir, "sfxstems", `${key}.sfx.m4a`),
      ],
      { timeout: 600_000 },
    );
    // The reference (C) is the original sound with no gate: every stretch may be heard.
    const gate = which === "sfx" ? m.gate : m.gate.map(() => 0);
    const sfx = which === "sfx" ? m.sfx : m.gate.map(() => -20);
    await fsp.writeFile(
      path.join(dir, "sfxstems", `${key}.json`),
      JSON.stringify({
        version: SFX_STEM_VERSION,
        item: key,
        sourceUrl: url,
        file: `sfxstems/${key}.sfx.m4a`,
        step: m.step,
        sfx,
        music: m.music,
        gate,
        kept: m.kept,
        gatedShare: m.gatedShare,
        builtAt: new Date().toISOString(),
      }),
    );
    items.push({
      id: key,
      kind: "video",
      file: `videos/${key}.mp4`,
      sourceUrl: url,
      provenance: "proof",
      source: "proof",
      named: ["trailer"],
      tags: [],
      seen: "",
      addedAt: "",
    });
  }
  await fsp.writeFile(
    path.join(dir, "library.json"),
    JSON.stringify({ version: 1, game: "proof", items, updatedAt: "" }),
  );
}

async function main(): Promise<void> {
  const assets = JSON.parse(await fsp.readFile(flag("assets"), "utf8"));
  const short = flag("short");
  const stems = flag("stems");
  const out = flag("out");
  await fsp.mkdir(out, { recursive: true });
  const clips = (assets.clips ?? []) as SoundClip[];
  const keys = new Map<string, string>();
  for (const c of clips) {
    const k = sourceKey(c);
    if (k && c.sourceUrl && fs.existsSync(path.join(stems, k, "sfx.json")))
      keys.set(c.sourceUrl, k);
  }
  console.log(`${keys.size} sources with stems for ${clips.length} clips`);
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), "pulse-sfxproof-"));
  const A = path.join(out, "A_published.wav");
  await runCapped(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-i",
      short,
      "-vn",
      "-ac",
      "2",
      "-ar",
      "48000",
      "-c:a",
      "pcm_s16le",
      A,
    ],
    { timeout: 120_000 },
  );
  const report: Record<string, unknown> = {
    episodeSeconds: assets.plan.totalFrames / assets.plan.fps,
  };
  const prev = process.env.GAME_LIBRARY_DIR;
  delete process.env.GAME_LIBRARY_DIR;
  try {
    for (const [tag, which] of [
      ["B", "sfx"],
      ["C", "mix"],
    ] as const) {
      const root = path.join(work, tag);
      const epDir = path.join(root, "ep");
      await fsp.mkdir(path.join(epDir, "assets"), { recursive: true });
      await makeLibrary(root, stems, keys, which);
      const bed = await buildShortBed({
        dir: epDir,
        dataDir: root,
        ytdlp: "yt-dlp",
        clips,
        plan: assets.plan,
        words: assets.words ?? [],
        quotes: assets.quotes ?? [],
        underLufs: -30,
        gapLufs: -24,
        trailers: false,
        sfxStems: true,
      });
      if (!bed) {
        report[tag] = { bed: "none built" };
        continue;
      }
      const bedOut = path.join(out, `${tag}_bed.wav`);
      await fsp.copyFile(path.join(epDir, bed.file), bedOut);
      const mixOut = path.join(
        out,
        tag === "B"
          ? "B_with_game_sfx.wav"
          : "C_reference_full_trailer_sound.wav",
      );
      await runCapped(
        FFMPEG,
        [
          "-v",
          "error",
          "-y",
          "-i",
          A,
          "-i",
          bedOut,
          "-filter_complex",
          "[0:a][1:a]amix=inputs=2:normalize=0:duration=first",
          "-c:a",
          "pcm_s16le",
          mixOut,
        ],
        { timeout: 120_000 },
      );
      // The voice's words (with the bed's own lead and tail) against the gaps, inside the stretches the game is heard.
      const words = (assets.words ?? []) as Array<{
        start: number;
        end: number;
      }>;
      const inSpans = (a: number, b: number) =>
        bed.spans.some((s) => a < s.to && b > s.from);
      const speech: Array<[number, number]> = words
        .filter((w) => inSpans(w.start, w.end))
        .map((w) => [Math.max(0, w.start - 0.08), w.end + 0.12]);
      const gaps: Array<[number, number]> = [];
      for (const s of bed.spans) {
        let t = s.from;
        for (const [a, b] of speech
          .filter(([a, b]) => a < s.to && b > s.from)
          .sort((x, y) => x[0] - y[0])) {
          if (a - t >= 0.25) gaps.push([t, a]);
          t = Math.max(t, b);
        }
        if (s.to - t >= 0.25) gaps.push([t, s.to]);
      }
      report[tag] = {
        heardSeconds: bed.seconds,
        spans: bed.spans,
        heard: bed.heard.map((h) => ({
          clip: h.index,
          lufs: h.lufs,
          trimDb: h.trimDb,
          stem: h.stem,
        })),
        skipped: bed.skipped,
        bed: await ebur(bedOut),
        bedUnderVoiceLufs: await eburOver(
          bedOut,
          speech,
          work,
          `${tag}_speech`,
        ),
        bedInGapsLufs: await eburOver(bedOut, gaps, work, `${tag}_gaps`),
        mix: await ebur(mixOut),
      };
    }
  } finally {
    if (prev !== undefined) process.env.GAME_LIBRARY_DIR = prev;
    await fsp.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
  report.A = await ebur(A);
  await fsp.writeFile(
    path.join(out, "proof.json"),
    JSON.stringify(report, null, 1),
  );
  console.log(JSON.stringify(report, null, 1));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
