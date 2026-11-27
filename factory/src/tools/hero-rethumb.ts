// New hero-style thumbnails for live long videos (the 19 Nov 2026 review: the GTA cover grid and the old split template
// failed on five public videos). Two steps, so the render can run where the art is and the upload where the login is:
//
//   render <manifest.json> <out dir>
//     For each video in the manifest (videoId, title, game, words, art, provenance, subjectX/Y, zoom): copies the art
//     into <out>/art/<videoId>/, draws the hero poster with the factory's own renderer (renderLongThumbs, PulseThumb),
//     writes <out>/<videoId>.jpg and a feed-size <out>/<videoId>_168.png, and checks it with the rule
//     (src/qa/thumbrule.ts designProblems + posterProblems, the art's game). <out>/report.json lists the verdicts.
//     Stills only and no lease of its own, so run it wrapped on the PC:
//       C:\Claude\orchestrator\orch.cmd run --class heavy --project pulse --job "hero rethumb" --priority 20 --est 5 -- node --import tsx src/tools/hero-rethumb.ts render <manifest> <out>
//
//   apply <out dir> <before dir> [--only=id,id] [--dry]
//     For each video report.json passes: saves the live thumbnail (maxresdefault, else hqdefault) to
//     <before>/<videoId>.jpg first, never overwriting one already saved, then sets <out>/<videoId>.jpg with the
//     factory's YouTube client (setThumbnail, thumbnails.set). Nothing else about the video is sent or changed. The
//     login is the factory's env-var trio (YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN): run it
//     from the factory folder on the machine that holds .env (the Mac mini). It never opens the live database, which
//     the running factory holds.
//   To put one back: apply with <before>/<videoId>.jpg as the file (copy it over <out>/<videoId>.jpg).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { FFMPEG, FFPROBE } from "../lib/bin.ts";
import { artVerdict, designProblems, posterProblems } from "../qa/thumbrule.ts";

interface ManifestVideo {
  videoId: string;
  /** The live title, which the words must not repeat. */
  title: string;
  game: string;
  words: string;
  /** Absolute path of the picture. */
  art: string;
  provenance?: string;
  subjectX?: number;
  subjectY?: number;
  zoom?: number;
}

interface ReportRow {
  videoId: string;
  title: string;
  words: string;
  file: string;
  small: string;
  problems: string[];
}

const MAX_BYTES = 2 * 1024 * 1024;

const aspectOf = (file: string): number => {
  const [w, h] = execFileSync(FFPROBE, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0",
    file,
  ])
    .toString()
    .trim()
    .split(",")
    .map(Number);
  return w! / h!;
};

async function render(manifestFile: string, outDir: string): Promise<void> {
  const { renderLongThumbs } = await import("../render/render.ts");
  const videos = JSON.parse(fs.readFileSync(manifestFile, "utf8"))
    .videos as ManifestVideo[];
  const out = path.resolve(outDir);
  const report: ReportRow[] = [];
  for (const v of videos) {
    const home = path.join(out, "art", v.videoId);
    fs.mkdirSync(home, { recursive: true });
    const art = path.basename(v.art);
    fs.copyFileSync(v.art, path.join(home, art));
    const thumb = {
      headline: v.words.toUpperCase(),
      kicker: "",
      game: "",
      accent: "#FF6B1A",
      layout: "poster" as const,
      imageFile: art,
      imageAspect: aspectOf(path.join(home, art)),
      subjectX: v.subjectX,
      subjectY: v.subjectY,
      zoom: v.zoom,
    };
    const file = path.join(out, `${v.videoId}.jpg`);
    await renderLongThumbs({
      episodeDir: home,
      thumbs: [{ file, thumb: thumb as never }],
    });
    const small = path.join(out, `${v.videoId}_168.png`);
    execFileSync(FFMPEG, [
      "-v",
      "error",
      "-y",
      "-i",
      file,
      "-vf",
      "scale=168:94:flags=area",
      small,
    ]);
    const problems = [
      ...designProblems(thumb, {
        headline: v.title,
        youtube: { title: v.title },
      }),
      ...(await posterProblems(file, thumb)),
    ];
    if (artVerdict(v.provenance, v.game) === "other")
      problems.push("the art belongs to another game");
    if (fs.statSync(file).size > MAX_BYTES)
      problems.push("over YouTube's 2 MB thumbnail limit");
    report.push({
      videoId: v.videoId,
      title: v.title,
      words: thumb.headline,
      file,
      small,
      problems,
    });
    console.log(
      `${v.videoId} "${thumb.headline}": ${problems.join("; ") || "passes"}`,
    );
  }
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 1),
  );
}

async function download(url: string, file: string): Promise<boolean> {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) return false;
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return true;
}

async function apply(
  outDir: string,
  beforeDir: string,
  only?: string[],
  dry = false,
): Promise<void> {
  process.loadEnvFile(".env");
  const { loadConfig } = await import("../config.ts");
  const { oauthConfig } = await import("../services.ts");
  const { accessToken } = await import("../youtube/oauth.ts");
  const { YouTubeClient } = await import("../youtube/upload.ts");
  const cfg = loadConfig();
  // No database: an empty settings table sends accessToken to the env-var refresh token, and the live factory keeps
  // its own database to itself.
  const noDb = { query: async () => [] } as never;
  const yt = new YouTubeClient(() => accessToken(noDb, oauthConfig(cfg)));
  const out = path.resolve(outDir);
  const report = JSON.parse(
    fs.readFileSync(path.join(out, "report.json"), "utf8"),
  ) as ReportRow[];
  fs.mkdirSync(beforeDir, { recursive: true });
  for (const r of report) {
    if (only && !only.includes(r.videoId)) continue;
    const file = path.join(out, `${r.videoId}.jpg`);
    if (r.problems.length) {
      console.log(
        `${r.videoId}: left alone, the new thumbnail fails (${r.problems.join("; ")})`,
      );
      continue;
    }
    const before = path.join(beforeDir, `${r.videoId}.jpg`);
    if (!fs.existsSync(before)) {
      const saved =
        (await download(
          `https://i.ytimg.com/vi/${r.videoId}/maxresdefault.jpg`,
          before,
        )) ||
        (await download(
          `https://i.ytimg.com/vi/${r.videoId}/hqdefault.jpg`,
          before,
        ));
      if (!saved) {
        console.log(
          `${r.videoId}: the current thumbnail could not be saved, so it is left alone`,
        );
        continue;
      }
    }
    if (dry) {
      console.log(
        `${r.videoId}: would set ${file} (current saved at ${before})`,
      );
      continue;
    }
    await yt.setThumbnail(r.videoId, file);
    console.log(
      `${r.videoId}: set "${r.words}" (the old one is saved at ${before})`,
    );
  }
}

const [cmd, a, b, ...flags] = process.argv.slice(2);
const only = flags
  .find((f) => f.startsWith("--only="))
  ?.slice(7)
  .split(",");
if (cmd === "render" && a && b) await render(a, b);
else if (cmd === "apply" && a && b)
  await apply(a, b, only, flags.includes("--dry"));
else
  throw new Error(
    "usage: hero-rethumb.ts render <manifest.json> <out dir> | apply <out dir> <before dir> [--only=id,id] [--dry]",
  );
