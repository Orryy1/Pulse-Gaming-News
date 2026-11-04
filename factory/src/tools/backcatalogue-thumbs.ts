// Renders the back catalogue's Test & compare thumbnails under the hero rule (THUMB_HERO_RULE, src/qa/thumbrule.ts)
// from a hand-written manifest (src/tools/backcatalogue-thumbs.json: for each video, the picked words, the art and
// where its subject is), checks each one and writes what src/tools/backcatalogue-apply.ts reads:
// <out>/abtests/pending.json, with the thumbnails in <out>/backcat/<episode>/. Reads the live data folder and writes
// only to <out>; it touches nothing live and no YouTube account. Art a pruned episode no longer has is fetched from
// its public source URL into <out>/art. A thumbnail marked "rejected" in the manifest is rendered for the record but
// stays out of the queue. Stills only, and it takes no orchestrator lease of its own, so run it wrapped:
//   C:\Claude\orchestrator\orch.cmd run --class heavy --project pulse --job "back catalogue thumbnails" --priority 20 --est 5 -- node --import tsx src/tools/backcatalogue-thumbs.ts <live data dir> <out dir>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  backCatalogueEntry,
  HAND_APPROVED,
  type AbQueueEntry,
} from "../backcatalogue.ts";
import { titleAngle, type TitleAngle } from "../editorial/titleshape.ts";
import { FFPROBE } from "../lib/bin.ts";
import { artVerdict, posterProblems } from "../qa/thumbrule.ts";
import { renderLongThumbs } from "../render/render.ts";

interface ManifestThumb {
  name: string;
  words: string;
  /** The picture, relative to the episode folder (or to <out>/art/<episode> when fetched). */
  art: string;
  /** Its public source, for an episode whose media has been pruned. */
  artUrl?: string;
  /** The provenance line the picture carries, checked against `game`. */
  provenance?: string;
  game: string;
  subjectX?: number;
  subjectY?: number;
  zoom?: number;
  /** The title this design goes with; absent for a design rendered only to compare. */
  title?: string;
  angle?: TitleAngle;
  rejected?: string;
}
interface ManifestVideo {
  videoId: string;
  episode: string;
  liveTitle: string;
  publishAt: string;
  /** The episode's folder relative to the data dir. */
  dir: string;
  /** Where to find the current thumbnail when the episode's folder has gone. */
  currentUrl?: string;
  nextTitles?: string[];
  thumbs: ManifestThumb[];
}

const [data, out, ...flags] = process.argv.slice(2);
if (!data || !out)
  throw new Error(
    "usage: backcatalogue-thumbs.ts <live data dir> <out dir> [--only=name]",
  );
const only = flags.find((f) => f.startsWith("--only="))?.slice(7);
const manifest = JSON.parse(
  fs.readFileSync(
    new URL("./backcatalogue-thumbs.json", import.meta.url),
    "utf8",
  ),
).videos as ManifestVideo[];
const OUT = path.resolve(out);

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
const fetchTo = async (url: string, file: string): Promise<void> => {
  if (fs.existsSync(file)) return;
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
};

const prepared: AbQueueEntry[] = [];
const report: Array<Record<string, unknown>> = [];
for (const v of manifest) {
  if (HAND_APPROVED.has(v.videoId))
    throw new Error(`${v.videoId} was hand-approved: not re-rendered`);
  const home = path.resolve(data, v.dir);
  const artDir = path.join(OUT, "art", v.episode);
  const backcat = path.join(OUT, "backcat", v.episode);
  fs.mkdirSync(backcat, { recursive: true });
  const queued: Array<{
    title: string;
    angle: TitleAngle;
    thumb: string;
    file: string;
  }> = [];
  for (const t of v.thumbs) {
    const file = path.join(backcat, `${t.name}.jpg`);
    const inHome = fs.existsSync(path.join(home, t.art));
    if (!inHome && t.artUrl) await fetchTo(t.artUrl, path.join(artDir, t.art));
    const root = inHome ? home : artDir;
    const verdict = artVerdict(t.provenance, t.game);
    const thumb = {
      headline: t.words,
      kicker: "",
      game: "",
      accent: "#FF6B1A",
      layout: "poster" as const,
      imageFile: t.art,
      imageAspect: aspectOf(path.join(root, t.art)),
      subjectX: t.subjectX,
      subjectY: t.subjectY,
      zoom: t.zoom,
    };
    if (!only || only === t.name)
      await renderLongThumbs({
        episodeDir: root,
        thumbs: [{ file, thumb: thumb as never }],
      });
    const problems = await posterProblems(file, thumb);
    if (verdict === "other") problems.push(`the art belongs to another game`);
    report.push({
      videoId: v.videoId,
      name: t.name,
      words: t.words,
      art: t.art,
      verdict,
      problems,
      rejected: t.rejected,
      file,
    });
    console.log(
      `${v.videoId} ${t.name} "${t.words}" art ${verdict}: ${problems.join("; ") || "passes"}${t.rejected ? ` (rejected: ${t.rejected})` : ""}`,
    );
    if (t.title && t.angle && !t.rejected && !problems.length)
      queued.push({ title: t.title, angle: t.angle, thumb: t.words, file });
  }
  // The current thumbnail first: the episode's, or the live one on YouTube when its folder has been pruned.
  let current = path.join(home, "thumb.jpg");
  if (!fs.existsSync(current) && v.currentUrl) {
    current = path.join(backcat, "thumb_current.jpg");
    await fetchTo(v.currentUrl, current);
  }
  const e = backCatalogueEntry({
    videoId: v.videoId,
    episode: v.episode,
    liveTitle: v.liveTitle,
    angles: queued,
    thumbs: [current, ...queued.slice(0, 2).map((q) => q.file)],
    publishAt: v.publishAt,
    now: new Date(),
  });
  prepared.push({
    ...e,
    angles: [
      titleAngle(v.liveTitle),
      ...queued.slice(0, 2).map((q) => q.angle),
    ],
    nextTitles: v.nextTitles ?? [],
    thumbWords: queued.slice(0, 2).map((q) => q.thumb),
  });
}
fs.mkdirSync(path.join(OUT, "abtests"), { recursive: true });
fs.writeFileSync(
  path.join(OUT, "abtests", "pending.json"),
  JSON.stringify(prepared, null, 2),
);
fs.writeFileSync(
  path.join(OUT, "report.json"),
  JSON.stringify(report, null, 1),
);
console.log(`prepared ${prepared.length} videos in ${OUT}`);
