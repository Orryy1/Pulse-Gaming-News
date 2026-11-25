// Live proof for STORE_TRAILERS (25 Nov 2026): asks every store for each test game's official trailers through the
// polite client (robots.txt, honest User-Agent, 1.5 s or more per host, cache, stop on 403/429), downloads up to two
// trailers per store, cuts short muted clips from each (the same windows Steam trailer clips use) and writes one
// contact sheet per game. Nothing touches YouTube.
// Usage: node --import tsx src/tools/storetrailers-proof.ts --out D:\pulse-data\scratch\storetrailers [--min-free-gb 320]
//   [--per-store 2] [--clips 3] [--game "Name|year|asked"]...

import fs from "node:fs/promises";
import path from "node:path";
import { runCapped } from "../lib/child.ts";
import { FFMPEG, FFPROBE } from "../lib/bin.ts";
import { clipWindows } from "../assets/steam.ts";
import { franchisePublisher } from "../assets/officialTrailer.ts";
import {
  PoliteClient,
  STORE_IDS,
  ffmpegFinish,
  freeBytes,
  rightsLabel,
  storeTrailersFor,
  type StoreId,
  type StoreTrailerOptions,
} from "../assets/storetrailers.ts";

const GAMES: Array<{ game: string; year?: number; asked?: string }> = [
  { game: "Grand Theft Auto VI", year: 2026 },
  { game: "Marvel's Spider-Man 2", year: 2023 },
  { game: "Halo Infinite", year: 2021 },
  { game: "Mass Effect 2", year: 2010, asked: "Mass Effect Legendary Edition" },
  { game: "The Legend of Zelda: Tears of the Kingdom", year: 2023 },
  { game: "Fortnite", year: 2017 },
];

function arg(name: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

async function seconds(file: string): Promise<number> {
  const { stdout } = await runCapped(
    FFPROBE,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      file,
    ],
    { timeout: 60_000 },
  ).catch(() => ({ stdout: "0" }));
  return Number(String(stdout).trim()) || 0;
}

async function height(file: string): Promise<number> {
  const { stdout } = await runCapped(
    FFPROBE,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=height",
      "-of",
      "default=nw=1:nk=1",
      file,
    ],
    { timeout: 60_000 },
  ).catch(() => ({ stdout: "0" }));
  return Number(String(stdout).trim()) || 0;
}

async function main(): Promise<void> {
  const out = arg("out", "D:\\pulse-data\\scratch\\storetrailers")!;
  const floor = Number(arg("min-free-gb", "320")) * 1e9;
  const perStore = Number(arg("per-store", "2"));
  const clipsPer = Number(arg("clips", "3"));
  const games = process.argv
    .flatMap((a, i) => (a === "--game" ? [process.argv[i + 1]!] : []))
    .map((g) => {
      const [game, year, asked] = g.split("|");
      return {
        game: game!,
        year: year ? Number(year) : undefined,
        asked: asked || undefined,
      };
    });
  await fs.mkdir(out, { recursive: true });
  const free = await freeBytes(out);
  console.log(
    `free on ${out}: ${(free / 1e9).toFixed(1)} GB (floor ${(floor / 1e9).toFixed(0)} GB)`,
  );
  if (free < floor) throw new Error("disk below the floor: nothing downloaded");
  const http = new PoliteClient({ cacheDir: path.join(out, "cache") });
  const remux = ffmpegFinish(FFMPEG, FFPROBE);
  const summary: Array<Record<string, unknown>> = [];
  for (const g of games.length ? games : GAMES) {
    const slug = g.game
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const dir = path.join(out, slug);
    await fs.mkdir(path.join(dir, "clips"), { recursive: true });
    const perStoreRow: Record<string, unknown> = {};
    const sheetFrames: string[] = [];
    for (const store of STORE_IDS as StoreId[]) {
      const report: StoreTrailerOptions["report"] = {};
      const trailers = await storeTrailersFor({
        http,
        ...g,
        stores: [store],
        max: perStore,
        publisher: franchisePublisher(g.game),
        remux,
        minFreeBytes: floor,
        report,
      });
      let clips = 0;
      const files: Array<Record<string, unknown>> = [];
      for (const [ti, t] of trailers.entries()) {
        const total = await seconds(t.file);
        const h = await height(t.file);
        const ats = clipWindows(total, clipsPer, 3.4);
        for (const [ci, at] of ats.entries()) {
          const clip = path.join(dir, "clips", `${store}_${ti}_${ci}.mp4`);
          await runCapped(
            FFMPEG,
            [
              "-y",
              "-loglevel",
              "error",
              "-ss",
              at.toFixed(2),
              "-i",
              t.file,
              "-t",
              "3.4",
              "-an",
              "-vf",
              "scale=-2:720,fps=30",
              "-c:v",
              "libx264",
              "-preset",
              "veryfast",
              "-crf",
              "24",
              "-pix_fmt",
              "yuv420p",
              clip,
            ],
            { timeout: 120_000 },
          ).catch(() => undefined);
          if ((await fs.stat(clip).catch(() => undefined))?.size) {
            clips++;
            const frame = path.join(dir, "clips", `${store}_${ti}_${ci}.jpg`);
            await runCapped(
              FFMPEG,
              [
                "-y",
                "-loglevel",
                "error",
                "-ss",
                "1.5",
                "-i",
                clip,
                "-frames:v",
                "1",
                "-vf",
                "scale=480:-2",
                frame,
              ],
              { timeout: 60_000 },
            ).catch(() => undefined);
            if ((await fs.stat(frame).catch(() => undefined))?.size)
              sheetFrames.push(frame);
          }
        }
        files.push({
          name: t.name,
          url: t.url,
          rights: rightsLabel(t.host),
          publisher: t.publisher,
          match: t.match,
          seconds: Math.round(total),
          height: h,
          mb: Math.round(((await fs.stat(t.file)).size / 1e6) * 10) / 10,
        });
      }
      perStoreRow[store] = { ...report[store], clips, trailers: files };
      console.log(
        `${g.game} | ${store}: ${report[store]?.product ?? "-"} | trailers ${trailers.length} | clips ${clips}${report[store]?.why ? ` | ${report[store]!.why}` : ""}`,
      );
    }
    // One contact sheet: every clip's frame, four across.
    if (sheetFrames.length) {
      const cols = 4;
      const list = sheetFrames.slice(0, 24);
      const inputs = list.flatMap((f) => ["-i", f]);
      const rows = Math.ceil(list.length / cols);
      const layout = list
        .map((_, i) => `${(i % cols) * 480}_${Math.floor(i / cols) * 270}`)
        .join("|");
      const scaled = list
        .map(
          (_, i) =>
            `[${i}:v]scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`,
        )
        .join(";");
      const stack =
        list.length > 1
          ? `${list.map((_, i) => `[v${i}]`).join("")}xstack=inputs=${list.length}:layout=${layout}:fill=black[s]`
          : `[v0]copy[s]`;
      await runCapped(
        FFMPEG,
        [
          "-y",
          "-loglevel",
          "error",
          ...inputs,
          "-filter_complex",
          `${scaled};${stack}`,
          "-map",
          "[s]",
          "-frames:v",
          "1",
          path.join(dir, "contact_sheet.jpg"),
        ],
        { timeout: 120_000 },
      ).catch((err) => console.log(`contact sheet failed: ${err}`));
      console.log(
        `${g.game}: contact sheet ${path.join(dir, "contact_sheet.jpg")} (${list.length} frames, ${rows} rows)`,
      );
    }
    summary.push({
      game: g.game,
      year: g.year,
      asked: g.asked,
      stores: perStoreRow,
    });
    await fs.writeFile(
      path.join(out, "summary.json"),
      JSON.stringify(
        { at: new Date().toISOString(), http: http.stats, games: summary },
        null,
        2,
      ),
    );
  }
  console.log(
    `requests ${http.stats.requests}, cache hits ${http.stats.cacheHits}, blocked hosts ${http.stats.blocked.join(", ") || "none"}, robots refusals ${http.stats.refusedRobots.length}`,
  );
  console.log(`free after: ${((await freeBytes(out)) / 1e9).toFixed(1)} GB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
